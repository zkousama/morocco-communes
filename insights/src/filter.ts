/**
 * Which of detect's standout figures get published. A possible error in the data is left
 * out, and so is a figure the two censuses disagree on for that commune, since it can't be
 * set against anything else. The shares of men and women are left out too: several
 * southern communes count special populations, and the site doesn't draw attention to
 * them. Only communes are published, since a commune page is where they show.
 */
import type { Data } from "./data.ts";
import type { Finding } from "./detect.ts";

export type Dropped = "artefact" | "not a commune" | "flagged" | "sex share";

/** Why a figure is left out, or null when it's published. */
export function dropped(finding: Finding, data: Data): Dropped | null {
  if (finding.kind === "artefact") return "artefact";
  if (finding.level !== "commune") return "not a commune";
  if (finding.measure.startsWith("sex.")) return "sex share";
  if (data.units.get(finding.code)?.mismatched.has(finding.measure)) return "flagged";
  return null;
}

/** The figures that are published, in the order detect ranked them. */
export function keep(findings: Finding[], data: Data): Finding[] {
  return findings.filter((f) => dropped(f, data) === null);
}
