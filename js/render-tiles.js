// render-tiles.js — Tile textures, dungeon map drawing, lighting, fog,
// decorations, and particle effects. Loaded after render.js.
// Uses globals: ctx, canvas, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT,
//               LOGICAL_W, LOGICAL_H, gameState (all from data.js/render.js).

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
    // Three.js WebGL handles tiles, walls, fog-of-war, and lighting when active.
    // Canvas 2D only needs to draw interactables/traps/entities (called separately
    // from draw() in render.js — nothing here needs to run in that case).
    if (typeof threeJsActive === 'function' && threeJsActive()) return;

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

