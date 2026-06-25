
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
    gameState.loteriaOpen = false;
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
        if (typeof playTavernAtmosphere === 'function') playTavernAtmosphere();
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

    // Scroll-reveal: each chapter rises into view as you scroll, so the legend
    // unfolds rather than landing all at once. We re-arm it every open by
    // clearing the revealed state first, then observing.
    _armStorybookReveal();
}

// Sets up the per-chapter scroll reveal. Idempotent — disconnects any prior
// observer and resets reveal state so reopening the book replays the unfold.
let _sbRevealObserver = null;
function _armStorybookReveal() {
    const scroll = document.getElementById('storybook-scroll');
    if (!scroll) return;
    const blocks = scroll.querySelectorAll('.sb-chapter, .sb-ending');

    // Safety: if anything below throws, reveal everything so the legend can
    // never be left invisible (the chapters start at opacity:0 by design).
    try {
        // Reduced-motion or no IntersectionObserver: just show everything.
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || typeof IntersectionObserver === 'undefined') {
            blocks.forEach(b => b.classList.add('sb-revealed'));
            return;
        }

        if (_sbRevealObserver) _sbRevealObserver.disconnect();
        blocks.forEach(b => b.classList.remove('sb-revealed'));

        _sbRevealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('sb-revealed');
                    _sbRevealObserver.unobserve(entry.target); // reveal once, then stop watching
                }
            });
        }, { root: scroll, threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

        blocks.forEach(b => _sbRevealObserver.observe(b));

        // The first chapter is already in view on open — reveal it immediately
        // so there's no awkward blank beat before the reader scrolls.
        requestAnimationFrame(() => {
            if (blocks[0]) {
                blocks[0].classList.add('sb-revealed');
                _sbRevealObserver.unobserve(blocks[0]);
            }
        });
    } catch (e) {
        blocks.forEach(b => b.classList.add('sb-revealed'));
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
let _arenaCanvasRaf  = null;
let _arenaCanvasStopped = false;

// ── Arena Canvas Cinematic ────────────────────────────────────────────────────
// Runs entirely on a <canvas> element — no video file needed, works over
// file:// protocol.  Sequence:
//   0-1.5s  : Fade in from black, stone floor materialises
//   1.5-3s  : Torch flames ignite on the side walls
//   3-5s    : Crowd silhouettes rise from the bleachers
//   5-6.5s  : "⚔ ENTER THE ARENA ⚔" title glows in
//   6.5-8s  : Subtitle fades in
//   8-9.5s  : Hold with living animations (embers, crowd sway)
//   9.5-10s : Fade to black → auto-proceed (or Skip any time)
function _runArenaCanvas(onDone) {
    const cv = document.getElementById('arena-canvas');
    if (!cv) { onDone(); return; }
    const ctx = cv.getContext('2d');
    cv.width  = window.innerWidth;
    cv.height = window.innerHeight;
    const W = cv.width, H = cv.height;

    // ── Pre-generate crowd ────────────────────────────────────────────────────
    const crowd = [];
    for (let row = 0; row < 12; row++) {
        const baseY = H * 0.66 + row * 22;
        const density = Math.ceil(W / 16) + 4;
        const alpha = 0.28 + (12 - row) * 0.038;
        for (let i = 0; i < density; i++) {
            crowd.push({
                x: (i - 2) * 16 + (Math.random() * 10 - 5),
                y: baseY + (Math.random() * 8 - 4),
                r: 4.5 + Math.random() * 4,
                sway: Math.random() * Math.PI * 2,
                speed: 0.4 + Math.random() * 1.4,
                row,
                alpha: Math.min(alpha, 0.7),
            });
        }
    }

    // ── Torch positions ───────────────────────────────────────────────────────
    const torches = [
        { x: W * 0.055, y: H * 0.40 },
        { x: W * 0.055, y: H * 0.60 },
        { x: W * 0.945, y: H * 0.40 },
        { x: W * 0.945, y: H * 0.60 },
    ];

    // ── Embers (pre-seeded so they appear immediately when torches light) ─────
    const embers = Array.from({ length: 100 }, () => {
        const t = torches[Math.floor(Math.random() * torches.length)];
        return {
            x: t.x, y: t.y, tx: t,
            vx: (Math.random() - 0.5) * 1.4,
            vy: -(0.6 + Math.random() * 3.0),
            life: Math.random(),
            ml: 0.5 + Math.random() * 1.8,
            r: 0.8 + Math.random() * 2.0,
        };
    });

    const TOTAL = 10.0;
    const ease  = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const fi    = (t, s, e) => clamp((t - s) / (e - s), 0, 1); // fade-in helper

    _arenaCanvasStopped = false;
    let startTime = null;

    function frame(ts) {
        if (_arenaCanvasStopped) return;
        if (!startTime) startTime = ts;
        const t = (ts - startTime) / 1000;

        // Auto-proceed after TOTAL seconds
        if (t >= TOTAL) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            _finishArenaVideo();
            return;
        }

        _arenaCanvasRaf = requestAnimationFrame(frame);

        ctx.clearRect(0, 0, W, H);

        // ── Background ────────────────────────────────────────────────────────
        const bgA = fi(t, 0, 1.2);
        const bg = ctx.createRadialGradient(W * 0.5, H * 0.55, 0, W * 0.5, H * 0.55, Math.max(W, H) * 0.75);
        bg.addColorStop(0,   `rgba(55,18,6,${bgA})`);
        bg.addColorStop(0.5, `rgba(18,7,3,${bgA})`);
        bg.addColorStop(1,   `rgba(0,0,0,${bgA})`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // ── Arena floor (stone tiles) ─────────────────────────────────────────
        const floorA = fi(t, 0.4, 2.0);
        if (floorA > 0) {
            ctx.save();
            ctx.globalAlpha = floorA;

            // Base floor colour
            ctx.fillStyle = '#140d06';
            ctx.fillRect(0, H * 0.54, W, H * 0.46);

            // Tile grid
            ctx.strokeStyle = 'rgba(90,55,18,0.22)';
            ctx.lineWidth = 1;
            const tW = 60, tH = 24;
            for (let r = 0; r < 16; r++) {
                const yy = H * 0.54 + r * tH;
                for (let c = -1; c <= Math.ceil(W / tW) + 1; c++) {
                    const xx = c * tW + (r % 2 === 0 ? 0 : tW * 0.5);
                    ctx.strokeRect(xx, yy, tW, tH);
                }
            }

            // Centre spotlight
            const spot = ctx.createRadialGradient(W * 0.5, H * 0.70, 0, W * 0.5, H * 0.70, W * 0.24);
            spot.addColorStop(0, 'rgba(255,195,90,0.14)');
            spot.addColorStop(1, 'rgba(255,195,90,0)');
            ctx.fillStyle = spot;
            ctx.fillRect(0, H * 0.54, W, H * 0.46);

            ctx.restore();
        }

        // ── Bleacher stands (dark arcs above crowd) ───────────────────────────
        const standA = fi(t, 2.5, 4.0);
        if (standA > 0) {
            ctx.save();
            ctx.globalAlpha = standA * 0.55;
            ctx.fillStyle = '#0a0602';
            ctx.beginPath();
            ctx.moveTo(0, H * 0.66);
            ctx.lineTo(0, H);
            ctx.lineTo(W, H);
            ctx.lineTo(W, H * 0.66);
            ctx.bezierCurveTo(W * 0.75, H * 0.58, W * 0.25, H * 0.58, 0, H * 0.66);
            ctx.fill();
            ctx.restore();
        }

        // ── Torches ───────────────────────────────────────────────────────────
        const torchA = fi(t, 1.2, 2.8);
        if (torchA > 0) {
            torches.forEach(tor => {
                const flicker = 0.82 + 0.18 * Math.sin(ts * 0.0091 + tor.x * 0.01);

                // Wide ambient glow
                const gR = 130 * flicker;
                const glow = ctx.createRadialGradient(tor.x, tor.y, 0, tor.x, tor.y, gR);
                glow.addColorStop(0,   `rgba(255,155,35,${torchA * 0.50 * flicker})`);
                glow.addColorStop(0.45,`rgba(200,70,8,${torchA  * 0.18 * flicker})`);
                glow.addColorStop(1,   `rgba(160,30,0,0)`);
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(tor.x, tor.y, gR, 0, Math.PI * 2);
                ctx.fill();

                // Torch body
                ctx.save();
                ctx.globalAlpha = torchA;
                ctx.fillStyle = '#4a2e14';
                ctx.fillRect(tor.x - 3, tor.y, 6, 28);

                // Flame layers
                [[0.9,'rgba(255,220,80,0.9)'],[0.65,'rgba(255,140,20,0.75)'],[0.4,'rgba(200,60,10,0.55)']].forEach(([sc,col]) => {
                    ctx.fillStyle = col;
                    const fH = 28 * sc * flicker;
                    ctx.beginPath();
                    ctx.moveTo(tor.x - 5 * sc, tor.y);
                    ctx.bezierCurveTo(tor.x - 9 * sc, tor.y - fH * 0.4, tor.x + 5 * sc, tor.y - fH * 0.7, tor.x, tor.y - fH);
                    ctx.bezierCurveTo(tor.x - 5 * sc, tor.y - fH * 0.7, tor.x + 9 * sc, tor.y - fH * 0.4, tor.x + 5 * sc, tor.y);
                    ctx.fill();
                });

                ctx.restore();
            });

            // ── Embers ────────────────────────────────────────────────────────
            const dt = 0.016;
            embers.forEach(e => {
                e.life += dt;
                if (e.life > e.ml) {
                    const tor = torches[Math.floor(Math.random() * torches.length)];
                    e.x = tor.x + (Math.random() - 0.5) * 8;
                    e.y = tor.y;
                    e.vx = (Math.random() - 0.5) * 1.4;
                    e.vy = -(0.6 + Math.random() * 3.0);
                    e.life = 0;
                    e.ml   = 0.5 + Math.random() * 1.8;
                    e.r    = 0.8 + Math.random() * 2.0;
                }
                e.x += e.vx * 0.28;
                e.y += e.vy * 0.28;
                const ea = (1 - e.life / e.ml) * 0.85 * torchA;
                if (ea > 0) {
                    ctx.beginPath();
                    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(255,210,80,${ea})`;
                    ctx.fill();
                }
            });
        }

        // ── Crowd silhouettes ─────────────────────────────────────────────────
        const crowdA = fi(t, 2.8, 4.5);
        if (crowdA > 0) {
            crowd.forEach(h => {
                const bob = Math.sin(ts * 0.001 * h.speed + h.sway) * 2.8;
                ctx.save();
                ctx.globalAlpha = h.alpha * crowdA;
                ctx.fillStyle = '#0f0a04';
                ctx.beginPath();
                // Head arc (semi-circle)
                ctx.arc(h.x, h.y + bob, h.r, Math.PI, 0);
                // Shoulders
                ctx.bezierCurveTo(
                    h.x + h.r * 2.3, h.y + bob + h.r * 1.9,
                    h.x - h.r * 2.3, h.y + bob + h.r * 1.9,
                    h.x - h.r,       h.y + bob
                );
                ctx.fill();
                ctx.restore();
            });
        }

        // ── Title ─────────────────────────────────────────────────────────────
        const titleA = ease(fi(t, 4.5, 6.0));
        if (titleA > 0) {
            ctx.save();
            ctx.globalAlpha = titleA;

            // Title background glow
            const tg = ctx.createRadialGradient(W * 0.5, H * 0.36, 0, W * 0.5, H * 0.36, W * 0.32);
            tg.addColorStop(0, 'rgba(190,130,15,0.18)');
            tg.addColorStop(1, 'rgba(190,130,15,0)');
            ctx.fillStyle = tg;
            ctx.fillRect(0, 0, W, H);

            const fz = Math.min(62, W * 0.052);
            ctx.font         = `900 ${fz}px 'Cinzel', Georgia, serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';

            // Outer glow pass
            ctx.shadowColor = 'rgba(255,185,35,0.95)';
            ctx.shadowBlur  = 44;
            ctx.fillStyle   = '#ffd65a';
            ctx.fillText('\u2694 ENTER THE ARENA \u2694', W * 0.5, H * 0.36);

            // Inner bright pass
            ctx.shadowBlur = 10;
            ctx.fillStyle  = '#fff8e0';
            ctx.fillText('\u2694 ENTER THE ARENA \u2694', W * 0.5, H * 0.36);

            // Subtitle
            const subA = ease(fi(t, 6.0, 7.5));
            if (subA > 0) {
                ctx.globalAlpha = titleA * subA;
                const sfz = Math.min(16, W * 0.014);
                ctx.font       = `400 ${sfz}px 'Cinzel', Georgia, serif`;
                ctx.shadowBlur = 14;
                ctx.shadowColor = 'rgba(255,160,30,0.65)';
                ctx.fillStyle  = 'rgba(255,195,110,0.88)';
                ctx.fillText('The crowd roars as you step into The Pit.', W * 0.5, H * 0.36 + fz + 20);
            }

            ctx.restore();
        }

        // ── Fade to black at end ──────────────────────────────────────────────
        const endA = fi(t, TOTAL - 1.2, TOTAL);
        if (endA > 0) {
            ctx.fillStyle = `rgba(0,0,0,${endA})`;
            ctx.fillRect(0, 0, W, H);
        }
    }

    _arenaCanvasRaf = requestAnimationFrame(frame);
}

function maybePlayArenaIntro(onDone) {
    const seen   = gameMeta.hintsSeen && gameMeta.hintsSeen.arenaIntro;
    const screen = document.getElementById('arena-video-screen');
    const canvas = document.getElementById('arena-canvas');

    // Already seen, or markup isn't present → just proceed.
    if (seen || !screen || !canvas) { onDone(); return; }

    // Mark seen immediately so a refresh mid-cutscene doesn't replay it.
    if (!gameMeta.hintsSeen) gameMeta.hintsSeen = {};
    gameMeta.hintsSeen.arenaIntro = true;
    saveMetaProgress();

    _arenaVideoDone = onDone;
    screen.style.display = 'flex';
    _runArenaCanvas(_finishArenaVideo);
}

function skipArenaVideo() {
    _arenaCanvasStopped = true;
    if (_arenaCanvasRaf) { cancelAnimationFrame(_arenaCanvasRaf); _arenaCanvasRaf = null; }
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
    _arenaCanvasStopped = true;
    if (_arenaCanvasRaf) { cancelAnimationFrame(_arenaCanvasRaf); _arenaCanvasRaf = null; }
    const screen = document.getElementById('arena-video-screen');
    if (screen) { screen.style.display = 'none'; }
    const cb = _arenaVideoDone;
    _arenaVideoDone = null;
    if (cb) cb();
}


// ── Class-Select Display Data ─────────────────────────────────────────────────
const CS_DISPLAY_DATA = {
    warrior: {
        tag: 'Unbreakable Steel',
        lore: '"A shield is only as strong as the arm behind it."',
        diff: 2,
        gear: [
            { i: '⚔', n: 'Rusted Sword',  t: 'Main-Hand Weapon' },
            { i: '🛡', n: 'Wooden Shield', t: 'Off-Hand Armor'   },
            { i: '❤', n: 'Health Potion',  t: 'Consumable'       },
        ],
        power: { Mobility: 4, Damage: 7, Defense: 10, Utility: 5 }, ps: 3,
        subs: {
            berserker:  { traitIcons: ['🩸','⚔','💀'], abl: { g:'🩸', name:'BLOODLUST',      desc:'ATK scales with missing HP — the more wounded, the more dangerous', tags:['Passive','Rage','Scales'] } },
            knight:     { traitIcons: ['🛡','⚔','📈'], abl: { g:'🛡', name:'SHIELD WALL',    desc:'Absorb all incoming damage for one full turn', tags:['Block','Melee','Passive CD'] } },
            gladiator:  { traitIcons: ['🏟','⚔','★'],  abl: { g:'⚔', name:'RIPOSTE',        desc:'Each hit taken stacks — release to amplify your next strike', tags:['Passive','On Hit','Stacking'] } },
        },
    },
    rogue: {
        tag: 'Master of Shadows',
        lore: '"The dagger you never see is the one that kills you."',
        diff: 3,
        gear: [
            { i: '🗡', n: 'Twin Daggers', t: 'Dual-Wield Weapons' },
            { i: '💨', n: 'Smoke Bomb',   t: 'Consumable'         },
            { i: '🔑', n: 'Lockpick Kit', t: 'Tool'               },
        ],
        power: { Mobility: 10, Damage: 8, Defense: 2, Utility: 9 }, ps: 4,
        subs: {
            assassin:  { traitIcons: ['⚡','🗡','👁'],  abl: { g:'💀', name:'MARKED FOR DEATH', desc:'Mark a target — your next hit against it is a guaranteed critical', tags:['Crit','Enemy','1 Mark'] } },
            trickster: { traitIcons: ['🪤','⚡','🌀'],  abl: { g:'💨', name:'SMOKE SCREEN',     desc:'Vanish into a cloud — all enemies lose sight of you immediately', tags:['Stealth','AOE','Escape'] } },
            shadow:    { traitIcons: ['🌑','👁','✦'],   abl: { g:'🌑', name:'SHADOW STEP',      desc:'Teleport through solid walls to any tile within range', tags:['2 Tiles','4T CD','Teleport'] } },
        },
    },
    mage: {
        tag: 'Architect of Ruin',
        lore: '"Fire does not distinguish between friend and foe."',
        diff: 4,
        gear: [
            { i: '🪄', n: 'Apprentice Staff',   t: 'Main-Hand Weapon' },
            { i: '📖', n: 'Tattered Spellbook', t: 'Off-Hand Focus'   },
            { i: '🧪', n: 'Mana Draught',        t: 'Consumable'       },
        ],
        power: { Mobility: 4, Damage: 10, Defense: 1, Utility: 8 }, ps: 5,
        subs: {
            elementalist: { traitIcons: ['✦','🔥','⚡'],  abl: { g:'🔥', name:'ELEMENTAL SURGE', desc:'Cycle fire, ice, and lightning in a single devastating strike', tags:['AOE','Tri-Element','5T CD'] } },
            illusionist:  { traitIcons: ['👻','🌀','🪞'], abl: { g:'👻', name:'PHANTOM TWIN',    desc:'Summon a decoy that draws all enemy aggression to itself', tags:['Summon','Taunt','4T CD'] } },
            necromancer:  { traitIcons: ['💀','🩸','🦴'], abl: { g:'💀', name:'RAISE DEAD',      desc:'Reanimate a fallen enemy as your temporary undead ally', tags:['Summon','Undead','5T CD'] } },
        },
    },
    cleric: {
        tag: 'Divine Champion',
        lore: '"Faith is a shield. Doubt is the only wound that festers."',
        diff: 2,
        gear: [
            { i: '🔨', n: 'Blessed Mace',      t: 'Main-Hand Weapon' },
            { i: '✨', n: "Healer's Vestments", t: 'Chest Armor'      },
            { i: '❤', n: 'Health Potion',       t: 'Consumable'       },
        ],
        power: { Mobility: 5, Damage: 6, Defense: 8, Utility: 10 }, ps: 3,
        subs: {
            warDomain:      { traitIcons: ['⚔','📢','❤'], abl: { g:'⚔', name:'HOLY CHARGE',  desc:'Rush an enemy, stun it, and deal divine damage in one motion', tags:['Melee','Stun','3T CD'] } },
            lightDomain:    { traitIcons: ['✚','☀','✨'],  abl: { g:'☀', name:'SOLAR FLARE',  desc:'Blast of holy light blinds and burns all visible enemies at once', tags:['AOE','Blind','4T CD'] } },
            twilightDomain: { traitIcons: ['🌙','🌑','✦'], abl: { g:'🌙', name:'VEIL OF DUSK', desc:'Shroud yourself — cut incoming damage and move unseen', tags:['Defense','Stealth','4T CD'] } },
        },
    },
};

const _CS_DIFF_LABELS = ['','Beginner','Easy','Medium','Hard','Expert'];


// ── SVG Hero Art ──────────────────────────────────────────────────────────────
function _csSvgWarrior(c,rgb){return`<defs><radialGradient id="wg" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${c}" stop-opacity=".55"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient><filter id="wf"><feGaussianBlur stdDeviation="6"/></filter><filter id="wfs"><feGaussianBlur stdDeviation="3"/></filter></defs><ellipse cx="140" cy="210" rx="115" ry="155" fill="url(#wg)" opacity=".38" filter="url(#wf)"/><g opacity=".88"><polygon points="162,58 170,66 108,308 100,300" fill="${c}" opacity=".7"/><rect x="82" y="168" width="78" height="10" rx="3" fill="${c}" opacity=".9"/><rect x="128" y="178" width="8" height="58" rx="2" fill="rgba(255,255,255,.4)"/><circle cx="132" cy="242" r="8" fill="${c}" opacity=".8"/></g><g opacity=".83"><path d="M57 138 L57 238 Q57 268 87 288 Q117 308 117 288 L117 138 Q117 118 87 118 Q57 118 57 138Z" fill="rgba(${rgb},.14)" stroke="${c}" stroke-width="1.5"/><line x1="87" y1="148" x2="87" y2="268" stroke="${c}" stroke-width="1" opacity=".45"/><line x1="62" y1="208" x2="112" y2="208" stroke="${c}" stroke-width="1" opacity=".45"/><circle cx="87" cy="208" r="12" fill="rgba(${rgb},.22)" stroke="${c}" stroke-width="1"/></g><path d="M97 53 Q97 23 140 18 Q183 23 183 53 L183 88 L97 88Z" fill="rgba(${rgb},.18)" stroke="${c}" stroke-width="1.5"/><rect x="110" y="63" width="63" height="18" rx="2" fill="rgba(${rgb},.1)" stroke="${c}" stroke-width="1"/><rect x="117" y="69" width="18" height="5" rx="2" fill="${c}" opacity=".9"><animate attributeName="opacity" values=".9;.4;.9" dur="2s" repeatCount="indefinite"/></rect><rect x="147" y="69" width="18" height="5" rx="2" fill="${c}" opacity=".9"><animate attributeName="opacity" values=".4;.9;.4" dur="2s" repeatCount="indefinite"/></rect><path d="M102 88 L92 198 Q92 218 140 218 Q188 218 188 198 L178 88Z" fill="rgba(${rgb},.1)" stroke="${c}" stroke-width="1" opacity=".8"/><path d="M97 88 Q72 93 67 118 L97 108Z" fill="rgba(${rgb},.3)" stroke="${c}" stroke-width="1"/><path d="M183 88 Q208 93 213 118 L183 108Z" fill="rgba(${rgb},.3)" stroke="${c}" stroke-width="1"/><ellipse cx="140" cy="358" rx="78" ry="14" fill="${c}" opacity=".08" filter="url(#wf)"/>`;}

function _csSvgRogue(c,rgb){return`<defs><radialGradient id="rg" cx="50%" cy="42%" r="52%"><stop offset="0%" stop-color="${c}" stop-opacity=".5"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient><filter id="rf"><feGaussianBlur stdDeviation="8"/></filter><filter id="rfs"><feGaussianBlur stdDeviation="3"/></filter></defs><ellipse cx="140" cy="175" rx="98" ry="138" fill="url(#rg)" opacity=".45" filter="url(#rf)"/><path d="M102 88 Q52 138 22 318 Q52 348 82 343 Q92 258 102 168Z" fill="rgba(${rgb},.07)" stroke="${c}" stroke-width=".5" opacity=".65"><animateTransform attributeName="transform" type="rotate" values="-1 102 200;1 102 200;-1 102 200" dur="4s" repeatCount="indefinite"/></path><path d="M178 88 Q228 138 258 318 Q228 348 198 343 Q188 258 178 168Z" fill="rgba(${rgb},.07)" stroke="${c}" stroke-width=".5" opacity=".65"><animateTransform attributeName="transform" type="rotate" values="1 178 200;-1 178 200;1 178 200" dur="4.5s" repeatCount="indefinite"/></path><path d="M102 83 Q102 28 140 23 Q178 28 178 83 L163 93 Q153 86 140 84 Q127 86 117 93Z" fill="rgba(${rgb},.17)" stroke="${c}" stroke-width="1.5"/><path d="M117 73 Q117 58 140 55 Q163 58 163 73 L163 93 Q153 86 140 84 Q127 86 117 93Z" fill="rgba(0,0,0,.62)"/><ellipse cx="128" cy="76" rx="5" ry="4" fill="${c}"><animate attributeName="opacity" values="1;.3;1" dur="3s" repeatCount="indefinite"/></ellipse><ellipse cx="152" cy="76" rx="5" ry="4" fill="${c}"><animate attributeName="opacity" values=".3;1;.3" dur="3s" repeatCount="indefinite"/></ellipse><ellipse cx="128" cy="76" rx="8" ry="6" fill="${c}" opacity=".28" filter="url(#rfs)"/><ellipse cx="152" cy="76" rx="8" ry="6" fill="${c}" opacity=".28" filter="url(#rfs)"/><path d="M117 93 L112 198 Q112 213 140 213 Q168 213 168 198 L163 93Z" fill="rgba(${rgb},.09)" stroke="${c}" stroke-width=".8"/><path d="M115 108 Q90 148 75 178" stroke="${c}" stroke-width="8" stroke-linecap="round" fill="none" opacity=".38"/><polygon points="70,173 78,170 55,278 47,275" fill="${c}" opacity=".85"/><rect x="58" y="230" width="24" height="5" rx="1" fill="${c}" opacity=".7"/><path d="M165 108 Q190 148 205 178" stroke="${c}" stroke-width="8" stroke-linecap="round" fill="none" opacity=".38"/><polygon points="210,173 202,170 225,278 233,275" fill="${c}" opacity=".85"/><rect x="198" y="230" width="24" height="5" rx="1" fill="${c}" opacity=".7"/><ellipse cx="140" cy="353" rx="83" ry="17" fill="${c}" opacity=".1" filter="url(#rf)"/>`;}

function _csSvgMage(c,rgb){return`<defs><radialGradient id="mg" cx="50%" cy="35%" r="55%"><stop offset="0%" stop-color="${c}" stop-opacity=".55"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient><filter id="mf"><feGaussianBlur stdDeviation="8"/></filter><filter id="mfs"><feGaussianBlur stdDeviation="3"/></filter></defs><circle cx="140" cy="178" r="128" fill="none" stroke="${c}" stroke-width=".5" opacity=".18"><animateTransform attributeName="transform" type="rotate" values="0 140 178;360 140 178" dur="22s" repeatCount="indefinite"/></circle><circle cx="140" cy="178" r="94" fill="none" stroke="${c}" stroke-width=".3" opacity=".28" stroke-dasharray="4 8"><animateTransform attributeName="transform" type="rotate" values="360 140 178;0 140 178" dur="16s" repeatCount="indefinite"/></circle><ellipse cx="140" cy="158" rx="88" ry="118" fill="url(#mg)" opacity=".45" filter="url(#mf)"/><rect x="148" y="28" width="5" height="298" rx="2" fill="rgba(${rgb},.48)" stroke="${c}" stroke-width=".5"/><circle cx="150" cy="33" r="22" fill="rgba(${rgb},.14)" stroke="${c}" stroke-width="1.5"/><circle cx="150" cy="33" r="14" fill="${c}" opacity=".6"><animate attributeName="opacity" values=".6;.92;.6" dur="2s" repeatCount="indefinite"/><animate attributeName="r" values="14;16;14" dur="2s" repeatCount="indefinite"/></circle><circle cx="150" cy="33" r="7" fill="white" opacity=".82"/><circle cx="150" cy="33" r="28" fill="${c}" opacity=".18" filter="url(#mfs)"/><path d="M115 98 Q105 198 90 328 L110 333 Q120 228 130 108Z" fill="rgba(${rgb},.09)" stroke="${c}" stroke-width=".8"/><path d="M145 98 Q155 198 170 328 L150 333 Q140 228 130 108Z" fill="rgba(${rgb},.09)" stroke="${c}" stroke-width=".8"/><path d="M110 93 Q110 38 130 33 Q150 38 150 93 L140 98Z" fill="rgba(${rgb},.17)" stroke="${c}" stroke-width="1.5"/><ellipse cx="124" cy="73" rx="4" ry="3" fill="${c}"><animate attributeName="opacity" values=".8;1;.8" dur="2.5s" repeatCount="indefinite"/></ellipse><ellipse cx="138" cy="73" rx="4" ry="3" fill="${c}"><animate attributeName="opacity" values="1;.8;1" dur="2.5s" repeatCount="indefinite"/></ellipse><circle cx="95" cy="208" r="12" fill="${c}" opacity=".28" filter="url(#mfs)"><animate attributeName="r" values="10;14;10" dur="1.8s" repeatCount="indefinite"/></circle><circle cx="95" cy="208" r="5" fill="${c}" opacity=".82"><animate attributeName="opacity" values=".82;1;.82" dur="1.8s" repeatCount="indefinite"/></circle><ellipse cx="130" cy="353" rx="88" ry="17" fill="${c}" opacity=".05" filter="url(#mf)"/>`;}

function _csSvgCleric(c,rgb){return`<defs><radialGradient id="clg" cx="50%" cy="40%" r="55%"><stop offset="0%" stop-color="${c}" stop-opacity=".6"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient><filter id="clf"><feGaussianBlur stdDeviation="7"/></filter><filter id="clfs"><feGaussianBlur stdDeviation="3"/></filter></defs><ellipse cx="140" cy="170" rx="110" ry="140" fill="url(#clg)" opacity=".4" filter="url(#clf)"/><line x1="140" y1="40" x2="140" y2="220" stroke="${c}" stroke-width=".8" opacity=".22"/><line x1="50" y1="130" x2="230" y2="130" stroke="${c}" stroke-width=".8" opacity=".22"/><line x1="83" y1="63" x2="197" y2="197" stroke="${c}" stroke-width=".5" opacity=".15"/><line x1="197" y1="63" x2="83" y2="197" stroke="${c}" stroke-width=".5" opacity=".15"/><circle cx="140" cy="58" r="32" fill="none" stroke="${c}" stroke-width="1.5" opacity=".7"><animateTransform attributeName="transform" type="rotate" values="0 140 58;360 140 58" dur="12s" repeatCount="indefinite"/></circle><circle cx="140" cy="58" r="26" fill="none" stroke="${c}" stroke-width=".5" opacity=".4" stroke-dasharray="3 5"/><circle cx="140" cy="58" r="16" fill="${c}" opacity=".12" filter="url(#clfs)"/><rect x="176" y="100" width="5" height="140" rx="2" fill="rgba(${rgb},.55)" stroke="${c}" stroke-width=".5"/><rect x="163" y="90" width="31" height="24" rx="4" fill="rgba(${rgb},.28)" stroke="${c}" stroke-width="1.5"/><circle cx="179" cy="102" r="8" fill="${c}" opacity=".6"><animate attributeName="opacity" values=".6;.9;.6" dur="2s" repeatCount="indefinite"/></circle><line x1="179" y1="95" x2="179" y2="109" stroke="rgba(255,255,255,.7)" stroke-width="2"/><line x1="172" y1="102" x2="186" y2="102" stroke="rgba(255,255,255,.7)" stroke-width="2"/><path d="M108 95 L95 310 Q95 335 140 335 Q185 335 185 310 L172 95Z" fill="rgba(${rgb},.1)" stroke="${c}" stroke-width=".8"/><path d="M108 90 Q108 40 140 35 Q172 40 172 90 L157 98 Q150 92 140 90 Q130 92 123 98Z" fill="rgba(${rgb},.2)" stroke="${c}" stroke-width="1.5"/><path d="M123 75 Q123 58 140 55 Q157 58 157 75 L157 98 Q150 92 140 90 Q130 92 123 98Z" fill="rgba(0,0,0,.55)"/><ellipse cx="132" cy="76" rx="4" ry="3" fill="${c}"><animate attributeName="opacity" values=".85;.4;.85" dur="3s" repeatCount="indefinite"/></ellipse><ellipse cx="148" cy="76" rx="4" ry="3" fill="${c}"><animate attributeName="opacity" values=".4;.85;.4" dur="3s" repeatCount="indefinite"/></ellipse><line x1="140" y1="120" x2="140" y2="150" stroke="${c}" stroke-width="1.5" opacity=".55"/><line x1="128" y1="132" x2="152" y2="132" stroke="${c}" stroke-width="1.5" opacity=".55"/><circle cx="112" cy="200" r="2.5" fill="${c}" opacity=".5"><animate attributeName="cy" values="200;130;200" dur="4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;0;.5" dur="4s" repeatCount="indefinite"/></circle><circle cx="168" cy="240" r="2" fill="${c}" opacity=".4"><animate attributeName="cy" values="240;170;240" dur="5.5s" repeatCount="indefinite"/><animate attributeName="opacity" values=".4;0;.4" dur="5.5s" repeatCount="indefinite"/></circle><ellipse cx="140" cy="355" rx="80" ry="14" fill="${c}" opacity=".08" filter="url(#clf)"/>`;}

const _CS_SVG = { warrior:_csSvgWarrior, rogue:_csSvgRogue, mage:_csSvgMage, cleric:_csSvgCleric };


// ── Particle System ────────────────────────────────────────────────────────────
let _csPts=[], _csPtRaf=null, _csPtFc=0;
let _csResizeHandler=null;
let _csCurRgb={r:224,g:68,b:68}, _csTgtRgb={r:224,g:68,b:68};
let _csPtCtx=null;

function _csLerpRgb(a,b,t){return{r:a.r+(b.r-a.r)*t,g:a.g+(b.g-a.g)*t,b:a.b+(b.b-a.b)*t};}
function _csParseRgb(s){const[r,g,b]=s.split(',').map(Number);return{r,g,b};}

function csInitParticles(){
    const cv=document.getElementById('cs-ptcl-canvas');
    if(!cv)return;
    _csPtCtx=cv.getContext('2d');
    _csPts=[];_csPtFc=0;
    // Reuse one resize handler across visits so re-entering character-select
    // doesn't stack a fresh listener each time (which would leak).
    if(_csResizeHandler) window.removeEventListener('resize',_csResizeHandler);
    _csResizeHandler=()=>{cv.width=window.innerWidth;cv.height=window.innerHeight;};
    _csResizeHandler();
    window.addEventListener('resize',_csResizeHandler);
    if(_csPtRaf)cancelAnimationFrame(_csPtRaf);
    _csPtLoop();
}

function _csPtLoop(){
    const cs=document.getElementById('class-select');
    if(!cs||cs.style.display==='none'){_csPtRaf=null;return;}
    _csPtRaf=requestAnimationFrame(_csPtLoop);_csPtFc++;
    _csCurRgb=_csLerpRgb(_csCurRgb,_csTgtRgb,0.018);
    const ctx=_csPtCtx,cv=document.getElementById('cs-ptcl-canvas');
    if(!ctx||!cv)return;
    const W=cv.width,H=cv.height,lp=W*0.44,c=_csCurRgb;
    ctx.clearRect(0,0,W,H);
    if(_csPtFc%3===0)_csPts.push({x:Math.random()*lp,y:H+8,vx:(Math.random()-.5)*.35,vy:-(0.28+Math.random()*.75),sz:1+Math.random()*2.2,a:0,ma:.28+Math.random()*.38,life:0,ml:110+Math.random()*170,fog:false,r:c.r,g:c.g,b:c.b});
    if(_csPtFc%58===0)_csPts.push({x:Math.random()*lp,y:H+8,vx:(Math.random()-.5)*.12,vy:-(0.04+Math.random()*.08),sz:70+Math.random()*110,a:0,ma:.02+Math.random()*.025,life:0,ml:420+Math.random()*580,fog:true,r:c.r,g:c.g,b:c.b});
    _csPts=_csPts.filter(p=>{
        p.life++;p.x+=p.vx;p.y+=p.vy;
        const pr=p.life/p.ml;
        p.a=pr<.15?(pr/.15)*p.ma:pr>.7?((1-pr)/.3)*p.ma:p.ma;
        if(p.fog){const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.sz);g.addColorStop(0,`rgba(${p.r},${p.g},${p.b},${p.a})`);g.addColorStop(1,`rgba(${p.r},${p.g},${p.b},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();}
        else{ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fillStyle=`rgba(${p.r},${p.g},${p.b},${p.a})`;ctx.fill();}
        return p.life<p.ml&&p.y>-20;
    });
    if(_csPts.length>160)_csPts=_csPts.slice(-160);
}


// ── Render Helpers ─────────────────────────────────────────────────────────────
function _csSetAccent(color,rgb){
    document.documentElement.style.setProperty('--cs-acc',color);
    document.documentElement.style.setProperty('--cs-acc-rgb',rgb);
    _csTgtRgb=_csParseRgb(rgb);
}

function _csCountUp(el,target,ms){
    ms=ms||700;const s=performance.now();
    const go=n=>{const t=Math.min((n-s)/ms,1),e=1-Math.pow(1-t,3);el.textContent=Math.round(target*e);if(t<1)requestAnimationFrame(go);};
    requestAnimationFrame(go);
}

function _csGetStats(sc,className){
    const s=sc.stats;
    const out=[{l:'\u2665 HP',v:s.hp,mx:160},{l:'\u2694 ATK',v:s.atk,mx:20},{l:'\uD83D\uDEE1 DEF',v:s.def,mx:15}];
    if(s.maxMana>0)out.push({l:'\u2736 MANA',v:s.maxMana,mx:45});
    else if(className==='rogue')out.push({l:'\u26A1 CRIT',v:sc.id==='assassin'?40:20,mx:100});
    else out.push({l:'\uD83D\uDCAA PWR',v:s.atk+s.def,mx:35});
    return out;
}

function _csRenderStats(sc,className){
    const el=document.getElementById('cs-stats');if(!el)return;
    const stats=_csGetStats(sc,className);
    el.style.gridTemplateColumns=`repeat(${stats.length},1fr)`;
    el.innerHTML=stats.map(({l,v,mx})=>`<div class="csn-sc"><span class="csn-sc-lbl">${l}</span><span class="csn-sc-val" data-v="${v}" data-mx="${mx}">0</span><div class="csn-bar-wrap"><div class="csn-bar" style="width:0%"></div></div></div>`).join('');
    requestAnimationFrame(()=>setTimeout(()=>{
        el.querySelectorAll('.csn-sc-val').forEach(v=>{
            _csCountUp(v,+v.dataset.v);
            const bar=v.nextElementSibling.querySelector('.csn-bar');
            if(bar)bar.style.width=(+v.dataset.v/+v.dataset.mx*100)+'%';
        });
    },40));
}

function _csRenderTraits(sc,className){
    const el=document.getElementById('cs-tab-traits');if(!el)return;
    const icons=((CS_DISPLAY_DATA[className]||{}).subs||{})[sc.id]&&CS_DISPLAY_DATA[className].subs[sc.id].traitIcons||[];
    el.innerHTML=`<div class="csn-traits">${sc.traits.map((t,i)=>`<div class="csn-trait"><div class="csn-t-ico">${icons[i]||'\u2022'}</div><span>${t}</span></div>`).join('')}</div>`;
}

function _csRenderGear(className){
    const el=document.getElementById('cs-tab-gear');if(!el)return;
    const gear=(CS_DISPLAY_DATA[className]||{}).gear||[];
    el.innerHTML=`<div class="csn-gear">${gear.map(({i,n,t})=>`<div class="csn-gear-item"><span class="csn-g-ico">${i}</span><div><div class="csn-g-name">${n}</div><div class="csn-g-type">${t}</div></div></div>`).join('')}</div>`;
}

function _csRenderPower(className){
    const el=document.getElementById('cs-tab-power');if(!el)return;
    const d=CS_DISPLAY_DATA[className]||{};const power=d.power||{};const ps=d.ps||0;
    el.innerHTML=`<div class="csn-power"><div class="csn-pw-stars">${Array.from({length:5},(_,i)=>`<span class="csn-pw-s${i<ps?' on':''}">${i<ps?'&#9733;':'&#9734;'}</span>`).join('')}</div>${Object.entries(power).map(([lbl,v])=>`<div class="csn-pw-row"><span class="csn-pw-lbl">${lbl}</span><div class="csn-pw-bw"><div class="csn-pw-b" style="width:0%" data-w="${v*10}"></div></div><span class="csn-pw-v">${v}</span></div>`).join('')}</div>`;
    requestAnimationFrame(()=>setTimeout(()=>{el.querySelectorAll('.csn-pw-b[data-w]').forEach(b=>{b.style.width=b.dataset.w+'%';});},40));
}

function _csUpdateAbility(sc,className){
    const subDisp=((CS_DISPLAY_DATA[className]||{}).subs||{})[sc.id]||{};
    const abl=subDisp.abl||{};
    const g=document.getElementById('cs-abl-glyph'),n=document.getElementById('cs-abl-name'),d=document.getElementById('cs-abl-desc'),t=document.getElementById('cs-abl-tags');
    // Fall back to the subclass's own ability name from SUBCLASSES if no
    // display-data ability is defined, so the card is never blank.
    const fallbackName = (sc.abilities && sc.abilities[0]) || (sc.special) || sc.name;
    if(g)g.textContent=abl.g||'\u2726';
    if(n){n.textContent=abl.name||fallbackName||'';n.style.color='#fff';n.style.display='block';}
    if(d){d.textContent=abl.desc||(sc.tagline||'');d.style.display='block';}
    if(t)t.innerHTML=(abl.tags||[]).map(tag=>`<span class="csn-tag">${tag}</span>`).join('');
}

function _csDailyStatus(){
    const el=document.getElementById('cc-daily-status');if(!el)return;
    const rec=getDailyRecord();
    if(rec){el.textContent=`Today's Daily: you ${rec.won?'conquered it!':'reached Floor '+rec.floor} — play again to beat it.`;}
    else{const s=getDailyPlayCount();el.textContent=s>0?`${s} daily challenge${s===1?'':'s'} played. Today's dungeon awaits.`:'New every day at midnight UTC — the same dungeon for everyone.';}
}

function _csInitInputs(){
    const ni=document.getElementById('char-name-input'),si=document.getElementById('seed-code-input'),sh=document.getElementById('seed-code-hint');
    if(ni)ni.addEventListener('keydown',e=>{if(e.key==='Enter')confirmCharacter();});
    if(si){
        si.addEventListener('keydown',e=>{if(e.key==='Enter')confirmCharacter();});
        si.addEventListener('input',()=>{
            const raw=si.value.trim();
            if(!raw){sh.textContent='';sh.className='cs-seed-hint';return;}
            const decoded=codeToSeed(raw);
            if(decoded===null){sh.textContent='Invalid — codes use 2-9 and A-Z only (no 0,1,I,L,O).';sh.className='cs-seed-hint cs-seed-hint-bad';}
            else{sh.textContent='';sh.className='cs-seed-hint';}
        });
    }
}

function csTab(name,btn){
    document.querySelectorAll('.csn-tab-btn').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    document.querySelectorAll('.csn-tab-pane').forEach(p=>p.classList.remove('on'));
    const pane=document.getElementById('cs-tab-'+name);if(pane)pane.classList.add('on');
}

function csSetGender(g,btn){
    ccState.gender=g;
    document.querySelectorAll('.csn-g-btn').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    const img=document.getElementById('cs-portrait-img');
    if(img){img.src=`${ccState.className}-${g}.png`;img.style.display='';}
    // Refresh the large left-panel hero portrait to match the new gender
    const color=CLASS_COLOR[ccState.className]||'#c8922a';
    const rgb=parseInt(color.slice(1,3),16)+','+parseInt(color.slice(3,5),16)+','+parseInt(color.slice(5,7),16);
    _csUpdateHeroArt(ccState.className,color,rgb,false);
}

// Shows the real class/gender portrait PNG (e.g. warrior-m.png) in the left
// panel. If the image is missing or fails to load, falls back to the animated
// SVG silhouette so there's never an empty frame.
function _csUpdateHeroArt(id, color, rgb, skip){
    const img = document.getElementById('cs-hero-img');
    const svg = document.getElementById('cs-hero-svg');
    const gender = (ccState && ccState.gender) || 'm';

    // Always build the SVG fallback so it's ready behind the image.
    if (svg && _CS_SVG[id]) {
        Object.assign(svg.style, { width:'88%', maxHeight:'78%',
            filter:`drop-shadow(0 0 36px rgba(${rgb},0.38))`,
            transition:'opacity 0.3s,transform 0.3s' });
        svg.innerHTML = _CS_SVG[id](color, rgb);
    }

    if (!img) {
        if (svg) svg.style.display = 'block';
        return;
    }

    // Style the portrait frame
    Object.assign(img.style, {
        maxWidth:'90%', maxHeight:'82%', width:'auto', height:'auto',
        objectFit:'contain', borderRadius:'10px',
        filter:`drop-shadow(0 0 38px rgba(${rgb},0.45))`,
        transition:'opacity 0.3s, transform 0.3s',
    });

    if (!skip) { img.style.opacity = '0'; img.style.transform = 'scale(.94)'; }

    img.onload = () => {
        img.style.display = 'block';
        if (svg) svg.style.display = 'none';
        if (!skip) setTimeout(() => { img.style.opacity='1'; img.style.transform='scale(1)'; }, 40);
        else { img.style.opacity='1'; img.style.transform='scale(1)'; }
    };
    img.onerror = () => {
        // Portrait missing → show the animated SVG instead.
        img.style.display = 'none';
        if (svg) {
            svg.style.display = 'block';
            if (!skip) { svg.style.opacity='0'; svg.style.transform='scale(.94)';
                setTimeout(() => { svg.style.opacity='1'; svg.style.transform='scale(1)'; }, 60); }
            else { svg.style.opacity='1'; svg.style.transform='scale(1)'; }
        }
    };
    img.src = `${id}-${gender}.png?v=${typeof GAME_VERSION!=='undefined'?GAME_VERSION:'1'}`;
}


function _csPickClass(id,skip){
    const d=CS_DISPLAY_DATA[id]||{};
    const color=CLASS_COLOR[id]||'#c8922a';
    const rgb=parseInt(color.slice(1,3),16)+','+parseInt(color.slice(3,5),16)+','+parseInt(color.slice(5,7),16);
    ccState.className=id;ccState.subclassId=null;
    _csSetAccent(color,rgb);

    document.querySelectorAll('.csn-cls-tab').forEach((b,i)=>{
        b.classList.toggle('on',Object.keys(CLASS_META)[i]===id);
    });

    // ── Hero art: prefer the real portrait PNG, fall back to SVG ──────────────
    _csUpdateHeroArt(id, color, rgb, skip);

    const nm=document.getElementById('cs-cls-name');
    if(nm){
        if(!skip){nm.style.cssText='opacity:0;transform:translateY(8px);transition:opacity .22s,transform .22s';setTimeout(()=>{nm.textContent=(CLASS_META[id]||{name:id}).name.toUpperCase();nm.style.cssText='opacity:1;transform:translateY(0);transition:opacity .22s,transform .22s';},80);}
        else nm.textContent=(CLASS_META[id]||{name:id}).name.toUpperCase();
    }
    const tg=document.getElementById('cs-cls-tag');if(tg)tg.textContent=d.tag||'';
    const lr=document.getElementById('cs-lore');if(lr)lr.textContent=d.lore||'';
    const st=document.getElementById('cs-stars');
    if(st)st.innerHTML=Array.from({length:5},(_,i)=>`<span class="${i<(d.diff||0)?'csn-s-on':'csn-s-off'}">&#9733;</span>`).join('');
    const dl=document.getElementById('cs-diff-lbl');if(dl)dl.textContent='Difficulty: '+(_CS_DIFF_LABELS[d.diff]||'');

    ['cs-stats','cs-abl-glyph','cs-abl-name','cs-abl-desc','cs-abl-tags'].forEach(id2=>{const e=document.getElementById(id2);if(e)e.innerHTML='';});

    _csRenderGear(id);_csRenderPower(id);

    const pills=document.getElementById('cs-subclass-pills');
    if(pills){const subs=SUBCLASSES[id]||[];pills.innerHTML=subs.map(s=>`<button class="csn-sc-pill" onclick="selectSubclass('${id}','${s.id}')">${s.name}</button>`).join('');}

    // Auto-select the first subclass so the stats / ability / config panels are
    // populated immediately — no half-empty "broken-looking" intermediate state.
    const firstSub=(SUBCLASSES[id]||[])[0];
    if(firstSub){
        selectSubclass(id,firstSub.id);
    } else {
        const hint=document.getElementById('cs-pick-hint'),inp=document.getElementById('cs-config-inputs');
        if(hint)hint.style.display='';if(inp)inp.style.display='none';
    }

    _csDailyStatus();
}


// ── Entry Points ───────────────────────────────────────────────────────────────
function renderClassSelect(){
    ccState={className:null,subclassId:null,gender:'m'};

    // ── Force full-screen layout via inline styles ────────────────────────────
    // The game-container ancestor has position:relative which prevents
    // position:fixed from escaping to the viewport. Inline styles beat any
    // external CSS rule regardless of specificity, so this is bulletproof.
    const _cs  = document.getElementById('class-select');
    const _rt  = document.getElementById('cs-new-root');
    const _lp  = document.getElementById('cs-left-panel');
    const _rp  = document.getElementById('cs-right-panel');
    const _aw  = document.querySelector('.cs-art-wrap');
    const _cv  = document.getElementById('cs-ptcl-canvas');
    const _tb  = document.getElementById('cs-class-tabs');
    const _pp  = document.getElementById('cs-subclass-pills');

    if (_cs) Object.assign(_cs.style, {
        position:'fixed', top:'0', left:'0', right:'0', bottom:'0',
        width:'100vw', height:'100vh', maxHeight:'100vh', maxWidth:'none',
        margin:'0', padding:'0', border:'none', borderRadius:'0',
        boxShadow:'none', overflow:'hidden', background:'#07050a',
        color:'#e8ddd0', zIndex:'100',
    });
    if (_rt) Object.assign(_rt.style, {
        display:'grid', gridTemplateColumns:'42% 1fr',
        width:'100vw', height:'100vh', position:'relative', zIndex:'1',
    });
    if (_lp) Object.assign(_lp.style, {
        display:'flex', flexDirection:'column', alignItems:'center',
        height:'100vh', overflow:'hidden', position:'relative',
        borderRight:'1px solid rgba(var(--cs-acc-rgb),0.15)',
    });
    if (_aw) Object.assign(_aw.style, {
        flex:'1', width:'100%', minHeight:'0', position:'relative',
        display:'flex', alignItems:'center', justifyContent:'center',
    });
    if (_rp) Object.assign(_rp.style, {
        display:'flex', flexDirection:'column', height:'100vh',
        overflowY:'auto', padding:'22px 26px', gap:'14px', boxSizing:'border-box',
    });
    if (_cv) Object.assign(_cv.style, {
        position:'absolute', inset:'0', width:'100%', height:'100%',
        pointerEvents:'none', zIndex:'0',
    });
    if (_tb) Object.assign(_tb.style, {
        display:'flex', gap:'2px', padding:'14px 14px 0',
        width:'100%', flexShrink:'0', zIndex:'2',
    });
    if (_pp) Object.assign(_pp.style, {
        display:'flex', gap:'8px', padding:'0 18px 18px',
        width:'100%', flexShrink:'0', zIndex:'2',
    });

    csInitParticles();_csInitInputs();
    const tabsEl=document.getElementById('cs-class-tabs');
    if(tabsEl)tabsEl.innerHTML=Object.entries(CLASS_META).map(([id,meta])=>`<button class="csn-cls-tab" onclick="selectClass('${id}')">${meta.name}</button>`).join('');
    _csPickClass(Object.keys(CLASS_META)[0],true);
}

function renderClassList(){/* no-op — kept for compatibility */}

function selectClass(className){_csPickClass(className,false);}

function selectSubclass(className,subclassId){
    ccState.className=className;ccState.subclassId=subclassId;
    const sc=(SUBCLASSES[className]||[]).find(s=>s.id===subclassId);if(!sc)return;
    document.querySelectorAll('.csn-sc-pill').forEach(p=>p.classList.toggle('on',p.textContent.trim()===sc.name));
    _csRenderStats(sc,className);_csRenderTraits(sc,className);_csRenderGear(className);_csRenderPower(className);_csUpdateAbility(sc,className);
    const hint=document.getElementById('cs-pick-hint'),inp=document.getElementById('cs-config-inputs');
    if(hint)hint.style.display='none';if(inp)inp.style.display='block';
    const img=document.getElementById('cs-portrait-img');if(img){img.src=`${className}-${ccState.gender}.png`;img.style.display='';}
    const ni=document.getElementById('char-name-input');if(ni)ni.placeholder=(CLASS_META[className]||{name:sc.name}).name;
}

function selectGender(gender){
    ccState.gender=gender;
    const img=document.getElementById('cs-portrait-img');if(img){img.src=`${ccState.className}-${gender}.png`;img.style.display='';}
}

function renderClassExpanded(){/* no-op — new design handles via selectSubclass() */}



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
if (typeof _updateTitleWelcomeGoals === 'function') _updateTitleWelcomeGoals();

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
    if (!gameState.player) {
        // Profile/Trophy can be opened from the character-select tavern (no run).
        if (event.key === 'Escape' && gameState.trophyOpen) { closeTrophyHall(); return; }
        if (event.key === 'Escape' && gameState.profileOpen) { closeProfile(); return; }
        return;
    }

    try {
        if (event.key === 'Escape') {
            if (gameState.stableOpen) { closeStable(); return; }
            if (gameState.trophyOpen) { closeTrophyHall(); return; }
            if (gameState.profileOpen) { closeProfile(); return; }
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
            if (gameState.loteriaOpen) { closeLoteria(); return; }
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
        if (gameState.loteriaOpen) return;
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
