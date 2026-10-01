import { readSheetRows } from "../lib/xlsx.ts";
import { DOUAR_TYPES, HOUSEHOLD_FIELDS, PEOPLE_FIELDS, PLACE_HEADINGS, type DouarField, type DouarType } from "./douarFields.ts";
import type { Definition } from "./hcpDefinitions.ts";

/**
 * HCP's douar workbook: 33,189 douars, each on a row of the people sheet and the same row
 * of the households sheet, with a third sheet of definitions.
 *
 * Each header cell holds the Arabic and the French one above the other. The parser reads
 * the French half, joins a group's heading to its sub-column's, and checks the result
 * against the field list before it reads a figure, so a column that moved is refused
 * rather than read under the wrong name.
 *
 * HCP withholds a douar's shares and distances, writing `X`, when it has fewer than 30
 * households. Its households and people are always given.
 */

export interface DouarRow {
  /** HCP's 13-digit douar code, zero-padded: province, cercle, commune, fraction, douar. */
  code: string;
  /** The places above it, as the workbook names them, in Arabic. */
  region: string;
  province: string;
  cercle: string;
  commune: string;
  fraction: string;
  name: string;
  type: DouarType;
  households: number;
  population: number;
  /** In the order of PEOPLE_FIELDS and HOUSEHOLD_FIELDS; null where HCP withholds them. */
  people: (number | null)[];
  homes: (number | null)[];
}

const TITLES = [
  "خصائص السكان البلديون بالوسط القروي (ما عدا الرحال) حسب الدواوير",
  "خصائص الأسر بالوسط القروي (ما عدا الرحال) حسب الدواوير",
];
const CODE = /^\d{11,13}$/;
const WITHHELD = "X";

const clean = (s: unknown) => (s ?? "").toString().replace(/\s+/g, " ").trim();

/** The French half of a header cell: after HCP's dashes, or after the `(%)` where it has none. */
export function frenchOf(cell: string | null | undefined): string {
  const text = clean(cell);
  if (text === "") return "";
  const dashed = text.split(/—+/);
  if (dashed.length > 1) return clean(dashed.at(-1));
  const percent = text.split("(%)");
  return clean(percent.at(-1));
}

/** Each column's heading: its group's French, then its own where it has one. */
export function headingsOf(rows: (string | null)[][]): string[] {
  const top = rows[1] ?? [];
  const sub = rows[2] ?? [];
  const out: string[] = [];
  let group = "";
  for (let col = 0; col < Math.max(top.length, sub.length); col++) {
    if (clean(top[col]) !== "") group = frenchOf(top[col]);
    const own = frenchOf(sub[col]);
    out.push(own ? `${group} · ${own}` : group);
  }
  return out;
}

/** Checks a sheet against its field list, column by column. */
export function douarLayout(rows: (string | null)[][], fields: DouarField[], title: string): void {
  const problems: string[] = [];
  if (!clean(rows[0]?.[0]).startsWith(title)) problems.push(`the title reads ${JSON.stringify(clean(rows[0]?.[0]))}`);
  const headings = headingsOf(rows);
  const expected = [...PLACE_HEADINGS, ...fields.map((f) => f.heading)];
  expected.forEach((heading, col) => {
    if (headings[col] !== heading) problems.push(`column ${col}: heading ${JSON.stringify(headings[col])}, expected ${JSON.stringify(heading)}`);
  });
  if (headings.length !== expected.length) problems.push(`sheet is ${headings.length} columns wide, expected ${expected.length}`);
  if (problems.length > 0) throw new Error(`the douar workbook doesn't have the expected layout:\n  ${problems.join("\n  ")}`);
}

/** A figure, rounded to what it can carry: a whole person, a tenth of a percent, ten metres. */
export function toFigure(raw: string | null | undefined, unit: DouarField["unit"]): number | null {
  const text = clean(raw);
  if (text === WITHHELD) return null;
  if (!/^-?\d+(\.\d+)?(E-?\d+)?$/i.test(text)) throw new Error(`unreadable figure: ${JSON.stringify(raw)}`);
  const value = Number(text);
  if (unit === "people") return Math.round(value);
  if (unit === "km") return Math.round(value * 100) / 100;
  return Math.round(value * 10) / 10;
}

