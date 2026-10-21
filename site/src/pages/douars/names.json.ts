import type { APIRoute } from "astro";
import { douarNames } from "../../lib/douars";
import { communes } from "../../lib/places";


/**
 * Every douar's name (douarNames in lib/douars.ts), for the douars page to find one in the
 * browser and for /api/douars/search and the MCP server's search_douars. Every language
 * loads this one file, the first time someone types.
 */

export const GET: APIRoute = () => {
  const body = douarNames(communes);
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" } });
};
