import { describe, expect, it } from "vitest";
import { mismatches } from "../../api/src/lib/mismatch.ts";
import { readLevel } from "../../pipeline/src/lib/levels.ts";
import { contextOf, neighboursOn, since2014 } from "../src/context.ts";
import { loadData, type Data, type Unit } from "../src/data.ts";
import type { Finding } from "../src/detect.ts";
import { dropped, isSampled, keep, LOCAL_COMMUTE, SAMPLE_HOUSEHOLDS, SMALL_BASE } from "../src/filter.ts";

type Spec = Partial<Omit<Unit, "figures">> & { code: string; y2024?: Record<string, number | null>; y2014?: Record<string, number | null> };

/** A few communes, with only the figures a test reads, and Morocco beside them. */
function fixture(specs: Spec[], country: { y2024?: Record<string, number | null>; y2014?: Record<string, number | null> } = {}): Data {
  const unit = ({ y2024, y2014, ...spec }: Spec): Unit => ({
    level: "commune",
    name: { fr: spec.code, ar: null },
    parent: "01.511",
    population: { y2014: 10000, y2024: 10000 },
    basis: "exact_code",
    neighbours: [],
    mismatched: new Set(),
    base: { businesses: null, dwellings: null, households: null },
    ...spec,
    figures: { y2024: y2024 ?? {}, y2014: y2014 ?? {} },
  });
  const units = specs.map(unit);
  return {
    version: "t",
    units: new Map(units.map((u) => [u.code, u])),
    byLevel: new Map([["commune", units]]),
    country: unit({ code: "MA", level: "region", parent: null, ...country }),
  };
}

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "f1",
  code: "a",
  level: "commune",
  measure: "labour.unemploymentRate",
  kind: "extreme",
  value: 40,
  reference: 15,
  score: 4,
  direction: "high",
  ...over,
});

describe("which standout figures are kept", () => {
  const data = fixture([
    { code: "a" },
    { code: "flagged", mismatched: new Set(["amenities.kitchen"]) },
    { code: "p", level: "province", parent: "01" },
  ]);

  it("keeps a commune's figure", () => {
    expect(dropped(finding(), data)).toBeNull();
  });

  it("drops a possible error in the data", () => {
    expect(dropped(finding({ kind: "artefact" }), data)).toBe("artefact");
  });

  it("drops every figure of a commune the two censuses disagree on, even one they agree on", () => {
    expect(dropped(finding({ code: "flagged", measure: "amenities.kitchen" }), data)).toBe("flagged");
    expect(dropped(finding({ code: "flagged", measure: "amenities.electricity" }), data)).toBe("flagged");
  });

  it("drops commuting by a service that only some places have, and keeps the other modes", () => {
    expect([...LOCAL_COMMUTE].sort()).toEqual([
      "commute.bus",
      "commute.employerTransport",
      "commute.taxi",
      "commute.train",
      "commute.tram",
    ]);
    for (const measure of LOCAL_COMMUTE) expect(dropped(finding({ measure }), data)).toBe("local service");
    expect(dropped(finding({ measure: "commute.walking" }), data)).toBeNull();
    expect(dropped(finding({ measure: "commute.privateCar" }), data)).toBeNull();
    expect(dropped(finding({ measure: "commute.bikeOrMotorcycle" }), data)).toBeNull();
    expect(dropped(finding({ measure: "commute.animal" }), data)).toBeNull();
  });

  it("drops anything that isn't a commune", () => {
    expect(dropped(finding({ code: "p", level: "province", kind: "change" }), data)).toBe("not a commune");
  });

  const base = (businesses: number | null, dwellings: number | null, households: number | null = null) =>
    fixture([{ code: "a", base: { businesses, dwellings, households } }]);

  it("drops an economy figure when the commune has fewer than 100 businesses", () => {
    expect(SMALL_BASE).toBe(100);
    expect(dropped(finding({ measure: "economy.share.sector.commerce" }), base(99, 500))).toBe("small base");
    expect(dropped(finding({ measure: "economy.per1000.jobs" }), base(null, 500))).toBe("small base");
    expect(dropped(finding({ measure: "economy.share.sector.commerce" }), base(100, 0))).toBeNull();
  });

  it("drops a housing figure when the commune has fewer than 100 urban dwellings", () => {
    expect(dropped(finding({ measure: "housing.occupancy.unoccupied" }), base(500, 99))).toBe("small base");
    expect(dropped(finding({ measure: "housing.occupancy.unoccupied" }), base(500, null))).toBe("small base");
    expect(dropped(finding({ measure: "housing.occupancy.unoccupied" }), base(0, 100))).toBeNull();
  });

  it("keeps a census figure however small the businesses and dwellings", () => {
    expect(dropped(finding({ measure: "labour.unemploymentRate" }), base(1, 1))).toBeNull();
  });

  it("marks a census figure in a commune of 2,000 households or more as a sample estimate", () => {
    expect(SAMPLE_HOUSEHOLDS).toBe(2000);
    const census = finding();
    expect(isSampled(census, base(null, null, 2000))).toBe(true);
    expect(isSampled(census, base(null, null, 1999))).toBe(false);
    expect(isSampled(census, base(null, null, null))).toBe(false);
    const large = base(500, 500, 5000);
    expect(isSampled(finding({ measure: "economy.share.sector.commerce" }), large)).toBe(false);
    expect(isSampled(finding({ measure: "housing.occupancy.unoccupied" }), large)).toBe(false);
  });

  it("keeps the rest in the order detect ranked them", () => {
    const kept = keep([finding({ id: "1" }), finding({ id: "2", kind: "artefact" }), finding({ id: "3", measure: "sex.male" }), finding({ id: "4" })], data);
    expect(kept.map((f) => f.id)).toEqual(["1", "4"]);
  });
});

