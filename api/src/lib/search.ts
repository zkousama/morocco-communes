import { normalise, trigrams } from "./normalise.ts";

export type Level = "commune" | "arrondissement" | "province" | "region" | "cercle";

/**
 * Levels in the order a tie should break. A query of "Tanger" matches a commune, a
 * cercle and part of a province name; the commune is what a person means. Cercles come
 * last because they are an administrative intermediate that consumers rarely search for
 * by name.
 */
export const LEVEL_RANK: Record<Level, number> = {
  commune: 0,
  arrondissement: 1,
  province: 2,
  region: 3,
  cercle: 4,
};

/**
 * Tuples rather than objects: the same fields cost about a third as much on the wire.
 *
 * The normalised forms and the trigram count are stored rather than derived, because
 * deriving them per candidate is what made a query for a common name cost 27 ms against
 * a 10 ms budget. Storing them moves that work to build time.
 */
export type IndexEntry = [
  code: string,
  level: Level,
  fr: string,
  ar: string,
  slug: string,
  lat: number | null,
  lng: number | null,
  normalisedFr: string,
  normalisedAr: string,
  /** Distinct trigrams across all three searchable fields, the denominator for Dice. */
  gramCount: number,
];

export interface SearchIndex {
  datasetVersion: string;
  entries: IndexEntry[];
  /** Trigram to the entry positions that contain it, in ascending order. */
  postings: Record<string, number[]>;
}

export interface Hit {
  code: string;
  level: Level;
  name: { fr: string; ar: string };
  slug: string;
  score: number;
  matched: "exact" | "prefix" | "trigram";
}

const EXACT = 1000;
const PREFIX = 500;

/**
 * Scores only the entries that share a trigram with the query.
 *
 * The postings walk both selects the candidates and counts how many distinct query
 * trigrams each one shares, so scoring never re-derives anything about an entry — which
 * is the difference between a query costing 27 ms and costing well under one. Ties break
 * on the level and then on the code, never on iteration order, so two identical queries
 * rank identically.
 */
export function search(
  index: SearchIndex,
  query: string,
  options: { levels?: Level[]; limit?: number } = {},
): Hit[] {
  const q = normalise(query);
  if (q === "") return [];
  const limit = options.limit ?? 10;
  const levels = options.levels ? new Set(options.levels) : null;

  const grams = trigrams(q);
  const shared = new Map<number, number>();
  for (const g of new Set(grams)) {
    const posting = index.postings[g];
    if (!posting) continue;
    for (const i of posting) shared.set(i, (shared.get(i) ?? 0) + 1);
  }

  const hits: Hit[] = [];
  for (const [i, overlap] of shared) {
    const entry = index.entries[i];
    if (!entry) continue;
    const [code, level, fr, ar, slug, , , nFr, nAr, gramCount] = entry;
    if (levels && !levels.has(level)) continue;

    const nSlug = slug.replace(/-/g, " ");
    let score: number;
    let matched: Hit["matched"];
    if (nFr === q || nAr === q || nSlug === q) {
      score = EXACT;
      matched = "exact";
    } else if (nFr.startsWith(q) || nAr.startsWith(q) || nSlug.startsWith(q)) {
      // A longer name is a weaker prefix match: "tanger" ranks Tanger above
      // Tanger-Assilah rather than treating both as equally good.
      const field = nFr.startsWith(q) ? nFr : nAr.startsWith(q) ? nAr : nSlug;
      score = PREFIX - Math.min(PREFIX - 1, field.length - q.length);
      matched = "prefix";
    } else {
      // Dice coefficient, so a short query cannot score a long name highly just by
      // being contained in it.
      score = (200 * overlap) / (gramCount + grams.length);
      matched = "trigram";
    }
    if (score <= 0) continue;
    hits.push({ code, level, name: { fr, ar }, slug, score: Number(score.toFixed(4)), matched });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      a.code.localeCompare(b.code),
  );
  return hits.slice(0, limit);
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface NearHit {
  code: string;
  name: { fr: string; ar: string };
  slug: string;
  distanceKm: number;
}

/**
 * Communes within a radius, nearest first. A latitude band rejects most of the country
 * before any trigonometry runs, so a small radius does not pay for a full sweep.
 */
export function near(
  index: SearchIndex,
  lat: number,
  lng: number,
  radiusKm: number,
  limit = 10,
): NearHit[] {
  const latWindow = radiusKm / 111.32;
  const out: NearHit[] = [];
  for (const [code, level, fr, ar, slug, cLat, cLng] of index.entries) {
    if (level !== "commune" || cLat === null || cLng === null) continue;
    if (Math.abs(cLat - lat) > latWindow) continue;
    const distance = haversine(lat, lng, cLat, cLng);
    if (distance > radiusKm) continue;
    out.push({ code, name: { fr, ar }, slug, distanceKm: Number(distance.toFixed(3)) });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm || a.code.localeCompare(b.code));
  return out.slice(0, limit);
}
