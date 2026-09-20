import polylabel from "polylabel";
import { ringArea, type Ring } from "./rings.ts";

/** Ray casting. The ring is assumed closed, so the final point repeats the first. */
export function pointInRing(point: [number, number], ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/**
 * The point furthest from any edge of the largest outer ring, with the commune's
 * holes punched out. Inside the polygon by construction, unlike an average vertex,
 * which lands outside for roughly one commune in thirty.
 */
export function interiorPoint(outer: Ring[], inner: Ring[]): { lat: number; lng: number } {
  if (outer.length === 0) throw new Error("interiorPoint needs at least one outer ring");
  const largest = outer.reduce((a, b) => (ringArea(a) >= ringArea(b) ? a : b));
  // Every vertex, not any: a hole with one stray vertex inside this ring probably
  // belongs to a different outer ring of the same multipolygon, and punching it out
  // here would shrink the region the point may sit in. Measured across the 23 cached
  // communes that have holes, both readings give the same point. This is robustness
  // against boundaries changing upstream rather than a fix for anything observed.
  const holes = inner.filter((h) => h.every((p) => pointInRing(p, largest)));
  // polylabel declares [number, number] & { distance: number }, so this destructures
  // directly. No cast is needed.
  const [lng, lat] = polylabel([largest, ...holes], 0.0001);
  return { lat, lng };
}

export function boundingBox(outer: Ring[]): [number, number, number, number] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of outer) {
    for (const [lng, lat] of ring) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  // Without this an empty input returns the Infinity sentinels, which would travel
  // into the dataset as a bounding box rather than failing.
  if (!Number.isFinite(west)) throw new Error("boundingBox needs at least one vertex");
  return [west, south, east, north];
}
