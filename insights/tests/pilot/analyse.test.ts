import { mkdtempSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_USAGE } from "../../src/model.ts";
import {
  agreementOf,
  analyse,
  decide,
  hoursFor,
  raterFrom,
  runAnalysis,
  setupFrom,
  tables,
  unfinishedRating,
  withResults,
  type Interval,
  type Results,
} from "../../src/pilot/analyse.ts";
import { broke, counterIdOf, type Ratings, type RatingItem } from "../../src/pilot/rate.ts";
import {
  A5_MAX_HOURS,
  ACTIVE_ADVERSARIES,
  ADVERSARIES,
  DROPPED_ADVERSARIES,
  FULL_RUN_ADVERSARY_CALLS,
  KAPPA_MARGIN,
  MAX_SAMPLES,
  PILOT_SEED,
  PROPOSERS,
  PUBLISHED_CAP,
  SAMPLES_SHARE,
  SELF_PREFERENCE_GAP,
  SHOWN_BREAKS_SHARE,
} from "../../src/pilot/setups.ts";
import type { StageA, StageACandidate, StageB, StageBVerdict } from "../../src/pilot/stages.ts";
import { formatSetup, parseSetup, SETUP_PATH, type Setup } from "../../src/setup.ts";
import type { Check } from "../../src/vocabulary.ts";
import type { ChecklistAnswer } from "../../src/pilot/checklist.ts";
import { JUDGES, juryAgreement, spotAgreement, type AnswersByJudge, type JuryFile } from "../../src/pilot/jury.ts";
import { spotItems, type SpotCheck } from "../../src/pilot/spot.ts";
import { fakeRatings, fakeStageA, fakeStageB } from "./fixtures.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");

/** The fixtures, analysed once: a run over a full pool takes about a second. */
const FIXTURE = (() => {
  const a = fakeStageA();
  const b = fakeStageB(a);
  const ratings = fakeRatings(a, b);
  return { a, b, ratings, results: analyse(a, b, ratings, NOW) };
})();

/** A fresh copy of the fixtures' measures, for a test to change as it likes. */
const base = (): Omit<Results, "decisions"> => {
  const { decisions: _, ...rest } = structuredClone(FIXTURE.results);
  return rest;
};

/** A point estimate with no spread: the rules read `value` alone. */
const iv = (value: number): Interval => ({ value, low: value, high: value });

/** No run dropped: the design as registered, A5 measured like every other run. */
const AS_REGISTERED: Record<string, string> = {};

// ---------------------------------------------------------------------------------------
// A hand-built stage B and rating over 4 of the fixture's own stage A candidates, small
// enough to work every measure out by hand.
// ---------------------------------------------------------------------------------------

type Kind = "broke" | "survived" | "safety" | "no answer" | "unreadable";

const counterFor = (n: number): Check => ({ check: "compare", left: { of: { unit: "self" }, field: "measure", year: 2024 }, op: "<", right: { value: n } });

function verdict(run: string, candidateId: string, kind: Kind, extra: { counter?: Check; ms?: number; cost?: number } = {}): StageBVerdict {
  const usage = { ...NO_USAGE, input: 100, output: 10, costUsd: extra.cost ?? 0.01 };
  const base = { run, candidateId, model: `model-${run}`, usage, ms: extra.ms ?? 1000, waitedMs: 0 };
  switch (kind) {
    case "broke":
      return { ...base, survived: false, stage: "falsify", category: null, unusable: null, counter: extra.counter ?? counterFor(1), counterOutcome: { status: "passed", numbers: {} }, reason: "r" };
    case "survived":
      return { ...base, survived: true, stage: null, category: null, unusable: null, counter: null, counterOutcome: null, reason: "r" };
    case "safety":
      return { ...base, survived: false, stage: "safety", category: "blame", unusable: null, counter: null, counterOutcome: null, reason: "refused: blame" };
    case "no answer":
      return { ...base, survived: false, stage: "falsify", category: null, unusable: "no answer", counter: null, counterOutcome: null, reason: "x", model: null, ms: 0, usage: NO_USAGE };
    case "unreadable":
      return { ...base, survived: false, stage: "falsify", category: null, unusable: "unreadable", counter: null, counterOutcome: null, reason: "x" };
  }
}

interface Micro {
  a: StageA;
  b: StageB;
  ratings: Ratings;
  c: { c1: StageACandidate; c2: StageACandidate; c3: StageACandidate; c4: StageACandidate };
  shared: Check;
  own: Check;
}

/** Where `c` sits among the candidates that passed their data test, in its finding and proposer, by propose's own order. */
function passingRank(a: StageA, c: StageACandidate): number {
  return a.candidates.filter((x) => x.proposer === c.proposer && x.findingId === c.findingId && x.passed && x.rank < c.rank).length;
}

/**
 * c1 is P1's (Haiku), c2 P4's (Opus), c3 P2's (Sonnet, past the top 3 among the reasons that
 * passed their data test, unless `c3` picks another), c4 P3's (Sonnet). The verdicts, run by
 * run:
 *
 *        c1         c2          c3        c4
 *   A1   broke      survived    survived  survived
 *   A2   broke      survived    broke     survived
 *   A3   broke      broke       broke     survived
 *   A4   survived   broke       survived  survived
 *   A5   survived   no answer   broke     safety
 *
 * c3 matches a private term. The rating: c1's reason yes, c2's no, c4's skip; the
 * disagreements c1 unsound, c2 sound, c3 skipped; 3 drift items.
 */
function micro(c3Test: (a: StageA, c: StageACandidate) => boolean = (a, c) => passingRank(a, c) >= PUBLISHED_CAP): Micro {
  const a = fakeStageA();
  const pick = (proposer: string, test: (c: StageACandidate) => boolean) => a.candidates.find((c) => c.proposer === proposer && c.passed && test(c))!;
  const c1 = pick("P1", (c) => c.rank === 0);
  const c2 = pick("P4", (c) => c.rank === 0);
  const c3 = pick("P2", (c) => c3Test(a, c));
  const c4 = pick("P3", (c) => c.rank === 1);
  const shared = counterFor(11);
  const own = counterFor(12);
  const pool = [c1, c2, c3, c4].map((c) => ({ candidateId: c.candidateId, proposer: c.proposer, findingId: c.findingId }));

  const table: Record<string, Kind[]> = {
    A1: ["broke", "survived", "survived", "survived"],
    A2: ["broke", "survived", "broke", "survived"],
    A3: ["broke", "broke", "broke", "survived"],
    A4: ["survived", "broke", "survived", "survived"],
    A5: ["survived", "no answer", "broke", "safety"],
  };
  const ids = [c1, c2, c3, c4].map((c) => c.candidateId);
  const verdicts: StageBVerdict[] = [];
  for (const run of Object.keys(table)) {
    table[run]!.forEach((kind, i) => {
      const counter = i === 0 && run === "A3" ? own : shared;
      verdicts.push(verdict(run, ids[i]!, kind, { counter, ms: run === "A5" ? 3000 : 1000, cost: run === "A5" ? 0 : 0.02 }));
    });
  }
  const b: StageB = { pool, verdicts, termMatches: pool.map((p) => ({ candidateId: p.candidateId, termMatch: p.candidateId === c3.candidateId })), dropped: {} };

  const sharedId = counterIdOf(c1.candidateId, shared);
  const ownId = counterIdOf(c1.candidateId, own);
  const items: RatingItem[] = [
    { kind: "reason", itemId: `reason:${c1.candidateId}`, candidateId: c1.candidateId },
    { kind: "reason", itemId: `reason:${c2.candidateId}`, candidateId: c2.candidateId },
    { kind: "reason", itemId: `reason:${c4.candidateId}`, candidateId: c4.candidateId },
    { kind: "disagreement", itemId: `disagreement:${c1.candidateId}`, candidateId: c1.candidateId, counterIds: [sharedId, ownId].sort() },
    { kind: "disagreement", itemId: `disagreement:${c2.candidateId}`, candidateId: c2.candidateId, counterIds: [counterIdOf(c2.candidateId, shared)] },
    { kind: "disagreement", itemId: `disagreement:${c3.candidateId}`, candidateId: c3.candidateId, counterIds: [counterIdOf(c3.candidateId, shared)] },
    { kind: "drift", itemId: `drift:reason:${c1.candidateId}`, of: `reason:${c1.candidateId}` },
    { kind: "drift", itemId: `drift:disagreement:${c1.candidateId}`, of: `disagreement:${c1.candidateId}` },
    { kind: "drift", itemId: `drift:disagreement:${c3.candidateId}`, of: `disagreement:${c3.candidateId}` },
  ];
  const at = NOW.toISOString();
  const answers: Ratings["answers"] = [
    { itemId: `reason:${c1.candidateId}`, answer: "yes", at },
    { itemId: `reason:${c2.candidateId}`, answer: "no", at },
    { itemId: `reason:${c4.candidateId}`, answer: "skip", at },
    { itemId: `disagreement:${c1.candidateId}`, answer: "no", counters: { [sharedId]: "yes", [ownId]: "no" }, at },
    { itemId: `disagreement:${c2.candidateId}`, answer: "yes", counters: { [counterIdOf(c2.candidateId, shared)]: "skip" }, at },
    { itemId: `disagreement:${c3.candidateId}`, answer: "skip", counters: { [counterIdOf(c3.candidateId, shared)]: "yes" }, at },
    { itemId: `drift:reason:${c1.candidateId}`, answer: "yes", at },
    { itemId: `drift:disagreement:${c1.candidateId}`, answer: "yes", at },
    { itemId: `drift:disagreement:${c3.candidateId}`, answer: "yes", at },
  ];
  return { a, b, ratings: { items, answers }, c: { c1, c2, c3, c4 }, shared, own };
}

