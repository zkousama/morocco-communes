import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_USAGE } from "../../src/model.ts";
import { refusal } from "../../src/safety.ts";
import type { Check } from "../../src/vocabulary.ts";
import {
  answerItem,
  broke,
  counterIdOf,
  counterText,
  describeCheck,
  missingFindingIds,
  ratingPlan,
  readStageFiles,
  refuseNewPlanReason,
  remainingItems,
  resolve,
  runRating,
  screen,
  type Prompter,
  type RatingIO,
  type Ratings,
  type RatingItem,
  type UnitNamer,
} from "../../src/pilot/rate.ts";
import { candidateIdOf } from "../../src/pilot/sample.ts";
import { ADVERSARIES, PROPOSERS } from "../../src/pilot/setups.ts";
import type { StageA, StageB, StageBVerdict } from "../../src/pilot/stages.ts";
import { fakeStageA, fakeStageB } from "./fixtures.ts";

const a = fakeStageA();
const b = fakeStageB(a);
const lines = new Map(a.findingIds.map((id) => [id, { en: `line ${id}`, fr: `ligne ${id} fr` }]));
const unitName: UnitNamer = (code) => `unit ${code}`;
const noIo: RatingIO = { log: () => {} };

describe("the fixtures themselves", () => {
  it("gives rule 5 a curve to measure: some candidates aren't found by sample 0", () => {
    expect(a.candidates.some((c) => !c.sampleIndexes.includes(0))).toBe(true);
    expect(a.candidates.some((c) => c.sampleIndexes.includes(0))).toBe(true);
  });
  it("gives rule 6 candidates outside the top 3: some findings have ranks 3 and 4, and a real break lands on one in the pool", () => {
    const rankById = new Map(a.candidates.map((c) => [c.candidateId, c.rank]));
    expect(a.candidates.some((c) => c.rank >= 3)).toBe(true);
    const lowRankInPool = b.pool.filter((entry) => (rankById.get(entry.candidateId) ?? 0) >= 3);
    expect(lowRankInPool.length).toBeGreaterThan(0);
    const brokeOne = lowRankInPool.some((entry) => b.verdicts.some((v) => v.candidateId === entry.candidateId && broke(v)));
    expect(brokeOne).toBe(true);
  });
  it("keeps rank consistent with support: rank 0 is always the most supported within its finding and proposer", () => {
    const byFindingProposer = new Map<string, typeof a.candidates>();
    for (const c of a.candidates) {
      const key = `${c.proposer}:${c.findingId}`;
      byFindingProposer.set(key, [...(byFindingProposer.get(key) ?? []), c]);
    }
    for (const group of byFindingProposer.values()) {
      const byRank = [...group].sort((x, y) => x.rank - y.rank);
      for (let i = 1; i < byRank.length; i++) expect(byRank[i]!.candidate.support).toBeLessThanOrEqual(byRank[i - 1]!.candidate.support);
    }
  });
  it("keeps stage A's own link invariant: link is only set when passed, and always carries the same LinkTest candidate.linkTest proposed", () => {
    for (const c of a.candidates) {
      if (!c.passed) {
        expect(c.link).toBeNull();
        continue;
      }
      if (c.link) {
        expect(c.candidate.linkTest).not.toBeNull();
        expect(c.link.link).toBe(c.candidate.linkTest!.link);
        expect((c.link as { x: string }).x).toBe((c.candidate.linkTest as { x: string }).x);
      }
    }
    expect(a.candidates.some((c) => c.passed && c.link)).toBe(true); // the invariant has something real to hold, not just vacuously true
  });
  it("gives some data tests a refusal (tautology, unknown field) and some a missing figure, not just pass or plain fail", () => {
    const refused = a.candidates.filter((c) => c.outcome.status === "refused");
    expect(refused.some((c) => c.outcome.reason === "tautology")).toBe(true);
    expect(refused.some((c) => c.outcome.reason === "unknown field")).toBe(true);
    expect(a.candidates.some((c) => c.outcome.status === "failed" && c.outcome.reason === "missing")).toBe(true);
  });
  it("keeps a proposer's replies consistent with its own answered models", () => {
    for (const p of a.proposers) {
      expect(p.replies.length).toBeGreaterThan(0);
      expect(p.answered).toEqual([...new Set(p.replies.map((r) => r.model))].sort());
    }
  });
});

