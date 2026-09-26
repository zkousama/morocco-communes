/**
 * The owner's spot-check: `SPOT_CHECK_ITEMS` of the rating plan's reasons and disagreements
 * (`spotItems`), answered on the same blind screen the rating shows, with the jury's own
 * checklist (`checklist.ts`): the 3 checks for the reason, then, for a disagreement, whether
 * each counter-test breaks it. `CHECKLIST_GUIDE` prints before the first item and again on
 * `?`. Answers go to `insights/pilot/spot.json`, item ids and enums only, saved after each
 * item, so quitting with `q` loses nothing already answered, and a re-run picks up at the
 * first item without an answer. The jury (`pnpm insights:pilot:jury`) refuses to run until
 * every one of these items has an answer, so the owner answers before any jury output exists.
 * How far the owner and the jury agree on them is reported only: no rule reads it.
 *
 * Built on `rate.ts`'s own pieces (`screen`, `counterText`, its `Prompter` and `RatingIO`
 * injection and its save-after-each loop) rather than its `runRating`, which is typed to the
 * rating's own yes, no or skip answers.
 */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { loadData } from "../data.ts";
import { messageOf, writeJsonAtomic } from "../model.ts";
import { rng } from "../stats.ts";
import { BREAKS_QUESTION, CHECKLIST_GUIDE, CHECKS, QUESTIONS, type ChecklistAnswer, type CheckName, type Tri } from "./checklist.ts";
import { STAGE_A_PATH, STAGE_B_PATH } from "./cli.ts";
import {
  counterText,
  loadRatings,
  RATINGS_PATH,
  readStageFiles,
  screen,
  screenInputs,
  type Prompter,
  type RatingIO,
  type RatingItem,
  type UnitNamer,
} from "./rate.ts";
import { shuffle } from "./sample.ts";
import { PILOT_SEED, SPOT_CHECK_ITEMS } from "./setups.ts";
import type { StageA, StageB } from "./stages.ts";

export const SPOT_PATH = "insights/pilot/spot.json";

export interface SpotAnswer extends ChecklistAnswer {
  itemId: string;
}

/** `insights/pilot/spot.json`: the sampled item ids, in the order they're asked, and the owner's answers so far. */
export interface SpotCheck {
  items: string[];
  answers: SpotAnswer[];
}

/**
 * The spot-check's items: the plan's reasons and disagreements (never a drift item), sorted
 * by item id so the draw doesn't hang on the plan's own order, then shuffled with `seed` and
 * cut to `SPOT_CHECK_ITEMS`.
 */
export function spotItems(plan: RatingItem[], seed: number = PILOT_SEED): RatingItem[] {
  const pool = plan.filter((item) => item.kind !== "drift").sort((x, y) => (x.itemId < y.itemId ? -1 : x.itemId > y.itemId ? 1 : 0));
  shuffle(pool, rng(seed));
  return pool.slice(0, SPOT_CHECK_ITEMS);
}

/** The spot-check's item ids not answered yet, in the order they're asked. */
export function spotRemaining(spot: SpotCheck): string[] {
  const answered = new Set(spot.answers.map((x) => x.itemId));
  return spot.items.filter((id) => !answered.has(id));
}

/**
 * How many of the plan's own spot-check items (`spotItems(plan)`, recomputed rather than
 * read off the file) have no answer in `spot`; all of them when there's no file at all.
 */
export function unansweredSpotItems(spot: SpotCheck | null, plan: RatingItem[]): number {
  const answered = new Set((spot?.answers ?? []).map((x) => x.itemId));
  return spotItems(plan).filter((item) => !answered.has(item.itemId)).length;
}

const HINT = "(y/n/u, ? for the guide, q to quit) ";

/** One answer: yes, no or unsure, or "quit". `?` prints the guide and asks the same question again. */
async function askTri(rl: Prompter, io: RatingIO, question: string): Promise<Tri | "quit"> {
  for (;;) {
    const raw = (await rl.question(question)).trim().toLowerCase();
    if (raw === "y") return "yes";
    if (raw === "n") return "no";
    if (raw === "u") return "unsure";
    if (raw === "q") return "quit";
    if (raw === "?") io.log(CHECKLIST_GUIDE);
    else io.log("type y, n, u, ? or q");
  }
}