describe("agreementOf", () => {
  it("reads 2 runs that agree on everything as full agreement, not none", () => {
    expect(agreementOf(["yes", "yes", "yes"], ["yes", "yes", "yes"])).toBe(1);
    expect(agreementOf(["yes", "no", "yes"], ["yes", "no", "yes"])).toBe(1);
    expect(agreementOf(["yes", "no", "yes", "no"], ["no", "yes", "no", "yes"])).toBeLessThan(0);
  });
  it("is Cohen's kappa once the 2 runs differ anywhere", () => {
    // observed 3/4; expected 0.25 x 0.5 + 0.75 x 0.5 = 0.5
    expect(agreementOf(["s", "v", "v", "v"], ["s", "v", "s", "v"])).toBeCloseTo(0.5, 10);
  });
  it("has nothing to measure without a candidate both runs judged", () => {
    expect(Number.isNaN(agreementOf([], []))).toBe(true);
  });
  it("refuses 2 lists of different lengths", () => {
    expect(() => agreementOf(["a"], ["a", "b"])).toThrow();
  });
});

describe("the measures as registered, A5 measured, worked by hand", () => {
  const m = micro();
  const r = analyse(m.a, m.b, m.ratings, NOW, AS_REGISTERED);

  it("reads kappa only over candidates both runs gave a usable answer on, a safety stop counting as stopped", () => {
    // A1 vs A2, all 4 usable: stopped/stopped, survived x2, survived vs stopped: 0.5
    expect(r.agreement["A1|A2"]!.value).toBeCloseTo(0.5, 10);
    expect(r.noiseFloor).toEqual(r.agreement["A1|A2"]);
    // A1 vs A5: c2 left out (no answer); A1 stopped/survived/survived, A5 survived/stopped/stopped
    expect(r.agreement["A1|A5"]!.value).toBeCloseTo(-0.8, 10);
    expect(Object.keys(r.agreement)).toHaveLength((ADVERSARIES.length * (ADVERSARIES.length - 1)) / 2);
  });

  it("counts a break rate over the answers that argued, never an unusable one or a safety stop", () => {
    expect(r.adversaries.A5!.breakRate!.value).toBe(0.5); // c1 survived, c3 broke; c2 no answer, c4 safety
    expect(r.adversaries.A5!.unusable).toBe(1);
    expect(r.adversaries.A5!.refused).toBe(1);
    expect(r.adversaries.A3!.breakRate!.value).toBe(0.75);
  });

  it("scores a run right when it broke an unsound reason or passed a sound one, skips and unusable answers left out", () => {
    expect(r.adversaries.A1!.rightOnDisagreements!.value).toBe(1); // c1 broke & unsound, c2 passed & sound
    expect(r.adversaries.A1!.disagreementsRated).toBe(2);
    expect(r.adversaries.A3!.rightOnDisagreements!.value).toBe(0.5); // c2 broke but sound
    expect(r.adversaries.A5!.rightOnDisagreements!.value).toBe(0); // c1 passed but unsound; c2 no answer
    expect(r.adversaries.A5!.disagreementsRated).toBe(1);
  });

  it("keeps the 2 rating parts apart: c1's reason reads yes, its disagreement unsound", () => {
    expect(r.proposers.P1!.yesRate!.value).toBe(1);
    expect(r.proposers.P1!.rated).toBe(1);
    expect(r.proposers.P4!.yesRate!.value).toBe(0);
    expect(r.proposers.P3!.yesRate).toBeNull(); // its only reason was skipped
    expect(r.proposers.P3!.rated).toBe(0);
    expect(r.proposers.P2!.yesRate).toBeNull();
  });

  it("finds A3's extra breaks, the candidates A3 broke and A1 passed, and how many the owner judged right", () => {
    expect(r.extraBreaks).toEqual({ inPool: 2, rated: 1, right: 0 }); // c2 (judged sound), c3 (skipped)
  });

  it("attributes each judged counter-test to every run that offered it", () => {
    // c1's shared counter (A1, A2) judged to break it, A3's own one not
    expect(r.adversaries.A1!.countersHeld!.value).toBe(1);
    // A3: its own counter on c1 judged not to break it, the shared one on c2 skipped, on c3
    // judged to break it (a skip on the reason itself leaves its counter-tests' answers alone)
    expect(r.adversaries.A3!.countersHeld!.value).toBe(0.5);
    expect(r.adversaries.A3!.countersRated).toBe(2);
    expect(r.adversaries.A4!.countersHeld).toBeNull(); // its c2 counter was skipped
  });

  it("counts the breaks landing on the top 3 reasons by support, across every run", () => {
    // c1: A1, A2, A3; c2: A3, A4; c3 (past the top 3 that passed their data test): A2, A3, A5
    expect(passingRank(m.a, m.c.c3)).toBeGreaterThanOrEqual(PUBLISHED_CAP);
    expect(r.shownBreaks.breaks).toBe(8);
    expect(r.shownBreaks.shown).toBe(5);
    expect(r.shownBreaks.share!.value).toBe(5 / 8);
  });

  it("ranks a reason among the ones that passed their data test, the way a page would show them", () => {
    // Ranked past the top 3 in propose's order, but a reason above it failed its data test.
    const n = micro((a, c) => c.rank >= PUBLISHED_CAP && passingRank(a, c) < PUBLISHED_CAP);
    expect(n.c.c3.rank).toBeGreaterThanOrEqual(PUBLISHED_CAP);
    const shown = analyse(n.a, n.b, n.ratings, NOW, AS_REGISTERED).shownBreaks;
    expect(shown).toMatchObject({ breaks: 8, shown: 8 });
  });

  it("measures each run's break rate on its own family's reasons against everyone else's", () => {
    // A1 (Opus): own c2 survived 0/1; others c1 broke, c3 and c4 survived: 1/3
    expect(r.adversaries.A1!.family!.own).toBe(0);
    expect(r.adversaries.A1!.family!.others).toBeCloseTo(1 / 3, 10);
    expect(r.adversaries.A1!.family!.gap.value).toBeCloseTo(1 / 3, 10);
    // A4 (Sonnet): own c3, c4 survived 0/2; others c1 survived, c2 broke: 1/2
    expect(r.adversaries.A4!.family!.gap.value).toBe(0.5);
    expect(r.adversaries.A5!.family).toBeNull(); // no Gemini proposer
  });

  it("crosses each run's policy stops with the private terms, both ways, as counts and ids only", () => {
    expect(r.safety.termsMatched).toBe(1);
    expect(r.safety.byRun.A5).toEqual({ refused: 1, categories: { blame: 1 }, refusedWithoutTerm: 1, termButPassed: 1 });
    expect(r.safety.byRun.A1).toEqual({ refused: 0, categories: {}, refusedWithoutTerm: 0, termButPassed: 1 });
    expect(r.safety.policyMisses).toEqual([{ candidateId: m.c.c3.candidateId, category: "terms", runs: ["A1", "A2", "A3", "A4", "A5"] }]);
  });

  it("pairs each drift item with its original, skips left out", () => {
    // yes/yes and no/yes; c3's skip left out
    expect(r.drift).toEqual({ kappa: 0, n: 2 });
  });

  it("builds each proposer's samples curve from its reasons rated good", () => {
    const first = Math.min(...m.c.c1.sampleIndexes);
    expect(r.samplesCurve.P1!.map((x) => x.value)).toEqual(Array.from({ length: MAX_SAMPLES }, (_, i) => (first < i + 1 ? 1 : 0)));
    expect(r.goodReasons.P1).toBe(1);
    expect(r.samplesCurve.P4).toEqual([]); // nothing rated good
  });

  it("prices each run from its own recorded usage, and times it per answered call", () => {
    expect(r.adversaries.A1!.costUsd).toBeCloseTo(0.08, 10);
    expect(r.adversaries.A5!.costUsd).toBe(0);
    expect(r.adversaries.A5!.calls).toBe(3); // the no-answer call never came back
    expect(r.adversaries.A5!.secondsPerCall).toBe(3);
    expect(r.adversaries.A1!.tokens.input).toBe(400);
  });

  it("times A5's speed check per answered call with its waits counted in, and totals what it waited", () => {
    const waited = micro();
    for (const v of waited.b.verdicts) if (v.run === "A5" && v.model !== null) v.waitedMs = 70_000;
    const w = analyse(waited.a, waited.b, waited.ratings, NOW, AS_REGISTERED);
    expect(w.adversaries.A5!.secondsPerCall).toBe(3); // the answering time alone, as before
    expect(w.adversaries.A5!.secondsPerCallWithWaits).toBe(73);
    expect(w.adversaries.A5!.waitedSeconds).toBe(210);
    expect(w.speedCheck).toMatchObject({ run: "A5", secondsPerCall: 73, waitedSeconds: 210, maxHours: A5_MAX_HOURS, fits: false });
    expect(w.speedCheck.ran && w.speedCheck.hours).toBeCloseTo((73 * FULL_RUN_ADVERSARY_CALLS) / 3600, 10);
    expect(r.speedCheck).toMatchObject({ secondsPerCall: 3, waitedSeconds: 0, fits: true });
  });

  it("says how many candidates each proposer put in the pool", () => {
    expect(r.poolByProposer).toEqual({ P1: 1, P2: 1, P3: 1, P4: 1 });
  });

  it("records no run as dropped, and runs A5's speed check", () => {
    expect(r.dropped).toEqual({});
    expect(r.speedCheck).toMatchObject({ run: "A5", ran: true });
  });
});

