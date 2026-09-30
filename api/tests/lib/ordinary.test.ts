import { describe, expect, it } from "vitest";
import { MAX_PER_HOUSEHOLD, MIN_HOUSEHOLDS, ordinary } from "../../src/lib/ordinary.ts";

describe("a commune whose shares mean something", () => {
  it("has at least 300 households", () => {
    expect(ordinary(1000, MIN_HOUSEHOLDS)).toBe(true);
    expect(ordinary(1000, MIN_HOUSEHOLDS - 1)).toBe(false);
  });

  it("has no more than 8 people to a household on average, since more is a population the households don't hold", () => {
    expect(ordinary(8 * 500, 500)).toBe(true);
    expect(ordinary(8 * 500 + 1, 500)).toBe(false);
    expect(MAX_PER_HOUSEHOLD).toBe(8);
  });

  it("is not one when the census didn't count its households or its people", () => {
    expect(ordinary(5000, null)).toBe(false);
    expect(ordinary(5000, undefined)).toBe(false);
    expect(ordinary(null, 400)).toBe(false);
  });

  it("leaves out Tifariti, Oum Dreyga and Tichla, and keeps Agadir", async () => {
    const { readFileSync } = await import("node:fs");
    const communes = JSON.parse(readFileSync(new URL("../../../data/v1/attributes/communes.json", import.meta.url), "utf8")) as {
      slug: string;
      population: { "2024": { total: number; households: number | null } };
    }[];
    const by = (slug: string) => communes.find((c) => c.slug === slug)!.population["2024"];
    for (const slug of ["tifariti", "oum-dreyga", "tichla"]) expect(ordinary(by(slug).total, by(slug).households), slug).toBe(false);
    expect(ordinary(by("agadir").total, by("agadir").households)).toBe(true);
  });
});
