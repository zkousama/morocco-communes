/**
 * Three lines for each commune page, worked out once at build time from the censuses: the
 * starkest difference between the commune and one it borders, the figure that moved most
 * since 2014 against Morocco, and the commune most like it in another région.
 */
import { COMPARABLE_2014 } from "../../../api/src/lib/indicators.ts";
import { mismatches } from "../../../api/src/lib/mismatch.ts";
import { HOUSEHOLD_FIELDS_ALL, PEOPLE_FIELDS_ALL } from "../../../pipeline/src/sources/censusFields.ts";
import { figure, indicatorsOf, national, type Census, type IndicatorRecord } from "./indicators.ts";
import { communeOf, communes, neighbours } from "./places.ts";

/** A commune as the lines read it: its code, its people at each census, and its census figures. */
export interface Unit {
  code: string;
  population: number;
  population2014: number | null;
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

/** The figures the two censuses disagree on for this commune. */
const flaggedIn = (unit: Unit) =>
  new Set(mismatches(unit.record.people.total?.all, unit.record["2014"]?.people.total?.all).map((m) => m.path));

/**
 * A unit's figures, in the order of `measures`. One the two censuses disagree on for this
 * commune reads as missing, since it can't be set against anyone else's either.
 */
function readings(unit: Unit, measures: Measure[]): (number | null)[] {
  const flagged = flaggedIn(unit);
  return measures.map((m) => (flagged.has(m.path) ? null : m.read(unit.record)));
}

export interface Gap {
  code: string;
  path: string;
  here: number;
  there: number;
  gap: number;
}

/** The widest gap between a commune and any of its neighbours on any figure, or null if none reaches GAP. */
export function largestGap(here: Unit, around: Unit[]): Gap | null {
  if (here.population < SMALLEST_NEXT_DOOR) return null;
  const mine = readings(here, NEXT_DOOR);
  let best: Gap | null = null;
  for (const there of around) {
    if (there.population < SMALLEST_NEXT_DOOR) continue;
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

/** How many points past Morocco's own change a commune's has to go before the line shows it. */
export const MOVED = 10;
export const SMALLEST_MOVED = 1000;

export interface Move {
  path: string;
  then: number;
  now: number;
  moroccoThen: number;
  moroccoNow: number;
  /** The commune's change in points less Morocco's, so negative where it fell behind. */
  beyond: number;
}

const readIn = (census: Census | null | undefined, path: string, homes: boolean) =>
  figure(homes ? census?.households.total : census?.people.total?.all, path);

/** The figure whose change since 2014 is furthest from Morocco's, either way, or null if none is MOVED past it. */
export function largestMove(here: Unit, morocco: Unit["record"]): Move | null {
  if (here.population < SMALLEST_MOVED || (here.population2014 ?? 0) < SMALLEST_MOVED) return null;
  const flagged = flaggedIn(here);
  let best: Move | null = null;
  for (const { path, path2014, homes } of SINCE_2014) {
    if (flagged.has(path)) continue;
    const now = readIn(here.record, path, homes);
    const then = readIn(here.record["2014"], path2014, homes);
    const moroccoNow = readIn(morocco, path, homes);
    const moroccoThen = readIn(morocco["2014"], path2014, homes);
    if (now == null || then == null || moroccoNow == null || moroccoThen == null) continue;
    // HCP publishes shares to one decimal; rounding keeps 59.9 − 40 − 10 at 9.9.
    const beyond = Math.round((now - then - (moroccoNow - moroccoThen)) * 10) / 10;
    if (Math.abs(beyond) >= MOVED && (best === null || Math.abs(beyond) > Math.abs(best.beyond))) {
      best = { path, then, now, moroccoThen, moroccoNow, beyond };
    }
  }
  return best;
}

export interface Twin {
  code: string;
  /** The figures where the two are closest, nearest first. */
  closest: { path: string; here: number; there: number }[];
}

const regionOfCode = (code: string) => code.slice(0, 2);

/**
 * Each commune's nearest match in another région, over every figure in TWIN. Each figure is
 * put on one scale first, subtracting the mean and dividing by the standard deviation, so
 * household size weighs as much as a share does.
 */
export function nearestTwins(units: Unit[]): Map<string, Twin> {
  const eligible = units.flatMap((u) => {
    if (u.population < SMALLEST_TWIN) return [];
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
    ? [{ code, population: commune.population["2024"].total, population2014: commune.population["2014"]?.total ?? null, record }]
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
/** The figure that moved furthest from Morocco's change since 2014, or null if none moved far enough. */
export const movedMost = (code: string): Move | null => moves.get(code) ?? null;
/** The commune most like this one in another région, or null for one under 5,000 people or missing a figure. */
export const twinOf = (code: string): Twin | null => twins.get(code) ?? null;
