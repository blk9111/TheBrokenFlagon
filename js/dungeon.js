
function getRarityColor(rarity) {
    return RARITY_COLORS[rarity] || RARITY_COLORS.common;
}


// ── World exploration: chests & discoveries ────────────────────────────────────

function findInteractableAt(x, y) {
    return gameState.interactables.find(o => o.x === x && o.y === y && !o.used);
}


function spawnInteractables() {
    gameState.interactables = [];
    const chestCount = 2 + Math.floor(rng() * 2);
    const discoveryCount = rng() < 0.65 ? 1 : 0;

    for (let i = 0; i < chestCount; i++) {
        const spot = findRandomOpenTile(4);
        if (!spot) continue;
        const roll = rng();
        const kind = roll < 0.55 ? 'chest_common' : roll < 0.82 ? 'chest_rare' : 'chest_cursed';
        gameState.interactables.push({ x: spot.x, y: spot.y, kind, used: false });
    }

    if (discoveryCount > 0) {
        const spot = findRandomOpenTile(5);
        if (spot) {
            const kinds = ['discovery_camp', 'discovery_shrine', 'discovery_library'];
            const kind = kinds[Math.floor(rng() * kinds.length)];
            gameState.interactables.push({ x: spot.x, y: spot.y, kind, used: false });
        }
    }

    spawnRareEvents();
}


function spawnRareEvents() {
    if (gameState.floor < 2 || rng() > 0.28) return;
    const spot = findRandomOpenTile(6);
    if (!spot) return;

    // Weighted pool — new events are gated by floor depth so they never
    // show up before the dungeon has enough content to make them feel right.
    const pool = [
        { kind: 'event_merchant',  weight: 2 },
        { kind: 'event_shrine',    weight: 2 },
        { kind: 'event_altar',     weight: 2 },
        { kind: 'event_adventurer',weight: 2 },
        { kind: 'event_vault',     weight: 2 },
        // New events — floor-gated
        { kind: 'event_offering',  weight: 2 },                              // floor 2+
        { kind: 'event_horde',     weight: gameState.floor >= 5  ? 2 : 0 }, // floor 5+
        { kind: 'event_den',       weight: gameState.floor >= 15 ? 2 : 0 }, // floor 15+
        { kind: 'event_shadlib',   weight: 2 },                              // floor 2+
    ];
    const totalWeight = pool.reduce((s, e) => s + e.weight, 0);
    let roll = rng() * totalWeight;
    let kind = pool[pool.length - 1].kind; // fallback
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll <= 0) { kind = entry.kind; break; }
    }

    gameState.interactables.push({ x: spot.x, y: spot.y, kind, used: false });
    const meta = WORLD_OBJECTS[kind];
    addMessage(`A ${meta.label.toLowerCase()} has been spotted deeper on this floor…`);
    showEventCard('RARE EVENT', meta.label, 'milestone');
}


function checkWorldDiscovery(x, y) {
    const obj = findInteractableAt(x, y);
    if (!obj || obj.used) return;

    if (obj.kind.startsWith('event_')) {
        triggerRareEvent(obj);
        return;
    }

    if (!obj.kind.startsWith('discovery_')) return;
    obj.used = true;
    const meta = WORLD_OBJECTS[obj.kind];
    const xp = meta.xp + gameState.floor * 4;
    gameState.player.gainXp(xp);
    addBurst(x, y, meta.color);
    if (obj.kind === 'discovery_camp') {
        const gold = 5 + gameState.floor * 2;
        gameState.player.gold += gold;
        addFloatingText(x, y, `+${gold}g`, '#ffd65a');
        addMessage(`Abandoned camp discovered — scraps yield ${gold}g. +${xp} XP.`);
    } else if (obj.kind === 'discovery_shrine') {
        const heal = Math.floor(gameState.player.maxHp * 0.15);
        gameState.player.hp = Math.min(gameState.player.maxHp, gameState.player.hp + heal);
        addFloatingText(x, y, `+${heal}`, '#58c26d');
        addMessage(`Forgotten shrine blesses you (+${heal} HP). +${xp} XP.`);
    } else {
        addItemToInventory({ type: 'identifyScroll', name: 'Identify Scroll', qty: 1, color: '#ffd65a', glyph: '?' });
        addMessage(`Ancient library yields forgotten lore and an Identify Scroll. +${xp} XP.`);
    }
}


