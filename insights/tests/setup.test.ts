import { describe, expect, it } from "vitest";
import { parseSetup, readSetup } from "../src/setup.ts";

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
});
