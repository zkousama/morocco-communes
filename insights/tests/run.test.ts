import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { detect } from "../src/detect.ts";
import { familyOf } from "../src/fields.ts";
import { makeRunner, stubTransport, type ModelCall } from "../src/model.ts";
import { pipeline, publishable } from "../src/run.ts";

const data = loadData();
const proposal = JSON.stringify({ hypotheses: [{
  claim: { en: "claim", fr: "affirmation" }, link: { en: "link", fr: "lien" }, premise: { en: "premise", fr: "prémisse" },
  test: { check: "change", of: { unit: "parent" }, field: "labour.activityRate", op: "<", value: 100 },
  linkTest: null, artefact: false,
}] });
const answers = (call: { stage: string }) => call.stage === "propose" ? proposal : JSON.stringify({ counter: null, reason: "none" });
const runner = () => makeRunner(stubTransport(answers), { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });

describe("the pipeline", () => {
  it("runs end to end on a few findings with stubbed models", async () => {
    const file = await pipeline(data, { limit: 3, run: runner(), falsifier: runner(), proposer: "sonnet", falsifierModel: "opus" });
    expect(file.items).toHaveLength(3);
    for (const item of file.items) expect(item.line.en.length).toBeGreaterThan(0);
  });

  it("publishes only survivors, one file per unit, with its evidence", async () => {
    const file = await pipeline(data, { limit: 3, run: runner(), falsifier: runner(), proposer: "sonnet", falsifierModel: "opus" });
    const files = publishable(file);
    for (const [path, body] of files) {
      expect(path).toMatch(/^(regions|provinces|communes|arrondissements)\/[0-9.]+\.json$|^index\.json$/);
      for (const item of (body as { findings?: { hypotheses: { stage: string }[] }[] }).findings ?? []) {
        for (const h of item.hypotheses) expect(h.stage).toBe("published");
      }
    }
  });
});

/** A `compare` check that's always true or always false for a real 2024 percent field. */
const alwaysTrue = (field: string) => ({ check: "compare", left: { of: { unit: "self" }, field, year: 2024 }, op: ">", right: { value: -1000 } });
const alwaysFalse = (field: string) => ({ check: "compare", left: { of: { unit: "self" }, field, year: 2024 }, op: "<", right: { value: -1000 } });
const hyp = (claim: string, test: unknown, linkTest: unknown = null) => ({
  claim: { en: claim, fr: claim }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" }, test, linkTest, artefact: false,
});

/** The only field this test uses whose data test won't pass. */
const CHECK_FAILS_FIELD = "labour.unemploymentRate";
/** Fields used by the stage-branching test: it must not sit in the same family as any of them, or its own field. */
const STAGE_TEST_FIELDS = [CHECK_FAILS_FIELD, "commute.privateCar", "occupancy.tenant", "disability.prevalence", "labour.activityRate"];

function pickIsolatedFinding(usedFields: string[]) {
  const codeCounts = new Map<string, number>();
  const all = detect(data);
  for (const f of all) codeCounts.set(f.code, (codeCounts.get(f.code) ?? 0) + 1);
  const found = all.find(
    (f) => f.kind !== "artefact" && codeCounts.get(f.code) === 1 && !usedFields.some((x) => familyOf(f.measure).has(x)),
  );
  if (!found) throw new Error("no finding isolated enough for this fixture");
  return found;
}

