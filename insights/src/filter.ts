/**
 * Which of detect's standout figures get published. A possible error in the data is left
 * out, and so is a commune with any figure the two censuses disagree on, since whatever set
 * that figure apart may have moved its others too. The shares of men and women are left out
 * too: several southern communes count special populations, and the site doesn't draw
 * attention to them. An economy or housing figure on a handful of businesses or dwellings
 * is left out too, since a few units can swing a share. Only communes are published, since
 * a commune page is where they show.
 */
import type { Data } from "./data.ts";
import type { Finding } from "./detect.ts";

export type Dropped = "artefact" | "not a commune" | "flagged" | "sex share" | "small base";

/** Fewer businesses or urban dwellings than this, and an economy or housing share can swing on a handful of units. */
export const SMALL_BASE = 100;

/** At this many households or more, the long questionnaire went to a sample, so a census figure is an estimate. */
export const SAMPLE_HOUSEHOLDS = 2000;

const censusFigure = (measure: string) => !measure.startsWith("economy.") && !measure.startsWith("housing.");

/** Why a figure is left out, or null when it's published. */
export function dropped(finding: Finding, data: Data): Dropped | null {
  if (finding.kind === "artefact") return "artefact";
  if (finding.level !== "commune") return "not a commune";
  if (finding.measure.startsWith("sex.")) return "sex share";
  if ((data.units.get(finding.code)?.mismatched.size ?? 0) > 0) return "flagged";
  const base = data.units.get(finding.code)?.base;
  if (finding.measure.startsWith("economy.") && (base?.businesses ?? 0) < SMALL_BASE) return "small base";
  if (finding.measure.startsWith("housing.") && (base?.dwellings ?? 0) < SMALL_BASE) return "small base";
  return null;
}

/**
 * Whether a published census figure comes from the long questionnaire's sample. Economy and
 * housing figures are full counts, and a commune under the household line was asked in full.
 */
export function isSampled(finding: Finding, data: Data): boolean {
  if (!censusFigure(finding.measure)) return false;
  const households = data.units.get(finding.code)?.base.households;
  return households !== null && households !== undefined && households >= SAMPLE_HOUSEHOLDS;
}

/** The figures that are published, in the order detect ranked them. */
export function keep(findings: Finding[], data: Data): Finding[] {
  return findings.filter((f) => dropped(f, data) === null);
}
