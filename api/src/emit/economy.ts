import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EconomyRecord } from "../lib/economy.ts";

const LEVELS = ["national", "regions", "provinces", "cercles", "communes", "arrondissements"];

/**
 * Every establishments record in the dataset: the country, then each level. The census's
 * urban centres have none, since the workbook stops at the commune.
 */
export async function readEconomy(dataDir: string): Promise<EconomyRecord[]> {
  const read = async (name: string) => JSON.parse(await readFile(join(dataDir, "economy", `${name}.json`), "utf8"));
  const bodies = await Promise.all(LEVELS.map(read));
  return bodies.flatMap((body) => (Array.isArray(body) ? body : [body]));
}
