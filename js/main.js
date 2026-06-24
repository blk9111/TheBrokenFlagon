
function initGame(className, subclassId = null, characterName = '', seedOverride = null, ironmanMode = false, gender = 'm') {
    gameState.floor = 0;
    gameState.messages = [];
    gameState.effects = [];
    gameState.items = [];
    gameState.fallenEnemies = [];
    gameState.gameOver = false;
    gameState.awaitingLevelChoice = false;
    gameState.pendingLevelChoices = 0;
    gameState.shopOpen = false;
    gameState.charSheetOpen = false;
    gameState.gamblingOpen = false;
    gameState.brewmasterOpen = false;
    gameState.questBoardOpen = false;
    gameState.bardOpen = false;
    gameState.stashOpen = false;
    gameState.magicDealerOpen = false;
    gameState.cellarFindOpen = false;
    // ── Missing resets (fields added after v1.9) ──────────────────────────
    gameState.spellbookOpen  = false;
    gameState.blacksmithOpen = false;
    gameState.trainerOpen    = false;
    gameState.bankOpen       = false;
    gameState.innOpen        = false;
    gameState.inCourtyard    = false;
    gameState.inTown         = false;
    gameState.inArena        = false;  // still read by resolveArenaBout — remove when arena fields renamed
    gameState.worldPos       = { row: 2, col: 2 }; // kept for old-save compat; remove with data.js cleanup
    // Phase 4: overworld field resets removed (worldGrids, worldZoneFeatures, zoneFeatures,
    // inZoneCombat, roadMerchantOpen, _roadMerchantFeat). Their declarations remain in data.js
    // until that file's cleanup pass removes them from the gameState object.
    gameState.ironmanMode = !!ironmanMode;
    gameState.magicStock = [];
    gameState.activeBrew = null;
    gameState.activeSong = null;
    gameState.activeQuest = null;
    gameState.generatedBounties = [];
    gameState.decorations = [];
    gameState.interactables = [];
    gameState.traps = [];
    gameState.allies = [];
    gameState.decoy = null;
    gameState.runStats = createRunStats();
    gameState.runAchievementsUnlocked = [];
    gameState.floorCache = {};      // clear session floor memory on new run
    gameState.floorCacheOrder = [];
    gameState.dungeonReturnFloor = null; // no portal anchor on a fresh run
    _stopBardLoop();
    // Arm the seeded RNG before anything below rolls a single die — every
    // gameplay random() call from this point on (dungeon layout, loot,
    // enemy AI, shop stock, combat rolls) draws from this seed, so the
    // same seed reliably reproduces the same run.
    seedRun(seedOverride != null ? seedOverride : generateRandomSeed());
    // Cellar Find availability — rolled here (using the seeded rng(),
    // not Math.random()) so the same seed code always produces the
    // same cellar outcome, consistent with every other gameplay roll.
    gameState.cellarHasFind = rng() < CELLAR_FIND_CHANCE;
    gameState.cellarClaimed = false;
    gameState.player = new Player(className, subclassId, characterName, gender);
    gameState.player.equipment = migrateEquipment(gameState.player.equipment);
    recalculateStats();
    // Renown 500 champion perk: the innkeeper's free drink adds +5 max HP.
    if (typeof isRenownUnlocked === 'function' && isRenownUnlocked('champion')) {
        gameState.player.maxHp += 5;
        gameState.player.hp += 5;
        setTimeout(() => addMessage('The innkeeper slides you a drink. "For the champion." (+5 max HP)'), 800);
    }
    loadBestFloor();

    // Pick a dungeon event for this run. Uses the seeded rng() (see
    // pickDungeonEvent) so the same seed reproduces the same event — the event
    // carries real modifiers (enemy HP, loot, spawn bias). Rolled here, before
    // generateDungeon(), so it draws one deterministic value from the seed
    // stream ahead of map generation.
    gameState.dungeonEvent = null;
    const pickedEvent = typeof pickDungeonEvent === 'function' ? pickDungeonEvent() : null;
    if (pickedEvent) {
        gameState.dungeonEvent = pickedEvent.id;
        setTimeout(() => {
            addMessage(`\u26A0 Dungeon Event: ${pickedEvent.name} — ${pickedEvent.desc}`);
        }, 900);
    }

    generateDungeon();

    // Gladiators are born to the Pit — they unlock the Arena from level 1
    // rather than by reaching Floor 20, so surface the arena hint right away
    // (the floor-crossing trigger in saveBestFloor would never fire for them).
    if (subclassId === 'gladiator') {
        setTimeout(() => showFirstTimeHint('arena'), 1200);
    }

    const csEl = document.getElementById('class-select');
    csEl.style.display = 'none';
    document.getElementById('game-ui').style.display = 'grid';
    document.getElementById('game-over').style.display = 'none';
    document.body.classList.add('in-run');

    gameState.trainerBought = { hp: false, atk: false };

    // Welcome — first-session players get a focused "start here" message.
    // Veterans get a shorter version that doesn't repeat obvious context.
    const isFirstRun = (gameMeta.runs || 0) === 0;
    if (isFirstRun) {
        addMessage('Welcome to The Broken Flagon. You stand in the tavern hub.');
        addMessage('\u{1F4A1} Start: Walk to the glowing floor circles. Press [Space] to talk to the Innkeeper or Merchant before you descend.');
        addMessage('When ready, find the Dungeon Entrance (the archway in the lower hall) and descend into the ash.');
        showEventCard('WELCOME', 'Explore the tavern, then enter the Dungeon Entrance', 'milestone');
        // Fire a delayed structured tour hint
        setTimeout(() => {
            if (typeof showFirstTimeHint === 'function') showFirstTimeHint('tavernTour');
        }, 3500);
    } else {
        addMessage('Welcome back to The Broken Flagon.');
        if (gameState.dungeonEvent) {
            // The event message already fires from initGame — no duplicate needed
        }
        showEventCard('TAVERN HUB', 'Prepare, then enter the Dungeon Entrance', 'milestone');
    }
    updateUI();

    if (!gameState.frameStarted) {
        gameState.frameStarted = true;
        requestAnimationFrame(gameLoop);
    }
}


// ── Character Creation Screen (single-screen: sidebar + live preview) ─────────

let ccState = { className: null, subclassId: null, gender: 'm' };


// ── What's New popup ─────────────────────────────────────────────────────
// Shown once per version on first load after an update. Self-contained
// from the title-screen-and-beyond keydown handler at the bottom of this
// file (which only runs once gameState.player exists) since this needs to
// appear before a player has even reached character creation.

function checkForChangelog() {
    if (hasSeenChangelog()) return;
    openWhatsNew();
}


function openWhatsNew() {
    renderWhatsNew();
    const panel = document.getElementById('whats-new-panel');
    if (panel) panel.style.display = 'flex';
}


function closeWhatsNew() {
    markChangelogSeen();
    const panel = document.getElementById('whats-new-panel');
    if (panel) panel.style.display = 'none';
}


function renderWhatsNew() {
    const body = document.getElementById('whats-new-body');
    if (!body) return;
    body.innerHTML = CHANGELOG.map(entry => `
        <div class="whats-new-version">
            <h3 class="whats-new-version-num">v${escHtml(entry.version)}</h3>
            <ul class="whats-new-list">
                ${entry.highlights.map(h => `<li>${escHtml(h)}</li>`).join('')}
            </ul>
        </div>
    `).join('');
}


// Standalone listener (not folded into the main keydown handler below)
// because that handler gates on gameState.player existing, and this
// popup is shown before any player or run exists — right at page load.
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const panel = document.getElementById('whats-new-panel');
        if (panel && panel.style.display !== 'none') closeWhatsNew();
    }
});


// ── Title screen ─────────────────────────────────────────────────────────
// A static welcome/lore screen shown before class-select on every load.
// Kept deliberately separate from renderClassSelect()'s init work below —
// class-select doesn't need to render anything until the player has
// actually clicked through, so there's no wasted work either way.

function toggleTitleLegend() { openStorybook(); } // legacy alias


// ── Storybook modal ──────────────────────────────────────────────────────────

function openStorybook() {
    const overlay = document.getElementById('storybook-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    // Reset scroll position so it always opens at the top
    const scroll = document.getElementById('storybook-scroll');
    if (scroll) scroll.scrollTop = 0;
    // Render chapter illustrations
    _drawStorybookArt();
    // Render The Fallen
    _renderFallenList('sb-fallen-list', 'sb-fallen-section');
    // Parchment unfurl animation
    const parchment = document.getElementById('storybook-parchment');
    if (parchment) {
        parchment.style.animation = 'none';
        parchment.offsetHeight; // force reflow
        parchment.style.animation = 'sb-unfurl 0.45s cubic-bezier(0.34, 1.4, 0.64, 1) forwards';
    }
}

function closeStorybook() {
    const overlay = document.getElementById('storybook-overlay');
    if (overlay) overlay.style.display = 'none';
}

function closeStorybookOnBackdrop(e) {
    if (e.target.id === 'storybook-overlay') closeStorybook();
}

// Draw SVG illustrations for each chapter into their placeholder divs
function _drawStorybookArt() {
    const arts = {
        'sb-art-1': _sbArtAbyss(),
        'sb-art-2': _sbArtBarnaby(),
        'sb-art-3': _sbArtBrawl(),
        'sb-art-4': _sbArtDescent(),
    };
    Object.entries(arts).forEach(([id, svg]) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.drawn) { el.innerHTML = svg; el.dataset.drawn = '1'; }
    });
}

function _svgWrap(content, vw = 320, vh = 100) {
    return `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;max-height:110px">${content}</svg>`;
}

function _sbArtAbyss() {
    return _svgWrap(`
      <defs>
        <radialGradient id="abyssGlow" cx="50%" cy="80%" r="60%">
          <stop offset="0%" stop-color="#c0392b" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#0a0604" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="320" height="100" fill="#0e0a06"/>
      <!-- Mountains -->
      <polygon points="0,100 60,40 120,100" fill="#1a1208"/>
      <polygon points="80,100 150,25 220,100" fill="#231910"/>
      <polygon points="180,100 260,45 320,100" fill="#1a1208"/>
      <!-- Dungeon glow from below -->
      <ellipse cx="160" cy="95" rx="70" ry="20" fill="url(#abyssGlow)"/>
      <!-- Fortress ruins -->
      <rect x="130" y="52" width="8" height="28" fill="#2a1e14"/>
      <rect x="142" y="45" width="10" height="35" fill="#342618"/>
      <rect x="156" y="55" width="7" height="25" fill="#2a1e14"/>
      <rect x="167" y="50" width="9" height="30" fill="#342618"/>
      <!-- Ash particles -->
      <circle cx="80" cy="60" r="1.5" fill="#c0a060" opacity="0.5"/>
      <circle cx="140" cy="35" r="1" fill="#c0a060" opacity="0.4"/>
      <circle cx="220" cy="55" r="1.5" fill="#c0a060" opacity="0.35"/>
      <circle cx="260" cy="40" r="1" fill="#c0a060" opacity="0.5"/>
      <!-- Stars -->
      <circle cx="50" cy="12" r="1" fill="#fff" opacity="0.6"/>
      <circle cx="100" cy="8" r="0.8" fill="#fff" opacity="0.5"/>
      <circle cx="200" cy="15" r="1" fill="#fff" opacity="0.4"/>
      <circle cx="280" cy="10" r="0.8" fill="#fff" opacity="0.6"/>
      <circle cx="310" cy="20" r="1" fill="#fff" opacity="0.3"/>
    `);
}

