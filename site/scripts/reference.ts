/**
 * The API reference and the MCP tool list, generated from the code that serves them: the
 * routes from buildOpenApi, each example from the files the API emits or the functions the
 * Worker calls, and the tools from the MCP server itself. A docs page can't describe a
 * route or a tool that doesn't exist, and an example is always a real answer.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildIndex } from "../../api/src/emit/searchIndex.ts";
import { emitEconomy, emitHousing, emitIndicators, emitInsights, emitTree } from "../../api/src/emit/static.ts";
import { readIndicators } from "../../api/src/emit/indicators.ts";
import { readEconomy } from "../../api/src/emit/economy.ts";
import { readHousing } from "../../api/src/emit/housing.ts";
import { readInsights } from "../../api/src/emit/insights.ts";
import { buildIndicatorTable, type IndicatorRecord, type Topics } from "../../api/src/lib/indicators.ts";
import { envelope, PROBLEMS, problem, type Envelope } from "../../api/src/lib/envelope.ts";
import { listCommunes, parseFilter } from "../../api/src/lib/list.ts";
import { buildLookup } from "../../api/src/lib/resolve.ts";
import { near, search } from "../../api/src/lib/search.ts";
import type { Dataset } from "../../api/src/lib/dataset.ts";
import { createMcpServer } from "../../api/src/mcp/server.ts";
import { buildOpenApi } from "../../api/src/openapi.ts";
import { buildGeometry } from "../../api/src/emit/geometry.ts";
import { communeIn, featureContaining, prepareIndex, tileAt, tilePath } from "../../api/src/lib/locate.ts";

const level = async (name: string) =>
  JSON.parse(await readFile(`data/v1/attributes/${name}.json`, "utf8")) as never[];
const dataset: Dataset = {
  regions: await level("regions"),
  provinces: await level("provinces"),
  cercles: await level("cercles"),
  communes: await level("communes"),
  arrondissements: await level("arrondissements"),
  adjacency: JSON.parse(await readFile("data/v1/geometry/adjacency.json", "utf8")),
  sources: JSON.parse(await readFile("data/v1/sources.json", "utf8")),
};
const version = (dataset.sources as { datasetVersion: string }).datasetVersion;
const index = buildIndex(version, [
  { level: "commune", rows: dataset.communes as never[] },
  { level: "arrondissement", rows: dataset.arrondissements as never[] },
  { level: "province", rows: dataset.provinces as never[] },
  { level: "region", rows: dataset.regions as never[] },
  { level: "cercle", rows: dataset.cercles as never[] },
]);
const lookup = buildLookup(index);
const tree = emitTree(dataset);
const indicatorRecords = await readIndicators("data/v1");
emitIndicators(tree, indicatorRecords);
const economyRecords = await readEconomy("data/v1");
emitEconomy(tree, economyRecords);
emitHousing(tree, await readHousing("data/v1"));
emitInsights(tree, await readInsights("data/v1"));
const indicators = buildIndicatorTable(
  indicatorRecords.filter((r) => r.level === "commune"),
  economyRecords.filter((r) => r.level === "commune"),
);
const geometry = await buildGeometry("data/v1", dataset as never);
const tileIndex = prepareIndex(geometry.tileIndex);
const tiles = new Map([...geometry.tiles].map(([key, tile]) => [tilePath(key), tile]));
const fetchJson = async (path: string) =>
  ((tree.get(path) ?? tiles.get(path)) as Envelope<unknown[]> | undefined) ?? null;

/** The commune at a point, found the way the Worker finds it. */
const at = (lat: number, lng: number) => {
  const key = tileAt(tileIndex, lat, lng);
  const code = key ? communeIn(geometry.tiles.get(key)!, lat, lng) : null;
  if (!code) throw new Error(`the reference asks for the commune at ${lat}, ${lng}, and no boundary contains it`);
  return code;
};

const file = (path: string) => {
  const body = tree.get(path);
  if (!body) throw new Error(`the reference quotes ${path}, which the API doesn't emit`);
  return body as Envelope<unknown>;
};

