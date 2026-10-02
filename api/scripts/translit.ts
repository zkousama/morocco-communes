/**
 * Moroccan names between Arabic and Latin, by the word table, the model and the rules. No
 * service and no network.
 *
 *   pnpm translit تيݣراو "Ouled Said"   each name in the other script, and its keys
 *   pnpm translit --table               rebuild the word table from the pairs
 *   pnpm translit --model               train the 2 models on the pairs, to .cache (a few minutes)
 *   pnpm translit --eval                how well each part does on names held back from it
 *
 * The pairs are every unit HCP names in both scripts, the neighbourhoods OpenStreetMap names
 * in both, the douars matched to a GeoNames or OpenStreetMap place by api:douar-places, the
 * douar's Arabic with the place's Latin, and the douars the Ministry of Education's school
 * lists name (api:douar-names). HCP's own pairs count 6 times over: theirs is the
 * spelling the model is meant to learn, and GeoNames writes some names another way
 * (Akhfniyr for Akhfennir).
 *
 * On 2026-10-02 the models came out a little ahead of the rules on exact spellings and a
 * little behind on letters off (--eval), so the site spells by the table and the rules.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { normalise } from "../src/lib/normalise.ts";
import { arabicKeys, keysMeet, latinKeys } from "../src/lib/translit.ts";
import { buildWordTable, wordPairs, type WordTable } from "../src/lib/translitWords.ts";
import { modelArabic, modelLatin, toArabic, toLatin, type Models } from "../src/lib/spell.ts";
import { train } from "../src/lib/graphones.ts";

const TABLE = "api/generated/translit-words.json";
/** Not committed: the site spells by the table and the rules, and the models are an experiment (see --eval). */
const MODELS = ".cache/translit-models.json";
const LEVELS = ["regions", "provinces", "cercles", "communes", "arrondissements"];
/** How many times over HCP's own pairs count in training. */
const HCP_WEIGHT = 6;
const ORDER = 4;

type Pair = { fr: string; ar: string };
const units = (): Pair[] =>
  LEVELS.flatMap((level) => JSON.parse(readFileSync(`data/v1/attributes/${level}.json`, "utf8")) as { name: { fr: string; ar: string | null } }[])
    .filter((u) => u.name.fr && u.name.ar)
    .map((u) => ({ fr: u.name.fr, ar: u.name.ar! }));
const neighbourhoods = (): Pair[] =>
  (JSON.parse(readFileSync("api/data/neighbourhoods.json", "utf8")) as { places: [string, string, ...unknown[]][] }).places
    .filter(([fr, ar]) => fr && ar)
    .map(([fr, ar]) => ({ fr, ar }));
const douars = (): Pair[] => {
  if (!existsSync("api/data/douar-places.json")) return [];
  const arabic = new Map<string, string>();
  for (let r = 1; r <= 12; r++) {
    for (const d of JSON.parse(readFileSync(`data/v1/douars/${String(r).padStart(2, "0")}.json`, "utf8")) as { code: string; name: { ar: string } }[]) {
      arabic.set(d.code, d.name.ar);
    }
  }
  const placed = (JSON.parse(readFileSync("api/data/douar-places.json", "utf8")) as { places: [string, string, ...unknown[]][] }).places;
  const named = existsSync("api/data/douar-names.json")
    ? (JSON.parse(readFileSync("api/data/douar-names.json", "utf8")) as { names: [string, string][] }).names
    : [];
  return [...placed, ...named]
    .map(([code, latin]) => ({ fr: latin, ar: arabic.get(code)! }))
    .filter((p) => p.ar && p.fr);
};

/** The pairs to learn from: HCP's weighted over the rest. */
const teaching = (hcp: Pair[], matched = douars()) => [...Array.from({ length: HCP_WEIGHT }, () => hcp).flat(), ...neighbourhoods(), ...matched];

