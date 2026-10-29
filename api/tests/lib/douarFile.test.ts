import { describe, expect, it } from "vitest";
import { communeFor, indexCommunes, placeName, placedCommune, type NamedCommune } from "../../src/lib/douarFile.ts";

const commune = (code: string, name: string, bbox: NamedCommune["bbox"]): NamedCommune => ({ code, name, bbox });

const communes = [
  commune("a", "Aoulouz", [-8.2, 30.6, -8.0, 30.8]),
  commune("b", "Sidi Abdallah El Bouchouari", [-9.1, 31.4, -8.9, 31.6]),
  commune("c", "Sidi Abdallah El Ghiat", [-8.4, 31.5, -8.2, 31.7]),
  commune("d1", "Ain Leuh", [-5.4, 33.2, -5.2, 33.4]),
  commune("d2", "Ain Leuh", [-4.4, 34.2, -4.2, 34.4]),
];

const index = indexCommunes(communes);
const point = (lat: number, lng: number) => ({ lat, lng });

describe("a commune name from the purchased douar file", () => {
  it("matches the one commune that spells it, and a point inside that commune", () => {
    expect(communeFor(index, "Aoulouz", point(30.7, -8.1))).toBe("a");
  });

  it("drops the municipal tag the file hangs on a town", () => {
    expect(communeFor(index, "Aoulouz (Mun.)", point(30.7, -8.1))).toBe("a");
  });

  it("joins El where the file glues it to the word before", () => {
    expect(communeFor(index, "Sidi AbdallahEl Bouchouari", point(31.5, -9.0))).toBe("b");
  });

  it("joins a name that leaves El out, when one commune spells it with El", () => {
    expect(communeFor(index, "Sidi Abdallah Ghiat", point(31.6, -8.3))).toBe("c");
  });

  it("picks the commune of that name whose box holds the point", () => {
    expect(communeFor(index, "Ain Leuh", point(33.3, -5.3))).toBe("d1");
    expect(communeFor(index, "Ain Leuh", point(34.3, -4.3))).toBe("d2");
  });

  it("leaves a point that sits in neither commune", () => {
    expect(communeFor(index, "Aoulouz", point(34.0, -2.0))).toBeNull();
    expect(communeFor(index, "Ain Leuh", point(30.0, -8.0))).toBeNull();
    expect(communeFor(index, "", point(30.7, -8.1))).toBeNull();
  });

  it("uses the boundary when two boxes both hold the point", () => {
    const overlapping = indexCommunes([
      commune("p", "Aghbal", [-6.0, 35.0, -5.0, 35.5]),
      commune("q", "Aghbal", [-5.5, 35.2, -4.5, 35.8]),
    ]);
    const at = point(35.3, -5.25);
    expect(communeFor(overlapping, "Aghbal", at)).toBeNull();
    expect(communeFor(overlapping, "Aghbal", at, (code) => code === "q")).toBe("q");
  });
});

describe("which commune a purchased point is matched in", () => {
  it("uses the boundary, and the file's commune name only where the point falls in none", () => {
    expect(placedCommune("labelled", "boundary")).toBe("boundary");
    expect(placedCommune(null, "boundary")).toBe("boundary");
    expect(placedCommune("labelled", null)).toBe("labelled");
    expect(placedCommune(null, null)).toBeNull();
  });
});

describe("a douar name from the purchased file", () => {
  it("comes off the capitals the file writes", () => {
    expect(placeName("FALLAKINE SOUFLA")).toBe("Fallakine Soufla");
    expect(placeName("M'HAMID EL GHIZLANE")).toBe("M'Hamid El Ghizlane");
  });
});
