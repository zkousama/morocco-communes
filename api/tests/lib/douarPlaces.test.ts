import { describe, expect, it } from "vitest";
import { cleanLatin, douarNameOf, km, matchDouars, matchNearFractions, score, withoutArticle, type Douar, type Place } from "../../src/lib/douarPlaces.ts";

const douar = (code: string, ar: string, spelt: string): Douar => ({ code, name: { ar }, spelt });
const place = (id: string, latin: string[], arabic: string[] = [], lat = 30, lng = -9): Place => ({ source: "geonames", id, lat, lng, latin, arabic });

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

  it("doesn't on a short key spelt only half alike: Tatrarat isn't تاوريرت, though both come to T·R·T", () => {
    expect(score(douar("1", "تاوريرت", "Taourirt"), place("a", ["Tatrarat"]))).toBeNull();
    expect(score(douar("1", "تاوريرت", "Taourirt"), place("a", ["Taourirt"]))?.name).toBe("Taourirt");
  });

  it("compares 2 spellings without the article one of them writes", () => {
    expect(withoutArticle("Ez Zraib")).toBe("zraib");
    expect(withoutArticle("Ennouasser")).toBe("nouasser");
    expect(score(douar("1", "الزرايب", "Zrayb"), place("a", ["Ez Zraib"]))?.name).toBe("Ez Zraib");
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

describe("the second pass, near a fraction's placed douars", () => {
  // 2 douars of fraction 1630717201: one placed by its long name, one with a short name.
  const douars = new Map([["c1", [douar("1630717201001", "تيݣراو", "Tigraou"), douar("1630717201002", "تامة", "Tama")]]]);
  const placed = place("a", ["Tigraou"], [], 30, -9);

  it("places a short name it couldn't trust alone, where a place near the fraction is spelt alike", () => {
    const first = matchDouars(douars, [placed], () => "c1");
    const near = matchNearFractions(douars, [placed, place("b", ["Tama"], [], 30.01, -9)], () => "c1", first);
    expect(near.map((m) => [m.douar, m.place.id])).toEqual([["1630717201002", "b"]]);
  });

  it("leaves it where the place is far from the fraction", () => {
    const first = matchDouars(douars, [placed], () => "c1");
    expect(matchNearFractions(douars, [placed, place("b", ["Tama"], [], 30.2, -9)], () => "c1", first)).toEqual([]);
  });

  it("measures distance on the earth", () => {
    expect(Math.round(km({ lat: 30, lng: -9 }, { lat: 31, lng: -9 }))).toBe(111);
  });
});

describe("the name a feature gives its douar", () => {
  it("drops the word saying what a school, mosque or health post is", () => {
    expect(douarNameOf("École Tagmout", false)).toBe("Tagmout");
    expect(douarNameOf("Groupe scolaire Douar Ait Ali", false)).toBe("Ait Ali");
    expect(douarNameOf("مسجد دوار أيت علي", false)).toBe("أيت علي");
    expect(douarNameOf("مجموعة مدارس تاكموت", false)).toBe("تاكموت");
  });

  it("keeps a place's own name whole, though it start with one of those words", () => {
    expect(douarNameOf("Douar Jdid", true)).toBe("Douar Jdid");
  });
});
