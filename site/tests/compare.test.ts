import { describe, expect, it } from "vitest";
import {
  axisOf,
  DEFAULT_STATE,
  FIGURES,
  fitLabels,
  formatValue,
  histogram,
  MAX_COMMUNES,
  nearest,
  niceMax,
  parseState,
  positionOf,
  queryOf,
  matchCommunes,
  searchKeys,
  shapePath,
  standing,
  ticksOf,
} from "../src/lib/compare.ts";
import { compareData } from "../src/lib/compareData.ts";
import { indicatorsOf } from "../src/lib/indicators.ts";
import { communes } from "../src/lib/places.ts";

describe("the link a comparison lives in", () => {
  const known = new Set(["agadir", "kenitra", "rabat", "tiznit", "tanger"]);

  it("reads the communes, the view and the two figures", () => {
    const state = parseState("?c=agadir,kenitra&v=scatter&x=water&y=higher", known);
    expect(state).toEqual({ communes: ["agadir", "kenitra"], view: "scatter", x: "water", y: "higher" });
  });

  it("drops a commune it doesn't know, a repeat, and any past the fourth", () => {
    const state = parseState("?c=agadir,nowhere,agadir,kenitra,rabat,tiznit,tanger", known);
    expect(state.communes).toEqual(["agadir", "kenitra", "rabat", "tiznit"]);
    expect(MAX_COMMUNES).toBe(4);
  });

  it("falls back to the defaults for a view or a figure it doesn't know", () => {
    const state = parseState("?v=pie&x=nothing&y=higher", known);
    expect(state.view).toBe(DEFAULT_STATE.view);
    expect(state.x).toBe(DEFAULT_STATE.x);
    expect(state.y).toBe("higher");
  });

  it("writes back what it reads, and leaves the defaults out", () => {
    const state = { communes: ["agadir", "kenitra"], view: "scatter" as const, x: "water", y: "higher" };
    expect(parseState(queryOf(state), known)).toEqual(state);
    expect(queryOf({ ...DEFAULT_STATE, communes: ["agadir"] })).toBe("?c=agadir");
    expect(queryOf(DEFAULT_STATE)).toBe("");
  });

  it("never plots a figure against itself", () => {
    const state = parseState("?x=water&y=water", known);
    expect(state.x).toBe("water");
    expect(state.y).not.toBe("water");
  });
});

describe("a figure's scale", () => {
  it("rounds a share's top up to a number a reader can hold, never past 100", () => {
    expect(niceMax(47.9)).toBe(50);
    expect(niceMax(98.8)).toBe(100);
    expect(niceMax(8.3)).toBe(10);
    expect(niceMax(3.2)).toBe(4);
    expect(Math.min(niceMax(100), 100)).toBe(100);
  });

  it("runs a share from 0 to its top, and a count on powers of ten", () => {
    expect(axisOf(FIGURES.find((f) => f.id === "higher")!, [1, 20, 47.9])).toEqual({ min: 0, max: 50, log: false });
    expect(axisOf(FIGURES.find((f) => f.id === "density")!, [0.3, 12, 8536])).toEqual({ min: 0.1, max: 10000, log: true });
  });

  it("places a value along it, the log scale by its powers of ten", () => {
    expect(positionOf(25, { min: 0, max: 50, log: false })).toBe(0.5);
    expect(positionOf(100, { min: 1, max: 10000, log: true })).toBe(0.5);
    expect(positionOf(0, { min: 1, max: 10000, log: true })).toBe(0);
  });

  it("marks round ticks, and powers of ten on a log scale", () => {
    expect(ticksOf({ min: 0, max: 50, log: false })).toEqual([0, 10, 20, 30, 40, 50]);
    expect(ticksOf({ min: 0, max: 100, log: false })).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticksOf({ min: 1, max: 10000, log: true })).toEqual([1, 10, 100, 1000, 10000]);
  });

  it("counts every value into one bin", () => {
    const bins = histogram([0, 1, 49, 50, 25, 25], { min: 0, max: 50, log: false }, 10);
    expect(bins).toHaveLength(10);
    expect(bins.reduce((s, n) => s + n, 0)).toBe(6);
    expect(bins[0]).toBe(2);
    expect(bins[9]).toBe(2);
  });
});

describe("a value as it's written", () => {
  it("writes a share, a household size, a density and a count the site's way", () => {
    expect(formatValue("en", "percent", 13)).toBe("13.0%");
    expect(formatValue("fr", "percent", 13)).toBe("13,0\u202f%");
    expect(formatValue("en", "people", 4.46)).toBe("4.5");
    expect(formatValue("en", "density", 8536.51)).toBe("8,537");
    expect(formatValue("en", "density", 12.34)).toBe("12.3");
    expect(formatValue("en", "count", 1275428)).toBe("1,275,428");
    expect(formatValue("en", "percent", null)).toBe("—");
  });
});

