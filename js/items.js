
function collectItemAt(x, y) {
    const item = findItemAt(x, y);
    if (!item) return;

    // ── Mimic: the chest that fights back ──────────────────────────────────
    // When the player steps on what looks like a chest and presses Space,
    // instead of loot they get an enemy. The item is removed and replaced
    // with a Mimic enemy at the same tile. A horror moment — a design beat,
    // not a frustration — so the reveal is theatrical.
    if (item.type === 'mimic_chest') {
        gameState.items = gameState.items.filter(c => c !== item);
        addBurst(x, y, '#c8a060');
        const mimic = new Enemy(x, y, 'mimic');
        mimic._mimicJustRevealed = true;
        gameState.enemies.push(mimic);
        addFloatingText(x, y, '!! MIMIC !!', '#c8a060');
        addMessage('The chest LUNGES at you — it was a Mimic all along!');
        showEventCard('MIMIC!', 'It was never a chest.', 'boss');
        sfxDeath();  // jarring sting to sell the jumpscare
        updateUI();
        recordBestiarySeen('mimic');
        return;
    }

    // ── Inventory capacity gate ────────────────────────────────────────────
    // Gold and relics never use pack slots, and a consumable that stacks onto
    // an existing slot is always allowed. But a NEW slot (new consumable type,
    // or any equipment) is blocked when the pack is full — and we must check
    // this BEFORE removing the item from the floor, so a full pack leaves the
    // item on the ground to grab later rather than destroying it.
    const usesNewSlot =
        item.type === 'equipment' ||
        (CONSUMABLE_TYPES.includes(item.type) &&
            !gameState.player.inventory.find(c => c.type === item.type));
    if (usesNewSlot && inventoryFull()) {
        addMessage(`Your pack is full (${MAX_INVENTORY_SLOTS} slots) — left ${item.name || 'the item'} on the ground.`);
        showFirstTimeHint?.('packfull');
        updateUI();
        return;
    }

    gameState.items = gameState.items.filter(candidate => candidate !== item);
    addBurst(x, y, item.color);
    sfxItemPickup();

    const PICKUP_NAMES = {
        potion: 'a Health Potion', antidote: 'an Antidote',
        smokeBomb: 'a Smoke Bomb', rageDraught: 'a Rage Draught',
        identifyScroll: 'an Identify Scroll', captureCage: 'a Capture Net'
    };
    if (item.type === 'gold') {
        const amount = Math.round(item.amount * (1 + (gameState.player.goldFind || 0) / 100));
        gameState.player.gold += amount;
        trackGoldPickup(amount);
        addFloatingText(x, y, `+${amount}g`, '#ffd65a');
        addMessage(`Found ${amount} gold.`);
    } else if (CONSUMABLE_TYPES.includes(item.type)) {
        addItemToInventory(item);
        addMessage(`Picked up ${PICKUP_NAMES[item.type]}.`);
    } else if (item.type === 'equipment') {
        announceRareDrop(item, x, y);
        const inventoryItem = addItemToInventory(item);
        // Capacity was checked above, so inventoryItem should be non-null here;
        // guard anyway so a null can never reach autoEquipIfBetter.
        if (!inventoryItem) { updateUI(); return; }
        if (item.cursed && !item.identified) {
            addMessage(`Picked up a mysterious item.`);
            showFirstTimeHint('cursed');
        } else if (JEWELRY_SLOTS.includes(item.slot)) {
            addMessage(`Picked up ${item.name} (+${item.bonus}${item.unit || ''} \u2014 ${item.desc}).`);
        } else {
            addMessage(`Picked up ${item.name} (${getGearStatLabel(item)}).`);
        }
        autoEquipIfBetter(inventoryItem);
    } else if (item.type === 'relic') {
        addRelicToPouch(item.relicId);
        showEventCard('RELIC FOUND', item.name, 'boss');
        showFirstTimeHint('relic');
    }
}


