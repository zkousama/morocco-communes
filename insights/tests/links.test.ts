import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { FIELDS } from "../src/fields.ts";
import { aboutThisFinding, judgeLinks, runLink, type LinkOutcome } from "../src/links.ts";
import type { Check } from "../src/vocabulary.ts";

const data = loadData();

/** Either the outcome was refused, or every number in it is finite - never NaN, never Infinity. */
function expectFiniteOrRefused(outcome: LinkOutcome): void {
  if (outcome.refused) return;
  expect(Number.isFinite(outcome.p)).toBe(true);
  expect(Number.isFinite(outcome.effect)).toBe(true);
  expect(outcome.placeboEffects).toHaveLength(3);
  for (const placebo of outcome.placeboEffects) expect(Number.isFinite(placebo)).toBe(true);
}

describe("link tests", () => {
  // across communes, Spearman's rho between higher education and fertility is about -0.41 (n = 1,492)
  const schooling = { link: "together", x: "education.higher", y: "fertility.totalFertilityRate", year: 2024, level: "commune", direction: "negative" } as const;

  it("finds that fertility falls where more people went to university", () => {
    const outcome = runLink(schooling, data, 1);
    expect(outcome.n).toBeGreaterThan(1400);
    expect(outcome.effect).toBeLessThan(-0.3);
    expect(outcome.held).toBe(true);
    expect(outcome.p).toBeLessThan(0.01);
  });

  it("says the link didn't hold when the claimed direction is wrong", () => {
    expect(runLink({ ...schooling, direction: "positive" }, data, 1).held).toBe(false);
  });

  it("runs 3 placebos, the same ones for the same seed", () => {
    const a = runLink(schooling, data, 1);
    expect(a.placeboEffects).toHaveLength(3);
    expect(runLink(schooling, data, 1).placeboEffects).toEqual(a.placeboEffects);
  });

  it("refuses a measure it doesn't know", () => {
    expect(runLink({ ...schooling, y: "nothing.here" }, data, 1).refused).toBeTruthy();
  });

  it("refuses a premise that's the outcome itself or part of the same whole", () => {
    const itself = runLink({ link: "together", x: "households.peoplePerRoom", y: "households.peoplePerRoom", year: 2024, level: "commune", direction: "positive" }, data, 1);
    const sibling = runLink({ link: "together", x: "housing.occupancy.seasonal", y: "housing.occupancy.unoccupied", year: 2024, level: "commune", direction: "positive" }, data, 1);
    const part = runLink({ link: "peers", premise: "housing.occupancy.vacant", outcome: "housing.occupancy.unoccupied", level: "commune", direction: "higher" }, data, 1);
    for (const outcome of [itself, sibling, part]) expect(outcome.refused).toBe("tautology");
  });

  it("calls a link consistent only when it survives the correction, held, and no unrelated measure does as well", () => {
    const strong = { p: 0.0001, effect: -0.5, size: 0.5, held: true, placeboEffects: [0.1, -0.2, 0.05], n: 500 };
    const placeboBeatsIt = { ...strong, placeboEffects: [0.1, -0.6, 0.05] };
    const wrongWay = { ...strong, held: false };
    const weak = { ...strong, p: 0.3, effect: 0.05, size: 0.05 };
    expect(judgeLinks([strong, placeboBeatsIt, wrongWay, weak])).toEqual(["consistent", "not consistent", "not consistent", "not consistent"]);
  });
});

describe("the effect floor", () => {
  const base = { p: 0.0001, held: true, placeboEffects: [0.01, 0.02, 0.03], n: 500 };
  it("calls a real but thin link not consistent", () => {
    expect(judgeLinks([{ ...base, effect: 0.14, size: 0.14 }])).toEqual(["not consistent"]);
  });
  it("calls a link at the floor consistent", () => {
    expect(judgeLinks([{ ...base, effect: 0.2, size: 0.2 }])).toEqual(["consistent"]);
  });
  it("measures a peers link against the outcome's spread", () => {
    const outcome = runLink({ link: "peers", premise: "education.higher", outcome: "fertility.totalFertilityRate", level: "commune", direction: "lower" }, data, 1);
    expect(outcome.refused).toBeUndefined();
    expect(outcome.size).toBeGreaterThan(0);
    expect(outcome.size).toBeLessThan(5);
  });
});

