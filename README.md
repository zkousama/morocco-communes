# Morocco Commune API: design

**Status:** approved for planning
**Date:** 2026-09-17

An open dataset and JSON API covering Morocco's full administrative hierarchy, from the
12 régions down to the 1,503 communes and the 41 arrondissements. Comparable in spirit to
`tn-municipality-api`, but Morocco has no equivalent, and no open commune-level dataset
exists to build one on. Producing that dataset is the larger half of the work.

---

## 1. What the audit established

Every number below was verified against the sources on 2026-09-17. They are the basis for
the design, so the pipeline re-checks them on each run and fails the build when they drift.

### The proposed starting point doesn't hold

`mahdiboughrous/moroccan-administrative-division-data` (MIT) carries 881 communes against
1,503, and 64 provinces against 75. Drâa-Tafilalet is absent outright: zero provinces,
zero communes. Casablanca-Settat has 65 of its 168 communes, Tanger-Tétouan-Al Hoceima 46
of 246. Identifiers are synthetic (`COM_0001`). What it holds is names and a hierarchy;
population, coordinates and arrondissements would all have to come from elsewhere. Its own `raw/communes.json` ships 47 processing notes
recording where the sourcing was uncertain; the data was scraped from Wikipedia through a
language model.

It keeps one job: it holds EN and ES names, which the official sources don't, and it is
credited as prior work.

`zeys/regionsPrefecturesProvincesCommunesMaroc` gives 1,569 commune names across 84
divisions, Arabic only, with no codes and no types. It is an independent cross-check on
Arabic spellings, nothing more.

### There are no open commune boundaries

HDX COD-AB (`cod-ab-mar`, CC BY-IGO, HCP-sourced) stops at Admin 2 — 10 admin-1 units and
69 admin-2. It drops the two Western Sahara regions and identifies units by OCHA pcode
(`MA009001`), not HCP code. geoBoundaries (ODbL) also stops at ADM2.

Neither has a single commune boundary. That absence is why no Moroccan equivalent of the
Tunisian API exists, and it makes the geometry half of this project novel.

### The real spine

Two HCP publications and OpenStreetMap cover everything in scope.

**HCP RGPH 2024** (`https://www.hcp.ma/file/242341/`). One sheet, 2,328 rows, carrying the
official `Code géographique`, French and Arabic names, and population, foreigners and
households for 12 régions, 83 province-level rows, 213 cercles, 1,503 communes and 41
arrondissements, plus 164 `dont le centre urbain de …` rows. Excel stored the code column
numerically, so leading zeros are gone and codes arrive 7, 8 or 9 digits long.

The 83 province-level rows are the 75 official provinces and préfectures plus 8
*préfectures d'arrondissements*, which exist only in Casablanca and group its 16
arrondissements. All 75 official units are present, and OSM's `admin_level=5` matches them
exactly.

The 1,503 commune populations sum to 36,828,330, which is exactly the published national
legal population. The commune layer partitions the country with no gap and no overlap.

**HCP RGPH 2014** (`https://www.hcp.ma/file/230057/`). Same structure, and its codes are
in the canonical dotted form `01.051.01.01.`. At the 9-digit level it holds 1,538 units:
215 municipalities, 1,282 rural communes and 41 arrondissements. Municipalities are
flagged `(Mun.)` in the name.

**OpenStreetMap**. `admin_level=8` inside Morocco returns 1,503 relations, of which 1,502
are Moroccan (the extra is Ceuta) and **1,502 carry `ref:MA:HCP`**: the official code, in
dotted form, already tagged. Coverage on those 1,503: centroid 1,503, `name` 1,503,
`name:fr` 1,502, `name:ar` 1,501, `population` 1,497, `wikidata` 1,452, `name:en` 1,017,
`name:es` 276. Tifinagh appears on about a fifth of relations and is not carried into
the dataset: the spellings cannot be checked against an official source, and an
unverifiable name is a guess. The population is mostly 2014 vintage
(1,412 rows) and goes unused, since HCP is authoritative for that.

`admin_level=5` returns 75 provinces, all 75 with `ref:MA:HCP` and `ISO3166-2`.
`admin_level=10` returns 99 relations, of which exactly **41 carry an HCP code**, and those
41 are the arrondissements: Casablanca 16, Fès 6, Rabat 5, Salé 5, Marrakech 5, Tanger 4.
Presence of the code is the filter; the other 58 are douars and quartiers.

### The joins

Normalising both sides to 9 digits (strip non-digits, left-pad with zeros):

