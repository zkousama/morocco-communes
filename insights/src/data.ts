/**
 * Every unit's figures, read off the dataset the same way the pipeline and the API do:
 * `readLevel` for a level's records, whichever shape they come in, and each source
 * matched to a unit by code. Later tasks read only what's built here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readLevel } from "../../pipeline/src/lib/levels.ts";
import { ECONOMY_RATIOS, type EconomyRatio, type EconomyRecord } from "../../api/src/lib/economy.ts";
import { COMPARABLE_2014, type Census, type Topics } from "../../api/src/lib/indicators.ts";
import { FIELDS, type Field, type Level } from "./fields.ts";

export interface Unit {
  code: string;
  level: Level;
  name: { fr: string; ar: string | null };
  parent: string | null; // province for a commune, région for a province, city commune for an arrondissement
  population: { y2014: number | null; y2024: number };
  basis: "exact_code" | "crosswalk" | "arrondissement_sum" | null; // how its 2014 population was matched; null when unknown
  neighbours: string[]; // adjacency for communes; siblings under the same parent otherwise
  figures: { y2024: Record<string, number | null>; y2014: Record<string, number | null> };
}

export interface Data {
  version: string;
  units: Map<string, Unit>;
  byLevel: Map<Level, Unit[]>;
  country: Unit;
}

const LEVELS: Level[] = ["region", "province", "commune", "arrondissement"];
const LEVEL_FILE: Record<Level, string> = {
  region: "regions",
  province: "provinces",
  commune: "communes",
  arrondissement: "arrondissements",
};

/** A census record, as `data/v1/indicators` and `data/v1/indicators/2014` hold one. */
interface CensusRecord extends Census {
  code: string | null;
  name: { fr: string; ar: string | null };
}

/** A housing record, as `data/v1/housing` holds one. */
interface HousingRecord {
  code: string | null;
  topics: Topics;
}

/** A commune, province, région or arrondissement, as `data/v1/attributes` holds one. */
interface AttributeRecord {
  code: string;
  name: { fr: string; ar: string | null };
  population: {
    "2024": { total: number };
    "2014"?: { total: number | null } | null;
    change?: { basis: "exact_code" | "crosswalk" | "arrondissement_sum" } | null;
  };
  parents?: { province: string };
  regionCode?: string;
  communeCode?: string;
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A `topic.key` value off a census record, the way the API itself reads one. */
function censusValue(record: Census | null, path: string): number | null {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  const people = record?.people.total?.all ?? {};
  const homes = record?.households.total ?? {};
  return finite((people[topic] ?? homes[topic])?.[key]);
}

/** A `topic.key` value off a housing record's topics. */
function housingValue(record: HousingRecord | null, subPath: string): number | null {
  const [topic, key] = subPath.split(/\.(.*)/s) as [string, string];
  return finite(record?.topics[topic]?.[key]);
}

/** A sector, size or founded-date count as a share of the businesses. Null with no businesses. */
function economyShareValue(record: EconomyRecord | null, subPath: string): number | null {
  const business = record?.topics.establishments?.business;
  if (!business) return null;
  const [topic, key] = subPath.split(/\.(.*)/s) as [string, string];
  const count = record?.topics[topic]?.[key];
  if (count === null || count === undefined) return null;
  return Math.round((count / business) * 1000) / 10;
}

/** One of the 3 figures worked out from the establishment counts, the way the API divides them. */
function economyRatioValue(record: EconomyRecord | null, ratio: EconomyRatio, population: number): number | null {
  const [, topic, key] = ratio.of.split(".") as [string, string, string];
  const count = record?.topics[topic]?.[key];
  const per = ratio.per === "population" ? population : record?.topics.establishments?.business;
  if (count === null || count === undefined || !per) return null;
  const value = ratio.per === "population" ? (count / per) * 1000 : count / per;
  return Math.round(value * 10) / 10;
}

/** Every field's 2024 and 2014 value for one unit. A 2014 value lands under its 2024 path. */
function buildFigures(
  census: CensusRecord | null,
  census2014: CensusRecord | null,
  housing: HousingRecord | null,
  economy: EconomyRecord | null,
  population: number,
): Unit["figures"] {
  const y2024: Record<string, number | null> = {};
  const y2014: Record<string, number | null> = {};
  for (const f of FIELDS) {
    y2024[f.path] = valueOf(f, census, housing, economy, population);
    const path2014 = f.comparable ? COMPARABLE_2014.get(f.path) : undefined;
    y2014[f.path] = path2014 ? censusValue(census2014, path2014) : null;
  }
  return { y2024, y2014 };
}

function valueOf(f: Field, census: CensusRecord | null, housing: HousingRecord | null, economy: EconomyRecord | null, population: number): number | null {
  if (f.source === "census") return censusValue(census, f.path);
  if (f.source === "housing") return housingValue(housing, f.path.slice("housing.".length));
  if (f.path.startsWith("economy.share.")) return economyShareValue(economy, f.path.slice("economy.share.".length));
  const ratio = ECONOMY_RATIOS.find((r) => r.path === f.path);
  if (!ratio) throw new Error(`${f.path} is an economy field with no ratio to compute it from`);
  return economyRatioValue(economy, ratio, population);
}

function indexByCode<T extends { code: string | null }>(records: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of records) if (r.code) map.set(r.code, r);
  return map;
}

