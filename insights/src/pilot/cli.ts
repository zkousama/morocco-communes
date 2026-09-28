/**
 * The pilot's own runner: `pnpm insights:pilot --stage a` runs stage A, the 4 proposer
 * setups, live against a real model, and writes what it found to
 * `.cache/insights/pilot/stage-a.json`. `--stage b` reads that file, runs the active
 * adversary setups (`ACTIVE_ADVERSARIES`) over one shared pool of its passing candidates,
 * writes what it found to `.cache/insights/pilot/stage-b.json`, and writes the redacted,
 * committed `insights/pilot/candidates.json` the public repo carries. Both stages share one
 * cache directory (`.cache/insights/pilot/cache`), separate from the full pipeline's, so a
 * re-run after an interruption resumes from every answer already given rather than asking
 * again, and a pilot call never touches the full pipeline's own cache.
 *
 * A failure once a run has started (a halt inside `runStageA` or `runStageB`) is reported
 * through `runAndReport` or `runAndReportB`, in its own wording, and is never routed through
 * `refuseToStart`: that one is for a mistake made before anything ran at all (a bad flag,
 * `INSIGHTS_LIVE` unset, no stage A file yet), which a person reads completely differently
 * from "it ran for 3 hours and then stopped".
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadData, type Data } from "../data.ts";
import { detect, type Finding } from "../detect.ts";
import {
  addUsage,
  compactCount,
  inputOf,
  makeRunner,
  messageOf,
  NO_USAGE,
  readLocal,
  RETRY_DEFAULTS,
  usd,
  withRetries,
  writeJsonAtomic,
  type Local,
  type Runner,
} from "../model.ts";
import { localWarning, termsPattern } from "../safety.ts";
import { transportFor } from "../setup.ts";
import { sampleFindings } from "./sample.ts";
import { ACTIVE_ADVERSARIES, PILOT_SEED, PROPOSERS, type PilotRole } from "./setups.ts";
import { committedCandidates, runStageA, runStageB, SetupError, type StageA } from "./stages.ts";

export const CACHE_DIR = join(".cache", "insights", "pilot", "cache");
export const STAGE_A_PATH = join(".cache", "insights", "pilot", "stage-a.json");
export const STAGE_B_PATH = join(".cache", "insights", "pilot", "stage-b.json");
const CANDIDATES_PATH = join("insights", "pilot", "candidates.json");
const DEFAULT_CONCURRENCY = 3;


/** `pnpm insights:pilot`'s flags: `--stage a` or `--stage b`, and an optional `--concurrency`. */
export function parseArgs(args: string[]): { stage: "a" | "b"; concurrency: number | undefined } {
  const value = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const next = args[i + 1];
    return next === undefined || next.startsWith("--") ? "" : next;
  };

  const rawStage = value("stage");
  if (rawStage !== "a" && rawStage !== "b") {
    throw new Error(`--stage needs "a" or "b"${rawStage ? `, not "${rawStage}"` : ""}`);
  }
  const rawConcurrency = value("concurrency");
  if (rawConcurrency !== undefined && !/^[1-9]\d*$/.test(rawConcurrency)) {
    throw new Error(`--concurrency needs a whole number of findings at once, such as --concurrency 3${rawConcurrency ? `, not ${rawConcurrency}` : ""}`);
  }

  return { stage: rawStage, concurrency: rawConcurrency === undefined ? undefined : Number(rawConcurrency) };
}

/**
 * Runs stage A and reports what happened through `io`, never throwing itself: a failure once
 * the run has started is reported through `io.error`, worded as its own kind of problem
 * ("stage A stopped", not a mistake made before anything ran), and nothing is written, since
 * the cached answers already have everything a resumed run needs. Returns whether the file
 * was written. Takes stubbed `runners` directly, so it's testable without `INSIGHTS_LIVE` or
 * a real transport.
 */
