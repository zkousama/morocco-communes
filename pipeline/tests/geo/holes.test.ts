import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkHoles, coverageHoles, type TopologyLike } from "../../src/geo/holes.ts";

const topo = (region: string) =>
  JSON.parse(readFileSync(`data/v1/geometry/${region}.topojson`, "utf8")) as TopologyLike;

describe("coverageHoles", () => {
  it("finds the land near Ifrane that no commune polygon covers", () => {
    const holes = coverageHoles(topo("03"));
    expect(holes.length).toBe(1);
    const [hole] = holes;
    expect(hole!.areaKm2).toBeGreaterThan(85);
    expect(hole!.areaKm2).toBeLessThan(91);
    expect(hole!.centre.lat).toBeCloseTo(33.48, 1);
    expect(hole!.centre.lng).toBeCloseTo(-5.02, 1);
    // Ben Smim, Dayat-Aoua, Guigou, Ifrane, Timahdite and Tizguite.
    expect(hole!.bordering.length).toBe(6);
  });

  it("finds no other hole in any région", () => {
    const files = readdirSync("data/v1/geometry").filter((f) => /^\d{2}\.topojson$/.test(f));
    expect(files.length).toBe(12);
    const all = files.flatMap((f) => coverageHoles(topo(f.slice(0, 2))));
    expect(all.length).toBe(1);
  });

  it("does not mistake islands for holes: they lie outside the région's outline", () => {
    // Région 07 holds Essaouira and its islets, and région 01 the Mediterranean ones.
    expect(coverageHoles(topo("07"))).toEqual([]);
    expect(coverageHoles(topo("01"))).toEqual([]);
  });
});

describe("checkHoles", () => {
  const ifrane = coverageHoles(topo("03"));

  it("passes the known hole", () => {
    expect(checkHoles("03", ifrane)).toEqual([]);
  });

  it("fails a hole that is not on the known list", () => {
    const failures = checkHoles("05", [{ arcs: [], areaKm2: 12, centre: { lat: 32.1, lng: -6.4 }, bordering: ["x"] }]);
    expect(failures.some((f) => f.includes("covered by no commune"))).toBe(true);
  });

  it("fails a known hole that is no longer there, so the list cannot go stale", () => {
    const failures = checkHoles("03", []);
    expect(failures).toEqual(["région 03: the known hole at 33.5,-5.0 is gone; take it off KNOWN_HOLES"]);
  });
});
