# Expelled

The rise of a dark magician, in the spirit of old Facebook *Mafia Wars*. Cast out of the White College, you scheme your way up from the gutters of Hollowmere: spend **Mana** on schemes across **four regions** (with **mastery** and **secrets**), **Will** on duels and **nemeses**, manage **Health**, bind **thralls**, earn **gold** and **XP**, buy **lairs** for passive income, hoard **loot**, bind **grimoires**, and be reborn for **Infamy**. No backend: pure static HTML/CSS/JS with `localStorage` saves.

**Status:** private, not published. Open `index.html` locally to play (see [How to run locally](#how-to-run-locally)); [Hosting](#hosting) explains how to publish it later.

**Current version: v2.5** — **factions** with crossroads choices, **empowered gear**, three more **festivals**, a smoother **first five minutes**, and **sigils** and region skies (see [v2.5](#v25--factions-forge-and-festivals)). v2.4 was a polish pass: clearer rank badges and bonus text, a tab bar that shows it scrolls on phones, toasts that no longer cover the tabs, and a compact achievements grid (see [v2.4](#v24--polish-pass)). v2.3 gave the game its own name and repo. Until v2.2 it was the dark-magician branch of **Ruin Wars**; Ruin Wars itself went back to its Arthurian v1.0 in its own repo (see [v2.3](#v23--expelled)). v2.2 added a **main story** in 21 chapters and a fifth region, **the Black Spire** (see [v2.2](#v22--the-tale-and-the-black-spire)). v2.1 added a **Spellbook** of eight spells cast with Mana (see [v2.1](#v21--the-spellbook)), and browser tests that run in CI. v2.0 rethemed the game from Arthurian legend to **the adventures of a dark magician** (see [v2.0](#v20--the-dark-magician)); mechanics, numbers and saves are unchanged. v1.0 added a fourth region (Lyonesse, now the Drowned Archive, Level 35), seasonal tourneys (now festivals), a balance pass driven by a simulated player (levels now take much longer), and fixes from a code review. v0.9 added a first-visit guide, achievements, a daily tribute, music and an installable app; v0.8 added seven new foes in The Lists, sound effects, and tests + deploys on GitHub Actions; v0.7 brought a gentler start and a longer end: a softer first foe plus a Tempered Blade tip, a third boss (**the Questing Beast**), and **Renown** (prestige). v0.6 made it easier to play: tabs instead of one long page, a save backup you can copy and paste, and clearer feedback (floating gains, a level-up flash, time-until-full on Energy / Stamina / Health). v0.5 deepened the economy (ranked training, region-tiered loot you can sell, odds-based bouts, quest requirements); v0.4 added Regions, Bosses, Knight Band and Collections.

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

## v2.5 — Factions, forge and festivals

### Factions and crossroads
Three powers watch the magician rise: **the Covens** (the witches of the Witchwood and the gutter-covens), **the Restless Dead** (liches, ghosts and the buried legions) and **the Order of the Pale Flame** (the College's witch-hunters, some of them for sale).

- From Level 5, every **20 schemes** bring a **crossroads**: a short situation at the top of the Schemes tab with two choices. The choice you make raises one faction's standing by 10 and lowers its rival's by 10, and pays gold or XP by your level. The card never blocks play; a dot on the Schemes tab marks it, and only one waits at a time.
- Twelve crossroads, from a Pale Flame sergeant in Hollowmere (Level 5) to a door into the Black Spire (Level 45). The same one isn't offered again until four others have been.
- Standing runs from −100 to +100: Hostile, Wary, Neutral, Known (10), **Trusted (30)** and **Sworn (60)**. Trusted and Sworn earn perks:

| Faction | Trusted (30) | Sworn (60) |
|---|---|---|
| The Covens | +6% XP | Mana returns 8% faster |
| The Restless Dead | +7% attack | +10% defense |
| The Order of the Pale Flame | +12% gold | another +12% gold |

- **Balance:** simulated players (`FACTION=covens|dead|order EMPOWER=1 node tools/balance-sim.js …`) reach Level 30 faster than one who never picks a side: Covens 17.9%, Dead 15.6%, Order 8.8%, of which about 6% is empowering alone. The Covens and the Dead speed levelling (Mana and XP; attack and defense); the Order pays in gold instead (its simulated player ended with about 3.4× the gold of the baseline). The first numbers (+10% XP and Mana 25% faster for the Covens, a crossroads every 12 schemes) made the Covens 28% faster, so perks were cut and crossroads spaced out.
- Every choice is zero-sum between two factions, so you can't be Sworn to all three. The **Factions** tab (between Thralls and Lairs) shows each faction's standing, tier and perks. Standing is kept through rebirth.
- Achievements: **A Choice at the Crossroads** (first choice, 200 gold) and **Sworn** (5,000 gold).
- Content lives in `FACTIONS` and `CROSSROADS` in `content.js`; a content test checks every crossroads sets two different rival factions against each other and pays gold or XP.

### Empowered gear
In the Hoard, **Empower** melts a spare copy of an item and gold into it. Each rank adds 20% of the item's own bonuses, up to **rank 5** (double). Rank *n* costs the item's value × 2*n* gold, so an Ebony Staff (worth 120) costs 240, 480, 720, 960 and 1,200. The card shows stars and the empowered bonuses next to the originals; the button's tooltip says what the next rank gives. Selling the last copy loses the rank, and ranks reset with the hoard on rebirth. Achievement: **Master Artificer** (rank 5, 3,000 gold). Formulas: `empowerCost` and `empoweredEffect` in `formulas.js`.

### Festivals
Three more fill the longest gaps in the year, for eight in all: **Feast of Candles** (Feb 1–14, the Candle-Wraith, Wraith-Wax Stub: +10 defense, +4% XP), **The Thaw** (Mar 18–31, the Meltwater Drowner, First Thaw-Bloom: +7% gold) and **Night of Falling Stars** (Aug 8–20, the Star-Reader, Fallen Starstone: +15 attack, +4% gold). Festivals now wait until **Level 5**, when the champion is a fair fight. Achievement: **The Wheel of the Year** (claim 8 talismans, 8,000 gold).

### A smoother start
- A new **Chapter 2, A Wand of Your Own**: buy the Blackthorn Wand before the first duel (without it a new magician wins about 16% of duels against the first foe). Chapters are now 22; returning players are credited as usual.
- Once you've read the current chapter, the story bar's button takes you where its goal is done (**Go to Sanctum**, **Go to Duels**…).
- With festivals waiting until Level 5, a new player sees only the guide, the nightly tithe and the story bar above the tabs. The Thralls stat mentions lieutenants only once one can be recruited.

### Sigils and atmosphere
`art.js` holds hand-drawn line sigils (inline SVG in `currentColor`) for the five regions, five nemeses and three factions, shown beside the region description and on nemesis and faction cards. The sky's glow and a few slow drifting motes follow the region you scheme in: violet sparks in Hollowmere, fireflies in the Witchwood, embers in the Ashen Wastes, bubbles in the Drowned Archive, cold stars at the Black Spire. The motes stop for `prefers-reduced-motion`, and the game runs without `art.js` if it fails to load.

### Save
`saveVersion` is 12: `factions: { standing, pending, sinceLast, choices, recent }` and `gearRanks: { itemId: rank }`. Older saves get both with defaults and one chronicle line. A save still carrying Ruin Wars' default name, **Knight**, is renamed **Magician** on load (a name you chose is kept).

## v2.4 — Polish pass

No rule or number changed; this pass is about reading the game at a glance, on phones above all.

- **Rank badges:** a scheme or spell you have done but not yet Practiced reads **Novice** instead of Untried (in its badge and in the chronicle line). Untried now only means never done.
- **Mastery bonus:** "bonus +2%g / +0%xp" now reads "bonus +2% gold" and leaves out zero parts. The Hoard's equipment line does the same, and says "no bonuses yet" when you have none.
- **Tab bar on phones:** when tabs are hidden off either side, that edge fades out, and the open tab is always scrolled into view (also after a reload).
- **Toasts** rise from the bottom of the screen instead of covering the header and the sticky tab bar, have one width, and a burst (such as a returning player's catch-up) shows only the newest three.
- **Achievements** sit two to a row on phones (more on wider screens), with the progress bar on its own line.
- Figures such as "dmg 4–10", "+12 gold" and "Requires Level 20" no longer break across lines.
- **Thralls count one way everywhere:** the stat at the top shows bound thralls against your level cap (e.g. 8 / 20, it showed 8 / 23 with lieutenant slots added in), with lieutenants on the line below; the Thralls tab reads "Bound: 8 / 20 · Lieutenants: 0 / 3".
- The first-scheme achievement is now **First Scheme** (it was "First Spell", which clashed with the Spellbook and the story's First Spell).

## v2.3 — Expelled

The dark-magician game split off from Ruin Wars into this repo, under its own name. Nothing in play changed.

- **Your save carries over.** Expelled saves to `expelled_save_v1`. On first load with no Expelled save, it reads the Ruin Wars save (`ruin_wars_save_v4`), says so once in the chronicle, and saves it under the new key; the old copy is left untouched.
- **Preferences carry over too:** the `expelled_tab`, `expelled_sound`, `expelled_music` and `expelled_guide_seen` keys fall back to their `ruin_wars_*` versions.
- **Backup codes** now start `EX1.`; codes copied under Ruin Wars (`RW1.`) still load.
- Script globals are `window.Expelled`, `window.ExpelledContent` and `window.ExpelledFormulas`.

## v2.2 — The Tale and the Black Spire

### The story
22 chapters in five acts take the magician from the gutters of Hollowmere to the top of the Black Spire, where the Archmage of the White College signed their expulsion. The current chapter, its goal and progress sit in a bar under the stats; **Read** opens **The Tale** in the Chronicle, which shows every finished chapter and the current one (later chapters stay hidden). Finishing a chapter pays gold and opens the next; the last one shows an epilogue.

| Act | Chapters | Goals |
|-----|----------|-------|
| I · Hollowmere | Cast Out · A Wand of Your Own · A Voice in the Drains · A Name in the Circle · The Burning Ledger | first scheme; buy the Blackthorn Wand; Bind a Sewer Imp; 10 duels won; Steal the Expulsion Ledger |
| II · The Witchwood | Under the Hanging Lanterns · The Witch of the Weir · The Warrant · The Coven Mother · What You Are | Level 10; the Weir ×5; the Witch-Hunter General; the Coven Mother's Glamours; the Root-Bound Grimoire |
| III · The Ashen Wastes | The Cinder Road · An Army of the Dead · The Lich of Ashvault · The Obsidian Throne · Wyrmsong | Level 20; 25 thralls; the Lich; Claim the Obsidian Throne; the Bone Wyrm |
| IV · The Drowned Archive | Under the Grey Sea · A Reader's Ticket · The Founder · The First Spell | Level 35; Wake the Librarians ×5; the Drowned Archmage; Read the First Spell |
| V · The Black Spire | The Black Spire · Everything They Took · Expelled No More | Level 45; Crack the Vault of Confiscated Spells; the Archmage |

Rewards grow from 100 gold to 300,000. Goals use the same checks as achievements (plus `questCount` for one scheme), so a returning magician is credited with every chapter already behind them on first load (one chronicle line). The Chronicle tab shows a dot while the current chapter is unread. Chapters live in `CHAPTERS` in `content.js` (with `ACT_NAMES` and `EPILOGUE`); a content test checks every goal points at a real scheme or nemesis and that level-gated chapters come in level order. Saved under `story: { done, seen }`, kept through rebirth; `saveVersion` is 11.

### The Black Spire (Level 45)
The White College's hidden tower, and the fifth region (`spire`).

- **Schemes** (Level 45–52, 58–76 Mana, 4,000–6,500 gold, 2,900–4,300 XP, 8–10 min rests, 45–52 thralls): Break the Warded Gate, Rob the Forbidden Library, Turn the College's Students, Crack the Vault of Confiscated Spells, Walk the Hall of Mirrors, Climb to the Archmage's Study, each with three new secrets.
- **Rivals**: Spire Sentinel (45, power 650), Bound Storm Elemental (47, 700), College Battle-Magus (49, 760), the Archmage's Shadow (51, 830).
- **Loot**: Stormglass Wand / Staff of the Seventh Circle / the Archon's Scepter (+130 / +160 / +200 attack), Proctor's Grey Robes / Magister's Starcloak / Vestments of the Inner Circle (up to +44% gold, +150 def, +40 atk), three talismans.
- **Nemesis — the Archmage of the White College** (Level 50): 60,000 HP, 120 HP/min regen, 14 Will per strike, counter 34–58, returns after 3 h. Kill: 90,000 gold, 30,000 XP, **Crown of the White College** (talisman: +15% gold, +15% XP, +40 atk, +40 def) and a page of **the Archmage's Codex** (grimoire: +30 attack, +30 defense, +10% gold, +10% XP).
- **Lair**: the College's Tithe-Rolls (Level 45, 60,000 gold, +2,200 gold / 6 min).
- **Achievements**: At the Foot of the Spire (Level 45), Expelled No More (the Archmage), The Tale Is Told (every chapter).

## v2.1 — The Spellbook

A **Spells** tab (second tab) holds eight spells, learned by level and cast with **Mana**, so every cast is Mana not spent on a scheme. Each spell then rests for its cooldown. Buffs last a set time or a number of uses and can't be stacked; instants apply at once. Active buffs show as chips under the tab bar.

| Spell | Level | Mana | Recast | Effect (Untried) |
|-------|-------|------|--------|------------------|
| **Hex of Misfortune** | 2 | 8 | 1m 30s | +25% power in your next duel (festival duels too) |
| **Blood Mending** | 4 | 12 | 5m | Restore 30% of your Health |
| **Quicken the Hours** | 6 | 10 | 15m | For 5m, schemes you start rest 40% shorter |
| **Bone Servant** | 9 | 18 | 15m | For 10m, +12% attack and defense |
| **Scry the Nemesis** | 12 | 25 | 20m | +30% damage on your next 5 nemesis strikes |
| **Gilded Tongue** | 15 | 25 | 45m | For 30m, +25% gold |
| **Siphon Will** | 18 | 30 | 20m | Restore 15 Will |
| **Dark Insight** | 22 | 25 | 45m | For 30m, +25% XP |

- **Mastery:** every cast counts. At 10 / 30 / 100 casts a spell becomes Practiced / Adept / Master, and its effect is multiplied by ×1.25 / ×1.5 / ×1.75 (`spellRank` and `spellPotency` in `formulas.js`). Mastery is kept through rebirth; active spells and cooldowns are not.
- New spells are announced on level-up, and the Spells tab shows a dot while you know a spell you have never cast. Duel cards say **(hexed)** while a Hex is waiting.
- Achievements: *First Incantation* (cast a spell) and *Master of the Word* (master one).
- **Balance (v2.2):** Mana is the bottleneck, so a spell has to earn back the schemes its Mana would have paid for. With the first numbers, a simulated player casting every ready spell levelled 2–11% *slower* than one casting none. Gilded Tongue and Dark Insight now last 30 minutes for 25 Mana (recast after 45), and Quicken costs 10. A simulated player who casts only what pays off (economy buffs; Bone Servant and Scry while a nemesis is up; no Hex) now reaches each milestone 1–12% sooner than one who casts nothing, with the biggest gain early (first nemesis kill 12% sooner), and ends Level 36 with about 60% more gold. Re-run with `SPELLS=smart node tools/balance-sim.js …`.
- Spells live in `SPELLS` in `content.js` (effects: `duelPower`, `cooldownCut`, `attackPct`, `defensePct`, `nemesisDamage`, `goldMult`, `xpMult`, `healPct`, `restoreWill`); a content test checks every spell's kind, effects and limits. Saved under `spells: { casts, cooldownUntil, active }`; `saveVersion` is 10.

## v2.0 — The Dark Magician

A full retheme. You are a magician expelled from the White College, rising from the canal city of **Hollowmere** through **the Witchwood** and **the Ashen Wastes** to **the Drowned Archive**, the sunken library of the first sorcerers. Every scheme, rival, nemesis, item, grimoire page, lair, achievement and festival has new names and descriptions, and all 72 mastery secrets and 4 nemesis legends are new writing.

- **Look:** witchfire violet on ink-black, with gold kept for coin and cold blue for Mana; headings in IM Fell English (Google Fonts, falling back to Georgia offline); a new watching-eye sigil for the app icon.
- **Music:** the loop moves from D dorian to D harmonic minor (Dm – B♭ – Gm – A).
- **Saves carry over.** Ids are unchanged (see the note at the top of `content.js`), so levels, items, thralls, lairs, achievements and festival progress all keep working. Secrets unlocked under the old theme are shown with their new text, looked up by id. Old saves get one chronicle line explaining the retelling. `saveVersion` is 9.

The version notes below were written for the Arthurian theme. This table maps their names to the current ones (internal ids in brackets):

| Old (v0.3–v1.0) | Now |
|-----------------|-----|
| Knight | Magician |
| Energy / Stamina | Mana / Will |
| Quests, quest board | Schemes |
| The Lists, bouts | The Dueling Circle (Duels tab), duels |
| Chapel Rest: Small Poultice / Full Rest | The Apothecary: Bitter Tonic / Sleep in the Crypt |
| Bosses | Nemeses |
| Knight Band, sworn knights, Muster Horn | Thralls, enthralled servants, Raise the Dead |
| Named knights: Sir Gawain / Sir Percival / Sir Lancelot | Lieutenants: Grimalkin / Sister Vell / Sir Ormund, the Lich-Knight |
| Holdings | Lairs |
| Gear / Inventory; weapon / armor / relic | Hoard; focus / vestments / talisman |
| Collections, pieces, Redeem | Grimoires, pages, Bind |
| Armory & Relics; Training | The Sanctum; Studies |
| Tempered Blade / Cloak of Rest / Banner of Valor | Blackthorn Wand / Moonstone Ring / Forbidden Primer |
| Whetstone / Shield-Wall Drills, Steward's Ledger, Scholar's Tomes, Provisioner's Wagon | Hexcraft / Warding Drills, Cutpurse Familiar, Midnight Study, Deepen the Mana Well |
| Renown, begin a new legend; Legends | Infamy, be reborn; Secrets |
| Mastery: Unproven / Proven / Veteran / Master | Untried / Practiced / Adept / Master |
| Daily tribute | Nightly tithe |
| Seasonal tourneys, tokens | Festivals, favors |
| Camelot (`camelot`) | Hollowmere |
| Avalon (`avalon`) | The Witchwood |
| The Wastes (`wastes`) | The Ashen Wastes |
| Lyonesse (`lyonesse`) | The Drowned Archive |
| The Green Knight (`green_knight`) | The Witch-Hunter General |
| Mordred (`mordred`), Clarent | The Lich of Ashvault, Staff of Ashvault |
| The Questing Beast (`questing_beast`) | The Bone Wyrm |
| The Drowned King (`drowned_king`), Bell of Lyonesse | The Drowned Archmage, The First Grimoire |
| Beltane Fires / Midsummer Tourney / Harvest Tourney / The Wild Hunt / Yuletide Game | Walpurgis Night / Midsummer Eclipse / Harvest Moon / All Hallows' Eve / The Longest Night |

Every quest, foe, item and achievement name is in `content.js`, next to its id.

## v1.0

### Lyonesse (Level 35)
The drowned land past Cornwall: a fourth quest board, foes, loot tier, collection, boss and holding.

| Quest | Level | Energy | Gold / XP | Cooldown | Needs |
|-------|-------|--------|-----------|----------|-------|
| Walk the Tide Road | 35 | 38 | 1,900 / 1,500 | 5.5 min | 32 knights |
| Ring the Drowned Bells | 36 | 41 | 2,150 / 1,700 | 5.75 min | weapon |
| Escort Tristan's Ship | 38 | 44 | 2,450 / 1,900 | 6 min | 35 knights |
| Hold the Last Sea-Wall | 40 | 47 | 2,800 / 2,150 | 6.5 min | 38 knights, armor |
| Bargain with the Merrow-Queen | 42 | 51 | 3,200 / 2,400 | 7 min | 40 knights |
| Raise the Lost City | 45 | 55 | 3,600 / 2,700 | 7.5 min | 44 knights, weapon, armor |

- **Foes**: Drowned Sentinel (35, power 440), Reef Knight (38, 490), Sea-Witch of the Scillies (41, 545), King Mark's Champion (44, 600).
- **Loot**: Tidewrought Blade / Coral-Hilted Sword / Trident of the Drowned King (+60 / +80 / +105 attack), Kelp-Woven Mail / Pearl Scale / Armor of the Sea-Wall (up to +26% gold, +62 def, +22 atk), and three relics.
- **Boss — the Drowned King** (Level 42): 30,000 HP, 70 HP/min regen, 12 Stamina per strike, counter 26–46, returns after 2 h. Kill: 45,000 gold, 15,000 XP, **Bell of Lyonesse** (relic: +12% gold, +12% XP, +25 def) and a Lyonesse piece.
- **Collection — Treasures of Lyonesse**: +20 attack, +20 defense, +10 max Energy.
- **Holding — Coastal Tin Mine** (Level 35, 24,000g, +900g / 5 min).
- Achievements: *Under the Tide* (reach Level 35), *Let Them Ring* (slay the Drowned King).

### Seasonal tourneys
Five events by local calendar date (`EVENTS` in `content.js`; dates are inclusive and may cross New Year):

| Event | Dates | Champion | Relic for 10 tokens |
|-------|-------|----------|---------------------|
| Beltane Fires | Apr 28 – May 5 | Bonfire Champion | Beltane Garland (+6% XP) |
| Midsummer Tourney | Jun 18 – Jun 30 | Tourney Champion of Caerleon | Lady's Midsummer Favor (+6% gold, +10 atk) |
| Harvest Tourney | Sep 22 – Oct 12 | Michaelmas Champion | Golden Harvest Sheaf (+8% gold) |
| The Wild Hunt | Oct 28 – Nov 4 | Huntsman of the Wild Hunt | Horn of the Wild Hunt (+20 atk, +10 def) |
| Yuletide Game | Dec 20 – Jan 6 | Green Knight's Herald | Yule Holly Crown (+5% gold, +5% XP) |

While one runs, a banner under the stats shows its progress and the champion tops The Lists. The champion always matches your strength (power = 1.05 × your attack, about 45% odds), costs 10 Stamina, rests 3 minutes between bouts, and pays `20 + 15 × level` gold and `20 + 12 × level` XP. Each win is a token; at 10 tokens, **Claim reward** grants the event relic, once per event per year. Progress is saved per event and year (`events["harvest-2026"]`) and kept through Renown. Achievement: *Festival Knight*. The date logic is `activeEvent()` in `formulas.js`, unit-tested, and a content test checks no two events overlap.

### Balance pass
`tools/balance-sim.js` plays the real game in a headless browser under a fake clock: it buys upgrades, hires, equips, heals, strikes bosses, fights and quests, and logs when each milestone happens. Its first run found that the old XP curve let one quest earn a whole level, and since each level-up refills Energy, a knight could chain to Level 30 in minutes. Changes:

- **XP per level** is now `40 + 8 × level^2.5` (was `35 + 22 × level + 6 × level^1.15`): Level 10 needs 2,569 XP (was 339), Level 30 needs 39,476 (was 994).
- **Training caps** raised so late gold has somewhere to go: Whetstone and Shield-Wall 40 ranks, Ledger and Tomes 30, Wagon 15.
- **Tourney champion** pays half what it first did, so it's a bonus rather than the best farm.

Simulated nonstop play after the changes (a lower bound; casual players take far longer):

| Milestone | Time |
|-----------|------|
| Level 10 | 25 min |
| Green Knight first kill | 1.2 h |
| Level 20 | 5.3 h |
| Mordred first kill | 12.5 h |
| Level 30 | 18.6 h |
| Questing Beast first kill | 23.3 h |
| Level 35 (Lyonesse) | 28.9 h |

Re-run it after balance edits: serve the folder, then `node tools/balance-sim.js http://localhost:8765/ 80 out.json` (needs Playwright; `STOP_LEVEL` picks where it stops).

### Code review fixes
Music saved as on now starts on phones; a kept unreadable save is never overwritten; repeated chronicle lines refresh the ticker; daily-tribute gains float from the Gold stat; ticks render only the open tab; the Blade tip reads its numbers from content; one shared weighted-random pick; one pair of per-browser setting helpers; the service worker waits for its offline copy to be written.

## v0.9

### How to play
New knights (Level 3 or below) see a five-step guide above the stats until they press **Got it**; **How to play** in the header brings it back. Dismissing it is remembered per browser (`ruin_wars_guide_seen`).

### Achievements
Achievements (25 at v0.9, 28 with v1.0) live in `content.js` (`ACHIEVEMENTS`) and show in the Chronicle tab with progress bars. Each pays its gold once, is announced with a banner and a chime, and is kept through Renown. Checks: quests completed, quests at Master rank, level, bouts won, upset wins (odds under 30%), each boss slain, band size, all named knights, all holdings, collections redeemed, training ranks, Renown, and a 7-day tribute streak. Older saves are credited for deeds already done on first load (one summary line).

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
| **Whetstone Drills** | +4 attack | 150 | ×1.35 | 40 (20 before v1.0) |
| **Shield-Wall Drills** | +4 defense | 150 | ×1.35 | 40 (20 before v1.0) |
| **Steward's Ledger** | +3% gold | 250 | ×1.4 | 30 (20 before v1.0) |
| **Scholar's Tomes** | +3% XP | 250 | ×1.4 | 30 (20 before v1.0) |
| **Provisioner's Wagon** | +3 max Energy | 400 | ×1.5 | 15 (10 before v1.0) |

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

Unit tests are plain Node with no dependencies (Node 18+). Browser tests drive the real game in headless Chromium through Playwright, a dev dependency:

```bash
npm test                    # unit tests: node --test over tests/*.test.js
npm install                 # once, for the browser tests
npx playwright install chromium   # once, if you don't have Playwright's Chromium yet
npm run test:browser        # browser tests: e2e/*.e2e.js
```

- `tests/formulas.test.js` — XP curve, quest cooldowns, seasonal event dates (including across New Year), fight odds and upset bonus, defense soak, training costs, band cap / hire cost, time-until-full, backup code round-trips, daily tribute dates / streak / gold.
- `tests/content.test.js` — sanity checks on `content.js`: unique ids, quests in real regions with a story beat at every mastery rank, band requirements reachable at each quest's level, 3 weapons / 3 armors / 3 relics per region, every boss drops a real unique and collection piece and has a legend, named-knight boss bonuses point at real bosses, foes get harder and pay more with level, achievements use known checks with reachable targets, and seasonal events have valid dates, real rewards and never overlap.

- `e2e/game.e2e.js` — a new game and its first scheme, tabs and the remembered tab, rename / reset with `prompt()` / `confirm()` blocked, backup round-trip and rejection, an old Arthurian-era save loading with its progress and new-theme Secrets, a festival won and claimed under a fake clock, rebirth keeping Infamy / achievements / spell mastery, and the service worker reloading the game offline.
- `e2e/story.e2e.js` — Chapter 1, the wand chapter and its Go to Sanctum signpost, reading clears the dot, a returning save credited with chapters 1–13, the Black Spire's schemes and nemesis at Level 45, and the Archmage ending the tale with the epilogue.
- `e2e/factions.e2e.js` — a crossroads appearing after 20 schemes and a choice moving two factions, crossroads waiting for Level 5 and one at a time, a perk earned at Trusted and shown in the Factions tab, standing kept through rebirth.
- `e2e/hoard.e2e.js` — empowering with a spare and gold, the rank's bonuses, rank 5 and Master Artificer, and selling the last copy losing its rank.
- `e2e/spells.e2e.js` — spells unlocking by level, Hex raising odds and being spent by one duel, Quicken / Blood Mending / Gilded Tongue, mastery potency and buffs wearing off, First Incantation.

Every browser test also fails on any console or page error. `e2e/helpers.js` serves the repo on a local port and blocks Google Fonts so no test needs the network.

Run the unit tests after any balance edit in `content.js`. GitHub Actions runs both suites on every push and pull request.

## Hosting

`.github/workflows/ci.yml` runs the unit tests and the browser tests on every push and pull request. The game isn't published while the repo is private.

The game is a static site, ready to host anywhere. To publish it later on **GitHub Pages** (which needs a public repo, or a paid GitHub plan for a private one), add two jobs after `test` in `ci.yml`:

- **build-site** (on pushes to `main` only): copy `index.html styles.css formulas.js content.js art.js game.js manifest.webmanifest sw.js` and `icons/` into `_site/`, run `sed -i "s/__BUILD__/${GITHUB_SHA::7}/" _site/sw.js` so each release gets a fresh offline cache, then `actions/upload-pages-artifact@v3` with `path: _site`.
- **deploy**: `actions/deploy-pages@v4` with `pages: write` and `id-token: write` permissions and the `github-pages` environment.

Then set **Settings → Pages → Source** to **GitHub Actions**. (This workflow ran for v0.8–v0.9; see the history of `.github/workflows/ci.yml` before v1.0 for the exact jobs.) Installing as an app and offline play only work on such a hosted copy. Saves live in each browser, so a save from another copy of the game (a local file or the Claude artifact) moves over with **Backup → Copy my save / Load pasted save**.

## Code layout

| File | Role |
|------|------|
| `index.html` | Layout: header (rename / backup / reset dialogs), stats (incl. band), tab bar + ticker, then one tagged `data-panel` section per tab: quests + region tabs, Lists + Chapel, bosses, knight band, holdings, inventory, collections, shop, renown, chronicle + legends. Loads `formulas.js`, `content.js`, `art.js`, then `game.js`. |
| `styles.css` | Dark parchment / stone theme |
| `content.js` | **Content tables** (pure data, tune balance here), including `SPELLS`: `REGIONS` / `QUESTS` / `STORY_BEATS` / `BOSS_LEGENDS` / `MASTERY_BONUSES` / `FOES` / `HEALS` / `UPGRADES` / `RANKED_UPGRADES` / `HOLDINGS` / `LOOT` / `COLLECTIONS` / `BOSSES` / `NAMED_KNIGHTS` / `ACHIEVEMENTS` / `EVENTS` / `CHAPTERS` / `FACTIONS` / `CROSSROADS`. Exposed as `window.ExpelledContent`. |
| `formulas.js` | **Pure formulas** with no DOM or game state: `xpForLevel`, `questCooldownMs`, `fightWinChance(attack, power)`, `upsetMultiplier`, `soakDamage(dmg, defense)`, `rankedUpgradeCost(def, rank)`, `bandCap(level)`, `hireCost(recruits)`, `msUntilFull`, `encodeBackup` / `decodeBackup`, `empowerCost` / `empoweredEffect`. Exposed as `window.ExpelledFormulas`. |
| `art.js` | Sigils: inline SVG line drawings for regions, nemeses and factions. Exposed as `window.ExpelledArt`. |
| `game.js` | Game rules, state, save/load and rendering, built on the two files above |
| `tests/` | `node --test` unit suites for the formulas and content (see Tests) |
| `e2e/` | Browser tests with Playwright (see Tests) |
| `tools/balance-sim.js` | Simulated player for balance checks (see Balance pass) |
| `manifest.webmanifest`, `sw.js`, `icons/` | App install and offline play on the hosted site (see Install and offline play) |
| `.github/workflows/ci.yml` | Tests on every push / PR |

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
- **`save` / `load`** — `localStorage` key `expelled_save_v1` (`saveVersion: 11`); falls back to the Ruin Wars-era `ruin_wars_save_v4`, then legacy `ruin_wars_save_v1`, and migrates. Saves happen immediately after actions, at most every ~8s from the tick when something changed, and on `visibilitychange` (hidden) / `pagehide` / `beforeunload`. The last 50 chronicle lines are saved under `log` (optional; older saves load fine without it).
- **`window.RuinWars`** — DevTools helpers

## Save compatibility

v2.3 saves to `expelled_save_v1` with `saveVersion: 11`. With no Expelled save, it reads the Ruin Wars-era `ruin_wars_save_v4` (see [v2.3](#v23--expelled)). Older saves load as-is and gain the fields added since: `upgradeRanks: {}` (v0.5), `renown: 0` (v0.7), `achievements` / `stats` / `daily` (v0.9), `events: {}` (v1.0), `spells` (v2.1; v2.0 added none) and `story` (v2.2). Levels and XP carry over unchanged, so after the v1.0 XP curve an existing knight keeps their level and simply needs more XP for the next one. A save that can't be read is copied to `expelled_save_unreadable` (never overwritten) before the game starts fresh. If neither exists, the v0.3 save under `ruin_wars_save_v1` is loaded and migrated: missing fields (`region`, `collections`, `collectionsRedeemed`, `bosses`, `band`, plus the older `questCounts`, `storyUnlocks`, `holdings`, `inventory`, `equipped`) get defaults. The legacy key is left untouched, so rolling back to v0.3 still works. Use **Reset** for a clean slate.

## Suggested next features

1. Faction rewards to spend standing on: a sworn faction's own scheme, lieutenant or talisman.
2. Crossroads that remember earlier choices, so the factions' story branches.
3. A music theme per region, to match the region skies.

## License

Starter code for Dylan — use freely in the Expelled project.