function _sbArtBarnaby() {
    return _svgWrap(`
      <rect width="320" height="100" fill="#120d08"/>
      <!-- Tavern interior warm glow -->
      <ellipse cx="160" cy="80" rx="120" ry="45" fill="#8B4500" opacity="0.18"/>
      <!-- Bar counter -->
      <rect x="40" y="65" width="240" height="12" fill="#5a3a18" rx="2"/>
      <rect x="40" y="63" width="240" height="4" fill="#7a5230" rx="1"/>
      <!-- Kegs -->
      <ellipse cx="70" cy="62" rx="14" ry="16" fill="#4a3010"/>
      <line x1="57" y1="58" x2="83" y2="58" stroke="#8a6030" stroke-width="2"/>
      <ellipse cx="110" cy="64" rx="11" ry="13" fill="#3e2a0e"/>
      <line x1="100" y1="61" x2="120" y2="61" stroke="#8a6030" stroke-width="2"/>
      <!-- Tankard on bar -->
      <rect x="170" y="55" width="16" height="20" fill="#c8a060" rx="2"/>
      <rect x="185" y="60" width="5" height="10" fill="#a08040" rx="1"/>
      <rect x="168" y="53" width="20" height="3" fill="#e0b870" rx="1"/>
      <!-- Barnaby silhouette -->
      <ellipse cx="215" cy="45" rx="12" ry="13" fill="#2a1e14"/>
      <rect x="203" y="56" width="24" height="24" fill="#231812" rx="3"/>
      <!-- Warm candle light -->
      <circle cx="150" cy="45" r="3" fill="#ffd65a" opacity="0.7"/>
      <ellipse cx="150" cy="50" rx="18" ry="10" fill="#ffa030" opacity="0.12"/>
    `);
}

function _sbArtBrawl() {
    return _svgWrap(`
      <rect width="320" height="100" fill="#0e0904"/>
      <!-- Tavern chaos warm light -->
      <ellipse cx="160" cy="60" rx="130" ry="55" fill="#7a3a00" opacity="0.22"/>
      <!-- Flying chair -->
      <g transform="translate(80,30) rotate(-25)">
        <rect x="0" y="0" width="30" height="4" fill="#8B5E2A" rx="1"/>
        <rect x="2" y="4" width="4" height="20" fill="#6a4818"/>
        <rect x="24" y="4" width="4" height="20" fill="#6a4818"/>
        <rect x="2" y="12" width="26" height="4" fill="#7a5228"/>
      </g>
      <!-- Flying tankard -->
      <g transform="translate(220,20) rotate(35)">
        <rect x="0" y="0" width="18" height="22" fill="#c8a060" rx="2"/>
        <rect x="17" y="5" width="5" height="10" fill="#a08040" rx="1"/>
        <!-- Ale splash -->
        <ellipse cx="9" cy="-3" rx="12" ry="5" fill="#c8a060" opacity="0.5"/>
        <line x1="3" y1="-5" x2="1" y2="-14" stroke="#c8a060" stroke-width="1.5" opacity="0.6"/>
        <line x1="9" y1="-8" x2="10" y2="-16" stroke="#c8a060" stroke-width="1.5" opacity="0.6"/>
        <line x1="15" y1="-5" x2="18" y2="-13" stroke="#c8a060" stroke-width="1.5" opacity="0.6"/>
      </g>
      <!-- Fighter silhouettes -->
      <ellipse cx="110" cy="52" rx="10" ry="11" fill="#1e1410"/>
      <rect x="100" y="62" width="20" height="25" fill="#1e1410" rx="2"/>
      <rect x="118" y="68" width="18" height="3" fill="#1e1410" rx="1" transform="rotate(-30 118 68)"/>
      <ellipse cx="200" cy="54" rx="11" ry="12" fill="#251a14"/>
      <rect x="189" y="64" width="22" height="26" fill="#251a14" rx="2"/>
      <!-- Broken flagon on floor -->
      <polygon points="145,88 155,72 158,88" fill="#8a7060" opacity="0.7"/>
      <polygon points="155,72 165,85 162,88 150,88" fill="#7a6050" opacity="0.7"/>
      <ellipse cx="153" cy="90" rx="12" ry="4" fill="#c8a060" opacity="0.3"/>
    `);
}

function _sbArtDescent() {
    return _svgWrap(`
      <defs>
        <radialGradient id="dungeonHole" cx="50%" cy="100%" r="55%">
          <stop offset="0%" stop-color="#c0392b" stop-opacity="0.6"/>
          <stop offset="60%" stop-color="#7a1a08" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#0a0604" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="320" height="100" fill="#0c0806"/>
      <!-- Stone staircase descending -->
      <rect x="120" y="30" width="80" height="8" fill="#2a2018" rx="1"/>
      <rect x="128" y="38" width="64" height="8" fill="#241c14" rx="1"/>
      <rect x="136" y="46" width="48" height="8" fill="#1e1810" rx="1"/>
      <rect x="144" y="54" width="32" height="8" fill="#18140c" rx="1"/>
      <rect x="152" y="62" width="16" height="8" fill="#12100a" rx="1"/>
      <!-- Dungeon glow at bottom -->
      <ellipse cx="160" cy="95" rx="50" ry="18" fill="url(#dungeonHole)"/>
      <!-- Lone adventurer at top of stairs -->
      <ellipse cx="158" cy="22" rx="7" ry="8" fill="#c8a060"/>
      <rect x="151" y="28" width="14" height="18" fill="#8B4513" rx="2"/>
      <!-- Cape -->
      <path d="M151,28 Q140,40 144,50" stroke="#6B3410" stroke-width="3" fill="none"/>
      <!-- Torch glow -->
      <circle cx="170" cy="24" r="4" fill="#ffd65a" opacity="0.8"/>
      <ellipse cx="170" cy="28" rx="10" ry="6" fill="#ffa030" opacity="0.25"/>
      <!-- Glowing eyes in darkness below -->
      <circle cx="148" cy="85" r="2" fill="#c0392b" opacity="0.7"/>
      <circle cx="154" cy="85" r="2" fill="#c0392b" opacity="0.7"/>
      <!-- Stone arch -->
      <path d="M90,30 Q90,0 160,0 Q230,0 230,30" stroke="#342818" stroke-width="8" fill="none"/>
    `);
}


// Render The Fallen list into a given element id
function _renderFallenList(listId, sectionId) {
    const fallen = gameMeta.fallen || [];
    const section = document.getElementById(sectionId);
    const list = document.getElementById(listId);
    if (!section || !list) return;
    if (!fallen.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    list.innerHTML = fallen.map(f => {
        const classLabel = f.className ? (f.className.charAt(0).toUpperCase() + f.className.slice(1)) : 'Hero';
        return `<div class="sb-fallen-entry">
            <span class="sf-name">${escHtml(f.name)}</span>
            <span class="sf-detail">${classLabel} · Level ${f.level} · Floor ${f.floor}</span>
            <span class="sf-cause">Slain by ${escHtml(f.killedBy)}</span>
        </div>`;
    }).join('');
    // Also update the title-screen fallen widget
    const titleFallen = document.getElementById('title-fallen');
    const titleFallenList = document.getElementById('fallen-list');
    if (titleFallen && titleFallenList && fallen.length) {
        titleFallen.style.display = 'block';
        titleFallenList.innerHTML = fallen.slice(0, 3).map(f => {
            const classLabel = f.className ? (f.className.charAt(0).toUpperCase() + f.className.slice(1)) : 'Hero';
            return `<div class="fallen-entry">
                <span class="fe-name">${escHtml(f.name)}</span>
                <span class="fe-detail">${classLabel} Lv${f.level} · Floor ${f.floor}</span>
            </div>`;
        }).join('');
    }
}


// ── Ash particle animation on the title screen ───────────────────────────────

let _ashAnimFrame = null;
const _ashParticles = [];

function _initAshParticles() {
    const canvas = document.getElementById('title-particles-canvas');
    if (!canvas) return;
    canvas.width = canvas.offsetWidth || 1200;
    canvas.height = canvas.offsetHeight || 600;
    _ashParticles.length = 0;
    const N = 55;
    for (let i = 0; i < N; i++) {
        _ashParticles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: 0.8 + Math.random() * 2.2,
            vy: -0.12 - Math.random() * 0.22,  // float upward slowly
            vx: (Math.random() - 0.5) * 0.15,
            alpha: 0.1 + Math.random() * 0.4,
            phase: Math.random() * Math.PI * 2,
            // Embers are rare — 1 in 6 particles glows orange
            ember: Math.random() < 0.16,
        });
    }
}

function _tickAshParticles() {
    const canvas = document.getElementById('title-particles-canvas');
    if (!canvas) return;
    const ctx2 = canvas.getContext('2d');
    const t = Date.now() / 1000;
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    _ashParticles.forEach(p => {
        // Drift
        p.x += p.vx + Math.sin(t * 0.4 + p.phase) * 0.12;
        p.y += p.vy;
        // Wrap
        if (p.y < -4) p.y = canvas.height + 4;
        if (p.x < -4) p.x = canvas.width + 4;
        if (p.x > canvas.width + 4) p.x = -4;
        // Flicker alpha for embers
        const a = p.ember
            ? p.alpha * (0.7 + 0.3 * Math.sin(t * 3.5 + p.phase))
            : p.alpha * (0.85 + 0.15 * Math.sin(t * 1.2 + p.phase));
        ctx2.globalAlpha = a;
        ctx2.fillStyle = p.ember ? '#ff9030' : '#c8b090';
        if (p.ember) {
            ctx2.shadowColor = '#ff7020';
            ctx2.shadowBlur = 4;
        }
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.shadowBlur = 0;
    });
    ctx2.globalAlpha = 1;
    _ashAnimFrame = requestAnimationFrame(_tickAshParticles);
}

function startAshParticles() {
    if (_ashAnimFrame) cancelAnimationFrame(_ashAnimFrame);
    _initAshParticles();
    _tickAshParticles();
}

function stopAshParticles() {
    if (_ashAnimFrame) { cancelAnimationFrame(_ashAnimFrame); _ashAnimFrame = null; }
}