describe("the measures with A5 dropped, worked by hand", () => {
  // The same stage B, A5's verdicts still in it: dropped, they're read nowhere.
  const m = micro();
  const r = analyse(m.a, m.b, m.ratings, NOW);
  const registered = analyse(m.a, m.b, m.ratings, NOW, AS_REGISTERED);

  it("records A5 as dropped, with its reason, in the results", () => {
    expect(r.dropped).toEqual(DROPPED_ADVERSARIES);
    expect(Object.keys(r.dropped)).toEqual(["A5"]);
  });

  it("measures A1 to A4 exactly as before, and has no measure for A5 at all", () => {
    expect(Object.keys(r.adversaries)).toEqual(ACTIVE_ADVERSARIES.map((x) => x.id));
    for (const x of ACTIVE_ADVERSARIES) expect(r.adversaries[x.id]).toEqual(registered.adversaries[x.id]);
    expect(r.adversaries.A5).toBeUndefined();
  });

  it("pairs A1 to A4 only for agreement, the noise floor unchanged", () => {
    expect(Object.keys(r.agreement)).toHaveLength((ACTIVE_ADVERSARIES.length * (ACTIVE_ADVERSARIES.length - 1)) / 2);
    expect(Object.keys(r.agreement).some((key) => key.includes("A5"))).toBe(false);
    expect(r.noiseFloor).toEqual(registered.noiseFloor);
  });

  it("counts the breaks on shown reasons across A1 to A4 only, leaving out A5's break on c3", () => {
    // c1: A1, A2, A3; c2: A3, A4; c3 (past the top 3): A2, A3
    expect(r.shownBreaks.breaks).toBe(7);
    expect(r.shownBreaks.shown).toBe(5);
    expect(r.shownBreaks.share!.value).toBe(5 / 7);
  });

  it("crosses A1 to A4's policy stops with the private terms, and never A5's", () => {
    expect(Object.keys(r.safety.byRun)).toEqual(ACTIVE_ADVERSARIES.map((x) => x.id));
    expect(r.safety.policyMisses).toEqual([{ candidateId: m.c.c3.candidateId, category: "terms", runs: ["A1", "A2", "A3", "A4"] }]);
  });

  it("reports A5's speed check as not run, with the reason", () => {
    expect(r.speedCheck).toEqual({ run: "A5", ran: false, reason: DROPPED_ADVERSARIES.A5 });
  });
});

describe("the measures on the fixtures", () => {
  const { a, b, ratings, results: r } = FIXTURE;

  it("covers every proposer and active adversary, stamped with the seed and the time", () => {
    expect(Object.keys(r.proposers)).toEqual(PROPOSERS.map((p) => p.id));
    expect(Object.keys(r.adversaries)).toEqual(ACTIVE_ADVERSARIES.map((x) => x.id));
    expect(r.dropped).toEqual(DROPPED_ADVERSARIES);
    expect(r.seed).toBe(PILOT_SEED);
    expect(r.measuredAt).toBe(NOW.toISOString());
  });

  it("reads each proposer's tests, links, usage and timing off stage A", () => {
    for (const p of a.proposers) {
      const mine = a.candidates.filter((c) => c.proposer === p.id);
      const out = r.proposers[p.id]!;
      expect(out.candidates).toBe(mine.length);
      expect(out.passed!.value).toBeCloseTo(mine.filter((c) => c.passed).length / mine.length, 10);
      expect(out.missing).toBe(mine.filter((c) => c.outcome.status === "failed" && c.outcome.reason === "missing").length);
      expect(out.refused.tautology ?? 0).toBe(mine.filter((c) => c.outcome.status === "refused" && c.outcome.reason === "tautology").length);
      expect(out.linksProposed).toBe(mine.filter((c) => c.candidate.linkTest !== null).length);
      expect(out.linksConsistent).toBe(mine.filter((c) => c.link?.verdict === "consistent").length);
      expect(out.distinctPerFinding.value).toBeCloseTo(mine.length / a.findingIds.length, 10);
      expect(out.safetyDrops).toEqual(p.safetyDrops);
      expect(out.costUsd).toBe(p.usage.costUsd);
      expect(out.tokens).toEqual(p.usage);
      expect(out.secondsPerCall).toBeCloseTo(p.ms / p.replies.length / 1000, 10);
      expect(out.costPerCall).toBeCloseTo(p.usage.costUsd / p.replies.length, 10);
      const samples = a.findingIds.length * MAX_SAMPLES;
      const unusable = Object.values(p.unusable).reduce((s, n) => s + n, 0);
      expect(out.usable.value).toBeCloseTo((samples - unusable) / samples, 10);
      const entropies = a.findingIds.map((f) => p.entropy[f]!);
      expect(out.entropy.value).toBeCloseTo(entropies.reduce((s, x) => s + x, 0) / entropies.length, 10);
    }
  });

  it("gives every interval a low at or under its value and a high at or over it", () => {
    const intervals: Interval[] = [];
    for (const p of Object.values(r.proposers)) {
      intervals.push(p.usable, p.distinctPerFinding, p.entropy);
      if (p.passed) intervals.push(p.passed);
      if (p.yesRate) intervals.push(p.yesRate);
    }
    for (const x of Object.values(r.adversaries)) {
      if (x.breakRate) intervals.push(x.breakRate);
      if (x.rightOnDisagreements) intervals.push(x.rightOnDisagreements);
    }
    for (const k of Object.values(r.agreement)) if (k) intervals.push(k);
    for (const curve of Object.values(r.samplesCurve)) intervals.push(...curve);
    expect(intervals.length).toBeGreaterThan(20);
    for (const x of intervals) {
      expect(x.low).toBeLessThanOrEqual(x.value + 1e-9);
      expect(x.high).toBeGreaterThanOrEqual(x.value - 1e-9);
    }
  });

  it("is the same every time for the same inputs", () => {
    expect(analyse(a, b, ratings, NOW)).toEqual(r);
  });

  it("takes yes rates from the reasons part only, and rightness from the disagreements part only", () => {
    const answerOf = new Map(ratings.answers.map((x) => [x.itemId, x.answer]));
    const byId = new Map(a.candidates.map((c) => [c.candidateId, c]));
    for (const p of PROPOSERS) {
      const mine = ratings.items.filter((i) => i.kind === "reason" && byId.get(i.candidateId)!.proposer === p.id);
      const answered = mine.map((i) => answerOf.get(i.itemId)).filter((x) => x !== "skip");
      expect(r.proposers[p.id]!.rated).toBe(answered.length);
      expect(r.proposers[p.id]!.yesRate!.value).toBeCloseTo(answered.filter((x) => x === "yes").length / answered.length, 10);
    }
    const disagreements = ratings.items.filter((i) => i.kind === "disagreement" && answerOf.get(i.itemId) !== "skip");
    for (const x of ACTIVE_ADVERSARIES) {
      let right = 0;
      let n = 0;
      for (const item of disagreements) {
        const v = b.verdicts.find((y) => y.run === x.id && y.candidateId === (item as { candidateId: string }).candidateId)!;
        if (v.unusable !== null || v.stage === "safety") continue;
        n++;
        if (broke(v) === (answerOf.get(item.itemId) === "no")) right++;
      }
      expect(r.adversaries[x.id]!.disagreementsRated).toBe(n);
      expect(r.adversaries[x.id]!.rightOnDisagreements!.value).toBeCloseTo(right / n, 10);
    }
  });

  it("puts breaks on both sides of the top 3 a page would show, so rule 6 has both to count", () => {
    expect(r.shownBreaks.shown).toBeGreaterThan(0);
    expect(r.shownBreaks.shown).toBeLessThan(r.shownBreaks.breaks);
  });

  it("reads the noise floor as A1 against A2", () => {
    expect(r.noiseFloor).toEqual(r.agreement["A1|A2"]);
  });

  it("has a samples curve that reaches every good reason by the last sample", () => {
    for (const p of PROPOSERS) {
      const curve = r.samplesCurve[p.id]!;
      expect(curve).toHaveLength(MAX_SAMPLES);
      expect(curve[MAX_SAMPLES - 1]!.value).toBe(1);
      for (let n = 1; n < MAX_SAMPLES; n++) expect(curve[n]!.value).toBeGreaterThanOrEqual(curve[n - 1]!.value);
    }
  });

  it("finds the drift pairs: every one bar the flipped first", () => {
    expect(r.drift.n).toBeGreaterThan(0);
    expect(r.drift.kappa).not.toBeNull();
    expect(r.drift.kappa!).toBeLessThan(1);
  });
});

