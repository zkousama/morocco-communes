import { describe, expect, it } from "vitest";
import { ACCESS, FAR_KM, summarise } from "../src/lib/access.ts";
import { allDouars } from "../src/lib/douars.ts";
import type { DouarRecord } from "../../api/src/lib/douars.ts";

const douar = (code: string, households: number, km: number | null): DouarRecord => ({
  code,
  communeCode: "09.163.07.17",
  fraction: code.slice(0, 10),
  name: { ar: "دوار" },
  type: "grouped",
  households,
  population: households * 4,
  topics: km === null ? null : { distanceKm: Object.fromEntries(ACCESS.map((k) => [k, km])) },
});

describe("how far a group of douars' homes are", () => {
  it("averages the douars' distances over their households, and leaves out a douar HCP withholds", () => {
    const s = summarise([douar("1630717201001", 30, 2), douar("1630717201002", 90, 14), douar("1630717202001", 10, null)]);
    expect(s).toMatchObject({ douars: 3, fractions: 2, communes: 1, households: 130, people: 520, counted: 120 });
    expect(s.km!.healthCentre).toBe((30 * 2 + 90 * 14) / 120);
    expect(s.far!.healthCentre).toBe(75);
    expect(FAR_KM).toBe(10);
  });

  it("has no distances when every douar is withheld", () => {
    const s = summarise([douar("1630717201002", 10, null)]);
    expect(s.km).toBeNull();
    expect(s.far).toBeNull();
  });

  it("puts Morocco's rural homes 12.1 km from a lycée and 1.9 km from a primary school", () => {
    const s = summarise(allDouars);
    expect(s.douars).toBe(33189);
    expect(Math.round(s.km!.highSchool * 10) / 10).toBe(12.1);
    expect(Math.round(s.km!.primarySchool * 10) / 10).toBe(1.9);
    expect(Math.round(s.far!.highSchool)).toBe(42);
  });
});
