
// ── Persistence ───────────────────────────────────────────────────────────────

// ── v3 Migration helpers ──────────────────────────────────────────────────────
//
// num(v, d): coercion-based numeric cast with a default.
//   Replaces the typeof === 'number' guards used throughout the old loader.
//   Coercion means a stringified legacy value (e.g. arenaWins: "5" from a
//   hand-edited save) loads as 5 rather than silently zeroing the stat.
//
function num(v, d = 0) { return isFinite(+v) ? +v : d; }

// META_MAP: rename registry for the arena→pit migration.
//   Format: newKey → [oldKey, ...] (first hit wins when reading a save).
//   Used for documentation and future generic loaders. The Phase 1 loader
//   still writes both old and new property names (belt-and-suspenders) so
//   arena.js, which still reads gameMeta.arenaFame, keeps working until
//   Phase 2 renames the symbol. Phase 2 removes the old-name writes.
//
const META_MAP = {
    pitFame:  ['arenaFame'],
    pitWins:  ['arenaWins'],
    pitBouts: ['arenaBouts'],
};

// getTreasuryLevel(meta): derived Treasury tier — pure function of how many
//   Treasury nodes are unlocked. NOT stored in the save; computed on demand
//   so it can never drift from treasurySpent across saves or rebalances.
//   TREASURY_TIERS[i] = nodes needed to reach tier i+1 (L1 is the default).
//
const TREASURY_TIERS = [0, 1, 3, 6, 10, 15]; // L1 through L6
function getTreasuryLevel(meta = gameMeta) {
    const n = Object.keys(meta.treasurySpent || {}).length;
    let lvl = 1;
    for (let i = 1; i < TREASURY_TIERS.length; i++) {
        if (n >= TREASURY_TIERS[i]) lvl = i + 1;
    }
    return lvl;
}

// Applies a saved tavern-upgrades object onto gameState.tavernUpgrades.
// Previously duplicated verbatim in both loadTavernUpgrades() and
// loadMetaProgress() — any new purchasable upgrade had to be wired in
// two places, and the two copies could silently drift apart.
function _applyTavernUpgradesSave(src) {
    if (!src || typeof src !== 'object') return;
    if (src.skeletonKingSkull) gameState.tavernUpgrades.skeletonKingSkull = true;
    if (src.velvetChairs) {
        gameState.tavernUpgrades.velvetChairs = true;
        gameState.tavernUpgrades.chandelier = true;
    }
    if (src.chandelier) gameState.tavernUpgrades.chandelier = true;
    if (src.royalRug) gameState.tavernUpgrades.royalRug = true;
    if (typeof src.goldDonated === 'number') gameState.tavernUpgrades.goldDonated = src.goldDonated;
    if (typeof src.bankGold === 'number') gameState.tavernUpgrades.bankGold = src.bankGold;
    if (Array.isArray(src.defeatedMilestones)) {
        gameState.tavernUpgrades.defeatedMilestones = src.defeatedMilestones.slice();
    }
    INNKEEPER_UPGRADES.forEach(up => {
        if (src[up.id]) gameState.tavernUpgrades[up.id] = true;
    });
    // Legendary guest one-time reward flags
    ['guestChroniclerVisited', 'guestSurvivorVisited', 'guestWitnessVisited',
     'guestKnightVisited', 'guestLegendVisited'].forEach(key => {
        if (src[key]) gameState.tavernUpgrades[key] = true;
    });
}

