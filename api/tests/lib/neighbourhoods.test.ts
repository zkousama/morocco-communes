import { describe, expect, it } from "vitest";
import { inside, namesOf } from "../../src/lib/neighbourhoods.ts";

describe("a neighbourhood's names, from OpenStreetMap's tags", () => {
  it("takes the French and Arabic names where they're tagged", () => {
    expect(namesOf({ name: "Sidi Maârouf سيدي معروف", "name:fr": "Sidi Maârouf", "name:ar": "سيدي معروف" })).toEqual({
      fr: "Sidi Maârouf",
      ar: "سيدي معروف",
    });
  });

  it("splits a name that runs the scripts together, and drops the Tifinagh", () => {
    expect(namesOf({ name: "Tohmo ⵜⵓⵀⵎⵓ توهمو" })).toEqual({ fr: "Tohmo", ar: "توهمو" });
  });

  it("keeps a Latin-only name, and an Arabic-only one", () => {
    expect(namesOf({ name: "Lot. Amana" })).toEqual({ fr: "Lot. Amana", ar: "" });
    expect(namesOf({ name: "تجزئة عين العاطي" })).toEqual({ fr: "", ar: "تجزئة عين العاطي" });
  });

  it("has nothing for a place with no name", () => {
    expect(namesOf({})).toBeNull();
    expect(namesOf({ name: "ⵜⵓⵀⵎⵓ" })).toBeNull();
  });
});

describe("a point inside a boundary", () => {
  const square: [number, number][][] = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ];

  it("is inside the outer ring and outside its hole", () => {
    expect(inside([2, 2], square)).toBe(true);
    expect(inside([5, 5], square)).toBe(false);
    expect(inside([12, 5], square)).toBe(false);
  });
});

describe("the neighbourhoods added by hand", () => {
  it("each say where their name and point come from, and sit in Morocco", async () => {
    const { ADDED } = await import("../../src/lib/neighbourhoodsAdded.ts");
    for (const n of ADDED) {
      expect(n.fr || n.ar, JSON.stringify(n)).toBeTruthy();
      expect(n.origin.length, n.fr).toBeGreaterThan(20);
      expect(n.lat > 20 && n.lat < 36 && n.lng > -17.2 && n.lng < -0.9, n.fr).toBe(true);
    }
  });
});

describe("a fetch that came back short", () => {
  it("is refused when more than 5% of the last list's names are gone, and kept otherwise", async () => {
    const { tooShrunk } = await import("../../src/lib/neighbourhoods.ts");
    expect(tooShrunk(1797, 1611)).toBe(true);
    expect(tooShrunk(1797, 1790)).toBe(false);
    expect(tooShrunk(1797, 1900)).toBe(false);
    expect(tooShrunk(0, 10)).toBe(false);
  });
});

describe("a street mistaken for a neighbourhood", () => {
  it("is told by the word it starts with", async () => {
    const { isStreet } = await import("../../src/lib/neighbourhoods.ts");
    for (const name of ["Bd. Mohammed V", "Rue de Casablanca", "Av. du Caire", "Avenue Hassan II", "Route de Fès", "Impasse 3"]) expect(isStreet(name), name).toBe(true);
    for (const name of ["Place d'Armes", "Hay Riad", "Routes Neuves", "Ruelle"]) expect(isStreet(name), name).toBe(false);
  });
});
