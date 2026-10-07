/**
 * The word table the spellings start from: each Arabic word in a name HCP writes in both
 * scripts, or the عبد name it writes as one Latin word, with the Latin HCP writes it as, and the other way. Built by
 * api/scripts/translit.ts from the dataset's pairs, so a name like سيدي or Oulad comes out
 * as HCP writes it, and only a word the table lacks is spelt by rule.
 */
import { normalise } from "./normalise.ts";
import { arabicKeys, keysMeet, latinKeys } from "./translit.ts";

export interface WordTable {
  /** A normalised Arabic word, and the Latin HCP writes most often for it. */
  toLatin: Record<string, string>;
  /** A normalised Latin word, and the Arabic HCP writes most often for it. */
  toArabic: Record<string, string>;
  /**
   * The vowel sources put between the 2 consonants a word starts with, by those 2 letters:
   * "e" for بل, so بلقاضي is Belkadi, "" for مر, so مرزوك is Mrzouk. Only pairs seen often
   * enough to tell, and only where one way wins.
   */
  openings?: Record<string, string>;
}

/** Letters that are a vowel or carry one, as the rules read them. */
const VOWEL_LETTERS = new Set([..."اأإآويىةعؤئ"]);
/** Arabic letters French writes with 2 letters. */
const DIGRAPHS = new Set([..."شخغ"]);
/** A pair is learned from this many words, and when one way takes at least this share. */
const OPENING_SEEN = 8;
const OPENING_SHARE = 0.5;

/** The 2 consonants an Arabic word starts with, its article and a ت aside, or null. */
export function openingOf(word: string): string | null {
  const w = normalise(word).replace(/ /g, "").replace(/^ال(?=..)/, "");
  if (w.length < 4 || w[0] === "ت" || VOWEL_LETTERS.has(w[0]!) || VOWEL_LETTERS.has(w[1]!)) return null;
  return w.slice(0, 2);
}

function learnOpenings(words: readonly [string, string][]): Record<string, string> {
  const seen = new Map<string, Map<string, number>>();
  for (const [arabic, latin] of words) {
    const key = openingOf(arabic);
    if (!key) continue;
    const l = normalise(latin).replace(/ /g, "").replace(/^(el|al|l)(?=..)/, "");
    const after = l.slice(DIGRAPHS.has(key[0]!) ? 2 : 1);
    const vowel = /^[aeiou]/.test(after) && !/^(ou|w)/.test(after) ? after[0]! : "";
    const counts = seen.get(key) ?? new Map<string, number>();
    counts.set(vowel, (counts.get(vowel) ?? 0) + 1);
    seen.set(key, counts);
  }
  const out: Record<string, string> = {};
  for (const [key, counts] of [...seen].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const [vowel, n] = [...counts].reduce((top, entry) => (entry[1] > top[1] ? entry : top));
    if (total >= OPENING_SEEN && n / total >= OPENING_SHARE) out[key] = vowel;
  }
  return out;
}

const ARTICLE = /^(el|al|l|ed|er|es|ez|et|en|ech|ad|ar|as|az|at|an)$/i;

/** A Latin name's words, a free-standing article kept with the word after it, as Arabic writes it. */
export function latinWords(name: string): string[] {
  const raw = name.split(/[\s\-–]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (ARTICLE.test(raw[i]!) && i + 1 < raw.length) {
      out.push(`${raw[i]} ${raw[i + 1]}`);
      i++;
    } else out.push(raw[i]!);
  }
  return out;
}

export const arabicWords = (name: string) => name.split(/[\s\-–]+/).filter(Boolean);

/**
 * A name's Arabic words lined up with its Latin ones: as they are where both have as many,
 * and with عبد and the word after it taken as one where the Latin has one fewer and the keys
 * meet, since HCP writes عبد القادر as Abdelkader. No other 2 words are: what lines up as a
 * join elsewhere is mostly a word the source left out, as حي, which has no letter the keys
 * keep, makes Hay Safi written Safi look like one word. Null where the words don't line up.
 */
function lineUp(arabic: string[], latin: string[]): string[] | null {
  if (arabic.length === latin.length) return arabic;
  if (arabic.length !== latin.length + 1) return null;
  const ways = arabic
    .slice(0, -1)
    .flatMap((word, j) => (normalise(word) === "عبد" ? [[...arabic.slice(0, j), `${word} ${arabic[j + 1]}`, ...arabic.slice(j + 2)]] : []))
    .filter((words) => words.every((w, i) => keysMeet(arabicKeys(w), latinKeys(latin[i]!))));
  return ways.length === 1 ? ways[0]! : null;
}

/**
 * Pairs of names as pairs of words: only where the words line up and each word's keys meet
 * its partner's, so a translated name (Banlieue Nord for أحواز ... الشمالية) gives none.
 */
export function wordPairs(pairs: readonly { fr: string; ar: string }[]): [arabic: string, latin: string][] {
  const out: [string, string][] = [];
  for (const { fr, ar } of pairs) {
    const f = latinWords(fr);
    const a = lineUp(arabicWords(ar), f);
    if (!a) continue;
    a.forEach((word, i) => {
      // A number is written the same in both scripts, so it teaches nothing, and lined up
      // against a word it teaches something wrong: 1 had become Hay.
      if (/\d/.test(word) || /\d/.test(f[i]!)) return;
      if (keysMeet(arabicKeys(word), latinKeys(f[i]!))) out.push([word, f[i]!]);
    });
  }
  return out;
}

/** The table from pairs of names: each word, as wordPairs reads them, with its most frequent partner. */
export function buildWordTable(pairs: readonly { fr: string; ar: string }[]): WordTable {
  const toLatin = new Map<string, Map<string, number>>();
  const toArabic = new Map<string, Map<string, number>>();
  const add = (table: Map<string, Map<string, number>>, key: string, value: string) => {
    const counts = table.get(key) ?? new Map<string, number>();
    counts.set(value, (counts.get(value) ?? 0) + 1);
    table.set(key, counts);
  };
  for (const [word, latin] of wordPairs(pairs)) {
    add(toLatin, normalise(word), latin);
    add(toArabic, normalise(latin), word);
  }
  // The most frequent partner, and the first seen among equals, so a rebuild is stable.
  const best = (table: Map<string, Map<string, number>>) =>
    Object.fromEntries(
      [...table]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, counts]) => [key, [...counts].reduce((top, entry) => (entry[1] > top[1] ? entry : top))[0]]),
    );
  return { toLatin: best(toLatin), toArabic: best(toArabic), openings: learnOpenings(wordPairs(pairs)) };
}
