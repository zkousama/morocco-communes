import { paginate, type Envelope, type PageMeta } from "./envelope.ts";
import { PAGE, PER_PAGE } from "./params.ts";
import { aliasPath, narrowestSource, resolve, type FilterQuery, type Lookup } from "./resolve.ts";

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
    query[key] = found.code;
  }
  if (input.type !== undefined) query.type = input.type as "urban" | "rural";
  return { query };
}

/**
 * Every commune a multi-filter query selects: the smallest pre-rendered list that
 * contains the answer, filtered by type. At most 6 pages for a région.
 */
export async function collectCommunes(query: FilterQuery, fetchJson: FetchJson): Promise<{ type: string }[]> {
  const base = narrowestSource(query);
  const rows: { type: string }[] = [];
  let pages = 1;
  for (let p = 1; p <= pages; p++) {
    const body = await fetchJson(`${base}/${p}.json`);
    if (!body) break;
    pages = body.meta.totalPages ?? 1;
    rows.push(...(body.data as { type: string }[]));
  }
  return query.type ? rows.filter((r) => r.type === query.type) : rows;
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
