/**
 * Everything the région, province and commune pages are built from, read once from
 * data/v1 at build time: the records, the links between them, ranks, the communes each one
 * borders, and small maps drawn from the same boundaries the API serves.
 */
import { readFileSync } from "node:fs";
import { readBoundaries, type Topology } from "../../../api/src/emit/boundaries.ts";
import { buildGeometry } from "../../../api/src/emit/geometry.ts";
import { boxOf, fit, pathOf, simplify, type Point } from "./geo.ts";

interface Name {
  fr: string;
  ar: string;
}

export interface Region {
  code: string;
  name: Name;
  slug: string;
  population: { "2024": { total: number; households: number | null } };
  provinceCount: number;
  communeCount: number;
}

export interface Province {
  code: string;
  name: Name;
  slug: string;
  type: "province" | "prefecture" | "prefecture_of_arrondissements";
  regionCode: string;
  population: { "2024": { total: number; households: number | null } };
  cercleCount: number;
  communeCount: number;
}

export interface Cercle {
  code: string;
  name: Name;
  provinceCode: string;
}

export interface Commune {
  code: string;
  codeDigits: string;
  slug: string;
  name: Name;
  type: "urban" | "rural";
  parents: { region: string; province: string; cercle: string | null };
  population: {
    "2024": { total: number; moroccan: number | null; foreign: number | null; households: number | null };
    "2014": { total: number | null; households: number | null } | null;
    change: { absolute: number; pct: number; basis: string } | null;
  };
  urbanCentres: { name: string; population: number | null }[];
  centroid: { lat: number; lng: number } | null;
  areaKm2: number | null;
  density: number | null;
  osm: { relationId: number; wikidata: string | null } | null;
}

export interface Arrondissement {
  code: string;
  name: Name;
  communeCode: string;
  prefectureOfArrondissementsCode: string | null;
  population: { "2024": { total: number } };
}

