/**
 * Communes whose figures don't go together the way they do elsewhere. A pair is kept when
 * the two figures correlate by at least 0.5 across communes of 5,000 people or more that
 * the two censuses don't disagree on. A commune is odd for that pair when its residual
 * from the straight line is beyond 2.5 standard deviations. The line says what is usual.
 * It doesn't say why.
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
/** How many communes the page lists. */
export const ODD_SHOWN = 30;

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

/**
 * Each point's residual from the least-squares line, in standard deviations of those
 * residuals. The line predicts the second column from the first. The divisor is n, the
 * root mean square, the same one the twin scale uses.
 */
export function residualZ(xs: number[], ys: number[]): number[] | null {
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
  const intercept = my - slope * mx;
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]!));
  const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  if (sd === 0) return residuals.map(() => 0);
  return residuals.map((r) => r / sd);
}

const eligible = (unit: OddUnit) => unit.population >= ODD_FLOOR && !unit.flagged;

/** Every pair that correlates by at least ODD_MIN_R, earlier figure first. */
export function pairings(units: OddUnit[]): PairCloud[] {
  const pool = units.filter(eligible);
  const clouds: PairCloud[] = [];
  for (let i = 0; i < ODD_FIGURES.length; i++) {
    for (let j = i + 1; j < ODD_FIGURES.length; j++) {
      const a = ODD_FIGURES[i]!;
      const b = ODD_FIGURES[j]!;
      const rows = pool.flatMap((unit) => {
        const x = read(unit.values, a);
        const y = read(unit.values, b);
        return x === null || y === null ? [] : [{ code: unit.code, x, y }];
      });
      const xs = rows.map((r) => r.x);
      const ys = rows.map((r) => r.y);
      const r = correlation(xs, ys);
      const z = r === null ? null : residualZ(xs, ys);
      if (r === null || z === null || Math.abs(r) < ODD_MIN_R) continue;
      clouds.push({ a, b, r, points: rows.map((row, k) => ({ ...row, z: z[k]! })) });
    }
  }
  return clouds;
}

/** Each commune's most extreme pair, furthest from the line first. One under the bar is left out. */
export function oddest(units: OddUnit[]): OddRow[] {
  const best = new Map<string, OddRow>();
  for (const cloud of pairings(units)) {
    for (const point of cloud.points) {
      if (Math.abs(point.z) <= ODD_Z) continue;
      const row: OddRow = { code: point.code, a: cloud.a, b: cloud.b, r: cloud.r, z: point.z, x: point.x, y: point.y };
      const prev = best.get(point.code);
      if (!prev || Math.abs(row.z) > Math.abs(prev.z)) best.set(point.code, row);
    }
  }
  return [...best.values()].sort((p, q) => Math.abs(q.z) - Math.abs(p.z) || p.code.localeCompare(q.code));
}

const SHARE = new Set<OddFigure>(ODD_FIGURES.filter((f) => f !== "households.averageSize"));

const amount = (locale: Locale, figure: OddFigure, value: number) =>
  SHARE.has(figure) ? percent(locale, value, { fixed: true }) : numbers(locale, 1, true).format(value);

/** Both figures, then what usually goes with what. The second sentence needs |r| of at least 0.5. */
export function oddLine(locale: Locale, row: Pick<OddRow, "a" | "b" | "r" | "x" | "y">): string {
  const p = places[locale];
  const lead = (p.oddLead as Record<string, string>)[row.a]!;
  const rest = (p.oddRest as Record<string, string>)[row.b]!;
  const stated = fill(p.oddSentence, { a: lead, av: amount(locale, row.a, row.x), b: rest, bv: amount(locale, row.b, row.y) });
  if (Math.abs(row.r) < ODD_MIN_R) return stated;
  const up = (p.oddMore as Record<string, string>)[row.a]!;
  const down = ((row.r < 0 ? p.oddLess : p.oddMore) as Record<string, string>)[row.b]!;
  return `${stated} ${fill(p.oddUsual, { up, down })}`;
}

/** Every commune in the pair as a dot, the one at `highlight` drawn on top. */
export function scatter(points: { x: number; y: number }[], highlight: number, label = ""): string {
  const width = 160;
  const height = 112;
  const pad = 8;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const loX = Math.min(...xs);
  const hiX = Math.max(...xs);
  const loY = Math.min(...ys);
  const hiY = Math.max(...ys);
  const span = (v: number, lo: number, hi: number, size: number) => {
    const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    return pad + t * (size - 2 * pad);
  };
  const dot = (p: { x: number; y: number }, here: boolean) => {
    const cx = span(p.x, loX, hiX, width).toFixed(1);
    const cy = (height - span(p.y, loY, hiY, height)).toFixed(1);
    return `<circle class="${here ? "here" : "dot"}" cx="${cx}" cy="${cy}" r="${here ? 3.2 : 2.2}"/>`;
  };
  const body = points.map((p, i) => (i === highlight ? "" : dot(p, false))).join("") + dot(points[highlight]!, true);
  const named = label ? ` aria-label="${label.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)}"` : "";
  return `<svg viewBox="0 0 ${width} ${height}" role="img"${named}>${body}</svg>`;
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
/** The 30 communes furthest from a usual pairing. */
export const oddPage = rows.slice(0, ODD_SHOWN);
/** A commune's odd pair, or null when none of its pairings is that far off. */
export const oddOf = (code: string): OddRow | null => byCode.get(code) ?? null;
/** The communes a pair was fitted on, so a row can draw them. */
export const cloudOf = (a: OddFigure, b: OddFigure): PairCloud => byPair.get(`${a}|${b}`)!;
