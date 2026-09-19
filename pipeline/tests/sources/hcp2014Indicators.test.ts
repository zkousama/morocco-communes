import { describe, expect, it } from "vitest";
import { readSheetRows } from "../../src/lib/xlsx.ts";
import {
  HOUSEHOLD_FIELDS_2014,
  PEOPLE_FIELDS_2014,
  householdLayout2014,
  parseHcp2014Indicators,
  peopleColumns2014,
  peopleLayout2014,
  toCell2014,
  type Indicator2014Row,
} from "../../src/sources/hcp2014Indicators.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const peopleBytes = readCachedWorkbook(".cache/hcp-indicateurs-2014-population.xlsx");
const householdBytes = readCachedWorkbook(".cache/hcp-indicateurs-2014-menages.xlsx");
const rows = parseHcp2014Indicators(peopleBytes, householdBytes);
const totalPeople = readSheetRows(peopleBytes, 1);
const urbanPeople = readSheetRows(peopleBytes, 2);
const totalHouseholds = readSheetRows(householdBytes, 1);
const copy = (sheet: (string | null)[][]) => sheet.map((r) => [...r]);

/** A figure off a parsed row, by its path. */
const people = (row: Indicator2014Row, area: "total" | "urban" | "rural", sex: "all" | "male" | "female", path: string) =>
  row.people[area][sex][peopleColumns2014(sex).findIndex((f) => `${f.topic}.${f.key}` === path)];
const homes = (row: Indicator2014Row, area: "total" | "urban" | "rural", path: string) =>
  row.households[area][HOUSEHOLD_FIELDS_2014.findIndex((f) => `${f.topic}.${f.key}` === path)];

describe("toCell2014", () => {
  it("reads the sign for a figure with no place, and the empty legal population", () => {
    expect(toCell2014("-", "percent")).toBe("n/a");
    expect(toCell2014(null, "people")).toBe("n/a");
  });

  it("rounds to the decimal HCP's own tables stop at", () => {
    expect(toCell2014("10.155696524579501", "percent")).toBe(10.2);
    expect(toCell2014("2.2238973646628399", "births per woman")).toBe(2.22);
    expect(toCell2014("4.5954300674641901", "people per household")).toBe(4.6);
    expect(toCell2014("33848242", "people")).toBe(33848242);
  });

  it("refuses anything else", () => {
    expect(() => toCell2014("n.d.", "percent")).toThrow(/unreadable/);
  });
});

describe("the layout checks", () => {
  it("accept the workbooks as published", () => {
    expect(() => peopleLayout2014(totalPeople, "total")).not.toThrow();
    expect(() => householdLayout2014(totalHouseholds, "total")).not.toThrow();
  });

  it("find each sex's block where the field list says it is", () => {
    expect(peopleLayout2014(totalPeople, "total")).toEqual({ all: 8, male: 63, female: 117 });
  });

  it("refuse a people sheet with a heading moved", () => {
    const sheet = copy(totalPeople);
    sheet[1]![35] = "Taux de chômage";
    expect(() => peopleLayout2014(sheet, "total")).toThrow(/column 35/);
  });

  it("refuse a household sheet with two categories swapped", () => {
    const sheet = copy(totalHouseholds);
    [sheet[1]![29], sheet[1]![30]] = [sheet[1]![30]!, sheet[1]![29]!];
    expect(() => householdLayout2014(sheet, "total")).toThrow(/Électricité/);
  });

  it("refuse the wrong area", () => {
    expect(() => peopleLayout2014(urbanPeople, "rural")).toThrow(/the area reads/);
  });
});

