/**
 * Stage A: each of the pilot's 4 proposer setups (`PROPOSERS`) is asked the pipeline's own
 * proposer question on the same findings, `SAMPLES` samples each, exactly as `propose()` does
 * for the full pipeline. Every candidate keeps which proposer and finding it came from, which
 * samples proposed it, propose's own rank for it (support, then first proposed), its own data
 * test's outcome and, only when that test passed and its link test is about the finding
 * (`aboutThisFinding`), a link verdict, judged with `judgeLinks` across that proposer's own
 * candidates only, never mixed with another proposer's.
 *
 * A halt is shared across every proposer and finding, the pilot's own version of `run.ts`'s
 * `stopAfterFailures`: a fatal error, a `LimitError` (`withRetries` has already waited that
 * one out), or `STOP_AFTER_FAILURES` failures in a row sets it, and once set every later call
 * fails at once without touching the real transport again. After each proposer's own
 * `mapPool` finishes, `runStageA` checks the halt and throws with its reason if it's set, so
 * this never returns a partial result: the answers already cached stay there for a resumed
 * run to reuse. A stage this size runs unattended for hours, so it has to stop clearly rather
 * than write a complete-looking file over a run that never really finished.
 *
 * Resuming must not re-ask a question the model already answered, even one that came back
 * unusable: `propose()`'s own `accept` keeps `makeRunner` from caching an answer it can't
 * read, which is right for the full pipeline (a fresh run gets another try) but wrong for a
 * fixed, reproducible pilot sample. Stage A's own wrapper strips `accept` before the call
 * reaches the cache, so every answer, good or bad, is cached once and replayed identically on
 * a re-run, rather than asked again and possibly answered differently the second time.
 *
 * Proposers run one after another, each over its findings `options.concurrency` at a time
 * through `mapPool`, which hands results back in finding order regardless of when they
 * finish. The candidates collected across findings and proposers are sorted again at the end
 * (proposer order, then finding order, then propose's own rank), a documented guarantee of
 * the output rather than something left to how today's loops happen to build it.
 */
import type { Data } from "../data.ts";
import { detect, type Finding } from "../detect.ts";
import { falsify, NO_ANSWER, UNREADABLE, type Verdict } from "../falsify.ts";
import { addUsage, classify, LimitError, messageOf, NO_USAGE, type Runner, type Usage } from "../model.ts";
import { mapPool } from "../pool.ts";
import { propose, type Candidate, type Proposal } from "../propose.ts";
import { judgeLinks, runLink } from "../links.ts";
import { aboutThisFinding, linkSeed, STOP_AFTER_FAILURES, type LinkResult } from "../run.ts";
import { refusal } from "../safety.ts";
import { evaluate, type Check, type Outcome } from "../vocabulary.ts";
import { candidateIdOf, samplePool, type PoolEntry } from "./sample.ts";
import { ADVERSARIES, PILOT_SEED, POOL_PER_PROPOSER, PROPOSERS, type PilotRole } from "./setups.ts";

export interface StageACandidate {
  candidateId: string;
  proposer: string;
  findingId: string;
  candidate: Candidate;
  sampleIndexes: number[]; // which of the samples proposed it
  rank: number; // its index in propose()'s own order for this finding: support, then first proposed
  outcome: Outcome;
  passed: boolean; // the data test
  link: LinkResult | null;
}

export interface StageAProposer {
  id: string;
  role: PilotRole;
  replies: Proposal["replies"]; // every sample's reply, across every finding this proposer saw
  unusable: Record<string, number>; // samples that gave no valid hypothesis at all, by finding id
  failed: number; // calls that threw, summed across findings
  safetyDrops: Record<string, number>; // hypotheses the safety check dropped, by category, summed across findings
  entropy: Record<string, number>; // this proposer's semantic entropy on each finding, keyed by finding id
  usage: Usage; // every call's tokens and cost, summed
  ms: number; // every call's own answering time, summed, waits for a retry or a limit left out
  waitedMs: number; // every call's own wait for a retry or a limit, summed
  answered: string[]; // every resolved model id (`reply.model`) a reply came back with, sorted and distinct
}

export interface StageA {
  seed: number;
  findingIds: string[];
  proposers: StageAProposer[];
  candidates: StageACandidate[];
}

