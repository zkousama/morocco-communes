/**
 * Which of a place's 2 names a page leads with. HCP writes every unit in Latin letters and
 * in Arabic; the Arabic site leads with the Arabic one and sets the Latin beside it, and
 * the English and French sites do the reverse. Nothing here reads a file, so the browser's
 * scripts use it too.
 */
import type { Locale } from "../i18n/ui";

export interface Names {
  fr: string;
  ar?: string | null;
}

/** The name the page's language leads with. A unit with no Arabic name keeps its Latin one. */
export const nameIn = (locale: Locale, name: Names): string => (locale === "ar" && name.ar ? name.ar : name.fr);

/** The other name, set beside the first, or nothing where the unit has only one. */
export const nameBeside = (locale: Locale, name: Names): string | undefined => {
  if (!name.ar) return undefined;
  return locale === "ar" ? name.fr : name.ar;
};

/** The language and direction of the name set beside the first, for its element. */
export const besideIn = (locale: Locale) => (locale === "ar" ? ({ lang: "fr", dir: "ltr" } as const) : ({ lang: "ar", dir: "rtl" } as const));

/** Orders units by the name the page leads with, as its language sorts. */
export function byNameIn<T extends { name: Names }>(locale: Locale): (a: T, b: T) => number {
  const collator = new Intl.Collator(locale === "ar" ? "ar" : "fr");
  return (a, b) => collator.compare(nameIn(locale, a.name), nameIn(locale, b.name));
}