describe("what it refuses to analyse", () => {
  const a = fakeStageA();
  const b = fakeStageB(a);

  it("an unfinished rating", () => {
    const ratings = fakeRatings(a, b);
    const short = { ...ratings, answers: ratings.answers.slice(0, -3) };
    expect(unfinishedRating(short)).toContain("3 of");
    expect(() => analyse(a, b, short, NOW)).toThrow(/isn't finished/);
  });
  it("a rating that hasn't started", () => {
    expect(unfinishedRating({ items: [], answers: [] })).toMatch(/hasn't started/);
  });
  it("counts a skip as answered", () => {
    const ratings = fakeRatings(a, b);
    const skipped = { ...ratings, answers: ratings.answers.map((x) => ({ ...x, answer: "skip" as const })) };
    expect(unfinishedRating(skipped)).toBeNull();
  });
  it("a stage B that's missing a run's verdict on a pool candidate", () => {
    const partial = { ...b, verdicts: b.verdicts.slice(1) };
    expect(() => analyse(a, partial, fakeRatings(a, b), NOW)).toThrow(/verdict/);
  });
  it("a stage B with 2 verdicts from one run on the same candidate", () => {
    const doubled = { ...b, verdicts: [...b.verdicts, b.verdicts[0]!] };
    expect(() => analyse(a, doubled, fakeRatings(a, b), NOW)).toThrow(/2 A1 verdicts/);
  });
  it("a rating item naming a candidate stage A doesn't have", () => {
    const ratings = fakeRatings(a, b);
    const item: RatingItem = { kind: "reason", itemId: "reason:nope", candidateId: "nope" };
    const bad = { items: [...ratings.items, item], answers: [...ratings.answers, { itemId: "reason:nope", answer: "yes" as const, at: "" }] };
    expect(() => analyse(a, b, bad, NOW)).toThrow(/nope/);
  });
});

describe("rule 1, the proposer", () => {
  it("picks the cheapest proposer within 10 points of the best", () => {
    const r = base();
    r.proposers.P3!.yesRate = iv(0.8); r.proposers.P3!.costUsd = 10;
    r.proposers.P2!.yesRate = iv(0.72); r.proposers.P2!.costUsd = 4;
    r.proposers.P4!.yesRate = iv(0.6); r.proposers.P4!.costUsd = 1;
    r.proposers.P1!.yesRate = iv(0.4); r.proposers.P1!.costUsd = 0.5;
    expect(decide(r).proposer.choice).toBe("P2");
  });
  it("counts exactly 10 points as within", () => {
    const r = base();
    r.proposers.P3!.yesRate = iv(0.8); r.proposers.P3!.costUsd = 10;
    r.proposers.P2!.yesRate = iv(0.7); r.proposers.P2!.costUsd = 4;
    r.proposers.P4!.yesRate = iv(0.69); r.proposers.P4!.costUsd = 1;
    r.proposers.P1!.yesRate = iv(0.1); r.proposers.P1!.costUsd = 0.5;
    expect(decide(r).proposer.choice).toBe("P2");
  });
  it("keeps the best when nothing cheaper sits close enough", () => {
    const r = base();
    r.proposers.P3!.yesRate = iv(0.9); r.proposers.P3!.costUsd = 10;
    for (const id of ["P1", "P2", "P4"]) { r.proposers[id]!.yesRate = iv(0.5); r.proposers[id]!.costUsd = 1; }
    expect(decide(r).proposer.choice).toBe("P3");
  });
  it("breaks a tie on cost by the higher yes rate", () => {
    const r = base();
    r.proposers.P3!.yesRate = iv(0.8); r.proposers.P3!.costUsd = 2;
    r.proposers.P2!.yesRate = iv(0.75); r.proposers.P2!.costUsd = 2;
    r.proposers.P4!.yesRate = iv(0.1); r.proposers.P4!.costUsd = 1;
    r.proposers.P1!.yesRate = iv(0.1); r.proposers.P1!.costUsd = 0.5;
    expect(decide(r).proposer.choice).toBe("P3");
  });
  it("leaves out a proposer with no rated reason, and says so", () => {
    const r = base();
    r.proposers.P1!.yesRate = null; r.proposers.P1!.rated = 0; r.proposers.P1!.costUsd = 0;
    r.proposers.P3!.yesRate = iv(0.8); r.proposers.P3!.costUsd = 10;
    r.proposers.P2!.yesRate = iv(0.5); r.proposers.P4!.yesRate = iv(0.5);
    const d = decide(r).proposer;
    expect(d.choice).toBe("P3");
    expect(d.because).toContain("P1");
  });
  it("can't choose when no proposer has a rated reason", () => {
    const r = base();
    for (const p of Object.values(r.proposers)) { p.yesRate = null; p.rated = 0; }
    expect(() => decide(r)).toThrow(/rule 1/);
  });
  it("states each proposer's cost per answered call beside its total, still choosing on the total", () => {
    const r = base();
    r.proposers.P3!.yesRate = iv(0.8); r.proposers.P3!.costUsd = 10; r.proposers.P3!.costPerCall = 0.05;
    r.proposers.P2!.yesRate = iv(0.75); r.proposers.P2!.costUsd = 4; r.proposers.P2!.costPerCall = 0.5;
    r.proposers.P4!.yesRate = iv(0.1); r.proposers.P1!.yesRate = iv(0.1);
    const d = decide(r).proposer;
    expect(d.choice).toBe("P2"); // cheaper in total, though dearer a call
    expect(d.because).toContain("P2 at $4.00 ($0.500 a call)");
    expect(d.because).toContain("P3 at $10.00 ($0.050 a call)");
  });
});

describe("rule 2, the adversary's effort", () => {
  it("keeps medium when high agrees with medium as well as medium agrees with itself", () => {
    const r = base();
    r.noiseFloor = iv(0.8); r.agreement["A1|A3"] = iv(0.77);
    expect(decide(r).adversaryEffort.choice).toBe("medium");
  });
  it("counts exactly 0.05 either side of the noise floor as close enough", () => {
    for (const k of [0.8 - KAPPA_MARGIN, 0.8 + KAPPA_MARGIN]) {
      const r = base();
      r.noiseFloor = iv(0.8); r.agreement["A1|A3"] = iv(k);
      r.extraBreaks = { inPool: 3, rated: 3, right: 3 };
      expect(decide(r).adversaryEffort.choice).toBe("medium");
    }
  });
  it("picks high when it strays from the floor and its extra breaks were right at least 2 times in 3", () => {
    const r = base();
    r.noiseFloor = iv(0.8); r.agreement["A1|A3"] = iv(0.6);
    r.extraBreaks = { inPool: 4, rated: 3, right: 2 };
    expect(decide(r).adversaryEffort.choice).toBe("high");
  });
  it("keeps medium when it strays but its extra breaks weren't right often enough", () => {
    const r = base();
    r.noiseFloor = iv(0.8); r.agreement["A1|A3"] = iv(0.95);
    r.extraBreaks = { inPool: 4, rated: 4, right: 2 };
    expect(decide(r).adversaryEffort.choice).toBe("medium");
  });
  it("keeps medium when none of its extra breaks got rated", () => {
    const r = base();
    r.noiseFloor = iv(0.8); r.agreement["A1|A3"] = iv(0.5);
    r.extraBreaks = { inPool: 2, rated: 0, right: 0 };
    const d = decide(r).adversaryEffort;
    expect(d.choice).toBe("medium");
    expect(d.because.length).toBeGreaterThan(0);
  });
  it("keeps medium when every run agrees perfectly", () => {
    const r = base();
    for (const key of Object.keys(r.agreement)) r.agreement[key] = iv(1);
    r.noiseFloor = iv(1);
    expect(decide(r).adversaryEffort.choice).toBe("medium");
  });
  it("stays at medium when there's no kappa to compare, whatever the extra breaks say", () => {
    for (const [kappa, floor] of [[null, iv(0.8)], [iv(0.3), null], [null, null]] as const) {
      const r = base();
      r.noiseFloor = floor; r.agreement["A1|A3"] = kappa;
      r.extraBreaks = { inPool: 3, rated: 3, right: 3 };
      const d = decide(r).adversaryEffort;
      expect(d.choice).toBe("medium");
      expect(d.because).toMatch(/can't be measured/);
    }
  });
});

/**
 * Every rule-3 input set explicitly: the floor, each kappa with A1, each rightness and A5's
 * speed. A5 is measured beside the others, the rule as registered, unless `a5` is
 * "dropped": then it stays out of the results, as the fixtures' own analysis leaves it.
 */
function rule3(opts: {
  proposer?: string;
  effort?: "medium" | "high";
  k4?: number | null;
  k5?: number | null;
  right1?: number | null;
  right3?: number | null;
  right4?: number | null;
  right5?: number | null;
  a5Seconds?: number | null;
  a5?: "measured" | "dropped";
}): Omit<Results, "decisions"> {
  const r = base();
  for (const p of Object.values(r.proposers)) { p.yesRate = iv(0.1); p.costUsd = 100; }
  const proposer = opts.proposer ?? "P1";
  r.proposers[proposer]!.yesRate = iv(0.9);
  r.proposers[proposer]!.costUsd = 1;
  r.noiseFloor = iv(0.8);
  r.agreement["A1|A2"] = iv(0.8);
  if (opts.effort === "high") {
    r.agreement["A1|A3"] = iv(0.3);
    r.extraBreaks = { inPool: 3, rated: 3, right: 3 };
  } else {
    r.agreement["A1|A3"] = iv(0.8);
  }
  r.agreement["A1|A4"] = opts.k4 === undefined ? iv(0.8) : opts.k4 === null ? null : iv(opts.k4);
  const right = (x: number | null | undefined, fallback: number) => (x === undefined ? iv(fallback) : x === null ? null : iv(x));
  r.adversaries.A1!.rightOnDisagreements = right(opts.right1, 0.6);
  r.adversaries.A3!.rightOnDisagreements = right(opts.right3, 0.6);
  r.adversaries.A4!.rightOnDisagreements = right(opts.right4, 0.6);
  if (opts.a5 === "dropped") return r;
  r.dropped = {};
  r.adversaries.A5 = {
    ...structuredClone(r.adversaries.A4!),
    family: null,
    costUsd: 0,
    rightOnDisagreements: right(opts.right5, 0.6),
    secondsPerCallWithWaits: opts.a5Seconds === undefined ? 10 : opts.a5Seconds,
  };
  r.safety.byRun.A5 = structuredClone(r.safety.byRun.A4!);
  r.agreement["A1|A5"] = opts.k5 === undefined ? iv(0.8) : opts.k5 === null ? null : iv(opts.k5);
  return r;
}

describe("rule 3, the adversary's model, as registered with A5 measured", () => {
  const fast = 10; // 10 s x 2,400 calls = 6.7 hours
  const slow = ((A5_MAX_HOURS + 1) * 3600) / FULL_RUN_ADVERSARY_CALLS;

  it("reads A5's hours for the full run one call at a time", () => {
    expect(hoursFor(fast)).toBeCloseTo((fast * FULL_RUN_ADVERSARY_CALLS) / 3600, 10);
    expect(hoursFor(slow)).toBeGreaterThan(A5_MAX_HOURS);
  });
  it("counts exactly 48 hours as fitting, and anything over as too slow", () => {
    const exactly = (A5_MAX_HOURS * 3600) / FULL_RUN_ADVERSARY_CALLS; // 72 s a call
    expect(hoursFor(exactly)).toBe(A5_MAX_HOURS);
    expect(decide(rule3({ k4: 0.5, a5Seconds: exactly })).adversaryModel.choice).toBe("A5");
    expect(decide(rule3({ k4: 0.5, a5Seconds: exactly + 0.001 })).adversaryModel.choice).toBe("A1");
  });

  it("keeps A1 when neither A4 nor A5 qualifies on kappa", () => {
    const d = decide(rule3({ k4: 0.5, k5: 0.5, right4: 0.9, right5: 0.9 })).adversaryModel;
    expect(d.choice).toBe("A1");
    expect(d.metBar).toBe(true);
  });
  it("keeps A3 instead when rule 2 chose high effort", () => {
    expect(decide(rule3({ effort: "high", k4: 0.5, k5: 0.5 })).adversaryModel.choice).toBe("A3");
  });
  it("measures rightness against the Opus run rule 2 chose: A3 for high effort", () => {
    // A4 beats A1 but not A3
    const d = decide(rule3({ effort: "high", k5: 0.5, right1: 0.5, right3: 0.8, right4: 0.7 })).adversaryModel;
    expect(d.choice).toBe("A3");
    const e = decide(rule3({ effort: "high", k5: 0.5, right1: 0.9, right3: 0.6, right4: 0.7 })).adversaryModel;
    expect(e.choice).toBe("A4");
  });
  it("lets A4 alone take the job when it qualifies", () => {
    expect(decide(rule3({ k5: 0.5 })).adversaryModel.choice).toBe("A4");
  });
  it("counts exactly 0.05 from the floor, either side, as qualifying", () => {
    expect(decide(rule3({ k4: 0.8 - KAPPA_MARGIN, k5: 0.5 })).adversaryModel.choice).toBe("A4");
    expect(decide(rule3({ k4: 0.8 + KAPPA_MARGIN, k5: 0.5 })).adversaryModel.choice).toBe("A4");
    expect(decide(rule3({ k4: 0.8 + KAPPA_MARGIN + 0.001, k5: 0.5 })).adversaryModel.choice).toBe("A1");
  });
  it("needs a qualifier at least as right as the Opus run: equal is enough, less isn't", () => {
    expect(decide(rule3({ k5: 0.5, right1: 0.6, right4: 0.6 })).adversaryModel.choice).toBe("A4");
    expect(decide(rule3({ k5: 0.5, right1: 0.6, right4: 0.59 })).adversaryModel.choice).toBe("A1");
  });
  it("can't qualify a run without a rightness to compare", () => {
    expect(decide(rule3({ k5: 0.5, right4: null })).adversaryModel.choice).toBe("A1");
    expect(decide(rule3({ k5: 0.5, right1: null })).adversaryModel.choice).toBe("A1");
    expect(decide(rule3({ k5: 0.5, k4: null })).adversaryModel.choice).toBe("A1");
  });
  it("copes with no disagreements at all", () => {
    const r = base();
    for (const id of Object.keys(r.adversaries)) r.adversaries[id]!.rightOnDisagreements = null;
    expect(() => decide(r)).not.toThrow();
    const none = { right1: null, right3: null, right4: null, right5: null };
    expect(decide(rule3(none)).adversaryModel.choice).toBe("A1");
    const opus = decide(rule3({ ...none, proposer: "P4" })).adversaryModel;
    expect(opus.choice).toBe("A5");
    expect(opus.metBar).toBe(false);
  });
  it("lets A5 alone take the job when it qualifies and fits in 48 hours", () => {
    expect(decide(rule3({ k4: 0.5, a5Seconds: fast })).adversaryModel.choice).toBe("A5");
  });
  it("counts A5 too slow as not qualifying, so A1 keeps the job", () => {
    const d = decide(rule3({ k4: 0.5, a5Seconds: slow })).adversaryModel;
    expect(d.choice).toBe("A1");
    expect(d.because).toContain("48");
  });
  it("counts an A5 with no answered call as too slow", () => {
    expect(decide(rule3({ k4: 0.5, a5Seconds: null })).adversaryModel.choice).toBe("A1");
  });
  it("counts A5's waits in: an A5 whose answering time alone fits but whose waits push it over fails the check", () => {
    const waited = micro();
    for (const v of waited.b.verdicts) if (v.run === "A5" && v.model !== null) v.waitedMs = 70_000;
    const measured = analyse(waited.a, waited.b, waited.ratings, NOW, AS_REGISTERED).adversaries.A5!;
    expect(hoursFor(measured.secondsPerCall!)).toBeLessThanOrEqual(A5_MAX_HOURS);
    const r = rule3({ k4: 0.5 });
    r.adversaries.A5 = { ...r.adversaries.A5!, secondsPerCall: measured.secondsPerCall, secondsPerCallWithWaits: measured.secondsPerCallWithWaits, waitedSeconds: measured.waitedSeconds };
    const d = decide(r).adversaryModel;
    expect(d.choice).toBe("A1");
    expect(d.because).toContain("waits included");
    expect(d.because).toContain(`over ${A5_MAX_HOURS}`);
  });
  it("gives the job to the more right of 2 qualifiers", () => {
    expect(decide(rule3({ right4: 0.8, right5: 0.7 })).adversaryModel.choice).toBe("A4");
    expect(decide(rule3({ right4: 0.7, right5: 0.8 })).adversaryModel.choice).toBe("A5");
  });
  it("gives a tie between 2 qualifiers to A5", () => {
    expect(decide(rule3({ right4: 0.7, right5: 0.7 })).adversaryModel.choice).toBe("A5");
  });
  it("gives the job to A4 when A5 wins but is too slow", () => {
    expect(decide(rule3({ right4: 0.7, right5: 0.7, a5Seconds: slow })).adversaryModel.choice).toBe("A4");
    expect(decide(rule3({ right4: 0.7, right5: 0.9, a5Seconds: slow })).adversaryModel.choice).toBe("A4");
  });
  it("skips a qualifier that shares the proposer's model", () => {
    // P2 is Sonnet 5, the same as A4
    const d = decide(rule3({ proposer: "P2", right4: 0.9, right5: 0.7 })).adversaryModel;
    expect(d.choice).toBe("A5");
    expect(d.because).toContain("A4");
    expect(decide(rule3({ proposer: "P3", k5: 0.5 })).adversaryModel.choice).toBe("A1");
  });
  it("with an Opus proposer, still hands the job to a qualifier left standing", () => {
    const d = decide(rule3({ proposer: "P4", k5: 0.5 })).adversaryModel;
    expect(d.choice).toBe("A4");
    expect(d.metBar).toBe(true);
  });
  it("with an Opus proposer and nothing standing, gives the job to the more right of A4 and A5, below the bar", () => {
    const d = decide(rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: 0.7, right5: 0.4 })).adversaryModel;
    expect(d.choice).toBe("A4");
    expect(d.metBar).toBe(false);
    expect(d.because).toMatch(/bar/);
    expect(decide(rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: 0.4, right5: 0.7 })).adversaryModel.choice).toBe("A5");
  });
  it("with an Opus proposer and nothing standing, gives a tie to A5, and a slow A5 pick to A4", () => {
    expect(decide(rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: 0.5, right5: 0.5 })).adversaryModel.choice).toBe("A5");
    expect(decide(rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: 0.5, right5: 0.5, a5Seconds: slow })).adversaryModel.choice).toBe("A4");
    expect(decide(rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: 0.1, right5: 0.9, a5Seconds: slow })).adversaryModel.choice).toBe("A4");
  });
  it("with an Opus proposer and nothing standing, ranks a run with no rightness below one with any", () => {
    expect(decide(rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: 0, right5: null })).adversaryModel.choice).toBe("A4");
    expect(decide(rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: null, right5: null })).adversaryModel.choice).toBe("A5");
  });
  it("with an Opus proposer, puts A3 out of reach as well when rule 2 chose high", () => {
    const d = decide(rule3({ proposer: "P4", effort: "high", k4: 0.5, k5: 0.5, right4: 0.7, right5: 0.4 })).adversaryModel;
    expect(d.choice).toBe("A4");
    expect(d.metBar).toBe(false);
  });
  it("never lands on the proposer's own model", () => {
    for (const proposer of PROPOSERS.map((p) => p.id)) {
      for (const k of [0.5, 0.8]) {
        for (const effort of ["medium", "high"] as const) {
          const r = rule3({ proposer, effort, k4: k, k5: k });
          const d = decide(r);
          const chosen = ADVERSARIES.find((x) => x.id === d.adversaryModel.choice)!;
          const p = PROPOSERS.find((x) => x.id === d.proposer.choice)!;
          expect(chosen.transport === p.transport && chosen.model === p.model).toBe(false);
        }
      }
    }
  });
});

