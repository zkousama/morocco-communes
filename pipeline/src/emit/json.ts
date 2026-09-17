import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatasetRecords } from "./records.ts";

export async function writeJson(records: DatasetRecords, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [level, rows] of Object.entries(records)) {
    await writeFile(join(dir, `${level}.json`), `${JSON.stringify(rows, null, 2)}\n`);
  }
}