function triggerRareEvent(obj) {
    if (obj.used) return;
    obj.used = true;
    const meta = WORLD_OBJECTS[obj.kind];
    const p = gameState.player;
    addBurst(obj.x, obj.y, meta.color);
    sfxItemPickup();

    switch (obj.kind) {
        case 'event_merchant': {
            const price = 12 + gameState.floor * 3;
            if (p.gold < price) {
                addMessage(`The merchant shrugs — "${price}g for a mystery trinket, or begone."`);
                break;
            }
            p.gold -= price;
            const trinket = createJewelry(obj.x, obj.y);
            addItemToInventory(trinket);
            addMessage(`Wandering merchant sells you ${trinket.name} for ${price}g.`);
            showEventCard('MERCHANT', trinket.name, 'loot');
            break;
        }
        case 'event_shrine': {
            const heal = Math.floor(p.maxHp * 0.35);
            p.hp = Math.min(p.maxHp, p.hp + heal);
            p.statuses = p.statuses.filter(s => s.type !== 'poison' && s.type !== 'burn');
            addFloatingText(obj.x, obj.y, `+${heal}`, '#b06fff');
            addMessage(`Ancient shrine bathes you in violet light (+${heal} HP, ailments cleansed).`);
            showEventCard('SHRINE', `+${heal} HP`, 'heal');
            break;
        }
        case 'event_altar': {
            if (rng() < 0.5) {
                const boost = 3 + Math.floor(gameState.floor / 5);
                p.baseAtk += boost;
                recalculateStats();
                addMessage(`Cursed altar grants dark strength (+${boost} base ATK).`);
                showEventCard('ALTAR', `+${boost} ATK`, 'milestone');
            } else {
                const dmg = 10 + gameState.floor * 2;
                p.hp = Math.max(0, p.hp - dmg);
                onPlayerTakeDamage();
                addFloatingText(p.x, p.y, `-${dmg}`, '#9966cc');
                addMessage(`The cursed altar lashes out for ${dmg} damage!`);
                if (p.hp <= 0) showGameOver();
            }
            break;
        }
        case 'event_adventurer': {
            const gold = 15 + gameState.floor * 4;
            p.gold += gold;
            trackGoldPickup(gold);
            addFloatingText(obj.x, obj.y, `+${gold}g`, '#ffd65a');
            const xp = 20 + gameState.floor * 3;
            p.gainXp(xp);
            addMessage(`Lost adventurer shares a map and ${gold}g before fleeing. +${xp} XP.`);
            showEventCard('RESCUED', `+${gold}g`, 'loot');
            break;
        }
        case 'event_vault': {
            const lootCount = 2 + Math.floor(rng() * 2);
            for (let i = 0; i < lootCount; i++) {
                const spot = findRandomOpenTile(2) || { x: obj.x, y: obj.y };
                const item = rng() < 0.6 ? createGear(spot.x, spot.y) : createLoot(spot.x, spot.y);
                if (item.type === 'equipment') trackRareFind(item);
                gameState.items.push(item);
            }
            addMessage('Treasure vault cracks open — loot spills across the floor!');
            showEventCard('VAULT', `${lootCount} items revealed`, 'loot');
            addCombatShake(10);
            break;
        }

        // ── CURSED OFFERING ─────────────────────────────────────────────────
        // A shrine that demands blood for power. The player chooses whether to
        // pay HP for a guaranteed relic, or walk away. HP cost is steep enough
        // to be a real decision — but never lethal (floored at 1).
        case 'event_offering': {
            // Cost: 35% of current HP (not max) — punishes already-wounded
            // players appropriately while remaining survivable.
            const cost = Math.max(5, Math.floor(p.hp * 0.35));
            if (p.hp - cost <= 0) {
                // Player would die — soften to 1 HP remaining so the event is
                // never an instant kill regardless of state.
                const safeCost = p.hp - 1;
                if (safeCost <= 0) {
                    addMessage('The offering demands blood you cannot spare. You back away.');
                    showEventCard('CURSED OFFERING', 'Too wounded to pay', 'boss');
                    break;
                }
            }
            const actualCost = Math.min(cost, p.hp - 1);
            p.hp -= actualCost;
            onPlayerTakeDamage();
            addFloatingText(obj.x, obj.y, `-${actualCost}`, '#c0392b');

            // Reward: a random relic. Same path as the floor-loot relic drop
            // but guaranteed rather than rolled — the HP cost earns the certainty.
            const relicDrop = createRelicDrop(obj.x, obj.y);
            addRelicToPouch(relicDrop.relicId);
            const def = RELIC_DEFS[relicDrop.relicId];
            addMessage(`You bleed on the altar (−${actualCost} HP). It pulses. A relic emerges from the stone: ${def ? def.name : 'Unknown Relic'}.`);
            showEventCard('CURSED OFFERING', def ? def.name : 'Relic acquired', 'boss');
            showFirstTimeHint('relic');
            if (p.hp <= 0) showGameOver();
            break;
        }

        // ── WANDERING HORDE ──────────────────────────────────────────────────
        // A pack of enemies ambushes the player from the darkness. Harder than
        // a normal floor encounter but rewards gold and XP on survival.
        // Count and type are floor-scaled so early hordes don't one-shot new
        // players and late hordes remain genuinely threatening.
        case 'event_horde': {
            const hordeSize = 3 + Math.floor(gameState.floor / 10); // 3 at fl5, up to 13 at fl100
            const cappedSize = Math.min(hordeSize, 6); // cap at 6 to avoid map clutter
            let spawned = 0;
            for (let i = 0; i < cappedSize; i++) {
                const spot = findRandomOpenTile(3);
                if (!spot) continue;
                // Horde type: slightly harder than the current floor average —
                // pull from the pool 5 floors ahead so it feels like an elite pack.
                const simulatedFloor = Math.min(gameState.floor + 5, 100);
                const savedFloor = gameState.floor;
                gameState.floor = simulatedFloor;
                const type = chooseEnemyType();
                gameState.floor = savedFloor;
                gameState.enemies.push(new Enemy(spot.x, spot.y, type));
                spawned++;
            }
            // Gold reward waiting on the event tile — player must survive to collect.
            const bountyGold = 20 + gameState.floor * 6;
            gameState.items.push({ x: obj.x, y: obj.y, type: 'gold', name: 'Gold',
                amount: bountyGold, color: '#ffd65a', glyph: '$' });
            addMessage(`A wandering horde bursts from the shadows — ${spawned} enemies! Slay them all for ${bountyGold}g.`);
            showEventCard('WANDERING HORDE', `${spawned} enemies · ${bountyGold}g reward`, 'boss');
            addCombatShake(12);
            sfxBossEncounter();
            break;
        }

        // ── GAMBLING DEN ─────────────────────────────────────────────────────
        // A shadowy alcove with a single dice game — Dungeon Dice, a stripped-
        // down version of Flagon Dice that works without the casino UI overlay.
        // No Escape, no lobby — just one roll for gold or gear.
        // Floor-gated to 15+ so it appears only when the player has gold to bet.
        case 'event_den': {
            const stake = Math.min(p.gold, 30 + gameState.floor * 4);
            if (stake < 10) {
                addMessage("The shadowed den's proprietor eyes your empty purse. 'Come back with coin.'");
                showEventCard('GAMBLING DEN', 'Need at least 10g to play', 'boss');
                break;
            }
            p.gold -= stake;
            trackGoldPickup(-stake); // accounting — treat as a spend
            // Three-outcome roll:
            //   < 0.35 → lose stake (bad)
            //   0.35–0.70 → double stake (neutral/good)
            //   > 0.70 → triple stake + a piece of gear (jackpot)
            const roll = rng();
            if (roll < 0.35) {
                addFloatingText(obj.x, obj.y, `-${stake}g`, '#e14b4b');
                addMessage(`The hooded dealer flips three coins. All tails. You lose ${stake}g. "Better luck next floor," he rasps.`);
                showEventCard('GAMBLING DEN', `Lost ${stake}g`, 'boss');
            } else if (roll < 0.70) {
                const won = stake * 2;
                p.gold += won;
                trackGoldPickup(won);
                addFloatingText(obj.x, obj.y, `+${won}g`, '#ffd65a');
                addMessage(`The dealer turns over three crowns. You double your wager — +${won}g.`);
                showEventCard('GAMBLING DEN', `+${won}g`, 'loot');
            } else {
                const won = stake * 3;
                p.gold += won;
                trackGoldPickup(won);
                const gear = createGear(obj.x, obj.y);
                gameState.items.push(gear);
                addFloatingText(obj.x, obj.y, `+${won}g`, '#ffd65a');
                addMessage(`The dealer laughs — the whole house. +${won}g and a bonus: ${gear.name} materialises on the table.`);
                showEventCard('GAMBLING DEN', `+${won}g + ${gear.name}`, 'loot');
                if (gear.type === 'equipment') trackRareFind(gear);
            }
            break;
        }

        // ── SHADOWED LIBRARY ─────────────────────────────────────────────────
        // A dusty alcove of forbidden tomes. Rewards lore (XP), an Identify
        // Scroll, and — with luck — auto-identifies everything in the player's
        // inventory. Thematically: the library knows what things truly are.
        case 'event_shadlib': {
            const xp = 30 + gameState.floor * 5;
            p.gainXp(xp);

            // Always give 2 Identify Scrolls as the baseline reward.
            addItemToInventory({ type: 'identifyScroll', name: 'Identify Scroll',
                qty: 2, color: '#ffd65a', glyph: '?' });

            // 40% chance the library's knowledge reveals everything unidentified
            // the player is carrying — a big situational jackpot.
            let revealedCount = 0;
            const fullReveal = rng() < 0.40;
            if (fullReveal) {
                p.inventory.forEach(item => {
                    if (item.identified === false) {
                        item.identified = true;
                        item.name = item.trueName || item.name;
                        revealedCount++;
                    }
                });
                const slots = (typeof GEAR_SLOTS !== 'undefined' ? GEAR_SLOTS : [
                    'weapon','chest','helmet','shield','boots','ring1','ring2','amulet']);
                const equip = migrateEquipment(p.equipment);
                slots.forEach(slot => {
                    const eq = equip[slot];
                    if (eq && eq.identified === false) {
                        eq.identified = true;
                        eq.name = eq.trueName || eq.name;
                        revealedCount++;
                    }
                });
                if (revealedCount > 0) recalculateStats();
            }

            // Message + bestiary entry for the rarest enemies the player hasn't
            // seen yet — one free "discovered" bestiary record as a lore reward.
            const unseen = (typeof getOrderedBestiaryTypes === 'function')
                ? getOrderedBestiaryTypes().filter(t => {
                    const b = (gameMeta.bestiary || {})[t];
                    return !b || !b.seen;
                  })
                : [];
            if (unseen.length > 0) {
                const pick = unseen[Math.floor(rng() * Math.min(unseen.length, 3))];
                recordBestiarySeen(pick);
                const lore = (typeof BESTIARY_LORE !== 'undefined' && BESTIARY_LORE[pick])
                    ? BESTIARY_LORE[pick].lore : null;
                if (lore) addMessage(`A tome falls open: "${lore}"`);
            }

            const scrollMsg = fullReveal && revealedCount > 0
                ? `The library's light reveals all — ${revealedCount} item${revealedCount > 1 ? 's' : ''} identified.`
                : 'The library holds its secrets, but yields two scrolls.';
            addMessage(`Shadowed Library: +${xp} XP, 2 Identify Scrolls. ${scrollMsg}`);
            showEventCard('SHADOWED LIBRARY',
                fullReveal && revealedCount > 0
                    ? `+${xp} XP · ${revealedCount} items revealed`
                    : `+${xp} XP · 2 scrolls`,
                'heal');
            break;
        }
    }
    updateUI();
}


function tryOpenChest() {
    const obj = findInteractableAt(gameState.player.x, gameState.player.y);
    if (!obj || !obj.kind.startsWith('chest_') || obj.used) return false;
    obj.used = true;
    const meta = WORLD_OBJECTS[obj.kind];
    addBurst(obj.x, obj.y, meta.color);
    sfxItemPickup();

    if (obj.kind === 'chest_cursed' && rng() < 0.35) {
        const dmg = 8 + gameState.floor * 2;
        gameState.player.hp = Math.max(0, gameState.player.hp - dmg);
        addFloatingText(obj.x, obj.y, `-${dmg}`, '#9966cc');
        addMessage('The cursed chest lashes out with dark energy!');
        if (gameState.player.hp <= 0) { showGameOver(); return true; }
    }

    const loot = obj.kind === 'chest_rare'
        ? createGear(obj.x, obj.y, rng() < 0.5 ? 'weapon' : 'armor')
        : createLoot(obj.x, obj.y);

    if (obj.kind === 'chest_cursed' && loot.type === 'equipment') {
        loot.cursed = true;
        loot.identified = false;
        loot.trueName = loot.name;
        loot.trueBonus = loot.bonus;
        loot.name = '?? Item';
        loot.bonus = Math.ceil(loot.bonus * 1.4);
    }

    if (loot.type === 'equipment') announceRareDrop(loot, obj.x, obj.y);
    gameState.items.push(loot);
    const xp = 5 + gameState.floor * 2;
    gameState.player.gainXp(xp);
    addMessage(`${meta.label} opened! +${xp} XP.`);
    return true;
}


