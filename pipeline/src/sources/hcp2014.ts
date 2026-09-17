import { readSheetRows } from "../lib/xlsx.ts";

export interface Hcp2014Unit {
  codeDigits: string;
  nameFr: string;
  nameAr: string;
  kind: "municipality" | "commune" | "arrondissement";
  population: number | null;
  households: number | null;
}

/** Column order in the 2014 workbook. */
const CODE = 0, FR = 1, HOUSEHOLDS = 2, POPULATION = 3, AR = 6;

function toNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/\s/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

export function parseHcp2014(bytes: Uint8Array): Map<string, Hcp2014Unit> {
  const out = new Map<string, Hcp2014Unit>();
  for (const row of readSheetRows(bytes)) {
    const code = row[CODE]?.trim();
    const nameFr = row[FR]?.trim();
    if (!code || !nameFr) continue;

    const digits = code.replace(/\D/g, "");
    if (digits.length !== 9) continue; // régions, provinces and cercles are shorter

    const kind = /Arrond/.test(nameFr)
      ? "arrondissement"
      : nameFr.includes("(Mun.)")
        ? "municipality"
        : "commune";

    out.set(digits, {
      codeDigits: digits,
      nameFr,
      nameAr: row[AR]?.trim() ?? "",
      kind,
      population: toNumber(row[POPULATION]),
      households: toNumber(row[HOUSEHOLDS]),
    });
  }
  return out;
}
