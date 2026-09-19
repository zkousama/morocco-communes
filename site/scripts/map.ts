/**
 * The map on the home page: every commune as its own shape, coloured by a value the reader
 * picks, with the régions drawn over them.
 *
 * Simplified arc by arc rather than shape by shape. Two communes share each border as one
 * TopoJSON arc, so simplifying the arc once gives both of them the same edge, and the
 * fills meet with no slivers between them.
 *
 * Writes site/src/generated/map.ts, the markup and the legend classes, and
 * site/public/map/communes.json, the names and figures the tooltip reads on first hover.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readBoundaries, unionOf } from "../../api/src/emit/boundaries.ts";
import { sphericalArea } from "../../pipeline/src/geo/rings.ts";
import { coverageHoles, type TopologyLike } from "../../pipeline/src/geo/holes.ts";
import { boxOf, fit, pathOf, simplify, type Point } from "../src/lib/geo.ts";

const WIDTH = 1000;
/** In viewBox units: under a pixel wherever the map is drawn. */
const TOLERANCE = 0.7;

/**
 * Class boundaries. Density in people per km², change in percent since 2014, illiteracy in
 * percent of the population aged 10 and over. Round tens for illiteracy: the communes run
 * from 3.3% to 73.2%, and a reader holds tens more easily than the quantiles.
 */
export const DENSITY_BREAKS = [10, 50, 150, 500, 2000];
export const CHANGE_BREAKS = [-10, -2, 2, 10, 25];
export const ILLITERACY_BREAKS = [10, 20, 30, 40, 50];

const classOf = (value: number | null, breaks: number[]) => {
  if (value === null) return "n";
  const i = breaks.findIndex((b) => value < b);
  return String(i < 0 ? breaks.length : i);
};

interface Commune {
  code: string;
  codeDigits: string;
  slug: string;
  name: { fr: string; ar: string };
  type: "urban" | "rural";
  population: { "2024": { total: number }; change: { pct: number } | null };
  density: number | null;
}

const communes = JSON.parse(await readFile("data/v1/attributes/communes.json", "utf8")) as Commune[];
const byDigits = new Map(communes.map((c) => [c.codeDigits, c]));

interface Figures {
  code: string;
  people: { total: { all: Record<string, Record<string, number | null>> } | null };
}
const indicators = JSON.parse(await readFile("data/v1/indicators/communes.json", "utf8")) as Figures[];
const illiteracyOf = new Map(
  indicators.map((r) => [r.code, r.people.total?.all.illiteracy?.rate10Plus ?? null]),
);
const files = await readBoundaries("data/v1/geometry");

// One projection for the whole country, from every boundary drawn.
const decoded = files.map(({ topology }) => {
  const { scale, translate } = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as Point;
    });
  });
  return { topology, arcs };
});
const { height, unit, project } = fit(boxOf(decoded.flatMap((d) => d.arcs)), WIDTH);

const shapes: string[] = [];
const regionPaths: string[] = [];
// Land inside a région that no commune's boundary covers, drawn hatched rather than left
// as a hole in the page. Slivers under a km² between neighbours aren't worth drawing.
const gaps: string[] = [];
for (const { region, boundaries } of files) {
  for (const polygon of unionOf(boundaries)) {
    for (const hole of polygon.slice(1)) {
      if (sphericalArea(hole) < 1) continue;
      const d = pathOf(simplify(hole as Point[], TOLERANCE * unit / 2).map(project), true);
      gaps.push(`<path class="gap" d="${d}" data-gap="${region}"/>`);
    }
  }
}
for (const { topology, arcs } of decoded) {
  const drawn = arcs.map((arc) => simplify(arc, TOLERANCE * unit).map(project));
  const raw = arcs.map((arc) => arc.map(project));
  const join = (source: Point[][], indices: number[]) => {
    const points: Point[] = [];
    for (const index of indices) {
      const arc = index < 0 ? [...source[~index]!].reverse() : source[index]!;
      points.push(...(points.length === 0 ? arc : arc.slice(1)));
    }
    return points;
  };
  // A commune small enough to collapse at this tolerance keeps its full outline instead:
  // they're the dense urban ones, with few points to begin with.
  const distinct = (points: Point[]) => new Set(points.map((p) => p.join())).size;
  const ring = (indices: number[]) => {
    const simple = join(drawn, indices);
    return distinct(simple) >= 3 ? simple : join(raw, indices);
  };

  const uses = new Map<number, number>();
  for (const g of topology.objects.communes.geometries) {
    const lists = g.type === "Polygon" ? (g.arcs as number[][]) : (g.arcs as number[][][]).flat();
    for (const list of lists) for (const i of list) uses.set(i < 0 ? ~i : i, (uses.get(i < 0 ? ~i : i) ?? 0) + 1);

    const commune = byDigits.get(g.properties.code)!;
    const d = lists
      .map(ring)
      .filter((r) => r.length >= 3)
      .map((r) => pathOf(r, true))
      .join("");
    if (d === "") continue;
    shapes.push(
      `<path d="${d}" data-c="${commune.code}" data-d="${classOf(commune.density, DENSITY_BREAKS)}" ` +
        `data-g="${classOf(commune.population.change?.pct ?? null, CHANGE_BREAKS)}" ` +
        `data-i="${classOf(illiteracyOf.get(commune.code) ?? null, ILLITERACY_BREAKS)}" data-t="${commune.type[0]}"/>`,
    );
  }

  // An arc a single commune uses is the edge of the région, except where it rims a hole in
  // the coverage, which is inside the région and gets no border.
  const holes = new Set(coverageHoles(topology as unknown as TopologyLike).flatMap((h) => h.arcs));
  for (const [index, count] of uses) {
    if (count % 2 === 1 && !holes.has(index) && drawn[index]!.length >= 2) regionPaths.push(pathOf(drawn[index]!, false));
  }
}

const hatch =
  '<defs><pattern id="gap-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
  '<line class="hatch" x1="0" y1="0" x2="0" y2="4"/></pattern></defs>';
const markup =
  `${hatch}<g class="communes">${shapes.join("")}</g>${gaps.join("")}` +
  `<path class="regions" d="${regionPaths.join("")}"/>`;

// What the tooltip shows, fetched once on first hover: slug, name, type, population,
// density, change and illiteracy, by code.
const tooltip = Object.fromEntries(
  communes.map((c) => [
    c.code,
    [
      c.slug,
      c.name.fr,
      c.type,
      c.population["2024"].total,
      c.density,
      c.population.change?.pct ?? null,
      illiteracyOf.get(c.code) ?? null,
    ],
  ]),
);

await mkdir("site/public/map", { recursive: true });
await writeFile("site/public/map/communes.json", JSON.stringify(tooltip));
await writeFile(
  "site/src/generated/map.ts",
  `// Generated by site/scripts/map.ts from data/v1. Do not edit.
export const viewBox = "0 0 ${WIDTH} ${height}";
export const densityBreaks = ${JSON.stringify(DENSITY_BREAKS)};
export const changeBreaks = ${JSON.stringify(CHANGE_BREAKS)};
export const illiteracyBreaks = ${JSON.stringify(ILLITERACY_BREAKS)};
export const shapes = ${shapes.length};
export const markup = ${JSON.stringify(markup)};
`,
);
console.log(`map: ${shapes.length} communes, ${gaps.length} gaps, ${(markup.length / 1024).toFixed(0)} KB of markup`);
