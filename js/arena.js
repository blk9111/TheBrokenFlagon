
// ── Arena Module ───────────────────────────────────────────────────────────────
// The Pit: fight captured dungeon creatures or standing champions for fame
// and gold. Crowd betting, persistent fame tiers, ironman stakes.
//
// Integration points:
//   defeatEnemy()  (combat.js)  — calls resolveArenaBout(true) when in bout
//   showGameOver() (ui.js)      — calls resolveArenaBout(false) for non-ironman
//   Player.move()  (entities.js)— enemy turns fire when inArenaBout
//   Player.attack()(entities.js)— skips tavern-interact branch when inArenaBout
//   useCaptureCage (items.js)   — calls tryCaptureEnemy(enemy)


// ── Constants ─────────────────────────────────────────────────────────────────

// ── Arena Seasons ────────────────────────────────────────────────────────────
// The Pit runs in four seasons, each with its own identity, roster, and
// reward multiplier. Season advances automatically as fame climbs. Tiers
// within each season are ranks (sub-progression visible in the panel header).
const PIT_SEASONS = [
    {
        id: 'bronze', name: 'Bronze Season', fameMin: 0,   fameMax: 74,
        color: '#cd7f32', bgTint: 'rgba(140, 80, 20, 0.12)',
        flavor: 'The crowd is thin. The bets are small. But everyone starts here.',
        titleProgression: [
            { fame: 0,  title: 'Unknown',    color: '#aaa397' },
            { fame: 25, title: 'Challenger', color: '#cd7f32' },
        ],
    },
    {
        id: 'silver', name: 'Silver Season', fameMin: 75,  fameMax: 199,
        color: '#b0b8c8', bgTint: 'rgba(100, 120, 160, 0.12)',
        flavor: 'The regulars start to recognise you. The purses get heavier.',
        titleProgression: [
            { fame: 75,  title: 'Contender',  color: '#b0b8c8' },
            { fame: 125, title: 'Gladiator',  color: '#c8d0e0' },
        ],
    },
    {
        id: 'gold', name: 'Gold Season', fameMin: 200, fameMax: 399,
        color: '#ffd65a', bgTint: 'rgba(200, 160, 30, 0.12)',
        flavor: 'Merchants pay for a seat. Bards write songs about your fights.',
        titleProgression: [
            { fame: 200, title: 'Champion',   color: '#ffd65a' },
            { fame: 300, title: 'Warlord',    color: '#ffaa20' },
        ],
    },
    {
        id: 'champion', name: 'Champion Season', fameMin: 400, fameMax: Infinity,
        color: '#ff4444', bgTint: 'rgba(200, 30, 30, 0.15)',
        flavor: 'The Pit has no ceiling for you. Defeat is the only limit left.',
        titleProgression: [
            { fame: 400, title: 'Legend',     color: '#ff6644' },
            { fame: 600, title: 'Undying',    color: '#ff2222' },
        ],
    },
];

// Flat list of fame tiers for legacy helpers (getPitTier, getNextPitTier)
const PIT_FAME_TIERS = PIT_SEASONS.flatMap(s => s.titleProgression);

function getPitSeason() {
    const fame = getPitFame();
    return PIT_SEASONS.find(s => fame >= s.fameMin && fame <= s.fameMax) || PIT_SEASONS[0];
}

const PIT_CHAMPIONS = [
    // ── Bronze Season roster ─────────────────────────────────────────────
    { id: 'pit_goblin',    name: 'Pit Goblin',      type: 'goblin',      season: 'bronze',   fameReq: 0,   goldBase: 15,  fameBase: 8,   label: 'Easy',   stars: 1 },
    { id: 'slime_brood',   name: 'Slime Brood',     type: 'slime',       season: 'bronze',   fameReq: 0,   goldBase: 18,  fameBase: 10,  label: 'Easy',   stars: 1 },
    { id: 'bone_brawler',  name: 'Bone Brawler',    type: 'skeleton',    season: 'bronze',   fameReq: 25,  goldBase: 32,  fameBase: 18,  label: 'Medium', stars: 2 },
    // ── Silver Season roster ─────────────────────────────────────────────
    { id: 'shadow_archer', name: 'Shadow Archer',   type: 'archer',      season: 'silver',   fameReq: 75,  goldBase: 48,  fameBase: 28,  label: 'Medium', stars: 2 },
    { id: 'venom_spider',  name: 'Venom Spider',    type: 'spider',      season: 'silver',   fameReq: 75,  goldBase: 55,  fameBase: 32,  label: 'Medium', stars: 2 },
    { id: 'cave_bat',      name: 'Shriek Bat',      type: 'bat',         season: 'silver',   fameReq: 100, goldBase: 50,  fameBase: 30,  label: 'Medium', stars: 2 },
    { id: 'dark_cultist',  name: 'Pit Cultist',     type: 'cultist',     season: 'silver',   fameReq: 125, goldBase: 65,  fameBase: 38,  label: 'Hard',   stars: 3 },
    // ── Gold Season roster ───────────────────────────────────────────────
    { id: 'pit_tyrant',    name: 'Pit Tyrant',      type: 'brute',       season: 'gold',     fameReq: 200, goldBase: 80,  fameBase: 50,  label: 'Hard',   stars: 3 },
    { id: 'iron_warden',   name: 'Iron Warden',     type: 'warden',      season: 'gold',     fameReq: 250, goldBase: 100, fameBase: 65,  label: 'Hard',   stars: 3 },
    { id: 'shade_thief',   name: 'Blade Shade',     type: 'thief',       season: 'gold',     fameReq: 300, goldBase: 110, fameBase: 70,  label: 'Hard',   stars: 3 },
    // ── Champion Season roster ───────────────────────────────────────────
    { id: 'ash_wraith',    name: 'Ash Wraith',      type: 'skeleton',    season: 'champion', fameReq: 400, goldBase: 150, fameBase: 100, label: 'Boss',   stars: 4 },
    { id: 'death_mancer',  name: 'Death Necromancer', type: 'necromancer', season: 'champion', fameReq: 500, goldBase: 200, fameBase: 130, label: 'Boss',   stars: 4 },
    { id: 'endless_king',  name: 'The Endless King', type: 'brute',      season: 'champion', fameReq: 600, goldBase: 300, fameBase: 200, label: 'Boss',   stars: 4 },
];

// Gold multiplier on a winning bet, by difficulty label
const BOUT_ODDS = { Easy: 1.5, Medium: 2.0, Hard: 3.0, Boss: 5.0, Captured: 2.5 };

