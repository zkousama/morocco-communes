import { describe, expect, it } from "vitest";
import { appendGrade, appendRegrade, forRun, formatItem, regradeSample, sample, toGraded, ungraded, type Graded, type Sampled } from "../src/grade.ts";
import type { Finding } from "../src/detect.ts";
import type { Hypothesis, RunFile } from "../src/run.ts";

const hyp = (stage: string) => ({ claim: { en: "c", fr: "c" }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" },
  evidence: { kind: "data", check: { check: "change", of: { unit: "self" }, field: "x", op: ">", value: 0 }, numbers: {} },
  linkTest: null, support: 1, stage, reason: null });
const file = {
  runId: "run-a", startedAt: "", datasetVersion: "", models: { propose: "", falsify: "" }, stageVersions: {},
  items: Array.from({ length: 80 }, (_, i) => ({
    finding: { id: `f${i}` }, line: { en: `line ${i}`, fr: "" }, breakdown: null, entropy: 0, skipped: null,
    hypotheses: [hyp("published"), hyp("published"), hyp("check")],
  })),
} as unknown as RunFile;

describe("the grading sample", () => {
  it("takes one hypothesis per finding, so grades are independent", () => {
    const s = sample(file, 50, 1);
    const published = s.filter((x) => x.gate === "published");
    expect(new Set(published.map((x) => x.findingId)).size).toBe(published.length);
  });

  it("balances published and rejected, and is the same for the same seed", () => {
    const s = sample(file, 50, 1);
    expect(s.filter((x) => x.gate === "published")).toHaveLength(50);
    expect(s.filter((x) => x.gate === "rejected")).toHaveLength(50);
    expect(sample(file, 50, 1)).toEqual(s);
  });

  it("draws at most one hypothesis per finding on the rejected side too", () => {
    const s = sample(file, 50, 1);
    const rejected = s.filter((x) => x.gate === "rejected");
    expect(new Set(rejected.map((x) => x.findingId)).size).toBe(rejected.length);
    for (const r of rejected) expect(r.hypothesis.stage).not.toBe("published");
  });

  it("draws the published side from what a page shows, not only the top hypothesis", () => {
    // 5 published per finding, most supported first: a page shows the first 3.
    const ranked = [5, 4, 3, 2, 1].map((support) => ({ ...hyp("published"), claim: { en: `support ${support}`, fr: "" }, support }));
    const many = { ...file, items: file.items.map((item) => ({ ...item, hypotheses: [...ranked, hyp("check")] })) } as unknown as RunFile;
    const drawn = sample(many, 50, 1).filter((x) => x.gate === "published");
    const supports = new Set(drawn.map((x) => x.hypothesis.support));
    expect([...supports].every((support) => support >= 3)).toBe(true);
    expect(supports.size).toBeGreaterThan(1);
    expect(sample(many, 50, 1)).toEqual(sample(many, 50, 1));
  });

  it("carries the run it was drawn from onto every item and every grade", () => {
    const s = sample(file, 5, 1);
    expect(s.every((x) => x.runId === "run-a")).toBe(true);
    expect(toGraded(s[0]!, "yes", "t").runId).toBe("run-a");
  });

  it("falls short of perSide rather than repeating a finding, when there aren't enough", () => {
    const small = { ...file, items: file.items.slice(0, 3) } as unknown as RunFile;
    const s = sample(small, 50, 1);
    expect(s.filter((x) => x.gate === "published")).toHaveLength(3);
    expect(s.filter((x) => x.gate === "rejected")).toHaveLength(3);
  });
});

