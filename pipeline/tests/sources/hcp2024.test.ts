import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyRow, toRawRow } from "../../src/sources/hcp2024.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/hcp2024-rows.sample.json", import.meta.url), "utf8"),
) as { tanger: (string | null)[][]; casa: (string | null)[][] };

describe("classifyRow", () => {
  it("reads the ordinary labels", () => {
    expect(classifyRow("Région de Tanger-Tétouan-Al Hoceima")).toBe("region");
    expect(classifyRow("Préfecture de Tanger-Assilah")).toBe("prefecture");
    expect(classifyRow("Province de Tétouan")).toBe("province");
    expect(classifyRow("Cercle de Tanger")).toBe("cercle");
    expect(classifyRow("Commune de Tanger")).toBe("commune");
    expect(classifyRow("Arrondissement de Mghogha")).toBe("arrondissement");
    expect(classifyRow("dont le centre urbain de Dar Chaoui")).toBe("urbanCentre");
  });

  it("separates a préfecture d'arrondissements from a préfecture, both numbers", () => {
    expect(classifyRow("Préfecture d'arrondissements de Casablanca-Anfa")).toBe("prefectureOfArrondissements");
    expect(classifyRow("Préfecture d'arrondissement de Hay-Hassani")).toBe("prefectureOfArrondissements");
  });

  it("accepts the 2014 spelling, which uses U+2019 and a capital A", () => {
    expect(classifyRow("Préfecture d’Arrondissements Casablanca Anfa")).toBe("prefectureOfArrondissements");
    expect(classifyRow("Préfecture d’Arrondissement  Hay Hassani")).toBe("prefectureOfArrondissements");
  });
});

describe("toRawRow", () => {
  it("reads name, code and counts off a commune row", () => {
    const row = fixture.tanger.find((r) => r[0] === "Commune de Tanger")!;
    const parsed = toRawRow(row);
    expect(parsed).toMatchObject({ kind: "commune", nameFr: "Commune de Tanger", code: "1511010" });
    expect(parsed.population).toBeGreaterThan(1_000_000);
    expect(parsed.households).toBeGreaterThan(0);
  });

  it("finds Méchouar de Casablanca as a commune inside the arrondissement block", () => {
    const row = fixture.casa.find((r) => r[0] === "Commune de Méchouar de Casablanca")!;
    expect(toRawRow(row).kind).toBe("commune");
  });
});
