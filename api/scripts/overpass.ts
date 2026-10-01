/**
 * Asks the Overpass API, OpenStreetMap's query service, and hands back its elements. The
 * main server and a mirror are tried in turn, 3 times over, since either can be too busy
 * to answer. Used by the scripts run by hand that fetch from OpenStreetMap; no build does.
 */

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

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

export async function overpass(query: string): Promise<OverpassElement[]> {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
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
        if (response.ok) return ((await response.json()) as { elements: OverpassElement[] }).elements;
        failures.push(`${new URL(endpoint).host} ${response.status}`);
      } catch (error) {
        failures.push(`${new URL(endpoint).host} ${(error as Error).message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`Overpass didn't answer: ${failures.join(", ")}`);
}