// bestFloor is also bundled into SAVE_KEY_META (see saveMetaProgress), but
// kept in its own standalone localStorage key as well so it survives even if
// the meta bundle ever fails to parse — it gates the Arena unlock and
// milestone tracking, so it's worth the redundancy. Synchronous localStorage
// (not the old async window.storage, which only exists in the hosted preview
// environment and silently no-ops once the game is packaged for desktop).
function saveBestFloor(floor) {
    if (floor <= gameState.bestFloor) return;
    const crossedArenaThreshold = gameState.bestFloor < 20 && floor >= 20;
    const prevBest = gameState.bestFloor; // snapshot before update for milestone calc
    gameState.bestFloor = floor;
    try {
        localStorage.setItem(SAVE_KEY_BEST_FLOOR, String(floor));
    } catch (e) {
        if (!(e instanceof DOMException)) console.warn('saveBestFloor failed:', e);
    }
    saveMetaProgress();
    checkAchievements({ bestFloor: gameState.bestFloor });
    // Flagon Coins: +2 per newly-crossed floor milestone (multiples of 5).
    // Uses prevBest so re-loading a save that had already reached Floor 25
    // does NOT re-award coins — the guard is account-wide, not per-run.
    if (typeof earnFlagonCoins === 'function') {
        let milestonesHit = 0;
        for (let m = 5; m <= floor; m += 5) {
            if (m > prevBest) milestonesHit++;
        }
        if (milestonesHit > 0) earnFlagonCoins(milestonesHit * 2, 'milestone floor');
    }
    // The Pit unlocks at bestFloor >= 20 — tell the player the first time
    // they cross that line, since the gate is in the courtyard where they
    // might not think to look. Guarded by its own hintsSeen id too, so a
    // player who somehow re-crosses doesn't get it twice.
    if (crossedArenaThreshold) showFirstTimeHint('arena');
}


function loadBestFloor() {
    try {
        const raw = localStorage.getItem(SAVE_KEY_BEST_FLOOR);
        if (raw !== null) {
            const parsed = parseInt(raw, 10);
            // Take whichever source has the higher value — the meta bundle may
            // already have loaded a bestFloor, and we never want to regress it.
            if (!Number.isNaN(parsed)) gameState.bestFloor = Math.max(gameState.bestFloor || 0, parsed);
        }
    } catch (e) {
        if (!(e instanceof DOMException)) console.warn('loadBestFloor failed:', e);
    }
    renderBestFloor();
}


// ── Shared Stash ──────────────────────────────────────────────────────────────

// ── Trophy Room persistence ────────────────────────────────────────────────────

function saveTavernUpgrades() {
    try { localStorage.setItem('dungeon_tavern_upgrades', JSON.stringify(gameState.tavernUpgrades)); } catch (_) {}
}


function loadTavernUpgrades() {
    try {
        const raw = localStorage.getItem('dungeon_tavern_upgrades');
        if (raw) {
            const saved = JSON.parse(raw);
            _applyTavernUpgradesSave(saved);
        }
    } catch (_) {}
}


// ── Shared Stash persistence ───────────────────────────────────────────────────

function saveStash() {
    try { localStorage.setItem('dungeon_stash', JSON.stringify(gameSharedStash)); } catch (_) {}
}


function loadStash() {
    try {
        const raw = localStorage.getItem('dungeon_stash');
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr.slice(0, STASH_MAX);
        }
    } catch (_) {}
    return [];
}


function hasSavedRun() {
    try { return localStorage.getItem(SAVE_KEY_RUN) !== null; } catch (_) { return false; }
}


// Returns true if the player has already seen the changelog for the
// CURRENT GAME_VERSION specifically — not just "has seen some changelog
// before." That distinction matters: every update should still surface
// its own notes even to a returning player who dismissed a previous
// version's popup.
function hasSeenChangelog() {
    try { return localStorage.getItem(SAVE_KEY_CHANGELOG_SEEN) === GAME_VERSION; } catch (_) { return false; }
}


function markChangelogSeen() {
    try { localStorage.setItem(SAVE_KEY_CHANGELOG_SEEN, GAME_VERSION); } catch (_) {}
}


function clearActiveRun() {
    try { localStorage.removeItem(SAVE_KEY_RUN); } catch (_) {}
}


// ── Overland zone feature (de)serialization ─────────────────────────────────
// Features carry live function refs (reward/resolve) that can't be JSON'd, so
// we save only their structural state and rebuild the ref on load from the
// content tables in data.js using the stored refIdx.
function serializeZoneFeatures(store) {
    const out = {};
    if (!store) return out;
    for (const key of Object.keys(store)) {
        const arr = store[key] || [];
        out[key] = arr.map(f => ({
            x: f.x, y: f.y, kind: f.kind, used: !!f.used,
            refIdx: f.refIdx,                 // forage/event content index
            stock: f.kind === 'merchant' ? f.stock : undefined, // plain data
        }));
    }
    return out;
}

