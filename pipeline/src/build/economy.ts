import { ECONOMY_FIELDS } from "../sources/economyFields.ts";
import type { EstablishmentRow } from "../sources/hcpEstablishments.ts";
import { hcpCode, type IndicatorRecord, type Level, type Topics } from "./indicators.ts";
import { nameOf, similarity } from "./indicators2014.ts";

/**
 * The establishments, placed on the units the dataset publishes.
 *
 * The codes are the 2024 ones, so nearly every row joins by code. Casablanca's eight
 * préfectures d'arrondissements are the exception, as they are in the census workbooks:
 * this file writes them a digit shorter than the population file does, and the code it
 * gives the first of them is the one the commune of Casablanca carries, so those rows are
 * taken by their label. The six cities that hold arrondissements have no row here; each of
 * their arrondissements does.
 */

export interface EconomyRecord {
  /** Null for the country. */
  code: string | null;
  codeDigits: string | null;
  level: Level;
  name: { fr: string; ar: string | null };
  /** The commune an arrondissement belongs to. */
  communeCode?: string;
  /**
   * Set on the 6 cities the workbook has no row for: their figures are the exact sum of
   * their own arrondissements, the way the 2014 population is on the same 6.
   */
  basis?: "arrondissement_sum";
  topics: Topics;
}

export interface Unplaced {
  code: string;
  label: string;
  reason: string;
}

export interface Economy {
  records: EconomyRecord[];
  unplaced: Unplaced[];
}

/** The level labels this workbook writes that the census workbooks don't. */
const LABEL = /^(Commune Rurale|Municipalité|Arrondissement|Région)\s*:\s*/i;
/** Below this, two names are different places rather than two spellings of one. */
const SAME_PLACE = 0.5;
/** Written a digit shorter here than in the population file, so the code needs the digit back. */
const PREFECTURE_OF_ARRONDISSEMENTS = /^Préfecture d['’]Arrondissements?\s+/i;

const nest = (counts: (number | null)[]): Topics => {
  const out: Topics = {};
  ECONOMY_FIELDS.forEach((f, i) => {
    (out[f.topic] ??= {})[f.key] = counts[i] ?? null;
  });
  return out;
};

/** Two units' figures added field by field. Every figure the workbook holds is a count. */
const add = (into: Topics, from: Topics): Topics => {
  for (const f of ECONOMY_FIELDS) {
    const value = from[f.topic]?.[f.key];
    if (value === null || value === undefined) continue;
    (into[f.topic] ??= {})[f.key] = (into[f.topic]![f.key] ?? 0) + value;
  }
  return into;
};

export function buildEconomy(
  rows: EstablishmentRow[],
  records: IndicatorRecord[],
  /** Which city each arrondissement belongs to, as the dataset's own records give it. */
  cityOf: Map<string, string>,
): Economy {
  const byHcpCode = new Map<string, IndicatorRecord>();
  for (const r of records) {
    // An urban centre is part of its commune rather than a unit of its own, and this
    // workbook stops at the commune.
    if (r.codeDigits === null || r.level === "urbanCentre") continue;
    byHcpCode.set(hcpCode(r.codeDigits), r);
  }

  const out: EconomyRecord[] = [];
  const unplaced: Unplaced[] = [];
  const problems: string[] = [];
  const claimed = new Map<string, string>();

  for (const row of rows) {
    if (row.codeDigits === null) {
      out.push({ code: null, codeDigits: null, level: "country", name: { fr: "Maroc", ar: "المغرب" }, topics: nest(row.counts) });
      continue;
    }
    const code = row.codeDigits;
    const prefecture = PREFECTURE_OF_ARRONDISSEMENTS.test(row.label);
    const wanted = prefecture ? `${code}0` : code;
    const unit = byHcpCode.get(hcpCode(wanted));
    if (!unit) {
      unplaced.push({ code, label: row.label, reason: `no unit carries the code ${wanted}` });
      continue;
    }
    const name = nameOf(row.label.replace(LABEL, ""));
    if (similarity(unit.name.fr, name) < SAME_PLACE) {
      unplaced.push({ code, label: row.label, reason: `code ${unit.code} is ${unit.name.fr} in the dataset, a different name` });
      continue;
    }
    const already = claimed.get(unit.code!);
    if (already) {
      problems.push(`${unit.code} ${unit.name.fr} is claimed by both ${already} and ${code} ${row.label}`);
      continue;
    }
    claimed.set(unit.code!, `${code} ${row.label}`);
    out.push({
      code: unit.code,
      codeDigits: unit.codeDigits,
      level: unit.level,
      name: unit.name,
      ...(unit.communeCode ? { communeCode: unit.communeCode } : {}),
      topics: nest(row.counts),
    });
  }

  // The 6 cities divided into arrondissements have no row of their own, and every figure
  // here is a count, so each city's is the sum of its arrondissements exactly. Published
  // that way rather than left out, so a question about Casablanca has an answer that
  // doesn't depend on whoever asks adding 16 numbers up.
  const parts = new Map<string, EconomyRecord[]>();
  for (const r of out) {
    const city = r.level === "arrondissement" ? cityOf.get(r.code!) : undefined;
    if (!city) continue;
    parts.set(city, [...(parts.get(city) ?? []), r]);
  }
  for (const [code, arrondissements] of [...parts].sort(([a], [b]) => a.localeCompare(b))) {
    const city = records.find((r) => r.code === code);
    if (!city) {
      problems.push(`${code} has arrondissements but is not a unit of the dataset`);
      continue;
    }
    if (claimed.has(code)) {
      problems.push(`${code} ${city.name.fr} has a row of its own and arrondissements too`);
      continue;
    }
    out.push({
      code: city.code,
      codeDigits: city.codeDigits,
      level: city.level,
      name: city.name,
      basis: "arrondissement_sum",
      topics: arrondissements.reduce((into, a) => add(into, a.topics), {} as Topics),
    });
  }

  if (problems.length > 0) throw new Error(`the establishments don't land on the dataset cleanly:\n  ${problems.join("\n  ")}`);
  return { records: out, unplaced };
}
