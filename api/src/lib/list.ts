import { paginate, type Envelope, type PageMeta } from "./envelope.ts";
import { PAGE, PER_PAGE } from "./params.ts";
import { aliasPath, narrowestSource, resolve, withArticle, type FilterQuery, type Lookup } from "./resolve.ts";

/** Reads a pre-rendered file as JSON, or null when there is no such file. */
export type FetchJson = (path: string) => Promise<Envelope<unknown[]> | null>;

export interface FilterInput {
  region?: string;
  province?: string;
  cercle?: string;
  type?: string;
  page?: number;
}

export type FilterError = { kind: "invalid-code" | "not-found" | "invalid-query"; detail: string };

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
  return { query };
}

interface ListedCommune {
  type: string;
  parents: { region: string; province: string; cercle: string | null };
}

/**
 * Every commune a multi-filter query selects: the smallest pre-rendered list that
 * contains the answer, filtered by everything else the query names. At most 6 pages for
 * a région.
 *
 * Each filter is checked against every row, not only the one that picked the list:
 * `region=01&province=04.421` reads the province's list, and has to come back empty
 * rather than as that province's communes.
 */
export async function collectCommunes(query: FilterQuery, fetchJson: FetchJson): Promise<ListedCommune[]> {
  const base = narrowestSource(query);
  const rows: ListedCommune[] = [];
  let pages = 1;
  for (let p = 1; p <= pages; p++) {
    const body = await fetchJson(`${base}/${p}.json`);
    if (!body) break;
    pages = body.meta.totalPages ?? 1;
    rows.push(...(body.data as ListedCommune[]));
  }
  return rows.filter(
    (r) =>
      (query.region === undefined || r.parents.region === query.region) &&
      (query.province === undefined || r.parents.province === query.province) &&
      (query.cercle === undefined || r.parents.cercle === query.cercle) &&
      (query.type === undefined || r.type === query.type),
  );
}

/** One page of the communes a query selects, from a single file when one holds it. */
export async function listCommunes(
  query: FilterQuery,
  fetchJson: FetchJson,
): Promise<{ rows: unknown[]; meta: PageMeta } | null> {
  const direct = aliasPath(query);
  if (direct) {
    const body = await fetchJson(direct);
    if (!body) return null;
    return { rows: body.data, meta: body.meta as PageMeta };
  }
  const { slice, meta } = paginate(await collectCommunes(query, fetchJson), query.page, PER_PAGE);
  return { rows: slice, meta };
}
