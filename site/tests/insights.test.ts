import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Data } from "../../insights/src/data.ts";
import { mutations } from "../../insights/src/mutate.ts";
import { ONE_SIDED_Z } from "../../insights/src/score.ts";
import { wilson } from "../../insights/src/stats.ts";
import { CHECK_GRAMMAR, type Check } from "../../insights/src/vocabulary.ts";
import { evidenceNumbers, flagOf, introOf, readMetrics, readUnitInsights, type UnitInsights } from "../src/lib/insights.ts";
import { places } from "../src/i18n/places.ts";

describe("insights on the site", () => {
  it("reads nothing, without failing, when none are published", () => {
    expect(readUnitInsights(join(mkdtempSync(join(tmpdir(), "none-")), "insights")).size).toBe(0);
  });

  it("finds a place's insights by its code, and nothing for a place without", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ins-")), "insights");
    mkdirSync(join(dir, "communes"), { recursive: true });
    writeFileSync(join(dir, "communes", "04.421.01.0.json"), JSON.stringify({ code: "04.421.01.0", level: "commune", checkedAt: "2026-09-24", findings: [] }));
    const read = readUnitInsights(dir);
    expect(read.get("04.421.01.0")?.checkedAt).toBe("2026-09-24");
    expect(read.get("09.581.01.07")).toBeUndefined();
  });

  it("has no grading numbers before the first publish", () => {
    expect(readMetrics(join(mkdtempSync(join(tmpdir(), "none-")), "published.json"))).toBeNull();
  });

  it("quotes the numbers the published run passed with", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pub-")), "published.json");
    const metrics = { runId: "run-a", measuredAt: "2026-09-24T00:00:00.000Z" };
    writeFileSync(path, JSON.stringify({ runId: "run-a", publishedAt: "2026-09-25T00:00:00.000Z", metrics }));
    expect(readMetrics(path)).toEqual(metrics);
  });
});

describe("the section on a place page", () => {
  const finding = (kind: string, hypotheses: unknown[]) => ({ id: "f", kind, measure: "m", line: { en: "", fr: "" }, breakdown: null, hypotheses });
  const record = (...findings: ReturnType<typeof finding>[]) => ({ code: "c", level: "commune", checkedAt: "2026-09-24", findings }) as unknown as UnitInsights;

  it("opens on the reasons when there are some, and on the flag when a figure only looks like an error", () => {
    const withReasons = record(finding("artefact", []), finding("extreme", [{}]));
    const flaggedOnly = record(finding("artefact", []));
    for (const locale of ["en", "fr"] as const) {
      expect(introOf(locale, withReasons)).toBe(places[locale].insightsBody);
      expect(introOf(locale, flaggedOnly)).toBe(places[locale].insightsBodyFlagged);
    }
    expect(places.en.insightsBodyFlagged).not.toBe(places.en.insightsBody);
  });

  it("marks a reason that the figure is an error in the data", () => {
    expect(flagOf("en", { artefact: true })).toBe(places.en.insightsArtefact);
    expect(flagOf("fr", { artefact: true })).toBe(places.fr.insightsArtefact);
    expect(flagOf("en", { artefact: false })).toBeNull();
  });
});

describe("the numbers beside a checked premise", () => {
  const self = { unit: "self" } as const;

  it("writes a comparison's 2 figures in the unit of the field it read", () => {
    const check = {
      check: "compare",
      left: { of: self, field: "housing.occupancy.vacant", year: 2024 },
      op: ">",
      right: { of: { unit: "parent" }, field: "housing.occupancy.vacant", year: 2024 },
    } as const;
    expect(evidenceNumbers("en", check, { left: 12.34, right: 8 })).toBe("12.3% against 8.0%");
    expect(evidenceNumbers("en", { ...check, left: { ...check.left, field: "fertility.totalFertilityRate" }, right: { value: 2 } }, { left: 1.6, right: 2 })).toBe(
      "1.60 against 2.00",
    );
  });

  it("writes a change as its 2 years, and a rank as a place among so many", () => {
    expect(evidenceNumbers("en", { check: "change", of: self, field: "education.higher", op: ">", value: 5 }, { y2014: 4.2, y2024: 11, change: 6.8 })).toBe(
      "4.2% in 2014, 11.0% in 2024",
    );
    expect(
      evidenceNumbers(
        "en",
        { check: "rank", of: self, field: "education.higher", year: 2024, within: "province", position: "top", share: 0.1 },
        { value: 11, rank: 2, of: 40 },
      ),
    ).toBe("11.0%, ranked 2 of 40");
  });

  it("gives nothing when a figure the test read is missing", () => {
    const check = { check: "change", of: self, field: "education.higher", op: ">", value: 5 } as const;
    expect(evidenceNumbers("en", check, { y2024: 11 })).toBeNull();
  });
});

