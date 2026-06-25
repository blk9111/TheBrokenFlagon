// render.js — Core coordinator, camera, draw loop, and performance caches.
// Loads first. All functions in the four sibling modules below are called
// from draw() here at runtime (after all scripts have loaded).
//   render-tiles.js    — tile textures, dungeon map, lighting, fog
//   render-tavern.js   — tavern interior scene
//   render-entities.js — player, enemies, items, effects system
//   render-world.js    — market/courtyard, town, arena outworld scenes


// ══════════════════════════════════════════════════════════════════════════════
// RENDER PERFORMANCE CACHES
// These avoid re-scanning the full 25×18 tile grid every frame for the handful
// of tiles that actually matter (exits, special tiles). The cache is keyed by a
// signature that changes whenever the floor or its revealed-state changes, so it
// rebuilds exactly when needed and is otherwise free to reuse.
// ══════════════════════════════════════════════════════════════════════════════
let _exitTileCache = { sig: null, tiles: [] };

// Build/return the list of exit tiles (down-stairs, ascend, tavern-exit) on the
// current floor. Re-scans only when the floor changes or new tiles are revealed.
function _getExitTiles() {
    // Signature: floor + a cheap revealed-count + the floor-0 sub-zone flags.
    // Revealing a new tile can expose a new exit (revealed count), and on
    // floor 0 the dungeon grid swaps between tavern/courtyard/town/arena
    // without the floor number changing — so those flags must be in the key
    // too, or a stale exit list would render after a zone transition.
    const wp = gameState.worldPos;
    const zoneKey = gameState.floor === 0
        ? `${gameState.inCourtyard?1:0}${gameState.inTown?1:0}${gameState.inArena?1:0}${wp?wp.row:'-'}${wp?wp.col:'-'}`
        : '';
    const sig = `${gameState.floor}:${gameState._revealedCount || 0}:${zoneKey}`;
    if (_exitTileCache.sig === sig) return _exitTileCache.tiles;
    const tiles = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (!gameState.revealed[y]?.[x]) continue;
            const tile = gameState.dungeon[y][x];
            if (tile === 2 || tile === TILE_ASCEND || tile === TILE_TAVERN_EXIT) {
                tiles.push({ x, y, tile });
            }
        }
    }
    _exitTileCache = { sig, tiles };
    return tiles;
}

// Effective particle multiplier from the Display settings slider (0..1).
// Defaults to 1 (full) when the setting hasn't been touched.
function _particleScale() {
    const d = window._particleDensity;
    return (typeof d === 'number') ? Math.max(0, Math.min(1, d)) : 1;
}

