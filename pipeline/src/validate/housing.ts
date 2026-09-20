import { HOUSING_FIELDS, PRECARIOUS, SOUND, TYPES } from "../sources/housingFields.ts";
import type { HousingRecord } from "../build/housing.ts";

/**
 * The arithmetic the housing stock has to satisfy, checked on every unit that has one.
 *
 * The occupied and the unoccupied make the whole stock, and the vacant and the seasonal
 * make the unoccupied. Sound and precarious housing make the whole stock too, and each is
 * the types under it. The age bands cover it, and so does each type's own set of bands.
 * Walls and roofs are each a split of the whole. A column read under the wrong heading
 * breaks one of these.
 *
 * The shares are published to one decimal, so a group of them lands near 100 rather than
 * on it: the tolerance is a tenth per share added.
 */
export function checkHousing(records: HousingRecord[]): string[] {
  const problems: string[] = [];
  const figure = (r: HousingRecord, topic: string, key: string) => r.topics[topic]?.[key] ?? null;

  const sums = (r: HousingRecord, where: string, parts: (number | null)[], total: number | null, what: string) => {
    if (total === null || parts.some((p) => p === null)) return;
    const sum = (parts as number[]).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - total) > 0.05 * parts.length + 0.05) problems.push(`${where}: ${what} make ${sum.toFixed(1)}, not ${total}`);
  };

  for (const r of records) {
    const where = `${r.code ?? "Morocco"} ${r.name.fr}`;
    const at = (topic: string, key: string) => figure(r, topic, key);

    for (const f of HOUSING_FIELDS) {
      const value = at(f.topic, f.key);
      if (value === null) continue;
      if (value < 0) problems.push(`${where}: ${f.topic}.${f.key} is ${value}`);
      // The shortfall is households against dwellings, so a town where households
      // outnumber the dwellings passes 100: Tainaste's is 232.6%.
      const ceiling = f.key === "deficitRate" ? 1000 : 100.05;
      if (f.unit === "percent" && value > ceiling) problems.push(`${where}: ${f.topic}.${f.key} is ${value}%`);
    }
    if (at("dwellings", "total") === null) problems.push(`${where}: a record with no count of dwellings`);

    sums(r, where, [at("occupancy", "occupied"), at("occupancy", "unoccupied")], 100, "occupied and unoccupied");
    sums(r, where, [at("occupancy", "vacant"), at("occupancy", "seasonal")], at("occupancy", "unoccupied"), "vacant and seasonal");
    sums(r, where, [at("type", "sound"), at("type", "precarious")], 100, "sound and precarious housing");
    sums(r, where, SOUND.map((k) => at("type", k)), at("type", "sound"), "the sound types");
    sums(r, where, PRECARIOUS.map((k) => at("type", k)), at("type", "precarious"), "the precarious types");
    sums(r, where, ["under20", "20-49", "50+"].map((k) => at("age", k)), 100, "the age bands");
    sums(r, where, ["concreteOrBrick", "stone", "other"].map((k) => at("walls", k)), 100, "the wall materials");
    sums(r, where, ["slab", "woodOrTiles", "sheetMetal", "other"].map((k) => at("roofs", k)), 100, "the roof materials");
    for (const type of TYPES) {
      // A unit with no apartments has 0 apartments in each age band, which is the
      // workbook agreeing with itself rather than a group that stopped adding up.
      const share = at("type", type);
      if (share === null || share === 0) continue;
      sums(r, where, ["Under20", "20to49", "50Plus"].map((b) => at("ageByType", `${type}${b}`)), 100, `${type}'s age bands`);
    }
  }

  return problems;
}
