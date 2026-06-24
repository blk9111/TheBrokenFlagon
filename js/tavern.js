
function checkInteractions() {
    if (gameState.inArenaBout) return; // no stairs or doors in the Pit
    // Guard: gameState.dungeon can be momentarily undefined during a floor
    // transition overlay (the array is cleared then rebuilt). Reading into it
    // without a check throws a TypeError and locks the game loop.
    if (!gameState.dungeon || !gameState.player) return;
    const row = gameState.dungeon[gameState.player.y];
    if (!row) return;
    const tile = row[gameState.player.x];
    if (tile === undefined) return;
    if (tile === 2) {
        if (gameState.floor >= MAX_DUNGEON_FLOOR) {
            addMessage('The ash has no deeper floor — defeat The Fallen God to end this curse.');
            updateUI();
            return;
        }
        // At the tavern dungeon entrance with a portal anchor: offer to resume
        // the banked floor instead of starting over at floor 1.
        if (gameState.floor === 0 && gameState.dungeonReturnFloor && gameState.dungeonReturnFloor > 0) {
            showDungeonEntranceChoice();
            return;
        }
        descendFloor();
    } else if (tile === TILE_ASCEND) {
        ascendFloor();
    } else if (tile === TILE_COURTYARD_DOOR && gameState.floor === 0) {
        toggleCourtyard();
    } else if (tile === TILE_TOWN_ROAD && gameState.floor === 0) {
        if (gameState.inTown) leaveTown();
        else if (gameState.inCourtyard) enterTown();
    } else if (tile === TILE_ZONE_EXIT && gameState.floor === 0) {
        handleZoneExit(gameState.player.x, gameState.player.y);
    }
}


// Swaps the active grid between the tavern interior and the outdoor
// courtyard, without ever touching gameState.floor (stays 0 throughout)
// — see the courtyard/tavernDungeon/inCourtyard fields in data.js for
// why this avoids the ~62 existing floor===0-vs-floor>0 branches
// elsewhere in the codebase. Each grid is generated once and cached,
// not regenerated on every transition.
function toggleCourtyard() {
    if (!gameState.inCourtyard) {
        gameState.tavernDungeon = gameState.dungeon;
        gameState.dungeon = gameState.courtyard;
        gameState.inCourtyard = true;
        // Spawn just inside the courtyard, one tile in from the door
        // the player just walked through (the tavern's door sits at
        // x=0,y=8; the courtyard's matching door sits at x=MAP_WIDTH-1,
        // y=8 — see generateCourtyard() in dungeon.js).
        gameState.player.x = MAP_WIDTH - 2;
        gameState.player.y = 8;
        gameState.worldPos = { row: 2, col: 2 };
        addMessage('You step outside. The night air is cold, and the tavern\u2019s glow fades behind you.');
    } else {
        gameState.dungeon = gameState.tavernDungeon;
        gameState.inCourtyard = false;
        gameState.player.x = 1;
        gameState.player.y = 8;
        addMessage('You head back inside, the warmth of the tavern washing over you.');
    }
    gameState.player.renderX = gameState.player.x * TILE_SIZE;
    gameState.player.renderY = gameState.player.y * TILE_SIZE;
    revealAll();
    updateUI();
}


// ── Town transition ─────────────────────────────────────────────────────────
// Swaps the active grid between the courtyard and the Town map. The player
// must be in the courtyard (gameState.inCourtyard) to reach the town — the
// road gate is on the courtyard's left wall. Entering the town keeps
// inCourtyard true (still floor 0 sub-space) while setting inTown to
// differentiate which map drives rendering and NPC interactions.
function enterTown() {
    if (!gameState.inCourtyard) return; // can only enter from courtyard
    gameState.courtyardDungeon = gameState.dungeon; // cache courtyard grid
    gameState.dungeon = gameState.town;
    gameState.inTown = true;
    // Spawn at the road gate on the town's right wall (x=MAP_WIDTH-2, y=8)
    gameState.player.x = MAP_WIDTH - 2;
    gameState.player.y = 8;
    gameState.worldPos = { row: 2, col: 1 };
    gameState.player.renderX = gameState.player.x * TILE_SIZE;
    gameState.player.renderY = gameState.player.y * TILE_SIZE;
    revealAll();
    addMessage('You follow the road into town. Stone buildings line the cobbled street.');
    updateUI();
}

function leaveTown() {
    if (!gameState.inTown) return;
    gameState.dungeon = gameState.courtyardDungeon || gameState.courtyard;
    gameState.inTown = false;
    // Return to the courtyard just inside its left wall road gate
    gameState.player.x = 1;
    gameState.player.y = 8;
    gameState.worldPos = { row: 2, col: 2 };
    gameState.player.renderX = gameState.player.x * TILE_SIZE;
    gameState.player.renderY = gameState.player.y * TILE_SIZE;
    revealAll();
    addMessage('You head back down the road toward The Broken Flagon.');
    updateUI();
}


function interactInTavern() {
    // ── Market (courtyard) interactions ──────────────────────────────────────
    // When in the courtyard the player is in The Market, not the tavern.
    // Only Market NPCs and the Pit gate are interactable here.
    if (gameState.inCourtyard) {
        if (isAdjacentToArenaGate()) { openArena(); return; }
        if (isAdjacentToMerchant())   { openShop();        return; }
        if (isAdjacentToBlacksmith()) { openBlacksmith();  return; }
        if (isAdjacentToTrainer())    { openTrainer();     return; }
        if (isAdjacentToBank())       { openBank();        return; }
        if (isAdjacentToQuestBoard()) { openNoticeBoard(); return; }
        if (isAdjacentToMagicDealer()){ openMagicDealer(); return; }
        addMessage('The Market stalls line the walls. Browse the vendors or head south to The Pit.');
        updateUI();
        return;
    }

    // ── Tavern interior interactions ──────────────────────────────────────────
    // Pick up any item lying on the player's tile FIRST. Reward drops (relics
    // like the Phoenix Feather, gear from quests/guests) can land on the tavern
    // floor, and without this check interactInTavern would always fall through
    // to an NPC panel or the "no fighting" message, leaving the item un-grabbable.
    const here = gameState.items.find(i => i.x === gameState.player.x && i.y === gameState.player.y);
    if (here) {
        collectItemAt(gameState.player.x, gameState.player.y);
        updateUI();
        return;
    }

    if (isAdjacentToInnkeeper())  { openInnkeeper();  return; }
    if (isAdjacentToGambler())    { openGambling();   return; }
    if (isAdjacentToBrewmaster()) { openBrewmaster(); return; }
    if (isAdjacentToBard())       { openBard();       return; }
    if (isAdjacentToStash())      { openStash();      return; }
    if (isAdjacentToCellar())     { openCellar();     return; }

    // Legendary guest NPCs — present in the tavern after milestone bosses fall.
    // Each grants a one-time reward on first interaction, flavor only after that.
    if (interactWithGuest()) return;

    addMessage('No fighting inside the tavern. The innkeeper narrows his eyes.');
    updateUI();
}


// Returns true if the player interacted with a legendary guest, false otherwise.
function interactWithGuest() {
    const p = gameState.player;
    if (!p) return false;
    const milestones = gameState.tavernUpgrades.defeatedMilestones || [];

    for (const guest of MILESTONE_GUESTS) {
        if (!milestones.includes(guest.floor)) continue;
        if (getDistance(p.x, p.y, guest.x, guest.y) > 1) continue;

        const alreadyVisited = gameState.tavernUpgrades[guest.visitedKey];
        if (!alreadyVisited) {
            // First interaction — deliver reward and mark visited
            gameState.tavernUpgrades[guest.visitedKey] = true;
            saveTavernUpgrades();
            addMessage(guest.greeting);

            const r = guest.reward;
            if (r.type === 'gold') {
                p.gold += r.amount;
                addFloatingText(p.x, p.y, `+${r.amount}g`, '#ffd65a');
                addMessage(`${guest.name} presses ${r.amount} gold into your hand.`);
            } else if (r.type === 'item') {
                addItemToInventory({ type: r.itemType, name: r.itemType === 'potion' ? 'Health Potion' : 'Identify Scroll', qty: r.qty, color: r.itemType === 'potion' ? '#e14b4b' : '#ffd65a', glyph: r.itemType === 'potion' ? '+' : '?' });
                addMessage(`You receive ${r.qty}× ${r.itemType === 'potion' ? 'Health Potion' : 'Identify Scroll'}.`);
            } else if (r.type === 'relic') {
                const relicIds = Object.keys(RELIC_DEFS);
                // Pick a relic the player doesn't already have equipped or pouched
                const held = [...(p.relics || []).map(r => r.id), ...(p.relicPouch || []).map(r => r.id)];
                const available = relicIds.filter(id => !held.includes(id));
                const relicId = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : relicIds[0];
                addRelicToPouch(relicId);
                addMessage(`${guest.name} places a relic on the table: ${RELIC_DEFS[relicId]?.name || 'Unknown Relic'}.`);
                showEventCard('RELIC GIFT', RELIC_DEFS[relicId]?.name || 'Relic', 'legendary');
            }
            sfxItemPickup();
            showEventCard(guest.name.toUpperCase(), 'Legendary Guest', 'milestone');
        } else {
            // Repeat visit — flavor only
            addMessage(guest.revisit);
        }
        updateUI();
        return true;
    }
    return false;
}


function openInnkeeper() {
    gameState.innOpen = true;
    document.getElementById('inn-panel').style.display = 'flex';
    renderInnkeeper();
    updateUI();
}


function closeInnkeeper() {
    gameState.innOpen = false;
    document.getElementById('inn-panel').style.display = 'none';
    updateUI();
}


function renderInnkeeper() {
    const p = gameState.player;
    document.getElementById('inn-gold').textContent = `${p.gold}g`;
    // Greeting reflects Arena reputation once the Pit is unlocked — the
    // innkeeper is the tavern's social barometer for how famous you've become.
    const greetingEl = document.getElementById('inn-greeting');
    if (greetingEl && typeof isPitUnlocked === 'function' && isPitUnlocked()) {
        const tier = getPitTier();
        const line = INNKEEPER_FAME_LINES[tier.title];
        if (line) greetingEl.textContent = line;
    }
    const restCost = 25;
    const btn = document.getElementById('inn-rest-btn');
    if (btn) {
        btn.disabled = p.gold < restCost || (p.hp >= p.maxHp && p.mana >= p.maxMana);
        btn.textContent = `Rest & Recover (${restCost}g)`;
    }
    // Hearthstone Coin — only offered to non-casters (warrior/rogue). Mages and
    // clerics return via the Town Portal spell and don't need the coin.
    const hsBtn = document.getElementById('inn-hearthstone-btn');
    if (hsBtn) {
        const cls = (p.className || '').toLowerCase();
        const isCaster = cls === 'mage' || cls === 'cleric';
        if (isCaster) {
            hsBtn.style.display = 'none';
        } else {
            hsBtn.style.display = '';
            const owned = p.hearthstoneCoins || 0;
            hsBtn.disabled = p.gold < HEARTHSTONE_COST;
            hsBtn.textContent = `Hearthstone Coin (${HEARTHSTONE_COST}g)` + (owned ? ` — you have ${owned}` : '');
        }
    }
    renderInnkeeperUpgrades();
}


// Renders the Innkeeper's one-time permanent upgrade menu. Already-owned
// upgrades show as a muted "Owned" row instead of disappearing — keeps
// the list stable rather than reflowing as purchases happen, and lets
// the player see at a glance what they've already bought into.
function renderInnkeeperUpgrades() {
    const list = document.getElementById('inn-upgrades-list');
    if (!list) return;
    const p = gameState.player;
    list.innerHTML = INNKEEPER_UPGRADES.map(up => {
        const owned = !!gameState.tavernUpgrades[up.id];
        const canAfford = p.gold >= up.cost;
        return `
            <div class="inn-upgrade-row${owned ? ' inn-upgrade-owned' : ''}">
                <div class="inn-upgrade-info">
                    <div class="inn-upgrade-name">${escHtml(up.name)}${owned ? ' <span class="inn-upgrade-owned-tag">Owned</span>' : ''}</div>
                    <div class="inn-upgrade-desc">${escHtml(up.desc)}</div>
                </div>
                <button class="inn-upgrade-buy-btn" ${owned || !canAfford ? 'disabled' : ''} onclick="buyInnUpgrade('${up.id}')">
                    ${owned ? '\u2713' : `${up.cost}g`}
                </button>
            </div>
        `;
    }).join('');
}


function buyInnUpgrade(id) {
    const def = INNKEEPER_UPGRADES.find(u => u.id === id);
    if (!def) return;
    if (gameState.tavernUpgrades[id]) return addMessageAndUpdate('Already bought.');
    const p = gameState.player;
    if (p.gold < def.cost) return addMessageAndUpdate(`Need ${def.cost}g for ${def.name}.`);
    p.gold -= def.cost;
    gameState.tavernUpgrades[id] = true;
    saveTavernUpgrades();
    addMessage(`${def.flavor} (${def.name} purchased)`);
    showEventCard('TAVERN UPGRADED', def.name, 'milestone');
    checkAchievements();
    renderInnkeeperUpgrades();
    updateUI();
}


// Cost of a single Hearthstone Coin from the innkeeper (warrior/rogue return item).
const HEARTHSTONE_COST = 40;

function buyHearthstoneCoin() {
    const p = gameState.player;
    const cls = (p.className || '').toLowerCase();
    if (cls === 'mage' || cls === 'cleric') {
        return addMessageAndUpdate('Casters open their own portals — you\'ve no need of a coin.');
    }
    if (p.gold < HEARTHSTONE_COST) return addMessageAndUpdate(`Need ${HEARTHSTONE_COST}g for a Hearthstone Coin.`);
    p.gold -= HEARTHSTONE_COST;
    p.hearthstoneCoins = (p.hearthstoneCoins || 0) + 1;
    sfxItemPickup();
    addMessage(`The innkeeper presses a warm Hearthstone Coin into your palm. (You have ${p.hearthstoneCoins}.)`);
    renderInnkeeper();
    updateUI();
}


function buyInnRest() {
    const p = gameState.player;
    const cost = 25;
    if (p.gold < cost) return addMessageAndUpdate('Not enough gold for a room.');
    p.gold -= cost;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.statuses = [];
    sfxPotion();
    addMessage('A warm bed and hot meal restore you completely.');
    showEventCard('RESTED', 'HP & Mana fully restored', 'heal');
    renderInnkeeper();
    updateUI();
}


function talkToBartender() { openInnkeeper(); }


function openBlacksmith() {
    gameState.blacksmithOpen = true;
    document.getElementById('blacksmith-panel').style.display = 'flex';
    renderBlacksmith();
    updateUI();
}


function closeBlacksmith() {
    gameState.blacksmithOpen = false;
    document.getElementById('blacksmith-panel').style.display = 'none';
    updateUI();
}


function renderBlacksmith() {
    const p = gameState.player;
    document.getElementById('blacksmith-gold').textContent = `${p.gold}g`;
    const w = p.equipment.weapon;
    const cost = 60 + p.level * 15;
    const el = document.getElementById('blacksmith-upgrade-info');
    if (el) {
        el.innerHTML = w
            ? `Weapon: <span class="rarity-${w.rarity}">${w.cursed && !w.identified ? '?? Item' : w.name}</span> (+${w.bonus} ATK) — Upgrade +1 for ${cost}g`
            : 'Equip a weapon first.';
    }
    const btn = document.getElementById('blacksmith-upgrade-btn');
    if (btn) btn.disabled = !w || p.gold < cost;
}


