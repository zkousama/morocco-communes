import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LEVELS = ["regions", "provinces", "communes", "arrondissements"];

export interface Insights {
  /** Every unit's insights file, in no particular order. */
  units: Record<string, unknown>[];
  /** The published index: code, level and finding count for each unit above. */
  index: unknown[];
}

/**
 * Reads `data/v1/insights/`: a unit file per level directory, and the index beside them.
 * Empty when the directory doesn't exist yet, which is where a fresh checkout starts, since
 * the pipeline hasn't published a run.
 */
export async function readInsights(dataDir: string): Promise<Insights> {
  const dir = join(dataDir, "insights");
  const units: Record<string, unknown>[] = [];
  for (const level of LEVELS) {
    let names: string[];
    try {
      names = await readdir(join(dir, level));
    } catch {
      continue;
    }
    for (const name of names) {
      units.push(JSON.parse(await readFile(join(dir, level, name), "utf8")));
    }
  }
  let index: unknown[] = [];
  try {
    index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
  } catch {
    index = [];
  }
  return { units, index };
}
