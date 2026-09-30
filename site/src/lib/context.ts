/**
 * Lines for each commune page, worked out once at build time from the censuses: the
 * starkest difference between the commune and one it borders, the figure it moved most on
 * since 2014, the commune most like it in another région, and the figures that exist in
 * few communes.
 */
import { ordinary } from "../../../api/src/lib/ordinary.ts";
import { COMPARABLE_2014 } from "../../../api/src/lib/indicators.ts";
import { mismatches } from "../../../api/src/lib/mismatch.ts";
import { HOUSEHOLD_FIELDS_ALL, PEOPLE_FIELDS_ALL } from "../../../pipeline/src/sources/censusFields.ts";
import { fill, places } from "../i18n/places.ts";
import type { Locale } from "../i18n/ui.ts";
import { percent } from "./format.ts";
import { figure, indicatorsOf, national, type Census, type IndicatorRecord } from "./indicators.ts";
import { communeOf, communes, neighbours } from "./places.ts";

/** A commune as the lines read it: its code, its people at each census, and its census figures. */
export interface Unit {
  code: string;
  population: number;
  population2014: number | null;
  /** The households the census counted. Left out when a caller has no count to give. */
  households?: number | null;
  record: Census & Pick<IndicatorRecord, "2014">;
}

interface Measure {
  path: string;
  read: (record: Unit["record"]) => number | null;
}

const people = (path: string): Measure => ({ path, read: (r) => figure(r.people.total?.all, path) });
const homes = (path: string): Measure => ({ path, read: (r) => figure(r.households.total, path) });
/** A share of the people across several age bands, or null if HCP leaves any of them out. */
const ages = (path: string, bands: string[]): Measure => ({
  path,
  read: (r) => {
    let total = 0;
    for (const band of bands) {
      const v = figure(r.people.total?.all, `age.${band}`);
      if (v === null) return null;
      total += v;
    }
    return total;
  },
});

// Every one a share from 0 to 100, so a gap between two is in points. No sex or age
// shares: several southern communes count special populations, and the site doesn't
// draw attention to them.
export const NEXT_DOOR: Measure[] = [
  people("illiteracy.rate10Plus"),
  people("languagesReadAndWritten.french"),
  people("education.higher"),
  people("schooling.rate6to11"),
  people("labour.unemploymentRate"),
  homes("amenities.runningWater"),
  homes("amenities.electricity"),
  homes("wastewater.publicSewer"),
];

export const TWIN: Measure[] = [
  people("illiteracy.rate10Plus"),
  people("languagesReadAndWritten.french"),
  people("education.higher"),
  ages("age.0-14", ["0-4", "5-9", "10-14"]),
  ages("age.65+", ["65-69", "70-74", "75+"]),
  people("labour.unemploymentRate"),
  people("labour.activityRate"),
  homes("households.averageSize"),
  homes("amenities.runningWater"),
  homes("dwellingType.apartment"),
  people("localLanguages.darija"),
];

/** How many points apart two shares have to be before next door shows them. */
export const GAP = 30;
/** Fewer people than this and a commune's shares move too much on a few households. */
export const SMALLEST_NEXT_DOOR = 1000;
export const SMALLEST_TWIN = 5000;

/**
 * Whether the site keeps any of this commune's figures out of comparisons. Such a commune is
 * left out of all three lines, on either side: whatever set that figure apart between the
 * censuses may have moved its others too.
 */
const flagged = (unit: Unit) =>
  mismatches(unit.record, unit.record["2014"]).length > 0 ||
  // Or a commune whose people mostly aren't in households, where a share of households is a few families.
  (unit.households !== undefined && !ordinary(unit.population, unit.households));

/** A unit's figures, in the order of `measures`. */
const readings = (unit: Unit, measures: Measure[]) => measures.map((m) => m.read(unit.record));

export interface Gap {
  code: string;
  path: string;
  here: number;
  there: number;
  gap: number;
}