function buyBlacksmithUpgrade() {
    const p = gameState.player;
    const w = p.equipment.weapon;
    if (!w) return addMessageAndUpdate('No weapon equipped.');
    const cost = 60 + p.level * 15;
    if (p.gold < cost) return addMessageAndUpdate(`Need ${cost}g for the upgrade.`);
    p.gold -= cost;
    w.bonus += 1;
    if (w.trueBonus != null) w.trueBonus += 1;
    recalculateStats();
    addMessage(`The blacksmith hammers your ${w.identified !== false ? w.name : 'weapon'} — now +${w.bonus} ATK!`);
    showEventCard('FORGED!', `Weapon +${w.bonus} ATK`, 'loot');
    renderBlacksmith();
    updateUI();
}


function openTrainer() {
    gameState.trainerOpen = true;
    document.getElementById('trainer-panel').style.display = 'flex';
    renderTrainer();
    updateUI();
}


function closeTrainer() {
    gameState.trainerOpen = false;
    document.getElementById('trainer-panel').style.display = 'none';
    updateUI();
}


// Single source of truth for Trainer pricing — the Haggling Rights
// tavern upgrade discounts both costs by 20%, applied here rather than
// duplicated across renderTrainer()'s display logic and each buy
// function's own cost check, which would risk the two drifting out of
// sync (display showing one price, purchase charging another).
function getTrainerCost(base) {
    return gameState.tavernUpgrades.trainerDiscount ? Math.round(base * 0.8) : base;
}


function renderTrainer() {
    const p = gameState.player;
    document.getElementById('trainer-gold').textContent = `${p.gold}g`;
    const hpCost = getTrainerCost(100);
    const atkCost = getTrainerCost(150);
    const hpBtn = document.getElementById('trainer-hp-btn');
    const atkBtn = document.getElementById('trainer-atk-btn');
    if (hpBtn) {
        hpBtn.disabled = gameState.trainerBought.hp || p.gold < hpCost;
        hpBtn.textContent = gameState.trainerBought.hp ? 'Vitality Training (bought)' : `Vitality Training (+10 Max HP) — ${hpCost}g`;
    }
    if (atkBtn) {
        atkBtn.disabled = gameState.trainerBought.atk || p.gold < atkCost;
        atkBtn.textContent = gameState.trainerBought.atk ? 'Power Training (bought)' : `Power Training (+1 ATK) — ${atkCost}g`;
    }
}


function buyTrainerHp() {
    const p = gameState.player;
    const cost = getTrainerCost(100);
    if (gameState.trainerBought.hp) return addMessageAndUpdate('Already trained this run.');
    if (p.gold < cost) return addMessageAndUpdate(`Need ${cost}g for training.`);
    p.gold -= cost;
    p.maxHp += 10;
    p.hp += 10;
    gameState.trainerBought.hp = true;
    addMessage('The trainer pushes your limits — +10 Max HP!');
    showEventCard('TRAINED', '+10 Max HP', 'milestone');
    renderTrainer();
    updateUI();
}


function buyTrainerAtk() {
    const p = gameState.player;
    const cost = getTrainerCost(150);
    if (gameState.trainerBought.atk) return addMessageAndUpdate('Already trained this run.');
    if (p.gold < cost) return addMessageAndUpdate(`Need ${cost}g for training.`);
    p.gold -= cost;
    p.baseAtk += 1;
    gameState.trainerBought.atk = true;
    recalculateStats();
    addMessage('The trainer sharpens your form — +1 base ATK!');
    showEventCard('TRAINED', '+1 ATK', 'milestone');
    renderTrainer();
    updateUI();
}


function openBank() {
    if (gameState.ironmanMode) {
        addMessage('The vault keeper shakes his head. "Ironman oath-takers carry their own risk — no vault for you."');
        updateUI();
        return;
    }
    gameState.bankOpen = true;
    document.getElementById('bank-panel').style.display = 'flex';
    renderBank();
    updateUI();
}


function closeBank() {
    gameState.bankOpen = false;
    document.getElementById('bank-panel').style.display = 'none';
    updateUI();
}


function renderBank() {
    const p = gameState.player;
    document.getElementById('bank-wallet').textContent = `${p.gold}g`;
    document.getElementById('bank-vault').textContent = `${gameState.tavernUpgrades.bankGold}g`;
}


function bankDepositAll() {
    const p = gameState.player;
    if (p.gold <= 0) return addMessageAndUpdate('No gold to deposit.');
    const bankCap = isRenownUnlocked('bankCapUp') ? 700 : 500;
    const space = Math.max(0, bankCap - gameState.tavernUpgrades.bankGold);
    if (space <= 0) return addMessageAndUpdate(`The vault is full (${bankCap}g cap). Withdraw some first.`);
    const depositing = Math.min(p.gold, space);
    ensureMetaStats();
    gameMeta.stats.goldDeposited += depositing;
    gameState.tavernUpgrades.bankGold += depositing;
    p.gold -= depositing;
    saveTavernUpgrades();
    saveMetaProgress();
    checkAchievements();
    addMessage(`Deposited ${depositing}g into the vault. Safe from death.`);
    if (depositing < p.gold + depositing) addMessage(`Vault limit: ${bankCap}g. ${gameState.tavernUpgrades.bankGold}g stored.`);
    renderBank();
    updateUI();
}


function bankDepositHalf() {
    const p = gameState.player;
    const bankCap = isRenownUnlocked('bankCapUp') ? 700 : 500;
    const space = Math.max(0, bankCap - gameState.tavernUpgrades.bankGold);
    if (space <= 0) return addMessageAndUpdate(`The vault is full (${bankCap}g cap).`);
    const amt = Math.min(Math.floor(p.gold / 2), space);
    if (amt <= 0) return addMessageAndUpdate('Not enough gold to deposit.');
    ensureMetaStats();
    gameMeta.stats.goldDeposited += amt;
    gameState.tavernUpgrades.bankGold += amt;
    saveTavernUpgrades();
    saveMetaProgress();
    checkAchievements();
    p.gold -= amt;
    addMessage(`Deposited ${amt}g into the vault.`);
    renderBank();
    updateUI();
}


function bankWithdraw(amount) {
    const p = gameState.player;
    const vault = gameState.tavernUpgrades.bankGold;
    const amt = amount === 'all' ? vault : Math.min(amount, vault);
    if (amt <= 0) return addMessageAndUpdate('The vault is empty.');
    gameState.tavernUpgrades.bankGold -= amt;
    saveTavernUpgrades();
    p.gold += amt;
    addMessage(`Withdrew ${amt}g from the vault.`);
    renderBank();
    updateUI();
}


function donateToBarkeep() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (!isAdjacentToBartender()) { addMessage('Stand near the bartender to donate.'); updateUI(); return; }
    if (gameState.tavernUpgrades.velvetChairs) { addMessage('"The chairs are already bought. Keep your coin," he says.'); updateUI(); return; }
    const amount = 50;
    if (gameState.player.gold < amount) { addMessage(`You need at least ${amount}g to donate.`); updateUI(); return; }
    gameState.player.gold -= amount;
    gameState.tavernUpgrades.goldDonated += amount;
    saveTavernUpgrades();
    const remaining = Math.max(0, 200 - gameState.tavernUpgrades.goldDonated);
    if (remaining > 0) {
        addMessage(`You donate ${amount}g. The bartender grunts. (${remaining}g still needed for velvet chairs)`);
    } else {
        gameState.tavernUpgrades.velvetChairs = true;
        gameState.tavernUpgrades.chandelier = true;
        saveTavernUpgrades();
        addMessage('The Broken Flagon has been permanently upgraded with velvet seating and a golden chandelier!');
        checkAchievements();
    }
    updateUI();
}


function isAdjacentToInnkeeper() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.innkeeper.x, gameState.innkeeper.y) <= 1;
}

function isAdjacentToBartender() { return isAdjacentToInnkeeper(); }

function isAdjacentToBlacksmith() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.blacksmith.x, gameState.blacksmith.y) <= 1;
}

function isAdjacentToTrainer() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.trainer.x, gameState.trainer.y) <= 1;
}

function isAdjacentToBank() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.bank.x, gameState.bank.y) <= 1;
}

function isAdjacentToQuestBoard() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.questBoard.x, gameState.questBoard.y) <= 1;
}



function isAdjacentToMerchant() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.merchant.x, gameState.merchant.y) <= 1;
}


function isAdjacentToGambler() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.gambler.x, gameState.gambler.y) <= 1;
}


// Resets any subclass state that's meant to refresh "once per floor"
// rather than persisting for the whole run. Called from both
// descendFloor() and ascendFloor() so the two can't drift — currently
// only Trickster's advertised "first hit each floor has a dodge
// chance" trait needs this, but it's written generically in case a
// future subclass trait needs the same per-floor-refresh pattern.
function resetPerFloorSubclassState() {
    const p = gameState.player;
    if (!p) return;

    // Cellar Find's Adrenaline Rush (see CELLAR_FIND_CHOICES in data.js)
    // — not subclass-gated, so checked before the p.sc guard below.
    // Expires the moment the floor actually changes; recalculated
    // immediately so the ATK/DEF boost drops off right away rather than
    // lingering until some unrelated recalc happens to fire later.
    if (p.cellarRushFloor !== null && p.cellarRushFloor !== gameState.floor) {
        p.baseAtk -= 8;
        p.baseDef -= 5;
        p.cellarRushFloor = null;
        recalculateStats();
        addMessage('The adrenaline rush fades.');
    }

    if (!p.sc) return;
    if (p.subclass === 'trickster') p.sc.dodgeReady = true;
    // Berserker's advertised "ignores death once per floor at 1 HP" —
    // see tryBerserkerDeathSave() in showGameOver's lethal-save chain.
    if (p.subclass === 'berserker') p.sc.deathSaveReady = true;
}


function descendFloor() {
    if (gameState.floor >= MAX_DUNGEON_FLOOR) return;

    // Snapshot the floor we're leaving before anything changes so it can be
    // restored identically if the player ascends back here later.
    saveFloorToCache();

    gameState.floor++;
    // Show floor transition overlay (non-blocking — auto-dismisses)
    if (typeof showFloorTransition === 'function') showFloorTransition(gameState.floor);
    resetPerFloorSubclassState();
    // Warlord's Banner relic — permanent +1 ATK each time you descend.
    {
        const p = gameState.player;
        const banner = p.relics?.find(r => r.id === 'warlords_banner');
        if (banner) {
            const def = RELIC_DEFS.warlords_banner;
            p.baseAtk += (def.atkPerFloor || 1);
            addMessage(`The Warlord's Banner surges — permanent +${def.atkPerFloor || 1} ATK.`);
        }
    }
    gameState.player.x = SPAWN_X;
    gameState.player.y = SPAWN_Y;
    gameState.player.renderX = SPAWN_X * TILE_SIZE;
    gameState.player.renderY = SPAWN_Y * TILE_SIZE;
    gameState.player.shieldActive = false;
    gameState.player.regenMana();
    gameState.effects = [];
    gameState.fallenEnemies = [];
    // Floor-dependent passives (Knight's depth-scaled DEF, Gladiator's
    // depth-scaled gold find) need to be current the moment the floor
    // actually changes, not just whenever something else happens to
    // trigger a recalc later.
    recalculateStats();

    // Tick brew duration
    if (gameState.activeBrew) {
        if (gameState.activeBrew.duration > 0) {
            gameState.activeBrew.duration--;
            if (gameState.activeBrew.duration <= 0) {
                const def = BREW_MENU.find(b => b.id === gameState.activeBrew.id);
                if (def) def.remove(gameState.player);
                addMessage(`The ${gameState.activeBrew.name} wears off.`);
                gameState.activeBrew = null;
                recalculateStats();
            }
        }
    }

    // Quest tracking: challenge_reach and no_potion_run
    const q = gameState.activeQuest;
    if (q && !q.completed && !q.failed) {
        if (q.type === 'challenge_reach' && gameState.floor >= q.targetAmount) {
            completeQuest();
        } else if (q.type === 'no_potion_run' && gameState.floor >= q.targetAmount) {
            completeQuest();
        }
    }

    // Trophy: royal rug unlocked on reaching floor 5
    if (gameState.floor >= 5 && !gameState.tavernUpgrades.royalRug) {
        gameState.tavernUpgrades.royalRug = true;
        saveTavernUpgrades();
        addMessage('A royal rug has been laid in the Broken Flagon — the tavern looks almost respectable!');
        checkAchievements();
    }

    // Song: descentHeal (Lament of the Broken)
    if (gameState.activeSong && gameState.activeSong.effect.type === 'stat_boost'
        && gameState.activeSong.effect.stat === 'descentHeal') {
        const heal = gameState.activeSong.effect.value;
        const p = gameState.player;
        p.hp = Math.min(p.hp + heal, p.maxHp);
        addMessage(`The bard's lament soothes you — restored ${heal} HP.`);
    }

    // Restore the floor from cache if we've been here before; otherwise
    // generate it fresh. Either path leaves gameState.dungeon/revealed/etc.
    // fully populated for the new floor number.
    const revisit = restoreFloorFromCache(gameState.floor);
    if (!revisit) {
        generateDungeon();
    } else {
        // Reveal the spawn area so the player can see where they landed —
        // generateDungeon() normally does this; we replicate it on restore.
        revealAround(SPAWN_X, SPAWN_Y, 4);
    }

    if (gameState.floor === 1 && !revisit) {
        addMessage(`You enter ${DUNGEON_NAME} — ${MAX_DUNGEON_FLOOR} floors stand between you and The Fallen God.`);
        showEventCard(DUNGEON_NAME, `Floor 1 / ${MAX_DUNGEON_FLOOR}`, 'milestone');
    } else if (revisit) {
        addMessage(`You descend back to Floor ${gameState.floor} — the ash still settles here.`);
    } else {
        addMessage(`You descend to Floor ${gameState.floor} of ${MAX_DUNGEON_FLOOR}.`);
    }
    // Floor 100: show the Fallen God reveal before announcing the milestone.
    if (gameState.floor === MAX_DUNGEON_FLOOR && !revisit && typeof maybeShowFallenGodReveal === 'function') {
        maybeShowFallenGodReveal(() => {
            addMessage('The Fallen God stirs in the dark below. This is the end.');
        });
    }
    const milestone = MILESTONE_BOSSES[gameState.floor];
    if (milestone && !revisit) addMessage(`A milestone looms: ${milestone.name} guards this floor.`);
    updateUI();
}


function ascendFloor() {
    if (!gameState.player || gameState.floor <= 1) return;

    // Snapshot the floor we're leaving before decrementing the counter.
    saveFloorToCache();

    gameState.floor--;
    resetPerFloorSubclassState();
    gameState.player.shieldActive = false;
    gameState.player.regenMana();
    gameState.effects = [];
    recalculateStats();

    // Tick brew duration — every floor transition (up or down) costs a charge
    if (gameState.activeBrew) {
        if (gameState.activeBrew.duration > 0) {
            gameState.activeBrew.duration--;
            if (gameState.activeBrew.duration <= 0) {
                const def = BREW_MENU.find(b => b.id === gameState.activeBrew.id);
                if (def) def.remove(gameState.player);
                addMessage(`The ${gameState.activeBrew.name} wears off.`);
                gameState.activeBrew = null;
                recalculateStats();
            }
        }
    }

    // Always try the cache first — we were just on this floor, so it will
    // almost always hit. Fall back to generateDungeon() only if somehow
    // the cache was cleared (e.g. initGame() on a new run).
    if (!restoreFloorFromCache(gameState.floor)) {
        generateDungeon();
    }

    // Arrive at the descend stairs — mirror of how descendFloor places
    // the player at the ascend stairs on the floor below.
    gameState.player.x = EXIT_X;
    gameState.player.y = EXIT_Y;
    gameState.player.renderX = EXIT_X * TILE_SIZE;
    gameState.player.renderY = EXIT_Y * TILE_SIZE;
    revealAround(EXIT_X, EXIT_Y, 4);

    addMessage(`You ascend to Floor ${gameState.floor}.`);
    updateUI();
}


