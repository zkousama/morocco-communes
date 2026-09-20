/**
 * The 2024 count of economic establishments, read once at build time for the région,
 * province and commune pages. The 6 cities with arrondissements carry none: the workbook
 * counts them through their arrondissements.
 */
import { readFileSync } from "node:fs";
import type { EconomyRecord } from "../../../api/src/lib/economy.ts";

const read = (name: string) => JSON.parse(readFileSync(`data/v1/economy/${name}.json`, "utf8"));

export const nationalEconomy = read("national") as EconomyRecord;
export const economyOf = new Map(
  ([...read("regions"), ...read("provinces"), ...read("communes")] as EconomyRecord[]).map((r) => [r.code!, r]),
);

/** A count off a record, or null. */
export const count = (record: EconomyRecord | null | undefined, path: string): number | null => {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  return record?.topics[topic]?.[key] ?? null;
};

export type { EconomyRecord };
