import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import { makeRunner, stubTransport, type ModelCall } from "../../src/model.ts";
import { runStageA } from "../../src/pilot/stages.ts";
import { PILOT_SEED, PROPOSERS } from "../../src/pilot/setups.ts";
import { sampleFindings } from "../../src/pilot/sample.ts";

const data = loadData();
const findings = sampleFindings(detect(data), PILOT_SEED).slice(0, 3);
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

  it("counts unusable answers per proposer, summed across findings", async () => {
    const flaky = (call: ModelCall): string => (Number(call.key.split(":").pop()) % 2 === 0 ? answer(call) : "not json");
    const mixed = new Map(PROPOSERS.map((p) => [
      p.id,
      makeRunner(stubTransport(p.id === "P3" ? flaky : answer), { cacheDir: mkdtempSync(join(tmpdir(), "pu-")), datasetVersion: "t", stageVersions: {} }),
    ]));
    const a = await runStageA(data, findings, mixed, { concurrency: 2, terms: null });
    const p3 = a.proposers.find((p) => p.id === "P3")!;
    expect(p3.unusable).toBe(2 * findings.length); // samples 1 and 3 of every 5 are unusable
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

  it("gives the same candidates in the same order regardless of concurrency", async () => {
    const freshRunners = () => new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(answer), { cacheDir: mkdtempSync(join(tmpdir(), "po-")), datasetVersion: "t", stageVersions: {} })]));
    const a1 = await runStageA(data, findings, freshRunners(), { concurrency: 1, terms: null });
    const a3 = await runStageA(data, findings, freshRunners(), { concurrency: 3, terms: null });
    expect(a3.candidates.map((c) => c.candidateId)).toEqual(a1.candidates.map((c) => c.candidateId));
  });
});
