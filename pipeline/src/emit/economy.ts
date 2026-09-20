import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ECONOMY_FIELDS, type EconomyField } from "../sources/economyFields.ts";
import type { EconomyRecord, Unplaced } from "../build/economy.ts";
import type { Level } from "../build/indicators.ts";
import { snake } from "./indicators.ts";
import { toCsv } from "./csv.ts";

/** A field's column in the CSV and its path in the API: size_50_plus, and size.50+. */
export const columnOf = (f: EconomyField) => `${snake(f.topic)}_${snake(f.key)}`;
export const pathOf = (f: EconomyField) => `${f.topic}.${f.key}`;

const FILES: Partial<Record<Level, string>> = {
  country: "national",
  region: "regions",
  province: "provinces",
  cercle: "cercles",
  commune: "communes",
  arrondissement: "arrondissements",
};

/** What the workbook counts, and what it leaves out. */
export const NOTES = {
  counted:
    "Every establishment HCP's field teams found and put on the map during the 2024 census: a place of business, a public service, or an association in premises of its own.",
  agriculture: "Farms are out. The workbook counts the establishments of every sector but agriculture.",
  souks: "A weekly souk is a market that stands on one day of the week. It is counted on its own and is not part of the establishment total.",
  jobs: "The jobs are the permanent ones the businesses hold, so seasonal and casual work is not in the figure.",
  units:
    "The workbook counts the 6 cities with arrondissements by arrondissement rather than as one place. Each of those cities carries the sum of its own arrondissements, marked basis: arrondissement_sum, the way its 2014 population is. Every other figure is a row of HCP's.",
};

const describe = (f: EconomyField) => ({
  path: pathOf(f),
  column: columnOf(f),
  topic: f.topic,
  key: f.key,
  label: f.label,
  heading: f.heading,
  ...(f.category ? { category: f.category } : {}),
  unit: f.unit,
});

export async function writeEconomy(
  records: EconomyRecord[],
  unplaced: Unplaced[],
  dir: string,
  source: { id: string; url: string },
): Promise<void> {
  await mkdir(dir, { recursive: true });

  for (const [level, file] of Object.entries(FILES) as [Level, string][]) {
    const rows = records.filter((r) => r.level === level);
    const body = level === "country" ? rows[0] ?? null : rows;
    await writeFile(join(dir, `${file}.json`), `${JSON.stringify(body)}\n`);
  }

  await writeFile(
    join(dir, "fields.json"),
    `${JSON.stringify({ census: "2024", source, fields: ECONOMY_FIELDS.map(describe), notes: NOTES }, null, 2)}\n`,
  );
  await writeFile(join(dir, "unplaced.json"), `${JSON.stringify(unplaced, null, 2)}\n`);

  const head = ["code", "code_digits", "level", "name_fr", "basis", ...ECONOMY_FIELDS.map(columnOf)];
  const rows = records.map((r) => [
    r.code,
    r.codeDigits,
    r.level,
    r.name.fr,
    r.basis ?? "hcp",
    ...ECONOMY_FIELDS.map((f) => r.topics[f.topic]?.[f.key] ?? null),
  ]);
  await writeFile(join(dir, "establishments.csv"), toCsv(head, rows));
}
