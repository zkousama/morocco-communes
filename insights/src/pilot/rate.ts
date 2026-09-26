/**
 * The owner rates the pilot's candidates blind, in the terminal: 60 reasons (15 per
 * proposer, one per finding), then every pool candidate the 5 adversary runs disagree on
 * (capped at 40), then 10 of those items back for a second pass, unlabelled, for a drift
 * check. `ratingPlan` is the pure, seeded draw a re-run repeats; `pnpm insights:pilot:rate`
 * is the interactive loop that shows one item, takes an answer and saves `ratings.json`
 * right away, so quitting loses nothing already answered. Nothing here reuses `grade.ts`'s
 * own `interactiveLoop`: that one is typed to `GradedFile`, one render and one merge per
 * item, and a disagreement here asks 2 different kinds of question (the reason, then each
 * counter-test that broke it), which doesn't fit that shape without bending it.
 */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { detect } from "../detect.ts";
import { loadData } from "../data.ts";
import { field } from "../fields.ts";
import { findingLine } from "../text.ts";
import { formatNumbers, formatReasonBlock } from "../grade.ts";
import { hash, messageOf, readLocal, writeJsonAtomic, type Local } from "../model.ts";
import { localWarning } from "../run.ts";
import { refusal, termsPattern } from "../safety.ts";
import { rng } from "../stats.ts";
import { signature, type Check, type Ref, type Subject } from "../vocabulary.ts";
import { sampleDisagreements, sampleRated, shuffle } from "./sample.ts";
import { DISAGREEMENT_CAP, DRIFT_ITEMS, PILOT_SEED, RATED_PER_PROPOSER } from "./setups.ts";
import type { StageA, StageB, StageBVerdict } from "./stages.ts";

export type RatingItem =
  | { kind: "reason"; itemId: string; candidateId: string }
  | { kind: "disagreement"; itemId: string; candidateId: string; counterIds: string[] } // counter-tests from the runs that broke it, deduplicated by signature
  | { kind: "drift"; itemId: string; of: string }; // a repeat of an earlier item

export interface Ratings {
  items: RatingItem[];
  answers: { itemId: string; answer: "yes" | "no" | "skip"; counters?: Record<string, "yes" | "no" | "skip">; at: string }[];
}

export const RATINGS_PATH = "insights/pilot/ratings.json";

const STAGE_A_PATH = join(".cache", "insights", "pilot", "stage-a.json");
const STAGE_B_PATH = join(".cache", "insights", "pilot", "stage-b.json");

/** A short, stable id for a candidate playing a given role in the plan: never a text, and stable across a resumed run. */
const itemIdFor = (kind: "reason" | "disagreement", candidateId: string): string => `${kind}:${candidateId}`;

/** The kind and candidate an earlier itemId names, so a drift item can be rendered exactly as that earlier item was. */
function parseItemId(itemId: string): { kind: "reason" | "disagreement"; candidateId: string } {
  const at = itemId.indexOf(":");
  return { kind: itemId.slice(0, at) as "reason" | "disagreement", candidateId: itemId.slice(at + 1) };
}

/** Whether a run's verdict is what broke the candidate: a real counter-test that came out true, never a stop the adversary never got to argue. Exported for the analysis (`analyse.ts`), which attributes a rated answer back to the runs it judges. */
export function broke(v: StageBVerdict): boolean {
  return v.survived === false && v.stage === "falsify" && v.unusable === null;
}

/** A stable id for one counter-test, scoped to the candidate it's about: never the run that offered it. Exported for the same reason as `broke`. */
export function counterIdOf(candidateId: string, check: Check): string {
  return hash(`${candidateId}:${signature(check)}`).slice(0, 12);
}

/** Every distinct counter-test (by signature) that broke `candidateId`, across whichever runs offered it, sorted by the id itself rather than by which run happened to answer first. */
function counterIdsFor(candidateId: string, b: StageB): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const v of b.verdicts) {
    if (v.candidateId !== candidateId || !broke(v) || !v.counter) continue;
    const sig = signature(v.counter);
    if (seen.has(sig)) continue;
    seen.add(sig);
    ids.push(counterIdOf(candidateId, v.counter));
  }
  return ids.sort();
}

