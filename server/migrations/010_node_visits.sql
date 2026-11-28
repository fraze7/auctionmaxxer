-- What the owner looted from mining and herb nodes, uploaded from the NodeLog
-- addon's SavedVariables file. One row per node visit: every tap on one vein.
CREATE TABLE node_visits (
  id           TEXT    PRIMARY KEY,           -- the addon's ID: realm-character-time-sequence
  realm        TEXT    NOT NULL,
  character    TEXT    NOT NULL,
  visited_at   INTEGER NOT NULL,              -- first tap
  last_tap_at  INTEGER NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('mining', 'herbalism')),
  node         TEXT    NOT NULL,              -- e.g. 'Rich Thorium Vein'
  object_id    INTEGER,                       -- game object ID, when the client gave one
  zone         TEXT,
  subzone      TEXT,
  map_id       INTEGER,
  x            REAL,                          -- map percent, 0-100
  y            REAL,
  level        INTEGER,
  skill        INTEGER,
  taps         INTEGER NOT NULL CHECK (taps >= 1),
  CHECK (last_tap_at >= visited_at)
) STRICT;

CREATE INDEX node_visits_by_node ON node_visits (node, visited_at);

CREATE TABLE node_loot (
  visit_id  TEXT    NOT NULL REFERENCES node_visits (id) ON DELETE CASCADE,
  item_id   INTEGER NOT NULL,
  item_name TEXT    NOT NULL,                 -- from the loot window, for items never seen on the auction house
  quantity  INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (visit_id, item_id)
) STRICT, WITHOUT ROWID;
