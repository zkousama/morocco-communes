/**
 * The pilot's own runner: `pnpm insights:pilot --stage a` runs stage A, the 4 proposer
 * setups, live against a real model, and writes what it found to
 * `.cache/insights/pilot/stage-a.json`. Its own cache directory
 * (`.cache/insights/pilot/cache`) is separate from the full pipeline's, so a re-run after an
 * interruption resumes from every answer already given rather than asking again, and a pilot
 * call never touches the full pipeline's own cache. `--stage b` is recognised but not
 * implemented yet: it arrives with Task 14.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadData } from "../data.ts";
import { detect } from "../detect.ts";
import { hash, makeRunner, messageOf, readLocal, RETRY_DEFAULTS, withRetries, type Usage } from "../model.ts";
import { localWarning, transportFor } from "../run.ts";
import { termsPattern } from "../safety.ts";
import { sampleFindings } from "./sample.ts";
import { PILOT_SEED, PROPOSERS } from "./setups.ts";
import { runStageA } from "./stages.ts";

const CACHE_DIR = join(".cache", "insights", "pilot", "cache");
const STAGE_A_PATH = join(".cache", "insights", "pilot", "stage-a.json");
const DEFAULT_CONCURRENCY = 3;

/** Every input token a call spent, whether fresh or read back from the API's own cache. */
const inputOf = (usage: Usage): number => usage.input + usage.cacheRead + usage.cacheWrite;
const k = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const usd = (n: number): string => `$${n.toFixed(2)}`;

/** Writes to a temporary name in the same directory, then renames it into place, so a crash mid-write never leaves a half-written file to be read back. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 16)}`);
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}

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

async function runStageACommand(concurrency: number): Promise<void> {
  if (process.env.INSIGHTS_LIVE !== "1") {
    throw new Error("pnpm insights:pilot needs INSIGHTS_LIVE=1: it would spend real calls against a subscription");
  }

  const local = readLocal(process.env);
  const warning = localWarning(local);
  if (warning) console.error(warning);
  const terms = termsPattern(local?.terms ?? []);

  const data = loadData();
  const findings = sampleFindings(detect(data), PILOT_SEED);

  const retryOptions = { ...RETRY_DEFAULTS, sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), log: (line: string) => console.error(line) };
  const cacheOptions = { cacheDir: CACHE_DIR, datasetVersion: data.version, stageVersions: {} };
  const runners = new Map(
    PROPOSERS.map((role) => [role.id, makeRunner(withRetries(transportFor(role, local), retryOptions), cacheOptions)] as const),
  );

  const result = await runStageA(data, findings, runners, {
    concurrency,
    terms,
    onCandidates: (proposer, findingId, count) => console.log(`${proposer} ${findingId}: ${count} candidate${count === 1 ? "" : "s"}`),
  });

  for (const p of result.proposers) {
    const calls = p.replies.length;
    const effort = p.role.effort ? ` ${p.role.effort}` : "";
    console.log(`usage: ${p.id} ${p.role.model}${effort}: ${calls} calls, ${k(inputOf(p.usage))} tokens in, ${k(p.usage.output)} out, ${usd(p.usage.costUsd)}`);
  }

  await writeJsonAtomic(STAGE_A_PATH, result);
  console.log(`wrote ${STAGE_A_PATH}`);
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

  if (args.stage === "b") {
    console.log("insights pilot: stage B isn't wired up yet");
    process.exitCode = 1;
    return;
  }

  try {
    await runStageACommand(args.concurrency ?? DEFAULT_CONCURRENCY);
  } catch (error) {
    refuseToStart(error);
  }
}

// Runs the pilot when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
