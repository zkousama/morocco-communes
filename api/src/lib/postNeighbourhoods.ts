/**
 * Poste Maroc's list of neighbourhoods by postcode, "Codes postaux des quartiers" on
 * data.gov.ma, under the ODbL. It names over 10,000 in 34 cities, in capitals, each with
 * its city and postcode but no point, so a name is placed in its city's commune, and in
 * no arrondissement. These are the rules that turn a row into a name people would type.
 */
import { normalise } from "./normalise.ts";

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
