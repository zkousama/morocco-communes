import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { detect } from "../src/detect.ts";
import { familyOf } from "../src/fields.ts";
import { makeRunner, stubTransport, type ModelCall } from "../src/model.ts";
import { aboutThisFinding, pipeline, publishable, publishIfAllowed, readBaseline, summary } from "../src/run.ts";
import type { Metrics } from "../src/score.ts";
import type { Check } from "../src/vocabulary.ts";

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

  it("names the run, and says when it covered only some findings", async () => {
    const limited = await pipeline(data, { limit: 1, run: runner(), falsifier: runner(), proposer: "sonnet", falsifierModel: "opus" });
    const only = await pipeline(data, { only: [limited.items[0]!.finding.code], run: runner(), falsifier: runner(), proposer: "sonnet", falsifierModel: "opus" });
    expect(limited.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(only.runId).not.toBe(limited.runId);
    expect(limited.partial).toBe(true);
    expect(only.partial).toBe(true);
  });

  it("keeps which model answered each proposal and each argument", async () => {
    // A transport that answers under ids of its own, as claude -p does for an alias.
    const answeredAs = (id: string) => makeRunner(async (call) => ({ text: answers(call), model: id }), {
      cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" },
    });
    const file = await pipeline(data, { limit: 3, run: answeredAs("proposer-id"), falsifier: answeredAs("adversary-id"), proposer: "sonnet", falsifierModel: "opus" });
    expect(file.models).toEqual({ propose: "sonnet", falsify: "opus", answered: ["adversary-id", "proposer-id"] });

    const item = file.items.find((i) => i.hypotheses.length > 0)!;
    expect(item.replies).toHaveLength(5);
    expect(item.replies[0]).toEqual({ model: "proposer-id", promptHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const argued = item.hypotheses.find((h) => h.stage === "published")!;
    expect(argued.adversary).toEqual({ model: "adversary-id", reason: "none" });
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
const STAGE_TEST_FIELDS = [CHECK_FAILS_FIELD, "commute.privateCar", "occupancy.tenant", "education.higher", "labour.activityRate"];

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
    // The link test has to be about the finding: its outcome is finding.measure at
    // finding.level, and its premise a field d's own data test reads. The real rank
    // correlation between education.higher and this finding's own measure is positive;
    // claiming "negative" makes judgeLinks reject it outright, regardless of significance
    // or its placebos.
    hyp("d link not consistent", alwaysTrue("education.higher"), {
      link: "together", x: "education.higher", y: finding.measure, year: 2024, level: finding.level, direction: "negative",
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

describe("an adversary that doesn't answer", () => {
  const finding = pickIsolatedFinding(STAGE_TEST_FIELDS);
  const proposal = JSON.stringify({ hypotheses: STAGE_TEST_FIELDS.slice(1).map((field) => hyp(field, alwaysTrue(field))) });
  const cache = () => ({ cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });
  const proposer = () => makeRunner(stubTransport(() => proposal), cache());

  it("stops that hypothesis at falsify, and the rest go on", async () => {
    const falsifier = makeRunner(async (call) => {
      if (call.key.includes('"labour.activityRate"')) throw new Error("claude exited 1: overloaded");
      return { text: JSON.stringify({ counter: null, reason: "no counter" }), model: "adversary-id" };
    }, cache());
    const file = await pipeline(data, { only: [finding.code], run: proposer(), falsifier, proposer: "sonnet", falsifierModel: "opus" });
    const byClaim = new Map(file.items[0]!.hypotheses.map((h) => [h.claim.en, h]));

    expect(byClaim.get("labour.activityRate")).toMatchObject({ stage: "falsify", reason: "the adversary didn't answer", adversary: null });
    expect(byClaim.get("education.higher")).toMatchObject({ stage: "published", reason: null, adversary: { model: "adversary-id", reason: "no counter" } });
    expect(file.stopped).toBeNull();
    expect(file.models.answered).not.toContain("opus");
    expect(summary(file)).toContain("adversary failures: 1");
  });

  it("stops the run after 3 failures in a row, and says why", async () => {
    let calls = 0;
    const falsifier = makeRunner(async () => {
      calls++;
      throw new Error("claude exited 1: usage limit reached");
    }, cache());
    const file = await pipeline(data, { only: [finding.code], run: proposer(), falsifier, proposer: "sonnet", falsifierModel: "opus" });

    expect(calls).toBe(3);
    expect(file.partial).toBe(true);
    expect(file.stopped).toMatch(/^3 adversary calls in a row failed.*usage limit reached/);
    expect(file.items.at(-1)!.skipped).toMatch(/^the run stopped/);
    expect(summary(file).join("\n")).toMatch(/stopped early: 3 adversary calls/);
  });

  it("stops the run after 3 proposer calls in a row fail, before the next finding", async () => {
    let calls = 0;
    const failing = makeRunner(async () => {
      calls++;
      throw new Error("claude exited 1: usage limit reached");
    }, cache());
    const file = await pipeline(data, { limit: 3, run: failing, falsifier: proposer(), proposer: "sonnet", falsifierModel: "opus" });

    expect(calls).toBe(3);
    expect(file.stopped).toMatch(/^3 proposer calls in a row failed/);
    expect(file.items.length).toBeLessThan(3);
    expect(file.items.at(-1)!.skipped).toMatch(/^the run stopped/);
  });
});

describe("a link test that isn't about the finding", () => {
  const finding = pickIsolatedFinding(STAGE_TEST_FIELDS);
  const stubbed = (proposal: string) => {
    const answers = (call: ModelCall) => (call.stage === "propose" ? proposal : JSON.stringify({ counter: null, reason: "no counter" }));
    return () => makeRunner(stubTransport(answers), { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });
  };

  it("is refused before it runs and recorded as refused, so the hypothesis is published with its link untested", async () => {
    // education.higher and fertility.totalFertilityRate are unrelated to this finding's own
    // measure: neither is what a link test's outcome would have to be for it to be about
    // this figure, so it should never reach judgeLinks or come back "consistent".
    const unrelated = JSON.stringify({
      hypotheses: [
        hyp("unrelated link", alwaysTrue("labour.activityRate"), {
          link: "together", x: "education.higher", y: "fertility.totalFertilityRate", year: 2024, level: finding.level, direction: "positive",
        }),
      ],
    });
    const r = stubbed(unrelated);

    const file = await pipeline(data, { only: [finding.code], run: r(), falsifier: r(), proposer: "sonnet", falsifierModel: "opus" });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const published = item.hypotheses.find((h) => h.claim.en === "unrelated link")!;

    expect(published.stage).toBe("published");
    expect(published.linkTest).toMatchObject({ verdict: "refused", reason: "not about this figure", x: "education.higher" });
  });

  it("refuses a figure paired with itself, even when its data test passed", async () => {
    // Plain households.peoplePerRoom against itself correlates at exactly 1.
    const all = detect(data);
    const target = all.find((f) => f.kind === "extreme" && f.measure === "households.peoplePerRoom")!;
    const itself = JSON.stringify({
      hypotheses: [
        hyp("itself", alwaysTrue("labour.activityRate"), {
          link: "together", x: target.measure, y: target.measure, year: 2024, level: target.level, direction: "positive",
        }),
      ],
    });
    const r = stubbed(itself);

    const file = await pipeline(data, { only: [target.code], run: r(), falsifier: r(), proposer: "sonnet", falsifierModel: "opus" });
    const item = file.items.find((i) => i.finding.id === target.id)!;
    const h = item.hypotheses.find((x) => x.claim.en === "itself")!;
    expect(h.linkTest).toMatchObject({ verdict: "refused", reason: "not about this figure" });
  });

  it("still runs a link whose premise is the field the data test read", async () => {
    const related = JSON.stringify({
      hypotheses: [
        hyp("related link", alwaysTrue("education.higher"), {
          link: "together", x: "education.higher", y: finding.measure, year: 2024, level: finding.level, direction: "positive",
        }),
      ],
    });
    const r = stubbed(related);

    const file = await pipeline(data, { only: [finding.code], run: r(), falsifier: r(), proposer: "sonnet", falsifierModel: "opus" });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const h = item.hypotheses.find((x) => x.claim.en === "related link")!;
    expect(h.linkTest?.verdict).not.toBe("refused");
    expect(h.linkTest?.placeboEffects).toHaveLength(3);
    expect(h.linkTest?.reason).toBeUndefined();
  });
});

describe("what makes a link test about its figure", () => {
  const base = { id: "t", code: "01.511.01.0", level: "commune", value: 30, reference: 10, score: 4, direction: "high" } as const;
  const unoccupied = { ...base, measure: "housing.occupancy.unoccupied", kind: "extreme" } as const;
  const crowding = { ...base, measure: "households.peoplePerRoom", kind: "extreme" } as const;
  const reads = (field: string): Check => ({ check: "compare", left: { of: { unit: "self" }, field, year: 2024 }, op: ">", right: { value: 0 } });

  it("refuses the 3 pairings the review found consistent", () => {
    expect(aboutThisFinding(
      { link: "together", x: crowding.measure, y: crowding.measure, year: 2024, level: "commune", direction: "positive" },
      reads(crowding.measure), crowding,
    )).toBe(false);
    expect(aboutThisFinding(
      { link: "together", x: "housing.occupancy.seasonal", y: unoccupied.measure, year: 2024, level: "commune", direction: "positive" },
      reads("housing.occupancy.seasonal"), unoccupied,
    )).toBe(false);
    expect(aboutThisFinding(
      { link: "peers", premise: "housing.occupancy.vacant", outcome: unoccupied.measure, level: "commune", direction: "higher" },
      reads("housing.occupancy.vacant"), unoccupied,
    )).toBe(false);
  });

  it("refuses a premise the data test doesn't read", () => {
    const test = { link: "together", x: "education.higher", y: crowding.measure, year: 2024, level: "commune", direction: "negative" } as const;
    expect(aboutThisFinding(test, reads("labour.activityRate"), crowding)).toBe(false);
    expect(aboutThisFinding(test, reads("education.higher"), crowding)).toBe(true);
  });

  it("reads both sides of a comparison as fields the data test reads", () => {
    const test = { link: "together", x: "education.higher", y: crowding.measure, year: 2024, level: "commune", direction: "negative" } as const;
    const both: Check = { check: "compare", left: { of: { unit: "self" }, field: "labour.activityRate", year: 2024 }, op: ">", right: { of: { unit: "country" }, field: "education.higher", year: 2024 } };
    expect(aboutThisFinding(test, both, crowding)).toBe(true);
  });

  it("refuses another outcome, or another level", () => {
    const test = { link: "together", x: "education.higher", y: "fertility.totalFertilityRate", year: 2024, level: "commune", direction: "negative" } as const;
    expect(aboutThisFinding(test, reads("education.higher"), crowding)).toBe(false);
    expect(aboutThisFinding({ ...test, y: crowding.measure, level: "province" }, reads("education.higher"), crowding)).toBe(false);
  });

  it("asks a change finding's together test to pair changes", () => {
    const moved = { ...crowding, kind: "change" } as const;
    const test = { link: "together", x: "education.higher", y: moved.measure, year: 2024, level: "commune", direction: "negative" } as const;
    expect(aboutThisFinding(test, reads("education.higher"), moved)).toBe(false);
    expect(aboutThisFinding({ ...test, year: "change" }, reads("education.higher"), moved)).toBe(true);
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

  it("leaves the adversary's model and its words out of the published files", async () => {
    const file = await pipeline(data, { only: [finding.code], run: survivorRunner(), falsifier: survivorRunner(), proposer: "sonnet", falsifierModel: "opus" });
    expect(file.items.find((i) => i.finding.id === finding.id)!.hypotheses[0]!.adversary).not.toBeNull();

    const [, body] = [...publishable(file, data)].find(([path]) => path.endsWith(`/${finding.code}.json`))!;
    for (const f of (body as { findings: { hypotheses: object[] }[] }).findings) {
      for (const h of f.hypotheses) expect(h).not.toHaveProperty("adversary");
    }
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

describe("publishing", () => {
  const passing: Metrics = {
    runId: "run-a", measuredAt: "", published: { yes: 47, graded: 50, low: 0, high: 0, lowOneSided: 0 },
    rejectedButSound: { count: 0, byStage: {} }, agreement: null,
    planted: { total: 100, caught: 95, byKind: {} },
  };
  const run = { runId: "run-a", partial: false };
  const place = () => {
    const root = mkdtempSync(join(tmpdir(), "pub-"));
    return { outDir: join(root, "insights"), publishedPath: join(root, "published.json") };
  };

  it("never writes without a graded set, and leaves what's there alone", async () => {
    const { outDir, publishedPath } = place();
    const result = await publishIfAllowed({ outDir, publishedPath, run, metrics: null, baseline: null, files: new Map([["index.json", []]]) });
    expect(result.written).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(existsSync(join(outDir, "index.json"))).toBe(false);
    expect(existsSync(publishedPath)).toBe(false);
  });

  it("replaces the published files when the guard passes, keeping the README", async () => {
    const { outDir, publishedPath } = place();
    await publishIfAllowed({ outDir, publishedPath, run, metrics: passing, baseline: null, files: new Map([["communes/old.json", {}]]) });
    writeFileSync(join(outDir, "README.md"), "readme");
    const result = await publishIfAllowed({ outDir, publishedPath, run, metrics: passing, baseline: null, files: new Map([["index.json", []]]) });
    expect(result.written).toBe(true);
    expect(existsSync(join(outDir, "communes", "old.json"))).toBe(false);
    expect(readFileSync(join(outDir, "README.md"), "utf8")).toBe("readme");
  });

  it("refuses grades made on another run", async () => {
    const { outDir, publishedPath } = place();
    const result = await publishIfAllowed({ outDir, publishedPath, run: { runId: "run-b", partial: false }, metrics: passing, baseline: null, files: new Map([["index.json", []]]) });
    expect(result.written).toBe(false);
    expect(result.reasons.join("\n")).toMatch(/run-a/);
    expect(result.reasons.join("\n")).toMatch(/run-b/);
    expect(existsSync(join(outDir, "index.json"))).toBe(false);
  });

  it("refuses a run that covered only some findings", async () => {
    const { outDir, publishedPath } = place();
    const result = await publishIfAllowed({ outDir, publishedPath, run: { runId: "run-a", partial: true }, metrics: passing, baseline: null, files: new Map([["index.json", []]]) });
    expect(result.written).toBe(false);
    expect(result.reasons.join("\n")).toMatch(/--limit or --only/);
  });

  it("refuses a run that stopped early, and says why it stopped", async () => {
    const { outDir, publishedPath } = place();
    const stopped = { runId: "run-a", partial: true, stopped: "3 adversary calls in a row failed, the last with: usage limit reached" };
    const result = await publishIfAllowed({ outDir, publishedPath, run: stopped, metrics: passing, baseline: null, files: new Map([["index.json", []]]) });
    expect(result.written).toBe(false);
    expect(result.reasons.join("\n")).toMatch(/stopped early.*usage limit reached/);
  });

  it("records the run it published and the numbers it passed with", async () => {
    const { outDir, publishedPath } = place();
    await publishIfAllowed({ outDir, publishedPath, run, metrics: passing, baseline: null, files: new Map([["index.json", []]]) });
    const record = JSON.parse(readFileSync(publishedPath, "utf8"));
    expect(record.runId).toBe("run-a");
    expect(record.metrics).toEqual(passing);
  });

  it("takes its baseline from the last publish, and has none before the first", async () => {
    const { outDir, publishedPath } = place();
    expect(await readBaseline(publishedPath)).toBeNull();

    await publishIfAllowed({ outDir, publishedPath, run, metrics: passing, baseline: null, files: new Map([["index.json", []]]) });
    const baseline = await readBaseline(publishedPath);
    expect(baseline).toEqual(passing);

    const worse: Metrics = { ...passing, runId: "run-b", planted: { total: 100, caught: 80, byKind: {} } };
    const result = await publishIfAllowed({ outDir, publishedPath, run: { runId: "run-b", partial: false }, metrics: worse, baseline, files: new Map([["index.json", []]]) });
    expect(result.written).toBe(false);
    expect(JSON.parse(readFileSync(publishedPath, "utf8")).runId).toBe("run-a");
  });
});