function beginAdventure() {
    const title = document.getElementById('title-screen');
    const introScreen = document.getElementById('intro-video-screen');
    const video = document.getElementById('intro-video');
    if (title) title.style.display = 'none';
    stopAshParticles();

    // Falls straight through to class-select if the video element itself
    // isn't in the page (e.g. a future build without the markup at all)
    // — the cinematic is a nice-to-have, never a blocker to actually
    // starting the game.
    if (!introScreen || !video) {
        proceedToClassSelect();
        return;
    }

    // Over file:// the browser treats the .mp4 as a separate security origin
    // and throws "Unsafe attempt to load URL" when play() requests it. Skip
    // the cinematic entirely in that case — it's cosmetic, and Electron / a
    // localhost server don't hit this path so the video still plays there.
    if (location.protocol === 'file:') {
        proceedToClassSelect();
        return;
    }

    introScreen.style.display = 'flex';
    introScreen.classList.remove('intro-video-failed');
    video.currentTime = 0;
    video.onended = proceedToClassSelect;
    // If the video fails to load/play (e.g. intro.mp4 isn't present),
    // don't strand the player on a black screen — but don't silently
    // skip the screen either, since that hides the missing-asset state
    // from whoever's debugging it. Show the fallback placeholder instead
    // and let Skip (or a click) move on.
    const showFallback = () => {
        introScreen.classList.add('intro-video-failed');
        // Auto-proceed after 1 s so missing intro.mp4 never blocks testing.
        // The Skip button still works immediately if the user clicks it.
        setTimeout(proceedToClassSelect, 1000);
    };
    video.onerror = showFallback;
    const playPromise = video.play();
    if (playPromise && playPromise.catch) {
        playPromise.catch(showFallback);
    }
}


function skipIntroVideo() {
    const video = document.getElementById('intro-video');
    if (video) video.pause();
    proceedToClassSelect();
}


function proceedToClassSelect() {
    const introScreen = document.getElementById('intro-video-screen');
    const video = document.getElementById('intro-video');
    const cs = document.getElementById('class-select');
    if (video) { video.onended = null; video.onerror = null; }
    if (introScreen) { introScreen.style.display = 'none'; introScreen.classList.remove('intro-video-failed'); }
    // Hide game-ui so the canvas doesn't sit on top of the class-select
    // and intercept all mouse clicks including "Begin Descent".
    // This happens when returning from a run where game-ui was left as display:grid.
    const gameUi = document.getElementById('game-ui');
    if (gameUi) gameUi.style.display = 'none';
    const gameOver = document.getElementById('game-over');
    if (gameOver) gameOver.style.display = 'none';
    if (cs) cs.style.display = 'block';
    renderClassSelect();
}


// ── Arena entrance cutscene ──────────────────────────────────────────────────
// Plays once, the first time the player opens the Pit. Mirrors the intro-video
// pattern exactly: full-screen overlay, Skip button, graceful fallback if the
// file is missing, and a callback that runs whether the video plays, is
// skipped, ends, or fails — so the arena always opens regardless. "Seen once"
// is tracked via gameMeta.hintsSeen (already persisted) so it never replays.
let _arenaVideoDone = null;

function maybePlayArenaIntro(onDone) {
    const seen = gameMeta.hintsSeen && gameMeta.hintsSeen.arenaIntro;
    const screen = document.getElementById('arena-video-screen');
    const video = document.getElementById('arena-video');

    // Already seen, or the markup/elements aren't present → just proceed.
    if (seen || !screen || !video) { onDone(); return; }

    // Over file:// the .mp4 load throws a cross-origin error; skip to the Pit.
    if (location.protocol === 'file:') {
        if (!gameMeta.hintsSeen) gameMeta.hintsSeen = {};
        gameMeta.hintsSeen.arenaIntro = true;
        saveMetaProgress();
        onDone();
        return;
    }

    // Mark seen immediately so a refresh mid-cutscene doesn't replay it.
    if (!gameMeta.hintsSeen) gameMeta.hintsSeen = {};
    gameMeta.hintsSeen.arenaIntro = true;
    saveMetaProgress();

    _arenaVideoDone = onDone;
    screen.style.display = 'flex';
    screen.classList.remove('arena-video-failed');
    video.currentTime = 0;
    video.onended = _finishArenaVideo;
    const showFallback = () => {
        screen.classList.add('arena-video-failed');
        // Auto-dismiss the fallback placeholder after a moment so a missing
        // file doesn't strand the player — they still reach the arena.
        setTimeout(_finishArenaVideo, 800);
    };
    video.onerror = showFallback;
    const playPromise = video.play();
    if (playPromise && playPromise.catch) playPromise.catch(showFallback);
}

function skipArenaVideo() {
    const video = document.getElementById('arena-video');
    if (video) video.pause();
    _finishArenaVideo();
}


// ── The Fallen God — floor 100 boss reveal ───────────────────────────────────
// Shows once per playthrough the first time the player reaches floor 100.
// Tracked via gameMeta.hintsSeen.fallenGodReveal so it never replays.

let _fallenGodRevealDone = null;

function maybeShowFallenGodReveal(onDone) {
    const seen = gameMeta.hintsSeen && gameMeta.hintsSeen.fallenGodReveal;
    const screen = document.getElementById('fallen-god-screen');
    if (seen || !screen) { onDone(); return; }

    // Mark seen immediately so a reload mid-reveal doesn't replay it
    if (!gameMeta.hintsSeen) gameMeta.hintsSeen = {};
    gameMeta.hintsSeen.fallenGodReveal = true;
    saveMetaProgress();

    _fallenGodRevealDone = onDone;
    screen.style.display = 'flex';

    // Keyboard dismiss
    const _keyDismiss = (e) => {
        document.removeEventListener('keydown', _keyDismiss);
        dismissFallenGodReveal();
    };
    document.addEventListener('keydown', _keyDismiss);
}

function dismissFallenGodReveal() {
    const screen = document.getElementById('fallen-god-screen');
    if (screen) {
        screen.style.animation = 'none';
        screen.style.opacity = '0';
        screen.style.transition = 'opacity 0.6s ease';
        setTimeout(() => {
            screen.style.display = 'none';
            screen.style.opacity = '';
            screen.style.transition = '';
        }, 600);
    }
    if (_fallenGodRevealDone) {
        const cb = _fallenGodRevealDone;
        _fallenGodRevealDone = null;
        setTimeout(cb, 650);
    }
}

function _finishArenaVideo() {
    const screen = document.getElementById('arena-video-screen');
    const video = document.getElementById('arena-video');
    if (video) { video.onended = null; video.onerror = null; video.pause(); }
    if (screen) { screen.style.display = 'none'; screen.classList.remove('arena-video-failed'); }
    const cb = _arenaVideoDone;
    _arenaVideoDone = null;
    if (cb) cb();
}


function renderClassSelect() {
    ccState = { className: null, subclassId: null, gender: 'm' };
    const flavorEl = document.getElementById('cs-flavor');
    // Math.random() here is correct, not an oversight: this screen renders
    // before initGame() arms the seeded RNG for the run the player is
    // about to start, so there's no seed yet to draw from — and the line
    // itself is cosmetic flavor text with no gameplay consequence anyway.
    if (flavorEl) flavorEl.textContent = TAVERN_FLAVOR_LINES[Math.floor(Math.random() * TAVERN_FLAVOR_LINES.length)];
    renderClassList();
}


function renderClassList() {
    const list = document.getElementById('cs-class-list');
    if (!list) return;
    list.innerHTML = Object.entries(CLASS_META).map(([id, meta]) => {
        const isActive = ccState.className === id;
        return `
        <div class="cs-class-card${isActive ? ' cs-class-active' : ''}" style="--cc:${CLASS_COLOR[id] || 'var(--gold)'}">
            <span class="cs-class-accent"></span>
            <div class="cs-class-top" onclick="selectClass('${id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')selectClass('${id}')">
                <span class="cs-class-icon" data-letter="${meta.name.slice(0,1)}"><img src="${CLASS_ICON_IMG[id]}?v=${GAME_VERSION}" alt="${meta.name}" class="cs-class-icon-img" onerror="this.closest('.cs-class-icon').classList.add('cs-icon-missing')" /></span>
                <span class="cs-class-info">
                    <span class="cs-class-name">${meta.name}</span>
                    <span class="cs-class-desc">${meta.desc.replace(/\n/g, ' · ')}</span>
                </span>
                <span class="cs-class-expand-caret" aria-hidden="true">${isActive ? '\u25BE' : '\u25B8'}</span>
            </div>
            <div class="cs-class-ability" onclick="selectClass('${id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')selectClass('${id}')">${CLASSES[id]?.ability || 'Special Ability'}</div>
            ${isActive ? `<div class="cs-class-expanded" id="cs-class-expanded-${id}"></div>` : ''}
        </div>
    `;
    }).join('');
    if (ccState.className) renderClassExpanded();
}


function selectClass(className) {
    // Re-clicking the already-open card collapses it instead of re-opening
    // to the same state — a quick way to back out of a choice without
    // hunting for a separate "cancel" control.
    if (ccState.className === className) {
        ccState.className = null;
        ccState.subclassId = null;
    } else {
        ccState.className = className;
        ccState.subclassId = null;
    }
    renderClassList();
}


function selectSubclass(className, subclassId) {
    ccState.className = className;
    ccState.subclassId = subclassId;
    renderClassExpanded();
}


function selectGender(gender) {
    ccState.gender = gender;
    renderClassExpanded();
}