interface Example {
  request: string;
  body: unknown;
  /** Set when a long list is cut for the page: how many rows show, out of how many. */
  cut?: { shown: number; total: number };
  /** Set when an indicators file is cut to a few topics for the page. */
  trimmed?: boolean;
}

/**
 * An indicators file with every area and sex kept but only a few topics in each, since the
 * whole of one runs to hundreds of lines.
 */
const trim = (request: string, body: Envelope<unknown>, people: string[], households: string[]): Example => {
  const keep = (t: Topics, topics: string[]) => Object.fromEntries(Object.entries(t).filter(([k]) => topics.includes(k)));
  const r = body.data as IndicatorRecord & { urbanCentres?: unknown[] };
  const data = {
    ...r,
    people: Object.fromEntries(
      Object.entries(r.people).map(([area, bySex]) => [
        area,
        bySex && Object.fromEntries(Object.entries(bySex).map(([sex, t]) => [sex, keep(t, people)])),
      ]),
    ),
    households: Object.fromEntries(Object.entries(r.households).map(([area, t]) => [area, t && keep(t, households)])),
  };
  return { request, body: { ...body, data }, trimmed: true };
};

/** Keeps the first rows of a list response, and says so. */
const cut = (request: string, body: Envelope<unknown>, keep: number): Example => {
  const rows = body.data as unknown[];
  if (rows.length <= keep) return { request, body };
  return { request, body: { ...body, data: rows.slice(0, keep) }, cut: { shown: keep, total: rows.length } };
};

const computed = (request: string, rows: unknown[]) =>
  envelope(rows, { self: request }, { total: rows.length }) as Envelope<unknown>;

const listed = async (request: string, input: Parameters<typeof parseFilter>[0]) => {
  const parsed = parseFilter(input, lookup);
  if ("error" in parsed) throw new Error(`${request}: ${parsed.error.detail}`);
  const result = await listCommunes(parsed.query, dataset.communes as never[], fetchJson, indicators);
  if (!result) throw new Error(`${request} has no page`);
  // The links the Worker writes: the same query with page set.
  const { page, totalPages } = result.meta;
  const next = page < totalPages ? `${request}&page=${page + 1}` : null;
  return envelope(result.rows, { self: request, prev: null, next }, result.meta) as Envelope<unknown>;
};

const examples: Record<string, Example> = {
  searchUnits: { request: "/api/search?q=fez&limit=2", body: computed("/api/search?q=fez&limit=2", search(index, "fez", { limit: 2 })) },
  communeAt: (() => {
    // The Worker's answer: the commune's record, and the arrondissement the point is in.
    const [lat, lng] = [35.786, -5.8125];
    const code = at(lat, lng);
    const record = file(`/api/communes/${code}.json`);
    const city = geometry.arrondissementsByCommune.get(code);
    const hit = city ? featureContaining(city.features as never[], lat, lng) : null;
    const arrondissement = hit
      ? { code: (hit as { properties: { code: string } }).properties.code, name: { fr: (hit as { properties: { name_fr: string } }).properties.name_fr, ar: (hit as { properties: { name_ar: string } }).properties.name_ar } }
      : null;
    return {
      request: `/api/communes/at?lat=${lat}&lng=${lng}`,
      body: { ...record, data: { ...(record.data as object), arrondissement } },
    };
  })(),
  communesNear: {
    request: "/api/communes/near?lat=33.5731&lng=-7.5898&radius=15&limit=2",
    body: computed("/api/communes/near?lat=33.5731&lng=-7.5898&radius=15&limit=2", near(index, 33.5731, -7.5898, 15, 2)),
  },
  listCommunes: cut(
    "/api/communes?type=urban&sort=-population",
    await listed("/api/communes?type=urban&sort=-population", { type: "urban", sort: "-population" }),
    1,
  ),
  getCommune: { request: "/api/communes/tanger", body: file("/api/communes/01.511.01.0.json") },
  listArrondissements: cut(
    "/api/communes/01.511.01.0/arrondissements.json",
    file("/api/communes/01.511.01.0/arrondissements.json"),
    2,
  ),
  listRegions: cut("/api/regions.json", file("/api/regions.json"), 2),
  listProvinces: cut("/api/provinces.json", file("/api/provinces.json"), 2),
  listCercles: cut("/api/cercles.json", file("/api/cercles.json"), 2),
  getIndicators: trim(
    "/api/communes/tanger/indicators",
    file("/api/communes/01.511.01.0/indicators.json"),
    ["population", "labour"],
    ["amenities"],
  ),
  getNationalIndicators: trim("/api/indicators.json", file("/api/indicators.json"), ["fertility", "localLanguages"], ["households"]),
  getEconomy: { request: "/api/communes/tiznit/economy", body: file("/api/communes/09.581.01.07/economy.json") },
  getNationalEconomy: { request: "/api/economy.json", body: file("/api/economy.json") },
  getHousing: { request: "/api/communes/tiznit/housing", body: file("/api/communes/09.581.01.07/housing.json") },
  listNeighbours: { request: "/api/communes/tiznit/neighbours", body: file("/api/communes/09.581.01.07/neighbours.json") },
  getNationalHousing: { request: "/api/housing.json", body: file("/api/housing.json") },
  listInsights: { request: "/api/insights.json", body: file("/api/insights.json") },
  getVersion: { request: "/api/version.json", body: file("/api/version.json") },
};

