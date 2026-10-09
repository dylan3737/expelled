"use strict";

// Sanity checks on content.js, so balance edits can't silently break references or make
// content unreachable.

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../content.js");
const F = require("../formulas.js");

const MASTERY_THRESHOLDS = [5, 15, 40];
const regionIds = C.REGIONS.map((r) => r.id);

function assertUniqueIds(list, label) {
  const seen = new Set();
  list.forEach((x) => {
    assert.ok(x.id, label + " entry without id");
    assert.ok(!seen.has(x.id), label + ": duplicate id " + x.id);
    seen.add(x.id);
  });
}

test("ids are unique within every table", () => {
  for (const key of ["REGIONS", "QUESTS", "FOES", "HEALS", "UPGRADES", "RANKED_UPGRADES", "HOLDINGS", "LOOT", "COLLECTIONS", "BOSSES", "NAMED_KNIGHTS", "ACHIEVEMENTS", "EVENTS", "SPELLS", "CHAPTERS"]) {
    assertUniqueIds(C[key], key);
  }
  assertUniqueIds(C.COLLECTIONS.flatMap((c) => c.pieces), "collection pieces");
});

test("every quest is in a known region and not open before its region", () => {
  C.QUESTS.forEach((q) => {
    const region = C.REGIONS.find((r) => r.id === q.region);
    assert.ok(region, q.id + ": unknown region " + q.region);
    assert.ok(q.minLevel >= region.minLevel, q.id + " opens before " + region.id);
    assert.ok(q.energy > 0 && q.gold > 0 && q.xp > 0, q.id + ": costs and rewards must be positive");
  });
});

test("every quest has a story beat at each mastery threshold", () => {
  C.QUESTS.forEach((q) => {
    const beats = C.STORY_BEATS[q.id];
    assert.ok(beats, q.id + ": no story beats");
    MASTERY_THRESHOLDS.forEach((t) => assert.ok(beats[t], q.id + ": no beat at " + t));
  });
});

test("quest requirements are reachable at the quest's level", () => {
  C.QUESTS.forEach((q) => {
    const r = q.requires;
    if (!r || !r.band) return;
    const named = C.NAMED_KNIGHTS.filter((k) => k.minLevel <= q.minLevel).length;
    const most = F.bandCap(q.minLevel) + named;
    assert.ok(r.band <= most, q.id + " needs " + r.band + " knights; at Lv " + q.minLevel + " you can lead " + most);
  });
});

test("foes come from known regions (or default to Camelot)", () => {
  C.FOES.forEach((f) => {
    if (f.region) assert.ok(regionIds.includes(f.region), f.id + ": unknown region " + f.region);
    assert.ok(f.dmgMin <= f.dmgMax, f.id + ": dmgMin > dmgMax");
  });
});

test("foes get harder and pay more as their level rises", () => {
  const sorted = C.FOES.slice().sort((a, b) => a.minLevel - b.minLevel || a.power - b.power);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    assert.ok(b.power > a.power, b.id + " should be stronger than " + a.id);
    assert.ok(b.gold > a.gold && b.xp > a.xp, b.id + " should pay more than " + a.id);
  }
});

test("Avalon and the Wastes each have at least 3 foes in The Lists", () => {
  ["avalon", "wastes"].forEach((region) => {
    assert.ok(C.FOES.filter((f) => f.region === region).length >= 3, region);
  });
});

test("each region drops 3 weapons, 3 armors and 3 relics", () => {
  regionIds.forEach((region) => {
    const pool = C.LOOT.filter((L) => L.region === region && L.weight > 0);
    for (const slot of ["weapon", "armor", "relic"]) {
      assert.equal(pool.filter((L) => L.slot === slot).length, 3, region + " " + slot + "s");
    }
  });
});

