import { describe, expect, it } from "vitest";
import { shapeLines } from "../src/lib/shapeTip.ts";
import { communes } from "../src/lib/places.ts";

describe("the card a place map shows for a commune", () => {
  const agadir = communes.find((c) => c.slug === "agadir")!;

  it("says what kind of commune it is, its people and its density, as the home map does", () => {
    expect(shapeLines("en", agadir)).toEqual(["urban", "504,768 people in 2024", "4,479 per km²"]);
  });

  it("writes them the French way in French", () => {
    const [kind, people, density] = shapeLines("fr", agadir);
    expect(kind).toBe("urbaine");
    expect(people).toBe("504 768 habitants en 2024");
    expect(density).toBe("4 479 au km²");
  });

  it("leaves out a density it has no area for", () => {
    expect(shapeLines("en", { ...agadir, density: null })).toHaveLength(2);
  });

  it("gives an arrondissement, which has no urban or rural, its people and density", () => {
    expect(shapeLines("en", { population: { "2024": { total: 252656 } }, density: 5767.67 })).toEqual(["252,656 people in 2024", "5,768 per km²"]);
  });
});