// Leave the dungeon and go to the tavern, BANKING the current floor so the
// player can return to it later (via the dungeon entrance "Resume" option).
// This is the shared back-end for the Town Portal spell and the Hearthstone
// Coin — both call this. The floor is saved to the LRU cache and recorded in
// gameState.dungeonReturnFloor.
function portalToTavern() {
    if (!gameState.player || gameState.floor <= 0) return;

    // Bank the floor we're leaving so it can be restored exactly on return.
    saveFloorToCache();
    gameState.dungeonReturnFloor = gameState.floor;

    gameState.floor = 0;
    gameState.player.shieldActive = false;
    gameState.player.regenMana();
    gameState.effects = [];

    generateDungeon(); // floor === 0 branch rebuilds the tavern map and reveals it

    // Arrive at the tavern's dungeon hatch.
    gameState.player.x = EXIT_X;
    gameState.player.y = EXIT_Y;
    gameState.player.renderX = EXIT_X * TILE_SIZE;
    gameState.player.renderY = EXIT_Y * TILE_SIZE;

    addMessage(`You step into the tavern. A shimmering anchor marks Floor ${gameState.dungeonReturnFloor} — return when you're ready.`);
    saveActiveRun();
    updateUI();
}


// Return to the floor the player portalled out from. Called from the dungeon
// entrance prompt when a return anchor exists. Restores the banked floor from
// cache and drops the player at the up-stairs of that floor.
function returnToDungeon() {
    const rf = gameState.dungeonReturnFloor;
    if (!rf || rf <= 0) {
        addMessageAndUpdate('You have no portal anchor to return to.');
        return;
    }
    gameState.floor = rf;

    // Restore the banked floor (this also restores its revealed fog-of-war);
    // if the cache was evicted, regenerate fresh (generateDungeon inits the
    // revealed grid itself).
    if (!restoreFloorFromCache(rf)) {
        generateDungeon();
    }

    // Place the player at the floor's up-stairs (the tavern-exit tile) so they
    // arrive where a portal would deposit them, not at the down-stairs.
    let placed = false;
    for (let y = 0; y < MAP_HEIGHT && !placed; y++) {
        for (let x = 0; x < MAP_WIDTH && !placed; x++) {
            if (gameState.dungeon[y][x] === TILE_TAVERN_EXIT || gameState.dungeon[y][x] === TILE_ASCEND) {
                gameState.player.x = x; gameState.player.y = y; placed = true;
            }
        }
    }
    if (!placed) {
        // Fallback: first walkable tile
        for (let y = 0; y < MAP_HEIGHT && !placed; y++)
            for (let x = 0; x < MAP_WIDTH && !placed; x++)
                if (isWalkable(x, y)) { gameState.player.x = x; gameState.player.y = y; placed = true; }
    }
    gameState.player.renderX = gameState.player.x * TILE_SIZE;
    gameState.player.renderY = gameState.player.y * TILE_SIZE;

    revealAround(gameState.player.x, gameState.player.y, 4);
    gameState.dungeonReturnFloor = null; // anchor consumed on return
    addMessage(`You step back through the portal to Floor ${rf}.`);
    refreshEnemyIntents();
    saveActiveRun();
    updateUI();
}


// Legacy free return — kept for the death/forfeit code paths and the Gladiator
// arena that still need an unconditional return. Does NOT bank a return floor.
function returnToTavern() {
    if (!gameState.player) return;

    saveFloorToCache();

    gameState.floor = 0;
    gameState.player.shieldActive = false;
    gameState.player.regenMana();
    gameState.effects = [];

    generateDungeon();

    gameState.player.x = EXIT_X;
    gameState.player.y = EXIT_Y;
    gameState.player.renderX = EXIT_X * TILE_SIZE;
    gameState.player.renderY = EXIT_Y * TILE_SIZE;

    addMessage('You return to The Broken Flagon Tavern.');
    saveActiveRun();
    updateUI();
}


// ── Tavern exit confirmation (floor-1 stairs tile + T hotkey) ─────────────────

function tryStairsInteraction() {
    if (!gameState.player || gameState.floor === 0) return false;
    const tile = gameState.dungeon[gameState.player.y][gameState.player.x];
    if (tile === TILE_TAVERN_EXIT) {
        // Floor 1's up-stairs are the literal staircase back up to the tavern —
        // walking out the front door is always free. Deeper floors have no
        // staircase to the surface, so leaving from there is a teleport that
        // requires a Town Portal spell (mage/cleric) or Hearthstone Coin
        // (warrior/rogue), routed through requestReturnToTavern().
        if (gameState.floor === 1) {
            showTavernConfirm('Climb back up to The Broken Flagon?', 'Return', 'Cancel', 'return');
        } else {
            requestReturnToTavern();
        }
        return true;
    }
    return false;
}


function showTavernConfirm(message, confirmLabel = 'Yes', cancelLabel = 'No', action = 'return') {
    if (!gameState.player || gameState.floor === 0 || gameState.tavernConfirmOpen) return;
    gameState.tavernConfirmOpen = true;
    gameState.tavernConfirmAction = action; // 'return' | 'portal_spell' | 'portal_coin'
    document.getElementById('tavern-confirm-message').textContent = message;
    document.getElementById('tavern-confirm-yes-btn').textContent = confirmLabel;
    document.getElementById('tavern-confirm-no-btn').textContent = cancelLabel;
    document.getElementById('tavern-confirm-panel').style.display = 'flex';
}


function closeTavernConfirm() {
    gameState.tavernConfirmOpen = false;
    gameState.tavernConfirmAction = null;
    document.getElementById('tavern-confirm-panel').style.display = 'none';
}


function confirmReturnToTavern() {
    const action = gameState.tavernConfirmAction;
    if (action === 'portal_spell')    { confirmPortalSpell(); return; }
    if (action === 'portal_coin')     { confirmPortalCoin();  return; }
    if (action === 'entrance_choice') { confirmEntranceChoice(true);  return; }
    // Legacy/default: unconditional return (used by stairs tile fallback)
    closeTavernConfirm();
    returnToTavern();
}


// Shown at the tavern dungeon entrance when the player has a portal anchor.
// Lets them resume the banked floor or abandon it and descend fresh from 1.
function showDungeonEntranceChoice() {
    const rf = gameState.dungeonReturnFloor;
    const panel = document.getElementById('tavern-confirm-panel');
    document.getElementById('tavern-confirm-message').textContent =
        `Your portal anchor still holds at Floor ${rf}. Return there, or abandon it and descend fresh from Floor 1?`;
    document.getElementById('tavern-confirm-yes-btn').textContent = `Return to Floor ${rf}`;
    document.getElementById('tavern-confirm-no-btn').textContent = 'Descend Fresh';
    gameState.tavernConfirmAction = 'entrance_choice';
    gameState.tavernConfirmOpen = true;
    panel.style.display = 'flex';
}


function confirmEntranceChoice(resume) {
    closeTavernConfirm();
    if (resume) {
        returnToDungeon();
    } else {
        gameState.dungeonReturnFloor = null;
        descendFloor();
    }
}


// The "No"/cancel button. For the entrance choice, "No" means "Descend Fresh"
// (an action, not a dismissal); for every other confirm it just closes.
function cancelTavernConfirm() {
    if (gameState.tavernConfirmAction === 'entrance_choice') {
        confirmEntranceChoice(false);
        return;
    }
    closeTavernConfirm();
}


function requestReturnToTavern() {
    if (!gameState.player || gameState.floor <= 0) return;
    const p = gameState.player;
    const cls = (p.className || '').toLowerCase();

    // Mage / Cleric: must cast Town Portal (handled in the spellbook). Point
    // them there rather than returning for free.
    if (cls === 'mage' || cls === 'cleric') {
        const book = (typeof SPELLBOOK !== 'undefined' && SPELLBOOK[cls]) || [];
        const portal = book.find(s => s.id === 'town_portal');
        if (portal && p.level >= portal.unlockLevel) {
            if (p.mana >= portal.mana) {
                showTavernConfirm(
                    `Cast ${portal.name} (${portal.mana} mana) to return to the tavern? You can come back to Floor ${gameState.floor}.`,
                    'Cast Portal', 'Cancel', 'portal_spell');
            } else {
                addMessageAndUpdate(`You need ${portal.mana} mana to open a portal (have ${p.mana}). Rest or use the spellbook.`);
            }
        } else {
            addMessageAndUpdate(`You can learn Town Portal at level ${portal ? portal.unlockLevel : 4}. Until then, descend or fall.`);
        }
        return;
    }

    // Warrior / Rogue (and others): need a Hearthstone Coin.
    const coins = p.hearthstoneCoins || 0;
    if (coins > 0) {
        showTavernConfirm(
            `Use a Hearthstone Coin to return to the tavern? You have ${coins}. You can come back to Floor ${gameState.floor}.`,
            'Use Coin', 'Cancel', 'portal_coin');
    } else {
        addMessageAndUpdate('You have no Hearthstone Coin. Buy one from the innkeeper at the tavern before you descend.');
    }
}


// Casts the portal spell from the confirm dialog (mage/cleric path).
function confirmPortalSpell() {
    closeTavernConfirm();
    const p = gameState.player;
    const cls = (p.className || '').toLowerCase();
    const book = (typeof SPELLBOOK !== 'undefined' && SPELLBOOK[cls]) || [];
    const portal = book.find(s => s.id === 'town_portal');
    if (!portal || p.mana < portal.mana) { addMessageAndUpdate('The portal fizzles.'); return; }
    p.mana -= portal.mana;
    addBurst(p.x, p.y, '#9d7bff');
    addMessage('A swirling portal opens. You step through to The Broken Flagon.');
    portalToTavern();
}


// Spends a Hearthstone Coin from the confirm dialog (warrior/rogue path).
function confirmPortalCoin() {
    closeTavernConfirm();
    const p = gameState.player;
    if ((p.hearthstoneCoins || 0) <= 0) { addMessageAndUpdate('You have no Hearthstone Coin.'); return; }
    p.hearthstoneCoins -= 1;
    addBurst(p.x, p.y, '#ffd65a');
    addMessage('You crack the Hearthstone Coin. Its warmth pulls you back to the tavern.');
    portalToTavern();
}


// ── Shop ──────────────────────────────────────────────────────────────────────

function getShopItems() {
    const f = gameState.floor;
    const p = gameState.player;
    return [
        {
            id: 'potion',
            label: 'Health Potion',
            desc: 'Restore 35 + level×5 HP when used',
            icon: '+',
            cost: 18 + f * 4,
            buy() {
                addItemToInventory({ type: 'potion', name: 'Health Potion', qty: 1 });
                addMessage('You buy a Health Potion.');
            }
        },
        {
            id: 'heal',
            label: 'Patch Up',
            desc: 'Restore 40% of max HP right now',
            icon: '♥',
            cost: 24 + f * 5,
            buy() {
                const restored = Math.ceil(p.maxHp * 0.4);
                p.hp = Math.min(p.maxHp, p.hp + restored);
                addFloatingText(p.x, p.y, `+${restored}`, '#58c26d');
                addMessage(`The merchant patches your wounds (+${restored} HP).`);
            }
        },
        {
            id: 'reroll',
            label: 'Reroll Gear',
            desc: 'Replace your worst gear slot with a new item for the current floor',
            icon: '↺',
            cost: 30 + f * 8,
            buy() {
                p.equipment = migrateEquipment(p.equipment);
                const slot = !p.equipment.weapon ? 'weapon' : rollGearSlot();
                const item = createGear(p.x, p.y, slot);
                item.x = undefined; item.y = undefined;
                p.equip(item);
                addMessage(`The merchant swaps in a ${item.name} (${getGearStatLabel(item)}).`);
            }
        },
        {
            id: 'trinket',
            label: 'Mystery Trinket',
            desc: 'A random accessory — could be anything',
            icon: '*',
            cost: 38 + f * 10,
            buy() {
                const item = createAccessory(p.x, p.y);
                item.x = undefined; item.y = undefined;
                addItemToInventory(item);
                autoEquipIfBetter(item);
                addMessage(`"Special deal," winks the merchant. ${item.name} added.`);
            }
        },
        {
            id: 'atk',
            label: 'Sharpen Edge',
            desc: '+2 permanent Attack',
            icon: '↑',
            cost: 55 + f * 12,
            buy() {
                p.baseAtk += 2;
                recalculateStats();
                addMessage('Your strikes feel sharper (+2 ATK).');
            }
        },
        {
            id: 'maxhp',
            label: 'Toughening',
            desc: '+20 permanent Max HP, restored to full',
            icon: '▲',
            cost: 60 + f * 12,
            buy() {
                p.maxHp += 20;
                p.hp = p.maxHp;
                addMessage('You feel tougher (+20 Max HP).');
            }
        },
        // Capture Net — only appears once the Arena is unlocked (bestFloor >= 20)
        // so it doesn't clutter early shop visits. Flat price: it's a tool,
        // not a power item, so floor-scaling would penalise late-game play.
        ...(isPitUnlocked() ? [{
            id: 'captureCage',
            label: 'Capture Net',
            desc: 'Cage a weakened enemy (< 30% HP) for Arena bouts. Key: 6',
            icon: 'N',
            cost: 45,
            buy() {
                addItemToInventory({ type: 'captureCage', name: 'Capture Net', qty: 1, color: '#c98bff', glyph: 'N' });
                addMessage('"Sturdy enough for most things," the merchant says. "Don\'t try it on the big ones."');
            }
        }] : []),
        // Renown 50 — trusted customer gets an extra item: a lucky charm
        // that boosts rarity odds for the run. Visible only once earned.
        ...(isRenownUnlocked('merchantSlot') ? [{
            id: 'luckyCharm',
            label: 'Lucky Charm',
            desc: '+8% item rarity odds this run. Consumed on purchase.',
            icon: '★',
            cost: 60 + f * 6,
            buy() {
                gameState.player._luckyCharmBonus = (gameState.player._luckyCharmBonus || 0) + 0.08;
                addMessage('"My best customer gets the good stuff," the merchant winks.');
            }
        }] : []),
    ];
}


function openShop() {
    gameState.shopOpen = true;
    showShopTab('buy');
    document.getElementById('shop-panel').style.display = 'flex';
    addMessage('"See anything you like? Gold only, no haggling," says the merchant.');
    updateUI();
}


function closeShop() {
    gameState.shopOpen = false;
    document.getElementById('shop-panel').style.display = 'none';
    updateUI();
}


let shopTab = 'buy';


function showShopTab(tab) {
    shopTab = tab;
    document.getElementById('shop-tab-btn-buy').classList.toggle('shop-tab-active', tab === 'buy');
    document.getElementById('shop-tab-btn-sell').classList.toggle('shop-tab-active', tab === 'sell');
    document.getElementById('shop-tab-buy').style.display = tab === 'buy' ? 'block' : 'none';
    document.getElementById('shop-tab-sell').style.display = tab === 'sell' ? 'block' : 'none';
    renderShop();
}


