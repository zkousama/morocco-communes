import { HOUSING_FIELDS } from "../sources/housingFields.ts";
import type { HousingRow } from "../sources/hcpHousing.ts";
import { hcpCode, type IndicatorRecord, type Level, type Topics } from "./indicators.ts";
import { nameOf, similarity } from "./indicators2014.ts";

/**
 * The urban housing stock, placed on the units the dataset publishes.
 *
 * The workbook lists the same units as the 2024 indicators, in the same order, under the
 * same codes with their leading zeros dropped, so every row joins by code. A unit with no
 * urban area has a row of nothing, and gets no record here: the absence says it as well
 * as 55 nulls would.
 */

export interface HousingRecord {
  /** Null for the country. */
  code: string | null;
  codeDigits: string | null;
  level: Level;
  name: { fr: string; ar: string | null };
  /** The commune an urban centre or an arrondissement belongs to. */
  communeCode?: string;
  topics: Topics;
}

export interface Housing {
  records: HousingRecord[];
  /** Rows that carry figures and have no unit to land on. */
  unplaced: { code: string; label: string; reason: string }[];
  /** Units whose row is empty, which is a unit with no urban dwellings. */
  withoutStock: number;
}

/** The level labels this workbook writes in front of a name, longest first. */
const PREFECTURE_OF_ARRONDISSEMENTS = /^Préfecture d['’]arrondissements?\s+(de\s+l['’]|de\s+la\s+|de\s+|du\s+|des\s+|d['’])?/i;
const LABEL = /^(Commune|Arrondissement|Cercle|Province|Préfecture|Région)\s+(de\s+l['’]|de\s+la\s+|de\s+|du\s+|des\s+|d['’])?/i;
const URBAN_CENTRE = /^dont le centre urbain\s+(de\s+l'|de\s+la\s+|de\s+|du\s+|des\s+|d')?/i;
/** Below this, two names are different places rather than two spellings of one. */
const SAME_PLACE = 0.5;

const nest = (figures: (number | null)[]): Topics => {
  const out: Topics = {};
  HOUSING_FIELDS.forEach((f, i) => {
    (out[f.topic] ??= {})[f.key] = figures[i] ?? null;
  });
  return out;
};

export function buildHousing(rows: HousingRow[], records: IndicatorRecord[]): Housing {
  const byHcpCode = new Map<string, IndicatorRecord>();
  for (const r of records) {
    if (r.codeDigits === null) continue;
    byHcpCode.set(hcpCode(r.codeDigits), r);
  }

  const out: HousingRecord[] = [];
  const unplaced: Housing["unplaced"] = [];
  const problems: string[] = [];
  const claimed = new Map<string, string>();
  let withoutStock = 0;

  for (const row of rows) {
    const empty = row.figures.every((f) => f === null);
    if (row.code === null) {
      if (!empty) out.push({ code: null, codeDigits: null, level: "country", name: { fr: "Maroc", ar: "المغرب" }, topics: nest(row.figures) });
      continue;
    }
    if (empty) {
      withoutStock++;
      continue;
    }
    const unit = byHcpCode.get(hcpCode(row.code));
    if (!unit) {
      unplaced.push({ code: row.code, label: row.label, reason: `no unit carries the code ${row.code}` });
      continue;
    }
    const name = nameOf(row.label.replace(URBAN_CENTRE, "").replace(PREFECTURE_OF_ARRONDISSEMENTS, "").replace(LABEL, ""));
    if (similarity(unit.name.fr, name) < SAME_PLACE) {
      unplaced.push({ code: row.code, label: row.label, reason: `code ${unit.code} is ${unit.name.fr} in the dataset, a different name` });
      continue;
    }
    const already = claimed.get(unit.code!);
    if (already) {
      problems.push(`${unit.code} ${unit.name.fr} is claimed by both ${already} and ${row.code} ${row.label}`);
      continue;
    }
    claimed.set(unit.code!, `${row.code} ${row.label}`);
    out.push({
      code: unit.code,
      codeDigits: unit.codeDigits,
      level: unit.level,
      name: unit.name,
      ...(unit.communeCode ? { communeCode: unit.communeCode } : {}),
      topics: nest(row.figures),
    });
  }

  if (problems.length > 0) throw new Error(`the housing stock doesn't land on the dataset cleanly:\n  ${problems.join("\n  ")}`);
  return { records: out, unplaced, withoutStock };
}
