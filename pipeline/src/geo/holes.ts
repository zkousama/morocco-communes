import { pointInRing } from "./point.ts";
import type { Ring } from "./rings.ts";

/** Enough of a TopoJSON topology to walk its arcs; both the pipeline and the site read one. */
export interface TopologyLike {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: { communes: { geometries: { type: string; arcs: unknown; properties: { code: string } }[] } };
}

export interface CoverageHole {
  /** Indices of the arcs that make up the hole's edge. */
  arcs: number[];
  areaKm2: number;
  centre: { lat: number; lng: number };
  /** Codes of the communes that border it. */
  bordering: string[];
}

/** Arcs as positions on the quantised grid, where two arcs that meet share a point exactly. */
function gridArcs(topo: TopologyLike): [number, number][][] {
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx!;
      y += dy!;
      return [x, y] as [number, number];
    });
  });
}

function areaKm2(ring: Ring): number {
  const lat0 = ring.reduce((n, p) => n + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.54;
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    twice += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(twice) / 2;
}

/**
 * Land inside a région that no commune polygon covers.
 *
 * An arc used by one commune only is on an edge with nothing on its other side. Stitched
 * together, those arcs form the région's outline and, separately, the outline of any hole
 * inside it. The largest closed ring is the outline; a ring lying inside it is a hole.
 * Islands and exclaves lie outside the outline, so they are not reported.
 */
export function coverageHoles(topo: TopologyLike, minAreaKm2 = 0.5): CoverageHole[] {
  const grid = gridArcs(topo);
  const { scale, translate } = topo.transform;
  const toLngLat = ([x, y]: [number, number]): [number, number] => [x * scale[0] + translate[0], y * scale[1] + translate[1]];

  const uses = new Map<number, number>();
  const owners = new Map<number, Set<string>>();
  for (const g of topo.objects.communes.geometries) {
    const lists = g.type === "Polygon" ? (g.arcs as number[][]) : (g.arcs as number[][][]).flat();
    for (const list of lists) {
      for (const i of list) {
        const a = i < 0 ? ~i : i;
        uses.set(a, (uses.get(a) ?? 0) + 1);
        if (!owners.has(a)) owners.set(a, new Set());
        owners.get(a)!.add(g.properties.code);
      }
    }
  }

  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const pool = [...uses].filter(([, n]) => n % 2 === 1).map(([a]) => ({ a, pts: [...grid[a]!] }));
  const rings: { pts: [number, number][]; arcs: number[] }[] = [];
  while (pool.length > 0) {
    const first = pool.shift()!;
    const ring = { pts: first.pts, arcs: [first.a] };
    let grew = true;
    while (grew && key(ring.pts[0]!) !== key(ring.pts[ring.pts.length - 1]!)) {
      grew = false;
      const end = key(ring.pts[ring.pts.length - 1]!);
      for (let i = 0; i < pool.length; i++) {
        const next = pool[i]!;
        if (key(next.pts[0]!) === end) ring.pts.push(...next.pts.slice(1));
        else if (key(next.pts[next.pts.length - 1]!) === end) ring.pts.push(...[...next.pts].reverse().slice(1));
        else continue;
        ring.arcs.push(next.a);
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (key(ring.pts[0]!) === key(ring.pts[ring.pts.length - 1]!)) rings.push(ring);
  }
  if (rings.length === 0) return [];

  const geo = rings.map((r) => ({ ...r, lngLat: r.pts.map(toLngLat) as Ring }));
  const outline = geo.reduce((a, b) => (areaKm2(a.lngLat) >= areaKm2(b.lngLat) ? a : b));
  return geo
    .filter((r) => r !== outline && pointInRing(r.lngLat[0]!, outline.lngLat))
    .map((r) => ({
      arcs: r.arcs,
      areaKm2: Number(areaKm2(r.lngLat).toFixed(1)),
      centre: {
        lat: Number((r.lngLat.reduce((n, p) => n + p[1], 0) / r.lngLat.length).toFixed(3)),
        lng: Number((r.lngLat.reduce((n, p) => n + p[0], 0) / r.lngLat.length).toFixed(3)),
      },
      bordering: [...new Set(r.arcs.flatMap((a) => [...(owners.get(a) ?? [])]))].sort(),
    }))
    .filter((h) => h.areaKm2 >= minAreaKm2);
}

/**
 * Holes the source is known to have, keyed by région and centre. Each is a gap in
 * OpenStreetMap rather than in Morocco, since HCP puts every place in some commune, and is
 * listed so that a new one fails the build instead of shipping unnoticed.
 */
export const KNOWN_HOLES = new Map<string, string>([
  [
    "03 33.5,-5.0",
    "about 88 km² between Ifrane and Boulemane, in the cercle of Azrou; OpenStreetMap has no admin_level=8 relation covering it",
  ],
]);

export const holeKey = (region: string, hole: Pick<CoverageHole, "centre">) =>
  `${region} ${hole.centre.lat.toFixed(1)},${hole.centre.lng.toFixed(1)}`;

/**
 * Failures for one région: a hole that is not on the known list, and a known hole that is
 * no longer there. The second keeps the list honest: once OpenStreetMap is fixed, the
 * entry has to come out rather than sit there excusing nothing.
 */
export function checkHoles(region: string, holes: CoverageHole[]): string[] {
  const failures: string[] = [];
  const found = new Set(holes.map((h) => holeKey(region, h)));
  for (const h of holes) {
    const key = holeKey(region, h);
    if (!KNOWN_HOLES.has(key)) {
      failures.push(
        `région ${region}: ${h.areaKm2} km² near ${h.centre.lat},${h.centre.lng} is covered by no commune; bordered by ${h.bordering.join(", ")}`,
      );
    }
  }
  for (const key of KNOWN_HOLES.keys()) {
    if (key.startsWith(`${region} `) && !found.has(key)) {
      failures.push(`région ${region}: the known hole at ${key.slice(3)} is gone; take it off KNOWN_HOLES`);
    }
  }
  return failures;
}
