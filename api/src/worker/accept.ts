/**
 * Each night, the spellings visitors suggested are checked by the spelling engine, and the
 * ones that pass go live. A spelling passes when VOTES visitors or more have suggested it and
 * it's no further from the engine's own spelling of the douar's Arabic than 9 in 10 real
 * names are from it: `apart90`, which `pnpm translit --eval` measures on sourced douars the
 * engine never saw. Where several pass for one douar, the one most visitors suggested goes
 * live, then the closest. The rest wait, and leave with the 90-day prune.
 *
 * Only the nightly rollup Worker imports this, so the site's Worker doesn't carry the table.
 */
import type { D1Database } from "@cloudflare/workers-types";
import table from "../../generated/translit-words.json" with { type: "json" };
import evaluation from "../../generated/translit-eval.json" with { type: "json" };
import { normalise } from "../lib/normalise.ts";
import { toLatin } from "../lib/spell.ts";
import { shareApart } from "../lib/translit.ts";
import type { WordTable } from "../lib/translitWords.ts";
import { VOTES } from "./suggest.ts";

/** The furthest a spelling may be from the engine's, as a share of its letters. */
export const BAR: number = evaluation.scores["Douars to Latin, table and rules"].apart90;

export interface Candidate {
  douar: string;
  arabic: string;
  /** The spelling as the first visitor to suggest it wrote it. */
  name: string;
  votes: number;
}

const flat = (s: string) => normalise(s).replace(/ /g, "");

/** How far a spelling is from the engine's spelling of the douar's Arabic, as a share of its letters. */
export const apartFromEngine = (arabic: string, name: string, words: WordTable = table as WordTable) =>
  shareApart(flat(name), flat(toLatin(arabic, words)));

/** The spelling that goes live for each douar, of the candidates; a douar none passes for is left out. */
export function choose(candidates: readonly Candidate[], words: WordTable = table as WordTable, bar = BAR): Map<string, Candidate & { apart: number }> {
  const chosen = new Map<string, Candidate & { apart: number }>();
  for (const c of candidates) {
    if (c.votes < VOTES) continue;
    const apart = apartFromEngine(c.arabic, c.name, words);
    if (apart > bar) continue;
    const best = chosen.get(c.douar);
    if (!best || c.votes > best.votes || (c.votes === best.votes && apart < best.apart)) chosen.set(c.douar, { ...c, apart });
  }
  return chosen;
}

/** Each spelling suggested for a douar with no accepted name yet, with how many visitors suggested it. */
export const CANDIDATES = `SELECT s.douar AS douar, MIN(s.arabic) AS arabic, COUNT(*) AS votes,
  (SELECT f.name FROM douar_suggestions f WHERE f.douar = s.douar AND f.spelling = s.spelling ORDER BY f.day, f.rowid LIMIT 1) AS name
  FROM douar_suggestions s
  WHERE s.douar NOT IN (SELECT douar FROM douar_names)
  GROUP BY s.douar, s.spelling
  HAVING COUNT(*) >= ?`;

/** Scores the night's candidates and puts the ones that pass live. Returns how many went live. */
export async function acceptSuggestions(db: D1Database, today: string): Promise<number> {
  const rows = await db.prepare(CANDIDATES).bind(VOTES).all<Candidate>();
  const chosen = choose(rows.results);
  if (chosen.size === 0) return 0;
  await db.batch(
    [...chosen.values()].map((c) => db.prepare("INSERT OR IGNORE INTO douar_names (douar, name, since) VALUES (?, ?, ?)").bind(c.douar, c.name, today)),
  );
  return chosen.size;
}
