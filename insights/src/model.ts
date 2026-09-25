/**
 * Calls a language model and caches every answer, so a re-run of a stage that already
 * asked a question spends nothing. The cache key folds in everything that could change
 * the answer's meaning (the prompt, the system prompt, the model, the stage's own version
 * and the dataset version), so a change to any of them asks again, and nothing stale is
 * ever read back.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelCall {
  model: string;
  system: string;
  prompt: string;
  stage: string;
  key: string;
  traceparent?: string; // left out of the cache id, so tracing never invalidates a cached answer
  accept?: (text: string) => boolean; // whether the stage can read an answer: one it can't is handed back but never cached, so a re-run asks again
  effort?: Effort; // the thinking effort, pinned per stage so nothing is inherited from where a run starts
  label?: string; // tells apart a deliberate repeat of the same calls, such as the pilot's noise floor
}

/** What one call spent: every token category the API bills and its dollar cost at list price. */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  thinking: number;
  costUsd: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, costUsd: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    thinking: a.thinking + b.thinking,
    costUsd: a.costUsd + b.costUsd,
  };
}

export interface ModelReply {
  text: string;
  model: string;
  promptHash: string;
  cached: boolean;
  ms: number;
  usage: Usage;
}

// model: the id that actually answered, which an alias like "sonnet" doesn't say
export type Transport = (call: ModelCall) => Promise<{ text: string; model: string; usage: Usage }>;

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

/**
 * Determines whether an environment variable should not be passed to the child process.
 * Filters out API keys and session-specific settings from the parent.
 */
export const CHILD_ENV_DROP = (key: string): boolean =>
  key === "ANTHROPIC_API_KEY" || key === "CLAUDECODE" || key === "CLAUDE_EFFORT" || key.startsWith("CLAUDE_CODE_");

/**
 * How `claude -p` is started for one call, kept apart from the spawn so a test can read
 * it. As `evals/run.ts` does, the child reads local settings only, gets no tools and saves
 * no session; it also gets no MCP servers (`--strict-mcp-config` with no config beside it)
 * and runs from the temp directory, so nothing in this repository or the person's own setup
 * reaches it. `ANTHROPIC_API_KEY` is taken out of its environment, so it always answers on
 * the signed-in subscription, never on a key billed per call.
 */
export function claudeInvocation(call: ModelCall, parentEnv: NodeJS.ProcessEnv): { args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(parentEnv).filter(([key]) => !CHILD_ENV_DROP(key)));

  // Nothing here reaches a collector unless the pipeline's own environment already names
  // one: without it, the child gets no telemetry env at all, traceparent included, so
  // nothing leaves the machine that wasn't opted into.
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    if (call.traceparent) env.TRACEPARENT = call.traceparent;
    env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
    env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = "1";
    env.OTEL_TRACES_EXPORTER = "otlp";
    env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
  }

  const args = [
    "-p", call.prompt,
    "--model", call.model,
    ...(call.effort ? ["--effort", call.effort] : []),
    "--setting-sources", "local",
    "--strict-mcp-config",
    "--tools", "",
    "--system-prompt", call.system,
    "--output-format", "json",
    "--no-session-persistence",
  ];
  return { args, cwd: tmpdir(), env };
}

/** Spawns `claude -p` as `claudeInvocation` sets it up, and reads its one JSON result. */
export function claudeTransport(options?: { timeoutMs?: number }): Transport {
  return async (call) => {
    requireLive("claudeTransport");
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const { args, cwd, env } = claudeInvocation(call, process.env);
    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"], cwd, env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    // A spawn failure (the binary missing from PATH, say) fires 'error', never 'close';
    // a normal exit fires 'close', never 'error'. Either settles this promise once, so
    // the other can't resolve or reject it again.
    const code = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      child.once("error", (e) => {
        if (settled) return;
        settled = true;
        reject(new Error(`couldn't start claude: ${e.message}`));
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        resolve(code);
      });
    }).finally(() => clearTimeout(timer));

    if (timedOut) throw new Error(`claude timed out after ${timeoutMs}ms`);
    if (code !== 0) throw new Error(`claude exited ${code}: ${err.trim().split("\n").slice(-2).join(" ")}`);

    return parseClaudeOutput(out, call.model);
  };
}

