import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BREAKS_QUESTION, CHECKLIST_GUIDE, QUESTIONS } from "../../src/pilot/checklist.ts";
import { ratingPlan, type Prompter, type RatingIO, type RatingItem, type UnitNamer } from "../../src/pilot/rate.ts";
import { ADVERSARIES, PILOT_SEED, PROPOSERS, SPOT_CHECK_ITEMS } from "../../src/pilot/setups.ts";
import { runSpotCheck, spotItems, spotRemaining, unansweredSpotItems, type SpotCheck } from "../../src/pilot/spot.ts";
import { fakeStageA, fakeStageB } from "./fixtures.ts";

const a = fakeStageA();
const b = fakeStageB(a);
const plan = ratingPlan(a, b, PILOT_SEED);
const lines = new Map(a.findingIds.map((id) => [id, { en: `line ${id}`, fr: `ligne ${id} fr` }]));
const unitName: UnitNamer = (code) => `unit ${code}`;
const noIo: RatingIO = { log: () => {} };

/** A spot-check over `items` alone, nothing answered yet. */
const fresh = (items: RatingItem[]): SpotCheck => ({ items: items.map((i) => i.itemId), answers: [] });

/** Answers "y" to everything, or whatever `pick` says for a prompt. */
const answering = (pick: (prompt: string) => string = () => "y"): Prompter => ({ question: async (prompt) => pick(prompt) });

const tmpPath = () => join(mkdtempSync(join(tmpdir(), "spot-")), "spot.json");

describe("the spot-check's sample", () => {
  const items = spotItems(plan);

  it("draws 20 items from the reasons and disagreements, never a drift item", () => {
    expect(SPOT_CHECK_ITEMS).toBe(20);
    expect(items).toHaveLength(SPOT_CHECK_ITEMS);
    expect(new Set(items.map((i) => i.itemId)).size).toBe(SPOT_CHECK_ITEMS);
    const ids = new Set(plan.map((i) => i.itemId));
    for (const item of items) {
      expect(item.kind).not.toBe("drift");
      expect(ids.has(item.itemId)).toBe(true);
    }
  });

  it("is the same every time, whatever order the plan comes in, since it sorts by item id first", () => {
    expect(spotItems(plan)).toEqual(items);
    expect(spotItems([...plan].reverse())).toEqual(items);
  });

  it("follows the seed", () => {
    expect(spotItems(plan, PILOT_SEED + 1)).not.toEqual(items);
  });

  it("takes both kinds of item from the fixtures' plan", () => {
    expect(items.some((i) => i.kind === "reason")).toBe(true);
    expect(items.some((i) => i.kind === "disagreement")).toBe(true);
  });
});

describe("unansweredSpotItems", () => {
  const items = spotItems(plan);
  const answer = (itemId: string) => ({ itemId, claimBeyondPremise: "no" as const, linkExplainsFinding: "yes" as const, ignoresObviousAlternative: "no" as const });

  it("counts every sampled item with no answer, reading the sample off the plan rather than the file", () => {
    expect(unansweredSpotItems(null, plan)).toBe(SPOT_CHECK_ITEMS);
    expect(unansweredSpotItems({ items: [], answers: items.slice(0, 5).map((i) => answer(i.itemId)) }, plan)).toBe(SPOT_CHECK_ITEMS - 5);
    expect(unansweredSpotItems({ items: [], answers: items.map((i) => answer(i.itemId)) }, plan)).toBe(0);
  });

  it("never counts an answer to an item outside the sample", () => {
    const outside = plan.find((i) => !items.some((x) => x.itemId === i.itemId))!;
    expect(unansweredSpotItems({ items: [], answers: [answer(outside.itemId)] }, plan)).toBe(SPOT_CHECK_ITEMS);
  });
});