test("loot: random drops have a region and weight, uniques never roll, all can be sold", () => {
  C.LOOT.forEach((L) => {
    assert.ok(["weapon", "armor", "relic"].includes(L.slot), L.id + ": bad slot");
    assert.ok(L.value > 0, L.id + ": needs a sell value");
    if (L.unique) {
      assert.equal(L.weight, 0, L.id + ": uniques must not roll randomly");
    } else {
      assert.ok(L.weight > 0, L.id + ": needs a drop weight");
      assert.ok(regionIds.includes(L.region), L.id + ": unknown region");
    }
  });
});

test("bosses drop a real unique and a real collection piece, and have a legend", () => {
  C.BOSSES.forEach((b) => {
    const loot = C.LOOT.find((L) => L.id === b.lootId);
    assert.ok(loot && loot.unique, b.id + ": lootId must be a unique item");
    assert.ok(C.COLLECTIONS.some((c) => c.id === b.collectionId), b.id + ": unknown collection");
    assert.ok(C.BOSS_LEGENDS[b.id], b.id + ": no legend");
    assert.ok(b.dmgMin <= b.dmgMax, b.id + ": dmgMin > dmgMax");
  });
});

test("collections: one per region, five pieces each", () => {
  regionIds.forEach((region) => {
    const sets = C.COLLECTIONS.filter((c) => c.region === region);
    assert.equal(sets.length, 1, region);
    assert.equal(sets[0].pieces.length, 5, sets[0].id);
  });
});

test("named knights' boss bonuses point at real bosses", () => {
  C.NAMED_KNIGHTS.forEach((k) => {
    Object.keys(k.bossDmg || {}).forEach((id) => {
      assert.ok(C.BOSSES.some((b) => b.id === id), k.id + ": unknown boss " + id);
    });
  });
});

test("holdings belong to known regions", () => {
  C.HOLDINGS.forEach((h) => {
    if (h.region) assert.ok(regionIds.includes(h.region), h.id + ": unknown region " + h.region);
  });
});

test("achievements use known checks with sensible targets", () => {
  const types = ["questsDone", "questsMastered", "level", "fightWins", "upsets", "bossKill", "band", "namedKnights", "holdings", "collections", "trainingRanks", "renown", "dailyStreak", "eventRewards", "spellCasts", "spellsMastered", "chapters"];
  const allowAll = ["questsMastered", "namedKnights", "holdings", "collections", "chapters"];
  C.ACHIEVEMENTS.forEach((a) => {
    assert.ok(a.name && a.desc, a.id + ": needs a name and description");
    assert.ok(types.includes(a.check.type), a.id + ": unknown check " + a.check.type);
    assert.ok(a.gold >= 0, a.id + ": gold reward");
    const t = a.check.target;
    if (a.check.type === "bossKill") {
      assert.ok(C.BOSSES.some((b) => b.id === t), a.id + ": unknown boss " + t);
    } else if (t === "all") {
      assert.ok(allowAll.includes(a.check.type), a.id + ": 'all' isn't valid for " + a.check.type);
    } else {
      assert.ok(Number.isInteger(t) && t > 0, a.id + ": target must be a positive whole number");
    }
  });
});

test("count-based achievement targets are reachable", () => {
  const maxLevelQuestMastery = C.QUESTS.length;
  C.ACHIEVEMENTS.forEach((a) => {
    const t = a.check.target;
    if (a.check.type === "questsMastered" && t !== "all") assert.ok(t <= maxLevelQuestMastery, a.id);
    if (a.check.type === "collections" && t !== "all") assert.ok(t <= C.COLLECTIONS.length, a.id);
    if (a.check.type === "band") assert.ok(t <= F.bandCap(1000) + C.NAMED_KNIGHTS.length, a.id);
  });
});

