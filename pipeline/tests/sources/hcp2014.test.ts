import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHcp2014 } from "../../src/sources/hcp2014.ts";

const bytes = new Uint8Array(readFileSync(".cache/hcp-population-legale-2014.xlsx"));
const units = parseHcp2014(bytes);

describe("parseHcp2014", () => {
  it("returns 1,538 commune-level units", () => {
    expect(units.size).toBe(1538);
  });

  it("flags municipalities from the (Mun.) marker", () => {
    const alHoceima = units.get("010510101")!;
    expect(alHoceima.kind).toBe("municipality");
    expect(alHoceima.nameFr).toContain("Al Hoceima");
  });

  it("treats an unmarked commune as rural", () => {
    expect(units.get("010510301")!.kind).toBe("commune");
  });

  it("counts 215 municipalities, 1,282 communes and 41 arrondissements", () => {
    const tally = { municipality: 0, commune: 0, arrondissement: 0 };
    for (const unit of units.values()) tally[unit.kind]++;
    expect(tally).toEqual({ municipality: 215, commune: 1282, arrondissement: 41 });
  });
});