describe("the spot-check's screen", () => {
  const bannedWords = [...PROPOSERS, ...ADVERSARIES].flatMap((r) => [r.id, r.model]).concat(["medium", "high", "survived", "published", "falsify", "safety", "proposer", "adversary", "stage", "claude", "anthropic"]);

  it("prints the guide before the first item", async () => {
    const logged: string[] = [];
    await runSpotCheck(a, b, lines, unitName, plan, fresh(spotItems(plan).slice(0, 1)), tmpPath(), answering(), { log: (l) => logged.push(l) });
    expect(logged[0]).toBe(CHECKLIST_GUIDE);
    expect(logged.filter((l) => l === CHECKLIST_GUIDE)).toHaveLength(1);
  });

  it("prints the guide again on ?, then asks the same question again", async () => {
    const logged: string[] = [];
    const asked: string[] = [];
    let first = true;
    const rl: Prompter = {
      question: async (prompt) => {
        asked.push(prompt);
        if (first) {
          first = false;
          return "?";
        }
        return "y";
      },
    };
    await runSpotCheck(a, b, lines, unitName, plan, fresh(spotItems(plan).slice(0, 1)), tmpPath(), rl, { log: (l) => logged.push(l) });
    expect(logged.filter((l) => l === CHECKLIST_GUIDE)).toHaveLength(2);
    expect(asked[1]).toBe(asked[0]);
  });

  it("asks the 3 checks for a reason, and breaks for each counter-test with its meaning", async () => {
    const disagreement = spotItems(plan).find((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement")!;
    const asked: string[] = [];
    const result = await runSpotCheck(a, b, lines, unitName, plan, fresh([disagreement]), tmpPath(), answering((p) => (asked.push(p), "n")), noIo);
    expect(asked.slice(0, 3).map((p) => p.includes(QUESTIONS.claimBeyondPremise) || p.includes(QUESTIONS.linkExplainsFinding) || p.includes(QUESTIONS.ignoresObviousAlternative))).toEqual([true, true, true]);
    expect(asked.slice(3)).toHaveLength(disagreement.counterIds.length);
    for (const p of asked.slice(3)) expect(p).toContain(BREAKS_QUESTION);
    expect(result.answers[0]).toEqual({
      itemId: disagreement.itemId,
      claimBeyondPremise: "no",
      linkExplainsFinding: "no",
      ignoresObviousAlternative: "no",
      counters: Object.fromEntries(disagreement.counterIds.map((id) => [id, "no"])),
    });
  });

  it("reads y, n and u as yes, no and unsure, and asks again after anything else", async () => {
    const reason = spotItems(plan).find((i) => i.kind === "reason")!;
    const script = ["maybe", "y", "n", "u"];
    const logged: string[] = [];
    const result = await runSpotCheck(a, b, lines, unitName, plan, fresh([reason]), tmpPath(), answering(() => script.shift() ?? "q"), { log: (l) => logged.push(l) });
    expect(result.answers).toEqual([{ itemId: reason.itemId, claimBeyondPremise: "yes", linkExplainsFinding: "no", ignoresObviousAlternative: "unsure" }]);
    expect(logged.some((l) => l.includes("type y, n, u, ? or q"))).toBe(true);
  });

  it("never names a setup, a model, an effort, a run or a stage, across every item in the sample", async () => {
    const logged: string[] = [];
    await runSpotCheck(a, b, lines, unitName, plan, fresh(spotItems(plan)), tmpPath(), answering(), { log: (l) => logged.push(l) });
    const shown = logged.join("\n").toLowerCase();
    for (const word of bannedWords) expect(shown).not.toMatch(new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    // Every item's own reason is on screen, so the check above has something real to read.
    const first = a.candidates.find((c) => c.candidateId === (spotItems(plan)[0] as { candidateId: string }).candidateId)!;
    expect(shown).toContain(first.candidate.claim.en.toLowerCase());
  });
});

describe("runSpotCheck's saving", () => {
  it("saves every item's answers as soon as it's done, never just at the end", async () => {
    const items = spotItems(plan).filter((i) => i.kind === "reason").slice(0, 3);
    const path = tmpPath();
    let done = 0;
    const rl: Prompter = {
      question: async (prompt) => {
        if (prompt.includes(QUESTIONS.claimBeyondPremise) && done > 0) {
          const onDisk = JSON.parse(await readFile(path, "utf8")) as SpotCheck;
          expect(onDisk.answers).toHaveLength(done);
        }
        if (prompt.includes(QUESTIONS.claimBeyondPremise)) done++;
        return "y";
      },
    };
    const result = await runSpotCheck(a, b, lines, unitName, plan, fresh(items), path, rl, noIo);
    expect(result.answers).toHaveLength(3);
    expect((JSON.parse(await readFile(path, "utf8")) as SpotCheck).answers).toHaveLength(3);
  });

  it("writes ids and enums only, never a reason's own words", async () => {
    const items = spotItems(plan).slice(0, 4);
    const path = tmpPath();
    await runSpotCheck(a, b, lines, unitName, plan, fresh(items), path, answering(), noIo);
    const raw = await readFile(path, "utf8");
    for (const c of a.candidates) {
      expect(raw).not.toContain(c.candidate.claim.en);
      expect(raw).not.toContain(c.candidate.premise.en);
      expect(raw).not.toContain(c.candidate.link.en);
    }
    const parsed = JSON.parse(raw) as SpotCheck;
    expect(Object.keys(parsed).sort()).toEqual(["answers", "items"]);
    for (const answer of parsed.answers) {
      expect(Object.keys(answer).every((k) => ["itemId", "claimBeyondPremise", "linkExplainsFinding", "ignoresObviousAlternative", "counters"].includes(k))).toBe(true);
    }
  });

  it("q saves what's done and stops; quitting mid-item drops only that item", async () => {
    const items = spotItems(plan).filter((i) => i.kind === "reason").slice(0, 3);
    const path = tmpPath();
    const script = ["y", "y", "y", "y", "q"]; // the first item, then one answer into the second
    const result = await runSpotCheck(a, b, lines, unitName, plan, fresh(items), path, answering(() => script.shift() ?? "q"), noIo);
    expect(result.answers.map((x) => x.itemId)).toEqual([items[0]!.itemId]);
    expect((JSON.parse(await readFile(path, "utf8")) as SpotCheck).answers).toHaveLength(1);
  });

  it("resumes at the first unanswered item and never asks an answered one again", async () => {
    const items = spotItems(plan).filter((i) => i.kind === "reason").slice(0, 3);
    const path = tmpPath();
    const script = ["y", "y", "y", "q"];
    await runSpotCheck(a, b, lines, unitName, plan, fresh(items), path, answering(() => script.shift() ?? "q"), noIo);
    const onDisk = JSON.parse(await readFile(path, "utf8")) as SpotCheck;
    expect(spotRemaining(onDisk).map((id) => id)).toEqual(items.slice(1).map((i) => i.itemId));
    let asked = 0;
    const result = await runSpotCheck(a, b, lines, unitName, plan, onDisk, path, answering(() => (asked++, "n")), noIo);
    expect(asked).toBe(6); // 2 items left, 3 checks each
    expect(result.answers.map((x) => x.itemId)).toEqual(items.map((i) => i.itemId));
  });

  it("says there's nothing left once every item has an answer", async () => {
    const item = spotItems(plan).find((i) => i.kind === "reason")!;
    const start: SpotCheck = { items: [item.itemId], answers: [{ itemId: item.itemId, claimBeyondPremise: "no", linkExplainsFinding: "yes", ignoresObviousAlternative: "no" }] };
    const logged: string[] = [];
    const result = await runSpotCheck(a, b, lines, unitName, plan, start, tmpPath(), answering(), { log: (l) => logged.push(l) });
    expect(result).toEqual(start);
    expect(logged.some((l) => l.includes("nothing left"))).toBe(true);
  });
});
