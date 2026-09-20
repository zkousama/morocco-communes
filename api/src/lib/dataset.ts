/**
 * The API reads the published dataset, not the pipeline's internals, so these types name
 * only the keys the API groups, sorts or routes by. Records carry many more fields and
 * pass through whole: structural typing means adding a field to the dataset does not
 * touch this file.
 */
export interface RegionRow {
  code: string;
}

export interface ProvinceRow {
  code: string;
  regionCode: string;
}

export interface CercleRow {
  code: string;
  provinceCode: string;
  regionCode: string;
}

export interface CommuneRow {
  code: string;
  codeDigits: string;
  slug: string;
  type: "urban" | "rural";
  parents: { region: string; province: string; cercle: string | null };
}

export interface ArrondissementRow {
  code: string;
  communeCode: string;
}

/** A commune's neighbours, from the borders measured on the OpenStreetMap boundaries. */
export interface AdjacencyRow {
  code: string;
  neighbours: { code: string; km: number }[];
}

export interface Dataset {
  regions: RegionRow[];
  provinces: ProvinceRow[];
  cercles: CercleRow[];
  communes: CommuneRow[];
  arrondissements: ArrondissementRow[];
  adjacency: AdjacencyRow[];
  sources: unknown;
}

/** Groups by a key, skipping rows whose key is null, such as a commune with no cercle. */
export function groupBy<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
