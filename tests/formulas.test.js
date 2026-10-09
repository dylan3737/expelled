"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../formulas.js");

test("xpForLevel grows with every level", () => {
  assert.equal(F.xpForLevel(1), 48);
  assert.equal(F.xpForLevel(10), 2569);
  for (let lv = 1; lv < 80; lv++) {
    assert.ok(F.xpForLevel(lv + 1) > F.xpForLevel(lv), "level " + lv);
  }
});

test("questCooldownMs: explicit rests win, otherwise tiers by energy", () => {
  assert.equal(F.questCooldownMs({ energy: 20, cooldownMs: 150000 }), 150000);
  assert.equal(F.questCooldownMs({ energy: 3 }), 12000);
  assert.equal(F.questCooldownMs({ energy: 5 }), 16000);
  assert.equal(F.questCooldownMs({ energy: 7 }), 61000);
  assert.equal(F.questCooldownMs({ energy: 15 }), 210000);
});

test("formatCooldown", () => {
  assert.equal(F.formatCooldown(0), "0s");
  assert.equal(F.formatCooldown(59001), "1m 0s");
  assert.equal(F.formatCooldown(125000), "2m 5s");
});

test("fightWinChance is 50% at even power and moves with the ratio", () => {
  assert.equal(F.fightWinChance(100, 100), 0.5);
  assert.ok(Math.abs(F.fightWinChance(120, 100) - 0.6747) < 0.001);
  assert.ok(Math.abs(F.fightWinChance(80, 100) - 0.2906) < 0.001);
  let prev = 0;
  for (let atk = 10; atk <= 400; atk += 10) {
    const p = F.fightWinChance(atk, 150);
    assert.ok(p >= prev, "monotonic at " + atk);
    prev = p;
  }
});

test("fightWinChance is clamped and safe at zero attack", () => {
  assert.equal(F.fightWinChance(1, 1000), F.FIGHT_ODDS_MIN);
  assert.equal(F.fightWinChance(0, 18), F.FIGHT_ODDS_MIN);
  assert.equal(F.fightWinChance(1000, 1), F.FIGHT_ODDS_MAX);
});

test("upsetMultiplier only rewards underdog wins", () => {
  assert.equal(F.upsetMultiplier(0.5), 1);
  assert.equal(F.upsetMultiplier(0.9), 1);
  assert.ok(Math.abs(F.upsetMultiplier(0.05) - 1.9) < 1e-9);
  assert.ok(Math.abs(F.upsetMultiplier(0.25) - 1.5) < 1e-9);
});

test("soakDamage reduces damage but never below 1", () => {
  assert.equal(F.soakDamage(30, 0), 30);
  assert.equal(F.soakDamage(30, 150), 15);
  assert.equal(F.soakDamage(1, 10000), 1);
  assert.ok(F.soakDamage(40, 300) < F.soakDamage(40, 100));
});

test("rankedUpgradeCost: base at rank 0, rounded to 5, null when maxed", () => {
  const def = { baseCost: 150, growth: 1.35, maxRank: 20 };
  assert.equal(F.rankedUpgradeCost(def, 0), 150);
  assert.equal(F.rankedUpgradeCost(def, 1), 205);
  for (let r = 0; r < def.maxRank; r++) {
    const c = F.rankedUpgradeCost(def, r);
    assert.equal(c % 5, 0);
    if (r > 0) assert.ok(c > F.rankedUpgradeCost(def, r - 1));
  }
  assert.equal(F.rankedUpgradeCost(def, 20), null);
});

test("bandCap and hireCost", () => {
  assert.equal(F.bandCap(1), 3);
  assert.equal(F.bandCap(30), 32);
  assert.equal(F.bandCap(500), 60);
  assert.equal(F.hireCost(0), 30);
  assert.equal(F.hireCost(10), 230);
});

test("msUntilFull", () => {
  assert.equal(F.msUntilFull(25, 25, 12000, 0), 0);
  assert.equal(F.msUntilFull(30, 25, 12000, 0), 0);
  assert.equal(F.msUntilFull(22, 25, 12000, 0), 36000);
  assert.equal(F.msUntilFull(24, 25, 12000, 5000), 7000);
});

