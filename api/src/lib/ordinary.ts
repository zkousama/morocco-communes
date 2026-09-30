/**
 * Whether a commune's shares of households and of people can be read as a place's ways.
 * A few southern communes count thousands of people in 10 to 40 households, the rest being
 * people the census doesn't count in households, so "3% of households have electricity" is
 * one household out of 38. Below 300 households, or above 8 people to a household, the site
 * makes no comparison with such a commune, or from it.
 */

/** Households below which a share moves by whole points on one household. */
export const MIN_HOUSEHOLDS = 300;
/** People to a household above which most people aren't in a household at all. */
export const MAX_PER_HOUSEHOLD = 8;

export function ordinary(people: number | null | undefined, households: number | null | undefined): boolean {
  if (people == null || households == null) return false;
  return households >= MIN_HOUSEHOLDS && people / households <= MAX_PER_HOUSEHOLD;
}
