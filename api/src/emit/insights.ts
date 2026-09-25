import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LEVELS = ["regions", "provinces", "communes", "arrondissements"];

export interface Insights {
  /** Every unit's insights file, in no particular order. */
  units: Record<string, unknown>[];
  /** The published index: code, level and finding count for each unit above. */
  index: unknown[];
}

/** A missing file or directory: the only read failure that means "nothing published here". */
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/**
 * Reads `data/v1/insights/`: a unit file per level directory, and the index beside them.
 * Empty when the directory doesn't exist yet, which is where a fresh checkout starts, since
 * the pipeline hasn't published a run. Only a missing file or directory reads as "nothing
 * published"; any other read failure, or a file that doesn't parse, fails the build instead
 * of quietly publishing an index that disagrees with the unit files sitting beside it.
 */
export async function readInsights(dataDir: string): Promise<Insights> {
  const dir = join(dataDir, "insights");
  const units: Record<string, unknown>[] = [];
  for (const level of LEVELS) {
    let names: string[];
    try {
      names = await readdir(join(dir, level));
    } catch (error) {
      if (isMissing(error)) continue;
      throw new Error(`could not read ${join(dir, level)}: ${(error as Error).message}`);
    }
    // Only the unit files: a stray .DS_Store or a note beside them isn't one.
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      units.push(JSON.parse(await readFile(join(dir, level, name), "utf8")));
    }
  }
  const indexPath = join(dir, "index.json");
  let index: unknown[] = [];
  try {
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch (error) {
    if (!isMissing(error)) throw new Error(`could not read ${indexPath}: ${(error as Error).message}`);
  }
  return { units, index };
}
