# Darija translation brief

Translate the strings at the bottom of this file into Moroccan Darija.

## What the site is

An open dataset and HTTP API for Morocco's administrative divisions — 12 régions, 83
provinces and préfectures, 213 cercles, 1,503 communes and 41 arrondissements — built
from the HCP census and OpenStreetMap boundaries. The audience is developers who need
Moroccan commune data. The tone is plain and factual: it explains what the data is,
where it came from, and how to fetch it. It never sells.

## Rules

1. **Latin letters only.** No Arabic script, and no digit substitutions — write `hdod`
   and `alach`, not `7dod` and `3lach`. Be consistent across every string.
2. **Keep the technical vocabulary in English.** These words stay exactly as written:

   `API`, `HTTP`, `CDN`, `JSON`, `CSV`, `URL`, `slug`, `header`, `query`, `request`, `response`, `endpoint`
   `open data`, `dataset`, `file`, `cache`, `Worker`, `X-Api-Tier`, `data/v1/geometry`, `data/v1/crosswalk`, `HCP`, `RGPH`
   `ODbL`, `OpenStreetMap`, `Open Database Licence`, `Haut-Commissariat au Plan`, `Fez`, `Fès`, `Port Lyautey`, `Kénitra`, `Dakhla-Oued Ed-Dahab`, `Oriental`

3. **Never translate a proper noun**: place names, organisation names, licence names.
4. **Keep every number exactly as it is**, in digits, with the same value.
5. **Keep the length close to the English.** These sit in a fixed layout; a label that
   doubles in length breaks it. Headings and button labels especially.
6. **Sentence case**, not title case. No exclamation marks.
7. Where the English is a heading of two or three words, so is the Darija.

### Settled usage

These were corrected by a native speaker. Follow them exactly.

- **No article** on these borrowed words, ever: `request`, `slug`, `response`, `repo`,
  `dataset`, `site`. Write `had request`, never `had l-request`.
- **Take `l-`** when definite: `API`, `file`, `code`, `crosswalk`, `query`, `header`,
  `folder`, `filters`, `match`. Definiteness still decides: `ykhtar file` is picking
  *a* file, so it stays bare; `l-file li fih l-jawab` is *the* file, so it takes it.
- Spell the preposition *from* as `mn`, never `men`.
- Say `Codes`, not `Rmooz`.
- `record` stays in English.
- `iqlim` is a province and `amala` is a préfecture. They are different things.

## How to reply

Reply with **one JSON object and nothing else** — no commentary, no markdown fence.
Use exactly the keys given below, all 30 of them. Escape quotes properly.

```
{
  "levels.region": "...",
  "levels.province": "...",
  "ui.title": "...",
  "ui.tagline": "..."
}
```

## The strings

### Administrative tiers

These five are single words that appear as labels under numbers and beside names.

### Interface

**`ui.spreadUnchanged`** — Row label in the box plot. The communes whose code never changed.

> Code unchanged since 2014

**`ui.spreadCrosswalk`** — Row label in the box plot. The communes the crosswalk had to match.

> Renumbered, matched by the crosswalk

**`ui.srSpread`** — Read aloud by a screen reader for one row of the box plot. Keep every {placeholder} exactly.

> median {median}, middle half {p25} to {p75}, 10th to 90th percentile {p10} to {p90}

**`ui.refHeading`** — Section heading above the parameter tables.

> Parameters

**`ui.refBody`** — One or two lines under that heading. Keep data, meta, links and RFC 9457 as written.

> The routes that take a query string, with their defaults and limits. Every response is wrapped as data, meta and links, and an error comes back as an RFC 9457 problem document.

**`ui.refParam`** — Table column header.

> Parameter

**`ui.refDefault`** — Table column header: the value used when a parameter is left out.

> Default

**`ui.refRequired`** — Shown in the default column for a parameter that must be given. One word.

> required

**`ui.refAll`** — Shown in the default column when every level is included. One word.

> all

**`ui.pQ`** — Describes the search text parameter.

> Text to find, in French, Arabic or as a slug

**`ui.pLevels`** — Describes a parameter listing which levels to include.

> Levels to include, separated by commas

**`ui.pLimit`** — Describes the result count. Keep {max} exactly: the number is filled in.

> How many results, up to {max}

**`ui.pLat`** — Describes the latitude parameter.

> Latitude of the point

**`ui.pLng`** — Describes the longitude parameter.

> Longitude of the point

**`ui.pRadius`** — Describes the search radius. Keep {max} exactly: the number is filled in.

> Distance in km, up to {max}

**`ui.pUnit`** — Describes filtering by région, province or cercle.

> A région, province or cercle, by code or slug

**`ui.pType`** — Describes the type filter. Keep urban and rural as written: they are the values.

> urban or rural

**`ui.pPage`** — Describes the page parameter. Keep {per} exactly: the number is filled in.

> Page number, {per} communes to a page

**`ui.pCommunesQ`** — Describes a search limited to communes.

> Searches communes only

**`ui.dlCommunes`** — Row label in the download list: the communes file.

> Communes

**`ui.dlRegions`** — Row label in the download list.

> Régions

**`ui.dlProvinces`** — Row label in the download list. Both kinds of unit at that tier.

> Provinces and préfectures

**`ui.dlCercles`** — Row label in the download list.

> Cercles

**`ui.dlArrondissements`** — Row label in the download list.

> Arrondissements

**`ui.dlBoundaries`** — Row label above 12 links, one boundary file per région.

> Boundaries, one file per région

**`ui.dlCrosswalk`** — Row label for the file matching 2014 communes to 2024 ones.

> 2014 to 2024 crosswalk

**`ui.dlSources`** — Row label for the file recording where each source came from and when.

> Sources and their vintages

**`ui.notFoundTitle`** — Heading of the page shown for an address that does not exist.

> No page here

**`ui.notFoundBody`** — One line on that page. Keep /api/ exactly as written.

> Nothing lives at this address. If you were after the API, its routes start with /api/.

**`ui.notFoundHome`** — Link back to the home page. A short action.

> Go to the home page
