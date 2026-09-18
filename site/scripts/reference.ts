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
import { emitTree } from "../../api/src/emit/static.ts";
import { envelope, PROBLEMS, problem, type Envelope } from "../../api/src/lib/envelope.ts";
import { listCommunes, parseFilter } from "../../api/src/lib/list.ts";
import { buildLookup } from "../../api/src/lib/resolve.ts";
import { near, search } from "../../api/src/lib/search.ts";
import type { Dataset } from "../../api/src/lib/dataset.ts";
import { createMcpServer } from "../../api/src/mcp/server.ts";
import { buildOpenApi } from "../../api/src/openapi.ts";

const level = async (name: string) =>
  JSON.parse(await readFile(`data/v1/attributes/${name}.json`, "utf8")) as never[];
const dataset: Dataset = {
  regions: await level("regions"),
  provinces: await level("provinces"),
  cercles: await level("cercles"),
  communes: await level("communes"),
  arrondissements: await level("arrondissements"),
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
const fetchJson = async (path: string) => (tree.get(path) as Envelope<unknown[]> | undefined) ?? null;

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
}

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
  const result = await listCommunes(parsed.query, fetchJson);
  if (!result) throw new Error(`${request} has no page`);
  return envelope(result.rows, { self: request, prev: null, next: null }, result.meta) as Envelope<unknown>;
};

const examples: Record<string, Example> = {
  searchUnits: { request: "/api/search?q=fez&limit=2", body: computed("/api/search?q=fez&limit=2", search(index, "fez", { limit: 2 })) },
  communesNear: {
    request: "/api/communes/near?lat=33.5731&lng=-7.5898&radius=15&limit=2",
    body: computed("/api/communes/near?lat=33.5731&lng=-7.5898&radius=15&limit=2", near(index, 33.5731, -7.5898, 15, 2)),
  },
  listCommunes: cut(
    "/api/communes?province=01.511&type=urban",
    await listed("/api/communes?province=01.511&type=urban", { province: "01.511", type: "urban" }),
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
] as const;
for (const f of files) file(f.example);

const errors = Object.fromEntries(
  Object.entries(PROBLEMS).map(([kind, { status, title }]) => [kind, { status, title }]),
);
const errorExample = problem("not-found", "no unit has code 99.999", "/api/communes/99.999", "https://<host>");

// The tools as a client lists them, from a server connected the way the Worker connects it.
const server = createMcpServer({ index, lookup, fetchJson });
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
    `export const reference = ${JSON.stringify({ version, spec, operations, examples, files, errors, errorExample }, null, 2)};\n`,
);
await writeFile(
  "site/src/generated/mcp.ts",
  `// Generated by site/scripts/reference.ts from the MCP server. Do not edit.\n` +
    `export const mcp = ${JSON.stringify(mcp, null, 2)};\n`,
);
console.log(`reference: ${operations.length} routes, ${files.length} files; mcp: ${mcp.tools.length} tools`);
