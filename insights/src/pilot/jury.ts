/**
 * The checklist jury, the preregistration's second amendment: 3 models from families none
 * of the pilot's own setups come from (`JUDGES`) answer every reason and disagreement in the
 * rating plan with the owner's own checklist (`checklist.ts`), once each, at temperature 0 and
 * the model's default reasoning, from the same blind text the owner's screen shows
 * (`juryPrompt`). Each question goes to the majority (`majority`), and the majority answers
 * are written into `insights/pilot/ratings.json` in the rating's own shape (`toRatings`), so
 * the analysis and its 6 rules read them exactly as they'd have read the owner's.
 *
 * Agreement between the judges is reported as how stable their answers are
 * (`juryAgreement`), and the owner's own spot-check against the jury's majority
 * (`spotAgreement`); neither is read by a rule. `insights/pilot/jury.json` holds ids, enums,
 * model ids, usage and timings, and nothing a judge wrote in its own words.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadData } from "../data.ts";
import {
  addUsage,
  classify,
  CLOUDFLARE_MAX_TOKENS,
  cloudflareTransport,
  compactCount,
  FatalError,
  groqTransport,
  inputOf,
  LimitError,
  makeRunner,
  messageOf,
  NO_USAGE,
  readLocal,
  RETRY_DEFAULTS,
  STOP_AFTER_FAILURES,
  withRetries,
  writeJsonAtomic,
  type Local,
  type ModelCall,
  type ModelReply,
  type Runner,
  type Usage,
} from "../model.ts";
import { agreementOf, JURY_PATH } from "./analyse.ts";
import { CHECKLIST_GUIDE, CHECKS, MEASURES, TRI, verdictOf, type ChecklistAnswer, type CheckName, type Measure, type Tri } from "./checklist.ts";
import { CACHE_DIR, STAGE_A_PATH, STAGE_B_PATH } from "./cli.ts";
import { counterText, loadRatings, RATINGS_PATH, readStageFiles, screen, screenInputs, type RatingItem, type Ratings, type UnitNamer } from "./rate.ts";
import { SPOT_CHECK_ITEMS } from "./setups.ts";
import { loadSpot, SPOT_PATH, spotItems, unansweredSpotItems, type SpotCheck } from "./spot.ts";
import { SetupError, type StageA, type StageB } from "./stages.ts";

export type Provider = "groq" | "cloudflare";

export interface Judge {
  id: string;
  provider: Provider;
  model: string;
  family: string;
  fallback?: { provider: Provider; model: string; family: string }; // the one model that may stand in, if this one's withdrawn
}

/** The amendment's jury, in the order it runs. J2's model is a preview: if it's withdrawn (a 404 at its first call), `fallback` takes its place before any of its answers count. */
export const JUDGES: Judge[] = [
  { id: "J1", provider: "groq", model: "openai/gpt-oss-120b", family: "OpenAI" },
  {
    id: "J2",
    provider: "groq",
    model: "qwen/qwen3.8-27b",
    family: "Alibaba",
    fallback: { provider: "cloudflare", model: "@cf/google/gemma-4-26b-a4b-it", family: "Google" },
  },
  { id: "J3", provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", family: "Meta" },
];

/** The keys each provider's transport reads from the local keys file. */
const KEYS_BY_PROVIDER: Record<Provider, string[]> = {
  groq: ["GROQ_API_KEY"],
  cloudflare: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
};

/** What the jury is told: how an item reads, the owner's guide word for word, and the JSON it answers with. */
export const JURY_SYSTEM = [
  "You're checking reasons offered for a figure that stands out in Morocco's census. Each item shows the figure, a claim, the premise the claim rests on with the numbers its data test computed, and the link from the premise to the figure, each in English then in French. Some items also show counter-tests: checks made on the census data against the reason, each labelled with its id in square brackets and followed by the numbers it computed.",
  "",
  CHECKLIST_GUIDE,
  "",
  'Answer with one JSON object only. Each ANSWER below is "yes", "no" or "unsure".',
  "For an item with no counter-tests, the object holds the 3 checks, in order:",
  '{"claimBeyondPremise": ANSWER, "linkExplainsFinding": ANSWER, "ignoresObviousAlternative": ANSWER}',
  'For an item with counter-tests, it also holds "counters", whether each counter-test breaks the reason, keyed by every counter-test\'s id:',
  '{"claimBeyondPremise": ANSWER, "linkExplainsFinding": ANSWER, "ignoresObviousAlternative": ANSWER, "counters": {"COUNTER_ID": ANSWER}}',
].join("\n");

/** What a judge sees for `item`: the owner's own screen, then, for a disagreement, each counter-test labelled by its id. No setup, model, run or stage. */
export function juryPrompt(
  item: RatingItem & { kind: "reason" | "disagreement" },
  a: StageA,
  b: StageB,
  lines: Map<string, { en: string; fr: string }>,
  unitName: UnitNamer,
): string {
  const block = screen(item, a, b, lines);
  if (item.kind === "reason") return block;
  const counters = item.counterIds.map((id) => `[${id}] ${counterText(item.candidateId, id, b, unitName)}`);
  return [block, "", "counter-tests:", ...counters].join("\n");
}

/** Where the object that opens at `start` closes, strings and their escapes respected; -1 when it never does. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * The first JSON object in `text`, or undefined when there's none: a reasoning block
 * (`<think>...</think>`, which some models put in their answer) is left out first, since a
 * draft inside it isn't the answer, and anything in braces that doesn't parse as an object is
 * passed over.
 */
function firstJsonObject(text: string): unknown {
  const answer = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  for (let start = answer.indexOf("{"); start >= 0; start = answer.indexOf("{", start + 1)) {
    const end = closingBrace(answer, start);
    if (end < 0) continue;
    try {
      const value: unknown = JSON.parse(answer.slice(start, end + 1));
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Not JSON: try the next opening brace.
    }
  }
  return undefined;
}

const triSchema = z.enum(TRI as [Tri, ...Tri[]]);
const checksSchema = z.object({ claimBeyondPremise: triSchema, linkExplainsFinding: triSchema, ignoresObviousAlternative: triSchema });
const countersSchema = z.record(z.string(), z.unknown());

/**
 * A judge's answers to `item`, read from the first JSON object in its reply, or null when the
 * reply is unusable: no object, a check missing or outside yes, no and unsure, or, for a
 * disagreement, no usable `breaks` for one of its counter-tests. Only the enums are kept, and
 * only for the counter ids the item asked about, so nothing a judge wrote in its own words
 * ever reaches a file.
 */
export function readJudgeReply(text: string, item: RatingItem): ChecklistAnswer | null {
  if (item.kind === "drift") return null;
  const found = firstJsonObject(text);
  const checks = checksSchema.safeParse(found);
  if (!checks.success) return null;
  const answer: ChecklistAnswer = {
    claimBeyondPremise: checks.data.claimBeyondPremise,
    linkExplainsFinding: checks.data.linkExplainsFinding,
    ignoresObviousAlternative: checks.data.ignoresObviousAlternative,
  };
  if (item.kind === "reason") return answer;

  const given = countersSchema.safeParse((found as { counters?: unknown }).counters);
  if (!given.success) return null;
  const counters: Record<string, Tri> = {};
  for (const id of item.counterIds) {
    const one = triSchema.safeParse(given.data[id]);
    if (!one.success) return null;
    counters[id] = one.data;
  }
  return { ...answer, counters };
}

/** One question's majority: the judges' usable yes and no answers, unsure and unusable ones abstaining; a tie, or fewer than 2 answers, is unsure. */
export function majority(answers: readonly (Tri | null | undefined)[]): Tri {
  const yes = answers.filter((x) => x === "yes").length;
  const no = answers.filter((x) => x === "no").length;
  if (yes + no < 2 || yes === no) return "unsure";
  return yes > no ? "yes" : "no";
}

/** Each judge's answers to each item: null when its reply was unusable, or its call failed. */
export type AnswersByJudge = Record<string, Record<string, ChecklistAnswer | null>>;

/** The replies `JUDGES` gave `itemId`, in jury order, a missing one read as unusable. */
const repliesTo = (answersByJudge: AnswersByJudge, itemId: string): (ChecklistAnswer | null)[] =>
  JUDGES.map((judge) => answersByJudge[judge.id]?.[itemId] ?? null);

/** The majority on each of the 3 checks. */
function majorityChecks(replies: (ChecklistAnswer | null)[]): Record<CheckName, Tri> {
  return Object.fromEntries(CHECKS.map((check) => [check, majority(replies.map((r) => r?.[check]))])) as Record<CheckName, Tri>;
}

const asRating = (answer: Tri): "yes" | "no" | "skip" => (answer === "unsure" ? "skip" : answer);

/**
 * The jury's majority answers in the rating's own shape: a reason is yes (sound) on the
 * majority's no, yes and no, no on any other set of yes and no, and a skip once any of the 3
 * is unsure; each counter-test is the majority of `breaks`, a tie or fewer than 2 answers a
 * skip; a drift item is always a skip, since the drift check doesn't apply to a jury. `at`
 * stamps every answer.
 */
export function toRatings(plan: RatingItem[], answersByJudge: AnswersByJudge, at: string): Ratings {
  const answers = plan.map((item): Ratings["answers"][number] => {
    if (item.kind === "drift") return { itemId: item.itemId, answer: "skip", at };
    const replies = repliesTo(answersByJudge, item.itemId);
    const verdict = verdictOf(majorityChecks(replies));
    const answer = verdict === "unsure" ? "skip" : verdict === "sound" ? "yes" : "no";
    if (item.kind === "reason") return { itemId: item.itemId, answer, at };
    const counters = Object.fromEntries(item.counterIds.map((id) => [id, asRating(majority(replies.map((r) => r?.counters?.[id])))]));
    return { itemId: item.itemId, answer, counters, at };
  });
  return { items: plan, answers };
}

/** Agreement between 2 raters over `n` answers both gave: the share that match, and `agreementOf` (1 on full agreement, else Cohen's kappa); both null with nothing to compare. */
export interface Agreement {
  n: number;
  raw: number | null;
  kappa: number | null;
}

export interface JuryAgreement {
  pairs: Record<string, Record<Measure, Agreement>>; // "J1|J2" -> each measure, over the items both judges answered usably
  all: Record<Measure, { n: number; share: number | null }>; // the share where all 3 judges agree, over the items all 3 answered usably
}

/** The owner's spot-check against the jury's majority: how many sampled items it read, and each measure's agreement. */
export interface SpotAgreement {
  items: number;
  measures: Record<Measure, Agreement>;
}

function agreementOver(pairs: [string, string][]): Agreement {
  if (pairs.length === 0) return { n: 0, raw: null, kappa: null };
  const x = pairs.map((p) => p[0]);
  const y = pairs.map((p) => p[1]);
  return { n: pairs.length, raw: pairs.filter(([p, q]) => p === q).length / pairs.length, kappa: agreementOf(x, y) };
}

/** Every label a set of answers gives `item`, by measure: `breaks` once per counter-test. */
function labelsOf(item: RatingItem & { kind: "reason" | "disagreement" }, answer: Pick<ChecklistAnswer, CheckName> & { counters?: Record<string, Tri | undefined> }): Record<Measure, string[]> {
  return {
    claimBeyondPremise: [answer.claimBeyondPremise],
    linkExplainsFinding: [answer.linkExplainsFinding],
    ignoresObviousAlternative: [answer.ignoresObviousAlternative],
    sound: [verdictOf(answer)],
    breaks: item.kind === "disagreement" ? item.counterIds.map((id) => answer.counters?.[id] ?? "") : [],
  };
}

const perMeasure = <T>(make: () => T): Record<Measure, T> => Object.fromEntries(MEASURES.map((m) => [m, make()])) as Record<Measure, T>;

const askedItems = (plan: RatingItem[]) => plan.filter((item): item is RatingItem & { kind: "reason" | "disagreement" } => item.kind !== "drift");

/**
 * How stable the jury's answers are: for each pair of judges, `agreementOf` and the raw
 * share on each check, on each judge's own verdict read off its 3 checks (sound, unsound, or
 * unsure when any check is), and on `breaks`, over the items both judges answered usably,
 * unsure counting as an answer of its own; and the share of items where all 3 give the same
 * answer, over the items all 3 answered usably.
 */
export function juryAgreement(plan: RatingItem[], answersByJudge: AnswersByJudge): JuryAgreement {
  const items = askedItems(plan);
  const pairs: JuryAgreement["pairs"] = {};
  for (const [i, x] of JUDGES.entries()) {
    for (const y of JUDGES.slice(i + 1)) {
      const rows = perMeasure<[string, string][]>(() => []);
      for (const item of items) {
        const rx = answersByJudge[x.id]?.[item.itemId];
        const ry = answersByJudge[y.id]?.[item.itemId];
        if (!rx || !ry) continue;
        const lx = labelsOf(item, rx);
        const ly = labelsOf(item, ry);
        for (const m of MEASURES) lx[m].forEach((label, k) => rows[m].push([label, ly[m][k]!]));
      }
      pairs[`${x.id}|${y.id}`] = Object.fromEntries(MEASURES.map((m) => [m, agreementOver(rows[m])])) as Record<Measure, Agreement>;
    }
  }

  const same = perMeasure<boolean[]>(() => []);
  for (const item of items) {
    const replies = repliesTo(answersByJudge, item.itemId);
    if (replies.some((r) => r === null)) continue;
    const labels = replies.map((r) => labelsOf(item, r!));
    for (const m of MEASURES) labels[0]![m].forEach((label, k) => same[m].push(labels.every((l) => l[m][k] === label)));
  }
  const all = Object.fromEntries(
    MEASURES.map((m) => [m, { n: same[m].length, share: same[m].length === 0 ? null : same[m].filter(Boolean).length / same[m].length }]),
  ) as JuryAgreement["all"];
  return { pairs, all };
}

/**
 * The owner's spot-check against the jury: on each item of the plan's own sample
 * (`spotItems`) the owner answered, each of the owner's answers against the jury's majority
 * on that question, and the owner's verdict against the one the majority's 3 checks give.
 * Unsure counts as an answer of its own on both sides. Reported only: no rule reads it.
 */
export function spotAgreement(spot: SpotCheck, plan: RatingItem[], answersByJudge: AnswersByJudge): SpotAgreement {
  const owner = new Map(spot.answers.map((x) => [x.itemId, x]));
  const rows = perMeasure<[string, string][]>(() => []);
  let items = 0;
  for (const item of askedItems(spotItems(plan))) {
    const mine = owner.get(item.itemId);
    if (!mine) continue;
    items++;
    const replies = repliesTo(answersByJudge, item.itemId);
    const jury = {
      ...majorityChecks(replies),
      counters: item.kind === "disagreement" ? Object.fromEntries(item.counterIds.map((id) => [id, majority(replies.map((r) => r?.counters?.[id]))])) : undefined,
    };
    const lo = labelsOf(item, mine);
    const lj = labelsOf(item, jury);
    for (const m of MEASURES) {
      lo[m].forEach((label, k) => {
        if (label !== "") rows[m].push([label, lj[m][k]!]);
      });
    }
  }
  return { items, measures: Object.fromEntries(MEASURES.map((m) => [m, agreementOver(rows[m])])) as Record<Measure, Agreement> };
}

/**
 * Why the jury can't start, or null: no plan to rate yet; a plan that already has answers,
 * unless `forceReplace`; or the owner's spot-check not finished, so the owner always answers
 * before any jury output exists.
 */
export function juryRefusal(ratings: Ratings, spot: SpotCheck | null, forceReplace: boolean): string | null {
  if (ratings.items.length === 0) return `there's no rating plan in ${RATINGS_PATH} yet: \`pnpm insights:pilot:rate\` draws it`;
  const n = ratings.answers.length;
  if (n > 0 && !forceReplace) return `${RATINGS_PATH} already has ${n} answer${n === 1 ? "" : "s"}: pass --force-replace to replace them with the jury's`;
  const left = unansweredSpotItems(spot, ratings.items);
  if (left > 0) return `the owner's spot-check isn't finished: ${left} of ${SPOT_CHECK_ITEMS} items still to answer; run \`pnpm insights:pilot:spot\` first`;
  return null;
}

const listed = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Every key a judge (or J2's stand-in) needs that the local keys file doesn't have, named in a message; null when they're all there. Never a value. */
export function missingJudgeKeys(local: Local | null): string | null {
  const providers = new Set(JUDGES.flatMap((judge) => [judge.provider, ...(judge.fallback ? [judge.fallback.provider] : [])]));
  const needed = [...providers].flatMap((provider) => KEYS_BY_PROVIDER[provider]);
  if (!local) return `the jury needs INSIGHTS_LOCAL set, naming the folder whose keys.env holds ${listed(needed)}`;
  const missing = needed.filter((key) => !local.keys[key]);
  return missing.length === 0 ? null : `the jury needs ${listed(missing)} in the local keys file`;
}

// ---------------------------------------------------------------------------------------
// Running the jury
// ---------------------------------------------------------------------------------------

/**
 * The most neurons the Cloudflare judges may use in one UTC day, together. The free allowance
 * is 10,000 a day; stopping short of it keeps the jury free whatever plan the account is on.
 */
export const CLOUDFLARE_DAILY_NEURONS = 9_000;

/** Where the command keeps each UTC day's Cloudflare total, beside the pilot's cache, so a re-run the same day starts from what's already spent. */
export const NEURONS_PATH = join(".cache", "insights", "pilot", "cloudflare-neurons.json");

/** Cloudflare's published price for each Cloudflare model the jury can use, in neurons per million tokens, for a reply that doesn't report its own neurons. */
export const NEURONS_PER_MILLION: Record<string, { input: number; output: number }> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
  "@cf/google/gemma-4-26b-a4b-it": { input: 9_091, output: 27_273 },
};

/** The neurons a reply cost: what its usage reports, or else an estimate from its tokens at the model's own rate (0 for a model with no known rate). */
export function neuronsOf(model: string, usage: Usage): number {
  if (usage.neurons !== undefined) return usage.neurons;
  const rate = NEURONS_PER_MILLION[model];
  return rate ? (usage.input * rate.input + usage.output * rate.output) / 1e6 : 0;
}

/** The most a Cloudflare call can cost before it's made: its instructions and prompt at about 4 characters a token, and a reply as long as `CLOUDFLARE_MAX_TOKENS` allows. */
function callCeiling(model: string, call: ModelCall): number {
  const rate = NEURONS_PER_MILLION[model];
  return rate ? (Math.ceil((call.system.length + call.prompt.length) / 4) * rate.input + CLOUDFLARE_MAX_TOKENS * rate.output) / 1e6 : 0;
}

/** Each UTC day's Cloudflare total so far, by "YYYY-MM-DD". */
export interface NeuronLedger {
  spent(day: string): Promise<number>;
  add(day: string, neurons: number): Promise<void>;
}

/** A ledger held in memory, for a test: `days` is its whole state. */
export function memoryLedger(start: Record<string, number> = {}): NeuronLedger & { days: Record<string, number> } {
  const days = { ...start };
  return {
    days,
    spent: async (day) => days[day] ?? 0,
    add: async (day, neurons) => {
      days[day] = (days[day] ?? 0) + neurons;
    },
  };
}

/** A ledger kept as JSON at `path` ({"YYYY-MM-DD": neurons}), read on every call and written with a temp-and-rename after every addition. */
export function fileLedger(path: string): NeuronLedger {
  const read = async (): Promise<Record<string, number>> => {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Record<string, number>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {};
      throw new Error(`couldn't read ${path}: ${messageOf(error)}`);
    }
  };
  return {
    spent: async (day) => (await read())[day] ?? 0,
    add: async (day, neurons) => {
      const days = await read();
      days[day] = (days[day] ?? 0) + neurons;
      await writeJsonAtomic(path, days);
    },
  };
}

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/** One judge's run, as it actually ran: J2 carries its stand-in's provider, model and family once it switched. */
export interface JudgeRun {
  id: string;
  provider: Provider;
  model: string;
  family: string;
  answers: Record<string, ChecklistAnswer | null>; // by item id; null when the reply was unusable or the call failed
  asked: number;
  usable: number;
  failed: number; // calls that threw, each item's answer then unusable
  unsure: number; // unsure answers across every usable reply's checks and breaks
  calls: number; // replies that came back, from the cache included
  usage: Usage;
  ms: number; // answering time, waits for a retry or a limit left out
  waitedMs: number;
  answered: string[]; // every model id a reply came back with, sorted and distinct
}

