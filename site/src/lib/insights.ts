/**
 * The insights the pipeline published, read once at build time for the région, province
 * and commune pages, and the grading numbers the methods page quotes. Nothing is published
 * on a fresh checkout, so both start empty; only a missing file or directory reads that
 * way, and a file that doesn't parse fails the build, as it does for the API.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Kind } from "../../../insights/src/detect.ts";
import { field, type Level } from "../../../insights/src/fields.ts";
import type { Hypothesis } from "../../../insights/src/run.ts";
import type { Metrics } from "../../../insights/src/score.ts";
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
    hypotheses: Hypothesis[];
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

/** The last grading's numbers, or null before the first one. */
export function readMetrics(path: string): Metrics | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Metrics;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export const insightsOf = readUnitInsights("data/v1/insights");
export const metrics = readMetrics("insights/metrics.json");

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