function drawTraps() {
    gameState.traps.forEach(t => {
        if (!gameState.revealed[t.y]?.[t.x]) return;
        const tx = t.x * TILE_SIZE;
        const ty = t.y * TILE_SIZE;
        ctx.fillStyle = 'rgba(170, 163, 151, 0.55)';
        ctx.beginPath();
        ctx.moveTo(tx + 12, ty + 28);
        ctx.lineTo(tx + 20, ty + 14);
        ctx.lineTo(tx + 28, ty + 28);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(90, 85, 75, 0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
    });
}


function drawAllies() {
    gameState.allies.forEach(a => {
        if (!gameState.revealed[a.y]?.[a.x]) return;
        // Glyph — use enemy type initial for clarity (S = skeleton, G = goblin, etc.)
        drawGlyph(a.x, a.y, 'S', '#b06fff', 18);
        // Turns-remaining badge in the top-right corner of the tile,
        // so the player always knows how long the minion will last.
        const bx = a.x * TILE_SIZE + TILE_SIZE - 5;
        const by = a.y * TILE_SIZE + 9;
        ctx.fillStyle = '#6a3db8';
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8d0ff';
        ctx.font = 'bold 8px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText(a.turns, bx, by + 3);
        ctx.textAlign = 'left';
    });
}


function drawDecoy() {
    const d = gameState.decoy;
    if (!d || !gameState.revealed[d.y]?.[d.x]) return;
    ctx.globalAlpha = 0.45;
    drawGlyph(d.x, d.y, '@', '#c49eff', 22);
    ctx.globalAlpha = 1;
}


function drawInteractables() {
    gameState.interactables.forEach(obj => {
        if (obj.used || !gameState.revealed[obj.y]?.[obj.x]) return;
        const meta = WORLD_OBJECTS[obj.kind];
        const tx = obj.x * TILE_SIZE;
        const ty = obj.y * TILE_SIZE;
        if (obj.kind.startsWith('chest_')) {
            ctx.fillStyle = meta.color;
            ctx.fillRect(tx + 8, ty + 12, 24, 18);
            ctx.strokeStyle = '#000';
            ctx.strokeRect(tx + 8, ty + 12, 24, 18);
            drawGlyph(obj.x, obj.y, meta.glyph, '#111', 14);
        } else if (obj.kind.startsWith('event_')) {
            const pulse = 0.55 + Math.sin(gameState.frameTick * 0.12 + obj.x) * 0.25;
            ctx.globalAlpha = pulse;
            ctx.fillStyle = meta.color;
            ctx.beginPath();
            ctx.arc(tx + TILE_SIZE / 2, ty + TILE_SIZE / 2, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#fff8db';
            ctx.lineWidth = 2;
            ctx.strokeRect(tx + 6, ty + 6, 28, 28);
            ctx.lineWidth = 1;
            drawGlyph(obj.x, obj.y, meta.glyph, '#111', 16);
        } else {
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = meta.color;
            ctx.beginPath();
            ctx.arc(tx + TILE_SIZE / 2, ty + TILE_SIZE / 2 + 4, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            drawGlyph(obj.x, obj.y, meta.glyph, '#111', 12);
        }
    });
}


function renderEnemyIntents() {
    const el = document.getElementById('enemy-intent-list');
    const panel = document.getElementById('intent-panel');
    if (!el || !panel) return;
    if (gameState.floor === 0 || !gameState.player) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';
    const visible = gameState.enemies
        .filter(e => gameState.revealed[e.y]?.[e.x])
        .sort((a, b) => getDistance(a.x, a.y, gameState.player.x, gameState.player.y) - getDistance(b.x, b.y, gameState.player.x, gameState.player.y))
        .slice(0, 4);

    // Bestiary: any enemy the player can see is "discovered". Cheap no-op once
    // already seen; not persisted here (saved on next kill/meta write) to avoid
    // a localStorage write every frame an enemy is on screen.
    if (typeof recordBestiarySeen === 'function') {
        gameState.enemies.forEach(e => { if (gameState.revealed[e.y]?.[e.x]) recordBestiarySeen(e.type); });
    }

    const panelTitle = document.querySelector('#intent-panel h2');
    if (panelTitle) {
        panelTitle.innerHTML = visible.length
            ? `<span class="panel-icon">&#9876;</span> Enemy Intent <span class="intent-count">(${visible.length})</span>`
            : `<span class="panel-icon">&#9876;</span> Enemy Intent`;
    }

    if (!visible.length) {
        el.innerHTML = '<p class="intent-empty">No enemies in sight.</p>';
        panel.classList.add('intent-panel-compact');
        panel.classList.remove('intent-panel-danger');
        return;
    }
    panel.classList.remove('intent-panel-compact');

    // Danger mode: any visible enemy is about to deal meaningful damage
    const maxThreat = visible.reduce((m, e) => {
        const intent = e.nextIntent || predictEnemyIntent(e);
        return Math.max(m, intent.damage || 0);
    }, 0);
    const playerHp = gameState.player.hp;
    const playerMaxHp = gameState.player.maxHp;
    const isDanger = maxThreat >= 10 || (playerHp / playerMaxHp < 0.3 && maxThreat > 0);
    panel.classList.toggle('intent-panel-danger', isDanger);

    el.innerHTML = visible.map(e => {
        const intent = e.nextIntent || predictEnemyIntent(e);
        const hovered = gameState.hoverEnemy === e;
        const isHighDmg = intent.damage >= 10;
        const dmg = intent.damage > 0
            ? `<span class="intent-dmg${isHighDmg ? ' intent-dmg-pulse' : ''}">${intent.damage}</span>`
            : '';
        const detail = intent.detail && !intent.damage ? `<small class="intent-detail">${escHtml(intent.detail)}</small>` : '';
        return `<div class="intent-row${hovered ? ' intent-row-hover' : ''}${isHighDmg ? ' intent-row-threat' : ''}">
            <div class="intent-name" style="color:${safeColor(e.color)}">${escHtml(formatIntentName(e))}</div>
            <div class="intent-hp">HP ${e.hp}/${e.maxHp}</div>
            <div class="intent-turn-label">Next Turn:</div>
            <div class="intent-action" style="color:${safeColor(intent.color)}">${escHtml(intent.label)} ${dmg}${detail}</div>
        </div>`;
    }).join('');
}


// Screen-flash hook: same rising-edge CSS-class-toggle pattern as the
// screen-shake hook above, just for crit/kill flashes instead of shake.
// Tracks its own active-flag/timer per kind (separate from shake's) so a
// crit flash and a kill flash landing close together don't cancel each
// other's removal timeout early.
function triggerScreenFlash(kind) {
    if (typeof gameSettings !== 'undefined' && gameSettings.reduceMotion) return;
    const cls = kind === 'kill' ? 'kill-flash' : 'crit-flash';
    const flagKey = `_${cls}Active`;
    const timerKey = `_${cls}Timer`;
    if (gameState[flagKey]) return;
    gameState[flagKey] = true;
    const wrap = document.getElementById('canvas-wrap');
    if (!wrap) { gameState[flagKey] = false; return; }
    wrap.classList.remove(cls);
    void wrap.offsetWidth;
    wrap.classList.add(cls);
    clearTimeout(gameState[timerKey]);
    gameState[timerKey] = setTimeout(() => {
        wrap.classList.remove(cls);
        gameState[flagKey] = false;
    }, 300);
}


// ══════════════════════════════════════════════════════════════════════════════
// HIDPI / RETINA CRISP RENDERING
// The canvas displays at a CSS size (width:100% with a 25/18 aspect ratio) that
// rarely matches its 1000×720 backing store, so the browser upscales the bitmap
// — the soft, slightly-blurry look that reads as "indie." Fix: size the backing
// store to (displayed CSS size × devicePixelRatio) and scale the context so the
// world is drawn at native device resolution. All existing `x * TILE_SIZE` math
// is untouched because we scale the context to map logical 1000×720 units onto
// the high-res backing store. Re-run on resize / DPR change.
// ══════════════════════════════════════════════════════════════════════════════
const LOGICAL_W = MAP_WIDTH * TILE_SIZE;   // 1000
const LOGICAL_H = MAP_HEIGHT * TILE_SIZE;  // 720
let _lastDprSig = null;

function resizeCanvasForDPI() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5); // cap at 2.5× — beyond is wasted fill
    const rect = canvas.getBoundingClientRect();
    // If the canvas isn't laid out yet (display:none on the title screen), its
    // rect is 0×0. Don't commit a backing-store size in that state — bail and
    // let a later frame (once visible) do the real sizing. Marking the sig null
    // ensures the next visible frame is treated as a genuine change.
    if (!rect.width || !rect.height) { _lastDprSig = null; return; }
    const cssW = rect.width;
    const cssH = rect.height;
    const sig = `${Math.round(cssW)}x${Math.round(cssH)}@${dpr}`;
    if (sig === _lastDprSig) return; // nothing changed — skip the reset
    _lastDprSig = sig;

    // Backing store at device resolution.
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    // Map the logical 1000×720 coordinate space onto the (possibly larger or
    // smaller) device-pixel backing store. setTransform replaces any prior
    // scale so repeated calls don't compound.
    const sx = canvas.width  / LOGICAL_W;
    const sy = canvas.height / LOGICAL_H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    // Crisp text/shapes; the world art is vector/procedural so smoothing on
    // gives clean gradient edges while the device-res backing keeps it sharp.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
}

// Recompute on viewport changes. Debounced via rAF so a drag-resize doesn't
// thrash the backing store allocation.
let _resizeRaf = null;
if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        if (_resizeRaf) return;
        _resizeRaf = requestAnimationFrame(() => { _resizeRaf = null; resizeCanvasForDPI(); });
    });
}

