import { readSheetRows } from "../lib/xlsx.ts";
import { termKey } from "../lib/terms.ts";

/**
 * The concepts HCP defines in its own workbooks.
 *
 * Two of the 2024 workbooks carry a sheet of definitions beside their figures: the
 * indicators define 52 census concepts, from the legal population to the distance to a
 * tarred road, and the urban housing stock defines 15, from what makes a dwelling to what
 * makes one modern. Both are read here so the dataset can say what a column means in the
 * words of the office that collected it.
 *
 * The two sheets are laid out differently, so each has its own reader. Both refuse a sheet
 * that isn't the shape they expect rather than publishing whatever they found.
 */
export interface Definition {
  /** HCP's name for the concept, as its sheet writes it. */
  term: string;
  /** HCP's wording, in French. */
  body: string;
}

const clean = (s: unknown) => (s ?? "").toString().replace(/\s+/g, " ").trim();
export { termKey };

const TITLE = "Définitions des concepts";
const lines = (bytes: Uint8Array, sheet: number, what: string) => {
  const rows = readSheetRows(bytes, sheet).map((r) => clean(r[0]));
  if (rows[0] !== TITLE) throw new Error(`the ${what} definitions sheet starts with "${rows[0]}", expected "${TITLE}"`);
  return rows.slice(1).filter((r) => r !== "");
};

/**
 * The census indicators' sheet: a term on its own line, ending in a colon, then its
 * definition on the next.
 */
export function parseCensusDefinitions(bytes: Uint8Array, sheet = 7): Definition[] {
  const found: Definition[] = [];
  let term: string | null = null;
  for (const line of lines(bytes, sheet, "census")) {
    if (line.endsWith(":")) {
      if (term !== null) throw new Error(`the census definitions sheet gives no definition for "${term}"`);
      term = line.replace(/\s*:$/, "");
      continue;
    }
    if (term === null) throw new Error(`the census definitions sheet has a definition under no term: "${line.slice(0, 60)}"`);
    found.push({ term, body: line });
    term = null;
  }
  if (term !== null) throw new Error(`the census definitions sheet ends on "${term}", with no definition`);
  if (found.length < 40) throw new Error(`the census definitions sheet holds ${found.length} definitions, expected at least 40`);
  return found;
}

/**
 * The urban housing stock's sheet: headings marked `v`, the types under them marked `§`
 * with their definition after a colon on the same line. A heading followed by prose is a
 * term of its own; a heading followed only by types is a grouping, and is passed over.
 */
export function parseHousingDefinitions(bytes: Uint8Array, sheet = 2): Definition[] {
  const found: Definition[] = [];
  let heading: { term: string; body: string[] } | null = null;
  const close = () => {
    if (heading && heading.body.length > 0) found.push({ term: heading.term, body: heading.body.join(" ") });
    heading = null;
  };
  for (const line of lines(bytes, sheet, "housing")) {
    if (line.startsWith("§")) {
      const rest = line.replace(/^§\s*/, "");
      const at = rest.indexOf(":");
      if (at < 0) throw new Error(`the housing definitions sheet gives no definition for "${rest.slice(0, 60)}"`);
      found.push({ term: clean(rest.slice(0, at)), body: clean(rest.slice(at + 1)) });
      continue;
    }
    if (line.startsWith("v")) {
      close();
      heading = { term: clean(line.replace(/^v\s*/, "").replace(/\s*:$/, "")), body: [] };
      continue;
    }
    if (heading === null) throw new Error(`the housing definitions sheet has a definition under no term: "${line.slice(0, 60)}"`);
    heading.body.push(line);
  }
  close();
  if (found.length < 12) throw new Error(`the housing definitions sheet holds ${found.length} definitions, expected at least 12`);
  return found;
}

/** The definitions by term, for a field to find the one that defines it. */
export function definitionsByTerm(definitions: Definition[]): Map<string, Definition> {
  const index = new Map<string, Definition>();
  for (const d of definitions) {
    const key = termKey(d.term);
    if (index.has(key)) throw new Error(`HCP defines "${d.term}" twice`);
    index.set(key, d);
  }
  return index;
}

/**
 * The term HCP defines a column under, or null where it defines none.
 *
 * A column named in the concept map takes the term named there, and a name HCP doesn't
 * define stops the build rather than going out as a dangling reference. Every other column
 * is looked up by its own category, then by its heading, since HCP heads most of them with
 * the concept it defines.
 */
export function termFor(
  index: Map<string, Definition>,
  concepts: Record<string, string>,
  field: { topic: string; key: string; heading: string; category?: string },
): string | null {
  const named = concepts[`${field.topic}.${field.key}`] ?? concepts[field.topic];
  if (named !== undefined) {
    const found = index.get(termKey(named));
    if (!found) throw new Error(`${field.topic}.${field.key} is defined as "${named}", which HCP's sheet doesn't define`);
    return found.term;
  }
  const own = (field.category ? index.get(termKey(field.category)) : undefined) ?? index.get(termKey(field.heading));
  return own?.term ?? null;
}
