import { uniqueSlugs } from "../lib/slug.ts";
import type { Hierarchy } from "../build/hierarchy.ts";
import type { Hcp2014Unit } from "../sources/hcp2014.ts";

export interface CommuneRecord {
  code: string;
  codeDigits: string;
  slug: string;
  nameFrRaw: string;
  name: { fr: string; ar: string };
  type: "urban" | "rural";
  parents: { region: string; province: string; cercle: string | null };
  population: {
    "2024": { total: number | null; moroccan: number | null; foreign: number | null; households: number | null };
    "2014": { total: number | null; households: number | null } | null;
    change: { absolute: number; pct: number; basis: "exact_code" | "arrondissement_sum" } | null;
  };
  urbanCentre: { name: string; population: number | null } | null;
  provenance: { name: string; population2024: string; population2014: string | null };
}

export interface DatasetRecords {
  regions: unknown[];
  provinces: unknown[];
  cercles: unknown[];
  communes: CommuneRecord[];
  arrondissements: unknown[];
}

// Plurals matter and the strip repeats, for the same reason the Arabic one does:
// Casablanca's eight groupings are labelled twice, "Préfecture d'arrondissements de X".
// One pass leaves "arrondissements de X" standing as the name.
const LABEL = /^(Communes?|Arrondissements?|Cercles?|Provinces?|Préfectures?|Régions?)\s+(de\s+la\s+|de\s+l['\u2019]|de\s+|du\s+|des\s+|d['\u2019])?/i;
const URBAN_CENTRE = /^dont le centre urbain\s+(de\s+la\s+|de\s+l['\u2019]|de\s+|du\s+|des\s+|d['\u2019])?/i;
// The Arabic column carries its own label word, one per level, and it has to come off
// too or every record ships a name meaning "commune Tanger" rather than "Tanger".
// Measured across the whole workbook: جهة 12, عمالة 21, إقليم 62, دائرة 213,
// جماعة 1503, مقاطعة 41. Nothing else appears in first position, and the only
// second-position labels are مقاطعات 6 and مقاطعة 2, inside Casablanca.
const LABEL_AR = /^(جهة|عمالة|إقليم|دائرة|جماعة|مقاطعات|مقاطعة)\s+/;
const strip = (name: string) => {
  let out = name.trim();
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out.replace(LABEL, "").trim();
  }
  return out;
};
/**
 * Applied until it stops changing the string. Casablanca's eight préfectures
 * d'arrondissements carry a compound label — "عمالة مقاطعات X" for the six that group
 * several arrondissements, "عمالة مقاطعة X" for the two that group one — so a single
 * anchored replace removes only the outer word and leaves the inner one in the name.
 */
const stripAr = (name: string) => {
  let out = name.trim();
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out.replace(LABEL_AR, "").trim();
  }
  return out;
};
const stripUrbanCentre = (name: string) => name.replace(URBAN_CENTRE, "").trim();

interface Prior {
  total: number | null;
  households: number | null;
  basis: "exact_code" | "arrondissement_sum";
}

export function toRecords(h: Hierarchy, units2014: Map<string, Hcp2014Unit>): DatasetRecords {
  const slugs = uniqueSlugs(h.communes.map((c) => ({ code: c.code, nameFr: c.nameFr })));

  // The six arrondissement-bearing cities have no commune row in the 2014 workbook,
  // because that tier did not exist for them then: the 2014 hierarchy runs préfecture →
  // préfecture d'arrondissements → arrondissement with nothing in between. All 41
  // arrondissements do join by code across both censuses, so those cities' 2014 figure
  // is the exact sum of their own arrondissements. That is an aggregation of sourced
  // values, not an estimate, and it is labelled differently so a consumer can tell.
  const arrondissementCodes = new Map<string, string[]>();
  for (const a of h.arrondissements) {
    const list = arrondissementCodes.get(a.communeCode) ?? [];
    list.push(a.codeDigits);
    arrondissementCodes.set(a.communeCode, list);
  }

  function priorFor(c: { code: string; codeDigits: string }): Prior | null {
    const direct = units2014.get(c.codeDigits);
    if (direct && direct.kind !== "arrondissement") {
      return { total: direct.population, households: direct.households, basis: "exact_code" };
    }
    const codes = arrondissementCodes.get(c.code) ?? [];
    if (codes.length === 0) return null;
    const parts = codes.map((code) => units2014.get(code));
    if (parts.some((p) => p === undefined || p.population === null)) return null;
    const households = parts.every((p) => p!.households !== null)
      ? parts.reduce((n, p) => n + p!.households!, 0)
      : null;
    return {
      total: parts.reduce((n, p) => n + p!.population!, 0),
      households,
      basis: "arrondissement_sum",
    };
  }

  const communes: CommuneRecord[] = h.communes.map((c) => {
    const usable = priorFor(c);
    const now = c.population;
    const before = usable?.total ?? null;
    return {
      code: c.code,
      codeDigits: c.codeDigits,
      slug: slugs.get(c.code)!,
      nameFrRaw: c.nameFr,
      name: { fr: strip(c.nameFr), ar: stripAr(c.nameAr) },
      type: c.type,
      parents: { region: c.regionCode, province: c.provinceCode, cercle: c.cercleCode },
      population: {
        "2024": { total: now, moroccan: c.moroccan, foreign: c.foreign, households: c.households },
        "2014": usable ? { total: usable.total, households: usable.households } : null,
        change:
          now !== null && before !== null && before > 0
            ? {
                absolute: now - before,
                pct: Number((((now - before) / before) * 100).toFixed(2)),
                basis: usable!.basis,
              }
            : null,
      },
      urbanCentre: c.urbanCentre
        ? { name: stripUrbanCentre(c.urbanCentre.nameFr), population: c.urbanCentre.population }
        : null,
      provenance: {
        name: "hcp-2024",
        population2024: "hcp-2024",
        population2014: usable ? `hcp-2014:${usable.basis}` : null,
      },
    };
  });

  const plain = (u: { code: string; nameFr: string; nameAr: string }) => ({
    code: u.code,
    name: { fr: strip(u.nameFr), ar: stripAr(u.nameAr) },
  });

  return {
    regions: h.regions.map((r) => ({ ...plain(r), communeCount: communes.filter((c) => c.parents.region === r.code).length })),
    provinces: h.provinces.map((p) => ({ ...plain(p), type: p.type, regionCode: p.regionCode })),
    cercles: h.cercles.map((c) => ({ ...plain(c), regionCode: c.regionCode, provinceCode: c.provinceCode })),
    communes,
    arrondissements: h.arrondissements.map((a) => ({
      ...plain(a),
      communeCode: a.communeCode,
      prefectureOfArrondissementsCode: a.prefectureOfArrondissementsCode,
    })),
  };
}
