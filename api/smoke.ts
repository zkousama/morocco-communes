/**
 * Probes a running deployment — `wrangler dev` locally, or the live URL after a deploy.
 *
 * The pure logic behind these routes is unit-tested; what this checks is the part only a
 * real runtime can answer: which tier served a request, whether the asset store bypasses
 * the Worker, and whether the headers survive the trip.
 *
 *   pnpm api:smoke                       (against wrangler dev on :8788)
 *   pnpm api:smoke https://<deployment>
 */
const base = (process.argv[2] ?? "http://127.0.0.1:8788").replace(/\/$/, "");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

async function get(path: string) {
  let response: Response;
  try {
    response = await fetch(base + path);
  } catch (error) {
    // A dead server is the commonest reason to be running this, so it reports as a line
    // in the list rather than a stack trace over the results.
    console.log(`\n  cannot reach ${base} — ${(error as Error).message}`);
    console.log("  start it with: pnpm api:dev\n");
    process.exit(1);
  }
  const text = await response.text();
  let body: Record<string, never> | null = null;
  try {
    body = JSON.parse(text) as Record<string, never>;
  } catch {
    body = null;
  }
  return {
    status: response.status,
    tier: response.headers.get("x-api-tier"),
    contentType: response.headers.get("content-type") ?? "",
    cors: response.headers.get("access-control-allow-origin"),
    contentLocation: response.headers.get("content-location"),
    body,
  };
}

console.log(`probing ${base}\n`);

console.log("pre-rendered tier — served by the asset store, never invoking the Worker");
for (const path of [
  "/api/version.json",
  "/api/regions.json",
  "/api/communes/01.511.01.0.json",
  "/api/arrondissements/01.511.01.05.json",
  "/api/provinces/01.511/communes/page/1.json",
  "/api/communes/type/urban/page/1.json",
  "/api/communes/01.511.01.0/arrondissements.json",
  "/api/communes/01.511.01.0/indicators.json",
  "/api/regions/01/indicators.json",
  "/api/indicators.json",
  "/data/v1/indicators/fields.json",
]) {
  const r = await get(path);
  check(path, r.status === 200 && r.tier === null && r.contentType.includes("json") && r.cors === "*",
    `status=${r.status} tier=${r.tier} ct=${r.contentType} cors=${r.cors}`);
}
{
  const r = await get("/data/v1/geometry/01.topojson");
  check("/data/v1/geometry/01.topojson is typed by _headers",
    r.status === 200 && r.contentType.includes("json"), `ct=${r.contentType}`);
}
for (const path of [
  "/data/v1/geometry/01.geojson",
  "/data/v1/geometry/provinces.geojson",
  "/api/communes/01.511.01.0/boundary.geojson",
  "/api/provinces/01.511/boundary.geojson",
  "/api/regions/01/boundary.geojson",
  "/api/arrondissements/01.511.01.05/boundary.geojson",
  "/api/communes/06.141.01.0/arrondissements.geojson",
  "/data/v1/geometry/arrondissements.geojson",
]) {
  const r = await get(path);
  check(`${path} is served as GeoJSON`,
    r.status === 200 && r.contentType.includes("application/geo+json") && r.cors === "*" &&
      (r.body?.type === "FeatureCollection" || r.body?.type === "Feature"),
    `status=${r.status} ct=${r.contentType} cors=${r.cors}`);
}

console.log("\nalias tier — the Worker rewrites to a pre-rendered file");
for (const [path, expected] of [
  ["/api/communes?province=01.511&page=1", "/api/provinces/01.511/communes/page/1.json"],
  ["/api/communes?type=urban&page=2", "/api/communes/type/urban/page/2.json"],
  ["/api/communes?region=01", "/api/regions/01/communes/page/1.json"],
  ["/api/communes/01.511.01.0", "/api/communes/01.511.01.0.json"],
  ["/api/communes/001511010", "/api/communes/01.511.01.0.json"],
  ["/api/communes/tanger", "/api/communes/01.511.01.0.json"],
  ["/api/communes/tanger/indicators", "/api/communes/01.511.01.0/indicators.json"],
  ["/api/provinces/01.511/indicators", "/api/provinces/01.511/indicators.json"],
  ["/api/indicators", "/api/indicators.json"],
  ["/api/regions", "/api/regions.json"],
] as const) {
  const r = await get(path);
  const located = r.contentLocation === expected || r.body?.links?.self === expected;
  check(path, r.status === 200 && r.tier === "alias" && located,
    `status=${r.status} tier=${r.tier} location=${r.contentLocation}`);
}

