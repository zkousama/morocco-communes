import { readSheetRows } from "../lib/xlsx.ts";
import { AREAS, SEXES, type Area, type Sex, type Unit } from "./indicatorFields.ts";
import { HOUSEHOLD_FIELDS_2014, PEOPLE_FIELDS_2014, type Field2014 } from "./indicator2014Fields.ts";
import type { Cell } from "./hcpIndicators.ts";

/**
 * HCP's indicators from the 2014 census: two workbooks, one for people and one for
 * households, each with a sheet for the whole unit, its urban part and its rural part.
 * Every column is listed in indicator2014Fields.ts with the heading HCP gives it, and the
 * parser refuses a workbook whose headings don't match.
 *
 * The 2014 sheets are laid out differently from the 2024 one: the code sits in its own
 * dotted column, the sexes' blocks run straight into each other with no separator, and the
 * sign for a figure with no place is "-" rather than "…".
 */

export type { Cell };

export interface Indicator2014Row {
  /** The nine or ten digits of HCP's dotted code. Null for the national row. */
  codeDigits: string | null;
  /** As HCP writes it: "Al Hoceima (Mun.)", "Cercle : Targuist", "Dont Centre: Tamassint". */
  label: string;
  people: Record<Area, Record<Sex, Cell[]>>;
  households: Record<Area, Cell[]>;
}

const SHEETS: Record<Area, number> = { total: 1, urban: 2, rural: 3 };
const AREA_LABEL: Record<Area, string> = { total: "Ensemble des deux milieux", urban: "Urbain", rural: "Rural" };
const SEX_LABEL: Record<Sex, string> = { all: "Ensemble des deux sexes", male: "Masculin", female: "Féminin" };

/** The code, then the name. The six columns before them split the code into its parts. */
const CODE = 6;
const LABEL = 7;
/** The first column of figures on both workbooks' sheets. */
const FIRST = 8;
/** The people sheets head their columns over three rows, the household sheets over two. */
const PEOPLE_HEADINGS = 3;
const HOUSEHOLD_HEADINGS = 2;

/**
 * How far HCP's own tables round each unit, which is also where the 2024 workbook stops.
 * The 2014 workbook keeps the full division, 10.155696524579501 for 10.2, and a figure
 * carried to thirteen decimals would read as more measurement than a census has.
 */
const PRECISION: Record<Unit, number> = {
  people: 0,
  households: 0,
  percent: 1,
  years: 1,
  "births per woman": 2,
  "people per household": 1,
  "people per room": 1,
  km: 1,
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * A cell as the 2014 workbook writes it. Its only conventional sign is "-", for a figure
 * with no place there: the urban half of a rural commune, a mother's fertility under
 * Masculin. The legal population is empty rather than signed on the urban and rural
 * sheets, since the census publishes it for the whole unit only.
 */
export function toCell2014(raw: string | null | undefined, unit: Unit): Cell {
  const text = clean(raw);
  if (text === "-" || text === "") return "n/a";
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(text)) throw new Error(`unreadable indicator value: ${JSON.stringify(raw)}`);
  const factor = 10 ** PRECISION[unit];
  return Math.round(Number(text) * factor) / factor;
}

/** The columns of one sex's block, from its first column. Only the legal population is one sex short. */
export const peopleColumns2014 = (sex: Sex) => PEOPLE_FIELDS_2014.filter((f) => f.sexes.includes(sex));

