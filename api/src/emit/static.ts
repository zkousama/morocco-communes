import { envelope, pageMeta, paginate, PER_PAGE, type Envelope } from "../lib/envelope.ts";
import { groupBy, type Dataset } from "../lib/dataset.ts";
import type { IndicatorRecord } from "../lib/indicators.ts";
import type { EconomyRecord } from "../lib/economy.ts";
import type { HousingRecord } from "../lib/housing.ts";

export type Tree = Map<string, Envelope<unknown>>;

/**
 * Cache-Control on the asset tier. The dataset is immutable for a given version and a
 * correction ships as a new deploy, so a long max-age is safe and it is what keeps the
 * free tier free: a cached response never reaches Cloudflare at all.
 */
/**
 * Which paths run the functions on Cloudflare Pages. Every file the API tree holds ends in
 * .json or .geojson and is excluded, so Pages serves it without running code: free and
 * unmetered. The rest of /api, and /mcp, is the live tier. A rule may put its wildcard
 * before an extension, which was tested on a live Pages project before relying on it.
 */
export const ROUTES_FILE = `${JSON.stringify(
  { version: 1, include: ["/api/*", "/mcp"], exclude: ["/api/*.json", "/api/*.geojson"] },
  null,
  2,
)}\n`;

export const HEADERS_FILE = `/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, OPTIONS
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/data/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/data/v1/geometry/*.topojson
  Content-Type: application/json

/data/v1/geometry/*.geojson
  Content-Type: application/geo+json

/api/communes/*/boundary.geojson
  Content-Type: application/geo+json

/api/provinces/*/boundary.geojson
  Content-Type: application/geo+json

/api/regions/*/boundary.geojson
  Content-Type: application/geo+json

/api/arrondissements/*/boundary.geojson
  Content-Type: application/geo+json

/api/communes/*/arrondissements.geojson
  Content-Type: application/geo+json

/components/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400
`;

const api = (path: string) => `/api/${path}`;

/**
 * Writes one file per answer the dataset can give without being asked a question it
 * cannot anticipate.
 *
 * Empty lists are emitted rather than left out: 8 préfectures d'arrondissements have no
 * communes of their own and 14 provinces have no cercles, and a client asking for them
 * should read an empty list from the free tier rather than a 404 from a metered one.
 * Same reasoning for the 1,497 communes with no arrondissements.
 */
export function emitTree(d: Dataset): Tree {
  const tree: Tree = new Map();
  const put = (path: string, body: Envelope<unknown>) => {
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, body);
  };

  const whole = (path: string, rows: unknown[]) =>
    put(path, envelope(rows, { self: path }, { total: rows.length }));

  /** A paginated list always has page 1, even when it holds nothing. */
  const paged = (base: string, rows: unknown[]) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    for (let page = 1; page <= totalPages; page++) {
      const { slice, meta } = paginate(rows, page);
      put(`${base}/${page}.json`, envelope(slice, pageMeta(base, page, totalPages), meta));
    }
  };

  const provincesByRegion = groupBy(d.provinces, (p) => p.regionCode);
  const cerclesByProvince = groupBy(d.cercles, (c) => c.provinceCode);
  const communesByRegion = groupBy(d.communes, (c) => c.parents.region);
  const communesByProvince = groupBy(d.communes, (c) => c.parents.province);
  const communesByCercle = groupBy(d.communes, (c) => c.parents.cercle);
  const arrondissementsByCommune = groupBy(d.arrondissements, (a) => a.communeCode);

  whole(api("regions.json"), d.regions);
  for (const r of d.regions) {
    put(api(`regions/${r.code}.json`), envelope(r, { self: api(`regions/${r.code}.json`) }));
    whole(api(`regions/${r.code}/provinces.json`), provincesByRegion.get(r.code) ?? []);
    paged(api(`regions/${r.code}/communes/page`), communesByRegion.get(r.code) ?? []);
  }

  whole(api("provinces.json"), d.provinces);
  for (const p of d.provinces) {
    put(api(`provinces/${p.code}.json`), envelope(p, { self: api(`provinces/${p.code}.json`) }));
    whole(api(`provinces/${p.code}/cercles.json`), cerclesByProvince.get(p.code) ?? []);
    paged(api(`provinces/${p.code}/communes/page`), communesByProvince.get(p.code) ?? []);
  }

  whole(api("cercles.json"), d.cercles);
  for (const c of d.cercles) {
    put(api(`cercles/${c.code}.json`), envelope(c, { self: api(`cercles/${c.code}.json`) }));
    paged(api(`cercles/${c.code}/communes/page`), communesByCercle.get(c.code) ?? []);
  }

  paged(api("communes/page"), d.communes);
  // ?type= is the one single-key filter the Worker cannot answer by narrowing to a
  // parent's list: it spans the whole country, which would be 31 subrequests. 31 files
  // instead.
  for (const type of ["urban", "rural"] as const) {
    paged(api(`communes/type/${type}/page`), d.communes.filter((c) => c.type === type));
  }
  // The communes each one borders, named, so the answer needs no second call. Derived
  // from the boundaries, so it carries their ODbL terms rather than the census licence.
  const nameOf = new Map(d.communes.map((c) => [c.code, (c as unknown as { name: { fr: string; ar: string } }).name]));
  const neighboursOf = new Map(d.adjacency.map((row) => [row.code, row.neighbours]));
  for (const c of d.communes) {
    put(api(`communes/${c.code}.json`), envelope(c, { self: api(`communes/${c.code}.json`) }));
    whole(api(`communes/${c.code}/arrondissements.json`), arrondissementsByCommune.get(c.code) ?? []);
    whole(
      api(`communes/${c.code}/neighbours.json`),
      (neighboursOf.get(c.code) ?? []).map((n) => ({ code: n.code, name: nameOf.get(n.code) ?? null, km: n.km })),
    );
  }

  whole(api("arrondissements.json"), d.arrondissements);
  for (const a of d.arrondissements) {
    put(api(`arrondissements/${a.code}.json`), envelope(a, { self: api(`arrondissements/${a.code}.json`) }));
  }

  put(api("version.json"), buildVersion(d));
  return tree;
}

