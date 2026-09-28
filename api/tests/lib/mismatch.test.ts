import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mismatches } from "../../src/lib/mismatch.ts";
import type { Census, IndicatorRecord, Topics } from "../../src/lib/indicators.ts";

/** A census with a population, local language shares, and optionally household figures. */
const census = (population: number, languages: Record<string, number>, homes: Topics = {}): Census => ({
  people: { total: { all: { population: { legal: population }, localLanguages: languages }, male: {}, female: {} }, urban: null, rural: null },
  households: { total: homes, urban: null, rural: null },
});

describe("where the two censuses don't line up", () => {
  it("flags a language share that moved more than 30 points while the population barely changed", () => {
    const then = census(7660, { darija: 88.9, tarifit: 91.2, tamazight: 0.2 });
    const now = census(6498, { darija: 84, tarifit: 0.1, tamazight: 15.8 });
    expect(mismatches(now, then)).toEqual([{ path: "localLanguages.tarifit", then: 91.2, now: 0.1 }]);
  });

  it("leaves a big move alone where the population grew even more, since newcomers can explain it", () => {
    const then = census(4207, { darija: 45.6 });
    const now = census(19139, { darija: 93.3 });
    expect(mismatches(now, then)).toEqual([]);
  });

  it("flags a move larger than the population change, even when the population grew", () => {
    const then = census(10000, { tamazight: 95, tachelhit: 0.6 });
    const now = census(13781, { tamazight: 42.7, tachelhit: 53.1 });
    expect(mismatches(now, then).map((m) => m.path)).toEqual(["localLanguages.tachelhit", "localLanguages.tamazight"]);
  });

  it("leaves ordinary changes alone", () => {
    expect(mismatches(census(5000, { darija: 60, tachelhit: 45 }), census(5200, { darija: 52, tachelhit: 55 }))).toEqual([]);
  });

  it("says nothing without both censuses or a population to compare", () => {
    expect(mismatches(census(5000, { tarifit: 0 }), null)).toEqual([]);
    expect(mismatches(census(0, { tarifit: 0 }), census(0, { tarifit: 90 }))).toEqual([]);
  });

  it("flags an amenity share that fell more than 30 points while the population barely changed", () => {
    const then = census(10639, {}, { amenities: { runningWater: 97.2, electricity: 98 } });
    const now = census(10866, {}, { amenities: { runningWater: 3, electricity: 97 } });
    expect(mismatches(now, then)).toEqual([{ path: "amenities.runningWater", then: 97.2, now: 3 }]);
  });

  it("leaves an amenity share that rose, however far", () => {
    expect(mismatches(census(5000, {}, { amenities: { runningWater: 95 } }), census(5000, {}, { amenities: { runningWater: 5 } }))).toEqual([]);
  });

  it("leaves a fall the population's own change can account for", () => {
    const then = census(2000, {}, { wastewater: { publicSewer: 80 } });
    const now = census(4000, {}, { wastewater: { publicSewer: 45 } });
    expect(mismatches(now, then)).toEqual([]);
  });

  it("checks running water, electricity, the public sewer, toilets and kitchens, and not bathrooms", () => {
    const full = { amenities: { kitchen: 90, toilet: 90, bathroom: 90, electricity: 90, runningWater: 90 }, wastewater: { publicSewer: 90 } };
    const empty = { amenities: { kitchen: 0, toilet: 0, bathroom: 0, electricity: 0, runningWater: 0 }, wastewater: { publicSewer: 0 } };
    expect(mismatches(census(5000, {}, empty), census(5000, {}, full)).map((m) => m.path).sort()).toEqual([
      "amenities.electricity", "amenities.kitchen", "amenities.runningWater", "amenities.toilet", "wastewater.publicSewer",
    ]);
  });
});

describe("the published figures", () => {
  const load = (dir: string) =>
    new Map(
      readdirSync(new URL(`../../../data/v1/indicators/${dir}/`, import.meta.url))
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => JSON.parse(readFileSync(new URL(`../../../data/v1/indicators/${dir}/${f}`, import.meta.url), "utf8")) as IndicatorRecord[])
        .map((r) => [r.code!, r]),
    );
  const now = load("communes");
  const then = load("2014/communes");
  const of = (code: string) => mismatches(now.get(code), then.get(code)).map((m) => m.path);
  const code = (name: string) => {
    const communes = JSON.parse(readFileSync(new URL("../../../data/v1/attributes/communes.json", import.meta.url), "utf8")) as {
      code: string;
      name: { fr: string };
    }[];
    return communes.find((c) => c.name.fr === name)!.code;
  };

  it("flag Bni Bounsar's Tarifit and Et-Taous's Tamazight and Tachelhit, and not Al Mahbass's Darija", () => {
    expect(of(code("Bni Bounsar"))).toEqual(["localLanguages.tarifit"]);
    expect(of(code("Et-Taous"))).toEqual(["localLanguages.tachelhit", "localLanguages.tamazight"]);
    expect(of(code("Al Mahbass"))).toEqual([]);
  });

  it("flag Lounasda's running water, and Gueltat Zemmour's water, sewer and toilets beside its Darija", () => {
    expect(of(code("Lounasda"))).toEqual(["amenities.runningWater"]);
    expect(of(code("Gueltat Zemmour"))).toEqual(["localLanguages.darija", "amenities.runningWater", "wastewater.publicSewer", "amenities.toilet"]);
  });
});
