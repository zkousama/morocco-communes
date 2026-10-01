import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "../src/i18n/ui.ts";
import { menu } from "../src/lib/nav.ts";

const routes = (locale: "en" | "fr") => menu(t(locale)).map((group) => [group.label, group.sections.map((s) => s.route)]);

describe("the header and the phone menu", () => {
  it("share one list of groups", () => {
    const links = [
      ["communes/", "insights/", "where/", "compare/", "douars/"],
      ["docs/indicators/", "docs/glossary/"],
      ["docs/api/", "docs/mcp/", "docs/components/", "docs/npm/", "docs/python/"],
    ];
    expect(routes("en")).toEqual([
      ["Explore", links[0]],
      ["Data", links[1]],
      ["Build", links[2]],
    ]);
    expect(routes("fr")).toEqual([
      ["Explorer", links[0]],
      ["Données", links[1]],
      ["Développer", links[2]],
    ]);
    const flat = links.flat();
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("renders that list in the bar and in the phone menu", () => {
    const base = readFileSync(new URL("../src/layouts/Base.astro", import.meta.url), "utf8");
    const sheet = readFileSync(new URL("../src/components/Sheet.astro", import.meta.url), "utf8");
    expect(base).toContain("menuGroups(copy)");
    expect(sheet).toContain("menu(copy)");
    expect(base).not.toContain("explore(copy)");
    expect(sheet).not.toContain("explore(copy)");
    expect(sheet).not.toContain("build(copy)");
    expect(base).toContain("<details");
    expect(base).toContain("aria-expanded");
  });
});