/** The widest gap between a commune and any of its neighbours on any figure, or null if none reaches GAP. */
export function largestGap(here: Unit, around: Unit[]): Gap | null {
  if (here.population < SMALLEST_NEXT_DOOR || flagged(here)) return null;
  const mine = readings(here, NEXT_DOOR);
  let best: Gap | null = null;
  for (const there of around) {
    if (there.population < SMALLEST_NEXT_DOOR || flagged(there)) continue;
    const theirs = readings(there, NEXT_DOOR);
    for (let i = 0; i < NEXT_DOOR.length; i++) {
      const a = mine[i];
      const b = theirs[i];
      if (a == null || b == null) continue;
      // HCP publishes shares to one decimal; rounding the gap keeps 38.7 − 8.7 at 30.
      const gap = Math.round(Math.abs(a - b) * 10) / 10;
      if (gap >= GAP && (best === null || gap > best.gap)) best = { code: there.code, path: NEXT_DOOR[i]!.path, here: a, there: b, gap };
    }
  }
  return best;
}

const pathOf = (f: { topic: string; key: string }) => `${f.topic}.${f.key}`;
const PEOPLE_PATHS = new Set(PEOPLE_FIELDS_ALL.filter((f) => f.sexes.includes("all")).map(pathOf));
const SHARES = new Set([...PEOPLE_FIELDS_ALL, ...HOUSEHOLD_FIELDS_ALL].filter((f) => f.unit === "percent").map(pathOf));

/**
 * Every share the 2014 census asked the way 2024 did, with its path in each census. Not the
 * local languages, which the two censuses recorded differently in places, and no sex shares,
 * since several southern communes count special populations.
 */
export const SINCE_2014 = [...COMPARABLE_2014]
  .filter(([path]) => SHARES.has(path) && !/^(localLanguages|sex)\./.test(path))
  .map(([path, path2014]) => ({ path, path2014, homes: !PEOPLE_PATHS.has(path) }));

/** How many points a commune's figure has to move, either way, before the line shows it. */
export const MOVED = 10;
export const SMALLEST_MOVED = 1000;

export interface Move {
  path: string;
  then: number;
  now: number;
  moroccoThen: number;
  moroccoNow: number;
  /** The commune's change in points, negative for a fall. */
  change: number;
}

const readIn = (census: Census | null | undefined, path: string, homes: boolean) =>
  figure(homes ? census?.households.total : census?.people.total?.all, path);

/**
 * The figure the commune itself moved furthest on since 2014, either way, or null if none
 * moved MOVED points. Morocco's figures ride along for the line to set beside it, so a
 * figure Morocco has none for is skipped.
 */
export function largestMove(here: Unit, morocco: Unit["record"]): Move | null {
  if (here.population < SMALLEST_MOVED || (here.population2014 ?? 0) < SMALLEST_MOVED || flagged(here)) return null;
  let best: Move | null = null;
  for (const { path, path2014, homes } of SINCE_2014) {
    const now = readIn(here.record, path, homes);
    const then = readIn(here.record["2014"], path2014, homes);
    const moroccoNow = readIn(morocco, path, homes);
    const moroccoThen = readIn(morocco["2014"], path2014, homes);
    if (now == null || then == null || moroccoNow == null || moroccoThen == null) continue;
    // HCP publishes shares to one decimal; rounding keeps 49.9 − 40 at 9.9.
    const change = Math.round((now - then) * 10) / 10;
    if (Math.abs(change) >= MOVED && (best === null || Math.abs(change) > Math.abs(best.change))) {
      best = { path, then, now, moroccoThen, moroccoNow, change };
    }
  }
  return best;
}

/** Morocco's change on a share between the censuses, in whole points. */
export function moroccoLine(locale: Locale, then: number, now: number): string {
  const p = places[locale];
  // Rounded to the published decimal first, so 82.9 − 73 is 9.9 before it's 10.
  const change = Math.round(Math.round((now - then) * 10) / 10);
  const points = Math.abs(change) === 1 ? p.movedPoint : fill(p.movedPoints, { n: Math.abs(change) });
  return change === 0 ? p.movedFlat : fill(change > 0 ? p.movedRise : p.movedFall, { points });
}

