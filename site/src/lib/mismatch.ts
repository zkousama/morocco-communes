/**
 * How a place's page and the docs speak of the figures the site keeps out of comparisons.
 * The flags themselves come from the API's check, so the page, the docs and the API agree.
 *
 * The two kinds get their own notes. A language share that far apart can't describe the
 * same people twice, so its note says the censuses don't line up. An amenity's fall can be
 * real, so its note states the fall and says nothing about why.
 */
import { AMENITIES, LANGUAGES, type Mismatch } from "../../../api/src/lib/mismatch.ts";
import { fill, places } from "../i18n/places.ts";
import type { Locale } from "../i18n/ui.ts";
import { percent } from "./format.ts";

/**
 * The provinces the September 2023 earthquake affected. The 2024 census came a year later,
 * and found families there still in temporary housing.
 */
export const QUAKE_PROVINCES = ["07.041", "09.541", "05.081", "07.161", "07.351", "08.401"];

export const afterQuake = (code: string) => QUAKE_PROVINCES.some((province) => code.startsWith(`${province}.`));

const nameIn = (locale: Locale, path: string) => {
  const p = places[locale];
  return LANGUAGES.includes(path)
    ? ((p.languageNames as Record<string, string>)[path.split(".")[1]!] ?? path)
    : ((p.mismatchNames as Record<string, string>)[path] ?? path);
};

/** The figure as a table cell has it: capitalised. */
export function figureName(locale: Locale, path: string): string {
  const name = nameIn(locale, path);
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

const shareIn = (locale: Locale) => (v: number) => percent(locale, v, { fixed: true });

/** The note under the languages, or null when none is flagged. */
export function languageNote(locale: Locale, flags: Mismatch[]): string | null {
  const languages = flags.filter((m) => LANGUAGES.includes(m.path));
  if (languages.length === 0) return null;
  const p = places[locale];
  const share = shareIn(locale);
  return fill(p.mismatch, {
    figures: languages
      .map((m) => fill(p.mismatchFigure, { language: nameIn(locale, m.path), then: share(m.then), now: share(m.now) }))
      .join(p.mismatchJoin),
  });
}

/** The note under the headline figures, or null when no amenity is flagged. */
export function amenityNote(locale: Locale, flags: Mismatch[], code: string): string | null {
  const amenities = flags.filter((m) => AMENITIES.includes(m.path));
  if (amenities.length === 0) return null;
  const p = places[locale];
  const share = shareIn(locale);
  const moved = p.moved as Record<string, string>;
  const figures = amenities
    .map((m) => fill(p.fellFigure, { what: moved[m.path]!, then: share(m.then), now: share(m.now) }))
    .join(p.mismatchJoin);
  return [
    fill(p.fell, { figures }),
    amenities.length === 1 ? p.fellRare : p.fellRareMany,
    afterQuake(code) ? p.fellQuake : null,
  ]
    .filter(Boolean)
    .join(" ");
}
