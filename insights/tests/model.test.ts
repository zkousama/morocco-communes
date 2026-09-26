import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  claudeInvocation,
  claudeTransport,
  makeRunner,
  NO_USAGE,
  ollamaTransport,
  parseClaudeOutput,
  stubTransport,
  withRetries,
  writeJsonAtomic,
  type Effort,
  type ModelCall,
  type Transport,
} from "../src/model.ts";
import { newIds, traceparent } from "../src/trace.ts";

const call: ModelCall = { model: "sonnet", system: "s", prompt: "p", stage: "propose", key: "finding-1:0" };

// one cache and one call counter shared by every runner a test makes
function setup() {
  let calls = 0;
  const transport = stubTransport(() => { calls += 1; return '{"ok":true}'; });
  const cacheDir = mkdtempSync(join(tmpdir(), "insights-cache-"));
  const runner = (datasetVersion = "1.8.0", stageVersions: Record<string, string> = { propose: "1" }) =>
    makeRunner(transport, { cacheDir, datasetVersion, stageVersions });
  return { runner, count: () => calls };
}

describe("tokens and cost", () => {
  it("reads tokens and cost from the CLI's JSON", () => {
    const json = JSON.stringify({
      result: "{}", is_error: false, total_cost_usd: 0.0123,
      usage: { input_tokens: 10, output_tokens: 200, cache_creation_input_tokens: 30, cache_read_input_tokens: 4000, output_tokens_details: { thinking_tokens: 150 } },
      modelUsage: { "claude-sonnet-5": { canonicalModel: "claude-sonnet-5" } },
    });
    expect(parseClaudeOutput(json, "sonnet")).toEqual({
      text: "{}", model: "claude-sonnet-5",
      usage: { input: 10, output: 200, cacheRead: 4000, cacheWrite: 30, thinking: 150, costUsd: 0.0123 },
    });
  });

  it("keeps the original call's usage on a cache hit", async () => {
    const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, thinking: 5, costUsd: 0.5 };
    const transport = async (c: ModelCall) => ({ text: '{"ok":true}', model: c.model, usage });
    const cacheDir = mkdtempSync(join(tmpdir(), "usage-"));
    const run = makeRunner(transport, { cacheDir, datasetVersion: "t", stageVersions: {} });
    await run(call);
    const again = await run(call);
    expect(again.cached).toBe(true);
    expect(again.usage).toEqual(usage);
  });
});

