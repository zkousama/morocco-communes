/**
 * Asks each question in cases.ts through Claude Code in headless mode, with the MCP server
 * as its only tools, and grades the answers. It measures the tools the way a client meets
 * them: whether a model picks the right one from its description, how many calls it takes,
 * and whether the figure it reports is the dataset's.
 *
 *   pnpm api:dev                                   (in another terminal)
 *   pnpm eval                                      every case, on Sonnet
 *   pnpm eval --model haiku --only ktama,titwan    a weaker model finds weaker descriptions
 *
 * It runs on the Claude Code login, so it spends a subscription's usage rather than an API
 * bill. User settings are skipped, so no plugin, hook or memory reaches the model.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

interface Run {
  answer: string;
  calls: Call[];
  turns: number;
  ms: number;
  failed?: string;
}

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
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let event: { type?: string; message?: { content?: unknown[] }; result?: string; num_turns?: number };
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
    if (event.type === "result") {
      answer = event.result ?? "";
      turns = event.num_turns ?? 0;
    }
  }
  return {
    answer,
    calls,
    turns,
    ms: Date.now() - started,
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

// An empty directory, so no project settings, CLAUDE.md or memory reach the model.
const cwd = await mkdtemp(join(tmpdir(), "communes-eval-"));
const config = join(cwd, "mcp.json");
await writeFile(config, JSON.stringify({ mcpServers: { "morocco-communes": { type: "http", url: `${API}/mcp` } } }));

const cases = CASES.filter((c) => !ONLY || ONLY.includes(c.id));
console.log(`${cases.length} cases on ${MODEL}, against ${API}\n`);

const results = await pool(cases, CONCURRENCY, async (c: Case) => {
  const expect = typeof c.expect === "function" ? await c.expect(API) : c.expect;
  const run = await ask(c.question, config, cwd);
  const g = grade(run, expect);
  const mark = g.pass ? (g.slow ? "slow" : "pass") : "FAIL";
  console.log(`${mark.padEnd(5)} ${c.id.padEnd(26)} ${String(run.calls.length).padStart(2)} calls ${(run.ms / 1000).toFixed(0).padStart(4)} s  ${run.calls.map((x) => x.tool + (x.error ? "!" : "")).join(" → ")}`);
  if (!g.pass) console.log(`      missing ${g.missing.join("; ")}`);
  for (const call of run.calls.filter((x) => x.error)) console.log(`      ${call.tool} failed: ${call.message}`);
  return { id: c.id, category: c.category, question: c.question, expect: { ...expect, pattern: expect.pattern?.source }, ...run, ...g };
});

const passed = results.filter((r) => r.pass).length;
const categories = [...new Set(results.map((r) => r.category))];
console.log(`\n${passed} of ${results.length} passed on ${MODEL}`);
for (const category of categories) {
  const inside = results.filter((r) => r.category === category);
  console.log(`  ${category.padEnd(11)} ${inside.filter((r) => r.pass).length}/${inside.length}`);
}
const calls = results.reduce((n, r) => n + r.calls.length, 0);
console.log(`  ${calls} tool calls, ${results.filter((r) => r.slow).length} answers over their call budget, ${results.reduce((n, r) => n + r.calls.filter((c) => c.error).length, 0)} tool errors`);

await mkdir("evals/results", { recursive: true });
const file = `evals/results/${MODEL}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
await writeFile(file, `${JSON.stringify({ model: MODEL, api: API, passed, total: results.length, results }, null, 2)}\n`);
console.log(`\nwrote ${file}`);
