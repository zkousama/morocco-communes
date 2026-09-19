import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex } from "../../src/emit/searchIndex.ts";
import { readIndicators } from "../../src/emit/indicators.ts";
import { emitIndicators, type Tree } from "../../src/emit/static.ts";
import { buildIndicatorTable, indicatorProblem, INDICATOR_PATHS } from "../../src/lib/indicators.ts";
import { collectCommunes, listCommunes, parseFilter } from "../../src/lib/list.ts";
import { buildLookup } from "../../src/lib/resolve.ts";

const rd = (n: string) => JSON.parse(readFileSync(`data/v1/attributes/${n}.json`, "utf8")) as never[];
const communes = rd("communes") as { code: string; name: { fr: string } }[];
const lookup = buildLookup(
  buildIndex("1.0.0", [
    { level: "commune", rows: rd("communes") },
    { level: "arrondissement", rows: rd("arrondissements") },
    { level: "province", rows: rd("provinces") },
    { level: "region", rows: rd("regions") },
    { level: "cercle", rows: rd("cercles") },
  ]),
);
const records = await readIndicators("data/v1");
const table = buildIndicatorTable(records.filter((r) => r.level === "commune"));

describe("the indicator paths", () => {
  it("cover every people figure for everyone and every household figure", () => {
    expect(INDICATOR_PATHS).toHaveLength(65 + 36);
    expect(INDICATOR_PATHS).toContain("labour.unemploymentRate");
    expect(INDICATOR_PATHS).toContain("amenities.runningWater");
    expect(INDICATOR_PATHS).toContain("age.75+");
  });

  it("explain a wrong one in terms a model can act on", () => {
    expect(indicatorProblem("labour.unemploymentRate")).toBeNull();
    expect(indicatorProblem("labour.jobless")).toMatch(/^labour has no jobless; its keys are population15Plus, active/);
    expect(indicatorProblem("income.median")).toMatch(/^income.median isn't an indicator; the topics are population, sex, age/);
  });
});

describe("sorting communes by an indicator", () => {
  it("is accepted both ways", () => {
    for (const sort of ["labour.unemploymentRate", "-labour.unemploymentRate", "-age.75+"]) {
      expect(parseFilter({ sort }, lookup), sort).toEqual({ query: { page: 1, sort } });
    }
  });

  it("is refused with the topic's keys when a key is wrong", () => {
    expect(parseFilter({ sort: "-amenities.water" }, lookup)).toEqual({
      error: { kind: "invalid-query", detail: "sort: amenities has no water; its keys are kitchen, toilet, bathroom, electricity, runningWater" },
    });
  });

  it("orders by the commune's figure, with the ones HCP has none for last", () => {
    const path = "fertility.totalFertilityRate";
    const i = table.paths.indexOf(path);
    const sorted = collectCommunes({ page: 1, sort: `-${path}` }, communes as never[], table) as { code: string }[];
    const values = sorted.map((c) => table.values[c.code]![i]);
    const known = values.filter((v) => v !== null) as number[];
    expect(known).toEqual([...known].sort((a, b) => b - a));
    expect(values.slice(known.length).every((v) => v === null)).toBe(true);
    expect(values.length - known.length).toBeGreaterThan(0);
  });

  it("puts the figure on each row it lists", async () => {
    const listed = await listCommunes({ page: 1, region: "01", sort: "-labour.unemploymentRate" }, communes as never[], async () => null, table);
    const first = listed!.rows[0] as { code: string; indicator: { path: string; value: number } };
    expect(first.indicator).toEqual({ path: "labour.unemploymentRate", value: 80.2 });
  });
});

describe("emitIndicators", () => {
  const tree: Tree = new Map();
  emitIndicators(tree, records);

  it("writes a file for the country and for every unit", () => {
    expect(tree.size).toBe(1 + 12 + 83 + 213 + 1503 + 41);
    expect(tree.has("/api/indicators.json")).toBe(true);
    expect(tree.has("/api/cercles/01.511.05/indicators.json")).toBe(true);
    expect(tree.has("/api/arrondissements/01.511.01.05/indicators.json")).toBe(true);
  });

  it("puts a commune's urban centres in its file", () => {
    const dar = tree.get("/api/communes/01.511.05.07/indicators.json")!.data as { urbanCentres: { code: string }[] };
    expect(dar.urbanCentres.map((c) => c.code)).toEqual(["01.511.05.07.3"]);
    const tanger = tree.get("/api/communes/01.511.01.0/indicators.json")!.data as { urbanCentres: unknown[] };
    expect(tanger.urbanCentres).toEqual([]);
  });
});
