-- NodeLog
-- Records what you loot from mining and herb nodes into SavedVariables (NodeLogDB).
-- WoW writes SavedVariables to disk on logout or /reload; an external importer reads it from there.
--
-- How a "visit" is detected:
--   1. UNIT_SPELLCAST_SENT for a gathering spell (Mining / Herb Gathering) remembers the node name.
--   2. UNIT_SPELLCAST_SUCCEEDED confirms the cast finished.
--   3. The next loot window (LOOT_READY / LOOT_OPENED) is read and logged.
-- Classic-style veins take several taps; taps on the same node within TAP_MERGE_WINDOW are merged
-- into one visit so a 3-tap Rich Thorium Vein counts once.

local ADDON_NAME = ...
local DB_VERSION = 1
local TAP_MERGE_WINDOW = 300 -- seconds
local CAST_TO_LOOT_WINDOW = 10 -- seconds between the cast finishing and the loot window opening

-- Gathering spell IDs from Classic. Forever may use different IDs, so English names are a fallback.
local GATHER_SPELLS = {
  mining = { ids = { 2575, 2576, 3564, 10248 }, fallbackName = "Mining", skillName = "Mining" },
  herbalism = { ids = { 2366, 2368, 3570, 11993 }, fallbackName = "Herb Gathering", skillName = "Herbalism" },
}

local kindBySpellName = {} -- localized spell name -> kind
local pending -- the gathering cast we're waiting on loot for
local handledThisWindow = false
local recent = {} -- merge key -> { entry = ..., lastT = ... }
local debugMode = false

local function now()
  return (GetServerTime and GetServerTime()) or time()
end

local function say(msg)
  DEFAULT_CHAT_FRAME:AddMessage("|cff66ccffNodeLog:|r " .. msg)
end

-- Forever's client uses the modern spell API (C_Spell); the old global GetSpellInfo may not exist.
local function spellName(id)
  if not id then return nil end
  if C_Spell and C_Spell.GetSpellName then return C_Spell.GetSpellName(id) end
  if C_Spell and C_Spell.GetSpellInfo then
    local info = C_Spell.GetSpellInfo(id)
    return info and info.name
  end
  if GetSpellInfo then return (GetSpellInfo(id)) end
  return nil
end

local function buildSpellLookup()
  wipe(kindBySpellName)
  for kind, info in pairs(GATHER_SPELLS) do
    for _, id in ipairs(info.ids) do
      local name = spellName(id)
      if name then kindBySpellName[name] = kind end
    end
    kindBySpellName[info.fallbackName] = kind
  end
end

local function gatherKindForSpell(spellID)
  local name = spellName(spellID)
  return name and kindBySpellName[name], name
end

local function playerPosition()
  if not (C_Map and C_Map.GetBestMapForUnit) then return nil end
  local mapID = C_Map.GetBestMapForUnit("player")
  if not mapID then return nil end
  local pos = C_Map.GetPlayerMapPosition(mapID, "player")
  if not pos then return mapID end
  local x, y = pos:GetXY()
  -- Store as map percentages with two decimals, e.g. 52.31
  return mapID, math.floor(x * 10000 + 0.5) / 100, math.floor(y * 10000 + 0.5) / 100
end

local function professionSkill(kind)
  local wanted = GATHER_SPELLS[kind] and GATHER_SPELLS[kind].skillName
  if not wanted or not GetNumSkillLines or not GetSkillLineInfo then return nil end
  for i = 1, GetNumSkillLines() do
    local name, isHeader, _, rank, _, modifier = GetSkillLineInfo(i)
    if not isHeader and name == wanted then
      return rank, modifier
    end
  end
  return nil
end

local function parseObjectId(guid)
  if not guid then return nil end
  -- GameObject-0-[serverID]-[instanceID]-[zoneUID]-[objectID]-[spawnUID]
  local unitType, _, _, _, _, objectId = strsplit("-", guid)
  if unitType ~= "GameObject" then return nil end
  return tonumber(objectId)
end

local function pruneRecent(t)
  for key, rec in pairs(recent) do
    if t - rec.lastT > TAP_MERGE_WINDOW then recent[key] = nil end
  end
end

local function readLootWindow()
  local items, sourceGuid = {}, nil
  for slot = 1, GetNumLootItems() do
    if GetLootSourceInfo then
      local guid = GetLootSourceInfo(slot)
      if guid and not sourceGuid then sourceGuid = guid end
    end
    local link = GetLootSlotLink(slot)
    if link then -- money slots have no link; nodes don't drop money anyway
      local _, name, qty = GetLootSlotInfo(slot)
      local itemId = tonumber(link:match("item:(%d+)"))
      name = name or link
      local existing = items[name]
      if existing then
        existing.qty = existing.qty + (qty or 1)
      else
        items[name] = { id = itemId, name = name, qty = qty or 1 }
      end
    end
  end
  return items, sourceGuid
end

