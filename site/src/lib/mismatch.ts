/**
 * How a place's page and the docs say which of its figures the two censuses disagree on.
 * The flags themselves come from the API's check, so the page, the docs and the API agree.
 */
import type { Mismatch } from "../../../api/src/lib/mismatch.ts";
import { fill, places } from "../i18n/places.ts";
import type { Locale } from "../i18n/ui.ts";
import { percent } from "./format.ts";

const isLanguage = (path: string) => path.startsWith("localLanguages.");

/** A language is a name; an amenity reads in lower case inside a sentence. */
const nameIn = (locale: Locale, path: string) => {
  const p = places[locale];
  const key = path.split(".")[1]!;
  const names = (isLanguage(path) ? p.languageNames : p.mismatchNames) as Record<string, string>;
  return names[isLanguage(path) ? key : path] ?? path;
};

/** The figure as a table cell or a heading has it: capitalised. */
export function figureName(locale: Locale, path: string): string {
  const name = nameIn(locale, path);
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

/** One note for every flagged figure, or null when the censuses agree. */
export function mismatchNote(locale: Locale, flags: Mismatch[]): string | null {
  if (flags.length === 0) return null;
  const p = places[locale];
  const share = (v: number) => percent(locale, v, { fixed: true });
  return fill(p.mismatch, {
    figures: flags
      .map((m) => fill(p.mismatchFigure, { figure: nameIn(locale, m.path), then: share(m.then), now: share(m.now) }))
      .join(p.mismatchJoin),
  });
}

/**
 * Where the note goes: under the languages if one is flagged, since that's what it's mostly
 * about; otherwise under the headline figures, where running water is.
 */
export function noteUnder(flags: Mismatch[]): "languages" | "figures" {
  return flags.some((m) => isLanguage(m.path)) ? "languages" : "figures";
}
