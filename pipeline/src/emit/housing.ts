import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HCP_CONCEPT, HOUSING_FIELDS, type HousingField } from "../sources/housingFields.ts";
import { definitionsByTerm, termFor, type Definition } from "../sources/hcpDefinitions.ts";
import type { Housing, HousingRecord } from "../build/housing.ts";
import type { Level } from "../build/indicators.ts";
import { snake } from "./indicators.ts";
import { toCsv } from "./csv.ts";

/** A field's column in the CSV and its path in the API: type_slum, and type.slum. */
export const columnOf = (f: HousingField) => `${snake(f.topic)}_${snake(f.key)}`;
export const pathOf = (f: HousingField) => `${f.topic}.${f.key}`;

const FILES: Partial<Record<Level, string>> = {
  country: "national",
  region: "regions",
  province: "provinces",
  cercle: "cercles",
  commune: "communes",
  arrondissement: "arrondissements",
  urbanCentre: "urban-centres",
};

/** What the workbook counts, and what it leaves out. */
export const NOTES = {
  counted: "The urban dwellings of each unit, counted at the 2024 census: a place built or converted to be lived in, whether or not anyone lives in it.",
  dwellingsNotHouseholds:
    "A dwelling, not a household. The census indicators in ../indicators/ describe the dwelling each household lives in; a vacant flat is here and in no household's record.",
  urbanOnly: "Urban only. A unit with no urban area has no record here, and a unit's figures cover its urban part rather than all of it.",
  shares: "Every figure but the count of dwellings is a percentage of that unit's urban dwellings, to one decimal.",
  gaps: "Null is a figure the workbook leaves out, which it writes as `_`. The age of the dwellings by type is left that way for most units.",
  deficit: "dwellings.deficitRate is HCP's quantitative housing shortfall: the households living in unsound dwellings, plus the households beyond the sound shared dwellings they occupy, over the sound dwellings that are occupied or vacant. Households on top, dwellings underneath, so it passes 100% where the shortfall is larger than the sound stock.",
};

const describe = (f: HousingField, term: string | null) => ({
  path: pathOf(f),
  column: columnOf(f),
  topic: f.topic,
  key: f.key,
  label: f.label,
  heading: f.heading,
  unit: f.unit,
  ...(term ? { definedAs: term } : {}),
});

export async function writeHousing(
  housing: Housing,
  dir: string,
  source: { id: string; url: string },
  definitions: Definition[],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const index = definitionsByTerm(definitions);
  const { records, unplaced, withoutStock } = housing;

  for (const [level, file] of Object.entries(FILES) as [Level, string][]) {
    const rows = records.filter((r) => r.level === level);
    const body = level === "country" ? rows[0] ?? null : rows;
    await writeFile(join(dir, `${file}.json`), `${JSON.stringify(body)}\n`);
  }

  await writeFile(
    join(dir, "fields.json"),
    `${JSON.stringify(
      {
        census: "2024",
        source,
        fields: HOUSING_FIELDS.map((f) => describe(f, termFor(index, HCP_CONCEPT, f))),
        notes: NOTES,
        definitions,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(dir, "unplaced.json"),
    `${JSON.stringify({ rows: unplaced, unitsWithoutUrbanDwellings: withoutStock }, null, 2)}\n`,
  );

  const head = ["code", "code_digits", "level", "name_fr", ...HOUSING_FIELDS.map(columnOf)];
  const rows = records.map((r: HousingRecord) => [
    r.code,
    r.codeDigits,
    r.level,
    r.name.fr,
    ...HOUSING_FIELDS.map((f) => r.topics[f.topic]?.[f.key] ?? null),
  ]);
  await writeFile(join(dir, "dwellings.csv"), toCsv(head, rows));
}
