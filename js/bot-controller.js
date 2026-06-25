// ═══════════════════════════════════════════════════════════════════════════
// THE BROKEN FLAGON — Bot Controller
// Add to index.html LAST, after all other scripts:
//   <script src="js/bot-controller.js"></script>
// Remove before shipping to players.
//
// VERSIONING: BOT_VERSION below is the single source of truth. Bump it on every
// meaningful change and add a one-line CHANGELOG entry. Scheme: 2.MINOR.PATCH
//   • MINOR — new feature or capability (display modes, persistence, loop mode)
//   • PATCH — bug fix or tuning (stall fixes, diagnostics, cooldown values)
// The version shows in the title bar, the startup log, and _bot.version().
// ═══════════════════════════════════════════════════════════════════════════
(function () {
'use strict';

// ── Version & changelog ───────────────────────────────────────────────────
// Newest first. Keep entries terse — one line, what changed and why.
const BOT_VERSION = '2.4.0';
const BOT_BUILD_DATE = '2026-06-25';
const BOT_CHANGELOG = [
    ['2.4.0', 'Crash-proof run persistence (localStorage, survives reload/crash); 💾 Download CSV; loop-batch mode for overnight runs'],
    ['2.3.1', 'Ability cooldown (bot-only) to stop spam loops at the source; cooldown configurable'],
    ['2.3.0', 'Wall-clock stall watchdog (configurable) — escapes stuck floors in ~30s instead of ~5min'],
    ['2.2.2', 'Sticky-unreachable tracking so genuinely walled enemies stay skipped; accurate stall diagnostics (summoner vs navigation)'],
    ['2.2.1', 'Display-mode canvas hide fix — big map no longer flashes back in minimap/headless; per-frame enforcement'],
    ['2.2.0', 'Display modes (Full / Minimap / Headless) to suppress the main canvas for speed; live FPS; session stats strip'],
    ['2.1.0', 'Expanded session stats; richer run-pane metrics'],
    ['2.0.0', 'Bot Controller v2 baseline — 6 tabs, HP sparkline, kill feed, minimap, pathfinder diag, death heatmap, per-class/subclass stats'],
];

// ── Ship guard ────────────────────────────────────────────────────────────
// This file is a dev-only automation harness. It is INERT unless the host
// page explicitly opts in by setting window.__DEV_BOT__ = true before
// this script loads. Production builds should never set that flag and
// should never include this file — but the guard makes an accidental ship
// harmless rather than a cheat-engine giveaway.
if (!window.__DEV_BOT__) {
    console.info('[BotController] DEV_MODE not active — bot disabled. Set window.__DEV_BOT__=true to enable.');
    return; // exits the IIFE, exposes nothing
}

// ── Config ────────────────────────────────────────────────────────────────
const CFG = {
    tickMs:        120,
    healAt:       0.50,   // use potion below this HP% (was 0.45 — react earlier)
    fleeAt:       0.25,   // flee dungeon below this HP% with no potions (was 0.18 — too late)
    abilityAt:    0.60,   // cleric uses ability below this HP% (was 0.55)
    bankAt:        120,   // bank when holding more gold than this
    restAt:       0.75,   // rest at inn when HP below this %
    arenaMinGold:  80,    // min gold to fight in arena
    shopBuffer:    50,    // keep at least this much gold after buying
    upgradeAt:    160,    // blacksmith upgrade when gold above this (was 200)
    autoRestart:  true,
    maxStuck:       6,    // ticks before forced unstick (attack/reroute)
    hearthstoneCost: 40,  // cost of a Hearthstone Coin from the innkeeper
    // ── Combat / survival tuning (previously hardcoded magic numbers) ──────
    patchUpAt:    0.70,   // buy merchant "Patch Up" heal below this HP%
    berserkerMinHp: 0.35, // berserker won't self-damage below this HP%
    smokeBombAt:  0.35,   // smoke-bomb escape threshold when 1 adjacent enemy
    panicAt:      0.30,   // emergency portal / predictive-heal danger threshold
    abilitySpamBanLimit: 16, // consecutive ability uses before banning it this run
    abilityCooldownTicks: 4,  // min ticks between bot ability uses (rate-limit; ~0.5s at 120ms)
    // ── DESIGN-3: previously hardcoded magic numbers ──────────────────────
    intentScanRange:  4,     // tile radius for scanning enemy intents
    eliteThreatRange: 5,     // tile distance to trigger rage draught
    rageDraughtHpMin: 0.55,  // min HP% to use rage draught offensively
    portalMinLevel:   4,     // min player level to use mage/cleric portal
    elixirMinLevel:   6,     // min level to buy alchemist elixir
    alchemistPotMin:  3,     // min potion count before upgrading at alchemist
    // ── Wall-clock stall watchdog ─────────────────────────────────────────
    // Max real seconds the bot may spend on one floor before being force-ended,
    // independent of tick counters (which in-place shuffling can keep resetting).
    // This is the reliable catch-all escape. 0 disables. 30s default.
    floorWatchdogMs: 30000,
    // Loop the batch forever (overnight unattended runs). When true, completing
    // all classes×runs restarts the batch instead of stopping. Off by default.
    loopBatch: false,
};

// ── State ─────────────────────────────────────────────────────────────────
let running   = false;
let paused    = false;
let tickTimer = null;
let minimized = false;
let logs      = [];
let errors    = [];
// Error rate limiter — prevents a bug that fires every 15ms tick from generating
// thousands of entries/sec, flooding the log, and freezing the browser.
// Allows up to ERR_RATE_MAX errors in any 1-second window; extras are swallowed
// (with one console warning). Counter resets each second.
const _errRate = { count: 0, stamp: 0, suppressed: 0 };
const ERR_RATE_MAX = 12; // hard ceiling per second
let stats     = { runs:0, deaths:0, bestFloor:0, kills:0, gold:0, arenaWins:0, floors:[] };

// ── Batch testing + reporting ─────────────────────────────────────────────
// Per-run records: { class, subclass, floor, outcome, kills, gold, ts }
let runRecords = [];

// Batch state — runs each class N times, then generates a comparison report.
const batch = {
    active:    false,
    classes:   ['warrior','rogue','mage','cleric'],
    runsEach:  20,
    classIdx:  0,
    runIdx:    0,
    startKills: 0,
    startGold:  0,
};

// All subclasses per class — the batch rotates through them so every path
// gets tested rather than always picking the same one. This gives balance
// data across the full roster, not just four representative subclasses.
// Subclasses to cycle through per class during batch testing.
// Derived dynamically from the game's SUBCLASSES registry so new subclasses
// added to the game are automatically included without updating the bot.
// Falls back to a hardcoded list if SUBCLASSES isn't accessible yet.
const ALL_SUBCLASSES = (() => {
    try {
        if (typeof SUBCLASSES !== 'undefined') {
            const result = {};
            for (const [cls, subs] of Object.entries(SUBCLASSES)) {
                result[cls] = subs.map(s => s.id).filter(Boolean);
            }
            return result;
        }
    } catch(_) {}
    // Fallback
    return {
        warrior: ['knight', 'berserker', 'gladiator'],
        rogue:   ['assassin', 'trickster', 'shadow'],
        mage:    ['elementalist', 'illusionist', 'necromancer'],
        cleric:  ['lightDomain', 'warDomain', 'twilightDomain'],
    };
})();

// Subclass to pick for a given class at a given run index (cycles through all).
function pickSubclassForRun(className, runIdx) {
    const subs = ALL_SUBCLASSES[className] || [null];
    return subs[runIdx % subs.length] || null;
}

function recordRunResult(p, floor, outcome) {
    const kills = stats.kills - batch.startKills;
    const gold  = stats.gold  - batch.startGold;
    const rec = {
        class:    p.className || '?',
        subclass: p.subclass  || '',
        floor, outcome,
        kills:    Math.max(0, kills),
        gold:     Math.max(0, gold),
        level:    p.level || 1,
        weapon:   p.equipment?.weapon?.name || '',
        seed:     gs()?.runSeed || null,   // IMPROVE-1: seed for replay/verification
        ts:       Date.now(),
        bossesKilled: p.runStats?.bossesDefeated || 0,
        potionsUsed:  p.runStats?.potionsUsed    || 0,
        dmgEfficiency: (p.runStats?.damageTaken > 0)
            ? +((p.runStats.damageDelt||0) / p.runStats.damageTaken).toFixed(1) : 0,
    };
    runRecords.push(rec);
    _persistRun(rec); // crash-proof: flush this run to localStorage immediately
    batch.startKills = stats.kills;
    batch.startGold  = stats.gold;
    if (runRecords.length > 1000) runRecords.shift();

    // ── Run history cards (last RUN_HISTORY_MAX runs visible in History tab) ──
    _runHistory.unshift(rec);
    if (_runHistory.length > RUN_HISTORY_MAX) _runHistory.pop();

    // ── Per-class stats ────────────────────────────────────────────────────
    const cls = p.className || 'unknown';
    if (!liveClassStats[cls]) liveClassStats[cls] = { runs:0, totalFloor:0, bestFloor:0, deaths:0, totalKills:0 };
    const cs = liveClassStats[cls];
    cs.runs++; cs.totalFloor += floor;
    cs.bestFloor = Math.max(cs.bestFloor, floor);
    cs.deaths += outcome === 'death' ? 1 : 0;
    cs.totalKills += Math.max(0, kills);

    // ── Per-subclass stats ─────────────────────────────────────────────────
    const scId = p.subclass || cls;
    if (!liveSubclassStats[scId]) liveSubclassStats[scId] = { name: scId, cls, runs:0, totalFloor:0, bestFloor:0, deaths:0 };
    const ss = liveSubclassStats[scId];
    ss.runs++; ss.totalFloor += floor;
    ss.bestFloor = Math.max(ss.bestFloor, floor);
    ss.deaths += outcome === 'death' ? 1 : 0;

    // ── Floor death heatmap ────────────────────────────────────────────────
    if (outcome === 'death') {
        _floorDeaths[floor] = (_floorDeaths[floor] || 0) + 1;
    }

    // ── Session persistence ────────────────────────────────────────────────
    _sessionStats.totalRuns++;
    _sessionStats.totalDeaths += outcome === 'death' ? 1 : 0;
    _sessionStats.bestFloor = Math.max(_sessionStats.bestFloor, floor);
    _saveSession();

    // ── Kill feed: clear between runs ─────────────────────────────────────
    _killFeed.length = 0;
    _runDmgDealt = 0;
    _hpHistory.length = 0;
    _goldLedger = { startGold:0, kills:0, chests:0, arena:0, other:0, potions:0, rest:0, shop:0, total:0 };
    _lastGold = p.gold || 0;
}

function startBatch(runsEach) {
    batch.active   = true;
    batch.runsEach = runsEach || batch.runsEach;
    batch.classIdx = 0;
    batch.runIdx   = 0;
    batch.startKills = stats.kills;
    batch.startGold  = stats.gold;
    runRecords = [];
    // Don't force a speed — run at whatever the user selected. They can click
    // Turbo for max throughput once they've confirmed a clean batch at Normal.
    // (Previously this forced 30ms, which surprised users mid-test and made the
    // first verification run faster than intended.)
    log(`Batch started: ${batch.classes.length} classes × ${batch.runsEach} runs at ${CFG.tickMs}ms/tick`, 'run');
    if (!running && window._bot) window._bot.toggle();
    forceNewRunAs(batch.classes[0]);
}

function advanceBatch() {
    // Single source of truth for advancing the batch — used by BOTH the death
    // path and the stall-timeout path so they can't diverge. Does NOT reset
    // _lastGameOverId (forceNewRunAs does that); clearing it here would let
    // every tick during the restart gap record phantom deaths.
    _lastExitLogKey  = null;
    _abilitySpamCount = 0;
    _abilityBanned   = false;
    _abilityFloorCount = 0;
    _lastAbilityTick = -999; // reset ability cooldown for the new run
    _runTickCount    = 0;
    _floorTickCount  = 0;
    batch.runIdx++;
    const done = batch.runIdx >= batch.runsEach;
    if (done) {
        batch.classIdx++;
        batch.runIdx = 0;
        if (batch.classIdx >= batch.classes.length) {
            // Loop mode (for overnight unattended runs): instead of stopping,
            // restart the batch from the top and keep collecting. The persisted
            // dataset keeps growing across loops. A one-line summary logs each
            // cycle so the log shows progress without a blocking report panel.
            if (CFG.loopBatch) {
                batch.classIdx = 0;
                batch.runIdx = 0;
                batch._loopCount = (batch._loopCount || 0) + 1;
                log(`Batch loop ${batch._loopCount} complete — ${_persistedRuns.length} runs saved, looping`, 'run');
                // fall through to start the next run below
            } else {
                batch.active = false;
                log('Batch complete! Generating report...', 'run');
                generateReport();
                return;
            }
        }
    }
    const cls = batch.classes[batch.classIdx];
    const total = batch.classIdx * batch.runsEach + batch.runIdx;
    const grand = batch.classes.length * batch.runsEach;
    log(`Batch: ${cls} run ${batch.runIdx+1}/${batch.runsEach} (${total}/${grand} total)`, 'info');
    // Start the next run directly — no setTimeout. The 300ms delay it used to
    // have created a race window where the still-gameOver state fired
    // advanceBatch again before the new run loaded. forceNewRunAs is synchronous
    // and immediately clears gameOver via initGame, closing that window.
    forceNewRunAs(cls);
}

// Force-start a fresh run as a specific class, bypassing the UI menus.
function forceNewRunAs(className) {
    _lastGameOverId  = null;   // fresh run, fresh dedup state
    _lastExitLogKey  = null;
    _abilitySpamCount = 0;
    _abilityBanned   = false;
    _abilityFloorCount = 0;
    _lastAbilityTick = -999; // reset ability cooldown for the new run
    _runTickCount    = 0;
    _floorTickCount  = 0;
    _floorEnterMs    = Date.now(); // reset wall-clock watchdog for the new run
    _arenaPendingConfirm = false;
    if (window._bot) window._bot._boughtElixir = false; // reset once-per-run town purchase
    try {
        const sub = pickSubclassForRun(className, batch.runIdx);
        if (typeof initGame === 'function') {
            initGame(className, sub, 'BOT', null, false);
            // initGame sets up the game state but does NOT hide the title screen
            // (that's beginAdventure's job, which we bypass). Hide it ourselves,
            // otherwise the decide() title-screen guard sees it visible and fires
            // tryStartRun() every tick — which does nothing during a batch —
            // deadlocking the whole batch. Also hide game-over and class-select.
            const hide = id => { const el=document.getElementById(id); if(el) el.style.display='none'; };
            hide('title-screen');
            hide('game-over');
            hide('class-select');
            hide('intro-video-screen');
            try { stopAshParticles?.(); } catch(_) {}
            log(`New run as ${className}/${sub||'base'}`, 'run');
        } else {
            // BUG-6 fix: initGame missing means the run can never start, deadlocking
            // the batch silently. Log, error, and advance so the batch keeps running.
            err('forceNewRun', new Error('initGame not found — run skipped'));
            log('initGame not available — skipping run', 'warn');
            if (batch.active) setTimeout(() => advanceBatch(), 100);
        }
    } catch(e) { err('forceNewRun', e); }
}

// ── Report generation ─────────────────────────────────────────────────────
function generateReport() {
    if (!runRecords.length) { showEmptyReport(); return; }
    const byClass = {};
    for (const r of runRecords) {
        const k = r.subclass ? r.class+'/'+r.subclass : r.class;
        if (!byClass[k]) byClass[k] = { runs:0, floors:[], kills:[], gold:[], cleared:0, deaths:0, fled:0, weapons:{} };
        const c = byClass[k];
        c.runs++; c.floors.push(r.floor); c.kills.push(r.kills); c.gold.push(r.gold);
        if (r.outcome==='clear'||r.floor>=100) c.cleared++;
        if (r.outcome==='death') c.deaths++;
        if (r.outcome==='fled') c.fled++;
        if (r.weapon) { if(!c.weapons[r.weapon])c.weapons[r.weapon]=[]; c.weapons[r.weapon].push(r.floor); }
    }
    const avg=arr=>arr.length?(arr.reduce((a,b)=>a+b,0)/arr.length):0;
    const med=arr=>{if(!arr.length)return 0;const s=[...arr].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
    const max=arr=>arr.length?Math.max(...arr):0;
    const rows=Object.entries(byClass).map(([cls,c])=>({
        cls, runs:c.runs, avgFloor:avg(c.floors), medFloor:med(c.floors), bestFloor:max(c.floors),
        avgKills:avg(c.kills), deathRate:c.runs?(c.deaths/c.runs*100):0,
        clearRate:c.runs?(c.cleared/c.runs*100):0, deathFloors:c.floors, weapons:c.weapons,
    })).sort((a,b)=>b.avgFloor-a.avgFloor);

    // Death heatmap
    const deathsByFloor={};
    for (const r of runRecords) if(r.outcome==='death') deathsByFloor[r.floor]=(deathsByFloor[r.floor]||0)+1;
    const heatmap=Object.entries(deathsByFloor).map(([f,n])=>({floor:parseInt(f),count:n})).sort((a,b)=>b.count-a.count);

    // Best weapon per subclass
    const buildSummary=rows.map(r=>{
        const weapons=Object.entries(r.weapons).map(([w,floors])=>({weapon:w,avgFloor:avg(floors),runs:floors.length})).filter(w=>w.runs>=2).sort((a,b)=>b.avgFloor-a.avgFloor);
        return {cls:r.cls,bestWeapon:weapons[0]||null};
    });

    showReportPanel(rows, heatmap, buildSummary);
    console.log('%c=== BOT BATCH REPORT ===','color:#c8922a;font-weight:bold');
    console.table(rows.map(r=>({Class:r.cls,Runs:r.runs,'Avg Floor':r.avgFloor.toFixed(1),'Med':r.medFloor,'Best':r.bestFloor,'Kills':r.avgKills.toFixed(1),'Deaths%':r.deathRate.toFixed(0)})));
    if(heatmap.length){console.log('%c=== DEATH HEATMAP ===','color:#e04444;font-weight:bold');console.table(heatmap.slice(0,10).map(h=>({Floor:h.floor,Deaths:h.count})));}
}


let stuckTicks   = 0;
let lastPosKey   = '';
let _revealedWhileStuck = false; // guard so revealAll() fires once per stuck episode, not every tick
let lastFloor    = -1;
// Wall-clock watchdog: real elapsed time on the current floor. Unlike the tick
// counters (_runTickCount / _floorTickCount), this CANNOT be reset by the bot
// shuffling in place — only a genuine floor change resets it. This is the
// reliable catch-all for "stuck doing something" stalls where small moves keep
// resetting the soft tick timer but no real progress happens. Configurable via
// CFG.floorWatchdogMs (0 disables).
let _floorEnterMs = Date.now();
let goalText     = 'Idle';
let _logFilter   = 'all'; // active log filter: 'all'|'floor'|'death'|'warn'|'error'

// Per-class running averages — updated by recordRunResult, shown in dashboard
const liveClassStats = {}; // cls → { runs, totalFloor, bestFloor, deaths, totalKills }
const liveSubclassStats = {}; // subclassId → { name, cls, runs, totalFloor, bestFloor, deaths }
let _renderTick  = 0;
// ── Display performance modes (user-controllable) ─────────────────────────────
// _displayMode drives how much gets drawn while the bot runs:
//   'full'    — main game canvas + bot minimap (default, prettiest, slowest)
//   'minimap' — main game canvas SUPPRESSED, only the bot's minimap draws (fast)
//   'headless'— nothing visual draws (main canvas + minimap both off; max speed)
// The main-canvas suppression is done via window._botSkipRender, which gameLoop
// in ui.js checks each frame.
let _displayMode = 'full';
// FPS sampling for the bot HUD — counts main-loop frames over a rolling window.
let _fpsFrames = 0, _fpsLastStamp = 0, _fpsValue = 0;
function _botSampleFps() {
    _fpsFrames++;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!_fpsLastStamp) _fpsLastStamp = now;
    const dt = now - _fpsLastStamp;
    if (dt >= 500) {
        _fpsValue = Math.round((_fpsFrames * 1000) / dt);
        _fpsFrames = 0;
        _fpsLastStamp = now;
    }
    requestAnimationFrame(_botSampleFps);
}
if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_botSampleFps);
let _lastGameOverId  = null;
let _lastExitLogKey  = null;
let _abilitySpamCount = 0;
// Per-floor ability use counter. Unlike _abilitySpamCount (consecutive uses,
// reset by any other action), this counts ALL ability uses on the current floor
// and only resets on a genuine floor change. It catches "alternating" spam loops
// — e.g. a necromancer that summons a minion, fiddles with it, summons again —
// where the consecutive counter keeps getting reset and never trips the ban.
let _abilityFloorCount = 0;
const ABILITY_FLOOR_LIMIT = 40; // total ability uses on one floor before banning
// Ability cooldown: the game has no native ability cooldown, so a bot at high
// tick rates can fire an ability every tick (8×/sec at 120ms) and form spam
// loops. This rate-limits the bot — NOT the game — gating ability use to once
// per CFG.abilityCooldownTicks ticks. Prevents the loop forming rather than
// catching it after the fact. _abilityTickClock increments every tick.
let _abilityTickClock = 0;
let _lastAbilityTick = -999;
function _abilityOffCooldown() {
    return (_abilityTickClock - _lastAbilityTick) >= (CFG.abilityCooldownTicks || 0);
}
function _markAbilityUsed() { _lastAbilityTick = _abilityTickClock; }
let _abilityBanned   = false;
let _runTickCount    = 0;

// ── Sparkline HP history ───────────────────────────────────────────────────
// Rolling array of HP% values (0-1) capped at 200 entries. Drawn as a tiny
// canvas line graph in the Run tab — makes near-death events, heal timing,
// and the panicAt threshold visible at a glance during a run.
const _hpHistory = [];
const HP_HISTORY_MAX = 200;

// ── Kill feed ─────────────────────────────────────────────────────────────
// Per-kill log: floor, enemy name, damage dealt. Capped at 60 entries.
const _killFeed = [];
const KILL_FEED_MAX = 60;
let _runDmgDealt = 0; // accumulated damage dealt this run (track via HP delta)

// ── Run history cards ─────────────────────────────────────────────────────
// Structured record for the last 20 completed runs. Shown in the History tab.
const _runHistory = [];
const RUN_HISTORY_MAX = 20;

// ── Gold economy ledger ───────────────────────────────────────────────────
// Tracks gold sources and sinks per run.
let _goldLedger = { startGold:0, kills:0, chests:0, arena:0, other:0,
                    potions:0, rest:0, shop:0, total:0 };
let _lastGold = 0;
let _lastGoldSource = 'other';

// ── Live floor death heatmap ──────────────────────────────────────────────
// floorDeaths[floor] = death count for this batch session.
const _floorDeaths = {};

// ── Session persistence (localStorage) ───────────────────────────────────
const _SESSION_KEY = 'bfBot_session';
let _sessionStart = Date.now();
let _sessionStats = { bestFloor:0, totalDeaths:0, totalRuns:0, totalTime:0 };
try {
    const saved = JSON.parse(localStorage.getItem(_SESSION_KEY) || '{}');
    if (saved.bestFloor) _sessionStats = saved;
} catch(_) {}

function _saveSession() {
    _sessionStats.totalTime += Math.round((Date.now() - _sessionStart) / 1000);
    _sessionStart = Date.now();
    try { localStorage.setItem(_SESSION_KEY, JSON.stringify(_sessionStats)); } catch(_) {}
}

// ── Persistent run-record store (crash-proof overnight data) ──────────────────
// Every completed run is appended here AND flushed to localStorage immediately,
// so an overnight batch survives a tab crash, OS sleep, or accidental close —
// you reload and the data is still there to export. Accumulates across sessions
// (multiple nights) rather than resetting per batch, since the goal is a growing
// dataset. Storage isn't a constraint here, but we keep a generous safety cap so
// a runaway can't silently hit quota and start throwing mid-night.
const _PERSIST_KEY = 'bfBot_runRecords';
const _PERSIST_MAX = 50000;            // generous; ~ many nights of runs
let _persistedRuns = [];
let _persistDirty = false;
let _persistLastFlush = 0;
try {
    const raw = localStorage.getItem(_PERSIST_KEY);
    if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) _persistedRuns = arr;
    }
} catch(_) { _persistedRuns = []; }

// Append one completed run and flush. Flushing every run is the crash-proof
// part: the moment a run finishes, it's on disk. JSON.stringify of even tens of
// thousands of small records is well under a frame at the cadence runs complete
// (seconds apart), so this is not a perf concern.
function _persistRun(rec) {
    _persistedRuns.push(rec);
    if (_persistedRuns.length > _PERSIST_MAX) {
        _persistedRuns.splice(0, _persistedRuns.length - _PERSIST_MAX);
    }
    _persistDirty = true;
    _flushPersistedRuns();
}

function _flushPersistedRuns() {
    if (!_persistDirty) return;
    try {
        localStorage.setItem(_PERSIST_KEY, JSON.stringify(_persistedRuns));
        _persistDirty = false;
        _persistLastFlush = Date.now();
    } catch (e) {
        // Quota exceeded or storage unavailable: trim the oldest 20% and retry
        // once, so a long-running batch degrades gracefully instead of throwing
        // on every run for the rest of the night.
        try {
            _persistedRuns.splice(0, Math.ceil(_persistedRuns.length * 0.2));
            localStorage.setItem(_PERSIST_KEY, JSON.stringify(_persistedRuns));
            _persistDirty = false;
        } catch(_) { /* give up silently — in-memory runRecords still works */ }
    }
}

// ── Auto-throttle ─────────────────────────────────────────────────────────
// When enabled, adjusts tick speed based on game phase automatically:
// tavern/no enemies → Turbo, normal combat → Normal, low HP → Slow.
let _autoThrottle = false;
let _autoThrottleLastPhase = '';

function _autoThrottleTick() {
    if (!_autoThrottle || !running) return;
    const s = gs(), p = pp();
    if (!s || !p) return;
    const frac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const hasEnemies = (s.enemies||[]).some(e => e.hp > 0);
    let phase, ms;
    if (s.floor === 0 || s.gameOver) { phase = 'turbo'; ms = 15; }
    else if (frac < 0.28)            { phase = 'slow';  ms = 300; }
    else if (!hasEnemies)            { phase = 'fast';  ms = 45; }
    else                             { phase = 'normal';ms = CFG.tickMs || 120; }
    if (phase !== _autoThrottleLastPhase) {
        _autoThrottleLastPhase = phase;
        if (tickTimer) { clearInterval(tickTimer); tickTimer = setInterval(tick, ms); }
    }
}
// Per-FLOOR hard tick budget. Unlike _runTickCount (which kills, item pickups,
// and successful moves all reset), this ONLY resets when the floor number
// actually changes. It's the backstop against a run that grinds a single floor
// for thousands of ticks — e.g. fighting an endless stream of summoned/split
// enemies (necromancer raise-dead, splitter boss) where every kill resets the
// soft stall timer and the run never ends. ~6.5-minute runs in batch testing
// were caused by exactly this: the soft timer kept resetting on kills.
let _floorTickCount  = 0;
let MAX_FLOOR_TICKS = 2500;   // let so Config panel can change it at runtime // generous: a huge floor with heavy combat is
                              // well under this. Hitting it means "stuck on one
                              // floor regardless of kill activity" — force-end.
