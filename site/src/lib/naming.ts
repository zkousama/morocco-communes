/**
 * The numbers docs/names.astro gives about douar names, each read from the data or from the
 * code that decides it: how many douars each source names, the chance each matching pass found
 * with the communes swapped, what `pnpm translit --eval` measured, and how many visitors a
 * spelling needs. site/tests/naming.test.ts fails on any number typed into the page itself.
 */
import { readFileSync } from "node:fs";
import { MAX_CHANCE } from "../../../api/src/lib/douarPlaces.ts";
import { normalise } from "../../../api/src/lib/normalise.ts";
import { toLatin } from "../../../api/src/lib/spell.ts";
import { arabicKeys, lettersApart } from "../../../api/src/lib/translit.ts";
import type { WordTable } from "../../../api/src/lib/translitWords.ts";
import { VOTES } from "../../../api/src/worker/suggest.ts";
import { allDouars, allFractions } from "./douars.ts";

const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

interface Score {
  names: number;
  exact: number;
  withinALetter: number;
}
const scores = json<{ keysMeet: number; names: number; scores: Record<string, Score> }>("api/generated/translit-eval.json");
const score = (label: string) => {
  const found = scores.scores[label];
  if (!found) throw new Error(`api/generated/translit-eval.json has no "${label}"; run pnpm translit --eval`);
  return found;
};

const places = json<{ chance: number; nearChance: number; places: [string, string, ...unknown[]][] }>("api/data/douar-places.json");
const named = json<{ chance: number; names: [string, string][] }>("api/data/douar-names.json");
const table = json<WordTable>("api/generated/translit-words.json");

const bySource = (source: string) => allDouars.filter((d) => d.latin?.source === source).length;
const sourced = allDouars.filter((d) => d.latin).length;

// The Ministry's spelling against the map's, for each douar both name.
const flat = (s: string) => normalise(s).replace(/ /g, "");
const mapped = new Map(places.places.filter(([, name]) => name).map(([code, name]) => [code, flat(name)]));
const both = named.names.filter(([code]) => mapped.has(code)).map(([code, name]) => lettersApart(flat(name), mapped.get(code)!));

export const naming = {
  douars: allDouars.length,
  sourced,
  spelt: allDouars.length - sourced,
  education: bySource("education"),
  osm: bySource("osm"),
  geonames: bySource("geonames"),
  visitors: bySource("visitors"),
  /** The share each pass still finds with every commune swapped for another. */
  chance: { schools: named.chance, places: places.chance, near: places.nearChance, most: MAX_CHANCE },
  /** The douars the Ministry and a map both name, and the share where the 2 spell it alike. */
  agree: { douars: both.length, exact: both.filter((n) => n === 0).length / both.length },
  keysMeet: scores.keysMeet,
  hcpNames: scores.names,
  words: Object.keys(table.toLatin).length,
  rules: score("Douars to Latin, table and rules"),
  fractions: allFractions.length,
  fractionsNamed: allFractions.filter((f) => f.latin).length,
  outside: allFractions.filter((f) => f.label === "outside").length,
  notional: allFractions.filter((f) => f.label === "notional").length,
  votes: VOTES,
};

/** An Arabic name as the engine spells it, for the page's examples. */
export const spell = (arabic: string) => toLatin(arabic, table);

/** The consonants a name comes down to in either script (translit.ts), as the page shows them. */
export const consonantsOf = (arabic: string) => (arabicKeys(arabic)[0] ?? "").toUpperCase().split("");
