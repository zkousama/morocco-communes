/**
 * The pilot's analysis: every measure `insights/pilot/preregistration.md` names, each
 * per-finding one with a seeded bootstrap interval over the findings, then that file's 6
 * decision rules, applied exactly as written there and to point estimates only (the
 * intervals are reported beside them, never read by a rule). `pnpm insights:pilot:analyse`
 * reads the 2 stage files and the finished rating, then writes `insights/pilot/results.json`,
 * the tables between the results markers in `insights/pilot/README.md`, and the setup the
 * rules chose to `insights/setup.json`. It never calls a model: everything here was already
 * recorded by the stages and the rating.
 *
 * A few readings the preregistration leaves to the analysis, fixed here:
 * - A verdict *argued* a candidate when its answer was usable and it wasn't a safety stop. A
 *   run *broke* a candidate exactly when `broke` (rate.ts) says so, and *passed* it when it
 *   argued it and the candidate survived.
 * - Agreement between 2 runs is over the pool candidates both gave a usable answer on, on
 *   whether the candidate survived (a safety stop reads as stopped, the pipeline's own
 *   outcome for it). It's 1 when the 2 runs agree on every one of them, else Cohen's kappa.
 * - A run is right on a rated disagreement when it broke a reason the owner judged unsound,
 *   or passed one judged sound; a skip, or that run's own unusable answer or safety stop,
 *   counts for neither. Yes rates come from the reasons part of the rating only, rightness
 *   from the disagreements part only, even for a candidate that turns up in both.
 * - Rule 6 ranks a candidate among the ones that passed their data test in its finding and
 *   proposer, in propose's own order (support, then first proposed), the way a page would
 *   show them; a break lands on a shown reason when that rank is under `PUBLISHED_CAP`. It
 *   pools the breaks of all 5 runs.
 * - Cost is each call's recorded `costUsd`, the list price the CLI reports; Gemini's free tier
 *   records 0. Seconds per call is the recorded answering time (waits for retries and limits
 *   already left out), averaged over the calls that came back.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { addUsage, compactCount, inputOf, messageOf, NO_USAGE, usd, writeJsonAtomic, writeTextAtomic, type Usage } from "../model.ts";
import { formatSetup, parseSetup, SETUP_PATH, type Role, type Setup } from "../setup.ts";
import { bootstrap, cohenKappa } from "../stats.ts";
import { STAGE_A_PATH, STAGE_B_PATH } from "./cli.ts";
import { broke, counterIdOf, RATINGS_PATH, readStageFiles, remainingItems, type RatingItem, type Ratings } from "./rate.ts";
import {
  A5_MAX_HOURS,
  ADVERSARIES,
  BOOTSTRAP_ROUNDS,
  CONFIDENCE,
  FULL_RUN_ADVERSARY_CALLS,
  HIGH_EFFORT_RIGHT_SHARE,
  KAPPA_MARGIN,
  MAX_SAMPLES,
  MIN_SAMPLES,
  modelFamily,
  PILOT_SEED,
  PROPOSER_MARGIN,
  PROPOSERS,
  PUBLISHED_CAP,
  SAMPLES_SHARE,
  SELF_PREFERENCE_GAP,
  SHOWN_BREAKS_SHARE,
  type PilotRole,
} from "./setups.ts";
import type { StageA, StageACandidate, StageAProposer, StageB, StageBVerdict } from "./stages.ts";

export const RESULTS_PATH = "insights/pilot/results.json";
export const README_PATH = "insights/pilot/README.md";

const RESULTS_START = "<!-- results:start -->";
const RESULTS_END = "<!-- results:end -->";

/** Slack for "within" and "at least": 0.8 - 0.7 is 0.10000000000000009 in floating point, and the rules mean it to count as 0.1. */
const EPS = 1e-9;

/** The runs the preregistration's rules name: A1 and A2 give the noise floor, A1 or A3 is the Opus run rule 2 chooses, A4 and A5 may replace it. */
const MEDIUM_RUN = "A1";
const REPEAT_RUN = "A2";
const HIGH_RUN = "A3";
const CHALLENGERS = ["A4", "A5"] as const;
const SPEED_CHECKED = "A5"; // the free tier's one call at a time
const TIE_GOES_TO = "A5"; // "a tie goes to the cheaper one, A5, since Google's free tier costs nothing"
const TOO_SLOW_GOES_TO = "A4"; // "an A5 pick that fails the 48-hour check going to A4 instead"

export interface Interval {
  value: number;
  low: number;
  high: number;
}

export interface ProposerResults {
  calls: number; // calls that came back
  failedCalls: number; // calls that threw
  usable: Interval; // share of samples with at least one valid hypothesis
  candidates: number; // distinct reasons, each with its own data test
  passed: Interval | null; // share of those data tests that passed; null with no reason at all
  refused: Record<string, number>; // data tests refused, by reason
  missing: number; // data tests that failed on a missing figure
  safetyDrops: Record<string, number>;
  distinctPerFinding: Interval;
  entropy: Interval;
  linksProposed: number;
  linksConsistent: number;
  yesRate: Interval | null; // the owner's yes rate on the rated reasons; null with none answered yes or no
  rated: number; // reasons answered yes or no
  costUsd: number; // at list price, as recorded
  tokens: Usage;
  secondsPerCall: number | null; // null with no call back
}

export interface AdversaryResults {
  judged: number; // pool candidates it argued
  breakRate: Interval | null;
  unusable: number;
  refused: number; // safety stops
  calls: number;
  costUsd: number;
  tokens: Usage;
  secondsPerCall: number | null;
  rightOnDisagreements: Interval | null;
  disagreementsRated: number; // rated disagreements it argued, skips left out
  countersHeld: Interval | null; // its counter-tests the owner judged to break the reason
  countersRated: number;
  family: { own: number; others: number; gap: Interval } | null; // break rate on its own family's reasons, on everyone else's, and others minus own
}

export interface SafetyByRun {
  refused: number;
  categories: Record<string, number>;
  refusedWithoutTerm: number; // refused, with no private term matched
  termButPassed: number; // a private term matched, and it argued the candidate anyway
}

export interface Decision {
  choice: string;
  rule: string;
  because: string;
  metBar: boolean; // false only where the preregistration says the write-up has to say a choice didn't meet its rule's own bar
}

export interface Decisions {
  proposer: Decision;
  adversaryEffort: Decision;
  adversaryModel: Decision;
  selfPreference: Decision;
  samples: Decision;
  attackShownOnly: Decision;
}