export async function runAndReport(
  data: Data,
  findings: Finding[],
  runners: Map<string, Runner>,
  options: { concurrency: number; terms: RegExp | null },
  io: { log: (line: string) => void; error: (line: string) => void; write: (value: unknown) => Promise<void> },
): Promise<boolean> {
  let result: Awaited<ReturnType<typeof runStageA>>;
  try {
    result = await runStageA(data, findings, runners, {
      ...options,
      onCandidates: (proposer, findingId, count) => io.log(`${proposer} ${findingId}: ${count} candidate${count === 1 ? "" : "s"}`),
    });
  } catch (error) {
    // A SetupError was found before any call was made (a missing runner): a mistake to fix
    // and rerun, never a halt with answers already cached worth resuming from.
    if (error instanceof SetupError) io.error(`stage A can't start: ${messageOf(error)}`);
    else io.error(`stage A stopped: ${messageOf(error)}; answers so far are cached, run it again to resume`);
    return false;
  }

  for (const p of result.proposers) {
    const calls = p.replies.length;
    const effort = p.role.effort ? ` ${p.role.effort}` : "";
    io.log(`usage: ${p.id} ${p.role.model}${effort}: ${calls} calls, ${compactCount(inputOf(p.usage))} tokens in, ${compactCount(p.usage.output)} out, ${usd(p.usage.costUsd)}`);
  }

  await io.write(result);
  io.log(`wrote ${STAGE_A_PATH}`);
  return true;
}

/**
 * Runs stage B and reports what happened through `io`, on the same shape as `runAndReport`:
 * a failure once the run has started is reported through `io.error` and nothing is written,
 * since the cached answers already have everything a resumed run needs. Writes both
 * `.cache/insights/pilot/stage-b.json`, the full run, and `insights/pilot/candidates.json`,
 * `committedCandidates`' redacted view of it, the file the public repo carries. Takes
 * stubbed `runners` directly, so it's testable without `INSIGHTS_LIVE` or a real transport.
 */
export async function runAndReportB(
  data: Data,
  a: StageA,
  runners: Map<string, Runner>,
  options: { concurrency: number; terms: RegExp | null; adversaries?: PilotRole[] },
  io: { log: (line: string) => void; error: (line: string) => void; writeStageB: (value: unknown) => Promise<void>; writeCandidates: (value: unknown) => Promise<void> },
): Promise<boolean> {
  let result: Awaited<ReturnType<typeof runStageB>>;
  try {
    result = await runStageB(data, a, runners, {
      ...options,
      onVerdict: (run, candidateId, verdict) => {
        const status = verdict.survived
          ? "survived"
          : verdict.unusable
            ? `unusable (${verdict.unusable})`
            : `broke (${verdict.stage}${verdict.category ? `: ${verdict.category}` : ""})`;
        io.log(`${run} ${candidateId}: ${status}`);
      },
    });
  } catch (error) {
    // A SetupError was found before any call was made (a missing runner, a pool candidate
    // whose finding id detect(data) doesn't have): a mistake to fix and rerun, never a halt
    // with answers already cached worth resuming from.
    if (error instanceof SetupError) io.error(`stage B can't start: ${messageOf(error)}`);
    else io.error(`stage B stopped: ${messageOf(error)}; answers so far are cached, run it again to resume`);
    return false;
  }

  for (const [id, reason] of Object.entries(result.dropped)) io.log(`${id} dropped, not run: ${reason}`);
  for (const role of options.adversaries ?? ACTIVE_ADVERSARIES) {
    const mine = result.verdicts.filter((v) => v.run === role.id);
    const usage = mine.reduce((acc, v) => addUsage(acc, v.usage), NO_USAGE);
    const effort = role.effort ? ` ${role.effort}` : role.transport === "gemini" ? " default effort" : "";
    io.log(`usage: ${role.id} ${role.model}${effort}: ${mine.length} calls, ${compactCount(inputOf(usage))} tokens in, ${compactCount(usage.output)} out, ${usd(usage.costUsd)}`);
  }

  await io.writeStageB(result);
  io.log(`wrote ${STAGE_B_PATH}`);
  // `options.terms` is the same private-terms pattern `runStageB` used to compute
  // `termMatches`, read here only to decide what `committedCandidates` leaves out.
  await io.writeCandidates(committedCandidates(a, result, options.terms));
  io.log(`wrote ${CANDIDATES_PATH}`);
  return true;
}

