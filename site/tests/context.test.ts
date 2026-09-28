import { describe, expect, it } from "vitest";
import type { Topics } from "../../api/src/lib/indicators.ts";
import { largestGap, largestMove, moveLine, movedMost, nearestTwins, nextDoor, SINCE_2014, twinOf, type Move, type Unit } from "../src/lib/context.ts";
import { communes } from "../src/lib/places.ts";
import { places } from "../src/i18n/places.ts";

const codeOf = (name: string) => communes.find((c) => c.name.fr === name)!.code;

/** A made-up commune: its people figures, its household figures, and figures by sex. */
const unit = (code: string, population: number, people: Topics, homes: Topics = {}, bySex: Topics = {}): Unit => ({
  code,
  population,
  population2014: population,
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

describe("what moved most since 2014", () => {
  const census = (people: Topics, homes: Topics) => ({
    people: { total: { all: people, male: {}, female: {} }, urban: null, rural: null },
    households: { total: homes, urban: null, rural: null },
  });
  /** A made-up place at both censuses: its people figures then and now, and its household figures then and now. */
  const place = (people: [Topics, Topics], homes: [Topics, Topics] = [{}, {}], population = 5000, population2014: number | null = 5000): Unit => ({
    code: "a",
    population,
    population2014,
    record: { ...census(people[1], homes[1]), "2014": census(people[0], homes[0]) },
  });
  const water = (v: number) => ({ amenities: { runningWater: v } });
  // Across Morocco, running water rose 10 points.
  const morocco = place([{}, {}], [water(70), water(80)]).record;

  it("counts a move of 10 points and not one of 9.9", () => {
    expect(largestMove(place([{}, {}], [water(40), water(49.9)]), morocco)).toBeNull();
    expect(largestMove(place([{}, {}], [water(40), water(50)]), morocco)).toEqual({
      path: "amenities.runningWater",
      then: 40,
      now: 50,
      moroccoThen: 70,
      moroccoNow: 80,
      change: 10,
    });
  });

  it("counts a fall as much as a rise", () => {
    expect(largestMove(place([{}, {}], [water(60), water(50)]), morocco)).toMatchObject({ change: -10 });
  });

  it("never picks a figure that barely moved, however far Morocco's did", () => {
    const nation = place([{}, {}], [water(40), water(80)]).record;
    expect(largestMove(place([{}, {}], [water(97.9), water(98.1)]), nation)).toBeNull();
  });

  it("picks the commune's own largest move, not its widest gap with Morocco", () => {
    const nation = place([{}, {}], [{ amenities: { runningWater: 70, electricity: 90 } }, { amenities: { runningWater: 85, electricity: 85 } }]).record;
    const here = place([{}, {}], [{ amenities: { runningWater: 50, electricity: 80 } }, { amenities: { runningWater: 65, electricity: 91 } }]);
    expect(largestMove(here, nation)).toMatchObject({ path: "amenities.runningWater", change: 15 });
  });

  it("shows nothing for a commune under 1,000 people at either census", () => {
    const moved: [Topics, Topics] = [water(10), water(90)];
    expect(largestMove(place([{}, {}], moved, 999, 5000), morocco)).toBeNull();
    expect(largestMove(place([{}, {}], moved, 5000, 999), morocco)).toBeNull();
    expect(largestMove(place([{}, {}], moved, 5000, null), morocco)).toBeNull();
    expect(largestMove(place([{}, {}], moved, 1000, 1000), morocco)).not.toBeNull();
  });

  it("never picks a local language or a sex share", () => {
    const flat = { localLanguages: { darija: 50, tachelhit: 50 }, sex: { male: 50 } };
    const nation = place([flat, flat], [water(70), water(80)]).record;
    const here = place(
      [{ localLanguages: { darija: 10, tachelhit: 50 }, sex: { male: 20 } }, { localLanguages: { darija: 90, tachelhit: 50 }, sex: { male: 80 } }],
      [water(40), water(62)],
    );
    expect(largestMove(here, nation)).toMatchObject({ path: "amenities.runningWater", change: 22 });
  });

  it("never picks a figure the two censuses disagree on", () => {
    const nation = place([{ localLanguages: { darija: 50 } }, { localLanguages: { darija: 50 } }], [water(70), water(80)]).record;
    const here = place(
      [{ population: { legal: 5000 }, localLanguages: { darija: 10 } }, { population: { legal: 5000 }, localLanguages: { darija: 90 } }],
      [water(40), water(62)],
    );
    expect(largestMove(here, nation)).toMatchObject({ path: "amenities.runningWater" });
  });

  it("leaves out figures that aren't shares", () => {
    const nation = place([{}, {}], [{ households: { averageSize: 4 } }, { households: { averageSize: 4 } }]).record;
    expect(largestMove(place([{}, {}], [{ households: { averageSize: 4 } }, { households: { averageSize: 20 } }]), nation)).toBeNull();
  });

  it("skips a figure missing at either census or for Morocco", () => {
    const nation = place([{}, {}], [{ amenities: { runningWater: 70, electricity: 70, kitchen: null } }, { amenities: { runningWater: 80, electricity: 80, kitchen: 80 } }]).record;
    const here = place([{}, {}], [
      { amenities: { runningWater: 10, electricity: null, kitchen: 10 } },
      { amenities: { runningWater: null, electricity: 90, kitchen: 90 } },
    ]);
    expect(largestMove(here, nation)).toBeNull();
  });

  it("picks the largest move either way across every figure", () => {
    const nation = place(
      [{ illiteracy: { rate10Plus: 30 } }, { illiteracy: { rate10Plus: 20 } }],
      [{ amenities: { runningWater: 70, electricity: 90 } }, { amenities: { runningWater: 80, electricity: 95 } }],
    ).record;
    const here = place(
      [{ illiteracy: { rate10Plus: 50 } }, { illiteracy: { rate10Plus: 60 } }],
      [{ amenities: { runningWater: 30, electricity: 80 } }, { amenities: { runningWater: 70, electricity: 35 } }],
    );
    expect(largestMove(here, nation)).toMatchObject({ path: "amenities.electricity", then: 80, now: 35, change: -45 });
  });

  it("finds Laaouama's running water, from 0.7% to 95.2%", () => {
    expect(movedMost(codeOf("Laaouama"))).toMatchObject({ path: "amenities.runningWater", then: 0.7, now: 95.2, moroccoThen: 73, moroccoNow: 82.9 });
  });

  it("gives no line to a real commune under 1,000 people at either census", () => {
    const small = communes.filter((c) => c.population["2024"].total < 1000 || (c.population["2014"]?.total ?? 0) < 1000);
    expect(small.length).toBeGreaterThan(0);
    for (const c of small) expect(movedMost(c.code)).toBeNull();
  });

  it("writes Laaouama's line in English and French", () => {
    const move = movedMost(codeOf("Laaouama"))!;
    expect(moveLine("en", move)).toBe("Since 2014, households with running water went from 0.7% to 95.2%. Across Morocco, the rise was 10 points.");
    expect(moveLine("fr", move)).toBe(
      "Depuis 2014, les ménages ayant l’eau courante sont passés de 0,7\u202f% à 95,2\u202f%. Au Maroc, la hausse a été de 10 points.",
    );
  });

  it("gives Morocco's change in whole points, one as a word, and says when it barely moved", () => {
    const move = (moroccoThen: number, moroccoNow: number): Move => ({ path: "labour.unemploymentRate", then: 10, now: 30, moroccoThen, moroccoNow, change: 20 });
    expect(moveLine("en", move(16.2, 21.3))).toBe("Since 2014, unemployment went from 10.0% to 30.0%. Across Morocco, the rise was 5 points.");
    expect(moveLine("en", move(21.3, 20.3))).toMatch(/the fall was one point\.$/);
    expect(moveLine("fr", move(21.3, 20.3))).toMatch(/la baisse a été d’un point\.$/);
    expect(moveLine("en", move(17.9, 17.6))).toMatch(/Across Morocco, it barely changed\.$/);
    expect(moveLine("fr", move(17.9, 17.6))).toMatch(/Au Maroc, ce chiffre a à peine bougé\.$/);
  });

  it("has a phrase for every figure it can pick, in both languages", () => {
    const paths = SINCE_2014.map((m) => m.path).sort();
    for (const locale of ["en", "fr"] as const) expect(Object.keys(places[locale].moved).sort(), locale).toEqual(paths);
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
