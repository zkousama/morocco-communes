import { readSheetRows } from "../lib/xlsx.ts";
import { HOUSING_FIELDS, type HousingField } from "./housingFields.ts";

/**
 * HCP's urban housing stock, one sheet: a row per unit, from the country down to the
 * urban centre, and 55 figures across.
 *
 * The header is four merged rows deep, and a column's own wording is what those rows hold
 * read top to bottom. The parser joins them and checks the result against the field list
 * before it reads a figure, so a column that moved is refused rather than read under the
 * wrong name. HCP leaves a stray "2" and "3" in the merged cells of the age cross-tab;
 * the field list carries those as they are rather than tidying them away.
 *
 * The codes are written as numbers, so 01.511.01.0 arrives as 1511010, which is the form
 * the rest of the pipeline normalises to anyway.
 */

export interface HousingRow {
  /** HCP's code with its leading zeros already gone. Null for the national row. */
  code: string | null;
  label: string;
  figures: (number | null)[];
}

const CODE = 0;
const LABEL = 1;
const FIRST = 2;
const HEADER_ROWS = [1, 2, 3, 4];
const TITLE = "Indicateurs communaux du Parc logement urbain en 2024";
const NATIONAL = "Ensemble du territoire national";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * A cell. This workbook writes `_` where it has nothing to report, which is most of the
 * age cross-tab for most units, and leaves a cell empty where it has no figure at all.
 * Both come through as null.
 */
export function toFigure(raw: string | null | undefined, unit: HousingField["unit"]): number | null {
  const text = clean(raw);
  if (text === "" || text === "_" || text === "-") return null;
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(text)) throw new Error(`unreadable figure: ${JSON.stringify(raw)}`);
  const value = Number(text);
  // Counts are whole; shares are rounded to the decimal HCP's own tables stop at.
  return unit === "dwellings" ? Math.round(value) : Math.round(value * 10) / 10;
}

/** A column's own wording: its header cells, top to bottom, joined. */
const headingAt = (rows: (string | null)[][], col: number) =>
  HEADER_ROWS.map((r) => clean(rows[r]?.[col])).filter(Boolean).join(" · ");

/** Checks the sheet against the field list, column by column. */
export function housingLayout(rows: (string | null)[][], fields: HousingField[] = HOUSING_FIELDS): void {
  const problems: string[] = [];
  if (!clean(rows[0]?.[0]).startsWith(TITLE)) problems.push(`the title reads ${JSON.stringify(clean(rows[0]?.[0]))}`);
  if (clean(rows[4]?.[CODE]) !== "Code géographique") problems.push(`the code column reads ${JSON.stringify(clean(rows[4]?.[CODE]))}`);
  if (clean(rows[4]?.[LABEL]) !== "Collectivités territoriales") problems.push(`the name column reads ${JSON.stringify(clean(rows[4]?.[LABEL]))}`);
  fields.forEach((f, i) => {
    const col = FIRST + i;
    const heading = headingAt(rows, col);
    if (heading !== f.heading) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(f.heading)}`);
  });
  const width = Math.max(...rows.slice(0, 5).map((r) => r.length));
  if (width !== FIRST + fields.length) problems.push(`sheet is ${width} columns wide, expected ${FIRST + fields.length}`);
  if (problems.length > 0) throw new Error(`the housing workbook doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
}

export function parseHcpHousing(bytes: Uint8Array): HousingRow[] {
  const rows = readSheetRows(bytes, 1);
  housingLayout(rows);
  const start = rows.findIndex((r) => clean(r[LABEL]) === NATIONAL);
  if (start !== 5) throw new Error(`the national row is row ${start}, expected 5`);
  return rows
    .slice(start)
    .filter((r) => clean(r[LABEL]) !== "")
    .map((r) => ({
      code: clean(r[CODE]).replace(/\D/g, "") || null,
      label: clean(r[LABEL]),
      figures: HOUSING_FIELDS.map((f, i) => toFigure(r[FIRST + i], f.unit)),
    }));
}

export { HOUSING_FIELDS, type HousingField };
