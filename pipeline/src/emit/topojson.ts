import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { topology } from "topojson-server";
import { pointInRing } from "../geo/point.ts";
import type { OsmFeature } from "../build/osmJoin.ts";
import type { Ring } from "../geo/rings.ts";

export interface GeoJsonFeature {
  type: "Feature";
  properties: { code: string; name?: string };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
}
export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

/**
 * Each outer ring paired with the holes that sit inside it. A commune can have both
 * several outer rings and a hole — Rabat has four outer rings and one hole — so
 * attaching holes to the first polygon only, or dropping them whenever there is more
 * than one outer ring, silently loses them. Containment uses the same every-vertex
 * rule as the interior point, so the two agree about which ring owns a hole.
 */
function polygons(f: OsmFeature): Ring[][] {
  return f.outer.map((ring) => [
    ring,
    ...f.inner.filter((h) => h.every((p) => pointInRing(p, ring))),
  ]);
}

export interface GeometryAnomaly {
  code: string;
  kind: "orphan_hole";
  detail: string;
}

/**
 * Anomalies that would otherwise pass in silence. Two can happen:
 *
 * A hole contained by no outer ring is dropped by `polygons()` without trace. That is
 * malformed OSM data rather than something to repair here, but it should be visible.
 *
 * Collapsed rings are NOT checked here. A ring can only collapse under quantisation, and
 * quantisation happens inside `topology()`, so counting distinct points on the raw ring
 * would guard the wrong side of the transform. `writeGeometry` checks the emitted topology
 * instead.
 */
export function findAnomalies(features: OsmFeature[]): GeometryAnomaly[] {
  const out: GeometryAnomaly[] = [];
  for (const f of features) {
    for (const hole of f.inner) {
      const owned = f.outer.some((ring) => hole.every((p) => pointInRing(p, ring)));
      if (!owned) {
        out.push({
          code: f.codeDigits,
          kind: "orphan_hole",
          detail: `a hole with ${hole.length} points sits inside none of its ${f.outer.length} outer ring(s)`,
        });
      }
    }
  }
  return out;
}

interface Topology {
  arcs: [number, number][][];
  transform?: { scale: [number, number]; translate: [number, number] };
  objects: Record<string, { geometries: { type: string; arcs: unknown; properties: { code: string } }[] }>;
}

/**
 * Rings in the EMITTED topology holding fewer than three distinct positions. This must run
 * after `topology()`: quantisation is what collapses a ring, and topojson-server's
 * `prequantize` PADS a collapsed ring by repeating its first point rather than dropping
 * it, so a vanished island would otherwise ship as a valid-looking zero-area ring.
 *
 * Arcs are delta-encoded after quantisation, so positions are recovered by cumulative sum.
 */
function degenerateRings(topo: Topology): string[] {
  const positions = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return `${x},${y}`;
    });
  });

  const out: string[] = [];
  for (const geometry of topo.objects["communes"]!.geometries) {
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.arcs as number[][]]
        : (geometry.arcs as number[][][]);
    for (const polygon of polygons) {
      for (const ring of polygon) {
        const seen = new Set<string>();
        for (const index of ring) for (const p of positions[index < 0 ? ~index : index]!) seen.add(p);
        if (seen.size < 3) {
          out.push(`${geometry.properties.code}: a ring quantised to ${seen.size} distinct position(s)`);
        }
      }
    }
  }
  return out;
}

export function toFeatureCollection(
  features: OsmFeature[],
  nameByCode: Map<string, string>,
): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => {
      const name = nameByCode.get(f.codeDigits);
      const properties = name === undefined ? { code: f.codeDigits } : { code: f.codeDigits, name };
      const rings = polygons(f);
      if (rings.length === 1) {
        return {
          type: "Feature" as const,
          properties,
          geometry: { type: "Polygon" as const, coordinates: rings[0]! },
        };
      }
      return {
        type: "Feature" as const,
        properties,
        geometry: { type: "MultiPolygon" as const, coordinates: rings },
      };
    }),
  };
}

export async function writeGeometry(
  byRegion: Map<string, OsmFeature[]>,
  nameByCode: Map<string, string>,
  dir: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [regionCode, features] of [...byRegion].sort(([a], [b]) => a.localeCompare(b))) {
    const fc = toFeatureCollection(features, nameByCode);
    // Quantisation trades a little precision for a much smaller file. 1e5 keeps
    // roughly metre-level detail, which is far finer than a commune boundary needs.
    const topo = topology({ communes: fc as never }, 1e5) as unknown as Topology;

    const collapsed = degenerateRings(topo);
    if (collapsed.length > 0) {
      throw new Error(
        `région ${regionCode}: ${collapsed.length} ring(s) collapsed under quantisation:\n  ${collapsed.join("\n  ")}`,
      );
    }

    // ODbL requires attribution to travel with the data. A single .topojson served on its
    // own would otherwise name OpenStreetMap nowhere. TopoJSON permits foreign members.
    const attributed = {
      ...topo,
      license: "ODbL-1.0",
      attribution: "© OpenStreetMap contributors, opendatacommons.org/licenses/odbl/1-0/",
      source: "OpenStreetMap admin_level=8 relations, matched to HCP communes on ref:MA:HCP",
    };
    await writeFile(join(dir, `${regionCode}.topojson`), `${JSON.stringify(attributed)}\n`);
  }
}
