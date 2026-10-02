/**
 * Douar names as the Ministry of National Education writes them in its lists of public
 * schools. Each school is given in both scripts with its commune, and a rural school is
 * named after the douar it serves, or has it in its address: École Ouled Taleb, DOUAR
 * OULED TALEB COMMUNE SIDI TAIBI beside دوار اولاد الطالب. Where the Arabic is a douar of
 * that commune, letter for letter once normalised, and the Latin beside it is a spelling of
 * it, the Latin is the douar's name as the Ministry writes it.
 */
import { normalise } from "./normalise.ts";
import { douarNameOf } from "./douarPlaces.ts";
import { arabicKeys, keysMeet, latinKeys } from "./translit.ts";

export interface School {
  /** Its name and address, in Latin and in Arabic. */
  name: { fr: string; ar: string };
  address: { fr: string; ar: string };
  /** The commune it's in, by code, where the list's commune could be placed. */
  commune: string | null;
}

const squash = (s: string) => normalise(s).replace(/ /g, "");

const after = (text: string, start: RegExp, stop: RegExp) => {
  const m = text.match(start);
  return m ? m[1]!.replace(stop, "").trim() : "";
};

/** The douar an address names: what follows DOUAR, up to the commune or the caïdat. */
export const addressDouar = {
  fr: (address: string) => after(address, /\bdouar\s+(.+)$/i, /\s+(commune|cr|c\.r|c\/r|ccr|caidat|caïdat|cercle)\b.*$/i),
  ar: (address: string) => after(address, /دوار\s*(.+)$/, /\s+(جماعة|ج\/|ج\.|الجماعة|قيادة|دائرة)\s*.*$/),
};

/** The Ministry writes names in capitals with stray spaces: OULED  SIDI ABDENNEBI is Ouled Sidi Abdennebi. */
export function tidy(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

/** The (Latin, Arabic) pairs a school gives for its douar: from its name, and from its address. */
export function pairsOf(school: School): [latin: string, arabic: string][] {
  const pairs: [string, string][] = [
    [douarNameOf(school.name.fr, false), douarNameOf(school.name.ar, false)],
    [addressDouar.fr(school.address.fr), addressDouar.ar(school.address.ar)],
  ];
  return pairs.filter(([fr, ar]) => fr.length > 1 && ar.length > 1 && keysMeet(arabicKeys(ar), latinKeys(fr)));
}

/**
 * Each douar a school names, with its Latin name, the first school's to name it. `decoy`,
 * when given, swaps a school's commune for another, so a match then is chance.
 */
export function nameDouars(
  schools: readonly School[],
  douarsIn: Map<string, { code: string; name: { ar: string } }[]>,
  decoy?: (commune: string) => string,
): Map<string, string> {
  const byName = new Map<string, Map<string, string[]>>();
  for (const [commune, list] of douarsIn) {
    const names = new Map<string, string[]>();
    for (const d of list) names.set(squash(d.name.ar), [...(names.get(squash(d.name.ar)) ?? []), d.code]);
    byName.set(commune, names);
  }
  const named = new Map<string, string>();
  for (const school of schools) {
    if (!school.commune) continue;
    const names = byName.get(decoy ? decoy(school.commune) : school.commune);
    if (!names) continue;
    for (const [fr, ar] of pairsOf(school)) {
      // A name 2 douars of the commune share names neither.
      const codes = names.get(squash(ar));
      if (codes?.length === 1 && !named.has(codes[0]!)) named.set(codes[0]!, tidy(fr));
    }
  }
  return named;
}
