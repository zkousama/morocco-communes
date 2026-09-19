import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildIndicators, hcpCode, type IndicatorRecord } from "../../src/build/indicators.ts";
import { parseHcpIndicators } from "../../src/sources/hcpIndicators.ts";
import { checkIndicators } from "../../src/validate/indicators.ts";
import { columnOf, pathOf, snake } from "../../src/emit/indicators.ts";
import { HOUSEHOLD_FIELDS, PEOPLE_FIELDS } from "../../src/sources/hcpIndicators.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const level = (name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8"));
const units = {
  regions: level("regions"),
  provinces: level("provinces"),
  cercles: level("cercles"),
  communes: level("communes"),
  arrondissements: level("arrondissements"),
};
const rows = parseHcpIndicators(readCachedWorkbook(".cache/hcp-indicateurs-2024.xlsx"));
const records = buildIndicators(rows, units);
const published = new Map(
  (Object.values(units).flat() as { code: string; population: { "2024": { total: number; households: number } } }[]).map((u) => [
    u.code,
    { population: u.population["2024"].total, households: u.population["2024"].households },
  ]),
);
const tangerIn = (list: IndicatorRecord[]) => list.find((r) => r.code === "01.511.01.0")!;
/** Tanger alone, to change one figure in; the checks run per record. */
const tanger = () => structuredClone(tangerIn(records));

describe("buildIndicators", () => {
  it("gives every unit in the dataset its row, and places every urban centre", () => {
    const count = (l: string) => records.filter((r) => r.level === l).length;
    expect(count("country")).toBe(1);
    expect(count("region")).toBe(12);
    expect(count("province")).toBe(83);
    expect(count("cercle")).toBe(213);
    expect(count("commune")).toBe(1503);
    expect(count("arrondissement")).toBe(41);
    expect(count("urbanCentre")).toBe(164);
  });

  it("gives an urban centre its commune's code and one more digit", () => {
    const centre = records.find((r) => r.name.fr === "Dar Chaoui" && r.level === "urbanCentre")!;
    expect(centre).toMatchObject({ code: "01.511.05.07.3", codeDigits: "0151105073", communeCode: "01.511.05.07" });
  });

  it("leaves out the area a unit doesn't have", () => {
    const record = tangerIn(records);
    expect(record.people.rural).toBeNull();
    expect(record.households.rural).toBeNull();
    expect(record.people.urban?.all.population?.municipal).toBe(1272718);
  });

  it("refuses a row that matches nothing", () => {
    const stray = { ...rows[1]!, code: "99999", label: "Commune de Nulle Part" };
    expect(() => buildIndicators([...rows, stray], units)).toThrow(/Nulle Part matches no unit/);
  });

  it("refuses to leave a unit without figures", () => {
    const withoutTanger = rows.filter((r) => r.code !== hcpCode("001511010"));
    expect(() => buildIndicators(withoutTanger, units)).toThrow(/01.511.01.0 Tanger has no indicator row/);
  });
});

describe("checkIndicators", () => {
  it("passes HCP's figures as published", () => {
    expect(checkIndicators(records, published)).toEqual([]);
  });

  it("catches a legal population that isn't the population file's", () => {
    const record = tanger();
    record.people.total!.all.population!.legal = 1;
    expect(checkIndicators([record], published).join()).toMatch(/Tanger: legal population 1/);
  });

  it("catches two rates read from each other's columns", () => {
    const record = tanger();
    const labour = record.people.total!.all.labour!;
    [labour.activityRate, labour.unemploymentRate] = [labour.unemploymentRate!, labour.activityRate!];
    expect(checkIndicators([record], published).join()).toMatch(/activity rate/);
  });

  it("catches men and women read from the wrong blocks", () => {
    const record = tanger();
    record.people.total!.male.population!.municipal! += 1;
    expect(checkIndicators([record], published).join()).toMatch(/men and .* women make/);
  });

  it("catches a share read from the wrong column", () => {
    const record = tanger();
    record.households.total!.dwellingType!.apartment = 0;
    expect(checkIndicators([record], published).join()).toMatch(/dwellingType sums to/);
  });
});

describe("the names in the files", () => {
  it("are snake case in the CSVs", () => {
    expect(snake("75+")).toBe("75_plus");
    expect(snake("0-4")).toBe("0_4");
    expect(snake("population15Plus")).toBe("population_15_plus");
    expect(snake("rate6to11")).toBe("rate_6_to_11");
    expect(snake("under10")).toBe("under_10");
    expect(snake("distanceToPavedRoadKm")).toBe("distance_to_paved_road_km");
  });

  it("each have an English label, distinct within their topic", () => {
    for (const fields of [PEOPLE_FIELDS, HOUSEHOLD_FIELDS]) {
      for (const f of fields) expect(f.label.trim(), pathOf(f)).not.toBe("");
      const seen = new Set(fields.map((f) => `${f.topic} ${f.label}`));
      expect(seen.size).toBe(fields.length);
    }
  });

  it("never repeat", () => {
    const people = PEOPLE_FIELDS.map(columnOf);
    const homes = HOUSEHOLD_FIELDS.map(columnOf);
    expect(new Set(people).size).toBe(people.length);
    expect(new Set(homes).size).toBe(homes.length);
    const paths = [...PEOPLE_FIELDS, ...HOUSEHOLD_FIELDS].map(pathOf);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
