/**
 * Fetches Morocco's suburbs, quarters and neighbourhoods from OpenStreetMap and places each
 * in the arrondissement or commune whose boundary holds it, for the search. Writes
 * api/data/neighbourhoods.json, which the API build reads; run by hand when they change:
 *
 *   pnpm api:neighbourhoods
 *
 * A place no boundary holds is left out, and so is one named like the unit it's in, which
 * the search finds already, and a second place with the same names in the same unit. The
 * few OpenStreetMap doesn't map, listed by hand in neighbourhoodsAdded.ts, are placed the
 * same way after it.
 *
 * Then Poste Maroc's list of neighbourhoods by postcode, from data.gov.ma. Its rows have a
 * city and no point, so each goes in its city's commune, and a name OpenStreetMap already
 * has in that city is left to OpenStreetMap's entry, which knows the arrondissement.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { readArrondissements, readBoundaries, type Boundary } from "../src/emit/boundaries.ts";
import { inside, MAX_LOSS, namesOf, tooShrunk, type Neighbourhood } from "../src/lib/neighbourhoods.ts";
import { ADDED } from "../src/lib/neighbourhoodsAdded.ts";
import { cityKey, cleanName, coreOf } from "../src/lib/postNeighbourhoods.ts";
import { readSheetRows } from "../../pipeline/src/lib/xlsx.ts";
import { normalise } from "../src/lib/normalise.ts";
import { overpass } from "./overpass.ts";

const GEOMETRY = "data/v1/geometry";
/** "Codes postaux des quartiers", Poste Maroc, published on data.gov.ma under the ODbL. */
const POSTE =
  "https://data.gov.ma/data/ar/dataset/e0093dbf-38f0-440a-91da-ad3f0243f378/resource/7f257007-d512-4a2e-9f7f-ba29ee4ac8b1/download/codes-postaux-quartiers-2018.xlsx";
const OUT = "api/data/neighbourhoods.json";

