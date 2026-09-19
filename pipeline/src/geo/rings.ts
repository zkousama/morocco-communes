import type { OverpassMember } from "../sources/overpass.ts";

export type Ring = [number, number][];

const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

/**
 * Overpass hands back a boundary as unordered way fragments. Stitch them end to
 * end, reversing where a fragment runs the other way, until each ring closes.
 * A ring that cannot be closed is still returned, so the caller can reject it
 * rather than silently shipping a broken polygon.
 */
export function assembleRings(members: OverpassMember[]): { outer: Ring[]; inner: Ring[] } {
  const bucket: Record<"outer" | "inner", Ring[]> = { outer: [], inner: [] };

  for (const role of ["outer", "inner"] as const) {
    const pool: Ring[] = [];
    for (const m of members) {
      if (m.type !== "way" || !m.geometry || m.geometry.length < 2) continue;
      const memberRole = m.role === "inner" ? "inner" : "outer";
      if (memberRole !== role) continue;
      pool.push(m.geometry.map((p) => [p.lon, p.lat] as [number, number]));
    }

    while (pool.length > 0) {
      const ring = pool.shift()!;
      let joined = true;
      while (!same(ring[0]!, ring[ring.length - 1]!) && joined) {
        joined = false;
        for (let i = 0; i < pool.length; i++) {
          const cand = pool[i]!;
          const head = ring[0]!;
          const tail = ring[ring.length - 1]!;
          if (same(cand[0]!, tail)) ring.push(...cand.slice(1));
          else if (same(cand[cand.length - 1]!, tail)) ring.push(...cand.slice(0, -1).reverse());
          else if (same(cand[cand.length - 1]!, head)) ring.unshift(...cand.slice(0, -1));
          else if (same(cand[0]!, head)) ring.unshift(...cand.slice(1).reverse());
          else continue;
          pool.splice(i, 1);
          joined = true;
          break;
        }
      }
      bucket[role].push(ring);
    }
  }

  return bucket;
}

export function isClosed(ring: Ring): boolean {
  return ring.length > 3 && same(ring[0]!, ring[ring.length - 1]!);
}

// WGS 84's equatorial radius, in km, the sphere most GIS tools compute areas on.
const EARTH_RADIUS_KM = 6378.137;

/**
 * A ring's area on the sphere, in km², by the Chamberlain–Duquette formula: exact for the
 * spherical polygon whose edges run along lines of constant latitude between vertices,
 * which at a commune's scale is within a fraction of a percent of the geodesic answer.
 */
export function sphericalArea(ring: Ring): number {
  const rad = Math.PI / 180;
  const n = ring.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [lngA] = ring[(i + n - 1) % n]!;
    const [, lat] = ring[i]!;
    const [lngC] = ring[(i + 1) % n]!;
    sum += (lngC - lngA) * rad * Math.sin(lat * rad);
  }
  return Math.abs((sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

/** Shoelace area in squared degrees. Only ever used to compare rings with each other. */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return Math.abs(sum) / 2;
}
