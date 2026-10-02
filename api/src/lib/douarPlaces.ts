/**
 * HCP's douars matched to the places GeoNames and OpenStreetMap map in the same commune,
 * so a douar named only in Arabic gets a Latin name someone wrote down and a point on the
 * map. HCP gives a douar no location and no Latin name; these places give both, and no
 * HCP code.
 *
 * A place and a douar are taken to be one when their names agree: the same Arabic once
 * normalised, or Latin and Arabic whose keys meet (translit.ts). A key of 2 consonants
 * meets too many names by chance, so a Latin match needs 3, and is scored by how close
 * the place's Latin is to the douar's spelling by rule. Each douar keeps its best place
 * and each place its best douar, and only a pair that are each other's best is kept, so
 * no place names 2 douars. How many of the pairs are chance is measured by matching every
 * commune's places to another commune's douars (`decoys`).
 *
 * A second pass takes the douars whose name was too short to trust alone (2 consonants) or
 * too far from its spelling by rule, and accepts a place for one only near the douars of its
 * fraction the first pass placed: a fraction is a cluster on the ground, its matched douars
 * 1.7 km from each other at the median and under 4.6 km 9 times in 10. There the place has
 * to be within NEAR_KM of one and spelt NEAR_CLOSE alike. Its chance is measured by giving
 * each douar another douar's name and seeing what still matches nearby.
 */
import { normalise } from "./normalise.ts";
import { arabicKeys, keysMeet, latinKeys } from "./translit.ts";

export type PlaceSource = "osm" | "geonames";

export interface Place {
  source: PlaceSource;
  id: string;
  lat: number;
  lng: number;
  /** Its Latin names, the one to show first. */
  latin: string[];
  arabic: string[];
}

export interface Douar {
  code: string;
  name: { ar: string };
  /** Its spelling in Latin by rule, which a place's Latin is scored against. */
  spelt: string;
}

export interface Match {
  douar: string;
  place: Place;
  /** The Latin name to show: the place's first whose keys meet the douar's. */
  name: string;
  /** 2 for the same Arabic, 1 and up for Latin, by closeness to the spelling by rule. */
  score: number;
}

/**
 * The most of a pass's matches that may be chance: the share it still finds once each douar's
 * commune is swapped for another. A pass over it writes nothing, here and in douarNames.ts.
 */
export const MAX_CHANCE = 0.05;

/** A Latin match needs keys of at least this many consonants, the l's aside. */
export const MIN_KEY = 3;
/**
 * And a Latin spelling at least this close to the douar's by rule, the article aside. From
 * `pnpm api:douar-places --sweep` on 2026-10-02: the bar used to be 0.5 for a key under 4
 * and none above, which let Tatrarat through as تاوريرت, both T·R·T. At 0.6 for every key,
 * 153 of 12,462 matches went and the share that’s chance fell from 2.8% to 1.7%; past 0.6,
 * what goes is mostly real.
 */
export const MIN_CLOSE = 0.6;

/** The second pass: a place this near a douar of the same fraction already placed, in km. */
export const NEAR_KM = 3;
/** and a spelling at least this close to the douar's by rule. */
export const NEAR_CLOSE = 0.7;

/** GeoNames writes "Douar" before many a name; HCP never does. */
export const cleanLatin = (name: string) => name.replace(/^douar\s+/i, "").trim();

const LATIN_PREFIX =
  /^(?:(?:ecole|école|e\.?\s?p\.?|groupe(?:ment)?\s+scolaire|g\.?\s?s\.?|ss|satellite|unit[ée]\s+scolaire|primaire|secteur\s+scolaire|mosqu[ée]e|masjid|mosque|bureau\s+de\s+poste|poste|dispensaire|centre\s+de\s+sant[ée]|csr?|douar|dr)\b[\s.:-]*)+/i;
const ARABIC_PREFIX =
  /^(?:(?:مجموعة\s+مدارس|مجموعة\s+مدرسية|م\.?\s?م\.?|مدرسة\s+فرعية|المدرسة|مدرسة|فرعية|الوحدة\s+المدرسية|وحدة|القطاع\s+المدرسي|قطاع\s+مدرسي|مسجد|جامع|مركز\s+صحي|المستوصف|مستوصف|دوار)\s*)+/;

/**
 * The name a feature gives its douar. A school, a mosque or a health post is named after the
 * village it serves, behind a word saying what it is: École Tagmout, مسجد دوار أيت علي.
 * That word comes off; a place's own name is kept whole.
 */
export function douarNameOf(name: string, isPlace: boolean): string {
  return isPlace ? name.trim() : name.replace(LATIN_PREFIX, "").replace(ARABIC_PREFIX, "").trim();
}

/**
 * A Latin name without the Arabic article it opens with, however it's written: El Karma,
 * Ez Zraib and Ennouasser come to karma, zraib and nouasser. Sources write it and the
 * spelling by rule often doesn't, so 2 spellings are compared without it as well.
 */
export const withoutArticle = (name: string) =>
  normalise(name)
    .replace(/^(?:al|el|l|ad|ed|ar|er|as|es|at|et|az|ez|an|en|ach|ech)[ -]+/, "")
    .replace(/^[ae]([dnrstz])\1/, "$1");

export function closeness(a: string, b: string): number {
  return Math.max(rawCloseness(a, b), rawCloseness(withoutArticle(a), withoutArticle(b)));
}

function rawCloseness(a: string, b: string): number {
  const x = normalise(a).replace(/ /g, "");
  const y = normalise(b).replace(/ /g, "");
  let row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    row = next;
  }
  return 1 - row[y.length]! / Math.max(x.length, y.length, 1);
}

/**
 * The Latin name a place matched by its Arabic gives the douar: the first of its Latin names
 * that's a spelling of the douar's, or none. A place OSM names in Arabic only still gives
 * the douar its point.
 */
