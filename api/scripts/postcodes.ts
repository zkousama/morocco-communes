/**
 * Morocco's postcodes, from Poste Maroc's 2 lists on data.gov.ma, under the ODbL, for the
 * search and the commune pages. Writes api/data/postcodes.json; run by hand when they change:
 *
 *   pnpm api:postcodes
 *
 * A city's postcodes come from its list of neighbourhoods, with the neighbourhoods under
 * each; a town's or a village's from the list of localities, matched to a commune of its
 * province by name. A locality that matches no commune, or more than one, is left out.
 */
import { readFile, writeFile } from "node:fs/promises";
import { readSheetRows } from "../../pipeline/src/lib/xlsx.ts";
import { citiesOf, cleanName, communeFor } from "../src/lib/postNeighbourhoods.ts";
import { fetchFile } from "./fetchFile.ts";

const NEIGHBOURHOODS =
  "https://data.gov.ma/data/ar/dataset/e0093dbf-38f0-440a-91da-ad3f0243f378/resource/7f257007-d512-4a2e-9f7f-ba29ee4ac8b1/download/codes-postaux-quartiers-2018.xlsx";
const LOCALITIES =
  "https://data.gov.ma/data/fr/dataset/c90aaa8f-5ad0-41d3-a9d2-f8f87ec538e0/resource/3aa9c2ce-bd68-4f91-86af-d4eeb3b8e6d1/download/codes-postaux-localites-2018.xlsx";
const OUT = "api/data/postcodes.json";
/**
 * Provinces the localities list names in a way neither the name nor its consonants reach:
 * a town put before the province's name, or an S at the end. Checked against the
 * province each list's communes are in.
 */
const PROVINCE_NAMES: Record<string, string> = {
  "DAR DRIOUCH": "Driouch",
  "BOUARFA FIGUIG": "Figuig",
  "EL KELAA DES SRAGHNAS": "El Kelâa Des-Sraghna",
};

interface Unit {
  code: string;
  type?: string;
  name: { fr: string };
  parents?: { province: string };
}
const read = async (name: string) => JSON.parse(await readFile(`data/v1/attributes/${name}.json`, "utf8")) as Unit[];
const communes = await read("communes");
const provinces = await read("provinces");

const postcodes = new Map<string, { postcode: string; code: string; names: Set<string> }>();
const add = (postcode: string, code: string, name: string | null) => {
  if (!/^\d{5}$/.test(postcode)) return;
  const key = `${postcode}|${code}`;
  if (!postcodes.has(key)) postcodes.set(key, { postcode, code, names: new Set() });
  if (name) postcodes.get(key)!.names.add(name);
};

const neighbourhoods = await fetchFile(NEIGHBOURHOODS);
const rows = readSheetRows(neighbourhoods.bytes, 1).slice(1);
const cities = citiesOf(rows.map((r) => r[0] ?? ""), communes);
for (const [city, raw, postcode] of rows) {
  const commune = cities.get((city ?? "").trim());
  if (commune) add((postcode ?? "").trim(), commune.code, cleanName(raw ?? ""));
}

const localities = await fetchFile(LOCALITIES);
const localityRows = readSheetRows(localities.bytes, 1).slice(1);
// Its own name, a name spelt with other vowels (Mohammedia, Taroudant), or one of the few above.
const provinceOf = (name: string) => communeFor(PROVINCE_NAMES[name] ?? name, provinces);
let matched = 0;
const unknown = new Set<string>();
for (const [, province, locality, postcode] of localityRows) {
  const p = provinceOf((province ?? "").trim());
  if (!p) {
    unknown.add((province ?? "").trim());
    continue;
  }
  const commune = communeFor(locality ?? "", communes.filter((c) => c.parents?.province === p.code));
  if (!commune) continue;
  add((postcode ?? "").trim(), commune.code, null);
  matched++;
}

const out = [...postcodes.values()]
  .map(({ postcode, code, names }) => [postcode, code, [...names].sort()] as [string, string, string[]])
  .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
await writeFile(
  OUT,
  `${JSON.stringify({
    source:
      `Poste Maroc, data.gov.ma, ODbL: Codes postaux des quartiers 2018 (sha256 ${neighbourhoods.digest}), each in its city's commune; ` +
      `Codes postaux des localités 2018 (sha256 ${localities.digest}), each matched to a commune of its province by name`,
    postcodes: out,
  })}\n`,
);
console.log(`neighbourhoods list: ${rows.length} rows in ${cities.size} cities`);
console.log(`localities list: ${localityRows.length} rows, ${matched} matched to a commune; provinces not recognised: ${[...unknown].join(", ") || "none"}`);
console.log(`postcodes: ${new Set(out.map((r) => r[0])).size} postcodes in ${new Set(out.map((r) => r[1])).size} communes`);
