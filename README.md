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
| `geometry/` | one TopoJSON per région | **ODbL**, share-alike |
| `crosswalk/` | the 2014 ↔ 2024 reconciliation | HCP, attributed |
| `sources.json` | each source's digest, licence and vintage | |

The licences differ by directory and `geometry/` carries its own LICENSE. Five fields on
each commune (`centroid`, `bbox`, `osm`, `areaKm2` and `density`) come from OpenStreetMap
and are ODbL too; `provenance.geometry` marks them. Every level has a CSV that opens
cleanly in Excel, Arabic included.

Rebuild it with `pnpm dataset:build`. From the same cache the output is byte-identical.

`pnpm build` also writes the boundaries as GeoJSON from the TopoJSON above: each commune,
and each province and région outlined from its communes. They're served beside it rather
than committed.

## The API

Three tiers, and which one served a response is in its `X-Api-Tier` header.

**Pre-rendered.** 5,743 files written at build time and served straight from
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

**Alias.** The query-string and extensionless shapes. A path-keyed asset store can't
match on a query string, so the Worker resolves these to the file that already holds the
answer and names it in `Content-Location`:

```
GET /api/communes?province=01.511&page=1     GET /api/communes?type=urban
GET /api/communes/tanger                     GET /api/communes/001511010
```

**Computed.** The answers no file holds:

```
GET /api/search?q=tanger&levels=commune&limit=10
GET /api/communes/near?lat=33.5731&lng=-7.5898&radius=15
GET /api/communes/at?lat=35.786&lng=-5.8125
GET /api/communes?province=01.511&type=urban
GET /api/communes?sort=-population&min_population=100000
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

### For programs and agents

- **`/api/openapi.json`**: an OpenAPI 3.1 description of every route, built from the
  same module the Worker reads its limits from, so the defaults and bounds it states are
  the ones enforced. Most agent frameworks turn it into tools directly.
- **`/llms.txt`**: a short markdown map of the API and the dataset, in the llmstxt.org
  shape, for an LLM reading the site.
- **`/mcp`**: an MCP server with 5 read-only tools (`search`, `get_commune`,
  `communes_near`, `commune_at`, `list_communes`), so Claude, Claude Code and other MCP clients can query
  the data directly. The site's `/docs/mcp/` page has the setup for each client.

### In a form, or offline

- **`/components/commune-picker.js`**: a custom element that fills a région, a province
  and a commune `<select>` from the static files, so a form posts the commune's HCP code.
  It's served with open CORS, and `/docs/components/` has a React version beside it.
- **`morocco-communes`**: the dataset as an npm package, in `packages/morocco-communes/`.
  Codes, names, parents and population as ES modules with types, one per level, and
  without the OpenStreetMap fields, so it carries no ODbL terms. `pnpm npm:build` builds
  it from `data/v1`, and the package takes the dataset's version number.

## The docs site

`site/` is an Astro site in English and French, with a light and dark theme and a control
to pick either or follow the system. It builds to static HTML: the home page, 4 docs pages
(the API reference, the MCP setup, the components and the npm package), and a page for
every région, province and commune, 3,210 pages in all.

The home page opens on a map of every commune, shaded by density, change since 2014, or
urban and rural. Hovering one shows its figures and clicking opens its page. A commune's
page has its figures and rank, a map of its province, the communes it borders, and where
its change sits among all of them. A list of every commune filters as you type, in French
or Arabic.

Its JavaScript is the map's hover and switch, the list's filter, the playground (a Solid
island that queries whatever API it's deployed beside and shows the `X-Api-Tier` of each
response), the picker on the components page, and the copy buttons.

Everything on it that describes the data or the API is generated at build time, by the
scripts under `site/scripts/`:

- `map.ts` draws the home map from the TopoJSON the API serves. Each shared border is one
  arc, simplified once for both of its communes, so the fills meet without slivers. Its
  colours were checked for contrast and colour-blind separation in both themes.
- `hierarchy.ts` builds the code ladder, a real chain from région down to arrondissement.
- `charts.ts` computes population change per région, the distribution of commune sizes,
  how few communes hold half the population, how many communes lost people, and the growth
  spread of the 207 crosswalked communes against the 1,286 whose code never changed. That
  last one is the reconciliation checking itself: the two distributions sit almost on top
  of each other.

- `downloads.ts` lists the files under `data/v1` with their real sizes, and fails the
  build on a file that isn't there.
- `reference.ts` builds the API reference from `buildOpenApi`, with each example a real
  response from the emitted files or the Worker's own functions, and lists the MCP tools
  by connecting a client to the server. The French page reads a translation of each line
  of the spec, and the build fails when one is missing or left over.

The région, province and commune pages are built from `site/src/lib/places.ts`, which
reads `data/v1` once per build: ranks, the communes each one borders, matched on shared
boundary points, and small maps drawn the same way as the home map.

The charts are inline SVG and CSS, so they need no JavaScript and no charting library.
`outline.ts` draws the older single-colour map that the link preview image uses.

Arabic names are in the data and Arabic queries work; the interface is English and French.

It's static because nothing in it needs a server, so the hand-written Worker stays
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
that way; use `pnpm api:dev` to see both.

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
ships with its geometry fields null rather than a repaired guess.

207 communes were renumbered by the 2015 reform and have no 2014 figure under their
current code. `crosswalk/` reconciles them in two deterministic passes and records the
evidence for every pairing, so each row can be checked rather than taken on trust.

## Credits and prior work

- **Haut-Commissariat au Plan**: RGPH 2024 and RGPH 2014, the source of every code, name
  and population figure.
- **OpenStreetMap contributors**: every boundary, centroid and bounding box, under ODbL.
- [mahdiboughrous/moroccan-administrative-division-data](https://github.com/mahdiboughrous/moroccan-administrative-division-data)
  and [zeys/regionsPrefecturesProvincesCommunesMaroc](https://github.com/zeys/regionsPrefecturesProvincesCommunesMaroc):
  earlier open lists of the divisions. The audit this dataset began with measured both
  against the census.
- [tn-municipality-api](https://tn-municipality-api.vercel.app), the Tunisian project
  this is modelled on.

## Citing it, and correcting it

`CITATION.cff` holds the citation, which GitHub shows as "Cite this repository". A wrong
name, figure or boundary can be reported with the data issue form, which asks for the
source that settles it. Every push runs the tests, builds everything and probes it
under `wrangler dev`.

## Licence

Code is MIT. The data licences are per directory, as above.