// Maximum number of distinct inventory slots. Consumables of the same type
// stack into one slot regardless of quantity, so this caps unique item entries
// (each potion stack, each piece of gear in the pack). Existing stacks can
// always grow; only the creation of a NEW slot is gated. The pack UI renders
// this many slots — keep them in sync if this changes.
const MAX_INVENTORY_SLOTS = 8;

// True when the pack has no room for a new distinct item slot.
function inventoryFull() {
    return (gameState.player?.inventory?.length || 0) >= MAX_INVENTORY_SLOTS;
}

function addItemToInventory(item) {
    if (CONSUMABLE_TYPES.includes(item.type)) {
        const existing = gameState.player.inventory.find(c => c.type === item.type);
        if (existing) {
            // Stacking onto an existing slot never consumes a new slot.
            existing.qty = (existing.qty || 0) + (item.qty || 1);
            return existing;
        } else {
            // New consumable type needs a fresh slot — gate it on capacity.
            if (inventoryFull()) {
                addMessage('Your pack is full (8 slots). Use or drop something first.');
                return null;
            }
            const inventoryItem = { type: item.type, name: item.name, qty: item.qty || 1, color: item.color, glyph: item.glyph };
            gameState.player.inventory.push(inventoryItem);
            return inventoryItem;
        }
    }
    // Non-consumable (equipment, etc.) always needs a fresh slot.
    if (inventoryFull()) {
        addMessage('Your pack is full (8 slots). Use or drop something first.');
        return null;
    }
    const inventoryItem = { ...item, x: undefined, y: undefined };
    gameState.player.inventory.push(inventoryItem);
    return inventoryItem;
}


function autoEquipIfBetter(item) {
    item.slot = normalizeGearSlot(item.slot);
    gameState.player.equipment = migrateEquipment(gameState.player.equipment);

    let targetSlot = item.slot;
    if (targetSlot === 'ring1') {
        // Generic ring: compare against whichever ring slot is the weaker
        // candidate — prefer an empty slot outright, else the lower-bonus
        // equipped ring, so a strong ring1 doesn't block upgrades to ring2.
        const eq = gameState.player.equipment;
        if (!eq.ring1) targetSlot = 'ring1';
        else if (!eq.ring2) targetSlot = 'ring2';
        else targetSlot = (eq.ring1.bonus ?? 0) <= (eq.ring2.bonus ?? 0) ? 'ring1' : 'ring2';
    }

    const equipped = gameState.player.equipment[targetSlot];
    // Don't auto-swap if current item is cursed-locked
    if (equipped && equipped.cursed && gameState.floor > 0 && gameState.enemies.length > 0) return;
    if (!equipped) {
        gameState.player.inventory = gameState.player.inventory.filter(candidate => candidate !== item);
        gameState.player.equip({ ...item, x: undefined, y: undefined, slot: targetSlot });
        return;
    }
    if (JEWELRY_SLOTS.includes(targetSlot) && equipped && item.effectId !== equipped.effectId) return;
    if (item.bonus > equipped.bonus) {
        gameState.player.inventory = gameState.player.inventory.filter(candidate => candidate !== item);
        gameState.player.equip({ ...item, x: undefined, y: undefined, slot: targetSlot });
    }
}


// Resolves which physical ring slot a generic ring item should fill.
// Returns 'ring1' or 'ring2' directly if both are open or one is empty.
// Returns null when both ring slots are occupied — the caller must then
// ask the player which one to replace rather than picking for them.
function resolveRingSlot(equipment) {
    if (!equipment.ring1) return 'ring1';
    if (!equipment.ring2) return 'ring2';
    return null;
}


