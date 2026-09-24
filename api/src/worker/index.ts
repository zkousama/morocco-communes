import { Hono } from "hono";
import { cors } from "hono/cors";
import rawIndex from "../../generated/search-index.json";
import rawTiles from "../../generated/tile-index.json";
import rawCommunes from "../../../data/v1/attributes/communes.json";
import rawArrondissements from "../../../data/v1/attributes/arrondissements.json";
import rawIndicators from "../../generated/commune-indicators.json";
import { envelope, problem, type Envelope, type ProblemKind } from "../lib/envelope.ts";
import { near, search, type Hit, type Level, type SearchIndex } from "../lib/search.ts";
import { aliasPath, buildLookup, resolve, withArticle } from "../lib/resolve.ts";
import { listCommunes, parseFilter, type FetchJson, type ListedCommune } from "../lib/list.ts";
import type { IndicatorTable } from "../lib/indicators.ts";
import { createMcpServer } from "../mcp/server.ts";
import { agentOf, mcpMessages, record, routeOf, type UsageDataset } from "./usage.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { LIMIT, QUERY, RADIUS_KM } from "../lib/params.ts";
import { communeIn, featureContaining, prepareIndex, tileAt, tilePath, type Tile, type TileIndex } from "../lib/locate.ts";
import type { D1Database } from "@cloudflare/workers-types";
import { isBot, localeOf, recordDemand, scrubText, viaSiteOf, type DemandKind } from "./demand.ts";
import { DATASET_VERSION } from "../../../pipeline/src/sources/registry.ts";

// Module scope on purpose. Cloudflare gives the global scope a 1 s startup budget, while
// each request gets 10 ms, so parsing the index here costs a few ms once per isolate
// rather than a few ms on every request. Moving either line into a handler would put the
// whole design over budget.
const index = rawIndex as unknown as SearchIndex;
const lookup = buildLookup(index);
const tileIndex = prepareIndex(rawTiles as TileIndex);
// Every commune record, for queries that sort or bound the population across the whole
// country. 1.7 MB, which parses in about 8 ms here, once, instead of 31 page reads on
// every request.
const communes = rawCommunes as unknown as ListedCommune[];
// Each commune's census figures and establishment counts, for lists sorted by one. 1.3 MB.
const indicators = rawIndicators as IndicatorTable;
// The 6 communes divided into arrondissements, whose boundaries a point lookup reads too.
const cities = new Set((rawArrondissements as { communeCode: string }[]).map((a) => a.communeCode));

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Workers Analytics Engine, bound in wrangler.toml. Absent in local dev and tests. */
  USAGE?: UsageDataset;
  /** D1 database, bound in wrangler.toml. Absent in local dev and tests. */
  DEMAND?: D1Database;
}

/** The country Cloudflare places a request in, when it says. */
const countryOf = (request: Request) => (request as Request & { cf?: { country?: string } }).cf?.country ?? "";

/** Reads a pre-rendered file through the asset binding, the way a client would. */
const fetchJsonFrom = (env: Env, base: URL): FetchJson => async (path) => {
  const asset = await env.ASSETS.fetch(new Request(new URL(path, base)));
  return asset.ok ? ((await asset.json()) as Envelope<unknown[]>) : null;
};

const LEVELS: Level[] = ["commune", "arrondissement", "province", "region", "cercle"];

/** Where each level's records live, to point a request at the right collection. */
const COLLECTIONS: Record<Level, string> = {
  commune: "communes",
  arrondissement: "arrondissements",
  province: "provinces",
  region: "regions",
  cercle: "cercles",
};
/** The level a collection holds, so /api/provinces/tiznit means the province, not the commune. */
const LEVEL_OF = Object.fromEntries(Object.entries(COLLECTIONS).map(([level, collection]) => [collection, level as Level]));

type Vars = { demandText?: string; demandResults?: number; demandCode?: string };

const NAMING = new Set<Hit["matched"]>(["code", "exact", "alias", "spelling"]);

/**
 * 1 when a search names a place: its top hit is a code, a name, an exonym or a spelling of
 * one. A prefix or a few shared trigrams are how a person's name still finds hits, so they
 * don't count. Worked out here, since a count the client sends can say anything.
 */