| Join | Result |
|---|---|
| HCP 2024 communes ↔ OSM `admin_level=8` | **1,502 / 1,503** |
| HCP 2024 provinces ↔ OSM `admin_level=5` | **75 / 75** |
| HCP 2024 arrondissements ↔ OSM `admin_level=10` | **41 / 41** |
| HCP 2024 ↔ HCP 2014, by code | 1,290 / 1,503 |

Coverage depends on how the relations are found. Querying inside OSM's
`ISO3166-1=MA` area misses Lagouira (`12.066.01.03`), because the Guerguerat zone falls
outside that polygon. Querying by the `ref:MA:HCP` prefix instead finds it, along with
every other commune in its région. The dataset therefore matches on the code prefix, and
treats commune coverage as a reported figure with a floor rather than a fixed count,
since it moves as people map.

### Urban and rural are derivable, and the derivation is proven

Neither file has a type column. The 2024 file encodes it in row order: communes listed
under a province before any `Cercle` heading are municipalities, and communes listed after
a `Cercle` heading belong to it and are rural.

Applying that gives 242 urban and 1,261 rural. Checked against the independent `(Mun.)`
flag in the 2014 file across the 1,290 shared codes, it agrees on **1,290 of 1,290**. The
pipeline asserts this and fails if it ever falls below 100%.

160 communes have an urban centre inside them, from 164 `dont le centre urbain` rows. Three
hold more than one — Ain Chkef has both Ras El Mae and Ain Chkef Al Andalous — so the field
is a list, not a single value. Twelve of the 160 are urban communes rather than rural.

### Two traps in the row structure

Casablanca nests deeper than anywhere else, and it breaks two assumptions a
straightforward parser would make:

```
6141       Préfecture de Casablanca
6141010    Commune de Casablanca
61410100     Préfecture d'arrondissements de Casablanca-Anfa
61410101       Arrondissement d'Anfa
61410103       Arrondissement de Maârif
…            (8 préfectures d'arrondissements, 16 arrondissements)
61410181   Commune de Méchouar de Casablanca      ← a commune, not an arrondissement
```

First, a `Préfecture d'arrondissements` row must not set the current province. It sits
*inside* a commune. Treating it as a province heading mis-parents exactly one record:
Méchouar de Casablanca lands under `61410170` instead of `6141`. One wrong row out of
1,503, which is the kind of error that survives review.

Second, arrondissement parentage can't be inferred from code prefixes. Fès has 6
arrondissements across prefixes `3231010` and `3231011` while Commune de Fès is `3231010`,
so two of its arrondissements don't share their parent's prefix. Parentage comes from the
enclosing `Commune de …` row and is then checked against the codes, never derived from
them.

---

## 2. Sources and licensing

Licences differ per source, so they are kept apart structurally rather than by a note in
the README. Mixing ODbL geometry into the same files as HCP attributes would put the whole
dataset under share-alike.

| Source | Used for | Terms |
|---|---|---|
| HCP RGPH 2024 | codes, FR/AR names, population, households, hierarchy, type | Moroccan government publication, attributed |
| HCP RGPH 2014 | 2014 population, municipality flag | same |
| OpenStreetMap | centroids, polygons, wikidata ids | **ODbL, share-alike** |
| mahdiboughrous | EN and ES names, prior-work credit | MIT |
| zeys | Arabic cross-check only | repo has no licence file; not redistributed |

```
data/v1/
  attributes/   HCP-derived. communes.json|csv, regions, provinces, cercles, arrondissements
  geometry/     OSM-derived. TopoJSON per region. Carries its own ODbL LICENSE
  crosswalk/    2014 ↔ 2024 reconciliation, hand-verified
  names/        EN/ES from mahdiboughrous (MIT)
```

Every record carries a `provenance` object naming the source per field group, so a consumer
can tell which parts of a response are ODbL-encumbered without reading the repo. Three
fields on a commune record come from OpenStreetMap and are therefore ODbL: `centroid`,
`bbox` and `osm`. `provenance.geometry` marks them, the attribute README names them, and
the geometry files carry their own attribution internally as well as a LICENSE beside them.
Nothing else crosses the boundary — in particular no name does.

Explicitly excluded: `cher-cheur/morocco_admin_geography`, which is CC BY-NC.

---

## 3. Data model

Codes are the canonical dotted HCP form. `codeDigits` is the 9-digit join key, and both
are accepted in URLs.