// Dodge anti-oscillation: track recent dodge moves so the bot doesn't ping-pong
// between two tiles forever when an enemy holds a charge/wind-up telegraph
// across multiple turns. After MAX_DODGES consecutive dodges the bot stops
// evading and commits to attacking the threat instead.
let _dodgeHistory = [];
let _arenaPendingConfirm = false; // BUG-3: arena step state (prevents double-bet race from setTimeout)      // recent dodge destinations as "x,y" strings (rolling, max 4)
let _dodgeCount   = 0;       // consecutive dodge actions with no intervening progress
const MAX_DODGES  = 3;       // cap on consecutive dodges before forcing engagement
const MAX_STALL_TICKS = 1200; // ~36s at 30ms turbo, ~2.4min at 120ms normal, before force-kill.
                              // A full large-floor explore is ~200 moves, so this leaves
                              // generous headroom while recovering a truly stuck bot ~3× faster.

// ── Pathfinding diagnostics ────────────────────────────────────────────────
const botPathStats = {
    lastNodes: 0, searches: 0, totalNodes: 0, fails: 0,
    // Enhanced: searches/sec + per-floor node cost + fail context buckets
    searchesThisSec: 0, searchesPerSec: 0, _secStamp: Date.now(),
    avgNodes: 0,        // rolling average nodes per search
    worstNodes: 0,      // peak node expansion seen
    failsByContext: {},  // 'context:floor' bucket → count
    nodesByFloor: {},    // floor → { total, count }
};

// Reusable heap backing array — lifted out of makeHeap() so V8 can reuse
// the same allocation across every A* search instead of GC-ing a fresh
// array every call. Cleared with .length=0 at the start of each search.
let _heapArray = [];

// Live A* path cache — absolute tile coords of the current planned route.
// Updated whenever bfs() returns a valid path so the minimap can draw it.
let _lastPath   = [];   // [{x,y}, ...] traversal order from player to target
let _navTarget  = null; // {x, y} current navigation destination

// ── Rare event tracker (IMPROVE-2) ────────────────────────────────────────
// Keyed by event kind: { count, goldDelta, hpDelta } — aggregated across runs.
const _eventStats = {};

// ── Item tracking ──────────────────────────────────────────────────────────
// Two ledgers the bot maintains for the panel: what it has FOUND (picked up or
// equipped off the floor) and what it has USED (potions, scrolls, nets, etc.).
// Keyed by a display name so repeated finds aggregate into a count instead of
// flooding the list.
const itemLog = {
    found: new Map(),  // name → { count, rarity, lastFloor }
    used:  new Map(),  // name → { count }
};
function logItemFound(name, rarity, floor) {
    if (!name) return;
    const e = itemLog.found.get(name) || { count: 0, rarity: rarity || 'common', lastFloor: floor || 0 };
    e.count++; if (rarity) e.rarity = rarity; if (floor) e.lastFloor = floor;
    itemLog.found.set(name, e);
    renderItems();
}
function logItemUsed(name) {
    if (!name) return;
    const e = itemLog.used.get(name) || { count: 0 };
    e.count++;
    itemLog.used.set(name, e);
    renderItems();
}

// ── Accessors ─────────────────────────────────────────────────────────────
const gs  = () => (typeof gameState !== 'undefined' ? gameState : null);
const pp  = () => gs()?.player ?? null;
const hpFrac = () => { const p=pp(); return p ? p.hp/p.maxHp : 1; };

function anyPanelOpen() {
    const s = gs(); if (!s) return true;
    return !!(s.gameOver || s.awaitingLevelChoice || s.shopOpen || s.gamblingOpen ||
        s.brewmasterOpen || s.questBoardOpen || s.bardOpen || s.stashOpen ||
        s.magicDealerOpen || s.blacksmithOpen || s.trainerOpen || s.bankOpen ||
        s.innOpen || s.tavernConfirmOpen || s.ringChoiceOpen || s.cellarFindOpen ||
        s.bestiaryOpen || s.charSheetOpen || s.helpOpen || s.settingsOpen);
}

// ── A* pathfinder ─────────────────────────────────────────────────────────
// Replaces the old breadth-first search. BFS used an array .shift() as its
// queue (O(n) per dequeue) and explored every reachable tile uniformly, which
// got slow on the 25×18 maps the bot walks constantly. A* with a Manhattan
// heuristic and a real binary min-heap heads straight for the target, touching
// a fraction of the tiles. Return format is unchanged — an array of [dx,dy]
// steps — so every caller keeps working. The function is still named bfs() to
// avoid touching its ~6 call sites.
// Tiles the bot considers passable for pathfinding. Tile 4 (TILE_ASCEND —
// the up-stairs back to the previous floor) is intentionally EXCLUDED here.
// Including it caused the bot's A* to route exploration paths directly through
// the ascend-stairs tile at (2,2), which Player.move() then stepped onto,
// firing checkInteractions() → ascendFloor() and sending the bot back to the
// previous floor. Excluding it means BFS and forceWander both naturally avoid
// the tile, preventing the floor 2↔3 oscillation on slower classes like knight.
const WALKABLE_TILES = new Set([0, 2, 5, 6, 7, 8]); // floor, down-stairs, exits, roads, zone-exits

// Pre-allocated BFS buffers — created ONCE, reused every call.
// Allocating fresh TypedArrays inside bfs() at turbo speed (~200 calls/sec)
// created ~1 MB/sec of short-lived garbage. These are reset with .fill()
// at the start of each search, which is far cheaper than re-allocation.
// Sized generously (40×30) so larger overland zones can't overflow the
// buffer — the dungeon is 25×18 but world zones may be bigger.
const BFS_MAX = 40 * 30; // generous cap covering dungeon (25×18) and world zones
const _bfsGsc    = new Float32Array(BFS_MAX);  // g-scores
const _bfsPrevK  = new Int32Array(BFS_MAX);    // previous-node keys
const _bfsPrevD  = new Int8Array(BFS_MAX * 2); // previous step dx/dy
const _bfsClosed = new Uint8Array(BFS_MAX);    // closed-set flags

// A revealed trap the bot should avoid stepping on during pathfinding.
function isKnownTrap(x, y) {
    const s = gs(); if (!s?.traps) return false;
    return s.traps.some(t => t.x === x && t.y === y && s.revealed?.[y]?.[x]);
}

// Tiny binary min-heap keyed by f-score — avoids the array.shift() bottleneck.
function makeHeap() {
    _heapArray.length = 0;  // reset without reallocation (DESIGN-5 fix)
    const a = _heapArray;
    const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
    return {
        get size() { return a.length; },
        push(node) {
            a.push(node);
            let i = a.length - 1;
            while (i > 0) { const p = (i-1)>>1; if (a[p].f <= a[i].f) break; swap(i,p); i = p; }
        },
        pop() {
            const top = a[0], last = a.pop();
            if (a.length) {
                a[0] = last; let i = 0;
                for (;;) {
                    const l = 2*i+1, r = 2*i+2; let m = i;
                    if (l < a.length && a[l].f < a[m].f) m = l;
                    if (r < a.length && a[r].f < a[m].f) m = r;
                    if (m === i) break; swap(i, m); i = m;
                }
            }
            return top;
        }
    };
}

// Returns array of [dx,dy] steps from (sx,sy) to (tx,ty), or null if unreachable.
function bfs(sx, sy, tx, ty) {
    const s = gs(); if (!s?.dungeon) return null;
    if (sx === tx && sy === ty) return [];
    const H = s.dungeon.length, W = s.dungeon[0]?.length || 25;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    if (W * H > BFS_MAX) { botPathStats.fails++; return null; }

    const key = (x, y) => y * W + x;
    const hh  = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const size = W * H;
    _bfsGsc.fill(Infinity, 0, size);
    _bfsPrevK.fill(-1, 0, size);
    _bfsClosed.fill(0, 0, size);
    botPathStats.lastNodes = 0;

    const open = makeHeap();
    _bfsGsc[key(sx, sy)] = 0;
    open.push({ x: sx, y: sy, f: hh(sx, sy) });
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];

    while (open.size) {
        const cur = open.pop();
        const ck = key(cur.x, cur.y);
        if (_bfsClosed[ck]) continue;
        _bfsClosed[ck] = 1;
        botPathStats.lastNodes++;

        if (cur.x === tx && cur.y === ty) {
            const path = [];
            let k = ck;
            while (_bfsPrevK[k] !== -1) { path.unshift([_bfsPrevD[k*2], _bfsPrevD[k*2+1]]); k = _bfsPrevK[k]; }

            // ── Cache path as absolute coords for minimap ──────────────────
            // Reconstruct the tile sequence: player pos + one step per direction
            _navTarget = { x: tx, y: ty };
            let cx2 = sx, cy2 = sy;
            _lastPath = [{ x: cx2, y: cy2 }];
            for (const [dx, dy] of path) { cx2 += dx; cy2 += dy; _lastPath.push({ x: cx2, y: cy2 }); }

            // ── Per-floor node cost tracking ───────────────────────────────
            const fl = s.floor || 0;
            if (!botPathStats.nodesByFloor[fl]) botPathStats.nodesByFloor[fl] = { total: 0, count: 0 };
            botPathStats.nodesByFloor[fl].total += botPathStats.lastNodes;
            botPathStats.nodesByFloor[fl].count++;
            botPathStats.worstNodes = Math.max(botPathStats.worstNodes, botPathStats.lastNodes);

            return path;
        }
        for (const [dx, dy] of dirs) {
            const nx = cur.x + dx, ny = cur.y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nk = key(nx, ny);
            if (_bfsClosed[nk]) continue;
            const tile = s.dungeon[ny]?.[nx];
            const isGoal = nx === tx && ny === ty;
            if (!isGoal && !WALKABLE_TILES.has(tile)) continue;
            if (!isGoal && isKnownTrap(nx, ny)) continue;
            const ng = _bfsGsc[ck] + 1;
            if (ng < _bfsGsc[nk]) {
                _bfsGsc[nk] = ng;
                _bfsPrevK[nk] = ck; _bfsPrevD[nk*2] = dx; _bfsPrevD[nk*2+1] = dy;
                open.push({ x: nx, y: ny, f: ng + hh(nx, ny) });
            }
        }
    }
    _lastPath = [];  // no path found — clear stale route from minimap
    return null;
}

function stepTo(tx, ty) {
    const p = pp(); if (!p) return false;
    _navTarget = { x: tx, y: ty };
    const path = bfs(p.x, p.y, tx, ty);
    botPathStats.searches++;
    botPathStats.searchesThisSec++;
    botPathStats.totalNodes += botPathStats.lastNodes;
    botPathStats.avgNodes = botPathStats.searches > 0
        ? Math.round(botPathStats.totalNodes / botPathStats.searches) : 0;
    // Searches/sec: reset counter every second
    const now = Date.now();
    if (now - botPathStats._secStamp >= 1000) {
        botPathStats.searchesPerSec = botPathStats.searchesThisSec;
        botPathStats.searchesThisSec = 0;
        botPathStats._secStamp = now;
    }
    if (!path || !path.length) { botPathStats.fails++; return false; }
    try { p.move(path[0][0], path[0][1]); } catch(e) { err('move', e); }
    return true;
}

function adj(ax, ay, bx, by) { return Math.abs(ax-bx) + Math.abs(ay-by) <= 1; }

// Find the best walkable tile orthogonally adjacent to (tx,ty) to attack from.
// Returns the closest such tile to the player (by path length), or null.
function bestApproachTile(tx, ty) {
    const s = gs(), p = pp(); if (!s || !p) return null;
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    let best = null, bestLen = Infinity;
    for (const [dx, dy] of dirs) {
        const ax = tx + dx, ay = ty + dy;
        const tile = s.dungeon?.[ay]?.[ax];
        // tile must be walkable AND not occupied by another living enemy.
        // Use the shared WALKABLE_TILES set so BFS and greedy fallback agree.
        if (!WALKABLE_TILES.has(tile)) continue;
        // skip if another enemy is standing there
        const occupied = s.enemies?.some(e => e.hp > 0 && e.x === ax && e.y === ay);
        if (occupied) continue;
        // already standing here?
        if (p.x === ax && p.y === ay) return { x: ax, y: ay };
        const path = bfs(p.x, p.y, ax, ay);
        if (path && path.length < bestLen) { bestLen = path.length; best = { x: ax, y: ay }; }
    }
    return best;
}

// Fallback movement: step one tile toward a target using greedy direction,
// only moving onto walkable tiles. Used when BFS can't reach an attack slot
// (e.g. enemy blocking the only corridor) so the bot still closes distance.
function stepDirectlyToward(tx, ty) {
    const s = gs(), p = pp(); if (!s || !p) return false;
    const dxRaw = tx - p.x, dyRaw = ty - p.y;
    // Prefer the axis with greater distance first
    const tries = [];
    if (Math.abs(dxRaw) >= Math.abs(dyRaw)) {
        if (dxRaw !== 0) tries.push([Math.sign(dxRaw), 0]);
        if (dyRaw !== 0) tries.push([0, Math.sign(dyRaw)]);
    } else {
        if (dyRaw !== 0) tries.push([0, Math.sign(dyRaw)]);
        if (dxRaw !== 0) tries.push([Math.sign(dxRaw), 0]);
    }
    for (const [dx, dy] of tries) {
        const nx = p.x + dx, ny = p.y + dy;
        const tile = s.dungeon?.[ny]?.[nx];
        // If an enemy is on this tile and it's our target — attacking happens
        // by moving into it, so allow the move (player.move handles the attack).
        const enemyHere = s.enemies?.some(e => e.hp > 0 && e.x === nx && e.y === ny);
        if (WALKABLE_TILES.has(tile) || (enemyHere && nx === tx && ny === ty)) {
            try { p.move(dx, dy); } catch(e) { err('directMove', e); }
            return true;
        }
    }
    return false;
}

// ── Robust navigation with fallback chain ─────────────────────────────────
// Tries A* → greedy direct → wander. The key insight: p.move() returns nothing
// and silently no-ops on a wall/blocked tile, so we can't trust that calling it
// actually moved us. We check the player's position before and after each tier;
// if it didn't change, that tier FAILED and we fall through to the next one in
// the SAME tick rather than wasting a turn. This is deterministic (no Date.now
// blacklist that breaks seed reproducibility) and self-correcting every tick.
let _wanderLast = '';
function navigate(tx, ty) {
    const p = pp(); if (!p) return false;
    const s = gs();
    const ox = p.x, oy = p.y;
    const moved = () => (p.x !== ox || p.y !== oy);
    // Snapshot total enemy HP so we can detect "attacked instead of moved" — when
    // the A* first step lands on an enemy tile, p.move() attacks rather than
    // moving, so position is unchanged but real progress (damage) happened.
    const enemyHpBefore = (s?.enemies||[]).reduce((sum,e)=> sum + (e.hp>0?e.hp:0), 0);
    const progressed = () => {
        if (moved()) return true;
        const after = (gs()?.enemies||[]).reduce((sum,e)=> sum + (e.hp>0?e.hp:0), 0);
        return after < enemyHpBefore; // dealt damage = attacked = progress
    };

    // 1. A* path — progress = moved OR attacked. Reset stall timer either way.
    if (stepTo(tx, ty) && progressed()) { _runTickCount = 0; return true; }
    // 2. Greedy direct step
    if (stepDirectlyToward(tx, ty) && progressed()) { _runTickCount = 0; return true; }
    // 3. Wander — flailing, NOT progress. Do NOT reset _runTickCount, so a bot
    //    bouncing near an unreachable target still trips the stall timer and
    //    gets force-restarted instead of looping forever.
    return forceWander();
}

// Blind one-tile shift in any valid direction. Used both as navigate()'s last
// resort and called directly by the stuck-mitigation escalation so a wedged bot
// can break free instantly instead of waiting another maxStuck cycle.
function forceWander() {
    const s = gs(), p = pp(); if (!s?.dungeon || !p) return false;
    const ox = p.x, oy = p.y;
    // Deterministic direction rotation seeded by position + floor. Avoids two
    // problems with the old `.sort(() => rng()-0.5)` approach: (1) sorting with
    // an inconsistent comparator is undefined behaviour and biased, and (2) a
    // random shuffle can re-pick the same bad direction and oscillate. A pure
    // coordinate-based rotation is reproducible (good for seeded replays) and
    // guarantees the bot tries directions in a varying-but-stable order.
    const seed = ((p.x * 31 + p.y * 17 + (s.floor||0)) % 4 + 4) % 4;
    const base = [[0,-1],[0,1],[-1,0],[1,0]];
    const dirs = [...base.slice(seed), ...base.slice(0, seed)];
    for (const [dx,dy] of dirs) {
        const nx=p.x+dx, ny=p.y+dy;
        const tile = s.dungeon?.[ny]?.[nx];
        if (!WALKABLE_TILES.has(tile)) continue;
        if (isKnownTrap(nx,ny)) continue;
        if ((s.enemies||[]).some(e=>e.hp>0 && e.x===nx && e.y===ny)) continue;
        if (`${nx},${ny}` === _wanderLast) continue; // don't immediately backtrack
        _wanderLast = `${p.x},${p.y}`;
        try { p.move(dx,dy); } catch(e){ err('wander',e); }
        if (p.x !== ox || p.y !== oy) return true; // only success if we actually moved
    }
    return false;
}

// ── Close everything ──────────────────────────────────────────────────────
function closeAll() {
    // ESC key
    try { document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); } catch(_){}
    // Direct close button clicks
    ['gambling-close-btn','shop-close-btn','inn-close-btn','blacksmith-close-btn',
     'bank-close-btn','trainer-close-btn','magic-close-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) try { el.click(); } catch(_) {}
    });
    // generic close buttons inside open panels
    document.querySelectorAll('.hub-panel-inner button[onclick*="close"], .hub-panel-inner button[onclick*="Close"]').forEach(b => {
        try { b.click(); } catch(_) {}
    });
}

// ── Scan map for tile types ───────────────────────────────────────────────
function findTile(type) {
    const s = gs(); if (!s?.dungeon) return null;
    for (let y=0; y<s.dungeon.length; y++) {
        for (let x=0; x<(s.dungeon[y]?.length||0); x++) {
            if (s.dungeon[y][x] === type && s.revealed?.[y]?.[x]) return {x,y};
        }
    }
    return null;
}

function findTileAny(...types) {
    for (const t of types) { const r = findTile(t); if (r) return r; }
    return null;
}

function nearestEnemy() {
    const s=gs(), p=pp(); if (!s?.enemies||!p) return null;
    let best=null, bd=999;
    for (const e of s.enemies) {
        if (e.hp<=0) continue;
        if (!s.revealed?.[e.y]?.[e.x]) continue;
        const d = Math.abs(e.x-p.x)+Math.abs(e.y-p.y);
        // Return the LIVE enemy object, never a spread copy. Attacking a copy
        // damages the copy's hp field, not the real enemy in gameState.enemies,
        // so the enemy never dies and the bot loops forever (the "phantom-attack
        // freeze"). Stash the distance on the live object instead.
        if (d<bd) { bd=d; best=e; }
    }
    if (best) best._botDist = bd;
    return best;
}

// Items we've tried and failed to reach this floor — don't keep retrying them
// (cleared on floor change in decide()). Prevents the bot looping forever on a
// visible-but-walled-off item, which kept resetting the stall timer via wander.
let _unreachableItems = new Set();
// Same idea for enemies: an enemy with no reachable cardinal approach tile gets
// blacklisted so bestTarget() skips it and the bot explores past instead of
// trying to "attack through the wall" forever. Cleared on floor change and
// periodically (the bot's own movement may open a new approach route).
let _unreachableEnemies = new Set();
// Per-enemy count of how many times we've blacklisted it as unreachable this
// floor. An enemy that keeps coming back as unreachable is genuinely walled off
// (not just a patrol that wandered out of reach), so we let it "graduate" to a
// sticky blacklist that survives the periodic clear — otherwise the bot is
// pulled back to re-attempt it every 40 ticks and never commits to the exit.
let _unreachableStrikes = {};
const _STICKY_UNREACHABLE_AT = 3; // strikes before an enemy is permanently skipped this floor

function nearestItem() {
    const s=gs(), p=pp(); if (!s?.items||!p) return null;
    const arenaUnlocked = typeof isArenaUnlocked === 'function' ? isArenaUnlocked() : false;
    const hasUnidentified = [...(p.inventory||[]), ...Object.values(p.equipment||{})]
        .some(i => i && i.identified === false);

    let best=null, bestScore=-Infinity;
    for (const it of s.items) {
        if (!s.revealed?.[it.y]?.[it.x]) continue;
        const itemKey = `${it.x},${it.y}`;
        if (_unreachableItems.has(itemKey)) continue; // already gave up on this one
        const dist = Math.abs(it.x-p.x)+Math.abs(it.y-p.y);
        if (dist > 8) continue; // don't detour more than 8 tiles for an item

        let score = 10 - dist; // base score favours closer items

        if (it.type === 'potion')   score += hpFrac() < 0.7 ? 20 : 5;
        if (it.type === 'antidote') score += (hasStatusSafe(p,'poison')||hasStatusSafe(p,'burn')) ? 25 : 8;
        if (it.type === 'rageDraught' || it.type === 'smokeBomb') score += 8;
        if (it.type === 'captureCage') score += arenaUnlocked ? 6 : -20;
        if (it.type === 'identifyScroll') score += hasUnidentified ? 8 : -10;
        if (it.type === 'gold') score += 12;
        if (it.type === 'equipment') score += 10;
        if (it.type === 'relic')     score += 15;
        if (it.type === 'mimic_chest') score -= 50;

        if (score > bestScore) { bestScore = score; best = {...it, dist}; }
    }
    if (!best || bestScore <= 0) return null;
    // Reachability gate: confirm A* can actually path to it. If not, blacklist
    // it for this floor so the bot moves on instead of wandering at it forever.
    const path = bfs(p.x, p.y, best.x, best.y);
    if (!path) {
        _unreachableItems.add(`${best.x},${best.y}`);
        return nearestItem(); // retry — pick the next-best reachable item
    }
    best.dist = path.length; // use true path distance, not Manhattan
    return best;
}

// Check if an enemy occupies a tile (for evasion pathing)
function enemyAt(x, y, s) {
    return (s?.enemies||[]).some(e => e.hp > 0 && e.x===x && e.y===y);
}

// Pre-allocated flood-fill buffers for nearestUnexplored — created ONCE,
// reused every call (same pattern as the A* buffers). The old version
// allocated a fresh Uint8Array + an array of {x,y,dist} objects on every
// call and used queue.shift() (O(n) dequeue), creating real GC pressure
// during exploration. A flat typed-array ring buffer with head/tail indices
// eliminates both the allocation and the O(n) shift.
const _exploreVisited   = new Uint8Array(BFS_MAX);
const _exploreQueueX    = new Int16Array(BFS_MAX);
const _exploreQueueY    = new Int16Array(BFS_MAX);
const _exploreQueueDist = new Int16Array(BFS_MAX);

function nearestUnexplored() {
    const s=gs(), p=pp(); if (!s?.dungeon||!p) return null;
    const dirs=[[0,-1],[0,1],[-1,0],[1,0]];
    const H=s.dungeon.length, W=s.dungeon[0]?.length||25;
    const size = W * H;
    // Safety: if the map somehow exceeds our buffers, bail rather than corrupt.
    if (size > BFS_MAX) return null;

    // BFS flood-fill from the player through REVEALED walkable tiles only.
    // When we find a revealed walkable tile that borders an unrevealed tile,
    // that revealed tile is our target — NOT the unrevealed tile itself.
    // Targeting the unrevealed tile was a subtle bug: its walkability is
    // unknown, so A* to it could fail if it turns out to be a wall. The
    // revealed approach tile is guaranteed reachable (we just flood-filled to
    // it) and stepping onto it reveals the neighbour for free.
    _exploreVisited.fill(0, 0, size);
    let qHead = 0, qTail = 0;
    _exploreQueueX[qTail] = p.x;
    _exploreQueueY[qTail] = p.y;
    _exploreQueueDist[qTail] = 0;
    qTail++;
    _exploreVisited[p.y * W + p.x] = 1;
    let best = null, bestDist = Infinity;

    while (qHead < qTail) {
        const x = _exploreQueueX[qHead];
        const y = _exploreQueueY[qHead];
        const dist = _exploreQueueDist[qHead];
        qHead++;
        if (dist > bestDist + 8) break; // don't look far past the first frontier found

        // Does this revealed tile border an unrevealed walkable-looking tile?
        let bordersUnrevealed = false;
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const tile = s.dungeon[ny]?.[nx];
            if (tile === 1) continue; // wall neighbour — not a frontier
            if (!s.revealed?.[ny]?.[nx]) { bordersUnrevealed = true; break; }
        }
        if (bordersUnrevealed && dist < bestDist && !(x===p.x && y===p.y)) {
            bestDist = dist; best = { x, y };
        }

        // Expand through revealed walkable neighbours
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const k = ny * W + nx;
            if (_exploreVisited[k]) continue;
            _exploreVisited[k] = 1;
            const tile = s.dungeon[ny]?.[nx];
            if (tile === 1) continue;
            if (!s.revealed?.[ny]?.[nx]) continue; // can't walk through unrevealed
            if (WALKABLE_TILES.has(tile) && qTail < BFS_MAX) {
                _exploreQueueX[qTail] = nx;
                _exploreQueueY[qTail] = ny;
                _exploreQueueDist[qTail] = dist + 1;
                qTail++;
            }
        }
    }
    return best;
}

// ── Level-up handler ──────────────────────────────────────────────────────
function handleLevelUp() {
    const buttons = [...document.querySelectorAll('#levelup-options button, .levelup-choice-btn')];
    if (!buttons.length) {
        // Fallback: send key '1' to pick the first option
        try { document.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true})); } catch(_) {}
        return;
    }
    // Priority: HP stat upgrade > ATK stat upgrade > anything else
    // Scan both the label text AND description text, since labels like
    // "Resilience", "Iron Skin", "Fortitude" are HP upgrades but won't
    // match /hp|health/ without also checking the description.
    const score = btn => {
        const text = (btn.textContent || '').toLowerCase();
        if (/\+\d+.*max\s*hp|max\s*hp|\+.*hp|vitality|resilience|fortitude|iron skin|toughness|endurance/i.test(text)) return 3;
        if (/\+\d+.*atk|attack|strength|damage|power|ferocity|brutality/i.test(text)) return 2;
        if (/def|armor|armour|block|shield|ward|barrier/i.test(text)) return 1;
        return 0;
    };
    const pick = buttons.reduce((best, btn) => score(btn) > score(best) ? btn : best, buttons[0]);
    try { pick.click(); } catch(_) {}
}