function renderShop() {
    const goldEl = document.getElementById('shop-gold');
    goldEl.textContent = `Your gold: ${gameState.player.gold}g`;

    if (shopTab === 'sell') {
        renderSellList();
        return;
    }

    const items = getShopItems();
    const list = document.getElementById('shop-list');
    list.innerHTML = '';

    items.forEach(item => {
        const row = document.createElement('div');
        const canAfford = gameState.player.gold >= item.cost;
        row.className = `shop-row${canAfford ? '' : ' shop-cant-afford'}`;
        row.innerHTML = `
            <span class="shop-icon">${item.icon}</span>
            <span class="shop-info">
                <span class="shop-name">${item.label}</span>
                <span class="shop-desc">${item.desc}</span>
            </span>
            <button class="shop-buy-btn" ${canAfford ? '' : 'disabled'}>${item.cost}g</button>
        `;
        if (canAfford) {
            row.querySelector('.shop-buy-btn').addEventListener('click', () => {
                gameState.player.gold -= item.cost;
                item.buy();
                renderShop();
                updateUI();
            });
        }
        list.appendChild(row);
    });
}


function renderSellList() {
    const list = document.getElementById('shop-sell-list');
    if (!list) return;
    list.innerHTML = '';

    const p = gameState.player;
    const rows = [];

    GEAR_SLOTS.forEach(slot => {
        const item = migrateEquipment(p.equipment)[slot];
        if (!item) return;
        rows.push({ item, value: getSellValue(item), onSell: () => sellEquippedSlot(slot), slotLabel: `${SLOT_LABELS[slot]} (equipped)` });
    });

    p.inventory.filter(i => i.type === 'equipment').forEach(item => {
        rows.push({ item, value: getSellValue(item), onSell: () => sellItem(item), slotLabel: null });
    });

    if (rows.length === 0) {
        list.innerHTML = '<div class="shop-sell-empty">No gear to sell right now.</div>';
        return;
    }

    rows.forEach(({ item, value, onSell, slotLabel }) => {
        const hidden = item.cursed && !item.identified;
        const name = hidden ? '?? Item' : item.name;
        const stat = hidden ? '+??' : `+${item.bonus}${item.unit || ''}`;
        const cursedTag = (item.cursed && item.identified) ? ' <span class="cursed-tag">CURSED</span>' : '';
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `
            <span class="shop-icon">${getGearIcon(item.slot)}</span>
            <span class="shop-info">
                <span class="shop-name rarity-${item.rarity || 'common'}">${name} ${stat}${cursedTag}</span>
                <span class="shop-desc">${slotLabel ? slotLabel : 'In pack'}${item.desc ? ` — ${item.desc}` : ''}</span>
            </span>
            <button class="shop-buy-btn shop-sell-btn">Sell ${value}g</button>
        `;
        row.querySelector('.shop-sell-btn').addEventListener('click', onSell);
        list.appendChild(row);
    });
}

let _diceRollTimer = null;


function openGambling() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.cellarFindOpen) return;
    gameState.gamblingOpen = true;
    const panel = document.getElementById('gambling-panel');
    if (panel) panel.style.display = 'flex';
    tickCasinoJackpot();
    openCasinoLobby();
    _syncGamblingGold();
    updateUI();
}


function closeGambling() {
    gameState.gamblingOpen = false;
    const panel = document.getElementById('gambling-panel');
    if (panel) panel.style.display = 'none';
    // Reset dice faces
    ['die-1', 'die-2', 'die-3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = '—'; el.className = 'die'; }
    });
    const res = document.getElementById('gambling-result');
    if (res) { res.textContent = ''; res.className = 'gambling-result'; }
    const wr = document.getElementById('wheel-result');
    if (wr) { wr.textContent = ''; wr.className = 'gambling-result'; }
    updateUI();
}


function openCasinoLobby() {
    _showCasinoScreen('lobby');
    const titleEl = document.getElementById('casino-title');
    if (titleEl) titleEl.innerHTML = '<span class="panel-icon">&#9860;</span> The Broken Flagon Casino';
    _refreshJackpotBanner();
    _syncGamblingGold();
}


function openCasinoGame(game) {
    if (game === 'dice') {
        _showCasinoScreen('dice');
        const titleEl = document.getElementById('casino-title');
        if (titleEl) titleEl.innerHTML = '<span class="panel-icon">&#9860;</span> Flagon Dice';
    } else if (game === 'wheel') {
        _showCasinoScreen('wheel');
        const titleEl = document.getElementById('casino-title');
        if (titleEl) titleEl.innerHTML = '<span class="panel-icon">&#9880;</span> Fortune Wheel';
        _drawWheel(null);
    } else if (game === 'cards') {
        _showCasinoScreen('cards');
        const titleEl = document.getElementById('casino-title');
        if (titleEl) titleEl.innerHTML = '<span class="panel-icon">&#127137;</span> Three-Card Draw';
        resetCards();
    } else if (game === 'slots') {
        _showCasinoScreen('slots');
        const titleEl = document.getElementById('casino-title');
        if (titleEl) titleEl.innerHTML = '<span class="panel-icon">&#9813;</span> Dragon Slots';
        _resetSlots();
    } else if (game === 'coinflip') {
        _showCasinoScreen('coinflip');
        const titleEl = document.getElementById('casino-title');
        if (titleEl) titleEl.innerHTML = '<span class="panel-icon">&#9711;</span> Coin &amp; Crown';
        const res = document.getElementById('coin-result');
        if (res) res.textContent = '';
        const coin = document.getElementById('coin-display');
        if (coin) { coin.textContent = '⊙'; coin.className = ''; }
    }
    _syncGamblingGold();
}


function _showCasinoScreen(screen) {
    const screens = ['casino-lobby', 'casino-dice-screen', 'casino-wheel-screen',
                     'casino-cards-screen', 'casino-slots-screen', 'casino-coinflip-screen'];
    const map = {
        lobby:    'casino-lobby',
        dice:     'casino-dice-screen',
        wheel:    'casino-wheel-screen',
        cards:    'casino-cards-screen',
        slots:    'casino-slots-screen',
        coinflip: 'casino-coinflip-screen',
    };
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === map[screen] ? 'block' : 'none';
    });
}


function _refreshJackpotBanner() {
    const amtEl = document.getElementById('casino-jackpot-amount');
    const btn = document.getElementById('casino-jackpot-btn');
    const claimed = document.getElementById('casino-jackpot-claimed');
    if (!amtEl) return;
    const jackpot = getCasinoJackpot();
    amtEl.textContent = `${jackpot}g`;
    const canClaim = canClaimJackpot();
    if (btn) btn.style.display = canClaim ? 'inline-block' : 'none';
    if (claimed) claimed.style.display = canClaim ? 'none' : 'inline';
}


function claimDailyJackpot() {
    if (!gameState.player || !canClaimJackpot()) return;
    const prize = claimJackpot(gameState.player);
    _refreshJackpotBanner();
    _syncGamblingGold();
    // Spin the jackpot wheel as a visual flourish
    openCasinoGame('wheel');
    const resultEl = document.getElementById('wheel-result');
    if (resultEl) {
        resultEl.textContent = `🏆 Daily Jackpot! You won ${prize}g!`;
        resultEl.className = 'gambling-result result-jackpot';
    }
    addMessage(`[Casino] Daily Jackpot claimed — you pocketed ${prize}g! Come back tomorrow for another spin.`);
    _drawWheelSpin(Math.floor(rng() * WHEEL_SEGMENTS.length), 4, () => {});
    updateUI();
}


function _syncGamblingGold() {
    const el = document.getElementById('gambling-gold');
    if (el && gameState.player) el.textContent = `Gold: ${gameState.player.gold}g`;
    const wager = document.getElementById('wager-input');
    if (wager) wager.max = Math.min(500, gameState.player ? gameState.player.gold : 500);
    const ww = document.getElementById('wheel-wager-input');
    if (ww) ww.max = Math.min(500, gameState.player ? gameState.player.gold : 500);
}


function _setDiceBtnsDisabled(disabled) {
    document.querySelectorAll('.bet-btn').forEach(b => b.disabled = disabled);
}


function playDice(betType) {
    if (!gameState.player || !gameState.gamblingOpen) return;

    const wagerEl = document.getElementById('wager-input');
    const resultEl = document.getElementById('gambling-result');
    const wager = Math.round(Number(wagerEl ? wagerEl.value : 10));

    const showErr = msg => {
        if (resultEl) { resultEl.textContent = msg; resultEl.className = 'gambling-result result-lose'; }
    };

    if (wager < 5)                        return showErr('Minimum wager is 5 gold.');
    if (wager > 100)                       return showErr('Maximum wager is 100 gold.');
    if (gameState.player.gold < wager)     return showErr("Not enough gold.");

    gameState.player.gold -= wager;
    _setDiceBtnsDisabled(true);
    if (resultEl) { resultEl.textContent = 'Rolling…'; resultEl.className = 'gambling-result'; }
    _syncGamblingGold();

    // Roll values (pre-determined) — seeded, since this outcome is real
    // gameplay state (gold won or lost), unlike the flicker below.
    const rolls = [
        Math.floor(rng() * 6) + 1,
        Math.floor(rng() * 6) + 1,
        Math.floor(rng() * 6) + 1,
    ];
    const dieEls = ['die-1', 'die-2', 'die-3'].map(id => document.getElementById(id));

    // Flicker animation — deliberately NOT seeded. This is pure visual
    // noise while the "Rolling…" suspense plays out; the real outcome is
    // already locked in above. Routing it through rng() would burn seeded
    // RNG state on something with zero effect on the actual run.
    dieEls.forEach(el => { if (el) el.textContent = '?'; });
    const start = Date.now();
    const flicker = setInterval(() => {
        dieEls.forEach(el => {
            if (el) el.textContent = DICE_FACES[Math.floor(Math.random() * 6)];
        });
    }, 70);

    clearTimeout(_diceRollTimer);
    _diceRollTimer = setTimeout(() => {
        clearInterval(flicker);

        // Show final faces
        rolls.forEach((r, i) => { if (dieEls[i]) dieEls[i].textContent = DICE_FACES[r - 1]; });

        const total = rolls[0] + rolls[1] + rolls[2];
        const isTriple = rolls[0] === rolls[1] && rolls[1] === rolls[2];

        let won = false, payout = 0, msg = '';

        if (betType === 'triple') {
            if (isTriple) {
                won = true; payout = wager * 5;
                msg = `TRIPLE ${rolls[0]}s! You win ${payout}g!`;
            } else {
                msg = `Total ${total} — No triple. You lose ${wager}g.`;
            }
        } else if (betType === 'low') {
            if (total <= 10) {
                won = true; payout = wager * 2;
                msg = `Total ${total} — LOW! You win ${payout}g!`;
            } else {
                msg = `Total ${total} — Too high. You lose ${wager}g.`;
            }
        } else if (betType === 'high') {
            if (total >= 12) {
                won = true; payout = wager * 2;
                msg = `Total ${total} — HIGH! You win ${payout}g!`;
            } else {
                msg = `Total ${total} — Too low. You lose ${wager}g.`;
            }
        }

        if (won) {
            gameState.player.gold += payout;
            ensureMetaStats();
            gameMeta.stats.diceWins++;
            checkAchievements();
        }

        if (resultEl) {
            resultEl.textContent = msg;
            resultEl.className = 'gambling-result ' + (won ? 'result-win' : 'result-lose');
        }

        addMessage(`[Flagon Dice] ${rolls.map(r => DICE_FACES[r - 1]).join(' ')} = ${total} — ${msg}`);
        _syncGamblingGold();
        _setDiceBtnsDisabled(false);
        updateUI();
    }, 500);
}


// ── Fortune Wheel ─────────────────────────────────────────────────────────────

let _wheelSpinTimer = null;
let _wheelAnimFrame = null;

// Draw the static wheel at a given rotation angle (radians). Null = default.
function _drawWheel(angle) {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = cx - 8;
    const segs = WHEEL_SEGMENTS;
    const total = segs.reduce((s, sg) => s + sg.weight, 0);
    let startAngle = angle || 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1208';
    ctx.fill();
    ctx.strokeStyle = '#c8a060';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Segments
    segs.forEach((seg, i) => {
        const sliceAngle = (seg.weight / total) * Math.PI * 2;
        const endAngle = startAngle + sliceAngle;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.globalAlpha = 0.88;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        const midAngle = startAngle + sliceAngle / 2;
        const lx = cx + Math.cos(midAngle) * (r * 0.68);
        const ly = cy + Math.sin(midAngle) * (r * 0.68);
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(midAngle + Math.PI / 2);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${seg.label.length > 2 ? 11 : 13}px "Courier New"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 3;
        ctx.fillText(seg.label, 0, 0);
        ctx.restore();

        startAngle = endAngle;
    });

    // Center hub
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#c8a060';
    ctx.fill();
    ctx.strokeStyle = '#8a6828';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#2a1e0a';
    ctx.font = 'bold 12px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', cx, cy);
}


// Animate the wheel spinning, landing on segmentIndex after ~2s.
function _drawWheelSpin(segmentIndex, extraRevolutions, onDone) {
    if (_wheelAnimFrame) cancelAnimationFrame(_wheelAnimFrame);
    const segs = WHEEL_SEGMENTS;
    const total = segs.reduce((s, sg) => s + sg.weight, 0);

    // Find the angle where segmentIndex's CENTER sits at the top (pointer).
    // Pointer is at the top = -Math.PI/2 in canvas coords.
    let accAngle = 0;
    for (let i = 0; i < segmentIndex; i++) {
        accAngle += (segs[i].weight / total) * Math.PI * 2;
    }
    const segCenter = accAngle + (segs[segmentIndex].weight / total) * Math.PI * 2 / 2;
    // Target rotation: pointer sits at top when startAngle puts segCenter at -PI/2
    const targetAngle = (Math.PI * 2 * extraRevolutions) + (-Math.PI / 2 - segCenter);

    const duration = 3000;
    const startTime = performance.now();

    function frame(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const currentAngle = eased * targetAngle;
        _drawWheel(currentAngle);
        if (t < 1) {
            _wheelAnimFrame = requestAnimationFrame(frame);
        } else {
            _wheelAnimFrame = null;
            onDone();
        }
    }
    _wheelAnimFrame = requestAnimationFrame(frame);
}


function playWheel() {
    if (!gameState.player || !gameState.gamblingOpen) return;
    const wagerEl = document.getElementById('wheel-wager-input');
    const resultEl = document.getElementById('wheel-result');
    const wager = Math.round(Number(wagerEl ? wagerEl.value : 10));
    const spinBtn = document.getElementById('wheel-spin-btn');

    const showErr = msg => {
        if (resultEl) { resultEl.textContent = msg; resultEl.className = 'gambling-result result-lose'; }
    };
    if (wager < 5) return showErr('Minimum wager is 5 gold.');
    if (wager > 500) return showErr('Maximum wager is 500 gold.');
    if (gameState.player.gold < wager) return showErr('Not enough gold.');

    // Deduct wager and lock the seeded result immediately
    gameState.player.gold -= wager;
    const segIdx = spinWheel();
    const seg = WHEEL_SEGMENTS[segIdx];
    gameMeta.casinoWheelSpins = (gameMeta.casinoWheelSpins || 0) + 1;
    if (seg.mult >= 5) gameMeta.casinoWheelBigWins = (gameMeta.casinoWheelBigWins || 0) + 1;

    if (spinBtn) spinBtn.disabled = true;
    if (resultEl) { resultEl.textContent = 'Spinning…'; resultEl.className = 'gambling-result'; }
    _syncGamblingGold();

    _drawWheelSpin(segIdx, 5, () => {
        // Resolve
        const payout = Math.floor(wager * seg.mult);
        const won = payout > wager;
        const broke = payout === 0;
        gameState.player.gold += payout;

        let msg = '';
        if (broke)       msg = `${seg.label}! Lost everything — ${wager}g gone.`;
        else if (payout < wager) msg = `${seg.label}! Got back ${payout}g — lost ${wager - payout}g.`;
        else if (payout === wager) msg = `${seg.label}! Broke even — ${payout}g back.`;
        else             msg = `${seg.label}! Won ${payout}g!`;

        if (resultEl) {
            resultEl.textContent = msg;
            resultEl.className = 'gambling-result ' + (payout > wager ? 'result-win' : payout < wager ? 'result-lose' : '');
        }
        if (spinBtn) spinBtn.disabled = false;
        addMessage(`[Fortune Wheel] Landed on ${seg.label} — ${msg}`);
        saveMetaProgress();
        _syncGamblingGold();
        updateUI();
    });
}

