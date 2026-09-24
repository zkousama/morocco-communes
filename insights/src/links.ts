/**
 * Whether a hypothesis's link holds up across every place of a level: does the proposed
 * premise go with the outcome more closely than unrelated measures do? `together` pairs a
 * level's units on 2 measures and reads their rank correlation; `peers` splits each
 * région at the premise's median and asks whether the top and bottom halves' outcomes
 * differ. Both run the same test again on 3 unrelated measures as placebos, so a link that
 * only echoes how urban a place is doesn't pass for free.
 */
import { z } from "zod";
import { regionOfCode } from "../../pipeline/src/lib/levels.ts";
import type { Data, Unit } from "./data.ts";
import { familyOf, field, FIELDS, type Field, type Level } from "./fields.ts";
import { benjaminiHochberg, mannWhitneyP, permutationP, rng, spearman } from "./stats.ts";

export type LinkTest =
  | { link: "together"; x: string; y: string; year: 2024 | "change"; level: Level; direction: "positive" | "negative" }
  | { link: "peers"; premise: string; outcome: string; level: Level; direction: "higher" | "lower" };

const levelSchema = z.enum(["region", "province", "commune", "arrondissement"]);

export const linkSchema: z.ZodType<LinkTest> = z.discriminatedUnion("link", [
  z.object({
    link: z.literal("together"),
    x: z.string(),
    y: z.string(),
    year: z.union([z.literal(2024), z.literal("change")]),
    level: levelSchema,
    direction: z.enum(["positive", "negative"]),
  }),
  z.object({
    link: z.literal("peers"),
    premise: z.string(),
    outcome: z.string(),
    level: levelSchema,
    direction: z.enum(["higher", "lower"]),
  }),
]);

export interface LinkOutcome {
  p: number;
  effect: number;
  held: boolean; // the effect has the claimed sign
  placeboEffects: number[];
  n: number;
  refused?: string;
}

const MIN_UNITS = 30;
const PERMUTATION_ROUNDS = 999;
const PLACEBO_COUNT = 3;

const refused = (n: number, reason: string): LinkOutcome => ({ p: 1, effect: 0, held: false, placeboEffects: [], n, refused: reason });

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A unit's 2024 value for `path`, or (year `"change"`) its 2024 figure minus its 2014 one; null unless both sides are finite. */
function valueFor(unit: Unit, path: string, year: 2024 | "change"): number | null {
  const v2024 = unit.figures.y2024[path];
  if (v2024 == null || !Number.isFinite(v2024)) return null;
  if (year === 2024) return v2024;
  const v2014 = unit.figures.y2014[path];
  if (v2014 == null || !Number.isFinite(v2014)) return null;
  return v2024 - v2014;
}

/** `x`/`y` pairs for every unit that has both, in the same order. */
function pairedValues(units: Unit[], xPath: string, yPath: string, year: 2024 | "change"): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const unit of units) {
    const xv = valueFor(unit, xPath, year);
    const yv = valueFor(unit, yPath, year);
    if (xv != null && yv != null) {
      x.push(xv);
      y.push(yv);
    }
  }
  return { x, y };
}

/**
 * 3 percent fields, deterministic for a given seed: never the topic of either measure,
 * never a member of either measure's family, and (when `requireComparable`) only fields
 * with a 2014 figure asked the same way.
 */
function pickPlacebos(measureA: string, measureB: string, requireComparable: boolean, seed: number): Field[] {
  const topics = new Set([field(measureA)!.topic, field(measureB)!.topic]);
  const family = new Set([...familyOf(measureA), ...familyOf(measureB)]);
  const candidates = FIELDS.filter(
    (f) => f.unit === "percent" && !topics.has(f.topic) && !family.has(f.path) && (!requireComparable || f.comparable),
  );
  const random = rng(seed);
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const vi = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = vi;
  }
  return shuffled.slice(0, PLACEBO_COUNT);
}

/**
 * Every région's units at or above its own median of `premisePath` (excluding units
 * exactly at the median), and those below it, pooled into 2 arrays of `outcomePath`
 * values. Only units with both figures present count towards the median or the split.
 */
