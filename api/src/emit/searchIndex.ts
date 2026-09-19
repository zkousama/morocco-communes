import { normalise, skeleton, trigrams } from "../lib/normalise.ts";
import { EXONYMS, type Exonym } from "../lib/exonyms.ts";
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

  const aliases = buildAliases(entries);
  return { datasetVersion, entries, postings: sorted, aliases, skeletons: buildSkeletons(entries, aliases) };
}

/**
 * Each French name's consonant skeleton, and each exonym's, so Titwan finds Tétouan and
 * Dar Bida finds Casablanca. Sorted like the postings, for the diff.
 */
export function buildSkeletons(entries: IndexEntry[], aliases: Record<string, number>): Record<string, number[]> {
  const found: Record<string, Set<number>> = {};
  const add = (name: string, i: number) => {
    const key = skeleton(name);
    if (key.length >= 2) (found[key] ??= new Set()).add(i);
  };
  entries.forEach(([, , , , , , , nFr], i) => add(nFr, i));
  for (const [name, i] of Object.entries(aliases)) add(name, i);
  const out: Record<string, number[]> = {};
  for (const key of Object.keys(found).sort()) out[key] = [...found[key]!].sort((a, b) => a - b);
  return out;
}

/**
 * Resolves the exonym list against the index, and refuses two things rather than
 * shipping them: a code no unit has, and an alias that is already some unit's real
 * name. The second matters more — an alias shadowing a real name would send a search
 * for that place somewhere else entirely, so the real name always wins by the alias
 * being rejected at build time.
 */
export function buildAliases(entries: IndexEntry[], list: Exonym[] = EXONYMS): Record<string, number> {
  const positionByCode = new Map<string, number>();
  const realNames = new Set<string>();
  entries.forEach(([code, , , , slug, , , nFr, nAr], i) => {
    positionByCode.set(code, i);
    realNames.add(nFr);
    realNames.add(nAr);
    realNames.add(slug.replace(/-/g, " "));
  });

  const aliases: Record<string, number> = {};
  const problems: string[] = [];
  for (const { name, code } of list) {
    const key = normalise(name);
    const position = positionByCode.get(code);
    if (position === undefined) {
      problems.push(`exonym ${name} points at ${code}, which no unit has`);
      continue;
    }
    if (realNames.has(key)) {
      problems.push(`exonym ${name} is already a real name; it would shadow it`);
      continue;
    }
    if (key in aliases && aliases[key] !== position) {
      problems.push(`exonym ${name} is claimed by two different units`);
      continue;
    }
    aliases[key] = position;
  }
  if (problems.length > 0) {
    throw new Error(`the exonym list does not hold up:\n  ${problems.join("\n  ")}`);
  }
  return aliases;
}
