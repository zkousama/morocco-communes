import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server.ts";
import { buildIndex } from "../src/emit/searchIndex.ts";
import { emitEconomy, emitIndicators, emitTree } from "../src/emit/static.ts";
import { readIndicators } from "../src/emit/indicators.ts";
import { readEconomy } from "../src/emit/economy.ts";
import { buildIndicatorTable } from "../src/lib/indicators.ts";
import { buildLookup } from "../src/lib/resolve.ts";
import { buildGeometry } from "../src/emit/geometry.ts";
import { prepareIndex, tilePath } from "../src/lib/locate.ts";
import { serverJson } from "../src/mcp/registry.ts";
import type { Envelope } from "../src/lib/envelope.ts";
import type { Dataset } from "../src/lib/dataset.ts";

const read = (name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as never[];
const dataset = {
  regions: read("regions"),
  provinces: read("provinces"),
  cercles: read("cercles"),
  communes: read("communes"),
  arrondissements: read("arrondissements"),
  adjacency: JSON.parse(readFileSync("data/v1/geometry/adjacency.json", "utf8")),
  sources: JSON.parse(readFileSync("data/v1/sources.json", "utf8")),
} as Dataset;
const index = buildIndex("1.0.0", [
  { level: "commune", rows: dataset.communes as never[] },
  { level: "arrondissement", rows: dataset.arrondissements as never[] },
  { level: "province", rows: dataset.provinces as never[] },
  { level: "region", rows: dataset.regions as never[] },
  { level: "cercle", rows: dataset.cercles as never[] },
]);
// The tools read the same pre-rendered files the API serves, here straight from the tree.
const tree: Map<string, unknown> = emitTree(dataset);
const indicatorRecords = await readIndicators("data/v1");
emitIndicators(tree as never, indicatorRecords);
const economyRecords = await readEconomy("data/v1");
emitEconomy(tree as never, economyRecords);
const geometry = await buildGeometry("data/v1", dataset as never);
for (const [key, tile] of geometry.tiles) tree.set(tilePath(key), tile);
for (const [code, group] of geometry.arrondissementsByCommune) tree.set(`/api/communes/${code}/arrondissements.geojson`, group);
const fetchJson = async (path: string) => (tree.get(path) as Envelope<unknown[]> | undefined) ?? null;

let client: Client;

beforeAll(async () => {
  const server = createMcpServer({
    index,
    lookup: buildLookup(index),
    fetchJson,
    tiles: prepareIndex(geometry.tileIndex),
    communes: dataset.communes as never[],
    indicators: buildIndicatorTable(
      indicatorRecords.filter((r) => r.level === "commune"),
      economyRecords.filter((r) => r.level === "commune"),
    ),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
});

type Result = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text?: string }[] };
const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<Result>;
const text = (r: Result) => r.content.map((c) => c.text ?? "").join("");

describe("the MCP server, through a real client", () => {
  it("offers 8 read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "commune_at", "communes_near", "get_commune", "get_economy", "get_indicators", "get_unit", "list_communes", "search",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.description!.length, tool.name).toBeGreaterThan(40);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("tells the client how to use it", () => {
    expect(client.getInstructions()).toContain("call search first");
  });

  it("finds Fès from Fez, an exonym", async () => {
    const r = await call("search", { query: "Fez", limit: 3 });
    const first = (r.structuredContent!.results as { code: string; matched: string; name_fr: string }[])[0]!;
    expect(first).toMatchObject({ code: "03.231.01.0", name_fr: "Fès", matched: "alias" });
  });

  it("keeps structured and text results identical", async () => {
    const r = await call("search", { query: "tanger", limit: 2 });
    expect(JSON.parse(text(r))).toEqual(r.structuredContent);
  });

  it("filters search by level", async () => {
    const r = await call("search", { query: "tanger", levels: ["province"] });
    for (const hit of r.structuredContent!.results as { level: string }[]) expect(hit.level).toBe("province");
  });

  it("returns a commune with its parents named, not just coded", async () => {
    const r = await call("get_commune", { id: "tanger" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.commune).toMatchObject({
      code: "01.511.01.0",
      type: "urban",
      region: { code: "01", name: "Tanger-Tétouan-Al Hoceima" },
      province: { code: "01.511", name: "Tanger-Assilah" },
      cercle: null,
      population_2024: 1275428,
    });
  });

  it("accepts every spelling of an identifier", async () => {
    for (const id of ["01.511.01.0", "001511010", "1511010", "tanger"]) {
      const r = await call("get_commune", { id });
      expect((r.structuredContent!.commune as { code: string }).code, id).toBe("01.511.01.0");
    }
  });

  it("says what a non-commune is instead of failing silently", async () => {
    const r = await call("get_commune", { id: "01.511" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("is a province");
    expect(text(r)).toContain("list_communes");
  });

  it("names the commune an arrondissement belongs to", async () => {
    const r = await call("get_commune", { id: "01.511.01.05" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(
      "01.511.01.05 is the arrondissement Mghogha of Tanger, with 252656 people in 2024. " +
        "get_indicators with unit 01.511.01.05 has its census figures, and get_commune with 01.511.01.0 gives Tanger.",
    );
  });

  it("names the communes one borders, longest shared boundary first", async () => {
    const r = await call("get_commune", { id: "tiznit" });
    const borders = r.structuredContent!.neighbours as { code: string; name_fr: string; km: number }[];
    expect(borders).toHaveLength(4);
    expect(borders.map((n) => n.km)).toEqual([...borders.map((n) => n.km)].sort((a, b) => b - a));
    expect(borders[0]).toMatchObject({ code: "09.581.11.15", km: 20.76 });
    expect(borders.every((n) => n.name_fr.length > 0)).toBe(true);
  });

  it("points to search when an identifier names nothing", async () => {
    const r = await call("get_commune", { id: "nowhere-town" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("search");
  });

  it("returns the communes nearest a point, nearest first", async () => {
    const r = await call("communes_near", { lat: 33.5731, lng: -7.5898, radius_km: 15, limit: 5 });
    const results = r.structuredContent!.results as { name_fr: string; distance_km: number }[];
    expect(results[0]!.name_fr).toBe("Méchouar de Casablanca");
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.distance_km).toBeGreaterThanOrEqual(results[i - 1]!.distance_km);
    }
  });

  it("finds the commune that contains a point", async () => {
    // Tangier's old medina.
    const r = await call("commune_at", { lat: 35.786, lng: -5.8125 });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent!.commune as { code: string }).code).toBe("01.511.01.0");
  });

  it("names the arrondissement too, in a city that has them", async () => {
    // Twin Center, on boulevard Zerktouni, in Maârif.
    const r = await call("commune_at", { lat: 33.5862, lng: -7.6325 });
    expect((r.structuredContent!.commune as { code: string }).code).toBe("06.141.01.0");
    expect(r.structuredContent!.arrondissement).toMatchObject({ name_fr: "Maârif" });
    const rural = await call("commune_at", { lat: 30.42, lng: -9.6 });
    expect(rural.structuredContent!.arrondissement).toBeNull();
  });

  it("says so when no boundary contains a point", async () => {
    const r = await call("commune_at", { lat: 36.5, lng: -12 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("communes_near");
  });

  it("lists communes by combined filters, matching the HTTP API", async () => {
    const r = await call("list_communes", { province: "01.511", type: "urban" });
    expect(r.structuredContent).toMatchObject({ total: 3, page: 1, total_pages: 1 });
    for (const c of r.structuredContent!.communes as { type: string }[]) expect(c.type).toBe("urban");
  });

  it("lists from a single pre-rendered file when one filter is given", async () => {
    const r = await call("list_communes", { region: "01", page: 2 });
    expect(r.structuredContent).toMatchObject({ page: 2, total_pages: 3 });
    expect((r.structuredContent!.communes as unknown[]).length).toBe(50);
  });

  it("applies every filter, not only the one that picked the list", async () => {
    // Province 04.421 is in région 04, so asking for it inside région 01 finds nothing.
    const r = await call("list_communes", { region: "01", province: "04.421" });
    expect(r.structuredContent).toMatchObject({ total: 0, page: 1, total_pages: 1 });
    const both = await call("list_communes", { region: "01", province: "01.511" });
    expect(both.structuredContent).toMatchObject({ total: 12 });
  });

  it("refuses a page past the last, whether or not one file answers the filter", async () => {
    for (const filter of [{ region: "01" }, { region: "01", type: "rural" }]) {
      const r = await call("list_communes", { ...filter, page: 9 });
      expect(r.isError, JSON.stringify(filter)).toBe(true);
      expect(text(r)).toBe("There is no page 9 for these filters.");
    }
  });

  it("sorts the whole country, largest first", async () => {
    const r = await call("list_communes", { sort: "-population" });
    const communes = r.structuredContent!.communes as { name_fr: string; population_2024: number }[];
    expect(communes[0]!.name_fr).toBe("Casablanca");
    for (let i = 1; i < communes.length; i++) {
      expect(communes[i]!.population_2024).toBeLessThanOrEqual(communes[i - 1]!.population_2024);
    }
    expect(r.structuredContent).toMatchObject({ total: 1503, total_pages: 31 });
  });

  it("bounds the population and combines it with a filter", async () => {
    const r = await call("list_communes", { region: "01", min_population: 100_000, sort: "name" });
    const communes = r.structuredContent!.communes as { name_fr: string; population_2024: number }[];
    expect(communes.length).toBeGreaterThan(0);
    for (const c of communes) expect(c.population_2024).toBeGreaterThanOrEqual(100_000);
    const names = communes.map((c) => c.name_fr);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "fr")));
  });

  it("puts a commune with no value last, whichever way it sorts", async () => {
    // Sidi Mohamed Benmansour has no boundary, so no area.
    for (const sort of ["area", "-area"]) {
      const r = await call("list_communes", { province: "04.281", sort });
      const communes = r.structuredContent!.communes as { code: string; area_km2: number | null }[];
      expect(communes.at(-1)!.code, sort).toBe("04.281.05.11");
    }
  });

  it("refuses a population range that runs backwards", async () => {
    const r = await call("list_communes", { min_population: 5000, max_population: 1000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("can't be above");
  });

  it("says so when a filter is given the wrong kind of unit", async () => {
    const r = await call("list_communes", { region: "01.511" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("01.511 is a province, not a region.");
  });

  it("rejects a filter that names nothing, in the API's own words", async () => {
    const r = await call("list_communes", { province: "99.999" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("no province has code 99.999.");
  });

  it("refuses a search query longer than any name could need", async () => {
    const r = await call("search", { query: "a".repeat(101) }).catch((e: Error) => ({
      isError: true,
      content: [{ type: "text", text: e.message }],
    }));
    expect(r.isError).toBe(true);
  });

  it("refuses an out-of-range limit rather than clamping it", async () => {
    const r = await call("search", { query: "tanger", limit: 999 }).catch((e: Error) => ({
      isError: true,
      content: [{ type: "text", text: e.message }],
    }));
    expect(r.isError).toBe(true);
  });
});

describe("get_indicators", () => {
  type Figures = Record<string, { people?: Record<string, Record<string, Record<string, number | null>>>; households?: Record<string, Record<string, number | null>> } | null>;
  type Found = { unit: Record<string, unknown>; figures: Record<string, Figures | null> }[];
  const results = (r: Result) => r.structuredContent!.results as Found;
  const figures = (r: Result) => results(r)[0]!.figures["2024"]!;
  const before = (r: Result) => results(r)[0]!.figures["2014"];

  it("gives a commune's figures for everyone, by default", async () => {
    const r = await call("get_indicators", { unit: "tanger" });
    expect(results(r)[0]!.unit).toMatchObject({ code: "01.511.01.0", level: "commune", name_fr: "Tanger" });
    const total = figures(r).total!;
    expect(total.people!.all!.labour!.unemploymentRate).toBe(15.3);
    expect(total.households!.amenities!.runningWater).toBe(98.8);
    expect(Object.keys(figures(r))).toEqual(["total"]);
    expect(Object.keys(total.people!)).toEqual(["all"]);
  });

  it("gives Morocco's when no unit is named", async () => {
    const r = await call("get_indicators", { topics: ["fertility"] });
    expect(results(r)[0]!.unit).toMatchObject({ code: null, level: "country" });
    expect(figures(r).total!.people!.all!.fertility!.totalFertilityRate).toBe(1.97);
    expect(figures(r).total!.households).toBeUndefined();
  });

  it("splits by area and sex, and says when a unit has no urban part", async () => {
    const r = await call("get_indicators", { unit: "01.511.05.19", area: "each", sex: "each", topics: ["labour", "illiteracy"] });
    const f = figures(r);
    expect(f.urban).toBeNull();
    expect(f.rural!.people!.all!.labour!.unemploymentRate).toBe(17.6);
    expect(f.rural!.people!.female!.labour!.activityRate).toBe(18.4);
    expect(f.total!.people!.female!.illiteracy!.rate10Plus).toBe(27.8);
    expect(Object.keys(f.total!.people!.male!)).toEqual(["illiteracy", "labour"]);
  });

  it("works for a province too", async () => {
    const r = await call("get_indicators", { unit: "01.511", topics: ["households"] });
    expect(results(r)[0]!.unit).toMatchObject({ level: "province" });
    expect(figures(r).total!.households!.households!.count).toBeGreaterThan(0);
  });

  it("gives every région at once, to compare them", async () => {
    const r = await call("get_indicators", { level: "region", topics: ["labour"], sex: "female" });
    expect(results(r)).toHaveLength(12);
    expect(results(r).every((x) => typeof (x.figures["2024"]!.total!.people!.female!.labour!.activityRate) === "number")).toBe(true);
  });

  it("gives every arrondissement at once, since the 6 cities have no figures of their own", async () => {
    const r = await call("get_indicators", { level: "arrondissement", topics: ["illiteracy"] });
    expect(results(r)).toHaveLength(41);
  });

  it("takes the level to tell a province from the commune of the same name", async () => {
    const commune = await call("get_indicators", { unit: "tiznit", topics: ["households"] });
    const province = await call("get_indicators", { unit: "tiznit", level: "province", topics: ["households"] });
    expect(results(commune)[0]!.unit).toMatchObject({ level: "commune" });
    expect(results(province)[0]!.unit).toMatchObject({ level: "province", code: "09.581" });
  });

  it("gives the 2014 census when asked for it", async () => {
    const r = await call("get_indicators", { unit: "assilah", topics: ["illiteracy"], census: "2014" });
    expect(Object.keys(results(r)[0]!.figures)).toEqual(["2014"]);
    expect(before(r)!.total!.people!.all!.illiteracy!.rate10Plus).toBe(21.7);
  });

  it("gives both censuses together, to see what changed", async () => {
    const r = await call("get_indicators", { unit: "assilah", topics: ["illiteracy"], census: "both" });
    expect(figures(r).total!.people!.all!.illiteracy!.rate10Plus).toBe(16);
    expect(before(r)!.total!.people!.all!.illiteracy!.rate10Plus).toBe(21.7);
  });

  it("has no 2014 figures for a city the census published by arrondissement", async () => {
    const r = await call("get_indicators", { unit: "tanger", topics: ["illiteracy"], census: "both" });
    expect(before(r)).toBeNull();
    const part = await call("get_indicators", { unit: "06.141.01.03", topics: ["illiteracy"], census: "2014" });
    expect(results(part)[0]!.figures["2014"]!.total!.people!.all!.illiteracy!.rate10Plus).toBeGreaterThan(0);
  });

  it("refuses a topic it doesn't have", async () => {
    const r = await call("get_indicators", { unit: "tanger", topics: ["income"] }).catch((e: Error) => ({
      isError: true,
      content: [{ type: "text", text: e.message }],
    }));
    expect(r.isError).toBe(true);
  });
});

describe("the eval's findings", () => {
  it("lists a city's arrondissements with get_commune, most populous first", async () => {
    const r = await call("get_commune", { id: "casablanca" });
    const parts = r.structuredContent!.arrondissements as { name_fr: string; population_2024: number }[];
    expect(parts).toHaveLength(16);
    expect(parts[0]).toMatchObject({ name_fr: "Sidi Moumen", population_2024: 551443 });
    expect((await call("get_commune", { id: "tafraout" })).structuredContent!.arrondissements).toEqual([]);
  });

  it("gives an arrondissement's population when asked for it as a commune", async () => {
    const r = await call("get_commune", { id: "agdal-riyad" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("with 70435 people in 2024");
  });

  it("reads a province filter as the province, where a commune shares its name", async () => {
    const r = await call("list_communes", { province: "tiznit" });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent!.communes as { province: { code: string } }[]).every((c) => c.province.code === "09.581")).toBe(true);
  });
});

describe("list_communes by an indicator", () => {
  it("ranks communes by any indicator and carries the figure", async () => {
    const r = await call("list_communes", { region: "01", sort: "-labour.unemploymentRate" });
    const communes = r.structuredContent!.communes as { code: string; indicator: { path: string; value: number } }[];
    expect(communes[0]).toMatchObject({ code: "01.051.09.23", indicator: { path: "labour.unemploymentRate", value: 80.2 } });
    const values = communes.map((c) => c.indicator.value).filter((v) => v !== null);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("ranks communes by an establishment count", async () => {
    const r = await call("list_communes", { region: "01", sort: "-economy.establishments.jobs" });
    const communes = r.structuredContent!.communes as { code: string; indicator: { path: string; value: number; basis?: string } }[];
    expect(communes[0]).toMatchObject({
      code: "01.511.01.0",
      indicator: { path: "economy.establishments.jobs", value: 208445, basis: "arrondissement_sum" },
    });
    const values = communes.map((c) => c.indicator.value).filter((v) => v !== null);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("names the keys of an establishment topic when the key is wrong", async () => {
    const r = await call("list_communes", { sort: "-economy.sector.farming" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("economy.sector has no farming; its keys are industry, construction, commerce, services");
  });

  it("names the keys of a topic when the key is wrong", async () => {
    const r = await call("list_communes", { sort: "-labour.unemployment" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("labour has no unemployment; its keys are population15Plus, active, inactive, activityRate, unemploymentRate, employed");
  });
});

describe("get_unit", () => {
  const unit = (r: Result) => r.structuredContent!.unit as Record<string, unknown>;

  it("answers how many cercles a province has, which its own record carries", async () => {
    const r = await call("get_unit", { unit: "taroudannt", level: "province" });
    expect(unit(r)).toMatchObject({ code: "09.541", level: "province", name_fr: "Taroudannt" });
    expect(r.structuredContent!.counts).toEqual({ cercles: 6, communes: 89 });
    const children = r.structuredContent!.children as { name_fr: string; level: string }[];
    expect(children).toHaveLength(6);
    expect(children.every((c) => c.level === "cercle")).toBe(true);
  });

  it("names a région's provinces", async () => {
    const r = await call("get_unit", { unit: "09" });
    expect(unit(r)).toMatchObject({ level: "region", name_fr: "Souss-Massa" });
    expect((r.structuredContent!.children as unknown[])).toHaveLength(6);
  });

  it("gives a cercle its counts, and leaves its communes to list_communes", async () => {
    const r = await call("get_unit", { unit: "09.541.03" });
    expect(r.structuredContent!.counts).toEqual({ communes: 16 });
    expect(r.structuredContent!.children).toEqual([]);
  });

  it("sends a commune to get_commune", async () => {
    const r = await call("get_unit", { unit: "tafraout" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("get_commune");
  });
});

describe("get_economy", () => {
  type Found = { unit: Record<string, unknown>; figures: Record<string, Record<string, number | null>> }[];
  const results = (r: Result) => r.structuredContent!.results as Found;
  const figures = (r: Result) => results(r)[0]!.figures;

  it("gives a unit's establishments", async () => {
    const r = await call("get_economy", { unit: "01.511.01.07" });
    expect(results(r)[0]!.unit).toMatchObject({ code: "01.511.01.07", level: "arrondissement", name_fr: "Médina" });
    expect(figures(r).establishments!.total).toBe(16970);
    expect(figures(r).establishments!.jobs).toBe(68388);
    expect(Object.keys(figures(r))).toEqual(["establishments", "sector", "size", "founded"]);
  });

  it("gives Morocco's when no unit is named", async () => {
    const r = await call("get_economy", { topics: ["sector"] });
    expect(results(r)[0]!.unit).toMatchObject({ code: null, level: "country" });
    expect(figures(r).sector).toEqual({ industry: 154979, construction: 39522, commerce: 587177, services: 348343 });
    expect(figures(r).establishments).toBeUndefined();
  });

  it("gives every région at once, to compare them", async () => {
    const r = await call("get_economy", { level: "region", topics: ["establishments"] });
    expect(results(r)).toHaveLength(12);
    expect(results(r).every((x) => typeof x.figures.establishments!.jobs === "number")).toBe(true);
  });

  it("takes the level to tell a province from the commune of the same name", async () => {
    const commune = await call("get_economy", { unit: "tiznit", topics: ["establishments"] });
    const province = await call("get_economy", { unit: "tiznit", level: "province", topics: ["establishments"] });
    expect(results(commune)[0]!.unit).toMatchObject({ level: "commune" });
    expect(results(commune)[0]!.figures.establishments!.total).toBe(5079);
    expect(results(province)[0]!.unit).toMatchObject({ level: "province", code: "09.581" });
  });

  it("adds a city up from its arrondissements, and says so", async () => {
    const r = await call("get_economy", { unit: "tanger", topics: ["establishments"] });
    expect(results(r)[0]!.unit).toMatchObject({ code: "01.511.01.0", name_fr: "Tanger" });
    expect(figures(r).establishments!.total).toBe(54810);
    expect((results(r)[0] as { basis?: string }).basis).toBe("arrondissement_sum");
    // A commune HCP counts itself claims nothing about where its figures came from.
    const one = await call("get_economy", { unit: "tiznit", topics: ["establishments"] });
    expect((results(one)[0] as { basis?: string }).basis).toBeUndefined();
  });

  it("gives every arrondissement at once, which is how the 6 cities are counted", async () => {
    const r = await call("get_economy", { level: "arrondissement", topics: ["establishments"] });
    expect(results(r)).toHaveLength(41);
    const most = [...results(r)].sort((a, b) => (b.figures.establishments!.jobs ?? 0) - (a.figures.establishments!.jobs ?? 0))[0]!;
    expect(most.unit).toMatchObject({ name_fr: "Aïn-Chock" });
  });
});

describe("the MCP Registry entry", () => {
  it("fits the registry's limits", () => {
    const entry = serverJson({ siteUrl: "https://example.workers.dev", version: "1.0.0" });
    expect(entry.description.length).toBeLessThanOrEqual(100);
    expect(entry.name).toMatch(/^io\.github\.zkousama\/[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/);
    expect(entry.remotes).toEqual([{ type: "streamable-http", url: "https://example.workers.dev/mcp" }]);
  });
});
