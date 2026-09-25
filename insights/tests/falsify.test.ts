import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import type { Finding } from "../src/detect.ts";
import { falsifierModel, falsify } from "../src/falsify.ts";
import { makeRunner, stubTransport } from "../src/model.ts";
import type { Candidate } from "../src/propose.ts";

const data = loadData();
const finding: Finding = { id: "f1", code: "04.421.01.0", level: "commune", measure: "fertility.totalFertilityRate", kind: "extreme", value: 1.19, reference: 2, score: 4, direction: "low" };
const candidate: Candidate = {
  claim: { en: "c", fr: "c" }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" },
  test: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 5 } },
  linkTest: null, artefact: false, support: 5,
};
const run = (answer: string) => makeRunner(stubTransport(() => answer), { cacheDir: mkdtempSync(join(tmpdir(), "f-")), datasetVersion: "t", stageVersions: { falsify: "1" } });

describe("falsify", () => {
  it("kills a candidate whose counter-test holds", async () => {
    const counter = { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 20 } };
    const v = await falsify(candidate, finding, data, run(JSON.stringify({ counter, reason: "most places with this much higher education don't have fertility this low" })), "opus");
    expect(v.survived).toBe(false);
  });

  it("keeps a candidate whose counter-test fails, or that gets no counter-test", async () => {
    const counter = { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: "<", right: { value: 1 } };
    expect((await falsify(candidate, finding, data, run(JSON.stringify({ counter, reason: "r" })), "opus")).survived).toBe(true);
    expect((await falsify(candidate, finding, data, run(JSON.stringify({ counter: null, reason: "nothing breaks it" })), "opus")).survived).toBe(true);
  });

  it("kills a candidate the adversary refuses on safety grounds", async () => {
    expect((await falsify(candidate, finding, data, run(JSON.stringify({ counter: null, reason: "r", refuse: "political" })), "opus")).survived).toBe(false);
  });

  it("uses another family where one is set up, and another Claude model otherwise", () => {
    expect(falsifierModel({ INSIGHTS_FALSIFIER: "ollama:qwen3:4b" }, "sonnet")).toEqual({ transport: "ollama", model: "qwen3:4b" });
    expect(falsifierModel({}, "sonnet")).toEqual({ transport: "claude", model: "opus" });
    expect(falsifierModel({}, "opus")).toEqual({ transport: "claude", model: "sonnet" });
  });

  it("stops a candidate at falsify when the adversary doesn't answer", async () => {
    const failing = makeRunner(async () => { throw new Error("ollama refused the connection"); },
      { cacheDir: mkdtempSync(join(tmpdir(), "f-")), datasetVersion: "t", stageVersions: { falsify: "1" } });
    const v = await falsify(candidate, finding, data, failing, "opus");
    expect(v).toMatchObject({ survived: false, stage: "falsify", reason: "the adversary didn't answer", model: null, counter: null });
  });

  it("stops a candidate at falsify when the adversary's answer can't be read, and asks again next time", async () => {
    let calls = 0;
    const cacheDir = mkdtempSync(join(tmpdir(), "f-"));
    const garbled = makeRunner(stubTransport(() => { calls += 1; return "not json"; }), { cacheDir, datasetVersion: "t", stageVersions: { falsify: "1" } });
    const v = await falsify(candidate, finding, data, garbled, "opus");
    expect(v).toMatchObject({ survived: false, stage: "falsify", reason: "the adversary's answer couldn't be read", model: "opus" });
    await falsify(candidate, finding, data, garbled, "opus");
    expect(calls).toBe(2);
  });

  it("keeps the adversary's reason, and who gave it, on a candidate that survives", async () => {
    const v = await falsify(candidate, finding, data, run(JSON.stringify({ counter: null, reason: "nothing breaks it" })), "opus");
    expect(v).toMatchObject({ survived: true, stage: null, reason: "nothing breaks it", model: "opus" });
  });

  it("says a refusal stops a candidate at safety, and a counter-test that holds at falsify", async () => {
    const counter = { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">", right: { value: 20 } };
    expect((await falsify(candidate, finding, data, run(JSON.stringify({ counter, reason: "r" })), "opus")).stage).toBe("falsify");
    expect((await falsify(candidate, finding, data, run(JSON.stringify({ counter: null, reason: "r", refuse: "groups" })), "opus")).stage).toBe("safety");
  });

  it("keeps a candidate alive when its own counter-test is refused, such as one on the finding's own measure", async () => {
    const counter = { check: "compare", left: { of: { unit: "self" }, field: "fertility.totalFertilityRate", year: 2024 }, op: ">", right: { value: 1 } };
    const v = await falsify(candidate, finding, data, run(JSON.stringify({ counter, reason: "r" })), "opus");
    expect(v.survived).toBe(true);
    expect(v.counterOutcome?.status).toBe("refused");
  });

  it("kills a candidate whose own text trips the word list, even with no counter-test", async () => {
    const bad: Candidate = { ...candidate, claim: { en: "The ministry's neglect lowered fertility", fr: "c" } };
    const v = await falsify(bad, finding, data, run(JSON.stringify({ counter: null, reason: "nothing breaks it" })), "opus");
    expect(v.survived).toBe(false);
  });
});
