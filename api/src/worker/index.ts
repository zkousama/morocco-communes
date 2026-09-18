import { Hono } from "hono";
import { cors } from "hono/cors";
import rawIndex from "../../generated/search-index.json";
import { envelope, paginate, PER_PAGE, problem, type Envelope, type ProblemKind } from "../lib/envelope.ts";
import { near, search, type Level, type SearchIndex } from "../lib/search.ts";
import { aliasPath, buildLookup, narrowestSource, resolve, type FilterQuery } from "../lib/resolve.ts";

// Module scope on purpose. Cloudflare gives the global scope a 1 s startup budget, while
// each request gets 10 ms, so parsing the index here costs a few ms once per isolate
// rather than a few ms on every request. Moving either line into a handler would put the
// whole design over budget.
const index = rawIndex as unknown as SearchIndex;
const lookup = buildLookup(index);

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const LEVELS: Level[] = ["commune", "arrondissement", "province", "region", "cercle"];
const MAX_LIMIT = 50;
const MAX_RADIUS_KM = 100;

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

/** Worker responses do not inherit the asset tier's _headers, so the tier is labelled here. */
const json = (body: Envelope<unknown>, tier: "computed" | "alias") =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "x-api-tier": tier,
    },
  });

const fail = (kind: ProblemKind, detail: string, instance: string) => {
  const body = problem(kind, detail, instance);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { "content-type": "application/problem+json", "x-api-tier": "computed" },
  });
};

function intParam(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= max ? n : null;
}

app.get("/api/search", (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get("q");
  if (q === null || q.trim() === "") {
    return fail("invalid-query", "q is required and cannot be empty", url.pathname + url.search);
  }
  const limit = intParam(url.searchParams.get("limit") ?? undefined, 10, MAX_LIMIT);
  if (limit === null) {
    return fail("invalid-query", `limit must be a whole number between 1 and ${MAX_LIMIT}`, url.pathname + url.search);
  }
  const requested = url.searchParams.get("levels");
  let levels: Level[] | undefined;
  if (requested) {
    const parts = requested.split(",").map((s) => s.trim());
    const unknown = parts.filter((p) => !LEVELS.includes(p as Level));
    if (unknown.length > 0) {
      return fail("invalid-query", `unknown level(s): ${unknown.join(", ")}`, url.pathname + url.search);
    }
    levels = parts as Level[];
  }
  const hits = search(index, q, { levels, limit });
  return json(envelope(hits, { self: url.pathname + url.search }, { total: hits.length }), "computed");
});

app.get("/api/communes/near", (c) => {
  const url = new URL(c.req.url);
  const instance = url.pathname + url.search;
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return fail("invalid-query", "lat is required and must be between -90 and 90", instance);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return fail("invalid-query", "lng is required and must be between -180 and 180", instance);
  }
  const radiusRaw = url.searchParams.get("radius");
  const radius = radiusRaw === null ? 10 : Number(radiusRaw);
  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_RADIUS_KM) {
    return fail("invalid-query", `radius must be a number in km, above 0 and at most ${MAX_RADIUS_KM}`, instance);
  }
  const limit = intParam(url.searchParams.get("limit") ?? undefined, 10, MAX_LIMIT);
  if (limit === null) {
    return fail("invalid-query", `limit must be a whole number between 1 and ${MAX_LIMIT}`, instance);
  }
  const hits = near(index, lat, lng, radius, limit);
  return json(
    envelope(hits, { self: instance }, { total: hits.length }),
    "computed",
  );
});

/**
 * The query-string shapes from the brief. A path-keyed asset store cannot match on a
 * query string, so these are resolved here: one filter rewrites to the file that already
 * holds the answer, and more than one narrows to the smallest pre-rendered list and
 * filters it. A province is at most two pages and a région at most six, so the number of
 * subrequests stays small and bounded.
 */
