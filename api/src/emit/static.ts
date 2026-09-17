import { envelope, pageMeta, paginate, PER_PAGE, type Envelope } from "../lib/envelope.ts";
import { groupBy, type Dataset } from "../lib/dataset.ts";

export type Tree = Map<string, Envelope<unknown>>;

/**
 * Cache-Control on the asset tier. The dataset is immutable for a given version and a
 * correction ships as a new deploy, so a long max-age is safe and it is what keeps the
 * free tier free: a cached response never reaches Cloudflare at all.
 */
export const HEADERS_FILE = `/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, OPTIONS
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/data/*
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
  for (const c of d.communes) {
    put(api(`communes/${c.code}.json`), envelope(c, { self: api(`communes/${c.code}.json`) }));
    whole(api(`communes/${c.code}/arrondissements.json`), arrondissementsByCommune.get(c.code) ?? []);
  }

  whole(api("arrondissements.json"), d.arrondissements);
  for (const a of d.arrondissements) {
    put(api(`arrondissements/${a.code}.json`), envelope(a, { self: api(`arrondissements/${a.code}.json`) }));
  }

  put(api("version.json"), buildVersion(d));
  return tree;
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
