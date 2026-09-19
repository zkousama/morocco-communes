import { slugify } from "../lib/slug.ts";
import { AREAS, SEXES, type Area, type Sex } from "../sources/indicatorFields.ts";
import { type Indicator2014Row } from "../sources/hcp2014Indicators.ts";
import { HOUSEHOLD_FIELDS_2014_ALL, peopleColumns2014All } from "../sources/censusFields.ts";
import { applicable, hcpCode, nest, type IndicatorRecord, type Topics } from "./indicators.ts";

/**
 * The 2014 indicators, placed on the units the dataset publishes today.
 *
 * Most rows join by code. A commune whose code changed joins through the crosswalk, an
 * urban centre by name inside the commune it sits in, and Casablanca's eight préfectures
 * d'arrondissements by their label: the 2024 workbook gives them a digit more than 2014
 * did, and the code 2014 gives the first of them is the one 2024 gives the commune of
 * Casablanca, so reading their code would put Anfa's figures on the whole city. Communes
 * that merged and cercles that were redrawn have no unit to land on, and come back as
 * unplaced.
 */

export interface Indicator2014Block {
  people: Record<Area, Record<Sex, Topics> | null>;
  households: Record<Area, Topics | null>;
}

export interface Unplaced2014 {
  code: string;
  label: string;
  reason: string;
}

export interface Indicators2014 {
  /** Keyed by the 2024 code the row lands on; the country's key is the empty string. */
  byCode: Map<string, Indicator2014Block>;
  unplaced: Unplaced2014[];
  /** Matches the names argue against and the population workbook settles. */
  renamed: { code: string; name2014: string; name2024: string }[];
}

