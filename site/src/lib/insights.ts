/**
 * The insights the pipeline published, read once at build time for the région, province
 * and commune pages, and the grading numbers the methods page quotes, the ones the
 * published run passed with. Nothing is published on a fresh checkout, so both start
 * empty; only a missing file or directory reads that way, and a file that doesn't parse
 * fails the build, as it does for the API.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARTEFACT_POPULATION_CHANGE_CEILING,
  CHANGE_MIN_LEVEL_SIZE,
  DEFAULT_CAP,
  DEFAULT_PER_UNIT,
  EXTREME_POPULATION_FLOOR,
  EXTREME_TAIL_SHARE,
  GAP_MIN_GROUP_SIZE,
  Z_THRESHOLD,
  type Kind,
} from "../../../insights/src/detect.ts";
import { field, type Level } from "../../../insights/src/fields.ts";
import { PER_SIDE, REGRADE_N } from "../../../insights/src/grade.ts";
import { FALSE_DISCOVERY_RATE, MIN_UNITS, PERMUTATION_ROUNDS, PLACEBO_COUNT } from "../../../insights/src/links.ts";
import { MUTATIONS, NUMBER_SHIFT } from "../../../insights/src/mutate.ts";
import { SAMPLES } from "../../../insights/src/propose.ts";
import { PUBLISHED_CAP, type PublishedHypothesis } from "../../../insights/src/run.ts";
import { PRECISION_FLOOR, type Metrics } from "../../../insights/src/score.ts";
import type { Check } from "../../../insights/src/vocabulary.ts";
import { fill, places } from "../i18n/places";
import type { Locale } from "../i18n/ui";
import { numbers, percent } from "./format";

/** One unit's file under `data/v1/insights/`, as `publishable` in insights/src/run.ts writes it. */
export interface UnitInsights {
  code: string;
  level: Level;
  checkedAt: string;
  findings: {
    id: string;
    kind: Kind;
    measure: string;
    line: { en: string; fr: string };
    breakdown: { field: string; label: { en: string; fr: string }; value: number }[] | null;
    hypotheses: PublishedHypothesis[];
  }[];
}

const LEVELS = ["regions", "provinces", "communes"];

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Every unit file under `dir`, by the unit's code. Empty when nothing has been published. */
export function readUnitInsights(dir: string): Map<string, UnitInsights> {
  const out = new Map<string, UnitInsights>();
  for (const level of LEVELS) {
    let names: string[];
    try {
      names = readdirSync(join(dir, level));
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      const unit = JSON.parse(readFileSync(join(dir, level, name), "utf8")) as UnitInsights;
      out.set(unit.code, unit);
    }
  }
  return out;
}

/** The numbers the published run passed its gate with, from the record a publish writes, or null before the first publish. */
export function readMetrics(path: string): Metrics | null {
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { metrics: Metrics }).metrics;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export const insightsOf = readUnitInsights("data/v1/insights");
export const metrics = readMetrics("insights/published.json");

/**
 * The pipeline's own settings, for the methods page to state rather than retype: shares
 * as fractions, the rest as counts. A number the code only writes inline is pinned to the
 * page by site/tests/insights.test.ts instead.
 */
export const method = {
  extremeFloor: EXTREME_POPULATION_FLOOR,
  extremeTail: EXTREME_TAIL_SHARE,
  deviations: Z_THRESHOLD,
  changeLevelSize: CHANGE_MIN_LEVEL_SIZE,
  gapGroupSize: GAP_MIN_GROUP_SIZE,
  artefactCeiling: ARTEFACT_POPULATION_CHANGE_CEILING,
  kept: DEFAULT_CAP,
  perPlace: DEFAULT_PER_UNIT,
  samples: SAMPLES,
  shuffles: PERMUTATION_ROUNDS,
  placebos: PLACEBO_COUNT,
  fewestPlaces: MIN_UNITS,
  falseDiscoveryRate: FALSE_DISCOVERY_RATE,
  shown: PUBLISHED_CAP,
  perSide: PER_SIDE,
  regraded: REGRADE_N,
  precisionFloor: PRECISION_FLOOR,
  mutations: MUTATIONS,
  numberShift: NUMBER_SHIFT,
};

/** The section's opening line: the one about reasons, or, when every finding is only flagged as a possible error in the data, one that says there are none. */
export function introOf(locale: Locale, record: UnitInsights): string {
  const p = places[locale];
  return record.findings.some((f) => f.hypotheses.length > 0) ? p.insightsBody : p.insightsBodyFlagged;
}

/** The label a reason gets when what it proposes is that the figure is an error in the data, or null for an ordinary one. */
export function flagOf(locale: Locale, hypothesis: { artefact?: boolean }): string | null {
  return hypothesis.artefact ? places[locale].insightsArtefact : null;
}

/** A figure at the precision the census publishes it: shares to one decimal, fertility to 2. */
function figure(locale: Locale, path: string, value: number): string {
  const unit = field(path)?.unit;
  if (unit === "percent") return percent(locale, value, { fixed: true });
  return numbers(locale, unit === "births per woman" ? 2 : 1, true).format(value);
}

/**
 * The figures a premise's data test read, in words: what it compared, the 2 years it
 * spanned, or where the place ranked. Null when one of them is missing, which a published
 * premise never has, since its test passed.
 */
export function evidenceNumbers(locale: Locale, check: Check, read: Record<string, number | undefined>): string | null {
  const p = places[locale];
  const n = numbers(locale);
  const known = (...values: (number | undefined)[]) => values.every((v) => v != null && Number.isFinite(v));
  if (check.check === "compare") {
    if (!known(read.left, read.right)) return null;
    const rightField = "field" in check.right ? check.right.field : check.left.field;
    return fill(p.insightsAgainst, { a: figure(locale, check.left.field, read.left!), b: figure(locale, rightField, read.right!) });
  }
  const f = (v: number) => figure(locale, check.field, v);
  if (check.check === "change") {
    if (!known(read.y2014, read.y2024)) return null;
    return fill(p.insightsChange, { from: f(read.y2014!), to: f(read.y2024!) });
  }
  if (!known(read.value, read.rank, read.of)) return null;
  return fill(p.insightsRank, { value: f(read.value!), rank: n.format(read.rank!), of: n.format(read.of!) });
}
