/**
 * HCP's census indicators, read once at build time for the région, province and commune
 * pages. Each record carries 2014 beside 2024, where the census counted the unit.
 */
import { readFileSync } from "node:fs";
import { COMPARABLE_2014, type Census, type IndicatorRecord, type Topics } from "../../../api/src/lib/indicators.ts";

const read = (name: string, census = ".") =>
  JSON.parse(readFileSync(`data/v1/indicators/${census}/${name}.json`, "utf8"));

const LEVELS = ["regions", "provinces", "communes"];
const before = new Map<string, Census>(
  LEVELS.flatMap((name) => read(name, "2014") as IndicatorRecord[]).map((r) => [r.code!, { people: r.people, households: r.households }]),
);
const withPrior = (r: IndicatorRecord): IndicatorRecord => ({ ...r, "2014": before.get(r.code!) ?? null });

const nation = read("national") as IndicatorRecord;
const nationBefore = read("national", "2014") as IndicatorRecord;
export const national: IndicatorRecord = { ...nation, "2014": { people: nationBefore.people, households: nationBefore.households } };
export const indicatorsOf = new Map(
  ([...read("regions"), ...read("provinces"), ...read("communes")] as IndicatorRecord[]).map((r) => [r.code!, withPrior(r)]),
);

/** A figure off one block, or null. */
export const figure = (topics: Topics | null | undefined, path: string): number | null => {
  const [topic, key] = path.split(/\.(.*)/s) as [string, string];
  return topics?.[topic]?.[key] ?? null;
};

/** The same figure at the 2014 census, for a figure the two censuses ask the same way. */
export const figureIn2014 = (record: IndicatorRecord, path: string, homes = false): number | null => {
  const path2014 = COMPARABLE_2014.get(path);
  if (!path2014 || !record["2014"]) return null;
  const census = record["2014"];
  return figure(homes ? census.households.total : census.people.total?.all, path2014);
};

export type { Census, IndicatorRecord, Topics };
