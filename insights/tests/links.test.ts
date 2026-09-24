import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { judgeLinks, runLink } from "../src/links.ts";

const data = loadData();

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
