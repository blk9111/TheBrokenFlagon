
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
function _fogNoise(x, y) {
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return h - Math.floor(h); // 0..1
}


function _getFloorTexture(x, y) {
    const floorKey = `floor_v2:${gameState.floor}:${x}:${y}`;
    return _getTileTextureCanvas(floorKey, offCtx => {
        // ── Deep warm mortar — visible amber-brown, not near-black ──────
        // The old #070605 mortar made every tile look like a void. This reads
        // as actual stone bedding — dark but coloured.
        offCtx.fillStyle = '#1a1108';
        offCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

        // ── Flagstone layout: same three patterns, richer palette ────────
        const layoutSeed = _fogNoise(x * 2.3 + gameState.floor * 0.7, y * 2.9 + gameState.floor * 1.3);
        const pattern = layoutSeed < 0.40 ? 'single' : layoutSeed < 0.72 ? 'quad' : 'split';

        // NEW PALETTE — three distinct stone hues instead of one near-black band.
        // Depth tints stones gradually cooler so floors feel more ominous below F30.
        const depth   = gameState.floor || 0;
        const cool    = Math.min(16, depth * 0.35); // 0 → 16 max

        function slabFill(seed) {
            // Base brightness 46–76 (was 22–38) — clearly visible under torchlight
            const base = 46 + Math.floor(seed * 30);
            let r, g, b;
            if (seed < 0.30) {
                // Warm amber buff — limestone / sandstone feel, dominant hue
                r = base + 18; g = base + 10; b = base - 8 + Math.floor(cool * 0.3);
            } else if (seed < 0.55) {
                // Earthy brown slate — aged stone with iron oxide tint
                r = base + 8; g = base + 2; b = base - 12 + Math.floor(cool * 0.5);
            } else if (seed < 0.78) {
                // Cool gray-blue — fresh cut stone, contrasts warmly-lit areas
                r = base - 6 - Math.floor(cool * 0.3);
                g = base - 3;
                b = base + 10 + Math.floor(cool * 0.6);
            } else {
                // Dusty violet — trace mineral stain, adds mystery
                r = base + 4 - Math.floor(cool * 0.2);
                g = base - 6;
                b = base + 6 + Math.floor(cool * 0.8);
            }
            r = Math.max(0, Math.min(255, r));
            g = Math.max(0, Math.min(255, g));
            b = Math.max(0, Math.min(255, b));
            return `rgb(${r},${g},${b})`;
        }

        // Draw one flagstone with visible bevel — stronger than before so
        // individual stones read at a glance rather than blending into mush.
        function flagstone(px, py, pw, ph, seed, seed2) {
            offCtx.fillStyle = slabFill(seed);
            offCtx.fillRect(px, py, pw, ph);

            // Surface grain — adds micro-texture to large single slabs
            const grainAlpha = 0.04 + seed2 * 0.04;
            offCtx.fillStyle = `rgba(255,240,200,${grainAlpha})`;
            const gx = px + pw * (0.2 + seed * 0.4);
            const gy = py + ph * (0.3 + seed2 * 0.4);
            offCtx.fillRect(gx, gy, pw * 0.4, 1);

            // Top-left bevel — warm highlight (torchlight catching the edge)
            const hiAlpha = 0.10 + seed2 * 0.10;
            offCtx.fillStyle = `rgba(255,230,160,${hiAlpha})`;
            offCtx.fillRect(px, py, pw, 1.5);
            offCtx.fillRect(px, py, 1.5, ph);

            // Bottom-right shadow — deeper for more 3D read
            offCtx.fillStyle = 'rgba(0,0,0,0.45)';
            offCtx.fillRect(px, py + ph - 1.5, pw, 1.5);
            offCtx.fillRect(px + pw - 1.5, py, 1.5, ph);
        }

        const seam = 2;
        if (pattern === 'single') {
            const s  = _fogNoise(x * 4.1, y * 4.7 + gameState.floor);
            const s2 = _fogNoise(x * 6.3, y * 2.1 + gameState.floor * 2.1);
            flagstone(seam, seam, TILE_SIZE - seam*2, TILE_SIZE - seam*2, s, s2);
        } else if (pattern === 'quad') {
            const half = TILE_SIZE / 2;
            for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
                const s  = _fogNoise(x * 2.9 + col * 5.1, y * 3.7 + row * 6.3 + gameState.floor);
                const s2 = _fogNoise(x * 7.1 + col * 3.3, y * 8.9 + row * 2.7 + gameState.floor * 3.1);
                flagstone(col*half + seam/2, row*half + seam/2, half - seam, half - seam, s, s2);
            }
        } else {
            const sA = _fogNoise(x * 3.3, y * 5.1 + gameState.floor);
            const sB = _fogNoise(x * 5.7, y * 3.3 + gameState.floor * 1.7);
            const midY = TILE_SIZE * (0.42 + _fogNoise(x * 1.3, y * 1.9) * 0.16);
            flagstone(seam, seam, TILE_SIZE-seam*2, midY-seam-1, sA, _fogNoise(x*2.1,y*9.3));
            flagstone(seam, midY+1, TILE_SIZE-seam*2, TILE_SIZE-midY-seam-1, sB, _fogNoise(x*8.1,y*1.7));
        }

        // ── Surface detail ────────────────────────────────────────────────
        const d1 = _fogNoise(x * 1.7 + 3.1, y * 4.1 + gameState.floor * 1.9);
        const d2 = _fogNoise(x * 9.3 + 1.7, y * 2.3 + gameState.floor * 0.9);

        // Cracks — darker and more defined
        if (d1 > 0.78) {
            offCtx.strokeStyle = `rgba(0,0,0,${0.40 + d2 * 0.25})`;
            offCtx.lineWidth = 1;
            offCtx.beginPath();
            const sx = TILE_SIZE * (0.2 + d2 * 0.4), sy = TILE_SIZE * (0.2 + d1 * 0.3);
            offCtx.moveTo(sx, sy);
            offCtx.lineTo(sx + TILE_SIZE * (0.15 + d1 * 0.2), sy + TILE_SIZE * (0.25 + d2 * 0.25));
            offCtx.stroke();
        }

        // Moisture/algae stain — visible teal-green for visual interest
        if (d2 > 0.84) {
            const stainAlpha = Math.min(0.20, 0.06 + depth * 0.004);
            offCtx.fillStyle = `rgba(30,80,55,${stainAlpha})`;
            offCtx.beginPath();
            offCtx.ellipse(
                TILE_SIZE * (0.35 + d1 * 0.3), TILE_SIZE * (0.4 + d2 * 0.2),
                TILE_SIZE * 0.22, TILE_SIZE * 0.14, d1 * Math.PI, 0, Math.PI * 2
            );
            offCtx.fill();
        }

        // Iron rust stain — reddish-brown, only on deeper floors
        if (depth > 15 && d1 > 0.90) {
            offCtx.fillStyle = `rgba(120,40,20,${Math.min(0.15, 0.04 + (depth-15)*0.005)})`;
            offCtx.beginPath();
            offCtx.ellipse(
                TILE_SIZE * (0.6 + d2 * 0.25), TILE_SIZE * (0.5 + d1 * 0.25),
                TILE_SIZE * 0.12, TILE_SIZE * 0.08, d2 * Math.PI, 0, Math.PI * 2
            );
            offCtx.fill();
        }

        // Speckle grain
        if (d1 > 0.45) {
            offCtx.fillStyle = `rgba(255,240,200,0.04)`;
            offCtx.fillRect(TILE_SIZE * (0.3 + d2 * 0.4), TILE_SIZE * (0.5 + d1 * 0.3), 2, 2);
        }

        // Edge vignette — drop toward mortar color at tile borders
        const edgeGrad = offCtx.createLinearGradient(0, 0, 0, TILE_SIZE);
        edgeGrad.addColorStop(0,   'rgba(0,0,0,0.32)');
        edgeGrad.addColorStop(0.08,'rgba(0,0,0,0)');
        edgeGrad.addColorStop(0.92,'rgba(0,0,0,0)');
        edgeGrad.addColorStop(1,   'rgba(0,0,0,0.38)');
        offCtx.fillStyle = edgeGrad;
        offCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    });
}
function drawFloorTexture(x, y, tile) {
    const tx = x * TILE_SIZE;
    const ty = y * TILE_SIZE;
    const n = _fogNoise(x * 3.7 + gameState.floor * 11, y * 5.1);
    const n2 = _fogNoise(x * 1.3 + 4, y * 2.7 + 17);

    if (gameState.floor === 0 && gameState.inTown) {
        // Cobblestone — alternating grey tones with subtle mortar lines
        const stone = (x + y) % 2 === 0 ? '#4a4640' : '#403c38';
        ctx.fillStyle = stone;
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx + 2, ty + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        if (n2 > 0.7) {
            ctx.fillStyle = 'rgba(180,150,100,0.06)';
            ctx.fillRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        }
        return;
    }

    if (gameState.floor === 0 && gameState.inCourtyard) {
        const dirt = (x + y) % 3 === 0 ? '#3a3322' : '#332d1f';
        ctx.fillStyle = dirt;
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
        if (n2 > 0.6) {
            ctx.fillStyle = 'rgba(120, 140, 70, 0.1)'; // sparse patches of grass
            ctx.fillRect(tx + 4 + n * 8, ty + 8, 10, 4);
        }
        return;
    }

    // ── World zones (road / forest / arena exterior) ───────────────────────
    if (gameState.floor === 0 && gameState.worldPos &&
        (gameState.worldPos.row !== 2 || gameState.worldPos.col !== 2) &&
        (gameState.worldPos.row !== 2 || gameState.worldPos.col !== 1)) {

        const zoneType = WORLD_MAP[gameState.worldPos.row][gameState.worldPos.col];

        if (zoneType === 'road') {
            const base = (x + y) % 2 === 0 ? '#4a4236' : '#433c30';
            ctx.fillStyle = base;
            ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
            if (n2 > 0.72) {
                ctx.fillStyle = 'rgba(200,170,120,0.09)';
                ctx.fillRect(tx + 5 + n * 10, ty + 14, 20, 2);
            }
            return;
        }

        if (zoneType === 'forest') {
            const base = (x + y + Math.floor(n * 2)) % 3 === 0 ? '#2a3020' : '#252b1c';
            ctx.fillStyle = base;
            ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
            if (n2 > 0.55) {
                ctx.fillStyle = `rgba(60,90,40,${0.12 + n * 0.1})`;
                ctx.fillRect(tx + 3 + n * 8, ty + 6 + n2 * 6, 12, 5);
            }
            return;
        }

        if (zoneType === 'arena') {
            // Arena exterior — sandy stone approach
            const base = (x + y) % 2 === 0 ? '#5a4e38' : '#524835';
            ctx.fillStyle = base;
            ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
            if (n2 > 0.6) {
                ctx.fillStyle = `rgba(40,30,15,${0.12 + n * 0.08})`;
                ctx.fillRect(tx + 4 + n * 8, ty + 8, 14, 3);
            }
            return;
        }
    }

    if (gameState.floor === 0 && !gameState.inArenaBout) {
        const plank = (x + y) % 2 === 0 ? '#3b2a1e' : '#342518';
        ctx.fillStyle = y === 4 && x >= 8 && x <= 16 ? TILE_COLORS.bar : plank;
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.moveTo(tx, ty + TILE_SIZE - 1);
        ctx.lineTo(tx + TILE_SIZE, ty + TILE_SIZE - 1);
        ctx.stroke();
        if (n2 > 0.65) {
            ctx.fillStyle = 'rgba(255,220,160,0.04)';
            ctx.fillRect(tx + 6, ty + 10, 18, 3);
        }
        return;
    }

    // Arena bout — a sandy fighting pit, visually distinct from both the
    // tavern's wooden planks and the dungeon's cold stone. Warm packed sand
    // with scattered darker grit, so the bout reads as its own arena space.
    if (gameState.floor === 0 && gameState.inArenaBout) {
        const sand = (x + y) % 2 === 0 ? '#6b5836' : '#5f4e30';
        ctx.fillStyle = sand;
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
        // Scattered grit / scuff marks
        if (n2 > 0.5) {
            ctx.fillStyle = `rgba(40, 30, 18, ${0.18 + n * 0.12})`;
            ctx.fillRect(tx + 5 + n * 12, ty + 7 + n2 * 8, 9, 4);
        }
        if (n > 0.7) {
            ctx.fillStyle = 'rgba(120, 90, 50, 0.15)'; // lighter sand drift
            ctx.fillRect(tx + 3, ty + 20, 14, 3);
        }
        // Faint blood-stain hints near the center rows — it IS a fighting pit
        if (y >= 8 && y <= 9 && n2 > 0.72) {
            ctx.fillStyle = 'rgba(120, 30, 25, 0.12)';
            ctx.fillRect(tx + 8, ty + 12, 16, 8);
        }
        return;
    }

    if (tile === 3) {
        ctx.fillStyle = '#2a1818';
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = `rgba(180, 40, 40, ${0.12 + n * 0.08})`;
        ctx.fillRect(tx + 2, ty + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        return;
    }

    ctx.drawImage(_getFloorTexture(x, y), tx, ty);

    if (n2 > 0.78) {
        ctx.fillStyle = `rgba(0, 0, 0, ${0.08 + n2 * 0.05})`;
        ctx.fillRect(tx + 3 + n * 10, ty + 6, 14, 2);
    }
}


// Wall/floor textures are fully deterministic per tile coordinate (same
// noise seed every time), so the actual brick/stone pattern never
// changes frame to frame — only the torch flicker layered on top does,
// and that's handled separately in drawTorchLighting(). Redrawing the
// same dozen fillRect/stroke calls per tile 60 times a second for every
// revealed tile was measurable (occasional frames over the 16.67ms
// 60fps budget with a fully-revealed floor). Caching the static pattern
// to a small offscreen canvas once, then blitting it with drawImage(),
// cuts that cost to a single cheap draw call per tile per frame.
//
// Capped with FIFO eviction rather than cleared on floor transitions —
// a 100-floor run could otherwise accumulate ~900 tiles' worth of
// cached canvases per floor indefinitely. The cap comfortably covers
// several floors' worth of tiles at once (enough that a player moving
// between adjacent floors doesn't constantly evict and redraw), while
// keeping total memory bounded regardless of how long a run goes.
const _tileTextureCache = new Map();

const TILE_TEXTURE_CACHE_MAX = 4000;


function _getTileTextureCanvas(key, painter) {
    let cached = _tileTextureCache.get(key);
    if (cached) return cached;
    const off = document.createElement('canvas');
    off.width = TILE_SIZE;
    off.height = TILE_SIZE;
    const offCtx = off.getContext('2d');
    painter(offCtx);
    if (_tileTextureCache.size >= TILE_TEXTURE_CACHE_MAX) {
        const oldestKey = _tileTextureCache.keys().next().value;
        _tileTextureCache.delete(oldestKey);
    }
    _tileTextureCache.set(key, off);
    return off;
}


function _getWallTexture(x, y) {
    // Arena bouts share floor 0 with the tavern but should read as a cold
    // stone pit, not warm tavern brick — so texture them like dungeon walls.
    const isArenaBout = gameState.floor === 0 && gameState.inArenaBout;
    const isTavern = gameState.floor === 0 && !isArenaBout;
    // Keyed by the real tile coordinates (plus floor and mode, since the same
    // x,y means a different brick seed in different modes) — at most
    // MAP_WIDTH*MAP_HEIGHT = 450 entries, each a tiny 40x40 canvas, so this
    // stays cheap in memory while guaranteeing every tile gets its own
    // correctly-seeded pattern rather than reusing another tile's by chance.

    // In world zones (forest/road/arena), walls are trees or stone — not brick.
    const wp = gameState.worldPos;
    const isWorldZone = gameState.floor === 0 && wp &&
        !(wp.row === 2 && wp.col === 2) && !(wp.row === 2 && wp.col === 1);
    const worldType = isWorldZone ? WORLD_MAP[wp.row][wp.col] : null;

    const mode = isWorldZone   ? ('w_' + worldType) :
                 isTavern      ? 't' :
                 isArenaBout   ? 'a' : 'd';
    const key = `wall:${mode}:${gameState.floor}:${x}:${y}`;

    return _getTileTextureCanvas(key, offCtx => {
        // ── World zone wall textures ───────────────────────────────────────
        if (worldType === 'forest') {
            const seed  = _fogNoise(x * 3.7 + 51, y * 5.1 + 37);
            const seed2 = _fogNoise(x * 1.9 + 13, y * 2.3 + 89);
            offCtx.fillStyle = '#1a2010';
            offCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
            // Trunk
            offCtx.fillStyle = `rgb(${50 + Math.floor(seed * 20)},${35 + Math.floor(seed * 10)},${15 + Math.floor(seed * 8)})`;
            const tw = 8 + Math.floor(seed * 6);
            const tx2 = TILE_SIZE / 2 - tw / 2 + Math.floor(seed2 * 4 - 2);
            offCtx.fillRect(tx2, TILE_SIZE * 0.45, tw, TILE_SIZE * 0.6);
            // Canopy
            offCtx.fillStyle = `rgb(${25 + Math.floor(seed * 20)},${55 + Math.floor(seed2 * 30)},${20 + Math.floor(seed * 15)})`;
            offCtx.beginPath();
            offCtx.arc(TILE_SIZE / 2 + Math.floor(seed2 * 4 - 2), TILE_SIZE * 0.32, 12 + Math.floor(seed * 6), 0, Math.PI * 2);
            offCtx.fill();
            offCtx.fillStyle = 'rgba(80,140,50,0.22)';
            offCtx.beginPath();
            offCtx.arc(TILE_SIZE / 2 + Math.floor(seed2 * 4 - 2), TILE_SIZE * 0.26, 7 + Math.floor(seed * 3), 0, Math.PI * 2);
            offCtx.fill();
            return;
        }
        if (worldType === 'road') {
            const seed = _fogNoise(x * 2.9 + 7, y * 4.1 + 23);
            const shade = 50 + Math.floor(seed * 20);
            offCtx.fillStyle = `rgb(${shade},${shade - 2},${shade - 5})`;
            offCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
            offCtx.fillStyle = 'rgba(255,255,255,0.04)';
            offCtx.fillRect(3, 2, TILE_SIZE - 6, TILE_SIZE / 3);
            return;
        }
        if (worldType === 'arena') {
            // Arena exterior walls — weathered stone blocks
            const seed = _fogNoise(x * 2.1 + 19, y * 3.7 + 43);
            const shade = 55 + Math.floor(seed * 25);
            offCtx.fillStyle = `rgb(${shade + 5},${shade},${shade - 3})`;
            offCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
            offCtx.fillStyle = 'rgba(255,255,255,0.06)';
            offCtx.fillRect(2, 2, TILE_SIZE - 4, 3);
            offCtx.fillStyle = 'rgba(0,0,0,0.3)';
            offCtx.fillRect(2, TILE_SIZE - 5, TILE_SIZE - 4, 3);
            return;
        }
        offCtx.fillStyle = isTavern ? '#1c1008' : '#101214';  // dungeon: near-black cool mortar
        offCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

        const rowOffset = (y % 2 === 0) ? 0 : 1;
        const brickH = TILE_SIZE / 2;
        const mortar = 2;

        for (let row = 0; row < 2; row++) {
            const by = row * brickH;
            const shiftedRow = row + rowOffset;
            const brickCount = (shiftedRow % 2 === 0) ? 2 : 1;
            const brickW = brickCount === 2 ? TILE_SIZE / 2 : TILE_SIZE;
            for (let col = 0; col < brickCount; col++) {
                const bx = col * brickW;
                const seed  = _fogNoise(x * 3.1 + row * 7.7 + col * 2.3, y * 4.3 + gameState.floor);
                const seed2 = _fogNoise(x * 5.9 + col * 4.1 + row * 1.3, y * 7.1 + gameState.floor * 2.3);
                const seed3 = _fogNoise(x * 1.9 + col * 8.7, y * 3.3 + row * 5.9);
                const depth = gameState.floor || 0;

                if (isTavern) {
                    // Tavern: warm amber-brown stone, clearly distinct from dungeon
                    const shade = 72 + Math.floor(seed * 28) - 8;
                    offCtx.fillStyle = `rgb(${shade + 22},${shade + 8},${Math.floor(shade * 0.48)})`;
                    offCtx.fillRect(bx + mortar/2, by + mortar/2, brickW - mortar, brickH - mortar);
                    offCtx.fillStyle = `rgba(255,240,200,${0.18 + seed2 * 0.10})`;
                    offCtx.fillRect(bx + mortar/2, by + mortar/2, brickW - mortar, 2.5);
                    offCtx.fillRect(bx + mortar/2, by + mortar/2, 2.5, brickH - mortar);
                    offCtx.fillStyle = 'rgba(0,0,0,0.45)';
                    offCtx.fillRect(bx + mortar/2, by + brickH - mortar - 2.5, brickW - mortar, 2.5);
                    offCtx.fillRect(bx + brickW - mortar - 2.5, by + mortar/2, 2.5, brickH - mortar);
                } else {
                    // DUNGEON WALL — redesigned for clear contrast against warm floor:
                    // Cool gray-indigo stone, brighter range 65-95, strongly distinct
                    // from the amber/ochre floor palette below it.
                    const shadeBase = 66 + Math.floor(seed * 30); // 66–96 (up from 62–86)
                    // Hue variation: most bricks are blue-gray, some warmer (mineral veins)
                    let r, g, b;
                    if (seed < 0.25) {
                        // Blue-gray slate — dominant dungeon stone
                        r = shadeBase - 8; g = shadeBase - 4; b = shadeBase + 14;
                    } else if (seed < 0.55) {
                        // Neutral gray — middle ground
                        r = shadeBase - 2; g = shadeBase; b = shadeBase + 6;
                    } else if (seed < 0.78) {
                        // Warm gray — iron-rich stone, breaks monotony
                        r = shadeBase + 10; g = shadeBase + 4; b = shadeBase - 4;
                    } else {
                        // Teal-tinged — deep mineral deposit
                        r = shadeBase - 10; g = shadeBase + 2; b = shadeBase + 18;
                    }
                    // Depth gradient: walls go slightly darker/cooler as you descend
                    const depthDark = Math.min(20, depth * 0.22);
                    r = Math.max(30, Math.min(255, r - depthDark * 0.3));
                    g = Math.max(30, Math.min(255, g - depthDark * 0.5));
                    b = Math.max(30, Math.min(255, b - depthDark * 0.1));

                    offCtx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
                    offCtx.fillRect(bx + mortar/2, by + mortar/2, brickW - mortar, brickH - mortar);

                    // Top-left bevel: cool silver-white (ambient ceiling reflection)
                    const hiAlpha = 0.16 + seed2 * 0.12;
                    offCtx.fillStyle = `rgba(210,225,255,${hiAlpha})`;
                    offCtx.fillRect(bx + mortar/2, by + mortar/2, brickW - mortar, 2.5);
                    offCtx.fillRect(bx + mortar/2, by + mortar/2, 2.5, brickH - mortar);

                    // Bottom-right shadow — strong for clear 3D read
                    offCtx.fillStyle = 'rgba(0,0,0,0.55)';
                    offCtx.fillRect(bx + mortar/2, by + brickH - mortar - 2.5, brickW - mortar, 2.5);
                    offCtx.fillRect(bx + brickW - mortar - 2.5, by + mortar/2, 2.5, brickH - mortar);

                    // Surface texture: fine horizontal grain
                    if (seed2 > 0.45) {
                        offCtx.fillStyle = `rgba(210,225,255,${0.06 + seed3 * 0.06})`;
                        offCtx.fillRect(bx + 4 + seed3 * 6, by + 5 + seed2 * 4, brickW * 0.40, 1.5);
                    }

                    // Cracks — darker, more defined
                    if (seed > 0.76) {
                        offCtx.strokeStyle = `rgba(0,0,0,${0.55 + seed2 * 0.25})`;
                        offCtx.lineWidth = 1;
                        offCtx.beginPath();
                        offCtx.moveTo(bx + brickW * (0.2 + seed3 * 0.2), by + brickH * 0.2);
                        offCtx.lineTo(bx + brickW * (0.45 + seed * 0.25), by + brickH * 0.75);
                        offCtx.stroke();
                    }

                    // Moisture seep — teal-green, now more visible
                    if (seed3 > 0.78) {
                        const stainStrength = Math.min(0.28, 0.08 + depth * 0.004);
                        offCtx.fillStyle = `rgba(8,65,48,${stainStrength})`;
                        offCtx.fillRect(bx + mortar, by + brickH * 0.5, brickW - mortar * 2, brickH * 0.38);
                    }
                }
            }
        }

        // Outer edge: strong darkening anchors each wall tile against neighbors
        offCtx.strokeStyle = 'rgba(0,0,0,0.75)';
        offCtx.lineWidth = 1;
        offCtx.strokeRect(0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    });
}


function drawWallTile(x, y) {
    const tx = x * TILE_SIZE;
    const ty = y * TILE_SIZE;
    ctx.drawImage(_getWallTexture(x, y), tx, ty);
}


function drawWallEdgeShadows() {
    const offsets = [
        { dx: 0, dy: 1, x0: 0, y0: 0, w: TILE_SIZE, h: 12 },
        { dx: 0, dy: -1, x0: 0, y0: TILE_SIZE - 12, w: TILE_SIZE, h: 12 },
        { dx: 1, dy: 0, x0: 0, y0: 0, w: 12, h: TILE_SIZE },
        { dx: -1, dy: 0, x0: TILE_SIZE - 12, y0: 0, w: 12, h: TILE_SIZE }
    ];
    const tick = gameState.frameTick;
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (!gameState.revealed[y][x]) continue;
            const tile = gameState.dungeon[y][x];
            if (tile === 1) continue;
            const tx = x * TILE_SIZE;
            const ty = y * TILE_SIZE;
            const flicker = 0.36 + Math.sin(tick * 0.04 + x * 0.7 + y * 0.5) * 0.08;
            offsets.forEach(off => {
                const nx = x + off.dx;
                const ny = y + off.dy;
                if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) return;
                if (gameState.dungeon[ny][nx] !== 1) return;
                const g = ctx.createLinearGradient(tx, ty, tx + off.dx * TILE_SIZE, ty + off.dy * TILE_SIZE);
                g.addColorStop(0, `rgba(0, 0, 0, ${flicker + 0.22})`);
                g.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = g;
                ctx.fillRect(tx + off.x0, ty + off.y0, off.w, off.h);
            });
        }
    }
}


