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

// Base (unlit) tile colours — PointLights bring these to life at runtime
const PAL = {
    FLOOR:      [0.14, 0.10, 0.06],
    FLOOR_EXIT: [0.06, 0.13, 0.08],
    FLOOR_UP:   [0.09, 0.06, 0.14],
    WALL:       [0.10, 0.07, 0.03],
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
    _ambientLight = new THREE.AmbientLight(0x18100a, 0.55);
    _scene.add(_ambientLight);

    _torchLight = new THREE.PointLight(0xff9820, 5.0, 400, 1.7);
    _torchLight.position.z = 44;
    _scene.add(_torchLight);

    _torchLight2 = new THREE.PointLight(0xffb840, 2.0, 220, 2.2);
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
    const dungeon = s.dungeon, revealed = s.revealed || [];
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
            if (!revealed[ty]?.[tx] && di < _MAX_INST) {
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

function threeJsActive() { return _THREE_ACTIVE; }
