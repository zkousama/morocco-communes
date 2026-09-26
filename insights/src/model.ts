/**
 * Calls a language model and caches every answer, so a re-run of a stage that already
 * asked a question spends nothing. The cache key folds in everything that could change
 * the answer's meaning (the prompt, the system prompt, the model, the stage's own version
 * and the dataset version), so a change to any of them asks again, and nothing stale is
 * ever read back.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
  neurons?: number; // Cloudflare Workers AI's own billing unit, only where a reply reports it
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, costUsd: 0 };

/** Every input token a call spent, whether fresh or read back from the API's own cache. */
export const inputOf = (usage: Usage): number => usage.input + usage.cacheRead + usage.cacheWrite;

/** A count written short: as is under 1,000, then in thousands ("12k"), then in millions ("3.5M"). */
export const compactCount = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));

/** Dollars, to the cent. */
export const usd = (n: number): string => `$${n.toFixed(2)}`;

/** Every category summed; neurons only when either side reports them, so a sum with none carries none. */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    thinking: a.thinking + b.thinking,
    costUsd: a.costUsd + b.costUsd,
    ...(a.neurons !== undefined || b.neurons !== undefined ? { neurons: (a.neurons ?? 0) + (b.neurons ?? 0) } : {}),
  };
}

export interface ModelReply {
  text: string;
  model: string;
  promptHash: string;
  cached: boolean;
  ms: number; // the call's own answering time, waits for a retry or a limit left out
  usage: Usage;
  waitedMs: number; // time `withRetries` spent sleeping on this call's behalf; 0 when it never had to
}

// model: the id that actually answered, which an alias like "sonnet" doesn't say.
// waitedMs is left out by every transport but `withRetries`' own wrapping of one; a
// transport that doesn't wait has nothing to report, so `makeRunner` reads it as 0.
export type Transport = (call: ModelCall) => Promise<{ text: string; model: string; usage: Usage; waitedMs?: number }>;

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
 * Filters out API keys, session-specific settings from the parent, and `INSIGHTS_LOCAL`, so
 * the private folder's location never reaches the child either.
 */
export const CHILD_ENV_DROP = (key: string): boolean =>
  key === "ANTHROPIC_API_KEY" || key === "CLAUDECODE" || key === "CLAUDE_EFFORT" || key === "INSIGHTS_LOCAL" || key.startsWith("CLAUDE_CODE_");

/** Private settings read from outside the repository: extra terms the safety check also refuses, and keys for optional transports. */
export interface Local {
  terms: string[];
  keys: Record<string, string>;
}

/**
 * `filename`'s text from `dir`, or "" when the file's missing. Any other failure (the folder
 * is really a file, so joining onto it lands on ENOTDIR; the file exists but can't be read;
 * the file is itself a folder) throws a fresh error naming only the filename and the error
 * code, never the folder's path: `readFileSync`'s own error carries the full path in both its
 * message and its `path` property, and nothing here is caught further up, so a rethrow of it
 * would print that path to the terminal. No `cause` either, since Node prints that chain too.
 */
function readOrEmpty(dir: string, filename: string): string {
  try {
    return readFileSync(join(dir, filename), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return "";
    throw new Error(`insights: couldn't read ${filename} in the INSIGHTS_LOCAL folder (${code})`);
  }
}

/**
 * The private folder `env.INSIGHTS_LOCAL` names, or null when that variable isn't set: this
 * is the only place that name is read, and it's never logged or printed, path or content.
 * `terms.txt` holds one term per line, blank lines and lines starting `#` ignored; `keys.env`
 * holds `NAME=value` lines for optional transports. Either file missing reads as empty.
 */
export function readLocal(env: NodeJS.ProcessEnv): Local | null {
  const dir = env.INSIGHTS_LOCAL;
  if (!dir) return null;

  const terms = readOrEmpty(dir, "terms.txt")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const keys: Record<string, string> = {};
  for (const rawLine of readOrEmpty(dir, "keys.env").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    keys[line.slice(0, at)] = line.slice(at + 1);
  }

  return { terms, keys };
}

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

/** A subscription's usage limit: waited out, not counted as a failure. `retryAfterMs` is how long the caller was told to wait, when it said. */
export class LimitError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "LimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** A hiccup worth retrying: a timeout, an overload, a bad exit, garbled output, a network error. */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

/**
 * A failure no retry heals, such as a bad key, an unknown model or a malformed request: given
 * up on at once. `status` is the HTTP status that caused it, when a transport knows one, so a
 * caller can tell a withdrawn model (404) from a bad key without reading the message.
 */
export class FatalError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "FatalError";
    this.status = status;
  }
}

