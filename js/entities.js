
function createEmptyEquipment() {
    return { helmet: null, chest: null, weapon: null, shield: null, ring1: null, ring2: null, amulet: null, boots: null };
}


function migrateEquipment(equip) {
    if (!equip) return createEmptyEquipment();
    if (equip.chest !== undefined || equip.helmet !== undefined) {
        const out = { ...createEmptyEquipment(), ...equip };
        // Pre-second-ring saves stored a single `ring` key — route it into
        // ring1 rather than letting it linger as an orphaned property.
        if (equip.ring !== undefined && equip.ring1 === undefined) {
            out.ring1 = equip.ring ? { ...equip.ring, slot: 'ring1' } : null;
        }
        delete out.ring;
        return out;
    }
    const out = createEmptyEquipment();
    if (equip.weapon) out.weapon = { ...equip.weapon, slot: 'weapon' };
    if (equip.armor) out.chest = { ...equip.armor, slot: 'chest' };
    if (equip.accessory) {
        const slot = equip.accessory.effectId === 'manaRegen' ? 'amulet' : 'ring1';
        out[slot] = { ...equip.accessory, slot };
    }
    return out;
}


function normalizeGearSlot(slot) {
    if (slot === 'armor') return 'chest';
    if (slot === 'accessory' || slot === 'ring') return 'ring1';
    return slot;
}


function createRunStats() {
    return {
        enemiesSlain: 0,
        bossesDefeated: 0,
        goldEarned: 0,
        legendaryFound: 0,
        mythicFound: 0,
        startFloor: 0,
        // ── Extended stats for the tombstone screen ──
        damageDelt: 0,      // total damage player dealt to enemies
        damageTaken: 0,     // total damage player received
        turnsPlayed: 0,     // move/attack turns taken
        potionsUsed: 0,     // health potions consumed
        critsLanded: 0,     // critical hits scored
        killedBy: '',       // cause of death (set at showGameOver)
    };
}


// ── end Audio ─────────────────────────────────────────────────────────────────

// ── Subclass state & unique gameplay ───────────────────────────────────────────

function initSubclassState(player) {
    player.sc = {};
    player.ability = SUBCLASS_ABILITIES[player.subclass]?.name || player.ability;
    switch (player.subclass) {
        case 'berserker':      player.sc = { rage: 0, deathSaveReady: true }; break;
        case 'knight':         player.sc = { block: 0, blockReady: false }; break;
        case 'gladiator':      player.sc = { combo: 0 }; break;
        case 'assassin':       player.sc = { stealth: 0 }; break;
        case 'trickster':      player.sc = { trapCharges: 2, dodgeReady: true }; break;
        case 'shadow':         break;
        case 'elementalist':   player.sc = { element: 0 }; break;
        case 'illusionist':    break;
        case 'necromancer':    break;
        case 'warDomain':      break;
        case 'lightDomain':    break;
        case 'twilightDomain': break;
        default: break;
    }
}


function getSubclassMeterHtml() {
    const p = gameState.player;
    if (!p?.sc || (gameState.floor === 0 && !gameState.inArenaBout)) return '';
    switch (p.subclass) {
        case 'berserker':
            return `<div class="sc-meter"><small>Rage</small><div class="sc-track"><div class="sc-fill sc-rage" style="width:${p.sc.rage}%"></div></div><span>${p.sc.rage}</span></div>`;
        case 'knight':
            return `<div class="sc-meter"><small>Block${p.sc.blockReady ? ' \u2713 READY' : ''}</small><div class="sc-track"><div class="sc-fill sc-block" style="width:${p.sc.block}%"></div></div><span>${p.sc.block}</span></div>`;
        case 'gladiator':
            return `<div class="sc-meter"><small>Combo</small><div class="sc-track"><div class="sc-fill sc-combo" style="width:${Math.min(100, p.sc.combo * 10)}%"></div></div><span>${p.sc.combo}</span></div>`;
        case 'assassin':
            return p.sc.stealth > 0 ? `<span class="status-badge" style="--sc:#9b7bd6">\u{1F576} Stealth (${p.sc.stealth})</span>` : '';
        case 'trickster':
            return `<div class="sc-meter"><small>Trap Charges</small><span class="sc-val">${p.sc.trapCharges}</span></div>` +
                (p.sc.dodgeReady ? '<span class="status-badge" style="--sc:#6fce82">\u21BB Dodge Ready</span>' : '');
        case 'elementalist': {
            const els = ['Fire', 'Ice', 'Lightning'];
            return `<div class="sc-meter"><small>Element</small><span class="sc-val sc-elem">${els[p.sc.element]}</span></div>`;
        }
        case 'necromancer': {
            const count = gameState.allies.length;
            const capped = count >= NECROMANCER_MINION_CAP;
            const header = `<div class="sc-meter-label">Minions${capped ? ' <span class="sc-drain-hint">(E: drain weakest)</span>' : ''} <span class="sc-val">${count} / ${NECROMANCER_MINION_CAP}</span></div>`;
            if (!count) return `<div class="sc-meter">${header}</div>`;
            const rows = gameState.allies.map((a, i) => {
                const hpPct = Math.round((a.hp / a.maxHp) * 100);
                const hpColor = hpPct > 60 ? '#58c26d' : hpPct > 30 ? '#ffd65a' : '#e14b4b';
                const turnPct = Math.round((a.turns / 6) * 100); // 6 = max turns on summon
                return `<div class="minion-row">
                    <span class="minion-glyph" style="color:#b06fff">S</span>
                    <div class="minion-bars">
                        <div class="minion-bar-track">
                            <div class="minion-bar-fill" style="width:${hpPct}%;background:${hpColor}"></div>
                        </div>
                        <div class="minion-bar-track minion-turn-track">
                            <div class="minion-bar-fill" style="width:${turnPct}%;background:#9c6dff"></div>
                        </div>
                    </div>
                    <div class="minion-stats">
                        <span class="minion-hp">${a.hp}/${a.maxHp}</span>
                        <span class="minion-turns">${a.turns}t</span>
                    </div>
                </div>`;
            }).join('');
            return `<div class="sc-meter sc-meter-minions">${header}${rows}</div>`;
        }
        default: return '';
    }
}


function applyBerserkerBonuses(player, baseDamage) {
    let dmg = baseDamage;
    const ratio = player.hp / player.maxHp;
    if (ratio < 0.5) dmg = Math.ceil(dmg * (1 + (0.5 - ratio) * 1.5));
    return dmg;
}


