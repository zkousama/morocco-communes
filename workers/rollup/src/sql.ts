/**
 * The nightly job's SQL, kept out of index.ts: the Workers runtime reads every named export
 * of a Worker's main module as an entrypoint, and refuses to start on one that's a string.
 */
const KEY = "day, kind, text, code, name, locale, country, via, via_site, bot";

/** How long a raw row lives. The privacy page states it. */
export const KEEP_DAYS = 90;

/** How many times a search has to be typed in a day to keep its text whatever it is. */
export const TYPED = 3;

/**
 * One day's rows as counts. Run again for the same day, it replaces its counts rather than
 * adding to them.
 *
 * A search keeps its text only when it names a place or was typed 3 times or more that
 * day, and is otherwise counted under "". Raw rows keep the text for their 90 days, but a
 * count is kept for good, and a search only one person typed, a name say, shouldn't be.
 * Hits don't decide it, since a fuzzy search finds some for almost any name. An
 * assistant's query is held to the same rule.
 */
export const ROLLUP = `WITH kept AS (
    SELECT kind, text FROM events
    WHERE day = ?1 AND text != ''
    GROUP BY kind, text
    HAVING MAX(named) = 1 OR COUNT(*) >= ${TYPED}
  ),
  folded AS (
    SELECT day, kind, CASE WHEN (kind, text) IN (SELECT kind, text FROM kept) THEN text ELSE '' END AS text,
      code, name, locale, country, via, via_site, bot
    FROM events
  )
  INSERT INTO daily (${KEY}, n)
  SELECT ${KEY}, COUNT(*) FROM folded WHERE day = ?1 GROUP BY ${KEY}
  ON CONFLICT (${KEY}) DO UPDATE SET n = excluded.n`;

/** Every row from before the given day. */
export const PRUNE = "DELETE FROM events WHERE day < ?1";