function draw() {
    // Headless / minimap performance guard. The bot harness (bot-controller.js)
    // sets window._botSkipRender = true whenever its display mode is anything
    // other than "full" (i.e. Minimap or Headless), to skip the expensive
    // main-canvas paint during fast automated batches. The harness already
    // hides the canvas stage itself; this guard is what actually stops the
    // per-frame drawing. Without it the "big map" keeps painting behind the
    // dashboard even in headless mode — exactly the bug we're fixing.
    //
    // gameState.headless / botDisplay / renderMode are also honored as
    // fallbacks so a future non-bot headless caller works without coupling.
    if (
        (typeof window !== 'undefined' && window._botSkipRender) ||
        gameState.headless === true ||
        gameState.botDisplay === 'headless' ||
        gameState.renderMode === 'headless'
    ) {
        // Drain any visual effects that were queued before suppression kicked in
        // (or by code paths that don't gate on _effectsSuppressed). drawEffects()
        // won't run to drain them while we're skipping draw, so clear them here
        // to keep gameState.effects from growing unbounded across a batch.
        if (gameState.effects && gameState.effects.length) gameState.effects.length = 0;
        return;
    }

    // Ensure the backing store matches the current display size & DPR. Cheap
    // (signature-guarded) after the first call, so safe to invoke every frame.
    resizeCanvasForDPI();

    // Clear in LOGICAL coordinates — the context is scaled to map 1000×720
    // logical units onto the device-pixel backing store, so clearing the full
    // logical rect covers the whole canvas regardless of DPR.
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Player movement lerp
    if (gameState.player) {
        const p = gameState.player;
        p.renderX += (p.x * TILE_SIZE - p.renderX) * 0.22;
        p.renderY += (p.y * TILE_SIZE - p.renderY) * 0.22;
    }

    // Enemy movement lerp — same smoothing the player already had.
    // Previously enemies snapped instantly to their new tile on every
    // move with zero interpolation, which read as a teleport rather
    // than a step.
    gameState.enemies.forEach(enemy => {
        if (enemy.renderX === undefined) { enemy.renderX = enemy.x * TILE_SIZE; enemy.renderY = enemy.y * TILE_SIZE; }
        enemy.renderX += (enemy.x * TILE_SIZE - enemy.renderX) * 0.22;
        enemy.renderY += (enemy.y * TILE_SIZE - enemy.renderY) * 0.22;
    });

    // CSS screen-shake hook: fires the .screen-shake class on the canvas
    // wrapper once when a new shake event starts (rising edge), letting
    // the CSS keyframe animation play to completion on its own rather
    // than being re-triggered or cut short every frame. Layers on top of
    // the canvas's own internal recoil translation below.
    if (gameState.screenShake > 0.5 && !gameState._shakeClassActive) {
        gameState._shakeClassActive = true;
        const wrap = document.getElementById('canvas-wrap');
        if (wrap) {
            wrap.classList.remove('screen-shake');
            // restart animation even if triggered again mid-flight
            void wrap.offsetWidth;
            wrap.classList.add('screen-shake');
            clearTimeout(gameState._shakeClassTimer);
            gameState._shakeClassTimer = setTimeout(() => {
                wrap.classList.remove('screen-shake');
                gameState._shakeClassActive = false;
            }, 320);
        }
    }

    // Directional screenshake — rotates each frame for recoil feel
    const shake = gameState.screenShake;
    const shakeX = shake > 0.5 ? Math.cos(gameState.screenShakeAngle) * shake : 0;
    const shakeY = shake > 0.5 ? Math.sin(gameState.screenShakeAngle) * shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    try {
        drawDungeon();
        if (gameState.floor > 0) {
            drawInteractables();
            drawTraps();
        }
        // inTavernInterior: the hub NPC layer. True only when the player is
        // actually inside the tavern hub floor — NOT in a world zone, town, or
        // arena. Without the worldPos check, forest/road zones (floor 0, not
        // courtyard, not arena) incorrectly render all the tavern NPCs on top
        // of the forest grid, making every zone look like a duplicate of the hub.
        const _wp = gameState.worldPos;
        const _isHub = !_wp || (_wp.row === 2 && _wp.col === 2); // only (2,2) = tavern
        const inTavernInterior = gameState.floor === 0 && !gameState.inCourtyard &&
            !gameState.inArenaBout && !gameState.inTown && _isHub;
        if (inTavernInterior) {
            drawNpcFloorMarkers();   // uses TAVERN_INTERACTABLES (social NPCs only)
            drawBartender();
            drawGambler();
            drawBrewmaster();
            drawBard();
            drawStashChest();
            drawCellar();
            drawDungeonEntrance();
        }
        if (gameState.floor === 0 && gameState.inCourtyard) {
            drawMarketFloorMarkers();
            drawArenaCrowd();
            drawArenaGate();
            drawMarketDetails();
        }
        if (gameState.floor === 0 && gameState.inTown) { drawTownDetails(); }
        // Overland zone features (forage/merchant/event markers) — drawn under
        // items/enemies so an ambusher standing on a node still reads clearly.
        if (gameState.floor === 0 && !gameState.inCourtyard && !gameState.inTown && !gameState.inArena) {
            drawZoneFeatures();
        }
        gameState.items.forEach(item => {
            if (gameState.revealed[item.y]?.[item.x]) drawItem(item);
        });
        gameState.enemies.forEach(enemy => {
            if (gameState.revealed[enemy.y]?.[enemy.x]) drawEnemy(enemy);
        });
        drawHoveredEnemyRing();
        if (gameState.floor > 0) {
            drawAllies();
            drawDecoy();
        }
        if (gameState.player) drawPlayer();
        // Navigation prompt: floats above whichever tavern NPC the player is
        // adjacent to. Drawn after the player so it's never occluded.
        if (gameState.floor === 0 && !gameState.inArenaBout) drawInteractionPrompt();
        drawEnemyIntentBadges();
        drawDyingSprites();  // dissolving sprites drawn before VFX so particles appear on top
        drawEffects();
        drawAmbientVignette();
    } finally {
        // Guarantees ctx.restore() always runs even if a drawing call above
        // throws — without this, a single bad frame leaves an unbalanced
        // ctx.save() on the stack, corrupting every frame rendered after it
        // (the camera shake translate would silently compound forever).
        ctx.restore();
    }

    // Multiplicative screenshake decay + angle rotation — deliberately
    // NOT gated by hit-stop below; the shake is part of what sells the
    // impact, so the screen should keep visibly rattling through the
    // freeze rather than also pausing.
    gameState.screenShakeAngle += 2.4;
    gameState.screenShake *= 0.82;
    if (gameState.screenShake < 0.5) gameState.screenShake = 0;

    // Hit-stop: pause the animation-tick clock for a few frames after a
    // high-impact hit (see triggerHitStop in combat.js) so the impact
    // pose — flash, lunge, frozen idle bob — holds visible for a beat
    // instead of decaying away in a single ~16ms tick. Game logic is
    // never affected by this; combat math has already fully resolved
    // synchronously by the time any of this fires. frameTick is what
    // drives idle bob/torch flicker/every other ambient sine motion, so
    // freezing it (along with the hit-reaction decay below) is what
    // makes the whole scene visibly hold rather than just the hit flash.
    if (gameState.hitStopFrames > 0) {
        gameState.hitStopFrames--;
        return;
    }

    // Multiplicative enemy flash decay
    gameState.enemies.forEach(enemy => {
        enemy.flash *= 0.78;
        enemy.hitFlash *= 0.72;
        if (enemy.attackAnim?.life > 0) enemy.attackAnim.life--;
    });
    if (gameState.player) {
        gameState.player.hitFlash = (gameState.player.hitFlash || 0) * 0.72;
    }
    if (gameState.player?.attackAnim?.life > 0) gameState.player.attackAnim.life--;
    if (gameState.player?.lungeAnim?.life > 0) gameState.player.lungeAnim.life--;
    gameState.frameTick++;
}


// Deterministic per-tile pseudo-noise (stable across frames, no per-frame randomness)
