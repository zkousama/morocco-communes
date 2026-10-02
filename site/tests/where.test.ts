import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGES, t } from "../src/i18n/ui.ts";
import { explore } from "../src/lib/nav.ts";
import { whereLists, whereSections, type WhereUnit } from "../src/lib/where.ts";

const page = (code: string) => ({ name: code.toUpperCase(), route: `communes/${code}/` });
const unit = (code: string, population: number, shares: WhereUnit["shares"], souks: number | null = null): WhereUnit => ({
  code,
  population,
  shares,
  souks,
});

describe("which communes meet each bar", () => {
  const units = [
    unit("a", 5000, { "commute.tram": 4, "commute.train": 0.5, foreign: 0.4 }, 2),
    unit("b", 5000, { "commute.tram": 1, "commute.train": 3, foreign: 0.5 }, 0),
    unit("c", 500, { "commute.tram": 20, foreign: 8 }, 1),
  ];
  const sections = whereSections(units, page);
  const rows = (id: string) => sections.find((section) => section.id === id)!.rows;

  it("keeps a commune of 1,000 people or more whose share meets the bar, highest first", () => {
    expect(rows("tram").map((row) => [row.code, row.value])).toEqual([
      ["a", 4],
      ["b", 1],
    ]);
    expect(rows("train").map((row) => row.code)).toEqual(["b"]);
  });

  it("uses half a percent for foreign residents", () => {
    expect(rows("foreign").map((row) => row.code)).toEqual(["b"]);
  });

  it("keeps a weekly souk list of 100 communes and drops one of 101", () => {
    const many = Array.from({ length: 101 }, (_, i) => unit(`s${i}`, 2000, {}, 1));
    expect(whereSections(many, page).find((section) => section.id === "souk")).toBeUndefined();
    expect(whereSections(many.slice(0, 100), page).find((section) => section.id === "souk")?.rows).toHaveLength(100);
  });

  it("leaves out a commune with no page", () => {
    expect(whereSections(units, () => null)).toEqual([]);
  });
});

describe("the published lists", () => {
  const sections = whereLists();

  it("lists only the figures that 100 communes or fewer meet", () => {
    expect(sections.map((section) => [section.id, section.rows.length])).toEqual([
      ["tram", 6],
      ["train", 39],
      ["foreign", 50],
    ]);
  });

  it("puts Rabat among the tram communes, and sorts each list by its figure", () => {
    const tram = sections.find((section) => section.id === "tram")!;
    expect(tram.rows).toContainEqual(expect.objectContaining({ name: "Rabat", value: 1.6 }));
    for (const section of sections) {
      const values = section.rows.map((row) => row.value);
      expect(values).toEqual([...values].sort((a, b) => b - a));
    }
  });

  it("sits on the insights page, and the old page sends a reader there", () => {
    expect(PAGES).not.toContain("where/");
    expect(explore(t("en")).map((section) => section.route)).not.toContain("where/");
    expect(readFileSync("site/src/components/Standouts.astro", "utf8")).toContain("<RareLists");
    const config = readFileSync("site/astro.config.mjs", "utf8");
    expect(config).toContain('"/where": "/insights/#rare"');
    expect(config).toContain('"/fr/where": "/fr/insights/#rare"');
  });
});
