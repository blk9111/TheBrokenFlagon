# Enemy Sprites

Enemies now render with image sprites, using the same load-and-fallback system
as the player and tavern NPCs. **The code is complete and works the moment art
exists in `sprites/`.** Until a given enemy has a sprite file, it automatically
falls back to its original colored-letter glyph — so the game always looks
correct whether or not the art is in place.

## How it works

- `data.js` preloads `sprites/<type>.png` for each enemy type (goblin, slime,
  skeleton, archer, brute, cultist, thief, warden) into `ENEMY_SPRITES`,
  fire-and-forget. A missing or broken file silently leaves that type on its
  glyph fallback — no errors, no broken-image icons.
- `render.js` (`drawEnemy`) draws the sprite when available: scaled to the tile,
  anchored at the feet, with a ground shadow, a horizontal flip so the enemy
  faces the player, and the existing hit-flash applied as a tint clipped to the
  sprite. All existing effects (idle bob, attack lunge, telegraph glow, status
  icons, health bar) are preserved.
- Bosses intentionally have **no** sprite yet and keep their aura/ring
  treatment. Add boss art later by extending `ENEMY_SPRITE_SRC` and removing the
  `isBoss ? null :` guard in `drawEnemy`.

## File requirements

| Property    | Value |
|-------------|-------|
| Location    | `sprites/` folder in the game root (next to `index.html`) |
| Filenames   | `goblin.png`, `slime.png`, `skeleton.png`, `archer.png`, `brute.png`, `cultist.png`, `thief.png`, `warden.png` |
| Dimensions  | ~280×308 px (matches the player/NPC art). Any portrait aspect works — the renderer scales by aspect ratio. |
| Format      | PNG with transparent background, full standing figure, feet near the bottom edge |
| Style       | Match the player/NPC art for consistency |

## The included placeholder sprites

The `sprites/` folder here contains simple geometric placeholder art for all
eight enemy types. **These are proof-of-pipeline test fixtures, not final art** —
they confirm the rendering (scale, shadow, facing, flash) works end-to-end.
They read clearly but won't match the quality of the hand-painted player and NPC
sprites. Replace each one with real art at the same dimensions and filename, and
it appears in-game immediately with no code change.

## To add real art later

1. Create or commission a 280×308 PNG per enemy in the player's style.
2. Name it `<type>.png` and drop it in `sprites/`.
3. That's it — no code change. The new art replaces the placeholder (or the
   glyph fallback) on next load.