// Renders the inline-expanded content for whichever class card is
// currently selected — subclass chips, then (once a subclass is also
// picked) stats/traits/gear/name/seed/Begin Descent. This used to be a
// separate "Character Dossier" panel that sat empty and visually
// competed with the actual class-pick decision; folding it into the
// selected card itself means there's never an empty box on screen, and
// the 4 class cards stay the dominant visual element regardless of
// selection state.
function renderClassExpanded() {
    const el = document.getElementById(`cs-class-expanded-${ccState.className}`);
    if (!el) return;
    console.log('[CharSelect] renderClassExpanded build=market-split-v2 gender=' + ccState.gender);

    const subclasses = SUBCLASSES[ccState.className];
    const sc = ccState.subclassId ? subclasses.find(s => s.id === ccState.subclassId) : null;

    const chipsHtml = `
        <div class="cs-subclass-chips">
            ${subclasses.map(s => `
                <button class="cs-chip${ccState.subclassId === s.id ? ' cs-chip-active' : ''}" onclick="selectSubclass('${ccState.className}', '${s.id}')">${s.name}</button>
            `).join('')}
        </div>
    `;

    if (!sc) {
        el.innerHTML = `
            ${chipsHtml}
            <p class="cs-preview-hint">Select a path for your ${capitalize(ccState.className)} to review their traits.</p>
        `;
        return;
    }

    const gear = STARTING_GEAR[ccState.className] || [];
    const statCount = 3 + (sc.stats.maxMana > 0 ? 1 : 0);
    const statsGridStyle = statCount < 4 ? ` style="grid-template-columns: repeat(${statCount}, 1fr)"` : '';

    el.innerHTML = `
        ${chipsHtml}
        <div class="cs-preview-card">
            <div class="cs-preview-hero">
                <span class="cs-preview-glyph"><img src="${CLASS_ICON_IMG[ccState.className]}" alt="${capitalize(ccState.className)}" class="cs-preview-glyph-img" /></span>
                <div class="cs-preview-heading">
                    <h3 class="cs-preview-name">${sc.name}</h3>
                    <p class="cs-preview-tagline">${sc.tagline}</p>
                    ${sc.special ? `<span class="cs-preview-special">${sc.special}</span>` : ''}
                </div>
            </div>
            <div class="cs-preview-stats"${statsGridStyle}>
                <div class="cs-pstat"><small>HP</small><span>${sc.stats.hp}</span></div>
                <div class="cs-pstat"><small>ATK</small><span>${sc.stats.atk}</span></div>
                <div class="cs-pstat"><small>DEF</small><span>${sc.stats.def}</span></div>
                ${sc.stats.maxMana > 0 ? `<div class="cs-pstat"><small>Mana</small><span>${sc.stats.maxMana}</span></div>` : ''}
            </div>
            <div class="cs-preview-cols">
                <div class="cs-preview-col">
                    <div class="cs-heading-label">Traits</div>
                    ${sc.traits.map(t => `<div class="cs-trait">${t}</div>`).join('')}
                </div>
                <div class="cs-preview-col">
                    <div class="cs-heading-label">Starting Gear</div>
                    ${gear.map(g => `<div class="cs-gear-item">&#10003; ${g}</div>`).join('')}
                </div>
            </div>
            <div class="cs-preview-footer">
                <div class="cs-gender-row">
                    <span class="cs-name-label">Appearance</span>
                    <div class="cs-gender-btns">
                        <button class="cs-gender-btn${ccState.gender === 'm' ? ' cs-gender-active' : ''}" data-select-gender="m" aria-pressed="${ccState.gender === 'm'}" type="button">&#9794; Male</button>
                        <button class="cs-gender-btn${ccState.gender === 'f' ? ' cs-gender-active' : ''}" data-select-gender="f" aria-pressed="${ccState.gender === 'f'}" type="button">&#9792; Female</button>
                    </div>
                </div>
                <div class="cs-preview-name-row">
                    <label class="cs-name-label" for="char-name-input">Name <span>(optional — defaults to ${sc.name})</span></label>
                    <input class="cc-name-input" id="char-name-input" type="text" maxlength="16" placeholder="${sc.name}" autocomplete="off" />
                </div>
                <div class="cs-preview-seed-row">
                    <label class="cs-seed-label" for="seed-code-input">Seed Code <span>(optional — leave blank for a random dungeon)</span></label>
                    <input class="cc-seed-input" id="seed-code-input" type="text" maxlength="7" placeholder="e.g. 3P7Y2CZ" autocomplete="off" />
                    <span class="cs-seed-hint" id="seed-code-hint"></span>
                </div>
                <label class="cc-ironman-row" for="ironman-toggle">
                    <input type="checkbox" id="ironman-toggle" class="cc-ironman-checkbox" />
                    <span class="cc-ironman-label">Ironman Oath</span>
                    <span class="cc-ironman-desc">No Bank, no Shared Stash this run — but +8% gold find and +5% rarity odds for the whole descent.</span>
                </label>
                <div class="cc-button-row">
                    <button class="cc-confirm-btn" onclick="confirmCharacter()">Begin Descent</button>
                    <button class="cc-daily-btn" onclick="startDailyChallenge()" title="Everyone plays the same dungeon today. Same seed worldwide — see how deep you get.">
                        \u2600 Daily Challenge
                    </button>
                </div>
                <p class="cc-daily-status" id="cc-daily-status"></p>
            </div>
        </div>
    `;

    // Wire gender buttons: update ccState + toggle classes IN-PLACE.
    // Deliberately avoids calling selectGender() (which re-renders the whole
    // expanded section) because Chrome freezes the event-dispatch path at
    // fire-time — DOM changes during bubbling can let stale parent handlers
    // run and reset state. Toggling classes directly sidesteps all of that.
    el.querySelectorAll('[data-select-gender]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            ccState.gender = btn.dataset.selectGender;
            el.querySelectorAll('[data-select-gender]').forEach(b => {
                const active = b.dataset.selectGender === ccState.gender;
                b.classList.toggle('cs-gender-active', active);
                b.setAttribute('aria-pressed', String(active));
            });
        });
    });

    const input = document.getElementById('char-name-input');
    if (input) {
        input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmCharacter(); });
    }

    // Ensure Begin Descent is visible — the expanded card can be taller than
    // the viewport, so scroll it into view each time a subclass is picked.
    const confirmBtn = el.querySelector('.cc-confirm-btn');
    if (confirmBtn) {
        confirmBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Daily Challenge status — tells the player whether they've already played
    // today's daily and how they did, turning the button into a "come back
    // tomorrow" loop.
    const dailyStatus = document.getElementById('cc-daily-status');
    if (dailyStatus) {
        const rec = getDailyRecord();
        if (rec) {
            const result = rec.won ? 'conquered it!' : `reached Floor ${rec.floor}`;
            dailyStatus.textContent = `Today's Daily: you ${result} Play again to beat it — your best for the day is kept.`;
        } else {
            const streak = getDailyPlayCount();
            dailyStatus.textContent = streak > 0
                ? `${streak} daily challenge${streak === 1 ? '' : 's'} played. Today's dungeon awaits.`
                : `New every day at midnight UTC — the same dungeon for everyone.`;
        }
    }
    const seedInput = document.getElementById('seed-code-input');
    const seedHint = document.getElementById('seed-code-hint');
    if (seedInput) {
        seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmCharacter(); });
        // Live-validate as the player types — codeToSeed returns null for
        // any character outside the seed alphabet, which lets us flag a
        // typo (e.g. an accidental 0/O or 1/I/L, deliberately excluded
        // from the alphabet) before they hit Begin Descent rather than
        // after, when they'd be staring at a dungeon wondering if the
        // code "took."
        seedInput.addEventListener('input', () => {
            const raw = seedInput.value.trim();
            if (!raw) { seedHint.textContent = ''; seedHint.className = 'cs-seed-hint'; return; }
            const decoded = codeToSeed(raw);
            if (decoded === null) {
                seedHint.textContent = 'Invalid character — codes only use 2-9 and A-Z (no 0, 1, I, L, O).';
                seedHint.className = 'cs-seed-hint cs-seed-hint-bad';
            } else {
                seedHint.textContent = '';
                seedHint.className = 'cs-seed-hint';
            }
        });
    }
}


function confirmCharacter() {
    if (!ccState.className || !ccState.subclassId) return;
    const input = document.getElementById('char-name-input');
    const sc = SUBCLASSES[ccState.className].find(s => s.id === ccState.subclassId);
    const name = (input ? input.value.trim() : '') || sc.name;
    const seedInput = document.getElementById('seed-code-input');
    const seedRaw = seedInput ? seedInput.value.trim() : '';
    let seedOverride = null;
    if (seedRaw) {
        const decoded = codeToSeed(seedRaw);
        if (decoded === null) {
            // Don't silently fall back to a random seed on a bad code —
            // that would quietly give the player a different dungeon
            // than the one they meant to share/compare, with no
            // indication anything went wrong.
            addMessageAndUpdate('That seed code has an invalid character — check it and try again.');
            return;
        }
        seedOverride = decoded;
    }
    const ironmanToggle = document.getElementById('ironman-toggle');
    const ironman = !!(ironmanToggle && ironmanToggle.checked);
    gameState.isDailyRun = false;
    gameState.dailyKey = null;
    initGame(ccState.className, ccState.subclassId, name, seedOverride, ironman, ccState.gender);
}


// Launches today's Daily Challenge — the same dungeon for every player on this
// UTC date. Class/subclass come from the current character-creation selection
// (the player still picks who they take in), but the seed is fixed to today's
// daily seed and the run is flagged so the death screen records and frames it
// as a daily result.
function startDailyChallenge() {
    if (!ccState.className || !ccState.subclassId) {
        addMessageAndUpdate('Pick a class and path first, then take on the Daily Challenge.');
        return;
    }
    const sc = SUBCLASSES[ccState.className].find(s => s.id === ccState.subclassId);
    const input = document.getElementById('char-name-input');
    const name = (input ? input.value.trim() : '') || sc.name;
    const dateKey = getDailyKey();
    const seed = getDailySeed(dateKey);
    gameState.isDailyRun = true;
    gameState.dailyKey = dateKey;
    // Daily runs are never Ironman by default — keep the challenge purely about
    // the shared seed, not an extra difficulty modifier the player didn't pick.
    initGame(ccState.className, ccState.subclassId, name, seed, false, ccState.gender);
}


// ── Map Legend ─────────────────────────────────────────────────────────────

let legendOpen = false;


function toggleLegend() {
    legendOpen = !legendOpen;
    const list = document.getElementById('legend-list');
    const caret = document.getElementById('legend-caret');
    if (list) list.style.display = legendOpen ? 'grid' : 'none';
    if (caret) caret.innerHTML = legendOpen ? '&#9662;' : '&#9656;';
}

// ── World Map Panel ───────────────────────────────────────────────────────
// Phase 4: overworld removed. ZONE_ICONS, ZONE_SHORT, and the world-map grid
// renderer are no longer active. renderWorldMapPanel() is kept as a stub so
// any updateUI() call that reaches it is a silent no-op rather than an error.
// Remove the stub and its HTML element (#world-map-panel) in the UI cleanup pass.
function renderWorldMapPanel() {
    // Always hide the world-map panel; the dungeon minimap handles floor > 0.
    const wmPanel = document.getElementById('world-map-panel');
    if (wmPanel) wmPanel.style.display = 'none';
}

// Phase 4: overworld fast-travel removed. Stub kept so HTML onclick attrs
// that reference it do not throw. Remove when HTML is cleaned up.
function worldMapFastTravel() { /* overworld removed — no-op */ }




