/**
 * The pilot's fixed setups: which model plays proposer or adversary, at what effort, so a
 * small measured comparison can be run and rated before the full pipeline commits to one.
 * These are constants, not configuration: the pilot's whole point is that the setups and
 * the rules for choosing between them are fixed before any of them is called.
 */
import type { Role } from "../setup.ts";

/** Rule 5's "5 samples", and the proposer's own upper bound: the pipeline's own sample count, not a second copy of it. */
export { SAMPLES as MAX_SAMPLES } from "../propose.ts";

/** Rule 6's "top 3": how many reasons by support a page actually shows, read off the run itself, not a second copy of it. */
export { PUBLISHED_CAP as SHOWN_TOP_N } from "../run.ts";

export interface PilotRole extends Role {
  id: string;
  label?: string; // tells apart a deliberate repeat of the same setup, such as A2's noise floor
}

/** Stage A: 4 setups proposing reasons for the same findings, 5 samples each. */
export const PROPOSERS: PilotRole[] = [
  { id: "P1", transport: "claude", model: "haiku" }, // Haiku 4.5 takes no effort setting
  { id: "P2", transport: "claude", model: "sonnet", effort: "medium" },
  { id: "P3", transport: "claude", model: "sonnet", effort: "high" },
  { id: "P4", transport: "claude", model: "opus", effort: "medium" },
];

/** Stage B: 5 runs attacking the same fixed pool. A2 repeats A1 to measure the noise floor. */
export const ADVERSARIES: PilotRole[] = [
  { id: "A1", transport: "claude", model: "opus", effort: "medium" },
  { id: "A2", transport: "claude", model: "opus", effort: "medium", label: "repeat" },
  { id: "A3", transport: "claude", model: "opus", effort: "high" },
  { id: "A4", transport: "claude", model: "sonnet", effort: "high" },
  { id: "A5", transport: "gemini", model: "gemini-3.8-flash" }, // the free tier's default effort
];

export const PILOT_SEED = 20260925;

/** The findings sample: 6 extremes, 5 changes, 5 gaps, 16 in all. */
export const FINDINGS_BY_KIND = { extreme: 6, change: 5, gap: 5 } as const;

/** The pool: up to 30 passing candidates drawn from each proposer setup, 120 at most. */
export const POOL_PER_PROPOSER = 30;

/** The blind rating: one passing reason per finding per proposer setup, from 15 of the 16 findings. */
export const RATED_PER_PROPOSER = 15;

/** Above this many disagreeing candidates, the rating draws a seeded sample instead of all of them. */
export const DISAGREEMENT_CAP = 40;

/** How many already-rated items come back blind, at the end, for the owner's own drift check. */
export const DRIFT_ITEMS = 10;

/** Every per-finding measure's bootstrap interval resamples the findings this many times. */
export const BOOTSTRAP_ROUNDS = 2000;

/** The bootstrap interval's, and every reported interval's, confidence level. */
export const CONFIDENCE = 0.95;

/** Rule 1: the cheapest setup wins if its blind yes rate sits within this much of the best one. */
export const PROPOSER_MARGIN = 0.1;

/** Rules 2 and 3: how close 2 runs' kappa has to sit to another pair's to count as the same. */
export const KAPPA_MARGIN = 0.05;

/** Rule 2: high effort only pays for itself if its extra breaks were right at least this often. */
export const HIGH_EFFORT_RIGHT_SHARE = 2 / 3;

/**
 * Rule 3: about how many adversary calls the full run makes, the figure A5's speed is
 * checked against.
 */
export const FULL_RUN_ADVERSARY_CALLS = 2400;

/**
 * Rule 3: A5 qualifying by kappa still has to answer `FULL_RUN_ADVERSARY_CALLS` this many
 * hours, one call at a time, or the next qualifier takes the full run instead.
 */
export const A5_MAX_HOURS = 48;

/**
 * Rule 4: how much less often an adversary breaking its own family's reasons counts as
 * self-preference. `insights/setup.json`'s own refinement already refuses an adversary
 * arguing with its own model's reasons, so this measures and reports rather than deciding
 * anything the schema doesn't already forbid.
 */
export const SELF_PREFERENCE_GAP = 0.15;

/** Rule 5: the smallest sample count wins once it finds at least this share of what the full sample count finds good. */
export const SAMPLES_SHARE = 0.9;

/** Rule 5, and the proposer's own setup: the fewest samples a proposer can be asked for. */
export const MIN_SAMPLES = 1;

/** Rule 6: attacking only the shown reasons turns on once this share of all breaks lands on them. */
export const SHOWN_BREAKS_SHARE = 0.8;

/** Anthropic's 3 families, or Google's one, for the self-preference measure. */
export function modelFamily(role: PilotRole): "anthropic-haiku" | "anthropic-sonnet" | "anthropic-opus" | "google" {
  if (role.transport === "gemini") return "google";
  if (role.model === "haiku") return "anthropic-haiku";
  if (role.model === "opus") return "anthropic-opus";
  if (role.model === "sonnet") return "anthropic-sonnet";
  throw new Error(`modelFamily: no known family for "${role.model}" on transport "${role.transport}"`);
}
