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
  footerData: "Footer credit line.",
  footerGeometry: "Footer credit line.",
  repo: "Link label to the source repository. One or two words.",
};

const LEVEL_NOTES: Record<string, string> = {
  region: "The largest administrative tier. Morocco has 12.",
  province: "The tier below a région. Called a province or a préfecture.",
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
w("## How to reply");
w();
w("Reply with **one JSON object and nothing else** — no commentary, no markdown fence.");
w("Use exactly the keys given below, all 59 of them. Escape quotes properly.");
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
for (const [key, value] of Object.entries(LEVELS.en)) {
  w(`**\`levels.${key}\`** — ${LEVEL_NOTES[key] ?? ""}`);
  w();
  w("> " + value);
  w();
}
w("### Interface");
w();
for (const [key, value] of Object.entries(ui.en)) {
  w(`**\`ui.${key}\`** — ${NOTES[key] ?? ""}`);
  w();
  w("> " + String(value).replace(/\n/g, " "));
  w();
}

await writeFile("site/src/i18n/BRIEF.md", lines.join("\n"));
console.log(
  `brief: ${Object.keys(ui.en).length + Object.keys(LEVELS.en).length} strings -> site/src/i18n/BRIEF.md`,
);