/**
 * A clear refusal, before any call, when stage B would need Gemini's own key but doesn't
 * have it: without this, a missing key is only discovered when a Gemini run's own first
 * call fails, by which point the runs before it have already spent real calls. `roles` is
 * `ACTIVE_ADVERSARIES` in the live command, taken as a parameter so this stays testable
 * without it; with the one Gemini run dropped, it has nothing to refuse.
 */
export function missingGeminiKey(roles: PilotRole[], local: Local | null): string | null {
  if (!roles.some((role) => role.transport === "gemini")) return null;
  if (local?.keys.GEMINI_API_KEY) return null;
  return "stage B needs GEMINI_API_KEY in the local keys file to run its gemini setup";
}

async function runStageACommand(concurrency: number): Promise<void> {
  if (process.env.INSIGHTS_LIVE !== "1") {
    throw new Error("pnpm insights:pilot needs INSIGHTS_LIVE=1: it would spend real calls against a subscription");
  }

  const local = readLocal(process.env);
  const warning = localWarning(local);
  if (warning) console.error(warning);

  const data = loadData();
  const findings = sampleFindings(detect(data), PILOT_SEED);

  const retryOptions = { ...RETRY_DEFAULTS, sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), log: (line: string) => console.error(line) };
  const cacheOptions = { cacheDir: CACHE_DIR, datasetVersion: data.version, stageVersions: {} };
  const runners = new Map(
    PROPOSERS.map((role) => [role.id, makeRunner(withRetries(transportFor(role, local), retryOptions), cacheOptions)] as const),
  );

  // The pilot never applies the private terms inside a real proposer call (see runStageB's
  // own comment): only the built-in named-person pattern still drops anything here.
  const ok = await runAndReport(data, findings, runners, { concurrency, terms: null }, {
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    write: (value) => writeJsonAtomic(STAGE_A_PATH, value),
  });
  if (!ok) process.exitCode = 1;
}

async function runStageBCommand(concurrency: number): Promise<void> {
  if (process.env.INSIGHTS_LIVE !== "1") {
    throw new Error("pnpm insights:pilot needs INSIGHTS_LIVE=1: it would spend real calls against a subscription");
  }

  const local = readLocal(process.env);
  const warning = localWarning(local);
  if (warning) console.error(warning);
  // The private terms are never applied inside a real adversary call either; `terms` here
  // only feeds `runStageB`'s own `termMatch` measurement and `committedCandidates`' counter
  // screening.
  const terms = termsPattern(local?.terms ?? []);

  const geminiError = missingGeminiKey(ACTIVE_ADVERSARIES, local);
  if (geminiError) throw new Error(geminiError);

  const data = loadData();

  let a: StageA;
  try {
    a = JSON.parse(await readFile(STAGE_A_PATH, "utf8")) as StageA;
  } catch (error) {
    throw new Error(`couldn't read ${STAGE_A_PATH}: run pnpm insights:pilot --stage a first (${messageOf(error)})`);
  }

  const retryOptions = { ...RETRY_DEFAULTS, sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), log: (line: string) => console.error(line) };
  const cacheOptions = { cacheDir: CACHE_DIR, datasetVersion: data.version, stageVersions: {} };
  const runners = new Map(
    ACTIVE_ADVERSARIES.map((role) => [role.id, makeRunner(withRetries(transportFor(role, local), retryOptions), cacheOptions)] as const),
  );

  const ok = await runAndReportB(data, a, runners, { concurrency, terms }, {
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    writeStageB: (value) => writeJsonAtomic(STAGE_B_PATH, value),
    writeCandidates: (value) => writeJsonAtomic(CANDIDATES_PATH, value),
  });
  if (!ok) process.exitCode = 1;
}

/** A mistake in how the run was started: said in one line, with nothing run. */
function refuseToStart(error: unknown): void {
  console.log(messageOf(error));
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    refuseToStart(error);
    return;
  }

  try {
    if (args.stage === "a") await runStageACommand(args.concurrency ?? DEFAULT_CONCURRENCY);
    else await runStageBCommand(args.concurrency ?? DEFAULT_CONCURRENCY);
  } catch (error) {
    refuseToStart(error);
  }
}

// Runs the pilot when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
