/**
 * What sits around a standout figure, worked out from the censuses alone: the commune's
 * other standout figures from the same run, the communes it borders on the same figure,
 * and the same figure in 2014 beside Morocco's. Only numbers come out of here; the words
 * are the site's, in both languages.
 */
import type { Data, Unit } from "./data.ts";
import { CHANGE_GAP_POPULATION_FLOOR, type Finding, type Kind } from "./detect.ts";
import { field } from "./fields.ts";

export interface Neighbours {
  bordering: number; // how many communes it borders
  compared: number; // how many of them the median is taken over
  median: number;
  furthest: { code: string; name: { fr: string; ar: string | null }; value: number };
}

export interface Since2014 {
  then: number;
  now: number;
  morocco: { then: number; now: number };
}

export interface Context {
  others: { id: string; kind: Kind; measure: string }[];
  neighbours: Neighbours | null;
  since2014: Since2014 | null;
}

const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

// HCP publishes shares to one decimal and fertility to 2; rounding to 2 keeps 38.7 − 8.7 at 30.
const round = (v: number): number => Math.round(v * 100) / 100;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * A commune's figure as the finding reads it: the 2024 value, or for a change the points it
 * moved. A crosswalk-matched commune has no change, since its 2014 figure covers other ground.
 */
function reading(unit: Unit, finding: Finding): number | null {
  const now = unit.figures.y2024[finding.measure];
  if (finding.kind !== "change") return known(now) ? now : null;
  const then = unit.figures.y2014[finding.measure];
  return unit.basis !== "crosswalk" && known(now) && known(then) ? round(now - then) : null;
}

/**
 * The communes it borders on the same figure: their median, and the one furthest from this
 * commune's own. A neighbour whose figure the two censuses disagree on is left out, and so is
 * one under `CHANGE_GAP_POPULATION_FLOOR`, where a few households can swing a share on their
 * own. Null when none is left to compare.
 */
export function neighboursOn(finding: Finding, data: Data): Neighbours | null {
  const unit = data.units.get(finding.code);
  if (!unit) return null;
  const here = reading(unit, finding) ?? finding.value;
  const around = unit.neighbours.flatMap((code) => {
    const n = data.units.get(code);
    if (!n || n.population.y2024 < CHANGE_GAP_POPULATION_FLOOR || n.mismatched.has(finding.measure)) return [];
    const value = reading(n, finding);
    return value === null ? [] : [{ n, value }];
  });
  if (around.length === 0) return null;
  const furthest = around.reduce((best, x) => (Math.abs(x.value - here) > Math.abs(best.value - here) ? x : best));
  return {
    bordering: unit.neighbours.length,
    compared: around.length,
    median: round(median(around.map((x) => x.value))),
    furthest: { code: furthest.n.code, name: furthest.n.name, value: furthest.value },
  };
}

/**
 * The same figure at both censuses, the commune's and Morocco's, where 2014 asked it the same
 * way. Null for a figure the two censuses disagree on here, for a crosswalk-matched commune,
 * whose 2014 figure covers other ground, and when either census left it out.
 */
export function since2014(finding: Finding, data: Data): Since2014 | null {
  const unit = data.units.get(finding.code);
  if (!unit || !field(finding.measure)?.comparable || unit.mismatched.has(finding.measure) || unit.basis === "crosswalk") return null;
  const [then, now] = [unit.figures.y2014[finding.measure], unit.figures.y2024[finding.measure]];
  const [moroccoThen, moroccoNow] = [data.country.figures.y2014[finding.measure], data.country.figures.y2024[finding.measure]];
  if (!known(then) || !known(now) || !known(moroccoThen) || !known(moroccoNow)) return null;
  return { then, now, morocco: { then: moroccoThen, now: moroccoNow } };
}

/** Everything around one figure, `kept` being every figure the run publishes, in order. */
export function contextOf(finding: Finding, kept: Finding[], data: Data): Context {
  return {
    others: kept.filter((f) => f.code === finding.code && f.id !== finding.id).map((f) => ({ id: f.id, kind: f.kind, measure: f.measure })),
    neighbours: neighboursOn(finding, data),
    since2014: since2014(finding, data),
  };
}
