import { describe, expect, it } from "vitest";
import { joinOsm } from "../../src/build/osmJoin.ts";
import type { OverpassRelation } from "../../src/sources/overpass.ts";

const pt = (lon: number, lat: number) => ({ lat, lon });
const square = [pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4), pt(0, 0)];

function relation(ref: string, id = 1, geometry = square): OverpassRelation {
  return {
    id,
    tags: { "ref:MA:HCP": ref, "name:fr": "Test", wikidata: "Q1" },
    members: [{ type: "way", role: "outer", geometry }],
  };
}

describe("joinOsm", () => {
  const known = new Set(["015110519", "015110507"]);

  it("keys features by the nine-digit code, whatever punctuation OSM used", () => {
    const { features } = joinOsm([relation("01.511.05.19.")], known);
    expect([...features.keys()]).toEqual(["015110519"]);
    const f = features.get("015110519")!;
    expect(f.relationId).toBe(1);
    expect(f.wikidata).toBe("Q1");
  });

  it("computes an interior point and a bbox", () => {
    const { features } = joinOsm([relation("01.511.05.19.")], known);
    const f = features.get("015110519")!;
    expect(f.bbox).toEqual([0, 0, 4, 4]);
    expect(f.centroid.lat).toBeGreaterThan(0);
    expect(f.centroid.lat).toBeLessThan(4);
  });

  it("reports a relation whose code is not a known commune instead of keeping it", () => {
    const { features, unmatched } = joinOsm([relation("99.999.99.99")], known);
    expect(features.size).toBe(0);
    expect(unmatched).toEqual([{ relationId: 1, ref: "99.999.99.99" }]);
  });

  it("rejects a relation whose rings do not close, with a reason", () => {
    const open = [pt(0, 0), pt(1, 0), pt(1, 1)];
    const { features, rejected } = joinOsm([relation("01.511.05.07", 2, open)], known);
    expect(features.size).toBe(0);
    expect(rejected[0]?.reason).toContain("ring");
  });

  it("skips a relation with no HCP code at all", () => {
    const bare: OverpassRelation = { id: 3, tags: { "name:fr": "Ceuta" }, members: [] };
    const { features, unmatched, rejected } = joinOsm([bare], known);
    expect(features.size + unmatched.length + rejected.length).toBe(0);
  });
});
