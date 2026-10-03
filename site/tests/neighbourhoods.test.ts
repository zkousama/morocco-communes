import { describe, expect, it } from "vitest";
import { hasNeighbourhoods, postcodesOf, villagesOf } from "../src/lib/neighbourhoods.ts";
import { communes } from "../src/lib/places.ts";

const codeOf = (slug: string) => communes.find((c) => c.slug === slug)!.code;

describe("a commune's neighbourhoods file", () => {
  it("is there for a commune with a name in it or a postcode, and only then", () => {
    expect(hasNeighbourhoods(codeOf("casablanca"))).toBe(true);
    expect(hasNeighbourhoods(codeOf("tifariti"))).toBe(true);
    expect(hasNeighbourhoods(codeOf("had-al-gharbia"))).toBe(false);
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

describe("a town's villages and hamlets", () => {
  it("are the ones OpenStreetMap maps inside it, by name", () => {
    expect(villagesOf(codeOf("ajdir-010510109"))).toEqual(expect.arrayContaining(["Sfiha", "Aït Amar", "Dhar Essaloum"]));
    expect(villagesOf(codeOf("jerada"))).toEqual([]);
  });

  it("take their Arabic name on the Arabic site where OpenStreetMap has one, those first, and keep the Latin one otherwise", () => {
    const ajdir = villagesOf(codeOf("ajdir-010510109"), "ar");
    expect(ajdir).toHaveLength(villagesOf(codeOf("ajdir-010510109")).length);
    expect(ajdir).toEqual(expect.arrayContaining(["الصفيحة", "آيت القاضي", "Aït Amar"]));
    const firstLatin = ajdir.findIndex((name) => !/\p{Script=Arabic}/u.test(name));
    expect(ajdir.slice(firstLatin).some((name) => /\p{Script=Arabic}/u.test(name))).toBe(false);
  });
});
