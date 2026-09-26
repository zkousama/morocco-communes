import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { detect } from "../src/detect.ts";
import { familyOf } from "../src/fields.ts";
import { runLink } from "../src/links.ts";
import { hash, LimitError, makeRunner, NO_USAGE, stubTransport, type ModelCall, type Usage } from "../src/model.ts";
import { aboutThisFinding, localWarning, parseArgs, pipeline, publishable, publishIfAllowed, readBaseline, summary, type Item, type RunFile } from "../src/run.ts";
import { parseSetup } from "../src/setup.ts";
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
const testSetup = parseSetup({
  propose: { transport: "claude", model: "sonnet", effort: "high", samples: 5 },
  falsify: { transport: "claude", model: "opus", effort: "medium" },
  attackShownOnly: false, decidedBy: null,
});

describe("the pipeline", () => {
  it("runs end to end on a few findings with stubbed models", async () => {
    const file = await pipeline(data, { limit: 3, run: runner(), falsifier: runner(), setup: testSetup });
    expect(file.items).toHaveLength(3);
    for (const item of file.items) expect(item.line.en.length).toBeGreaterThan(0);
  });

  it("names the run, and says when it covered only some findings", async () => {
    const limited = await pipeline(data, { limit: 1, run: runner(), falsifier: runner(), setup: testSetup });
    const only = await pipeline(data, { only: [limited.items[0]!.finding.code], run: runner(), falsifier: runner(), setup: testSetup });
    expect(limited.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(only.runId).not.toBe(limited.runId);
    expect(limited.partial).toBe(true);
    expect(only.partial).toBe(true);
  });

  it("keeps which model answered each proposal and each argument", async () => {
    // A transport that answers under ids of its own, as claude -p does for an alias.
    const answeredAs = (id: string) => makeRunner(async (call) => ({ text: answers(call), model: id, usage: NO_USAGE }), {
      cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" },
    });
    const file = await pipeline(data, { limit: 3, run: answeredAs("proposer-id"), falsifier: answeredAs("adversary-id"), setup: testSetup });
    expect(file.models).toEqual({ propose: "sonnet", falsify: "opus", answered: ["adversary-id", "proposer-id"] });

    const item = file.items.find((i) => i.hypotheses.length > 0)!;
    expect(item.replies).toHaveLength(5);
    expect(item.replies[0]).toEqual({ model: "proposer-id", promptHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const argued = item.hypotheses.find((h) => h.stage === "published")!;
    expect(argued.adversary).toEqual({ model: "adversary-id", reason: "none" });
  });

  it("publishes only survivors, one file per unit, with its evidence", async () => {
    const file = await pipeline(data, { limit: 3, run: runner(), falsifier: runner(), setup: testSetup });
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

/** The first `n` findings that aren't artefacts, each the only one on its unit, so `only` with their codes picks out exactly them, in this order. */
function isolatedFindings(usedFields: string[], n: number) {
  const codeCounts = new Map<string, number>();
  const all = detect(data);
  for (const f of all) codeCounts.set(f.code, (codeCounts.get(f.code) ?? 0) + 1);
  const found = all
    .filter((f) => f.kind !== "artefact" && codeCounts.get(f.code) === 1 && !usedFields.some((x) => familyOf(f.measure).has(x)))
    .slice(0, n);
  if (found.length < n) throw new Error("too few findings isolated enough for this fixture");
  return found;
}

function pickIsolatedFinding(usedFields: string[]) {
  return isolatedFindings(usedFields, 1)[0]!;
}

describe("tokens and cost", () => {
  it("totals tokens and cost by stage and model", async () => {
    const finding = pickIsolatedFinding(STAGE_TEST_FIELDS);
    const usageProposal = JSON.stringify({ hypotheses: [hyp("a", alwaysTrue("labour.activityRate"))] });
    const usageAnswers = (call: ModelCall) =>
      call.stage === "propose" ? usageProposal : JSON.stringify({ counter: null, reason: "no counter" });
    const usageRunner = () =>
      makeRunner(stubTransport(usageAnswers), { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });

    const file = await pipeline(data, { only: [finding.code], run: usageRunner(), falsifier: usageRunner(), setup: testSetup });
    const propose = file.usage.find((u) => u.stage === "propose");
    const falsify = file.usage.find((u) => u.stage === "falsify");
    expect(propose?.calls).toBeGreaterThan(0);
    expect(propose?.model).toBe("sonnet");
    expect(falsify?.calls).toBeGreaterThan(0);
  });
});

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
      return JSON.stringify({ counter: null, reason: "not arguable", refuse: "blame" });
    }
    return JSON.stringify({ counter: null, reason: "no counter" });
  };
  const stageRunner = () => makeRunner(stubTransport(stageAnswers), { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });

  it("gives each hypothesis the stage where it stopped", async () => {
    const file = await pipeline(data, { only: [finding.code], run: stageRunner(), falsifier: stageRunner(), setup: testSetup });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const byClaim = new Map(item.hypotheses.map((h) => [h.claim.en, h]));

    expect(byClaim.get("a check fails")?.stage).toBe("check");
    expect(byClaim.get("b falsify holds")?.stage).toBe("falsify");
    expect(byClaim.get("c safety kill")?.stage).toBe("safety");
    expect(byClaim.get("c safety kill")?.reason).toBe("refused: blame");
    expect(byClaim.get("d link not consistent")?.stage).toBe("link");
    expect(byClaim.get("e published")?.stage).toBe("published");
    expect(byClaim.get("e published")?.reason).toBeNull();
  });
});

describe("a hypothesis that the figure is an error in the data", () => {
  it("is published flagged as one", async () => {
    const finding = pickIsolatedFinding(STAGE_TEST_FIELDS);
    const flagged = JSON.stringify({ hypotheses: [{ ...hyp("an error in the data", alwaysTrue("labour.activityRate")), artefact: true }] });
    const answers = (call: ModelCall) => (call.stage === "propose" ? flagged : JSON.stringify({ counter: null, reason: "no counter" }));
    const r = () => makeRunner(stubTransport(answers), { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });
    const file = await pipeline(data, { only: [finding.code], run: r(), falsifier: r(), setup: testSetup });

    const [, body] = [...publishable(file, data)].find(([path]) => path.endsWith(`/${finding.code}.json`))!;
    const h = (body as { findings: { hypotheses: { artefact: boolean }[] }[] }).findings[0]!.hypotheses[0]!;
    expect(h.artefact).toBe(true);
  });
});

describe("the command line", () => {
  it("reads --limit as a number and --only as codes", () => {
    expect(parseArgs(["--limit", "5", "--only", "01.511.01.0,04.421.01.0"])).toEqual({
      publish: false, demand: false, limit: 5, only: ["01.511.01.0", "04.421.01.0"],
    });
    expect(parseArgs(["--publish"])).toMatchObject({ publish: true, limit: undefined, only: undefined });
  });

  it("stops at a --limit with no number after it", () => {
    for (const args of [["--limit"], ["--limit", "five"], ["--limit", "--demand"], ["--limit", "0"], ["--limit", "2.5"]]) {
      expect(() => parseArgs(args), args.join(" ")).toThrow(/--limit needs a whole number/);
    }
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
      return { text: JSON.stringify({ counter: null, reason: "no counter" }), model: "adversary-id", usage: NO_USAGE };
    }, cache());
    const file = await pipeline(data, { only: [finding.code], run: proposer(), falsifier, setup: testSetup });
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
      throw new Error("claude exited 1: something broke");
    }, cache());
    const file = await pipeline(data, { only: [finding.code], run: proposer(), falsifier, setup: testSetup, concurrency: 1 });

    expect(calls).toBe(3);
    expect(file.partial).toBe(true);
    expect(file.stopped).toMatch(/^3 adversary calls in a row failed.*something broke/);
    expect(file.items.at(-1)!.skipped).toMatch(/^the run stopped/);
    expect(summary(file).join("\n")).toMatch(/stopped early: 3 adversary calls/);
  });

  it("stops at once when a usage limit outlasts its wait, and says so", async () => {
    // a runner that throws the LimitError withRetries throws after its wait
    const limited = makeRunner(async () => { throw new LimitError("the usage limit didn't reset within 6 hours", null); }, cache());
    const file = await pipeline(data, { only: [finding.code], run: proposer(), falsifier: limited, setup: testSetup, concurrency: 1 });
    expect(file.stopped).toMatch(/usage limit/);
    expect(file.partial).toBe(true);
  });

  it("stops the run after 3 proposer calls in a row fail, before the next finding", async () => {
    let calls = 0;
    const failing = makeRunner(async () => {
      calls++;
      throw new Error("claude exited 1: usage limit reached");
    }, cache());
    const file = await pipeline(data, { limit: 3, run: failing, falsifier: proposer(), setup: testSetup, concurrency: 1 });

    expect(calls).toBe(3);
    expect(file.stopped).toMatch(/^3 proposer calls in a row failed/);
    expect(file.items.length).toBeLessThan(3);
    expect(file.items.at(-1)!.skipped).toMatch(/^the run stopped/);
  });
});

