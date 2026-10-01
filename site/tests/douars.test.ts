import { describe, expect, it } from "vitest";
import { douarsOf } from "../src/lib/douars.ts";
import { communes } from "../src/lib/places.ts";

const codeOf = (slug: string) => communes.find((c) => c.slug === slug)!.code;

describe("a commune's douars", () => {
  it("come in their fractions, in code order", () => {
    const fractions = douarsOf(codeOf("imi-mqourn"));
    expect(fractions.map((f) => [f.code, f.name.ar, f.rows.length])).toEqual([["1630717201", "إكونكا", 29], ["1630717202", "إداومنو", 16]]);
    const codes = fractions.flatMap((f) => f.rows.map((d) => d.code));
    expect(codes).toEqual([...codes].sort());
    expect(fractions[0]!.rows[0]).toMatchObject({ name: { ar: "توريرت نترست" }, type: "dispersed", households: 32, population: 105 });
  });

  it("add up to their fraction's count", () => {
    for (const f of douarsOf(codeOf("imi-mqourn"))) {
      expect(f.rows.reduce((n, d) => n + d.population, 0)).toBe(f.population);
      expect(f.rows).toHaveLength(f.douars);
    }
  });

  it("are none for a city", () => {
    expect(douarsOf(codeOf("tanger"))).toEqual([]);
  });
});
