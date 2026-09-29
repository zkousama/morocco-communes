import { describe, expect, it } from "vitest";
import { RARITY_PEOPLE, RARITY_SHARE } from "../src/lib/context.ts";
import {
  ELDERLY_BREAKS,
  SERVICE_PEOPLE,
  SERVICE_SHARE,
  UNEMPLOYMENT_BREAKS,
  WATER_BREAKS,
  WOMEN_BREAKS,
  classOf,
  serviceCounts,
  serviceOf,
  shadeOf,
} from "../src/lib/mapViews.ts";

describe("a map class", () => {
  it("puts a value in the first class it falls under, and gives no value its own class", () => {
    expect(classOf(null, WATER_BREAKS)).toBe("n");
    expect(classOf(19.9, WATER_BREAKS)).toBe("0");
    expect(classOf(20, WATER_BREAKS)).toBe("1");
    expect(classOf(100, WATER_BREAKS)).toBe("5");
  });

  it("hides a flagged figure and keeps the others", () => {
    expect(shadeOf(90, WATER_BREAKS, true)).toBe("n");
    expect(shadeOf(90, WATER_BREAKS, false)).toBe(classOf(90, WATER_BREAKS));
    expect(shadeOf(null, ELDERLY_BREAKS, false)).toBe("n");
  });
});

describe("where the tram and the train run", () => {
  it("uses the same 1% rule as the only-here lines", () => {
    expect(SERVICE_SHARE).toBe(RARITY_SHARE);
    expect(SERVICE_PEOPLE).toBe(RARITY_PEOPLE);
    expect(SERVICE_SHARE).toBe(1);
    expect(SERVICE_PEOPLE).toBe(1000);
  });

  it("colours a commune that meets the bar on either, and greys the rest", () => {
    expect(serviceOf(1, 0, 1000)).toBe("1");
    expect(serviceOf(0, 1, 5000)).toBe("1");
    expect(serviceOf(0.9, 0.9, 5000)).toBe("0");
    expect(serviceOf(4, 0, 999)).toBe("0");
    expect(serviceOf(null, null, 5000)).toBe("n");
  });

  it("counts tram and train apart, including a commune that has both", () => {
    expect(
      serviceCounts([
        { tram: 2, train: 3, population: 5000 },
        { tram: 1, train: 0, population: 2000 },
        { tram: 0, train: 0.4, population: 8000 },
        { tram: 9, train: 9, population: 500 },
      ]),
    ).toEqual({ tram: 2, train: 1 });
  });
});

describe("the breaks", () => {
  it("are round numbers, one set per view", () => {
    expect(WATER_BREAKS).toEqual([20, 40, 60, 80, 95]);
    expect(ELDERLY_BREAKS).toEqual([5, 8, 10, 12, 15]);
    expect(WOMEN_BREAKS).toEqual([30, 40, 50, 60, 70]);
    expect(UNEMPLOYMENT_BREAKS).toEqual([10, 20, 30, 40, 50]);
  });
});