function generateBounties() {
    const lvl = gameState.player ? gameState.player.level : 1;
    const hardBounties = isRenownUnlocked('harderBounties');
    // Shuffle the pool and take 3 unique templates
    const shuffled = [...QUEST_POOL].sort(() => rng() - 0.5).slice(0, 3);
    return shuffled.map(tpl => {
        const amount = tpl.getAmount(lvl);
        let reward = tpl.getReward(amount);
        // Renown 100: harder bounties pay 30% more gold — the board posts
        // serious work for proven delvers.
        if (hardBounties) reward = Math.floor(reward * 1.3);
        return {
            id:            tpl.id,
            type:          tpl.type,
            targetType:    tpl.targetType,
            targetAmount:  amount,
            currentAmount: 0,
            label:         tpl.makeLabel(amount),
            desc:          tpl.makeDesc(amount, reward),
            goldReward:    reward,
            completed:     false,
            failed:        false
        };
    });
}


// ── Three-Card Draw ──────────────────────────────────────────────────────────
// One of three cards wins (3×), one pushes (get wager back), one loses.
// Player can't see which is which — pure luck, good drama.

let _cardState = null; // {outcome: 'win'|'push'|'lose', revealed: bool[3], picked: number|null}

function resetCards() {
    const outcomes = ['win', 'push', 'lose'];
    // Fisher-Yates shuffle to assign outcomes to card positions
    for (let i = outcomes.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
    }
    _cardState = { outcomes, revealed: [false, false, false], picked: null };
    const resultEl = document.getElementById('cards-result');
    if (resultEl) { resultEl.textContent = ''; resultEl.className = 'gambling-result'; }
    const resetBtn = document.getElementById('cards-reset-btn');
    if (resetBtn) resetBtn.style.display = 'none';
    for (let i = 0; i < 3; i++) {
        const el = document.getElementById(`draw-card-${i}`);
        if (el) { el.textContent = '🂠'; el.className = 'draw-card'; el.onclick = () => playCards(i); }
    }
}

function playCards(idx) {
    if (!_cardState || _cardState.picked !== null) return;
    const p = gameState.player;
    if (!p) return;
    const wagerInput = document.getElementById('cards-wager-input');
    const wager = Math.max(5, Math.min(parseInt(wagerInput?.value || '10') || 10, p.gold, 500));
    if (wager > p.gold) { addMessage('Not enough gold.'); return; }

    _cardState.picked = idx;
    p.gold -= wager;
    trackGoldPickup(0); // trigger UI sync
    _syncGamblingGold();

    // Reveal all cards with a slight stagger via CSS classes
    const outcomes = _cardState.outcomes;
    const icons = { win: '♛', push: '⚖', lose: '☠' };
    const labels = { win: 'WIN', push: 'PUSH', lose: 'LOSE' };

    for (let i = 0; i < 3; i++) {
        const el = document.getElementById(`draw-card-${i}`);
        if (!el) continue;
        el.textContent = icons[outcomes[i]];
        el.onclick = null;
        el.className = `draw-card card-${outcomes[i]}${i === idx ? ' card-picked' : ''}`;
    }

    const outcome = outcomes[idx];
    const resultEl = document.getElementById('cards-result');
    let msg = '';
    if (outcome === 'win') {
        const prize = wager * 3;
        p.gold += prize;
        gameMeta.totalGold = (gameMeta.totalGold || 0) + prize;
        msg = `${labels[outcome]} — You earn ${prize}g!`;
        if (resultEl) { resultEl.textContent = msg; resultEl.className = 'gambling-result result-win'; }
    } else if (outcome === 'push') {
        p.gold += wager;
        msg = `${labels[outcome]} — Your ${wager}g is returned.`;
        if (resultEl) { resultEl.textContent = msg; resultEl.className = 'gambling-result result-push'; }
    } else {
        msg = `${labels[outcome]} — You lose ${wager}g.`;
        if (resultEl) { resultEl.textContent = msg; resultEl.className = 'gambling-result result-loss'; }
    }
    addMessage(`Three-Card Draw: ${msg}`);
    _syncGamblingGold();
    saveMetaProgress();

    const resetBtn = document.getElementById('cards-reset-btn');
    if (resetBtn) resetBtn.style.display = 'block';
}


// ── Dragon Slots ─────────────────────────────────────────────────────────────
// 3-reel slot machine. Paytable: Dragon×3=20×, Sword×3=8×, Star×3=5×,
// Coin×3=3×, Coin×2(any)=2×. Designed with a ~75% return-to-player so it
// bleeds slowly — fun to play but the house always wins long-term.

const SLOT_SYMBOLS = ['🪙','🪙','🪙','⚔️','⚔️','⭐','⭐','🐉'];
const SLOT_DISPLAY = { '🪙':'🪙', '⚔️':'⚔', '⭐':'⭐', '🐉':'🐉' };

function _resetSlots() {
    const resultEl = document.getElementById('slots-result');
    if (resultEl) { resultEl.textContent = ''; resultEl.className = 'gambling-result'; }
    for (let i = 0; i < 3; i++) {
        const el = document.getElementById(`slot-reel-${i}`);
        if (el) el.textContent = '—';
    }
}

function playSlots() {
    const p = gameState.player;
    if (!p || !gameState.gamblingOpen) return;
    const wagerInput = document.getElementById('slots-wager-input');
    const wager = Math.max(5, Math.min(parseInt(wagerInput?.value || '10') || 10, p.gold, 500));
    if (wager > p.gold) { addMessage('Not enough gold to bet that much.'); return; }

    const spinBtn = document.getElementById('slots-spin-btn');
    if (spinBtn) spinBtn.disabled = true;

    p.gold -= wager;
    _syncGamblingGold();

    // Pick 3 symbols
    const reels = [0,1,2].map(() => SLOT_SYMBOLS[Math.floor(rng() * SLOT_SYMBOLS.length)]);

    // Animate the reels spinning then reveal
    let frame = 0;
    const totalFrames = 18;
    const interval = setInterval(() => {
        frame++;
        for (let i = 0; i < 3; i++) {
            const el = document.getElementById(`slot-reel-${i}`);
            if (frame < totalFrames - i * 3) {
                // Still spinning — show random symbol
                const s = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
                if (el) el.textContent = s;
            } else {
                // Lock this reel
                if (el) { el.textContent = reels[i]; el.classList.add('slot-locked'); }
            }
        }
        if (frame >= totalFrames) {
            clearInterval(interval);
            _resolveSlots(reels, wager);
            if (spinBtn) spinBtn.disabled = false;
        }
    }, 80);
}

function _resolveSlots(reels, wager) {
    const p = gameState.player;
    const [a, b, c] = reels;
    const resultEl = document.getElementById('slots-result');

    let mult = 0;
    let label = '';

    if (a === b && b === c) {
        if (a === '🐉') { mult = 20; label = '🐉 DRAGON JACKPOT! 20×'; }
        else if (a === '⚔️') { mult = 8; label = '⚔ THREE SWORDS! 8×'; }
        else if (a === '⭐') { mult = 5; label = '⭐ THREE STARS! 5×'; }
        else if (a === '🪙') { mult = 3; label = '🪙 THREE COINS! 3×'; }
    } else if ((a === '🪙' && b === '🪙') || (a === '🪙' && c === '🪙') || (b === '🪙' && c === '🪙')) {
        mult = 2; label = '🪙🪙 Two Coins — 2×';
    }

    if (mult > 0) {
        const prize = Math.floor(wager * mult);
        p.gold += prize;
        gameMeta.totalGold = (gameMeta.totalGold || 0) + prize;
        if (resultEl) { resultEl.textContent = `${label} — +${prize}g!`; resultEl.className = 'gambling-result result-win'; }
        addMessage(`Dragon Slots: ${label} — you win ${prize}g!`);
        if (mult >= 8) { addCombatShake(15); triggerScreenFlash('kill'); }
    } else {
        if (resultEl) { resultEl.textContent = `No match — you lose ${wager}g.`; resultEl.className = 'gambling-result result-loss'; }
        addMessage(`Dragon Slots: No match. The reels mock you.`);
    }

    _syncGamblingGold();
    saveMetaProgress();
    for (let i = 0; i < 3; i++) {
        const el = document.getElementById(`slot-reel-${i}`);
        if (el) el.classList.remove('slot-locked');
    }
}


// ── Coin & Crown ─────────────────────────────────────────────────────────────
// Simplest game in the Flagon. 50/50 chance, 1.9× payout (house takes 10%).
// Fast loop — bet, flip, repeat.

function playCoinFlip(call) {
    const p = gameState.player;
    if (!p || !gameState.gamblingOpen) return;
    const wagerInput = document.getElementById('coin-wager-input');
    const wager = Math.max(5, Math.min(parseInt(wagerInput?.value || '10') || 10, p.gold, 500));
    if (wager > p.gold) { addMessage('Not enough gold.'); return; }

    p.gold -= wager;
    _syncGamblingGold();

    const result = rng() < 0.5 ? 'coin' : 'crown';
    const won = result === call;
    const coinEl = document.getElementById('coin-display');
    const resultEl = document.getElementById('coin-result');

    // Flip animation
    if (coinEl) {
        coinEl.classList.add('coin-flip-anim');
        setTimeout(() => { coinEl.classList.remove('coin-flip-anim'); }, 400);
    }

    setTimeout(() => {
        if (coinEl) coinEl.textContent = result === 'coin' ? '⊙' : '♛';

        if (won) {
            const prize = Math.floor(wager * 1.9);
            p.gold += prize;
            gameMeta.totalGold = (gameMeta.totalGold || 0) + prize;
            if (resultEl) { resultEl.textContent = `${result === 'coin' ? '⊙ Coin' : '♛ Crown'} — You win ${prize}g!`; resultEl.className = 'gambling-result result-win'; }
            addMessage(`Coin & Crown: ${result}! You win ${prize}g.`);
        } else {
            if (resultEl) { resultEl.textContent = `${result === 'coin' ? '⊙ Coin' : '♛ Crown'} — You lose ${wager}g.`; resultEl.className = 'gambling-result result-loss'; }
            addMessage(`Coin & Crown: ${result}. Not your call. You lose ${wager}g.`);
        }
        _syncGamblingGold();
        saveMetaProgress();
    }, 420);
}


function openNoticeBoard() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.gamblingOpen || gameState.brewmasterOpen || gameState.cellarFindOpen) return;
    gameState.questBoardOpen = true;
    if (!gameState.generatedBounties.length) {
        gameState.generatedBounties = generateBounties();
    }
    renderNoticeBoardPanel();
    document.getElementById('notice-board-panel').style.display = 'flex';
    updateUI();
}


function closeNoticeBoard() {
    gameState.questBoardOpen = false;
    document.getElementById('notice-board-panel').style.display = 'none';
    updateUI();
}


function renderNoticeBoardPanel() {
    const listEl = document.getElementById('bounty-list');
    if (!listEl) return;
    const hasActive = !!gameState.activeQuest;

    listEl.innerHTML = gameState.generatedBounties.map(q => {
        const isActive = hasActive && gameState.activeQuest.id === q.id;
        const accepted = hasActive && !isActive;
        const btnText  = isActive ? 'Active' : accepted ? 'Taken' : `Accept (+${q.goldReward}g)`;
        const disabled = hasActive;
        return `<div class="bounty-row${isActive ? ' bounty-active' : ''}">
            <div class="bounty-info">
                <div class="bounty-label">${escHtml(q.label)}</div>
                <div class="bounty-desc">${escHtml(q.desc)}</div>
            </div>
            <button class="bounty-btn${isActive ? ' bounty-btn-active' : ''}"
                onclick="acceptQuest('${q.id}')"
                ${disabled ? 'disabled' : ''}>${btnText}</button>
        </div>`;
    }).join('');
}


function acceptQuest(id) {
    if (gameState.activeQuest) return;
    const q = gameState.generatedBounties.find(b => b.id === id);
    if (!q) return;
    gameState.activeQuest = q;
    addMessage(`Bounty accepted: "${q.label}". ${q.desc}`);
    renderNoticeBoardPanel();
    updateUI();
}


function completeQuest() {
    const q = gameState.activeQuest;
    if (!q || q.completed) return;
    q.completed = true;
    gameState.player.gold += q.goldReward;
    addFloatingText(gameState.player.x, gameState.player.y, `+${q.goldReward}g`, '#ffd65a');
    addMessage(`Bounty Complete: "${q.label}" — awarded ${q.goldReward}g!`);
    // Reset so a new board can be generated on the next visit
    gameState.activeQuest = null;
    gameState.generatedBounties = [];
    updateUI();
}


// ── Brewmaster ────────────────────────────────────────────────────────────────

function openBrewmaster() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.gamblingOpen || gameState.cellarFindOpen) return;
    gameState.brewmasterOpen = true;
    renderBrewmasterPanel();
    document.getElementById('brewmaster-panel').style.display = 'flex';
    updateUI();
}


function closeBrewmaster() {
    gameState.brewmasterOpen = false;
    document.getElementById('brewmaster-panel').style.display = 'none';
    updateUI();
}


function renderBrewmasterPanel() {
    const p = gameState.player;
    const goldEl = document.getElementById('brewmaster-gold');
    if (goldEl) goldEl.textContent = `Gold: ${p.gold}g`;

    const listEl = document.getElementById('brew-list');
    if (!listEl) return;

    listEl.innerHTML = BREW_MENU.map(brew => {
        const canAfford = p.gold >= brew.cost;
        const isActive = gameState.activeBrew && gameState.activeBrew.id === brew.id;
        const otherActive = gameState.activeBrew && !isActive;
        const disabled = !canAfford || isActive || otherActive;
        let btnLabel = `${brew.cost}g`;
        if (isActive) btnLabel = `Active (${gameState.activeBrew.duration}fl)`;
        else if (otherActive) btnLabel = 'Buff active';
        return `<div class="brew-row${!canAfford && !isActive ? ' brew-cant-afford' : ''}${isActive ? ' brew-active-row' : ''}">
            <span class="brew-icon">${brew.icon}</span>
            <div class="brew-info">
                <div class="brew-name">${brew.name}</div>
                <div class="brew-desc">${brew.desc}</div>
            </div>
            <button class="brew-buy-btn" onclick="buyBrew('${brew.id}')" ${disabled ? 'disabled' : ''}>${btnLabel}</button>
        </div>`;
    }).join('');
}


function buyBrew(id) {
    const p = gameState.player;
    if (!p || gameState.activeBrew) {
        addMessage('You already have an active brew. Wait for it to wear off.');
        return;
    }
    const def = BREW_MENU.find(b => b.id === id);
    if (!def) return;
    if (p.gold < def.cost) { addMessage("You can't afford that."); return; }

    p.gold -= def.cost;
    gameState.activeBrew = { id: def.id, name: def.name, icon: def.icon, duration: def.duration };
    def.apply(p);
    recalculateStats();
    addMessage(`You drink ${def.name}. ${def.desc}`);
    renderBrewmasterPanel();
    updateUI();
}


