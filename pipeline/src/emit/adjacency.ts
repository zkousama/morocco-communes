import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Border } from "../build/adjacency.ts";
import { neighboursOf } from "../build/adjacency.ts";
import { toCsv } from "./csv.ts";

/**
 * The borders, beside the boundaries they were measured on. They derive from
 * OpenStreetMap, so they carry the ODbL terms that directory's LICENSE sets out, and not
 * the census licence the rest of the dataset has.
 */
export async function writeAdjacency(borders: Border[], names: Map<string, string>, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });

  const neighbours = neighboursOf(borders);
  await writeFile(
    join(dir, "adjacency.json"),
    `${JSON.stringify(
      [...neighbours]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, list]) => ({ code, neighbours: list.map((n) => ({ code: n.code, km: n.km })) })),
    )}\n`,
  );

  await writeFile(
    join(dir, "adjacency.csv"),
    toCsv(
      ["code_a", "name_a", "code_b", "name_b", "km"],
      borders.map((b) => [b.a, names.get(b.a) ?? "", b.b, names.get(b.b) ?? "", b.km]),
    ),
  );
}
