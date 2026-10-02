import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGES } from "../src/i18n/ui.ts";
import { naming, spell } from "../src/lib/naming.ts";

/**
 * The numbers the page on douar names states, against the data and code they come from: every
 * one is read from `naming`, so once the expressions are out, no digit but the 2 of "the 2
 * scripts" may be left in either page.
 */
describe("the page on douar names", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const pages = { en: source("site/src/pages/docs/names.astro"), fr: source("site/src/pages/fr/docs/names.astro") };

  /** A page's reader-facing text: its markup, with every expression, code span and tag taken out. */
  const prose = (page: string) => {
    let body = page.split("---")[2]!.replace(/<code>[\s\S]*?<\/code>/g, " ");
    while (/\{[^{}<>]*\}/.test(body)) body = body.replace(/\{[^{}<>]*\}/g, " ");
    return body.replace(/<[^>]*>/g, " ").replace(/[ \t\r\n]+/g, " ");
  };

  it("leaves no number typed into either page", () => {
    for (const locale of ["en", "fr"] as const) {
      const text = prose(pages[locale]).replace(/\b2\b/g, " ");
      expect(text.match(/.{0,30}\d.{0,30}/g), locale).toBeNull();
    }
  });

  it("gives counts that add up", () => {
    expect(naming.education + naming.osm + naming.geonames).toBeLessThanOrEqual(naming.sourced);
    expect(naming.sourced + naming.spelt).toBe(naming.douars);
    expect(naming.chance.schools).toBeLessThanOrEqual(naming.chance.most);
    expect(naming.chance.places).toBeLessThanOrEqual(naming.chance.most);
    expect(naming.chance.near).toBeLessThanOrEqual(naming.chance.most);
  });

  it("shows the rules its examples are there for", () => {
    // A word the table has, as HCP writes the commune, and one it hasn't, by the rules.
    expect(spell("تالوين")).toBe("Taliouine");
    expect(spell("تيفنوين")).toBe("Tifnouine");
  });

  it("is linked from where the names show, and listed for the sitemap", () => {
    expect(PAGES).toContain("docs/names/");
    expect(source("site/src/components/places/Douars.astro")).toContain('path(locale, "docs/names/")');
    expect(source("site/src/components/DouarsPage.astro")).toContain('path(locale, "docs/names/")');
  });
});
