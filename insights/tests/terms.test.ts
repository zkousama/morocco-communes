import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The real propose and falsify, each wrapped in a spy that only records what the pipeline
// hands it, so a test can see the private terms reach both.
vi.mock("../src/propose.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/propose.ts")>();
  return { ...actual, propose: vi.fn(actual.propose) };
});
vi.mock("../src/falsify.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/falsify.ts")>();
  return { ...actual, falsify: vi.fn(actual.falsify) };
});

import { loadData } from "../src/data.ts";
import { detect } from "../src/detect.ts";
import { falsify } from "../src/falsify.ts";
import { familyOf } from "../src/fields.ts";
import { makeRunner, stubTransport, type ModelCall } from "../src/model.ts";
import { propose } from "../src/propose.ts";
import { pipeline } from "../src/run.ts";
import { termsPattern } from "../src/safety.ts";
import { parseSetup } from "../src/setup.ts";

const data = loadData();
const setup = parseSetup({
  propose: { transport: "claude", model: "sonnet", effort: "high", samples: 5 },
  falsify: { transport: "claude", model: "opus", effort: "medium" },
  attackShownOnly: false,
  decidedBy: null,
});

const FIELDS_USED = ["labour.activityRate", "education.higher"];
const alwaysTrue = (field: string) => ({ check: "compare", left: { of: { unit: "self" }, field, year: 2024 }, op: ">", right: { value: -1000 } });
const hyp = (claim: string, field: string) => ({
  claim: { en: claim, fr: claim }, link: { en: "l", fr: "l" }, premise: { en: "p", fr: "p" }, test: alwaysTrue(field), linkTest: null, artefact: false,
});

/** A plausible finding, alone on its unit, whose own measure's family neither test field sits in. */
function namedFinding() {
  const all = detect(data);
  const perCode = new Map<string, number>();
  for (const f of all) perCode.set(f.code, (perCode.get(f.code) ?? 0) + 1);
  const found = all.find((f) => f.kind !== "artefact" && perCode.get(f.code) === 1 && !FIELDS_USED.some((x) => familyOf(f.measure).has(x)));
  if (!found) throw new Error("no finding isolated enough for this fixture");
  return found;
}

describe("the private terms in a run", () => {
  it("reach both propose and falsify, and drop a reason naming one", async () => {
    const finding = namedFinding();
    const proposal = JSON.stringify({ hypotheses: [hyp("kept", "labour.activityRate"), hyp("The Zorblat did it", "education.higher")] });
    const answers = (call: ModelCall) => (call.stage === "propose" ? proposal : JSON.stringify({ counter: null, reason: "no counter" }));
    const runner = () => makeRunner(stubTransport(answers), { cacheDir: mkdtempSync(join(tmpdir(), "t-")), datasetVersion: "t", stageVersions: { propose: "1", falsify: "1" } });
    const terms = termsPattern(["zorblat"]);

    const file = await pipeline(data, { only: [finding.code], run: runner(), falsifier: runner(), setup, terms });

    const proposeCalls = vi.mocked(propose).mock.calls;
    const falsifyCalls = vi.mocked(falsify).mock.calls;
    expect(proposeCalls.length).toBeGreaterThan(0);
    expect(falsifyCalls.length).toBeGreaterThan(0);
    for (const args of proposeCalls) expect(args[4]).toBe(terms);
    for (const args of falsifyCalls) expect(args[5]).toBe(terms);

    const claims = file.items.find((i) => i.finding.id === finding.id)!.hypotheses.map((h) => h.claim.en);
    expect(claims).toContain("kept");
    expect(claims).not.toContain("The Zorblat did it");
  });
});
