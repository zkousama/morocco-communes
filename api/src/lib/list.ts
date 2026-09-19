import { paginate, type Envelope, type PageMeta } from "./envelope.ts";
import { PAGE, PER_PAGE, POPULATION } from "./params.ts";
import { aliasPath, resolve, withArticle, type FilterQuery, type Lookup, type SortKey } from "./resolve.ts";

/** Reads a pre-rendered file as JSON, or null when there is no such file. */
export type FetchJson = (path: string) => Promise<Envelope<unknown[]> | null>;

/** The fields of a commune record that lists filter and sort by. Records carry many more. */
export interface ListedCommune {
  code: string;
  name: { fr: string };
  type: string;
  parents: { region: string; province: string; cercle: string | null };
  population: { "2024": { total: number | null }; change: { pct: number } | null };
  areaKm2: number | null;
  density: number | null;
}

export interface FilterInput {
  region?: string;
  province?: string;
  cercle?: string;
  type?: string;
  sort?: string;
  minPopulation?: number;
  maxPopulation?: number;
  page?: number;
}

export type FilterError = { kind: "invalid-code" | "not-found" | "invalid-query"; detail: string };

export const SORT_KEYS = ["code", "name", "population", "change", "density", "area"] as const;

/** Every value `sort` takes: a field for ascending, the same with a minus for descending. */
export const SORTS: string[] = SORT_KEYS.flatMap((k) => [k, `-${k}`]);

const whole = (n: number | undefined) => n === undefined || (Number.isInteger(n) && n >= 0 && n <= POPULATION.max);

/**
 * Turns filter input — from a query string or from an MCP tool call — into a query with
 * every unit resolved to its canonical code. Shared, so the HTTP route and the tool reject
 * the same things with the same words.
 */
export function parseFilter(input: FilterInput, lookup: Lookup): { query: FilterQuery } | { error: FilterError } {
  const page = input.page ?? PAGE.default;
  if (!Number.isInteger(page) || page < 1 || page > PAGE.max) {
    return { error: { kind: "invalid-query", detail: "page must be a whole number from 1" } };
  }
  if (input.type !== undefined && input.type !== "urban" && input.type !== "rural") {
    return { error: { kind: "invalid-query", detail: "type must be urban or rural" } };
  }
  if (input.sort !== undefined && !SORTS.includes(input.sort)) {
    return { error: { kind: "invalid-query", detail: `sort must be one of ${SORTS.join(", ")}` } };
  }
  if (!whole(input.minPopulation) || !whole(input.maxPopulation)) {
    return { error: { kind: "invalid-query", detail: "min_population and max_population must be whole numbers from 0" } };
  }
  if (input.minPopulation !== undefined && input.maxPopulation !== undefined && input.minPopulation > input.maxPopulation) {
    return { error: { kind: "invalid-query", detail: "min_population can't be above max_population" } };
  }
  const query: FilterQuery = { page };
  for (const key of ["region", "province", "cercle"] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    const found = resolve(lookup, raw);
    if (found.kind === "malformed") return { error: { kind: "invalid-code", detail: `${raw} is not a geographic code` } };
    if (found.kind === "absent") return { error: { kind: "not-found", detail: `no ${key} has code ${raw}` } };
    // A code of the wrong level would otherwise address a path that does not exist and
    // come back as a missing page, which says nothing about what went wrong.
    if (found.level !== key) {
      return { error: { kind: "invalid-query", detail: `${raw} is ${withArticle(found.level)}, not a ${key}` } };
    }
    query[key] = found.code;
  }
  if (input.type !== undefined) query.type = input.type as "urban" | "rural";
  if (input.sort !== undefined) query.sort = input.sort as FilterQuery["sort"];
  if (input.minPopulation !== undefined) query.minPopulation = input.minPopulation;
  if (input.maxPopulation !== undefined) query.maxPopulation = input.maxPopulation;
  return { query };
}

const VALUE: Record<SortKey, (c: ListedCommune) => number | string | null> = {
  code: (c) => c.code,
  name: (c) => c.name.fr,
  population: (c) => c.population["2024"].total,
  change: (c) => c.population.change?.pct ?? null,
  density: (c) => c.density,
  area: (c) => c.areaKm2,
};

/**
 * Every commune a query selects, in the order it asks for. A missing value sorts last in
 * either direction, since "largest first" shouldn't open on the one commune with no
 * boundary. Ties fall back to the code, so a page boundary never moves.
 */
export function collectCommunes<T extends ListedCommune>(query: FilterQuery, communes: readonly T[]): T[] {
  const { minPopulation: min, maxPopulation: max } = query;
  const rows = communes.filter((c) => {
    const people = c.population["2024"].total;
    return (
      (query.region === undefined || c.parents.region === query.region) &&
      (query.province === undefined || c.parents.province === query.province) &&
      (query.cercle === undefined || c.parents.cercle === query.cercle) &&
      (query.type === undefined || c.type === query.type) &&
      (min === undefined || (people !== null && people >= min)) &&
      (max === undefined || (people !== null && people <= max))
    );
  });
  const sort = query.sort ?? "code";
  const descending = sort.startsWith("-");
  const value = VALUE[sort.replace(/^-/, "") as SortKey];
  return rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === y ? a.code.localeCompare(b.code) : x === null ? 1 : -1;
    const order = typeof x === "string" ? x.localeCompare(y as string, "fr") : x - (y as number);
    return (descending ? -order : order) || a.code.localeCompare(b.code);
  });
}

/**
 * One page of the communes a query selects, from a single pre-rendered file when one
 * holds it, or null past the last page. A filter that matches nothing still has a page 1,
 * empty, the same as the pre-rendered lists.
 */
export async function listCommunes<T extends ListedCommune>(
  query: FilterQuery,
  communes: readonly T[],
  fetchJson: FetchJson,
): Promise<{ rows: unknown[]; meta: PageMeta } | null> {
  const direct = aliasPath(query);
  if (direct) {
    const body = await fetchJson(direct);
    if (!body) return null;
    return { rows: body.data, meta: body.meta as PageMeta };
  }
  const { slice, meta } = paginate(collectCommunes(query, communes), query.page, PER_PAGE);
  if (query.page > meta.totalPages) return null;
  return { rows: slice, meta };
}
