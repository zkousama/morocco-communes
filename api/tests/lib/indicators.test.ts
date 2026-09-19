import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex } from "../../src/emit/searchIndex.ts";
import { readIndicators } from "../../src/emit/indicators.ts";
import { emitIndicators, type Tree } from "../../src/emit/static.ts";
import { buildIndicatorTable, changeBetween, COMPARABLE_2014, indicatorProblem, INDICATOR_PATHS } from "../../src/lib/indicators.ts";
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

describe("the two censuses", () => {
  it("carries the 2014 figures on the record, where the census counted the unit", () => {
    const assilah = records.find((r) => r.code === "01.511.01.01")!;
    expect(assilah["2014"]!.people.total!.all.illiteracy!.rate10Plus).toBe(21.7);
    expect(assilah.people.total!.all.illiteracy!.rate10Plus).toBe(16);
    // The 2014 census published Tanger by arrondissement, so the city has no row.
    expect(records.find((r) => r.code === "01.511.01.0")!["2014"]).toBeNull();
    expect(records.find((r) => r.code === "01.511.01.07")!["2014"]).not.toBeNull();
  });

  it("offers a 2014 figure only where the question didn't change", () => {
    expect(COMPARABLE_2014.get("illiteracy.rate10Plus")).toBe("illiteracy.rate10Plus");
    expect(COMPARABLE_2014.has("maritalStatus.single")).toBe(false);
    expect(COMPARABLE_2014.has("schooling.rate6to11")).toBe(false);
    expect(table.paths2014).toHaveLength(COMPARABLE_2014.size);
  });

  it("explains a path that 2014 asked another way", () => {
    expect(indicatorProblem("2014.illiteracy.rate10Plus")).toBeNull();
    expect(indicatorProblem("change.illiteracy.rate10Plus")).toBeNull();
    expect(indicatorProblem("2014.maritalStatus.single")).toMatch(
      /^maritalStatus.single is a 2024 figure the 2014 census didn't ask the same way/,
    );
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

  it("orders by the 2014 figure, and by the change since", () => {
    const path = "illiteracy.rate10Plus";
    const now = table.paths.indexOf(path);
    const before = table.paths2014.indexOf(path);
    const of = (code: string) => changeBetween(table.values[code]![now] ?? null, table.values2014[code]![before] ?? null);
    const sorted = collectCommunes({ page: 1, sort: `change.${path}` }, communes as never[], table) as { code: string }[];
    const changes = sorted.map((c) => of(c.code)).filter((v) => v !== null) as number[];
    expect(changes).toEqual([...changes].sort((a, b) => a - b));
    // Illiteracy fell almost everywhere, so the first commune's change is negative.
    expect(changes[0]).toBeLessThan(0);
    const in2014 = collectCommunes({ page: 1, sort: `-2014.${path}` }, communes as never[], table) as { code: string }[];
    const values = in2014.map((c) => table.values2014[c.code]![before]).filter((v) => v !== null) as number[];
    expect(values).toEqual([...values].sort((a, b) => b - a));
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
    expect(tree.size).toBe(1 + 12 + 83 + 213 + 1503 + 41 + 2);
    expect((tree.get("/api/provinces/indicators.json")!.data as unknown[]).length).toBe(83);
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
