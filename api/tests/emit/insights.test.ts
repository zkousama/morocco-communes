import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readInsights } from "../../src/emit/insights.ts";
import { emitInsights } from "../../src/emit/static.ts";

describe("insights files", () => {
  it("serves each unit's insights at its own path, and an index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ins-"));
    mkdirSync(join(dir, "insights", "communes"), { recursive: true });
    writeFileSync(join(dir, "insights", "communes", "04.421.01.0.json"), JSON.stringify({ code: "04.421.01.0", level: "commune", findings: [] }));
    writeFileSync(join(dir, "insights", "index.json"), JSON.stringify([{ code: "04.421.01.0", level: "commune", findings: 1 }]));
    const tree = new Map();
    emitInsights(tree, await readInsights(dir));
    expect(tree.has("/api/communes/04.421.01.0/insights.json")).toBe(true);
    expect(tree.has("/api/insights.json")).toBe(true);
  });

  it("emits nothing when no insights are published yet", async () => {
    const tree = new Map();
    emitInsights(tree, await readInsights(mkdtempSync(join(tmpdir(), "none-"))));
    expect([...tree.keys()]).toEqual(["/api/insights.json"]);
  });

  it("throws on a corrupt index.json rather than publishing an empty index beside real unit files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bad-index-"));
    mkdirSync(join(dir, "insights", "communes"), { recursive: true });
    writeFileSync(join(dir, "insights", "communes", "04.421.01.0.json"), JSON.stringify({ code: "04.421.01.0", level: "commune", findings: [] }));
    writeFileSync(join(dir, "insights", "index.json"), "{not json");
    await expect(readInsights(dir)).rejects.toThrow(/index\.json/);
  });

  it("gives an empty index when index.json is missing but the insights directory exists with no units", async () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-dir-"));
    mkdirSync(join(dir, "insights"), { recursive: true });
    const read = await readInsights(dir);
    expect(read.units).toEqual([]);
    expect(read.index).toEqual([]);
  });
});
