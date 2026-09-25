import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { makeRunner, stubTransport } from "../src/model.ts";
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