const count = (raw: string | null | undefined, what: string, code: string) => {
  const text = clean(raw);
  if (!/^\d+$/.test(text)) throw new Error(`douar ${code}: ${what} reads ${JSON.stringify(raw)}`);
  return Number(text);
};

const TYPE_OF = new Map<string, DouarType>(Object.entries(DOUAR_TYPES).map(([key, t]) => [t.ar, key as DouarType]));

/** A sheet's douar rows, which run unbroken from the 4th row to the notes at the foot. */
function dataRows(rows: (string | null)[][]): (string | null)[][] {
  const first = rows.findIndex((r) => CODE.test(clean(r[0])));
  if (first !== 4) throw new Error(`the first douar is on row ${first}, expected 4`);
  let last = first;
  while (last < rows.length && CODE.test(clean(rows[last]![0]))) last++;
  const stray = rows.slice(last).find((r) => CODE.test(clean(r[0])));
  if (stray) throw new Error(`douar ${clean(stray[0])} comes after the notes`);
  return rows.slice(first, last);
}

export function parseHcpDouars(bytes: Uint8Array): DouarRow[] {
  const peopleSheet = readSheetRows(bytes, 1);
  const homeSheet = readSheetRows(bytes, 2);
  douarLayout(peopleSheet, PEOPLE_FIELDS, TITLES[0]!);
  douarLayout(homeSheet, HOUSEHOLD_FIELDS, TITLES[1]!);
  const people = dataRows(peopleSheet);
  const homes = dataRows(homeSheet);
  if (people.length !== homes.length) throw new Error(`the people sheet has ${people.length} douars and the households sheet ${homes.length}`);

  return people.map((p, i) => {
    const h = homes[i]!;
    const code = clean(p[0]).padStart(13, "0");
    for (let col = 0; col < PLACE_HEADINGS.length; col++) {
      if (clean(p[col]) !== clean(h[col])) throw new Error(`douar ${code}: the 2 sheets disagree on ${PLACE_HEADINGS[col]}`);
    }
    const type = TYPE_OF.get(clean(p[7]));
    if (!type) throw new Error(`douar ${code}: an unknown type ${JSON.stringify(clean(p[7]))}`);
    const first = PLACE_HEADINGS.length;
    return {
      code,
      region: clean(p[1]),
      province: clean(p[2]),
      cercle: clean(p[3]),
      commune: clean(p[4]),
      fraction: clean(p[5]),
      name: clean(p[6]),
      type,
      households: count(p[8], "the households", code),
      population: count(p[9], "the population", code),
      people: PEOPLE_FIELDS.map((f, j) => toFigure(p[first + j], f.unit)),
      homes: HOUSEHOLD_FIELDS.map((f, j) => toFigure(h[first + j], f.unit)),
    };
  });
}

/**
 * The definitions sheet: Arabic on the left, French on the right, a term on its own line
 * ending in a colon and its definition on the next. A line with no colon and no term open
 * is a section heading, and is passed over.
 */
export function parseDouarDefinitions(bytes: Uint8Array, sheet = 3): Definition[] {
  const found: Definition[] = [];
  let term: string | null = null;
  for (const row of readSheetRows(bytes, sheet)) {
    const line = clean(row[2]);
    if (line === "") continue;
    if (term === null) {
      if (line.endsWith(":")) term = line.replace(/\s*:$/, "");
      continue;
    }
    found.push({ term, body: line });
    term = null;
  }
  if (term !== null) throw new Error(`the douar definitions sheet ends on "${term}", with no definition`);
  if (found.length < 12) throw new Error(`the douar definitions sheet holds ${found.length} definitions, expected at least 12`);
  return found;
}
