import { describe, expect, it } from "vitest";
import { toFeatureCollection } from "../../src/emit/topojson.ts";
import type { OsmFeature } from "../../src/build/osmJoin.ts";

const feature = (codeDigits: string): OsmFeature => ({
  codeDigits,
  relationId: 7,
  wikidata: null,
  centroid: { lat: 2, lng: 2 },
  bbox: [0, 0, 4, 4],
  outer: [[[0, 0], [4, 0], [4, 4], [0, 0]]],
  inner: [],
});

describe("toFeatureCollection", () => {
  const fc = toFeatureCollection([feature("015110519")], new Map([["015110519", "Hjar Ennhal"]]));

  it("produces a FeatureCollection of polygons", () => {
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0]!.geometry.type).toBe("Polygon");
  });

  it("carries the code and name as properties so a map can label itself", () => {
    expect(fc.features[0]!.properties).toEqual({ code: "015110519", name: "Hjar Ennhal" });
  });

  it("uses MultiPolygon when a commune has more than one outer ring", () => {
    const multi = { ...feature("015110507"), outer: [
      [[0, 0], [1, 0], [1, 1], [0, 0]] as [number, number][],
      [[5, 5], [6, 5], [6, 6], [5, 5]] as [number, number][],
    ] };
    const out = toFeatureCollection([multi], new Map());
    expect(out.features[0]!.geometry.type).toBe("MultiPolygon");
  });

  it("keeps a hole on the outer ring that contains it, even across several rings", () => {
    // Rabat's shape: one large ring with a hole, plus small detached rings.
    const mainland: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole: [number, number][] = [[2, 2], [4, 2], [4, 4], [2, 2]];
    const island: [number, number][] = [[20, 20], [21, 20], [21, 21], [20, 20]];
    const out = toFeatureCollection(
      [{ ...feature("015110507"), outer: [mainland, island], inner: [hole] }],
      new Map(),
    );
    const geometry = out.features[0]!.geometry;
    expect(geometry.type).toBe("MultiPolygon");
    const coords = geometry.coordinates as [number, number][][][];
    expect(coords[0]).toHaveLength(2); // mainland keeps its hole
    expect(coords[0]![1]).toEqual(hole);
    expect(coords[1]).toHaveLength(1); // the island has none
  });

  it("keeps a hole on a single-ring commune", () => {
    const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole: [number, number][] = [[2, 2], [4, 2], [4, 4], [2, 2]];
    const out = toFeatureCollection(
      [{ ...feature("015110519"), outer: [ring], inner: [hole] }],
      new Map(),
    );
    expect(out.features[0]!.geometry.type).toBe("Polygon");
    expect(out.features[0]!.geometry.coordinates).toHaveLength(2);
  });
});