const headingProblems = (
  rows: (string | null)[][],
  fields: Field2014[],
  firstColumn: number,
  headingRow: number,
  categoryRow: number,
): string[] => {
  const problems: string[] = [];
  let heading = "";
  fields.forEach((f, i) => {
    const col = firstColumn + i;
    if (clean(rows[headingRow]?.[col])) heading = clean(rows[headingRow]?.[col]);
    if (heading !== f.heading) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(f.heading)}`);
    const category = clean(rows[categoryRow]?.[col]);
    if (category !== (f.category ?? "")) problems.push(`column ${col}: category ${JSON.stringify(category)}, expected ${JSON.stringify(f.category ?? "")}`);
  });
  return problems;
};

/**
 * Checks a people sheet's headings against PEOPLE_FIELDS_2014: the area over the names,
 * the sex over each block, and each column's heading and category. Returns where each
 * sex's block starts.
 */
export function peopleLayout2014(rows: (string | null)[][], area: Area): Record<Sex, number> {
  const problems: string[] = [];
  if (clean(rows[0]?.[LABEL]) !== AREA_LABEL[area]) {
    problems.push(`the area reads ${JSON.stringify(clean(rows[0]?.[LABEL]))}, expected ${JSON.stringify(AREA_LABEL[area])}`);
  }
  const starts = {} as Record<Sex, number>;
  let col = FIRST;
  for (const sex of SEXES) {
    starts[sex] = col;
    const label = clean(rows[0]?.[col]);
    if (label !== SEX_LABEL[sex]) problems.push(`column ${col}: sex ${JSON.stringify(label)}, expected ${JSON.stringify(SEX_LABEL[sex])}`);
    const columns = peopleColumns2014(sex);
    problems.push(...headingProblems(rows, columns, col, 1, 2));
    col += columns.length;
  }
  const width = Math.max(...rows.map((r) => r.length));
  if (width !== col) problems.push(`sheet is ${width} columns wide, expected ${col}`);
  if (problems.length > 0) throw new Error(`the ${area} people sheet of the 2014 workbook doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
  return starts;
}

/**
 * Checks a household sheet's headings. The legal population holds the first column of
 * figures and is published for the whole unit only, so it is confirmed here and read from
 * the people workbook instead.
 */
export function householdLayout2014(rows: (string | null)[][], area: Area): void {
  const problems: string[] = [];
  if (clean(rows[0]?.[CODE]) !== AREA_LABEL[area]) {
    problems.push(`the area reads ${JSON.stringify(clean(rows[0]?.[CODE]))}, expected ${JSON.stringify(AREA_LABEL[area])}`);
  }
  if (clean(rows[0]?.[FIRST]) !== "Population légale") {
    problems.push(`column ${FIRST}: heading ${JSON.stringify(clean(rows[0]?.[FIRST]))}, expected "Population légale"`);
  }
  problems.push(...headingProblems(rows, HOUSEHOLD_FIELDS_2014, FIRST + 1, 0, 1));
  const width = Math.max(...rows.map((r) => r.length));
  if (width !== FIRST + 1 + HOUSEHOLD_FIELDS_2014.length) {
    problems.push(`sheet is ${width} columns wide, expected ${FIRST + 1 + HOUSEHOLD_FIELDS_2014.length}`);
  }
  if (problems.length > 0) throw new Error(`the ${area} household sheet of the 2014 workbook doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
}

/** The data rows of a sheet: from the national row down, each with a name. */
function dataRows(rows: (string | null)[][], headings: number): (string | null)[][] {
  const start = rows.findIndex((r) => clean(r[LABEL]) === "Total Royaume du Maroc");
  if (start !== headings) throw new Error(`the national row is row ${start}, expected ${headings}`);
  return rows.slice(start).filter((r) => clean(r[LABEL]) !== "");
}

export function parseHcp2014Indicators(peopleBytes: Uint8Array, householdBytes: Uint8Array): Indicator2014Row[] {
  const people = {} as Record<Area, (string | null)[][]>;
  const starts = {} as Record<Area, Record<Sex, number>>;
  const households = {} as Record<Area, (string | null)[][]>;
  for (const area of AREAS) {
    const sheet = readSheetRows(peopleBytes, SHEETS[area]);
    starts[area] = peopleLayout2014(sheet, area);
    people[area] = dataRows(sheet, PEOPLE_HEADINGS);
    const hSheet = readSheetRows(householdBytes, SHEETS[area]);
    householdLayout2014(hSheet, area);
    households[area] = dataRows(hSheet, HOUSEHOLD_HEADINGS);
  }

  // The six sheets list the same units in the same order.
  const spine = people.total;
  for (const area of AREAS) {
    for (const [name, sheet] of [[`${area} people`, people[area]], [`${area} households`, households[area]]] as const) {
      if (sheet.length !== spine.length) throw new Error(`the ${name} sheet has ${sheet.length} rows, the total people sheet ${spine.length}`);
      sheet.forEach((r, i) => {
        if (clean(r[CODE]) !== clean(spine[i]![CODE]) || clean(r[LABEL]) !== clean(spine[i]![LABEL])) {
          throw new Error(`row ${i} of the ${name} sheet is ${clean(r[CODE])} ${clean(r[LABEL])}, the total people sheet's ${clean(spine[i]![CODE])} ${clean(spine[i]![LABEL])}`);
        }
      });
    }
  }

  return spine.map((row, i) => ({
    codeDigits: clean(row[CODE]).replace(/\D/g, "") || null,
    label: clean(row[LABEL]),
    people: Object.fromEntries(
      AREAS.map((area) => [
        area,
        Object.fromEntries(
          SEXES.map((sex) => [
            sex,
            peopleColumns2014(sex).map((f, j) => toCell2014(people[area][i]![starts[area][sex] + j], f.unit)),
          ]),
        ),
      ]),
    ) as Indicator2014Row["people"],
    households: Object.fromEntries(
      AREAS.map((area) => [area, HOUSEHOLD_FIELDS_2014.map((f, j) => toCell2014(households[area][i]![FIRST + 1 + j], f.unit))]),
    ) as Indicator2014Row["households"],
  }));
}

export { AREAS, HOUSEHOLD_FIELDS_2014, PEOPLE_FIELDS_2014, SEXES, type Area, type Field2014, type Sex };
