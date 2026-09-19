/**
 * Everything the build writes from the boundaries: a GeoJSON file per région, a GeoJSON
 * feature per commune, and the tiles that answer "which commune is this point in". One
 * function, so the emitter, the docs and the tests all work from the same output.
 */
import { join } from "node:path";
import { ATTRIBUTION, communeFeature, readBoundaries, regionCollection } from "./boundaries.ts";
import { buildTiles } from "./tiles.ts";
import type { Tile, TileIndex } from "../lib/locate.ts";

interface CommuneLike {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
  type: string;
}

export interface Geometry {
  /** data/v1/geometry/<région>.geojson, by région code. */
  regions: Map<string, ReturnType<typeof regionCollection>>;
  /** api/communes/<code>/boundary.geojson, by commune code. */
  communes: Map<string, ReturnType<typeof communeFeature> & { attribution: string }>;
  tileIndex: TileIndex;
  tiles: Map<string, Tile>;
}

export async function buildGeometry(dataDir: string, communes: CommuneLike[]): Promise<Geometry> {
  const byDigits = new Map(communes.map((c) => [c.codeDigits, c]));
  const read = await readBoundaries(join(dataDir, "geometry"));

  const regions = new Map<string, ReturnType<typeof regionCollection>>();
  const features = new Map<string, ReturnType<typeof communeFeature> & { attribution: string }>();
  const shapes = [];
  for (const { region, boundaries } of read) {
    regions.set(region, regionCollection(boundaries, byDigits));
    for (const boundary of boundaries) {
      const commune = byDigits.get(boundary.codeDigits)!;
      features.set(commune.code, { ...communeFeature(boundary, commune), attribution: ATTRIBUTION });
      shapes.push({ code: commune.code, rings: boundary.polygons.flat() });
    }
  }

  const { index, tiles } = buildTiles(shapes);
  return { regions, communes: features, tileIndex: index, tiles };
}