// Berserker's advertised "Ignores death once per floor at 1 HP" trait.
// Mirrors tryRelicLethalSave's pattern exactly — called from showGameOver
// before the run is actually ended, returns true if the save fired so the
// caller aborts the death. deathSaveReady is consumed here and restored by
// resetPerFloorSubclassState() on the next floor transition (either
// direction), making this a once-per-floor safety net rather than a
// once-per-run one like Phoenix Feather.
function tryBerserkerDeathSave() {
    const p = gameState.player;
    if (!p || p.subclass !== 'berserker' || !p.sc?.deathSaveReady) return false;
    p.sc.deathSaveReady = false;
    p.hp = 1;
    addFloatingText(p.x, p.y, 'UNBREAKABLE!', '#ff4500', { style: 'crit-banner' });
    addMessage('Pure fury refuses to let you fall — you cling to life at 1 HP!');
    showEventCard('UNBREAKABLE', 'Refused to die — 1 HP', 'boss');
    updateUI();
    return true;
}


function onPlayerDealDamage(dealt) {
    const p = gameState.player;
    if (!p?.sc) return;
    if (p.subclass === 'berserker') p.sc.rage = Math.min(100, p.sc.rage + Math.ceil(dealt / 2));
    if (p.subclass === 'gladiator') p.sc.combo = Math.min(10, p.sc.combo + 1);
}


function onPlayerTakeDamage(sourceEnemy = null) {
    const p = gameState.player;
    if (p?.subclass === 'gladiator' && p.sc) p.sc.combo = Math.min(10, p.sc.combo + 1);
    if (p) p.hitFlash = 1.0;
    // Marks this specific boss encounter as no longer eligible for the
    // "Flawless Victory" achievement — tracked per-enemy-instance (not
    // per-run) so a hit from a different boss earlier in the run doesn't
    // wrongly disqualify a clean fight against this one.
    if (sourceEnemy && sourceEnemy.type === 'boss') {
        sourceEnemy.tookNoDamage = false;
    }
}


function onEnemyKilledByPlayer() {
    const p = gameState.player;
    if (p?.subclass === 'assassin' && p.sc) {
        p.sc.stealth = 1;
        addMessage('You vanish into the shadows after the kill.');
    }
    if (p?.subclass === 'gladiator' && p.sc) p.sc.combo = Math.min(10, p.sc.combo + 2);
}


