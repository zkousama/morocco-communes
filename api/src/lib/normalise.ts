/**
 * Folds a name or a query to the form the index is keyed on.
 *
 * NFD decomposition plus dropping combining marks does most of the work in one step: it
 * folds the Arabic alef variants (أ إ آ → ا), waw and ya hamza (ؤ ئ → و ي), every
 * haraka, and the French accents (â è é → a e e). What it cannot reach are the four
 * characters that carry no decomposition, mapped explicitly below.
 *
 * Two of those four, tatweel and the harakat, appear in **no** commune name. They are
 * folded because of what people type, not because of what the data holds, so a reader
 * measuring the rules against the corpus will find them dead and should leave them
 * alone: dropping them would make a query written with vowel marks fail to match a name
 * written without them.
 */
const EXPLICIT: Record<string, string> = {
  "ة": "ه", // ta marbuta ة → ه, 367 names
  "ى": "ي", // alef maqsura ى → ي, 42 names
  "ء": "", // standalone hamza ء, 28 names carry a hamza form
  "ـ": "", // tatweel ـ, absent from the data, typed by people
};

/** Apostrophes and dashes separate words in the French names; en-dash appears too. */
const SEPARATORS = /[’'`‘\-–—_/.,()]+/g;

export function normalise(input: string): string {
  let s = input.normalize("NFD").replace(/\p{Mn}/gu, "");
  s = s.replace(/[ةىءـ]/g, (c) => EXPLICIT[c] ?? c);
  s = s.toLowerCase().replace(SEPARATORS, " ");
  // Anything left that is neither a letter nor a digit nor a space cannot be typed
  // usefully into a name search.
  s = s.replace(/[^\p{L}\p{N} ]+/gu, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Articles written as a word of their own: El Jadida, Es-Semara, Al Hoceima. */
const ARTICLES = new Set(["el", "al", "l", "ed", "er", "es", "ez", "et", "en", "ech", "ad", "ar", "as", "az", "at", "an"]);

/**
 * A Latin name reduced to its consonants, the part that survives transliteration. The
 * same Moroccan name gets written with different vowels, with ou or w, with single or
 * doubled letters and with or without its article: Tétouan and Titwan, Essaouira and
 * Souira, El Jadida and Jdida, Ketama and Ktama. Their trigrams barely overlap, so a
 * short name typed another way finds nothing. Their skeletons are the same: twn, swr, jd,
 * ktm.
 *
 * The digits of Arabizi are read as the letters they stand for, 7 as h and 9 as q, and 3
 * and 2, a sound French spelling has no letter for, as nothing. An Arabic-script name has
 * no skeleton; its normalised form already drops the short vowels.
 */
export function skeleton(normalised: string): string {
  if (/[^a-z0-9 ]/.test(normalised)) return "";
  const words = normalised
    .replace(/[23]/g, "")
    .replace(/7/g, "h")
    .replace(/9/g, "q")
    .replace(/5/g, "kh")
    .split(" ")
    .filter((w) => !ARTICLES.has(w));
  return words
    .join("")
    .replace(/ou/g, "w")
    .replace(/kh/g, "x")
    .replace(/[cs]h/g, "S")
    .replace(/gh/g, "G")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/ph/g, "f")
    .replace(/[qc]/g, "k")
    .replace(/[aeiou0-9]/g, "")
    .replace(/(.)\1+/g, "$1");
}

export const GRAM = 3;

/**
 * Trigrams over the normalised string, spaces included, so a word boundary is itself a
 * feature: "al majjatia" and "almajjatia" share their stems but not their boundaries,
 * which is what lets overlap scoring rank them together without treating them as equal.
 * A string shorter than the gram size yields itself, so a two-letter name is findable.
 */
export function trigrams(normalised: string): string[] {
  if (normalised.length === 0) return [];
  if (normalised.length <= GRAM) return [normalised];
  const out: string[] = [];
  for (let i = 0; i + GRAM <= normalised.length; i++) out.push(normalised.slice(i, i + GRAM));
  return out;
}
