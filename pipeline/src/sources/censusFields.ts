/**
 * What a census says about a unit, gathered from every workbook HCP publishes it in.
 *
 * The indicators workbook is the bulk of it; commuting comes in a workbook of its own for
 * each census, with the same units in the same order. The rows are joined here, at the
 * source, so everything downstream — the join to the dataset, the checks, the files, the
 * API — sees one census with one field list rather than several.
 */

import { HOUSEHOLD_FIELDS, PEOPLE_FIELDS, type Field, type Sex } from "./indicatorFields.ts";
import { HOUSEHOLD_FIELDS_2014, PEOPLE_FIELDS_2014, type Field2014 } from "./indicator2014Fields.ts";
import { COMMUTE_FIELDS_2024, MOBILITY_FIELDS_2014 } from "./mobilityFields.ts";
import type { IndicatorRow } from "./hcpIndicators.ts";
import type { Indicator2014Row } from "./hcp2014Indicators.ts";
import type { MobilityRow } from "./hcpMobility.ts";

/** Every people field of the 2024 census, indicators then commuting. */
export const PEOPLE_FIELDS_ALL: Field[] = [...PEOPLE_FIELDS, ...(COMMUTE_FIELDS_2024 as Field[])];
export const HOUSEHOLD_FIELDS_ALL: Field[] = HOUSEHOLD_FIELDS;

/** Every people field of the 2014 census, indicators then mobility. */
export const PEOPLE_FIELDS_2014_ALL: Field2014[] = [...PEOPLE_FIELDS_2014, ...MOBILITY_FIELDS_2014];
export const HOUSEHOLD_FIELDS_2014_ALL: Field2014[] = HOUSEHOLD_FIELDS_2014;

/** One sex's columns, in the order the cells come in. */
export const peopleColumnsAll = (sex: Sex) => PEOPLE_FIELDS_ALL.filter((f) => f.sexes.includes(sex));
export const peopleColumns2014All = (sex: Sex) => PEOPLE_FIELDS_2014_ALL.filter((f) => f.sexes.includes(sex));

const SEXES: Sex[] = ["all", "male", "female"];
const AREAS = ["total", "urban", "rural"] as const;

/**
 * Puts a commuting workbook's cells after an indicators workbook's, row by row. Both list
 * the same units in the same order, which is checked here by code before anything is
 * joined: a row out of place would put one commune's commuting on another.
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

/** The 2014 census: indicator rows with each unit's mobility after them. */
export const joinCensus2014 = (rows: Indicator2014Row[], mobility: MobilityRow[]): Indicator2014Row[] =>
  join(rows, mobility, (row) => (row.codeDigits === null ? null : String(Number(row.codeDigits))));
