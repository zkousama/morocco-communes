import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATASET_VERSION } from "../../src/sources/registry.ts";
import { buildSources, checkSources, writeSources } from "../../src/emit/sources.ts";
import { readRegionCache } from "../../src/sources/overpass.ts";

const digests = {
  "hcp-2024": "a".repeat(64),
  "hcp-2024-indicators": "c".repeat(64),
  "hcp-2014": "b".repeat(64),
  "hcp-2014-indicators-people": "d".repeat(64),
  "hcp-2014-indicators-households": "e".repeat(64),
  "hcp-2024-commute": "f".repeat(64),
  "hcp-2014-mobility": "0".repeat(64),
  "hcp-2024-establishments": "1".repeat(64),
};
const retrieved = new Map([
  ["hcp-2024", "2026-09-17"],
  ["hcp-2024-indicators", "2026-09-19"],
  ["hcp-2014", "2026-09-17"],
  ["hcp-2014-indicators-people", "2026-09-19"],
  ["hcp-2014-indicators-households", "2026-09-19"],
  ["hcp-2024-commute", "2026-09-20"],
  ["hcp-2014-mobility", "2026-09-20"],
  ["hcp-2024-establishments", "2026-09-20"],
]);
const twelve = (t: string) => Array.from({ length: 12 }, () => t);

describe("buildSources", () => {
  it("pins each workbook to its digest and retrieval date", () => {
    const doc = buildSources(digests, retrieved, twelve("2026-09-17T18:00:00.000Z"));
    const hcp = doc.sources.find((s) => s.id === "hcp-2024")!;
    expect(hcp).toMatchObject({ sha256: "a".repeat(64), retrievedAt: "2026-09-17" });
    expect(doc.datasetVersion).toBe(DATASET_VERSION);
  });

  it("reports the OSM vintage as a range, because the twelve queries are hours apart", () => {
    const doc = buildSources(digests, retrieved, [
      "2026-09-17T18:54:00.000Z",
      "2026-09-17T17:53:00.000Z",
      ...Array.from({ length: 10 }, () => "2026-09-17T18:10:00.000Z"),
    ]);
    const osm = doc.sources.find((s) => s.id === "osm")!;
    expect("snapshot" in osm && osm.snapshot).toEqual({
      earliest: "2026-09-17T17:53:00.000Z",
      latest: "2026-09-17T18:54:00.000Z",
      regions: 12,
    });
  });

  it("carries the ODbL attribution, which has to travel with the geometry", () => {
    const doc = buildSources(digests, retrieved, twelve("2026-09-17T18:00:00.000Z"));
    const osm = doc.sources.find((s) => s.id === "osm")!;
    expect("licence" in osm && osm.licence).toBe("ODbL-1.0");
    expect("attribution" in osm && osm.attribution).toContain("OpenStreetMap contributors");
  });
});

describe("checkSources", () => {
  it("passes a complete document", () => {
    expect(checkSources(buildSources(digests, retrieved, twelve("2026-09-17T18:00:00.000Z")))).toEqual([]);
  });

  it("refuses a vintage that is missing rather than reporting unknown provenance", () => {
    const problems = checkSources(buildSources(digests, retrieved, twelve(null as unknown as string)));
    expect(problems).toContain("osm snapshot has no vintage");
  });

  it("refuses a partial OSM snapshot, so a short run cannot pass by having no régions", () => {
    const problems = checkSources(buildSources(digests, retrieved, ["2026-09-17T18:00:00.000Z"]));
    expect(problems).toContain("osm snapshot covers 1 régions, expected 12");
  });

  it("refuses an unpinned workbook", () => {
    const problems = checkSources(buildSources({}, retrieved, twelve("2026-09-17T18:00:00.000Z")));
    expect(problems).toContain("source hcp-2024 is not pinned to a digest");
    expect(problems).toContain("source hcp-2014 is not pinned to a digest");
  });

  it("refuses a workbook with no retrieval date", () => {
    const problems = checkSources(buildSources(digests, new Map(), twelve("2026-09-17T18:00:00.000Z")));
    expect(problems).toContain("source hcp-2024 has no retrieval date");
  });
});

describe("writeSources", () => {
  it("writes indented JSON with a trailing newline, like the rest of the dataset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sources-"));
    const doc = buildSources(digests, retrieved, twelve("2026-09-17T18:00:00.000Z"));
    await writeSources(doc, dir);
    const text = await readFile(join(dir, "sources.json"), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(doc);
  });
});

describe("readRegionCache", () => {
  it("reads an enveloped cache and reports the recorded endpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osm-cache-"));
    const path = join(dir, "01.json");
    await writeFile(
      path,
      JSON.stringify({
        fetchedAt: "2026-09-17T18:38:00.000Z",
        endpoint: "https://overpass.kumi.systems/api/interpreter",
        query: "[out:json];",
        elements: [{ id: 1, tags: {}, members: [] }],
      }),
    );
    const snapshot = await readRegionCache(path);
    expect(snapshot.fetchedAt).toBe("2026-09-17T18:38:00.000Z");
    expect(snapshot.endpoint).toBe("https://overpass.kumi.systems/api/interpreter");
    expect(snapshot.elements.length).toBe(1);
  });

  it("falls back to the mtime for a cache written before the envelope existed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osm-legacy-"));
    const path = join(dir, "02.json");
    await writeFile(path, JSON.stringify({ elements: [{ id: 2, tags: {}, members: [] }] }));
    const snapshot = await readRegionCache(path);
    expect(snapshot.endpoint).toBeNull();
    expect(snapshot.elements.length).toBe(1);
    // A real timestamp, not a placeholder, and close enough to now to be this write.
    expect(Date.now() - Date.parse(snapshot.fetchedAt!)).toBeLessThan(60_000);
  });

  it("refuses a cache file that holds no elements array", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osm-bad-"));
    const path = join(dir, "03.json");
    await writeFile(path, JSON.stringify({ remark: "runtime error: Query timed out" }));
    await expect(readRegionCache(path)).rejects.toThrow(/holds no elements array/);
  });
});

describe("the version the dataset publishes", () => {
  it("is the one the citation file gives", async () => {
    const citation = await readFile("CITATION.cff", "utf8");
    expect(citation).toContain(`version: ${DATASET_VERSION}`);
  });

  it("is the one the two packages give", async () => {
    const npm = JSON.parse(await readFile("packages/morocco-communes/package.json", "utf8")) as { version: string };
    const python = await readFile("packages/morocco-communes-py/pyproject.toml", "utf8");
    expect(npm.version).toBe(DATASET_VERSION);
    expect(python).toContain(`version = "${DATASET_VERSION}"`);
  });

  it("has an entry in the changelog, so a bump says what it did", async () => {
    const changelog = await readFile("CHANGELOG.md", "utf8");
    expect(changelog).toContain(`\n## ${DATASET_VERSION}\n`);
    // Every version the changelog names, newest first, with none skipped.
    const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)$/gm)].map((m) => m[1]!);
    expect(versions[0]).toBe(DATASET_VERSION);
    expect(versions).toEqual([...versions].sort((a, b) => b.localeCompare(a, "en", { numeric: true })));
  });
});
