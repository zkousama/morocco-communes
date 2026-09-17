import type { Hierarchy } from "../build/hierarchy.ts";
import type { Hcp2014Unit } from "../sources/hcp2014.ts";

const NATIONAL_POPULATION_2024 = 36_828_330;
const ARRONDISSEMENTS_BY_COMMUNE: Record<string, number> = {
  "06.141.01.0": 16, // Casablanca
  "03.231.01.0": 6,  // Fès
  "04.421.01.0": 5,  // Rabat
  "04.441.01.0": 5,  // Salé
  "07.351.01.0": 5,  // Marrakech
  "01.511.01.0": 4,  // Tanger
};

export function assertDataset(h: Hierarchy, units2014: Map<string, Hcp2014Unit>): void {
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

  if (fail.length > 0) throw new Error(`dataset assertions failed:\n  ${fail.join("\n  ")}`);
}
