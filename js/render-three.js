// render-three.js — Three.js WebGL renderer (r128) for dungeon tiles & lighting.
// Loaded via <script> BEFORE render.js. Provides:
//   initThreeJS()        — one-time setup, called from gameLoop init in render.js
//   updateThreeDungeon() — per-frame, called from draw() before entity drawing
//   threeJsActive()      — returns true once WebGL is live
//
// A #three-canvas WebGL canvas sits BELOW #game-canvas (Canvas 2D).
// Three.js renders tiles, walls, fog-of-war, and dynamic PointLights.
// Canvas 2D renders entities, text, HUD on top (transparent background).

let _THREE_ACTIVE = false;
let _renderer = null, _scene = null, _camera = null;
const _MAX_INST = 2400;
let _floorMesh = null, _wallMesh = null, _darkMesh = null;
let _ambientLight = null, _torchLight = null, _torchLight2 = null;
const _enemyLights = [], _exitLights = [];
let _dummy = null, _col = null;

// ── Extra FX pools ────────────────────────────────────────────────────────────
const _itemLights   = [];   // rarity-coloured glow on pickup items
const _sconceLights = [];   // independent wall-sconce torches per floor
let   _sconceFloor  = -99;  // track which floor the sconces were placed on
const _SCONCE_COUNT = 6;
const _ITEM_LIGHT_COUNT = 8;

// ── Mist / fog particles ──────────────────────────────────────────────────────
let _mistPoints = null;
let _mistPos    = null; // Float32Array of xyz for each particle
let _mistVel    = null; // Float32Array of vx, vy per particle
const _MIST_COUNT = 220;

// Base tile colours — dark stone; ambient + torch bring these to life
const PAL = {
    FLOOR:      [0.28, 0.20, 0.12],  // warm stone
    FLOOR_EXIT: [0.14, 0.28, 0.16],  // mossy green stairs-down
    FLOOR_UP:   [0.18, 0.12, 0.28],  // cool purple stairs-up
    WALL:       [0.22, 0.15, 0.08],  // darker warm stone
};

// Rarity → light colour map
const _RARITY_COL = {
    common:    0xffd8a0,
    uncommon:  0x50e870,
    rare:      0x4090ff,
    epic:      0xc060ff,
    legendary: 0xffa020,
    mythic:    0xff30a0,
};


function initThreeJS() {
    if (typeof THREE === 'undefined') { console.warn('[render-three] THREE not found'); return false; }
    const gc = document.getElementById('three-canvas');
    if (!gc) { console.warn('[render-three] #three-canvas not found'); return false; }

    _dummy = new THREE.Object3D();
    _col   = new THREE.Color();

    _renderer = new THREE.WebGLRenderer({ canvas: gc, antialias: false, alpha: false, powerPreference: 'high-performance' });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    _renderer.setClearColor(0x080502, 1);

    _scene = new THREE.Scene();
    _scene.fog = new THREE.FogExp2(0x060402, 0.0006);

    // Orthographic camera: logical 1000x720 world units, Y-flipped vs canvas
    _camera = new THREE.OrthographicCamera(0, LOGICAL_W, 0, -LOGICAL_H, 0.1, 600);
    _camera.position.set(0, 0, 200);
    _camera.lookAt(0, 0, 0);

    // Lights
    // Ambient — raised so tiles stay visible even beyond the torch radius
    _ambientLight = new THREE.AmbientLight(0x3a2a18, 1.2);
    _scene.add(_ambientLight);

    // Primary torch — extended range covers the full dungeon
    _torchLight = new THREE.PointLight(0xff9820, 4.5, 700, 1.4);
    _torchLight.position.z = 44;
    _scene.add(_torchLight);

    // Offset secondary for richer flame look
    _torchLight2 = new THREE.PointLight(0xffb840, 1.8, 350, 1.8);
    _torchLight2.position.z = 22;
    _scene.add(_torchLight2);

    for (let i = 0; i < 10; i++) {
        const el = new THREE.PointLight(0xff2008, 0, 120, 2.5);
        el.position.z = 20; el.visible = false; _scene.add(el); _enemyLights.push(el);
    }
    for (let i = 0; i < 4; i++) {
        const xl = new THREE.PointLight(0x20ff70, 2.5, 200, 2.0);
        xl.position.z = 24; xl.visible = false; _scene.add(xl); _exitLights.push(xl);
    }

    // ── Item rarity lights ────────────────────────────────────────────────
    for (let i = 0; i < _ITEM_LIGHT_COUNT; i++) {
        const il = new THREE.PointLight(0xffd8a0, 0, 90, 2.5);
        il.position.z = 16; il.visible = false; _scene.add(il); _itemLights.push(il);
    }

    // ── Wall sconce lights ────────────────────────────────────────────────
    for (let i = 0; i < _SCONCE_COUNT; i++) {
        const sl = new THREE.PointLight(0xffa030, 0, 160, 2.0);
        sl.position.z = 20; sl.visible = false; _scene.add(sl); _sconceLights.push(sl);
    }

    // ── Dungeon mist particles ────────────────────────────────────────────
    _initMist();

    _buildTileMeshes();
    _resizeThree();
    window.addEventListener('resize', _resizeThree);
    _THREE_ACTIVE = true;
    console.log('[render-three] WebGL dungeon layer active (Three.js r128)');
    return true;
}