/**
 * `ratingPlan`'s 3 parts: the blind reasons (`sampleRated`), the disagreements
 * (`sampleDisagreements`), and 10 drift items repeating some of the first 2, each part
 * shuffled with its own fresh `rng(seed)` stream. `terms`, when given, drops a reason
 * candidate (from any of its 6 texts) the private terms would have caught: stage A never
 * ran the terms check itself, and a reason candidate isn't always in stage B's own pool, so
 * stage B's `termMatches` can't always cover it either way. A reason candidate that IS in
 * the pool and already flagged there is dropped too, so a caller can't skip the terms check
 * for a reason just because its own text alone doesn't trip `refusal`. A candidate dropped
 * either way isn't replaced by another; the caller may end up rating fewer than 60 reasons.
 * Every candidate any run stopped for safety is left out of both the reasons and the
 * disagreements.
 */
export function ratingPlan(a: StageA, b: StageB, seed: number, terms: RegExp | null = null): RatingItem[] {
  const safetyIds = new Set(b.verdicts.filter((v) => v.stage === "safety").map((v) => v.candidateId));
  const termMatchIds = new Set(b.termMatches.filter((t) => t.termMatch).map((t) => t.candidateId));
  const candidateById = new Map(a.candidates.map((c) => [c.candidateId, c]));

  const rated = sampleRated(a.candidates, a.findingIds, RATED_PER_PROPOSER, seed);
  const reasonIds = rated.filter((candidateId) => {
    if (safetyIds.has(candidateId) || termMatchIds.has(candidateId)) return false;
    const c = candidateById.get(candidateId)!;
    const texts = [c.candidate.claim, c.candidate.link, c.candidate.premise].flatMap((t) => [t.en, t.fr]);
    return !texts.some((text) => refusal(text, terms) === "terms");
  });
  const reasonItems: (RatingItem & { kind: "reason" })[] = reasonIds.map((candidateId) => ({
    kind: "reason",
    itemId: itemIdFor("reason", candidateId),
    candidateId,
  }));
  shuffle(reasonItems, rng(seed));

  const verdictsByCandidate = new Map<string, Map<string, boolean>>();
  for (const v of b.verdicts) {
    if (safetyIds.has(v.candidateId) || termMatchIds.has(v.candidateId) || v.unusable !== null) continue;
    const perCandidate = verdictsByCandidate.get(v.candidateId) ?? new Map<string, boolean>();
    perCandidate.set(v.run, broke(v));
    verdictsByCandidate.set(v.candidateId, perCandidate);
  }
  const disagreementIds = sampleDisagreements(verdictsByCandidate, DISAGREEMENT_CAP, seed);
  const disagreementItems: (RatingItem & { kind: "disagreement" })[] = disagreementIds.map((candidateId) => ({
    kind: "disagreement",
    itemId: itemIdFor("disagreement", candidateId),
    candidateId,
    counterIds: counterIdsFor(candidateId, b),
  }));
  shuffle(disagreementItems, rng(seed));

  const pool: RatingItem[] = [...reasonItems, ...disagreementItems];
  shuffle(pool, rng(seed));
  const driftItems: (RatingItem & { kind: "drift" })[] = pool.slice(0, DRIFT_ITEMS).map((item) => ({
    kind: "drift",
    itemId: `drift:${item.itemId}`,
    of: item.itemId,
  }));

  return [...reasonItems, ...disagreementItems, ...driftItems];
}

/** The kind, candidate and (for a disagreement) counterIds `item` is really about: itself, or, for a drift item, whatever it repeats, recomputed rather than trusted from a stale copy. Exported so a test can check a drift item resolves exactly as the item it repeats did. */
export function resolve(item: RatingItem, b: StageB): { kind: "reason" | "disagreement"; candidateId: string; counterIds: string[] } {
  if (item.kind === "reason") return { kind: "reason", candidateId: item.candidateId, counterIds: [] };
  if (item.kind === "disagreement") return { kind: "disagreement", candidateId: item.candidateId, counterIds: item.counterIds };
  const original = parseItemId(item.of);
  return original.kind === "disagreement"
    ? { kind: "disagreement", candidateId: original.candidateId, counterIds: counterIdsFor(original.candidateId, b) }
    : { kind: "reason", candidateId: original.candidateId, counterIds: [] };
}

/** `findingId`s from `a.findingIds` that aren't keys of `lines`: stage A's own findings the caller's line map can't render. Empty when every one resolves. */
export function missingFindingIds(findingIds: string[], lines: Map<string, unknown>): string[] {
  return findingIds.filter((id) => !lines.has(id));
}