/** J2's switch to its stand-in, when its own model was withdrawn. */
export interface JuryFallback {
  judge: string;
  from: string;
  to: string;
  status: 404;
}

export interface JuryRun {
  judges: JudgeRun[];
  fallback: JuryFallback | null;
}

export interface JuryOptions {
  unitName: UnitNamer;
  ledger: NeuronLedger;
  neuronLimit?: number;
  now?: () => Date;
  onProgress?: (judgeId: string, model: string, done: number, total: number) => void;
}

const countUnsure = (answer: ChecklistAnswer): number =>
  CHECKS.filter((check) => answer[check] === "unsure").length + Object.values(answer.counters ?? {}).filter((x) => x === "unsure").length;

/**
 * Asks each judge in `JUDGES`, in order, every reason and disagreement in `plan` (never a
 * drift item), one call at a time, through the runner for its provider: stage "jury", key `${judgeId}:${itemId}`, the judge's own model, `accept`
 * left off so every answer, unusable ones included, is cached once and replayed exactly on a
 * resumed run.
 *
 * Shares stages A and B's halt: a fatal error, a `LimitError` (`withRetries` has already
 * waited that one out) or `STOP_AFTER_FAILURES` failures in a row stops every later call,
 * and this throws once that judge's loop ends, so nothing partial is ever returned. A single failure leaves that item unusable for that judge. The
 * one exception is J2's first call: a 404 there means its model was withdrawn, so J2 switches
 * to its stand-in and starts again from its first item, before any of its answers count.
 *
 * A Cloudflare judge's call is also checked against the day's neurons first (`ledger`, per UTC
 * day, across both Cloudflare judges): when what's already spent today plus the most this call
 * could cost (its input and a reply as long as `CLOUDFLARE_MAX_TOKENS` allows, or the costliest
 * reply so far if that's more) would pass `options.neuronLimit` (`CLOUDFLARE_DAILY_NEURONS`
 * unless told otherwise), the run halts, and a re-run the next UTC day resumes from the cache.
 * A reply read back from the cache costs nothing today. Calls never overlap, so each check sees
 * every call made before it.
 *
 * Throws a `SetupError`, before any call, when a provider a judge or J2's stand-in needs has
 * no runner.
 */
