import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import type { Graded } from "../src/grade.ts";
import type { Hypothesis } from "../src/run.ts";
import { computeMetrics, guard, plantErrors, type Metrics } from "../src/score.ts";

const metrics = (yes: number, graded: number, caught = 90): Metrics => ({
  measuredAt: "", published: { yes, graded, low: 0, high: 0, lowOneSided: 0 },
  rejectedButSound: { count: 0, byStage: {} }, agreement: null,
  planted: { total: 100, caught, byKind: {} },
});

describe("the guard", () => {
  it("refuses to publish without a graded set", () => {
    expect(guard(metrics(0, 0), null).ok).toBe(false);
  });
  it("refuses when the interval's low end falls under 80%", () => {
    expect(guard(metrics(40, 50), null).ok).toBe(false);
    expect(guard(metrics(46, 50), null).ok).toBe(true);
  });
  it("refuses when planted errors are caught less often than before", () => {
    expect(guard(metrics(46, 50, 80), metrics(46, 50, 90)).ok).toBe(false);
  });
});

const data = loadData();
const commune = data.byLevel.get("commune")!.find((c) => c.figures.y2024["education.higher"] != null)!;

const hyp = (stage: Hypothesis["stage"]): Hypothesis => ({
  claim: { en: "c", fr: "c" },
  link: { en: "l", fr: "l" },
  premise: { en: "p", fr: "p" },
  evidence: {
    kind: "data",
    check: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: -1000 } },
    numbers: {},
  },
  linkTest: null,
  support: 1,
  stage,
  reason: null,
});

const finding = { id: "f0", code: commune.code, level: "commune" as const, measure: "education.higher", kind: "extreme" as const, value: 0, reference: 0, score: 0, direction: "high" as const };

const graded = (id: string, gate: "published" | "rejected", answer: "yes" | "no" | "skip", stage: Hypothesis["stage"] = "published"): Graded => ({
  id,
  findingId: finding.id,
  gate,
  item: { finding, line: { en: "line" }, hypothesis: hyp(stage) },
  answer,
  gradedAt: "",
});

describe("computeMetrics", () => {
  it("counts the published side's yes answers out of yes and no, skip left out", () => {
    const g = [graded("1", "published", "yes"), graded("2", "published", "yes"), graded("3", "published", "no"), graded("4", "published", "skip")];
    const m = computeMetrics(g, [], { total: 0, caught: 0, byKind: {} });
    expect(m.published.yes).toBe(2);
    expect(m.published.graded).toBe(3);
  });

  it("tallies the rejected side's sound (yes) answers by the stage that stopped them", () => {
    const g = [
      graded("1", "rejected", "yes", "check"),
      graded("2", "rejected", "yes", "check"),
      graded("3", "rejected", "yes", "falsify"),
      graded("4", "rejected", "no", "check"),
    ];
    const m = computeMetrics(g, [], { total: 0, caught: 0, byKind: {} });
    expect(m.rejectedButSound).toEqual({ count: 3, byStage: { check: 2, falsify: 1 } });
  });

  it("has no agreement with no regrades", () => {
    const m = computeMetrics([], [], { total: 0, caught: 0, byKind: {} });
    expect(m.agreement).toBeNull();
  });

  it("agrees a regraded item's first and second answers, skipping a skip", () => {
    const g = [graded("1", "published", "yes"), graded("2", "published", "no"), graded("3", "published", "yes")];
    const regrades = [
      { id: "1", answer: "yes" },
      { id: "2", answer: "no" },
      { id: "3", answer: "skip" },
    ];
    const m = computeMetrics(g, regrades, { total: 0, caught: 0, byKind: {} });
    expect(m.agreement).toEqual({ kappa: 1, n: 2 });
  });

  it("carries the planted figures through unchanged", () => {
    const planted = { total: 40, caught: 35, byKind: { unit: { total: 10, caught: 9 } } };
    const m = computeMetrics([], [], planted);
    expect(m.planted).toEqual(planted);
  });
});

describe("plantErrors", () => {
  it("runs every mutation against the finding and counts what evaluate still catches", () => {
    const g = [graded("1", "published", "yes")];
    const planted = plantErrors(g, data);
    expect(planted.total).toBeGreaterThan(0);
    expect(planted.caught).toBeLessThanOrEqual(planted.total);
    expect(Object.keys(planted.byKind).length).toBeGreaterThan(0);
  });

  it("only plants errors on hypotheses that were published and graded yes", () => {
    const g = [graded("1", "published", "no"), graded("2", "rejected", "yes")];
    expect(plantErrors(g, data)).toEqual({ total: 0, caught: 0, byKind: {} });
  });

  it("is the same for the same graded set", () => {
    const g = [graded("1", "published", "yes")];
    expect(plantErrors(g, data)).toEqual(plantErrors(g, data));
  });
});
