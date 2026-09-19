# Morocco communes API

An open dataset and HTTP API for Morocco's administrative divisions: 12 régions, 75
provinces and préfectures, 8 préfectures d'arrondissements, 213 cercles, 1,503 communes
and 41 arrondissements, with
official HCP geographic codes, names in French and Arabic, 2024 and 2014 population, HCP's
2024 census figures on age, education, languages, work and housing, and boundaries from
OpenStreetMap.

HCP publishes the census as spreadsheets. This builds a dataset, an API and a site from them
and from OpenStreetMap, and shows the working.

## The dataset

`data/v1/` is committed and versioned, so you can use it without the API at all.

| Directory | Holds | Licence |
|---|---|---|
| `attributes/` | every unit, JSON and CSV | HCP, on CC BY 4.0 terms |
| `geometry/` | one TopoJSON per région | **ODbL**, share-alike |
| `indicators/` | the 2024 census indicators for every unit, JSON and CSV | HCP, on CC BY 4.0 terms |
| `crosswalk/` | the 2014 ↔ 2024 reconciliation | HCP, on CC BY 4.0 terms |
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

**Pre-rendered.** 7,643 files written at build time and served straight from
Cloudflare's asset store, without invoking Worker code. Free and unmetered.

```
GET /api/regions.json                        GET /api/regions/01.json
GET /api/regions/01/provinces.json           GET /api/regions/01/communes/page/1.json
GET /api/provinces/01.511.json               GET /api/provinces/01.511/cercles.json
GET /api/cercles/01.511.05.json              GET /api/communes/01.511.01.0.json
GET /api/communes/page/1.json                GET /api/communes/type/urban/page/1.json
GET /api/communes/01.511.01.0/arrondissements.json
GET /api/communes/01.511.01.0/indicators.json
GET /api/arrondissements/01.511.01.05.json   GET /api/indicators.json
GET /api/version.json
GET /data/v1/**
```

**Alias.** The query-string and extensionless shapes. A path-keyed asset store can't
match on a query string, so the Worker resolves these to the file that already holds the
answer and names it in `Content-Location`:

```
GET /api/communes?province=01.511&page=1     GET /api/communes?type=urban
GET /api/communes/tanger                     GET /api/communes/001511010
GET /api/communes/tanger/indicators
```

**Computed.** The answers no file holds:

```
GET /api/search?q=tanger&levels=commune&limit=10
GET /api/communes/near?lat=33.5731&lng=-7.5898&radius=15
GET /api/communes/at?lat=35.786&lng=-5.8125
GET /api/communes?province=01.511&type=urban
GET /api/communes?sort=-population&min_population=100000
GET /api/communes?region=01&sort=-labour.unemploymentRate
```

A list sorts by any of the census indicators, by its path, and each commune it lists then
carries the figure it was sorted by.

Search takes French, Arabic or a slug. It folds the alef variants, ta-marbuta and alef
maqsura the names actually carry, and the tatweel and vowel marks they never do but people
type anyway. It matches names spelt another way by their consonants, so `titwan` finds
Tétouan and `jdida` El Jadida. `01.511.01.0`, `001511010`, `1511010` and `tanger` all
address one commune, and 18 exonyms are listed by hand because no amount of character folding gets from `Fez`
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
- **`/mcp`**: an MCP server with 6 read-only tools (`search`, `get_commune`,
  `communes_near`, `commune_at`, `list_communes`, `get_indicators`), so Claude, Claude Code
  and other MCP clients can query the data directly, census figures included. The site's
  `/docs/mcp/` page has the setup for each client.

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
page has its figures and rank, a map of its province, the communes it borders, where its
change sits among all of them, and its census figures: an age pyramid of men and women,
headline rates beside the women's and the country's, and the languages its people use.
A list of every commune filters as you type, in French or Arabic.

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
ships with its geometry fields null rather than a repaired guess. The 41 arrondissements
come from `admin_level=10` relations the same way, all of them, and each has to sit
inside its commune and the set has to cover the city.