/** One finding's share of one proposer's run, kept whole so it can be combined in finding order once `mapPool` is done. */
interface FindingResult {
  replies: Proposal["replies"];
  unusable: number;
  refusals: Record<string, number>;
  entropy: number;
  candidates: StageACandidate[];
}

/**
 * Runs every proposer in `PROPOSERS` on the same `findings`, one proposer after another,
 * each finding's own 5 calls made through `runners.get(role.id)`. `options.onCandidates`,
 * when given, is called once a finding is done for a proposer, with how many candidates it
 * gave, so a caller can print progress without this function knowing how to print anything.
 *
 * Throws when a proposer is missing from `runners` (checked before the first call, so a
 * missing setup is never discovered only after the ones before it in `PROPOSERS` have
 * already spent real calls) or when the shared halt trips (see the file's own comment).
 */
export async function runStageA(
  data: Data,
  findings: Finding[],
  runners: Map<string, Runner>,
  options: { concurrency: number; terms: RegExp | null; onCandidates?: (proposer: string, findingId: string, count: number) => void },
): Promise<StageA> {
  const missing = PROPOSERS.filter((p) => !runners.has(p.id)).map((p) => p.id);
  if (missing.length > 0) {
    throw new Error(`runStageA: no runner for proposer${missing.length > 1 ? "s" : ""} ${missing.map((id) => `"${id}"`).join(", ")}`);
  }

  const findingById = new Map(findings.map((f) => [f.id, f]));
  const proposers: StageAProposer[] = [];
  const candidates: StageACandidate[] = [];

  // Shared across every proposer and finding: a subscription's own limit, or a missing
  // binary, means nothing later stands a better chance either.
  const halt: { reason: string | null } = { reason: null };
  let inARow = 0;

  for (const role of PROPOSERS) {
    const runner = runners.get(role.id)!;

    const spent = { usage: NO_USAGE, ms: 0, waitedMs: 0 };
    let failed = 0;
    const tracked: Runner = async (call) => {
      if (halt.reason) throw new Error(halt.reason);
      try {
        // Stripped of `accept`, so an answer that comes back unusable is still cached and
        // replayed exactly on a resumed run, rather than asked again every time.
        const reply = await runner({ ...call, accept: undefined });
        spent.usage = addUsage(spent.usage, reply.usage);
        spent.ms += reply.ms;
        spent.waitedMs += reply.waitedMs;
        inARow = 0;
        return reply;
      } catch (error) {
        failed++;
        if (classify(error) === "fatal") {
          halt.reason = `a proposer call failed: ${messageOf(error)}`;
        } else if (error instanceof LimitError) {
          halt.reason = `a proposer's usage limit didn't reset in time: ${messageOf(error)}`;
        } else {
          inARow++;
          if (inARow >= STOP_AFTER_FAILURES) {
            halt.reason = `${STOP_AFTER_FAILURES} proposer calls in a row failed, the last with: ${messageOf(error)}`;
          }
        }
        throw error;
      }
    };

    const oneFinding = async (finding: Finding): Promise<FindingResult> => {
      const proposal = await propose(finding, data, tracked, role, options.terms);
      const findingCandidates: StageACandidate[] = proposal.candidates.map((candidate, rank) => {
        const candidateId = candidateIdOf(finding.id, role.id, candidate.test);
        const outcome = evaluate(candidate.test, finding, data);
        return {
          candidateId,
          proposer: role.id,
          findingId: finding.id,
          candidate,
          sampleIndexes: candidate.samples,
          rank,
          outcome,
          passed: outcome.status === "passed",
          link: null,
        };
      });
      // Suppressed once the halt is set: a finding whose propose() call was aborted mid-way
      // gives no real count worth printing, and would otherwise read as a misleading "0
      // candidates" line printed after the run is already stopping.
      if (!halt.reason) options.onCandidates?.(role.id, finding.id, findingCandidates.length);
      return {
        replies: proposal.replies,
        unusable: proposal.unusable,
        refusals: proposal.refusals,
        entropy: proposal.entropy,
        candidates: findingCandidates,
      };
    };

    const results = await mapPool(findings, options.concurrency, oneFinding);
    // Nothing partial is ever returned: the answers already cached stay there for a resumed
    // run to pick straight back up from.
    if (halt.reason) throw new Error(halt.reason);

    const replies: Proposal["replies"] = [];
    const safetyDrops: Record<string, number> = {};
    const entropy: Record<string, number> = {};
    const unusable: Record<string, number> = {};
    const proposerCandidates: StageACandidate[] = [];
    for (const [index, result] of results.entries()) {
      const finding = findings[index]!;
      replies.push(...result.replies);
      unusable[finding.id] = result.unusable;
      for (const [category, count] of Object.entries(result.refusals)) {
        safetyDrops[category] = (safetyDrops[category] ?? 0) + count;
      }
      entropy[finding.id] = result.entropy;
      proposerCandidates.push(...result.candidates);
    }

    // Link tests, judged together across this proposer's own candidates only, and only for
    // a candidate whose data test passed and whose link test is about the finding: exactly
    // what the full pipeline requires before a link test is ever run at all.
    const eligible = proposerCandidates.filter((c) => {
      const linkTest = c.candidate.linkTest;
      return c.passed && linkTest !== null && aboutThisFinding(linkTest, c.candidate.test, findingById.get(c.findingId)!);
    });
    // Shared with the full pipeline's own seed, keyed on the finding and the link test alone
    // (never the proposer), so the same link test gets the same placebos whichever proposer
    // offered it.
    const outcomes = eligible.map((c) => runLink(c.candidate.linkTest!, data, linkSeed(c.findingId, c.candidate.linkTest!)));
    const verdicts = judgeLinks(outcomes);
    eligible.forEach((c, i) => {
      const outcome = outcomes[i]!;
      const verdict = verdicts[i]!;
      c.link = {
        ...c.candidate.linkTest!,
        verdict,
        p: outcome.p,
        effect: outcome.effect,
        size: outcome.size,
        placeboEffects: outcome.placeboEffects,
        ...(outcome.refused ? { reason: outcome.refused } : {}),
      };
    });

    candidates.push(...proposerCandidates);
    proposers.push({
      id: role.id,
      role,
      replies,
      unusable,
      failed,
      safetyDrops,
      entropy,
      usage: spent.usage,
      ms: spent.ms,
      waitedMs: spent.waitedMs,
      answered: [...new Set(replies.map((r) => r.model))].sort(),
    });
  }

  // Already produced in this order by construction (proposers run one after another, and
  // `mapPool` hands each proposer's results back in finding order, propose's own candidate
  // order preserved within them); sorted again here so that stays a documented guarantee of
  // the output, not an accident of how it happens to be built today.
  const proposerOrder = new Map(PROPOSERS.map((p, i) => [p.id, i]));
  const findingOrder = new Map(findings.map((f, i) => [f.id, i]));
  candidates.sort(
    (a, b) =>
      proposerOrder.get(a.proposer)! - proposerOrder.get(b.proposer)! ||
      findingOrder.get(a.findingId)! - findingOrder.get(b.findingId)! ||
      a.rank - b.rank,
  );

  return { seed: PILOT_SEED, findingIds: findings.map((f) => f.id), proposers, candidates };
}

