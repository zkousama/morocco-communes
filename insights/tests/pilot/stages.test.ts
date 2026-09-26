import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import { NO_ANSWER } from "../../src/falsify.ts";
import { LimitError, makeRunner, NO_USAGE, stubTransport, type ModelCall, type Runner } from "../../src/model.ts";
import { STOP_AFTER_FAILURES } from "../../src/run.ts";
import type { Check } from "../../src/vocabulary.ts";
import { committedCandidates, runStageA, runStageB, type StageA, type StageACandidate, type StageB, type StageBVerdict } from "../../src/pilot/stages.ts";
import { ADVERSARIES, PILOT_SEED, PROPOSERS } from "../../src/pilot/setups.ts";
import { sampleFindings } from "../../src/pilot/sample.ts";

const data = loadData();
const allFindings = sampleFindings(detect(data), PILOT_SEED);
const findings = allFindings.slice(0, 3);
const answer = (call: { model: string }) => JSON.stringify({ hypotheses: [{
  claim: { en: `claim by ${call.model}`, fr: "affirmation" }, link: { en: "link", fr: "lien" }, premise: { en: "premise", fr: "prémisse" },
  test: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 0 } },
  linkTest: null, artefact: false,
}] });
const runners = new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(answer), { cacheDir: mkdtempSync(join(tmpdir(), "pa-")), datasetVersion: "t", stageVersions: {} })]));