function deserializeZoneFeatures(saved) {
    const out = {};
    if (!saved) return out;
    for (const key of Object.keys(saved)) {
        const arr = saved[key] || [];
        out[key] = arr.map(f => {
            const feat = { x: f.x, y: f.y, kind: f.kind, used: !!f.used };
            if (f.kind === 'forage' && typeof f.refIdx === 'number') {
                feat.refIdx = f.refIdx; feat.ref = FORAGE_NODES[f.refIdx] || FORAGE_NODES[0];
            } else if (f.kind === 'event' && typeof f.refIdx === 'number') {
                feat.refIdx = f.refIdx; feat.ref = ZONE_EVENTS[f.refIdx] || ZONE_EVENTS[0];
            } else if (f.kind === 'merchant') {
                feat.stock = f.stock || [];
            }
            return feat;
        });
    }
    return out;
}


function saveActiveRun() {
    if (!gameState.player || gameState.gameOver) return;
    try {
        const p = gameState.player;
        const save = {
            v: 1,
            runSeed: gameState.runSeed,
            cellarHasFind: gameState.cellarHasFind,
            cellarClaimed: gameState.cellarClaimed,
            floor: gameState.floor,
            dungeon: gameState.dungeon,
            // When in the courtyard, dungeon is the courtyard grid and the
            // tavern interior is cached in tavernDungeon. Save both so a
            // reload can reconstruct the correct state instead of treating
            // the courtyard grid as the tavern interior (which unlocks every
            // NPC shop since inCourtyard defaults to false on a fresh load).
            inCourtyard: gameState.inCourtyard || false,
            tavernDungeon: gameState.inCourtyard ? gameState.tavernDungeon : null,
            inTown: gameState.inTown || false,
            // World-map position. worldPos tells the loader which 5×5 cell the
            // player was standing in; inArena flags the arena exterior so its
            // rendering and the bout-entry prompt behave correctly on resume.
            // worldGrids are NOT saved — they're deterministic from the cell
            // coordinates and cheap to regenerate, so the loader rebuilds the
            // one zone it needs rather than bloating the save with all of them.
            worldPos: gameState.worldPos ? { ...gameState.worldPos } : { row: 2, col: 2 },
            inArena: gameState.inArena || false,
            // Town Portal anchor — the floor the player can return to. null when
            // no portal is active. Lets a saved-and-resumed run keep its anchor.
            dungeonReturnFloor: gameState.dungeonReturnFloor || null,
            // Overland zone features. Function refs (reward/resolve) can't be
            // serialized, so we store a compact descriptor per feature — kind,
            // position, used-flag, and an index/id into the content tables —
            // and rehydrate the live ref on load. Merchant stock is plain data
            // and saved as-is.
            worldZoneFeatures: serializeZoneFeatures(gameState.worldZoneFeatures),
            revealed: gameState.revealed,
            rooms: gameState.rooms,
            items: JSON.parse(JSON.stringify(gameState.items)),
            enemies: gameState.enemies.map(e => ({
                x: e.x, y: e.y, type: e.type, name: e.name,
                color: e.color, glyph: e.glyph, range: e.range, xp: e.xp,
                hp: e.hp, maxHp: e.maxHp, atk: e.atk, def: e.def,
                statuses: JSON.parse(JSON.stringify(e.statuses)),
                intent: e.intent,
                bossVariant: e.bossVariant, bossPhase: e.bossPhase,
                bossTurnCounter: e.bossTurnCounter,
                splitDone: e.splitDone, immuneToStun: e.immuneToStun,
                milestoneBoss: e.milestoneBoss, milestoneFloor: e.milestoneFloor,
                fallenPhase: e.fallenPhase,
                // Thief state — gold stolen and whether it has entered flee
                // mode. Without these a saved thief forgets what it took.
                stolenGold: e.stolenGold, hasFled: e.hasFled,
                // tookNoDamage tracks whether the player took no hits from this
                // boss (Flawless Victory achievement). Must be persisted so a
                // flawless fight in progress doesn't lose its state on reload.
                tookNoDamage: e.tookNoDamage ?? false,
            })),
            player: {
                className: p.className, subclass: p.subclass, name: p.name,
                ability: p.ability,
                hp: p.hp, maxHp: p.maxHp, mana: p.mana, maxMana: p.maxMana,
                atk: p.atk, def: p.def, baseAtk: p.baseAtk, baseDef: p.baseDef,
                level: p.level, xp: p.xp, gold: p.gold,
                hearthstoneCoins: p.hearthstoneCoins || 0,
                _resistFloors: p._resistFloors || 0,
                inventory: JSON.parse(JSON.stringify(p.inventory)),
                equipment: JSON.parse(JSON.stringify(p.equipment)),
                statuses: JSON.parse(JSON.stringify(p.statuses)),
                shieldActive: p.shieldActive,
                levelCritBonus: p.levelCritBonus,
                levelLifestealBonus: p.levelLifestealBonus,
                critChance: p.critChance, lifesteal: p.lifesteal,
                goldFind: p.goldFind, thorns: p.thorns,
                manaRegenBonus: p.manaRegenBonus,
                x: p.x, y: p.y,
                sc: p.sc ? JSON.parse(JSON.stringify(p.sc)) : {},
                relics: JSON.parse(JSON.stringify(p.relics || [])),
                relicPouch: JSON.parse(JSON.stringify(p.relicPouch || [])),
                overheal: p.overheal || 0,
                overhealTurns: p.overhealTurns || 0,
                mirrorImageTurns: p.mirrorImageTurns || 0,
                boneShieldTurns: p.boneShieldTurns || 0,
                boneShieldDef: p.boneShieldDef || 0,
                cellarRushFloor: p.cellarRushFloor ?? null,
                _brewThorns: p._brewThorns || 0,
                _brewManaRegen: p._brewManaRegen || 0,
                _atkTrickleAccum: p._atkTrickleAccum || 0,
            },
            messages: [...gameState.messages],
            activeBrew: gameState.activeBrew ? { ...gameState.activeBrew } : null,
            activeSong: gameState.activeSong ? { ...gameState.activeSong } : null,
            activeQuest: gameState.activeQuest
                ? JSON.parse(JSON.stringify(gameState.activeQuest)) : null,
            generatedBounties: JSON.parse(JSON.stringify(gameState.generatedBounties)),
            decorations: JSON.parse(JSON.stringify(gameState.decorations)),
            interactables: JSON.parse(JSON.stringify(gameState.interactables)),
            traps: JSON.parse(JSON.stringify(gameState.traps)),
            allies: JSON.parse(JSON.stringify(gameState.allies)),
            decoy: gameState.decoy ? { ...gameState.decoy } : null,
            trainerBought: { ...gameState.trainerBought },
            runStats: gameState.runStats ? { ...gameState.runStats } : createRunStats(),
            runAchievementsUnlocked: [...(gameState.runAchievementsUnlocked || [])],
            capturedCreatures: JSON.parse(JSON.stringify(gameState.capturedCreatures || [])),
            // Active dungeon event — persists so a mid-run reload keeps the same
            // event modifier (spawn boosts, loot bias) for the rest of the descent.
            dungeonEvent: gameState.dungeonEvent || null,
            // Never save a mid-bout state — the arena floor and bout data are
            // transient. Mark inArenaBout false so a restored save starts cleanly
            // in the courtyard, not frozen inside a fight that no longer exists.
            inArenaBout: false,
            // Floor exploration cache — lets players re-enter previously visited
            // floors with fog-of-war and enemy/item state preserved across reloads.
            // Capped at MAX_CACHED_FLOORS entries (LRU) to bound storage growth.
            floorCache: gameState.floorCache || {},
            floorCacheOrder: [...(gameState.floorCacheOrder || [])],
        };

        // Try saving the full payload. If storage is full (QuotaExceededError),
        // retry once without the floor cache — the cache is a convenience, not
        // critical state, so degrading to regenerated floors is acceptable.
        try {
            localStorage.setItem(SAVE_KEY_RUN, JSON.stringify(save));
        } catch (e) {
            if (e instanceof DOMException) {
                const { floorCache: _fc, floorCacheOrder: _fco, ...saveWithoutCache } = save;
                try {
                    localStorage.setItem(SAVE_KEY_RUN, JSON.stringify(saveWithoutCache));
                } catch (_) { /* storage full even without cache — silently skip */ }
            } else {
                console.warn('saveActiveRun failed:', e);
            }
        }
    } catch (e) {
        if (!(e instanceof DOMException)) console.warn('saveActiveRun failed:', e);
    }
}


