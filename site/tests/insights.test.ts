import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommuneFile, Published } from "../../insights/src/run.ts";
import { PAGES, t } from "../src/i18n/ui.ts";
import { explore } from "../src/lib/nav.ts";
import { insightsOf, method, nearLine, readInsights, since2014Line, standouts } from "../src/lib/insights.ts";
import { communeOf, pageOf } from "../src/lib/places.ts";

describe("insights on the site", () => {
  it("reads nothing, without failing, when none are published", () => {
    expect(readInsights(join(mkdtempSync(join(tmpdir(), "none-")), "insights")).size).toBe(0);
  });

  it("finds a commune's figures by its code, and nothing for a commune without", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ins-")), "insights");
    mkdirSync(join(dir, "communes"), { recursive: true });
    writeFileSync(join(dir, "communes", "04.421.01.0.json"), JSON.stringify({ code: "04.421.01.0", level: "commune", datasetVersion: "1.9.0", findings: [] }));
    const read = readInsights(dir);
    expect(read.get("04.421.01.0")?.datasetVersion).toBe("1.9.0");
    expect(read.get("09.581.01.07")).toBeUndefined();
  });
});

const figure = (over: Partial<Published> = {}, context: Partial<Published["context"]> = {}): Published => ({
  id: "f",
  kind: "extreme",
  measure: "labour.unemploymentRate",
  value: 40,
  reference: 15,
  score: 4,
  direction: "high",
  line: { en: "", fr: "" },
  breakdown: null,
  ...over,
  context: { others: [], neighbours: null, since2014: null, ...context },
});

const joined = (parts: ReturnType<typeof nearLine>) => parts && `${parts.before}${parts.name}${parts.after}`;
const around = (over: Partial<NonNullable<Published["context"]["neighbours"]>> = {}) => ({
  bordering: 5,
  compared: 5,
  median: 12.25,
  furthest: { code: "01.511.01.0", name: { fr: "Tanger", ar: null }, value: 8 },
  ...over,
});

describe("the line on the communes it borders", () => {
  it("gives their median and the one furthest off, named apart so the page can link it", () => {
    const parts = nearLine("en", figure({}, { neighbours: around() }));
    expect(parts).toMatchObject({ code: "01.511.01.0", name: "Tanger" });
    expect(joined(parts)).toBe("Across the 5 communes it borders, the median is 12.3%. Tanger is furthest from it, at 8.0%.");
    expect(joined(nearLine("fr", figure({}, { neighbours: around() })))).toBe(
      "Sur les 5 communes voisines, la médiane est de 12,3\u202f%. Tanger en est la plus éloignée, à 8,0\u202f%.",
    );
  });

  it("says when only some of them were compared", () => {
    expect(joined(nearLine("en", figure({}, { neighbours: around({ compared: 4, bordering: 6 }) })))).toMatch(/^Across 4 of the 6 communes it borders,/);
    expect(joined(nearLine("fr", figure({}, { neighbours: around({ compared: 4, bordering: 6 }) })))).toMatch(/^Sur 4 des 6 communes voisines,/);
  });

  it("names the one when only one could be compared", () => {
    const one = around({ compared: 1, median: 8 });
    expect(joined(nearLine("en", figure({}, { neighbours: one })))).toBe("Of the communes it borders, only Tanger can be compared: 8.0%.");
    expect(joined(nearLine("fr", figure({}, { neighbours: one })))).toBe("Parmi les communes voisines, seule Tanger peut être comparée : 8,0\u202f%.");
  });

  it("sets a change against theirs, signed, in points", () => {
    const moved = figure({ kind: "change", value: 30 }, { neighbours: around({ median: 1.25, furthest: { code: "x", name: { fr: "Tanger", ar: null }, value: -3 } }) });
    expect(joined(nearLine("en", moved))).toBe("Across the 5 communes it borders, the median since 2014 is +1.3 points. Tanger is furthest from it, at −3.0 points.");
    expect(joined(nearLine("fr", moved))).toBe("Sur les 5 communes voisines, la médiane depuis 2014 est de +1,3 point. Tanger en est la plus éloignée, à −3,0 points.");
  });

  it("writes a figure that isn't a share in its own unit", () => {
    const fertility = figure({ measure: "fertility.totalFertilityRate" }, { neighbours: around({ median: 2.4, furthest: { code: "x", name: { fr: "Tanger", ar: null }, value: 1.9 } }) });
    expect(joined(nearLine("en", fertility))).toBe("Across the 5 communes it borders, the median is 2.40 children per woman. Tanger is furthest from it, at 1.90 children per woman.");
  });

  it("gives nothing when no neighbour could be compared", () => {
    expect(nearLine("en", figure())).toBeNull();
  });
});

describe("the line on 2014", () => {
  const since = { then: 30, now: 40, morocco: { then: 16.2, now: 13.3 } };

  it("gives the commune's 2014 figure, then Morocco's move in whole points", () => {
    expect(since2014Line("en", figure({}, { since2014: since }))).toBe("In 2014 it was 30.0%. Across Morocco, the fall was 3 points.");
    expect(since2014Line("fr", figure({}, { since2014: since }))).toBe("En 2014, ce chiffre était de 30,0\u202f%. Au Maroc, la baisse a été de 3 points.");
  });

  it("gives only Morocco's for a change, whose line already has both years", () => {
    expect(since2014Line("en", figure({ kind: "change" }, { since2014: since }))).toBe("Across Morocco, the fall was 3 points.");
  });

  it("gives Morocco's 2 figures for a measure that isn't a share", () => {
    const fertility = figure({ measure: "fertility.totalFertilityRate" }, { since2014: { then: 2.5, now: 2.2, morocco: { then: 2.21, now: 1.97 } } });
    expect(since2014Line("en", fertility)).toBe("In 2014 it was 2.50 children per woman. Across Morocco, it went from 2.21 to 1.97 children per woman.");
  });

  it("gives nothing where 2014 can't be set beside it", () => {
    expect(since2014Line("en", figure())).toBeNull();
  });
});

