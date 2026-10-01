import type { APIRoute } from "astro";
import { readFileSync } from "node:fs";
import { allDouars } from "../../lib/douars";
import { communes } from "../../lib/places";
import { arabicKeys, lookupKey } from "../../../../api/src/lib/translit.ts";
import { toLatin } from "../../../../api/src/lib/spell.ts";
import type { WordTable } from "../../../../api/src/lib/translitWords.ts";

/**
 * Every douar's name, for the douars page to find one in the browser. A douar is its name,
 * its commune's place in `communes`, the rest of its code past the commune's, its people, a
 * Latin spelling worked out from the Arabic, and the keys a Latin query is matched on; a
 * commune is its slug, its French name and the start of its douars' codes. Both languages
 * load this one file, the first time someone types.
 */
const table = JSON.parse(readFileSync("api/generated/translit-words.json", "utf8")) as WordTable;
export const GET: APIRoute = () => {
  const withDouars = new Set(allDouars.map((d) => d.communeCode));
  const listed = communes.filter((c) => withDouars.has(c.code));
  const index = new Map(listed.map((c, i) => [c.code, i]));
  const body = {
    communes: listed.map((c) => [c.slug, c.name.fr, c.codeDigits.slice(2)]),
    douars: allDouars.map((d) => [
      d.name.ar,
      index.get(d.communeCode)!,
      d.code.slice(7),
      d.population,
      toLatin(d.name.ar, table),
      [...new Set(arabicKeys(d.name.ar).map(lookupKey))].join("|"),
    ]),
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" } });
};
