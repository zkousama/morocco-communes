/**
 * Asks each question in cases.ts through Claude Code in headless mode, with the MCP server
 * as its only tools, and grades the answers. It measures the tools the way a client meets
 * them: whether a model picks the right one from its description, how many calls it takes,
 * and whether the figure it reports is the dataset's.
 *
 *   pnpm api:dev                                   (in another terminal)
 *   pnpm eval                                      every case, on Sonnet
 *   pnpm eval --model haiku --only ktama,titwan    a weaker model finds weaker descriptions
 *   pnpm eval --tool get_indicators                the cases that expect one tool
 *   pnpm eval --compare evals/results/<run>.json   what moved since that run
 *
 * It runs on the Claude Code login, so it spends a subscription's usage rather than an API
 * bill. User settings are skipped, so no plugin, hook or memory reaches the model.
 *
 * Every case records what it cost: tokens in, cached and out, dollars at API list price,
 * the time to the first token and the time the API spent. A run records what it ran
 * against: the model the CLI reports, its version, the commit, the dataset version, and
 * the tool list the server sent, to the character. Two runs can then be compared case by
 * case, which is how a change to a description is measured rather than guessed at.
 */
import { execSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASES, type Case, type Expect } from "./cases.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const API = (option("url") ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const MODEL = option("model") ?? "sonnet";
const ONLY = option("only")?.split(",");
const TOOL = option("tool");
const COMPARE = option("compare");
const CONCURRENCY = Number(option("concurrency") ?? 4);
const TIMEOUT_MS = 240_000;

const SYSTEM =
  "You are a helpful assistant. Answer the user's question. Use the tools you have when they help, and say so plainly when they can't answer it.";

interface Call {
  tool: string;
  input: unknown;
  error: boolean;
  /** What a failed call said, to read why. */
  message?: string;
}

/** What a run consumed, as the CLI's result event reports it. */
interface Usage {
  /** Input read fresh, not from the cache. */
  input: number;
  /** Input written to the cache on this run, and input read back from it. */
  cacheWrite: number;
  cacheRead: number;
  output: number;
  /** The part of the output the model spent thinking. */
  thinking: number;
}

interface Run {
  answer: string;
  calls: Call[];
  turns: number;
  /** Wall time, from spawning the CLI to its exit. */
  ms: number;
  /** Time the API spent answering, and until the first token arrived. */
  apiMs: number;
  ttftMs: number;
  usage: Usage;
  /** Dollars at API list price. The subscription is billed in usage, not in these. */
  costUsd: number;
  /** The model the API says answered, which an alias like sonnet doesn't say. */
  model: string;
  stopReason: string;
  /** The CLI's version, and the tools it says the model could see. */
  cli: string;
  tools: string[];
  failed?: string;
}

const NO_USAGE: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cacheRead: a.cacheRead + b.cacheRead,
  output: a.output + b.output,
  thinking: a.thinking + b.thinking,
});
/** Every input token the model read, whether fresh or cached. */
const inputOf = (u: Usage) => u.input + u.cacheWrite + u.cacheRead;

