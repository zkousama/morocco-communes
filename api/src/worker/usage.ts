/**
 * What the live routes and the MCP server record about their own use, in Workers Analytics
 * Engine. A static file never reaches this code, so only what runs is counted: search, the
 * point lookups, filtered lists, aliases and MCP.
 *
 * Nothing here identifies a person: no address, no query text, no parameter value. The
 * route or tool, the name an MCP client gives itself, the first word of the User-Agent and
 * the country are enough to see how it's used and by what.
 */
import type { Level } from "../lib/search.ts";
import { scrubText } from "./demand.ts";

export interface UsageDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface Use {
  kind: "api" | "mcp";
  /** A route with its codes taken out, like "communes/:id", or an MCP tool or method. */
  name: string;
  /** The name an MCP client gives in its initialize message. */
  client?: string;
  /** The first product in the User-Agent, like "node" or "python-httpx". */
  agent?: string;
  country?: string;
  status: number;
  ms: number;
}

/** Writes one use. Without the binding, as in local dev and tests, it does nothing. */
export function record(dataset: UsageDataset | undefined, use: Use): void {
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      indexes: [use.kind],
      blobs: [use.kind, use.name, use.client ?? "", use.agent ?? "", use.country ?? ""],
      doubles: [use.status, use.ms],
    });
  } catch {
    // Counting must never cost a caller their answer.
  }
}

/** The first product in a User-Agent, lower case and cut short. */
export function agentOf(userAgent: string | null | undefined): string {
  const first = (userAgent ?? "").trim().split(/[\s/;(]/)[0] ?? "";
  return first.slice(0, 40).toLowerCase();
}

/** A path under /api with its codes and slugs replaced, so a thousand communes are one route. */
export function routeOf(pathname: string): string {
  const [, collection, id, figures, ...rest] = pathname.split("/").filter(Boolean);
  if (!collection || rest.length > 0) return "other";
  if (collection === "search") return "search";
  if (collection === "communes" && (id === "at" || id === "near")) return `communes/${id}`;
  if (id === undefined) return collection;
  if (figures === undefined) return `${collection}/:id`;
  return `${collection}/:id/${figures}`;
}

const CODE = /^[0-9][0-9.]{1,13}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const LEVELS = new Set<string>(["commune", "arrondissement", "province", "region", "cercle"] satisfies Level[]);

/**
 * Each JSON-RPC message in an MCP request: its method, the tool a call names, and the name
 * an initialize gives its client. Notifications are left out, since they say nothing about
 * use. A body that isn't JSON-RPC gives nothing.
 */
export function mcpMessages(
  body: unknown,
  /** Passed to scrubText, to tell a real code from a number shaped like one. */
  knownCode?: (code: string) => boolean,
): { method: string; tool?: string; client?: string; args?: { place?: string; level?: Level; query?: string } }[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const { method, params } = message as { method?: unknown; params?: Record<string, unknown> };
    if (typeof method !== "string" || method.startsWith("notifications/")) return [];
    const tool = method === "tools/call" && typeof params?.name === "string" ? params.name.slice(0, 60) : undefined;
    const info = method === "initialize" ? (params?.clientInfo as { name?: unknown } | undefined) : undefined;
    const client = typeof info?.name === "string" ? info.name.slice(0, 60) : undefined;

    // Only the place a tool names, the level it's read at and a free-text query are kept.
    // The tools name a place as id or unit, by code or slug, lower-cased here since an
    // assistant writes Tanger as often as tanger, and anything else there is left out. The
    // query passes scrubText first, the way a site search is scrubbed.
    const raw = (method === "tools/call" ? (params?.arguments as Record<string, unknown> | undefined) : undefined) ?? {};
    const given = [raw.code, raw.id, raw.unit].find((value): value is string => typeof value === "string")?.trim().toLowerCase();
    const place = given !== undefined && (CODE.test(given) || SLUG.test(given)) ? given : undefined;
    const level = place && typeof raw.level === "string" && LEVELS.has(raw.level) ? (raw.level as Level) : undefined;
    const query = typeof raw.query === "string" ? scrubText(raw.query, knownCode) : "";
    const args = { ...(place && { place }), ...(level && { level }), ...(query !== "" && { query }) };

    return [{ method, ...(tool && { tool }), ...(client && { client }), ...(tool && { args }) }];
  });
}
