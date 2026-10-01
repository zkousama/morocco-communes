/**
 * Arabic and Latin spellings of the same Moroccan name, brought to one key so either can
 * find the other: تيݣراو and Tigraw, سيدي بوالسحاب and Sidi Boushab. Plain rules, no model.
 *
 * The key keeps the consonants both scripts agree on and drops what they don't: the vowels,
 * which Arabic leaves unwritten; y and w, which French writes as i, ou or o as often as
 * not; h, which is ه, ح or nothing; and ع, which French writes as a vowel. k, g and q are one
 * letter, since ك is the Moroccan hard g as often as a k, and غ is r, as French writes it
 * gh or rh. The article goes from the front of an Arabic word, and French writes it inside
 * a name as often as apart (Abdelkader, Sidi El Rhandour), so two keys also meet once
 * every l is taken out of both.
 *
 * Where a spelling can go 2 ways, a name has more than one key: a ta marbuta before another
 * word said as t or not (Zaouiat Sidi, Karia Ba Mohamed), ج as j or as the hard g of
 * Guercif, and French sh as ش or as س then ح (Ishaq). Measured on the 1,852 units HCP names
 * in both scripts, keys meet for 98.3% of them; most of the rest are French names that
 * aren't spellings of the Arabic at all, like Casablanca, Tanger and Banlieue Nord.
 */
import { normalise } from "./normalise.ts";

/** Articles French writes as a word of their own. */
const ARTICLES = new Set(["el", "al", "l", "ed", "er", "es", "ez", "et", "en", "ech", "ad", "ar", "as", "az", "at", "an"]);
/** Abbreviations in official names. */
const SHORT: Record<string, string> = { my: "moulay", sd: "sidi" };

const ARABIC: Record<string, string> = {
  "ب": "b", "پ": "b", "ت": "t", "ث": "t", "ج": "j", "ح": "", "خ": "x", "د": "d", "ذ": "d", "ر": "r",
  "ز": "z", "س": "s", "ش": "S", "ص": "s", "ض": "d", "ط": "t", "ظ": "d", "ع": "", "غ": "r", "ف": "f",
  "ڤ": "v", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "", "و": "", "ي": "", "ا": "",
};

const squeeze = (key: string) => key.replace(/(.)\1+/g, "$1");

function arabicKeyOf(name: string): string {
  const words = normalise(name).split(" ").filter(Boolean);
  return squeeze(
    words
      .map((w) => (w.startsWith("ال") && w.length > 3 ? w.slice(2) : w))
      .map((w) => [...w].map((c) => ARABIC[c] ?? "").join(""))
      .join(""),
  );
}

/** Every key an Arabic name can be written to in Latin. */
export function arabicKeys(name: string): string[] {
  const plain = arabicKeyOf(name);
  // ة is folded to ه by normalise, so the construct t is put in before.
  const construct = arabicKeyOf(name.trim().replace(/ة(?=[\s\-–]+\S)/g, "ت"));
  return [...new Set([plain, construct, plain.replace(/j/g, "k"), construct.replace(/j/g, "k")])];
}

function latinKeyOf(name: string, sh: "S" | "s"): string {
  const joined = normalise(name)
    .split(" ")
    .filter((w) => w && !ARTICLES.has(w))
    .map((w) => SHORT[w] ?? w)
    .join("");
  return squeeze(
    joined
      .replace(/[23]/g, "")
      .replace(/7/g, "h")
      .replace(/9/g, "q")
      .replace(/5/g, "kh")
      .replace(/kh/g, "x")
      .replace(/sh/g, sh)
      .replace(/ch/g, "S")
      .replace(/[gr]h/g, "r")
      .replace(/th/g, "t")
      .replace(/dh/g, "d")
      .replace(/ph/g, "f")
      .replace(/c(?=[eiy])/g, "s")
      .replace(/[cqg]/g, "k")
      .replace(/h/g, "")
      .replace(/[aeiouyw0-9]/g, ""),
  );
}

/** Every key a Latin name or query can be read to. */
export function latinKeys(name: string): string[] {
  return [...new Set([latinKeyOf(name, "S"), latinKeyOf(name, "s")])];
}

const withoutL = (key: string) => key.replace(/l/g, "");

/** Whether 2 sets of keys meet: the same key, or the same once every l is out of both. */
export function keysMeet(a: readonly string[], b: readonly string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y || withoutL(x) === withoutL(y)) return true;
    }
  }
  return false;
}

/** The key a name is filed under for lookup: its first, with every l out. */
export const lookupKey = (key: string) => withoutL(key);
