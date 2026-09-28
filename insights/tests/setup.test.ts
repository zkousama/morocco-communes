import { describe, expect, it, vi } from "vitest";
import { parseSetup, readSetup, transportFor, type Role } from "../src/setup.ts";

const good = {
  propose: { transport: "claude", model: "sonnet", effort: "high", samples: 5 },
  falsify: { transport: "claude", model: "opus", effort: "medium" },
  attackShownOnly: false, decidedBy: null,
};

describe("the setup", () => {
  it("reads the committed file", () => {
    const setup = readSetup();
    expect(setup.propose.samples).toBeGreaterThan(0);
    expect(setup.falsify.model).not.toBe(setup.propose.model);
  });
  it("refuses an adversary that's the proposer's own model", () => {
    expect(() => parseSetup({ ...good, falsify: { transport: "claude", model: "sonnet" } })).toThrow(/same model/);
  });
  it("refuses an effort that doesn't exist, and samples outside 1 to 5", () => {
    expect(() => parseSetup({ ...good, propose: { ...good.propose, effort: "ultra" } })).toThrow();
    expect(() => parseSetup({ ...good, propose: { ...good.propose, samples: 0 } })).toThrow();
    expect(() => parseSetup({ ...good, propose: { ...good.propose, samples: 6 } })).toThrow();
  });
  it("allows no effort, for a model that takes none", () => {
    expect(parseSetup({ ...good, propose: { transport: "claude", model: "haiku", samples: 5 } }).propose.effort).toBeUndefined();
  });
  it("refuses a misspelt key rather than run without it, and names it", () => {
    const { effort: _, ...proposeWithout } = good.propose;
    expect(() => parseSetup({ ...good, propose: { ...proposeWithout, efort: "high" } })).toThrow('insights/setup.json: propose: unknown key "efort"');
    expect(() => parseSetup({ ...good, falsify: { transport: "claude", model: "opus", efort: "medium" } })).toThrow('insights/setup.json: falsify: unknown key "efort"');
    expect(() => parseSetup({ ...good, attackShowOnly: true })).toThrow('insights/setup.json: unknown key "attackShowOnly"');
  });
});

describe("transportFor", () => {
  const roleFor = (transport: Role["transport"]): Role => ({ transport, model: "a-model" });

  it("returns a working function for each transport name", () => {
    for (const transport of ["claude", "ollama", "gemini"] as const) {
      expect(typeof transportFor(roleFor(transport), null)).toBe("function");
    }
  });

  it("calling the gemini one with INSIGHTS_LIVE unset rejects with the live-run message, never touching fetch", async () => {
    delete process.env.INSIGHTS_LIVE;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const transport = transportFor(roleFor("gemini"), null);
      await expect(transport({ model: "a-model", system: "s", prompt: "p", stage: "falsify", key: "k" })).rejects.toThrow(/INSIGHTS_LIVE/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