HCP's indicators workbook lists the same units under the same codes, so it joins by code:
every one of the 1,852 units and the 164 urban centres. Each column is named after the
heading HCP gives it, and the build refuses the workbook if a heading has moved. It then
checks that each unit's population and household count equal the population file's and
that the figures add up. `indicators/README.md` has the details.

207 communes were renumbered by the 2015 reform and have no 2014 figure under their
current code. `crosswalk/` reconciles them in two deterministic passes and records the
evidence for every pairing, so each row can be checked rather than taken on trust.

## How it compares

Checked in September 2026, against each source's own files and licence.

| Source | What it has | Licence and limits |
|---|---|---|
| [Wikidata](https://www.wikidata.org/wiki/Property:P11958) | the 2024 code for 1,495 of the 1,503 communes, Arabic names, and 2024 population equal to HCP's for 1,488; a boundary for 13 | CC0 |
| [OCHA HDX](https://data.humdata.org/dataset/cod-ab-mar) | région and province boundaries from HCP, on UN p-codes, for 10 of the 12 régions | CC BY-IGO |
| [geoBoundaries](https://www.geoboundaries.org/) | région and province boundaries from OpenStreetMap, as of 2017 | ODbL |
| [GADM 4.1](https://gadm.org/) | 1,515 commune polygons on the map before the 2015 reform, without codes | no commercial use without permission |
| [GeoNames](https://www.geonames.org/) | points for 1,794 places at commune level, on its own codes, with older population figures | CC BY 4.0; 1,000 credits an hour |
| [Nominatim](https://nominatim.org/) | live OpenStreetMap, each commune's HCP code included | ODbL; 1 request a second |
| [HCP](https://www.hcp.ma/downloads/RGPH-2024_t22752.html) | the census itself, as spreadsheets | CC BY 4.0 terms |
| lists on GitHub and npm | régions and cities, or communes without codes or population | varies, some without a licence |

What only this has: a boundary for every commune but one on the 2024 codes, the 2014 to
2024 reconciliation, HCP's 2024 indicators for every unit, and an API that finds a place by
any spelling, by a point or by distance, with no key. Its static answers have no rate
limit, and a computed one takes about a millisecond of CPU.

Where another source fits better: Wikidata's CC0 asks less than CC BY and ODbL. HDX's
province boundaries come from HCP, where these come from OpenStreetMap, which leaves one
commune without a boundary and 88 km² near Ifrane uncovered. HCP's 2014 commune polygons on
its map site are official, if older. Nominatim reads OpenStreetMap live, where this is a
snapshot.

## Credits and prior work

- **Haut-Commissariat au Plan**: RGPH 2024 and RGPH 2014, the source of every code, name,
  population figure and census indicator.
- **OpenStreetMap contributors**: every boundary, centroid and bounding box, under ODbL.
- [mahdiboughrous/moroccan-administrative-division-data](https://github.com/mahdiboughrous/moroccan-administrative-division-data)
  and [zeys/regionsPrefecturesProvincesCommunesMaroc](https://github.com/zeys/regionsPrefecturesProvincesCommunesMaroc):
  earlier open lists of the divisions. The audit this dataset began with measured both
  against the census.
- [tn-municipality-api](https://tn-municipality-api.vercel.app), the Tunisian project
  this is modelled on.
- [Bouazzi Maghribi](https://github.com/aleftypefoundry/bouazzi-maghribi), the Maghribi face
  the site sets Arabic in, from Alef Type Foundry under the SIL Open Font License.

## Citing it, and correcting it

`CITATION.cff` holds the citation, which GitHub shows as "Cite this repository". A wrong
name, figure or boundary can be reported with the data issue form, which asks for the
source that settles it. Every push runs the tests, builds everything and probes it
under `wrangler dev`.

## Licence

Code is MIT. The data licences are per directory, as above.
