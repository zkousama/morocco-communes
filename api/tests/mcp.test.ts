import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server.ts";
import { buildIndex } from "../src/emit/searchIndex.ts";
import { emitTree } from "../src/emit/static.ts";
import { buildLookup } from "../src/lib/resolve.ts";
import type { Envelope } from "../src/lib/envelope.ts";
import type { Dataset } from "../src/lib/dataset.ts";

const read = (name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as never[];
const dataset = {
  regions: read("regions"),
  provinces: read("provinces"),
  cercles: read("cercles"),
  communes: read("communes"),
  arrondissements: read("arrondissements"),
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
const tree = emitTree(dataset);
const fetchJson = async (path: string) => (tree.get(path) as Envelope<unknown[]> | undefined) ?? null;

let client: Client;

beforeAll(async () => {
  const server = createMcpServer({ index, lookup: buildLookup(index), fetchJson });
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
  it("offers 4 read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["communes_near", "get_commune", "list_communes", "search"]);
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

  it("rejects a filter that names nothing, in the API's own words", async () => {
    const r = await call("list_communes", { province: "99.999" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("no province has code 99.999.");
  });

  it("refuses an out-of-range limit rather than clamping it", async () => {
    const r = await call("search", { query: "tanger", limit: 999 }).catch((e: Error) => ({
      isError: true,
      content: [{ type: "text", text: e.message }],
    }));
    expect(r.isError).toBe(true);
  });
});