function generateDungeon() {
    gameState.dungeon = [];
    gameState.rooms = [];
    gameState.enemies = [];
    gameState.items = [];
    gameState.fallenEnemies = [];
    initRevealedGrid();

    if (gameState.floor === 0) {
        generateTavern();
        revealAll();
        return;
    }

    fillDungeon(1);
    createRoomsAndCorridors();
    clearArea(SPAWN_X, SPAWN_Y, 1);
    clearArea(EXIT_X, EXIT_Y, 1);

    // BUG FIX: every dungeon floor must always have a way back up.
    // Floor 1's up-stairs leads to the Tavern (requires confirmation);
    // floor 2+ up-stairs just goes up one floor (instant, like descend).
    gameState.dungeon[SPAWN_Y][SPAWN_X] = (gameState.floor === 1) ? TILE_TAVERN_EXIT : TILE_ASCEND;
    gameState.dungeon[EXIT_Y][EXIT_X] = 2;

    placeTraps();
    placeDecorations();
    spawnInteractables();
    gameState.traps = [];
    gameState.allies = [];
    gameState.decoy = null;
    spawnEnemies();
    spawnLoot();
    refreshEnemyIntents();
    revealAround(SPAWN_X, SPAWN_Y, 4);
}


function placeDecorations() {
    gameState.decorations = [];
    const blocked = new Set([
        `${SPAWN_X},${SPAWN_Y}`, `${EXIT_X},${EXIT_Y}`,
        '2,2', '3,2', '2,3'
    ]);

    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
        for (let x = 1; x < MAP_WIDTH - 1; x++) {
            if (gameState.dungeon[y][x] !== 0) continue;
            if (blocked.has(`${x},${y}`)) continue;
            if (getDistance(x, y, SPAWN_X, SPAWN_Y) < 2) continue;
            if (getDistance(x, y, EXIT_X, EXIT_Y) < 2) continue;
            const roll = _fogNoise(x + gameState.floor * 17, y + gameState.floor * 31);
            if (roll > 0.88) {
                const pick = rollDecorType(roll);
                if (pick) gameState.decorations.push({ x, y, type: pick });
            }
        }
    }
    buildDecorGrid();
}


function buildDecorGrid() {
    gameState.decorGrid = Array.from({ length: MAP_HEIGHT }, () => Array(MAP_WIDTH).fill(null));
    gameState.decorations.forEach(d => {
        if (d.y >= 0 && d.y < MAP_HEIGHT && d.x >= 0 && d.x < MAP_WIDTH) {
            gameState.decorGrid[d.y][d.x] = d.type;
        }
    });
}


function rollDecorType(seed) {
    const total = DECOR_TYPES.reduce((s, d) => s + d.weight, 0);
    let r = (seed * 0.37) % total;
    for (const d of DECOR_TYPES) {
        r -= d.weight;
        if (r <= 0) return d.id;
    }
    return DECOR_TYPES[0].id;
}


function initRevealedGrid() {
    gameState.revealed = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        gameState.revealed[y] = new Array(MAP_WIDTH).fill(false);
    }
}


// ── Floor exploration memory ───────────────────────────────────────────────────
// Each floor's full state (tile grid, fog-of-war, surviving items/enemies,
// interactables, traps) is cached when the player leaves so it can be
// restored exactly on re-entry. The cache is session-only (not persisted to
// localStorage) — after a save/load the dungeon regenerates identically
// (same seed → same layout) but fog resets. That's an acceptable tradeoff
// that keeps the save format simple and avoids storage bloat from 100
// potential floors of serialized map data.

function saveFloorToCache() {
    const f = gameState.floor;
    if (f <= 0) return; // never cache the tavern
    if (!gameState.floorCache) gameState.floorCache = {};
    if (!gameState.floorCacheOrder) gameState.floorCacheOrder = [];

    gameState.floorCache[f] = {
        dungeon:       gameState.dungeon.map(row => [...row]),
        revealed:      gameState.revealed.map(row => [...row]),
        rooms:         JSON.parse(JSON.stringify(gameState.rooms)),
        items:         JSON.parse(JSON.stringify(gameState.items)),
        interactables: JSON.parse(JSON.stringify(gameState.interactables)),
        traps:         JSON.parse(JSON.stringify(gameState.traps)),
        decorations:   JSON.parse(JSON.stringify(gameState.decorations)),
        fallenEnemies: JSON.parse(JSON.stringify(gameState.fallenEnemies || [])),
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
            stolenGold: e.stolenGold, hasFled: e.hasFled,
            tookNoDamage: e.tookNoDamage ?? false,
        })),
    };

    // LRU tracking: move this floor to the end (most recently used)
    gameState.floorCacheOrder = gameState.floorCacheOrder.filter(n => n !== f);
    gameState.floorCacheOrder.push(f);

    // Evict the oldest floor if we're over the cap
    while (gameState.floorCacheOrder.length > MAX_CACHED_FLOORS) {
        const evict = gameState.floorCacheOrder.shift();
        delete gameState.floorCache[evict];
    }
}


// Restores a previously-visited floor from the cache. Returns true if
// the cache hit was found and applied, false if the floor is new and
// the caller should fall through to generateDungeon() instead.
function restoreFloorFromCache(floor) {
    const cache = gameState.floorCache?.[floor];
    if (!cache) return false;

    gameState.dungeon       = cache.dungeon.map(row => [...row]);
    gameState.revealed      = cache.revealed.map(row => [...row]);
    gameState.rooms         = JSON.parse(JSON.stringify(cache.rooms));
    gameState.items         = JSON.parse(JSON.stringify(cache.items));
    gameState.interactables = JSON.parse(JSON.stringify(cache.interactables));
    gameState.traps         = JSON.parse(JSON.stringify(cache.traps));
    gameState.decorations   = JSON.parse(JSON.stringify(cache.decorations));
    gameState.fallenEnemies = JSON.parse(JSON.stringify(cache.fallenEnemies || []));
    buildDecorGrid();

    // Reconstruct Enemy instances so prototype methods (applyVariant etc.) exist
    gameState.enemies = cache.enemies.map(ed => {
        const e = new Enemy(ed.x, ed.y, ed.type);
        Object.assign(e, ed);
        e.flash    = 0;
        e.hitFlash = 0;
        e.renderX  = ed.x * TILE_SIZE;
        e.renderY  = ed.y * TILE_SIZE;
        return e;
    });

    refreshEnemyIntents();
    return true;
}


function revealAll() {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        gameState.revealed[y].fill(true);
    }
    // Force the render exit-tile cache to rebuild — a full reveal may expose
    // exits that weren't visible before.
    gameState._revealedCount = (gameState._revealedCount || 0) + MAP_WIDTH * MAP_HEIGHT;
}


function revealAround(px, py, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dy) > radius) continue;
            const nx = px + dx;
            const ny = py + dy;
            if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
                // Count only the false→true transitions so the render layer can
                // cheaply detect "something new was revealed" and rebuild its
                // exit-tile cache without re-scanning the grid every frame.
                if (!gameState.revealed[ny][nx]) {
                    gameState.revealed[ny][nx] = true;
                    gameState._revealedCount = (gameState._revealedCount || 0) + 1;
                }
            }
        }
    }
}


function fillDungeon(tile) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        gameState.dungeon[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            gameState.dungeon[y][x] = tile;
        }
    }
}


function createRoomsAndCorridors() {
    const starter = { x: 1, y: 1, w: 5, h: 4 };
    const exitRoom = { x: MAP_WIDTH - 7, y: MAP_HEIGHT - 6, w: 5, h: 4 };
    gameState.rooms.push(starter, exitRoom);

    for (let i = 0; i < 8; i++) {
        const room = {
            w: 4 + Math.floor(rng() * 5),
            h: 3 + Math.floor(rng() * 4),
            x: 1 + Math.floor(rng() * (MAP_WIDTH - 9)),
            y: 1 + Math.floor(rng() * (MAP_HEIGHT - 7))
        };
        if (!gameState.rooms.some(existing => roomsOverlap(room, existing))) {
            gameState.rooms.push(room);
        }
    }

    gameState.rooms.forEach(carveRoom);
    for (let i = 1; i < gameState.rooms.length; i++) {
        const a = getRoomCenter(gameState.rooms[i - 1]);
        const b = getRoomCenter(gameState.rooms[i]);
        carveCorridor(a.x, a.y, b.x, b.y);
    }
    carveCorridor(SPAWN_X, SPAWN_Y, getRoomCenter(starter).x, getRoomCenter(starter).y);
    carveCorridor(getRoomCenter(exitRoom).x, getRoomCenter(exitRoom).y, EXIT_X, EXIT_Y);
}


