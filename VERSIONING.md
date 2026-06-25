# Versioning Guide — The Broken Flagon

This is the rulebook for how we track changes. It exists so the system stays
consistent over the long life of this project, no matter how much time passes
between sessions. Read it once; refer back when unsure.

---

## The three layers (and what each is for)

1. **Git** — the complete, automatic, line-by-line history. The source of truth.
   Answers "what *exactly* changed and when." You interact with it via a few
   commands (see `GIT_QUICKSTART.md`).

2. **`CHANGELOG.md`** — the curated human story, grouped by version. Answers
   "what features/fixes landed in each release." This is what you'd publish or
   read to remember the shape of the project.

3. **The in-game / in-code version sources** — this game displays its version to
   players and stores it in several places that **must agree**. When you bump the
   version, update ALL of these in the same commit:
   - `js/data.js` → `GAME_VERSION` constant (title screen + What's New popup)
   - `js/data.js` → `CHANGELOG` array (player-facing What's New entries)
   - `package.json` → `version` field
   - `manual.md` → version header (line ~5) + Version History section
   - `VERSION` → one-line machine-readable current version

> **Hard-won lesson:** these drifted out of sync once. During an audit the
> version was bumped to 2.0.0 in some places but not others, and the title
> screen disagreed with the What's New popup. Commit `03778b0` had to
> "Reconcile version to 1.12.0 throughout." Don't repeat that — bump every
> source together, in one commit, every time.

The dev **Bot Controller** is versioned separately inside `js/bot-controller.js`
(its own `BOT_VERSION` + changelog), because it iterates much faster than the
game and shouldn't drag the game's version number along with it.

---

## Version number scheme (Semantic Versioning)

Format: **MAJOR.MINOR.PATCH** — e.g. `0.5.2`

| Part | Bump when… | Example |
|---|---|---|
| **MAJOR** | A release milestone, or a change that breaks saves / compatibility. Stays `0` until the game is feature-complete enough for a `1.0`. | `0.x → 1.0` |
| **MINOR** | You add a new feature or system, backward-compatible. | new region, new class, new panel |
| **PATCH** | You fix a bug or tune balance — no new features. | stall fix, lowered a reward |

While the game is pre-`1.0`, treat MINOR as "notable new stuff" and PATCH as
"fixes and tuning." Don't agonize over the exact number — consistency matters
more than precision.

---

## The session workflow (what to actually do)

**Every work session, at minimum:**
```
git add -A
git commit -m "what you changed"
```
That alone keeps you fully protected. Everything below is the polish on top.

**While working**, jot finished items under `[Unreleased]` in `CHANGELOG.md`,
grouped under Added / Changed / Fixed / Removed.

**When you hit a milestone** worth calling a version, follow the
**release checklist** below so nothing drifts out of sync.

### Release checklist (do all of these in one commit)

1. `js/data.js` — bump `GAME_VERSION`.
2. `js/data.js` — add a new entry at the top of the `CHANGELOG` array
   (player-facing highlights, most recent first).
3. `package.json` — bump `version` to match.
4. `manual.md` — update the version header (~line 5) and add a Version History
   entry.
5. `VERSION` — update the one line.
6. `CHANGELOG.md` — move `[Unreleased]` items into a new dated version block.
7. Commit: `git commit -m "Release v1.X.0"`
8. Tag it: `git tag v1.X.0`  (a permanent bookmark in git history)

Missing any of 1–5 is how the title screen and What's New popup end up
disagreeing. The checklist exists specifically to prevent that.

---

## Writing good changelog entries

- One line. What changed, and *why* if it isn't obvious.
- Player-facing language for game features; plain language for fixes.
- Name the files touched in parentheses when it helps future debugging — but
  don't let it bloat the line.

**Good:**
- `Added frost elemental enemy to the Frost Peaks region (data.js, combat.js)`
- `Fixed Pit Goblin fame farm — diminishing returns after 3 wins`
- `Balance: Sunken Cathedral loot bonus 8% → 6% (was over-rewarding)`

**Too vague:**
- `Fixed stuff`
- `Updated data.js`

---

## Categories (use these headings in CHANGELOG.md)

- **Added** — new features, content, systems.
- **Changed** — changes to existing behavior that isn't a bug fix.
- **Fixed** — bug fixes.
- **Removed** — features or content taken out.
- **Balance** — (optional sub-use of Changed) tuning numbers without new systems.
- **Security** — if it ever applies (e.g. a save-exploit fix).

---

## What about file-level versions?

Most files don't need their own version stamp — git tracks them, and that's
enough. The exceptions, where an in-file version genuinely earns its place:

- **`bot-controller.js`** — has `BOT_VERSION` because it's a standalone tool that
  iterates fast and you query at runtime (`_bot.version()`).
- A future **engine/save-format** module *might* warrant one if save
  compatibility becomes version-sensitive.

Resist stamping a version into every file by hand. It's busywork that drifts out
of sync, and git already answers "what changed in this file" precisely via
`git log -- path/to/file.js`.

---

## Quick reference: "I want to…"

| Goal | Do this |
|---|---|
| Save my work this session | `git add -A` then `git commit -m "..."` |
| See what I changed | `git diff` (unsaved) or `git log --oneline` (history) |
| Undo a file to last commit | `git checkout -- file.js` |
| Go back to an old version to look | `git checkout <commit-id>` … `git checkout main` |
| Cut a new release | Update CHANGELOG.md + VERSION, commit, `git tag vX.Y.Z` |
| Back up off-machine | Set up a private GitHub repo, then `git push` |
