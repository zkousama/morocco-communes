import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import { makeRunner, stubTransport, type Runner } from "../../src/model.ts";
import { missingGeminiKey, runAndReport, runAndReportB } from "../../src/pilot/cli.ts";
import { runStageA, type StageA, type StageB } from "../../src/pilot/stages.ts";
import { ACTIVE_ADVERSARIES, ADVERSARIES, DROPPED_ADVERSARIES, PILOT_SEED, PROPOSERS } from "../../src/pilot/setups.ts";
import { sampleFindings } from "../../src/pilot/sample.ts";

const data = loadData();
const findings = sampleFindings(detect(data), PILOT_SEED).slice(0, 2);
const answer = (call: { model: string }) => JSON.stringify({ hypotheses: [{
  claim: { en: `claim by ${call.model}`, fr: "affirmation" }, link: { en: "link", fr: "lien" }, premise: { en: "premise", fr: "prémisse" },
  test: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 0 } },
  linkTest: null, artefact: false,
}] });

describe("runAndReport", () => {
  it("writes the file and logs progress and usage once stage A succeeds", async () => {
    const runners = new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(answer), { cacheDir: mkdtempSync(join(tmpdir(), "car-")), datasetVersion: "t", stageVersions: {} })]));
    const logs: string[] = [];
    const errors: string[] = [];
    let written: unknown = null;
    const ok = await runAndReport(data, findings, runners, { concurrency: 2, terms: null }, {
      log: (l) => logs.push(l),
      error: (l) => errors.push(l),
      write: async (v) => { written = v; },
    });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
    expect(written).not.toBeNull();
    expect(logs.some((l) => l.startsWith("usage: P1"))).toBe(true);
    expect(logs.some((l) => l.startsWith("wrote "))).toBe(true);
  });

  it("reports a stage A failure through error(), with its own wording, and never writes", async () => {
    const failing: Runner = async () => { throw new Error("couldn't start claude: spawn claude ENOENT"); };
    const runners = new Map(PROPOSERS.map((p) => [p.id, failing]));
    const errors: string[] = [];
    let wrote = false;
    const ok = await runAndReport(data, findings, runners, { concurrency: 2, terms: null }, {
      log: () => {},
      error: (l) => errors.push(l),
      write: async () => { wrote = true; },
    });
    expect(ok).toBe(false);
    expect(wrote).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^stage A stopped: .*; answers so far are cached, run it again to resume$/);
  });
});

describe("runAndReportB", () => {
  it("runs with runners for the active runs alone, says which run was dropped and why, and writes that down", async () => {
    const proposerRunners = new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(answer), { cacheDir: mkdtempSync(join(tmpdir(), "cdr-")), datasetVersion: "t", stageVersions: {} })]));
    const a = await runStageA(data, findings, proposerRunners, { concurrency: 1, terms: null });
    const answering = makeRunner(stubTransport(() => JSON.stringify({ counter: null, reason: "r" })), { cacheDir: mkdtempSync(join(tmpdir(), "cda-")), datasetVersion: "t", stageVersions: {} });
    const adv = new Map(ACTIVE_ADVERSARIES.map((r) => [r.id, answering]));
    const logs: string[] = [];
    const errors: string[] = [];
    let stageB: StageB | null = null;
    let candidates: { dropped?: unknown } | null = null;
    const ok = await runAndReportB(data, a, adv, { concurrency: 1, terms: null }, {
      log: (l) => logs.push(l),
      error: (l) => errors.push(l),
      writeStageB: async (v) => { stageB = v as StageB; },
      writeCandidates: async (v) => { candidates = v as { dropped?: unknown }; },
    });
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    expect(stageB!.dropped).toEqual(DROPPED_ADVERSARIES);
    expect(candidates!.dropped).toEqual(DROPPED_ADVERSARIES);
    for (const [id, reason] of Object.entries(DROPPED_ADVERSARIES)) {
      expect(logs).toContain(`${id} dropped, not run: ${reason}`);
      expect(logs.some((l) => l.startsWith(`usage: ${id} `))).toBe(false);
    }
    for (const role of ACTIVE_ADVERSARIES) expect(logs.some((l) => l.startsWith(`usage: ${role.id} `))).toBe(true);
  });

  it("prints 'unusable' rather than 'broke' when a run simply couldn't answer", async () => {
    const proposerRunners = new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(answer), { cacheDir: mkdtempSync(join(tmpdir(), "cbb-")), datasetVersion: "t", stageVersions: {} })]));
    const a = await runStageA(data, findings, proposerRunners, { concurrency: 1, terms: null });
    const failing: Runner = async () => { throw new Error("claude exited 1: overloaded"); };
    const adv = new Map(ADVERSARIES.map((r) => [r.id, failing]));
    const logs: string[] = [];
    await runAndReportB(data, a, adv, { concurrency: 1, terms: null }, {
      log: (l) => logs.push(l),
      error: () => {},
      writeStageB: async () => {},
      writeCandidates: async () => {},
    });
    expect(logs.some((l) => l.includes("unusable (no answer)"))).toBe(true);
    expect(logs.some((l) => l.includes("broke ("))).toBe(false);
  });

  it("reports a setup mistake as a refusal to start, not a mid-run halt", async () => {
    const proposerRunners = new Map(PROPOSERS.map((p) => [p.id, makeRunner(stubTransport(answer), { cacheDir: mkdtempSync(join(tmpdir(), "sf-")), datasetVersion: "t", stageVersions: {} })]));
    const a = await runStageA(data, findings, proposerRunners, { concurrency: 1, terms: null });
    // Every candidate now names a finding id detect(data) doesn't have: a setup mistake
    // found before any call, never a halt part-way through one.
    const brokenA: StageA = { ...a, candidates: a.candidates.map((c) => ({ ...c, findingId: "not-a-real-finding-id" })) };
    const neverCalled: Runner = async () => { throw new Error("should never be called"); };
    const adv = new Map(ADVERSARIES.map((r) => [r.id, neverCalled]));
    const errors: string[] = [];
    const ok = await runAndReportB(data, brokenA, adv, { concurrency: 1, terms: null }, {
      log: () => {},
      error: (l) => errors.push(l),
      writeStageB: async () => {},
      writeCandidates: async () => {},
    });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^stage B can't start: .*finding id/);
    expect(errors[0]).not.toContain("answers so far are cached");
  });
});

describe("missingGeminiKey", () => {
  it("refuses when an adversary needs gemini and the key is missing", () => {
    expect(missingGeminiKey(ADVERSARIES, null)).toMatch(/GEMINI_API_KEY/);
    expect(missingGeminiKey(ADVERSARIES, { terms: [], keys: {} })).toMatch(/GEMINI_API_KEY/);
  });
  it("passes once the key is there", () => {
    expect(missingGeminiKey(ADVERSARIES, { terms: [], keys: { GEMINI_API_KEY: "x" } })).toBeNull();
  });
  it("never checks for a key when nothing needs gemini", () => {
    expect(missingGeminiKey(PROPOSERS, null)).toBeNull();
  });
  it("never checks for a key for the active runs: the one gemini run is dropped", () => {
    expect(ACTIVE_ADVERSARIES.some((r) => r.transport === "gemini")).toBe(false);
    expect(missingGeminiKey(ACTIVE_ADVERSARIES, null)).toBeNull();
  });
});