describe("rule 3, the adversary's model, with A5 dropped", () => {
  const dropped = (opts: Parameters<typeof rule3>[0] = {}) => rule3({ ...opts, a5: "dropped" });
  const reason = DROPPED_ADVERSARIES.A5!;

  it("starts from results with no A5 in them at all", () => {
    const r = dropped();
    expect(r.dropped).toEqual(DROPPED_ADVERSARIES);
    expect(r.adversaries.A5).toBeUndefined();
    expect(r.agreement["A1|A5"]).toBeUndefined();
  });
  it("never lets A5 qualify, and says it was dropped and not measured, and why", () => {
    const d = decide(dropped({ k4: 0.5 })).adversaryModel;
    expect(d.choice).toBe("A1");
    expect(d.metBar).toBe(true);
    expect(d.because).toContain(`A5 was dropped and not measured (${reason})`);
  });
  it("hands the job to A4 when it qualifies, weighed against the Opus run alone", () => {
    const d = decide(dropped()).adversaryModel;
    expect(d.choice).toBe("A4");
    expect(d.metBar).toBe(true);
    expect(d.because).toContain("A5 was dropped");
    expect(decide(dropped({ right1: 0.6, right4: 0.59 })).adversaryModel.choice).toBe("A1");
    expect(decide(dropped({ effort: "high", right3: 0.8, right4: 0.7 })).adversaryModel.choice).toBe("A3");
    expect(decide(dropped({ effort: "high", right3: 0.6, right4: 0.7 })).adversaryModel.choice).toBe("A4");
  });
  it("skips A4 when it shares the proposer's model, leaving the Opus run the job", () => {
    const d = decide(dropped({ proposer: "P2" })).adversaryModel;
    expect(d.choice).toBe("A1");
    expect(d.because).toContain("proposer's own model");
  });
  it("with an Opus proposer, still hands the job to A4 when it qualifies", () => {
    const d = decide(dropped({ proposer: "P4" })).adversaryModel;
    expect(d.choice).toBe("A4");
    expect(d.metBar).toBe(true);
  });
  it("with an Opus proposer and nothing standing, gives the job to A4, the only challenger left, below the bar, and says so", () => {
    for (const opts of [{ k4: 0.5 }, { k4: 0.5, right4: null }, { k4: 0.5, right4: 0.1, right1: 0.9 }, { effort: "high" as const, k4: 0.5 }]) {
      const d = decide(dropped({ proposer: "P4", ...opts })).adversaryModel;
      expect(d.choice).toBe("A4");
      expect(d.metBar).toBe(false);
      expect(d.because).toContain("A4, the only challenger left");
      expect(d.because).toContain("A5 was dropped");
      expect(d.because).toContain("didn't meet this rule's own bar");
    }
  });
  it("never lands on the proposer's own model, or on a dropped run", () => {
    for (const proposer of PROPOSERS.map((p) => p.id)) {
      for (const k of [0.5, 0.8]) {
        for (const effort of ["medium", "high"] as const) {
          for (const right4 of [null, 0.1, 0.9]) {
            const d = decide(dropped({ proposer, effort, k4: k, right4 }));
            const chosen = ADVERSARIES.find((x) => x.id === d.adversaryModel.choice)!;
            const p = PROPOSERS.find((x) => x.id === d.proposer.choice)!;
            expect(chosen.transport === p.transport && chosen.model === p.model).toBe(false);
            expect(ACTIVE_ADVERSARIES.map((x) => x.id)).toContain(chosen.id);
          }
        }
      }
    }
  });
});

