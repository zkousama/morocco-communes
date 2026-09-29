/**
 * Communes whose figures don't go together the way they do elsewhere. A pair is kept when
 * its two figures are from different families and correlate by at least 0.5 across communes
 * of 5,000 people or more that the two censuses don't disagree on. A commune is odd for that
 * pair when its residual from the straight line is beyond 2.5 standard deviations. The line
 * says what is usual. It doesn't say why.
 */
import { mismatches } from "../../../api/src/lib/mismatch.ts";
import { fill, places } from "../i18n/places.ts";
import type { Locale } from "../i18n/ui.ts";
import { numbers, percent } from "./format.ts";
import { figure, indicatorsOf } from "./indicators.ts";
import { communes } from "./places.ts";

/** A commune under this many people is left out: a few households can swing a share. */
export const ODD_FLOOR = 5000;
/** Weaker than this, either way, and the pair isn't used. */
export const ODD_MIN_R = 0.5;
/** A residual past this many standard deviations is odd. */
export const ODD_Z = 2.5;
/** How many communes the page lists, at most. */
export const ODD_SHOWN = 30;
/** The page repeats a pair this many times, and a figure this many times, then moves on. */
export const ODD_PER_PAIR = 3;
export const ODD_PER_FIGURE = 5;

/** Education, what a home has, and the people and their work. A pair inside one family is dropped: those figures measure the same thing. */
export const ODD_FAMILIES = {
  education: ["illiteracy.rate10Plus", "languagesReadAndWritten.french", "education.higher", "schooling.rate6to11"],
  infrastructure: ["wastewater.publicSewer", "amenities.runningWater", "amenities.electricity", "dwellingType.apartment"],
  people: ["age.0-14", "age.65+", "households.averageSize", "labour.activityRate", "labour.unemploymentRate"],
} as const;

export type OddFamily = keyof typeof ODD_FAMILIES;

const familyByFigure = new Map<string, OddFamily>(
  (Object.entries(ODD_FAMILIES) as [OddFamily, readonly string[]][]).flatMap(([family, figures]) =>
    figures.map((figure) => [figure, family] as const),
  ),
);

export const familyOf = (figure: string): OddFamily => familyByFigure.get(figure)!;

export const ODD_FIGURES = [
  "illiteracy.rate10Plus",
  "languagesReadAndWritten.french",
  "education.higher",
  "labour.unemploymentRate",
  "labour.activityRate",
  "schooling.rate6to11",
  "amenities.runningWater",
  "amenities.electricity",
  "wastewater.publicSewer",
  "dwellingType.apartment",
  "households.averageSize",
  "age.0-14",
  "age.65+",
] as const;

export type OddFigure = (typeof ODD_FIGURES)[number];

export interface OddUnit {
  code: string;
  population: number;
  flagged: boolean;
  values: Partial<Record<string, number | null>>;
}

export interface OddPoint {
  code: string;
  x: number;
  y: number;
  z: number;
}

export interface PairCloud {
  a: OddFigure;
  b: OddFigure;
  r: number;
  slope: number;
  intercept: number;
  points: OddPoint[];
}

export interface OddRow {
  code: string;
  a: OddFigure;
  b: OddFigure;
  r: number;
  z: number;
  x: number;
  y: number;
  /** The fitted line at this commune, rounded to a whole number. */
  expected: number;
  /** The mean of the first figure, so the sentence can say "that little" or "that much". */
  xMean: number;
}

const read = (values: OddUnit["values"], figure: OddFigure) => {
  const v = values[figure];
  return v === null || v === undefined ? null : v;
};

/**
 * Pearson's r. Null when either column doesn't vary, since a line through a
 * constant isn't a relationship. Dividing by n would cancel, so it isn't here.
 */
export function correlation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n !== ys.length || n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** The least-squares line that predicts the second column from the first. */
export function fitLine(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (correlation(xs, ys) === null) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** The line's value at x. Null when the line isn't defined. */
export function lineAt(xs: number[], ys: number[], x: number): number | null {
  const line = fitLine(xs, ys);
  return line ? line.intercept + line.slope * x : null;
}

/**
 * Each point's residual from the least-squares line, in standard deviations of those
 * residuals. The line predicts the second column from the first. The divisor is n, the
 * root mean square, the same one the twin scale uses.
 */
export function residualZ(xs: number[], ys: number[]): number[] | null {
  const line = fitLine(xs, ys);
  if (!line) return null;
  const residuals = ys.map((y, i) => y - (line.intercept + line.slope * xs[i]!));
  const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / xs.length);
  if (sd === 0) return residuals.map(() => 0);
  return residuals.map((r) => r / sd);
}

const eligible = (unit: OddUnit) => unit.population >= ODD_FLOOR && !unit.flagged;