describe("parseHcp2014Indicators", () => {
  it("reads every row of the six sheets", () => {
    expect(rows).toHaveLength(1979);
    expect(rows[0]!.codeDigits).toBeNull();
    expect(rows.filter((r) => r.label.startsWith("Dont Centre"))).toHaveLength(149);
    expect(rows.filter((r) => r.label.startsWith("Préfecture d’Arrondissement"))).toHaveLength(8);
  });

  it("puts the national figures under the right names", () => {
    const nation = rows[0]!;
    expect(people(nation, "total", "all", "population.legal")).toBe(33848242);
    expect(people(nation, "total", "all", "population.municipal")).toBe(33610084);
    expect(people(nation, "total", "all", "illiteracy.rate10Plus")).toBe(32.2);
    expect(people(nation, "total", "all", "fertility.totalFertilityRate")).toBe(2.22);
    expect(people(nation, "total", "all", "labour.unemploymentRate")).toBe(16.2);
    expect(people(nation, "total", "female", "labour.activityRate")).toBe(20.4);
    expect(people(nation, "total", "male", "maritalStatus.singulateMeanAgeAtMarriage")).toBe(31.3);
    expect(people(nation, "total", "all", "localLanguages.tachelhit")).toBe(14.1);
    expect(homes(nation, "total", "households.averageSize")).toBe(4.6);
    expect(homes(nation, "total", "amenities.runningWater")).toBe(73);
    expect(homes(nation, "total", "equipment.mobilePhone")).toBe(94.3);
    expect(homes(nation, "rural", "households.municipalPopulation")).toBe(13325648);
  });

  it("gives every field to all three sexes but the legal population", () => {
    const ids = (sex: "all" | "male" | "female") => peopleColumns2014(sex).map((f) => `${f.topic}.${f.key}`);
    expect(ids("all")).toHaveLength(55);
    expect(ids("male")).toHaveLength(54);
    expect(ids("female")).toHaveLength(54);
    expect(ids("male")).not.toContain("population.legal");
    expect(PEOPLE_FIELDS_2014).toHaveLength(55);
    expect(HOUSEHOLD_FIELDS_2014).toHaveLength(42);
  });

  it("marks the area a unit doesn't have as not applicable", () => {
    const boufrah = rows.find((r) => r.label === "Bni Boufrah")!;
    expect(boufrah.people.urban.all.every((c) => c === "n/a")).toBe(true);
    expect(people(boufrah, "total", "all", "population.legal")).toBe(9653);
    // The distance to a paved road is a rural measure, so the urban sheet signs it.
    expect(homes(boufrah, "urban", "households.distanceToPavedRoadKm")).toBe("n/a");
  });

  it("leaves fertility to the sexes HCP gives it for", () => {
    const nation = rows[0]!;
    expect(people(nation, "total", "male", "fertility.totalFertilityRate")).toBe("n/a");
    expect(people(nation, "total", "female", "fertility.totalFertilityRate")).toBe(2.22);
  });
});

describe("the field list", () => {
  it("names the 2024 field each comparable one can be read against", () => {
    const by = (topic: string, key: string) =>
      [...PEOPLE_FIELDS_2014, ...HOUSEHOLD_FIELDS_2014].find((f) => f.topic === topic && f.key === key)!;
    expect(by("illiteracy", "rate10Plus").comparableTo).toBe("illiteracy.rate10Plus");
    expect(by("households", "distanceToPavedRoadKm").comparableTo).toBe("households.distanceToPavedRoadKm");
    expect(by("amenities", "runningWater").comparableTo).toBe("amenities.runningWater");
  });

  it("leaves a field that changed its question without one, and says what changed", () => {
    const changed = [...PEOPLE_FIELDS_2014, ...HOUSEHOLD_FIELDS_2014].filter((f) => f.comparableTo === undefined);
    for (const f of changed) expect(f.note, `${f.topic}.${f.key}`).toBeTruthy();
    const topics = new Set(changed.map((f) => f.topic));
    expect([...topics].sort()).toEqual([
      "cookingFuel", "employmentStatus", "equipment", "householdWaste", "labour", "languageCombinations", "maritalStatus", "schooling",
    ]);
  });
});
