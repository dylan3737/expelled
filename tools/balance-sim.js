/**
 * Balance simulator: a bot plays the real game through its buttons under Playwright's fake clock,
 * 10 game-seconds per step, and reports when each level, boss kill and named knight happens.
 *
 * Usage (serve the game first, e.g. `npx --yes serve -l 8765 .`):
 *   node tools/balance-sim.js http://localhost:8765/ <maxGameHours> <out.json>
 * Env: STOP_LEVEL (default 31); SPELLS=1 casts every ready spell, SPELLS=smart only useful ones. Needs Playwright (a dev dependency).
 *
 * The bot plays nonstop and greedily (buys every upgrade, hires to cap, heals under 60% Health),
 * so its times are a lower bound for an attentive player.
 */
const { chromium } = require(process.env.PW || "playwright");
const [url, maxHoursArg, outPath] = process.argv.slice(2);
const MAX_H = Number(maxHoursArg || 60);
const STEP_MS = 10000;

// One bot turn, run inside the page. Returns a snapshot for the log.
function botTurn(useSpells) {
  const R = window.RuinWars;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const tab = (id) => $('.tab[data-tab="' + id + '"]').click();
  const enabled = (sel) => $$(sel).filter((b) => !b.disabled);
  const st = () => R.getState();
  let s = st();
  const notes = [];

  const daily = $('#daily-bar:not([hidden]) button');
  if (daily) daily.click();

  // Spend: one-time shop, named knights, hires, holdings, then training.
  tab('armory');
  enabled('[data-action=upgrade]').forEach((b) => b.click());
  tab('band');
  enabled('[data-action=named]').forEach((b) => b.click());
  for (let i = 0; i < 80; i++) { const b = enabled('[data-action=hire]')[0]; if (!b) break; b.click(); }
  const rally = enabled('[data-action=rally]')[0]; if (rally) rally.click();
  tab('holdings');
  enabled('[data-action=collect-holding]').forEach((b) => b.click());
  for (let i = 0; i < 20; i++) { const b = enabled('[data-action=buy-holding]')[0] || enabled('[data-action=upgrade-holding]')[0]; if (!b) break; b.click(); }
  tab('gear');
  // Equip the strongest weapon and armor owned (attack + defense + gold%*100).
  s = st();
  const score = (L) => (L.effect.attack || 0) + (L.effect.defense || 0) + (L.effect.goldMult || 0) * 100;
  ['weapon', 'armor'].forEach((slot) => {
    const owned = R.LOOT.filter((L) => L.slot === slot && (s.inventory[L.id] || 0) > 0).sort((a, b) => score(b) - score(a));
    if (owned.length && s.equipped[slot] !== owned[0].id) {
      const b = $('[data-action=equip][data-id="' + owned[0].id + '"]'); if (b) b.click();
    }
  });
  const spares = $('[data-action=sell-spares]'); if (spares) spares.click();
  enabled('[data-action=redeem]').forEach((b) => b.click());
  tab('armory');
  for (let i = 0; i < 40; i++) {
    const train = enabled('[data-action=train]');
    if (!train.length) break;
    train[0].click();
  }

  // Spells first. "all": every buff that's ready. "smart": only what pays off right now (economy
  // buffs; Bone Servant and Scry while a nemesis is up; no Hex). Both heal when hurt and restore Will when low.
  if (useSpells) {
    tab('spells');
    s = st();
    const nemesisUp = R.BOSSES.some((b) => s.level >= b.minLevel && !(((s.bosses || {})[b.id] || {}).respawnAt > Date.now()));
    const want = (id) => {
      if (id === 'blood_mend') return s.health < s.healthMax * 0.6;
      if (id === 'siphon_will') return s.stamina < s.staminaMax * 0.5;
      if (useSpells !== 'smart') return true;
      if (id === 'hex') return false;
      if (id === 'bone_servant' || id === 'scry') return nemesisUp;
      return true;
    };
    enabled('[data-action=cast]').forEach((b) => { if (want(b.dataset.id)) b.click(); });
  }
  // Heal if hurt.
  s = st();
  tab('lists');
  if (s.fallen || s.health < s.healthMax * 0.6) {
    const full = $('[data-action=heal][data-id=fullrest]');
    const small = $('[data-action=heal][data-id=poultice]');
    if (full && !full.disabled) full.click(); else if (small && !small.disabled) small.click();
  }
  // Bosses while healthy. While a boss is up, Stamina is saved for it instead of The Lists.
  tab('bosses');
  const bossUp = $$('[data-action=boss]').some((b) => b.textContent === 'Strike');
  for (let i = 0; i < 30; i++) {
    s = st();
    if (s.health < s.healthMax * 0.4) break;
    const b = enabled('[data-action=boss]')[0];
    if (!b) break;
    b.click();
  }
  // The Lists: the event champion when running, then best expected XP among foes with decent odds.
  tab('lists');
  const evb = enabled('[data-action=event-fight]')[0]; if (evb) evb.click();
  const claimEv = $('[data-action=event-claim]'); if (claimEv) claimEv.click();
  for (let i = 0; i < 20 && !bossUp; i++) {
    s = st();
    if (s.health < s.healthMax * 0.4) break;
    const options = enabled('[data-action=fight]').map((b) => {
      const foe = R.FOES.find((f) => f.id === b.dataset.id);
      const odds = R.fightWinChance(foe);
      return { b, foe, odds, value: odds * foe.xp };
    }).filter((o) => o.odds >= 0.55).sort((a, b) => b.value - a.value);
    if (!options.length) break;
    options[0].b.click();
  }
  // Quests: highest region first, biggest XP first.
  tab('quests');
  let blocked = 0;
  const regions = R.REGIONS.filter((r) => s.level >= r.minLevel).reverse();
  for (const r of regions) {
    const rt = $('[data-action=region][data-id="' + r.id + '"]'); if (rt) rt.click();
    for (let i = 0; i < 30; i++) {
      const q = enabled('[data-action=quest]').map((b) => R.QUESTS.find((x) => x.id === b.dataset.id)).sort((a, b) => b.xp - a.xp)[0];
      if (!q) break;
      $('[data-action=quest][data-id="' + q.id + '"]').click();
    }
    blocked += $$('#quest-list .card.unmet').length;
  }
  // Renown at 30 happens in the sim driver, not here.
  s = st();
  const kills = {}; Object.keys(s.bosses || {}).forEach((k) => (kills[k] = s.bosses[k].kills));
  return {
    level: s.level, gold: s.gold, renown: s.renown || 0, band: s.band.recruits + Object.keys(s.band.named || {}).length,
    named: Object.keys(s.band.named || {}), kills, blocked,
    atk: R.attackRating(), def: R.defenseRating(),
    training: Object.values(s.upgradeRanks || {}).reduce((a, b) => a + b, 0),
    holdings: Object.keys(s.holdings || {}).filter((k) => s.holdings[k].owned).length,
    achievements: Object.keys(s.achievements || {}).length,
    equipped: s.equipped,
  };
}

