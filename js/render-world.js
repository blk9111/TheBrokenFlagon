// render-world.js — Outworld scenes drawn at floor 0 outside the tavern:
// notice board, brewmaster, bard, stash, cellar, arena gate and crowd,
// magic dealer, market floor markers, market NPC details, town sign,
// town details, and town-NPC helper. Loaded last.

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
    drawHubNpc(gameState.blacksmith,    '#c45c00', 'BLACKSMITH', 'blacksmith');
    drawHubNpc(gameState.magicDealer,   '#9c6dff', 'ARCANE',     'magicDealer');
    drawHubNpc(gameState.loteriaCaller, '#ff9f58', 'LOTER\u00cdA', 'gambler');
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