function generateTavern() {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        gameState.dungeon[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            gameState.dungeon[y][x] = (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) ? 1 : 0;
        }
    }

    // ── Tavern layout: social hub only ────────────────────────────────────
    // Commerce NPCs (Merchant, Blacksmith, Trainer, Bank, QuestBoard,
    // MagicDealer) have moved to the Market (courtyard). The tavern now
    // focuses on social/rest services: Innkeeper, Bard, Brewmaster, Gambler,
    // Shared Stash, and the Cellar. Walls reflect this simpler programme.
    const wall = (x, y) => { gameState.dungeon[y][x] = 1; };
    const hline = (y, x1, x2) => { for (let x = x1; x <= x2; x++) wall(x, y); };
    const vline = (x, y1, y2) => { for (let y = y1; y <= y2; y++) wall(x, y); };
    const door  = (x, y) => { gameState.dungeon[y][x] = 0; };

    // ── Bar nook (center-top) — frames the Innkeeper alcove ───────────────
    // A short half-wall creates the bar counter feel without boxing off
    // the Innkeeper at (12,5) from the main hall. Players approach from
    // y=6+ (adjacent to Innkeeper at y=5). Bard at (4,6) sits open in
    // the main hall — no wall needed.
    hline(4, 8, 16);
    door(12, 4);

    // ── Back room (bottom) — Gambler, Brewmaster, Cellar, Dungeon ──────────
    // Horizontal wall at y=12 creates the back room. One door at (8,12)
    // provides access from the main hall. MagicDealer has moved to the
    // Market; this room now holds Gambler (5,14), Brewmaster (18,14),
    // Cellar (11,14), and the Dungeon entrance (22,15).
    hline(12, 1, 23);
    door(8, 12);

    // ── Cellar pocket (inside back room) ──────────────────────────────────
    hline(13, 10, 12);
    vline(10, 13, 15);
    vline(12, 13, 15);
    door(11, 13);

    // ── Courtyard door (left outer wall, y=8) ─────────────────────────────
    gameState.dungeon[8][0] = TILE_COURTYARD_DOOR;

    gameState.dungeon[EXIT_Y][EXIT_X] = 2;
    generateCourtyard();
}


// ── The Market ───────────────────────────────────────────────────────────────
// The second physical space accessible from the tavern's left door.
// Commerce NPCs moved here from the tavern interior: Merchant, Blacksmith,
// Trainer, Bank, QuestBoard, and Magic Dealer. The Pit gate is at the
// south center. Player enters from the RIGHT wall (door at x=24, y=8) and
// spawns at (23,8).
//
// NPC layout (25×18 grid):
//   North stalls (y=4):  Bank(4,4)  · Trainer(12,4)  · Merchant(20,4)
//   South stalls (y=13): QuestBoard(4,13) · MagicDealer(12,13) · Blacksmith(20,13)
//   Pit gate    (y=16):  The Pit (12,16)
function generateCourtyard() {
    const c = gameState.courtyard;
    for (let y = 0; y < MAP_HEIGHT; y++) {
        c[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            c[y][x] = (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) ? 1 : 0;
        }
    }

    // Door back into the tavern (right outer wall, same row as tavern left door)
    c[8][MAP_WIDTH - 1] = TILE_COURTYARD_DOOR;

    const hw = (y, x1, x2) => { for (let x = x1; x <= x2; x++) c[y][x] = 1; };

    // ── North stall backs ─────────────────────────────────────────────────
    // Short walls at y=2 create vendor alcoves. Vendor at y=4; player
    // approaches from y=5 (distance 1 → adjacent). Stall interior is y=3.
    hw(2, 2, 5);    // Bank stall   (vendor: Bank at 4,4)
    hw(2, 10, 14);  // Center stall (vendor: Trainer at 12,4)
    hw(2, 18, 22);  // East stall   (vendor: Merchant at 20,4)

    // ── South stall backs ─────────────────────────────────────────────────
    // Walls at y=15, flipped. Vendor at y=13; player at y=12 (distance 1).
    // Center (x=9-17) intentionally left open for The Pit approach lane.
    hw(15, 2, 5);   // QuestBoard stall (vendor: 4,13)
    hw(15, 7, 9);   // Lotería stall   (caller: 8,13) — left of the Pit lane
    hw(15, 18, 22); // Blacksmith stall (vendor: 20,13)
    // Magic Dealer (12,13): no south wall — Pit access corridor stays clear
}


// ── Town map ────────────────────────────────────────────────────────────────
// A small settlement accessible from the courtyard's left wall. Follows the
// same cached-grid pattern as generateCourtyard: called once, stored in
// gameState.town[], swapped into gameState.dungeon on entry.
//
// Layout (25×18):
//   - Road back to courtyard: right wall (x=24), y=8 → TILE_TOWN_ROAD
//   - Main cobblestone road: horizontal through y=8, vertical through x=12
//   - Buildings: General Store (NW), Temple (NE), Alchemist (SW), Town Hall (SE)
//   - Town square: open area around the crossroads centre
//   - Town gate (north wall) hints at a wider world beyond
function generateTown() {
    const t = gameState.town;
    const wall  = (x, y) => { t[y][x] = 1; };
    const floor = (x, y) => { t[y][x] = 0; };
    const hline = (y, x1, x2) => { for (let x=x1; x<=x2; x++) wall(x, y); };
    const vline = (x, y1, y2) => { for (let y=y1; y<=y2; y++) wall(x, y); };
    const hfloor = (y, x1, x2) => { for (let x=x1; x<=x2; x++) floor(x, y); };
    const vfloor = (x, y1, y2) => { for (let y=y1; y<=y2; y++) floor(x, y); };

    // Start fully walled
    for (let y = 0; y < MAP_HEIGHT; y++) {
        t[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            t[y][x] = (x === 0 || x === MAP_WIDTH-1 || y === 0 || y === MAP_HEIGHT-1) ? 1 : 0;
        }
    }

    // ── Road gate (right wall, y=8) — leads back to courtyard ──
    t[8][MAP_WIDTH - 1] = TILE_TOWN_ROAD;

    // ── Town Gate (top wall, x=11-13, y=0) — flavour, not traversable ──
    // Drawn visually in render.js; tiles stay wall=1 so player can't exit north

    // ── Main road: horizontal (y=8) + vertical (x=12) ──
    hfloor(8, 1, MAP_WIDTH - 2);
    vfloor(12, 1, MAP_HEIGHT - 2);

    // ── Buildings — four quadrants, each a walled room with one door ──
    // NW: General Store (x=2-8, y=2-6)
    hline(2, 2, 8); hline(6, 2, 8);
    vline(2, 2, 6); vline(8, 2, 6);
    t[6][5] = 0; // south door onto main road
    for (let y=3; y<=5; y++) for (let x=3; x<=7; x++) floor(x, y);

    // NE: Temple (x=16-22, y=2-6)
    hline(2, 16, 22); hline(6, 16, 22);
    vline(16, 2, 6); vline(22, 2, 6);
    t[6][19] = 0; // south door
    for (let y=3; y<=5; y++) for (let x=17; x<=21; x++) floor(x, y);

    // SW: Alchemist (x=2-8, y=10-15)
    hline(10, 2, 8); hline(15, 2, 8);
    vline(2, 10, 15); vline(8, 10, 15);
    t[10][5] = 0; // north door onto main road
    for (let y=11; y<=14; y++) for (let x=3; x<=7; x++) floor(x, y);

    // SE: Town Hall (x=16-22, y=10-15)
    hline(10, 16, 22); hline(15, 16, 22);
    vline(16, 10, 15); vline(22, 10, 15);
    t[10][19] = 0; // north door
    for (let y=11; y<=14; y++) for (let x=17; x<=21; x++) floor(x, y);

    // ── Town square — open area around crossroads (x=10-14, y=6-10) ──
    // Already floor from the road carves; well rendered at centre (12,8)

    // ── World map exits ────────────────────────────────────────────────────
    // Town (2,1) connects to its passable neighbours so the surrounding zones
    // aren't dead ends.  Per WORLD_MAP: north = forest (1,1), south = road /
    // Crossroads (3,1), west = forest (2,0), east = courtyard (TILE_TOWN_ROAD,
    // already placed above).  Each exit is a 3-wide gap with a short lane
    // carved to the main road so it's reachable.
    const CX = 12, CY = 8;

    // North exit → forest (1,1).  Replaces the old non-traversable "town gate".
    t[0][CX - 1] = TILE_ZONE_EXIT;
    t[0][CX]     = TILE_ZONE_EXIT;
    t[0][CX + 1] = TILE_ZONE_EXIT;
    for (let y = 1; y <= CY; y++) { t[y][CX - 1] = 0; t[y][CX] = 0; t[y][CX + 1] = 0; }

    // South exit → Crossroads (3,1)
    t[MAP_HEIGHT - 1][CX - 1] = TILE_ZONE_EXIT;
    t[MAP_HEIGHT - 1][CX]     = TILE_ZONE_EXIT;
    t[MAP_HEIGHT - 1][CX + 1] = TILE_ZONE_EXIT;
    for (let y = CY; y < MAP_HEIGHT - 1; y++) { t[y][CX - 1] = 0; t[y][CX] = 0; t[y][CX + 1] = 0; }

    // West exit → forest (2,0)
    t[CY][0]     = TILE_ZONE_EXIT;
    t[CY - 1][0] = TILE_ZONE_EXIT;
    t[CY + 1][0] = TILE_ZONE_EXIT;
    for (let x = 1; x <= CX; x++) { t[CY][x] = 0; t[CY - 1][x] = 0; t[CY + 1][x] = 0; }
}


