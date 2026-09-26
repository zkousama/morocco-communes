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
import { detect, type Finding } from "../detect.ts";
import { loadData, type Data } from "../data.ts";
import { findingLine } from "../text.ts";
import { hash, messageOf, readLocal, writeJsonAtomic } from "../model.ts";
import { refusal, termsPattern } from "../safety.ts";
import { signature, type Check, type Outcome } from "../vocabulary.ts";
import { sampleDisagreements, sampleRated } from "./sample.ts";
import { DISAGREEMENT_CAP, DRIFT_ITEMS, PILOT_SEED, RATED_PER_PROPOSER } from "./setups.ts";
import type { StageA, StageACandidate, StageB, StageBVerdict } from "./stages.ts";

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

/** Fisher-Yates, in place, driven by an already-seeded generator: rate.ts's own copy, so it never reaches into sample.ts's unexported helper. */
function shuffleInPlace<T>(values: T[], random: () => number): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const vi = values[i]!;
    values[i] = values[j]!;
    values[j] = vi;
  }
}

/** A short, stable id for a candidate playing a given role in the plan: never a text, and stable across a resumed run. */
const itemIdFor = (kind: "reason" | "disagreement", candidateId: string): string => `${kind}:${candidateId}`;

/** The kind and candidate an earlier itemId names, so a drift item can be rendered exactly as that earlier item was. */
function parseItemId(itemId: string): { kind: "reason" | "disagreement"; candidateId: string } {
  const at = itemId.indexOf(":");
  return { kind: itemId.slice(0, at) as "reason" | "disagreement", candidateId: itemId.slice(at + 1) };
}

/** Whether a run's verdict is what broke the candidate: a real counter-test that came out true, never a stop the adversary never got to argue. */
function broke(v: StageBVerdict): boolean {
  return v.survived === false && v.stage === "falsify" && v.unusable === null;
}

/** A stable id for one counter-test, scoped to the candidate it's about: never the run that offered it. */
function counterIdOf(candidateId: string, check: Check): string {
  return hash(`${candidateId}:${signature(check)}`).slice(0, 12);
}

/** Every distinct counter-test (by signature) that broke `candidateId`, across whichever runs offered it, in a fixed order. */
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
  return ids;
}

/**
 * `ratingPlan`'s 3 parts: the blind reasons (`sampleRated`), the disagreements
 * (`sampleDisagreements`), and 10 drift items repeating some of the first 2, each part
 * shuffled with `seed` on its own. `terms`, when given, drops a reason candidate (from any
 * of its 6 texts) the private terms would have caught: stage A never ran the terms check
 * itself, and a reason candidate isn't always in stage B's own pool, so stage B's
 * `termMatches` can't be relied on to cover it. A candidate dropped this way isn't replaced
 * by another; the caller may end up rating fewer than 60 reasons. Every candidate any run
 * stopped for safety is left out of both the reasons and the disagreements.
 */
export function ratingPlan(a: StageA, b: StageB, seed: number, terms: RegExp | null = null): RatingItem[] {
  const safetyIds = new Set(b.verdicts.filter((v) => v.stage === "safety").map((v) => v.candidateId));
  const termMatchIds = new Set(b.termMatches.filter((t) => t.termMatch).map((t) => t.candidateId));
  const candidateById = new Map(a.candidates.map((c) => [c.candidateId, c]));

  const rated = sampleRated(a.candidates, a.findingIds, RATED_PER_PROPOSER, seed);
  const reasonIds = rated.filter((candidateId) => {
    if (safetyIds.has(candidateId)) return false;
    const c = candidateById.get(candidateId)!;
    const texts = [c.candidate.claim, c.candidate.link, c.candidate.premise].flatMap((t) => [t.en, t.fr]);
    return !texts.some((text) => refusal(text, terms) === "terms");
  });
  const reasonItems: (RatingItem & { kind: "reason" })[] = reasonIds.map((candidateId) => ({
    kind: "reason",
    itemId: itemIdFor("reason", candidateId),
    candidateId,
  }));
  shuffleInPlace(reasonItems, rngLocal(seed));

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
  shuffleInPlace(disagreementItems, rngLocal(seed));

  const pool: RatingItem[] = [...reasonItems, ...disagreementItems];
  shuffleInPlace(pool, rngLocal(seed));
  const driftItems: (RatingItem & { kind: "drift" })[] = pool.slice(0, DRIFT_ITEMS).map((item) => ({
    kind: "drift",
    itemId: `drift:${item.itemId}`,
    of: item.itemId,
  }));

  return [...reasonItems, ...disagreementItems, ...driftItems];
}

