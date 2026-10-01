import type { APIRoute } from "astro";
import { allDouars } from "../../lib/douars";
import { communes } from "../../lib/places";

/**
 * Every douar's name, for the douars page to find one in the browser. A douar is its name,
 * its commune's place in `communes`, the rest of its code past the commune's and its people;
 * a commune is its slug, its French name and the start of its douars' codes. Both
 * languages load this one file, the first time someone types.
 */
export const GET: APIRoute = () => {
  const withDouars = new Set(allDouars.map((d) => d.communeCode));
  const listed = communes.filter((c) => withDouars.has(c.code));
  const index = new Map(listed.map((c, i) => [c.code, i]));
  const body = {
    communes: listed.map((c) => [c.slug, c.name.fr, c.codeDigits.slice(2)]),
    douars: allDouars.map((d) => [d.name.ar, index.get(d.communeCode)!, d.code.slice(7), d.population]),
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" } });
};
