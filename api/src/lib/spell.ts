/**
 * A Moroccan name spelt in the other script, the way HCP's French and Arabic names are:
 * Latin for a douar named only in Arabic, Arabic for a neighbourhood named only in Latin.
 * Plain rules on top of the word table, no model.
 *
 * Each word the table knows comes out as HCP writes it. Any other is spelt by the model
 * (graphones.ts) where there is one, and letter by letter by rule where there isn't, and
 * either is a guess: Arabic leaves out short vowels, which Latin has to put in, and the rules
 * put in only the ones sources mostly agree on (learnGaps); and Latin can't tell س from ص
 * or ت from ط. `pnpm translit --eval` gives how often each way comes
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

/** One letter of an Arabic word in Latin, by the letters either side of it. */
function latinLetter(letters: readonly string[], i: number, construct: boolean): string {
  const ch = letters[i]!;
  const prev = letters[i - 1];
  const next = letters[i + 1];
  if (ch === "ا" || ch === "أ" || ch === "آ") return "a";
  if (ch === "إ") return "i";
  if (ch === "ع") return next === "ا" ? "a" : i === 0 || (prev && !VOWELS.has(prev)) ? "a" : "";
  if (ch === "و" || ch === "ؤ") return "ou";
  if (ch === "ى") return "a";
  // ي is a y at the start, after a vowel or before ا, and an i otherwise, as before the
  // final ة of Zaouia, though it follows the و.
  // and a final ين is -ine for 8 words in 10, after a vowel too: Talouine.
  if (ch === "ي" || ch === "ئ") {
    const finalIn = next === "ن" && i === letters.length - 2;
    return next === "ة" || finalIn ? "i" : i === 0 || (prev && VOWELS.has(prev)) || next === "ا" ? "y" : "i";
  }
  if (ch === "ة") return construct ? "at" : "a";
  let letter = LATIN[ch] ?? "";
  // French doubles an s between vowels to keep it an s: Assilah, Essaouira.
  if ((ch === "س" || ch === "ص") && prev && VOWELS.has(prev) && next && VOWELS.has(next)) letter = "ss";
  // and writes a hard g as gu before an i: Guercif.
  if (letter === "g" && (next === "ي" || next === "ى")) letter = "gu";
  return letter;
}

/** A word's article in Latin, and the rest of it letter by letter, each as the rules spell it. */
function lettersOf(word: string, construct: boolean): { article: string; letters: string[]; spelt: string[] } {
  let w = word;
  let article = "";
  if (w.startsWith("ال") && w.length > 3) {
    const first = w[2]!;
    w = w.slice(2);
    article = SUN.has(first) ? `e${(LATIN[first] ?? "").charAt(0)}` : "el ";
  }
  const letters = [...w];
  return { article, letters, spelt: letters.map((_, i) => latinLetter(letters, i, construct)) };
}

/**
 * The keys of the gap after letter i, where it and the next are consonants the rules spell
 * side by side, the closer first: the 2 letters, with ^ before them at the start of a word,
 * and C, V or # after them for the consonant, vowel or end of the word that follows; then
 * the 2 letters alone. Null for any other gap, and for the start of a word of under 4
 * letters, or one starting with ت, which the Ta- rule spells.
 */
function gapKeys(letters: readonly string[], spelt: readonly string[], i: number): string[] | null {
  const consonant = (j: number) => !!spelt[j] && !VOWELS.has(letters[j]!) && letters[j] !== "ع";
  if (!consonant(i) || !consonant(i + 1)) return null;
  if (i === 0 && (letters[0] === "ت" || letters.length < 4)) return null;
  const after = i + 2 === letters.length ? "#" : consonant(i + 2) ? "C" : "V";
  const pair = `${i === 0 ? "^" : ""}${normalise(letters[i]!)}${normalise(letters[i + 1]!)}`;
  return [pair + after, pair];
}

/** One Arabic word, letter by letter. `construct` is a ta marbuta said as t, before another word. */
function latinWord(word: string, construct: boolean, gaps: Record<string, string> = {}): string {
  const { article, letters, spelt } = lettersOf(word, construct);
  // The vowel sources put between 2 consonants, where gaps has one for them: Issafen, not Issafn.
  let out = spelt
    .map((s, i) => {
      const key = gapKeys(letters, spelt, i)?.find((k) => gaps[k] !== undefined);
      return key ? s + gaps[key] : s;
    })
    .join("");
  out = out.replace(/a{3,}/g, "aa");
  // A Tamazight name starting with t and a consonant starts Ta- in Latin: Tagmout, Tamezguida.
  // Sources write it so for 6 words in 10, and 8 in 10 with a final t as well.
  const w = letters.join("");
  if (/^ت[^اأإآويىةعؤئ]/.test(w) && w.length > 2 && out.startsWith("t") && !/^t[aeiou]/.test(out)) out = `ta${out.slice(1)}`;
  // A long a, i or ou before a final n takes a silent e: Taliouine, Naamane. Before a final t
  // sources mostly leave it off: Tagmout rather than Tagmoute.
  if (/(a|i|ou)n$/.test(out) && /[اوي]ن$/.test(w)) out += "e";
  return capital(article + out);
}