describe("rule 4, self-preference", () => {
  it("reports A5 as dropped and not measured, rather than as a run with no family to argue with", () => {
    const d = decide(base()).selfPreference;
    expect(d.because).toContain("A5 was dropped and not measured");
    expect(d.because).not.toMatch(/A5[^.]*had no reason/);
  });
  it("reports an adversary breaking its own family's reasons at least 15 points less often, and changes nothing", () => {
    const r = base();
    r.adversaries.A1!.family = { own: 0.2, others: 0.2 + SELF_PREFERENCE_GAP, gap: iv(SELF_PREFERENCE_GAP) };
    r.adversaries.A4!.family = { own: 0.3, others: 0.4, gap: iv(0.1) };
    const before = decide(r);
    const d = before.selfPreference;
    expect(d.because).toContain("A1");
    expect(d.because).not.toContain("A4");
    r.adversaries.A1!.family = { own: 0.3, others: 0.3, gap: iv(0) };
    const after = decide(r);
    for (const x of Object.values(r.adversaries)) if (x.family) x.family.gap = iv(0);
    expect(decide(r).selfPreference.because).toContain(`at least ${Math.round(SELF_PREFERENCE_GAP * 100)} points less often`);
    expect(after.proposer).toEqual(before.proposer);
    expect(after.adversaryModel).toEqual(before.adversaryModel);
    expect(after.selfPreference.choice).toBe(d.choice);
  });
});

describe("rule 5, samples", () => {
  const withCurve = (values: number[]) => {
    const r = base();
    for (const p of Object.values(r.proposers)) { p.yesRate = iv(0.1); p.costUsd = 100; }
    r.proposers.P2!.yesRate = iv(0.9); r.proposers.P2!.costUsd = 1;
    r.samplesCurve.P2 = values.map(iv);
    return r;
  };
  it("takes the smallest count that finds at least 90% of the good reasons", () => {
    expect(decide(withCurve([0.5, 0.85, 0.92, 0.97, 1])).samples.choice).toBe("3");
  });
  it("counts exactly 90% as enough", () => {
    expect(decide(withCurve([0.5, SAMPLES_SHARE, 0.95, 1, 1])).samples.choice).toBe("2");
  });
  it("reads the chosen proposer's curve, not another's", () => {
    const r = withCurve([0.2, 0.4, 0.6, 0.8, 1]);
    r.samplesCurve.P1 = [1, 1, 1, 1, 1].map(iv);
    expect(decide(r).samples.choice).toBe(String(MAX_SAMPLES));
  });
  it("keeps every sample when the chosen proposer has no reason rated good, and says why", () => {
    const d = decide(withCurve([])).samples;
    expect(d.choice).toBe(String(MAX_SAMPLES));
    expect(d.metBar).toBe(true);
    expect(d.because).toMatch(/no reason rated good/);
  });
});

describe("rule 6, attacking only the shown reasons", () => {
  const withShare = (share: number | null) => {
    const r = base();
    r.shownBreaks = { breaks: 10, shown: 0, share: share === null ? null : iv(share) };
    return r;
  };
  it("turns on when at least 80% of the breaks land on the top 3", () => {
    expect(decide(withShare(SHOWN_BREAKS_SHARE)).attackShownOnly.choice).toBe("on");
    expect(decide(withShare(0.95)).attackShownOnly.choice).toBe("on");
  });
  it("stays off below 80%", () => {
    expect(decide(withShare(0.79)).attackShownOnly.choice).toBe("off");
  });
  it("stays off with no break to count", () => {
    const r = withShare(null);
    r.shownBreaks.breaks = 0;
    expect(decide(r).attackShownOnly.choice).toBe("off");
  });
});