describe("the flags the filter reads", () => {
  it("are the ones mismatch.ts gives each commune", () => {
    const now = readLevel<Parameters<typeof mismatches>[0] & { code: string }>("data/v1/indicators", "communes");
    const then = new Map(readLevel<Parameters<typeof mismatches>[1] & { code: string }>("data/v1/indicators/2014", "communes").map((r) => [r.code, r]));
    const record = now.find((r) => mismatches(r, then.get(r.code)).length > 0)!;
    const expected = mismatches(record, then.get(record.code)).map((m) => m.path);
    expect([...loadData().units.get(record.code)!.mismatched].sort()).toEqual(expected.sort());
  });
});

describe("its bordering communes on the same figure", () => {
  const measure = "labour.unemploymentRate";
  const around = (values: (number | null)[], extra: Partial<Spec> = {}): Data =>
    fixture([
      { code: "a", neighbours: values.map((_, i) => `n${i}`), y2024: { [measure]: 40 } },
      ...values.map((v, i) => ({ code: `n${i}`, y2024: { [measure]: v }, ...extra })),
    ]);

  it("gives their median and the one furthest from it", () => {
    const n = neighboursOn(finding(), around([10, 12, 30, 14]));
    expect(n).toEqual({ bordering: 4, compared: 4, median: 13, furthest: { code: "n0", name: { fr: "n0", ar: null }, value: 10 } });
  });

  it("counts only the ones with the figure", () => {
    const n = neighboursOn(finding(), around([10, null, 20]));
    expect(n).toMatchObject({ bordering: 3, compared: 2, median: 15 });
  });

  it("leaves out a neighbour with any figure the two censuses disagree on, even one this comparison doesn't use", () => {
    const data = around([10, 20]);
    data.units.get("n0")!.mismatched.add("amenities.kitchen");
    expect(neighboursOn(finding(), data)).toMatchObject({ compared: 1, median: 20, furthest: { code: "n1" } });
  });

  it("leaves out a neighbour too small for its shares to hold still", () => {
    const data = around([10, 20]);
    data.units.get("n0")!.population.y2024 = 500;
    expect(neighboursOn(finding(), data)).toMatchObject({ compared: 1, furthest: { code: "n1" } });
  });

  it("gives nothing for a commune with no neighbour to compare", () => {
    expect(neighboursOn(finding(), around([]))).toBeNull();
    expect(neighboursOn(finding(), around([null, null]))).toBeNull();
  });

  it("compares a change with their change, leaving out the ones matched through the crosswalk", () => {
    const data = fixture([
      { code: "a", neighbours: ["n0", "n1", "n2"], y2024: { [measure]: 40 }, y2014: { [measure]: 10 } },
      { code: "n0", y2024: { [measure]: 12 }, y2014: { [measure]: 10 } },
      { code: "n1", y2024: { [measure]: 8.7 }, y2014: { [measure]: 38.7 } },
      { code: "n2", y2024: { [measure]: 50 }, y2014: { [measure]: 10 }, basis: "crosswalk" },
    ]);
    const n = neighboursOn(finding({ kind: "change", value: 30 }), data);
    expect(n).toEqual({ bordering: 3, compared: 2, median: -14, furthest: { code: "n1", name: { fr: "n1", ar: null }, value: -30 } });
  });
});

