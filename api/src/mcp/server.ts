import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { listCommunes, parseFilter, SORT_KEYS, type FetchJson, type ListedCommune } from "../lib/list.ts";
import { TOPICS, type IndicatorRecord, type IndicatorTable, type Topics } from "../lib/indicators.ts";
import { LIMIT, PAGE, POPULATION, QUERY, RADIUS_KM } from "../lib/params.ts";
import { resolve, withArticle, type Lookup } from "../lib/resolve.ts";
import { near, search, type Level, type SearchIndex } from "../lib/search.ts";
import { communeIn, featureContaining, tileAt, tilePath, type PreparedIndex, type Tile } from "../lib/locate.ts";

export interface McpDeps {
  index: SearchIndex;
  lookup: Lookup;
  /** Reads a pre-rendered API file, so a tool answers from the same files the API serves. */
  fetchJson: FetchJson;
  /** Which boundary tiles exist, for finding the commune at a point. */
  tiles: PreparedIndex;
  /** Every commune record, for lists that sort or bound the population. */
  communes: readonly ListedCommune[];
  /** Each commune's census indicators, for lists sorted by one. */
  indicators: IndicatorTable;
}

const LEVELS = ["commune", "arrondissement", "province", "region", "cercle"] as const satisfies readonly Level[];

/** Read-only, closed-world and repeatable, which lets a client call these without asking. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;

const INSTRUCTIONS =
  "Morocco's administrative divisions: régions, provinces and préfectures, cercles, communes and arrondissements, " +
  "with HCP census population for 2024 and 2014 and OpenStreetMap boundaries. " +
  "Units are identified by HCP geographic codes such as 01.511.01.0, and a slug such as tanger works wherever a code does. " +
  "To answer a question about a named place, call search first to get its code. " +
  "For coordinates, commune_at gives the commune that contains them. " +
  "get_indicators gives the 2024 census's figures on age, education, languages, work and housing for any unit or the whole country, " +
  "and list_communes can rank communes by any of them.";

/** Where each level's files live. */
const COLLECTION: Record<Level, string> = {
  region: "regions",
  province: "provinces",
  cercle: "cercles",
  commune: "communes",
  arrondissement: "arrondissements",
};

const AREAS = ["total", "urban", "rural"] as const;
const SEXES = ["all", "male", "female"] as const;
const TOPIC_NAMES = [...TOPICS.keys()] as [string, ...string[]];

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
  areaKm2: number | null;
  density: number | null;
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
  area_km2: z.number().nullable(),
  density: z.number().nullable(),
  centroid: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});

