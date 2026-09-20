import { readSheetRows } from "../lib/xlsx.ts";
import { AREAS, SEXES, type Area, type Sex } from "./indicatorFields.ts";
import type { Field2014 } from "./indicator2014Fields.ts";
import { toCell2014 } from "./hcp2014Indicators.ts";
import type { Cell } from "./hcpIndicators.ts";

/**
 * The layout HCP gives its 2014 workbooks other than the indicators themselves: a sheet
 * for the whole unit, its urban part and its rural part, and three blocks of columns to a
 * sheet, one per sex. Mobility, professions and diplomas are all published this way, so
 * they are read by one function against their own field list.
 *
 * Every heading and category is checked before a figure is read, the three sheets are
 * checked to list the same units in the same order, and a workbook whose columns have
 * moved is refused rather than read under the wrong names.
 */

export interface BlockRow {
  /** The digits of HCP's code, as the workbook writes it. Null for the national row. */
  codeDigits: string | null;
  label: string;
  people: Record<Area, Record<Sex, Cell[]>>;
}

const SHEETS: Record<Area, number> = { total: 1, urban: 2, rural: 3 };
const CODE = 6;
const LABEL = 7;
const FIRST = 8;
const HEADINGS = 3;
const NATIONAL = "Total Royaume du Maroc";
const SEX_LABEL: Record<Sex, string> = { all: "Ensemble des deux sexes", male: "Masculin", female: "Féminin" };
const AREA_LABEL: Record<Area, string> = { total: "Ensemble des deux milieux", urban: "Urbain", rural: "Rural" };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Each field's heading and category against the sheet's, where the heading fills down. */
export function headingProblems(
  rows: (string | null)[][],
  fields: Field2014[],
  firstColumn: number,
  headingRow: number,
  categoryRow: number,
): string[] {
  const problems: string[] = [];
  let heading = "";
  fields.forEach((f, i) => {
    const col = firstColumn + i;
    if (clean(rows[headingRow]?.[col])) heading = clean(rows[headingRow]?.[col]);
    const expected = f.sheetHeading ?? f.heading;
    if (heading !== expected) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(expected)}`);
    const category = clean(rows[categoryRow]?.[col]);
    if (category !== (f.category ?? "")) problems.push(`column ${col}: category ${JSON.stringify(category)}, expected ${JSON.stringify(f.category ?? "")}`);
  });
  return problems;
}

/** Checks one sheet's headings, and returns where each sex's block starts. */
export function blockLayout2014(rows: (string | null)[][], fields: Field2014[], area: Area, what: string): Record<Sex, number> {
  const problems: string[] = [];
  if (clean(rows[0]?.[LABEL]) !== AREA_LABEL[area]) {
    problems.push(`the area reads ${JSON.stringify(clean(rows[0]?.[LABEL]))}, expected ${JSON.stringify(AREA_LABEL[area])}`);
  }
  const starts = {} as Record<Sex, number>;
  SEXES.forEach((sex, i) => {
    const col = FIRST + i * fields.length;
    starts[sex] = col;
    const label = clean(rows[0]?.[col]);
    // The diplomas workbook writes "Ensemble des deux Sexes" where the others write a
    // small s, which is the same words rather than a different block.
    if (label.toLocaleLowerCase("fr") !== SEX_LABEL[sex].toLocaleLowerCase("fr")) {
      problems.push(`column ${col}: sex ${JSON.stringify(label)}, expected ${JSON.stringify(SEX_LABEL[sex])}`);
    }
    problems.push(...headingProblems(rows, fields, col, 1, 2));
  });
  const width = Math.max(...rows.slice(0, HEADINGS).map((r) => r.length));
  if (width !== FIRST + SEXES.length * fields.length) {
    problems.push(`sheet is ${width} columns wide, expected ${FIRST + SEXES.length * fields.length}`);
  }
  if (problems.length > 0) throw new Error(`the ${area} sheet of the 2014 ${what} workbook doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
  return starts;
}

/** One 2014 workbook of this shape, as a row per unit with every sheet's cells on it. */
export function parse2014Blocks(bytes: Uint8Array, fields: Field2014[], what: string): BlockRow[] {
  const sheets = {} as Record<Area, (string | null)[][]>;
  const starts = {} as Record<Area, Record<Sex, number>>;
  for (const area of AREAS) {
    const rows = readSheetRows(bytes, SHEETS[area]);
    starts[area] = blockLayout2014(rows, fields, area, what);
    const start = rows.findIndex((r) => clean(r[LABEL]) === NATIONAL);
    if (start !== HEADINGS) throw new Error(`the ${area} sheet's national row is row ${start}, expected ${HEADINGS}`);
    sheets[area] = rows.slice(start).filter((r) => clean(r[LABEL]) !== "");
  }

  const spine = sheets.total;
  for (const area of AREAS) {
    if (sheets[area].length !== spine.length) throw new Error(`the ${area} sheet has ${sheets[area].length} rows, the total sheet ${spine.length}`);
    sheets[area].forEach((r, i) => {
      if (clean(r[CODE]) !== clean(spine[i]![CODE]) || clean(r[LABEL]) !== clean(spine[i]![LABEL])) {
        throw new Error(`row ${i} of the ${area} sheet is ${clean(r[CODE])} ${clean(r[LABEL])}, the total sheet's ${clean(spine[i]![CODE])} ${clean(spine[i]![LABEL])}`);
      }
    });
  }

  return spine.map((row, i) => ({
    codeDigits: clean(row[CODE]).replace(/\D/g, "") || null,
    label: clean(row[LABEL]),
    people: Object.fromEntries(
      AREAS.map((area) => [
        area,
        Object.fromEntries(
          SEXES.map((sex) => [sex, fields.map((f, j) => toCell2014(sheets[area][i]![starts[area][sex] + j], f.unit))]),
        ),
      ]),
    ) as BlockRow["people"],
  }));
}
