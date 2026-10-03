import type { Locale } from "../i18n/ui";

/** The tag Intl formats numbers and plurals by. Morocco writes Arabic with Western digits: 1.503 and 12,8. */
export const INTL: Record<Locale, string> = { en: "en-GB", fr: "fr-FR", ar: "ar-MA" };
