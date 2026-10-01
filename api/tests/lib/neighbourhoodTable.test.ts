import { describe, expect, it } from "vitest";
import { neighbourhoodTable, postcodesByCommune } from "../../src/lib/neighbourhoodTable.ts";

describe("the table of neighbourhoods", () => {
  const communeOf = (code: string) => (code.endsWith(".41") ? "06.141.01.0" : code);
  const rows = neighbourhoodTable(
    [
      ["Sidi Maârouf", "سيدي معروف", "06.141.01.41", "osm"],
      ["Bourgogne", "", "06.141.01.0", "poste"],
      ["L'Oasis", "", "06.141.01.0", "osm"],
    ],
    [
      ["20040", "06.141.01.0", ["Bourgogne"]],
      ["20050", "06.141.01.0", ["Bourgogne"]],
      ["20410", "06.141.01.0", ["Oasis"]],
    ],
    communeOf,
  );

  it("puts each neighbourhood in its commune, with its arrondissement where it was placed in one", () => {
    expect(rows.find((r) => r.name.fr === "Sidi Maârouf")).toMatchObject({ commune: "06.141.01.0", arrondissement: "06.141.01.41", source: "osm" });
    expect(rows.find((r) => r.name.fr === "Bourgogne")?.arrondissement).toBeNull();
  });

  it("gives it the postcodes Poste Maroc lists under the same name, an article set aside", () => {
    expect(rows.find((r) => r.name.fr === "Bourgogne")?.postcodes).toEqual(["20040", "20050"]);
    expect(rows.find((r) => r.name.fr === "L'Oasis")?.postcodes).toEqual(["20410"]);
    expect(rows.find((r) => r.name.fr === "Sidi Maârouf")?.postcodes).toEqual([]);
  });

  it("orders them by commune, then name", () => {
    expect(rows.map((r) => r.name.fr)).toEqual(["Bourgogne", "L'Oasis", "Sidi Maârouf"]);
  });

  it("collects each commune's postcodes, in order", () => {
    expect(postcodesByCommune([["20050", "a", []], ["20040", "a", []], ["85450", "b", []]])).toEqual(new Map([["a", ["20040", "20050"]], ["b", ["85450"]]]));
  });
});

describe("a neighbourhood the postcode list spells another way", () => {
  it("still gets its postcodes", () => {
    const rows = neighbourhoodTable([["Ain Diab", "عين الذئاب", "06.141.01.0", "osm"]], [["20180", "06.141.01.0", ["Ain Daib"]]], (c) => c);
    expect(rows[0]?.postcodes).toEqual(["20180"]);
  });
});