// ── Tavern sequence ───────────────────────────────────────────────────────
// Runs a prioritized checklist: bank → rest → shop → upgrade → arena → dungeon

const TAVERN_STEPS = [
    // 0: bank gold
    (s, p) => {
        if (p.gold <= CFG.bankAt) return false;
        goal('Banking gold...');
        const bank = s.bank;
        if (!bank) return false;
        if (!adj(p.x,p.y,bank.x,bank.y)) { stepTo(bank.x,bank.y); return true; }
        if (!s.bankOpen) { try { openBank?.(); } catch(_) {} return true; }
        try { bankDepositAll?.(); log('Deposited gold','shop'); } catch(_) {}
        closeAll(); return true;
    },
    // 1: rest at inn if hurt
    (s, p) => {
        if (p.hp >= p.maxHp * CFG.restAt) return false;
        // If short on cash but we have banked gold, withdraw it first so the
        // bot can actually afford to rest instead of looping back into the
        // dungeon hurt and broke.
        if (p.gold < 25) {
            const banked = (s.tavernUpgrades?.bankGold) || 0;
            if (banked >= 25 && typeof bankWithdraw === 'function') {
                try { bankWithdraw('all'); log('Withdrew banked gold to rest', 'shop'); } catch(_) {}
            }
            if (p.gold < 25) return false; // still broke — can't rest, move on
        }
        goal('Resting at inn...');
        const inn = s.innkeeper;
        if (!inn) return false;
        if (!adj(p.x,p.y,inn.x,inn.y)) { stepTo(inn.x,inn.y); return true; }
        if (!s.innOpen) { try { openInnkeeper?.(); } catch(_) {} return true; }
        try { buyInnRest?.(); log('Rested at inn','heal'); } catch(_) {}
        closeAll(); return true;
    },

    // 1b: visit Town (Bravehold) for temple and alchemist services.
    // These services are only in town, not the tavern, and aren't replicated
    // by the merchant. The bot teleports to town, buys what it needs, and
    // returns — no grid navigation required since the panels open directly.
    (s, p) => {
        // Only visit town every other tavern trip (not worth it if we have nothing to buy)
        const potCount = (p.inventory||[]).filter(i=>i.type==='potion').reduce((n,i)=>n+(i.qty||1),0);
        const needsTemple   = (p.hp < p.maxHp * 0.6) && p.gold >= 40 + CFG.shopBuffer;
        const needsAlchemist = potCount >= 3 && p.gold >= 90 + CFG.shopBuffer; // upgrade pots → Greater Potion
        const needsElixir   = p.gold >= 90 + CFG.shopBuffer && p.level >= CFG.elixirMinLevel;   // +3 ATK from alchemist
        if (!needsTemple && !needsAlchemist && !needsElixir) return false;

        goal('Visiting Bravehold...');
        // Teleport to town zone if not already there
        if (!s.inTown) {
            try { enterWorldZone?.(2, 1, 'east'); } catch(e) { err('enter town', e); }
            return true; // wait one tick for the zone to load
        }

        // Temple: Full Restoration (40g) when hurt
        if (needsTemple && !s.townTempleOpen) {
            try {
                openTownTemple?.();
                townTempleAct?.('heal', 40);
                log('Temple: full restoration (40g)', 'heal');
            } catch(e) { err('temple heal', e); }
            try { closeTownPanel?.('temple'); } catch(_) {}
            return true;
        }

        // Alchemist: Elixir of Might (+3 ATK, 90g) once per session when rich.
        // Use window._bot (defined at IIFE end) with a guard so this never
        // throws a ReferenceError if the step somehow runs before assignment.
        if (needsElixir && !s.townAlchemistOpen && !(window._bot && window._bot._boughtElixir)) {
            try {
                openTownAlchemist?.();
                townAlchemistAct?.('elixir');
                log('Alchemist: Elixir of Might +3 ATK (90g)', 'shop');
                if (window._bot) window._bot._boughtElixir = true; // don't spam every visit
            } catch(e) { err('alchemist elixir', e); }
            try { closeTownPanel?.('alchemist'); } catch(_) {}
            return true;
        }

        // Alchemist: upgrade 3 potions → 1 Greater Potion
        if (needsAlchemist && potCount >= CFG.alchemistPotMin && !s.townAlchemistOpen) {
            try {
                openTownAlchemist?.();
                townAlchemistAct?.('upgrade');
                log('Alchemist: upgraded 3 potions → Greater Potion', 'shop');
            } catch(e) { err('alchemist upgrade', e); }
            try { closeTownPanel?.('alchemist'); } catch(_) {}
            return true;
        }

        // Done with town — return to tavern courtyard
        goal('Returning to tavern from town...');
        try { enterWorldZone?.(2, 2, 'west'); } catch(e) { err('leave town', e); }
        return true;
    },

    // 2: buy from merchant — INTELLIGENT priority shopping
    (s, p) => {
        if (p.gold < CFG.shopBuffer + 18) return false; // can't afford even a potion
        if (shopPurchasesThisVisit >= 7) return false;   // raised from 5 → 7 to avoid leaving early
        goal('Shopping...');
        const m = s.merchant;
        if (!m) return false;
        if (!adj(p.x,p.y,m.x,m.y)) { stepTo(m.x,m.y); return true; }
        if (!s.shopOpen) { try { openShop?.(); } catch(_) {} return true; }

        const items = typeof getShopItems==='function' ? getShopItems() : [];
        const byId = id => items.find(i => i.id === id);
        const potionCount = (p.inventory||[]).filter(i=>i.type==='potion').reduce((n,i)=>n+(i.qty||1),0);
        const smokeBombs  = (p.inventory||[]).filter(i=>i.type==='smokeBomb').reduce((n,i)=>n+(i.qty||1),0);
        const rageDraughts= (p.inventory||[]).filter(i=>i.type==='rageDraught').reduce((n,i)=>n+(i.qty||1),0);
        const afford = item => item && item.cost && p.gold >= item.cost + CFG.shopBuffer;
        // Scale the gold threshold for permanent upgrades with the floor — they get
        // more expensive each floor so a flat 140g threshold leaves the bot skipping
        // upgrades it can clearly afford on deeper floors.
        const floorScaledUpgradeAt = Math.max(140, 100 + (s.floor || 0) * 12);

        let choice = null;
        let reason = '';

        // PRIORITY 1: Patch Up — instant 40% HP heal, great value when hurt
        if (!choice && hpFrac() < CFG.patchUpAt) {
            const patch = byId('heal');
            if (patch && afford(patch)) { choice = patch; reason = `patch up (${Math.round(hpFrac()*100)}% HP)`; }
        }
        // PRIORITY 2: Stock potions if dangerously low (always want >= 2)
        if (!choice && potionCount < 2 && afford(byId('potion'))) {
            choice = byId('potion'); reason = `low on potions (${potionCount})`;
        }
        // PRIORITY 3: Capture net for arena if unlocked and don't have one
        if (!choice) {
            const net = byId('captureCage');
            const hasNet = (p.inventory||[]).some(i=>i.type==='captureCage');
            if (net && !hasNet && afford(net) && p.gold > net.cost + 80) {
                choice = net; reason = 'arena capture net';
            }
        }
        // PRIORITY 4: Permanent stat upgrades when comfortably rich
        if (!choice && p.gold > floorScaledUpgradeAt) {
            const maxhp = byId('maxhp'), atk = byId('atk');
            const wantHp = p.maxHp < 80 + p.level * 12;
            if (wantHp && afford(maxhp)) { choice = maxhp; reason = 'permanent +HP'; }
            else if (afford(atk))        { choice = atk;   reason = 'permanent +ATK'; }
            else if (afford(maxhp))      { choice = maxhp; reason = 'permanent +HP'; }
        }
        // PRIORITY 5: Reroll gear if we have an empty/weak slot and spare gold
        if (!choice && p.gold > 120) {
            const reroll = byId('reroll');
            const hasEmptySlot = p.equipment && !p.equipment.weapon;
            if (reroll && hasEmptySlot && afford(reroll)) {
                choice = reroll; reason = 'fill empty gear slot';
            }
        }
        // PRIORITY 6: Top up potions, buy a smoke bomb or rage draught if very low
        if (!choice && potionCount < 4 && p.gold > 90 && afford(byId('potion'))) {
            choice = byId('potion'); reason = 'topping up potions';
        }
        if (!choice && smokeBombs < 1 && p.gold > 120 && afford(byId('smokeBomb'))) {
            choice = byId('smokeBomb'); reason = 'stock smoke bomb';
        }
        if (!choice && rageDraughts < 1 && p.gold > 130 && afford(byId('rageDraught'))) {
            choice = byId('rageDraught'); reason = 'stock rage draught';
        }
        // PRIORITY 7: Lucky charm or mystery trinket if very rich
        if (!choice && p.gold > 200) {
            const charm = byId('luckyCharm');
            if (charm && afford(charm)) { choice = charm; reason = 'lucky charm'; }
        }
        if (!choice && p.gold > 180) {
            const trinket = byId('trinket');
            if (trinket && afford(trinket)) { choice = trinket; reason = 'mystery trinket'; }
        }

        if (choice) {
            try {
                // choice.buy() handles the gold deduction internally —
                // do NOT pre-subtract or the player is charged twice (BUG-2 fix)
                choice.buy?.();
                shopPurchasesThisVisit++;
                if (typeof renderShop==='function') renderShop();
                if (typeof updateUI==='function') updateUI();
                log(`Bought ${choice.label} (${choice.cost}g) — ${reason}`, 'shop');
                return true;
            } catch(e) { err('shop buy', e); }
        }
        closeAll();
        return false;
    },
    // 2c: sell excess inventory at the merchant's sell tab.
    // The bot picks up everything within reach; after a long run the pack fills
    // with duplicate potions, old gear, and items it can't use. Selling gear in
    // the pack (never the equipped set) converts dead weight into gold.
    // Criteria for selling:
    //   - Equipment in pack (not equipped) — always sell: it's just taking a slot.
    //   - Excess potions beyond 5 stacked — sell the surplus.
    // We do one sell per visit to keep the shop tab open for re-evaluation.
    (s, p) => {
        // Find something worth selling
        const gearInPack = (p.inventory||[]).filter(i => i.type === 'equipment');
        const potionCount = (p.inventory||[]).filter(i=>i.type==='potion').reduce((n,i)=>n+(i.qty||1),0);
        const excessPotions = potionCount > 5
            ? (p.inventory||[]).filter(i => i.type === 'potion').slice(-1)
            : [];
        const toSell = gearInPack[0] || excessPotions[0];
        if (!toSell) return false; // nothing to sell

        goal('Selling excess items...');
        const m = s.merchant;
        if (!m) return false;
        if (!adj(p.x,p.y,m.x,m.y)) { stepTo(m.x,m.y); return true; }
        if (!s.shopOpen) { try { openShop?.(); } catch(_) {} return true; }
        // Switch to sell tab if not already there
        try {
            if (typeof showShopTab === 'function') showShopTab('sell');
            const value = typeof getSellValue === 'function' ? getSellValue(toSell) : '?';
            sellItem?.(toSell);
            log(`Sold ${toSell.name||'item'} for ${value}g`, 'shop');
        } catch(e) { err('sell', e); }
        closeAll(); return true;
    },
    // 2b: buy Hearthstone Coin for warrior/rogue flee system.
    // The portal system requires a coin to flee the dungeon — without pre-buying
    // one the bot can never escape from a bad floor. Buy at the innkeeper after
    // resting when we have spare gold. Casters use the Town Portal spell instead.
    (s, p) => {
        const cls = p.className || '';
        const isCaster = cls === 'mage' || cls === 'cleric';
        if (isCaster) return false;                           // casters don't need coins
        const coins = p.hearthstoneCoins || 0;
        if (coins >= 2) return false;                         // stocked up enough
        if (p.gold < CFG.hearthstoneCost + CFG.shopBuffer) return false; // can't afford
        goal('Buying Hearthstone Coin...');
        const inn = s.innkeeper;
        if (!inn) return false;
        if (!adj(p.x,p.y,inn.x,inn.y)) { stepTo(inn.x,inn.y); return true; }
        if (!s.innOpen) { try { openInnkeeper?.(); } catch(_) {} return true; }
        try {
            buyHearthstoneCoin?.();
            log(`Bought Hearthstone Coin (now ${(p.hearthstoneCoins||0)})`, 'shop');
        } catch(e) { err('hearthstone buy', e); }
        closeAll(); return true;
    },
    // 3: blacksmith weapon upgrade
    (s, p) => {
        if (p.gold < CFG.upgradeAt) return false;
        if (!p.equipment?.weapon) return false;
        const cost = 60 + p.level * 15;
        if (p.gold < cost + CFG.shopBuffer) return false;
        goal('Upgrading weapon...');
        const smith = s.blacksmith;
        if (!smith) return false;
        if (!adj(p.x,p.y,smith.x,smith.y)) { stepTo(smith.x,smith.y); return true; }
        if (!s.blacksmithOpen) { try { openBlacksmith?.(); } catch(_) {} return true; }
        try { buyBlacksmithUpgrade?.(); log(`Upgraded weapon (${cost}g)`,'shop'); } catch(_) {}
        closeAll(); return true;
    },
    // 4: trainer HP
    (s, p) => {
        const cost = 80 + p.level * 10;
        if (p.gold < cost + CFG.shopBuffer * 2) return false;
        goal('Buying HP training...');
        const trainer = s.trainer;
        if (!trainer) return false;
        if (!adj(p.x,p.y,trainer.x,trainer.y)) { stepTo(trainer.x,trainer.y); return true; }
        if (!s.trainerOpen) { try { openTrainer?.(); } catch(_) {} return true; }
        try { buyTrainerHp?.(); log(`Bought HP training (${cost}g)`,'shop'); } catch(_) {}
        closeAll(); return true;
    },
    // 5: arena
    (s, p) => {
        if (p.gold < CFG.arenaMinGold) return false;
        goal('Going to arena...');
        // Need to go through courtyard door first
        if (!s.inCourtyard) {
            const door = findTile(6); // TILE_COURTYARD_DOOR
            if (!door) return false;
            if (p.x===door.x && p.y===door.y) return true; // wait for toggleCourtyard
            stepTo(door.x, door.y); return true;
        }
        // In courtyard — walk to gate
        const gate = s.arenaGate;
        if (!gate) return false;
        if (!adj(p.x,p.y,gate.x,gate.y)) { stepTo(gate.x,gate.y); return true; }
        // Open arena
        if (!s.gamblingOpen) {
            try { handleAction?.(); } catch(_) {} return true;
        }
        // Select cheapest champion
        const champs = typeof getAvailableChampions==='function' ? getAvailableChampions() : [];
        if (!champs.length) { closeAll(); return false; }
        const c = [...champs].sort((a,b)=>(a.stars||0)-(b.stars||0))[0];
        // BUG-3 fix: two-tick state machine replaces setTimeout.
        // Old: select → return → 350ms setTimeout → confirm
        // Race: tick fires again 120ms later, calls selectArenaBout() a second time.
        // New: tick 1 = select + set flag, tick 2 = confirm + clear flag.
        if (!_arenaPendingConfirm) {
            try {
                selectArenaBout?.(c.id,'champion');
                const bi = document.getElementById('arena-bet-input');
                if (bi) bi.value = 0;
                _arenaPendingConfirm = true;
            } catch(e) { err('arena select',e); closeAll(); }
            return true;
        }
        // Second tick: confirm
        try {
            confirmArenaBout?.();
            stats.arenaFights = (stats.arenaFights||0)+1;
            log(`Arena: fighting ${c.name}`,'arena');
        } catch(e) { err('arena confirm',e); closeAll(); }
        _arenaPendingConfirm = false;
        return true;
    },
    // 6: enter dungeon
    (s, p) => {
        goal('Heading to dungeon...');
        // Find the dungeon entrance NPC position or look for tile type 2 on floor 0
        const entrance = s.dungeonEntrance;
        let ex=12, ey=14; // fallback position from data.js
        if (entrance) { ex=entrance.x; ey=entrance.y; }
        if (adj(p.x,p.y,ex,ey)) {
            stats.runs++;
            log(`Run #${stats.runs} — descending`,'run');
            shopPurchasesThisVisit = 0;
            try { descendFloor?.(); } catch(e) { err('descendFloor',e); }
            return true;
        }
        stepTo(ex,ey); return true;
    },
];

let tavernStep = 0;
let shopPurchasesThisVisit = 0;  // reset each time bot enters the dungeon

function decideTavern() {
    const s=gs(), p=pp(); if (!s||!p) return;
    // Run each step — if one says it did something, stop
    for (let i=0; i<TAVERN_STEPS.length; i++) {
        try { if (TAVERN_STEPS[i](s,p)) return; } catch(e) { err(`tavern step ${i}`,e); }
    }
}

// ── Arena bout handler ────────────────────────────────────────────────────
// Arena bouts are 1v1 and bounded, but a bad geometry (e.g. cage tile) could
// leave the bot unable to reach its opponent. Track position so we can forfeit
// instead of standing frozen until the global stall timer fires.
let _boutStuckPos = '';
let _boutStuckTicks = 0;

function handleBout() {
    const s=gs(), p=pp(); if (!s||!p) return;
    if (hpFrac() < 0.5 && p.mana >= 4 && p.className==='cleric') {
        try { p.useAbility?.(); } catch(_) {}
        return;
    }
    if (hpFrac() < CFG.healAt) {
        const hasPot = p.inventory?.some(i=>i.type==='potion'&&i.qty>0);
        if (hasPot) { try { usePotion?.(); } catch(_) {} return; }
    }
    if (hpFrac() < 0.1) {
        try { forfeitArenaBout?.(); closeAll(); } catch(_) {}
        return;
    }
    const e = s.enemies?.[0];
    if (e && e.hp > 0) {
        // Stuck detection — if we haven't moved AND haven't dealt damage for
        // several ticks, the opponent is unreachable. Forfeit rather than freeze.
        const posKey = `${p.x},${p.y},${e.hp}`;
        if (posKey === _boutStuckPos) {
            if (++_boutStuckTicks >= 20) {
                log('Arena opponent unreachable — forfeiting', 'warn');
                _boutStuckTicks = 0; _boutStuckPos = '';
                try { forfeitArenaBout?.(); closeAll(); } catch(_) {}
                return;
            }
        } else { _boutStuckPos = posKey; _boutStuckTicks = 0; }

        if (Math.abs(e.x-p.x)+Math.abs(e.y-p.y) === 1) {
            try { p.attack(e); } catch(_) {}
        } else {
            const slot = bestApproachTile(e.x, e.y);
            if (slot && !(p.x===slot.x && p.y===slot.y)) {
                if (!stepTo(slot.x, slot.y)) stepDirectlyToward(e.x, e.y);
            } else {
                stepDirectlyToward(e.x, e.y);
            }
        }
    }
}

// ── Status & ability helpers ──────────────────────────────────────────────
function hasStatusSafe(target, type) {
    try {
        if (typeof hasStatus === 'function') return hasStatus(target, type);
    } catch(_) {}
    return !!target?.statuses?.some(st => st.type === type && st.turns > 0);
}

// Decide whether to fire the subclass's offensive ability this turn.
// Each class's signature move is the whole point of measuring its strength,
// so the bot should use it whenever it has resources and a target — but not
// waste it (e.g. melee abilities need an adjacent enemy; AoE wants a cluster).
function shouldUseOffensiveAbility(p, nearbyCount) {
    const sub = p.subclass || '';
    const cls = p.className || '';

    // Ability spam circuit breaker — if the same ability has fired > 15 times
    // consecutively with no attack, movement, or floor change in between, ban
    // it for the rest of the run. This catches any ability that loops without
    // consuming a turn (e.g. illusionist placing a decoy that already exists,
    // shadow step with no valid destination, trickster with no trap charges).
    if (_abilityBanned) return false;

    // Healing-focused clerics are handled separately (used to heal, not attack)
    if (cls === 'cleric' && (sub === 'lightDomain' || sub === 'twilightDomain' || sub === '')) {
        return false;
    }

    // Knight: Shield Wall is DEFENSIVE — raised once per fight then auto-blocks.
    if (sub === 'knight') return false;

    // Trickster: trap-setting under yourself does nothing useful.
    if (sub === 'trickster') return false;

    // Illusionist: decoy + mirror image buff. Don't re-cast while both are
    // already active — the ability overwrites itself and wastes mana every tick.
    // Re-cast only when the decoy has expired (null) or mirror image has run out.
    if (sub === 'illusionist') {
        const s = gs();
        const decoyActive   = !!(s?.decoy && s.decoy.turns > 0);
        const mirrorActive  = (p.mirrorImageTurns || 0) > 0;
        if (decoyActive && mirrorActive) return false; // already buffed
    }

    // Mana-gated casters: only if enough mana
    const manaNeed = { mage:4, elementalist:3, shadow:4, illusionist:4,
                       necromancer:4, lightDomain:4, twilightDomain:3, warDomain:3 };
    const need = manaNeed[sub] ?? manaNeed[cls] ?? 0;
    if (need > 0 && (p.mana||0) < need) return false;

    // Shadow: step when it meaningfully closes distance (2-4 tiles away).
    // CRITICAL: also require NO adjacent enemy. With 2+ enemies, the bot would
    // shadow-step to enemy A (now adjacent), see enemy B at dist 2-4, step to B,
    // see A at dist 2-4, step back — infinite bounce between enemies.
    // If something is already adjacent, attack it instead.
    if (sub === 'shadow') {
        const s = gs(); if (!s?.enemies) return false;
        if ((p.mana||0) < 4) return false;
        const hasAdjacent = s.enemies.some(e => e.hp > 0 &&
            Math.abs(e.x-p.x)+Math.abs(e.y-p.y) <= 1);
        if (hasAdjacent) return false; // attack the adjacent enemy, don't teleport
        const target = s.enemies.find(e => e.hp > 0 &&
            Math.abs(e.x-p.x)+Math.abs(e.y-p.y) >= 2 &&
            Math.abs(e.x-p.x)+Math.abs(e.y-p.y) <= 4 &&
            s.revealed?.[e.y]?.[e.x]);
        return !!target;
    }

    // Melee abilities need an adjacent enemy
    const meleeAbilities = ['berserker','assassin','warDomain','gladiator','twilightDomain'];
    if (meleeAbilities.includes(sub)) {
        if (sub === 'berserker') return hpFrac() > CFG.berserkerMinHp && enemiesNear(1).length >= 1;
        // Gladiator's Riposte sets a counter stance that triggers on the NEXT
        // incoming hit. If the stance is already primed (riposteReady===true),
        // re-casting it wastes a full turn. Let the bot attack normally so the
        // enemy's counterattack triggers the waiting riposte instead.
        if (sub === 'gladiator') return enemiesNear(1).length >= 1 && !(p.sc?.riposteReady);
        return enemiesNear(1).length >= 1;
    }

    // Ranged/AoE casters — fire if any enemy is in sight
    return nearbyCount >= 1;
}

// ── Inventory helpers ─────────────────────────────────────────────────────
function invCount(type) {
    const p = pp(); if (!p?.inventory) return 0;
    return p.inventory.filter(i => i.type === type).reduce((n,i) => n + (i.qty||1), 0);
}
function hasItem(type) { return invCount(type) > 0; }

// Count living, visible enemies within `range` tiles of the player
function enemiesNear(range) {
    const s = gs(), p = pp(); if (!s?.enemies || !p) return [];
    return s.enemies.filter(e => e.hp > 0 && s.revealed?.[e.y]?.[e.x] &&
        Math.abs(e.x-p.x)+Math.abs(e.y-p.y) <= range);
}

// Is a boss visible on the floor?
function bossVisible() {
    const s = gs(); if (!s?.enemies) return null;
    return s.enemies.find(e => e.hp > 0 && (e.type === 'boss' || e.bossVariant) && s.revealed?.[e.y]?.[e.x]) || null;
}

// Threat-weighted target selection. Score = damage potential, weighted so
// ranged enemies (which hit from afar every turn) and low-HP enemies (quick
// kills that reduce incoming damage) are prioritized over a tanky melee.
//
// Performance: BFS-per-enemy is expensive (bestApproachTile runs up to 4 BFS
// each). To keep turbo speed snappy we first compute a cheap Manhattan-based
// pre-score for every enemy, sort by it, and only run the real reachability
// BFS on the most promising candidates (the closest/highest-threat handful).
// This caps BFS calls at ~MAX_BFS_CANDIDATES per tick regardless of pack size.
const MAX_BFS_CANDIDATES = 5;

function bestTarget() {
    const s = gs(), p = pp(); if (!s?.enemies || !p) return null;

    // ── Pass 1: cheap pre-score by Manhattan distance + threat ──────────────
    const candidates = [];
    for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        if (!s.revealed?.[e.y]?.[e.x]) continue;
        if (_unreachableEnemies.has(`${e.x},${e.y}`)) continue; // gave up (walled)
        // Permanently skip enemies that have proven repeatedly unreachable this
        // floor — they're genuinely walled, and re-targeting them is the stall
        // loop we're fixing. Identity-keyed so it survives the periodic clear.
        const _ek = e.id || `${e.type}@${e.x},${e.y}`;
        if ((_unreachableStrikes[_ek] || 0) >= _STICKY_UNREACHABLE_AT) continue;
        const eType = (typeof ENEMY_TYPES!=='undefined' && ENEMY_TYPES[e.type]) || {};
        const range = e.range || eType.range || 1;
        const atk   = e.atk   || eType.atk   || 5;
        const manhattan = Math.abs(e.x-p.x) + Math.abs(e.y-p.y);
        // Pre-score mirrors the real score's cheap terms so the sort surfaces
        // genuinely promising targets to the expensive second pass.
        const myDmg = Math.max(1, p.atk - (e.def||0));
        let pre = atk * 3 - manhattan * 2 - Math.ceil(e.hp/myDmg) * 4;
        if (range >= 3) pre += 25;
        if (e.hp <= myDmg) pre += 50;
        candidates.push({ e, range, atk, manhattan, pre });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.pre - a.pre);

    // ── Pass 2: real reachability BFS, only on the top candidates ───────────
    let best = null, bestScore = -Infinity, bestDist = 0;
    const limit = Math.min(candidates.length, MAX_BFS_CANDIDATES);
    for (let i = 0; i < limit; i++) {
        const { e, range, atk } = candidates[i];
        let pathLen;
        const approach = bestApproachTile(e.x, e.y);
        if (approach && p.x === approach.x && p.y === approach.y) {
            pathLen = 1; // already standing on an attack tile
        } else if (approach) {
            const path = bfs(p.x, p.y, approach.x, approach.y);
            pathLen = path ? path.length : null;
        } else {
            pathLen = null; // no reachable tile adjacent to the enemy
        }
        if (pathLen === null) {
            if (range < 2) continue;       // melee through a wall — ignore it
            pathLen = Math.abs(e.x-p.x) + Math.abs(e.y-p.y); // fallback for ranged
        }

        const myDmg = Math.max(1, p.atk - (e.def||0));
        const hitsToKill = Math.ceil(e.hp / myDmg);
        let score = 0;
        score += atk * 3;                       // threat: how hard it hits
        if (range >= 3) score += 25;            // ranged enemies are priority
        score -= hitsToKill * 4;                // prefer things we can kill fast
        score -= pathLen * 2;                   // prefer closer BY REAL PATH, not Manhattan
        if (e.hp <= myDmg) score += 50;         // can one-shot it this turn
        if (e.type === 'ghoul')       score += 20;
        if (e.type === 'cultist')     score += 15;
        if (e.type === 'necromancer') score += 25;
        if (e.type === 'archer')      score += 12;
        if (e.type === 'thief')       score += 8;
        // Keep the REAL enemy reference (never a spread copy — that caused the
        // phantom-attack freeze). Stash path distance AND the computed approach
        // tile on the live object so decideDungeon's combat step can reuse the
        // approach instead of running bestApproachTile (≤4 more BFS) a 2nd time.
        if (score > bestScore) {
            bestScore = score; best = e; bestDist = pathLen;
            best._cachedApproach = approach || null;
        }
    }
    if (best) best._botDist = bestDist;
    return best;
}

