import { describe, expect, it } from "vitest";
import { PAGES, t } from "../src/i18n/ui.ts";
import { explore } from "../src/lib/nav.ts";
import { places } from "../src/i18n/places.ts";
import {
  ODD_FIGURES,
  ODD_FLOOR,
  ODD_MIN_R,
  ODD_PER_FIGURE,
  ODD_PER_PAIR,
  ODD_SHOWN,
  ODD_Z,
  cloudOf,
  correlation,
  familyOf,
  lineAt,
  oddHeading,
  oddLine,
  oddOf,
  oddPage,
  oddPairs,
  oddRows,
  oddest,
  pairings,
  residualZ,
  scatter,
  varied,
  type OddFigure,
  type OddRow,
  type OddUnit,
} from "../src/lib/odd.ts";

const values = (code: string, population: number, v: Record<string, number>, flagged = false): OddUnit => ({
  code,
  population,
  flagged,
  values: v,
});

describe("correlation and residuals", () => {
  it("gives Pearson's r, and a residual in standard deviations", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [1, 2, 3, 4, 20];
    expect(correlation(xs, ys)).toBeCloseTo(0.8, 10);
    expect(residualZ(xs, ys)).toEqual([
      expect.closeTo(0.7071067811865476, 8),
      expect.closeTo(0, 8),
      expect.closeTo(-0.7071067811865476, 8),
      expect.closeTo(-1.4142135623730951, 8),
      expect.closeTo(1.4142135623730951, 8),
    ]);
  });

  it("marks a point odd once its residual passes 2.5 standard deviations", () => {
    expect(ODD_Z).toBe(2.5);
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 40];
    const z = residualZ(xs, ys)!;
    expect(z[9]).toBeCloseTo(2.558409, 5);
    expect(z.slice(0, 9).every((v) => Math.abs(v) < ODD_Z)).toBe(true);
  });

  it("gives nothing when a column doesn't vary", () => {
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(residualZ([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(lineAt([1, 1, 1], [1, 2, 3], 1)).toBeNull();
  });

  it("reads the expected value off the fitted line", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [2, 4, 6, 8, 10];
    expect(lineAt(xs, ys, 3)).toBeCloseTo(6);
    expect(Math.round(lineAt(xs, ys, 3.2)!)).toBe(6);
  });
});

describe("which pairs and communes are odd", () => {
  const line = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const bent = [0, 1, 2, 3, 4, 5, 6, 7, 8, 40];
  const weakY = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  const units: OddUnit[] = line.map((x, i) =>
    values(`c${i}`, 5000, {
      "education.higher": x,
      "labour.unemploymentRate": bent[i]!,
      "amenities.runningWater": weakY[i]!,
    }),
  );

  it("uses a pair only when the correlation is at least 0.5 either way", () => {
    expect(ODD_MIN_R).toBe(0.5);
    const pairs = pairings(units);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([["education.higher", "labour.unemploymentRate"]]);
    expect(pairs[0]!.r).toBeGreaterThanOrEqual(ODD_MIN_R);
    expect(correlation(line, weakY.slice(0, line.length))!).toBeLessThan(ODD_MIN_R);
  });

  it("keeps each commune's single most extreme pair, the furthest first", () => {
    const rows = oddest(units);
    expect(rows.map((r) => r.code)).toEqual(["c9"]);
    expect(rows[0]).toMatchObject({ a: "education.higher", b: "labour.unemploymentRate", x: 9, y: 40 });
    expect(rows[0]!.z).toBeGreaterThan(ODD_Z);
  });

  it("drops a pair whose two figures are in one family", () => {
    const same = line.map((x, i) =>
      values(`c${i}`, 5000, {
        "illiteracy.rate10Plus": x,
        "education.higher": x,
        "wastewater.publicSewer": bent[i]!,
      }),
    );
    const pairs = pairings(same).map((p) => `${p.a}|${p.b}`);
    expect(familyOf("illiteracy.rate10Plus")).toBe(familyOf("education.higher"));
    expect(pairs).not.toContain("illiteracy.rate10Plus|education.higher");
    expect(pairs).toContain("illiteracy.rate10Plus|wastewater.publicSewer");
    expect(familyOf("labour.unemploymentRate")).toBe("people");
    expect(familyOf("amenities.runningWater")).toBe("infrastructure");
  });

  it("leaves out a flagged commune and one under 5,000 people", () => {
    expect(ODD_FLOOR).toBe(5000);
    const extra = [
      ...units,
      values("flagged", 8000, { "education.higher": 9, "labour.unemploymentRate": 40 }, true),
      values("small", 999, { "education.higher": 9, "labour.unemploymentRate": 40 }),
      values("mid", 4999, { "education.higher": 9, "labour.unemploymentRate": 40 }),
    ];
    expect(oddest(extra).map((r) => r.code)).toEqual(["c9"]);
    expect(ODD_FIGURES.some((f) => f.startsWith("sex."))).toBe(false);
  });
});

