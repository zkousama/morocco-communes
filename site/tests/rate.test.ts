import { describe, expect, it } from "vitest";
import { MAX_RATE, MIN_FOR_RATE, ratedChange } from "../src/lib/rate.ts";
import { communes } from "../src/lib/places.ts";

describe("a change since 2014 that is a rate", () => {
  const change = (pct: number) => ({ absolute: 0, pct, basis: "exact_code" });

  it("needs at least 500 people in 2014", () => {
    expect(ratedChange(change(40), MIN_FOR_RATE)).not.toBeNull();
    expect(ratedChange(change(40), MIN_FOR_RATE - 1)).toBeNull();
    expect(ratedChange(change(40), null)).toBeNull();
  });

  it("is at most 500% either way", () => {
    expect(ratedChange(change(MAX_RATE), 1000)).not.toBeNull();
    expect(ratedChange(change(MAX_RATE + 0.1), 1000)).toBeNull();
    expect(ratedChange(change(-MAX_RATE), 1000)).not.toBeNull();
  });

  it("is missing when there is no change to rate", () => {
    expect(ratedChange(undefined, 5000)).toBeNull();
  });

  it("leaves out Tifariti, which went from 55 people to 5,728, and keeps Agadir", () => {
    const of = (slug: string) => {
      const c = communes.find((x) => x.slug === slug)!;
      return ratedChange(c.population.change, c.population["2014"]?.total ?? null);
    };
    expect(of("tifariti")).toBeNull();
    expect(of("agadir")?.pct).toBeGreaterThan(19);
  });
});