function isAdjacentToBrewmaster() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.brewmaster.x, gameState.brewmaster.y) <= 1;
}


// ── Bard's Corner ─────────────────────────────────────────────────────────────

function openBard() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.gamblingOpen
        || gameState.brewmasterOpen || gameState.questBoardOpen || gameState.stashOpen || gameState.cellarFindOpen) return;
    gameState.bardOpen = true;
    renderBardPanel();
    document.getElementById('bard-panel').style.display = 'flex';
    updateUI();
}


function closeBard() {
    gameState.bardOpen = false;
    document.getElementById('bard-panel').style.display = 'none';
    updateUI();
}


function renderBardPanel() {
    const p = gameState.player;
    const goldEl = document.getElementById('bard-gold');
    if (goldEl) goldEl.textContent = `Gold: ${p.gold}g`;
    const listEl = document.getElementById('bard-song-list');
    if (!listEl) return;
    listEl.innerHTML = SONG_TRACKS.map(track => {
        const isPlaying = gameState.activeSong && gameState.activeSong.id === track.id;
        const canAfford = p.gold >= track.cost;
        return `<div class="bard-row${isPlaying ? ' bard-row-active' : ''}${!canAfford && !isPlaying ? ' bard-cant-afford' : ''}">
            <div class="bard-info">
                <div class="bard-title">${escHtml(track.title)}</div>
                <div class="bard-mood">${escHtml(track.mood)}</div>
                <div class="bard-effect">${escHtml(track.desc)}</div>
            </div>
            <button class="bard-btn${isPlaying ? ' bard-btn-active' : ''}"
                onclick="playSong('${track.id}')"
                ${isPlaying || !canAfford ? 'disabled' : ''}
            >${isPlaying ? '&#9834; Playing' : track.cost + 'g'}</button>
        </div>`;
    }).join('');
}


function playSong(id) {
    const p = gameState.player;
    if (!p) return;
    const track = SONG_TRACKS.find(t => t.id === id);
    if (!track) return;
    if (p.gold < track.cost) { addMessage("You can't afford that song."); updateUI(); return; }
    p.gold -= track.cost;
    gameState.activeSong = { id: track.id, title: track.title, effect: track.effect };
    _startBardLoop(track);
    addMessage(`The bard begins "${track.title}"...`);
    addMessage(track.lore);
    if (track.effect.type === 'scout') {
        const hints = [
            'an Iron Sentinel — armored, shifting through phases',
            'a Void Wraith — it teleports and poisons on touch',
            'a Necromancer — it raises the fallen at its feet'
        ];
        addMessage(`The bard whispers: "They speak of ${hints[Math.floor(Math.random() * hints.length)]}..."`);
    }
    recalculateStats();
    renderBardPanel();
    updateUI();
}


function isAdjacentToBard() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.bard.x, gameState.bard.y) <= 1;
}


function openStash() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.gamblingOpen
        || gameState.brewmasterOpen || gameState.questBoardOpen || gameState.bardOpen || gameState.cellarFindOpen) return;
    if (gameState.ironmanMode) {
        addMessage('The chest is sealed shut — Ironman oath-takers carry their own risk, with no chest to fall back on.');
        updateUI();
        return;
    }
    gameState.stashOpen = true;
    renderStashPanel();
    document.getElementById('stash-panel').style.display = 'flex';
    updateUI();
}


function closeStash() {
    gameState.stashOpen = false;
    document.getElementById('stash-panel').style.display = 'none';
    updateUI();
}


function renderStashPanel() {
    const p = gameState.player;

    // Left: stash contents with Take buttons
    const stashEl = document.getElementById('stash-items');
    if (stashEl) {
        if (gameSharedStash.length === 0) {
            stashEl.innerHTML = '<p class="stash-empty">The chest is empty.</p>';
        } else {
            stashEl.innerHTML = gameSharedStash.map((item, i) => {
                const displayName = (item.cursed && !item.identified) ? '?? Item' : escHtml(item.name);
                const rarity = item.rarity ? `<span class="stash-rarity stash-rarity-${item.rarity}">${capitalize(item.rarity)}</span>` : '';
                return `<div class="stash-row">
                    <div class="stash-item-info">
                        <span class="stash-item-name">${displayName}</span>${rarity}
                        <span class="stash-item-slot">${capitalize(item.slot || '')}</span>
                    </div>
                    <button class="stash-action-btn" onclick="withdrawFromStash(${i})">Take</button>
                </div>`;
            }).join('');
        }
        const slotsEl = document.getElementById('stash-slots');
        if (slotsEl) slotsEl.textContent = `${gameSharedStash.length}/${STASH_MAX}`;
    }

    // Right: player inventory with Deposit buttons (equipment only)
    const invEl = document.getElementById('stash-inv');
    if (invEl) {
        const equipment = p.inventory.filter(item => item.slot);
        if (equipment.length === 0) {
            invEl.innerHTML = '<p class="stash-empty">No equipment to deposit.</p>';
        } else {
            invEl.innerHTML = equipment.map(item => {
                const idx = p.inventory.indexOf(item);
                const displayName = (item.cursed && !item.identified) ? '?? Item' : escHtml(item.name);
                const full = gameSharedStash.length >= STASH_MAX;
                return `<div class="stash-row">
                    <div class="stash-item-info">
                        <span class="stash-item-name">${displayName}</span>
                        <span class="stash-item-slot">${capitalize(item.slot || '')}</span>
                    </div>
                    <button class="stash-action-btn" onclick="depositToStash(${idx})" ${full ? 'disabled' : ''}>Deposit</button>
                </div>`;
            }).join('');
        }
    }
}


function depositToStash(inventoryIndex) {
    const p = gameState.player;
    const item = p.inventory[inventoryIndex];
    if (!item || !item.slot) return;
    if (gameSharedStash.length >= STASH_MAX) {
        addMessage('The stash is full (3 item limit).');
        updateUI();
        return;
    }
    p.inventory.splice(inventoryIndex, 1);
    gameSharedStash.push(item);
    saveStash();
    addMessage(`Deposited ${item.name} into the stash.`);
    recalculateStats();
    renderStashPanel();
    updateUI();
}


function withdrawFromStash(stashIndex) {
    const item = gameSharedStash[stashIndex];
    if (!item) return;
    gameSharedStash.splice(stashIndex, 1);
    gameState.player.inventory.push(item);
    saveStash();
    addMessage(`Took ${item.name} from the stash.`);
    recalculateStats();
    renderStashPanel();
    updateUI();
}


function isAdjacentToStash() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.stashChest.x, gameState.stashChest.y) <= 1;
}


function isAdjacentToCellar() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.cellar.x, gameState.cellar.y) <= 1;
}


function isAdjacentToArenaGate() {
    return getDistance(gameState.player.x, gameState.player.y, gameState.arenaGate.x, gameState.arenaGate.y) <= 1;
}


// Centralized unlock condition for the Pit. Two paths in:
//   • The Gladiator subclass is born of the arena — its whole identity is
//     "the crowd demands blood." It can enter the Pit from level 1, with no
//     floor requirement. This is one of the class's defining advantages.
//   • Every other class must prove itself by surviving to Floor 20 of the
//     Ash Dungeon. gameState.bestFloor persists across every run/character
//     (see saveBestFloor in save.js), so that's account-wide progress.
// All Pit features (gate, panel, capture nets, fame HUD, crowd) gate on
// this single function, so both paths stay consistent everywhere.
function isPitUnlocked() {
    if (gameState.player?.subclass === 'gladiator') return true;
    return gameState.bestFloor >= 20;
}

// Phase 6 backward-compat alias — remove when all callers (render.js, main.js,
// ui.js, tests.html) are updated to call isPitUnlocked() directly.
const isArenaUnlocked = isPitUnlocked;


function generateMagicStock() {
    const relicSlot = rng() < 0.5 ? 'weapon' : 'chest';
    const relicBonus = 4 + Math.floor(rng() * 3);          // 4–6
    const relicCursed = rng() < 0.75;
    const relicNames = relicSlot === 'weapon' ? MAGIC_RELIC_WEAPONS : MAGIC_RELIC_ARMORS;
    const relicTrueName = 'Epic ' + relicNames[Math.floor(rng() * relicNames.length)];
    const relic = {
        type: 'equipment', slot: relicSlot, rarity: 'epic',
        name: '?? Relic', identified: false, cursed: relicCursed,
        bonus: relicCursed ? Math.ceil(relicBonus * 1.6) : relicBonus,
        color: relicSlot === 'weapon' ? '#78bfff' : '#d08aff',
        glyph: relicSlot === 'weapon' ? '/' : ']',
        trueName: relicTrueName,
        cost: 120,
    };
    if (relicCursed) { relic.trueBonus = relic.bonus; }

    // 2 exotic accessories — guaranteed positive effects, never cursed
    const positiveEffects = ['lifesteal', 'critChance', 'manaRegen'];
    const shuffled = [...positiveEffects].sort(() => rng() - 0.5);
    const accessories = shuffled.slice(0, 2).map(effectId => {
        const effect = ACCESSORY_EFFECTS[effectId];
        const rarityName = rng() < 0.5 ? 'rare' : 'epic';
        const rarityObj = RARITIES.find(r => r.name === rarityName) || RARITIES[2];
        const bonus = effect.scale * rarityObj.bonus;
        const itemName = effect.names[Math.floor(rng() * effect.names.length)];
        const jewelrySlot = effectId === 'manaRegen' ? 'amulet' : 'ring';
        return {
            type: 'equipment', slot: jewelrySlot, effectId,
            rarity: rarityName,
            name: `${capitalize(rarityName)} ${effect.label} ${itemName}`,
            identified: true, cursed: false,
            bonus, unit: effect.unit, desc: effect.desc,
            color: '#5ad1c2', glyph: SLOT_GLYPHS[jewelrySlot],
            cost: rarityName === 'epic' ? 95 : 70,
        };
    });

    gameState.magicStock = [relic, ...accessories, generateDealerRelic()];
}


// The dealer's relic is a guaranteed, known pick — priced at a markup over
// the relic's own base cost since dungeon drops are random but this one
// is a sure thing.
function generateDealerRelic() {
    const ids = Object.keys(RELIC_DEFS);
    const relicId = ids[Math.floor(rng() * ids.length)];
    const def = RELIC_DEFS[relicId];
    return {
        type: 'relic', relicId,
        cost: Math.round(def.cost * 1.4)
    };
}


function openMagicDealer() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.gamblingOpen
        || gameState.brewmasterOpen || gameState.questBoardOpen || gameState.bardOpen
        || gameState.stashOpen || gameState.cellarFindOpen) return;
    if (!gameState.magicStock.length) generateMagicStock();
    gameState.magicDealerOpen = true;
    renderMagicDealerPanel('artifacts');
    document.getElementById('magic-dealer-panel').style.display = 'flex';
    updateUI();
}


function closeMagicDealer() {
    gameState.magicDealerOpen = false;
    document.getElementById('magic-dealer-panel').style.display = 'none';
    updateUI();
}


function openCellar() {
    if (gameState.floor !== 0 || !gameState.player) return;
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.gamblingOpen
        || gameState.brewmasterOpen || gameState.questBoardOpen || gameState.bardOpen
        || gameState.stashOpen || gameState.magicDealerOpen) return;
    gameState.cellarFindOpen = true;
    renderCellarPanel();
    document.getElementById('cellar-panel').style.display = 'flex';
    updateUI();
}


function closeCellar() {
    gameState.cellarFindOpen = false;
    document.getElementById('cellar-panel').style.display = 'none';
    updateUI();
}


function renderCellarPanel() {
    const body = document.getElementById('cellar-body');
    if (!body) return;

    if (gameState.cellarClaimed) {
        body.innerHTML = `
            <p class="cellar-flavor">The cellar is bare — whatever was hidden down here, you already found it this run.</p>
        `;
        return;
    }
    if (!gameState.cellarHasFind) {
        body.innerHTML = `
            <p class="cellar-flavor">Dust, empty crates, and the smell of old ale. Nothing here this time.</p>
        `;
        return;
    }

    body.innerHTML = `
        <p class="cellar-flavor">Something is hidden beneath the floorboards. Choose what to take — the rest crumbles to dust the moment you touch it.</p>
        <div id="cellar-choices"></div>
    `;
    const list = document.getElementById('cellar-choices');
    CELLAR_FIND_CHOICES.forEach(choice => {
        const button = document.createElement('button');
        button.className = 'cellar-choice-btn';
        button.innerHTML = `
            <span class="cellar-choice-icon">${choice.icon}</span>
            <span class="cellar-choice-info">
                <span class="cellar-choice-label">${escHtml(choice.label)}</span>
                <span class="cellar-choice-desc">${escHtml(choice.desc)}</span>
            </span>
        `;
        button.addEventListener('click', () => claimCellarFind(choice.id));
        list.appendChild(button);
    });
}


function claimCellarFind(choiceId) {
    if (gameState.cellarClaimed || !gameState.cellarHasFind) return;
    const choice = CELLAR_FIND_CHOICES.find(c => c.id === choiceId);
    if (!choice) return;
    choice.apply(gameState.player);
    gameState.cellarClaimed = true;
    addBurst(gameState.cellar.x, gameState.cellar.y, '#d4b97a');
    addFloatingText(gameState.player.x, gameState.player.y, choice.label, '#d4b97a', { style: 'crit-banner' });
    addMessage(`The cellar yields its secret: ${choice.label}.`);
    showEventCard('CELLAR FIND', choice.label, 'boss');
    renderCellarPanel();
    updateUI();
}


function showMagicTab(tab) {
    document.getElementById('magic-tab-artifacts').style.display = tab === 'artifacts' ? 'block' : 'none';
    document.getElementById('magic-tab-altar').style.display    = tab === 'altar'     ? 'block' : 'none';
    document.getElementById('magic-tab-btn-artifacts').classList.toggle('magic-tab-active', tab === 'artifacts');
    document.getElementById('magic-tab-btn-altar').classList.toggle('magic-tab-active', tab === 'altar');
    // Re-render the active tab content
    if (tab === 'artifacts') _renderArtifactsTab();
    else                     _renderAltarTab();
}


function renderMagicDealerPanel(activeTab = null) {
    const p = gameState.player;
    const goldEl = document.getElementById('magic-dealer-gold');
    if (goldEl) goldEl.textContent = `Gold: ${p.gold}g`;

    // Determine which tab is currently showing
    const altarEl = document.getElementById('magic-tab-altar');
    const currentTab = (altarEl && altarEl.style.display !== 'none') ? 'altar' : 'artifacts';
    const tab = activeTab || currentTab;
    showMagicTab(tab);
}


