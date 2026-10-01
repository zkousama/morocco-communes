import { describe, expect, it } from "vitest";
import { cityKey, cleanName, coreOf } from "../../src/lib/postNeighbourhoods.ts";

describe("a neighbourhood's name from Poste Maroc's list", () => {
  it("drops the QUARTIER label every row carries, and writes the name in title case", () => {
    expect(cleanName("QUARTIER MALABATA")).toBe("Malabata");
    expect(cleanName("QUARTIER  LA COLINE SIDI MAAROUF ")).toBe("La Coline Sidi Maarouf");
    expect(cleanName("QUARTIER HOUMATE ESPAGNOL")).toBe("Houmate Espagnol");
  });

  it("keeps the words people say, and the small French ones low", () => {
    expect(cleanName("HAY EL FATH")).toBe("Hay El Fath");
    expect(cleanName("DERB BEN JDIA")).toBe("Derb Ben Jdia");
    expect(cleanName("LOTISSEMENT DE LA PAIX")).toBe("Lotissement de la Paix");
    expect(cleanName("QUARTIER YASMINE II")).toBe("Yasmine II");
    expect(cleanName("QUARTIER BEN-MSIK D'ANFA")).toBe("Ben-Msik d'Anfa");
  });

  it("leaves out a building, a market or a block, and a name that's only a letter or a number", () => {
    for (const raw of ["IMMEUBLE MAARIF 1", "BLOC 21", "KISSARIAT EL HAJ", "MARCHE CENTRAL", "QUARTIER A", "QUARTIER 133", "QUARTIER", ""]) {
      expect(cleanName(raw), raw).toBeNull();
    }
  });
});

describe("comparing names", () => {
  it("sets an article aside, so L'Oasis and Oasis are the same place", () => {
    expect(coreOf("l oasis")).toBe(coreOf("oasis"));
    expect(coreOf("el fath")).toBe("fath");
    expect(coreOf("hay el fath")).toBe("hay el fath");
  });

  it("reads a city however it's run together", () => {
    expect(cityKey("ELJADIDA")).toBe(cityKey("El Jadida"));
    expect(cityKey("FES")).toBe(cityKey("Fès"));
  });
});

describe("a locality from Poste Maroc's list, matched to a commune", () => {
  it("matches a name spelt another way within its province, by its consonants", async () => {
    const { communeFor } = await import("../../src/lib/postNeighbourhoods.ts");
    const communes = [
      { code: "a", name: { fr: "Afourar" } },
      { code: "b", name: { fr: "Aguelmous" } },
      { code: "c", name: { fr: "Aghbalou" } },
      { code: "d", name: { fr: "Aghbalou Aqorar" } },
    ];
    expect(communeFor("AFOURER", communes)?.code).toBe("a");
    expect(communeFor("AGUELMOUSS", communes)?.code).toBe("b");
    expect(communeFor("AGHBALOU", communes)?.code).toBe("c");
    expect(communeFor("ABACHKOU", communes)).toBeNull();
  });
});

describe("2 spellings of the same neighbourhood", () => {
  it("are a swap, a doubled letter, or a vowel inside a long word", async () => {
    const { sameName } = await import("../../src/lib/postNeighbourhoods.ts");
    for (const [a, b] of [
      ["Ain Daib", "Ain Diab"],
      ["Ferme Bretone", "Ferme Bretonne"],
      ["Hay Al Izdihar", "Hay Al Izzdihar"],
      ["Habouss", "Habous"],
      ["Lot Anoaur", "Lot. Anouar"],
      ["Lot Mahrach", "Lot. Mahrech"],
      ["Hay Mohammadi", "Hay Mohammedi"],
      ["Hay Hassani", "Hay El Hassani"],
      ["Lotissement Mahrach", "Lot. Mahrech"],
    ]) {
      expect(sameName(a!, b!), `${a} = ${b}`).toBe(true);
    }
  });

  it("are never a changed or added consonant, a vowel at a word's end, a short word's vowel, or another sector", async () => {
    const { sameName } = await import("../../src/lib/postNeighbourhoods.ts");
    for (const [a, b] of [
      ["Hay Farah", "Hay Faraj"],
      ["Salama", "Salima"],
      ["Salma", "Salima"],
      ["Lot Erraja", "Lot. Erraha"],
      ["Lot Sania", "Lot. Rania"],
      ["Hay Al Amal", "Hay El Kamal"],
      ["El Harar", "El Hara"],
      ["Lot El Hilal", "Lot. Hilali"],
      ["Hay Hassania", "Hay Hassani"],
      ["Sidi Omar", "Sidi Amer"],
      ["Ain Chifa II", "Ain Chifa III"],
      ["Ain Chifa II", "Aîn-Chifaa"],
      ["Sidi Maarouf 4", "Sidi Maârouf"],
    ]) {
      expect(sameName(a!, b!), `${a} ≠ ${b}`).toBe(false);
    }
  });
});

describe("2 spellings under the same postcode", () => {
  it("may also differ by a vowel at a word's end, and still not by a consonant", async () => {
    const { sameName } = await import("../../src/lib/postNeighbourhoods.ts");
    expect(sameName("California", "Californie")).toBe(false);
    expect(sameName("California", "Californie", { samePostcode: true })).toBe(true);
    expect(sameName("Hay Farah", "Hay Faraj", { samePostcode: true })).toBe(false);
    expect(sameName("Farida", "Farid", { samePostcode: true })).toBe(false);
    expect(sameName("Lot El Hilal", "Lot. Hilali", { samePostcode: true })).toBe(false);
    expect(sameName("Ain Chifa II", "Ain Chifa III", { samePostcode: true })).toBe(false);
  });
});
