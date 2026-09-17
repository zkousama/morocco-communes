import { toDotted } from "../lib/codes.ts";
import { slugify } from "../lib/slug.ts";
import type { Hcp2014Unit } from "../sources/hcp2014.ts";

export type MatchMethod = "exact_name_in_province" | "sole_remaining_in_province";

export interface CrosswalkRow {
  code2024: string;
  codeDigits2024: string;
  code2014: string;
  name2024: string;
  name2014: string;
  method: MatchMethod;
  evidence: {
    province: string;
    normalisedNameMatch: boolean;
    candidatesInProvince: number;
    population2024: number | null;
    population2014: number | null;
    populationRatio: number | null;
  };
}

interface CommuneLike {
  code: string;
  codeDigits: string;
  name: { fr: string };
  population: { "2024": { total: number | null } };
}

/** The province is the first five digits, and it is stable across both censuses. */
const provinceOf = (codeDigits: string) => codeDigits.slice(0, 5);

/** The 2014 workbook marks municipalities and sometimes shouts. Compare on neither. */
const compareName = (name: string) =>
  slugify(name.replace(/\s*\(Mun\.\)\s*$/i, "")).replace(/-/g, "");

function ratio(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return Number((now / before).toFixed(4));
}

export function buildCrosswalk(
  unresolved: CommuneLike[],
  unclaimed: Hcp2014Unit[],
): { rows: CrosswalkRow[]; unmatched2024: string[]; unmatched2014: string[] } {
  const rows: CrosswalkRow[] = [];
  const taken = new Set<string>();
  const done = new Set<string>();

  const row = (c: CommuneLike, u: Hcp2014Unit, method: MatchMethod, candidates: number): CrosswalkRow => ({
    code2024: c.code,
    codeDigits2024: c.codeDigits,
    code2014: toDotted(u.codeDigits, u.codeDigits.slice(0, 5)),
    name2024: c.name.fr,
    name2014: u.nameFr.replace(/\s*\(Mun\.\)\s*$/i, "").trim(),
    method,
    evidence: {
      province: provinceOf(c.codeDigits),
      normalisedNameMatch: compareName(u.nameFr) === compareName(c.name.fr),
      candidatesInProvince: candidates,
      population2024: c.population["2024"].total,
      population2014: u.population,
      populationRatio: ratio(c.population["2024"].total, u.population),
    },
  });

  // Pass 1: an identical normalised name, unique within the province. Both passes walk
  // the arrays in the order given, so the result depends on the input alone.
  for (const c of unresolved) {
    const hits = unclaimed.filter(
      (u) =>
        !taken.has(u.codeDigits) &&
        provinceOf(u.codeDigits) === provinceOf(c.codeDigits) &&
        compareName(u.nameFr) === compareName(c.name.fr),
    );
    if (hits.length === 1) {
      taken.add(hits[0]!.codeDigits);
      done.add(c.codeDigits);
      rows.push(row(c, hits[0]!, "exact_name_in_province", 1));
    }
  }

  // Pass 2: the name spellings differ, but only one unit is left in that province, so
  // the bijection forces the pairing. Recorded as its own method because it rests on
  // exhaustion rather than on the names agreeing.
  for (const c of unresolved) {
    if (done.has(c.codeDigits)) continue;
    const pool = unclaimed.filter(
      (u) => !taken.has(u.codeDigits) && provinceOf(u.codeDigits) === provinceOf(c.codeDigits),
    );
    if (pool.length === 1) {
      taken.add(pool[0]!.codeDigits);
      done.add(c.codeDigits);
      rows.push(row(c, pool[0]!, "sole_remaining_in_province", 1));
    }
  }

  return {
    rows,
    unmatched2024: unresolved.filter((c) => !done.has(c.codeDigits)).map((c) => c.code),
    unmatched2014: unclaimed.filter((u) => !taken.has(u.codeDigits)).map((u) => u.codeDigits),
  };
}
