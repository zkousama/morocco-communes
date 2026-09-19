import {
  AREAS,
  HOUSEHOLD_FIELDS,
  SEXES,
  peopleColumns,
  type Area,
  type Cell,
  type Field,
  type IndicatorRow,
  type Sex,
} from "../sources/hcpIndicators.ts";

export type Level = "country" | "region" | "province" | "cercle" | "commune" | "arrondissement" | "urbanCentre";

/** A topic's figures, by key. Null where HCP prints "…" or ".". */
export type Topics = Record<string, Record<string, number | null>>;

export interface IndicatorRecord {
  /** Null for the country. An urban centre's is its commune's code and one more digit. */
  code: string | null;
  codeDigits: string | null;
  level: Level;
  name: { fr: string; ar: string | null };
  /** The commune an urban centre sits in. */
  communeCode?: string;
  /**
   * HCP's asterisk: the figures were collected from the local administration, because the
   * population moves with the seasons. Only the population counts are published for these.
   */
  fromLocalAdministration: boolean;
  /** Each area the unit has: urban or rural is null where the unit has none of it. */
  people: Record<Area, Record<Sex, Topics> | null>;
  households: Record<Area, Topics | null>;
}

interface Named {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
}

export interface Units {
  regions: Named[];
  provinces: Named[];
  cercles: Named[];
  communes: (Named & { urbanCentres: { name: string; population: number | null }[] })[];
  arrondissements: Named[];
}

/** HCP writes a code without its leading zeros. */
export const hcpCode = (codeDigits: string) => String(Number(codeDigits));

const nest = (fields: Field[], cells: Cell[]): Topics => {
  const out: Topics = {};
  fields.forEach((f, i) => {
    const cell = cells[i]!;
    (out[f.topic] ??= {})[f.key] = typeof cell === "number" ? cell : null;
  });
  return out;
};

const applicable = (cells: Cell[]) => cells.some((c) => c !== "n/a");

const URBAN_CENTRE = /^dont le centre urbain\s+(de\s+la\s+|de\s+l['’]|de\s+|du\s+|des\s+|d['’])?/i;

/**
 * Joins HCP's indicator rows to the dataset's units by code, and each urban centre to its
 * commune by the code's first nine digits. Throws on a row it can't place, or a unit left
 * without a row, so the files can't quietly cover less than the dataset does.
 */
export function buildIndicators(rows: IndicatorRow[], units: Units): IndicatorRecord[] {
  const byCode = new Map<string, { level: Level; unit: Named }>();
  const add = (level: Level, list: Named[]) => {
    for (const unit of list) byCode.set(hcpCode(unit.codeDigits), { level, unit });
  };
  add("region", units.regions);
  add("province", units.provinces);
  add("cercle", units.cercles);
  add("commune", units.communes);
  add("arrondissement", units.arrondissements);
  const communeByDigits = new Map(units.communes.map((c) => [c.codeDigits, c]));

  const problems: string[] = [];
  const seen = new Set<string>();
  const records: IndicatorRecord[] = [];

  for (const row of rows) {
    const people = Object.fromEntries(
      AREAS.map((area) => {
        const blocks = SEXES.map((sex) => [sex, row.people[area][sex]] as const);
        if (!blocks.some(([, cells]) => applicable(cells))) return [area, null];
        return [area, Object.fromEntries(blocks.map(([sex, cells]) => [sex, nest(peopleColumns(sex), cells)]))];
      }),
    ) as IndicatorRecord["people"];
    const households = Object.fromEntries(
      AREAS.map((area) => [area, applicable(row.households[area]) ? nest(HOUSEHOLD_FIELDS, row.households[area]) : null]),
    ) as IndicatorRecord["households"];
    const fromLocalAdministration = row.label.endsWith("*");

    if (row.code === null) {
      records.push({
        code: null,
        codeDigits: null,
        level: "country",
        name: { fr: "Maroc", ar: "المغرب" },
        fromLocalAdministration,
        people,
        households,
      });
      continue;
    }

    const known = byCode.get(row.code);
    if (known) {
      seen.add(row.code);
      records.push({
        code: known.unit.code,
        codeDigits: known.unit.codeDigits,
        level: known.level,
        name: known.unit.name,
        fromLocalAdministration,
        people,
        households,
      });
      continue;
    }

    if (!URBAN_CENTRE.test(row.label)) {
      problems.push(`row ${row.code} ${row.label} matches no unit in the dataset`);
      continue;
    }
    const digits = row.code.padStart(10, "0");
    const commune = communeByDigits.get(digits.slice(0, 9));
    const name = row.label.replace(URBAN_CENTRE, "").replace(/\*+$/, "").trim();
    if (!commune) {
      problems.push(`urban centre ${row.code} ${name} has no commune ${digits.slice(0, 9)}`);
      continue;
    }
    // The centre the commune's own record lists, with the same population, so the code
    // and the name are known to point at the same place.
    const legal = people.total?.all.population?.legal ?? null;
    const listed = commune.urbanCentres.find((u) => u.name === name);
    if (!listed) problems.push(`urban centre ${row.code} ${name} isn't listed under ${commune.name.fr}`);
    else if (listed.population !== legal) problems.push(`urban centre ${name}: ${legal} here, ${listed.population} in the commune's record`);
    records.push({
      code: `${commune.code}.${digits.slice(9)}`,
      codeDigits: digits,
      level: "urbanCentre",
      name: { fr: name, ar: null },
      communeCode: commune.code,
      fromLocalAdministration,
      people,
      households,
    });
  }

  for (const [code, { level, unit }] of byCode) {
    if (!seen.has(code)) problems.push(`${level} ${unit.code} ${unit.name.fr} has no indicator row`);
  }
  const centres = records.filter((r) => r.level === "urbanCentre").length;
  const listed = units.communes.reduce((n, c) => n + c.urbanCentres.length, 0);
  if (centres !== listed) problems.push(`${centres} urban centres have indicators, the communes list ${listed}`);

  if (problems.length > 0) throw new Error(`the indicators don't line up with the dataset:\n  ${problems.join("\n  ")}`);
  return records;
}

export type { Area, Sex };
