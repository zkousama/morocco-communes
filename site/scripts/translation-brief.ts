/**
 * Writes a translation brief for one locale, taken from the English strings in
 * site/src/i18n/ui.ts so the brief cannot drift from what the site actually renders.
 *
 *   pnpm site:brief            -> site/src/i18n/BRIEF.md
 *
 * The reply comes back as JSON and goes in through site/scripts/apply-translation.ts.
 */
import { writeFile } from "node:fs/promises";
import { LEVELS, ui } from "../src/i18n/ui.ts";

/** Where a string appears, and anything that constrains how it can be written. */
const NOTES: Record<string, string> = {
  title: "The wordmark, top left of every page. Two to four words.",
  language: "Accessible label for the language switcher. One or two words.",
  theme: "Accessible label for the light/dark switcher. One word.",
  themeAuto: "Button in a three-way switch. One short word.",
  themeLight: "Button in a three-way switch. One short word.",
  themeDark: "Button in a three-way switch. One short word.",
  tagline: "The headline, set large in a serif. Keep it short and declarative.",
  intro: "The paragraph under the headline.",
  mapCaption: "Caption under the map of Morocco.",
  mapSource: "Source line under the map. Leave this one exactly as it is.",
  codeHeading: "Section heading.",
  codeBody: "Explains that the geographic code encodes the administrative hierarchy.",
  colPopulation: "Table column header.",
  tryHeading: "Section heading, above the live query panel.",
  tryBody: "One line under that heading.",
  tiersHeading: "Section heading.",
  tiersBody: "Explains that a request is answered in one of three places.",
  tierPreHeader: "Shown where the other two show a literal header value. Means: no header at all, because no code ran.",
  tierPre: "Name of the first tier: a static file on a CDN.",
  tierPreBody: "What that tier is.",
  tierAlias: "Name of the second tier: the Worker rewrites the request to a static file.",
  tierAliasBody: "What that tier is.",
  tierComputed: "Name of the third tier: the Worker computes the answer.",
  tierComputedBody: "What that tier is.",
  dataHeading: "Section heading, above the download links.",
  dataBody: "Explains that the dataset is downloadable and that licences differ by folder.",
  searchTab: "Tab label. One word.",
  searchHint: "Explains what the search accepts.",
  nearTab: "Tab label. One word.",
  nearHint: "Explains the radius query.",
  lookupTab: "Tab label. One word.",
  lookupHint: "Explains looking one commune up by code or slug.",
  fieldQuery: "Form field label. Two or three words.",
  fieldRadius: "Form field label.",
  fieldIdentifier: "Form field label.",
  run: "Button that sends the request. One word, a verb.",
  running: "What that button says while waiting. One word.",
  request: "Small label before the request URL.",
  tier: "Small label before the status and tier of the response.",
  emptyState: "Shown in the response area before anything has been run. It should invite an action.",
  failed: "Shown when the request did not complete. Say what to do, do not apologise.",
  chartsHeading: "Section heading, above three charts.",
  chartsBody: "One line under that heading.",
  chartChange: "Chart title. Short and declarative, it states the finding.",
  chartChangeBody: "One line saying what the chart plots.",
  chartChangeNote: "Note under the chart.",
  chartSize: "Chart title. Short and declarative.",
  chartSizeBody: "One line saying what the chart plots.",
  chartSpread: "Chart title.",
  chartSpreadBody: "Explains why the chart exists.",
  spreadUnchanged: "Row label in the box plot. The communes whose code never changed.",
  spreadCrosswalk: "Row label in the box plot. The communes the crosswalk had to match.",
  chartSpreadNote: "Note under the chart, explaining how to read a box plot and what it shows.",
  notFoundTitle: "Heading of the page shown for an address that does not exist.",
  notFoundBody: "One line on that page. Keep /api/ exactly as written.",
  notFoundHome: "Link back to the home page. A short action.",
  dlCommunes: "Row label in the download list: the communes file.",
  dlRegions: "Row label in the download list.",
  dlProvinces: "Row label in the download list. Both kinds of unit at that tier.",
  dlCercles: "Row label in the download list.",
  dlArrondissements: "Row label in the download list.",
  dlBoundaries: "Row label above 12 links, one boundary file per région.",
  dlCrosswalk: "Row label for the file matching 2014 communes to 2024 ones.",
  dlSources: "Row label for the file recording where each source came from and when.",
  refHeading: "Section heading above the parameter tables.",
  refBody: "One or two lines under that heading. Keep data, meta, links and RFC 9457 as written.",
  refParam: "Table column header.",
  refDefault: "Table column header: the value used when a parameter is left out.",
  refRequired: "Shown in the default column for a parameter that must be given. One word.",
  refAll: "Shown in the default column when every level is included. One word.",
  pQ: "Describes the search text parameter.",
  pLevels: "Describes a parameter listing which levels to include.",
  pLimit: "Describes the result count. Keep {max} exactly: the number is filled in.",
  pLat: "Describes the latitude parameter.",
  pLng: "Describes the longitude parameter.",
  pRadius: "Describes the search radius. Keep {max} exactly: the number is filled in.",
  pUnit: "Describes filtering by région, province or cercle.",
  pType: "Describes the type filter. Keep urban and rural as written: they are the values.",
  pPage: "Describes the page parameter. Keep {per} exactly: the number is filled in.",
  pCommunesQ: "Describes a search limited to communes.",
  srSpread: "Read aloud by a screen reader for one row of the box plot. Keep every {placeholder} exactly.",
  footerData: "Footer credit line.",
  footerGeometry: "Footer credit line.",
  repo: "Link label to the source repository. One or two words.",
};