const read = <T>(name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as T[];

export const slugify = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const regions = read<Omit<Region, "slug">>("regions").map((r) => ({ ...r, slug: slugify(r.name.fr) })) as Region[];
export const provinces = read<Omit<Province, "slug">>("provinces").map((p) => ({ ...p, slug: slugify(p.name.fr) })) as Province[];
export const cercles = read<Cercle>("cercles");
export const communes = read<Commune>("communes");
export const arrondissements = read<Arrondissement>("arrondissements");

for (const [level, list] of [["région", regions], ["province", provinces]] as const) {
  const seen = new Set<string>();
  for (const unit of list) {
    if (seen.has(unit.slug)) throw new Error(`two ${level}s share the slug ${unit.slug}`);
    seen.add(unit.slug);
  }
}

export const regionOf = new Map(regions.map((r) => [r.code, r]));
export const provinceOf = new Map(provinces.map((p) => [p.code, p]));
export const cercleOf = new Map(cercles.map((c) => [c.code, c]));
export const communeOf = new Map(communes.map((c) => [c.code, c]));

const byPopulation = (a: { population: { "2024": { total: number } } }, b: typeof a) =>
  b.population["2024"].total - a.population["2024"].total;

/** 1 for the largest commune in the country. */
export const nationalRank = new Map([...communes].sort(byPopulation).map((c, i) => [c.code, i + 1]));

export const communesIn = (provinceCode: string) =>
  communes.filter((c) => c.parents.province === provinceCode).sort(byPopulation);
export const provincesIn = (regionCode: string) =>
  provinces.filter((p) => p.regionCode === regionCode).sort(byPopulation);
export const arrondissementsOf = (communeCode: string) =>
  arrondissements.filter((a) => a.communeCode === communeCode).sort(byPopulation);
export const arrondissementsInPrefecture = (code: string) =>
  arrondissements.filter((a) => a.prefectureOfArrondissementsCode === code).sort(byPopulation);

/** The country's change between the censuses, over the communes that have both figures. */
export const nationalChange = (() => {
  let before = 0;
  let after = 0;
  for (const c of communes) {
    if (c.population["2014"]?.total == null) continue;
    before += c.population["2014"].total;
    after += c.population["2024"].total;
  }
  return ((after - before) / before) * 100;
})();

// Boundaries --------------------------------------------------------------------------

const files = await readBoundaries("data/v1/geometry");
const digitsToCode = new Map(communes.map((c) => [c.codeDigits, c.code]));

interface Decoded {
  topology: Topology;
  arcs: Point[][];
}
const decoded = new Map<string, Decoded>(
  files.map(({ region, topology }) => {
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
    return [region, { topology, arcs }];
  }),
);

/**
 * The communes each commune borders. Two communes border each other when their boundaries
 * share points: within a région they share whole arcs, and across a région line they're
 * the same OpenStreetMap nodes, quantised by two files, so points are matched at about
 * 10 m. Three shared points make a border; one is only a corner.
 */
export const neighbours = (() => {
  const at = new Map<string, Set<string>>();
  for (const { region, boundaries } of files) {
    void region;
    for (const b of boundaries) {
      const code = digitsToCode.get(b.codeDigits)!;
      for (const ring of b.polygons.flat()) {
        for (const [lng, lat] of ring) {
          const key = `${lng.toFixed(4)},${lat.toFixed(4)}`;
          const set = at.get(key) ?? new Set<string>();
          set.add(code);
          at.set(key, set);
        }
      }
    }
  }
  const shared = new Map<string, number>();
  for (const set of at.values()) {
    if (set.size < 2) continue;
    const list = [...set];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = list[i]! < list[j]! ? `${list[i]}|${list[j]}` : `${list[j]}|${list[i]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }
  const out = new Map<string, string[]>();
  for (const [pair, count] of shared) {
    if (count < 3) continue;
    const [a, b] = pair.split("|") as [string, string];
    out.set(a, [...(out.get(a) ?? []), b]);
    out.set(b, [...(out.get(b) ?? []), a]);
  }
  return out;
})();

export interface Drawing {
  viewBox: string;
  shapes: { code: string; d: string }[];
  /** The outline of everything drawn, for a heavier line around it. */
  outline: string;
}

/**
 * Communes of one région file drawn into a box `width` wide, simplified arc by arc so
 * neighbours share their edges exactly.
 */
function draw(region: string, codes: Set<string>, width: number): Drawing {
  const { topology, arcs } = decoded.get(region)!;
  const geometries = topology.objects.communes.geometries.filter((g) => codes.has(digitsToCode.get(g.properties.code)!));
  const listsOf = (g: (typeof geometries)[number]) =>
    g.type === "Polygon" ? (g.arcs as number[][]) : (g.arcs as number[][][]).flat();
  const used = new Set(geometries.flatMap((g) => listsOf(g).flat().map((i) => (i < 0 ? ~i : i))));
  const { height, unit, project } = fit(boxOf([...used].map((i) => arcs[i]!)), width);
  const drawn = new Map([...used].map((i) => [i, simplify(arcs[i]!, 0.9 * unit).map(project)]));
  const raw = new Map([...used].map((i) => [i, arcs[i]!.map(project)]));
  const join = (source: Map<number, Point[]>, indices: number[]) => {
    const points: Point[] = [];
    for (const index of indices) {
      const arc = index < 0 ? [...source.get(~index)!].reverse() : source.get(index)!;
      points.push(...(points.length === 0 ? arc : arc.slice(1)));
    }
    return points;
  };
  const ring = (indices: number[]) => {
    const simple = join(drawn, indices);
    return new Set(simple.map((p) => p.join())).size >= 3 ? simple : join(raw, indices);
  };
  const uses = new Map<number, number>();
  const shapes = geometries.map((g) => {
    for (const i of listsOf(g).flat()) uses.set(i < 0 ? ~i : i, (uses.get(i < 0 ? ~i : i) ?? 0) + 1);
    return { code: digitsToCode.get(g.properties.code)!, d: listsOf(g).map((l) => pathOf(ring(l), true)).join("") };
  });
  const outline = [...uses].filter(([, n]) => n % 2 === 1).map(([i]) => pathOf(drawn.get(i)!, false)).join("");
  return { viewBox: `0 0 ${width} ${height}`, shapes, outline };
}

const provinceDrawings = new Map<string, Drawing>();
/** A province's communes. Null for a préfecture d'arrondissements, which has none. */
export function drawProvince(code: string): Drawing | null {
  if (provinceDrawings.has(code)) return provinceDrawings.get(code)!;
  const inside = communes.filter((c) => c.parents.province === code && c.areaKm2 !== null);
  if (inside.length === 0) return null;
  const drawing = draw(inside[0]!.parents.region, new Set(inside.map((c) => c.code)), 400);
  provinceDrawings.set(code, drawing);
  return drawing;
}

// The province and région outlines, unioned from their communes by the same build step
// that writes them to the API.
const geometry = await buildGeometry("data/v1", { communes, provinces, regions });
const outerRings = (g: { type: string; coordinates: unknown }): Point[][] =>
  (g.type === "Polygon" ? [g.coordinates as Point[][]] : (g.coordinates as Point[][][])).map((polygon) => polygon[0]!);

const regionDrawings = new Map<string, Drawing & { provinces: { code: string; d: string }[] }>();
/** A région's communes, with its provinces outlined over them. */
export function drawRegion(code: string) {
  if (regionDrawings.has(code)) return regionDrawings.get(code)!;
  const inside = communes.filter((c) => c.parents.region === code && c.areaKm2 !== null);
  const base = draw(code, new Set(inside.map((c) => c.code)), 440);
  // The same projection draw() fitted, from the same arcs.
  const { topology, arcs } = decoded.get(code)!;
  const used = topology.objects.communes.geometries.flatMap((g) => {
    const lists = g.type === "Polygon" ? (g.arcs as number[][]) : (g.arcs as number[][][]).flat();
    return lists.flat().map((i) => arcs[i < 0 ? ~i : i]!);
  });
  const { unit, project } = fit(boxOf(used), 440);
  const provinceLines = [...new Set(inside.map((c) => c.parents.province))].map((p) => ({
    code: p,
    d: outerRings(geometry.provinceOutlines.get(p)!.geometry)
      .map((ring) => pathOf(simplify(ring, 0.9 * unit).map(project), true))
      .join(""),
  }));
  const drawing = { ...base, provinces: provinceLines };
  regionDrawings.set(code, drawing);
  return drawing;
}

const country = (() => {
  const rings = [...geometry.regionOutlines.values()].flatMap((f) => outerRings(f.geometry));
  const { height, unit, project } = fit(boxOf(rings), 140, 1);
  const outline = rings.map((ring) => pathOf(simplify(ring, 1.2 * unit).map(project), true)).join("");
  return { viewBox: `0 0 140 ${height}`, outline, project, unit };
})();
const insets = new Map<string, string>();

/** Morocco, small, with one région or province filled in: where on the map the page is. */
export function inset(highlight: { region: string; province?: string }) {
  const key = highlight.province ?? highlight.region;
  if (!insets.has(key)) {
    const feature = highlight.province
      ? geometry.provinceOutlines.get(highlight.province)
      : geometry.regionOutlines.get(highlight.region);
    const filled = feature
      ? outerRings(feature.geometry)
          .map((ring) => pathOf(simplify(ring, 0.8 * country.unit).map(country.project), true))
          .join("")
      : "";
    insets.set(key, filled);
  }
  return { viewBox: country.viewBox, outline: country.outline, filled: insets.get(key)! };
}

// Charts --------------------------------------------------------------------------------

/** Every commune's change since 2014, binned, for the "where it sits" chart. */
export const changeBins = (() => {
  const width = 5;
  const lo = -40;
  const hi = 100;
  const bins = new Array((hi - lo) / width).fill(0) as number[];
  for (const c of communes) {
    const pct = c.population.change?.pct;
    if (pct === undefined) continue;
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((pct - lo) / width)));
    bins[i]!++;
  }
  return { lo, hi, width, bins, max: Math.max(...bins) };
})();