// ── Capture Net (key 6) ───────────────────────────────────────────────────────
// Attempts to capture the nearest revealed enemy below 30% HP for later use
// in Arena bouts. The actual capture logic lives in arena.js (tryCaptureEnemy)
// since it needs access to arena constants like MAX_CAPTURED.
function useCaptureCage() {
    if (!gameState.player || gameState.gameOver || gameState.awaitingLevelChoice) return;
    if (gameState.floor === 0 && !gameState.inArenaBout) {
        addMessageAndUpdate('No enemies here to capture.');
        return;
    }
    const targets = gameState.enemies
        .filter(e => e.hp > 0 && e.hp <= e.maxHp * 0.3 && e.type !== 'boss'
            && gameState.revealed[e.y]?.[e.x])
        .sort((a, b) =>
            getDistance(a.x, a.y, gameState.player.x, gameState.player.y) -
            getDistance(b.x, b.y, gameState.player.x, gameState.player.y));
    if (!targets.length) {
        addMessageAndUpdate('No weakened enemies in sight (< 30% HP required).');
        return;
    }
    tryCaptureEnemy(targets[0]);
}


// ── Relics ──────────────────────────────────────────────────────────────────
// Equips a relic by its def id, applying any one-time stat tradeoffs
// (Blood Idol) immediately rather than through recalculateStats(), since
// maxHp has no base value to re-derive from on every recalc elsewhere in
// the codebase. If all 5 slots are full, opens a chooser instead of
// silently bumping one — mirrors the ring-choice-prompt pattern.
function equipRelic(relicId, fromPouchIndex = null) {
    const p = gameState.player;
    if (!p) return;
    const def = RELIC_DEFS[relicId];
    if (!def) return;

    if (p.relics.length >= RELIC_MAX_SLOTS) {
        openRelicChoicePrompt(relicId, fromPouchIndex);
        return;
    }

    const relic = { id: relicId, charged: true };
    p.relics.push(relic);
    if (fromPouchIndex !== null) p.relicPouch.splice(fromPouchIndex, 1);
    _applyRelicOnEquip(relic);
    recalculateStats();
    addMessage(`Relic attuned: ${def.name}.`);
    updateUI();
}


// Removes a relic from the active loadout back into the pouch, reversing
// any one-time tradeoff it applied.
function unequipRelic(relicIndex) {
    const p = gameState.player;
    if (!p || !p.relics[relicIndex]) return;
    const [relic] = p.relics.splice(relicIndex, 1);
    _applyRelicOnUnequip(relic);
    p.relicPouch.push(relic);
    recalculateStats();
    const def = RELIC_DEFS[relic.id];
    addMessage(`${def ? def.name : 'Relic'} returned to your pouch.`);
    updateUI();
}


function _applyRelicOnEquip(relic) {
    const def = RELIC_DEFS[relic.id];
    const p = gameState.player;
    if (def && def.stat === 'atkHpTradeoff') {
        p.baseAtk += def.atk;
        p.maxHp = Math.max(1, p.maxHp + def.maxHp);
        p.hp = Math.min(p.hp, p.maxHp);
        recalculateStats();
    }
}


function _applyRelicOnUnequip(relic) {
    const def = RELIC_DEFS[relic.id];
    const p = gameState.player;
    if (def && def.stat === 'atkHpTradeoff') {
        p.baseAtk -= def.atk;
        p.maxHp = Math.max(1, p.maxHp - def.maxHp);
        p.hp = Math.min(p.hp, p.maxHp);
        recalculateStats();
    }
}


// All 5 relic slots are full — ask which to bench instead of guessing.
// Mirrors openRingChoicePrompt's pattern but with up to 5 options.
function openRelicChoicePrompt(incomingRelicId, fromPouchIndex) {
    gameState.pendingRelicId = incomingRelicId;
    gameState.pendingRelicPouchIndex = fromPouchIndex;
    const p = gameState.player;
    const msg = document.getElementById('relic-choice-message');
    const list = document.getElementById('relic-choice-list');
    if (!msg || !list) return;
    const incomingDef = RELIC_DEFS[incomingRelicId];
    msg.textContent = `All 5 relic slots are full. Bench which relic to attune ${incomingDef ? incomingDef.name : 'the new relic'}?`;
    list.innerHTML = p.relics.map((relic, i) => {
        const def = RELIC_DEFS[relic.id];
        return `<button class="relic-choice-btn" onclick="chooseRelicToBench(${i})">${def ? def.name : 'Unknown Relic'}</button>`;
    }).join('');
    gameState.relicChoiceOpen = true;
    document.getElementById('relic-choice-panel').style.display = 'flex';
}


