import { describe, expect, it } from "vitest";
import { parseHcp2024 } from "../../src/sources/hcp2024.ts";
import { parseHcp2014 } from "../../src/sources/hcp2014.ts";
import { buildHierarchy } from "../../src/build/hierarchy.ts";
import { assertDataset } from "../../src/validate/assertions.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const h = buildHierarchy(parseHcp2024(readCachedWorkbook(".cache/hcp-population-legale-2024.xlsx")));
const units2014 = parseHcp2014(readCachedWorkbook(".cache/hcp-population-legale-2014.xlsx"));

describe("the real dataset", () => {
  it("has the expected shape at every level", () => {
    expect(h.regions.length).toBe(12);
    expect(h.provinces.filter((p) => p.type !== "prefecture_of_arrondissements").length).toBe(75);
    expect(h.provinces.filter((p) => p.type === "prefecture_of_arrondissements").length).toBe(8);
    expect(h.cercles.length).toBe(213);
    expect(h.communes.length).toBe(1503);
    expect(h.arrondissements.length).toBe(41);
  });

  it("splits 242 urban and 1,261 rural", () => {
    expect(h.communes.filter((c) => c.type === "urban").length).toBe(242);
    expect(h.communes.filter((c) => c.type === "rural").length).toBe(1261);
  });

  it("sums to the published national legal population", () => {
    expect(h.communes.reduce((n, c) => n + (c.population ?? 0), 0)).toBe(36_828_330);
  });

  it("agrees with the 2014 municipality flag on every shared code", () => {
    let shared = 0;
    for (const c of h.communes) {
      const prior = units2014.get(c.codeDigits);
      if (!prior || prior.kind === "arrondissement") continue;
      shared++;
      expect((c.type === "urban") === (prior.kind === "municipality")).toBe(true);
    }
    expect(shared).toBe(1290);
  });

  it("passes every assertion", () => {
    expect(() => assertDataset(h, units2014)).not.toThrow();
  });
});