const spec = buildOpenApi({ version });
const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ path, method, op: op as { operationId: string } })),
);
for (const { op } of operations) {
  if (!examples[op.operationId]) throw new Error(`no example for ${op.operationId}`);
}

/**
 * The pre-rendered files the spec leaves out, each with one real path. A pattern whose
 * example isn't emitted fails the build.
 */
const files = [
  { key: "region", pattern: "/api/regions/{code}.json", example: "/api/regions/01.json" },
  { key: "regionProvinces", pattern: "/api/regions/{code}/provinces.json", example: "/api/regions/01/provinces.json" },
  { key: "regionCommunes", pattern: "/api/regions/{code}/communes/page/{n}.json", example: "/api/regions/01/communes/page/1.json" },
  { key: "province", pattern: "/api/provinces/{code}.json", example: "/api/provinces/01.511.json" },
  { key: "provinceCercles", pattern: "/api/provinces/{code}/cercles.json", example: "/api/provinces/01.511/cercles.json" },
  { key: "provinceCommunes", pattern: "/api/provinces/{code}/communes/page/{n}.json", example: "/api/provinces/01.511/communes/page/1.json" },
  { key: "cercle", pattern: "/api/cercles/{code}.json", example: "/api/cercles/01.511.05.json" },
  { key: "cercleCommunes", pattern: "/api/cercles/{code}/communes/page/{n}.json", example: "/api/cercles/01.511.05/communes/page/1.json" },
  { key: "communes", pattern: "/api/communes/page/{n}.json", example: "/api/communes/page/1.json" },
  { key: "communesByType", pattern: "/api/communes/type/{type}/page/{n}.json", example: "/api/communes/type/rural/page/1.json" },
  { key: "commune", pattern: "/api/communes/{code}.json", example: "/api/communes/01.511.01.0.json" },
  { key: "arrondissements", pattern: "/api/arrondissements.json", example: "/api/arrondissements.json" },
  { key: "arrondissement", pattern: "/api/arrondissements/{code}.json", example: "/api/arrondissements/01.511.01.05.json" },
  { key: "boundary", pattern: "/api/communes/{code}/boundary.geojson", example: "/api/communes/01.511.01.0/boundary.geojson" },
  { key: "neighbours", pattern: "/api/communes/{code}/neighbours.json", example: "/api/communes/09.581.01.07/neighbours.json" },
  { key: "cityArrondissements", pattern: "/api/communes/{code}/arrondissements.geojson", example: "/api/communes/01.511.01.0/arrondissements.geojson" },
  { key: "arrondissementBoundary", pattern: "/api/arrondissements/{code}/boundary.geojson", example: "/api/arrondissements/01.511.01.05/boundary.geojson" },
  { key: "provinceBoundary", pattern: "/api/provinces/{code}/boundary.geojson", example: "/api/provinces/01.511/boundary.geojson" },
  { key: "regionBoundary", pattern: "/api/regions/{code}/boundary.geojson", example: "/api/regions/01/boundary.geojson" },
  { key: "regionsIndicators", pattern: "/api/regions/indicators.json", example: "/api/regions/indicators.json" },
  { key: "provincesIndicators", pattern: "/api/provinces/indicators.json", example: "/api/provinces/indicators.json" },
  { key: "regionsEconomy", pattern: "/api/regions/economy.json", example: "/api/regions/economy.json" },
  { key: "provincesEconomy", pattern: "/api/provinces/economy.json", example: "/api/provinces/economy.json" },
  { key: "arrondissementsIndicators", pattern: "/api/arrondissements/indicators.json", example: "/api/arrondissements/indicators.json" },
  { key: "arrondissementsEconomy", pattern: "/api/arrondissements/economy.json", example: "/api/arrondissements/economy.json" },
  { key: "regionsHousing", pattern: "/api/regions/housing.json", example: "/api/regions/housing.json" },
  { key: "provincesHousing", pattern: "/api/provinces/housing.json", example: "/api/provinces/housing.json" },
  { key: "tiles", pattern: "/api/tiles/{z}/{x}/{y}.json", example: tilePath(geometry.tileIndex.leaf[0]!) },
] as const;
const written = new Set([
  ...tree.keys(),
  ...tiles.keys(),
  ...[...geometry.communes.keys()].map((code) => `/api/communes/${code}/boundary.geojson`),
  ...[...geometry.provinceOutlines.keys()].map((code) => `/api/provinces/${code}/boundary.geojson`),
  ...[...geometry.arrondissements.keys()].map((code) => `/api/arrondissements/${code}/boundary.geojson`),
  ...[...geometry.arrondissementsByCommune.keys()].map((code) => `/api/communes/${code}/arrondissements.geojson`),
  ...[...geometry.regionOutlines.keys()].map((code) => `/api/regions/${code}/boundary.geojson`),
  // The API build writes the spec beside the rest, and the API page links to it.
  "/api/openapi.json",
]);
for (const f of files) {
  if (!written.has(f.example)) throw new Error(`the reference quotes ${f.example}, which the API doesn't emit`);
}
// Every file the API build writes under /api, for the page that counts them.
const apiFiles = written.size;

