-- What a vendor pays for one of the item, in copper. NULL = not looked up yet;
-- 0 = vendors do not buy it (or Blizzard gave no price).
ALTER TABLE items ADD COLUMN sell_price INTEGER;