// ── Champion Intro patter ─────────────────────────────────────────────────────
// The Pit Master's announcement before a bout. The FULL multi-line crawl plays
// the first time you face a champion (and always for boss-tier); repeat fights
// against lesser champions get a single short line so the farm loop doesn't
// become a slideshow. Lines are templated with {name} → champion name.
const PIT_MASTER_INTROS = {
    Easy: {
        full: ['The gate rattles open.', '"{name}," the Pit Master calls, almost bored.', '"Try to make it last."'],
        short: ['"{name}. Again. Place your bets."'],
    },
    Medium: {
        full: ['The torches gutter.', 'The Pit Master raises a hand for quiet.', '"{name} has tasted blood in this ring before."', '"Who walks out — them, or you?"'],
        short: ['"{name} steps in. The crowd leans forward."'],
    },
    Hard: {
        full: ['The crowd falls silent.', 'Chains drag across the stone.', '"{name} enters," the Pit Master shouts.', '"The last three who faced them were carried out."', '"Who dares?"'],
        short: ['"{name} returns. The bookmakers go quiet."'],
    },
    Boss: {
        full: ['The Pit itself seems to darken.', 'Every voice in the stands dies at once.', 'The Pit Master does not smile.', '"{name}.", he says. Only that.', 'The gate slams open.'],
        // Bosses always get the full treatment — short is unused but defined for safety.
        short: ['"{name}. The Pit holds its breath."'],
    },
};

// Tracks which champions have had their full intro shown this session (so the
// first fight gets the crawl, repeats get the one-liner). Boss-tier ignores it.
const _seenChampionIntros = {};

function _pitMasterLines(champ, isFirst) {
    const tbl = PIT_MASTER_INTROS[champ.label] || PIT_MASTER_INTROS.Easy;
    const useFull = isFirst || champ.label === 'Boss';
    const lines = useFull ? tbl.full : tbl.short;
    return lines.map(l => l.replace(/\{name\}/g, champ.name));
}


// The crowd bets more generously on a fighter they know. Each fame tier above
// Unknown adds a small multiplier to the base betting odds — a mechanical
// reward for reputation, so climbing the ranks pays off at the betting table,
// not just on the leaderboard. Capped so it stays a bonus, not a jackpot.
function getFameOddsBonus() {
    const tierIndex = PIT_FAME_TIERS.findIndex(t => t.title === getPitTier().title);
    // +6% per tier, hard-capped at +30% so deeper tier lists don't inflate
    // odds beyond the intended max — the cap is the design intent, not the formula.
    return 1 + Math.min(5, Math.max(0, tierIndex)) * 0.06;
}

function oddsFor(label) {
    const base = BOUT_ODDS[label] || 1.5;
    return Math.round(base * getFameOddsBonus() * 100) / 100;
}

const MAX_CAPTURED = 5;

// Crowd flavor lines — shown in the bet section when a bout is selected
const CROWD_LINES = [
    '"Gold changes hands in the stands. They\'re betting on your blood."',
    '"The crowd roars as the gate opens…"',
    '"Place your bets — the Pit awaits another soul."',
    '"They\'ve seen better fighters. They\'ve seen worse. Place your bet."',
    '"A hush falls. Then someone shouts a number."',
    '"The bookmaker squints at you and revises his odds."',
];


// ── Fame ──────────────────────────────────────────────────────────────────────

function getPitFame() { return gameMeta.pitFame || 0; }

function getPitTier() {
    const fame = getPitFame();
    let tier = PIT_FAME_TIERS[0];
    for (const t of PIT_FAME_TIERS) {
        if (fame >= t.fame) tier = t;
    }
    return tier;
}

function getNextPitTier() {
    const fame = getPitFame();
    return PIT_FAME_TIERS.find(t => t.fame > fame) || null;
}

function gainPitFame(amount) {
    const prevTier = getPitTier();
    const prevSeason = getPitSeason();
    gameMeta.pitFame = (gameMeta.pitFame || 0) + amount;
    gameMeta.pitWins = (gameMeta.pitWins || 0) + 1;
    saveMetaProgress();
    // Flagon Coins: +2 per Pit victory. Guard for stripped builds without treasury.js.
    if (typeof earnFlagonCoins === 'function') earnFlagonCoins(2, 'Pit victory');
    // Diminishing renown for arena farming: first 3 wins against the same champion
    // earn full renown; subsequent wins earn none. Prevents goblin-farming every
    // renown milestone without blocking legitimate progression through harder opponents.
    if (typeof earnRenown === 'function') {
        const boutId = gameState.arenaBoutData?.bout?.data?.id || 'generic';
        if (!gameMeta.pitRenownCounts) gameMeta.pitRenownCounts = {};
        const killCount = (gameMeta.pitRenownCounts[boutId] || 0) + 1;
        gameMeta.pitRenownCounts[boutId] = killCount;
        if (killCount <= 3) earnRenown(4, 'arena victory');
    }
    const newTier = getPitTier();
    const newSeason = getPitSeason();
    // Announce rank-up
    if (newTier.title !== prevTier.title) {
        addMessage(`\u2728 Arena rank: ${newTier.title}! New challengers await in the Pit.`);
        showEventCard('RANK UP', newTier.title, 'milestone');
    }
    // Announce season promotion (bigger deal)
    if (newSeason.id !== prevSeason.id) {
        addMessage(`\u{1F3C6} Season Promotion: You've entered the ${newSeason.name}! ${newSeason.flavor}`);
        showEventCard('SEASON UP', newSeason.name, 'milestone');
    }
}

// ── Arena Rivals ──────────────────────────────────────────────────────────────
// Every champion remembers your head-to-head record. Persisted in
// gameMeta.rivals (auto-saved by saveMetaProgress, which serializes all of
// gameMeta). Keyed by champion.id — captures and gauntlets are excluded since
// they have no stable identity to build a rivalry around.
//
//   gameMeta.rivals = {
//     iron_warden: { wins, losses, streak, lastResult, firstFought, lastFought }
//   }
// streak: positive = consecutive wins, negative = consecutive losses.

function getRival(id) {
    if (!id) return null;
    return (gameMeta.rivals && gameMeta.rivals[id]) || null;
}

function recordRivalResult(id, won) {
    if (!id) return;
    if (!gameMeta.rivals) gameMeta.rivals = {};
    let r = gameMeta.rivals[id];
    if (!r) {
        r = { wins: 0, losses: 0, streak: 0, lastResult: null, firstFought: Date.now(), lastFought: 0 };
        gameMeta.rivals[id] = r;
    }
    if (won) {
        r.wins++;
        r.streak = r.streak >= 0 ? r.streak + 1 : 1;
        r.lastResult = 'win';
    } else {
        r.losses++;
        r.streak = r.streak <= 0 ? r.streak - 1 : -1;
        r.lastResult = 'loss';
    }
    r.lastFought = Date.now();
    saveMetaProgress();
}

