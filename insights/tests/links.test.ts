import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { FIELDS } from "../src/fields.ts";
import { judgeLinks, runLink, type LinkOutcome } from "../src/links.ts";

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

  it("calls a link consistent only when it survives the correction, held, and no unrelated measure does as well", () => {
    const strong = { p: 0.0001, effect: -0.5, held: true, placeboEffects: [0.1, -0.2, 0.05], n: 500 };
    const placeboBeatsIt = { ...strong, placeboEffects: [0.1, -0.6, 0.05] };
    const wrongWay = { ...strong, held: false };
    const weak = { ...strong, p: 0.3, effect: 0.05 };
    expect(judgeLinks([strong, placeboBeatsIt, wrongWay, weak])).toEqual(["consistent", "not consistent", "not consistent", "not consistent"]);
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
