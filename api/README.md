# API reference

Every response is JSON, enveloped as:

```json
{
  "data": [],
  "meta": { "datasetVersion": "1.0.0", "page": 1, "perPage": 50, "total": 0, "totalPages": 1 },
  "links": { "self": "...", "prev": null, "next": null }
}
```

`prev` and `next` are always present, `null` at the ends. `page`, `perPage`, `total` and
`totalPages` appear on lists that paginate, which is the commune lists and nothing else —
83 provinces and 213 cercles ship whole.

## The three tiers

`X-Api-Tier` on every response says which one answered.

| Tier | Header | What it is |
|---|---|---|
| pre-rendered | *absent* | a file, served by Cloudflare's asset store without running any code |
| alias | `alias` | the Worker rewrote the request to a pre-rendered file |
| computed | `computed` | the Worker worked out the answer |

The header is absent on the pre-rendered tier because the Worker is never invoked, which
is exactly the property that makes it free. An alias response carries `Content-Location`
naming the file it came from; fetch that URL directly and you stop touching the Worker.

## Pre-rendered

```
GET /api/version.json
GET /api/regions.json
GET /api/regions/:code.json
GET /api/regions/:code/provinces.json
GET /api/regions/:code/communes/page/:n.json
GET /api/provinces.json
GET /api/provinces/:code.json
GET /api/provinces/:code/cercles.json
GET /api/provinces/:code/communes/page/:n.json
GET /api/cercles.json
GET /api/cercles/:code.json
GET /api/cercles/:code/communes/page/:n.json
GET /api/communes/page/:n.json
GET /api/communes/type/:urban|rural/page/:n.json
GET /api/communes/:code.json
GET /api/communes/:code/arrondissements.json
GET /api/arrondissements.json
GET /api/arrondissements/:code.json
GET /data/v1/**
```

`:code` is the canonical dotted form: `01` for a région, `01.511` for a province,
`01.511.05` for a cercle, `01.511.01.0` for a commune, `01.511.01.05` for an
arrondissement.

A unit that has no children still has a list. The 8 préfectures d'arrondissements have no
communes of their own and the 14 provinces without cercles have no cercles, and all of
them answer with an empty `data` and `totalPages: 1` rather than a 404.

## Alias

A query string cannot select a file — an asset store is a manifest keyed by path — so
these shapes go through the Worker, which resolves them to the file that already holds
the answer:

| Request | Resolves to |
|---|---|
| `/api/communes?province=01.511&page=1` | `/api/provinces/01.511/communes/page/1.json` |
| `/api/communes?cercle=01.511.05` | `/api/cercles/01.511.05/communes/page/1.json` |
| `/api/communes?region=01&page=2` | `/api/regions/01/communes/page/2.json` |
| `/api/communes?type=urban` | `/api/communes/type/urban/page/1.json` |
| `/api/communes/01.511.01.0` | `/api/communes/01.511.01.0.json` |
| `/api/regions` | `/api/regions.json` |

Identifiers are accepted in four spellings, all resolving to one unit:

```
/api/communes/01.511.01.0      canonical dotted code
/api/communes/001511010        zero-padded digits
/api/communes/1511010          digits as a spreadsheet leaves them, zeros lost
/api/communes/tanger           slug
```

## Computed

### `GET /api/search`

| Parameter | Default | Notes |
|---|---|---|
| `q` | required | French, Arabic or a slug |
| `levels` | all | comma-separated: `commune`, `arrondissement`, `province`, `region`, `cercle` |
| `limit` | 10 | 1 to 50 |

```json
{ "code": "01.511.01.0", "level": "commune", "name": { "fr": "Tanger", "ar": "طنجة" },
  "slug": "tanger", "score": 1000, "matched": "exact" }
```

`matched` is `exact`, `alias`, `prefix` or `trigram`. Ranking puts an exact match first,
then an exonym, then the shortest prefix match, then trigram overlap; a tie breaks on the
administrative level so a commune outranks the cercle of the same name, and then on the
code, so two identical queries always rank identically.

