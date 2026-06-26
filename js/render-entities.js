// render-entities.js — Player, enemies, items, effects system, hub-NPC
// drawing, floor markers, navigation aids, interaction prompt.
// Loaded after render-tavern.js.

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


// Effects (floating text, damage numbers, death anims, bursts) are purely
// visual and are pushed onto gameState.effects, then drained inside
// drawEffects() — which runs from draw(). When the bot suppresses rendering
// (headless/minimap during fast batches), draw() early-returns, so the effects
// array is FED but never DRAINED and grows unbounded across the batch — a real
// memory leak in Turbo runs. Since nothing will ever render or drain them in
// that mode, the pushers below no-op when rendering is suppressed.
function _effectsSuppressed() {
    return (typeof window !== 'undefined' && window._botSkipRender) ||
           gameState.headless === true ||
           gameState.botDisplay === 'headless' ||
           gameState.renderMode === 'headless';
}

function addDamageNumber(x, y, amount, options = {}) {
    if (_effectsSuppressed()) return;
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
    if (_effectsSuppressed()) return;
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
    if (_effectsSuppressed()) return;
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
    if (_effectsSuppressed()) return;
    gameState.effects.push({ kind: 'burst', px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2, color, life: 18, maxLife: 18 });
}


function drawEffects() {
    // Prune expired effects — swap-and-pop instead of splice:
    // splice is O(n) per removal (shifts all subsequent elements);
    // swap-and-pop is O(1) and avoids GC alloc from index shifting.
    // Order within the effects array is irrelevant for rendering.
    const efx = gameState.effects;
    for (let i = efx.length - 1; i >= 0; i--) {
        if (efx[i].life <= 0) { efx[i] = efx[efx.length - 1]; efx.pop(); }
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
