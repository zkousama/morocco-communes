import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DOUAR_FIELDS, DOUAR_TYPES, type DouarField } from "../sources/douarFields.ts";
import type { Definition } from "../sources/hcpDefinitions.ts";
import type { Douars } from "../build/douars.ts";
import { regionOfCode } from "../lib/levels.ts";
import { snake } from "./indicators.ts";
import { toCsv } from "./csv.ts";

/** A field's column in the CSV and its path in the API: distance_km_paved_road, and distanceKm.pavedRoad. */
export const columnOf = (f: DouarField) => `${snake(f.topic)}_${snake(f.key)}`;
export const pathOf = (f: DouarField) => `${f.topic}.${f.key}`;

/** What the workbook counts, and what it leaves out. */
export const NOTES = {
  counted: "The settled rural population of each douar at the 2024 census, and its households. Nomads aren't counted by douar, and neither is any urban area.",
  withheld: "HCP withholds a douar's shares and distances when it has fewer than 30 households: topics is null, and the CSV's figure columns are empty. Its households and population are always given.",
  shares: "Every figure but the population aged 15 and over and the distances is a percentage of the douar's people or households, to one decimal.",
  distances: "Distances are the average, over the douar's dwellings, of the distance to the nearest one of each, in km to 2 decimals. A drivable road is an unpaved one, so a douar can be nearer a paved road.",
  names: "Douars and fractions are named in Arabic only, as the workbook names them.",
};

export async function writeDouars(douars: Douars, dir: string, source: { id: string; url: string }, definitions: Definition[]): Promise<void> {
  await mkdir(dir, { recursive: true });

  const byRegion = new Map<string, Douars["douars"]>();
  for (const d of douars.douars) {
    const region = regionOfCode(d.communeCode);
    byRegion.set(region, [...(byRegion.get(region) ?? []), d]);
  }
  for (const [region, inside] of [...byRegion].sort(([a], [b]) => a.localeCompare(b))) {
    await writeFile(join(dir, `${region}.json`), `${JSON.stringify(inside)}\n`);
  }
  await writeFile(join(dir, "fractions.json"), `${JSON.stringify(douars.fractions)}\n`);

  await writeFile(
    join(dir, "fields.json"),
    `${JSON.stringify(
      {
        census: "2024",
        source,
        types: Object.fromEntries(Object.entries(DOUAR_TYPES).map(([key, t]) => [key, t.fr])),
        fields: DOUAR_FIELDS.map((f) => ({ path: pathOf(f), column: columnOf(f), topic: f.topic, key: f.key, label: f.label, heading: f.heading, unit: f.unit })),
        notes: NOTES,
        definitions,
      },
      null,
      2,
    )}\n`,
  );

  const fractionName = new Map(douars.fractions.map((f) => [f.code, f.name.ar]));
  const head = ["code", "commune_code", "fraction_code", "fraction_ar", "name_ar", "type", "households", "population", ...DOUAR_FIELDS.map(columnOf)];
  const rows = douars.douars.map((d) => [
    d.code,
    d.communeCode,
    d.fraction,
    fractionName.get(d.fraction),
    d.name.ar,
    d.type,
    d.households,
    d.population,
    ...DOUAR_FIELDS.map((f) => d.topics?.[f.topic]?.[f.key] ?? null),
  ]);
  await writeFile(join(dir, "douars.csv"), toCsv(head, rows));
}