const FATAL_RE = /couldn't start claude|ENOENT|credit balance/i;
const LIMIT_RE = /usage limit|hit your (?:\w+ )*limit|rate.?limit|too many requests|resource.?exhausted/i;

/** Sorts an error into what `withRetries` should do with it: wait it out, retry it, or give up at once. */
export function classify(error: unknown): "limit" | "transient" | "fatal" {
  if (error instanceof LimitError) return "limit";
  if (error instanceof TransientError) return "transient";
  if (error instanceof FatalError) return "fatal";
  const message = messageOf(error);
  if (FATAL_RE.test(message)) return "fatal";
  if (LIMIT_RE.test(message)) return "limit";
  return "transient";
}

/** An error's message, or its string form when it isn't an `Error` at all. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The error a nonzero exit from `claude -p` becomes. Its stdout, when it parses as the
 * CLI's own JSON with `is_error` and a string `result`, carries the real reason (a usage
 * limit's own wording, say); that's kept rather than lost behind a bare exit code.
 * Anything else falls back to the exit code and the last of stderr, as before.
 */
export function claudeFailure(code: number | null, stdout: string, stderr: string): Error {
  try {
    const parsed = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
    if (parsed.is_error && typeof parsed.result === "string") {
      return new Error(`claude reported an error: ${parsed.result}`);
    }
  } catch {
    // Not the CLI's JSON: fall through to the exit code and stderr.
  }
  return new Error(`claude exited ${code}: ${stderr.trim().split("\n").slice(-2).join(" ")}`);
}

export interface RetryOptions {
  tries: number;
  backoffMs: number[];
  limitPollMs: number;
  limitMaxMs: number;
  sleep: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** `tries: 3`, backing off 5s, 30s, 2 min; a limit is polled every 15 min for up to 6 hours. */
export const RETRY_DEFAULTS: Omit<RetryOptions, "sleep"> = {
  tries: 3,
  backoffMs: [5_000, 30_000, 120_000],
  limitPollMs: 15 * 60_000,
  limitMaxMs: 6 * 60 * 60_000,
};

/**
 * Wraps a transport so a hiccup retries and a usage limit waits, leaving only a real
 * failure to reach the caller. A transient error backs off `backoffMs[i]` and retries, up
 * to `tries` times, then throws as itself. A limit sleeps `retryAfterMs` (when the error
 * said how long) or `limitPollMs`, clamped to whatever's left of `limitMaxMs`, so the total
 * time waited never runs past it; once none is left, it gives up without waiting again and
 * throws a `LimitError` saying the limit never reset in time. A fatal error throws at once,
 * on the first try.
 *
 * Every backoff and every limit wait this call made is summed and returned on the eventual
 * successful result as `waitedMs` (added to whatever the transport itself already reported,
 * so wrapping this twice would never lose one layer's own wait), so a caller can tell how
 * long a call took to answer from how long it spent queued behind a retry or a limit.
 */
export function withRetries(transport: Transport, o: RetryOptions): Transport {
  return async (call) => {
    let transientTries = 0;
    let waited = 0; // toward `limitMaxMs`'s own budget, reset by nothing else
    let waitedMs = 0; // every wait this call made, backoffs and limit waits alike
    for (;;) {
      try {
        const result = await transport(call);
        return { ...result, waitedMs: (result.waitedMs ?? 0) + waitedMs };
      } catch (error) {
        const kind = classify(error);
        if (kind === "fatal") throw error;
        if (kind === "limit") {
          if (waited >= o.limitMaxMs) {
            throw new LimitError(`the usage limit didn't reset within ${Math.round(o.limitMaxMs / 3_600_000)} hours: ${messageOf(error)}`, null);
          }
          const asked = (error instanceof LimitError && error.retryAfterMs) || o.limitPollMs;
          const wait = Math.min(asked, o.limitMaxMs - waited);
          o.log?.(`limit reached, waiting ${wait < 60_000 ? `${Math.round(wait / 1000)} s` : `${Math.round(wait / 60_000)} min`}: ${messageOf(error)}`);
          await o.sleep(wait);
          waited += wait;
          waitedMs += wait;
          continue;
        }
        if (transientTries >= o.tries) throw error;
        const backoff = o.backoffMs[Math.min(transientTries, o.backoffMs.length - 1)]!;
        await o.sleep(backoff);
        waitedMs += backoff;
        transientTries++;
      }
    }
  };
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
    if (code !== 0) throw claudeFailure(code, out, err);

    return parseClaudeOutput(out, call.model);
  };
}

