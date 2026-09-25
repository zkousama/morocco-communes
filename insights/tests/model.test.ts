import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeTransport, makeRunner, ollamaTransport, stubTransport, type ModelCall } from "../src/model.ts";

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
});
