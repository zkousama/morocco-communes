import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import type { Check } from "../../src/vocabulary.ts";
import { candidateIdOf, sampleDisagreements, sampleFindings, samplePool, sampleRated } from "../../src/pilot/sample.ts";
import { PILOT_SEED } from "../../src/pilot/setups.ts";

const data = loadData();
const findings = detect(data);

describe("the pilot's findings", () => {
  const chosen = sampleFindings(findings, PILOT_SEED);
  it("takes 6 extremes, 5 changes and 5 gaps, and no artefacts", () => {
    const count = (k: string) => chosen.filter((f) => f.kind === k).length;
    expect([count("extreme"), count("change"), count("gap"), count("artefact")]).toEqual([6, 5, 5, 0]);
  });
  it("includes communes and provinces", () => {
    expect(chosen.some((f) => f.level === "commune")).toBe(true);
    expect(chosen.some((f) => f.level === "province")).toBe(true);
  });
  it("is the same every time for the same seed, and different for another", () => {
    expect(sampleFindings(findings, PILOT_SEED)).toEqual(chosen);
    expect(sampleFindings(findings, PILOT_SEED + 1)).not.toEqual(chosen);
  });
});

const fake = Array.from({ length: 4 * 50 }, (_, i) => ({
  candidateId: `c${i}`, proposer: `P${(i % 4) + 1}`, findingId: `f${i % 16}`, passed: i % 5 !== 0,
}));

describe("the pool", () => {
  it("takes 30 passing candidates per proposer", () => {
    const pool = samplePool(fake, 30, 1);
    for (const p of ["P1", "P2", "P3", "P4"]) expect(pool.filter((e) => e.proposer === p)).toHaveLength(30);
    const byId = new Map(fake.map((c) => [c.candidateId, c]));
    expect(pool.every((e) => byId.get(e.candidateId)!.passed)).toBe(true);
  });
  it("takes all of a proposer's passing candidates when it has fewer than 30", () => {
    const few = fake.filter((c) => c.proposer !== "P1" || Number(c.candidateId.slice(1)) < 40);
    expect(samplePool(few, 30, 1).filter((e) => e.proposer === "P1").length).toBeLessThan(30);
  });
});

describe("the rating samples", () => {
  it("takes one reason per finding per proposer, from 15 findings", () => {
    const ids = sampleRated(fake, Array.from({ length: 16 }, (_, i) => `f${i}`), 15, 1);
    const byId = new Map(fake.map((c) => [c.candidateId, c]));
    for (const p of ["P1", "P2", "P3", "P4"]) {
      const mine = ids.map((id) => byId.get(id)!).filter((c) => c.proposer === p);
      expect(mine.length).toBeLessThanOrEqual(15);
      expect(new Set(mine.map((c) => c.findingId)).size).toBe(mine.length);
    }
  });
  it("finds only real disagreements, and caps them", () => {
    const verdicts = new Map<string, Map<string, boolean>>();
    for (let i = 0; i < 100; i++) verdicts.set(`c${i}`, new Map([["A1", true], ["A3", i % 2 === 0], ["A4", true]]));
    const all = sampleDisagreements(verdicts, 1000, 1);
    expect(all).toHaveLength(50);
    expect(sampleDisagreements(verdicts, 40, 1)).toHaveLength(40);
  });
});

describe("candidateIdOf", () => {
  const test: Check = {
    check: "compare",
    left: { of: { unit: "self" }, field: "education.higher", year: 2024 },
    op: ">",
    right: { value: 10 },
  };

  it("is stable for the same inputs", () => {
    expect(candidateIdOf("finding-1", "P1", test)).toBe(candidateIdOf("finding-1", "P1", test));
  });

  it("is 12 hex characters", () => {
    expect(candidateIdOf("finding-1", "P1", test)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("differs when the finding id differs", () => {
    expect(candidateIdOf("finding-2", "P1", test)).not.toBe(candidateIdOf("finding-1", "P1", test));
  });

  it("differs when the proposer differs", () => {
    expect(candidateIdOf("finding-1", "P2", test)).not.toBe(candidateIdOf("finding-1", "P1", test));
  });

  it("differs when the test differs", () => {
    const other: Check = { ...test, op: "<" };
    expect(candidateIdOf("finding-1", "P1", other)).not.toBe(candidateIdOf("finding-1", "P1", test));
  });
});
