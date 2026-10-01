import { describe, expect, it } from "vitest";
import { hasNeighbourhoods, postcodesOf } from "../src/lib/neighbourhoods.ts";
import { communes } from "../src/lib/places.ts";

const codeOf = (slug: string) => communes.find((c) => c.slug === slug)!.code;

describe("a commune's neighbourhoods file", () => {
  it("is there for a commune with a name in it or a postcode, and only then", () => {
    expect(hasNeighbourhoods(codeOf("casablanca"))).toBe(true);
    expect(hasNeighbourhoods(codeOf("tifariti"))).toBe(true);
    expect(hasNeighbourhoods(codeOf("gueznaia"))).toBe(false);
  });
});

describe("a commune's postcodes", () => {
  it("are Poste Maroc's, in order", () => {
    expect(postcodesOf(codeOf("tafraout"))).toEqual(["85450"]);
    const casablanca = postcodesOf(codeOf("casablanca"));
    expect(casablanca[0]).toBe("20000");
    expect(casablanca).toEqual([...casablanca].sort());
  });
});
