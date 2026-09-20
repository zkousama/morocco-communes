import { describe, expect, it } from "vitest";
import { glossary } from "../src/i18n/glossary.ts";
import { PAGES } from "../src/i18n/ui.ts";

const locales = ["en", "fr"] as const;
const ids = (locale: (typeof locales)[number]) => glossary[locale].groups.flatMap((g) => g.entries.map((e) => e.id));

describe("the glossary", () => {
  it("is a page of the site", () => {
    expect(PAGES).toContain("docs/glossary/");
  });

  it("gives every term an id of its own, so a link can point at one", () => {
    for (const locale of locales) {
      expect(new Set(ids(locale)).size, locale).toBe(ids(locale).length);
    }
  });

  it("covers the same terms in both languages, in the same order", () => {
    expect(ids("fr")).toEqual(ids("en"));
    expect(glossary.fr.groups.map((g) => g.id)).toEqual(glossary.en.groups.map((g) => g.id));
  });

  it("says something about every term", () => {
    for (const locale of locales) {
      for (const group of glossary[locale].groups) {
        for (const entry of group.entries) {
          expect(entry.term.length, `${locale} ${entry.id}`).toBeGreaterThan(2);
          expect(entry.body.length, `${locale} ${entry.id}`).toBeGreaterThan(40);
        }
      }
    }
  });

  it("quotes HCP in French only, since the French entry is already its words", () => {
    expect(glossary.fr.groups.flatMap((g) => g.entries).filter((e) => e.hcp)).toEqual([]);
    // The dwelling terms are the ones HCP defines in the workbook.
    const quoted = glossary.en.groups.flatMap((g) => g.entries).filter((e) => e.hcp).map((e) => e.id);
    expect(quoted).toContain("modern-house");
    expect(quoted).toContain("traditional-house");
    expect(quoted).toContain("shortfall");
    expect(quoted.length).toBeGreaterThan(15);
  });

  it("anchors the links the place pages point at", () => {
    const groups = glossary.en.groups.map((g) => g.id);
    expect(groups).toContain("dwellings");
    expect(groups).toContain("work");
  });
});
