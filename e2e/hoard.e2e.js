"use strict";

// Browser tests for empowering gear in the Hoard: run with `npm run test:browser`.

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

// Ebony Staff: +15 power, worth 120 gold
const staff = (extra) =>
  Object.assign(
    { level: 12, gold: 5000, saveVersion: 12, inventory: { grail_blade: 3 }, equipped: { weapon: "grail_blade", armor: null } },
    extra
  );
const card = (page) => page.textContent('[data-key="item:grail_blade"]');

test("empowering melts a spare and gold into an item, and its power rises 20% a rank", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { save: staff() });
  await openTab(page, "gear");
  const attack0 = await page.textContent("#band-hint");
  assert.equal(await page.textContent('[data-action=empower][data-id="grail_blade"]'), "Empower 240g");
  const gold0 = (await state(page)).gold;
  await page.click('[data-action=empower][data-id="grail_blade"]');
  let s = await state(page);
  assert.equal(s.inventory.grail_blade, 2, "a spare is used up");
  assert.equal(s.gold, gold0 - 240);
  assert.equal(s.gearRanks.grail_blade, 1);
  assert.ok((await log(page)).some((l) => l === "You melt a spare into your Ebony Staff: empowered to rank 1 (+18 power)."));
  assert.match(await card(page), /★/);
  assert.match(await card(page), /\+18 power · was \+15 power/);
  assert.notEqual(await page.textContent("#band-hint"), attack0, "attack rises");

  await page.click('[data-action=empower][data-id="grail_blade"]');
  s = await state(page);
  assert.equal(s.gearRanks.grail_blade, 2);
  assert.equal(s.inventory.grail_blade, 1);
  assert.ok(await page.isDisabled('[data-action=empower][data-id="grail_blade"]'), "no spare left");
  assert.match(await page.getAttribute('[data-action=empower][data-id="grail_blade"]', "title"), /needs a spare copy/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("rank 5 is the top and earns Master Artificer; selling the last copy loses its rank", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: staff({ gearRanks: { grail_blade: 4 }, equipped: { weapon: null, armor: null }, inventory: { grail_blade: 2 } }),
  });
  await openTab(page, "gear");
  await page.click('[data-action=empower][data-id="grail_blade"]');
  let s = await state(page);
  assert.equal(s.gearRanks.grail_blade, 5);
  assert.ok(s.achievements.artificer);
  assert.equal(await page.textContent('[data-action=empower][data-id="grail_blade"]'), "★ Max");
  assert.match(await card(page), /\+30 power/, "rank 5 doubles the item");
  await page.click('[data-action=sell][data-id="grail_blade"]');
  s = await state(page);
  assert.equal(s.inventory.grail_blade, 0);
  assert.equal(s.gearRanks.grail_blade, undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});
