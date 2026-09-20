import { readSheetRows } from "../lib/xlsx.ts";
import { ECONOMY_FIELDS, type EconomyField } from "./economyFields.ts";

/**
 * HCP's mapping of economic establishments, one sheet: a row per unit, from the country
 * down to the commune, and 22 counts across. Every heading is checked against the field
 * list before a figure is read.
 *
 * The workbook holds the count of jobs as a float with the noise a division leaves,
 * 3585475.000000014 for 3,585,475, so a count is rounded to the whole thing it counts.
 */

export interface EstablishmentRow {
  /** The digits of HCP's dotted code. Null for the national row. */
  codeDigits: string | null;
  /** As HCP writes it: "Commune Rurale: Bni Boufrah", "Préfecture d'Arrondissements …". */
  label: string;
  counts: (number | null)[];
}

const CODE = 5;
const LABEL = 6;
const FIRST = 7;
const HEADING_ROW = 4;
const CATEGORY_ROW = 5;
const NATIONAL = "Total Royaume du Maroc";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** A cell, which is a count of something and so a whole number. An empty cell is no figure. */
export function toCount(raw: string | null | undefined): number | null {
  const text = clean(raw);
  if (text === "") return null;
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(text)) throw new Error(`unreadable count: ${JSON.stringify(raw)}`);
  return Math.round(Number(text));
}

/** Checks the sheet's headings against the field list, and where the figures start. */
export function establishmentsLayout(rows: (string | null)[][], fields: EconomyField[] = ECONOMY_FIELDS): void {
  const problems: string[] = [];
  if (clean(rows[HEADING_ROW]?.[LABEL]) !== "Subdivisions administratives du Royaume") {
    problems.push(`the name column reads ${JSON.stringify(clean(rows[HEADING_ROW]?.[LABEL]))}`);
  }
  if (clean(rows[CATEGORY_ROW]?.[0]) !== "Rég.") problems.push(`the code columns start ${JSON.stringify(clean(rows[CATEGORY_ROW]?.[0]))}`);
  let heading = "";
  fields.forEach((f, i) => {
    const col = FIRST + i;
    if (clean(rows[HEADING_ROW]?.[col])) heading = clean(rows[HEADING_ROW]?.[col]);
    if (heading !== f.heading) problems.push(`column ${col}: heading ${JSON.stringify(heading)}, expected ${JSON.stringify(f.heading)}`);
    const category = clean(rows[CATEGORY_ROW]?.[col]);
    if (category !== (f.category ?? "")) problems.push(`column ${col}: category ${JSON.stringify(category)}, expected ${JSON.stringify(f.category ?? "")}`);
  });
  const width = Math.max(...rows.slice(0, CATEGORY_ROW + 1).map((r) => r.length));
  if (width !== FIRST + fields.length) problems.push(`sheet is ${width} columns wide, expected ${FIRST + fields.length}`);
  if (problems.length > 0) throw new Error(`the establishments workbook doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
}

export function parseHcpEstablishments(bytes: Uint8Array): EstablishmentRow[] {
  const rows = readSheetRows(bytes, 1);
  establishmentsLayout(rows);
  const start = rows.findIndex((r) => clean(r[LABEL]) === NATIONAL);
  if (start !== CATEGORY_ROW + 1) throw new Error(`the national row is row ${start}, expected ${CATEGORY_ROW + 1}`);
  return rows
    .slice(start)
    .filter((r) => clean(r[LABEL]) !== "")
    .map((r) => ({
      codeDigits: clean(r[CODE]).replace(/\D/g, "") || null,
      label: clean(r[LABEL]),
      counts: ECONOMY_FIELDS.map((_, i) => toCount(r[FIRST + i])),
    }));
}

export { ECONOMY_FIELDS, type EconomyField };