export interface Results {
  measuredAt: string;
  seed: number;
  findings: number;
  poolByProposer: Record<string, number>;
  proposers: Record<string, ProposerResults>;
  adversaries: Record<string, AdversaryResults>;
  agreement: Record<string, Interval | null>; // "A1|A2" -> agreementOf the 2 runs, every pair; null with no candidate both answered
  noiseFloor: Interval | null; // A1 against A2
  extraBreaks: { inPool: number; rated: number; right: number }; // rule 2: candidates A3 broke and A1 passed
  samplesCurve: Record<string, Interval[]>; // proposer -> share of its good reasons found with the first 1..MAX_SAMPLES samples; empty with no good reason
  goodReasons: Record<string, number>;
  shownBreaks: { breaks: number; shown: number; share: Interval | null }; // rule 6, across every run
  safety: { termsMatched: number; byRun: Record<string, SafetyByRun>; policyMisses: { candidateId: string; category: "terms"; runs: string[] }[] };
  drift: { kappa: number | null; n: number };
  decisions: Decisions;
}

/**
 * How far 2 runs agree: 1 when they give the same label on every candidate, else Cohen's
 * kappa. `cohenKappa` alone reads 2 runs that give one same label throughout as 0 (its
 * chance agreement is 1 then), which would turn perfect agreement into none. NaN with no
 * candidate at all: there's nothing to measure.
 */
export function agreementOf(a: string[], b: string[]): number {
  if (a.length !== b.length) throw new Error(`agreementOf: ${a.length} labels against ${b.length}`);
  if (a.length === 0) return NaN;
  if (a.every((label, i) => label === b[i])) return 1;
  return cohenKappa(a, b);
}

/** Why the rating can't be analysed yet, or null once every plan item has an answer (a skip counts as one). */
export function unfinishedRating(ratings: Ratings): string | null {
  if (ratings.items.length === 0) return "the rating hasn't started: run `pnpm insights:pilot:rate` first";
  const left = remainingItems(ratings).length;
  if (left === 0) return null;
  return `the rating isn't finished: ${left} of ${ratings.items.length} items still to rate; run \`pnpm insights:pilot:rate\` to finish it`;
}

/** A5's hours for the full run's adversary calls, one call at a time. */
export function hoursFor(secondsPerCall: number): number {
  return (secondsPerCall * FULL_RUN_ADVERSARY_CALLS) / 3600;
}

const share = (xs: boolean[]): number => (xs.length === 0 ? NaN : xs.filter(Boolean).length / xs.length);
const mean = (xs: number[]): number => (xs.length === 0 ? NaN : xs.reduce((sum, x) => sum + x, 0) / xs.length);
const count = <T>(xs: T[], test: (x: T) => boolean): number => xs.filter(test).length;
const tally = (keys: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = (out[key] ?? 0) + 1;
  return out;
};

/** `items`' values grouped by finding, in `order`, each finding one group and an empty one left out: the unit the bootstrap resamples. */
function byFinding<T>(order: string[], items: { findingId: string; value: T }[]): T[][] {
  const known = new Set(order);
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    if (!known.has(item.findingId)) throw new Error(`analyse: finding "${item.findingId}" isn't one of stage A's findings`);
    const list = grouped.get(item.findingId) ?? [];
    list.push(item.value);
    grouped.set(item.findingId, list);
  }
  return order.filter((id) => grouped.has(id)).map((id) => grouped.get(id)!);
}

/**
 * `statistic` over every item, with its seeded bootstrap interval over the findings; null
 * when there's nothing to compute it on, or (only ever for a difference between 2 subsets,
 * where a round can draw one of them empty) no round gave a number either.
 */
function interval<T>(groups: T[][], statistic: (sample: T[]) => number): Interval | null {
  const value = statistic(groups.flat());
  if (!Number.isFinite(value)) return null;
  const { low, high } = bootstrap(groups, statistic, BOOTSTRAP_ROUNDS, PILOT_SEED, CONFIDENCE);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { value, low, high };
}

/** `interval` where the measure always has something to count (every finding gives a sample count, say). */
function sure<T>(groups: T[][], statistic: (sample: T[]) => number, what: string): Interval {
  const out = interval(groups, statistic);
  if (!out) throw new Error(`analyse: ${what} has nothing to measure`);
  return out;
}

const argued = (v: StageBVerdict): boolean => v.unusable === null && v.stage !== "safety";
const passedBy = (v: StageBVerdict): boolean => argued(v) && v.survived;
const verdictLabel = (v: StageBVerdict): string => (v.survived ? "survived" : "stopped");

function roleOf(roles: PilotRole[], id: string): PilotRole {
  const role = roles.find((r) => r.id === id);
  if (!role) throw new Error(`no pilot setup "${id}"`);
  return role;
}

const sameModel = (x: PilotRole, y: PilotRole): boolean => x.transport === y.transport && x.model === y.model;

/**
 * Each passing candidate's place among the candidates that passed their data test in its
 * own finding and proposer, in propose's own order (`rank`: support, then first proposed).
 * A page only ever shows reasons that passed, so this, and not `rank` itself, says whether a
 * reason sits in the top `PUBLISHED_CAP` a page would show.
 */
