import { normalise, trigrams } from "../lib/normalise.ts";
import type { IndexEntry, Level, SearchIndex } from "../lib/search.ts";

interface Named {
  code: string;
  codeDigits?: string;
  name: { fr: string; ar: string };
  slug?: string;
  centroid?: { lat: number; lng: number } | null;
}

/**
 * Builds the artefact the Worker loads: every searchable unit, plus a trigram posting
 * map. Postings hold the entry's position rather than its code, which keeps the map
 * small, and the entries are sorted by code so a rebuild produces the same positions.
 */
export function buildIndex(
  datasetVersion: string,
  levels: { level: Level; rows: Named[] }[],
): SearchIndex {
  const entries: IndexEntry[] = [];
  const postings: Record<string, number[]> = {};

  for (const { level, rows } of levels) {
    for (const row of [...rows].sort((a, b) => a.code.localeCompare(b.code))) {
      const slug = row.slug ?? normalise(row.name.fr).replace(/ /g, "-");
      const nFr = normalise(row.name.fr);
      const nAr = normalise(row.name.ar);
      const grams = new Set<string>();
      for (const field of [nFr, nAr, slug.replace(/-/g, " ")]) {
        for (const g of trigrams(field)) grams.add(g);
      }
      const i = entries.length;
      for (const g of grams) (postings[g] ??= []).push(i);
      entries.push([
        row.code,
        level,
        row.name.fr,
        row.name.ar,
        slug,
        row.centroid?.lat ?? null,
        row.centroid?.lng ?? null,
        nFr,
        nAr,
        grams.size,
        row.codeDigits ?? row.code.replace(/\./g, ""),
      ]);
    }
  }

  // Byte-identical rebuilds come from the walk above being deterministic — rows sorted by
  // code — which fixes both the key set and the insertion order. This sort only makes the
  // file pleasant to diff, and it cannot fully order the keys: 21 communes share a name,
  // so their slugs carry the code digits, and trigrams like "101" are integer-like keys
  // that V8 hoists ahead of every string key whatever order they were inserted in.
  const sorted: Record<string, number[]> = {};
  for (const g of Object.keys(postings).sort()) sorted[g] = postings[g]!;

  return { datasetVersion, entries, postings: sorted };
}