// ── Dungeon turn ──────────────────────────────────────────────────────────
function decideDungeon() {
    const s=gs(), p=pp(); if (!s||!p) return;

    // ── Stair-landing guard ──────────────────────────────────────────────
    // When descendFloor() places the player at (SPAWN_X, SPAWN_Y) = (2,2),
    // the dungeon generator has already placed TILE_ASCEND (type 4) there.
    // checkInteractions() fires every time the player moves onto a tile, so
    // the very first move after descending triggers ascendFloor() — sending
    // the bot straight back up. Fix: if we're standing on the ascend stairs,
    // step off it in any valid direction before doing anything else.
    // This must be the FIRST check in decideDungeon before any other logic.
    const spawnTile = s.dungeon?.[p.y]?.[p.x];
    if (spawnTile === 4) { // TILE_ASCEND
        const dirs = [[1,0],[0,1],[-1,0],[0,-1]];
        for (const [dx,dy] of dirs) {
            const nx=p.x+dx, ny=p.y+dy;
            const t = s.dungeon?.[ny]?.[nx];
            if (WALKABLE_TILES.has(t) && !(s.enemies||[]).some(e=>e.hp>0&&e.x===nx&&e.y===ny)) {
                try { p.move(dx,dy); } catch(_) {}
                return;
            }
        }
    }

    const frac = hpFrac();
    const adjacentEnemies = enemiesNear(1).length;
    const closeEnemies    = enemiesNear(3).length;

    // ── Floor grind escape valve ──────────────────────────────────────────
    // If we've spent more than 30% of the per-floor tick budget here, we're
    // probably caught in an endless-summon grind (necromancer raising 3 skeletons,
    // bot kills them, it raises 3 more — forever). Reveal the map so the exit
    // is always findable, then beeline for it. 30% fires well before the hard
    // cap (2500 ticks) and well before the batch-breaking 2500-tick timeout.
    // Only kicks in when healthy enough to disengage.
    if (_floorTickCount > MAX_FLOOR_TICKS * 0.30 && frac > 0.35) {
        // Reveal first so we can path to the exit even if it's unexplored.
        try { revealAll?.(); } catch(_) {}
        const exitEsc = findTileAny(2);
        if (exitEsc) {
            const onExit = (p.x === exitEsc.x && p.y === exitEsc.y);
            if (onExit) {
                goal(`Escaping grind — descending (F${s.floor})`);
                try { tryStairsInteraction?.(); } catch(_) {}
                return;
            }
            // If we've been trying to escape for a long stretch (75% of budget)
            // and STILL haven't reached the exit, the exit is effectively
            // unreachable (blocked chokepoint, enemy wall). Stop burning the
            // remaining budget and end the run now through the normal timeout
            // path — the diagnostic above will correctly attribute it.
            if (_floorTickCount > MAX_FLOOR_TICKS * 0.75) {
                _floorTickCount = MAX_FLOOR_TICKS; // trip the hard budget next check
            } else {
                goal(`Escaping grind — heading to exit (F${s.floor})`);
                navigate(exitEsc.x, exitEsc.y);
                return;
            }
        }
    }

    // ── 0. Intent-aware evasion — read enemy telegraphs and react ──
    // The intent system in combat.js already predicts what each enemy will do
    // next turn. The bot reads this and takes evasive action BEFORE the hit.
    if (closeEnemies >= 1 && typeof predictEnemyIntent === 'function') {
        for (const enemy of (s.enemies || [])) {
            if (enemy.hp <= 0 || !s.revealed?.[enemy.y]?.[enemy.x]) continue;
            const dist = Math.abs(enemy.x-p.x) + Math.abs(enemy.y-p.y);
            if (dist > CFG.intentScanRange) continue;
            let intent;
            try { intent = predictEnemyIntent(enemy); } catch(_) { continue; }
            if (!intent) continue;

            // Telegraphed heavy attacks. Two distinct cases:
            //
            //   BRUTE "Wind Up" → "Slam": a stationary heavy melee hit on an
            //   adjacent target. Dodging away just makes the brute re-approach
            //   and re-telegraph — the infinite 3,2↔4,2 loop. The correct play
            //   is to ATTACK it (race its HP down) or step OUT of melee range
            //   entirely if we're too hurt, not to sidestep by one tile.
            //
            //   ORC "Wind Up" → "CHARGE": a linear dash through the player's
            //   tile. Stepping one tile perpendicular dodges the full damage,
            //   and this genuinely works because the orc commits to the lane.
            //
            // We distinguish by enemy.type so each gets the right response.
            const isLinearCharge = (enemy.type === 'orc') &&
                (intent.label === 'CHARGE' || intent.label === 'Wind Up');
            const isHeavyMelee = (enemy.type === 'brute') &&
                (intent.label === 'Slam' || intent.label === 'Wind Up');

            if (isHeavyMelee) {
                // Brute telegraph. If adjacent, just attack — trading blows and
                // killing it is far better than dancing. If we're badly hurt and
                // have room, the heal/flee logic below handles retreat; here we
                // simply commit to the fight by breaking out to the combat block.
                if (dist <= 1) {
                    try { p.attack(enemy); } catch(e) { err('brute-engage', e); }
                    return;
                }
                // Not adjacent yet — let normal pathing close on it. Don't dodge.
                break;
            }

            if (isLinearCharge) {
                // Anti-oscillation: an orc can hold its wind-up across turns.
                // After MAX_DODGES consecutive sidesteps, stop and engage.
                if (_dodgeCount >= MAX_DODGES) {
                    if (dist <= 1) {
                        log(`Done dodging ${enemy.name} — engaging`, 'warn');
                        _dodgeCount = 0; _dodgeHistory = [];
                        try { p.attack(enemy); } catch(e) { err('dodge-engage', e); }
                        return;
                    }
                    _dodgeCount = 0; _dodgeHistory = [];
                    break; // close the distance via normal pathing
                }

                const dx = p.x - enemy.x, dy = p.y - enemy.y;
                // Step perpendicular to the charge axis.
                const candidates = Math.abs(dx) >= Math.abs(dy)
                    ? [{x:p.x, y:p.y-1}, {x:p.x, y:p.y+1}]
                    : [{x:p.x-1, y:p.y}, {x:p.x+1, y:p.y}];
                for (const c of candidates) {
                    const ckey = `${c.x},${c.y}`;
                    if (_dodgeHistory.includes(ckey)) continue; // no A↔B bounce
                    if (s.dungeon?.[c.y]?.[c.x] === 0 && !enemyAt(c.x, c.y, s) && !isKnownTrap(c.x, c.y)) {
                        log(`Dodging ${enemy.name} charge → (${c.x},${c.y})`, 'warn');
                        _dodgeHistory.push(`${p.x},${p.y}`);
                        if (_dodgeHistory.length > 4) _dodgeHistory.shift();
                        _dodgeCount++;
                        try { movePlayer?.(c.x-p.x, c.y-p.y); } catch(_) { stepTo(c.x, c.y); }
                        return;
                    }
                }
                // No fresh perpendicular tile — engage instead of freezing.
                if (dist <= 1) {
                    _dodgeCount = 0; _dodgeHistory = [];
                    try { p.attack(enemy); } catch(e) { err('charge-fallback-attack', e); }
                    return;
                }
            }

            // Necromancer raising dead: interrupt it immediately by making it
            // our highest-priority attack target this tick.
            if (intent.label === 'Raise Dead' && dist <= 1) {
                try { p.attack(enemy); _abilitySpamCount = 0; } catch(e) { err('interrupt-necro',e); }
                return;
            }

            // Archer drawing bow at range: step behind a wall tile if possible.
            // Even one tile of wall between us and the archer blocks the shot.
            if (intent.label === 'Draw Bow' && dist >= 2) {
                const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
                for (const [dx2,dy2] of dirs) {
                    const nx=p.x+dx2, ny=p.y+dy2;
                    if (s.dungeon?.[ny]?.[nx] !== 0) continue; // must be walkable
                    if (enemyAt(nx, ny, s)) continue;
                    if (`${nx},${ny}` === _wanderLast) continue; // don't bounce back where we came from
                    const mid = { x: Math.round((nx+enemy.x)/2), y: Math.round((ny+enemy.y)/2) };
                    if (s.dungeon?.[mid.y]?.[mid.x] === 1) {
                        log(`Dodging ${enemy.name} arrow → cover`, 'warn');
                        _wanderLast = `${p.x},${p.y}`;
                        try { movePlayer?.(dx2, dy2); } catch(_) { stepTo(nx,ny); }
                        return;
                    }
                }
                // No cover available (or only cover is where we came from) — stop
                // trying to dodge and just close on the archer to kill it. Falls
                // through to the combat block below.
            }
        }
    }

    // ── 1. Cleanse poison/burn with antidote ──
    if ((hasStatusSafe(p,'poison') || hasStatusSafe(p,'burn')) && hasItem('antidote')) {
        try { useAntidote?.(); log('Used antidote (cleansed)', 'heal'); } catch(e) { err('antidote',e); }
        return;
    }

    // ── 2. Cleric/light heal ability when hurt ──
    if (frac < CFG.abilityAt && p.mana >= 4 && _abilityOffCooldown() &&
        (p.className==='cleric'||p.subclass==='lightDomain'||p.subclass==='twilightDomain')) {
        try { p.useAbility?.(); _markAbilityUsed(); log('Used heal ability', 'heal'); } catch(e) { err('heal ability',e); }
        return;
    }

    // ── 3. Potion when hurt ──
    // Heal reactively (below threshold while in danger) OR preemptively if the
    // next incoming hit would be lethal / drop us into the panic zone.
    // Predictive check: find the highest damage any visible enemy can deal this
    // turn and heal NOW if that hit would bring HP below 25%.
    if (hasItem('potion')) {
        const inDanger = closeEnemies >= 1 || frac < CFG.panicAt;
        let healNow = frac < CFG.healAt && inDanger;
        if (!healNow && closeEnemies >= 1) {
            // Predict worst-case incoming hit from visible enemies in range
            const maxHit = (s.enemies||[]).reduce((mx, e) => {
                if (e.hp <= 0 || !s.revealed?.[e.y]?.[e.x]) return mx;
                const dist = Math.abs(e.x-p.x) + Math.abs(e.y-p.y);
                if (dist > (e.range||1)) return mx;
                return Math.max(mx, Math.max(1, (e.atk||5) - (p.def||0)));
            }, 0);
            if (maxHit > 0 && (p.hp - maxHit) < p.maxHp * 0.25) {
                healNow = true; // heal now before the fatal hit lands
            }
        }
        if (healNow) {
            try { usePotion?.(); log(`Potion (HP ${p.hp}/${p.maxHp})`,'heal'); } catch(e) { err('potion',e); }
            return;
        }
    }

    // ── 4. Smoke bomb — escape when surrounded or critically hurt ──
    // Lower threshold: 40% HP (was 50%) to save it for when it's really needed.
    if ((adjacentEnemies >= 2 || (adjacentEnemies >= 1 && frac < CFG.smokeBombAt)) && frac < 0.5 && hasItem('smokeBomb')) {
        try { useSmokeBomb?.(); log('Smoke bomb — escaping danger', 'warn'); } catch(e) { err('smoke',e); }
        return;
    }

    // ── 4b. Caster Town Portal at critically low HP — better than dying ──
    // Mage/cleric can open a portal if they have the mana and spell unlocked.
    // This acts as an emergency "flee" that actually works with the portal system.
    if (frac < CFG.panicAt && !hasItem('potion')) {
        const cls = p.className || '';
        if ((cls === 'mage' || cls === 'cleric') && (p.mana||0) >= 6 && p.level >= CFG.portalMinLevel) {
            const bankedGold2 = (s.tavernUpgrades?.bankGold) || 0;
            if (p.gold >= 25 || bankedGold2 >= 25) {
                log(`Emergency portal at ${p.hp}/${p.maxHp} HP`, 'warn');
                try { requestReturnToTavern?.(); } catch(e) { err('emergency portal',e); }
                return;
            }
        }
    }

    // ── 5. Flee to tavern — considers HP, enemy count, and exit proximity ──
    // Simple urgency score: low HP + many enemies + far exit = flee.
    // This prevents the bot fighting a boss at 26% HP when the exit is two
    // tiles away, while still letting it push through weak enemies when hurt
    // if the exit is right there.
    const bankedGold = (s.tavernUpgrades?.bankGold) || 0;
    const canRecoverInTavern = p.gold >= 25 || bankedGold >= 25;
    if (!hasItem('potion') && canRecoverInTavern) {
        const exitTile = findTileAny(2);
        const distToExit = exitTile
            ? Math.abs(exitTile.x - p.x) + Math.abs(exitTile.y - p.y)
            : 30;
        // Urgency 0..1: worse HP + more enemies + farther exit = higher urgency
        const urgency = (1 - frac) * (1 + closeEnemies * 0.25) * (distToExit > 8 ? 0.85 : 1.3);
        if (urgency > 0.75) {
            const cls = p.className || '';
            const isCaster = cls === 'mage' || cls === 'cleric';
            const canFlee = isCaster
                ? ((p.mana||0) >= 6 && p.level >= 4)
                : ((p.hearthstoneCoins||0) > 0);
            if (canFlee) {
                goal('Fleeing to tavern!');
                log(`Fleeing (urgency ${urgency.toFixed(2)}, HP ${p.hp}/${p.maxHp}, ${closeEnemies} enemies, exit ${distToExit} away)`, 'warn');
                try { requestReturnToTavern?.(); } catch(e) { err('flee', e); }
                return;
            }
            goal('Hurt but can\'t flee — fighting on');
        }
    }

    // ── 6. Rage draught before engaging a high-threat enemy (boss or dangerous elite) ──
    const boss = bossVisible();
    const dangerousElite = !boss && (s.enemies||[]).find(e => {
        if (e.hp <= 0 || !s.revealed?.[e.y]?.[e.x]) return false;
        const dist = Math.abs(e.x-p.x)+Math.abs(e.y-p.y);
        // Ghouls, orcs, dark knights, demons — high-ATK enemies worth raging for
        return dist <= CFG.eliteThreatRange && ['ghoul','orc','darkknight','demon'].includes(e.type);
    });
    const rageTrigger = boss || dangerousElite;
    if (rageTrigger && frac > CFG.rageDraughtHpMin && hasItem('rageDraught') && !hasStatusSafe(p,'rage')) {
        const dist = Math.abs(rageTrigger.x-p.x)+Math.abs(rageTrigger.y-p.y);
        if (dist <= 5) {
            try { useRageDraught?.(); log(`Rage draught — ${boss?'boss':'elite'} incoming!`, 'warn'); } catch(e) { err('rage',e); }
            return;
        }
    }

    // ── 7. Offensive subclass ability when there's a worthwhile target ──
    if (closeEnemies >= 1 && _abilityOffCooldown() && shouldUseOffensiveAbility(p, closeEnemies)) {
        _abilitySpamCount++;
        _abilityFloorCount++;
        // Two independent spam guards:
        //  (a) consecutive uses with no other action (classic spam loop), and
        //  (b) total uses on this floor (catches alternating loops where the
        //      ability is interleaved with minion-fiddling or small moves, which
        //      reset the consecutive counter but never make real progress).
        if (_abilitySpamCount >= CFG.abilitySpamBanLimit ||
            _abilityFloorCount >= ABILITY_FLOOR_LIMIT) {
            const reason = _abilityFloorCount >= ABILITY_FLOOR_LIMIT
                ? `${_abilityFloorCount}× on this floor (alternating loop)`
                : `${CFG.abilitySpamBanLimit}× consecutively`;
            _abilityBanned = true;
            _abilitySpamCount = 0;
            log(`${p.subclass||p.className} ability banned — spam loop detected (${reason})`, 'warn');
            err('ability-spam', new Error(`${p.subclass||p.className} ability fired ${reason} with no progress`));
        } else {
            try {
                p.useAbility?.();
                _markAbilityUsed();
                log(`Used ${p.subclass||p.className} ability`, 'arena');
            } catch(e) { err('offensive ability',e); }
            return;
        }
    }

    // ── 8. Attack the best target (threat-weighted) ──
    _abilitySpamCount = 0; // any non-ability action resets the spam counter
    const enemy = bestTarget();
    if (enemy) {
        // We're committing to combat — clear dodge anti-loop state so a future
        // wind-up gets a fresh dodge budget once this fight resolves.
        _dodgeCount = 0; _dodgeHistory = [];
        goal(`Fighting ${enemy.name} (F${s.floor})`);
        // True adjacency by coordinates. At cardinal distance 1 there's no wall
        // between us and the enemy (no room for one), so attacking is always valid.
        const adjacent = (Math.abs(enemy.x-p.x) + Math.abs(enemy.y-p.y)) === 1;
        if (adjacent) {
            try { p.attack(enemy); } catch(e) { err('attack',e); }
            return;
        }
        // Reuse the approach tile bestTarget() already computed for this enemy
        // (cached on the live object) instead of running bestApproachTile —
        // and its ≤4 BFS searches — a second time. Fall back to a fresh search
        // only if the cache is somehow missing (defensive).
        const slot = enemy._cachedApproach || bestApproachTile(enemy.x, enemy.y);
        if (slot) {
            if (p.x === slot.x && p.y === slot.y) {
                try { p.attack(enemy); } catch(e) { err('attack',e); }
            } else {
                navigate(slot.x, slot.y);
            }
            return;
        }
        // No reachable cardinal approach tile. The enemy is walled off or in an
        // alcove we can't enter from a cardinal direction. Do NOT navigate into
        // the enemy tile — that pathing fails and devolves into wander-at-wall
        // forever (the exact "attacking through a wall" loop). Blacklist this
        // enemy for a short while and fall through to exploration so the bot
        // makes progress instead of fixating.
        _unreachableEnemies.add(`${enemy.x},${enemy.y}`);
        // Count strikes by enemy identity (id if available, else type) so a
        // genuinely walled enemy accumulates strikes across the periodic clears
        // even though its tile coordinates may shift as it patrols in place.
        const ekey = enemy.id || `${enemy.type}@${enemy.x},${enemy.y}`;
        _unreachableStrikes[ekey] = (_unreachableStrikes[ekey] || 0) + 1;
        log(`${enemy.name} unreachable — exploring past it`, 'warn');
        // fall through (no return) to item/exit/explore logic below
    }

    // Pick up items within 6 tiles
    const item = nearestItem();
    if (item && item.dist <= 6) {
        goal(`Getting ${item.name||'item'}`);
        if (item.dist === 0) { try { handleAction?.(); } catch(_) {} }
        else navigate(item.x, item.y);
        return;
    }

    // Head to exit
    const exit = findTileAny(2);
    if (exit) {
        goal(`Heading to exit (F${s.floor})`);
        if (p.x===exit.x && p.y===exit.y) {
            // Only record/log the first time we land on the exit tile,
            // not every tick while standing there waiting for a dialog.
            const exitKey = `exit:${s.floor}`;
            if (_lastExitLogKey !== exitKey) {
                _lastExitLogKey = exitKey;
                if (s.floor > stats.bestFloor) stats.bestFloor = s.floor;
                stats.floors.push(s.floor);
                if (stats.floors.length > 500) stats.floors.shift(); // rolling cap
                if (s.floor >= 100) {
                    log('CLEARED THE DUNGEON!', 'run');
                    recordRunResult(p, 100, 'clear');
                }
            }
            try { tryStairsInteraction?.(); } catch(e) { err('stairs',e); }
        } else navigate(exit.x, exit.y);
        return;
    }

    // Explore
    const unex = nearestUnexplored();
    if (unex) {
        goal(`Exploring F${s.floor}`);
        navigate(unex.x, unex.y);
        return;
    }

    // No revealed exit and nothing unexplored reachable — the down-stairs are
    // probably in an unrevealed pocket. Reveal the map and retry next tick
    // rather than freezing. (Cheaper than waiting for the mid-stall recovery.)
    if (typeof revealAll === 'function') {
        try { revealAll(); } catch(_) {}
        const exit2 = findTileAny(2);
        if (exit2) { goal(`Found exit after reveal (F${s.floor})`); navigate(exit2.x, exit2.y); return; }
    }

    // Nothing left to do. Only attempt a staircase interaction if the player
    // is CURRENTLY STANDING on a tile-2 (stairs-down). The unchecked fallback
    // was causing floor oscillation: the bot lands on the UP stairs tile after
    // a smoke bomb scatter, this fires, ascends to the previous floor, descends
    // again — infinite 3↔4 loop that the stall timer couldn't catch (each
    // floor change resets the timer).
    const pTile = s.dungeon?.[p.y]?.[p.x];
    if (pTile === 2) {
        try { tryStairsInteraction?.(); } catch(_) {}
    }
}

// ── Main tick ─────────────────────────────────────────────────────────────
function tick() {
    if (!running) return;
    _abilityTickClock++; // drives the ability cooldown rate-limiter
    // Per-tick enforcement of the display mode's canvas suppression. Something
    // in the run-restart / updateUI cycle can momentarily re-show the main
    // canvas (the "flash"), so we re-assert the intended state every tick.
    // Idempotent: setting visibility to its current value is a no-op and causes
    // no flicker, so this only acts when something else changed it.
    if (_displayMode !== 'full') {
        const gc = document.getElementById('game-canvas');
        if (gc && gc.style.visibility !== 'hidden') gc.style.visibility = 'hidden';
        if (!window._botSkipRender) window._botSkipRender = true;
    }
    try { decide(); } catch(e) { err('tick',e); }
    // Sparkline: record HP% every tick, cap at HP_HISTORY_MAX
    const p = pp();
    if (p && p.maxHp > 0) {
        _hpHistory.push(p.hp / p.maxHp);
        if (_hpHistory.length > HP_HISTORY_MAX) _hpHistory.shift();
    }
    // Auto-throttle: adjust speed based on game phase
    _autoThrottleTick();
    // Only update the stats panel every 6 ticks.
    if (++_renderTick % 6 === 0) renderStats();
}

