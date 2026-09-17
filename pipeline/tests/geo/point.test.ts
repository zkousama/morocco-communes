import { describe, expect, it } from "vitest";
import { boundingBox, interiorPoint, pointInRing } from "../../src/geo/point.ts";
import type { Ring } from "../../src/geo/rings.ts";

const square: Ring = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
// A C shape: its average vertex sits in the notch, outside the polygon.
const cShape: Ring = [
  [0, 0], [6, 0], [6, 2], [2, 2], [2, 4], [6, 4], [6, 6], [0, 6], [0, 0],
];

describe("pointInRing", () => {
  it("is true inside and false outside", () => {
    expect(pointInRing([2, 2], square)).toBe(true);
    expect(pointInRing([9, 9], square)).toBe(false);
  });
});

describe("interiorPoint", () => {
  it("returns a point inside a simple polygon", () => {
    const p = interiorPoint([square], []);
    expect(pointInRing([p.lng, p.lat], square)).toBe(true);
  });

  it("stays inside a concave polygon, where an average vertex would not", () => {
    const avgLng = cShape.slice(0, -1).reduce((n, p) => n + p[0], 0) / (cShape.length - 1);
    const avgLat = cShape.slice(0, -1).reduce((n, p) => n + p[1], 0) / (cShape.length - 1);
    expect(pointInRing([avgLng, avgLat], cShape)).toBe(false);

    const p = interiorPoint([cShape], []);
    expect(pointInRing([p.lng, p.lat], cShape)).toBe(true);
  });

  it("uses the largest ring when a commune is a multipolygon", () => {
    const tiny: Ring = [[100, 100], [100.1, 100], [100.1, 100.1], [100, 100]];
    const p = interiorPoint([tiny, square], []);
    expect(pointInRing([p.lng, p.lat], square)).toBe(true);
  });
});

describe("boundingBox", () => {
  it("covers every outer ring", () => {
    const other: Ring = [[10, 10], [12, 10], [12, 12], [10, 10]];
    expect(boundingBox([square, other])).toEqual([0, 0, 12, 12]);
  });

  it("throws rather than returning Infinity sentinels for empty input", () => {
    expect(() => boundingBox([])).toThrow(/vertex/);
    expect(() => boundingBox([[]])).toThrow(/vertex/);
  });
});

describe("interiorPoint hole handling", () => {
  it("ignores a hole that only partly overlaps the chosen ring", () => {
    // Straddles the right edge of `square`, so it belongs to neither ring cleanly.
    const straddling: Ring = [[3, 1], [5, 1], [5, 2], [3, 1]];
    const p = interiorPoint([square], [straddling]);
    expect(pointInRing([p.lng, p.lat], square)).toBe(true);
  });
});