/** One item's whole flow: the screen and its 3 checks, then each counter-test and whether it breaks the reason; "quit" drops this item's own answers. */
async function answerSpotItem(
  item: RatingItem & { kind: "reason" | "disagreement" },
  a: StageA,
  b: StageB,
  lines: Map<string, { en: string; fr: string }>,
  unitName: UnitNamer,
  rl: Prompter,
  io: RatingIO,
): Promise<SpotAnswer | "quit"> {
  io.log(screen(item, a, b, lines));
  const checks = {} as Record<CheckName, Tri>;
  for (const [i, check] of CHECKS.entries()) {
    const answer = await askTri(rl, io, `${i + 1}. ${QUESTIONS[check]} ${HINT}`);
    if (answer === "quit") return "quit";
    checks[check] = answer;
  }
  if (item.kind === "reason") return { itemId: item.itemId, ...checks };

  const counters: Record<string, Tri> = {};
  for (const counterId of item.counterIds) {
    io.log(counterText(item.candidateId, counterId, b, unitName));
    const answer = await askTri(rl, io, `${BREAKS_QUESTION} ${HINT}`);
    if (answer === "quit") return "quit";
    counters[counterId] = answer;
  }
  return { itemId: item.itemId, ...checks, counters };
}

/**
 * Prints the guide, then asks every item `start` hasn't answered yet (`spotRemaining`), each
 * looked up in `plan`, saving `start` plus every answer so far to `path` right after each
 * item. Returns the spot-check as it now stands on disk. Takes the prompter, the stage data
 * and where to print as parameters, so a test never touches a real terminal or the real file.
 */
export async function runSpotCheck(
  a: StageA,
  b: StageB,
  lines: Map<string, { en: string; fr: string }>,
  unitName: UnitNamer,
  plan: RatingItem[],
  start: SpotCheck,
  path: string,
  rl: Prompter,
  io: RatingIO,
): Promise<SpotCheck> {
  const remaining = spotRemaining(start);
  if (remaining.length === 0) {
    io.log("nothing left to answer");
    return start;
  }

  const byId = new Map(plan.map((item) => [item.itemId, item]));
  io.log(CHECKLIST_GUIDE);
  let spot = start;
  for (const [i, itemId] of remaining.entries()) {
    const item = byId.get(itemId);
    if (!item || item.kind === "drift") throw new Error(`the spot-check names ${itemId}, which isn't a reason or a disagreement in the plan`);
    io.log(`\n[${i + 1}/${remaining.length}]`);
    const result = await answerSpotItem(item, a, b, lines, unitName, rl, io);
    if (result === "quit") {
      io.log("saved, quitting");
      return spot;
    }
    spot = { ...spot, answers: [...spot.answers, result] };
    await writeJsonAtomic(path, spot);
  }
  io.log("done");
  return spot;
}

/** The saved spot-check, or null when there's none yet. */
export async function loadSpot(path: string): Promise<SpotCheck | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new Error(`couldn't read ${path}: ${messageOf(error)}`);
  }
  const parsed = JSON.parse(raw) as Partial<SpotCheck>;
  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.answers)) throw new Error(`${path} isn't a spot-check: it needs an "items" list and an "answers" list`);
  return parsed as SpotCheck;
}

async function main(): Promise<void> {
  const stages = await readStageFiles(STAGE_A_PATH, STAGE_B_PATH);
  if (!stages.ok) {
    console.log(stages.message);
    process.exitCode = 1;
    return;
  }
  const screens = screenInputs(stages.a.findingIds, loadData());
  if (!screens.ok) {
    console.log(screens.message);
    process.exitCode = 1;
    return;
  }

  const ratings = await loadRatings(RATINGS_PATH);
  if (ratings.items.length === 0) {
    console.log(`there's no rating plan in ${RATINGS_PATH} yet: \`pnpm insights:pilot:rate\` draws it (type q at its first item to stop there)`);
    process.exitCode = 1;
    return;
  }

  // The items are always the plan's own draw; only the answers are read back from the file.
  const saved = await loadSpot(SPOT_PATH);
  const start: SpotCheck = { items: spotItems(ratings.items).map((item) => item.itemId), answers: saved?.answers ?? [] };

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runSpotCheck(stages.a, stages.b, screens.lines, screens.unitName, ratings.items, start, SPOT_PATH, rl, { log: (line) => console.log(line) });
  } finally {
    rl.close();
  }
}

// Runs the spot-check when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