/**
 * The numbers the methods page states, against the code that decides them.
 *
 * Most come straight from insights/src as constants the pages format. The rest are
 * pinned here: each is read from the code, and the page must say it in those words.
 * Once they and the years are taken out, no digit may be left in either page.
 */
describe("the methods page's numbers", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const pages = { en: source("site/src/pages/docs/insights.astro"), fr: source("site/src/pages/fr/docs/insights.astro") };

  /** A page's reader-facing text: its markup, with every expression, code span and tag taken out. */
  const prose = (page: string) => {
    let body = page.split("---")[2]!.replace(/<style>[\s\S]*<\/style>/, "").replace(/<code>[\s\S]*?<\/code>/g, " ");
    while (/\{[^{}<>]*\}/.test(body)) body = body.replace(/\{[^{}<>]*\}/g, " ");
    // Not \s, which would also collapse the narrow no-break space French puts before a %.
    return body.replace(/<[^>]*>/g, " ").replace(/[ \t\r\n]+/g, " ");
  };

  /** The standard normal CDF, from Abramowitz and Stegun's 7.1.26 approximation of erf. */
  const phi = (z: number) => {
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const erf = 1 - poly * Math.exp(-x * x);
    return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
  };

  const [, fewest, most] = /Propose (\d+) to (\d+) hypotheses/.exec(source("insights/src/propose.ts")) ?? [];
  const checks = new Set([...CHECK_GRAMMAR.matchAll(/"check":"(\w+)"/g)].map((m) => m[1])).size;
  const confidence = Math.round((2 * phi(1.96) - 1) * 100);

  it("reads the confidence the intervals are taken at", () => {
    expect(wilson(45, 50)).toEqual(wilson(45, 50, 1.96));
    expect(Math.round(phi(ONE_SIDED_Z) * 100)).toBe(confidence);
    expect(confidence).toBe(95);
  });

  it("says how many hypotheses are asked for, how many checks a data test has, and at what confidence", () => {
    expect(fewest).toBeDefined();
    const en = prose(pages.en);
    const fr = prose(pages.fr);
    expect(en).toContain(`asked for ${fewest} to ${most} hypotheses`);
    expect(fr).toContain(`proposer ${fewest} à ${most} hypothèses`);
    expect(en).toContain(`a vocabulary of ${checks} checks`);
    expect(fr).toContain(`un vocabulaire de ${checks} vérifications`);
    expect(en).toContain(`a ${confidence}% Wilson interval`);
    expect(fr).toContain(`un intervalle de Wilson à ${confidence}\u202f%`);
  });

  it("says half where the code halves", () => {
    expect(source("insights/src/detect.ts")).toContain("const halfMagnitude = Math.abs(change) / 2;");
    expect(pages.en).toContain("at least half as much");
    expect(pages.fr).toContain("d’au moins la moitié");

    const literal = { check: "change", of: { unit: "code", code: "04.421.01.0" }, field: "education.higher", op: ">", value: 30 } as const;
    const moved = mutations(literal, {} as Data, 1).filter((m) => m.kind === "number").map((m) => (m.check as Extract<Check, { check: "change" }>).value);
    expect(moved).toContain(literal.value / 2);
    expect(pages.en).toContain("halved");
    expect(pages.fr).toContain("réduit de moitié");
  });

  it("leaves no other number typed into either page", () => {
    const pinned = {
      en: [`${fewest} to ${most}`, `of ${checks} checks`, `${confidence}%`],
      fr: [`${fewest} à ${most}`, `de ${checks} vérifications`, `${confidence}\u202f%`],
    };
    for (const locale of ["en", "fr"] as const) {
      let text = prose(pages[locale]);
      for (const phrase of pinned[locale]) text = text.split(phrase).join(" ");
      // The census years, and the years of the work cited.
      text = text.replace(/\b(2014|2024|2025)\b/g, " ");
      expect(text.match(/.{0,30}\d.{0,30}/g), locale).toBeNull();
    }
  });
});
