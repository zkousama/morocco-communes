import { readSheetRows } from "../lib/xlsx.ts";
import { AREAS, HOUSEHOLD_FIELDS, PEOPLE_FIELDS, SEXES, type Area, type Field, type Sex, type Unit } from "./indicatorFields.ts";

/**
 * HCP's demographic and socio-economic indicators from the 2024 census: one workbook, six
 * sheets of figures (people, then households, each for the whole unit, its urban part and
 * its rural part) and three of notes. Every column is listed here with the heading HCP
 * gives it, and the parser refuses a workbook whose headings don't match, so a column that
 * moves upstream fails the build instead of landing under the wrong name.
 */

export { AREAS, HOUSEHOLD_FIELDS, PEOPLE_FIELDS, SEXES, type Area, type Field, type Sex, type Unit };

/**
 * A cell as HCP publishes it. The workbook's conventional signs: "…" for a figure that
 * has no place there, "." for one that's unavailable.
 */
export type Cell = number | "n/a" | "unavailable";

export interface IndicatorRow {
  /** As HCP writes it, without leading zeros. Null for the national row. */
  code: string | null;
  /** As HCP writes it, footnote asterisk included. */
  label: string;
  people: Record<Area, Record<Sex, Cell[]>>;
  households: Record<Area, Cell[]>;
}

const PEOPLE_SHEETS: Record<Area, number> = { total: 1, urban: 2, rural: 3 };
const HOUSEHOLD_SHEETS: Record<Area, number> = { total: 4, urban: 5, rural: 6 };
const AREA_LABEL: Record<Area, string> = { total: "Ensemble", urban: "Urbain", rural: "Rural" };
const SEX_LABEL: Record<Sex, string> = { all: "Ensemble", male: "Masculin", female: "Féminin" };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function toCell(raw: string | null | undefined, unit: Unit): Cell {
  const text = clean(raw);
  if (text === "…") return "n/a";
  if (text === ".") return "unavailable";
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(text)) throw new Error(`unreadable indicator value: ${JSON.stringify(raw)}`);
  const n = Number(text);
  // Counts are whole numbers; everything else is published to 1 or 2 decimals, and the
  // workbook stores the binary neighbour, 9.3000000000000007 for 9.3.
  return unit === "people" || unit === "households" ? n : Math.round(n * 100) / 100;
}

/** The columns of one sex's block on a people sheet, from its first column. */
const peopleColumns = (sex: Sex) => PEOPLE_FIELDS.filter((f) => f.sexes.includes(sex));

/**
 * Checks a people sheet's headings against PEOPLE_FIELDS: the area in the corner, the sex
 * over each block, and each column's heading and category. Returns where each sex's block
 * starts. A people sheet has three rows of headings.
 */
