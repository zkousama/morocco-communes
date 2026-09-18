/**
 * Draws Morocco from the dataset this site documents.
 *
 * Not an illustration: the commune lines are the shipped `data/v1/geometry/` boundaries,
 * decoded from TopoJSON, projected, and simplified to a tolerance that stays under one
 * device pixel at the size the hero renders. The heavier lines are the régions, found by
 * the arcs that appear an odd number of times inside a régional file — a shared internal
 * border is traversed twice and cancels, so what is left is the outline.
 *
 * Emits site/public/morocco.svg plus a small module with the counts. The map is a file
 * rather than inline markup so three localised pages share one cached copy instead of
 * carrying 137 KB each; its own <style> block carries the dark-mode switch, which an
 * <img> still honours.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coverageHoles, type TopologyLike } from "../../pipeline/src/geo/holes.ts";

const GEOMETRY = "data/v1/geometry";
const OUT = "site/src/generated/outline.ts";
const WIDTH = 1000;
/** Degrees. About 1 viewBox unit, which is below a pixel wherever the hero is drawn. */
const TOLERANCE = 0.015;

type Point = [number, number];

interface Topo {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: { communes: { geometries: { type: string; arcs: unknown; properties: { code: string } }[] } };
}

function decodeArcs(topo: Topo): Point[][] {
  const { scale, translate } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx as number;
      y += dy as number;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as Point;
    });
  });
}

