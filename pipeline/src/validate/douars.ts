import { DOUAR_FIELDS } from "../sources/douarFields.ts";
import type { DouarRecord, FractionRecord } from "../build/douars.ts";

/**
 * The arithmetic the douars have to satisfy.
 *
 * Each split of a douar's people or households makes 100: nationality, sex, the 3 age
 * groups, the marital status of those aged 15 and over, and the type of dwelling. A douar
 * has at least as many people as households, and no more people aged 15 and over than
 * people. A column read under the wrong heading breaks one of these.
 *
 * Across a commune, the douars count its settled rural people, so they never add up to more
 * than its legal population.
 *
 * The shares are rounded to a tenth here, so a group of them lands near 100 rather than on
 * it: the tolerance is a twentieth per share added.
 */
export function checkDouars(douars: DouarRecord[], fractions: FractionRecord[], populationOf: Map<string, number | null>): string[] {
  const problems: string[] = [];

  for (const d of douars) {
    const where = `douar ${d.code} ${d.name.ar}`;
    if (d.population < d.households) problems.push(`${where}: ${d.population} people in ${d.households} households`);
    if (d.topics === null) {
      if (d.households >= 30) problems.push(`${where}: figures withheld for ${d.households} households`);
      continue;
    }
    const at = (topic: string, key: string) => d.topics![topic]?.[key] ?? null;
    for (const f of DOUAR_FIELDS) {
      const value = at(f.topic, f.key);
      if (value === null) {
        problems.push(`${where}: ${f.topic}.${f.key} is missing`);
        continue;
      }
      if (value < 0) problems.push(`${where}: ${f.topic}.${f.key} is ${value}`);
      if (f.unit === "percent" && value > 100.05) problems.push(`${where}: ${f.topic}.${f.key} is ${value}%`);
    }
    const sums = (topic: string, keys: string[]) => {
      const parts = keys.map((k) => at(topic, k));
      if (parts.some((p) => p === null)) return;
      const sum = (parts as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 100) > 0.05 * keys.length + 0.05) problems.push(`${where}: ${topic} makes ${sum.toFixed(1)}, not 100`);
    };
    sums("nationality", ["moroccan", "foreign"]);
    sums("sex", ["male", "female"]);
    sums("age", ["under15", "15-59", "60+"]);
    sums("maritalStatus", ["single", "married", "divorced", "widowed"]);
    sums("dwellingType", ["villa", "apartment", "traditionalMoroccanHouse", "modernMoroccanHouse", "basicOrSlum", "ruralSolid", "ruralEarth", "other"]);
    const adults = at("maritalStatus", "population15Plus");
    if (adults !== null && adults > d.population) problems.push(`${where}: ${adults} aged 15 and over of ${d.population}`);
  }

  const byCommune = new Map<string, number>();
  for (const f of fractions) byCommune.set(f.communeCode, (byCommune.get(f.communeCode) ?? 0) + f.population);
  for (const [code, people] of byCommune) {
    const total = populationOf.get(code);
    if (total === undefined || total === null) problems.push(`commune ${code} has douars and no population`);
    else if (people > total) problems.push(`commune ${code}: its douars hold ${people} people, its population is ${total}`);
  }

  return problems;
}