const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="MA"]["admin_level"="2"]->.ma;
nwr["place"~"^(suburb|quarter|neighbourhood)$"](area.ma);
out tags center;`;

interface Unit {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
  type?: string;
  communeCode?: string;
}

const read = async (name: string) => JSON.parse(await readFile(`data/v1/attributes/${name}.json`, "utf8")) as Unit[];
const communes = await read("communes");
const arrondissements = await read("arrondissements");
const byDigits = new Map([...communes, ...arrondissements].map((u) => [u.codeDigits, u]));

/** Each boundary with its bounding box, so most are passed over without a ring test. */
const prepare = (boundaries: Boundary[]) =>
  boundaries.map((b) => {
    const points = b.polygons.flat(2);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return { unit: byDigits.get(b.codeDigits), polygons: b.polygons, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
const finer = prepare(await readArrondissements(GEOMETRY));
const coarser = prepare((await readBoundaries(GEOMETRY)).flatMap((r) => r.boundaries));

/** The arrondissement a point is in, if it's in one; otherwise its commune. */
const unitAt = (lng: number, lat: number): Unit | null => {
  for (const shapes of [finer, coarser]) {
    for (const s of shapes) {
      const [w, south, e, north] = s.box as [number, number, number, number];
      if (lng < w || lng > e || lat < south || lat > north) continue;
      if (s.unit && s.polygons.some((polygon) => inside([lng, lat], polygon))) return s.unit;
    }
  }
  return null;
};

const { elements, asOf } = await overpass(QUERY);
// The hand-added ones go through the same checks, after OpenStreetMap's, as if it had them.
for (const added of ADDED) {
  elements.push({ type: "node", id: 0, lat: added.lat, lon: added.lng, tags: { "name:fr": added.fr, "name:ar": added.ar } });
}
const kept = new Map<string, Neighbourhood>();
let unnamed = 0;
let outside = 0;
let sameAsUnit = 0;
for (const e of elements) {
  const names = namesOf(e.tags ?? {});
  if (!names) {
    unnamed++;
    continue;
  }
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  const unit = lat === undefined || lng === undefined ? null : unitAt(lng, lat);
  if (!unit) {
    outside++;
    continue;
  }
  const fr = normalise(names.fr);
  const ar = normalise(names.ar);
  if ((fr && fr === normalise(unit.name.fr)) || (ar && ar === normalise(unit.name.ar))) {
    sameAsUnit++;
    continue;
  }
  const key = `${unit.code}|${fr}|${ar}`;
  if (!kept.has(key)) kept.set(key, [names.fr, names.ar, unit.code, e.id === 0 ? "hand" : "osm"]);
}

// Poste Maroc: each city to its urban commune, and the names already there set aside.
const response = await fetch(POSTE, { headers: { "user-agent": "morocco-communes (github.com/zkousama/morocco-communes)" } });
if (!response.ok) throw new Error(`data.gov.ma answered ${response.status} for Poste Maroc's list`);
const bytes = new Uint8Array(await response.arrayBuffer());
const digest = createHash("sha256").update(bytes).digest("hex");
const rows = readSheetRows(bytes, 1).slice(1);
const towns = new Map(communes.filter((c) => c.type === "urban").map((c) => [cityKey(c.name.fr), c]));
const cities = new Map<string, Unit>();
const unmatched = new Set<string>();
for (const [city] of rows) {
  const name = (city ?? "").trim();
  if (!name || cities.has(name)) continue;
  const commune = towns.get(cityKey(name));
  if (commune) cities.set(name, commune);
  else unmatched.add(name);
}
if (unmatched.size > 0) throw new Error(`no urban commune for Poste Maroc's cities: ${[...unmatched].join(", ")}`);
// The names each city already has: OpenStreetMap's, in the commune or its arrondissements, and the units' own.
const taken = new Map<string, Set<string>>();
const inCity = (code: string) => arrondissements.filter((a) => a.communeCode === code).map((a) => a.code).concat(code);
for (const commune of cities.values()) {
  const codes = new Set(inCity(commune.code));
  const names = new Set<string>();
  for (const [fr, , code] of kept.values()) if (codes.has(code)) names.add(coreOf(normalise(fr)));
  for (const u of [...communes, ...arrondissements]) if (codes.has(u.code)) names.add(coreOf(normalise(u.name.fr)));
  taken.set(commune.code, names);
}
let posted = 0;
let notPlaces = 0;
let known = 0;
for (const [city, raw] of rows) {
  const commune = cities.get((city ?? "").trim());
  const name = cleanName(raw ?? "");
  if (!commune) continue;
  if (!name) {
    notPlaces++;
    continue;
  }
  const names = taken.get(commune.code)!;
  const core = coreOf(normalise(name));
  if (names.has(core)) {
    known++;
    continue;
  }
  names.add(core);
  kept.set(`${commune.code}|${normalise(name)}|`, [name, "", commune.code, "poste"]);
  posted++;
}
console.log(`Poste Maroc: ${rows.length} rows in ${cities.size} cities; ${posted} added, ${known} already there or repeated, ${notPlaces} not a place`);

const places = [...kept.values()].sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
// A busy Overpass server can answer with part of the map, so a list that lost more than a
// few of the last one's OpenStreetMap names is refused rather than written over it.
const handNames = new Set(ADDED.map((a) => a.fr));
const before = existsSync(OUT)
  ? (JSON.parse(await readFile(OUT, "utf8")) as { places: Neighbourhood[] }).places.filter((p) => (p[3] ?? (handNames.has(p[0]) ? "hand" : "osm")) === "osm").length
  : 0;
const after = places.filter((p) => p[3] === "osm").length;
if (tooShrunk(before, after) && !process.env.ALLOW_SHRINK) {
  throw new Error(
    `OpenStreetMap gave ${after} neighbourhoods against ${before} last time, more than ${MAX_LOSS * 100}% fewer: likely a partial answer. ` +
      "Try again later, or set ALLOW_SHRINK=1 if the map really lost them.",
  );
}

await writeFile(
  OUT,
  `${JSON.stringify({
    source: `OpenStreetMap contributors, ODbL, map as of ${asOf.slice(0, 10)}: place=suburb, quarter and neighbourhood inside Morocco, each in the arrondissement or commune whose boundary holds it; Poste Maroc, Codes postaux des quartiers 2018, data.gov.ma, ODbL, sha256 ${digest}, each in its city's commune`,
    places,
  })}\n`,
);
const count = (source: string) => places.filter((p) => p[3] === source).length;
console.log(`kept ${places.length}: ${count("osm")} from OpenStreetMap (${before} last time), ${count("hand")} added by hand, ${count("poste")} from Poste Maroc`);
console.log(`left out of OpenStreetMap's: ${unnamed} with no name, ${outside} in no boundary, ${sameAsUnit} named like their unit`);
for (const added of ADDED) console.log(`${added.fr}:`, JSON.stringify(places.filter((p) => p[0] === added.fr)));