/**
 * The numbers the methods page states, against the code that decides them: every one comes
 * from `method`, so once they and the years are taken out, no digit may be left in either page.
 */
describe("the methods page's numbers", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const pages = { en: source("site/src/pages/docs/insights.astro"), fr: source("site/src/pages/fr/docs/insights.astro") };

  /** A page's reader-facing text: its markup, with every expression, code span and tag taken out. */
  const prose = (page: string) => {
    let body = page.split("---")[2]!.replace(/<style>[\s\S]*<\/style>/, "").replace(/<code>[\s\S]*?<\/code>/g, " ");
    while (/\{[^{}<>]*\}/.test(body)) body = body.replace(/\{[^{}<>]*\}/g, " ");
    return body.replace(/<[^>]*>/g, " ").replace(/[ \t\r\n]+/g, " ");
  };

  it("takes each threshold from the code that applies it", () => {
    for (const key of ["swing", "fall", "neighbourFloor", "extremeFloor", "changeGapFloor", "kept", "perPlace"] as const) {
      expect(pages.en, key).toContain(`method.${key}`);
      expect(pages.fr, key).toContain(`method.${key}`);
    }
    expect(method.neighbourFloor).toBe(method.changeGapFloor);
  });

  it("links the methods page at the figures, and lists that page for the sitemap", () => {
    expect(pages.en).toContain('href="/insights/"');
    expect(pages.fr).toContain('href="/fr/insights/"');
    expect(PAGES).toContain("insights/");
    expect(explore(t("en")).find((section) => section.label === "Insights")?.route).toBe("insights/");
    expect(explore(t("fr")).find((section) => section.label === "Constats")?.route).toBe("insights/");
  });

  it("leaves no other number typed into either page", () => {
    for (const locale of ["en", "fr"] as const) {
      // The census years, and the year of the pilot.
      const text = prose(pages[locale]).replace(/\b(2014|2024|2026)\b/g, " ");
      expect(text.match(/.{0,30}\d.{0,30}/g), locale).toBeNull();
    }
  });
});

const commune = (code: string, findings: Partial<Published>[], name = code): CommuneFile => ({
  code,
  level: "commune",
  name: { fr: name, ar: null },
  datasetVersion: "1.9.0",
  findings: findings.map((over, i) => figure({ id: `${code}-${i}`, ...over })),
});

const page = (code: string) => ({ route: `communes/${code}/` });

describe("the insights page's list", () => {
  it("keeps one finding per commune, the higher score, in score order", () => {
    const files = [
      commune("a", [
        { score: 5, line: { en: "lower", fr: "bas" } },
        { score: 9, line: { en: "higher", fr: "haut" } },
      ]),
      commune("b", [{ score: 7, line: { en: "middle", fr: "milieu" } }]),
    ];
    const rows = standouts(files, page).flatMap((group) => group.rows);
    expect(rows.map((row) => [row.code, row.score, row.line.en, row.name, row.route])).toEqual([
      ["a", 9, "higher", "a", "communes/a/"],
      ["b", 7, "middle", "b", "communes/b/"],
    ]);
  });

  it("keeps the 60 highest", () => {
    const files = Array.from({ length: 61 }, (_, i) => commune(`c${String(i).padStart(2, "0")}`, [{ score: i + 1 }]));
    const scores = standouts(files, page).flatMap((group) => group.rows.map((row) => row.score));
    expect(scores).toEqual(Array.from({ length: 60 }, (_, i) => 61 - i));
  });

  it("groups by the topic before the dot, the highest group first", () => {
    const files = [
      commune("a", [{ score: 3, measure: "housing.type.other" }]),
      commune("b", [{ score: 9, measure: "labour.unemploymentRate" }]),
      commune("c", [{ score: 4, measure: "labour.activityRate" }]),
    ];
    const groups = standouts(files, page);
    expect(groups.map((group) => group.topic)).toEqual(["labour", "housing"]);
    expect(groups[0]!.rows.map((row) => row.code)).toEqual(["b", "c"]);
    expect(groups[1]!.rows.map((row) => row.code)).toEqual(["a"]);
  });

  it("drops a commune that has no page", () => {
    const files = [commune("kept", [{ score: 2 }], "Kept"), commune("gone", [{ score: 9 }], "Gone")];
    const rows = standouts(files, (code) => (code === "gone" ? null : page(code))).flatMap((group) => group.rows);
    expect(rows.map((row) => [row.code, row.name])).toEqual([["kept", "Kept"]]);
  });

  it("keeps every row's commune in the published data", () => {
    const rows = standouts(insightsOf.values(), pageOf).flatMap((group) => group.rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.code)).size).toBe(rows.length);
    for (const row of rows) {
      expect(communeOf.has(row.code), row.code).toBe(true);
      expect(insightsOf.get(row.code)?.name.fr).toBe(row.name);
      expect(pageOf(row.code)?.route).toBe(row.route);
    }
  });
});
