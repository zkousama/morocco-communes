import { describe, expect, it } from "vitest";
import { assembleRings, isClosed, ringArea, type Ring } from "../../src/geo/rings.ts";

const pt = (lon: number, lat: number) => ({ lat, lon });

describe("assembleRings", () => {
  it("closes a ring split across two ways", () => {
    const { outer } = assembleRings([
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(1, 0)] },
      { type: "way", role: "outer", geometry: [pt(1, 0), pt(1, 1), pt(0, 0)] },
    ]);
    expect(outer).toHaveLength(1);
    expect(outer[0]![0]).toEqual(outer[0]![outer[0]!.length - 1]);
    expect(outer[0]).toHaveLength(4);
  });

  it("reverses a way whose direction does not match", () => {
    const { outer } = assembleRings([
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(1, 0)] },
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(1, 1), pt(1, 0)] },
    ]);
    expect(outer).toHaveLength(1);
    expect(outer[0]![0]).toEqual(outer[0]![outer[0]!.length - 1]);
  });

  it("keeps separate rings separate, which is how an exclave survives", () => {
    const { outer } = assembleRings([
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 0)] },
      { type: "way", role: "outer", geometry: [pt(5, 5), pt(6, 5), pt(6, 6), pt(5, 5)] },
    ]);
    expect(outer).toHaveLength(2);
  });

  it("separates inner rings from outer ones", () => {
    const { outer, inner } = assembleRings([
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 0)] },
      { type: "way", role: "inner", geometry: [pt(1, 1), pt(2, 1), pt(2, 2), pt(1, 1)] },
    ]);
    expect(outer).toHaveLength(1);
    expect(inner).toHaveLength(1);
  });

  it("treats a member with no role as outer, which Overpass does emit", () => {
    const { outer } = assembleRings([
      { type: "way", role: "", geometry: [pt(0, 0), pt(3, 0), pt(3, 3), pt(0, 0)] },
    ]);
    expect(outer).toHaveLength(1);
  });

  it("ignores node members and ways carrying no geometry", () => {
    const { outer } = assembleRings([
      { type: "node", role: "admin_centre" },
      { type: "way", role: "outer" },
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 0)] },
    ]);
    expect(outer).toHaveLength(1);
  });

  it("returns a ring it could not close instead of dropping or throwing", () => {
    const { outer } = assembleRings([
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(1, 0), pt(1, 1)] },
    ]);
    expect(outer).toHaveLength(1);
    expect(isClosed(outer[0]!)).toBe(false);
  });

  it("returns both fragments, still open, when they cannot reach each other", () => {
    const { outer } = assembleRings([
      { type: "way", role: "outer", geometry: [pt(0, 0), pt(1, 0)] },
      { type: "way", role: "outer", geometry: [pt(5, 5), pt(6, 5)] },
    ]);
    expect(outer).toHaveLength(2);
    expect(outer.every((r) => !isClosed(r))).toBe(true);
  });
});

describe("isClosed", () => {
  it("needs a repeated endpoint and more than three positions", () => {
    expect(isClosed([[0, 0], [1, 0], [1, 1], [0, 0]])).toBe(true);
    expect(isClosed([[0, 0], [1, 0], [1, 1]])).toBe(false);
    // Three positions can only encode two distinct points, never a triangle.
    expect(isClosed([[0, 0], [1, 0], [0, 0]])).toBe(false);
  });
});

describe("ringArea", () => {
  it("orders rings by size and ignores winding direction", () => {
    const unit: Ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const larger: Ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    expect(ringArea(unit)).toBeCloseTo(1);
    expect(ringArea(larger)).toBeCloseTo(4);
    expect(ringArea([...unit].reverse() as Ring)).toBeCloseTo(1);
  });
});
