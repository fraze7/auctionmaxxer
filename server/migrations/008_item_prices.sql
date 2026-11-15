-- Listings sold one at a time (gear, bags, patterns), which Blizzard sends
-- apart from commodities. One row per item per snapshot, on the same snapshot
-- row as its commodities. Pruned after two weeks, like price_levels.
CREATE TABLE item_prices (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL,
  min_buyout    INTEGER NOT NULL CHECK (min_buyout > 0),   -- cheapest buyout
  median_buyout INTEGER NOT NULL,
  listing_count INTEGER NOT NULL CHECK (listing_count > 0), -- listings with a buyout
  PRIMARY KEY (snapshot_id, item_id),
  CHECK (median_buyout >= min_buyout)
) STRICT, WITHOUT ROWID;

CREATE INDEX item_prices_by_item
  ON item_prices (item_id, snapshot_id);

-- 'single' = only ever seen as a one-at-a-time listing. The Items search and
-- the Vendor tab are about commodities and leave these out.
ALTER TABLE items ADD COLUMN kind TEXT NOT NULL DEFAULT 'commodity'
  CHECK (kind IN ('commodity', 'single'));