describe("regradeSample", () => {
  const graded = (i: number, answer: "yes" | "no" | "skip"): Graded => ({
    id: `id${i}`,
    runId: "run-a",
    findingId: `f${i}`,
    gate: i % 2 === 0 ? "published" : "rejected",
    item: { finding: { id: `f${i}` } as unknown as Finding, line: { en: `line ${i}` }, hypothesis: hyp("published") as unknown as Hypothesis },
    answer,
    gradedAt: "",
  });

  it("never draws a skip", () => {
    const pool = Array.from({ length: 10 }, (_, i) => graded(i, i % 3 === 0 ? "skip" : i % 2 === 0 ? "yes" : "no"));
    const drawn = regradeSample(pool, 5, 1);
    expect(drawn).toHaveLength(5);
    expect(drawn.every((g) => g.answer !== "skip")).toBe(true);
  });

  it("draws n and is the same for the same seed", () => {
    const pool = Array.from({ length: 40 }, (_, i) => graded(i, i % 2 === 0 ? "yes" : "no"));
    const a = regradeSample(pool, 25, 1);
    const b = regradeSample(pool, 25, 1);
    expect(a).toHaveLength(25);
    expect(a).toEqual(b);
  });

  it("caps at the eligible pool's size when it's smaller than n", () => {
    const pool = [graded(0, "yes"), graded(1, "no"), graded(2, "skip")];
    expect(regradeSample(pool, 25, 1)).toHaveLength(2);
  });
});

describe("toGraded", () => {
  it("gives a 12-character hex id, and carries the answer and gate over", () => {
    const s = sample(file, 1, 1)[0]!;
    const g = toGraded(s, "yes", "2026-09-25T00:00:00.000Z");
    expect(g.id).toMatch(/^[0-9a-f]{12}$/);
    expect(g.findingId).toBe(s.findingId);
    expect(g.gate).toBe(s.gate);
    expect(g.answer).toBe("yes");
    expect(g.gradedAt).toBe("2026-09-25T00:00:00.000Z");
  });

  it("gives the same id for the same finding and check regardless of the answer", () => {
    const s = sample(file, 1, 1)[0]!;
    expect(toGraded(s, "yes", "t1").id).toBe(toGraded(s, "no", "t2").id);
  });
});

describe("ungraded", () => {
  // Each finding gets its own check (the id depends on the check, not the gate), so 2
  // findings sampled here never collide the way 2 hypotheses sharing one check would.
  const sampledOf = (i: number): Sampled => ({
    runId: "run-a",
    gate: "published",
    findingId: `f${i}`,
    finding: { id: `f${i}` } as unknown as Finding,
    line: { en: `line ${i}` },
    hypothesis: {
      ...hyp("published"),
      evidence: { kind: "data", check: { check: "change", of: { unit: "self" }, field: `x${i}`, op: ">", value: 0 }, numbers: {} },
    } as unknown as Hypothesis,
  });

  it("drops items already graded, and keeps the rest", () => {
    const s = [sampledOf(0), sampledOf(1), sampledOf(2)];
    const already = toGraded(s[0]!, "yes", "t");
    const left = ungraded(s, [already]);
    expect(left).toHaveLength(2);
    expect(left.map((x) => x.findingId)).toEqual(["f1", "f2"]);
  });

  it("keeps everything when nothing's graded yet", () => {
    const s = [sampledOf(0), sampledOf(1)];
    expect(ungraded(s, [])).toHaveLength(2);
  });
});

describe("merging answers", () => {
  it("appends a grade without disturbing the regrades", () => {
    const g = toGraded(sample(file, 1, 1)[0]!, "yes", "t");
    const merged = appendGrade({ grades: [], regrades: [] }, g);
    expect(merged.grades).toEqual([g]);
    expect(merged.regrades).toEqual([]);
  });

  it("appends a regrade without disturbing the grades", () => {
    const g = toGraded(sample(file, 1, 1)[0]!, "yes", "t");
    const start = { grades: [g], regrades: [] };
    const merged = appendRegrade(start, { id: g.id, runId: g.runId, answer: "no" });
    expect(merged.grades).toEqual([g]);
    expect(merged.regrades).toEqual([{ id: g.id, runId: "run-a", answer: "no" }]);
  });
});

describe("grades for one run", () => {
  it("keeps only the grades and regrades made on that run", () => {
    const a = toGraded(sample(file, 1, 1)[0]!, "yes", "t");
    const b = { ...a, runId: "run-b", answer: "no" as const };
    const graded = { grades: [a, b], regrades: [{ id: a.id, runId: "run-a", answer: "yes" as const }, { id: a.id, runId: "run-b", answer: "no" as const }] };
    expect(forRun(graded, "run-b")).toEqual({ grades: [b], regrades: [{ id: a.id, runId: "run-b", answer: "no" }] });
    expect(forRun(graded, "run-c")).toEqual({ grades: [], regrades: [] });
  });
});

