import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import { makeRunner, stubTransport, type Runner } from "../../src/model.ts";
import { runAndReport } from "../../src/pilot/cli.ts";
import { PILOT_SEED, PROPOSERS } from "../../src/pilot/setups.ts";
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