function renderLegend() {
    const el = document.getElementById('legend-list');
    if (!el) return;

    // SVG icon helper — 16×16 viewBox, no xmlns needed inside innerHTML
    const svg = (content, color = 'currentColor') =>
        `<svg viewBox="0 0 16 16" width="16" height="16" fill="${color}" style="display:block;overflow:visible">${content}</svg>`;

    // ── Item icons ──────────────────────────────────────────────────────────
    const iconPotion  = svg(`<rect x="5" y="3" width="6" height="10" rx="2" fill="#e14b4b"/>
        <rect x="6" y="1" width="4" height="3" rx="1" fill="#c03030"/>
        <rect x="6" y="6" width="2" height="4" rx="1" fill="rgba(255,255,255,0.35)"/>`);
    const iconAntidote = svg(`<rect x="5" y="3" width="6" height="10" rx="2" fill="#58c26d"/>
        <rect x="6" y="1" width="4" height="3" rx="1" fill="#3a9a50"/>
        <rect x="6" y="6" width="2" height="4" rx="1" fill="rgba(255,255,255,0.35)"/>`);
    const iconRage    = svg(`<rect x="5" y="3" width="6" height="10" rx="2" fill="#ff4500"/>
        <rect x="6" y="1" width="4" height="3" rx="1" fill="#cc2200"/>
        <text x="8" y="12" font-size="7" text-anchor="middle" fill="rgba(255,200,80,0.9)" font-weight="bold">!</text>`);
    const iconSmoke   = svg(`<ellipse cx="8" cy="11" rx="5" ry="3" fill="#aaa397"/>
        <path d="M6,8 Q7,4 8,6 Q9,2 10,5 Q11,3 11,7" stroke="#d0cec8" stroke-width="1.5" fill="none"/>`, '#aaa397');
    const iconScroll  = svg(`<rect x="4" y="4" width="8" height="9" rx="1" fill="#ffd65a"/>
        <rect x="3" y="4" width="2" height="9" rx="1" fill="#c8a030"/>
        <rect x="11" y="4" width="2" height="9" rx="1" fill="#c8a030"/>
        <line x1="6" y1="7" x2="10" y2="7" stroke="#8a6000" stroke-width="1"/>
        <line x1="6" y1="9" x2="10" y2="9" stroke="#8a6000" stroke-width="1"/>`, '#ffd65a');
    const iconGold    = svg(`<circle cx="8" cy="8" r="5.5" fill="#ffd65a"/>
        <circle cx="8" cy="8" r="3.5" fill="#f0c030"/>
        <text x="8" y="11" font-size="7" text-anchor="middle" fill="#8a6000" font-weight="bold">g</text>`);
    const iconWeapon  = svg(`<line x1="4" y1="12" x2="12" y2="4" stroke="#78bfff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="6" y1="10" x2="8" y2="12" stroke="#78bfff" stroke-width="1.5" stroke-linecap="round"/>
        <rect x="10" y="3" width="3" height="2" rx="0.5" fill="#a0d8ff"/>`);
    const iconChest   = svg(`<rect x="3" y="7" width="10" height="7" rx="1" fill="#d08aff"/>
        <rect x="3" y="5" width="10" height="4" rx="1" fill="#b060e0"/>
        <rect x="6" y="8" width="4" height="3" rx="1" fill="#e8b0ff"/>
        <circle cx="8" cy="9" r="1" fill="#8040b0"/>`);
    const iconHelmet  = svg(`<path d="M3,10 Q3,4 8,4 Q13,4 13,10 Z" fill="#aaa397"/>
        <rect x="3" y="9" width="10" height="2" rx="1" fill="#888070"/>
        <rect x="5" y="11" width="6" height="2" rx="1" fill="#888070"/>`);
    const iconShield  = svg(`<path d="M8,2 L13,5 L13,10 Q13,14 8,15 Q3,14 3,10 L3,5 Z" fill="#78bfff"/>
        <path d="M8,4 L11,6 L11,10 Q11,13 8,14 Q5,13 5,10 L5,6 Z" fill="#5090d0"/>
        <line x1="8" y1="4" x2="8" y2="14" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
        <line x1="5" y1="9" x2="11" y2="9" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>`);
    const iconRing    = svg(`<circle cx="8" cy="9" r="4.5" stroke="#5ad1c2" stroke-width="2" fill="none"/>
        <circle cx="8" cy="4.5" r="2" fill="#5ad1c2"/>
        <circle cx="8" cy="4.5" r="1" fill="#a0ffe0"/>`);
    const iconBoots   = svg(`<path d="M5,14 L5,6 Q5,4 7,4 L9,4 L9,9 L12,9 L12,14 Z" fill="#8b7355"/>
        <rect x="4" y="13" width="9" height="2" rx="1" fill="#6a5535"/>
        <rect x="7" y="4" width="3" height="2" rx="1" fill="#a08855"/>`);
    const iconAscend  = svg(`<polygon points="8,3 13,11 3,11" fill="${TILE_COLORS.ascend}"/>
        <rect x="6" y="11" width="4" height="2" fill="${TILE_COLORS.ascend}"/>`);
    const iconDescend = svg(`<rect x="6" y="3" width="4" height="2" fill="${TILE_COLORS.exit}"/>
        <polygon points="8,13 13,5 3,5" fill="${TILE_COLORS.exit}"/>`);
    const iconTavern  = svg(`<rect x="2" y="8" width="12" height="6" rx="1" fill="${TILE_COLORS.ascend}"/>
        <polygon points="8,2 14,8 2,8" fill="${TILE_COLORS.ascend}"/>
        <rect x="6" y="10" width="4" height="4" fill="${TILE_COLORS.exit}"/>`);
    const iconChestCommon  = svg(`<rect x="3" y="7" width="10" height="7" rx="1" fill="#c8a060"/>
        <rect x="3" y="5" width="10" height="4" rx="1" fill="#a07840"/>
        <circle cx="8" cy="9" r="1.5" fill="#ffd65a"/>`);
    const iconChestRare    = svg(`<rect x="3" y="7" width="10" height="7" rx="1" fill="#62b9ff"/>
        <rect x="3" y="5" width="10" height="4" rx="1" fill="#3090d0"/>
        <circle cx="8" cy="9" r="1.5" fill="#a0dfff"/>`);
    const iconChestCursed  = svg(`<rect x="3" y="7" width="10" height="7" rx="1" fill="#9966cc"/>
        <rect x="3" y="5" width="10" height="4" rx="1" fill="#6633aa"/>
        <text x="8" y="12" font-size="9" text-anchor="middle" fill="#ffaaff">☠</text>`);
    const iconCamp    = svg(`<polygon points="8,3 12,12 4,12" fill="#d4b97a"/>
        <rect x="7" y="10" width="2" height="5" fill="#a08040"/>
        <circle cx="8" cy="10" r="1.5" fill="#ff9030" opacity="0.8"/>`);
    const iconShrine  = svg(`<rect x="6" y="2" width="4" height="10" rx="1" fill="#ffd65a"/>
        <rect x="3" y="7" width="10" height="2" rx="1" fill="#ffd65a"/>
        <circle cx="8" cy="6" r="2.5" fill="#fff0a0"/>
        <circle cx="8" cy="14" r="1.5" fill="#c8a030"/>`);
    const iconLibrary = svg(`<rect x="3" y="4" width="10" height="9" rx="1" fill="#55c7ff"/>
        <rect x="5" y="6" width="2" height="5" fill="#004488"/>
        <rect x="8" y="6" width="2" height="5" fill="#002266"/>
        <rect x="3" y="4" width="10" height="2" rx="1" fill="#80dfff"/>`);
    const iconMerchantWander = svg(`<text x="8" y="12" font-size="10" text-anchor="middle" fill="#ffd65a" font-weight="bold">$</text>
        <circle cx="8" cy="8" r="6" stroke="#ffd65a" stroke-width="1" fill="none"/>`);
    const iconCursedAlt = svg(`<polygon points="8,2 10,6 14,6 11,9 12,13 8,11 4,13 5,9 2,6 6,6" fill="#9966cc"/>
        <circle cx="8" cy="7" r="2" fill="#cc44cc"/>`);
    const iconLostAdv = svg(`<circle cx="8" cy="6" r="3" fill="#78bfff"/>
        <path d="M5,9 Q5,14 8,14 Q11,14 11,9" fill="#78bfff"/>
        <text x="8" y="12" font-size="7" text-anchor="middle" fill="#003366" font-weight="bold">?</text>`);
    const iconVault   = svg(`<rect x="2" y="4" width="12" height="10" rx="2" fill="#62b9ff" stroke="#3090d0" stroke-width="1"/>
        <circle cx="8" cy="9" r="3" fill="#3090d0"/>
        <circle cx="8" cy="9" r="1.5" fill="#80d0ff"/>
        <line x1="8" y1="6" x2="8" y2="4" stroke="#3090d0" stroke-width="1.5"/>`);

    // ── Tavern Hub icons ────────────────────────────────────────────────────
    const hubIcon = (spriteKey, fallbackColor) => {
        const sprite = typeof getNpcSprite === 'function' ? getNpcSprite(spriteKey) : null;
        if (sprite) return `<img src="${sprite.src}" width="16" height="16" style="object-fit:contain;vertical-align:middle">`;
        return `<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${fallbackColor}"/></svg>`;
    };
    const iconInnkeeper    = hubIcon('innkeeper',  '#ffd65a');
    const iconMerchantHub  = hubIcon('merchant',   '#5ad1c2');
    const iconBlacksmith   = hubIcon('blacksmith', '#c45c00');
    const iconTrainer      = hubIcon('trainer',    '#58c26d');
    const iconBank         = hubIcon('bank',       '#ffd65a');
    const iconQuestBoard   = svg(`<rect x="3" y="2" width="10" height="13" rx="1" fill="#d4b97a"/>
        <line x1="5" y1="5" x2="11" y2="5" stroke="#8a6030" stroke-width="1"/>
        <line x1="5" y1="7" x2="11" y2="7" stroke="#8a6030" stroke-width="1"/>
        <line x1="5" y1="9" x2="9" y2="9" stroke="#8a6030" stroke-width="1"/>
        <rect x="2" y="2" width="2" height="13" rx="1" fill="#a07840"/>`);
    const iconDungeonEnt   = svg(`<rect x="4" y="4" width="8" height="10" rx="1" fill="#2a2018"/>
        <rect x="5" y="5" width="6" height="8" rx="0" fill="#0a0604"/>
        <ellipse cx="8" cy="13" rx="4" ry="1.5" fill="#c0392b" opacity="0.5"/>
        <path d="M4,4 Q4,0 8,0 Q12,0 12,4" stroke="#5a4a30" stroke-width="1.5" fill="none"/>`);

    // ── Rarity icons ────────────────────────────────────────────────────────
    const rarityIcon = (color) => svg(`
        <polygon points="8,1 10,6 15,6 11,9.5 12.5,14.5 8,11.5 3.5,14.5 5,9.5 1,6 6,6" fill="${color}"/>`, color);

    // ── Minimap icons ───────────────────────────────────────────────────────
    const mmIcon = (color, shape = 'square') => {
        if (shape === 'diamond') return svg(`<polygon points="8,1 15,8 8,15 1,8" fill="${color}"/>`, color);
        return svg(`<rect x="2" y="2" width="12" height="12" rx="2" fill="${color}"/>`, color);
    };

    // ── Build row HTML ───────────────────────────────────────────────────────
    const iconRow = (iconHtml, label) =>
        `<div class="legend-row"><span class="legend-glyph legend-icon-cell">${iconHtml}</span><span class="legend-label">${escHtml(label)}</span></div>`;
    const glyphRow = (glyph, color, label) =>
        `<div class="legend-row"><span class="legend-glyph" style="color:${color}">${glyph}</span><span class="legend-label">${escHtml(label)}</span></div>`;

    const itemRows = [
        iconRow(iconPotion,  'Health Potion'),
        iconRow(iconAntidote,'Antidote'),
        iconRow(iconRage,    'Rage Draught'),
        iconRow(iconSmoke,   'Smoke Bomb'),
        iconRow(iconScroll,  'Identify Scroll'),
        iconRow(iconGold,    'Gold'),
        iconRow(iconWeapon,  'Weapon drop'),
        iconRow(iconChest,   'Chest armor'),
        iconRow(iconHelmet,  'Helmet drop'),
        iconRow(iconShield,  'Shield drop'),
        iconRow(iconRing,    'Ring / Amulet'),
        iconRow(iconBoots,   'Boots drop'),
        iconRow(iconAscend,  'Ascend'),
        iconRow(iconDescend, 'Descend'),
        iconRow(iconTavern,  'Return to Tavern'),
        iconRow(iconChestCommon,  'Common Chest (Space)'),
        iconRow(iconChestRare,    'Rare Chest (Space)'),
        iconRow(iconChestCursed,  'Cursed Chest (Space)'),
        iconRow(iconCamp,         'Abandoned Camp (+XP)'),
        iconRow(iconShrine,       'Forgotten Shrine (+XP)'),
        iconRow(iconLibrary,      'Ancient Library (+XP)'),
        iconRow(iconMerchantWander,'Wandering Merchant'),
        iconRow(iconShrine,       'Ancient Shrine'),
        iconRow(iconCursedAlt,    'Cursed Altar'),
        iconRow(iconLostAdv,      'Lost Adventurer'),
        iconRow(iconVault,        'Treasure Vault'),
    ].join('');

    const hubRows = [
        iconRow(iconInnkeeper,   'Innkeeper — Rest'),
        iconRow(iconMerchantHub, 'Merchant — Buy/Sell'),
        iconRow(iconBlacksmith,  'Blacksmith — Upgrade'),
        iconRow(iconTrainer,     'Trainer — Stats'),
        iconRow(iconBank,        'Bank — Safe gold'),
        iconRow(iconQuestBoard,  'Quest Board'),
        iconRow(iconDungeonEnt,  'Dungeon Entrance'),
    ].join('');

    const rarityRows = Object.entries(RARITY_COLORS).map(([tier, color]) =>
        iconRow(rarityIcon(color), capitalize(tier))
    ).join('');

    const bossRows = Object.entries(MILESTONE_BOSSES).map(([floor, b]) =>
        glyphRow(b.glyph, b.color, `Floor ${floor}: ${b.name}`)
    ).join('');

    const enemyEntries = Object.values(ENEMY_TYPES)
        .filter(e => e.name !== 'spawn')
        .map(e => ({ glyph: e.glyph, color: e.color, label: capitalize(e.name) }));
    enemyEntries.push({ glyph: ENEMY_TYPES.spawn.glyph, color: ENEMY_TYPES.spawn.color, label: 'Splitter spawn' });
    const enemyRows = enemyEntries.map(en => glyphRow(en.glyph, en.color, en.label)).join('');

    const mmRows = [
        iconRow(mmIcon('#4fc3f7'),           'Minimap — You'),
        iconRow(mmIcon('#c62828'),           'Minimap — Enemy'),
        iconRow(mmIcon('#ff6b35'),           'Minimap — Boss'),
        iconRow(mmIcon('#62b9ff', 'diamond'),'Minimap — Rare Event'),
        iconRow(mmIcon('#ffd65a', 'diamond'),'Minimap — Loot / Stairs'),
    ].join('');

    el.innerHTML = `
        <div class="legend-group-title">${DUNGEON_NAME} (${MAX_DUNGEON_FLOOR} Floors)</div>
        ${bossRows}
        <div class="legend-group-title">Tavern Hub</div>
        ${hubRows}
        <div class="legend-group-title">Loot Rarity</div>
        ${rarityRows}
        <div class="legend-group-title">Items &amp; Interactables</div>
        ${itemRows}
        <div class="legend-group-title">Enemies</div>
        ${enemyRows}
        <div class="legend-group-title">Minimap</div>
        ${mmRows}
    `;
}


