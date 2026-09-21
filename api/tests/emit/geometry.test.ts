import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGeometry, type Geometry } from "../../src/emit/geometry.ts";
import { clipRing } from "../../src/emit/tiles.ts";
import { communeIn, featureContaining, prepareIndex, tileAt, type PreparedIndex } from "../../src/lib/locate.ts";
import { sphericalArea } from "../../../pipeline/src/geo/rings.ts";

interface Commune {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
  type: string;
  centroid: { lat: number; lng: number } | null;
}
const read = <T>(name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as T[];
const communes = read<Commune>("communes");
const provinces = read<{ code: string; name: { fr: string; ar: string }; type: string; communeCount: number }>("provinces");

let geometry: Geometry;
let index: PreparedIndex;
beforeAll(async () => {
  geometry = await buildGeometry("data/v1", {
    communes: communes as never[],
    provinces,
    regions: read("regions"),
    arrondissements: read("arrondissements"),
  });
  index = prepareIndex(geometry.tileIndex);
  uncut = [...geometry.communes].map(([code, feature]) => {
    const g = feature.geometry;
    const rings = (g.type === "Polygon" ? g.coordinates : g.coordinates.flat()) as [number, number][][];
    const xs = rings.flat().map((p) => p[0]);
    const ys = rings.flat().map((p) => p[1]);
    return { code, rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
});

const locate = (lat: number, lng: number) => {
  const key = tileAt(index, lat, lng);
  return key ? communeIn(geometry.tiles.get(key)!, lat, lng) : null;
};

/** The slow way: every ring of every commune, uncut, skipping only those whose box misses. */
let uncut: { code: string; rings: [number, number][][]; box: [number, number, number, number] }[] = [];
const bruteForce = (lat: number, lng: number) => {
  for (const { code, rings, box } of uncut) {
    if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) continue;
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return code;
  }
  return null;
};

/** A seeded generator, so a failure can be run again. */
const random = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe("clipRing", () => {
  it("cuts a square down to the part inside a rectangle", () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    expect(clipRing(square, [2, -1, 6, 3])).toEqual([[2, 3], [2, 0], [4, 0], [4, 3]]);
    expect(clipRing(square, [5, 5, 6, 6])).toEqual([]);
  });
});

describe("the boundary tiles", () => {
  it("find each commune at the point the dataset gives as inside it", () => {
    const wrong = communes
      .filter((c) => c.centroid)
      .filter((c) => locate(c.centroid!.lat, c.centroid!.lng) !== c.code)
      .map((c) => c.code);
    expect(wrong).toEqual([]);
  });

  it("agree with a test against the uncut boundaries at random points", () => {
    const next = random(20260919);
    const areas: [number, number, number, number, number][] = [
      // The whole country, then the dense north-west where the tiles are cut finest.
      [20.7, 35.95, -17.2, -0.95, 3000],
      [33.4, 34.1, -7.8, -6.7, 2000],
    ];
    const differ: string[] = [];
    for (const [s, n, w, e, count] of areas) {
      for (let i = 0; i < count; i++) {
        const lat = s + next() * (n - s);
        const lng = w + next() * (e - w);
        const a = locate(lat, lng);
        const b = bruteForce(lat, lng);
        if (a !== b) differ.push(`${lat.toFixed(5)},${lng.toFixed(5)}: ${a} vs ${b}`);
      }
    }
    expect(differ).toEqual([]);
  });

  it("find nothing at sea or outside the country", () => {
    expect(locate(36.5, -12)).toBeNull();
    expect(locate(48.85, 2.35)).toBeNull();
  });
});

describe("the GeoJSON", () => {
  it("has a closed boundary for every commune but one", () => {
    expect(geometry.communes.size).toBe(1502);
    for (const [code, feature] of geometry.communes) {
      const g = feature.geometry;
      for (const ring of g.type === "Polygon" ? g.coordinates : g.coordinates.flat()) {
        expect(ring.length, code).toBeGreaterThanOrEqual(4);
        expect(ring[0], code).toEqual(ring[ring.length - 1]);
      }
    }
  });

  it("outlines every région, and every province that has communes", () => {
    expect(geometry.regionOutlines.size).toBe(12);
    const withCommunes = provinces.filter((p) => p.communeCount > 0).map((p) => p.code).sort();
    expect([...geometry.provinceOutlines.keys()].sort()).toEqual(withCommunes);
  });

  it("closes every ring of every outline", () => {
    for (const feature of [...geometry.provinceOutlines.values(), ...geometry.regionOutlines.values()]) {
      const g = feature.geometry;
      for (const ring of g.type === "Polygon" ? g.coordinates : g.coordinates.flat()) {
        expect(ring[0], feature.properties.code).toEqual(ring[ring.length - 1]);
      }
    }
  });

  it("covers the same ground as the communes inside it", () => {
    // Holes are subtracted; slivers between neighbours are the only difference allowed.
    const area = (g: { type: string; coordinates: unknown }) => {
      const polygons = g.type === "Polygon" ? [g.coordinates as [number, number][][]] : (g.coordinates as [number, number][][][]);
      return polygons.reduce((sum, [outer, ...holes]) => sum + sphericalArea(outer!) - holes.reduce((h, r) => h + sphericalArea(r), 0), 0);
    };
    for (const [code, feature] of geometry.regionOutlines) {
      const parts = [...geometry.communes.values()].filter((f) => f.properties.code.startsWith(`${code}.`));
      const sum = parts.reduce((s, f) => s + area(f.geometry), 0);
      expect(Math.abs(area(feature.geometry) - sum) / sum, code).toBeLessThan(0.005);
    }
  });

  it("dissolves the borders inside a province, so its outline has far fewer points", () => {
    // Tanger-Assilah: its 12 communes, against the one outline they make.
    const points = (g: { type: string; coordinates: unknown }) => JSON.stringify(g.coordinates).split("],[").length;
    const inside = [...geometry.communes.values()].filter((f) => f.properties.code.startsWith("01.511."));
    const sum = inside.reduce((n, f) => n + points(f.geometry), 0);
    expect(points(geometry.provinceOutlines.get("01.511")!.geometry)).toBeLessThan(sum / 2);
  });

  it("has all 41 arrondissements, grouped under the 6 cities, each finding itself at its inside point", () => {
    expect(geometry.arrondissements.size).toBe(41);
    expect([...geometry.arrondissementsByCommune.keys()].sort()).toEqual(
      ["01.511.01.0", "03.231.01.0", "04.421.01.0", "04.441.01.0", "06.141.01.0", "07.351.01.0"].sort(),
    );
    const records = read<{ code: string; communeCode: string; centroid: { lat: number; lng: number } }>("arrondissements");
    for (const a of records) {
      const city = geometry.arrondissementsByCommune.get(a.communeCode)!;
      expect(featureContaining(city.features as never[], a.centroid.lat, a.centroid.lng), a.code).toMatchObject({ id: a.code });
      // The same point is in the city by the commune tiles.
      expect(locate(a.centroid.lat, a.centroid.lng), a.code).toBe(a.communeCode);
    }
  });

  it("puts each commune in its own région's file", () => {
    for (const [region, collection] of geometry.regions) {
      for (const f of collection.features) expect(f.properties.code.slice(0, 2), f.properties.code).toBe(region);
    }
  });
});
