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

/** Words a name can carry or not and still be the same name. */
const OPTIONAL = new Set(["el", "al", "l", "la", "le", "les", "d", "de", "du", "des"]);
const VOWEL = /[aeiouy]/;
/** A name as 2 lists might both write it: no article, and Lot for Lotissement. */
const bareName = (name: string) =>
  normalise(name)
    .split(" ")
    .map((w) => (w === "lotissement" ? "lot" : w))
    .filter((w) => !OPTIONAL.has(w))
    .join(" ");

/** The one way 2 strings differ, when they differ in exactly one place. */
function oneEdit(a: string, b: string): { kind: "swap" | "change" | "add"; at: number; ch: string; other: string } | null {
  if (a === b) return null;
  if (a.length === b.length) {
    const diffs = [...a].map((ch, i) => (ch === b[i] ? -1 : i)).filter((i) => i >= 0);
    if (diffs.length === 1) return { kind: "change", at: diffs[0]!, ch: a[diffs[0]!]!, other: b[diffs[0]!]! };
    if (diffs.length === 2 && diffs[1] === diffs[0]! + 1 && a[diffs[0]!] === b[diffs[1]!] && a[diffs[1]!] === b[diffs[0]!]) {
      return { kind: "swap", at: diffs[0]!, ch: a[diffs[0]!]!, other: b[diffs[0]!]! };
    }
    return null;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length - short.length !== 1) return null;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return long.slice(i + 1) === short.slice(i) ? { kind: "add", at: i, ch: long[i]!, other: "" } : null;
}

/**
 * Whether 2 spellings name the same neighbourhood, for setting a second list's name aside
 * when the first has it. Measured on the 205 pairs a looser rule paired in 34 cities: a
 * single letter is often the whole of what tells 2 names apart (Farah and Faraj, Raja and
 * Raha, Amal and Kamal), so only these count, and a number or numeral at the end has to match:
 * 2 letters swapped (Daib, Diab), a letter doubled (Bretone, Bretonne), or a vowel changed,
 * added or dropped inside a word of 7 letters or more (Mahrach, Mahrech). Under the same
 * postcode, a vowel changed at a word's end counts too: Poste Maroc lists California and
 * Californie both at 20150. One added there still doesn't: Farid and Farida share a postcode.
 */
export function sameName(a: string, b: string, options: { samePostcode?: boolean } = {}): boolean {
  const x = bareName(a);
  const y = bareName(b);
  if (x === y) return x.length > 0;
  const sector = (s: string) => / (\d+|[ivx]+|[a-z])$/.exec(s)?.[1] ?? "";
  if (sector(x) !== sector(y)) return false;
  const edit = oneEdit(x, y);
  if (!edit) return false;
  if (edit.kind === "swap") return true;
  const longer = x.length >= y.length ? x : y;
  // A doubled letter: the one added sits beside the same letter.
  if (edit.kind === "add" && (longer[edit.at - 1] === edit.ch || longer[edit.at + 1] === edit.ch)) return true;
  const vowels = edit.kind === "add" ? VOWEL.test(edit.ch) : VOWEL.test(edit.ch) && VOWEL.test(edit.other);
  if (!vowels) return false;
  // Inside its word, and the word long enough that a vowel isn't what names it.
  const start = longer.lastIndexOf(" ", edit.at) + 1;
  const end = longer.indexOf(" ", edit.at) === -1 ? longer.length : longer.indexOf(" ", edit.at);
  const word = longer.slice(start, end);
  // A vowel changed at the end, not one added: California and Californie, never Farid and Farida.
  if (options.samePostcode && edit.kind === "change" && word.length >= 5 && edit.at > start) return true;
  return word.length >= 7 && edit.at > start && edit.at < end - 1;
}
