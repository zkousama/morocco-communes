import { describe, expect, it } from "vitest";
import { readSheetRows } from "../../src/lib/xlsx.ts";
import { HOUSEHOLD_FIELDS, PEOPLE_FIELDS } from "../../src/sources/douarFields.ts";
import { douarLayout, frenchOf, headingsOf, parseDouarDefinitions, parseHcpDouars, toFigure, type DouarRow } from "../../src/sources/hcpDouars.ts";
import { buildDouars } from "../../src/build/douars.ts";
import { checkDouars } from "../../src/validate/douars.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const bytes = readCachedWorkbook(".cache/hcp-douars-2024.xlsx");
const rows = parseHcpDouars(bytes);
const peopleSheet = readSheetRows(bytes, 1);
const TITLE = "خصائص السكان البلديون بالوسط القروي (ما عدا الرحال) حسب الدواوير";

describe("a header cell", () => {
  it("is read for its French half, after HCP's dashes or its (%)", () => {
    expect(frenchOf("الدوار\n———\nDouar\n")).toBe("Douar");
    expect(frenchOf("الجنسية\n (%)\nNationalité")).toBe("Nationalité");
    expect(frenchOf("مغربية\n——\nMarocaine")).toBe("Marocaine");
    expect(frenchOf(null)).toBe("");
  });

  it("carries its group's heading to the sub-columns under it", () => {
    const headings = headingsOf(peopleSheet);
    expect(headings[10]).toBe("Nationalité · Marocaine");
    expect(headings[11]).toBe("Nationalité · Etrangère");
    expect(headings[18]).toBe("Population de 15 ans et plus");
  });
});

describe("the workbook's layout", () => {
  it("is refused when a column has moved", () => {
    const moved = peopleSheet.slice(0, 4).map((r) => [...r]);
    [moved[2]![12], moved[2]![13]] = [moved[2]![13]!, moved[2]![12]!];
    expect(() => douarLayout(moved, PEOPLE_FIELDS, TITLE)).toThrow(/column 12: heading "Sexe · Féminin"/);
  });

  it("is refused under another title", () => {
    expect(() => douarLayout(peopleSheet.slice(0, 4), HOUSEHOLD_FIELDS, "something else")).toThrow(/the title reads/);
  });
});

describe("a figure", () => {
  it("is null where HCP withholds it, and rounded to what it can carry", () => {
    expect(toFigure("X", "percent")).toBeNull();
    expect(toFigure("46.265060240963855", "percent")).toBe(46.3);
    expect(toFigure("0.37068965517241392", "km")).toBe(0.37);
    expect(toFigure("7.1428571428571425E-2", "km")).toBe(0.07);
    expect(toFigure("321", "people")).toBe(321);
  });

  it("refuses what it can't read", () => {
    expect(() => toFigure("", "percent")).toThrow(/unreadable/);
    expect(() => toFigure("n/a", "km")).toThrow(/unreadable/);
  });
});

describe("HCP's douars", () => {
  it("are all 33,189 of them, in 3 kinds", () => {
    expect(rows).toHaveLength(33189);
    const kinds = { grouped: 0, split: 0, dispersed: 0 };
    for (const r of rows) kinds[r.type]++;
    expect(kinds).toEqual({ grouped: 19096, split: 8477, dispersed: 5616 });
  });

  it("reads the first one as the workbook writes it", () => {
    expect(rows[0]).toMatchObject({ code: "0510301201001", fraction: "السواحل", name: "اجنانات", type: "split", households: 116, population: 415 });
    expect(rows[0]!.people.slice(0, 4)).toEqual([100, 0, 46.3, 53.7]);
    expect(rows[0]!.homes.slice(-6)).toEqual([0.37, 0.1, 1.04, 4.32, 4.32, 4.32]);
  });

  it("withholds every share and distance of a douar under 30 households, and only those", () => {
    for (const r of rows) {
      const withheld = [...r.people, ...r.homes].every((v) => v === null);
      const given = [...r.people, ...r.homes].every((v) => v !== null);
      expect(withheld || given, r.code).toBe(true);
      expect(withheld, r.code).toBe(r.households < 30);
    }
  });

  it("pads a code that lost its leading zero", () => {
    expect(rows.every((r) => /^\d{13}$/.test(r.code))).toBe(true);
  });
});

describe("HCP's douar definitions", () => {
  it("reads all 15, in French, with no leftover colon", () => {
    const definitions = parseDouarDefinitions(bytes);
    expect(definitions).toHaveLength(15);
    expect(definitions.find((d) => d.term === "Douar groupé")?.body).toMatch(/deux tiers/);
    for (const d of definitions) expect(d.term.endsWith(":"), d.term).toBe(false);
  });
});

describe("placing the douars", () => {
  const communes = [{ code: "01.051.03.01", codeDigits: "010510301" }];
  const douar = (over: Partial<DouarRow>): DouarRow => ({
    code: "0510301201001",
    region: "",
    province: "",
    cercle: "",
    commune: "",
    fraction: "السواحل",
    name: "اجنانات",
    type: "grouped",
    households: 40,
    population: 150,
    people: [100, 0, 50, 50, 30, 60, 10, 99, 100, 40, 55, 2, 3],
    homes: [0, 0, 0, 70, 0, 20, 10, 0, 1, 0.5, 1, 4, 6, 3],
    ...over,
  });

  it("lands a douar on its commune by code, and adds it to its fraction", () => {
    const built = buildDouars([douar({}), douar({ code: "0510301201002", name: "امداوشن", households: 10, population: 30, people: PEOPLE_FIELDS.map(() => null), homes: HOUSEHOLD_FIELDS.map(() => null) })], communes);
    expect(built.douars.map((d) => d.communeCode)).toEqual(["01.051.03.01", "01.051.03.01"]);
    expect(built.douars[0]!.topics?.distanceKm?.drivableTrack).toBe(0.5);
    expect(built.douars[1]!.topics).toBeNull();
    expect(built.fractions).toEqual([{ code: "0510301201", communeCode: "01.051.03.01", name: { ar: "السواحل" }, douars: 2, households: 50, population: 180 }]);
  });

  it("refuses a douar with no commune, a code listed twice, and a fraction under 2 names", () => {
    expect(() => buildDouars([douar({ code: "0999999201001" })], communes)).toThrow(/no commune carries the code 0999999/);
    expect(() => buildDouars([douar({}), douar({})], communes)).toThrow(/listed twice/);
    expect(() => buildDouars([douar({}), douar({ code: "0510301201002", fraction: "اكني" })], communes)).toThrow(/is both/);
  });

  it("finds a split that doesn't make 100, and douars holding more people than their commune", () => {
    const built = buildDouars([douar({ people: [100, 0, 60, 50, 30, 60, 10, 99, 100, 40, 55, 2, 3] })], communes);
    expect(checkDouars(built.douars, built.fractions, new Map([["01.051.03.01", 100]]))).toEqual([
      "douar 0510301201001 اجنانات: sex makes 110.0, not 100",
      "commune 01.051.03.01: its douars hold 150 people, its population is 100",
    ]);
  });
});