function decide() {
    const s=gs(), p=pp();
    if (!s||!p) { tryStartRun(); return; }

    // During an active batch, gameOver handling MUST take priority over the
    // title-screen guard below. A death can briefly show the title screen
    // before the next run loads; if the title guard fired first it would call
    // tryStartRun() (a no-op during batch) and the batch would never advance.
    // Handle the batch death here, before anything else.
    if (s.gameOver && batch.active) {
        if (!_lastGameOverId) {
            _lastGameOverId = Date.now();
            if (p.hp<=0) {
                stats.deaths++;
                if (s.floor>stats.bestFloor) stats.bestFloor=s.floor;
                stats.floors.push(s.floor);
                if (stats.floors.length > 500) stats.floors.shift();
                log(`Died on floor ${s.floor} — death #${stats.deaths}`,'death');
                recordRunResult(p, s.floor, 'death');
            }
            advanceBatch();
        }
        return;
    }

    // Title screen is showing even though a player object exists — this happens
    // when the bot flees to the tavern (returnToTavern drops to the title with
    // a "Continue Journey" resume button). The player persists in gameState, so
    // decide() would otherwise run tavern logic blindly while the overlay
    // swallows every interaction. Detect the visible title screen and resume.
    const titleScreen = document.getElementById('title-screen');
    if (titleScreen && titleScreen.style.display !== 'none' && titleScreen.offsetParent !== null) {
        tryStartRun();
        return;
    }

    if (s.gameOver) {
        // Non-batch game over (single run with autoRestart). The batch case is
        // handled earlier, before the title-screen guard. Guard against
        // recording the same death on every tick while gameOver stays true.
        if (!_lastGameOverId) {
            _lastGameOverId = Date.now();
            if (p.hp<=0) {
                stats.deaths++;
                if (s.floor>stats.bestFloor) stats.bestFloor=s.floor;
                stats.floors.push(s.floor);
                if (stats.floors.length > 500) stats.floors.shift(); // rolling cap
                log(`Died on floor ${s.floor} — death #${stats.deaths}`,'death');
                recordRunResult(p, s.floor, 'death');
            }
            if (CFG.autoRestart) setTimeout(tryStartRun, 800);
        }
        return;
    }
    // Clear the dedup guard once the game is no longer over (new run started).
    _lastGameOverId = null;

    if (s.awaitingLevelChoice) { handleLevelUp(); return; }

    // Arena bout in progress — handle it
    if (s.inArenaBout) { handleBout(); return; }

    // Tavern-return confirm dialog is open. Decide based on intent:
    // if we're in the dungeon, hurt, and out of potions, this dialog is
    // OUR flee request — confirm it. Otherwise it's spurious — cancel it.
    if (s.tavernConfirmOpen) {
        const player = pp();
        const bankedGold = (s.tavernUpgrades?.bankGold) || 0;
        const canRecover = player && (player.gold >= 25 || bankedGold >= 25);
        // The portal system introduced multiple confirm action types. Route each.
        const action = s.tavernConfirmAction || 'return';
        if (action === 'portal_spell' || action === 'portal_coin') {
            // We initiated this flee — confirm the portal.
            try { confirmReturnToTavern?.(); log('Portalled to tavern', 'warn');
                const fp = pp(); if (fp) recordRunResult(fp, gs()?.floor||0,'fled');
            } catch(e) { err('portal',e); }
            return;
        }
        if (action === 'entrance_choice') {
            // At dungeon entrance: always descend fresh (cached mid-run state
            // confuses the bot's pathing — cleaner to start from floor 1).
            try { cancelTavernConfirm?.(); } catch(_) { try { closeTavernConfirm?.(); } catch(_){} }
            return;
        }
        // Default / legacy: only confirm if recovery is possible.
        const wantFlee = player && s.floor > 0 && canRecover &&
            (player.hp / player.maxHp) < CFG.fleeAt &&
            !player.inventory?.some(i=>i.type==='potion'&&i.qty>0);
        if (wantFlee) {
            try {
                confirmReturnToTavern?.();
                log('Fled to tavern', 'warn');
                const fp = pp();
                if (fp) recordRunResult(fp, gs()?.floor || 0, 'fled');
            } catch(e) { err('confirmReturn', e); }
        } else {
            try { closeTavernConfirm?.(); } catch(_) { closeAll(); }
        }
        return;
    }

    // Close any other stray panel
    if (anyPanelOpen()) { closeAll(); return; }

    // Floor changed
    if (s.floor !== lastFloor) {
        lastFloor = s.floor;
        _floorEnterMs = Date.now(); // wall-clock watchdog: real progress resets it
        stuckTicks = 0;
        _revealedWhileStuck = false;
        _runTickCount = 0; // floor progress resets the soft stall timer
        _floorTickCount = 0; // ...and the hard per-floor budget
        _unreachableItems.clear(); // fresh floor — re-evaluate all item reachability
        _unreachableEnemies.clear(); // fresh floor — re-evaluate enemy reachability
        _unreachableStrikes = {};    // fresh floor — clear sticky-unreachable strikes
        _abilityFloorCount = 0;      // fresh floor — reset per-floor ability spam guard
        _dodgeHistory = []; _dodgeCount = 0; // fresh floor — clear dodge anti-loop state
        if (s.floor > 0 && s.floor > stats.bestFloor) stats.bestFloor = s.floor;
        if (s.floor > 0) log(`Floor ${s.floor}`,'floor');
    }

    // ── Wall-clock stall watchdog (catch-all escape) ──────────────────────
    // The reliable backstop: if the bot has spent more than CFG.floorWatchdogMs
    // of REAL time on this floor, it's stuck — no matter the cause (unreachable
    // enemy, blocked exit, splitter loop, BFS dead-end). Tick counters can be
    // reset by in-place shuffling and miss this; wall-clock can't. We try a
    // clean tavern return first (banks any progress), and hard-restart the run
    // if the portal isn't available within a short grace window.
    if (CFG.floorWatchdogMs > 0 && s.floor > 0 && (Date.now() - _floorEnterMs) > CFG.floorWatchdogMs) {
        const secs = Math.round((Date.now() - _floorEnterMs) / 1000);
        log(`Watchdog: ${secs}s real time on F${s.floor} with no progress — extracting`, 'warn');
        err('floor-watchdog', new Error(`Floor ${s.floor} watchdog fired after ${secs}s of real time — stuck (no floor change)`));
        // Reset the timers so we don't immediately re-fire, and record the run.
        _floorEnterMs = Date.now();
        _runTickCount = 0; _floorTickCount = 0; _abilityBanned = false;
        recordRunResult(p, s.floor, 'timeout');
        _lastGameOverId = Date.now();
        if (batch.active) { advanceBatch(); return; }
        if (CFG.autoRestart) { forceNewRunAs(p.className || 'warrior'); }
        return;
    }

    // Run stall timeout — if no floor change AND no kills in MAX_STALL_TICKS ticks,
    // the bot is genuinely stuck (no enemies, can't find stairs, BFS hit dead end).
    _runTickCount++;
    // Hard per-floor budget — incremented every tick, reset ONLY on floor change
    // above. Kills/items/moves never reset this, so a run that's grinding a
    // single floor forever (endless summons, split loop) is caught here even
    // though the soft timer keeps getting reset by kill activity.
    _floorTickCount++;
    if (_floorTickCount >= MAX_FLOOR_TICKS) {
        _floorTickCount = 0;
        _runTickCount = 0;
        _abilityBanned = false;
        // Diagnose the likely cause rather than always blaming summons. Only
        // floors that actually contain a summoning enemy (necromancer, or a
        // summoner/splitter boss) can endless-spawn; on other floors the budget
        // is exhausted by a navigation stall — the bot keeps making small moves
        // (which reset the soft stall timer) but never reaches the exit.
        // Report what we can actually observe rather than guessing one cause.
        // Two independent factors can exhaust the floor budget, and they often
        // co-occur: (a) a summoner/splitter generating adds, and (b) the bot
        // unable to reach an enemy or the exit (the "unreachable" blacklist).
        // We surface both signals so the log points at the real situation.
        const enemiesNow = (s.enemies || []).filter(e => e.hp > 0);
        const summoners = enemiesNow.filter(e =>
            e.type === 'necromancer' ||
            e.bossVariant === 'summoner' || e.bossVariant === 'splitter' ||
            e.name === 'Goblin King' ||
            (e._raisedBy !== undefined && e._raisedBy !== null));
        const stickyUnreachable = Object.values(_unreachableStrikes || {})
            .filter(n => n >= _STICKY_UNREACHABLE_AT).length;
        const unreachableCount = Math.max(
            stickyUnreachable,
            (typeof _unreachableEnemies !== 'undefined' && _unreachableEnemies) ? _unreachableEnemies.size : 0
        );
        const parts = [];
        if (summoners.length) {
            const names = [...new Set(summoners.map(e => e.name || e.bossVariant || e.type))];
            parts.push(`summoner/splitter present (${names.join(', ')})`);
        }
        if (unreachableCount) parts.push(`${unreachableCount} unreachable enemy(s) — navigation blocked`);
        if (!parts.length) parts.push(`${enemiesNow.length} enemies, exit likely unreachable`);
        const cause = parts.join('; ');
        log(`Stuck on F${s.floor} for ${MAX_FLOOR_TICKS} ticks (soft timer kept resetting) — force-ending`, 'warn');
        err('floor-timeout', new Error(`Floor ${s.floor} exceeded ${MAX_FLOOR_TICKS}-tick budget — ${cause}`));
        recordRunResult(p, s.floor, 'timeout');
        _lastGameOverId = Date.now();
        if (batch.active) { advanceBatch(); return; }
        if (CFG.autoRestart) { forceNewRunAs(p.className || 'warrior'); }
        return;
    }

    // Periodically forget blacklisted unreachable enemies — they patrol and may
    // have wandered into reach, or the bot has explored a route around the wall.
    // Every 40 ticks is ~5s normal / ~1.2s turbo: frequent enough to re-engage,
    // rare enough not to re-trigger the fixation loop the blacklist prevents.
    if (_runTickCount % 40 === 0 && _unreachableEnemies.size) _unreachableEnemies.clear();

    // ── Mid-stall recovery (halfway to timeout) ──────────────────────────
    // Reveal the entire floor and force a fresh path search. This fixes the
    // most common stuck scenario: stairs exist but are in an unrevealed pocket
    // the BFS couldn't reach because of a narrow passage or generation quirk.
    const HALF_STALL = Math.floor(MAX_STALL_TICKS / 2);
    if (_runTickCount === HALF_STALL) {
        log(`Mid-stall recovery on F${s.floor} — revealing map`, 'warn');
        try { revealAll?.(); } catch(_) {}
        // Also try interacting with stairs if now visible
        const exit = findTileAny(2);
        if (exit) { stepTo(exit.x, exit.y); return; }
    }

    if (_runTickCount >= MAX_STALL_TICKS) {
        _runTickCount = 0;
        _abilityBanned = false;
        log(`Run timed out after ${Math.round(MAX_STALL_TICKS * CFG.tickMs / 1000)}s stall on F${s.floor} — force-ending`, 'warn');
        err('stall-timeout', new Error(`No floor/kill progress in ${MAX_STALL_TICKS} ticks on floor ${s.floor}`));
        recordRunResult(p, s.floor, 'timeout');
        // Set the gameOver guard so no other code path double-handles this run,
        // then advance the batch through the single consolidated path.
        _lastGameOverId = Date.now();
        if (batch.active) { advanceBatch(); return; }
        if (CFG.autoRestart) { forceNewRunAs(p.className || 'warrior'); }
        return;
    }

    // Stuck detection
    const pk = `${p.x},${p.y},${s.floor}`;
    if (pk === lastPosKey) {
        stuckTicks++;
        if (stuckTicks >= CFG.maxStuck) {
            // 1. Adjacent enemy → attack through it.
            const adjEnemy = (s.enemies||[]).find(e => e.hp > 0 &&
                Math.abs(e.x-p.x)+Math.abs(e.y-p.y) === 1);
            if (adjEnemy) {
                stuckTicks = 0;
                try { p.attack(adjEnemy); } catch(e) { err('stuck-attack', e); }
                return;
            }
            // 2. A REACHABLE enemy → path toward it. bestTarget() already
            //    filters out enemies behind walls (uses A* path distance), so
            //    this won't send us bouncing into a wall after an unreachable
            //    target — the exact bug that froze the bot in the open-room case.
            const reachableEnemy = bestTarget();
            if (reachableEnemy) {
                const slot = bestApproachTile(reachableEnemy.x, reachableEnemy.y) || reachableEnemy;
                if (navigate(slot.x, slot.y)) { stuckTicks = 0; return; }
            }
            // 3. Path to the exit.
            const exit = findTileAny(2);
            if (exit && navigate(exit.x, exit.y)) { stuckTicks = 0; return; }
            // 4. Blind wander.
            if (forceWander()) { stuckTicks = 0; return; }
            // 5. Reveal the map ONCE (guarded so it doesn't spam every tick), then
            //    let the stall timer take over. If we're here, every neighbour is
            //    blocked and we can't reach any enemy/exit — genuinely wedged.
            if (!_revealedWhileStuck && typeof revealAll === 'function') {
                try { revealAll(); } catch(_) {}
                _revealedWhileStuck = true;
                log(`Hard-stuck on F${s.floor} — revealed map`, 'warn');
            }
            // Don't reset stuckTicks low — let _runTickCount climb to the stall
            // limit and force-restart the run. Keep stuckTicks pinned at max so we
            // don't re-run this whole block every tick (which caused the spam).
            stuckTicks = CFG.maxStuck;
            return;
        }
    } else { lastPosKey=pk; stuckTicks=0; _revealedWhileStuck=false;
        // Moving to a new tile may open a path to a previously-unreachable ITEM,
        // so clear that blacklist eagerly. We deliberately do NOT clear the
        // ENEMY blacklist here: clearing it every move would let the bot
        // re-fixate on a walled-off enemy, step once, clear, re-fixate, step
        // back — the exact oscillation the blacklist exists to prevent. Enemy
        // entries expire on the 40-tick timer and on floor change instead.
        _unreachableItems.clear();
    } // moved — clear short-range stuck state

    // Overland ambush: floor is still 0 but enemies are present and hostile.
    // Treat it like dungeon combat (fight the pack) rather than tavern idling,
    // which would otherwise leave the bot standing still while it's attacked.
    // The bot doesn't normally roam the world map, so this is a safety net.
    if (s.floor === 0 && s.inZoneCombat && (s.enemies||[]).some(e => e.hp > 0)) {
        const target = nearestEnemy();
        if (target) {
            if (adj(p.x, p.y, target.x, target.y)) {
                try { p.attack(target); } catch(e) { err('zone-attack', e); }
            } else {
                stepTo(target.x, target.y);
            }
            return;
        }
    }

    if (s.floor===0) decideTavern();
    else decideDungeon();
}

// ── Start/restart a run ───────────────────────────────────────────────────
function tryStartRun() {
    // Resume banner — if a run is already in progress (e.g. the bot fled back
    // to the tavern, which drops to the title screen with a "Continue Journey"
    // button), click it to resume instead of starting fresh. Without this the
    // bot freezes on the title screen, never re-entering its own run.
    // During a batch we DON'T resume — the batch wants a clean new run per
    // class, started via forceNewRunAs(); resuming would replay the fled run.
    const resume = document.getElementById('title-resume-btn');
    if (resume && resume.offsetParent && !batch.active) { resume.click(); return; }

    // Intro video screen — fires when beginAdventure() can't play intro.mp4.
    // The game shows a fallback and auto-proceeds after 1 s, but clicking Skip
    // here gets the bot moving immediately rather than waiting the timeout.
    const introSkip = document.getElementById('intro-video-skip-btn');
    if (introSkip && introSkip.offsetParent !== null) { introSkip.click(); return; }

    // Title screen — click begin
    const tb = document.getElementById('title-begin-btn');
    if (tb && tb.offsetParent) { tb.click(); return; }
    // Character select
    const cs = document.getElementById('class-select');
    if (cs && cs.style.display !== 'none') {
        // Redesigned character-select (csn- prefix). Class tabs auto-select
        // their first subclass, so picking a class tab is enough to populate
        // everything and enable Begin Descent.
        const tabs = document.querySelectorAll('.csn-cls-tab');
        if (tabs.length && !document.querySelector('.csn-cls-tab.on')) {
            try { tabs[0].click(); } catch (_) {}
            return;
        }
        // A subclass pill is auto-selected on class pick, but click the first
        // one explicitly if for some reason none is active yet.
        const pills = document.querySelectorAll('.csn-sc-pill');
        if (pills.length && !document.querySelector('.csn-sc-pill.on')) {
            try { pills[0].click(); } catch (_) {}
            return;
        }
        // Begin Descent
        const beginBtn = document.querySelector('.csn-begin-btn');
        if (beginBtn && !beginBtn.disabled) { beginBtn.click(); return; }

        // ── Legacy fallback for older builds (pre-redesign) ──
        const cards = document.querySelectorAll('.cs-class-card');
        if (cards.length && !document.querySelector('.cs-class-active')) {
            const first = cards[0];
            const clickTarget = first.querySelector('.cs-class-top') || first;
            try { clickTarget.click(); } catch(_) { try { first.click(); } catch(_){} }
            return;
        }
        const chips = document.querySelectorAll('.cs-chip');
        if (chips.length && !document.querySelector('.cs-chip-active')) { chips[0].click(); return; }
        const subs = document.querySelectorAll('.cs-sub-card');
        if (subs.length && !document.querySelector('.cs-sub-active')) { subs[0].click(); return; }
        const btn = document.querySelector('.cc-confirm-btn');
        if (btn && !btn.disabled) { btn.click(); return; }
    }
}

// ── Game function availability audit ──────────────────────────────────────
// Runs once when the bot starts. Required functions cause an error if absent
// (the bot cannot work without them). Optional functions log a warning but
// are non-fatal (the bot degrades gracefully — e.g. no shop buying if
// openShop is missing). Results are stored so _bot.health() can report them.
const _fnAudit = { ok: null, missing: [], warn: [] };

function checkGameFunctions() {
    const required = [
        'initGame', 'descendFloor', 'updateUI', 'generateDungeon',
    ];
    const optional = [
        'requestReturnToTavern', 'revealAll', 'openShop', 'openBank',
        'openInnkeeper', 'openBlacksmith', 'openTrainer', 'bankDepositAll',
        'forfeitArenaBout', 'isArenaUnlocked', 'tryStairsInteraction',
        'getAvailableChampions', 'selectArenaBout', 'confirmArenaBout',
        'usePotion', 'useAntidote', 'useSmokeBomb', 'useRageDraught',
        'trackEnemyKill', 'trackGoldPickup', 'addItemToInventory',
        'seedToCode', 'getShopItems', 'predictEnemyIntent',
    ];
    _fnAudit.missing = required.filter(f => typeof window[f] !== 'function');
    _fnAudit.warn    = optional.filter(f => typeof window[f] !== 'function');
    _fnAudit.ok      = _fnAudit.missing.length === 0;

    if (_fnAudit.missing.length) {
        const msg = `Missing required functions: ${_fnAudit.missing.join(', ')}`;
        console.error(`%c[Bot] ${msg}`, 'color:#ff4444;font-weight:bold');
        err('startup', new Error(msg));
    }
    if (_fnAudit.warn.length) {
        console.warn('[Bot] Missing optional functions (bot will degrade gracefully):',
            _fnAudit.warn.join(', '));
    }
    if (_fnAudit.ok) {
        console.log('%c[Bot] All required functions present ✓', 'color:#58c26d');
    }
    return _fnAudit.ok;
}