export async function runJury(
  plan: RatingItem[],
  a: StageA,
  b: StageB,
  lines: Map<string, { en: string; fr: string }>,
  runners: Map<Provider, Runner>,
  options: JuryOptions,
): Promise<JuryRun> {
  const needed = [...new Set(JUDGES.flatMap((judge) => [judge.provider, ...(judge.fallback ? [judge.fallback.provider] : [])]))];
  const missing = needed.filter((provider) => !runners.has(provider));
  if (missing.length > 0) throw new SetupError(`runJury: no runner for ${listed(missing.map((p) => `"${p}"`))}`);

  const items = askedItems(plan);
  const limit = options.neuronLimit ?? CLOUDFLARE_DAILY_NEURONS;
  const now = options.now ?? (() => new Date());

  const halt: { reason: string | null } = { reason: null };
  let inARow = 0;
  let costliest = 0; // the most neurons any Cloudflare reply has cost in this run, cached ones included
  let fallback: JuryFallback | null = null;
  const judges: JudgeRun[] = [];

  const noteFailure = (error: unknown): void => {
    if (classify(error) === "fatal") halt.reason ??= `a judge call failed: ${messageOf(error)}`;
    else if (error instanceof LimitError) halt.reason ??= `a judge's usage limit didn't reset in time: ${messageOf(error)}`;
    else if (++inARow >= STOP_AFTER_FAILURES) halt.reason ??= `${STOP_AFTER_FAILURES} judge calls in a row failed, the last with: ${messageOf(error)}`;
  };

  for (const judge of JUDGES) {
    let role: { provider: Provider; model: string; family: string } = { provider: judge.provider, model: judge.model, family: judge.family };
    const answers: Record<string, ChecklistAnswer | null> = {};
    const spent = { usage: NO_USAGE, ms: 0, waitedMs: 0, calls: 0, failed: 0 };
    const answered = new Set<string>();
    let done = 0;

    const askOne = async (item: RatingItem & { kind: "reason" | "disagreement" }, mayWithdraw: boolean): Promise<"withdrawn" | void> => {
      if (halt.reason) return;
      const call: ModelCall = {
        model: role.model,
        system: JURY_SYSTEM,
        prompt: juryPrompt(item, a, b, lines, options.unitName),
        stage: "jury",
        key: `${judge.id}:${item.itemId}`,
      };
      const onCloudflare = role.provider === "cloudflare";
      const day = utcDay(now());
      if (onCloudflare) {
        const today = await options.ledger.spent(day);
        if (today + Math.max(costliest, callCeiling(role.model, call)) > limit) {
          halt.reason ??= `the day's Cloudflare calls would pass ${limit.toLocaleString("en-US")} neurons: ${Math.round(today).toLocaleString("en-US")} used on ${day}, UTC; run it again after midnight UTC to resume`;
          return;
        }
      }
      let reply: ModelReply | null = null;
      try {
        reply = await runners.get(role.provider)!({ ...call, accept: undefined });
      } catch (error) {
        if (mayWithdraw && error instanceof FatalError && error.status === 404) return "withdrawn";
        spent.failed++;
        answers[item.itemId] = null;
        noteFailure(error);
      }
      if (reply) {
        inARow = 0;
        spent.usage = addUsage(spent.usage, reply.usage);
        spent.ms += reply.ms;
        spent.waitedMs += reply.waitedMs;
        spent.calls++;
        answered.add(reply.model);
        // Outside the call's own try: a ledger that can't be written stops the run rather
        // than passing for a failed call, so no neuron spent ever goes unrecorded.
        if (onCloudflare) {
          const neurons = neuronsOf(role.model, reply.usage);
          costliest = Math.max(costliest, neurons);
          if (!reply.cached) await options.ledger.add(day, neurons);
        }
        answers[item.itemId] = readJudgeReply(reply.text, item);
      }
      done++;
      if (!halt.reason) options.onProgress?.(judge.id, role.model, done, items.length);
    };

    let rest = items;
    if (judge.fallback && items.length > 0) {
      if ((await askOne(items[0]!, true)) === "withdrawn") {
        fallback = { judge: judge.id, from: judge.model, to: judge.fallback.model, status: 404 };
        role = { ...judge.fallback };
      } else {
        rest = items.slice(1);
      }
    }
    // One call at a time, always: the neuron check before a Cloudflare call reads the day's
    // total, and a second call in flight could pass that same check before either had spent.
    for (const item of rest) await askOne(item, false);
    // Nothing partial is ever returned: the answers already cached stay there for a resumed
    // run to pick straight back up from.
    if (halt.reason) throw new Error(halt.reason);

    const usable = Object.values(answers).filter((x): x is ChecklistAnswer => x !== null);
    judges.push({
      id: judge.id,
      ...role,
      answers,
      asked: items.length,
      usable: usable.length,
      failed: spent.failed,
      unsure: usable.reduce((sum, x) => sum + countUnsure(x), 0),
      calls: spent.calls,
      usage: spent.usage,
      ms: spent.ms,
      waitedMs: spent.waitedMs,
      answered: [...answered].sort(),
    });
  }
  return { judges, fallback };
}

