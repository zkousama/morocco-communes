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

/** A Latin match needs keys of at least this many consonants, the l's aside. */
export const MIN_KEY = 3;
/** And a Latin spelling at least this close to the douar's by rule, once its key is under 4. */
export const MIN_CLOSE = 0.5;

/** GeoNames writes "Douar" before many a name; HCP never does. */
export const cleanLatin = (name: string) => name.replace(/^douar\s+/i, "").trim();

function closeness(a: string, b: string): number {
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

/** The best way a place names a douar, or null where it doesn't. */
export function score(douar: Douar, place: Place, keys = arabicKeys(douar.name.ar)): { name: string; score: number } | null {
  const arabic = normalise(douar.name.ar);
  if (place.arabic.some((a) => normalise(a) === arabic)) return { name: place.latin[0] ?? "", score: 2 };
  const long = keys.filter((k) => k.replace(/l/g, "").length >= MIN_KEY);
  if (long.length === 0) return null;
  let best: { name: string; score: number } | null = null;
  for (const latin of place.latin) {
    const clean = cleanLatin(latin);
    if (!clean || !keysMeet(long, latinKeys(clean))) continue;
    const close = closeness(clean, douar.spelt);
    const longest = Math.max(...long.map((k) => k.replace(/l/g, "").length));
    if (longest < 4 && close < MIN_CLOSE) continue;
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
): Match[] {
  const keys = new Map<string, string[]>();
  for (const list of douarsIn.values()) for (const d of list) keys.set(d.code, arabicKeys(d.name.ar));
  const candidates: Match[] = [];
  for (const place of places) {
    const commune = communeOf(place);
    if (!commune) continue;
    for (const douar of douarsIn.get(decoy ? decoy(commune) : commune) ?? []) {
      const found = score(douar, place, keys.get(douar.code));
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
