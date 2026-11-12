-- 001_init.sql
-- First schema for auctionmaxxer: snapshots, per-item price summaries,
-- order-book depth, and the item-name backfill queue.
--
-- Conventions:
--   * All prices are INTEGER copper (1g = 10,000c). Never REAL: rounding bugs.
--   * All times are INTEGER Unix seconds (UTC), matching Snapshot.takenAt.
--   * STRICT tables, so SQLite rejects a value of the wrong type instead of
--     quietly storing it (e.g. a price that arrived as a string).
--   * Runtime settings (WAL mode, foreign_keys = ON) belong in the code that
--     opens the database, not here: PRAGMA foreign_keys is per-connection.

-- ---------------------------------------------------------------------------
-- One row per collector attempt, including failures, so gaps in history are
-- visible instead of silent.
-- ---------------------------------------------------------------------------
CREATE TABLE snapshots (
  id            INTEGER PRIMARY KEY,
  ruleset_id    INTEGER NOT NULL,              -- 1 = PvP
  house_id      INTEGER NOT NULL,              -- 113 = your Horde AH
  kind          TEXT    NOT NULL CHECK (kind IN ('commodities', 'items')),
  taken_at      INTEGER,                       -- Blizzard's Last-Modified; NULL if the fetch failed
  fetched_at    INTEGER NOT NULL,              -- when our collector ran
  status        TEXT    NOT NULL CHECK (status IN ('ok', 'empty', 'failed')),
  listing_count INTEGER,                       -- raw listings in the response
  error         TEXT,                          -- message when status = 'failed'
  CHECK (status = 'failed' OR taken_at IS NOT NULL),
  CHECK (status <> 'failed' OR error IS NOT NULL)
) STRICT;

-- The same Blizzard snapshot can never be stored twice. Failed rows have
-- taken_at = NULL, and NULLs don't collide in a UNIQUE index, so any number
-- of failures can be logged.
CREATE UNIQUE INDEX snapshots_unique
  ON snapshots (ruleset_id, house_id, kind, taken_at);

-- "Latest good snapshot for this house" is the most common lookup.
CREATE INDEX snapshots_latest
  ON snapshots (house_id, kind, status, taken_at);

-- ---------------------------------------------------------------------------
-- One summary row per commodity per snapshot. Kept long-term.
-- ---------------------------------------------------------------------------
CREATE TABLE commodity_prices (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL,
  min_price     INTEGER NOT NULL,              -- cheapest unit price
  median_price  INTEGER NOT NULL,              -- quantity-weighted median unit price
  quantity      INTEGER NOT NULL,              -- total units listed
  qty_at_min    INTEGER NOT NULL,              -- units available at min_price
  listing_count INTEGER NOT NULL,              -- separate listings (seller count proxy)
  PRIMARY KEY (snapshot_id, item_id),
  CHECK (min_price > 0 AND median_price >= min_price),
  CHECK (quantity > 0 AND qty_at_min BETWEEN 1 AND quantity)
) STRICT, WITHOUT ROWID;

-- Price history for one item: WHERE item_id = ? ORDER BY snapshot_id.
CREATE INDEX commodity_prices_by_item
  ON commodity_prices (item_id, snapshot_id);

-- ---------------------------------------------------------------------------
-- Order-book depth: the cheapest N distinct price levels per item per
-- snapshot, with the total quantity at each price. Answers "what does it
-- cost to buy 310 Silver Bars?". The biggest table by far: prune rows older
-- than a week or two and rely on commodity_prices for long-term history.
-- ---------------------------------------------------------------------------
CREATE TABLE price_levels (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL,
  level         INTEGER NOT NULL CHECK (level >= 0),   -- 0 = cheapest price
  unit_price    INTEGER NOT NULL CHECK (unit_price > 0),
  quantity      INTEGER NOT NULL CHECK (quantity > 0), -- summed across listings at this price
  PRIMARY KEY (snapshot_id, item_id, level)
) STRICT, WITHOUT ROWID;

-- ---------------------------------------------------------------------------
-- Item names and metadata, filled in gradually by the backfill queue.
-- A row is created as 'pending' the first time an item_id is seen.
-- ---------------------------------------------------------------------------
CREATE TABLE items (
  item_id       INTEGER PRIMARY KEY,
  name          TEXT,                          -- NULL until fetched
  quality       TEXT,                          -- e.g. 'COMMON', 'UNCOMMON'
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'ok', 'missing')),  -- 'missing' = getItem returned null
  first_seen    INTEGER NOT NULL,
  fetched_at    INTEGER,
  CHECK (status <> 'ok' OR name IS NOT NULL)
) STRICT;

-- The backfill job picks the oldest pending items first.
CREATE INDEX items_pending
  ON items (status, first_seen);
