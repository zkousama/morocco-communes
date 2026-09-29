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

  it("uses half a percent for foreign residents, and still counts a small commune's souks", () => {
    expect(rows("foreign").map((row) => row.code)).toEqual(["b"]);
    expect(rows("souk").map((row) => [row.code, row.value])).toEqual([
      ["a", 2],
      ["c", 1],
    ]);
  });

  it("leaves out a commune with no page", () => {
    expect(whereSections(units, () => null)).toEqual([]);
  });
});

describe("the published lists", () => {
  const sections = whereLists();

  it("lists tram, train, bus, employer transport, taxi, weekly souks and foreign residents", () => {
    expect(sections.map((section) => [section.id, section.rows.length])).toEqual([
      ["tram", 6],
      ["train", 39],
      ["bus", 1058],
      ["employerTransport", 1294],
      ["taxi", 1225],
      ["souk", 893],
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

  it("is in the explore menu beside insights, and in the sitemap", () => {
    expect(PAGES).toContain("where/");
    const en = explore(t("en")).map((section) => section.route);
    const fr = explore(t("fr")).map((section) => section.route);
    expect(en).toContain("where/");
    expect(fr).toContain("where/");
    expect(en.indexOf("where/")).toBe(en.indexOf("insights/") + 1);
  });
});
