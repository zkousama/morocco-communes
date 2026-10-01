import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApi } from "../src/openapi.ts";
import { emitEconomy, emitHousing, emitIndicators, emitInsights, emitNeighbourhoods, emitTree } from "../src/emit/static.ts";
import { neighbourhoodTable, postcodesByCommune } from "../src/lib/neighbourhoodTable.ts";
import { readIndicators } from "../src/emit/indicators.ts";
import { readEconomy } from "../src/emit/economy.ts";
import { readHousing } from "../src/emit/housing.ts";
import { readInsights } from "../src/emit/insights.ts";
import { LIMIT, PAGE, RADIUS_KM } from "../src/lib/params.ts";
import type { Dataset } from "../src/lib/dataset.ts";

const spec = buildOpenApi({ version: "1.0.0" });
const read = (name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as never[];
const tree = emitTree({
  regions: read("regions"),
  provinces: read("provinces"),
  cercles: read("cercles"),
  communes: read("communes"),
  arrondissements: read("arrondissements"),
  adjacency: JSON.parse(readFileSync("data/v1/geometry/adjacency.json", "utf8")),
  sources: JSON.parse(readFileSync("data/v1/sources.json", "utf8")),
} as Dataset);
emitIndicators(tree, await readIndicators("data/v1"));
emitEconomy(tree, await readEconomy("data/v1"));
emitHousing(tree, await readHousing("data/v1"));
emitInsights(tree, await readInsights("data/v1"));
// The neighbourhood files, from the same table the build writes them from.
{
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const cityOf = new Map((read("data/v1/attributes/arrondissements.json") as { code: string; communeCode: string }[]).map((a) => [a.code, a.communeCode]));
  const codes = read("api/data/postcodes.json").postcodes;
  emitNeighbourhoods(tree as never, neighbourhoodTable(read("api/data/neighbourhoods.json").places, codes, (c) => cityOf.get(c) ?? c), postcodesByCommune(codes));
}


type Param = { name: string; schema: Record<string, unknown> };
const paramsOf = (path: string) =>
  (spec.paths as Record<string, { get: { parameters?: Param[] } }>)[path]!.get.parameters ?? [];
const param = (path: string, name: string) => paramsOf(path).find((p) => p.name === name)!;

describe("openapi", () => {
  it("states the limits the Worker enforces, read from the same module", () => {
    expect(param("/api/search", "limit").schema).toMatchObject({ default: LIMIT.default, maximum: LIMIT.max });
    expect(param("/api/communes/near", "limit").schema).toMatchObject({ default: LIMIT.default, maximum: LIMIT.max });
    expect(param("/api/communes/near", "radius").schema).toMatchObject({
      default: RADIUS_KM.default,
      maximum: RADIUS_KM.max,
    });
    expect(param("/api/communes", "page").schema).toMatchObject({ default: PAGE.default, maximum: PAGE.max });
  });

  it("gives every operation a distinct id, which agent frameworks use as the tool name", () => {
    const ids = Object.values(spec.paths).map((p) => (p as { get: { operationId: string } }).get.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("describes only static routes that the build actually emits", () => {
    for (const path of Object.keys(spec.paths).filter((p) => p.endsWith(".json"))) {
      const concrete = path.replace("{code}", "01.511.01.0");
      expect(tree.has(concrete), `${path} is described but not emitted`).toBe(true);
    }
  });

  it("says outright that no authentication is needed", () => {
    expect(spec.security).toEqual([]);
  });

  it("uses an absolute server URL when the deployed origin is known", () => {
    expect(buildOpenApi({ version: "1.0.0", serverUrl: "https://x.example" }).servers[0]!.url).toBe("https://x.example");
    expect(spec.servers[0]!.url).toBe("/");
  });
});
