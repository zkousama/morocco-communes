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
import { arabicWords, latinWords, openingOf, type WordTable } from "./translitWords.ts";

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
function latinWord(word: string, construct: boolean, openings: Record<string, string> = {}): string {
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
    // and a final ين is -ine for 8 words in 10, after a vowel too: Talouine.
    else if (ch === "ي" || ch === "ئ") {
      const finalIn = next === "ن" && i === letters.length - 2;
      out += next === "ة" || finalIn ? "i" : i === 0 || (prev && VOWELS.has(prev)) || next === "ا" ? "y" : "i";
    }
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
  // A Tamazight name starting with t and a consonant starts Ta- in Latin: Tagmout, Tamezguida.
  // Sources write it so for 6 words in 10, and 8 in 10 with a final t as well.
  if (/^ت[^اأإآويىةعؤئ]/.test(w) && w.length > 2 && out.startsWith("t") && !/^t[aeiou]/.test(out)) out = `ta${out.slice(1)}`;
  // The vowel sources put between the 2 consonants a word starts with, where they agree on one.
  const opening = openingOf(w);
  const vowel = opening ? openings[opening] : undefined;
  if (vowel) {
    const first = (LATIN[opening![0]!] ?? "").length;
    if (first > 0 && !/^[aeiou]/.test(out.slice(first))) out = out.slice(0, first) + vowel + out.slice(first);
  }
  // A long a, i or ou before a final n takes a silent e: Taliouine, Naamane. Before a final t
  // sources mostly leave it off: Tagmout rather than Tagmoute.
  if (/(a|i|ou)n$/.test(out) && /[اوي]ن$/.test(w)) out += "e";
  return capital(article + out);
}

/** An Arabic name in Latin: HCP's spelling of each word the table knows, the model's or the rules' for the rest. */
/**
 * Words a name holds as an ordinary noun rather than a name, which French translates rather
 * than spells: المركز, a village's centre, is the Centre HCP writes in French, so تمروت
 * المركز is Tamrout Centre and not Tamrout El Markz.
 */
const TRANSLATED: Record<string, string> = { "المركز": "Centre", "مركز": "Centre", "سابقا": "ex", "كلم": "Km", "دوار": "Douar" };

/** "Formerly", which an Arabic name puts after the old name and Latin puts before it, as ex. */
const FORMERLY = /(?:^|\s)سابقاً?(?=\s|$)/;

/** Arabic-Indic digits as the digits Latin writes. */
const westernDigits = (word: string) => word.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * An Arabic name in Latin letters. A name can hold another in brackets, the place it's part
 * of or what it used to be called: each part is spelt on its own and the brackets kept, so
 * ارمزاد (لمرج) is Armzad (Lmerj), and an old name reads (ex Adar Ougadir).
 */
export function toLatin(name: string, table: WordTable, models?: Models): string {
  const bracket = name.match(/^(.*?)\s*\(([^()]*)\)\s*(.*)$/);
  if (bracket) {
    const [, before, inside, after] = bracket as unknown as [string, string, string, string];
    const old = FORMERLY.test(inside);
    const inner = toLatin(inside.replace(FORMERLY, " ").trim(), table, models);
    const parts = [before.trim() && toLatin(before, table, models), inner && `(${old ? "ex " : ""}${inner})`, after.trim() && toLatin(after, table, models)];
    return parts.filter(Boolean).join(" ");
  }
  return spellWords(name.replace(/[()]/g, " "), table, models);
}

function spellWords(name: string, table: WordTable, models?: Models): string {
  const words = arabicWords(name);
  return words
    .map((word, i) => {
      // A number stays a number: أولاد كثير 1 is Oulad Ktir 1.
      if (/^[0-9٠-٩]+$/.test(word)) return westernDigits(word);
      const translated = TRANSLATED[normalise(word)];
      if (translated) return translated;
      // Sources write some words in lower case (mloulne, el Berd); a name's words start with a capital,
      // all but the n' that joins 2 Tamazight words.
      const known = table.toLatin[normalise(word)]?.replace(/’/g, "'");
      if (known) return /^[nd]'/.test(known) ? known : capital(known);
      const guess = models && spell(models.toLatin, modelArabic(word))[0]?.text;
      if (guess) return capital(guess);
      // A ta marbuta before a word without the article is said as t: Zaouiat Sidi, not Zaouia Sidi.
      const construct = word.endsWith("ة") && i < words.length - 1 && !words[i + 1]!.startsWith("ال");
      return latinWord(word, construct, table.openings);
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
      if (/^\d+$/.test(word)) return word;
      const known = table.toArabic[normalise(word)];
      if (known) return known;
      const guess = models && spell(models.toArabic, modelLatin(word))[0]?.text;
      return guess || arabicWord(word);
    })
    .join(" ");
}
