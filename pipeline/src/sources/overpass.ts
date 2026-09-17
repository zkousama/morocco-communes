import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export async function fetchRegion(regionCode: string, cacheDir: string): Promise<OverpassResponse> {
  const dir = join(cacheDir, "osm");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${regionCode}.json`);
  if (existsSync(path)) return JSON.parse(await readFile(path, "utf8")) as OverpassResponse;

  const body = new URLSearchParams({ data: buildRegionQuery(regionCode) });
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
      await writeFile(path, text);
      return parsed;
    } catch (err) {
      failures.push(`${endpoint}: ${(err as Error).message}`);
    }
  }
  throw new Error(`every Overpass endpoint failed for région ${regionCode}:\n  ${failures.join("\n  ")}`);
}
