# Ruin Wars

Arthurian / fantasy clicker starter in the spirit of old Facebook *Mafia Wars*: spend **Energy** on quests across **three regions** (with **mastery** + **story**), **Stamina** on arena fights and **boss** strikes, manage **Health**, grow a **knight band**, earn **gold** and **XP**, buy **holdings** for passive income, find **loot** to equip, complete **collections**, level up, and buy permanent shop upgrades. No backend — pure static HTML/CSS/JS with `localStorage` saves.

**Play it:** https://dylan3737.github.io/ruin_wars/ (published from `main` by GitHub Actions once Pages is turned on, see [Hosting](#hosting)).

**Current version: v0.9** — a first-visit guide, 25 achievements, a daily tribute, background music, and an installable app that plays offline. v0.8 added seven new foes in The Lists, sound effects, and tests + deploys on GitHub Actions; v0.7 brought a gentler start and a longer end: a softer first foe plus a Tempered Blade tip, a third boss (**the Questing Beast**), and **Renown** (prestige). v0.6 made it easier to play: tabs instead of one long page, a save backup you can copy and paste, and clearer feedback (floating gains, a level-up flash, time-until-full on Energy / Stamina / Health). v0.5 deepened the economy (ranked training, region-tiered loot you can sell, odds-based bouts, quest requirements); v0.4 added Regions, Bosses, Knight Band and Collections.

## Resources

| Resource | Used for | Regen |
|----------|----------|--------|
| **Energy** | Quests | +1 / 12s (~9s with Cloak of Rest) |
| **Stamina** | The Lists (AI fights) + boss strikes | +1 / 18s |
| **Health** | Survive fights / boss counterblows; 0 = fallen (fights + bosses locked) | +1 / 20s while below max; Chapel heals for gold |
| **Gold** | Shop, Chapel, Holdings buy/upgrade | Quests, fights, holding Collect |

## Pacing (v0.3.1)

- Energy regenerates about every **12s**; Stamina about every **18s** (slower, more Mafia Wars–like).
- Quest cooldowns are **short on early jobs**, **long on late jobs** (up to a few minutes).
- Fight opponent cooldowns are longer too.

## v0.9

### How to play
New knights (Level 3 or below) see a five-step guide above the stats until they press **Got it**; **How to play** in the header brings it back. Dismissing it is remembered per browser (`ruin_wars_guide_seen`).

### Achievements
25 achievements live in `content.js` (`ACHIEVEMENTS`) and show in the Chronicle tab with progress bars. Each pays its gold once, is announced with a banner and a chime, and is kept through Renown. Checks: quests completed, quests at Master rank, level, bouts won, upset wins (odds under 30%), each boss slain, band size, all named knights, all holdings, collections redeemed, training ranks, Renown, and a 7-day tribute streak. Older saves are credited for deeds already done on first load (one summary line).

New lifetime counters in the save: `stats.fightWins`, `stats.upsets`.

### Daily tribute
Once per calendar day (your local midnight) a bar under the stats offers the tribute: `(50 + 25 × level) × streak day` gold, capped at day 7, plus full Energy. Claiming on consecutive days raises the streak; missing a day starts it over at 1. Stored as `daily: { lastDay, streak }` and kept through Renown. The date logic lives in `formulas.js` (`dayKey`, `daysBetween`, `dailyStreakIfClaimed`, `dailyGold`) and is unit-tested.

### Music
**Music: off / on** in the header plays a slow generated loop (Web Audio): soft drone chords in D dorian (Dm – C – B♭ – C) with a few harp notes on the beat. Off by default, remembered per browser (`ruin_wars_music`), paused while the tab is hidden. Browsers only allow audio after you interact, so saved-on music starts at your first tap.

### Install and offline play
On the hosted site the game is a Progressive Web App: `manifest.webmanifest` + `icons/` make it installable (Add to Home Screen on phones, the install button in desktop browsers), and `sw.js` caches the game so it plays offline. The service worker is network-first, so online visits always get the latest release; each deploy stamps the commit into the cache name.

## v0.8

### New foes in The Lists
The Lists now groups foes under region headings and shows every foe you can face plus the next one to unlock.