export interface StageBVerdict {
  run: string;
  candidateId: string;
  survived: boolean;
  stage: Verdict["stage"];
  category: string | null; // the refusal category for a safety stop; null otherwise
  unusable: "no answer" | "unreadable" | null; // the call failed, or its answer couldn't be read; null when it was usable
  counter: Check | null;
  counterOutcome: Outcome | null;
  reason: string;
  model: string | null; // the id that answered; null when the call failed
  usage: Usage;
  ms: number;
  waitedMs: number;
}

export interface StageB {
  pool: PoolEntry[];
  verdicts: StageBVerdict[];
  // Once per pool candidate, over its own claim, link and premise in both languages: whether
  // any of the 6 texts matches the private terms, regardless of what any run's verdict says
  // (see `runStageB`'s own comment on why this can't be read off `verdicts` instead).
  termMatches: { candidateId: string; termMatch: boolean }[];
}

const REFUSED_PREFIX = "refused: ";

/** The category a safety stop's own reason names ("refused: blame" -> "blame"), or null when the verdict didn't stop there. */
function categoryOf(verdict: Verdict): string | null {
  if (verdict.stage !== "safety" || !verdict.reason.startsWith(REFUSED_PREFIX)) return null;
  return verdict.reason.slice(REFUSED_PREFIX.length);
}

