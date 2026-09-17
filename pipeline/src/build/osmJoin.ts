import { toDigits } from "../lib/codes.ts";
import { assembleRings, isClosed, type Ring } from "../geo/rings.ts";
import { boundingBox, interiorPoint } from "../geo/point.ts";
import type { OverpassRelation } from "../sources/overpass.ts";

export interface OsmFeature {
  codeDigits: string;
  relationId: number;
  wikidata: string | null;
  centroid: { lat: number; lng: number };
  bbox: [number, number, number, number];
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
    const unclosed = outer.filter((r) => !isClosed(r)).length;
    if (unclosed > 0) {
      rejected.push({ relationId: relation.id, ref, reason: `${unclosed} unclosed outer ring(s)` });
      continue;
    }

    features.set(codeDigits, {
      codeDigits,
      relationId: relation.id,
      wikidata: relation.tags["wikidata"] ?? null,
      centroid: interiorPoint(outer, inner),
      bbox: boundingBox(outer),
      outer,
      inner,
    });
  }

  return { features, unmatched, rejected };
}