Arrondissements are a separate collection rather than a commune type. They sit inside 6 of
the 1,503 communes and their populations are already counted there, so putting them in the
same collection makes any naive sum double-count Casablanca, Fès, Rabat, Salé, Marrakech
and Tanger. They stay reachable from the parent commune.

```jsonc
// commune
{
  "code": "01.511.05.19",
  "codeDigits": "015110519",
  "slug": "hjar-ennhal",
  "name": { "fr": "…", "ar": "…", "en": "…|null", "es": "…|null" },
  "type": "urban" | "rural",
  "parents": { "region": "01", "province": "01.511", "cercle": "01.511.05" },  // cercle null when urban
  "population": {
    "2024": { "total": 0, "moroccan": 0, "foreign": 0, "households": 0 },
    "2014": { "total": 0, "households": 0 },                                   // null where unreconciled
    "change": { "absolute": 0, "pct": 0.0, "basis": "exact_code|arrondissement_sum|crosswalk" }
  },
  "urbanCentres": [{ "name": "…", "population": 0 }],                          // empty for most; 3 communes hold several
  "centroid": { "lat": 0.0, "lng": 0.0 },                                      // null where OSM holds no boundary
  "bbox": [0,0,0,0],
  "osm": { "relationId": 0, "wikidata": "Q…" },
  "arrondissements": ["06.141.01.05"],
  "provenance": { "name": "hcp-2024", "population.2014": "crosswalk", "geometry": "osm-odbl" }
}
```

Regions, provinces and cercles share that shape minus the parent-specific fields, plus
child counts and the rolled-up populations HCP already publishes for each of them. Provinces carry `iso3166_2` and a `type` of
`province`, `prefecture` or `prefecture_of_arrondissements`, the last covering
Casablanca's 8, which stay in the provinces collection as a filterable type rather than
earning an endpoint for one city. Arrondissements carry their parent commune code and,
where one applies, the `prefecture_of_arrondissements` they belong to.

Cercles are a full level with their own endpoints. They only ever contain rural communes,
which is what makes the type derivation work.

---

## 4. The 2014 to 2024 crosswalk

207 communes don't join on code, because cercles were renumbered between censuses. Ait
Kamra went `01.051.05.01` → `01.051.11.01`: same commune, new code.

Two deterministic passes reconcile all 207. The first pairs a commune with a 2014 unit
whose normalised name is identical and unique within the province, on both sides, which
resolves 203. The second pairs a commune with the only 2014 unit left unclaimed in its
province, which resolves the remaining 4 — French transliteration variants whose Arabic
names agree or differ only by an alef form. Province is the anchor because the province
code is stable across both censuses; only cercle numbering changed.

```jsonc
{
  "code2024": "01.051.11.01",
  "codeDigits2024": "010511101",
  "code2014": "01.051.05.01",
  "name2024": "Ait Kamra",
  "name2014": "Ait Kamra",
  "nameAr2024": "أيت قمرة",
  "nameAr2014": "أيت قمرة",
  "method": "exact_name_in_province",     // or sole_remaining_in_province
  "evidence": {
    "province": "01051",
    "normalisedNameMatch": true,
    "candidatesInProvince": 13,           // how much weight exhaustion is carrying
    "population2024": 8269,
    "population2014": 7685,
    "populationRatio": 1.076
  }
}
```

The reconciliation is one to one: every row pairs exactly one commune with exactly one
2014 unit and nothing is left over on either side. A merge would leave a commune claiming
two 2014 units and a split would leave a 2014 unit unclaimed, so the absence of leftovers
is what shows all 207 to be renames. The build refuses to publish if either side has a
leftover.

Population ratio is corroboration for a reader, never an input to the matching. Households
are not carried across, because attributing a household count to a changed code would be a
guess.

This replaces an earlier design in which a model classified each case as a rename, merge
or split and recorded a confidence per row. That is not what the data needed: the names
did not change when the codes did, so exact matching plus exhaustion settles every case.
A `decision.by: "human"` field would have been false and a confidence score derived from
an exact string comparison would have been invented. What ships instead is the evidence
itself, so a reader can audit any row from the published CSV.

## 5. Pipeline

Runs offline, commits its output. Nothing in it executes at request time.

1. **fetch.** HCP 2024 and 2014 xlsx, the Geofabrik Morocco extract, the mahdiboughrous
   and zeys repos. Everything is checksummed and cached; a changed checksum fails the build
   rather than silently altering the dataset.
