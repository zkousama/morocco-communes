import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";

const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {}, props: {} };

describe("the extensionless figures alias", () => {
  it("serves a commune's insights without .json, the way it serves its indicators", async () => {
    const fetched: string[] = [];
    const env = {
      ASSETS: {
        fetch: async (request: Request) => {
          fetched.push(new URL(request.url).pathname);
          return new Response("{}", { status: 200 });
        },
      },
    };
    const get = (path: string) => app.fetch(new Request(`https://communes.pages.dev${path}`), env as never, ctx as never);

    const indicators = await get("/api/communes/aglif/indicators");
    const insights = await get("/api/communes/aglif/insights");
    expect(indicators.status).toBe(200);
    expect(insights.status).toBe(200);
    expect(insights.headers.get("x-api-tier")).toBe("alias");
    expect(insights.headers.get("content-location")).toBe("/api/communes/07.211.07.03/insights.json");
    expect(fetched).toEqual(["/api/communes/07.211.07.03/indicators.json", "/api/communes/07.211.07.03/insights.json"]);
  });
});
