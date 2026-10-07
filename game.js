/**
 * Ruin Wars — core game loop (v0.8). Content tables live in content.js, pure formulas in formulas.js.
 * Quests (Energy) across Regions + mastery/story/requirements, The Lists (Stamina/Health, odds-based
 * bouts), Bosses, Knight Band, Holdings (passive gold), Loot/Inventory (region tiers, equip, sell),
 * Collections, shop upgrades + ranked training.
 * Persist: localStorage SAVE_KEY (legacy v0.3 key migrated on load)
 */

(function () {
  "use strict";

  const SAVE_KEY = "ruin_wars_save_v4";
  const LEGACY_SAVE_KEYS = ["ruin_wars_save_v1"];
  const UNREADABLE_SAVE_KEY = "ruin_wars_save_unreadable"; // copy of a save that failed to load
  const SAVE_VERSION = 6;
  const TICK_MS = 1000;
  const BASE_ENERGY_MAX = 25;
  const BASE_STAMINA_MAX = 20;
  const BASE_HEALTH_MAX = 100;
  const BASE_REGEN_MS = 12000;
  const STAMINA_REGEN_MS = 18000;
  const HEALTH_REGEN_MS = 20000;
  const LOG_MAX = 50; // chronicle lines kept in memory and persisted in the save
  const SAVE_INTERVAL_MS = 8000; // tick-driven saves are throttled to this when state is dirty
  const LOOT_DROP_CHANCE = 0.22;
  const LOOT_DROP_FIGHT = 0.12;
  const RENOWN_MIN_LEVEL = 30; // level needed to begin a new legend (prestige)
  const RENOWN_GOLD_PER_RANK = 0.1;
  const RENOWN_XP_PER_RANK = 0.1;
  /** Title for renown rank 1, 2, … (the last one repeats for higher ranks). */
  const RENOWN_TITLES = [
    "Errant Knight",
    "Knight of the Round Table",
    "Knight of the Grail",
    "Peer of Logres",
    "Pendragon's Champion",
  ];
  const MASTERY_THRESHOLDS = [5, 15, 40];
  const MASTERY_RANKS = ["Unproven", "Proven", "Veteran", "Master"];
  const HOLDING_CAP_CYCLES = 2;
  const COLLECTION_DROP_QUEST = 0.15;
  const COLLECTION_DROP_FIGHT = 0.1;
  const BAND_ATTACK_PER_RECRUIT = 2;
  const BAND_DEFENSE_PER_RECRUIT = 2;
  const RALLY_COOLDOWN_MS = 10 * 60 * 1000; // free recruit every 10 min

  function questCooldownRemaining(questId) {
    const until = (state.questCooldownUntil && state.questCooldownUntil[questId]) || 0;
    return Math.max(0, until - Date.now());
  }

  function fightCooldownRemaining(foeId) {
    const until = (state.fightCooldownUntil && state.fightCooldownUntil[foeId]) || 0;
    return Math.max(0, until - Date.now());
  }

  function formatSeconds(sec) {
    if (sec < 60) return sec + "s";
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? m + "m " + r + "s" : m + "m";
  }

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // --- Content tables (content.js) and pure formulas (formulas.js) ---

  const F = window.RuinWarsFormulas;
  const {
    REGIONS,
    QUESTS,
    STORY_BEATS,
    BOSS_LEGENDS,
    MASTERY_BONUSES,
    FOES,
    HEALS,
    UPGRADES,
    RANKED_UPGRADES,
    HOLDINGS,
    LOOT,
    COLLECTIONS,
    BOSSES,
    NAMED_KNIGHTS,
  } = window.RuinWarsContent;
  const xpForLevel = F.xpForLevel;
  const formatCooldown = F.formatCooldown;
  const upsetMultiplier = F.upsetMultiplier;
  const msUntilFull = F.msUntilFull;

  function defaultState() {
    return {
      name: "Knight",
      level: 1,
      xp: 0,
      gold: 0,
      energy: BASE_ENERGY_MAX,
      energyMax: BASE_ENERGY_MAX,
      stamina: BASE_STAMINA_MAX,
      staminaMax: BASE_STAMINA_MAX,
      health: BASE_HEALTH_MAX,
      healthMax: BASE_HEALTH_MAX,
      fallen: false,
      ownedUpgrades: {},
      upgradeRanks: {},
      renown: 0,
      questCooldownUntil: {},
      fightCooldownUntil: {},
      questCounts: {},
      storyUnlocks: [],
      holdings: {},
      inventory: {},
      equipped: { weapon: null, armor: null },
      region: "camelot",
      collections: {},
      collectionsRedeemed: {},
      bosses: {},
      band: { recruits: 0, named: {}, rallyReadyAt: 0 },
      saveVersion: SAVE_VERSION,
      lastTick: Date.now(),
      energyAccMs: 0,
      staminaAccMs: 0,
      healthAccMs: 0,
    };
  }

  let state = defaultState();
  let logLines = [];

  // --- Mastery helpers ---

  function questCount(questId) {
    return (state.questCounts && state.questCounts[questId]) || 0;
  }

  function masteryTier(questId) {
    const c = questCount(questId);
    let tier = 0;
    for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
      if (c >= MASTERY_THRESHOLDS[i]) tier = i + 1;
    }
    return tier;
  }

  function masteryRankName(questId) {
    return MASTERY_RANKS[masteryTier(questId)] || MASTERY_RANKS[0];
  }

  function masteryBonusForQuest(questId) {
    const tier = masteryTier(questId);
    let goldAdd = 0;
    let xpAdd = 0;
    for (let t = 1; t <= tier; t++) {
      const b = MASTERY_BONUSES[t];
      if (b) {
        goldAdd += b.goldAdd;
        xpAdd += b.xpAdd;
      }
    }
    return { goldAdd: goldAdd, xpAdd: xpAdd };
  }

  function nextMasteryHint(questId) {
    const c = questCount(questId);
    for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
      if (c < MASTERY_THRESHOLDS[i]) {
        return MASTERY_THRESHOLDS[i] - c + " to " + MASTERY_RANKS[i + 1];
      }
    }
    return "Max rank";
  }

  // --- Loot / equip bonuses ---

  function getLootDef(itemId) {
    return LOOT.find(function (L) {
      return L.id === itemId;
    });
  }

  function inventoryCount(itemId) {
    return (state.inventory && state.inventory[itemId]) || 0;
  }

  /** The loot def equipped in a slot, if it is still owned. */
  function equippedItem(slot) {
    const id = state.equipped && state.equipped[slot];
    const item = id ? getLootDef(id) : null;
    return item && inventoryCount(item.id) > 0 ? item : null;
  }

  function collectEquipEffects() {
    let attack = 0;
    let defense = 0;
    let goldMult = 0;
    let xpMult = 0;

    function applyEffect(eff) {
      if (!eff) return;
      if (eff.attack) attack += eff.attack;
      if (eff.defense) defense += eff.defense;
      if (eff.goldMult) goldMult += eff.goldMult;
      if (eff.xpMult) xpMult += eff.xpMult;
    }

    const w = equippedItem("weapon");
    if (w) applyEffect(w.effect);
    const a = equippedItem("armor");
    if (a) applyEffect(a.effect);
    // Relics: passive if owned (count > 0)
    LOOT.forEach(function (L) {
      if (L.slot === "relic" && inventoryCount(L.id) > 0) {
        applyEffect(L.effect);
      }
    });

    return { attack: attack, defense: defense, goldMult: goldMult, xpMult: xpMult };
  }

  // --- Regions ---

  function getRegion(regionId) {
    return REGIONS.find(function (r) {
      return r.id === regionId;
    });
  }

  function regionUnlocked(region) {
    return !!region && state.level >= region.minLevel;
  }

  function currentRegion() {
    const r = getRegion(state.region);
    return regionUnlocked(r) ? r : REGIONS[0];
  }

  function getQuest(questId) {
    return QUESTS.find(function (q) {
      return q.id === questId;
    });
  }

  // --- Collections ---

  function getCollection(setId) {
    return COLLECTIONS.find(function (c) {
      return c.id === setId;
    });
  }

  function findPiece(pieceId) {
    for (let i = 0; i < COLLECTIONS.length; i++) {
      const p = COLLECTIONS[i].pieces.find(function (x) {
        return x.id === pieceId;
      });
      if (p) return { set: COLLECTIONS[i], piece: p };
    }
    return null;
  }

  function pieceCount(pieceId) {
    return (state.collections && state.collections[pieceId]) || 0;
  }

  function collectionComplete(set) {
    return set.pieces.every(function (p) {
      return pieceCount(p.id) > 0;
    });
  }

  function collectionRedeemed(setId) {
    return !!(state.collectionsRedeemed && state.collectionsRedeemed[setId]);
  }

  /** Sum of permanent bonuses from redeemed sets */
  function collectionBonuses() {
    const b = { attack: 0, defense: 0, energyMax: 0, staminaMax: 0, goldMult: 0, xpMult: 0 };
    COLLECTIONS.forEach(function (set) {
      if (!collectionRedeemed(set.id)) return;
      for (const k in set.bonus) {
        if (Object.prototype.hasOwnProperty.call(b, k)) b[k] += set.bonus[k];
      }
    });
    return b;
  }

  /** Weighted roll; preferMissing biases toward pieces not yet owned (boss drops) */
  function rollCollectionPiece(set, preferMissing) {
    let pool = set.pieces;
    if (preferMissing) {
      const missing = set.pieces.filter(function (p) {
        return pieceCount(p.id) <= 0;
      });
      if (missing.length) pool = missing;
    }
    const total = pool.reduce(function (sum, p) {
      return sum + p.weight;
    }, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function grantCollectionPiece(set, piece) {
    if (!state.collections) state.collections = {};
    state.collections[piece.id] = (state.collections[piece.id] || 0) + 1;
    const n = state.collections[piece.id];
    addLog(
      "Collection: found " +
        piece.name +
        " (" +
        set.name +
        ")" +
        (n > 1 ? " — duplicate ×" + n + "." : "!")
    );
    if (n === 1 && collectionComplete(set) && !collectionRedeemed(set.id)) {
      addLog(set.name + " is complete! Redeem it in Collections.");
    }
  }

  // --- Knight band ---

  function bandState() {
    if (!state.band || typeof state.band !== "object") {
      state.band = { recruits: 0, named: {}, rallyReadyAt: 0 };
    }
    if (typeof state.band.recruits !== "number") state.band.recruits = 0;
    if (!state.band.named || typeof state.band.named !== "object") state.band.named = {};
    if (typeof state.band.rallyReadyAt !== "number") state.band.rallyReadyAt = 0;
    return state.band;
  }

  function bandCap() {
    return F.bandCap(state.level);
  }

  function namedKnightsOwned() {
    const b = bandState();
    return NAMED_KNIGHTS.filter(function (k) {
      return !!b.named[k.id];
    });
  }

  function bandSize() {
    return bandState().recruits + namedKnightsOwned().length;
  }

  function hireCost() {
    return F.hireCost(bandState().recruits);
  }

  function rallyRemaining() {
    return Math.max(0, bandState().rallyReadyAt - Date.now());
  }

  function bandBonuses() {
    const b = bandState();
    let attack = b.recruits * BAND_ATTACK_PER_RECRUIT;
    let defense = b.recruits * BAND_DEFENSE_PER_RECRUIT;
    let xpMult = 0;
    namedKnightsOwned().forEach(function (k) {
      attack += k.attack || 0;
      defense += k.defense || 0;
      xpMult += k.xpMult || 0;
    });
    return { attack: attack, defense: defense, xpMult: xpMult };
  }

  function bossDamageBonus(bossId) {
    let m = 0;
    namedKnightsOwned().forEach(function (k) {
      if (k.bossDmg && k.bossDmg[bossId]) m += k.bossDmg[bossId];
      if (k.bossDmgAll) m += k.bossDmgAll;
    });
    return m;
  }

  // --- Bonuses from shop + equip + mastery ---

  function goldMultiplier(questId) {
    let m = 1;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.goldMult) {
        m += u.effect.goldMult;
      }
    }
    const eq = collectEquipEffects();
    m += eq.goldMult;
    m += collectionBonuses().goldMult;
    m += rankedBonuses().goldMult;
    m += renownBonuses().goldMult;
    if (questId) {
      m += masteryBonusForQuest(questId).goldAdd;
    }
    return m;
  }

  function xpMultiplier(questId) {
    let m = 1;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.xpMult) {
        m += u.effect.xpMult;
      }
    }
    const eq = collectEquipEffects();
    m += eq.xpMult;
    m += collectionBonuses().xpMult;
    m += rankedBonuses().xpMult;
    m += renownBonuses().xpMult;
    m += bandBonuses().xpMult;
    if (questId) {
      m += masteryBonusForQuest(questId).xpAdd;
    }
    return m;
  }

  function attackBonusFromShop() {
    let bonus = 0;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.attackBonus) {
        bonus += u.effect.attackBonus;
      }
    }
    return bonus;
  }

  function upgradeRank(id) {
    return (state.upgradeRanks && state.upgradeRanks[id]) || 0;
  }

  /** Gold for the next rank of a ranked upgrade (null when maxed). */
  function rankedUpgradeCost(def) {
    return F.rankedUpgradeCost(def, upgradeRank(def.id));
  }

  function renownRank() {
    return state.renown || 0;
  }

  function renownTitle(rank) {
    if (!rank) return "";
    return RENOWN_TITLES[Math.min(rank, RENOWN_TITLES.length) - 1];
  }

  function renownBonuses() {
    const r = renownRank();
    return { goldMult: r * RENOWN_GOLD_PER_RANK, xpMult: r * RENOWN_XP_PER_RANK };
  }

  function rankedBonuses() {
    const out = { attack: 0, defense: 0, goldMult: 0, xpMult: 0, energyMax: 0 };
    RANKED_UPGRADES.forEach(function (def) {
      const rank = upgradeRank(def.id);
      if (!rank) return;
      Object.keys(out).forEach(function (k) {
        if (def.effect[k]) out[k] += def.effect[k] * rank;
      });
    });
    return out;
  }

  function regenIntervalMs() {
    let bonus = 0;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.regenMult) {
        bonus += u.effect.regenMult;
      }
    }
    return Math.max(2500, Math.floor(BASE_REGEN_MS / (1 + bonus)));
  }

  /** Attack rating: level + shop + training + gear + band + collections */
  function attackRating() {
    const eq = collectEquipEffects();
    return (
      state.level * 8 +
      attackBonusFromShop() +
      rankedBonuses().attack +
      eq.attack +
      bandBonuses().attack +
      collectionBonuses().attack
    );
  }

  /** Defense rating: soaks a share of fight and boss damage */
  function defenseRating() {
    const eq = collectEquipEffects();
    return (
      state.level * 3 +
      rankedBonuses().defense +
      eq.defense +
      bandBonuses().defense +
      collectionBonuses().defense
    );
  }

  function soakDamage(dmg) {
    return F.soakDamage(dmg, defenseRating());
  }

  /** Chance to win a bout in The Lists against this foe. */
  function fightWinChance(foe) {
    return F.fightWinChance(attackRating(), foe.power);
  }

  // --- Quest requirements ---

  /** Each requirement of a quest with whether it is met: [{ label, met }] */
  function questRequirements(quest) {
    const r = quest.requires;
    if (!r) return [];
    const out = [];
    if (r.band) {
      out.push({ label: r.band + " knights in band", met: bandSize() >= r.band });
    }
    if (r.weapon) {
      out.push({ label: "a weapon equipped", met: !!equippedItem("weapon") });
    }
    if (r.armor) {
      out.push({ label: "armor equipped", met: !!equippedItem("armor") });
    }
    return out;
  }

  function unmetRequirements(quest) {
    return questRequirements(quest).filter(function (req) {
      return !req.met;
    });
  }

  function syncMaxesFromLevel() {
    const cb = collectionBonuses();
    state.energyMax =
      BASE_ENERGY_MAX + (state.level - 1) * 2 + cb.energyMax + rankedBonuses().energyMax;
    state.staminaMax = BASE_STAMINA_MAX + (state.level - 1) * 1 + cb.staminaMax;
    state.healthMax = BASE_HEALTH_MAX + (state.level - 1) * 5;
  }

  function clearFallenIfHealed() {
    if (state.health > 0) {
      state.fallen = false;
    } else {
      state.fallen = true;
      state.health = 0;
    }
  }

  // --- Holdings helpers ---

  function holdingState(id) {
    if (!state.holdings) state.holdings = {};
    if (!state.holdings[id]) {
      state.holdings[id] = {
        owned: false,
        level: 0,
        accMs: 0,
        pending: 0,
      };
    }
    return state.holdings[id];
  }

  function holdingIncomePerCycle(def, h) {
    if (!h.owned) return 0;
    let g = def.baseGold;
    for (let i = 0; i < h.level && i < def.upgradeGoldAdd.length; i++) {
      g += def.upgradeGoldAdd[i];
    }
    return g;
  }

  function holdingCap(def, h) {
    return holdingIncomePerCycle(def, h) * HOLDING_CAP_CYCLES;
  }

  function accrueHolding(def, h, elapsedMs) {
    if (!h.owned) return;
    const cycleMs = def.cycleSec * 1000;
    const cap = holdingCap(def, h);
    if (h.pending >= cap) {
      h.accMs = 0;
      return;
    }
    h.accMs = (h.accMs || 0) + elapsedMs;
    const income = holdingIncomePerCycle(def, h);
    while (h.accMs >= cycleMs && h.pending < cap) {
      h.accMs -= cycleMs;
      h.pending = Math.min(cap, h.pending + income);
    }
    if (h.pending >= cap) h.accMs = 0;
  }

  function accrueAllHoldings(elapsedMs) {
    HOLDINGS.forEach(function (def) {
      accrueHolding(def, holdingState(def.id), elapsedMs);
    });
  }

  // --- Boss helpers ---

  function getBoss(bossId) {
    return BOSSES.find(function (b) {
      return b.id === bossId;
    });
  }

  function bossState(def) {
    if (!state.bosses || typeof state.bosses !== "object") state.bosses = {};
    let b = state.bosses[def.id];
    if (!b || typeof b !== "object") {
      b = state.bosses[def.id] = { hp: def.maxHp, kills: 0, respawnAt: 0, regenAccMs: 0 };
    }
    if (typeof b.hp !== "number" || b.hp > def.maxHp) b.hp = def.maxHp;
    if (typeof b.kills !== "number") b.kills = 0;
    if (typeof b.respawnAt !== "number") b.respawnAt = 0;
    if (typeof b.regenAccMs !== "number") b.regenAccMs = 0;
    return b;
  }

  function bossRespawnRemaining(def) {
    return Math.max(0, bossState(def).respawnAt - Date.now());
  }

  /** Respawn after cooldown; slow HP regen while alive */
  function accrueBoss(def, elapsedMs) {
    const b = bossState(def);
    if (b.respawnAt) {
      if (Date.now() >= b.respawnAt) {
        b.respawnAt = 0;
        b.hp = def.maxHp;
        b.regenAccMs = 0;
      }
      return;
    }
    if (b.hp >= def.maxHp) {
      b.regenAccMs = 0;
      return;
    }
    const msPerHp = 60000 / def.regenPerMin;
    b.regenAccMs += elapsedMs;
    const gained = Math.floor(b.regenAccMs / msPerHp);
    if (gained > 0) {
      b.regenAccMs -= gained * msPerHp;
      b.hp = Math.min(def.maxHp, b.hp + gained);
    }
  }

  function accrueAllBosses(elapsedMs) {
    BOSSES.forEach(function (def) {
      accrueBoss(def, elapsedMs);
    });
  }

  // --- Loot roll ---

  /** Weighted roll from one region's loot pool (boss uniques never roll randomly). */
  function rollLootDrop(regionId) {
    const pool = LOOT.filter(function (L) {
      return L.weight > 0 && L.region === (regionId || "camelot");
    });
    const total = pool.reduce(function (s, L) {
      return s + L.weight;
    }, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function grantLoot(item) {
    if (!state.inventory) state.inventory = {};
    state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;
    addLog("Loot: found " + item.name + "!");
  }

  // --- Persistence ---

  /** Everything persisted: state plus the chronicle. Also the body of a backup code. */
  function savePayload() {
    return {
      ...state,
      saveVersion: SAVE_VERSION,
      lastTick: Date.now(),
      log: logLines.slice(0, LOG_MAX),
    };
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(savePayload()));
      saveDirty = false;
      lastSaveAt = Date.now();
      lastSaveSig = saveSignature();
    } catch (e) {
      // ignore quota / private mode
    }
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
      let migratedFrom = null;
      if (!raw) {
        // v0.3 and earlier saved under the legacy key — migrate (legacy copy is left untouched)
        for (let i = 0; i < LEGACY_SAVE_KEYS.length && !raw; i++) {
          raw = localStorage.getItem(LEGACY_SAVE_KEYS[i]);
          if (raw) migratedFrom = LEGACY_SAVE_KEYS[i];
        }
      }
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      applySaveData(data, migratedFrom);
    } catch (e) {
      // Starting fresh would overwrite the unreadable save on the next save(), so keep a copy first.
      console.error("Ruin Wars: the save could not be loaded; a copy was kept under " + UNREADABLE_SAVE_KEY, e);
      try {
        if (raw) localStorage.setItem(UNREADABLE_SAVE_KEY, raw);
      } catch (e2) {
        // storage unavailable: nothing more we can do
      }
      state = defaultState();
      logLines = [];
      addLog(
        "Your save could not be read, so a new knight takes up the quest. The old save was kept; " +
          "ask for help recovering it (key " + UNREADABLE_SAVE_KEY + ")."
      );
    }
  }

  /** Load a parsed save object into the game, filling defaults for missing fields and migrating old versions. */
  function applySaveData(data, migratedFrom) {
    state = { ...defaultState(), ...data };
    // Chronicle log lives outside state; older saves simply have no log field.
    delete state.log;
    logLines = Array.isArray(data.log)
      ? data.log
          .filter(function (line) {
            return typeof line === "string";
          })
          .slice(0, LOG_MAX)
      : [];
    if (!state.questCooldownUntil || typeof state.questCooldownUntil !== "object") {
      state.questCooldownUntil = {};
    }
    if (!state.fightCooldownUntil || typeof state.fightCooldownUntil !== "object") {
      state.fightCooldownUntil = {};
    }
    if (!state.ownedUpgrades || typeof state.ownedUpgrades !== "object") {
      state.ownedUpgrades = {};
    }
    // v0.5 fields
    if (!state.upgradeRanks || typeof state.upgradeRanks !== "object") {
      state.upgradeRanks = {};
    }
    // v0.7 fields
    if (typeof state.renown !== "number" || state.renown < 0) state.renown = 0;
    state.renown = Math.floor(state.renown);
    if (!state.questCounts || typeof state.questCounts !== "object") {
      state.questCounts = {};
    }
    if (!Array.isArray(state.storyUnlocks)) {
      state.storyUnlocks = [];
    }
    if (!state.holdings || typeof state.holdings !== "object") {
      state.holdings = {};
    }
    if (!state.inventory || typeof state.inventory !== "object") {
      state.inventory = {};
    }
    if (!state.equipped || typeof state.equipped !== "object") {
      state.equipped = { weapon: null, armor: null };
    }
    if (state.equipped.weapon === undefined) state.equipped.weapon = null;
    if (state.equipped.armor === undefined) state.equipped.armor = null;
    // v0.4 fields
    if (typeof state.level !== "number" || state.level < 1) state.level = 1;
    if (!state.collections || typeof state.collections !== "object") state.collections = {};
    if (!state.collectionsRedeemed || typeof state.collectionsRedeemed !== "object") {
      state.collectionsRedeemed = {};
    }
    if (!state.bosses || typeof state.bosses !== "object") state.bosses = {};
    BOSSES.forEach(function (def) {
      bossState(def);
    });
    bandState();
    if (!getRegion(state.region) || !regionUnlocked(getRegion(state.region))) {
      state.region = "camelot";
    }
    const oldVersion = typeof data.saveVersion === "number" ? data.saveVersion : 3;
    state.saveVersion = SAVE_VERSION;
    syncMaxesFromLevel();
    if (typeof state.stamina !== "number") state.stamina = state.staminaMax;
    if (typeof state.health !== "number") state.health = state.healthMax;
    state.energy = Math.min(state.energy, state.energyMax);
    state.stamina = Math.min(state.stamina, state.staminaMax);
    state.health = Math.min(Math.max(0, state.health), state.healthMax);
    clearFallenIfHealed();
    applyOfflineRegen();
    if (migratedFrom || oldVersion < 4) {
      addLog(
        "Save migrated to v0.4 — Regions, Bosses, Knight Band and Collections are now open to you."
      );
    }
    if (migratedFrom || oldVersion < 5) {
      addLog(
        "Save updated to v0.5 — ranked training in the Armory, stronger loot in Avalon and the Wastes, " +
          "selling spare loot, odds-based bouts in The Lists, and band / gear requirements on later quests."
      );
    }
    if (migratedFrom || oldVersion < SAVE_VERSION) {
      addLog(
        "Save updated to v0.7 — the Questing Beast waits at Level 30, and knights of Level 30 can " +
          "begin a new legend for Renown (see the Chronicle tab)."
      );
      save();
    }
  }

  function applyOfflineRegen() {
    const now = Date.now();
    const elapsed = Math.max(0, now - (state.lastTick || now));
    state.lastTick = now;

    const eInterval = regenIntervalMs();
    const eTotal = (state.energyAccMs || 0) + elapsed;
    const eGained = Math.floor(eTotal / eInterval);
    state.energyAccMs = eTotal % eInterval;
    if (eGained > 0) {
      state.energy = Math.min(state.energyMax, state.energy + eGained);
    }

    const sTotal = (state.staminaAccMs || 0) + elapsed;
    const sGained = Math.floor(sTotal / STAMINA_REGEN_MS);
    state.staminaAccMs = sTotal % STAMINA_REGEN_MS;
    if (sGained > 0) {
      state.stamina = Math.min(state.staminaMax, state.stamina + sGained);
    }

    if (state.health < state.healthMax) {
      const hTotal = (state.healthAccMs || 0) + elapsed;
      const hGained = Math.floor(hTotal / HEALTH_REGEN_MS);
      state.healthAccMs = hTotal % HEALTH_REGEN_MS;
      if (hGained > 0) {
        state.health = Math.min(state.healthMax, state.health + hGained);
        clearFallenIfHealed();
      }
    } else {
      state.healthAccMs = 0;
    }

    accrueAllHoldings(elapsed);
    accrueAllBosses(elapsed);
  }

  // --- Game actions ---

  function addLog(msg) {
    logLines.unshift(msg);
    if (logLines.length > LOG_MAX) logLines.length = LOG_MAX;
  }

  function tryLevelUp() {
    let leveled = false;
    while (state.xp >= xpForLevel(state.level)) {
      state.xp -= xpForLevel(state.level);
      state.level += 1;
      syncMaxesFromLevel();
      state.energy = state.energyMax;
      state.stamina = Math.min(state.staminaMax, state.stamina + 5);
      leveled = true;
      addLog(
        "You rise to Level " +
          state.level +
          "! Max Energy " +
          state.energyMax +
          ", Stamina " +
          state.staminaMax +
          ", Health " +
          state.healthMax +
          "."
      );
      REGIONS.forEach(function (r) {
        if (r.minLevel === state.level) {
          addLog("New region unlocked: " + r.name + "! Switch regions above the quest board.");
        }
      });
      BOSSES.forEach(function (b) {
        if (b.minLevel === state.level) {
          addLog(b.name + " will now face you. See Bosses.");
        }
      });
    }
    return leveled;
  }

  function unlockStoryBeat(questId, threshold) {
    const beats = STORY_BEATS[questId];
    if (!beats || !beats[threshold]) return;
    const already = state.storyUnlocks.some(function (s) {
      return s.questId === questId && s.threshold === threshold;
    });
    if (already) return;
    const quest = QUESTS.find(function (q) {
      return q.id === questId;
    });
    const rankIdx = MASTERY_THRESHOLDS.indexOf(threshold) + 1;
    const entry = {
      questId: questId,
      threshold: threshold,
      rank: MASTERY_RANKS[rankIdx] || "Master",
      questName: quest ? quest.name : questId,
      text: beats[threshold],
      at: Date.now(),
    };
    state.storyUnlocks.push(entry);
    addLog("Legend unlocked (" + entry.rank + " — " + entry.questName + "). See Legends below.");
  }

  function checkMasteryMilestones(questId, newCount) {
    for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
      const t = MASTERY_THRESHOLDS[i];
      if (newCount === t) {
        const rank = MASTERY_RANKS[i + 1];
        const bonus = MASTERY_BONUSES[i + 1];
        const parts = [];
        if (bonus.goldAdd) parts.push("+" + Math.round(bonus.goldAdd * 100) + "% gold on this quest");
        if (bonus.xpAdd) parts.push("+" + Math.round(bonus.xpAdd * 100) + "% XP on this quest");
        addLog(
          "Mastery: \"" +
            (QUESTS.find(function (q) {
              return q.id === questId;
            }) || { name: questId }).name +
            "\" → " +
            rank +
            "!" +
            (parts.length ? " (" + parts.join(", ") + ")" : "")
        );
        unlockStoryBeat(questId, t);
      }
    }
  }

  function doQuest(questId) {
    const quest = QUESTS.find(function (q) {
      return q.id === questId;
    });
    if (!quest) return;
    if (state.level < quest.minLevel) {
      addLog("You are not yet ready for \"" + quest.name + "\".");
      render();
      return;
    }
    if (state.energy < quest.energy) {
      addLog("Not enough Energy for \"" + quest.name + "\".");
      render();
      return;
    }
    const cdLeft = questCooldownRemaining(quest.id);
    if (cdLeft > 0) {
      addLog(
        "\"" +
          quest.name +
          "\" is recovering — " +
          formatCooldown(cdLeft) +
          " left."
      );
      render();
      return;
    }
    const unmet = unmetRequirements(quest);
    if (unmet.length) {
      addLog(
        "\"" +
          quest.name +
          "\" needs " +
          unmet
            .map(function (req) {
              return req.label;
            })
            .join(" and ") +
          "."
      );
      render();
      return;
    }

    state.energy -= quest.energy;
    if (!state.questCooldownUntil) state.questCooldownUntil = {};
    state.questCooldownUntil[quest.id] = Date.now() + F.questCooldownMs(quest);

    if (!state.questCounts) state.questCounts = {};
    state.questCounts[quest.id] = (state.questCounts[quest.id] || 0) + 1;
    const newCount = state.questCounts[quest.id];

    const goldGain = Math.floor(quest.gold * goldMultiplier(quest.id));
    const xpGain = Math.floor(quest.xp * xpMultiplier(quest.id));
    state.gold += goldGain;
    state.xp += xpGain;
    addLog(
      "Completed \"" +
        quest.name +
        "\" — +" +
        goldGain +
        " gold, +" +
        xpGain +
        " XP. (" +
        newCount +
        "×, " +
        masteryRankName(quest.id) +
        ")"
    );

    checkMasteryMilestones(quest.id, newCount);

    if (Math.random() < LOOT_DROP_CHANCE) {
      grantLoot(rollLootDrop(quest.region));
    }
    const qSet = COLLECTIONS.find(function (c) {
      return c.region === (quest.region || "camelot");
    });
    if (qSet && Math.random() < COLLECTION_DROP_QUEST) {
      grantCollectionPiece(qSet, rollCollectionPiece(qSet, false));
    }

    tryLevelUp();
    save();
    render();
  }

  function doFight(foeId) {
    const foe = FOES.find(function (f) {
      return f.id === foeId;
    });
    if (!foe) return;

    if (state.level < foe.minLevel) {
      addLog("You are not yet ready to face " + foe.name + ".");
      render();
      return;
    }
    if (state.fallen || state.health <= 0) {
      addLog("You have fallen. Rest at the Chapel before returning to The Lists.");
      render();
      return;
    }
    if (state.stamina < foe.stamina) {
      addLog("Not enough Stamina to challenge " + foe.name + ".");
      render();
      return;
    }
    const cdLeft = fightCooldownRemaining(foe.id);
    if (cdLeft > 0) {
      addLog(
        foe.name + " is not yet ready for another bout — " + formatCooldown(cdLeft) + " left."
      );
      render();
      return;
    }

    state.stamina -= foe.stamina;
    if (!state.fightCooldownUntil) state.fightCooldownUntil = {};
    state.fightCooldownUntil[foe.id] = Date.now() + foe.cooldownMs;

    const odds = fightWinChance(foe);
    const oddsPct = Math.round(odds * 100) + "%";
    const won = Math.random() < odds;

    if (won) {
      const upset = upsetMultiplier(odds);
      const goldGain = Math.floor(foe.gold * goldMultiplier() * upset);
      const xpGain = Math.floor(foe.xp * xpMultiplier() * upset);
      state.gold += goldGain;
      state.xp += xpGain;
      let chip = 0;
      if (Math.random() < 0.25) {
        chip = soakDamage(randInt(1, Math.max(2, Math.floor(foe.dmgMin / 2))));
        state.health = Math.max(0, state.health - chip);
      }
      addLog(
        (upset > 1 ? "Upset! " : "") +
          "Victory over " +
          foe.name +
          "! (" +
          oddsPct +
          " odds) — +" +
          goldGain +
          " gold, +" +
          xpGain +
          " XP" +
          (chip > 0 ? "; took " + chip + " chip damage." : ".")
      );
      if (state.health <= 0) {
        state.fallen = true;
        state.health = 0;
        addLog("The bout left you fallen. Seek the Chapel.");
      }
      // Small fight loot chance
      if (Math.random() < LOOT_DROP_FIGHT) {
        grantLoot(rollLootDrop(foe.region));
      }
      if (Math.random() < COLLECTION_DROP_FIGHT) {
        const openSets = COLLECTIONS.filter(function (c) {
          return regionUnlocked(getRegion(c.region));
        });
        const fSet = openSets[randInt(0, openSets.length - 1)];
        if (fSet) grantCollectionPiece(fSet, rollCollectionPiece(fSet, false));
      }
      tryLevelUp();
    } else {
      const dmg = soakDamage(randInt(foe.dmgMin, foe.dmgMax));
      state.health = Math.max(0, state.health - dmg);
      const pityXp = Math.max(1, Math.floor(foe.xp * 0.1));
      state.xp += pityXp;
      addLog(
        "Defeated by " +
          foe.name +
          " (" +
          oddsPct +
          " odds). Took " +
          dmg +
          " damage. +" +
          pityXp +
          " XP."
      );
      if (state.health <= 0) {
        state.fallen = true;
        state.health = 0;
        addLog("You have fallen on the Field of Honor. Rest at the Chapel to rise again.");
      }
      tryLevelUp();
    }

    save();
    render();
  }

  function setRegion(regionId) {
    const r = getRegion(regionId);
    if (!r) return;
    if (!regionUnlocked(r)) {
      addLog(r.name + " opens at Level " + r.minLevel + ".");
      render();
      return;
    }
    if (state.region === r.id) return;
    state.region = r.id;
    addLog("You ride for " + r.name + ".");
    save();
    render();
  }

  function doBossStrike(bossId) {
    const def = getBoss(bossId);
    if (!def) return;
    const b = bossState(def);
    if (state.level < def.minLevel) {
      addLog("You are not yet ready to face " + def.name + " (Level " + def.minLevel + ").");
      render();
      return;
    }
    const respawn = bossRespawnRemaining(def);
    if (respawn > 0) {
      addLog(def.name + " has not yet returned — " + formatCooldown(respawn) + " left.");
      render();
      return;
    }
    if (state.fallen || state.health <= 0) {
      addLog("You have fallen. Rest at the Chapel before facing " + def.name + ".");
      render();
      return;
    }
    if (state.stamina < def.stamina) {
      addLog("Not enough Stamina to strike " + def.name + ".");
      render();
      return;
    }

    state.stamina -= def.stamina;
    const roll = 0.85 + Math.random() * 0.3;
    const dmg = Math.max(1, Math.floor(attackRating() * roll * (1 + bossDamageBonus(def.id))));
    b.hp = Math.max(0, b.hp - dmg);
    const strikeGold = Math.floor(def.strikeGold * goldMultiplier());
    const strikeXp = Math.floor(def.strikeXp * xpMultiplier());
    state.gold += strikeGold;
    state.xp += strikeXp;

    if (b.hp <= 0) {
      b.kills += 1;
      b.respawnAt = Date.now() + def.respawnMs;
      b.regenAccMs = 0;
      const goldGain = Math.floor(def.gold * goldMultiplier());
      const xpGain = Math.floor(def.xp * xpMultiplier());
      state.gold += goldGain;
      state.xp += xpGain;
      addLog(
        "You strike " +
          def.name +
          " for " +
          dmg +
          " — and " +
          def.name +
          " falls! +" +
          (goldGain + strikeGold) +
          " gold, +" +
          (xpGain + strikeXp) +
          " XP. (kill #" +
          b.kills +
          ")"
      );
      const loot = getLootDef(def.lootId);
      if (loot) grantLoot(loot);
      const set = getCollection(def.collectionId);
      if (set) grantCollectionPiece(set, rollCollectionPiece(set, true));
      const legendId = "boss_" + def.id;
      const hasLegend = state.storyUnlocks.some(function (u) {
        return u.questId === legendId;
      });
      if (!hasLegend && BOSS_LEGENDS[def.id]) {
        state.storyUnlocks.push({
          questId: legendId,
          threshold: 0,
          rank: "Boss Slain",
          questName: def.name,
          text: BOSS_LEGENDS[def.id],
          at: Date.now(),
        });
        addLog("Legend unlocked (Boss Slain — " + def.name + "). See Legends below.");
      }
      addLog(def.name + " returns in " + def.respawnLabel + ".");
    } else {
      const counter = soakDamage(randInt(def.dmgMin, def.dmgMax));
      state.health = Math.max(0, state.health - counter);
      addLog(
        "You strike " +
          def.name +
          " for " +
          dmg +
          " (" +
          b.hp +
          "/" +
          def.maxHp +
          " HP left) — +" +
          strikeGold +
          " gold, +" +
          strikeXp +
          " XP. The counterblow deals " +
          counter +
          " damage."
      );
      if (state.health <= 0) {
        state.fallen = true;
        state.health = 0;
        addLog(def.name + " has laid you low. Rest at the Chapel; the wounds you dealt remain.");
      }
    }
    tryLevelUp();
    save();
    render();
  }

  function hireRecruit() {
    const band = bandState();
    const cap = bandCap();
    if (band.recruits >= cap) {
      addLog("Your band is at its cap (" + cap + "). Gain levels to lead more knights.");
      render();
      return;
    }
    const cost = hireCost();
    if (state.gold < cost) {
      addLog("Need " + cost + " gold to hire a sworn knight.");
      render();
      return;
    }
    state.gold -= cost;
    band.recruits += 1;
    addLog(
      "A sworn knight joins your band for " +
        cost +
        " gold. Band " +
        bandSize() +
        " (" +
        band.recruits +
        "/" +
        cap +
        " sworn)."
    );
    save();
    render();
  }

  function rallyRecruit() {
    const band = bandState();
    const cap = bandCap();
    if (band.recruits >= cap) {
      addLog("Your band is at its cap (" + cap + "). Gain levels to lead more knights.");
      render();
      return;
    }
    const left = rallyRemaining();
    if (left > 0) {
      addLog("The muster horn is still echoing — rally again in " + formatCooldown(left) + ".");
      render();
      return;
    }
    band.recruits += 1;
    band.rallyReadyAt = Date.now() + RALLY_COOLDOWN_MS;
    addLog(
      "You sound the muster horn; a wandering knight answers freely. Band " + bandSize() + "."
    );
    save();
    render();
  }

  function recruitNamed(knightId) {
    const k = NAMED_KNIGHTS.find(function (n) {
      return n.id === knightId;
    });
    if (!k) return;
    const band = bandState();
    if (band.named[k.id]) {
      addLog(k.name + " already rides with you.");
      render();
      return;
    }
    if (state.level < k.minLevel) {
      addLog(k.name + " will only follow a Level " + k.minLevel + " knight.");
      render();
      return;
    }
    if (state.gold < k.cost) {
      addLog("Need " + k.cost + " gold to win " + k.name + " to your banner.");
      render();
      return;
    }
    state.gold -= k.cost;
    band.named[k.id] = true;
    addLog(k.name + " swears to your banner! (+" + k.attack + " atk, +" + k.defense + " def)");
    save();
    render();
  }

  function redeemCollection(setId) {
    const set = getCollection(setId);
    if (!set) return;
    if (collectionRedeemed(set.id)) {
      addLog(set.name + " has already been redeemed.");
      render();
      return;
    }
    if (!collectionComplete(set)) {
      addLog(set.name + " is not complete yet.");
      render();
      return;
    }
    set.pieces.forEach(function (p) {
      state.collections[p.id] -= 1;
    });
    if (!state.collectionsRedeemed) state.collectionsRedeemed = {};
    state.collectionsRedeemed[set.id] = true;
    const oldEMax = state.energyMax;
    const oldSMax = state.staminaMax;
    syncMaxesFromLevel();
    state.energy += Math.max(0, state.energyMax - oldEMax);
    state.stamina += Math.max(0, state.staminaMax - oldSMax);
    addLog("Redeemed " + set.name + "! Permanent bonus: " + set.bonusDesc + ".");
    save();
    render();
  }

  function doHeal(healId) {
    const pack = HEALS.find(function (h) {
      return h.id === healId;
    });
    if (!pack) return;

    if (state.health >= state.healthMax) {
      addLog("You are already at full Health.");
      render();
      return;
    }
    if (state.gold < pack.cost) {
      addLog("Need " + pack.cost + " gold for " + pack.name + ".");
      render();
      return;
    }

    state.gold -= pack.cost;
    const before = state.health;
    if (pack.heal === "full") {
      state.health = state.healthMax;
    } else {
      state.health = Math.min(state.healthMax, state.health + pack.heal);
    }
    const gained = state.health - before;
    clearFallenIfHealed();
    addLog(
      "Chapel: " +
        pack.name +
        " — restored " +
        gained +
        " Health (" +
        state.health +
        "/" +
        state.healthMax +
        ")."
    );
    save();
    render();
  }

  function buyUpgrade(upgradeId) {
    const up = UPGRADES.find(function (u) {
      return u.id === upgradeId;
    });
    if (!up) return;
    if (state.ownedUpgrades[up.id]) {
      addLog("You already own " + up.name + ".");
      render();
      return;
    }
    if (state.gold < up.cost) {
      addLog("Need " + up.cost + " gold for " + up.name + ".");
      render();
      return;
    }
    state.gold -= up.cost;
    state.ownedUpgrades[up.id] = true;
    addLog("Purchased " + up.name + ".");
    save();
    render();
  }

  function buyRankedUpgrade(upgradeId) {
    const def = RANKED_UPGRADES.find(function (u) {
      return u.id === upgradeId;
    });
    if (!def) return;
    const cost = rankedUpgradeCost(def);
    if (cost === null) {
      addLog(def.name + " is already at its highest rank.");
      render();
      return;
    }
    if (state.gold < cost) {
      addLog("Need " + cost + " gold for the next rank of " + def.name + ".");
      render();
      return;
    }
    state.gold -= cost;
    if (!state.upgradeRanks) state.upgradeRanks = {};
    state.upgradeRanks[def.id] = upgradeRank(def.id) + 1;
    if (def.effect.energyMax) {
      syncMaxesFromLevel();
      state.energy = Math.min(state.energyMax, state.energy + def.effect.energyMax);
    }
    addLog(def.name + " trained to rank " + upgradeRank(def.id) + " (" + cost + " gold).");
    save();
    render();
  }

  function buyHolding(holdingId) {
    const def = HOLDINGS.find(function (h) {
      return h.id === holdingId;
    });
    if (!def) return;
    const h = holdingState(def.id);
    if (h.owned) {
      addLog("You already hold " + def.name + ".");
      render();
      return;
    }
    if (state.level < def.minLevel) {
      addLog("Need Level " + def.minLevel + " for " + def.name + ".");
      render();
      return;
    }
    if (state.gold < def.cost) {
      addLog("Need " + def.cost + " gold for " + def.name + ".");
      render();
      return;
    }
    state.gold -= def.cost;
    h.owned = true;
    h.level = 0;
    h.accMs = 0;
    h.pending = 0;
    addLog("Acquired holding: " + def.name + ".");
    save();
    render();
  }

  function upgradeHolding(holdingId) {
    const def = HOLDINGS.find(function (h) {
      return h.id === holdingId;
    });
    if (!def) return;
    const h = holdingState(def.id);
    if (!h.owned) {
      addLog("Buy " + def.name + " first.");
      render();
      return;
    }
    if (h.level >= def.maxLevel) {
      addLog(def.name + " is fully improved.");
      render();
      return;
    }
    const cost = def.upgradeCost[h.level];
    if (state.gold < cost) {
      addLog("Need " + cost + " gold to upgrade " + def.name + ".");
      render();
      return;
    }
    state.gold -= cost;
    h.level += 1;
    addLog(
      "Upgraded " +
        def.name +
        " to rank " +
        h.level +
        " (+" +
        def.upgradeGoldAdd[h.level - 1] +
        " gold/cycle)."
    );
    save();
    render();
  }

  function collectHolding(holdingId) {
    const def = HOLDINGS.find(function (h) {
      return h.id === holdingId;
    });
    if (!def) return;
    const h = holdingState(def.id);
    if (!h.owned) return;
    const amt = Math.floor(h.pending || 0);
    if (amt <= 0) {
      addLog(def.name + " has nothing to collect yet.");
      render();
      return;
    }
    h.pending = 0;
    state.gold += amt;
    addLog("Collected " + amt + " gold from " + def.name + ".");
    save();
    render();
  }

  function equipItem(itemId) {
    const item = getLootDef(itemId);
    if (!item) return;
    if (inventoryCount(itemId) <= 0) {
      addLog("You do not own " + item.name + ".");
      render();
      return;
    }
    if (item.slot === "relic") {
      addLog(item.name + " is a kept relic — its blessing is already active.");
      render();
      return;
    }
    if (!state.equipped) state.equipped = { weapon: null, armor: null };
    state.equipped[item.slot] = itemId;
    addLog("Equipped " + item.name + ".");
    save();
    render();
  }

  /** Copies of an item that can be sold without losing its effect (keeps the last kept relic / equipped piece). */
  function sellableCount(item) {
    const count = inventoryCount(item.id);
    const keepsOne =
      item.slot === "relic" || (state.equipped && state.equipped[item.slot] === item.id);
    return Math.max(0, keepsOne ? count - 1 : count);
  }

  function sellItem(itemId) {
    const item = getLootDef(itemId);
    if (!item) return;
    if (sellableCount(item) <= 0) {
      addLog(
        item.slot === "relic"
          ? "You keep your last " + item.name + " — its blessing would be lost."
          : "Unequip " + item.name + " before selling your last one."
      );
      render();
      return;
    }
    state.inventory[item.id] -= 1;
    state.gold += item.value;
    addLog("Sold " + item.name + " for " + item.value + " gold.");
    save();
    render();
  }

  /** Spares = every copy beyond the first of each item. */
  function spareTotals() {
    let count = 0;
    let gold = 0;
    LOOT.forEach(function (item) {
      const spare = Math.max(0, inventoryCount(item.id) - 1);
      count += spare;
      gold += spare * item.value;
    });
    return { count: count, gold: gold };
  }

  function sellSpares() {
    const totals = spareTotals();
    if (totals.count === 0) {
      addLog("You have no spare loot to sell.");
      render();
      return;
    }
    LOOT.forEach(function (item) {
      if (inventoryCount(item.id) > 1) state.inventory[item.id] = 1;
    });
    state.gold += totals.gold;
    addLog("Sold " + totals.count + " spare items for " + totals.gold + " gold.");
    save();
    render();
  }

  function unequipSlot(slot) {
    if (!state.equipped) return;
    if (slot !== "weapon" && slot !== "armor") return;
    const id = state.equipped[slot];
    if (!id) return;
    const item = getLootDef(id);
    state.equipped[slot] = null;
    addLog("Unequipped " + (item ? item.name : slot) + ".");
    save();
    render();
  }

  // Rename / reset use in-page forms: hosted pages (e.g. Claude artifacts) block prompt() / confirm().

  function closeHeaderDialogs() {
    el.renameForm.hidden = true;
    el.resetConfirm.hidden = true;
    el.backupPanel.hidden = true;
  }

  function openRename() {
    const wasOpen = !el.renameForm.hidden;
    closeHeaderDialogs();
    if (wasOpen) return;
    el.renameForm.hidden = false;
    el.renameInput.value = state.name;
    el.renameInput.focus();
    el.renameInput.select();
  }

  function submitRename(ev) {
    ev.preventDefault();
    const trimmed = String(el.renameInput.value).trim().slice(0, 24);
    if (!trimmed) {
      el.renameInput.focus();
      return;
    }
    closeHeaderDialogs();
    if (trimmed === state.name) return;
    state.name = trimmed;
    addLog("You are known as " + state.name + ".");
    save();
    render();
  }

  function openResetConfirm() {
    const wasOpen = !el.resetConfirm.hidden;
    closeHeaderDialogs();
    if (wasOpen) return;
    el.resetConfirm.hidden = false;
    el.resetCancel.focus();
  }

  // --- Save backup (export / import as a text code) ---

  function setBackupStatus(msg, isError) {
    el.backupStatus.textContent = msg;
    el.backupStatus.classList.toggle("error", !!isError);
  }

  function openBackup() {
    const wasOpen = !el.backupPanel.hidden;
    closeHeaderDialogs();
    if (wasOpen) return;
    el.backupPanel.hidden = false;
    el.backupText.value = "";
    setBackupStatus("", false);
    el.backupCopy.focus();
  }

  function copyBackup() {
    const code = F.encodeBackup(savePayload());
    el.backupText.value = code;
    function selectFallback() {
      el.backupText.focus();
      el.backupText.select();
      setBackupStatus("Save code selected. Copy it with Ctrl+C (or long-press on a phone).", false);
    }
    try {
      navigator.clipboard.writeText(code).then(function () {
        setBackupStatus("Copied your save to the clipboard. Keep it somewhere safe.", false);
      }, selectFallback);
    } catch (e) {
      selectFallback();
    }
  }

  function loadBackup() {
    let data = null;
    try {
      data = F.decodeBackup(el.backupText.value);
    } catch (e) {
      data = null;
    }
    if (!data) {
      setBackupStatus(
        "That isn't a Ruin Wars save. Paste the whole code, starting with " + F.BACKUP_PREFIX,
        true
      );
      el.backupText.focus();
      return;
    }
    const prevState = state;
    const prevLog = logLines;
    try {
      applySaveData(data, null);
    } catch (e) {
      state = prevState;
      logLines = prevLog;
      setBackupStatus("That save is damaged and couldn't be loaded. Your progress is unchanged.", true);
      return;
    }
    addLog("Save loaded from a backup. Welcome back, " + state.name + ".");
    save();
    render();
    el.backupText.value = "";
    setBackupStatus("Loaded " + state.name + ", Level " + state.level + ".", false);
  }

  // --- Renown (prestige): start again at Level 1 for a title and a permanent bonus ---

  let renownConfirmOpen = false;

  function openRenownConfirm() {
    if (state.level < RENOWN_MIN_LEVEL) return;
    renownConfirmOpen = true;
    render();
  }

  function cancelRenown() {
    renownConfirmOpen = false;
    render();
  }

  function beginNewLegend() {
    renownConfirmOpen = false;
    if (state.level < RENOWN_MIN_LEVEL) {
      addLog("Reach Level " + RENOWN_MIN_LEVEL + " before you begin a new legend.");
      render();
      return;
    }
    const kept = {
      name: state.name,
      renown: renownRank() + 1,
      storyUnlocks: state.storyUnlocks,
    };
    const finalLevel = state.level;
    state = Object.assign(defaultState(), kept);
    syncMaxesFromLevel();
    addLog(
      "At Level " +
        finalLevel +
        " you lay down your arms and ride out again as a squire. The bards remember: you are now " +
        state.name +
        ", " +
        renownTitle(state.renown) +
        " (Renown " +
        state.renown +
        ": +" +
        Math.round(renownBonuses().goldMult * 100) +
        "% gold, +" +
        Math.round(renownBonuses().xpMult * 100) +
        "% XP)."
    );
    save();
    setTab("quests");
    render();
  }

  function resetGame() {
    closeHeaderDialogs();
    state = defaultState();
    logLines = [];
    addLog("A new knight takes up the quest.");
    save();
    render();
  }

  // --- Tick ---

  let saveDirty = false;
  let lastSaveAt = 0;
  let lastSaveSig = "";

  function tick() {
    const now = Date.now();
    const dt = Math.max(0, now - state.lastTick);
    state.lastTick = now;

    if (state.energy < state.energyMax) {
      state.energyAccMs = (state.energyAccMs || 0) + dt;
      const interval = regenIntervalMs();
      while (state.energyAccMs >= interval && state.energy < state.energyMax) {
        state.energyAccMs -= interval;
        state.energy += 1;
      }
      if (state.energy >= state.energyMax) {
        state.energyAccMs = 0;
      }
    } else {
      state.energyAccMs = 0;
    }

    if (state.stamina < state.staminaMax) {
      state.staminaAccMs = (state.staminaAccMs || 0) + dt;
      while (state.staminaAccMs >= STAMINA_REGEN_MS && state.stamina < state.staminaMax) {
        state.staminaAccMs -= STAMINA_REGEN_MS;
        state.stamina += 1;
      }
      if (state.stamina >= state.staminaMax) {
        state.staminaAccMs = 0;
      }
    } else {
      state.staminaAccMs = 0;
    }

    if (state.health < state.healthMax) {
      state.healthAccMs = (state.healthAccMs || 0) + dt;
      while (state.healthAccMs >= HEALTH_REGEN_MS && state.health < state.healthMax) {
        state.healthAccMs -= HEALTH_REGEN_MS;
        state.health += 1;
        clearFallenIfHealed();
      }
      if (state.health >= state.healthMax) {
        state.healthAccMs = 0;
      }
    } else {
      state.healthAccMs = 0;
    }

    accrueAllHoldings(dt);
    accrueAllBosses(dt);

    const sig = saveSignature();
    if (sig !== lastSaveSig) {
      lastSaveSig = sig;
      saveDirty = true;
    }
    if (saveDirty && now - lastSaveAt >= SAVE_INTERVAL_MS) {
      save();
    }

    // Renders patch the DOM in place, so refreshing every panel each second is cheap
    // and leaves unchanged nodes (and their hover / pressed state) untouched.
    renderLive();
  }

  /** Values worth persisting between throttled saves (regen accumulators are not). */
  function saveSignature() {
    const parts = [state.energy, state.stamina, state.health, state.fallen ? 1 : 0, state.gold];
    HOLDINGS.forEach(function (def) {
      const h = state.holdings && state.holdings[def.id];
      parts.push(h ? Math.floor(h.pending || 0) : 0);
    });
    BOSSES.forEach(function (def) {
      const b = state.bosses && state.bosses[def.id];
      parts.push(b ? b.hp + ":" + b.respawnAt : "");
    });
    return parts.join("|");
  }

  // --- DOM ---

  const el = {
    name: document.getElementById("player-name"),
    level: document.getElementById("stat-level"),
    xp: document.getElementById("stat-xp"),
    xpNext: document.getElementById("stat-xp-next"),
    xpBar: document.getElementById("xp-bar"),
    gold: document.getElementById("stat-gold"),
    energy: document.getElementById("stat-energy"),
    energyMax: document.getElementById("stat-energy-max"),
    energyBar: document.getElementById("energy-bar"),
    regenHint: document.getElementById("regen-hint"),
    stamina: document.getElementById("stat-stamina"),
    staminaMax: document.getElementById("stat-stamina-max"),
    staminaBar: document.getElementById("stamina-bar"),
    staminaRegenHint: document.getElementById("stamina-regen-hint"),
    health: document.getElementById("stat-health"),
    healthMax: document.getElementById("stat-health-max"),
    healthBar: document.getElementById("health-bar"),
    healthRegenHint: document.getElementById("health-regen-hint"),
    band: document.getElementById("stat-band"),
    bandCap: document.getElementById("stat-band-cap"),
    bandHint: document.getElementById("band-hint"),
    regionTabs: document.getElementById("region-tabs"),
    regionIntro: document.getElementById("region-intro"),
    bossList: document.getElementById("boss-list"),
    bandSummary: document.getElementById("band-summary"),
    bandList: document.getElementById("band-list"),
    collectionsList: document.getElementById("collections-list"),
    questList: document.getElementById("quest-list"),
    fightList: document.getElementById("fight-list"),
    healList: document.getElementById("heal-list"),
    holdingsList: document.getElementById("holdings-list"),
    inventoryList: document.getElementById("inventory-list"),
    equipSummary: document.getElementById("equip-summary"),
    shopList: document.getElementById("shop-list"),
    log: document.getElementById("log"),
    legendsList: document.getElementById("legends-list"),
    btnRename: document.getElementById("btn-rename"),
    btnReset: document.getElementById("btn-reset"),
    renameForm: document.getElementById("rename-form"),
    renameInput: document.getElementById("rename-input"),
    renameCancel: document.getElementById("rename-cancel"),
    resetConfirm: document.getElementById("reset-confirm"),
    resetYes: document.getElementById("reset-yes"),
    resetCancel: document.getElementById("reset-cancel"),
    btnBackup: document.getElementById("btn-backup"),
    btnSound: document.getElementById("btn-sound"),
    backupPanel: document.getElementById("backup-panel"),
    backupText: document.getElementById("backup-text"),
    backupCopy: document.getElementById("backup-copy"),
    backupLoad: document.getElementById("backup-load"),
    backupClose: document.getElementById("backup-close"),
    backupStatus: document.getElementById("backup-status"),
    statsPanel: document.querySelector(".stats"),
    tabBar: document.getElementById("tab-bar"),
    main: document.querySelector(".main"),
    playerTitle: document.getElementById("player-title"),
    renownBox: document.getElementById("renown-box"),
    ticker: document.getElementById("ticker"),
  };

  // --- In-place DOM patching ---
  // Render functions build fresh, detached nodes; patchChildren() morphs them into the
  // live container. Nodes that match (same tag + data-key) are kept and only their
  // changed attributes / text are written, so buttons keep their identity across ticks:
  // clicks are never dropped and :hover does not flicker. Structure changes (region
  // switch, new holding, new loot) insert / move / remove only the affected nodes.

  function nodeKey(node) {
    return node.nodeType === 1 ? node.getAttribute("data-key") : null;
  }

  function sameKind(a, b) {
    return a.nodeType === b.nodeType && a.nodeName === b.nodeName && nodeKey(a) === nodeKey(b);
  }

  function patchAttributes(from, to) {
    for (let i = from.attributes.length - 1; i >= 0; i--) {
      const name = from.attributes[i].name;
      if (!to.hasAttribute(name)) from.removeAttribute(name);
    }
    for (let i = 0; i < to.attributes.length; i++) {
      const a = to.attributes[i];
      if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    }
  }

  function patchNode(from, to) {
    if (from.nodeType !== 1) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return;
    }
    patchAttributes(from, to);
    patchChildren(from, to);
  }

  /** Make parent's children match source's children, reusing existing nodes where possible. */
  function patchChildren(parent, source) {
    const next = Array.prototype.slice.call(source.childNodes);
    const keyed = {};
    Array.prototype.forEach.call(parent.childNodes, function (n) {
      const k = nodeKey(n);
      if (k) keyed[k] = n;
    });
    for (let i = 0; i < next.length; i++) {
      const want = next[i];
      const k = nodeKey(want);
      let cur = parent.childNodes[i] || null;
      const found = k ? keyed[k] : null;
      if (found) {
        delete keyed[k];
        if (found !== cur) {
          parent.insertBefore(found, cur);
          cur = found;
        }
      }
      if (cur && sameKind(cur, want)) {
        patchNode(cur, want);
      } else if (cur) {
        parent.insertBefore(want, cur);
      } else {
        parent.appendChild(want);
      }
    }
    while (parent.childNodes.length > next.length) {
      parent.removeChild(parent.lastChild);
    }
  }

  /** innerHTML replacement that only touches what changed. */
  function patchHtml(target, html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    patchChildren(target, tmp);
  }

  /** Buttons carry data-action / data-id; one delegated listener dispatches them. */
  function actionButton(btn, action, id) {
    btn.setAttribute("data-action", action);
    if (id !== undefined && id !== null) btn.setAttribute("data-id", id);
    return btn;
  }

  const ACTIONS = {
    region: setRegion,
    quest: doQuest,
    fight: doFight,
    boss: doBossStrike,
    hire: hireRecruit,
    rally: rallyRecruit,
    named: recruitNamed,
    redeem: redeemCollection,
    heal: doHeal,
    "buy-holding": buyHolding,
    "collect-holding": collectHolding,
    "upgrade-holding": upgradeHolding,
    equip: equipItem,
    unequip: unequipSlot,
    upgrade: buyUpgrade,
    train: buyRankedUpgrade,
    sell: sellItem,
    "sell-spares": sellSpares,
    tab: setTab,
    "renown-open": openRenownConfirm,
    "renown-cancel": cancelRenown,
    "renown-confirm": beginNewLegend,
  };

  function onActionClick(ev) {
    const target = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
    if (!target || target.disabled) return;
    const fn = ACTIONS[target.getAttribute("data-action")];
    if (!fn) return;
    const action = target.getAttribute("data-action");
    const before = feedbackSnapshot();
    fn(target.getAttribute("data-id"));
    showActionFeedback(target, before);
    playCue(cueForAction(action, before));
  }

  // --- Sound: short synthesized cues (Web Audio), off by default ---

  const SOUND_PREF_KEY = "ruin_wars_sound"; // per-browser preference, not part of the save
  let soundOn = false;
  let audioCtx = null;

  function readSoundPref() {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) === "on";
    } catch (e) {
      return false;
    }
  }

  function renderSoundToggle() {
    el.btnSound.textContent = soundOn ? "Sound: on" : "Sound: off";
    el.btnSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  }

  function toggleSound() {
    soundOn = !soundOn;
    try {
      localStorage.setItem(SOUND_PREF_KEY, soundOn ? "on" : "off");
    } catch (e) {
      // ignore: the toggle still works for this visit
    }
    renderSoundToggle();
    if (soundOn) playCue("quest");
  }

  function audio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  /** One enveloped note: freq in Hz, start offset and length in seconds. */
  function tone(ctx, freq, start, length, type, volume, slideTo) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + length);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + length + 0.02);
  }

  /** A short burst of filtered noise: the clang of a hit. */
  function clash(ctx, start, length, volume) {
    const t0 = ctx.currentTime + start;
    const frames = Math.floor(ctx.sampleRate * length);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2400;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  const CUES = {
    quest: function (ctx) {
      tone(ctx, 659, 0, 0.18, "triangle", 0.18);
      tone(ctx, 988, 0.09, 0.3, "triangle", 0.15);
    },
    coin: function (ctx) {
      tone(ctx, 1319, 0, 0.08, "square", 0.05);
      tone(ctx, 1760, 0.06, 0.16, "square", 0.05);
    },
    spend: function (ctx) {
      tone(ctx, 1047, 0, 0.08, "square", 0.04);
      tone(ctx, 784, 0.06, 0.14, "square", 0.04);
    },
    win: function (ctx) {
      clash(ctx, 0, 0.12, 0.35);
      tone(ctx, 523, 0.08, 0.16, "triangle", 0.14);
      tone(ctx, 784, 0.16, 0.26, "triangle", 0.14);
    },
    loss: function (ctx) {
      clash(ctx, 0, 0.1, 0.25);
      tone(ctx, 196, 0.06, 0.4, "sine", 0.22, 131);
    },
    hit: function (ctx) {
      clash(ctx, 0, 0.14, 0.4);
      tone(ctx, 147, 0, 0.22, "sine", 0.2, 98);
    },
    heal: function (ctx) {
      tone(ctx, 523, 0, 0.3, "sine", 0.12);
      tone(ctx, 659, 0.12, 0.4, "sine", 0.1);
    },
    levelup: function (ctx) {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone(ctx, f, i * 0.09, 0.32, "triangle", 0.16);
      });
    },
    boss: function (ctx) {
      clash(ctx, 0, 0.18, 0.4);
      [392, 523, 659, 784].forEach(function (f, i) {
        tone(ctx, f, 0.12 + i * 0.12, i === 3 ? 0.7 : 0.2, "sawtooth", 0.07);
        tone(ctx, f, 0.12 + i * 0.12, i === 3 ? 0.7 : 0.2, "triangle", 0.12);
      });
    },
  };

  function playCue(name) {
    if (!soundOn || !name || !CUES[name]) return;
    try {
      const ctx = audio();
      if (ctx) CUES[name](ctx);
    } catch (e) {
      // audio unavailable: play silently
    }
  }

  const SPEND_ACTIONS = ["upgrade", "train", "hire", "named", "buy-holding", "upgrade-holding"];

  /** Pick a sound for what an action just did (null when nothing happened). */
  function cueForAction(action, before) {
    const dGold = state.gold - before.gold;
    if (state.level > before.level) return "levelup";
    if (bossKills() > before.bossKills) return "boss";
    if (action === "quest") return dGold > 0 ? "quest" : null;
    if (action === "fight") {
      if (dGold > 0) return "win";
      return state.health < before.health || state.xp !== before.xp ? "loss" : null;
    }
    if (action === "boss") return dGold > 0 ? "hit" : null;
    if (action === "heal") return state.health > before.health ? "heal" : null;
    if (action === "rally") return bandSize() > before.band ? "quest" : null;
    if (action === "redeem") return redeemedCount() > before.redeemed ? "quest" : null;
    if (SPEND_ACTIONS.indexOf(action) >= 0) return dGold < 0 ? "spend" : null;
    return dGold > 0 ? "coin" : null;
  }

  function redeemedCount() {
    return Object.keys(state.collectionsRedeemed || {}).length;
  }

  function bossKills() {
    return BOSSES.reduce(function (sum, def) {
      const b = state.bosses && state.bosses[def.id];
      return sum + (b ? b.kills : 0);
    }, 0);
  }

  // --- Tabs ---

  const TAB_IDS = ["quests", "lists", "bosses", "band", "holdings", "gear", "armory", "chronicle"];
  const TAB_STORE_KEY = "ruin_wars_tab"; // per-browser convenience, not part of the save
  let currentTab = "quests";

  function initialTab() {
    const hash = (location.hash || "").replace("#", "");
    if (TAB_IDS.indexOf(hash) >= 0) return hash;
    try {
      const stored = localStorage.getItem(TAB_STORE_KEY);
      if (TAB_IDS.indexOf(stored) >= 0) return stored;
    } catch (e) {
      // storage blocked: fall back to the first tab
    }
    return "quests";
  }

  function setTab(tabId) {
    if (TAB_IDS.indexOf(tabId) < 0) return;
    currentTab = tabId;
    document.querySelectorAll("[data-panel]").forEach(function (sec) {
      sec.hidden = sec.getAttribute("data-panel") !== tabId;
    });
    el.tabBar.querySelectorAll(".tab").forEach(function (btn) {
      const on = btn.getAttribute("data-tab") === tabId;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });
    try {
      localStorage.setItem(TAB_STORE_KEY, tabId);
    } catch (e) {
      // ignore
    }
    renderTicker();
    // If the new tab's top is hidden under the sticky tab bar, scroll it back into view.
    const barBottom = el.tabBar.getBoundingClientRect().bottom;
    const anchor = el.ticker.hidden ? el.main : el.ticker;
    const anchorTop = anchor.getBoundingClientRect().top;
    if (anchorTop < barBottom) {
      window.scrollTo(0, window.scrollY + anchorTop - barBottom - 8);
    }
  }

  function onTabClick(ev) {
    const btn = ev.target.closest(".tab");
    if (btn) setTab(btn.getAttribute("data-tab"));
  }

  function onTabKey(ev) {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    const i = TAB_IDS.indexOf(currentTab);
    const next = TAB_IDS[(i + (ev.key === "ArrowRight" ? 1 : TAB_IDS.length - 1)) % TAB_IDS.length];
    setTab(next);
    const btn = el.tabBar.querySelector('[data-tab="' + next + '"]');
    if (btn) btn.focus();
    ev.preventDefault();
  }

  /** Which tabs have something waiting for the player. */
  function tabAlerts() {
    const alerts = {};
    alerts.holdings = HOLDINGS.some(function (def) {
      const h = state.holdings && state.holdings[def.id];
      return !!(h && h.owned && h.pending >= holdingCap(def, h));
    });
    alerts.band = rallyRemaining() === 0 && bandState().recruits < bandCap();
    alerts.gear = COLLECTIONS.some(function (set) {
      return collectionComplete(set) && !collectionRedeemed(set.id);
    });
    alerts.armory = !state.ownedUpgrades.sword && state.gold >= UPGRADES[0].cost;
    alerts.chronicle = state.level >= RENOWN_MIN_LEVEL;
    alerts.bosses =
      !state.fallen &&
      BOSSES.some(function (def) {
        return (
          state.level >= def.minLevel &&
          bossRespawnRemaining(def) === 0 &&
          state.stamina >= def.stamina
        );
      });
    return alerts;
  }

  const TAB_ALERT_TITLES = {
    holdings: "A holding is full. Collect its gold.",
    band: "The Muster Horn is ready.",
    gear: "A collection is complete. Redeem it.",
    bosses: "A boss is ready to strike.",
    armory: "You can afford the Tempered Blade.",
    chronicle: "You can begin a new legend for Renown.",
  };

  function renderTabAlerts() {
    const alerts = tabAlerts();
    el.tabBar.querySelectorAll(".tab").forEach(function (btn) {
      const id = btn.getAttribute("data-tab");
      const dot = btn.querySelector(".tab-dot");
      const on = !!alerts[id];
      if (dot.hidden === on) dot.hidden = !on;
      const title = on ? TAB_ALERT_TITLES[id] : "";
      if ((btn.getAttribute("title") || "") !== title) {
        if (title) btn.setAttribute("title", title);
        else btn.removeAttribute("title");
      }
    });
  }

  // --- Ticker: the latest chronicle lines, shown on every tab but the Chronicle ---

  const TICKER_LINES = 3;
  let tickerTop = null;

  function renderTicker() {
    if (!el.ticker) return;
    el.ticker.hidden = currentTab === "chronicle" || logLines.length === 0;
    if (logLines[0] === tickerTop && el.ticker.childNodes.length) return;
    const isNew = tickerTop !== null;
    tickerTop = logLines[0];
    el.ticker.textContent = "";
    logLines.slice(0, TICKER_LINES).forEach(function (line, i) {
      const li = document.createElement("li");
      li.textContent = line;
      if (i === 0 && isNew) li.className = "fresh";
      el.ticker.appendChild(li);
    });
  }

  // --- Action feedback: floating gains / losses and a level-up flash ---

  function feedbackSnapshot() {
    return {
      gold: state.gold,
      xp: state.xp,
      level: state.level,
      health: state.health,
      band: bandSize(),
      bossKills: bossKills(),
      redeemed: redeemedCount(),
    };
  }

  /** XP gained between two (level, xp) points, counting across level-ups. */
  function xpGainedSince(before) {
    if (state.level === before.level) return state.xp - before.xp;
    let gained = xpForLevel(before.level) - before.xp;
    for (let lv = before.level + 1; lv < state.level; lv++) gained += xpForLevel(lv);
    return gained + state.xp;
  }

  function showActionFeedback(target, before) {
    const parts = [];
    const dGold = state.gold - before.gold;
    const dXp = xpGainedSince(before);
    const dHealth = state.health - before.health;
    if (dGold > 0) parts.push({ cls: "fx-gold", text: "+" + dGold + "g" });
    if (dGold < 0) parts.push({ cls: "fx-spend", text: "−" + -dGold + "g" });
    if (dXp > 0) parts.push({ cls: "fx-xp", text: "+" + dXp + " XP" });
    if (dHealth > 0) parts.push({ cls: "fx-heal", text: "+" + dHealth + " HP" });
    if (dHealth < 0) parts.push({ cls: "fx-hurt", text: "−" + -dHealth + " HP" });
    if (parts.length && target.isConnected) {
      const rect = target.getBoundingClientRect();
      const fx = document.createElement("div");
      fx.className = "floater";
      fx.setAttribute("aria-hidden", "true");
      parts.forEach(function (p) {
        const span = document.createElement("span");
        span.className = p.cls;
        span.textContent = p.text;
        fx.appendChild(span);
      });
      fx.style.left = Math.round(rect.left + rect.width / 2) + "px";
      fx.style.top = Math.round(rect.top) + "px";
      document.body.appendChild(fx);
      setTimeout(function () {
        fx.remove();
      }, 1300);
    }
    if (state.level > before.level) celebrateLevel();
  }

  function celebrateLevel() {
    el.statsPanel.classList.remove("level-flash");
    void el.statsPanel.offsetWidth; // restart the animation
    el.statsPanel.classList.add("level-flash");
    const toast = document.createElement("div");
    toast.className = "level-toast";
    toast.setAttribute("role", "status");
    toast.textContent = "Level " + state.level + "!";
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 2200);
  }

  function regenHintText(cur, max, intervalMs, accMs) {
    const left = msUntilFull(cur, max, intervalMs, accMs);
    if (left <= 0) return "Full";
    return "+1 / " + Math.round(intervalMs / 1000) + "s · full in " + formatCooldown(left);
  }

  function renderStatsOnly() {
    el.name.textContent = state.name;
    const title = renownTitle(renownRank());
    el.playerTitle.textContent = title ? title + " · Renown " + renownRank() : "";
    el.playerTitle.hidden = !title;
    el.level.textContent = String(state.level);
    const need = xpForLevel(state.level);
    el.xp.textContent = String(state.xp);
    el.xpNext.textContent = String(need);
    el.xpBar.style.width = Math.min(100, (state.xp / need) * 100) + "%";
    el.gold.textContent = String(state.gold);

    el.energy.textContent = String(state.energy);
    el.energyMax.textContent = String(state.energyMax);
    el.energyBar.style.width =
      Math.min(100, (state.energy / state.energyMax) * 100) + "%";
    el.regenHint.textContent = regenHintText(
      state.energy,
      state.energyMax,
      regenIntervalMs(),
      state.energyAccMs
    );

    el.stamina.textContent = String(state.stamina);
    el.staminaMax.textContent = String(state.staminaMax);
    el.staminaBar.style.width =
      Math.min(100, (state.stamina / state.staminaMax) * 100) + "%";
    el.staminaRegenHint.textContent = regenHintText(
      state.stamina,
      state.staminaMax,
      STAMINA_REGEN_MS,
      state.staminaAccMs
    );

    el.health.textContent = String(state.health);
    el.healthMax.textContent = String(state.healthMax);
    el.healthBar.style.width =
      Math.min(100, (state.health / Math.max(1, state.healthMax)) * 100) + "%";
    if (state.fallen || state.health <= 0) {
      el.healthRegenHint.textContent = "Fallen — Chapel";
    } else {
      el.healthRegenHint.textContent = regenHintText(
        state.health,
        state.healthMax,
        HEALTH_REGEN_MS,
        state.healthAccMs
      );
    }

    if (el.band) {
      el.band.textContent = String(bandSize());
      el.bandCap.textContent = String(bandCap() + NAMED_KNIGHTS.length);
      el.bandHint.textContent = "Atk " + attackRating() + " · Def " + defenseRating();
    }
  }

  function renderRegions() {
    if (!el.regionTabs) return;
    const frag = document.createDocumentFragment();
    const cur = currentRegion();
    REGIONS.forEach(function (r) {
      const unlocked = regionUnlocked(r);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn region-tab" + (r.id === cur.id ? " active" : "");
      btn.setAttribute("data-region", r.id);
      btn.setAttribute("data-key", "region:" + r.id);
      btn.textContent = unlocked ? r.name : r.name + " (Lv " + r.minLevel + ")";
      btn.disabled = !unlocked;
      actionButton(btn, "region", r.id);
      frag.appendChild(btn);
    });
    patchChildren(el.regionTabs, frag);
    if (el.regionIntro) el.regionIntro.textContent = cur.desc;
  }

  function renderQuests() {
    const frag = document.createDocumentFragment();
    const regionId = currentRegion().id;
    QUESTS.forEach(function (q) {
      if ((q.region || "camelot") !== regionId) return;
      const locked = state.level < q.minLevel;
      const canAfford = state.energy >= q.energy;
      const cdLeft = questCooldownRemaining(q.id);
      const onCooldown = cdLeft > 0;
      const count = questCount(q.id);
      const rank = masteryRankName(q.id);
      const mb = masteryBonusForQuest(q.id);
      const goldShow = Math.floor(q.gold * goldMultiplier(q.id));
      const xpShow = Math.floor(q.xp * xpMultiplier(q.id));
      const reqs = questRequirements(q);
      const unmet = reqs.some(function (req) {
        return !req.met;
      });
      const card = document.createElement("article");
      card.className =
        "card" +
        (locked ? " locked" : "") +
        (onCooldown ? " cooling" : "") +
        (!locked && unmet ? " unmet" : "");
      card.setAttribute("data-key", "quest:" + q.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(q.name) +
        '<span class="badge mastery-badge">' +
        escapeHtml(rank) +
        "</span></h3>" +
        '<p class="card-meta">' +
        escapeHtml(q.desc) +
        "</p>" +
        '<p class="card-meta">' +
        '<span class="cost">' +
        q.energy +
        " Energy</span> · " +
        '<span class="reward-gold">+' +
        goldShow +
        " gold</span> · " +
        '<span class="reward-xp">+' +
        xpShow +
        " XP</span>" +
        (locked
          ? ' · <span class="gate">Requires Level ' + q.minLevel + "</span>"
          : "") +
        (onCooldown
          ? ' · <span class="gate">Cooldown ' + formatCooldown(cdLeft) + "</span>"
          : "") +
        "</p>" +
        '<p class="card-meta"><span class="mastery">' +
        count +
        " completions · " +
        escapeHtml(nextMasteryHint(q.id)) +
        (mb.goldAdd || mb.xpAdd
          ? " · bonus +" +
            Math.round(mb.goldAdd * 100) +
            "%g / +" +
            Math.round(mb.xpAdd * 100) +
            "%xp"
          : "") +
        "</span></p>" +
        (reqs.length
          ? '<p class="card-meta requires">Needs: ' +
            reqs
              .map(function (req) {
                return (
                  '<span class="' +
                  (req.met ? "req-met" : "req-unmet") +
                  '">' +
                  (req.met ? "✓ " : "✗ ") +
                  escapeHtml(req.label) +
                  "</span>"
                );
              })
              .join(" · ") +
            "</p>"
          : "") +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (locked) {
        btn.textContent = "Locked";
      } else if (unmet) {
        btn.textContent = "Not ready";
      } else if (onCooldown) {
        btn.textContent = "Wait " + formatCooldown(cdLeft);
      } else {
        btn.textContent = "Embark";
      }
      btn.disabled = locked || unmet || !canAfford || onCooldown;
      actionButton(btn, "quest", q.id);
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.questList, frag);
  }

  function renderFights() {
    const frag = document.createDocumentFragment();
    const isFallen = state.fallen || state.health <= 0;
    if (!state.ownedUpgrades.sword) {
      const blade = UPGRADES[0];
      const tip = document.createElement("div");
      tip.className = "tip";
      tip.setAttribute("data-key", "tip-blade");
      const text = document.createElement("p");
      text.textContent =
        "New to the Lists? The " +
        blade.name +
        " (" +
        blade.cost +
        " gold in the Armory) adds +" +
        blade.effect.attackBonus +
        " attack and +35% gold. Buy it before your first bouts.";
      const go = document.createElement("button");
      go.type = "button";
      go.className = "btn";
      go.textContent = "Open Armory";
      actionButton(go, "tab", "armory");
      tip.appendChild(text);
      tip.appendChild(go);
      frag.appendChild(tip);
    }
    // Show every foe you can face plus the next one to unlock, grouped under region headings.
    const nextLocked = FOES.filter(function (f) {
      return state.level < f.minLevel;
    }).sort(function (a, b) {
      return a.minLevel - b.minLevel;
    })[0];
    let lastRegion = null;
    FOES.forEach(function (f) {
      const locked = state.level < f.minLevel;
      if (locked && f !== nextLocked) return;
      const regionId = f.region || "camelot";
      if (regionId !== lastRegion) {
        lastRegion = regionId;
        const head = document.createElement("h3");
        head.className = "list-region";
        head.setAttribute("data-key", "foe-region:" + regionId);
        head.textContent = getRegion(regionId).name;
        frag.appendChild(head);
      }
      const canAfford = state.stamina >= f.stamina;
      const cdLeft = fightCooldownRemaining(f.id);
      const onCooldown = cdLeft > 0;
      const odds = fightWinChance(f);
      const oddsClass = odds >= 0.65 ? "odds-good" : odds >= 0.4 ? "odds-even" : "odds-risky";
      const upset = upsetMultiplier(odds);
      const card = document.createElement("article");
      card.className =
        "card" +
        (locked ? " locked" : "") +
        (onCooldown ? " cooling" : "") +
        (isFallen ? " fallen" : "");
      card.setAttribute("data-key", "foe:" + f.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(f.name) +
        (isFallen ? '<span class="badge fallen-badge">Fallen</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(f.desc) +
        "</p>" +
        '<p class="card-meta">' +
        '<span class="cost-stamina">' +
        f.stamina +
        " Stamina</span> · " +
        '<span class="reward-gold">+' +
        Math.floor(f.gold * goldMultiplier()) +
        " gold</span> · " +
        '<span class="reward-xp">+' +
        Math.floor(f.xp * xpMultiplier()) +
        " XP</span> · " +
        '<span class="cost-health">dmg ' +
        f.dmgMin +
        "–" +
        f.dmgMax +
        "</span>" +
        (locked
          ? ' · <span class="gate">Requires Level ' + f.minLevel + "</span>"
          : "") +
        (onCooldown
          ? ' · <span class="gate">Cooldown ' + formatCooldown(cdLeft) + "</span>"
          : "") +
        "</p>" +
        '<p class="card-meta"><span class="' +
        oddsClass +
        '">' +
        Math.round(odds * 100) +
        "% win chance</span> · power " +
        attackRating() +
        " vs " +
        f.power +
        (upset > 1
          ? ' · <span class="upset">upset bonus ×' + upset.toFixed(2) + " rewards</span>"
          : "") +
        "</p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (isFallen) {
        btn.textContent = "Fallen";
      } else if (locked) {
        btn.textContent = "Locked";
      } else if (onCooldown) {
        btn.textContent = "Wait " + formatCooldown(cdLeft);
      } else {
        btn.textContent = "Challenge";
      }
      btn.disabled = locked || !canAfford || onCooldown || isFallen;
      actionButton(btn, "fight", f.id);
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.fightList, frag);
  }

  function renderBosses() {
    if (!el.bossList) return;
    const frag = document.createDocumentFragment();
    const isFallen = state.fallen || state.health <= 0;
    BOSSES.forEach(function (def) {
      const b = bossState(def);
      const locked = state.level < def.minLevel;
      const respawn = bossRespawnRemaining(def);
      const canAfford = state.stamina >= def.stamina;
      const pct = Math.max(0, Math.min(100, (b.hp / def.maxHp) * 100));
      const loot = getLootDef(def.lootId);
      const set = getCollection(def.collectionId);
      const bonus = bossDamageBonus(def.id);
      const card = document.createElement("article");
      card.className =
        "card boss-card" + (locked ? " locked" : "") + (respawn > 0 ? " cooling" : "");
      card.setAttribute("data-boss", def.id);
      card.setAttribute("data-key", "boss:" + def.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(def.name) +
        (b.kills > 0 ? '<span class="badge">Slain ×' + b.kills + "</span>" : "") +
        (isFallen && !locked ? '<span class="badge fallen-badge">Fallen</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(def.desc) +
        "</p>" +
        '<p class="card-meta">' +
        (respawn > 0
          ? '<span class="gate">Returns in ' + formatCooldown(respawn) + "</span>"
          : "HP " + b.hp + " / " + def.maxHp + " · regen " + def.regenPerMin + "/min") +
        "</p>" +
        '<div class="bar boss-bar" aria-hidden="true"><div class="bar-fill boss" style="width:' +
        (respawn > 0 ? 0 : pct) +
        '%"></div></div>' +
        '<p class="card-meta">' +
        '<span class="cost-stamina">' +
        def.stamina +
        " Stamina / strike</span> · " +
        "~" +
        Math.floor(attackRating() * (1 + bonus)) +
        " dmg" +
        (bonus ? ' <span class="mastery">(+' + Math.round(bonus * 100) + "% band)</span>" : "") +
        " · " +
        '<span class="cost-health">counter ' +
        def.dmgMin +
        "–" +
        def.dmgMax +
        "</span>" +
        (locked ? ' · <span class="gate">Requires Level ' + def.minLevel + "</span>" : "") +
        "</p>" +
        '<p class="card-meta">Kill: <span class="reward-gold">+' +
        Math.floor(def.gold * goldMultiplier()) +
        " gold</span> · " +
        '<span class="reward-xp">+' +
        Math.floor(def.xp * xpMultiplier()) +
        " XP</span> · " +
        escapeHtml(loot ? loot.name : "") +
        " + a piece of " +
        escapeHtml(set ? set.name : "") +
        " · returns after " +
        escapeHtml(def.respawnLabel) +
        "</p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (locked) {
        btn.textContent = "Locked";
      } else if (respawn > 0) {
        btn.textContent = "Wait " + formatCooldown(respawn);
      } else if (isFallen) {
        btn.textContent = "Fallen";
      } else {
        btn.textContent = "Strike";
      }
      btn.disabled = locked || respawn > 0 || isFallen || !canAfford;
      actionButton(btn, "boss", def.id);
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.bossList, frag);
  }

  function renderBand() {
    if (!el.bandList) return;
    const band = bandState();
    const cap = bandCap();
    const bb = bandBonuses();
    patchHtml(
      el.bandSummary,
      "<strong>Band:</strong> " +
        bandSize() +
        " (" +
        band.recruits +
        "/" +
        cap +
        " sworn knights, " +
        namedKnightsOwned().length +
        "/" +
        NAMED_KNIGHTS.length +
        " named) · <strong>+" +
        bb.attack +
        "</strong> atk · <strong>+" +
        bb.defense +
        "</strong> def" +
        (bb.xpMult ? " · +" + Math.round(bb.xpMult * 100) + "% XP" : "")
    );

    const frag = document.createDocumentFragment();
    const atCap = band.recruits >= cap;

    // Hire (gold)
    const hire = document.createElement("article");
    hire.className = "card";
    hire.setAttribute("data-key", "band:hire");
    hire.innerHTML =
      '<div class="card-body"><h3>Hire a Sworn Knight</h3>' +
      '<p class="card-meta">Each sworn knight adds +' +
      BAND_ATTACK_PER_RECRUIT +
      " attack and +" +
      BAND_DEFENSE_PER_RECRUIT +
      " defense. Cap " +
      cap +
      " (grows +1 per level).</p>" +
      '<p class="card-meta"><span class="reward-gold">' +
      hireCost() +
      " gold</span>" +
      (atCap ? ' · <span class="gate">At cap</span>' : "") +
      "</p></div>";
    const hireBtn = document.createElement("button");
    hireBtn.type = "button";
    hireBtn.className = "btn btn-primary";
    hireBtn.id = "btn-hire";
    hireBtn.textContent = atCap ? "At cap" : "Hire";
    hireBtn.disabled = atCap || state.gold < hireCost();
    actionButton(hireBtn, "hire");
    hire.appendChild(hireBtn);
    frag.appendChild(hire);

    // Rally (free, cooldown)
    const left = rallyRemaining();
    const rally = document.createElement("article");
    rally.className = "card" + (left > 0 ? " cooling" : "");
    rally.setAttribute("data-key", "band:rally");
    rally.innerHTML =
      '<div class="card-body"><h3>Sound the Muster Horn</h3>' +
      '<p class="card-meta">A free recruit every ' +
      formatSeconds(RALLY_COOLDOWN_MS / 1000) +
      ". Counts toward the same cap.</p>" +
      '<p class="card-meta">' +
      (left > 0 ? '<span class="gate">Cooldown ' + formatCooldown(left) + "</span>" : "Ready") +
      "</p></div>";
    const rallyBtn = document.createElement("button");
    rallyBtn.type = "button";
    rallyBtn.className = "btn btn-primary";
    rallyBtn.id = "btn-rally";
    rallyBtn.textContent = atCap ? "At cap" : left > 0 ? "Wait " + formatCooldown(left) : "Rally";
    rallyBtn.disabled = atCap || left > 0;
    actionButton(rallyBtn, "rally");
    rally.appendChild(rallyBtn);
    frag.appendChild(rally);

    // Named knights
    NAMED_KNIGHTS.forEach(function (k) {
      const owned = !!band.named[k.id];
      const locked = state.level < k.minLevel && !owned;
      const card = document.createElement("article");
      card.className = "card" + (owned ? " owned" : "") + (locked ? " locked" : "");
      card.setAttribute("data-key", "named:" + k.id);
      card.innerHTML =
        '<div class="card-body"><h3>' +
        escapeHtml(k.name) +
        (owned ? '<span class="badge">Sworn</span>' : "") +
        '<span class="badge slot-badge">named</span></h3>' +
        '<p class="card-meta">' +
        escapeHtml(k.desc) +
        "</p>" +
        '<p class="card-meta">+' +
        k.attack +
        " atk · +" +
        k.defense +
        " def" +
        (owned ? "" : ' · <span class="reward-gold">' + k.cost + " gold</span>") +
        (locked ? ' · <span class="gate">Requires Level ' + k.minLevel + "</span>" : "") +
        "</p></div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (owned) {
        btn.textContent = "Sworn";
        btn.disabled = true;
      } else {
        btn.textContent = locked ? "Locked" : "Recruit";
        btn.disabled = locked || state.gold < k.cost;
        actionButton(btn, "named", k.id);
      }
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.bandList, frag);
  }

  function renderCollections() {
    if (!el.collectionsList) return;
    const frag = document.createDocumentFragment();
    COLLECTIONS.forEach(function (set) {
      const region = getRegion(set.region);
      const redeemed = collectionRedeemed(set.id);
      const complete = collectionComplete(set);
      const have = set.pieces.filter(function (p) {
        return pieceCount(p.id) > 0;
      }).length;
      const card = document.createElement("article");
      card.className = "card collection-card" + (redeemed ? " owned" : "");
      card.setAttribute("data-set", set.id);
      card.setAttribute("data-key", "set:" + set.id);
      const pieces = set.pieces
        .map(function (p) {
          const n = pieceCount(p.id);
          return (
            '<li class="piece' +
            (n > 0 ? " have" : "") +
            '">' +
            escapeHtml(p.name) +
            (n > 1 ? " ×" + n : n === 1 ? "" : " —") +
            "</li>"
          );
        })
        .join("");
      card.innerHTML =
        '<div class="card-body"><h3>' +
        escapeHtml(set.name) +
        (redeemed ? '<span class="badge">Redeemed</span>' : "") +
        '<span class="badge slot-badge">' +
        escapeHtml(region ? region.name : set.region) +
        "</span></h3>" +
        '<p class="card-meta">' +
        have +
        "/" +
        set.pieces.length +
        ' pieces · bonus: <span class="mastery">' +
        escapeHtml(set.bonusDesc) +
        "</span></p>" +
        '<ul class="piece-list">' +
        pieces +
        "</ul></div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (redeemed) {
        btn.textContent = "Redeemed";
        btn.disabled = true;
      } else {
        btn.textContent = complete ? "Redeem" : "Incomplete";
        btn.disabled = !complete;
        actionButton(btn, "redeem", set.id);
      }
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.collectionsList, frag);
  }

  function renderHeals() {
    const frag = document.createDocumentFragment();
    HEALS.forEach(function (h) {
      const atFull = state.health >= state.healthMax;
      const canAfford = state.gold >= h.cost;
      const healLabel =
        h.heal === "full" ? "Full heal" : "+" + h.heal + " HP";
      const card = document.createElement("article");
      card.className = "card";
      card.setAttribute("data-key", "heal:" + h.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(h.name) +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(h.desc) +
        "</p>" +
        '<p class="card-meta">' +
        '<span class="reward-gold">' +
        h.cost +
        " gold</span> · " +
        '<span class="cost-health">' +
        healLabel +
        "</span>" +
        "</p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-heal";
      if (atFull) {
        btn.textContent = "Full HP";
        btn.disabled = true;
      } else {
        btn.textContent = "Heal";
        btn.disabled = !canAfford;
        actionButton(btn, "heal", h.id);
      }
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.healList, frag);
  }

  function renderHoldings() {
    if (!el.holdingsList) return;
    const frag = document.createDocumentFragment();
    HOLDINGS.forEach(function (def) {
      const h = holdingState(def.id);
      const locked = state.level < def.minLevel && !h.owned;
      const income = holdingIncomePerCycle(def, h);
      const cap = holdingCap(def, h);
      const pending = Math.floor(h.pending || 0);
      const card = document.createElement("article");
      card.className =
        "card" + (h.owned ? " owned" : "") + (locked ? " locked" : "");
      card.setAttribute("data-key", "holding:" + def.id);

      let metaExtra = "";
      if (h.owned) {
        metaExtra =
          '<span class="reward-gold">+' +
          income +
          " gold / " +
          formatSeconds(def.cycleSec) +
          "</span> · pending " +
          pending +
          "/" +
          cap +
          " · rank " +
          h.level +
          "/" +
          def.maxLevel;
      } else {
        metaExtra =
          '<span class="reward-gold">' +
          def.cost +
          " gold</span> · +" +
          def.baseGold +
          " / " +
          formatSeconds(def.cycleSec) +
          (locked
            ? ' · <span class="gate">Requires Level ' + def.minLevel + "</span>"
            : "");
      }

      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(def.name) +
        (h.owned ? '<span class="badge">Held</span>' : "") +
        '<span class="badge slot-badge">' +
        escapeHtml((getRegion(def.region) || REGIONS[0]).name) +
        "</span>" +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(def.desc) +
        "</p>" +
        '<p class="card-meta">' +
        metaExtra +
        "</p>" +
        "</div>";

      const actions = document.createElement("div");
      actions.className = "card-actions";

      if (!h.owned) {
        const buyBtn = document.createElement("button");
        buyBtn.type = "button";
        buyBtn.className = "btn btn-primary";
        buyBtn.textContent = locked ? "Locked" : "Buy";
        buyBtn.disabled = locked || state.gold < def.cost;
        actionButton(buyBtn, "buy-holding", def.id);
        actions.appendChild(buyBtn);
      } else {
        const collectBtn = document.createElement("button");
        collectBtn.type = "button";
        collectBtn.className = "btn btn-primary";
        collectBtn.textContent = pending > 0 ? "Collect (" + pending + ")" : "Collect";
        collectBtn.disabled = pending <= 0;
        actionButton(collectBtn, "collect-holding", def.id);
        actions.appendChild(collectBtn);

        if (h.level < def.maxLevel) {
          const upCost = def.upgradeCost[h.level];
          const upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.className = "btn";
          upBtn.textContent = "Upgrade (" + upCost + "g)";
          upBtn.disabled = state.gold < upCost;
          actionButton(upBtn, "upgrade-holding", def.id);
          actions.appendChild(upBtn);
        }
      }

      card.appendChild(actions);
      frag.appendChild(card);
    });
    patchChildren(el.holdingsList, frag);
  }

  function renderInventory() {
    if (!el.inventoryList || !el.equipSummary) return;

    const eq = collectEquipEffects();
    const wId = state.equipped && state.equipped.weapon;
    const aId = state.equipped && state.equipped.armor;
    const wName = wId && getLootDef(wId) ? getLootDef(wId).name : "none";
    const aName = aId && getLootDef(aId) ? getLootDef(aId).name : "none";
    patchHtml(
      el.equipSummary,
      "<strong>Weapon:</strong> " +
        escapeHtml(wName) +
        " · <strong>Armor:</strong> " +
        escapeHtml(aName) +
        " · bonuses +" +
        eq.attack +
        " atk, +" +
        eq.defense +
        " def, +" +
        Math.round(eq.goldMult * 100) +
        "% gold, +" +
        Math.round(eq.xpMult * 100) +
        "% XP (incl. relics)"
    );

    const frag = document.createDocumentFragment();
    const spares = spareTotals();
    if (spares.count > 0) {
      const bar = document.createElement("div");
      bar.className = "sell-bar";
      bar.setAttribute("data-key", "sell-bar");
      const sellAll = document.createElement("button");
      sellAll.type = "button";
      sellAll.className = "btn";
      sellAll.textContent =
        "Sell all spares (" + spares.count + " items, +" + spares.gold + " gold)";
      actionButton(sellAll, "sell-spares");
      bar.appendChild(sellAll);
      frag.appendChild(bar);
    }
    let any = false;
    LOOT.forEach(function (item) {
      const count = inventoryCount(item.id);
      if (count <= 0) return;
      any = true;
      const isEquipped =
        (item.slot === "weapon" && state.equipped.weapon === item.id) ||
        (item.slot === "armor" && state.equipped.armor === item.id);
      const card = document.createElement("article");
      card.className = "card" + (isEquipped ? " equipped" : "");
      card.setAttribute("data-key", "item:" + item.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(item.name) +
        (count > 1 ? ' <span class="badge">×' + count + "</span>" : "") +
        (isEquipped ? '<span class="badge equip-badge">Equipped</span>' : "") +
        '<span class="badge slot-badge">' +
        escapeHtml(item.slot) +
        "</span>" +
        (item.region
          ? '<span class="badge region-badge">' + escapeHtml(getRegion(item.region).name) + "</span>"
          : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(item.desc) +
        ' · <span class="reward-gold">sells for ' +
        item.value +
        " gold</span></p>" +
        "</div>";

      const actions = document.createElement("div");
      actions.className = "card-actions";

      if (item.slot === "weapon" || item.slot === "armor") {
        if (isEquipped) {
          const uneq = document.createElement("button");
          uneq.type = "button";
          uneq.className = "btn";
          uneq.textContent = "Unequip";
          actionButton(uneq, "unequip", item.slot);
          actions.appendChild(uneq);
        } else {
          const eqBtn = document.createElement("button");
          eqBtn.type = "button";
          eqBtn.className = "btn btn-primary";
          eqBtn.textContent = "Equip";
          actionButton(eqBtn, "equip", item.id);
          actions.appendChild(eqBtn);
        }
      } else {
        const note = document.createElement("button");
        note.type = "button";
        note.className = "btn";
        note.textContent = "Kept";
        note.disabled = true;
        actions.appendChild(note);
      }

      const sellBtn = document.createElement("button");
      sellBtn.type = "button";
      sellBtn.className = "btn";
      sellBtn.textContent = "Sell +" + item.value;
      sellBtn.disabled = sellableCount(item) <= 0;
      sellBtn.title = sellBtn.disabled
        ? item.slot === "relic"
          ? "Your last copy keeps its blessing"
          : "Unequip before selling your last copy"
        : "Sell one for " + item.value + " gold";
      actionButton(sellBtn, "sell", item.id);
      actions.appendChild(sellBtn);

      card.appendChild(actions);
      frag.appendChild(card);
    });

    if (!any) {
      const empty = document.createElement("p");
      empty.className = "legend-empty";
      empty.textContent =
        "No loot yet. Complete quests (~22% drop chance) or win fights to find gear; bosses drop uniques.";
      frag.appendChild(empty);
    }
    patchChildren(el.inventoryList, frag);
  }

  function renderShop() {
    const frag = document.createDocumentFragment();
    UPGRADES.forEach(function (u) {
      const owned = !!state.ownedUpgrades[u.id];
      const card = document.createElement("article");
      card.className = "card" + (owned ? " owned" : "");
      card.setAttribute("data-key", "upgrade:" + u.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(u.name) +
        (owned ? '<span class="badge">Owned</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(u.desc) +
        "</p>" +
        '<p class="card-meta"><span class="reward-gold">' +
        u.cost +
        " gold</span></p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (owned) {
        btn.textContent = "Owned";
        btn.disabled = true;
      } else {
        btn.textContent = "Buy";
        btn.disabled = state.gold < u.cost;
        actionButton(btn, "upgrade", u.id);
      }
      card.appendChild(btn);
      frag.appendChild(card);
    });

    const head = document.createElement("h3");
    head.className = "subhead";
    head.setAttribute("data-key", "training-head");
    head.textContent = "Training (ranked — buy again and again)";
    frag.appendChild(head);

    RANKED_UPGRADES.forEach(function (def) {
      const rank = upgradeRank(def.id);
      const cost = rankedUpgradeCost(def);
      const maxed = cost === null;
      const card = document.createElement("article");
      card.className = "card" + (maxed ? " owned" : "");
      card.setAttribute("data-key", "train:" + def.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(def.name) +
        '<span class="badge">Rank ' +
        rank +
        " / " +
        def.maxRank +
        "</span></h3>" +
        '<p class="card-meta">' +
        escapeHtml(def.desc) +
        "</p>" +
        '<p class="card-meta">' +
        (maxed
          ? '<span class="mastery">Fully trained</span>'
          : '<span class="reward-gold">' + cost + " gold</span> for rank " + (rank + 1)) +
        "</p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (maxed) {
        btn.textContent = "Maxed";
        btn.disabled = true;
      } else {
        btn.textContent = "Train";
        btn.disabled = state.gold < cost;
        actionButton(btn, "train", def.id);
      }
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.shopList, frag);
  }

  function renderLog() {
    const frag = document.createDocumentFragment();
    logLines.forEach(function (line) {
      const li = document.createElement("li");
      li.textContent = line;
      frag.appendChild(li);
    });
    patchChildren(el.log, frag);
  }

  function renderLegends() {
    if (!el.legendsList) return;
    const frag = document.createDocumentFragment();
    const list = (state.storyUnlocks || []).slice().reverse();
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "legend-empty";
      empty.textContent =
        "No legends yet. Reach mastery ranks (5 / 15 / 40 completions) on any quest, or slay a boss.";
      frag.appendChild(empty);
      patchChildren(el.legendsList, frag);
      return;
    }
    list.forEach(function (entry) {
      const card = document.createElement("article");
      card.className = "legend-card";
      card.innerHTML =
        "<h4>" +
        escapeHtml(entry.rank) +
        " — " +
        escapeHtml(entry.questName || entry.questId) +
        "</h4>" +
        "<p>" +
        escapeHtml(entry.text) +
        "</p>";
      frag.appendChild(card);
    });
    patchChildren(el.legendsList, frag);
  }

  function renderRenown() {
    if (!el.renownBox) return;
    const rank = renownRank();
    const ready = state.level >= RENOWN_MIN_LEVEL;
    const next = rank + 1;
    const frag = document.createDocumentFragment();

    const status = document.createElement("p");
    status.className = "renown-status";
    status.setAttribute("data-key", "status");
    status.innerHTML = rank
      ? "You are <strong>" +
        escapeHtml(renownTitle(rank)) +
        "</strong> (Renown " +
        rank +
        "): +" +
        Math.round(renownBonuses().goldMult * 100) +
        "% gold, +" +
        Math.round(renownBonuses().xpMult * 100) +
        "% XP on everything."
      : "You have no Renown yet.";
    frag.appendChild(status);

    const offer = document.createElement("p");
    offer.className = "card-meta";
    offer.setAttribute("data-key", "offer");
    offer.innerHTML =
      "A new legend makes you <strong>" +
      escapeHtml(renownTitle(next)) +
      "</strong> (Renown " +
      next +
      ": +" +
      Math.round(next * RENOWN_GOLD_PER_RANK * 100) +
      "% gold, +" +
      Math.round(next * RENOWN_XP_PER_RANK * 100) +
      "% XP). You keep your name, Renown and Legends; everything else starts over at Level 1." +
      (ready ? "" : ' <span class="gate">Requires Level ' + RENOWN_MIN_LEVEL + ".</span>");
    frag.appendChild(offer);

    const row = document.createElement("div");
    row.className = "dialog-row";
    row.setAttribute("data-key", renownConfirmOpen ? "confirm-row" : "open-row");
    if (renownConfirmOpen && ready) {
      const warn = document.createElement("p");
      warn.className = "renown-warn";
      warn.textContent =
        "This resets your level, gold, gear, band, holdings, training and collections. It can't be undone.";
      row.appendChild(warn);
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "btn btn-danger";
      yes.textContent = "Begin anew at Level 1";
      actionButton(yes, "renown-confirm");
      const no = document.createElement("button");
      no.type = "button";
      no.className = "btn";
      no.textContent = "Not yet";
      actionButton(no, "renown-cancel");
      row.appendChild(yes);
      row.appendChild(no);
    } else {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "btn btn-primary";
      open.textContent = "Begin a new legend";
      open.disabled = !ready;
      actionButton(open, "renown-open");
      row.appendChild(open);
    }
    frag.appendChild(row);
    patchChildren(el.renownBox, frag);
  }

  /** Everything that can change without a player action (timers, regen, accrual). */
  function renderLive() {
    renderStatsOnly();
    renderRegions();
    renderQuests();
    renderFights();
    renderBosses();
    renderHeals();
    renderBand();
    renderHoldings();
    renderInventory();
    renderCollections();
    renderShop();
    renderRenown();
    renderTabAlerts();
  }

  function render() {
    renderStatsOnly();
    renderRegions();
    renderQuests();
    renderFights();
    renderBosses();
    renderHeals();
    renderBand();
    renderHoldings();
    renderInventory();
    renderCollections();
    renderShop();
    renderRenown();
    renderLog();
    renderLegends();
    renderTabAlerts();
    renderTicker();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- Boot ---

  el.btnRename.addEventListener("click", openRename);
  el.btnReset.addEventListener("click", openResetConfirm);
  el.renameForm.addEventListener("submit", submitRename);
  el.renameCancel.addEventListener("click", closeHeaderDialogs);
  el.resetYes.addEventListener("click", resetGame);
  el.resetCancel.addEventListener("click", closeHeaderDialogs);
  el.btnBackup.addEventListener("click", openBackup);
  el.btnSound.addEventListener("click", toggleSound);
  el.backupCopy.addEventListener("click", copyBackup);
  el.backupLoad.addEventListener("click", loadBackup);
  el.backupClose.addEventListener("click", closeHeaderDialogs);
  el.tabBar.addEventListener("click", onTabClick);
  el.tabBar.addEventListener("keydown", onTabKey);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeHeaderDialogs();
  });
  document.addEventListener("click", onActionClick);
  // Tick saves are throttled, so flush whenever the page may go away.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") save();
  });
  window.addEventListener("pagehide", save);
  window.addEventListener("beforeunload", save);

  load();
  if (logLines.length === 0) {
    addLog(
      "Welcome to Ruin Wars. Quests across three regions, The Lists, Bosses, your Knight Band, Holdings, loot and Collections await."
    );
  }
  setTab(initialTab());
  soundOn = readSoundPref();
  renderSoundToggle();
  render();
  setInterval(tick, TICK_MS);

  window.RuinWars = {
    getState: function () {
      return Object.assign({}, state);
    },
    getLog: function () {
      return logLines.slice();
    },
    save: save,
    QUESTS: QUESTS,
    FOES: FOES,
    HEALS: HEALS,
    UPGRADES: UPGRADES,
    RANKED_UPGRADES: RANKED_UPGRADES,
    HOLDINGS: HOLDINGS,
    LOOT: LOOT,
    STORY_BEATS: STORY_BEATS,
    MASTERY_THRESHOLDS: MASTERY_THRESHOLDS,
    REGIONS: REGIONS,
    COLLECTIONS: COLLECTIONS,
    BOSSES: BOSSES,
    RENOWN_TITLES: RENOWN_TITLES,
    NAMED_KNIGHTS: NAMED_KNIGHTS,
    SAVE_VERSION: SAVE_VERSION,
    attackRating: attackRating,
    fightWinChance: fightWinChance,
    defenseRating: defenseRating,
    bandCap: bandCap,
    hireCost: hireCost,
  };
})();
