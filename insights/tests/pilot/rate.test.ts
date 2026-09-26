import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refusal } from "../../src/safety.ts";
import { answerItem, readStageFiles, ratingPlan, remainingItems, screen, type Ratings, type RatingItem } from "../../src/pilot/rate.ts";
import { ADVERSARIES, PROPOSERS } from "../../src/pilot/setups.ts";
import { fakeStageA, fakeStageB } from "./fixtures.ts";

const a = fakeStageA();
const b = fakeStageB(a);

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
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.length).toBeLessThanOrEqual(60);
  });
  it("caps disagreements at 40", () => {
    const disagreements = plan.filter((i) => i.kind === "disagreement");
    expect(disagreements.length).toBeLessThanOrEqual(40);
    expect(disagreements.length).toBeGreaterThan(0);
  });
  it("gives every disagreement at least one counter, deduplicated by signature", () => {
    for (const item of plan) {
      if (item.kind !== "disagreement") continue;
      expect(item.counterIds.length).toBeGreaterThan(0);
      expect(new Set(item.counterIds).size).toBe(item.counterIds.length);
    }
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
});

describe("the screen", () => {
  it("never names a setup, a model, an effort or a verdict", () => {
    for (const item of ratingPlan(a, b, 1).slice(0, 30)) {
      const text = screen(item, a, b);
      for (const word of [...PROPOSERS, ...ADVERSARIES].flatMap((r) => [r.id, r.model]).concat(["medium", "high", "survived", "published", "falsify", "safety"])) {
        expect(text.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });
  it("shows the French too", () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    const c = a.candidates.find((x) => x.candidateId === (item as { candidateId: string }).candidateId)!;
    expect(screen(item, a, b)).toContain(c.candidate.claim.fr);
  });
  it("shows a disagreement's own reason, same as a plain reason would", () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "disagreement")!;
    const c = a.candidates.find((x) => x.candidateId === (item as { candidateId: string }).candidateId)!;
    expect(screen(item, a, b)).toContain(c.candidate.claim.en);
    expect(screen(item, a, b)).toContain(c.candidate.premise.en);
    expect(screen(item, a, b)).toContain(c.candidate.link.en);
  });
  it("shows a drift item exactly as it showed the item it repeats, blind to which one that was", () => {
    const plan = ratingPlan(a, b, 1);
    const drift = plan.find((i) => i.kind === "drift")! as RatingItem & { kind: "drift" };
    const original = plan.find((i) => i.itemId === drift.of)!;
    expect(screen(drift, a, b)).toBe(screen(original, a, b));
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

/** A scripted stub `Prompter`: hands back the next queued answer on each call, so a test can drive `answerItem` without a real terminal. */
function scripted(...answers: string[]): { question: (prompt: string) => Promise<string> } {
  let i = 0;
  return { question: async () => answers[i++] ?? "q" };
}

describe("answerItem", () => {
  it("records a plain reason with just the main answer, no counters", async () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    const result = await answerItem(item, a, b, scripted("y"));
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
    const result = await answerItem(item, a, b, scripted(...answers));
    expect(result).not.toBe("quit");
    if (result !== "quit") {
      expect(result.answer).toBe("yes");
      expect(Object.keys(result.counters ?? {})).toHaveLength(item.counterIds.length);
      for (const counterId of item.counterIds) expect(result.counters?.[counterId]).toBe("no");
    }
  });

  it("resolves a drift item's disagreement the same way as the item it repeats", async () => {
    const plan = ratingPlan(a, b, 1);
    const drift = plan.find((i) => i.kind === "drift" && parseOf(plan, i) === "disagreement") as (RatingItem & { kind: "drift" }) | undefined;
    if (!drift) return; // no disagreement happened to be drawn for drift with this seed: nothing to check
    const original = plan.find((i) => i.itemId === drift.of)! as RatingItem & { kind: "disagreement" };
    const result = await answerItem(drift, a, b, scripted("y", ...original.counterIds.map(() => "y")));
    expect(result).not.toBe("quit");
    if (result !== "quit") expect(Object.keys(result.counters ?? {})).toHaveLength(original.counterIds.length);
  });

  it("quits without recording anything the moment the owner does", async () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "reason")!;
    expect(await answerItem(item, a, b, scripted("q"))).toBe("quit");
  });

  it("quits mid-way through a disagreement's counters, discarding that item's progress", async () => {
    const item = ratingPlan(a, b, 1).find((i) => i.kind === "disagreement")! as RatingItem & { kind: "disagreement" };
    expect(await answerItem(item, a, b, scripted("y", "q"))).toBe("quit");
  });
});

/** Whichever of "reason" or "disagreement" a plan item resolves to, for the drift test above. */
function parseOf(plan: RatingItem[], item: RatingItem): "reason" | "disagreement" | null {
  if (item.kind !== "drift") return null;
  const original = plan.find((i) => i.itemId === item.of);
  return original ? (original.kind === "drift" ? null : original.kind) : null;
}

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
