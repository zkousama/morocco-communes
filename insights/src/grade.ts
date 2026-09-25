/**
 * The owner grades a blind sample of hypotheses in the terminal: one per finding, published
 * and rejected mixed, with the gate, the stage and the reason left out so the read can't
 * lean on them. `sample` and `regradeSample` are the pure draw a re-run repeats for the same
 * seed; `pnpm insights:grade` and `pnpm insights:regrade` are the interactive loops that show
 * one item, take an answer and save `insights/graded.json` right away, so quitting loses
 * nothing. Task 10's scoring reads what this writes.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Finding } from "./detect.ts";
import { hash } from "./model.ts";
import type { Hypothesis, Item, RunFile } from "./run.ts";
import { rng } from "./stats.ts";
import { signature } from "./vocabulary.ts";

export interface Sampled {
  gate: "published" | "rejected";
  findingId: string;
  finding: Finding;
  hypothesis: Hypothesis;
  line: { en: string };
}

export interface Graded {
  id: string;
  findingId: string;
  gate: "published" | "rejected";
  item: { finding: Finding; line: { en: string }; hypothesis: Hypothesis };
  answer: "yes" | "no" | "skip";
  gradedAt: string;
}

export interface GradedFile {
  grades: Graded[];
  regrades: { id: string; answer: "yes" | "no" | "skip" }[];
}

/** Fisher-Yates over a copy of `values`, driven by an already-seeded generator. */
function shuffled<T>(values: T[], random: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const vi = out[i]!;
    out[i] = out[j]!;
    out[j] = vi;
  }
  return out;
}

function toSampled(gate: Sampled["gate"], item: Item, hypothesis: Hypothesis): Sampled {
  return { gate, findingId: item.finding.id, finding: item.finding, hypothesis, line: { en: item.line.en } };
}

/**
 * Shuffles the run's findings, then takes at most one published hypothesis per finding
 * until it has `perSide`, and separately at most one rejected hypothesis (any stage but
 * "published") per finding until it has `perSide` more, and shuffles the two sides
 * together so a reader can't tell which is which from where it sits.
 */
export function sample(file: RunFile, perSide: number, seed: number): Sampled[] {
  const random = rng(seed);
  const findings = shuffled(file.items, random);

  const published: Sampled[] = [];
  for (const item of findings) {
    if (published.length >= perSide) break;
    const hypothesis = item.hypotheses.find((h) => h.stage === "published");
    if (hypothesis) published.push(toSampled("published", item, hypothesis));
  }

  const rejected: Sampled[] = [];
  for (const item of findings) {
    if (rejected.length >= perSide) break;
    const hypothesis = item.hypotheses.find((h) => h.stage !== "published");
    if (hypothesis) rejected.push(toSampled("rejected", item, hypothesis));
  }

  return shuffled([...published, ...rejected], random);
}

/** Draws `n` from the items already answered yes or no (never a skip), shuffled by `seed`. */
export function regradeSample(graded: Graded[], n: number, seed: number): Graded[] {
  const eligible = graded.filter((g) => g.answer === "yes" || g.answer === "no");
  const random = rng(seed);
  return shuffled(eligible, random).slice(0, n);
}

/** A finding and its hypothesis's check, folded into 12 hex characters: the same pair always lands on the same id, so a re-run recognises what it already graded. */
function gradedId(findingId: string, check: Hypothesis["evidence"]["check"]): string {
  return hash(findingId + signature(check)).slice(0, 12);
}

/** Turns a drawn item into the record `insights/graded.json` keeps. */
export function toGraded(sampled: Sampled, answer: Graded["answer"], gradedAt: string): Graded {
  return {
    id: gradedId(sampled.findingId, sampled.hypothesis.evidence.check),
    findingId: sampled.findingId,
    gate: sampled.gate,
    item: { finding: sampled.finding, line: sampled.line, hypothesis: sampled.hypothesis },
    answer,
    gradedAt,
  };
}

/** The drawn items not already in `graded`, by the same id `toGraded` would give them. */
export function ungraded(sampled: Sampled[], graded: Graded[]): Sampled[] {
  const seen = new Set(graded.map((g) => g.id));
  return sampled.filter((s) => !seen.has(gradedId(s.findingId, s.hypothesis.evidence.check)));
}

export function appendGrade(file: GradedFile, graded: Graded): GradedFile {
  return { grades: [...file.grades, graded], regrades: file.regrades };
}

