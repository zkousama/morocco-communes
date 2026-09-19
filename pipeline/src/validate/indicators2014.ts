import { AREAS, SEXES, type Area } from "../sources/indicatorFields.ts";
import type { Field2014 } from "../sources/indicator2014Fields.ts";
import { HOUSEHOLD_FIELDS_2014_ALL, PEOPLE_FIELDS_2014_ALL } from "../sources/censusFields.ts";
import type { Topics } from "../build/indicators.ts";
import type { Indicator2014Block } from "../build/indicators2014.ts";

/**
 * The arithmetic the 2014 figures have to satisfy, checked on every unit they landed on.
 * Each one would catch a column read under the wrong name, and the first one would catch a
 * unit that took another unit's figures: the population workbook was joined to the dataset
 * on its own, and its count for a commune has to be the count this workbook carries.
 *
 * Two of the 2014 groups are left out on purpose. A household counts under every cooking
 * fuel it used and a person under every local language they speak, so neither sums to 100.
 */
export function checkIndicators2014(
  blocks: Map<string, Indicator2014Block>,
  names: Map<string, string>,
  /** HCP's 2014 population and households for each unit, from the dataset's own records. */
  published: Map<string, { population: number | null; households: number | null }>,
): string[] {
  const problems: string[] = [];
  const num = (v: number | null | undefined): v is number => typeof v === "number";
  const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance + 1e-9;

  const PEOPLE_SHARES = ["age", "maritalStatus", "languageCombinations", "education", "employmentStatus", "workplace", "commute", "study", "studyCommute"];
  const HOUSEHOLD_SHARES = ["dwellingType", "occupancy", "dwellingAge", "wastewater", "householdWaste"];
  /** A topic's shares, leaving out the counts and averages it also carries. */
  const shareKeys = (fields: Field2014[], topic: string) =>
    fields.filter((f) => f.topic === topic && f.unit === "percent").map((f) => f.key);

  const sumOf = (block: Record<string, number | null>, keys: string[]) => {
    const values = keys.map((key) => block[key]);
    if (!values.every(num)) return null;
    return values.reduce((a, b) => a + b, 0);
  };

  for (const [code, block] of blocks) {
    const name = names.get(code) ?? "Morocco";
    const say = (text: string) => problems.push(`${code || "Morocco"} ${name}: ${text}`);

    // A commune the crosswalk placed carries its 2014 population and not its household
    // count, so a null there is a figure the dataset doesn't have rather than a
    // disagreement with this one.
    const expected = published.get(code);
    const legal = block.people.total?.all.population?.legal;
    const households = block.households.total?.households?.count;
    if (expected?.population !== null && expected?.population !== undefined && legal !== expected.population) {
      say(`legal population ${legal}, the 2014 population file says ${expected.population}`);
    }
    if (expected?.households !== null && expected?.households !== undefined && households !== expected.households) {
      say(`${households} households, the 2014 population file says ${expected.households}`);
    }

    for (const area of AREAS) {
      const people = block.people[area];
      const homes = block.households[area];
      // Four Western Sahara communes were empty in 2014. HCP gives them a legal
      // population of 0 and signs every other column, so the people block stands alone
      // with nothing in it to compare.
      const empty = people !== null && people.all.population?.municipal === null;
      if (!people !== !homes && !empty) say(`${area}: people and households disagree on whether it exists`);
      if (!people || !homes) continue;

      const all = people.all.population?.municipal;
      const male = people.male.population?.municipal;
      const female = people.female.population?.municipal;
      if (num(all) && num(male) && num(female) && male + female !== all) {
        say(`${area}: ${male} men and ${female} women make ${male + female}, not ${all}`);
      }
      if (homes.households?.municipalPopulation !== all) {
        say(`${area}: the household sheet counts ${homes.households?.municipalPopulation} people, the people sheet ${all}`);
      }
      const { count, averageSize } = homes.households ?? {};
      if (num(count) && num(averageSize) && num(all) && count > 0 && !near(averageSize, all / count, 0.06)) {
        say(`${area}: average household ${averageSize}, the counts give ${(all / count).toFixed(2)}`);
      }
      for (const topic of HOUSEHOLD_SHARES) {
        const keys = shareKeys(HOUSEHOLD_FIELDS_2014_ALL, topic);
        const sum = sumOf(homes[topic] ?? {}, keys);
        if (sum !== null && sum > 0 && !near(sum, 100, 0.05 * keys.length)) say(`${area}: ${topic} sums to ${sum.toFixed(1)}`);
      }

      for (const sex of SEXES) {
        const t = people[sex];
        for (const topic of PEOPLE_SHARES) {
          const keys = shareKeys(PEOPLE_FIELDS_2014_ALL, topic);
          const sum = sumOf(t[topic] ?? {}, keys);
          if (sum !== null && sum > 0 && !near(sum, 100, 0.05 * keys.length)) say(`${area}/${sex}: ${topic} sums to ${sum.toFixed(1)}`);
        }
        // In 2014 everyone outside the labour force counted as inactive, children with
        // the rest, so the two together are the whole municipal population.
        const municipal = t.population?.municipal;
        const commuting = t.commute?.employed;
        const students = t.study?.students;
        if (num(commuting) && num(municipal) && commuting > municipal) {
          say(`${area}/${sex}: ${commuting} people commuting, more than the ${municipal} counted`);
        }
        if (num(students) && num(municipal) && students > municipal) {
          say(`${area}/${sex}: ${students} people in education, more than the ${municipal} counted`);
        }
        const { active, inactive } = t.labour ?? {};
        if (num(active) && num(commuting) && commuting > active) say(`${area}/${sex}: more people commuting than in the labour force`);
        if (num(active) && num(inactive) && num(municipal) && active + inactive !== municipal) {
          say(`${area}/${sex}: ${active} active and ${inactive} inactive make ${active + inactive}, not the ${municipal} people counted`);
        }
      }
    }

    // Urban and rural are a partition of the whole.
    const part = (area: "urban" | "rural", get: (area: Area) => number | null | undefined) =>
      block.people[area] ? get(area) ?? null : 0;
    const municipal = (area: Area) => block.people[area]?.all.population?.municipal;
    const homes = (area: Area) => block.households[area]?.households?.count;
    const [tm, um, rm] = [municipal("total"), part("urban", municipal), part("rural", municipal)];
    if (num(tm) && num(um) && num(rm) && um + rm !== tm) say(`urban ${um} and rural ${rm} people don't make ${tm}`);
    const [th, uh, rh] = [homes("total"), part("urban", homes), part("rural", homes)];
    if (num(th) && num(uh) && num(rh) && uh + rh !== th) say(`urban ${uh} and rural ${rh} households don't make ${th}`);

    // Every value in range for what it measures.
    const check = (topics: Topics, fields: Field2014[], where: string) => {
      for (const f of fields) {
        const v = topics[f.topic]?.[f.key];
        if (!num(v)) continue;
        const ok =
          f.unit === "people" || f.unit === "households" ? Number.isInteger(v) && v >= 0
          : f.unit === "percent" ? v >= 0 && v <= 100
          : f.unit === "births per woman" ? v >= 0 && v <= 12
          : f.unit === "years" ? v >= 12 && v <= 55
          : f.unit === "people per household" ? v >= 1 && v <= 20
          // Gleibat El Foula (12.391.05.03) is at 32 as HCP publishes it: the census
          // counted 32 people in 18 households there. The next highest is 9.5.
          : f.unit === "people per room" ? v > 0 && v <= 40
          : v >= 0 && v <= 500;
        if (!ok) say(`${where} ${f.topic}.${f.key} is ${v} ${f.unit}`);
      }
    };
    for (const area of AREAS) {
      const people = block.people[area];
      if (people) for (const sex of SEXES) check(people[sex], PEOPLE_FIELDS_2014_ALL.filter((f) => f.sexes.includes(sex)), `${area}/${sex}`);
      const homes = block.households[area];
      if (homes) check(homes, HOUSEHOLD_FIELDS_2014_ALL, area);
    }
  }

  if (!blocks.has("")) problems.push("no national row");
  return problems;
}
