/**
 * Fetches Morocco's suburbs, quarters and neighbourhoods from OpenStreetMap and places each
 * in the arrondissement or commune whose boundary holds it, for the search. Writes
 * api/data/neighbourhoods.json, which the API build reads; run by hand when they change:
 *
 *   pnpm api:neighbourhoods
 *
 * A place no boundary holds is left out, and so is one named like the unit it's in, which
 * the search finds already, and a second place with the same names in the same unit.
 */
import { readFile, writeFile } from "node:fs/promises";
import { readArrondissements, readBoundaries, type Boundary } from "../src/emit/boundaries.ts";
import { inside, namesOf, type Neighbourhood } from "../src/lib/neighbourhoods.ts";
import { normalise } from "../src/lib/normalise.ts";
import { overpass } from "./overpass.ts";

const GEOMETRY = "data/v1/geometry";
const OUT = "api/data/neighbourhoods.json";

const QUERY = `[out:json][timeout:180];
area["ISO3166-1"="MA"]["admin_level"="2"]->.ma;
nwr["place"~"^(suburb|quarter|neighbourhood)$"](area.ma);
out tags center;`;

interface Unit {
  code: string;
  codeDigits: string;
  name: { fr: string; ar: string };
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

const elements = await overpass(QUERY);
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
  if (!kept.has(key)) kept.set(key, [names.fr, names.ar, unit.code]);
}

const places = [...kept.values()].sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const fetched = new Date().toISOString().slice(0, 10);
await writeFile(
  OUT,
  `${JSON.stringify({
    source: `OpenStreetMap contributors, ODbL, fetched ${fetched}: place=suburb, quarter and neighbourhood inside Morocco, each in the arrondissement or commune whose boundary holds it`,
    places,
  })}\n`,
);
console.log(`${elements.length} places in OpenStreetMap; kept ${places.length}`);
console.log(`left out: ${unnamed} with no name, ${outside} in no boundary, ${sameAsUnit} named like their unit, ${elements.length - unnamed - outside - sameAsUnit - places.length} repeats`);
const sample = places.filter((p) => /ma[aâ]rouf/i.test(p[0]));
console.log("Sidi Maârouf:", JSON.stringify(sample));
