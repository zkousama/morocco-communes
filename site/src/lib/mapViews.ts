/**
 * How the home map shades a commune. The breaks are round numbers a reader can hold,
 * the same way the illiteracy classes are tens. A flagged figure is left out of its own
 * view only. Tram and train use the same 1% bar as the only-here lines.
 */

/** Households with running water, in percent. */
export const WATER_BREAKS = [20, 40, 60, 80, 95];
/** People aged 65 and over, in percent. The shares sit in a narrow band, so the steps are smaller than tens. */
export const ELDERLY_BREAKS = [5, 8, 10, 12, 15];
/** Women aged 10 and over who can't read or write, in percent. */
export const WOMEN_BREAKS = [30, 40, 50, 60, 70];
/** Unemployment, in percent of the labour force. */
export const UNEMPLOYMENT_BREAKS = [10, 20, 30, 40, 50];

/** At least this share of workers, in percent, and at least this many people. The only-here lines use the same pair. */
export const SERVICE_SHARE = 1;
export const SERVICE_PEOPLE = 1000;

/** The class a value falls in, or "n" when there is no figure. */
export function classOf(value: number | null, breaks: number[]): string {
  if (value === null) return "n";
  const i = breaks.findIndex((b) => value < b);
  return String(i < 0 ? breaks.length : i);
}

/** classOf, with a flagged figure treated as no figure. */
export function shadeOf(value: number | null, breaks: number[], flagged: boolean): string {
  return classOf(flagged ? null : value, breaks);
}

/**
 * "t" tram only, "r" train only, "b" both, "0" neither, "n" when both figures are missing.
 * A commune with both keeps both colours, so the two are not folded into one class.
 */
export function serviceOf(tram: number | null, train: number | null, population: number): "t" | "r" | "b" | "0" | "n" {
  if (tram === null && train === null) return "n";
  const on = (value: number | null) => value !== null && value >= SERVICE_SHARE && population >= SERVICE_PEOPLE;
  const tramOn = on(tram);
  const trainOn = on(train);
  if (tramOn && trainOn) return "b";
  if (tramOn) return "t";
  if (trainOn) return "r";
  return "0";
}

/** How many communes meet the bar on each, a commune with both counted twice. */
export function serviceCounts(rows: { tram: number | null; train: number | null; population: number }[]): { tram: number; train: number } {
  let tram = 0;
  let train = 0;
  for (const row of rows) {
    if (row.population < SERVICE_PEOPLE) continue;
    if (row.tram !== null && row.tram >= SERVICE_SHARE) tram++;
    if (row.train !== null && row.train >= SERVICE_SHARE) train++;
  }
  return { tram, train };
}