function chooseRelicToBench(relicIndex) {
    const incomingId = gameState.pendingRelicId;
    const fromPouchIndex = gameState.pendingRelicPouchIndex;
    gameState.relicChoiceOpen = false;
    gameState.pendingRelicId = null;
    gameState.pendingRelicPouchIndex = null;
    document.getElementById('relic-choice-panel').style.display = 'none';
    if (!incomingId) return;

    unequipRelic(relicIndex);
    equipRelic(incomingId, fromPouchIndex);
}


function closeRelicChoicePrompt() {
    gameState.relicChoiceOpen = false;
    gameState.pendingRelicId = null;
    gameState.pendingRelicPouchIndex = null;
    const panel = document.getElementById('relic-choice-panel');
    if (panel) panel.style.display = 'none';
}


// Picked up from a dungeon drop or dealer purchase — lands in the pouch
// first; the player explicitly attunes it from there (consistent with how
// found gear sits in inventory until equipped, rather than auto-equipping).
function addRelicToPouch(relicId) {
    const p = gameState.player;
    if (!p) return;
    p.relicPouch.push({ id: relicId, charged: true });
    const def = RELIC_DEFS[relicId];
    addMessage(`Found a relic: ${def ? def.name : 'Unknown Relic'}.`);
}


// ── Relic triggers ───────────────────────────────────────────────────────
// Called from the lethal-damage check before showGameOver() fires. Returns
// true if a Phoenix Feather intervened (caller should abort the death).
function tryRelicLethalSave() {
    const p = gameState.player;
    if (!p) return false;
    const relic = p.relics.find(r => r.id === 'phoenix_feather' && r.charged);
    if (!relic) return false;
    relic.charged = false;
    p.hp = 1;
    addFloatingText(p.x, p.y, 'REVIVED!', '#ff9f3d', { style: 'crit-banner' });
    addMessage('The Phoenix Feather flares to ash and pulls you back from death\u2019s door!');
    showEventCard('PHOENIX FEATHER', 'Revived at 1 HP', 'boss');
    updateUI();
    return true;
}


// Called whenever a milestone boss is defeated — recharges any spent
// Phoenix Feather, equipped or benched, so swapping it out mid-run doesn't
// lose progress toward its next charge.
function rechargeRelicsOnMilestone() {
    const p = gameState.player;
    if (!p) return;
    let recharged = false;
    [...p.relics, ...p.relicPouch].forEach(relic => {
        if (relic.id === 'phoenix_feather' && !relic.charged) {
            relic.charged = true;
            recharged = true;
        }
    });
    if (recharged) addMessage('The Phoenix Feather glows anew, its power restored.');
}


// Called from trackEnemyKill() whenever the player kills a skeleton.
function tryNecroticSkullHeal() {
    const p = gameState.player;
    if (!p) return;
    const relic = p.relics.find(r => r.id === 'necrotic_skull');
    if (!relic) return;
    const def = RELIC_DEFS.necrotic_skull;
    const heal = Math.ceil(p.maxHp * (def.healPct / 100));
    p.hp = Math.min(p.maxHp, p.hp + heal);
    addFloatingText(p.x, p.y, `+${heal}`, '#9966cc');
    addMessage(`The Necrotic Skull drinks the skeleton's essence — you heal ${heal} HP.`);
}


