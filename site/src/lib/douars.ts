/**
 * A commune's douars for its page, read at build time from the dataset's douar files: its
 * fractions in code order, each with its douars in code order.
 */
import { readFileSync } from "node:fs";
import { readDouarSources, withSources, type DouarRecord, type FractionRecord } from "../../../api/src/lib/douars.ts";
import { toLatin } from "../../../api/src/lib/spell.ts";
import type { WordTable } from "../../../api/src/lib/translitWords.ts";

export type { DouarRecord, FractionRecord };

export interface Fraction extends FractionRecord {
  rows: DouarRecord[];
}

const read = <T>(name: string) => JSON.parse(readFileSync(`data/v1/douars/${name}.json`, "utf8")) as T;
const REGIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

/** Every douar, in HCP's code order, with its point and Latin name where it has them. */
const sources = readDouarSources();
export const allDouars: DouarRecord[] = REGIONS.flatMap((region) => read<DouarRecord[]>(region)).map((d) => withSources(d, sources));

const byFraction = new Map<string, DouarRecord[]>();
for (const d of allDouars) {
  if (!byFraction.has(d.fraction)) byFraction.set(d.fraction, []);
  byFraction.get(d.fraction)!.push(d);
}
const byCommune = new Map<string, Fraction[]>();
for (const f of read<FractionRecord[]>("fractions")) {
  if (!byCommune.has(f.communeCode)) byCommune.set(f.communeCode, []);
  byCommune.get(f.communeCode)!.push({ ...f, rows: byFraction.get(f.code) ?? [] });
}
for (const fractions of byCommune.values()) fractions.sort((a, b) => a.code.localeCompare(b.code));

/** A commune's fractions, each holding its douars; empty for a commune with none. */
export const douarsOf = (communeCode: string): Fraction[] => byCommune.get(communeCode) ?? [];

const table = JSON.parse(readFileSync("api/generated/translit-words.json", "utf8")) as WordTable;

/**
 * A douar's name in Latin: the one a source writes for it where one does, and otherwise its
 * spelling from the Arabic, which `spelt` marks.
 */
export const latinOf = (d: DouarRecord): { name: string; spelt: boolean; source?: string } =>
  d.latin ? { name: d.latin.name, spelt: false, source: d.latin.source } : { name: toLatin(d.name.ar, table), spelt: true };
