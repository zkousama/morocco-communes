import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HousingRecord } from "../lib/housing.ts";

const LEVELS = ["national", "regions", "provinces", "cercles", "communes", "arrondissements", "urban-centres"];

/**
 * Every urban housing record in the dataset. Only the 784 units with an urban stock have
 * one; a unit with no urban area is absent rather than carrying 55 nulls.
 */
export async function readHousing(dataDir: string): Promise<HousingRecord[]> {
  const read = async (name: string) => JSON.parse(await readFile(join(dataDir, "housing", `${name}.json`), "utf8"));
  const bodies = await Promise.all(LEVELS.map(read));
  return bodies.flatMap((body) => (body === null ? [] : Array.isArray(body) ? body : [body]));
}
