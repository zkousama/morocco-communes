/**
 * Commune boundaries decoded out of the régional TopoJSON files, as plain polygons. The
 * GeoJSON downloads and the point-lookup tiles are both written from these.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import polygonClipping from "polygon-clipping";

export type Position = [number, number];
/** Rings of one polygon, the outer ring first, each closed. */
export type Polygon = Position[][];

export interface Boundary {
  /** Dotted HCP code. The TopoJSON carries the digits; the caller's records map them back. */
  codeDigits: string;
  polygons: Polygon[];
}

type Geometries = { geometries: { type: string; arcs: number[][] | number[][][]; properties: { code: string } }[] };

export interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { communes: Geometries } & Record<string, Geometries>;
}

// Each région is quantised to the same number of steps, so the grid runs from about 2 m
// in the north to 6 m in the larger southern régions. Six decimals holds that without
// float noise.
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function decodeTopology(topo: Topology, object = "communes"): Boundary[] {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [round(x * scale[0] + translate[0]), round(y * scale[1] + translate[1])] as Position;
    });
  });

  // Consecutive arcs share an end point, which appears once in the ring.
  const ring = (indices: number[]): Position[] => {
    const out: Position[] = [];
    for (const index of indices) {
      const arc = index < 0 ? [...arcs[~index]!].reverse() : arcs[index]!;
      out.push(...(out.length === 0 ? arc : arc.slice(1)));
    }
    return out;
  };

  return topo.objects[object]!.geometries.map((g) => ({
    codeDigits: g.properties.code,
    polygons:
      g.type === "Polygon"
        ? [(g.arcs as number[][]).map(ring)]
        : (g.arcs as number[][][]).map((rings) => rings.map(ring)),
  }));
}

/**
 * Every commune boundary, région by région, in file order, with the topology it came from.
 * The région files are the ones named by a région code; arrondissements.topojson is apart.
 */
export async function readBoundaries(
  dir: string,
): Promise<{ region: string; topology: Topology; boundaries: Boundary[] }[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{2}\.topojson$/.test(f)).sort();
  const out = [];
  for (const file of files) {
    const topology = JSON.parse(await readFile(join(dir, file), "utf8")) as Topology;
    out.push({ region: file.replace(".topojson", ""), topology, boundaries: decodeTopology(topology) });
  }
  return out;
}

/** The arrondissements, from their own file. */
export async function readArrondissements(dir: string): Promise<Boundary[]> {
  const topology = JSON.parse(await readFile(join(dir, "arrondissements.topojson"), "utf8")) as Topology;
  return decodeTopology(topology, "arrondissements");
}

/**
 * The outline of a group of communes, dissolved along the borders they share, by a
 * polygon union. Merging the TopoJSON arcs instead leaves rings open: two neighbouring
 * boundaries in OpenStreetMap don't always share every point, and the slivers between
 * them break the stitching. A real gap in the coverage, like the one near Ifrane, stays a
 * hole.
 */
export function unionOf(boundaries: Boundary[]): Polygon[] {
  const merged = polygonClipping.union(...(boundaries.map((b) => b.polygons) as [Position[][][], ...Position[][][][]]));
  return merged.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [round(x), round(y)] as Position)));
}

interface Unit {
  code: string;
  name: { fr: string; ar: string };
  type?: string;
}

/** A province or a région as a GeoJSON Feature. */
export function unitFeature(unit: Unit, polygons: Polygon[]) {
  return {
    type: "Feature" as const,
    id: unit.code,
    properties: { code: unit.code, name_fr: unit.name.fr, name_ar: unit.name.ar, ...(unit.type ? { type: unit.type } : {}) },
    geometry: geometry(polygons),
  };
}

export const ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0, opendatacommons.org/licenses/odbl/1-0/";

interface Named {
  code: string;
  name: { fr: string; ar: string };
  type: string;
}

const geometry = (polygons: Polygon[]) =>
  polygons.length === 1
    ? { type: "Polygon" as const, coordinates: polygons[0]! }
    : { type: "MultiPolygon" as const, coordinates: polygons };

/** One commune as a GeoJSON Feature, with the licence its geometry carries. */
export function communeFeature(boundary: Boundary, commune: Named) {
  return {
    type: "Feature" as const,
    id: commune.code,
    properties: { code: commune.code, name_fr: commune.name.fr, name_ar: commune.name.ar, type: commune.type },
    geometry: geometry(boundary.polygons),
  };
}

/** A région's communes as one GeoJSON FeatureCollection. */
export function regionCollection(boundaries: Boundary[], byDigits: Map<string, Named>) {
  return {
    type: "FeatureCollection" as const,
    attribution: ATTRIBUTION,
    features: boundaries.map((b) => {
      const commune = byDigits.get(b.codeDigits);
      if (!commune) throw new Error(`a boundary names ${b.codeDigits}, which no commune has`);
      return communeFeature(b, commune);
    }),
  };
}
