/**
 * Matches HCP's douars to the places GeoNames and OpenStreetMap map in their commune, and
 * writes each match to api/data/douar-places.json: the douar's code, a Latin name for it
 * someone wrote down, where it came from, and the point. `pnpm api:douar-places`.
 *
 * GeoNames' populated places come from its Morocco file, pinned by digest in the output.
 * OpenStreetMap's villages, hamlets, towns, localities and isolated dwellings come from
 * Overpass, one kind at a time, since the whole country in one query times out; each
 * answer is kept in .cache/osm, and a kind Overpass won't answer is read from there.
 * OSM=keep reads every kind already kept from there without asking.
 *
 * Before writing, the matching runs again with every commune's places put against another
 * commune's douars. A match there is chance, so their count over the real count is how
 * many of the real matches are likely chance. The second pass, near a fraction's placed
 * douars, is checked the same way with each douar given another douar's name. Over 5% in
 * either stops the script.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readBoundaries } from "../src/emit/boundaries.ts";
import { inside } from "../src/lib/neighbourhoods.ts";
import { matchDouars, matchNearFractions, type Douar, type Match, type Place } from "../src/lib/douarPlaces.ts";
import { arabicKeys } from "../src/lib/translit.ts";
import { toLatin } from "../src/lib/spell.ts";
import type { WordTable } from "../src/lib/translitWords.ts";
import { readZipEntry } from "../../pipeline/src/lib/zip.ts";
import { fetchFile } from "./fetchFile.ts";
import { overpass } from "./overpass.ts";

const OUT = "api/data/douar-places.json";
const GEONAMES = "https://download.geonames.org/export/dump/MA.zip";
const KINDS = ["village", "hamlet", "town", "locality", "isolated_dwelling"];
const CACHE = ".cache/osm";
/** A village mapped this long ago is the same village. */
const MAX_AGE_DAYS = 180;
/** The most of the matches that may be chance. */
const MAX_CHANCE = 0.05;

const arabicScript = /\p{Script=Arabic}/u;
const read = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

// The douars, by commune, with their spelling by rule to score a place's Latin against.
const table = await read<WordTable>("api/generated/translit-words.json");
const douarsIn = new Map<string, Douar[]>();
for (let r = 1; r <= 12; r++) {
  for (const d of await read<{ code: string; communeCode: string; name: { ar: string } }[]>(`data/v1/douars/${String(r).padStart(2, "0")}.json`)) {
    const list = douarsIn.get(d.communeCode) ?? [];
    list.push({ code: d.code, name: d.name, spelt: toLatin(d.name.ar, table) });
    douarsIn.set(d.communeCode, list);
  }
}

// Each commune's boundary with its box, so most are passed over without a ring test.
const communes = await read<{ code: string; codeDigits: string }[]>("data/v1/attributes/communes.json");
const codeOf = new Map(communes.map((c) => [c.codeDigits, c.code]));
const shapes = (await readBoundaries("data/v1/geometry")).flatMap((r) => r.boundaries).map((b) => {
  const points = b.polygons.flat(2) as unknown as [number, number][];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { code: codeOf.get(b.codeDigits), polygons: b.polygons, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const };
});
const communeAt = (place: Place): string | null => {
  for (const s of shapes) {
    const [west, south, east, north] = s.box;
    if (place.lng < west || place.lng > east || place.lat < south || place.lat > north) continue;
    if (s.code && s.polygons.some((polygon) => inside([place.lng, place.lat], polygon as never))) return s.code;
  }
  return null;
};

// GeoNames: every populated place, its name first, then its other names.
const geonames = await fetchFile(GEONAMES);
const places: Place[] = [];
for (const line of new TextDecoder().decode(readZipEntry(geonames.bytes, "MA.txt")).split("\n")) {
  const f = line.split("\t");
  if (f[6] !== "P") continue;
  const names = [...new Set([f[1]!, f[2]!, ...(f[3] ? f[3].split(",") : [])].filter(Boolean))];
  places.push({
    source: "geonames",
    id: f[0]!,
    lat: Number(f[4]),
    lng: Number(f[5]),
    latin: names.filter((n) => !arabicScript.test(n)),
    arabic: names.filter((n) => arabicScript.test(n)),
  });
}

