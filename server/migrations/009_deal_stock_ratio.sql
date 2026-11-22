-- A deal is skipped when the units listed now are more than this many times
-- the item's 7-day median. A week of Record verdicts (15-21 Nov 2026) showed
-- such picks lost money: a flooded market is moving to a lower price.
INSERT OR IGNORE INTO settings (key, value) VALUES ('deal_max_stock_ratio', '2');