| Foe | Region | Level | Power | Stamina | Gold / XP | Damage | Cooldown |
|-----|--------|-------|-------|---------|-----------|--------|----------|
| **Grove Thief** | Avalon | 10 | 115 | 13 | 170 / 175 | 22–38 | 100s |
| Faerie Champion | Avalon | 11 | 140 | 14 | 200 / 200 | 26–44 | 120s |
| **Warden of the Lake** | Avalon | 14 | 175 | 15 | 260 / 245 | 28–48 | 130s |
| **Glamoured Knight** | Avalon | 17 | 210 | 16 | 330 / 300 | 32–52 | 140s |
| Mordred's Outrider | Wastes | 20 | 230 | 16 | 380 / 330 | 34–56 | 150s |
| **Barrow-Wight** | Wastes | 22 | 265 | 17 | 440 / 380 | 36–60 | 160s |
| **Saxon Huscarl** | Wastes | 25 | 305 | 18 | 520 / 440 | 40–66 | 170s |
| **Mordred's Black Guard** | Wastes | 28 | 350 | 19 | 610 / 510 | 44–72 | 180s |
| **Camlann Revenant** | Wastes | 30 | 395 | 20 | 720 / 590 | 48–78 | 200s |

Wins against Avalon and Wastes foes roll that region's loot, so these are new ways to farm late-game gear.

### Sound
**Sound: off / on** in the header toggles short synthesized cues (Web Audio, no audio files): quest complete, coins, spending, fight win / loss, boss strike, healing, level-up and a boss-kill fanfare. Off by default; the choice is remembered per browser (`localStorage` key `ruin_wars_sound`, separate from the save).

## v0.7 systems

### A gentler start
- The **Boastful Squire** drops from power 18 to 12: a fresh Level 1 knight has about 16% odds, but with the Tempered Blade it's about 88%.
- Until you own the Blade, The Lists shows a tip with an **Open Armory** button, and the Armory tab shows a dot once you can afford it.

### The Questing Beast
| Boss | Level | HP | Regen | Stamina / strike | Counter | Kill reward | Returns |
|------|-------|----|-------|------------------|---------|-------------|---------|
| **The Questing Beast** | 30 | 14,000 | 40 HP/min | 10 | 18–34 | 20,000 gold, 6,000 XP, **Pellinore's Hunting Mail** (armor: +25% gold, +60 def, +20 power), Grail piece | 90 min |

Strikes pay 80g / 50xp. Boss legends are now written once per legend name, so they don't repeat after a Renown reset.

### Renown (prestige)
- At **Level 30**, the Chronicle tab's **Renown** section offers **Begin a new legend** (with an in-page confirm). You restart at Level 1 and keep only your **name, Renown and Legends**; everything else resets.
- Each Renown rank grants **+10% gold and +10% XP** on everything, permanently, and a title shown under your name: Errant Knight → Knight of the Round Table → Knight of the Grail → Peer of Logres → Pendragon's Champion (repeats past rank 5).
- The Chronicle tab shows a dot while you're eligible.

## v0.6 interface

### Tabs
The stats panel stays on top; everything else sits under a sticky tab bar: **Quests · Lists · Bosses · Band · Holdings · Gear · Armory · Chronicle** (Gear = Inventory + Collections, Lists = The Lists + Chapel). The last tab you used is remembered per browser (`localStorage` key `ruin_wars_tab`, separate from the save), and a bare `#lists`-style link opens that tab. Left / Right arrow keys move between tabs.

A dot on a tab means something is waiting there: a **full holding**, the **Muster Horn** ready with room in the band, a **complete collection** to redeem, or a **boss** you have the Stamina to strike.

Under the tabs, a **ticker** shows the three latest chronicle lines (hidden on the Chronicle tab, which has the full log).

### Save backup
**Backup** in the header opens a box with **Copy my save** (a single-line code, `RW1.` + base64 of the save JSON, copied to the clipboard or selected for you) and **Load pasted save** (accepts that code or raw save JSON, and replaces current progress). Rename, Reset and Backup are all in-page controls, so they also work where `prompt()` / `confirm()` are blocked (e.g. when hosted as a Claude artifact).

### Feedback
- Every action button shows floating changes where you clicked: gold (+ / −), XP, Health lost or healed.
- Levelling up flashes the stats panel and shows a **Level N!** banner.
- Energy, Stamina and Health hints show the rate and **time until full**.
- Animations are cut short under `prefers-reduced-motion`.

## v0.5 systems

### Ranked training (Armory)
Below the three one-time relics, **Training** can be bought rank after rank. Next rank costs `baseCost × growth^rank` (rounded to 5).

| Training | Per rank | Base cost | Growth | Max rank |
|----------|----------|-----------|--------|----------|
| **Whetstone Drills** | +4 attack | 150 | ×1.35 | 20 |
| **Shield-Wall Drills** | +4 defense | 150 | ×1.35 | 20 |
| **Steward's Ledger** | +3% gold | 250 | ×1.4 | 20 |
| **Scholar's Tomes** | +3% XP | 250 | ×1.4 | 20 |
| **Provisioner's Wagon** | +3 max Energy | 400 | ×1.5 | 10 |

