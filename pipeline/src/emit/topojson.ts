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
  kind: "orphan_hole" | "degenerate_ring";
  detail: string;
}

/**
 * Anomalies that would otherwise pass in silence. Two can happen:
 *
 * A hole contained by no outer ring is dropped by `polygons()` without trace. That is
 * malformed OSM data rather than something to repair here, but it should be visible.
 *
 * A ring that quantises below four distinct points is NOT removed by topojson-server;
 * `prequantize` pads it by repeating its first point, so a collapsed island survives as
 * a degenerate zero-area ring with no error. Measured at quantisation 1e5 over the
 * cached régions: 486 rings emitted, none below 4 points and none even close. So this is
 * a guard, not a live problem — but a silently corrupt ring in a published boundary file
 * is exactly the failure this dataset exists not to have.
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
    for (const ring of [...f.outer, ...f.inner]) {
      const distinct = new Set(ring.map((p) => `${p[0]},${p[1]}`)).size;
      if (distinct < 3) {
        out.push({
          code: f.codeDigits,
          kind: "degenerate_ring",
          detail: `a ring has only ${distinct} distinct point(s)`,
        });
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
    const topo = topology({ communes: fc as never }, 1e5);
    await writeFile(join(dir, `${regionCode}.topojson`), `${JSON.stringify(topo)}\n`);
  }
}
