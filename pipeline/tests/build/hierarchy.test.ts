import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toRawRow } from "../../src/sources/hcp2024.ts";
import { buildHierarchy } from "../../src/build/hierarchy.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/hcp2024-rows.sample.json", import.meta.url), "utf8"),
) as { tanger: (string | null)[][]; casa: (string | null)[][] };

const rows = [...fixture.tanger, ...fixture.casa]
  .filter((r) => (r[0] ?? "").trim().length > 0)
  .map(toRawRow);
const built = buildHierarchy(rows);

describe("buildHierarchy", () => {
  it("marks a commune listed before any cercle as urban", () => {
    const tanger = built.communes.find((c) => c.nameFr === "Commune de Tanger")!;
    expect(tanger.type).toBe("urban");
    expect(tanger.cercleCode).toBeNull();
    expect(tanger.code).toBe("01.511.01.0");
  });

  it("marks a commune under a cercle as rural and records the cercle", () => {
    const hjar = built.communes.find((c) => c.nameFr === "Commune de Hjar Ennhal")!;
    expect(hjar.type).toBe("rural");
    expect(hjar.cercleCode).toBe("01.511.05");
  });

  it("attaches an urban centre to the rural commune that contains it", () => {
    const dar = built.communes.find((c) => c.nameFr === "Commune de Dar Chaoui")!;
    expect(dar.urbanCentre?.nameFr).toContain("Dar Chaoui");
  });

  it("gives the province its own five-digit code rather than a composed one", () => {
    const tanger = built.communes.find((c) => c.nameFr === "Commune de Tanger")!;
    expect(tanger.provinceCode).toBe("01.511");
    expect(tanger.regionCode).toBe("01");
  });

  it("keeps Méchouar de Casablanca under the préfecture, not a préfecture d'arrondissements", () => {
    const mechouar = built.communes.find((c) => c.nameFr === "Commune de Méchouar de Casablanca")!;
    expect(mechouar.provinceCode).toBe("06.141");
    expect(mechouar.codeDigits).toBe("061410181");
  });

  it("attaches arrondissements to the enclosing commune row", () => {
    const anfa = built.arrondissements.find((a) => a.nameFr === "Arrondissement d'Anfa")!;
    expect(anfa.communeCode).toBe("06.141.01.0");
    expect(anfa.prefectureOfArrondissementsCode).toBe("06.141.01.00");
  });

  it("files the eight Casablanca préfectures d'arrondissements as their own province type", () => {
    const grouped = built.provinces.filter((p) => p.type === "prefecture_of_arrondissements");
    expect(grouped.length).toBe(8);
  });
});