2. **parse.** Read the xlsx straight from its zip with the standard library, track
   the current région / province / cercle / commune while walking rows, and derive `type`
   from whether a Cercle heading has been seen. A `Préfecture d'arrondissements` heading
   updates neither the province nor the cercle, and arrondissements attach to the commune
   row that encloses them.
3. **geometry.** Fetch `admin_level=8` relations from Overpass one région at a time,
   selecting by a `ref:MA:HCP` prefix rather than by an area, and cache each response.
   Stitch the returned way fragments into closed rings. Compute a representative interior
   point rather than a bbox centre, so centroids of concave or coastal communes land
   inside them. Quantise to TopoJSON, split per région.
4. **join.** Normalise codes to 9 digits and join HCP to OSM. Attach the crosswalk.
   Layer EN/ES names from mahdiboughrous.
5. **validate.** The assertions below.
6. **emit.** Versioned JSON and CSV under `data/v1/`, plus the pre-rendered API responses.

Overpass cannot serve all 1,503 geometries in one query, but twelve regional queries work,
and the responses cache so a rebuild never touches the network. The public mirrors do
rate-limit: getting all twelve took retries across four endpoints, one région needing six
attempts. Rotating mirrors with backoff handled it and no `osmium` or Geofabrik extract was
needed, which also means the pipeline installs nothing outside pnpm.

Simplification is not applied. At quantisation 1e5 the per-région files come to 60-270 KB,
far inside Cloudflare's 25 MiB per-asset limit, so there is nothing to buy by discarding
detail.

### Build-time assertions

The build fails on any of these:

- exactly 12 régions, 75 provinces and préfectures, 8 préfectures d'arrondissements,
  213 cercles, 1,503 communes, 41 arrondissements
- commune populations sum to 36,828,330
- every commune resolves to a région and a province, and every province code is 5 digits,
  the check that catches the Méchouar mis-parenting
- rural communes resolve to a cercle; urban communes have none
- every arrondissement resolves to one of the 6 communes that have them
- urban/rural derivation agrees with the 2014 `(Mun.)` flag on 100% of shared codes
- every commune without a centroid is on a committed allowlist of codes OSM holds no
  boundary for, so coverage may rise freely but a newly unmapped commune fails the build
- arrondissements distribute 16/6/5/5/5/4 across the six cities
- no duplicate codes or slugs at any level
- every `ref:MA:HCP` in the OSM extract matches a known HCP code

---

## 6. API

Three tiers, split by what a path-keyed asset store can and cannot match.

This section originally had two tiers and listed `/api/communes?province=` among the
routes "served from Cloudflare's CDN without invoking the Worker". That was wrong. An
asset store is a manifest keyed by path, and nothing in it consumes a query string, so
`?province=01.511` and `?province=05.061` address the same path and can only resolve to
the same file. The free tier has to be path-addressed.

**Pre-rendered.** 3,852 files written at build time and served from the asset store
without invoking Worker code, which makes them free and unmetered:

```
/api/version.json
/api/regions.json                       /api/regions/:code.json
/api/regions/:code/provinces.json       /api/regions/:code/communes/page/:n.json
/api/provinces.json                     /api/provinces/:code.json
/api/provinces/:code/cercles.json       /api/provinces/:code/communes/page/:n.json
/api/cercles.json                       /api/cercles/:code.json
/api/cercles/:code/communes/page/:n.json
/api/communes/page/:n.json              /api/communes/type/:type/page/:n.json
/api/communes/:code.json                /api/communes/:code/arrondissements.json
/api/arrondissements.json               /api/arrondissements/:code.json
/data/v1/**
```

Empty lists are emitted rather than left out, so the 8 préfectures d'arrondissements with
no communes, the 14 provinces with no cercles and the 1,497 communes with no
arrondissements answer from the free tier instead of a 404 from a metered one.

`?type=` is pre-rendered as 31 files because it is the one single-key filter that spans
the whole country: narrowing to it would have cost 31 subrequests.

**Alias.** The query-string and extensionless shapes from the brief. The Worker rewrites
a single filter to the pre-rendered file that already holds the answer and names it in
`Content-Location`, so a client can move itself onto the free tier. Identifiers resolve
from the dotted code, the padded digits, the digits with leading zeros lost, or the slug.

**Computed.** The answers no file holds:

```
/api/search?q=&levels=&limit=
/api/communes/near?lat=&lng=&radius=&limit=
/api/communes?<more than one filter>
```

A combination narrows to the smallest pre-rendered list and filters it, which is bounded:
one page for a cercle, two for the largest province, six for the largest région.