local function logLoot()
  if handledThisWindow then return end
  handledThisWindow = true

  local p = pending
  pending = nil
  -- Don't require SUCCEEDED to have fired first: event order isn't guaranteed on every client.
  -- FAILED/INTERRUPTED already clear pending, so a recent cast is enough.
  if not p or (GetTime() - (p.doneAt or p.sentAt)) > CAST_TO_LOOT_WINDOW then return end

  local items, guid = readLootWindow()
  -- If the client can tell us the loot source, make sure it really is a world object (not a mob).
  if guid and not guid:match("^GameObject") then return end
  if next(items) == nil then return end

  local t = now()
  pruneRecent(t)

  local mapID, x, y = playerPosition()
  local mergeKey
  if guid then
    mergeKey = guid
  else
    -- No GUID available: fall back to node name + rough position.
    mergeKey = string.format("%s:%s:%d:%d", p.target or "?", tostring(mapID), math.floor(x or 0), math.floor(y or 0))
  end

  local rec = recent[mergeKey]
  local entry
  if rec and (t - rec.lastT) <= TAP_MERGE_WINDOW then
    entry = rec.entry
    entry.taps = entry.taps + 1
    entry.lastT = t
    rec.lastT = t
  else
    NodeLogDB.seq = NodeLogDB.seq + 1
    local skill, skillBonus = professionSkill(p.kind)
    entry = {
      id = string.format("%s-%s-%d-%d", GetRealmName() or "?", UnitName("player") or "?", t, NodeLogDB.seq),
      realm = GetRealmName(),
      character = UnitName("player"),
      t = t,
      lastT = t,
      kind = p.kind,
      node = p.target,
      guid = guid,
      objectId = parseObjectId(guid),
      zone = GetRealZoneText(),
      subzone = GetSubZoneText(),
      mapId = mapID,
      x = x,
      y = y,
      level = UnitLevel("player"),
      skill = skill,
      skillBonus = skillBonus,
      taps = 1,
      items = {},
    }
    table.insert(NodeLogDB.entries, entry)
    recent[mergeKey] = { entry = entry, lastT = t }
  end

  for name, it in pairs(items) do
    local have = entry.items[name]
    if have then
      have.qty = have.qty + it.qty
    else
      entry.items[name] = { id = it.id, name = it.name, qty = it.qty }
    end
  end

  if debugMode then
    local parts = {}
    for name, it in pairs(items) do table.insert(parts, it.qty .. "x " .. name) end
    say(string.format("%s tap %d: %s", entry.node or "?", entry.taps, table.concat(parts, ", ")))
  end
end

local function printStats()
  local byNode = {}
  for _, e in ipairs(NodeLogDB.entries) do
    local key = e.node or "?"
    local s = byNode[key]
    if not s then
      s = { visits = 0, crystals = 0, pitchblende = 0 }
      byNode[key] = s
    end
    s.visits = s.visits + 1
    for name, it in pairs(e.items) do
      if name == "Arcane Crystal" then s.crystals = s.crystals + it.qty end
      if name == "Pitchblende" then s.pitchblende = s.pitchblende + it.qty end
    end
  end
  say(string.format("%d visits logged.", #NodeLogDB.entries))
  for node, s in pairs(byNode) do
    say(string.format("  %s: %d visits, %d Arcane Crystal, %d Pitchblende", node, s.visits, s.crystals, s.pitchblende))
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("UNIT_SPELLCAST_SENT")
frame:RegisterEvent("UNIT_SPELLCAST_SUCCEEDED")
frame:RegisterEvent("UNIT_SPELLCAST_FAILED")
frame:RegisterEvent("UNIT_SPELLCAST_INTERRUPTED")
frame:RegisterEvent("LOOT_READY")
frame:RegisterEvent("LOOT_OPENED")
frame:RegisterEvent("LOOT_CLOSED")

frame:SetScript("OnEvent", function(_, event, ...)
  if event == "ADDON_LOADED" then
    if ... ~= ADDON_NAME then return end
    NodeLogDB = NodeLogDB or {}
    NodeLogDB.version = DB_VERSION
    NodeLogDB.seq = NodeLogDB.seq or 0
    NodeLogDB.entries = NodeLogDB.entries or {}
    buildSpellLookup()
    frame:UnregisterEvent("ADDON_LOADED")

  elseif event == "UNIT_SPELLCAST_SENT" then
    local unit, target, castGUID, spellID = ...
    if unit ~= "player" then return end
    local kind, name = gatherKindForSpell(spellID)
    if debugMode then
      say(string.format("cast: %s (spell %s) on %s -> %s", tostring(name), tostring(spellID), tostring(target), kind or "ignored"))
    end
    if kind then
      pending = { kind = kind, target = target, castGUID = castGUID, sentAt = GetTime() }
    end

  elseif event == "UNIT_SPELLCAST_SUCCEEDED" then
    local unit, castGUID = ...
    if unit == "player" and pending and pending.castGUID == castGUID then
      pending.doneAt = GetTime()
    end

  elseif event == "UNIT_SPELLCAST_FAILED" or event == "UNIT_SPELLCAST_INTERRUPTED" then
    local unit, castGUID = ...
    if unit == "player" and pending and pending.castGUID == castGUID then
      pending = nil
    end

  elseif event == "LOOT_READY" or event == "LOOT_OPENED" then
    logLoot()

  elseif event == "LOOT_CLOSED" then
    handledThisWindow = false
  end
end)

SLASH_NODELOG1 = "/nodelog"
SlashCmdList.NODELOG = function(msg)
  msg = strtrim(msg or ""):lower()
  if msg == "debug" then
    debugMode = not debugMode
    say("debug " .. (debugMode and "on: every logged tap is printed." or "off."))
  elseif msg == "clear confirm" then
    wipe(NodeLogDB.entries)
    wipe(recent)
    say("all entries cleared.")
  elseif msg == "clear" then
    say("this deletes every logged entry. Import first, then type /nodelog clear confirm")
  else
    printStats()
    say("commands: /nodelog, /nodelog debug, /nodelog clear")
  end
end