/** Whether a call simply never gave a usable answer, and why, read off `falsify`'s own 2 fixed reasons; null for anything else, refusals included. */
function unusableOf(verdict: Verdict): "no answer" | "unreadable" | null {
  if (verdict.reason === NO_ANSWER) return "no answer";
  if (verdict.reason === UNREADABLE) return "unreadable";
  return null;
}

/** `ADVERSARIES`' own order, and each run's own effort: shared by `runStageB`'s own sort and by `committedCandidates`. */
const RUN_ORDER = new Map(ADVERSARIES.map((r, i) => [r.id, i]));
const EFFORT_BY_RUN = new Map(ADVERSARIES.map((r) => [r.id, r.effort ?? null]));

/**
 * Stage B: draws the pool `samplePool(a.candidates, POOL_PER_PROPOSER, PILOT_SEED)` shares
 * across every run, then asks each of `ADVERSARIES` in turn to `falsify` every candidate in
 * it, `options.concurrency` at a time. A2 repeats A1's exact model and effort with its own
 * `label: "repeat"`, which `falsify` folds into its cache key alongside the model and
 * effort, so its calls are asked again rather than served from A1's cache: that's the noise
 * floor rules 2 and 3 read every other run against.
 *
 * Neither this stage nor stage A applies the private terms inside `falsify` or `propose`
 * themselves: `falsify` is always called with `null`, whatever `options.terms` says, and
 * only the built-in named-person pattern still drops anything at stage A. Instead,
 * `options.terms`, when given, is used once per pool candidate to compute `termMatch`
 * (`StageB.termMatches`), independent of any run's own verdict. This matters because the
 * old way, checking a private term only after a candidate had already "survived" its own
 * counter-test, missed a term match entirely on a candidate every run happened to break: a
 * counter-test passing is judged before a private term ever would be, so that candidate
 * would never have reached the check at all, and would have been committed in full.
 * `termMatch` also keeps a policy-versus-terms comparison possible in both directions on the
 * pool: a term matched while a run's own safety check passed it, or a run refusing with no
 * term matched.
 *
 * Before any call, 2 things are checked: every adversary in `ADVERSARIES` has a runner (so a
 * missing setup is never discovered only after the ones before it have already spent real
 * calls), and every pool candidate's `findingId` resolves in `detect(data)` (so a dataset
 * that's moved on from a stale stage A file fails clearly rather than crashing deep inside
 * `falsify`).
 *
 * Shares stage A's own halt, across every run and candidate rather than reset between runs:
 * a fatal error, a `LimitError`, or `STOP_AFTER_FAILURES` calls in a row failing stops the
 * whole stage, and `runStageB` throws once the run that tripped it has finished its own
 * `mapPool`, so nothing partial is ever returned and a resumed run picks back up from every
 * answer already cached. As in stage A, the wrapper strips `accept` before a call reaches
 * the cache, so an answer that comes back unusable is cached and replayed identically on a
 * resumed run rather than asked again.
 *
 * `options.onVerdict`, when given, is called once a candidate's verdict is in, so a caller
 * can print progress without this function knowing how to print anything; suppressed once
 * the halt is set, so a call the halt cut short never prints a line that reads as real
 * progress.
 *
 * The verdicts come back sorted by run order (`ADVERSARIES`' own order), then pool order, a
 * documented guarantee of the output rather than an accident of `mapPool` handing each run's
 * own results back in pool order regardless of when they finished.
 */
