import type { Locale } from "../i18n/ui";

/** French groups thousands with a narrow space and writes a decimal comma; English, a comma and a point. */
export const numbers = (locale: Locale, digits = 0, fixed = false) =>
  new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    maximumFractionDigits: digits,
    ...(fixed ? { minimumFractionDigits: digits } : {}),
  });

/**
 * A percentage the way each language writes it: 12.8% in English, 12,8 % in French, with a
 * narrow no-break space before the sign. A minus is a real minus, not a hyphen.
 */
export function percent(locale: Locale, value: number, opts: { signed?: boolean; digits?: number; fixed?: boolean } = {}): string {
  const { signed = false, digits = 1, fixed = false } = opts;
  const body = numbers(locale, digits, fixed).format(Math.abs(value));
  const sign = value < 0 ? "−" : signed && value > 0 ? "+" : "";
  return locale === "fr" ? `${sign}${body} %` : `${sign}${body}%`;
}

/** People per km²: whole numbers from 100 up, where a decimal is noise, and one decimal below. */
export const density = (locale: Locale, value: number) => numbers(locale, value >= 100 ? 0 : 1).format(value);
