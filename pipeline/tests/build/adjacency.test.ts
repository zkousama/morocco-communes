import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildAdjacency, distance, neighboursOf, type Border } from "../../src/build/adjacency.ts";
import { checkAdjacency } from "../../src/validate/adjacency.ts";

const borders = JSON.parse(readFileSync("data/v1/geometry/adjacency.json", "utf8")) as {
  code: string;
  neighbours: { code: string; km: number }[];
}[];
const communes = JSON.parse(readFileSync("data/v1/attributes/communes.json", "utf8")) as {
  code: string;
  areaKm2: number | null;
}[];
const mapped = new Set(communes.filter((c) => c.areaKm2 !== null).map((c) => c.code));
const pairs: Border[] = borders.flatMap((row) =>
  row.neighbours.filter((n) => row.code < n.code).map((n) => ({ a: row.code, b: n.code, km: n.km })),
);

describe("distance", () => {
  it("measures a degree of latitude at about 111 km", () => {
    expect(distance([0, 0], [0, 1])).toBeCloseTo(111.19, 1);
  });

  it("is zero between a point and itself", () => {
    expect(distance([-7.59, 33.57], [-7.59, 33.57])).toBe(0);
  });
});

describe("buildAdjacency", () => {
  it("takes a shared segment as a border and a shared corner as nothing", () => {
    // Two squares side by side, and a third meeting them at one corner only.
    const square = (x: number, y: number): [number, number][] => [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ];
    const feature = (outer: [number, number][][]) => ({ outer, inner: [] }) as never;
    const built = buildAdjacency(
      new Map([
        ["1", feature([square(0, 0)])],
        ["2", feature([square(1, 0)])],
        ["3", feature([square(2, 1)])],
      ]),
      new Map([
        ["1", "01.001.01.01"],
        ["2", "01.001.01.02"],
        ["3", "01.001.01.03"],
      ]),
    );
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ a: "01.001.01.01", b: "01.001.01.02" });
    expect(built[0]!.km).toBeCloseTo(distance([1, 0], [1, 1]), 2);
  });
});

describe("the borders the dataset publishes", () => {
  it("covers every commune that has a boundary", () => {
    expect(borders).toHaveLength(mapped.size);
    expect(borders.every((row) => row.neighbours.length > 0)).toBe(true);
  });

  it("holds together", () => {
    expect(checkAdjacency(pairs, mapped)).toEqual([]);
  });

  it("is symmetric: each commune is in its neighbours' lists too", () => {
    const of = neighboursOf(pairs);
    for (const row of borders) {
      const back = of.get(row.code)!.map((n) => n.code).sort();
      expect(row.neighbours.map((n) => n.code).sort(), row.code).toEqual(back);
    }
  });

  it("catches a pair listed one way only", () => {
    expect(checkAdjacency([{ a: "01.051.01.01", b: "01.051.01.01", km: 1 }], mapped).join()).toMatch(/borders itself/);
    expect(checkAdjacency([{ a: "01.051.01.09", b: "01.051.01.01", km: 1 }], mapped).join()).toMatch(/not in code order/);
  });

  it("catches a border that leaves communes unreachable", () => {
    const problems = checkAdjacency([{ a: "01.051.01.01", b: "01.051.01.09", km: 2.49 }], mapped);
    expect(problems.join()).toMatch(/border nothing/);
  });
});
