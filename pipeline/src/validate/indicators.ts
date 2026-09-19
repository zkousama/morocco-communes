import { AREAS, HOUSEHOLD_FIELDS, PEOPLE_FIELDS, SEXES } from "../sources/hcpIndicators.ts";
import type { IndicatorRecord, Topics } from "../build/indicators.ts";

/**
 * The arithmetic HCP's figures have to satisfy, checked on every row. Each one would catch
 * a column read under the wrong name: a swapped pair of shares no longer sums, a rate read
 * from the wrong column no longer matches its counts.
 *
 * Two identities are looser than they look. The long questionnaire went to a 20% sample of
 * households in communes of 2,000 households or more, so its counts are weighted estimates,
 * and a rate computed from them drifts from HCP's, which comes from the unrounded weights:
 * up to 0.15 points once 10,000 people are counted, and a few points in a small commune.
 * And the labour figures leave out homeless people while the 15-and-over population counts
 * them, so active and inactive can fall short of it but never exceed it.
 */
export function checkIndicators(
  records: IndicatorRecord[],
  /** HCP's 2024 population and households for each unit, from the dataset's own records. */
  published: Map<string, { population: number | null; households: number | null }>,
): string[] {
  const problems: string[] = [];
  const say = (r: IndicatorRecord, text: string) => problems.push(`${r.code ?? "Morocco"} ${r.name.fr}: ${text}`);
  const num = (v: number | null | undefined): v is number => typeof v === "number";
  const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance + 1e-9;

  const shares = (topics: Topics, topic: string, parts: number) => {
    const values = Object.values(topics[topic] ?? {}).slice(0, parts);
    if (values.length !== parts || !values.every(num)) return null;
    return values.reduce((a, b) => a + b, 0);
  };
  const PEOPLE_SHARES: [string, number][] = [["age", 16], ["education", 6], ["employmentStatus", 8]];
  const HOUSEHOLD_SHARES = ["dwellingType", "occupancy", "dwellingAge", "wastewater", "householdWaste", "cookingFuel"];

  for (const r of records) {
    const expected = r.code ? published.get(r.code) : undefined;
    const total = r.people.total?.all;
    if (expected) {
      if (total?.population?.legal !== expected.population) {
        say(r, `legal population ${total?.population?.legal}, the population file says ${expected.population}`);
      }
      if (r.households.total?.households?.count !== expected.households) {
        say(r, `${r.households.total?.households?.count} households, the population file says ${expected.households}`);
      }
    }

    for (const area of AREAS) {
      const people = r.people[area];
      const homes = r.households[area];
      if (!people !== !homes) say(r, `${area}: people and households disagree on whether it exists`);
      if (!people || !homes) continue;

      const all = people.all.population!.municipal;
      const male = people.male.population!.municipal;
      const female = people.female.population!.municipal;
      if (num(all) && num(male) && num(female)) {
        if (male + female !== all) say(r, `${area}: ${male} men and ${female} women make ${male + female}, not ${all}`);
        const share = people.all.sex?.male;
        if (num(share) && all > 0 && !near(share, (male / all) * 100, 0.05)) say(r, `${area}: ${share}% men, the counts give ${((male / all) * 100).toFixed(2)}`);
      }
      if (homes.households!.municipalPopulation !== all) {
        say(r, `${area}: the household sheet counts ${homes.households!.municipalPopulation} people, the people sheet ${all}`);
      }
      const { count, averageSize, sedentary } = homes.households!;
      if (num(count) && num(sedentary) && sedentary > count) say(r, `${area}: more sedentary households than households`);
      if (num(count) && num(averageSize) && num(all) && count > 0 && !near(averageSize, all / count, 0.05)) {
        say(r, `${area}: average household ${averageSize}, the counts give ${(all / count).toFixed(2)}`);
      }
      for (const topic of HOUSEHOLD_SHARES) {
        const parts = HOUSEHOLD_FIELDS.filter((f) => f.topic === topic).length;
        const sum = shares(homes, topic, parts);
        if (sum !== null && !near(sum, 100, 0.05 * parts)) say(r, `${area}: ${topic} sums to ${sum.toFixed(1)}`);
      }

      for (const sex of SEXES) {
        const t = people[sex];
        for (const [topic, parts] of PEOPLE_SHARES) {
          const sum = shares(t, topic, parts);
          if (sum !== null && sum > 0 && !near(sum, 100, 0.05 * parts)) say(r, `${area}/${sex}: ${topic} sums to ${sum.toFixed(1)}`);
        }
        const married = t.maritalStatus;
        if (married && [married.single, married.married, married.divorced, married.widowed].every(num)) {
          const sum = married.single! + married.married! + married.divorced! + married.widowed!;
          if (!near(sum, 100, 0.2)) say(r, `${area}/${sex}: marital status sums to ${sum.toFixed(1)}`);
        }
        if (sex === "all" && t.sex && num(t.sex.male) && num(t.sex.female) && !near(t.sex.male + t.sex.female, 100, 0.1)) {
          say(r, `${area}: the sexes sum to ${t.sex.male + t.sex.female}`);
        }

        const over15 = [t.maritalStatus?.population15Plus, t.illiteracy?.population15Plus, t.labour?.population15Plus];
        if (over15.every(num) && new Set(over15).size !== 1) say(r, `${area}/${sex}: three different 15-and-over populations, ${over15.join(", ")}`);

        const { active, inactive, employed, activityRate, unemploymentRate, population15Plus } = t.labour ?? {};
        if (num(active) && num(inactive) && num(population15Plus) && active + inactive > population15Plus) {
          say(r, `${area}/${sex}: ${active} active and ${inactive} inactive, more than the ${population15Plus} aged 15 and over`);
        }
        if (num(active) && num(employed) && employed > active) say(r, `${area}/${sex}: more employed than active`);
        if (num(active) && num(inactive) && num(activityRate) && active + inactive > 0) {
          const counted = active + inactive;
          const tolerance = counted >= 10_000 ? 0.15 : 1;
          if (!near(activityRate, (active / counted) * 100, tolerance)) say(r, `${area}/${sex}: activity rate ${activityRate}, the counts give ${((active / counted) * 100).toFixed(2)}`);
        }
        if (num(active) && num(employed) && num(unemploymentRate) && active > 0) {
          const tolerance = active >= 10_000 ? 0.15 : 3;
          const counted = ((active - employed) / active) * 100;
          if (!near(unemploymentRate, counted, tolerance)) say(r, `${area}/${sex}: unemployment ${unemploymentRate}, the counts give ${counted.toFixed(2)}`);
        }
        const literate = t.languagesReadAndWritten?.literatePopulation10Plus;
        const over10 = t.illiteracy?.population10Plus;
        const illiterate = t.illiteracy?.rate10Plus;
        if (num(literate) && num(over10) && num(illiterate) && over10 > 0) {
          const counted = (1 - literate / over10) * 100;
          if (!near(illiterate, counted, 0.15)) say(r, `${area}/${sex}: illiteracy ${illiterate}, the counts give ${counted.toFixed(2)}`);
        }
      }
    }

    // Urban and rural are a partition of the whole.
    const part = (area: "urban" | "rural", get: (area: "total" | "urban" | "rural") => number | null | undefined) =>
      r.people[area] ? get(area) ?? null : 0;
    const municipal = (area: "total" | "urban" | "rural") => r.people[area]?.all.population?.municipal;
    const homes = (area: "total" | "urban" | "rural") => r.households[area]?.households?.count;
    const [tm, um, rm] = [municipal("total"), part("urban", municipal), part("rural", municipal)];
    if (num(tm) && num(um) && num(rm) && um + rm !== tm) say(r, `urban ${um} and rural ${rm} people don't make ${tm}`);
    const [th, uh, rh] = [homes("total"), part("urban", homes), part("rural", homes)];
    if (num(th) && num(uh) && num(rh) && uh + rh !== th) say(r, `urban ${uh} and rural ${rh} households don't make ${th}`);

    // Every value in range for what it measures.
    const check = (topics: Topics, fields: typeof PEOPLE_FIELDS, where: string) => {
      for (const f of fields) {
        const v = topics[f.topic]?.[f.key];
        if (!num(v)) continue;
        const ok =
          f.unit === "people" || f.unit === "households" ? Number.isInteger(v) && v >= 0
          : f.unit === "percent" ? v >= 0 && v <= 100
          : f.unit === "births per woman" ? v >= 0 && v <= 10
          : f.unit === "years" ? v >= 12 && v <= 55
          : f.unit === "people per household" ? v >= 1 && v <= 20
          // Touizgui (10.071.03.05) is at 15.4 as HCP publishes it: 25 of its 177
          // households are sedentary. The next highest anywhere is 4.9.
          : f.unit === "people per room" ? v > 0 && v <= 20
          : v >= 0 && v <= 500;
        if (!ok) say(r, `${where} ${f.topic}.${f.key} is ${v} ${f.unit}`);
      }
    };
    for (const area of AREAS) {
      const people = r.people[area];
      if (people) for (const sex of SEXES) check(people[sex], PEOPLE_FIELDS.filter((f) => f.sexes.includes(sex)), `${area}/${sex}`);
      const homes = r.households[area];
      if (homes) check(homes, HOUSEHOLD_FIELDS, area);
    }
  }

  const countries = records.filter((r) => r.level === "country");
  if (countries.length !== 1) problems.push(`${countries.length} national rows, expected 1`);
  return problems;
}