const errors = Object.fromEntries(
  Object.entries(PROBLEMS).map(([kind, { status, title }]) => [kind, { status, title }]),
);
const errorExample = problem("not-found", "no unit has code 99.999", "/api/communes/99.999", "https://<host>");

// The tools as a client lists them, from a server connected the way the Worker connects it.
const server = createMcpServer({ index, lookup, fetchJson, tiles: tileIndex, communes: dataset.communes as never[], indicators });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "docs", version });
await client.connect(clientSide);
const { tools } = await client.listTools();
const mcp = {
  instructions: client.getInstructions() ?? "",
  tools: tools.map((tool) => ({
    name: tool.name,
    title: tool.title ?? tool.name,
    description: tool.description ?? "",
    params: Object.entries((tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>).map(
      ([name, schema]) => ({
        name,
        required: (tool.inputSchema.required ?? []).includes(name),
        schema,
      }),
    ),
  })),
};
await client.close();

await mkdir("site/src/generated", { recursive: true });
await writeFile(
  "site/src/generated/reference.ts",
  `// Generated by site/scripts/reference.ts from the API's own code. Do not edit.\n` +
    `export const reference = ${JSON.stringify({ version, apiFiles, spec, operations, examples, files, errors, errorExample }, null, 2)};\n`,
);
await writeFile(
  "site/src/generated/mcp.ts",
  `// Generated by site/scripts/reference.ts from the MCP server. Do not edit.\n` +
    `export const mcp = ${JSON.stringify(mcp, null, 2)};\n`,
);
console.log(`reference: ${operations.length} routes, ${files.length} files; mcp: ${mcp.tools.length} tools`);
