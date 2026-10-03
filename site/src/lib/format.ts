import type { Locale } from "../i18n/ui";
import { INTL } from "./intl.ts";

/**
 * French groups thousands with a narrow space and writes a decimal comma; English, a comma
 * and a point; Arabic, as Morocco writes it, a point and a comma, in Western digits.
 */
export const numbers = (locale: Locale, digits = 0, fixed = false) =>
  new Intl.NumberFormat(INTL[locale], {
    maximumFractionDigits: digits,
    ...(fixed ? { minimumFractionDigits: digits } : {}),
  });

/**
 * A sign in front of a number in Arabic. A minus or a plus has no direction of its own, so
 * in right-to-left text it lands after the number; a left-to-right mark before it keeps the
 * sign, the digits and the unit together, reading −12,8%.
 */
export const signedIn = (locale: Locale, text: string) => (locale === "ar" && /^[−+-]/.test(text) ? `‎${text}` : text);

/**
 * A percentage the way each language writes it: 12.8% in English, 12,8 % in French, with a
 * narrow no-break space before the sign, 12,8% in Arabic. A minus is a real minus, not a hyphen.
 * In Arabic the sign sits between 2 left-to-right marks, as Intl writes it for ar-MA: after
 * an Arabic word the browser would otherwise draw it on the other side of the digits, %12,8.
 */
export function percent(locale: Locale, value: number, opts: { signed?: boolean; digits?: number; fixed?: boolean } = {}): string {
  const { signed = false, digits = 1, fixed = false } = opts;
  const body = numbers(locale, digits, fixed).format(Math.abs(value));
  const sign = value < 0 ? "−" : signed && value > 0 ? "+" : "";
  if (locale === "ar") return signedIn(locale, `${sign}${body}\u200E%\u200E`);
  return locale === "fr" ? `${sign}${body}\u202f%` : `${sign}${body}%`;
}

/** People per km²: whole numbers from 100 up, where a decimal is noise, and one decimal below. */
export const density = (locale: Locale, value: number) => numbers(locale, value >= 100 ? 0 : 1).format(value);

/**
 * A range of 2 numbers. A dash has no direction of its own, so in right-to-left text 70–74
 * would draw as 74–70; a left-to-right mark after the first number keeps the range reading
 * the way HCP's Arabic tables print it.
 */
export const span = (locale: Locale, from: string, to: string) => `${from}${locale === "ar" ? "\u200E" : ""}–${to}`;

/** The comma between the items of a list written out in a sentence. */
export const listComma = (locale: Locale) => (locale === "ar" ? "، " : ", ");

/** The arrow between a figure and what it became, pointing the way the text runs. */
export const becomes = (locale: Locale) => (locale === "ar" ? "←" : "→");

/** The forms a counted noun takes. English and French write 2; Arabic writes up to 5. */
export type Forms = { one: string; other: string } & Partial<Record<"two" | "few" | "many", string>>;

/**
 * A count with its noun, in the form the language gives it: Arabic has one for 1, one for
 * 2, one for 3 to 10 and one for 11 to 99, and falls back on `other` where none is written.
 */
export function counted(locale: Locale, forms: Forms, value: number): string {
  const form = new Intl.PluralRules(INTL[locale]).select(value);
  const text = (form === "zero" ? undefined : forms[form]) ?? forms.other;
  return text.replace("{n}", numbers(locale).format(value));
}
