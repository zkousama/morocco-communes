/**
 * What a census says about a unit, gathered from every workbook HCP publishes it in.
 *
 * The indicators workbook is the bulk of it; commuting comes in a workbook of its own for
 * each census, and 2014 puts professions and diplomas in two more, all with the same units
 * in the same order. The rows are joined here, at the
 * source, so everything downstream, the join to the dataset, the checks, the files and
 * the API, sees one census with one field list rather than several.
 */

import { HOUSEHOLD_FIELDS, PEOPLE_FIELDS, type Field, type Sex } from "./indicatorFields.ts";
import { HOUSEHOLD_FIELDS_2014, PEOPLE_FIELDS_2014, type Field2014 } from "./indicator2014Fields.ts";
import { COMMUTE_FIELDS_2024, MOBILITY_FIELDS_2014 } from "./mobilityFields.ts";
import { PROFESSION_FIELDS_2014 } from "./professionFields.ts";
import { DIPLOMA_FIELDS_2014 } from "./diplomaFields.ts";
import type { IndicatorRow } from "./hcpIndicators.ts";
import type { Indicator2014Row } from "./hcp2014Indicators.ts";
import type { MobilityRow } from "./hcpMobility.ts";

/** Every people field of the 2024 census, indicators then commuting. */
export const PEOPLE_FIELDS_ALL: Field[] = [...PEOPLE_FIELDS, ...(COMMUTE_FIELDS_2024 as Field[])];
export const HOUSEHOLD_FIELDS_ALL: Field[] = HOUSEHOLD_FIELDS;

/** Every people field of the 2014 census: indicators, mobility, professions, diplomas. */
export const PEOPLE_FIELDS_2014_ALL: Field2014[] = [
  ...PEOPLE_FIELDS_2014,
  ...MOBILITY_FIELDS_2014,
  ...PROFESSION_FIELDS_2014,
  ...DIPLOMA_FIELDS_2014,
];
export const HOUSEHOLD_FIELDS_2014_ALL: Field2014[] = HOUSEHOLD_FIELDS_2014;

/** One sex's columns, in the order the cells come in. */
export const peopleColumnsAll = (sex: Sex) => PEOPLE_FIELDS_ALL.filter((f) => f.sexes.includes(sex));
export const peopleColumns2014All = (sex: Sex) => PEOPLE_FIELDS_2014_ALL.filter((f) => f.sexes.includes(sex));

const SEXES: Sex[] = ["all", "male", "female"];
const AREAS = ["total", "urban", "rural"] as const;

/**
 * Puts one workbook's cells after another's, row by row. Both list the same units in the
 * same order, which is checked here by code before anything is joined: a row out of place
 * would put one commune's figures on another.
 */
function join<T extends { codeDigits?: string | null; code?: string | null; people: MobilityRow["people"] }>(
  rows: T[],
  mobility: MobilityRow[],
  codeOf: (row: T) => string | null,
): T[] {
  if (rows.length !== mobility.length) {
    throw new Error(`the commuting workbook has ${mobility.length} rows, the indicators workbook ${rows.length}`);
  }
  return rows.map((row, i) => {
    const other = mobility[i]!;
    const here = codeOf(row);
    const there = other.codeDigits === null ? null : String(Number(other.codeDigits));
    if (here !== there) throw new Error(`row ${i}: the indicators workbook has ${here}, the commuting workbook ${there}`);
    return {
      ...row,
      people: Object.fromEntries(
        AREAS.map((area) => [
          area,
          Object.fromEntries(SEXES.map((sex) => [sex, [...row.people[area][sex], ...other.people[area][sex]]])),
        ]),
      ) as MobilityRow["people"],
    };
  });
}

/** The 2024 census: indicator rows with each unit's commuting after them. */
export const joinCensus2024 = (rows: IndicatorRow[], commute: MobilityRow[]): IndicatorRow[] =>
  join(rows, commute, (row) => row.code);

/**
 * The 2014 census: indicator rows with each unit's mobility, professions and diplomas
 * after them, in the order `PEOPLE_FIELDS_2014_ALL` lists the fields.
 */
export const joinCensus2014 = (rows: Indicator2014Row[], ...workbooks: MobilityRow[][]): Indicator2014Row[] =>
  workbooks.reduce<Indicator2014Row[]>((so, next) => join(so, next, (row) => (row.codeDigits === null ? null : String(Number(row.codeDigits)))), rows);
