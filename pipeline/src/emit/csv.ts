import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatasetRecords } from "./records.ts";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The byte-order mark is what makes Excel read the file as UTF-8. Without it Excel on
 * Windows guesses a legacy code page, and every Arabic name and accent comes out garbled.
 * Other tools skip it.
 */
export const BOM = "﻿";

export function toCsv(header: string[], rows: unknown[][]): string {
  return `${BOM}${[header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n")}\n`;
}

interface Unit {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
  population: { "2024": { total: number | null; households: number | null } };
}

export async function writeCsv(records: DatasetRecords, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });

  await writeFile(
    join(dir, "communes.csv"),
    toCsv(
      [
        "code", "code_digits", "slug", "name_fr", "name_ar", "type",
        "region_code", "province_code", "cercle_code",
        "population_2024", "households_2024", "population_2014", "change_pct",
        "area_km2", "density_2024",
      ],
      records.communes.map((c) => [
        c.code, c.codeDigits, c.slug, c.name.fr, c.name.ar, c.type,
        c.parents.region, c.parents.province, c.parents.cercle,
        c.population["2024"].total, c.population["2024"].households,
        c.population["2014"]?.total ?? null, c.population.change?.pct ?? null,
        c.areaKm2, c.density,
      ]),
    ),
  );

  const base = (u: Unit) => [u.code, u.codeDigits, u.name.fr, u.name.ar];
  const people = (u: Unit) => [u.population["2024"].total, u.population["2024"].households];
  const head = ["code", "code_digits", "name_fr", "name_ar"];
  const counts = ["population_2024", "households_2024"];

  const regions = records.regions as (Unit & { provinceCount: number; communeCount: number })[];
  await writeFile(
    join(dir, "regions.csv"),
    toCsv([...head, ...counts, "provinces", "communes"], regions.map((r) => [...base(r), ...people(r), r.provinceCount, r.communeCount])),
  );

  const provinces = records.provinces as (Unit & { type: string; regionCode: string; cercleCount: number; communeCount: number })[];
  await writeFile(
    join(dir, "provinces.csv"),
    toCsv(
      [...head, "type", "region_code", ...counts, "cercles", "communes"],
      provinces.map((p) => [...base(p), p.type, p.regionCode, ...people(p), p.cercleCount, p.communeCount]),
    ),
  );

  const cercles = records.cercles as (Unit & { regionCode: string; provinceCode: string; communeCount: number })[];
  await writeFile(
    join(dir, "cercles.csv"),
    toCsv(
      [...head, "region_code", "province_code", ...counts, "communes"],
      cercles.map((c) => [...base(c), c.regionCode, c.provinceCode, ...people(c), c.communeCount]),
    ),
  );

  const arrondissements = records.arrondissements as (Unit & { communeCode: string })[];
  await writeFile(
    join(dir, "arrondissements.csv"),
    toCsv([...head, "commune_code", ...counts], arrondissements.map((a) => [...base(a), a.communeCode, ...people(a)])),
  );
}