function latinFor(place: Place, keys: string[]): string {
  for (const latin of place.latin) {
    const clean = cleanLatin(latin);
    if (clean && keysMeet(keys, latinKeys(clean))) return clean;
  }
  return "";
}

/** The best way a place names a douar, or null where it doesn't. */
export function score(douar: Douar, place: Place, keys = arabicKeys(douar.name.ar), minClose = MIN_CLOSE): { name: string; score: number } | null {
  const arabic = normalise(douar.name.ar);
  if (place.arabic.some((a) => normalise(a) === arabic)) return { name: latinFor(place, keys), score: 2 };
  const long = keys.filter((k) => k.replace(/l/g, "").length >= MIN_KEY);
  if (long.length === 0) return null;
  let best: { name: string; score: number } | null = null;
  for (const latin of place.latin) {
    const clean = cleanLatin(latin);
    if (!clean || !keysMeet(long, latinKeys(clean))) continue;
    const close = closeness(clean, douar.spelt);
    if (close < minClose) continue;
    if (!best || 1 + close > best.score) best = { name: clean, score: 1 + close };
  }
  return best;
}

/**
 * Each commune's douars matched to the places in it, each to its best partner where the two
 * are each other's best. `communeOf` places a point in a commune; `decoy`, when given,
 * swaps a commune for another, so a match there is chance.
 */
export function matchDouars(
  douarsIn: Map<string, Douar[]>,
  places: readonly Place[],
  communeOf: (place: Place) => string | null,
  decoy?: (commune: string) => string,
  minClose = MIN_CLOSE,
): Match[] {
  const keys = new Map<string, string[]>();
  for (const list of douarsIn.values()) for (const d of list) keys.set(d.code, arabicKeys(d.name.ar));
  const candidates: Match[] = [];
  for (const place of places) {
    const commune = communeOf(place);
    if (!commune) continue;
    for (const douar of douarsIn.get(decoy ? decoy(commune) : commune) ?? []) {
      const found = score(douar, place, keys.get(douar.code), minClose);
      if (found) candidates.push({ douar: douar.code, place, ...found });
    }
  }
  const bestFor = (key: (m: Match) => string) => {
    const best = new Map<string, Match>();
    for (const m of candidates) {
      const k = key(m);
      const held = best.get(k);
      if (!held || m.score > held.score) best.set(k, m);
    }
    return best;
  };
  const byDouar = bestFor((m) => m.douar);
  const byPlace = bestFor((m) => `${m.place.source}:${m.place.id}`);
  return [...byDouar.values()].filter((m) => byPlace.get(`${m.place.source}:${m.place.id}`) === m);
}

/** Kilometres between 2 points on the earth. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * The second pass: the douars the first left unplaced, matched to places in their commune
 * the first pass didn't use, near a douar of the same fraction it did place. `renamed`, when
 * given, gives each douar another name to try, so a match then is chance.
 */
export function matchNearFractions(
  douarsIn: Map<string, Douar[]>,
  places: readonly Place[],
  communeOf: (place: Place) => string | null,
  first: readonly Match[],
  renamed?: (douar: Douar) => Douar,
): (Match & { km: number })[] {
  const placedAt = new Map<string, Place>(first.map((m) => [m.douar, m.place]));
  const used = new Set(first.map((m) => `${m.place.source}:${m.place.id}`));
  const placedIn = new Map<string, Place[]>();
  for (const m of first) {
    const fraction = m.douar.slice(0, 10);
    placedIn.set(fraction, [...(placedIn.get(fraction) ?? []), m.place]);
  }
  const free = new Map<string, Place[]>();
  for (const place of places) {
    if (used.has(`${place.source}:${place.id}`)) continue;
    const commune = communeOf(place);
    if (commune) free.set(commune, [...(free.get(commune) ?? []), place]);
  }
  const candidates: (Match & { km: number })[] = [];
  for (const [commune, list] of douarsIn) {
    for (const original of list) {
      if (placedAt.has(original.code)) continue;
      const siblings = placedIn.get(original.code.slice(0, 10));
      if (!siblings) continue;
      const douar = renamed ? renamed(original) : original;
      const keys = arabicKeys(douar.name.ar);
      const arabic = normalise(douar.name.ar);
      for (const place of free.get(commune) ?? []) {
        const near = Math.min(...siblings.map((s) => km(s, place)));
        if (near > NEAR_KM) continue;
        let best: { name: string; score: number } | null = null;
        if (place.arabic.some((a) => normalise(a) === arabic)) best = { name: latinFor(place, keys), score: 2 };
        for (const latin of place.latin) {
          const clean = cleanLatin(latin);
          if (!clean || !keysMeet(keys, latinKeys(clean))) continue;
          const close = closeness(clean, douar.spelt);
          if (close >= NEAR_CLOSE && (!best || 1 + close > best.score)) best = { name: clean, score: 1 + close };
        }
        if (best) candidates.push({ douar: original.code, place, ...best, km: near });
      }
    }
  }
  const better = (a: Match & { km: number }, b: Match & { km: number }) => a.score > b.score || (a.score === b.score && a.km < b.km);
  const byDouar = new Map<string, Match & { km: number }>();
  const byPlace = new Map<string, Match & { km: number }>();
  for (const c of candidates) {
    const d = byDouar.get(c.douar);
    if (!d || better(c, d)) byDouar.set(c.douar, c);
    const k = `${c.place.source}:${c.place.id}`;
    const p = byPlace.get(k);
    if (!p || better(c, p)) byPlace.set(k, c);
  }
  return [...byDouar.values()].filter((c) => byPlace.get(`${c.place.source}:${c.place.id}`) === c);
}
