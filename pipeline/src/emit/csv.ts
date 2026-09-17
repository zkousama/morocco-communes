import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatasetRecords } from "./records.ts";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function writeCsv(records: DatasetRecords, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });

  const header = [
    "code", "code_digits", "slug", "name_fr", "name_ar", "type",
    "region_code", "province_code", "cercle_code",
    "population_2024", "households_2024", "population_2014", "change_pct",
  ];
  const lines = [header.join(",")];
  for (const c of records.communes) {
    lines.push([
      c.code, c.codeDigits, c.slug, c.name.fr, c.name.ar, c.type,
      c.parents.region, c.parents.province, c.parents.cercle,
      c.population["2024"].total, c.population["2024"].households,
      c.population["2014"]?.total ?? null, c.population.change?.pct ?? null,
    ].map(cell).join(","));
  }
  await writeFile(join(dir, "communes.csv"), `${lines.join("\n")}\n`);
}