export async function runStageB(
  data: Data,
  a: StageA,
  runners: Map<string, Runner>,
  options: { concurrency: number; terms: RegExp | null; onVerdict?: (run: string, candidateId: string, verdict: StageBVerdict) => void },
): Promise<StageB> {
  const missing = ADVERSARIES.filter((r) => !runners.has(r.id)).map((r) => r.id);
  if (missing.length > 0) {
    throw new Error(`runStageB: no runner for adversar${missing.length > 1 ? "ies" : "y"} ${missing.map((id) => `"${id}"`).join(", ")}`);
  }

  const pool = samplePool(a.candidates, POOL_PER_PROPOSER, PILOT_SEED);
  const byId = new Map(a.candidates.map((c) => [c.candidateId, c]));
  const findingById = new Map(detect(data).map((f) => [f.id, f]));

  const unresolvedFindings = [...new Set(pool.filter((entry) => !findingById.has(entry.findingId)).map((entry) => entry.findingId))];
  if (unresolvedFindings.length > 0) {
    throw new Error(
      `runStageB: the pool has a candidate for finding id${unresolvedFindings.length > 1 ? "s" : ""} detect(data) doesn't have: ${unresolvedFindings.join(", ")}`,
    );
  }

  const termMatches = pool.map((entry) => {
    const candidate = byId.get(entry.candidateId)!.candidate;
    const texts = [candidate.claim, candidate.link, candidate.premise].flatMap((t) => [t.en, t.fr]);
    return { candidateId: entry.candidateId, termMatch: texts.some((text) => refusal(text, options.terms) === "terms") };
  });

  // Shared across every run and candidate: a subscription's own limit, or a missing binary,
  // means nothing later stands a better chance either.
  const halt: { reason: string | null } = { reason: null };
  let inARow = 0;
  const verdicts: StageBVerdict[] = [];

  for (const role of ADVERSARIES) {
    const runner = runners.get(role.id)!;

    const tracked: Runner = async (call) => {
      if (halt.reason) throw new Error(halt.reason);
      try {
        // Stripped of `accept`, so an answer that comes back unusable is still cached and
        // replayed exactly on a resumed run, rather than asked again every time.
        const reply = await runner({ ...call, accept: undefined });
        inARow = 0;
        return reply;
      } catch (error) {
        if (classify(error) === "fatal") {
          halt.reason = `an adversary call failed: ${messageOf(error)}`;
        } else if (error instanceof LimitError) {
          halt.reason = `an adversary's usage limit didn't reset in time: ${messageOf(error)}`;
        } else {
          inARow++;
          if (inARow >= STOP_AFTER_FAILURES) {
            halt.reason = `${STOP_AFTER_FAILURES} adversary calls in a row failed, the last with: ${messageOf(error)}`;
          }
        }
        throw error;
      }
    };

    const oneCandidate = async (entry: PoolEntry): Promise<StageBVerdict> => {
      const stageACandidate = byId.get(entry.candidateId)!;
      const finding = findingById.get(entry.findingId)!;

      // falsify() makes exactly one call; captured here so the verdict can carry what that
      // one call spent, rather than only what the whole run spent. `call.key` is scoped to
      // this pool candidate, not just its finding and test: 2 different proposers can land
      // on the exact same premise and test (the pilot's own fixed findings make that
      // possible), and each still gets its own cache entry and its own real call.
      let usage = NO_USAGE;
      let ms = 0;
      let waitedMs = 0;
      const capturing: Runner = async (call) => {
        const reply = await tracked({ ...call, key: `${call.key}:${entry.candidateId}` });
        usage = reply.usage;
        ms = reply.ms;
        waitedMs = reply.waitedMs;
        return reply;
      };

      // Neither stage of the pilot applies the private terms inside a real call: `null`
      // here, always, whatever `options.terms` says (see the function's own comment).
      const verdict = await falsify(
        stageACandidate.candidate,
        finding,
        data,
        capturing,
        { model: role.model, effort: role.effort, label: role.label },
        null,
      );
      const result: StageBVerdict = {
        run: role.id,
        candidateId: entry.candidateId,
        survived: verdict.survived,
        stage: verdict.stage,
        category: categoryOf(verdict),
        unusable: unusableOf(verdict),
        counter: verdict.counter,
        counterOutcome: verdict.counterOutcome,
        reason: verdict.reason,
        model: verdict.model,
        usage,
        ms,
        waitedMs,
      };
      if (!halt.reason) options.onVerdict?.(role.id, entry.candidateId, result);
      return result;
    };

    const results = await mapPool(pool, options.concurrency, oneCandidate);
    // Nothing partial is ever returned: the answers already cached stay there for a resumed
    // run to pick straight back up from.
    if (halt.reason) throw new Error(halt.reason);

    verdicts.push(...results);
  }

  // Already produced in this order by construction (runs made one after another, and
  // `mapPool` hands each run's own results back in pool order regardless of when they
  // finished); sorted again here so that stays a documented guarantee of the output, not an
  // accident of how it happens to be built today.
  const poolOrder = new Map(pool.map((entry, i) => [entry.candidateId, i]));
  verdicts.sort((x, y) => RUN_ORDER.get(x.run)! - RUN_ORDER.get(y.run)! || poolOrder.get(x.candidateId)! - poolOrder.get(y.candidateId)!);

  return { pool, verdicts, termMatches };
}

