-- What the Deals and Resets tabs recommended, so the outcome can be checked later.
CREATE TABLE recommendations (
  id              INTEGER PRIMARY KEY,
  house_id        INTEGER NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('deal', 'reset')),
  item_id         INTEGER NOT NULL,
  taken_at        INTEGER NOT NULL,              -- the snapshot it came from
  units           INTEGER NOT NULL CHECK (units > 0),
  cost            INTEGER NOT NULL CHECK (cost > 0),   -- copper to buy all the units
  expected_profit INTEGER NOT NULL,              -- copper, what the tab showed
  UNIQUE (house_id, kind, item_id, taken_at)
) STRICT;

CREATE INDEX recommendations_recent
  ON recommendations (house_id, kind, item_id, taken_at);
