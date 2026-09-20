/**
 * The 2024 count of economic establishments, read once at build time for the région,
 * province and commune pages. The 6 cities with arrondissements carry the sum of their
 * own, which is what `basis` on their record says.
 */
import { readFileSync } from "node:fs";
import { arrondissements } from "./places.ts";
import type { EconomyRecord } from "../../../api/src/lib/economy.ts";

const read = (name: string) => JSON.parse(readFileSync(`data/v1/economy/${name}.json`, "utf8"));

export const nationalEconomy = read("national") as EconomyRecord;
export const economyOf = new Map(
  ([...read("regions"), ...read("provinces"), ...read("communes")] as EconomyRecord[]).map((r) => [r.code!, r]),
);

/** How many arrondissements a city's summed figures were added from. */
export const arrondissementCount = new Map<string, number>();
for (const a of arrondissements) {
  arrondissementCount.set(a.communeCode, (arrondissementCount.get(a.communeCode) ?? 0) + 1);
}

/** A count off a record, or null. */
export const count = (record: EconomyRecord | null | undefined, path: string): number | null => {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  return record?.topics[topic]?.[key] ?? null;
};

export type { EconomyRecord };