console.log("\ncomputed tier — answers no file holds");
{
  const r = await get("/api/search?q=tanger&limit=3");
  const first = r.body?.data?.[0];
  check("/api/search finds Tanger by its French name",
    r.status === 200 && r.tier === "computed" && first?.code === "01.511.01.0", JSON.stringify(first));
}
{
  const r = await get(`/api/search?q=${encodeURIComponent("طَنْجَة")}&limit=1`);
  check("/api/search finds it from Arabic written with vowel marks",
    r.body?.data?.[0]?.code === "01.511.01.0");
}
{
  const r = await get("/api/search?q=Shefshaouen&limit=10");
  const names = (r.body?.data ?? []).map((h: never) => (h as { name: { fr: string } }).name.fr);
  check("/api/search retrieves a transliteration variant", names.includes("Chefchaouen"), names.slice(0, 3).join(", "));
}
{
  const r = await get("/api/communes/near?lat=33.5731&lng=-7.5898&radius=15&limit=3");
  const hits = r.body?.data ?? [];
  const ordered = hits.every((h: never, i: number) =>
    i === 0 || (h as { distanceKm: number }).distanceKm >= (hits[i - 1] as { distanceKm: number }).distanceKm);
  check("/api/communes/near returns communes nearest first",
    r.status === 200 && r.tier === "computed" && hits.length > 0 && ordered);
}
{
  const all = await get("/api/communes?province=01.511");
  const urban = await get("/api/communes?province=01.511&type=urban");
  const rural = await get("/api/communes?province=01.511&type=rural");
  check("a two-filter query is computed and actually filters",
    urban.tier === "computed" &&
      (urban.body?.meta?.total ?? 0) + (rural.body?.meta?.total ?? 0) === (all.body?.meta?.total ?? -1),
    `all=${all.body?.meta?.total} urban=${urban.body?.meta?.total} rural=${rural.body?.meta?.total}`);
}
{
  // Tangier's old medina, answered from one tile.
  const r = await get("/api/communes/at?lat=35.786&lng=-5.8125");
  check("/api/communes/at finds the commune that contains a point, and its arrondissement",
    r.status === 200 && r.tier === "computed" && r.body?.data?.code === "01.511.01.0" &&
      r.body?.data?.arrondissement?.code === "01.511.01.07" &&
      r.contentLocation === "/api/communes/01.511.01.0.json",
    `status=${r.status} code=${r.body?.data?.code} arrondissement=${JSON.stringify(r.body?.data?.arrondissement)}`);
}
{
  const r = await get("/api/communes?sort=-population&min_population=500000");
  const people = (r.body?.data ?? []).map((c: never) => (c as { population: { "2024": { total: number } } }).population["2024"].total);
  check("a sorted, bounded list is computed from the records in memory",
    r.status === 200 && r.tier === "computed" && people.length > 0 &&
      people.every((p: number, i: number) => p >= 500000 && (i === 0 || p <= people[i - 1]!)),
    `status=${r.status} ${people.join(",")}`);
}
{
  const r = await get("/api/communes?region=01&sort=-labour.unemploymentRate");
  const rows = (r.body?.data ?? []) as { indicator?: { path: string; value: number | null } }[];
  const values = rows.map((c) => c.indicator?.value).filter((v): v is number => typeof v === "number");
  check("a list sorted by a census indicator carries the figure, largest first",
    r.status === 200 && r.tier === "computed" && rows[0]?.indicator?.path === "labour.unemploymentRate" &&
      values.length > 0 && values.every((v, i) => i === 0 || v <= values[i - 1]!),
    `status=${r.status} ${values.slice(0, 5).join(",")}`);
}
{
  // Province 04.421 is in région 04: the province's list is read, and every row filtered out.
  const r = await get("/api/communes?region=01&province=04.421");
  check("filters that contradict each other find nothing",
    r.status === 200 && r.body?.meta?.total === 0, `status=${r.status} total=${r.body?.meta?.total}`);
}

{
  const r = await get("/api/search?q=tanger&levels=commune,");
  check("/api/search reads a trailing comma in levels as nothing",
    r.status === 200 && (r.body?.data ?? []).length > 0, `status=${r.status}`);
}

console.log("\nproblem documents");
for (const [path, status] of [
  ["/api/communes/99.999.99.99", 404],
  ["/api/search", 400],
  ["/api/communes/near?lat=33&lng=-7&radius=9999", 400],
  ["/api/communes/near?lat=abc&lng=-7", 400],
  ["/api/communes?type=banana", 400],
  ["/api/communes/near?lng=-7.59", 400],
  ["/api/communes/near?lat=&lng=-7.59", 400],
  ["/api/communes?region=01.511", 400],
  ["/api/communes?region=01&page=4", 404],
  ["/api/communes?region=01&type=rural&page=4", 404],
  ["/api/communes/01.511.01.05", 404],
  ["/api/communes/at?lat=36.5&lng=-12", 404],
  ["/api/communes/at?lat=35.786", 400],
  [`/api/search?q=${"a".repeat(101)}`, 400],
  ["/api/communes?q=tanger&region=03", 400],
  ["/api/communes?q=", 400],
  ["/api/communes?sort=banana", 400],
  ["/api/communes?sort=-labour.unemployment", 400],
  ["/api/regions/tanger/indicators", 404],
  ["/api/communes?min_population=5&max_population=1", 400],
  ["/api/nonsense", 404],
] as const) {
  const r = await get(path);
  check(`${path} -> ${status}`,
    r.status === status && typeof r.body?.type === "string" && typeof r.body?.title === "string",
    `got ${r.status}`);
}