// Hunter's Totem relic: killing a beast (bat/spider/ratman) restores a % of
// max HP. Parallels tryNecroticSkullHeal — called from trackEnemyKill when a
// beast dies. Was referenced before it existed, which threw on every beast
// kill; this is the missing definition.
function tryBeastKillHeal() {
    const p = gameState.player;
    if (!p || !p.relics) return;
    const relic = p.relics.find(r => r.id === 'hunters_totem');
    if (!relic) return;
    const def = RELIC_DEFS.hunters_totem;
    const heal = Math.ceil(p.maxHp * (def.healPct / 100));
    p.hp = Math.min(p.maxHp, p.hp + heal);
    addFloatingText(p.x, p.y, `+${heal}`, '#27ae60');
    addMessage(`The Hunter's Totem feeds on the kill — you heal ${heal} HP.`);
}


function equipFromInventory(item) {
    if (gameState.gameOver) return;

    let targetSlot = normalizeGearSlot(item.slot);
    if (targetSlot === 'ring1' && item.slot !== 'ring1' && item.slot !== 'ring2') {
        // Generic ring (slot was 'ring' or 'accessory') — figure out which
        // physical slot it should land in before any cursed-check runs.
        const resolved = resolveRingSlot(gameState.player.equipment);
        if (!resolved) {
            openRingChoicePrompt(item);
            return;
        }
        targetSlot = resolved;
    }

    const prev = gameState.player.equipment[targetSlot];
    if (prev && prev.cursed && gameState.floor > 0 && gameState.enemies.length > 0) {
        addMessage(`${prev.identified ? prev.name : '?? Item'} is cursed — clear the floor first!`);
        updateUI();
        return;
    }
    gameState.player.inventory = gameState.player.inventory.filter(candidate => candidate !== item);
    gameState.player.equip({ ...item, x: undefined, y: undefined, slot: targetSlot });
    updateUI();
}


// Both ring slots are full — ask which one to replace instead of silently
// overwriting ring1. Reuses the tavern-confirm-style two-button pattern
// already established elsewhere (Return to Tavern, etc.) rather than a
// brand-new modal type.
function openRingChoicePrompt(item) {
    gameState.pendingRingItem = item;
    const eq = gameState.player.equipment;
    const msg = document.getElementById('ring-choice-message');
    const r1btn = document.getElementById('ring-choice-slot1-btn');
    const r2btn = document.getElementById('ring-choice-slot2-btn');
    if (!msg || !r1btn || !r2btn) {
        // Fallback if the prompt markup isn't present for some reason —
        // default to replacing ring1 rather than dropping the action.
        const prev = eq.ring1;
        if (prev && prev.cursed && gameState.floor > 0 && gameState.enemies.length > 0) {
            addMessage(`${prev.identified ? prev.name : '?? Item'} is cursed — clear the floor first!`);
            updateUI();
            return;
        }
        gameState.player.inventory = gameState.player.inventory.filter(candidate => candidate !== item);
        gameState.player.equip({ ...item, x: undefined, y: undefined, slot: 'ring1' });
        updateUI();
        return;
    }
    const name1 = eq.ring1 ? (eq.ring1.cursed && !eq.ring1.identified ? '?? Item' : eq.ring1.name) : 'Empty';
    const name2 = eq.ring2 ? (eq.ring2.cursed && !eq.ring2.identified ? '?? Item' : eq.ring2.name) : 'Empty';
    msg.textContent = `Both ring slots are full. Replace which ring with ${item.cursed && !item.identified ? '?? Item' : item.name}?`;
    r1btn.textContent = `Ring 1: ${name1}`;
    r2btn.textContent = `Ring 2: ${name2}`;
    gameState.ringChoiceOpen = true;
    document.getElementById('ring-choice-panel').style.display = 'flex';
}


function chooseRingSlot(slot) {
    const item = gameState.pendingRingItem;
    gameState.ringChoiceOpen = false;
    document.getElementById('ring-choice-panel').style.display = 'none';
    gameState.pendingRingItem = null;
    if (!item) return;

    const prev = gameState.player.equipment[slot];
    if (prev && prev.cursed && gameState.floor > 0 && gameState.enemies.length > 0) {
        addMessage(`${prev.identified ? prev.name : '?? Item'} is cursed — clear the floor first!`);
        updateUI();
        return;
    }
    gameState.player.inventory = gameState.player.inventory.filter(candidate => candidate !== item);
    gameState.player.equip({ ...item, x: undefined, y: undefined, slot });
    updateUI();
}