describe("the same figure in 2014, and Morocco's", () => {
  const measure = "labour.unemploymentRate";
  const data = (over: Partial<Spec> = {}) =>
    fixture([{ code: "a", y2024: { [measure]: 40 }, y2014: { [measure]: 30 }, ...over }], { y2024: { [measure]: 13 }, y2014: { [measure]: 16 } });

  it("gives both censuses, the commune's and Morocco's", () => {
    expect(since2014(finding(), data())).toEqual({ then: 30, now: 40, morocco: { then: 16, now: 13 } });
  });

  it("gives nothing for a figure the 2014 census didn't ask the same way", () => {
    expect(since2014(finding({ measure: "housing.occupancy.vacant" }), data({ y2024: { "housing.occupancy.vacant": 20 }, y2014: { "housing.occupancy.vacant": 10 } }))).toBeNull();
  });

  it("gives nothing for a figure the two censuses disagree on", () => {
    expect(since2014(finding(), data({ mismatched: new Set([measure]) }))).toBeNull();
  });

  it("gives nothing where the 2014 figure covers other ground", () => {
    expect(since2014(finding(), data({ basis: "crosswalk" }))).toBeNull();
  });

  it("gives nothing when either census left the figure out", () => {
    expect(since2014(finding(), data({ y2014: { [measure]: null } }))).toBeNull();
  });
});

describe("the context of one figure", () => {
  it("names the commune's other standout figures from the same run", () => {
    const data = fixture([{ code: "a" }, { code: "b" }]);
    const kept = [finding({ id: "1" }), finding({ id: "2", measure: "education.higher", kind: "gap" }), finding({ id: "3", code: "b" })];
    expect(contextOf(kept[0]!, kept, data).others).toEqual([{ id: "2", kind: "gap", measure: "education.higher" }]);
    expect(contextOf(kept[2]!, kept, data).others).toEqual([]);
  });
});

describe("a commune whose people mostly aren't in households", () => {
  const unit = (people: number, households: number | null) =>
    fixture([{ code: "a", base: { businesses: 500, dwellings: 500, households }, population: { y2014: null, y2024: people } }]);

  it("has its figures left out, since a share of households there is a few families", () => {
    expect(dropped(finding({ measure: "amenities.electricity" }), unit(5728, 38))).toBe("special population");
    expect(dropped(finding({ measure: "amenities.electricity" }), unit(2400, 299))).toBe("special population");
  });

  it("keeps a commune with 300 households and no more than 8 people to each", () => {
    expect(dropped(finding({ measure: "amenities.electricity" }), unit(2400, 300))).toBeNull();
  });

  it("does not judge a commune whose households the census didn't count", () => {
    expect(dropped(finding({ measure: "amenities.electricity" }), unit(5728, null))).toBeNull();
  });
});