// ── Map hover tooltips ────────────────────────────────────────────────────

const mapTooltip = document.getElementById('map-tooltip');


function _tileFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    // Map the click from CSS pixels into the game's LOGICAL coordinate space
    // (MAP_WIDTH*TILE_SIZE × MAP_HEIGHT*TILE_SIZE), independent of the canvas's
    // device-pixel backing store. The backing store may be 2× on HiDPI displays
    // (see resizeCanvasForDPI), but tile math always works in logical units, so
    // we scale by logical-size / displayed-CSS-size, NOT canvas.width/height.
    const logicalW = (typeof MAP_WIDTH !== 'undefined' ? MAP_WIDTH : 25) * TILE_SIZE;
    const logicalH = (typeof MAP_HEIGHT !== 'undefined' ? MAP_HEIGHT : 18) * TILE_SIZE;
    const scaleX = logicalW / rect.width;
    const scaleY = logicalH / rect.height;
    return {
        x: Math.floor(((e.clientX - rect.left) * scaleX) / TILE_SIZE),
        y: Math.floor(((e.clientY - rect.top) * scaleY) / TILE_SIZE),
        rect
    };
}


function _describeTile(tx, ty) {
    if (!gameState.player || !gameState.revealed[ty] || !gameState.revealed[ty][tx]) return null;

    const item = gameState.items.find(i => i.x === tx && i.y === ty);
    if (item) {
        if (item.type === 'gold') return `<strong>${item.amount}g</strong> — Gold`;
        if (item.type === 'equipment') {
            const hidden = item.cursed && !item.identified;
            const name = hidden ? '?? Item' : item.name;
            const stat = hidden ? '+??' : `+${item.bonus}${item.unit || ''}`;
            const rc = getRarityColor(item.rarity || 'common');
            return `<strong style="color:${rc}">${escHtml(name)}</strong> ${stat}${item.desc ? ` — ${escHtml(item.desc)}` : ''}`;
        }
        return `<strong>${escHtml(item.name)}</strong>${item.qty > 1 ? ` x${item.qty}` : ''}`;
    }

    const enemy = gameState.enemies.find(en => en.x === tx && en.y === ty);
    if (enemy) {
        const intent = enemy.nextIntent || predictEnemyIntent(enemy);
        return formatIntentHtml(enemy, intent);
    }

    const interactable = findInteractableAt(tx, ty);
    if (interactable) {
        const meta = WORLD_OBJECTS[interactable.kind];
        if (meta) return `<strong>${escHtml(meta.label)}</strong>${meta.xp ? ` — +${meta.xp} XP` : ' — Press Space to open'}`;
    }

    if (gameState.floor === 0 && gameState.inCourtyard) {
        const gate = gameState.arenaGate;
        if (gate && gate.x === tx && gate.y === ty) return '<strong>The Pit</strong> — Enter the Arena';
        const marketNpcs = [
            { npc: gameState.merchant,    label: 'Merchant',     hint: 'Browse wares' },
            { npc: gameState.blacksmith,  label: 'Blacksmith',   hint: 'Upgrade gear' },
            { npc: gameState.trainer,     label: 'Trainer',      hint: 'Train stats' },
            { npc: gameState.bank,        label: 'Bank',         hint: 'Deposit gold' },
            { npc: gameState.questBoard,  label: 'Quest Board',  hint: 'Take a bounty' },
            { npc: gameState.magicDealer, label: 'Magic Dealer', hint: 'Buy arcane items' },
        ];
        for (const { npc, label, hint } of marketNpcs) {
            if (npc && npc.x === tx && npc.y === ty) return `<strong>${label}</strong> — ${hint}`;
        }
    }
    if (gameState.floor === 0 && !gameState.inCourtyard) {
        const npcs = [gameState.innkeeper, gameState.merchant, gameState.blacksmith,
            gameState.trainer, gameState.bank, gameState.questBoard,
            gameState.gambler, gameState.brewmaster, gameState.bard, gameState.magicDealer,
            gameState.stashChest, gameState.cellar];
        const npc = npcs.find(n => n.x === tx && n.y === ty);
        if (npc) return `<strong>${escHtml(npc.name)}</strong>`;
        // Legendary guests
        const milestones = gameState.tavernUpgrades?.defeatedMilestones || [];
        const guest = MILESTONE_GUESTS.find(g => milestones.includes(g.floor) && g.x === tx && g.y === ty);
        if (guest) {
            const visited = gameState.tavernUpgrades?.[guest.visitedKey];
            return `<strong style="color:${safeColor(guest.color)}">${escHtml(guest.name)}</strong>${visited ? '' : ' — Press Space to interact'}`;
        }
    } else if (gameState.floor === 0 && gameState.inCourtyard) {
        const g = gameState.arenaGate;
        if (g.x === tx && g.y === ty) return `<strong>${escHtml(g.name)}</strong>${isArenaUnlocked() ? '' : ' (locked)'}`;
    }

    return null;
}


if (canvas) {
    canvas.addEventListener('mousemove', e => {
        if (!gameState.player) return;
        const { x, y, rect } = _tileFromEvent(e);
        const inBounds = x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
        const enemy = inBounds ? gameState.enemies.find(en => en.x === x && en.y === y) : null;
        const prevHover = gameState.hoverEnemy;
        gameState.hoverEnemy = enemy;
        gameState.hoverTile = inBounds ? { x, y } : null;
        if (prevHover !== enemy) renderEnemyIntents();

        if (!mapTooltip) return;
        const desc = inBounds ? _describeTile(x, y) : null;
        if (!desc) {
            mapTooltip.style.display = 'none';
            mapTooltip.classList.remove('intent-tooltip-active');
            return;
        }
        mapTooltip.innerHTML = desc;
        mapTooltip.style.display = 'block';
        mapTooltip.classList.toggle('intent-tooltip-active', !!enemy);
        mapTooltip.style.left = `${e.clientX - rect.left}px`;
        mapTooltip.style.top = `${e.clientY - rect.top}px`;
    });

    canvas.addEventListener('mouseleave', () => {
        gameState.hoverEnemy = null;
        gameState.hoverTile = null;
        renderEnemyIntents();
        if (mapTooltip) {
            mapTooltip.style.display = 'none';
            mapTooltip.classList.remove('intent-tooltip-active');
        }
    });

    // Click-to-interact for tavern NPCs. The tavern was already a
    // walkable space where you approach an NPC and press Space — this
    // adds clicking the NPC directly as an alternative: if you're
    // already adjacent it opens their panel immediately (same mapping
    // interactInTavern() uses), and if you're not, it just highlights
    // them with a burst in their own established color rather than
    // silently doing nothing OR auto-walking the player there.
    canvas.addEventListener('click', e => {
        if (!gameState.player || gameState.floor !== 0) return;
        const { x, y } = _tileFromEvent(e);
        // In the courtyard, only the arena gate is real — the interior NPCs'
        // coordinates are stale tavern positions that must not be clickable
        // (mirrors the same guard in interactInTavern()).
        if (gameState.inCourtyard) {
            // Pit gate
            const gate = gameState.arenaGate;
            if (gate && gate.x === x && gate.y === y) {
                const adj = getDistance(gameState.player.x, gameState.player.y, gate.x, gate.y) <= 1;
                if (adj) openArena(); else addBurst(gate.x, gate.y, '#ff9f58');
                return;
            }
            // Market vendor NPCs
            const marketEntries = [
                { npc: gameState.merchant,    open: openShop,        color: '#5ad1c2' },
                { npc: gameState.blacksmith,  open: openBlacksmith,  color: '#c45c00' },
                { npc: gameState.trainer,     open: openTrainer,     color: '#58c26d' },
                { npc: gameState.bank,        open: openBank,        color: '#ffd65a' },
                { npc: gameState.questBoard,  open: openNoticeBoard, color: '#d4b97a' },
                { npc: gameState.magicDealer, open: openMagicDealer, color: '#9c6dff' },
            ];
            for (const { npc, open, color } of marketEntries) {
                if (npc && npc.x === x && npc.y === y) {
                    const adj = getDistance(gameState.player.x, gameState.player.y, npc.x, npc.y) <= 1;
                    if (adj) open(); else addBurst(npc.x, npc.y, color);
                    return;
                }
            }
            return;
        }
        const npcEntries = [
            { npc: gameState.innkeeper, open: openInnkeeper, color: '#ffd65a' },
            { npc: gameState.merchant, open: openShop, color: '#5ad1c2' },
            { npc: gameState.blacksmith, open: openBlacksmith, color: '#c45c00' },
            { npc: gameState.trainer, open: openTrainer, color: '#58c26d' },
            { npc: gameState.bank, open: openBank, color: '#ffd65a' },
            { npc: gameState.questBoard, open: openNoticeBoard, color: '#d4b97a' },
            { npc: gameState.gambler, open: openGambling, color: '#ff9f58' },
            { npc: gameState.brewmaster, open: openBrewmaster, color: '#c98bff' },
            { npc: gameState.bard, open: openBard, color: '#62b9ff' },
            { npc: gameState.stashChest, open: openStash, color: '#d4b97a' },
            { npc: gameState.magicDealer, open: openMagicDealer, color: '#9c6dff' },
            { npc: gameState.cellar, open: openCellar, color: '#8a6f4e' },
            { npc: gameState.arenaGate, open: openArena, color: '#6b6b6b' },
        ];
        const entry = npcEntries.find(({ npc }) => npc && npc.x === x && npc.y === y);
        if (!entry) return;
        const adjacent = getDistance(gameState.player.x, gameState.player.y, entry.npc.x, entry.npc.y) <= 1;
        if (adjacent) {
            entry.open();
        } else {
            addBurst(entry.npc.x, entry.npc.y, entry.color);
        }
    });
}


