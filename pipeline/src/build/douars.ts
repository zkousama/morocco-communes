import { HOUSEHOLD_FIELDS, PEOPLE_FIELDS, type DouarType } from "../sources/douarFields.ts";
import type { DouarRow } from "../sources/hcpDouars.ts";
import type { Topics } from "./indicators.ts";

/**
 * The douars, placed on the communes the dataset publishes.
 *
 * A douar's code starts with its commune's code less the région: 0510301201001 is province
 * 051, cercle 03, commune 01, fraction 201, douar 001, and lands on 01.051.03.01. Every
 * douar joins that way. The workbook's own Arabic name for the commune is kept out of the
 * join, since it spells a few of them differently from the population workbook.
 */

export interface DouarRecord {
  /** HCP's 13-digit code. */
  code: string;
  communeCode: string;
  /** The fraction (mashyakha) it's in, by its 10-digit code. */
  fraction: string;
  name: { ar: string };
  type: DouarType;
  households: number;
  population: number;
  /** Null where HCP withholds them, for a douar of fewer than 30 households. */
  topics: Topics | null;
}

export interface FractionRecord {
  code: string;
  communeCode: string;
  name: { ar: string };
  douars: number;
  households: number;
  population: number;
}

export interface Douars {
  douars: DouarRecord[];
  fractions: FractionRecord[];
}

interface Commune {
  code: string;
  codeDigits: string;
}

const nest = (people: (number | null)[], homes: (number | null)[]): Topics => {
  const out: Topics = {};
  PEOPLE_FIELDS.forEach((f, i) => ((out[f.topic] ??= {})[f.key] = people[i] ?? null));
  HOUSEHOLD_FIELDS.forEach((f, i) => ((out[f.topic] ??= {})[f.key] = homes[i] ?? null));
  return out;
};

export function buildDouars(rows: DouarRow[], communes: Commune[]): Douars {
  const byKey = new Map(communes.map((c) => [c.codeDigits.slice(2), c.code]));
  const problems: string[] = [];
  const seen = new Set<string>();
  const fractions = new Map<string, FractionRecord>();
  const douars: DouarRecord[] = [];

  for (const row of rows) {
    if (seen.has(row.code)) problems.push(`douar ${row.code} is listed twice`);
    seen.add(row.code);
    const communeCode = byKey.get(row.code.slice(0, 7));
    if (!communeCode) {
      problems.push(`douar ${row.code} ${row.name}: no commune carries the code ${row.code.slice(0, 7)}`);
      continue;
    }
    const fractionCode = row.code.slice(0, 10);
    const fraction = fractions.get(fractionCode);
    if (fraction && fraction.name.ar !== row.fraction) {
      problems.push(`fraction ${fractionCode} is both ${fraction.name.ar} and ${row.fraction}`);
    }
    const f = fraction ?? { code: fractionCode, communeCode, name: { ar: row.fraction }, douars: 0, households: 0, population: 0 };
    f.douars++;
    f.households += row.households;
    f.population += row.population;
    fractions.set(fractionCode, f);

    const withheld = row.people.every((v) => v === null) && row.homes.every((v) => v === null);
    douars.push({
      code: row.code,
      communeCode,
      fraction: fractionCode,
      name: { ar: row.name },
      type: row.type,
      households: row.households,
      population: row.population,
      topics: withheld ? null : nest(row.people, row.homes),
    });
  }

  if (problems.length > 0) throw new Error(`the douars don't land on the dataset cleanly:\n  ${problems.slice(0, 40).join("\n  ")}`);
  return { douars, fractions: [...fractions.values()] };
}
