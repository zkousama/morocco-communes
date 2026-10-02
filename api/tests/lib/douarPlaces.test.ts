import { describe, expect, it } from "vitest";
import { cleanLatin, matchDouars, score, type Douar, type Place } from "../../src/lib/douarPlaces.ts";

const douar = (code: string, ar: string, spelt: string): Douar => ({ code, name: { ar }, spelt });
const place = (id: string, latin: string[], arabic: string[] = []): Place => ({ source: "geonames", id, lat: 30, lng: -9, latin, arabic });

describe("a place naming a douar", () => {
  it("does so outright with the same Arabic name", () => {
    expect(score(douar("1", "تيݣراو", "Tigraou"), place("a", ["Tigraw"], ["تيكراو"]))).toEqual({ name: "Tigraw", score: 2 });
  });

  it("does so in Latin when the keys meet, scored by how close it is to the spelling by rule", () => {
    const found = score(douar("1", "أيت واكمار", "Ait Ouakmar"), place("a", ["Aït Ouakmar"]));
    expect(found?.name).toBe("Aït Ouakmar");
    expect(found!.score).toBeGreaterThan(1.8);
  });

  it("doesn't on a key of 2 consonants, which meets too many names by chance", () => {
    expect(score(douar("1", "تامة", "Tama"), place("a", ["Toumi"]))).toBeNull();
  });

  it("drops the Douar GeoNames writes before a name", () => {
    expect(cleanLatin("Douar Oulad Jilali")).toBe("Oulad Jilali");
  });
});

describe("matching a commune's douars to its places", () => {
  const douars = new Map([["c1", [douar("1", "تيݣراو", "Tigraou"), douar("2", "أيت واكمار", "Ait Ouakmar")]]]);

  it("pairs each douar with the place that names it best, one place to one douar", () => {
    const places = [place("a", ["Tigraou"]), place("b", ["Tigrawt"]), place("c", ["Ait Ouakmar"])];
    const matches = matchDouars(douars, places, () => "c1");
    expect(matches.map((m) => [m.douar, m.place.id])).toEqual([["1", "a"], ["2", "c"]]);
  });

  it("finds nothing once the commune is swapped for another, which is how chance is measured", () => {
    const places = [place("a", ["Tigraou"])];
    expect(matchDouars(douars, places, () => "c1", () => "c2")).toEqual([]);
  });
});
