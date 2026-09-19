import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildIndicators, type IndicatorRecord } from "../../src/build/indicators.ts";
import { buildIndicators2014, nameOf, similarity, type Indicator2014Block } from "../../src/build/indicators2014.ts";
import { checkIndicators2014 } from "../../src/validate/indicators2014.ts";
import { parseHcpIndicators } from "../../src/sources/hcpIndicators.ts";
import { parseHcp2014Indicators } from "../../src/sources/hcp2014Indicators.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const level = (name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8"));
const units = {
  regions: level("regions"),
  provinces: level("provinces"),
  cercles: level("cercles"),
  communes: level("communes"),
  arrondissements: level("arrondissements"),
};
const records: IndicatorRecord[] = buildIndicators(
  parseHcpIndicators(readCachedWorkbook(".cache/hcp-indicateurs-2024.xlsx")),
  units,
);
const rows = parseHcp2014Indicators(
  readCachedWorkbook(".cache/hcp-indicateurs-2014-population.xlsx"),
  readCachedWorkbook(".cache/hcp-indicateurs-2014-menages.xlsx"),
);
const crosswalk = new Map<string, string>(
  (JSON.parse(readFileSync("data/v1/crosswalk/2014-2024.json", "utf8")) as { code2014: string; code2024: string }[]).map((r) => [
    r.code2014.replace(/\D/g, ""),
    r.code2024,
  ]),
);
type Commune = { code: string; population: { "2014": { total: number | null; households: number | null } | null } };
const communes = units.communes as Commune[];
const population = new Map(communes.map((c) => [c.code, c.population["2014"]?.total ?? null]));
const published = new Map(
  communes.map((c) => [c.code, { population: c.population["2014"]?.total ?? null, households: c.population["2014"]?.households ?? null }]),
);
const names = new Map(records.map((r) => [r.code ?? "", r.name.fr]));

const placed = buildIndicators2014(rows, records, crosswalk, population);
const levelOf = new Map(records.map((r) => [r.code ?? "", r.level]));
const count = (l: string) => [...placed.byCode.keys()].filter((code) => levelOf.get(code) === l).length;
const block = (code: string) => structuredClone(placed.byCode.get(code)!);
const figures = (code: string) => placed.byCode.get(code)!.people.total!.all;

describe("similarity", () => {
  it("holds two spellings of one name together", () => {
    expect(similarity("Rhafsai", "Ghafsai")).toBeGreaterThan(0.5);
    expect(similarity("My Driss Aghbal", "Moulay Driss Aghbal")).toBeGreaterThan(0.5);
  });

  it("keeps two names apart", () => {
    expect(similarity("Kettara", "M'Nabha")).toBeLessThan(0.2);
  });
});

describe("nameOf", () => {
  it("takes off the label HCP prints in front of the name", () => {
    expect(nameOf("Cercle : Targuist")).toBe("Targuist");
    expect(nameOf("Al Hoceima (Mun.)")).toBe("Al Hoceima");
    expect(nameOf("Dont Centre: Tamassint")).toBe("Tamassint");
    expect(nameOf("Préfecture d’Arrondissements Ben M’sick")).toBe("Ben M’sick");
    expect(nameOf("Tanger-Médina (Arrond.)")).toBe("Tanger-Médina");
  });
});

describe("buildIndicators2014", () => {
  it("lands the rows on the units the dataset publishes today", () => {
    expect(placed.byCode.size).toBe(1965);
    expect(count("region")).toBe(12);
    expect(count("province")).toBe(83);
    expect(count("cercle")).toBe(183);
    expect(count("commune")).toBe(1497);
    expect(count("arrondissement")).toBe(41);
    expect(count("urbanCentre")).toBe(148);
    expect(placed.byCode.has("")).toBe(true);
  });

  it("gives Casablanca's préfectures their 2014 figures, and the city itself none", () => {
    // 2014 wrote the first préfecture's code the way 2024 writes the commune of
    // Casablanca's, so reading the code alone would put Anfa's figures on the city.
    expect(placed.byCode.has("06.141.01.0")).toBe(false);
    expect(figures("06.141.01.00").population!.legal).toBe(454908);
    expect(names.get("06.141.01.00")).toBe("Casablanca-Anfa");
  });

  it("leaves the six cities with arrondissements to their arrondissements", () => {
    for (const city of ["01.511.01.0", "03.231.01.0", "04.421.01.0", "04.441.01.0", "06.141.01.0", "07.351.01.0"]) {
      expect(placed.byCode.has(city), city).toBe(false);
    }
    expect(figures("01.511.01.07").population!.legal).toBe(243082);
  });

  it("follows the crosswalk where a commune's code changed", () => {
    // Ait Kamra was 01.051.05.01 in 2014 and is 01.051.11.01 now.
    expect(figures("01.051.11.01").population!.legal).toBe(7685);
  });

  it("takes a name the census rewrote, when the population workbook says it is one place", () => {
    expect(placed.renamed).toEqual([{ code: "03.531.03.09", name2014: "Ouartzagh", name2024: "Ourtzarh" }]);
  });

  it("says why each row it couldn't place has no unit", () => {
    expect(placed.unplaced).toHaveLength(14);
    expect(placed.unplaced.filter((u) => u.label.startsWith("Cercle"))).toHaveLength(13);
    expect(placed.unplaced.find((u) => u.label.includes("M'Nabha"))!.reason).toContain("Kettara");
  });
});

describe("checkIndicators2014", () => {
  it("passes the workbooks as published", () => {
    expect(checkIndicators2014(placed.byCode, names, published)).toEqual([]);
  });

  it("catches a population that disagrees with the population workbook", () => {
    const one = block("01.051.01.01");
    one.people.total!.all.population!.legal = 1;
    const problems = checkIndicators2014(new Map([["01.051.01.01", one]]), names, published);
    expect(problems.join()).toMatch(/legal population 1, the 2014 population file says/);
  });

  it("catches a share group that no longer sums", () => {
    const one = block("01.051.01.01");
    one.households.total!.occupancy!.owner = 10;
    const problems = checkIndicators2014(new Map([["01.051.01.01", one]]), names, published);
    expect(problems.join()).toMatch(/occupancy sums to/);
  });

  it("catches the labour counts falling short of the people counted", () => {
    const one = block("01.051.01.01");
    one.people.total!.all.labour!.active = 3;
    const problems = checkIndicators2014(new Map([["01.051.01.01", one]]), names, published);
    expect(problems.join()).toMatch(/active and .* inactive make/);
  });

  it("wants a national row", () => {
    expect(checkIndicators2014(new Map<string, Indicator2014Block>(), names, published)).toContain("no national row");
  });
});
