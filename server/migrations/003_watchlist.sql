-- 003_watchlist.sql
-- The watchlist: price rules you set ("tell me when Dense Stone drops below
-- 40s"), and a log of every time one of them fired.

-- ---------------------------------------------------------------------------
-- One row per rule. An item can have one 'below' rule (a price to buy at) and
-- one 'above' rule (a price to sell at); saving the same kind again replaces
-- the threshold instead of adding a duplicate.
-- ---------------------------------------------------------------------------
CREATE TABLE watches (
  id            INTEGER PRIMARY KEY,
  house_id      INTEGER NOT NULL,
  item_id       INTEGER NOT NULL REFERENCES items (item_id),
  direction     TEXT    NOT NULL CHECK (direction IN ('below', 'above')),
  threshold     INTEGER NOT NULL CHECK (threshold > 0),   -- copper per unit
  created_at    INTEGER NOT NULL,
  -- The rule's memory. NULL = the price is on the quiet side of the
  -- threshold. A time = it crossed over in the snapshot taken then, and has
  -- stayed there since. This is what stops the same alert repeating every
  -- hour: an alert is only raised when this goes from NULL to a time.
  triggered_at  INTEGER,
  UNIQUE (house_id, item_id, direction)
) STRICT;

-- ---------------------------------------------------------------------------
-- One row each time a rule fires. It copies the rule's details instead of
-- pointing at the watches row, so the history survives when a rule is edited
-- or deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE alerts (
  id            INTEGER PRIMARY KEY,
  house_id      INTEGER NOT NULL,
  item_id       INTEGER NOT NULL,
  direction     TEXT    NOT NULL CHECK (direction IN ('below', 'above')),
  threshold     INTEGER NOT NULL,              -- the rule at the time
  price         INTEGER NOT NULL,              -- the min price that crossed it
  taken_at      INTEGER NOT NULL,              -- the snapshot it happened in
  created_at    INTEGER NOT NULL,
  notified_at   INTEGER                        -- when Discord was told; NULL = not yet
) STRICT;

-- "Newest alerts for this house", and "alerts not sent yet".
CREATE INDEX alerts_recent  ON alerts (house_id, taken_at);
CREATE INDEX alerts_pending ON alerts (notified_at, created_at);
