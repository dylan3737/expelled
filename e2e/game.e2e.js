"use strict";

// Browser tests for the core game: run with `npm run test:browser`.

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

test("a new game starts with the guide and the first scheme pays out", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url);
  assert.ok(await page.isVisible("#guide"), "guide shows for a new magician");
  await page.click("#guide-close");
  assert.ok(await page.isHidden("#guide"));
  await page.click('[data-action=quest][data-id=patrol]');
  const s = await state(page);
  assert.ok(s.gold > 0 && s.xp > 0, "the scheme paid gold and XP");
  assert.ok((await log(page)).some((l) => l.startsWith('Completed "Read Fortunes in the Gutter"')));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("tabs switch panels and the last tab is remembered", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url);
  const visible = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-panel]")].filter((p) => !p.hidden).map((p) => p.dataset.panel)
    );
  await openTab(page, "armory");
  assert.deepEqual([...new Set(await visible())], ["armory"]);
  await openTab(page, "gear");
  await page.reload();
  assert.deepEqual([...new Set(await visible())], ["gear"]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("rename and reset work even where the browser blocks prompt() and confirm()", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { blockDialogs: true });
  await page.click("#btn-rename");
  await page.fill("#rename-input", "  Morwen  ");
  await page.press("#rename-input", "Enter");
  assert.equal(await page.textContent("#player-name"), "Morwen");
  await page.click('[data-action=quest][data-id=patrol]');
  await page.click("#btn-reset");
  await page.click("#reset-cancel");
  assert.ok((await state(page)).gold > 0, "Keep playing keeps the save");
  await page.click("#btn-reset");
  await page.click("#reset-yes");
  const s = await state(page);
  assert.equal(s.name, "Magician");
  assert.equal(s.gold, 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a save backup round-trips, and text that isn't a save is rejected", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { save: { name: "Ysolde", level: 7, gold: 1234 } });
  await page.click("#btn-backup");
  await page.click("#backup-copy");
  const code = await page.inputValue("#backup-text");
  assert.ok(code.startsWith("EX1."));
  await page.click("#backup-close");
  await page.click("#btn-reset");
  await page.click("#reset-yes");
  assert.equal((await state(page)).level, 1);
  await page.click("#btn-backup");
  await page.fill("#backup-text", "not a save");
  await page.click("#backup-load");
  assert.match(await page.textContent("#backup-status"), /isn't an Expelled save/);
  assert.equal((await state(page)).level, 1, "a bad code changes nothing");
  await page.fill("#backup-text", code);
  await page.click("#backup-load");
  const s = await state(page);
  assert.equal(s.name, "Ysolde");
  assert.equal(s.level, 7);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("an old Arthurian-era save keeps its progress and reads in the new theme", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: {
      name: "Gareth",
      level: 26,
      gold: 9000,
      saveVersion: 8,
      renown: 2,
      questCounts: { patrol: 15 },
      inventory: { clarent: 1 },
      equipped: { weapon: "clarent", armor: null },
      bosses: { green_knight: { hp: 2400, kills: 1, respawnAt: 0, regenAccMs: 0 } },
      storyUnlocks: [
        { questId: "patrol", threshold: 15, rank: "Veteran", questName: "Patrol the Outer Walls", text: "old text", at: 1 },
        { questId: "boss_green_knight", threshold: 0, rank: "Boss Slain", questName: "The Green Knight", text: "old", at: 2 },
      ],
    },
  });
  const s = await state(page);
  assert.equal(s.level, 26);
  assert.equal(s.renown, 2);
  assert.equal(s.inventory.clarent, 1);
  assert.ok((await log(page)).some((l) => l.startsWith("Your tale has been retold")));
  assert.equal(await page.textContent("#player-title"), "Dread Sorcerer · Infamy 2");
  await openTab(page, "chronicle");
  const secrets = await page.$$eval("#legends-list .legend-card h4", (hs) => hs.map((h) => h.textContent));
  assert.deepEqual(secrets, ["Nemesis Fallen — The Witch-Hunter General", "Adept — Read Fortunes in the Gutter"]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a save from when the game was called Ruin Wars carries over, with its preferences", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: { name: "Morwen", level: 14, gold: 4321, saveVersion: 11 },
    saveKey: "ruin_wars_save_v4",
  });
  const s = await state(page);
  assert.equal(s.name, "Morwen");
  assert.equal(s.level, 14);
  assert.ok((await log(page)).some((l) => l.startsWith("Ruin Wars is now called Expelled")));
  const stored = await page.evaluate(() => [localStorage.getItem("expelled_save_v1"), localStorage.getItem("ruin_wars_save_v4")]);
  assert.equal(JSON.parse(stored[0]).name, "Morwen", "now saved under the new key");
  assert.ok(stored[1], "the old copy is left alone");
  await page.evaluate(() => {
    // as a returning player has it: only the Ruin Wars-era preference exists
    localStorage.removeItem("expelled_tab");
    localStorage.setItem("ruin_wars_tab", "gear");
  });
  await page.reload();
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("[data-panel]")].find((p) => !p.hidden).dataset.panel), "gear");
  assert.ok(!(await log(page)).filter((l) => l.startsWith("Ruin Wars is now called Expelled")).slice(1).length, "said only once");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("polish: rank badges, mastery bonus text, the tab bar's edge fade and the toast stack", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    viewport: { width: 390, height: 844 },
    save: {
      level: 18,
      saveVersion: 11,
      questCounts: { patrol: 12, wyrm: 3 },
      spells: { casts: { hex: 4 }, cooldownUntil: {}, active: {} },
    },
  });
  const badge = (key) => page.textContent('[data-key="' + key + '"] .mastery-badge');
  assert.equal(await badge("quest:patrol"), "Practiced");
  assert.equal(await badge("quest:wyrm"), "Novice", "done before, but not yet Practiced");
  assert.equal(await badge("quest:grail"), "Untried");
  assert.match(await page.textContent('[data-key="quest:patrol"]'), /bonus \+2% gold/);
  assert.doesNotMatch(await page.textContent('[data-key="quest:patrol"]'), /%xp|\+0%/);
  await openTab(page, "spells");
  assert.equal(await badge("spell:hex"), "Novice");
  // On a phone the tab bar overflows: its right edge fades until you reach the end.
  const bar = () => page.$eval("#tab-bar", (b) => b.className);
  await openTab(page, "quests");
  assert.match(await bar(), /more-right/);
  await openTab(page, "chronicle");
  assert.match(await bar(), /more-left/);
  assert.doesNotMatch(await bar(), /more-right/);
  // A burst of toasts keeps only the newest three.
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.Expelled.showToast("t" + i, "achv-toast", 3000);
  });
  assert.deepEqual(await page.$$eval("#toasts > *", (ts) => ts.map((t) => t.textContent)), ["t3", "t4", "t5"]);
  await openTab(page, "gear");
  assert.match(await page.textContent("#equip-summary"), /no bonuses yet/);
  // The Thralls stat and the Thralls tab count the same way: bound thralls against the cap, lieutenants apart.
  const cap = await page.evaluate(() => window.Expelled.bandCap());
  assert.equal(await page.textContent("#stat-band-cap"), String(cap));
  assert.match(await page.textContent("#band-hint"), /^Lieutenants 0 \/ 3 · Atk/);
  await openTab(page, "band");
  assert.match(await page.textContent("#band-summary"), new RegExp("Bound: 0 / " + cap + " · Lieutenants: 0 / 3"));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("festivals wait until Level 5, so a new magician's start stays uncluttered", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    time: new Date(2026, 9, 7, 12),
    save: { level: 4, saveVersion: 11 },
  });
  assert.ok(await page.isHidden("#event-bar"));
  await openTab(page, "lists");
  assert.equal(await page.$("[data-action=event-fight]"), null);
  assert.deepEqual(errors, []);
  await ctx.close();
  const at5 = await openGame(browser, server.url, { time: new Date(2026, 9, 7, 12), save: { level: 5, saveVersion: 11 } });
  assert.match(await at5.page.textContent("#event-bar"), /Harvest Moon/);
  assert.deepEqual(at5.errors, []);
  await at5.ctx.close();
});