// ── World Zone Generators ────────────────────────────────────────────────────
// Each function produces a 2D tile grid for a world-map cell.  Grids are
// cached in gameState.worldGrids["row,col"] so they are generated only once
// per run and stay stable across visits (same layout every time you return).
//
// Connections are determined by WORLD_MAP adjacency: if the neighbour cell is
// passable the shared edge gets a 3-tile-wide TILE_ZONE_EXIT gap + a path
// carved to the zone centre.  Mountain neighbours get a solid wall — no exit.

// Which edges of (row,col) have passable neighbours?
function getZoneExits(row, col) {
    // Helper: is the neighbour at (r,c) a passable, connectable zone?
    // The arena (3,2) is special — it is walled on its SOUTH side (matches the
    // map art, which shows no southern road). So a zone sitting south of the
    // arena must NOT open a north exit toward it, or the player would walk into
    // the arena's solid south wall and get stuck. We treat that one edge as
    // impassable from the neighbour's perspective.
    const connectable = (r, c, fromDir) => {
        if (r < 0 || r > 4 || c < 0 || c > 4) return false;
        if (!zonePassable(WORLD_MAP[r][c])) return false;
        // Block the arena's south edge: neighbour is the arena and we're
        // approaching it from its south (i.e. our exit points north into it).
        if (WORLD_MAP[r][c] === 'arena' && fromDir === 'north') return false;
        return true;
    };
    return {
        north: connectable(row - 1, col, 'north'),
        south: connectable(row + 1, col, 'south'),
        west:  connectable(row, col - 1, 'west'),
        east:  connectable(row, col + 1, 'east'),
    };
}

// Road zone — open ground with paved paths connecting every exit to a
// central clearing.  Low walls / embankments flank the road edges.
function generateRoadZone(row, col) {
    const CX = 12, CY = 8; // centre of the 25×18 grid
    const g = [];
    // Start with all walls, then carve open areas
    for (let y = 0; y < MAP_HEIGHT; y++) {
        g[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            g[y][x] = 1;
        }
    }

    // Central clearing (9×5 open space)
    for (let y = CY - 2; y <= CY + 2; y++)
        for (let x = CX - 4; x <= CX + 4; x++)
            g[y][x] = 0;

    const exits = getZoneExits(row, col);

    // Carve road stubs — 3 tiles wide — from each exit to the centre
    if (exits.north) {
        for (let x = CX - 1; x <= CX + 1; x++) g[0][x] = TILE_ZONE_EXIT;
        for (let y = 1; y < CY - 2; y++)
            for (let x = CX - 1; x <= CX + 1; x++) g[y][x] = 0;
    }
    if (exits.south) {
        for (let x = CX - 1; x <= CX + 1; x++) g[MAP_HEIGHT - 1][x] = TILE_ZONE_EXIT;
        for (let y = CY + 3; y < MAP_HEIGHT - 1; y++)
            for (let x = CX - 1; x <= CX + 1; x++) g[y][x] = 0;
    }
    if (exits.west) {
        for (let y = CY - 1; y <= CY + 1; y++) g[y][0] = TILE_ZONE_EXIT;
        for (let x = 1; x < CX - 4; x++)
            for (let y = CY - 1; y <= CY + 1; y++) g[y][x] = 0;
    }
    if (exits.east) {
        for (let y = CY - 1; y <= CY + 1; y++) g[y][MAP_WIDTH - 1] = TILE_ZONE_EXIT;
        for (let x = CX + 5; x < MAP_WIDTH - 1; x++)
            for (let y = CY - 1; y <= CY + 1; y++) g[y][x] = 0;
    }

    return g;
}

// Forest zone — dense woodland with narrow 3-tile paths cut between exits.
// A small glade at the centre gives the player a moment to breathe.
function generateForestZone(row, col) {
    const CX = 12, CY = 8;
    const g = [];
    // Start fully walled (trees)
    for (let y = 0; y < MAP_HEIGHT; y++) {
        g[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) g[y][x] = 1;
    }

    // Central glade
    for (let y = CY - 2; y <= CY + 2; y++)
        for (let x = CX - 3; x <= CX + 3; x++)
            g[y][x] = 0;

    const exits = getZoneExits(row, col);

    if (exits.north) {
        for (let x = CX - 1; x <= CX + 1; x++) g[0][x] = TILE_ZONE_EXIT;
        for (let y = 1; y <= CY - 2; y++)
            for (let x = CX - 1; x <= CX + 1; x++) g[y][x] = 0;
    }
    if (exits.south) {
        for (let x = CX - 1; x <= CX + 1; x++) g[MAP_HEIGHT - 1][x] = TILE_ZONE_EXIT;
        for (let y = CY + 3; y < MAP_HEIGHT - 1; y++)
            for (let x = CX - 1; x <= CX + 1; x++) g[y][x] = 0;
    }
    if (exits.west) {
        for (let y = CY - 1; y <= CY + 1; y++) g[y][0] = TILE_ZONE_EXIT;
        for (let x = 1; x <= CX - 3; x++)
            for (let y = CY - 1; y <= CY + 1; y++) g[y][x] = 0;
    }
    if (exits.east) {
        for (let y = CY - 1; y <= CY + 1; y++) g[y][MAP_WIDTH - 1] = TILE_ZONE_EXIT;
        for (let x = CX + 4; x < MAP_WIDTH - 1; x++)
            for (let y = CY - 1; y <= CY + 1; y++) g[y][x] = 0;
    }

    return g;
}

// Mountain zone — solid impassable terrain.  The player can never enter a
// mountain zone (zonePassable returns false), so this grid is only a
// placeholder; it will never be swapped into gameState.dungeon.
function generateMountainZone() {
    const g = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        g[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) g[y][x] = 1;
    }
    return g;
}