const PREFECTURE_OF_ARRONDISSEMENTS = /^Préfecture d['’]Arrondissements?\s+/i;
const URBAN_CENTRE = /^Dont Centre\s*:\s*/i;
const LABEL = /^(Cercle|Province|Préfecture)\s*:\s*/i;
const MUNICIPALITY = /\s*\((Mun|Arrond)\.\)\s*$/i;

/** The name HCP prints, without the level label, the municipality mark or the footnote. */
export const nameOf = (label: string) =>
  label
    .replace(URBAN_CENTRE, "")
    .replace(PREFECTURE_OF_ARRONDISSEMENTS, "")
    .replace(LABEL, "")
    .replace(MUNICIPALITY, "")
    .replace(/\*+$/, "")
    .trim();

const trigrams = (name: string) => {
  const padded = ` ${slugify(name).replace(/-/g, "")} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
};

/**
 * How close two spellings of a place are, 0 to 1. Transliteration moves between the
 * censuses — Rhafsai is Ghafsai, My Driss Aghbal is Moulay Driss Aghbal — so a match
 * can't ask for the same string, and this says how far it is being asked to stretch.
 */
export function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared++;
  return (2 * shared) / (left.size + right.size);
}

/** Below this, two names are different places rather than two spellings of one. */
const SAME_PLACE = 0.5;

/** The legal population the row carries, which the population workbook publishes too. */
const legalPopulation = (row: Indicator2014Row): number | null => {
  const cell = row.people.total.all[peopleColumns2014All("all").findIndex((f) => f.topic === "population" && f.key === "legal")];
  return typeof cell === "number" ? cell : null;
};

const blockOf = (row: Indicator2014Row): Indicator2014Block => ({
  people: Object.fromEntries(
    AREAS.map((area) => {
      const blocks = SEXES.map((sex) => [sex, row.people[area][sex]] as const);
      if (!blocks.some(([, cells]) => applicable(cells))) return [area, null];
      return [area, Object.fromEntries(blocks.map(([sex, cells]) => [sex, nest(peopleColumns2014All(sex), cells)]))];
    }),
  ) as Indicator2014Block["people"],
  households: Object.fromEntries(
    AREAS.map((area) => [area, applicable(row.households[area]) ? nest(HOUSEHOLD_FIELDS_2014_ALL, row.households[area]) : null]),
  ) as Indicator2014Block["households"],
});

export function buildIndicators2014(
  rows: Indicator2014Row[],
  records: IndicatorRecord[],
  /** The crosswalk, from the 2014 code's digits to the 2024 code. */
  crosswalk: Map<string, string>,
  /** Each unit's 2014 population as the population workbook gives it, by 2024 code. */
  published2014: Map<string, number | null>,
): Indicators2014 {
  const byHcpCode = new Map<string, IndicatorRecord>();
  const byCode2024 = new Map<string, IndicatorRecord>();
  const centresByCommune = new Map<string, IndicatorRecord[]>();
  for (const r of records) {
    if (r.codeDigits === null) continue;
    byCode2024.set(r.code!, r);
    if (r.level === "urbanCentre") {
      centresByCommune.set(r.communeCode!, [...(centresByCommune.get(r.communeCode!) ?? []), r]);
      continue;
    }
    byHcpCode.set(hcpCode(r.codeDigits), r);
  }

  const byCode = new Map<string, Indicator2014Block>();
  const unplaced: Unplaced2014[] = [];
  const renamed: Indicators2014["renamed"] = [];
  const problems: string[] = [];
  const claimed = new Map<string, string>();

  const place = (row: Indicator2014Row, target: IndicatorRecord) => {
    const already = claimed.get(target.code!);
    if (already) {
      problems.push(`${target.code} ${target.name.fr} is claimed by both ${already} and ${row.codeDigits} ${row.label}`);
      return;
    }
    claimed.set(target.code!, `${row.codeDigits} ${row.label}`);
    byCode.set(target.code!, blockOf(row));
  };

  for (const row of rows) {
    if (row.codeDigits === null) {
      byCode.set("", blockOf(row));
      continue;
    }
    const code = row.codeDigits;
    const name = nameOf(row.label);

    if (PREFECTURE_OF_ARRONDISSEMENTS.test(row.label)) {
      const prefecture = byHcpCode.get(hcpCode(`${code}0`));
      if (!prefecture) {
        unplaced.push({ code, label: row.label, reason: `no 2024 unit carries the code ${code}0` });
        continue;
      }
      if (similarity(prefecture.name.fr, name) < SAME_PLACE) {
        unplaced.push({ code, label: row.label, reason: `code ${prefecture.code} is ${prefecture.name.fr} in 2024, a different name` });
        continue;
      }
      place(row, prefecture);
      continue;
    }

    if (URBAN_CENTRE.test(row.label)) {
      const communeDigits = code.slice(0, 9);
      const commune = byHcpCode.get(hcpCode(communeDigits)) ?? byCode2024.get(crosswalk.get(communeDigits) ?? "");
      if (!commune || commune.level !== "commune") {
        unplaced.push({ code, label: row.label, reason: `its commune ${communeDigits} has no 2024 unit` });
        continue;
      }
      const centres = centresByCommune.get(commune.code!) ?? [];
      const best = centres
        .map((c) => ({ centre: c, score: similarity(c.name.fr, name) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!best || best.score < SAME_PLACE) {
        unplaced.push({
          code,
          label: row.label,
          reason: `${commune.name.fr} lists no urban centre by that name in 2024${best ? `, the closest being ${best.centre.name.fr}` : ""}`,
        });
        continue;
      }
      place(row, best.centre);
      continue;
    }

    const target = byHcpCode.get(hcpCode(code)) ?? byCode2024.get(crosswalk.get(code) ?? "");
    if (!target) {
      unplaced.push({ code, label: row.label, reason: "no 2024 unit carries this code" });
      continue;
    }
    const score = similarity(target.name.fr, name);
    if (score < SAME_PLACE) {
      // A spelling can move further than the threshold allows and still be the same
      // place: Ouartzagh is written Ourtzarh in 2024. The population workbook is a
      // separate file that was joined to this unit on its own, so when it gives the
      // unit the population this row carries, the two files are describing one place
      // and the name is the only thing that changed.
      const population = published2014.get(target.code!);
      const legal = legalPopulation(row);
      if (population === null || population === undefined || legal === null || population !== legal) {
        unplaced.push({ code, label: row.label, reason: `code ${target.code} is ${target.name.fr} in 2024, a different name` });
        continue;
      }
      renamed.push({ code: target.code!, name2014: name, name2024: target.name.fr });
    }
    place(row, target);
  }

  if (problems.length > 0) throw new Error(`the 2014 indicators don't land on the dataset cleanly:\n  ${problems.join("\n  ")}`);
  return { byCode, unplaced, renamed };
}