/**
 * A new server per request: the Worker is stateless, and a server shared across the
 * concurrent requests an isolate can take would mix up their JSON-RPC ids.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const { index, lookup, fetchJson, tiles, communes, indicators } = deps;

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
    area_km2: c.areaKm2,
    density: c.density,
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
        query: z.string().min(1).max(QUERY.maxLength).describe("The name to look for, in French, Arabic or as a slug."),
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
      if (found.level === "arrondissement") {
        // An arrondissement sits inside a commune, so the useful answer is that commune.
        const body = await fetchJson(`/api/arrondissements/${found.code}.json`);
        const parent = (body?.data as unknown as { communeCode: string | null } | undefined)?.communeCode;
        if (parent) {
          return fail(`${id} is an arrondissement of ${nameOf.get(parent) ?? parent}. Call get_commune with ${parent}.`);
        }
        return fail(`${id} is an arrondissement, not a commune.`);
      }
      if (found.level !== "commune") {
        return fail(
          `${id} is ${withArticle(found.level)}, not a commune. ` +
            `Call list_communes with ${found.level}: "${found.code}" to list its communes.`,
        );
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
        "so the nearest commune isn't always the one that contains the point: commune_at gives that one.",
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
    "commune_at",
    {
      title: "Commune at a point",
      description:
        "The commune whose boundary contains a point, with its names, type, parents and population, " +
        "and in Casablanca, Rabat, Fès, Marrakech, Salé and Tanger the arrondissement too. " +
        "Use it to turn coordinates, from a map or a device, into a commune. " +
        "Sidi Mohamed Benmansour has no boundary, and neither do about 88 km² between Ifrane and Boulemane.",
      inputSchema: {
        lat: z.number().min(-90).max(90).describe("Latitude, in degrees."),
        lng: z.number().min(-180).max(180).describe("Longitude, in degrees."),
      },
      outputSchema: {
        commune: communeShape,
        arrondissement: z.object({ code: z.string(), name_fr: z.string(), name_ar: z.string() }).nullable(),
      },
      annotations: READ_ONLY,
    },
    async ({ lat, lng }) => {
      const key = tileAt(tiles, lat, lng);
      const tile = key ? ((await fetchJson(tilePath(key))) as unknown as Tile | null) : null;
      const code = tile ? communeIn(tile, lat, lng) : null;
      if (!code) {
        return fail(
          `No commune boundary contains ${lat}, ${lng}. It may be outside Morocco or at sea; communes_near finds the closest communes.`,
        );
      }
      const body = await fetchJson(`/api/communes/${code}.json`);
      if (!body) return fail(`The record for ${code} could not be read.`);
      // Only the 6 cities have this file; everywhere else there's no arrondissement to name.
      const city = (await fetchJson(`/api/communes/${code}/arrondissements.geojson`)) as unknown as {
        features: Parameters<typeof featureContaining>[0];
      } | null;
      const hit = city ? featureContaining(city.features, lat, lng) : null;
      return ok({
        commune: trim(body.data as unknown as CommuneRecord),
        arrondissement: hit ? { code: hit.properties.code, name_fr: hit.properties.name_fr, name_ar: hit.properties.name_ar } : null,
      });
    },
  );

  server.registerTool(
    "list_communes",
    {
      title: "List communes",
      description:
        "Communes filtered by région, province or préfecture, cercle, type or population, 50 to a page, " +
        "in code order or sorted by name, population, change since 2014, density, area or any census indicator. " +
        "Filters combine; each unit can be given by code or slug. With no filter it lists every commune, " +
        "so sort: \"-population\" alone gives the largest in the country.",
      inputSchema: {
        region: z.string().optional().describe("A région, by code or slug."),
        province: z.string().optional().describe("A province or préfecture, by code or slug."),
        cercle: z.string().optional().describe("A cercle, by code or slug."),
        type: z.enum(["urban", "rural"]).optional().describe("Urban or rural communes only."),
        sort: z
          .string()
          .optional()
          .describe(
            `A field to order by: ${SORT_KEYS.join(", ")}, or a census indicator by its path, such as ` +
              "labour.unemploymentRate or amenities.runningWater, as get_indicators names them. " +
              "A leading minus puts the largest first. Code order when left out.",
          ),
        min_population: z.number().int().min(0).max(POPULATION.max).optional().describe("Only communes with at least this many people in 2024."),
        max_population: z.number().int().min(0).max(POPULATION.max).optional().describe("Only communes with at most this many people in 2024."),
        page: z.number().int().min(1).max(PAGE.max).optional().describe("Page number, from 1."),
      },
      outputSchema: {
        communes: z.array(
          communeShape.extend({
            indicator: z
              .object({ path: z.string(), value: z.number().nullable() })
              .optional()
              .describe("When sorted by an indicator, the commune's figure for it."),
          }),
        ),
        page: z.number(),
        total_pages: z.number(),
        total: z.number(),
      },
      annotations: READ_ONLY,
    },
    async ({ min_population, max_population, ...input }) => {
      const parsed = parseFilter({ ...input, minPopulation: min_population, maxPopulation: max_population }, lookup);
      if ("error" in parsed) return fail(`${parsed.error.detail}.`);
      const result = await listCommunes(parsed.query, communes, fetchJson, indicators);
      if (!result) return fail(`There is no page ${parsed.query.page} for these filters.`);
      return ok({
        communes: (result.rows as (CommuneRecord & { indicator?: { path: string; value: number | null } })[]).map((row) => ({
          ...trim(row),
          ...(row.indicator ? { indicator: row.indicator } : {}),
        })),
        page: result.meta.page,
        total_pages: result.meta.totalPages,
        total: result.meta.total,
      });
    },
  );

  server.registerTool(
    "get_indicators",
    {
      title: "Census indicators",
      description:
        "HCP's figures from the 2024 census for Morocco or any région, province or préfecture, cercle, commune or arrondissement: " +
        "age, marital status, fertility, disability, schooling, illiteracy, the languages people read and write and the local languages they use, " +
        "education, work and employment status, and for households their size, dwelling, occupancy, amenities, wastewater, waste and cooking fuel. " +
        "Shares and rates are percentages from 0 to 100. Most of these come from the long questionnaire, which went to a random 20% of households " +
        "in communes of 2,000 households or more, so there they're estimates. Null means HCP publishes no figure there. " +
        "To rank communes by one figure, call list_communes with sort set to its path.",
      inputSchema: {
        unit: z
          .string()
          .min(1)
          .optional()
          .describe("A région, province or préfecture, cercle, commune or arrondissement, by code or slug. Morocco as a whole when left out."),
        topics: z.array(z.enum(TOPIC_NAMES)).optional().describe("Only these topics. Every topic when left out."),
        area: z
          .enum([...AREAS, "each"])
          .optional()
          .describe("The whole unit (total), its urban or rural part, or each of the three. total when left out."),
        sex: z
          .enum([...SEXES, "each"])
          .optional()
          .describe("Everyone (all), men, women, or each of the three. all when left out. Household figures have no sex."),
      },
      outputSchema: {
        unit: z.object({
          code: z.string().nullable(),
          level: z.string(),
          name_fr: z.string(),
          name_ar: z.string().nullable(),
        }),
        from_local_administration: z
          .boolean()
          .describe("HCP collected this unit's figures from the local administration, as its population moves with the seasons; only the counts are published."),
        figures: z
          .record(z.string(), z.record(z.string(), z.unknown()).nullable())
          .describe("By area: people by sex, then households, each by topic and key. Null for an area the unit doesn't have."),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, topics, area, sex }) => {
      let path = "/api/indicators.json";
      if (unit !== undefined) {
        const found = resolve(lookup, unit);
        if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
        if (found.kind === "absent") return fail(`No unit has the identifier ${unit}. Call search to find its code.`);
        path = `/api/${COLLECTION[found.level]}/${found.code}/indicators.json`;
      }
      const body = await fetchJson(path);
      if (!body) return fail(`The indicators for ${unit ?? "Morocco"} could not be read.`);
      const record = body.data as unknown as IndicatorRecord;

      // In HCP's order, whatever order the topics were asked in.
      const pick = (t: Topics) => (topics ? Object.fromEntries(Object.entries(t).filter(([k]) => topics.includes(k))) : t);
      const areas = area === "each" ? AREAS : [area ?? "total"];
      const sexes = sex === "each" ? SEXES : [sex ?? "all"];
      const figures = Object.fromEntries(
        areas.map((a) => {
          const people = record.people[a as (typeof AREAS)[number]];
          const homes = record.households[a as (typeof AREAS)[number]];
          if (!people || !homes) return [a, null];
          const bySex = Object.fromEntries(sexes.map((x) => [x, pick(people[x as (typeof SEXES)[number]])]));
          const household = pick(homes);
          return [
            a,
            {
              ...(Object.values(bySex).some((t) => Object.keys(t).length > 0) ? { people: bySex } : {}),
              ...(Object.keys(household).length > 0 ? { households: household } : {}),
            },
          ];
        }),
      );
      return ok({
        unit: { code: record.code, level: record.level, name_fr: record.name.fr, name_ar: record.name.ar },
        from_local_administration: record.fromLocalAdministration,
        figures,
      });
    },
  );

  return server;
}
