# Morocco communes API

An open dataset and HTTP API for Morocco's administrative divisions: 12 régions, 75
provinces and préfectures, 8 préfectures d'arrondissements, 213 cercles, 1,503 communes
and 41 arrondissements, with
official HCP geographic codes, names in French and Arabic, 2024 and 2014 population, and
boundaries from OpenStreetMap.

Nothing equivalent was published openly, so this builds it from the primary sources and
shows the working.

## The dataset

`data/v1/` is committed and versioned, so you can use it without the API at all.

| Directory | Holds | Licence |
|---|---|---|
| `attributes/` | every unit, JSON and CSV | HCP, attributed |
| `geometry/` | one TopoJSON per région | **ODbL** — share-alike |
| `crosswalk/` | the 2014 ↔ 2024 reconciliation | HCP, attributed |
| `sources.json` | each source's digest, licence and vintage | — |

The licences differ by directory and `geometry/` carries its own LICENSE. Three fields on
each commune — `centroid`, `bbox` and `osm` — come from OpenStreetMap and are ODbL too;
`provenance.geometry` marks them.

Rebuild it with `pnpm dataset:build`. From the same cache the output is byte-identical.

## The API

Three tiers, and which one served a response is in its `X-Api-Tier` header.

**Pre-rendered** — 3,852 files written at build time and served straight from
Cloudflare's asset store, without invoking Worker code. Free and unmetered.

```
GET /api/regions.json                        GET /api/regions/01.json
GET /api/regions/01/provinces.json           GET /api/regions/01/communes/page/1.json
GET /api/provinces/01.511.json               GET /api/provinces/01.511/cercles.json
GET /api/cercles/01.511.05.json              GET /api/communes/01.511.01.0.json
GET /api/communes/page/1.json                GET /api/communes/type/urban/page/1.json
GET /api/communes/01.511.01.0/arrondissements.json
GET /api/arrondissements/01.511.01.05.json   GET /api/version.json
GET /data/v1/**
```

**Alias** — the query-string and extensionless shapes. A path-keyed asset store can't
match on a query string, so the Worker resolves these to the file that already holds the
answer and names it in `Content-Location`:

```
GET /api/communes?province=01.511&page=1     GET /api/communes?type=urban
GET /api/communes/tanger                     GET /api/communes/001511010
```

**Computed** — the answers no file holds:

```
GET /api/search?q=tanger&levels=commune&limit=10
GET /api/communes/near?lat=33.5731&lng=-7.5898&radius=15
GET /api/communes?province=01.511&type=urban
```

Search takes French, Arabic or a slug. It folds the alef variants, ta-marbuta and alef
maqsura the names actually carry, and the tatweel and vowel marks they never do but people
type anyway. `01.511.01.0`, `001511010`, `1511010` and `tanger` all address one commune,
and 17 exonyms are listed by hand because no amount of character folding gets from `Fez`
to Fès or from `Port Lyautey` to Kénitra.

Every response is enveloped with `data`, `meta` and `links`. Errors are RFC 9457 problem
documents, and a well-formed code that names nothing is a 404 while something unsearchable
is a 400. CORS is open.

Full reference: [`api/README.md`](api/README.md).

## The docs site

`site/` is an Astro site in English and French. It builds to static HTML — the only
JavaScript is a Solid island for the playground, which issues live queries against
whatever it is deployed beside and shows the request URL and the `X-Api-Tier` of the
response.

The hero draws all 1,502 commune boundaries from `data/v1/geometry`, simplified at build
time by `site/scripts/outline.ts` to a tolerance that stays under a device pixel at the
size it renders. It is the dataset, not an illustration of it.

Arabic names are in the data and Arabic queries work — the site's own interface is
English and French.

It is static on purpose: nothing in it needs a server, so the hand-written Worker stays
the only Worker and the pages cost nothing to serve.

## Running it

```sh
pnpm install
pnpm dataset:build     # rebuilds data/v1 from the cached sources
pnpm build             # the docs site, then the API tree, into dist/
pnpm api:dev           # wrangler dev on :8788 — serves the site and the API together
pnpm api:smoke         # probes a running deployment
pnpm check             # typecheck both trees, then the tests
```

The order inside `pnpm build` matters: Astro clears its output directory, so the site
builds first and the API tree is emitted into the same `dist/` afterwards.

`pnpm site:dev` runs Astro alone with hot reload, but the playground has no API to call
that way — use `pnpm api:dev` to see both.

Node 22 or newer. Deploying needs a Cloudflare account; see `api/README.md`.

## How the data was assembled

`docs/design/` holds the design record: the spec, and a plan per stage with the evidence
behind each decision.

The short version. HCP publishes the census as Excel, where the code column is stored
numerically and has lost its leading zeros, so codes arrive 7, 8 or 9 digits wide. The
hierarchy is recovered from document row order rather than from code arithmetic, which is
then used only to check parentage. Urban and rural come from the same row order: a commune
listed before a `Cercle` heading is a municipality.

Boundaries come from OpenStreetMap `admin_level=8` relations, joined to HCP on the
`ref:MA:HCP` tag that all 1,503 carry. Overpass returns each boundary as unordered way
fragments, so the rings are stitched end to end before anything is emitted. 1,502 of the
1,503 come through: Sidi Mohamed Benmansour's relation has no closeable outer ring, so it
ships with a null `centroid`, `bbox` and `osm` rather than a repaired guess.

207 communes were renumbered by the 2015 reform and have no 2014 figure under their
current code. `crosswalk/` reconciles them in two deterministic passes and records the
evidence for every pairing, so each row can be checked rather than taken on trust.

## Credits and prior work

- **Haut-Commissariat au Plan** — RGPH 2024 and RGPH 2014, the source of every code, name
  and population figure.
- **OpenStreetMap contributors** — every boundary, centroid and bounding box, under ODbL.
- [mahdiboughrous/moroccan-administrative-division-data](https://github.com/mahdiboughrous/moroccan-administrative-division-data)
  and [zeys/regionsPrefecturesProvincesCommunesMaroc](https://github.com/zeys/regionsPrefecturesProvincesCommunesMaroc)
  — earlier open lists of the divisions, used to cross-check this one.
- [tn-municipality-api](https://tn-municipality-api.vercel.app) — the Tunisian project
  this is modelled on.

## Licence

Code is MIT. The data licences are per directory, as above.
