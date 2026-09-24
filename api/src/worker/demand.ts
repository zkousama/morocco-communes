/**
 * What the site was asked for, as counts. A row says what was looked for, on which day,
 * from which country, and stops there: no address, no identifier, nothing that joins 2
 * rows into a person. Search text passes scrubText first, so a phone number or an email
 * typed into the box by mistake is dropped rather than stored.
 */
export type DemandKind = "search" | "place" | "tool" | "download";

export interface DemandRow {
  kind: DemandKind;
  /** A scrubbed search, or "" for the other kinds. */
  text: string;
  /** The place asked for, or the file taken, or "". */
  code: string;
  /** The route or the MCP tool. */
  name: string;
  /** Hits a search returned. -1 where the kind isn't a search. */
  results: number;
  locale: "en" | "fr";
  country: string;
  /** The first product of the User-Agent, as usage.ts reads it. */
  via: string;
  /** The kind of site a visitor came from, never the address itself. */
  viaSite: string;
  /** For MCP, the name a client gives itself. */
  client: string;
  bot: 0 | 1;
  /** The dataset version live at the time. */
  dataset: string;
}

const MAX_CHARACTERS = 64;

/** A search, lowercased and cut, or "" when it holds anything that could be personal. */
export function scrubText(raw: string | null | undefined): string {
  const collapsed = (raw ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  // Array.from, so a cut lands between characters rather than inside one.
  const text = Array.from(collapsed).slice(0, MAX_CHARACTERS).join("");
  if (text === "") return "";
  if (text.includes("@")) return "";
  if (/[0-9]{6,}/.test(text)) return "";
  if (/https?:|www\./.test(text)) return "";
  if (text.split(" ").length > 6) return "";
  return text;
}

const SITES: [RegExp, string][] = [
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$|^t\.co$/, "x"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)(google|bing|duckduckgo|ecosia|qwant|yandex)\./, "search"],
];

/** Which kind of site sent a visitor: the class only, never the address. */
export function viaSiteOf(referer: string | null | undefined, host: string): string {
  if (!referer) return "direct";
  let hostname: string;
  try {
    hostname = new URL(referer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (hostname === host.toLowerCase()) return "site";
  for (const [pattern, name] of SITES) if (pattern.test(hostname)) return name;
  return "other";
}

const CRAWLER = /bot|crawl|spider|slurp|probe|scan|monitor|headless|preview|fetcher|mcpbeat|sentineloracle|glama|rokmcp|talandor|collector/;

/** 1 for a known crawler. Crawler rows are kept and left out of anything public. */
export function isBot(userAgent: string | null | undefined): 0 | 1 {
  return CRAWLER.test((userAgent ?? "").toLowerCase()) ? 1 : 0;
}

/** The language a path belongs to. */
export function localeOf(pathname: string): "en" | "fr" {
  return pathname === "/fr" || pathname.startsWith("/fr/") ? "fr" : "en";
}

const INSERT =
  "INSERT INTO events (day, kind, text, code, name, results, locale, country, via, via_site, client, bot, dataset)" +
  " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)";

/**
 * Writes one row. Without the binding, as in local dev and tests, it does nothing, and a
 * database that fails costs the caller nothing: this runs after the response is built.
 */
export async function recordDemand(
  db: D1Database | undefined,
  row: DemandRow,
  now: Date = new Date(),
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(INSERT)
      .bind(
        now.toISOString().slice(0, 10),
        row.kind, row.text, row.code, row.name, row.results,
        row.locale, row.country, row.via, row.viaSite, row.client, row.bot, row.dataset,
      )
      .run();
  } catch {
    // Counting must never cost a caller their answer.
  }
}