describe("the runner", () => {
  it("asks again when the effort or the label changes", async () => {
    const s = setup();
    await s.runner()(call);
    await s.runner()({ ...call, effort: "high" });
    await s.runner()({ ...call, effort: "high", label: "repeat" });
    expect(s.count()).toBe(3);
    await s.runner()({ ...call, effort: "high", label: "repeat" });
    expect(s.count()).toBe(3);
  });

  it("answers from the cache the second time", async () => {
    const s = setup();
    const first = await s.runner()(call);
    const second = await s.runner()(call);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.text).toBe(first.text);
    expect(s.count()).toBe(1);
  });

  it("asks again when the prompt, the system prompt, the model, the stage version or the dataset changes", async () => {
    const s = setup();
    await s.runner()(call);
    await s.runner()({ ...call, prompt: "p2" });
    await s.runner()({ ...call, system: "s2" });
    await s.runner()({ ...call, model: "opus" });
    await s.runner("1.8.0", { propose: "2" })(call);
    await s.runner("1.9.0")(call);
    expect(s.count()).toBe(6);
    await s.runner()(call);
    expect(s.count()).toBe(6);
  });

  it("shares one cache entry for 2 calls differing only in traceparent", async () => {
    const s = setup();
    const a = newIds();
    const b = newIds();
    const first = await s.runner()({ ...call, traceparent: traceparent(a.traceId, a.spanId) });
    const second = await s.runner()({ ...call, traceparent: traceparent(b.traceId, b.spanId) });
    expect(second.cached).toBe(true);
    expect(second.text).toBe(first.text);
    expect(s.count()).toBe(1);
  });

  it("records what produced each answer", async () => {
    const reply = await setup().runner()(call);
    expect(reply.model).toBe("sonnet");
    expect(reply.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("won't spend a real call unless the run was started live", async () => {
    const before = process.env.INSIGHTS_LIVE;
    delete process.env.INSIGHTS_LIVE;
    await expect(claudeTransport()(call)).rejects.toThrow(/INSIGHTS_LIVE/);
    await expect(ollamaTransport()(call)).rejects.toThrow(/INSIGHTS_LIVE/);
    if (before !== undefined) process.env.INSIGHTS_LIVE = before;
  });

  it("keeps the original call's ms on a cache hit", async () => {
    const transport = stubTransport(() => {
      // slow enough that a cache hit recomputing ms, instead of keeping the stored
      // one, would show up as a difference rather than noise
      const until = Date.now() + 20;
      while (Date.now() < until) {
        // busy-wait
      }
      return '{"ok":true}';
    });
    const cacheDir = mkdtempSync(join(tmpdir(), "insights-cache-"));
    const runner = makeRunner(transport, { cacheDir, datasetVersion: "1.8.0", stageVersions: { propose: "1" } });
    const first = await runner(call);
    const second = await runner(call);
    expect(first.ms).toBeGreaterThanOrEqual(20);
    expect(second.cached).toBe(true);
    expect(second.ms).toBe(first.ms);
  });

  it("excludes a retry's own wait from ms, and reports it separately as waitedMs", async () => {
    vi.useFakeTimers();
    try {
      let tries = 0;
      const flaky: Transport = async () => {
        tries++;
        if (tries === 1) throw new Error("claude exited 1: overloaded");
        return { text: '{"ok":true}', model: "sonnet", usage: NO_USAGE };
      };
      // A fake clock that actually advances when `sleep` is called: without subtracting
      // `waitedMs`, `Date.now() - started` alone would already read the full 1,000ms, so
      // this (unlike a clock that never moves) fails if the subtraction is ever dropped.
      const retried = withRetries(flaky, {
        tries: 3, backoffMs: [1000], limitPollMs: 1000, limitMaxMs: 10_000,
        sleep: async (ms) => { vi.setSystemTime(Date.now() + ms); },
      });
      const cacheDir = mkdtempSync(join(tmpdir(), "waited-"));
      const runner = makeRunner(retried, { cacheDir, datasetVersion: "t", stageVersions: {} });
      const reply = await runner(call);
      expect(reply.waitedMs).toBe(1000);
      expect(reply.ms).toBeLessThan(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never caches an answer its stage can't read, so a re-run asks again", async () => {
    let calls = 0;
    const transport = stubTransport(() => { calls += 1; return calls === 1 ? "not json" : '{"ok":true}'; });
    const cacheDir = mkdtempSync(join(tmpdir(), "insights-cache-"));
    const runner = makeRunner(transport, { cacheDir, datasetVersion: "1.8.0", stageVersions: { propose: "1" } });
    const readable = { ...call, accept: (text: string) => text.startsWith("{") };

    const first = await runner(readable);
    expect(first.text).toBe("not json");
    const second = await runner(readable);
    expect(second.cached).toBe(false);
    const third = await runner(readable);
    expect(third.cached).toBe(true);
    expect(calls).toBe(2);
  });

  it("asks again rather than hand back a cached answer its stage can't read", async () => {
    let calls = 0;
    const transport = stubTransport(() => { calls += 1; return "not json"; });
    const cacheDir = mkdtempSync(join(tmpdir(), "insights-cache-"));
    const runner = makeRunner(transport, { cacheDir, datasetVersion: "1.8.0", stageVersions: { propose: "1" } });
    await runner(call); // cached, with nothing to say it can't be read
    const again = await runner({ ...call, accept: (text: string) => text.startsWith("{") });
    expect(again.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("treats a corrupt cache file as a miss", async () => {
    let calls = 0;
    const transport = stubTransport(() => { calls += 1; return '{"ok":true}'; });
    const cacheDir = mkdtempSync(join(tmpdir(), "insights-cache-"));
    const runner = makeRunner(transport, { cacheDir, datasetVersion: "1.8.0", stageVersions: { propose: "1" } });
    await runner(call);

    // the runner just wrote the one cache file for this stage; break it
    const stageDir = join(cacheDir, "propose");
    const [file] = readdirSync(stageDir);
    writeFileSync(join(stageDir, file!), "not json");

    const second = await runner(call);
    expect(calls).toBe(2);
    expect(second.cached).toBe(false);
  });
});

describe("the claude child", () => {
  const withTrace = { ...call, traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" };

  it("runs from the temp directory, with no MCP servers, no tools and no saved session", () => {
    const { args, cwd } = claudeInvocation(call, {});
    expect(cwd).toBe(tmpdir());
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2)).toEqual(["--setting-sources", "local"]);
    expect(args).toContain("--no-session-persistence");
  });

  it("never passes an API key on, so it answers on the signed-in subscription", () => {
    const { env } = claudeInvocation(call, { ANTHROPIC_API_KEY: "sk-test", PATH: "/usr/bin" });
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("turns its telemetry on only when a collector is set", () => {
    expect(claudeInvocation(withTrace, {}).env).not.toHaveProperty("TRACEPARENT");
    const traced = claudeInvocation(withTrace, { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.test" }).env;
    expect(traced.TRACEPARENT).toBe(withTrace.traceparent);
    expect(traced.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
  });

  it("passes the effort it was given, and none when it wasn't", () => {
    const withEffort = claudeInvocation({ ...call, effort: "medium" }, {});
    expect(withEffort.args).toContain("--effort");
    expect(withEffort.args[withEffort.args.indexOf("--effort") + 1]).toBe("medium");
    expect(claudeInvocation(call, {}).args).not.toContain("--effort");
  });

  it("never hands the child the parent session's own settings", () => {
    const parent = {
      PATH: "/usr/bin", HOME: "/home/x",
      CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/s",
      CLAUDE_CODE_EFFORT_LEVEL: "xhigh", CLAUDE_EFFORT: "xhigh", CLAUDE_CODE_CHILD_SESSION: "1",
    };
    const { env } = claudeInvocation(call, parent);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    for (const key of Object.keys(env)) expect(key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key === "CLAUDE_EFFORT").toBe(false);
  });

  it("keeps telemetry switches it sets itself, even though they start CLAUDE_CODE_", () => {
    const { env } = claudeInvocation({ ...call, traceparent: "00-a-b-01" }, { OTEL_EXPORTER_OTLP_ENDPOINT: "http://x", CLAUDE_CODE_SESSION_ID: "s" });
    expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
  });
});

describe("writeJsonAtomic", () => {
  it("writes valid JSON that reads back the same value, creating directories as needed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wja-"));
    const path = join(dir, "nested", "file.json");
    await writeJsonAtomic(path, { a: 1, b: [1, 2, 3] });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("never leaves a stray temp file behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wja-"));
    const path = join(dir, "file.json");
    await writeJsonAtomic(path, { ok: true });
    expect(readdirSync(dir)).toEqual(["file.json"]);
  });
});
