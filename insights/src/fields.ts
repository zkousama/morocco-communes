/**
 * Every figure a unit can be found interesting by: the census indicators, the urban
 * housing stock and the establishments mapped alongside the census, kept to the rates and
 * shares a place's size doesn't skew. A raw count is left out, since a bigger commune
 * would only look more interesting for having more people in it.
 *
 * A field's path is the one the API already sorts communes by, so a finding here points
 * straight at `/api/communes?sort=`.
 */
import { readFileSync } from "node:fs";
import { COMPARABLE_2014, INDICATOR_PATHS } from "../../api/src/lib/indicators.ts";
import { ECONOMY_RATIOS, type EconomyRatio } from "../../api/src/lib/economy.ts";
import { ECONOMY_FIELDS, type EconomyField } from "../../pipeline/src/sources/economyFields.ts";

export type Level = "region" | "province" | "commune" | "arrondissement";

export interface Field {
  path: string; // the API's own names: "labour.unemploymentRate", "occupancy.tenant",
  // "housing.occupancy.unoccupied", "economy.per1000.jobs", "economy.share.sector.industry"
  label: { en: string; fr: string };
  unit: string; // "percent", "years", "births per woman", "per 1,000 people", ...
  topic: string; // "labour", "occupancy", ...
  source: "census" | "housing" | "economy";
  comparable: boolean; // has a 2014 value asked the same way
  slow: boolean; // languages, education, illiteracy, languages read and written
}

/** The topics that move slowly, a generation at a time rather than a census at a time. */
const SLOW_TOPICS = new Set(["localLanguages", "education", "illiteracy", "languagesReadAndWritten"]);

/** English first, then whichever of category, definedAs or the English label gives the French one. */
const frLabel = (entry: { label: string; category?: string; definedAs?: string }): string =>
  entry.category ?? entry.definedAs ?? entry.label;

/** One entry of a `fields.json` field list, census or housing. */
interface FieldEntry {
  path: string;
  topic: string;
  label: string;
  category?: string;
  definedAs?: string;
  unit: string;
}

const censusFieldsFile = JSON.parse(readFileSync("data/v1/indicators/fields.json", "utf8")) as {
  people: FieldEntry[];
  households: FieldEntry[];
};
const censusEntryByPath = new Map(
  [...censusFieldsFile.people, ...censusFieldsFile.households].map((f) => [f.path, f]),
);

/** Every census path the API sorts by, minus the raw people and household counts. */
const censusFields: Field[] = INDICATOR_PATHS.flatMap((path) => {
  const entry = censusEntryByPath.get(path);
  if (!entry || entry.unit === "people" || entry.unit === "households") return [];
  return [
    {
      path,
      label: { en: entry.label, fr: frLabel(entry) },
      unit: entry.unit,
      topic: entry.topic,
      source: "census" as const,
      comparable: COMPARABLE_2014.has(path),
      slow: SLOW_TOPICS.has(entry.topic),
    },
  ];
});

const housingFieldsFile = JSON.parse(readFileSync("data/v1/housing/fields.json", "utf8")) as {
  fields: FieldEntry[];
};

/** Every housing field but the dwelling count itself, which is a raw total, not a share. */
const housingFields: Field[] = housingFieldsFile.fields
  .filter((f) => f.path !== "dwellings.total")
  .map((f) => ({
    path: `housing.${f.path}`,
    label: { en: f.label, fr: frLabel(f) },
    unit: f.unit,
    topic: f.topic,
    source: "housing" as const,
    comparable: false,
    slow: false,
  }));

const economyFieldByPath = new Map<string, EconomyField>(ECONOMY_FIELDS.map((f) => [`economy.${f.topic}.${f.key}`, f]));

const ratioLabel = (ratio: EconomyRatio, of: EconomyField): string =>
  ratio.per === "population" ? `${of.label} per 1,000 people` : `${of.label} per business`;

const ratioUnit = (ratio: EconomyRatio): string => (ratio.per === "population" ? "per 1,000 people" : "jobs per business");

/** The 3 figures worked out from the establishment counts, rather than published. */
const economyRatioFields: Field[] = ECONOMY_RATIOS.map((ratio) => {
  const of = economyFieldByPath.get(ratio.of);
  if (!of) throw new Error(`economy ratio ${ratio.path} points at an unknown field ${ratio.of}`);
  const label = ratioLabel(ratio, of);
  return {
    path: ratio.path,
    label: { en: label, fr: label },
    unit: ratioUnit(ratio),
    topic: ratio.path.split(".")[1]!,
    source: "economy" as const,
    comparable: false,
    slow: false,
  };
});

const SHARE_TOPICS = new Set(["sector", "size", "founded"]);

/** The sector, size and founded-date splits, each as a share of the businesses. */
const economyShareFields: Field[] = ECONOMY_FIELDS.filter((f) => SHARE_TOPICS.has(f.topic)).map((f) => ({
  path: `economy.share.${f.topic}.${f.key}`,
  label: { en: f.label, fr: frLabel(f) },
  unit: "percent",
  topic: f.topic,
  source: "economy" as const,
  comparable: false,
  slow: false,
}));

export const FIELDS: Field[] = [...censusFields, ...housingFields, ...economyRatioFields, ...economyShareFields];

const fieldByPath = new Map(FIELDS.map((f) => [f.path, f]));

export function field(path: string): Field | undefined {
  return fieldByPath.get(path);
}

/** A path's prefix up to, not including, its last dot. */
const prefixOf = (path: string): string => path.slice(0, path.lastIndexOf("."));

/**
 * Every percent field grouped with the others that share its prefix: the age bands, the
 * dwelling types, the commute modes, a share and the total it's part of. A percent field
 * with no such sibling is alone in its own group.
 */
const families = new Map<string, Set<string>>();
for (const f of FIELDS) {
  if (f.unit !== "percent") continue;
  const prefix = prefixOf(f.path);
  const group = families.get(prefix) ?? new Set<string>();
  group.add(f.path);
  families.set(prefix, group);
}

export function familyOf(path: string): Set<string> {
  const group = families.get(prefixOf(path));
  return group?.has(path) ? new Set(group) : new Set([path]);
}

/** The shares hand-listed as adding up to another, since not every share does. */
const BREAKDOWNS: Record<string, string[]> = {
  "housing.occupancy.unoccupied": ["housing.occupancy.vacant", "housing.occupancy.seasonal"],
  "housing.type.precarious": ["housing.type.slum", "housing.type.ruralType", "housing.type.other"],
};

export function breakdownOf(path: string): string[] | null {
  return BREAKDOWNS[path] ?? null;
}