// OpenStreetMap: a node's names, the French one first, split where a name holds 2 scripts.
await mkdir(CACHE, { recursive: true });
const asOf: string[] = [];
for (const kind of KINDS) {
  const cached = `${CACHE}/places-${kind}.json`;
  let elements: { id: number; lat?: number; lon?: number; tags?: Record<string, string> }[];
  if (process.env.OSM === "keep" && existsSync(cached)) {
    const kept = await read<{ asOf: string; elements: typeof elements }>(cached);
    console.log(`douar-places: ${kind} from the copy of ${kept.asOf}, ${kept.elements.length} places`);
    elements = kept.elements;
    asOf.push(kept.asOf);
  } else try {
    const answer = await overpass(
      `[out:json][timeout:600];area["ISO3166-1"="MA"][admin_level=2]->.ma;node["place"="${kind}"](area.ma);out body qt;`,
      { maxAgeDays: MAX_AGE_DAYS },
    );
    elements = answer.elements;
    asOf.push(answer.asOf);
    await writeFile(cached, JSON.stringify({ asOf: answer.asOf, elements }));
  } catch (error) {
    if (!existsSync(cached)) throw error;
    const kept = await read<{ asOf: string; elements: typeof elements }>(cached);
    console.warn(`douar-places: Overpass didn't answer for ${kind}, so the copy of ${kept.asOf} is used`);
    elements = kept.elements;
    asOf.push(kept.asOf);
  }
  for (const e of elements) {
    if (e.lat === undefined || e.lon === undefined) continue;
    const tags = e.tags ?? {};
    const ordered = [tags["name:fr"], tags["name:en"], tags["name:latn"], tags.name, tags["name:ar"], tags.alt_name, tags.old_name].filter((n): n is string => Boolean(n));
    const parts = [...new Set(ordered.flatMap((n) => n.split(/\s*[;\/|]\s*|\s+-\s+/)).map((n) => n.replace(/[ⴰ-⵿]+/g, "").trim()).filter(Boolean))];
    places.push({
      source: "osm",
      id: String(e.id),
      lat: e.lat,
      lng: e.lon,
      latin: parts.filter((n) => /[A-Za-z]/.test(n) && !arabicScript.test(n)),
      arabic: parts.filter((n) => arabicScript.test(n)),
    });
  }
}

// The real matching, then the same against another commune's douars, one of a like size.
const matches = matchDouars(douarsIn, places, communeAt);
const bySize = [...douarsIn].sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1)).map(([code]) => code);
const swap = new Map(bySize.map((code, i) => [code, bySize[(i + 7) % bySize.length]!]));
const decoys = matchDouars(douarsIn, places, communeAt, (code) => swap.get(code) ?? code);
const douars = [...douarsIn.values()].reduce((n, list) => n + list.length, 0);
const chance = decoys.length / matches.length;
const count = (list: Match[], source: string) => list.filter((m) => m.place.source === source).length;
console.log(
  `douar-places: ${matches.length} of ${douars} douars matched (GeoNames ${count(matches, "geonames")}, OpenStreetMap ${count(matches, "osm")}); ` +
    `${decoys.length} against the wrong commune, so about ${(chance * 100).toFixed(1)}% of the matches are chance`,
);
if (chance > MAX_CHANCE) throw new Error(`more than ${MAX_CHANCE * 100}% of the matches would be chance; nothing written`);

// The second pass, then the same with each douar given a name from another commune, as
// long a name as its own, so what still matches nearby is chance.
const near = matchNearFractions(douarsIn, places, communeAt, matches);
const lengthOf = (d: Douar) => Math.max(...arabicKeys(d.name.ar).map((k) => k.replace(/l/g, "").length));
const all = [...douarsIn.values()].flat();
const byLength = new Map<number, Douar[]>();
for (const d of all) byLength.set(lengthOf(d), [...(byLength.get(lengthOf(d)) ?? []), d]);
const communeOfDouar = new Map<string, string>();
for (const [commune, list] of douarsIn) for (const d of list) communeOfDouar.set(d.code, commune);
const borrowed = new Map<string, Douar>();
for (const list of byLength.values()) {
  list.forEach((d, i) => {
    let j = (i + 97) % list.length;
    for (let k = 0; k < list.length && communeOfDouar.get(list[j]!.code) === communeOfDouar.get(d.code); k++) j = (j + 1) % list.length;
    borrowed.set(d.code, { ...d, name: list[j]!.name, spelt: list[j]!.spelt });
  });
}
const nearDecoys = matchNearFractions(douarsIn, places, communeAt, matches, (d) => borrowed.get(d.code)!);
const nearChance = nearDecoys.length / Math.max(near.length, 1);
console.log(
  `douar-places: ${near.length} more matched near their fraction's placed douars; ` +
    `${nearDecoys.length} with a borrowed name, so about ${(nearChance * 100).toFixed(1)}% of them are chance`,
);
if (nearChance > MAX_CHANCE) throw new Error(`more than ${MAX_CHANCE * 100}% of the second pass would be chance; nothing written`);

const round = (v: number) => Math.round(v * 1e5) / 1e5;
// Each row says how it was matched: by its name alone, or by its name near its fraction.
const rows = [...matches.map((m) => ({ m, how: "name" })), ...near.map((m) => ({ m, how: "near" }))]
  .sort((a, b) => (a.m.douar < b.m.douar ? -1 : 1))
  .map(({ m, how }) => [m.douar, m.name, m.place.source, round(m.place.lat), round(m.place.lng), m.place.id, how]);
const oldest = asOf.sort()[0]!.slice(0, 10);
await writeFile(
  OUT,
  `${JSON.stringify({
    source:
      `GeoNames, CC BY 4.0, ${GEONAMES}, sha256 ${geonames.digest}: populated places; ` +
      `OpenStreetMap contributors, ODbL, map as of ${oldest} or later: place=${KINDS.join(", ")} inside Morocco; ` +
      `each matched to an HCP douar in the commune whose boundary holds it`,
    chance: Math.round(chance * 1000) / 1000,
    nearChance: Math.round(nearChance * 1000) / 1000,
    places: rows,
  })}\n`,
);
console.log(`douar-places: wrote ${rows.length} to ${OUT}`);
