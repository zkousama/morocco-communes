/**
 * Figures HCP's 2014 and 2024 censuses publish for the same place that the site doesn't
 * compare. Two kinds of figure are checked, both because they change slowly.
 *
 * The local languages people use: across the communes, 9 shares in 10 moved less than 8
 * points between the two censuses. A share is flagged when it moved more than 30 points,
 * either way. Two figures that far apart can't both describe the same people.
 *
 * What a household has: running water, electricity, the public sewer, a toilet, a kitchen.
 * Once a household has them it rarely loses them: across the communes, 1 of these shares in
 * 7 fell at all, and 2 in 100 by more than 10 points. A share is flagged when it fell more
 * than 30 points; a rise is what building does. A fall that large is rare, and the flag says
 * no more than that: both figures can be right. The bathroom isn't checked, since 2014 asked
 * about a bath and 2024 about a room with water.
 *
 * Either way, the move has to be larger than the population itself changed, in percent, so
 * people moving in or out can't account for it. Both figures are HCP's own, as published.
 */
import type { Census } from "./indicators.ts";

/** How many points a local language's share has to move before it's flagged. */
export const SWING = 30;
/** How many points a household amenity's share has to fall before it's flagged. */
export const FALL = 30;

export const LANGUAGES = ["darija", "tachelhit", "tamazight", "tarifit", "hassania"].map((key) => `localLanguages.${key}`);
export const AMENITIES = ["amenities.runningWater", "amenities.electricity", "wastewater.publicSewer", "amenities.toilet", "amenities.kitchen"];
/** Every figure checked, in the order the flags come in. */
export const CHECKED = [...LANGUAGES, ...AMENITIES];

export interface Mismatch {
  path: string;
  then: number;
  now: number;
}

/** A local language off the people, anything else off the households. */
const shareIn = (census: Census, path: string) => {
  const [topic, key] = path.split(".") as [string, string];
  const block = topic === "localLanguages" ? census.people.total?.all : census.households.total;
  return block?.[topic]?.[key] ?? null;
};

/** A place's figures at each census, everyone counted: `people.total.all` and `households.total` in the files. */
export function mismatches(now: Census | null | undefined, then: Census | null | undefined): Mismatch[] {
  const peopleNow = now?.people.total?.all?.population?.legal;
  const peopleThen = then?.people.total?.all?.population?.legal;
  if (!now || !then || !peopleNow || !peopleThen) return [];
  const moved = (Math.abs(peopleNow - peopleThen) / peopleThen) * 100;
  return CHECKED.flatMap((path) => {
    const before = shareIn(then, path);
    const after = shareIn(now, path);
    if (before == null || after == null) return [];
    const language = LANGUAGES.includes(path);
    const shift = language ? Math.abs(after - before) : before - after;
    return shift > (language ? SWING : FALL) && shift > moved ? [{ path, then: before, now: after }] : [];
  });
}