// Arena zone — The Pit exterior. The player enters from the north (coming
// from the courtyard). The fighting pit is the sunken central area; spectator
// walls ring the outside. The bout itself swaps to generateArenaFloor() in
// arena.js — this map is the "lobby" the player stands in before and after.
function generateArenaZone() {
    const CX = 12, CY = 9;
    const g = [];

    // Start fully walled (stone arena exterior)
    for (let y = 0; y < MAP_HEIGHT; y++) {
        g[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) g[y][x] = 1;
    }

    // The Pit — sunken fighting floor (floor tiles, wide open area)
    // Outer spectator ring: cols 4-20, rows 5-15
    for (let y = 5; y <= 15; y++)
        for (let x = 4; x <= 20; x++)
            g[y][x] = 0;

    // Inner wall ring creating spectator stands (1-tile thick wall border)
    for (let x = 4; x <= 20; x++) { g[5][x] = 1; g[15][x] = 1; }
    for (let y = 5; y <= 15; y++) { g[y][4] = 1; g[y][20] = 1; }

    // Gate archways in the inner wall — north (player enters), south
    g[5][CX - 1] = 0; g[5][CX] = 0; g[5][CX + 1] = 0;  // north arch
    g[15][CX - 1] = 0; g[15][CX] = 0; g[15][CX + 1] = 0; // south arch

    // Fighting pit interior: cols 6-18, rows 6-14 (sandy fighting floor)
    for (let y = 6; y <= 14; y++)
        for (let x = 6; x <= 18; x++)
            g[y][x] = 0;

    // Spectator aisles
    for (let y = 6; y <= 14; y++) {
        g[y][5] = 0; g[y][19] = 0;
    }

    // ── World exits ────────────────────────────────────────────────────────
    // The Pit (3,2) connects to its passable neighbours just like road/forest
    // zones, so the player can pass through rather than being funnelled back.
    // Matches the world map: north (courtyard), west (Crossroads), east (East
    // Fork). South stays walled — the arena reads as enclosed on that side and
    // the map shows no southern road.
    const exits = getZoneExits(3, 2); // arena is fixed at (3,2)

    // North exit → courtyard. Always present (courtyard is passable).
    g[0][CX - 1] = TILE_ZONE_EXIT;
    g[0][CX]     = TILE_ZONE_EXIT;
    g[0][CX + 1] = TILE_ZONE_EXIT;
    for (let y = 1; y <= 5; y++) { g[y][CX - 1] = 0; g[y][CX] = 0; g[y][CX + 1] = 0; }

    // West exit → Crossroads (3,1)
    if (exits.west) {
        g[CY][0] = TILE_ZONE_EXIT;
        g[CY - 1][0] = TILE_ZONE_EXIT;
        g[CY + 1][0] = TILE_ZONE_EXIT;
        for (let x = 1; x <= 4; x++) { g[CY][x] = 0; g[CY - 1][x] = 0; g[CY + 1][x] = 0; }
        g[CY][4] = 0; g[CY - 1][4] = 0; g[CY + 1][4] = 0; // open the ring wall
    }

    // East exit → East Fork (3,3)
    if (exits.east) {
        g[CY][MAP_WIDTH - 1] = TILE_ZONE_EXIT;
        g[CY - 1][MAP_WIDTH - 1] = TILE_ZONE_EXIT;
        g[CY + 1][MAP_WIDTH - 1] = TILE_ZONE_EXIT;
        for (let x = MAP_WIDTH - 2; x >= 20; x--) { g[CY][x] = 0; g[CY - 1][x] = 0; g[CY + 1][x] = 0; }
        g[CY][20] = 0; g[CY - 1][20] = 0; g[CY + 1][20] = 0; // open the ring wall
    }

    return g;
}

// Dispatcher — picks the right generator for a WORLD_MAP cell.
function generateWorldZone(row, col) {
    const type = WORLD_MAP[row][col];
    switch (type) {
        case 'road':     return generateRoadZone(row, col);
        case 'forest':   return generateForestZone(row, col);
        case 'mountain': return generateMountainZone();
        case 'arena':    return generateArenaZone();
        default:         return generateRoadZone(row, col);
    }
}


// Roll the content for a freshly-generated overland zone. Returns an array of
// feature objects { x, y, kind, used, ref } placed on open floor tiles. Called
// once per zone (results cached in gameState.worldZoneFeatures), so a foraged
// forest stays foraged and a triggered ambush doesn't respawn.
//
//   forest → mostly forage nodes + a chance of an ambush and/or an event
//   road   → a travelling merchant + a chance of an event and/or an ambush
//   (other zone types get nothing)
function generateZoneFeatures(row, col, grid) {
    const type = WORLD_MAP[row][col];
    if (type !== 'forest' && type !== 'road') return [];

    // Collect open floor tiles away from the very edges and the centre spawn,
    // so features don't land on top of the player's entry point or in a wall.
    const open = [];
    for (let y = 2; y < MAP_HEIGHT - 2; y++) {
        for (let x = 2; x < MAP_WIDTH - 2; x++) {
            if (grid[y][x] !== 0) continue;
            // keep a little clearance around the centre (entry/exit lanes)
            if (Math.abs(x - 12) <= 1 && Math.abs(y - 8) <= 1) continue;
            open.push({ x, y });
        }
    }
    if (!open.length) return [];

    // Fisher–Yates shuffle (seeded rng) so placement is deterministic per seed.
    for (let i = open.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = open[i]; open[i] = open[j]; open[j] = t;
    }

    const features = [];
    let idx = 0;
    const take = () => (idx < open.length ? open[idx++] : null);

    if (type === 'forest') {
        // 2–3 forage nodes
        const nForage = 2 + (rng() < 0.5 ? 1 : 0);
        for (let i = 0; i < nForage; i++) {
            const spot = take(); if (!spot) break;
            const fi = Math.floor(rng() * FORAGE_NODES.length);
            features.push({ x: spot.x, y: spot.y, kind: 'forage', used: false, refIdx: fi, ref: FORAGE_NODES[fi] });
        }
        // 50% an event
        if (rng() < 0.5) {
            const spot = take();
            if (spot) { const ei = Math.floor(rng() * ZONE_EVENTS.length);
                features.push({ x: spot.x, y: spot.y, kind: 'event', used: false, refIdx: ei, ref: ZONE_EVENTS[ei] }); }
        }
        // 45% an ambush
        if (rng() < 0.45) {
            const spot = take();
            if (spot) features.push({ x: spot.x, y: spot.y, kind: 'ambush', used: false });
        }
    } else { // road
        // A travelling merchant (always)
        const spot = take();
        if (spot) features.push({ x: spot.x, y: spot.y, kind: 'merchant', used: false,
            stock: rollRoadMerchantStock() });
        // 55% an event
        if (rng() < 0.55) {
            const s2 = take();
            if (s2) { const ei = Math.floor(rng() * ZONE_EVENTS.length);
                features.push({ x: s2.x, y: s2.y, kind: 'event', used: false, refIdx: ei, ref: ZONE_EVENTS[ei] }); }
        }
        // 35% an ambush (roads are a bit safer than forests)
        if (rng() < 0.35) {
            const s3 = take();
            if (s3) features.push({ x: s3.x, y: s3.y, kind: 'ambush', used: false });
        }
    }
    return features;
}

// Pick 3 distinct items from the road merchant table for this merchant.
function rollRoadMerchantStock() {
    const pool = [...ROAD_MERCHANT_STOCK];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, 3);
}


function carveRoom(room) {
    for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
            if (x > 0 && x < MAP_WIDTH - 1 && y > 0 && y < MAP_HEIGHT - 1) {
                gameState.dungeon[y][x] = 0;
            }
        }
    }
}


function carveCorridor(ax, ay, bx, by) {
    let x = ax;
    let y = ay;
    while (x !== bx) {
        gameState.dungeon[y][x] = 0;
        x += x < bx ? 1 : -1;
    }
    while (y !== by) {
        gameState.dungeon[y][x] = 0;
        y += y < by ? 1 : -1;
    }
    gameState.dungeon[y][x] = 0;
}


function roomsOverlap(a, b) {
    return a.x < b.x + b.w + 1 && a.x + a.w + 1 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y;
}


function getRoomCenter(room) {
    return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
}


function spawnEnemies() {
    const milestone = MILESTONE_BOSSES[gameState.floor];
    const bossFloor = milestone || gameState.floor % 5 === 0;
    const enemyCount = bossFloor ? 5 + Math.min(gameState.floor, 20) : Math.min(12, 4 + gameState.floor);

    for (let i = 0; i < enemyCount; i++) {
        const spot = findRandomOpenTile(5);
        if (!spot) continue;
        gameState.enemies.push(new Enemy(spot.x, spot.y, chooseEnemyType()));
    }

    if (bossFloor) {
        const bossSpot = findRandomOpenTile(8) || { x: EXIT_X - 1, y: EXIT_Y };
        const boss = new Enemy(bossSpot.x, bossSpot.y, 'boss');
        if (milestone) {
            boss.applyVariant(milestone.variant);
            boss.name = milestone.name;
            boss.color = milestone.color;
            boss.glyph = milestone.glyph;
            boss.hp = Math.ceil(boss.maxHp * milestone.hpMult);
            boss.maxHp = boss.hp;
            boss.atk = Math.ceil(boss.atk * milestone.atkMult);
            boss.milestoneBoss = true;
            boss.milestoneFloor = gameState.floor;
            if (milestone.name === 'Bone Dragon') {
                boss.range = 4;
                boss.immuneToStun = true;
            }
            if (milestone.name === 'Demon Prince') boss.immuneToStun = true;
            if (milestone.name === 'The Fallen God') {
                boss.fallenPhase = 1;
                boss.bossPhase = 'divine';
            }
            addMessage(milestone.announce);
            showEventCard('BOSS APPROACHES', milestone.name, 'boss');
            // Cinematic reveal overlay for milestone bosses
            if (typeof showBossReveal === 'function') {
                showBossReveal(milestone.name, milestone.color, milestone.glyph, milestone.announce);
            }
        } else {
            const variantKey = getBossVariant(gameState.floor);
            boss.applyVariant(variantKey);
            const v = BOSS_VARIANTS[variantKey];
            addMessage(v ? v.announce : `A floor boss stalks floor ${gameState.floor}.`);
        }
        boss.tookNoDamage = true;
        gameState.enemies.push(boss);
        sfxBossEncounter();
    }
}


