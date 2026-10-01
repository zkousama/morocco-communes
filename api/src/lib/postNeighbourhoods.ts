/**
 * Poste Maroc's list of neighbourhoods by postcode, "Codes postaux des quartiers" on
 * data.gov.ma, under the ODbL. It names over 10,000 in 34 cities, in capitals, each with
 * its city and postcode but no point, so a name is placed in its city's commune, and in
 * no arrondissement. These are the rules that turn a row into a name people would type.
 */
import { normalise, skeleton } from "./normalise.ts";

/** First words of rows that name a building or a market, not a place people live in. */
const NOT_A_PLACE = new Set(["immeuble", "imm", "bloc", "kissariat", "kissariate", "kissaria", "marche", "complexe", "groupe", "magasin"]);
/** French words that stay lower case inside a name. */
const SMALL = new Set(["de", "du", "des", "d", "la", "le", "les", "et", "au", "aux", "en", "sur"]);
const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/;

const capital = (word: string) => word.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/** A row's name, cleaned, or null when it isn't a place to search for. */
export function cleanName(raw: string): string | null {
  const words = raw.trim().replace(/\s+/g, " ").toLowerCase().split(" ").filter(Boolean);
  if (words[0] === "quartier") words.shift();
  if (words.length === 0 || NOT_A_PLACE.has(normalise(words[0]!))) return null;
  // "Quartier A" and "Quartier 133" say nothing a search could find.
  const letters = words.join("").replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return null;
  return words
    .map((word, i) => {
      if (ROMAN.test(word)) return word.toUpperCase();
      const lower = word.replace(/^d['’]/, "d'");
      if (i > 0 && SMALL.has(lower.replace(/['’].*$/, ""))) return lower.replace(/(['’])(\p{L})/u, (_, q: string, ch: string) => q + ch.toUpperCase());
      return capital(lower);
    })
    .join(" ");
}

const ARTICLES = /^(l|el|al|la|le|les) /;
/** A normalised name with any article in front set aside, for telling whether 2 names are the same place. */
export const coreOf = (normalised: string) => normalised.replace(ARTICLES, "");

/** A city's name with its spaces gone, so ELJADIDA and El Jadida meet. */
export const cityKey = (name: string) => normalise(name).replace(/ /g, "");

/**
 * The commune a locality of Poste Maroc's names, among its province's: the same name, or
 * failing that the one commune with the same consonants, as the search reads Titwan.
 * Null when there's none or more than one, since a guess would give a commune a postcode
 * that isn't its own; a village that isn't a commune finds none.
 */
export function communeFor<T extends { name: { fr: string } }>(locality: string, communes: T[]): T | null {
  const key = cityKey(locality);
  const same = communes.filter((c) => cityKey(c.name.fr) === key);
  if (same.length === 1) return same[0]!;
  if (same.length > 1) return null;
  const bones = skeleton(normalise(locality));
  if (bones.length < 3) return null;
  const alike = communes.filter((c) => skeleton(normalise(c.name.fr)) === bones);
  return alike.length === 1 ? alike[0]! : null;
}

/**
 * Each of Poste Maroc's city names to its urban commune. A city with none is an error
 * rather than a skip: the list names 34 cities, and losing one would drop its postcodes
 * and neighbourhoods without a word.
 */
export function citiesOf<T extends { type?: string; name: { fr: string } }>(names: string[], communes: T[]): Map<string, T> {
  const towns = new Map(communes.filter((c) => c.type === "urban").map((c) => [cityKey(c.name.fr), c]));
  const cities = new Map<string, T>();
  const missing = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name || cities.has(name)) continue;
    const commune = towns.get(cityKey(name));
    if (commune) cities.set(name, commune);
    else missing.add(name);
  }
  if (missing.size > 0) throw new Error(`no urban commune for Poste Maroc's cities: ${[...missing].join(", ")}`);
  return cities;
}
