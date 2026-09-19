import { describe, expect, it } from "vitest";
import { readSheetRows } from "../../src/lib/xlsx.ts";
import {
  HOUSEHOLD_FIELDS,
  PEOPLE_FIELDS,
  householdLayout,
  parseHcpIndicators,
  peopleColumns,
  peopleLayout,
  toCell,
  type IndicatorRow,
} from "../../src/sources/hcpIndicators.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const bytes = readCachedWorkbook(".cache/hcp-indicateurs-2024.xlsx");
const rows = parseHcpIndicators(bytes);
// Read once: a people sheet is 14 MB of XML.
const totalPeople = readSheetRows(bytes, 1);
const urbanPeople = readSheetRows(bytes, 2);
const totalHouseholds = readSheetRows(bytes, 4);
const ruralHouseholds = readSheetRows(bytes, 6);
const copy = (sheet: (string | null)[][]) => sheet.map((r) => [...r]);

/** A figure off a parsed row, by its path. */
const people = (row: IndicatorRow, area: "total" | "urban" | "rural", sex: "all" | "male" | "female", path: string) =>
  row.people[area][sex][peopleColumns(sex).findIndex((f) => `${f.topic}.${f.key}` === path)];
const homes = (row: IndicatorRow, area: "total" | "urban" | "rural", path: string) =>
  row.households[area][HOUSEHOLD_FIELDS.findIndex((f) => `${f.topic}.${f.key}` === path)];

describe("toCell", () => {
  it("reads HCP's two signs", () => {
    expect(toCell("…", "percent")).toBe("n/a");
    expect(toCell(".", "percent")).toBe("unavailable");
  });

  it("drops the binary noise the workbook stores", () => {
    expect(toCell("9.3000000000000007", "percent")).toBe(9.3);
    expect(toCell("1.97", "births per woman")).toBe(1.97);
    expect(toCell("36828330", "people")).toBe(36828330);
  });

  it("refuses anything else", () => {
    expect(() => toCell("n.d.", "percent")).toThrow(/unreadable/);
  });
});

describe("the layout checks", () => {
  it("accept the workbook as published", () => {
    expect(() => peopleLayout(totalPeople, "total")).not.toThrow();
    expect(() => householdLayout(ruralHouseholds, "rural")).not.toThrow();
  });

  it("refuse a people sheet with a heading moved", () => {
    const sheet = copy(totalPeople);
    sheet[1]![57] = "Taux d'activité des 15 ans et plus (%)";
    expect(() => peopleLayout(sheet, "total")).toThrow(/column 57/);
  });

  it("refuse a household sheet with two categories swapped", () => {
    const sheet = copy(totalHouseholds);
    [sheet[1]![23], sheet[1]![24]] = [sheet[1]![24]!, sheet[1]![23]!];
    expect(() => householdLayout(sheet, "total")).toThrow(/Électricité/);
  });

  it("refuse the wrong area", () => {
    expect(() => peopleLayout(urbanPeople, "rural")).toThrow(/corner/);
  });
});

describe("parseHcpIndicators", () => {
  it("reads every row of the six sheets", () => {
    expect(rows).toHaveLength(2017);
    expect(rows[0]!.code).toBeNull();
    expect(rows.filter((r) => r.label.startsWith("dont le centre urbain"))).toHaveLength(164);
  });

  it("puts the national figures under the right names", () => {
    const nation = rows[0]!;
    expect(people(nation, "total", "all", "population.legal")).toBe(36828330);
    expect(people(nation, "total", "all", "population.municipal")).toBe(36490591);
    expect(people(nation, "total", "all", "fertility.totalFertilityRate")).toBe(1.97);
    expect(people(nation, "total", "all", "labour.unemploymentRate")).toBe(21.3);
    expect(people(nation, "total", "female", "labour.activityRate")).toBe(16.8);
    expect(people(nation, "total", "male", "maritalStatus.singulateMeanAgeAtMarriage")).toBe(32.4);
    expect(people(nation, "total", "female", "illiteracy.rate15Plus")).toBe(36.2);
    expect(people(nation, "total", "all", "localLanguages.tachelhit")).toBe(14.2);
    expect(homes(nation, "total", "households.averageSize")).toBe(3.9);
    expect(homes(nation, "total", "amenities.runningWater")).toBe(82.9);
    expect(homes(nation, "rural", "households.municipalPopulation")).toBe(13569389);
  });

  it("gives men no fertility figures, and only the whole population a legal count and a sex split", () => {
    const ids = (sex: "all" | "male" | "female") => peopleColumns(sex).map((f) => `${f.topic}.${f.key}`);
    expect(ids("male")).not.toContain("fertility.totalFertilityRate");
    expect(ids("female")).toContain("fertility.totalFertilityRate");
    expect(ids("female")).not.toContain("population.legal");
    expect(ids("all")).toHaveLength(65);
    expect(ids("male")).toHaveLength(60);
    expect(ids("female")).toHaveLength(62);
    expect(PEOPLE_FIELDS).toHaveLength(65);
    expect(HOUSEHOLD_FIELDS).toHaveLength(36);
  });

  it("marks the area a unit doesn't have as not applicable", () => {
    const tanger = rows.find((r) => r.code === "1511010")!;
    expect(tanger.people.rural.all.every((c) => c === "n/a")).toBe(true);
    expect(people(tanger, "urban", "all", "population.municipal")).toBe(1272718);
    expect(homes(tanger, "total", "households.distanceToPavedRoadKm")).toBe("n/a");
  });

  it("keeps the asterisk on the four communes HCP marks", () => {
    expect(rows.filter((r) => r.label.endsWith("*")).map((r) => r.code)).toEqual([
      "123910505", "120660103", "120660303", "120660309",
    ]);
  });
});
