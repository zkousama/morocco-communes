import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { names } from "../src/i18n/names.ts";
import { PAGES } from "../src/i18n/ui.ts";
import { consonantsOf, naming, spell } from "../src/lib/naming.ts";
import { arabicKeys, latinKeys } from "../../api/src/lib/translit.ts";

/** Every string in an object, however deep. */
const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

describe("the page on douar names", () => {
  it("types no number into its words: each one comes from naming, but the 2 of both", () => {
    for (const locale of ["en", "fr"] as const) {
      const text = strings(names[locale]).join(" ").replace(/\{\w+\}/g, " ").replace(/\b2\b/g, " ");
      expect(text.match(/.{0,30}\d.{0,30}/g), locale).toBeNull();
    }
  });

  it("gives counts that add up", () => {
    expect(naming.education + naming.osm + naming.geonames + naming.visitors).toBe(naming.sourced);
    expect(naming.sourced + naming.spelt).toBe(naming.douars);
    expect(naming.fractionsNamed + naming.outside + naming.notional).toBeLessThanOrEqual(naming.fractions);
    for (const chance of [naming.chance.schools, naming.chance.places, naming.chance.near]) expect(chance).toBeLessThanOrEqual(naming.chance.most);
  });

  it("shows the engine reading its examples down to consonants both scripts share", () => {
    // A word the table has, as HCP writes the commune, and a douar GeoNames names.
    expect(spell("تالوين")).toBe("Taliouine");
    expect(spell("توريرت نترست")).toBe("Taourirt n'Tirst");
    for (const arabic of ["تالوين", "توريرت نترست"]) {
      expect(consonantsOf(arabic).join("").toLowerCase()).toBe(arabicKeys(arabic)[0]);
      expect(latinKeys(spell(arabic))).toContain(arabicKeys(arabic)[0]);
    }
  });

  it("is linked from where the names show, and listed for the sitemap", () => {
    expect(PAGES).toContain("docs/names/");
    expect(readFileSync("site/src/components/places/Douars.astro", "utf8")).toContain('path(locale, "docs/names/")');
    expect(readFileSync("site/src/components/DouarsPage.astro", "utf8")).toContain('path(locale, "docs/names/")');
  });
});
