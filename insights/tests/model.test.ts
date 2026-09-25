import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeInvocation, claudeTransport, makeRunner, ollamaTransport, stubTransport, type ModelCall } from "../src/model.ts";
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

describe("the runner", () => {
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
});