/** A judge's line in `insights/pilot/jury.json`: ids, model ids, counts, usage and timings. */
export interface JuryFileJudge {
  id: string;
  provider: Provider;
  model: string;
  family: string;
  answered: string[];
  asked: number;
  usable: number;
  failed: number;
  unsure: number;
  calls: number;
  usage: Usage;
  secondsPerCall: number | null; // null with no call back
  waitedSeconds: number;
}

/** `insights/pilot/jury.json`, committed: ids, enums, model ids, usage, timings, the stand-in's switch and the agreement, and never a judge's own words. */
export interface JuryFile {
  ranAt: string;
  judges: JuryFileJudge[];
  fallback: JuryFallback | null;
  answers: AnswersByJudge;
  agreement: JuryAgreement;
  spotCheck: SpotAgreement;
}

/**
 * Runs the jury and reports through `io`, never throwing: a refusal before any call
 * (`juryRefusal`, or a missing runner) is reported as "can't start", a halt as "stopped", and
 * either way nothing is written, since the cached answers already have everything a resumed
 * run needs. On success, writes the jury's file, then its majority answers as the rating
 * (`toRatings`, stamped with `options.now`). Takes stubbed runners, so it's testable without
 * `INSIGHTS_LIVE` or a real transport.
 */
export async function juryAndReport(
  input: { a: StageA; b: StageB; lines: Map<string, { en: string; fr: string }>; unitName: UnitNamer; ratings: Ratings; spot: SpotCheck | null },
  runners: Map<Provider, Runner>,
  options: { ledger: NeuronLedger; forceReplace?: boolean; now?: () => Date },
  io: { log: (line: string) => void; error: (line: string) => void; writeJury: (value: JuryFile) => Promise<void>; writeRatings: (value: Ratings) => Promise<void> },
): Promise<boolean> {
  const refusal = juryRefusal(input.ratings, input.spot, options.forceReplace ?? false);
  if (refusal) {
    io.error(`the jury can't start: ${refusal}`);
    return false;
  }
  const now = options.now ?? (() => new Date());

  let run: JuryRun;
  try {
    run = await runJury(input.ratings.items, input.a, input.b, input.lines, runners, {
      unitName: input.unitName,
      ledger: options.ledger,
      now,
      onProgress: (judgeId, model, done, total) => {
        if (done % 10 === 0 || done === total) io.log(`${judgeId} ${model}: ${done} of ${total} items`);
      },
    });
  } catch (error) {
    if (error instanceof SetupError) io.error(`the jury can't start: ${messageOf(error)}`);
    else io.error(`the jury stopped: ${messageOf(error)}; answers so far are cached, run it again to resume`);
    return false;
  }

  if (run.fallback) io.log(`${run.fallback.judge} ran on ${run.fallback.to}: ${run.fallback.from} answered ${run.fallback.status} at its first call`);
  for (const j of run.judges) {
    const seconds = j.calls === 0 ? "no call back" : `${(j.ms / j.calls / 1000).toFixed(1)} s a call`;
    const neurons = j.usage.neurons !== undefined ? `, ${Math.round(j.usage.neurons).toLocaleString("en-US")} neurons` : "";
    io.log(
      `usage: ${j.id} ${j.model}: ${j.calls} calls, ${compactCount(inputOf(j.usage))} tokens in, ${compactCount(j.usage.output)} out (${compactCount(j.usage.thinking)} reasoning), ${j.usable} of ${j.asked} usable, ${j.unsure} unsure answers, ${seconds}${neurons}`,
    );
  }

  const answersByJudge: AnswersByJudge = Object.fromEntries(run.judges.map((j) => [j.id, j.answers]));
  const at = now().toISOString();
  const file: JuryFile = {
    ranAt: at,
    judges: run.judges.map((j) => ({
      id: j.id,
      provider: j.provider,
      model: j.model,
      family: j.family,
      answered: j.answered,
      asked: j.asked,
      usable: j.usable,
      failed: j.failed,
      unsure: j.unsure,
      calls: j.calls,
      usage: j.usage,
      secondsPerCall: j.calls === 0 ? null : j.ms / j.calls / 1000,
      waitedSeconds: j.waitedMs / 1000,
    })),
    fallback: run.fallback,
    answers: answersByJudge,
    agreement: juryAgreement(input.ratings.items, answersByJudge),
    spotCheck: spotAgreement(input.spot!, input.ratings.items, answersByJudge),
  };
  await io.writeJury(file);
  io.log(`wrote ${JURY_PATH}`);
  await io.writeRatings(toRatings(input.ratings.items, answersByJudge, at));
  io.log(`wrote ${RATINGS_PATH}`);
  return true;
}

