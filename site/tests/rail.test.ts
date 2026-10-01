import { describe, expect, it } from "vitest";
import { connected, lengthKm, networkOf, type OsmWay } from "../scripts/railNetwork.ts";

const way = (id: number, kind: "rail" | "tram", nodes: [number, number, number][]): OsmWay => ({
  id,
  kind,
  nodes: nodes.map(([node, lng, lat]) => ({ id: node, lng, lat })),
});

describe("the railway the commuting map draws", () => {
  // A line along the coast in 3 ways joined end to end, and a short track on its own inland.
  const main = [
    way(1, "rail", [[1, -7.0, 33.0], [2, -7.0, 33.05]]),
    way(2, "rail", [[2, -7.0, 33.05], [3, -7.0, 33.1]]),
    way(3, "rail", [[3, -7.0, 33.1], [4, -7.05, 33.15], [5, -7.1, 33.2]]),
  ];
  const quarry = way(9, "rail", [[90, -9.14, 30.212], [91, -9.151, 30.217]]);

  it("measures a way along the ground", () => {
    expect(lengthKm(main[0]!)).toBeCloseTo(5.56, 1);
  });

  it("joins ways that share a node, and leaves apart ways that don't", () => {
    const groups = connected([...main, quarry]);
    expect(groups.map((g) => g.map((w) => w.id).sort())).toEqual([[1, 2, 3], [9]]);
  });

  it("drops a track that joins no line of any length, and keeps the line", () => {
    const { kept, dropped } = networkOf([...main, quarry], { rail: 5, tram: 2 });
    expect(kept.map((w) => w.id)).toEqual([1, 2, 3]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.km).toBeCloseTo(1.2, 1);
  });

  it("holds a tram to its own, shorter, bar", () => {
    const tram = [way(20, "tram", [[200, -6.85, 34.0], [201, -6.85, 34.02]])];
    expect(networkOf(tram, { rail: 5, tram: 2 }).kept).toHaveLength(1);
    expect(networkOf(tram, { rail: 5, tram: 3 }).kept).toHaveLength(0);
  });
});
