/**
 * Moroccan names between Arabic and Latin, by rule and by the word table. No model, no
 * network.
 *
 *   pnpm translit تيݣراو "Ouled Said"   each name in the other script, and its keys
 *   pnpm translit --table               rebuild the word table from the dataset's pairs
 *   pnpm translit --eval                how well each part does on pairs held back from it
 *
 * The pairs are every unit HCP names in both scripts, and the neighbourhoods OpenStreetMap
 * names in both.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { normalise } from "../src/lib/normalise.ts";
import { arabicKeys, keysMeet, latinKeys } from "../src/lib/translit.ts";
import { buildWordTable, type WordTable } from "../src/lib/translitWords.ts";
import { toArabic, toLatin } from "../src/lib/spell.ts";

const TABLE = "api/generated/translit-words.json";
const LEVELS = ["regions", "provinces", "cercles", "communes", "arrondissements"];

type Pair = { fr: string; ar: string };
const units = (): Pair[] =>
  LEVELS.flatMap((level) => JSON.parse(readFileSync(`data/v1/attributes/${level}.json`, "utf8")) as { name: { fr: string; ar: string | null } }[])
    .filter((u) => u.name.fr && u.name.ar)
    .map((u) => ({ fr: u.name.fr, ar: u.name.ar! }));
const neighbourhoods = (): Pair[] =>
  (JSON.parse(readFileSync("api/data/neighbourhoods.json", "utf8")) as { places: [string, string, ...unknown[]][] }).places
    .filter(([fr, ar]) => fr && ar)
    .map(([fr, ar]) => ({ fr, ar }));

const isArabic = (text: string) => /\p{Script=Arabic}/u.test(text);

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

function evaluate(): void {
  // A fixed shuffle, so a run compares with the last one.
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const all = units();
  const shuffled = all.map((p) => ({ p, r: random() })).sort((a, b) => a.r - b.r).map(({ p }) => p);
  const held = shuffled.slice(0, Math.floor(all.length / 5));
  const table = buildWordTable([...shuffled.slice(held.length), ...neighbourhoods()]);

  const met = all.filter((p) => keysMeet(arabicKeys(p.ar), latinKeys(p.fr))).length;
  console.log(`keys meet: ${met} of ${all.length} names, ${((met / all.length) * 100).toFixed(1)}%`);
  const flat = (s: string) => normalise(s).replace(/ /g, "");
  const score = (label: string, spell: (p: Pair) => string, truth: (p: Pair) => string) => {
    let exact = 0;
    let wrong = 0;
    let length = 0;
    for (const p of held) {
      const guess = flat(spell(p));
      const right = flat(truth(p));
      if (guess === right) exact++;
      wrong += distance(guess, right);
      length += right.length;
    }
    console.log(`${label}: ${((exact / held.length) * 100).toFixed(1)}% exactly as HCP writes it, ${((wrong / length) * 100).toFixed(1)}% of letters off, on ${held.length} names held back`);
  };
  score("Arabic to Latin", (p) => toLatin(p.ar, table), (p) => p.fr);
  score("Latin to Arabic", (p) => toArabic(p.fr, table), (p) => p.ar);
}

const args = process.argv.slice(2);
if (args[0] === "--table") {
  const table = buildWordTable([...units(), ...neighbourhoods()]);
  writeFileSync(TABLE, `${JSON.stringify(table)}\n`);
  console.log(`translit: ${Object.keys(table.toLatin).length} Arabic words and ${Object.keys(table.toArabic).length} Latin ones, to ${TABLE}`);
} else if (args[0] === "--eval") {
  evaluate();
} else if (args.length > 0) {
  const table = JSON.parse(readFileSync(TABLE, "utf8")) as WordTable;
  for (const name of args) {
    const other = isArabic(name) ? toLatin(name, table) : toArabic(name, table);
    const keys = isArabic(name) ? arabicKeys(name) : latinKeys(name);
    console.log(`${name}  →  ${other}   keys ${keys.join(", ")}`);
  }
} else {
  console.log("pnpm translit <name>...  |  --table  |  --eval");
}
