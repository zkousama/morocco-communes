import { existsSync, readFileSync } from "node:fs";
import { normalise } from "./normalise.ts";
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
  /** Where GeoNames or OpenStreetMap maps it, matched by name in the same commune. */
  place?: DouarPlace;
  /** Its name in Latin letters, where a source writes one. HCP names douars in Arabic only. */
  latin?: DouarLatin;
}

/** A douar's point, from the place matched to it (api/data/douar-places.json). */
export interface DouarPlace {
  source: "osm" | "geonames";
  lat: number;
  lng: number;
}

/** A douar's Latin name and who writes it so. */
export interface DouarLatin {
  name: string;
  /** The Ministry of National Education's school lists, OpenStreetMap, GeoNames, or 2 visitors who suggested it. */
  source: "education" | "osm" | "geonames" | "visitors";
}

/**
 * Each douar's point and Latin name, from api/data/douar-places.json and douar-names.json,
 * or none before api:douar-places and api:douar-names have run. The Ministry's spelling
 * comes first, a government's spelling in current use; then the matched place's.
 */
/** The names visitors had accepted when the site was last deployed. Not in git. */
export const VISITORS = "api/generated/douar-visitors.json";

export function readDouarSources(dir = "api/data"): Map<string, { place?: DouarPlace; latin?: DouarLatin }> {
  const out = new Map<string, { place?: DouarPlace; latin?: DouarLatin }>();
  const places = `${dir}/douar-places.json`;
  if (existsSync(places)) {
    const rows = (JSON.parse(readFileSync(places, "utf8")) as { places: [string, string, "osm" | "geonames", number, number, ...unknown[]][] }).places;
    for (const [code, name, source, lat, lng] of rows) {
      out.set(code, { place: { source, lat, lng }, ...(name ? { latin: { name, source } } : {}) });
    }
  }
  const names = `${dir}/douar-names.json`;
  if (existsSync(names)) {
    for (const [code, name] of (JSON.parse(readFileSync(names, "utf8")) as { names: [string, string][] }).names) {
      out.set(code, { ...out.get(code), latin: { name, source: "education" } });
    }
  }
  // Visitors' names, pulled from the live database at deploy (douarVisitors.ts); only for a
  // douar no source names, which is the only kind that takes a suggestion.
  if (existsSync(VISITORS)) {
    for (const [code, name] of (JSON.parse(readFileSync(VISITORS, "utf8")) as { names: [string, string][] }).names) {
      if (!out.get(code)?.latin) out.set(code, { ...out.get(code), latin: { name, source: "visitors" } });
    }
  }
  return out;
}

/** A douar with its point and Latin name, where it has them. */
export function withSources(d: DouarRecord, sources: Map<string, { place?: DouarPlace; latin?: DouarLatin }>): DouarRecord {
  const found = sources.get(d.code);
  return found ? { ...d, ...found } : d;
}

/** One fraction, the level between a rural commune and its douars. */
export interface FractionRecord {
  code: string;
  communeCode: string;
  name: { ar: string };
  douars: number;
  households: number;
  population: number;
  /** Its name in Latin letters, where one of its commune's douars has the same name and a source spells it. */
  latin?: DouarLatin;
  /** What a fraction HCP lists under a label rather than a name is: outside the commune, or notional. */
  label?: FractionLabel;
}

/** The labels HCP gives a fraction in place of a name. */
export type FractionLabel = "outside" | "notional";
const LABELS: Record<string, FractionLabel> = {
  [normalise("مشيخة خارج الجماعة")]: "outside",
  [normalise("مشيخة وهمية")]: "notional",
};

/** A name without its article and spaces, so الواد and واد are one name. */
const bare = (name: string) => normalise(name).replace(/ /g, "").replace(/^ال(?=..)/, "");

/**
 * Fractions with their label, or the Latin name of the douar of their commune that shares
 * their name and has one: a fraction is often named after its main village. A douar's own
 * source carries over, so the name is as traceable as the douar's.
 */
export function withFractionNames(fractions: readonly FractionRecord[], douars: readonly DouarRecord[]): FractionRecord[] {
  const named = new Map<string, DouarLatin>();
  for (const d of douars) {
    const key = `${d.communeCode}|${bare(d.name.ar)}`;
    if (d.latin && !named.has(key)) named.set(key, d.latin);
  }
  return fractions.map((f) => {
    const label = LABELS[normalise(f.name.ar)];
    if (label) return { ...f, label };
    const latin = named.get(`${f.communeCode}|${bare(f.name.ar)}`);
    return latin ? { ...f, latin } : f;
  });
}

/** Each topic's keys, in the order the workbook gives them. */
export const DOUAR_TOPICS: Map<string, string[]> = new Map();
for (const f of DOUAR_FIELDS) {
  DOUAR_TOPICS.set(f.topic, [...(DOUAR_TOPICS.get(f.topic) ?? []), f.key]);
}
