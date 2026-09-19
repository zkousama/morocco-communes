/**
 * Cuts the commune boundaries into the tiles lib/locate.ts reads. A tile starts at one
 * degree square and splits in four while its clipped boundaries hold more than
 * MAX_POINTS points, so a dense city is cut fine and open desert stays in one piece.
 */
import type { Position } from "./boundaries.ts";
import type { Tile, TileIndex } from "../lib/locate.ts";

export const ORIGIN: [number, number] = [-18, 20];
const MAX_ZOOM = 8;
const MAX_POINTS = 2500;
const UNIT = 1e-5;
// Each tile is clipped a little wider than itself, so a point on its edge lies inside the
// clipped shape rather than on it.
const MARGIN = 1e-4;

export interface Shape {
  code: string;
  /** Every ring of every polygon, outer and inner alike: containment is even-odd. */
  rings: Position[][];
}

type Box = [number, number, number, number];

const boxOf = (rings: Position[][]): Box => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
};

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * Sutherland–Hodgman against a rectangle. A concave ring can come out with edges doubled
 * back along the rectangle's side; they cross a ray twice and cancel, so containment of a
 * point inside the rectangle is unchanged.
 */
export function clipRing(ring: Position[], [x0, y0, x1, y1]: Box): Position[] {
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  let points = first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  const edges: [(p: Position) => boolean, (a: Position, b: Position) => Position][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cross] of edges) {
    const out: Position[] = [];
    for (let i = 0; i < points.length; i++) {
      const current = points[i]!;
      const previous = points[(i + points.length - 1) % points.length]!;
      if (inside(current)) {
        if (!inside(previous)) out.push(cross(previous, current));
        out.push(current);
      } else if (inside(previous)) {
        out.push(cross(previous, current));
      }
    }
    points = out;
    if (points.length === 0) break;
  }
  return points;
}

export function buildTiles(shapes: Shape[]): { index: TileIndex; tiles: Map<string, Tile> } {
  const split: string[] = [];
  const leaf: string[] = [];
  const tiles = new Map<string, Tile>();

  const visit = (z: number, x: number, y: number, candidates: (Shape & { box: Box })[]) => {
    const size = 1 / 2 ** z;
    const west = ORIGIN[0] + x * size;
    const south = ORIGIN[1] + y * size;
    const rect: Box = [west - MARGIN, south - MARGIN, west + size + MARGIN, south + size + MARGIN];

    const inTile: (Shape & { box: Box })[] = [];
    let points = 0;
    for (const shape of candidates) {
      if (!overlaps(shape.box, rect)) continue;
      const rings = shape.rings.map((r) => clipRing(r, rect)).filter((r) => r.length >= 3);
      if (rings.length === 0) continue;
      inTile.push({ code: shape.code, rings, box: boxOf(rings) });
      for (const r of rings) points += r.length;
    }
    if (inTile.length === 0) return;

    const key = `${z}/${x}/${y}`;
    if (points > MAX_POINTS && z < MAX_ZOOM) {
      split.push(key);
      // The children clip what this tile already clipped: each sits inside it.
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) visit(z + 1, 2 * x + dx, 2 * y + dy, inTile);
      return;
    }

    leaf.push(key);
    tiles.set(key, {
      origin: [west, south],
      unit: UNIT,
      communes: inTile.map((shape) => ({
        code: shape.code,
        rings: shape.rings.map((ring) => {
          const flat: number[] = [];
          for (const [lng, lat] of ring) {
            const px = Math.round((lng - west) / UNIT);
            const py = Math.round((lat - south) / UNIT);
            // Rounding can land two points on one step; the repeat adds nothing.
            if (flat.length >= 2 && flat[flat.length - 2] === px && flat[flat.length - 1] === py) continue;
            flat.push(px, py);
          }
          return flat;
        }),
      })),
    });
  };

  const all = shapes.map((s) => ({ ...s, box: boxOf(s.rings) }));
  const [x0, y0, x1, y1] = boxOf(all.flatMap((s) => s.rings));
  for (let x = Math.floor(x0 - ORIGIN[0]); x <= Math.floor(x1 - ORIGIN[0]); x++) {
    for (let y = Math.floor(y0 - ORIGIN[1]); y <= Math.floor(y1 - ORIGIN[1]); y++) visit(0, x, y, all);
  }

  return { index: { origin: ORIGIN, maxZoom: MAX_ZOOM, split, leaf }, tiles };
}
