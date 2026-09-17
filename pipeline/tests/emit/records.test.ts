import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHcp2024 } from "../../src/sources/hcp2024.ts";
import { parseHcp2014 } from "../../src/sources/hcp2014.ts";
import { buildHierarchy } from "../../src/build/hierarchy.ts";
import { toRecords } from "../../src/emit/records.ts";

const h = buildHierarchy(parseHcp2024(new Uint8Array(readFileSync(".cache/hcp-population-legale-2024.xlsx"))));
const units2014 = parseHcp2014(new Uint8Array(readFileSync(".cache/hcp-population-legale-2014.xlsx")));
const records = toRecords(h, units2014);

describe("toRecords", () => {
  it("emits every commune with a slug and its parents", () => {
    expect(records.communes.length).toBe(1503);
    const tanger = records.communes.find((c) => c.code === "01.511.01.0")!;
    expect(tanger.slug).toBe("tanger");
    expect(tanger.parents).toEqual({ region: "01", province: "01.511", cercle: null });
    expect(tanger.type).toBe("urban");
  });

  it("attaches 2014 population by exact code where the code matches", () => {
    const exact = records.communes.filter((c) => c.population.change?.basis === "exact_code");
    expect(exact.length).toBe(1290);
  });

  it("recovers the six big cities from their arrondissements, which 2014 has no commune row for", () => {
    const summed = records.communes.filter((c) => c.population.change?.basis === "arrondissement_sum");
    expect(summed.length).toBe(6);
    const casablanca = summed.find((c) => c.nameFrRaw === "Commune de Casablanca")!;
    expect(casablanca.population["2014"]?.total).toBe(3_357_173);
    expect(casablanca.provenance.population2014).toBe("hcp-2014:arrondissement_sum");
  });

  it("gives 1,296 communes a 2014 figure in total", () => {
    const withPrior = records.communes.filter((c) => c.population["2014"] !== null);
    expect(withPrior.length).toBe(1296);
  });

  it("leaves renumbered communes null rather than guessing", () => {
    const aitKamra = records.communes.find((c) => c.nameFrRaw === "Commune d'Ait Kamra")!;
    expect(aitKamra.population["2014"]).toBeNull();
    expect(aitKamra.population.change).toBeNull();
  });

  it("records provenance per field group", () => {
    const any = records.communes[0]!;
    expect(any.provenance.name).toBe("hcp-2024");
    expect(any.provenance.population2024).toBe("hcp-2024");
  });
});
