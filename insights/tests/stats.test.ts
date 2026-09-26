import { describe, expect, it } from "vitest";
import { benjaminiHochberg, bootstrap, cohenKappa, mannWhitneyP, spearman, wilson } from "../src/stats.ts";

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

describe("bootstrap", () => {
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  it("brackets the mean of a steady sample tightly, and is the same for the same seed", () => {
    const groups = Array.from({ length: 16 }, () => [1, 1, 0, 1]);
    const one = bootstrap(groups, mean, 2000, 7);
    expect(one.low).toBeCloseTo(0.75, 5);
    expect(one.high).toBeCloseTo(0.75, 5);
    expect(bootstrap(groups, mean, 2000, 7)).toEqual(one);
  });
  it("resamples whole groups, so a spread between groups widens the interval around the mean", () => {
    const groups = [[1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]];
    const { low, high } = bootstrap(groups, mean, 2000, 7);
    expect(low).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.5);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });
  it("gives a different interval for a different seed on a spread sample", () => {
    const groups = [[1], [0], [1], [1], [0], [1], [0], [1], [1], [0]];
    expect(bootstrap(groups, mean, 200, 1)).not.toEqual(bootstrap(groups, mean, 200, 2));
  });
  it("narrows with a lower confidence", () => {
    const groups = [[1], [0], [1], [1], [0], [1], [0], [1], [1], [0]];
    const wide = bootstrap(groups, mean, 2000, 7, 0.95);
    const narrow = bootstrap(groups, mean, 2000, 7, 0.5);
    expect(narrow.high - narrow.low).toBeLessThan(wide.high - wide.low);
  });
  it("leaves out a round whose statistic can't be computed, rather than reporting NaN", () => {
    // A round drawing only the empty group has nothing to average.
    const groups = [[], [1], [0]];
    const { low, high } = bootstrap(groups, mean, 2000, 7);
    expect(Number.isFinite(low)).toBe(true);
    expect(Number.isFinite(high)).toBe(true);
  });
  it("has no interval to give without a group", () => {
    const { low, high } = bootstrap([], mean, 2000, 7);
    expect(Number.isNaN(low)).toBe(true);
    expect(Number.isNaN(high)).toBe(true);
  });
});