// "(2-3)" record string, or '' if this champion has never been fought.
function rivalRecordStr(id) {
    const r = getRival(id);
    if (!r || (r.wins === 0 && r.losses === 0)) return '';
    return `(${r.wins}-${r.losses})`;
}

// Short flavor descriptor for a rivalry, or '' when there's nothing notable to
// say (keeps the UI uncluttered for fresh or trivial matchups).
function rivalFlavor(id) {
    const r = getRival(id);
    if (!r) return '';
    if (r.streak <= -3) return 'Your nemesis';
    if (r.streak >= 3)  return 'You dominate them';
    if (r.wins > 0 && r.losses > 0) return 'A bitter rivalry';
    return '';
}


// ── Champion Intro overlay ────────────────────────────────────────────────────
// Full-screen Pit Master patter that plays before a bout. Lines fade in one at
// a time; the player can click/Space/Enter/Esc to skip straight to the fight.
// Always calls onDone exactly once, whether it finishes naturally or is skipped.
let _champIntroTimers = [];
let _champIntroDone = null;

function showChampionIntro(champ, lines, onDone) {
    // Clean up any prior intro
    _clearChampionIntro();
    _champIntroDone = onDone;

    const color = (champ.label === 'Boss') ? '#ff4444'
                : (champ.label === 'Hard') ? '#ff9f3d'
                : (champ.label === 'Medium') ? '#62b9ff' : '#cd7f32';

    const overlay = document.createElement('div');
    overlay.id = 'champ-intro';
    overlay.style.setProperty('--champ-color', color);
    overlay.innerHTML = `
        <div class="ci-stars">${'\u2605'.repeat(champ.stars || 1)}${'\u2606'.repeat(4 - (champ.stars || 1))}</div>
        <div class="ci-lines" id="ci-lines"></div>
        <div class="ci-skip">click or press space to continue</div>
    `;
    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('ci-visible');

    const linesEl = document.getElementById('ci-lines');
    const PER_LINE = 1100; // ms between line reveals
    lines.forEach((text, i) => {
        const t = setTimeout(() => {
            const div = document.createElement('div');
            div.className = 'ci-line';
            // Last line (or boss name lines) gets emphasis
            if (i === lines.length - 1) div.classList.add('ci-line-final');
            div.textContent = text;
            linesEl.appendChild(div);
            void div.offsetWidth;
            div.classList.add('ci-line-in');
        }, i * PER_LINE);
        _champIntroTimers.push(t);
    });

    // Auto-advance after the last line has had time to breathe
    const total = lines.length * PER_LINE + 900;
    _champIntroTimers.push(setTimeout(_finishChampionIntro, total));

    // Skip handlers
    overlay.addEventListener('click', _finishChampionIntro);
    _champIntroKeyHandler = (e) => {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            _finishChampionIntro();
        }
    };
    document.addEventListener('keydown', _champIntroKeyHandler, true);
}

let _champIntroKeyHandler = null;

function _clearChampionIntro() {
    _champIntroTimers.forEach(clearTimeout);
    _champIntroTimers = [];
    if (_champIntroKeyHandler) {
        document.removeEventListener('keydown', _champIntroKeyHandler, true);
        _champIntroKeyHandler = null;
    }
    const el = document.getElementById('champ-intro');
    if (el) el.remove();
}

function _finishChampionIntro() {
    const el = document.getElementById('champ-intro');
    if (el) {
        el.classList.add('ci-fade');
        setTimeout(() => { if (el) el.remove(); }, 400);
    }
    _champIntroTimers.forEach(clearTimeout);
    _champIntroTimers = [];
    if (_champIntroKeyHandler) {
        document.removeEventListener('keydown', _champIntroKeyHandler, true);
        _champIntroKeyHandler = null;
    }
    const cb = _champIntroDone;
    _champIntroDone = null;
    if (cb) cb();
}


function getAvailableChampions() {
    const fame = getPitFame();
    // Show all opponents the player has unlocked (fameReq met), but cap
    // the visible list to the current season + one ahead so the panel
    // doesn't show opponents 4 seasons away that feel unreachable.
    const season = getPitSeason();
    const seasonIds = PIT_SEASONS.map(s => s.id);
    const currentIdx = seasonIds.indexOf(season.id);
    const visibleSeasons = new Set(seasonIds.slice(0, currentIdx + 2));
    return PIT_CHAMPIONS.filter(c => fame >= c.fameReq && visibleSeasons.has(c.season));
}


// ── Capture Net ───────────────────────────────────────────────────────────────

function tryCaptureEnemy(enemy) {
    const p = gameState.player;
    if (!p) return false;

    const netIdx = p.inventory.findIndex(i => i.type === 'captureCage' && i.qty > 0);
    if (netIdx === -1) {
        addMessage('No Capture Net in your pack (key: 6).');
        updateUI();
        return false;
    }
    if (enemy.type === 'boss' || enemy.bossVariant || enemy.milestoneBoss) {
        addMessage('Boss creatures cannot be caged — even the Pit has standards.');
        updateUI();
        return false;
    }
    if (enemy.hp > enemy.maxHp * 0.3) {
        addMessage(`${capitalize(enemy.name)} is too healthy to capture. Weaken it below 30% HP first.`);
        updateUI();
        return false;
    }
    if ((gameState.capturedCreatures || []).length >= MAX_CAPTURED) {
        addMessage(`Your cages are full (${MAX_CAPTURED} max). Fight a bout at the Arena to free a slot.`);
        updateUI();
        return false;
    }

    // Consume one net charge
    const net = p.inventory[netIdx];
    net.qty--;
    if (net.qty <= 0) p.inventory.splice(netIdx, 1);

    // 65% base success rate — rogues and assassins get +15% since stealth
    // and precision are on-brand for the capture fantasy.
    const bonus = (p.className === 'rogue' || p.subclass === 'assassin') ? 0.15 : 0;
    if (rng() > 0.65 + bonus) {
        addMessage(`The net shatters on impact — ${enemy.name} breaks free!`);
        addBurst(enemy.x, enemy.y, '#aaa397');
        enemyTurn();
        updateUI();
        return false;
    }

    // Success
    gameState.enemies = gameState.enemies.filter(e => e !== enemy);
    if (!gameState.capturedCreatures) gameState.capturedCreatures = [];
    gameState.capturedCreatures.push({
        type: enemy.type,
        name: enemy.name,
        color: enemy.color,
        glyph: enemy.glyph,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        atk: enemy.atk,
        def: enemy.def,
        floorCaptured: gameState.floor,
        goldBase: 25 + gameState.floor * 3,
        fameBase: 12 + Math.floor(gameState.floor / 2),
    });
    addBurst(enemy.x, enemy.y, '#c98bff');
    addFloatingText(enemy.x, enemy.y, 'CAPTURED!', '#c98bff', { style: 'crit-banner' });
    addMessage(`${capitalize(enemy.name)} thrashes in the net — caged for the Pit!`);
    sfxItemPickup();
    refreshEnemyIntents();
    enemyTurn();
    updateUI();
    return true;
}


