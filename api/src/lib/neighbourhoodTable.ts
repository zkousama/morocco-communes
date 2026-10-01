/**
 * The neighbourhoods as a table: each with its commune, its arrondissement where it was
 * placed in one by its point, where its name comes from, and the postcodes Poste Maroc
 * lists under the same name in the same commune. The API's files and the MCP tool both
 * read this, so they can't tell 2 stories.
 */
import type { Neighbourhood, NeighbourhoodSource } from "./neighbourhoods.ts";
import { normalise } from "./normalise.ts";
import { coreOf, sameName } from "./postNeighbourhoods.ts";

export interface TableRow {
  name: { fr: string; ar: string };
  /** The commune it's in; a city's, for a neighbourhood in one of its arrondissements. */
  commune: string;
  /** The arrondissement, where it was placed in one by its point. */
  arrondissement: string | null;
  source: NeighbourhoodSource;
  postcodes: string[];
}

/** A postcode, the commune it's in, and the neighbourhoods Poste Maroc lists under it. */
export type PostcodeRow = [postcode: string, commune: string, neighbourhoods: string[]];

const key = (name: string) => coreOf(normalise(name));

/** `communeOf` gives a unit's commune: its own code, or its city's for an arrondissement. */
export function neighbourhoodTable(places: Neighbourhood[], postcodes: PostcodeRow[], communeOf: (code: string) => string): TableRow[] {
  const named = new Map<string, Set<string>>();
  // Each commune's names under its postcodes, as written, for a name the list spells another way.
  const listed = new Map<string, Map<string, Set<string>>>();
  for (const [postcode, commune, names] of postcodes) {
    for (const name of names) {
      const k = `${commune}|${key(name)}`;
      if (!named.has(k)) named.set(k, new Set());
      named.get(k)!.add(postcode);
      if (!listed.has(commune)) listed.set(commune, new Map());
      if (!listed.get(commune)!.has(name)) listed.get(commune)!.set(name, new Set());
      listed.get(commune)!.get(name)!.add(postcode);
    }
  }
  /** The postcodes Poste Maroc lists under a name, or under the same name spelt another way. */
  const postcodesOf = (commune: string, name: string): Set<string> | undefined => {
    const exact = named.get(`${commune}|${key(name)}`);
    if (exact) return exact;
    for (const [other, codes] of listed.get(commune) ?? []) if (sameName(name, other)) return codes;
    return undefined;
  };
  return places
    .map(([fr, ar, code, source]) => {
      const commune = communeOf(code);
      const codes = postcodesOf(commune, fr || ar);
      return {
        name: { fr: fr || ar, ar: fr ? ar : "" },
        commune,
        arrondissement: commune === code ? null : code,
        source: source ?? "osm",
        postcodes: codes ? [...codes].sort() : [],
      };
    })
    .sort((a, b) => a.commune.localeCompare(b.commune) || a.name.fr.localeCompare(b.name.fr, "fr") || (a.arrondissement ?? "").localeCompare(b.arrondissement ?? ""));
}

/** Each commune's postcodes, in order. */
export function postcodesByCommune(postcodes: PostcodeRow[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const [postcode, commune] of postcodes) {
    if (!out.has(commune)) out.set(commune, new Set());
    out.get(commune)!.add(postcode);
  }
  return new Map([...out].map(([commune, codes]) => [commune, [...codes].sort()]));
}
