// render-tavern.js — Tavern interior scene: trophy hall, shop areas,
// innkeeper/bar, ambient patrons, speech bubbles, milestone decorations,
// legendary guests, fireplace, dust motes. Loaded after render-tiles.js.


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