The normaliser folds the Arabic alef variants, ta-marbuta and alef maqsura that the names
carry, and the tatweel and vowel marks that none of them carry but people type. French
accents fold too. Transliteration variants are found by trigram overlap rather than by
substitution rules: `Shefshaouen` reaches Chefchaouen, `Ayt Qamra` reaches Ait Kamra. What
this cannot reach is a name built from different letters altogether: `Fez` shares no
useful trigram with `Fès`, and `Mogador` shares none with `Essaouira`. Those come from a
list of 17 exonyms and pre-1956 administrative names in `api/src/lib/exonyms.ts`, each
carrying where the name comes from and each checked against the dataset when the index is
built. An entry pointing at a code no unit has, or naming something that is already a real
name, fails the build — `Anfa` is both Casablanca's historical name and one of its
arrondissements, and the arrondissement keeps it.

### `GET /api/communes/near`

| Parameter | Default | Notes |
|---|---|---|
| `lat` | required | -90 to 90 |
| `lng` | required | -180 to 180 |
| `radius` | 10 | km, up to 100 |
| `limit` | 10 | 1 to 50 |

Distances are haversine against commune centroids, nearest first. The centroid is a
pole of inaccessibility, not a mean of vertices, so it falls inside the commune.
Sidi Mohamed Benmansour has no centroid and can never be returned.

### Filter combinations

`/api/communes` with more than one of `region`, `province`, `cercle`, `type` is computed:
the Worker narrows to the smallest pre-rendered list and filters it. Bounded by design —
a cercle is one page, a province at most two, a région at most six.

## Errors

RFC 9457 problem documents, as `application/problem+json`:

```json
{ "type": ".../problems/not-found", "title": "Resource not found", "status": 404,
  "detail": "no unit has code 99.999.99.99", "instance": "/api/communes/99.999.99.99" }
```

| `type` | Status | Means |
|---|---|---|
| `not-found` | 404 | a well-formed identifier that names nothing |
| `invalid-code` | 400 | not an identifier at all |
| `invalid-query` | 400 | a missing or out-of-range parameter |

A 404 and a 400 are worth telling apart: a 404 means retrying with a different spelling
will not help.

## Deploying

Needs a Cloudflare account. The free plan covers all of this — 100,000 Worker requests a
day, and requests to static assets are free and unlimited.

```sh
pnpm exec wrangler login                        # once
SITE_URL=https://<your-deployment> pnpm build   # the site, then the API tree
pnpm exec wrangler deploy
pnpm api:smoke https://<your-deployment>
```

`SITE_URL` is what makes link previews work. LinkedIn, X and Slack need an absolute URL
for the preview image and the canonical link, and the hostname only exists once the
Worker is deployed — so the first deploy is built without it, and the second, with the
hostname known, is built with it. Without it the pages build fine and those tags are
simply left out.

`site/public/og.png` is the preview image. It is committed rather than built, because
rendering it needs Chrome; regenerate it with `pnpm site:og` when the map or the headline
changes.

`wrangler deploy --dry-run` checks the bundle without an account. The Worker is 706 KiB
uncompressed against a 64 MiB limit, and `dist/` is 3,878 files against a 20,000 limit.
Wrangler's own count reads higher because it includes directories.

`PROBLEM_BASE` in `api/src/lib/envelope.ts` holds the `type` URI prefix for problem
documents; point it at the real hostname once there is one.

## Two things the runtime decides, not the docs

Both were measured against `wrangler dev`, and `pnpm api:smoke` re-checks them:

- The asset store serves a file with a dotted basename like `01.511.01.0.json` as
  `application/json`, which is why the pre-rendered files carry a `.json` suffix.
- `_headers` does not apply to Worker responses, so the Worker sets CORS itself. It does
  override `Content-Type`, which is how the `.topojson` files get one — the asset store
  does not know the extension and serves them with no type at all.
