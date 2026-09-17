import { describe, expect, it } from "vitest";
import { slugify, uniqueSlugs } from "../../src/lib/slug.ts";

describe("slugify", () => {
  it("drops the label and folds accents", () => {
    expect(slugify("Commune de Tétouan")).toBe("tetouan");
    expect(slugify("Commune d'Assilah")).toBe("assilah");
    expect(slugify("Arrondissement de Sidi Belyout")).toBe("sidi-belyout");
    expect(slugify("Commune de Méchouar-Fès-El Jadid")).toBe("mechouar-fes-el-jadid");
  });
});

describe("uniqueSlugs", () => {
  it("disambiguates a shared name with the code, stably", () => {
    const got = uniqueSlugs([
      { code: "06.141.01.0", nameFr: "Commune de Casablanca" },
      { code: "09.351.03.5", nameFr: "Commune de Casablanca" },
    ]);
    expect(got.get("06.141.01.0")).toBe("casablanca-06141010");
    expect(got.get("09.351.03.5")).toBe("casablanca-09351035");
  });

  it("leaves a unique name alone", () => {
    const got = uniqueSlugs([{ code: "01.511.01.0", nameFr: "Commune de Tanger" }]);
    expect(got.get("01.511.01.0")).toBe("tanger");
  });
});
