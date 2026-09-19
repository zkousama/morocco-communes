import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Census, IndicatorRecord } from "../lib/indicators.ts";

const LEVELS = ["national", "regions", "provinces", "cercles", "communes", "arrondissements", "urban-centres"];

/**
 * Every indicators record in the dataset: the country, each level, then the urban centres,
 * each carrying the 2014 census beside the 2024 one. A unit the 2014 census didn't count
 * — a commune that has since split, a cercle drawn since — carries null there.
 */
export async function readIndicators(dataDir: string): Promise<IndicatorRecord[]> {
  const read = async (census: string, name: string) =>
    JSON.parse(await readFile(join(dataDir, "indicators", census, `${name}.json`), "utf8"));
  const flatten = async (census: string) =>
    (await Promise.all(LEVELS.map((name) => read(census, name)))).flatMap((body) => (Array.isArray(body) ? body : [body]));

  const records: IndicatorRecord[] = await flatten(".");
  const before = new Map<string, Census>(
    (await flatten("2014")).map((r: IndicatorRecord) => [r.code ?? "", { people: r.people, households: r.households }]),
  );
  return records.map((r) => ({ ...r, "2014": before.get(r.code ?? "") ?? null }));
}
