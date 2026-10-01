/**
 * Fetches the railway the commuting map draws from OpenStreetMap, through the Overpass API,
 * and writes site/scripts/data/rail.json. Run by hand when the network changes; the build
 * reads the file and never fetches:
 *
 *   pnpm site:rail
 *
 * Main and branch lines and tram lines inside Morocco, and the stations and halts beside
 * them. Yards, sidings, spurs and crossovers are left out, and so is any group of joined
 * track too short to be a line: see railNetwork.ts.
 */
import { writeFile } from "node:fs/promises";
import { simplify, type Point } from "../src/lib/geo.ts";
import { networkOf, type OsmWay } from "./railNetwork.ts";

/** Overpass's main server, then a mirror: either can be too busy to answer. */
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
/** Kilometres of joined track a group needs to be drawn: a line, not a quarry's track. */
const BARS = { rail: 5, tram: 2 };
/** A station further than this from any line drawn is left out with it. */
const STATION_REACH_KM = 1;
/** Degrees: well under a pixel at the map's widest zoom. */
const TOLERANCE = 0.0004;

const QUERY = `[out:json][timeout:300];
area["ISO3166-1"="MA"]["admin_level"="2"]->.ma;
(
  way["railway"="rail"]["service"!~"^(yard|siding|spur|crossover)$"](area.ma);
  way["railway"="tram"](area.ma);
);
out body geom;
node["railway"~"^(station|halt)$"](area.ma);
out body;`;

interface Element {
  type: "way" | "node";
  id: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  lat?: number;
  lon?: number;
}

async function ask(): Promise<Element[]> {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of ENDPOINTS) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          // Overpass turns away a request that doesn't say who's asking.
          "user-agent": "morocco-communes (github.com/zkousama/morocco-communes)",
        },
        body: new URLSearchParams({ data: QUERY }),
      }).catch((error: Error) => ({ ok: false, status: error.message }) as const);
      if (response.ok) return ((await (response as Response).json()) as { elements: Element[] }).elements;
      failures.push(`${new URL(endpoint).host} ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`Overpass didn't answer: ${failures.join(", ")}`);
}

const elements = await ask();

const ways: OsmWay[] = elements
  .filter((e) => e.type === "way" && e.nodes && e.geometry)
  .map((e) => ({
    id: e.id,
    kind: e.tags?.railway === "tram" ? "tram" : "rail",
    nodes: e.nodes!.map((id, i) => ({ id, lng: e.geometry![i]!.lon, lat: e.geometry![i]!.lat })),
  }));
const { kept, dropped } = networkOf(ways, BARS);

const round = (p: Point): Point => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
const lineOf = (way: OsmWay) => simplify(way.nodes.map((n) => [n.lng, n.lat] as Point), TOLERANCE).map(round);

// A station counts when it's within reach of a node of the line drawn.
const railNodes = kept.filter((w) => w.kind === "rail").flatMap((w) => w.nodes);
const near = (lng: number, lat: number) => {
  const reach = STATION_REACH_KM / 111;
  return railNodes.some((n) => Math.abs(n.lat - lat) < reach && Math.abs(n.lng - lng) * Math.cos((lat * Math.PI) / 180) < reach);
};
const stations = elements
  .filter((e) => e.type === "node" && e.lat !== undefined && e.lon !== undefined && near(e.lon, e.lat))
  .map((e) => round([e.lon!, e.lat!]));

const fetched = new Date().toISOString().slice(0, 10);
const network = {
  source: `OpenStreetMap contributors, ODbL, fetched ${fetched}: railway=rail (main and branch lines; no yards, sidings, spurs or crossovers), railway=tram, railway=station and halt; joined track under ${BARS.rail} km of rail or ${BARS.tram} km of tram left out`,
  rail: kept.filter((w) => w.kind === "rail").map(lineOf),
  tram: kept.filter((w) => w.kind === "tram").map(lineOf),
  stations,
};
await writeFile("site/scripts/data/rail.json", JSON.stringify(network));

const km = (kind: "rail" | "tram") => Math.round(kept.filter((w) => w.kind === kind).reduce((s, w) => s + lengthOf(w), 0));
function lengthOf(way: OsmWay) {
  let total = 0;
  for (let i = 1; i < way.nodes.length; i++) {
    const a = way.nodes[i - 1]!;
    const b = way.nodes[i]!;
    total += Math.hypot((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 111.2;
  }
  return total;
}
console.log(`rail: ${network.rail.length} ways, about ${km("rail")} km; tram: ${network.tram.length} ways, about ${km("tram")} km; stations: ${stations.length}`);
console.log(`left out: ${dropped.length} short groups`);
for (const d of dropped.sort((a, b) => b.km - a.km)) {
  console.log(`  ${d.kind} ${d.km.toFixed(2)} km at ${d.at.lat.toFixed(4)}, ${d.at.lng.toFixed(4)} (ways ${d.ways.join(", ")})`);
}