test("events: valid dates, a real unique reward, and no two at once", () => {
  const md = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  const days = new Map();
  C.EVENTS.forEach((e) => {
    assert.ok(md.test(e.start) && md.test(e.end), e.id + ": dates must be MM-DD");
    const reward = C.LOOT.find((L) => L.id === e.rewardId);
    assert.ok(reward && reward.unique && reward.weight === 0, e.id + ": rewardId must be a unique item");
    assert.ok(e.tokenGoal > 0 && e.foeName, e.id + ": needs a champion and a token goal");
    // Walk a non-leap year day by day and check no day belongs to two events.
    for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d.setDate(d.getDate() + 1)) {
      const hit = F.activeEvent([e], d);
      if (!hit) continue;
      const k = d.getMonth() + "/" + d.getDate();
      assert.ok(!days.has(k), e.id + " overlaps " + days.get(k) + " on " + k);
      days.set(k, e.id);
    }
  });
});

test("spells: known effects, a way to end every buff, sensible costs", () => {
  const buffEffects = ["duelPower", "cooldownCut", "attackPct", "defensePct", "nemesisDamage", "goldMult", "xpMult"];
  const instantEffects = ["healPct", "restoreWill"];
  C.SPELLS.forEach((sp) => {
    assert.ok(sp.name && sp.desc, sp.id + ": needs a name and description");
    assert.ok(sp.minLevel >= 1 && sp.mana > 0 && sp.cooldownMs > 0, sp.id + ": level, Mana and cooldown");
    assert.ok(["buff", "instant"].includes(sp.kind), sp.id + ": kind must be buff or instant");
    const keys = Object.keys(sp.effect);
    assert.ok(keys.length > 0, sp.id + ": needs an effect");
    const allowed = sp.kind === "buff" ? buffEffects : instantEffects;
    keys.forEach((k) => assert.ok(allowed.includes(k), sp.id + ": " + k + " isn't a " + sp.kind + " effect"));
    if (sp.kind === "buff") assert.ok(sp.durationMs > 0 || sp.charges > 0, sp.id + ": a buff needs a duration or charges");
    // At Master potency (×1.75) a cooldown cut must still leave some cooldown.
    if (sp.effect.cooldownCut) assert.ok(sp.effect.cooldownCut * F.spellPotency(3) < 1, sp.id);
  });
});

test("story chapters: real goals, in five acts, and each one reachable after the one before", () => {
  const goalTypes = ["questsDone", "questCount", "fightWins", "level", "bossKill", "band"];
  // The lowest level at which a chapter's goal can be met (null when no level gates it).
  const unlockLevel = (g) => {
    if (g.type === "level") return g.target;
    if (g.type === "questCount") return C.QUESTS.find((q) => q.id === g.quest).minLevel;
    if (g.type === "bossKill") return C.BOSSES.find((b) => b.id === g.target).minLevel;
    return null;
  };
  let prevLevel = 1;
  C.CHAPTERS.forEach((ch) => {
    assert.ok(ch.title && ch.text && ch.goalText, ch.id + ": needs a title, text and goal text");
    assert.ok(C.ACT_NAMES[ch.act], ch.id + ": unknown act " + ch.act);
    assert.ok(ch.gold > 0, ch.id + ": reward");
    const g = ch.goal;
    assert.ok(goalTypes.includes(g.type), ch.id + ": unknown goal " + g.type);
    if (g.type === "questCount") assert.ok(C.QUESTS.some((q) => q.id === g.quest), ch.id + ": unknown scheme " + g.quest);
    if (g.type === "bossKill") assert.ok(C.BOSSES.some((b) => b.id === g.target), ch.id + ": unknown nemesis " + g.target);
    if (g.type !== "bossKill") assert.ok(Number.isInteger(g.target) && g.target > 0, ch.id + ": target");
    const lv = unlockLevel(g);
    if (lv === null) return;
    assert.ok(lv >= prevLevel, ch.id + " (Lv " + lv + ") comes after a chapter needing Lv " + prevLevel);
    prevLevel = lv;
  });
  assert.deepEqual([...new Set(C.CHAPTERS.map((c) => c.act))], ["I", "II", "III", "IV", "V"]);
  assert.ok(C.EPILOGUE.length > 0);
});
