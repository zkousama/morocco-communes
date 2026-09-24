/**
 * The nightly job's SQL, kept out of index.ts: the Workers runtime reads every named export
 * of a Worker's main module as an entrypoint, and refuses to start on one that's a string.
 */
const KEY = "day, kind, text, code, locale, country, via, via_site, bot";

/** One day's rows as counts. Run again for the same day, it replaces its counts rather than adding to them. */
export const ROLLUP = `INSERT INTO daily (${KEY}, n)
  SELECT ${KEY}, COUNT(*) FROM events WHERE day = ?1 GROUP BY ${KEY}
  ON CONFLICT (${KEY}) DO UPDATE SET n = excluded.n`;

/** Every row from before the given day. */
export const PRUNE = "DELETE FROM events WHERE day < ?1";