// ── Panel ─────────────────────────────────────────────────────────────────────

function openArena() {
    if (!isArenaUnlocked()) {
        addMessage('"The Pit is for professionals," a voice rasps. "Survive Floor 20 first."');
        updateUI();
        return;
    }
    // First-ever entry plays the arena cutscene, then opens the panel. The
    // helper proceeds immediately on repeat visits (or if the video is missing),
    // so this never blocks access to the Pit.
    const showPanel = () => {
        gameState.arenaOpen = true;
        const panel = document.getElementById('arena-panel');
        if (panel) panel.style.display = 'flex';
        renderArenaPanel();
        updateUI();
    };
    if (typeof maybePlayArenaIntro === 'function') {
        maybePlayArenaIntro(showPanel);
    } else {
        showPanel();
    }
}

function closeArena() {
    gameState.arenaOpen = false;
    _pendingArenaBout = null;
    const panel = document.getElementById('arena-panel');
    if (panel) panel.style.display = 'none';
    updateUI();
}

// Release a captured creature from its cage for a small gold refund.
// Prevents the 5-cage cap from becoming a softlock if the player fills
// all slots with weak enemies they don't want to fight.
function releaseCapture(idx) {
    const creatures = gameState.capturedCreatures || [];
    const c = creatures[idx];
    if (!c) return;
    const refund = 8;
    creatures.splice(idx, 1);
    if (gameState.player) gameState.player.gold += refund;
    addMessage(`You release the ${c.name} back into the wild (+${refund}g).`);
    renderArenaPanel();
    if (typeof renderStable === 'function') renderStable();
    updateUI();
}


// Sell value for a captured creature: its arena gold-base plus a small bonus
// scaled to the floor it was caught on. Selling is the "cash it in instead of
// fighting it" path — worth less than a winning bout, more than a release.
function captureSellValue(c) {
    if (!c) return 0;
    return Math.round((c.goldBase || 20) * 1.5 + (c.floorCaptured || 1) * 2);
}

function sellCapture(idx) {
    const creatures = gameState.capturedCreatures || [];
    const c = creatures[idx];
    if (!c) return;
    const value = captureSellValue(c);
    creatures.splice(idx, 1);
    if (gameState.player) {
        gameState.player.gold += value;
        if (typeof trackGoldPickup === 'function') trackGoldPickup(value);
    }
    addMessage(`You sell the ${c.name} to a Pit broker for ${value}g.`);
    if (typeof sfxItemPickup === 'function') sfxItemPickup();
    renderArenaPanel();
    if (typeof renderStable === 'function') renderStable();
    if (typeof saveActiveRun === 'function') saveActiveRun();
    updateUI();
}

// Tracks the bout the player has highlighted but not yet confirmed
let _pendingArenaBout = null;

function renderArenaPanel() {
    if (!gameState.arenaOpen) return;
    const p = gameState.player;
    const fame = getPitFame();
    const tier = getPitTier();
    const nextTier = getNextPitTier();
    const season = getPitSeason();
    const champions = getAvailableChampions();
    const captured = gameState.capturedCreatures || [];

    // Season banner — updates the panel's accent color and season name
    const seasonBanner = document.getElementById('arena-season-banner');
    if (seasonBanner) {
        seasonBanner.textContent = season.name;
        seasonBanner.style.color = season.color;
        seasonBanner.style.borderColor = season.color;
        const panel = document.getElementById('arena-panel');
        if (panel) panel.style.setProperty('--arena-season-tint', season.bgTint);
    }

    // Fame header
    const fameEl = document.getElementById('arena-fame-val');
    const titleEl = document.getElementById('arena-title-val');
    const nextEl = document.getElementById('arena-fame-next');
    const goldEl = document.getElementById('arena-gold-val');
    if (fameEl) fameEl.textContent = fame;
    if (titleEl) { titleEl.textContent = tier.title; titleEl.style.color = tier.color; }
    if (nextEl) nextEl.textContent = nextTier ? `${nextTier.fame - fame} fame to ${nextTier.title}` : 'Maximum Rank';
    if (goldEl) goldEl.textContent = `${p.gold}g`;

    // Captured creatures section
    const captureEl = document.getElementById('arena-captures');
    if (captureEl) {
        if (!captured.length) {
            captureEl.innerHTML = '<p class="arena-empty">No captured creatures. Use a Capture Net (key 6) in the dungeon on an enemy below 30% HP.</p>';
        } else {
            captureEl.innerHTML = captured.map((c, i) => {
                const goldReward = c.goldBase;
                const odds = oddsFor('Captured');
                return `<div class="arena-bout-row" onclick="selectArenaBout(${i}, 'capture')">
                    <div class="arena-bout-info">
                        <span class="arena-bout-glyph" style="color:${safeColor(c.color)}">${escHtml(c.glyph)}</span>
                        <div class="arena-bout-names">
                            <span class="arena-bout-name">${escHtml(c.name)}</span>
                            <span class="arena-bout-diff arena-diff-captured">Captured · Floor ${c.floorCaptured}</span>
                        </div>
                    </div>
                    <div class="arena-bout-rewards">
                        <span class="arena-bout-gold">+${goldReward}g</span>
                        <span class="arena-bout-fame">+${c.fameBase} fame</span>
                        <span class="arena-bout-odds">${odds}× bet</span>
                    </div>
                    <button class="arena-fight-btn" onclick="event.stopPropagation(); selectArenaBout(${i}, 'capture')">Enter Pit</button>
                    <button class="arena-release-btn" onclick="event.stopPropagation(); releaseCapture(${i})" title="Release for 8g">Release</button>
                </div>`;
            }).join('');
        }
    }

    // Champions section
    const champEl = document.getElementById('arena-champions');
    if (champEl) {
        if (!champions.length) {
            champEl.innerHTML = '<p class="arena-empty">No champions available yet. Earn 25 fame to unlock the roster.</p>';
        } else {
            const stars = n => '★'.repeat(n) + '☆'.repeat(4 - n);
            champEl.innerHTML = champions.map(c => {
                const goldReward = c.goldBase + Math.floor((gameState.bestFloor || 0) / 10) * 5;
                const odds = oddsFor(c.label);
                const record = rivalRecordStr(c.id);
                const flavor = rivalFlavor(c.id);
                const recordHtml = record
                    ? ` <span class="arena-rival-record">${record}</span>` : '';
                const flavorHtml = flavor
                    ? `<span class="arena-rival-flavor">${escHtml(flavor)}</span>` : '';
                return `<div class="arena-bout-row" onclick="selectArenaBout('${escHtml(c.id)}', 'champion')">
                    <div class="arena-bout-info">
                        <span class="arena-bout-stars">${stars(c.stars)}</span>
                        <div class="arena-bout-names">
                            <span class="arena-bout-name">${escHtml(c.name)}${recordHtml}</span>
                            <span class="arena-bout-diff arena-diff-${c.label.toLowerCase()}">${escHtml(c.label)}${flavorHtml ? ' · ' : ''}${flavorHtml}</span>
                        </div>
                    </div>
                    <div class="arena-bout-rewards">
                        <span class="arena-bout-gold">+${goldReward}g</span>
                        <span class="arena-bout-fame">+${c.fameBase} fame</span>
                        <span class="arena-bout-odds">${odds}× bet</span>
                    </div>
                    <button class="arena-fight-btn" onclick="event.stopPropagation(); selectArenaBout('${escHtml(c.id)}', 'champion')">Challenge</button>
                </div>`;
            }).join('');
        }
    }

    // ── Gauntlet roster ──────────────────────────────────────────────────
    const gauntletEl = document.getElementById('arena-gauntlets');
    if (gauntletEl) {
        const gauntlets = getAvailableGauntlets();
        if (!gauntlets.length) {
            gauntletEl.innerHTML = '<p class="arena-empty">No gauntlets available yet. Earn 25 fame to unlock the Bronze Gauntlet.</p>';
        } else {
            gauntletEl.innerHTML = gauntlets.map(g => {
                const maxGold = g.goldPerWave * g.waves;
                const maxFame = g.famePerWave * g.waves;
                return `<div class="arena-bout-row arena-gauntlet-row" onclick="selectGauntlet('${escHtml(g.id)}')">
                    <div class="arena-bout-info">
                        <span class="arena-bout-stars">${'⚔'.repeat(Math.min(4, Math.ceil(g.waves / 2)))}</span>
                        <div class="arena-bout-names">
                            <span class="arena-bout-name">${escHtml(g.name)}</span>
                            <span class="arena-bout-diff arena-diff-gauntlet">${g.waves} waves · banked rewards</span>
                        </div>
                    </div>
                    <div class="arena-bout-rewards">
                        <span class="arena-bout-gold">up to +${maxGold}g</span>
                        <span class="arena-bout-fame">+${maxFame} fame</span>
                        <span class="arena-bout-odds">3× bet</span>
                    </div>
                    <button class="arena-fight-btn" onclick="event.stopPropagation(); selectGauntlet('${escHtml(g.id)}')">Enter</button>
                </div>`;
            }).join('');
        }
    }

    // Hide bet section until something is selected
    const betSection = document.getElementById('arena-bet-section');
    if (betSection && !_pendingArenaBout) betSection.style.display = 'none';
}

