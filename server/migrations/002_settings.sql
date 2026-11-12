-- 002_settings.sql
-- Tunable numbers the deals rule reads, kept in the database so they can be
-- changed without touching code. Values are stored as text and parsed (and
-- range-checked) by settings.ts.
--
-- These rows are yours: the collector never overwrites them.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

INSERT INTO settings (key, value) VALUES
  -- Share of the sale price the auction house keeps. 0.05 = 5%.
  -- PLACEHOLDER: this is Classic's figure. Check the real cut in game.
  ('ah_cut', '0.05'),

  -- An item needs at least this many hourly price points in the last 7 days
  -- before we judge it. 48 = two days of history.
  ('deal_min_snapshots', '48'),

  -- Trend = 24-hour median / 7-day median.
  -- Below deal_trend_falling the market is falling (never shown as a deal);
  -- above deal_trend_rising it is rising.
  ('deal_trend_falling', '0.85'),
  ('deal_trend_rising', '1.15'),

  -- A deal's current price must be at most this share of the 24-hour median.
  ('deal_max_price_ratio', '0.80'),

  -- Smallest profit per unit, in copper, worth showing. The API's
  -- ?minProfit= overrides it per request.
  ('deal_min_profit', '1');
