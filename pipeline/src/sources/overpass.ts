import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface OverpassMember {
  type: string;
  role: string;
  geometry?: { lat: number; lon: number }[];
}
export interface OverpassRelation {
  id: number;
  tags: Record<string, string>;
  members: OverpassMember[];
}
export interface OverpassResponse {
  elements: OverpassRelation[];
}

/** A cached Overpass response plus the provenance of the cache entry itself. */
export interface RegionSnapshot {
  elements: OverpassRelation[];
  fetchedAt: string | null;
  endpoint: string | null;
}

interface CacheEnvelope {
  fetchedAt: string;
  endpoint: string;
  query: string;
  elements: OverpassRelation[];
}

/**
 * Reads a cached région, accepting both the enveloped form and the bare Overpass
 * response that earlier runs wrote.
 *
 * For a bare file the mtime stands in for the fetch time: it is when the file was
 * written, which is when it was fetched. That is weaker evidence than a recorded
 * timestamp — a copy or a restore would move it — so it is worth knowing that the
 * enveloped form is authoritative and this is a fallback, but it is true, and a dataset
 * that argues from provenance should not report "unknown" for something it can observe.
 */
export async function readRegionCache(path: string): Promise<RegionSnapshot> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<CacheEnvelope>;
  if (!Array.isArray(raw.elements)) throw new Error(`cached région ${path} holds no elements array`);
  if (typeof raw.fetchedAt === "string") {
    return { elements: raw.elements, fetchedAt: raw.fetchedAt, endpoint: raw.endpoint ?? null };
  }
  const { mtime } = await stat(path);
  return { elements: raw.elements, fetchedAt: mtime.toISOString(), endpoint: null };
}

/** The main endpoint returns 504 for these; the mirrors serve them in about a minute. */
export const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

export function buildRegionQuery(regionCode: string): string {
  return `[out:json][timeout:110];
relation["boundary"="administrative"]["admin_level"="8"]["ref:MA:HCP"~"^${regionCode}\\\\."];
out geom;`;
}

/**
 * The 41 arrondissements, which OpenStreetMap maps at admin_level 10 inside the 6 cities
 * that have them. The box covers those cities, from Marrakech north to Tanger.
 */
export function buildArrondissementQuery(): string {
  return `[out:json][timeout:110];
relation["boundary"="administrative"]["admin_level"="10"]["ref:MA:HCP"](31,-10,36,-4);
out geom;`;
}

export function fetchRegion(regionCode: string, cacheDir: string): Promise<RegionSnapshot> {
  return fetchSnapshot(regionCode, buildRegionQuery(regionCode), cacheDir);
}

export function fetchArrondissements(cacheDir: string): Promise<RegionSnapshot> {
  return fetchSnapshot("arrondissements", buildArrondissementQuery(), cacheDir);
}

async function fetchSnapshot(name: string, query: string, cacheDir: string): Promise<RegionSnapshot> {
  const dir = join(cacheDir, "osm");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  if (existsSync(path)) return readRegionCache(path);

  const body = new URLSearchParams({ data: query });
  const failures: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        headers: { "user-agent": "morocco-communes-api/0.1" },
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        failures.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const parsed = JSON.parse(text) as OverpassResponse;
      if (!Array.isArray(parsed.elements)) {
        failures.push(`${endpoint}: no elements array`);
        continue;
      }
      // The envelope is written only after `elements` has been parsed and checked, so a
      // truncated or rate-limited response can never be cached as if it were data.
      const snapshot: CacheEnvelope = {
        fetchedAt: new Date().toISOString(),
        endpoint,
        query,
        elements: parsed.elements,
      };
      await writeFile(path, `${JSON.stringify(snapshot)}\n`);
      return { elements: snapshot.elements, fetchedAt: snapshot.fetchedAt, endpoint };
    } catch (err) {
      failures.push(`${endpoint}: ${(err as Error).message}`);
    }
  }
  throw new Error(`every Overpass endpoint failed for ${name}:\n  ${failures.join("\n  ")}`);
}