/**
 * The levels that also come as one file of every unit at that level. Reading a level one
 * unit at a time would take more subrequests than a Worker on the free plan gets, and a
 * city's arrondissements are the only figures those 6 cities have.
 */
const LEVEL_FILES = [
  ["region", "regions"],
  ["province", "provinces"],
  ["arrondissement", "arrondissements"],
] as const;

const COLLECTION: Record<string, string> = {
  region: "regions",
  province: "provinces",
  cercle: "cercles",
  commune: "communes",
  arrondissement: "arrondissements",
};

/**
 * HCP's census indicators, a file per unit beside its record, and the country's at
 * /api/indicators.json. A commune's file carries its urban centres' figures too, since a
 * centre has no record of its own. The 12 régions and the 83 provinces also come as one
 * file each, to compare them: reading them one at a time would take more subrequests than
 * a Worker on the free plan gets.
 */
export function emitIndicators(tree: Tree, records: IndicatorRecord[]): void {
  const put = (path: string, data: unknown) => {
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, envelope(data, { self: path }));
  };
  const centres = groupBy(
    records.filter((r) => r.level === "urbanCentre"),
    (r) => r.communeCode ?? null,
  );
  for (const r of records) {
    if (r.level === "urbanCentre") continue;
    if (r.level === "country") {
      put(api("indicators.json"), r);
      continue;
    }
    const collection = COLLECTION[r.level];
    if (!collection) throw new Error(`no collection for ${r.level}`);
    put(api(`${collection}/${r.code}/indicators.json`), r.level === "commune" ? { ...r, urbanCentres: centres.get(r.code!) ?? [] } : r);
  }
  for (const [level, collection] of LEVEL_FILES) {
    const rows = records.filter((r) => r.level === level);
    const path = api(`${collection}/indicators.json`);
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, envelope(rows, { self: path }, { total: rows.length }));
  }
}

/**
 * The 2024 count of economic establishments, a file per unit beside its record, and the
 * country's at /api/economy.json. The 12 régions, the 83 provinces and the 41
 * arrondissements also come as one file each, to compare them without spending a
 * subrequest per unit. A city the census counts by arrondissement carries the sum of its
 * own, marked in the record.
 */
export function emitEconomy(tree: Tree, records: EconomyRecord[]): void {
  const put = (path: string, data: unknown) => {
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, envelope(data, { self: path }));
  };
  for (const r of records) {
    if (r.level === "country") {
      put(api("economy.json"), r);
      continue;
    }
    const collection = COLLECTION[r.level];
    if (!collection) throw new Error(`no collection for ${r.level}`);
    put(api(`${collection}/${r.code}/economy.json`), r);
  }
  for (const [level, collection] of LEVEL_FILES) {
    const rows = records.filter((r) => r.level === level);
    const path = api(`${collection}/economy.json`);
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, envelope(rows, { self: path }, { total: rows.length }));
  }
}

/**
 * The urban housing stock, a file per unit that has one, and the country's at
 * /api/housing.json. A unit with no urban area has no file: it has no urban dwellings.
 */
export function emitHousing(tree: Tree, records: HousingRecord[]): void {
  const put = (path: string, data: unknown) => {
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, envelope(data, { self: path }));
  };
  const centres = groupBy(records.filter((r) => r.level === "urbanCentre"), (r) => r.communeCode ?? null);
  for (const r of records) {
    if (r.level === "urbanCentre") continue;
    if (r.level === "country") {
      put(api("housing.json"), r);
      continue;
    }
    const collection = COLLECTION[r.level];
    if (!collection) throw new Error(`no collection for ${r.level}`);
    put(api(`${collection}/${r.code}/housing.json`), r.level === "commune" ? { ...r, urbanCentres: centres.get(r.code!) ?? [] } : r);
  }
  for (const [level, collection] of LEVEL_FILES) {
    const rows = records.filter((r) => r.level === level);
    const path = api(`${collection}/housing.json`);
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, envelope(rows, { self: path }, { total: rows.length }));
  }
}

/**
 * The insights the pipeline has published: a file per unit with at least one finding worth
 * showing, at `/api/{collection}/{code}/insights.json`, and the index of them all at
 * `/api/insights.json`. Nothing is published on a fresh checkout, so only the index, empty,
 * is written until the pipeline's first run clears its gate.
 */
export function emitInsights(tree: Tree, insights: { units: Record<string, unknown>[]; index: unknown[] }): void {
  const put = (path: string, data: unknown) => {
    if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
    tree.set(path, envelope(data, { self: path }));
  };
  for (const unit of insights.units) {
    const { level, code } = unit as { level: string; code: string };
    const collection = COLLECTION[level];
    if (!collection) throw new Error(`no collection for ${level}`);
    put(api(`${collection}/${code}/insights.json`), unit);
  }
  const path = api("insights.json");
  if (tree.has(path)) throw new Error(`two answers claim the same path: ${path}`);
  tree.set(path, envelope(insights.index, { self: path }, { total: insights.index.length }));
}

export function buildVersion(d: Dataset): Envelope<unknown> {
  return envelope(
    {
      api: "v1",
      counts: {
        regions: d.regions.length,
        provinces: d.provinces.length,
        cercles: d.cercles.length,
        communes: d.communes.length,
        arrondissements: d.arrondissements.length,
      },
      sources: d.sources,
    },
    { self: api("version.json") },
  );
}
