/**
 * The last word on what a hypothesis may say. The models apply the policy in their
 * instructions: a reason may describe an action but never judge one, and it never names a
 * private person or generalises about an ethnic, religious or regional group. This file
 * catches a named person in code, and any private terms the run was given.
 */

export type Refusal = "individuals" | "groups" | "blame" | "terms";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Any of `words`, case aside, standing as a whole word. `\b` only knows ASCII letters, so
 * "ministère" would end at the è; a lookaround on any Unicode letter doesn't.
 */
const wholeWords = (words: string[]): RegExp =>
  new RegExp(`(?<!\\p{L})(?:${words.map((w) => escape(w).replace(/ /g, "\\s+")).join("|")})(?!\\p{L})`, "iu");

/** `terms`, as `refusal` matches them: whole words, case aside; null when there's nothing to match. */
export function termsPattern(terms: string[]): RegExp | null {
  return terms.length === 0 ? null : wholeWords(terms);
}

// Case matters here, since the name after the title is what makes it a person: "Mr Alami",
// "M. Alami", "the mayor, Ahmed Benali". Without the capital it's a role, not someone.
const HONORIFIC = String.raw`(?:(?:Mr|Mrs|Ms|Dr|Mme|Mlle)\.?|M\.)`;
const individuals = [
  new RegExp(String.raw`(?<!\p{L})${HONORIFIC}\s+\p{Lu}`, "u"),
  new RegExp(String.raw`(?<!\p{L})(?:[Tt]he\s+[Mm]ayor|[Tt]he\s+[Gg]overnor|[Ll]e\s+[Mm]aire|[Ll]e\s+[Gg]ouverneur)\s*,?\s+(?:${HONORIFIC}\s+)?\p{Lu}`, "u"),
];

/** Curly apostrophes read as straight ones, so "l’État" matches "l'État". */
const normalise = (text: string): string => text.replace(/[‘’ʼ]/g, "'");

/** Which rule `text` breaks: a private term first, then a named person; null when neither. The model applies the rest of the policy. */
export function refusal(text: string, terms: RegExp | null = null): Refusal | null {
  const t = normalise(text);
  if (terms && terms.test(t)) return "terms";
  if (individuals.some((pattern) => pattern.test(t))) return "individuals";
  return null;
}