describe("the rating plan", () => {
  const plan = ratingPlan(a, b, 1);
  it("puts reasons first, disagreements next, and drift items last", () => {
    const kinds = plan.map((i) => i.kind);
    expect(kinds.indexOf("disagreement")).toBeGreaterThan(kinds.lastIndexOf("reason"));
    expect(kinds.indexOf("drift")).toBeGreaterThan(kinds.lastIndexOf("disagreement"));
    expect(plan.filter((i) => i.kind === "drift")).toHaveLength(10);
  });
  it("is the same for the same seed", () => {
    expect(ratingPlan(a, b, 1)).toEqual(plan);
  });
  it("leaves out anything stopped for safety", () => {
    const refused = new Set(b.verdicts.filter((v) => v.stage === "safety").map((v) => v.candidateId));
    for (const item of plan) if (item.kind !== "drift") expect(refused.has((item as { candidateId: string }).candidateId)).toBe(false);
  });
  it("gives up to 15 reasons per proposer, one per finding", () => {
    const reasons = plan.filter((i): i is RatingItem & { kind: "reason" } => i.kind === "reason");
    const byProposer = new Map<string, string[]>();
    for (const item of reasons) {
      const c = a.candidates.find((x) => x.candidateId === item.candidateId)!;
      const list = byProposer.get(c.proposer) ?? [];
      list.push(c.findingId);
      byProposer.set(c.proposer, list);
    }
    expect(byProposer.size).toBeGreaterThan(0);
    for (const findingIds of byProposer.values()) {
      expect(findingIds.length).toBeLessThanOrEqual(15);
      expect(new Set(findingIds).size).toBe(findingIds.length); // one per finding: never a repeat
    }
  });
  it("caps disagreements at 40", () => {
    const disagreements = plan.filter((i) => i.kind === "disagreement");
    expect(disagreements.length).toBeLessThanOrEqual(40);
    expect(disagreements.length).toBeGreaterThan(0);
  });
  it("gives every disagreement at least one counter, deduplicated by signature and sorted by the id itself", () => {
    for (const item of plan) {
      if (item.kind !== "disagreement") continue;
      expect(item.counterIds.length).toBeGreaterThan(0);
      expect(new Set(item.counterIds).size).toBe(item.counterIds.length);
      expect(item.counterIds).toEqual([...item.counterIds].sort());
    }
  });
  it("gives some disagreements several distinct counter-tests, and some just one", () => {
    const disagreements = plan.filter((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement");
    expect(disagreements.some((d) => d.counterIds.length > 1)).toBe(true);
    expect(disagreements.some((d) => d.counterIds.length === 1)).toBe(true);
  });
  it("differs for a different seed", () => {
    expect(ratingPlan(a, b, 2)).not.toEqual(plan);
  });
});

describe("ratingPlan's private-terms screen", () => {
  it("leaves a term-matching reason out without drawing a replacement for it", () => {
    // Every reason candidate's claim is "claim N": banning the word "claim" bans every
    // reason a term match would ever have covered, since sampleRated draws no other text.
    const terms = /claim/i;
    const withTerms = ratingPlan(a, b, 1, terms);
    const without = ratingPlan(a, b, 1);
    const reasonsWith = withTerms.filter((i) => i.kind === "reason");
    const reasonsWithout = without.filter((i) => i.kind === "reason");
    expect(reasonsWith).toHaveLength(0);
    expect(reasonsWithout.length).toBeGreaterThan(0);
  });
  it("never flags fixture text as a term match by accident", () => {
    for (const c of a.candidates) {
      for (const text of [c.candidate.claim, c.candidate.link, c.candidate.premise].flatMap((t) => [t.en, t.fr])) {
        expect(refusal(text, null)).toBeNull();
      }
    }
  });
  it("also drops a reason candidate flagged as a term match in stage B, even though its own text passes", () => {
    // A reason candidate can be a pool candidate too; stage B's own termMatches has to be
    // honoured for reasons as well, not just the direct text check on the 6 texts.
    const findingIds = ["f0"];
    const test: Check = { check: "compare", left: { of: { unit: "self" }, field: "m", year: 2024 }, op: ">", right: { value: 1 } };
    const candidateId = candidateIdOf("f0", "P1", test);
    const miniA: StageA = {
      seed: 1,
      findingIds,
      proposers: [{ id: "P1", role: PROPOSERS[0]!, replies: [], unusable: {}, failed: 0, safetyDrops: {}, entropy: {}, usage: NO_USAGE, ms: 0, waitedMs: 0, answered: [] }],
      candidates: [
        {
          candidateId,
          proposer: "P1",
          findingId: "f0",
          candidate: { claim: { en: "clean claim", fr: "clean" }, link: { en: "clean link", fr: "clean" }, premise: { en: "clean premise", fr: "clean" }, test, linkTest: null, artefact: false, support: 1, samples: [0] },
          sampleIndexes: [0],
          rank: 0,
          outcome: { status: "passed", numbers: {} },
          passed: true,
          link: null,
        },
      ],
    };
    const miniB: StageB = { pool: [{ candidateId, proposer: "P1", findingId: "f0" }], verdicts: [], termMatches: [{ candidateId, termMatch: true }] };
    expect(ratingPlan(miniA, miniB, 1).some((i) => i.kind === "reason")).toBe(false);
  });
});

describe("missingFindingIds", () => {
  it("lists ids the line map doesn't cover", () => {
    const lineMap = new Map([["f0", { en: "x", fr: "y" }]]);
    expect(missingFindingIds(["f0", "f1", "f2"], lineMap)).toEqual(["f1", "f2"]);
  });
  it("is empty once every id resolves", () => {
    const lineMap = new Map([["f0", { en: "x", fr: "y" }]]);
    expect(missingFindingIds(["f0"], lineMap)).toEqual([]);
  });
});

describe("refuseNewPlanReason", () => {
  it("refuses a new plan with no INSIGHTS_LOCAL at all", () => {
    expect(refuseNewPlanReason(true, null)).toMatch(/INSIGHTS_LOCAL/);
  });
  it("refuses a new plan when the local folder has no terms", () => {
    expect(refuseNewPlanReason(true, { terms: [], keys: {} })).toMatch(/no private terms/);
  });
  it("allows a new plan once there are real terms", () => {
    expect(refuseNewPlanReason(true, { terms: ["x"], keys: {} })).toBeNull();
  });
  it("never blocks resuming an existing plan, even with no terms at all", () => {
    expect(refuseNewPlanReason(false, null)).toBeNull();
  });
});

describe("broke", () => {
  const base: StageBVerdict = {
    run: "A1", candidateId: "c", survived: false, stage: "falsify", category: null, unusable: null,
    counter: { check: "compare", left: { of: { unit: "self" }, field: "m", year: 2024 }, op: ">", right: { value: 1 } },
    counterOutcome: { status: "passed", numbers: {} }, reason: "r", model: "m", usage: NO_USAGE, ms: 0, waitedMs: 0,
  };
  it("is true only for a real counter-test that came out true", () => {
    expect(broke(base)).toBe(true);
    expect(broke({ ...base, survived: true, stage: null })).toBe(false);
    expect(broke({ ...base, stage: "safety" })).toBe(false);
    expect(broke({ ...base, unusable: "no answer" })).toBe(false);
  });
});

describe("counterIdOf", () => {
  const check: Check = { check: "compare", left: { of: { unit: "self" }, field: "m", year: 2024 }, op: ">", right: { value: 1 } };
  it("is stable for the same candidate and check, and differs when either changes", () => {
    const id1 = counterIdOf("c1", check);
    expect(counterIdOf("c1", check)).toBe(id1);
    expect(counterIdOf("c2", check)).not.toBe(id1);
    expect(counterIdOf("c1", { ...check, op: "<" })).not.toBe(id1);
  });
});

describe("describeCheck", () => {
  const check: Check = { check: "compare", left: { of: { unit: "self" }, field: "measure", year: 2024 }, op: ">", right: { value: 5 } };
  it("names the field's own label, the subject and the comparison, in English and French", () => {
    const described = describeCheck(check, unitName);
    expect(described.en).toContain("more than");
    expect(described.en).toContain("this place");
    expect(described.fr).toContain("supérieur à");
    expect(described.fr).toContain("ce lieu");
  });
  it("reads >= and <= as 'au moins'/'au plus', never 'plus que'/'moins que'", () => {
    const atLeast = describeCheck({ ...check, op: ">=" }, unitName);
    const atMost = describeCheck({ ...check, op: "<=" }, unitName);
    expect(atLeast.fr).toContain("au moins");
    expect(atMost.fr).toContain("au plus");
    for (const described of [describeCheck(check, unitName), describeCheck({ ...check, op: "<" }, unitName), atLeast, atMost]) {
      expect(described.fr).not.toContain("plus que");
      expect(described.fr).not.toContain("moins que");
    }
  });
  it("never elides 'de le' into anything but 'du', for a country subject", () => {
    const country: Check = { ...check, left: { ...check.left, of: { unit: "country" } } };
    const described = describeCheck(country, unitName);
    expect(described.fr).toContain("du pays");
    expect(described.fr).not.toContain("de le pays");
  });
  it("names a unit by its resolved name for a code subject", () => {
    const withCode: Check = { ...check, left: { ...check.left, of: { unit: "code", code: "01.001" } } };
    expect(describeCheck(withCode, unitName).en).toContain("unit 01.001");
  });
  it("falls back to the raw code when the namer can't resolve it", () => {
    const withCode: Check = { ...check, left: { ...check.left, of: { unit: "code", code: "01.001" } } };
    expect(describeCheck(withCode, () => null).en).toContain("01.001");
  });
  it("describes a change check: the subject, the field label, both years and the direction", () => {
    const change: Check = { check: "change", of: { unit: "parent" }, field: "measure", op: "<", value: 3 };
    const described = describeCheck(change, unitName);
    expect(described.en).toContain("its province or région");
    expect(described.en).toContain("less than");
    expect(described.en).toContain("2014 to 2024");
    expect(described.fr).toContain("sa province ou région");
    expect(described.fr).toContain("inférieur à");
  });
  it("describes a rank check: the subject, the field label, the year, the position and the area", () => {
    const rank: Check = { check: "rank", of: { unit: "self" }, field: "measure", year: 2024, within: "province", position: "top", share: 0.1 };
    const described = describeCheck(rank, unitName);
    expect(described.en).toContain("top 10%");
    expect(described.en).toContain("its province");
    expect(described.fr).toContain("10%");
    expect(described.fr).toContain("sa province");
  });
  it("contracts 'du haut du pays' for a rank within the whole country, never 'de le pays'", () => {
    const rank: Check = { check: "rank", of: { unit: "self" }, field: "measure", year: 2024, within: "country", position: "top", share: 0.1 };
    const described = describeCheck(rank, unitName);
    expect(described.fr).toContain("du haut du pays");
    expect(described.fr).not.toContain("de le pays");
  });
});

describe("counterText", () => {
  it("shows the check in plain words and the outcome's numbers, in English then French, never the run, the model or the adversary's own reason", () => {
    const item = ratingPlan(a, b, 1).find((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement")!;
    const text = counterText(item.candidateId, item.counterIds[0]!, b, unitName);
    expect(text).toContain("counter-test:");
    expect(text).toMatch(/value=/);
    expect(text).not.toContain("came out true"); // the adversary's own `.reason`, never shown
    for (const role of [...PROPOSERS, ...ADVERSARIES]) {
      expect(text.toLowerCase()).not.toContain(role.id.toLowerCase());
      expect(text.toLowerCase()).not.toContain(role.model.toLowerCase());
    }
  });
});

describe("the screen", () => {
  const bannedWords = [...PROPOSERS, ...ADVERSARIES].flatMap((r) => [r.id, r.model]).concat(["medium", "high", "survived", "published", "falsify", "safety"]);

  it("never names a setup, a model, an effort, a run or a stage, anywhere in the plan's screens or counter texts", () => {
    const plan = ratingPlan(a, b, 1);
    for (const item of plan) {
      const text = screen(item, a, b, lines);
      for (const word of bannedWords) expect(text.toLowerCase()).not.toContain(word.toLowerCase());
      const resolved = resolve(item, b);
      for (const counterId of resolved.counterIds) {
        const counter = counterText(resolved.candidateId, counterId, b, unitName);
        for (const word of bannedWords) expect(counter.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });
  it("shows the French too", () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    const c = a.candidates.find((x) => x.candidateId === (item as { candidateId: string }).candidateId)!;
    expect(screen(item, a, b, lines)).toContain(c.candidate.claim.fr);
  });
  it("shows a disagreement's own reason, same as a plain reason would", () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "disagreement")!;
    const c = a.candidates.find((x) => x.candidateId === (item as { candidateId: string }).candidateId)!;
    expect(screen(item, a, b, lines)).toContain(c.candidate.claim.en);
    expect(screen(item, a, b, lines)).toContain(c.candidate.premise.en);
    expect(screen(item, a, b, lines)).toContain(c.candidate.link.en);
  });
  it("shows a drift item exactly as it showed the item it repeats, blind to which one that was", () => {
    const plan = ratingPlan(a, b, 1);
    const original = plan.find((i) => i.kind === "reason")!;
    const drift: RatingItem = { kind: "drift", itemId: "drift:test-reason", of: original.itemId };
    expect(screen(drift, a, b, lines)).toBe(screen(original, a, b, lines));
  });
  it("resolves a drift-of-disagreement with the same, sorted counterIds as the original", () => {
    const disagreement = ratingPlan(a, b, 1).find((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement")!;
    const drift: RatingItem = { kind: "drift", itemId: "drift:test-disagreement", of: disagreement.itemId };
    const resolved = resolve(drift, b);
    expect(resolved.kind).toBe("disagreement");
    expect(resolved.counterIds).toEqual(disagreement.counterIds);
    expect(resolved.counterIds).toEqual([...resolved.counterIds].sort());
  });
  it("throws a clear error rather than showing nothing for a finding id the line map doesn't cover", () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    expect(() => screen(item, a, b, new Map())).toThrow(/finding line/);
  });
});

describe("readStageFiles", () => {
  it("refuses with a clear message when stage A is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rate-"));
    const bPath = join(dir, "stage-b.json");
    await writeFile(bPath, JSON.stringify(b));
    const result = await readStageFiles(join(dir, "stage-a.json"), bPath);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/stage a/i);
  });
  it("refuses with a clear message when stage B is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rate-"));
    const aPath = join(dir, "stage-a.json");
    await writeFile(aPath, JSON.stringify(a));
    const result = await readStageFiles(aPath, join(dir, "stage-b.json"));
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/stage b/i);
  });
  it("reads both when they're there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rate-"));
    const aPath = join(dir, "stage-a.json");
    const bPath = join(dir, "stage-b.json");
    await writeFile(aPath, JSON.stringify(a));
    await writeFile(bPath, JSON.stringify(b));
    const result = await readStageFiles(aPath, bPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.a).toEqual(a);
      expect(result.b).toEqual(b);
    }
  });
});

