import { describe, expect, it } from "vitest";
import { PAGES, t } from "../src/i18n/ui.ts";
import { explore } from "../src/lib/nav.ts";
import {
  ODD_FIGURES,
  ODD_FLOOR,
  ODD_MIN_R,
  ODD_SHOWN,
  ODD_Z,
  cloudOf,
  correlation,
  oddLine,
  oddOf,
  oddPage,
  oddPairs,
  oddRows,
  oddest,
  pairings,
  residualZ,
  scatter,
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
    code: "a",
    a: "education.higher" as const,
    b: "labour.unemploymentRate" as const,
    r: -0.8,
    z: 3,
    x: 21.3,
    y: 51.6,
  };

  it("names both figures and what is usual, and only says that when the pair is strong", () => {
    expect(oddLine("en", row)).toBe(
      "Higher education is 21.3% and unemployment is 51.6%. In most communes, more graduates goes with less unemployment.",
    );
    expect(oddLine("fr", row)).toBe(
      "L’enseignement supérieur est de 21,3\u202f% et le chômage est de 51,6\u202f%. Dans la plupart des communes, plus de diplômés va avec moins de chômage.",
    );
    expect(oddLine("en", { ...row, r: 0.4 })).toBe("Higher education is 21.3% and unemployment is 51.6%.");
    expect(oddLine("en", { ...row, r: 0.8 })).toBe(
      "Higher education is 21.3% and unemployment is 51.6%. In most communes, more graduates goes with more unemployment.",
    );
  });

  it("writes household size as a count, not a share", () => {
    expect(
      oddLine("en", { a: "households.averageSize", b: "education.higher", r: 0.6, x: 6.2, y: 4 }),
    ).toMatch(/^Household size is 6\.2 and higher education is 4\.0%/);
  });
});

describe("the scatter", () => {
  it("draws every commune, and marks the one this row is about", () => {
    const svg = scatter(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      1,
    );
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg).toContain('class="here"');
    expect(svg.startsWith("<svg")).toBe(true);
  });
});

describe("what the census gives", () => {
  it("publishes the pairs whose correlation reaches 0.5, and the 30 furthest communes", () => {
    expect(ODD_SHOWN).toBe(30);
    expect(oddPairs.every((p) => Math.abs(p.r) >= ODD_MIN_R)).toBe(true);
    expect(oddPage).toHaveLength(ODD_SHOWN);
    expect(oddPage.map((r) => Math.abs(r.z))).toEqual([...oddPage.map((r) => Math.abs(r.z))].sort((a, b) => b - a));
    for (const row of oddPage) expect(Math.abs(row.z)).toBeGreaterThan(ODD_Z);
  });

  it("includes Assa when its figures put it there, and not Touizgui or Fam El Hisn", () => {
    const assa = oddOf("10.071.01.01");
    expect(assa).toMatchObject({ a: "illiteracy.rate10Plus", b: "education.higher", x: 23.8, y: 21.3 });
    expect(assa!.r).toBeCloseTo(-0.774, 3);
    expect(assa!.z).toBeCloseTo(4.834, 2);
    expect(oddOf("10.071.03.05")).toBeNull();
    expect(oddOf("09.551.01.03")).toBeNull();
    expect(oddRows).toHaveLength(118);
    expect(oddPairs.map((p) => `${p.a} ${p.b} ${p.r.toFixed(2)}`)).toEqual([
      "illiteracy.rate10Plus education.higher -0.77",
      "illiteracy.rate10Plus wastewater.publicSewer -0.73",
      "illiteracy.rate10Plus dwellingType.apartment -0.55",
      "languagesReadAndWritten.french education.higher 0.57",
      "languagesReadAndWritten.french wastewater.publicSewer 0.53",
      "education.higher wastewater.publicSewer 0.71",
      "education.higher dwellingType.apartment 0.59",
      "labour.activityRate age.65+ -0.52",
      "wastewater.publicSewer dwellingType.apartment 0.53",
      "households.averageSize age.0-14 0.72",
      "age.0-14 age.65+ -0.57",
    ]);
    const cloud = cloudOf(assa!.a, assa!.b);
    const svg = scatter(cloud.points, cloud.points.findIndex((point) => point.code === assa!.code));
    expect(svg.match(/<circle /g)).toHaveLength(1146);
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
