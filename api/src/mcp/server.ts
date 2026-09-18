import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { listCommunes, parseFilter, type FetchJson } from "../lib/list.ts";
import { LIMIT, PAGE, RADIUS_KM } from "../lib/params.ts";
import { resolve, type Lookup } from "../lib/resolve.ts";
import { near, search, type Level, type SearchIndex } from "../lib/search.ts";

export interface McpDeps {
  index: SearchIndex;
  lookup: Lookup;
  /** Reads a pre-rendered API file, so a tool answers from the same files the API serves. */
  fetchJson: FetchJson;
}

const LEVELS = ["commune", "arrondissement", "province", "region", "cercle"] as const satisfies readonly Level[];

/** Read-only, closed-world and repeatable, which lets a client call these without asking. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;

const INSTRUCTIONS =
  "Morocco's administrative divisions: régions, provinces and préfectures, cercles, communes and arrondissements, " +
  "with HCP census population for 2024 and 2014 and OpenStreetMap boundaries. " +
  "Units are identified by HCP geographic codes such as 01.511.01.0, and a slug such as tanger works wherever a code does. " +
  "To answer a question about a named place, call search first to get its code.";

interface CommuneRecord {
  code: string;
  slug: string;
  name: { fr: string; ar: string };
  type: "urban" | "rural";
  parents: { region: string; province: string; cercle: string | null };
  population: {
    "2024": { total: number | null };
    "2014": { total: number | null } | null;
    change: { pct: number } | null;
  };
  centroid: { lat: number; lng: number } | null;
}

const unitRef = z.object({ code: z.string(), name: z.string() });
const communeShape = z.object({
  code: z.string(),
  slug: z.string(),
  name_fr: z.string(),
  name_ar: z.string(),
  type: z.enum(["urban", "rural"]),
  region: unitRef,
  province: unitRef,
  cercle: unitRef.nullable(),
  population_2024: z.number().nullable(),
  population_2014: z.number().nullable(),
  change_pct: z.number().nullable(),
  centroid: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});

/**
 * A new server per request: the Worker is stateless, and a server shared across the
 * concurrent requests an isolate can take would mix up their JSON-RPC ids.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const { index, lookup, fetchJson } = deps;

  // Parent codes are named from the search index, which already holds every unit, so a
  // model can say which province a commune is in without a second call.
  const nameOf = new Map(index.entries.map(([code, , fr]) => [code, fr]));
  const ref = (code: string) => ({ code, name: nameOf.get(code) ?? code });
  const trim = (c: CommuneRecord) => ({
    code: c.code,
    slug: c.slug,
    name_fr: c.name.fr,
    name_ar: c.name.ar,
    type: c.type,
    region: ref(c.parents.region),
    province: ref(c.parents.province),
    cercle: c.parents.cercle ? ref(c.parents.cercle) : null,
    population_2024: c.population["2024"].total,
    population_2014: c.population["2014"]?.total ?? null,
    change_pct: c.population.change?.pct ?? null,
    centroid: c.centroid,
  });

  const ok = <T extends Record<string, unknown>>(data: T) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  });
  const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

  const server = new McpServer(
    { name: "morocco-communes", version: index.datasetVersion },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool(
    "search",
    {
      title: "Search Moroccan administrative units",
      description:
        "Find régions, provinces and préfectures, cercles, communes and arrondissements of Morocco by name. " +
        "Takes French or Arabic, a slug, or another name a place is known by: Fez finds Fès, Mogador finds Essaouira. " +
        "Returns codes; pass a commune's code to get_commune for its population and parents.",
      inputSchema: {
        query: z.string().min(1).describe("The name to look for, in French, Arabic or as a slug."),
        levels: z.array(z.enum(LEVELS)).optional().describe("Only these levels. Every level when left out."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT.max)
          .optional()
          .describe(`How many results. ${LIMIT.default} when left out, at most ${LIMIT.max}.`),
      },
      outputSchema: {
        results: z.array(
          z.object({
            code: z.string(),
            level: z.enum(LEVELS),
            name_fr: z.string(),
            name_ar: z.string(),
            slug: z.string(),
            matched: z.enum(["exact", "alias", "prefix", "trigram"]),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ query, levels, limit }) => {
      const hits = search(index, query, { levels, limit: limit ?? LIMIT.default });
      return ok({
        results: hits.map((h) => ({
          code: h.code,
          level: h.level,
          name_fr: h.name.fr,
          name_ar: h.name.ar,
          slug: h.slug,
          matched: h.matched,
        })),
      });
    },
  );

  server.registerTool(
    "get_commune",
    {
      title: "Get one commune",
      description:
        "One commune's names, type, région, province and cercle, 2024 and 2014 population, the change between them, " +
        "and a point inside it. Identify it by HCP code (01.511.01.0), the code as digits, or a slug (tanger).",
      inputSchema: {
        id: z.string().min(1).describe("An HCP code, the code as digits, or a slug."),
      },
      outputSchema: { commune: communeShape },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const found = resolve(lookup, id);
      if (found.kind === "malformed") return fail(`${id} is not a code or a slug.`);
      if (found.kind === "absent") return fail(`No unit has the identifier ${id}. Call search to find its code.`);
      if (found.level !== "commune") {
        return fail(`${id} is a ${found.level}, not a commune. Use list_communes to list the communes inside it.`);
      }
      const body = await fetchJson(`/api/communes/${found.code}.json`);
      if (!body) return fail(`The record for ${found.code} could not be read.`);
      return ok({ commune: trim(body.data as unknown as CommuneRecord) });
    },
  );

  server.registerTool(
    "communes_near",
    {
      title: "Communes near a point",
      description:
        "Communes within a radius of a point, nearest first. Distance is measured to each commune's centroid, " +
        "so the nearest commune is not always the one that contains the point.",
      inputSchema: {
        lat: z.number().min(-90).max(90).describe("Latitude, in degrees."),
        lng: z.number().min(-180).max(180).describe("Longitude, in degrees."),
        radius_km: z
          .number()
          .positive()
          .max(RADIUS_KM.max)
          .optional()
          .describe(`Radius in km. ${RADIUS_KM.default} when left out, at most ${RADIUS_KM.max}.`),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT.max)
          .optional()
          .describe(`How many results. ${LIMIT.default} when left out, at most ${LIMIT.max}.`),
      },
      outputSchema: {
        results: z.array(
          z.object({
            code: z.string(),
            name_fr: z.string(),
            name_ar: z.string(),
            slug: z.string(),
            distance_km: z.number(),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ lat, lng, radius_km, limit }) => {
      const hits = near(index, lat, lng, radius_km ?? RADIUS_KM.default, limit ?? LIMIT.default);
      return ok({
        results: hits.map((h) => ({
          code: h.code,
          name_fr: h.name.fr,
          name_ar: h.name.ar,
          slug: h.slug,
          distance_km: h.distanceKm,
        })),
      });
    },
  );

  server.registerTool(
    "list_communes",
    {
      title: "List communes",
      description:
        "Communes filtered by région, province or préfecture, cercle, or type, 50 to a page. " +
        "Filters combine; each unit can be given by code or slug. With no filter it lists every commune.",
      inputSchema: {
        region: z.string().optional().describe("A région, by code or slug."),
        province: z.string().optional().describe("A province or préfecture, by code or slug."),
        cercle: z.string().optional().describe("A cercle, by code or slug."),
        type: z.enum(["urban", "rural"]).optional(),
        page: z.number().int().min(1).max(PAGE.max).optional().describe("Page number, from 1."),
      },
      outputSchema: {
        communes: z.array(communeShape),
        page: z.number(),
        total_pages: z.number(),
        total: z.number(),
      },
      annotations: READ_ONLY,
    },
    async (input) => {
      const parsed = parseFilter(input, lookup);
      if ("error" in parsed) return fail(`${parsed.error.detail}.`);
      const result = await listCommunes(parsed.query, fetchJson);
      if (!result) return fail(`There is no page ${parsed.query.page} for these filters.`);
      return ok({
        communes: (result.rows as CommuneRecord[]).map(trim),
        page: result.meta.page,
        total_pages: result.meta.totalPages,
        total: result.meta.total,
      });
    },
  );

  return server;
}