/**
 * Whether a CLI result is its own limit notice rather than an answer: short plain text that
 * `LIMIT_RE` matches. Every stage asks for JSON, so an answer opens with a brace, a bracket or
 * a code fence, and a hypothesis that happens to say "a moderate limit" is never read as one.
 */
function isLimitNotice(text: string): boolean {
  const t = text.trim();
  return t.length <= 300 && !/^(?:[{[]|```)/.test(t) && LIMIT_RE.test(t);
}

/**
 * Reads one `claude -p --output-format json` result: its text, the model that actually
 * answered (an alias like "sonnet" doesn't say), and its tokens and cost. The same fields
 * `evals/run.ts` reads off the CLI's JSON, each defaulting to 0 when the CLI leaves it out.
 * Throws exactly what `claudeTransport` threw inline before this was pulled out of it:
 * unparseable output, `is_error`, or no `result`. A `result` that's the CLI's own limit notice
 * throws a `LimitError` even when `is_error` is false, so a limit is waited out and never
 * handed back to be cached as an answer.
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
  if (isLimitNotice(parsed.result)) throw new LimitError(`claude reported a limit: ${parsed.result.trim()}`, null);

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

/**
 * A Google API error body's own message, read defensively, with the key blanked out wherever
 * it turns up: the body shouldn't ever quote it, but a thrown message is printed, so it's
 * never left to chance.
 */
function geminiErrorMessage(body: unknown, key: string): string {
  const message = (body as { error?: { message?: string } } | undefined)?.error?.message;
  return typeof message === "string" ? withoutKey(message, key) : "no error message";
}

/** `text` with every occurrence of `key` replaced, so no message ever carries it. */
const withoutKey = (text: string, key: string): string => text.split(key).join("[key]");

/** Gemini's statuses no retry heals: a malformed request, a bad or missing key, a key without access, an unknown model. */
const GEMINI_FATAL = new Set([400, 401, 403, 404]);

/**
 * How long a 429 asked to wait, in milliseconds: the error body's own `RetryInfo.retryDelay`
 * (a string like `"37s"`) when it's there, else the `retry-after` header, else null.
 */
function geminiRetryAfterMs(body: unknown, res: Response): number | null {
  const details = (body as { error?: { details?: unknown[] } } | undefined)?.error?.details;
  const info = Array.isArray(details) ? details.find((d) => typeof (d as { "@type"?: string })?.["@type"] === "string" && (d as { "@type": string })["@type"].includes("RetryInfo")) : undefined;
  const delay = (info as { retryDelay?: string } | undefined)?.retryDelay;
  const fromBody = typeof delay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(delay) : null;
  if (fromBody) return Math.round(parseFloat(fromBody[1]!) * 1000);
  const header = res.headers.get("retry-after");
  if (header && /^\d+(?:\.\d+)?$/.test(header)) return Math.round(parseFloat(header) * 1000);
  return null;
}

/**
 * POSTs to Gemini's `generateContent` endpoint on the free tier, asking for JSON back. The
 * key comes from `local.keys.GEMINI_API_KEY` and travels only in the `x-goog-api-key`
 * header, never the URL, never a thrown message. A 429 becomes a `LimitError` carrying
 * however long it asked to wait; 500, 503 and 504 become a `TransientError`, as does a
 * timeout or a network failure; 400, 401, 403 and 404 become a `FatalError`, since a bad
 * key, model or request fails the same way every time and should halt the stage at once
 * rather than retry; any other non-2xx becomes a plain `Error`. On success, the
 * text is the answer's non-thinking parts joined, or "" when there are no candidates or the
 * one there stopped for a reason other than running out of room or finishing cleanly, since
 * an unreadable answer is the stage's problem to record, not a crash here.
 */
export function geminiTransport(local: Local | null, options?: { timeoutMs?: number; base?: string }): Transport {
  return async (call) => {
    requireLive("geminiTransport");
    const key = local?.keys.GEMINI_API_KEY;
    if (!key) throw new Error("geminiTransport needs GEMINI_API_KEY in the local keys file");

    const base = options?.base ?? "https://generativelanguage.googleapis.com/v1beta";
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${base}/models/${call.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.system }] },
          contents: [{ role: "user", parts: [{ text: call.prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new TransientError(`gemini timed out after ${timeoutMs}ms`);
      throw new TransientError(`gemini: network error: ${withoutKey(messageOf(error), key)}`);
    } finally {
      clearTimeout(timer);
    }

    const body: unknown = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = `gemini answered ${res.status}: ${geminiErrorMessage(body, key)}`;
      if (res.status === 429) throw new LimitError(`gemini's usage limit: ${geminiErrorMessage(body, key)}`, geminiRetryAfterMs(body, res));
      if (res.status === 500 || res.status === 503 || res.status === 504) throw new TransientError(message);
      if (GEMINI_FATAL.has(res.status)) throw new FatalError(message);
      throw new Error(message);
    }

    const parsed = body as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
      modelVersion?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
    };
    const candidate = parsed.candidates?.[0];
    const readable = candidate !== undefined && (candidate.finishReason === "STOP" || candidate.finishReason === "MAX_TOKENS");
    const text = readable
      ? (candidate.content?.parts ?? []).filter((part) => part.thought !== true).map((part) => part.text ?? "").join("")
      : "";

    const usage = parsed.usageMetadata ?? {};
    return {
      text,
      model: parsed.modelVersion ?? call.model,
      usage: {
        input: usage.promptTokenCount ?? 0,
        output: usage.candidatesTokenCount ?? 0,
        thinking: usage.thoughtsTokenCount ?? 0,
        cacheRead: usage.cachedContentTokenCount ?? 0,
        cacheWrite: 0,
        costUsd: 0,
      },
    };
  };
}

