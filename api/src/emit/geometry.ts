/**
 * Everything the build writes from the boundaries: GeoJSON for every commune, province
 * and région, a file of each level for download, and the tiles that answer "which commune
 * is this point in". One function, so the emitter, the docs and the tests all work from
 * the same output.
 */
import { join } from "node:path";
import {
  ATTRIBUTION,
  communeFeature,
  readArrondissements,
  readBoundaries,
  regionCollection,
  unionOf,
  unitFeature,
  type Boundary,
} from "./boundaries.ts";
import { buildTiles } from "./tiles.ts";
import type { Tile, TileIndex } from "../lib/locate.ts";

interface CommuneLike {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
  type: string;
  parents: { region: string; province: string };
}

interface UnitLike {
  code: string;
  name: { fr: string; ar: string };
  type?: string;
}

interface ArrondissementLike {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
  communeCode: string;
}

type Feature = ReturnType<typeof unitFeature>;

export interface Geometry {
  /** data/v1/geometry/<région>.geojson: the région's communes, by région code. */
  regions: Map<string, ReturnType<typeof regionCollection>>;
  /** api/communes/<code>/boundary.geojson, by commune code. */
  communes: Map<string, ReturnType<typeof communeFeature> & { attribution: string }>;
  /** api/provinces/<code>/boundary.geojson, for each province with communes of its own. */
  provinceOutlines: Map<string, Feature & { attribution: string }>;
  /** api/regions/<code>/boundary.geojson. */
  regionOutlines: Map<string, Feature & { attribution: string }>;
  /** api/arrondissements/<code>/boundary.geojson. */
  arrondissements: Map<string, Feature & { attribution: string }>;
  /** api/communes/<code>/arrondissements.geojson, for the 6 communes that have them. */
  arrondissementsByCommune: Map<string, ReturnType<typeof collection>>;
  tileIndex: TileIndex;
  tiles: Map<string, Tile>;
}

const collection = (features: Feature[]) => ({ type: "FeatureCollection" as const, attribution: ATTRIBUTION, features });

/** data/v1/geometry/provinces.geojson, regions.geojson and arrondissements.geojson. */
export const outlineCollections = (g: Geometry) => ({
  provinces: collection([...g.provinceOutlines.values()].map(({ attribution: _, ...f }) => f)),
  regions: collection([...g.regionOutlines.values()].map(({ attribution: _, ...f }) => f)),
  arrondissements: collection([...g.arrondissements.values()].map(({ attribution: _, ...f }) => f)),
});

export async function buildGeometry(
  dataDir: string,
  records: { communes: CommuneLike[]; provinces: UnitLike[]; regions: UnitLike[]; arrondissements: ArrondissementLike[] },
): Promise<Geometry> {
  const byDigits = new Map(records.communes.map((c) => [c.codeDigits, c]));
  const provinceOf = new Map(records.provinces.map((p) => [p.code, p]));
  const regionOf = new Map(records.regions.map((r) => [r.code, r]));
  const read = await readBoundaries(join(dataDir, "geometry"));

  const regions = new Map<string, ReturnType<typeof regionCollection>>();
  const features = new Map<string, ReturnType<typeof communeFeature> & { attribution: string }>();
  const provinceOutlines = new Map<string, Feature & { attribution: string }>();
  const regionOutlines = new Map<string, Feature & { attribution: string }>();
  const shapes = [];
  for (const { region, boundaries } of read) {
    regions.set(region, regionCollection(boundaries, byDigits));

    const byProvince = new Map<string, Boundary[]>();
    for (const boundary of boundaries) {
      const commune = byDigits.get(boundary.codeDigits)!;
      features.set(commune.code, { ...communeFeature(boundary, commune), attribution: ATTRIBUTION });
      shapes.push({ code: commune.code, rings: boundary.polygons.flat() });
      byProvince.set(commune.parents.province, [...(byProvince.get(commune.parents.province) ?? []), boundary]);
    }

    regionOutlines.set(region, { ...unitFeature(regionOf.get(region)!, unionOf(boundaries)), attribution: ATTRIBUTION });
    for (const [code, group] of [...byProvince].sort(([a], [b]) => a.localeCompare(b))) {
      const province = provinceOf.get(code);
      if (!province) throw new Error(`communes name province ${code}, which isn't in the dataset`);
      provinceOutlines.set(code, { ...unitFeature(province, unionOf(group)), attribution: ATTRIBUTION });
    }
  }

  const arrondissementOf = new Map(records.arrondissements.map((a) => [a.codeDigits, a]));
  const arrondissements = new Map<string, Feature & { attribution: string }>();
  const arrondissementsByCommune = new Map<string, ReturnType<typeof collection>>();
  for (const boundary of await readArrondissements(join(dataDir, "geometry"))) {
    const a = arrondissementOf.get(boundary.codeDigits);
    if (!a) throw new Error(`an arrondissement boundary names ${boundary.codeDigits}, which no arrondissement has`);
    const feature = { ...unitFeature(a, boundary.polygons), attribution: ATTRIBUTION };
    arrondissements.set(a.code, feature);
    const { attribution: _, ...bare } = feature;
    const group = arrondissementsByCommune.get(a.communeCode) ?? collection([]);
    group.features.push(bare);
    arrondissementsByCommune.set(a.communeCode, group);
  }

  const { index, tiles } = buildTiles(shapes);
  return {
    regions,
    communes: features,
    provinceOutlines,
    regionOutlines,
    arrondissements,
    arrondissementsByCommune,
    tileIndex: index,
    tiles,
  };
}
