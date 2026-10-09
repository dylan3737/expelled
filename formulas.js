/**
 * Expelled — pure formulas (no DOM, no game state).
 * Loaded in the browser as window.ExpelledFormulas, and in Node via require() for tests.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ExpelledFormulas = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FIGHT_ODDS_EXPONENT = 4; // win chance = atk^k / (atk^k + foe^k): 50% at even, ~67% at +20%
  const FIGHT_ODDS_MIN = 0.05;
  const FIGHT_ODDS_MAX = 0.95;
  const UPSET_BONUS = 2; // reward × (1 + UPSET_BONUS × (0.5 − odds)) when winning with odds below 50%
  const DEFENSE_SOAK = 150; // damage taken × (1 - def / (def + DEFENSE_SOAK))
  const BAND_CAP_BASE = 2; // hired cap = BASE + level (max BAND_CAP_MAX)
  const BAND_CAP_MAX = 60;
  const BAND_HIRE_BASE = 30; // gold for the first hire; +BAND_HIRE_STEP per recruit already in the band
  const BAND_HIRE_STEP = 20;
  const BACKUP_PREFIX = "EX1.";
  const LEGACY_BACKUP_PREFIXES = ["RW1."]; // codes saved while the game was called Ruin Wars
  const DAILY_STREAK_MAX = 7; // the daily tribute grows for 7 days in a row, then stays at that size

  /**
   * XP needed to go from `level` to level+1: quick first levels, then steep (≈ level^2.5), so a
   * level takes several bars of Energy even though each level-up refills Energy.
   */
  function xpForLevel(level) {
    return Math.floor(40 + 8 * Math.pow(level, 2.5));
  }

  /**
   * Quest cooldown: mild on early jobs, long on big ones (A+B pacing).
   * Energy/Stamina regen is also slow — MW-style resource wait + job rests.
   */
  function questCooldownMs(quest) {
    if (quest.cooldownMs) return quest.cooldownMs; // explicit rests on Avalon / Wastes jobs
    const e = quest.energy;
    if (e <= 5) {
      return 6000 + e * 2000; // ~12–16s early jobs
    }
    if (e <= 10) {
      return 45000 + (e - 5) * 8000; // ~45–85s mid
    }
    return 120000 + (e - 10) * 18000; // ~2–3.5 min late jobs
  }

  function formatCooldown(ms) {
    const s = Math.ceil(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + "m " + r + "s";
  }

  /** Damage left after defense: never below 1. */
  function soakDamage(dmg, defense) {
    return Math.max(1, Math.round(dmg * (1 - defense / (defense + DEFENSE_SOAK))));
  }

  /** Chance to win a bout in The Lists: 50% at even power, rising / falling steeply with the ratio. */
  function fightWinChance(attack, foePower) {
    const a = Math.pow(Math.max(1, attack), FIGHT_ODDS_EXPONENT);
    const f = Math.pow(foePower, FIGHT_ODDS_EXPONENT);
    return Math.min(FIGHT_ODDS_MAX, Math.max(FIGHT_ODDS_MIN, a / (a + f)));
  }

  /** Reward multiplier for winning as the underdog (1 when odds were 50% or better). */
  function upsetMultiplier(odds) {
    return 1 + UPSET_BONUS * Math.max(0, 0.5 - odds);
  }

  /** Gold for the next rank of a ranked upgrade (null when maxed). */
  function rankedUpgradeCost(def, rank) {
    if (rank >= def.maxRank) return null;
    return Math.round((def.baseCost * Math.pow(def.growth, rank)) / 5) * 5;
  }

  /** How many sworn knights a knight of this level can lead. */
  function bandCap(level) {
    return Math.min(BAND_CAP_MAX, BAND_CAP_BASE + level);
  }

  function hireCost(recruits) {
    return BAND_HIRE_BASE + recruits * BAND_HIRE_STEP;
  }

  /** Milliseconds until a regenerating resource is full (0 when full). */
  function msUntilFull(cur, max, intervalMs, accMs) {
    if (cur >= max) return 0;
    return Math.max(0, (max - cur) * intervalMs - (accMs || 0));
  }

  /** A save object as a one-line backup code: EX1. + base64 of the UTF-8 JSON. */
  function encodeBackup(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return BACKUP_PREFIX + btoa(bin);
  }

  /**
   * Accepts a backup code (EX1.… or the older RW1.…) or raw save JSON. Returns the save object, or null if it isn't one.
   * Throws on text that isn't valid base64 / JSON.
   */
  function decodeBackup(text) {
    const trimmed = String(text || "").trim();
    let json = trimmed;
    const prefix = [BACKUP_PREFIX].concat(LEGACY_BACKUP_PREFIXES).find(function (p) {
      return trimmed.indexOf(p) === 0;
    });
    if (prefix) {
      const bin = atob(trimmed.slice(prefix.length).replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      json = new TextDecoder().decode(bytes);
    }
    const data = JSON.parse(json);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (typeof data.level !== "number" || typeof data.gold !== "number") return null;
    return data;
  }

  /** Local calendar day as "YYYY-MM-DD" (the daily tribute resets at the player's midnight). */
  function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  /** Whole calendar days from day key a to day key b (b later → positive). */
  function daysBetween(a, b) {
    const pa = a.split("-").map(Number);
    const pb = b.split("-").map(Number);
    const ua = Date.UTC(pa[0], pa[1] - 1, pa[2]);
    const ub = Date.UTC(pb[0], pb[1] - 1, pb[2]);
    return Math.round((ub - ua) / 86400000);
  }

  /**
   * Streak the player would be on if they claimed today: +1 after claiming yesterday,
   * back to 1 after a missed day (or on the first claim). Null when already claimed today.
   */
  function dailyStreakIfClaimed(lastDay, today, streak) {
    if (!lastDay) return 1;
    const gap = daysBetween(lastDay, today);
    if (gap <= 0) return null;
    if (gap === 1) return (streak || 0) + 1;
    return 1;
  }

  /** Gold for the daily tribute: grows with level and with the streak (capped at 7 days). */
  function dailyGold(level, streak) {
    const day = Math.min(DAILY_STREAK_MAX, Math.max(1, streak));
    return (50 + level * 25) * day;
  }

  /**
   * The event running on `date` (local time), or null. Returns { event, key, endsAt } where key is
   * "<id>-<year the event started>" and endsAt is the last moment of its final day.
   */
  function activeEvent(events, date) {
    const md = String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const wraps = e.start > e.end; // e.g. 12-20 → 01-06
      const inside = wraps ? md >= e.start || md <= e.end : md >= e.start && md <= e.end;
      if (!inside) continue;
      const startYear = wraps && md <= e.end ? year - 1 : year;
      const endYear = wraps ? startYear + 1 : startYear;
      const [em, ed] = e.end.split("-").map(Number);
      return { event: e, key: e.id + "-" + startYear, endsAt: new Date(endYear, em - 1, ed, 23, 59, 59) };
    }
    return null;
  }

  const SPELL_RANK_CASTS = [10, 30, 100]; // casts needed for Practiced / Adept / Master

  /** Spell mastery rank (0 = Untried … 3 = Master) after this many casts. */
  function spellRank(casts) {
    let rank = 0;
    for (let i = 0; i < SPELL_RANK_CASTS.length; i++) if (casts >= SPELL_RANK_CASTS[i]) rank = i + 1;
    return rank;
  }

  /** Multiplier on a spell's effect at a mastery rank: ×1, ×1.25, ×1.5, ×1.75. */
  function spellPotency(rank) {
    return 1 + 0.25 * rank;
  }

  return {
    DAILY_STREAK_MAX: DAILY_STREAK_MAX,
    SPELL_RANK_CASTS: SPELL_RANK_CASTS,
    spellRank: spellRank,
    spellPotency: spellPotency,
    activeEvent: activeEvent,
    dayKey: dayKey,
    daysBetween: daysBetween,
    dailyStreakIfClaimed: dailyStreakIfClaimed,
    dailyGold: dailyGold,
    FIGHT_ODDS_MIN: FIGHT_ODDS_MIN,
    FIGHT_ODDS_MAX: FIGHT_ODDS_MAX,
    BACKUP_PREFIX: BACKUP_PREFIX,
    LEGACY_BACKUP_PREFIXES: LEGACY_BACKUP_PREFIXES,
    xpForLevel: xpForLevel,
    questCooldownMs: questCooldownMs,
    formatCooldown: formatCooldown,
    soakDamage: soakDamage,
    fightWinChance: fightWinChance,
    upsetMultiplier: upsetMultiplier,
    rankedUpgradeCost: rankedUpgradeCost,
    bandCap: bandCap,
    hireCost: hireCost,
    msUntilFull: msUntilFull,
    encodeBackup: encodeBackup,
    decodeBackup: decodeBackup,
  };
});
