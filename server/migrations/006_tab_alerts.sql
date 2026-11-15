-- Alerts for whole tabs: "tell me when Vendor has anything worth 5g".
-- A row in tab_alert_rules means alerts are on for that tab.
CREATE TABLE tab_alert_rules (
  house_id   INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('deal', 'reset', 'vendor', 'craft')),
  min_profit INTEGER NOT NULL CHECK (min_profit >= 0),   -- copper
  PRIMARY KEY (house_id, kind)
) STRICT;

CREATE TABLE tab_alerts (
  id          INTEGER PRIMARY KEY,
  house_id    INTEGER NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('deal', 'reset', 'vendor', 'craft')),
  item_id     INTEGER NOT NULL,
  profit      INTEGER NOT NULL,                -- copper, what the tab showed
  taken_at    INTEGER NOT NULL,                -- the snapshot it came from
  created_at  INTEGER NOT NULL,
  notified_at INTEGER                          -- NULL until Discord accepts it
) STRICT;

CREATE INDEX tab_alerts_recent ON tab_alerts (house_id, kind, item_id, created_at);
CREATE INDEX tab_alerts_pending ON tab_alerts (notified_at, created_at);
