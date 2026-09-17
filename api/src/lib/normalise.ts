/**
 * Folds a name or a query to the form the index is keyed on.
 *
 * NFD decomposition plus dropping combining marks does most of the work in one step: it
 * folds the Arabic alef variants (أ إ آ → ا), waw and ya hamza (ؤ ئ → و ي), every
 * haraka, and the French accents (â è é → a e e). What it cannot reach are the four
 * characters that carry no decomposition, mapped explicitly below.
 *
 * Two of those four — tatweel and the harakat — appear in **no** commune name. They are
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