/**
 * Reads one `claude -p --output-format json` result: its text, the model that actually
 * answered (an alias like "sonnet" doesn't say), and its tokens and cost. The same fields
 * `evals/run.ts` reads off the CLI's JSON, each defaulting to 0 when the CLI leaves it out.
 * Throws exactly what `claudeTransport` threw inline before this was pulled out of it:
 * unparseable output, `is_error`, or no `result`.
 */
export function parseClaudeOutput(stdout: string, requestedModel: string): { text: string; model: string; usage: Usage } {
  let parsed: {
    result?: string;
    is_error?: boolean;
    total_cost_usd?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens_details?: { thinking_tokens?: number };
    };
    modelUsage?: Record<string, { canonicalModel?: string }>;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`claude produced unparseable output: ${stdout.slice(0, 300)}`);
  }
  if (parsed.is_error) throw new Error(`claude reported an error: ${parsed.result ?? stdout.slice(0, 300)}`);
  if (typeof parsed.result !== "string") throw new Error(`claude's output had no result: ${stdout.slice(0, 300)}`);

  const answered = Object.values(parsed.modelUsage ?? {})[0]?.canonicalModel;
  const u = parsed.usage ?? {};
  const usage: Usage = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    thinking: u.output_tokens_details?.thinking_tokens ?? 0,
    costUsd: parsed.total_cost_usd ?? 0,
  };
  return { text: parsed.result, model: answered ?? requestedModel, usage };
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
    const parsed = (await res.json()) as { response?: string; prompt_eval_count?: number; eval_count?: number };
    if (typeof parsed.response !== "string") throw new Error(`ollama's output had no response: ${JSON.stringify(parsed).slice(0, 300)}`);
    return {
      text: parsed.response,
      model: call.model,
      usage: { ...NO_USAGE, input: parsed.prompt_eval_count ?? 0, output: parsed.eval_count ?? 0 },
    };
  };
}

/** A transport for tests: answers from a function, never touching the environment or the network. */
export function stubTransport(answer: (call: ModelCall) => string): Transport {
  return async (call) => ({ text: answer(call), model: call.model, usage: NO_USAGE });
}

interface CacheEntry {
  text: string;
  model: string;
  promptHash: string;
  ms: number;
  usage: Usage;
}

function cacheId(call: ModelCall, datasetVersion: string, stageVersions: Record<string, string>): string {
  return hash(
    JSON.stringify([
      call.stage,
      stageVersions[call.stage] ?? "",
      datasetVersion,
      call.model,
      call.effort ?? "",
      call.label ?? "",
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
    // An older cache file, written before usage was tracked, has no `usage` at all: read
    // as zero rather than a miss, so it isn't asked again just to learn what it cost.
    return { ...parsed, usage: parsed.usage ?? NO_USAGE } as CacheEntry;
  } catch {
    // Unreadable or unparseable: a miss, not a crash. The call is asked again and the
    // file overwritten.
    return null;
  }
}

/**
 * Wraps a transport with a cache keyed on everything that could change an answer's
 * meaning. A cache hit returns the original call's `ms` with `cached: true`; a miss asks
 * the transport, writes the answer to the cache and returns it with `cached: false`. An
 * answer the call's `accept` turns down is never written, and one already in the cache is
 * read as a miss, so a stage never gets stuck on a reply it couldn't read the first time.
 */
export function makeRunner(
  transport: Transport,
  options: { cacheDir: string; datasetVersion: string; stageVersions: Record<string, string> },
): Runner {
  return async (call) => {
    const promptHash = hash(`${call.system}\n${call.prompt}`);
    const id = cacheId(call, options.datasetVersion, options.stageVersions);
    const path = join(options.cacheDir, call.stage, `${id}.json`);

    const readable = (text: string): boolean => !call.accept || call.accept(text);

    const cached = await readCacheFile(path);
    if (cached && readable(cached.text)) return { ...cached, cached: true };

    const started = Date.now();
    const { text, model, usage } = await transport(call);
    const ms = Date.now() - started;
    const entry: CacheEntry = { text, model, promptHash, ms, usage };
    if (readable(text)) await writeCacheFile(path, entry);
    return { ...entry, cached: false };
  };
}
