import { describe, expect, it } from "vitest";
import type { Topics } from "../../api/src/lib/indicators.ts";
import { largestGap, nearestTwins, nextDoor, twinOf, type Unit } from "../src/lib/context.ts";
import { communes } from "../src/lib/places.ts";

const codeOf = (name: string) => communes.find((c) => c.name.fr === name)!.code;

/** A made-up commune: its people figures, its household figures, and figures by sex. */
const unit = (code: string, population: number, people: Topics, homes: Topics = {}, bySex: Topics = {}): Unit => ({
  code,
  population,
  record: {
    people: { total: { all: people, male: bySex, female: bySex }, urban: null, rural: null },
    households: { total: homes, urban: null, rural: null },
    "2014": null,
  },
});

describe("next door", () => {
  const french = (v: number) => ({ languagesReadAndWritten: { french: v } });

  it("counts a 31-point gap and not a 29-point one", () => {
    const here = unit("a", 5000, french(10));
    expect(largestGap(here, [unit("b", 5000, french(39))])).toBeNull();
    expect(largestGap(here, [unit("b", 5000, french(41))])).toMatchObject({
      code: "b",
      path: "languagesReadAndWritten.french",
      here: 10,
      there: 41,
    });
  });

  it("ignores a neighbour under 1,000 people, and shows nothing for a commune under 1,000", () => {
    expect(largestGap(unit("a", 5000, french(10)), [unit("b", 999, french(90))])).toBeNull();
    expect(largestGap(unit("a", 999, french(10)), [unit("b", 5000, french(90))])).toBeNull();
  });

  it("never compares sex or age figures", () => {
    const here = unit("a", 5000, { sex: { male: 20 }, age: { "0-4": 5 } }, {}, { illiteracy: { rate10Plus: 10 } });
    const there = unit("b", 5000, { sex: { male: 80 }, age: { "0-4": 60 } }, {}, { illiteracy: { rate10Plus: 90 } });
    expect(largestGap(here, [there])).toBeNull();
  });

  it("skips a figure either commune has no value for", () => {
    const here = unit("a", 5000, { illiteracy: { rate10Plus: null } });
    expect(largestGap(here, [unit("b", 5000, { illiteracy: { rate10Plus: 80 } })])).toBeNull();
  });

  it("picks the largest gap across every neighbour and every figure", () => {
    const here = unit("a", 5000, french(10), { amenities: { runningWater: 90 } });
    const gap = largestGap(here, [
      unit("b", 5000, french(50), { amenities: { runningWater: 85 } }),
      unit("c", 5000, french(20), { amenities: { runningWater: 20 } }),
    ]);
    expect(gap).toMatchObject({ code: "c", path: "amenities.runningWater", gap: 70 });
  });

  it("shows nothing for a commune with no qualifying gap", () => {
    const here = unit("a", 5000, french(10));
    expect(largestGap(here, [unit("b", 5000, french(20)), unit("c", 5000, french(30))])).toBeNull();
    const quiet = communes.find((c) => nextDoor(c.code) === null);
    expect(quiet).toBeDefined();
  });

  it("finds Ouaouizeght's gap with a neighbour of 56 points or more", () => {
    expect(nextDoor(codeOf("Ouaouizeght"))!.gap).toBeGreaterThanOrEqual(56);
  });
});

describe("twins", () => {
  it("matches the answers checked on 2026-09-28", () => {
    for (const [from, to] of [["Agadir", "Kénitra"], ["Fès", "Tétouan"], ["Ouarzazate", "Targuist"], ["Tafraout", "Nador"]]) {
      expect(twinOf(codeOf(from!))?.code, from).toBe(codeOf(to!));
    }
  });

  it("gives no twin to a commune under 5,000 people", () => {
    const small = communes.filter((c) => c.population["2024"].total < 5000);
    expect(small.length).toBeGreaterThan(0);
    for (const c of small) expect(twinOf(c.code)).toBeNull();
  });

  it("names the 3 figures where the two are closest", () => {
    const twin = twinOf(codeOf("Agadir"))!;
    expect(twin.closest).toHaveLength(3);
    expect(new Set(twin.closest.map((f) => f.path)).size).toBe(3);
  });

  // Four made-up communes, alike on every figure but illiteracy.
  const full = (illiteracy: number): Topics => ({
    illiteracy: { rate10Plus: illiteracy },
    languagesReadAndWritten: { french: 40 },
    education: { higher: 10 },
    age: { "0-4": 8, "5-9": 8, "10-14": 8, "65-69": 3, "70-74": 2, "75+": 2 },
    labour: { unemploymentRate: 20, activityRate: 45 },
    localLanguages: { darija: 90 },
  });
  const homes = { households: { averageSize: 4 }, amenities: { runningWater: 80 }, dwellingType: { apartment: 20 } };
  const four = [
    unit("01.001.01.01", 9000, full(20), homes),
    unit("01.001.01.03", 9000, full(21), homes),
    unit("02.001.01.01", 9000, full(30), homes),
    unit("03.001.01.01", 9000, full(60), homes),
  ];

  it("looks for a twin outside the commune's own région", () => {
    expect(nearestTwins(four).get("01.001.01.01")?.code).toBe("02.001.01.01");
  });

  it("gives no twin to a commune missing a figure", () => {
    const gappy = unit("04.001.01.01", 9000, { ...full(20), education: { higher: null } }, homes);
    const twins = nearestTwins([...four, gappy]);
    expect(twins.has("04.001.01.01")).toBe(false);
    expect([...twins.values()].map((t) => t.code)).not.toContain("04.001.01.01");
  });

  it("leaves out a commune whose darija the two censuses disagree on", () => {
    const disputed = unit("04.001.01.01", 9000, { ...full(20), population: { legal: 9000 } }, homes);
    disputed.record["2014"] = {
      people: { total: { all: { population: { legal: 9000 }, localLanguages: { darija: 20 } }, male: {}, female: {} }, urban: null, rural: null },
      households: { total: null, urban: null, rural: null },
    };
    const twins = nearestTwins([...four, disputed]);
    expect(twins.has("04.001.01.01")).toBe(false);
    expect([...twins.values()].map((t) => t.code)).not.toContain("04.001.01.01");
  });
});