function _buildTileMeshes() {
    const TS = TILE_SIZE, wallH = Math.round(TS * 0.32);

    _floorMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(TS, TS),
        new THREE.MeshLambertMaterial(), _MAX_INST);
    _floorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _floorMesh.count = 0; _scene.add(_floorMesh);

    _wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(TS, TS, wallH),
        new THREE.MeshLambertMaterial(), _MAX_INST);
    _wallMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _wallMesh.count = 0; _scene.add(_wallMesh);

    _darkMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(TS, TS),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.94 }), _MAX_INST);
    _darkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _darkMesh.count = 0; _darkMesh.position.z = 6; _scene.add(_darkMesh);
}

function _resizeThree() {
    if (!_renderer || !_camera) return;
    const gc = document.getElementById('three-canvas');
    if (!gc) return;
    const par = gc.parentElement;
    const w = par ? par.clientWidth : window.innerWidth;
    const h = par ? par.clientHeight : window.innerHeight;
    _renderer.setSize(w, h, false);
    const scale = Math.min(w / LOGICAL_W, h / LOGICAL_H);
    const hw = (w / scale) / 2, hh = (h / scale) / 2;
    const cx = LOGICAL_W / 2, cy = -LOGICAL_H / 2;
    _camera.left = cx - hw; _camera.right = cx + hw;
    _camera.top = cy + hh; _camera.bottom = cy - hh;
    _camera.updateProjectionMatrix();
}