### Region-tiered loot + selling
- Random drops roll from the pool of the region they were won in: a quest's region, or the foe's region in The Lists (Faerie Champion = Avalon, Mordred's Outrider = Wastes, the rest = Camelot).
- Each region has 3 weapons, 3 armors and 3 relics. Avalon gear is roughly 2–3× Camelot's; the Wastes go further (best weapon +75 attack, best armor +20% gold / +45 def / +15 atk). Armor in later regions also grants defense.
- **Clarent** (Mordred's unique) is buffed to +85 power, +15 defense so it stays the best weapon.
- Every item has a sell `value`. **Sell** one copy from its card, or **Sell all spares** (keeps one of each). Your last copy of a relic, and the last copy of an equipped item, can't be sold.

### Odds-based bouts
- Win chance = `atk⁴ / (atk⁴ + foePower⁴)`, clamped to 5–95%: 50% at even power, ~67% at +20%, ~84% at +50%, ~29% at −20%. The odds are shown on each foe card.
- **Upset bonus**: winning with odds below 50% multiplies gold and XP by `1 + 2 × (0.5 − odds)` (up to ×1.9).

### Quest requirements
Later quests need a large enough **band** (sworn + named knights) and/or a **weapon / armor equipped**. Requirements show on the quest card with ✓ / ✗.

| Quest | Needs |
|-------|-------|
| Hunt the Marsh Wyrm | 2 knights |
| Hold the Broken Keep | 4 knights |
| Quest for the Lost Chalice | 6 knights, weapon |
| Guard the Apple Groves | 10 knights |
| Break the Faerie Ring | armor |
| Unmask Morgan's Illusions | 14 knights |
| Recover the Lost Scabbard | 16 knights, weapon, armor |
| Ride the Ashen Road | 16 knights |
| Lay the Unquiet Dead | weapon |
| Scatter the Saxon Warband | 22 knights |
| Attend the Fisher King | 24 knights, armor |
| Scout the Field of Camlann | 28 knights |
| Reclaim the Hollow Throne | 30 knights, weapon, armor |

## v0.4 systems

### Regions
Quest board has region tabs. Each region has 6 quests with its own mastery ranks (5 / 15 / 40) and story beats.

| Region | Unlock | Quests | Energy | Gold / XP (base) | Cooldown |
|--------|--------|--------|--------|------------------|----------|
| **Camelot** | Lv 1 | the original 6 | 3–15 | 18–210 / 28–230 | 12s – ~3 min (unchanged) |
| **Avalon** | Lv 10 (quests Lv 10–18) | Mists, Lady of the Lake, Apple Groves, Faerie Ring, Morgan's Illusions, Lost Scabbard | 14–24 | 260–640 / 270–550 | 2.5 – 3.75 min |
| **The Wastes** | Lv 20 (quests Lv 20–30) | Ashen Road, Unquiet Dead, Saxon Warband, Fisher King, Camlann, Hollow Throne | 20–35 | 600–1400 / 560–1050 | 3.5 – 5 min |

Holdings are tagged by region; two new ones: **Isle Apple Orchard** (Lv 10, 3,000g, +140g / 3 min) and **Salt Road Fort** (Lv 20, 8,000g, +360g / 4 min). Two new Lists foes: **Faerie Champion** (Lv 11, power 140) and **Mordred's Outrider** (Lv 20, power 230).

### Bosses
Shared HP pool whittled down by Stamina strikes. HP persists (saved), regenerates slowly while the boss lives, and resets when it returns after its cooldown. Strike damage ≈ your attack rating ×0.85–1.15 (+ named-knight bonuses); each strike also pays a little gold/XP and the boss hits back (reduced by defense). Every kill guarantees the boss's unique item plus a collection piece (missing pieces preferred); the first kill writes a Legend.

| Boss | Level | HP | Regen | Stamina / strike | Counter | Kill reward | Returns |
|------|-------|----|-------|------------------|---------|-------------|---------|
| **The Green Knight** | 12 | 2,400 | 30 HP/min | 5 | 6–14 | 2,500 gold, 1,000 XP, **Green Girdle** (relic: +15 def, +5% XP), Round Table piece | 30 min ("a year and a day") |
| **Mordred** | 25 | 10,000 | 45 HP/min | 8 | 12–26 | 8,000 gold, 3,000 XP, **Clarent** (weapon: +85 power, +15 def since v0.5), Pendragon piece | 60 min |

(Kill gold/XP are multiplied by your gold/XP bonuses. Strikes also give 15g/10xp and 40g/25xp respectively.)

### Knight Band
- **Attack rating** = level×8 + Tempered Blade + training + gear + band + collections. **Defense rating** = level×3 + training + gear + band + collections; damage taken is multiplied by `1 − def / (def + 150)`.
- **Sworn knights**: +2 attack, +2 defense each. Cap = **2 + level** (max 60). **Hire** costs `30 + 20 × current sworn` gold; **Sound the Muster Horn** recruits one free every **10 min** (same cap).
- **Named knights** (one-time, don't use the cap): **Sir Gawain** (Lv 8, 1,500g: +10 atk/+5 def, +25% damage vs the Green Knight), **Sir Percival** (Lv 15, 4,000g: +8/+8, +5% XP), **Sir Lancelot** (Lv 22, 9,000g: +20/+10, +10% damage to all bosses).
- Band size / max and Atk · Def ratings are shown in the stats bar.

### Collections
One 5-piece set per region. Pieces drop from quests in that region (**15%**), fight wins (**10%**, from any unlocked region's set) and are guaranteed from boss kills. Duplicates are counted. A complete set can be redeemed **once** (consumes one of each piece) for a permanent bonus:

| Set | Region | Pieces | Bonus |
|-----|--------|--------|-------|
| **Arms of the Round Table** | Camelot | Round Table Splinter, Kay's Seneschal Key, Bedivere's Gauntlet, Gawain's Pentangle Boss, Arthur's Signet Ring | +10 attack, +10 defense |
| **Relics of the Grail** | Avalon | Lady's Veil, Golden Apple of Avalon, Silver Paten, Tip of the Bleeding Lance, Grail's Light | +10 max Energy, +5 max Stamina |
| **Regalia of Pendragon** | Wastes | Red Dragon Banner, Camlann Arrowhead, Uther's Torque, Merlin's Hazel Staff, Crown of Logres | +10% gold, +10% XP |

## v0.3 systems

### Quest mastery + Legends
- Each quest tracks `questCounts`. Ranks: **Unproven → Proven (5) → Veteran (15) → Master (40)**.
- Hitting a milestone unlocks an Arthurian story beat (re-readable under **Legends** in the Chronicle) and a small permanent bonus on that quest (cumulative ~+2–7% gold / +0–4% XP depending on rank).

### Holdings
- Buy fantasy properties (farm, chapel lands, watchtower, ruin market). Each accrues gold on a real-time cycle (60–150s).
- **Collect** gathers pending gold (capped at **2 cycles** so AFK does not explode). Optional upgrades (up to rank 2) raise income. Offline time accrues like energy.

### Loot + inventory
- ~22% chance on quest complete (also ~12% on fight win) to drop from the region's 9-item table (weapons, armor, relics) — see v0.5.
- Equip **1 weapon + 1 armor**; **relics** are passive while owned. Duplicates stack as counts.

## How to run locally

Zero build step. From this folder:

```bash
# Option A — open the file
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows

# Option B — tiny static server
npx --yes serve .
```

## Tests

Plain Node, no dependencies (Node 18+):

```bash
npm test        # runs node --test over tests/*.test.js
```

- `tests/formulas.test.js` — XP curve, quest cooldowns, fight odds and upset bonus, defense soak, training costs, band cap / hire cost, time-until-full, backup code round-trips, daily tribute dates / streak / gold.
- `tests/content.test.js` — sanity checks on `content.js`: unique ids, quests in real regions with a story beat at every mastery rank, band requirements reachable at each quest's level, 3 weapons / 3 armors / 3 relics per region, every boss drops a real unique and collection piece and has a legend, named-knight boss bonuses point at real bosses, foes get harder and pay more with level, and achievements use known checks with reachable targets.

Run them after any balance edit in `content.js`. GitHub Actions also runs them on every push and pull request.

## Hosting

`.github/workflows/ci.yml` runs `npm test` on every push and pull request. When a push to `main` passes, it copies the game files, `manifest.webmanifest`, `sw.js` and `icons/` into a site and deploys it to **GitHub Pages** at https://dylan3737.github.io/ruin_wars/.

One-time setup: in the repo on GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**. Until then the deploy job fails (the tests still run). Saves live in each browser, so a save from another copy of the game (a local file or the Claude artifact) moves over with **Backup → Copy my save / Load pasted save**.

## Code layout

| File | Role |
|------|------|
| `index.html` | Layout: header (rename / backup / reset dialogs), stats (incl. band), tab bar + ticker, then one tagged `data-panel` section per tab: quests + region tabs, Lists + Chapel, bosses, knight band, holdings, inventory, collections, shop, renown, chronicle + legends. Loads `formulas.js`, `content.js`, then `game.js`. |
| `styles.css` | Dark parchment / stone theme |
| `content.js` | **Content tables** (pure data, tune balance here): `REGIONS` / `QUESTS` / `STORY_BEATS` / `BOSS_LEGENDS` / `MASTERY_BONUSES` / `FOES` / `HEALS` / `UPGRADES` / `RANKED_UPGRADES` / `HOLDINGS` / `LOOT` / `COLLECTIONS` / `BOSSES` / `NAMED_KNIGHTS` / `ACHIEVEMENTS`. Exposed as `window.RuinWarsContent`. |
| `formulas.js` | **Pure formulas** with no DOM or game state: `xpForLevel`, `questCooldownMs`, `fightWinChance(attack, power)`, `upsetMultiplier`, `soakDamage(dmg, defense)`, `rankedUpgradeCost(def, rank)`, `bandCap(level)`, `hireCost(recruits)`, `msUntilFull`, `encodeBackup` / `decodeBackup`. Exposed as `window.RuinWarsFormulas`. |
| `game.js` | Game rules, state, save/load and rendering, built on the two files above |
| `tests/` | `node --test` suites for the formulas and content (see Tests) |
| `manifest.webmanifest`, `sw.js`, `icons/` | App install and offline play on the hosted site (see Install and offline play) |
| `.github/workflows/ci.yml` | Tests on every push / PR; deploys `main` to GitHub Pages |

Both `content.js` and `formulas.js` are plain scripts that also work with `require()`, which is how the tests load them.

In `game.js`:
- **`doQuest` / `doFight` / `doBossStrike` / `hireRecruit` / `rallyRecruit` / `recruitNamed` / `redeemCollection` / `setRegion` / `doHeal` / `buyUpgrade` / `buyRankedUpgrade` / `buyHolding` / `collectHolding` / `equipItem` / `sellItem` / `sellSpares`** — core actions
- **Fight formula** — `fightWinChance(foe)` = `atk⁴ / (atk⁴ + power⁴)` clamped 5–95%, upset bonus via `upsetMultiplier`; losses/chip damage soaked by `defenseRating()`
- **Quest requirements** — `questRequirements(quest)` / `unmetRequirements(quest)` read a quest's optional `requires: { band, weapon, armor }`
- **`tick`** — energy, stamina, health regen + holding accrual + boss regen/respawn every second, then `renderLive()`
- **Rendering** — render functions build detached nodes and `patchChildren()` morphs them into the page (keyed by `data-key`), so unchanged buttons keep their identity across ticks (no dropped clicks / hover flicker). Buttons use `data-action` / `data-id` with one delegated click listener (`ACTIONS`).
- **Tabs / feedback** — `setTab` / `tabAlerts` / `renderTicker`; `onActionClick` snapshots gold / XP / level / health before each action and `showActionFeedback` floats the difference
- **Backup** — `F.encodeBackup(savePayload())` / `F.decodeBackup(text)`; `load()` and backup import both go through `applySaveData(data)`
- **Renown** — `beginNewLegend` keeps `name`, `renown`, `storyUnlocks`; `renownBonuses()` feeds `goldMultiplier` / `xpMultiplier`
- **`save` / `load`** — `localStorage` key `ruin_wars_save_v4` (`saveVersion: 6`); falls back to legacy `ruin_wars_save_v1` and migrates. Saves happen immediately after actions, at most every ~8s from the tick when something changed, and on `visibilitychange` (hidden) / `pagehide` / `beforeunload`. The last 50 chronicle lines are saved under `log` (optional; older saves load fine without it).
- **`window.RuinWars`** — DevTools helpers

## Save compatibility

v0.7 still saves to `ruin_wars_save_v4`, now with `saveVersion: 6`; older v4 saves load as-is and gain `upgradeRanks: {}` (v0.5) and `renown: 0` (v0.7). If no v4 save exists, the v0.3 save under `ruin_wars_save_v1` is loaded and migrated: missing fields (`region`, `collections`, `collectionsRedeemed`, `bosses`, `band`, plus the older `questCounts`, `storyUnlocks`, `holdings`, `inventory`, `equipped`) get defaults. The legacy key is left untouched, so rolling back to v0.3 still works. Use **Reset** for a clean slate.

## Suggested next features

1. A fourth region beyond the Wastes, with its own quests, foes, boss and collection.
2. Seasonal events (e.g. a Midsummer tourney with limited-time foes).

## License

Starter code for Dylan — use freely in the Ruin Wars project.