describe("stage A", () => {
  it("runs every proposer on the same findings and keeps where each candidate came from", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 2, terms: null });
    expect(a.proposers.map((p) => p.id)).toEqual(PROPOSERS.map((p) => p.id));
    for (const p of PROPOSERS) {
      const mine = a.candidates.filter((c) => c.proposer === p.id);
      expect(new Set(mine.map((c) => c.findingId))).toEqual(new Set(findings.map((f) => f.id)));
    }
  });
  it("records which samples proposed each candidate, and its data test", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    const c = a.candidates[0]!;
    expect(c.sampleIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(["passed", "failed", "refused"]).toContain(c.outcome.status);
    expect(c.passed).toBe(c.outcome.status === "passed");
  });
  it("gives each proposer's calls its own effort", async () => {
    const seen = new Set<string>();
    const spying = new Map(PROPOSERS.map((p) => [p.id, makeRunner(async (call) => { seen.add(`${call.model}:${call.effort ?? "none"}`); return { text: answer(call), model: call.model, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, costUsd: 0 } }; }, { cacheDir: mkdtempSync(join(tmpdir(), "pe-")), datasetVersion: "t", stageVersions: {} })]));
    await runStageA(data, findings.slice(0, 1), spying, { concurrency: 1, terms: null });
    expect(seen).toEqual(new Set(["haiku:none", "sonnet:medium", "sonnet:high", "opus:medium"]));
  });

  it("counts safety drops per proposer, summed across findings, without keeping their text", async () => {
    const refused = () => JSON.stringify({ hypotheses: [{
      claim: { en: "Mr Alami closed the clinic", fr: "M. Alami a fermé la clinique" },
      link: { en: "link", fr: "lien" }, premise: { en: "premise", fr: "prémisse" },
      test: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 0 } },
      linkTest: null, artefact: false,
    }] });
    const mixed = new Map(PROPOSERS.map((p) => [
      p.id,
      makeRunner(stubTransport(p.id === "P1" ? refused : answer), { cacheDir: mkdtempSync(join(tmpdir(), "pr-")), datasetVersion: "t", stageVersions: {} }),
    ]));
    const a = await runStageA(data, findings, mixed, { concurrency: 2, terms: null });
    const p1 = a.proposers.find((p) => p.id === "P1")!;
    expect(p1.safetyDrops).toEqual({ individuals: findings.length });
    expect(a.candidates.filter((c) => c.proposer === "P1")).toEqual([]);
    expect(JSON.stringify(a)).not.toContain("Alami");
  });

  it("counts unusable answers per finding, not summed across findings (rule 5 bootstraps per finding)", async () => {
    const flaky = (call: ModelCall): string => (Number(call.key.split(":").pop()) % 2 === 0 ? answer(call) : "not json");
    const mixed = new Map(PROPOSERS.map((p) => [
      p.id,
      makeRunner(stubTransport(p.id === "P3" ? flaky : answer), { cacheDir: mkdtempSync(join(tmpdir(), "pu-")), datasetVersion: "t", stageVersions: {} }),
    ]));
    const a = await runStageA(data, findings, mixed, { concurrency: 2, terms: null });
    const p3 = a.proposers.find((p) => p.id === "P3")!;
    for (const f of findings) expect(p3.unusable[f.id]).toBe(2); // samples 1 and 3 of every 5 are unusable
    const p1 = a.proposers.find((p) => p.id === "P1")!;
    for (const f of findings) expect(p1.unusable[f.id]).toBe(0);
  });

  it("judges a candidate's link test only when its data test passed and the link is about the finding", async () => {
    const f0 = findings[0]!; // an extreme finding whose measure and level we read off itself
    const withLink = () => JSON.stringify({ hypotheses: [{
      claim: { en: "claim", fr: "affirmation" }, link: { en: "link", fr: "lien" }, premise: { en: "premise", fr: "prémisse" },
      test: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 0 } },
      linkTest: { link: "peers", premise: "education.higher", outcome: f0.measure, level: f0.level, direction: "higher" },
      artefact: false,
    }] });
    const mixed = new Map(PROPOSERS.map((p) => [
      p.id,
      makeRunner(stubTransport(p.id === "P2" ? withLink : answer), { cacheDir: mkdtempSync(join(tmpdir(), "pl-")), datasetVersion: "t", stageVersions: {} }),
    ]));
    const a = await runStageA(data, [f0], mixed, { concurrency: 1, terms: null });

    const withLinkTest = a.candidates.find((c) => c.proposer === "P2" && c.findingId === f0.id)!;
    expect(withLinkTest.passed).toBe(true);
    expect(withLinkTest.link).not.toBeNull();
    expect(["consistent", "not consistent", "refused"]).toContain(withLinkTest.link!.verdict);

    const withoutLinkTest = a.candidates.find((c) => c.proposer === "P1" && c.findingId === f0.id)!;
    expect(withoutLinkTest.link).toBeNull();
  });

  it("gives an identical link test the same placebos whichever proposer offered it", async () => {
    const f0 = findings[0]!;
    const withLink = () => JSON.stringify({ hypotheses: [{
      claim: { en: "c", fr: "c" }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" },
      test: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 0 } },
      linkTest: { link: "peers", premise: "education.higher", outcome: f0.measure, level: f0.level, direction: "higher" },
      artefact: false,
    }] });
    // P1 and P2 both offer the exact same premise, test and link test on the same finding.
    const mixed = new Map(PROPOSERS.map((p) => [
      p.id,
      makeRunner(stubTransport((p.id === "P1" || p.id === "P2") ? withLink : answer), { cacheDir: mkdtempSync(join(tmpdir(), "ls-")), datasetVersion: "t", stageVersions: {} }),
    ]));
    const a = await runStageA(data, [f0], mixed, { concurrency: 1, terms: null });
    const p1Link = a.candidates.find((c) => c.proposer === "P1" && c.findingId === f0.id)!.link!;
    const p2Link = a.candidates.find((c) => c.proposer === "P2" && c.findingId === f0.id)!.link!;
    expect(p1Link.placeboEffects).toEqual(p2Link.placeboEffects);
  });

  it("keeps propose's own rank and lays candidates out by proposer, then finding, then rank", async () => {
    const h = (field: string) => ({
      claim: { en: field, fr: field }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" },
      test: { check: "compare", left: { of: { unit: "self" }, field, year: 2024 }, op: ">", right: { value: 0 } },
      linkTest: null, artefact: false,
    });
    // 3 distinct hypotheses, every sample, tied on support: propose's own order (first
    // proposed) decides rank, so it's always education.higher (0), then economy... (1), then
    // housing... (2), whichever finding or proposer, unaffected by how findings interleave.
    const claims = ["education.higher", "economy.perBusiness.jobs", "housing.occupancy.vacant"];
    const multi = () => JSON.stringify({ hypotheses: claims.map(h) });
    const mixed = new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(multi), { cacheDir: mkdtempSync(join(tmpdir(), "mr-")), datasetVersion: "t", stageVersions: {} })]));

    const a = await runStageA(data, findings, mixed, { concurrency: 2, terms: null });

    const expectedOrder = PROPOSERS.flatMap((p) => findings.flatMap((f) => [0, 1, 2].map((rank) => `${p.id}:${f.id}:${rank}`)));
    expect(a.candidates.map((c) => `${c.proposer}:${c.findingId}:${c.rank}`)).toEqual(expectedOrder);
    expect(a.candidates.every((c) => c.candidate.claim.en === claims[c.rank])).toBe(true);
  });

  it("checks every proposer has a runner before making any call", async () => {
    const calls: string[] = [];
    const counting = () => makeRunner(stubTransport((call) => { calls.push(call.model); return answer(call); }), { cacheDir: mkdtempSync(join(tmpdir(), "mp-")), datasetVersion: "t", stageVersions: {} });
    // P1 and P2 (which come first) do have runners; P3 and P4 don't.
    const partial = new Map(PROPOSERS.slice(0, 2).map((p) => [p.id, counting()]));
    await expect(runStageA(data, findings, partial, { concurrency: 1, terms: null })).rejects.toThrow(/no runner for proposer/);
    expect(calls).toEqual([]);
  });

  it("resumes without re-asking a question the model already answered, even an unusable one", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "resume-"));
    let calls = 0;
    const flaky = (call: ModelCall): string => {
      calls++;
      return Number(call.key.split(":").pop()) % 3 === 0 ? "not json" : answer(call);
    };
    const resumable = new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(flaky), { cacheDir, datasetVersion: "t", stageVersions: {} })]));

    const a1 = await runStageA(data, findings, resumable, { concurrency: 2, terms: null });
    expect(calls).toBeGreaterThan(0);

    calls = 0;
    const a2 = await runStageA(data, findings, resumable, { concurrency: 2, terms: null });
    expect(calls).toBe(0);
    expect(a2).toEqual(a1);
  });

  describe("halting", () => {
    const failing = (message: string): Runner => async () => { throw new Error(message); };

    it("halts at once on a fatal error and makes far fewer calls than a full run", async () => {
      let calls = 0;
      const enoent: Runner = async () => { calls++; throw new Error("couldn't start claude: spawn claude ENOENT"); };
      const runnersAll = new Map(PROPOSERS.map((p) => [p.id, enoent]));
      await expect(runStageA(data, allFindings, runnersAll, { concurrency: 3, terms: null })).rejects.toThrow(/couldn't start claude/);
      // A full run would be 4 proposers x 16 findings x 5 samples = 320 calls.
      expect(calls).toBeLessThan(10);
    });

    it("halts at once when a usage limit outlasted its wait", async () => {
      let calls = 0;
      const limited: Runner = async () => { calls++; throw new LimitError("the usage limit didn't reset within 6 hours", null); };
      const runnersAll = new Map(PROPOSERS.map((p) => [p.id, limited]));
      await expect(runStageA(data, allFindings, runnersAll, { concurrency: 3, terms: null })).rejects.toThrow(/usage limit/);
      expect(calls).toBeLessThan(10);
    });

    it("doesn't halt on 2 failures in a row when a success follows", async () => {
      let n = 0;
      const flaky: Runner = async (call) => {
        n++;
        if (n <= 2) throw new Error("claude exited 1: overloaded");
        return { text: answer(call), model: call.model, promptHash: "x", cached: false, ms: 1, usage: NO_USAGE, waitedMs: 0 };
      };
      const runnersFlaky = new Map(PROPOSERS.map((p) => [p.id, flaky]));
      const a = await runStageA(data, findings, runnersFlaky, { concurrency: 1, terms: null });
      expect(a.candidates.length).toBeGreaterThan(0);
      expect(a.proposers.find((p) => p.id === "P1")!.failed).toBe(2);
      for (const id of ["P2", "P3", "P4"]) expect(a.proposers.find((p) => p.id === id)!.failed).toBe(0);
    });

    it("halts after 3 ordinary failures in a row", async () => {
      let n = 0;
      const alwaysFailing = failing("claude exited 1: something broke");
      const countingFailing: Runner = async (call) => { n++; return alwaysFailing(call); };
      const runnersAll = new Map(PROPOSERS.map((p) => [p.id, countingFailing]));
      await expect(runStageA(data, findings, runnersAll, { concurrency: 1, terms: null })).rejects.toThrow(/3 proposer calls in a row failed/);
      expect(n).toBeLessThan(10);
    });

    it("stops calling onCandidates once the halt is set, so no misleading '0 candidates' lines print", async () => {
      const alwaysFailing = failing("claude exited 1: something broke");
      const runnersAll = new Map(PROPOSERS.map((p) => [p.id, alwaysFailing]));
      let onCandidatesCalls = 0;
      await expect(
        runStageA(data, findings, runnersAll, { concurrency: 1, terms: null, onCandidates: () => { onCandidatesCalls++; } }),
      ).rejects.toThrow(/3 proposer calls in a row failed/);
      // The halt trips inside the first finding's own 5-sample loop, before that finding
      // (or any later one) ever reaches its own onCandidates call.
      expect(onCandidatesCalls).toBe(0);
    });
  });
});

