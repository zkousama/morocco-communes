import { DOUAR_FIELDS } from "../../../pipeline/src/sources/douarFields.ts";
import type { Topics } from "./indicators.ts";

/** One douar, as data/v1/douars holds it. */
export interface DouarRecord {
  code: string;
  communeCode: string;
  fraction: string;
  name: { ar: string };
  type: "grouped" | "split" | "dispersed";
  households: number;
  population: number;
  /** Null where HCP withholds them, for a douar of fewer than 30 households. */
  topics: Topics | null;
}

/** One fraction, the level between a rural commune and its douars. */
export interface FractionRecord {
  code: string;
  communeCode: string;
  name: { ar: string };
  douars: number;
  households: number;
  population: number;
}

/** Each topic's keys, in the order the workbook gives them. */
export const DOUAR_TOPICS: Map<string, string[]> = new Map();
for (const f of DOUAR_FIELDS) {
  DOUAR_TOPICS.set(f.topic, [...(DOUAR_TOPICS.get(f.topic) ?? []), f.key]);
}
