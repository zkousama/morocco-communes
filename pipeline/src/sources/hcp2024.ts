import { readSheetRows } from "../lib/xlsx.ts";
import type { RawRow, RowKind } from "../build/types.ts";

/** Column order in the 2024 workbook. */
const FR = 0, MOROCCAN = 1, FOREIGN = 2, POPULATION = 3, HOUSEHOLDS = 4, AR = 5, CODE = 6;

export function classifyRow(label: string): RowKind | null {
  if (label.startsWith("Ensemble du territoire national")) return "national";
  if (label.startsWith("Région")) return "region";
  // Checked before "Préfecture", since both spellings start with it. The 2024
  // workbook writes "Préfecture d'arrondissements" with a straight apostrophe and a
  // lower-case a; the 2014 one writes "Préfecture d’Arrondissements" with U+2019 and a
  // capital. Accepting both keeps this safe to reuse across the two files.
  if (/^Préfecture d['’]arrondissements?\b/i.test(label)) return "prefectureOfArrondissements";
  if (label.startsWith("Préfecture")) return "prefecture";
  if (label.startsWith("Province")) return "province";
  if (label.startsWith("Cercle")) return "cercle";
  if (label.startsWith("Commune")) return "commune";
  if (label.startsWith("Arrondissement")) return "arrondissement";
  if (label.startsWith("dont le centre urbain")) return "urbanCentre";
  return null;
}

function toNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/\s/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

export function toRawRow(row: (string | null)[]): RawRow {
  const label = (row[FR] ?? "").trim();
  const kind = classifyRow(label);
  if (!kind) throw new Error(`unclassifiable row label: ${JSON.stringify(label)}`);
  return {
    kind,
    nameFr: label,
    nameAr: (row[AR] ?? "").trim(),
    code: row[CODE]?.trim() || null,
    population: toNumber(row[POPULATION]),
    moroccan: toNumber(row[MOROCCAN]),
    foreign: toNumber(row[FOREIGN]),
    households: toNumber(row[HOUSEHOLDS]),
  };
}

export function parseHcp2024(bytes: Uint8Array): RawRow[] {
  const rows = readSheetRows(bytes);
  const start = rows.findLastIndex((r) => (r[FR] ?? "").trim() === "Ensemble du territoire national");
  if (start < 0) throw new Error("the 2024 workbook has no final national block");
  return rows
    .slice(start)
    .filter((r) => (r[FR] ?? "").trim().length > 0 && classifyRow((r[FR] ?? "").trim()) !== null)
    .map(toRawRow);
}