describe("running findings at the same time", () => {
  const strip = (f: RunFile) => ({ items: f.items, stopped: f.stopped, partial: f.partial });
  const cache = () => ({ cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });
  // The finding a propose call is for: its key is the finding's id, then the sample's index.
  const idOf = (call: ModelCall) => call.key.slice(0, call.key.lastIndexOf(":"));

  it("gives the same run file at concurrency 1 and 3", async () => {
    const only = isolatedFindings([], 6).map((f) => f.code);
    const one = await pipeline(data, { only, run: runner(), falsifier: runner(), setup: testSetup, concurrency: 1 });
    const three = await pipeline(data, { only, run: runner(), falsifier: runner(), setup: testSetup, concurrency: 3 });
    expect(strip(three)).toEqual(strip(one));
  });

  it("keeps every link verdict with the finding it was tested for", async () => {
    // Each finding gets a link test about its own figure, and every call waits a few ms keyed
    // on what it asks, so 3 at once finish in a different order from one at a time.
    const linked = isolatedFindings(["education.higher"], 4);
    const byId = new Map(linked.map((f) => [f.id, f]));
    const answer = (call: ModelCall) => {
      if (call.stage !== "propose") return JSON.stringify({ counter: null, reason: "no counter" });
      const f = byId.get(idOf(call))!;
      return JSON.stringify({ hypotheses: [hyp("linked", alwaysTrue("education.higher"), {
        link: "together", x: "education.higher", y: f.measure, year: f.kind === "change" ? "change" : 2024, level: f.level, direction: "positive",
      })] });
    };
    const scrambled = () => makeRunner(async (call) => {
      await new Promise((r) => setTimeout(r, parseInt(hash(call.key).slice(0, 2), 16) % 8));
      return { text: answer(call), model: call.model, usage: NO_USAGE };
    }, cache());
    const at = (concurrency: number, only = linked.map((f) => f.code)) =>
      pipeline(data, { only, run: scrambled(), falsifier: scrambled(), setup: testSetup, concurrency });

    const one = await at(1);
    const three = await at(3);
    expect(strip(three)).toEqual(strip(one));

    // A link test's own numbers don't depend on what else the run tested, so each finding's
    // have to match a run of that finding alone.
    const numbers = (item: Item) =>
      item.hypotheses.map((h) => h.linkTest && { p: h.linkTest.p, effect: h.linkTest.effect, placeboEffects: h.linkTest.placeboEffects });
    for (const item of three.items) {
      const alone = await at(1, [item.finding.code]);
      expect(numbers(item), item.finding.code).toEqual(numbers(alone.items[0]!));
    }
    expect(three.items.filter((i) => i.hypotheses.some((h) => h.linkTest && h.linkTest.verdict !== "refused")).length).toBeGreaterThan(1);
  });

  it("keeps what finished before a stop, skips what was running and leaves out the rest", async () => {
    // The first 3 findings answer. The others' calls wait until 3 of them are waiting, which
    // only happens once the first 3 have finished and every slot holds one, then all fail:
    // 3 in a row stop the run with 3 findings in flight and one never started.
    const seven = isolatedFindings([], 7);
    const answering = new Set(seven.slice(0, 3).map((f) => f.id));
    const proposal = JSON.stringify({ hypotheses: [hyp("a", alwaysTrue("labour.activityRate"))] });
    const waiting = new Set<string>();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const proposer = makeRunner(async (call) => {
      if (!answering.has(idOf(call))) {
        waiting.add(idOf(call));
        if (waiting.size === 3) open();
        await gate;
        throw new Error("claude exited 1: something broke");
      }
      return { text: proposal, model: call.model, usage: NO_USAGE };
    }, cache());
    const file = await pipeline(data, { only: seven.map((f) => f.code), run: proposer, falsifier: runner(), setup: testSetup, concurrency: 3 });

    expect(file.stopped).toMatch(/^3 proposer calls in a row failed.*something broke/);
    expect(file.partial).toBe(true);
    expect(file.items.map((i) => i.finding.id)).toEqual(seven.slice(0, 6).map((f) => f.id));
    for (const item of file.items.slice(0, 3)) {
      expect(item.skipped).toBeNull();
      expect(item.hypotheses.map((h) => h.stage)).toEqual(["published"]);
    }
    for (const item of file.items.slice(3)) {
      expect(item.skipped).toMatch(/^the run stopped/);
      expect(item.hypotheses).toEqual([]);
    }
  });

  it("reads --concurrency as a whole number and refuses anything else", () => {
    expect(parseArgs(["--concurrency", "2"]).concurrency).toBe(2);
    expect(() => parseArgs(["--concurrency", "0"])).toThrow(/--concurrency/);
    expect(() => parseArgs(["--concurrency"])).toThrow(/--concurrency/);
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

    const file = await pipeline(data, { only: [finding.code], run: r(), falsifier: r(), setup: testSetup });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const published = item.hypotheses.find((h) => h.claim.en === "unrelated link")!;

    expect(published.stage).toBe("published");
    expect(published.linkTest).toMatchObject({ verdict: "refused", reason: "not about this figure", x: "education.higher" });
  });

  it("refuses a figure paired with itself, even when its data test passed", async () => {
    // Any figure, paired with itself, correlates at exactly 1.
    const all = detect(data);
    const target = all.find((f) => f.kind === "extreme")!;
    const itself = JSON.stringify({
      hypotheses: [
        hyp("itself", alwaysTrue("labour.activityRate"), {
          link: "together", x: target.measure, y: target.measure, year: 2024, level: target.level, direction: "positive",
        }),
      ],
    });
    const r = stubbed(itself);

    const file = await pipeline(data, { only: [target.code], run: r(), falsifier: r(), setup: testSetup });
    const item = file.items.find((i) => i.finding.id === target.id)!;
    const h = item.hypotheses.find((x) => x.claim.en === "itself")!;
    expect(h.linkTest).toMatchObject({ verdict: "refused", reason: "not about this figure" });
  });

  it("still runs a link whose premise is the field the data test read", async () => {
    const peersTest = { link: "peers", premise: "commute.privateCar", outcome: finding.measure, level: finding.level, direction: "higher" } as const;
    const related = JSON.stringify({
      hypotheses: [
        hyp("related link", alwaysTrue("education.higher"), {
          link: "together", x: "education.higher", y: finding.measure, year: 2024, level: finding.level, direction: "positive",
        }),
        hyp("related peers link", alwaysTrue("commute.privateCar"), peersTest),
      ],
    });
    const r = stubbed(related);

    const file = await pipeline(data, { only: [finding.code], run: r(), falsifier: r(), setup: testSetup });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const h = item.hypotheses.find((x) => x.claim.en === "related link")!;
    expect(h.linkTest?.verdict).not.toBe("refused");
    expect(h.linkTest?.placeboEffects).toHaveLength(3);
    expect(h.linkTest?.reason).toBeUndefined();

    // A together link's size happens to equal |effect|, which run.ts could get right by
    // accident even if it recomputed rather than copied `outcome.size`; a peers link's size
    // divides by the outcome's spread, so only a copied-through value can match it here.
    const peers = item.hypotheses.find((x) => x.claim.en === "related peers link")!;
    const outcome = runLink(peersTest, data, 1);
    expect(peers.linkTest?.size).toBe(outcome.size);
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
    const file = await pipeline(data, { only: [finding.code], run: survivorRunner(), falsifier: survivorRunner(), setup: testSetup });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    const published = item.hypotheses.filter((h) => h.stage === "published");
    expect(published.map((h) => h.support)).toEqual([5, 4, 3, 2, 1]);

    const files = publishable(file, data);
    const [, body] = [...files].find(([path]) => path.endsWith(`/${finding.code}.json`))!;
    const findingEntry = (body as { findings: { id: string; hypotheses: { support: number }[] }[] }).findings.find((f) => f.id === finding.id)!;
    expect(findingEntry.hypotheses.map((h) => h.support)).toEqual([5, 4, 3]);
  });

  it("leaves the adversary's model and its words out of the published files", async () => {
    const file = await pipeline(data, { only: [finding.code], run: survivorRunner(), falsifier: survivorRunner(), setup: testSetup });
    expect(file.items.find((i) => i.finding.id === finding.id)!.hypotheses[0]!.adversary).not.toBeNull();

    const [, body] = [...publishable(file, data)].find(([path]) => path.endsWith(`/${finding.code}.json`))!;
    for (const f of (body as { findings: { hypotheses: object[] }[] }).findings) {
      for (const h of f.hypotheses) expect(h).not.toHaveProperty("adversary");
    }
  });

  it("sends the adversary only the top 3 by support when told to, and marks the rest unshown", async () => {
    let adversaryCalls = 0;
    const counting = makeRunner(async (c) => { adversaryCalls++; return { text: survivorAnswers(c), model: c.model, usage: NO_USAGE }; },
      { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });
    const file = await pipeline(data, { only: [finding.code], run: survivorRunner(), falsifier: counting, setup: { ...testSetup, attackShownOnly: true } });
    const item = file.items.find((i) => i.finding.id === finding.id)!;
    expect(item.hypotheses.filter((h) => h.stage === "published").map((h) => h.support)).toEqual([5, 4, 3]);
    expect(item.hypotheses.filter((h) => h.stage === "unshown").map((h) => h.support)).toEqual([2, 1]);
    expect(adversaryCalls).toBe(3);
  });

  it("passes the setup's effort to both roles", async () => {
    const seen = new Set<string>();
    const spy = makeRunner(async (c) => { seen.add(`${c.stage}:${c.effort}`); return { text: survivorAnswers(c), model: c.model, usage: NO_USAGE }; },
      { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });
    await pipeline(data, { only: [finding.code], run: spy, falsifier: spy, setup: testSetup });
    expect(seen).toEqual(new Set(["propose:high", "falsify:medium"]));
  });

  it("records the setup it ran with in the run file", async () => {
    const file = await pipeline(data, { only: [finding.code], run: survivorRunner(), falsifier: survivorRunner(), setup: testSetup });
    expect(file.setup).toEqual(testSetup);
  });
});

