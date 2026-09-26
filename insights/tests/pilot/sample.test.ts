import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import type { Finding } from "../../src/detect.ts";
import type { Check } from "../../src/vocabulary.ts";
import { candidateIdOf, sampleDisagreements, sampleFindings, samplePool, sampleRated } from "../../src/pilot/sample.ts";
import { PILOT_SEED } from "../../src/pilot/setups.ts";

const data = loadData();
const findings = detect(data);

const sortedByCandidate = <T extends { candidateId: string }>(items: T[]) =>
  [...items].sort((a, b) => a.candidateId.localeCompare(b.candidateId));

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
  it("gives the same sample regardless of the input order", () => {
    expect(sampleFindings([...findings].reverse(), PILOT_SEED)).toEqual(chosen);
  });
});

/** A minimal `Finding`, for the error-path tests below: only `id`, `level` and `kind` vary. */
function fakeFinding(over: { id: string; level: Finding["level"]; kind: Finding["kind"] }): Finding {
  return { code: over.id, measure: "m", value: 1, reference: 0, score: 5, direction: "high", ...over };
}

describe("sampleFindings' error paths", () => {
  it("throws when a kind can't fill its quota", () => {
    const extremes = Array.from({ length: 6 }, (_, i) => fakeFinding({ id: `e${i}`, level: "commune", kind: "extreme" }));
    const changes = Array.from({ length: 5 }, (_, i) => fakeFinding({ id: `c${i}`, level: "commune", kind: "change" }));
    const gapsShort = Array.from({ length: 4 }, (_, i) => fakeFinding({ id: `g${i}`, level: "commune", kind: "gap" }));
    expect(() => sampleFindings([...extremes, ...changes, ...gapsShort], 1)).toThrow(
      /only 4 non-artefact "gap" findings, need 5/,
    );
  });

  it("throws when no kind has a province to fall back on", () => {
    const extremes = Array.from({ length: 6 }, (_, i) => fakeFinding({ id: `e${i}`, level: "commune", kind: "extreme" }));
    const changes = Array.from({ length: 5 }, (_, i) => fakeFinding({ id: `c${i}`, level: "commune", kind: "change" }));
    const gaps = Array.from({ length: 5 }, (_, i) => fakeFinding({ id: `g${i}`, level: "commune", kind: "gap" }));
    expect(() => sampleFindings([...extremes, ...changes, ...gaps], 1)).toThrow(/no province-level finding is available/);
  });

  it("throws when the kind that could supply a province has no commune finding to swap out", () => {
    const extremes = Array.from({ length: 6 }, (_, i) =>
      fakeFinding({ id: `e${String(i).padStart(2, "0")}`, level: "commune", kind: "extreme" }),
    );
    const gaps = Array.from({ length: 5 }, (_, i) =>
      fakeFinding({ id: `g${String(i).padStart(2, "0")}`, level: "commune", kind: "gap" }),
    );
    const arrondissements = Array.from({ length: 6 }, (_, i) =>
      fakeFinding({ id: `a${String(i).padStart(2, "0")}`, level: "arrondissement", kind: "change" }),
    );
    const provinces = [
      fakeFinding({ id: "p00", level: "province", kind: "change" }),
      fakeFinding({ id: "p01", level: "province", kind: "change" }),
    ];
    // Seed 21 is the one found (by trying seeds against this exact fixture) where the
    // shuffle leaves both provinces unpicked and all 5 of "change"'s picks arrondissements.
    expect(() => sampleFindings([...extremes, ...gaps, ...arrondissements, ...provinces], 21)).toThrow(
      /"change"'s picks hold no commune finding to swap/,
    );
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
    expect(samplePool(few, 30, 1).filter((e) => e.proposer === "P1")).toHaveLength(8);
  });
  it("gives the same draw for the same set regardless of input order", () => {
    const a = samplePool(fake, 30, 1);
    const b = samplePool([...fake].reverse(), 30, 1);
    expect(sortedByCandidate(b)).toEqual(sortedByCandidate(a));
  });
});

const RATED_FINDING_IDS = Array.from({ length: 16 }, (_, i) => `f${i}`);
/** Every proposer has 3 passing candidates for every finding, so a proposer can reach all 16. */
const fakeRated = ["P1", "P2", "P3", "P4"].flatMap((proposer) =>
  RATED_FINDING_IDS.flatMap((findingId) =>
    Array.from({ length: 3 }, (_, k) => ({ candidateId: `${proposer}-${findingId}-${k}`, proposer, findingId, passed: true })),
  ),
);

describe("the rating samples", () => {
  it("takes one reason per finding per proposer, from 15 findings", () => {
    const ids = sampleRated(fakeRated, RATED_FINDING_IDS, 15, 1);
    const byId = new Map(fakeRated.map((c) => [c.candidateId, c]));
    for (const p of ["P1", "P2", "P3", "P4"]) {
      const mine = ids.map((id) => byId.get(id)!).filter((c) => c.proposer === p);
      expect(mine).toHaveLength(15);
      expect(new Set(mine.map((c) => c.findingId)).size).toBe(15);
    }
  });
  it("draws a candidate at random rather than always the first", () => {
    const ids = sampleRated(fakeRated, RATED_FINDING_IDS, 15, 7);
    expect(ids.some((id) => !id.endsWith("-0"))).toBe(true);
  });
  it("gives the same draw for the same set regardless of input order", () => {
    const a = sampleRated(fakeRated, RATED_FINDING_IDS, 15, 3);
    const b = sampleRated([...fakeRated].reverse(), [...RATED_FINDING_IDS].reverse(), 15, 3);
    expect([...b].sort()).toEqual([...a].sort());
  });

  it("finds only real disagreements, and spreads a capped sample across more than one group", () => {
    const verdicts = new Map<string, Map<string, boolean>>();
    for (let i = 0; i < 60; i++) verdicts.set(`g1-${i}`, new Map([["A1", true], ["A3", false], ["A4", true]]));
    for (let i = 0; i < 40; i++) verdicts.set(`g2-${i}`, new Map([["A1", false], ["A3", true], ["A4", false]]));
    for (let i = 0; i < 20; i++) verdicts.set(`agree-${i}`, new Map([["A1", true], ["A3", true], ["A4", true]]));

    const all = sampleDisagreements(verdicts, 1000, 1);
    expect(all).toHaveLength(100); // the 20 "agree" candidates are never disagreements

    const capped = sampleDisagreements(verdicts, 50, 1);
    expect(capped).toHaveLength(50);
    expect(capped.some((id) => id.startsWith("g1"))).toBe(true);
    expect(capped.some((id) => id.startsWith("g2"))).toBe(true);
  });
  it("gives the same draw for the same set regardless of the map's insertion order", () => {
    const verdicts = new Map<string, Map<string, boolean>>();
    for (let i = 0; i < 60; i++) verdicts.set(`g1-${i}`, new Map([["A1", true], ["A3", false], ["A4", true]]));
    for (let i = 0; i < 40; i++) verdicts.set(`g2-${i}`, new Map([["A1", false], ["A3", true], ["A4", false]]));

    const reordered = new Map<string, Map<string, boolean>>();
    for (let i = 39; i >= 0; i--) reordered.set(`g2-${i}`, verdicts.get(`g2-${i}`)!);
    for (let i = 59; i >= 0; i--) reordered.set(`g1-${i}`, verdicts.get(`g1-${i}`)!);

    expect([...sampleDisagreements(reordered, 50, 1)].sort()).toEqual([...sampleDisagreements(verdicts, 50, 1)].sort());
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