describe("the sentence", () => {
  const row = {
    a: "illiteracy.rate10Plus" as const,
    b: "education.higher" as const,
    x: 3.3,
    y: 47.9,
    expected: 27,
    xMean: 30,
  };

  it("names the commune and the value the line expects", () => {
    expect(oddLine("en", row, "Harhoura")).toBe(
      "Harhoura has 3.3% illiteracy and 47.9% higher education. Communes with that little illiteracy usually have about 27% higher education.",
    );
    expect(oddLine("fr", row, "Harhoura")).toBe(
      "Harhoura a 3,3\u202f% d’analphabétisme et 47,9\u202f% d’enseignement supérieur. Les communes qui ont si peu d’analphabétisme ont d’habitude environ 27\u202f% d’enseignement supérieur.",
    );
    expect(oddLine("en", { ...row, x: 40, xMean: 30 }, "Harhoura")).toContain("that much illiteracy");
  });

  it("writes household size as a count, not a share", () => {
    expect(
      oddLine(
        "en",
        { a: "households.averageSize", b: "education.higher", x: 6.2, y: 4, expected: 4, xMean: 5 },
        "A commune",
      ),
    ).toBe(
      "A commune has 6.2 people per household and 4.0% higher education. Communes with that large a household usually have about 4% higher education.",
    );
  });
});

describe("variety", () => {
  const row = (code: string, a: OddFigure, b: OddFigure, z: number): OddRow => ({
    code,
    a,
    b,
    r: 0.6,
    z,
    x: 1,
    y: 1,
    expected: 1,
    xMean: 2,
  });

  it("keeps at most 3 rows a pair and 5 a figure, and never repeats a commune", () => {
    expect(ODD_PER_PAIR).toBe(3);
    expect(ODD_PER_FIGURE).toBe(5);
    const rows: OddRow[] = [];
    for (let i = 0; i < 8; i++) rows.push(row(`p${i}`, "education.higher", "wastewater.publicSewer", 10 - i));
    for (let i = 0; i < 8; i++) rows.push(row(`q${i}`, "education.higher", "dwellingType.apartment", 4));
    for (let i = 0; i < 8; i++) rows.push(row(`s${i}`, "illiteracy.rate10Plus", "amenities.runningWater", 3));
    const page = varied(rows);
    const pair = (r: OddRow) => `${r.a}|${r.b}`;
    for (const key of new Set(page.map(pair))) {
      expect(page.filter((r) => pair(r) === key).length).toBeLessThanOrEqual(ODD_PER_PAIR);
    }
    const figures = page.flatMap((r) => [r.a, r.b]);
    for (const fig of new Set(figures)) expect(figures.filter((f) => f === fig).length).toBeLessThanOrEqual(ODD_PER_FIGURE);
    expect(new Set(page.map((r) => r.code)).size).toBe(page.length);
    expect(figures.filter((f) => f === "education.higher")).toHaveLength(ODD_PER_FIGURE);
  });
});

describe("the scatter", () => {
  it("draws every commune, the fitted line, and the two axes", () => {
    const svg = scatter(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      1,
      { xLabel: "Illiteracy", yLabel: "Public sewer", slope: 1, intercept: 0 },
    );
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg).toContain('class="here"');
    expect(svg).toContain('class="line"');
    expect(svg).toContain("Illiteracy");
    expect(svg).toContain("Public sewer");
    expect(svg.startsWith("<svg")).toBe(true);
  });
});