function loadActiveRun() {
    try {
        const raw = localStorage.getItem(SAVE_KEY_RUN);
        if (!raw) return false;
        const save = JSON.parse(raw);
        if (!save || save.v !== 1 || !save.player || typeof save.floor !== 'number') return false;

        // Restore run scalars
        gameState.floor  = save.floor;
        gameState.dungeon  = save.dungeon;
        // Restore courtyard state — if the player saved while outside,
        // put the tavern interior grid back into tavernDungeon and flag
        // inCourtyard true so all the guards work correctly on resume.
        gameState.inCourtyard = save.inCourtyard || false;
        if (gameState.inCourtyard && save.tavernDungeon) {
            gameState.tavernDungeon = save.tavernDungeon;
        }
        gameState.inTown = save.inTown || false;
        // Restore world-map position. Default to the tavern courtyard for old
        // saves that predate the world map.
        gameState.worldPos = save.worldPos || { row: 2, col: 2 };
        gameState.inArena  = save.inArena || false;
        // Restore the Town Portal anchor (null for old saves).
        gameState.dungeonReturnFloor = save.dungeonReturnFloor || null;
        gameState.worldGrids = {}; // regenerated on demand below
        // Restore overland zone features (rehydrating function refs from the
        // content tables) so foraged/used state survives a reload.
        gameState.worldZoneFeatures = deserializeZoneFeatures(save.worldZoneFeatures);
        gameState.zoneFeatures = [];
        gameState.inZoneCombat = false;
        // Rebuild the courtyard and town grids from scratch on every floor-0 load.
        if (save.floor === 0 && typeof generateCourtyard === 'function') {
            generateCourtyard();
        }
        if (save.floor === 0 && typeof generateTown === 'function') {
            generateTown();
            // If saved in town, swap the town grid into dungeon
            if (gameState.inTown) {
                gameState.courtyardDungeon = gameState.courtyard;
                gameState.dungeon = gameState.town;
            }
        }
        // If saved in a generated world zone (road / forest / arena exterior),
        // regenerate that zone's grid and swap it in. The player's saved x,y
        // already points into this grid, so no repositioning is needed.
        if (save.floor === 0 && !gameState.inCourtyard && !gameState.inTown) {
            const wp = gameState.worldPos;
            const isSpecial = (wp.row === 2 && wp.col === 2) || (wp.row === 2 && wp.col === 1);
            if (!isSpecial && typeof generateWorldZone === 'function') {
                const key = `${wp.row},${wp.col}`;
                gameState.worldGrids[key] = generateWorldZone(wp.row, wp.col);
                gameState.dungeon = gameState.worldGrids[key];
                // Re-point live features at this zone; regenerate if the save
                // predated zone content (old save with no features for this key).
                if (gameState.worldZoneFeatures[key]) {
                    gameState.zoneFeatures = gameState.worldZoneFeatures[key];
                } else if (typeof generateZoneFeatures === 'function') {
                    gameState.worldZoneFeatures[key] = generateZoneFeatures(wp.row, wp.col, gameState.dungeon);
                    gameState.zoneFeatures = gameState.worldZoneFeatures[key];
                }
            }
        }
        gameState.revealed = save.revealed;
        gameState.rooms    = save.rooms;
        gameState.items    = save.items;
        gameState.messages = save.messages || [];
        gameState.effects  = [];
        // Re-arm the PRNG from the saved seed so the char sheet still
        // shows the right code and any further rolls this session at
        // least come from a known, named seed. Note this restores the
        // generator, not its exact position in the sequence — a save
        // mid-run re-arms at sequence position 0, not the exact draw
        // count reached before saving. Fine for "type in this code and
        // get the same dungeon," not bit-for-bit continuation of the
        // pre-save sequence. Saves from before 1.6.0 won't have a
        // runSeed at all; mint one so seedToCode() always has something
        // valid to display rather than showing "—" for an old save.
        seedRun(save.runSeed != null ? save.runSeed : generateRandomSeed());
        // Saves from before this feature existed won't have
        // cellarHasFind at all — default to false rather than
        // re-rolling, since re-rolling on every load would let a
        // player save-scum for a better outcome by repeatedly saving
        // and reloading until the roll favors them.
        gameState.cellarHasFind = save.cellarHasFind === true;
        gameState.cellarClaimed = save.cellarClaimed === true;
        gameState.activeBrew  = save.activeBrew  || null;
        gameState.activeSong  = save.activeSong  || null;
        gameState.activeQuest = save.activeQuest || null;
        gameState.generatedBounties = save.generatedBounties || [];
        gameState.decorations = save.decorations || [];
        gameState.interactables = save.interactables || [];
        gameState.traps = save.traps || [];
        gameState.allies = save.allies || [];
        gameState.decoy = save.decoy || null;
        gameState.trainerBought = save.trainerBought || { hp: false, atk: false };
        gameState.capturedCreatures = save.capturedCreatures || [];
        gameState.dungeonEvent = save.dungeonEvent || null;
        // Clear any stale arena mid-bout state — bouts are not persisted
        gameState.inArenaBout = false;
        gameState.arenaBoutData = null;
        // Restore floor exploration cache if present
        gameState.floorCache = save.floorCache || {};
        gameState.floorCacheOrder = save.floorCacheOrder || [];
        if (gameState.floor > 0 && gameState.decorations.length === 0) placeDecorations();
        else buildDecorGrid();

        // Reset all UI/modal flags
        gameState.gameOver = false;
        gameState.awaitingLevelChoice = false;
        gameState.pendingLevelChoices = 0;
        gameState.shopOpen = gameState.charSheetOpen = gameState.gamblingOpen = false;
        gameState.brewmasterOpen = gameState.questBoardOpen = false;
        gameState.bardOpen = gameState.stashOpen = false;
        gameState.magicDealerOpen = false;
        gameState.cellarFindOpen = false;
        gameState.blacksmithOpen = gameState.trainerOpen = false;
        gameState.bankOpen = gameState.innOpen = false;
        gameState.tavernConfirmOpen = false;

        // Reconstruct Player — create fresh instance so prototype methods exist,
        // then overwrite every field with the saved values
        const pd = save.player;
        const player = new Player(pd.className, pd.subclass, pd.name);
        Object.assign(player, pd);
        if (player.hearthstoneCoins == null) player.hearthstoneCoins = 0;
        if (pd.sc) player.sc = JSON.parse(JSON.stringify(pd.sc));
        player.renderX = pd.x * TILE_SIZE;
        player.renderY = pd.y * TILE_SIZE;
        player.equipment = migrateEquipment(player.equipment);
        gameState.player = player;
        gameState.runStats = save.runStats || createRunStats();
        gameState.runAchievementsUnlocked = save.runAchievementsUnlocked || [];

        // Reconstruct Enemies — same pattern
        gameState.enemies = save.enemies.map(ed => {
            const e = new Enemy(ed.x, ed.y, ed.type);
            Object.assign(e, ed);
            // Re-derive render coords after assign — saved data may contain
            // stale or undefined renderX/renderY from older save versions.
            e.renderX = e.x * TILE_SIZE;
            e.renderY = e.y * TILE_SIZE;
            e.flash = 0;
            e.hitFlash = 0;
            return e;
        });

        // Re-derive all computed stats (gear + song + brew carry through via saved base values)
        recalculateStats();

        // Resume bard music if a song was playing
        if (gameState.activeSong) {
            const track = SONG_TRACKS.find(t => t.id === gameState.activeSong.id);
            if (track) _startBardLoop(track);
        }

        // Show game UI, skip class-select and the title screen
        const titleEl = document.getElementById('title-screen');
        if (titleEl) titleEl.style.display = 'none';
        const csEl = document.getElementById('class-select');
        csEl.style.display = 'none';
        document.getElementById('game-ui').style.display = 'grid';
        document.getElementById('game-over').style.display = 'none';
        document.body.classList.add('in-run');

        if (!gameState.frameStarted) {
            gameState.frameStarted = true;
            requestAnimationFrame(gameLoop);
        }

        refreshEnemyIntents();
        addMessage(`Run restored — welcome back to floor ${save.floor}.`);
        renderMessages();
        updateUI();
        return true;
    } catch (e) {
        console.warn('loadActiveRun failed:', e);
        clearActiveRun();
        return false;
    }
}


