import type { OsmFeature } from "./osmJoin.ts";

/**
 * Which communes border which, and along how much.
 *
 * Two communes share a border when their boundaries share a segment: two consecutive
 * points that both rings carry. In OpenStreetMap the boundary between two communes is
 * usually one way used by both relations, so the points are the same nodes and match
 * exactly rather than within a tolerance. A pair that meets at a single point touches at
 * a corner and is not a border.
 *
 * The length is the sum of the segments they share, on the sphere. Where a stretch of
 * border is drawn as two separate ways with different nodes, the shared points end and
 * so does the length, which makes this a floor rather than an estimate.
 */

export interface Border {
  /** The two communes, by dotted code, in code order. */
  a: string;
  b: string;
  /** How much boundary they share, in km. */
  km: number;
}

const EARTH_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two [lng, lat] points, in km. */
export function distance([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const at = (point: [number, number]) => `${point[0]},${point[1]}`;

export function buildAdjacency(
  /** Every commune's boundary, by the digits of its code, as the OSM join gives them. */
  features: Map<string, OsmFeature>,
  /** The dotted code each of those belongs to. */
  codeOf: Map<string, string>,
): Border[] {
  // Which units meet at each point. A point on nobody else's boundary is interior to one
  // commune and can't be part of a border.
  const units = new Map<string, string[]>();
  for (const [digits, feature] of features) {
    const code = codeOf.get(digits);
    if (!code) throw new Error(`a boundary carries the code ${digits}, which no commune has`);
    for (const ring of [...feature.outer, ...feature.inner]) {
      for (const point of ring) {
        const key = at(point);
        const here = units.get(key);
        if (!here) units.set(key, [code]);
        else if (!here.includes(code)) here.push(code);
      }
    }
  }

  // Each shared segment, walked from the lower-coded side only, so its length is added
  // once rather than once from each commune that carries it.
  const km = new Map<string, number>();
  for (const [digits, feature] of features) {
    const code = codeOf.get(digits)!;
    for (const ring of [...feature.outer, ...feature.inner]) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const from = units.get(at(ring[i]!));
        const to = units.get(at(ring[i + 1]!));
        if (!from || !to || from.length < 2 || to.length < 2) continue;
        const length = distance(ring[i]!, ring[i + 1]!);
        for (const other of from) {
          if (other <= code || !to.includes(other)) continue;
          const key = `${code}|${other}`;
          km.set(key, (km.get(key) ?? 0) + length);
        }
      }
    }
  }

  return [...km]
    .map(([key, length]) => {
      const [a, b] = key.split("|") as [string, string];
      return { a, b, km: Math.round(length * 100) / 100 };
    })
    .sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/** Each commune's neighbours, in code order, from the borders. */
export function neighboursOf(borders: Border[]): Map<string, { code: string; km: number }[]> {
  const out = new Map<string, { code: string; km: number }[]>();
  const add = (code: string, neighbour: { code: string; km: number }) =>
    out.set(code, [...(out.get(code) ?? []), neighbour]);
  for (const b of borders) {
    add(b.a, { code: b.b, km: b.km });
    add(b.b, { code: b.a, km: b.km });
  }
  for (const list of out.values()) list.sort((x, y) => x.code.localeCompare(y.code));
  return out;
}
