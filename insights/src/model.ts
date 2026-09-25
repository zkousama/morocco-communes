/**
 * Calls a language model and caches every answer, so a re-run of a stage that already
 * asked a question spends nothing. The cache key folds in everything that could change
 * the answer's meaning — the prompt, the system prompt, the model, the stage's own
 * version and the dataset version — so a change to any of them asks again, and nothing
 * stale is ever read back.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ModelCall {
  model: string;
  system: string;
  prompt: string;
  stage: string;
  key: string;
}

export interface ModelReply {
  text: string;
  model: string;
  promptHash: string;
  cached: boolean;
  ms: number;
}

// model: the id that actually answered, which an alias like "sonnet" doesn't say
export type Transport = (call: ModelCall) => Promise<{ text: string; model: string }>;

export type Runner = (call: ModelCall) => Promise<ModelReply>;

export function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const DEFAULT_TIMEOUT_MS = 240_000;

function requireLive(name: string): void {
  if (process.env.INSIGHTS_LIVE !== "1") {
    throw new Error(`${name} needs INSIGHTS_LIVE=1: it would spend a real call`);
  }
}

/** Spawns `claude -p`, following `evals/run.ts`'s idiom, and reads its one JSON result. */
export function claudeTransport(options?: { timeoutMs?: number }): Transport {
  return async (call) => {
    requireLive("claudeTransport");
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn(
      "claude",
      [
        "-p", call.prompt,
        "--model", call.model,
        "--setting-sources", "local",
        "--tools", "",
        "--system-prompt", call.system,
        "--output-format", "json",
        "--no-session-persistence",
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    clearTimeout(timer);

    if (timedOut) throw new Error(`claude timed out after ${timeoutMs}ms`);
    if (code !== 0) throw new Error(`claude exited ${code}: ${err.trim().split("\n").slice(-2).join(" ")}`);

    let parsed: { result?: string; is_error?: boolean; modelUsage?: Record<string, { canonicalModel?: string }> };
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new Error(`claude produced unparseable output: ${out.slice(0, 300)}`);
    }
    if (parsed.is_error) throw new Error(`claude reported an error: ${parsed.result ?? out.slice(0, 300)}`);
    if (typeof parsed.result !== "string") throw new Error(`claude's output had no result: ${out.slice(0, 300)}`);

    const answered = Object.values(parsed.modelUsage ?? {})[0]?.canonicalModel;
    return { text: parsed.result, model: answered ?? call.model };
  };
}

/** POSTs to a local Ollama server's generate endpoint. */
export function ollamaTransport(url?: string): Transport {
  return async (call) => {
    requireLive("ollamaTransport");
    const base = url ?? "http://127.0.0.1:11434";
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: call.model, system: call.system, prompt: call.prompt, stream: false, format: "json" }),
    });
    if (!res.ok) throw new Error(`ollama at ${base} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const parsed = (await res.json()) as { response?: string };
    if (typeof parsed.response !== "string") throw new Error(`ollama's output had no response: ${JSON.stringify(parsed).slice(0, 300)}`);
    return { text: parsed.response, model: call.model };
  };
}

/** A transport for tests: answers from a function, never touching the environment or the network. */
export function stubTransport(answer: (call: ModelCall) => string): Transport {
  return async (call) => ({ text: answer(call), model: call.model });
}

interface CacheEntry {
  text: string;
  model: string;
  promptHash: string;
  ms: number;
}

function cacheId(call: ModelCall, datasetVersion: string, stageVersions: Record<string, string>): string {
  return hash(
    JSON.stringify([
      call.stage,
      stageVersions[call.stage] ?? "",
      datasetVersion,
      call.model,
      hash(call.system),
      hash(call.prompt),
      call.key,
    ]),
  );
}

/** Writes to a temporary name in the same directory, then renames it into place, so a crash mid-write never leaves a half-written file to be read back. */
async function writeCacheFile(path: string, entry: CacheEntry): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmpFile = join(dir, `.tmp-${hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 16)}`);
  await writeFile(tmpFile, JSON.stringify(entry));
  await rename(tmpFile, path);
}

async function readCacheFile(path: string): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;
    if (
      typeof parsed.text !== "string" ||
      typeof parsed.model !== "string" ||
      typeof parsed.promptHash !== "string" ||
      typeof parsed.ms !== "number"
    ) {
      return null;
    }
    return parsed as CacheEntry;
  } catch {
    // Unreadable or unparseable: a miss, not a crash. The call is asked again and the
    // file overwritten.
    return null;
  }
}

/**
 * Wraps a transport with a cache keyed on everything that could change an answer's
 * meaning. A cache hit returns the original call's `ms` with `cached: true`; a miss asks
 * the transport, writes the answer to the cache and returns it with `cached: false`.
 */
export function makeRunner(
  transport: Transport,
  options: { cacheDir: string; datasetVersion: string; stageVersions: Record<string, string> },
): Runner {
  return async (call) => {
    const promptHash = hash(`${call.system}\n${call.prompt}`);
    const id = cacheId(call, options.datasetVersion, options.stageVersions);
    const path = join(options.cacheDir, call.stage, `${id}.json`);

    const cached = await readCacheFile(path);
    if (cached) return { ...cached, cached: true };

    const started = Date.now();
    const { text, model } = await transport(call);
    const ms = Date.now() - started;
    const entry: CacheEntry = { text, model, promptHash, ms };
    await writeCacheFile(path, entry);
    return { ...entry, cached: false };
  };
}
