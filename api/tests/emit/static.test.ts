import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATASET_VERSION } from "../../../pipeline/src/sources/registry.ts";
import { emitTree, HEADERS_FILE } from "../../src/emit/static.ts";
import { PER_PAGE } from "../../src/lib/envelope.ts";
import type { Dataset } from "../../src/lib/dataset.ts";

const read = (name: string) =>
  JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as never[];

const d: Dataset = {
  regions: read("regions"),
  provinces: read("provinces"),
  cercles: read("cercles"),
  communes: read("communes"),
  arrondissements: read("arrondissements"),
  adjacency: JSON.parse(readFileSync("data/v1/geometry/adjacency.json", "utf8")),
  sources: JSON.parse(readFileSync("data/v1/sources.json", "utf8")),
};
const tree = emitTree(d);

/** Counted from the dataset, not read back off the tree, so the two can disagree. */
const pagesOver = (groups: number[]) => groups.reduce((n, size) => n + Math.max(1, Math.ceil(size / PER_PAGE)), 0);
const sizes = <T>(rows: T[], key: (r: T) => string | null, keys: string[]) =>
  keys.map((k) => rows.filter((r) => key(r) === k).length);

describe("emitTree", () => {
  it("emits exactly the file count the endpoint inventory implies", () => {
    const regionCodes = d.regions.map((r) => r.code);
    const provinceCodes = d.provinces.map((p) => p.code);
    const cercleCodes = d.cercles.map((c) => c.code);

    const expected =
      1 + // version
      1 + d.regions.length + d.regions.length + // regions list, detail, nested provinces
      pagesOver(sizes(d.communes, (c) => c.parents.region, regionCodes)) +
      1 + d.provinces.length + d.provinces.length + // provinces list, detail, nested cercles
      pagesOver(sizes(d.communes, (c) => c.parents.province, provinceCodes)) +
      1 + d.cercles.length + // cercles list, detail
      pagesOver(sizes(d.communes, (c) => c.parents.cercle, cercleCodes)) +
      Math.ceil(d.communes.length / PER_PAGE) +
      pagesOver([d.communes.filter((c) => c.type === "urban").length]) +
      pagesOver([d.communes.filter((c) => c.type === "rural").length]) +
      d.communes.length + d.communes.length + d.communes.length + // commune detail, nested arrondissements, neighbours
      1 + d.arrondissements.length; // arrondissements list, detail

    expect(tree.size).toBe(expected);
    // Named outright: adding an endpoint has to be a deliberate edit here, and the tree
    // has to stay well inside Cloudflare's 20,000-file ceiling.
    expect(tree.size).toBe(5355);
    expect(tree.size).toBeLessThan(20_000);
  });

  it("gives every code in every level a file", () => {
    for (const r of d.regions) expect(tree.has(`/api/regions/${r.code}.json`)).toBe(true);
    for (const p of d.provinces) expect(tree.has(`/api/provinces/${p.code}.json`)).toBe(true);
    for (const c of d.cercles) expect(tree.has(`/api/cercles/${c.code}.json`)).toBe(true);
    for (const c of d.communes) expect(tree.has(`/api/communes/${c.code}.json`)).toBe(true);
    for (const a of d.arrondissements) expect(tree.has(`/api/arrondissements/${a.code}.json`)).toBe(true);
  });

  it("gives the 8 préfectures with no communes an empty page 1 rather than nothing", () => {
    const childless = d.provinces.filter((p) => !d.communes.some((c) => c.parents.province === p.code));
    expect(childless.length).toBe(8);
    for (const p of childless) {
      const body = tree.get(`/api/provinces/${p.code}/communes/page/1.json`)!;
      expect(body.data).toEqual([]);
      expect(body.meta).toMatchObject({ page: 1, total: 0, totalPages: 1 });
      expect(body.links.next).toBeNull();
    }
  });

  it("gives the 1,497 communes with no arrondissements an empty list, not a 404", () => {
    const withArrondissements = new Set(d.arrondissements.map((a) => a.communeCode));
    expect(withArrondissements.size).toBe(6);
    const without = d.communes.filter((c) => !withArrondissements.has(c.code));
    expect(without.length).toBe(1497);
    expect(tree.get(`/api/communes/${without[0]!.code}/arrondissements.json`)!.data).toEqual([]);
    const tanger = tree.get("/api/communes/01.511.01.0/arrondissements.json")!;
    expect((tanger.data as unknown[]).length).toBe(4);
  });

  it("chains pagination links across a multi-page list", () => {
    const total = Math.ceil(d.communes.length / PER_PAGE);
    expect(tree.get("/api/communes/page/1.json")!.links).toEqual({
      self: "/api/communes/page/1.json",
      prev: null,
      next: "/api/communes/page/2.json",
    });
    const last = tree.get(`/api/communes/page/${total}.json`)!;
    expect(last.links.next).toBeNull();
    expect(last.links.prev).toBe(`/api/communes/page/${total - 1}.json`);
    expect((last.data as unknown[]).length).toBe(d.communes.length - (total - 1) * PER_PAGE);
  });

  it("reaches every commune exactly once by walking the pages", () => {
    const seen: string[] = [];
    for (let page = 1; ; page++) {
      const body = tree.get(`/api/communes/page/${page}.json`);
      if (!body) break;
      for (const c of body.data as { code: string }[]) seen.push(c.code);
    }
    expect(seen.length).toBe(1503);
    expect(new Set(seen).size).toBe(1503);
  });

  it("envelopes every file with a self link that matches its own path", () => {
    for (const [path, body] of tree) {
      expect(body.links.self, path).toBe(path);
      expect(body.meta.datasetVersion, path).toBe(DATASET_VERSION);
      expect("prev" in body.links && "next" in body.links, path).toBe(true);
    }
  });

  it("records that type and cercle-presence are the same filter", () => {
    // Measured: 242 urban communes, all with no cercle; 1,261 rural, all with one. The
    // emitter keys ?type= pages off the type field rather than off cercle-presence, so
    // this is here to notice if the two ever stop agreeing rather than to require it.
    const urban = d.communes.filter((c) => c.type === "urban");
    const rural = d.communes.filter((c) => c.type === "rural");
    expect(urban.length).toBe(242);
    expect(rural.length).toBe(1261);
    expect(urban.filter((c) => c.parents.cercle !== null)).toEqual([]);
    expect(rural.filter((c) => c.parents.cercle === null)).toEqual([]);
  });

  it("paginates the type filters, which span the whole country", () => {
    expect(tree.has("/api/communes/type/urban/page/5.json")).toBe(true);
    expect(tree.has("/api/communes/type/rural/page/26.json")).toBe(true);
    expect(tree.has("/api/communes/type/urban/page/6.json")).toBe(false);
    const page1 = tree.get("/api/communes/type/urban/page/1.json")!;
    for (const c of page1.data as { type: string }[]) expect(c.type).toBe("urban");
    expect(page1.meta.total).toBe(242);
  });

  it("reports the record counts and the source vintages at /api/version.json", () => {
    const body = tree.get("/api/version.json")!;
    const data = body.data as { api: string; counts: Record<string, number>; sources: { sources: { id: string }[] } };
    expect(data.api).toBe("v1");
    expect(data.counts).toEqual({ regions: 12, provinces: 83, cercles: 213, communes: 1503, arrondissements: 41 });
    expect(data.sources.sources.map((s) => s.id)).toContain("osm");
  });

  it("is deterministic: the same dataset emits the same tree", () => {
    const again = emitTree(d);
    expect([...again.keys()]).toEqual([...tree.keys()]);
    expect(JSON.stringify([...again.values()])).toBe(JSON.stringify([...tree.values()]));
  });
});

describe("HEADERS_FILE", () => {
  it("opens CORS on the asset tier, which Worker code never sees", () => {
    expect(HEADERS_FILE).toContain("/api/*");
    expect(HEADERS_FILE).toContain("Access-Control-Allow-Origin: *");
    expect(HEADERS_FILE).toContain("/data/*");
  });

  it("types the .topojson files, which the asset store serves with no Content-Type", () => {
    // Measured against wrangler dev: an unknown extension gets no content-type header at
    // all, and a _headers rule does override it.
    expect(HEADERS_FILE).toContain("/data/v1/geometry/*.topojson");
    expect(HEADERS_FILE).toContain("Content-Type: application/json");
  });
});
