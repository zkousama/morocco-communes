import { describe, expect, it } from "vitest";
import { breakdownOf, familyOf, field, FIELDS } from "../src/fields.ts";
import { loadData } from "../src/data.ts";

const data = loadData();

describe("the field catalogue", () => {
  it("holds only rates and shares, never raw counts", () => {
    expect(FIELDS.length).toBeGreaterThan(100);
    expect(FIELDS.some((f) => f.unit === "people" || f.unit === "households")).toBe(false);
    expect(field("labour.unemploymentRate")?.unit).toBe("percent");
  });

  it("marks the fields both censuses asked the same way", () => {
    expect(field("labour.unemploymentRate")?.comparable).toBe(true);
    expect(field("maritalStatus.married")?.comparable).toBe(false);
  });

  it("marks the measures that normally move slowly", () => {
    expect(field("localLanguages.tamazight")?.slow).toBe(true);
    expect(field("labour.unemploymentRate")?.slow).toBe(false);
  });

  it("puts a share in the same family as its sibling shares and their total", () => {
    const empty = familyOf("housing.occupancy.unoccupied");
    expect(empty.has("housing.occupancy.vacant")).toBe(true);
    expect(empty.has("housing.occupancy.seasonal")).toBe(true);
    expect(empty.has("labour.unemploymentRate")).toBe(false);
  });

  it("keeps a share that overlaps its siblings, rather than partitioning them, out of their family", () => {
    expect(familyOf("localLanguages.tamazight").has("localLanguages.tachelhit")).toBe(false);
    expect(familyOf("housing.occupancy.unoccupied").has("housing.occupancy.seasonal")).toBe(true);
  });

  it("breaks an empty-homes share into its parts", () => {
    expect(breakdownOf("housing.occupancy.unoccupied")).toEqual(["housing.occupancy.vacant", "housing.occupancy.seasonal"]);
    expect(breakdownOf("labour.unemploymentRate")).toBeNull();
  });
});

describe("the units", () => {
  it("loads every level", () => {
    expect(data.byLevel.get("region")).toHaveLength(12);
    expect(data.byLevel.get("province")).toHaveLength(83);
    expect(data.byLevel.get("commune")?.length).toBe(1503);
    expect(data.byLevel.get("arrondissement")?.length).toBe(41);
  });

  it("knows Rabat's parent, neighbours, match basis and figures", () => {
    const rabat = data.units.get("04.421.01.0")!;
    expect(rabat.parent).toBe("04.421");
    expect(rabat.neighbours).toContain("04.441.01.0"); // Salé
    expect(rabat.basis).toBe("arrondissement_sum");
    expect(rabat.figures.y2024["fertility.totalFertilityRate"]).toBe(1.19);
    expect(rabat.population.y2024).toBe(509916);
  });

  it("gives a unit with no 2014 record null 2014 figures", () => {
    // Rabat's 2014 population is a sum of its arrondissements; its 2014 rates can't be summed
    const rabat = data.units.get("04.421.01.0")!;
    expect(rabat.figures.y2014["labour.unemploymentRate"]).toBeNull();
  });

  it("reads housing and economy figures under their own names", () => {
    const tanger = data.units.get("01.511.01.0")!;
    expect(tanger.figures.y2024["housing.occupancy.seasonal"]).toBe(16.7);
    expect(tanger.figures.y2024["economy.per1000.jobs"]).toBeGreaterThan(0);
  });

  it("gives a crosswalk-matched commune its basis", () => {
    expect(data.units.get("07.191.11.13")?.basis).toBe("crosswalk"); // Lounasda
  });

  it("reads a non-commune's 2014 population off its own census record, not attributes", () => {
    const province = data.units.get("01.511")!; // Tanger-Assilah
    expect(province.population.y2014).toBe(1065601);
    expect(data.country.population.y2014).toBeGreaterThan(30_000_000);
  });

  it("keeps a missing figure as null, never NaN", () => {
    for (const unit of data.units.values()) {
      for (const value of Object.values(unit.figures.y2024)) expect(Number.isNaN(value)).toBe(false);
    }
  });
});