function useSubclassAbility() {
    const p = gameState.player;
    if (!p || gameState.gameOver || gameState.awaitingLevelChoice) return;

    const finish = () => { p.regenMana(); enemyTurn(); refreshEnemyIntents(); updateUI(); };
    const abi = SUBCLASS_ABILITIES[p.subclass];

    switch (p.subclass) {
        case 'berserker': {
            const cost = Math.max(1, Math.floor(p.maxHp * 0.2));
            if (p.hp <= cost) return addMessageAndUpdate('Not enough HP for Frenzied Strike.');
            const enemy = findEnemyAt(p.x, p.y, 1) || findNearestEnemy();
            if (!enemy) return addMessageAndUpdate('No target in range.');
            p.hp -= cost;
            p.attackAnim = { life: 20, maxLife: 20 };
            const dealt = Math.max(1, Math.ceil(p.atk * 2.2) - enemy.def);
            damageEnemy(enemy, dealt, 'CRIT');
            applyLifesteal(dealt);
            onPlayerDealDamage(dealt);
            if (enemy.hp <= 0) defeatEnemy(enemy);
            else enemyAttack(enemy);
            finish();
            return;
        }
        case 'knight': {
            p.sc.block = 100;
            p.sc.blockReady = true;
            addBurst(p.x, p.y, '#ffd65a');
            addMessage('Shield Wall raised — the next blow will be fully blocked!');
            finish();
            return;
        }
        case 'gladiator': {
            p.sc.riposteReady = true;
            addBurst(p.x, p.y, '#ff9f58');
            addMessage('Riposte stance — counter the next attacker for double damage!');
            finish();
            return;
        }
        case 'assassin': {
            const enemy = findEnemyAt(p.x, p.y, 1) || findNearestEnemy();
            if (!enemy) return addMessageAndUpdate('No target for Shadow Strike.');
            const mult = p.sc.stealth > 0 ? 3 : 1.8;
            const dealt = Math.max(1, Math.ceil(p.atk * mult) - enemy.def);
            damageEnemy(enemy, dealt, p.sc.stealth > 0 ? 'CRIT' : 'backstab');
            applyLifesteal(dealt);
            p.sc.stealth = 0;
            onPlayerDealDamage(dealt);
            if (enemy.hp <= 0) defeatEnemy(enemy);
            else enemyAttack(enemy);
            finish();
            return;
        }
        case 'trickster': {
            if (p.sc.trapCharges <= 0) return addMessageAndUpdate('No trap charges remaining.');
            if (gameState.traps.some(t => t.x === p.x && t.y === p.y)) return addMessageAndUpdate('A trap is already here.');
            gameState.traps.push({ x: p.x, y: p.y });
            p.sc.trapCharges--;
            addBurst(p.x, p.y, '#aaa397');
            addMessage('You set a snare trap on the floor.');
            finish();
            return;
        }
        case 'shadow': {
            if (p.mana < 4) return addMessageAndUpdate('Not enough mana (4).');
            const enemy = findNearestEnemy();
            if (!enemy) return addMessageAndUpdate('No enemy to step toward.');
            const spots = [
                { x: enemy.x + 1, y: enemy.y }, { x: enemy.x - 1, y: enemy.y },
                { x: enemy.x, y: enemy.y + 1 }, { x: enemy.x, y: enemy.y - 1 }
            ].filter(s => isWalkable(s.x, s.y) && !findEnemyAt(s.x, s.y, 0) && !isPlayerAt(s.x, s.y));
            if (!spots.length) return addMessageAndUpdate('No space to shadow step.');
            const dest = spots.sort((a, b) => getDistance(a.x, a.y, enemy.x, enemy.y) - getDistance(b.x, b.y, enemy.x, enemy.y))[0];
            addBurst(p.x, p.y, '#9b7bd6');
            p.x = dest.x; p.y = dest.y;
            p.mana -= 4;
            revealAround(p.x, p.y, 4);
            addBurst(p.x, p.y, '#9b7bd6');
            addMessage('You shadow step through the dark.');
            finish();
            return;
        }
        case 'elementalist': {
            if (p.mana < 3) return addMessageAndUpdate('Not enough mana (3).');
            const enemy = findNearestEnemy();
            if (!enemy) return addMessageAndUpdate('No enemies in sight.');
            p.mana -= 3;
            const el = p.sc.element;
            p.sc.element = (el + 1) % 3;
            let dmg = 16 + p.level * 2;
            const elementNames = ['fire', 'ice', 'lightning'];
            const activeElement = elementNames[el];
            if (el === 0) { dmg += 4; applyStatus(enemy, 'burn', 3); addMessage('Fire scorches the foe!'); }
            else if (el === 1) { dmg = Math.ceil(dmg * 0.85); applyStatus(enemy, 'stun', 1); addMessage('Ice freezes the foe in place!'); }
            else { addMessage('Lightning arcs — striking a second target!'); const second = gameState.enemies.find(e => e !== enemy && gameState.revealed[e.y]?.[e.x] && getDistance(e.x, e.y, enemy.x, enemy.y) <= 3); if (second) damageEnemy(second, Math.floor(dmg * 0.6), 'fire'); }
            // Advertised "exploit elemental weaknesses for bonus damage"
            // trait — only slime (fire) and skeleton (lightning) have a
            // defined weakness (see ENEMY_TYPES); other enemy types
            // aren't elemental in nature, so giving them an arbitrary
            // weakness would feel unmotivated rather than thematic.
            const weakness = ENEMY_TYPES[enemy.type]?.elementWeakness;
            if (weakness && weakness === activeElement) {
                dmg = Math.ceil(dmg * 1.5);
                addFloatingText(enemy.x, enemy.y, 'WEAKNESS!', '#ffd65a', { style: 'crit-banner' });
                addMessage(`The ${enemy.name} is exposed — elemental weakness exploited!`);
            }
            damageEnemy(enemy, dmg, 'fire');
            applyLifesteal(dmg);
            onPlayerDealDamage(dmg);
            if (enemy.hp <= 0) defeatEnemy(enemy);
            else enemyAttack(enemy);
            finish();
            return;
        }
        case 'illusionist': {
            if (p.mana < 4) return addMessageAndUpdate('Not enough mana (4).');
            p.mana -= 4;
            gameState.decoy = { x: p.x, y: p.y, hp: Math.floor(p.maxHp * 0.4), turns: 3 };
            // Confusion spell — enemies near the cast point may turn on
            // each other (see the confuse status check in enemyTurn)
            // instead of just ignoring the decoy and beelining the player.
            const confused = gameState.enemies.filter(e => e.hp > 0 && getDistance(e.x, e.y, p.x, p.y) <= 3);
            confused.forEach(e => applyStatus(e, 'confuse', 3));
            // Mirror Image — a multi-turn damage-reduction buff layered on
            // top of the decoy, rather than a separate spell, since each
            // subclass only has the one castable ability slot.
            p.mirrorImageTurns = 3;
            addBurst(p.x, p.y, '#c49eff');
            const confuseNote = confused.length > 0 ? ' Nearby enemies reel in confusion!' : '';
            addMessage(`A phantom twin appears, drawing enemy attention!${confuseNote}`);
            finish();
            return;
        }
        case 'necromancer': {
            if (p.mana < 5) return addMessageAndUpdate('Not enough mana (5).');
            if (gameState.allies.length >= NECROMANCER_MINION_CAP) {
                // Advertised "drain life from your own minions to heal"
                // trait — repurposes what used to be a dead-end failure
                // ("you can only control 2 minions") into a genuine
                // choice: sacrifice your weakest minion (lowest
                // remaining lifespan) for a heal, rather than just
                // waiting for one to expire naturally.
                const weakest = gameState.allies.reduce((a, b) => (a.turns <= b.turns ? a : b));
                gameState.allies = gameState.allies.filter(a => a !== weakest);
                const heal = Math.ceil(weakest.maxHp * 0.6);
                p.hp = Math.min(p.maxHp, p.hp + heal);
                p.mana -= 5;
                addFloatingText(p.x, p.y, `+${heal}`, '#58c26d');
                addBurst(weakest.x, weakest.y, '#9c6dff');
                addMessage(`You drain your skeleton minion's remaining life, restoring ${heal} HP.`);
                finish();
                return;
            }
            const spot = findRandomOpenTile(1) || { x: p.x, y: p.y };
            p.mana -= 5;
            gameState.allies.push({ x: spot.x, y: spot.y, hp: 20 + p.level * 3, maxHp: 20 + p.level * 3, atk: 6 + p.level, turns: 6, type: 'skeleton' });
            addBurst(spot.x, spot.y, '#b06fff');
            // Bone shields from nearby corpses — a recent kill (tracked in
            // gameState.fallenEnemies, capped at the last 10) provides the
            // raw material for a defensive ward layered on top of the
            // minion summon. Consumes the corpse so the same kill can't
            // fuel multiple shields back to back; with no recent corpse
            // available the cast still raises a minion, it just doesn't
            // also grant the shield.
            const corpse = gameState.fallenEnemies?.pop();
            if (corpse) {
                p.boneShieldTurns = 4;
                p.boneShieldDef = 4 + Math.floor(p.level / 3);
                recalculateStats();
                addBurst(p.x, p.y, '#d8d4ca');
                addMessage(`A skeleton minion rises, and the ${corpse.name}'s bones knit into a protective ward!`);
            } else {
                addMessage('A skeleton minion rises to fight for you!');
            }
            finish();
            return;
        }
        case 'warDomain': {
            if (p.mana < 3) return addMessageAndUpdate('Not enough mana (3).');
            const enemy = findEnemyAt(p.x, p.y, 1);
            if (!enemy) return addMessageAndUpdate('Smite requires an adjacent foe.');
            p.mana -= 3;
            const dealt = Math.max(1, Math.ceil(p.atk * 1.8) + 8 - enemy.def);
            damageEnemy(enemy, dealt, 'fire');
            applyLifesteal(dealt);
            onPlayerDealDamage(dealt);
            if (enemy.hp <= 0) defeatEnemy(enemy);
            else enemyAttack(enemy);
            // War Cry — stuns every OTHER adjacent enemy (the primary
            // target already ate Smite's damage instead). Folded into
            // the same cast rather than a separate ability slot, same
            // convention as every other subclass's single-ability kit.
            const adjacentOthers = gameState.enemies.filter(e =>
                e !== enemy && e.hp > 0 && getDistance(e.x, e.y, p.x, p.y) <= 1);
            adjacentOthers.forEach(e => applyStatus(e, 'stun', 1));
            addMessage(adjacentOthers.length > 0
                ? 'Divine smite crashes into your foe — your war cry staggers the others!'
                : 'Divine smite crashes into your foe!');
            finish();
            return;
        }
        case 'lightDomain': {
            if (p.mana < 4) return addMessageAndUpdate('Not enough mana (4).');
            const enemy = findNearestEnemy();
            if (!enemy) return addMessageAndUpdate('No visible target for Searing Light — walls block the beam.');
            p.mana -= 4;
            const dealt = Math.max(1, 14 + p.level * 2 - enemy.def);
            damageEnemy(enemy, dealt, 'fire');
            applyStatus(enemy, 'stun', 1);
            applyLifesteal(dealt);
            onPlayerDealDamage(dealt);
            if (enemy.hp <= 0) defeatEnemy(enemy);
            else enemyAttack(enemy);
            // Advertised "heals restore more HP and can briefly overheal"
            // trait. Searing Light previously had no direct heal
            // component at all (only the same shared lifesteal every
            // class gets), so there was nothing for the bonus to apply
            // to. Overheal is tracked as a separate temporary shield
            // pool (p.overheal) rather than pushing hp above maxHp
            // directly — much lower risk than touching every existing
            // Math.min(maxHp, ...) clamp across the codebase for the
            // same player-facing effect, and ties in cleanly with
            // onPlayerTakeDamage()/tickStatuses() to decay on its own.
            const heal = 10 + p.level * 2;
            const room = p.maxHp - p.hp;
            const directHeal = Math.min(room, heal);
            const spillover = heal - directHeal;
            p.hp += directHeal;
            if (spillover > 0) {
                const cap = Math.ceil(p.maxHp * 0.15);
                p.overheal = Math.min(cap, (p.overheal || 0) + spillover);
                p.overhealTurns = 4;
            }
            addFloatingText(p.x, p.y, `+${heal}`, '#fff3b0');
            addMessage(`Holy light sears the enemy and mends your wounds for ${heal} HP.`);
            finish();
            return;
        }
        case 'twilightDomain': {
            if (p.mana < 3) return addMessageAndUpdate('Not enough mana (3).');
            const enemy = findEnemyAt(p.x, p.y, 1) || findNearestEnemy();
            if (!enemy) return addMessageAndUpdate('No target for Moonbeam.');
            p.mana -= 3;
            const dealt = Math.max(1, Math.ceil(p.atk * 1.4) - enemy.def);
            damageEnemy(enemy, dealt, 'hit');
            applyStatus(enemy, 'weaken', 2);
            const heal = Math.ceil(dealt * 0.5);
            p.hp = Math.min(p.maxHp, p.hp + heal);
            addFloatingText(p.x, p.y, `+${heal}`, '#58c26d');
            applyLifesteal(dealt);
            onPlayerDealDamage(dealt);
            if (enemy.hp <= 0) defeatEnemy(enemy);
            else enemyAttack(enemy);
            addMessage(`Moonbeam drains the foe, restoring ${heal} HP and sapping its strength.`);
            finish();
            return;
        }
        default:
            p.useLegacyAbility();
            return;
    }
}