/** One question through `claude -p`, with the tool calls read off its event stream. */
async function ask(question: string, config: string, cwd: string): Promise<Run> {
  const started = Date.now();
  const child = spawn(
    "claude",
    [
      "-p", question,
      "--model", MODEL,
      "--setting-sources", "local",
      "--strict-mcp-config", "--mcp-config", config,
      "--tools", "",
      "--allowedTools", "mcp__morocco-communes",
      "--system-prompt", SYSTEM,
      "--output-format", "stream-json", "--verbose",
      "--no-session-persistence",
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  clearTimeout(timer);

  const calls: Call[] = [];
  const byId = new Map<string, Call>();
  let answer = "";
  let turns = 0;
  let apiMs = 0;
  let ttftMs = 0;
  let usage = NO_USAGE;
  let costUsd = 0;
  let model = "";
  let stopReason = "";
  let cli = "";
  let tools: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let event: {
      type?: string;
      subtype?: string;
      message?: { content?: unknown[] };
      result?: string;
      num_turns?: number;
      duration_api_ms?: number;
      ttft_ms?: number;
      total_cost_usd?: number;
      stop_reason?: string;
      model?: string;
      claude_code_version?: string;
      tools?: string[];
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
      event = JSON.parse(line);
    } catch {
      continue;
    }
    for (const part of (event.message?.content ?? []) as Record<string, unknown>[]) {
      if (event.type === "assistant" && part.type === "tool_use") {
        const call = { tool: String(part.name).replace("mcp__morocco-communes__", ""), input: part.input, error: false };
        calls.push(call);
        byId.set(String(part.id), call);
      }
      if (event.type === "user" && part.type === "tool_result" && part.is_error) {
        const call = byId.get(String(part.tool_use_id));
        if (call) {
          call.error = true;
          const content = part.content;
          call.message = (Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : String(content)).slice(0, 300);
        }
      }
    }
    if (event.type === "system" && event.subtype === "init") {
      cli = event.claude_code_version ?? "";
      tools = (event.tools ?? []).map((t) => t.replace("mcp__morocco-communes__", ""));
      model = event.model ?? model;
    }
    if (event.type === "result") {
      answer = event.result ?? "";
      turns = event.num_turns ?? 0;
      apiMs = event.duration_api_ms ?? 0;
      ttftMs = event.ttft_ms ?? 0;
      costUsd = event.total_cost_usd ?? 0;
      stopReason = event.stop_reason ?? "";
      const u = event.usage ?? {};
      usage = {
        input: u.input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        thinking: u.output_tokens_details?.thinking_tokens ?? 0,
      };
      const answered = Object.values(event.modelUsage ?? {})[0]?.canonicalModel;
      if (answered) model = answered;
    }
  }
  return {
    answer,
    calls,
    turns,
    ms: Date.now() - started,
    apiMs,
    ttftMs,
    usage,
    costUsd,
    model,
    stopReason,
    cli,
    tools,
    ...(code !== 0 || !answer ? { failed: `exit ${code}: ${err.trim().split("\n").slice(-2).join(" ")}` } : {}),
  };
}

/** Accents off and case folded, so Tetouan finds Tétouan. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();

/**
 * Every number in a text, however it was written: 6,124 or 6 124 or ٦١٢٤, and 15.3 or
 * 15,3. A separator followed by exactly 3 digits groups thousands; any other is a decimal.
 */
export function numbersIn(text: string): number[] {
  const ascii = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[٬]/g, ",").replace(/٫/g, ".");
  const grouped = ascii.replace(/(\d)[,   .](?=\d{3}(?!\d))/g, "$1");
  const decimals = grouped.replace(/(\d),(\d)/g, "$1.$2");
  return [...decimals.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** A figure is found when the answer states it, sign aside, to the precision it has. */
const states = (found: number[], expected: number) => {
  const target = Math.abs(expected);
  const tolerance = Number.isInteger(expected) && target >= 100 ? 0 : 0.051;
  return found.some((n) => Math.abs(n - target) <= tolerance);
};

interface Grade {
  pass: boolean;
  slow: boolean;
  missing: string[];
}

function grade(run: Run, expect: Expect): Grade {
  const missing: string[] = [];
  const text = fold(run.answer);
  for (const names of expect.names ?? []) {
    if (!names.some((n) => text.includes(fold(n)))) missing.push(`name ${names[0]}`);
  }
  const found = numbersIn(run.answer);
  for (const n of expect.numbers ?? []) {
    if (!states(found, n)) missing.push(`figure ${n}`);
  }
  if (expect.pattern && !expect.pattern.test(run.answer)) missing.push(`pattern ${expect.pattern}`);
  const called = new Set(run.calls.map((c) => c.tool));
  for (const tool of expect.tools ?? []) {
    if (!called.has(tool)) missing.push(`tool ${tool}`);
  }
  if (run.failed) missing.push(run.failed);
  return {
    pass: missing.length === 0,
    slow: expect.maxCalls !== undefined && run.calls.length > expect.maxCalls,
    missing,
  };
}

/** Runs the cases a few at a time, in order of the list. */
async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]!);
      }
    }),
  );
  return results;
}