/**
 * An OpenAI-compatible error body's own message, read defensively (the OpenAI shape's
 * `error.message`, or Cloudflare's own `errors[0].message`), with the key blanked out
 * wherever it turns up, as `geminiErrorMessage` does.
 */
function openaiErrorMessage(body: unknown, key: string): string {
  const shaped = body as { error?: { message?: unknown } | string; errors?: Array<{ message?: unknown }> } | undefined;
  const message =
    typeof shaped?.error === "string" ? shaped.error : typeof shaped?.error?.message === "string" ? shaped.error.message : shaped?.errors?.[0]?.message;
  return typeof message === "string" ? withoutKey(message, key) : "no error message";
}

/** The statuses no retry heals on an OpenAI-compatible API: a malformed request, a bad or missing key, a key without access, an unknown model, a request it can't process. */
const OPENAI_FATAL = new Set([400, 401, 403, 404, 422]);
const OPENAI_TRANSIENT = new Set([500, 502, 503, 504]);

/**
 * POSTs to an OpenAI-compatible `chat/completions` endpoint: the call's system prompt and
 * prompt as 2 messages, at temperature 0, with nothing asking for JSON (Cloudflare doesn't
 * document a JSON mode, so no caller relies on one). The key travels only in the
 * `Authorization: Bearer` header, never the URL, never a thrown message; a missing one throws
 * a plain error naming `provider` and `keyName`, the variable the local keys file should
 * hold it under. Statuses are sorted as `geminiTransport` sorts them: a 429 becomes a
 * `LimitError` carrying its `retry-after` header's seconds as milliseconds (null without
 * one); 500, 502, 503 and 504, a timeout and a network failure become a `TransientError`;
 * 400, 401, 403, 404 and 422 become a `FatalError` carrying the status; any other non-2xx
 * becomes a plain `Error` naming it. On success the text is `choices[0].message.content`, or
 * "" when that isn't a string, the model is whatever id the reply says answered, and the
 * usage costs nothing: every provider this serves is used on its free plan. Reasoning tokens,
 * where the reply counts them, are recorded as thinking, and the neurons a Cloudflare reply
 * reports in its usage, as `neurons`. Nothing sets a reasoning effort or caps the tokens a
 * reply may use, since a cap could cut a reasoning model's answer short.
 */
export function openaiCompatibleTransport(options: {
  baseUrl: string;
  apiKey: string | undefined;
  provider: string;
  keyName: string;
  timeoutMs?: number;
}): Transport {
  const { baseUrl, apiKey, provider, keyName } = options;
  return async (call) => {
    requireLive(`the ${provider} transport`);
    if (!apiKey) throw new Error(`${provider} needs ${keyName} in the local keys file`);
    const key = apiKey;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: call.model,
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: call.prompt },
          ],
          temperature: 0,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new TransientError(`${provider} timed out after ${timeoutMs}ms`);
      throw new TransientError(`${provider}: network error: ${withoutKey(messageOf(error), key)}`);
    } finally {
      clearTimeout(timer);
    }

    const body: unknown = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = `${provider} answered ${res.status}: ${openaiErrorMessage(body, key)}`;
      if (res.status === 429) {
        const header = res.headers.get("retry-after");
        const retryAfterMs = header && /^\d+(?:\.\d+)?$/.test(header) ? Math.round(parseFloat(header) * 1000) : null;
        throw new LimitError(`${provider}'s usage limit: ${openaiErrorMessage(body, key)}`, retryAfterMs);
      }
      if (OPENAI_TRANSIENT.has(res.status)) throw new TransientError(message);
      if (OPENAI_FATAL.has(res.status)) throw new FatalError(message, res.status);
      throw new Error(message);
    }

    const parsed = body as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; neurons?: unknown };
    };
    const content = parsed.choices?.[0]?.message?.content;
    const usage = parsed.usage ?? {};
    return {
      text: typeof content === "string" ? content : "",
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : call.model,
      usage: {
        input: usage.prompt_tokens ?? 0,
        output: usage.completion_tokens ?? 0,
        thinking: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: 0,
        ...(typeof usage.neurons === "number" && Number.isFinite(usage.neurons) ? { neurons: usage.neurons } : {}),
      },
    };
  };
}

