import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildIndicators, type IndicatorRecord } from "../../src/build/indicators.ts";
import { buildEconomy, type EconomyRecord } from "../../src/build/economy.ts";
import { checkEconomy } from "../../src/validate/economy.ts";
import { parseHcpIndicators } from "../../src/sources/hcpIndicators.ts";
import { parseHcpEstablishments, toCount } from "../../src/sources/hcpEstablishments.ts";
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
const rows = parseHcpEstablishments(readCachedWorkbook(".cache/hcp-etablissements-2024.xlsx"));
const economy = buildEconomy(rows, records);

type Commune = { code: string; parents: { cercle: string | null } };
type Arrondissement = { communeCode: string };
const cercleOf = new Map((units.communes as Commune[]).map((c) => [c.code, c.parents.cercle]));
const published = records.filter((r) => r.code !== null).map((r) => ({ code: r.code!, level: r.level, name: r.name.fr }));
const cities = new Set((units.arrondissements as Arrondissement[]).map((a) => a.communeCode));

const at = (l: string) => economy.records.filter((r) => r.level === l).length;
const byCode = new Map(economy.records.map((r) => [r.code ?? "", r]));
const one = (code: string) => structuredClone(byCode.get(code)!);
const check = (...changed: EconomyRecord[]) => {
  const all = economy.records.map((r) => changed.find((c) => c.code === r.code) ?? r);
  return checkEconomy(all, cercleOf, published, cities).join("\n");
};

describe("toCount", () => {
  it("rounds off what the workbook's arithmetic left behind", () => {
    expect(toCount("3585475.000000014")).toBe(3585475);
    expect(toCount("98")).toBe(98);
  });

  it("reads an empty cell as no figure", () => {
    expect(toCount("")).toBe(null);
    expect(toCount(null)).toBe(null);
  });
});

describe("parseHcpEstablishments", () => {
  it("reads a row per unit, from the country down to the commune", () => {
    expect(rows).toHaveLength(1847);
    expect(rows[0]!.label).toBe("Total Royaume du Maroc");
    expect(rows[0]!.counts).toHaveLength(22);
  });

  it("carries HCP's national figures", () => {
    const national = rows[0]!.counts;
    expect(national.slice(0, 6)).toEqual([1304564, 147062, 27481, 1022, 1130021, 3585475]);
  });
});

describe("buildEconomy", () => {
  it("lands every row on a unit the dataset publishes", () => {
    expect(economy.unplaced).toEqual([]);
    expect(economy.records).toHaveLength(1847);
    expect(at("country")).toBe(1);
    expect(at("region")).toBe(12);
    expect(at("province")).toBe(83);
    expect(at("cercle")).toBe(213);
    expect(at("commune")).toBe(1497);
    expect(at("arrondissement")).toBe(41);
  });

  it("gives Casablanca's préfectures their own figures, and the city itself none", () => {
    // The workbook writes the first préfecture's code the way the population file writes
    // the commune of Casablanca's, so reading the code alone would put Anfa's figures on
    // the whole city.
    expect(byCode.has("06.141.01.0")).toBe(false);
    expect(byCode.get("06.141.01.00")!.name.fr).toBe("Casablanca-Anfa");
    expect(byCode.get("06.141.01.00")!.topics.establishments!.total).toBe(33791);
  });

  it("leaves the six cities with arrondissements to their arrondissements", () => {
    for (const city of ["01.511.01.0", "03.231.01.0", "04.421.01.0", "04.441.01.0", "06.141.01.0", "07.351.01.0"]) {
      expect(byCode.has(city), city).toBe(false);
    }
    expect(byCode.get("01.511.01.07")!.topics.establishments!.total).toBe(16970);
  });
});

describe("checkEconomy", () => {
  it("passes the workbook as published", () => {
    expect(checkEconomy(economy.records, cercleOf, published, cities)).toEqual([]);
  });

  it("catches an establishment total its three kinds don't make", () => {
    const unit = one("01.051.01.01");
    unit.topics.establishments!.publicServices = 1;
    expect(check(unit)).toMatch(/publicServices, nonProfit, business make .*, not the 3044 establishments counted/);
  });

  it("catches a split that no longer covers the businesses", () => {
    const unit = one("01.051.01.01");
    unit.topics.sector!.commerce = 0;
    expect(check(unit)).toMatch(/by sector the businesses make /);
  });

  it("catches a unit whose figures its children no longer add to", () => {
    const unit = one("01.051.01.01");
    unit.topics.founded!["2020+"] = (unit.topics.founded!["2020+"] ?? 0) + 4;
    unit.topics.establishments!.business = (unit.topics.establishments!.business ?? 0) + 4;
    unit.topics.establishments!.total = (unit.topics.establishments!.total ?? 0) + 4;
    expect(check(unit)).toMatch(/hold .* of establishments\.total, the unit itself/);
  });

  it("wants a row for every unit but the cities counted through their arrondissements", () => {
    const problems = checkEconomy([], cercleOf, published, cities);
    expect(problems).toContain("01.051.01.01 Al Hoceima: no row of establishments");
    expect(problems.join()).not.toMatch(/01\.511\.01\.0 Tanger/);
  });
});
