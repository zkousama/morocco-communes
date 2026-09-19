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

> Open dataset and HTTP API for Morocco's administrative divisions: ${counts.regions} régions, ${counts.provinces} provinces and préfectures, ${counts.cercles} cercles, ${n.format(counts.communes)} communes and ${counts.arrondissements} arrondissements. Official HCP geographic codes, names in French and Arabic, population from the 2024 and 2014 censuses, and boundaries from OpenStreetMap. Free to call, no key, CORS open.

An identifier can be written 4 ways and all resolve to one unit: \`01.511.01.0\`, \`001511010\`, \`1511010\` or the slug \`tanger\`. Every response is an envelope of \`data\`, \`meta\` and \`links\`, and errors are RFC 9457 problem documents. Routes ending in \`.json\` are static files.

## API

- [OpenAPI spec](${at("/api/openapi.json")}): every route, parameter, limit and response shape
- [MCP server](${at("/mcp")}): Streamable HTTP, no key, with the tools search, get_commune, communes_near and list_communes
- [Search](${at("/api/search?q=tanger")}): any unit by French or Arabic name, by slug, or by another name it goes by
- [Nearby](${at("/api/communes/near?lat=33.5731&lng=-7.5898&radius=15")}): communes within a radius of a point, nearest first
- [One commune](${at("/api/communes/tanger")}): by any spelling of its identifier
- [Filtered list](${at("/api/communes?province=01.511")}): communes by région, province, cercle or type, 50 to a page
- [Version](${at("/api/version.json")}): dataset version, record counts and when each source was read

## Docs

- [API reference](${at("/docs/api/")}): every route with a real response, and what each error means
- [MCP setup](${at("/docs/mcp/")}): how to connect Claude, ChatGPT, Cursor, VS Code and the Claude and OpenAI APIs
- [Components](${at("/docs/components/")}): a région, province and commune picker for forms, in HTML or React
- [npm package](${at("/docs/npm/")}): \`morocco-communes\`, the data as typed ES modules, offline

## Data

- [Communes as JSON](${at("/data/v1/attributes/communes.json")}): every commune with its codes, names, population and a point inside it
- [Communes as CSV](${at("/data/v1/attributes/communes.csv")}): the same, flattened
- [Boundaries](${at("/data/v1/geometry/01.topojson")}): one TopoJSON file per région, 01 to 12, under ODbL
- [2014 to 2024 crosswalk](${at("/data/v1/crosswalk/2014-2024.json")}): how the communes renumbered in 2015 were matched to their 2014 figures

## Optional

- [Source](${REPO_URL}): the pipeline, the API and this site
`;

  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