Search normalises Arabic (the alef variants, ta-marbuta and alef maqsura that 356, 367 and
42 names carry; the tatweel and harakat that none carry but people type) and French
accents, then queries a trigram index. The postings walk both selects the candidates and
counts each one's shared trigrams, so scoring re-derives nothing — the difference between
a common query costing 27 ms and 0.04 ms against a 10 ms budget. `near` is a haversine
sweep over 1,502 centroids behind a latitude band.

Transliteration variants are handled by trigram overlap, not substitution rules. Measured
over 31 alternate spellings, 29 retrieve in the top 10 and 27 rank first, so rules for
ou/u and ch/sh would earn nothing. The two misses are exonyms — `Fez`, `Alhucemas` — which
no character rule reaches and only an alias list would.

Responses are enveloped with `data`, `meta` and `links`. Errors are RFC 9457 problem
details, with a well-formed absent identifier as 404 and an unsearchable one as 400. CORS
is open, because other people are meant to use it.

---

## 7. Web app

Astro on Cloudflare Workers, with Solid islands, and the Hono Worker handling the metered
routes.

This section originally had Astro's `getStaticPaths` pre-render the API tier. It does not.
The API surface is 3,852 JSON files with no templating, no components and no markdown, so
routing it through Astro would make the API unbuildable and untestable without the web app
for no rendering benefit. The pipeline emits the tree; the docs site mounts it alongside
its own output. That split is also why the API shipped as working software before any of
the site existed.

EN, FR and Moroccan Darija through Astro's i18n routing. The brief asked for Arabic
script and the site was built with it, RTL and a naskh face included; Ousama dropped it
once he saw it, so the locale and the RTL rules came out rather than staying as machinery
nothing triggers. Darija went in afterwards in Latin letters, which is how Moroccans write
it, keeping the technical vocabulary in English. The Arabic names are still in the data
and Arabic queries still work — it is the interface that is Latin script, not the dataset.

The playground runs live queries against the real endpoints and shows the request URL, so
it doubles as documentation. The hero is the 1,502 boundaries from `data/v1/geometry`,
simplified at build time: the dataset drawing itself rather than an illustration of it.

---

## 8. Deployment and cost

Cloudflare Workers free plan. Verified limits:

- 100,000 Worker requests/day, 10 ms CPU per request
- **1 s** CPU for the global scope, which is a separate budget from the per-request 10 ms
- Worker bundle up to 64 MiB uncompressed, no compressed-size limit
- Static assets: 20,000 files per version, 25 MiB per file
- *"Requests to static assets are free and unlimited"*, and a matching asset is served
  without invoking Worker code

Measured against these: the Worker bundle is 706 KiB, `dist/` is 3,878 files, and the
largest file is the 1.6 MB committed `communes.json`.

The two budgets are what shape the design. The 426 KB search index is read at module
scope, where parsing it costs about 3 ms of the 1 s startup allowance; doing the same work
inside a handler would spend a third of that request's entire 10 ms before any searching
began. Per-request work is a postings lookup and a bounded scan, measured under 1 ms.

Only the alias and computed tiers spend the 100k/day. Under a spike, search degrades and
every canonical lookup and download keeps working.

Total cost: nothing. Workers free, `workers.dev` subdomain free, Overpass free, GitHub
free, and no dependency outside pnpm.

---

## 9. Versioning

The dataset versions independently of the API, as `data/v1/`. Major for a breaking schema
change, minor for added fields, patch for corrections. `DATASET_VERSION` in
`pipeline/src/sources/registry.ts` holds it, and every enveloped response carries it as
`meta.datasetVersion`.

`data/v1/sources.json` records what a build read: each workbook's URL, licence, sha256 and
retrieval date, and the OSM snapshot. The OSM vintage is a range, because the boundaries
come from twelve Overpass queries that rate-limiting spreads over an hour or more, so the
twelve régions are snapshots taken at different moments rather than one consistent
extract. A build that cannot account for a source refuses to publish.

`/api/version.json` reports that document alongside the record count per level.

Corrections are commits against the dataset, with the assertions in section 5 as the
regression suite.

---

## 10. Out of scope for v1

Localities and douars (HCP publishes them separately and they'd multiply the record count).
Postal codes. Election districts. Historical divisions before the 2015 reform. Vector
tiles: the geometry ships as one TopoJSON file per région, which a browser must fetch
whole, and a tiled service would be the way to serve a single boundary cheaply.
