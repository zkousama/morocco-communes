/**
 * Turns a graded set into the numbers the gate is judged by: the owner's blind yes/no
 * answers become published precision with a Wilson interval, a re-grade's agreement with
 * the first pass becomes a kappa, and every published hypothesis graded yes gets corrupted
 * by `mutate.mutations` and re-checked with `evaluate` to see how often the checks still
 * catch a wrong claim. `guard` is the one gate everything else here feeds: no publish
 * without a graded set, without at least 80% precision at its interval's low end, or with
 * planted errors caught less often than the last published run. `pnpm insights:score`
 * reads `insights/graded.json` and writes `insights/metrics.json`; the site's methods page
 * reads that file, and `run.ts --publish` reads it back to decide whether to publish at all.
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Data } from "./data.ts";
import { loadData } from "./data.ts";
import type { Graded } from "./grade.ts";
import { GRADED_PATH, loadGradedFile } from "./grade.ts";
import { hash } from "./model.ts";
import { mutations } from "./mutate.ts";
import { cohenKappa, wilson } from "./stats.ts";
import { evaluate } from "./vocabulary.ts";

export interface Metrics {
  measuredAt: string;
  published: { yes: number; graded: number; low: number; high: number; lowOneSided: number };
  rejectedButSound: { count: number; byStage: Record<string, number> };
  agreement: { kappa: number; n: number } | null;
  planted: { total: number; caught: number; byKind: Record<string, { total: number; caught: number }> };
}

/** The one-sided lower bound `guard` judges precision by: the same Wilson interval, z for 95% one-sided. */
const ONE_SIDED_Z = 1.645;
const PRECISION_FLOOR = 0.8;

/** A fraction as a whole percent, for a reason a person reads in the terminal. */
const pct = (fraction: number): number => Math.round(fraction * 100);

/** Cohen's kappa over the regraded items' first and second answers, skipping any "skip". Null with nothing to compare. */
function computeAgreement(graded: Graded[], regrades: { id: string; answer: string }[]): Metrics["agreement"] {
  const firstById = new Map(graded.map((g) => [g.id, g.answer] as const));
  const first: string[] = [];
  const second: string[] = [];
  for (const r of regrades) {
    const initial = firstById.get(r.id);
    if (!initial || initial === "skip" || r.answer === "skip") continue;
    first.push(initial);
    second.push(r.answer);
  }
  if (first.length === 0) return null;
  return { kappa: cohenKappa(first, second), n: first.length };
}

/**
 * `published` reads only the published side, yes and no (never a skip); `rejectedButSound`
 * reads only the rejected side's yes answers, tallied by the stage that stopped each one -
 * the sound hypotheses the gate threw away. `planted` is handed over as given: `plantErrors`
 * is what builds it, kept apart since it needs `Data` and this doesn't.
 */
export function computeMetrics(graded: Graded[], regrades: { id: string; answer: string }[], planted: Metrics["planted"]): Metrics {
  const published = graded.filter((g) => g.gate === "published" && g.answer !== "skip");
  const yes = published.filter((g) => g.answer === "yes").length;
  const gradedCount = published.length;
  const { low, high } = wilson(yes, gradedCount);
  const lowOneSided = wilson(yes, gradedCount, ONE_SIDED_Z).low;

  const rejectedYes = graded.filter((g) => g.gate === "rejected" && g.answer === "yes");
  const byStage: Record<string, number> = {};
  for (const g of rejectedYes) byStage[g.item.hypothesis.stage] = (byStage[g.item.hypothesis.stage] ?? 0) + 1;

  return {
    measuredAt: new Date().toISOString(),
    published: { yes, graded: gradedCount, low, high, lowOneSided },
    rejectedButSound: { count: rejectedYes.length, byStage },
    agreement: computeAgreement(graded, regrades),
    planted,
  };
}

/** A stable seed per graded item, so the same graded.json always plants the same errors. */
const plantSeed = (id: string): number => parseInt(hash(id).slice(0, 8), 16);

/**
 * Every published hypothesis the owner graded yes, corrupted every way `mutations` finds
 * for its check and re-checked with `evaluate` against its own finding: a mutant is caught
 * when the check no longer reports it passed (a refusal counts as caught too).
 */
export function plantErrors(graded: Graded[], data: Data): Metrics["planted"] {
  const byKind: Record<string, { total: number; caught: number }> = {};
  let total = 0;
  let caught = 0;

  const sound = graded.filter((g) => g.gate === "published" && g.answer === "yes");
  for (const g of sound) {
    const check = g.item.hypothesis.evidence.check;
    for (const mutant of mutations(check, data, plantSeed(g.id))) {
      const outcome = evaluate(mutant.check, g.item.finding, data);
      const isCaught = outcome.status !== "passed";
      total++;
      if (isCaught) caught++;
      const bucket = byKind[mutant.kind] ?? { total: 0, caught: 0 };
      bucket.total++;
      if (isCaught) bucket.caught++;
      byKind[mutant.kind] = bucket;
    }
  }

  return { total, caught, byKind };
}

/**
 * Refuses without a graded set, when the published precision's one-sided lower bound falls
 * under 80%, when no planted errors were measured at all, or when a baseline exists (and
 * itself has planted errors measured) and the current run catches them less often than it
 * did. Works out the lower bound itself from `published.yes`/`published.graded` rather than
 * trusting a stored `lowOneSided`, so a stale or hand-edited metrics file can't talk its way
 * past the gate. `planted.total` is never trusted as a divisor either: a run (current or
 * baseline) with nothing planted can't feed a catch-rate comparison, only a 0/0.
 */
export function guard(current: Metrics, baseline: Metrics | null): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { yes, graded } = current.published;

  if (graded === 0) {
    reasons.push("no graded set yet: run pnpm insights:grade");
  } else {
    const lowOneSided = wilson(yes, graded, ONE_SIDED_Z).low;
    if (lowOneSided < PRECISION_FLOOR) {
      reasons.push(`the precision's lower bound is ${pct(lowOneSided)}%, under 80%`);
    }
  }

  if (current.planted.total === 0) {
    reasons.push("no planted errors were measured: grade some published hypotheses yes first");
  } else if (baseline && baseline.planted.total > 0) {
    const currentRate = current.planted.caught / current.planted.total;
    const baselineRate = baseline.planted.caught / baseline.planted.total;
    if (currentRate < baselineRate) {
      reasons.push(`planted errors are caught less often than before: ${pct(currentRate)}% now, ${pct(baselineRate)}% before`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export const METRICS_PATH = "insights/metrics.json";

async function main(): Promise<void> {
  const graded = await loadGradedFile(GRADED_PATH);
  if (!graded.ok) {
    console.log(graded.message);
    process.exitCode = 1;
    return;
  }
  if (graded.value.grades.length === 0) {
    console.log("no graded set yet: run pnpm insights:grade");
    process.exitCode = 1;
    return;
  }

  const data = loadData();
  const planted = plantErrors(graded.value.grades, data);
  const metrics = computeMetrics(graded.value.grades, graded.value.regrades, planted);
  await writeFile(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`);

  console.log(`published: ${metrics.published.yes}/${metrics.published.graded} (low ${pct(metrics.published.lowOneSided)}%)`);
  console.log(`rejected but sound: ${metrics.rejectedButSound.count}`);
  if (metrics.agreement) console.log(`agreement: kappa ${metrics.agreement.kappa.toFixed(2)} over ${metrics.agreement.n}`);
  console.log(`planted errors caught: ${metrics.planted.caught}/${metrics.planted.total}`);
}

// Runs the CLI when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