function updateThreeDungeon() {
    if (!_THREE_ACTIVE || !_renderer) return;
    const s = gameState;
    if (!s?.dungeon) return;
    const dungeon = s.dungeon;
    const mapH = dungeon.length, mapW = dungeon[0]?.length || 0;
    const TS = TILE_SIZE, t = Date.now() * 0.001;
    let fi = 0, wi = 0, di = 0;

    for (let ty = 0; ty < mapH; ty++) {
        for (let tx = 0; tx < mapW; tx++) {
            const tile = dungeon[ty]?.[tx];
            if (tile === undefined) continue;
            const wx = (tx + 0.5) * TS, wy = -((ty + 0.5) * TS);

            if (tile === 1) {
                if (wi < _MAX_INST) {
                    const wallH = Math.round(TS * 0.32);
                    _dummy.position.set(wx, wy, wallH / 2);
                    _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
                    _wallMesh.setMatrixAt(wi, _dummy.matrix);
                    const d = Math.min((s.floor || 0) * 0.015, 0.20);
                    _col.setRGB(PAL.WALL[0]+d, PAL.WALL[1]+d*0.65, PAL.WALL[2]+d*0.35);
                    _wallMesh.setColorAt(wi, _col); wi++;
                }
            } else {
                if (fi < _MAX_INST) {
                    _dummy.position.set(wx, wy, 0);
                    _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
                    _floorMesh.setMatrixAt(fi, _dummy.matrix);
                    const pal = tile===2 ? PAL.FLOOR_EXIT : tile===3 ? PAL.FLOOR_UP : PAL.FLOOR;
                    _col.setRGB(pal[0], pal[1], pal[2]);
                    _floorMesh.setColorAt(fi, _col); fi++;
                }
            }
            // Only place dark overlay when a tile is *explicitly* marked unrevealed.
            // If gameState.revealed is null/undefined (tavern init before revealAll()
            // fires), treat every tile as visible — avoids a black blanket over tiles.
            const isRevealed = !s.revealed || s.revealed[ty]?.[tx];
            if (!isRevealed && di < _MAX_INST) {
                _dummy.position.set(wx, wy, 0);
                _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
                _darkMesh.setMatrixAt(di, _dummy.matrix); di++;
            }
        }
    }

    _floorMesh.count = fi; _wallMesh.count = wi; _darkMesh.count = di;
    _floorMesh.instanceMatrix.needsUpdate = true;
    _wallMesh.instanceMatrix.needsUpdate = true;
    _darkMesh.instanceMatrix.needsUpdate = true;
    if (_floorMesh.instanceColor) _floorMesh.instanceColor.needsUpdate = true;
    if (_wallMesh.instanceColor) _wallMesh.instanceColor.needsUpdate = true;


    // Player torch — dual-frequency flicker for realistic flame
    const p = s.player;
    if (p && _torchLight) {
        const rx = (p.renderX !== undefined ? p.renderX : p.x*TS) + TS/2;
        const ry = -((p.renderY !== undefined ? p.renderY : p.y*TS) + TS/2);
        _torchLight.position.set(rx, ry, 44);
        _torchLight2.position.set(rx+10, ry-8, 24);
        _torchLight.intensity  = 5.0 + Math.sin(t*3.8)*0.6 + Math.sin(t*7.1)*0.25;
        _torchLight2.intensity = 2.0 + Math.sin(t*5.2+1.1)*0.35;
    }

    // Enemy aura lights
    const alive = (s.enemies||[]).filter(e => e.hp>0 && s.revealed?.[e.y]?.[e.x]).slice(0,10);
    _enemyLights.forEach((light, i) => {
        const e = alive[i];
        if (e) {
            const ex = (e.renderX!==undefined?e.renderX:e.x*TS)+TS/2;
            const ey = -((e.renderY!==undefined?e.renderY:e.y*TS)+TS/2);
            light.position.set(ex, ey, 20);
            const boss = e.type==='boss'||e.bossVariant;
            light.intensity = (boss?2.4:0.65)*(boss?1+Math.sin(t*2.8+i)*0.4:1);
            light.color.setHex(boss?0xff0840:0xff3008);
            light.distance = boss?190:105; light.visible = true;
        } else { light.visible = false; }
    });

    // Exit beacon lights
    const exits = (typeof _getExitTiles==='function'?_getExitTiles():[])
        .filter(e=>s.revealed?.[e.y]?.[e.x]).slice(0,4);
    _exitLights.forEach((light, i) => {
        const ex = exits[i];
        if (ex) {
            light.position.set((ex.x+0.5)*TS,-((ex.y+0.5)*TS),24);
            light.intensity = 2.5+Math.sin(t*2.3+i*0.8)*0.9; light.visible = true;
        } else { light.visible = false; }
    });

    // ── New FX systems ────────────────────────────────────────────────────
    _updateMist(t);
    _updateSconces(t);
    _updateItemLights(t);
    _updateAmbient(t);

    _syncCamera();
    _renderer.render(_scene, _camera);
}
function _syncCamera() {
    const gc = document.getElementById('three-canvas');
    if (!gc||!_camera) return;
    const w=gc.clientWidth||LOGICAL_W, h=gc.clientHeight||LOGICAL_H;
    const scale=Math.min(w/LOGICAL_W,h/LOGICAL_H);
    const hw=(w/scale)/2, hh=(h/scale)/2;
    const cx=LOGICAL_W/2, cy=-LOGICAL_H/2;
    const shake=gameState?.screenShake||0, angle=gameState?.screenShakeAngle||0;
    const sx=shake>0.5?Math.cos(angle)*shake:0;
    const sy=shake>0.5?Math.sin(angle)*shake:0;
    _camera.left=cx-hw+sx; _camera.right=cx+hw+sx;
    _camera.top=cy+hh-sy; _camera.bottom=cy-hh-sy;
    _camera.updateProjectionMatrix();
}