describe("every decision", () => {
  it("says why, naming its rule", () => {
    const d = decide(base());
    for (const decision of Object.values(d)) {
      expect(decision.rule.length).toBeGreaterThan(0);
      expect(decision.because.length).toBeGreaterThan(0);
    }
  });
  it("comes out of analyse the same as out of decide", () => {
    const { decisions, ...rest } = structuredClone(FIXTURE.results);
    expect(decide(rest)).toEqual(decisions);
  });
});

describe("the setup it proposes", () => {
  it("is laid out like the committed insights/setup.json, so the same values make no diff", () => {
    const committed = readFileSync(SETUP_PATH, "utf8");
    expect(formatSetup(parseSetup(JSON.parse(committed)))).toBe(committed);
  });
  it("lays out a role with no effort without the key", () => {
    const text = formatSetup(parseSetup({ propose: { transport: "claude", model: "haiku", samples: 2 }, falsify: { transport: "gemini", model: "gemini-3.8-flash" }, attackShownOnly: true, decidedBy: "insights/pilot/results.json" }));
    expect(text).toBe('{\n  "propose": { "transport": "claude", "model": "haiku", "samples": 2 },\n  "falsify": { "transport": "gemini", "model": "gemini-3.8-flash" },\n  "attackShownOnly": true,\n  "decidedBy": "insights/pilot/results.json"\n}\n');
  });

  const previous: Setup = parseSetup({
    propose: { transport: "claude", model: "sonnet", effort: "high", samples: 5 },
    falsify: { transport: "claude", model: "opus", effort: "medium" },
    attackShownOnly: false,
    decidedBy: null,
  });

  it("writes the chosen setups, the sample count and the shown-only switch, and says where they came from", () => {
    const r = rule3({ proposer: "P1", k4: 0.5 });
    r.samplesCurve.P1 = [0.5, 0.95, 1, 1, 1].map(iv);
    r.shownBreaks = { breaks: 10, shown: 9, share: iv(0.9) };
    const full: Results = { ...r, decisions: decide(r) };
    const setup = setupFrom(full, previous);
    expect(setup).toEqual({
      propose: { transport: "claude", model: "haiku", samples: 2 },
      falsify: { transport: "gemini", model: "gemini-3.8-flash" },
      attackShownOnly: true,
      decidedBy: "insights/pilot/results.json",
    });
    expect(parseSetup(setup)).toEqual(setup);
  });
  it("carries the chosen run's effort, never a pilot label", () => {
    const r = rule3({ proposer: "P1", effort: "high", k4: 0.5, k5: 0.5 });
    const setup = setupFrom({ ...r, decisions: decide(r) }, previous);
    expect(setup.falsify).toEqual({ transport: "claude", model: "opus", effort: "high" });
  });
});