/** Every pair across families that correlates by at least ODD_MIN_R, earlier figure first. */
export function pairings(units: OddUnit[]): PairCloud[] {
  const pool = units.filter(eligible);
  const clouds: PairCloud[] = [];
  for (let i = 0; i < ODD_FIGURES.length; i++) {
    for (let j = i + 1; j < ODD_FIGURES.length; j++) {
      const a = ODD_FIGURES[i]!;
      const b = ODD_FIGURES[j]!;
      if (familyOf(a) === familyOf(b)) continue;
      const rows = pool.flatMap((unit) => {
        const x = read(unit.values, a);
        const y = read(unit.values, b);
        return x === null || y === null ? [] : [{ code: unit.code, x, y }];
      });
      const xs = rows.map((r) => r.x);
      const ys = rows.map((r) => r.y);
      const r = correlation(xs, ys);
      const line = r === null ? null : fitLine(xs, ys);
      const z = r === null ? null : residualZ(xs, ys);
      if (r === null || line === null || z === null || Math.abs(r) < ODD_MIN_R) continue;
      clouds.push({
        a,
        b,
        r,
        slope: line.slope,
        intercept: line.intercept,
        points: rows.map((row, k) => ({ ...row, z: z[k]! })),
      });
    }
  }
  return clouds;
}

/** Each commune's most extreme pair, furthest from the line first. One under the bar is left out. */
export function oddest(units: OddUnit[]): OddRow[] {
  const best = new Map<string, OddRow>();
  for (const cloud of pairings(units)) {
    const xMean = cloud.points.reduce((s, point) => s + point.x, 0) / cloud.points.length;
    for (const point of cloud.points) {
      if (Math.abs(point.z) <= ODD_Z) continue;
      const row: OddRow = {
        code: point.code,
        a: cloud.a,
        b: cloud.b,
        r: cloud.r,
        z: point.z,
        x: point.x,
        y: point.y,
        expected: Math.round(cloud.intercept + cloud.slope * point.x),
        xMean,
      };
      const prev = best.get(point.code);
      if (!prev || Math.abs(row.z) > Math.abs(prev.z)) best.set(point.code, row);
    }
  }
  return [...best.values()].sort((p, q) => Math.abs(q.z) - Math.abs(p.z) || p.code.localeCompare(q.code));
}

/**
 * The page's rows, in the same order, skipping a row once its pair or either figure has
 * been used enough. A commune is already unique in the list this walks.
 */
export function varied(rows: OddRow[], limit = ODD_SHOWN): OddRow[] {
  const pairs = new Map<string, number>();
  const figures = new Map<string, number>();
  const out: OddRow[] = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    const key = `${row.a}|${row.b}`;
    if ((pairs.get(key) ?? 0) >= ODD_PER_PAIR) continue;
    if ((figures.get(row.a) ?? 0) >= ODD_PER_FIGURE) continue;
    if ((figures.get(row.b) ?? 0) >= ODD_PER_FIGURE) continue;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    figures.set(row.a, (figures.get(row.a) ?? 0) + 1);
    figures.set(row.b, (figures.get(row.b) ?? 0) + 1);
    out.push(row);
  }
  return out;
}

const SHARE = new Set<OddFigure>(ODD_FIGURES.filter((f) => f !== "households.averageSize"));

const amount = (locale: Locale, figure: OddFigure, value: number, whole = false) =>
  SHARE.has(figure)
    ? percent(locale, value, whole ? { digits: 0 } : { fixed: true })
    : numbers(locale, whole ? 0 : 1, !whole).format(value);

const phrase = (bag: Record<string, string>, figure: string) => bag[figure] ?? figure;

/** The commune's two figures, then what communes with a figure near this one usually have. */
export function oddLine(
  locale: Locale,
  row: Pick<OddRow, "a" | "b" | "x" | "y" | "expected" | "xMean">,
  name: string,
): string {
  const p = places[locale];
  const after = p.oddAfter as Record<string, string>;
  const near = (row.x < row.xMean ? p.oddNearLow : p.oddNearHigh) as Record<string, string>;
  const stated = fill(p.oddHas, {
    name,
    av: amount(locale, row.a, row.x),
    a: phrase(after, row.a),
    bv: amount(locale, row.b, row.y),
    b: phrase(after, row.b),
  });
  const usual = fill(p.oddUsual, {
    near: phrase(near, row.a),
    expected: amount(locale, row.b, row.expected, true),
    b: phrase(after, row.b),
  });
  return `${stated} ${usual}`;
}

/** A short heading for this row, from where the two figures sit against the line. */
export function oddHeading(locale: Locale, row: Pick<OddRow, "a" | "b" | "z" | "x" | "xMean">): string {
  const xSide = row.x < row.xMean ? "xlow" : "xhigh";
  const ySide = row.z < 0 ? "ylow" : "yhigh";
  return (places[locale].oddHead as Record<string, string>)[`${row.a}|${row.b}|${xSide}|${ySide}`] ?? "";
}

