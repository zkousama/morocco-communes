/**
 * Finding a douar by name, in the index /douars/names.json holds (site/src/pages/douars/
 * names.json.ts): the douars page searches it in the browser, and /api/douars/search on the
 * server for the site's search box. In Arabic, a name that starts with the query comes first,
 * then one with a word that does, then any that holds it. In Latin, a name whose keys are the
 * query's comes first, then one whose keys start with them, then one whose Latin spelling holds
 * the query; and a spelling close to what was typed beats a key match that reads nothing like
 * it. The bigger douar first within each.
 */
import { normalise } from "./normalise.ts";
import { latinKeys, lookupKey, shareApart } from "./translit.ts";

export interface DouarNames {
  /** Slug, French name, and the start of its douars' codes, for each commune with douars. */
  communes: [slug: string, name: string, prefix: string][];
  /** Arabic name, its commune's place above, the rest of its code, people, Latin name, 1 where spelt, keys. */
  douars: [name: string, commune: number, rest: string, people: number, latin: string, spelt: 0 | 1, keys: string][];
}

export interface DouarHit {
  code: string;
  name: { ar: string; latin: string };
  spelt: boolean;
  people: number;
  commune: { slug: string; name: string };
}

/** How close a Latin spelling must be to what was typed to beat a match on keys alone. */
const CLOSE = 0.34;

/** The index read once into the forms the matching compares. */
export function prepare(names: DouarNames) {
  return {
    names,
    arabic: names.douars.map(([name]) => normalise(name)),
    latin: names.douars.map((d) => normalise(d[4])),
    keyed: names.douars.map((d) => d[6].split("|")),
  };
}

export type PreparedNames = ReturnType<typeof prepare>;

/** The douars a query finds, best first, and how many it found in all. */
export function findDouars(index: PreparedNames, raw: string, limit: number): { total: number; hits: DouarHit[] } {
  const query = normalise(raw);
  if (!query) return { total: 0, hits: [] };
  const found: { i: number; rank: number; near?: number }[] = [];
  if (/\p{Script=Arabic}/u.test(query)) {
    index.arabic.forEach((name, i) => {
      const at = name.indexOf(query);
      if (at >= 0) found.push({ i, rank: at === 0 ? 0 : name[at - 1] === " " ? 1 : 2 });
    });
  } else {
    const wanted = latinKeys(query).map(lookupKey).filter(Boolean);
    // French writes w as ou, so the 2 are one letter here: Tigraw is Tigraou, not Tigrar.
    const sound = (s: string) => s.replace(/ /g, "").replace(/ou/g, "w");
    const typed = sound(query);
    index.keyed.forEach((own, i) => {
      const near = shareApart(typed, sound(index.latin[i]!));
      if (own.some((k) => wanted.includes(k))) found.push({ i, rank: 0, near });
      else if (wanted.some((w) => w.length >= 2 && own.some((k) => k.startsWith(w)))) found.push({ i, rank: 1, near });
      else if (query.length >= 3 && index.latin[i]!.includes(query)) found.push({ i, rank: 2, near });
    });
    for (const f of found) if (f.near! <= CLOSE) f.rank = Math.min(f.rank, 0) - 1;
  }
  const douars = index.names.douars;
  found.sort((a, b) => a.rank - b.rank || (a.near ?? 0) - (b.near ?? 0) || douars[b.i]![3] - douars[a.i]![3]);
  const hits = found.slice(0, limit).map(({ i }) => {
    const [name, commune, rest, people, latin, spelt] = douars[i]!;
    const [slug, communeName, prefix] = index.names.communes[commune]!;
    return { code: `${prefix}${rest}`, name: { ar: name, latin }, spelt: spelt === 1, people, commune: { slug, name: communeName } };
  });
  return { total: found.length, hits };
}

/** Only the closest of what findDouars found: a key match on a name typed far from it isn't one. */
export const closeDouars = (index: PreparedNames, raw: string, limit: number): DouarHit[] => {
  const query = normalise(raw);
  if (/\p{Script=Arabic}/u.test(query)) return findDouars(index, raw, limit).hits;
  const sound = (s: string) => s.replace(/ /g, "").replace(/ou/g, "w");
  return findDouars(index, raw, limit * 4)
    .hits.filter((h) => shareApart(sound(query), sound(normalise(h.name.latin))) <= CLOSE)
    .slice(0, limit);
};