describe("remainingItems", () => {
  it("skips items already answered, and keeps plan order for the rest", () => {
    const plan = ratingPlan(a, b, 1);
    const ratings: Ratings = { items: plan, answers: [{ itemId: plan[0]!.itemId, answer: "yes", at: "t" }] };
    const left = remainingItems(ratings);
    expect(left).toHaveLength(plan.length - 1);
    expect(left).toEqual(plan.slice(1));
  });
  it("keeps everything when nothing's answered yet", () => {
    const plan = ratingPlan(a, b, 1);
    expect(remainingItems({ items: plan, answers: [] })).toEqual(plan);
  });
});

/** A scripted stub `Prompter`: hands back the next queued answer on each call, so a test can drive the loop without a real terminal. */
function scripted(...answers: string[]): Prompter {
  let i = 0;
  return { question: async () => answers[i++] ?? "q" };
}

describe("answerItem", () => {
  it("records a plain reason with just the main answer, no counters", async () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    const result = await answerItem(item, a, b, lines, unitName, scripted("y"), noIo);
    expect(result).not.toBe("quit");
    if (result !== "quit") {
      expect(result.answer).toBe("yes");
      expect(result.counters).toBeUndefined();
      expect(result.itemId).toBe(item.itemId);
    }
  });

  it("asks a follow-up per counter-test for a disagreement, and records each answer", async () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "disagreement")! as RatingItem & { kind: "disagreement" };
    const answers = ["y", ...item.counterIds.map(() => "n")];
    const result = await answerItem(item, a, b, lines, unitName, scripted(...answers), noIo);
    expect(result).not.toBe("quit");
    if (result !== "quit") {
      expect(result.answer).toBe("yes");
      expect(Object.keys(result.counters ?? {})).toHaveLength(item.counterIds.length);
      for (const counterId of item.counterIds) expect(result.counters?.[counterId]).toBe("no");
    }
  });

  it("resolves a drift item's disagreement the same way as the item it repeats", async () => {
    const original = ratingPlan(a, b, 1).find((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement")!;
    const drift: RatingItem = { kind: "drift", itemId: "drift:test", of: original.itemId };
    const result = await answerItem(drift, a, b, lines, unitName, scripted("y", ...original.counterIds.map(() => "y")), noIo);
    expect(result).not.toBe("quit");
    if (result !== "quit") expect(Object.keys(result.counters ?? {})).toHaveLength(original.counterIds.length);
  });

  it("quits without recording anything the moment the owner does", async () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    expect(await answerItem(item, a, b, lines, unitName, scripted("q"), noIo)).toBe("quit");
  });

  it("quits mid-way through a disagreement's counters, discarding that item's progress", async () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "disagreement")! as RatingItem & { kind: "disagreement" };
    expect(await answerItem(item, a, b, lines, unitName, scripted("y", "q"), noIo)).toBe("quit");
  });

  it("prints only through the injected io, never a real console", async () => {
    const logged: string[] = [];
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    await answerItem(item, a, b, lines, unitName, scripted("y"), { log: (l) => logged.push(l) });
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe("runRating", () => {
  it("saves every answer as it's given, not just at the end", async () => {
    const reasons = ratingPlan(a, b, 1).filter((i) => i.kind === "reason").slice(0, 3);
    const start: Ratings = { items: reasons, answers: [] };
    const dir = mkdtempSync(join(tmpdir(), "runrating-"));
    const path = join(dir, "ratings.json");
    let calls = 0;
    const rl: Prompter = {
      question: async () => {
        // By the time question() is asked for the Nth item, the previous N answers must
        // already be on disk: proof it saves as it goes, not once at the very end.
        if (calls > 0) {
          const onDisk = JSON.parse(await readFile(path, "utf8")) as Ratings;
          expect(onDisk.answers).toHaveLength(calls);
        }
        calls++;
        return "y";
      },
    };
    const result = await runRating(a, b, lines, unitName, start, path, rl, noIo);
    expect(result.answers).toHaveLength(3);
    const onDisk = JSON.parse(await readFile(path, "utf8")) as Ratings;
    expect(onDisk.answers).toHaveLength(3);
  });

  it("resumes at the first unanswered item and never asks an answered one again", async () => {
    const reasons = ratingPlan(a, b, 1).filter((i) => i.kind === "reason").slice(0, 3);
    const start: Ratings = { items: reasons, answers: [] };
    const dir = mkdtempSync(join(tmpdir(), "runrating-"));
    const path = join(dir, "ratings.json");

    // The first run answers just the first item, then quits, saving that much to disk.
    let firstCalls = 0;
    const firstRl: Prompter = {
      question: async () => {
        firstCalls++;
        return firstCalls === 1 ? "y" : "q";
      },
    };
    const afterFirstRun = await runRating(a, b, lines, unitName, start, path, firstRl, noIo);
    expect(afterFirstRun.answers).toHaveLength(1);

    // The second run starts from what the first run actually wrote to disk, not from a
    // hand-built object that only claims to be the same.
    const onDiskAfterFirstRun = JSON.parse(await readFile(path, "utf8")) as Ratings;
    let secondCalls = 0;
    const secondRl: Prompter = {
      question: async () => {
        secondCalls++;
        return "y";
      },
    };
    const result = await runRating(a, b, lines, unitName, onDiskAfterFirstRun, path, secondRl, noIo);
    expect(secondCalls).toBe(2); // only the 2 remaining items were ever asked
    expect(result.answers.map((x) => x.itemId)).toEqual(reasons.map((r) => r.itemId));
  });

  it("q saves what's already answered and stops before the rest", async () => {
    const reasons = ratingPlan(a, b, 1).filter((i) => i.kind === "reason").slice(0, 3);
    const start: Ratings = { items: reasons, answers: [] };
    const dir = mkdtempSync(join(tmpdir(), "runrating-"));
    const path = join(dir, "ratings.json");
    let call = 0;
    const rl: Prompter = {
      question: async () => {
        call++;
        return call === 2 ? "q" : "y";
      },
    };
    const result = await runRating(a, b, lines, unitName, start, path, rl, noIo);
    expect(result.answers).toHaveLength(1);
    const onDisk = JSON.parse(await readFile(path, "utf8")) as Ratings;
    expect(onDisk.answers).toHaveLength(1);
  });

  it("says there's nothing left, through io, once everything's already answered", async () => {
    const reasons = ratingPlan(a, b, 1).filter((i) => i.kind === "reason").slice(0, 1);
    const start: Ratings = { items: reasons, answers: [{ itemId: reasons[0]!.itemId, answer: "yes", at: "t" }] };
    const dir = mkdtempSync(join(tmpdir(), "runrating-"));
    const path = join(dir, "ratings.json");
    const logged: string[] = [];
    const result = await runRating(a, b, lines, unitName, start, path, scripted(), { log: (l) => logged.push(l) });
    expect(result).toEqual(start);
    expect(logged.some((l) => l.includes("nothing left"))).toBe(true);
  });

  it("prints only through the injected io, never a real console", async () => {
    const reasons = ratingPlan(a, b, 1).filter((i) => i.kind === "reason").slice(0, 1);
    const start: Ratings = { items: reasons, answers: [] };
    const dir = mkdtempSync(join(tmpdir(), "runrating-"));
    const path = join(dir, "ratings.json");
    const logged: string[] = [];
    await runRating(a, b, lines, unitName, start, path, scripted("y"), { log: (l) => logged.push(l) });
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe("ratings.json shape", () => {
  it("never holds a reason's own text, only ids and answers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ratings-"));
    const path = join(dir, "ratings.json");
    const plan = ratingPlan(a, b, 1);
    const ratings: Ratings = {
      items: plan,
      answers: [{ itemId: plan[0]!.itemId, answer: "yes", at: "2026-09-26T00:00:00.000Z" }],
    };
    await writeFile(path, JSON.stringify(ratings, null, 2));
    const raw = await readFile(path, "utf8");
    for (const c of a.candidates) {
      expect(raw).not.toContain(c.candidate.claim.en);
      expect(raw).not.toContain(c.candidate.premise.en);
      expect(raw).not.toContain(c.candidate.link.en);
    }
    expect(raw).toContain(plan[0]!.itemId); // ids are kept, just never a reason's own words
  });
});
