/**
 * The page on the site each place has, for an answer that links to one. The site works
 * the same routes out from data/v1 when it's built (pageOf in site/src/lib/places.ts), and
 * a test holds the two to each other for every place in the index.
 */
import type { SearchIndex } from "./search.ts";

export interface Page {
  name: string;
  route: string;
}

const FOLDERS: Partial<Record<string, string>> = { commune: "communes", province: "provinces", region: "regions" };

/** Every place with a page, by code. A cercle has none, so it's left out. */
export function pagesOf(index: SearchIndex, arrondissements: { code: string; communeCode: string }[]): Map<string, Page> {
  const pages = new Map<string, Page>();
  for (const [code, level, name, , slug] of index.entries) {
    const folder = FOLDERS[level];
    if (folder) pages.set(code, { name, route: `${folder}/${slug}/` });
  }
  // An arrondissement has no page of its own, so it keeps its name and links to its city's.
  const names = new Map(index.entries.map(([code, , name]) => [code, name]));
  for (const { code, communeCode } of arrondissements) {
    const city = pages.get(communeCode);
    const name = names.get(code);
    if (city && name) pages.set(code, { name, route: city.route });
  }
  return pages;
}
