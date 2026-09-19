import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndicatorRecord } from "../lib/indicators.ts";

/** Every indicators record in the dataset: the country, each level, then the urban centres. */
export async function readIndicators(dataDir: string): Promise<IndicatorRecord[]> {
  const file = async (name: string) => JSON.parse(await readFile(join(dataDir, "indicators", `${name}.json`), "utf8"));
  return [
    await file("national"),
    ...(await file("regions")),
    ...(await file("provinces")),
    ...(await file("cercles")),
    ...(await file("communes")),
    ...(await file("arrondissements")),
    ...(await file("urban-centres")),
  ];
}
