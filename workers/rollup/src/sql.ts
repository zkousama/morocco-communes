/**
 * The nightly job's SQL, kept out of index.ts: the Workers runtime reads every named export
 * of a Worker's main module as an entrypoint, and refuses to start on one that's a string.
 */
const KEY = "day, kind, text, code, name, locale, country, via, via_site, bot";

/**
 * One day's rows as counts. Run again for the same day, it replaces its counts rather than
 * adding to them.
 *
 * A search keeps its text only when it found something that day or was typed 3 times or
 * more, and is otherwise counted under "". Raw rows keep the text for their 90 days, but a
 * count is kept for good, and a search only one person typed, a name say, shouldn't be.
 * An assistant's query is held to the same rule; nothing says what it found, so it needs
 * the 3.
 */
export const ROLLUP = `WITH kept AS (
    SELECT kind, text FROM events
    WHERE day = ?1 AND text != ''
    GROUP BY kind, text
    HAVING MAX(results) > 0 OR COUNT(*) >= 3
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