class Player {
    constructor(className, subclassId = null, characterName = '', gender = 'm') {
        this.className = className;
        this.subclass = subclassId;
        this.name = characterName;
        this.gender = gender; // 'm' or 'f' — cosmetic only, used for portrait art
        // Base class stats (includes the ability name)
        Object.assign(this, CLASSES[className]);
        // Subclass overrides hp/atk/def/mana stats
        if (subclassId) {
            const scDef = (SUBCLASSES[className] || []).find(s => s.id === subclassId);
            if (scDef) Object.assign(this, scDef.stats);
        }
        this.baseAtk = this.atk;
        this.baseDef = this.def;
        this.x = 12;
        this.y = 10;
        this.renderX = this.x * TILE_SIZE;
        this.renderY = this.y * TILE_SIZE;
        this.level = 1;
        this.xp = 0;
        this.gold = 0;
        this.inventory = [{ type: 'potion', name: 'Health Potion', qty: gameState.tavernUpgrades.stockedPantry ? 3 : 2 }];
        // Hearthstone Coins — consumable return-to-tavern tokens for non-casters
        // (warriors, rogues). Mages/clerics use the Town Portal spell instead.
        this.hearthstoneCoins = 0;
        this.equipment = createEmptyEquipment();
        this.relics = [];       // equipped relics, max RELIC_MAX_SLOTS
        this.relicPouch = [];   // benched/unequipped relics, separate from inventory
        this.shieldActive = false;
        this.levelCritBonus = 0;
        this.levelLifestealBonus = 0;
        this.critChance = subclassId === 'assassin' ? 40 : (className === 'rogue' ? 30 : 0);
        this.lifesteal = 0;
        this.goldFind = 0;
        this.thorns = 0;
        this.manaRegenBonus = 0;
        this.statuses = [];   // { type: 'poison'|'burn'|'stun'|'weaken', turns }
        this.overheal = 0;       // Light Domain temporary shield pool (see Searing Light)
        this.overhealTurns = 0;  // turns remaining before it decays to 0
        this.mirrorImageTurns = 0; // Illusionist Mirror Image duration (see enemyAttack)
        this.boneShieldTurns = 0;  // Necromancer bone shield duration (see recalculateStats)
        this.boneShieldDef = 0;    // DEF bonus granted while the shield is active
        this.cellarRushFloor = null; // floor Adrenaline Rush was granted on (see CELLAR_FIND_CHOICES); cleared on floor change
        this.attackAnim = null;
        this.lungeAnim = null; // universal attack-step animation, all classes (see Player.attack)
        this.facingLeft = false; // sprite facing direction, set from horizontal movement input (see move())
        this.hitFlash = 0;
        initSubclassState(this);
    }

