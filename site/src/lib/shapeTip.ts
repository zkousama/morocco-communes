/**
 * The lines under a commune's name on a place map's card, the same ones the home map's
 * card starts with: urban or rural, its people, its density. Worked out at build time and
 * written onto the shape, so the page's script only has to show them.
 */
import { t, type Locale } from "../i18n/ui";
import { density, numbers } from "./format";

/** A commune, or an arrondissement, which has no urban or rural of its own. */
interface Place {
  type?: "urban" | "rural";
  population: { "2024": { total: number } };
  density: number | null;
}

export function shapeLines(locale: Locale, place: Place): string[] {
  const copy = t(locale);
  const lines: string[] = [];
  if (place.type) lines.push(place.type === "urban" ? copy.urban : copy.rural);
  lines.push(`${numbers(locale).format(place.population["2024"].total)} ${copy.tipPeople}`);
  if (typeof place.density === "number") lines.push(`${density(locale, place.density)} ${copy.tipDensity}`);
  return lines;
}