function getTorchPositions() {
    const torches = [];
    if (gameState.floor > 0 && gameState.decorGrid) {
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                if (gameState.revealed[y]?.[x] && gameState.decorGrid[y][x] === 'torch') {
                    torches.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 - 2 });
                }
            }
        }
    }
    if (gameState.floor === 0 && gameState.inArenaBout) {
        // Arena pit torches — mounted at the corners of the fighting floor
        // (the pit interior spans x 6-18, y 5-12; see generateArenaFloor).
        [[6, 5], [18, 5], [6, 12], [18, 12], [12, 5], [12, 12]].forEach(([x, y]) => {
            torches.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 });
        });
    } else if (gameState.floor === 0 && !gameState.inCourtyard) {
        [[2, 8], [22, 8], [12, 3], [12, 15], [8, 4], [16, 4]].forEach(([x, y]) => {
            torches.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 });
        });
    }
    return torches;
}


function drawTorchLighting() {
    const torches = getTorchPositions();
    if (!torches.length && gameState.floor === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    torches.forEach((t, i) => {
        // Multi-frequency flicker for organic feel
        const flicker = 0.84 + Math.sin(gameState.frameTick * 0.14 + i * 1.3) * 0.16
            + Math.sin(gameState.frameTick * 0.31 + i * 2.7) * 0.07
            + Math.sin(gameState.frameTick * 0.07 + i * 0.9) * 0.04;
        const r = TILE_SIZE * 3.5 * flicker;       // wider radius (was 2.6)

        // Outer warm glow (amber → orange → deep red fadeout)
        const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, r);
        g.addColorStop(0,    `rgba(255, 230, 140, ${0.38 * flicker})`);  // bright warm core
        g.addColorStop(0.18, `rgba(255, 180, 60,  ${0.26 * flicker})`);  // orange mid
        g.addColorStop(0.45, `rgba(220, 100, 20,  ${0.12 * flicker})`);  // deep orange
        g.addColorStop(0.72, `rgba(120, 40,  5,   ${0.05 * flicker})`);  // ember red
        g.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright white-hot core — small circle at flame base
        const coreR = TILE_SIZE * 0.28 * flicker;
        const cg = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, coreR);
        cg.addColorStop(0,   `rgba(255, 255, 220, ${0.55 * flicker})`);
        cg.addColorStop(0.4, `rgba(255, 230, 120, ${0.25 * flicker})`);
        cg.addColorStop(1,   'rgba(255,180,60,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(t.x, t.y, coreR, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}


function drawPlayerLight() {
    if (!gameState.player || gameState.floor === 0) return;
    const p = gameState.player;
    const cx = p.renderX + TILE_SIZE / 2;
    const cy = p.renderY + TILE_SIZE / 2;
    const breathe = 0.92 + Math.sin(gameState.frameTick * 0.05) * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Primary aura — wider, slightly warmer blue-white. Widened from 3.2 to
    // 4.2 tiles and lifted in intensity so the immediate play area stays clearly
    // legible (the old radius left the bot — and players — navigating a too-dark
    // corridor that read as under-lit rather than atmospheric).
    const r = TILE_SIZE * 4.2 * breathe;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,    `rgba(210, 238, 255, ${0.30 * breathe})`);
    g.addColorStop(0.30, `rgba(150, 215, 255, ${0.19 * breathe})`);
    g.addColorStop(0.60, `rgba(90, 180, 247,  ${0.09 * breathe})`);
    g.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner bright core — soft white glow right around the character
    const coreR = TILE_SIZE * 0.9 * breathe;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    cg.addColorStop(0,   `rgba(235, 248, 255, ${0.24 * breathe})`);
    cg.addColorStop(1,   'rgba(140,210,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}


let _vignetteGrad = null;
let _vignetteSig = null;
function drawAmbientVignette() {
    if (gameState.floor === 0 || !gameState.player) return;
    const pulse = 0.92 + Math.sin(gameState.frameTick * 0.03) * 0.04;
    // Draw in LOGICAL coordinates — the context is scaled to map logical units
    // onto the device-pixel backing store, so using the device dimensions here
    // would draw the vignette far too large. The geometry is fixed (1000×720),
    // so the gradient is effectively built once.
    const w = LOGICAL_W;
    const h = LOGICAL_H;
    const sig = `${w}x${h}`;
    if (_vignetteSig !== sig) {
        _vignetteGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.72);
        _vignetteGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        _vignetteGrad.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
        _vignetteSig = sig;
    }
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = _vignetteGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}


function drawFogParticles() {
    if (gameState.floor === 0) return;  // Tavern doesn't need dungeon fog
    const scale = _particleScale();
    if (scale <= 0) return;             // density slider at 0 — skip entirely
    const count = Math.round(55 * scale);
    for (let i = 0; i < count; i++) {
        const seed = i * 97 + gameState.floor * 13;
        const bx = (seed * 17) % MAP_WIDTH;
        const by = (seed * 31) % MAP_HEIGHT;
        const revealed = gameState.revealed[by]?.[bx];
        if (!revealed) continue;  // Only in revealed tiles (adds atmospheric depth in lit areas)

        // Slow, drifting motion — large slow blobs + small fast wisps
        const isWisp = (i % 3 === 0);
        const speed = isWisp ? 0.052 : 0.022;
        const driftX = Math.sin(gameState.frameTick * speed + i * 1.7) * (isWisp ? 12 : 7);
        const driftY = Math.cos(gameState.frameTick * (speed * 0.75) + i * 2.1) * (isWisp ? 7 : 5);
        const px = bx * TILE_SIZE + TILE_SIZE / 2 + driftX;
        const py = by * TILE_SIZE + TILE_SIZE / 2 + driftY;

        const breathe = 0.5 + Math.sin(gameState.frameTick * 0.04 + i * 0.9) * 0.5;
        const alpha = isWisp
            ? (0.028 + breathe * 0.025)
            : (0.018 + breathe * 0.015);
        const size = isWisp
            ? 1.5 + (i % 3) * 0.7
            : 4 + (i % 5) * 1.8;

        // Slight colour variation — cool blue-grey for a dungeon atmosphere
        const blueShift = Math.floor(breathe * 20);
        ctx.fillStyle = `rgba(${170 + blueShift}, ${180 + blueShift}, ${210}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
    }
}


function drawExitGlows() {
    const exits = _getExitTiles();
    if (!exits.length) return;
    const pulse = 0.55 + Math.sin(gameState.frameTick * 0.1) * 0.25;
    for (const { x, y, tile } of exits) {
        const cx = x * TILE_SIZE + TILE_SIZE / 2;
        const cy = y * TILE_SIZE + TILE_SIZE / 2;
        const rgb = tile === 2 ? '179,136,255' : '255,214,90';
        ctx.save();
        ctx.shadowBlur = 14 * pulse;
        ctx.shadowColor = tile === 2 ? '#b388ff' : '#ffd65a';
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE_SIZE * 0.85);
        g.addColorStop(0, `rgba(${rgb}, ${0.45 * pulse})`);
        g.addColorStop(0.55, `rgba(${rgb}, ${0.14 * pulse})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE_SIZE * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}


function drawUnrevealedFog(x, y) {
    const tx = x * TILE_SIZE;
    const ty = y * TILE_SIZE;
    const n = _fogNoise(x, y);

    // Draw the underlying tile texture so the fog reads as "dungeon that
    // hasn't been lit yet" rather than a disconnected black void.
    const tile = gameState.dungeon[y]?.[x];
    const tex = tile === 1 ? _getWallTexture(x, y) : _getFloorTexture(x, y);
    ctx.drawImage(tex, tx, ty);

    // ── Soft fog edge — proximity to revealed tiles ────────────────────────
    // Count how many of the 8 surrounding tiles are revealed. Tiles adjacent
    // to the explored area get a significantly softer fog overlay so the
    // boundary reads as light fading into darkness rather than a hard pixel
    // line. This is the "indie tell" fix: real games have a feathered reveal.
    let revealedNeighbors = 0;
    let totalNeighbors = 0;
    const revealed = gameState.revealed;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
                totalNeighbors++;
                if (revealed[ny]?.[nx]) revealedNeighbors++;
            }
        }
    }
    const edgeFrac = totalNeighbors > 0 ? revealedNeighbors / totalNeighbors : 0;
    // Full fog alpha at 0.78+; soft edge reduces it proportionally to neighbor count.
    // At edgeFrac=1.0 (fully surrounded by revealed), alpha drops to ~0.36 —
    // the texture is visible enough to hint at what's just beyond the light.
    const fogAlpha = (0.78 + n * 0.06) * (1 - edgeFrac * 0.55);
    ctx.fillStyle = `rgba(2, 2, 4, ${fogAlpha})`;
    ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);

    // Soft glow bleed from the light edge into adjacent fog tiles — a subtle
    // warm haze that bleeds 1 tile beyond the revealed boundary.
    if (edgeFrac > 0.1) {
        const glowAlpha = edgeFrac * 0.06;
        ctx.fillStyle = `rgba(80, 60, 30, ${glowAlpha})`;
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
    }

    // Ambient fog swirl (same as before — adds life without cost)
    const swirl = Math.sin(gameState.frameTick * 0.02 + x * 0.5 + y) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(120, 130, 150, ${0.03 + swirl * 0.03})`;
    ctx.beginPath();
    ctx.arc(tx + TILE_SIZE * 0.5, ty + TILE_SIZE * 0.5, TILE_SIZE * (0.28 + n * 0.12), 0, Math.PI * 2);
    ctx.fill();
}


function drawSpecialTileTint(x, y, tile) {
    const tx = x * TILE_SIZE;
    const ty = y * TILE_SIZE;
    if (tile === 2) {
        ctx.fillStyle = 'rgba(122, 79, 194, 0.22)';
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
    } else if (tile === TILE_ASCEND || tile === TILE_TAVERN_EXIT) {
        ctx.fillStyle = 'rgba(255, 214, 90, 0.18)';
        ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);
    }
}


function drawIntentBadge(enemy) {
    const intent = enemy.nextIntent || predictEnemyIntent(enemy);
    if (!intent || intent.label === 'Patrol' || intent.label === '—' || intent.label === 'Stunned') return;

    const cx = enemy.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = enemy.y * TILE_SIZE - 1;
    const dmg = intent.damage > 0 ? ` ${intent.damage}` : '';
    const text = `${intent.label}${dmg}`;
    const short = text.length > 16 ? `${intent.label.slice(0, 9)}…${dmg}` : text;

    ctx.font = 'bold 8px Courier New';
    const tw = ctx.measureText(short).width + 10;
    const bx = cx - tw / 2;
    const by = cy - 12;

    ctx.fillStyle = 'rgba(8, 8, 10, 0.82)';
    ctx.fillRect(bx, by, tw, 13);
    ctx.strokeStyle = intent.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 12);
    ctx.fillStyle = intent.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(short, cx, by + 6.5);
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 1;
}


function drawEnemyIntentBadges() {
    if (gameState.floor === 0) return;
    gameState.enemies.forEach(enemy => {
        if (!gameState.revealed[enemy.y]?.[enemy.x]) return;
        drawIntentBadge(enemy);
    });
}


function drawHoveredEnemyRing() {
    const enemy = gameState.hoverEnemy;
    if (!enemy || !gameState.revealed[enemy.y]?.[enemy.x]) return;
    const cx = enemy.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = enemy.y * TILE_SIZE + TILE_SIZE / 2;
    const pulse = 0.7 + Math.sin(gameState.frameTick * 0.12) * 0.2;
    ctx.save();
    ctx.strokeStyle = enemy.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.75 * pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.15 * pulse;
    ctx.fillStyle = enemy.color;
    ctx.fill();
    ctx.restore();
}


function drawDecoration(x, y, type) {
    const tx = x * TILE_SIZE;
    const ty = y * TILE_SIZE;
    const cx = tx + TILE_SIZE / 2;
    const cy = ty + TILE_SIZE / 2;
    const flicker = 0.85 + Math.sin(gameState.frameTick * 0.18 + x * 2.1 + y) * 0.15;

    switch (type) {
        case 'torch': {
            ctx.save();
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ffd65a';
            ctx.fillStyle = '#4a3020';
            ctx.fillRect(cx - 2, cy + 4, 4, 10);
            ctx.fillStyle = `rgba(255, ${Math.floor(140 * flicker)}, 40, ${0.45 * flicker})`;
            ctx.beginPath();
            ctx.arc(cx, cy - 2, 9 * flicker, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(255, 220, 100, ${0.65 * flicker})`;
            ctx.beginPath();
            ctx.arc(cx, cy - 1, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
            break;
        }
        case 'blood': {
            // Removed — blood splatters were visually noisy (bright red dots
            // cluttered the dungeon floor and obscured game elements).
            break;
        }
        case 'bones': {
            ctx.strokeStyle = 'rgba(200, 190, 170, 0.45)';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx - 8, cy + 4); ctx.lineTo(cx + 8, cy - 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx - 8, cy + 4, 3, 0, Math.PI * 2);
            ctx.arc(cx + 8, cy - 2, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(220, 210, 190, 0.5)';
            ctx.fill();
            ctx.lineWidth = 1;
            break;
        }
        case 'crack': {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx - 10, cy - 6); ctx.lineTo(cx - 2, cy); ctx.lineTo(cx + 8, cy + 8);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - 4, cy - 10); ctx.lineTo(cx + 2, cy - 2);
            ctx.stroke();
            ctx.lineWidth = 1;
            break;
        }
        case 'puddle': {
            const wave = Math.sin(gameState.frameTick * 0.08 + x * 0.7 + y) * 1.5;
            ctx.fillStyle = 'rgba(35, 65, 100, 0.5)';
            ctx.beginPath();
            ctx.ellipse(cx, cy + 4 + wave * 0.3, 13, 6 + wave * 0.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(80, 140, 200, 0.35)';
            ctx.beginPath();
            ctx.ellipse(cx - 2, cy + 2 + wave * 0.5, 10, 4, -0.2, 0, Math.PI * 2);
            ctx.fill();
            const shimmer = 0.12 + Math.sin(gameState.frameTick * 0.12 + x) * 0.08;
            ctx.fillStyle = `rgba(180, 220, 255, ${shimmer})`;
            ctx.beginPath();
            ctx.ellipse(cx - 4 + wave, cy + 1, 5, 2, -0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(140, 200, 255, ${0.2 + shimmer})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(cx + 3, cy + 5 + wave * 0.4, 8, 3, 0.3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
            break;
        }
        case 'statue': {
            ctx.fillStyle = 'rgba(90, 88, 82, 0.55)';
            ctx.fillRect(cx - 6, cy - 8, 12, 18);
            ctx.fillStyle = 'rgba(70, 68, 62, 0.6)';
            ctx.fillRect(cx - 8, cy + 8, 16, 4);
            ctx.fillStyle = 'rgba(110, 108, 100, 0.5)';
            ctx.beginPath();
            ctx.arc(cx, cy - 10, 5, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'moss': {
            // Organic green patches — breaks up the stone monotony, clusters
            // in corners. Three overlapping ellipses at noise-seeded positions.
            const mn = _fogNoise(x * 7.3 + 2, y * 5.1 + 9);
            const mn2 = _fogNoise(x * 4.1, y * 6.7 + 3);
            ctx.fillStyle = `rgba(38, 90, 38, ${0.45 + mn * 0.25})`;
            ctx.beginPath(); ctx.ellipse(cx - 5 + mn * 6, cy + 4 + mn2 * 4, 9, 5, mn * 0.8, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `rgba(55, 110, 40, ${0.35 + mn2 * 0.2})`;
            ctx.beginPath(); ctx.ellipse(cx + 4 + mn2 * 4, cy + 2 + mn * 3, 7, 4, -mn * 0.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `rgba(28, 72, 28, ${0.3 + mn * 0.15})`;
            ctx.beginPath(); ctx.ellipse(cx + mn * 5 - 2, cy + 7 + mn2 * 2, 10, 4, 0.2, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'rubble': {
            // Broken stone chunks — darker than walls, irregular shapes
            // that read as debris without looking like an obstacle.
            const rn = _fogNoise(x * 6.1 + 14, y * 4.7 + 7);
            const rn2 = _fogNoise(x * 2.9 + 5, y * 8.3 + 1);
            ctx.fillStyle = `rgba(60, 64, 70, ${0.55 + rn * 0.2})`;
            ctx.beginPath();
            ctx.moveTo(cx - 8 + rn * 4, cy + 6);
            ctx.lineTo(cx - 2 + rn2 * 3, cy - 4 + rn * 3);
            ctx.lineTo(cx + 7 + rn * 2, cy + 2 + rn2 * 2);
            ctx.lineTo(cx + 4, cy + 8 + rn2 * 2);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = `rgba(45, 48, 54, ${0.5 + rn2 * 0.2})`;
            ctx.beginPath();
            ctx.moveTo(cx + 2 + rn * 5, cy + 4);
            ctx.lineTo(cx + 10 + rn2 * 2, cy - 2 + rn * 2);
            ctx.lineTo(cx + 12 + rn * 3, cy + 6 + rn2);
            ctx.closePath(); ctx.fill();
            // Highlight chip
            ctx.fillStyle = `rgba(100, 108, 120, 0.35)`;
            ctx.fillRect(cx - 6 + rn * 3, cy + 5, 4, 1.5);
            break;
        }
        case 'pillar': {
            // Broken pillar stump — clearly architectural, vertical geometry
            // that breaks up the flat floor read significantly.
            const pn = _fogNoise(x * 3.7 + 11, y * 5.3 + 2);
            const shade = 55 + Math.floor(pn * 20);
            // Base/plinth
            ctx.fillStyle = `rgba(${shade - 6},${shade - 4},${shade + 4},0.7)`;
            ctx.fillRect(cx - 7, cy + 4, 14, 6);
            // Shaft
            ctx.fillStyle = `rgba(${shade},${shade - 2},${shade + 8},0.65)`;
            ctx.fillRect(cx - 5, cy - 10, 10, 15);
            // Broken top — jagged
            ctx.fillStyle = `rgba(${shade + 10},${shade + 8},${shade + 18},0.55)`;
            ctx.beginPath();
            ctx.moveTo(cx - 5, cy - 10);
            ctx.lineTo(cx - 2 + pn * 3, cy - 16 - pn * 4);
            ctx.lineTo(cx + 2, cy - 12 + pn * 2);
            ctx.lineTo(cx + 5, cy - 14 + pn * 3);
            ctx.lineTo(cx + 5, cy - 10);
            ctx.closePath(); ctx.fill();
            // Left highlight, right shadow
            ctx.fillStyle = 'rgba(160, 170, 200, 0.15)';
            ctx.fillRect(cx - 5, cy - 10, 3, 14);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(cx + 3, cy - 10, 2, 14);
            break;
        }
    }
}


function drawDungeon() {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (!gameState.revealed[y][x]) {
                drawUnrevealedFog(x, y);
                continue;
            }
            const tile = gameState.dungeon[y][x];
            if (tile === 1) drawWallTile(x, y);
            else drawFloorTexture(x, y, tile);
            drawSpecialTileTint(x, y, tile);
            // Ambient memory-lift: a very faint warm wash on every revealed
            // non-wall tile so explored areas outside the player's light radius
            // stay legible (the dungeon you've already seen shouldn't fall back
            // to near-black). Floor base is now 46–76 brightness so this is a
            // lighter touch than before — just enough to keep it readable.
            if (gameState.floor > 0 && tile !== 1) {
                ctx.fillStyle = 'rgba(65, 55, 42, 0.10)';
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    drawWallEdgeShadows();

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (!gameState.revealed[y][x]) continue;
            const tile = gameState.dungeon[y][x];
            if (gameState.floor > 0 && tile === 0 && gameState.decorGrid) {
                const decorType = gameState.decorGrid[y][x];
                if (decorType) drawDecoration(x, y, decorType);
            }
        }
    }

    drawTorchLighting();
    drawPlayerLight();
    drawExitGlows();
    drawFogParticles();

    // Stair / exit glyphs — use the cached exit-tile list instead of a third
    // full-grid scan. Zone-exit tiles (border arrows) are handled separately
    // since they only exist on floor-0 world zones and aren't in the exit cache.
    for (const { x, y, tile } of _getExitTiles()) {
        if (tile === 2) {
            ctx.save();
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#e8e0ff';
            drawGlyph(x, y, '>', '#fff', 27);
            ctx.restore();
        } else if (tile === TILE_ASCEND) {
            ctx.save();
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ffd65a';
            drawGlyph(x, y, '<', '#ffe9a0', 27);
            ctx.restore();
        } else if (tile === TILE_TAVERN_EXIT) {
            ctx.save();
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ffd65a';
            drawGlyph(x, y, 'T', '#ffe9a0', 24);
            ctx.restore();
        }
    }

    // Zone-exit border arrows — only present on generated world zones (floor 0,
    // not courtyard/town/arena). Cheap to gate on that condition rather than
    // scanning every floor for a tile type that's usually absent.
    if (gameState.floor === 0 && !gameState.inCourtyard && !gameState.inTown && !gameState.inArena) {
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                if (!gameState.revealed[y][x]) continue;
                if (gameState.dungeon[y][x] !== TILE_ZONE_EXIT) continue;
                const tx2 = x * TILE_SIZE + TILE_SIZE / 2;
                const ty2 = y * TILE_SIZE + TILE_SIZE / 2;
                ctx.save();
                ctx.globalAlpha = 0.55;
                ctx.fillStyle = '#c8b090';
                ctx.font = 'bold 14px Courier New';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                let arrow = '·';
                if (y === 0)                   arrow = '↑';
                else if (y === MAP_HEIGHT - 1) arrow = '↓';
                else if (x === 0)              arrow = '←';
                else if (x === MAP_WIDTH - 1)  arrow = '→';
                ctx.fillText(arrow, tx2, ty2);
                ctx.restore();
            }
        }
    }

    if (gameState.floor === 0 && !gameState.inCourtyard && !gameState.inArenaBout) drawTavernDetails();
}


function drawTavernDetails() {
    const upgrades = gameState.tavernUpgrades;
    const milestones = upgrades.defeatedMilestones || [];

    // ── Golden chandelier (velvet chair upgrade) ──
    if (upgrades.chandelier || upgrades.velvetChairs) {
        const cx = 12 * TILE_SIZE + TILE_SIZE / 2;
        const cy = 3 * TILE_SIZE + 8;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffd65a';
        ctx.beginPath();
        ctx.arc(cx, cy - 6, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c8a060';
        ctx.fillRect(cx - 18, cy - 2, 36, 4);
        ctx.fillStyle = '#ffd65a';
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + i * 7, cy + 2);
            ctx.lineTo(cx + i * 7 - 3, cy + 14);
            ctx.lineTo(cx + i * 7 + 3, cy + 14);
            ctx.closePath();
            ctx.fill();
        }
        ctx.fillStyle = '#ffe9a0';
        ctx.font = '8px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('CHANDELIER', cx, cy + 26);
    }

    // ── Trophy wall — mounted boss skulls ──
    const trophySpots = [[1, 4], [1, 6], [1, 8], [1, 10], [1, 11]];
    trophySpots.forEach(([tx, ty], i) => {
        const floor = milestones[i];
        const txp = tx * TILE_SIZE;
        const typ = ty * TILE_SIZE;
        ctx.fillStyle = floor ? '#3a3030' : '#252220';
        ctx.fillRect(txp + 8, typ + 18, 24, 10);
        if (floor) {
            const boss = MILESTONE_BOSSES[floor];
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = boss?.color || '#ffd65a';
            ctx.beginPath();
            ctx.arc(txp + 20, typ + 14, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#f0e8d8';
            ctx.font = 'bold 14px serif';
            ctx.textAlign = 'center';
            ctx.fillText('\u2620', txp + 20, typ + 19);
            if (boss) {
                ctx.fillStyle = '#c8a060';
                ctx.font = '6px Courier New';
                ctx.fillText(boss.glyph, txp + 20, typ + 32);
            }
        }
    });

    // ── Stools / velvet chairs ──
    const stoolColor   = upgrades.velvetChairs ? '#8B1A1A' : '#c18f45';
    const stoolRim     = upgrades.velvetChairs ? '#c8a060' : null;
    const cushionColor = upgrades.velvetChairs ? '#cc2222' : null;
    [[4,8],[5,8],[6,8],[15,8],[16,8],[15,9]].forEach(([x,y]) => {
        ctx.fillStyle = stoolColor;
        ctx.fillRect(x * TILE_SIZE + 10, y * TILE_SIZE + 10, 20, 20);
        if (stoolRim) {
            ctx.strokeStyle = stoolRim;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x * TILE_SIZE + 10, y * TILE_SIZE + 10, 20, 20);
            // cushion highlight
            ctx.fillStyle = cushionColor;
            ctx.fillRect(x * TILE_SIZE + 13, y * TILE_SIZE + 13, 14, 14);
            ctx.lineWidth = 1;
        }
    });

    // ── Trophy Hall — the tavern's centerpiece ──
    // Occupies the central rug area: a hero statue that upgrades its material
    // with progress, flanked by engraved plaques showing the player's record.
    drawTrophyHall(upgrades);
    drawShopAreas(upgrades);  // per-NPC environmental dressing

    // ── Skull trophy pedestal (top-right area, x=21 y=2) ──
    const px = 21 * TILE_SIZE;
    const py = 2  * TILE_SIZE;
    // Pedestal base
    ctx.fillStyle = upgrades.skeletonKingSkull ? '#4a4040' : '#383030';
    ctx.fillRect(px + 6, py + 24, 28, 12);
    ctx.strokeStyle = upgrades.skeletonKingSkull ? '#a08060' : '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 6, py + 24, 28, 12);
    // Pedestal column
    ctx.fillStyle = upgrades.skeletonKingSkull ? '#3a3030' : '#2e2626';
    ctx.fillRect(px + 14, py + 16, 12, 10);

    if (upgrades.skeletonKingSkull) {
        // Glow halo
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        ctx.arc(px + 20, py + 13, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        // Skull glyph
        ctx.fillStyle = '#f0e8d8';
        ctx.font = 'bold 16px serif';
        ctx.textAlign = 'center';
        ctx.fillText('☠', px + 20, py + 19);
        // Label
        ctx.fillStyle = '#c8a060';
        ctx.font = '7px Courier New';
        ctx.fillText('BOSS TROPHY', px + 20, py + 38);
    } else {
        // Empty pedestal hint
        ctx.fillStyle = '#555';
        ctx.font = '7px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('PEDESTAL', px + 20, py + 38);
        ctx.fillStyle = '#444';
        ctx.font = '11px serif';
        ctx.fillText('?', px + 20, py + 19);
    }

    // ── Iron Sconces (cosmetic) — adds a wrought-iron bracket beneath
    // each tavern torch, drawn before the shared drawDecoration() torch
    // flame so the bracket sits visually behind the fire. Scoped to the
    // tavern's own torch list rather than touching drawDecoration()
    // itself, since that function is shared with the dungeon's torches
    // and this upgrade should only affect the tavern. ──
    const tavernTorchSpots = [[2, 8], [22, 8], [12, 3], [12, 15], [8, 4], [16, 4]];
    if (upgrades.ironSconces) {
        tavernTorchSpots.forEach(([x, y]) => {
            const cx = x * TILE_SIZE + TILE_SIZE / 2;
            const cy = y * TILE_SIZE + TILE_SIZE / 2;
            // Positioned well clear of the torch flame's own glow radius
            // (drawDecoration's torch case glows up to ~10px around
            // cy-2) — too close and the bracket gets visually swallowed
            // by the flame's soft shadowBlur rather than reading as a
            // distinct support structure beneath it.
            ctx.strokeStyle = '#9c8f7a';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(cx, cy + 13, 8, Math.PI * 0.1, Math.PI * 0.9);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - 6, cy + 15);
            ctx.lineTo(cx - 6, cy + 21);
            ctx.moveTo(cx + 6, cy + 15);
            ctx.lineTo(cx + 6, cy + 21);
            ctx.stroke();
            ctx.lineWidth = 1;
        });
    }
    tavernTorchSpots.forEach(([x, y]) => {
        drawDecoration(x, y, 'torch');
    });

    // ── Polished Bar (cosmetic) — a row of shine glints along the bar
    // counter strip (y=4, x 8-16 — see drawFloorTexture's tavern
    // branch for the base counter color this overlays). ──
    if (upgrades.polishedBar) {
        for (let bx = 8; bx <= 16; bx++) {
            const gx = bx * TILE_SIZE;
            const gy = 4 * TILE_SIZE;
            const shine = 0.12 + Math.sin(gameState.frameTick * 0.03 + bx * 1.3) * 0.06;
            ctx.fillStyle = `rgba(255, 240, 210, ${shine})`;
            ctx.fillRect(gx + 4, gy + 6, TILE_SIZE - 8, 3);
        }
    }

    // ── Tavern Cat (cosmetic) — a small wandering cat sprite, drifting
    // along a slow deterministic path so it reads as alive without
    // needing real pathing/AI logic. ──
    if (upgrades.tavernCat) {
        const t = gameState.frameTick * 0.012;
        const catX = 11.5 + Math.sin(t) * 2.4;
        const catY = 12.5 + Math.cos(t * 0.7) * 1.4;
        const cx = catX * TILE_SIZE;
        const cy = catY * TILE_SIZE;
        const facingLeft = Math.cos(t) < 0;
        ctx.save();
        ctx.translate(cx, cy);
        if (facingLeft) ctx.scale(-1, 1);
        // Brightened from the original near-black silhouette, which
        // blended almost completely into the floor's own dark tone at
        // this size — a warm gray reads as "a small dark animal" while
        // still looking distinct from the brighter NPC/player tokens.
        ctx.fillStyle = '#6b5d4f';
        ctx.beginPath();
        ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(7, -3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(9, -6); ctx.lineTo(11, -10); ctx.lineTo(7, -7);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-8, 1);
        ctx.quadraticCurveTo(-15, -2, -12, 4);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#6b5d4f';
        ctx.stroke();
        // Small warm eye-glint — sells "creature in the dark" rather
        // than a flat dark shape, and fits the torch-lit tavern mood.
        ctx.fillStyle = 'rgba(255, 214, 120, 0.9)';
        ctx.beginPath();
        ctx.arc(8.5, -4, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    ctx.textAlign = 'left';
    ctx.lineWidth = 1;

    drawTavernFireplace();
    drawTavernDustMotes();
    drawMilestoneDecorations(milestones);
    drawLegendaryGuests(milestones);
    drawTavernPatrons(milestones);
    drawTavernSpeech(milestones);
}


// ── Trophy Hall ─────────────────────────────────────────────────────────────────
// The tavern's emotional centerpiece: a hero statue on the central rug that
// upgrades stone→bronze→silver→gold with progress, flanked by engraved plaques
// recording the player's deepest floor, bosses slain, arena victories, and
// legendary finds. Reads entirely from existing meta stats — no new tracking.

function drawTrophyHall(upgrades) {
    const rx = 9 * TILE_SIZE + 4;
    const ry = 6 * TILE_SIZE + 4;
    const rw = 7 * TILE_SIZE - 8;
    const rh = 5 * TILE_SIZE - 8;

    // ── The rug (always present now — it's the hall floor) ──
    // Richer once the royalRug upgrade is bought, plain woven mat before that.
    const royal = upgrades.royalRug;
    ctx.fillStyle = royal ? 'rgba(90,30,30,0.30)' : 'rgba(60,45,30,0.22)';
    ctx.fillRect(rx + 3, ry + 3, rw - 6, rh - 6);
    ctx.strokeStyle = royal ? '#8B5E1A' : '#5a4326';
    ctx.lineWidth = 3;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.strokeStyle = royal ? '#c8a060' : '#7a5e36';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 5, ry + 5, rw - 10, rh - 10);
    if (royal) {
        ctx.strokeStyle = 'rgba(255, 214, 90, 0.30)';
        for (let i = 0; i < 5; i++) {
            const fy = ry + 12 + i * ((rh - 24) / 4);
            ctx.beginPath();
            ctx.moveTo(rx + 10, fy);
            ctx.lineTo(rx + rw - 10, fy);
            ctx.stroke();
        }
    }
    ctx.lineWidth = 1;

    // ── Hero statue (center of the hall) ──
    const tier = (typeof getHeroStatueTier === 'function') ? getHeroStatueTier() : null;
    const className = gameState.player?.className || 'warrior';
    const scx = rx + rw / 2;           // statue center x
    const baseY = ry + rh - 26;        // pedestal top y
    _drawHeroStatue(scx, baseY, tier, className);

    // ── Trophy plaques (two per side, flanking the statue) ──
    const best = gameState.bestFloor || 0;
    const bosses = gameMeta.bossesSlain || 0;
    const wins = gameMeta.pitWins || 0;
    const legends = gameMeta.stats?.legendariesFound || 0;
    const plaques = [
        { label: 'DEEPEST', value: best > 0 ? `Floor ${best}` : '—' },
        { label: 'BOSSES',  value: String(bosses) },
        { label: 'PIT',     value: wins > 0 ? `${wins} won` : '—' },
        { label: 'LEGENDS', value: String(legends) },
    ];
    // Positions: two on the left edge, two on the right edge of the rug.
    // Spread vertically to avoid overlap with the larger 76x42 plaques.
    const plaqueSpots = [
        { x: rx + 40,      y: ry + 30 },
        { x: rx + 40,      y: ry + 82 },
        { x: rx + rw - 40, y: ry + 30 },
        { x: rx + rw - 40, y: ry + 82 },
    ];
    plaques.forEach((pl, i) => _drawTrophyPlaque(plaqueSpots[i].x, plaqueSpots[i].y, pl.label, pl.value, tier));

    // Hall title along the bottom edge
    ctx.fillStyle = tier ? tier.light : '#c8a060';
    ctx.font = 'bold 11px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('\u2014 HALL OF HEROES \u2014', scx, ry + rh - 7);
    ctx.textAlign = 'left';
}

// Draws the upgrading hero statue: a class-tinted silhouette on a pedestal,
// rendered in the current tier's metal palette with a sheen that grows by tier.
function _drawHeroStatue(cx, baseY, tier, className) {
    const pal = tier || { base: '#6e6a63', light: '#8d887e', dark: '#4c4944', sheen: 0.05 };

    // Pedestal
    ctx.fillStyle = '#3a332a';
    ctx.fillRect(cx - 20, baseY, 40, 14);
    ctx.fillStyle = '#2c2620';
    ctx.fillRect(cx - 22, baseY + 12, 44, 6);
    ctx.fillStyle = pal.dark;
    ctx.fillRect(cx - 18, baseY - 2, 36, 4);

    // Subtle aura glow for higher tiers (silver/gold), pulsing gently
    if (pal.sheen >= 0.18) {
        const pulse = 0.5 + Math.sin(gameState.frameTick * 0.05) * 0.5;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(cx, baseY - 22, 2, cx, baseY - 22, 34);
        g.addColorStop(0, `rgba(255, 240, 190, ${pal.sheen * 0.5 * pulse})`);
        g.addColorStop(1, 'rgba(255, 240, 190, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, baseY - 22, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Statue body — a simple heroic figure, shaded with the tier's metal tones.
    const topY = baseY - 44; // head top
    // Legs
    ctx.fillStyle = pal.dark;
    ctx.fillRect(cx - 8, baseY - 18, 6, 18);
    ctx.fillRect(cx + 2, baseY - 18, 6, 18);
    // Torso
    ctx.fillStyle = pal.base;
    ctx.fillRect(cx - 10, baseY - 34, 20, 18);
    // Lit side highlight
    ctx.fillStyle = pal.light;
    ctx.fillRect(cx - 10, baseY - 34, 5, 18);
    // Head
    ctx.fillStyle = pal.base;
    ctx.beginPath();
    ctx.arc(cx, topY + 6, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.light;
    ctx.beginPath();
    ctx.arc(cx - 2, topY + 4, 3, 0, Math.PI * 2);
    ctx.fill();

    // Class-flavored prop so the statue reads as the player's hero:
    // warrior/cleric → raised sword; mage → staff; rogue → dagger.
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (className === 'mage') {
        // staff with an orb
        ctx.moveTo(cx + 12, baseY - 36);
        ctx.lineTo(cx + 12, baseY - 6);
        ctx.stroke();
        ctx.fillStyle = pal.light;
        ctx.beginPath();
        ctx.arc(cx + 12, baseY - 40, 4, 0, Math.PI * 2);
        ctx.fill();
    } else if (className === 'rogue') {
        // short raised dagger
        ctx.moveTo(cx + 11, baseY - 30);
        ctx.lineTo(cx + 16, baseY - 42);
        ctx.stroke();
    } else {
        // raised sword (warrior/cleric)
        ctx.moveTo(cx + 12, baseY - 30);
        ctx.lineTo(cx + 12, baseY - 50);
        ctx.stroke();
        ctx.beginPath(); // crossguard
        ctx.moveTo(cx + 7, baseY - 44);
        ctx.lineTo(cx + 17, baseY - 44);
        ctx.stroke();
    }
    ctx.lineWidth = 1;

    // Tier nameplate on the pedestal face
    if (tier) {
        ctx.fillStyle = pal.light;
        ctx.font = 'bold 7px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText(tier.name.toUpperCase(), cx, baseY + 10);
    }
}

// A small engraved plaque: a metal frame with a label and a value.
function _drawTrophyPlaque(cx, cy, label, value, tier) {
    const w = 76, h = 42;
    const x = cx - w / 2, y = cy - h / 2;
    const frame = tier ? tier.dark : '#5a4326';
    const lightCol = tier ? tier.light : '#c8a060';

    ctx.fillStyle = 'rgba(20, 16, 12, 0.82)';
    _roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = frame;
    ctx.lineWidth = 1.5;
    _roundRect(x, y, w, h, 4);
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.fillStyle = 'rgba(200, 180, 140, 0.75)';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, y + 14);

    ctx.fillStyle = lightCol;
    ctx.font = 'bold 13px Courier New';
    ctx.fillText(value, cx, y + 32);
    ctx.textAlign = 'left';
}


// ── Shop physical identity ─────────────────────────────────────────────────────
// Each NPC area gets environmental dressing so a player can recognise the shop
// purpose before reading any label. Drawn before NPCs so furniture sits behind
// the character sprites. Uses tile positions from gameState NPC coords.

function drawShopAreas(upgrades) {
    // Commerce NPCs moved to the Market; only the Innkeeper area remains
    // in the tavern interior. The forge, bank vault, merchant stall, and
    // trainer yard environmental draws are suppressed — those rooms' walls
    // no longer exist and the NPCs are now in the courtyard.
    _drawInnkeeperArea(upgrades);
    // Ambient renown unlocks
    if (typeof isRenownUnlocked === 'function') {
        if (isRenownUnlocked('portraitFrame')) _drawPortraitFrame();
        if (isRenownUnlocked('goldenBanners')) _drawGoldenBanners();
    }
}

// ── Blacksmith (22,7) — forge glow, anvil, weapon racks ──────────────────────
function _drawBlacksmithArea(upgrades) {
    const bx = 22 * TILE_SIZE; // NPC tile origin
    const by = 7 * TILE_SIZE;

    // Forge box — sits directly behind the blacksmith (same column, one tile
    // up at x=22, y=6) so the forge and smith read as a single station rather
    // than a detached box floating to the side.
    const fx = 22 * TILE_SIZE + 6;
    const fy = 6  * TILE_SIZE + 6;
    const fw = 28, fh = 28;

    // Animated forge glow — pulses with coal-fire warmth
    const glow = 0.55 + Math.sin(gameState.frameTick * 0.08) * 0.18
                      + Math.sin(gameState.frameTick * 0.19) * 0.06;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const forgeGrad = ctx.createRadialGradient(fx + fw/2, fy + fh/2, 2, fx + fw/2, fy + fh/2, 52);
    forgeGrad.addColorStop(0, `rgba(255, 160, 40, ${glow * 0.55})`);
    forgeGrad.addColorStop(0.4, `rgba(255, 80, 10, ${glow * 0.22})`);
    forgeGrad.addColorStop(1, 'rgba(180, 40, 0, 0)');
    ctx.fillStyle = forgeGrad;
    ctx.beginPath(); ctx.arc(fx + fw/2, fy + fh/2, 52, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // Forge body — stone surround with glowing interior
    ctx.fillStyle = '#2a2220';
    ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = `rgba(255, ${80 + Math.floor(glow * 60)}, 20, ${0.7 + glow * 0.2})`;
    ctx.fillRect(fx + 5, fy + 8, fw - 10, fh - 12); // fire box opening
    // Stone frame
    ctx.strokeStyle = '#4a3830';
    ctx.lineWidth = 2;
    ctx.strokeRect(fx, fy, fw, fh);
    // Forge label
    ctx.fillStyle = '#c08050';
    ctx.font = '7px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('FORGE', fx + fw/2, fy + fh + 9);

    // Anvil — sits on x=23, y=8 (beside the smith)
    const ax = 23 * TILE_SIZE + 6, ay = 8 * TILE_SIZE + 16;
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(ax, ay,     28, 10); // top face
    ctx.fillRect(ax + 6, ay + 10, 16, 6); // waist
    ctx.fillRect(ax + 2, ay + 16, 24, 6); // base
    ctx.fillStyle = '#3e3e3e';
    ctx.fillRect(ax + 2, ay, 6, 4);      // horn
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(ax, ay, 28, 3);          // top sheen
    ctx.lineWidth = 1;

    // Weapon rack on the wall (x=24, y=5..7) — three silhouette weapons
    const wr = [[24, 5], [24, 6], [24, 7]];
    const weaponGlyphs = ['†', '⚔', '🗡'];
    const weaponColors = ['#8a8070', '#9a8870', '#7a7060'];
    wr.forEach(([wx, wy], i) => {
        ctx.fillStyle = weaponColors[i];
        ctx.font = '14px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(weaponGlyphs[i] || '†', wx * TILE_SIZE + TILE_SIZE/2, wy * TILE_SIZE + TILE_SIZE/2);
        // Rack peg
        ctx.fillStyle = '#5a4030';
        ctx.fillRect(wx * TILE_SIZE + 4, wy * TILE_SIZE + 22, TILE_SIZE - 8, 3);
    });
    ctx.textBaseline = 'alphabetic';
}

// ── Bank (10,2) — vault door, gold piles ─────────────────────────────────────
function _drawBankArea(upgrades) {
    // Vault door at (9,1) — heavy circular door with rivets
    const vx = 9 * TILE_SIZE + 4, vy = 1 * TILE_SIZE + 4;
    const vw = TILE_SIZE - 8, vh = TILE_SIZE - 8;
    const vcx = vx + vw/2, vcy = vy + vh/2;
    const vr = Math.min(vw, vh) / 2 - 1;

    // Door body
    ctx.fillStyle = '#3a3530';
    ctx.beginPath(); ctx.arc(vcx, vcy, vr, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#6a5a48';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(vcx, vcy, vr, 0, Math.PI*2); ctx.stroke();
    // Inner ring
    ctx.strokeStyle = '#8a7a62';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(vcx, vcy, vr * 0.65, 0, Math.PI*2); ctx.stroke();
    // Rivets around the edge
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const rx2 = vcx + Math.cos(a) * (vr - 4);
        const ry2 = vcy + Math.sin(a) * (vr - 4);
        ctx.fillStyle = '#8a7a62';
        ctx.beginPath(); ctx.arc(rx2, ry2, 2, 0, Math.PI*2); ctx.fill();
    }
    // Handle/wheel spokes
    ctx.strokeStyle = '#c8a060';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(vcx - Math.cos(a)*6, vcy - Math.sin(a)*6);
        ctx.lineTo(vcx + Math.cos(a) * (vr * 0.55), vcy + Math.sin(a) * (vr * 0.55));
        ctx.stroke();
    }
    ctx.fillStyle = '#c8a060';
    ctx.beginPath(); ctx.arc(vcx, vcy, 5, 0, Math.PI*2); ctx.fill();
    ctx.lineWidth = 1;

    // Gold stack ingots at (10,3) — below the bank NPC
    const gx = 10 * TILE_SIZE + 6, gy = 3 * TILE_SIZE + 18;
    [[0,0],[4,-5],[8,0],[2,-10]].forEach(([ox, oy]) => {
        ctx.fillStyle = '#c8a030';
        ctx.fillRect(gx + ox, gy + oy, 16, 7);
        ctx.fillStyle = '#ffd65a';
        ctx.fillRect(gx + ox, gy + oy, 16, 2); // top sheen
        ctx.strokeStyle = '#8a6a10';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(gx + ox, gy + oy, 16, 7);
    });
    ctx.lineWidth = 1;
}

// ── Merchant (18,9) — crates, shelves with potions ───────────────────────────
function _drawMerchantArea() {
    // Stacked crates at (19,9) and (19,10)
    [[19,9],[19,10]].forEach(([cx2, cy2], i) => {
        const crx = cx2 * TILE_SIZE + 4, cry = cy2 * TILE_SIZE + (i === 0 ? 8 : 12);
        const cw = TILE_SIZE - 10, ch = i === 0 ? 26 : 20;
        ctx.fillStyle = i === 0 ? '#5a3e22' : '#4a3218';
        ctx.fillRect(crx, cry, cw, ch);
        // Crate cross-bracing
        ctx.strokeStyle = '#3a2614';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crx, cry); ctx.lineTo(crx + cw, cry + ch);
        ctx.moveTo(crx + cw, cry); ctx.lineTo(crx, cry + ch);
        ctx.stroke();
        ctx.strokeRect(crx, cry, cw, ch);
    });

    // Potion shelf at (20,8) — small vials on a wooden plank
    const sx = 20 * TILE_SIZE, sy = 8 * TILE_SIZE;
    ctx.fillStyle = '#5a3e22';
    ctx.fillRect(sx + 2, sy + 26, TILE_SIZE - 4, 4); // shelf plank
    // Three potion vials
    const potColors = ['#e74c3c', '#3498db', '#27ae60'];
    potColors.forEach((col, i) => {
        const px = sx + 5 + i * 10;
        const py = sy + 14;
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(px, py, 7, 12); // body
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#8a7060';
        ctx.fillRect(px + 2, py - 3, 3, 4); // neck
        ctx.fillStyle = `rgba(255,255,255,0.3)`;
        ctx.fillRect(px + 1, py + 2, 2, 5); // glass sheen
    });
    ctx.lineWidth = 1;
}

// ── Trainer (22,11) — practice dummy, crossed weapons ────────────────────────
function _drawTrainerArea() {
    // Practice dummy at (23,12) — post with a padded cross-arm
    const dx = 23 * TILE_SIZE + TILE_SIZE/2, dy = 12 * TILE_SIZE;
    // Post
    ctx.fillStyle = '#5a3e22';
    ctx.fillRect(dx - 3, dy + 6, 6, 28);
    // Padded torso head
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(dx - 10, dy + 8, 20, 16);
    ctx.fillStyle = '#7a5a30';
    ctx.fillRect(dx - 8, dy + 8, 5, 16);  // shading
    // Arms cross-bar
    ctx.fillStyle = '#5a3e22';
    ctx.fillRect(dx - 14, dy + 10, 28, 4);
    // Rope bindings
    ctx.strokeStyle = '#9a7a40';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(dx, dy + 10 + i * 4, 4, 0, Math.PI*2);
        ctx.stroke();
    }

    // Training mat at (22,12) — a flat rectangle with worn lines
    const mx = 22 * TILE_SIZE + 2, my = 12 * TILE_SIZE + 28;
    ctx.fillStyle = 'rgba(80, 100, 60, 0.55)';
    ctx.fillRect(mx, my, TILE_SIZE - 4, 8);
    ctx.strokeStyle = 'rgba(120, 150, 80, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + 2, my + 1, TILE_SIZE - 8, 6);
    ctx.lineWidth = 1;
}

// ── Innkeeper (12,5) — bar counter, kegs ─────────────────────────────────────
function _drawInnkeeperArea(upgrades) {
    // Bar counter runs along y=4, x=9..15 (already has stools from velvetChairs)
    // Draw the bar surface and kegs behind it
    const barY = 4 * TILE_SIZE;
    const barColor = upgrades.polishedBar ? '#6a4a1e' : '#4e3618';
    const barSheen = upgrades.polishedBar ? 'rgba(255, 210, 140, 0.18)' : 'rgba(255, 200, 120, 0.06)';

    // Bar counter front face (x=9..15, bottom of tile row 4)
    for (let bx = 9; bx <= 15; bx++) {
        const px = bx * TILE_SIZE;
        // Counter surface
        ctx.fillStyle = barColor;
        ctx.fillRect(px + 2, barY + 22, TILE_SIZE - 4, 14);
        // Surface sheen (stronger with polished bar upgrade)
        ctx.fillStyle = barSheen;
        ctx.fillRect(px + 2, barY + 22, TILE_SIZE - 4, 4);
        // Toe-board
        ctx.fillStyle = '#2e1e0a';
        ctx.fillRect(px + 4, barY + 34, TILE_SIZE - 8, 4);
    }

    // Kegs behind the bar at y=3, x=8..11
    [[8,3],[9,3],[10,3],[11,3]].forEach(([kx, ky], i) => {
        const px = kx * TILE_SIZE + 6, py = ky * TILE_SIZE + 8;
        const kw = TILE_SIZE - 12, kh = 24;
        ctx.fillStyle = i % 2 === 0 ? '#5a3a18' : '#4a3010';
        ctx.fillRect(px, py, kw, kh);
        // Keg bands
        ctx.strokeStyle = '#8a6030';
        ctx.lineWidth = 1.5;
        [py + 5, py + kh - 6].forEach(band => {
            ctx.beginPath();
            ctx.moveTo(px, band); ctx.lineTo(px + kw, band);
            ctx.stroke();
        });
        // Tap
        ctx.fillStyle = '#c8a060';
        ctx.fillRect(px + kw/2 - 2, py + kh - 4, 4, 6);
        ctx.lineWidth = 1;
    });
}
// Decorative tavern-goers that make the room feel inhabited. Pure render-layer:
// they live in a module-local array (never saved, no gameState/RNG impact) and
// wander between fixed anchor points. Their NUMBER scales with how many
// milestone bosses the player has defeated — a broken, near-empty tavern early
// on that fills with life as the player becomes a legend (the "tavern evolves"
// progression made literal).

// ── Ambient Renown unlocks (visual) ──────────────────────────────────────────

// Renown 125: a small painted portrait of the player's hero hangs near the
// Trophy Hall — a personalised mark that the Flagon recognises their champion.
function _drawPortraitFrame() {
    const px = 8 * TILE_SIZE + 4, py = 4 * TILE_SIZE + 4;
    const pw = 28, ph = 32;
    const className = gameState.player?.className || 'warrior';
    const tier = typeof getHeroStatueTier === 'function' ? getHeroStatueTier() : null;
    const frameColor = tier ? tier.light : '#c8a060';
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.fillStyle = frameColor;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(px + pw/2, py + 10, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.fillRect(px + pw/2 - 5, py + 14, 10, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = frameColor;
    ctx.font = '6px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(className.slice(0,1).toUpperCase() + '.', px + pw/2, py + ph - 4);
    ctx.lineWidth = 1;
}

// Renown 400: golden banners hung from the walls celebrate the champion.
function _drawGoldenBanners() {
    const bannerPositions = [[2, 3], [7, 3], [20, 3], [24, 3]];
    const pulse = 0.7 + Math.sin(gameState.frameTick * 0.04) * 0.15;
    bannerPositions.forEach(([bx, by]) => {
        const px = bx * TILE_SIZE + 8, py = by * TILE_SIZE + 2;
        const bw = 22, bh = 30;
        ctx.fillStyle = `rgba(${Math.floor(180 * pulse)}, ${Math.floor(140 * pulse)}, 30, 0.75)`;
        ctx.fillRect(px, py, bw, bh);
        ctx.fillStyle = `rgba(255, 230, 120, ${0.18 * pulse})`;
        ctx.fillRect(px + 3, py + 2, 6, bh - 4);
        ctx.fillStyle = `rgba(255, 240, 180, ${0.6 * pulse})`;
        ctx.beginPath();
        ctx.moveTo(px + bw/2, py + 8);
        ctx.lineTo(px + bw/2 + 5, py + 15);
        ctx.lineTo(px + bw/2, py + 22);
        ctx.lineTo(px + bw/2 - 5, py + 15);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#c8a060';
        ctx.fillRect(px - 2, py, bw + 4, 3);
    });
}


let _patrons = null;

// Anchor points patrons stand/drift around — chosen to sit in open tavern
// floor, clear of the NPC tiles and the central walkway. [tileX, tileY].
const PATRON_ANCHORS = [
    [4, 9], [5, 10], [6, 9],        // near the hearth / left tables
    [9, 4], [10, 5], [11, 4],       // by the bar
    [15, 5], [16, 6],               // right of the bar
    [8, 11], [9, 12], [13, 11],     // lower commons
    [3, 4], [17, 12], [14, 8],      // scattered fill
];

function _patronCountForProgress(milestones) {
    // Patron count reflects both dungeon progress (milestones) and overall
    // Tavern Renown — a sparse tavern early on that fills with life as the
    // player becomes a legend on either track.
    const bosses = (milestones || []).length;
    const renownTier = Math.floor((gameMeta.tavernRenown || 0) / 50); // 0,1,2...10
    return Math.min(PATRON_ANCHORS.length, 2 + bosses * 2 + renownTier);
}

function _initPatrons() {
    _patrons = PATRON_ANCHORS.map((a, i) => ({
        homeX: a[0], homeY: a[1],
        x: a[0], y: a[1],
        // Per-patron palette + size variety so the crowd doesn't look cloned
        bodyColor: ['#6b4a32', '#7a5240', '#5e4738', '#6f5a44', '#80604a', '#5a4a3c', '#74553f'][i % 7],
        headColor: ['#caa987', '#b89878', '#d2b48c', '#c0a080'][i % 4],
        phase: (i * 1.7) % (Math.PI * 2),
        bobSpeed: 0.04 + (i % 3) * 0.01,
        // Occasional small drift toward home so they're not perfectly static
        drift: 0,
    }));
}

function drawTavernPatrons(milestones) {
    if (!_patrons) _initPatrons();
    const count = _patronCountForProgress(milestones);

    for (let i = 0; i < count; i++) {
        const p = _patrons[i];
        const cx = p.homeX * TILE_SIZE + TILE_SIZE / 2;
        const baseY = p.homeY * TILE_SIZE + TILE_SIZE - 6;
        const bob = Math.sin(gameState.frameTick * p.bobSpeed + p.phase) * 1.6;
        const feetY = baseY + bob;

        // Soft shadow
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(cx, baseY + 2, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // Body
        ctx.fillStyle = p.bodyColor;
        ctx.fillRect(cx - 6, feetY - 16, 12, 16);
        // Head
        ctx.fillStyle = p.headColor;
        ctx.beginPath();
        ctx.arc(cx, feetY - 19, 5, 0, Math.PI * 2);
        ctx.fill();
        // A few patrons raise a mug now and then (drinking gesture)
        if (i % 3 === 0) {
            const raise = (Math.sin(gameState.frameTick * 0.03 + p.phase) + 1) * 0.5; // 0..1
            const mugY = feetY - 12 - raise * 4;
            ctx.fillStyle = '#3a2a1c';
            ctx.fillRect(cx + 5, mugY, 4, 5);
        }
    }
}


// ── Ambient speech bubbles ──────────────────────────────────────────────────────
// Occasional one-liners that pop above patrons/NPCs and fade, layering chatter
// onto the room. Lines are a mix of static tavern flavor and dynamic lines that
// reference the player's real progress (current best floor, defeated bosses).

let _activeSpeech = null;   // { x, y, text, life, maxLife }
let _nextSpeechAt = 0;

function _buildSpeechLines(milestones) {
    const lines = [
        'They say the ash never settles below Floor 50.',
        'Another round! To those who never came back.',
        'The Blacksmith\u2019s looking for good ore again.',
        'I heard the Pit\u2019s champion drinks here.',
        'Mind the cellar. Strange things down there.',
        'You smell that? Forge\u2019s been burning all night.',
        'Heard the Merchant got a cursed ring in.',
        'Bard! Play the one about the Fallen God.',
        'Don\u2019t trust the dice table. Just don\u2019t.',
        'Forty floors and not a scratch, that one.',
    ];
    const best = gameState.bestFloor || 0;
    const renown = gameMeta.tavernRenown || 0;
    if (best > 0) lines.push(`Floor ${best}? You\u2019re lucky to be alive.`);
    if (best >= 20) lines.push('A real delver, this one. Survived the Pit\u2019s gate.');
    (milestones || []).forEach(fl => {
        const boss = MILESTONE_BOSSES[fl];
        if (boss) lines.push(`${boss.name} fell to a mortal. Can you believe it?`);
    });
    // Renown 40+: bard has learned songs referencing real deeds
    if (renown >= 40) {
        lines.push('The bard\u2019s got a new song. Something about ash and defiance.');
        if (best >= 25) lines.push('Heard the bard singing about someone who reached Floor ' + best + '. Standing right here, they are.');
    }
    // Renown 300+: speech references the player by name
    if (renown >= 300) {
        const name = gameState.player?.name || 'the delver';
        lines.push(`${name} again. The Flagon\u2019s own legend.`);
        lines.push(`You hear that song? Bard wrote it about ${name}.`);
        if (milestones && milestones.length > 0) {
            const fl = milestones[milestones.length - 1];
            const boss = MILESTONE_BOSSES[fl];
            if (boss) lines.push(`...and they say ${name} killed the ${boss.name} with their bare hands.`);
        }
    }
    return lines;
}

function drawTavernSpeech(milestones) {
    const now = gameState.frameTick;

    // Schedule the next bubble if none active and the cooldown has passed.
    if (!_activeSpeech && now >= _nextSpeechAt) {
        const count = _patronCountForProgress(milestones);
        if (count > 0) {
            const lines = _buildSpeechLines(milestones);
            const speaker = _patrons[Math.floor(Math.random() * count)];
            _activeSpeech = {
                x: speaker.homeX * TILE_SIZE + TILE_SIZE / 2,
                y: speaker.homeY * TILE_SIZE,
                text: lines[Math.floor(Math.random() * lines.length)],
                life: 220,       // frames visible
                maxLife: 220,
            };
        }
        // Next bubble in ~4-8 seconds (assuming ~60fps); not seeded — pure ambiance.
        _nextSpeechAt = now + 260 + Math.floor(Math.random() * 260);
    }

    if (_activeSpeech) {
        const s = _activeSpeech;
        s.life--;
        if (s.life <= 0) { _activeSpeech = null; return; }
        // Fade in/out at the ends of life
        const fadeIn = Math.min(1, (s.maxLife - s.life) / 20);
        const fadeOut = Math.min(1, s.life / 30);
        const alpha = Math.min(fadeIn, fadeOut);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '11px "Courier New", monospace';
        const padding = 8;
        const textW = ctx.measureText(s.text).width;
        const bw = textW + padding * 2;
        const bh = 22;
        let bx = s.x - bw / 2;
        let by = s.y - bh - 8;
        // Keep the bubble on-screen horizontally
        bx = Math.max(4, Math.min(bx, MAP_WIDTH * TILE_SIZE - bw - 4));

        // Bubble body
        ctx.fillStyle = 'rgba(28, 24, 18, 0.92)';
        ctx.strokeStyle = 'rgba(255, 214, 90, 0.5)';
        ctx.lineWidth = 1;
        _roundRect(bx, by, bw, bh, 6);
        ctx.fill();
        ctx.stroke();
        // Tail
        ctx.beginPath();
        ctx.moveTo(s.x - 5, by + bh);
        ctx.lineTo(s.x + 5, by + bh);
        ctx.lineTo(s.x, by + bh + 6);
        ctx.closePath();
        ctx.fillStyle = 'rgba(28, 24, 18, 0.92)';
        ctx.fill();
        // Text
        ctx.fillStyle = '#f0e6d0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.text, bx + bw / 2, by + bh / 2);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// Small rounded-rect path helper (canvas has no native one pre-roundRect support)
function _roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}


// ── Milestone decorations ──────────────────────────────────────────────────────
// Each defeated milestone boss leaves a permanent visual mark on the tavern.
// All drawing uses ctx directly (already in scope from drawTavernDetails' closure
// being the same frame — these are separate functions purely for readability).

function drawMilestoneDecorations(milestones) {
    if (!milestones || !milestones.length) return;
    const hasFloor = f => milestones.includes(f);

    // ── Floor 10 (Goblin King): Hunting board on the left wall ──
    // A small corkboard with crossed arrows and a crude map — signals that
    // the dungeon is being tracked and catalogued, not just stumbled into.
    if (hasFloor(10)) {
        const bx = 1 * TILE_SIZE + 4;
        const by = 3 * TILE_SIZE + 4;
        // Board backing
        ctx.fillStyle = '#4a3820';
        ctx.fillRect(bx, by, 32, 30);
        ctx.strokeStyle = '#6b4f28';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, 32, 30);
        // Crossed arrows
        ctx.strokeStyle = '#c8a060';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + 6,  by + 6);  ctx.lineTo(bx + 26, by + 24);
        ctx.moveTo(bx + 26, by + 6);  ctx.lineTo(bx + 6,  by + 24);
        ctx.stroke();
        // Goblin glyph
        ctx.fillStyle = '#d32f2f';
        ctx.font = 'bold 10px serif';
        ctx.textAlign = 'center';
        ctx.fillText('G', bx + 16, by + 18);
        ctx.fillStyle = '#c8a060';
        ctx.font = '6px Courier New';
        ctx.fillText('FL.10', bx + 16, by + 28);
        ctx.textAlign = 'left';
        ctx.lineWidth = 1;
    }

    // ── Floor 25 (Bone Dragon): Dragon scale mounted near the fireplace ──
    // An iridescent shield-shaped scale hung below the fireplace — trophy
    // of something much larger than a goblin.
    if (hasFloor(25)) {
        const dx = 22 * TILE_SIZE + 2;
        const dy = 4 * TILE_SIZE + 4;
        const shimmer = 0.7 + Math.sin(gameState.frameTick * 0.08) * 0.15;
        // Scale shape (tall ellipse)
        ctx.save();
        ctx.globalAlpha = shimmer;
        ctx.fillStyle = '#b0c8e0';
        ctx.beginPath();
        ctx.ellipse(dx + 18, dy + 14, 13, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        // Iridescent highlight
        ctx.fillStyle = 'rgba(200, 240, 255, 0.5)';
        ctx.beginPath();
        ctx.ellipse(dx + 14, dy + 10, 6, 9, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#7fffd4';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(dx + 18, dy + 14, 13, 18, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#7fffd4';
        ctx.font = '6px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('DRAGON SCALE', dx + 18, dy + 36);
        ctx.textAlign = 'left';
        ctx.lineWidth = 1;
    }

    // ── Floor 50 (Lich Lord): Arcane candelabra on the bar ──
    // Three purple-tinged candles that burn with an unearthly glow —
    // a relic placed on the bar after the Lich Lord fell.
    if (hasFloor(50)) {
        const cx = 12 * TILE_SIZE + 12;
        const cy = 4 * TILE_SIZE + 8;
        const flicker = 0.8 + Math.sin(gameState.frameTick * 0.17 + 1) * 0.12;
        // Arcane glow
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const ag = ctx.createRadialGradient(cx + 12, cy, 1, cx + 12, cy, 28);
        ag.addColorStop(0, `rgba(176, 111, 255, ${0.28 * flicker})`);
        ag.addColorStop(1, 'rgba(176, 111, 255, 0)');
        ctx.fillStyle = ag;
        ctx.beginPath();
        ctx.arc(cx + 12, cy, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Three candle sticks
        [-8, 0, 8].forEach((ox, i) => {
            const ph = Math.sin(gameState.frameTick * 0.22 + i * 2) * 0.1;
            ctx.fillStyle = '#5a3080';
            ctx.fillRect(cx + 8 + ox, cy + 10, 5, 18);
            // Flame
            ctx.fillStyle = `rgba(176, 111, 255, ${0.7 + ph})`;
            ctx.beginPath();
            ctx.ellipse(cx + 10.5 + ox, cy + 8, 3, 5, 0, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.fillStyle = '#b06fff';
        ctx.font = '6px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('LICH CANDLES', cx + 12, cy + 32);
        ctx.textAlign = 'left';
    }

    // ── Floor 75 (Demon Prince): Hellfire char mark on the back wall ──
    // A scorched black scar with residual ember glow — the Demon Prince's
    // seal burned into the stone when word of his death arrived.
    if (hasFloor(75)) {
        const hx = 2 * TILE_SIZE;
        const hy = 13 * TILE_SIZE;
        const ember = 0.4 + Math.sin(gameState.frameTick * 0.14) * 0.2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const eg = ctx.createRadialGradient(hx + 20, hy + 20, 2, hx + 20, hy + 20, 30);
        eg.addColorStop(0, `rgba(255, 80, 30, ${ember * 0.5})`);
        eg.addColorStop(1, 'rgba(255, 30, 0, 0)');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(hx + 20, hy + 20, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Char mark — jagged star shape
        ctx.fillStyle = 'rgba(30, 10, 5, 0.7)';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? 18 : 10;
            const px = hx + 20 + Math.cos(angle) * r;
            const py = hy + 20 + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 12px serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u29BF', hx + 20, hy + 25);
        ctx.fillStyle = '#ff6b35';
        ctx.font = '6px Courier New';
        ctx.fillText('DEMON\'S MARK', hx + 20, hy + 38);
        ctx.textAlign = 'left';
    }

    // ── Floor 100 (Fallen God): Golden ambient shimmer throughout ──
    // A warm golden light suffuses the tavern — not magic, just a sense
    // that something massive has changed. A victory banner above the bar.
    if (hasFloor(100)) {
        // Subtle golden wash over the whole floor
        const pulse = 0.04 + Math.sin(gameState.frameTick * 0.06) * 0.015;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 214, 90, ${pulse})`;
        ctx.fillRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);
        ctx.restore();
        // Victory banner above the bar counter
        const vx = 11 * TILE_SIZE;
        const vy = 3 * TILE_SIZE + 4;
        ctx.fillStyle = '#8b5a1a';
        ctx.fillRect(vx, vy, 5 * TILE_SIZE, 18);
        ctx.fillStyle = '#ffd65a';
        ctx.fillRect(vx + 2, vy + 2, 5 * TILE_SIZE - 4, 14);
        ctx.fillStyle = '#8b5a1a';
        ctx.font = 'bold 9px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('THE FALLEN GOD IS DEAD', vx + 5 * TILE_SIZE / 2, vy + 12);
        ctx.textAlign = 'left';
    }
}


// ── Legendary guest NPCs ───────────────────────────────────────────────────────
// Drawn as glyphs with labels — same visual language as other tavern NPCs.
// Only guests whose milestone floor appears in defeatedMilestones are drawn.

function drawLegendaryGuests(milestones) {
    if (!milestones || !milestones.length) return;
    MILESTONE_GUESTS.forEach(guest => {
        if (!milestones.includes(guest.floor)) return;
        const gx = guest.x * TILE_SIZE;
        const gy = guest.y * TILE_SIZE;
        const cx = gx + TILE_SIZE / 2;
        const cy = gy + TILE_SIZE / 2;
        // Subtle glow to signal interactability
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glow = 0.15 + Math.sin(gameState.frameTick * 0.09 + guest.x) * 0.06;
        ctx.fillStyle = `rgba(${hexToRgb(guest.color)}, ${glow})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Glyph
        ctx.fillStyle = guest.color;
        ctx.font = 'bold 18px serif';
        ctx.textAlign = 'center';
        ctx.fillText(guest.glyph, cx, cy + 6);
        // Name label
        ctx.font = '7px Courier New';
        ctx.fillStyle = gameState.tavernUpgrades[guest.visitedKey] ? '#888' : guest.color;
        ctx.fillText(guest.name.toUpperCase(), cx, gy + TILE_SIZE - 3);
        ctx.textAlign = 'left';
    });
}


// Minimal hex-to-rgb for the glow rgba() construction above —
// only needs to handle the 6-digit hex colors used in MILESTONE_GUESTS.
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
}


// Fixed in the upper-right corner, away from every NPC position (nothing
// else occupies x>=20,y<=5) — a static decorative anchor, not something
// players interact with. Flicker uses the same frameTick-sine pattern as
// dungeon torch lighting, so it reads as part of the same visual
// language rather than a different lighting system bolted on.
const TAVERN_FIREPLACE_X = 22;
const TAVERN_FIREPLACE_Y = 2;

function drawTavernFireplace() {
    const fx = TAVERN_FIREPLACE_X * TILE_SIZE + TILE_SIZE / 2;
    const fy = TAVERN_FIREPLACE_Y * TILE_SIZE + TILE_SIZE / 2;
    const flicker = 0.85 + Math.sin(gameState.frameTick * 0.19) * 0.1 + Math.sin(gameState.frameTick * 0.41) * 0.05;

    // Stone hearth surround
    ctx.fillStyle = '#3a3530';
    ctx.fillRect(fx - 20, fy - 16, 40, 36);
    ctx.fillStyle = '#241f1a';
    ctx.fillRect(fx - 14, fy - 10, 28, 26);

    // Warm light bloom — additive so it brightens the stone/floor
    // around it rather than just painting a flat circle on top.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(fx, fy, 2, fx, fy, 46);
    grad.addColorStop(0, `rgba(255, 170, 70, ${0.5 * flicker})`);
    grad.addColorStop(0.5, `rgba(255, 120, 40, ${0.22 * flicker})`);
    grad.addColorStop(1, 'rgba(255, 90, 30, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fx, fy, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Flame body — a few overlapping teardrops at slightly different
    // phases so the silhouette itself flickers, not just the glow.
    [0, 1, 2].forEach(i => {
        const wobble = Math.sin(gameState.frameTick * 0.25 + i * 2.1) * 3;
        const h = 16 + Math.sin(gameState.frameTick * 0.3 + i * 1.4) * 3;
        ctx.fillStyle = i === 1 ? '#ffd65a' : '#ff7a30';
        ctx.beginPath();
        ctx.moveTo(fx + (i - 1) * 6 + wobble, fy + 8);
        ctx.quadraticCurveTo(fx + (i - 1) * 6 - 5, fy - h * 0.4, fx + (i - 1) * 6, fy - h);
        ctx.quadraticCurveTo(fx + (i - 1) * 6 + 5, fy - h * 0.4, fx + (i - 1) * 6 + wobble, fy + 8);
        ctx.fill();
    });

    // Rising embers — small particles drifting up and fading, looping
    // on a deterministic cycle (frameTick modulo) rather than spawned
    // into gameState.effects, so there's no per-frame allocation cost
    // for what's purely cosmetic background motion.
    for (let i = 0; i < 6; i++) {
        const cycle = (gameState.frameTick * 0.6 + i * 47) % 280;
        const ex = fx + Math.sin(i * 2.3 + cycle * 0.02) * 10;
        const ey = fy - cycle * 0.55;
        const emberAlpha = Math.max(0, 1 - cycle / 280);
        if (emberAlpha <= 0) continue;
        ctx.fillStyle = `rgba(255, ${160 + i * 10}, 60, ${emberAlpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(ex, ey, 1.4, 0, Math.PI * 2);
        ctx.fill();
    }
}


// Slow-drifting dust motes across the whole tavern floor, catching the
// fireplace/chandelier light. Purely decorative, same deterministic
// frameTick-cycle approach as the embers above — no per-frame spawning.
function drawTavernDustMotes() {
    const scale = _particleScale();
    if (scale <= 0) return;
    const count = Math.round(22 * scale);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
        const cycle = (gameState.frameTick * 0.15 + i * 131) % 900;
        const mx = ((i * 173 + cycle * 0.4) % (MAP_WIDTH * TILE_SIZE));
        const my = ((i * 97 + Math.sin(i) * 40 + cycle * 0.12) % (MAP_HEIGHT * TILE_SIZE));
        const twinkle = 0.3 + Math.sin(gameState.frameTick * 0.05 + i * 1.9) * 0.2;
        ctx.fillStyle = `rgba(255, 230, 180, ${Math.max(0, twinkle) * 0.35})`;
        ctx.beginPath();
        ctx.arc(mx, my, 1, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawPlayer() {
    const player = gameState.player;
    // Idle bob — same pattern as drawHubNpc's tavern-NPC breathing motion,
    // applied to the player's own logical tile position so the phase
    // stays stable as they move rather than resetting at (0,0) each frame.
    // Suppressed during either attack animation so the motions don't
    // fight each other on the same axis.
    const isAnimatingAttack = player.attackAnim?.life > 0 || player.lungeAnim?.life > 0;
    const idleBob = isAnimatingAttack ? 0
        : Math.sin(gameState.frameTick * 0.05 + player.x * 1.7 + player.y * 0.9) * 1.5;

    // Universal attack lunge — a small punch toward the target,
    // mirroring the enemy version in drawEnemy. Berserker additionally
    // gets the red claw-slash effect further down, on top of this.
    let lungeX = 0, lungeY = 0;
    if (player.lungeAnim?.life > 0) {
        const t = player.lungeAnim.life / player.lungeAnim.maxLife; // 1 -> 0
        const punch = Math.sin((1 - t) * Math.PI) * 4;
        lungeX = (player.lungeAnim.dx || 0) * punch;
        lungeY = (player.lungeAnim.dy || 0) * punch;
    }

    const cx = player.renderX + TILE_SIZE / 2 + lungeX;
    const cy = player.renderY + TILE_SIZE / 2 + idleBob + lungeY;
    const stunned = hasStatus(player, 'stun');
    const baseColor = stunned ? '#ffd65a' : '#4fc3f7';

    // Soft ground shadow beneath the token, offset slightly down — gives
    // the flat circle a sense of sitting on the floor rather than being
    // painted flush onto it. Kept subtle and player-only (enemies keep
    // their existing flat look elsewhere) to avoid a visual-language
    // change bigger than what was actually asked for.
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 9, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Real character art when the sprite for this class has finished
    // loading; the original flat circle as a fallback otherwise. These
    // are mutually exclusive — drawing both (circle underneath, sprite
    // on top) was tried first and produced a visible colored halo around
    // the character art wherever the sprite doesn't fully cover the
    // circle's footprint, so the circle now only appears in the genuine
    // fallback case (sprite still loading, failed to load, or no
    // className set at all).
    const sprite = getClassSprite(player.className);
    if (sprite) {
        // Size bumped from 1.65× to 1.82× — player should visually dominate
        // the scene so you can always spot yourself instantly. The extra
        // height also means the sprite's feet land in the right tile center.
        const spriteHeight = TILE_SIZE * 1.82;
        const spriteWidth = spriteHeight * (sprite.naturalWidth / sprite.naturalHeight);
        const facingLeft = !!player.facingLeft;

        // Hero presence glow — a faint gold/blue aura beneath the sprite,
        // drawn first so it sits behind the character art. Strong enough to
        // be visible but not so bright it reads as a status effect.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const auraR = spriteWidth * 0.55;
        const aura = ctx.createRadialGradient(cx, cy + 6, 0, cx, cy + 6, auraR);
        aura.addColorStop(0, 'rgba(150, 200, 255, 0.12)');
        aura.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 6, auraR, auraR * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(cx, cy + 14);
        if (facingLeft) ctx.scale(-1, 1);
        ctx.drawImage(sprite, -spriteWidth / 2, -spriteHeight, spriteWidth, spriteHeight);
        ctx.restore();
    } else {
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.fill();

        // Soft inner highlight toward the upper-left gives the circle a
        // slightly convex, lit look instead of a flat painted disc.
        const grad = ctx.createRadialGradient(cx - 5, cy - 6, 1, cx, cy, 15);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.fill();
    }

    if (player.hitFlash > 0.01) {
        if (player.hitFlash > 0.5) {
            ctx.globalAlpha = Math.min(1, (player.hitFlash - 0.5) * 2.4);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(cx, cy, 16, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = player.hitFlash * 0.85;
        ctx.fillStyle = '#ff2233';
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    if (player.shieldActive) {
        ctx.strokeStyle = '#ffd65a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 19, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
    }
    if (player.attackAnim?.life > 0) {
        const t = 1 - player.attackAnim.life / player.attackAnim.maxLife;
        const alpha = player.attackAnim.life / player.attackAnim.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#e14b4b';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx + 10, cy - 2, 18 + t * 14, -Math.PI * 0.25, Math.PI * 0.55);
        ctx.stroke();
        ctx.strokeStyle = '#ff6b35';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx + 6, cy, 12 + t * 8, -Math.PI * 0.2, Math.PI * 0.45);
        ctx.stroke();
        ctx.restore();
    }

    // Status dots below player
    player.statuses.forEach((s, i) => {
        const meta = STATUS_META[s.type];
        if (!meta) return;
        ctx.fillStyle = meta.color;
        ctx.beginPath();
        ctx.arc(player.renderX + 8 + i * 10, player.renderY + TILE_SIZE - 3, 4, 0, Math.PI * 2);
        ctx.fill();
    });
}


function drawEnemy(enemy) {
    const isBoss = enemy.type === 'boss';
    const size = isBoss ? 30 : 24;
    const offset = isBoss ? 5 : 8;

    // Smoothed draw position (see the per-frame lerp in draw()) rather
    // than the instant logical grid position — this is what actually
    // makes movement read as a slide instead of a teleport. Falls back
    // to the logical position for any enemy that somehow predates the
    // renderX/renderY fields (shouldn't happen — the Enemy constructor
    // always sets them — but cheap insurance against a future
    // construction path that skips it).
    const rx = enemy.renderX ?? enemy.x * TILE_SIZE;
    const ry = enemy.renderY ?? enemy.y * TILE_SIZE;
    // Tile-fraction equivalents for drawGlyph/drawHealthBar below, which
    // take tile-grid coordinates (and multiply by TILE_SIZE internally)
    // since they're shared with non-enemy callers elsewhere — passing
    // the render position through this way keeps their contract
    // unchanged while still tracking the smoothed position visually.
    const tx = rx / TILE_SIZE;
    const ty = ry / TILE_SIZE;

    // Idle bob — same pattern as drawPlayer/drawHubNpc, suppressed
    // during an attack lunge so the two motions don't fight on the same
    // axis, and during the telegraph glow states (charging/winding_up)
    // since those already carry their own visual weight and a bob on
    // top reads as jittery rather than alive.
    const idleBob = (enemy.attackAnim?.life > 0 || enemy.intent === 'charging' || enemy.intent === 'winding_up')
        ? 0
        : Math.sin(gameState.frameTick * 0.05 + enemy.x * 1.7 + enemy.y * 0.9) * 1.2;

    // Intent / phase glow — kept on the logical tile grid (not the
    // render-smoothed position) since these are tile-aligned outlines
    // around the enemy's current cell, not the body sprite itself.
    if (enemy.intent === 'charging') {
        ctx.strokeStyle = '#78bfff';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(enemy.x * TILE_SIZE + 4, enemy.y * TILE_SIZE + 4, 32, 32);
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
    } else if (enemy.intent === 'winding_up') {
        ctx.strokeStyle = '#d08aff';
        ctx.lineWidth = 3;
        ctx.strokeRect(enemy.x * TILE_SIZE + 4, enemy.y * TILE_SIZE + 4, 32, 32);
        ctx.lineWidth = 1;
    }

    // Boss phase ring
    if (isBoss && enemy.bossVariant === 'sentinel' && !enemy.milestoneBoss) {
        ctx.strokeStyle = enemy.bossPhase === 'armored' ? '#a8c8e8' : '#ff9f58';
        ctx.lineWidth = enemy.bossPhase === 'armored' ? 4 : 2;
        ctx.beginPath();
        ctx.arc(rx + TILE_SIZE / 2, ry + TILE_SIZE / 2 + idleBob,
            20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
    }
    // ── The Fallen God: massive multi-layer aura, unique to the final boss ──
    if (isBoss && enemy.name === 'The Fallen God') {
        const phase = enemy.fallenPhase || 1;
        const t = gameState.frameTick;
        const cx2 = rx + TILE_SIZE / 2;
        const cy2 = ry + TILE_SIZE / 2 + idleBob;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Outer slow-pulse: massive crimson corona (3-tile radius)
        const outerR = 55 + Math.sin(t * 0.03) * 8;
        const outerAlpha = (0.08 + Math.sin(t * 0.04) * 0.04) * (phase >= 3 ? 1.4 : 1);
        const outerGrad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, outerR);
        outerGrad.addColorStop(0, `rgba(255, 40, 10, ${outerAlpha * 3})`);
        outerGrad.addColorStop(0.4, `rgba(200, 20, 0, ${outerAlpha * 1.5})`);
        outerGrad.addColorStop(1, 'rgba(100, 0, 0, 0)');
        ctx.fillStyle = outerGrad;
        ctx.beginPath();
        ctx.arc(cx2, cy2, outerR, 0, Math.PI * 2);
        ctx.fill();

        // Mid pulse: gold-red inner glow
        const midR = 32 + Math.sin(t * 0.07 + 1) * 5;
        const midAlpha = 0.15 + Math.sin(t * 0.06) * 0.07;
        const midGrad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, midR);
        midGrad.addColorStop(0, `rgba(255, 200, 50, ${midAlpha * 2})`);
        midGrad.addColorStop(0.5, `rgba(255, 80, 20, ${midAlpha})`);
        midGrad.addColorStop(1, 'rgba(180, 0, 0, 0)');
        ctx.fillStyle = midGrad;
        ctx.beginPath();
        ctx.arc(cx2, cy2, midR, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Phase-based outer ring — gets more intense each phase
        const ringColor = phase >= 3 ? '#ff2222' : phase >= 2 ? '#ff7722' : '#ffd65a';
        const ringWidth = phase >= 3 ? 4 : 3;
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = ringWidth;
        ctx.globalAlpha = 0.6 + Math.sin(t * 0.1) * 0.25;
        ctx.beginPath();
        ctx.arc(cx2, cy2, 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;

        // Phase 3 only: second fast-pulse ring (cataclysm imminent)
        if (phase >= 3) {
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.4 + Math.sin(t * 0.22) * 0.4;
            ctx.beginPath();
            ctx.arc(cx2, cy2, 34, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 1;
        }
    } else if (isBoss) {
        // Standard boss aura
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = enemy.color;
        ctx.beginPath();
        ctx.arc(rx + TILE_SIZE / 2, ry + TILE_SIZE / 2 + idleBob,
            22, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Attack lunge offset — a small directional nudge toward the player
    // while attackAnim is active, mirroring the player's own lunge so
    // enemy attacks read as a forward strike rather than a stationary
    // damage tick. Direction is computed once at attack time (see
    // enemyAttack in combat.js) and stored on attackAnim itself, since
    // by the time this draws the enemy may have already taken its next
    // logical step.
    let lungeX = 0, lungeY = 0;
    if (enemy.attackAnim?.life > 0) {
        const t = enemy.attackAnim.life / enemy.attackAnim.maxLife; // 1 -> 0
        const punch = Math.sin((1 - t) * Math.PI) * 5; // out and back
        lungeX = (enemy.attackAnim.dx || 0) * punch;
        lungeY = (enemy.attackAnim.dy || 0) * punch;
    }

    const ex = rx + offset + lungeX;
    const ey = ry + offset + idleBob + lungeY;

    // Real enemy art when the sprite for this type has loaded; the original
    // colored square as a fallback otherwise (boss types have no sprite and
    // always take the square path, keeping their aura/ring treatment). The
    // two are mutually exclusive, mirroring drawPlayer's sprite/circle split.
    // Real enemy art: regular enemies use their type key; The Fallen God has
    // its own sprite keyed by name so it doesn't need a fake enemy type.
    // Milestone bosses skip the standard glyph/square fallback and use their
    // named sprite if loaded, falling back to the aura-only treatment below.
    const fallenGodSprite = (enemy.name === 'The Fallen God')
        ? getEnemySprite('The Fallen God') : null;
    const sprite = fallenGodSprite || (isBoss ? null : getEnemySprite(enemy.type));
    if (sprite) {
        // The Fallen God renders at 2.4× tile height — it should visually dwarf
        // everything else on the floor. Regular enemies are 1.5× tile height.
        const heightMult = (enemy.name === 'The Fallen God') ? 2.4 : 1.5;
        const spriteHeight = TILE_SIZE * heightMult;
        // Compute width from the sprite's natural aspect ratio, then clamp it.
        // Some sprites (bat: 3.29:1, imp: 1.67:1) are much wider than they are
        // tall — unclamped they render at 5× tile width and swamp the whole
        // floor. We cap at 1.5 tiles wide for regular enemies so they always
        // fit in their grid cell regardless of the source image's dimensions.
        const naturalWidth = spriteHeight * (sprite.naturalWidth / sprite.naturalHeight);
        const maxWidth = (enemy.name === 'The Fallen God') ? naturalWidth : Math.min(naturalWidth, TILE_SIZE * 1.5);
        const spriteWidth = maxWidth;
        const cx = rx + TILE_SIZE / 2 + lungeX;
        const feetY = ry + TILE_SIZE - 2 + idleBob + lungeY;
        // Larger shadow for The Fallen God
        const shadowRx = (enemy.name === 'The Fallen God') ? 18 : 10;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
        ctx.beginPath();
        ctx.ellipse(cx, feetY - 1, shadowRx, shadowRx * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Enemies face the player: flip horizontally when the player is to
        // their left, so packs converging from both sides face inward.
        const faceLeft = gameState.player && gameState.player.x < enemy.x;
        ctx.save();
        ctx.translate(cx, feetY - spriteHeight);
        if (faceLeft) { ctx.translate(spriteWidth, 0); ctx.scale(-1, 1); }
        ctx.drawImage(sprite, 0, 0, spriteWidth, spriteHeight);
        ctx.restore();
        // Hit/damage flash as a tinted overlay clipped to the sprite, so the
        // white/red flash still lands on the art instead of a bare rectangle.
        if (enemy.hitFlash > 0.01) {
            ctx.save();
            ctx.globalAlpha = (enemy.hitFlash > 0.5 ? Math.min(1, (enemy.hitFlash - 0.5) * 2.4) : enemy.hitFlash * 0.9);
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = enemy.hitFlash > 0.5 ? '#ffffff' : '#ff2233';
            ctx.translate(cx, feetY - spriteHeight);
            if (faceLeft) { ctx.translate(spriteWidth, 0); ctx.scale(-1, 1); }
            ctx.drawImage(sprite, 0, 0, spriteWidth, spriteHeight);
            ctx.fillRect(0, 0, spriteWidth, spriteHeight);
            ctx.restore();
        }
    } else {
        ctx.fillStyle = enemy.color;
        ctx.fillRect(ex, ey, size, size);
        if (enemy.hitFlash > 0.01) {
            if (enemy.hitFlash > 0.5) {
                ctx.globalAlpha = Math.min(1, (enemy.hitFlash - 0.5) * 2.4);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(ex - 1, ey - 1, size + 2, size + 2);
            }
            ctx.globalAlpha = enemy.hitFlash * 0.9;
            ctx.fillStyle = '#ff2233';
            ctx.fillRect(ex - 1, ey - 1, size + 2, size + 2);
            ctx.globalAlpha = 1;
        } else if (enemy.flash > 0.01) {
            ctx.globalAlpha = enemy.flash * 0.5;
            ctx.fillStyle = '#fff8db';
            ctx.fillRect(ex, ey, size, size);
            ctx.globalAlpha = 1;
        }
    }
    // Glyph: only drawn on the fallback square (the sprite carries its own
    // identity). Health bar always drawn, sprite or not.
    if (!sprite) drawGlyph(tx, ty, enemy.glyph, '#111', isBoss ? 17 : 13);
    drawHealthBar(tx, ty, enemy.hp, enemy.maxHp);

    // Status icons
    enemy.statuses.forEach((s, i) => {
        const meta = STATUS_META[s.type];
        if (!meta) return;
        ctx.fillStyle = meta.color;
        ctx.font = '9px Courier New';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(meta.icon, enemy.x * TILE_SIZE + 28, enemy.y * TILE_SIZE + 7 + i * 10);
    });
    ctx.textBaseline = 'middle';
}


// Draws the overland zone feature markers (forage nodes, travelling merchant,
// mini-events). Ambush tiles are invisible by design — they're a trap-style
// surprise — so they're skipped here. Used features fade to a faint husk.
function drawZoneFeatures() {
    const feats = gameState.zoneFeatures;
    if (!Array.isArray(feats) || !feats.length) return;
    const t = gameState.frameTick || 0;

    for (const f of feats) {
        if (f.kind === 'ambush') continue; // hidden trigger
        if (!gameState.revealed?.[f.y]?.[f.x]) continue;

        const tx = f.x * TILE_SIZE + TILE_SIZE / 2;
        const ty = f.y * TILE_SIZE + TILE_SIZE / 2;

        let glyph, color;
        if (f.kind === 'forage')      { glyph = f.ref.glyph; color = f.ref.color; }
        else if (f.kind === 'event')  { glyph = f.ref.glyph; color = f.ref.color; }
        else if (f.kind === 'merchant'){ glyph = '\u{1F9F3}'; color = '#e0c068'; }
        else continue;

        ctx.save();
        if (f.used) {
            // Spent node — faint, no glow.
            ctx.globalAlpha = 0.28;
            ctx.fillStyle = '#6b5d49';
            ctx.font = `${Math.floor(TILE_SIZE * 0.5)}px serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(glyph, tx, ty);
            ctx.restore();
            continue;
        }

        // Soft pulsing glow disc
        const pulse = 0.45 + Math.sin(t * 0.08 + f.x * 0.6) * 0.2;
        ctx.globalCompositeOperation = 'lighter';
        const grd = ctx.createRadialGradient(tx, ty, 0, tx, ty, 14);
        grd.addColorStop(0, hexToRgba(color, pulse * 0.5));
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(tx, ty, 14, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // Glyph
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.font = `${Math.floor(TILE_SIZE * 0.55)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(glyph, tx, ty);

        // A subtle floating bob marker above merchants so they read as "go here"
        if (f.kind === 'merchant') {
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = '#ffe39a';
            ctx.font = `${Math.floor(TILE_SIZE * 0.3)}px serif`;
            const bob = Math.sin(t * 0.12) * 3;
            ctx.fillText('\u25BC', tx, ty - TILE_SIZE * 0.45 + bob);
        }
        ctx.restore();
    }
}

// Convert a #rrggbb string to rgba() with the given alpha. Tolerates colors
// that are already rgb()/rgba() by passing them through with alpha appended.
function hexToRgba(hex, a) {
    if (typeof hex !== 'string') return `rgba(255,255,255,${a})`;
    if (hex.startsWith('#') && hex.length === 7) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgba(${r},${g},${b},${a})`;
    }
    return hex; // already some color form
}


function drawItem(item) {
    const color = item.type === 'equipment' && item.rarity
        ? getRarityColor(item.rarity) : item.color;
    const tx = item.x * TILE_SIZE + TILE_SIZE / 2;
    const ty = item.y * TILE_SIZE + TILE_SIZE / 2;
    const t = gameState.frameTick;

    // Glow radius + intensity by rarity tier
    const tier = (item.type === 'relic') ? 'legendary'
        : (item.type === 'equipment' && item.rarity) ? item.rarity : null;

    if (tier) {
        const rarityGlow = {
            common: { r: 8,  pulse: 0.08, speed: 0.06 },
            uncommon:{ r: 10, pulse: 0.14, speed: 0.08 },
            rare:    { r: 13, pulse: 0.22, speed: 0.10 },
            epic:    { r: 16, pulse: 0.32, speed: 0.12 },
            legendary:{ r: 20, pulse: 0.45, speed: 0.14 },
            mythic:  { r: 22, pulse: 0.55, speed: 0.18 },
        };
        const cfg = rarityGlow[tier] || rarityGlow.common;
        const pulse = cfg.pulse * (0.65 + Math.sin(t * cfg.speed + item.x * 0.7) * 0.35);

        // Soft radial glow disc
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const grd = ctx.createRadialGradient(tx, ty, 0, tx, ty, cfg.r);
        grd.addColorStop(0,   color.replace(')', `, ${pulse})`).replace('rgb', 'rgba'));
        grd.addColorStop(0.5, color.replace(')', `, ${pulse * 0.4})`).replace('rgb', 'rgba'));
        grd.addColorStop(1,   'rgba(0,0,0,0)');

        // Fallback: draw a simple circle if color isn't rgb
        ctx.globalAlpha = pulse * 1.8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(tx, ty, cfg.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();

        // Extra animated ring for epic+ items
        if (tier === 'epic' || tier === 'legendary' || tier === 'mythic') {
            const ringPulse = 0.5 + Math.sin(t * cfg.speed) * 0.3;
            const ringR = cfg.r + 3 + Math.sin(t * cfg.speed * 0.7) * 2;
            ctx.save();
            ctx.globalAlpha = ringPulse * 0.55;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(tx, ty, ringR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Glyph with shadow for legibility
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = tier ? 6 : 0;
    drawGlyph(item.x, item.y, item.glyph, color, 23);
    ctx.restore();
}


// ── Navigation aids ─────────────────────────────────────────────────────────────
// Glowing floor markers beneath each interactable NPC so points of interest read
// at a glance, plus a "[Space] <verb> <label>" prompt above whichever NPC the
// player is standing next to. Both read from TAVERN_INTERACTABLES (data.js) so
// there's one source of truth.

function drawNpcFloorMarkers() {
    if (typeof TAVERN_INTERACTABLES === 'undefined') return;
    const adj = (typeof getAdjacentInteractable === 'function') ? getAdjacentInteractable() : null;
    const adjNpc = adj?.npc;

    TAVERN_INTERACTABLES.forEach(def => {
        const npc = gameState[def.key];
        if (!npc) return;
        const cx = npc.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = npc.y * TILE_SIZE + TILE_SIZE - 6;
        const isAdj = npc === adjNpc;
        // Gentle breathing pulse; the adjacent NPC's marker pulses brighter.
        const pulse = 0.5 + Math.sin(gameState.frameTick * 0.06 + npc.x * 0.7) * 0.5;
        const baseAlpha = isAdj ? 0.45 : 0.18;
        const alpha = baseAlpha + pulse * (isAdj ? 0.25 : 0.10);
        const rx = isAdj ? 16 : 13;
        const ry = isAdj ? 6 : 5;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
        g.addColorStop(0, _hexToRgba(def.color, alpha));
        g.addColorStop(1, _hexToRgba(def.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // A thin ring on the adjacent NPC's marker makes "you can act here" crisp.
        if (isAdj) {
            ctx.strokeStyle = _hexToRgba(def.color, 0.5 + pulse * 0.3);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx + 2, ry + 1, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
        }
    });
}

// Floating "[Space] <verb> <label>" prompt above the adjacent NPC. Called late
// in the tavern draw so it sits above NPCs and furniture.
function drawInteractionPrompt() {
    if (gameState.floor !== 0) return;
    const adj = (typeof getAdjacentInteractable === 'function') ? getAdjacentInteractable() : null;
    if (!adj) return;
    const npc = adj.npc;
    const cx = npc.x * TILE_SIZE + TILE_SIZE / 2;
    const topY = npc.y * TILE_SIZE - 14;
    const text = `${adj.verb} ${adj.label}`;

    ctx.save();
    ctx.font = 'bold 11px "Courier New", monospace';
    const keyLabel = '[Space]';
    const gap = 6;
    const keyW = ctx.measureText(keyLabel).width + 10;
    const textW = ctx.measureText(text).width;
    const totalW = keyW + gap + textW + 16;
    let bx = cx - totalW / 2;
    bx = Math.max(4, Math.min(bx, MAP_WIDTH * TILE_SIZE - totalW - 4));
    const by = topY - 20;
    const bh = 22;

    // Bubble
    ctx.fillStyle = 'rgba(20, 17, 13, 0.94)';
    ctx.strokeStyle = _hexToRgba(adj.color, 0.7);
    ctx.lineWidth = 1.5;
    _roundRect(bx, by, totalW, bh, 6);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;
    // Tail
    ctx.beginPath();
    ctx.moveTo(cx - 5, by + bh);
    ctx.lineTo(cx + 5, by + bh);
    ctx.lineTo(cx, by + bh + 6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 17, 13, 0.94)';
    ctx.fill();

    // [Space] key chip
    const chipX = bx + 8, chipY = by + 4, chipH = bh - 8;
    ctx.fillStyle = _hexToRgba(adj.color, 0.22);
    _roundRect(chipX, chipY, keyW, chipH, 3);
    ctx.fill();
    ctx.fillStyle = adj.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(keyLabel, chipX + keyW / 2, by + bh / 2 + 0.5);

    // Action text
    ctx.fillStyle = '#f0e6d0';
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(text, chipX + keyW + gap, by + bh / 2 + 0.5);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

// Hex (#rrggbb) → rgba() string with the given alpha. Tolerates already-rgba
// inputs by returning them unchanged.
function _hexToRgba(hex, a) {
    if (typeof hex !== 'string' || hex[0] !== '#') return hex;
    const h = hex.slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}


function drawHubNpc(npc, color, label, spriteKey) {
    // Subtle vertical bob so NPCs read as standing/breathing rather
    // than a static painted rectangle — same deterministic
    // frameTick-based sine pattern used for torch flicker elsewhere,
    // offset per NPC position so multiple NPCs don't bob in lockstep.
    const bob = Math.sin(gameState.frameTick * 0.05 + npc.x * 1.7 + npc.y * 0.9) * 1.5;

    // Real sprite when available; same flat colored rectangle as before
    // when it's not (still loading, failed to load, or no spriteKey
    // given at all) — mirrors the player's sprite/circle fallback in
    // drawPlayer exactly: mutually exclusive, never both at once.
    const sprite = spriteKey ? getNpcSprite(spriteKey) : null;
    if (sprite) {
        const spriteHeight = TILE_SIZE * 1.5;
        const spriteWidth = spriteHeight * (sprite.naturalWidth / sprite.naturalHeight);
        const cx = npc.x * TILE_SIZE + TILE_SIZE / 2;
        const feetY = npc.y * TILE_SIZE + TILE_SIZE - 2 + bob;
        ctx.drawImage(sprite, cx - spriteWidth / 2, feetY - spriteHeight, spriteWidth, spriteHeight);
    } else {
        ctx.fillStyle = color;
        ctx.fillRect(npc.x * TILE_SIZE + 10, npc.y * TILE_SIZE + 7 + bob, 20, 28);
    }

    ctx.fillStyle = '#111';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(label, npc.x * TILE_SIZE + TILE_SIZE / 2, npc.y * TILE_SIZE - 3);
}


function drawBartender() { drawHubNpc(gameState.innkeeper, '#ffd65a', 'INN', 'innkeeper'); }

function drawBlacksmith() { drawHubNpc(gameState.blacksmith, '#c45c00', 'SMITH', 'blacksmith'); }

function drawTrainer() { drawHubNpc(gameState.trainer, '#58c26d', 'TRAIN', 'trainer'); }

function drawBank() { drawHubNpc(gameState.bank, '#ffd65a', 'BANK', 'bank'); }

function drawDungeonEntrance() {
    if (gameState.floor !== 0) return;
    const ex = EXIT_X * TILE_SIZE;
    const ey = EXIT_Y * TILE_SIZE;
    const pulse = 0.6 + Math.sin(gameState.frameTick * 0.12) * 0.25;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ff9f3d';
    ctx.lineWidth = 2;
    ctx.strokeRect(ex + 4, ey + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff9f3d';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('DUNGEON', ex + TILE_SIZE / 2, ey - 4);
}


function drawMerchant() {
    const m = gameState.merchant;
    const bob = Math.sin(gameState.frameTick * 0.05 + m.x * 1.7 + m.y * 0.9) * 1.5;

    const sprite = getNpcSprite('merchant');
    if (sprite) {
        const spriteHeight = TILE_SIZE * 1.5;
        const spriteWidth = spriteHeight * (sprite.naturalWidth / sprite.naturalHeight);
        const cx = m.x * TILE_SIZE + TILE_SIZE / 2;
        const feetY = m.y * TILE_SIZE + TILE_SIZE - 2 + bob;
        ctx.drawImage(sprite, cx - spriteWidth / 2, feetY - spriteHeight, spriteWidth, spriteHeight);
    } else {
        ctx.fillStyle = '#5ad1c2';
        ctx.fillRect(m.x * TILE_SIZE + 10, m.y * TILE_SIZE + 7 + bob, 20, 28);
    }

    ctx.fillStyle = '#111';
    ctx.font = '12px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('M', m.x * TILE_SIZE + TILE_SIZE / 2, m.y * TILE_SIZE - 3);
    // Coin glint — independent twinkle timing so it doesn't look
    // perfectly synced to the body's own idle bob. Kept regardless of
    // sprite vs. fallback rectangle, since it's a flourish on top of
    // either, not part of the body itself.
    const twinkle = 0.7 + Math.sin(gameState.frameTick * 0.12) * 0.3;
    ctx.globalAlpha = twinkle;
    ctx.fillStyle = '#ffd65a';
    ctx.beginPath();
    ctx.arc(m.x * TILE_SIZE + TILE_SIZE - 5, m.y * TILE_SIZE + 5 + bob, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
}


function drawGambler() {
    const g = gameState.gambler;
    const sprite = getNpcSprite('gambler');
    if (sprite) { drawHubNpc(g, '#b87a3c', 'DICE', 'gambler'); return; }
    const cx = g.x * TILE_SIZE + TILE_SIZE / 2;
    // Green felt table
    ctx.fillStyle = '#1e4a1a';
    ctx.fillRect(g.x * TILE_SIZE + 4, g.y * TILE_SIZE + 20, 32, 16);
    ctx.strokeStyle = '#3a8a34';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x * TILE_SIZE + 4, g.y * TILE_SIZE + 20, 32, 16);
    ctx.fillStyle = '#f0ede8';
    ctx.fillRect(g.x * TILE_SIZE + 9, g.y * TILE_SIZE + 24, 8, 8);
    ctx.fillRect(g.x * TILE_SIZE + 23, g.y * TILE_SIZE + 24, 8, 8);
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(g.x * TILE_SIZE + 13, g.y * TILE_SIZE + 28, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(g.x * TILE_SIZE + 27, g.y * TILE_SIZE + 28, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b87a3c';
    ctx.fillRect(g.x * TILE_SIZE + 14, g.y * TILE_SIZE + 6, 12, 16);
    ctx.fillStyle = '#ffd65a';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('DICE', cx, g.y * TILE_SIZE - 3);
    ctx.lineWidth = 1;
}


function drawGlyph(x, y, glyph, color, size) {
    ctx.fillStyle = color;
    ctx.font = `${size}px Courier New`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
}


function drawHealthBar(x, y, hp, maxHp) {
    const width = 30;
    const pct = Math.max(0, hp / maxHp);
    const filled = Math.max(0, Math.round(width * pct));
    const bx = x * TILE_SIZE + 5;
    const by = y * TILE_SIZE + 3;
    const h = 6;

    // Background track with inner shadow
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx, by, width, h);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(bx, by, width, 1);

    if (filled > 0) {
        // Gradient: green → yellow → red based on HP
        const hue = Math.round(pct * 120);  // 0 = red, 120 = green
        const barGrad = ctx.createLinearGradient(bx, by, bx, by + h);
        barGrad.addColorStop(0, `hsla(${hue}, 80%, 58%, 1)`);
        barGrad.addColorStop(0.45, `hsla(${hue}, 75%, 45%, 1)`);
        barGrad.addColorStop(1, `hsla(${hue}, 70%, 30%, 1)`);
        ctx.fillStyle = barGrad;
        ctx.fillRect(bx, by, filled, h);

        // Sheen on top
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(bx, by, filled, 2);

        // Pulse red when critical (< 25%)
        if (pct < 0.25) {
            const pulse = 0.3 + Math.sin(gameState.frameTick * 0.25) * 0.25;
            ctx.fillStyle = `rgba(255, 50, 50, ${pulse})`;
            ctx.fillRect(bx, by, filled, h);
        }
    }

    // Thin border
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, by - 0.5, width + 1, h + 1);
}


function _effectCoords(x, y, offsetY = 0) {
    const p = gameState.player;
    if (p && x === p.x && y === p.y) {
        return { px: p.renderX + TILE_SIZE / 2, py: p.renderY + 10 + offsetY };
    }
    return { px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2 - 8 + offsetY };
}


function addDamageNumber(x, y, amount, options = {}) {
    const { crit = false, color = '#fff8db', suffix = '!', icon = '' } = options;
    const { px, py } = _effectCoords(x, y);
    gameState.effects.push({
        kind: crit ? 'crit-damage' : 'damage',
        px, py,
        text: `${amount}${suffix}`,
        icon,
        color: crit ? '#ffd65a' : color,
        life: crit ? 52 : 44,
        maxLife: crit ? 52 : 44
    });
}


function addFloatingText(x, y, text, color, options = {}) {
    const { style = 'text', offsetY = 0, icon = '' } = options;
    const { px, py } = _effectCoords(x, y, offsetY);
    const life = style === 'crit-banner' ? 48 : style === 'xp' ? 50 : style === 'death-caption' ? 44 : 42;
    gameState.effects.push({ kind: style, px, py, text, icon, color, life, maxLife: life });
}


const DEATH_CAPTIONS = {
    slime: { text: '*splat*', color: '#58c26d' },
    skeleton: { text: '*bones scatter*', color: '#d8d4ca' }
};


function spawnDeathAnim(enemy) {
    triggerHitStop(enemy.type === 'boss' ? 8 : 5);
    if (enemy.type === 'boss') triggerScreenFlash('kill');
    const cap = DEATH_CAPTIONS[enemy.type];
    if (cap) {
        addFloatingText(enemy.x, enemy.y, cap.text, cap.color, { style: 'death-caption', offsetY: -6 });
        addCombatShake(enemy.type === 'slime' ? 8 : 10);
    }
    // Particle burst VFX (existing system)
    const frames = enemy.type === 'slime' ? 40 : enemy.type === 'skeleton' ? 36 : 28;
    gameState.effects.push({
        kind: 'death',
        enemyType: enemy.type,
        px: enemy.x * TILE_SIZE + TILE_SIZE / 2,
        py: enemy.y * TILE_SIZE + TILE_SIZE / 2,
        color: enemy.color,
        life: frames, maxLife: frames
    });

    // Sprite dissolve — stores a snapshot of the enemy's visual state so the
    // sprite can keep rendering for ~20 frames after it's removed from the
    // live enemy array. Scale drifts up slightly (0→15%) while alpha fades
    // to zero. Gives the death weight without blocking gameplay — the enemy
    // is logically dead immediately; only the visual lingers.
    if (!gameState.dyingSprites) gameState.dyingSprites = [];
    // Duplicate guard: if this enemy is already in the dying queue (can happen
    // when defeatEnemy is called multiple times on the same entity due to a
    // combat-loop edge case), skip adding another entry.
    const alreadyDying = gameState.dyingSprites.some(
        d => d.rx === (enemy.renderX ?? enemy.x * TILE_SIZE) &&
             d.ry === (enemy.renderY ?? enemy.y * TILE_SIZE) &&
             d.type === enemy.type
    );
    if (!alreadyDying) {
        gameState.dyingSprites.push({
            type: enemy.type,
            color: enemy.color,
            name: enemy.name,
            rx: enemy.renderX ?? enemy.x * TILE_SIZE,
            ry: enemy.renderY ?? enemy.y * TILE_SIZE,
            isBoss: enemy.type === 'boss',
            life: 22,
            maxLife: 22
        });
    }
}


function drawDyingSprites() {
    if (!gameState.dyingSprites?.length) return;
    // Cap the dying queue — if it grows beyond ~30 (which only happens if
    // spawnDeathAnim is called repeatedly on the same enemy due to a bug),
    // prune the oldest entries so a runaway queue can't crash the render loop.
    if (gameState.dyingSprites.length > 30) {
        gameState.dyingSprites.splice(0, gameState.dyingSprites.length - 30);
    }
    for (let i = gameState.dyingSprites.length - 1; i >= 0; i--) {
        const d = gameState.dyingSprites[i];
        d.life--;
        if (d.life <= 0) { gameState.dyingSprites.splice(i, 1); continue; }

        const progress = 1 - d.life / d.maxLife;
        const alpha    = d.life / d.maxLife;

        const sprite = getEnemySprite(d.type);
        if (!sprite || !sprite.complete || sprite.naturalWidth === 0) continue;

        const heightMult = d.isBoss ? 2.4 : 1.5;
        const spriteHeight = TILE_SIZE * heightMult;
        const naturalW = spriteHeight * (sprite.naturalWidth / sprite.naturalHeight);
        const spriteWidth = d.isBoss ? naturalW : Math.min(naturalW, TILE_SIZE * 1.5);

        const cx = d.rx + TILE_SIZE / 2;
        const feetY = d.ry + TILE_SIZE - 2;
        const scale = 1 + progress * 0.18;

        // Always use save/restore to guarantee compositeOperation resets
        // even if a drawing call throws — a leaked 'source-atop' would
        // corrupt every subsequent render pass.
        ctx.save();
        try {
            ctx.globalAlpha = alpha * 0.85;
            ctx.translate(cx, feetY - spriteHeight * scale * 0.5);
            ctx.scale(scale, scale);
            ctx.drawImage(sprite, -spriteWidth / 2, -spriteHeight / 2, spriteWidth, spriteHeight);
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = `rgba(255, 40, 40, ${progress * 0.55})`;
            ctx.fillRect(-spriteWidth / 2, -spriteHeight / 2, spriteWidth, spriteHeight);
        } catch(_) {
            // Silently discard any draw error — the restore below cleans up state
        }
        ctx.restore();
    }
}


function addBurst(x, y, color) {
    gameState.effects.push({ kind: 'burst', px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2, color, life: 18, maxLife: 18 });
}


function drawEffects() {
    // Prune expired effects in-place (backward splice avoids index shift bugs and
    // doesn't allocate a new array every frame the way .filter() did — at 60fps
    // that was one GC-able array created and thrown away per second).
    for (let i = gameState.effects.length - 1; i >= 0; i--) {
        if (gameState.effects[i].life <= 0) gameState.effects.splice(i, 1);
    }
    gameState.effects.forEach(effect => {
        const progress = 1 - effect.life / effect.maxLife;
        const alpha = Math.max(0, effect.life / effect.maxLife);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (effect.kind === 'damage' || effect.kind === 'crit-damage') {
            const rise = progress * 32;
            const scale = effect.kind === 'crit-damage' ? 1 + Math.sin(progress * Math.PI) * 0.35 : 1;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(effect.px, effect.py - rise);
            ctx.scale(scale, scale);
            ctx.fillStyle = effect.color;
            ctx.font = effect.kind === 'crit-damage' ? 'bold 22px Courier New' : 'bold 18px Courier New';
            ctx.shadowColor = effect.kind === 'crit-damage' ? 'rgba(255, 214, 90, 0.6)' : 'transparent';
            ctx.shadowBlur = effect.kind === 'crit-damage' ? 8 : 0;
            ctx.fillText(effect.text, 0, 0);
            if (effect.icon) {
                const textWidth = ctx.measureText(effect.text).width;
                ctx.font = effect.kind === 'crit-damage' ? '16px Courier New' : '13px Courier New';
                ctx.shadowBlur = 0;
                ctx.fillText(effect.icon, textWidth / 2 + 10, 0);
            }
            ctx.restore();
        } else if (effect.kind === 'crit-banner') {
            const rise = progress * 26;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = effect.color;
            ctx.font = 'bold 13px Courier New';
            ctx.shadowColor = effect.color;
            ctx.shadowBlur = 6;
            ctx.fillText(effect.text, effect.px, effect.py - rise);
            ctx.shadowBlur = 0;
        } else if (effect.kind === 'death-caption') {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = effect.color;
            ctx.font = 'italic bold 13px Courier New';
            ctx.fillText(effect.text, effect.px, effect.py - progress * 20);
        } else if (effect.kind === 'breath') {
            const fx = effect.fromX * TILE_SIZE + TILE_SIZE / 2;
            const fy = effect.fromY * TILE_SIZE + TILE_SIZE / 2;
            const tx = effect.toX * TILE_SIZE + TILE_SIZE / 2;
            const ty = effect.toY * TILE_SIZE + TILE_SIZE / 2;
            ctx.globalAlpha = alpha * 0.75;
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 6 + progress * 10;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx + (tx - fx) * 0.15, ty + (ty - fy) * 0.15);
            ctx.stroke();
            ctx.globalAlpha = alpha * 0.35;
            ctx.fillStyle = effect.color;
            ctx.beginPath();
            ctx.arc(tx, ty, 12 + progress * 28, 0, Math.PI * 2);
            ctx.fill();
        } else if (effect.kind === 'text' || effect.kind === 'warn' || effect.kind === 'xp') {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = effect.color;
            ctx.font = effect.kind === 'xp' ? 'bold 15px Courier New' : '14px Courier New';
            ctx.fillText(effect.text, effect.px, effect.py - progress * 28);
            if (effect.icon) {
                const textWidth = ctx.measureText(effect.text).width;
                ctx.font = '11px Courier New';
                ctx.fillText(effect.icon, effect.px + textWidth / 2 + 8, effect.py - progress * 28);
            }
        } else if (effect.kind === 'death') {
            drawDeathEffect(effect, progress, alpha);
        } else if (effect.kind === 'loot-beam') {
            const h = 80 + progress * 40;
            const grad = ctx.createLinearGradient(effect.px, effect.py, effect.px, effect.py - h);
            grad.addColorStop(0, effect.color);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalAlpha = alpha * 0.85;
            ctx.fillStyle = grad;
            ctx.fillRect(effect.px - 8, effect.py - h, 16, h);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#fff8db';
            ctx.beginPath();
            ctx.arc(effect.px, effect.py - h * 0.5, 6 + progress * 4, 0, Math.PI * 2);
            ctx.fill();

        // ── Spell visual effects ─────────────────────────────────────────
        } else if (effect.kind === 'spell-beam') {
            // Beam from source to target — used for Searing Light, Lightning
            const fx = effect.fromX, fy = effect.fromY;
            const tx = effect.toX, ty = effect.toY;
            const beamProgress = Math.min(1, progress * 2.5); // beam extends quickly
            const cx = fx + (tx - fx) * beamProgress;
            const cy = fy + (ty - fy) * beamProgress;
            ctx.globalAlpha = alpha * 0.9;
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 3 + (1 - progress) * 4;
            ctx.shadowColor = effect.color;
            ctx.shadowBlur = 12;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(cx, cy);
            ctx.stroke();
            // Impact glow at tip
            if (beamProgress > 0.5) {
                ctx.globalAlpha = alpha * 0.6;
                ctx.fillStyle = effect.color;
                ctx.beginPath();
                ctx.arc(tx, ty, 6 + progress * 12, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;

        } else if (effect.kind === 'spell-ring') {
            // Expanding ring — used for heal, war cry, shield wall
            const radius = 8 + progress * (effect.radius || 48);
            ctx.globalAlpha = alpha * 0.7;
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 2 + (1 - progress) * 3;
            ctx.shadowColor = effect.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(effect.px, effect.py, radius, 0, Math.PI * 2);
            ctx.stroke();
            // Inner glow
            ctx.globalAlpha = alpha * 0.15;
            ctx.fillStyle = effect.color;
            ctx.beginPath();
            ctx.arc(effect.px, effect.py, radius * 0.7, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

        } else if (effect.kind === 'spell-arc') {
            // Projectile arc from source to target — used for fireball
            const fx = effect.fromX, fy = effect.fromY;
            const tx = effect.toX, ty = effect.toY;
            const t = Math.min(1, progress * 2);
            const arcHeight = -50;
            const px = fx + (tx - fx) * t;
            const py = fy + (ty - fy) * t + arcHeight * Math.sin(t * Math.PI);
            // Trail
            ctx.globalAlpha = alpha * 0.4;
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.quadraticCurveTo((fx + tx) / 2, Math.min(fy, ty) + arcHeight, tx, ty);
            ctx.stroke();
            // Projectile head
            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = effect.color;
            ctx.shadowColor = effect.color;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(px, py, 4 + (1 - progress) * 3, 0, Math.PI * 2);
            ctx.fill();
            // Explosion at impact
            if (t >= 0.95) {
                const explodeR = (progress - 0.4) * 60;
                ctx.globalAlpha = alpha * 0.5;
                ctx.beginPath();
                ctx.arc(tx, ty, Math.max(0, explodeR), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;

        } else if (effect.kind === 'spell-trail') {
            // Fading trail between two points — used for shadow step, teleport
            const fx = effect.fromX, fy = effect.fromY;
            const tx = effect.toX, ty = effect.toY;
            ctx.globalAlpha = alpha * 0.5;
            ctx.setLineDash([6, 8]);
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 2;
            ctx.shadowColor = effect.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.setLineDash([]);
            // Departure puff
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillStyle = effect.color;
            ctx.beginPath();
            ctx.arc(fx, fy, 10 + progress * 14, 0, Math.PI * 2);
            ctx.fill();
            // Arrival flash
            ctx.globalAlpha = alpha * 0.6;
            ctx.beginPath();
            ctx.arc(tx, ty, 6 + (1 - progress) * 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

        } else {
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(effect.px, effect.py, 8 + progress * 22, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        effect.life--;
    });
    ctx.textBaseline = 'alphabetic';
}


function drawDeathEffect(effect, progress, alpha) {
    if (effect.enemyType === 'slime') {
        const splats = [
            { dx: 0, dy: 4, r: 14 },
            { dx: -12, dy: 8, r: 9 },
            { dx: 14, dy: 6, r: 10 },
            { dx: -6, dy: 16, r: 7 },
            { dx: 10, dy: 18, r: 8 },
            { dx: -16, dy: 2, r: 6 }
        ];
        splats.forEach((s, i) => {
            const spread = progress * (1.4 + i * 0.12);
            ctx.globalAlpha = alpha * (1 - progress * 0.45);
            ctx.fillStyle = i % 2 ? '#3d9e52' : '#58c26d';
            ctx.beginPath();
            ctx.ellipse(
                effect.px + s.dx * spread,
                effect.py + s.dy * spread,
                s.r * (1 + progress * 0.7),
                s.r * 0.55 * (1 + progress * 0.45),
                0, 0, Math.PI * 2
            );
            ctx.fill();
        });
    } else if (effect.enemyType === 'skeleton') {
        const bones = [
            { dx: -14, dy: -6, len: 12, ang: -0.6 },
            { dx: 12, dy: -4, len: 10, ang: 0.5 },
            { dx: -8, dy: 10, len: 14, ang: 1.2 },
            { dx: 16, dy: 8, len: 11, ang: -1.1 },
            { dx: 0, dy: 14, len: 9, ang: 0.2 },
            { dx: -18, dy: 4, len: 8, ang: 2.0 }
        ];
        ctx.strokeStyle = '#e8e4da';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        bones.forEach((b, i) => {
            const spread = progress * (1.3 + i * 0.08);
            const bx = effect.px + b.dx * spread;
            const by = effect.py + b.dy * spread + progress * 6;
            ctx.globalAlpha = alpha * (1 - progress * 0.35);
            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(b.ang + progress * 0.8);
            ctx.beginPath();
            ctx.moveTo(-b.len / 2, 0);
            ctx.lineTo(b.len / 2, 0);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(-b.len / 3, 0, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#d8d4ca';
            ctx.fill();
            ctx.restore();
        });
        ctx.globalAlpha = alpha * (1 - progress);
        ctx.fillStyle = '#d8d4ca';
        ctx.beginPath();
        ctx.arc(effect.px, effect.py + progress * 4, 5 + progress * 3, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(effect.px, effect.py, 6 + progress * 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff8db';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(effect.px, effect.py, 4 + progress * 14, 0, Math.PI * 2);
        ctx.stroke();
    }
}


function drawNoticeBoard() {
    const nb = gameState.questBoard;
    const cx = nb.x * TILE_SIZE + TILE_SIZE / 2;
    // Board frame
    ctx.fillStyle = '#4a3520';
    ctx.fillRect(nb.x * TILE_SIZE + 3, nb.y * TILE_SIZE + 5, 34, 28);
    // Parchment
    ctx.fillStyle = '#d4b97a';
    ctx.fillRect(nb.x * TILE_SIZE + 6, nb.y * TILE_SIZE + 8, 28, 22);
    // Lines on parchment
    ctx.strokeStyle = '#9a7a40';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(nb.x * TILE_SIZE + 9,  nb.y * TILE_SIZE + 13 + i * 6);
        ctx.lineTo(nb.x * TILE_SIZE + 30, nb.y * TILE_SIZE + 13 + i * 6);
        ctx.stroke();
    }
    // Quest active indicator
    if (gameState.activeQuest && !gameState.activeQuest.completed) {
        ctx.fillStyle = '#ffd65a';
        ctx.beginPath();
        ctx.arc(nb.x * TILE_SIZE + TILE_SIZE - 5, nb.y * TILE_SIZE + 5, 4, 0, Math.PI * 2);
        ctx.fill();
    }
    // Label
    ctx.fillStyle = '#d4b97a';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('BOARD', cx, nb.y * TILE_SIZE - 3);
    ctx.lineWidth = 1;
}


function drawBrewmaster() {
    const b = gameState.brewmaster;
    if (getNpcSprite('brewmaster')) { drawHubNpc(b, '#9b6b3a', 'BREW', 'brewmaster'); return; }
    const cx = b.x * TILE_SIZE + TILE_SIZE / 2;
    // Cauldron base
    ctx.fillStyle = '#443320';
    ctx.fillRect(b.x * TILE_SIZE + 8, b.y * TILE_SIZE + 22, 24, 14);
    ctx.strokeStyle = '#886644';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x * TILE_SIZE + 8, b.y * TILE_SIZE + 22, 24, 14);
    // Brew bubble
    ctx.fillStyle = '#4dbb6a';
    ctx.beginPath();
    ctx.arc(b.x * TILE_SIZE + 20, b.y * TILE_SIZE + 22, 5, 0, Math.PI * 2);
    ctx.fill();
    // NPC body
    ctx.fillStyle = '#9b6b3a';
    ctx.fillRect(b.x * TILE_SIZE + 14, b.y * TILE_SIZE + 6, 12, 16);
    // Label
    ctx.fillStyle = '#58c26d';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('BREW', cx, b.y * TILE_SIZE - 3);
    ctx.lineWidth = 1;
}


function drawBard() {
    const b = gameState.bard;
    if (getNpcSprite('bard')) { drawHubNpc(b, '#7B5EA7', 'BARD', 'bard'); return; }
    const cx = b.x * TILE_SIZE + TILE_SIZE / 2;
    // Lute body
    ctx.fillStyle = '#8B5E3C';
    ctx.beginPath();
    ctx.ellipse(b.x * TILE_SIZE + 20, b.y * TILE_SIZE + 26, 7, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    // Lute neck
    ctx.strokeStyle = '#6B4226';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x * TILE_SIZE + 20, b.y * TILE_SIZE + 16);
    ctx.lineTo(b.x * TILE_SIZE + 20, b.y * TILE_SIZE + 8);
    ctx.stroke();
    // NPC body
    ctx.fillStyle = '#7B5EA7';
    ctx.fillRect(b.x * TILE_SIZE + 14, b.y * TILE_SIZE + 6, 12, 14);
    // Music note if song active
    if (gameState.activeSong) {
        ctx.fillStyle = '#d4b97a';
        ctx.font = '10px serif';
        ctx.textAlign = 'center';
        ctx.fillText('♪', b.x * TILE_SIZE + TILE_SIZE - 4, b.y * TILE_SIZE + 8);
    }
    // Label
    ctx.fillStyle = '#c49eff';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('BARD', cx, b.y * TILE_SIZE - 3);
    ctx.lineWidth = 1;
}


function drawStashChest() {
    const s = gameState.stashChest;
    const tx = s.x * TILE_SIZE;
    const ty = s.y * TILE_SIZE;
    const cx = tx + TILE_SIZE / 2;
    // Chest body
    ctx.fillStyle = '#7B4A1E';
    ctx.fillRect(tx + 6, ty + 16, 28, 18);
    // Chest lid
    ctx.fillStyle = '#A0622A';
    ctx.fillRect(tx + 6, ty + 10, 28, 8);
    // Metal bands
    ctx.strokeStyle = '#c8a060';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tx + 6, ty + 10, 28, 26);
    ctx.beginPath();
    ctx.moveTo(tx + 6, ty + 18); ctx.lineTo(tx + 34, ty + 18);
    ctx.stroke();
    // Lock
    ctx.fillStyle = '#c8a060';
    ctx.fillRect(tx + 17, ty + 18, 6, 5);
    // Glow if stash has items
    if (gameSharedStash.length > 0) {
        ctx.fillStyle = 'rgba(255,214,90,0.18)';
        ctx.fillRect(tx + 4, ty + 8, 32, 30);
    }
    // Label
    ctx.fillStyle = '#e8c87a';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('STASH', cx, ty - 3);
    ctx.lineWidth = 1;
}


function drawCellar() {
    const c = gameState.cellar;
    const tx = c.x * TILE_SIZE;
    const ty = c.y * TILE_SIZE;
    const cx = tx + TILE_SIZE / 2;
    const cy = ty + TILE_SIZE / 2;

    // Trapdoor flush with the floor — flat planks rather than a raised
    // chest/board, since this is meant to read as part of the floor
    // itself (a hidden hatch) rather than furniture sitting on top of it.
    ctx.fillStyle = '#4a3a26';
    ctx.fillRect(tx + 4, ty + 6, 32, 28);
    ctx.strokeStyle = '#2e2415';
    ctx.lineWidth = 1;
    // Plank seams
    [12, 20, 28].forEach(dy => {
        ctx.beginPath();
        ctx.moveTo(tx + 4, ty + dy);
        ctx.lineTo(tx + 36, ty + dy);
        ctx.stroke();
    });
    ctx.strokeStyle = '#6b5436';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx + 4, ty + 6, 32, 28);
    ctx.lineWidth = 1;
    // Iron ring pull
    ctx.strokeStyle = '#8a8478';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, ty + 24, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Faint glow if there's an unclaimed find this run — rewards an
    // observant player without giving away what's down there, same
    // "glow if has contents" idea as drawStashChest above.
    if (gameState.cellarHasFind && !gameState.cellarClaimed) {
        const flicker = 0.5 + Math.sin(gameState.frameTick * 0.08) * 0.2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 26);
        grad.addColorStop(0, `rgba(212, 185, 122, ${0.3 * flicker})`);
        grad.addColorStop(1, 'rgba(212, 185, 122, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    ctx.fillStyle = '#d4b97a';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('CELLAR', cx, ty - 3);
}


function drawArenaGate() {
    // In the courtyard, the arena is reached via the south zone exit (x=12, y=16),
    // NOT via the old tavern-interior gate at (6,12). Using gameState.arenaGate
    // coordinates here placed the gate visual in the middle of the courtyard,
    // making it look like an impassable wall across the walkable area.
    const isCourtyard = gameState.inCourtyard;
    const gx = isCourtyard ? 12 : gameState.arenaGate.x;
    const gy = isCourtyard ? (MAP_HEIGHT - 2) : gameState.arenaGate.y;
    const tx = gx * TILE_SIZE;
    const ty = gy * TILE_SIZE;
    const cx = tx + TILE_SIZE / 2;
    const cy = ty + TILE_SIZE / 2;
    const unlocked = isArenaUnlocked();

    // Stone archway frame around the entrance tile itself
    ctx.fillStyle = '#2e2a26';
    ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);

    // Vertical iron bars — the "gate" itself
    ctx.strokeStyle = unlocked ? '#8a8478' : '#4a4640';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
        const bx = tx + 4 + i * 7;
        ctx.beginPath();
        ctx.moveTo(bx, ty + 2);
        ctx.lineTo(bx, ty + TILE_SIZE - 2);
        ctx.stroke();
    }
    ctx.lineWidth = 1;

    if (!unlocked) {
        // Chain-and-padlock overlay communicates "locked" at a glance,
        // independent of the approach message text.
        ctx.strokeStyle = '#6b5d35';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx + 4, ty + TILE_SIZE / 2);
        ctx.lineTo(tx + TILE_SIZE - 4, ty + TILE_SIZE / 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#8a7a45';
        ctx.fillRect(cx - 5, cy - 4, 10, 9);
        ctx.strokeStyle = '#4a3f20';
        ctx.strokeRect(cx - 5, cy - 4, 10, 9);
    } else {
        // Faint warm glow once unlocked — same visual language as the
        // Cellar's "has a find" glow, signaling "something's here now"
        // without needing the player to re-read the approach text.
        const flicker = 0.4 + Math.sin(gameState.frameTick * 0.07) * 0.15;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 30);
        grad.addColorStop(0, `rgba(200, 80, 50, ${0.25 * flicker})`);
        grad.addColorStop(1, 'rgba(200, 80, 50, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    ctx.fillStyle = unlocked ? '#e1b94b' : '#8a8478';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('THE PIT', cx, ty - 3);
}


// Spectator crowd that gathers around the Pit gate as the player's Arena fame
// rises — the visible payoff of reputation. Nobody at Unknown; a couple of
// onlookers by Challenger; a packed, cheering crowd by Legend. Figures are
// simple bobbing silhouettes (same visual language as the tavern's painted
// NPCs) placed at fixed offsets around the gate so they never overlap it or
// the player's approach tile. Purely cosmetic.
function drawArenaCrowd() {
    if (typeof isArenaUnlocked !== 'function' || !isArenaUnlocked()) return;
    const fame = getPitFame();
    if (fame <= 0) return;
    const tier = getPitTier();
    // Number of spectators scales with tier index (0..5) → up to 8 figures
    const tierIndex = PIT_FAME_TIERS.findIndex(t => t.title === tier.title);
    const count = Math.min(8, tierIndex * 2);
    if (count <= 0) return;

    const g = gameState.arenaGate;
    // Use the correct gate position depending on context — courtyard uses the
    // south exit, not the tavern-interior gate at (6,12).
    const baseX = gameState.inCourtyard ? 12 : g.x;
    const baseY = gameState.inCourtyard ? (MAP_HEIGHT - 2) : g.y;
    // ordered so lower counts still look balanced. Avoids the gate tile (6,12)
    // and the tile directly above it where the player approaches.
    const slots = [
        { dx: -2, dy: 0 }, { dx: 2, dy: 0 },
        { dx: -2, dy: 2 }, { dx: 2, dy: 2 },
        { dx: -1, dy: 3 }, { dx: 1, dy: 3 },
        { dx: -3, dy: 1 }, { dx: 3, dy: 1 },
    ];
    // Warm "torchlit crowd" palette — varied so the crowd doesn't look cloned
    const bodyColors = ['#6b4a32', '#7a5240', '#5e4738', '#6f5a44', '#80604a', '#5a4a3c'];

    for (let i = 0; i < count; i++) {
        const s = slots[i];
        const gx = (baseX + s.dx) * TILE_SIZE;
        const gy = (baseY + s.dy) * TILE_SIZE;
        if (gx < 0 || gy < 0) continue;
        const cx = gx + TILE_SIZE / 2;
        // Each spectator bobs at its own phase — a restless, alive crowd.
        // Higher tiers bob faster/taller, reading as more excited.
        const energy = 0.4 + tierIndex * 0.12;
        const bob = Math.sin(gameState.frameTick * (0.06 + tierIndex * 0.015) + i * 1.7) * (1.5 + energy);
        const feetY = gy + TILE_SIZE - 6 + bob;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(cx, gy + TILE_SIZE - 4, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // Body
        ctx.fillStyle = bodyColors[i % bodyColors.length];
        ctx.fillRect(cx - 6, feetY - 16, 12, 16);
        // Head
        ctx.fillStyle = '#caa987';
        ctx.beginPath();
        ctx.arc(cx, feetY - 19, 5, 0, Math.PI * 2);
        ctx.fill();
        // At Champion+ some spectators raise an arm (cheering)
        if (tierIndex >= 4 && i % 2 === 0) {
            ctx.strokeStyle = bodyColors[i % bodyColors.length];
            ctx.lineWidth = 3;
            const raise = Math.abs(Math.sin(gameState.frameTick * 0.12 + i)) * 6;
            ctx.beginPath();
            ctx.moveTo(cx + 5, feetY - 12);
            ctx.lineTo(cx + 9, feetY - 18 - raise);
            ctx.stroke();
            ctx.lineWidth = 1;
        }
    }
}


function drawMagicDealer() {
    const d = gameState.magicDealer;
    if (getNpcSprite('magicdealer')) { drawHubNpc(d, '#7b5fff', 'MAGIC', 'magicdealer'); return; }
    const tx = d.x * TILE_SIZE;
    const ty = d.y * TILE_SIZE;
    const cx = tx + TILE_SIZE / 2;
    const t = Date.now() / 1000;

    // Pulsing orb glow
    ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 2.4);
    ctx.fillStyle = '#7b5fff';
    ctx.beginPath();
    ctx.arc(tx + 20, ty + 14, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Robe
    ctx.fillStyle = '#2a1050';
    ctx.fillRect(tx + 12, ty + 16, 16, 18);
    // Hood
    ctx.fillStyle = '#3d1a78';
    ctx.beginPath();
    ctx.arc(tx + 20, ty + 14, 9, 0, Math.PI * 2);
    ctx.fill();
    // Orb in hand
    ctx.fillStyle = '#55c7ff';
    ctx.beginPath();
    ctx.arc(tx + 30, ty + 22, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c49eff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#a07fd4';
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('DEALER', cx, ty - 3);
    ctx.lineWidth = 1;
}


// ── Market floor markers ───────────────────────────────────────────────────
// Same breathing-pulse markers as drawNpcFloorMarkers but reads from
// MARKET_INTERACTABLES and checks arenaGate adjacency for the Pit marker.
function drawMarketFloorMarkers() {
    if (typeof MARKET_INTERACTABLES === 'undefined') return;
    const adj = (typeof getAdjacentInteractable === 'function') ? getAdjacentInteractable() : null;
    const adjNpc = adj?.npc;

    MARKET_INTERACTABLES.forEach(def => {
        const npc = gameState[def.key];
        if (!npc) return;
        const cx = npc.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = npc.y * TILE_SIZE + TILE_SIZE - 6;
        const isAdj = npc === adjNpc;
        const pulse = 0.5 + Math.sin(gameState.frameTick * 0.06 + npc.x * 0.7) * 0.5;
        const baseAlpha = isAdj ? 0.45 : 0.18;
        const alpha = baseAlpha + pulse * (isAdj ? 0.25 : 0.10);
        const rx = isAdj ? 16 : 13, ry = isAdj ? 6 : 5;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
        g.addColorStop(0, _hexToRgba(def.color, alpha));
        g.addColorStop(1, _hexToRgba(def.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (isAdj) {
            ctx.save();
            ctx.strokeStyle = _hexToRgba(def.color, 0.55 + pulse * 0.3);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx + 2, ry + 2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    });

    // Pit gate marker
    const g2 = gameState.arenaGate;
    if (g2 && adjNpc === g2) {
        const cx = g2.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = g2.y * TILE_SIZE + TILE_SIZE - 6;
        const pulse = 0.5 + Math.sin(gameState.frameTick * 0.06) * 0.5;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createRadialGradient(cx, cy, 1, cx, cy, 18);
        gr.addColorStop(0, _hexToRgba('#ff9f58', 0.55 + pulse * 0.25));
        gr.addColorStop(1, _hexToRgba('#ff9f58', 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 18, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}


// ── Market details — vendor NPCs drawn in the courtyard ────────────────────
// Six commerce NPCs arranged in two rows (north y=4, south y=13) plus
// "THE MARKET" banner text. Positions match MARKET_INTERACTABLES in data.js.
function drawMarketDetails() {
    // North row vendors
    drawHubNpc(gameState.merchant,   '#5ad1c2', 'MERCHANT',  'merchant');
    drawHubNpc(gameState.trainer,    '#58c26d', 'TRAINER',   'trainer');
    drawHubNpc(gameState.bank,       '#ffd65a', 'BANK',      'bank');
    // South row vendors
    drawHubNpc(gameState.blacksmith, '#c45c00', 'BLACKSMITH','blacksmith');
    drawHubNpc(gameState.magicDealer,'#9c6dff', 'ARCANE',    'magicDealer');
    drawNoticeBoard();
    // Market sign at the top center
    const mx = 12 * TILE_SIZE + TILE_SIZE / 2;
    ctx.fillStyle = 'rgba(200,160,60,0.18)';
    ctx.fillRect(mx - 58, 4, 116, 14);
    ctx.strokeStyle = 'rgba(200,160,60,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 58, 4, 116, 14);
    ctx.fillStyle = '#d4a96a';
    ctx.font = 'bold 8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('⚑  THE MARKET  ⚑', mx, 14);
    ctx.textAlign = 'left';
}


// ── Town Road Sign (kept for inTown rendering, not used in courtyard) ──────
function drawTownRoadSign() {
    const gx = 0 * TILE_SIZE;
    const gy = 8 * TILE_SIZE;
    ctx.fillStyle = '#5a4a38';
    ctx.fillRect(gx + 2, gy - 4, TILE_SIZE - 4, 8);
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(gx + 14, gy - 20, 4, 20);
    ctx.fillStyle = '#a0784a';
    ctx.fillRect(gx + 2, gy - 32, 34, 14);
    ctx.strokeStyle = '#6a4a28';
    ctx.lineWidth = 1;
    ctx.strokeRect(gx + 2, gy - 32, 34, 14);
    ctx.fillStyle = '#ffe8b0';
    ctx.font = '7px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('TOWN', gx + 19, gy - 22);
    ctx.fillText('→', gx + 19, gy - 13);
    ctx.textAlign = 'left';
}

// ── Town Details (NPCs, well, gate, lamp posts) ────────────────────────────────
function drawTownDetails() {
    const T = TILE_SIZE;

    // Town Gate (north wall, x=10-14, y=0)
    const gx1 = 10 * T, gx2 = 14 * T;
    ctx.fillStyle = '#5a5050';
    ctx.fillRect(gx1, 0, T * 4, T * 0.6);
    // Gate arch
    ctx.fillStyle = '#6a6060';
    ctx.beginPath();
    ctx.arc((gx1 + gx2) / 2 + T, T * 0.3, T * 0.9, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#2a2020';
    ctx.fillRect(gx1 + T * 0.5, 0, T * 2, T * 0.6);
    // Gate label
    ctx.fillStyle = '#c8a870';
    ctx.font = 'bold 9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('TOWN GATE', (gx1 + gx2) / 2 + T, T * 0.45);

    // Well at town square centre (x=12, y=8)
    const wx = 12 * T + T / 2, wy = 8 * T + T / 2;
    // Well base
    ctx.fillStyle = '#4a4040';
    ctx.beginPath(); ctx.arc(wx, wy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6a5a4a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(wx, wy, 12, 0, Math.PI * 2); ctx.stroke();
    // Well interior
    ctx.fillStyle = '#1a2a3a';
    ctx.beginPath(); ctx.arc(wx, wy, 8, 0, Math.PI * 2); ctx.fill();
    // Well crossbeam
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(wx - 2, wy - 16, 4, 10);
    ctx.fillRect(wx - 10, wy - 17, 20, 3);

    // Lamp posts at road intersections (x=9,y=7), (x=15,y=7), (x=9,y=9), (x=15,y=9)
    [[9,7],[15,7],[9,9],[15,9]].forEach(([lpx,lpy]) => {
        const lx = lpx * T + T / 2, ly = lpy * T + T / 2;
        const flicker = 0.7 + Math.sin(gameState.frameTick * 0.07 + lpx * 2.1 + lpy * 1.3) * 0.15;
        // Post
        ctx.fillStyle = '#4a3a2a';
        ctx.fillRect(lx - 2, ly - 12, 4, 16);
        // Lamp housing
        ctx.fillStyle = '#6a5a3a';
        ctx.fillRect(lx - 5, ly - 18, 10, 8);
        // Glow
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const lg = ctx.createRadialGradient(lx, ly - 14, 1, lx, ly - 14, 22);
        lg.addColorStop(0, `rgba(255, 200, 80, ${flicker * 0.4})`);
        lg.addColorStop(1, 'rgba(200, 120, 0, 0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx, ly - 14, 22, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    });

    // General Store NPC (x=5, y=4)
    _drawTownNpc(5, 4, '#c8a060', '🛒', 'STORE');
    // Temple NPC (x=19, y=4)
    _drawTownNpc(19, 4, '#fff3b0', '✚', 'TEMPLE');
    // Alchemist NPC (x=5, y=13)
    _drawTownNpc(5, 13, '#9fe6b0', '⚗', 'ALCHEM');
    // Town Hall (x=19, y=13)
    _drawTownNpc(19, 13, '#7fb0ff', '⚑', 'T.HALL');

    // Building signs above doorways
    const signs = [
        { x: 5, y: 7, label: 'GENERAL STORE' },
        { x: 19, y: 7, label: 'TEMPLE' },
        { x: 5, y: 9, label: 'ALCHEMIST' },
        { x: 19, y: 9, label: 'TOWN HALL' },
    ];
    ctx.font = '7px Courier New';
    ctx.textAlign = 'center';
    signs.forEach(s => {
        ctx.fillStyle = '#c8a870';
        ctx.fillText(s.label, s.x * T + T / 2, s.y * T - 3);
    });
    ctx.textAlign = 'left';

    // Road-back sign (right wall, x=24, y=8)
    ctx.fillStyle = '#a0784a';
    ctx.fillRect(23 * T + 4, 8 * T - 14, 28, 12);
    ctx.fillStyle = '#ffe8b0';
    ctx.font = '7px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('← INN', 23 * T + 18, 8 * T - 5);
    ctx.textAlign = 'left';
}

function _drawTownNpc(tx, ty, color, icon, label) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = ty * TILE_SIZE + TILE_SIZE / 2;
    const bob = Math.sin(gameState.frameTick * 0.05 + tx * 1.7 + ty * 0.9) * 1.5;
    // Body
    ctx.fillStyle = color;
    ctx.fillRect(cx - 8, cy - 12 + bob, 16, 24);
    // Icon
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, cx, cy - 4 + bob);
    // Label
    ctx.font = '7px Courier New';
    ctx.fillStyle = '#e2ccaa';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, cx, ty * TILE_SIZE - 3);
    ctx.textAlign = 'left';
}