function parentOf(level: Level, attr: AttributeRecord): string | null {
  if (level === "commune") return attr.parents!.province;
  if (level === "province") return attr.regionCode!;
  if (level === "arrondissement") return attr.communeCode!;
  return null;
}

/** dir defaults to "data/v1" */
export function loadData(dir = "data/v1"): Data {
  const indicatorsDir = join(dir, "indicators");
  const indicators2014Dir = join(indicatorsDir, "2014");
  const housingDir = join(dir, "housing");
  const economyDir = join(dir, "economy");
  const attributesDir = join(dir, "attributes");

  const sources = JSON.parse(readFileSync(join(dir, "sources.json"), "utf8")) as { datasetVersion: string };
  const adjacency = JSON.parse(readFileSync(join(dir, "geometry", "adjacency.json"), "utf8")) as {
    code: string;
    neighbours: { code: string; km: number }[];
  }[];
  const adjacencyByCode = new Map(adjacency.map((a) => [a.code, a.neighbours.map((n) => n.code)]));

  const units = new Map<string, Unit>();
  const byLevel = new Map<Level, Unit[]>();

  for (const level of LEVELS) {
    const name = LEVEL_FILE[level];
    const censusByCode = indexByCode(readLevel<CensusRecord>(indicatorsDir, name));
    const census2014ByCode = indexByCode(readLevel<CensusRecord>(indicators2014Dir, name));
    const housingByCode = indexByCode(readLevel<HousingRecord>(housingDir, name));
    const economyByCode = indexByCode(readLevel<EconomyRecord>(economyDir, name));
    const attributes = readLevel<AttributeRecord>(attributesDir, name);

    const list = attributes.map((attr): Unit => {
      const population2024 = attr.population["2024"].total;
      const isCommune = level === "commune";
      const population2014 = isCommune ? (attr.population["2014"]?.total ?? null) : null;
      const basis = isCommune ? (attr.population.change?.basis ?? null) : null;
      return {
        code: attr.code,
        level,
        name: { fr: attr.name.fr, ar: attr.name.ar ?? null },
        parent: parentOf(level, attr),
        population: { y2014: population2014, y2024: population2024 },
        basis,
        neighbours: isCommune ? (adjacencyByCode.get(attr.code) ?? []) : [],
        figures: buildFigures(
          censusByCode.get(attr.code) ?? null,
          census2014ByCode.get(attr.code) ?? null,
          housingByCode.get(attr.code) ?? null,
          economyByCode.get(attr.code) ?? null,
          population2024,
        ),
      };
    });

    byLevel.set(level, list);
    for (const unit of list) units.set(unit.code, unit);
  }

  // A commune's neighbours are the adjacency list's; every other level's are the other
  // units under its own parent, region included, where every région shares the same
  // (null) parent and so is neighbour to every other région.
  for (const level of LEVELS) {
    if (level === "commune") continue;
    const list = byLevel.get(level)!;
    const byParent = new Map<string | null, string[]>();
    for (const unit of list) byParent.set(unit.parent, [...(byParent.get(unit.parent) ?? []), unit.code]);
    for (const unit of list) unit.neighbours = (byParent.get(unit.parent) ?? []).filter((code) => code !== unit.code);
  }

  const census = readLevel<CensusRecord>(indicatorsDir, "national")[0]!;
  const census2014 = readLevel<CensusRecord>(indicators2014Dir, "national")[0] ?? null;
  const housing = readLevel<HousingRecord>(housingDir, "national")[0] ?? null;
  const economy = readLevel<EconomyRecord>(economyDir, "national")[0] ?? null;
  const countryPopulation = censusValue(census, "population.legal") ?? 0;
  const country: Unit = {
    code: "MA",
    // "country" isn't one of the 4 levels a unit can be; nothing reads this one back by
    // level, since `country` sits apart from `units` and `byLevel`.
    level: "region",
    name: { fr: census.name.fr, ar: census.name.ar },
    parent: null,
    population: { y2014: null, y2024: countryPopulation },
    basis: null,
    neighbours: [],
    figures: buildFigures(census, census2014, housing, economy, countryPopulation),
  };

  return { version: sources.datasetVersion, units, byLevel, country };
}
