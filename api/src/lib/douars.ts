import { existsSync, readFileSync } from "node:fs";
import { DOUAR_FIELDS } from "../../../pipeline/src/sources/douarFields.ts";
import type { Topics } from "./indicators.ts";

/** One douar, as data/v1/douars holds it. */
export interface DouarRecord {
  code: string;
  communeCode: string;
  fraction: string;
  name: { ar: string };
  type: "grouped" | "split" | "dispersed";
  households: number;
  population: number;
  /** Null where HCP withholds them, for a douar of fewer than 30 households. */
  topics: Topics | null;
  /** A place GeoNames or OpenStreetMap maps in the same commune under its name, where one does. */
  place?: DouarPlace;
}

/** A douar's Latin name and point, from the place matched to it (api/data/douar-places.json). */
export interface DouarPlace {
  name: string;
  source: "osm" | "geonames";
  lat: number;
  lng: number;
}

/** The matched places by douar code, or none before api:douar-places has run. */
export function readDouarPlaces(path = "api/data/douar-places.json"): Map<string, DouarPlace> {
  if (!existsSync(path)) return new Map();
  const rows = (JSON.parse(readFileSync(path, "utf8")) as { places: [string, string, "osm" | "geonames", number, number, string][] }).places;
  return new Map(rows.map(([code, name, source, lat, lng]) => [code, { name, source, lat, lng }]));
}

/** One fraction, the level between a rural commune and its douars. */
export interface FractionRecord {
  code: string;
  communeCode: string;
  name: { ar: string };
  douars: number;
  households: number;
  population: number;
}

/** Each topic's keys, in the order the workbook gives them. */
export const DOUAR_TOPICS: Map<string, string[]> = new Map();
for (const f of DOUAR_FIELDS) {
  DOUAR_TOPICS.set(f.topic, [...(DOUAR_TOPICS.get(f.topic) ?? []), f.key]);
}
