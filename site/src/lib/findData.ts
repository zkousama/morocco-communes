/**
 * What the header's search is handed at build time: the few facts about the dataset it
 * needs to place a hit, and the most looked-up places it offers before anything is typed.
 */
import { path, t, type Locale } from "../i18n/ui";
import { rowOf, type Hit, type Places, type Row } from "./find";
import {
  arrondissementOf,
  arrondissements,
  communeOf,
  communes,
  provinceOf,
  provinces,
  regionOf,
  regions,
  sharedNames,
} from "./places";

export const placesFor = (locale: Locale): Places => ({
  base: {
    commune: path(locale, "communes/"),
    province: path(locale, "provinces/"),
    region: path(locale, "regions/"),
  },
  regions: Object.fromEntries(regions.map((r) => [r.code, r.name.fr])),
  cities: Object.fromEntries(
    [...new Set(arrondissements.map((a) => a.communeCode))].flatMap((code) => {
      const city = communeOf.get(code);
      return city ? [[code, { slug: city.slug, name: city.name.fr }]] : [];
    }),
  ),
  prefectures: provinces.filter((p) => p.type !== "province").map((p) => p.code),
  shared: Object.fromEntries(
    communes
      .filter((c) => sharedNames.has(c.name.fr))
      .flatMap((c) => {
        const province = provinceOf.get(c.parents.province);
        return province ? [[c.code, province.name.fr]] : [];
      }),
  ),
});

/** A code from the ranking as the search would have returned it, or null if it has no page. */
const hitOf = (code: string): Hit | null => {
  const commune = communeOf.get(code);
  if (commune) return { code, level: "commune", name: commune.name, slug: commune.slug };
  const arrondissement = arrondissementOf.get(code);
  if (arrondissement) return { code, level: "arrondissement", name: arrondissement.name, slug: "" };
  const province = provinceOf.get(code);
  if (province) return { code, level: "province", name: province.name, slug: province.slug };
  const region = regionOf.get(code);
  if (region) return { code, level: "region", name: region.name, slug: region.slug };
  return null;
};

/** The first few places of the month's ranking that still have a page, as rows. */
export const shortcuts = (locale: Locale, ranking: { code: string }[], limit = 5): Row[] => {
  const places = placesFor(locale);
  const levels = t(locale).findLevels;
  return ranking
    .map(({ code }) => hitOf(code))
    .map((hit) => (hit ? rowOf(hit, places, levels) : null))
    .filter((row) => row !== null)
    .slice(0, limit);
};
