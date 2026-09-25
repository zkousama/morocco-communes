import { describe, expect, it } from "vitest";
import { classify, claudeFailure, LimitError, TransientError, withRetries, type Transport } from "../src/model.ts";
import { NO_USAGE } from "../src/model.ts";

const call = { model: "sonnet", system: "s", prompt: "p", stage: "propose", key: "k" };
const ok = { text: "{}", model: "sonnet", usage: NO_USAGE };

function scripted(outcomes: (Error | "ok")[]): { transport: Transport; calls: () => number } {
  let i = 0;
  return {
    transport: async () => {
      const next = outcomes[Math.min(i++, outcomes.length - 1)];
      if (next === "ok") return ok;
      throw next;
    },
    calls: () => i,
  };
}

function clock() {
  let now = 0;
  const waits: number[] = [];
  return { sleep: async (ms: number) => { waits.push(ms); now += ms; }, waits, now: () => now };
}

describe("classify", () => {
  it("reads the CLI's limit messages as limits", () => {
    for (const message of [
      "claude reported an error: You've hit your limit · resets 3pm (Africa/Casablanca)",
      "claude reported an error: You've hit your fast limit",
      "claude reported an error: You've hit your monthly spend limit",
      "claude reported an error: Claude AI usage limit reached|1758880800",
      'claude reported an error: API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"x"}}',
    ]) expect(classify(new Error(message))).toBe("limit");
  });
  it("reads timeouts, exits, overloads and garbled output as transient", () => {
    expect(classify(new Error("claude timed out after 240000ms"))).toBe("transient");
    expect(classify(new Error("claude exited 1: something broke"))).toBe("transient");
    expect(classify(new Error('claude reported an error: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}'))).toBe("transient");
    expect(classify(new Error("claude produced unparseable output: <html>"))).toBe("transient");
  });
  it("reads a missing binary or an empty balance as fatal", () => {
    expect(classify(new Error("couldn't start claude: spawn claude ENOENT"))).toBe("fatal");
    expect(classify(new Error("claude reported an error: Credit balance is too low"))).toBe("fatal");
  });
  it("trusts the typed errors", () => {
    expect(classify(new LimitError("x", 1000))).toBe("limit");
    expect(classify(new TransientError("x"))).toBe("transient");
  });
});

describe("withRetries", () => {
  it("retries a hiccup and returns the answer", async () => {
    const c = clock();
    const s = scripted([new Error("claude timed out after 240000 ms"), "ok"]);
    const reply = await withRetries(s.transport, { tries: 3, backoffMs: [5, 30, 120], limitPollMs: 1000, limitMaxMs: 10_000, sleep: c.sleep })(call);
    expect(reply).toEqual(ok);
    expect(s.calls()).toBe(2);
    expect(c.waits).toEqual([5]);
  });
  it("gives up after its tries", async () => {
    const c = clock();
    const s = scripted([new Error("claude exited with code 1")]);
    await expect(withRetries(s.transport, { tries: 3, backoffMs: [5, 30, 120], limitPollMs: 1000, limitMaxMs: 10_000, sleep: c.sleep })(call)).rejects.toThrow(/exited/);
    expect(s.calls()).toBe(4);
  });
  it("waits out a limit and carries on", async () => {
    const c = clock();
    const s = scripted([new Error("claude reported an error: You've hit your session limit"), new Error("claude reported an error: You've hit your session limit"), "ok"]);
    const reply = await withRetries(s.transport, { tries: 3, backoffMs: [5], limitPollMs: 1000, limitMaxMs: 10_000, sleep: c.sleep })(call);
    expect(reply).toEqual(ok);
    expect(c.waits).toEqual([1000, 1000]);
  });
  it("uses the wait a limit asks for", async () => {
    const c = clock();
    const s = scripted([new LimitError("429", 2500), "ok"]);
    await withRetries(s.transport, { tries: 3, backoffMs: [5], limitPollMs: 1000, limitMaxMs: 10_000, sleep: c.sleep })(call);
    expect(c.waits).toEqual([2500]);
  });
  it("stops waiting once the limit's had its time, and says so", async () => {
    const c = clock();
    const s = scripted([new Error("claude reported an error: You've hit your weekly limit")]);
    await expect(withRetries(s.transport, { tries: 3, backoffMs: [5], limitPollMs: 4000, limitMaxMs: 10_000, sleep: c.sleep })(call)).rejects.toBeInstanceOf(LimitError);
    expect(c.now()).toBeGreaterThanOrEqual(10_000);
    expect(c.waits).toEqual([4000, 4000, 2000]);
  });
  it("never retries a missing binary", async () => {
    const c = clock();
    const s = scripted([new Error("couldn't start claude: spawn claude ENOENT")]);
    await expect(withRetries(s.transport, { tries: 3, backoffMs: [5], limitPollMs: 1000, limitMaxMs: 10_000, sleep: c.sleep })(call)).rejects.toThrow(/ENOENT/);
    expect(s.calls()).toBe(1);
  });
});

describe("a nonzero exit", () => {
  it("keeps the CLI's own message from its JSON, so a limit reads as one", () => {
    const stdout = JSON.stringify({ type: "result", is_error: true, result: "You've hit your limit · resets 3pm" });
    const error = claudeFailure(1, stdout, "");
    expect(error.message).toBe("claude reported an error: You've hit your limit · resets 3pm");
    expect(classify(error)).toBe("limit");
  });
  it("falls back to stderr when stdout isn't the CLI's JSON", () => {
    expect(claudeFailure(2, "", "line one\nboom").message).toBe("claude exited 2: line one boom");
  });
});