export function appendRegrade(file: GradedFile, entry: GradedFile["regrades"][number]): GradedFile {
  return { grades: file.grades, regrades: [...file.regrades, entry] };
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

/**
 * The link test's numbers only, never its verdict: "consistent" only ever sits on a
 * published hypothesis and "not consistent" only ever sits on a rejected one, so the word
 * would give the gate away on its own. p is shown to 4 decimals, so a small but real p
 * (0.0032, say) doesn't round away to "0".
 */
function formatLinkTest(linkTest: NonNullable<Hypothesis["linkTest"]>): string {
  if (linkTest.verdict === "refused") return "couldn't be tested";
  const placebos = linkTest.placeboEffects.map((e) => round(e, 2)).join(", ");
  return `effect ${round(linkTest.effect, 2)}, p ${round(linkTest.p, 4)}; unrelated measures: ${placebos}`;
}

/**
 * What the owner sees for one item: the finding line, the claim, the premise with its
 * numbers, the link, and the link test's result when there is one. Never the gate, the
 * stage or the reason - grading is blind to all 3.
 */
export function formatItem(item: { finding: Finding; line: { en: string }; hypothesis: Hypothesis }): string {
  const lines = [
    item.line.en,
    `claim: ${item.hypothesis.claim.en}`,
    `premise: ${item.hypothesis.premise.en} (${formatNumbers(item.hypothesis.evidence.numbers)})`,
    `link: ${item.hypothesis.link.en}`,
  ];
  if (item.hypothesis.linkTest) lines.push(`link test: ${formatLinkTest(item.hypothesis.linkTest)}`);
  return lines.join("\n");
}

const RUN_PATH = ".cache/insights/runs/latest.json";
export const GRADED_PATH = "insights/graded.json";
// 50 per side, the size the brief's own sample() test draws. This and REGRADE_N are
// stated on the site's methods page, which reads them from here.
export const PER_SIDE = 50;
const SEED = 1;
export const REGRADE_N = 25;
const REGRADE_SEED = 1;

type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** No run file at all gets the usual nudge; one that exists but can't be read or parsed gets its own message, since that's a different problem to fix. */
async function loadRunFile(): Promise<Loaded<RunFile>> {
  let raw: string;
  try {
    raw = await readFile(RUN_PATH, "utf8");
  } catch (error) {
    if (isMissing(error)) return { ok: false, message: "no run yet: run `pnpm insights` first" };
    return { ok: false, message: `couldn't read ${RUN_PATH}: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as RunFile };
  } catch (error) {
    return { ok: false, message: `${RUN_PATH} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * A missing graded.json is the normal first run and starts empty; one that exists but can't
 * be read, parsed or doesn't hold the shape it should is reported and stops the run, rather
 * than silently starting over on top of it, which would lose every grade already saved.
 */
export async function loadGradedFile(path: string): Promise<Loaded<GradedFile>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { ok: true, value: { grades: [], regrades: [] } };
    return { ok: false, message: `couldn't read ${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
  let parsed: Partial<GradedFile>;
  try {
    parsed = JSON.parse(raw) as Partial<GradedFile>;
  } catch (error) {
    return { ok: false, message: `${path} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!Array.isArray(parsed.grades) || !Array.isArray(parsed.regrades)) {
    return { ok: false, message: `${path} isn't shaped like a graded file: it needs grades and regrades arrays` };
  }
  return { ok: true, value: { grades: parsed.grades, regrades: parsed.regrades } };
}

/** Writes to a temporary name in the same directory, then renames it into place, so a quit or a crash mid-write never leaves a half-written file to be read back. */
async function saveGradedFile(path: string, file: GradedFile): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 16)}`);
  await writeFile(tmp, JSON.stringify(file, null, 2));
  await rename(tmp, path);
}

async function askAnswer(rl: ReturnType<typeof createInterface>): Promise<"yes" | "no" | "skip" | "quit"> {
  for (;;) {
    const raw = (await rl.question("y/n/s/q> ")).trim().toLowerCase();
    if (raw === "y") return "yes";
    if (raw === "n") return "no";
    if (raw === "s") return "skip";
    if (raw === "q") return "quit";
    console.log("type y, n, s or q");
  }
}

/**
 * The interactive loop both commands run: show each item, read an answer, fold it into the
 * file and save right away. `render` and `merge` are what tells a grading run from a
 * regrading one apart; `q` (or a crash) stops the loop but never loses an answer already
 * saved.
 */
async function interactiveLoop<T>(
  items: T[],
  startFile: GradedFile,
  gradedPath: string,
  render: (item: T) => string,
  merge: (file: GradedFile, item: T, answer: "yes" | "no" | "skip") => GradedFile,
): Promise<void> {
  let file = startFile;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const [i, item] of items.entries()) {
      console.log(`\n[${i + 1}/${items.length}]`);
      console.log(render(item));
      const answer = await askAnswer(rl);
      if (answer === "quit") {
        console.log("saved, quitting");
        return;
      }
      file = merge(file, item, answer);
      await saveGradedFile(gradedPath, file);
    }
    console.log("done");
  } finally {
    rl.close();
  }
}

async function runGrade(runFile: RunFile, startFile: GradedFile, gradedPath: string): Promise<void> {
  const items = ungraded(sample(runFile, PER_SIDE, SEED), startFile.grades);
  if (items.length === 0) {
    console.log("nothing left to grade");
    return;
  }
  await interactiveLoop(items, startFile, gradedPath, formatItem, (file, item, answer) =>
    appendGrade(file, toGraded(item, answer, new Date().toISOString())),
  );
}

async function runRegrade(startFile: GradedFile, gradedPath: string): Promise<void> {
  const regradedIds = new Set(startFile.regrades.map((r) => r.id));
  const eligible = startFile.grades.filter((g) => !regradedIds.has(g.id));
  const items = regradeSample(eligible, REGRADE_N, REGRADE_SEED);
  if (items.length === 0) {
    console.log("nothing left to regrade");
    return;
  }
  await interactiveLoop(items, startFile, gradedPath, (g) => formatItem(g.item), (file, item, answer) =>
    appendRegrade(file, { id: item.id, answer }),
  );
}

async function main(): Promise<void> {
  const run = await loadRunFile();
  if (!run.ok) {
    console.log(run.message);
    process.exitCode = 1;
    return;
  }

  const graded = await loadGradedFile(GRADED_PATH);
  if (!graded.ok) {
    console.log(graded.message);
    process.exitCode = 1;
    return;
  }

  const isRegrade = process.argv.slice(2).includes("--regrade");
  if (isRegrade) await runRegrade(graded.value, GRADED_PATH);
  else await runGrade(run.value, graded.value, GRADED_PATH);
}

// Runs the CLI when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