describe("where a hypothesis stops", () => {
  const finding = pickIsolatedFinding(STAGE_TEST_FIELDS);

  // b's own data test is reused as its falsify counter-test, so the counter is
  // guaranteed to come out true (the same figure, the same comparison) and falsify it for
  // real, rather than for a refusal.
  const stageHypotheses = [
    hyp("a check fails", alwaysFalse(CHECK_FAILS_FIELD)),
    hyp("b falsify holds", alwaysTrue("commute.privateCar")),
    hyp("c safety kill", alwaysTrue("occupancy.tenant")),
    // The real rank correlation between these two is negative; claiming "positive" makes
    // judgeLinks reject it outright, regardless of significance or its placebos.
    hyp("d link not consistent", alwaysTrue("disability.prevalence"), {
      link: "together", x: "education.higher", y: "fertility.totalFertilityRate", year: 2024, level: "commune", direction: "positive",
    }),
    hyp("e published", alwaysTrue("labour.activityRate")),
  ];
  const stageProposal = JSON.stringify({ hypotheses: stageHypotheses });

  const stageAnswers = (call: ModelCall) => {
    if (call.stage === "propose") return stageProposal;
    if (call.key.includes('"commute.privateCar"')) {
      return JSON.stringify({ counter: alwaysTrue("commute.privateCar"), reason: "true everywhere" });
    }
    if (call.key.includes('"occupancy.tenant"')) {
      return JSON.stringify({ counter: null, reason: "not arguable", refuse: "political" });
    }
    return JSON.stringify({ counter: null, reason: "no counter" });
  };
  const stageRunner = () => makeRunner(stubTransport(stageAnswers), { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });

  it("gives each hypothesis the stage where it stopped", async () => {
    const file = await pipeline(data, { only: [finding.code], run: stageRunner(), falsifier: stageRunner(), proposer: "sonnet", falsifierModel: "opus" });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const byClaim = new Map(item.hypotheses.map((h) => [h.claim.en, h]));

    expect(byClaim.get("a check fails")?.stage).toBe("check");
    expect(byClaim.get("b falsify holds")?.stage).toBe("falsify");
    expect(byClaim.get("c safety kill")?.stage).toBe("safety");
    expect(byClaim.get("c safety kill")?.reason).toBe("refused: political");
    expect(byClaim.get("d link not consistent")?.stage).toBe("link");
    expect(byClaim.get("e published")?.stage).toBe("published");
    expect(byClaim.get("e published")?.reason).toBeNull();
  });
});

describe("how many hypotheses a finding keeps", () => {
  const finding = pickIsolatedFinding(STAGE_TEST_FIELDS);
  // Sample i proposes the first (5 - i) fields, so across the 5 samples each field gets a
  // different support: 5, 4, 3, 2, 1.
  const survivorSamples = [5, 4, 3, 2, 1].map((n) =>
    JSON.stringify({ hypotheses: STAGE_TEST_FIELDS.slice(0, n).map((field) => hyp(field, alwaysTrue(field))) }),
  );
  const survivorAnswers = (call: ModelCall) => {
    if (call.stage === "propose") return survivorSamples[Number(call.key.slice(call.key.lastIndexOf(":") + 1))]!;
    return JSON.stringify({ counter: null, reason: "no counter" });
  };
  const survivorRunner = () => makeRunner(stubTransport(survivorAnswers), { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });

  it("keeps every survivor in the run file, but publishable shows only the top 3 by support", async () => {
    const file = await pipeline(data, { only: [finding.code], run: survivorRunner(), falsifier: survivorRunner(), proposer: "sonnet", falsifierModel: "opus" });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const published = item.hypotheses.filter((h) => h.stage === "published");
    expect(published.map((h) => h.support)).toEqual([5, 4, 3, 2, 1]);

    const files = publishable(file, data);
    const [, body] = [...files].find(([path]) => path.endsWith(`/${finding.code}.json`))!;
    const findingEntry = (body as { findings: { id: string; hypotheses: { support: number }[] }[] }).findings.find((f) => f.id === finding.id)!;
    expect(findingEntry.hypotheses.map((h) => h.support)).toEqual([5, 4, 3]);
  });
});

describe("a call that fails in a way nothing anticipated", () => {
  it("still lets the run complete, with the finding skipped", async () => {
    const finding = pickIsolatedFinding([]);
    const throwing = async (): Promise<{ text: string; model: string }> => {
      throw { weird: "not an Error instance" };
    };
    const brokenRunner = () => makeRunner(throwing, { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });

    const file = await pipeline(data, { only: [finding.code], run: brokenRunner(), falsifier: brokenRunner(), proposer: "sonnet", falsifierModel: "opus" });

    expect(file.items).toHaveLength(1);
    expect(file.items[0]!.hypotheses).toEqual([]);
    expect(file.items[0]!.skipped).toBeTruthy();
  });
});