function passingRanks(candidates: StageACandidate[]): Map<string, number> {
  const groups = new Map<string, StageACandidate[]>();
  for (const c of candidates) {
    if (!c.passed) continue;
    const key = `${c.proposer}:${c.findingId}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out = new Map<string, number>();
  for (const group of groups.values()) {
    group.sort((x, y) => x.rank - y.rank).forEach((c, i) => out.set(c.candidateId, i));
  }
  return out;
}

type Answer = Ratings["answers"][number];

function proposerResults(
  p: StageAProposer,
  a: StageA,
  reasons: { candidate: StageACandidate; answer: Answer }[],
): { results: ProposerResults; curve: Interval[]; good: number } {
  const mine = a.candidates.filter((c) => c.proposer === p.id);
  const at = (c: StageACandidate) => c.findingId;

  // One group per finding: its samples, each usable or not.
  const usable = a.findingIds.map((findingId) => Array.from({ length: MAX_SAMPLES }, (_, i) => i >= (p.unusable[findingId] ?? 0)));
  const counts = a.findingIds.map((findingId) => ({ findingId, value: count(mine, (c) => c.findingId === findingId) }));
  const entropies = a.findingIds.filter((id) => p.entropy[id] !== undefined).map((findingId) => ({ findingId, value: p.entropy[findingId]! }));

  const rated = reasons.filter((r) => r.candidate.proposer === p.id && r.answer.answer !== "skip");
  const good = rated.filter((r) => r.answer.answer === "yes");
  const goodGroups = byFinding(
    a.findingIds,
    good.map((r) => ({ findingId: at(r.candidate), value: Math.min(...r.candidate.sampleIndexes) })),
  );
  const curve =
    good.length === 0
      ? []
      : Array.from({ length: MAX_SAMPLES }, (_, i) => sure(goodGroups, (firsts) => share(firsts.map((first) => first < i + 1)), `${p.id}'s samples curve`));

  const results: ProposerResults = {
    calls: p.replies.length,
    failedCalls: p.failed,
    usable: sure(usable, share, `${p.id}'s usable answers`),
    candidates: mine.length,
    passed: interval(byFinding(a.findingIds, mine.map((c) => ({ findingId: at(c), value: c.passed }))), share),
    refused: tally(mine.filter((c) => c.outcome.status === "refused").map((c) => c.outcome.reason ?? "unknown")),
    missing: count(mine, (c) => c.outcome.status === "failed" && c.outcome.reason === "missing"),
    safetyDrops: { ...p.safetyDrops },
    distinctPerFinding: sure(byFinding(a.findingIds, counts), mean, `${p.id}'s reasons per finding`),
    entropy: sure(byFinding(a.findingIds, entropies), mean, `${p.id}'s entropy`),
    linksProposed: count(mine, (c) => c.candidate.linkTest !== null),
    linksConsistent: count(mine, (c) => c.link?.verdict === "consistent"),
    yesRate: interval(byFinding(a.findingIds, rated.map((r) => ({ findingId: at(r.candidate), value: r.answer.answer === "yes" }))), share),
    rated: rated.length,
    costUsd: p.usage.costUsd,
    tokens: { ...p.usage },
    secondsPerCall: p.replies.length === 0 ? null : p.ms / p.replies.length / 1000,
  };
  return { results, curve, good: good.length };
}

/**
 * Every preregistered measure, then `decide`. Throws, rather than reading anything, on an
 * unfinished rating, or on stage files and a rating that don't fit together (a pool
 * candidate stage A doesn't have, a run missing a verdict, a rated item naming a candidate
 * neither stage has): a measure over a mismatched set would read as real and wouldn't be.
 */
export function analyse(a: StageA, b: StageB, ratings: Ratings, now: Date = new Date()): Results {
  const unfinished = unfinishedRating(ratings);
  if (unfinished) throw new Error(unfinished);

  const candidateById = new Map(a.candidates.map((c) => [c.candidateId, c]));
  for (const p of PROPOSERS) {
    if (!a.proposers.some((x) => x.id === p.id)) throw new Error(`stage A has nothing for proposer ${p.id}`);
  }
  for (const entry of b.pool) {
    if (!candidateById.has(entry.candidateId)) throw new Error(`stage B's pool has candidate ${entry.candidateId}, which stage A doesn't`);
  }
  const poolIds = new Set(b.pool.map((e) => e.candidateId));

  const verdicts = new Map<string, StageBVerdict>();
  for (const v of b.verdicts) {
    if (!poolIds.has(v.candidateId)) throw new Error(`stage B has a ${v.run} verdict on ${v.candidateId}, which isn't in its pool`);
    if (verdicts.has(`${v.run}:${v.candidateId}`)) throw new Error(`stage B has 2 ${v.run} verdicts on ${v.candidateId}`);
    verdicts.set(`${v.run}:${v.candidateId}`, v);
  }
  for (const run of ADVERSARIES) {
    for (const entry of b.pool) {
      if (!verdicts.has(`${run.id}:${entry.candidateId}`)) throw new Error(`stage B has no ${run.id} verdict on pool candidate ${entry.candidateId}`);
    }
  }
  const verdictOf = (run: string, candidateId: string): StageBVerdict => verdicts.get(`${run}:${candidateId}`)!;

  const termMatch = new Map(b.termMatches.map((t) => [t.candidateId, t.termMatch]));
  for (const entry of b.pool) {
    if (!termMatch.has(entry.candidateId)) throw new Error(`stage B has no term check for pool candidate ${entry.candidateId}`);
  }

  const answers = new Map(ratings.answers.map((x) => [x.itemId, x]));
  const itemIds = new Set(ratings.items.map((i) => i.itemId));
  const reasonItems = ratings.items.filter((i): i is RatingItem & { kind: "reason" } => i.kind === "reason");
  const disagreementItems = ratings.items.filter((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement");
  const driftItems = ratings.items.filter((i): i is RatingItem & { kind: "drift" } => i.kind === "drift");
  for (const item of reasonItems) {
    if (!candidateById.has(item.candidateId)) throw new Error(`the rating names candidate ${item.candidateId}, which stage A doesn't have`);
  }
  for (const item of disagreementItems) {
    if (!poolIds.has(item.candidateId)) throw new Error(`the rating names disagreement ${item.candidateId}, which isn't in stage B's pool`);
  }
  for (const item of driftItems) {
    if (!itemIds.has(item.of)) throw new Error(`the rating's drift item ${item.itemId} repeats ${item.of}, which isn't in the plan`);
  }

  // Proposers: stage A, plus the reasons part of the rating.
  const reasons = reasonItems.map((item) => ({ candidate: candidateById.get(item.candidateId)!, answer: answers.get(item.itemId)! }));
  const proposers: Record<string, ProposerResults> = {};
  const samplesCurve: Record<string, Interval[]> = {};
  const goodReasons: Record<string, number> = {};
  for (const role of PROPOSERS) {
    const { results, curve, good } = proposerResults(a.proposers.find((x) => x.id === role.id)!, a, reasons);
    proposers[role.id] = results;
    samplesCurve[role.id] = curve;
    goodReasons[role.id] = good;
  }

  // Adversaries: stage B, plus the disagreements part of the rating.
  const ratedDisagreements = disagreementItems
    .map((item) => ({ item, answer: answers.get(item.itemId)! }))
    .filter((x) => x.answer.answer !== "skip");
  const adversaries: Record<string, AdversaryResults> = {};
  for (const role of ADVERSARIES) {
    const mine = b.pool.map((entry) => ({ entry, v: verdictOf(role.id, entry.candidateId) }));
    const judged = mine.filter((x) => argued(x.v));
    const calls = mine.filter((x) => x.v.model !== null);

    const right = ratedDisagreements.flatMap(({ item, answer }) => {
      const v = verdictOf(role.id, item.candidateId);
      if (!argued(v)) return [];
      return [{ findingId: candidateById.get(item.candidateId)!.findingId, value: broke(v) ? answer.answer === "no" : answer.answer === "yes" }];
    });

    const held = disagreementItems.flatMap((item) => {
      const v = verdictOf(role.id, item.candidateId);
      if (!broke(v) || !v.counter) return [];
      const said = answers.get(item.itemId)!.counters?.[counterIdOf(item.candidateId, v.counter)];
      if (said !== "yes" && said !== "no") return [];
      return [{ findingId: candidateById.get(item.candidateId)!.findingId, value: said === "yes" }];
    });

    const family = modelFamily(role);
    const sides = judged.map((x) => ({
      findingId: x.entry.findingId,
      value: { own: modelFamily(roleOf(PROPOSERS, x.entry.proposer)) === family, broke: broke(x.v) },
    }));
    const own = sides.filter((s) => s.value.own).map((s) => s.value.broke);
    const others = sides.filter((s) => !s.value.own).map((s) => s.value.broke);
    const gap =
      own.length > 0 && others.length > 0
        ? interval(byFinding(a.findingIds, sides), (xs) => share(xs.filter((x) => !x.own).map((x) => x.broke)) - share(xs.filter((x) => x.own).map((x) => x.broke)))
        : null;

    adversaries[role.id] = {
      judged: judged.length,
      breakRate: interval(byFinding(a.findingIds, judged.map((x) => ({ findingId: x.entry.findingId, value: broke(x.v) }))), share),
      unusable: count(mine, (x) => x.v.unusable !== null),
      refused: count(mine, (x) => x.v.stage === "safety"),
      calls: calls.length,
      costUsd: mine.reduce((sum, x) => sum + x.v.usage.costUsd, 0),
      tokens: mine.reduce((sum, x) => addUsage(sum, x.v.usage), NO_USAGE),
      secondsPerCall: calls.length === 0 ? null : calls.reduce((sum, x) => sum + x.v.ms, 0) / calls.length / 1000,
      rightOnDisagreements: interval(byFinding(a.findingIds, right), share),
      disagreementsRated: right.length,
      countersHeld: interval(byFinding(a.findingIds, held), share),
      countersRated: held.length,
      family: gap ? { own: share(own), others: share(others), gap } : null,
    };
  }

  // Agreement between every pair of runs, over the candidates both answered usably.
  const agreement: Record<string, Interval | null> = {};
  for (const [i, x] of ADVERSARIES.entries()) {
    for (const y of ADVERSARIES.slice(i + 1)) {
      const pairs = b.pool.flatMap((entry) => {
        const vx = verdictOf(x.id, entry.candidateId);
        const vy = verdictOf(y.id, entry.candidateId);
        if (vx.unusable !== null || vy.unusable !== null) return [];
        return [{ findingId: entry.findingId, value: [verdictLabel(vx), verdictLabel(vy)] as const }];
      });
      agreement[`${x.id}|${y.id}`] = interval(byFinding(a.findingIds, pairs), (sample) =>
        agreementOf(
          sample.map((p) => p[0]),
          sample.map((p) => p[1]),
        ),
      );
    }
  }

  // Rule 2: A3's extra breaks, the candidates A3 broke and A1 passed.
  const extra = (candidateId: string): boolean => broke(verdictOf(HIGH_RUN, candidateId)) && passedBy(verdictOf(MEDIUM_RUN, candidateId));
  const ratedExtra = ratedDisagreements.filter((x) => extra(x.item.candidateId));
  const extraBreaks = {
    inPool: count(b.pool, (e) => extra(e.candidateId)),
    rated: ratedExtra.length,
    right: count(ratedExtra, (x) => x.answer.answer === "no"),
  };

  // Rule 6: every break, across every run, and whether it landed on a shown reason.
  const shownRank = passingRanks(a.candidates);
  const breaks = b.verdicts.filter(broke).map((v) => ({
    findingId: candidateById.get(v.candidateId)!.findingId,
    value: shownRank.get(v.candidateId)! < PUBLISHED_CAP,
  }));
  const shownBreaks = {
    breaks: breaks.length,
    shown: count(breaks, (x) => x.value),
    share: interval(byFinding(a.findingIds, breaks), share),
  };

  // Policy against the private terms, both ways: counts and candidate ids, never a term or a text.
  const byRun: Record<string, SafetyByRun> = {};
  for (const role of ADVERSARIES) {
    const mine = b.pool.map((entry) => ({ matched: termMatch.get(entry.candidateId)!, v: verdictOf(role.id, entry.candidateId) }));
    const stops = mine.filter((x) => x.v.stage === "safety");
    byRun[role.id] = {
      refused: stops.length,
      categories: tally(stops.map((x) => x.v.category ?? "unknown")),
      refusedWithoutTerm: count(stops, (x) => !x.matched),
      termButPassed: count(mine, (x) => x.matched && argued(x.v)),
    };
  }
  const policyMisses = b.pool
    .filter((entry) => termMatch.get(entry.candidateId))
    .map((entry) => ({
      candidateId: entry.candidateId,
      category: "terms" as const,
      runs: ADVERSARIES.filter((r) => argued(verdictOf(r.id, entry.candidateId))).map((r) => r.id),
    }))
    .filter((miss) => miss.runs.length > 0);

  // The drift check: each repeat against its original, skips left out.
  const driftPairs = driftItems.flatMap((item) => {
    const before = answers.get(item.of)!.answer;
    const after = answers.get(item.itemId)!.answer;
    return before === "skip" || after === "skip" ? [] : [[before, after] as const];
  });

  const measured: Omit<Results, "decisions"> = {
    measuredAt: now.toISOString(),
    seed: PILOT_SEED,
    findings: a.findingIds.length,
    poolByProposer: Object.fromEntries(PROPOSERS.map((p) => [p.id, count(b.pool, (e) => e.proposer === p.id)])),
    proposers,
    adversaries,
    agreement,
    noiseFloor: agreement[`${MEDIUM_RUN}|${REPEAT_RUN}`] ?? null,
    extraBreaks,
    samplesCurve,
    goodReasons,
    shownBreaks,
    safety: { termsMatched: count(b.pool, (e) => termMatch.get(e.candidateId)!), byRun, policyMisses },
    drift: {
      kappa:
        driftPairs.length === 0
          ? null
          : agreementOf(
              driftPairs.map((p) => p[0]),
              driftPairs.map((p) => p[1]),
            ),
      n: driftPairs.length,
    },
  };
  return { ...measured, decisions: decide(measured) };
}

// ---------------------------------------------------------------------------------------
// The decisions
// ---------------------------------------------------------------------------------------

const MODEL_NAMES: Record<string, string> = {
  haiku: "Haiku 4.5",
  sonnet: "Sonnet 5",
  opus: "Opus 5.5",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
};

/** A setup's model as the write-up names it. */
export function modelName(role: PilotRole): string {
  return MODEL_NAMES[role.model] ?? role.model;
}

/** A setup's effort as the preregistration's tables give it. */
export function effortName(role: PilotRole): string {
  if (role.effort) return role.effort;
  return role.transport === "gemini" ? "its own default" : "none";
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const two = (x: number): string => x.toFixed(2);
const points = (x: number): string => String(Math.round(x * 100));
const list = (ids: string[]): string => (ids.length <= 1 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`);

/** A share as the preregistration writes it ("2 in 3"), when it's a simple fraction; a percentage otherwise. */
function asFraction(x: number): string {
  for (let d = 2; d <= 12; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < EPS) return `${n} in ${d}`;
  }
  return pct(x);
}

/** Whether a kappa sits within `KAPPA_MARGIN` of the noise floor, either side, inclusive; never when either one can't be measured. */
function nearFloor(kappa: Interval | null | undefined, floor: Interval | null): boolean {
  return !!kappa && !!floor && Math.abs(kappa.value - floor.value) <= KAPPA_MARGIN + EPS;
}

/** Rule 1: the cheapest setup whose yes rate sits within `PROPOSER_MARGIN` of the best. */
function ruleProposer(r: Omit<Results, "decisions">): Decision {
  const rule = "1. Proposer";
  const rated = PROPOSERS.filter((p) => r.proposers[p.id]?.yesRate).map((p) => p.id);
  if (rated.length === 0) throw new Error("rule 1 can't choose a proposer: no setup has a reason rated yes or no");
  const rate = (id: string) => r.proposers[id]!.yesRate!.value;
  const cost = (id: string) => r.proposers[id]!.costUsd;
  const order = (id: string) => PROPOSERS.findIndex((p) => p.id === id);

  const best = Math.max(...rated.map(rate));
  const leaders = rated.filter((id) => rate(id) === best);
  const within = rated.filter((id) => best - rate(id) <= PROPOSER_MARGIN + EPS);
  // Cheapest first; a tie on cost goes to the higher yes rate, then to setup order.
  const [chosen, next] = [...within].sort((x, y) => cost(x) - cost(y) || rate(y) - rate(x) || order(x) - order(y));
  const unrated = PROPOSERS.map((p) => p.id).filter((id) => !rated.includes(id));

  const parts = [
    `Best yes rate: ${pct(best)} (${list(leaders)}).`,
    `Within ${points(PROPOSER_MARGIN)} points of it: ${within.map((id) => `${id} at ${usd(cost(id))}`).join(", ")}.`,
    `Cheapest of those: ${chosen}${next !== undefined && cost(next) === cost(chosen!) ? `, tied on cost with ${next} and ${rate(next) === rate(chosen!) ? "first in setup order" : "ahead on yes rate"}` : ""}.`,
  ];
  if (unrated.length > 0) parts.push(`${list(unrated)} had no rated reason, so ${unrated.length === 1 ? "it wasn't" : "they weren't"} in the running.`);
  return { choice: chosen!, rule, because: parts.join(" "), metBar: true };
}

/** Rule 2: medium unless A3 strays from the noise floor and its extra breaks were right often enough. */
function ruleEffort(r: Omit<Results, "decisions">): Decision {
  const rule = "2. Adversary effort";
  const kappa = r.agreement[`${MEDIUM_RUN}|${HIGH_RUN}`] ?? null;
  const floor = r.noiseFloor;
  if (nearFloor(kappa, floor)) {
    return {
      choice: "medium",
      rule,
      because: `${HIGH_RUN}'s kappa with ${MEDIUM_RUN}, ${two(kappa!.value)}, is within ${KAPPA_MARGIN} of the noise floor, ${two(floor!.value)}.`,
      metBar: true,
    };
  }
  if (!kappa || !floor) {
    const missing = !kappa && !floor ? `${HIGH_RUN}'s kappa with ${MEDIUM_RUN} and the noise floor` : kappa ? "The noise floor" : `${HIGH_RUN}'s kappa with ${MEDIUM_RUN}`;
    return { choice: "medium", rule, because: `${missing} can't be measured, so medium stays.`, metBar: true };
  }
  const lead = `${HIGH_RUN}'s kappa with ${MEDIUM_RUN}, ${two(kappa.value)}, is more than ${KAPPA_MARGIN} from the noise floor, ${two(floor.value)}`;
  const { rated, right } = r.extraBreaks;
  const bar = asFraction(HIGH_EFFORT_RIGHT_SHARE);
  if (rated === 0) {
    return { choice: "medium", rule, because: `${lead}, and none of ${HIGH_RUN}'s extra breaks got rated, so high effort can't show it's worth the cost.`, metBar: true };
  }
  const high = right / rated >= HIGH_EFFORT_RIGHT_SHARE - EPS;
  return {
    choice: high ? "high" : "medium",
    rule,
    because: `${lead}. The owner judged ${right} of ${HIGH_RUN}'s ${rated} rated extra breaks right, ${high ? "at least" : "under"} ${bar}.`,
    metBar: true,
  };
}

/**
 * Rule 3, the whole chain: A4 and A5 qualify on kappa and rightness; A5 has to fit the full
 * run in `A5_MAX_HOURS` one call at a time, or it counts as not qualifying; a qualifier
 * sharing the proposer's model is skipped; of what's left, the more right wins, a tie going
 * to A5. With nothing left, the Opus run rule 2 chose keeps the job, unless it's the
 * proposer's own model: then the more right of A4 and A5 takes it, qualifying or not (a tie
 * to A5, an A5 pick too slow for the full run going to A4), and the decision says it didn't
 * meet the rule's own bar.
 */
function ruleAdversary(r: Omit<Results, "decisions">, proposerId: string, effort: string): Decision {
  const rule = "3. Adversary model";
  const opusRun = effort === "high" ? HIGH_RUN : MEDIUM_RUN;
  const proposer = roleOf(PROPOSERS, proposerId);
  const right = (id: string): number | null => r.adversaries[id]?.rightOnDisagreements?.value ?? null;
  const seconds = (id: string): number | null => r.adversaries[id]?.secondsPerCall ?? null;
  const fits = (id: string): boolean => {
    if (id !== SPEED_CHECKED) return true;
    const s = seconds(id);
    return s !== null && hoursFor(s) <= A5_MAX_HOURS;
  };
  /** Why a run fails the speed check, to follow its id. */
  const tooSlow = (id: string): string => {
    const s = seconds(id);
    const calls = FULL_RUN_ADVERSARY_CALLS.toLocaleString("en-US");
    return s === null
      ? `has no answered call to time, so it can't show ${calls} calls fit in ${A5_MAX_HOURS} hours`
      : `would take ${Math.round(hoursFor(s))} hours for ${calls} calls one at a time, over ${A5_MAX_HOURS}`;
  };
  const rightText = (id: string): string => {
    const x = right(id);
    return x === null ? `${id} has no rated disagreement it argued` : `${id} is right on ${pct(x)} of the rated disagreements`;
  };
  /** Whether `x` and `y` are equally right; 2 runs with no rightness at all count as a tie too. */
  const tied = (x: string, y: string): boolean => {
    const rx = right(x);
    const ry = right(y);
    return rx === ry || (rx !== null && ry !== null && Math.abs(rx - ry) <= EPS);
  };
  /** The more right of `x` and `y`; a run with no rightness ranks below one with any, and a tie goes to A5. */
  const moreRight = (x: string, y: string): string => {
    if (tied(x, y)) return [x, y].includes(TIE_GOES_TO) ? TIE_GOES_TO : x;
    return (right(x) ?? -Infinity) > (right(y) ?? -Infinity) ? x : y;
  };

  const notes: string[] = [];
  const standing: string[] = [];
  for (const id of CHALLENGERS) {
    const kappa = r.agreement[`${MEDIUM_RUN}|${id}`] ?? null;
    if (!nearFloor(kappa, r.noiseFloor)) {
      notes.push(
        kappa && r.noiseFloor
          ? `${id}'s kappa with ${MEDIUM_RUN}, ${two(kappa.value)}, is more than ${KAPPA_MARGIN} from the noise floor, ${two(r.noiseFloor.value)}.`
          : `${id} has no kappa with ${MEDIUM_RUN} to set against the noise floor.`,
      );
      continue;
    }
    const mine = right(id);
    const theirs = right(opusRun);
    if (mine === null || theirs === null || mine < theirs - EPS) {
      notes.push(
        mine === null
          ? `${rightText(id)}, so it can't show it's as right as ${opusRun}.`
          : `${rightText(id)}${theirs === null ? `, and ${opusRun} has none to compare` : `, against ${opusRun}'s ${pct(theirs)}`}, so it doesn't qualify.`,
      );
      continue;
    }
    if (!fits(id)) {
      notes.push(`${id} qualifies on kappa and rightness, but ${tooSlow(id)}, which counts as not qualifying.`);
      continue;
    }
    const role = roleOf(ADVERSARIES, id);
    if (sameModel(role, proposer)) {
      notes.push(`${id} qualifies, but it's ${modelName(role)}, the proposer's own model, so it's skipped.`);
      continue;
    }
    notes.push(`${id} qualifies: kappa ${two(kappa!.value)}, right on ${pct(mine)} against ${opusRun}'s ${pct(theirs)}.`);
    standing.push(id);
  }

  if (standing.length > 0) {
    const chosen = standing.length === 1 ? standing[0]! : moreRight(standing[0]!, standing[1]!);
    const how = standing.length === 1 ? "" : tied(standing[0]!, standing[1]!) ? `, a tie going to ${TIE_GOES_TO}` : ", right more often";
    return { choice: chosen, rule, because: `${notes.join(" ")} ${chosen} takes the job${how}.`, metBar: true };
  }

  const opus = roleOf(ADVERSARIES, opusRun);
  if (!sameModel(opus, proposer)) {
    return { choice: opusRun, rule, because: `${notes.join(" ")} Nothing's left standing, so ${opusRun} keeps the job.`, metBar: true };
  }

  const left = CHALLENGERS.filter((id) => !sameModel(roleOf(ADVERSARIES, id), proposer));
  if (left.length === 0) throw new Error("rule 3: every adversary shares the proposer's model");
  const pick = left.length === 1 ? left[0]! : moreRight(left[0]!, left[1]!);
  const chosen = fits(pick) ? pick : TOO_SLOW_GOES_TO;
  const slowNote = chosen === pick ? "" : ` ${pick} ${tooSlow(pick)}, so the job goes to ${TOO_SLOW_GOES_TO}.`;
  return {
    choice: chosen,
    rule,
    because: `${notes.join(" ")} Nothing's left standing, and ${opusRun} runs ${modelName(opus)}, the proposer's own model, so the job goes to the more right of ${list(left)}, qualifying or not: ${pick}.${slowNote} ${chosen} didn't meet this rule's own bar.`,
    metBar: false,
  };
}

/** Rule 4: measured and reported, never a choice: the setup already keeps the adversary off the proposer's own model. */
function ruleSelfPreference(r: Omit<Results, "decisions">): Decision {
  const flagged = ADVERSARIES.filter((x) => {
    const family = r.adversaries[x.id]?.family;
    return family !== null && family !== undefined && family.gap.value >= SELF_PREFERENCE_GAP - EPS;
  }).map((x) => x.id);
  const without = ADVERSARIES.filter((x) => !r.adversaries[x.id]?.family).map((x) => x.id);
  const gap = points(SELF_PREFERENCE_GAP);
  const parts = [
    flagged.length > 0
      ? `${list(flagged)} broke ${flagged.length === 1 ? "its" : "their"} own family's reasons at least ${gap} points less often than everyone else's.`
      : `No run broke its own family's reasons at least ${gap} points less often than everyone else's.`,
  ];
  if (without.length > 0) parts.push(`${list(without)} had no reason from ${without.length === 1 ? "its" : "their"} own family to argue with.`);
  parts.push("Reported only: the setup already keeps the adversary off the proposer's own model.");
  return { choice: "no change", rule: "4. Self-preference", because: parts.join(" "), metBar: true };
}

/** Rule 5: the fewest samples that still find `SAMPLES_SHARE` of the chosen proposer's good reasons. */
function ruleSamples(r: Omit<Results, "decisions">, proposerId: string): Decision {
  const rule = "5. Samples";
  const curve = r.samplesCurve[proposerId] ?? [];
  const good = r.goodReasons[proposerId] ?? 0;
  if (curve.length === 0) {
    return {
      choice: String(MAX_SAMPLES),
      rule,
      because: `${proposerId} has no reason rated good, so there's no share of them to find, and the pipeline's own ${MAX_SAMPLES} samples stay.`,
      metBar: true,
    };
  }
  const first = (n: number) => (n === 1 ? "the first sample finds" : `the first ${n} samples find`);
  for (let n = MIN_SAMPLES; n <= MAX_SAMPLES; n++) {
    const found = curve[n - 1];
    if (!found || found.value < SAMPLES_SHARE - EPS) continue;
    const before = n > MIN_SAMPLES ? curve[n - 2] : undefined;
    const tail = before ? ` With one fewer, ${first(n - 1)} ${pct(before.value)}.` : "";
    return {
      choice: String(n),
      rule,
      because: `Of ${proposerId}'s ${good} reasons rated good, ${first(n)} ${pct(found.value)}, at least ${pct(SAMPLES_SHARE)}.${tail}`,
      metBar: true,
    };
  }
  throw new Error(`rule 5: ${proposerId}'s samples curve never reaches ${pct(SAMPLES_SHARE)}`);
}

/** Rule 6: attack only the shown reasons once `SHOWN_BREAKS_SHARE` of every break lands on them. */
function ruleShownOnly(r: Omit<Results, "decisions">): Decision {
  const rule = "6. Attacking only the shown reasons";
  const { breaks, shown, share: landed } = r.shownBreaks;
  if (!landed) return { choice: "off", rule, because: "No run broke anything, so there's no break to count, and it stays off.", metBar: true };
  const on = landed.value >= SHOWN_BREAKS_SHARE - EPS;
  return {
    choice: on ? "on" : "off",
    rule,
    because: `${shown} of ${breaks} breaks (${pct(landed.value)}) landed on the top ${PUBLISHED_CAP} reasons a page would show, ${on ? "at least" : "under"} ${pct(SHOWN_BREAKS_SHARE)}.`,
    metBar: true,
  };
}

/** The 6 preregistered rules, in order, on point estimates, and nothing else. */
export function decide(r: Omit<Results, "decisions">): Decisions {
  const proposer = ruleProposer(r);
  const adversaryEffort = ruleEffort(r);
  return {
    proposer,
    adversaryEffort,
    adversaryModel: ruleAdversary(r, proposer.choice, adversaryEffort.choice),
    selfPreference: ruleSelfPreference(r),
    samples: ruleSamples(r, proposer.choice),
    attackShownOnly: ruleShownOnly(r),
  };
}

/** The setup the full run reads, from the decisions: `previous` only lends it anything the rules don't set. */
export function setupFrom(r: Results, previous: Setup): Setup {
  const plain = (role: PilotRole): Role => ({ transport: role.transport, model: role.model, ...(role.effort ? { effort: role.effort } : {}) });
  return parseSetup({
    ...previous,
    propose: { ...plain(roleOf(PROPOSERS, r.decisions.proposer.choice)), samples: Number(r.decisions.samples.choice) },
    falsify: plain(roleOf(ADVERSARIES, r.decisions.adversaryModel.choice)),
    attackShownOnly: r.decisions.attackShownOnly.choice === "on",
    decidedBy: RESULTS_PATH,
  });
}

// ---------------------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------------------

const cells = (values: (string | number)[]): string => `| ${values.join(" | ")} |`;
const header = (names: string[]): string[] => [cells(names), cells(names.map(() => "---"))];
const pctRange = (x: Interval | null): string => (x ? `${pct(x.value)} (${Math.round(x.low * 100)} to ${pct(x.high)})` : "none");
const numRange = (x: Interval | null, digits = 2): string => (x ? `${x.value.toFixed(digits)} (${x.low.toFixed(digits)} to ${x.high.toFixed(digits)})` : "none");
const counts = (record: Record<string, number>): string => {
  const entries = Object.entries(record).filter(([, n]) => n > 0);
  return entries.length === 0 ? "none" : entries.map(([key, n]) => `${key} ${n}`).join(", ");
};
const seconds = (x: number | null): string => (x === null ? "none" : x.toFixed(1));
const setupName = (role: PilotRole): string => (role.effort ? `${modelName(role)}, ${role.effort}` : modelName(role));

/** The markdown the README carries between its results markers: every measure beside its interval, then each decision and why. */
export function tables(r: Results): string {
  const out: string[] = [];
  const pool = Object.values(r.poolByProposer).reduce((sum, n) => sum + n, 0);

  out.push("### Proposers", "");
  out.push(`${r.findings} findings, ${MAX_SAMPLES} samples each. Every interval is ${pct(CONFIDENCE)}, from ${BOOTSTRAP_ROUNDS.toLocaleString("en-US")} bootstrap rounds over the findings.`, "");
  out.push(...header(["Setup", "Model", "Effort", "Reasons", "Tests passed", "Refused", "Missing", "Usable answers", "Reasons per finding", "Entropy", "Links consistent", "Safety drops"]));
  for (const role of PROPOSERS) {
    const p = r.proposers[role.id]!;
    out.push(
      cells([
        role.id,
        modelName(role),
        effortName(role),
        p.candidates,
        pctRange(p.passed),
        counts(p.refused),
        p.missing,
        pctRange(p.usable),
        numRange(p.distinctPerFinding, 1),
        numRange(p.entropy),
        `${p.linksConsistent} of ${p.linksProposed}`,
        counts(p.safetyDrops),
      ]),
    );
  }
  out.push("");
  out.push(...header(["Setup", "Yes rate", "Rated", "Cost at list price", "Tokens in", "Tokens out", "Seconds per call"]));
  for (const role of PROPOSERS) {
    const p = r.proposers[role.id]!;
    out.push(cells([role.id, pctRange(p.yesRate), p.rated, usd(p.costUsd), compactCount(inputOf(p.tokens)), compactCount(p.tokens.output), seconds(p.secondsPerCall)]));
  }

  out.push("", "### Adversaries", "");
  out.push(`The pool: ${pool} candidates, ${PROPOSERS.map((p) => `${r.poolByProposer[p.id] ?? 0} from ${p.id}`).join(", ")}.`, "");
  out.push(...header(["Run", "Model", "Effort", "Break rate", "Argued", "Unusable", "Policy stops", "Right on disagreements", "Counter-tests upheld"]));
  for (const role of ADVERSARIES) {
    const x = r.adversaries[role.id]!;
    out.push(
      cells([
        role.id,
        modelName(role),
        effortName(role),
        pctRange(x.breakRate),
        x.judged,
        x.unusable,
        x.refused,
        `${pctRange(x.rightOnDisagreements)}, n ${x.disagreementsRated}`,
        `${pctRange(x.countersHeld)}, n ${x.countersRated}`,
      ]),
    );
  }
  out.push("");
  out.push(...header(["Run", "Own family's reasons broken", "Everyone else's", "Gap", "Cost at list price", "Tokens in", "Tokens out", "Seconds per call"]));
  for (const role of ADVERSARIES) {
    const x = r.adversaries[role.id]!;
    const family = x.family;
    out.push(
      cells([
        role.id,
        family ? pct(family.own) : "none",
        family ? pct(family.others) : "none",
        family ? `${points(family.gap.value)} points (${points(family.gap.low)} to ${points(family.gap.high)})` : "none",
        usd(x.costUsd),
        compactCount(inputOf(x.tokens)),
        compactCount(x.tokens.output),
        seconds(x.secondsPerCall),
      ]),
    );
  }
  out.push("", `${HIGH_RUN}'s extra breaks, the candidates it broke and ${MEDIUM_RUN} passed: ${r.extraBreaks.inPool} in the pool, ${r.extraBreaks.rated} rated, ${r.extraBreaks.right} of those judged right.`);

  out.push("", "### Agreement", "");
  out.push(
    `Agreement between each pair of runs, over the candidates both answered usably: Cohen's kappa, or 1 when the 2 runs agree on every candidate. ${MEDIUM_RUN} and ${REPEAT_RUN} are the same setup run twice, so their agreement is the noise floor: ${numRange(r.noiseFloor)}.`,
    "",
  );
  out.push(...header(["Run", ...ADVERSARIES.map((x) => x.id)]));
  for (const [i, row] of ADVERSARIES.entries()) {
    out.push(
      cells([
        row.id,
        ...ADVERSARIES.map((col, j) => {
          if (i === j) return "";
          const key = i < j ? `${row.id}|${col.id}` : `${col.id}|${row.id}`;
          return numRange(r.agreement[key] ?? null);
        }),
      ]),
    );
  }

  out.push("", "### Samples", "");
  out.push("The share of each setup's reasons rated good that its first samples already find.", "");
  out.push(...header(["Setup", "Rated good", ...Array.from({ length: MAX_SAMPLES }, (_, i) => (i === 0 ? "1 sample" : `${i + 1} samples`))]));
  for (const role of PROPOSERS) {
    const curve = r.samplesCurve[role.id] ?? [];
    out.push(cells([role.id, r.goodReasons[role.id] ?? 0, ...Array.from({ length: MAX_SAMPLES }, (_, i) => pctRange(curve[i] ?? null))]));
  }

  out.push("", "### Shown reasons", "");
  out.push(
    `${r.shownBreaks.shown} of ${r.shownBreaks.breaks} breaks across every run landed on the top ${PUBLISHED_CAP} reasons a page would show, by support among the ones that passed their data test: ${pctRange(r.shownBreaks.share)}.`,
  );

  out.push("", "### Safety", "");
  out.push(`${r.safety.termsMatched} of the pool's candidates matched a private term.`, "");
  out.push(...header(["Run", "Policy stops", "By category", "Stopped with no term matched", "Term matched, argued anyway"]));
  for (const role of ADVERSARIES) {
    const s = r.safety.byRun[role.id]!;
    out.push(cells([role.id, s.refused, counts(s.categories), s.refusedWithoutTerm, s.termButPassed]));
  }
  if (r.safety.policyMisses.length > 0) {
    out.push("", "Argued with a private term matched, by candidate id and category, with the runs that passed it:", "");
    for (const miss of r.safety.policyMisses) out.push(`- \`${miss.candidateId}\` (${miss.category}): ${miss.runs.join(", ")}`);
  }

  out.push("", "### Drift", "");
  out.push(
    r.drift.kappa === null
      ? "No item rated twice had an answer both times."
      : `The owner's kappa with their own earlier answers, on ${r.drift.n} items rated twice: ${two(r.drift.kappa)}.`,
  );

  out.push("", "### Decisions", "");
  out.push(...header(["Rule", "Choice", "Why"]));
  const choiceName = (key: keyof Decisions, d: Decision): string => {
    if (key === "proposer") return `${d.choice} (${setupName(roleOf(PROPOSERS, d.choice))})`;
    if (key === "adversaryModel") return `${d.choice} (${setupName(roleOf(ADVERSARIES, d.choice))})`;
    return d.choice;
  };
  for (const [key, d] of Object.entries(r.decisions) as [keyof Decisions, Decision][]) {
    out.push(cells([d.rule, `${choiceName(key, d)}${d.metBar ? "" : ", below the rule's own bar"}`, d.because]));
  }
  return out.join("\n");
}

/** `readme` with only what sits between its results markers replaced by `md`. */
export function withResults(readme: string, md: string): string {
  const start = readme.indexOf(RESULTS_START);
  const end = readme.indexOf(RESULTS_END);
  if (start < 0 || end < 0 || end < start) throw new Error(`the README needs ${RESULTS_START} and then ${RESULTS_END} around its results`);
  return `${readme.slice(0, start + RESULTS_START.length)}\n\n${md.trim()}\n\n${readme.slice(end)}`;
}

/** Whether a parsed `ratings.json` has the 2 lists every later step reads. */
function isRatingsShape(value: unknown): value is Ratings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const { items, answers } = value as { items?: unknown; answers?: unknown };
  return Array.isArray(items) && Array.isArray(answers);
}

export interface AnalysisPaths {
  stageA: string;
  stageB: string;
  ratings: string;
  results: string;
  readme: string;
  setup: string;
}

export const ANALYSIS_PATHS: AnalysisPaths = {
  stageA: STAGE_A_PATH,
  stageB: STAGE_B_PATH,
  ratings: RATINGS_PATH,
  results: RESULTS_PATH,
  readme: README_PATH,
  setup: SETUP_PATH,
};

/**
 * Reads the stage files and the rating, and only once the rating is finished and everything
 * has been computed and checked (the analysis, the README's markers, the new setup against
 * `parseSetup`) writes the results, the README and the setup, each with a temp-and-rename
 * write. Anything wrong before that point writes nothing at all. Returns whether it wrote.
 */
export async function runAnalysis(paths: AnalysisPaths, io: { log: (line: string) => void; error: (line: string) => void }, now: Date = new Date()): Promise<boolean> {
  const stages = await readStageFiles(paths.stageA, paths.stageB);
  if (!stages.ok) {
    io.error(stages.message);
    return false;
  }

  let ratings: Ratings;
  try {
    const parsed: unknown = JSON.parse(await readFile(paths.ratings, "utf8"));
    if (!isRatingsShape(parsed)) {
      io.error(`${paths.ratings} isn't a rating: it needs an "items" list and an "answers" list`);
      return false;
    }
    ratings = parsed;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    io.error(missing ? "the rating hasn't started: run `pnpm insights:pilot:rate` first" : `couldn't read ${paths.ratings}: ${messageOf(error)}`);
    return false;
  }
  const unfinished = unfinishedRating(ratings);
  if (unfinished) {
    io.error(unfinished);
    return false;
  }

  let results: Results;
  let readme: string;
  let setup: Setup;
  try {
    results = analyse(stages.a, stages.b, ratings, now);
    readme = withResults(await readFile(paths.readme, "utf8"), tables(results));
    setup = setupFrom(results, parseSetup(JSON.parse(await readFile(paths.setup, "utf8"))));
  } catch (error) {
    io.error(`nothing written: ${messageOf(error)}`);
    return false;
  }

  await writeJsonAtomic(paths.results, results);
  await writeTextAtomic(paths.readme, readme);
  await writeTextAtomic(paths.setup, formatSetup(setup));
  for (const d of Object.values(results.decisions)) io.log(`${d.rule}: ${d.choice}${d.metBar ? "" : " (below the rule's own bar)"}`);
  io.log(`wrote ${paths.results}, ${paths.readme} and ${paths.setup}`);
  return true;
}

// Runs the analysis when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const ok = await runAnalysis(ANALYSIS_PATHS, { log: (line) => console.log(line), error: (line) => console.error(line) });
  if (!ok) process.exitCode = 1;
}
