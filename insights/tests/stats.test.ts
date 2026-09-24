import { describe, expect, it } from "vitest";
import { benjaminiHochberg, cohenKappa, mannWhitneyP, spearman, wilson } from "../src/stats.ts";

describe("stats", () => {
  it("wilson matches the worked example for 45 of 50", () => {
    const { low, high } = wilson(45, 50);
    expect(low).toBeCloseTo(0.7864, 4);
    expect(high).toBeCloseTo(0.9565, 4);
  });
  it("spearman is 1 for a monotone pair and -1 reversed", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it("benjamini-hochberg keeps the right discoveries in the textbook example", () => {
    const ps = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
    expect(benjaminiHochberg(ps, 0.05)).toEqual([true, true, false, false, false, false, false, false, false, false]);
  });
  it("kappa is 1 for perfect agreement and 0 for agreement at chance", () => {
    expect(cohenKappa(["y", "n", "y"], ["y", "n", "y"])).toBeCloseTo(1);
    expect(cohenKappa(["y", "y", "n", "n"], ["y", "n", "y", "n"])).toBeCloseTo(0);
  });
  it("mann-whitney gives a small p for separated groups", () => {
    expect(mannWhitneyP([1, 2, 3, 4, 5, 6], [10, 11, 12, 13, 14, 15])).toBeLessThan(0.01);
  });
});