// ── Tracking patches ──────────────────────────────────────────────────────
function patchFns() {
    function wrap(name, fn) {
        if (!window[name] || window[name]._b) return;
        const orig = window[name];
        window[name] = function(...args) { try { fn(...args); } catch(_){} return orig.apply(this,args); };
        window[name]._b = true;
    }
    // trackEnemyKill is called by defeatEnemy — wrapping only this one avoids
    // double-counting kills (wrapping defeatEnemy too would count every kill twice).
    // Also resets _runTickCount so the stall timer doesn't fire mid-combat on
    // large floors — as long as the bot is killing things, it's making progress.
    wrap('trackEnemyKill', (enemy)=>{
        if (!running) return;
        stats.kills++;
        _runTickCount = 0;
        // Kill feed: record floor, enemy name, damage dealt this run
        if (enemy && enemy.name) {
            const floor = gs()?.floor || 0;
            const dmg = _runDmgDealt; // snapshot — cleared between runs
            _killFeed.unshift({ floor, name: enemy.name, type: enemy.type, dmg });
            if (_killFeed.length > KILL_FEED_MAX) _killFeed.pop();
        }
    });
    wrap('trackGoldPickup', (amt)=>{ if(running) stats.gold+=(amt||0); });

    // ── Item tracking hooks ────────────────────────────────────────────────
    // Every collected item flows through addItemToInventory; equipment that
    // auto-equips off the floor flows through autoEquipIfBetter. Record both as
    // "found". Consumable-use functions record "used".
    wrap('addItemToInventory', (item)=>{
        if(!running || !item) return;
        const nm = item.name || item.type || 'Item';
        logItemFound(nm, item.rarity, gs()?.floor);
        _runTickCount = 0;
    });
    wrap('addRelicToPouch', (relicId)=>{
        if(!running || !relicId) return;
        const def = (typeof RELIC_DEFS !== 'undefined') ? RELIC_DEFS[relicId] : null;
        logItemFound(def ? def.name : 'Relic', def?.rarity || 'rare', gs()?.floor);
    });
    wrap('usePotion',         ()=>{ if(running) logItemUsed('Health Potion'); });
    wrap('useAntidote',       ()=>{ if(running) logItemUsed('Antidote'); });
    wrap('useSmokeBomb',      ()=>{ if(running) logItemUsed('Smoke Bomb'); });
    wrap('useRageDraught',    ()=>{ if(running) logItemUsed('Rage Draught'); });
    wrap('useIdentifyScroll', ()=>{ if(running) logItemUsed('Identify Scroll'); });

    // ── IMPROVE-2: Rare event tracker ─────────────────────────────────────
    // triggerRareEvent fires when the player steps on shrines, vaults, altars etc.
    // We snapshot gold+HP before and after to capture the delta for the stats table.
    if (typeof triggerRareEvent === 'function' && !triggerRareEvent._botPatched) {
        const _orig = triggerRareEvent;
        window.triggerRareEvent = function(obj, ...rest) {
            const p0 = pp();
            const before = { gold: p0?.gold || 0, hp: p0?.hp || 0 };
            _orig.call(this, obj, ...rest);
            if (!running || !obj?.kind) return;
            const p1 = pp();
            const dg = (p1?.gold||0) - before.gold;
            const dh = (p1?.hp ||0) - before.hp;
            const label = obj.kind.replace('event_','').toUpperCase();
            log(`${label} on F${gs()?.floor||'?'} — gold ${dg>=0?'+':''}${dg}, HP ${dh>=0?'+':''}${dh}`, 'event');
            if (!_eventStats[obj.kind]) _eventStats[obj.kind] = { count:0, goldTotal:0, hpTotal:0 };
            _eventStats[obj.kind].count++;
            _eventStats[obj.kind].goldTotal += dg;
            _eventStats[obj.kind].hpTotal   += dh;
        };
        window.triggerRareEvent._botPatched = true;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function goal(t) { goalText=t; }
function log(msg,type) {
    // Collapse consecutive identical messages into a count ("Used ability ×5")
    // so high-frequency events (ability casts, exploration steps) don't flood
    // the log and bury the lines that actually matter.
    const head = logs[0];
    if (head && head.msg.replace(/ ×\d+$/, '') === msg && head.type === (type||'info')) {
        head._count = (head._count || 1) + 1;
        head.msg = `${msg} ×${head._count}`;
        head.t = Date.now();
        renderLog();
        return;
    }
    logs.unshift({t:Date.now(),msg,type:type||'info'});
    if(logs.length>600)logs.splice(0,logs.length-600);
    renderLog();
}
function err(ctx, e) {
    // ── Rate limiter ──────────────────────────────────────────────────────
    // Cap at ERR_RATE_MAX errors/sec so a tight bug loop can't freeze the
    // browser. One suppression warning fires so the problem stays visible.
    const now = Date.now();
    if (now - _errRate.stamp < 1000) {
        if (++_errRate.count > ERR_RATE_MAX) {
            _errRate.suppressed++;
            if (_errRate.count === ERR_RATE_MAX + 1) {
                console.warn(`[Bot] Error rate limit hit (>${ERR_RATE_MAX}/sec) — suppressing. Context: ${ctx}`);
            }
            return;
        }
    } else {
        if (_errRate.suppressed > 0) {
            console.warn(`[Bot] ...${_errRate.suppressed} additional errors suppressed in the last second`);
        }
        _errRate.count = 1;
        _errRate.stamp = now;
        _errRate.suppressed = 0;
    }

    // ── Game-state snapshot ───────────────────────────────────────────────
    // Capture context at the moment of failure so errors are reproducible
    // without having to repro the exact game state manually.
    let snapshot = null;
    try {
        const _p = pp(), _s = gs();
        if (_p || _s) {
            snapshot = {
                floor:   _s?.floor ?? '?',
                mode:    _s?.inArenaBout ? 'pit-bout'
                       : _s?.inCourtyard ? 'tavern'
                       : (_s?.floor ?? 0) > 0 ? 'dungeon' : 'hub',
                class:   _p?.className ?? '?',
                sub:     _p?.subclass  ?? '',
                hp:      _p ? `${_p.hp}/${_p.maxHp}` : '?',
                gold:    _p?.gold ?? '?',
                pos:     _p ? `${_p.x},${_p.y}` : '?',
                enemies: _s?.enemies?.filter(e => e.hp > 0).length ?? 0,
                goal:    goalText,
                tick:    _floorTickCount,
            };
        }
    } catch (_snapErr) { /* never let snapshot capture itself throw */ }

    const msg = `${ctx}: ${e?.message || e}`;
    errors.unshift({ t: now, msg, ctx, stack: e?.stack, snapshot });
    if (errors.length > 200) errors.length = 200;
    log(msg, 'error');
    renderErrors();

    // ── Structured console output ─────────────────────────────────────────
    // Use a group so the stack trace and state snapshot are collapsible and
    // don't scroll the console past the information that matters.
    if (e?.stack) {
        console.group(`%c[Bot Error] ${ctx}`, 'color:#ff6060;font-weight:bold');
        console.error(e?.message || String(e));
        if (snapshot) console.log('%cState at error', 'color:#ffd65a', snapshot);
        console.error(e);
        console.groupEnd();
    } else {
        console.error(`[Bot] ${ctx}:`, e?.message || e, snapshot ? snapshot : '');
    }
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function ts(t){ return new Date(t).toLocaleTimeString(); }

// ── Panel UI ─────────────────────────────────────────────────────────────
function buildPanel() {
    if (document.getElementById('bot-panel')) return;
    const style = document.createElement('style');
    style.textContent = `
/* ═══ BOT PANEL SHELL ═══════════════════════════════════════════════════ */
#bot-panel{position:fixed;bottom:16px;right:16px;width:480px;z-index:9999;
  background:#0b0906;border:1px solid #2e1f0e;border-radius:12px;
  font-family:'Courier New',monospace;font-size:11px;color:#d4bc96;
  box-shadow:0 12px 48px rgba(0,0,0,.92),0 0 0 1px rgba(200,146,42,.08)}
#bot-tb{display:flex;align-items:center;gap:6px;padding:8px 12px 7px;
  background:linear-gradient(180deg,#161008 0%,#0f0b05 100%);
  border-bottom:1px solid #2e1f0e;border-radius:11px 11px 0 0;
  cursor:move;user-select:none}
#bot-tb-title{color:#c8922a;font-size:11px;font-weight:700;letter-spacing:.06em;flex:1;white-space:nowrap}
.bc{background:#141009;border:1px solid #2e1f0e;border-radius:5px;color:#c8922a;
  padding:4px 10px;cursor:pointer;font:inherit;font-size:10px;transition:all .12s}
.bc:hover{background:#1e150a;border-color:#c8922a;color:#ffd65a}
.bc.on{background:#c8922a;color:#0a0805;border-color:#c8922a;font-weight:700}
.bc-danger{color:#e04444!important;border-color:#3a1010!important}
.bc-danger:hover{border-color:#e04444!important;background:#1a0808!important}

/* ═══ MAIN TABS ═══════════════════════════════════════════════════════════ */
#bot-nav{display:flex;background:#0d0a06;border-bottom:1px solid #2e1f0e}
.bnt{flex:1;padding:7px 4px;background:transparent;border:none;border-bottom:2px solid transparent;
  color:#5a4a34;font:inherit;font-size:10px;font-weight:700;cursor:pointer;
  text-transform:uppercase;letter-spacing:.05em;transition:all .12s}
.bnt:hover{color:#a07040;background:rgba(200,146,42,.04)}
.bnt.on{color:#c8922a;border-bottom-color:#c8922a;background:rgba(200,146,42,.06)}
.bpane{display:none;animation:bfade .18s ease}
.bpane.on{display:block}
@keyframes bfade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

/* ═══ RUN PANE ════════════════════════════════════════════════════════════ */
#bp-run{padding:10px 14px}
#bot-run-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
#bot-cls-label{font-size:13px;font-weight:700;color:#ffd65a;letter-spacing:.02em}
.bot-floor-badge{background:#1e140a;border:1px solid #c8922a;border-radius:5px;
  font-size:10px;color:#c8922a;padding:2px 8px;font-weight:700;letter-spacing:.04em}
.bot-run-num{margin-left:auto;font-size:10px;color:#3a2a18}
#bot-hp-bar-wrap{height:7px;background:#141009;border-radius:4px;margin-bottom:6px;
  overflow:hidden;border:1px solid #1e140a}
#bot-hp-bar{height:100%;background:linear-gradient(90deg,#8b1c1c,#c62828 60%,#ef5350);
  border-radius:3px;transition:width .25s,background .4s}
#bot-hp-bar.warn{background:linear-gradient(90deg,#a06020,#e07820)}
#bot-hp-bar.crit{background:linear-gradient(90deg,#8b1c1c,#e53935)}
#bot-run-meta{display:flex;gap:14px;font-size:10px;color:#5a4a34;margin-bottom:5px}
#bot-run-meta b{color:#c8922a}
#bot-goal{font-size:10px;color:#8a7050;font-style:italic;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding:4px 8px;background:#0d0a06;border-radius:4px;border:1px solid #1e140a}
/* Speed controls inside run pane */
#bot-speed-row{display:flex;align-items:center;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid #1a1208}
#bot-speed-row span{font-size:9px;color:#3a2a18;margin-right:2px}
.bsp{background:#141009;border:1px solid #1e140a;border-radius:4px;color:#5a4a34;
  padding:3px 10px;cursor:pointer;font:inherit;font-size:9px;transition:all .12s}
.bsp:hover{border-color:#6a4a28;color:#c8922a}
.bsp.on{background:#c8922a;color:#0a0805;border-color:#c8922a;font-weight:700}
#bot-path-stat{margin-left:auto;font-size:9px;color:#2e1f0e}

/* Display-mode controls (mirror the speed row) */
#bot-display-row{display:flex;align-items:center;gap:5px;margin-top:6px;padding-top:6px;border-top:1px solid #1a1208}
#bot-display-row span{font-size:9px;color:#3a2a18;margin-right:2px}
.bdp{background:#141009;border:1px solid #1e140a;border-radius:4px;color:#5a4a34;
  padding:3px 10px;cursor:pointer;font:inherit;font-size:9px;transition:all .12s}
.bdp:hover{border-color:#6a4a28;color:#c8922a}
.bdp.on{background:#c8922a;color:#0a0805;border-color:#c8922a;font-weight:700}
#bot-fps-stat{margin-left:auto;font-size:9px;color:#2e1f0e}

/* Expanded session stats strip — 8 compact cells, the "big picture" */
#bot-session-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:8px;
  padding-top:8px;border-top:1px solid #1a1208}
.bss-cell{background:#0d0a06;border:1px solid #1a1208;border-radius:5px;padding:5px 4px;
  display:flex;flex-direction:column;align-items:center;gap:1px}
.bss-cell b{font-size:14px;font-weight:700;color:#e2ccaa;line-height:1}
.bss-cell small{font-size:7px;font-weight:700;letter-spacing:.06em;color:#5a4a34}

/* ═══ BATCH PANE ══════════════════════════════════════════════════════════ */
#bp-batch{padding:10px 14px}
.bbat-head{font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.bbat-row{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.bbat-cls{width:58px;font-weight:700;font-size:10px}
.bbat-cls.warrior{color:#c8922a}.bbat-cls.rogue{color:#58c26d}
.bbat-cls.mage{color:#7bb0ff}.bbat-cls.cleric{color:#d0a0ff}
.bbat-bar-wrap{flex:1;height:6px;background:#141009;border-radius:3px;overflow:hidden;border:1px solid #1a1208}
.bbat-bar{height:100%;border-radius:3px;transition:width .35s}
.bbat-bar.warrior{background:linear-gradient(90deg,#a07020,#c8922a)}
.bbat-bar.rogue{background:linear-gradient(90deg,#3a8a4a,#58c26d)}
.bbat-bar.mage{background:linear-gradient(90deg,#4060b0,#7bb0ff)}
.bbat-bar.cleric{background:linear-gradient(90deg,#7040b0,#d0a0ff)}
.bbat-num{width:40px;text-align:right;font-size:9px;color:#5a4a34}
.bbat-avg{width:38px;text-align:right;font-size:9px;color:#c8922a}
#bot-batch-total{margin-top:8px;padding-top:8px;border-top:1px solid #1a1208;
  display:flex;align-items:center;gap:8px;font-size:9px;color:#3a2a18}
#bot-batch-pbar{flex:1;height:4px;background:#141009;border-radius:2px;overflow:hidden;border:1px solid #1a1208}
#bot-batch-pbar-fill{height:100%;background:#c8922a;border-radius:2px;transition:width .35s}
#bot-batch-pct{color:#c8922a;font-weight:700;font-size:10px}
/* Live stats table */
#bot-class-stats{margin-top:10px;padding-top:10px;border-top:1px solid #1a1208}
.bcs-head{display:grid;grid-template-columns:62px 1fr 1fr 1fr 1fr;gap:3px;
  font-size:8px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.bcs-row{display:grid;grid-template-columns:62px 1fr 1fr 1fr 1fr;gap:3px;
  font-size:10px;line-height:1.8;padding:2px 4px;border-radius:4px;cursor:default}
.bcs-row:hover{background:#0d0a06}
.bcs-val{text-align:right;color:#7a6a50}
.bcs-val.hi{color:#58c26d}.bcs-val.warn{color:#ffd65a}.bcs-val.bad{color:#e04444}
.bcs-row.warrior .bcs-cls{color:#c8922a;font-weight:700}
.bcs-row.rogue   .bcs-cls{color:#58c26d;font-weight:700}
.bcs-row.mage    .bcs-cls{color:#7bb0ff;font-weight:700}
.bcs-row.cleric  .bcs-cls{color:#d0a0ff;font-weight:700}

/* ═══ LOG PANE ════════════════════════════════════════════════════════════ */
#bp-log{display:flex;flex-direction:column}
#bot-log-tabs{display:flex;gap:2px;padding:6px 14px 0;background:#0d0a06}
.blt{background:transparent;border:1px solid transparent;border-radius:5px 5px 0 0;
  color:#3a2a18;padding:4px 9px;cursor:pointer;font:inherit;font-size:9px;
  text-transform:uppercase;letter-spacing:.04em;transition:all .12s}
.blt:hover{color:#7a5a28;background:#0f0c07}
.blt.on{background:#141009;border-color:#2e1f0e;border-bottom-color:#141009;color:#c8922a}
#bot-log-wrap{padding:6px 14px;background:#0d0a06;border-top:1px solid #1a1208}
#bot-log{height:160px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#2a1e10 transparent}
.bl{font-size:10px;line-height:1.6;padding:1px 0;border-bottom:1px solid #0d0b08}
.bl.floor{color:#c8922a;font-weight:700}.bl.run{color:#58c26d}
.bl.death{color:#e04444}.bl.warn{color:#ffd65a}.bl.heal{color:#62b9ff}
.bl.shop{color:#b06dff}.bl.arena{color:#ff9f58}.bl.info{color:#4a5a68}
.bl.error{color:#ff6060;font-weight:700}.bl.event{color:#e8a838}
/* Errors sub-section */
#bot-errs{background:#0a0706;border-top:1px solid #2a1010;padding:6px 14px}
#bot-errs-head{display:flex;align-items:center;gap:6px;font-size:9px;
  color:#e04444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
#bot-err-log{max-height:70px;overflow-y:auto;scrollbar-width:thin}
.be{font-size:9px;line-height:1.5;padding:1px 0;color:#ff8080;word-break:break-word}

/* ═══ CONFIG PANE ═════════════════════════════════════════════════════════ */
#bp-cfg{padding:10px 14px}
.bcfg-section{margin-bottom:12px}
.bcfg-label{font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.bcfg-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:10px}
.bcfg-row label{flex:1;color:#8a7050}
.bcfg-input{background:#141009;border:1px solid #2e1f0e;border-radius:4px;
  color:#c8922a;padding:3px 7px;font:inherit;font-size:10px;width:70px;text-align:right}
.bcfg-input:focus{outline:none;border-color:#c8922a}
.bcfg-check-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer}
.bcfg-check-row input[type=checkbox]{accent-color:#c8922a;width:13px;height:13px;cursor:pointer}
.bcfg-check-row span{font-size:10px;color:#8a7050}
.bcfg-classes{display:flex;gap:5px;flex-wrap:wrap}
.bcfg-cls-btn{padding:4px 10px;font-size:10px;border-radius:4px;cursor:pointer;
  border:1px solid #2e1f0e;background:#141009;color:#5a4a34;font:inherit;transition:all .12s}
.bcfg-cls-btn.on{font-weight:700}
.bcfg-cls-btn.warrior.on{background:#c8922a22;border-color:#c8922a;color:#c8922a}
.bcfg-cls-btn.rogue.on{background:#58c26d22;border-color:#58c26d;color:#58c26d}
.bcfg-cls-btn.mage.on{background:#7bb0ff22;border-color:#7bb0ff;color:#7bb0ff}
.bcfg-cls-btn.cleric.on{background:#d0a0ff22;border-color:#d0a0ff;color:#d0a0ff}
.bcfg-apply{width:100%;margin-top:10px;padding:7px;font-size:11px;font-weight:700}

/* ═══ ITEMS PANE ══════════════════════════════════════════════════════════ */
#bp-items{padding:10px 14px}
.bi-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.bi-h{font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
.bi-list{max-height:130px;overflow-y:auto;scrollbar-width:thin}
.bi-row{display:flex;justify-content:space-between;gap:6px;font-size:10px;line-height:1.55}
.bi-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bi-ct{color:#ffd65a;font-weight:700;flex-shrink:0}
.bi-r-common{color:#b8a888}.bi-r-uncommon{color:#58c26d}.bi-r-rare{color:#62b9ff}
.bi-r-epic{color:#b06dff}.bi-r-legendary{color:#ffa030}.bi-r-mythic{color:#ff5cf0}
.bi-empty{color:#3a2a18;font-size:10px;font-style:italic}

/* ═══ SHARED ══════════════════════════════════════════════════════════════ */
#bot-panel *::-webkit-scrollbar{width:3px}
#bot-panel *::-webkit-scrollbar-thumb{background:#2e1f0e;border-radius:2px}
#bot-panel *::-webkit-scrollbar-track{background:transparent}
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'bot-panel';
    el.innerHTML = `
<div id="bot-tb">
  <span id="bot-tb-title">⚔ BOT DASHBOARD <span style="color:#5a4a34;font-weight:400;font-size:9px">v${BOT_VERSION}</span></span>
  <button id="bot-run-btn" class="bc" onclick="_bot.toggle()">▶ Start</button>
  <button class="bc" onclick="_bot.batch(20)" title="Run selected classes × runs each">⊡ Batch</button>
  <button class="bc bc-danger" onclick="_bot.forceReturn()" title="Force return to tavern">⌂</button>
  <button class="bc" onclick="_bot.report()" title="Full report">📊</button>
  <button class="bc" onclick="_bot.exportCSV()" title="Copy all persisted runs as CSV">📄</button>
  <button class="bc" onclick="_bot.downloadCSV()" title="Download all persisted runs as a .csv file (safest overnight capture)">💾</button>
  <button class="bc" onclick="_bot.min()" style="color:#3a2a18;padding:4px 8px" title="Minimise">−</button>
</div>

<div id="bot-nav">
  <button class="bnt on" data-tab="run"     onclick="_bot.nav('run')">Run</button>
  <button class="bnt"     data-tab="batch"   onclick="_bot.nav('batch')">Batch</button>
  <button class="bnt"     data-tab="log"     onclick="_bot.nav('log')">Log</button>
  <button class="bnt"     data-tab="history" onclick="_bot.nav('history')">History</button>
  <button class="bnt"     data-tab="items"   onclick="_bot.nav('items')">Items</button>
  <button class="bnt"     data-tab="cfg"     onclick="_bot.nav('cfg')">Config</button>
</div>

<!-- ── RUN PANE ──────────────────────────────────── -->
<div id="bp-run" class="bpane on">
  <div id="bot-run-card">
    <div id="bot-run-header">
      <span id="bot-cls-label">— Idle —</span>
      <span class="bot-floor-badge" id="bot-floor-badge">F0</span>
      <span class="bot-run-num" id="bot-run-num"></span>
      <span id="bot-seed" title="Seed — click to copy"
        onclick="_bot.copySeed()"
        style="margin-left:auto;font-family:monospace;font-size:9px;color:#2a1e10;cursor:pointer;padding:2px 6px;border-radius:3px;border:1px solid #1a1208;background:#080604"
      >————</span>
    </div>
    <div id="bot-hp-bar-wrap"><div id="bot-hp-bar" style="width:100%"></div></div>
    <div id="bot-run-meta">
      <span>HP&nbsp;<b id="bm-hp">—</b></span>
      <span>Lv<b id="bm-lv">—</b></span>
      <span>⚔&nbsp;<b id="bm-kills">0</b></span>
      <span>◈&nbsp;<b id="bm-gold">0g</b></span>
      <span>XP%&nbsp;<b id="bm-xp">—</b></span>
    </div>
    <div id="bot-goal">Idle</div>
  </div>
  <!-- Expanded session stats — the "big picture" across this session -->
  <div id="bot-session-strip">
    <div class="bss-cell"><b id="bss-runs">0</b><small>RUNS</small></div>
    <div class="bss-cell"><b id="bss-deaths">0</b><small>DEATHS</small></div>
    <div class="bss-cell"><b id="bss-best">0</b><small>BEST F</small></div>
    <div class="bss-cell"><b id="bss-avg">0</b><small>AVG F</small></div>
    <div class="bss-cell"><b id="bss-kpr">0</b><small>KILLS/RUN</small></div>
    <div class="bss-cell"><b id="bss-gpr">0</b><small>GOLD/RUN</small></div>
    <div class="bss-cell"><b id="bss-rate">0</b><small>RUNS/HR</small></div>
    <div class="bss-cell"><b id="bss-time">0m</b><small>UPTIME</small></div>
  </div>
  <div id="bot-speed-row">
    <span>Speed</span>
    <button class="bsp" onclick="_bot.spd(600)">Slow</button>
    <button class="bsp on" onclick="_bot.spd(120)">Normal</button>
    <button class="bsp" onclick="_bot.spd(45)">Fast</button>
    <button class="bsp" onclick="_bot.spd(15)">Turbo</button>
    <span id="bot-path-stat"></span>
  </div>
  <div id="bot-display-row">
    <span>Display</span>
    <button class="bdp on" onclick="_bot.display('full')" title="Main game canvas + minimap (prettiest)">Full</button>
    <button class="bdp" onclick="_bot.display('minimap')" title="Hide the big game canvas, keep the minimap (faster)">Minimap</button>
    <button class="bdp" onclick="_bot.display('headless')" title="Draw nothing — maximum speed">Headless</button>
    <span id="bot-fps-stat" title="Frames per second of the main render loop"></span>
  </div>
  <!-- HP sparkline -->
  <div style="margin-top:8px;padding-top:8px;border-top:1px solid #1a1208">
    <div style="font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">HP Timeline</div>
    <canvas id="bot-sparkline" width="440" height="32" style="width:100%;height:32px;display:block;border-radius:3px;background:#080604"></canvas>
  </div>
  <!-- Kill feed -->
  <div id="bot-killfeed-wrap" style="margin-top:8px;padding-top:8px;border-top:1px solid #1a1208;display:none">
    <div style="font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Recent Kills</div>
    <div id="bot-killfeed" style="max-height:70px;overflow-y:auto;scrollbar-width:thin"></div>
  </div>
  <!-- Minimap -->
  <div id="bot-minimap-wrap" style="margin-top:8px;padding-top:8px;border-top:1px solid #1a1208;display:none">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em">Minimap</span>
      <span id="bot-minimap-legend" style="font-size:8px;color:#2a1e10;margin-left:auto">
        <span style="color:#ffe84a">●</span>player &nbsp;
        <span style="color:#ff5050">●</span>enemy &nbsp;
        <span style="color:#50c8ff">—</span>path &nbsp;
        <span style="color:#50ff80">●</span>item
      </span>
    </div>
    <canvas id="bot-minimap" style="display:block;border-radius:3px;background:#050403;image-rendering:pixelated;width:100%;border:1px solid #1a1208"></canvas>
  </div>
  <!-- Pathfinder diagnostics -->
  <div id="bot-diag-wrap" style="margin-top:8px;padding-top:8px;border-top:1px solid #1a1208;display:none">
    <div style="font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Pathfinder</div>
    <div id="bot-diag-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:6px"></div>
    <div id="bot-diag-floors" style="font-size:9px;color:#2a1e10"></div>
  </div>
</div>

<!-- ── HISTORY PANE ────────────────────────────────────────────── -->
<div id="bp-history" class="bpane" style="padding:8px 14px">
  <div style="font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">
    Last <span id="hist-count">0</span> runs &nbsp;·&nbsp;
    Session best: F<span id="hist-best">0</span> &nbsp;·&nbsp;
    Deaths: <span id="hist-deaths">0</span> &nbsp;·&nbsp;
    Runs: <span id="hist-runs">0</span>
  </div>
  <!-- Floor death heatmap -->
  <div id="bot-heatmap-wrap" style="margin-bottom:8px">
    <div style="font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Death heatmap (floors 1-50)</div>
    <canvas id="bot-heatmap" width="440" height="22" style="width:100%;height:22px;display:block;border-radius:3px;background:#080604"></canvas>
  </div>
  <div id="bot-run-cards" style="max-height:220px;overflow-y:auto;scrollbar-width:thin"></div>
</div>

<!-- ── BATCH PANE ─────────────────────────────────── -->
<div id="bp-batch" class="bpane">
  <div class="bbat-head">Progress by class</div>
  <div id="bot-batch-rows"></div>
  <div id="bot-batch-total">
    <span id="bot-batch-label">0 / 0 runs</span>
    <div id="bot-batch-pbar"><div id="bot-batch-pbar-fill" style="width:0%"></div></div>
    <span id="bot-batch-pct">0%</span>
  </div>
  <div id="bot-class-stats">
    <div class="bcs-head">
      <span>Class</span>
      <span style="text-align:right">Runs</span>
      <span style="text-align:right">Avg F</span>
      <span style="text-align:right">Best</span>
      <span style="text-align:right">Deaths</span>
    </div>
    <div id="bot-class-rows"></div>
  </div>
  <!-- Subclass breakdown -->
  <div id="bot-subclass-stats" style="margin-top:10px;padding-top:10px;border-top:1px solid #1a1208;display:none">
    <div style="font-size:9px;color:#3a2a18;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Subclass breakdown</div>
    <div class="bcs-head">
      <span>Subclass</span>
      <span style="text-align:right">Runs</span>
      <span style="text-align:right">Avg F</span>
      <span style="text-align:right">Best</span>
      <span style="text-align:right">Deaths</span>
    </div>
    <div id="bot-subclass-rows"></div>
  </div>
</div>

<!-- ── LOG PANE ───────────────────────────────────── -->
<div id="bp-log" class="bpane">
  <div id="bot-log-tabs">
    <button class="blt on" onclick="_bot.filter('all')">All</button>
    <button class="blt" onclick="_bot.filter('floor')">Floors</button>
    <button class="blt" onclick="_bot.filter('death')">Deaths</button>
    <button class="blt" onclick="_bot.filter('warn')">Warns</button>
    <button class="blt" onclick="_bot.filter('error')">Errors</button>
    <button class="blt" onclick="_bot.filter('event')">Events</button>
    <button class="bc" onclick="_bot.copyLog()" style="margin-left:auto;font-size:9px;padding:2px 8px">⎘ Copy</button>
  </div>
  <div id="bot-log-wrap"><div id="bot-log"></div></div>
  <div id="bot-errs" style="display:none">
    <div id="bot-errs-head">
      ⚠ Errors<span id="bot-ec" style="font-weight:700;margin-left:4px"></span>
      <button class="bc" onclick="_bot.clearErr()" style="margin-left:auto;font-size:9px;padding:1px 6px">Clear</button>
      <button class="bc" onclick="_bot.copyErr()" style="font-size:9px;padding:1px 6px">Copy</button>
    </div>
    <div id="bot-err-log"></div>
  </div>
</div>

<!-- ── ITEMS PANE ─────────────────────────────────── -->
<div id="bp-items" class="bpane" style="padding:10px 14px">
  <div class="bi-cols">
    <div>
      <div class="bi-h">Found <span id="bi-found-ct" style="color:#c8922a"></span></div>
      <div class="bi-list" id="bi-found"></div>
    </div>
    <div>
      <div class="bi-h">Used <span id="bi-used-ct" style="color:#c8922a"></span></div>
      <div class="bi-list" id="bi-used"></div>
    </div>
  </div>
</div>

<!-- ── CONFIG PANE ────────────────────────────────── -->
<div id="bp-cfg" class="bpane">
  <div class="bcfg-section">
    <div class="bcfg-label">Classes to test</div>
    <div class="bcfg-classes" id="bcfg-classes">
      <button class="bcfg-cls-btn warrior on" onclick="_bot.toggleCls('warrior')">Warrior</button>
      <button class="bcfg-cls-btn rogue on"   onclick="_bot.toggleCls('rogue')">Rogue</button>
      <button class="bcfg-cls-btn mage on"    onclick="_bot.toggleCls('mage')">Mage</button>
      <button class="bcfg-cls-btn cleric on"  onclick="_bot.toggleCls('cleric')">Cleric</button>
    </div>
  </div>
  <div class="bcfg-section">
    <div class="bcfg-label">Batch settings</div>
    <div class="bcfg-row">
      <label>Runs per class</label>
      <input class="bcfg-input" id="bcfg-runs" type="number" min="1" max="200" value="20">
    </div>
    <div class="bcfg-row">
      <label>Tick speed (ms)</label>
      <input class="bcfg-input" id="bcfg-tick" type="number" min="15" max="1000" value="120">
    </div>
    <div class="bcfg-row">
      <label>Floor tick cap</label>
      <input class="bcfg-input" id="bcfg-floorcap" type="number" min="500" max="10000" value="2500">
    </div>
    <div class="bcfg-row">
      <label>Stuck watchdog (sec, 0=off)</label>
      <input class="bcfg-input" id="bcfg-watchdog" type="number" min="0" max="600" value="30">
    </div>
    <div class="bcfg-row">
      <label>Ability cooldown (ticks)</label>
      <input class="bcfg-input" id="bcfg-abilitycd" type="number" min="0" max="20" value="4">
    </div>
  </div>
  <div class="bcfg-section">
    <div class="bcfg-label">Behaviour</div>
    <div class="bcfg-check-row">
      <input type="checkbox" id="bcfg-autothrottle" onchange="_autoThrottle=this.checked;if(!this.checked)_autoThrottleLastPhase=''">
      <span>Auto-throttle speed (turbo in tavern, slow when hurt)</span>
    </div>
    <div class="bcfg-check-row">
      <input type="checkbox" id="bcfg-autorestart" checked onchange="CFG.autoRestart=this.checked">
      <span>Auto-restart after death</span>
    </div>
    <div class="bcfg-check-row">
      <input type="checkbox" id="bcfg-loopbatch" onchange="CFG.loopBatch=this.checked">
      <span>Loop batch forever (overnight runs)</span>
    </div>
    <div class="bcfg-check-row">
      <input type="checkbox" id="bcfg-arena" onchange="_bot.setCfg('arena',this.checked)">
      <span>Visit arena when eligible</span>
    </div>
    <div class="bcfg-check-row">
      <input type="checkbox" id="bcfg-flee" checked onchange="_bot.setCfg('flee',this.checked)">
      <span>Flee when HP critical</span>
    </div>
  </div>
  <div class="bcfg-section">
    <div class="bcfg-label">Thresholds</div>
    <div class="bcfg-row">
      <label>Heal potion at HP%</label>
      <input class="bcfg-input" id="bcfg-healat" type="number" min="10" max="90" value="50">
    </div>
    <div class="bcfg-row">
      <label>Flee dungeon at HP%</label>
      <input class="bcfg-input" id="bcfg-fleeat" type="number" min="5" max="50" value="25">
    </div>
    <div class="bcfg-row">
      <label>Bank gold above</label>
      <input class="bcfg-input" id="bcfg-bankat" type="number" min="0" max="500" value="120">
    </div>
  </div>
  <button class="bc bcfg-apply" onclick="_bot.applyConfig()">✓ Apply Configuration</button>
  <div style="margin-top:10px;padding-top:8px;border-top:1px solid #1a1208;text-align:center;font-size:9px;color:#3a2a18">
    Bot Controller <span style="color:#c8922a">v${BOT_VERSION}</span> · ${BOT_BUILD_DATE}
    · <span style="cursor:pointer;text-decoration:underline" onclick="_bot.version()">changelog</span>
  </div>
</div>
`;
    document.body.appendChild(el);
    makeDrag(el, document.getElementById('bot-tb'));

    // Wire up nav tab switcher at runtime
    window._botNav = 'run';
}



function makeDrag(el, handle) {
    let ox=0,oy=0,sx=0,sy=0;
    handle.onmousedown = e => {
        e.preventDefault();
        const r=el.getBoundingClientRect();
        ox=r.left; oy=r.top; sx=e.clientX; sy=e.clientY;
        const mm=e2=>{ el.style.left=(ox+e2.clientX-sx)+'px'; el.style.top=(oy+e2.clientY-sy)+'px'; el.style.right='auto'; el.style.bottom='auto'; };
        const mu=()=>{ document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); };
        document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu);
    };
}

function renderLog() {
    const el=document.getElementById('bot-log'); if(!el)return;
    const filtered = _logFilter === 'all'
        ? logs.slice(0,80)
        : logs.filter(e => e.type === _logFilter).slice(0,80);
    el.innerHTML=filtered.map(e=>`<div class="bl ${e.type}">[${ts(e.t)}] ${esc(e.msg)}</div>`).join('');
}
function renderErrors() {
    const sec=document.getElementById('bot-errs'), el=document.getElementById('bot-err-log'), ct=document.getElementById('bot-ec');
    if(!sec||!el||!ct)return;
    sec.style.display=errors.length?'block':'none';
    // Group identical messages so a bug firing 100×/sec shows as one row with a
    // ×100 badge instead of flooding the panel and hiding everything else.
    // Preserve the richest snapshot seen for each unique message.
    const groups = new Map();
    for (const e of errors) {
        const g = groups.get(e.msg) || { msg: e.msg, count: 0, last: e.t, ctx: e.ctx, snapshot: null };
        g.count++;
        if (e.t > g.last) { g.last = e.t; if (e.snapshot) g.snapshot = e.snapshot; }
        else if (!g.snapshot && e.snapshot) g.snapshot = e.snapshot;
        groups.set(e.msg, g);
    }
    const uniq  = [...groups.values()].sort((a,b)=>b.last-a.last);
    const total = errors.length;
    const suppNote = _errRate.suppressed > 0 ? ` · ${_errRate.suppressed} suppressed` : '';
    ct.textContent = ` ${total} total · ${uniq.length} unique${suppNote}`;
    el.innerHTML = uniq.slice(0,40).map(g => {
        const snap = g.snapshot;
        const snapHtml = snap
            ? `<div style="color:#4a5a68;font-size:8px;padding:1px 0 2px 8px">` +
              `F${snap.floor} · ${snap.mode} · ${snap.class}${snap.sub ? '/'+snap.sub : ''} · ` +
              `HP ${snap.hp} · ${snap.enemies}✕enemies · goal: ${esc(snap.goal)}</div>`
            : '';
        return `<div class="be">[${ts(g.last)}] ${esc(g.msg)}` +
               `${g.count>1?` <span style="color:#ffd65a;font-weight:700">×${g.count}</span>`:''}` +
               `</div>${snapHtml}`;
    }).join('');
}

// ── Items panel ────────────────────────────────────────────────────────────
function renderItems() {
    if (window._botNav !== 'items') return; // skip DOM rebuild when tab not visible
    const foundEl=document.getElementById('bi-found'), usedEl=document.getElementById('bi-used');
    const fct=document.getElementById('bi-found-ct'), uct=document.getElementById('bi-used-ct');
    if(!foundEl||!usedEl)return;

    const foundArr=[...itemLog.found.entries()].sort((a,b)=>b[1].count-a[1].count);
    const usedArr =[...itemLog.used.entries()].sort((a,b)=>b[1].count-a[1].count);
    const totalFound=foundArr.reduce((n,[,e])=>n+e.count,0);
    const totalUsed =usedArr.reduce((n,[,e])=>n+e.count,0);
    if(fct)fct.textContent=totalFound?`(${totalFound})`:'';
    if(uct)uct.textContent=totalUsed?`(${totalUsed})`:'';

    foundEl.innerHTML = foundArr.length
        ? foundArr.map(([nm,e])=>`<div class="bi-row"><span class="bi-nm bi-r-${e.rarity||'common'}">${esc(nm)}</span><span class="bi-ct">${e.count}</span></div>`).join('')
        : '<div class="bi-empty">Nothing found yet</div>';
    usedEl.innerHTML = usedArr.length
        ? usedArr.map(([nm,e])=>`<div class="bi-row"><span class="bi-nm">${esc(nm)}</span><span class="bi-ct">${e.count}</span></div>`).join('')
        : '<div class="bi-empty">Nothing used yet</div>';
}
// ── Report panel ──────────────────────────────────────────────────────────
// Shown when Report is clicked but no runs have finished yet, so the user gets
// a clear explanation instead of a blank table.
function showEmptyReport() {
    document.getElementById('bot-report')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'bot-report';
    overlay.style.cssText = `position:fixed;inset:0;z-index:10000;background:rgba(5,3,1,.88);display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace`;
    overlay.innerHTML = `
    <div style="background:#0d0a06;border:1px solid #3a2810;border-radius:12px;width:420px;max-width:92vw;box-shadow:0 16px 60px rgba(0,0,0,.8)">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;background:#181208;border-bottom:1px solid #2a1e10;border-radius:11px 11px 0 0">
            <span style="color:#c8922a;font-size:16px;font-weight:700;flex:1">&#128202; Bot Report</span>
            <button onclick="document.getElementById('bot-report').remove()" style="background:#1e140a;border:1px solid #3a2810;border-radius:5px;color:#e2ccaa;padding:5px 12px;cursor:pointer;font:inherit;font-size:11px">&#10005; Close</button>
        </div>
        <div style="padding:24px 18px;text-align:center">
            <p style="color:#e2ccaa;font-size:13px;margin:0 0 12px">No completed runs yet.</p>
            <p style="color:#7a6a58;font-size:11px;margin:0;line-height:1.6">
                The report compares each class across finished runs (average floor,
                death rate, kills, difficulty walls).<br><br>
                Click <span style="color:#c8922a">&#9636; Batch</span> to run all classes
                automatically, or just <span style="color:#c8922a">&#9654; Start</span> the bot
                and let a few runs finish &mdash; then open this report.
            </p>
        </div>
    </div>`;
    document.body.appendChild(overlay);
}

function showReportPanel(rows, heatmap, buildSummary) {
    document.getElementById('bot-report')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bot-report';
    overlay.style.cssText = `position:fixed;inset:0;z-index:10000;background:rgba(5,3,1,.88);display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace`;

    // Find the worst death-floor cluster for a quick "difficulty wall" note
    const allFloors = [];
    rows.forEach(r => r.deathFloors.forEach(f => allFloors.push(f)));
    const floorBuckets = {};
    allFloors.forEach(f => { const b = Math.floor(f/5)*5; floorBuckets[b] = (floorBuckets[b]||0)+1; });
    const wall = Object.entries(floorBuckets).sort((a,b)=>b[1]-a[1])[0];
    const wallNote = wall ? `Most deaths cluster around floor ${wall[0]}-${+wall[0]+4} (${wall[1]} deaths)` : '';

    const fmt = n => (Math.round(n*10)/10).toFixed(1);
    const bar = (pct, color) => `<div style="height:5px;background:#1a1208;border-radius:3px;overflow:hidden;margin-top:3px"><div style="height:100%;width:${Math.min(100,pct)}%;background:${color};border-radius:3px"></div></div>`;

    const maxAvg = Math.max(...rows.map(r=>r.avgFloor), 1);

    const rowsHtml = rows.map((r,i) => `
        <tr style="border-bottom:1px solid #1e140a">
            <td style="padding:8px 10px;color:${i===0?'#ffd65a':'#e2ccaa'};font-weight:${i===0?'700':'400'}">${i===0?'★ ':''}${cap(r.cls)}</td>
            <td style="padding:8px 10px;text-align:center;color:#c8922a;font-weight:700">${fmt(r.avgFloor)}${bar(r.avgFloor/maxAvg*100,'#c8922a')}</td>
            <td style="padding:8px 10px;text-align:center;color:#a08060">${r.medFloor}</td>
            <td style="padding:8px 10px;text-align:center;color:#58c26d">${r.bestFloor}</td>
            <td style="padding:8px 10px;text-align:center;color:#e2ccaa">${fmt(r.avgKills)}</td>
            <td style="padding:8px 10px;text-align:center;color:${r.deathRate>80?'#e04444':'#ff9f58'}">${Math.round(r.deathRate)}%${bar(r.deathRate,r.deathRate>80?'#e04444':'#ff9f58')}</td>
            <td style="padding:8px 10px;text-align:center;color:#62b9ff">${r.runs}</td>
        </tr>`).join('');

    overlay.innerHTML = `
    <div style="background:#0d0a06;border:1px solid #3a2810;border-radius:12px;width:680px;max-width:94vw;max-height:88vh;overflow-y:auto;box-shadow:0 16px 60px rgba(0,0,0,.8)">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;background:#181208;border-bottom:1px solid #2a1e10;border-radius:11px 11px 0 0;position:sticky;top:0">
            <span style="color:#c8922a;font-size:16px;font-weight:700;flex:1">&#9876; Bot Batch Report</span>
            <button onclick="_bot.exportCSV()" style="background:#1e140a;border:1px solid #3a2810;border-radius:5px;color:#c8922a;padding:5px 12px;cursor:pointer;font:inherit;font-size:11px">Copy CSV</button>
            <button onclick="document.getElementById('bot-report').remove()" style="background:#1e140a;border:1px solid #3a2810;border-radius:5px;color:#e2ccaa;padding:5px 12px;cursor:pointer;font:inherit;font-size:11px">✕ Close</button>
        </div>
        <div style="padding:16px 18px">
            <p style="color:#7a6a58;font-size:11px;margin:0 0 12px">${runRecords.length} runs across ${rows.length} classes. Sorted by average floor depth reached.<br><span style="color:#58c26d">${_persistedRuns.length} total runs saved to disk</span> — survives reload/crash. Use <span style="color:#c8922a">💾 Download CSV</span> to capture everything.</p>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                    <tr style="border-bottom:2px solid #2a1e10;color:#5a4a38;font-size:10px;text-transform:uppercase;letter-spacing:.05em">
                        <th style="padding:6px 10px;text-align:left">Class</th>
                        <th style="padding:6px 10px">Avg Floor</th>
                        <th style="padding:6px 10px">Median</th>
                        <th style="padding:6px 10px">Best</th>
                        <th style="padding:6px 10px">Avg Kills</th>
                        <th style="padding:6px 10px">Death Rate</th>
                        <th style="padding:6px 10px">Runs</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
            ${wallNote ? `<div style="margin-top:14px;padding:10px 14px;background:#1e1408;border-left:3px solid #c8922a;border-radius:4px;color:#e2ccaa;font-size:11px">&#9888; ${wallNote}</div>` : ''}
            ${heatmap && heatmap.length ? `
            <div style="margin-top:18px">
                <div style="color:#e04444;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">&#128293; Death Heatmap — by floor</div>
                <div style="display:flex;flex-wrap:wrap;gap:5px">
                    ${heatmap.slice(0,15).map(h => {
                        const maxCount = heatmap[0].count;
                        const intensity = Math.round(h.count/maxCount*100);
                        const bg = `rgba(200,40,40,${(intensity/100*0.7+0.1).toFixed(2)})`;
                        return `<div style="background:${bg};border:1px solid rgba(200,40,40,.4);border-radius:5px;padding:4px 8px;font-size:11px;text-align:center;min-width:48px">
                            <div style="color:#ffd65a;font-weight:700">F${h.floor}</div>
                            <div style="color:#ff9090;font-size:9px">${h.count} ☠</div>
                        </div>`;
                    }).join('')}
                </div>
                ${heatmap.length > 0 ? `<div style="color:#5a4a38;font-size:9px;margin-top:6px">Most deadly floor: <span style="color:#e04444">F${heatmap[0].floor}</span> (${heatmap[0].count} deaths)</div>` : ''}
            </div>` : ''}
            ${buildSummary && buildSummary.some(b=>b.bestWeapon) ? `
            <div style="margin-top:16px">
                <div style="color:#62b9ff;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">&#9876; Best Weapon per Build</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
                    ${buildSummary.filter(b=>b.bestWeapon).map(b=>`
                    <div style="background:#0d0a06;border-radius:4px;padding:5px 8px;font-size:10px">
                        <span style="color:#c8922a">${b.cls}</span>
                        <span style="color:#5a4a38"> → </span>
                        <span style="color:#e2ccaa">${b.bestWeapon.weapon}</span>
                        <span style="color:#5a4a38;font-size:9px"> (avg F${b.bestWeapon.avgFloor.toFixed(1)})</span>
                    </div>`).join('')}
                </div>
            </div>` : ''}
            <p style="color:#5a4a38;font-size:10px;margin:14px 0 0">Tip: console has the full table (F12). Use <span style="color:#c8922a">_bot.exportCSV()</span> for raw data.</p>
        </div>
    </div>`;
    document.body.appendChild(overlay);
}

function cap(s) { return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

const CLS_ICON = { warrior:'⚔', rogue:'🗡', mage:'🔮', cleric:'✝' };
const CLS_COLOR = { warrior:'#c8922a', rogue:'#58c26d', mage:'#7bb0ff', cleric:'#e0c0ff' };

function renderStats() {
    if(minimized) return;
    const s=gs(), p=pp();

    // ── Run card ──────────────────────────────────────────────────────────
    const card = document.getElementById('bot-run-card');
    if (card) {
        card.style.display = running && p ? 'block' : 'none';
        if (running && p) {
            const cls = p.className || '?';
            const sub = p.subclass ? ' — ' + p.subclass : '';
            const icon = CLS_ICON[cls] || '?';
            const clr = CLS_COLOR[cls] || '#c8922a';
            const clsEl = document.getElementById('bot-cls-label');
            if (clsEl) { clsEl.textContent = icon+' '+cls.charAt(0).toUpperCase()+cls.slice(1)+sub; clsEl.style.color = clr; }
            const flEl = document.getElementById('bot-floor-badge');
            if (flEl) flEl.textContent = s ? 'F'+(s.floor===0?'hub':s.floor) : '?';
            const runEl = document.getElementById('bot-run-num');
            if (runEl) runEl.textContent = batch.active ? `Run ${batch.runIdx+1}/${batch.runsEach}` : `Run #${stats.runs}`;
            const hpBar = document.getElementById('bot-hp-bar');
            const frac = p.maxHp > 0 ? Math.max(0, p.hp/p.maxHp) : 0;
            if (hpBar) {
                hpBar.style.width = (frac*100).toFixed(1)+'%';
                hpBar.style.background = frac > 0.5 ? 'linear-gradient(90deg,#2d7a2d,#43a843)'
                    : frac > 0.25 ? 'linear-gradient(90deg,#a06020,#e07820)'
                    : 'linear-gradient(90deg,#8b1a1a,#e53935)';
            }
            const setEl = (id,v) => { const el=document.getElementById(id); if(el)el.textContent=v; };
            setEl('bm-hp', p.hp+'/'+p.maxHp);
            setEl('bm-lv', p.level||1);
            setEl('bm-kills', Math.max(0, stats.kills - batch.startKills));
            setEl('bm-gold', (p.gold||0)+'g');
            // XP progress to next level
            if (p.xp !== undefined && typeof getXpToLevel === 'function') {
                try {
                    const needed = getXpToLevel();
                    const xpPct = needed > 0 ? Math.min(100, Math.round(p.xp/needed*100)) : 100;
                    setEl('bm-xp', xpPct+'%');
                } catch(_) { setEl('bm-xp', '—'); }
            }
            const goalEl = document.getElementById('bot-goal');
            if (goalEl) goalEl.textContent = goalText;
            // Display row: live FPS + current mode. Color-codes by health so a
            // tanking frame rate is obvious at a glance during full-render runs.
            const fpsEl = document.getElementById('bot-fps-stat');
            if (fpsEl) {
                const modeLabel = _displayMode === 'full' ? '' : ` · ${_displayMode}`;
                fpsEl.textContent = `${_fpsValue} fps${modeLabel}`;
                fpsEl.style.color = _fpsValue >= 50 ? '#58c26d'
                    : _fpsValue >= 30 ? '#c8922a' : '#e04444';
            }
            // IMPROVE-1: seed display — copyable 7-char code
            const seedEl = document.getElementById('bot-seed');
            if (seedEl && s?.runSeed) {
                try {
                    const code = typeof seedToCode === 'function' ? seedToCode(s.runSeed) : String(s.runSeed);
                    if (seedEl.textContent !== code) {
                        seedEl.textContent = code;
                        seedEl.style.color = '#5a4a34';
                    }
                } catch(_) { seedEl.textContent = '?'; }
            }
        }
    }

    // ── Expanded session stats strip ──────────────────────────────────────
    // The "big picture" the user asked for: cumulative session metrics that
    // persist across runs, derived from the live `stats` + `_sessionStats` and
    // the wall-clock session start. Updates every renderStats tick.
    {
        const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const runs = stats.runs || 0;
        const deaths = stats.deaths || 0;
        const best = Math.max(stats.bestFloor || 0, _sessionStats.bestFloor || 0);
        // Average floor reached across recorded runs (uses run history if present).
        const floorsArr = (stats.floors && stats.floors.length) ? stats.floors : [];
        const avgF = floorsArr.length
            ? (floorsArr.reduce((a, b) => a + b, 0) / floorsArr.length)
            : 0;
        const killsPerRun = runs > 0 ? (stats.kills || 0) / runs : 0;
        const goldPerRun  = runs > 0 ? (stats.gold || 0) / runs : 0;
        // Elapsed wall-clock this session (seconds), plus any banked time.
        const elapsedSec = Math.round((Date.now() - _sessionStart) / 1000)
            + (_sessionStats.totalTime || 0);
        const runsPerHr = elapsedSec > 0 ? (runs / (elapsedSec / 3600)) : 0;
        const mins = Math.floor(elapsedSec / 60);
        const timeStr = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`;

        setEl('bss-runs', runs);
        setEl('bss-deaths', deaths);
        setEl('bss-best', best);
        setEl('bss-avg', avgF ? avgF.toFixed(1) : '—');
        setEl('bss-kpr', killsPerRun ? killsPerRun.toFixed(1) : '0');
        setEl('bss-gpr', goldPerRun ? Math.round(goldPerRun) : '0');
        setEl('bss-rate', runsPerHr ? runsPerHr.toFixed(1) : '0');
        setEl('bss-time', timeStr);
    }

    // ── Batch progress (shown in Batch tab) ───────────────────────────────
    if (batch.active || Object.keys(liveClassStats).length > 0) {
        const total = batch.classes.length * batch.runsEach;
        const done = batch.classIdx * batch.runsEach + batch.runIdx;
        const pct = total > 0 ? Math.round(done/total*100) : 0;
        const rowsEl = document.getElementById('bot-batch-rows');
        if (rowsEl) {
            rowsEl.innerHTML = batch.classes.map((cls, ci) => {
                const clsDone = ci < batch.classIdx ? batch.runsEach
                    : ci === batch.classIdx ? batch.runIdx : 0;
                const pctW = (clsDone/batch.runsEach*100).toFixed(1);
                const cs = liveClassStats[cls];
                const avgStr = cs && cs.runs > 0 ? (cs.totalFloor/cs.runs).toFixed(1) : '—';
                return `<div class="bbat-row">
                    <span class="bbat-cls ${cls}">${CLS_ICON[cls]||''} ${cls}</span>
                    <div class="bbat-bar-wrap"><div class="bbat-bar ${cls}" style="width:${pctW}%"></div></div>
                    <span class="bbat-num">${clsDone}/${batch.runsEach}</span>
                    <span class="bbat-avg">${avgStr}</span>
                </div>`;
            }).join('');
        }
        const fillEl = document.getElementById('bot-batch-pbar-fill');
        const pctEl  = document.getElementById('bot-batch-pct');
        const lblEl  = document.getElementById('bot-batch-label');
        if (lblEl) lblEl.textContent = done+' / '+total+' runs';
        if (fillEl) fillEl.style.width = pct+'%';
        if (pctEl)  pctEl.textContent = pct+'%';
    }

    // ── Live class stats ──────────────────────────────────────────────────
    const statsRows = document.getElementById('bot-class-rows');
    if (statsRows && Object.keys(liveClassStats).length > 0) {
        const classes = ['warrior','rogue','mage','cleric'];
        statsRows.innerHTML = classes.map(cls => {
            const cs = liveClassStats[cls];
            if (!cs || cs.runs === 0) return `<div class="bcs-row ${cls}"><span class="bcs-cls">${CLS_ICON[cls]||''} ${cls}</span><span class="bcs-val" style="color:#2a1e10">—</span><span class="bcs-val" style="color:#2a1e10">—</span><span class="bcs-val" style="color:#2a1e10">—</span><span class="bcs-val" style="color:#2a1e10">—</span></div>`;
            const avg = (cs.totalFloor/cs.runs).toFixed(1);
            const dr  = Math.round(cs.deaths/cs.runs*100);
            const drClass = dr>80?'bad':dr>50?'warn':'hi';
            return `<div class="bcs-row ${cls}"><span class="bcs-cls">${CLS_ICON[cls]||''} ${cls}</span><span class="bcs-val">${cs.runs}</span><span class="bcs-val">${avg}</span><span class="bcs-val hi">${cs.bestFloor}</span><span class="bcs-val ${drClass}">${dr}%</span></div>`;
        }).join('');
        document.getElementById('bot-class-stats').style.display='block';
    }

    const pEl=document.getElementById('bot-path-stat');
    if(pEl) pEl.textContent = botPathStats.searches
        ? `A*:${botPathStats.lastNodes}n${botPathStats.fails?' ✗'+botPathStats.fails:''}` : '';

    // ── Sparkline HP timeline ─────────────────────────────────────────────
    const sparkCanvas = document.getElementById('bot-sparkline');
    if (sparkCanvas && _hpHistory.length > 1) {
        const sc = sparkCanvas.getContext('2d');
        const sw = sparkCanvas.width, sh = sparkCanvas.height;
        sc.clearRect(0, 0, sw, sh);
        // Threshold lines
        sc.strokeStyle = 'rgba(200,40,40,0.25)'; sc.lineWidth = 1;
        sc.beginPath(); const panicY = sh - (CFG.fleeAt||0.25) * sh;
        sc.moveTo(0, panicY); sc.lineTo(sw, panicY); sc.stroke();
        sc.strokeStyle = 'rgba(255,165,0,0.18)';
        sc.beginPath(); const healY = sh - (CFG.healAt||0.5) * sh;
        sc.moveTo(0, healY); sc.lineTo(sw, healY); sc.stroke();
        // HP line
        sc.beginPath();
        _hpHistory.forEach((v, i) => {
            const x = (i / (_hpHistory.length - 1)) * sw;
            const y = sh - v * (sh - 2) - 1;
            i === 0 ? sc.moveTo(x, y) : sc.lineTo(x, y);
        });
        // Color by current HP
        const curHp = _hpHistory[_hpHistory.length-1];
        sc.strokeStyle = curHp > 0.5 ? '#43a843' : curHp > 0.25 ? '#e07820' : '#e53935';
        sc.lineWidth = 1.5; sc.stroke();
        // Fill
        sc.lineTo(sw, sh); sc.lineTo(0, sh); sc.closePath();
        sc.fillStyle = curHp > 0.5 ? 'rgba(67,168,67,0.12)' : curHp > 0.25 ? 'rgba(224,120,32,0.12)' : 'rgba(229,57,53,0.12)';
        sc.fill();
    }

    // ── Kill feed ─────────────────────────────────────────────────────────
    const kfWrap = document.getElementById('bot-killfeed-wrap');
    const kfEl = document.getElementById('bot-killfeed');
    if (kfWrap && kfEl) {
        kfWrap.style.display = _killFeed.length ? 'block' : 'none';
        if (_killFeed.length) {
            kfEl.innerHTML = _killFeed.slice(0, 8).map(k =>
                `<div style="font-size:9px;line-height:1.55;color:#5a4a34;padding:1px 0;border-bottom:1px solid #0d0b08">
                    <span style="color:#3a2a18">F${k.floor}</span>
                    <span style="color:#c8922a;margin:0 4px">${k.name}</span>
                </div>`
            ).join('');
        }
    }

    // ── Subclass breakdown (Batch tab) ────────────────────────────────────
    const scWrap = document.getElementById('bot-subclass-stats');
    const scRows = document.getElementById('bot-subclass-rows');
    if (scWrap && scRows && Object.keys(liveSubclassStats).length) {
        scWrap.style.display = 'block';
        const CLS_COLOR2 = { warrior:'#c8922a', rogue:'#58c26d', mage:'#7bb0ff', cleric:'#d0a0ff' };
        scRows.innerHTML = Object.entries(liveSubclassStats)
            .sort((a,b) => b[1].runs - a[1].runs)
            .map(([id, ss]) => {
                const avg = ss.runs > 0 ? (ss.totalFloor/ss.runs).toFixed(1) : '—';
                const dr = ss.runs > 0 ? Math.round(ss.deaths/ss.runs*100) : 0;
                const drCls = dr>80?'bad':dr>50?'warn':'hi';
                const col = CLS_COLOR2[ss.cls] || '#c8922a';
                return `<div class="bcs-row" style="color:${col}">
                    <span class="bcs-cls" style="color:${col}">${id}</span>
                    <span class="bcs-val">${ss.runs}</span>
                    <span class="bcs-val">${avg}</span>
                    <span class="bcs-val hi">${ss.bestFloor}</span>
                    <span class="bcs-val ${drCls}">${dr}%</span>
                </div>`;
            }).join('');
    }

    // ── History tab ───────────────────────────────────────────────────────
    if (window._botNav === 'history') {
        // Session stats header
        const setH = id => { const e=document.getElementById(id); return v => e && (e.textContent=v); };
        setH('hist-count')(_runHistory.length);
        setH('hist-best')(_sessionStats.bestFloor || stats.bestFloor);
        setH('hist-deaths')(_sessionStats.totalDeaths);
        setH('hist-runs')(_sessionStats.totalRuns);

        // Floor death heatmap canvas
        const hmCanvas = document.getElementById('bot-heatmap');
        if (hmCanvas && Object.keys(_floorDeaths).length) {
            const hc = hmCanvas.getContext('2d');
            const hw = hmCanvas.width, hh = hmCanvas.height;
            hc.clearRect(0, 0, hw, hh);
            const maxFloor = 50;
            const maxDeaths = Math.max(1, ...Object.values(_floorDeaths));
            const cellW = hw / maxFloor;
            for (let f = 1; f <= maxFloor; f++) {
                const d = _floorDeaths[f] || 0;
                const intensity = d / maxDeaths;
                if (d > 0) {
                    hc.fillStyle = `rgba(225,75,75,${0.15 + intensity * 0.75})`;
                    hc.fillRect((f-1)*cellW + 0.5, 0.5, cellW-1, hh-1);
                    if (d > 1) {
                        hc.fillStyle = 'rgba(255,255,255,0.7)';
                        hc.font = '7px sans-serif';
                        hc.textAlign = 'center';
                        hc.fillText(d, (f-0.5)*cellW, hh-2);
                    }
                }
                // Floor number labels at milestones
                if (f % 10 === 0) {
                    hc.fillStyle = 'rgba(90,74,52,0.8)';
                    hc.font = '7px sans-serif';
                    hc.textAlign = 'center';
                    hc.fillText(f, (f-0.5)*cellW, 8);
                }
            }
        }

        // Run history cards
        const cardsEl = document.getElementById('bot-run-cards');
        if (cardsEl) {
            const OUTCOME_COLOR = { death:'#e04444', fled:'#ffd65a', clear:'#58c26d' };
            const OUTCOME_ICON  = { death:'☠', fled:'⬆', clear:'✓' };
            cardsEl.innerHTML = _runHistory.map(r => {
                const oc = OUTCOME_COLOR[r.outcome] || '#5a4a34';
                const oi = OUTCOME_ICON[r.outcome]  || '?';
                const age = Math.round((Date.now() - r.ts) / 60000);
                return `<div style="display:flex;align-items:center;gap:8px;padding:5px 6px;margin-bottom:3px;background:#0d0a06;border-radius:5px;border:1px solid #1a1208;font-size:10px">
                    <span style="color:${oc};font-size:12px;flex-shrink:0">${oi}</span>
                    <span style="color:#c8922a;font-weight:700;width:20px;flex-shrink:0">F${r.floor}</span>
                    <span style="color:#5a4a34;flex:1">${r.class} / ${r.subclass || '—'}</span>
                    <span style="color:#3a2a18">Lv${r.level}</span>
                    <span style="color:#3a2a18">⚔${r.kills}</span>
                    <span style="color:#c8922a">◈${r.gold}g</span>
                    <span style="color:#2a1e10;font-size:9px">${age}m ago</span>
                </div>`;
            }).join('') || '<div style="font-size:10px;color:#2a1e10;font-style:italic;padding:8px 0">No runs yet</div>';
        }
    }

    // ── Minimap ───────────────────────────────────────────────────────────
    const s2 = gs(), p2 = pp();
    const mmWrap = document.getElementById('bot-minimap-wrap');
    const mmCanvas = document.getElementById('bot-minimap');
    // Headless mode draws nothing; minimap+full modes both show the bot minimap.
    if (_displayMode === 'headless') {
        if (mmWrap) mmWrap.style.display = 'none';
    } else if (mmWrap && mmCanvas && s2?.dungeon && p2 && s2.floor > 0 && running) {
        mmWrap.style.display = 'block';
        const dungeon  = s2.dungeon;
        const revealed = s2.revealed || [];
        const H = dungeon.length, W = dungeon[0]?.length || 25;
        const DOT = 4;
        const mw = W * DOT, mh = H * DOT;
        if (mmCanvas.width !== mw || mmCanvas.height !== mh) {
            mmCanvas.width = mw; mmCanvas.height = mh;
        }
        const mc = mmCanvas.getContext('2d');
        mc.clearRect(0, 0, mw, mh);

        // Tiles
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const tile = dungeon[y][x];
                const rev  = revealed[y]?.[x];
                let color = '#0a0806';
                if (rev) {
                    if (tile === 1)      color = '#2a2d34'; // wall
                    else if (tile === 2) color = '#c8922a'; // down stairs
                    else if (tile === 4) color = '#7bb0ff'; // up stairs
                    else if (tile === 8) color = '#ff9f58'; // zone exit
                    else                 color = '#3a3028'; // floor
                }
                mc.fillStyle = color;
                mc.fillRect(x*DOT, y*DOT, DOT, DOT);
            }
        }

        // A* planned path — dim blue trail
        if (_lastPath.length > 1) {
            mc.strokeStyle = 'rgba(100,180,255,0.5)';
            mc.lineWidth = 1.5;
            mc.setLineDash([2, 2]);
            mc.beginPath();
            _lastPath.forEach((pt, i) => {
                const px2 = pt.x*DOT + DOT/2, py2 = pt.y*DOT + DOT/2;
                i === 0 ? mc.moveTo(px2, py2) : mc.lineTo(px2, py2);
            });
            mc.stroke();
            mc.setLineDash([]);
            if (_navTarget) {
                mc.fillStyle = 'rgba(100,180,255,0.75)';
                mc.beginPath();
                mc.arc(_navTarget.x*DOT+DOT/2, _navTarget.y*DOT+DOT/2, DOT*0.7, 0, Math.PI*2);
                mc.fill();
            }
        }

        // Items (yellow) + interactables (green)
        (s2.items||[]).forEach(it => {
            if (!revealed[it.y]?.[it.x]) return;
            mc.fillStyle = '#ffe84a';
            mc.fillRect(it.x*DOT+1, it.y*DOT+1, DOT-2, DOT-2);
        });
        (s2.interactables||[]).forEach(it => {
            if (!revealed[it.y]?.[it.x]) return;
            mc.fillStyle = '#50ff80';
            mc.fillRect(it.x*DOT+1, it.y*DOT+1, DOT-2, DOT-2);
        });

        // Enemies — red (boss: orange, larger)
        (s2.enemies||[]).filter(e => e.hp > 0 && revealed[e.y]?.[e.x]).forEach(e => {
            mc.fillStyle = e.type === 'boss' ? '#ff9900' : '#ff5050';
            mc.beginPath();
            mc.arc(e.x*DOT+DOT/2, e.y*DOT+DOT/2, e.type==='boss'?DOT*0.85:DOT*0.6, 0, Math.PI*2);
            mc.fill();
        });

        // Player — bright gold, glow
        mc.fillStyle = '#ffe84a';
        mc.shadowColor = '#ffe84a';
        mc.shadowBlur  = 5;
        mc.beginPath();
        mc.arc(p2.x*DOT+DOT/2, p2.y*DOT+DOT/2, DOT*0.8, 0, Math.PI*2);
        mc.fill();
        mc.shadowBlur = 0;

    } else if (mmWrap && (!running || s2?.floor === 0)) {
        mmWrap.style.display = 'none';
    }

    // ── Pathfinder diagnostics ────────────────────────────────────────────
    const diagWrap   = document.getElementById('bot-diag-wrap');
    const diagGrid   = document.getElementById('bot-diag-grid');
    const diagFloors = document.getElementById('bot-diag-floors');
    if (diagWrap && botPathStats.searches > 0) {
        diagWrap.style.display = 'block';

        const cell = (label, val, col) =>
            `<div style="background:#0d0a06;border-radius:4px;padding:4px 6px;border:1px solid #1a1208">
                <div style="font-size:8px;color:#2a1e10;text-transform:uppercase;letter-spacing:.04em">${label}</div>
                <div style="font-size:13px;font-weight:700;color:${col||'#c8922a'}">${val}</div>
            </div>`;

        const failPct = Math.round(botPathStats.fails / botPathStats.searches * 100);
        const fpCol   = failPct > 20 ? '#e04444' : failPct > 8 ? '#ffd65a' : '#58c26d';

        if (diagGrid) diagGrid.innerHTML =
            cell('Searches/s', botPathStats.searchesPerSec) +
            cell('Avg nodes', botPathStats.avgNodes) +
            cell('Peak nodes', botPathStats.worstNodes, botPathStats.worstNodes > 800 ? '#e04444' : '#c8922a') +
            cell('Fails', botPathStats.fails, failPct > 10 ? '#e04444' : '#5a4a34') +
            cell('Fail rate', failPct + '%', fpCol) +
            cell('Total', botPathStats.searches);

        // Top 5 most expensive floors by avg node count
        if (diagFloors) {
            const entries = Object.entries(botPathStats.nodesByFloor)
                .map(([fl, d]) => ({ fl:+fl, avg:Math.round(d.total/d.count), n:d.count }))
                .sort((a, b) => b.avg - a.avg)
                .slice(0, 5);
            if (entries.length) {
                const peak = entries[0].avg || 1;
                diagFloors.innerHTML =
                    '<div style="font-size:8px;color:#2a1e10;text-transform:uppercase;margin-bottom:4px">Costliest floors (avg nodes)</div>' +
                    entries.map(f => {
                        const pct = f.avg / peak;
                        const col = pct > 0.75 ? '#e04444' : pct > 0.45 ? '#ffd65a' : '#c8922a';
                        return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;font-size:9px">
                            <span style="color:#5a4a34;width:28px;flex-shrink:0">F${f.fl}</span>
                            <div style="flex:1;height:5px;background:#080604;border-radius:2px;overflow:hidden">
                                <div style="width:${Math.round(pct*100)}%;height:100%;background:${col};border-radius:2px"></div>
                            </div>
                            <span style="color:${col};width:34px;text-align:right">${f.avg}n</span>
                            <span style="color:#2a1e10;width:22px;text-align:right">×${f.n}</span>
                        </div>`;
                    }).join('');
            }
        }
    }
}