/** What the rater sees for `item`: the finding line, the claim, the premise with its numbers, and the link, each in English then French. Never the setup, the model, the effort, the stage or a verdict. A drift item shows exactly what the item it repeats showed. `lines` must hold every finding id in `a.findingIds` (`main` refuses to start otherwise; a test passes its own synthetic map). */
export function screen(item: RatingItem, a: StageA, b: StageB, lines: Map<string, { en: string; fr: string }>): string {
  const { candidateId } = resolve(item, b);
  const c = a.candidates.find((x) => x.candidateId === candidateId);
  if (!c) throw new Error(`screen: no stage A candidate for "${candidateId}"`);
  const line = lines.get(c.findingId);
  if (!line) throw new Error(`screen: no finding line for "${c.findingId}"`);
  return formatReasonBlock(line, c.candidate.claim, c.candidate.premise, c.outcome.numbers, c.candidate.link);
}

/** Resolves a `{unit:"code", code}` subject to a real name, or null when the code isn't one the dataset has (or when the caller has nothing to resolve with, as every test's synthetic checks never use this subject at all). */
export type UnitNamer = (code: string) => string | null;

// ">"/"<" read as "supérieur à"/"inférieur à" in French, never the more literal "plus que"/
// "moins que"; ">="/"<=" already read naturally as "au moins"/"au plus".
const OP_WORDS: Record<"compare" | "change", Record<string, { en: string; fr: string }>> = {
  compare: {
    ">": { en: "more than", fr: "supérieur à" },
    "<": { en: "less than", fr: "inférieur à" },
    ">=": { en: "at least", fr: "au moins" },
    "<=": { en: "at most", fr: "au plus" },
  },
  change: {
    ">": { en: "more than", fr: "supérieur à" },
    "<": { en: "less than", fr: "inférieur à" },
  },
};

// Each phrase already carries its own French preposition ("de sa province", "du pays"),
// since "de" elides to "du" before "le" and every template below reads "... % du haut
// ${within.fr}" with nothing of its own in between.
const WITHIN: Record<"province" | "region" | "country", { en: string; fr: string }> = {
  province: { en: "of its province", fr: "de sa province" },
  region: { en: "of its région", fr: "de sa région" },
  country: { en: "of the country", fr: "du pays" },
};

const POSITION: Record<"top" | "bottom", { en: string; fr: string }> = {
  top: { en: "top", fr: "haut" },
  bottom: { en: "bottom", fr: "bas" },
};

/** A field's own bilingual label, or its bare path when it isn't one the catalogue knows (only ever a test's own made-up field). */
function fieldLabel(path: string): { en: string; fr: string } {
  return field(path)?.label ?? { en: path, fr: path };
}

/**
 * A check's subject, in plain words: "this place", "its province or région", "its
 * neighbours' median", "the country", or a named unit. The French side already carries its
 * own "de"/"du" (every call site below reads it straight after a bare "de"-less join), so
 * "de le pays" never comes up: it's "du pays" from here on.
 */
function subjectPhrase(subject: Subject, unitName: UnitNamer): { en: string; fr: string } {
  if (subject.unit === "self") return { en: "this place", fr: "de ce lieu" };
  if (subject.unit === "parent") return { en: "its province or région", fr: "de sa province ou région" };
  if (subject.unit === "country") return { en: "the country", fr: "du pays" };
  if (subject.unit === "neighbours") return { en: "its neighbours' median", fr: "de la médiane de ses voisins" };
  const name = unitName(subject.code);
  return name ? { en: name, fr: `de ${name}` } : { en: `the unit ${subject.code}`, fr: `de l’unité ${subject.code}` };
}

/** One reference (a subject, a field and a year), in plain words. */
function refPhrase(ref: Ref, unitName: UnitNamer): { en: string; fr: string } {
  const subject = subjectPhrase(ref.of, unitName);
  const label = fieldLabel(ref.field);
  return { en: `${subject.en}'s ${label.en} in ${ref.year}`, fr: `${label.fr} ${subject.fr} en ${ref.year}` };
}

function describeCompare(check: Extract<Check, { check: "compare" }>, unitName: UnitNamer): { en: string; fr: string } {
  const left = refPhrase(check.left, unitName);
  const op = OP_WORDS.compare[check.op]!;
  const right = "value" in check.right ? { en: String(check.right.value), fr: String(check.right.value) } : refPhrase(check.right, unitName);
  return { en: `${left.en} is ${op.en} ${right.en}`, fr: `${left.fr} est ${op.fr} ${right.fr}` };
}

function describeChange(check: Extract<Check, { check: "change" }>, unitName: UnitNamer): { en: string; fr: string } {
  const subject = subjectPhrase(check.of, unitName);
  const label = fieldLabel(check.field);
  const op = OP_WORDS.change[check.op]!;
  return {
    en: `the change in ${subject.en}'s ${label.en} from 2014 to 2024 is ${op.en} ${check.value}`,
    fr: `le changement de ${label.fr} ${subject.fr} entre 2014 et 2024 est ${op.fr} ${check.value}`,
  };
}

