# The Broken Flagon — Tests

Characterization tests ("tripwires") around the three systems most expensive to break:
**seed determinism**, **save round-trip / migration**, and the **arena bout lifecycle**.
They are not coverage tests — they exist to catch silent regressions before they corrupt a
player's run or break the "share a seed" promise.

## Running in the browser (no tooling)

1. Place `tests.html` in the **game root** (the folder containing `index.html` and the `js/` subfolder).
2. Open `tests.html` in a browser.
3. Green summary = all tripwires pass. Failures show the assertion and a detail line.

This loads the real game scripts from `js/` in their native environment, so it tests the
actual shipping code.

## Running headless (command line / CI)

Requires Node and `jsdom` (`npm install jsdom`).

```
node run-tests.cjs
```

Exits 0 if all pass, 1 on any failure — suitable for a pre-commit hook or CI step.

Note: a `loadActiveRun failed: SyntaxError…` line may print during the
"rejects outright garbage" test. That is the game's own error handler logging the
deliberately-malformed save; the test asserts it returns `false` rather than throwing.
It is expected and not a failure.

## What's covered

**Seed determinism**
- Identical seed → identical `rng()` sequence
- Different seeds → different sequences
- Seed code round-trips (`seedToCode` → `codeToSeed`)
- Identical seed → identical dungeon layout

**Save round-trip**
- Active run survives `saveActiveRun()` → `loadActiveRun()` (player, floor, inventory)
- Save carries the `v: 1` version field
- `bestFloor` persists via `localStorage` (and confirms `window.storage` is gone — the
  packaging blocker from the audit)

**Save migration & robustness**
- Rejects an unknown/future save version cleanly
- Rejects a structurally invalid save without throwing
- Rejects non-JSON garbage without throwing

**Arena bout lifecycle**
- `isArenaUnlocked()` respects the `bestFloor >= 20` gate
- Win restores the world and awards gold + fame
- Non-ironman loss leaves the player alive at 1 HP (does not end the run)
- A captured creature is consumed when its bout begins

## Adding tests

Open `tests.html`, find the `describe(...)` blocks near the bottom, and add `it('name', () => { ... })`
cases using `assert`, `eq`, and `deepEq`. Re-run either way (browser or `node run-tests.cjs`).