    move(dx, dy) {
        if (gameState.gameOver || gameState.awaitingLevelChoice || gameState.shopOpen || gameState.gamblingOpen || gameState.brewmasterOpen || gameState.questBoardOpen || gameState.bardOpen || gameState.stashOpen || gameState.magicDealerOpen || gameState.blacksmithOpen || gameState.trainerOpen || gameState.bankOpen || gameState.innOpen || gameState.tavernConfirmOpen || gameState.ringChoiceOpen || gameState.cellarFindOpen || gameState.spellbookOpen) return;

        // Sprite facing direction — set from horizontal input regardless
        // of whether this move actually succeeds (an NPC-blocked or
        // wall-blocked attempt still visually faces the tried direction).
        // Vertical-only input (dx === 0) deliberately leaves facing
        // unchanged rather than resetting it, so walking straight up or
        // down doesn't flip the sprite back to a default direction.
        if (dx < 0) this.facingLeft = true;
        else if (dx > 0) this.facingLeft = false;

        // Stun check
        if (hasStatus(this, 'stun')) {
            addMessage('You are stunned and cannot move!');
            // Still run enemy turn so time passes
            this.regenMana();
            enemyTurn();
            updateUI();
            return;
        }

        const newX = this.x + dx;
        const newY = this.y + dy;

        // Tavern-interior NPC bump triggers.
        // Guard: these NPCs only exist in the tavern interior — their gameState
        // coordinates are stale when the player is in the courtyard or town,
        // where the dungeon grid has been swapped to a different layout.
        // Without this guard, walking to a courtyard/town tile that happens to
        // share x,y with an interior NPC (e.g. bard at 4,6) wrongly opens that
        // NPC's panel.  interactInTavern() already has this guard; this mirrors it.
        if (gameState.floor === 0 && !gameState.inCourtyard && !gameState.inTown) {
            if (newX === gameState.innkeeper.x && newY === gameState.innkeeper.y) {
                talkToBartender();
                return;
            }
            if (newX === gameState.merchant.x && newY === gameState.merchant.y) {
                openShop();
                return;
            }
            if (newX === gameState.blacksmith.x && newY === gameState.blacksmith.y) {
                openBlacksmith();
                return;
            }
            if (newX === gameState.trainer.x && newY === gameState.trainer.y) {
                openTrainer();
                return;
            }
            if (newX === gameState.bank.x && newY === gameState.bank.y) {
                openBank();
                return;
            }
            if (newX === gameState.gambler.x && newY === gameState.gambler.y) {
                openGambling();
                return;
            }
            if (newX === gameState.brewmaster.x && newY === gameState.brewmaster.y) {
                openBrewmaster();
                return;
            }
            if (newX === gameState.questBoard.x && newY === gameState.questBoard.y) {
                openNoticeBoard();
                return;
            }
            if (newX === gameState.bard.x && newY === gameState.bard.y) {
                openBard();
                return;
            }
            if (newX === gameState.stashChest.x && newY === gameState.stashChest.y) {
                openStash();
                return;
            }
            if (newX === gameState.magicDealer.x && newY === gameState.magicDealer.y) {
                openMagicDealer();
                return;
            }
        }

        // Town NPCs — only active when inTown
        if (gameState.floor === 0 && gameState.inTown) {
            if (newX === gameState.townStorekeeper.x && newY === gameState.townStorekeeper.y) { openTownStore(); return; }
            if (newX === gameState.townTemple.x      && newY === gameState.townTemple.y)      { openTownTemple(); return; }
            if (newX === gameState.townAlchemist.x   && newY === gameState.townAlchemist.y)   { openTownAlchemist(); return; }
            if (newX === gameState.townHall.x        && newY === gameState.townHall.y)        { openTownHall(); return; }
        }

        // Overland zone features (forage/merchant/event) — only in a generated
        // world zone (forest/road), not the courtyard/town/arena. Bumping a
        // feature tile interacts with it instead of moving onto it.
        if (gameState.floor === 0 && !gameState.inCourtyard && !gameState.inTown && !gameState.inArena
            && Array.isArray(gameState.zoneFeatures) && gameState.zoneFeatures.length) {
            const feat = gameState.zoneFeatures.find(f => f.x === newX && f.y === newY && !f.used && f.kind !== 'ambush');
            if (feat && typeof interactZoneFeature === 'function') {
                interactZoneFeature(feat);
                return;
            }
        }

        const enemy = findEnemyAt(newX, newY, 0);
        if (enemy) {
            this.attack(enemy);
            return;
        }

        if (!isWalkable(newX, newY)) return;

        this.x = newX;
        this.y = newY;
        revealAround(this.x, this.y, 4);
        sfxFootstep();
        if (gameState.runStats) gameState.runStats.turnsPlayed = (gameState.runStats.turnsPlayed || 0) + 1;
        collectItemAt(newX, newY);
        checkWorldDiscovery(newX, newY);
        // Overland ambush: stepping onto (or adjacent to) an un-sprung ambush
        // tile triggers a fight in the zone.
        if (gameState.floor === 0 && !gameState.inCourtyard && !gameState.inTown && !gameState.inArena
            && typeof triggerZoneAmbush === 'function') {
            triggerZoneAmbush(newX, newY);
        }
        if (gameState.floor === 0) {
            triggerNpcProximityLine('innkeeper', isAdjacentToInnkeeper());
            triggerNpcProximityLine('merchant', isAdjacentToMerchant());
            triggerNpcProximityLine('blacksmith', isAdjacentToBlacksmith());
        }
        if (this.subclass === 'knight' && this.sc) {
            this.sc.block = Math.min(100, this.sc.block + 25);
        }
        checkInteractions();

        if ((gameState.floor > 0 || gameState.inArenaBout || gameState.inZoneCombat) && !gameState.awaitingLevelChoice) {
            triggerTrapAt(newX, newY);
            this.regenMana();
            enemyTurn();
            // Zone combat ends when the ambush is cleared.
            if (gameState.inZoneCombat && gameState.enemies.length === 0) {
                gameState.inZoneCombat = false;
                addMessage('The ambush is broken. The road is quiet again.');
            }
        }

        updateUI();
    }

    attack(targetEnemy = null) {
        if (gameState.gameOver || gameState.awaitingLevelChoice || gameState.shopOpen || gameState.gamblingOpen || gameState.brewmasterOpen || gameState.questBoardOpen || gameState.bardOpen || gameState.stashOpen || gameState.magicDealerOpen || gameState.blacksmithOpen || gameState.trainerOpen || gameState.bankOpen || gameState.innOpen || gameState.cellarFindOpen) return;

        // During an arena bout or an overland ambush, floor is still 0 but we
        // want real combat, not the tavern NPC interaction that floor===0
        // normally routes to.
        if (gameState.floor === 0 && !gameState.inArenaBout && !gameState.inZoneCombat) {
            interactInTavern();
            return;
        }

        const enemy = targetEnemy || findEnemyAt(this.x, this.y, 1);
        if (!enemy) {
            addMessage('There is nothing close enough to strike.');
            updateUI();
            return;
        }

        let damage = this.atk;
        if (this.subclass === 'berserker') damage = applyBerserkerBonuses(this, damage);
        if (this.subclass === 'gladiator' && this.sc?.combo) damage += this.sc.combo * 2;
        // Gladiator's advertised "Bonus damage against stunned enemies"
        // trait — multiplicative on top of the combo-stack bonus above,
        // since the two are advertised as separate traits rather than
        // one replacing the other. "The crowd demands blood" reads as
        // punishing an opponent that can't fight back, so this only
        // checks the target's own stun, not the player's.
        if (this.subclass === 'gladiator' && hasStatus(enemy, 'stun')) damage = Math.ceil(damage * 1.5);
        // War Domain's advertised "Divine Strike bonus applies on every
        // melee hit" trait — a small flat bonus on every regular attack,
        // separate from (and deliberately smaller than) the dedicated
        // Smite ability's own +8 burst bonus, so the passive complements
        // rather than competes with the active ability.
        if (this.subclass === 'warDomain') {
            damage += 3;
            // Blessed Rage: ATK bonus grows below half HP. Stacks on top
            // of the flat Divine Strike bonus above rather than replacing
            // it (they're advertised as two separate traits), and only
            // applies to regular melee attacks — Smite already has its
            // own fixed +8 burst and isn't meant to scale further with
            // missing HP on top of that.
            const ratio = this.hp / this.maxHp;
            if (ratio < 0.5) damage = Math.ceil(damage * (1 + (0.5 - ratio) * 0.8));
        }
        let crit = false;
        if (rng() * 100 < this.critChance) {
            damage = Math.ceil(damage * 1.5);
            crit = true;
        }
        if (hasStatus(this, 'rage')) damage = Math.ceil(damage * 1.5);

        const dealt = Math.max(1, damage - enemy.def);
        sfxAttack();
        // Universal attack lunge — every class steps toward its target on
        // a hit, mirroring the enemy lunge added in combat.js. Kept
        // separate from attackAnim below, which is Berserker's own
        // claw-slash visual effect and stays exclusive to that subclass
        // rather than being repurposed as the generic lunge for everyone.
        this.lungeAnim = { life: 10, maxLife: 10, dx: Math.sign(enemy.x - this.x), dy: Math.sign(enemy.y - this.y) };
        if (this.subclass === 'berserker') {
            this.attackAnim = { life: 16, maxLife: 16 };
        }
        damageEnemy(enemy, dealt, crit ? 'CRIT' : 'hit');
        applyLifesteal(dealt);
        onPlayerDealDamage(dealt);
        // Elemental weapon on-hit effect (Fire burn / Frost freeze / Lightning
        // chain+stun). Applied after the base hit so it can't change this hit's
        // damage, only follow-on effects. Guarded inside so non-elemental
        // weapons are a cheap no-op.
        applyWeaponElementOnHit(enemy, dealt);
        if (!crit) addMessage(`You hit the ${enemy.name} for ${dealt} damage.`);
        // Light Domain's advertised "Critical hits blind enemies for 1
        // turn" trait — applied after damageEnemy so it can't affect
        // this hit's own damage, only the enemy's next attack (read in
        // enemyAttack's effectiveAtk calc).
        if (crit && this.subclass === 'lightDomain' && enemy.hp > 0) {
            applyStatus(enemy, 'blind', 1);
            addFloatingText(enemy.x, enemy.y, 'BLINDED!', '#fff7d6');
        }

        if (enemy.hp <= 0) {
            defeatEnemy(enemy);
        } else {
            enemyAttack(enemy);
        }

        // During an overland ambush, the rest of the pack acts too (in the
        // dungeon this is handled by the move/turn loop; here we drive it
        // explicitly), and the ambush ends once every foe is down.
        if (gameState.inZoneCombat) {
            if (gameState.enemies.length === 0) {
                gameState.inZoneCombat = false;
                addMessage('The ambush is broken. The road is quiet again.');
            } else {
                enemyTurn();
                if (gameState.enemies.length === 0) {
                    gameState.inZoneCombat = false;
                    addMessage('The ambush is broken. The road is quiet again.');
                }
            }
        }

        this.regenMana();
        refreshEnemyIntents();
        updateUI();
    }