/** The plain name of a figure, for a scatter axis. */
export function oddAxis(locale: Locale, figure: OddFigure): string {
  return (places[locale].oddAxis as Record<string, string>)[figure] ?? figure;
}

const xml = (text: string) => text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Every commune in the pair as a dot, the one at `highlight` in the accent, and the fitted line. */
export function scatter(
  points: { x: number; y: number }[],
  highlight: number,
  opts: { label?: string; xLabel?: string; yLabel?: string; slope?: number; intercept?: number } = {},
): string {
  const width = 240;
  const height = 168;
  const padL = 28;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const loX = Math.min(...xs);
  const hiX = Math.max(...xs);
  const loY = Math.min(...ys);
  const hiY = Math.max(...ys);
  const sx = (v: number) => {
    const t = hiX === loX ? 0.5 : (v - loX) / (hiX - loX);
    return padL + t * (width - padL - padR);
  };
  const sy = (v: number) => {
    const t = hiY === loY ? 0.5 : (v - loY) / (hiY - loY);
    return height - padB - t * (height - padT - padB);
  };
  const dot = (p: { x: number; y: number }, here: boolean) =>
    `<circle class="${here ? "here" : "dot"}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${here ? 3.4 : 2.2}"/>`;
  const marked = points[highlight];
  const body = points.map((p, i) => (i === highlight ? "" : dot(p, false))).join("") + (marked ? dot(marked, true) : "");
  const line =
    opts.slope === undefined || opts.intercept === undefined
      ? ""
      : `<line class="line" x1="${sx(loX).toFixed(1)}" y1="${sy(opts.intercept + opts.slope * loX).toFixed(1)}" x2="${sx(hiX).toFixed(1)}" y2="${sy(opts.intercept + opts.slope * hiX).toFixed(1)}"/>`;
  const xText = opts.xLabel ? `<text class="axis x" x="${((padL + width - padR) / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle">${xml(opts.xLabel)}</text>` : "";
  const yText = opts.yLabel
    ? `<text class="axis y" x="11" y="${((padT + height - padB) / 2).toFixed(1)}" text-anchor="middle" transform="rotate(-90 11 ${((padT + height - padB) / 2).toFixed(1)})">${xml(opts.yLabel)}</text>`
    : "";
  const named = opts.label ? ` aria-label="${xml(opts.label)}"` : "";
  return `<svg viewBox="0 0 ${width} ${height}" role="img"${named}>${line}${body}${xText}${yText}</svg>`;
}

const ages = (topics: Parameters<typeof figure>[0], bands: string[]): number | null => {
  let total = 0;
  for (const band of bands) {
    const v = figure(topics, `age.${band}`);
    if (v === null) return null;
    total += v;
  }
  return total;
};

const units: OddUnit[] = communes.flatMap((c) => {
  const record = indicatorsOf.get(c.code);
  if (!record) return [];
  const people = record.people.total?.all;
  const homes = record.households.total;
  return [
    {
      code: c.code,
      population: c.population["2024"].total,
      flagged: mismatches(record, record["2014"]).length > 0,
      values: {
        "illiteracy.rate10Plus": figure(people, "illiteracy.rate10Plus"),
        "languagesReadAndWritten.french": figure(people, "languagesReadAndWritten.french"),
        "education.higher": figure(people, "education.higher"),
        "labour.unemploymentRate": figure(people, "labour.unemploymentRate"),
        "labour.activityRate": figure(people, "labour.activityRate"),
        "schooling.rate6to11": figure(people, "schooling.rate6to11"),
        "amenities.runningWater": figure(homes, "amenities.runningWater"),
        "amenities.electricity": figure(homes, "amenities.electricity"),
        "wastewater.publicSewer": figure(homes, "wastewater.publicSewer"),
        "dwellingType.apartment": figure(homes, "dwellingType.apartment"),
        "households.averageSize": figure(homes, "households.averageSize"),
        "age.0-14": ages(people, ["0-4", "5-9", "10-14"]),
        "age.65+": ages(people, ["65-69", "70-74", "75+"]),
      },
    },
  ];
});

const clouds = pairings(units);
const rows = oddest(units);
const byCode = new Map(rows.map((row) => [row.code, row]));
const byPair = new Map(clouds.map((cloud) => [`${cloud.a}|${cloud.b}`, cloud]));

/** Every commune that is odd, furthest from the line first. */
export const oddRows = rows;
/** The pairs the page is built from, each with its correlation. */
export const oddPairs = clouds.map(({ a, b, r, points }) => ({ a, b, r, n: points.length }));
/** Up to 30 communes, spread across pairs and figures so one pairing doesn't fill the page. */
export const oddPage = varied(rows);
/** A commune's odd pair, or null when none of its pairings is that far off. */
export const oddOf = (code: string): OddRow | null => byCode.get(code) ?? null;
/** The communes a pair was fitted on, so a row can draw them. */
export const cloudOf = (a: OddFigure, b: OddFigure): PairCloud => byPair.get(`${a}|${b}`)!;
