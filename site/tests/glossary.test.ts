import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glossary } from "../src/i18n/glossary.ts";
import { hcpDefinition } from "../src/lib/definitions.ts";
import { PAGES } from "../src/i18n/ui.ts";

const locales = ["en", "fr"] as const;
const ids = (locale: (typeof locales)[number]) => glossary[locale].groups.flatMap((g) => g.entries.map((e) => e.id));

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|astro)$/.test(path) ? [path] : [];
  });

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
          const said = (entry.body ?? "") + (entry.hcpTerm ? hcpDefinition(entry.hcpTerm).body : "");
          expect(said.length, `${locale} ${entry.id}`).toBeGreaterThan(40);
        }
      }
    }
  });

  it("writes its own English for a term HCP defines, and none of its own French", () => {
    for (const locale of locales) {
      for (const entry of glossary[locale].groups.flatMap((g) => g.entries)) {
        if (locale === "en") expect(entry.body, entry.id).toBeTruthy();
        else if (entry.hcpTerm === undefined) expect(entry.body, entry.id).toBeTruthy();
      }
    }
  });

  it("takes HCP's wording from the dataset, so the page can't drift from it", () => {
    const named = locales.flatMap((l) => glossary[l].groups.flatMap((g) => g.entries)).filter((e) => e.hcpTerm);
    expect(named.length).toBeGreaterThan(30);
    for (const entry of named) expect(() => hcpDefinition(entry.hcpTerm!), entry.id).not.toThrow();
    // The dwelling types are the ones the housing workbook defines.
    const ids = new Set(glossary.en.groups.flatMap((g) => g.entries).filter((e) => e.hcpTerm).map((e) => e.id));
    expect([...ids]).toEqual(expect.arrayContaining(["modern-house", "traditional-house", "shortfall"]));
  });

  it("anchors every link the site points at it", () => {
    const anchors = new Set([...glossary.en.groups.map((g) => g.id), ...ids("en")]);
    const links = sources("site/src").flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/docs\/glossary\/#([a-z0-9-]+)/g)].map((m) => ({ file, id: m[1]! })),
    );
    expect(links.length).toBeGreaterThan(2);
    expect(links.filter((l) => !anchors.has(l.id)).map((l) => `${l.file} points at #${l.id}`)).toEqual([]);
  });
});
