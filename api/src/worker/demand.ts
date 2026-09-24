/**
 * What the site was asked for, as counts. A row says what was looked for, on which day,
 * from which country, and stops there: no address, no identifier, nothing that joins 2
 * rows into a person. Search text passes scrubText first, so a phone number or an email
 * typed into the box by mistake is dropped rather than stored.
 */
export type DemandKind = "search" | "place" | "tool" | "client" | "download";

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
  /**
   * 1 when a search names a place, by its code, its name, an exonym or a spelling of it.
   * Worked out by the Worker from its own search, never taken from the client.
   */
  named: 0 | 1;
  locale: "en" | "fr";
  country: string;
  /** The first product of the User-Agent, as usage.ts reads it. */
  via: string;
  /** The kind of site a visitor came from, never the address itself. */
  viaSite: string;
  /**
   * For MCP, the name a client gives itself. It arrives only with the handshake, and the
   * transport keeps no session to carry it to later requests, so it's set on client rows
   * and "" on tool rows.
   */
  client: string;
  bot: 0 | 1;
  /** The dataset version live at the time. */
  dataset: string;
}

const MAX_CHARACTERS = 64;

/** An HCP code in its dotted form, from a région's 01 down to an urban centre's 04.501.03.11.4. */
const HCP_CODE = /^[0-9]{2}(\.[0-9]{3}(\.[0-9]{2}(\.[0-9]{1,2}(\.[0-9])?)?)?)?$/;

/**
 * A search, lowercased and cut, or "" when it holds anything that could be personal.
 *
 * A code names a place, so it's kept whatever its digits. Given `knownCode`, only a code
 * that names a real unit is: a phone number grouped 2-3-2-2-1 has a code's shape.
 *
 * Every drop check runs on the whole text before anything is cut, so a phone number, an
 * email, a web address or a 7th word past character 64 is still caught: cutting first
 * would let all of those through unseen.
 */
export function scrubText(raw: string | null | undefined, knownCode?: (code: string) => boolean): string {
  const text = (raw ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  if (text === "") return "";
  // The search box takes a code typed with spaces, 01 511 01 0, and so does this.
  const code = /^[0-9. ]+$/.test(text) ? text.replace(/ /g, ".") : text;
  if (HCP_CODE.test(code) && (knownCode?.(code) ?? true)) return code;
  if (text.includes("@")) return "";
  // Counted rather than matched as a run, so a phone number is caught however it's spaced
  // or dotted, and in Arabic-Indic or circled digits too.
  if ((text.match(/[\p{Nd}\p{No}]/gu) ?? []).length >= 6) return "";
  if (/https?:|www\./.test(text)) return "";
  if (text.split(" ").length > 6) return "";
  // Array.from, so a cut lands between characters rather than inside one. Only what
  // survives every check above gets cut, and stored.
  return Array.from(text).slice(0, MAX_CHARACTERS).join("");
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
  "INSERT INTO events (day, kind, text, code, name, results, locale, country, via, via_site, client, bot, dataset, named)" +
  " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)";

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
        row.locale, row.country, row.via, row.viaSite, row.client, row.bot, row.dataset, row.named,
      )
      .run();
  } catch {
    // Counting must never cost a caller their answer.
  }
}
