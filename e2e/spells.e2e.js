"use strict";

// Browser tests for the Spellbook: run with `npm run test:browser`.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, launch, openGame, state, log, openTab } = require("./helpers");

let server;
let browser;
before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser.close();
  server.close();
});

const mage = (extra) => Object.assign({ name: "Morwen", level: 22, gold: 500, energy: 90, stamina: 60, health: 50, saveVersion: 10 }, extra);
const cast = (page, id) => page.click('[data-action=cast][data-id="' + id + '"]');

test("spells unlock by level, and a never-cast spell marks the tab", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { save: mage({ level: 5 }) });
  assert.ok(await page.isVisible('.tab[data-tab="spells"] .tab-dot'));
  await openTab(page, "spells");
  const buttons = await page.$$eval("[data-action=cast]", (bs) => bs.map((b) => b.dataset.id + ":" + b.textContent));
  assert.ok(buttons.includes("hex:Cast") && buttons.includes("blood_mend:Cast"));
  assert.ok(buttons.includes("quicken:Locked"), "Quicken the Hours waits for Level 6");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Hex raises duel odds, costs Mana, is used up by one duel, and then rests", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { save: mage() });
  const odds = () =>
    page.evaluate(() => Math.round(window.RuinWars.fightWinChance(window.RuinWars.FOES.find((f) => f.id === "black_guard")) * 100));
  const plain = await odds();
  await openTab(page, "spells");
  const manaBefore = (await state(page)).energy;
  await cast(page, "hex");
  assert.equal((await state(page)).energy, manaBefore - 8);
  assert.match(await page.textContent("#active-spells"), /Hex of Misfortune · 1 use/);
  assert.ok((await odds()) > plain, "hexed odds beat plain odds");
  assert.equal(await page.textContent('[data-action=cast][data-id="hex"]'), "Active");
  await openTab(page, "lists");
  assert.match(await page.textContent("#fight-list"), /\(hexed\)/);
  await page.click('[data-action=fight][data-id="squire"]');
  assert.equal(await odds(), plain, "one duel spends the Hex");
  assert.ok(await page.isHidden("#active-spells"));
  await openTab(page, "spells");
  assert.match(await page.textContent('[data-action=cast][data-id="hex"]'), /^Wait /);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Quicken shortens scheme rests; Blood Mending heals; Gilded Tongue raises gold", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { save: mage() });
  const patrolGold = async () => {
    await openTab(page, "quests");
    await page.click('[data-action=region][data-id="camelot"]');
    return Number((await page.textContent('[data-key="quest:patrol"] .reward-gold')).replace(/\D/g, ""));
  };
  const goldBefore = await patrolGold();
  await openTab(page, "spells");
  await cast(page, "quicken");
  await cast(page, "blood_mend");
  await cast(page, "gilded_tongue");
  const s = await state(page);
  assert.equal(s.health, Math.min(s.healthMax, 50 + Math.round(s.healthMax * 0.3)));
  assert.ok((await patrolGold()) > goldBefore, "Gilded Tongue shows on scheme rewards");
  await page.click('[data-action=quest][data-id="patrol"]');
  const rest = await page.evaluate(() => window.RuinWars.getState().questCooldownUntil.patrol - Date.now());
  assert.ok(rest <= 12000 * 0.6 + 50, "a 12s rest drops by 40% (was " + rest + "ms)");
  assert.match(await page.textContent("#active-spells"), /Quicken the Hours/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("spells grow stronger with mastery, and buffs wear off", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    time: new Date(2026, 2, 1, 12),
    save: mage({ spells: { casts: { gilded_tongue: 9 }, cooldownUntil: {}, active: {} } }),
  });
  await openTab(page, "spells");
  await cast(page, "gilded_tongue");
  assert.ok((await log(page)).some((l) => l === "Your Gilded Tongue grows stronger: Practiced (×1.25 potency)."));
  assert.match(await page.textContent('[data-key="spell:gilded_tongue"] .spell-effect'), /\+31% gold/);
  await page.clock.fastForward(30 * 60 * 1000 + 2000);
  assert.ok(await page.isHidden("#active-spells"), "the 30-minute buff has ended");
  assert.equal((await state(page)).spells.active.gilded_tongue, undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("casting your first spell earns First Incantation", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { save: mage({ stamina: 10 }) });
  await openTab(page, "spells");
  await cast(page, "siphon_will");
  const s = await state(page);
  assert.ok(s.achievements.first_incantation);
  assert.equal(s.stamina, 10 + 15);
  assert.deepEqual(errors, []);
  await ctx.close();
});
