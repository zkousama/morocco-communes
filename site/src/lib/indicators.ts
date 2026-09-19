/**
 * HCP's 2024 census indicators, read once at build time for the région, province and
 * commune pages.
 */
import { readFileSync } from "node:fs";
import type { IndicatorRecord, Topics } from "../../../api/src/lib/indicators.ts";

const read = (name: string) => JSON.parse(readFileSync(`data/v1/indicators/${name}.json`, "utf8"));

export const national = read("national") as IndicatorRecord;
export const indicatorsOf = new Map(
  ([...read("regions"), ...read("provinces"), ...read("communes")] as IndicatorRecord[]).map((r) => [r.code!, r]),
);

/** A figure off one block, or null. */
export const figure = (topics: Topics | null | undefined, path: string): number | null => {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  return topics?.[topic]?.[key] ?? null;
};

export type { IndicatorRecord, Topics };
