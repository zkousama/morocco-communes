import { LIMIT, PAGE, PER_PAGE, QUERY, RADIUS_KM } from "./lib/params.ts";

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
        "Every région, province, préfecture, cercle, commune and arrondissement in Morocco, with official HCP geographic codes, names in French and Arabic, 2024 and 2014 census population, and boundaries from OpenStreetMap.\n\n" +
        "An identifier can be written 4 ways and all resolve to one unit: the dotted HCP code (`01.511.01.0`), the code zero-padded to 9 digits (`001511010`), the digits with leading zeros dropped (`1511010`), or a slug (`tanger`).\n\n" +
        "Every response is an envelope of `data`, `meta` and `links`. Errors are RFC 9457 problem documents. Routes ending in `.json` are static files and cost nothing to call; the rest run in a Worker.",
      license: { name: "MIT (code). Attributes: HCP. Boundaries: ODbL-1.0.", identifier: "MIT" },
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
            "Matches French names, Arabic names and slugs. Accents, Arabic letter variants and vowel marks are folded, and places are also found by other names they go by, such as Fez for Fès.",
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
            "Tested against each commune's boundary, which is accurate to about 2 m. Sidi Mohamed Benmansour has no boundary, and neither do about 88 km² between Ifrane and Boulemane.",
          parameters: [
            { name: "lat", in: "query", required: true, description: "Latitude, in degrees.", schema: { type: "number", minimum: -90, maximum: 90 }, example: 35.786 },
            { name: "lng", in: "query", required: true, description: "Longitude, in degrees.", schema: { type: "number", minimum: -180, maximum: 180 }, example: -5.8125 },
          ],
          responses: {
            "200": ok("The commune.", ref("Commune")),
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
            "200": ok("A page of communes.", { type: "array", items: ref("Commune") }),
            "400": problem("A filter is not a valid code or names the wrong kind of unit, type or page is out of range, or q is given with a filter."),
            "404": problem("A filter names a unit that does not exist, or the page is past the last."),
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
            matched: { type: "string", enum: ["exact", "alias", "prefix", "trigram"] },
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
          },
        },
      },
    },
  };
}