// Last-resort safety net for anything not already covered by the gameLoop
// and keydown boundaries above (e.g. an onclick handler in a vendor panel,
// or an async callback). This never tries to recover game state on its
// own — it only guarantees the failure is actually visible in the console
// instead of vanishing, which matters once this ships outside a dev
// environment where DevTools might not be open to catch it otherwise.
window.addEventListener('error', e => {
    console.error('Uncaught error:', e.error || e.message);
});

window.addEventListener('unhandledrejection', e => {
    console.error('Unhandled promise rejection:', e.reason);
});


loadMetaProgress();

loadSettings();
applyAudioSettings();
if (typeof setAmbientEnabled === 'function') setAmbientEnabled(gameSettings.ambientEnabled !== false);

_updateTitleResumeBanner();

renderLegend();

// Show the version number on the title screen
const _titleVersionEl = document.getElementById('title-version');
if (_titleVersionEl) _titleVersionEl.textContent = `v${GAME_VERSION}`;

checkForChangelog();
// Update title stats now (meta just loaded) — will also run after the 100ms
// delay below to catch the canvas layout, but we want instant population too.
setTimeout(_updateTitleStats, 0);

// Start title screen ambient effects
setTimeout(() => {
    startAshParticles();
    _renderFallenList('sb-fallen-list', 'sb-fallen-section');
    _updateTitleStats();
}, 100); // slight delay so the canvas has its layout dimensions

// ── Class portrait silhouettes ─────────────────────────────────────────────
// Hand-drawn SVG silhouettes for each class, shown on the Character Sheet.
// Pure SVG — no image assets. Keyed by className so the sheet shows the
// player's actual class. Exposed on window so ui.js (renderCharSheet) can use it.
const CLASS_PORTRAITS = {
    warrior: { name: 'Warrior', tag: 'High HP & Defense', accent: '#d98a3a',
      svg: `<g fill="#1a1108" stroke="#d98a3a" stroke-width="1.5" stroke-linejoin="round">
        <path d="M100 40 a20 20 0 1 1 -0.1 0 Z" fill="#241608"/>
        <path d="M70 88 q30 -16 60 0 l8 70 q-38 14 -76 0 Z" fill="#1a1108"/>
        <path d="M70 90 l-16 12 -4 56 14 4 12 -50 Z" fill="#241608"/>
        <path d="M130 90 l16 12 4 56 -14 4 -12 -50 Z" fill="#241608"/>
        <rect x="150" y="60" width="6" height="100" rx="2" fill="#3a2a14"/>
        <path d="M147 60 l12 0 -6 -22 Z" fill="#d98a3a"/>
        <rect x="38" y="96" width="30" height="44" rx="4" fill="#2a1c0c" stroke="#d98a3a" stroke-width="2"/>
        <path d="M53 100 v36 M44 118 h18" stroke="#d98a3a" stroke-width="1.5"/>
        <path d="M84 156 l8 50 -20 0 4 -50 Z M116 156 l-8 50 20 0 -4 -50 Z" fill="#1a1108"/>
      </g>` },
    rogue: { name: 'Rogue', tag: 'High Crit & Speed', accent: '#5fc26d',
      svg: `<g fill="#0e1a10" stroke="#5fc26d" stroke-width="1.5" stroke-linejoin="round">
        <path d="M100 36 q-22 4 -22 30 q0 14 22 18 q22 -4 22 -18 q0 -26 -22 -30 Z" fill="#13241a"/>
        <path d="M88 70 q12 6 24 0 l0 8 q-12 6 -24 0 Z" fill="#0a140d"/>
        <ellipse cx="92" cy="62" rx="3" ry="4" fill="#5fc26d"/>
        <ellipse cx="108" cy="62" rx="3" ry="4" fill="#5fc26d"/>
        <path d="M74 84 q26 -12 52 0 l6 72 q-32 12 -64 0 Z" fill="#0e1a10"/>
        <path d="M74 86 l-18 50 8 4 22 -42 Z" fill="#13241a"/>
        <path d="M126 86 l18 50 -8 4 -22 -42 Z" fill="#13241a"/>
        <path d="M52 132 l-4 -28 6 -2 6 26 Z" fill="#5fc26d"/>
        <path d="M148 132 l4 -28 -6 -2 -6 26 Z" fill="#5fc26d"/>
        <path d="M86 156 l6 50 -18 0 4 -50 Z M114 156 l-6 50 18 0 -4 -50 Z" fill="#0e1a10"/>
      </g>` },
    mage: { name: 'Mage', tag: 'Ranged Arcane Magic', accent: '#6fa8ff',
      svg: `<g fill="#0e1426" stroke="#6fa8ff" stroke-width="1.5" stroke-linejoin="round">
        <path d="M100 38 a18 18 0 1 1 -0.1 0 Z" fill="#16203a"/>
        <path d="M82 56 l36 0 -10 -22 -16 0 Z" fill="#0e1426"/>
        <path d="M68 88 q32 -14 64 0 l10 72 q-42 16 -84 0 Z" fill="#0e1426"/>
        <path d="M100 88 l0 72" stroke="#16203a" stroke-width="3"/>
        <rect x="150" y="44" width="5" height="120" rx="2" fill="#2a2440"/>
        <circle cx="152.5" cy="40" r="11" fill="#6fa8ff" opacity="0.85"/>
        <circle cx="152.5" cy="40" r="5" fill="#cfe4ff"/>
        <path d="M70 92 l-12 64 8 4 16 -56 Z" fill="#16203a"/>
        <path d="M130 92 l12 64 -8 4 -16 -56 Z" fill="#16203a"/>
      </g>` },
    cleric: { name: 'Cleric', tag: 'Balanced & Holy', accent: '#e0c068',
      svg: `<g fill="#1c180a" stroke="#e0c068" stroke-width="1.5" stroke-linejoin="round">
        <path d="M100 38 a18 18 0 1 1 -0.1 0 Z" fill="#28220e"/>
        <path d="M72 86 q28 -14 56 0 l9 72 q-37 14 -74 0 Z" fill="#1c180a"/>
        <path d="M100 96 v40 M86 110 h28" stroke="#e0c068" stroke-width="3" stroke-linecap="round"/>
        <path d="M72 90 l-16 56 8 4 18 -48 Z" fill="#28220e"/>
        <path d="M128 90 l16 56 -8 4 -18 -48 Z" fill="#28220e"/>
        <rect x="146" y="70" width="5" height="90" rx="2" fill="#3a3014"/>
        <circle cx="148.5" cy="64" r="10" fill="#28220e" stroke="#e0c068" stroke-width="2"/>
        <path d="M148.5 58 v12 M143 64 h11" stroke="#e0c068" stroke-width="2" stroke-linecap="round"/>
        <path d="M86 156 l6 50 -18 0 4 -50 Z M114 156 l-6 50 18 0 -4 -50 Z" fill="#1c180a"/>
      </g>` },
};
window.CLASS_PORTRAITS = CLASS_PORTRAITS;

// Returns the inner SVG markup + accent for a class portrait, used by
// renderCharSheet to embed the player's silhouette.
window.getClassPortrait = function(className) {
    return CLASS_PORTRAITS[className] || CLASS_PORTRAITS.warrior;
};


// Populate the Legend Progress panel with real lifetime stats.
// Kills come from the bestiary (always populated for every run) rather than
// gameMeta.stats.totalKills which is zeroed on old saves.
// Gold reads gameMeta.totalGold which now accumulates via trackGoldPickup.
function _updateTitleStats() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('ts-depth', (gameState.bestFloor || 0).toLocaleString());

    // Total kills: sum across all bestiary entries (works on any save age)
    let totalKills = 0;
    if (typeof getBestiaryTypes === 'function') {
        getBestiaryTypes().forEach(type => {
            const entry = getBestiaryEntry(type);
            totalKills += (entry && entry.kills) || 0;
        });
    } else {
        totalKills = (gameMeta.stats && gameMeta.stats.totalKills) || 0;
    }
    set('ts-kills', totalKills.toLocaleString());
    set('ts-gold',  (gameMeta.totalGold   || 0).toLocaleString());
    set('ts-arena', (gameMeta.pitWins      || 0).toLocaleString());
    set('ts-coins', (gameMeta.flagonCoins  || 0).toLocaleString());
}


// ── Title screen icon-row button handlers ─────────────────────────────────

function titleGoArena() {
    // If a run is in progress, resume it — the arena is in the tavern courtyard.
    // If not, character select is the first step.
    if (typeof hasSavedRun === 'function' && hasSavedRun()) {
        resumeRun();
    } else {
        beginAdventure();
    }
}

function titleGoTavern() {
    // Resume drops the player back in the tavern if the run is at floor 0,
    // or back in the dungeon if mid-run — either way it's the right place.
    if (typeof hasSavedRun === 'function' && hasSavedRun()) {
        resumeRun();
    } else {
        beginAdventure();
    }
}

function titleOpenBestiary() {
    // The bestiary works without an active player — it reads gameMeta.bestiary.
    // Hide the title screen, show the bestiary panel directly.
    const titleScreen = document.getElementById('title-screen');
    if (titleScreen) titleScreen.style.display = 'none';
    stopAshParticles();
    // Put the UI in a state where the bestiary can show without a full run
    if (typeof openBestiary === 'function') {
        openBestiary();
        // Patch the close button to return to title screen instead of game
        const orig = window._bestiaryTitleReturn;
        if (!orig) {
            window._bestiaryTitleReturn = true;
            const origClose = window.closeBestiary;
            window.closeBestiary = function() {
                origClose && origClose();
                titleScreen.style.display = '';
                startAshParticles();
                window._bestiaryTitleReturn = false;
                window.closeBestiary = origClose;
            };
        }
    }
}