function resumeRun() {
    if (!loadActiveRun()) {
        clearActiveRun();
        _updateContinueButton();
    }
}


function _getSavedRunSummary() {
    try {
        const raw = localStorage.getItem(SAVE_KEY_RUN);
        const save = raw ? JSON.parse(raw) : null;
        if (!save) return null;
        const sc = SUBCLASSES[save.player.className]?.find(s => s.id === save.player.subclass);
        const displayName = save.player.name || sc?.name || capitalize(save.player.className);
        const potionCount = (save.player.inventory || [])
            .filter(i => i.type === 'potion')
            .reduce((sum, i) => sum + (i.qty || 0), 0);
        return {
            displayName,
            className: save.player.className || 'warrior',
            level: save.player.level || 1,
            floorLabel: save.floor > 0 ? `Floor ${save.floor}` : 'The Tavern',
            floor: save.floor || 0,
            gold: save.player.gold,
            potionCount,
        };
    } catch (_) { return null; }
}


function _updateContinueButton() {
    const wrapper = document.getElementById('continue-run-wrapper');
    const noRunPrompt = document.getElementById('cs-no-run-prompt');
    if (!wrapper) return;
    if (hasSavedRun()) {
        wrapper.style.display = 'block';
        if (noRunPrompt) noRunPrompt.style.display = 'none';
        const summary = _getSavedRunSummary();
        if (summary) {
            const nameEl = document.getElementById('continue-name');
            const floorEl = document.getElementById('continue-floor-label');
            const goldEl = document.getElementById('continue-gold');
            const potionEl = document.getElementById('continue-potions');
            if (nameEl) nameEl.textContent = summary.displayName;
            if (floorEl) floorEl.textContent = summary.floorLabel;
            if (goldEl) goldEl.textContent = `${summary.gold} Gold`;
            if (potionEl) potionEl.textContent = `${summary.potionCount} Potion${summary.potionCount === 1 ? '' : 's'}`;
        }
    } else {
        wrapper.style.display = 'none';
        if (noRunPrompt) noRunPrompt.style.display = 'block';
    }
}


