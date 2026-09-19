import { toDigits } from "../lib/codes.ts";
import { assembleRings, isClosed, sphericalArea, type Ring } from "../geo/rings.ts";
import { boundingBox, interiorPoint } from "../geo/point.ts";
import type { OverpassRelation } from "../sources/overpass.ts";

export interface OsmFeature {
  codeDigits: string;
  relationId: number;
  wikidata: string | null;
  centroid: { lat: number; lng: number };
  bbox: [number, number, number, number];
  /** The outer rings' area less the holes', in km². */
  areaKm2: number;
  outer: Ring[];
  inner: Ring[];
}

export function joinOsm(
  relations: OverpassRelation[],
  knownCodes: Set<string>,
): {
  features: Map<string, OsmFeature>;
  unmatched: { relationId: number; ref: string }[];
  rejected: { relationId: number; ref: string; reason: string }[];
} {
  const features = new Map<string, OsmFeature>();
  const unmatched: { relationId: number; ref: string }[] = [];
  const rejected: { relationId: number; ref: string; reason: string }[] = [];

  for (const relation of relations) {
    const ref = relation.tags["ref:MA:HCP"];
    if (!ref) continue; // Ceuta and anything else without an HCP code

    let codeDigits: string;
    try {
      codeDigits = toDigits(ref);
    } catch (err) {
      rejected.push({ relationId: relation.id, ref, reason: (err as Error).message });
      continue;
    }

    if (!knownCodes.has(codeDigits)) {
      unmatched.push({ relationId: relation.id, ref });
      continue;
    }

    const { outer, inner } = assembleRings(relation.members);
    if (outer.length === 0) {
      rejected.push({ relationId: relation.id, ref, reason: "no outer ring" });
      continue;
    }
    // Inner rings as well as outer. An open hole is invalid geometry, and polygons()
    // would write it straight into the TopoJSON with every gate still green.
    const unclosed = [...outer, ...inner].filter((r) => !isClosed(r)).length;
    if (unclosed > 0) {
      rejected.push({
        relationId: relation.id,
        ref,
        reason: unclosed === 1 ? "1 unclosed ring" : `${unclosed} unclosed rings`,
      });
      continue;
    }

    const already = features.get(codeDigits);
    if (already) {
      // Two relations claiming one commune. Keep the first and report the second
      // rather than letting Map.set overwrite it, which would leave features.size
      // one short with nothing to show why.
      rejected.push({
        relationId: relation.id,
        ref,
        reason: `duplicate code, already held by relation ${already.relationId}`,
      });
      continue;
    }

    features.set(codeDigits, {
      codeDigits,
      relationId: relation.id,
      wikidata: relation.tags["wikidata"] ?? null,
      centroid: interiorPoint(outer, inner),
      bbox: boundingBox(outer),
      areaKm2:
        outer.reduce((sum, r) => sum + sphericalArea(r), 0) - inner.reduce((sum, r) => sum + sphericalArea(r), 0),
      outer,
      inner,
    });
  }

  return { features, unmatched, rejected };
}