test("backup codes round-trip, including non-ASCII names", () => {
  const save = { name: "Sir Gawain ⚔ Ælfric", level: 12, gold: 3456, inventory: { clarent: 1 }, log: ["ok"] };
  const code = F.encodeBackup(save);
  assert.ok(code.startsWith(F.BACKUP_PREFIX));
  assert.ok(!/\s/.test(code), "single line");
  assert.deepEqual(F.decodeBackup(code), save);
  assert.deepEqual(F.decodeBackup("  " + code.slice(0, 20) + "\n" + code.slice(20) + "  "), save);
});

test("decodeBackup accepts raw JSON and rejects things that aren't saves", () => {
  assert.deepEqual(F.decodeBackup('{"level":3,"gold":10}'), { level: 3, gold: 10 });
  assert.equal(F.decodeBackup('{"gold":10}'), null);
  assert.equal(F.decodeBackup("[1,2]"), null);
  assert.equal(F.decodeBackup("null"), null);
  assert.throws(() => F.decodeBackup("garbage"));
  assert.throws(() => F.decodeBackup(F.BACKUP_PREFIX + "%%%"));
});

test("dayKey uses the local calendar date", () => {
  assert.equal(F.dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(F.dayKey(new Date(2026, 11, 31, 0, 1)), "2026-12-31");
});

test("daysBetween counts calendar days across months and years", () => {
  assert.equal(F.daysBetween("2026-10-07", "2026-10-07"), 0);
  assert.equal(F.daysBetween("2026-10-31", "2026-11-01"), 1);
  assert.equal(F.daysBetween("2026-12-31", "2027-01-02"), 2);
  assert.equal(F.daysBetween("2026-03-28", "2026-03-30"), 2); // across a DST change
});

test("daily streak: first claim, next day, missed day, same day", () => {
  assert.equal(F.dailyStreakIfClaimed(null, "2026-10-07", 0), 1);
  assert.equal(F.dailyStreakIfClaimed("2026-10-06", "2026-10-07", 3), 4);
  assert.equal(F.dailyStreakIfClaimed("2026-10-04", "2026-10-07", 3), 1);
  assert.equal(F.dailyStreakIfClaimed("2026-10-07", "2026-10-07", 3), null);
  assert.equal(F.dailyStreakIfClaimed("2026-10-08", "2026-10-07", 3), null); // clock moved back
});

test("daily gold grows with level and streak, capped at 7 days", () => {
  assert.equal(F.dailyGold(1, 1), 75);
  assert.equal(F.dailyGold(10, 3), 900);
  assert.equal(F.dailyGold(10, 7), F.dailyGold(10, 30));
  assert.equal(F.dailyGold(10, 0), F.dailyGold(10, 1));
});

test("activeEvent: in range, outside, and across New Year", () => {
  const events = [
    { id: "harvest", start: "09-22", end: "10-12" },
    { id: "yuletide", start: "12-20", end: "01-06" },
  ];
  const a = F.activeEvent(events, new Date(2026, 9, 7, 12));
  assert.equal(a.event.id, "harvest");
  assert.equal(a.key, "harvest-2026");
  assert.equal(a.endsAt.getTime(), new Date(2026, 9, 12, 23, 59, 59).getTime());
  assert.equal(F.activeEvent(events, new Date(2026, 9, 13, 0, 1)), null);
  assert.equal(F.activeEvent(events, new Date(2026, 8, 22, 0, 0)).event.id, "harvest");
  const dec = F.activeEvent(events, new Date(2026, 11, 31, 20));
  const jan = F.activeEvent(events, new Date(2027, 0, 6, 9));
  assert.equal(dec.key, "yuletide-2026");
  assert.equal(jan.key, "yuletide-2026"); // same event, so tokens carry over New Year
  assert.equal(jan.endsAt.getTime(), new Date(2027, 0, 6, 23, 59, 59).getTime());
  assert.equal(F.activeEvent(events, new Date(2027, 0, 7, 0, 0)), null);
});

test("spell mastery ranks and potency", () => {
  assert.equal(F.spellRank(0), 0);
  assert.equal(F.spellRank(9), 0);
  assert.equal(F.spellRank(10), 1);
  assert.equal(F.spellRank(30), 2);
  assert.equal(F.spellRank(99), 2);
  assert.equal(F.spellRank(100), 3);
  assert.equal(F.spellRank(5000), 3);
  assert.deepEqual([0, 1, 2, 3].map(F.spellPotency), [1, 1.25, 1.5, 1.75]);
});