function _renderArtifactsTab() {
    const p = gameState.player;
    const listEl = document.getElementById('magic-stock-list');
    if (!listEl) return;
    if (!gameState.magicStock.length) {
        listEl.innerHTML = '<p class="magic-empty">The Dealer\'s shelves are bare.</p>';
        return;
    }
    listEl.innerHTML = gameState.magicStock.map((item, i) => {
        const canAfford = p.gold >= item.cost;
        if (item.type === 'relic') {
            const def = RELIC_DEFS[item.relicId];
            return `<div class="magic-item-row magic-relic-row${!canAfford ? ' magic-cant-afford' : ''}">
                <div class="magic-item-info">
                    <div class="magic-item-name">
                        <span class="magic-rarity-${def.rarity}">${escHtml(def.name)}</span>
                        <span class="magic-item-slot">Relic</span>
                    </div>
                    <span class="magic-item-desc">${escHtml(def.desc)}</span>
                </div>
                <button class="magic-buy-btn" onclick="buyMagicItem(${i})" ${!canAfford ? 'disabled' : ''}>
                    ${item.cost}g
                </button>
            </div>`;
        }
        let descLine = '';
        if (!item.identified) {
            descLine = '<span class="magic-item-mystery">Unidentified — could be cursed</span>';
        } else if (JEWELRY_SLOTS.includes(item.slot)) {
            descLine = `<span class="magic-item-desc">${escHtml(item.desc)} (+${item.bonus}${item.unit || ''})</span>`;
        } else {
            descLine = `<span class="magic-item-desc">+${item.bonus} ${item.slot === 'weapon' ? 'ATK' : 'DEF'}</span>`;
        }
        const rarityClass = `magic-rarity-${item.rarity}`;
        return `<div class="magic-item-row${!canAfford ? ' magic-cant-afford' : ''}">
            <div class="magic-item-info">
                <div class="magic-item-name">
                    <span class="${rarityClass}">${escHtml(item.name)}</span>
                    <span class="magic-item-slot">${capitalize(item.slot)}</span>
                </div>
                ${descLine}
            </div>
            <button class="magic-buy-btn" onclick="buyMagicItem(${i})" ${!canAfford ? 'disabled' : ''}>
                ${item.cost}g
            </button>
        </div>`;
    }).join('');
}


function _renderAltarTab() {
    const p = gameState.player;
    const listEl = document.getElementById('magic-altar-list');
    if (!listEl) return;

    const equipmentItems = p.inventory
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => item.slot);

    if (!equipmentItems.length) {
        listEl.innerHTML = '<p class="magic-empty">No equipment in your inventory to work with.</p>';
        return;
    }

    listEl.innerHTML = equipmentItems.map(({ item, i }) => {
        const displayName = (item.cursed && !item.identified) ? '?? Item' : escHtml(item.name);
        const isCursed = item.cursed;
        const purifyCost = 75;
        const canPurify = isCursed && p.gold >= purifyCost;
        const enchCost = _enchantCost(item);
        const canEnchant = p.gold >= enchCost;
        const isMaxed = item.bonus >= 7;
        const isRisky = item.bonus >= 5;

        let enchLabel = isMaxed ? 'Max' : `Enchant +1 (${enchCost}g)`;
        if (isRisky && !isMaxed) enchLabel += ' ⚠';

        const rarityClass = item.rarity ? `magic-rarity-${item.rarity}` : '';
        const bonusText = JEWELRY_SLOTS.includes(item.slot)
            ? `+${item.bonus}${item.unit || ''}`
            : `+${item.bonus} ${item.slot === 'weapon' ? 'ATK' : 'DEF'}`;

        return `<div class="magic-altar-row">
            <div class="magic-item-info">
                <div class="magic-item-name">
                    <span class="${rarityClass}">${displayName}</span>
                    <span class="magic-item-slot">${capitalize(item.slot)} · ${bonusText}</span>
                </div>
                ${isCursed ? '<span class="magic-cursed-tag">Cursed</span>' : ''}
            </div>
            <div class="magic-altar-btns">
                ${isCursed
                    ? `<button class="magic-purify-btn" onclick="purifyItem(${i})" ${!canPurify ? 'disabled' : ''}>Purify (${purifyCost}g)</button>`
                    : ''}
                <button class="magic-enchant-btn" onclick="enchantItem(${i})" ${!canEnchant || isMaxed ? 'disabled' : ''}>${enchLabel}</button>
            </div>
        </div>`;
    }).join('');
}


function _enchantCost(item) {
    if (JEWELRY_SLOTS.includes(item.slot)) return 60 + item.bonus * 10;
    return (item.bonus + 1) * 25;
}


function buyMagicItem(stockIndex) {
    const p = gameState.player;
    const item = gameState.magicStock[stockIndex];
    if (!item) return;
    if (p.gold < item.cost) { addMessage("You can't afford that."); updateUI(); return; }
    p.gold -= item.cost;
    gameState.magicStock.splice(stockIndex, 1);
    if (item.type === 'relic') {
        addRelicToPouch(item.relicId);
        sfxItemPickup();
        const def = RELIC_DEFS[item.relicId];
        addMessage(`\u{1F52E} The Dealer hands over ${def ? def.name : 'a relic'}, guaranteed genuine.`);
        renderMagicDealerPanel();
        updateUI();
        return;
    }
    // Strip the shop-only `cost` field before adding to inventory
    const { cost: _cost, ...invItem } = item;
    addItemToInventory(invItem);
    sfxItemPickup();
    if (!invItem.identified) {
        addMessage('\u{1F52E} The Dealer slides the relic across the counter. "What it does… is your discovery."');
    } else {
        const label = JEWELRY_SLOTS.includes(invItem.slot)
            ? `${invItem.name} (+${invItem.bonus}${invItem.unit || ''})`
            : `${invItem.name} (${getGearStatLabel(invItem)})`;
        addMessage(`\u{1F52E} You purchase ${label}.`);
    }
    renderMagicDealerPanel();
    updateUI();
}


function purifyItem(inventoryIndex) {
    const p = gameState.player;
    const item = p.inventory[inventoryIndex];
    if (!item || !item.cursed) { addMessage("That item isn't cursed."); updateUI(); return; }
    const cost = 75;
    if (p.gold < cost) { addMessage(`Purification costs ${cost}g — you don't have enough.`); updateUI(); return; }
    p.gold -= cost;
    item.cursed = false;
    item.identified = true;
    if (item.trueName) item.name = item.trueName;
    sfxPotion();
    addMessage(`✨ The curse shatters — ${escHtml(item.name)} shines clean.`);
    recalculateStats();
    renderMagicDealerPanel();
    updateUI();
}


function enchantItem(inventoryIndex) {
    const p = gameState.player;
    const item = p.inventory[inventoryIndex];
    if (!item || !item.slot) return;
    if (item.bonus >= 7) { addMessage("That item cannot be enchanted further."); updateUI(); return; }
    const cost = _enchantCost(item);
    if (p.gold < cost) { addMessage(`Enchanting costs ${cost}g — you need more gold.`); updateUI(); return; }
    p.gold -= cost;

    if (item.bonus >= 5 && rng() < 0.45) {
        // Break
        p.inventory.splice(inventoryIndex, 1);
        sfxDeath();
        addMessage(`⚡ The enchantment overloads — ${escHtml(item.name)} shatters into dust!`);
        addMessage('"Happens more than you\'d think," the Dealer shrugs.');
        recalculateStats();
        renderMagicDealerPanel();
        updateUI();
        return;
    }

    item.bonus++;
    if (item.trueBonus !== undefined) item.trueBonus = item.bonus;
    sfxLevelUp();
    const bonusLabel = JEWELRY_SLOTS.includes(item.slot)
        ? `+${item.bonus}${item.unit || ''}`
        : getGearStatLabel(item);
    addMessage(`\u{1F52E} The Dealer cackles as ${escHtml(item.name)} absorbs a raw magical aura! (${bonusLabel})`);
    recalculateStats();
    renderMagicDealerPanel();
    updateUI();
}


function isAdjacentToMagicDealer() {
    return getDistance(gameState.player.x, gameState.player.y,
        gameState.magicDealer.x, gameState.magicDealer.y) <= 1;
}


// ══════════════════════════════════════════════════════════════════════════════
// TOWN SERVICES
// Four NPCs in the Town map, each offering something the tavern doesn't.
// ══════════════════════════════════════════════════════════════════════════════

// ── General Store ─────────────────────────────────────────────────────────────
// Bulk consumables at better prices than dungeon shops. The town is farther
// away, so it rewards the trip with quantity + variety the merchant doesn't stock.
function openTownStore() {
    if (gameState.townStoreOpen) return;
    gameState.townStoreOpen = true;

    const p = gameState.player;
    const f = gameState.floor; // always 0 here but used for pricing consistency

    const items = [
        { id: 'potion',     label: 'Health Potion',    desc: 'Restore HP (35 + level×5)',  icon: '+', cost: 14,  qty: 1 },
        { id: 'antidote',   label: 'Antidote',          desc: 'Cure poison and burn',        icon: 'A', cost: 18,  qty: 1 },
        { id: 'smokeBomb',  label: 'Smoke Bomb',        desc: 'Stun all enemies 1 turn',     icon: 'S', cost: 22,  qty: 1 },
        { id: 'rageDraught',label: 'Rage Draught',      desc: '+50% ATK for 3 turns',        icon: 'R', cost: 28,  qty: 1 },
        { id: 'potion',     label: 'Potion Bundle ×3',  desc: '3 Health Potions, bulk deal', icon: '+', cost: 36,  qty: 3 },
        { id: 'identifyScroll', label: 'Identify Scroll', desc: 'Reveal cursed items',      icon: '?', cost: 24,  qty: 1 },
    ];

    const rows = items.map(it => `
        <div class="town-shop-row" onclick="townStoreBuy('${it.id}',${it.cost},${it.qty})">
            <span class="town-shop-icon">${it.icon}</span>
            <span class="town-shop-info">
                <span class="town-shop-name">${it.label}</span>
                <span class="town-shop-desc">${it.desc}</span>
            </span>
            <span class="town-shop-cost">${it.cost}g</span>
        </div>`).join('');

    showTownPanel('general-store', '🛒 General Store',
        `<p class="town-intro">"Best prices in the region," the storekeeper says. "Don't tell the merchant."</p>
         <div class="town-shop-list">${rows}</div>`,
        () => { gameState.townStoreOpen = false; }
    );
}

function townStoreBuy(type, cost, qty) {
    const p = gameState.player;
    if (!p || p.gold < cost) { addMessage('Not enough gold.'); updateUI(); return; }
    p.gold -= cost;
    for (let i = 0; i < qty; i++) {
        addItemToInventory({ type, name: type === 'potion' ? 'Health Potion'
            : type === 'antidote' ? 'Antidote'
            : type === 'smokeBomb' ? 'Smoke Bomb'
            : type === 'rageDraught' ? 'Rage Draught'
            : type === 'identifyScroll' ? 'Identify Scroll' : type, qty: 1 });
    }
    addMessage(`Bought ${qty > 1 ? qty + '× ' : ''}item for ${cost}g.`);
    sfxItemPickup();
    updateUI();
    closeTownPanel('general-store');
    openTownStore();
}

// ── Temple ────────────────────────────────────────────────────────────────────
// Healing and blessings unavailable at the tavern: full status cure, a permanent
// max-HP upgrade (once per visit), and a combat blessing for the next run.
function openTownTemple() {
    if (gameState.townTempleOpen) return;
    gameState.townTempleOpen = true;

    const p = gameState.player;
    const healCost = 40;
    const curseCost = 55;
    const blessCost = 80;

    showTownPanel('temple', '✚ Temple of Ash',
        `<p class="town-intro">"The ash does not forget its martyrs," the priest says. "But perhaps we can ease the burden."</p>
         <div class="town-shop-list">
             <div class="town-shop-row" onclick="townTempleAct('heal',${healCost})">
                 <span class="town-shop-icon">♥</span>
                 <span class="town-shop-info">
                     <span class="town-shop-name">Full Restoration</span>
                     <span class="town-shop-desc">Restore HP and mana to full, cure all status effects</span>
                 </span>
                 <span class="town-shop-cost">${healCost}g</span>
             </div>
             <div class="town-shop-row" onclick="townTempleAct('curse',${curseCost})">
                 <span class="town-shop-icon">✧</span>
                 <span class="town-shop-info">
                     <span class="town-shop-name">Uncurse Equipment</span>
                     <span class="town-shop-desc">Identify and remove all curse from your gear</span>
                 </span>
                 <span class="town-shop-cost">${curseCost}g</span>
             </div>
             <div class="town-shop-row" onclick="townTempleAct('bless',${blessCost})">
                 <span class="town-shop-icon">☀</span>
                 <span class="town-shop-info">
                     <span class="town-shop-name">Blessing of Endurance</span>
                     <span class="town-shop-desc">+15 permanent Max HP</span>
                 </span>
                 <span class="town-shop-cost">${blessCost}g</span>
             </div>
         </div>`,
        () => { gameState.townTempleOpen = false; }
    );
}

function townTempleAct(action, cost) {
    const p = gameState.player;
    if (!p || p.gold < cost) { addMessage('Not enough gold.'); updateUI(); return; }
    p.gold -= cost;
    if (action === 'heal') {
        p.hp = p.maxHp;
        if (p.mana !== undefined) p.mana = p.maxMana;
        p.statuses = [];
        addFloatingText(p.x, p.y, 'Restored!', '#58c26d');
        addMessage('The priest\'s hands glow. Your wounds close, your mind clears.');
    } else if (action === 'curse') {
        let uncursed = 0;
        Object.values(p.equipment).forEach(item => {
            if (item && item.cursed) {
                item.cursed = false;
                item.identified = true;
                item.name = item.trueName || item.name;
                item.bonus = item.trueBonus || item.bonus;
                uncursed++;
            }
        });
        recalculateStats();
        addMessage(uncursed > 0 ? `The priest lifts ${uncursed} curse${uncursed>1?'s':''}. Your gear feels lighter.` : 'The priest finds no curses to lift.');
    } else if (action === 'bless') {
        p.maxHp += 15;
        p.hp = Math.min(p.hp + 15, p.maxHp);
        addFloatingText(p.x, p.y, '+15 Max HP', '#fff3b0');
        addMessage('The priest presses a rune to your chest. You feel sturdier (+15 Max HP).');
    }
    sfxPotion();
    updateUI();
    closeTownPanel('temple');
    openTownTemple();
}

// ── Alchemist ─────────────────────────────────────────────────────────────────
// Converts consumables into upgraded versions and sells rare brews not in the tavern.
function openTownAlchemist() {
    if (gameState.townAlchemistOpen) return;
    gameState.townAlchemistOpen = true;

    const p = gameState.player;
    const potCount = (p?.inventory || []).filter(i => i.type === 'potion' && i.qty > 0).reduce((n,i) => n+(i.qty||1), 0);

    showTownPanel('alchemist', '⚗ The Alchemist',
        `<p class="town-intro">"Combine, refine, transcend," she mutters, not looking up from her bubbling flasks. "Gold helps too."</p>
         <div class="town-shop-list">
             <div class="town-shop-row" onclick="townAlchemistAct('upgrade')">
                 <span class="town-shop-icon">↑</span>
                 <span class="town-shop-info">
                     <span class="town-shop-name">Upgrade Potions</span>
                     <span class="town-shop-desc">Combine 3 Health Potions into 1 Greater Potion (heals 70% HP). You have ${potCount}.</span>
                 </span>
                 <span class="town-shop-cost">3 pots</span>
             </div>
             <div class="town-shop-row" onclick="townAlchemistAct('elixir')">
                 <span class="town-shop-icon">★</span>
                 <span class="town-shop-info">
                     <span class="town-shop-name">Elixir of Might</span>
                     <span class="town-shop-desc">+3 permanent Attack. Rare alchemical formula.</span>
                 </span>
                 <span class="town-shop-cost">90g</span>
             </div>
             <div class="town-shop-row" onclick="townAlchemistAct('resist')">
                 <span class="town-shop-icon">⛨</span>
                 <span class="town-shop-info">
                     <span class="town-shop-name">Resistance Tonic</span>
                     <span class="town-shop-desc">Immunity to poison and burn for the next 5 dungeon floors.</span>
                 </span>
                 <span class="town-shop-cost">65g</span>
             </div>
         </div>`,
        () => { gameState.townAlchemistOpen = false; }
    );
}

