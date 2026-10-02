-- Latin spellings visitors suggest for a douar HCP names only in Arabic and no source writes
-- in Latin. Each night the spelling engine checks them (api/src/worker/accept.ts), and one
-- that 2 visitors suggested and that reads close enough to the douar's Arabic goes live.
--
-- `visitor` is an HMAC of the visitor's address under a key that changes every day, so it
-- tells 2 people apart on the day they suggest and can't be turned back into an address.
-- A suggestion lives 90 days; the rollup Worker deletes it then. An accepted name stays.
CREATE TABLE IF NOT EXISTS douar_suggestions (
  douar TEXT NOT NULL,
  -- The spelling as the visitor wrote it, tidied.
  name TEXT NOT NULL,
  -- Its normalised form, which 2 suggestions have to share to count as the same spelling.
  spelling TEXT NOT NULL,
  -- The douar's name in Arabic, which the nightly check spells to score the suggestion against.
  arabic TEXT NOT NULL,
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (douar, spelling, visitor)
);

CREATE INDEX IF NOT EXISTS douar_suggestions_visitor ON douar_suggestions (visitor, day);
CREATE INDEX IF NOT EXISTS douar_suggestions_day ON douar_suggestions (day);

CREATE TABLE IF NOT EXISTS douar_names (
  douar TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  since TEXT NOT NULL
);
