import type { Hierarchy } from "../build/hierarchy.ts";
import type { Hcp2014Unit } from "../sources/hcp2014.ts";
import type { OsmFeature } from "../build/osmJoin.ts";
import type { CrosswalkRow } from "../build/crosswalk.ts";
import { pointInRing } from "../geo/point.ts";
import { ringArea } from "../geo/rings.ts";
import { findAnomalies } from "../emit/topojson.ts";

const NATIONAL_POPULATION_2024 = 36_828_330;
const ARRONDISSEMENTS_BY_COMMUNE: Record<string, number> = {
  "06.141.01.0": 16, // Casablanca
  "03.231.01.0": 6,  // Fès
  "04.421.01.0": 5,  // Rabat
  "04.441.01.0": 5,  // Salé
  "07.351.01.0": 5,  // Marrakech
  "01.511.01.0": 4,  // Tanger
};

export const KNOWN_UNMAPPED = new Set([
  // relation 5962436 holds a single admin_centre node and no ways
  "04.281.05.11", // Sidi Mohamed Benmansour
]);

export function checkGeometry(
  communes: { code: string; nameFr: string; codeDigits: string }[],
  osm: Map<string, OsmFeature>,
): string[] {
  const fail: string[] = [];
  for (const c of communes) {
    const f = osm.get(c.codeDigits);
    if (!f) {
      if (!KNOWN_UNMAPPED.has(c.code)) {
        fail.push(`${c.nameFr} (${c.code}) has no geometry and is not on the unmapped allowlist`);
      }
      continue;
    }
    if (f.outer.length === 0) {
      fail.push(`${c.nameFr} has no outer ring`);
      continue;
    }
    const largest = f.outer.reduce((a, b) => (ringArea(a) >= ringArea(b) ? a : b));
    if (!pointInRing([f.centroid.lng, f.centroid.lat], largest)) {
      fail.push(`${c.nameFr} has an interior point outside its own boundary`);
    }
    const [w, s, e, n] = f.bbox;
    if (!(w >= -18 && e <= 0 && s >= 20 && n <= 37)) {
      fail.push(`${c.nameFr} has a bbox outside Morocco: ${f.bbox.join(", ")}`);
    }
    // The smallest communes, Méchouar de Casablanca and Moulay Yacoub, are under half a km²;
    // the largest run to tens of thousands. Outside that, the rings are wrong.
    if (!(f.areaKm2 > 0.1 && f.areaKm2 < 60_000)) {
      fail.push(`${c.nameFr} has an area of ${f.areaKm2} km², which no commune has`);
    }
  }
  return fail;
}

