import { normalise } from "./normalise.ts";
import type { Level, SearchIndex } from "./search.ts";

export interface Lookup {
  /** Dotted code by dotted code, by zero-padded digits, and by slug. */
  canonical: Map<string, { code: string; level: Level }>;
}

/**
 * One map from every spelling of an identifier to the canonical dotted code, so
 * `01.511.01.0`, `001511010`, `1511010` and `tanger` all address one commune.
 *
 * Built at module scope. The unpadded digit form is included because a code copied out
 * of a spreadsheet has lost its leading zeros — the same thing that made the source
 * workbooks hard to parse.
 */
export function buildLookup(index: SearchIndex): Lookup {
  const canonical = new Map<string, { code: string; level: Level }>();
  for (const [code, level, , , slug, , , , , , codeDigits] of index.entries) {
    const target = { code, level };
    canonical.set(code, target);
    canonical.set(codeDigits, target);
    const unpadded = codeDigits.replace(/^0+/, "");
    // Only when nothing else claims it: stripping zeros can collide across levels.
    if (unpadded !== "" && !canonical.has(unpadded)) canonical.set(unpadded, target);
    if (!canonical.has(slug)) canonical.set(slug, target);
  }
  return { canonical };
}

/**
 * Distinguishes "this identifier names nothing" from "this is not an identifier", which
 * is the difference between a 404 and a 400. A client that typed a well-formed absent
 * code should not bother retrying; one that typed something unsearchable should.
 *
 * The line falls where normalisation leaves nothing to look up. That is deliberately
 * lenient: `../../etc/passwd` normalises to `etc-passwd` and comes back absent rather
 * than malformed, because it is a name-shaped thing that names nothing. Nothing is at
 * stake in the distinction, because the caller uses the resolved `code` and never the
 * raw input as a path.
 */
export function resolve(
  lookup: Lookup,
  raw: string,
): { kind: "found"; code: string; level: Level } | { kind: "absent" } | { kind: "malformed" } {
  const hit = lookup.canonical.get(raw);
  if (hit) return { kind: "found", ...hit };
  const slug = normalise(raw).replace(/ /g, "-");
  if (slug === "" || slug === "-") return { kind: "malformed" };
  const bySlug = lookup.canonical.get(slug);
  if (bySlug) return { kind: "found", ...bySlug };
  return { kind: "absent" };
}

/** "a province", "an arrondissement": a level as a sentence names it. */
export const withArticle = (level: Level) => `${/^[aeiou]/.test(level) ? "an" : "a"} ${level}`;

export type SortKey = "code" | "name" | "population" | "change" | "density" | "area";

export interface FilterQuery {
  region?: string;
  province?: string;
  cercle?: string;
  type?: "urban" | "rural";
  /** A field to order by, with a leading minus for largest first. Code order when absent. */
  sort?: SortKey | `-${SortKey}`;
  minPopulation?: number;
  maxPopulation?: number;
  page: number;
}

/**
 * The pre-rendered path that answers a filter query on its own, or null when it has to be
 * computed: more than one filter, a population bound, or an order other than the code's.
 */
export function aliasPath(q: FilterQuery): string | null {
  const keys = [q.region, q.province, q.cercle, q.type].filter((v) => v !== undefined).length;
  if (keys > 1) return null;
  if ((q.sort !== undefined && q.sort !== "code") || q.minPopulation !== undefined || q.maxPopulation !== undefined) {
    return null;
  }
  if (q.cercle) return `/api/cercles/${q.cercle}/communes/page/${q.page}.json`;
  if (q.province) return `/api/provinces/${q.province}/communes/page/${q.page}.json`;
  if (q.region) return `/api/regions/${q.region}/communes/page/${q.page}.json`;
  if (q.type) return `/api/communes/type/${q.type}/page/${q.page}.json`;
  return `/api/communes/page/${q.page}.json`;
}
