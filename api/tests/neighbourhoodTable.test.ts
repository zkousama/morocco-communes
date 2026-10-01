import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { neighbourhoodTable } from "../src/lib/neighbourhoodTable.ts";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const cityOf = new Map((read("data/v1/attributes/arrondissements.json") as { code: string; communeCode: string }[]).map((a) => [a.code, a.communeCode]));
const table = neighbourhoodTable(read("api/data/neighbourhoods.json").places, read("api/data/postcodes.json").postcodes, (c) => cityOf.get(c) ?? c);
const of = (commune: string) => table.filter((row) => row.commune === commune);

const CASABLANCA = "06.141.01.0";
const TANGER = "01.511.01.0";
const AGADIR = "09.001.01.01";

describe("the neighbourhood table", () => {
  it("puts a city's under the city, with the arrondissement where it's known", () => {
    const rows = of(CASABLANCA);
    expect(rows.length).toBeGreaterThan(1000);
    expect(rows.find((r) => r.name.fr === "Sidi Maârouf")).toMatchObject({ arrondissement: "06.141.01.41", name: { ar: "سيدي معروف" } });
    expect(rows.find((r) => r.name.fr === "Houmate Espagnol")).toBeUndefined();
  });

  it("gives a neighbourhood its postcodes, from Poste Maroc's list under the same name", () => {
    expect(of(CASABLANCA).find((r) => r.name.fr === "Bourgogne")?.postcodes).toEqual(["20040", "20050"]);
    expect(of(TANGER).find((r) => r.name.fr === "Houmate Espagnol")?.postcodes).toEqual(["90000"]);
  });

  it("is in alphabetical order within a commune", () => {
    const names = of(AGADIR).map((r) => r.name.fr);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "fr")));
  });
});