app.get("/api/communes", async (c) => {
  const url = new URL(c.req.url);
  const instance = url.pathname + url.search;
  const text = url.searchParams.get("q");
  if (text) {
    const hits = search(index, text, { levels: ["commune"], limit: 10 });
    return json(envelope(hits, { self: instance }, { total: hits.length }), "computed");
  }

  const page = intParam(url.searchParams.get("page") ?? undefined, 1, 10_000);
  if (page === null) return fail("invalid-query", "page must be a whole number from 1", instance);

  const type = url.searchParams.get("type");
  if (type !== null && type !== "urban" && type !== "rural") {
    return fail("invalid-query", "type must be urban or rural", instance);
  }

  const query: FilterQuery = { page };
  for (const key of ["region", "province", "cercle"] as const) {
    const raw = url.searchParams.get(key);
    if (raw === null) continue;
    const found = resolve(lookup, raw);
    if (found.kind === "malformed") return fail("invalid-code", `${raw} is not a geographic code`, instance);
    if (found.kind === "absent") return fail("not-found", `no ${key} has code ${raw}`, instance);
    query[key] = found.code;
  }
  if (type !== null) query.type = type;

  const direct = aliasPath(query);
  if (direct) {
    const asset = await c.env.ASSETS.fetch(new Request(new URL(direct, url)));
    if (!asset.ok) return fail("not-found", `no page ${page} for this filter`, instance);
    return new Response(asset.body, {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
        "x-api-tier": "alias",
        // Names the pre-rendered file that holds this answer, which a client can then
        // fetch directly and never touch the Worker again.
        "content-location": direct,
      },
    });
  }

  const base = narrowestSource(query);
  const rows: { type: string }[] = [];
  let pages = 1;
  for (let p = 1; p <= pages; p++) {
    const asset = await c.env.ASSETS.fetch(new Request(new URL(`${base}/${p}.json`, url)));
    if (!asset.ok) break;
    const body = (await asset.json()) as Envelope<{ type: string }[]>;
    pages = body.meta.totalPages ?? 1;
    rows.push(...body.data);
  }
  const filtered = query.type ? rows.filter((r) => r.type === query.type) : rows;
  const { slice, meta } = paginate(filtered, page, PER_PAGE);
  const link = (n: number) => {
    const next = new URL(url);
    next.searchParams.set("page", String(n));
    return next.pathname + next.search;
  };
  return json(
    envelope(slice, {
      self: instance,
      prev: page > 1 ? link(page - 1) : null,
      next: page < meta.totalPages ? link(page + 1) : null,
    }, meta),
    "computed",
  );
});

/**
 * Extensionless convenience URLs. The canonical resource is the `.json` file on the free
 * tier; this serves its bytes and names it in Content-Location rather than redirecting,
 * so a client is not charged a round trip to learn the obvious.
 */
app.get("/api/:collection/:id", async (c) => {
  const url = new URL(c.req.url);
  const { collection, id } = c.req.param();
  if (id.endsWith(".json")) return fail("not-found", `${url.pathname} does not exist`, url.pathname);

  const found = resolve(lookup, id);
  if (found.kind === "malformed") return fail("invalid-code", `${id} is not a geographic code`, url.pathname);
  if (found.kind === "absent") return fail("not-found", `no unit has code ${id}`, url.pathname);

  const canonical = `/api/${collection}/${found.code}.json`;
  const asset = await c.env.ASSETS.fetch(new Request(new URL(canonical, url)));
  if (!asset.ok) {
    return fail("not-found", `${found.code} is a ${found.level}, which /api/${collection} does not hold`, url.pathname);
  }
  return new Response(asset.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "x-api-tier": "alias",
      "content-location": canonical,
    },
  });
});

/** Bare collection names, so /api/regions works as well as /api/regions.json. */
app.get("/api/:collection", async (c) => {
  const url = new URL(c.req.url);
  const canonical = `/api/${c.req.param("collection")}.json`;
  const asset = await c.env.ASSETS.fetch(new Request(new URL(canonical, url)));
  if (!asset.ok) return fail("not-found", `${url.pathname} does not exist`, url.pathname);
  return new Response(asset.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "x-api-tier": "alias",
      "content-location": canonical,
    },
  });
});

/**
 * Two audiences reach this. A client calling /api/* that got a path wrong wants a problem
 * document it can parse; a person who mistyped a page wants a page. Anything outside /api
 * gets the site's own 404, in the language of the section they were in.
 */
const NOT_FOUND_PAGES: [prefix: string, page: string][] = [
  ["/fr/", "/fr/404/"],
  ["/darija/", "/darija/404/"],
];

app.notFound(async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
    return fail("not-found", `${url.pathname} is not an endpoint of this API`, url.pathname);
  }
  const page = NOT_FOUND_PAGES.find(([prefix]) => url.pathname.startsWith(prefix))?.[1] ?? "/404";
  const asset = await c.env.ASSETS.fetch(new Request(new URL(page, url)));
  return new Response(asset.body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
});

export default app;
