import { mkdir, rm, writeFile } from "node:fs/promises";
import { regionOfCode } from "../lib/levels.ts";
import { join } from "node:path";
import { AREAS, SEXES, type Field } from "../sources/hcpIndicators.ts";
import { HOUSEHOLD_FIELDS_ALL as HOUSEHOLD_FIELDS, PEOPLE_FIELDS_ALL as PEOPLE_FIELDS } from "../sources/censusFields.ts";
import { HCP_CONCEPT } from "../sources/indicatorFields.ts";
import { definitionsByTerm, termFor, type Definition } from "../sources/hcpDefinitions.ts";
import type { IndicatorRecord, Level } from "../build/indicators.ts";
import { toCsv } from "./csv.ts";

/** populationFifteenPlus → population_15_plus, "75+" → 75_plus, "0-4" → 0_4. */
export const snake = (s: string) =>
  s
    .replace(/\+/g, "Plus")
    .replace(/([a-z])([A-Z0-9])/g, "$1_$2")
    .replace(/([0-9])([A-Za-z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();

/** A field's column in the CSVs and its path in the API: age_75_plus, and age.75+. */
export const columnOf = (f: Field) => `${snake(f.topic)}_${snake(f.key)}`;
export const pathOf = (f: Field) => `${f.topic}.${f.key}`;

const FILES: Record<Level, string> = {
  country: "national",
  region: "regions",
  province: "provinces",
  cercle: "cercles",
  commune: "communes",
  arrondissement: "arrondissements",
  urbanCentre: "urban-centres",
};

/** The notes HCP publishes with the workbook, which hold for every figure in it. */
export const NOTES = {
  signs: [
    { sign: "…", hcp: "N'ayant pas lieu de figurer", meaning: "Nothing to report, such as the urban part of a rural commune", here: "null" },
    { sign: ".", hcp: "Indisponible", meaning: "Unavailable", here: "null" },
    {
      sign: "*",
      hcp: "Données recueillies auprès de l'Administration locale en raison de la mobilité saisonnière de la population",
      meaning: "After a commune's name: collected from the local administration, because the population moves with the seasons",
      here: "fromLocalAdministration: true",
    },
  ],
  rounding: "Rates and shares are rounded to one decimal, so a figure combined from them can differ slightly from HCP's own.",
  withoutHomeless: [
    "fertility.totalFertilityRate",
    "fertility.completedFertility",
    "schooling.rate6to11",
    "languagesReadAndWritten",
    "localLanguages",
    "labour.active",
    "labour.inactive",
    "labour.activityRate",
    "labour.unemploymentRate",
    "labour.employed",
    "employmentStatus",
  ],
  sample:
    "The long questionnaire, which carries most of these topics, went to every household in communes of fewer than 2,000 households and to a random 20% of households elsewhere, so in larger communes these figures are estimates from that sample.",
};

const describe = (f: Field, term: string | null) => ({
  path: pathOf(f),
  column: columnOf(f),
  topic: f.topic,
  key: f.key,
  label: f.label,
  heading: f.heading,
  ...(f.category ? { category: f.category } : {}),
  unit: f.unit,
  ...(f.sexes.length > 0 ? { sexes: f.sexes } : {}),
  ...(term ? { definedAs: term } : {}),
});

export async function writeIndicators(
  records: IndicatorRecord[],
  dir: string,
  source: { id: string; url: string },
  definitions: Definition[],
): Promise<void> {
  const index = definitionsByTerm(definitions);
  const described = (f: Field) => describe(f, termFor(index, HCP_CONCEPT, f));
  await mkdir(dir, { recursive: true });

  for (const [level, file] of Object.entries(FILES) as [Level, string][]) {
    const rows = records.filter((r) => r.level === level);
    if (level === "commune") {
      // One file per région. All of them in one file comes to 34 MB for 2014, past the
      // 25 MB an asset store will serve and past what anyone wants for one commune.
      await rm(join(dir, `${file}.json`), { force: true });
      await mkdir(join(dir, file), { recursive: true });
      const byRegion = new Map<string, typeof rows>();
      for (const r of rows) {
        const region = regionOfCode(r.code!);
        byRegion.set(region, [...(byRegion.get(region) ?? []), r]);
      }
      for (const [region, inside] of [...byRegion].sort(([a], [b]) => a.localeCompare(b))) {
        await writeFile(join(dir, file, `${region}.json`), `${JSON.stringify(inside)}\n`);
      }
      continue;
    }
    const body = level === "country" ? rows[0] : rows;
    await writeFile(join(dir, `${file}.json`), `${JSON.stringify(body)}\n`);
  }

  await writeFile(
    join(dir, "fields.json"),
    `${JSON.stringify(
      {
        source,
        people: PEOPLE_FIELDS.map(described),
        households: HOUSEHOLD_FIELDS.map(described),
        notes: NOTES,
        definitions,
      },
      null,
      2,
    )}\n`,
  );

  const head = ["code", "code_digits", "level", "name_fr", "area"];
  const who = (r: IndicatorRecord) => [r.code, r.codeDigits, r.level, r.name.fr];

  const peopleRows: unknown[][] = [];
  for (const r of records) {
    for (const area of AREAS) {
      const block = r.people[area];
      if (!block) continue;
      for (const sex of SEXES) {
        peopleRows.push([...who(r), area, sex, ...PEOPLE_FIELDS.map((f) => block[sex][f.topic]?.[f.key] ?? null)]);
      }
    }
  }
  await writeFile(join(dir, "people.csv"), toCsv([...head, "sex", ...PEOPLE_FIELDS.map(columnOf)], peopleRows));

  const householdRows: unknown[][] = [];
  for (const r of records) {
    for (const area of AREAS) {
      const block = r.households[area];
      if (block) householdRows.push([...who(r), area, ...HOUSEHOLD_FIELDS.map((f) => block[f.topic]?.[f.key] ?? null)]);
    }
  }
  await writeFile(join(dir, "households.csv"), toCsv([...head, ...HOUSEHOLD_FIELDS.map(columnOf)], householdRows));
}
