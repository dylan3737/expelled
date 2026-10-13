"use strict";

// Browser tests for factions and crossroads: run with `npm run test:browser`.

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

const factions = (extra) => Object.assign({ standing: {}, pending: null, sinceLast: 0, choices: 0, recent: [] }, extra);

test("a crossroads appears after enough schemes, and choosing raises one faction and lowers its rival", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: { level: 6, gold: 0, energy: 50, saveVersion: 12, factions: factions({ sinceLast: 11 }) },
  });
  assert.ok(await page.isHidden("#crossroads"));
  await page.click('[data-action=quest][data-id="patrol"]');
  const pending = (await state(page)).factions.pending;
  assert.ok(["informer", "widow"].includes(pending), "a Level 5 crossroads is offered (got " + pending + ")");
  assert.ok(await page.isVisible("#crossroads"));
  assert.ok(await page.isVisible('.tab[data-tab="quests"] .tab-dot'), "the Schemes tab is marked");
  assert.ok((await log(page)).some((l) => l.startsWith("A crossroads: ")));

  const goldBefore = (await state(page)).gold;
  await page.click('[data-action=crossroads][data-id="0"]'); // both Level 5 crossroads: option 0 favors the Order
  const s = await state(page);
  assert.equal(s.factions.pending, null);
  assert.equal(s.factions.standing.order, 10);
  assert.equal(s.factions.standing[pending === "informer" ? "covens" : "dead"], -10);
  assert.equal(s.gold, goldBefore + 20 * 6 + 200, "pays 20 gold per level, plus the first-choice achievement");
  assert.equal(s.factions.choices, 1);
  assert.equal(s.factions.sinceLast, 0);
  assert.ok(s.achievements.crossroads, "A Choice at the Crossroads");
  assert.ok(await page.isHidden("#crossroads"));
  assert.match((await log(page))[1], /Order of the Pale Flame \+10, .* −10, \+120 gold\.$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("crossroads wait for Level 5, and only one waits at a time", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: { level: 4, energy: 50, saveVersion: 12, factions: factions({ sinceLast: 40 }) },
  });
  await page.click('[data-action=quest][data-id="patrol"]');
  assert.equal((await state(page)).factions.pending, null, "not before Level 5");
  await ctx.close();

  const second = await openGame(browser, server.url, {
    save: { level: 9, energy: 50, saveVersion: 12, factions: factions({ sinceLast: 30, pending: "widow" }) },
  });
  await second.page.click('[data-action=quest][data-id="patrol"]');
  assert.equal((await state(second.page)).factions.pending, "widow", "the waiting choice is kept");
  assert.deepEqual(errors.concat(second.errors), []);
  await second.ctx.close();
});

test("standing earns perks: Trusted with the Covens adds XP, and the Factions tab shows it", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: { level: 12, saveVersion: 12, factions: factions({ standing: { covens: 20, order: 5 }, pending: "informer" }) },
  });
  const xpShown = () => page.textContent('[data-key="quest:patrol"] .reward-xp');
  const before = await xpShown();
  await page.click('[data-action=crossroads][data-id="1"]'); // warn the coven: Covens +10, Order −10
  const s = await state(page);
  assert.equal(s.factions.standing.covens, 30);
  assert.equal(s.factions.standing.order, -5);
  assert.ok((await log(page)).some((l) => l === "The Covens now count you Trusted: +10% XP."));
  assert.notEqual(await xpShown(), before, "scheme XP rises with the perk");
  await openTab(page, "factions");
  const covens = await page.textContent('[data-key="faction:covens"]');
  assert.match(covens, /Trusted/);
  assert.match(covens, /✓ Trusted \(30\): \+10% XP/);
  assert.match(covens, /30 to Sworn/);
  assert.match(await page.textContent('[data-key="faction:order"]'), /Wary/);
  assert.match(await page.textContent("#faction-summary"), /^1 choice made · next crossroads in 12 schemes$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("factions are kept through rebirth", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: { level: 31, saveVersion: 12, factions: factions({ standing: { dead: 60, covens: -60 }, choices: 6 }) },
  });
  assert.ok((await state(page)).achievements.sworn, "Sworn is credited on load");
  await openTab(page, "chronicle");
  await page.click("[data-action=renown-open]");
  await page.click("[data-action=renown-confirm]");
  const s = await state(page);
  assert.equal(s.level, 1);
  assert.equal(s.factions.standing.dead, 60);
  assert.equal(s.factions.choices, 6);
  assert.deepEqual(errors, []);
  await ctx.close();
});