function getBossVariant(floor) {
    const cycle = ((Math.floor((floor - 1) / 5)) % 4);
    return ['splitter', 'necromancer', 'sentinel', 'wraith'][cycle];
}


function chooseEnemyType() {
    const pool = ['goblin', 'slime'];
    if (gameState.floor >= 2)  pool.push('skeleton');
    if (gameState.floor >= 3)  pool.push('archer');
    if (gameState.floor >= 4)  pool.push('brute');
    if (gameState.floor >= 5)  pool.push('bat');
    if (gameState.floor >= 6)  pool.push('spider');
    if (gameState.floor >= 8)  pool.push('cultist');
    if (gameState.floor >= 12) pool.push('thief');
    if (gameState.floor >= 14) pool.push('necromancer');
    if (gameState.floor >= 16) pool.push('warden');
    // ── Elite / deep-floor types — back-half content, floors 20–50+ ────────
    if (gameState.floor >= 20) pool.push('imp');        // fire, double-strike
    if (gameState.floor >= 22) pool.push('ratman');     // cowardly archer
    if (gameState.floor >= 25) pool.push('ghoul');      // lifesteal
    if (gameState.floor >= 30) pool.push('lizardman');  // regenerates
    if (gameState.floor >= 35) pool.push('orc');        // charge bruiser
    if (gameState.floor >= 40) pool.push('darkknight'); // parry counter
    if (gameState.floor >= 50) pool.push('demon');      // fire-immune elite

    // Dungeon event spawn boosts
    const ev = typeof getDungeonEvent === 'function' ? getDungeonEvent() : null;
    if (ev && ev.spawnBoost) {
        Object.entries(ev.spawnBoost).forEach(([type, count]) => {
            if (pool.includes(type)) {
                for (let i = 0; i < count; i++) pool.push(type);
            }
        });
    }

    // ── Region weighting (World Map B2) ───────────────────────────────────
    // Bias the floor-eligible pool toward the current region's character. We
    // only reweight types that are ALREADY in the pool (i.e. already unlocked
    // by floor), so this never spawns an enemy before its floor — it just
    // shifts which of the eligible types show up most. A type with no region
    // weight keeps a baseline weight of 1 so nothing eligible is excluded.
    if (typeof getRegionForFloor === 'function') {
        const region = getRegionForFloor(gameState.floor);
        if (region && region.weights) {
            const weighted = [];
            for (const type of pool) {
                const w = region.weights[type] || 1;
                for (let i = 0; i < w; i++) weighted.push(type);
            }
            if (weighted.length) return weighted[Math.floor(rng() * weighted.length)];
        }
    }

    return pool[Math.floor(rng() * pool.length)];
}


function spawnLoot() {
    const lootCount = Math.min(8, 3 + Math.floor(gameState.floor / 2));
    for (let i = 0; i < lootCount; i++) {
        const spot = findRandomOpenTile(3);
        if (spot) gameState.items.push(createLoot(spot.x, spot.y));
    }
}


function placeTraps() {
    const trapCount = Math.min(8, Math.floor(gameState.floor / 2) + 1);
    for (let i = 0; i < trapCount; i++) {
        const spot = findRandomOpenTile(4);
        if (spot && gameState.dungeon[spot.y][spot.x] === 0) {
            gameState.dungeon[spot.y][spot.x] = 3;
        }
    }
}


function createLoot(x, y) {
    const roll = rng();
    // Mimic: spawns disguised as a common chest on floor 15+. Rare (~3%) —
    // players will think twice about every chest after their first encounter.
    if (gameState.floor >= 15 && roll < 0.03) {
        return { x, y, type: 'mimic_chest', name: 'Chest', color: '#c8a060', glyph: '\u25A1' };
    }
    if (roll < 0.34) return { x, y, type: 'potion',        name: 'Health Potion',   qty: 1, color: '#e14b4b', glyph: '+' };
    if (roll < 0.42) return { x, y, type: 'antidote',      name: 'Antidote',        qty: 1, color: '#58c26d', glyph: '!' };
    if (roll < 0.47) return { x, y, type: 'smokeBomb',     name: 'Smoke Bomb',      qty: 1, color: '#aaa397', glyph: '*' };
    if (roll < 0.52) return { x, y, type: 'rageDraught',   name: 'Rage Draught',    qty: 1, color: '#ff4500', glyph: '^' };
    if (roll < 0.58) return { x, y, type: 'identifyScroll',name: 'Identify Scroll', qty: 1, color: '#ffd65a', glyph: '?' };
    if (roll < 0.76) return { x, y, type: 'gold', name: 'Gold', amount: 8 + Math.floor(rng() * 10) + gameState.floor * 2, color: '#ffd65a', glyph: '$' };
    if (roll < 0.78) return createRelicDrop(x, y);
    if (roll < 0.80) return { x, y, type: 'captureCage', name: 'Capture Net', qty: 1, color: '#c98bff', glyph: 'N' };
    return createEquipment(x, y);
}


function createRelicDrop(x, y) {
    const ids = Object.keys(RELIC_DEFS);
    const relicId = ids[Math.floor(rng() * ids.length)];
    const def = RELIC_DEFS[relicId];
    return { x, y, type: 'relic', relicId, name: def.name, color: def.color, glyph: def.glyph };
}


function rollGearSlot() {
    const pool = ['weapon', 'chest', 'helmet', 'shield', 'boots'];
    return pool[Math.floor(rng() * pool.length)];
}


function createEquipment(x, y) {
    const roll = rng();
    if (roll < 0.74) return createGear(x, y);
    return createJewelry(x, y);
}


function pickGearName(slot, rarityName) {
    const gearSlot = slot === 'chest' ? 'armor' : slot;
    if (rarityName === 'mythic') {
        const pool = MYTHIC_NAMES[gearSlot] || MYTHIC_NAMES.weapon;
        return pool[Math.floor(rng() * pool.length)];
    }
    if (rarityName === 'legendary') {
        const pool = LEGENDARY_NAMES[gearSlot] || LEGENDARY_NAMES.weapon;
        return pool[Math.floor(rng() * pool.length)];
    }
    const genericBySlot = {
        weapon: ['Blade', 'Axe', 'Wand', 'Dagger', 'Mace', 'Spear', 'Saber', 'Cleaver', 'Rapier', 'Warhammer'],
        chest: ['Mail', 'Cloak', 'Plate', 'Vest', 'Brigandine', 'Hauberk', 'Cuirass', 'Robe', 'Jerkin', 'Carapace'],
        helmet: ['Helm', 'Crown', 'Hood', 'Cap', 'Coif', 'Visor', 'Circlet', 'Barbute', 'Mask', 'Greathelm'],
        shield: ['Shield', 'Buckler', 'Aegis', 'Ward', 'Bulwark', 'Targe', 'Kite Shield', 'Pavise', 'Rampart'],
        boots: ['Boots', 'Greaves', 'Treads', 'Sabatons', 'Striders', 'Footguards', 'Warboots', 'Sandals', 'Stompers']
    };
    const generic = genericBySlot[slot] || genericBySlot.chest;
    return `${capitalize(rarityName)} ${generic[Math.floor(rng() * generic.length)]}`;
}