function splitByPeers(units: Unit[], premisePath: string, outcomePath: string): { a: number[]; b: number[] } {
  const byRegion = new Map<string, { premise: number; outcome: number }[]>();
  for (const unit of units) {
    const premise = unit.figures.y2024[premisePath];
    const outcome = unit.figures.y2024[outcomePath];
    if (premise == null || outcome == null || !Number.isFinite(premise) || !Number.isFinite(outcome)) continue;
    const region = regionOfCode(unit.code);
    const group = byRegion.get(region);
    if (group) group.push({ premise, outcome });
    else byRegion.set(region, [{ premise, outcome }]);
  }

  const a: number[] = [];
  const b: number[] = [];
  for (const group of byRegion.values()) {
    const cutoff = median(group.map((g) => g.premise));
    for (const { premise, outcome } of group) {
      if (premise > cutoff) a.push(outcome);
      else if (premise < cutoff) b.push(outcome);
    }
  }
  return { a, b };
}

function runTogether(test: Extract<LinkTest, { link: "together" }>, data: Data, seed: number): LinkOutcome {
  const xField = field(test.x);
  const yField = field(test.y);
  if (!xField || !yField) return refused(0, "unknown field");
  if (test.year === "change" && (!xField.comparable || !yField.comparable)) return refused(0, "not comparable");

  const units = data.byLevel.get(test.level) ?? [];
  const { x, y } = pairedValues(units, test.x, test.y, test.year);
  if (x.length < MIN_UNITS) return refused(x.length, "too few units");

  const rho = spearman(x, y);
  const p = permutationP(x, y, rho, PERMUTATION_ROUNDS, seed);
  const held = test.direction === "positive" ? rho > 0 : rho < 0;

  const placeboEffects = pickPlacebos(test.x, test.y, test.year === "change", seed).map((placebo) => {
    const paired = pairedValues(units, placebo.path, test.y, test.year);
    return spearman(paired.x, paired.y);
  });

  return { p, effect: rho, held, placeboEffects, n: x.length };
}

function runPeers(test: Extract<LinkTest, { link: "peers" }>, data: Data, seed: number): LinkOutcome {
  const premiseField = field(test.premise);
  const outcomeField = field(test.outcome);
  if (!premiseField || !outcomeField) return refused(0, "unknown field");

  const units = data.byLevel.get(test.level) ?? [];
  const { a, b } = splitByPeers(units, test.premise, test.outcome);
  const n = a.length + b.length;
  if (n < MIN_UNITS) return refused(n, "too few units");

  const p = mannWhitneyP(a, b);
  const effect = median(a) - median(b);
  const held = test.direction === "higher" ? effect > 0 : effect < 0;

  const placeboEffects = pickPlacebos(test.premise, test.outcome, false, seed).map((placebo) => {
    const split = splitByPeers(units, placebo.path, test.outcome);
    return median(split.a) - median(split.b);
  });

  return { p, effect, held, placeboEffects, n };
}

/** Runs one link test across every place of its level, against the data a build reads. */
export function runLink(test: LinkTest, data: Data, seed: number): LinkOutcome {
  return test.link === "together" ? runTogether(test, data, seed) : runPeers(test, data, seed);
}

/**
 * `"consistent"` for an outcome that's a Benjamini-Hochberg discovery among the p-values
 * passed in, held in its claimed direction, and beat every one of its own placebos; a
 * refused outcome is left out of the correction and reported back as `"refused"`.
 */
export function judgeLinks(outcomes: LinkOutcome[], q = 0.05): ("consistent" | "not consistent" | "refused")[] {
  const consideredAt: number[] = [];
  const ps: number[] = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.refused) return;
    consideredAt.push(i);
    ps.push(outcome.p);
  });
  const discoveries = benjaminiHochberg(ps, q);
  const isDiscovery = new Map(consideredAt.map((i, k) => [i, discoveries[k]!]));

  return outcomes.map((outcome, i) => {
    if (outcome.refused) return "refused";
    const beatsPlacebos = outcome.placeboEffects.every((placebo) => Math.abs(outcome.effect) > Math.abs(placebo));
    return isDiscovery.get(i) && outcome.held && beatsPlacebos ? "consistent" : "not consistent";
  });
}
