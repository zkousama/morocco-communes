import type { APIRoute } from "astro";
import { counts } from "../generated/hierarchy";
import { REPO_URL } from "../i18n/ui";

/**
 * /llms.txt, in the llmstxt.org shape: a plain markdown map an LLM can read to learn what
 * this is and where things are. Links are absolute when the deployed origin is known,
 * relative otherwise. The counts come from the dataset, not from this file.
 */
export const GET: APIRoute = ({ site }) => {
  const at = (path: string) => (site ? new URL(path, site).href : path);
  const n = new Intl.NumberFormat("en-GB");

  const body = `# Morocco communes

> Open dataset and HTTP API for Morocco's administrative divisions: ${counts.regions} régions, ${counts.provinces} provinces and préfectures, ${counts.cercles} cercles, ${n.format(counts.communes)} communes and ${counts.arrondissements} arrondissements. Official HCP geographic codes, names in French and Arabic, population from the 2024 and 2014 censuses, HCP's census indicators on age, education, languages, work and housing for both years, the 2024 count of economic establishments, and boundaries from OpenStreetMap. Free to call, no key, CORS open.

An identifier can be written 4 ways and all resolve to one unit: \`01.511.01.0\`, \`001511010\`, \`1511010\` or the slug \`tanger\`. Every response is an envelope of \`data\`, \`meta\` and \`links\`, and errors are RFC 9457 problem documents. Routes ending in \`.json\` are static files.

## API

- [OpenAPI spec](${at("/api/openapi.json")}): every route, parameter, limit and response shape
- [MCP server](${at("/mcp")}): Streamable HTTP, no key, with the tools search, get_commune, get_unit, communes_near, commune_at, list_communes, get_indicators and get_economy
- [Search](${at("/api/search?q=tanger")}): any unit by French or Arabic name, by slug, or by another name it goes by
- [Nearby](${at("/api/communes/near?lat=33.5731&lng=-7.5898&radius=15")}): communes within a radius of a point, nearest first
- [Commune at a point](${at("/api/communes/at?lat=35.786&lng=-5.8125")}): the commune whose boundary contains the point, and in the 6 cities divided into them, the arrondissement
- [One commune](${at("/api/communes/tanger")}): by any spelling of its identifier
- [Neighbours](${at("/api/communes/tiznit/neighbours.json")}): the communes one borders, with the length of the boundary each pair shares
- [Filtered list](${at("/api/communes?province=01.511")}): communes by région, province, cercle or type, 50 to a page, sorted by any figure or census indicator, such as ?sort=-labour.unemploymentRate
- [Census indicators](${at("/api/communes/tanger/indicators")}): HCP's 2024 figures for one unit, for the whole of it and its urban and rural parts, for men and women; /api/{level}/{code}/indicators for any unit, /api/indicators.json for Morocco
- [Economic establishments](${at("/api/communes/tiznit/economy")}): the 2024 count of establishments, businesses, permanent jobs and weekly souks for one unit; /api/{level}/{code}/economy for any unit, /api/economy.json for Morocco
- [Version](${at("/api/version.json")}): dataset version, record counts and when each source was read

## Pages

- [Every commune](${at("/communes/")}): a page for each région, province and commune, with its figures, a map and the communes it borders, at /communes/{slug}/, /provinces/{slug}/ and /regions/{slug}/

## Docs

- [API reference](${at("/docs/api/")}): every route with a real response, and what each error means
- [MCP setup](${at("/docs/mcp/")}): how to connect Claude, ChatGPT, Cursor, VS Code and the Claude and OpenAI APIs
- [Components](${at("/docs/components/")}): a région, province and commune picker for forms, in HTML or React
- [npm package](${at("/docs/npm/")}): \`morocco-communes\`, the data as typed ES modules, offline
- [Python package](${at("/docs/python/")}): \`morocco-communes\` on PyPI, every table as a pandas DataFrame, offline
- [Census figures](${at("/docs/indicators/")}): every census indicator from 2024 and 2014, with HCP's heading for it, its unit, its path and CSV column, and how to read it

## Data

- [Communes as JSON](${at("/data/v1/attributes/communes.json")}): every commune with its codes, names, population, area, density and a point inside it
- [Communes as CSV](${at("/data/v1/attributes/communes.csv")}): the same, flattened
- [Boundaries](${at("/data/v1/geometry/01.topojson")}): one TopoJSON file per région, 01 to 12, under ODbL
- [Boundaries as GeoJSON](${at("/data/v1/geometry/01.geojson")}): the same, one file per région; each commune's alone is at /api/communes/{code}/boundary.geojson
- [Province outlines](${at("/data/v1/geometry/provinces.geojson")}) and [région outlines](${at("/data/v1/geometry/regions.geojson")}): each dissolved from its communes; one alone is at /api/provinces/{code}/boundary.geojson or /api/regions/{code}/boundary.geojson
- [Arrondissements](${at("/data/v1/geometry/arrondissements.geojson")}): all 41, in Casablanca, Rabat, Fès, Marrakech, Salé and Tanger; a city's are at /api/communes/{code}/arrondissements.geojson
- [Census indicators as CSV](${at("/data/v1/indicators/people.csv")}): every unit's figures about people, and [households](${at("/data/v1/indicators/households.csv")}); [fields.json](${at("/data/v1/indicators/fields.json")}) names each field with HCP's heading, unit and notes
- [Establishments as CSV](${at("/data/v1/economy/establishments.csv")}): every unit's count of establishments, businesses, jobs and souks, with the businesses split by sector, size and when they were founded; [fields.json](${at("/data/v1/economy/fields.json")}) names each field with HCP's heading
- [Adjacency](${at("/data/v1/geometry/adjacency.csv")}): 4,134 pairs of communes that border, with the km they share; a contiguity graph for spatial work, under ODbL
- [2014 to 2024 crosswalk](${at("/data/v1/crosswalk/2014-2024.json")}): how the communes renumbered in 2015 were matched to their 2014 figures

## Optional

- [Source](${REPO_URL}): the pipeline, the API and this site
`;

  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
