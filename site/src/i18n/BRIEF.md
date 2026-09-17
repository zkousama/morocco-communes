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

## How to reply

Reply with **one JSON object and nothing else** — no commentary, no markdown fence.
Use exactly the keys given below, all 59 of them. Escape quotes properly.

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

**`levels.region`** — The largest administrative tier. Morocco has 12.

> région

**`levels.province`** — The tier below a région. Called a province or a préfecture.

> préfecture

**`levels.cercle`** — An intermediate tier that sits above rural communes only.

> cercle

**`levels.commune`** — The tier this whole project is about.

> commune

**`levels.arrondissement`** — A district inside one of the six largest cities.

> arrondissement

### Interface

**`ui.title`** — The wordmark, top left of every page. Two to four words.

> Morocco communes

**`ui.language`** — Accessible label for the language switcher. One or two words.

> Language

**`ui.tagline`** — The headline, set large in a serif. Keep it short and declarative.

> Morocco’s 1,503 communes, as open data.

**`ui.intro`** — The paragraph under the headline.

> Official HCP codes, names in French and Arabic, population from the 2024 and 2014 censuses, and a boundary for every commune but one. Free to use, and free to run.

**`ui.mapCaption`** — Caption under the map of Morocco.

> All 1,502 boundaries, drawn from the files this API serves.

**`ui.mapSource`** — Source line under the map. Leave this one exactly as it is.

> data/v1/geometry · OpenStreetMap, ODbL

**`ui.codeHeading`** — Section heading.

> How a code reads

**`ui.codeBody`** — Explains that the geographic code encodes the administrative hierarchy.

> The code is the hierarchy. Each group of digits names one level, so a commune’s code already contains its province and its région. Cercles sit above rural communes only; an urban commune may hold arrondissements instead.

**`ui.colPopulation`** — Table column header.

> Population, 2024

**`ui.tryHeading`** — Section heading, above the live query panel.

> Run a query

**`ui.tryBody`** — One line under that heading.

> Every request below goes to this API and comes back unedited.

**`ui.tiersHeading`** — Section heading.

> Where a request is answered

**`ui.tiersBody`** — Explains that a request is answered in one of three places.

> Three places, and the X-Api-Tier header on every response says which one. Most requests never reach any code at all.

**`ui.tierPreHeader`** — Shown where the other two show a literal header value. Means: no header at all, because no code ran.

> no header, because nothing ran

**`ui.tierPre`** — Name of the first tier: a static file on a CDN.

> A file on the CDN

**`ui.tierPreBody`** — What that tier is.

> 3,852 responses are written when the site is built. Nothing runs to serve them, so they cost nothing and hold up under any amount of traffic.

**`ui.tierAlias`** — Name of the second tier: the Worker rewrites the request to a static file.

> A rewrite to that file

**`ui.tierAliasBody`** — What that tier is.

> A query string cannot pick a file, so requests written that way are resolved to the file that already holds the answer, and the response names it.

**`ui.tierComputed`** — Name of the third tier: the Worker computes the answer.

> Worked out on the spot

**`ui.tierComputedBody`** — What that tier is.

> Search, radius queries, and filter combinations no single file covers. These are the only requests that spend anything.

**`ui.dataHeading`** — Section heading, above the download links.

> Take the whole thing

**`ui.dataBody`** — Explains that the dataset is downloadable and that licences differ by folder.

> The dataset is versioned in the repository, so it can be used without this API at all. Licences differ by directory: the attributes come from the census, and the boundaries are share-alike.

**`ui.searchTab`** — Tab label. One word.

> Search

**`ui.searchHint`** — Explains what the search accepts.

> French, Arabic, or a slug. Accents, the alef variants and ta-marbuta all fold, and places are findable by the other names they go by — Fez finds Fès, Port Lyautey finds Kénitra.

**`ui.nearTab`** — Tab label. One word.

> Nearby

**`ui.nearHint`** — Explains the radius query.

> Communes within a radius of a point, nearest first.

**`ui.lookupTab`** — Tab label. One word.

> Lookup

**`ui.lookupHint`** — Explains looking one commune up by code or slug.

> One commune by code or slug. All four ways of writing it reach the same record.

**`ui.fieldQuery`** — Form field label. Two or three words.

> Search for

**`ui.fieldRadius`** — Form field label.

> Radius in km

**`ui.fieldIdentifier`** — Form field label.

> Code or slug

**`ui.run`** — Button that sends the request. One word, a verb.

> Run

**`ui.running`** — What that button says while waiting. One word.

> Running

**`ui.request`** — Small label before the request URL.

> Request

**`ui.tier`** — Small label before the status and tier of the response.

> Answered by

**`ui.emptyState`** — Shown in the response area before anything has been run. It should invite an action.

> Pick an example or type a query, then run it.

**`ui.failed`** — Shown when the request did not complete. Say what to do, do not apologise.

> That request did not complete. Check the API is running, then try again.

**`ui.theme`** — Accessible label for the light/dark switcher. One word.

> Theme

**`ui.themeAuto`** — Button in a three-way switch. One short word.

> Auto

**`ui.themeLight`** — Button in a three-way switch. One short word.

> Light

**`ui.themeDark`** — Button in a three-way switch. One short word.

> Dark

**`ui.chartsHeading`** — Section heading, above three charts.

> What the numbers show

**`ui.chartsBody`** — One line under that heading.

> Three things worth knowing before you build on this, each drawn from the dataset rather than written down beside it.

**`ui.chartChange`** — Chart title. Short and declarative, it states the finding.

> The south is filling up

**`ui.chartChangeBody`** — One line saying what the chart plots.

> Population change by région between the 2014 and 2024 censuses.

**`ui.chartChangeNote`** — Note under the chart.

> Dakhla-Oued Ed-Dahab grew by more than half. The Oriental is the only région that shrank. Both figures are sums over the communes in each, not a separate régional series.

**`ui.chartSize`** — Chart title. Short and declarative.

> Most communes are small

**`ui.chartSizeBody`** — One line saying what the chart plots.

> Communes by 2024 population.

**`ui.chartSpread`** — Chart title.

> Whether the crosswalk holds up

**`ui.chartSpreadBody`** — Explains why the chart exists.

> 207 communes were renumbered by the 2015 reform, so their 2014 population had to be matched by name and elimination rather than read off an unchanged code. If those matches were wrong, their implied growth would scatter differently.

**`ui.chartSpreadNote`** — Note under the chart, explaining how to read a box plot and what it shows.

> Bar spans the 10th to 90th percentile, block the 25th to 75th, line the median. The two distributions sit almost on top of each other, which is the evidence that the matching is sound — it is not proof, and the per-pair reasoning is in data/v1/crosswalk.

**`ui.footerData`** — Footer credit line.

> Codes and population from the Haut-Commissariat au Plan, RGPH 2024 and RGPH 2014.

**`ui.footerGeometry`** — Footer credit line.

> Boundaries from OpenStreetMap contributors, under the Open Database Licence.

**`ui.repo`** — Link label to the source repository. One or two words.

> Source
