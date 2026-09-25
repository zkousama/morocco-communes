import { describe, expect, it } from "vitest";
import { communesInRegion, regions } from "../src/lib/places.ts";

describe("a région's communes", () => {
  it("come back largest population first, across every province", () => {
    for (const region of regions) {
      const communes = communesInRegion(region.code);
      for (let i = 1; i < communes.length; i++) {
        expect(communes[i]!.population["2024"].total).toBeLessThanOrEqual(communes[i - 1]!.population["2024"].total);
      }
    }
  });

  it("names the true largest commune for two régions the audit caught", () => {
    const soussMassa = communesInRegion("09");
    expect(soussMassa[0]!.name.fr).toBe("Agadir");

    const rabatSaleKenitra = communesInRegion("04");
    expect(rabatSaleKenitra[0]!.name.fr).toBe("Salé");
  });
});
