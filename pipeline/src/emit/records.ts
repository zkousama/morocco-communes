import { uniqueSlugs } from "../lib/slug.ts";
import type { Hierarchy } from "../build/hierarchy.ts";
import type { Hcp2014Unit } from "../sources/hcp2014.ts";
import type { OsmFeature } from "../build/osmJoin.ts";
import type { CrosswalkRow } from "../build/crosswalk.ts";

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
    change: { absolute: number; pct: number; basis: "exact_code" | "arrondissement_sum" | "crosswalk" } | null;
  };
  urbanCentres: { name: string; population: number | null }[];
  centroid: { lat: number; lng: number } | null;
  bbox: [number, number, number, number] | null;
  /** From the boundary, so ODbL like it. Null where there's no boundary. */
  areaKm2: number | null;
  /** People per km² in 2024: the census over the boundary's area. */
  density: number | null;
  osm: { relationId: number; wikidata: string | null } | null;
  provenance: { name: string; population2024: string; population2014: string | null; geometry: string | null };
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
const LABEL = /^(Communes?|Arrondissements?|Cercles?|Provinces?|Préfectures?|Régions?)\s+(de\s+la\s+|de\s+l['’]|de\s+|du\s+|des\s+|d['’])?/i;
const URBAN_CENTRE = /^dont le centre urbain\s+(de\s+la\s+|de\s+l['’]|de\s+|du\s+|des\s+|d['’])?/i;
// The Arabic column carries its own label word, one per level, and it has to come off
// too or every record ships a name meaning "commune Tanger" rather than "Tanger".
// Measured across the whole workbook: جهة 12, عمالة 21, إقليم 62, دائرة 213,
// جماعة 1503, مقاطعة 41. Nothing else appears in first position, and the only
// second-position labels are مقاطعات 6 and مقاطعة 2, inside Casablanca.
const LABEL_AR = /^(جهة|عمالة|إقليم|دائرة|جماعة|مقاطعات|مقاطعة)\s+/;
// The workbook marks four Western Sahara communes with a trailing asterisk, a footnote
// reference rather than part of the name. slugify already drops it, so leaving it here
// makes name and slug disagree. nameFrRaw keeps the row exactly as published.
const FOOTNOTE = /\*+$/;
const strip = (name: string) => {
  let out = name.replace(FOOTNOTE, "").trim();
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out.replace(LABEL, "").trim();
  }
  return out;
};
/**
 * Applied until it stops changing the string. Casablanca's eight préfectures
 * d'arrondissements carry a compound label, "عمالة مقاطعات X" for the six that group
 * several arrondissements and "عمالة مقاطعة X" for the two that group one, so a single
 * anchored replace removes only the outer word and leaves the inner one in the name.
 */
const stripAr = (name: string) => {
  let out = name.replace(FOOTNOTE, "").trim();
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out.replace(LABEL_AR, "").trim();
  }
  return out;
};
const stripUrbanCentre = (name: string) => name.replace(URBAN_CENTRE, "").trim();

/** What the matcher needs off a 2024 commune, and nothing more. */
export interface CrosswalkCandidate {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
  population: { "2024": { total: number | null } };
}

interface Prior {
  total: number | null;
  households: number | null;
  basis: "exact_code" | "arrondissement_sum" | "crosswalk";
}

/**
 * Resolves a commune's 2014 figure, trying three routes in order: the code that never
 * changed, the sum of the commune's own arrondissements, and the crosswalk.
 *
 * Extracted from `toRecords` because the crosswalk cannot be built until it is known
 * which communes need it, and asking that question used to mean building the whole
 * dataset with an empty crosswalk and throwing the result away.
 */
