import { describe, expect, it } from "vitest";
import { neighbourhoodsOf, postcodesOf } from "../src/lib/neighbourhoods.ts";
import { communes } from "../src/lib/places.ts";

const codeOf = (slug: string) => communes.find((c) => c.slug === slug)!.code;

describe("a commune's neighbourhoods", () => {
  it("lists a city's, with the arrondissement where it's known", () => {
    const rows = neighbourhoodsOf(codeOf("casablanca"));
    expect(rows.length).toBeGreaterThan(1000);
    expect(rows.find((r) => r.fr === "Sidi Maârouf")).toMatchObject({ arrondissement: "Aïn-Chock", ar: "سيدي معروف" });
    expect(rows.find((r) => r.fr === "Houmate Espagnol")).toBeUndefined();
  });

  it("gives a neighbourhood its postcodes, from Poste Maroc's list under the same name", () => {
    const rows = neighbourhoodsOf(codeOf("casablanca"));
    expect(rows.find((r) => r.fr === "Bourgogne")?.postcodes).toEqual(["20040", "20050"]);
    expect(neighbourhoodsOf(codeOf("tanger")).find((r) => r.fr === "Houmate Espagnol")?.postcodes).toEqual(["90000"]);
  });

  it("is in alphabetical order, and empty where there are none", () => {
    const names = neighbourhoodsOf(codeOf("agadir")).map((r) => r.fr);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "fr")));
    expect(neighbourhoodsOf(codeOf("tifariti"))).toEqual([]);
  });
});

describe("a commune's postcodes", () => {
  it("are Poste Maroc's, in order", () => {
    expect(postcodesOf(codeOf("tafraout"))).toEqual(["85450"]);
    const casablanca = postcodesOf(codeOf("casablanca"));
    expect(casablanca[0]).toBe("20000");
    expect(casablanca).toEqual([...casablanca].sort());
  });
});