function describeRank(check: Extract<Check, { check: "rank" }>, unitName: UnitNamer): { en: string; fr: string } {
  const subject = subjectPhrase(check.of, unitName);
  const label = fieldLabel(check.field);
  const within = WITHIN[check.within];
  const position = POSITION[check.position];
  const sharePct = Math.round(check.share * 100);
  return {
    en: `${subject.en}'s ${label.en} in ${check.year} is in the ${position.en} ${sharePct}% ${within.en}`,
    fr: `${label.fr} ${subject.fr} en ${check.year} est dans les ${sharePct}% du ${position.fr} ${within.fr}`,
  };
}

/** A check, in plain words: the subject, the field's own label, the year and the comparison. Never which run offered it, and never the adversary's own reason for offering it. */
export function describeCheck(check: Check, unitName: UnitNamer): { en: string; fr: string } {
  if (check.check === "compare") return describeCompare(check, unitName);
  if (check.check === "change") return describeChange(check, unitName);
  return describeRank(check, unitName);
}

/** One counter-test in plain words: the check it is (subject, field label, year, comparison) and the numbers its outcome computed, in English then French. Never which run offered it, and never the adversary's own reason. Looked up among the verdicts that actually broke the candidate, so the threshold and numbers shown are the breaking run's own, never a same-signature verdict that happened to survive. */
export function counterText(candidateId: string, counterId: string, b: StageB, unitName: UnitNamer): string {
  const match = b.verdicts.find((v) => v.candidateId === candidateId && broke(v) && v.counter && counterIdOf(candidateId, v.counter) === counterId);
  if (!match?.counter) return ["counter-test: (not available)", "  (non disponible)"].join("\n");
  const described = describeCheck(match.counter, unitName);
  const numbers = match.counterOutcome ? formatNumbers(match.counterOutcome.numbers) : "none";
  return [`counter-test: ${described.en} (${numbers})`, `  ${described.fr} (${numbers})`].join("\n");
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Both stage files, or a clear reason the CLI can't start: either one missing gets its own one-line message, checked before either is parsed. */
export async function readStageFiles(aPath: string, bPath: string): Promise<{ ok: true; a: StageA; b: StageB } | { ok: false; message: string }> {
  const read = async (path: string, label: "A" | "B"): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> => {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return { ok: false, message: `stage ${label} hasn't run yet: run \`pnpm insights:pilot --stage ${label.toLowerCase()}\` first` };
      return { ok: false, message: `couldn't read ${path}: ${messageOf(error)}` };
    }
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (error) {
      return { ok: false, message: `${path} isn't valid JSON: ${messageOf(error)}` };
    }
  };

  const a = await read(aPath, "A");
  if (!a.ok) return a;
  const b = await read(bPath, "B");
  if (!b.ok) return b;
  return { ok: true, a: a.value as StageA, b: b.value as StageB };
}

async function loadRatings(path: string): Promise<Ratings> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Ratings;
  } catch (error) {
    if (isMissing(error)) return { items: [], answers: [] };
    throw new Error(`couldn't read ${path}: ${messageOf(error)}`);
  }
}

/**
 * Why a *new* plan can't be built, from `localWarning` (`insights/src/run.ts`): no
 * `INSIGHTS_LOCAL` at all, or one with no terms in it. Null when there's nothing to refuse.
 * `ratingsIsEmpty` is `ratings.items.length === 0`; an existing saved plan (`false`) is
 * never blocked, since the terms check that mattered already ran when that plan was built.
 */
export function refuseNewPlanReason(ratingsIsEmpty: boolean, local: Local | null): string | null {
  if (!ratingsIsEmpty) return null;
  return localWarning(local);
}

/** The one method the rating loop needs from a readline interface: narrowed so a test can hand it a plain stub instead of a real terminal. */
export interface Prompter {
  question(prompt: string): Promise<string>;
}

/** Where `runRating` and the functions it calls print: a test hands in one that records lines instead of writing to the terminal. */
export interface RatingIO {
  log: (line: string) => void;
}

async function askAnswer(rl: Prompter, io: RatingIO, question: string): Promise<"yes" | "no" | "skip" | "quit"> {
  for (;;) {
    const raw = (await rl.question(question)).trim().toLowerCase();
    if (raw === "y") return "yes";
    if (raw === "n") return "no";
    if (raw === "s") return "skip";
    if (raw === "q") return "quit";
    io.log("type y, n, s or q");
  }
}

