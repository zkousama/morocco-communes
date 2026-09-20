/**
 * The 2024 urban housing stock, read once at build time for the région, province and
 * commune pages. Only a unit with an urban area has a record: the rest have no urban
 * dwellings to count.
 */
import { readFileSync } from "node:fs";
import type { HousingRecord } from "../../../api/src/lib/housing.ts";

const read = (name: string) => JSON.parse(readFileSync(`data/v1/housing/${name}.json`, "utf8")) as HousingRecord[];

export const housingOf = new Map(
  [...read("regions"), ...read("provinces"), ...read("communes")].map((r) => [r.code!, r]),
);

/** A figure off a record, or null. */
export const dwellings = (record: HousingRecord | null | undefined, path: string): number | null => {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  return record?.topics[topic]?.[key] ?? null;
};

export type { HousingRecord };
