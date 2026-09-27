/**
 * Figures HCP's 2014 and 2024 censuses publish for the same place that can't both describe
 * the same people. Only the local languages people use are checked, since they change
 * slowly: across the communes, 9 shares in 10 moved less than 8 points between the two
 * censuses. A share is flagged when it moved more than 30 points and more than the
 * population itself changed, in percent, so people moving in or out can't account for it.
 *
 * Both figures are HCP's own, as published. A flag says the two censuses disagree, not
 * which one is right.
 */
import type { Topics } from "./indicators.ts";

/** How many points a local language's share has to move before it's flagged. */
export const SWING = 30;

const LANGUAGES = ["darija", "tachelhit", "tamazight", "tarifit", "hassania"];

export interface Mismatch {
  path: string;
  then: number;
  now: number;
}

/** A place's people, everyone counted, at each census: `people.total.all` in the files. */
export function mismatches(now: Topics | null | undefined, then: Topics | null | undefined): Mismatch[] {
  const peopleNow = now?.population?.legal;
  const peopleThen = then?.population?.legal;
  if (!now || !then || !peopleNow || !peopleThen) return [];
  const moved = (Math.abs(peopleNow - peopleThen) / peopleThen) * 100;
  return LANGUAGES.flatMap((key) => {
    const before = then.localLanguages?.[key];
    const after = now.localLanguages?.[key];
    if (before == null || after == null) return [];
    const swing = Math.abs(after - before);
    return swing > SWING && swing > moved ? [{ path: `localLanguages.${key}`, then: before, now: after }] : [];
  });
}
