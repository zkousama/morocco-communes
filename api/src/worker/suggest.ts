/**
 * Latin spellings visitors suggest for a douar no source writes in Latin. HCP names the
 * douars in Arabic only, and for the ones neither the Ministry of Education's school lists,
 * OpenStreetMap nor GeoNames name, the people who live there are the only source.
 *
 * A suggestion is checked before it's kept: the douar has to be one with no Latin name yet,
 * and the spelling has to be Latin letters whose keys meet the douar's Arabic (translit.ts),
 * so a word that isn't this douar's name is refused however it's typed. A spelling goes live
 * once VOTES different visitors have suggested it.
 *
 * A visitor is told apart by an HMAC of their address under SUGGEST_KEY and the day, so the
 * key changes every day: it tells 2 people apart on the day they suggest, and can't be turned
 * back into an address. The privacy page says so, and the rollup Worker deletes a suggestion
 * after 90 days.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { normalise } from "../lib/normalise.ts";
import { arabicKeys, keysMeet, latinKeys } from "../lib/translit.ts";

/** How many visitors have to suggest a spelling for it to go live. */
export const VOTES = 2;
/** How many suggestions a visitor can make in a day. */
export const PER_DAY = 20;
export const MIN_LETTERS = 2;
export const MAX_CHARACTERS = 60;

/** Latin letters, spaces, hyphens and apostrophes, starting with a letter. */
const LATIN = /^\p{Script=Latin}[\p{Script=Latin}' ’-]*$/u;

/** A suggested spelling tidied the way names are written, or null where it isn't one. */
export function cleanSpelling(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const name = text.replace(/\s+/g, " ").trim().replace(/’/g, "'");
  if (name.length > MAX_CHARACTERS || !LATIN.test(name)) return null;
  if (name.replace(/[^\p{L}]/gu, "").length < MIN_LETTERS) return null;
  return name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

/** The form 2 suggestions have to share to be the same spelling: Tigraout and tigraout are one. */
export const spellingOf = (name: string) => normalise(name).replace(/ /g, "");

/** Whether a Latin spelling reads as this Arabic name. */
export const readsAs = (name: string, arabic: string) => keysMeet(arabicKeys(arabic), latinKeys(name));

/** The visitor's key for the day: an HMAC of their address, keyed by the secret and the day. */
export async function visitorOf(secret: string, day: string, address: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${day}|${address}`));
  return [...new Uint8Array(mac).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Outcome =
  | { status: "counted"; votes: number }
  | { status: "accepted"; name: string }
  | { status: "named" }
  | { status: "limit" };

/** Keeps a suggestion and accepts the spelling once enough visitors have made it. */
export async function suggest(
  db: D1Database,
  row: { douar: string; name: string; visitor: string; day: string },
): Promise<Outcome> {
  const named = await db.prepare("SELECT name FROM douar_names WHERE douar = ?").bind(row.douar).first<{ name: string }>();
  if (named) return { status: "named" };
  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM douar_suggestions WHERE visitor = ? AND day = ?")
    .bind(row.visitor, row.day)
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= PER_DAY) return { status: "limit" };
  const spelling = spellingOf(row.name);
  await db
    .prepare("INSERT OR IGNORE INTO douar_suggestions (douar, name, spelling, visitor, day) VALUES (?, ?, ?, ?, ?)")
    .bind(row.douar, row.name, spelling, row.visitor, row.day)
    .run();
  const votes = (await db
    .prepare("SELECT COUNT(*) AS n FROM douar_suggestions WHERE douar = ? AND spelling = ?")
    .bind(row.douar, spelling)
    .first<{ n: number }>())?.n ?? 0;
  if (votes < VOTES) return { status: "counted", votes };
  // The form the first visitor wrote, so the name is a person's spelling of it.
  const first = await db
    .prepare("SELECT name FROM douar_suggestions WHERE douar = ? AND spelling = ? ORDER BY day, rowid LIMIT 1")
    .bind(row.douar, spelling)
    .first<{ name: string }>();
  const name = first?.name ?? row.name;
  await db.prepare("INSERT OR IGNORE INTO douar_names (douar, name, since) VALUES (?, ?, ?)").bind(row.douar, name, row.day).run();
  return { status: "accepted", name };
}

/** The accepted names of a commune's douars, whose codes all start with `prefix`. */
export async function acceptedIn(db: D1Database, prefix: string): Promise<Record<string, string>> {
  const rows = await db
    .prepare("SELECT douar, name FROM douar_names WHERE douar >= ? AND douar < ? ORDER BY douar")
    .bind(prefix, `${prefix}~`)
    .all<{ douar: string; name: string }>();
  return Object.fromEntries(rows.results.map((r) => [r.douar, r.name]));
}