describe("what the census gives", () => {
  const pairKey = (row: { a: string; b: string }) => `${row.a}|${row.b}`;

  it("publishes only pairs across families, within the page caps", () => {
    expect(ODD_SHOWN).toBe(30);
    expect(ODD_MIN_R).toBe(0.5);
    expect(oddPairs.length).toBeGreaterThanOrEqual(3);
    expect(oddPairs.every((p) => Math.abs(p.r) >= ODD_MIN_R)).toBe(true);
    expect(oddPairs.every((p) => familyOf(p.a) !== familyOf(p.b))).toBe(true);
    expect(oddPage.length).toBeLessThanOrEqual(ODD_SHOWN);
    expect(new Set(oddPage.map((r) => r.code)).size).toBe(oddPage.length);
    expect(new Set(oddRows.map((r) => r.code)).size).toBe(oddRows.length);
    for (const key of new Set(oddPage.map(pairKey))) {
      expect(oddPage.filter((r) => pairKey(r) === key).length).toBeLessThanOrEqual(ODD_PER_PAIR);
    }
    const figures = oddPage.flatMap((r) => [r.a, r.b]);
    for (const fig of new Set(figures)) expect(figures.filter((f) => f === fig).length).toBeLessThanOrEqual(ODD_PER_FIGURE);
    for (const row of oddPage) {
      expect(Math.abs(row.z)).toBeGreaterThan(ODD_Z);
      const cloud = cloudOf(row.a, row.b);
      const xs = cloud.points.map((p) => p.x);
      const ys = cloud.points.map((p) => p.y);
      expect(row.expected).toBe(Math.round(lineAt(xs, ys, row.x)!));
      expect(oddHeading("en", row).length).toBeGreaterThan(0);
      expect(oddHeading("fr", row).length).toBeGreaterThan(0);
    }
    const order = oddRows.map((r) => r.code);
    let seen = -1;
    for (const row of oddPage) {
      const at = order.indexOf(row.code);
      expect(at).toBeGreaterThan(seen);
      seen = at;
    }
  });

  it("keeps a heading for each way a published pair can sit", () => {
    const en = places.en.oddHead as Record<string, string>;
    const fr = places.fr.oddHead as Record<string, string>;
    for (const pair of oddPairs) {
      for (const xSide of ["xlow", "xhigh"]) {
        for (const ySide of ["ylow", "yhigh"]) {
          const key = `${pair.a}|${pair.b}|${xSide}|${ySide}`;
          expect(en[key], key).toBeTruthy();
          expect(fr[key], key).toBeTruthy();
        }
      }
    }
  });

  it("includes Assa when its figures put it there, and not Touizgui or Fam El Hisn", () => {
    const assa = oddOf("10.071.01.01");
    expect(assa).toMatchObject({ a: "education.higher", b: "dwellingType.apartment", x: 21.3, y: 0.2, expected: 21 });
    expect(assa!.r).toBeCloseTo(0.585, 3);
    expect(assa!.z).toBeCloseTo(-3.244, 3);
    const cloud = cloudOf(assa!.a, assa!.b);
    const xs = cloud.points.map((p) => p.x);
    const ys = cloud.points.map((p) => p.y);
    expect(assa!.expected).toBe(Math.round(lineAt(xs, ys, assa!.x)!));
    expect(scatter(cloud.points, cloud.points.findIndex((point) => point.code === assa!.code)).match(/<circle /g)).toHaveLength(1146);
    expect(oddOf("10.071.03.05")).toBeNull();
    expect(oddOf("09.551.01.03")).toBeNull();
    expect(oddRows).toHaveLength(70);
    expect(oddPage).toHaveLength(10);
    expect(oddPairs.map((p) => `${p.a} ${p.b} ${p.r.toFixed(2)}`)).toEqual([
      "illiteracy.rate10Plus wastewater.publicSewer -0.73",
      "illiteracy.rate10Plus dwellingType.apartment -0.55",
      "languagesReadAndWritten.french wastewater.publicSewer 0.53",
      "education.higher wastewater.publicSewer 0.71",
      "education.higher dwellingType.apartment 0.59",
    ]);
  });
});

describe("the page's place", () => {
  it("sits in the explore menu beside insights, and in the sitemap", () => {
    expect(PAGES).toContain("odd/");
    const en = explore(t("en")).map((section) => section.route);
    const fr = explore(t("fr")).map((section) => section.route);
    expect(en.indexOf("odd/")).toBe(en.indexOf("insights/") + 1);
    expect(fr.indexOf("odd/")).toBe(fr.indexOf("insights/") + 1);
    expect(t("en").navOdd).toBe("Odd combinations");
    expect(t("fr").navOdd).toBe("Combinaisons inattendues");
  });
});
