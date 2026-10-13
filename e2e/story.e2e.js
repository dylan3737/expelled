"use strict";

// Browser tests for the main story and the Black Spire: run with `npm run test:browser`.

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

const barText = (page) => page.textContent("#story-bar");

test("a new magician starts on Chapter 1, then is sent to buy a wand before the drains", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url);
  assert.match(await barText(page), /Chapter 1\s*Cast Out/);
  assert.match(await barText(page), /Read new chapter/);
  assert.ok(await page.isVisible('.tab[data-tab="chronicle"] .tab-dot'), "an unread chapter marks the Chronicle");
  const gold0 = (await state(page)).gold;
  await page.click('[data-action=quest][data-id="patrol"]');
  const s = await state(page);
  assert.ok(s.story.done.cast_out, "chapter 1 is finished");
  assert.ok(s.gold >= gold0 + 100, "and pays its gold");
  assert.match(await barText(page), /Chapter 2\s*A Wand of Your Own/);
  assert.ok((await log(page)).some((l) => l.startsWith("Chapter 2 begins: A Wand of Your Own")));
  await openTab(page, "chronicle"); // reading the chapter turns its button into a signpost
  assert.equal(await page.textContent("#story-bar button"), "Go to Sanctum");
  await page.click("#story-bar button");
  assert.ok(await page.isVisible('[data-action=upgrade][data-id="sword"]'), "the Sanctum is open");
  assert.equal(await page.textContent("#story-bar button"), "Read", "no signpost to the tab you are on");
  await page.click('[data-action=upgrade][data-id="sword"]');
  assert.ok((await state(page)).story.done.wand, "buying the Blackthorn Wand finishes chapter 2");
  assert.match(await barText(page), /Chapter 3\s*A Voice in the Drains/);
  await page.click("[data-action=read-story]");
  const tale = await page.$$eval("#tale-list .tale-chapter", (cs) => cs.map((c) => c.className + " | " + c.querySelector("h4").textContent));
  assert.deepEqual(tale, [
    "tale-chapter done | Chapter 1 · Cast Out",
    "tale-chapter done | Chapter 2 · A Wand of Your Own",
    "tale-chapter current | Chapter 3 · A Voice in the Drains",
  ]);
  assert.ok(await page.isHidden('.tab[data-tab="chronicle"] .tab-dot'), "reading the chapter clears the dot");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a returning magician is credited with every chapter already behind them", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: {
      level: 26,
      saveVersion: 10,
      questCounts: { patrol: 3, wyrm: 1, grail: 1, lady: 5, morgan: 1, scabbard: 1 },
      ownedUpgrades: { sword: true },
      stats: { fightWins: 12, upsets: 0 },
      band: { recruits: 25, named: {}, rallyReadyAt: 0 },
      bosses: {
        green_knight: { hp: 2400, kills: 1, respawnAt: 0, regenAccMs: 0 },
        mordred: { hp: 10000, kills: 1, respawnAt: 0, regenAccMs: 0 },
      },
    },
  });
  const s = await state(page);
  assert.equal(Object.keys(s.story.done).length, 13, "chapters 1–13 are done");
  assert.match(await barText(page), /Chapter 14\s*The Obsidian Throne/);
  assert.ok((await log(page)).some((l) => l.startsWith("The tale catches up with you: chapters 1–13")));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the Black Spire opens at Level 45 with its schemes and the Archmage", async () => {
  const { ctx, page, errors } = await openGame(browser, server.url, { save: { level: 46, saveVersion: 11 } });
  await page.click('[data-action=region][data-id="spire"]');
  assert.match(await page.textContent("#region-intro"), /White College's hidden tower/);
  const schemes = await page.$$eval("#quest-list .card", (cs) => cs.map((c) => c.dataset.key.replace("quest:", "")));
  assert.deepEqual(schemes, ["spire_gate", "spire_library", "spire_students", "spire_vault", "spire_mirror", "spire_summit"]);
  await openTab(page, "bosses");
  assert.match(await page.textContent('[data-key="boss:archmage"]'), /The Archmage of the White College/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("defeating the Archmage ends the tale with the epilogue", async () => {
  const done = {};
  [
    "cast_out", "wand", "familiar", "circle", "ledger", "witchwood", "weir", "warrant", "coven_mother", "root_book",
    "wastes", "army", "lich", "throne_claim", "wyrmsong", "grey_sea", "ticket", "founder", "first_spell",
    "black_spire", "everything_taken",
  ].forEach((id) => (done[id] = 1));
  const { ctx, page, errors } = await openGame(browser, server.url, {
    save: {
      level: 52,
      stamina: 80,
      health: 2000,
      saveVersion: 11,
      story: { done: done, seen: "expelled_no_more" },
      bosses: { archmage: { hp: 5, kills: 0, respawnAt: 0, regenAccMs: 0 } },
    },
  });
  assert.match(await barText(page), /Chapter 22\s*Expelled No More/);
  await openTab(page, "bosses");
  await page.click('[data-action=boss][data-id="archmage"]');
  const s = await state(page);
  assert.ok(s.story.done.expelled_no_more);
  assert.ok(s.achievements.tale_told && s.achievements.archmage);
  assert.ok(await page.isHidden("#story-bar"), "no chapter left to show");
  await openTab(page, "chronicle");
  assert.match(await page.textContent(".tale-epilogue"), /The Black Spire stands open/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
