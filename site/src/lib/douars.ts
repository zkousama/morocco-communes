/**
 * A commune's douars for its page, read at build time from the dataset's douar files: its
 * fractions in code order, each with its douars in code order.
 */
import { readFileSync } from "node:fs";
import type { DouarRecord, FractionRecord } from "../../../api/src/lib/douars.ts";

export type { DouarRecord, FractionRecord };

export interface Fraction extends FractionRecord {
  rows: DouarRecord[];
}

const read = <T>(name: string) => JSON.parse(readFileSync(`data/v1/douars/${name}.json`, "utf8")) as T;
const REGIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

/** Every douar, in HCP's code order. */
export const allDouars: DouarRecord[] = REGIONS.flatMap((region) => read<DouarRecord[]>(region));

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