export function peopleLayout(rows: (string | null)[][], area: Area): Record<Sex, number> {
  const problems: string[] = [];
  if (clean(rows[0]?.[0]) !== `Milieu de résidence : ${AREA_LABEL[area]}`) {
    problems.push(`corner reads ${JSON.stringify(rows[0]?.[0])}`);
  }
  const starts = {} as Record<Sex, number>;
  let col = 2;
  let heading = "";
  for (const sex of SEXES) {
    starts[sex] = col;
    for (const f of peopleColumns(sex)) {
      const sexLabel = clean(rows[0]?.[col]);
      if (sexLabel && sexLabel !== `Sexe : ${SEX_LABEL[sex]}`) problems.push(`column ${col}: sex ${JSON.stringify(sexLabel)}, expected ${SEX_LABEL[sex]}`);
      if (clean(rows[1]?.[col])) heading = clean(rows[1]?.[col]);
      if (heading !== f.heading) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(f.heading)}`);
      const category = clean(rows[2]?.[col]);
      if (category !== (f.category ?? "")) problems.push(`column ${col}: category ${JSON.stringify(category)}, expected ${JSON.stringify(f.category ?? "")}`);
      col++;
    }
    // One empty column separates the sexes' blocks.
    if (sex !== "female") {
      if (rows.slice(3).some((r) => clean(r[col]) !== "")) problems.push(`column ${col} should be the empty separator`);
      col++;
    }
  }
  const width = Math.max(...rows.map((r) => r.length));
  if (width !== col) problems.push(`sheet is ${width} columns wide, expected ${col}`);
  if (problems.length > 0) throw new Error(`the ${area} people sheet doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
  return starts;
}

/**
 * Checks a household sheet's headings. Two rows of headings: the heading, then the
 * category. The rural sheet's second row has its first labels out of order ("Ménages
 * population" over the population column), so only the categories are checked there; the
 * first two columns are confirmed by value instead, against the people sheets.
 */
export function householdLayout(rows: (string | null)[][], area: Area): void {
  const problems: string[] = [];
  if (clean(rows[0]?.[0]) !== `Milieu de résidence : ${AREA_LABEL[area]}`) {
    problems.push(`corner reads ${JSON.stringify(rows[0]?.[0])}`);
  }
  let heading = "";
  HOUSEHOLD_FIELDS.forEach((f, i) => {
    const col = 2 + i;
    if (clean(rows[0]?.[col])) heading = clean(rows[0]?.[col]);
    if (heading !== f.heading) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(f.heading)}`);
    if (f.category && clean(rows[1]?.[col]) !== f.category) {
      problems.push(`column ${col}: category ${JSON.stringify(clean(rows[1]?.[col]))}, expected ${JSON.stringify(f.category)}`);
    }
  });
  const width = Math.max(...rows.map((r) => r.length));
  if (width !== 2 + HOUSEHOLD_FIELDS.length) problems.push(`sheet is ${width} columns wide, expected ${2 + HOUSEHOLD_FIELDS.length}`);
  if (problems.length > 0) throw new Error(`the ${area} household sheet doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
}

/** The data rows of a sheet: from the national row down, each with a label. */
function dataRows(rows: (string | null)[][]): (string | null)[][] {
  const start = rows.findIndex((r) => clean(r[1]) === "Ensemble du territoire national");
  if (start < 0) throw new Error("no national row");
  return rows.slice(start).filter((r) => clean(r[1]) !== "");
}

export function parseHcpIndicators(bytes: Uint8Array): IndicatorRow[] {
  const people = {} as Record<Area, (string | null)[][]>;
  const starts = {} as Record<Area, Record<Sex, number>>;
  const households = {} as Record<Area, (string | null)[][]>;
  for (const area of AREAS) {
    const sheet = readSheetRows(bytes, PEOPLE_SHEETS[area]);
    starts[area] = peopleLayout(sheet, area);
    people[area] = dataRows(sheet);
    const hSheet = readSheetRows(bytes, HOUSEHOLD_SHEETS[area]);
    householdLayout(hSheet, area);
    households[area] = dataRows(hSheet);
  }

  // The six sheets list the same units in the same order.
  const spine = people.total;
  for (const area of AREAS) {
    for (const [name, sheet] of [[`${area} people`, people[area]], [`${area} households`, households[area]]] as const) {
      if (sheet.length !== spine.length) throw new Error(`the ${name} sheet has ${sheet.length} rows, the total people sheet ${spine.length}`);
      sheet.forEach((r, i) => {
        if (clean(r[0]) !== clean(spine[i]![0]) || clean(r[1]) !== clean(spine[i]![1])) {
          throw new Error(`row ${i} of the ${name} sheet is ${clean(r[0])} ${clean(r[1])}, the total people sheet's ${clean(spine[i]![0])} ${clean(spine[i]![1])}`);
        }
      });
    }
  }

  return spine.map((row, i) => ({
    code: clean(row[0]) || null,
    label: clean(row[1]),
    people: Object.fromEntries(
      AREAS.map((area) => [
        area,
        Object.fromEntries(
          SEXES.map((sex) => [
            sex,
            peopleColumns(sex).map((f, j) => toCell(people[area][i]![starts[area][sex] + j], f.unit)),
          ]),
        ),
      ]),
    ) as IndicatorRow["people"],
    households: Object.fromEntries(
      AREAS.map((area) => [area, HOUSEHOLD_FIELDS.map((f, j) => toCell(households[area][i]![2 + j], f.unit))]),
    ) as IndicatorRow["households"],
  }));
}

export { peopleColumns };
