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
