/**
 * A commune's neighbourhoods and postcodes, for its page, from the same table the API's
 * files are written from: the names OpenStreetMap and Poste Maroc give, with the
 * arrondissement where a name was placed by its point, and the postcodes Poste Maroc lists
 * under it. Read at build time from the files the search uses.
 */
import { readFileSync } from "node:fs";
import type { Neighbourhood } from "../../../api/src/lib/neighbourhoods.ts";
import { neighbourhoodTable, postcodesByCommune, type PostcodeRow } from "../../../api/src/lib/neighbourhoodTable.ts";
import { arrondissementOf } from "./places";

export interface NeighbourhoodRow {
  fr: string;
  ar: string;
  /** The arrondissement it's in, by name, where it was placed by its point. */
  arrondissement: string | null;
  postcodes: string[];
}

const places = (JSON.parse(readFileSync("api/data/neighbourhoods.json", "utf8")) as { places: Neighbourhood[] }).places;
const postcodeRows = (JSON.parse(readFileSync("api/data/postcodes.json", "utf8")) as { postcodes: PostcodeRow[] }).postcodes;

const table = neighbourhoodTable(places, postcodeRows, (code) => arrondissementOf.get(code)?.communeCode ?? code);
const byCommune = new Map<string, NeighbourhoodRow[]>();
for (const row of table) {
  if (!byCommune.has(row.commune)) byCommune.set(row.commune, []);
  byCommune.get(row.commune)!.push({
    fr: row.name.fr,
    ar: row.name.ar,
    arrondissement: row.arrondissement ? (arrondissementOf.get(row.arrondissement)?.name.fr ?? null) : null,
    postcodes: row.postcodes,
  });
}
const postcodes = postcodesByCommune(postcodeRows);

/** A commune's neighbourhoods, its arrondissements' included, in alphabetical order. */
export const neighbourhoodsOf = (communeCode: string): NeighbourhoodRow[] => byCommune.get(communeCode) ?? [];

/** A commune's postcodes, in order. */
export const postcodesOf = (communeCode: string): string[] => postcodes.get(communeCode) ?? [];