function createGear(x, y, slot) {
    slot = normalizeGearSlot(slot || rollGearSlot());
    const rarity = rollRarity();
    const baseBonus = rarity.bonus + Math.floor(gameState.floor / 3);
    const trueName = pickGearName(slot, rarity.name);
    const cursed = rng() < 0.15 && rarity.name !== 'legendary' && rarity.name !== 'mythic';
    const bonus = cursed ? Math.ceil(baseBonus * 1.6) : baseBonus;
    const item = {
        x, y, type: 'equipment', slot, rarity: rarity.name,
        name: cursed ? '?? Item' : trueName, bonus,
        color: getRarityColor(rarity.name),
        glyph: SLOT_GLYPHS[slot] || '?'
    };
    if (cursed) { item.cursed = true; item.identified = false; item.trueName = trueName; item.trueBonus = bonus; }

    // Elemental roll — weapons only. A modest chance (scaling slightly with
    // depth) for the weapon to carry Fire / Frost / Lightning, which adds an
    // on-hit effect resolved in combat.js. Higher rarity also nudges the odds
    // up so a Legendary is more likely to be elemental than a Common.
    if (slot === 'weapon' && !cursed) {
        const rarityBoost = { common:0, uncommon:0.03, rare:0.06, epic:0.1, legendary:0.16, mythic:0.22 }[rarity.name] || 0;
        const depthBoost = Math.min(0.15, gameState.floor * 0.002);
        const elementChance = WEAPON_ELEMENT_DROP_CHANCE + rarityBoost + depthBoost;
        if (rng() < elementChance) {
            const elems = Object.keys(WEAPON_ELEMENTS);
            const element = elems[Math.floor(rng() * elems.length)];
            const edef = WEAPON_ELEMENTS[element];
            item.element = element;
            item.elementLabel = edef.label;
            item.elementColor = edef.color;
            item.elementGlyph = edef.glyph;
            // Prefix the name with the element label, e.g. "Flaming Dragonfang Axe"
            if (!cursed) item.name = `${edef.label} ${item.name}`;
            item.color = edef.color; // elemental weapons glow their element color
        }
    }
    return item;
}


function createJewelry(x, y) {
    const slot = rng() < 0.55 ? 'ring' : 'amulet';
    return createAccessory(x, y, slot);
}


function createAccessory(x, y, slot) {
    // Resolve slot here rather than in the parameter default — a default
    // parameter expression evaluates (and burns a seeded rng() call) even
    // when an explicit slot is passed, silently shifting every subsequent
    // RNG draw and breaking seed determinism for the rest of the run.
    if (slot === undefined) slot = rng() < 0.55 ? 'ring' : 'amulet';
    const rarity = rollRarity();
    const effectIds = Object.keys(ACCESSORY_EFFECTS);
    const effectId = effectIds[Math.floor(rng() * effectIds.length)];
    const effect = ACCESSORY_EFFECTS[effectId];
    const baseBonus = effect.scale * rarity.bonus;
    const itemName = effect.names[Math.floor(rng() * effect.names.length)];
    const trueName = `${capitalize(rarity.name)} ${effect.label} ${itemName}`;
    const cursed = rng() < 0.15;
    const bonus = cursed ? Math.ceil(baseBonus * 1.6) : baseBonus;
    const item = {
        x, y,
        type: 'equipment',
        slot,
        effectId,
        rarity: rarity.name,
        name: cursed ? '?? Trinket' : trueName,
        bonus,
        unit: effect.unit,
        desc: effect.desc,
        color: getRarityColor(rarity.name),
        glyph: SLOT_GLYPHS[slot] || 'o'
    };
    if (cursed) { item.cursed = true; item.identified = false; item.trueName = trueName; item.trueBonus = bonus; }
    return item;
}


function getGearIcon(slot) {
    return SLOT_GLYPHS[normalizeGearSlot(slot)] || '?';
}


function getGearStatLabel(item) {
    if (!item) return '';
    if (JEWELRY_SLOTS.includes(item.slot)) return `+${item.bonus}${item.unit || ''}`;
    const base = `+${item.bonus} ${item.slot === 'weapon' ? 'ATK' : 'DEF'}`;
    // Append the element glyph/label for elemental weapons so the player can
    // tell a Flaming Sword from a plain one at a glance.
    if (item.slot === 'weapon' && item.element && WEAPON_ELEMENTS[item.element]) {
        const e = WEAPON_ELEMENTS[item.element];
        return `${base} ${e.glyph} ${e.label}`;
    }
    return base;
}


function rollRarity() {
    // Region loot bonus (World Map B2) + Ironman bonus stack as a single
    // "shift out of common" amount. Both pull percentage points out of the
    // common tier and redistribute proportionally across the rarer tiers, so
    // deeper regions and Ironman both nudge drops upward without a separate
    // tuning table to maintain.
    let shift = 0;
    if (typeof getRegionForFloor === 'function') {
        const region = getRegionForFloor(gameState.floor);
        if (region && region.lootBonus) shift += region.lootBonus;
    }
    if (gameState.ironmanMode) shift += 0.05;

    if (shift <= 0) {
        const roll = rng();
        let total = 0;
        for (const rarity of RARITIES) {
            total += rarity.chance;
            if (roll <= total) return rarity;
        }
        return RARITIES[0];
    }

    // Shift `shift` worth of probability out of common, redistributed across
    // every other tier proportionally to its existing weight. Cap the shift at
    // the common tier's own chance so common can't go negative.
    const common = RARITIES[0].chance;
    const applied = Math.min(shift, common);
    const nonCommonTotal = RARITIES.slice(1).reduce((sum, r) => sum + r.chance, 0) || 1;
    const roll = rng();
    let total = 0;
    for (let i = 0; i < RARITIES.length; i++) {
        const r = RARITIES[i];
        const chance = i === 0
            ? Math.max(0, r.chance - applied)
            : r.chance + applied * (r.chance / nonCommonTotal);
        total += chance;
        if (roll <= total) return r;
    }
    return RARITIES[0];
}


// Max rejection-sampling attempts before falling back to a deterministic
// scan. Kept as rejection sampling (rather than the obvious "precompute a
// list of open tiles and pick one") ON PURPOSE: each attempt consumes
// exactly two rng() draws (x then y), and the whole seed system depends on
// the rng() stream being consumed in a fixed pattern. A precompute-and-pick
// rewrite would consume one draw instead of a variable number, shifting
// every downstream roll and silently changing what every existing seed code
// generates. The cost of rejection sampling on a 450-tile map is negligible
// in practice (it almost always succeeds within a handful of attempts).
const OPEN_TILE_MAX_ATTEMPTS = 500;

function findRandomOpenTile(minDistance = 0) {
    for (let attempts = 0; attempts < OPEN_TILE_MAX_ATTEMPTS; attempts++) {
        const x = 1 + Math.floor(rng() * (MAP_WIDTH - 2));
        const y = 1 + Math.floor(rng() * (MAP_HEIGHT - 2));
        const farEnough = getDistance(x, y, SPAWN_X, SPAWN_Y) >= minDistance;
        const occupied = findEnemyAt(x, y, 0) || findItemAt(x, y)
            || gameState.interactables.some(o => o.x === x && o.y === y && !o.used);
        if (farEnough && !occupied && gameState.dungeon[y][x] === 0 && !(x === EXIT_X && y === EXIT_Y)) {
            return { x, y };
        }
    }
    // Deterministic fallback for the (astronomically rare) case where random
    // sampling exhausts its budget on a near-full map. Scans in fixed order
    // and consumes NO rng(), so it can't affect the seeded stream of any
    // normal run — only runs that would otherwise have returned null. Honors
    // minDistance; drops it as a last resort rather than returning null and
    // forcing every caller's `if (spot)` guard to silently skip.
    let anyOpen = null;
    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
        for (let x = 1; x < MAP_WIDTH - 1; x++) {
            if (gameState.dungeon[y][x] !== 0) continue;
            if (x === EXIT_X && y === EXIT_Y) continue;
            if (findEnemyAt(x, y, 0) || findItemAt(x, y)
                || gameState.interactables.some(o => o.x === x && o.y === y && !o.used)) continue;
            anyOpen = anyOpen || { x, y };
            if (getDistance(x, y, SPAWN_X, SPAWN_Y) >= minDistance) return { x, y };
        }
    }
    return anyOpen; // null only if the entire floor is genuinely full
}


function findOpenTileNear(nx, ny, minDist = 1, maxDist = 3) {
    const candidates = [];
    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
        for (let x = 1; x < MAP_WIDTH - 1; x++) {
            const d = getDistance(x, y, nx, ny);
            if (d < minDist || d > maxDist) continue;
            const occupied = findEnemyAt(x, y, 0) || findItemAt(x, y)
                || gameState.interactables.some(o => o.x === x && o.y === y && !o.used);
            if (!occupied && gameState.dungeon[y][x] === 0 && !isPlayerAt(x, y)) {
                candidates.push({ x, y, d });
            }
        }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.d - b.d);
    const pool = candidates.slice(0, Math.min(6, candidates.length));
    return pool[Math.floor(rng() * pool.length)];
}


function isWalkable(x, y) {
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
    return gameState.dungeon[y][x] !== 1;
}
