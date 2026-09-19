import { mkdir, writeFile } from "node:fs/promises";
import { BOM } from "./csv.ts";
import { join } from "node:path";
import type { CrosswalkRow } from "../build/crosswalk.ts";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function writeCrosswalk(rows: CrosswalkRow[], dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const sorted = [...rows].sort((a, b) => a.code2024.localeCompare(b.code2024));

  await writeFile(join(dir, "2014-2024.json"), `${JSON.stringify(sorted, null, 2)}\n`);

  const header = [
    "code_2024", "code_2014", "name_2024", "name_2014",
    "name_ar_2024", "name_ar_2014", "method",
    "normalised_name_match", "candidates_in_province",
    "population_2024", "population_2014", "population_ratio",
  ];
  const lines = [header.join(",")];
  for (const r of sorted) {
    lines.push([
      r.code2024, r.code2014, r.name2024, r.name2014,
      r.nameAr2024, r.nameAr2014, r.method,
      r.evidence.normalisedNameMatch, r.evidence.candidatesInProvince,
      r.evidence.population2024, r.evidence.population2014, r.evidence.populationRatio,
    ].map(cell).join(","));
  }
  await writeFile(join(dir, "2014-2024.csv"), `${BOM}${lines.join("\n")}\n`);
}
