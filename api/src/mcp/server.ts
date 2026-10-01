import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { listCommunes, parseFilter, SORT_KEYS, type FetchJson, type ListedCommune } from "../lib/list.ts";
import { TOPICS, type Census, type IndicatorRecord, type IndicatorTable, type Topics } from "../lib/indicators.ts";
import { ECONOMY_TOPICS, type EconomyRecord } from "../lib/economy.ts";
import { HOUSING_TOPICS, type HousingRecord } from "../lib/housing.ts";
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
  /** Each commune's census figures and establishment counts, for lists sorted by one. */
  indicators: IndicatorTable;
}

const LEVELS = ["commune", "arrondissement", "province", "region", "cercle"] as const satisfies readonly Level[];

/**
 * The tools registered below. Usage counting keeps a tool's name only when it's one of
 * these, since a call can name anything; a test holds this to the registrations.
 */
export const TOOL_NAMES: ReadonlySet<string> = new Set([
  "search",
  "get_commune",
  "communes_near",
  "commune_at",
  "list_communes",
  "get_unit",
  "get_indicators",
  "get_economy",
  "get_housing",
  "get_insights",
  "get_neighbourhoods",
  "get_douars",
]);

/** Read-only, closed-world and repeatable, which lets a client call these without asking. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;

const INSTRUCTIONS =
  "Morocco's administrative divisions: régions, provinces and préfectures, cercles, communes and arrondissements, " +
  "with HCP census population for 2024 and 2014 and OpenStreetMap boundaries. " +
  "Units are identified by HCP geographic codes such as 01.511.01.0, and a slug such as tanger works wherever a code does. " +
  "To answer a question about a named place, call search first to get its code. " +
  "get_commune answers about a commune or an arrondissement, including the communes it borders, and get_unit about a région, a province or a cercle. " +
  "For coordinates, commune_at gives the commune that contains them. " +
  "get_indicators gives the census figures on age, education, languages, work and housing for any unit or the whole country, " +
  "from 2024, from 2014, or both to see what changed, and list_communes can rank communes by any of them or by the change since 2014. " +
  "get_economy gives the 2024 count of economic establishments for the same units: businesses by sector, by size and by when they were founded, " +
  "and the permanent jobs they hold. " +
  "get_housing gives the 2024 urban housing stock: how many dwellings a town has, how many stand empty, what kind they are and what they are made of. " +
  "get_insights gives up to 3 of a commune's 2024 census figures that stand out, each with its context worked out from the census: " +
  "the communes it borders on the same figure, and the same figure in 2014 beside Morocco's, where the two censuses can be compared. " +
  "A census figure in a commune of 2,000 households or more is marked sampled. " +
  "get_neighbourhoods gives a commune's named neighbourhoods and its postcodes, and get_douars a rural commune's fractions and douars, " +
  "with each douar's people and households and, for one of 30 households or more, how far it is from a road, a school and a health centre. " +
  "No language model writes or judges any of it.";

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
const ECONOMY_TOPIC_NAMES = [...ECONOMY_TOPICS.keys()] as [string, ...string[]];
const HOUSING_TOPIC_NAMES = [...HOUSING_TOPICS.keys()] as [string, ...string[]];

/** A région, province or cercle as its own file holds it. */
interface UnitRecord {
  code: string;
  name: { fr: string; ar: string };
  population: { "2024": { total: number | null; households?: number | null } };
  regionCode?: string;
  provinceCode?: string;
  provinceCount?: number;
  cercleCount?: number;
  communeCount?: number;
}

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
  const arNameOf = new Map(index.entries.map(([code, , , ar]) => [code, ar]));
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
        "A neighbourhood's name finds the arrondissement or commune it's in, with matched neighbourhood and the neighbourhood's names: " +
        "Sidi Maârouf finds Aïn-Chock, in Casablanca. The census has no figures for a neighbourhood itself. " +
        "A 5-digit postcode finds the commune it's in, with matched postcode: 20520 finds Casablanca. " +
        "Returns codes; pass a commune's code to get_commune for its population and parents.",
      inputSchema: {
        query: z.string().min(1).max(QUERY.maxLength).describe("The name to look for, in French, Arabic or as a slug, or a unit's code."),
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
            matched: z.enum(["code", "exact", "alias", "prefix", "spelling", "trigram", "neighbourhood", "postcode"]),
            neighbourhood_fr: z.string().optional(),
            neighbourhood_ar: z.string().optional(),
            postcode: z.string().optional(),
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
          ...(h.neighbourhood ? { neighbourhood_fr: h.neighbourhood.fr, neighbourhood_ar: h.neighbourhood.ar } : {}),
          ...(h.postcode ? { postcode: h.postcode.code } : {}),
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
        "a point inside it, the communes it borders and how much boundary it shares with each, and in the 6 cities " +
        "divided into them, its arrondissements with their population. " +
        "Identify it by HCP code (01.511.01.0), the code as digits, or a slug (tanger).",
      inputSchema: {
        id: z.string().min(1).describe("An HCP code, the code as digits, or a slug."),
      },
      outputSchema: {
        commune: communeShape,
        arrondissements: z
          .array(z.object({ code: z.string(), name_fr: z.string(), name_ar: z.string(), population_2024: z.number().nullable() }))
          .describe("Casablanca, Rabat, Fès, Marrakech, Salé and Tanger's arrondissements, most populous first; empty elsewhere."),
        neighbours: z
          .array(z.object({ code: z.string(), name_fr: z.string(), km: z.number() }))
          .describe("The communes this one borders, longest shared boundary first. Measured on the OpenStreetMap boundaries, so it is under ODbL."),
      },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const found = resolve(lookup, id, "commune");
      if (found.kind === "malformed") return fail(`${id} is not a code or a slug.`);
      if (found.kind === "absent") return fail(`No unit has the identifier ${id}. Call search to find its code.`);
      if (found.level === "arrondissement") {
        // An arrondissement sits inside a commune, so the answer names both, with the
        // arrondissement's own population, which is often what was asked.
        const body = await fetchJson(`/api/arrondissements/${found.code}.json`);
        const record = body?.data as unknown as { communeCode: string | null; name: { fr: string }; population: { "2024": { total: number | null } } } | undefined;
        if (record?.communeCode) {
          const city = nameOf.get(record.communeCode) ?? record.communeCode;
          return fail(
            `${id} is the arrondissement ${record.name.fr} of ${city}, with ${record.population["2024"].total} people in 2024. ` +
              `get_indicators with unit ${found.code} has its census figures, and get_commune with ${record.communeCode} gives ${city}.`,
          );
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
      const parts = ((await fetchJson(`/api/communes/${found.code}/arrondissements.json`))?.data ?? []) as unknown as {
        code: string;
        name: { fr: string; ar: string };
        population: { "2024": { total: number | null } };
      }[];
      const borders = ((await fetchJson(`/api/communes/${found.code}/neighbours.json`))?.data ?? []) as unknown as {
        code: string;
        name: { fr: string } | null;
        km: number;
      }[];
      return ok({
        commune: trim(body.data as unknown as CommuneRecord),
        arrondissements: parts
          .map((a) => ({ code: a.code, name_fr: a.name.fr, name_ar: a.name.ar, population_2024: a.population["2024"].total }))
          .sort((a, b) => (b.population_2024 ?? 0) - (a.population_2024 ?? 0)),
        neighbours: [...borders]
          .sort((a, b) => b.km - a.km)
          .map((n) => ({ code: n.code, name_fr: n.name?.fr ?? nameOf.get(n.code) ?? n.code, km: n.km })),
      });
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
        "Which commune has the most or the least of something is one call here: sort by that figure, and every commune in the filter comes " +
        "back in order with its value, with no need to look them up one by one. " +
        "Communes filtered by région, province or préfecture, cercle, type or population, 50 to a page, " +
        "in code order or sorted by name, population, change since 2014, density, area, any census indicator or any establishment count. " +
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
              "Put 2014. before the path for the 2014 figure, or change. for how far it moved since, " +
              "as in change.illiteracy.rate10Plus. " +
              "An establishment count goes under economy., as in economy.establishments.jobs or economy.sector.commerce, as get_economy names them. " +
              "A count on its own ranks the biggest places first, so 3 figures worked out from 2 counts rank by size of place rather than size: " +
              "economy.per1000.establishments, economy.per1000.jobs and economy.perBusiness.jobs. " +
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
              .object({
                path: z.string(),
                value: z.number().nullable(),
                derived: z.string().optional().describe("The division this figure came from, when it isn't a published one."),
                basis: z
                  .literal("arrondissement_sum")
                  .optional()
                  .describe("The value is the sum of this city's arrondissements, which is how the census counts it."),
              })
              .optional()
              .describe("When sorted by a figure, the commune's value for it."),
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
    "get_unit",
    {
      title: "A région, province or cercle",
      description:
        "One région, province, préfecture or cercle: its name in French and Arabic, its 2024 population and households, the units above it, " +
        "how many units it holds, and the ones directly under it, named: a région's provinces, a province's cercles. " +
        "This is the tool for a question about a unit above the commune, such as how many cercles a province has. " +
        "For a commune or an arrondissement, call get_commune; to list a unit's communes, call list_communes with that unit.",
      inputSchema: {
        unit: z.string().min(1).describe("A région, province, préfecture or cercle, by code or slug."),
        level: z
          .enum(["region", "province", "cercle"])
          .optional()
          .describe("The level, where a name is shared: Tiznit is a commune and a province, and a name alone means the commune."),
      },
      outputSchema: {
        unit: z.object({
          code: z.string(),
          level: z.string(),
          name_fr: z.string(),
          name_ar: z.string(),
          population_2024: z.number().nullable(),
          households_2024: z.number().nullable(),
          region: unitRef.nullable(),
          province: unitRef.nullable(),
        }),
        counts: z.record(z.string(), z.number()).describe("How many units of each level this one holds."),
        children: z
          .array(z.object({ code: z.string(), name_fr: z.string(), level: z.string(), population_2024: z.number().nullable() }))
          .describe("The units directly under it. Empty for a cercle, whose communes come from list_communes."),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, level }) => {
      const found = resolve(lookup, unit, level);
      if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
      if (found.kind === "absent") return fail(`No unit has the identifier ${unit}. Call search to find its code.`);
      if (found.level === "commune" || found.level === "arrondissement") {
        return fail(`${found.code} is ${withArticle(found.level)}. Call get_commune with ${found.code} instead.`);
      }
      const body = await fetchJson(`/api/${COLLECTION[found.level]}/${found.code}.json`);
      if (!body) return fail(`The record for ${found.code} could not be read.`);
      const record = body.data as unknown as UnitRecord;
      const below: Record<string, string | undefined> = {
        region: `/api/regions/${found.code}/provinces.json`,
        province: `/api/provinces/${found.code}/cercles.json`,
      };
      const path = below[found.level];
      const rows = path ? ((await fetchJson(path))?.data ?? []) as unknown as UnitRecord[] : [];
      const childLevel = found.level === "region" ? "province" : "cercle";
      return ok({
        unit: {
          code: record.code,
          level: found.level,
          name_fr: record.name.fr,
          name_ar: record.name.ar,
          population_2024: record.population["2024"].total,
          households_2024: record.population["2024"].households ?? null,
          region: record.regionCode ? ref(record.regionCode) : null,
          province: record.provinceCode ? ref(record.provinceCode) : null,
        },
        counts: {
          ...(record.provinceCount !== undefined ? { provinces: record.provinceCount } : {}),
          ...(record.cercleCount !== undefined ? { cercles: record.cercleCount } : {}),
          ...(record.communeCount !== undefined ? { communes: record.communeCount } : {}),
        },
        children: rows.map((r) => ({
          code: r.code,
          name_fr: r.name.fr,
          level: childLevel,
          population_2024: r.population["2024"].total,
        })),
      });
    },
  );

  server.registerTool(
    "get_indicators",
    {
      title: "Census indicators",
      description:
        "HCP's census figures for Morocco or any région, province or préfecture, cercle, commune or arrondissement: " +
        "age, marital status, fertility, disability, schooling, illiteracy, the languages people read and write and the local languages they use, " +
        "education, work, employment status and how people get to work, and for households their size, dwelling, occupancy, amenities, wastewater, waste and cooking fuel.\n\n" +
        "Reading them: shares and rates are percentages from 0 to 100. Null means HCP publishes no figure there. Most come from the long " +
        "questionnaire, which went to a random 20% of households in communes of 2,000 households or more, so there they're estimates.\n\n" +
        "Ranking and comparing: to order communes by one figure, call list_communes with sort set to its path, rather than this once per " +
        "commune. To compare the régions, the " +
        "provinces or the arrondissements, give level without a unit and get them all in one call.\n\n" +
        "The 2014 census is here too, under census. Age, education, local languages, illiteracy, fertility, disability, work, the ways of " +
        "getting to work, dwellings, amenities, wastewater and waste ask what 2024 asks and can be read against it. Where people work and how " +
        "children get to school are 2014 only. Five topics changed and can't be subtracted: marital status covered everyone rather than people " +
        "aged 15 and over, schooling ages 7 to 12 rather than 6 to 11, reading and writing was asked as combinations of languages rather than one " +
        "at a time, a household counted under every cooking fuel it used, and the employment shares took in unemployed people who had worked " +
        "before. A unit the 2014 census didn't count has null there, Casablanca and the 5 other cities with arrondissements among them, since " +
        "2014 published those by arrondissement.",
      inputSchema: {
        unit: z
          .string()
          .min(1)
          .optional()
          .describe("A région, province or préfecture, cercle, commune or arrondissement, by code or slug. Morocco as a whole when left out."),
        level: z
          .enum(LEVELS)
          .optional()
          .describe(
            "With a unit, the level it's at, where a name is shared: Tiznit is a commune and a province, and a name alone means the commune. " +
              "Without a unit, region, province or arrondissement gives every one of that level in one call.",
          ),
        topics: z
          .array(z.enum(TOPIC_NAMES))
          .optional()
          .describe(
            "Only these topics. Every topic when left out. Two are easy to confuse: labour holds the labour force, the activity rate and the " +
              "unemployment rate, while employmentStatus is how the people in work are employed, as employees, self-employed or apprentices.",
          ),
        area: z
          .enum([...AREAS, "each"])
          .optional()
          .describe("The whole unit (total), its urban or rural part, or each of the three. total when left out."),
        sex: z
          .enum([...SEXES, "each"])
          .optional()
          .describe("Everyone (all), men, women, or each of the three. all when left out. Household figures have no sex."),
        census: z
          .enum(["2024", "2014", "both"])
          .optional()
          .describe("Which census. 2024 when left out. both gives the two together, to see what changed."),
      },
      outputSchema: {
        results: z.array(
          z.object({
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
              .record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()).nullable()).nullable())
              .describe(
                "By census year, then by area: people by sex, then households, each by topic and key. " +
                  "Null for an area the unit doesn't have, and for a census that didn't count it.",
              ),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, level, topics, area, sex, census }) => {
      let records: IndicatorRecord[];
      if (unit !== undefined) {
        const found = resolve(lookup, unit, level);
        if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
        if (found.kind === "absent") return fail(`No unit has the identifier ${unit}. Call search to find its code.`);
        const body = await fetchJson(`/api/${COLLECTION[found.level]}/${found.code}/indicators.json`);
        if (!body) return fail(`The indicators for ${unit} could not be read.`);
        records = [body.data as unknown as IndicatorRecord];
      } else if (level !== undefined) {
        if (level !== "region" && level !== "province" && level !== "arrondissement") {
          return fail(`Without a unit, level can be region, province or arrondissement. To rank communes by a figure, call list_communes with sort.`);
        }
        const body = await fetchJson(`/api/${COLLECTION[level]}/indicators.json`);
        if (!body) return fail(`The indicators for every ${level} could not be read.`);
        records = body.data as unknown as IndicatorRecord[];
      } else {
        const body = await fetchJson("/api/indicators.json");
        if (!body) return fail("The indicators for Morocco could not be read.");
        records = [body.data as unknown as IndicatorRecord];
      }

      // In HCP's order, whatever order the topics were asked in.
      const pick = (t: Topics) => (topics ? Object.fromEntries(Object.entries(t).filter(([k]) => topics.includes(k))) : t);
      const areas = area === "each" ? AREAS : [area ?? "total"];
      const sexes = sex === "each" ? SEXES : [sex ?? "all"];
      const years = census === "both" ? (["2024", "2014"] as const) : ([census ?? "2024"] as const);
      const areasOf = (from: Census) => Object.fromEntries(
        areas.map((a) => {
          const people = from.people[a as (typeof AREAS)[number]];
          const homes = from.households[a as (typeof AREAS)[number]];
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
      const figuresOf = (record: IndicatorRecord) =>
        Object.fromEntries(
          years.map((year) => {
            const from = year === "2024" ? record : record["2014"];
            return [year, from ? areasOf(from) : null];
          }),
        );
      return ok({
        results: records.map((record) => ({
          unit: { code: record.code, level: record.level, name_fr: record.name.fr, name_ar: record.name.ar },
          from_local_administration: record.fromLocalAdministration,
          figures: figuresOf(record),
        })),
      });
    },
  );

  server.registerTool(
    "get_economy",
    {
      title: "Economic establishments",
      description:
        "HCP's 2024 count of economic establishments for Morocco or any région, province or préfecture, cercle, commune or arrondissement: " +
        "how many establishments were mapped, how many are public services, how many are associations in premises of their own, how many are " +
        "businesses, and how many permanent jobs those businesses hold. The businesses are split three ways, each covering all of them: by sector " +
        "(industry, construction, commerce, services), by how many people work there (1, 2-3, 4-9, 10-49, 50 and over), and by when they were " +
        "founded (before 1956 through 2020 and later). The weekly souks in use are counted beside them and are not part of the total.\n\n" +
        "Reading them: every figure is a count, taken during the census by field teams who mapped each establishment. Farming is out, the " +
        "workbook counts every sector but agriculture, and the jobs are the permanent ones.\n\n" +
        "Ranking and comparing: to order communes by one of these, call list_communes with sort set to its path, such as " +
        "economy.establishments.jobs, or by one of the 3 it works out from them: economy.per1000.establishments, economy.per1000.jobs, " +
        "economy.perBusiness.jobs. To compare the régions, the provinces or the arrondissements, give level without a unit and get them all in " +
        "one call.\n\n" +
        "Casablanca and the 5 other cities divided into arrondissements are counted by arrondissement, so their figures are the sum of those, " +
        "marked basis: arrondissement_sum. Say so when you report one.",
      inputSchema: {
        unit: z
          .string()
          .min(1)
          .optional()
          .describe("A région, province or préfecture, cercle, commune or arrondissement, by code or slug. Morocco as a whole when left out."),
        level: z
          .enum(LEVELS)
          .optional()
          .describe(
            "With a unit, the level it's at, where a name is shared: Tiznit is a commune and a province, and a name alone means the commune. " +
              "Without a unit, region, province or arrondissement gives every one of that level in one call.",
          ),
        topics: z.array(z.enum(ECONOMY_TOPIC_NAMES)).optional().describe("Only these topics. Every topic when left out."),
      },
      outputSchema: {
        results: z.array(
          z.object({
            unit: z.object({
              code: z.string().nullable(),
              level: z.string(),
              name_fr: z.string(),
              name_ar: z.string().nullable(),
            }),
            figures: z
              .record(z.string(), z.record(z.string(), z.number().nullable()))
              .describe("By topic, then by key. Counts of establishments, of permanent jobs, or of weekly souks."),
            basis: z
              .literal("arrondissement_sum")
              .optional()
              .describe("Present on the 6 cities the census counts by arrondissement: these figures are the sum of their arrondissements, not a count HCP publishes for the city."),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, level, topics }) => {
      let records: EconomyRecord[];
      if (unit !== undefined) {
        const found = resolve(lookup, unit, level);
        if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
        if (found.kind === "absent") return fail(`No unit has the identifier ${unit}. Call search to find its code.`);
        const body = await fetchJson(`/api/${COLLECTION[found.level]}/${found.code}/economy.json`);
        if (!body) return fail(`The establishments for ${unit} could not be read.`);
        records = [body.data as unknown as EconomyRecord];
      } else if (level !== undefined) {
        if (level !== "region" && level !== "province" && level !== "arrondissement") {
          return fail(`Without a unit, level can be region, province or arrondissement. To rank communes by a figure, call list_communes with sort.`);
        }
        const body = await fetchJson(`/api/${COLLECTION[level]}/economy.json`);
        if (!body) return fail(`The establishments for every ${level} could not be read.`);
        records = body.data as unknown as EconomyRecord[];
      } else {
        const body = await fetchJson("/api/economy.json");
        if (!body) return fail("The establishments for Morocco could not be read.");
        records = [body.data as unknown as EconomyRecord];
      }

      // In HCP's order, whatever order the topics were asked in.
      const pick = (t: Topics) => (topics ? Object.fromEntries(Object.entries(t).filter(([k]) => topics.includes(k))) : t);
      return ok({
        results: records.map((record) => ({
          unit: { code: record.code, level: record.level, name_fr: record.name.fr, name_ar: record.name.ar },
          figures: pick(record.topics),
          ...(record.basis ? { basis: record.basis } : {}),
        })),
      });
    },
  );

  server.registerTool(
    "get_housing",
    {
      title: "Urban housing stock",
      description:
        "HCP's 2024 count of urban dwellings for Morocco or any unit that has an urban area: how many there are, how many are occupied, " +
        "vacant or second homes, what kind they are (villa, apartment, traditional or modern Moroccan house, slum, rural-type), how old they " +
        "are, what their walls and roofs are made of, how many are on the public electricity, water and sewerage networks, and HCP's housing " +
        "shortfall. Every figure but the count is a percentage of that unit's urban dwellings. " +
        "This counts dwellings, not households: a vacant flat is here and in nobody's census record, and get_indicators describes the dwelling " +
        "each household lives in, for the whole country rather than the towns. A unit with no urban area has nothing here. " +
        "For the households with running water or electricity in any commune, rural ones included, use get_indicators' amenities topic, " +
        "and its wastewater topic for a public sewer; list_communes can sort by either, as in amenities.runningWater.",
      inputSchema: {
        unit: z
          .string()
          .min(1)
          .optional()
          .describe("A unit by code or slug. Morocco as a whole when left out."),
        level: z
          .enum(LEVELS)
          .optional()
          .describe("With a unit, the level it's at. Without one, region, province or arrondissement gives every one of that level."),
        topics: z.array(z.enum(HOUSING_TOPIC_NAMES)).optional().describe("Only these topics. Every topic when left out."),
      },
      outputSchema: {
        results: z.array(
          z.object({
            unit: z.object({
              code: z.string().nullable(),
              level: z.string(),
              name_fr: z.string(),
              name_ar: z.string().nullable(),
            }),
            figures: z.record(z.string(), z.record(z.string(), z.number().nullable())).describe("By topic, then by key."),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, level, topics }) => {
      let records: HousingRecord[];
      if (unit !== undefined) {
        const found = resolve(lookup, unit, level);
        if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
        if (found.kind === "absent") return fail(`No unit has the identifier ${unit}. Call search to find its code.`);
        const body = await fetchJson(`/api/${COLLECTION[found.level]}/${found.code}/housing.json`);
        if (!body) return fail(`${found.code} has no urban dwellings, so HCP publishes no housing stock for it.`);
        records = [body.data as unknown as HousingRecord];
      } else if (level !== undefined) {
        if (level !== "region" && level !== "province" && level !== "arrondissement") {
          return fail(`Without a unit, level can be region, province or arrondissement.`);
        }
        const body = await fetchJson(`/api/${COLLECTION[level]}/housing.json`);
        if (!body) return fail(`The housing stock of every ${level} could not be read.`);
        records = body.data as unknown as HousingRecord[];
      } else {
        const body = await fetchJson("/api/housing.json");
        if (!body) return fail("Morocco's housing stock could not be read.");
        records = [body.data as unknown as HousingRecord];
      }

      const pick = (t: Topics) => (topics ? Object.fromEntries(Object.entries(t).filter(([k]) => topics.includes(k))) : t);
      return ok({
        results: records.map((record) => ({
          unit: { code: record.code, level: record.level, name_fr: record.name.fr, name_ar: record.name.ar },
          figures: pick(record.topics),
        })),
      });
    },
  );

  server.registerTool(
    "get_insights",
    {
      title: "Figures that stand out in a commune",
      description:
        "For a commune, up to 3 of its 2024 census figures that stand out: among the highest or lowest communes, " +
        "moved far more or less than other communes since 2014, or far from its province's figure. " +
        "Each comes with its context as numbers, worked out from the census: the commune's other figures here, " +
        "the communes it borders on the same figure (their median and the one furthest from it), " +
        "and the same figure in 2014 beside Morocco's, where the two censuses can be compared. " +
        "A commune with any figure the two censuses disagree on is left out, on its own page and as a neighbour. " +
        "Figures they measure differently, shares by sex and likely errors in the data are left out too. " +
        "An economy or housing figure on fewer than 100 businesses or urban dwellings is left out, since a handful of them can swing a share. " +
        "A census figure in a commune of 2,000 households or more is marked sampled, since the long questionnaire went to a sample of households there. " +
        "No language model writes or judges any of it. Only communes have these, and most have none.",
      inputSchema: {
        unit: z.string().min(1).describe("A commune, by code or slug."),
        level: z
          .enum(LEVELS)
          .optional()
          .describe("The level, where a name is shared: Tiznit is a commune and a province, and a name alone means the commune."),
      },
      outputSchema: {
        unit: z.object({
          code: z.string(),
          level: z.string(),
          name_fr: z.string(),
          name_ar: z.string().nullable(),
        }),
        message: z.string().optional().describe("Present when no figures are published for this place."),
        findings: z.array(
          z.object({
            id: z.string(),
            kind: z
              .enum(["extreme", "change", "gap"])
              .describe("extreme: among the highest or lowest communes; change: moved far more or less than other communes since 2014; gap: far from its province's figure."),
            measure: z.string().describe("The figure's field, as get_indicators, get_economy and get_housing name it."),
            value: z.number().describe("The 2024 figure, or for a change the points it moved since 2014."),
            reference: z.number().describe("What it stands out from: the communes' mean, its province's figure, or 0 for a change."),
            direction: z.enum(["high", "low"]),
            sampled: z
              .boolean()
              .describe("True when the figure is a census figure in a commune of 2,000 households or more, where the long questionnaire went to a sample. False for an economy or housing figure, and for a smaller commune."),
            line: z.object({ en: z.string(), fr: z.string() }),
            breakdown: z.unknown().nullable().describe("The parts the figure is made of, where the dataset has them."),
            context: z.object({
              others: z
                .array(z.object({ id: z.string(), kind: z.string(), measure: z.string() }))
                .describe("The commune's other figures here."),
              neighbours: z
                .object({
                  bordering: z.number().describe("How many communes it borders."),
                  compared: z.number().describe("How many of them have the figure to compare; the median is over these."),
                  median: z.number(),
                  furthest: z.object({
                    code: z.string(),
                    name: z.object({ fr: z.string(), ar: z.string().nullable() }),
                    value: z.number(),
                  }).describe("The bordering commune whose figure is furthest from this one's."),
                })
                .nullable()
                .describe("The bordering communes on the same figure, or for a change on the same change; null when none can be compared."),
              since2014: z
                .object({ then: z.number(), now: z.number(), morocco: z.object({ then: z.number(), now: z.number() }) })
                .nullable()
                .describe("The figure in 2014 and 2024, here and across Morocco; null where the two censuses can't be compared."),
            }),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, level }) => {
      const found = resolve(lookup, unit, level);
      if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
      if (found.kind === "absent") return fail(`No unit has the identifier ${unit}. Call search to find its code.`);
      const unitOut = {
        code: found.code,
        level: found.level,
        name_fr: nameOf.get(found.code) ?? found.code,
        name_ar: arNameOf.get(found.code) ?? null,
      };
      if (found.level !== "commune") {
        return ok({ unit: unitOut, findings: [], message: `These figures cover only communes, and ${unitOut.name_fr} is a ${found.level}.` });
      }
      const body = await fetchJson(`/api/communes/${found.code}/insights.json`);
      if (!body) {
        return ok({ unit: unitOut, findings: [], message: `No figures are published for ${unitOut.name_fr}.` });
      }
      const record = body.data as unknown as {
        findings: {
          id: string;
          kind: "extreme" | "change" | "gap";
          measure: string;
          value: number;
          reference: number;
          direction: "high" | "low";
          line: { en: string; fr: string };
          breakdown: unknown;
          sampled?: boolean;
          context: { others: unknown[]; neighbours: unknown; since2014: unknown };
        }[];
      };
      return ok({
        unit: unitOut,
        findings: record.findings.map((f) => ({
          id: f.id,
          kind: f.kind,
          measure: f.measure,
          value: f.value,
          reference: f.reference,
          direction: f.direction,
          sampled: f.sampled === true,
          line: f.line,
          breakdown: f.breakdown,
          context: f.context,
        })),
      });
    },
  );

  server.registerTool(
    "get_neighbourhoods",
    {
      title: "A commune's neighbourhoods and postcodes",
      description:
        "The neighbourhoods OpenStreetMap and Poste Maroc name in a commune, a city's arrondissements included, with the arrondissement each was placed in where it has a point, " +
        "where its name comes from, and the postcodes Poste Maroc lists under it; and the commune's postcodes. " +
        "The census publishes nothing by neighbourhood: the figures are the commune's, or the arrondissement's. " +
        "To find which commune a neighbourhood is in, call search with its name instead.",
      inputSchema: {
        unit: z.string().min(1).describe("A commune, by code or slug."),
        limit: z.number().int().min(1).max(2000).optional().describe("How many neighbourhoods, in alphabetical order. 200 when left out; Casablanca has over 1,400."),
      },
      outputSchema: {
        unit: z.object({ code: z.string(), name_fr: z.string() }),
        total: z.number().describe("How many neighbourhoods the commune has, whatever the limit."),
        postcodes: z.array(z.string()),
        neighbourhoods: z.array(
          z.object({
            name_fr: z.string(),
            name_ar: z.string(),
            arrondissement: z.string().nullable().describe("The arrondissement's code, where it was placed in one by its point."),
            source: z.enum(["osm", "poste", "hand"]),
            postcodes: z.array(z.string()),
          }),
        ),
        message: z.string().optional().describe("Present when the commune has no named neighbourhoods, whether or not it has postcodes."),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, limit }) => {
      const found = resolve(lookup, unit, "commune");
      if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
      if (found.kind === "absent") return fail(`No commune has the identifier ${unit}. Call search to find its code.`);
      const unitOut = { code: found.code, name_fr: nameOf.get(found.code) ?? found.code };
      const body = await fetchJson(`/api/communes/${found.code}/neighbourhoods.json`);
      if (!body) return ok({ unit: unitOut, total: 0, postcodes: [], neighbourhoods: [], message: `No neighbourhoods or postcodes are named for ${unitOut.name_fr}.` });
      const data = body.data as unknown as {
        neighbourhoods: { name: { fr: string; ar: string }; arrondissement: string | null; source: "osm" | "poste" | "hand"; postcodes: string[] }[];
        postcodes: string[];
      };
      return ok({
        unit: unitOut,
        total: data.neighbourhoods.length,
        postcodes: data.postcodes,
        ...(data.neighbourhoods.length === 0 ? { message: `No neighbourhoods are named for ${unitOut.name_fr}; its postcodes are listed.` } : {}),
        neighbourhoods: data.neighbourhoods.slice(0, limit ?? 200).map((n) => ({
          name_fr: n.name.fr,
          name_ar: n.name.ar,
          arrondissement: n.arrondissement,
          source: n.source,
          postcodes: n.postcodes,
        })),
      });
    },
  );

  server.registerTool(
    "get_douars",
    {
      title: "A rural commune's douars",
      description:
        "The douars of a rural commune from HCP's 2024 census, the villages and hamlets it's made of, grouped in its fractions (mashyakha), named in Arabic only. " +
        "Each has its kind (grouped, split into sub-douars, or dispersed), its households and its people. " +
        "With figures, a douar of 30 households or more also has the nationality, sex, age, civil registration and marital status of its people, " +
        "the kind of dwelling its households live in, and the average distance in km from its dwellings to a paved road, an unpaved road a car can drive on, " +
        "a primary school, a collège, a lycée and a health centre. HCP withholds those for a smaller douar, and says null. " +
        "A town has no douars, though 21 communes counted as urban have some in their rural part.",
      inputSchema: {
        unit: z.string().min(1).describe("A commune, by code or slug."),
        fraction: z.string().regex(/^\d{10}$/).optional().describe("Only the douars of this fraction, by its 10-digit code."),
        figures: z.boolean().optional().describe("Include each douar's figures. Left out, a douar is its name, kind, households and people."),
      },
      outputSchema: {
        unit: z.object({ code: z.string(), name_fr: z.string() }),
        total: z.number().describe("How many douars are returned."),
        fractions: z.array(z.object({ code: z.string(), name_ar: z.string(), douars: z.number(), households: z.number(), population: z.number() })),
        douars: z.array(
          z.object({
            code: z.string(),
            fraction: z.string().describe("The fraction's code."),
            name_ar: z.string(),
            type: z.enum(["grouped", "split", "dispersed"]),
            households: z.number(),
            population: z.number(),
            figures: z.record(z.string(), z.record(z.string(), z.number().nullable())).nullable().optional().describe("Null where HCP withholds them."),
          }),
        ),
        message: z.string().optional().describe("Present when the commune has no douars."),
      },
      annotations: READ_ONLY,
    },
    async ({ unit, fraction, figures }) => {
      const found = resolve(lookup, unit, "commune");
      if (found.kind === "malformed") return fail(`${unit} is not a code or a slug.`);
      if (found.kind === "absent") return fail(`No commune has the identifier ${unit}. Call search to find its code.`);
      const unitOut = { code: found.code, name_fr: nameOf.get(found.code) ?? found.code };
      const body = await fetchJson(`/api/communes/${found.code}/douars.json`);
      if (!body) return ok({ unit: unitOut, total: 0, fractions: [], douars: [], message: `${unitOut.name_fr} has no douars: the census counts douars in rural areas only.` });
      const data = body.data as unknown as {
        fractions: { code: string; name: { ar: string }; douars: number; households: number; population: number }[];
        douars: { code: string; fraction: string; name: { ar: string }; type: "grouped" | "split" | "dispersed"; households: number; population: number; topics: Record<string, Record<string, number | null>> | null }[];
      };
      if (fraction && !data.fractions.some((f) => f.code === fraction)) {
        return fail(`${unitOut.name_fr} has no fraction ${fraction}. Its fractions are ${data.fractions.map((f) => f.code).join(", ")}.`);
      }
      const douars = data.douars.filter((d) => !fraction || d.fraction === fraction);
      return ok({
        unit: unitOut,
        total: douars.length,
        fractions: data.fractions
          .filter((f) => !fraction || f.code === fraction)
          .map((f) => ({ code: f.code, name_ar: f.name.ar, douars: f.douars, households: f.households, population: f.population })),
        douars: douars.map((d) => ({
          code: d.code,
          fraction: d.fraction,
          name_ar: d.name.ar,
          type: d.type,
          households: d.households,
          population: d.population,
          ...(figures ? { figures: d.topics } : {}),
        })),
      });
    },
  );

  return server;
}
