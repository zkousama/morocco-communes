/**
 * The compare page's rules, shared by the build that writes its data and the browser that
 * draws it: which figures it shows, how a figure's scale runs, and how a comparison is
 * written into its link. Nothing here reads the dataset, so the browser can load it.
 */
import type { Locale } from "../i18n/ui";
import { normalise, skeleton } from "../../../api/src/lib/normalise.ts";
import { density, numbers, percent } from "./format";

export type Unit = "percent" | "people" | "density" | "count";
export type Group = "schooling" | "work" | "homes" | "people";

/** Where a figure is read from: the people, the women, the households, an age band sum, or the commune itself. */
export type Source =
  | { from: "people" | "women" | "homes"; path: string }
  | { from: "ages"; bands: string[] }
  | { from: "population" | "density" };

export interface Figure {
  id: string;
  group: Group;
  unit: Unit;
  source: Source;
}

const share = (id: string, group: Group, from: "people" | "women" | "homes", path: string): Figure => ({
  id,
  group,
  unit: "percent",
  source: { from, path },
});

/** Every figure, in the order the page shows them. */
export const FIGURES: Figure[] = [
  share("illiteracy", "schooling", "people", "illiteracy.rate10Plus"),
  share("illiteracyWomen", "schooling", "women", "illiteracy.rate10Plus"),
  share("french", "schooling", "people", "languagesReadAndWritten.french"),
  share("higher", "schooling", "people", "education.higher"),
  share("school", "schooling", "people", "schooling.rate6to11"),
  share("unemployment", "work", "people", "labour.unemploymentRate"),
  share("active", "work", "people", "labour.activityRate"),
  share("water", "homes", "homes", "amenities.runningWater"),
  share("electricity", "homes", "homes", "amenities.electricity"),
  share("sewer", "homes", "homes", "wastewater.publicSewer"),
  share("toilet", "homes", "homes", "amenities.toilet"),
  share("apartments", "homes", "homes", "dwellingType.apartment"),
  share("owners", "homes", "homes", "occupancy.owner"),
  { id: "size", group: "homes", unit: "people", source: { from: "homes", path: "households.averageSize" } },
  { id: "young", group: "people", unit: "percent", source: { from: "ages", bands: ["0-4", "5-9", "10-14"] } },
  { id: "old", group: "people", unit: "percent", source: { from: "ages", bands: ["65-69", "70-74", "75+"] } },
  { id: "density", group: "people", unit: "density", source: { from: "density" } },
  { id: "population", group: "people", unit: "count", source: { from: "population" } },
];

export const GROUPS: Group[] = ["schooling", "work", "homes", "people"];
export const figureOf = new Map(FIGURES.map((f) => [f.id, f]));

/** A row of the data file: slug, French name, Arabic name, province index, "u" or "r", then a value per figure. */
export type Row = [string, string, string, number, "u" | "r", ...(number | null)[]];
export const VALUES_FROM = 5;

export interface CompareData {
  figures: string[];
  provinces: string[];
  morocco: (number | null)[];
  communes: Row[];
  /**
   * Communes the page doesn't compare, by slug and name, and why: "few" under 300 households,
   * "special" where most people aren't counted in households at all.
   */
  excluded: [string, string, "few" | "special"][];
}

// The link -------------------------------------------------------------------

export type View = "side" | "scatter";
export interface State {
  communes: string[];
  view: View;
  x: string;
  y: string;
}

export const MAX_COMMUNES = 4;
export const DEFAULT_STATE: State = { communes: [], view: "side", x: "density", y: "higher" };

/** The comparison a link holds. Unknown communes and figures fall away rather than break the page. */
export function parseState(search: string, known: Set<string>): State {
  const params = new URLSearchParams(search);
  const communes: string[] = [];
  for (const slug of (params.get("c") ?? "").split(",")) {
    if (slug && known.has(slug) && !communes.includes(slug) && communes.length < MAX_COMMUNES) communes.push(slug);
  }
  const view = params.get("v") === "scatter" ? "scatter" : DEFAULT_STATE.view;
  const pick = (value: string | null, fallback: string) => (value && figureOf.has(value) ? value : fallback);
  const x = pick(params.get("x"), DEFAULT_STATE.x);
  let y = pick(params.get("y"), DEFAULT_STATE.y);
  // A figure against itself is a diagonal line, so the other default takes its place.
  if (y === x) y = x === DEFAULT_STATE.y ? DEFAULT_STATE.x : DEFAULT_STATE.y;
  return { communes, view, x, y };
}

