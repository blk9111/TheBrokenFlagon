# Changelog — The Broken Flagon

All notable changes to this game are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and the
project uses [Semantic Versioning](https://semver.org/): **MAJOR.MINOR.PATCH**

- **MAJOR** — a release milestone or a change that breaks saves/compatibility
- **MINOR** — a new feature or system, backward-compatible
- **PATCH** — a bug fix or balance tuning, no new features

> **Sources of version truth (keep these in sync):**
> - `js/data.js` → `GAME_VERSION` (drives the title screen + in-game What's New popup)
> - `js/data.js` → `CHANGELOG` array (the player-facing What's New entries)
> - `package.json` → `version`
> - `manual.md` → version header + Version History section
> - `VERSION` → one-line machine-readable current version
> - this file → the full developer-facing history
>
> When you bump the version, update **all** of these so they agree. The
> `03778b0` commit ("Reconcile version to 1.12.0 throughout") is the cautionary
> tale — they drifted out of sync once and had to be reconciled.

---

## [Unreleased]

_Work not yet cut into a version. Add new entries here as you go._

### Added
-

### Changed
-

### Fixed
-

---

## [1.13.0] — 2026-06-25

The "progression & atmosphere" release. Added several interlocking arena/tavern
progression systems, regional dungeon theming, a run-scoped Monster Stable, and
a heavily upgraded dev bot for automated balance testing.

### Added
- **Arena Rivals** — persistent per-champion head-to-head records
  (`gameMeta.rivals`), shown on bout cards, the fight banner, and the profile.
  (`js/arena.js`, `js/save.js`, `style.css`)
- **Player Profile panel** — read-only identity/reputation/career shelf with an
  arena-rivalries summary; opens from the character-select tavern row.
  (`js/profile.js`, `index.html`, `style.css`, `js/main.js`, `js/data.js`)
- **Champion Intros** — Pit Master patter before bouts; full crawl on first
  encounter and always for bosses, one-liner on repeats; skippable.
  (`js/arena.js`, `style.css`)
- **Tavern Reputation reactions** — the room reacts to your Pit title on entry.
  (`js/data.js`, `js/tavern.js`, `js/main.js`)
- **Random Patrons** — ambient overheard dialogue on tavern entry (~55%), some
  personalized to best floor. (`js/data.js`, `js/tavern.js`)
- **Titles + Hall of Legends** — 11 earned titles (incl. Nemesis Slayer, tied to
  Rivals) plus records and live Pit rank in a full-screen panel.
  (`js/trophy-hall.js`, `js/data.js`, `index.html`, `style.css`, `js/main.js`)
- **Regional dungeon theming** — four named depth bands (Ashen Crypt 1-25,
  Forgotten Mines 26-50, Sunken Cathedral 51-75, Frost Peaks 76-100) with
  weighted enemy pools, transition banners, and a stacking loot bonus. Provably
  floor-safe. (`js/data.js`, `js/dungeon.js`, `js/tavern.js`, `js/ui.js`,
  `style.css`)
- **Monster Stable (run-scoped)** — manage captures with Fight / Sell / Release /
  Display; captures still lost on death (zero balance risk).
  (`js/stable.js`, `js/arena.js`, `index.html`, `style.css`, `js/main.js`,
  `js/data.js`)

### Changed
- `chooseEnemyType()` reweights floor-eligible enemies by region without
  altering the floor-gating ladder. (`js/dungeon.js`)
- `rollRarity()` now stacks region loot bonus + Ironman bonus via one
  "shift out of common" mechanic; probabilities always sum to 1.0.
  (`js/dungeon.js`)
- Tavern entry plays a reputation/atmosphere beat on run-start and portal return.
  (`js/main.js`, `js/tavern.js`)

### Dev tooling (not player-facing)
- **Bot Controller** advanced to **v2.4.0** (its own version line in
  `js/bot-controller.js`): display modes (Full/Minimap/Headless), live FPS,
  expanded session stats, wall-clock stall watchdog, bot-only ability cooldown,
  crash-proof run persistence, loop-batch mode, CSV download. Display-mode canvas
  suppression now enforced per render frame (`js/ui.js`). See `_bot.version()`
  for that tool's full changelog.

---

## [1.12.0] and earlier

Versions up to 1.12.0 predate this developer-facing changelog file. Their
history is preserved in two existing places and is **not** duplicated here to
avoid drift:

- **In-game What's New** (`js/data.js` → `CHANGELOG` array) — player-facing
  highlights for 1.12.0, 1.11.0, 1.10.0, 1.9.0, …
- **`manual.md` → Version History** — the fuller writeups (tracked from 1.5.0
  onward; not tracked before 1.5.0).

Headline summary of recent prior versions, for quick orientation:

- **1.12.0** — overland zones came alive (forage, travelling merchants,
  ambushes, mini-events); Return-to-Tavern portal system; town-service fixes;
  arena/boss balance pass; sweeping visual & UX overhaul. (Note: a 2.0.0 was
  briefly tagged during an audit and deliberately reverted to 1.12.0 so the
  title screen and What's New popup agree — see commit `03778b0`.)
- **1.11.0** — the world opened up: 5×5 overland map, Bravehold, roads, ambient
  forest/road zones, touch controls + key rebinding, global leaderboard.
- **1.10.0** — Arena Seasons (Bronze→Champion), Gauntlet mode, 7 elite enemies,
  Mimics, Dungeon Events, Tavern Renown, the Casino, illustrated Storybook.

---

## Versioning notes

- The game is past 1.0; treat MINOR as new systems and PATCH as fixes/tuning.
  A future MAJOR (2.0) is reserved for a true milestone — and last time 2.0 was
  used prematurely it was reverted, so reserve it deliberately.
- The dev **Bot Controller** keeps its **own** version line (currently v2.4.0)
  in `js/bot-controller.js`, since it iterates far faster than the game. Its
  changelog lives in that file and is surfaced via `_bot.version()`.