    useAbility() {
        if (gameState.gameOver || gameState.awaitingLevelChoice) return;

        if (gameState.floor === 0 && !gameState.inArenaBout && !gameState.inZoneCombat) {
            interactInTavern();
            return;
        }

        if (this.subclass && SUBCLASS_ABILITIES[this.subclass]) {
            useSubclassAbility();
            return;
        }
        this.useLegacyAbility();
    }

    useLegacyAbility() {
        // Base Mage and Cleric (no subclass) now open the Spellbook menu to
        // choose which spell to cast, instead of auto-casting a single one.
        // Subclassed casters keep their signature ability (handled upstream
        // in useAbility before this is ever reached).
        if (this.className === 'mage' || this.className === 'cleric') {
            openSpellbook();
            return;
        }
        if (this.className === 'warrior') {
            this.shieldActive = true;
            addBurst(this.x, this.y, '#ffd65a');
            addMessage('Shield Block is ready for the next hit.');
            enemyTurn();
        } else if (this.className === 'rogue') {
            const enemy = findEnemyAt(this.x, this.y, 1);
            if (!enemy) return addMessageAndUpdate('Backstab needs an adjacent target.');
            const dealt = Math.max(1, Math.ceil(this.atk * 2.2) - enemy.def);
            damageEnemy(enemy, dealt, 'backstab');
            applyLifesteal(dealt);
            if (rng() < 0.4) {
                applyStatus(enemy, 'stun', 1);
                addMessage(`Backstab lands for ${dealt} damage and stuns the ${enemy.name}!`);
            } else {
                addMessage(`Backstab lands for ${dealt} damage.`);
            }
            if (enemy.hp <= 0) defeatEnemy(enemy);
            else enemyAttack(enemy);
        }

        refreshEnemyIntents();
        updateUI();
    }

    gainXp(amount) {
        this.xp += amount;
        addFloatingText(this.x, this.y, `+${amount} XP`, '#ffd65a', { style: 'xp', offsetY: 14 });

        // A single large XP gain (e.g. a high-floor boss kill) can justify
        // more than one level-up — this used to be a plain `if`, so a
        // 500-XP burst at level 1 only ever leveled up once and silently
        // discarded the rest of the XP's value toward the next threshold.
        // Each level still gets its own choice prompt (queued one at a
        // time) rather than silently auto-picking bonuses for the player.
        let levelsGained = 0;
        let needed = getXpToLevel();
        while (this.xp >= needed) {
            this.xp -= needed;
            this.level++;
            this.hp = this.maxHp;
            this.mana = this.maxMana;
            levelsGained++;
            needed = getXpToLevel();
        }
        if (levelsGained > 0) {
            // Guaranteed small ATK trickle on every level, independent of
            // the level-up choice below. Previously ATK only grew via a
            // 1-in-5 (or 1-in-6 with mana) RNG choice or weapon gear,
            // while DEF effectively grew faster — 4 armor slots' worth of
            // gear bonus vs. 1 weapon slot, plus its own choice option.
            // Accumulated as a fraction so it still totals +3 every 5
            // levels on average rather than rounding away to nothing.
            this._atkTrickleAccum = (this._atkTrickleAccum || 0) + levelsGained * 0.6;
            const wholeTrickle = Math.floor(this._atkTrickleAccum);
            if (wholeTrickle > 0) {
                this.baseAtk += wholeTrickle;
                this._atkTrickleAccum -= wholeTrickle;
                recalculateStats();
            }
            gameState.pendingLevelChoices = (gameState.pendingLevelChoices || 0) + levelsGained - 1;
            gameState.awaitingLevelChoice = true;
            sfxLevelUp();
            showLevelChoices();
        }
    }

    equip(item) {
        item.slot = normalizeGearSlot(item.slot);
        const previous = this.equipment[item.slot];
        if (previous && previous.cursed && gameState.floor > 0 && gameState.enemies.length > 0) {
            addMessage(`${previous.identified ? previous.name : '?? Item'} is cursed — clear the floor first!`);
            return;
        }
        this.equipment[item.slot] = item;
        if (previous) addItemToInventory(previous);
        recalculateStats();
        const displayName = (item.cursed && !item.identified) ? '?? Item' : item.name;
        addMessage(`Equipped ${displayName}.`);
    }

    regenMana() {
        if (this.maxMana > 0 && this.mana < this.maxMana) {
            this.mana = Math.min(this.maxMana, this.mana + 1 + (this.manaRegenBonus || 0));
        }
    }
}