function trainModels(pairs: Pair[]): Models {
  const words = wordPairs(pairs);
  const toLatin = train(words.map(([a, l]) => [modelArabic(a), modelLatin(l)] as [string, string]).filter(([a, l]) => a && l), ORDER);
  const toArabic = train(words.map(([a, l]) => [modelLatin(l), modelArabic(a)] as [string, string]).filter(([a, l]) => a && l), ORDER);
  return { toLatin, toArabic };
}

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
  const shuffle = <T>(list: T[]) => list.map((p) => ({ p, r: random() })).sort((a, b) => a.r - b.r).map(({ p }) => p);
  const shuffled = shuffle(all);
  const held = shuffled.slice(0, Math.floor(all.length / 5));
  const kept = shuffled.slice(held.length);
  // A fifth of the matched douars held back too: their names are the ones the site spells.
  const matched = shuffle(douars());
  const heldDouars = matched.slice(0, Math.floor(matched.length / 5));
  const table = buildWordTable(teaching(kept, matched.slice(heldDouars.length)));
  console.log("training on what's left once a fifth of HCP's names and of the matched douars are held back...");
  const models = trainModels(teaching(kept, matched.slice(heldDouars.length)));

  const met = all.filter((p) => keysMeet(arabicKeys(p.ar), latinKeys(p.fr))).length;
  console.log(`keys meet: ${met} of ${all.length} names, ${((met / all.length) * 100).toFixed(1)}%`);
  // A name that isn't a spelling of the other (Casablanca for الدار البيضاء) can't come out right.
  const spellings = held.filter((p) => keysMeet(arabicKeys(p.ar), latinKeys(p.fr)));
  const flat = (s: string) => normalise(s).replace(/ /g, "");
  const score = (label: string, spell: (p: Pair) => string, truth: (p: Pair) => string, on = held) => {
    let exact = 0;
    let wrong = 0;
    let length = 0;
    for (const p of on) {
      const guess = flat(spell(p));
      const right = flat(truth(p));
      if (guess === right) exact++;
      wrong += distance(guess, right);
      length += right.length;
    }
    if (on !== held) {
      console.log(`${label}: ${((exact / on.length) * 100).toFixed(1)}% exactly as the place writes it, ${((wrong / length) * 100).toFixed(1)}% of letters off, on ${on.length} douars held back`);
      return;
    }
    const spelt = spellings.filter((p) => flat(spell(p)) === flat(truth(p))).length;
    console.log(
      `${label}: ${((exact / held.length) * 100).toFixed(1)}% exactly as HCP writes it ` +
        `(${((spelt / spellings.length) * 100).toFixed(1)}% of the ${spellings.length} that are spellings of each other), ` +
        `${((wrong / length) * 100).toFixed(1)}% of letters off, on ${held.length} names held back`,
    );
  };
  score("Arabic to Latin, table and rules", (p) => toLatin(p.ar, table), (p) => p.fr);
  score("Arabic to Latin, table and model", (p) => toLatin(p.ar, table, models), (p) => p.fr);
  score("Latin to Arabic, table and rules", (p) => toArabic(p.fr, table), (p) => p.ar);
  score("Latin to Arabic, table and model", (p) => toArabic(p.fr, table, models), (p) => p.ar);
  score("Douars to Latin, table and rules", (p) => toLatin(p.ar, table), (p) => p.fr, heldDouars);
  score("Douars to Latin, table and model", (p) => toLatin(p.ar, table, models), (p) => p.fr, heldDouars);
}

const args = process.argv.slice(2);
if (args[0] === "--table") {
  const table = buildWordTable(teaching(units()));
  writeFileSync(TABLE, `${JSON.stringify(table)}\n`);
  console.log(`translit: ${Object.keys(table.toLatin).length} Arabic words and ${Object.keys(table.toArabic).length} Latin ones, to ${TABLE}`);
} else if (args[0] === "--model") {
  const models = trainModels(teaching(units()));
  writeFileSync(MODELS, `${JSON.stringify(models)}\n`);
  console.log(`translit: ${models.toLatin.graphones.length} and ${models.toArabic.graphones.length} graphones, to ${MODELS}`);
} else if (args[0] === "--eval") {
  evaluate();
} else if (args.length > 0) {
  const table = JSON.parse(readFileSync(TABLE, "utf8")) as WordTable;
  const models = existsSync(MODELS) ? (JSON.parse(readFileSync(MODELS, "utf8")) as Models) : undefined;
  for (const name of args) {
    const other = isArabic(name) ? toLatin(name, table, models) : toArabic(name, table, models);
    const keys = isArabic(name) ? arabicKeys(name) : latinKeys(name);
    console.log(`${name}  →  ${other}   keys ${keys.join(", ")}`);
  }
} else {
  console.log("pnpm translit <name>...  |  --table  |  --model  |  --eval");
}