/** `pnpm insights:pilot:jury`'s one flag, `--force-replace`, to replace answers already in the rating. There's no `--concurrency`: the jury runs one call at a time. */
export function parseJuryArgs(args: string[]): { forceReplace: boolean } {
  let forceReplace = false;
  for (const arg of args) {
    if (arg === "--force-replace") forceReplace = true;
    else if (arg === "--concurrency") throw new Error("--concurrency: the jury always runs one call at a time, so its Cloudflare budget check sees every call before the next");
    else throw new Error(`unknown flag ${arg}: pnpm insights:pilot:jury takes --force-replace`);
  }
  return { forceReplace };
}

/** A mistake in how the command was started: said in one line, with nothing run. */
function refuseToStart(message: string): void {
  console.log(message);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseJuryArgs>;
  try {
    args = parseJuryArgs(process.argv.slice(2));
  } catch (error) {
    return refuseToStart(messageOf(error));
  }
  if (process.env.INSIGHTS_LIVE !== "1") return refuseToStart("pnpm insights:pilot:jury needs INSIGHTS_LIVE=1: it would spend real calls");

  const local = readLocal(process.env);
  const keys = missingJudgeKeys(local);
  if (keys) return refuseToStart(keys);

  const stages = await readStageFiles(STAGE_A_PATH, STAGE_B_PATH);
  if (!stages.ok) return refuseToStart(stages.message);
  const data = loadData();
  const screens = screenInputs(stages.a.findingIds, data);
  if (!screens.ok) return refuseToStart(screens.message);

  let ratings: Ratings;
  let spot: SpotCheck | null;
  try {
    ratings = await loadRatings(RATINGS_PATH);
    spot = await loadSpot(SPOT_PATH);
  } catch (error) {
    return refuseToStart(messageOf(error));
  }

  const retryOptions = { ...RETRY_DEFAULTS, sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), log: (line: string) => console.error(line) };
  const cacheOptions = { cacheDir: CACHE_DIR, datasetVersion: data.version, stageVersions: {} };
  const runners = new Map<Provider, Runner>([
    ["groq", makeRunner(withRetries(groqTransport(local), retryOptions), cacheOptions)],
    ["cloudflare", makeRunner(withRetries(cloudflareTransport(local), retryOptions), cacheOptions)],
  ]);

  const ok = await juryAndReport(
    { a: stages.a, b: stages.b, lines: screens.lines, unitName: screens.unitName, ratings, spot },
    runners,
    { ledger: fileLedger(NEURONS_PATH), forceReplace: args.forceReplace },
    {
      log: (line) => console.log(line),
      error: (line) => console.error(line),
      writeJury: (value) => writeJsonAtomic(JURY_PATH, value),
      writeRatings: (value) => writeJsonAtomic(RATINGS_PATH, value),
    },
  );
  if (!ok) process.exitCode = 1;
}

// Runs the jury when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