// ── Public API ─────────────────────────────────────────────────────────────
window._bot = {
    toggle() {
        if(running){
            running=false; clearInterval(tickTimer); tickTimer=null;
            const b=document.getElementById('bot-run-btn');
            if(b){b.textContent='▶ Start';b.classList.remove('on');}
            // Restore the main render on pause so you can actually see the game
            // state you stopped to inspect, even if running in a fast display
            // mode. The chosen _displayMode is re-applied on resume below.
            window._botSkipRender = false;
            { const gc = document.getElementById('game-canvas'); if (gc) gc.style.visibility = ''; }
            if (typeof draw === 'function') { try { draw(); } catch(_){} }
            log('Paused','info');
        } else {
            // Audit required game functions on every start so a missing hook
            // surfaces immediately as an error, not as a silent no-op later.
            checkGameFunctions();
            running=true; patchFns();
            // Re-apply the chosen display mode (pause restored full rendering).
            window._botSkipRender = (_displayMode !== 'full');
            { const gc = document.getElementById('game-canvas'); if (gc) gc.style.visibility = (_displayMode === 'full') ? '' : 'hidden'; }
            tickTimer=setInterval(tick, CFG.tickMs);
            const b=document.getElementById('bot-run-btn');
            if(b){b.textContent='⏸ Pause';b.classList.add('on');}
            log('Started','run');
        }
    },
    nav(tab) {
        window._botNav = tab;
        document.querySelectorAll('#bot-nav .bnt').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
        document.querySelectorAll('.bpane').forEach(p=>p.classList.toggle('on',p.id===`bp-${tab}`));
        if(tab==='items') renderItems();
        if(tab==='batch') renderStats();
        if(tab==='history') renderStats(); // triggers history rendering
    },
    min() {
        minimized=!minimized;
        document.getElementById('bot-nav').style.display=minimized?'none':'flex';
        document.querySelectorAll('.bpane').forEach(p=>p.style.display=minimized?'none':'');
    },
    spd(ms) {
        CFG.tickMs=ms;
        document.querySelectorAll('.bsp').forEach(b=>b.classList.remove('on'));
        const map={600:0,120:1,45:2,15:3};
        document.querySelectorAll('.bsp')[map[ms]??1]?.classList.add('on');
        if(running){clearInterval(tickTimer);tickTimer=setInterval(tick,ms);}
    },
    // Display performance mode: full | minimap | headless. Controls whether the
    // main game canvas (the "big map") and the bot minimap draw. Skipping the
    // main canvas is the single biggest per-frame speedup during fast runs.
    display(mode) {
        if (!['full','minimap','headless'].includes(mode)) mode = 'full';
        _displayMode = mode;
        // window._botSkipRender is read by gameLoop() in ui.js each frame to
        // skip the expensive draw() call.
        window._botSkipRender = (mode !== 'full');
        // Belt-and-suspenders: also hide the main canvas element directly. This
        // guarantees the "big map" disappears in minimap/headless mode even if
        // the gameLoop render-skip guard isn't present (e.g. an older ui.js) —
        // skipping draw() alone only freezes the last frame, it doesn't hide it.
        const gc = document.getElementById('game-canvas');
        if (gc) gc.style.visibility = (mode === 'full') ? '' : 'hidden';
        const idx = { full:0, minimap:1, headless:2 }[mode];
        document.querySelectorAll('.bdp').forEach((b,i)=>b.classList.toggle('on', i===idx));
        // Returning to full: clear the flag, restore the canvas, and force one
        // immediate redraw so the screen isn't left on a stale frame.
        if (mode === 'full' && typeof draw === 'function') { try { draw(); } catch(_){} }
        log(`Display: ${mode}`, 'info');
    },
    toggleCls(cls) {
        const idx = batch.classes.indexOf(cls);
        const btn = document.querySelector(`.bcfg-cls-btn.${cls}`);
        if(idx>=0){
            if(batch.classes.length<=1){return;} // keep at least 1
            batch.classes.splice(idx,1);
            btn?.classList.remove('on');
        } else {
            batch.classes.push(cls);
            btn?.classList.add('on');
        }
    },
    setCfg(key, val) {
        const map = {arena:'arenaMinGold', flee:'fleeAt'};
        if(key==='arena') CFG.arenaMinGold = val ? 80 : 99999;
        if(key==='flee') CFG.fleeAt = val ? 0.25 : 0;
    },
    applyConfig() {
        const runs = parseInt(document.getElementById('bcfg-runs')?.value)||20;
        const tick = parseInt(document.getElementById('bcfg-tick')?.value)||120;
        const cap  = parseInt(document.getElementById('bcfg-floorcap')?.value)||2500;
        const heal = parseInt(document.getElementById('bcfg-healat')?.value)||50;
        const flee = parseInt(document.getElementById('bcfg-fleeat')?.value)||25;
        const bank = parseInt(document.getElementById('bcfg-bankat')?.value)||120;
        const watchdog = parseInt(document.getElementById('bcfg-watchdog')?.value);
        const abilitycd = parseInt(document.getElementById('bcfg-abilitycd')?.value);
        batch.runsEach = Math.max(1, Math.min(200, runs));
        CFG.tickMs    = Math.max(15, Math.min(1000, tick));
        MAX_FLOOR_TICKS = Math.max(500, Math.min(10000, cap));
        CFG.healAt = Math.max(0.1, Math.min(0.9, heal/100));
        CFG.fleeAt = Math.max(0.05, Math.min(0.5, flee/100));
        CFG.bankAt = Math.max(0, Math.min(500, bank));
        // Watchdog: seconds → ms. NaN-guard keeps the existing value if the
        // field was cleared; clamp 0–600s (0 disables).
        if (!Number.isNaN(watchdog)) {
            CFG.floorWatchdogMs = Math.max(0, Math.min(600, watchdog)) * 1000;
        }
        if (!Number.isNaN(abilitycd)) {
            CFG.abilityCooldownTicks = Math.max(0, Math.min(20, abilitycd));
        }
        document.querySelectorAll('.bsp').forEach(b=>b.classList.remove('on'));
        // snap speed buttons to new tickMs
        this.spd(CFG.tickMs);
        if(running){clearInterval(tickTimer);tickTimer=setInterval(tick,CFG.tickMs);}
        log(`Config applied — ${batch.classes.length} classes × ${batch.runsEach} runs, ${CFG.tickMs}ms/tick`, 'info');
        this.nav('run');
    },
    clearErr(){ errors.length=0; renderErrors(); },
    // IMPROVE-1: copy current run seed to clipboard
    copySeed() {
        const s = gs();
        if (!s?.runSeed) { log('No seed yet — start a run first', 'warn'); return; }
        let code;
        try { code = typeof seedToCode === 'function' ? seedToCode(s.runSeed) : String(s.runSeed); }
        catch(_) { code = String(s.runSeed); }
        navigator.clipboard?.writeText(code)
            .then(() => log(`Seed ${code} copied to clipboard`, 'info'))
            .catch(() => log(`Seed: ${code} (clipboard blocked)`, 'info'));
    },
    // IMPROVE-2: show event stats summary in console
    eventStats() {
        const rows = Object.entries(_eventStats)
            .sort((a,b) => b[1].count - a[1].count)
            .map(([k,v]) => ({
                event: k.replace('event_',''),
                count: v.count,
                avgGold: v.count ? Math.round(v.goldTotal/v.count) : 0,
                avgHp:   v.count ? Math.round(v.hpTotal/v.count) : 0,
            }));
        console.table(rows);
        log(`Event stats: ${rows.length} types — see console`, 'info');
        return rows;
    },
    // Print the running version and full changelog — answers "what's in the
    // file I'm actually running right now?" without diffing source.
    version() {
        log(`Bot Controller v${BOT_VERSION} (built ${BOT_BUILD_DATE})`, 'run');
        console.log(`%c⚔ Broken Flagon Bot Controller v${BOT_VERSION} (${BOT_BUILD_DATE})`,
            'color:#c8922a;font-weight:700;font-size:13px');
        console.table(BOT_CHANGELOG.map(([v, note]) => ({ version: v, change: note })));
        return BOT_VERSION;
    },
    changelog: BOT_CHANGELOG,
    filter(type){
        _logFilter = type;
        document.querySelectorAll('#bot-log-tabs .blt').forEach(b=>b.classList.remove('on'));
        const filterMap={'all':0,'floor':1,'death':2,'warn':3,'error':4,'event':5};
        const idx = filterMap[type]??0;
        document.querySelectorAll('#bot-log-tabs .blt')[idx]?.classList.add('on');
        renderLog();
    },
    copyErr(){
        const txt=errors.map(e=>`[${new Date(e.t).toISOString()}] ${e.msg}${e.stack?'\n'+e.stack:''}`).join('\n');
        navigator.clipboard?.writeText(txt||'No errors')
            .catch(()=>{ console.log('[Bot] Error log:\n', txt); log('Clipboard blocked — errors logged to console','warn'); });
    },
    copyLog(){
        const txt=[...logs].reverse()
            .map(e=>`[${new Date(e.t).toLocaleTimeString()}] ${e.msg}`)
            .join('\n');
        navigator.clipboard?.writeText(txt||'No log entries')
            .then(()=>log('Log copied to clipboard','info'))
            .catch(()=>{ console.log('[Bot] Full log:\n', txt); log('Clipboard blocked — log printed to console (F12)','warn'); });
    },
    copyItems(){
        const found=[...itemLog.found.entries()].sort((a,b)=>b[1].count-a[1].count)
            .map(([nm,e])=>`${nm}: ${e.count} (${e.rarity||'?'})`).join('\n');
        const used=[...itemLog.used.entries()].sort((a,b)=>b[1].count-a[1].count)
            .map(([nm,e])=>`${nm}: ${e.count}`).join('\n');
        const txt=`=== FOUND ===\n${found||'None'}\n\n=== USED ===\n${used||'None'}`;
        navigator.clipboard?.writeText(txt)
            .then(()=>log('Items ledger copied to clipboard','info'))
            .catch(()=>{ console.log('[Bot] Items:\n', txt); log('Clipboard blocked — items printed to console (F12)','warn'); });
    },
    // Copy all run records as CSV — paste into Excel/Sheets for analysis.
    // Same as the "Copy CSV" button inside the Report panel, but accessible
    // directly from the toolbar without opening the report first.
    copyCSV(){
        if(!runRecords.length){alert('No completed runs yet — run a batch first.');return;}
        this.exportCSV();
        log(`Copied ${runRecords.length} run records as CSV`,'info');
    },
    detach() {
        // Stop the loop, remove the panel, and disable the URL flag so a
        // reload comes up clean. Wrapped tracking fns stay wrapped but are
        // inert (they only count while running===true), so this leaves the
        // game in a fully normal state.
        running = false;
        clearInterval(tickTimer); tickTimer = null;
        // Restore the main game render in case the bot was detached while in
        // minimap/headless display mode — otherwise the canvas stays blank.
        window._botSkipRender = false;
        { const gc = document.getElementById('game-canvas'); if (gc) gc.style.visibility = ''; }
        if (typeof draw === 'function') { try { draw(); } catch(_){} }
        const panel = document.getElementById('bot-panel');
        if (panel) panel.remove();
        try { localStorage.removeItem('flagonBot'); } catch(_) {}
        console.log('[Bot] Detached. Reload without ?bot for a clean game.');
    },
    cfg: CFG, stats,

    // ── Diagnostic / testing tools ────────────────────────────────────────
    // _bot.diag()   → full state snapshot in console (grouped, collapsible)
    // _bot.health() → quick pass/fail on functions + runtime state
    // _bot.reset()  → stop, clear all run state, ready for a fresh test

    diag() {
        const s = gs(), p = pp();
        const snap = {
            '── Bot state':    { running, paused, minimized, batch: { ...batch }, goal: goalText },
            '── Timers':       { tickMs: CFG.tickMs, _runTickCount, _floorTickCount, stuckTicks, MAX_FLOOR_TICKS },
            '── Stats':        { ...stats },
            '── Errors':       { total: errors.length, suppressed: _errRate.suppressed, last5: errors.slice(0,5).map(e=>e.msg) },
            '── Pathfinding':  { searches: botPathStats.searches, fails: botPathStats.fails, avgNodes: botPathStats.avgNodes, worstNodes: botPathStats.worstNodes },
            '── Function audit': _fnAudit,
            '── Game state':   s ? { floor: s.floor, inCourtyard: s.inCourtyard, inArenaBout: s.inArenaBout, gameOver: s.gameOver, enemies: s.enemies?.filter(e=>e.hp>0).length } : 'unavailable',
            '── Player':       p ? { class: p.className, sub: p.subclass, hp: `${p.hp}/${p.maxHp}`, level: p.level, gold: p.gold, pos: `${p.x},${p.y}`, mana: p.mana } : 'unavailable',
        };
        console.group('%c[Bot] Diagnostic snapshot', 'color:#c8922a;font-weight:bold');
        for (const [section, data] of Object.entries(snap)) {
            console.group(section);
            console.log(data);
            console.groupEnd();
        }
        console.groupEnd();
        return snap;
    },

    health() {
        const fnOk = _fnAudit.ok ?? checkGameFunctions();
        const s = gs();
        const result = {
            ok:           fnOk && !!s,
            running,
            hasGameState: !!s,
            errors:       errors.length,
            suppressed:   _errRate.suppressed,
            missingFns:   _fnAudit.missing,
            warnFns:      _fnAudit.warn,
        };
        const color = result.ok ? '#58c26d' : '#e04444';
        console.group(`%c[Bot] Health — ${result.ok ? '✓ OK' : '✗ ISSUES'}`, `color:${color};font-weight:bold`);
        console.log(result);
        console.groupEnd();
        if (!fnOk) log('Health check FAILED — see console (F12)', 'error');
        return result;
    },

    reset() {
        // Hard stop + clear all run-specific state. Leaves session stats and
        // the error log intact (you often want those after a test run).
        running = false;
        clearInterval(tickTimer); tickTimer = null;
        batch.active = false; batch.classIdx = 0; batch.runIdx = 0;
        stuckTicks = 0; lastPosKey = '';
        _runTickCount = 0; _floorTickCount = 0;
        _lastGameOverId = null; _lastExitLogKey = null;
        _abilitySpamCount = 0; _abilityBanned = false;
        _arenaPendingConfirm = false;
        _dodgeHistory = []; _dodgeCount = 0;
        _unreachableItems.clear(); _unreachableEnemies.clear();
        _unreachableStrikes = {};
        _errRate.count = 0; _errRate.suppressed = 0; _errRate.stamp = 0;
        const b = document.getElementById('bot-run-btn');
        if (b) { b.textContent = '▶ Start'; b.classList.remove('on'); }
        log('Bot reset — all run state cleared', 'warn');
        console.log('%c[Bot] Reset complete', 'color:#ffd65a');
        renderStats();
    },
    batch(runsEach) { startBatch(runsEach || 20); },
    stopBatch() { batch.active = false; log('Batch stopped','warn'); },
    report() { generateReport(); },
    records() { return [...runRecords]; },
    exportCSV() {
        // Export the PERSISTED records (the full overnight dataset, crash-proof
        // and accumulated across sessions) rather than just the in-memory window.
        // Falls back to in-memory runRecords if persistence is somehow empty.
        const src = (_persistedRuns && _persistedRuns.length) ? _persistedRuns : runRecords;
        const head = 'class,subclass,floor,outcome,kills,gold,level,weapon,seed,bossesKilled,potionsUsed,dmgEfficiency,timestamp';
        const q = s => `"${String(s||'').replace(/"/g,'""')}"`;  // RFC 4180 quoting
        const rows = src.map(r =>
            `${q(r.class)},${q(r.subclass)},${r.floor},${q(r.outcome)},${r.kills},${r.gold},${r.level},${q(r.weapon)},${q(r.seed||'')},${r.bossesKilled||0},${r.potionsUsed||0},${r.dmgEfficiency||0},${new Date(r.ts).toISOString()}`);
        const csv = [head, ...rows].join('\n');
        navigator.clipboard?.writeText(csv).then(
            () => log(`CSV copied (${src.length} runs)`,'run'),
            () => { console.log(csv); log('CSV logged to console','info'); }
        );
        return csv;
    },
    // Download the full persisted dataset as a .csv file — the safest way to
    // capture an overnight run without relying on the clipboard. Works even if
    // the batch is still going.
    downloadCSV() {
        const csv = this.exportCSV();
        try {
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
            a.href = url; a.download = `flagon-bot-runs-${stamp}.csv`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            log(`Downloaded ${_persistedRuns.length} runs as CSV`,'run');
        } catch(e) { err('downloadCSV', e); log('Download failed — use Copy CSV instead','warn'); }
    },
    // How many runs are safely persisted to disk right now.
    persistedCount() {
        log(`${_persistedRuns.length} runs persisted to localStorage (survives reload/crash)`, 'info');
        return _persistedRuns.length;
    },
    // Clear the persisted dataset — use to start a fresh overnight collection.
    clearPersisted() {
        if (!confirm(`Delete all ${_persistedRuns.length} persisted run records? This cannot be undone.`)) return;
        _persistedRuns = [];
        try { localStorage.removeItem(_PERSIST_KEY); } catch(_) {}
        log('Persisted run records cleared','warn');
    },

    // ── Emergency return ──────────────────────────────────────────────────
    // ⌂ button in toolbar: unstick a bot that's oscillating or frozen.
    forceReturn() {
        const s=gs(), p=pp();
        if (!s||!p||s.floor===0) { log('Already in tavern/overland','info'); return; }
        log('⌂ Force return triggered','warn');
        try { requestReturnToTavern?.(); } catch(_) {}
        // If portal not available, force an initGame restart as last resort
        setTimeout(()=>{
            if((gs()?.floor||0)>0){
                log('Portal unavailable — restarting run','warn');
                try{ forceNewRunAs(p.className||'warrior'); }catch(_){}
            }
        }, 600);
    },

    // ── God-mode dev tools ────────────────────────────────────────────────
    // Use in console: _bot.god.floor(20), _bot.god.gold(500), etc.
    // !! DANGER — remove this entire 'god' block before shipping to players.
    // These methods directly mutate game state and bypass all game logic.
    // They are NOT protected by the __DEV_BOT__ guard alone.
    // The guard below strips this object on any non-localhost deployment.
    god: {
        floor(n) {
            const p=pp(); if(!p){log('No player','warn');return;}
            try{
                if(typeof gameState!=='undefined'){
                    gameState.floor=Math.max(1,n-1);
                    if(typeof descendFloor==='function')descendFloor();
                    log('God: descended to floor '+gameState.floor,'warn');
                }
            }catch(e){err('god.floor',e);}
        },
        gold(n=500) {
            const p=pp(); if(!p)return;
            p.gold=(p.gold||0)+n;
            log('God: +'+n+'g → '+p.gold+'g total','shop');
            try{updateUI?.();}catch(_){}
        },
        hp(pct=1.0) {
            const p=pp(); if(!p)return;
            p.hp=Math.round(p.maxHp*Math.min(1,Math.max(0,pct)));
            log('God: HP set to '+p.hp+'/'+p.maxHp,'heal');
            try{updateUI?.();}catch(_){}
        },
        kill() {
            const s=gs(); if(!s?.enemies)return;
            let n=0; s.enemies.forEach(e=>{if(e.hp>0){e.hp=0;try{defeatEnemy?.(e);}catch(_){}n++;}});
            log('God: killed '+n+' enemies on this floor','warn');
            try{updateUI?.();}catch(_){}
        },
    },
};