console.log("\nfor programs and agents");
{
  const response = await fetch(base + "/api/openapi.json");
  const spec = (await response.json()) as { openapi?: string; paths?: object };
  check("/api/openapi.json is an OpenAPI 3.1 document",
    response.status === 200 && spec.openapi === "3.1.0" && Object.keys(spec.paths ?? {}).length > 0);
}
{
  const response = await fetch(base + "/llms.txt");
  const text = await response.text();
  check("/llms.txt is served as text and links the spec",
    response.status === 200 && text.startsWith("# ") && text.includes("/api/openapi.json"));
}

console.log("\nmcp, in raw JSON-RPC so the probe does not lean on the SDK it is checking");
{
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: response.status, body: (await response.json()) as { result?: Record<string, never> } };
  };
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  check("/mcp initialize negotiates a protocol and offers tools",
    init.status === 200 && typeof init.body.result?.protocolVersion === "string" && "tools" in (init.body.result?.capabilities ?? {}));
  const list = await rpc("tools/list", {});
  const names = ((list.body.result?.tools ?? []) as { name: string }[]).map((t) => t.name).sort();
  check("/mcp lists the 6 tools",
    names.join(",") === "commune_at,communes_near,get_commune,get_indicators,list_communes,search", names.join(","));
  const call = await rpc("tools/call", { name: "get_commune", arguments: { id: "tanger" } });
  const commune = (call.body.result?.structuredContent as { commune?: { code: string; province: { name: string } } } | undefined)?.commune;
  check("/mcp get_commune answers with the parent named",
    commune?.code === "01.511.01.0" && commune.province.name === "Tanger-Assilah", JSON.stringify(commune)?.slice(0, 80));
  const figures = await rpc("tools/call", { name: "get_indicators", arguments: { unit: "tanger", topics: ["labour"] } });
  const total = (figures.body.result?.structuredContent as { figures?: { total?: { people?: { all?: { labour?: { unemploymentRate: number } } } } } } | undefined)
    ?.figures?.total;
  check("/mcp get_indicators reads a commune's census figures",
    total?.people?.all?.labour?.unemploymentRate === 15.3, JSON.stringify(total)?.slice(0, 80));
}

console.log("\nnot found, for a person rather than a client");
for (const [path, marker] of [
  ["/about", "No page here"],
  ["/fr/nulle-part", "Aucune page ici"],
] as const) {
  const response = await fetch(base + path);
  const text = await response.text();
  check(`${path} -> 404 page`,
    response.status === 404 && (response.headers.get("content-type") ?? "").includes("text/html") && text.includes(marker),
    `status=${response.status} ct=${response.headers.get("content-type")}`);
}

console.log("\npages");
for (const path of [
  "/docs/api/", "/docs/mcp/", "/docs/components/", "/docs/npm/", "/fr/docs/api/", "/fr/docs/mcp/",
  "/communes/", "/communes/tanger/", "/fr/communes/tafraout/", "/provinces/chefchaouen/", "/regions/oriental/",
]) {
  const response = await fetch(base + path);
  check(`${path} is a page`, response.status === 200 && (response.headers.get("content-type") ?? "").includes("text/html"),
    `status=${response.status}`);
}
{
  const response = await fetch(base + "/map/communes.json");
  const rows = response.ok ? ((await response.json()) as Record<string, unknown[]>) : {};
  check("/map/communes.json has a row for every commune", Object.keys(rows).length === 1503, `${Object.keys(rows).length}`);
}
{
  // A problem's type is a link, and it has to land on the entry that describes it.
  const r = await get("/api/communes/99.999.99.99");
  const type = new URL(String(r.body?.type ?? "about:blank"));
  const page = type.origin === new URL(base).origin ? await (await fetch(base + type.pathname)).text() : "";
  check("a problem's type links to its entry on the API page",
    type.pathname === "/docs/api/" && page.includes(`id="${type.hash.slice(1)}"`), String(r.body?.type));
}
{
  const response = await fetch(base + "/components/commune-picker.js");
  check("the picker script can be loaded from another site",
    response.status === 200 &&
      response.headers.get("access-control-allow-origin") === "*" &&
      (response.headers.get("content-type") ?? "").includes("javascript"),
    `cors=${response.headers.get("access-control-allow-origin")} ct=${response.headers.get("content-type")}`);
}

console.log(`\n${failures === 0 ? "all probes passed" : `${failures} probe(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
