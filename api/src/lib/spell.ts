/**
 * A Moroccan name spelt in the other script, the way HCP's French and Arabic names are:
 * Latin for a douar named only in Arabic, Arabic for a neighbourhood named only in Latin.
 * Plain rules on top of the word table, no model.
 *
 * Each word the table knows comes out as HCP writes it. Any other is spelt by the model
 * (graphones.ts) where there is one, and letter by letter by rule where there isn't, and
 * either is a guess: Arabic leaves out short vowels, which Latin has to put in, and Latin
 * can't tell س from ص or ت from ط. `pnpm translit --eval` gives how often each way comes
 * out exactly as HCP writes a name it was kept from learning.
 */
import { normalise } from "./normalise.ts";
import { spell, type Model } from "./graphones.ts";
import { arabicWords, latinWords, type WordTable } from "./translitWords.ts";

/** The 2 models, one for each direction, trained by `pnpm translit --model`. */
export interface Models {
  toLatin: Model;
  toArabic: Model;
}

/** What the models read and write: Arabic without vowel marks, and Latin lowercased without accents. */
export const modelArabic = (word: string) => word.normalize("NFC").replace(/[\u064B-\u0652\u0670ـ]/g, "");
export const modelLatin = (word: string) => word.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[^a-z ]/g, "");

const LATIN: Record<string, string> = {
  "ب": "b", "پ": "p", "ت": "t", "ث": "t", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "d", "ر": "r",
  "ز": "z", "س": "s", "ش": "ch", "ص": "s", "ض": "d", "ط": "t", "ظ": "d", "غ": "gh", "ف": "f", "ڤ": "v",
  "ق": "k", "ك": "k", "ݣ": "g", "ڭ": "g", "گ": "g", "ک": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ء": "",
};
/** The letters the article melts into: الصفا is Essafa, not El Safa. */
const SUN = new Set([..."تثدذرزسشصضطظلن"]);
/** Letters that are vowels or carry one, after which ي is a y. */
const VOWELS = new Set(["ا", "أ", "إ", "آ", "و", "ي", "ى", "ة", "ؤ", "ئ"]);

const capital = (word: string) => word.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** One Arabic word, letter by letter. `construct` is a ta marbuta said as t, before another word. */
function latinWord(word: string, construct: boolean): string {
  let w = word;
  let article = "";
  if (w.startsWith("ال") && w.length > 3) {
    const first = w[2]!;
    w = w.slice(2);
    article = SUN.has(first) ? `e${(LATIN[first] ?? "").charAt(0)}` : "el ";
  }
  const letters = [...w];
  let out = "";
  letters.forEach((ch, i) => {
    const prev = letters[i - 1];
    const next = letters[i + 1];
    if (ch === "ا" || ch === "أ" || ch === "آ") out += "a";
    else if (ch === "إ") out += "i";
    else if (ch === "ع") out += next === "ا" ? "a" : i === 0 || (prev && !VOWELS.has(prev)) ? "a" : "";
    else if (ch === "و" || ch === "ؤ") out += "ou";
    else if (ch === "ى") out += "a";
    // ي is a y at the start, after a vowel or before ا, and an i otherwise, as before the
    // final ة of Zaouia, though it follows the و.
    else if (ch === "ي" || ch === "ئ") out += next === "ة" ? "i" : i === 0 || (prev && VOWELS.has(prev)) || next === "ا" ? "y" : "i";
    else if (ch === "ة") out += construct ? "at" : "a";
    else {
      let letter = LATIN[ch] ?? "";
      // French doubles an s between vowels to keep it an s: Assilah, Essaouira.
      if ((ch === "س" || ch === "ص") && prev && VOWELS.has(prev) && next && VOWELS.has(next)) letter = "ss";
      // and writes a hard g as gu before an i: Guercif.
      if (letter === "g" && (next === "ي" || next === "ى")) letter = "gu";
      out += letter;
    }
  });
  out = out.replace(/a{3,}/g, "aa");
  // A long a, i or ou before a final n or t takes a silent e: Naamane, Chaibate.
  if (/(a|i|ou)[nt]$/.test(out) && /[اوي][نت]$/.test(w)) out += "e";
  return capital(article + out);
}

/** An Arabic name in Latin: HCP's spelling of each word the table knows, the model's or the rules' for the rest. */
export function toLatin(name: string, table: WordTable, models?: Models): string {
  const words = arabicWords(name);
  return words
    .map((word, i) => {
      const known = table.toLatin[normalise(word)];
      if (known) return known;
      const guess = models && spell(models.toLatin, modelArabic(word))[0]?.text;
      if (guess) return capital(guess);
      // A ta marbuta before a word without the article is said as t: Zaouiat Sidi, not Zaouia Sidi.
      const construct = word.endsWith("ة") && i < words.length - 1 && !words[i + 1]!.startsWith("ال");
      return latinWord(word, construct);
    })
    .join(" ");
}

const ARABIC: Record<string, string> = {
  b: "ب", t: "ت", d: "د", j: "ج", h: "ح", r: "ر", z: "ز", s: "س", c: "ك", f: "ف", k: "ك", q: "ق", g: "ك",
  l: "ل", m: "م", n: "ن", w: "و", y: "ي", p: "ب", v: "ف", x: "كس", a: "ا", i: "ي", o: "و", u: "و", e: "",
};

/** One Latin word, letter by letter, an article written apart taken back on. */
function arabicWord(word: string): string {
  let w = normalise(word).replace(/ /g, "");
  let article = "";
  if (word.includes(" ")) {
    article = "ال";
    w = normalise(word.split(" ")[1]!).replace(/ /g, "");
  }
  const spelt = w
    .replace(/e$/, "")
    .replace(/ch|sh/g, "ش")
    .replace(/kh/g, "خ")
    .replace(/gh|rh(?=[aeiou])/g, "غ")
    .replace(/th/g, "ت")
    .replace(/dh/g, "ض")
    .replace(/ou/g, "و")
    .replace(/([bcdfghjklmnpqrstvxz])\1/g, "$1")
    .replace(/^a/, "ا")
    .replace(/^[ei]/, "إ")
    .replace(/^o/, "أو")
    .replace(/a$/, "ة")
    .replace(/aa/g, "اع");
  return article + [...spelt].map((ch) => ARABIC[ch] ?? ch).join("");
}

/** A Latin name in Arabic: HCP's spelling of each word the table knows, the model's or the rules' for the rest. */
export function toArabic(name: string, table: WordTable, models?: Models): string {
  return latinWords(name)
    .map((word) => {
      const known = table.toArabic[normalise(word)];
      if (known) return known;
      const guess = models && spell(models.toArabic, modelLatin(word))[0]?.text;
      return guess || arabicWord(word);
    })
    .join(" ");
}