function _updateTitleResumeBanner() {
    const banner = document.getElementById('title-resume-banner');
    if (!banner) return;
    if (!hasSavedRun()) { banner.style.display = 'none'; return; }
    const summary = _getSavedRunSummary();
    if (!summary) { banner.style.display = 'none'; return; }
    banner.style.display = 'flex';
    // Portrait image
    const img = document.getElementById('tr-portrait-img');
    if (img && typeof CLASS_ICON_IMG !== 'undefined') {
        img.src = CLASS_ICON_IMG[summary.className] || '';
        img.alt = summary.className;
    }
    // Stats
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('tr-class',      summary.displayName);
    set('tr-level-str',  `Level ${summary.level}`);
    set('tr-depth-str',  `Depth ${summary.floor}`);
    set('tr-location',   summary.floorLabel);
    set('tr-gold-str',   `${summary.gold} Gold`);
}


// ── Meta progress (bestFloor + stash + tavern upgrades bundled) ────────────────

// NOTE ON THE TRIPLE WRITE: this function writes localStorage three times —
// once to the bundled SAVE_KEY_META key, then again via saveTavernUpgrades()
// and saveStash() to their standalone legacy keys (dungeon_tavern_upgrades,
// dungeon_stash). This redundancy is deliberate, not an oversight:
//   • SAVE_KEY_META is the canonical bundle that loadMetaProgress() reads
//     first (loadedFromBundle path).
//   • The two legacy keys exist so a build that predates the bundle — or a
//     loadMetaProgress() that finds no bundle and falls back to legacy keys —
//     still sees current data.
// The writes are cheap (small JSON, infrequent — only on meta-changing events
// like a new best floor or stash change, not per frame), so keeping the
// legacy keys in lockstep is worth the cost until they can be retired. If the
// legacy-key fallback in loadMetaProgress() is ever removed, the two extra
// writes below can go with it.
function saveMetaProgress() {
    try {
        localStorage.setItem(SAVE_KEY_META, JSON.stringify({
            bestFloor: gameState.bestFloor,
            tavernUpgrades: { ...gameState.tavernUpgrades },
            sharedStash: JSON.parse(JSON.stringify(gameSharedStash)),
            meta: { ...gameMeta },
        }));
    } catch (e) {
        if (!(e instanceof DOMException)) console.warn('saveMetaProgress failed:', e);
    }
    // Keep the individual legacy keys in sync for backward compat (see note above)
    saveTavernUpgrades();
    saveStash();
}


