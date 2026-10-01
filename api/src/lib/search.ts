import { normalise, skeleton, trigrams } from "./normalise.ts";

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
  /** The zero-padded form, so the Worker can resolve a digits-only code without
   * reimplementing the per-level padding rules. */
  codeDigits: string,
];

export interface SearchIndex {
  datasetVersion: string;
  entries: IndexEntry[];
  /** Trigram to the entry positions that contain it, in ascending order. */
  postings: Record<string, number[]>;
  /** Normalised exonym to the entry position it names. */
  aliases: Record<string, number>;
  /** A French name's skeleton, or an exonym's, to the entry positions that have it. */
  skeletons: Record<string, number[]>;
  /**
   * Neighbourhoods, which HCP doesn't count: French name, Arabic name, and the position of
   * the arrondissement or commune that holds each. Left out of an index built without them.
   */
  places?: [string, string, number][];
}

export interface Hit {
  code: string;
  level: Level;
  name: { fr: string; ar: string };
  slug: string;
  score: number;
  matched: "code" | "exact" | "alias" | "prefix" | "spelling" | "trigram" | "neighbourhood";
  /** The neighbourhood the query named, when the unit was found through one. */
  neighbourhood?: { fr: string; ar: string };
}

const EXACT = 1000;
const PREFIX = 500;
/**
 * A name spelt another way, with the same consonants. Below any prefix and above any
 * trigram match, with the trigram overlap added, so where several names share a skeleton,
 * the one closest to what was typed comes first.
 */
const SPELLING = 300;
/**
 * A neighbourhood's name, a step below a unit's own at each kind of match, so Agdal the
 * arrondissement comes before Agdal the neighbourhood. A word inside a neighbourhood's name
 * sits below a spelling variant and above any trigram overlap.
 */
const PLACE_EXACT = 950;
const PLACE_PREFIX = 450;
const PLACE_WORD = 250;
/** Letters a query needs before neighbourhoods are searched: under 3 matches hundreds. */
const PLACE_MIN = 3;

interface PreparedPlace {
  fr: string;
  ar: string;
  at: number;
  nFr: string;
  nAr: string;
}
const preparedPlaces = new WeakMap<SearchIndex, PreparedPlace[]>();
/** The neighbourhoods' normalised names, worked out on the first search that needs them. */
const placesOf = (index: SearchIndex): PreparedPlace[] => {
  let prepared = preparedPlaces.get(index);
  if (!prepared) {
    prepared = (index.places ?? []).map(([fr, ar, at]) => ({ fr, ar, at, nFr: normalise(fr), nAr: normalise(ar) }));
    preparedPlaces.set(index, prepared);
  }
  return prepared;
};

/**
 * Scores only the entries that share a trigram with the query, or its consonant skeleton.
 *
 * The postings walk both selects the candidates and counts how many distinct query
 * trigrams each one shares, so scoring never re-derives anything about an entry, which
 * is the difference between a query costing 27 ms and costing well under one. Ties break
 * on the level and then on the code, never on iteration order, so two identical queries
 * rank identically.
 */
export function search(
  index: SearchIndex,
  query: string,
  options: { levels?: Level[]; limit?: number; neighbourhoods?: boolean } = {},
): Hit[] {
  const limit = options.limit ?? 10;
  const levels = options.levels ? new Set(options.levels) : null;

  // A code is looked up, not spelt. Its digits share trigrams with no name that means
  // anything, so 1511010 used to come back as whichever name held "151". It takes the
  // forms an address does: dotted, zero-padded, or with the zeros lost in a spreadsheet.
  // A code that names nothing finds nothing rather than a name that happens to match.
  const raw = query.trim();
  if (/^[0-9][0-9.]*$/.test(raw)) {
    const bare = raw.includes(".") ? null : raw.replace(/^0+/, "");
    const hits: Hit[] = [];
    for (const [code, level, fr, ar, slug, , , , , , codeDigits] of index.entries) {
      if (levels && !levels.has(level)) continue;
      if (code !== raw && (bare === null || codeDigits.replace(/^0+/, "") !== bare)) continue;
      hits.push({ code, level, name: { fr, ar }, slug, score: EXACT, matched: "code" });
    }
    hits.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.code.localeCompare(b.code));
    return hits.slice(0, limit);
  }

  const q = normalise(query);
  if (q === "") return [];

  const grams = trigrams(q);
  const shared = new Map<number, number>();
  // An exonym is a different word, not a spelling of the same one, so no amount of
  // trigram overlap would surface it. Looked up before the walk, and seeded into it so
  // the hit is scored and sorted like any other.
  const alias = index.aliases[q];
  for (const g of new Set(grams)) {
    const posting = index.postings[g];
    if (!posting) continue;
    for (const i of posting) shared.set(i, (shared.get(i) ?? 0) + 1);
  }

  if (alias !== undefined) shared.set(alias, Number.POSITIVE_INFINITY);

  // Two consonants at least: one would match half the country.
  const bones = skeleton(q);
  const spelt = new Set(bones.length >= 2 ? (index.skeletons[bones] ?? []) : []);
  for (const i of spelt) if (!shared.has(i)) shared.set(i, 0);

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
    } else if (overlap === Number.POSITIVE_INFINITY) {
      score = EXACT;
      matched = "alias";
    } else if (nFr.startsWith(q) || nAr.startsWith(q) || nSlug.startsWith(q)) {
      // A longer name is a weaker prefix match: "tanger" ranks Tanger above
      // Tanger-Assilah rather than treating both as equally good.
      const field = nFr.startsWith(q) ? nFr : nAr.startsWith(q) ? nAr : nSlug;
      score = PREFIX - Math.min(PREFIX - 1, field.length - q.length);
      matched = "prefix";
    } else {
      // Dice coefficient, so a short query cannot score a long name highly just by
      // being contained in it.
      const dice = (200 * overlap) / (gramCount + grams.length);
      if (spelt.has(i)) {
        score = SPELLING + dice;
        matched = "spelling";
      } else {
        score = dice;
        matched = "trigram";
      }
    }
    if (score <= 0) continue;
    hits.push({ code, level, name: { fr, ar }, slug, score: Number(score.toFixed(4)), matched });
  }

  if (options.neighbourhoods !== false && q.length >= PLACE_MIN) {
    const words = (s: string) => s.split(" ").some((w) => w.startsWith(q));
    for (const place of placesOf(index)) {
      let score = 0;
      if (place.nFr === q || place.nAr === q) score = PLACE_EXACT;
      else if (place.nFr.startsWith(q) || place.nAr.startsWith(q)) {
        const field = place.nFr.startsWith(q) ? place.nFr : place.nAr;
        score = PLACE_PREFIX - Math.min(PLACE_PREFIX - PLACE_WORD - 1, field.length - q.length);
      } else if (q.includes(" ") ? false : words(place.nFr) || words(place.nAr)) score = PLACE_WORD;
      if (score === 0) continue;
      const entry = index.entries[place.at];
      if (!entry) continue;
      const [code, level, fr, ar, slug] = entry;
      if (levels && !levels.has(level)) continue;
      hits.push({ code, level, name: { fr, ar }, slug, score, matched: "neighbourhood", neighbourhood: { fr: place.fr, ar: place.ar } });
    }
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      a.code.localeCompare(b.code) ||
      (a.neighbourhood?.fr ?? "").localeCompare(b.neighbourhood?.fr ?? ""),
  );
  // A unit once, by its best match: its own name, or the neighbourhood nearest the query.
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.code) && seen.add(h.code)).slice(0, limit);
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
