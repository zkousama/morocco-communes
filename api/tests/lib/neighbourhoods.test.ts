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
