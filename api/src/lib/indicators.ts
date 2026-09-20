import { ECONOMY_PATHS, economyProblem, economyValues, type EconomyRecord } from "./economy.ts";
import {
  HOUSEHOLD_FIELDS_2014_ALL as HOUSEHOLD_FIELDS_2014,
  HOUSEHOLD_FIELDS_ALL as HOUSEHOLD_FIELDS,
  PEOPLE_FIELDS_2014_ALL as PEOPLE_FIELDS_2014,
  PEOPLE_FIELDS_ALL as PEOPLE_FIELDS,
} from "../../../pipeline/src/sources/censusFields.ts";

/** A topic's figures by key, as the dataset stores them. Null where HCP publishes none. */
export type Topics = Record<string, Record<string, number | null>>;

/** One census's figures for a unit. */
export interface Census {
  people: Record<"total" | "urban" | "rural", Record<"all" | "male" | "female", Topics> | null>;
  households: Record<"total" | "urban" | "rural", Topics | null>;
}

/** One unit's indicators file, as data/v1/indicators holds it. */
export interface IndicatorRecord extends Census {
  code: string | null;
  codeDigits: string | null;
  level: string;
  name: { fr: string; ar: string | null };
  communeCode?: string;
  fromLocalAdministration: boolean;
  /** The 2014 census, for a unit it counted. Null for one it didn't. */
  "2014": Census | null;
}

/**
 * The figures a list of communes can be sorted by: every people field HCP gives for the
 * whole population, and every household field, each for the whole commune. A path is
 * topic.key, as in labour.unemploymentRate.
 */
export const INDICATOR_PATHS: string[] = [
  ...PEOPLE_FIELDS.filter((f) => f.sexes.includes("all")),
  ...HOUSEHOLD_FIELDS,
].map((f) => `${f.topic}.${f.key}`);

/**
 * The 2014 field that measures what a 2024 field measures, by the 2024 path. A topic that
 * changed its question between the censuses is left out, so nothing here subtracts two
 * figures that were never asked the same way.
 */
export const COMPARABLE_2014: Map<string, string> = new Map(
  [...PEOPLE_FIELDS_2014.filter((f) => f.sexes.includes("all")), ...HOUSEHOLD_FIELDS_2014]
    .filter((f) => f.comparableTo !== undefined && INDICATOR_PATHS.includes(f.comparableTo))
    .map((f) => [f.comparableTo!, `${f.topic}.${f.key}`]),
);

/**
 * Each way a list can be ordered by a figure: the 2024 census figure, the 2014 one, the
 * change between them, or one of the establishment counts.
 */
export const INDICATOR_SORTS: string[] = [
  ...INDICATOR_PATHS,
  ...[...COMPARABLE_2014.keys()].flatMap((path) => [`2014.${path}`, `change.${path}`]),
  ...ECONOMY_PATHS,
];

/** Each topic's keys, in HCP's order. */
export const TOPICS: Map<string, string[]> = new Map();
for (const path of INDICATOR_PATHS) {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  TOPICS.set(topic, [...(TOPICS.get(topic) ?? []), key]);
}

/** The topics of the people figures and of the household figures, in HCP's order. */
export const PEOPLE_TOPICS = [...new Set(PEOPLE_FIELDS.map((f) => f.topic))];
export const HOUSEHOLD_TOPICS = [...new Set(HOUSEHOLD_FIELDS.map((f) => f.topic))];

/**
 * Those figures for every commune, by code, in the order of `paths`. The 2014 census
 * carries the ones that can be read against 2024, so a list can be ordered by what a
 * commune was then or by how far it moved since.
 */
export interface IndicatorTable {
  paths: string[];
  values: Record<string, (number | null)[]>;
  paths2014: string[];
  values2014: Record<string, (number | null)[]>;
  /** The establishment counts, which the census's own workbooks don't hold. */
  pathsEconomy: string[];
  valuesEconomy: Record<string, (number | null)[]>;
  /** The communes whose establishment counts are a sum of their arrondissements. */
  summedEconomy: string[];
}

const readPaths = (census: Census | null, paths: string[]) => {
  const people = census?.people.total?.all ?? {};
  const homes = census?.households.total ?? {};
  return paths.map((path) => {
    const [topic, key] = path.split(/\.(.*)/s) as [string, string];
    return (people[topic] ?? homes[topic])?.[key] ?? null;
  });
};

export function buildIndicatorTable(records: IndicatorRecord[], economy: EconomyRecord[] = []): IndicatorTable {
  const paths2014 = [...COMPARABLE_2014.keys()];
  const columns2014 = [...COMPARABLE_2014.values()];
  const establishments = new Map(economy.map((r) => [r.code ?? "", r]));
  const values: IndicatorTable["values"] = {};
  const values2014: IndicatorTable["values2014"] = {};
  const valuesEconomy: IndicatorTable["valuesEconomy"] = {};
  const summedEconomy: string[] = [];
  for (const r of records) {
    values[r.code!] = readPaths(r, INDICATOR_PATHS);
    values2014[r.code!] = readPaths(r["2014"], columns2014);
    const counts = establishments.get(r.code!);
    valuesEconomy[r.code!] = economyValues(counts);
    if (counts?.basis === "arrondissement_sum") summedEconomy.push(r.code!);
  }
  return { paths: INDICATOR_PATHS, values, paths2014, values2014, pathsEconomy: ECONOMY_PATHS, valuesEconomy, summedEconomy };
}

/** The change in a figure between the censuses, to the decimal HCP publishes it at. */
export const changeBetween = (now: number | null, before: number | null): number | null =>
  now === null || before === null ? null : Math.round((now - before) * 100) / 100;

/**
 * Why a path isn't one, in words a model can act on: the keys of the topic it named, or
 * the topics when the topic itself is wrong.
 */
export function indicatorProblem(raw: string): string | null {
  if (INDICATOR_SORTS.includes(raw)) return null;
  if (raw.startsWith("economy.")) return economyProblem(raw);
  const census = /^(2014|change)\./.exec(raw);
  const path = census ? raw.slice(census[0].length) : raw;
  if (census && INDICATOR_PATHS.includes(path)) {
    return `${path} is a 2024 figure the 2014 census didn't ask the same way, so ${raw} isn't one to sort by`;
  }
  const [topic, key] = path.split(/\.(.*)/s);
  const keys = TOPICS.get(topic ?? "");
  if (keys) return `${topic} has no ${key ?? "key"}; its keys are ${keys.join(", ")}`;
  return `${path} isn't an indicator; the topics are ${[...TOPICS.keys()].join(", ")}`;
}