describe("link tests: refuses what it can't compute", () => {
  it("refuses a peers split that leaves one side empty, rather than returning NaN", () => {
    // almost every commune has 0% tram commuters, so most régions' median is 0 and one
    // whole side of the split (nothing below 0) comes back empty
    const outcome = runLink(
      { link: "peers", premise: "commute.tram", outcome: "fertility.totalFertilityRate", level: "commune", direction: "higher" },
      data,
      1,
    );
    expect(outcome.refused).toBeTruthy();
    expect(outcome.effect).toBe(0);
    expect(outcome.placeboEffects).toEqual([]);
  });

  it("runs a peers link on real data with a finite effect and 3 finite placebos", () => {
    // communes above their région's median unemployment rate have a lower median fertility
    // rate than the ones below it (about -0.15, n = 1,480 across both halves)
    const outcome = runLink(
      { link: "peers", premise: "labour.unemploymentRate", outcome: "fertility.totalFertilityRate", level: "commune", direction: "lower" },
      data,
      1,
    );
    expect(outcome.refused).toBeUndefined();
    expect(outcome.n).toBe(1480);
    expect(outcome.effect).toBeCloseTo(-0.15, 1);
    expect(outcome.held).toBe(true);
    expect(Number.isFinite(outcome.p)).toBe(true);
    expect(outcome.placeboEffects).toHaveLength(3);
    for (const placebo of outcome.placeboEffects) expect(Number.isFinite(placebo)).toBe(true);
  });

  it("never returns NaN for any percent field tested against fertility, together or peers", () => {
    for (const f of FIELDS) {
      if (f.unit !== "percent") continue;
      expectFiniteOrRefused(
        runLink({ link: "together", x: f.path, y: "fertility.totalFertilityRate", year: 2024, level: "commune", direction: "negative" }, data, 1),
      );
      expectFiniteOrRefused(
        runLink({ link: "peers", premise: f.path, outcome: "fertility.totalFertilityRate", level: "commune", direction: "higher" }, data, 1),
      );
    }
  });

  it("leaves out a crosswalk-matched commune from a change link", () => {
    const withCrosswalk = (data.byLevel.get("commune") ?? []).filter((u) => {
      const paths = ["labour.unemploymentRate", "fertility.totalFertilityRate"];
      return paths.every((path) => u.figures.y2024[path] != null && u.figures.y2014[path] != null);
    }).length;
    const outcome = runLink(
      { link: "together", x: "labour.unemploymentRate", y: "fertility.totalFertilityRate", year: "change", level: "commune", direction: "negative" },
      data,
      1,
    );
    expect(outcome.n).toBeLessThan(withCrosswalk);
  });
});

describe("what makes a link test about its figure", () => {
  const base = { id: "t", code: "01.511.01.0", level: "commune", value: 30, reference: 10, score: 4, direction: "high" } as const;
  const unoccupied = { ...base, measure: "housing.occupancy.unoccupied", kind: "extreme" } as const;
  const crowding = { ...base, measure: "households.peoplePerRoom", kind: "extreme" } as const;
  const reads = (field: string): Check => ({ check: "compare", left: { of: { unit: "self" }, field, year: 2024 }, op: ">", right: { value: 0 } });

  it("refuses the 3 pairings the review found consistent", () => {
    expect(aboutThisFinding(
      { link: "together", x: crowding.measure, y: crowding.measure, year: 2024, level: "commune", direction: "positive" },
      reads(crowding.measure), crowding,
    )).toBe(false);
    expect(aboutThisFinding(
      { link: "together", x: "housing.occupancy.seasonal", y: unoccupied.measure, year: 2024, level: "commune", direction: "positive" },
      reads("housing.occupancy.seasonal"), unoccupied,
    )).toBe(false);
    expect(aboutThisFinding(
      { link: "peers", premise: "housing.occupancy.vacant", outcome: unoccupied.measure, level: "commune", direction: "higher" },
      reads("housing.occupancy.vacant"), unoccupied,
    )).toBe(false);
  });

  it("refuses a premise the data test doesn't read", () => {
    const test = { link: "together", x: "education.higher", y: crowding.measure, year: 2024, level: "commune", direction: "negative" } as const;
    expect(aboutThisFinding(test, reads("labour.activityRate"), crowding)).toBe(false);
    expect(aboutThisFinding(test, reads("education.higher"), crowding)).toBe(true);
  });

  it("reads both sides of a comparison as fields the data test reads", () => {
    const test = { link: "together", x: "education.higher", y: crowding.measure, year: 2024, level: "commune", direction: "negative" } as const;
    const both: Check = { check: "compare", left: { of: { unit: "self" }, field: "labour.activityRate", year: 2024 }, op: ">", right: { of: { unit: "country" }, field: "education.higher", year: 2024 } };
    expect(aboutThisFinding(test, both, crowding)).toBe(true);
  });

  it("refuses another outcome, or another level", () => {
    const test = { link: "together", x: "education.higher", y: "fertility.totalFertilityRate", year: 2024, level: "commune", direction: "negative" } as const;
    expect(aboutThisFinding(test, reads("education.higher"), crowding)).toBe(false);
    expect(aboutThisFinding({ ...test, y: crowding.measure, level: "province" }, reads("education.higher"), crowding)).toBe(false);
  });

  it("asks a change finding's together test to pair changes", () => {
    const moved = { ...crowding, kind: "change" } as const;
    const test = { link: "together", x: "education.higher", y: moved.measure, year: 2024, level: "commune", direction: "negative" } as const;
    expect(aboutThisFinding(test, reads("education.higher"), moved)).toBe(false);
    expect(aboutThisFinding({ ...test, year: "change" }, reads("education.higher"), moved)).toBe(true);
  });
});