// ── God-mode security guard ───────────────────────────────────────────────
// Strip the god object on any non-localhost deployment. The __DEV_BOT__ guard
// above prevents the bot from running, but window._bot is still attached to
// the window and its methods remain callable from the browser console. This
// delete is the second layer of protection.
if (typeof location !== 'undefined' && location.hostname !== 'localhost') {
    delete window._bot.god;
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────
// Space=start/pause  1-4=speed preset  R=force return to tavern  H=history tab
document.addEventListener('keydown', e => {
    // Only fire when not typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!document.getElementById('bot-panel')) return;
    switch(e.key) {
        case ' ':
            e.preventDefault();
            window._bot?.toggle();
            break;
        case '1': window._bot?.spd(600); break;
        case '2': window._bot?.spd(120); break;
        case '3': window._bot?.spd(45);  break;
        case '4': window._bot?.spd(15);  break;
        case 'r': case 'R':
            window._bot?.forceReturn();
            break;
        case 'h': case 'H':
            window._bot?.nav('history');
            break;
    }
});

// Global error capture
window.addEventListener('error', e=>{ if(running) err(e.filename?.split('/').pop()+':'+e.lineno, e.error||e.message); });
window.addEventListener('unhandledrejection', e=>{ if(running) err('Promise', e.reason); });
// Final flush on tab close so a clean exit captures everything. Records are
// already flushed per-run, so this is a belt-and-suspenders safety net.
window.addEventListener('beforeunload', () => { try { _persistDirty = true; _flushPersistedRuns(); } catch(_){} });

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',buildPanel);
else buildPanel();

log(`Bot Controller v${BOT_VERSION} (${BOT_BUILD_DATE}) ready — click Start`,'info');
})();
