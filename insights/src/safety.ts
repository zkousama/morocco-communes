/**
 * The last word on what a hypothesis may say. The prompts already rule out claims about
 * individuals, about ethnic or religious groups, and blame on a political actor; this word
 * list catches what a model lets through anyway. A match only ever drops a hypothesis, so
 * a word that's sometimes innocent costs one candidate, never a published claim.
 */

type Refusal = "individuals" | "groups" | "political";

/**
 * Each listed word, with the plurals and feminines that mean the same thing. A bare "parti"
 * is also how French says someone left ("il est parti vers la ville"), the commonest reason
 * offered for a change, so a party is caught by name or as "parti politique".
 */
const POLITICAL = [
  "government", "governments", "ministry", "ministries", "minister", "ministers", "mayor's decision",
  "parliament", "parliaments", "party", "parties", "PJD", "RNI", "PAM", "Istiqlal", "USFP", "makhzen",
  "palace", "palaces", "corruption",
  "gouvernement", "gouvernements", "ministère", "ministères", "ministre", "ministres",
  "parti politique", "partis politiques", "négligence de l'État",
];

// "arabe" and "berbère" in the singular also name a language in French ("l'arabe"), and a
// language named as a language isn't a group, so only their plurals are listed. The Sahara
// is a place, so only the words for its people are, never "Sahara" or "Saharan".
const GROUPS = [
  "berber", "berbers", "amazigh people", "arab", "arabs", "jew", "jews", "jewish", "muslim", "muslims",
  "christian", "christians", "sub-saharan", "subsaharan", "migrant", "migrants", "refugee", "refugees",
  "sahrawi", "sahrawis", "tribe", "tribes",
  "berbères", "arabes", "juif", "juifs", "juive", "juives", "musulman", "musulmans", "musulmane",
  "musulmanes", "chrétien", "chrétiens", "chrétienne", "chrétiennes", "subsaharien", "subsahariens",
  "subsaharienne", "subsahariennes", "sub-saharien", "sub-sahariens", "migrante", "migrantes",
  "réfugié", "réfugiés", "réfugiée", "réfugiées", "sahraoui", "sahraouis", "sahraouie", "sahraouies",
  "tribu", "tribus",
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Any of `words`, case aside, standing as a whole word. `\b` only knows ASCII letters, so
 * "ministère" would end at the è; a lookaround on any Unicode letter doesn't.
 */
const wholeWords = (words: string[]): RegExp =>
  new RegExp(`(?<!\\p{L})(?:${words.map((w) => escape(w).replace(/ /g, "\\s+")).join("|")})(?!\\p{L})`, "iu");

const political = wholeWords(POLITICAL);
const groups = wholeWords(GROUPS);

// Case matters here, since the name after the title is what makes it a person: "Mr Alami",
// "M. Alami", "the mayor, Ahmed Benali". Without the capital it's a role, not someone.
const HONORIFIC = String.raw`(?:(?:Mr|Mrs|Ms|Dr|Mme|Mlle)\.?|M\.)`;
const individuals = [
  new RegExp(String.raw`(?<!\p{L})${HONORIFIC}\s+\p{Lu}`, "u"),
  new RegExp(String.raw`(?<!\p{L})(?:[Tt]he\s+[Mm]ayor|[Tt]he\s+[Gg]overnor|[Ll]e\s+[Mm]aire|[Ll]e\s+[Gg]ouverneur)\s*,?\s+(?:${HONORIFIC}\s+)?\p{Lu}`, "u"),
];

/** Curly apostrophes read as straight ones, so "l’État" matches "l'État". */
const normalise = (text: string): string => text.replace(/[‘’ʼ]/g, "'");

/** Which rule `text` breaks, checked political, then groups, then individuals; null when none. */
export function refusal(text: string): Refusal | null {
  const t = normalise(text);
  if (political.test(t)) return "political";
  if (groups.test(t)) return "groups";
  if (individuals.some((pattern) => pattern.test(t))) return "individuals";
  return null;
}