describe("a call that fails in a way nothing anticipated", () => {
  it("still lets the run complete, with the finding skipped", async () => {
    const finding = pickIsolatedFinding([]);
    const throwing = async (): Promise<{ text: string; model: string; usage: Usage }> => {
      throw { weird: "not an Error instance" };
    };
    const brokenRunner = () => makeRunner(throwing, { cacheDir: mkdtempSync(join(tmpdir(), "r-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });

    const file = await pipeline(data, { only: [finding.code], run: brokenRunner(), falsifier: brokenRunner(), setup: testSetup });

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

  it("refuses when either run id is missing, rather than treating 2 blanks as a match", async () => {
    const { outDir, publishedPath } = place();
    const result = await publishIfAllowed({ outDir, publishedPath, run: { runId: "", partial: false }, metrics: { ...passing, runId: "" }, baseline: null, files: new Map([["index.json", []]]) });
    expect(result.written).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/run id/);
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

describe("the private-terms warning", () => {
  it("warns, without naming a path, when INSIGHTS_LOCAL isn't set", () => {
    expect(localWarning(null)).toBe("insights: INSIGHTS_LOCAL isn't set, so no private terms are checked");
  });

  it("still warns, without naming a path, when the folder has no terms", () => {
    expect(localWarning({ terms: [], keys: {} })).toBe("insights: no private terms are checked");
  });

  it("says nothing once there's at least one term", () => {
    expect(localWarning({ terms: ["zorblat"], keys: {} })).toBeNull();
  });
});
