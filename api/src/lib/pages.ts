/**
 * The page on the site each place has, for an answer that links to one. The site works
 * the same routes out from data/v1 when it's built (pageOf in site/src/lib/places.ts), and
 * a test holds the two to each other for every place in the index.
 */
import type { SearchIndex } from "./search.ts";

export interface Page {
  name: string;
  /** Its name in Arabic, which the Arabic site leads with. */
  ar: string;
  route: string;
}

const FOLDERS: Partial<Record<string, string>> = { commune: "communes", province: "provinces", region: "regions" };

/** Every place with a page, by code. A cercle has none, so it's left out. */
export function pagesOf(index: SearchIndex, arrondissements: { code: string; communeCode: string }[]): Map<string, Page> {
  const pages = new Map<string, Page>();
  for (const [code, level, name, ar, slug] of index.entries) {
    const folder = FOLDERS[level];
    if (folder) pages.set(code, { name, ar, route: `${folder}/${slug}/` });
  }
  // An arrondissement has no page of its own, so it keeps its name and links to its city's.
  const names = new Map(index.entries.map(([code, , name, ar]) => [code, { name, ar }]));
  for (const { code, communeCode } of arrondissements) {
    const city = pages.get(communeCode);
    const own = names.get(code);
    if (city && own) pages.set(code, { ...own, route: city.route });
  }
  return pages;
}