describe("the point nearest the pointer", () => {
  it("is the closest one within reach, or none", () => {
    const points = [
      { x: 10, y: 10, i: 0 },
      { x: 50, y: 50, i: 1 },
    ];
    expect(nearest(points, 12, 11, 8)?.i).toBe(0);
    expect(nearest(points, 30, 30, 8)).toBeNull();
  });
});

describe("the data the page loads", () => {
  const data = compareData();
  const row = (slug: string) => data.communes.find((c) => c[0] === slug);
  const at = (id: string) => 5 + data.figures.indexOf(id);

  it("has every figure, in the order the page shows them", () => {
    expect(data.figures).toEqual(FIGURES.map((f) => f.id));
    expect(data.morocco).toHaveLength(FIGURES.length);
  });

  it("gives Agadir the figures its own page shows", () => {
    const agadir = communes.find((c) => c.slug === "agadir")!;
    const record = indicatorsOf.get(agadir.code)!;
    const r = row("agadir")!;
    expect(r[1]).toBe("Agadir");
    expect(r[4]).toBe("u");
    expect(r[at("illiteracy")]).toBe(record.people.total!.all!.illiteracy!.rate10Plus);
    expect(r[at("water")]).toBe(record.households.total!.amenities!.runningWater);
    expect(r[at("population")]).toBe(agadir.population["2024"].total);
  });

  it("leaves out a commune whose people mostly aren't in households, and says so", () => {
    expect(row("tifariti")).toBeUndefined();
    expect(data.excluded.find(([slug]) => slug === "tifariti")?.[2]).toBe("special");
    expect(data.excluded.some(([, , why]) => why === "few")).toBe(true);
  });

  it("blanks a figure the two censuses disagree on, and keeps the commune's others", () => {
    const lounasda = communes.find((c) => c.name.fr === "Lounasda")!;
    const r = row(lounasda.slug)!;
    expect(r[at("water")]).toBeNull();
    expect(r[at("illiteracy")]).not.toBeNull();
  });

  it("stays small enough to load on a phone", () => {
    expect(JSON.stringify(data).length).toBeLessThan(260_000);
  });
});

describe("finding a commune to add", () => {
  const items = [
    { slug: "tetouan", ...searchKeys("Tétouan", "تطوان"), people: 400000 },
    { slug: "tetouan-small", ...searchKeys("Ain Tetouan", "عين تطوان"), people: 5000 },
    { slug: "tiznit", ...searchKeys("Tiznit", "تيزنيت"), people: 80000 },
    { slug: "sidi-bou-othmane", ...searchKeys("Sidi Bou Othmane", "سيدي بو عثمان"), people: 20000 },
  ];
  const slugs = (q: string) => matchCommunes(items, q).map((i) => i.slug);

  it("puts the name's start before a word's start, whatever the accents", () => {
    expect(slugs("tetouan")).toEqual(["tetouan", "tetouan-small"]);
    expect(slugs("TÉT")).toEqual(["tetouan", "tetouan-small"]);
  });

  it("finds a name spelt another way, by its consonants", () => {
    expect(slugs("Titwan")).toContain("tetouan");
  });

  it("finds a name in Arabic, and a word inside a name", () => {
    expect(slugs("تيزنيت")).toEqual(["tiznit"]);
    expect(slugs("othm")).toEqual(["sidi-bou-othmane"]);
  });

  it("finds nothing for an empty query", () => {
    expect(slugs("  ")).toEqual([]);
  });
});

describe("the 4 marks", () => {
  it("are 4 different closed shapes", () => {
    const paths = [0, 1, 2, 3].map((i) => shapePath(i, 5));
    expect(new Set(paths).size).toBe(4);
    for (const d of paths) expect(d.endsWith("z")).toBe(true);
    expect(shapePath(4, 5)).toBe(paths[0]);
  });
});

describe("tick labels along a narrow axis", () => {
  it("skips a label that would touch the one before it, and ends the last at the edge", () => {
    const labels = ["0.1", "1", "10", "100", "1,000", "10,000", "100,000"].map((text, i) => ({ text, x: 10 + i * 52 }));
    const shown = fitLabels(labels, 330, 6.5).map((l) => l.text);
    expect(shown).toEqual(["0.1", "1", "10", "100", "1,000", "10,000"]);
  });

  it("keeps every label when there's room", () => {
    const labels = ["0%", "10%", "20%"].map((text, i) => ({ text, x: 20 + i * 120 }));
    const shown = fitLabels(labels, 400, 6.5);
    expect(shown.map((l) => l.anchor)).toEqual(["middle", "middle", "middle"]);
  });
});

describe("where a value stands", () => {
  it("counts the others below it and above it, leaving itself out", () => {
    expect(standing(3, [1, 2, 3, 4, 5])).toEqual({ below: 50, above: 50 });
    expect(standing(1, [1, 2, 3, 4, 5, null])).toEqual({ below: 0, above: 100 });
    expect(standing(5, [1, 2, 3, 4, 5])).toEqual({ below: 100, above: 0 });
  });
});
