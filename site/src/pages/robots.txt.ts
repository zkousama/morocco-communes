import type { APIRoute } from "astro";

/**
 * The pages are for search engines; the API's JSON isn't, and there are thousands of
 * files of it. The OpenAPI document stays open, since it describes the whole API.
 */
export const GET: APIRoute = ({ site }) => {
  const lines = ["User-agent: *", "Allow: /", "Disallow: /api/", "Allow: /api/openapi.json", "Disallow: /mcp"];
  if (site) lines.push("", `Sitemap: ${new URL("/sitemap.xml", site).href}`);
  return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