class Enemy {
    constructor(x, y, type = 'goblin') {
        const template = ENEMY_TYPES[type];
        this.x = x;
        this.y = y;
        this.type = type;
        this.name = template.name;
        this.color = template.color;
        this.glyph = template.glyph;
        this.range = template.range;
        this.xp = template.xp;
        this.hp = template.hp + gameState.floor * (type === 'boss' ? 10 : 4);
        this.maxHp = this.hp;
        // Boss ATK scaled at 2x the rate of regular enemies and of player
        // DEF growth (gear bonus is ~floor/3 per slot, def levels are
        // gated behind a 1-in-5 level-up roll) — by floor 100 that left
        // bosses able to kill a well-geared player in ~1-4 hits while
        // still taking 60-100+ hits to bring down. Dropped to 1.1x: still
        // the steepest-scaling enemy type (regular enemies are 1x), just
        // not double, so boss fights stay the hardest fights in the game
        // without being unwinnable even with strong gear.
        this.atk = template.atk + Math.ceil(gameState.floor * (type === 'boss' ? 1.1 : 1));
        this.def = template.def + Math.floor(gameState.floor / 2);
        this.flash = 0;
        this.hitFlash = 0;
        this.statuses = [];
        this.intent = null;
        // Boss-specific fields
        this.bossVariant = null;
        this.bossPhase = 'normal';   // for sentinel: 'armored' | 'vulnerable'
        this.bossTurnCounter = 0;
        this.splitDone = false;
        this.immuneToStun = (type === 'warden' || type === 'orc'); // wardens and orcs shrug off stun
        this.fireImmune = (type === 'demon'); // demons are immune to burn — matches lore
        // Tracks whether the player took zero damage from this boss encounter —
        // used for the Flawless Victory achievement (see ui.js checkAchievements).
        // Set to true when a boss spawns (dungeon.js), cleared to false by
        // onPlayerTakeDamage when the boss lands a hit. Initialized here so
        // save/load and non-boss enemies all start with a defined value.
        this.tookNoDamage = false;
        // Smoothly-interpolated draw position, mirroring Player's
        // renderX/renderY — previously enemies only had logical grid x/y
        // and snapped instantly between tiles on every move (see the lerp
        // toward x*TILE_SIZE/y*TILE_SIZE in the per-frame update loop in
        // render.js, the same one the player already used).
        this.renderX = x * TILE_SIZE;
        this.renderY = y * TILE_SIZE;
        // Attack lunge state, mirroring Player's attackAnim — set when
        // this enemy lands a hit (see enemyAttack in combat.js), decayed
        // in the same per-frame loop as the player's.
        this.attackAnim = null;
    }

    applyVariant(variantKey) {
        const v = BOSS_VARIANTS[variantKey];
        if (!v) return;
        this.bossVariant = variantKey;
        this.name = v.name;
        this.color = v.color;
        this.glyph = v.glyph;
        if (variantKey === 'sentinel') {
            this.bossPhase = 'armored';
            this.color = '#a8c8e8';
        }
        if (variantKey === 'wraith') {
            this.immuneToStun = true;
            this.range = 3;
        }
    }
}


// ── Spellbook system ────────────────────────────────────────────────────────
// Base Mage and Cleric choose a spell from a menu each cast. Spells unlock by
// level (see SPELLBOOK in data.js). The menu is opened from useLegacyAbility;
// selection routes to castSpell(), which spends mana, resolves the effect, and
// advances the enemy turn exactly as the old single-ability cast did.

// Returns the spells the current caster has unlocked at their level.
function getAvailableSpells() {
    const p = gameState.player;
    if (!p) return [];
    const book = SPELLBOOK[p.className];
    if (!book) return [];
    return book.filter(sp => p.level >= sp.unlockLevel);
}

// Opens the spell-selection overlay. If there are no enemies and every
// unlocked spell needs a target, we still allow opening (self spells like Heal
// are always castable), so the menu is always useful.
function openSpellbook() {
    const p = gameState.player;
    if (!p || gameState.gameOver) return;
    if (gameState.floor === 0 && !gameState.inArenaBout) return; // no combat magic in the tavern
    gameState.spellbookOpen = true;
    if (typeof renderSpellbook === 'function') renderSpellbook();
    updateUI();
}

function closeSpellbook() {
    gameState.spellbookOpen = false;
    const panel = document.getElementById('spellbook-panel');
    if (panel) panel.style.display = 'none';
    updateUI();
}

// Cast the chosen spell by id. Validates mana + target, applies the effect,
// then ends the player's turn (enemyTurn) just like the legacy abilities did.
function castSpell(spellId) {
    const p = gameState.player;
    if (!p || gameState.gameOver) return;
    const book = SPELLBOOK[p.className] || [];
    const spell = book.find(s => s.id === spellId);
    if (!spell) return;
    if (p.level < spell.unlockLevel) return;

    if (p.mana < spell.mana) {
        addMessageAndUpdate(`Not enough mana for ${spell.name} (need ${spell.mana}).`);
        return;
    }

    // Resolve target for enemy-targeted spells before spending mana, so a
    // mis-cast with no valid target doesn't waste the player's mana or turn.
    let target = null;
    if (spell.target === 'enemy') {
        target = findNearestEnemy();
        if (!target) { addMessageAndUpdate(`No visible target for ${spell.name}.`); return; }
    }

    p.mana -= spell.mana;
    closeSpellbook();

    // Utility spells (Town Portal) leave the dungeon entirely — they must NOT
    // run enemyTurn() afterward (there's no dungeon to take a turn in) and
    // handle their own scene transition.
    if (spell.target === 'utility') {
        const handler = SPELL_EFFECTS[spellId];
        if (handler) handler(p, null, spell);
        return;
    }

    // Dispatch to the specific spell effect.
    const handler = SPELL_EFFECTS[spellId];
    if (handler) {
        handler(p, target, spell);
    } else {
        addMessage(`${spell.name} fizzles — unknown spell.`);
    }

    // End the player's turn. Damage spells that killed their target already
    // called defeatEnemy inside the handler; enemyTurn is still correct to run
    // (it simply finds no living target there).
    if (!gameState.gameOver) enemyTurn();
    refreshEnemyIntents();
    updateUI();
}