function closeRingChoicePrompt() {
    gameState.ringChoiceOpen = false;
    gameState.pendingRingItem = null;
    const panel = document.getElementById('ring-choice-panel');
    if (panel) panel.style.display = 'none';
}


function getSellValue(item) {
    if (item.cursed && !item.identified) return 5;
    const base = SELL_RARITY_BASE[item.rarity] || 6;
    const bonusValue = (item.bonus || 0) * 2;
    const value = base + bonusValue;
    return item.cursed ? Math.ceil(value * 0.5) : value;
}


function sellItem(item) {
    if (gameState.gameOver || !gameState.shopOpen) return;
    const idx = gameState.player.inventory.indexOf(item);
    if (idx === -1) return;
    const value = getSellValue(item);
    gameState.player.inventory.splice(idx, 1);
    gameState.player.gold += value;
    const shownName = (item.cursed && !item.identified) ? '?? Item' : item.name;
    addMessage(`Sold ${shownName} for ${value}g.`);
    renderShop();
    updateUI();
}


function sellEquippedSlot(slot) {
    if (gameState.gameOver || !gameState.shopOpen) return;
    const item = gameState.player.equipment[slot];
    if (!item) return;
    if (item.cursed && gameState.floor > 0 && gameState.enemies.length > 0) {
        addMessage(`${item.identified ? item.name : '?? Item'} is cursed — clear the floor first!`);
        return;
    }
    const value = getSellValue(item);
    gameState.player.equipment[slot] = null;
    gameState.player.gold += value;
    recalculateStats();
    const shownName = (item.cursed && !item.identified) ? '?? Item' : item.name;
    addMessage(`Sold your equipped ${shownName} for ${value}g.`);
    renderShop();
    updateUI();
}


function usePotion() {
    if (!gameState.player || gameState.gameOver || gameState.awaitingLevelChoice) return;
    const p = gameState.player;
    if (p.hp >= p.maxHp) return addMessageAndUpdate('You are already at full HP.');

    // Prefer a Greater Potion if the player has one — it heals a % of max HP
    // (bought from the town Alchemist) and is strictly better than a basic
    // potion, so spend it first when health is low enough to justify it.
    const greater = p.inventory.find(item => item.type === 'greaterPotion' && (item.qty || 1) > 0);
    const basic   = p.inventory.find(item => item.type === 'potion' && item.qty > 0);
    if (!greater && !basic) return addMessageAndUpdate('No Health Potions left.');

    let heal, potion, label;
    // Use the Greater Potion only when the bigger heal won't be mostly wasted;
    // otherwise save it and sip a basic potion. If only one type exists, use it.
    const greaterHeal = greater ? Math.ceil(p.maxHp * (greater.healPct || 0.7)) : 0;
    const basicHeal   = 35 + p.level * 5;
    const missing     = p.maxHp - p.hp;
    if (greater && (!basic || missing >= basicHeal)) {
        potion = greater; heal = greaterHeal; label = 'Greater Potion';
    } else {
        potion = basic; heal = basicHeal; label = 'Health Potion';
    }

    potion.qty = (potion.qty || 1) - 1;
    p.hp = Math.min(p.maxHp, p.hp + heal);
    if (potion.qty <= 0) p.inventory = p.inventory.filter(item => item !== potion);
    if (gameState.runStats) gameState.runStats.potionsUsed = (gameState.runStats.potionsUsed || 0) + 1;
    sfxPotion();
    addFloatingText(p.x, p.y, `+${heal}`, '#58c26d');
    addMessage(`You drink a ${label} for ${heal} HP.`);

    // Fail no_potion_run quest
    const qp = gameState.activeQuest;
    if (qp && qp.type === 'no_potion_run' && !qp.completed && !qp.failed) {
        qp.failed = true;
        addMessage('Bounty Failed: Iron Belly — you drank a potion.');
    }
    updateUI();
}


