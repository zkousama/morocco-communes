import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AREAS, SEXES } from "../sources/indicatorFields.ts";
import { HOUSEHOLD_FIELDS_2014, PEOPLE_FIELDS_2014, type Field2014 } from "../sources/indicator2014Fields.ts";
import type { IndicatorRecord, Level } from "../build/indicators.ts";
import type { Indicator2014Block, Unplaced2014 } from "../build/indicators2014.ts";
import { columnOf, pathOf } from "./indicators.ts";
import { toCsv } from "./csv.ts";

/** One unit's 2014 figures, under the code and name the 2024 census gives it. */
export interface Indicator2014Record {
  code: string | null;
  codeDigits: string | null;
  level: Level;
  name: { fr: string; ar: string | null };
  communeCode?: string;
  people: Indicator2014Block["people"];
  households: Indicator2014Block["households"];
}

const FILES: Record<Level, string> = {
  country: "national",
  region: "regions",
  province: "provinces",
  cercle: "cercles",
  commune: "communes",
  arrondissement: "arrondissements",
  urbanCentre: "urban-centres",
};

/** What the 2014 workbooks say about themselves, and what reading them across ten years costs. */
export const NOTES_2014 = {
  signs: [
    { sign: "-", meaning: "Nothing to report, such as the urban part of a rural commune, or a mother's fertility under Masculin", here: "null" },
    { sign: "", meaning: "The legal population, which the census publishes for the whole unit rather than its urban and rural parts", here: "null" },
  ],
  rounding: "The workbook carries the full division, 10.155696524579501 for 10.2. Each figure is rounded here to the decimal HCP's own tables stop at.",
  comparability:
    "A field with comparableTo measures what the 2024 field of that name measures, so the two subtract. A field with a note asked something else in 2014, and the note says what.",
  units:
    "Casablanca and the five other cities with arrondissements have no 2014 row of their own: the census published those cities by arrondissement, and each arrondissement is here. Thirteen cercles and one urban centre from 2014 have no unit to land on, and are listed in unplaced.json.",
};

const describe = (f: Field2014) => ({
  path: pathOf(f),
  column: columnOf(f),
  topic: f.topic,
  key: f.key,
  label: f.label,
  heading: f.heading,
  ...(f.category ? { category: f.category } : {}),
  unit: f.unit,
  ...(f.sexes.length > 0 ? { sexes: f.sexes } : {}),
  ...(f.comparableTo ? { comparableTo: f.comparableTo } : {}),
  ...(f.note ? { note: f.note } : {}),
});

/** The 2014 figures on the units that carry them, in the order the 2024 records come in. */
export function toRecords2014(records: IndicatorRecord[], blocks: Map<string, Indicator2014Block>): Indicator2014Record[] {
  const out: Indicator2014Record[] = [];
  for (const r of records) {
    const block = blocks.get(r.code ?? "");
    if (!block) continue;
    out.push({
      code: r.code,
      codeDigits: r.codeDigits,
      level: r.level,
      name: r.name,
      ...(r.communeCode ? { communeCode: r.communeCode } : {}),
      people: block.people,
      households: block.households,
    });
  }
  return out;
}

export async function writeIndicators2014(
  records: Indicator2014Record[],
  unplaced: Unplaced2014[],
  dir: string,
  source: { people: { id: string; url: string }; households: { id: string; url: string } },
): Promise<void> {
  await mkdir(dir, { recursive: true });

  for (const [level, file] of Object.entries(FILES) as [Level, string][]) {
    const rows = records.filter((r) => r.level === level);
    const body = level === "country" ? rows[0] ?? null : rows;
    await writeFile(join(dir, `${file}.json`), `${JSON.stringify(body)}\n`);
  }

  await writeFile(
    join(dir, "fields.json"),
    `${JSON.stringify({ census: "2014", source, people: PEOPLE_FIELDS_2014.map(describe), households: HOUSEHOLD_FIELDS_2014.map(describe), notes: NOTES_2014 }, null, 2)}\n`,
  );

  await writeFile(join(dir, "unplaced.json"), `${JSON.stringify(unplaced, null, 2)}\n`);

  const head = ["code", "code_digits", "level", "name_fr", "area"];
  const who = (r: Indicator2014Record) => [r.code, r.codeDigits, r.level, r.name.fr];

  const peopleRows: unknown[][] = [];
  for (const r of records) {
    for (const area of AREAS) {
      const block = r.people[area];
      if (!block) continue;
      for (const sex of SEXES) {
        peopleRows.push([...who(r), area, sex, ...PEOPLE_FIELDS_2014.map((f) => block[sex][f.topic]?.[f.key] ?? null)]);
      }
    }
  }
  await writeFile(join(dir, "people.csv"), toCsv([...head, "sex", ...PEOPLE_FIELDS_2014.map(columnOf)], peopleRows));

  const householdRows: unknown[][] = [];
  for (const r of records) {
    for (const area of AREAS) {
      const block = r.households[area];
      if (block) householdRows.push([...who(r), area, ...HOUSEHOLD_FIELDS_2014.map((f) => block[f.topic]?.[f.key] ?? null)]);
    }
  }
  await writeFile(join(dir, "households.csv"), toCsv([...head, ...HOUSEHOLD_FIELDS_2014.map(columnOf)], householdRows));
}