export function assertDataset(
  h: Hierarchy,
  units2014: Map<string, Hcp2014Unit>,
  osm: Map<string, OsmFeature> = new Map(),
  crosswalk: CrosswalkRow[] = [],
): void {
  const fail: string[] = [];
  const check = (ok: boolean, message: string) => { if (!ok) fail.push(message); };

  const plainProvinces = h.provinces.filter((p) => p.type !== "prefecture_of_arrondissements");
  const grouped = h.provinces.filter((p) => p.type === "prefecture_of_arrondissements");

  check(h.regions.length === 12, `expected 12 régions, got ${h.regions.length}`);
  check(plainProvinces.length === 75, `expected 75 provinces and préfectures, got ${plainProvinces.length}`);
  check(grouped.length === 8, `expected 8 préfectures d'arrondissements, got ${grouped.length}`);
  check(h.cercles.length === 213, `expected 213 cercles, got ${h.cercles.length}`);
  check(h.communes.length === 1503, `expected 1503 communes, got ${h.communes.length}`);
  check(h.arrondissements.length === 41, `expected 41 arrondissements, got ${h.arrondissements.length}`);

  const total = h.communes.reduce((n, c) => n + (c.population ?? 0), 0);
  check(total === NATIONAL_POPULATION_2024, `commune populations sum to ${total}, expected ${NATIONAL_POPULATION_2024}`);

  // Catches the Méchouar mis-parenting: a province code is always five digits.
  // The set membership checks are the stronger form — a well-shaped code that names
  // nothing is still a broken parent.
  const regionCodes = new Set(h.regions.map((r) => r.code));
  const provinceCodes = new Set(h.provinces.map((p) => p.code));
  const cercleCodes = new Set(h.cercles.map((c) => c.code));
  for (const c of h.communes) {
    check(c.provinceCode.replace(/\D/g, "").length === 5, `${c.nameFr} has province code ${c.provinceCode}`);
    check(regionCodes.has(c.regionCode), `${c.nameFr} names unknown région ${c.regionCode}`);
    check(provinceCodes.has(c.provinceCode), `${c.nameFr} names unknown province ${c.provinceCode}`);
    check(c.type === "rural" ? c.cercleCode !== null : c.cercleCode === null,
      `${c.nameFr} is ${c.type} but cercle is ${c.cercleCode}`);
    if (c.cercleCode !== null) {
      check(cercleCodes.has(c.cercleCode), `${c.nameFr} names unknown cercle ${c.cercleCode}`);
    }
  }

  // 164 urban-centre rows across 160 communes. Without this, a changed label in the
  // source would silently null every one of them and no other assertion would notice.
  const centres = h.communes.reduce((n, c) => n + c.urbanCentres.length, 0);
  check(centres === 164, `expected 164 urban centres, got ${centres}`);
  const withCentre = h.communes.filter((c) => c.urbanCentres.length > 0).length;
  check(withCentre === 160, `expected 160 communes with an urban centre, got ${withCentre}`);

  const urban = h.communes.filter((c) => c.type === "urban").length;
  check(urban === 242, `expected 242 urban communes, got ${urban}`);
  check(h.communes.length - urban === 1261, `expected 1261 rural communes, got ${h.communes.length - urban}`);

  const communeCodes = new Set(h.communes.map((c) => c.code));
  const tally: Record<string, number> = {};
  for (const a of h.arrondissements) {
    check(communeCodes.has(a.communeCode), `${a.nameFr} points at unknown commune ${a.communeCode}`);
    tally[a.communeCode] = (tally[a.communeCode] ?? 0) + 1;
  }
  for (const [code, expected] of Object.entries(ARRONDISSEMENTS_BY_COMMUNE)) {
    check(tally[code] === expected, `commune ${code} has ${tally[code] ?? 0} arrondissements, expected ${expected}`);
  }

  // Listed explicitly rather than walked with Object.entries and a cast. A cast would
  // turn a future non-array field on Hierarchy into a raw TypeError thrown from inside
  // this function, which is the one thing it must never do: every problem has to arrive
  // through check() so the caller gets the whole list at once.
  const levels: [string, { code: string }[]][] = [
    ["regions", h.regions],
    ["provinces", h.provinces],
    ["cercles", h.cercles],
    ["communes", h.communes],
    ["arrondissements", h.arrondissements],
  ];
  for (const [level, units] of levels) {
    const seen = new Set<string>();
    for (const u of units) {
      check(!seen.has(u.code), `duplicate code ${u.code} in ${level}`);
      seen.add(u.code);
    }
  }

  let shared = 0;
  for (const c of h.communes) {
    const prior = units2014.get(c.codeDigits);
    if (!prior || prior.kind === "arrondissement") continue;
    shared++;
    check((c.type === "urban") === (prior.kind === "municipality"),
      `${c.nameFr} is ${c.type} in 2024 but ${prior.kind} in 2014`);
  }
  check(shared === 1290, `expected 1290 codes shared with 2014, got ${shared}`);

  // Geometry checks only run when geometry was built. They assert what is
  // structurally true rather than how many communes currently carry a tag:
  // OSM changes daily and a tag count is not a build gate.
  if (osm.size > 0) {
    for (const message of checkGeometry(h.communes, osm)) check(false, message);
    for (const a of findAnomalies([...osm.values()])) {
      check(false, `geometry anomaly ${a.kind} on ${a.code}: ${a.detail}`);
    }
  }

  if (crosswalk.length > 0) {
    check(crosswalk.length === 207, `expected 207 crosswalk rows, got ${crosswalk.length}`);

    // A bijection: no 2024 code and no 2014 code may appear twice.
    const seen2024 = new Set<string>();
    const seen2014 = new Set<string>();
    for (const r of crosswalk) {
      check(!seen2024.has(r.code2024), `crosswalk claims ${r.code2024} twice`);
      check(!seen2014.has(r.code2014), `crosswalk claims 2014 code ${r.code2014} twice`);
      seen2024.add(r.code2024);
      seen2014.add(r.code2014);
      check(r.evidence.province === r.codeDigits2024.slice(0, 5),
        `crosswalk row ${r.code2024} records a province that does not match its own code`);
    }

    const byMethod = crosswalk.filter((r) => r.method === "exact_name_in_province").length;
    check(byMethod === 203, `expected 203 rows matched by name, got ${byMethod}`);

    // Count by route, not by computable change: 4 communes carry `pm` in the 2014
    // source, so they have a 2014 object with a null total and no change. A check
    // written against change.basis would be off by exactly those 4.
    const byRoute = h.communes.filter((c) => units2014.has(c.codeDigits)).length;
    check(byRoute === 1290, `expected 1290 communes joining 2014 by exact code, got ${byRoute}`);

    // Every commune should now have a 2014 figure by one of the three routes.
    const missing = h.communes.filter(
      (c) => !units2014.has(c.codeDigits) && !crosswalk.some((r) => r.codeDigits2024 === c.codeDigits),
    );
    check(missing.length <= 6,
      `${missing.length} communes still have no 2014 route; only the 6 arrondissement-bearing cities should`);
  }

  if (fail.length > 0) throw new Error(`dataset assertions failed:\n  ${fail.join("\n  ")}`);
}

/**
 * The arrondissement boundaries have to account for the cities they divide: every one of
 * them matched, each one's interior point inside its own commune, and together about the
 * commune's area. The last catches a city mapped with a piece missing.
 */
export function checkArrondissements(
  arrondissements: { code: string; codeDigits: string; communeCode: string; nameFr: string }[],
  features: Map<string, OsmFeature>,
  communes: Map<string, OsmFeature>,
  communeDigits: Map<string, string>,
): string[] {
  const fail: string[] = [];
  const areaByCommune = new Map<string, number>();
  for (const a of arrondissements) {
    const f = features.get(a.codeDigits);
    if (!f) {
      fail.push(`${a.nameFr} (${a.code}) has no boundary`);
      continue;
    }
    const commune = communes.get(communeDigits.get(a.communeCode)!);
    if (!commune) {
      fail.push(`${a.nameFr} (${a.code}) belongs to ${a.communeCode}, which has no boundary`);
      continue;
    }
    if (!commune.outer.some((ring) => pointInRing([f.centroid.lng, f.centroid.lat], ring))) {
      fail.push(`${a.nameFr} (${a.code}) lies outside its commune ${a.communeCode}`);
    }
    areaByCommune.set(a.communeCode, (areaByCommune.get(a.communeCode) ?? 0) + f.areaKm2);
  }
  for (const [code, area] of areaByCommune) {
    const whole = communes.get(communeDigits.get(code)!)!.areaKm2;
    if (Math.abs(area - whole) / whole > 0.01) {
      fail.push(`the arrondissements of ${code} cover ${area.toFixed(1)} km² of its ${whole.toFixed(1)} km²`);
    }
  }
  return fail;
}