// mulberry32, the same generator stats.ts's rng() is: rate.ts keeps its own copy so a fresh,
// independent stream can be spun up for each of the plan's 3 parts from the same seed value.
function rngLocal(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The kind and candidate `item` is really about: itself, or, for a drift item, whatever it repeats. */
function resolve(item: RatingItem, b: StageB): { kind: "reason" | "disagreement"; candidateId: string; counterIds: string[] } {
  if (item.kind === "reason") return { kind: "reason", candidateId: item.candidateId, counterIds: [] };
  if (item.kind === "disagreement") return { kind: "disagreement", candidateId: item.candidateId, counterIds: item.counterIds };
  const original = parseItemId(item.of);
  return original.kind === "disagreement"
    ? { kind: "disagreement", candidateId: original.candidateId, counterIds: counterIdsFor(original.candidateId, b) }
    : { kind: "reason", candidateId: original.candidateId, counterIds: [] };
}

let cachedData: Data | null = null;
let cachedFindings: Map<string, Finding> | null = null;

/**
 * The finding a candidate's own id names, and the dataset to read it against, loaded and
 * cached once: stage A never stores enough to render the finding line itself (only its
 * id), so this is read back off the real dataset, the same `detect(data)` stage A drew its
 * findings from. Null when the id isn't one `detect(data)` gives (every test fixture's own
 * finding ids, which are never real ones, so a test never touches this at all).
 */
function findingFor(findingId: string): { finding: Finding; data: Data } | null {
  if (!cachedData || !cachedFindings) {
    cachedData = loadData();
    cachedFindings = new Map(detect(cachedData).map((f) => [f.id, f]));
  }
  const finding = cachedFindings.get(findingId);
  return finding ? { finding, data: cachedData } : null;
}

/** "the finding line", bilingual: the real sentence when the id resolves against the dataset, a plain placeholder otherwise. */
function findingLineText(findingId: string): { en: string; fr: string } {
  const found = findingFor(findingId);
  return found ? findingLine(found.finding, found.data) : { en: "this finding", fr: "ce constat" };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatNumbers(numbers: Record<string, number>): string {
  const keys = Object.keys(numbers).sort();
  if (keys.length === 0) return "none";
  return keys.map((key) => `${key}=${round(numbers[key]!, 2)}`).join(", ");
}

/** The finding line, the claim, the premise with its numbers, and the link, each in English then French. Never the setup, the model, the effort, the stage or a verdict. */
function candidateBlock(c: StageACandidate): string {
  const line = findingLineText(c.findingId);
  return [
    line.en,
    `  ${line.fr}`,
    `claim: ${c.candidate.claim.en}`,
    `  ${c.candidate.claim.fr}`,
    `premise: ${c.candidate.premise.en} (${formatNumbers(c.outcome.numbers)})`,
    `  ${c.candidate.premise.fr}`,
    `link: ${c.candidate.link.en}`,
    `  ${c.candidate.link.fr}`,
  ].join("\n");
}

/** What the rater sees for `item`: a drift item shows exactly what the item it repeats showed, never which one that was. */
export function screen(item: RatingItem, a: StageA, b: StageB): string {
  const { candidateId } = resolve(item, b);
  const c = a.candidates.find((x) => x.candidateId === candidateId);
  if (!c) throw new Error(`screen: no stage A candidate for "${candidateId}"`);
  return candidateBlock(c);
}

/** One counter-test in plain words: its own fields and the numbers its outcome read, never which run offered it. */
function counterText(candidateId: string, counterId: string, b: StageB): string {
  const match = b.verdicts.find((v) => v.candidateId === candidateId && v.counter && counterIdOf(candidateId, v.counter) === counterId);
  if (!match?.counter) return "counter-test: (not available)";
  const outcome: Outcome | null = match.counterOutcome;
  return `counter-test: ${JSON.stringify(match.counter)} (${outcome ? formatNumbers(outcome.numbers) : "none"})`;
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

/** The one method the rating loop needs from a readline interface: narrowed so a test can hand it a plain stub instead of a real terminal. */
export interface Prompter {
  question(prompt: string): Promise<string>;
}

async function askAnswer(rl: Prompter, question: string): Promise<"yes" | "no" | "skip" | "quit"> {
  for (;;) {
    const raw = (await rl.question(question)).trim().toLowerCase();
    if (raw === "y") return "yes";
    if (raw === "n") return "no";
    if (raw === "s") return "skip";
    if (raw === "q") return "quit";
    console.log("type y, n, s or q");
  }
}

/** Walks `item`'s whole question flow (the reason, then, for a disagreement, each counter-test), or "quit" the moment the owner does. */
export async function answerItem(item: RatingItem, a: StageA, b: StageB, rl: Prompter): Promise<Ratings["answers"][number] | "quit"> {
  console.log(screen(item, a, b));
  const main = await askAnswer(rl, "is this reason sound? (y/n/s/q) ");
  if (main === "quit") return "quit";

  const resolved = resolve(item, b);
  if (resolved.kind !== "disagreement") {
    return { itemId: item.itemId, answer: main, at: new Date().toISOString() };
  }

  const counters: Record<string, "yes" | "no" | "skip"> = {};
  for (const counterId of resolved.counterIds) {
    console.log(counterText(resolved.candidateId, counterId, b));
    const answer = await askAnswer(rl, "does this break it? (y/n/s/q) ");
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

async function runRating(a: StageA, b: StageB, ratingsPath: string, start: Ratings): Promise<void> {
  const remaining = remainingItems(start);
  if (remaining.length === 0) {
    console.log("nothing left to rate");
    return;
  }

  let ratings = start;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const [i, item] of remaining.entries()) {
      console.log(`\n[${i + 1}/${remaining.length}]`);
      const result = await answerItem(item, a, b, rl);
      if (result === "quit") {
        console.log("saved, quitting");
        return;
      }
      ratings = { ...ratings, answers: [...ratings.answers, result] };
      await writeJsonAtomic(ratingsPath, ratings);
    }
    console.log("done");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const stages = await readStageFiles(STAGE_A_PATH, STAGE_B_PATH);
  if (!stages.ok) {
    console.log(stages.message);
    process.exitCode = 1;
    return;
  }

  let ratings = await loadRatings(RATINGS_PATH);
  if (ratings.items.length === 0) {
    const local = readLocal(process.env);
    const terms = termsPattern(local?.terms ?? []);
    ratings = { items: ratingPlan(stages.a, stages.b, PILOT_SEED, terms), answers: [] };
    await writeJsonAtomic(RATINGS_PATH, ratings);
  }

  await runRating(stages.a, stages.b, RATINGS_PATH, ratings);
}

// Runs the CLI when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
