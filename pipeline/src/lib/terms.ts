/**
 * A term as it is compared.
 *
 * HCP writes the same concept differently from one place to another: a column heading
 * carries its unit, a definition doesn't, and the two workbooks disagree about which
 * apostrophe to use. Case, the unit in brackets, the separators and the apostrophe all
 * come off, and what is left is what a heading and a definition are matched on.
 */
export const termKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[()%.:·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