// Individual spell effects. Each receives (player, target, spellDef). Damage
// scales off level so spells stay relevant deep in the dungeon.
const SPELL_EFFECTS = {
    // ── Mage ──
    fireball(p, enemy) {
        const dmg = 20 + p.level * 2;
        damageEnemy(enemy, dmg, 'fire');
        applyLifesteal(dmg);
        applyStatus(enemy, 'burn', 3);
        addBurst(enemy.x, enemy.y, '#ff9f58');
        addMessage(`Fireball scorches the ${enemy.name} for ${dmg}. (burning 3 turns)`);
        if (enemy.hp <= 0) defeatEnemy(enemy);
    },
    frostbolt(p, enemy) {
        const dmg = 16 + p.level * 2;
        damageEnemy(enemy, dmg, 'fire');
        applyLifesteal(dmg);
        applyStatus(enemy, 'freeze', 1);
        addBurst(enemy.x, enemy.y, '#7fd8ff');
        addFloatingText(enemy.x, enemy.y, 'FROZEN!', '#7fd8ff');
        addMessage(`Frost Bolt hits the ${enemy.name} for ${dmg} and freezes it solid.`);
        if (enemy.hp <= 0) defeatEnemy(enemy);
    },
    arcane_missile(p, enemy) {
        const dmg = 14 + p.level * 2;
        damageEnemy(enemy, dmg, 'hit');
        applyLifesteal(dmg);
        addBurst(enemy.x, enemy.y, '#c49eff');
        addMessage(`Arcane Missile strikes the ${enemy.name} for ${dmg}.`);
        if (enemy.hp <= 0) defeatEnemy(enemy);
    },
    chain_lightning(p, enemy) {
        const dmg = 18 + p.level * 2;
        damageEnemy(enemy, dmg, 'fire');
        applyLifesteal(dmg);
        addBurst(enemy.x, enemy.y, '#ffe14d');
        addFloatingText(enemy.x, enemy.y, `⚡${dmg}`, '#ffe14d');
        addMessage(`Chain Lightning blasts the ${enemy.name} for ${dmg}.`);
        if (enemy.hp <= 0) defeatEnemy(enemy);
        // Arc to up to two more nearby enemies for reduced damage
        let lastX = enemy.x, lastY = enemy.y, hops = 0;
        const hit = new Set([enemy]);
        while (hops < 2) {
            const next = gameState.enemies.find(o =>
                !hit.has(o) && o.hp > 0 && gameState.revealed?.[o.y]?.[o.x] &&
                getDistance(o.x, o.y, lastX, lastY) <= 3);
            if (!next) break;
            const arcDmg = Math.max(1, Math.floor(dmg * 0.6));
            damageEnemy(next, arcDmg, 'fire');
            addBurst(next.x, next.y, '#ffe14d');
            addFloatingText(next.x, next.y, `⚡${arcDmg}`, '#ffe14d');
            if (next.hp <= 0) defeatEnemy(next);
            hit.add(next); lastX = next.x; lastY = next.y; hops++;
        }
        if (hops > 0) addMessage(`The bolt arcs to ${hops} more ${hops === 1 ? 'enemy' : 'enemies'}!`);
    },
    meteor(p) {
        const dmg = 16 + p.level * 2;
        const targets = gameState.enemies.filter(e => e.hp > 0 && gameState.revealed?.[e.y]?.[e.x]);
        if (!targets.length) { addMessage('The meteor crashes into empty stone.'); return; }
        targets.forEach(e => {
            damageEnemy(e, dmg, 'fire');
            applyStatus(e, 'burn', 2);
            addBurst(e.x, e.y, '#ff7a2f');
            if (e.hp <= 0) defeatEnemy(e);
        });
        addMessage(`A meteor smashes down, hitting ${targets.length} enemies for ${dmg} each!`);
        if (typeof addCombatShake === 'function') addCombatShake(18);
    },
    mana_shield(p) {
        // Convert remaining mana into an overheal-style ward (reuses the
        // overheal pool that Light Domain already uses, so it decays cleanly).
        const ward = 8 + p.level * 3;
        p.overheal = Math.min(Math.ceil(p.maxHp * 0.4), (p.overheal || 0) + ward);
        p.overhealTurns = 5;
        addFloatingText(p.x, p.y, `+${ward} ward`, '#7fd8ff');
        addBurst(p.x, p.y, '#7fd8ff');
        addMessage(`Mana Shield surrounds you — ${ward} damage absorbed.`);
    },

    // ── Cleric ──
    heal(p) {
        const heal = Math.floor(p.maxHp * 0.35);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        addFloatingText(p.x, p.y, `+${heal}`, '#58c26d');
        addBurst(p.x, p.y, '#58c26d');
        addMessage(`You heal for ${heal} HP.`);
    },
    smite(p, enemy) {
        const dmg = 16 + p.level * 2;
        damageEnemy(enemy, dmg, 'fire');
        applyLifesteal(dmg);
        addBurst(enemy.x, enemy.y, '#fff3b0');
        addFloatingText(enemy.x, enemy.y, 'SMITE', '#fff3b0');
        addMessage(`Holy light smites the ${enemy.name} for ${dmg}.`);
        if (enemy.hp <= 0) defeatEnemy(enemy);
    },
    renew(p) {
        // Apply a regen buff: heal over the next several turns. Tracked on the
        // player and ticked in tickStatuses via a 'renew' status with healing.
        applyStatus(p, 'renew', 4);
        addFloatingText(p.x, p.y, 'Renew', '#9fe6b0');
        addBurst(p.x, p.y, '#9fe6b0');
        addMessage('A renewing light knits your wounds over the next 4 turns.');
    },
    holy_nova(p) {
        const dmg = 14 + p.level * 2;
        const targets = gameState.enemies.filter(e => e.hp > 0 && gameState.revealed?.[e.y]?.[e.x]);
        targets.forEach(e => {
            damageEnemy(e, dmg, 'fire');
            addBurst(e.x, e.y, '#fff3b0');
            if (e.hp <= 0) defeatEnemy(e);
        });
        const heal = 10 + p.level * 2;
        p.hp = Math.min(p.maxHp, p.hp + heal);
        addFloatingText(p.x, p.y, `+${heal}`, '#58c26d');
        addBurst(p.x, p.y, '#fff3b0');
        addMessage(`Holy Nova erupts — ${targets.length} enemies seared, you heal ${heal} HP.`);
    },
    sanctuary(p) {
        // Stun adjacent enemies and grant a ward.
        const adj = gameState.enemies.filter(e => e.hp > 0 &&
            getDistance(e.x, e.y, p.x, p.y) <= 1);
        adj.forEach(e => { applyStatus(e, 'stun', 1); addFloatingText(e.x, e.y, 'Stunned', '#ffd65a'); });
        const ward = 10 + p.level * 2;
        p.overheal = Math.min(Math.ceil(p.maxHp * 0.4), (p.overheal || 0) + ward);
        p.overhealTurns = 4;
        addFloatingText(p.x, p.y, 'Sanctuary', '#fff3b0');
        addBurst(p.x, p.y, '#fff3b0');
        addMessage(`Sanctuary flares — ${adj.length} foes stunned, ${ward} damage warded.`);
    },
    condemn(p, enemy) {
        const dmg = 18 + p.level * 2;
        damageEnemy(enemy, dmg, 'fire');
        applyLifesteal(dmg);
        applyStatus(enemy, 'weaken', 3);
        addBurst(enemy.x, enemy.y, '#d08aff');
        addFloatingText(enemy.x, enemy.y, 'CONDEMNED', '#d08aff');
        addMessage(`Condemn sears the ${enemy.name} for ${dmg} and weakens it.`);
        if (enemy.hp <= 0) defeatEnemy(enemy);
    },
    // ── Utility ──
    town_portal(p) {
        // Open a portal to the tavern, banking the current floor so the player
        // can return to this exact floor (restored from floorCache) later.
        addBurst(p.x, p.y, '#9d7bff');
        addFloatingText(p.x, p.y, 'PORTAL', '#9d7bff');
        addMessage('A swirling portal opens. You step through to The Broken Flagon.');
        if (typeof portalToTavern === 'function') portalToTavern();
    },
};
