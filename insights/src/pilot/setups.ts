/**
 * The pilot's fixed setups: which model plays proposer or adversary, at what effort, so a
 * small measured comparison can be run and rated before the full pipeline commits to one.
 * These are constants, not configuration: the pilot's whole point is that the setups and
 * the rules for choosing between them are fixed before any of them is called.
 */
import type { Role } from "../setup.ts";

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

/**
 * A5 (Gemini) qualifying under decision rule 3 still has to be fast enough for the full
 * run: at one call at a time, its seconds per call times 2,400 calls has to fit this many
 * hours, or the next qualifier gets the full run instead.
 */
export const A5_MAX_HOURS = 48;

/** Anthropic's 3 families, or Google's one, for the self-preference measure. */
export function modelFamily(role: PilotRole): "anthropic-haiku" | "anthropic-sonnet" | "anthropic-opus" | "google" {
  if (role.transport === "gemini") return "google";
  if (role.model === "haiku") return "anthropic-haiku";
  if (role.model === "opus") return "anthropic-opus";
  if (role.model === "sonnet") return "anthropic-sonnet";
  throw new Error(`modelFamily: no known family for "${role.model}" on transport "${role.transport}"`);
}