// ── Mist init ─────────────────────────────────────────────────────────────────
function _initMist() {
    const pos = new Float32Array(_MIST_COUNT * 3);
    _mistVel  = new Float32Array(_MIST_COUNT * 2);
    const alpha = new Float32Array(_MIST_COUNT);

    for (let i = 0; i < _MIST_COUNT; i++) {
        pos[i*3]   = Math.random() * LOGICAL_W;
        pos[i*3+1] = -(Math.random() * LOGICAL_H);
        pos[i*3+2] = 3; // just above floor, below fog-of-war overlay (z=6)
        _mistVel[i*2]   = (Math.random() - 0.5) * 0.25;
        _mistVel[i*2+1] = (Math.random() - 0.5) * 0.08;
        alpha[i] = Math.random(); // phase offset for opacity flicker
    }
    _mistPos = pos;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
        size: 12, color: 0x8899bb, transparent: true,
        opacity: 0.10, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: false
    });

    _mistPoints = new THREE.Points(geo, mat);
    _scene.add(_mistPoints);
}

// ── Mist update (called per frame) ───────────────────────────────────────────
function _updateMist(t) {
    if (!_mistPoints || !_mistPos) return;
    const s = gameState;
    const W = (s?.dungeon?.[0]?.length || MAP_WIDTH)  * TILE_SIZE;
    const H = (s?.dungeon?.length      || MAP_HEIGHT) * TILE_SIZE;

    for (let i = 0; i < _MIST_COUNT; i++) {
        _mistPos[i*3]   += _mistVel[i*2];
        _mistPos[i*3+1] += _mistVel[i*2+1];
        // Wrap around dungeon bounds
        if (_mistPos[i*3]   < 0)  _mistPos[i*3]   = W;
        if (_mistPos[i*3]   > W)  _mistPos[i*3]   = 0;
        if (_mistPos[i*3+1] > 0)  _mistPos[i*3+1] = -H;
        if (_mistPos[i*3+1] < -H) _mistPos[i*3+1] = 0;
    }
    _mistPoints.geometry.attributes.position.needsUpdate = true;
    // Slow opacity pulse based on floor depth
    const depthOpacity = Math.min(0.06 + (s?.floor || 0) * 0.0025, 0.18);
    _mistPoints.material.opacity = depthOpacity + Math.sin(t * 0.4) * 0.02;
}

// ── Wall sconce placement (regenerates on floor change) ──────────────────────
function _updateSconces(t) {
    const s = gameState;
    if (!s?.dungeon || s.floor === 0) {
        _sconceLights.forEach(l => l.visible = false); return;
    }

    // Regenerate positions when floor changes
    if (s.floor !== _sconceFloor) {
        _sconceFloor = s.floor;
        const dungeon = s.dungeon;
        const H = dungeon.length, W = dungeon[0]?.length || 0;
        const candidates = [];
        for (let ty = 1; ty < H-1; ty++) {
            for (let tx = 1; tx < W-1; tx++) {
                if (dungeon[ty][tx] !== 0) continue; // floor only
                // Adjacent to at least one wall
                const hasWall = [[0,-1],[0,1],[-1,0],[1,0]].some(([dx,dy]) =>
                    dungeon[ty+dy]?.[tx+dx] === 1);
                if (hasWall) candidates.push({x:tx, y:ty});
            }
        }
        // Shuffle and pick _SCONCE_COUNT positions
        for (let i = candidates.length-1; i > 0; i--) {
            const j = Math.floor(Math.random()*(i+1));
            [candidates[i],candidates[j]] = [candidates[j],candidates[i]];
        }
        _sconceLights.forEach((light, i) => {
            const pos = candidates[i];
            if (pos) {
                light.position.set((pos.x+0.5)*TILE_SIZE, -((pos.y+0.5)*TILE_SIZE), 22);
                light.visible = true;
            } else { light.visible = false; }
        });
    }

    // Flicker each sconce independently
    _sconceLights.forEach((light, i) => {
        if (!light.visible) return;
        light.intensity = 1.6 + Math.sin(t*2.9+i*1.7)*0.45 + Math.sin(t*6.1+i*0.9)*0.2;
    });
}

