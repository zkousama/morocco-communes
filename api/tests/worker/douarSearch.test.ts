import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";

// The douars page's index, as the asset binding serves it: 2 douars of Asni.
const NAMES = {
  communes: [["asni", "Asni", "0410703"]],
  douars: [
    ["تشديرت", 0, "203002", 300, "Tachdirt", 0, "tcdrt|tchdrt"],
    ["سيدي فارس", 0, "203001", 120, "Sidi Fars", 0, "sdfrs"],
  ],
};
const env = {
  ASSETS: {
    fetch: async (request: Request) =>
      new URL(request.url).pathname === "/douars/names.json" ? Response.json(NAMES) : new Response(null, { status: 404 }),
  },
};
const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {}, props: {} };
const get = (query: string) => app.fetch(new Request(`https://communes.pages.dev/api/douars/search?${query}`), env as never, ctx as never);

describe("the douar search the site's search box asks", () => {
  it("finds a douar by its Arabic or a close spelling, with its commune", async () => {
    for (const q of ["تشديرت", "Tachdirt"]) {
      const response = await get(`q=${encodeURIComponent(q)}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { code: string; commune: { slug: string } }[] };
      expect(body.data[0]).toMatchObject({ code: "0410703203002", commune: { slug: "asni" } });
    }
  });

  it("refuses a missing query, and finds nothing for a name that isn't close", async () => {
    expect((await get("q=")).status).toBe(400);
    const body = (await (await get("q=Marrakech")).json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
