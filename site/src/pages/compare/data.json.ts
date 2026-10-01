import type { APIRoute } from "astro";
import { compareData } from "../../lib/compareData";

/** Every compared commune's figures, for the compare page to draw in the browser. Both languages load this one file. */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(compareData()), { headers: { "content-type": "application/json; charset=utf-8" } });
