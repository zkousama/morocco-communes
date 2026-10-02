/**
 * How far rural homes are from a lycée, a collège, a health centre, a paved road and a
 * primary school, worked out from the douars: each douar's distance is HCP's average over
 * its dwellings, and a group of douars averages them weighted by their households.
 *
 * HCP withholds the distances of a douar under 30 households. Such a douar counts toward
 * the douars and the people here, and not toward the distances, which cover the rest.
 */
import type { DouarRecord } from "../../../api/src/lib/douars.ts";

/** In the order the pages show them. */
export const ACCESS = ["highSchool", "middleSchool", "healthCentre", "pavedRoad", "primarySchool"] as const;
export type Access = (typeof ACCESS)[number];

/** A home further than this is far, in km. */
export const FAR_KM = 10;
/** The map's classes for a school or a health centre, in km: the same for each, so a shade means one distance. */
export const SERVICE_BREAKS = [3, 5, 10, 20, 40];
/** Paved roads are nearer, so their classes are finer. */
export const ROAD_BREAKS = [0.5, 1, 2, 5, 10];

export interface Summary {
  douars: number;
  fractions: number;
  communes: number;
  households: number;
  people: number;
  /** Households in the douars HCP gives distances for, which the averages are over. */
  counted: number;
  /** The weighted average, in km, and the percentage of counted households further than FAR_KM. Null with nothing counted. */
  km: Record<Access, number> | null;
  far: Record<Access, number> | null;
}

export function summarise(douars: readonly DouarRecord[]): Summary {
  const sum = Object.fromEntries(ACCESS.map((k) => [k, 0])) as Record<Access, number>;
  const beyond = Object.fromEntries(ACCESS.map((k) => [k, 0])) as Record<Access, number>;
  let counted = 0;
  for (const d of douars) {
    const km = d.topics?.distanceKm;
    if (!km) continue;
    counted += d.households;
    for (const k of ACCESS) {
      const v = km[k];
      if (v === null || v === undefined) throw new Error(`douar ${d.code} has figures and no ${k}`);
      sum[k] += v * d.households;
      if (v > FAR_KM) beyond[k] += d.households;
    }
  }
  const of = (values: Record<Access, number>, scale: number) =>
    counted === 0 ? null : (Object.fromEntries(ACCESS.map((k) => [k, (values[k] / counted) * scale])) as Record<Access, number>);
  return {
    douars: douars.length,
    fractions: new Set(douars.map((d) => d.fraction)).size,
    communes: new Set(douars.map((d) => d.communeCode)).size,
    households: douars.reduce((n, d) => n + d.households, 0),
    people: douars.reduce((n, d) => n + d.population, 0),
    counted,
    km: of(sum, 1),
    far: of(beyond, 100),
  };
}

/** Where the douars page splits homes by distance, in km: under 3, 3 to 10, 10 to 20, over 20. */
export const BAND_BREAKS = [3, 10, 20];

/**
 * For each of the 5, the share of the counted households in each band of BAND_BREAKS, in
 * percent, nearest first. Null with nothing counted.
 */
export function bandsOf(douars: readonly DouarRecord[]): Record<Access, number[]> | null {
  const counts = Object.fromEntries(ACCESS.map((k) => [k, BAND_BREAKS.map(() => 0).concat(0)])) as Record<Access, number[]>;
  let counted = 0;
  for (const d of douars) {
    const km = d.topics?.distanceKm;
    if (!km) continue;
    counted += d.households;
    for (const k of ACCESS) {
      const at = BAND_BREAKS.findIndex((edge) => km[k]! < edge);
      counts[k][at === -1 ? BAND_BREAKS.length : at]! += d.households;
    }
  }
  if (counted === 0) return null;
  return Object.fromEntries(ACCESS.map((k) => [k, counts[k].map((n) => (n / counted) * 100)])) as Record<Access, number[]>;
}