function priorResolver(
  h: Hierarchy,
  units2014: Map<string, Hcp2014Unit>,
  crosswalk: Map<string, CrosswalkRow>,
): (c: { code: string; codeDigits: string }) => Prior | null {
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

  return function priorFor(c: { code: string; codeDigits: string }): Prior | null {
    const direct = units2014.get(c.codeDigits);
    if (direct && direct.kind !== "arrondissement") {
      return { total: direct.population, households: direct.households, basis: "exact_code" };
    }
    const codes = arrondissementCodes.get(c.code) ?? [];
    if (codes.length > 0) {
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
    const mapped = crosswalk.get(c.codeDigits);
    if (mapped) {
      return {
        total: mapped.evidence.population2014,
        households: null,
        basis: "crosswalk",
      };
    }
    return null;
  };
}

/** The 2024 side of the crosswalk: who still needs a figure, and which codes are spent. */
export function crosswalkInputs(
  h: Hierarchy,
  units2014: Map<string, Hcp2014Unit>,
): { unresolved: CrosswalkCandidate[]; claimed: Set<string> } {
  const priorFor = priorResolver(h, units2014, new Map());
  const unresolved: CrosswalkCandidate[] = [];
  const claimed = new Set<string>();
  // Hierarchy order, because the matcher's exhaustion pass reads the remaining
  // candidates in the order it is given them.
  for (const c of h.communes) {
    if (priorFor(c) !== null) {
      claimed.add(c.codeDigits);
      continue;
    }
    unresolved.push({
      code: c.code,
      codeDigits: c.codeDigits,
      name: { fr: strip(c.nameFr), ar: stripAr(c.nameAr) },
      population: { "2024": { total: c.population } },
    });
  }
  return { unresolved, claimed };
}

export function toRecords(
  h: Hierarchy,
  units2014: Map<string, Hcp2014Unit>,
  osm: Map<string, OsmFeature> = new Map(),
  crosswalk: Map<string, CrosswalkRow> = new Map(),
  arrondissementOsm: Map<string, OsmFeature> = new Map(),
): DatasetRecords {
  const slugs = uniqueSlugs(h.communes.map((c) => ({ code: c.code, nameFr: c.nameFr })));
  const priorFor = priorResolver(h, units2014, crosswalk);

  const communes: CommuneRecord[] = h.communes.map((c) => {
    const usable = priorFor(c);
    const now = c.population;
    const before = usable?.total ?? null;
    const geo = osm.get(c.codeDigits) ?? null;
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
      urbanCentres: c.urbanCentres.map((u) => ({
        name: stripUrbanCentre(u.nameFr),
        population: u.population,
      })),
      centroid: geo?.centroid ?? null,
      bbox: geo?.bbox ?? null,
      areaKm2: geo ? Number(geo.areaKm2.toFixed(2)) : null,
      density: geo && now !== null ? Number((now / geo.areaKm2).toFixed(2)) : null,
      osm: geo ? { relationId: geo.relationId, wikidata: geo.wikidata } : null,
      provenance: {
        name: "hcp-2024",
        population2024: "hcp-2024",
        population2014: usable ? `hcp-2014:${usable.basis}` : null,
        geometry: geo ? "osm-odbl" : null,
      },
    };
  });

  // Every level carries the population HCP publishes for it. Dropping those would make a
  // consumer re-derive by summing children, which is both wasteful and a different number
  // wherever a parent includes something its children do not.
  const plain = (u: {
    code: string; codeDigits: string; nameFr: string; nameAr: string;
    population: number | null; moroccan: number | null; foreign: number | null; households: number | null;
  }) => ({
    code: u.code,
    codeDigits: u.codeDigits,
    name: { fr: strip(u.nameFr), ar: stripAr(u.nameAr) },
    population: {
      "2024": { total: u.population, moroccan: u.moroccan, foreign: u.foreign, households: u.households },
    },
    provenance: { name: "hcp-2024", population2024: "hcp-2024" },
  });

  const inRegion = (code: string) => communes.filter((c) => c.parents.region === code).length;
  const inProvince = (code: string) => communes.filter((c) => c.parents.province === code).length;
  const inCercle = (code: string) => communes.filter((c) => c.parents.cercle === code).length;

  return {
    regions: h.regions.map((r) => ({
      ...plain(r),
      provinceCount: h.provinces.filter((p) => p.regionCode === r.code && p.type !== "prefecture_of_arrondissements").length,
      communeCount: inRegion(r.code),
    })),
    provinces: h.provinces.map((p) => ({
      ...plain(p),
      type: p.type,
      regionCode: p.regionCode,
      cercleCount: h.cercles.filter((c) => c.provinceCode === p.code).length,
      communeCount: inProvince(p.code),
    })),
    cercles: h.cercles.map((c) => ({
      ...plain(c),
      regionCode: c.regionCode,
      provinceCode: c.provinceCode,
      communeCount: inCercle(c.code),
    })),
    communes,
    // The same geometry fields a commune has, from the admin_level 10 boundaries.
    arrondissements: h.arrondissements.map((a) => {
      const geo = arrondissementOsm.get(a.codeDigits) ?? null;
      const base = plain(a);
      return {
        ...base,
        communeCode: a.communeCode,
        prefectureOfArrondissementsCode: a.prefectureOfArrondissementsCode,
        centroid: geo?.centroid ?? null,
        bbox: geo?.bbox ?? null,
        areaKm2: geo ? Number(geo.areaKm2.toFixed(2)) : null,
        density: geo && a.population !== null ? Number((a.population / geo.areaKm2).toFixed(2)) : null,
        osm: geo ? { relationId: geo.relationId, wikidata: geo.wikidata } : null,
        provenance: { ...base.provenance, geometry: geo ? "osm-odbl" : null },
      };
    }),
  };
}