/** Walks `item`'s whole question flow (the reason, then, for a disagreement, each counter-test), or "quit" the moment the owner does; quitting mid-item discards that item's own progress, not anything already recorded before it. */
export async function answerItem(
  item: RatingItem,
  a: StageA,
  b: StageB,
  lines: Map<string, { en: string; fr: string }>,
  unitName: UnitNamer,
  rl: Prompter,
  io: RatingIO,
): Promise<Ratings["answers"][number] | "quit"> {
  io.log(screen(item, a, b, lines));
  const main = await askAnswer(rl, io, "is this reason sound? (y/n/s/q) ");
  if (main === "quit") return "quit";

  const resolved = resolve(item, b);
  if (resolved.kind !== "disagreement") {
    return { itemId: item.itemId, answer: main, at: new Date().toISOString() };
  }

  const counters: Record<string, "yes" | "no" | "skip"> = {};
  for (const counterId of resolved.counterIds) {
    io.log(counterText(resolved.candidateId, counterId, b, unitName));
    const answer = await askAnswer(rl, io, "does this break it? (y/n/s/q) ");
    if (answer === "quit") return "quit";
    counters[counterId] = answer;
  }
  return { itemId: item.itemId, answer: main, counters, at: new Date().toISOString() };
}

/** The plan's own items not already answered, in plan order: what a resumed run still has to ask. */
export function remainingItems(ratings: Ratings): RatingItem[] {
  const answered = new Set(ratings.answers.map((x) => x.itemId));
  return ratings.items.filter((item) => !answered.has(item.itemId));
}

/**
 * Asks every remaining item in turn (`remainingItems`), saving `start` plus every answer so
 * far to `ratingsPath` with `writeJsonAtomic` right after each one, so a crash or a `q` never
 * loses an answer already given. Returns the final `Ratings`, the same one now on disk.
 * Takes the prompter, the stage data and line map, and where to print, all as parameters, so
 * it never touches a real terminal, `process.stdin` or the real `insights/pilot/ratings.json`
 * in a test.
 */
export async function runRating(
  a: StageA,
  b: StageB,
  lines: Map<string, { en: string; fr: string }>,
  unitName: UnitNamer,
  start: Ratings,
  ratingsPath: string,
  rl: Prompter,
  io: RatingIO,
): Promise<Ratings> {
  const remaining = remainingItems(start);
  if (remaining.length === 0) {
    io.log("nothing left to rate");
    return start;
  }

  let ratings = start;
  for (const [i, item] of remaining.entries()) {
    io.log(`\n[${i + 1}/${remaining.length}]`);
    const result = await answerItem(item, a, b, lines, unitName, rl, io);
    if (result === "quit") {
      io.log("saved, quitting");
      return ratings;
    }
    ratings = { ...ratings, answers: [...ratings.answers, result] };
    await writeJsonAtomic(ratingsPath, ratings);
  }
  io.log("done");
  return ratings;
}

async function main(): Promise<void> {
  const stages = await readStageFiles(STAGE_A_PATH, STAGE_B_PATH);
  if (!stages.ok) {
    console.log(stages.message);
    process.exitCode = 1;
    return;
  }

  const data = loadData();
  const findingById = new Map(detect(data).map((f) => [f.id, f]));
  const lines = new Map<string, { en: string; fr: string }>();
  for (const id of stages.a.findingIds) {
    const finding = findingById.get(id);
    if (finding) lines.set(id, findingLine(finding, data));
  }
  const missing = missingFindingIds(stages.a.findingIds, lines);
  if (missing.length > 0) {
    console.log(`${missing.length} of stage A's finding id${missing.length === 1 ? "" : "s"} ${missing.length === 1 ? "doesn't" : "don't"} match the dataset detect(data) gives now; rerun the pilot's stage A, or check the dataset version`);
    process.exitCode = 1;
    return;
  }
  const unitName: UnitNamer = (code) => data.units.get(code)?.name.fr ?? null;

  const ratings = await loadRatings(RATINGS_PATH);
  const local = readLocal(process.env);
  const newPlanRefusal = refuseNewPlanReason(ratings.items.length === 0, local);
  if (newPlanRefusal) {
    console.log(newPlanRefusal);
    process.exitCode = 1;
    return;
  }

  let toRate = ratings;
  if (toRate.items.length === 0) {
    const terms = termsPattern(local?.terms ?? []);
    toRate = { items: ratingPlan(stages.a, stages.b, PILOT_SEED, terms), answers: [] };
    await writeJsonAtomic(RATINGS_PATH, toRate);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runRating(stages.a, stages.b, lines, unitName, toRate, RATINGS_PATH, rl, { log: (line) => console.log(line) });
  } finally {
    rl.close();
  }
}

// Runs the CLI when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