// ── Item rarity lights ────────────────────────────────────────────────────────
function _updateItemLights(t) {
    const s = gameState;
    const visItems = (s?.items||[])
        .filter(item => s.revealed?.[item.y]?.[item.x] && !item.collected)
        .slice(0, _ITEM_LIGHT_COUNT);

    _itemLights.forEach((light, i) => {
        const item = visItems[i];
        if (item) {
            light.position.set((item.x+0.5)*TILE_SIZE, -((item.y+0.5)*TILE_SIZE), 16);
            const rarity = (item.rarity||'common').toLowerCase();
            light.color.setHex(_RARITY_COL[rarity] || _RARITY_COL.common);
            const isLeg = rarity === 'legendary' || rarity === 'mythic';
            light.intensity = (isLeg ? 2.2 : 0.9) + Math.sin(t*3.5+i)*0.3;
            light.distance  = isLeg ? 140 : 80;
            light.visible   = true;
        } else { light.visible = false; }
    });
}

// ── Ambient depth shift + danger pulse ───────────────────────────────────────
function _updateAmbient(t) {
    if (!_ambientLight) return;
    const s = gameState;
    const floor = s?.floor || 0;
    const p = s?.player;
    const hpFrac = p ? p.hp / Math.max(1, p.maxHp) : 1;
    const bossNear = (s?.enemies||[]).some(e => e.hp>0 && (e.type==='boss'||e.bossVariant) && s.revealed?.[e.y]?.[e.x]);

    // Depth-based ambient: warm shallow → cool grey mid → cold purple deep
    let r, g, b, intensity;
    if (floor === 0)      { r=0.12; g=0.09; b=0.06; intensity=0.6; }  // tavern: warm
    else if (floor < 15)  { r=0.10; g=0.07; b=0.04; intensity=0.5; }  // shallow: brown
    else if (floor < 35)  { r=0.06; g=0.07; b=0.09; intensity=0.45; } // mid: blue-grey
    else if (floor < 65)  { r=0.05; g=0.04; b=0.09; intensity=0.4; }  // deep: purple
    else                  { r=0.08; g=0.03; b=0.10; intensity=0.38; } // abyss: violet

    // Boss override: pulse toward deep red
    if (bossNear) {
        const pulse = 0.5 + Math.sin(t * 2.4) * 0.5;
        r = r + (0.20 - r) * pulse * 0.7;
        g = g * (1 - pulse * 0.5);
        b = b * (1 - pulse * 0.4);
        intensity += pulse * 0.3;
    }

    // Low-HP danger: red tint that intensifies as HP drops
    if (hpFrac < 0.30 && floor > 0) {
        const danger = (0.30 - hpFrac) / 0.30; // 0→1 as hp → 0
        const pulse = 0.5 + Math.sin(t * 4.5) * 0.5;
        r = r + (0.25 * danger * pulse);
        g *= 1 - danger * 0.4;
        b *= 1 - danger * 0.4;
    }

    _ambientLight.color.setRGB(r, g, b);
    _ambientLight.intensity = intensity;
}

function threeJsActive() { return _THREE_ACTIVE; }