/** The query string for a comparison, with anything at its default left out. Slugs need no escaping. */
export function queryOf(state: State): string {
  const parts: string[] = [];
  if (state.communes.length) parts.push(`c=${state.communes.join(",")}`);
  if (state.view !== DEFAULT_STATE.view) parts.push(`v=${state.view}`);
  if (state.x !== DEFAULT_STATE.x) parts.push(`x=${state.x}`);
  if (state.y !== DEFAULT_STATE.y) parts.push(`y=${state.y}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// Scales ---------------------------------------------------------------------

export interface Axis {
  min: number;
  max: number;
  log: boolean;
}

/** Tops that split into 3 to 6 round steps: 4 → 0, 1, 2, 3, 4; 50 → 0, 10 … 50. */
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const STEPS = [1, 2, 2.5, 5];

/** The smallest round number at or above a value. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const top = NICE.find((n) => n * power >= value - 1e-9)! * power;
  return Math.round(top * 1e6) / 1e6;
}

/** A share runs from 0 to its round top, never past 100; a density or a count on powers of ten. */
export function axisOf(figure: Figure, values: (number | null)[]): Axis {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (figure.unit === "density" || figure.unit === "count") {
    const positive = present.filter((v) => v > 0);
    const low = positive.length ? Math.min(...positive) : 1;
    const high = positive.length ? Math.max(...positive) : 10;
    return { min: 10 ** Math.floor(Math.log10(low)), max: 10 ** Math.ceil(Math.log10(high)), log: true };
  }
  const high = present.length ? Math.max(...present) : 1;
  const max = figure.unit === "percent" ? Math.min(niceMax(high), 100) : niceMax(high);
  return { min: 0, max, log: false };
}

/** Where a value sits along an axis, from 0 at its start to 1 at its end. */
export function positionOf(value: number, axis: Axis): number {
  if (axis.log) {
    if (value <= 0) return 0;
    const at = (Math.log10(value) - Math.log10(axis.min)) / (Math.log10(axis.max) - Math.log10(axis.min));
    return Math.min(1, Math.max(0, at));
  }
  return Math.min(1, Math.max(0, (value - axis.min) / (axis.max - axis.min)));
}

/** Round ticks from the start to the end: 3 to 6 steps, or every power of ten. */
export function ticksOf(axis: Axis): number[] {
  if (axis.log) {
    const ticks: number[] = [];
    for (let p = Math.round(Math.log10(axis.min)); p <= Math.round(Math.log10(axis.max)); p++) ticks.push(Math.round(10 ** p * 1e6) / 1e6);
    return ticks;
  }
  const span = axis.max - axis.min;
  const power = 10 ** Math.floor(Math.log10(span / 6));
  const steps = [...STEPS.map((s) => s * power), ...STEPS.map((s) => s * power * 10)];
  const step = steps.find((s) => span / s <= 6 + 1e-9 && Math.abs(span / s - Math.round(span / s)) < 1e-6) ?? span;
  const ticks: number[] = [];
  for (let v = axis.min; v <= axis.max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** How many values fall in each of `bins` equal steps along the axis. */
export function histogram(values: (number | null)[], axis: Axis, bins: number): number[] {
  const counts = new Array<number>(bins).fill(0);
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    counts[Math.min(bins - 1, Math.floor(positionOf(value, axis) * bins))]!++;
  }
  return counts;
}

/** The share of the other values below this one, 0 to 100. */
export function rankOf(value: number, values: (number | null)[]): number {
  let below = 0;
  let count = 0;
  for (const v of values) {
    if (v === null) continue;
    count++;
    if (v < value) below++;
  }
  return count > 1 ? Math.round((below / (count - 1)) * 100) : 50;
}

/** The point closest to (x, y) within `reach`, or null. */
export function nearest<P extends { x: number; y: number }>(points: P[], x: number, y: number, reach: number): P | null {
  let best: P | null = null;
  let least = reach * reach;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= least) {
      least = d;
      best = p;
    }
  }
  return best;
}

// Writing ---------------------------------------------------------------------

/** A value the way the rest of the site writes it, or a dash for none. */
export function formatValue(locale: Locale, unit: Unit, value: number | null): string {
  if (value === null) return "—";
  if (unit === "percent") return percent(locale, value, { fixed: true });
  if (unit === "people") return numbers(locale, 1, true).format(value);
  if (unit === "density") return density(locale, value);
  return numbers(locale).format(value);
}

/** A tick's label: shares without decimals, and powers of ten written out. */
export function tickLabel(locale: Locale, unit: Unit, value: number): string {
  if (unit === "percent") return percent(locale, value, { digits: 0 });
  return numbers(locale, value < 1 ? 1 : 0).format(value);
}

// Finding a commune -------------------------------------------------------------

/** What the picker matches a query against, worked out once per commune. */
export interface Searchable {
  key: string;
  arKey: string;
  skel: string;
  people: number;
}

export function searchKeys(fr: string, ar: string): Pick<Searchable, "key" | "arKey" | "skel"> {
  const key = normalise(fr);
  return { key, arKey: normalise(ar), skel: skeleton(key) };
}

/**
 * The communes a query names, best first: the whole name, then its start, then the start of
 * a word in it, then the same consonants (Titwan for Tétouan), then anywhere in it. Ties go
 * to the larger commune.
 */
export function matchCommunes<T extends Searchable>(items: T[], query: string, limit = 8): T[] {
  const q = normalise(query);
  if (!q) return [];
  const sk = skeleton(q);
  const scored: [number, T][] = [];
  for (const item of items) {
    const words = (s: string) => s.split(" ").some((w) => w.startsWith(q));
    let score = -1;
    if (item.key === q || item.arKey === q) score = 0;
    else if (item.key.startsWith(q) || item.arKey.startsWith(q)) score = 1;
    else if (words(item.key) || words(item.arKey)) score = 2;
    else if (sk.length >= 2 && item.skel.startsWith(sk)) score = 3;
    else if (q.length >= 3 && (item.key.includes(q) || item.arKey.includes(q))) score = 4;
    if (score >= 0) scored.push([score, item]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1].people - a[1].people);
  return scored.slice(0, limit).map(([, item]) => item);
}

// Marks ---------------------------------------------------------------------------

/**
 * Each commune's mark, centred on 0,0 and about `r` across from the centre: a circle, a
 * square, a diamond and a triangle, so the 4 read apart without their colours. An SVG path,
 * which a canvas takes as it is through Path2D.
 */
export function shapePath(index: number, r: number): string {
  const n = (v: number) => Math.round(v * 100) / 100;
  switch (index % 4) {
    case 0:
      return `M${n(-r)},0a${n(r)},${n(r)} 0 1,0 ${n(2 * r)},0a${n(r)},${n(r)} 0 1,0 ${n(-2 * r)},0z`;
    case 1: {
      const h = r * 0.88;
      return `M${n(-h)},${n(-h)}h${n(2 * h)}v${n(2 * h)}h${n(-2 * h)}z`;
    }
    case 2: {
      const d = r * 1.28;
      return `M0,${n(-d)}L${n(d)},0L0,${n(d)}L${n(-d)},0z`;
    }
    default: {
      const t = r * 1.3;
      return `M0,${n(-t)}L${n(t * 0.98)},${n(t * 0.72)}L${n(-t * 0.98)},${n(t * 0.72)}z`;
    }
  }
}

/**
 * The tick labels that fit along an axis, left to right: a label that would touch the one
 * before it is skipped, and the last one ends at the edge rather than running past it.
 * `charWidth` is a generous width per character at the labels' size.
 */
export function fitLabels<T extends { x: number; text: string }>(
  labels: T[],
  edge: number,
  charWidth: number,
): (T & { anchor: "middle" | "end" })[] {
  const shown: (T & { anchor: "middle" | "end" })[] = [];
  let right = -Infinity;
  labels.forEach((label, k) => {
    const width = label.text.length * charWidth;
    const anchor = k === labels.length - 1 && label.x + width / 2 > edge ? "end" : "middle";
    const left = anchor === "end" ? label.x - width : label.x - width / 2;
    if (left < right + charWidth) return;
    shown.push({ ...label, anchor });
    right = anchor === "end" ? label.x : label.x + width / 2;
  });
  return shown;
}