/** A gap is learned from this many words, and where one way of writing it has this share. */
const GAP_SEEN = 4;
const GAP_SHARE = 0.4;

/** For each place in a, the letters an alignment with b puts there: what b adds to a. */
function added(a: string, b: string): string[] {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const out = Array.from({ length: a.length + 1 }, () => "");
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      i--;
      j--;
    } else if (j > 0 && d[i]![j] === d[i]![j - 1]! + 1) {
      out[i] = b[j - 1] + out[i]!;
      j--;
    } else i--;
  }
  return out;
}

/**
 * The vowel sources put in each gap between 2 consonants, from pairs of words: each Arabic
 * word spelt by rule and lined up with the Latin a source writes for it, and the vowel the
 * source has between 2 consonants the rules leave side by side counted under that gap's keys.
 * None is learned too, where sources mostly put none, so that a gap's closer key keeps out
 * what its 2 letters take elsewhere: مرزوك is Marzouk, but مريزيك, with a vowel after مر,
 * is Mrizik.
 */
export function learnGaps(words: readonly [arabic: string, latin: string][]): Record<string, string> {
  const seen = new Map<string, Map<string, number>>();
  for (const [arabic, latin] of words) {
    if (arabic.includes(" ")) continue;
    const { article, letters, spelt } = lettersOf(arabic, false);
    const plain = (s: string) => modelLatin(s).replace(/ /g, "");
    const extra = added(plain(article) + spelt.join(""), plain(latin));
    let at = plain(article).length;
    spelt.forEach((s, i) => {
      at += s.length;
      const vowel = extra[at]!.replace(/[^aeiou]/g, "");
      for (const key of gapKeys(letters, spelt, i) ?? []) {
        const counts = seen.get(key) ?? new Map<string, number>();
        counts.set(vowel, (counts.get(vowel) ?? 0) + 1);
        seen.set(key, counts);
      }
    });
  }
  const out: Record<string, string> = {};
  for (const [key, counts] of [...seen].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const [vowel, n] = [...counts].reduce((top, entry) => (entry[1] > top[1] ? entry : top));
    if (total >= GAP_SEEN && n / total >= GAP_SHARE) out[key] = vowel;
  }
  return out;
}

/** An Arabic name in Latin: HCP's spelling of each word the table knows, the model's or the rules' for the rest. */
/**
 * Words a name holds as an ordinary noun rather than a name, which French translates rather
 * than spells: المركز, a village's centre, is the Centre HCP writes in French, so تمروت
 * المركز is Tamrout Centre and not Tamrout El Markz.
 *
 * A douar can be named for what it is, a housing estate, a cooperative, a farm or a fishing
 * village, and French names those as OpenStreetMap's names in both scripts do: Lotissement,
 * Coopérative, Ferme. Spelt, they read as names they aren't: قرية الصيد, a fishing village,
 * came out as Karia Saïd. ثكنة, barracks, is only translated with its article, since HCP
 * writes the commune Tekna as ثكنة.
 */
const TRANSLATED: Record<string, string> = Object.fromEntries(
  Object.entries({
    "المركز": "Centre", "مركز": "Centre", "سابقا": "ex", "كلم": "Km", "دوار": "Douar",
    "قرية الصيد": "Village de pêche", "معبر الحدود": "Poste frontière", "محطة القطار": "Gare",
    "تعاونية": "Coopérative", "التعاونية": "Coopérative", "تعاونيات": "Coopératives", "التعاونية الفلاحية": "Coopérative agricole",
    "ضيعة": "Ferme", "الضيعة": "Ferme", "الضيعة الفلاحية": "Ferme",
    "تجزئة": "Lotissement", "إقامة": "Résidence", "ميناء": "Port", "الميناء": "Port",
    "الثكنة": "Caserne", "الثكنة العسكرية": "Caserne",
  }).map(([arabic, french]) => [normalise(arabic), french]),
);

/**
 * A name's words, with 2 that are translated together or that the table has as one Latin
 * word taken as one: قرية الصيد is a fishing village, while الصيد on its own, in أولاد بن
 * الصيد, is a name and spelt; and عبد القادر is Abdelkader, as HCP writes it.
 */
function phrases(words: readonly string[], table: WordTable): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const two = `${words[i]} ${words[i + 1]}`;
    // A mark such as / normalises to nothing, so the 2 have to be 2 words still.
    const key = normalise(two);
    if (i < words.length - 1 && key.includes(" ") && (TRANSLATED[key] || table.toLatin[key])) {
      out.push(two);
      i++;
    } else out.push(words[i]!);
  }
  return out;
}

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
  const words = phrases(arabicWords(name), table);
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
      return latinWord(word, construct, table.gaps);
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