describe("formatItem", () => {
  const item = {
    finding: { id: "f1" } as unknown as Finding,
    line: { en: "the finding line" },
    hypothesis: {
      claim: { en: "the claim", fr: "" },
      link: { en: "the link", fr: "" },
      premise: { en: "the premise", fr: "" },
      evidence: { kind: "data", check: { check: "change", of: { unit: "self" }, field: "x", op: ">", value: 0 }, numbers: { change: 3.456 } },
      linkTest: null,
      support: 1,
      stage: "check",
      reason: "the test failed",
    } as unknown as Hypothesis,
  };

  it("shows the finding, claim, premise and its numbers, and the link", () => {
    const text = formatItem(item);
    expect(text).toContain("the finding line");
    expect(text).toContain("the claim");
    expect(text).toContain("the premise");
    expect(text).toContain("change=3.46");
    expect(text).toContain("the link");
  });

  it("never shows the gate, the stage or the reason", () => {
    const text = formatItem(item);
    expect(text).not.toContain("the test failed");
    expect(text).not.toContain("published");
    expect(text).not.toContain("rejected");
  });

  it("leaves out the link test line when there's none", () => {
    expect(formatItem(item)).not.toContain("link test:");
  });

  it("shows the link test's numbers when there is one: effect, p and the 3 placebo effects", () => {
    const withLink = {
      ...item,
      hypothesis: {
        ...item.hypothesis,
        linkTest: {
          link: "together", x: "a", y: "b", year: 2024, level: "commune", direction: "positive",
          verdict: "consistent", p: 0.01234, effect: 0.5678, placeboEffects: [0.12, -0.34, 0.05],
        },
      } as unknown as Hypothesis,
    };
    expect(formatItem(withLink)).toContain("link test: effect 0.57, p 0.0123; unrelated measures: 0.12, -0.34, 0.05");
  });

  it("keeps a small p readable rather than rounding it away to 0", () => {
    const withLink = {
      ...item,
      hypothesis: {
        ...item.hypothesis,
        linkTest: {
          link: "together", x: "a", y: "b", year: 2024, level: "commune", direction: "positive",
          verdict: "consistent", p: 0.0032, effect: -0.281, placeboEffects: [0.02, -0.15, 0.33],
        },
      } as unknown as Hypothesis,
    };
    expect(formatItem(withLink)).toContain("p 0.0032");
  });

  it("says a refused link test couldn't be tested, without the word 'refused'", () => {
    const withLink = {
      ...item,
      hypothesis: {
        ...item.hypothesis,
        linkTest: { link: "together", x: "a", y: "b", year: 2024, level: "commune", direction: "positive", verdict: "refused", p: 1, effect: 0, placeboEffects: [] },
      } as unknown as Hypothesis,
    };
    const text = formatItem(withLink);
    expect(text).toContain("link test: couldn't be tested");
    expect(text).not.toContain("refused");
  });

  it("never shows the verdict word, for a consistent, a not-consistent or a refused link test", () => {
    const base = { link: "together", x: "a", y: "b", year: 2024, level: "commune", direction: "positive" };
    const linkTests = [
      { ...base, verdict: "consistent", p: 0.01, effect: 0.5, placeboEffects: [0.1, 0.2, 0.3] },
      { ...base, verdict: "not consistent", p: 0.2, effect: 0.1, placeboEffects: [0.05, 0.06, 0.07] },
      { ...base, verdict: "refused", p: 1, effect: 0, placeboEffects: [] },
    ];
    for (const linkTest of linkTests) {
      const withLink = { ...item, hypothesis: { ...item.hypothesis, linkTest } as unknown as Hypothesis };
      const text = formatItem(withLink);
      // "not consistent" contains "consistent", so this one check rules out both.
      expect(text).not.toContain("consistent");
      expect(text).not.toContain("refused");
    }
  });
});