function loadMetaProgress() {
    let loadedFromBundle = false;
    try {
        const raw = localStorage.getItem(SAVE_KEY_META);
        if (raw) {
            const meta = JSON.parse(raw);
            if (meta && typeof meta === 'object') {
                if (typeof meta.bestFloor === 'number') gameState.bestFloor = meta.bestFloor;
                if (meta.tavernUpgrades) {
                    _applyTavernUpgradesSave(meta.tavernUpgrades);
                }
                if (Array.isArray(meta.sharedStash)) {
                    gameSharedStash.length = 0;
                    gameSharedStash.push(...meta.sharedStash.slice(0, STASH_MAX));
                }
                if (meta.meta && typeof meta.meta === 'object') {
                    if (typeof meta.meta.totalGold === 'number')   gameMeta.totalGold   = meta.meta.totalGold;
                    if (typeof meta.meta.runs === 'number')        gameMeta.runs        = meta.meta.runs;
                    if (typeof meta.meta.deaths === 'number')      gameMeta.deaths      = meta.meta.deaths;
                    if (typeof meta.meta.bossesSlain === 'number') gameMeta.bossesSlain = meta.meta.bossesSlain;
                    // ── v3 migration: arena* → pit* ───────────────────────────────────────────
                    // Coercion instead of strict typeof: a stringified legacy number loads
                    // correctly rather than silently zeroing the player's history.
                    // Reads new name first, falls back to old key for saves written before
                    // the rename, so existing saves are losslessly forward-compatible.
                    // Belt-and-suspenders compat writes (gameMeta.arenaFame etc.) were
                    // removed in Phase 3 once data.js declared pitFame as the initial field.
                    const _pitFame  = num(meta.meta.pitFame,  num(meta.meta.arenaFame,  0));
                    const _pitWins  = num(meta.meta.pitWins,  num(meta.meta.arenaWins,  0));
                    const _pitBouts = num(meta.meta.pitBouts, num(meta.meta.arenaBouts, 0));
                    gameMeta.pitFame    = _pitFame;
                    gameMeta.pitWins    = _pitWins;
                    gameMeta.pitBouts   = _pitBouts;
                    // ── new Hybrid fields (default 0/{} when absent from old saves) ──────────
                    gameMeta.flagonCoins   = num(meta.meta.flagonCoins, 0);
                    gameMeta.treasurySpent = (meta.meta.treasurySpent &&
                                             typeof meta.meta.treasurySpent === 'object')
                                          ? { ...meta.meta.treasurySpent } : {};
                    if (meta.meta.hintsSeen) gameMeta.hintsSeen = { ...meta.meta.hintsSeen };
                    if (meta.meta.dailyRecords) gameMeta.dailyRecords = { ...meta.meta.dailyRecords };
                    if (meta.meta.bestiary) gameMeta.bestiary = { ...meta.meta.bestiary };
                    if (meta.meta.casinoJackpot != null) gameMeta.casinoJackpot = meta.meta.casinoJackpot;
                    if (meta.meta.casinoJackpotLastClaimed != null) gameMeta.casinoJackpotLastClaimed = meta.meta.casinoJackpotLastClaimed;
                    if (meta.meta.casinoJackpotLastBumped != null) gameMeta.casinoJackpotLastBumped = meta.meta.casinoJackpotLastBumped;
                    if (meta.meta.casinoWheelSpins != null) gameMeta.casinoWheelSpins = meta.meta.casinoWheelSpins;
                    if (meta.meta.casinoWheelBigWins != null) gameMeta.casinoWheelBigWins = meta.meta.casinoWheelBigWins;
                    if (meta.meta.tavernRenown != null) gameMeta.tavernRenown = meta.meta.tavernRenown;
                    if (Array.isArray(meta.meta.fallen)) gameMeta.fallen = meta.meta.fallen;
                    if (meta.meta.achievements) gameMeta.achievements = { ...meta.meta.achievements };
                    if (meta.meta.stats) gameMeta.stats = { ...gameMeta.stats, ...meta.meta.stats };
                    if (meta.meta.rivals && typeof meta.meta.rivals === 'object') gameMeta.rivals = { ...meta.meta.rivals };
                }
                loadedFromBundle = true;
            }
        }
    } catch (_) {}

    if (!loadedFromBundle) {
        // Backward compat: individual legacy keys
        loadTavernUpgrades();
        const stash = loadStash();
        gameSharedStash.length = 0;
        gameSharedStash.push(...stash);
    }
    renderMetaProgress();
    renderAchievements();
}
