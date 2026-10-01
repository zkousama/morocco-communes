/**
 * The links under a commune's headline numbers, one to each of the page's sections, named
 * by the section's own heading. Where it is and In the data are on every commune's page;
 * the rest only where there are figures for them.
 */
import { places } from "../i18n/places";
import type { Locale } from "../i18n/ui";

export interface Has {
  change: boolean;
  people: boolean;
  dwellings: boolean;
  work: boolean;
  urbanCentres: boolean;
  arrondissements: boolean;
  neighbourhoods: boolean;
}

/** In the page's order. Each id is the one its section carries. */
export function contentsOf(locale: Locale, has: Has): { id: string; label: string }[] {
  const p = places[locale];
  return [
    { id: "where", label: p.where, shown: true },
    { id: "change", label: p.howItChanged, shown: has.change },
    { id: "people", label: p.people, shown: has.people },
    { id: "dwellings", label: p.dwellingsTitle, shown: has.dwellings },
    { id: "work", label: p.work, shown: has.work },
    { id: "urban-centres", label: p.urbanCentres, shown: has.urbanCentres },
    { id: "arrondissements", label: p.arrondissements, shown: has.arrondissements },
    { id: "neighbourhoods", label: p.neighbourhoods, shown: has.neighbourhoods },
    { id: "data", label: p.inTheData, shown: true },
  ]
    .filter((s) => s.shown)
    .map(({ id, label }) => ({ id, label }));
}
