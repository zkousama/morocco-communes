/**
 * Whether a commune's change since 2014 can be told as a rate. 55 people in 2014 and 5,728
 * now is +10,314.6%, which says a place began to be counted, not that it grew.
 */

/** People in 2014 below which a percentage change is the size of a rounding. */
export const MIN_FOR_RATE = 500;
/** Percent, either way, beyond which a change is a different place rather than a rate. */
export const MAX_RATE = 500;

export function ratedChange<T extends { pct: number }>(change: T | null | undefined, people2014: number | null | undefined): T | null {
  if (!change || people2014 == null || people2014 < MIN_FOR_RATE) return null;
  return Math.abs(change.pct) <= MAX_RATE ? change : null;
}