// ── New consumable use functions ──────────────────────────────────────────────

function useAntidote() {
    if (!gameState.player || gameState.gameOver || gameState.awaitingLevelChoice) return;
    const item = gameState.player.inventory.find(i => i.type === 'antidote' && i.qty > 0);
    if (!item) return addMessageAndUpdate('No Antidote in inventory.');
    item.qty--;
    if (item.qty <= 0) gameState.player.inventory = gameState.player.inventory.filter(i => i !== item);
    gameState.player.statuses = gameState.player.statuses.filter(s => s.type !== 'poison' && s.type !== 'burn');
    sfxPotion();
    addFloatingText(gameState.player.x, gameState.player.y, 'Cleansed!', '#58c26d');
    addMessage('You drink the Antidote — poison and burn cleared!');
    updateUI();
}


function useSmokeBomb() {
    if (!gameState.player || gameState.gameOver || gameState.awaitingLevelChoice) return;
    if (gameState.floor === 0) return addMessageAndUpdate('No enemies here to smoke out.');
    const item = gameState.player.inventory.find(i => i.type === 'smokeBomb' && i.qty > 0);
    if (!item) return addMessageAndUpdate('No Smoke Bomb in inventory.');
    item.qty--;
    if (item.qty <= 0) gameState.player.inventory = gameState.player.inventory.filter(i => i !== item);
    gameState.enemies.forEach(enemy => applyStatus(enemy, 'stun', 1));
    addBurst(gameState.player.x, gameState.player.y, '#aaa397');
    sfxPotion();
    addMessage('Smoke fills the room — all enemies stunned for 1 turn!');
    updateUI();
}


function useRageDraught() {
    if (!gameState.player || gameState.gameOver || gameState.awaitingLevelChoice) return;
    const item = gameState.player.inventory.find(i => i.type === 'rageDraught' && i.qty > 0);
    if (!item) return addMessageAndUpdate('No Rage Draught in inventory.');
    item.qty--;
    if (item.qty <= 0) gameState.player.inventory = gameState.player.inventory.filter(i => i !== item);
    applyStatus(gameState.player, 'rage', 3);
    sfxPotion();
    addFloatingText(gameState.player.x, gameState.player.y, 'ENRAGED!', '#ff4500');
    addMessage('You drink the Rage Draught — +50% ATK, +25% damage taken for 3 turns!');
    updateUI();
}


function useIdentifyScroll() {
    if (!gameState.player || gameState.gameOver || gameState.awaitingLevelChoice) return;
    const item = gameState.player.inventory.find(i => i.type === 'identifyScroll' && i.qty > 0);
    if (!item) return addMessageAndUpdate('No Identify Scroll in inventory.');
    item.qty--;
    if (item.qty <= 0) gameState.player.inventory = gameState.player.inventory.filter(i => i !== item);
    let found = false;
    let identifiedCount = 0;
    // Reveal anything still unidentified, not just cursed items — a mystery
    // relic that turned out NOT to be cursed should still get identified,
    // otherwise it stays "?? Relic" forever with no way to ever reveal it.
    gameState.player.inventory.forEach(i => {
        if (i.identified === false) { i.identified = true; i.name = i.trueName || i.name; found = true; identifiedCount++; }
    });
    GEAR_SLOTS.forEach(slot => {
        const eq = migrateEquipment(gameState.player.equipment)[slot];
        if (eq && eq.identified === false) { eq.identified = true; eq.name = eq.trueName || eq.name; found = true; identifiedCount++; }
    });
    if (identifiedCount > 0) {
        ensureMetaStats();
        gameMeta.stats.itemsIdentified += identifiedCount;
        checkAchievements();
    }
    sfxItemPickup();
    addMessage(found ? 'The scroll reveals the truth of your unidentified gear!' : 'The scroll finds nothing left to identify.');
    recalculateStats();
    updateUI();
}
