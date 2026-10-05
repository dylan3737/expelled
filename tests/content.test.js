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
  for (const key of ["REGIONS", "QUESTS", "FOES", "HEALS", "UPGRADES", "RANKED_UPGRADES", "HOLDINGS", "LOOT", "COLLECTIONS", "BOSSES", "NAMED_KNIGHTS"]) {
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