/** Groq's OpenAI-compatible endpoint, keyed by `GROQ_API_KEY` from the local keys file. */
export function groqTransport(local: Local | null): Transport {
  return openaiCompatibleTransport({
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: local?.keys.GROQ_API_KEY,
    provider: "groq",
    keyName: "GROQ_API_KEY",
  });
}

/**
 * Cloudflare Workers AI's OpenAI-compatible endpoint for the account `CLOUDFLARE_ACCOUNT_ID`
 * names (an id the URL has to carry, not a secret), keyed by `CLOUDFLARE_API_TOKEN`, both
 * from the local keys file. A missing account id is refused the same way a missing token is,
 * inside the call and after the live check, so nothing is ever sent to an account called
 * "undefined".
 */
export function cloudflareTransport(local: Local | null): Transport {
  const accountId = local?.keys.CLOUDFLARE_ACCOUNT_ID;
  const inner = openaiCompatibleTransport({
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
    apiKey: local?.keys.CLOUDFLARE_API_TOKEN,
    provider: "cloudflare",
    keyName: "CLOUDFLARE_API_TOKEN",
  });
  return async (call) => {
    requireLive("the cloudflare transport");
    if (!accountId) throw new Error("cloudflare needs CLOUDFLARE_ACCOUNT_ID in the local keys file");
    return inner(call);
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
  waitedMs: number;
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

/**
 * Writes `value` as JSON to a temporary file in `path`'s own directory, then renames it into
 * place, the same shape `writeCacheFile` uses for every cached answer, so a crash or a quit
 * mid-write never leaves a half-written file to be read back. Shared here for whatever else
 * writes a whole file at once, rather than one answer at a time (the pilot's own stage files
 * among them).
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, JSON.stringify(value, null, 2));
}

/** `writeJsonAtomic`'s temp-and-rename write for text that's already what the file should hold, such as a README. */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmpFile = join(dir, `.tmp-${hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 16)}`);
  await writeFile(tmpFile, text);
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
    // An older cache file, written before usage or waitedMs was tracked, has neither at
    // all: read both as zero rather than a miss, so it isn't asked again just to learn
    // what it cost.
    return { ...parsed, usage: parsed.usage ?? NO_USAGE, waitedMs: parsed.waitedMs ?? 0 } as CacheEntry;
  } catch {
    // Unreadable or unparseable: a miss, not a crash. The call is asked again and the
    // file overwritten.
    return null;
  }
}

/**
 * Wraps a transport with a cache keyed on everything that could change an answer's
 * meaning. A cache hit returns the original call's `ms` and `waitedMs` with `cached: true`;
 * a miss asks the transport, writes the answer to the cache and returns it with `cached:
 * false`. An answer the call's `accept` turns down is never written, and one already in the
 * cache is read as a miss, so a stage never gets stuck on a reply it couldn't read the
 * first time.
 *
 * `ms` is the elapsed time with `waitedMs` (whatever `withRetries` reported spending on
 * backoffs or a limit) taken back out, so it reads as how long the model itself took to
 * answer, never inflated by a wait a transport that doesn't retry never reports at all
 * (`waitedMs` then defaults to 0). Never negative: a fake clock in a test can make the
 * measured elapsed time shorter than a wait it didn't actually spend real time on.
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
    const { text, model, usage, waitedMs = 0 } = await transport(call);
    const ms = Math.max(0, Date.now() - started - waitedMs);
    const entry: CacheEntry = { text, model, promptHash, ms, usage, waitedMs };
    if (readable(text)) await writeCacheFile(path, entry);
    return { ...entry, cached: false };
  };
}
