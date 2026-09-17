import { toDigits, toDotted, formatRegion, formatProvince } from "../lib/codes.ts";
import type { RawRow } from "./types.ts";

export interface Unit {
  code: string; codeDigits: string; nameFr: string; nameAr: string;
  population: number | null; moroccan: number | null; foreign: number | null; households: number | null;
}
export type ProvinceType = "province" | "prefecture" | "prefecture_of_arrondissements";
export interface Province extends Unit { type: ProvinceType; regionCode: string }
export interface Cercle extends Unit { regionCode: string; provinceCode: string }
export interface Commune extends Unit {
  type: "urban" | "rural";
  regionCode: string; provinceCode: string; cercleCode: string | null;
  urbanCentre: { nameFr: string; population: number | null } | null;
}
export interface Arrondissement extends Unit {
  communeCode: string; prefectureOfArrondissementsCode: string | null;
  regionCode: string; provinceCode: string;
}
export interface Hierarchy {
  regions: Unit[]; provinces: Province[]; cercles: Cercle[];
  communes: Commune[]; arrondissements: Arrondissement[];
}

function base(row: RawRow, code: string): Unit {
  return {
    code,
    codeDigits: toDigits(row.code!),
    nameFr: row.nameFr,
    nameAr: row.nameAr,
    population: row.population,
    moroccan: row.moroccan,
    foreign: row.foreign,
    households: row.households,
  };
}

export function buildHierarchy(rows: RawRow[]): Hierarchy {
  const out: Hierarchy = { regions: [], provinces: [], cercles: [], communes: [], arrondissements: [] };

  let regionRaw: string | null = null;
  let regionCode: string | null = null;
  let provinceRaw: string | null = null;
  let provinceCode: string | null = null;
  let cercleCode: string | null = null;
  let poaRaw: string | null = null;
  let poaCode: string | null = null;
  let commune: Commune | null = null;

  for (const row of rows) {
    if (row.kind === "national" || !row.code) continue;

    switch (row.kind) {
      case "region": {
        regionRaw = row.code;
        regionCode = formatRegion(row.code);
        provinceRaw = provinceCode = cercleCode = poaRaw = poaCode = null;
        commune = null;
        out.regions.push({ ...base(row, regionCode), codeDigits: regionCode });
        break;
      }
      case "province":
      case "prefecture": {
        if (!regionRaw) throw new Error(`province before any région: ${row.nameFr}`);
        provinceRaw = row.code;
        provinceCode = formatProvince(row.code);
        cercleCode = poaRaw = poaCode = null;
        commune = null;
        out.provinces.push({
          ...base(row, provinceCode),
          codeDigits: row.code.replace(/\D/g, "").padStart(5, "0"),
          type: row.kind === "prefecture" ? "prefecture" : "province",
          regionCode: regionCode!,
        });
        break;
      }
      case "prefectureOfArrondissements": {
        // Sits inside a commune. Leaves province and cercle untouched on purpose.
        if (!provinceRaw) throw new Error(`préfecture d'arrondissements before any province: ${row.nameFr}`);
        poaRaw = row.code;
        poaCode = toDotted(row.code, provinceRaw);
        out.provinces.push({
          ...base(row, poaCode),
          type: "prefecture_of_arrondissements",
          regionCode: regionCode!,
        });
        break;
      }
      case "cercle": {
        if (!provinceRaw) throw new Error(`cercle before any province: ${row.nameFr}`);
        cercleCode = toDotted(row.code, provinceRaw);
        poaRaw = poaCode = null;
        commune = null;
        out.cercles.push({
          ...base(row, cercleCode),
          codeDigits: row.code.replace(/\D/g, "").padStart(7, "0"),
          regionCode: regionCode!,
          provinceCode: provinceCode!,
        });
        break;
      }
      case "commune": {
        if (!provinceRaw) throw new Error(`commune before any province: ${row.nameFr}`);
        poaRaw = poaCode = null;
        commune = {
          ...base(row, toDotted(row.code, provinceRaw)),
          type: cercleCode ? "rural" : "urban",
          regionCode: regionCode!,
          provinceCode: provinceCode!,
          cercleCode,
          urbanCentre: null,
        };
        out.communes.push(commune);
        break;
      }
      case "arrondissement": {
        if (!commune) throw new Error(`arrondissement with no enclosing commune: ${row.nameFr}`);
        out.arrondissements.push({
          ...base(row, toDotted(row.code, provinceRaw!)),
          communeCode: commune.code,
          prefectureOfArrondissementsCode: poaCode,
          regionCode: regionCode!,
          provinceCode: provinceCode!,
        });
        break;
      }
      case "urbanCentre": {
        if (commune) commune.urbanCentre = { nameFr: row.nameFr, population: row.population };
        break;
      }
    }
  }

  return out;
}