describe("the tables", () => {
  const { a, b, results } = FIXTURE;
  const md = tables(results);

  it("lists every setup by its model and effort", () => {
    for (const name of ["Haiku 4.5", "Sonnet 5", "Opus 5.5", "Gemini 3.8 Flash"]) expect(md).toContain(name);
    for (const id of [...PROPOSERS, ...ADVERSARIES].map((x) => x.id)) expect(md).toContain(`| ${id} |`);
  });
  it("shows each decision with its reason", () => {
    for (const d of Object.values(results.decisions)) expect(md).toContain(d.because);
  });
  it("names a policy miss by candidate id and category only", () => {
    const miss = b.termMatches.find((t) => t.termMatch)!.candidateId;
    expect(md).toContain(`\`${miss}\` (terms)`);
    const text = a.candidates.find((c) => c.candidateId === miss)!.candidate.claim.en;
    expect(md).not.toContain(text);
  });
  it("gives the test counts a denominator: each setup's reasons", () => {
    expect(md).toContain("| Setup | Model | Effort | Reasons | Tests passed | Refused | Missing |");
    for (const role of PROPOSERS) {
      expect(md).toContain(`| ${role.id} | ${role.id === "P1" ? "Haiku 4.5" : role.model === "sonnet" ? "Sonnet 5" : "Opus 5.5"} | ${role.effort ?? "none"} | ${results.proposers[role.id]!.candidates} |`);
    }
  });
  it("calls it agreement, over the candidates both runs answered usably", () => {
    expect(md).toContain("over the candidates both answered usably");
    expect(md).toContain("Cohen's kappa, or 1 when the 2 runs agree on every candidate");
  });
  it("marks a choice that didn't meet its rule's own bar", () => {
    const r = rule3({ proposer: "P4", k4: 0.5, k5: 0.5, right4: 0.7, right5: 0.4 });
    const full: Results = { ...r, decisions: decide(r) };
    expect(full.decisions.adversaryModel.metBar).toBe(false);
    expect(tables(full)).toContain("A4 (Sonnet 5, high), below the rule's own bar");
    expect(md).not.toContain("below the rule's own bar");
  });
  it("keeps to the copy rules: no em dash", () => {
    expect(md).not.toContain("—");
  });
  it("states A5's speed check, waits included, with the total time it waited beside it, when A5 was measured", () => {
    const m = micro();
    const measured = analyse(m.a, m.b, m.ratings, NOW, AS_REGISTERED);
    const check = measured.speedCheck;
    if (!check.ran) throw new Error("A5's speed check should have run");
    const measuredMd = tables(measured);
    expect(measuredMd).toContain(`A5's speed check, one call at a time, waits included: ${check.secondsPerCall!.toFixed(1)} seconds a call`);
    expect(measuredMd).toMatch(/A5's speed check[^\n]*waited [^\n]* in all/);
    expect(measuredMd).toContain("| Waited |");
  });
  it("says A5's speed check didn't run, and why", () => {
    expect(md).toContain(`A5's speed check didn't run: A5 was dropped and not measured (${DROPPED_ADVERSARIES.A5}).`);
    expect(md).not.toMatch(/A5's speed check, one call at a time/);
  });
  it("shows A5 as a row marked dropped and not measured, with the reason, in every run table, never as numbers", () => {
    const rows = md.split("\n").filter((line) => line.startsWith("| A5 |"));
    expect(rows.length).toBe(4); // the 2 adversary tables, agreement and safety
    for (const row of rows) {
      expect(row).toContain(`dropped, not measured: ${DROPPED_ADVERSARIES.A5}`);
      expect(row).not.toMatch(/\|\s*\d/); // no cell starts with a number
    }
    expect(md).toContain(`| Run | ${ACTIVE_ADVERSARIES.map((x) => x.id).join(" | ")} |`); // agreement's own columns: the runs measured
  });
  it("names the runs whose breaks it counts on shown reasons", () => {
    expect(md).toContain("breaks across A1, A2, A3 and A4 landed on the top");
  });
  it("puts each proposer's cost per answered call beside its total", () => {
    expect(md).toContain("| Setup | Yes rate | Rated | Cost at list price | Cost per call |");
  });
});

describe("the README's results", () => {
  const readme = "# Pilot\n\n## Results\n\n<!-- results:start -->\nold\n<!-- results:end -->\n\n## What it decided\n";
  it("replaces only what sits between the markers", () => {
    const out = withResults(readme, "| new |");
    expect(out).toBe("# Pilot\n\n## Results\n\n<!-- results:start -->\n\n| new |\n\n<!-- results:end -->\n\n## What it decided\n");
    expect(withResults(out, "| new |")).toBe(out);
  });
  it("refuses a README with no markers", () => {
    expect(() => withResults("# Pilot\n", "x")).toThrow(/results:start/);
  });
});

describe("pnpm insights:pilot:analyse", () => {
  async function setUp(ratings: Ratings, readme = "# Pilot\n\n<!-- results:start -->\n<!-- results:end -->\n") {
    const dir = mkdtempSync(join(tmpdir(), "analyse-"));
    const a = fakeStageA();
    const b = fakeStageB(a);
    const paths = {
      stageA: join(dir, "stage-a.json"),
      stageB: join(dir, "stage-b.json"),
      ratings: join(dir, "ratings.json"),
      results: join(dir, "results.json"),
      readme: join(dir, "README.md"),
      setup: join(dir, "setup.json"),
      jury: join(dir, "jury.json"),
    };
    await writeFile(paths.stageA, JSON.stringify(a));
    await writeFile(paths.stageB, JSON.stringify(b));
    await writeFile(paths.ratings, JSON.stringify(ratings));
    await writeFile(paths.readme, readme);
    const setup = '{"propose":{"transport":"claude","model":"sonnet","effort":"high","samples":5},"falsify":{"transport":"claude","model":"opus","effort":"medium"},"attackShownOnly":false,"decidedBy":null}';
    await writeFile(paths.setup, setup);
    const lines: string[] = [];
    const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    return { a, b, paths, lines, io, readme, setup };
  }
  const exists = (path: string) => readFile(path, "utf8").then(() => true, () => false);

  it("writes nothing when the rating isn't finished", async () => {
    const a = fakeStageA();
    const b = fakeStageB(a);
    const full = fakeRatings(a, b);
    const s = await setUp({ ...full, answers: full.answers.slice(0, 5) });
    expect(await runAnalysis(s.paths, s.io, NOW)).toBe(false);
    expect(await exists(s.paths.results)).toBe(false);
    expect(await readFile(s.paths.readme, "utf8")).toBe(s.readme);
    expect(await readFile(s.paths.setup, "utf8")).toBe(s.setup);
    expect(s.lines.join("\n")).toMatch(/isn't finished/);
  });
  it("writes nothing, and says why, when ratings.json isn't a rating", async () => {
    for (const bad of [{}, { items: {}, answers: [] }, { items: [], answers: "x" }, []]) {
      const s = await setUp(bad as unknown as Ratings);
      expect(await runAnalysis(s.paths, s.io, NOW)).toBe(false);
      expect(await exists(s.paths.results)).toBe(false);
      expect(s.lines.join("\n")).toMatch(/isn't a rating/);
    }
  });
  it("writes nothing when the README has lost its markers", async () => {
    const a = fakeStageA();
    const b = fakeStageB(a);
    const s = await setUp(fakeRatings(a, b), "# Pilot\n");
    expect(await runAnalysis(s.paths, s.io, NOW)).toBe(false);
    expect(await exists(s.paths.results)).toBe(false);
    expect(await readFile(s.paths.setup, "utf8")).toBe(s.setup);
  });
  it("writes the results, the README's tables and the setup once it is", async () => {
    const a = fakeStageA();
    const b = fakeStageB(a);
    const ratings = fakeRatings(a, b);
    const s = await setUp(ratings);
    expect(await runAnalysis(s.paths, s.io, NOW)).toBe(true);
    const results = JSON.parse(await readFile(s.paths.results, "utf8")) as Results;
    expect(results).toEqual(JSON.parse(JSON.stringify(FIXTURE.results)));
    expect(results.dropped).toEqual(DROPPED_ADVERSARIES);
    const readme = await readFile(s.paths.readme, "utf8");
    expect(readme).toBe(withResults(s.readme, tables(results)));
    const written = await readFile(s.paths.setup, "utf8");
    expect(written).toBe(formatSetup(setupFrom(results, parseSetup(JSON.parse(s.setup)))));
    expect(parseSetup(JSON.parse(written))).toEqual(setupFrom(results, parseSetup(JSON.parse(s.setup))));
  });
  it("reads the jury's file into the results and the tables when a jury rated", async () => {
    const a = fakeStageA();
    const b = fakeStageB(a);
    const s = await setUp(fakeRatings(a, b));
    await writeFile(s.paths.jury, JSON.stringify(JURY));
    expect(await runAnalysis(s.paths, s.io, NOW)).toBe(true);
    const results = JSON.parse(await readFile(s.paths.results, "utf8")) as Results;
    expect(results.rater).toEqual(JSON.parse(JSON.stringify(raterFrom(JURY))));
    expect(await readFile(s.paths.readme, "utf8")).toContain("### Who rated");
  });
  it("writes nothing when jury.json isn't a jury's file", async () => {
    const a = fakeStageA();
    const b = fakeStageB(a);
    const s = await setUp(fakeRatings(a, b));
    await writeFile(s.paths.jury, JSON.stringify({ judges: "J1" }));
    expect(await runAnalysis(s.paths, s.io, NOW)).toBe(false);
    expect(await exists(s.paths.results)).toBe(false);
    expect(await readFile(s.paths.setup, "utf8")).toBe(s.setup);
    expect(s.lines.join("\n")).toMatch(/isn't a jury's file/);
  });
});

/** A jury's file over the fixtures' plan: the judges split on about a third of the items, and the owner's spot-check calls every sampled reason sound. */
const JURY: JuryFile = (() => {
  const { ratings } = FIXTURE;
  const asked = ratings.items.filter((i): i is RatingItem & { kind: "reason" | "disagreement" } => i.kind !== "drift");
  const answer = (item: RatingItem, sound: boolean): ChecklistAnswer => ({
    claimBeyondPremise: sound ? "no" : "yes",
    linkExplainsFinding: "yes",
    ignoresObviousAlternative: "no",
    ...(item.kind === "disagreement" ? { counters: Object.fromEntries(item.counterIds.map((id) => [id, "yes" as const])) } : {}),
  });
  const answers: AnswersByJudge = Object.fromEntries(
    JUDGES.map((judge, k) => [judge.id, Object.fromEntries(asked.map((item, i) => [item.itemId, answer(item, (i + k) % 3 !== 0)]))]),
  );
  const sample = spotItems(ratings.items);
  const spot: SpotCheck = { items: sample.map((i) => i.itemId), answers: sample.map((i) => ({ itemId: i.itemId, ...answer(i, true) })) };
  return {
    ranAt: "2026-09-27T12:00:00.000Z",
    judges: JUDGES.map((j) => ({
      id: j.id,
      provider: j.provider,
      model: j.model,
      family: j.family,
      answered: [j.model],
      asked: asked.length,
      usable: asked.length,
      failed: 0,
      unsure: 0,
      calls: asked.length,
      usage: NO_USAGE,
      secondsPerCall: 1,
      waitedSeconds: 0,
    })),
    fallback: null,
    answers,
    agreement: juryAgreement(ratings.items, answers),
    spotCheck: spotAgreement(spot, ratings.items, answers),
  };
})();

describe("who rated", () => {
  const { a, b, ratings } = FIXTURE;
  const byJury = analyse(a, b, ratings, NOW, DROPPED_ADVERSARIES, raterFrom(JURY));
  const md = tables(byJury);

  it("is the owner when no jury rated, and the tables add nothing", () => {
    expect(FIXTURE.results.rater).toBe("owner");
    expect(tables(FIXTURE.results)).not.toContain("Who rated");
  });

  it("carries the jury's judges and models, J2's switch and the agreement, and leaves every measure as it was", () => {
    const rater = raterFrom(JURY);
    expect(rater).toEqual({
      by: "jury",
      judges: JUDGES.map((j) => ({ id: j.id, provider: j.provider, model: j.model, family: j.family, answered: [j.model] })),
      fallback: null,
      agreement: JURY.agreement,
      spotCheck: JURY.spotCheck,
    });
    expect(byJury.rater).toEqual(rater);
    const { rater: _jury, decisions: _d1, ...measures } = byJury;
    const { rater: _owner, decisions: _d2, ...before } = FIXTURE.results;
    expect(measures).toEqual(before);
  });

  it("gives the tables a Who rated section: the judges and their models, and no person's answers in the rules", () => {
    expect(md.startsWith("### Who rated")).toBe(true);
    for (const j of JUDGES) expect(md).toContain(`${j.id} (\`${j.model}\`)`);
    expect(md).toContain("No person's answers feed the rules.");
  });

  it("tabulates the judges' agreement and the owner's spot-check against the jury, each with its n", () => {
    const k = JURY.agreement.pairs["J1|J2"]!.sound;
    expect(md).toContain("| Between | Claim beyond premise | Link explains finding | Ignores obvious alternative | Sound | Breaks |");
    expect(md).toMatch(new RegExp(`\\| J1 and J2, kappa \\| [^|]+ \\| [^|]+ \\| [^|]+ \\| ${k.kappa!.toFixed(2)} \\(n ${k.n}\\) \\|`));
    expect(md).toMatch(/\| All 3 judges, share agreeing \| \d+% \(n \d+\) \|/);
    const spot = JURY.spotCheck.measures.sound;
    expect(md).toContain(`| Owner and jury, share agreeing |`);
    expect(md).toContain(`${Math.round(spot.raw! * 100)}% (n ${spot.n})`);
    expect(md).toMatch(/\| Owner and jury, kappa \|/);
    expect(md).toContain(`on ${JURY.spotCheck.items} items`);
  });

  it("names J2's stand-in when it took over", () => {
    const switched: JuryFile = {
      ...JURY,
      fallback: { judge: "J2", from: "qwen/qwen3.8-27b", to: "@cf/google/gemma-4-26b-a4b-it", status: 404 },
      judges: JURY.judges.map((j) => (j.id === "J2" ? { ...j, provider: "cloudflare", model: "@cf/google/gemma-4-26b-a4b-it", family: "Google" } : j)),
    };
    const out = tables(analyse(a, b, ratings, NOW, DROPPED_ADVERSARIES, raterFrom(switched)));
    expect(out).toContain("J2 (`@cf/google/gemma-4-26b-a4b-it`)");
    expect(out).toContain("J2 ran on `@cf/google/gemma-4-26b-a4b-it`: `qwen/qwen3.8-27b` answered 404 at its first call.");
  });

  it("says there's no drift check under a jury", () => {
    expect(md).toContain("A jury rated, so there's no drift check.");
    expect(md).not.toContain("No item rated twice");
  });

  it("names the jury as the one who judged A3's extra breaks", () => {
    const r = base();
    r.noiseFloor = iv(0.8);
    r.agreement["A1|A3"] = iv(0.6);
    r.extraBreaks = { inPool: 4, rated: 3, right: 2 };
    expect(decide(r).adversaryEffort.because).toContain("The owner judged 2 of A3's 3 rated extra breaks right");
    expect(decide({ ...r, rater: raterFrom(JURY) }).adversaryEffort.because).toContain("The jury judged 2 of A3's 3 rated extra breaks right");
  });

  it("keeps to the copy rules: no em dash", () => {
    expect(md).not.toContain("—");
  });
});