(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-10-01T08:00:00') });
  await p.goto(url);
  const timeline = [];
  let last = null;
  const milestones = {};
  const t0 = Date.now();
  for (let step = 0; step * STEP_MS < MAX_H * 3600000; step++) {
    await p.clock.fastForward(STEP_MS);
    const mode = process.env.SPELLS === 'smart' ? 'smart' : process.env.SPELLS === '1';
    const snap = await p.evaluate(botTurn, mode);
    const h = +((step + 1) * STEP_MS / 3600000).toFixed(3);
    if (!last || snap.level !== last.level) milestones['level ' + snap.level] = h;
    Object.keys(snap.kills).forEach((k) => { if (snap.kills[k] > 0 && !milestones['kill ' + k]) milestones['kill ' + k] = h; });
    snap.named.forEach((n) => { if (!milestones['named ' + n]) milestones['named ' + n] = h; });
    if (step % 30 === 0) timeline.push({ h, ...snap });
    last = snap;
    if (snap.level >= Number(process.env.STOP_LEVEL || 31)) break;
    if (Date.now() - t0 > 25 * 60 * 1000) { milestones.timeout = h; break; }
  }
  const out = { milestones, final: last, timeline, errors: errs.slice(0, 5), wallSeconds: Math.round((Date.now() - t0) / 1000) };
  require('fs').writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ milestones, final: { level: last.level, gold: last.gold, band: last.band, atk: last.atk, def: last.def, training: last.training, holdings: last.holdings, achievements: last.achievements, equipped: last.equipped }, errors: out.errors, wallSeconds: out.wallSeconds }, null, 1));
  await b.close();
})();