const probe = await fetch(`${API}/api/version.json`).catch(() => null);
if (!probe?.ok) {
  console.error(`cannot reach ${API}; start the API with pnpm api:dev`);
  process.exit(1);
}
const datasetVersion =
  ((await probe.json()) as { data?: { sources?: { datasetVersion?: string } } }).data?.sources?.datasetVersion ?? "unknown";

/** The tool list the server sends, exactly as a client receives it before any question. */
async function toolList() {
  const res = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const tools = ((await res.json()) as { result?: { tools?: { name: string; description?: string }[] } }).result?.tools ?? [];
  return {
    count: tools.length,
    chars: JSON.stringify(tools).length,
    descriptions: Object.fromEntries(tools.map((t) => [t.name, (t.description ?? "").length])),
  };
}

const git = (command: string) => {
  try {
    return execSync(`git ${command}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

// An empty directory, so no project settings, CLAUDE.md or memory reach the model.
const cwd = await mkdtemp(join(tmpdir(), "communes-eval-"));
const config = join(cwd, "mcp.json");
await writeFile(config, JSON.stringify({ mcpServers: { "morocco-communes": { type: "http", url: `${API}/mcp` } } }));

// Expectations are resolved first, since a filter by tool reads them.
const resolved = await Promise.all(
  CASES.map(async (c: Case) => ({ c, expect: typeof c.expect === "function" ? await c.expect(API) : c.expect })),
);
const selected = resolved.filter(
  ({ c, expect }) => (!ONLY || ONLY.includes(c.id)) && (!TOOL || (expect.tools ?? []).includes(TOOL)),
);
const tooling = await toolList();
const startedAt = new Date();
console.log(
  `${selected.length} cases on ${MODEL}, against ${API}: dataset ${datasetVersion}, ` +
    `${tooling.count} tools in ${tooling.chars.toLocaleString("en")} characters\n`,
);

/** The second asking stands, but both are paid for. */
const retried = (first: Run, second: Run): Run => ({
  ...second,
  ms: first.ms + second.ms,
  apiMs: first.apiMs + second.apiMs,
  usage: addUsage(first.usage, second.usage),
  costUsd: first.costUsd + second.costUsd,
});

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const usd = (n: number) => `$${n.toFixed(n < 10 ? 3 : 2)}`;

let cli = "";
const results = await pool(selected, CONCURRENCY, async ({ c, expect }) => {
  const first = await ask(c.question, config, cwd);
  // Every question here needs the data, so an answer that called nothing came out of the
  // model's own memory: the server never reached it. That measures nothing, so it is
  // asked once more, and a second empty run is reported as the failure it is.
  const empty = first.calls.length === 0 && !first.failed;
  const run = empty ? retried(first, await ask(c.question, config, cwd)) : first;
  cli ||= run.cli;
  const g = grade(run, expect);
  const mark = g.pass ? (g.slow ? "slow" : "pass") : "FAIL";
  console.log(
    `${mark.padEnd(5)} ${c.id.padEnd(26)} ${String(run.calls.length).padStart(2)} calls ${(run.ms / 1000).toFixed(0).padStart(4)} s ` +
      `${k(inputOf(run.usage)).padStart(7)} in ${k(run.usage.output).padStart(6)} out ${usd(run.costUsd).padStart(7)}  ` +
      `${run.calls.map((x) => x.tool + (x.error ? "!" : "")).join(" → ")}${empty ? "  (asked twice: the first run reached no tools)" : ""}`,
  );
  if (!g.pass) console.log(`      missing ${g.missing.join("; ")}`);
  for (const call of run.calls.filter((x) => x.error)) console.log(`      ${call.tool} failed: ${call.message}`);
  const { cli: _cli, tools: _tools, ...kept } = run;
  return {
    id: c.id,
    category: c.category,
    question: c.question,
    expect: { ...expect, pattern: expect.pattern?.source },
    ...kept,
    ...g,
    ...(empty ? { asked: 2 } : {}),
  };
});
const finishedAt = new Date();

type Result = (typeof results)[number];

/** Nearest-rank percentile, which is a value some case actually had. */
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
const sum = (rows: Result[], f: (r: Result) => number) => rows.reduce((n, r) => n + f(r), 0);
const totalsOf = (rows: Result[]) => ({
  cases: rows.length,
  passed: rows.filter((r) => r.pass).length,
  calls: sum(rows, (r) => r.calls.length),
  turns: sum(rows, (r) => r.turns),
  toolErrors: sum(rows, (r) => r.calls.filter((c) => c.error).length),
  slow: rows.filter((r) => r.slow).length,
  usage: rows.reduce((u, r) => addUsage(u, r.usage), NO_USAGE),
  costUsd: sum(rows, (r) => r.costUsd),
  apiMs: sum(rows, (r) => r.apiMs),
});
const totals = totalsOf(results);
const answered = Object.entries(
  results.reduce<Record<string, number>>((n, r) => ((n[r.model] = (n[r.model] ?? 0) + 1), n), {}),
).sort((a, b) => b[1] - a[1])[0]?.[0] ?? MODEL;
const commit = git("rev-parse --short HEAD");
const dirty = git("status --porcelain").length > 0;

const row = (cells: string[], widths: number[]) =>
  cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join("  ");

console.log(
  `\n${totals.passed} of ${totals.cases} passed on ${answered} · CLI ${cli || "?"} · commit ${commit}${dirty ? " (uncommitted changes)" : ""} · dataset ${datasetVersion}`,
);
const W = [11, 7, 6, 8, 7, 8];
console.log(`\n  ${row(["", "pass", "calls", "input", "output", "cost"], W)}`);
for (const category of [...new Set(results.map((r) => r.category))]) {
  const t = totalsOf(results.filter((r) => r.category === category));
  console.log(`  ${row([category, `${t.passed}/${t.cases}`, String(t.calls), k(inputOf(t.usage)), k(t.usage.output), usd(t.costUsd)], W)}`);
}
console.log(`  ${row(["all", `${totals.passed}/${totals.cases}`, String(totals.calls), k(inputOf(totals.usage)), k(totals.usage.output), usd(totals.costUsd)], W)}`);

const D = [11, 8, 8, 8];
console.log(`\n  ${row(["per case", "median", "p90", "max"], D)}`);
const spread: [string, (r: Result) => number, (n: number) => string][] = [
  ["calls", (r) => r.calls.length, String],
  ["turns", (r) => r.turns, String],
  ["seconds", (r) => r.ms / 1000, (n) => n.toFixed(0)],
  ["first token", (r) => r.ttftMs / 1000, (n) => `${n.toFixed(1)} s`],
  ["input", (r) => inputOf(r.usage), k],
  ["output", (r) => r.usage.output, k],
  ["cost", (r) => r.costUsd, usd],
];
for (const [label, f, show] of spread) {
  const values = results.map(f);
  console.log(`  ${row([label, show(percentile(values, 50)), show(percentile(values, 90)), show(Math.max(0, ...values))], D)}`);
}

const input = inputOf(totals.usage);
const costliest = [...results].sort((a, b) => b.costUsd - a.costUsd).slice(0, 3);
console.log(
  `\n  cached      ${input ? Math.round((totals.usage.cacheRead / input) * 100) : 0}% of input read back from the cache, ` +
    `${k(totals.usage.thinking)} of the output spent thinking`,
);
console.log(`  costliest   ${costliest.map((r) => `${r.id} ${usd(r.costUsd)}`).join(" · ")}`);
console.log(
  `  budget      ${totals.slow} answers over their call budget, ${totals.toolErrors} tool errors`,
);
console.log(
  `  time        ${((finishedAt.getTime() - startedAt.getTime()) / 60000).toFixed(1)} min at concurrency ${CONCURRENCY}, ` +
    `${(totals.apiMs / 60000).toFixed(1)} min of API time`,
);
console.log(`  cost        at API list price; a subscription spends usage, not these dollars`);

const meta = {
  requested: MODEL,
  model: answered,
  cli,
  commit,
  dirty,
  datasetVersion,
  tools: tooling,
  concurrency: CONCURRENCY,
  filter: { ...(ONLY ? { only: ONLY } : {}), ...(TOOL ? { tool: TOOL } : {}) },
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
};

if (COMPARE) compare(JSON.parse(await readFile(COMPARE, "utf8")) as Saved, COMPARE);

await mkdir("evals/results", { recursive: true });
const file = `evals/results/${MODEL}-${startedAt.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
const saved: Saved = { schema: 2, model: MODEL, api: API, passed: totals.passed, total: totals.cases, meta, totals, results };
await writeFile(file, `${JSON.stringify(saved, null, 2)}\n`);
console.log(`\nwrote ${file}`);

interface Saved {
  schema?: number;
  model: string;
  api: string;
  passed: number;
  total: number;
  meta?: typeof meta;
  totals?: typeof totals;
  results: Partial<Result>[];
}

/**
 * This run against an earlier one, on the cases both asked. A run from before the harness
 * recorded usage compares on passes and calls, and says so for the rest.
 */
function compare(before: Saved, path: string) {
  const earlier = new Map(before.results.map((r) => [r.id!, r]));
  const both = results.filter((r) => earlier.has(r.id));
  const then = both.map((r) => earlier.get(r.id)!);
  const measured = then.every((r) => r.usage !== undefined);
  const change = (a: number, b: number) => (a === 0 ? "" : `${b >= a ? "+" : "−"}${Math.abs(((b - a) / a) * 100).toFixed(1)}%`);
  const C = [11, 10, 10, 8];
  const line = (label: string, a: number | null, b: number, show: (n: number) => string) =>
    console.log(`  ${row([label, a === null ? "—" : show(a), show(b), a === null ? "" : change(a, b)], C)}`);

  const name = path.split("/").pop();
  console.log(`\nagainst ${name}${before.meta ? ` (commit ${before.meta.commit}, ${before.meta.model})` : ""}, on the ${both.length} cases both asked`);
  console.log(`  ${row(["", "before", "after", "change"], C)}`);
  const passedThen = then.filter((r) => r.pass).length;
  console.log(`  ${row(["passed", `${passedThen}/${both.length}`, `${both.filter((r) => r.pass).length}/${both.length}`, ""], C)}`);
  line("calls", then.reduce((n, r) => n + (r.calls?.length ?? 0), 0), both.reduce((n, r) => n + r.calls.length, 0), String);
  line("turns", then.reduce((n, r) => n + (r.turns ?? 0), 0), both.reduce((n, r) => n + r.turns, 0), String);
  line("input", measured ? then.reduce((n, r) => n + inputOf(r.usage!), 0) : null, both.reduce((n, r) => n + inputOf(r.usage), 0), k);
  line("output", measured ? then.reduce((n, r) => n + r.usage!.output, 0) : null, both.reduce((n, r) => n + r.usage.output, 0), k);
  line("cost", measured ? then.reduce((n, r) => n + (r.costUsd ?? 0), 0) : null, both.reduce((n, r) => n + r.costUsd, 0), usd);
  line("tool list", before.meta?.tools.chars ?? null, tooling.chars, (n) => n.toLocaleString("en"));

  const flipped = both.filter((r) => r.pass !== earlier.get(r.id)!.pass);
  console.log(
    `  flipped     ${flipped.length === 0 ? "none" : flipped.map((r) => `${r.id} ${r.pass ? "FAIL → pass" : "pass → FAIL"}`).join(" · ")}`,
  );
  const moved = both
    .map((r) => ({ id: r.id, from: earlier.get(r.id)!.calls?.length ?? 0, to: r.calls.length }))
    .filter((m) => m.from !== m.to)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
    .slice(0, 5);
  console.log(`  calls moved ${moved.length === 0 ? "none" : moved.map((m) => `${m.id} ${m.from} → ${m.to}`).join(" · ")}`);
  if (!measured) console.log(`  the earlier run predates token and cost recording, so those rows compare nothing`);
}
