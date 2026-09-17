import { DATASET_VERSION } from "../../../pipeline/src/sources/registry.ts";

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface Links {
  self: string;
  prev: string | null;
  next: string | null;
}

export interface Envelope<T> {
  data: T;
  meta: { datasetVersion: string } & Partial<PageMeta>;
  links: Links;
}

export const PER_PAGE = 50;

/**
 * `prev` and `next` are always present, null at the ends. An absent key and a null one
 * read the same in JavaScript but not in a typed client, and a consumer walking pages
 * should not have to tell "no next page" from "this endpoint does not paginate".
 */
export function envelope<T>(
  data: T,
  links: { self: string; prev?: string | null; next?: string | null },
  meta: Partial<PageMeta> = {},
): Envelope<T> {
  return {
    data,
    meta: { datasetVersion: DATASET_VERSION, ...meta },
    links: { self: links.self, prev: links.prev ?? null, next: links.next ?? null },
  };
}

/** An empty list still has page 1, so a client's first request is never a 404. */
export function paginate<T>(items: T[], page: number, perPage = PER_PAGE): { slice: T[]; meta: PageMeta } {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const start = (page - 1) * perPage;
  return {
    slice: items.slice(start, start + perPage),
    meta: { page, perPage, total: items.length, totalPages },
  };
}

export function pageMeta(base: string, page: number, totalPages: number): Links {
  return {
    self: `${base}/${page}.json`,
    prev: page > 1 ? `${base}/${page - 1}.json` : null,
    next: page < totalPages ? `${base}/${page + 1}.json` : null,
  };
}

export const PROBLEM_BASE = "https://morocco-communes-api.workers.dev/problems";

const PROBLEMS = {
  "not-found": { status: 404, title: "Resource not found" },
  "invalid-code": { status: 400, title: "Malformed geographic code" },
  "invalid-query": { status: 400, title: "Invalid query parameter" },
  "not-acceptable": { status: 406, title: "Unsupported response format" },
} as const;

export type ProblemKind = keyof typeof PROBLEMS;

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

/**
 * RFC 9457. The kind is what separates "this code is well-formed but no such commune
 * exists" (404) from "this is not a code at all" (400) — a distinction a client needs in
 * order to know whether retrying with a different spelling could help.
 */
export function problem(kind: ProblemKind, detail: string, instance: string): Problem {
  const { status, title } = PROBLEMS[kind];
  return { type: `${PROBLEM_BASE}/${kind}`, title, status, detail, instance };
}
