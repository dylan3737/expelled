/**
 * Expelled — the rise of a dark magician (v2.4; called Ruin Wars until v2.2). Content tables live in content.js, pure formulas in formulas.js.
 * Quests (Energy) across Regions + mastery/story/requirements, The Lists (Stamina/Health, odds-based
 * bouts), Bosses, Knight Band, Holdings (passive gold), Loot/Inventory (region tiers, equip, sell),
 * Collections, shop upgrades + ranked training.
 * Persist: localStorage SAVE_KEY (Ruin Wars-era keys are read on first load, and left untouched)
 */

(function () {
  "use strict";

  const SAVE_KEY = "expelled_save_v1";
  const RUIN_WARS_SAVE_KEY = "ruin_wars_save_v4"; // the game was called Ruin Wars until v2.2
  const LEGACY_SAVE_KEYS = ["ruin_wars_save_v1"]; // v0.3 and earlier
  const UNREADABLE_SAVE_KEY = "expelled_save_unreadable"; // copy of a save that failed to load
  const UPSET_ACHIEVEMENT_ODDS = 0.3; // "Against the Odds": win a bout with odds below this
  const SAVE_VERSION = 12;
  const FACTION_STEP = 10; // standing gained (and lost by the rival) at each crossroads
  const FACTION_LIMIT = 100;
  const CROSSROADS_EVERY = 12; // schemes between crossroads
  const CROSSROADS_MIN_LEVEL = 5;
  const CROSSROADS_RECENT = 4; // a crossroads isn't offered again until this many others have been
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
  /** Infamy title for rank 1, 2, … (the last one repeats for higher ranks). */
  const RENOWN_TITLES = [
    "Whispered Name",
    "Dread Sorcerer",
    "Lord of Shadows",
    "Archmage of the Black Spire",
    "The Unending",
  ];
  const MASTERY_THRESHOLDS = [5, 15, 40];
  const MASTERY_RANKS = ["Untried", "Practiced", "Adept", "Master"];
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

  /** What players call each equipment slot. */
  const SLOT_LABELS = { weapon: "focus", armor: "vestments", relic: "talisman" };

  // --- Content tables (content.js) and pure formulas (formulas.js) ---

  const F = window.ExpelledFormulas;
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
    ACHIEVEMENTS,
    EVENTS,
    SPELLS,
    CHAPTERS,
    ACT_NAMES,
    EPILOGUE,
    FACTIONS,
    CROSSROADS,
  } = window.ExpelledContent;
  const xpForLevel = F.xpForLevel;
  const formatCooldown = F.formatCooldown;
  const upsetMultiplier = F.upsetMultiplier;
  const msUntilFull = F.msUntilFull;

  function defaultState() {
    return {
      name: "Magician",
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
      achievements: {}, // id -> time earned; kept through Renown
      stats: { fightWins: 0, upsets: 0 }, // lifetime counters; kept through Renown
      daily: { lastDay: null, streak: 0 }, // daily tribute; kept through Renown
      events: {}, // "<event>-<year>" -> { tokens, claimed, cooldownUntil }; kept through Renown
      spells: { casts: {}, cooldownUntil: {}, active: {} }, // Spellbook; mastery (casts) kept through rebirth
      story: { done: {}, seen: null }, // chapter id -> time finished; seen = last chapter read; kept through rebirth
      // standing per faction, the crossroads waiting for a choice, schemes since the last one; kept through rebirth
      factions: { standing: {}, pending: null, sinceLast: CROSSROADS_EVERY, choices: 0, recent: [] },
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

  /** Rank name for a mastery tier; tier 0 reads "Novice" once it has been done at all. */
  function rankLabel(tier, count) {
    if (tier === 0 && count > 0) return "Novice";
    return MASTERY_RANKS[tier] || MASTERY_RANKS[0];
  }

  function masteryRankName(questId) {
    return rankLabel(masteryTier(questId), questCount(questId));
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
    return weightedPick(pool);
  }

  /** Random entry from a list of { weight } objects, in proportion to weight (null if empty). */
  function weightedPick(pool) {
    if (!pool.length) return null;
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
      "Grimoire page found: " +
        piece.name +
        " (" +
        set.name +
        ")" +
        (n > 1 ? " — duplicate ×" + n + "." : "!")
    );
    if (n === 1 && collectionComplete(set) && !collectionRedeemed(set.id)) {
      addLog(set.name + " is complete! Bind it under Hoard.");
    }
  }

  // --- Thralls (the band) ---

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
    m += spellEffects().goldMult;
    m += factionBonuses().goldMult;
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
    m += spellEffects().xpMult;
    m += factionBonuses().xpMult;
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

  /** The Tempered Blade: the first purchase the game steers new players to. */
  function bladeUpgrade() {
    return UPGRADES.find(function (u) {
      return u.id === "sword";
    });
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
    let bonus = factionBonuses().regenMult;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.regenMult) {
        bonus += u.effect.regenMult;
      }
    }
    return Math.max(2500, Math.floor(BASE_REGEN_MS / (1 + bonus)));
  }

  /** Attack rating: level + shop + training + gear + band + collections, raised by spells */
  function attackRating() {
    const eq = collectEquipEffects();
    const base =
      state.level * 8 +
      attackBonusFromShop() +
      rankedBonuses().attack +
      eq.attack +
      bandBonuses().attack +
      collectionBonuses().attack;
    return Math.round(base * (1 + spellEffects().attackPct + factionBonuses().attackPct));
  }

  /** Defense rating: soaks a share of fight and boss damage */
  function defenseRating() {
    const eq = collectEquipEffects();
    const base =
      state.level * 3 +
      rankedBonuses().defense +
      eq.defense +
      bandBonuses().defense +
      collectionBonuses().defense;
    return Math.round(base * (1 + spellEffects().defensePct + factionBonuses().defensePct));
  }

  function soakDamage(dmg) {
    return F.soakDamage(dmg, defenseRating());
  }

  /** Attack in a duel: the attack rating, plus any Hex waiting for the next duel. */
  function duelAttack() {
    return attackRating() * (1 + spellEffects().duelPower);
  }

  /** Chance to win a duel against this foe. */
  function fightWinChance(foe) {
    return F.fightWinChance(duelAttack(), foe.power);
  }

  // --- Quest requirements ---

  /** Each requirement of a quest with whether it is met: [{ label, met }] */
  function questRequirements(quest) {
    const r = quest.requires;
    if (!r) return [];
    const out = [];
    if (r.band) {
      out.push({ label: r.band + " thralls", met: bandSize() >= r.band });
    }
    if (r.weapon) {
      out.push({ label: "a focus equipped", met: !!equippedItem("weapon") });
    }
    if (r.armor) {
      out.push({ label: "vestments worn", met: !!equippedItem("armor") });
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
    return weightedPick(
      LOOT.filter(function (L) {
        return L.weight > 0 && L.region === (regionId || "camelot");
      })
    );
  }

  function grantLoot(item) {
    if (!item) return;
    if (!state.inventory) state.inventory = {};
    state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;
    addLog("You pocket " + item.name + "!");
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
      let carriedOver = false;
      if (!raw) {
        // A save from when the game was called Ruin Wars carries over (its copy is left untouched)
        raw = localStorage.getItem(RUIN_WARS_SAVE_KEY);
        carriedOver = !!raw;
      }
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
      if (carriedOver) {
        addLog("Ruin Wars is now called Expelled. Your magician and all their progress came with you.");
        save();
      }
    } catch (e) {
      // Starting fresh would overwrite the unreadable save on the next save(), so keep a copy first.
      console.error("Expelled: the save could not be loaded; a copy was kept under " + UNREADABLE_SAVE_KEY, e);
      try {
        // Keep the first unreadable save: a later failure must not replace it.
        if (raw && !localStorage.getItem(UNREADABLE_SAVE_KEY)) localStorage.setItem(UNREADABLE_SAVE_KEY, raw);
      } catch (e2) {
        // storage unavailable: nothing more we can do
      }
      state = defaultState();
      logLines = [];
      addLog(
        "Your save could not be read, so a new apprentice takes up the craft. The old save was kept; " +
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
    // v0.9 fields
    if (!state.achievements || typeof state.achievements !== "object") state.achievements = {};
    if (!state.stats || typeof state.stats !== "object") state.stats = {};
    if (typeof state.stats.fightWins !== "number") state.stats.fightWins = 0;
    if (typeof state.stats.upsets !== "number") state.stats.upsets = 0;
    if (!state.daily || typeof state.daily !== "object") state.daily = {};
    if (typeof state.daily.lastDay !== "string") state.daily.lastDay = null;
    if (typeof state.daily.streak !== "number") state.daily.streak = 0;
    // v1.0 fields
    if (!state.events || typeof state.events !== "object") state.events = {};
    // v2.1 fields
    if (!state.spells || typeof state.spells !== "object") state.spells = {};
    ["casts", "cooldownUntil", "active"].forEach(function (k) {
      if (!state.spells[k] || typeof state.spells[k] !== "object") state.spells[k] = {};
    });
    // v2.2 fields
    if (!state.story || typeof state.story !== "object") state.story = {};
    if (!state.story.done || typeof state.story.done !== "object") state.story.done = {};
    if (typeof state.story.seen !== "string") state.story.seen = null;
    // v2.5 fields
    const fx = state.factions && typeof state.factions === "object" ? state.factions : {};
    state.factions = {
      standing: fx.standing && typeof fx.standing === "object" ? fx.standing : {},
      pending: typeof fx.pending === "string" && crossroadsDef(fx.pending) ? fx.pending : null,
      sinceLast: typeof fx.sinceLast === "number" ? fx.sinceLast : CROSSROADS_EVERY,
      choices: typeof fx.choices === "number" ? fx.choices : 0,
      recent: Array.isArray(fx.recent) ? fx.recent : [],
    };
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
    if (migratedFrom || oldVersion < 9) {
      addLog(
        "Your tale has been retold: you are a dark magician, cast out of the White College and rising " +
          "from the gutters of Hollowmere. Every level, item and deed carries over under its new name."
      );
    }
    if (migratedFrom || oldVersion < 10) {
      addLog("New: the Spellbook. Cast spells with Mana from the Spells tab; your level decides which you know.");
    }
    if (migratedFrom || oldVersion < SAVE_VERSION) {
      addLog(
        "New: the main story, and a fifth region, the Black Spire (Level 45). Your current chapter shows under " +
          "your stats; the whole tale is in the Chronicle."
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

  let logSeq = 0; // bumps on every new chronicle line, so repeated text still refreshes the ticker

  function addLog(msg) {
    logSeq += 1;
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
          "! Max Mana " +
          state.energyMax +
          ", Will " +
          state.staminaMax +
          ", Health " +
          state.healthMax +
          "."
      );
      REGIONS.forEach(function (r) {
        if (r.minLevel === state.level) {
          addLog("New region unlocked: " + r.name + "! Switch regions above the scheme board.");
        }
      });
      SPELLS.forEach(function (sp) {
        if (sp.minLevel === state.level) {
          addLog("You learn a new spell: " + sp.name + ". Find it in the Spellbook.");
        }
      });
      BOSSES.forEach(function (b) {
        if (b.minLevel === state.level) {
          addLog(b.name + " has learned your name. See Nemeses.");
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
    addLog("Secret learned (" + entry.rank + " — " + entry.questName + "). Read it in the Chronicle.");
  }

  function checkMasteryMilestones(questId, newCount) {
    for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
      const t = MASTERY_THRESHOLDS[i];
      if (newCount === t) {
        const rank = MASTERY_RANKS[i + 1];
        const bonus = MASTERY_BONUSES[i + 1];
        const parts = [];
        if (bonus.goldAdd) parts.push("+" + Math.round(bonus.goldAdd * 100) + "% gold on this scheme");
        if (bonus.xpAdd) parts.push("+" + Math.round(bonus.xpAdd * 100) + "% XP on this scheme");
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
      addLog("Not enough Mana for \"" + quest.name + "\".");
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
    const cut = Math.min(0.75, spellEffects().cooldownCut);
    state.questCooldownUntil[quest.id] = Date.now() + Math.round(F.questCooldownMs(quest) * (1 - cut));

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
    noteSchemeForCrossroads();

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
      addLog("You have fallen. Visit the Apothecary before you duel again.");
      render();
      return;
    }
    if (state.stamina < foe.stamina) {
      addLog("Not enough Will to challenge " + foe.name + ".");
      render();
      return;
    }
    const cdLeft = fightCooldownRemaining(foe.id);
    if (cdLeft > 0) {
      addLog(
        foe.name + " is not yet ready for another duel — " + formatCooldown(cdLeft) + " left."
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
    useSpellCharge("duelPower");

    if (won) {
      const upset = upsetMultiplier(odds);
      state.stats.fightWins += 1;
      if (odds < UPSET_ACHIEVEMENT_ODDS) state.stats.upsets += 1;
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
        addLog("The duel left you fallen. Seek the Apothecary.");
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
        addLog("You have fallen in the Circle. Visit the Apothecary to rise again.");
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
    addLog("You slip away to " + r.name + ".");
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
      addLog("You have fallen. Visit the Apothecary before facing " + def.name + ".");
      render();
      return;
    }
    if (state.stamina < def.stamina) {
      addLog("Not enough Will to strike " + def.name + ".");
      render();
      return;
    }

    state.stamina -= def.stamina;
    const roll = 0.85 + Math.random() * 0.3;
    const dmgMult = 1 + bossDamageBonus(def.id) + spellEffects().nemesisDamage;
    const dmg = Math.max(1, Math.floor(attackRating() * roll * dmgMult));
    useSpellCharge("nemesisDamage");
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
          rank: "Nemesis Fallen",
          questName: def.name,
          text: BOSS_LEGENDS[def.id],
          at: Date.now(),
        });
        addLog("Secret learned (Nemesis Fallen — " + def.name + "). Read it in the Chronicle.");
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
        addLog(def.name + " has laid you low. Visit the Apothecary; the wounds you dealt remain.");
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
      addLog("You hold as many thralls as you can (" + cap + "). Gain levels to command more.");
      render();
      return;
    }
    const cost = hireCost();
    if (state.gold < cost) {
      addLog("Need " + cost + " gold to enthrall a servant.");
      render();
      return;
    }
    state.gold -= cost;
    band.recruits += 1;
    addLog(
      "A new thrall bends the knee for " +
        cost +
        " gold. Thralls " +
        bandSize() +
        " (" +
        band.recruits +
        "/" +
        cap +
        " bound)."
    );
    save();
    render();
  }

  function rallyRecruit() {
    const band = bandState();
    const cap = bandCap();
    if (band.recruits >= cap) {
      addLog("You hold as many thralls as you can (" + cap + "). Gain levels to command more.");
      render();
      return;
    }
    const left = rallyRemaining();
    if (left > 0) {
      addLog("The graves are still settling — raise again in " + formatCooldown(left) + ".");
      render();
      return;
    }
    band.recruits += 1;
    band.rallyReadyAt = Date.now() + RALLY_COOLDOWN_MS;
    addLog(
      "You raise the dead; a restless soul answers freely. Thralls " + bandSize() + "."
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
      addLog(k.name + " already serves you.");
      render();
      return;
    }
    if (state.level < k.minLevel) {
      addLog(k.name + " will only serve a Level " + k.minLevel + " magician.");
      render();
      return;
    }
    if (state.gold < k.cost) {
      addLog("Need " + k.cost + " gold to win " + k.name + " to your service.");
      render();
      return;
    }
    state.gold -= k.cost;
    band.named[k.id] = true;
    addLog(k.name + " enters your service! (+" + k.attack + " atk, +" + k.defense + " def)");
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
      "Apothecary: " +
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
    addLog("Acquired lair: " + def.name + ".");
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
      addLog(item.name + " is a kept talisman — its power is already active.");
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
          ? "You keep your last " + item.name + " — its power would be lost."
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
        "That isn't an Expelled save. Paste the whole code, starting with " + F.BACKUP_PREFIX,
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
    checkStory();
    checkAchievements();
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
      addLog("Reach Level " + RENOWN_MIN_LEVEL + " before you are reborn.");
      render();
      return;
    }
    const kept = {
      name: state.name,
      renown: renownRank() + 1,
      storyUnlocks: state.storyUnlocks,
      achievements: state.achievements,
      stats: state.stats,
      daily: state.daily,
      events: state.events,
      spells: { casts: state.spells.casts, cooldownUntil: {}, active: {} },
      story: state.story,
      factions: state.factions,
    };
    const finalLevel = state.level;
    state = Object.assign(defaultState(), kept);
    syncMaxesFromLevel();
    addLog(
      "At Level " +
        finalLevel +
        " you pour your power into a phylactery and wake in a new body, an apprentice again. The whispers remember: you are now " +
        state.name +
        ", " +
        renownTitle(state.renown) +
        " (Infamy " +
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
    addLog("A new apprentice takes up the dark arts.");
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
    pruneSpells();

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
    toasts: document.getElementById("toasts"),
    dailyBar: document.getElementById("daily-bar"),
    eventBar: document.getElementById("event-bar"),
    achvList: document.getElementById("achievements-list"),
    achvSummary: document.getElementById("achievements-summary"),
    guide: document.getElementById("guide"),
    btnGuide: document.getElementById("btn-guide"),
    guideClose: document.getElementById("guide-close"),
    btnMusic: document.getElementById("btn-music"),
    spellList: document.getElementById("spell-list"),
    activeSpells: document.getElementById("active-spells"),
    storyBar: document.getElementById("story-bar"),
    crossroads: document.getElementById("crossroads"),
    factionSummary: document.getElementById("faction-summary"),
    factionList: document.getElementById("faction-list"),
    tale: document.getElementById("tale"),
    taleList: document.getElementById("tale-list"),
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
    daily: claimDaily,
    cast: castSpell,
    "read-story": readStory,
    crossroads: chooseCrossroads,
    "event-fight": doEventFight,
    "event-claim": claimEventReward,
  };

  function onActionClick(ev) {
    const target = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
    if (!target || target.disabled) return;
    const fn = ACTIONS[target.getAttribute("data-action")];
    if (!fn) return;
    const action = target.getAttribute("data-action");
    const before = feedbackSnapshot();
    fn(target.getAttribute("data-id"));
    const finished = checkStory();
    const earned = checkAchievements();
    showActionFeedback(target, before, action);
    playCue(
      (earned.length || finished.length) && !(state.level > before.level) ? "achievement" : cueForAction(action, before)
    );
    if (earned.length || finished.length) {
      save();
      render();
    }
  }

  // --- Sound: short synthesized cues (Web Audio), off by default ---

  const SOUND_PREF_KEY = "expelled_sound"; // per-browser preference, not part of the save
  let soundOn = false;
  let audioCtx = null;

  /** Per-browser settings (not part of the save). Storage may be blocked, so failures are ignored. */
  function readPref(key) {
    try {
      // Fall back to the same preference saved while the game was called Ruin Wars
      const v = localStorage.getItem(key);
      return v !== null ? v : localStorage.getItem(key.replace(/^expelled_/, "ruin_wars_"));
    } catch (e) {
      return null;
    }
  }

  function writePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // ignore: the setting still applies for this visit
    }
  }

  function renderSoundToggle() {
    el.btnSound.textContent = soundOn ? "Sound: on" : "Sound: off";
    el.btnSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  }

  function toggleSound() {
    soundOn = !soundOn;
    writePref(SOUND_PREF_KEY, soundOn ? "on" : "off");
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
  function tone(ctx, freq, start, length, type, volume, slideTo, dest) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + length);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(gain).connect(dest || ctx.destination);
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
    spell: function (ctx) {
      tone(ctx, 440, 0, 0.5, "sine", 0.1, 880);
      tone(ctx, 660, 0.08, 0.5, "triangle", 0.07, 1320);
      tone(ctx, 1760, 0.25, 0.35, "sine", 0.04);
    },
    achievement: function (ctx) {
      tone(ctx, 784, 0, 0.16, "triangle", 0.14);
      tone(ctx, 1047, 0.1, 0.16, "triangle", 0.14);
      tone(ctx, 1319, 0.2, 0.45, "triangle", 0.12);
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

  // --- Music: a slow generated loop (drone chords + sparse harp notes), off by default ---

  const MUSIC_PREF_KEY = "expelled_music"; // per-browser preference, not part of the save
  const MUSIC_BAR_S = 4.8; // seconds per chord
  // D harmonic minor: Dm – B♭ – Gm – A (the major A pulls back to Dm with a little menace),
  // as [root, fifth, third] in Hz, and the notes the harp may pick.
  const MUSIC_CHORDS = [
    [73.42, 110.0, 174.61],
    [58.27, 87.31, 146.83],
    [49.0, 73.42, 116.54],
    [55.0, 82.41, 138.59],
  ];
  const MUSIC_HARP = [293.66, 349.23, 392.0, 440.0, 466.16, 554.37, 587.33];
  let musicOn = false;
  let musicBus = null;
  let musicTimer = null;
  let musicNextBar = 0;
  let musicBarIndex = 0;

  function renderMusicToggle() {
    el.btnMusic.textContent = musicOn ? "Music: on" : "Music: off";
    el.btnMusic.setAttribute("aria-pressed", musicOn ? "true" : "false");
  }

  function toggleMusic() {
    musicOn = !musicOn;
    writePref(MUSIC_PREF_KEY, musicOn ? "on" : "off");
    renderMusicToggle();
    if (musicOn) startMusic();
    else stopMusic();
  }

  /** A soft held note with a slow swell, for the drone. `when` is an absolute context time. */
  function padNote(ctx, freq, when, length, volume) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(volume, when + length * 0.35);
    gain.gain.linearRampToValueAtTime(0.0001, when + length);
    osc.connect(gain).connect(musicBus);
    osc.start(when);
    osc.stop(when + length + 0.05);
  }

  function scheduleMusicBar(ctx, when) {
    const chord = MUSIC_CHORDS[musicBarIndex % MUSIC_CHORDS.length];
    musicBarIndex += 1;
    chord.forEach(function (f, i) {
      padNote(ctx, f, when, MUSIC_BAR_S + 0.8, i === 0 ? 0.16 : 0.09);
    });
    // Two to four plucked notes per chord, on the beat, never two the same in a row.
    const beat = MUSIC_BAR_S / 4;
    let last = -1;
    for (let b = 0; b < 4; b++) {
      if (Math.random() < 0.35) continue;
      let i = Math.floor(Math.random() * MUSIC_HARP.length);
      if (i === last) i = (i + 2) % MUSIC_HARP.length;
      last = i;
      tone(ctx, MUSIC_HARP[i], when - ctx.currentTime + b * beat, 1.6, "sine", 0.07, null, musicBus);
    }
  }

  function scheduleMusic() {
    const ctx = audioCtx;
    if (!ctx || !musicOn) return;
    while (musicNextBar < ctx.currentTime + 1.5) {
      scheduleMusicBar(ctx, musicNextBar);
      musicNextBar += MUSIC_BAR_S;
    }
  }

  function startMusic() {
    if (!musicOn || document.visibilityState === "hidden") return;
    let ctx = null;
    try {
      ctx = audio();
    } catch (e) {
      ctx = null;
    }
    if (!ctx) return;
    if (!musicBus) {
      musicBus = ctx.createGain();
      const soften = ctx.createBiquadFilter();
      soften.type = "lowpass";
      soften.frequency.value = 2200;
      musicBus.connect(soften).connect(ctx.destination);
    }
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.55, ctx.currentTime, 1.2);
    musicNextBar = Math.max(musicNextBar, ctx.currentTime + 0.1);
    if (!musicTimer) musicTimer = setInterval(scheduleMusic, 300);
    scheduleMusic();
  }

  function stopMusic() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
    if (musicBus && audioCtx) {
      musicBus.gain.cancelScheduledValues(audioCtx.currentTime);
      musicBus.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.3);
    }
  }

  const SPEND_ACTIONS = ["upgrade", "train", "hire", "named", "buy-holding", "upgrade-holding"];

  /** Pick a sound for what an action just did (null when nothing happened). */
  function cueForAction(action, before) {
    const dGold = state.gold - before.gold;
    if (state.level > before.level) return "levelup";
    if (bossKills() > before.bossKills) return "boss";
    if (action === "quest") return dGold > 0 ? "quest" : null;
    if (action === "fight" || action === "event-fight") {
      if (dGold > 0) return "win";
      return state.health < before.health || state.xp !== before.xp ? "loss" : null;
    }
    if (action === "boss") return dGold > 0 ? "hit" : null;
    if (action === "heal") return state.health > before.health ? "heal" : null;
    if (action === "rally") return bandSize() > before.band ? "quest" : null;
    if (action === "cast") return state.energy < before.energy ? "spell" : null;
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

  const TAB_IDS = ["quests", "spells", "lists", "bosses", "band", "factions", "holdings", "gear", "armory", "chronicle"];
  const TAB_STORE_KEY = "expelled_tab"; // per-browser convenience, not part of the save
  let currentTab = "quests";

  function initialTab() {
    const hash = (location.hash || "").replace("#", "");
    if (TAB_IDS.indexOf(hash) >= 0) return hash;
    const stored = readPref(TAB_STORE_KEY);
    return TAB_IDS.indexOf(stored) >= 0 ? stored : "quests";
  }

  /** Scroll the tab bar (not the page) so this tab is fully visible. */
  function revealTab(btn) {
    const bar = el.tabBar;
    const left = btn.offsetLeft - bar.offsetLeft;
    const right = left + btn.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollLeft = Math.max(0, left - 24);
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth + 24;
    updateTabBarEdges();
  }

  /** Fade the tab bar's edges while more tabs are hidden off either side (narrow screens). */
  function updateTabBarEdges() {
    const bar = el.tabBar;
    bar.classList.toggle("more-left", bar.scrollLeft > 2);
    bar.classList.toggle("more-right", bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2);
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
      if (on) revealTab(btn);
    });
    writePref(TAB_STORE_KEY, tabId);
    if (tabId === "chronicle") {
      const ch = currentChapter();
      if (ch) state.story.seen = ch.id;
    }
    renderTabPanels();
    // Reading the current chapter clears its dot and its "Read new chapter" label straight away.
    if (el.storyBar) {
      renderTabAlerts();
      renderStoryBar();
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
    alerts.quests = !!state.factions.pending;
    alerts.holdings = HOLDINGS.some(function (def) {
      const h = state.holdings && state.holdings[def.id];
      return !!(h && h.owned && h.pending >= holdingCap(def, h));
    });
    alerts.band = rallyRemaining() === 0 && bandState().recruits < bandCap();
    alerts.gear = COLLECTIONS.some(function (set) {
      return collectionComplete(set) && !collectionRedeemed(set.id);
    });
    const blade = bladeUpgrade();
    alerts.armory = !state.ownedUpgrades[blade.id] && state.gold >= blade.cost;
    const ev = currentEvent();
    alerts.lists =
      !!ev && !state.fallen && ev.progress.cooldownUntil <= Date.now() && state.stamina >= EVENT_FOE_STAMINA;
    const chapter = currentChapter();
    alerts.chronicle = state.level >= RENOWN_MIN_LEVEL || (!!chapter && state.story.seen !== chapter.id);
    alerts.spells = SPELLS.some(function (sp) {
      return state.level >= sp.minLevel && spellCasts(sp.id) === 0;
    });
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
    quests: "A crossroads waits for your choice.",
    holdings: "A lair is full. Collect its gold.",
    band: "The dead are ready to rise.",
    gear: "A grimoire is complete. Bind it.",
    bosses: "A nemesis is ready to strike.",
    armory: "You can afford the Blackthorn Wand.",
    lists: "The festival champion is ready for you.",
    chronicle: "A new chapter, or rebirth, awaits in the Chronicle.",
    spells: "You know a spell you have never cast.",
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
  let tickerSeq = -1;
  let tickerLines = null;

  function renderTicker() {
    if (!el.ticker) return;
    el.ticker.hidden = currentTab === "chronicle" || logLines.length === 0;
    if (logSeq === tickerSeq && logLines === tickerLines) return;
    const isNew = tickerSeq !== -1 && logLines === tickerLines;
    tickerSeq = logSeq;
    tickerLines = logLines;
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
      energy: state.energy,
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

  function showActionFeedback(target, before, action) {
    const parts = [];
    const dGold = state.gold - before.gold;
    const dXp = xpGainedSince(before);
    const dHealth = state.health - before.health;
    if (dGold > 0) parts.push({ cls: "fx-gold", text: "+" + dGold + "g" });
    if (dGold < 0) parts.push({ cls: "fx-spend", text: "−" + -dGold + "g" });
    if (dXp > 0) parts.push({ cls: "fx-xp", text: "+" + dXp + " XP" });
    if (dHealth > 0) parts.push({ cls: "fx-heal", text: "+" + dHealth + " HP" });
    if (dHealth < 0) parts.push({ cls: "fx-hurt", text: "−" + -dHealth + " HP" });
    if (action === "cast" && state.energy < before.energy) {
      parts.push({ cls: "fx-mana", text: "−" + (before.energy - state.energy) + " Mana" });
    }
    if (parts.length) {
      // The clicked button may have just been hidden (the daily bar closes on Claim): float from Gold instead.
      let rect = target.isConnected ? target.getBoundingClientRect() : null;
      if (!rect || (rect.width === 0 && rect.height === 0)) rect = el.gold.getBoundingClientRect();
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
    showToast("Level " + state.level + "!", "level-toast", 2200);
  }

  /** Banner at the top of the screen; several stack instead of overlapping. */
  const MAX_TOASTS = 3;

  function showToast(text, className, ms) {
    // Keep the stack short: a burst (e.g. a returning player's catch-up) shows only the newest few.
    while (el.toasts.children.length >= MAX_TOASTS) el.toasts.firstElementChild.remove();
    const toast = document.createElement("div");
    toast.className = className;
    toast.setAttribute("role", "status");
    toast.textContent = text;
    el.toasts.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, ms);
  }

  // --- Achievements ---

  function totalQuestsDone() {
    return Object.keys(state.questCounts || {}).reduce(function (sum, id) {
      return sum + (state.questCounts[id] || 0);
    }, 0);
  }

  function ownedHoldingsCount() {
    return HOLDINGS.filter(function (def) {
      return !!(state.holdings && state.holdings[def.id] && state.holdings[def.id].owned);
    }).length;
  }

  function trainingRanksTotal() {
    return RANKED_UPGRADES.reduce(function (sum, def) {
      return sum + upgradeRank(def.id);
    }, 0);
  }

  /** { cur, target } for an achievement's check (cur is capped at target). */
  function achievementProgress(a) {
    const c = a.check;
    let cur = 0;
    let target = c.target;
    switch (c.type) {
      case "questsDone":
        cur = totalQuestsDone();
        break;
      case "questsMastered":
        cur = QUESTS.filter(function (q) {
          return masteryTier(q.id) >= MASTERY_THRESHOLDS.length;
        }).length;
        if (target === "all") target = QUESTS.length;
        break;
      case "level":
        cur = state.level;
        break;
      case "fightWins":
        cur = state.stats.fightWins;
        break;
      case "upsets":
        cur = state.stats.upsets;
        break;
      case "bossKill": {
        const b = state.bosses && state.bosses[c.target];
        cur = b && b.kills > 0 ? 1 : 0;
        target = 1;
        break;
      }
      case "band":
        cur = bandSize();
        break;
      case "namedKnights":
        cur = namedKnightsOwned().length;
        if (target === "all") target = NAMED_KNIGHTS.length;
        break;
      case "holdings":
        cur = ownedHoldingsCount();
        if (target === "all") target = HOLDINGS.length;
        break;
      case "collections":
        cur = redeemedCount();
        if (target === "all") target = COLLECTIONS.length;
        break;
      case "trainingRanks":
        cur = trainingRanksTotal();
        break;
      case "renown":
        cur = renownRank();
        break;
      case "dailyStreak":
        cur = state.daily.streak;
        break;
      case "questCount":
        cur = questCount(c.quest);
        break;
      case "upgrade":
        cur = state.ownedUpgrades[c.id] ? 1 : 0;
        break;
      case "crossroads":
        cur = state.factions.choices;
        break;
      case "factionsSworn":
        cur = FACTIONS.filter(function (f) {
          return factionStanding(f.id) >= FACTION_SWORN;
        }).length;
        break;
      case "chapters":
        cur = chaptersDone();
        if (target === "all") target = CHAPTERS.length;
        break;
      case "spellCasts":
        cur = Object.keys(state.spells.casts).reduce(function (sum, id) {
          return sum + state.spells.casts[id];
        }, 0);
        break;
      case "spellsMastered":
        cur = SPELLS.filter(function (sp) {
          return spellRank(sp.id) >= F.SPELL_RANK_CASTS.length;
        }).length;
        break;
      case "eventRewards":
        cur = Object.keys(state.events).filter(function (k) {
          return state.events[k].claimed;
        }).length;
        break;
    }
    return { cur: Math.min(cur, target), target: target };
  }

  function achievementEarned(id) {
    return !!(state.achievements && state.achievements[id]);
  }

  /** Award every achievement whose goal is now met. Returns the newly earned ones. */
  function checkAchievements() {
    const earned = [];
    ACHIEVEMENTS.forEach(function (a) {
      if (achievementEarned(a.id)) return;
      const p = achievementProgress(a);
      if (p.cur < p.target) return;
      state.achievements[a.id] = Date.now();
      state.gold += a.gold;
      earned.push(a);
    });
    if (!earned.length) return earned;
    if (earned.length <= 2) {
      earned.forEach(function (a) {
        addLog("Achievement earned: " + a.name + " — " + a.desc + (a.gold ? " +" + a.gold + " gold." : ""));
        showToast("Achievement: " + a.name, "achv-toast", 3000);
      });
    } else {
      const gold = earned.reduce(function (sum, a) {
        return sum + a.gold;
      }, 0);
      addLog(
        earned.length +
          " achievements earned for deeds already done: " +
          earned
            .map(function (a) {
              return a.name;
            })
            .join(", ") +
          ". +" +
          gold +
          " gold. See the Chronicle tab."
      );
      showToast(earned.length + " achievements earned!", "achv-toast", 3000);
    }
    return earned;
  }

  // --- Daily tribute ---

  function todayKey() {
    return F.dayKey(new Date());
  }

  /** The streak a claim today would reach, or null if today's tribute is already claimed. */
  function dailyAvailable() {
    return F.dailyStreakIfClaimed(state.daily.lastDay, todayKey(), state.daily.streak);
  }

  function claimDaily() {
    const streak = dailyAvailable();
    if (streak === null) {
      addLog("Tonight's tithe is already in your coffers. Return tomorrow night.");
      render();
      return;
    }
    const gold = F.dailyGold(state.level, streak);
    state.gold += gold;
    state.energy = Math.max(state.energy, state.energyMax);
    state.daily = { lastDay: todayKey(), streak: streak };
    addLog(
      "Nightly tithe, night " +
        streak +
        ": your cult sends " +
        gold +
        " gold, and your mana runs full." +
        (streak < F.DAILY_STREAK_MAX ? " Return tomorrow night for more." : "")
    );
    save();
    render();
  }

  function renderDaily() {
    const streak = dailyAvailable();
    el.dailyBar.hidden = streak === null;
    if (streak === null) return;
    const day = Math.min(streak, F.DAILY_STREAK_MAX);
    const frag = document.createDocumentFragment();
    const text = document.createElement("p");
    text.setAttribute("data-key", "daily-text");
    text.innerHTML =
      "<strong>Nightly tithe</strong> · night " +
      day +
      " of " +
      F.DAILY_STREAK_MAX +
      ' · <span class="reward-gold">+' +
      F.dailyGold(state.level, streak) +
      " gold</span> and full Mana" +
      (streak === 1 && state.daily.streak > 1 ? " · your streak started over" : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.setAttribute("data-key", "daily-claim");
    btn.textContent = "Claim";
    actionButton(btn, "daily");
    frag.appendChild(text);
    frag.appendChild(btn);
    patchChildren(el.dailyBar, frag);
  }

  // --- Factions and crossroads ---

  const FACTION_SWORN = 60;
  const FACTION_TIERS = [
    { min: FACTION_SWORN, name: "Sworn" },
    { min: 30, name: "Trusted" },
    { min: 10, name: "Known" },
    { min: 0, name: "Neutral" },
    { min: -29, name: "Wary" },
    { min: -FACTION_LIMIT, name: "Hostile" },
  ];

  function factionDef(id) {
    return FACTIONS.find(function (f) {
      return f.id === id;
    });
  }

  function crossroadsDef(id) {
    return CROSSROADS.find(function (c) {
      return c.id === id;
    });
  }

  function factionStanding(id) {
    return state.factions.standing[id] || 0;
  }

  function factionTier(standing) {
    return FACTION_TIERS.find(function (t) {
      return standing >= t.min;
    }).name;
  }

  /** Perks from every faction whose standing is high enough. */
  function factionBonuses() {
    const out = { goldMult: 0, xpMult: 0, regenMult: 0, attackPct: 0, defensePct: 0 };
    FACTIONS.forEach(function (f) {
      const st = factionStanding(f.id);
      f.perks.forEach(function (p) {
        if (st < p.at) return;
        Object.keys(p.effect).forEach(function (k) {
          out[k] += p.effect[k];
        });
      });
    });
    return out;
  }

  /** Called after each scheme: every CROSSROADS_EVERY schemes (from Level 5) a new choice appears. */
  function noteSchemeForCrossroads() {
    const fx = state.factions;
    fx.sinceLast += 1;
    if (fx.pending || state.level < CROSSROADS_MIN_LEVEL || fx.sinceLast < CROSSROADS_EVERY) return;
    const open = CROSSROADS.filter(function (c) {
      return state.level >= c.minLevel;
    });
    const fresh = open.filter(function (c) {
      return fx.recent.indexOf(c.id) < 0;
    });
    const pool = fresh.length ? fresh : open;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    fx.pending = pick.id;
    addLog("A crossroads: " + pick.title + ". Choose your side at the top of the Schemes tab.");
  }

  function crossroadsReward(opt) {
    if (opt.goldPerLevel) return { gold: opt.goldPerLevel * state.level, xp: 0 };
    return { gold: 0, xp: (opt.xpPerLevel || 0) * state.level };
  }

  function shiftStanding(id, delta) {
    const before = factionStanding(id);
    const after = Math.max(-FACTION_LIMIT, Math.min(FACTION_LIMIT, before + delta));
    state.factions.standing[id] = after;
    return { before: before, after: after };
  }

  function chooseCrossroads(idx) {
    const fx = state.factions;
    const cr = fx.pending ? crossroadsDef(fx.pending) : null;
    const opt = cr ? cr.options[Number(idx)] : null;
    if (!opt) return;
    const up = shiftStanding(opt.faction, FACTION_STEP);
    shiftStanding(opt.rival, -FACTION_STEP);
    const reward = crossroadsReward(opt);
    state.gold += reward.gold;
    state.xp += reward.xp;
    fx.pending = null;
    fx.sinceLast = 0;
    fx.choices += 1;
    fx.recent = fx.recent.concat(cr.id).slice(-CROSSROADS_RECENT);
    addLog(
      opt.outcome +
        " " +
        factionDef(opt.faction).name +
        " +" +
        FACTION_STEP +
        ", " +
        factionDef(opt.rival).name +
        " −" +
        FACTION_STEP +
        (reward.gold ? ", +" + reward.gold + " gold" : "") +
        (reward.xp ? ", +" + reward.xp + " XP" : "") +
        "."
    );
    // Announce a perk the moment it is earned
    factionDef(opt.faction).perks.forEach(function (p) {
      if (up.before < p.at && up.after >= p.at) {
        addLog(factionDef(opt.faction).name + " now count you " + factionTier(up.after) + ": " + p.text + ".");
        showToast(factionDef(opt.faction).name + ": " + factionTier(up.after), "achv-toast", 3000);
      }
    });
    tryLevelUp();
    save();
    render();
  }

  function standingText(st) {
    return (st > 0 ? "+" : st < 0 ? "−" : "") + Math.abs(st);
  }

  function renderCrossroads() {
    if (!el.crossroads) return;
    const cr = state.factions.pending ? crossroadsDef(state.factions.pending) : null;
    el.crossroads.hidden = !cr;
    if (!cr) return;
    const frag = document.createDocumentFragment();
    const head = document.createElement("div");
    head.setAttribute("data-key", "cr-head:" + cr.id);
    head.innerHTML =
      '<p class="crossroads-kicker">Crossroads</p><h3>' +
      escapeHtml(cr.title) +
      "</h3><p>" +
      escapeHtml(cr.text) +
      "</p>";
    frag.appendChild(head);
    cr.options.forEach(function (opt, i) {
      const row = document.createElement("div");
      row.className = "crossroads-option";
      row.setAttribute("data-key", "cr-opt:" + cr.id + ":" + i);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = opt.label;
      actionButton(btn, "crossroads", String(i));
      const reward = crossroadsReward(opt);
      const effect = document.createElement("span");
      effect.className = "crossroads-effect";
      effect.innerHTML =
        '<span class="standing-up">' +
        escapeHtml(factionDef(opt.faction).name) +
        " +" +
        FACTION_STEP +
        '</span> · <span class="standing-down">' +
        escapeHtml(factionDef(opt.rival).name) +
        " −" +
        FACTION_STEP +
        "</span> · " +
        (reward.gold
          ? '<span class="reward-gold">+' + reward.gold + " gold</span>"
          : '<span class="reward-xp">+' + reward.xp + " XP</span>");
      row.appendChild(btn);
      row.appendChild(effect);
      frag.appendChild(row);
    });
    patchChildren(el.crossroads, frag);
  }

  function renderFactions() {
    if (!el.factionList) return;
    const fx = state.factions;
    const left = Math.max(0, CROSSROADS_EVERY - fx.sinceLast);
    el.factionSummary.textContent =
      (fx.choices === 1 ? "1 choice made" : fx.choices + " choices made") +
      " · " +
      (state.level < CROSSROADS_MIN_LEVEL
        ? "crossroads begin at Level " + CROSSROADS_MIN_LEVEL
        : fx.pending
          ? "a crossroads waits in the Schemes tab"
          : "next crossroads in " + Math.max(1, left) + (Math.max(1, left) === 1 ? " scheme" : " schemes"));
    const frag = document.createDocumentFragment();
    FACTIONS.forEach(function (f) {
      const st = factionStanding(f.id);
      const tier = factionTier(st);
      const next = f.perks.find(function (p) {
        return st < p.at;
      });
      const card = document.createElement("article");
      card.className = "card faction-card faction-" + f.id;
      card.setAttribute("data-key", "faction:" + f.id);
      // The meter runs from -100 (left) to +100 (right), filled from the middle.
      const pct = Math.abs(st) / 2;
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(f.name) +
        '<span class="badge faction-tier tier-' +
        tier.toLowerCase() +
        '">' +
        tier +
        "</span></h3>" +
        '<p class="card-meta">' +
        escapeHtml(f.desc) +
        "</p>" +
        '<div class="standing-meter" aria-hidden="true"><span class="' +
        (st >= 0 ? "pos" : "neg") +
        '" style="width:' +
        pct +
        "%;" +
        (st >= 0 ? "left:50%" : "right:50%") +
        '"></span></div>' +
        '<p class="card-meta">Standing ' +
        standingText(st) +
        (next ? " · " + (next.at - st) + " to " + factionTier(next.at) : " · every perk earned") +
        "</p>" +
        '<ul class="faction-perks">' +
        f.perks
          .map(function (p) {
            const got = st >= p.at;
            return (
              '<li class="' +
              (got ? "got" : "") +
              '">' +
              (got ? "✓ " : "") +
              factionTier(p.at) +
              " (" +
              p.at +
              "): " +
              escapeHtml(p.text) +
              "</li>"
            );
          })
          .join("") +
        "</ul></div>";
      frag.appendChild(card);
    });
    patchChildren(el.factionList, frag);
  }

  // --- The story ---

  function chapterDone(id) {
    return !!state.story.done[id];
  }

  function chaptersDone() {
    return CHAPTERS.filter(function (ch) {
      return chapterDone(ch.id);
    }).length;
  }

  /** The chapter being played: the first one not finished (null once the tale is told). */
  function currentChapter() {
    return (
      CHAPTERS.find(function (ch) {
        return !chapterDone(ch.id);
      }) || null
    );
  }

  function chapterNumber(ch) {
    return CHAPTERS.indexOf(ch) + 1;
  }

  /** Finish every chapter whose goal is met, in order (a returning player may finish several). */
  function checkStory() {
    const finished = [];
    let ch = currentChapter();
    while (ch) {
      const p = achievementProgress({ check: ch.goal });
      if (p.cur < p.target) break;
      state.story.done[ch.id] = Date.now();
      state.gold += ch.gold;
      finished.push(ch);
      ch = currentChapter();
    }
    if (!finished.length) return finished;
    if (finished.length <= 2) {
      finished.forEach(function (f) {
        addLog("Chapter " + chapterNumber(f) + " complete: " + f.title + ". +" + f.gold + " gold.");
        showToast("Chapter complete: " + f.title, "story-toast", 3200);
      });
    } else {
      const gold = finished.reduce(function (sum, f) {
        return sum + f.gold;
      }, 0);
      addLog(
        "The tale catches up with you: chapters " +
          chapterNumber(finished[0]) +
          "–" +
          chapterNumber(finished[finished.length - 1]) +
          " are already behind you. +" +
          gold +
          " gold. Read them in the Chronicle."
      );
      showToast(finished.length + " chapters complete!", "story-toast", 3200);
    }
    const next = currentChapter();
    if (next) {
      addLog("Chapter " + chapterNumber(next) + " begins: " + next.title + ". Read it in the Chronicle.");
    } else {
      addLog("The tale is told. Read the ending in the Chronicle.");
    }
    return finished;
  }

  function readStory() {
    setTab("chronicle");
    if (el.tale) el.tale.scrollIntoView({ block: "start" });
  }

  /** The tab where each kind of chapter goal is worked on. */
  const STORY_GOAL_TABS = {
    questsDone: "quests",
    questCount: "quests",
    fightWins: "lists",
    upgrade: "armory",
    bossKill: "bosses",
    band: "band",
  };

  function renderStoryBar() {
    if (!el.storyBar) return;
    const ch = currentChapter();
    el.storyBar.hidden = !ch;
    if (!ch) return;
    const p = achievementProgress({ check: ch.goal });
    const frag = document.createDocumentFragment();
    const text = document.createElement("p");
    text.setAttribute("data-key", "story-text");
    text.innerHTML =
      '<span class="story-act">' +
      escapeHtml(ACT_NAMES[ch.act]) +
      " · Chapter " +
      chapterNumber(ch) +
      "</span> <strong>" +
      escapeHtml(ch.title) +
      "</strong> · " +
      escapeHtml(ch.goalText) +
      (p.target > 1 ? ' <span class="story-progress">' + p.cur + " / " + p.target + "</span>" : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    // Unread: offer the chapter. Read: take the player to where its goal is done.
    const goTab = state.story.seen === ch.id ? STORY_GOAL_TABS[ch.goal.type] : null;
    const goBtn = goTab && goTab !== currentTab ? el.tabBar.querySelector('[data-tab="' + goTab + '"]') : null;
    if (goBtn) {
      btn.setAttribute("data-key", "story-go:" + goTab);
      btn.textContent = "Go to " + goBtn.textContent.trim();
      actionButton(btn, "tab", goTab);
    } else {
      btn.setAttribute("data-key", "story-read");
      btn.textContent = state.story.seen === ch.id ? "Read" : "Read new chapter";
      actionButton(btn, "read-story");
    }
    frag.appendChild(text);
    frag.appendChild(btn);
    patchChildren(el.storyBar, frag);
  }

  function renderTale() {
    if (!el.taleList) return;
    const frag = document.createDocumentFragment();
    const current = currentChapter();
    let lastAct = null;
    CHAPTERS.forEach(function (ch) {
      const done = chapterDone(ch.id);
      if (!done && ch !== current) return;
      if (ch.act !== lastAct) {
        lastAct = ch.act;
        const head = document.createElement("h3");
        head.className = "tale-act";
        head.setAttribute("data-key", "act:" + ch.act);
        head.textContent = ACT_NAMES[ch.act];
        frag.appendChild(head);
      }
      const card = document.createElement("article");
      card.className = "tale-chapter" + (done ? " done" : " current");
      card.setAttribute("data-key", "chapter:" + ch.id);
      const p = achievementProgress({ check: ch.goal });
      card.innerHTML =
        "<h4>Chapter " +
        chapterNumber(ch) +
        " · " +
        escapeHtml(ch.title) +
        "</h4>" +
        "<p>" +
        escapeHtml(ch.text) +
        "</p>" +
        '<p class="tale-goal">' +
        (done ? "✓ " : "") +
        escapeHtml(ch.goalText) +
        (!done && p.target > 1 ? " (" + p.cur + " / " + p.target + ")" : "") +
        ' · <span class="reward-gold">' +
        (done ? "earned " : "+") +
        ch.gold +
        " gold</span></p>";
      frag.appendChild(card);
    });
    const tail = document.createElement("p");
    tail.className = current ? "tale-remaining" : "tale-epilogue";
    tail.setAttribute("data-key", "tale-tail");
    const left = CHAPTERS.length - chaptersDone() - (current ? 1 : 0);
    tail.textContent = current
      ? left > 0
        ? left + (left === 1 ? " chapter remains" : " chapters remain") + " untold."
        : "This is the last chapter."
      : EPILOGUE;
    frag.appendChild(tail);
    patchChildren(el.taleList, frag);
  }

  // --- Spellbook ---

  function spellCasts(id) {
    return state.spells.casts[id] || 0;
  }

  function spellRank(id) {
    return F.spellRank(spellCasts(id));
  }

  function getSpell(id) {
    return SPELLS.find(function (sp) {
      return sp.id === id;
    });
  }

  /** An active buff, or null once its time or charges have run out. */
  function activeSpell(id) {
    const a = state.spells.active[id];
    if (!a) return null;
    if (a.until && a.until <= Date.now()) return null;
    if (a.charges !== undefined && a.charges <= 0) return null;
    return a;
  }

  const EMPTY_SPELL_EFFECTS = {
    duelPower: 0,
    cooldownCut: 0,
    attackPct: 0,
    defensePct: 0,
    nemesisDamage: 0,
    goldMult: 0,
    xpMult: 0,
  };

  /** Sum of every active buff's effects, scaled by the potency it was cast with. */
  function spellEffects() {
    const out = Object.assign({}, EMPTY_SPELL_EFFECTS);
    SPELLS.forEach(function (sp) {
      const a = activeSpell(sp.id);
      if (!a) return;
      Object.keys(sp.effect).forEach(function (k) {
        if (k in out) out[k] += sp.effect[k] * a.potency;
      });
    });
    return out;
  }

  /** Spend one charge of every active buff with this effect (a Hex is used up by one duel). */
  function useSpellCharge(effectKey) {
    SPELLS.forEach(function (sp) {
      const a = activeSpell(sp.id);
      if (!a || a.charges === undefined || !sp.effect[effectKey]) return;
      a.charges -= 1;
      if (a.charges <= 0) {
        delete state.spells.active[sp.id];
        addLog(sp.name + " is spent.");
      }
    });
  }

  /** Drop buffs whose time has run out (charges are cleared as they are used). */
  function pruneSpells() {
    Object.keys(state.spells.active).forEach(function (id) {
      if (!activeSpell(id)) delete state.spells.active[id];
    });
  }

  function spellCooldownLeft(id) {
    return Math.max(0, (state.spells.cooldownUntil[id] || 0) - Date.now());
  }

  /** Player-facing effect of a spell at a potency, e.g. "+31% power in your next duel". */
  function spellEffectText(sp, potency) {
    const e = sp.effect;
    const pct = function (v) {
      return Math.round(v * potency * 100) + "%";
    };
    const parts = [];
    if (e.duelPower) parts.push("+" + pct(e.duelPower) + " power in your next " + (sp.charges > 1 ? sp.charges + " duels" : "duel"));
    if (e.cooldownCut) parts.push("schemes you start rest " + pct(e.cooldownCut) + " shorter");
    if (e.attackPct) parts.push("+" + pct(e.attackPct) + " attack");
    if (e.defensePct) parts.push("+" + pct(e.defensePct) + " defense");
    if (e.nemesisDamage) parts.push("+" + pct(e.nemesisDamage) + " damage on your next " + sp.charges + " nemesis strikes");
    if (e.goldMult) parts.push("+" + pct(e.goldMult) + " gold");
    if (e.xpMult) parts.push("+" + pct(e.xpMult) + " XP");
    if (e.healPct) parts.push("restore " + pct(e.healPct) + " of your Health");
    if (e.restoreWill) parts.push("restore " + Math.round(e.restoreWill * potency) + " Will");
    let text = parts.join(", ");
    if (sp.durationMs) text += " for " + formatSeconds(Math.round(sp.durationMs / 1000));
    return text.charAt(0).toUpperCase() + text.slice(1) + ".";
  }

  function castSpell(id) {
    const sp = getSpell(id);
    if (!sp) return;
    if (state.level < sp.minLevel) {
      addLog("You will learn " + sp.name + " at Level " + sp.minLevel + ".");
      render();
      return;
    }
    const cd = spellCooldownLeft(sp.id);
    if (cd > 0) {
      addLog(sp.name + " is gathering power — " + formatCooldown(cd) + " left.");
      render();
      return;
    }
    if (sp.kind === "buff" && activeSpell(sp.id)) {
      addLog(sp.name + " is already upon you.");
      render();
      return;
    }
    if (state.energy < sp.mana) {
      addLog("Not enough Mana to cast " + sp.name + " (" + sp.mana + " needed).");
      render();
      return;
    }
    const rankBefore = spellRank(sp.id);
    const potency = F.spellPotency(rankBefore);
    state.energy -= sp.mana;
    state.spells.cooldownUntil[sp.id] = Date.now() + sp.cooldownMs;
    state.spells.casts[sp.id] = spellCasts(sp.id) + 1;

    if (sp.kind === "instant") {
      if (sp.effect.healPct) {
        const heal = Math.max(1, Math.round(state.healthMax * sp.effect.healPct * potency));
        state.health = Math.min(state.healthMax, state.health + heal);
        clearFallenIfHealed();
      }
      if (sp.effect.restoreWill) {
        state.stamina = Math.min(state.staminaMax, state.stamina + Math.round(sp.effect.restoreWill * potency));
      }
    } else {
      const buff = { potency: potency };
      if (sp.durationMs) buff.until = Date.now() + sp.durationMs;
      if (sp.charges) buff.charges = sp.charges;
      state.spells.active[sp.id] = buff;
    }
    addLog("You cast " + sp.name + ": " + spellEffectText(sp, potency));
    const rankAfter = spellRank(sp.id);
    if (rankAfter > rankBefore) {
      addLog(
        "Your " +
          sp.name +
          " grows stronger: " +
          MASTERY_RANKS[rankAfter] +
          " (×" +
          F.spellPotency(rankAfter) +
          " potency)."
      );
    }
    save();
    render();
  }

  function renderSpells() {
    if (!el.spellList) return;
    const frag = document.createDocumentFragment();
    SPELLS.forEach(function (sp) {
      const locked = state.level < sp.minLevel;
      const rank = spellRank(sp.id);
      const casts = spellCasts(sp.id);
      const potency = F.spellPotency(rank);
      const cd = spellCooldownLeft(sp.id);
      const active = sp.kind === "buff" ? activeSpell(sp.id) : null;
      const nextAt = F.SPELL_RANK_CASTS[rank];
      const card = document.createElement("article");
      card.className =
        "card spell-card" + (locked ? " locked" : "") + (active ? " active-spell" : "") + (cd && !active ? " cooling" : "");
      card.setAttribute("data-key", "spell:" + sp.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(sp.name) +
        '<span class="badge mastery-badge">' +
        escapeHtml(rankLabel(rank, casts)) +
        "</span>" +
        (active ? '<span class="badge spell-on">Active</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(sp.desc) +
        "</p>" +
        '<p class="card-meta spell-effect">' +
        escapeHtml(spellEffectText(sp, potency)) +
        "</p>" +
        '<p class="card-meta">' +
        '<span class="cost">' +
        sp.mana +
        " Mana</span> · recast after " +
        formatSeconds(Math.round(sp.cooldownMs / 1000)) +
        (locked ? ' · <span class="gate">Learned at Level ' + sp.minLevel + "</span>" : "") +
        (cd && !active ? ' · <span class="gate">Ready in ' + formatCooldown(cd) + "</span>" : "") +
        "</p>" +
        (locked
          ? ""
          : '<p class="card-meta"><span class="mastery">' +
            casts +
            " casts" +
            (nextAt ? " · " + (nextAt - casts) + " to " + MASTERY_RANKS[rank + 1] : " · fully mastered") +
            "</span></p>") +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (locked) btn.textContent = "Locked";
      else if (active) btn.textContent = "Active";
      else if (cd) btn.textContent = "Wait " + formatCooldown(cd);
      else btn.textContent = "Cast";
      btn.disabled = locked || !!active || !!cd || state.energy < sp.mana;
      actionButton(btn, "cast", sp.id);
      card.appendChild(btn);
      frag.appendChild(card);
    });
    patchChildren(el.spellList, frag);
  }

  /** Chips under the tab bar for every spell currently working on you. */
  function renderActiveSpells() {
    if (!el.activeSpells) return;
    const frag = document.createDocumentFragment();
    SPELLS.forEach(function (sp) {
      const a = sp.kind === "buff" ? activeSpell(sp.id) : null;
      if (!a) return;
      const chip = document.createElement("span");
      chip.className = "spell-chip";
      chip.setAttribute("data-key", "chip:" + sp.id);
      const left = [];
      if (a.charges !== undefined) left.push(a.charges + (a.charges === 1 ? " use" : " uses"));
      if (a.until) left.push(formatCooldown(a.until - Date.now()));
      chip.textContent = sp.name + " · " + left.join(" · ");
      frag.appendChild(chip);
    });
    el.activeSpells.hidden = !frag.childNodes.length;
    patchChildren(el.activeSpells, frag);
  }

  // --- Seasonal events ---

  const EVENT_FOE_STAMINA = 10;
  const EVENT_MIN_LEVEL = 5;
  const EVENT_FOE_COOLDOWN_MS = 3 * 60 * 1000;
  const EVENT_FOE_STRENGTH = 1.05; // the champion matches your attack, a little above it (~45% odds)

  /** The running event with this year's progress, or null. */
  function currentEvent() {
    // New magicians aren't shown festivals: the champion is no fight for them, and the banner crowds the start.
    if (state.level < EVENT_MIN_LEVEL) return null;
    const hit = F.activeEvent(EVENTS, new Date());
    if (!hit) return null;
    if (!state.events[hit.key]) state.events[hit.key] = { tokens: 0, claimed: false, cooldownUntil: 0 };
    hit.progress = state.events[hit.key];
    return hit;
  }

  /** The event champion, scaled to the player so it's always a fair fight. */
  function eventFoe(ev) {
    const lv = state.level;
    return {
      id: "event:" + ev.event.id,
      name: ev.event.foeName,
      desc: ev.event.foeDesc,
      stamina: EVENT_FOE_STAMINA,
      power: Math.max(10, Math.round(attackRating() * EVENT_FOE_STRENGTH)),
      gold: 20 + lv * 15,
      xp: 20 + lv * 12,
      dmgMin: 8 + lv,
      dmgMax: 16 + lv * 2,
    };
  }

  function doEventFight() {
    const ev = currentEvent();
    if (!ev) {
      addLog("No festival is under way tonight.");
      render();
      return;
    }
    const foe = eventFoe(ev);
    const prog = ev.progress;
    if (state.fallen || state.health <= 0) {
      addLog("You have fallen. Visit the Apothecary before facing " + foe.name + ".");
      render();
      return;
    }
    if (state.stamina < foe.stamina) {
      addLog("Not enough Will to challenge " + foe.name + ".");
      render();
      return;
    }
    if (prog.cooldownUntil > Date.now()) {
      addLog(foe.name + " is resting — " + formatCooldown(prog.cooldownUntil - Date.now()) + " left.");
      render();
      return;
    }
    state.stamina -= foe.stamina;
    prog.cooldownUntil = Date.now() + EVENT_FOE_COOLDOWN_MS;
    const odds = F.fightWinChance(duelAttack(), foe.power);
    useSpellCharge("duelPower");
    if (Math.random() < odds) {
      const goldGain = Math.floor(foe.gold * goldMultiplier());
      const xpGain = Math.floor(foe.xp * xpMultiplier());
      state.gold += goldGain;
      state.xp += xpGain;
      prog.tokens += 1;
      state.stats.fightWins += 1;
      addLog(
        ev.event.name +
          ": you beat " +
          foe.name +
          " (" +
          Math.round(odds * 100) +
          "% odds) — +" +
          goldGain +
          " gold, +" +
          xpGain +
          " XP, +1 favor (" +
          prog.tokens +
          "/" +
          ev.event.tokenGoal +
          ")."
      );
    } else {
      const dmg = soakDamage(randInt(foe.dmgMin, foe.dmgMax));
      state.health = Math.max(0, state.health - dmg);
      addLog(ev.event.name + ": " + foe.name + " overpowers you. Took " + dmg + " damage.");
      if (state.health <= 0) {
        state.fallen = true;
        addLog("You have fallen at the festival. Visit the Apothecary.");
      }
    }
    tryLevelUp();
    save();
    render();
  }

  function claimEventReward() {
    const ev = currentEvent();
    if (!ev || ev.progress.claimed || ev.progress.tokens < ev.event.tokenGoal) return;
    const item = getLootDef(ev.event.rewardId);
    ev.progress.claimed = true;
    grantLoot(item);
    addLog(ev.event.name + ": your favors win the " + (item ? item.name : "prize") + ". The night howls.");
    save();
    render();
  }

  function renderEventBar() {
    const ev = currentEvent();
    el.eventBar.hidden = !ev;
    if (!ev) return;
    const prog = ev.progress;
    const goal = ev.event.tokenGoal;
    const reward = getLootDef(ev.event.rewardId);
    const ends = ev.endsAt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const frag = document.createDocumentFragment();
    const text = document.createElement("p");
    text.setAttribute("data-key", "event-text");
    text.innerHTML =
      "<strong>" +
      escapeHtml(ev.event.name) +
      "</strong> · until " +
      escapeHtml(ends) +
      " · " +
      (prog.claimed
        ? "you won the " + escapeHtml(reward ? reward.name : "prize") + " this year"
        : Math.min(prog.tokens, goal) +
          " / " +
          goal +
          " favors for the " +
          escapeHtml(reward ? reward.name : "prize") +
          (reward ? " (" + escapeHtml(reward.desc.replace(/ \(.*\)$/, "")) + ")" : "")) +
      '<span class="event-desc">' +
      escapeHtml(ev.event.desc) +
      " Beat " +
      escapeHtml(ev.event.foeName) +
      " in the Circle.</span>";
    frag.appendChild(text);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-key", "event-btn");
    if (!prog.claimed && prog.tokens >= goal) {
      btn.className = "btn btn-primary";
      btn.textContent = "Claim reward";
      actionButton(btn, "event-claim");
    } else {
      btn.className = "btn";
      btn.textContent = "To the Circle";
      actionButton(btn, "tab", "lists");
    }
    frag.appendChild(btn);
    patchChildren(el.eventBar, frag);
  }

  /** The event champion's card for The Lists (or nothing outside events). */
  function eventFoeCard(isFallen) {
    const ev = currentEvent();
    if (!ev) return null;
    const foe = eventFoe(ev);
    const cdLeft = Math.max(0, ev.progress.cooldownUntil - Date.now());
    const odds = F.fightWinChance(duelAttack(), foe.power);
    const wrap = document.createDocumentFragment();
    const head = document.createElement("h3");
    head.className = "list-region event-head";
    head.setAttribute("data-key", "foe-region:event");
    head.textContent = ev.event.name + " · festival";
    wrap.appendChild(head);
    const card = document.createElement("article");
    card.className = "card event-card" + (cdLeft ? " cooling" : "") + (isFallen ? " fallen" : "");
    card.setAttribute("data-key", "foe:" + foe.id);
    card.innerHTML =
      '<div class="card-body">' +
      "<h3>" +
      escapeHtml(foe.name) +
      "</h3>" +
      '<p class="card-meta">' +
      escapeHtml(foe.desc) +
      "</p>" +
      '<p class="card-meta">' +
      '<span class="cost-stamina">' +
      foe.stamina +
      " Will</span> · " +
      '<span class="reward-gold">+' +
      Math.floor(foe.gold * goldMultiplier()) +
      " gold</span> · " +
      '<span class="reward-xp">+' +
      Math.floor(foe.xp * xpMultiplier()) +
      " XP</span> · +1 favor · " +
      '<span class="cost-health">dmg ' +
      foe.dmgMin +
      "–" +
      foe.dmgMax +
      "</span>" +
      (cdLeft ? ' · <span class="gate">Cooldown ' + formatCooldown(cdLeft) + "</span>" : "") +
      "</p>" +
      '<p class="card-meta">' +
      Math.round(odds * 100) +
      "% win chance · the champion always matches your strength</p>" +
      "</div>";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = isFallen ? "Fallen" : cdLeft ? "Wait " + formatCooldown(cdLeft) : "Challenge";
    btn.disabled = isFallen || !!cdLeft || state.stamina < foe.stamina;
    actionButton(btn, "event-fight");
    card.appendChild(btn);
    wrap.appendChild(card);
    return wrap;
  }

  // --- How to play ---

  const GUIDE_SEEN_KEY = "expelled_guide_seen"; // per-browser, not part of the save

  function guideSeen() {
    return readPref(GUIDE_SEEN_KEY) === "1";
  }

  function toggleGuide() {
    el.guide.hidden = !el.guide.hidden;
    if (!el.guide.hidden) el.guide.scrollIntoView({ block: "nearest" });
  }

  function closeGuide() {
    el.guide.hidden = true;
    writePref(GUIDE_SEEN_KEY, "1");
  }

  function regenHintText(cur, max, intervalMs, accMs) {
    const left = msUntilFull(cur, max, intervalMs, accMs);
    if (left <= 0) return "Full";
    return "+1 / " + Math.round(intervalMs / 1000) + "s · full in " + formatCooldown(left);
  }

  function renderStatsOnly() {
    el.name.textContent = state.name;
    const title = renownTitle(renownRank());
    el.playerTitle.textContent = title ? title + " · Infamy " + renownRank() : "";
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
      el.healthRegenHint.textContent = "Fallen — Apothecary";
    } else {
      el.healthRegenHint.textContent = regenHintText(
        state.health,
        state.healthMax,
        HEALTH_REGEN_MS,
        state.healthAccMs
      );
    }

    if (el.band) {
      // Bound thralls against the level cap; lieutenants are counted on their own, as in the Thralls tab.
      el.band.textContent = String(bandState().recruits);
      el.bandCap.textContent = String(bandCap());
      const lieutenantsOpen = NAMED_KNIGHTS.some(function (k) {
        return state.level >= k.minLevel;
      });
      el.bandHint.textContent =
        (lieutenantsOpen || namedKnightsOwned().length
          ? "Lieutenants " + namedKnightsOwned().length + " / " + NAMED_KNIGHTS.length + " · "
          : "") +
        "Atk " +
        attackRating() +
        " · Def " +
        defenseRating();
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
        " Mana</span> · " +
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
          ? " · bonus " +
            [
              mb.goldAdd ? "+" + Math.round(mb.goldAdd * 100) + "% gold" : "",
              mb.xpAdd ? "+" + Math.round(mb.xpAdd * 100) + "% XP" : "",
            ]
              .filter(Boolean)
              .join(", ")
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
    const blade = bladeUpgrade();
    if (!state.ownedUpgrades[blade.id]) {
      const tip = document.createElement("div");
      tip.className = "tip";
      tip.setAttribute("data-key", "tip-blade");
      const text = document.createElement("p");
      text.textContent =
        "New to dueling? The " +
        blade.name +
        " (" +
        blade.cost +
        " gold in the Sanctum) adds +" +
        blade.effect.attackBonus +
        " attack and +" +
        Math.round(blade.effect.goldMult * 100) +
        "% gold. Buy it before your first duels.";
      const go = document.createElement("button");
      go.type = "button";
      go.className = "btn";
      go.textContent = "Open Sanctum";
      actionButton(go, "tab", "armory");
      tip.appendChild(text);
      tip.appendChild(go);
      frag.appendChild(tip);
    }
    const eventCard = eventFoeCard(isFallen);
    if (eventCard) frag.appendChild(eventCard);
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
        " Will</span> · " +
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
        Math.round(duelAttack()) +
        (spellEffects().duelPower ? ' <span class="mastery">(hexed)</span>' : "") +
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
        " Will / strike</span> · " +
        "~" +
        Math.floor(attackRating() * (1 + bonus)) +
        " dmg" +
        (bonus ? ' <span class="mastery">(+' + Math.round(bonus * 100) + "% lieutenants)</span>" : "") +
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
        " + a page of " +
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
      "<strong>Bound:</strong> " +
        band.recruits +
        " / " +
        cap +
        " · <strong>Lieutenants:</strong> " +
        namedKnightsOwned().length +
        " / " +
        NAMED_KNIGHTS.length +
        " · <strong>+" +
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
      '<div class="card-body"><h3>Enthrall a Servant</h3>' +
      '<p class="card-meta">Each thrall adds +' +
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
    hireBtn.textContent = atCap ? "At cap" : "Enthrall";
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
      '<div class="card-body"><h3>Raise the Dead</h3>' +
      '<p class="card-meta">A free thrall every ' +
      formatSeconds(RALLY_COOLDOWN_MS / 1000) +
      ". Counts toward the same cap.</p>" +
      '<p class="card-meta">' +
      (left > 0 ? '<span class="gate">Cooldown ' + formatCooldown(left) + "</span>" : "Ready") +
      "</p></div>";
    const rallyBtn = document.createElement("button");
    rallyBtn.type = "button";
    rallyBtn.className = "btn btn-primary";
    rallyBtn.id = "btn-rally";
    rallyBtn.textContent = atCap ? "At cap" : left > 0 ? "Wait " + formatCooldown(left) : "Raise";
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
        (owned ? '<span class="badge">Bound</span>' : "") +
        '<span class="badge slot-badge">lieutenant</span></h3>' +
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
        btn.textContent = "Bound";
        btn.disabled = true;
      } else {
        btn.textContent = locked ? "Locked" : "Summon";
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
        (redeemed ? '<span class="badge">Bound</span>' : "") +
        '<span class="badge slot-badge">' +
        escapeHtml(region ? region.name : set.region) +
        "</span></h3>" +
        '<p class="card-meta">' +
        have +
        "/" +
        set.pieces.length +
        ' pages · bonus: <span class="mastery">' +
        escapeHtml(set.bonusDesc) +
        "</span></p>" +
        '<ul class="piece-list">' +
        pieces +
        "</ul></div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (redeemed) {
        btn.textContent = "Bound";
        btn.disabled = true;
      } else {
        btn.textContent = complete ? "Bind" : "Incomplete";
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
    // Only the bonuses you actually have, talismans included
    const bonusParts = [
      eq.attack ? "+" + eq.attack + " atk" : "",
      eq.defense ? "+" + eq.defense + " def" : "",
      eq.goldMult ? "+" + Math.round(eq.goldMult * 100) + "% gold" : "",
      eq.xpMult ? "+" + Math.round(eq.xpMult * 100) + "% XP" : "",
    ].filter(Boolean);
    patchHtml(
      el.equipSummary,
      "<strong>Focus:</strong> " +
        escapeHtml(wName) +
        " · <strong>Vestments:</strong> " +
        escapeHtml(aName) +
        " · " +
        (bonusParts.length ? "bonuses " + bonusParts.join(", ") + " (incl. talismans)" : "no bonuses yet")
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
        escapeHtml(SLOT_LABELS[item.slot] || item.slot) +
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
        "Nothing hoarded yet. Schemes (~22% drop chance) and duel wins turn up foci, vestments and talismans; nemeses drop uniques.";
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

  /**
   * A saved secret as it reads today. Entries store the text from when they were unlocked; looking it
   * up again by quest / boss id means older saves read in the current theme.
   */
  function secretText(entry) {
    const bossId = String(entry.questId || "").indexOf("boss_") === 0 ? entry.questId.slice(5) : null;
    if (bossId && BOSS_LEGENDS[bossId]) {
      const boss = getBoss(bossId);
      return { rank: "Nemesis Fallen", name: boss ? boss.name : entry.questName, text: BOSS_LEGENDS[bossId] };
    }
    const beats = STORY_BEATS[entry.questId];
    const quest = getQuest(entry.questId);
    if (beats && beats[entry.threshold] && quest) {
      const rank = MASTERY_RANKS[MASTERY_THRESHOLDS.indexOf(entry.threshold) + 1] || entry.rank;
      return { rank: rank, name: quest.name, text: beats[entry.threshold] };
    }
    return { rank: entry.rank, name: entry.questName || entry.questId, text: entry.text };
  }

  function renderLegends() {
    if (!el.legendsList) return;
    const frag = document.createDocumentFragment();
    const list = (state.storyUnlocks || []).slice().reverse();
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "legend-empty";
      empty.textContent =
        "No secrets yet. Reach mastery ranks (5 / 15 / 40 completions) on any scheme, or defeat a nemesis.";
      frag.appendChild(empty);
      patchChildren(el.legendsList, frag);
      return;
    }
    list.forEach(function (entry) {
      const s = secretText(entry);
      const card = document.createElement("article");
      card.className = "legend-card";
      card.innerHTML =
        "<h4>" +
        escapeHtml(s.rank) +
        " — " +
        escapeHtml(s.name) +
        "</h4>" +
        "<p>" +
        escapeHtml(s.text) +
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
        "</strong> (Infamy " +
        rank +
        "): +" +
        Math.round(renownBonuses().goldMult * 100) +
        "% gold, +" +
        Math.round(renownBonuses().xpMult * 100) +
        "% XP on everything."
      : "You have no Infamy yet.";
    frag.appendChild(status);

    const offer = document.createElement("p");
    offer.className = "card-meta";
    offer.setAttribute("data-key", "offer");
    offer.innerHTML =
      "Rebirth makes you <strong>" +
      escapeHtml(renownTitle(next)) +
      "</strong> (Infamy " +
      next +
      ": +" +
      Math.round(next * RENOWN_GOLD_PER_RANK * 100) +
      "% gold, +" +
      Math.round(next * RENOWN_XP_PER_RANK * 100) +
      "% XP). You keep your name, Infamy, Secrets and achievements; everything else starts over at Level 1." +
      (ready ? "" : ' <span class="gate">Requires Level ' + RENOWN_MIN_LEVEL + ".</span>");
    frag.appendChild(offer);

    const row = document.createElement("div");
    row.className = "dialog-row";
    row.setAttribute("data-key", renownConfirmOpen ? "confirm-row" : "open-row");
    if (renownConfirmOpen && ready) {
      const warn = document.createElement("p");
      warn.className = "renown-warn";
      warn.textContent =
        "This resets your level, gold, hoard, thralls, lairs, studies and grimoires. It can't be undone.";
      row.appendChild(warn);
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "btn btn-danger";
      yes.textContent = "Be reborn at Level 1";
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
      open.textContent = "Be reborn";
      open.disabled = !ready;
      actionButton(open, "renown-open");
      row.appendChild(open);
    }
    frag.appendChild(row);
    patchChildren(el.renownBox, frag);
  }

  function renderAchievements() {
    const total = ACHIEVEMENTS.length;
    const done = ACHIEVEMENTS.filter(function (a) {
      return achievementEarned(a.id);
    }).length;
    el.achvSummary.textContent = done + " of " + total + " earned";
    const frag = document.createDocumentFragment();
    ACHIEVEMENTS.forEach(function (a) {
      const earned = achievementEarned(a.id);
      const p = achievementProgress(a);
      const card = document.createElement("article");
      card.className = "achv" + (earned ? " earned" : "");
      card.setAttribute("data-key", "achv:" + a.id);
      card.innerHTML =
        "<h4>" +
        escapeHtml(a.name) +
        "</h4>" +
        "<p>" +
        escapeHtml(a.desc) +
        "</p>" +
        '<p class="achv-meta">' +
        (earned
          ? '<span class="achv-done">Earned</span>'
          : p.target > 1
            ? '<span class="achv-bar" aria-hidden="true"><span style="width:' +
              Math.round((p.cur / p.target) * 100) +
              '%"></span></span>' +
              p.cur +
              " / " +
              p.target
            : "Not yet") +
        (a.gold ? ' · <span class="reward-gold">+' + a.gold + "g</span>" : "") +
        "</p>";
      frag.appendChild(card);
    });
    patchChildren(el.achvList, frag);
  }

  /** Everything that can change without a player action (timers, regen, accrual). */
  /** Panels on each tab. Hidden tabs aren't rendered; setTab() renders a tab when it's shown. */
  const TAB_RENDERERS = {
    quests: [renderCrossroads, renderRegions, renderQuests],
    spells: [renderSpells],
    lists: [renderFights, renderHeals],
    bosses: [renderBosses],
    band: [renderBand],
    factions: [renderFactions],
    holdings: [renderHoldings],
    gear: [renderInventory, renderCollections],
    armory: [renderShop],
    chronicle: [renderTale, renderRenown, renderAchievements, renderLog, renderLegends],
  };

  function renderTabPanels() {
    (TAB_RENDERERS[currentTab] || []).forEach(function (fn) {
      fn();
    });
  }

  /** Every tick: the always-visible parts plus the open tab. */
  function renderLive() {
    renderStatsOnly();
    renderDaily();
    renderEventBar();
    renderStoryBar();
    renderActiveSpells();
    renderTabAlerts();
    renderTabPanels();
  }

  /** After an action: everything renderLive() does, plus the ticker. */
  function render() {
    renderLive();
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
  el.btnMusic.addEventListener("click", toggleMusic);
  el.btnGuide.addEventListener("click", toggleGuide);
  el.guideClose.addEventListener("click", closeGuide);
  el.backupCopy.addEventListener("click", copyBackup);
  el.backupLoad.addEventListener("click", loadBackup);
  el.backupClose.addEventListener("click", closeHeaderDialogs);
  el.tabBar.addEventListener("click", onTabClick);
  el.tabBar.addEventListener("scroll", updateTabBarEdges, { passive: true });
  window.addEventListener("resize", updateTabBarEdges);
  el.tabBar.addEventListener("keydown", onTabKey);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeHeaderDialogs();
  });
  document.addEventListener("click", onActionClick);
  // Tick saves are throttled, so flush whenever the page may go away.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      save();
      stopMusic();
    } else if (musicOn) {
      startMusic();
    }
  });
  // Browsers only start audio inside a user gesture (a click or key press, not a touch's pointerdown).
  // Resume on every gesture until it's running, so music saved as "on" starts at the first tap.
  function unlockAudio() {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (musicOn && !musicTimer) startMusic();
  }
  document.addEventListener("click", unlockAudio, true);
  document.addEventListener("keydown", unlockAudio, true);
  window.addEventListener("pagehide", save);
  window.addEventListener("beforeunload", save);

  load();
  if (logLines.length === 0) {
    addLog(
      "Cast out of the White College with nothing but a stolen wand, you set up shop in the gutters of Hollowmere. Schemes, duels, nemeses, thralls and lairs await. Ruin is only the beginning."
    );
  }
  setTab(initialTab());
  soundOn = readPref(SOUND_PREF_KEY) === "on";
  renderSoundToggle();
  musicOn = readPref(MUSIC_PREF_KEY) === "on";
  renderMusicToggle();
  checkStory(); // credits chapters already behind a returning player
  checkAchievements(); // credits deeds done before achievements existed
  if (!guideSeen() && state.level <= 3) el.guide.hidden = false;
  render();
  setInterval(tick, TICK_MS);

  // Installed / offline play on the hosted site (ignored where service workers aren't allowed).
  const secure = location.protocol === "https:" || location.hostname === "localhost";
  if ("serviceWorker" in navigator && secure) {
    try {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    } catch (e) {
      // not available here
    }
  }

  window.Expelled = {
    getState: function () {
      return Object.assign({}, state);
    },
    getLog: function () {
      return logLines.slice();
    },
    showToast: showToast,
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
    ACHIEVEMENTS: ACHIEVEMENTS,
    SPELLS: SPELLS,
    CHAPTERS: CHAPTERS,
    NAMED_KNIGHTS: NAMED_KNIGHTS,
    SAVE_VERSION: SAVE_VERSION,
    attackRating: attackRating,
    fightWinChance: fightWinChance,
    defenseRating: defenseRating,
    bandCap: bandCap,
    hireCost: hireCost,
  };
})();