// ── Quit / Exit ───────────────────────────────────────────────────────────────

// Universal quit — works both in Electron (via IPC to the main process) and
// in a plain browser (window.close). Call this from any button; the title
// screen and settings panel both point here.
function quitGame() {
    // Electron with contextBridge preload (the correct modern path)
    if (window.electronAPI?.quit) {
        window.electronAPI.quit();
        return;
    }
    // Fallback for browser or old Electron without preload
    if (typeof window !== 'undefined') {
        window.close();
    }
}

// Legacy name kept so the existing title-screen onclick="titleQuit()" still works.
function titleQuit() { quitGame(); }


document.addEventListener('keydown', event => {
    ensureAudio();
    // Arena cutscene is a modal overlay — ESC or Space skips it, and it
    // swallows all other input while playing so nothing leaks to the game.
    const arenaVid = document.getElementById('arena-video-screen');
    if (arenaVid && arenaVid.style.display !== 'none' && arenaVid.style.display !== '') {
        if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            skipArenaVideo();
        }
        return;
    }
    // Storybook modal — ESC closes it
    const sbOverlay = document.getElementById('storybook-overlay');
    if (sbOverlay && sbOverlay.style.display !== 'none') {
        if (event.key === 'Escape') { closeStorybook(); return; }
    }
    // Settings is reachable anywhere, including the title screen, so handle
    // its open/close before the "no player yet" guard below.
    if (event.key.toLowerCase() === 'o' && !gameState.settingsOpen
        && !gameState.shopOpen && !gameState.charSheetOpen && !gameState.helpOpen) {
        // Don't hijack 'o' while typing in a text field (name/seed entry).
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') { openSettings(); return; }
    }
    if (gameState.settingsOpen) {
        if (event.key === 'Escape' || event.key.toLowerCase() === 'o') closeSettings();
        return;
    }
    if (!gameState.player) return;

    try {
        if (event.key === 'Escape') {
            if (gameState.spellbookOpen) { closeSpellbook(); return; }
            if (gameState.settingsOpen) { closeSettings(); return; }
            if (gameState.bestiaryOpen) { closeBestiary(); return; }
            if (gameState.ringChoiceOpen) { closeRingChoicePrompt(); return; }
            if (gameState.tavernConfirmOpen) { closeTavernConfirm(); return; }
            if (gameState.arenaOpen) { closeArena(); return; }
            if (gameState.inArenaBout) { forfeitArenaBout(); return; }
            if (gameState.shopOpen) { closeShop(); return; }
            if (gameState.charSheetOpen) { closeCharSheet(); return; }
            if (gameState.helpOpen) { closeHelp(); return; }
            if (gameState.gamblingOpen) { closeGambling(); return; }
            if (gameState.brewmasterOpen) { closeBrewmaster(); return; }
            if (gameState.questBoardOpen) { closeNoticeBoard(); return; }
            if (gameState.bardOpen) { closeBard(); return; }
            if (gameState.stashOpen) { closeStash(); return; }
            if (gameState.magicDealerOpen) { closeMagicDealer(); return; }
            if (gameState.cellarFindOpen) { closeCellar(); return; }
            if (gameState.blacksmithOpen) { closeBlacksmith(); return; }
            if (gameState.trainerOpen) { closeTrainer(); return; }
            if (gameState.bankOpen) { closeBank(); return; }
            if (gameState.innOpen) { closeInnkeeper(); return; }
            if (gameState.inTown && (gameState.townStoreOpen || gameState.townTempleOpen || gameState.townAlchemistOpen || gameState.townHallOpen)) { closeAllTownPanels(); return; }
            // Phase 4: roadMerchantOpen can never be true with the overworld removed.
            // Guard kept until data.js removes the field from gameState.
            if (gameState.roadMerchantOpen) { closeTownPanel?.('road-merchant'); gameState.roadMerchantOpen = false; gameState._roadMerchantFeat = null; return; }
        }

        if (gameState.tavernConfirmOpen) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                confirmReturnToTavern();
            }
            return;
        }
        if (gameState.charSheetOpen) {
            if (event.key.toLowerCase() === 'c') closeCharSheet();
            if (event.key.toLowerCase() === 'h') { closeCharSheet(); openHelp(); }
            return;
        }
        if (gameState.helpOpen) {
            if (event.key.toLowerCase() === 'h') closeHelp();
            if (event.key.toLowerCase() === 'c') { closeHelp(); openCharSheet(); }
            return;
        }
        if (gameState.arenaOpen) return;
        if (gameState.gamblingOpen) return;
        if (gameState.brewmasterOpen) return;
        if (gameState.questBoardOpen) return;
        if (gameState.bardOpen) return;
        if (gameState.stashOpen) return;
        if (gameState.magicDealerOpen) return;
        if (gameState.cellarFindOpen) return;
        if (gameState.blacksmithOpen) return;
        if (gameState.trainerOpen) return;
        if (gameState.bankOpen) return;
        if (gameState.innOpen) return;
        if (gameState.settingsOpen) return;
        if (gameState.bestiaryOpen) return;

        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

        // When the spellbook is open, number keys 1-6 quick-cast the spell in
        // that slot (matching the on-screen order), and any movement/action key
        // is swallowed so the player doesn't accidentally move mid-selection.
        if (gameState.spellbookOpen) {
            if (key === 'Escape') { closeSpellbook(); return; }
            const slot = parseInt(key, 10);
            if (!Number.isNaN(slot) && slot >= 1 && slot <= 9) {
                event.preventDefault();
                const spells = (typeof getAvailableSpells === 'function') ? getAvailableSpells() : [];
                const spell = spells[slot - 1];
                if (spell) castSpell(spell.id);
                return;
            }
            // Block other gameplay keys while the menu is up
            return;
        }

        // ── Keybinding-aware dispatch ────────────────────────────────────────
        // All gameplay keys are routed through the user's active key bindings
        // so remapped keys work identically to their defaults.
        const kb = (typeof getKeyBindings === 'function') ? getKeyBindings() : {};

        // Resolve which logical action this keypress maps to (if any).
        // Arrow keys always work as movement regardless of bindings (fallback).
        let action = null;
        if (key === 'ArrowUp')    action = 'moveUp';
        else if (key === 'ArrowDown')  action = 'moveDown';
        else if (key === 'ArrowLeft')  action = 'moveLeft';
        else if (key === 'ArrowRight') action = 'moveRight';
        else {
            // Scan bindings for a match
            for (const [act, bound] of Object.entries(kb)) {
                if (bound === key) { action = act; break; }
            }
        }

        // Build the set of currently-active gameplay keys for preventDefault
        const activeKeys = new Set([
            'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
            ...Object.values(kb)
        ]);
        if (activeKeys.has(key)) event.preventDefault();

        switch (action) {
            case 'moveUp':    gameState.player.move(0, -1);  break;
            case 'moveDown':  gameState.player.move(0, 1);   break;
            case 'moveLeft':  gameState.player.move(-1, 0);  break;
            case 'moveRight': gameState.player.move(1, 0);   break;
            case 'action':    handleAction();                 break;
            case 'descend':   tryStairsInteraction();         break;
            case 'ability':
                if (!tryStairsInteraction()) gameState.player.useAbility();
                break;
            case 'potion':    usePotion();         break;
            case 'antidote':  useAntidote();       break;
            case 'smokebomb': useSmokeBomb();      break;
            case 'rage':      useRageDraught();    break;
            case 'identify':  useIdentifyScroll(); break;
            case 'capture':   useCaptureCage();    break;
            case 'charsheet': openCharSheet();     break;
            case 'help':      openHelp();           break;
            case 'settings':  openSettings();       break;
            case 'bestiary':  openBestiary();       break;
            case 'map':
                showRightTab('map');
                renderWorldMapPanel();
                break;
            case 'donate':
                if (gameState.floor === 0) donateToBarkeep();
                break;
            case 'tavern':    requestReturnToTavern(); break;
            default:
                // 'r' is hardcoded (reload) and not remappable
                if (key === 'r') {
                    if (confirm('Reload the page? Your current run is auto-saved.')) {
                        window.location.reload();
                    }
                }
                break;
        }
    } catch (err) {
        // A bug in a single action (move, ability, menu toggle) should drop
        // just that keypress, not anything worse — but it's still worth
        // knowing about, so it's logged rather than silently eaten by the
        // browser's default unhandled-listener-error behavior.
        console.error('Error handling keydown action:', err);
    }
});


// ── Mobile Touch Controls ──────────────────────────────────────────────────
// Touch buttons dispatch synthetic KeyboardEvent objects so the existing
// handleKeyDown() switch picks them up identically to real keypresses.
// Repeat-fire: holding a D-pad button fires a move every 150 ms so the
// player can walk continuously without spamming taps.

const _tcHeldKeys = new Map(); // key → intervalId

function tcPress(defaultKey) {
    // Resolve the actual key through the user's active bindings.
    // The buttons were generated with default keys; if the user has rebound
    // (e.g. WASD → IJKL) we translate here so the right action fires.
    const key = _tcResolveKey(defaultKey);
    if (_tcHeldKeys.has(key)) return; // already held

    // Fire immediately on press
    _tcDispatch(key, 'keydown');
    _tcDispatch(key, 'keyup');

    // For movement keys, repeat every 150 ms while held
    const moveDefaults = ['w','a','s','d',' '];
    if (moveDefaults.includes(defaultKey)) {
        const id = setInterval(() => {
            _tcDispatch(key, 'keydown');
            _tcDispatch(key, 'keyup');
        }, 150);
        _tcHeldKeys.set(key, id);
    }
}

function tcRelease(defaultKey) {
    const key = _tcResolveKey(defaultKey);
    const id = _tcHeldKeys.get(key);
    if (id !== undefined) {
        clearInterval(id);
        _tcHeldKeys.delete(key);
    }
}

// Map default key → currently bound key (in case the player remapped controls)
function _tcResolveKey(defaultKey) {
    if (typeof getKeyBindings !== 'function') return defaultKey;
    const kb = getKeyBindings();
    // Reverse-lookup: find which action uses defaultKey, then return the bound key
    const def = (typeof DEFAULT_KEY_BINDINGS !== 'undefined') ? DEFAULT_KEY_BINDINGS : {};
    for (const [action, dk] of Object.entries(def)) {
        if (dk === defaultKey && kb[action]) return kb[action];
    }
    return defaultKey;
}

function _tcDispatch(key, type) {
    const target = document.activeElement || document.body;
    const ev = new KeyboardEvent(type, {
        key,
        bubbles: true,
        cancelable: true,
    });
    target.dispatchEvent(ev);
}

// Show/hide touch controls based on screen width or touch capability.
// We do this on load and on resize so the layout adapts correctly when
// e.g. a tablet is rotated or the browser window is resized narrow.
function updateTouchControlsVisibility() {
    const el = document.getElementById('touch-controls');
    if (!el) return;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isNarrow = window.innerWidth <= 900;
    el.style.display = (isTouchDevice || isNarrow) ? 'grid' : 'none';
}

window.addEventListener('resize', updateTouchControlsVisibility);
document.addEventListener('DOMContentLoaded', updateTouchControlsVisibility);
// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') updateTouchControlsVisibility();
