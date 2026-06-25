# Arena Rivals + Player Profile — Implementation Spec

## Feature 1: Arena Rivals

### Goal
Every champion remembers your head-to-head record. "Iron Warden (2-3)" appears
on the bout card and the fight banner. Story for free, different every fight.

### Data model
One new persistent field, auto-saved by the existing `saveMetaProgress()`
(which serializes all of `gameMeta`):

```js
gameMeta.rivals = {
  iron_warden:  { wins: 2, losses: 3, lastResult: 'loss', streak: -1, firstFought: 1699... },
  pit_tyrant:   { wins: 5, losses: 0, lastResult: 'win',  streak: 5,  firstFought: 1699... },
  // keyed by champion.id — captures excluded (no stable id)
}
```

- `streak`: positive = win streak, negative = loss streak. Drives flavor
  ("dominating", "nemesis").
- Only champions get records (stable `champion.id`). Captured creatures and
  gauntlets are excluded.

### Hooks (all in arena.js)

1. **Record the result** — in `resolveArenaBout(won)`, read
   `gameState.arenaBoutData.bout` BEFORE it's nulled, and if it's a champion,
   call `recordRivalResult(bout.data.id, won)`.

2. **`recordRivalResult(id, won)`** — new function. Initializes the record,
   bumps wins/losses, updates streak + lastResult, saves meta.

3. **`rivalRecordStr(id)`** → `"(2-3)"` or `''` if never fought.

4. **`rivalFlavor(id)`** → optional descriptor for streaks:
   - streak <= -3 → "Your nemesis"
   - streak >= 3  → "You dominate them"
   - wins>0 && losses>0 → "A bitter rivalry"
   - else '' (no clutter for fresh/one-sided-short matchups)

### Display

- **Champion bout card** (`renderArenaPanel`, champions section): append the
  record after the champion name, in muted gold. Add the flavor line under the
  difficulty label when present.
- **Fight start banner** (`startArenaBout`): if a record exists, change the
  intro message to reference it ("The Iron Warden remembers you. 2-3.").

### Cost
~45 lines in arena.js, 1 load-line in save.js (defensive — save already works),
~6 lines CSS. No new files.

---

## Feature 2: Player Profile Panel

### Goal
A single "who am I" shelf that consolidates the scattered meta-identity:
class/level, fame + title, renown, flagon coins, best floor, win/loss totals,
and a rivalries summary. Everything else can later reference it.

### Data — all already tracked
- `gameState.player`: className, subclass, level
- `getPitFame()`, `getPitTier().title`, `gameMeta.pitWins`, `gameMeta.pitBouts`
- `gameMeta.tavernRenown`
- `gameMeta.flagonCoins`, `getTreasuryLevel()`
- `gameState.bestFloor`
- `gameMeta.bossesSlain`, `gameMeta.stats.totalKills`, `gameMeta.totalGold`
- `gameMeta.rivals` (new) → summary: total rival wins/losses, top nemesis

### Structure
- New panel `#profile-panel` (fixed overlay, same pattern as treasury-panel).
- Opened via `openProfile()` / closed via `closeProfile()`.
- Button placed in the tavern hub and/or the character-select tavern buttons row.
- Rendered by `renderProfile()`.

### Sections
1. **Identity** — class crest, name, level, current title.
2. **Reputation** — Pit Fame + tier, Tavern Renown, Flagon Coins + Treasury lvl.
3. **Career** — best floor, total runs, deaths, bosses slain, total kills, gold.
4. **Rivalries** — record vs each champion fought, sorted by games played.

### Cost
~1 HTML block, ~120 lines JS (treasury.js-style module), ~140 lines CSS.
Read-only — no new persistent state of its own.

---

## Build order
1. Rivals data + hooks (arena.js) — invisible but recording.
2. Rivals display (arena.js + CSS) — now visible.
3. Profile panel (new profile.js + HTML + CSS) — consumes rivals + existing meta.
