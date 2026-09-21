import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { emitEconomy, emitHousing, emitIndicators, emitTree, HEADERS_FILE, ROUTES_FILE, type Tree } from "./static.ts";
import { buildIndicatorTable } from "../lib/indicators.ts";
import { readIndicators } from "./indicators.ts";
import { readEconomy } from "./economy.ts";
import { readHousing } from "./housing.ts";
import { buildIndex } from "./searchIndex.ts";
import { buildOpenApi } from "../openapi.ts";
import { buildGeometry, outlineCollections } from "./geometry.ts";
import { tilePath } from "../lib/locate.ts";
import { serverJson } from "../mcp/registry.ts";
import type { Dataset } from "../lib/dataset.ts";

const DATA = "data/v1";
const OUT = "dist";
const INDEX_OUT = "api/generated/search-index.json";
const TILE_INDEX_OUT = "api/generated/tile-index.json";
const INDICATOR_TABLE_OUT = "api/generated/commune-indicators.json";

async function readDataset(): Promise<Dataset> {
  const level = async (name: string) =>
    JSON.parse(await readFile(join(DATA, "attributes", `${name}.json`), "utf8")) as never[];
  return {
    regions: await level("regions"),
    provinces: await level("provinces"),
    cercles: await level("cercles"),
    communes: await level("communes"),
    arrondissements: await level("arrondissements"),
    adjacency: JSON.parse(await readFile(join(DATA, "geometry", "adjacency.json"), "utf8")),
    sources: JSON.parse(await readFile(join(DATA, "sources.json"), "utf8")),
  };
}

export async function writeTree(tree: Tree, outDir: string): Promise<void> {
  for (const [path, body] of tree) {
    // Compact, because every byte is served on every request and clients pipe through
    // jq anyway. The committed dataset under /data is the indented, readable copy.
    const file = join(outDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(body));
  }
  await writeFile(join(outDir, "_headers"), HEADERS_FILE);
  await writeFile(join(outDir, "_routes.json"), ROUTES_FILE);
  // Pages answers a missing page with the nearest 404.html up the path, so the French
  // section needs one of its own under that name to get its 404 in French.
  const french = join(outDir, "fr", "404", "index.html");
  if (existsSync(french)) await copyFile(french, join(outDir, "fr", "404.html"));
}

const dataset = await readDataset();
const tree = emitTree(dataset);
const indicators = await readIndicators(DATA);
emitIndicators(tree, indicators);
const economy = await readEconomy(DATA);
emitEconomy(tree, economy);
emitHousing(tree, await readHousing(DATA));
// Committed like the search index: the figures a list of communes can be sorted by, which
// the Worker holds in memory.
await writeFile(
  INDICATOR_TABLE_OUT,
  `${JSON.stringify(buildIndicatorTable(indicators.filter((r) => r.level === "commune"), economy.filter((r) => r.level === "commune")))}\n`,
);

// Committed, like the dataset itself, so the Worker can be deployed from a clone without
// a build step. The Worker imports it at module scope, where parsing it costs a few ms
// against a 1 s startup budget rather than the 10 ms each request gets.
const version = (dataset.sources as { datasetVersion: string }).datasetVersion;
const index = buildIndex(version, [
  { level: "commune", rows: dataset.communes as never[] },
  { level: "arrondissement", rows: dataset.arrondissements as never[] },
  { level: "province", rows: dataset.provinces as never[] },
  { level: "region", rows: dataset.regions as never[] },
  { level: "cercle", rows: dataset.cercles as never[] },
]);
await writeFile(INDEX_OUT, `${JSON.stringify(index)}\n`);
const geometry = await buildGeometry(DATA, dataset as never);
// Committed for the same reason, and small: it only says which tiles exist.
await writeFile(TILE_INDEX_OUT, `${JSON.stringify(geometry.tileIndex)}\n`);
// A stale file from a previous shape would be served as if it were current, so these are
// rebuilt rather than merged into. Only these: the site builds into the same dist/ and
// this step runs second, so clearing the whole directory would delete its output.
for (const owned of ["api", "data", "_headers", "_routes.json"]) {
  await rm(join(OUT, owned), { recursive: true, force: true });
}
await writeTree(tree, OUT);
// The spec an agent framework turns into tools. SITE_URL, when the deployed origin is
// known, makes the server URL absolute; without it a relative one still resolves.
const spec = buildOpenApi({ version, serverUrl: process.env.SITE_URL || undefined });
await writeFile(join(OUT, "api", "openapi.json"), JSON.stringify(spec, null, 2));
await cp(DATA, join(OUT, "data", "v1"), { recursive: true });

// Written from the committed TopoJSON rather than committed themselves: GeoJSON repeats
// every shared border, and these are derived, so they're rebuilt on every deploy.
const put = async (path: string, body: unknown) => {
  await mkdir(dirname(join(OUT, path)), { recursive: true });
  await writeFile(join(OUT, path), JSON.stringify(body));
};
for (const [region, collection] of geometry.regions) await put(`/data/v1/geometry/${region}.geojson`, collection);
for (const [code, feature] of geometry.communes) await put(`/api/communes/${code}/boundary.geojson`, feature);
for (const [code, feature] of geometry.provinceOutlines) await put(`/api/provinces/${code}/boundary.geojson`, feature);
for (const [code, feature] of geometry.regionOutlines) await put(`/api/regions/${code}/boundary.geojson`, feature);
const outlines = outlineCollections(geometry);
await put("/data/v1/geometry/provinces.geojson", outlines.provinces);
await put("/data/v1/geometry/regions.geojson", outlines.regions);
await put("/data/v1/geometry/arrondissements.geojson", outlines.arrondissements);
for (const [code, feature] of geometry.arrondissements) await put(`/api/arrondissements/${code}/boundary.geojson`, feature);
for (const [code, group] of geometry.arrondissementsByCommune) await put(`/api/communes/${code}/arrondissements.geojson`, group);
for (const [key, tile] of geometry.tiles) await put(tilePath(key), tile);

// The MCP Registry entry names the deployed URL, so it's only written once that's known.
if (process.env.SITE_URL) {
  await put("/server.json", serverJson({ siteUrl: process.env.SITE_URL, version }));
}
console.log(
  `wrote ${tree.size} API files, ` +
    `${geometry.communes.size + geometry.provinceOutlines.size + geometry.regionOutlines.size + geometry.regions.size + geometry.arrondissements.size + geometry.arrondissementsByCommune.size + 3} GeoJSON files, ` +
    `${geometry.tiles.size} tiles and the dataset to ${OUT}/, ` +
    `and a ${index.entries.length}-entry search index to ${INDEX_OUT}`,
);
