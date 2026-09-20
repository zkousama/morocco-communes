import { ECONOMY_FIELDS, PARTS, SPLITS } from "../sources/economyFields.ts";
import type { EconomyRecord } from "../build/economy.ts";
import type { Level } from "../build/indicators.ts";

/**
 * The arithmetic the establishment counts have to satisfy.
 *
 * Within a unit, the total is its three kinds of establishment added up, and each way the
 * businesses are split covers all of them. Across the country, every figure adds up the
 * tree: a région is its provinces, a province its communes and arrondissements, a cercle
 * its rural communes, and one of Casablanca's préfectures d'arrondissements is the
 * arrondissements under it. A column read under the wrong heading, or a row placed on the
 * wrong unit, breaks one of these.
 *
 * The 6 cities carry a sum of their own arrondissements rather than a row of HCP's, so
 * they sit outside the tree, where counting them would count their arrondissements twice.
 * Casablanca's sum is checked against a second grouping of the same 16 arrondissements:
 * the 8 préfectures d'arrondissements HCP does publish.
 */
export function checkEconomy(
  records: EconomyRecord[],
  /** The cercle each commune belongs to, as the dataset publishes it. Null for a municipality. */
  cercleOf: Map<string, string | null>,
  /** Every unit the dataset publishes. */
  units: { code: string; level: Level; name: string }[],
  /** Which city each arrondissement belongs to, as the dataset's own records give it. */
  cityOf: Map<string, string>,
): string[] {
  const problems: string[] = [];
  const byCode = new Map(records.map((r) => [r.code ?? "", r]));
  /** The units HCP gives a row of its own, which are the ones the tree is made of. */
  const published = records.filter((r) => r.basis === undefined);
  const citiesWithArrondissements = new Set(cityOf.values());
  const figure = (r: EconomyRecord, topic: string, key: string) => r.topics[topic]?.[key] ?? null;

  for (const unit of units) {
    if (unit.level === "urbanCentre") continue;
    if (!byCode.has(unit.code)) problems.push(`${unit.code} ${unit.name}: no row of establishments`);
  }
  for (const code of citiesWithArrondissements) {
    const city = byCode.get(code);
    if (city && city.basis !== "arrondissement_sum") {
      problems.push(`${code} ${city.name.fr}: counted by arrondissement, so its figures have to say they were summed`);
    }
  }

  for (const r of records) {
    const where = `${r.code ?? "Morocco"} ${r.name.fr}`;
    for (const f of ECONOMY_FIELDS) {
      const value = figure(r, f.topic, f.key);
      if (value === null) problems.push(`${where}: ${f.topic}.${f.key} is missing`);
      else if (value < 0) problems.push(`${where}: ${f.topic}.${f.key} is ${value}`);
    }
    const total = figure(r, "establishments", "total") ?? 0;
    const business = figure(r, "establishments", "business") ?? 0;
    const parts = PARTS.reduce((a, key) => a + (figure(r, "establishments", key) ?? 0), 0);
    if (parts !== total) problems.push(`${where}: ${PARTS.join(", ")} make ${parts}, not the ${total} establishments counted`);
    if ((figure(r, "establishments", "jobs") ?? 0) < business) {
      problems.push(`${where}: fewer jobs than the ${business} businesses holding them, though every business employs at least one person`);
    }
    for (const split of SPLITS) {
      const sum = ECONOMY_FIELDS.filter((f) => f.topic === split).reduce((a, f) => a + (figure(r, f.topic, f.key) ?? 0), 0);
      if (sum !== business) problems.push(`${where}: by ${split} the businesses make ${sum}, not ${business}`);
    }
  }

  /** Every figure of a unit against the same figures of the units it is made of. */
  const covers = (parent: EconomyRecord, children: EconomyRecord[], what: string) => {
    for (const f of ECONOMY_FIELDS) {
      const sum = children.reduce((a, c) => a + (figure(c, f.topic, f.key) ?? 0), 0);
      const held = figure(parent, f.topic, f.key) ?? 0;
      if (sum !== held) {
        problems.push(`${parent.code ?? "Morocco"} ${parent.name.fr}: its ${children.length} ${what} hold ${sum} of ${f.topic}.${f.key}, the unit itself ${held}`);
      }
    }
  };

  const at = (level: Level) => published.filter((r) => r.level === level);
  // A préfecture d'arrondissements is published at the province level with a longer code,
  // and sits inside the préfecture of Casablanca rather than beside it.
  const provinces = at("province").filter((r) => r.code!.split(".").length === 2);
  const prefecturesOfArrondissements = at("province").filter((r) => r.code!.split(".").length === 4);
  const arrondissements = at("arrondissement");
  const communes = at("commune");

  const country = byCode.get("");
  if (!country) problems.push("the country carries no establishments");
  else covers(country, at("region"), "régions");

  for (const region of at("region")) {
    covers(region, provinces.filter((p) => p.code!.startsWith(`${region.code}.`)), "provinces");
  }
  for (const province of provinces) {
    const inside = [...communes, ...arrondissements].filter((u) => u.code!.startsWith(`${province.code}.`));
    covers(province, inside, "communes and arrondissements");
  }
  for (const prefecture of prefecturesOfArrondissements) {
    covers(prefecture, arrondissements.filter((a) => a.codeDigits!.slice(0, 8) === prefecture.codeDigits!.slice(0, 8)), "arrondissements");
  }
  for (const cercle of at("cercle")) {
    covers(cercle, communes.filter((c) => cercleOf.get(c.code!) === cercle.code), "communes");
  }

  // Each city against its own arrondissements, and Casablanca's against the 8 préfectures
  // d'arrondissements too, which group the same 16 units and are HCP's own figures.
  for (const code of citiesWithArrondissements) {
    const city = byCode.get(code);
    if (!city) continue;
    const inside = arrondissements.filter((a) => cityOf.get(a.code!) === code);
    covers(city, inside, "arrondissements");
    const prefectures = prefecturesOfArrondissements.filter((p) => inside.some((a) => a.codeDigits!.slice(0, 8) === p.codeDigits!.slice(0, 8)));
    if (prefectures.length > 0) covers(city, prefectures, "préfectures d'arrondissements");
  }

  return problems;
}
