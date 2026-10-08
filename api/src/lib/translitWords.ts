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
   * The vowel sources put between 2 consonants Arabic writes side by side, or "" where they
   * mostly put none, learned by learnGaps (spell.ts): e for مد at the end of a word (مد#), so
   * حمد is Hmed, and for بل at the start before a consonant (^بلC), so بلقاضي is Belkadi.
   * Any 2 letters there take a (^__C), so زقليت, whose زق sources wrote too seldom to learn,
   * is Zaklit.
   */
  gaps?: Record<string, string>;
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

const MARK = /['’‘`ʿ]/;
const SPELT_VOWEL = /[aeiouàâäéèêëîïôöûü]/i;
const BETWEEN_WORDS = /[\s\-–]/;

/**
 * A source's Latin without the mark GeoNames writes for ع, as French spellings have it:
 * ’Ali is Ali and Ya’qoub Yaqoub. HCP never starts a word with an apostrophe, so one there goes
 * too. Kept are a typed apostrophe after a letter, as HCP writes M'hamed and A'yat, the n’ that
 * joins 2 Tamazight words, and a mark after a consonant where the Arabic has no ع to stand for.
 */
export function withoutAyn(latin: string, arabic: string): string {
  const ayn = arabic.includes("ع");
  let out = "";
  for (let i = 0; i < latin.length; i++) {
    const c = latin[i]!;
    const before = out.at(-1) ?? "";
    const start = before === "" || BETWEEN_WORDS.test(before);
    const particle = /^[nd]$/i.test(before) && (out.length === 1 || BETWEEN_WORDS.test(out.at(-2)!));
    const drop = MARK.test(c) && (start || (c !== "'" && (SPELT_VOWEL.test(before) || (ayn && !particle))));
    if (!drop) {
      out += c;
      continue;
    }
    // Al’Askar is one word once the mark goes, so its second capital does too.
    const next = latin[i + 1] ?? "";
    if (!start && /\p{Lu}/u.test(next)) {
      out += next.toLowerCase();
      i++;
    }
  }
  return out;
}

/**
 * Pairs of names as pairs of words: only where the words line up and each word's keys meet
 * its partner's, so a translated name (Banlieue Nord for أحواز ... الشمالية) gives none.
 * The Latin is withoutAyn, so ’Ali and Ali count as one spelling.
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
      if (keysMeet(arabicKeys(word), latinKeys(f[i]!))) out.push([word, withoutAyn(f[i]!, word)]);
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
  return { toLatin: best(toLatin), toArabic: best(toArabic) };
}