describe("stage B", () => {
  it("runs every adversary on the same pool, and the repeat run really asks again", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    let calls = 0;
    const sharedCache = mkdtempSync(join(tmpdir(), "pb-"));
    const counting = (id: string) => makeRunner(async (call) => { calls++; return { text: JSON.stringify({ counter: null, reason: `none from ${id}` }), model: call.model, usage: NO_USAGE }; }, { cacheDir: sharedCache, datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, counting(r.id)]));
    const b = await runStageB(data, a, adv, { concurrency: 2, terms: null });
    const poolSize = b.pool.length;
    expect(b.verdicts).toHaveLength(poolSize * ADVERSARIES.length);
    expect(calls).toBe(poolSize * ADVERSARIES.length); // A2 isn't served from A1's cache
  });
  it("never commits the text of a candidate stopped for safety, but keeps every run's non-text fields", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    const refusing = makeRunner(stubTransport(() => JSON.stringify({ counter: null, reason: "r", refuse: "blame" })), { cacheDir: mkdtempSync(join(tmpdir(), "pr-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, refusing]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null });
    const committed = committedCandidates(a, b, null) as Array<Record<string, unknown>>;
    const json = JSON.stringify(committed);
    for (const c of a.candidates) expect(json).not.toContain(c.candidate.claim.en);
    expect(json).toContain('"category":"blame"');

    const entry = committed[0]!;
    expect(entry.claim).toBeUndefined();
    const runs = entry.runs as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(ADVERSARIES.length);
    expect(runs[0]).toMatchObject({ run: "A1", survived: false, stage: "safety", category: "blame", unusable: null, model: "opus", effort: "medium" });
    expect(runs[0]).toHaveProperty("usage");
    expect(runs[0]).toHaveProperty("waitedMs");
    expect(runs[0]).not.toHaveProperty("counter");
    expect(runs[0]).not.toHaveProperty("counterOutcome");
    expect(runs[0]).not.toHaveProperty("reason");
  });

  it("redacts every run's own text once any one of them refuses, not just the refusing run's", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    // A1 refuses outright; every other run answers for real, with its own free-text reason
    // and a counter-test, on every candidate.
    const mixed: Runner = async (call) => {
      const text = call.model === "opus" && call.effort === "medium" && !call.label
        ? JSON.stringify({ counter: null, reason: "r", refuse: "blame" })
        : JSON.stringify({
            counter: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: -1 } },
            reason: "a reason nobody should read",
          });
      return { text, model: call.model, promptHash: "x", cached: false, ms: 1, usage: NO_USAGE, waitedMs: 0 };
    };
    const adv = new Map(ADVERSARIES.map((r) => [r.id, mixed]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null });
    const committed = JSON.stringify(committedCandidates(a, b, null));

    expect(committed).not.toContain("a reason nobody should read"); // no run's reason, refusing or not
    expect(committed).not.toContain('"education.higher"'); // no run's counter-test, and not the candidate's own data test either
    for (const c of a.candidates) {
      expect(committed).not.toContain(c.candidate.claim.en);
      expect(committed).not.toContain(c.candidate.claim.fr);
      expect(committed).not.toContain(c.candidate.link.en);
      expect(committed).not.toContain(c.candidate.link.fr);
      expect(committed).not.toContain(c.candidate.premise.en);
      expect(committed).not.toContain(c.candidate.premise.fr);
    }
  });

  it("redacts a term-matching candidate even when every run's counter-test breaks it, never letting a broken candidate skip the term check", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    // P1 alone claims "claim by haiku" (no adversary answers as "haiku"), so matching on it
    // stands in for a private term without that word ever legitimately appearing elsewhere.
    const terms = /haiku/i;
    // A counter-test that's true for every one of these findings' real data, so every run
    // genuinely breaks the candidate (survived: false) rather than ever reaching "survived",
    // the path the old, verdict-gated terms check depended on.
    const breaking = makeRunner(stubTransport(() => JSON.stringify({
      counter: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: -1 } },
      reason: "always true, always breaks it",
    })), { cacheDir: mkdtempSync(join(tmpdir(), "tm-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, breaking]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms });

    const p1 = a.candidates.find((c) => c.proposer === "P1")!;
    const p1Verdicts = b.verdicts.filter((v) => v.candidateId === p1.candidateId);
    expect(p1Verdicts.length).toBeGreaterThan(0);
    expect(p1Verdicts.every((v) => v.survived === false && v.stage === "falsify")).toBe(true); // never reached "survived"

    const committed = JSON.stringify(committedCandidates(a, b, terms));
    expect(committed).toContain('"category":"terms"');
    expect(committed).not.toContain("haiku");
  });

  it("never keeps an adversary's free-text reason in the committed file", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    const answering: Runner = async (call) => ({
      text: JSON.stringify({
        counter: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: -1 } },
        reason: "a private reason nobody should read",
      }),
      model: call.model,
      promptHash: "x",
      cached: false,
      ms: 1,
      usage: NO_USAGE,
      waitedMs: 0,
    });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, answering]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null });
    const committed = JSON.stringify(committedCandidates(a, b, null));
    expect(committed).not.toContain("a private reason nobody should read");
    expect(committed).not.toContain('"reason"');
    expect(committed).toContain('"education.higher"'); // the counter-test's own field still shows: it isn't free text
  });

  it("drops a counter-test's own JSON when it matches a term, keeping only its outcome status", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    const answering = makeRunner(stubTransport(() => JSON.stringify({
      counter: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: -1 } },
      reason: "fine",
    })), { cacheDir: mkdtempSync(join(tmpdir(), "cu-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, answering]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null }); // the candidate's own text never matches
    const terms = /-1\b/; // matches only the counter-test's own distinctive threshold
    const committed = JSON.stringify(committedCandidates(a, b, terms));
    expect(committed).not.toContain("-1");
    expect(committed).toContain('"status":"passed"');
  });

  it("keeps only a refused counter-test's status, even when nothing in it matches a pattern", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    // "the committee's private records" isn't a real field, so evaluate() refuses this
    // counter-test outright; nothing about that free text matches a term or an individual.
    const answering = makeRunner(stubTransport(() => JSON.stringify({
      counter: { check: "compare", left: { of: { unit: "self" }, field: "the committee's private records", year: 2024 }, op: ">", right: { value: 0 } },
      reason: "fine",
    })), { cacheDir: mkdtempSync(join(tmpdir(), "rf-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, answering]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null });
    expect(b.verdicts.every((v) => v.counterOutcome?.status === "refused")).toBe(true);
    const committed = JSON.stringify(committedCandidates(a, b, null));
    expect(committed).not.toContain("committee");
    expect(committed).toContain('"status":"refused"');
  });

  it("screens the counter's own string values too, catching what an escaped character hides in its JSON", () => {
    // Built by hand rather than through a real falsify() call: evaluate() would refuse a
    // made-up field outright (covered by the test above), which would mask this on its own.
    // This isolates the leaf-screening rule from the refused-status rule.
    const fakeTest: Check = { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 0 } };
    const fakeCandidate: StageACandidate = {
      candidateId: "aaaaaaaaaaaa",
      proposer: "P1",
      findingId: "f1",
      candidate: { claim: { en: "c", fr: "c" }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" }, test: fakeTest, linkTest: null, artefact: false, support: 5, samples: [0, 1, 2, 3, 4] },
      sampleIndexes: [0, 1, 2, 3, 4],
      rank: 0,
      outcome: { status: "passed", numbers: {} },
      passed: true,
      link: null,
    };
    const fakeA: StageA = { seed: PILOT_SEED, findingIds: ["f1"], proposers: [], candidates: [fakeCandidate] };
    // A raw tab inside the counter's own field, exactly as it would sit if a private term
    // contained one: `JSON.stringify` would escape it to the 2 characters \ and t, which a
    // whole-JSON regex test for a literal tab would never match.
    const counterWithTab: Check = { check: "compare", left: { of: { unit: "self" }, field: "abc\tdef", year: 2024 }, op: ">", right: { value: 0 } };
    const verdict: StageBVerdict = {
      run: "A1", candidateId: "aaaaaaaaaaaa", survived: true, stage: null, category: null, unusable: null,
      counter: counterWithTab, counterOutcome: { status: "passed", numbers: {} }, reason: "fine",
      model: "opus", usage: NO_USAGE, ms: 0, waitedMs: 0,
    };
    const fakeB: StageB = { pool: [{ candidateId: "aaaaaaaaaaaa", proposer: "P1", findingId: "f1" }], verdicts: [verdict], termMatches: [{ candidateId: "aaaaaaaaaaaa", termMatch: false }] };
    const terms = /abc\tdef/; // a raw tab, exactly as it would sit inside a private term
    const committed = JSON.stringify(committedCandidates(fakeA, fakeB, terms));
    expect(committed).not.toContain("abc");
  });

  it("fails closed: a candidate with no termMatch row is redacted, not shown", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    const answering = makeRunner(stubTransport(() => JSON.stringify({ counter: null, reason: "fine" })), { cacheDir: mkdtempSync(join(tmpdir(), "fc-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, answering]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null });
    const withoutTermMatches: StageB = { ...b, termMatches: [] }; // simulates a missing row for every candidate
    const committed = committedCandidates(a, withoutTermMatches, null) as Array<{ safety?: Array<{ run: string; category: string }> }>;
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((c) => c.safety !== undefined)).toBe(true);
    expect(committed.every((c) => c.safety!.some((s) => s.run === "terms"))).toBe(true);
  });

  it("keeps a candidate's full text when a run simply couldn't answer, marking it unusable rather than a break", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    let n = 0;
    const flaky: Runner = async (call) => {
      n++;
      if (n % 4 === 0) throw new Error("claude exited 1: overloaded"); // never 3 in a row
      return { text: JSON.stringify({ counter: null, reason: "fine" }), model: call.model, promptHash: "x", cached: false, ms: 1, usage: NO_USAGE, waitedMs: 0 };
    };
    const adv = new Map(ADVERSARIES.map((r) => [r.id, flaky]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null });
    expect(b.verdicts.some((v) => v.unusable === "no answer")).toBe(true);
    const committed = committedCandidates(a, b, null) as Array<{ claim?: { en: string }; runs: Array<{ unusable: string | null }> }>;
    expect(JSON.stringify(committed)).not.toContain(NO_ANSWER);
    expect(committed.some((c) => c.runs.some((r) => r.unusable === "no answer"))).toBe(true);
    for (const c of a.candidates) expect(JSON.stringify(committed)).toContain(c.candidate.claim.en);
  });

  it("marks a reply that couldn't be read unreadable rather than refused, the shape a blocked Gemini reply takes", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    // An empty answer is exactly what `geminiTransport` returns when the provider blocks a
    // reply: not valid JSON, so `falsify` can't read it, but nothing was ever refused.
    const blocked = makeRunner(stubTransport(() => ""), { cacheDir: mkdtempSync(join(tmpdir(), "ur-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, blocked]));
    const b = await runStageB(data, a, adv, { concurrency: 1, terms: null });
    expect(b.verdicts.length).toBeGreaterThan(0);
    expect(b.verdicts.every((v) => v.unusable === "unreadable")).toBe(true);
    expect(b.verdicts.every((v) => v.category === null && v.stage === "falsify")).toBe(true);
  });

  it("checks every pool candidate's finding id resolves before making any call", async () => {
    const fakeTest = { check: "compare" as const, left: { of: { unit: "self" as const }, field: "education.higher", year: 2024 as const }, op: ">" as const, right: { value: 0 } };
    const fakeCandidate: StageACandidate = {
      candidateId: "deadbeefdead",
      proposer: "P1",
      findingId: "not-a-real-finding-id",
      candidate: { claim: { en: "c", fr: "c" }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" }, test: fakeTest, linkTest: null, artefact: false, support: 5, samples: [0, 1, 2, 3, 4] },
      sampleIndexes: [0, 1, 2, 3, 4],
      rank: 0,
      outcome: { status: "passed", numbers: {} },
      passed: true,
      link: null,
    };
    const fakeA: StageA = { seed: PILOT_SEED, findingIds: ["not-a-real-finding-id"], proposers: [], candidates: [fakeCandidate] };
    const calls: string[] = [];
    const counting = () => makeRunner(stubTransport((call) => { calls.push(call.model); return JSON.stringify({ counter: null, reason: "r" }); }), { cacheDir: mkdtempSync(join(tmpdir(), "fid-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ADVERSARIES.map((r) => [r.id, counting()]));
    await expect(runStageB(data, fakeA, adv, { concurrency: 1, terms: null })).rejects.toThrow(/finding id/);
    expect(calls).toEqual([]);
  });

  it("checks every adversary has a runner before making any call", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    const calls: string[] = [];
    const counting = () => makeRunner(stubTransport((call) => { calls.push(call.model); return JSON.stringify({ counter: null, reason: "r" }); }), { cacheDir: mkdtempSync(join(tmpdir(), "mb-")), datasetVersion: "t", stageVersions: {} });
    // A1-A3 (which come first) do have runners; A4 and A5 don't.
    const partial = new Map(ADVERSARIES.slice(0, 3).map((r) => [r.id, counting()]));
    await expect(runStageB(data, a, partial, { concurrency: 1, terms: null })).rejects.toThrow(/no runner for adversar/);
    expect(calls).toEqual([]);
  });

  it("resumes without re-asking a question already answered", async () => {
    const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
    const cacheDir = mkdtempSync(join(tmpdir(), "resumeb-"));
    let calls = 0;
    const counting = () => makeRunner(async (call) => { calls++; return { text: JSON.stringify({ counter: null, reason: "r" }), model: call.model, usage: NO_USAGE }; }, { cacheDir, datasetVersion: "t", stageVersions: {} });

    const b1 = await runStageB(data, a, new Map(ADVERSARIES.map((r) => [r.id, counting()])), { concurrency: 2, terms: null });
    expect(calls).toBeGreaterThan(0);

    calls = 0;
    const b2 = await runStageB(data, a, new Map(ADVERSARIES.map((r) => [r.id, counting()])), { concurrency: 2, terms: null });
    expect(calls).toBe(0);
    expect(b2).toEqual(b1);
  });

  describe("halting", () => {
    const failing = (message: string): Runner => async () => { throw new Error(message); };

    it("halts at once on a fatal error and makes far fewer calls than a full run", async () => {
      const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
      let calls = 0;
      const enoent: Runner = async () => { calls++; throw new Error("couldn't start claude: spawn claude ENOENT"); };
      const runnersAll = new Map(ADVERSARIES.map((r) => [r.id, enoent]));
      await expect(runStageB(data, a, runnersAll, { concurrency: 3, terms: null })).rejects.toThrow(/couldn't start claude/);
      // A full run over this pool would be 12 candidates x 5 adversaries = 60 calls.
      expect(calls).toBeLessThan(10);
    });

    it("halts after 3 ordinary failures in a row", async () => {
      const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
      let n = 0;
      const alwaysFailing = failing("claude exited 1: something broke");
      const countingFailing: Runner = async (call) => { n++; return alwaysFailing(call); };
      const runnersAll = new Map(ADVERSARIES.map((r) => [r.id, countingFailing]));
      await expect(runStageB(data, a, runnersAll, { concurrency: 1, terms: null })).rejects.toThrow(/3 adversary calls in a row failed/);
      expect(n).toBeLessThan(10);
    });

    it("stops calling onVerdict once the halt is set, so no false 'broke' lines print before the stop message", async () => {
      const a = await runStageA(data, findings, runners, { concurrency: 1, terms: null });
      const alwaysFailing: Runner = async () => { throw new Error("claude exited 1: something broke"); };
      const runnersAll = new Map(ADVERSARIES.map((r) => [r.id, alwaysFailing]));
      let onVerdictCalls = 0;
      await expect(
        runStageB(data, a, runnersAll, { concurrency: 1, terms: null, onVerdict: () => { onVerdictCalls++; } }),
      ).rejects.toThrow(/3 adversary calls in a row failed/);
      // Concurrency 1: the 2 failures before the one that trips the halt are real progress;
      // everything from the call that sets it onward is suppressed.
      expect(onVerdictCalls).toBe(STOP_AFTER_FAILURES - 1);
    });
  });
});
