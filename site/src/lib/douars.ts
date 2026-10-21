/**
 * A commune's douars for its page, read at build time from the dataset's douar files: its
 * fractions in code order, each with its douars in code order.
 */
import { readFileSync } from "node:fs";
import { readDouarSources, withCommuneNames, withFractionNames, withSources, type DouarRecord, type FractionRecord } from "../../../api/src/lib/douars.ts";
import { toLatin } from "../../../api/src/lib/spell.ts";
import type { WordTable } from "../../../api/src/lib/translitWords.ts";
import { arabicKeys, lookupKey } from "../../../api/src/lib/translit.ts";
import type { DouarNames } from "../../../api/src/lib/douarSearch.ts";

export type { DouarRecord, FractionRecord };

export interface Fraction extends FractionRecord {
  rows: DouarRecord[];
}

const read = <T>(name: string) => JSON.parse(readFileSync(`data/v1/douars/${name}.json`, "utf8")) as T;
const REGIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

/** Every douar, in HCP's code order, with its point and Latin name where it has them. */
const sources = readDouarSources();
const communes = JSON.parse(readFileSync("data/v1/attributes/communes.json", "utf8")) as { code: string; name: { fr: string; ar: string | null } }[];
export const allDouars: DouarRecord[] = withCommuneNames(
  REGIONS.flatMap((region) => read<DouarRecord[]>(region)).map((d) => withSources(d, sources)),
  communes,
);

const byFraction = new Map<string, DouarRecord[]>();
for (const d of allDouars) {
  if (!byFraction.has(d.fraction)) byFraction.set(d.fraction, []);
  byFraction.get(d.fraction)!.push(d);
}
/** Every fraction, with its Latin name or its label where it has one. */
export const allFractions: FractionRecord[] = withCommuneNames(withFractionNames(read<FractionRecord[]>("fractions"), allDouars), communes);

const byCommune = new Map<string, Fraction[]>();
for (const f of allFractions) {
  if (!byCommune.has(f.communeCode)) byCommune.set(f.communeCode, []);
  byCommune.get(f.communeCode)!.push({ ...f, rows: byFraction.get(f.code) ?? [] });
}
for (const fractions of byCommune.values()) fractions.sort((a, b) => a.code.localeCompare(b.code));

/** A commune's fractions, each holding its douars; empty for a commune with none. */
export const douarsOf = (communeCode: string): Fraction[] => byCommune.get(communeCode) ?? [];

/**
 * A rural commune's people its douars don't hold: the ones in its urban centres, which have
 * no douars, and the rest, nomads or people HCP counts apart, such as soldiers in barracks.
 * Null where the douars hold them all. The douars never hold more than the commune less its
 * centres (data/v1/douars/README.md).
 */
export function outsideDouars(population: number, centres: readonly { population: number | null }[], held: number): { centres: number; rest: number } | null {
  const inCentres = centres.reduce((sum, c) => sum + (c.population ?? 0), 0);
  const rest = population - inCentres - held;
  return inCentres + rest > 0 ? { centres: inCentres, rest } : null;
}

const table = JSON.parse(readFileSync("api/generated/translit-words.json", "utf8")) as WordTable;

/**
 * A douar's name in Latin: the one a source writes for it where one does, and otherwise its
 * spelling from the Arabic, which `spelt` marks.
 */
export const latinOf = (d: DouarRecord): { name: string; spelt: boolean; source?: string } =>
  d.latin ? { name: d.latin.name, spelt: false, source: d.latin.source } : { name: toLatin(d.name.ar, table), spelt: true };

/**
 * Every douar's name, in the shape /douars/names.json serves and the douar search reads
 * (api/src/lib/douarSearch.ts): a douar is its name, its commune's place in `communes`, the
 * rest of its code past the commune's, its people, its Latin name, 1 where that's spelt from
 * the Arabic, and the keys a Latin query is matched on; a commune is its slug, its French
 * name, the start of its douars' codes and its Arabic name.
 */
export function douarNames(communes: readonly { code: string; slug: string; codeDigits: string; name: { fr: string; ar: string } }[]): DouarNames {
  const withDouars = new Set(allDouars.map((d) => d.communeCode));
  const listed = communes.filter((c) => withDouars.has(c.code));
  const index = new Map(listed.map((c, i) => [c.code, i]));
  return {
    communes: listed.map((c) => [c.slug, c.name.fr, c.codeDigits.slice(2), c.name.ar]),
    douars: allDouars.map((d) => [
      d.name.ar,
      index.get(d.communeCode)!,
      d.code.slice(7),
      d.population,
      latinOf(d).name,
      latinOf(d).spelt ? 1 : 0,
      [...new Set(arabicKeys(d.name.ar).map(lookupKey))].join("|"),
    ]),
  };
}

/** A fraction's name in Latin, as latinOf gives a douar's; a label has none, its page translates it. */
export const fractionLatinOf = (f: FractionRecord): { name: string; spelt: boolean } | null =>
  f.label ? null : f.latin ? { name: f.latin.name, spelt: false } : { name: toLatin(f.name.ar, table), spelt: true };
