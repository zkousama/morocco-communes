import { readSheetRows } from "../lib/xlsx.ts";
import { AREAS, SEXES, type Area, type Sex } from "./indicatorFields.ts";
import { COMMUTE_FIELDS_2024, MOBILITY_FIELDS_2014, type MobilityField } from "./mobilityFields.ts";
import { toCell, type Cell } from "./hcpIndicators.ts";
import { headingProblems, parse2014Blocks, type BlockRow } from "./hcp2014Blocks.ts";

/**
 * HCP's two workbooks on getting to work, one per census. Each has a sheet for the whole
 * unit, its urban part and its rural part, and three blocks of columns to a sheet, one per
 * sex. Every heading is checked against the field list before a figure is read.
 *
 * The 2024 sheets end each block with a Total column, which the parser confirms adds to
 * 100 and then drops. The 2014 sheets are laid out like the other 2014 workbooks.
 */

/** A unit's figures from one of these workbooks, the same shape either census gives. */
export type MobilityRow = BlockRow;

const SHEETS: Record<Area, number> = { total: 1, urban: 2, rural: 3 };
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * A cell of the 2024 workbook. Where a unit has no urban or no rural part, the row on that
 * sheet stops after the name rather than carrying a sign, so an empty cell is the figure
 * having no place there.
 */
const toCell2024 = (raw: string | null | undefined, unit: MobilityField["unit"]): Cell =>
  clean(raw) === "" ? "n/a" : toCell(raw, unit);

/* The 2024 workbook: code and name, then a block per sex of the count, 12 modes and a total. */

const CODE_2024 = 0;
const LABEL_2024 = 1;
const FIRST_2024 = 2;
const HEADINGS_2024 = 4;
const BLOCK_2024 = COMMUTE_FIELDS_2024.length + 1;
const SEX_LABEL_2024: Record<Sex, string> = { all: "Sexe : Ensemble", male: "Sexe : Masculin", female: "Sexe : Féminin" };
const AREA_SHEET_2024: Record<Area, string> = { total: "Ensemble", urban: "Urbain", rural: "Rural" };

/** Checks a 2024 sheet's headings, and returns where each sex's block starts. */
export function commuteLayout2024(rows: (string | null)[][], area: Area): Record<Sex, number> {
  const problems: string[] = [];
  // The rural sheet labels its code and name columns a row lower than the other two, so
  // either row counts. Everything else about the three sheets is in the same place.
  const labelled = (col: number, text: string) => [2, 3].some((row) => clean(rows[row]?.[col]) === text);
  if (!labelled(CODE_2024, "Code géographique")) problems.push(`no Code géographique heading over column ${CODE_2024}`);
  if (!labelled(LABEL_2024, "Collectivités territoriales")) problems.push(`no Collectivités territoriales heading over column ${LABEL_2024}`);
  const starts = {} as Record<Sex, number>;
  SEXES.forEach((sex, i) => {
    const col = FIRST_2024 + i * BLOCK_2024;
    starts[sex] = col;
    const label = clean(rows[1]?.[col]);
    if (label !== SEX_LABEL_2024[sex]) problems.push(`column ${col}: sex ${JSON.stringify(label)}, expected ${JSON.stringify(SEX_LABEL_2024[sex])}`);
    problems.push(...headingProblems(rows, COMMUTE_FIELDS_2024, col, 2, 3));
    const total = clean(rows[3]?.[col + COMMUTE_FIELDS_2024.length]);
    if (total !== "Total") problems.push(`column ${col + COMMUTE_FIELDS_2024.length}: expected the block's Total, read ${JSON.stringify(total)}`);
  });
  const width = Math.max(...rows.slice(0, HEADINGS_2024).map((r) => r.length));
  if (width !== FIRST_2024 + SEXES.length * BLOCK_2024) problems.push(`sheet is ${width} columns wide, expected ${FIRST_2024 + SEXES.length * BLOCK_2024}`);
  if (problems.length > 0) throw new Error(`the ${area} sheet of the 2024 commuting workbook doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
  return starts;
}

const NATIONAL_2024 = "Ensemble du territoire national";

export function parseHcpCommute2024(bytes: Uint8Array): MobilityRow[] {
  const sheets = {} as Record<Area, (string | null)[][]>;
  const starts = {} as Record<Area, Record<Sex, number>>;
  for (const area of AREAS) {
    const rows = readSheetRows(bytes, SHEETS[area]);
    starts[area] = commuteLayout2024(rows, area);
    const start = rows.findIndex((r) => clean(r[LABEL_2024]) === NATIONAL_2024);
    if (start !== HEADINGS_2024) throw new Error(`the ${area} sheet's national row is row ${start}, expected ${HEADINGS_2024}`);
    sheets[area] = rows.slice(start).filter((r) => clean(r[LABEL_2024]) !== "");
  }

  const spine = sheets.total;
  for (const area of AREAS) {
    if (sheets[area].length !== spine.length) throw new Error(`the ${area} sheet has ${sheets[area].length} rows, the total sheet ${spine.length}`);
    sheets[area].forEach((r, i) => {
      if (clean(r[CODE_2024]) !== clean(spine[i]![CODE_2024])) {
        throw new Error(`row ${i} of the ${area} sheet is ${clean(r[CODE_2024])}, the total sheet's ${clean(spine[i]![CODE_2024])}`);
      }
    });
  }

  // Each block's own total, which the workbook prints and the parser drops.
  const totals: string[] = [];
  const rows = spine.map((row, i) => ({
    codeDigits: clean(row[CODE_2024]).replace(/\D/g, "") || null,
    label: clean(row[LABEL_2024]),
    people: Object.fromEntries(
      AREAS.map((area) => [
        area,
        Object.fromEntries(
          SEXES.map((sex) => {
            const from = starts[area][sex];
            const line = sheets[area][i]!;
            const cells = COMMUTE_FIELDS_2024.map((f, j) => toCell2024(line[from + j], f.unit));
            const total = toCell2024(line[from + COMMUTE_FIELDS_2024.length], "percent");
            // A commune where the census found no employed woman has a count of 0 and a
            // total of 0, which is the workbook being consistent rather than wrong.
            const counted = cells[0];
            if (typeof total === "number" && typeof counted === "number" && counted > 0 && Math.abs(total - 100) > 0.5) {
              totals.push(`${clean(row[LABEL_2024])} ${area}/${sex}: ${counted} people and the modes total ${total}`);
            }
            return [sex, cells];
          }),
        ),
      ]),
    ) as MobilityRow["people"],
  }));
  if (totals.length > 0) throw new Error(`the 2024 commuting workbook's own totals don't add up:\n  ${totals.slice(0, 20).join("\n  ")}`);
  return rows;
}

/* The 2014 workbook has the layout the other 2014 workbooks have, read by that reader. */

export const parseHcp2014Mobility = (bytes: Uint8Array): MobilityRow[] =>
  parse2014Blocks(bytes, MOBILITY_FIELDS_2014, "mobility");

export { COMMUTE_FIELDS_2024, MOBILITY_FIELDS_2014, type MobilityField };
