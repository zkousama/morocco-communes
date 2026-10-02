import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readDouarSources, withSources, type DouarRecord, type FractionRecord } from "../lib/douars.ts";

const REGIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

/** Every douar in the dataset, from its 12 région files, with its point and Latin name where it has them, and every fraction. */
export async function readDouars(dataDir: string): Promise<{ douars: DouarRecord[]; fractions: FractionRecord[] }> {
  const read = async (name: string) => JSON.parse(await readFile(join(dataDir, "douars", `${name}.json`), "utf8"));
  const sources = readDouarSources();
  const douars = ((await Promise.all(REGIONS.map(read))).flat() as DouarRecord[]).map((d) => withSources(d, sources));
  const fractions = (await read("fractions")) as FractionRecord[];
  return { douars, fractions };
}