// Gauntlet selection — reuses the bet UI, then starts the gauntlet.
function selectGauntlet(gauntletId) {
    const g = GAUNTLET_TIERS.find(t => t.id === gauntletId);
    if (!g) return;
    _pendingArenaBout = { isGauntlet: true, gauntletId, name: g.name, data: g };

    const nameEl = document.getElementById('arena-selected-name');
    const rewardEl = document.getElementById('arena-selected-reward');
    const flavorEl = document.getElementById('arena-crowd-flavor');
    const betSection = document.getElementById('arena-bet-section');
    if (nameEl) nameEl.textContent = `${g.name} (${g.waves} waves)`;
    if (rewardEl) rewardEl.innerHTML = `Survive all ${g.waves} waves for the full reward. <strong>You keep banked gold and fame even if you fall.</strong> Heal partially between waves.`;
    if (flavorEl) flavorEl.textContent = g.flavor;
    if (betSection) betSection.style.display = 'block';
}

function selectArenaBout(idOrIdx, type) {
    const p = gameState.player;
    let bout;

    if (type === 'champion') {
        const champ = PIT_CHAMPIONS.find(c => c.id === idOrIdx);
        if (!champ) return;
        // Season multiplier: later seasons offer better rewards to stay competitive
        // with dungeon gold at the same progression stage. Bronze 1×, Silver 1.4×,
        // Gold 1.8×, Champion 2.5×. Deep-floor bonus stays for completeness.
        const seasonMult = { bronze: 1.0, silver: 1.4, gold: 1.8, champion: 2.5 };
        const season = getPitSeason();
        const mult = seasonMult[season.id] || 1.0;
        const goldReward = Math.round((champ.goldBase + Math.floor((gameState.bestFloor || 0) / 10) * 5) * mult);
        bout = { type: 'champion', data: champ, goldReward, fameReward: champ.fameBase, odds: oddsFor(champ.label) };
    } else {
        const idx = parseInt(idOrIdx);
        const capture = (gameState.capturedCreatures || [])[idx];
        if (!capture) return;
        bout = { type: 'capture', data: capture, idx, goldReward: capture.goldBase, fameReward: capture.fameBase, odds: oddsFor('Captured') };
    }

    _pendingArenaBout = bout;

    const betSection = document.getElementById('arena-bet-section');
    if (!betSection) return;
    betSection.style.display = 'flex';

    const nameEl = document.getElementById('arena-selected-name');
    if (nameEl) nameEl.textContent = bout.data.name;

    const rewardEl = document.getElementById('arena-selected-reward');
    if (rewardEl) {
        const bonusPct = Math.round((getFameOddsBonus() - 1) * 100);
        const bonusNote = bonusPct > 0 ? ` (incl. +${bonusPct}% fame bonus)` : '';
        rewardEl.textContent = `+${bout.goldReward}g · +${bout.fameReward} fame · ${bout.odds}× bet payout on win${bonusNote}`;
    }

    const betInput = document.getElementById('arena-bet-input');
    if (betInput) {
        betInput.max = Math.min(p.gold, 500);
        betInput.value = 0;
    }

    const crowdEl = document.getElementById('arena-crowd-flavor');
    if (crowdEl) {
        crowdEl.textContent = CROWD_LINES[Math.floor(Math.random() * CROWD_LINES.length)];
    }

    // Scroll bet section into view
    betSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function confirmArenaBout() {
    if (!_pendingArenaBout) return;
    const p = gameState.player;
    const betInput = document.getElementById('arena-bet-input');
    const ironmanCheck = document.getElementById('arena-ironman-check');
    const rawBet = parseInt(betInput?.value || '0') || 0;
    const bet = Math.max(0, Math.min(rawBet, p.gold, 500));
    const ironman = ironmanCheck?.checked || false;

    if (bet > p.gold) {
        addMessage('Not enough gold for that bet.');
        return;
    }
    if (ironman && !confirm('Ironman Pit: a loss ends your current run permanently. Are you certain?')) return;

    const bout = _pendingArenaBout;
    closeArena();
    // Gauntlet vs single bout
    if (bout.isGauntlet) {
        startGauntlet(bout.gauntletId, bet);
    } else if (bout.type === 'champion' && bout.data) {
        // Play the Pit Master's intro, then start the fight when it finishes
        // (or immediately if the player skips it).
        const champ = bout.data;
        const isFirst = !_seenChampionIntros[champ.id];
        _seenChampionIntros[champ.id] = true;
        const lines = _pitMasterLines(champ, isFirst);
        showChampionIntro(champ, lines, () => startArenaBout(bout, bet, ironman));
    } else {
        startArenaBout(bout, bet, ironman);
    }
}


// ── Bout Lifecycle ────────────────────────────────────────────────────────────

function generateArenaFloor() {
    // Flat open pit: 13 wide × 8 tall interior, surrounded by walls.
    // Centered on the map so the canvas shows it cleanly without edge-hugging.
    const grid = Array.from({ length: MAP_HEIGHT }, () => Array(MAP_WIDTH).fill(1));
    for (let y = 5; y <= 12; y++)
        for (let x = 6; x <= 18; x++)
            grid[y][x] = 0;
    return grid;
}

function startArenaBout(bout, bet, ironman) {
    const p = gameState.player;

    // Persist everything we need to restore after the bout
    gameState.arenaBoutData = {
        bet,
        ironman,
        bout,
        odds: bout.odds,
        goldReward: bout.goldReward,
        fameReward: bout.fameReward,
        savedDungeon: gameState.dungeon,
        savedItems: [...(gameState.items || [])],      // snapshot floor items so they survive the arena visit
        savedTraps: [...(gameState.traps || [])],      // same for traps
        savedInteractables: [...(gameState.interactables || [])], // fix: interactables were wiped on arena entry and never restored
        savedInCourtyard: gameState.inCourtyard,
        savedInArena: gameState.inArena,
        savedWorldPos: { ...(gameState.worldPos || { row: 2, col: 2 }) },
        savedPlayerX: p.x,
        savedPlayerY: p.y,
        savedHp: p.hp,
    };

    // Deduct bet immediately (returned + winnings on win; forfeit on loss)
    if (bet > 0) p.gold = Math.max(0, p.gold - bet);

    // Swap to arena floor
    gameState.dungeon = generateArenaFloor();
    gameState.enemies = [];
    gameState.items = [];
    gameState.traps = [];
    gameState.interactables = [];
    gameState.effects = [];
    gameState.allies = [];
    gameState.decoy = null;
    gameState.inCourtyard = false;
    gameState.inArenaBout = true;
    gameState.arenaIronman = ironman;

    initRevealedGrid();
    revealAll();

    // Place player at west end, fully healed (fair fight)
    p.x = 7; p.y = 9;
    p.renderX = p.x * TILE_SIZE;
    p.renderY = p.y * TILE_SIZE;
    p.hp = p.maxHp;
    p.statuses = []; // clear poison/burn so they can't tick and kill the player before turn 1

    // Build the opponent
    const cd = bout.data;
    let opponentType = cd.type;
    // The 'boss' type doesn't exist in ENEMY_TYPES as a standalone —
    // use 'skeleton' as a heavy-hitting proxy for boss-tier champions
    if (opponentType === 'boss') opponentType = 'skeleton';

    const opponent = new Enemy(17, 9, opponentType);
    opponent.name = cd.name;

    if (bout.type === 'captured') {
        // Use the exact stats the creature had when captured
        opponent.hp = cd.hp;
        opponent.maxHp = cd.maxHp;
        opponent.atk = cd.atk;
        opponent.def = cd.def;
        opponent.color = cd.color;
    } else {
        // Champion: scale to be a meaningful challenge at the player's level
        const scale = Math.max(1, Math.floor(p.level * 0.8));
        opponent.hp = Math.ceil(opponent.hp * (1 + scale * 0.12));
        opponent.maxHp = opponent.hp;
        opponent.atk = Math.ceil(opponent.atk * (1 + scale * 0.08));
        // Boss-tier champion: extra stat boost and scary color
        if (bout.data.label === 'Boss') {
            opponent.hp = Math.ceil(opponent.hp * 1.5);
            opponent.maxHp = opponent.hp;
            opponent.atk = Math.ceil(opponent.atk * 1.3);
            opponent.color = '#ff4444';
        }
    }
    opponent.tookNoDamage = true;
    gameState.enemies.push(opponent);

    // Consume captured creature slot now that the bout has started
    if (bout.type === 'capture') {
        gameState.capturedCreatures.splice(bout.idx, 1);
    }

    refreshEnemyIntents();
    sfxBossEncounter();
    // Reference the rivalry if one exists — the champion "remembers" you.
    const _champId = (bout.type === 'champion' && bout.data) ? bout.data.id : null;
    const _rec = _champId ? rivalRecordStr(_champId) : '';
    if (_rec) {
        addMessage(`The iron gate slams shut. ${opponent.name} remembers you — your record stands ${_rec}.`);
    } else {
        addMessage(`The iron gate slams shut. ${opponent.name} faces you across the Pit!`);
    }
    if (bet > 0) addMessage(`${bet}g bet placed. The crowd adjusts their odds.`);
    showEventCard('PIT FIGHT', opponent.name, 'boss');
    updateUI();
}

function resolveArenaBout(won) {
    if (!gameState.arenaBoutData) return;

    // Destructure everything before we null the state
    const {
        bet, ironman, odds, goldReward, fameReward,
        savedDungeon, savedItems, savedTraps, savedInteractables,
        savedInCourtyard, savedInArena, savedWorldPos,
        savedPlayerX, savedPlayerY, savedHp
    } = gameState.arenaBoutData;
    const p = gameState.player;

    // Capture the champion id for the rival record before arenaBoutData is
    // cleared. Only champion bouts have a stable id; captures/gauntlets don't
    // and are intentionally excluded from rivalries.
    const _rivalBout = gameState.arenaBoutData.bout;
    const _rivalId = (_rivalBout && _rivalBout.type === 'champion' && _rivalBout.data)
        ? _rivalBout.data.id : null;

    // Restore world
    gameState.dungeon = savedDungeon;
    gameState.items = savedItems || [];
    gameState.traps = savedTraps || [];
    gameState.interactables = savedInteractables || []; // fix: restore chests/shrines wiped on arena entry
    gameState.inCourtyard = savedInCourtyard;
    gameState.inArena = savedInArena || false;
    if (savedWorldPos) gameState.worldPos = savedWorldPos;
    gameState.inArenaBout = false;
    gameState.arenaIronman = false;
    gameState.arenaBoutData = null;
    gameState.enemies = [];
    gameState.effects = [];
    gameState.allies = [];

    // Restore player position and HP
    p.x = savedPlayerX;
    p.y = savedPlayerY;
    p.renderX = p.x * TILE_SIZE;
    p.renderY = p.y * TILE_SIZE;

    initRevealedGrid();
    revealAll();
    refreshEnemyIntents();

    gameMeta.pitBouts = (gameMeta.pitBouts || 0) + 1;

    // Update the head-to-head rivalry record (champions only).
    if (_rivalId) recordRivalResult(_rivalId, won);

    if (won) {
        const betWinnings = bet > 0 ? Math.floor(bet * odds) : 0;
        const totalGold = goldReward + betWinnings;
        p.gold += totalGold;
        p.hp = Math.min(p.maxHp, Math.max(p.hp, Math.ceil(savedHp * 0.5))); // restore to at least half pre-bout HP
        trackGoldPickup(totalGold);
        gainPitFame(fameReward);
        saveMetaProgress();

        addFloatingText(p.x, p.y, `+${totalGold}g`, '#ffd65a');
        addFloatingText(p.x, p.y, `+${fameReward} fame`, '#c98bff', { offsetY: -18 });
        addMessage(`Victory! The crowd erupts. You earn ${goldReward}g${betWinnings > 0 ? ` + ${betWinnings}g from your bet` : ''}.`);
        showEventCard('PIT VICTORY', `+${fameReward} Fame`, 'milestone');
        sfxLevelUp();
        addCombatShake(20);
        triggerScreenFlash('kill');
    } else {
        // Non-ironman: survive at 1 HP, lose the bet (already deducted)
        p.hp = 1;
        saveMetaProgress();

        addMessage('Defeat. You are dragged from the Pit, bloodied but breathing.');
        if (bet > 0) addMessage(`Your ${bet}g wager is forfeit.`);
        showEventCard('DEFEATED', 'Dragged from the Pit', 'boss');
        sfxDeath();
    }

    updateUI();
}

// Called when player presses ESC during a bout — forfeits the bet, no death.
// For a gauntlet, surrendering banks the rewards earned so far (quit while ahead).
function forfeitArenaBout() {
    if (!gameState.inArenaBout || !gameState.arenaBoutData) return;
    if (gameState.arenaBoutData.isGauntlet) {
        const banked = gameState.arenaBoutData.bankedGold;
        addMessage(`You raise a hand and step back. The gauntlet ends — you walk away with ${banked}g banked.`);
        _resolveGauntlet(true); // treat surrender as a "win" so banked rewards pay out cleanly
        return;
    }
    addMessage('You signal surrender and are dragged from the Pit. Your bet is forfeit.');
    resolveArenaBout(false);
}


// ── Arena Gauntlet ───────────────────────────────────────────────────────────
// A multi-wave endurance challenge: fight escalating opponents back-to-back
// with only partial healing between rounds. Rewards bank per wave cleared,
// and you keep them even on defeat — quit-while-ahead tension. Unlocks by season.
const GAUNTLET_TIERS = [
    {
        id: 'bronze_gauntlet', name: 'Bronze Gauntlet', season: 'bronze', fameReq: 25,
        waves: 3, pool: ['goblin', 'slime', 'skeleton', 'archer'],
        goldPerWave: 25, famePerWave: 12, healBetween: 0.5,
        flavor: 'Three foes, one after another. Survive them all.',
    },
    {
        id: 'silver_gauntlet', name: 'Silver Gauntlet', season: 'silver', fameReq: 100,
        waves: 5, pool: ['skeleton', 'archer', 'spider', 'bat', 'cultist', 'brute'],
        goldPerWave: 45, famePerWave: 22, healBetween: 0.4,
        flavor: 'Five challengers. The crowd wants a show of endurance.',
    },
    {
        id: 'gold_gauntlet', name: 'Gold Gauntlet', season: 'gold', fameReq: 250,
        waves: 5, pool: ['brute', 'warden', 'thief', 'cultist', 'imp', 'ghoul'],
        goldPerWave: 80, famePerWave: 40, healBetween: 0.35,
        flavor: 'The deep-floor horrors, brought up to the sand. Five of them.',
    },
    {
        id: 'champion_gauntlet', name: 'Champion Gauntlet', season: 'champion', fameReq: 450,
        waves: 7, pool: ['warden', 'orc', 'darkknight', 'ghoul', 'lizardman', 'demon'],
        goldPerWave: 150, famePerWave: 75, healBetween: 0.3,
        flavor: 'Seven. No mercy. Only the Undying walk out of this one.',
    },
];

function getAvailableGauntlets() {
    const fame = getPitFame();
    const season = getPitSeason();
    const seasonIds = PIT_SEASONS.map(s => s.id);
    const currentIdx = seasonIds.indexOf(season.id);
    const visibleSeasons = new Set(seasonIds.slice(0, currentIdx + 1));
    return GAUNTLET_TIERS.filter(g => fame >= g.fameReq && visibleSeasons.has(g.season));
}

function startGauntlet(gauntletId, bet) {
    const g = GAUNTLET_TIERS.find(t => t.id === gauntletId);
    if (!g || !gameState.player) return;
    const p = gameState.player;

    gameState.arenaBoutData = {
        bet: bet || 0, ironman: false,
        isGauntlet: true,
        gauntlet: g,
        currentWave: 0,
        bankedGold: 0,
        bankedFame: 0,
        odds: 3.0,
        savedDungeon: gameState.dungeon,
        savedItems: [...(gameState.items || [])],
        savedTraps: [...(gameState.traps || [])],
        savedInteractables: [...(gameState.interactables || [])],
        savedInCourtyard: gameState.inCourtyard,
        savedInArena: gameState.inArena,
        savedWorldPos: { ...(gameState.worldPos || { row: 2, col: 2 }) },
        savedPlayerX: p.x,
        savedPlayerY: p.y,
        savedHp: p.hp,
    };

    if (bet > 0) p.gold = Math.max(0, p.gold - bet);

    gameState.dungeon = generateArenaFloor();
    gameState.enemies = [];
    gameState.items = [];
    gameState.traps = [];
    gameState.interactables = [];
    gameState.effects = [];
    gameState.allies = [];
    gameState.decoy = null;
    gameState.inCourtyard = false;
    gameState.inArenaBout = true;
    gameState.arenaIronman = false;

    initRevealedGrid();
    revealAll();

    p.x = 7; p.y = 9;
    p.renderX = p.x * TILE_SIZE;
    p.renderY = p.y * TILE_SIZE;
    p.hp = p.maxHp;
    p.statuses = []; // clear statuses on gauntlet entry too

    _spawnGauntletWave();
    sfxBossEncounter();
    addMessage(`${g.name}: ${g.flavor}`);
    showEventCard('GAUNTLET', `Wave 1 of ${g.waves}`, 'boss');
    updateUI();
}

function _spawnGauntletWave() {
    const data = gameState.arenaBoutData;
    if (!data || !data.isGauntlet) return;
    const g = data.gauntlet;
    const p = gameState.player;
    data.currentWave++;

    // Later waves pull from the harder end of the pool
    const poolIdx = Math.min(g.pool.length - 1,
        Math.floor((data.currentWave / g.waves) * g.pool.length));
    const type = g.pool[Math.min(poolIdx + Math.floor(rng() * 2), g.pool.length - 1)];

    const opponent = new Enemy(17, 9, type);
    const scale = Math.max(1, Math.floor(p.level * 0.7)) + data.currentWave;
    opponent.hp = Math.ceil(opponent.hp * (1 + scale * 0.10));
    opponent.maxHp = opponent.hp;
    opponent.atk = Math.ceil(opponent.atk * (1 + scale * 0.06));
    opponent.tookNoDamage = true;
    opponent._gauntletWave = data.currentWave;
    gameState.enemies.push(opponent);
    refreshEnemyIntents();

    addMessage(`Wave ${data.currentWave} of ${g.waves}: ${capitalize(opponent.name)} enters the Pit!`);
    if (data.currentWave > 1) {
        showEventCard('NEXT WAVE', `Wave ${data.currentWave} of ${g.waves}`, 'milestone');
    }
}

// Called from defeatEnemy when an arena enemy dies. Returns true if the
// gauntlet handled the kill (spawned next wave or finished), false otherwise.
function handleGauntletKill(enemy) {
    const data = gameState.arenaBoutData;
    if (!data || !data.isGauntlet) return false;

    const g = data.gauntlet;
    const p = gameState.player;

    data.bankedGold += g.goldPerWave;
    data.bankedFame += g.famePerWave;

    spawnDeathAnim(enemy);
    gameState.enemies = gameState.enemies.filter(e => e !== enemy);

    if (data.currentWave >= g.waves) {
        _resolveGauntlet(true);
        return true;
    }

    const healAmount = Math.ceil(p.maxHp * g.healBetween);
    p.hp = Math.min(p.maxHp, p.hp + healAmount);
    addFloatingText(p.x, p.y, `+${healAmount}`, '#58c26d');
    addMessage(`Wave cleared! You recover ${healAmount} HP. Banked: ${data.bankedGold}g, ${data.bankedFame} fame.`);
    sfxLevelUp();
    _spawnGauntletWave();
    updateUI();
    return true;
}

function _resolveGauntlet(won) {
    const data = gameState.arenaBoutData;
    if (!data) return;
    const g = data.gauntlet;
    const p = gameState.player;
    const {
        bet, bankedGold, bankedFame, currentWave,
        savedDungeon, savedItems, savedTraps, savedInteractables,
        savedInCourtyard, savedPlayerX, savedPlayerY, savedHp
    } = data;

    gameState.dungeon = savedDungeon;
    gameState.items = savedItems || [];
    gameState.traps = savedTraps || [];
    gameState.interactables = savedInteractables || [];
    gameState.inCourtyard = savedInCourtyard;
    gameState.inArenaBout = false;
    gameState.arenaIronman = false;
    gameState.arenaBoutData = null;
    gameState.enemies = [];
    gameState.effects = [];
    gameState.allies = [];

    p.x = savedPlayerX; p.y = savedPlayerY;
    p.renderX = p.x * TILE_SIZE;
    p.renderY = p.y * TILE_SIZE;

    initRevealedGrid();
    revealAll();
    refreshEnemyIntents();
    gameMeta.pitBouts = (gameMeta.pitBouts || 0) + 1;

    if (won) {
        const fullClear = currentWave >= g.waves;
        const completionBonus = fullClear ? Math.floor(bankedGold * 0.5) : 0;
        const betWinnings = (fullClear && bet > 0) ? Math.floor(bet * 3.0) : 0;
        const totalGold = bankedGold + completionBonus + betWinnings;
        p.gold += totalGold;
        p.hp = Math.min(p.maxHp, Math.max(p.hp, Math.ceil(savedHp * 0.5)));
        trackGoldPickup(totalGold);
        if (bankedFame > 0) gainPitFame(bankedFame);
        saveMetaProgress();

        addFloatingText(p.x, p.y, `+${totalGold}g`, '#ffd65a');
        if (fullClear) {
            addMessage(`GAUNTLET CLEARED! All ${g.waves} waves down. ${bankedGold}g + ${completionBonus}g bonus${betWinnings ? ` + ${betWinnings}g bet` : ''} = ${totalGold}g, +${bankedFame} fame!`);
            showEventCard('GAUNTLET CLEARED', `+${bankedFame} Fame`, 'milestone');
            triggerScreenFlash('kill');
        } else {
            addMessage(`You walk away after wave ${currentWave} with ${totalGold}g and ${bankedFame} fame banked.`);
            showEventCard('GAUNTLET', `Withdrew · Wave ${currentWave}`, 'milestone');
        }
        sfxLevelUp();
        addCombatShake(20);
    } else {
        if (bankedGold > 0) {
            p.gold += bankedGold;
            trackGoldPickup(bankedGold);
            if (bankedFame > 0) gainPitFame(bankedFame);
        }
        p.hp = 1;
        saveMetaProgress();
        addMessage(`Defeated on wave ${currentWave}. You keep your banked ${bankedGold}g and ${bankedFame} fame — but the full gauntlet eluded you.`);
        showEventCard('GAUNTLET FAILED', `Wave ${currentWave} of ${g.waves}`, 'boss');
        sfxDeath();
    }
    updateUI();
}


// ── Phase-2 backward-compat aliases ──────────────────────────────────────────
// These keep external callers (main.js, tests.html, bot-controller.js) working
// without modification until those files are updated in later phases.
// Remove each alias when its caller file is migrated:
//   ARENA_SEASONS / ARENA_CHAMPIONS / ARENA_FAME_TIERS → Phase 4 (main.js/data.js)
//   getArenaFame / getArenaTier / getNextArenaTier / getArenaSeason → Phase 4
//   gainArenaFame → Phase 4
// Do NOT remove aliases before the caller is updated — that will break the game.
/* eslint-disable no-unused-vars */
const ARENA_SEASONS     = PIT_SEASONS;
const ARENA_FAME_TIERS  = PIT_FAME_TIERS;
const ARENA_CHAMPIONS   = PIT_CHAMPIONS;
const getArenaFame      = getPitFame;
const getArenaTier      = getPitTier;
const getNextArenaTier  = getNextPitTier;
const getArenaSeason    = getPitSeason;
const gainArenaFame     = gainPitFame;
/* eslint-enable no-unused-vars */
