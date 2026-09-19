import { HOUSEHOLD_FIELDS, PEOPLE_FIELDS } from "../../../pipeline/src/sources/indicatorFields.ts";

/** A topic's figures by key, as the dataset stores them. Null where HCP publishes none. */
export type Topics = Record<string, Record<string, number | null>>;

/** One unit's indicators file, as data/v1/indicators holds it. */
export interface IndicatorRecord {
  code: string | null;
  codeDigits: string | null;
  level: string;
  name: { fr: string; ar: string | null };
  communeCode?: string;
  fromLocalAdministration: boolean;
  people: Record<"total" | "urban" | "rural", Record<"all" | "male" | "female", Topics> | null>;
  households: Record<"total" | "urban" | "rural", Topics | null>;
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

/** Each topic's keys, in HCP's order. */
export const TOPICS: Map<string, string[]> = new Map();
for (const path of INDICATOR_PATHS) {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  TOPICS.set(topic, [...(TOPICS.get(topic) ?? []), key]);
}

/** The topics of the people figures and of the household figures, in HCP's order. */
export const PEOPLE_TOPICS = [...new Set(PEOPLE_FIELDS.map((f) => f.topic))];
export const HOUSEHOLD_TOPICS = [...new Set(HOUSEHOLD_FIELDS.map((f) => f.topic))];

/** Those figures for every commune, by code, in the order of `paths`. */
export interface IndicatorTable {
  paths: string[];
  values: Record<string, (number | null)[]>;
}

export function buildIndicatorTable(records: IndicatorRecord[]): IndicatorTable {
  const values: IndicatorTable["values"] = {};
  for (const r of records) {
    const people = r.people.total?.all ?? {};
    const homes = r.households.total ?? {};
    values[r.code!] = INDICATOR_PATHS.map((path) => {
      const [topic, key] = path.split(/\.(.*)/s) as [string, string];
      return (people[topic] ?? homes[topic])?.[key] ?? null;
    });
  }
  return { paths: INDICATOR_PATHS, values };
}

/**
 * Why a path isn't one, in words a model can act on: the keys of the topic it named, or
 * the topics when the topic itself is wrong.
 */
export function indicatorProblem(path: string): string | null {
  if (INDICATOR_PATHS.includes(path)) return null;
  const [topic, key] = path.split(/\.(.*)/s);
  const keys = TOPICS.get(topic ?? "");
  if (keys) return `${topic} has no ${key ?? "key"}; its keys are ${keys.join(", ")}`;
  return `${path} isn't an indicator; the topics are ${[...TOPICS.keys()].join(", ")}`;
}
