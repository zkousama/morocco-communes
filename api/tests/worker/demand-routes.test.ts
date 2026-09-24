import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";

interface Captured { sql: string; values: unknown[] }

function fakeDb(rows: Captured[], failing = false) {
  return {
    prepare: (sql: string) => {
      if (failing) throw new Error("D1 is down");
      return {
        bind: (...values: unknown[]) => {
          rows.push({ sql, values });
          return { run: async () => ({ success: true }) };
        },
      };
    },
  };
}

const env = (rows: Captured[], failing = false) => ({
  ASSETS: { fetch: async () => new Response("{}", { status: 200 }) },
  DEMAND: fakeDb(rows, failing),
});

const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {}, props: {} };

describe("demand rows from the API", () => {
  it("records a search with its text and how many it found", async () => {
    const rows: Captured[] = [];
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=titwan", { headers: { referer: "https://www.reddit.com/r/morocco/" } }),
      env(rows) as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    const search = rows.find((r) => r.values.includes("search"));
    expect(search?.values).toContain("titwan");
    expect(search?.values).toContain("reddit");
  });

  it("records the place a lookup names", async () => {
    const rows: Captured[] = [];
    await app.fetch(new Request("https://communes.pages.dev/api/communes/tanger"), env(rows) as never, ctx as never);
    const place = rows.find((r) => r.values.includes("place"));
    expect(place?.values).toContain("01.511.01.0");
  });

  it("answers normally when the database is down", async () => {
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=titwan"),
      env([], true) as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("data");
  });

  it("answers normally with no binding at all", async () => {
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/search?q=titwan"),
      { ASSETS: { fetch: async () => new Response("{}") } } as never,
      ctx as never,
    );
    expect(response.status).toBe(200);
  });
});
