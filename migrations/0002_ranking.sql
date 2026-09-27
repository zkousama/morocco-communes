-- The public page's ranking, worked out once a night by the rollup Worker, so the page can
-- ask for it on every visit and each answer reads at most 100 rows. Working it out from
-- daily on every visit would read the whole month each time.
CREATE TABLE IF NOT EXISTS ranking (
  code TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  since TEXT NOT NULL
);

-- Filled from what's counted already, so the page isn't empty until the first night. The
-- rollup Worker's RANKING (workers/rollup/src/sql.ts) is the same query.
INSERT INTO ranking (code, n, since)
SELECT code, n, date('now', '-30 days') FROM (
  SELECT code, SUM(n) AS n FROM daily
  WHERE day >= date('now', '-30 days') AND kind = 'place' AND name = 'place' AND via = 'browser' AND bot = 0
  GROUP BY code HAVING SUM(n) >= 5 ORDER BY n DESC LIMIT 100
);