const LEVEL_NOTES: Record<string, string> = {
  region: "The largest administrative tier. Morocco has 12.",
  province: "The tier below a région, as a generic name. 62 of the 83 are provinces.",
  prefecture: "The same tier when the unit is specifically a préfecture. 13 of the 83 are.",
  cercle: "An intermediate tier that sits above rural communes only.",
  commune: "The tier this whole project is about.",
  arrondissement: "A district inside one of the six largest cities.",
};

const KEEP = [
  "API", "HTTP", "CDN", "JSON", "CSV", "URL", "slug", "header", "query", "request",
  "response", "endpoint", "open data", "dataset", "file", "cache", "Worker",
  "X-Api-Tier", "data/v1/geometry", "data/v1/crosswalk", "HCP", "RGPH", "ODbL",
  "OpenStreetMap", "Open Database Licence", "Haut-Commissariat au Plan",
  "Fez", "Fès", "Port Lyautey", "Kénitra", "Dakhla-Oued Ed-Dahab", "Oriental",
];

/**
 * --keys=ui.a,ui.b limits the brief to those strings, for a pass over new ones that must
 * not re-translate the ones already corrected by hand. Without it, every string is in.
 */
const only = process.argv.find((a) => a.startsWith("--keys="))?.slice("--keys=".length).split(",").filter(Boolean);
const wanted = (key: string) => !only || only.includes(key);
const levelKeys = Object.keys(LEVELS.en).filter((k) => wanted(`levels.${k}`));
const uiKeys = Object.keys(ui.en).filter((k) => wanted(`ui.${k}`));
const total = levelKeys.length + uiKeys.length;
const exists = (key: string) =>
  (key.startsWith("ui.") && key.slice("ui.".length) in ui.en) ||
  (key.startsWith("levels.") && key.slice("levels.".length) in LEVELS.en);
const unknown = (only ?? []).filter((key) => !exists(key));
if (unknown.length > 0) throw new Error(`no such key: ${unknown.join(", ")}`);

const lines: string[] = [];
const w = (s = "") => lines.push(s);

w("# Darija translation brief");
w();
w("Translate the strings at the bottom of this file into Moroccan Darija.");
w();
w("## What the site is");
w();
w(
  "An open dataset and HTTP API for Morocco's administrative divisions — 12 régions, 83",
);
w(
  "provinces and préfectures, 213 cercles, 1,503 communes and 41 arrondissements — built",
);
w("from the HCP census and OpenStreetMap boundaries. The audience is developers who need");
w("Moroccan commune data. The tone is plain and factual: it explains what the data is,");
w("where it came from, and how to fetch it. It never sells.");
w();
w("## Rules");
w();
w("1. **Latin letters only.** No Arabic script, and no digit substitutions — write `hdod`");
w("   and `alach`, not `7dod` and `3lach`. Be consistent across every string.");
w("2. **Keep the technical vocabulary in English.** These words stay exactly as written:");
w();
for (const group of [KEEP.slice(0, 12), KEEP.slice(12, 22), KEEP.slice(22)]) {
  w(`   ${group.map((k) => `\`${k}\``).join(", ")}`);
}
w();
w("3. **Never translate a proper noun**: place names, organisation names, licence names.");
w("4. **Keep every number exactly as it is**, in digits, with the same value.");
w("5. **Keep the length close to the English.** These sit in a fixed layout; a label that");
w("   doubles in length breaks it. Headings and button labels especially.");
w("6. **Sentence case**, not title case. No exclamation marks.");
w("7. Where the English is a heading of two or three words, so is the Darija.");
w();
w("### Settled usage");
w();
w("These were corrected by a native speaker. Follow them exactly.");
w();
w("- **No article** on these borrowed words, ever: `request`, `slug`, `response`, `repo`,");
w("  `dataset`, `site`. Write `had request`, never `had l-request`.");
w("- **Take `l-`** when definite: `API`, `file`, `code`, `crosswalk`, `query`, `header`,");
w("  `folder`, `filters`, `match`. Definiteness still decides: `ykhtar file` is picking");
w("  *a* file, so it stays bare; `l-file li fih l-jawab` is *the* file, so it takes it.");
w("- Spell the preposition *from* as `mn`, never `men`.");
w("- Say `Codes`, not `Rmooz`.");
w("- `record` stays in English.");
w("- `iqlim` is a province and `amala` is a préfecture. They are different things.");
w();
w("## How to reply");
w();
w("Reply with **one JSON object and nothing else** — no commentary, no markdown fence.");
w(`Use exactly the keys given below, all ${total} of them. Escape quotes properly.`);
w();
w("```");
w("{");
w('  "levels.region": "...",');
w('  "levels.province": "...",');
w('  "ui.title": "...",');
w('  "ui.tagline": "..."');
w("}");
w("```");
w();
w("## The strings");
w();
w("### Administrative tiers");
w();
w("These five are single words that appear as labels under numbers and beside names.");
w();
for (const [key, value] of Object.entries(LEVELS.en).filter(([k]) => levelKeys.includes(k))) {
  w(`**\`levels.${key}\`** — ${LEVEL_NOTES[key] ?? ""}`);
  w();
  w("> " + value);
  w();
}
w("### Interface");
w();
for (const [key, value] of Object.entries(ui.en).filter(([k]) => uiKeys.includes(k))) {
  w(`**\`ui.${key}\`** — ${NOTES[key] ?? ""}`);
  w();
  w("> " + String(value).replace(/\n/g, " "));
  w();
}

await writeFile("site/src/i18n/BRIEF.md", lines.join("\n"));
console.log(`brief: ${total} strings${only ? " (subset)" : ""} -> site/src/i18n/BRIEF.md`);