test("Harvest Moon runs in October: ten wins claim its talisman", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    time: new Date(2026, 9, 7, 12),
    save: { level: 20, stamina: 200, health: 500, saveVersion: 10 },
  });
  assert.match(await page.textContent("#event-bar"), /Harvest Moon/);
  await openTab(page, "lists");
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      Math.realRandom = Math.random;
      Math.random = () => 0.01; // win every bout
    });
    await page.click("[data-action=event-fight]");
    await page.evaluate(() => (Math.random = Math.realRandom));
    await page.clock.fastForward(3 * 60 * 1000 + 1000);
  }
  await page.click("[data-action=event-claim]");
  const s = await state(page);
  assert.equal(s.inventory.harvest_sheaf, 1);
  assert.ok(s.achievements.festival_knight);
  await page.clock.setSystemTime(new Date(2026, 9, 20, 12));
  await page.clock.fastForward(2000);
  assert.ok(await page.isHidden("#event-bar"), "the banner goes away when the festival ends");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("rebirth at Level 30 keeps Infamy, achievements and spell mastery", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: { name: "Vesna", level: 31, gold: 50000, saveVersion: 10, spells: { casts: { hex: 12 }, cooldownUntil: {}, active: {} } },
  });
  const earnedBefore = Object.keys((await state(page)).achievements).length;
  await openTab(page, "chronicle");
  await page.click("[data-action=renown-open]");
  await page.click("[data-action=renown-confirm]");
  const s = await state(page);
  assert.equal(s.level, 1);
  assert.equal(s.renown, 1);
  assert.equal(s.name, "Vesna");
  assert.equal(s.spells.casts.hex, 12);
  assert.ok(Object.keys(s.achievements).length >= earnedBefore);
  assert.equal(await page.textContent("#player-title"), "Whispered Name · Infamy 1");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the hosted game installs a service worker and reloads offline", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the worker, which caches what it serves
  await page.waitForFunction(() => typeof window.Expelled === "object");
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof window.Expelled === "object");
  assert.equal(await page.title(), "Expelled");
  await ctx.setOffline(false);
  assert.deepEqual(errors, []);
  await ctx.close();
});