function namesAPlace(text: string): 0 | 1 {
  const top = search(index, text, { limit: 1 })[0];
  return top && NAMING.has(top.matched) ? 1 : 0;
}

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// POST is for /mcp: MCP clients send JSON-RPC as POST requests, and a browser-based one
// would otherwise be refused at the preflight before reaching the server.
app.use("/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// Counts each live API call once it has been answered, 404s included. After cors, so a
// preflight isn't counted as a call.
app.use("/api/*", async (c, next) => {
  const started = Date.now();
  await next();
  const url = new URL(c.req.url);
  const route = routeOf(url.pathname);
  const agent = agentOf(c.req.header("user-agent"));
  const country = countryOf(c.req.raw);
  record(c.env.USAGE, {
    kind: "api",
    name: route,
    agent,
    country,
    status: c.res.status,
    ms: Date.now() - started,
  });

  // The site's own search box asks on every pause while someone types, and counts itself
  // through the beacon once a query settles, so its requests write nothing here. The browser
  // sets Sec-Fetch-Site and a page's script can't, so only the site's own pages are skipped.
  if (c.req.header("sec-fetch-site") === "same-origin") return;

  const text = scrubText(c.get("demandText"));
  const code = c.get("demandCode") ?? "";
  const kind: DemandKind | null = text !== "" ? "search" : code !== "" ? "place" : null;
  if (kind) {
    c.executionCtx.waitUntil(
      recordDemand(c.env.DEMAND, {
        kind,
        text,
        code,
        name: route,
        results: c.get("demandResults") ?? -1,
        named: kind === "search" ? namesAPlace(text) : 0,
        locale: localeOf(url.pathname),
        country,
        via: agent,
        viaSite: viaSiteOf(c.req.header("referer"), url.host),
        client: "",
        bot: isBot(c.req.header("user-agent")),
        dataset: DATASET_VERSION,
      }),
    );
  }
});

/** Worker responses do not inherit the asset tier's _headers, so the tier is labelled here. */
const json = (body: Envelope<unknown>, tier: "computed" | "alias") =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "x-api-tier": tier,
    },
  });

const fail = (url: URL, kind: ProblemKind, detail: string, instance: string) => {
  const body = problem(kind, detail, instance, url.origin);
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
    return fail(url, "invalid-query", "q is required and cannot be empty", url.pathname + url.search);
  }
  if (q.length > QUERY.maxLength) {
    return fail(url, "invalid-query", `q is at most ${QUERY.maxLength} characters`, url.pathname + url.search);
  }
  const limit = intParam(url.searchParams.get("limit") ?? undefined, LIMIT.default, LIMIT.max);
  if (limit === null) {
    return fail(url, "invalid-query", `limit must be a whole number between 1 and ${LIMIT.max}`, url.pathname + url.search);
  }
  const requested = url.searchParams.get("levels");
  let levels: Level[] | undefined;
  if (requested) {
    // Empty entries name no level, so levels=commune, reads as levels=commune.
    const parts = requested.split(",").map((s) => s.trim()).filter((s) => s !== "");
    const unknown = parts.filter((p) => !LEVELS.includes(p as Level));
    if (unknown.length > 0) {
      return fail(url, "invalid-query", `unknown level(s): ${unknown.join(", ")}`, url.pathname + url.search);
    }
    if (parts.length > 0) levels = parts as Level[];
  }
  const hits = search(index, q, { levels, limit });
  c.set("demandText", q);
  c.set("demandResults", hits.length);
  return json(envelope(hits, { self: url.pathname + url.search }, { total: hits.length }), "computed");
});

/** lat and lng from a query string, or the problem with them. */
function point(url: URL): { lat: number; lng: number } | { error: string } {
  // Number(null) and Number("") are both 0, a valid coordinate, so one left out has to be
  // caught before it is converted.
  const coordinate = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  };
  const lat = coordinate("lat");
  const lng = coordinate("lng");
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "lat is required and must be between -90 and 90" };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: "lng is required and must be between -180 and 180" };
  return { lat, lng };
}

/**
 * The commune whose boundary contains a point. The tile index says which one file to
 * read; the answer is the commune's own record, with `arrondissement` added: the one the
 * point is in, for the 6 cities that have them, and null everywhere else.
 */
app.get("/api/communes/at", async (c) => {
  const url = new URL(c.req.url);
  const instance = url.pathname + url.search;
  const at = point(url);
  if ("error" in at) return fail(url, "invalid-query", at.error, instance);
  const none = () =>
    fail(url, "not-found", `no commune boundary contains ${at.lat}, ${at.lng}`, instance);

  const key = tileAt(tileIndex, at.lat, at.lng);
  if (!key) return none();
  const tile = await c.env.ASSETS.fetch(new Request(new URL(tilePath(key), url)));
  if (!tile.ok) return none();
  const code = communeIn((await tile.json()) as Tile, at.lat, at.lng);
  if (!code) return none();
  c.set("demandCode", code);

  const canonical = `/api/communes/${code}.json`;
  const record = (await (await c.env.ASSETS.fetch(new Request(new URL(canonical, url)))).json()) as Envelope<object>;
  const arrondissement = cities.has(code) ? await arrondissementAt(c.env, url, code, at.lat, at.lng) : null;
  return new Response(JSON.stringify({ ...record, data: { ...record.data, arrondissement } }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "x-api-tier": "computed",
      "content-location": canonical,
    },
  });
});

