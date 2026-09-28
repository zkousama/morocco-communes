/**
 * The last word on what a hypothesis may say. The models apply the policy in their
 * instructions: a reason may describe an action but never judge one, and it never names a
 * private person or generalises about an ethnic, religious or regional group. This file
 * catches a named person in code, and any private terms the run was given.
 */

import type { Local } from "./model.ts";

export type Refusal = "individuals" | "groups" | "blame" | "terms";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Curly apostrophes read as straight ones, so "l’école" matches "l'école". */
const normalise = (text: string): string => text.replace(/[‘’ʼ]/g, "'");

/**
 * Any of `words`, case aside, standing as a whole word, each run of whitespace inside one
 * matching any run in the text. `\b` only knows ASCII letters, so "école" would end at the é;
 * a lookaround on any Unicode letter doesn't.
 */
const wholeWords = (words: string[]): RegExp =>
  new RegExp(`(?<!\\p{L})(?:${words.map((w) => escape(w).replace(/\s+/g, "\\s+")).join("|")})(?!\\p{L})`, "iu");

/**
 * `terms`, as `refusal` matches them: whole words, case aside. Each term is read the way the
 * text is (curly apostrophes as straight ones) and trimmed, so one typed with a curly
 * apostrophe or an extra space still matches, and a blank one is dropped rather than
 * matching everything. Null when there's nothing left to match.
 */
export function termsPattern(terms: string[]): RegExp | null {
  const cleaned = terms.map((term) => normalise(term).trim()).filter((term) => term.length > 0);
  return cleaned.length === 0 ? null : wholeWords(cleaned);
}

// Case matters here, since the name after the title is what makes it a person: "Mr Alami",
// "M. Alami", "the mayor, Ahmed Benali". Without the capital it's a role, not someone.
const HONORIFIC = String.raw`(?:(?:Mr|Mrs|Ms|Dr|Mme|Mlle)\.?|M\.)`;
const individuals = [
  new RegExp(String.raw`(?<!\p{L})${HONORIFIC}\s+\p{Lu}`, "u"),
  new RegExp(String.raw`(?<!\p{L})(?:[Tt]he\s+[Mm]ayor|[Tt]he\s+[Gg]overnor|[Ll]e\s+[Mm]aire|[Ll]e\s+[Gg]ouverneur)\s*,?\s+(?:${HONORIFIC}\s+)?\p{Lu}`, "u"),
];

/** Which rule `text` breaks: a private term first, then a named person; null when neither. The model applies the rest of the policy. */
export function refusal(text: string, terms: RegExp | null = null): Refusal | null {
  const t = normalise(text);
  if (terms && terms.test(t)) return "terms";
  if (individuals.some((pattern) => pattern.test(t))) return "individuals";
  return null;
}

/**
 * The line a run warns with about the private backstop, or null when there's nothing to
 * warn about. `local` is null when `INSIGHTS_LOCAL` isn't set at all; a folder that's set but
 * whose `terms.txt` is missing or empty reads no differently from that, since either way the
 * run has no private terms, so it warns too, under its own wording that names no path.
 */
export function localWarning(local: Local | null): string | null {
  if (!local) return "insights: INSIGHTS_LOCAL isn't set, so no private terms are checked";
  if (local.terms.length === 0) return "insights: no private terms are checked";
  return null;
}