/** The commune's two figures as HCP publishes them, then Morocco's change beside them in whole points. */
export function moveLine(locale: Locale, move: Move): string {
  const p = places[locale];
  const share = (v: number) => percent(locale, v, { fixed: true });
  const commune = fill(p.movedLine, { what: (p.moved as Record<string, string>)[move.path]!, then: share(move.then), now: share(move.now) });
  return `${commune} ${moroccoLine(locale, move.moroccoThen, move.moroccoNow)}`;
}

export interface Twin {
  code: string;
  /** The figures where the two are closest, nearest first. */
  closest: { path: string; here: number; there: number }[];
}

const regionOfCode = (code: string) => code.slice(0, 2);

/** A twin can't differ from its commune by more than this on a share, in points, or on household size, in people. */
export const TWIN_APART = 30;
export const TWIN_APART_SIZE = 1.5;
const farApart = (path: string, here: number, there: number) =>
  Math.abs(here - there) > (path === "households.averageSize" ? TWIN_APART_SIZE : TWIN_APART);

/**
 * Each commune's nearest match in another région, over every figure in TWIN. Each figure is
 * put on one scale first, subtracting the mean and dividing by the standard deviation, so
 * household size weighs as much as a share does.
 */
export function nearestTwins(units: Unit[]): Map<string, Twin> {
  const eligible = units.flatMap((u) => {
    if (u.population < SMALLEST_TWIN || flagged(u)) return [];
    const values = readings(u, TWIN);
    return values.every((v) => v !== null) ? [{ code: u.code, values: values as number[] }] : [];
  });
  const scales = TWIN.map((_, k) => {
    const column = eligible.map((e) => e.values[k]!);
    const mean = column.reduce((s, v) => s + v, 0) / column.length;
    const sd = Math.sqrt(column.reduce((s, v) => s + (v - mean) ** 2, 0) / column.length);
    return { mean, sd: sd || 1 };
  });
  const scaled = eligible.map((e) => e.values.map((v, k) => (v - scales[k]!.mean) / scales[k]!.sd));

  const twins = new Map<string, Twin>();
  eligible.forEach((a, i) => {
    let nearest = -1;
    let least = Infinity;
    eligible.forEach((b, j) => {
      if (regionOfCode(a.code) === regionOfCode(b.code)) return;
      // A match that's far off on any one figure is no twin, however close it is on the rest.
      if (TWIN.some((m, k) => farApart(m.path, a.values[k]!, b.values[k]!))) return;
      // The squared distance, since the root doesn't change which one is nearest.
      let d = 0;
      for (let k = 0; k < TWIN.length; k++) d += (scaled[i]![k]! - scaled[j]![k]!) ** 2;
      if (d < least) {
        least = d;
        nearest = j;
      }
    });
    if (nearest < 0) return;
    const b = eligible[nearest]!;
    const closest = TWIN.map((m, k) => ({ path: m.path, here: a.values[k]!, there: b.values[k]!, apart: Math.abs(scaled[i]![k]! - scaled[nearest]![k]!) }))
      .sort((x, y) => x.apart - y.apart)
      .slice(0, 3)
      .map(({ path, here, there }) => ({ path, here, there }));
    twins.set(a.code, { code: b.code, closest });
  });
  return twins;
}

const unitOf = (code: string): Unit[] => {
  const commune = communeOf.get(code);
  const record = indicatorsOf.get(code);
  return commune && record
    ? [
        {
          code,
          population: commune.population["2024"].total,
          population2014: commune.population["2014"]?.total ?? null,
          households: commune.population["2024"].households ?? null,
          record,
        },
      ]
    : [];
};

const gaps = new Map(
  communes.flatMap((c) =>
    unitOf(c.code).map((here) => [c.code, largestGap(here, (neighbours.get(c.code) ?? []).flatMap((n) => unitOf(n.code)))] as const),
  ),
);
const moves = new Map(communes.flatMap((c) => unitOf(c.code).map((here) => [c.code, largestMove(here, national)] as const)));
const twins = nearestTwins(communes.flatMap((c) => unitOf(c.code)));

