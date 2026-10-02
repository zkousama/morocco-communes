/**
 * Asks the Overpass API, OpenStreetMap's query service, and hands back its elements and the
 * date of the map they come from. The main server and a mirror are tried in turn, 3 times
 * over, since either can be too busy to answer. A mirror can also be months behind: on
 * 2026-10-01 overpass.kumi.systems answered from May's map, 174 neighbourhoods short. An
 * answer from a map older than MAX_AGE_DAYS is turned away like a busy one. Used by the
 * scripts run by hand that fetch from OpenStreetMap; no build does.
 */

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
}

/** Days a server's copy of the map may lag before its answer is turned away. */
export const MAX_AGE_DAYS = 7;

/** A query asks for at most 10 minutes; a server still silent a minute past that isn't answering. */
const TIMEOUT_MS = 11 * 60_000;
/** Servers that couldn't be reached at all this run, skipped from then on: one can hang a request for its whole timeout. */
const unreachable = new Set<string>();

/**
 * `maxAgeDays` lets a script take an older map where that's no loss: a village mapped 2
 * months ago is the same village.
 */
export async function overpass(query: string, { maxAgeDays = MAX_AGE_DAYS } = {}): Promise<{ elements: OverpassElement[]; asOf: string }> {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of ENDPOINTS) {
      if (unreachable.has(endpoint)) continue;
      try {
        const response = await fetch(endpoint, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
            // Overpass turns away a request that doesn't say who's asking.
            "user-agent": "morocco-communes (github.com/zkousama/morocco-communes)",
          },
          body: new URLSearchParams({ data: query }),
        });
        // A busy server can answer 200 with an HTML page, so the body has to parse too.
        if (response.ok) {
          const body = (await response.json()) as { elements: OverpassElement[]; osm3s?: { timestamp_osm_base?: string } };
          const asOf = body.osm3s?.timestamp_osm_base ?? "";
          const days = asOf ? (Date.now() - Date.parse(asOf)) / 86_400_000 : Number.POSITIVE_INFINITY;
          if (days > maxAgeDays) {
            failures.push(`${new URL(endpoint).host} answered from the map of ${asOf || "an unknown date"}`);
            continue;
          }
          console.log(`overpass: ${new URL(endpoint).host}, map as of ${asOf}, ${body.elements.length} elements`);
          return { elements: body.elements, asOf };
        }
        failures.push(`${new URL(endpoint).host} ${response.status}`);
      } catch (error) {
        failures.push(`${new URL(endpoint).host} ${(error as Error).message}`);
        // A refused or dropped connection, as against an answer that didn't parse.
        if (!(error instanceof SyntaxError)) unreachable.add(endpoint);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`Overpass didn't answer: ${failures.join(", ")}`);
}