/** Every field of a run's verdict that carries no free text: safe to commit for a redacted candidate as well as a shown one. */
function nonTextRun(v: StageBVerdict): object {
  return {
    run: v.run,
    survived: v.survived,
    stage: v.stage,
    category: v.category,
    unusable: v.unusable,
    model: v.model,
    effort: EFFORT_BY_RUN.get(v.run) ?? null,
    usage: v.usage,
    ms: v.ms,
    waitedMs: v.waitedMs,
  };
}

/**
 * A run's counter-test, kept only if neither its own JSON nor the named-person pattern
 * matches `terms`; otherwise dropped, keeping just its outcome's status (never its own
 * `reason`, and never the figures it read, on the belt-and-braces chance either named
 * something they shouldn't). A verdict with no counter-test proposed carries nothing to
 * screen either way.
 */
function safeCounter(v: StageBVerdict, terms: RegExp | null): { counter: Check | null; counterOutcome: { status: string } | Outcome | null } {
  if (v.counter === null) return { counter: null, counterOutcome: v.counterOutcome };
  if (refusal(JSON.stringify(v.counter), terms) === null) return { counter: v.counter, counterOutcome: v.counterOutcome };
  return { counter: null, counterOutcome: v.counterOutcome ? { status: v.counterOutcome.status } : null };
}

/**
 * The body of `insights/pilot/candidates.json`, committed to the public repo: every pool
 * candidate, its verdict from each of the 5 runs sorted into run order, and nothing that
 * belongs to a candidate any run stopped for safety, or whose own text matched a private
 * term (`b.termMatches`), but that candidate's ids and which runs or terms stopped it, by
 * category. `stage: "safety"` covers a model's own refusal; `termMatch` is measured
 * separately from any verdict (see `runStageB`'s own comment on why). Neither this file nor
 * `StageBVerdict.reason` for a redacted candidate is read from here: no run's own free-text
 * `reason` is ever written to this file at all, redacted candidate or not, and a
 * non-redacted candidate's own counter-test is written only when `safeCounter` clears it.
 * `terms` is never itself written anywhere in the result; it's read only to decide what to
 * leave out.
 */
export function committedCandidates(a: StageA, b: StageB, terms: RegExp | null): unknown {
  const candidateById = new Map(a.candidates.map((c) => [c.candidateId, c]));
  const termMatchByCandidate = new Map(b.termMatches.map((t) => [t.candidateId, t.termMatch]));
  const verdictsByCandidate = new Map<string, StageBVerdict[]>();
  for (const v of b.verdicts) {
    const list = verdictsByCandidate.get(v.candidateId) ?? [];
    list.push(v);
    verdictsByCandidate.set(v.candidateId, list);
  }

  return b.pool.map((entry) => {
    const stageACandidate = candidateById.get(entry.candidateId)!;
    const runs = (verdictsByCandidate.get(entry.candidateId) ?? []).slice().sort((x, y) => RUN_ORDER.get(x.run)! - RUN_ORDER.get(y.run)!);

    const termMatch = termMatchByCandidate.get(entry.candidateId) ?? false;
    const safety = [
      ...(termMatch ? [{ run: "terms", category: "terms" }] : []),
      ...runs.filter((v) => v.stage === "safety").map((v) => ({ run: v.run, category: v.category })),
    ];
    if (safety.length > 0) {
      return { candidateId: entry.candidateId, proposer: entry.proposer, findingId: entry.findingId, safety, runs: runs.map(nonTextRun) };
    }

    const { claim, link, premise, test } = stageACandidate.candidate;
    return {
      candidateId: entry.candidateId,
      proposer: entry.proposer,
      findingId: entry.findingId,
      claim,
      link,
      premise,
      test,
      numbers: stageACandidate.outcome.numbers,
      linkTest: stageACandidate.link,
      runs: runs.map((v) => ({ ...nonTextRun(v), ...safeCounter(v, terms) })),
    };
  });
}