/** The widest gap between a commune and a neighbour, or null if nothing's wide enough. */
export const nextDoor = (code: string): Gap | null => gaps.get(code) ?? null;
/** The figure the commune moved furthest on since 2014, or null if none moved far enough. */
export const movedMost = (code: string): Move | null => moves.get(code) ?? null;
/** The commune most like this one in another région, or null for one under 5,000 people or missing a figure. */
export const twinOf = (code: string): Twin | null => twins.get(code) ?? null;

/** Fewer people than this and a share of a rare way of getting to work isn't worth a line. */
export const RARITY_PEOPLE = 1000;
/** A commute share at least this high, in percent, counts as a place where that way of getting to work exists. */
export const RARITY_SHARE = 1;
/** Foreign residents are rarer, so the bar is lower. */
export const RARITY_FOREIGN = 0.5;
/** More communes than this and the figure isn't rare enough for a line. */
export const RARITY_MAX = 100;
export const RARITY_LINES = 2;

export const RARITY_FIGURES = ["commute.tram", "commute.train", "commute.bus", "commute.taxi", "commute.employerTransport", "foreign"] as const;
export type RarityFigure = (typeof RARITY_FIGURES)[number];

/** A commune as the rarity lines read it: its people, and the shares that exist in few places. */
export interface Rarity {
  code: string;
  population: number;
  shares: Partial<Record<RarityFigure, number | null>>;
  /** The households the census counted. Left out when a caller has no count to give. */
  households?: number | null;
}

export interface OnlyHere {
  measure: RarityFigure;
  n: number;
}

const rarityBar = (measure: RarityFigure) => (measure === "foreign" ? RARITY_FOREIGN : RARITY_SHARE);

/**
 * The figures that exist in few communes: at most two, the rarest first. A commune under
 * 1,000 people, or under the share, gets none, and so does a figure that 100 communes already meet.
 */
export function onlyHereOf(code: string, units: Rarity[]): OnlyHere[] {
  const here = units.find((unit) => unit.code === code);
  if (!here || here.population < RARITY_PEOPLE) return [];
  if (here.households !== undefined && !ordinary(here.population, here.households)) return [];
  const lines: OnlyHere[] = [];
  for (const measure of RARITY_FIGURES) {
    const bar = rarityBar(measure);
    const mine = here.shares[measure];
    if (mine === null || mine === undefined || mine < bar) continue;
    const n = units.filter((unit) => unit.population >= RARITY_PEOPLE && (unit.shares[measure] ?? -1) >= bar).length;
    if (n > RARITY_MAX) continue;
    lines.push({ measure, n });
  }
  return lines.sort((a, b) => a.n - b.n || RARITY_FIGURES.indexOf(a.measure) - RARITY_FIGURES.indexOf(b.measure)).slice(0, RARITY_LINES);
}

/** The sentence for one of those lines. The figure's name sits in the template. */
export function onlyHereLine(locale: Locale, item: OnlyHere): string {
  const p = places[locale];
  if (item.measure === "foreign") return fill(p.onlyForeign, { n: item.n });
  return fill(p.onlyCommute, { n: item.n, how: (p.onlyHow as Record<string, string>)[item.measure]! });
}

function rarities(): Rarity[] {
  return communes.map((commune) => {
    const people = indicatorsOf.get(commune.code)?.people.total?.all;
    const total = commune.population["2024"].total;
    const foreign = commune.population["2024"].foreign;
    return {
      code: commune.code,
      population: total,
      households: commune.population["2024"].households ?? null,
      shares: {
        "commute.tram": figure(people, "commute.tram"),
        "commute.train": figure(people, "commute.train"),
        "commute.bus": figure(people, "commute.bus"),
        "commute.taxi": figure(people, "commute.taxi"),
        "commute.employerTransport": figure(people, "commute.employerTransport"),
        foreign: foreign === null || !total ? null : (foreign / total) * 100,
      },
    };
  });
}

const rarityUnits = rarities();
const rareLines = new Map(rarityUnits.map((unit) => [unit.code, onlyHereOf(unit.code, rarityUnits)]));

/** The rare figures for one commune, rarest first. Empty when none of them are rare here. */
export const onlyHere = (code: string): OnlyHere[] => rareLines.get(code) ?? [];