/** Perpendicular-distance simplification, iterative so a long ring cannot blow the stack. */
function simplify(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let index = -1;
    const [ax, ay] = points[first]!;
    const [bx, by] = points[last]!;
    const dx = bx - ax;
    const dy = by - ay;
    const norm = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]!;
      let d: number;
      if (norm === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        let t = ((px - ax) * dx + (py - ay) * dy) / norm;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tol * tol && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function ringsOf(geometry: { type: string; arcs: unknown }, arcs: Point[][]): Point[][] {
  const lists: number[][] =
    geometry.type === "Polygon"
      ? (geometry.arcs as number[][])
      : (geometry.arcs as number[][][]).flat();
  return lists.map((list) => {
    const ring: Point[] = [];
    for (const index of list) {
      const arc = index < 0 ? [...arcs[~index]!].reverse() : arcs[index]!;
      for (const point of arc) ring.push(point);
    }
    return ring;
  });
}

const files = (await readdir(GEOMETRY)).filter((f) => f.endsWith(".topojson")).sort();
const communeRings: { code: string; rings: Point[][] }[] = [];
const regionArcs: Point[][] = [];

for (const file of files) {
  const topo = JSON.parse(await readFile(join(GEOMETRY, file), "utf8")) as Topo;
  const arcs = decodeArcs(topo);
  const uses = new Map<number, number>();
  for (const geometry of topo.objects.communes.geometries) {
    communeRings.push({ code: geometry.properties.code, rings: ringsOf(geometry, arcs) });
    const lists: number[][] =
      geometry.type === "Polygon"
        ? (geometry.arcs as number[][])
        : (geometry.arcs as number[][][]).flat();
    for (const list of lists) {
      for (const index of list) {
        const absolute = index < 0 ? ~index : index;
        uses.set(absolute, (uses.get(absolute) ?? 0) + 1);
      }
    }
  }
  // An arc used an odd number of times has a commune on one side only. Most are the
  // région's edge — 333 are traced identically by two régions — but the edge of a hole in
  // the commune coverage is one-sided too, and drawing it here would draw a région border
  // around land that is inside the région. Those arcs are skipped.
  const holeArcs = new Set(coverageHoles(topo as unknown as TopologyLike).flatMap((h) => h.arcs));
  for (const [index, count] of uses) {
    if (count % 2 === 1 && !holeArcs.has(index)) regionArcs.push(arcs[index]!);
  }
}

// One projection for both layers, fitted to everything that will be drawn.
let minLng = Infinity;
let maxLng = -Infinity;
let minLat = Infinity;
let maxLat = -Infinity;
for (const { rings } of communeRings) {
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
}
// Plate carrée with the x axis corrected at the mid latitude. Morocco spans 15° of
// latitude, so the distortion a real projection would fix is smaller than the line width.
const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
const spanX = (maxLng - minLng) * kx;
const spanY = maxLat - minLat;
const s = WIDTH / Math.max(spanX, spanY);
const height = Math.round(spanY * s);

const project = ([lng, lat]: Point): [number, number] => [
  Math.round((lng - minLng) * kx * s),
  Math.round((maxLat - lat) * s),
];

function toPath(points: Point[], close: boolean): string | null {
  // A commune small enough to collapse at the shared tolerance is retried finer rather
  // than dropped. Those are the dense urban ones, which carry few vertices to begin
  // with, so recovering them costs almost nothing and the map is then the whole dataset.
  let simple = simplify(points, TOLERANCE);
  if (simple.length < (close ? 4 : 2)) simple = simplify(points, TOLERANCE / 10);
  if (simple.length < (close ? 4 : 2)) simple = points;
  if (simple.length < (close ? 4 : 2)) return null;
  let d = "";
  let px = NaN;
  let py = NaN;
  let written = 0;
  for (const point of simple) {
    const [x, y] = project(point);
    if (x === px && y === py) continue;
    d += written === 0 ? `M${x} ${y}` : `L${x} ${y}`;
    px = x;
    py = y;
    written++;
  }
  if (written < (close ? 3 : 2)) return null;
  return close ? `${d}Z` : d;
}

const communePaths: string[] = [];
let drawn = 0;
for (const { rings } of communeRings) {
  const kept = rings.map((ring) => toPath(ring, true)).filter((d): d is string => d !== null);
  if (kept.length > 0) drawn++;
  communePaths.push(...kept);
}
/**
 * Spans fewer than two units in the 1000-unit viewBox, so it renders as a dot rather than
 * a line. On the régional layer that reads as a place, and the one that survives here is
 * an islet off the Mediterranean coast rather than a border between two régions.
 */
function isDot(d: string): boolean {
  const numbers = d.match(/-?\d+/g);
  if (!numbers) return true;
  const xs: number[] = [];
  const ys: number[] = [];
  numbers.forEach((n, i) => (i % 2 === 0 ? xs : ys).push(Number(n)));
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 2;
}

const regionPaths = regionArcs
  .map((arc) => toPath(arc, false))
  .filter((d): d is string => d !== null && !isDot(d));

const communes = communePaths.join("");
const regions = regionPaths.join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" \
role="img" aria-label="The ${drawn} commune boundaries of Morocco, drawn from the dataset">\
<style><![CDATA[
  /* The plate under this is a fixed dark field in both page themes, so the strokes have
     nothing to respond to and need no media query. CDATA because SVG is XML: a bare <
     in here would be parsed as markup and break the file. */
  .commune { fill: none; stroke: #3f7d68; stroke-width: 0.8; }
  .region { fill: none; stroke: #cfe6d8; stroke-width: 1.5; stroke-linecap: round; }
]]></style>\
<g class="commune"><path d="${communes}"/></g>\
<g class="region"><path d="${regions}"/></g></svg>
`;

await mkdir("site/public", { recursive: true });
await writeFile("site/public/morocco.svg", svg);
await mkdir("site/src/generated", { recursive: true });
await writeFile(
  OUT,
  `// Generated by site/scripts/outline.ts from data/v1/geometry. Do not edit.
export const viewBox = "0 0 ${WIDTH} ${height}";
export const communesDrawn = ${drawn};
export const aspect = ${(height / WIDTH).toFixed(4)};
`,
);

console.log(
  `outline: ${drawn} of ${communeRings.length} communes, ${regionPaths.length} régional arcs, ` +
    `${(svg.length / 1024).toFixed(0)} KB svg`,
);