/** The arrondissement of a city a point falls in, from that city's own boundary file. */
async function arrondissementAt(env: Env, base: URL, commune: string, lat: number, lng: number) {
  const file = await env.ASSETS.fetch(new Request(new URL(`/api/communes/${commune}/arrondissements.geojson`, base)));
  if (!file.ok) return null;
  const { features } = (await file.json()) as { features: Parameters<typeof featureContaining>[0] };
  const hit = featureContaining(features, lat, lng);
  return hit ? { code: hit.properties.code, name: { fr: hit.properties.name_fr, ar: hit.properties.name_ar } } : null;
}

app.get("/api/communes/near", (c) => {
  const url = new URL(c.req.url);
  const instance = url.pathname + url.search;
  const at = point(url);
  if ("error" in at) return fail(url, "invalid-query", at.error, instance);
  const { lat, lng } = at;
  const radiusRaw = url.searchParams.get("radius");
  const radius = radiusRaw === null ? RADIUS_KM.default : Number(radiusRaw);
  if (!Number.isFinite(radius) || radius <= 0 || radius > RADIUS_KM.max) {
    return fail(url, "invalid-query", `radius must be a number in km, above 0 and at most ${RADIUS_KM.max}`, instance);
  }
  const limit = intParam(url.searchParams.get("limit") ?? undefined, LIMIT.default, LIMIT.max);
  if (limit === null) {
    return fail(url, "invalid-query", `limit must be a whole number between 1 and ${LIMIT.max}`, instance);
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
 * holds the answer, and anything more, several filters, a population bound or an order
 * other than the code's, is filtered and sorted from the records held in memory.
 */
app.get("/api/communes", async (c) => {
  const url = new URL(c.req.url);
  const instance = url.pathname + url.search;
  const text = url.searchParams.get("q");
  if (text !== null) {
    // A name search answers on its own; a filter beside it would be silently ignored.
    const beside = ["region", "province", "cercle", "type", "sort", "min_population", "max_population", "page"].filter(
      (k) => url.searchParams.has(k),
    );
    if (beside.length > 0) {
      return fail(url, "invalid-query", `q cannot be combined with ${beside.join(", ")}`, instance);
    }
    if (text.trim() === "") return fail(url, "invalid-query", "q cannot be empty", instance);
    if (text.length > QUERY.maxLength) {
      return fail(url, "invalid-query", `q is at most ${QUERY.maxLength} characters`, instance);
    }
    const hits = search(index, text, { levels: ["commune"], limit: 10 });
    return json(envelope(hits, { self: instance }, { total: hits.length }), "computed");
  }

  // Parsed by the same function the MCP tool uses, so both reject the same input.
  // A number the query string can't hold as a whole number becomes NaN, which parseFilter
  // refuses, rather than whatever Number() makes of it.
  const integer = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw === null ? undefined : /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  };
  const parsed = parseFilter(
    {
      region: url.searchParams.get("region") ?? undefined,
      province: url.searchParams.get("province") ?? undefined,
      cercle: url.searchParams.get("cercle") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      minPopulation: integer("min_population"),
      maxPopulation: integer("max_population"),
      page: integer("page"),
    },
    lookup,
  );
  if ("error" in parsed) return fail(url, parsed.error.kind, parsed.error.detail, instance);
  const { query } = parsed;
  const { page } = query;

  const direct = aliasPath(query);
  if (direct) {
    const asset = await c.env.ASSETS.fetch(new Request(new URL(direct, url)));
    if (!asset.ok) return fail(url, "not-found", `no page ${page} for this filter`, instance);
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

  // Past the last page is a 404 here as it is for the single-filter files above.
  const listed = await listCommunes(query, communes, fetchJsonFrom(c.env, url), indicators);
  if (!listed) return fail(url, "not-found", `no page ${page} for this filter`, instance);
  const { rows, meta } = listed;
  const link = (n: number) => {
    const next = new URL(url);
    next.searchParams.set("page", String(n));
    return next.pathname + next.search;
  };
  return json(
    envelope(rows, {
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
  if (id.endsWith(".json")) return fail(url, "not-found", `${url.pathname} does not exist`, url.pathname);

  const found = resolve(lookup, id, LEVEL_OF[collection]);
  if (found.kind === "malformed") return fail(url, "invalid-code", `${id} can’t be read as a code or a slug`, url.pathname);
  if (found.kind === "absent") return fail(url, "not-found", `no unit has code ${id}`, url.pathname);
  c.set("demandCode", found.code);

  const canonical = `/api/${collection}/${found.code}.json`;
  const asset = await c.env.ASSETS.fetch(new Request(new URL(canonical, url)));
  if (!asset.ok) {
    const home = `/api/${COLLECTIONS[found.level]}/${found.code}.json`;
    return fail(url, "not-found", `${found.code} is ${withArticle(found.level)}, at ${home}`, url.pathname);
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

/**
 * A unit's figures by any spelling of its identifier: /api/communes/tanger/indicators for
 * the census, /economy for the establishments, /housing for the urban dwellings and
 * /neighbours for the communes it borders.
 *
 * The names sit in a group of their own. Written bare, the alternation split the whole
 * path pattern at each bar, so indicators matched as a prefix and let indicators.json
 * through, housing matched only at the end, and a slug's .json worked for 2 figures of 3.
 */
app.get("/api/:collection/:id/:figures{(?:indicators|economy|housing|neighbours)}", async (c) => {
  const url = new URL(c.req.url);
  const { collection, id, figures } = c.req.param();
  const found = resolve(lookup, id, LEVEL_OF[collection]);
  if (found.kind === "malformed") return fail(url, "invalid-code", `${id} can’t be read as a code or a slug`, url.pathname);
  if (found.kind === "absent") return fail(url, "not-found", `no unit has code ${id}`, url.pathname);
  c.set("demandCode", found.code);

  const canonical = `/api/${collection}/${found.code}/${figures}.json`;
  const asset = await c.env.ASSETS.fetch(new Request(new URL(canonical, url)));
  if (!asset.ok) {
    const home = `/api/${COLLECTIONS[found.level]}/${found.code}/${figures}.json`;
    if (home !== canonical) return fail(url, "not-found", `${found.code} is ${withArticle(found.level)}, at ${home}`, url.pathname);
    return fail(url, "not-found", `${found.code} has no ${figures}`, url.pathname);
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
  if (!asset.ok) return fail(url, "not-found", `${url.pathname} does not exist`, url.pathname);
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
 * MCP over Streamable HTTP, stateless: a fresh server and transport per request, answering
 * in plain JSON rather than holding a stream open, which is what a Worker is suited to.
 * The tools read the same pre-rendered files the API serves, so an agent and a client get
 * the same answer to the same question.
 */
app.all("/mcp", async (c) => {
  const started = Date.now();
  // Read from a copy, so the transport still gets the body it expects.
  const messages = c.req.method === "POST" ? mcpMessages(await c.req.raw.clone().json().catch(() => null)) : [];
  const server = createMcpServer({
    index,
    lookup,
    tiles: tileIndex,
    communes,
    indicators,
    fetchJson: fetchJsonFrom(c.env, new URL(c.req.url)),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(c.req.raw);
  const headers = new Headers(response.headers);
  headers.set("x-api-tier", "computed");
  // What every demand row from this request has in common.
  const from = {
    results: -1,
    locale: "en" as const,
    country: countryOf(c.req.raw),
    via: agentOf(c.req.header("user-agent")),
    viaSite: "direct",
    bot: isBot(c.req.header("user-agent")),
    dataset: DATASET_VERSION,
  };
  for (const message of messages) {
    record(c.env.USAGE, {
      kind: "mcp",
      name: message.tool ?? message.method,
      client: message.client,
      agent: agentOf(c.req.header("user-agent")),
      country: countryOf(c.req.raw),
      status: response.status,
      ms: Date.now() - started,
    });

    if (message.tool) {
      // Stored as the code it resolves to, the way the tool reads it, so a slug that names
      // no place leaves nothing behind.
      const place = message.args?.place === undefined ? undefined : resolve(lookup, message.args.place, message.args.level);
      c.executionCtx.waitUntil(
        recordDemand(c.env.DEMAND, {
          ...from,
          kind: "tool",
          text: message.args?.query ?? "",
          code: place?.kind === "found" ? place.code : "",
          name: message.tool,
          client: "",
          named: message.args?.query ? namesAPlace(message.args.query) : 0,
        }),
      );
    }
    if (message.method === "initialize" && message.client) {
      c.executionCtx.waitUntil(
        recordDemand(c.env.DEMAND, { ...from, kind: "client", text: "", code: "", name: message.client, client: message.client, named: 0 }),
      );
    }
  }
  return new Response(response.body, { status: response.status, headers });
});

const CODE = /^[0-9][0-9.]{1,13}$/;
const FILE = /^[a-z0-9][a-z0-9/._-]{2,79}$/;
/** A beacon is a few dozen bytes. */
const BEACON_BYTES = 1024;

/**
 * What a static page can't count for itself: a place opened, a file taken, and a search
 * the site's own box settled on. The pages and the files are served without running code,
 * and the box's requests to the API aren't counted, so the browser says so here instead.
 * Same origin only, and a body that isn't one of ours writes nothing.
 */
app.post("/api/beacon", async (c) => {
  const url = new URL(c.req.url);
  const origin = c.req.header("origin");
  let sameOrigin = false;
  try {
    sameOrigin = origin !== undefined && new URL(origin).host === url.host;
  } catch {
    sameOrigin = false;
  }
  // A missing header is not consent: a browser sends Origin on every POST and Sec-Fetch-Site
  // on every request, so a real page always carries one of the two. curl and a plain script
  // that send neither are refused rather than let through by default. Someone who sets the
  // headers by hand still gets counted — this guards a page counter, not a boundary that has
  // to hold under attack.
  if (!sameOrigin && c.req.header("sec-fetch-site") !== "same-origin") {
    return new Response(null, { status: 400 });
  }
  // A body that says it's over 1 KB is refused unread, and one sent without a length is
  // measured before it's parsed.
  if (Number(c.req.header("content-length")) > BEACON_BYTES) return new Response(null, { status: 400 });
  const bytes = await c.req.arrayBuffer().catch(() => new ArrayBuffer(0));
  if (bytes.byteLength > BEACON_BYTES) return new Response(null, { status: 400 });
  let body: { kind?: unknown; code?: unknown; file?: unknown; text?: unknown; results?: unknown; locale?: unknown } | null;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return new Response(null, { status: 400 });
  const shared = {
    locale: body.locale === "fr" ? ("fr" as const) : ("en" as const),
    country: countryOf(c.req.raw),
    via: "browser",
    viaSite: viaSiteOf(c.req.header("referer"), url.host),
    client: "",
    bot: isBot(c.req.header("user-agent")),
    dataset: DATASET_VERSION,
  };

  if (body.kind === "search") {
    if (typeof body.text !== "string") return new Response(null, { status: 400 });
    // As in the API: a search the scrub empties is answered, and nothing of it is kept.
    const text = scrubText(body.text);
    if (text === "") return new Response(null, { status: 204 });
    const { results } = body;
    const found = typeof results === "number" && Number.isInteger(results) && results >= 0 && results <= 100 ? results : -1;
    c.executionCtx.waitUntil(
      recordDemand(c.env.DEMAND, { ...shared, kind: "search", text, code: "", name: "search", results: found, named: namesAPlace(text) }),
    );
    return new Response(null, { status: 204 });
  }

  const kind = body.kind === "place" || body.kind === "download" ? body.kind : null;
  const code = typeof body.code === "string" && CODE.test(body.code) ? body.code : "";
  const file = typeof body.file === "string" && FILE.test(body.file) ? body.file : "";
  if (!kind || (kind === "place" && code === "") || (kind === "download" && file === "")) {
    return new Response(null, { status: 400 });
  }
  c.executionCtx.waitUntil(
    recordDemand(c.env.DEMAND, { ...shared, kind, text: "", code: kind === "place" ? code : file, name: kind, results: -1, named: 0 }),
  );
  return new Response(null, { status: 204 });
});

/**
 * Two audiences reach this. A client calling /api/* that got a path wrong wants a problem
 * document it can parse; a person who mistyped a page wants a page. Anything outside /api
 * gets the site's own 404, in the language of the section they were in.
 */
const NOT_FOUND_PAGES: [prefix: string, page: string][] = [
  ["/fr/", "/fr/404/"],
];

app.notFound(async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
    return fail(url, "not-found", `${url.pathname} is not an endpoint of this API`, url.pathname);
  }
  const page = NOT_FOUND_PAGES.find(([prefix]) => url.pathname.startsWith(prefix))?.[1] ?? "/404";
  const asset = await c.env.ASSETS.fetch(new Request(new URL(page, url)));
  return new Response(asset.body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
});

export default app;
