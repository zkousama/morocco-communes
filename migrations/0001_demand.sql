-- One row per event, and the daily rollup that outlives it. Nothing here identifies a
-- person: there is no address, no session and no key that joins 2 rows.
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  results INTEGER NOT NULL DEFAULT -1,
  named INTEGER NOT NULL DEFAULT 0,
  locale TEXT NOT NULL DEFAULT 'en',
  country TEXT NOT NULL DEFAULT '',
  via TEXT NOT NULL DEFAULT '',
  via_site TEXT NOT NULL DEFAULT 'direct',
  client TEXT NOT NULL DEFAULT '',
  bot INTEGER NOT NULL DEFAULT 0,
  dataset TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS events_day ON events (day);

CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',
  country TEXT NOT NULL DEFAULT '',
  via TEXT NOT NULL DEFAULT '',
  via_site TEXT NOT NULL DEFAULT 'direct',
  bot INTEGER NOT NULL DEFAULT 0,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, kind, text, code, name, locale, country, via, via_site, bot)
);
