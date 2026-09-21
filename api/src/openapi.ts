import { LIMIT, PAGE, PER_PAGE, POPULATION, QUERY, RADIUS_KM } from "./lib/params.ts";
import { HOUSEHOLD_TOPICS, PEOPLE_TOPICS } from "./lib/indicators.ts";
import { ECONOMY_TOPICS } from "./lib/economy.ts";
import { HOUSING_TOPICS } from "./lib/housing.ts";

/**
 * The OpenAPI 3.1 description of the API, built from the same limits the Worker enforces,
 * so an agent framework that turns it into tools gets the real defaults and bounds.
 * Served at /api/openapi.json.
 */
export function buildOpenApi(opts: { version: string; serverUrl?: string }) {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const envelopeOf = (data: object) => ({
    allOf: [ref("Envelope"), { type: "object", properties: { data } }],
  });
  const ok = (description: string, data: object) => ({
    description,
    content: { "application/json": { schema: envelopeOf(data) } },
  });
  const problem = (description: string) => ({
    description,
    content: { "application/problem+json": { schema: ref("Problem") } },
  });
  const code = (description: string, example: string) => ({
    name: "code",
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
    example,
  });
  const limit = {
    name: "limit",
    in: "query",
    description: `How many results to return, up to ${LIMIT.max}.`,
    schema: { type: "integer", minimum: 1, maximum: LIMIT.max, default: LIMIT.default },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Morocco communes API",
      version: opts.version,
      summary: "Morocco's administrative divisions as open data.",
      description:
        "Every région, province, préfecture, cercle, commune and arrondissement in Morocco, with official HCP geographic codes, names in French and Arabic, 2024 and 2014 census population, area and density, HCP's census indicators for both years, the 2024 count of economic establishments, the 2024 urban housing stock, and boundaries from OpenStreetMap.\n\n" +
        "An identifier can be written 4 ways and all resolve to one unit: the dotted HCP code (`01.511.01.0`), the code zero-padded to 9 digits (`001511010`), the digits with leading zeros dropped (`1511010`), or a slug (`tanger`).\n\n" +
        "Every response is an envelope of `data`, `meta` and `links`. Errors are RFC 9457 problem documents. Routes ending in `.json` are static files and cost nothing to call; the rest run in a Worker.",
      license: { name: "MIT (code). Attributes, indicators and establishments: HCP. Boundaries: ODbL-1.0.", identifier: "MIT" },
    },
    servers: [{ url: opts.serverUrl ?? "/" }],
    // Public and unauthenticated: an empty list says so explicitly.
    security: [],
    paths: {
      "/api/search": {
        get: {
          operationId: "searchUnits",
          summary: "Find any administrative unit by name",
          description:
            "Matches French names, Arabic names, slugs and codes, dotted, zero-padded or without their leading zeros. Accents, Arabic letter variants and vowel marks are folded, and places are also found by other names they go by, such as Fez for Fès.",
          parameters: [
            { name: "q", in: "query", required: true, description: `Text to find, up to ${QUERY.maxLength} characters.`, schema: { type: "string", minLength: 1, maxLength: QUERY.maxLength }, example: "tanger" },
            {
              name: "levels",
              in: "query",
              description: "Levels to include, separated by commas. All levels when omitted.",
              schema: { type: "string" },
              example: "commune,arrondissement",
            },
            limit,
          ],
          responses: {
            "200": ok("Matches, best first.", { type: "array", items: ref("SearchHit") }),
            "400": problem("q is missing or too long, or a parameter is out of range."),
          },
        },
      },
      "/api/communes/at": {
        get: {
          operationId: "communeAt",
          summary: "The commune that contains a point",
          description:
            "Tested against each commune's boundary, stored on a grid of 2 to 6 m depending on the size of its région. In the 6 cities divided into arrondissements, `arrondissement` names the one the point is in; elsewhere it's null. Sidi Mohamed Benmansour has no boundary, and neither do about 88 km² between Ifrane and Boulemane.",
          parameters: [
            { name: "lat", in: "query", required: true, description: "Latitude, in degrees.", schema: { type: "number", minimum: -90, maximum: 90 }, example: 35.786 },
            { name: "lng", in: "query", required: true, description: "Longitude, in degrees.", schema: { type: "number", minimum: -180, maximum: 180 }, example: -5.8125 },
          ],
          responses: {
            "200": ok("The commune, with the arrondissement the point is in.", {
              allOf: [
                ref("Commune"),
                {
                  type: "object",
                  required: ["arrondissement"],
                  properties: {
                    arrondissement: {
                      type: ["object", "null"],
                      properties: { code: { type: "string" }, name: ref("Name") },
                    },
                  },
                },
              ],
            }),
            "400": problem("A coordinate is missing or out of range."),
            "404": problem("No commune boundary contains the point: it's outside Morocco, at sea, or in one of the 2 places without one."),
          },
        },
      },
      "/api/communes/near": {
        get: {
          operationId: "communesNear",
          summary: "Communes within a radius of a point",
          description: "Distance is measured to each commune's centroid, nearest first.",
          parameters: [
            { name: "lat", in: "query", required: true, description: "Latitude, in degrees.", schema: { type: "number", minimum: -90, maximum: 90 }, example: 33.5731 },
            { name: "lng", in: "query", required: true, description: "Longitude, in degrees.", schema: { type: "number", minimum: -180, maximum: 180 }, example: -7.5898 },
            {
              name: "radius",
              in: "query",
              description: `Distance in km, up to ${RADIUS_KM.max}.`,
              schema: { type: "number", exclusiveMinimum: 0, maximum: RADIUS_KM.max, default: RADIUS_KM.default },
            },
            limit,
          ],
          responses: {
            "200": ok("Communes within the radius, nearest first.", { type: "array", items: ref("NearHit") }),
            "400": problem("A coordinate or the radius is missing or out of range."),
          },
        },
      },
      "/api/communes": {
        get: {
          operationId: "listCommunes",
          summary: "List communes, optionally filtered",
          description:
            `Paginated, ${PER_PAGE} communes to a page. Filters combine. \`q\` searches communes by name instead, and can't be given with a filter or \`page\`.`,
          parameters: [
            { name: "region", in: "query", description: "A région, by code or slug.", schema: { type: "string" }, example: "01" },
            { name: "province", in: "query", description: "A province or préfecture, by code or slug.", schema: { type: "string" }, example: "01.511" },
            { name: "cercle", in: "query", description: "A cercle, by code or slug.", schema: { type: "string" } },
            { name: "type", in: "query", description: "Urban or rural communes only.", schema: { type: "string", enum: ["urban", "rural"] } },
            {
              name: "min_population",
              in: "query",
              description: "Only communes with at least this many people in 2024.",
              schema: { type: "integer", minimum: 0, maximum: POPULATION.max },
              example: 100000,
            },
            {
              name: "max_population",
              in: "query",
              description: "Only communes with at most this many people in 2024.",
              schema: { type: "integer", minimum: 0, maximum: POPULATION.max },
            },
            {
              name: "sort",
              in: "query",
              description:
                "Order by `name`, `population` in 2024, `change` since 2014, `density` or `area`, or by a census indicator's path, such as `labour.unemploymentRate`. Put `2014.` before the path for the 2014 figure, or `change.` for how far it moved between the censuses, as in `change.illiteracy.rate10Plus`; both are offered for the figures the two censuses ask the same way. An establishment count goes under `economy.`, as in `economy.establishments.jobs`, and 3 more are worked out from those counts rather than published: `economy.per1000.establishments`, `economy.per1000.jobs` and `economy.perBusiness.jobs`, which rank by how much of something a place has for its size. A leading minus puts the largest first, and a commune with no value comes last either way. Sorted by a figure, each commune carries `indicator`, its value, `derived` where the value came from a division, and `basis` where it was summed from a city's arrondissements.",
              // A string rather than an enum: with every indicator path both ways it would be
              // 214 values, which the server checks anyway, naming a topic's keys when one is wrong.
              schema: { type: "string", default: "code", examples: ["-population", "-labour.unemploymentRate", "-economy.per1000.jobs"] },
              example: "-population",
            },
            {
              name: "page",
              in: "query",
              description: "Page number, from 1.",
              schema: { type: "integer", minimum: 1, maximum: PAGE.max, default: PAGE.default },
            },
            {
              name: "q",
              in: "query",
              description: `Search communes by name, up to ${QUERY.maxLength} characters, returning up to 10 matches. Takes no other parameter.`,
              schema: { type: "string", minLength: 1, maxLength: QUERY.maxLength },
            },
          ],
          responses: {
            "200": ok("A page of communes, or search hits when q is given.", {
              type: "array",
              items: { oneOf: [ref("Commune"), ref("SearchHit")] },
            }),
            "400": problem("A filter isn't a valid code or names the wrong kind of unit, a parameter is out of range, or q is given with another parameter."),
            "404": problem("A filter names a unit that doesn't exist, or the page is past the last."),
          },
        },
      },
      "/api/communes/{code}": {
        get: {
          operationId: "getCommune",
          summary: "One commune by any spelling of its identifier",
          parameters: [code("A dotted code, padded or unpadded digits, or a slug.", "tanger")],
          responses: {
            "200": ok("The commune.", ref("Commune")),
            "400": problem("Not an identifier."),
            "404": problem("No commune has that identifier."),
          },
        },
      },
      "/api/communes/{code}/arrondissements.json": {
        get: {
          operationId: "listArrondissements",
          summary: "The arrondissements of a commune",
          description: "Only 6 communes have arrondissements; every other commune returns an empty list.",
          parameters: [code("The dotted commune code.", "01.511.01.0")],
          responses: {
            "200": ok("The commune's arrondissements.", { type: "array", items: { type: "object" } }),
            "404": problem("No commune has that code."),
          },
        },
      },
      "/api/{collection}/{code}/indicators": {
        get: {
          operationId: "getIndicators",
          summary: "A unit's figures from the 2024 and 2014 censuses",
          description:
            "HCP's indicators for a région, province, cercle, commune or arrondissement: age, marital status, fertility, disability, schooling, literacy and languages, education and work, and each household's dwelling, amenities, wastewater, waste and cooking fuel. " +
            "For the whole unit, its urban and its rural part, and for men and women. Shares and rates are percentages. Most come from the long questionnaire, which went to a random 20% of households in communes of 2,000 households or more, so there they're estimates. " +
            "The 2024 figures are at the top level and the 2014 census is under `2014`, null for a unit it didn't count. " +
            "A commune's file carries its urban centres' figures too. `/data/v1/indicators/fields.json` names every field with HCP's heading, and `/data/v1/indicators/2014/fields.json` names the 2014 fields and which of them can be read against 2024.",
          parameters: [
            {
              name: "collection",
              in: "path",
              required: true,
              description: "The unit's level.",
              schema: { type: "string", enum: ["regions", "provinces", "cercles", "communes", "arrondissements"] },
              example: "communes",
            },
            code("A dotted code, padded or unpadded digits, or a slug.", "tanger"),
          ],
          responses: {
            "200": ok("The unit's indicators.", ref("Indicators")),
            "400": problem("Not an identifier."),
            "404": problem("No unit has that identifier, or it's in another collection."),
          },
        },
      },
      "/api/indicators.json": {
        get: {
          operationId: "getNationalIndicators",
          summary: "Morocco's figures from the 2024 and 2014 censuses",
          description: "The same indicators for the country as a whole.",
          responses: { "200": ok("Morocco's indicators.", ref("Indicators")) },
        },
      },
      "/api/{collection}/{code}/economy": {
        get: {
          operationId: "getEconomy",
          summary: "A unit's economic establishments, counted during the 2024 census",
          description:
            "How many establishments HCP's field teams mapped in a région, province, cercle, commune or arrondissement, how many are public services, associations or businesses, and how many permanent jobs those businesses hold. " +
            "The businesses are split by sector, by how many people work there and by when they were founded, each split covering all of them. The weekly souks in use are counted beside them. " +
            "Farming is out: every sector but agriculture is counted. The 6 cities with arrondissements are counted by arrondissement, so their figures are the sum of those, marked `basis`. " +
            "`/data/v1/economy/fields.json` names every field with HCP's heading.",
          parameters: [
            {
              name: "collection",
              in: "path",
              required: true,
              description: "The unit's level.",
              schema: { type: "string", enum: ["regions", "provinces", "cercles", "communes", "arrondissements"] },
              example: "communes",
            },
            code("A dotted code, padded or unpadded digits, or a slug.", "tanger"),
          ],
          responses: {
            "200": ok("The unit's establishments.", ref("Economy")),
            "400": problem("Not an identifier."),
            "404": problem("No unit has that identifier, or it's in another collection."),
          },
        },
      },
      "/api/economy.json": {
        get: {
          operationId: "getNationalEconomy",
          summary: "Morocco's economic establishments, counted during the 2024 census",
          description: "The same counts for the country as a whole.",
          responses: { "200": ok("Morocco's establishments.", ref("Economy")) },
        },
      },
      "/api/{collection}/{code}/housing": {
        get: {
          operationId: "getHousing",
          summary: "A unit's urban housing stock, counted at the 2024 census",
          description:
            "How many urban dwellings a unit has, how many are occupied, vacant or second homes, what kind they are, how old, what their walls and roofs are made of, how many are on the public electricity, water and sewerage networks, and HCP's housing shortfall. " +
            "Every figure but the count is a percentage of that unit's urban dwellings. This counts dwellings rather than households: a vacant flat is here and in nobody's census record. " +
            "A unit with no urban area has no file. `/data/v1/housing/fields.json` names every field with the workbook's own wording.",
          parameters: [
            {
              name: "collection",
              in: "path",
              required: true,
              description: "The unit's level.",
              schema: { type: "string", enum: ["regions", "provinces", "cercles", "communes", "arrondissements"] },
              example: "communes",
            },
            code("A dotted code, padded or unpadded digits, or a slug.", "tiznit"),
          ],
          responses: {
            "200": ok("The unit's urban housing stock.", ref("Housing")),
            "400": problem("Not an identifier."),
            "404": problem("No unit has that identifier, it's in another collection, or it has no urban dwellings."),
          },
        },
      },
      "/api/communes/{code}/neighbours": {
        get: {
          operationId: "listNeighbours",
          summary: "The communes that border a commune",
          description:
            "Each with its names and the length of the border the two share, in km, measured along their OpenStreetMap boundaries. " +
            "Sidi Mohamed Benmansour has no boundary, so its list is empty.",
          parameters: [code("A dotted code, padded or unpadded digits, or a slug.", "tiznit")],
          responses: {
            "200": ok("The communes it borders.", { type: "array", items: ref("Neighbour") }),
            "400": problem("Not an identifier."),
            "404": problem("No commune has that identifier."),
          },
        },
      },
      "/api/housing.json": {
        get: {
          operationId: "getNationalHousing",
          summary: "Morocco's urban housing stock, counted at the 2024 census",
          description: "The same figures for every town in the country together.",
          responses: { "200": ok("Morocco's urban housing stock.", ref("Housing")) },
        },
      },
      "/api/regions.json": {
        get: {
          operationId: "listRegions",
          summary: "All 12 régions",
          responses: { "200": ok("Every région.", { type: "array", items: { type: "object" } }) },
        },
      },
      "/api/provinces.json": {
        get: {
          operationId: "listProvinces",
          summary: "All provinces and préfectures",
          responses: { "200": ok("Every province and préfecture.", { type: "array", items: { type: "object" } }) },
        },
      },
      "/api/cercles.json": {
        get: {
          operationId: "listCercles",
          summary: "All cercles",
          responses: { "200": ok("Every cercle.", { type: "array", items: { type: "object" } }) },
        },
      },
      "/api/version.json": {
        get: {
          operationId: "getVersion",
          summary: "Dataset version, record counts and the vintage of every source",
          responses: { "200": ok("The version document.", { type: "object" }) },
        },
      },
    },
    components: {
      schemas: {
        Envelope: {
          type: "object",
          required: ["data", "meta", "links"],
          properties: {
            data: {},
            meta: {
              type: "object",
              required: ["datasetVersion"],
              properties: {
                datasetVersion: { type: "string" },
                page: { type: "integer" },
                perPage: { type: "integer" },
                total: { type: "integer" },
                totalPages: { type: "integer" },
              },
            },
            links: {
              type: "object",
              required: ["self", "prev", "next"],
              properties: {
                self: { type: "string" },
                prev: { type: ["string", "null"] },
                next: { type: ["string", "null"] },
              },
            },
          },
        },
        Problem: {
          type: "object",
          required: ["type", "title", "status", "detail", "instance"],
          properties: {
            type: { type: "string", format: "uri" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string" },
          },
        },
        Neighbour: {
          type: "object",
          required: ["code", "name", "km"],
          properties: {
            code: { type: "string" },
            name: ref("Name"),
            km: { type: "number", description: "The length of the border the two communes share." },
          },
        },
        Name: {
          type: "object",
          required: ["fr", "ar"],
          properties: { fr: { type: "string" }, ar: { type: "string" } },
        },
        SearchHit: {
          type: "object",
          required: ["code", "level", "name", "slug", "score", "matched"],
          properties: {
            code: { type: "string" },
            level: { type: "string", enum: ["commune", "arrondissement", "province", "region", "cercle"] },
            name: ref("Name"),
            slug: { type: "string" },
            score: { type: "number" },
            matched: { type: "string", enum: ["code", "exact", "alias", "prefix", "spelling", "trigram"] },
          },
        },
        NearHit: {
          type: "object",
          required: ["code", "name", "slug", "distanceKm"],
          properties: {
            code: { type: "string" },
            name: ref("Name"),
            slug: { type: "string" },
            distanceKm: { type: "number" },
          },
        },
        Indicators: {
          type: "object",
          required: ["code", "level", "name", "fromLocalAdministration", "people", "households"],
          properties: {
            code: { type: ["string", "null"], description: "Null for Morocco." },
            codeDigits: { type: ["string", "null"] },
            level: { type: "string", enum: ["country", "region", "province", "cercle", "commune", "arrondissement", "urbanCentre"] },
            name: { type: "object", properties: { fr: { type: "string" }, ar: { type: ["string", "null"] } } },
            fromLocalAdministration: {
              type: "boolean",
              description: "HCP collected the figures from the local administration, as the population moves with the seasons. Only the counts are published.",
            },
            people: {
              type: "object",
              description: `By area (total, urban, rural; null where the unit has none of it), then by sex (all, male, female), then by topic: ${PEOPLE_TOPICS.join(", ")}.`,
            },
            households: {
              type: "object",
              description: `By area, then by topic: ${HOUSEHOLD_TOPICS.join(", ")}.`,
            },
            "2014": {
              type: ["object", "null"],
              description:
                "The same figures from the 2014 census, as `people` and `households`, for a unit it counted. Null for one it didn't: the 6 cities with arrondissements, which 2014 published by arrondissement, and units drawn since.",
            },
            urbanCentres: { type: "array", description: "A commune's urban centres, each with the same fields.", items: { type: "object" } },
          },
        },
        Economy: {
          type: "object",
          required: ["code", "level", "name", "topics"],
          properties: {
            code: { type: ["string", "null"], description: "Null for Morocco." },
            codeDigits: { type: ["string", "null"] },
            level: { type: "string", enum: ["country", "region", "province", "cercle", "commune", "arrondissement"] },
            name: { type: "object", properties: { fr: { type: "string" }, ar: { type: ["string", "null"] } } },
            basis: {
              type: "string",
              enum: ["arrondissement_sum"],
              description:
                "Present on the 6 cities the census counts by arrondissement: these figures are the exact sum of their arrondissements rather than a count HCP publishes for the city. Absent everywhere else.",
            },
            topics: {
              type: "object",
              description: `By topic, then by key: ${[...ECONOMY_TOPICS.keys()].join(", ")}. Every figure is a count of establishments, of permanent jobs, or of weekly souks.`,
            },
          },
        },
        Housing: {
          type: "object",
          required: ["code", "level", "name", "topics"],
          properties: {
            code: { type: ["string", "null"], description: "Null for Morocco." },
            codeDigits: { type: ["string", "null"] },
            level: { type: "string", enum: ["country", "region", "province", "cercle", "commune", "arrondissement", "urbanCentre"] },
            name: { type: "object", properties: { fr: { type: "string" }, ar: { type: ["string", "null"] } } },
            topics: {
              type: "object",
              description: `By topic, then by key: ${[...HOUSING_TOPICS.keys()].join(", ")}. Every figure but dwellings.total is a percentage of that unit's urban dwellings.`,
            },
            urbanCentres: { type: "array", description: "A commune's urban centres, each with the same fields.", items: { type: "object" } },
          },
        },
        Commune: {
          type: "object",
          required: ["code", "codeDigits", "slug", "name", "type", "parents", "population"],
          properties: {
            code: { type: "string", description: "Dotted HCP geographic code.", example: "01.511.01.0" },
            codeDigits: { type: "string", description: "The code zero-padded to 9 digits.", example: "001511010" },
            slug: { type: "string", example: "tanger" },
            name: ref("Name"),
            type: { type: "string", enum: ["urban", "rural"] },
            parents: {
              type: "object",
              properties: {
                region: { type: "string" },
                province: { type: "string" },
                cercle: { type: ["string", "null"], description: "Null for urban communes." },
              },
            },
            population: {
              type: "object",
              description: "2024 and 2014 census figures, and the change between them.",
            },
            centroid: {
              type: ["object", "null"],
              description: "A point inside the commune. Null where OpenStreetMap has no boundary.",
              properties: { lat: { type: "number" }, lng: { type: "number" } },
            },
            bbox: { type: ["array", "null"], items: { type: "number" }, minItems: 4, maxItems: 4 },
            areaKm2: { type: ["number", "null"], description: "Area in km², from the boundary. Null where there's none." },
            density: { type: ["number", "null"], description: "People per km² in 2024." },
          },
        },
      },
    },
  };
}