function townAlchemistAct(action) {
    const p = gameState.player;
    if (!p) return;
    if (action === 'upgrade') {
        const inv = p.inventory || [];
        let removed = 0;
        for (const item of inv) {
            if (item.type === 'potion' && item.qty > 0 && removed < 3) {
                const take = Math.min(item.qty, 3 - removed);
                item.qty -= take; removed += take;
            }
        }
        p.inventory = p.inventory.filter(i => i.qty > 0);
        if (removed < 3) { p.gold += 0; addMessage('Need 3 Health Potions to upgrade.'); updateUI(); return; }
        addItemToInventory({ type: 'greaterPotion', name: 'Greater Potion', qty: 1, healPct: 0.7, color: '#ff6a9a', glyph: '+' });
        addMessage('Three potions bubble together into a Greater Potion (heals 70% HP).');
        sfxPotion();
    } else if (action === 'elixir') {
        if (p.gold < 90) { addMessage('Need 90 gold.'); updateUI(); return; }
        p.gold -= 90;
        p.baseAtk += 3;
        recalculateStats();
        addFloatingText(p.x, p.y, '+3 ATK', '#ff9f58');
        addMessage('You drink the Elixir of Might. Your strikes feel keener (+3 ATK).');
        sfxPotion();
    } else if (action === 'resist') {
        if (p.gold < 65) { addMessage('Need 65 gold.'); updateUI(); return; }
        p.gold -= 65;
        p._resistFloors = (gameState.floor||0) + 5;
        addFloatingText(p.x, p.y, 'Resistant', '#9fe6b0');
        addMessage('The tonic coats your veins. Poison and burn won\'t touch you for 5 floors.');
        sfxPotion();
    }
    updateUI();
    closeTownPanel('alchemist');
    openTownAlchemist();
}

// ── Town Hall ──────────────────────────────────────────────────────────────────
// Lore, world context, renown display, and a map of the dungeon's known floors.
function openTownHall() {
    if (gameState.townHallOpen) return;
    gameState.townHallOpen = true;

    const bestFloor = gameState.bestFloor || 0;
    const kills = (gameMeta?.stats?.totalKills) || 0;
    const renown = gameMeta?.renown || 0;

    showTownPanel('town-hall', '⚑ Town Hall',
        `<p class="town-intro">"Your legend grows," the clerk says, unrolling a long scroll. "The town remembers."</p>
         <div class="town-hall-stats">
             <div class="town-stat-row"><span class="town-stat-label">Deepest Floor</span><span class="town-stat-val">${bestFloor} / 100</span></div>
             <div class="town-stat-row"><span class="town-stat-label">Tavern Renown</span><span class="town-stat-val">${renown}</span></div>
             <div class="town-stat-row"><span class="town-stat-label">Enemies Slain</span><span class="town-stat-val">${kills}</span></div>
         </div>
         <p class="town-hall-lore">
             "The dungeon appeared seven years ago, overnight, when the old king vanished. We've called it
             the Dungeon of Ash ever since — the ash falls upward here, out of the depths. 
             ${bestFloor >= 50 ? 'You\'ve gone deeper than anyone from this town ever dared.' :
               bestFloor >= 10 ? 'A few brave souls tried. Most didn\'t come back.' :
               'No one from here has made it far. The first floors are treacherous enough.'}
             ${bestFloor >= 100 ? ' The Fallen God is defeated. The town breathes easier.' : ''}
         </p>`,
        () => { gameState.townHallOpen = false; }
    );
}

// ── Shared town panel system ──────────────────────────────────────────────────
function showTownPanel(id, title, bodyHtml, onClose) {
    closeTownPanel(id);
    const panel = document.createElement('div');
    panel.className = 'town-panel';
    panel.id = `town-panel-${id}`;
    panel.innerHTML = `
        <div class="town-panel-inner">
            <div class="town-panel-header">
                <h2>${title}</h2>
                <button onclick="closeTownPanel('${id}')">&times; Leave</button>
            </div>
            <div class="town-panel-body">${bodyHtml}</div>
        </div>`;
    document.getElementById('game-container')?.appendChild(panel) || document.body.appendChild(panel);
    panel.querySelector('button[onclick]').addEventListener('click', () => { if (onClose) onClose(); });
}

function closeTownPanel(id) {
    const el = document.getElementById(`town-panel-${id}`);
    if (el) el.remove();
}

function closeAllTownPanels() {
    ['general-store','temple','alchemist','town-hall'].forEach(id => closeTownPanel(id));
    gameState.townStoreOpen = false;
    gameState.townTempleOpen = false;
    gameState.townAlchemistOpen = false;
    gameState.townHallOpen = false;
}


// ── Overland zone features ──────────────────────────────────────────────────
// Forage nodes, travelling merchants, mini-events, and ambushes that populate
// the world map's forests and roads. See FORAGE_NODES / ROAD_MERCHANT_STOCK /
// ZONE_EVENTS in data.js for the content tables.

// Bump-to-interact handler for non-ambush features (forage / merchant / event).
function interactZoneFeature(feat) {
    const p = gameState.player;
    if (!p || !feat || feat.used) return;

    if (feat.kind === 'forage') {
        const msg = feat.ref.reward(p);
        feat.used = true;
        sfxItemPickup?.();
        addMessage(msg);
        if (typeof showEventCard === 'function') showEventCard('FORAGED', feat.ref.name, 'heal');
    } else if (feat.kind === 'event') {
        const msg = feat.ref.resolve(p);
        feat.used = true;
        sfxItemPickup?.();
        addMessage(msg);
        if (typeof showEventCard === 'function') showEventCard(feat.ref.name.toUpperCase(), feat.ref.desc, 'milestone');
    } else if (feat.kind === 'merchant') {
        openRoadMerchant(feat);
        return; // merchant stays until the player buys out / leaves
    }
    if (typeof recalculateStats === 'function') recalculateStats();
    updateUI();
}

// Ambush: stepping onto an un-sprung ambush tile spawns 1–3 enemies scaled to
// the player's level, and flips on zone combat so enemyTurn() runs in the zone.
function triggerZoneAmbush(x, y) {
    const feats = gameState.zoneFeatures;
    if (!Array.isArray(feats)) return;
    const ambush = feats.find(f => f.kind === 'ambush' && !f.used && f.x === x && f.y === y);
    if (!ambush) return;
    ambush.used = true;

    const p = gameState.player;
    const lvl = p?.level || 1;
    // Pick a small pack from a level-appropriate set of overland foes.
    const roster = lvl >= 8 ? ['orc', 'lizardman', 'goblin', 'archer']
                 : lvl >= 4 ? ['goblin', 'archer', 'spider', 'brute']
                 :            ['goblin', 'spider', 'bat'];
    const count = 1 + Math.floor(rng() * 3); // 1–3
    let spawned = 0;
    for (let i = 0; i < count; i++) {
        const spot = findOpenZoneTileNear(x, y);
        if (!spot) break;
        const type = roster[Math.floor(rng() * roster.length)];
        const e = new Enemy(spot.x, spot.y, type);
        e.renderX = spot.x * TILE_SIZE; e.renderY = spot.y * TILE_SIZE;
        gameState.enemies.push(e);
        spawned++;
    }
    if (spawned) {
        gameState.inZoneCombat = true;
        if (typeof refreshEnemyIntents === 'function') refreshEnemyIntents();
        sfxBossEncounter?.();
        addMessage(`Ambush! ${spawned} ${spawned === 1 ? 'foe lunges' : 'foes lunge'} from the brush!`);
        if (typeof showEventCard === 'function') showEventCard('AMBUSH!', 'Cut your way clear.', 'boss');
        updateUI();
    }
}

// Find an open floor tile adjacent-ish to (x,y) for spawning an ambusher.
function findOpenZoneTileNear(x, y) {
    const cand = [];
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 1 || ny < 1 || nx >= MAP_WIDTH - 1 || ny >= MAP_HEIGHT - 1) continue;
            if (gameState.dungeon[ny][nx] !== 0) continue;
            if (nx === gameState.player.x && ny === gameState.player.y) continue;
            if (gameState.enemies.some(e => e.x === nx && e.y === ny)) continue;
            cand.push({ x: nx, y: ny });
        }
    return cand.length ? cand[Math.floor(rng() * cand.length)] : null;
}

// ── Road merchant panel ─────────────────────────────────────────────────────
function openRoadMerchant(feat) {
    gameState.roadMerchantOpen = true;
    gameState._roadMerchantFeat = feat;
    renderRoadMerchant();
}

function renderRoadMerchant() {
    const feat = gameState._roadMerchantFeat;
    const p = gameState.player;
    if (!feat || !p) return;
    const rows = feat.stock.map((it, i) => `
        <div class="town-shop-row" onclick="roadMerchantBuy(${i})">
            <span class="town-shop-icon">${it.icon}</span>
            <span class="town-shop-info">
                <span class="town-shop-name">${it.name}</span>
                <span class="town-shop-desc">${it.desc}</span>
            </span>
            <span class="town-shop-cost">${it.cost}g</span>
        </div>`).join('');
    showTownPanel('road-merchant', '\u{1F9F3} Travelling Merchant',
        `<p class="town-intro">"Long road, friend. Coin for comfort?" The pedlar gestures at a worn pack. <span style="color:var(--gold)">${p.gold}g</span></p>
         <div class="town-shop-list">${rows}</div>`,
        () => { gameState.roadMerchantOpen = false; gameState._roadMerchantFeat = null; });
}

function roadMerchantBuy(i) {
    const feat = gameState._roadMerchantFeat;
    const p = gameState.player;
    if (!feat || !p) return;
    const it = feat.stock[i];
    if (!it) return;
    if (p.gold < it.cost) { addMessage('Not enough gold.'); updateUI(); return; }
    p.gold -= it.cost;
    addItemToInventory({ type: it.type, name: it.name, qty: 1 });
    addMessage(`Bought ${it.name} from the travelling merchant for ${it.cost}g.`);
    sfxItemPickup?.();
    updateUI();
    closeTownPanel('road-merchant');
    renderRoadMerchant();
}


// ── World Map Transitions ────────────────────────────────────────────────────
// handleZoneExit() is called by checkInteractions() when the player steps on
// a TILE_ZONE_EXIT border tile.  The direction is inferred from the tile's
// position on the map edge, then enterWorldZone() does the swap.

function handleZoneExit(x, y) {
    const { row, col } = gameState.worldPos || { row: 2, col: 2 };
    let dir, targetRow = row, targetCol = col;

    if (y === 0)              { dir = 'north'; targetRow = row - 1; }
    else if (y === MAP_HEIGHT - 1) { dir = 'south'; targetRow = row + 1; }
    else if (x === 0)              { dir = 'west';  targetCol = col - 1; }
    else if (x === MAP_WIDTH - 1)  { dir = 'east';  targetCol = col + 1; }
    else return; // somehow not on an edge — ignore

    if (targetRow < 0 || targetRow >= 5 || targetCol < 0 || targetCol >= 5) return;
    const targetType = WORLD_MAP[targetRow][targetCol];
    if (!zonePassable(targetType)) {
        addMessage('The mountains rise impassably before you.');
        updateUI();
        return;
    }
    // The arena zone is gated — player must reach Floor 20 first
    if (targetType === 'arena' && typeof isPitUnlocked === 'function' && !isPitUnlocked()) {
        addMessage('"The Pit is for professionals," a voice rasps from the darkness. "Survive Floor 20 first."');
        updateUI();
        return;
    }
    enterWorldZone(targetRow, targetCol, dir);
}


// Swap the active dungeon grid to a new world zone and place the player on
// the opposite edge from the one they just exited.
//
// fromDir = the direction of the exit in the OLD zone (i.e., 'south' means
// the player walked off the south edge, so they appear at the TOP of the new
// zone — just inside y=1, centred on x=12).
function enterWorldZone(row, col, fromDir) {
    // Reset all sub-zone flags; individual branches set what they need.
    gameState.inCourtyard = false;
    gameState.inTown = false;
    gameState.inArena = false;
    gameState.zoneFeatures = []; // only generated forest/road zones repopulate this

    const CX = 12, CY = 8;

    if (row === 2 && col === 2) {
        // ── Returning to the tavern courtyard ──────────────────────────
        gameState.dungeon = gameState.courtyard;
        gameState.inCourtyard = true;
        gameState.worldPos = { row: 2, col: 2 };
        // Place opposite the edge we entered from. Avoid the tavern door
        // (x=MAP_WIDTH-1, y=8) and the town road gate (x=0, y=8).
        if (fromDir === 'east') {
            // came from road (2,3) — enter at courtyard's east world-exit row
            gameState.player.x = MAP_WIDTH - 2; gameState.player.y = 5;
        } else if (fromDir === 'north') {
            // came from arena (3,2) to the south — enter at courtyard's south exit
            gameState.player.x = CX; gameState.player.y = MAP_HEIGHT - 2;
        } else {
            // west (from town): standard left-wall entry, one tile in
            gameState.player.x = 1; gameState.player.y = CY;
        }

    } else if (row === 2 && col === 1) {
        // ── Town (re-uses existing town grid) ──────────────────────────
        if (!gameState.town || gameState.town.length === 0) generateTown();
        gameState.courtyardDungeon = gameState.dungeon;
        gameState.dungeon = gameState.town;
        gameState.inTown = true;
        gameState.worldPos = { row: 2, col: 1 };
        // Place opposite the entry edge so the player walks INTO the town.
        switch (fromDir) {
            case 'south': gameState.player.x = CX; gameState.player.y = 1;             break; // entered from forest (1,1) above
            case 'north': gameState.player.x = CX; gameState.player.y = MAP_HEIGHT - 2; break; // entered from Crossroads (3,1) below
            case 'east':  gameState.player.x = 1;  gameState.player.y = CY;            break; // entered from forest (2,0) to the west
            case 'west':  default: gameState.player.x = MAP_WIDTH - 2; gameState.player.y = CY; break; // entered from courtyard (2,2) to the east
        }

    } else {
        // ── Generic generated world zone ───────────────────────────────
        const key = `${row},${col}`;
        if (!gameState.worldGrids[key]) {
            gameState.worldGrids[key] = generateWorldZone(row, col);
            // Roll this zone's content once, alongside its grid, and cache it.
            gameState.worldZoneFeatures[key] = generateZoneFeatures(row, col, gameState.worldGrids[key]);
        }
        gameState.dungeon = gameState.worldGrids[key];
        gameState.worldPos = { row, col };
        gameState.inArena = (WORLD_MAP[row][col] === 'arena');
        // Point the live feature list at this zone's cached features.
        gameState.zoneFeatures = gameState.worldZoneFeatures[key] || [];

        // Place player just inside the entry edge (opposite fromDir)
        switch (fromDir) {
            case 'south': gameState.player.x = CX; gameState.player.y = 1;            break;
            case 'north': gameState.player.x = CX; gameState.player.y = MAP_HEIGHT - 2; break;
            case 'east':  gameState.player.x = 1;  gameState.player.y = CY;           break;
            case 'west':  gameState.player.x = MAP_WIDTH - 2; gameState.player.y = CY; break;
        }
    }

    gameState.player.renderX = gameState.player.x * TILE_SIZE;
    gameState.player.renderY = gameState.player.y * TILE_SIZE;
    revealAll();
    const name = ZONE_NAMES[WORLD_MAP[row][col]] || 'the unknown';
    addMessage(`You follow the road into ${name}.`);
    // Arena zone: open the bout selection panel immediately on entry,
    // the same way the old gate interaction did.
    if (WORLD_MAP[row][col] === 'arena' && typeof openArena === 'function') {
        openArena();
    }
    updateUI();
}
