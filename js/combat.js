
// ── Enemy intent prediction ───────────────────────────────────────────────────

function calcEnemyDamage(enemy, intentLabel) {
    const p = gameState.player;
    const weakened = hasStatus(p, 'weaken');
    const effectiveDef = weakened ? Math.max(0, p.def - 3) : p.def;
    if (intentLabel === 'Slam')              return Math.max(1, Math.floor(enemy.atk * 1.8) - effectiveDef);
    // Orc charge: 2.0× multiplier matches the actual damage dealt in enemyTurn().
    // Without this, the intent tooltip showed normal ATK instead of the real hit.
    if (intentLabel === 'CHARGE' || intentLabel === 'charge') return Math.max(1, Math.floor(enemy.atk * 2.0) - effectiveDef);
    return Math.max(1, enemy.atk - effectiveDef);
}


function formatIntentName(enemy) {
    return String(enemy.name || 'enemy').toUpperCase();
}


function formatIntentHtml(enemy, intent) {
    const dmg = intent.damage > 0
        ? ` <span class="intent-dmg">${intent.damage}</span>`
        : (intent.detail ? ` <small class="intent-detail">${escHtml(intent.detail)}</small>` : '');
    return `<div class="intent-card">
        <div class="intent-card-name" style="color:${safeColor(enemy.color)}">${escHtml(formatIntentName(enemy))}</div>
        <div class="intent-card-hp">HP ${enemy.hp}/${enemy.maxHp}</div>
        <div class="intent-card-label">Next Turn:</div>
        <div class="intent-card-action" style="color:${safeColor(intent.color)}">${escHtml(intent.label)}${dmg}</div>
    </div>`;
}


function predictEnemyIntent(enemy) {
    if (enemy.hp <= 0) return { label: '—', detail: '', damage: 0, color: '#888' };
    if (hasStatus(enemy, 'stun')) return { label: 'Stunned', detail: 'Cannot act', damage: 0, color: '#ffd65a' };
    if (hasStatus(enemy, 'freeze')) return { label: 'Frozen', detail: 'Cannot act', damage: 0, color: '#7fd8ff' };

    const dist = getDistance(enemy.x, enemy.y, gameState.player.x, gameState.player.y);
    const inRange = dist <= enemy.range;
    const canSee = hasLineOfSight(enemy, gameState.player);

    if (enemy.type === 'boss' || enemy.bossVariant) {
        const bossName = enemy.name || '';
        if (bossName === 'Bone Dragon') {
            const next = (enemy.bossTurnCounter || 0) + 1;
            if (next % 4 === 0)
                return { label: 'Breath Weapon', detail: 'Frost breath', damage: Math.max(1, Math.floor(enemy.atk * 1.6) - gameState.player.def), color: '#7fffd4' };
            if (inRange && canSee)
                return { label: 'Claw Strike', detail: 'Melee attack', damage: calcEnemyDamage(enemy), color: '#e8e8f0' };
            if (dist <= 8) return { label: 'Circle', detail: 'Preparing breath', damage: 0, color: '#7fffd4' };
        }
        if (bossName === 'Goblin King') {
            const next = (enemy.bossTurnCounter || 0) + 1;
            if (next % 3 === 0)
                return { label: 'Summon Goblins', detail: 'Calls reinforcements', damage: 0, color: '#58c26d' };
            if (inRange && canSee)
                return { label: 'Crown Strike', detail: 'Royal blow', damage: calcEnemyDamage(enemy), color: '#58c26d' };
        }
        if (bossName === 'Lich Lord') {
            const next = (enemy.bossTurnCounter || 0) + 1;
            if (next % 3 === 0)
                return { label: 'Raise Dead', detail: 'Revives fallen foe', damage: 0, color: '#b06fff' };
            if (inRange && canSee)
                return { label: 'Death Bolt', detail: 'Dark magic', damage: calcEnemyDamage(enemy), color: '#b06fff' };
        }
        if (bossName === 'Demon Prince') {
            const hellDmg = Math.max(1, Math.floor(enemy.atk * 1.4) - gameState.player.def);
            if (inRange && canSee)
                return { label: 'Hellfire', detail: 'Teleport + burn', damage: hellDmg, color: '#ff4444' };
            return { label: 'Teleport', detail: 'Warps toward you', damage: 0, color: '#ff6b6b' };
        }
        if (bossName === 'The Fallen God') {
            const phase = enemy.fallenPhase || 1;
            if (phase >= 3 && ((enemy.bossTurnCounter || 0) + 1) % 2 === 0)
                return { label: 'Divine Wrath', detail: 'Cataclysm', damage: Math.max(1, Math.floor(enemy.atk * 1.8) - gameState.player.def), color: '#ffd65a' };
            if (inRange && canSee)
                return { label: phase >= 2 ? 'Ash Strike' : 'Divine Blow', detail: `Phase ${phase}`, damage: calcEnemyDamage(enemy), color: '#ffd65a' };
        }
        if (enemy.bossVariant === 'necromancer' && ((enemy.bossTurnCounter || 0) % 3 === 2))
            return { label: 'Raise Dead', detail: 'Summons skeleton', damage: 0, color: '#b06fff' };
        if (enemy.bossVariant === 'wraith' && inRange && canSee)
            return { label: 'Phase Strike', detail: 'May poison', damage: calcEnemyDamage(enemy), color: '#7fffd4' };
        if (enemy.bossVariant === 'sentinel' && enemy.bossPhase === 'vulnerable' && inRange && canSee)
            return { label: 'Vulnerable Strike', detail: 'Open visor', damage: calcEnemyDamage(enemy), color: '#ff9f58' };
    }

    if (enemy.type === 'archer') {
        if (enemy.intent === 'charging' && inRange && canSee)
            return { label: 'Shoot', detail: `Ranged attack`, damage: calcEnemyDamage(enemy), color: '#78bfff' };
        if (inRange && canSee)
            return { label: 'Draw Bow', detail: 'Telegraphs shot', damage: 0, color: '#78bfff' };
    }
    if (enemy.type === 'brute') {
        if (enemy.intent === 'winding_up' && inRange && canSee)
            return { label: 'Slam', detail: 'Heavy strike', damage: calcEnemyDamage(enemy, 'Slam'), color: '#d08aff' };
        if (inRange && canSee)
            return { label: 'Wind Up', detail: 'Preparing slam', damage: 0, color: '#d08aff' };
    }
    // Cultist: telegraphs whether it will buff an ally or poke the player
    if (enemy.type === 'cultist') {
        const hasAlly = gameState.enemies.some(e =>
            e !== enemy && e.hp > 0 && e.type !== 'cultist' &&
            !hasStatus(e, 'rage') && getDistance(e.x, e.y, enemy.x, enemy.y) <= 4);
        if (hasAlly) return { label: 'Hex', detail: 'Enrages an ally', damage: 0, color: '#b06fff' };
        if (inRange && canSee) return { label: 'Dark Bolt', detail: 'Weak attack', damage: calcEnemyDamage(enemy), color: '#b06fff' };
    }
    // Thief: shows steal vs flee intent
    if (enemy.type === 'thief') {
        if (enemy.hasFled) return { label: 'Flee', detail: 'Escaping with gold', damage: 0, color: '#e0c060' };
        if (inRange && canSee) return { label: 'Steal', detail: 'Snatches gold', damage: calcEnemyDamage(enemy), color: '#e0c060' };
    }
    // Warden: flags the reliable weaken
    if (enemy.type === 'warden' && inRange && canSee)
        return { label: 'Crush', detail: 'Weakens you', damage: calcEnemyDamage(enemy), color: '#8fb0c8' };
    // Spider: flags the venom
    if (enemy.type === 'spider' && inRange && canSee)
        return { label: 'Bite', detail: 'Poisons you', damage: calcEnemyDamage(enemy), color: '#7a6a55' };
    // Bat: erratic flurry
    if (enemy.type === 'bat' && inRange && canSee)
        return { label: 'Flurry', detail: 'Quick bites', damage: calcEnemyDamage(enemy), color: '#9a7bb0' };
    // Necromancer: telegraphs a raise vs a poke
    if (enemy.type === 'necromancer') {
        const broodCount = gameState.enemies.filter(e => e._raisedBy === enemy && e.hp > 0).length;
        const canRaise = (enemy._summonCd || 0) <= 0 && broodCount < 3 && canSee;
        if (canRaise) return { label: 'Raise Dead', detail: 'Summons a skeleton', damage: 0, color: '#8c5cc0' };
        if (inRange && canSee) return { label: 'Hex Bolt', detail: 'Weak attack', damage: calcEnemyDamage(enemy), color: '#8c5cc0' };
    }
    // Imp: telegraphs double-strike when enraged
    if (enemy.type === 'imp') {
        if (enemy._impEnraged && inRange && canSee)
            return { label: 'Double Strike', detail: 'Burns on hit', damage: calcEnemyDamage(enemy), color: '#ff6030' };
        if (inRange && canSee)
            return { label: 'Slash', detail: 'May enrage', damage: calcEnemyDamage(enemy), color: '#ff6030' };
    }
    // Ratman: shows retreat intent when player is adjacent
    if (enemy.type === 'ratman') {
        if (dist <= 1) return { label: 'Retreat', detail: 'Backing away', damage: 0, color: '#a08060' };
        if (inRange && canSee) return { label: 'Fire Arrow', detail: 'Ranged shot', damage: calcEnemyDamage(enemy), color: '#a08060' };
    }
    // Ghoul: lifesteal on every hit — always show heal note
    if (enemy.type === 'ghoul' && inRange && canSee)
        return { label: 'Feast', detail: 'Heals on hit', damage: calcEnemyDamage(enemy), color: '#7aaa80' };
    // Lizardman: shows regenerate or attack
    if (enemy.type === 'lizardman') {
        if (inRange && canSee) return { label: 'Strike', detail: 'Regenerates each turn', damage: calcEnemyDamage(enemy), color: '#80c050' };
        return { label: 'Regenerate', detail: 'Healing…', damage: 0, color: '#80c050' };
    }
    // Orc: telegraphs charge wind-up
    if (enemy.type === 'orc') {
        if (enemy._orcCharging && inRange && canSee)
            return { label: 'CHARGE', detail: 'Heavy blow!', damage: calcEnemyDamage(enemy, 'charge'), color: '#a0ff40' };
        if (inRange && canSee)
            return { label: 'Wind Up', detail: 'Charge incoming', damage: 0, color: '#5a8030' };
        return { label: 'Advance', detail: 'Slow but relentless', damage: 0, color: '#5a8030' };
    }
    // Dark Knight: shows parry stance warning
    if (enemy.type === 'darkknight') {
        if (enemy._dkParrying)
            return { label: '⚔ PARRY', detail: 'Strike = counter damage', damage: 0, color: '#8090ff' };
        if (inRange && canSee)
            return { label: 'Blade Sweep', detail: 'May enter parry stance', damage: calcEnemyDamage(enemy), color: '#5060a0' };
    }
    // Demon: pure destruction
    if (enemy.type === 'demon' && inRange && canSee)
        return { label: 'Hellclaw', detail: 'Brutal strike', damage: calcEnemyDamage(enemy), color: '#cc3020' };
    // Mimic: telegraphs lunge after revealing itself
    if (enemy.type === 'mimic') {
        if (inRange && canSee) return { label: 'Bite', detail: 'It was never a chest', damage: calcEnemyDamage(enemy), color: '#c8a060' };
    }
    if (enemy.type === 'boss' && enemy.bossVariant === 'sentinel' && enemy.bossPhase === 'armored' && inRange && canSee)
        return { label: 'Attack', detail: 'Armored (half dmg taken)', damage: calcEnemyDamage(enemy), color: '#a8c8e8' };
    if (inRange && canSee && enemy.type !== 'boss')
        return { label: 'Attack', detail: enemy.type === 'slime' ? 'May poison' : '', damage: calcEnemyDamage(enemy), color: ENEMY_TYPES[enemy.type]?.color || '#e14b4b' };
    if (enemy.type === 'boss' && inRange && canSee)
        return { label: 'Attack', detail: enemy.bossVariant || 'Boss', damage: calcEnemyDamage(enemy), color: enemy.color };
    const chaseRange = gameState.player?.subclass === 'shadow' ? 2 : 7;
    if (dist <= chaseRange)
        return { label: 'Advance', detail: 'Moving closer', damage: 0, color: '#aaa397' };
    return { label: 'Patrol', detail: 'Searching', damage: 0, color: '#666' };
}


function refreshEnemyIntents() {
    gameState.enemies.forEach(e => { e.nextIntent = predictEnemyIntent(e); });
}


function tickAllies() {
    gameState.allies = gameState.allies.filter(a => {
        a.turns--;

        // Find the nearest living enemy visible on the floor
        let nearestEnemy = null;
        let nearestDist = Infinity;
        gameState.enemies.forEach(e => {
            if (e.hp <= 0) return;
            const d = getDistance(e.x, e.y, a.x, a.y);
            if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
        });

        if (nearestEnemy) {
            if (nearestDist <= 1) {
                // Adjacent — attack
                const dealt = Math.max(1, a.atk - nearestEnemy.def);
                damageEnemy(nearestEnemy, dealt, 'hit');
                if (nearestEnemy.hp <= 0) defeatEnemy(nearestEnemy);
            } else {
                // Not adjacent — step toward the target.
                // Uses a dedicated helper rather than chooseEnemyStep so we
                // can block moves into other allies without touching enemy AI.
                const step = _chooseAllyStep(a, nearestEnemy);
                if (step) { a.x = step.x; a.y = step.y; }
            }
        }

        return a.turns > 0;
    });
    if (gameState.decoy) {
        gameState.decoy.turns--;
        if (gameState.decoy.turns <= 0) gameState.decoy = null;
    }
}


// Pathfinding for allied minions — mirrors chooseEnemyStep but also
// blocks tiles occupied by other allies so two minions can't stack.
function _chooseAllyStep(ally, target) {
    const options = [
        { x: ally.x + 1, y: ally.y },
        { x: ally.x - 1, y: ally.y },
        { x: ally.x,     y: ally.y + 1 },
        { x: ally.x,     y: ally.y - 1 },
    ];
    return options
        .filter(s =>
            isWalkable(s.x, s.y) &&
            !isPlayerAt(s.x, s.y) &&
            !findEnemyAt(s.x, s.y, 0) &&
            !gameState.allies.some(a => a !== ally && a.x === s.x && a.y === s.y)
        )
        .sort((a, b) =>
            getDistance(a.x, a.y, target.x, target.y) -
            getDistance(b.x, b.y, target.x, target.y)
        )[0] || null;
}


// Flee pathfinding for the thief — picks the walkable step that MAXIMISES
// distance from the player (the inverse of chooseEnemyStep's minimise).
function _chooseFleeStep(enemy) {
    const px = gameState.player.x, py = gameState.player.y;
    const options = [
        { x: enemy.x + 1, y: enemy.y },
        { x: enemy.x - 1, y: enemy.y },
        { x: enemy.x,     y: enemy.y + 1 },
        { x: enemy.x,     y: enemy.y - 1 },
    ];
    return options
        .filter(s => isWalkable(s.x, s.y) && !isPlayerAt(s.x, s.y) && !findEnemyAt(s.x, s.y, 0))
        .sort((a, b) => getDistance(b.x, b.y, px, py) - getDistance(a.x, a.y, px, py))[0] || null;
}


// nx, ny: the tile the enemy is moving INTO (the old position is unused)
function checkTrapsOnMove(nx, ny) {
    const trapIdx = gameState.traps.findIndex(t => t.x === nx && t.y === ny);
    if (trapIdx === -1) return;
    gameState.traps.splice(trapIdx, 1);
    const enemy = gameState.enemies.find(e => e.x === nx && e.y === ny);
    if (enemy) {
        applyStatus(enemy, 'stun', 2);
        applyStatus(enemy, 'weaken', 2);
        damageEnemy(enemy, 8 + gameState.floor, 'hit');
        addMessage('A snare trap springs — enemy stunned and confused!');
        if (enemy.hp <= 0) defeatEnemy(enemy);
    }
}


function addCombatShake(intensity) {
    // Respect the screen-shake / reduce-motion accessibility settings.
    if (typeof gameSettings !== 'undefined' && (!gameSettings.screenShake || gameSettings.reduceMotion)) return;
    gameState.screenShake = Math.max(gameState.screenShake, intensity);
}


// Pauses the visual decay/animation-tick clock (NOT game logic, which has
// already resolved synchronously by the time this fires) for a handful of
// frames, so a high-impact hit's peak visual — flash, lunge, shake — holds
// visible slightly longer before continuing to decay, rather than the
// impact frame flickering by in a single ~16ms tick. See the gate around
// the decay block at the bottom of draw() in render.js. Uses max(), not
// addition, so several near-simultaneous impacts (e.g. thorns firing
// right after the hit that triggered it) don't stack into an absurdly
// long freeze.
function triggerHitStop(frames) {
    if (typeof gameSettings !== 'undefined' && gameSettings.reduceMotion) return;
    gameState.hitStopFrames = Math.max(gameState.hitStopFrames, frames);
}


function recordFallenEnemy(enemy) {
    if (enemy.type === 'boss' || enemy.type === 'spawn') return;
    if (!gameState.fallenEnemies) gameState.fallenEnemies = [];
    if (gameState.fallenEnemies.length >= 10) gameState.fallenEnemies.shift();
    gameState.fallenEnemies.push({ type: enemy.type, name: enemy.name });
}


function goblinKingSummon(king) {
    const count = rng() < 0.45 ? 2 : 1;
    let summoned = 0;
    for (let i = 0; i < count; i++) {
        const spot = findRandomOpenTile(2) || findOpenTileNear(king.x, king.y, 1, 4);
        if (!spot) continue;
        const goblin = new Enemy(spot.x, spot.y, 'goblin');
        goblin.hp = Math.ceil(goblin.maxHp * 0.75);
        goblin.maxHp = goblin.hp;
        gameState.enemies.push(goblin);
        addBurst(spot.x, spot.y, '#58c26d');
        summoned++;
    }
    if (summoned) {
        addFloatingText(king.x, king.y, 'SUMMON!', '#58c26d', { style: 'crit-banner', offsetY: -16 });
        addCombatShake(12);
        addMessage(`The Goblin King whistles — ${summoned} goblin${summoned > 1 ? 's' : ''} scramble to his side!`);
    }
}


function boneDragonBreath(dragon) {
    const p = gameState.player;
    const dist = getDistance(dragon.x, dragon.y, p.x, p.y);
    const aligned = dragon.x === p.x || dragon.y === p.y;
    const inBreath = dist <= 4 && (aligned || dist <= 2);

    addFloatingText(dragon.x, dragon.y, 'BREATH!', '#7fffd4', { style: 'crit-banner', offsetY: -20 });
    addCombatShake(22);
    gameState.effects.push({
        kind: 'breath',
        fromX: dragon.x, fromY: dragon.y,
        toX: p.x, toY: p.y,
        color: '#7fffd4',
        life: 24, maxLife: 24
    });

    if (inBreath && !gameState.gameOver) {
        const weakened = hasStatus(p, 'weaken');
        const effectiveDef = weakened ? Math.max(0, p.def - 3) : p.def;
        const dmg = Math.max(1, Math.floor(dragon.atk * 1.6) - effectiveDef);
        p.hp -= dmg;
        onPlayerTakeDamage(dragon);
        addFloatingText(p.x, p.y, `-${dmg}`, '#7fffd4');
        applyStatus(p, 'weaken', 2);
        addMessage(`The Bone Dragon's frost breath hits for ${dmg} damage!`);
        if (p.hp <= 0) { p.hp = 0; showGameOver(); }
    } else {
        addMessage('The Bone Dragon exhales frost — you slip clear of the blast!');
    }
    return true;
}


function lichLordRaiseDead(lich) {
    const spot = findRandomOpenTile(2) || findOpenTileNear(lich.x, lich.y, 1, 5);
    if (!spot) return;
    let raised;
    const fallen = gameState.fallenEnemies?.pop();
    if (fallen) {
        raised = new Enemy(spot.x, spot.y, fallen.type);
        raised.name = fallen.name;
        raised.hp = Math.ceil(raised.maxHp * 0.55);
        raised.maxHp = raised.hp;
        addMessage(`The Lich Lord raises a fallen ${fallen.name}!`);
    } else {
        raised = new Enemy(spot.x, spot.y, 'skeleton');
        raised.hp = Math.ceil(raised.maxHp * 0.6);
        raised.maxHp = raised.hp;
        addMessage('The Lich Lord conjures a skeleton from the ash!');
    }
    gameState.enemies.push(raised);
    addBurst(spot.x, spot.y, '#b06fff');
    addFloatingText(lich.x, lich.y, 'RISE!', '#b06fff', { style: 'crit-banner', offsetY: -16 });
    addCombatShake(10);
}


function demonPrinceTeleport(prince) {
    const p = gameState.player;
    const spot = findOpenTileNear(p.x, p.y, 1, 3) || findRandomOpenTile(1);
    if (!spot || (spot.x === prince.x && spot.y === prince.y)) return;
    if (findEnemyAt(spot.x, spot.y, 0)) return;
    addBurst(prince.x, prince.y, '#ff4444');
    prince.x = spot.x;
    prince.y = spot.y;
    addBurst(prince.x, prince.y, '#ff6b35');
    addFloatingText(prince.x, prince.y, 'TELEPORT!', '#ff4444', { style: 'warn', offsetY: -14 });
}


function updateFallenGodPhase(god) {
    const ratio = god.hp / god.maxHp;
    if (ratio <= 0.33 && (god.fallenPhase || 1) < 3) {
        god.fallenPhase = 3;
        god.bossPhase = 'apocalypse';
        god.color = '#ff2222';
        god.atk = Math.ceil(god.atk * 1.35);
        addFloatingText(god.x, god.y, 'PHASE III', '#ff2222', { style: 'crit-banner', offsetY: -22 });
        addCombatShake(18);
        addMessage('The Fallen God erupts — reality buckles under divine wrath!');
        showEventCard('PHASE III', 'The Fallen God — Apocalypse', 'boss');
    } else if (ratio <= 0.66 && (god.fallenPhase || 1) < 2) {
        god.fallenPhase = 2;
        god.bossPhase = 'wrath';
        god.color = '#ff9f58';
        god.atk = Math.ceil(god.atk * 1.2);
        addFloatingText(god.x, god.y, 'PHASE II', '#ff9f58', { style: 'crit-banner', offsetY: -20 });
        addCombatShake(14);
        addMessage('The Fallen God sheds its mercy — ash storms gather!');
        showEventCard('PHASE II', 'The Fallen God — Wrath', 'boss');
    }
}


function fallenGodWrath(god) {
    const p = gameState.player;
    const dist = getDistance(god.x, god.y, p.x, p.y);
    addFloatingText(god.x, god.y, 'WRATH!', '#ffd65a', { style: 'crit-banner', offsetY: -24 });
    addCombatShake(24);
    addBurst(god.x, god.y, '#ffd65a');
    if (dist <= 3 && !gameState.gameOver) {
        const weakened = hasStatus(p, 'weaken');
        const effectiveDef = weakened ? Math.max(0, p.def - 3) : p.def;
        const dmg = Math.max(1, Math.floor(god.atk * 1.8) - effectiveDef);
        p.hp -= dmg;
        onPlayerTakeDamage(god);
        addFloatingText(p.x, p.y, `-${dmg}`, '#ffd65a');
        addMessage(`Divine wrath crashes down for ${dmg} damage!`);
        if (p.hp <= 0) { p.hp = 0; showGameOver(); }
    } else {
        addMessage('The Fallen God unleashes divine wrath — you barely endure the shockwave!');
    }
    return true;
}


function milestoneBossMoveAndAttack(enemy, target) {
    const dist = getDistance(enemy.x, enemy.y, target.x, target.y);
    const inRange = dist <= enemy.range;
    const canSee = target.isDecoy || hasLineOfSight(enemy, gameState.player);
    const p = gameState.player;

    if (inRange && canSee) {
        if (enemy.name === 'Demon Prince') {
            enemyAttack(enemy);
            if (!gameState.gameOver && rng() < 0.45) {
                applyStatus(p, 'burn', 2);
                addFloatingText(p.x, p.y, 'BURN', '#ff6b35', { style: 'warn', offsetY: 8 });
            }
        } else if (enemy.name === 'The Fallen God' && (enemy.fallenPhase || 1) >= 2) {
            const mult = enemy.fallenPhase >= 3 ? 1.35 : 1.2;
            const saved = enemy.atk;
            enemy.atk = Math.ceil(saved * mult);
            enemyAttack(enemy);
            enemy.atk = saved;
        } else {
            enemyAttack(enemy);
        }
        return;
    }
    if (dist <= 7) {
        const step = chooseEnemyStep(enemy, target);
        if (step && !findEnemyAt(step.x, step.y, 0)) {
            const ox = enemy.x, oy = enemy.y;
            enemy.x = step.x;
            enemy.y = step.y;
            checkTrapsOnMove(step.x, step.y);
        }
    }
}


function handleMilestoneBossTurn(enemy, target) {
    enemy.bossTurnCounter++;
    const name = enemy.name;

    if (name === 'The Fallen God') updateFallenGodPhase(enemy);

    if (name === 'Goblin King' && enemy.bossTurnCounter % 3 === 0) {
        goblinKingSummon(enemy);
    }
    if (name === 'Bone Dragon' && enemy.bossTurnCounter % 4 === 0) {
        boneDragonBreath(enemy);
        return;
    }
    if (name === 'Lich Lord' && enemy.bossTurnCounter % 3 === 0) {
        lichLordRaiseDead(enemy);
    }
    if (name === 'Demon Prince') {
        demonPrinceTeleport(enemy);
    }
    if (name === 'The Fallen God' && (enemy.fallenPhase || 1) >= 3 && enemy.bossTurnCounter % 2 === 0) {
        fallenGodWrath(enemy);
        return;
    }

    milestoneBossMoveAndAttack(enemy, target);
}


function findEnemyAt(x, y, range) {
    return gameState.enemies.find(enemy => Math.abs(enemy.x - x) <= range && Math.abs(enemy.y - y) <= range);
}


function findItemAt(x, y) {
    return gameState.items.find(item => item.x === x && item.y === y);
}


function findNearestEnemy() {
    let nearest = null;
    let minDist = Infinity;
    gameState.enemies.forEach(enemy => {
        // Only target enemies the player has actually seen — same fog-of-war
        // rule the renderer uses to decide whether to draw the enemy at all.
        if (!gameState.revealed[enemy.y] || !gameState.revealed[enemy.y][enemy.x]) return;
        // Must also have a clear line of sight — no shooting through walls.
        if (!playerCanSeeEnemy(enemy)) return;
        const dist = getDistance(enemy.x, enemy.y, gameState.player.x, gameState.player.y);
        if (dist < minDist) {
            minDist = dist;
            nearest = enemy;
        }
    });
    return nearest;
}


// LOS check from the player's perspective — reuses the existing Bresenham
// walk in hasLineOfSight() but with player as the source. Prevents spells
// from targeting enemies through walls.
function playerCanSeeEnemy(enemy) {
    const p = gameState.player;
    if (!p) return false;
    if (getDistance(p.x, p.y, enemy.x, enemy.y) <= 1) return true;
    // Walk from player toward the enemy, blocking on any wall tile
    let x = p.x, y = p.y;
    const tx = enemy.x, ty = enemy.y;
    const dx = Math.abs(tx - x), dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx - dy;
    while (x !== tx || y !== ty) {
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx)  { err += dx; y += sy; }
        if (x === tx && y === ty) break;
        if (!isWalkable(x, y)) return false;
    }
    return true;
}


function recalculateStats() {
    const player = gameState.player;
    player.equipment = migrateEquipment(player.equipment);

    let weaponBonus = 0;
    let defBonus = 0;
    if (player.equipment.weapon) weaponBonus = player.equipment.weapon.bonus;
    DEF_GEAR_SLOTS.forEach(slot => {
        if (player.equipment[slot]) defBonus += player.equipment[slot].bonus;
    });
    player.atk = player.baseAtk + weaponBonus;
    player.def = player.baseDef + defBonus;
    // Knight's advertised "Bonus DEF scales with floor depth" trait —
    // a modest, steadily-growing passive on top of gear DEF. Sized at
    // 1 DEF per 4 floors so it's a meaningful trickle by floor 50-100
    // without trivializing early-game balance, since it stacks with
    // everything else Knight already has (Shield Wall, the adjacent
    // damage reduction below).
    if (player.subclass === 'knight') player.def += Math.floor(gameState.floor / 4);
    // Necromancer's bone shield (see Raise Dead) — recomputed every call
    // like thorns/goldFind below, so it disappears on its own once
    // boneShieldTurns ticks to 0 rather than needing a separate
    // "remove the buff" step anywhere else.
    if (player.boneShieldTurns > 0) player.def += (player.boneShieldDef || 0);

    const baseCrit = player.subclass === 'assassin' ? 40 : (player.className === 'rogue' ? 30 : 0);
    player.critChance = baseCrit + player.levelCritBonus;
    player.lifesteal = player.levelLifestealBonus;
    player.goldFind = 0;
    player.thorns = 0;
    player.manaRegenBonus = 0;
    // Gladiator's advertised "Gold find bonus scales with floor depth"
    // trait — 1% per 5 floors, capping around +20% by floor 100. Sized
    // to stay proportionate with the jewelry Fortune effect (roughly
    // +3-12% depending on rarity) rather than dwarfing it.
    if (player.subclass === 'gladiator') player.goldFind += Math.floor(gameState.floor / 5);

    JEWELRY_SLOTS.forEach(slot => {
        const jewelry = player.equipment[slot];
        if (!jewelry) return;
        // The numbered variants (Deadeye/Sanguine/Avarice/Bramble/Mystic = "2",
        // Assassin's/Exsanguine/Midas/Ironbark/Eldritch = "3") are stronger
        // rolls of the same base effect — they all map to the same derived
        // stat. Matching by prefix means any future tier works with no new
        // wiring here, as long as the effectId starts with the base name.
        const eid = jewelry.effectId || '';
        if (eid.startsWith('lifesteal'))      player.lifesteal      += jewelry.bonus;
        else if (eid.startsWith('critChance')) player.critChance     += jewelry.bonus;
        else if (eid.startsWith('goldFind'))   player.goldFind       += jewelry.bonus;
        else if (eid.startsWith('thorns'))     player.thorns         += jewelry.bonus;
        else if (eid.startsWith('manaRegen'))  player.manaRegenBonus += jewelry.bonus;
        // Flat stat rings/amulets — fold straight into atk/def. These stack
        // on top of weapon/armor gear bonuses, giving jewelry a way to boost
        // raw combat stats rather than only the percentage-based effects above.
        else if (eid.startsWith('atkFlat'))    player.atk            += jewelry.bonus;
        else if (eid.startsWith('defFlat'))    player.def            += jewelry.bonus;
    });

    // Relic stat effects. goldFind, lifesteal, thorns, critChance and
    // manaRegenBonus are true derived values, safe to recompute every call.
    // The atk/maxHp tradeoff relics (Blood Idol, Titan's Girdle, Glass
    // Chrysalis) are applied once at equip/unequip time instead (see
    // equipRelic / unequipRelic) because maxHp is mutated in place
    // elsewhere with no base value to re-derive from each recalc.
    (player.relics || []).forEach(relic => {
        const def = RELIC_DEFS[relic.id];
        if (!def || def.kind !== 'stat') return;
        switch (def.stat) {
            case 'goldFind':       player.goldFind       += def.value; break;
            case 'lifesteal':      player.lifesteal      += def.value; break;
            case 'thorns':         player.thorns         += def.value; break;
            case 'critChance':     player.critChance     += def.value; break;
            case 'manaRegenBonus': player.manaRegenBonus += def.value; break;
            // atkHpBonus / atkHpTradeoff handled at equip time, not here
        }
    });

    if (player.equipment.chest && player.equipment.chest.cursed) {
        player.critChance = Math.max(0, player.critChance - 10);
    }
    JEWELRY_SLOTS.forEach(slot => {
        const jewelry = player.equipment[slot];
        if (jewelry && jewelry.cursed) player.goldFind = Math.floor(player.goldFind / 2);
    });

    // Active brew bonuses (thorns + mana regen only — atk/def/maxHp are applied directly on equip)
    if (player._brewThorns) player.thorns += player._brewThorns;
    if (player._brewManaRegen) player.manaRegenBonus += player._brewManaRegen;

    // Active song stat boosts
    if (gameState.activeSong) {
        const eff = gameState.activeSong.effect;
        if (eff.type === 'stat_boost') {
            if (eff.stat === 'critChance') player.critChance += eff.value;
            if (eff.stat === 'goldFind')   player.goldFind  += eff.value;
        }
    }
}


function triggerTrapAt(x, y) {
    if (gameState.dungeon[y][x] !== 3) return;
    // Twilight Domain's "Step of Night" trait (advertised in the
    // class-select dossier) — traps simply fail to trigger against
    // them. The tile still consumes itself (a sprung trap doesn't
    // reset), it just deals no damage.
    if (gameState.player.subclass === 'twilightDomain') {
        gameState.dungeon[y][x] = 0;
        addMessage('You sense the trap and step clear of it.');
        return;
    }
    gameState.dungeon[y][x] = 0;
    const damage = 6 + gameState.floor * 2;
    gameState.player.hp = Math.max(0, gameState.player.hp - damage);
    addFloatingText(x, y, `-${damage}`, '#e14b4b');
    addMessage(`A trap bites for ${damage} damage.`);
    showFirstTimeHint('trap');
    addCombatShake(12);
    if (gameState.player.hp <= 0) showGameOver();
}


function enemyAttack(enemy) {
    const p = gameState.player;
    // Attack lunge — fires regardless of whether the hit actually lands
    // (block/dodge/riposte below can still cancel the damage, but the
    // enemy still physically swung). Direction is a unit-ish step toward
    // the player's logical tile at the moment of the swing, clamped to
    // [-1, 1] per axis so diagonal attackers don't lunge further than
    // an orthogonal one.
    const dx = Math.sign(p.x - enemy.x);
    const dy = Math.sign(p.y - enemy.y);
    enemy.attackAnim = { life: 14, maxLife: 14, dx, dy };
    if (p.subclass === 'knight' && p.sc?.blockReady) {
        p.sc.blockReady = false;
        p.sc.block = 0;
        addMessage('Shield Wall completely blocks the attack!');
        return;
    }
    if (p.subclass === 'gladiator' && p.sc?.riposteReady) {
        p.sc.riposteReady = false;
        const counter = Math.max(1, Math.ceil(p.atk * 2) - enemy.def);
        damageEnemy(enemy, counter, 'CRIT');
        addMessage(`Riposte! You counter for ${counter} damage!`);
        if (enemy.hp <= 0) defeatEnemy(enemy);
        return;
    }
    // Trickster's advertised "first hit each floor has a 25% dodge
    // chance" trait. dodgeReady is consumed on the first attack the
    // player actually takes each floor, regardless of whether the
    // dodge roll itself succeeds — it's a chance ON the first hit,
    // not a guaranteed dodge, and only applies once per floor.
    if (p.subclass === 'trickster' && p.sc?.dodgeReady) {
        p.sc.dodgeReady = false;
        if (rng() < 0.25) {
            addMessage(`You slip away from the ${enemy.name}'s attack!`);
            return;
        }
    }

    const weakened = hasStatus(p, 'weaken');
    const effectiveDef = weakened ? Math.max(0, p.def - 3) : p.def;
    const enemyWeakened = hasStatus(enemy, 'weaken');
    const enemyBlinded = hasStatus(enemy, 'blind');
    let effectiveAtk = enemyWeakened ? Math.max(1, Math.ceil(enemy.atk * 0.7)) : enemy.atk;
    // Light Domain's advertised "Critical hits blind enemies for 1 turn"
    // trait — blind cuts the enemy's effective attack in half on its
    // next swing, a steeper penalty than weaken's 30% reduction since
    // it's a situational crit-only proc rather than a guaranteed cast
    // effect (see the crit branch in Player.attack()).
    if (enemyBlinded) effectiveAtk = Math.max(1, Math.ceil(effectiveAtk * 0.5));
    let damage = Math.max(1, effectiveAtk - effectiveDef);
    if (hasStatus(p, 'rage')) damage = Math.ceil(damage * 1.25);

    // Knight's advertised "Reduced damage from adjacent enemies" trait —
    // a modest always-on passive (20% reduction) distinct from Shield
    // Wall's full block, which is a separate consumable charge handled
    // above. Checked by actual tile distance rather than the attacker's
    // range stat, so a ranged enemy that's closed to melee range still
    // counts as "adjacent" for this purpose.
    if (p.subclass === 'knight' && getDistance(enemy.x, enemy.y, p.x, p.y) <= 1) {
        damage = Math.max(1, Math.floor(damage * 0.8));
    }
    if (p.shieldActive) {
        damage = Math.max(0, Math.floor(damage / 2));
        p.shieldActive = false;
        addMessage('Shield Block absorbs some of the blow.');
    }

    // Illusionist's advertised "Mirror Image splits incoming damage
    // three ways" trait — while active, only a third of each hit lands
    // on the real player; the rest is shrugged off as if it struck a
    // duplicate instead. Decays on its own turn timer (ticked in
    // enemyTurn) rather than being consumed in one hit like Shield
    // Block, so it reads as a multi-turn illusion rather than a
    // single absorb charge.
    if (p.mirrorImageTurns > 0 && damage > 0) {
        const reduced = Math.max(1, Math.ceil(damage / 3));
        addMessage('Your mirror image takes the brunt of the blow.');
        damage = reduced;
    }

    // Light Domain's overheal buffer (see Searing Light) absorbs damage
    // before real HP, same as a temporary shield.
    if (p.overheal > 0 && damage > 0) {
        const absorbed = Math.min(p.overheal, damage);
        p.overheal -= absorbed;
        damage -= absorbed;
        if (absorbed > 0) addMessage('The holy light\'s afterglow absorbs some of the blow.');
    }

    p.hp -= damage;
    if (gameState.runStats) gameState.runStats.damageTaken = (gameState.runStats.damageTaken || 0) + damage;
    onPlayerTakeDamage(enemy);
    addFloatingText(p.x, p.y, `-${damage}`, '#e14b4b');
    // Flavored hit messages: each enemy type gets its own verb so combat
    // reads as a narrative rather than a repeated damage ticker. Same info,
    // more atmosphere. Low damage softens the language; heavy hits use
    // visceral verbs. Falls back to the plain form for unknown types.
    const hitVerbs = {
        goblin:      ['stabs at you', 'scratches you', 'nips your ankle'],
        orc:         ['smashes into you', 'slams you back', 'batters you'],
        brute:       ['crashes into you', 'pounds you into the floor', 'hammers you'],
        skeleton:    ['rakes your flesh', 'slashes you with bone', 'cleaves at you'],
        spider:      ['sinks fangs into you', 'bites deep', 'stabs a leg into you'],
        slime:       ['sloshes against your armor', 'splashes acid across you', 'surges into you'],
        bat:         ['rakes its claws across you', 'swoops and tears at you', 'bites your neck'],
        necromancer: ['blasts you with shadow', 'hurls a hex at you', 'drains your vitality'],
        cultist:     ['strikes with dark fervor', 'lashes you with cursed steel', 'cuts you'],
        ghoul:       ['tears at your flesh', 'claws and gnaws at you', 'rips into you'],
        ratman:      ['looses an arrow into you', 'shoots true', 'fires from the shadows'],
        archer:      ['pierces you with an arrow', 'fires at close range', 'puts an arrow in you'],
        warden:      ['bludgeons you', 'strikes with authority', 'clubs you down'],
        lizardman:   ['slashes with a serrated blade', 'hacks at you', 'cuts deep'],
        demon:       ['scorches you with hellfire', 'rakes infernal claws', 'sears you'],
        darkknight:  ['cleaves through your guard', 'strikes with dark force', 'hammers your armor'],
        imp:         ['singes you with fire', 'zaps you with a spark', 'burns at your skin'],
        mimic:       ['lunges with hidden jaws', 'snaps at you', 'bites hard'],
        boss:        ['strikes with devastating force', 'hammers you', 'unleashes a powerful blow'],
    };
    const verbs = hitVerbs[enemy.type] || ['hits you'];
    const verb = verbs[Math.floor(Math.random() * verbs.length)];
    addMessage(`The ${enemy.name} ${verb} for ${damage} damage.`);
    addCombatShake(enemy.type === 'boss' ? 14 : 10);
    triggerHitStop(enemy.type === 'boss' ? 4 : 3);

    if (p.thorns > 0 && damage > 0) {
        const reflected = Math.max(1, Math.ceil(damage * p.thorns / 100));
        damageEnemy(enemy, reflected, 'thorns');
        addMessage(`Thorns reflect ${reflected} damage back at the ${enemy.name}.`);
        if (enemy.hp <= 0) {
            defeatEnemy(enemy);
        }
    }

    if (p.hp <= 0) {
        p.hp = 0;
        showGameOver();
    }
}


// ── Elemental weapon on-hit ─────────────────────────────────────────────────
// Called from Player.attack() after the hit lands. Reads the equipped weapon's
// `element` (set in createGear) and applies the matching effect. `dealt` is the
// damage of the triggering hit, used to scale Lightning's chain bolt.
function applyWeaponElementOnHit(enemy, dealt) {
    const p = gameState.player;
    if (!p || enemy.hp <= 0) return;
    const weapon = p.equipment?.weapon;
    if (!weapon || !weapon.element) return;
    const edef = WEAPON_ELEMENTS[weapon.element];
    if (!edef) return;

    if (weapon.element === 'fire') {
        // Always apply a burn; sometimes escalate to a firestorm (longer burn +
        // splash to adjacent enemies).
        const firestorm = rng() < (edef.firestormChance || 0);
        const turns = firestorm ? 3 : (edef.burnTurns || 2);
        applyStatus(enemy, 'burn', turns);
        addFloatingText(enemy.x, enemy.y, firestorm ? 'FIRESTORM!' : 'Burn', edef.color);
        if (firestorm && edef.firestormSplash) {
            // Burn every enemy orthogonally/diagonally adjacent to the target
            gameState.enemies.forEach(other => {
                if (other === enemy || other.hp <= 0) return;
                if (Math.abs(other.x - enemy.x) <= 1 && Math.abs(other.y - enemy.y) <= 1) {
                    applyStatus(other, 'burn', 2);
                    addFloatingText(other.x, other.y, 'Singed', edef.color);
                }
            });
            addBurst(enemy.x, enemy.y, edef.color);
        }
    } else if (weapon.element === 'frost') {
        // Chance to freeze (skip a turn). Frozen enemies can't act next turn.
        if (rng() < (edef.freezeChance || 0)) {
            applyStatus(enemy, 'freeze', edef.freezeTurns || 1);
            addFloatingText(enemy.x, enemy.y, 'FROZEN!', edef.color);
            addBurst(enemy.x, enemy.y, edef.color);
        } else {
            addFloatingText(enemy.x, enemy.y, 'Chill', edef.color);
        }
    } else if (weapon.element === 'lightning') {
        // Small chance to stun the primary target...
        if (rng() < (edef.stunChance || 0)) {
            applyStatus(enemy, 'stun', edef.stunTurns || 1);
            addFloatingText(enemy.x, enemy.y, 'SHOCKED!', edef.color);
        }
        // ...and a chance to arc a reduced-damage bolt to a nearby second enemy.
        if (rng() < (edef.chainChance || 0)) {
            const target2 = gameState.enemies.find(o =>
                o !== enemy && o.hp > 0 &&
                gameState.revealed?.[o.y]?.[o.x] &&
                getDistance(o.x, o.y, enemy.x, enemy.y) <= (edef.chainRange || 3));
            if (target2) {
                const chainDmg = Math.max(1, Math.floor(dealt * (edef.chainDamagePct || 0.5)));
                damageEnemy(target2, chainDmg, 'fire'); // 'fire' damage type = bright flash
                addFloatingText(target2.x, target2.y, `⚡${chainDmg}`, edef.color);
                addBurst(target2.x, target2.y, edef.color);
                if (target2.hp <= 0) defeatEnemy(target2);
            }
        }
    }
}


function applyStatus(target, type, turns) {
    if (type === 'stun' && target.immuneToStun) return;
    // Fire-immune enemies (e.g. Demon) shrug off burn entirely — matches the
    // "fire-immune" promise in their bestiary lore. Without this the lore lies.
    if (type === 'burn' && target.fireImmune) {
        if (target.x != null) addFloatingText(target.x, target.y, 'IMMUNE', '#ff9f58');
        return;
    }
    // Resistance Tonic (bought from the town Alchemist) grants the PLAYER
    // immunity to poison and burn for a number of floors. _resistFloors holds
    // the last floor on which it's active. Without this check the tonic does
    // nothing despite costing gold.
    if (target === gameState.player && (type === 'poison' || type === 'burn')) {
        const until = gameState.player._resistFloors || 0;
        if (gameState.floor > 0 && gameState.floor <= until) {
            addFloatingText(gameState.player.x, gameState.player.y, 'RESIST', '#9fe6b0');
            return;
        }
    }
    const existing = target.statuses.find(s => s.type === type);
    if (existing) {
        existing.turns = Math.max(existing.turns, turns);
    } else {
        target.statuses.push({ type, turns });
    }
}


function hasStatus(target, type) {
    return target.statuses.some(s => s.type === type && s.turns > 0);
}


function tickStatuses(target, isPlayer) {
    const expired = [];
    target.statuses.forEach(s => {
        if (s.type === 'poison') {
            const dmg = isPlayer
                ? Math.max(1, 3 + gameState.floor)
                : Math.max(1, Math.floor(target.maxHp * 0.06));
            if (isPlayer) {
                gameState.player.hp = Math.max(0, gameState.player.hp - dmg);
                addFloatingText(gameState.player.x, gameState.player.y, `-${dmg}`, '#58c26d', { icon: STATUS_META.poison.icon });
                addMessage(`Poison courses through you for ${dmg} damage.`);
            } else {
                target.hp -= dmg;
                addFloatingText(target.x, target.y, `-${dmg}`, '#58c26d', { icon: STATUS_META.poison.icon });
            }
        }
        if (s.type === 'burn') {
            const dmg = isPlayer
                ? Math.max(1, 4 + gameState.floor)
                : Math.max(1, Math.floor(target.maxHp * 0.08));
            if (isPlayer) {
                gameState.player.hp = Math.max(0, gameState.player.hp - dmg);
                addFloatingText(gameState.player.x, gameState.player.y, `-${dmg}`, '#ff9f58', { icon: STATUS_META.burn.icon });
                addMessage(`The burn sears you for ${dmg} damage.`);
            } else {
                target.hp -= dmg;
                addFloatingText(target.x, target.y, `-${dmg}`, '#ff9f58', { icon: STATUS_META.burn.icon });
            }
        }
        // Renew — Cleric heal-over-time (player only). Heals a flat amount each
        // turn it's active, scaling lightly with level for late-game relevance.
        if (s.type === 'renew' && isPlayer) {
            const heal = 6 + Math.floor(gameState.floor / 4);
            gameState.player.hp = Math.min(gameState.player.maxHp, gameState.player.hp + heal);
            addFloatingText(gameState.player.x, gameState.player.y, `+${heal}`, '#9fe6b0');
        }
        s.turns--;
        if (s.turns <= 0) expired.push(s);
    });
    target.statuses = target.statuses.filter(s => !expired.includes(s));
}


// ── Enemy AI with telegraphing ────────────────────────────────────────────────

function getAITarget(enemy) {
    const px = gameState.player.x;
    const py = gameState.player.y;
    if (!gameState.decoy) return { x: px, y: py, isDecoy: false };
    const dDist = getDistance(enemy.x, enemy.y, gameState.decoy.x, gameState.decoy.y);
    const pDist = getDistance(enemy.x, enemy.y, px, py);
    if (dDist <= pDist) return { x: gameState.decoy.x, y: gameState.decoy.y, isDecoy: true };
    return { x: px, y: py, isDecoy: false };
}


function attackDecoy(enemy) {
    const d = gameState.decoy;
    if (!d) return;
    const dmg = Math.max(1, enemy.atk);
    d.hp = Math.max(0, d.hp - dmg);
    addFloatingText(d.x, d.y, `-${dmg}`, '#c49eff');
    addMessage(`The ${enemy.name} strikes your phantom twin!`);
    if (d.hp <= 0) {
        gameState.decoy = null;
        addMessage('Your phantom twin dissipates.');
    }
}


function enemyTurn() {
    if (gameState.gameOver || gameState.awaitingLevelChoice) return;

    if (gameState.player?.subclass === 'assassin' && gameState.player.sc?.stealth > 0) {
        gameState.player.sc.stealth--;
        addMessage('You remain hidden — enemies lose your trail.');
        tickAllies();
        refreshEnemyIntents();
        return;
    }

    // Tick player statuses first
    if (gameState.player.statuses.length > 0) {
        tickStatuses(gameState.player, true);
        if (gameState.player.hp <= 0) { showGameOver(); return; }
    }

    // Decay Light Domain's temporary overheal buffer (see Searing Light)
    if (gameState.player.overheal > 0) {
        gameState.player.overhealTurns--;
        if (gameState.player.overhealTurns <= 0) {
            gameState.player.overheal = 0;
        }
    }

    // Decay Illusionist's Mirror Image duration (see enemyAttack)
    if (gameState.player.mirrorImageTurns > 0) {
        gameState.player.mirrorImageTurns--;
    }

    // Decay Necromancer's bone shield (see recalculateStats) — recalc
    // immediately on expiry so the DEF bonus actually drops off rather
    // than lingering until some unrelated recalc happens to fire later.
    if (gameState.player.boneShieldTurns > 0) {
        gameState.player.boneShieldTurns--;
        if (gameState.player.boneShieldTurns <= 0) {
            addMessage('Your bone shield crumbles to dust.');
            recalculateStats();
        }
    }

    // Cursed weapon drains 2 HP per turn
    const cw = gameState.player.equipment.weapon;
    if (cw && cw.cursed) {
        gameState.player.hp = Math.max(0, gameState.player.hp - 2);
        addFloatingText(gameState.player.x, gameState.player.y, '-2 curse', '#9966cc');
        if (gameState.player.hp <= 0) { showGameOver(); return; }
    }

    gameState.enemies.forEach(enemy => {
        if (gameState.gameOver) return;

        // Stun and freeze are evaluated before status ticking so a 1-turn
        // effect skips exactly one action. Both prevent the enemy from acting;
        // freeze is the Frost-weapon version (visually icy, mechanically a skip).
        const wasStunned = hasStatus(enemy, 'stun') || hasStatus(enemy, 'freeze');
        // Tick enemy statuses every turn (covers stun, poison, burn, weaken)
        const wasAlive = enemy.hp > 0;
        if (enemy.statuses.length > 0) {
            tickStatuses(enemy, false);
            if (wasAlive && enemy.hp <= 0) { defeatEnemy(enemy); return; }
        }
        // Stun: skip this enemy's action
        if (wasStunned) return;

        // Illusionist's advertised "Confusion spell makes enemies attack
        // each other" trait. A confused enemy has a 60% chance each turn
        // to lash out at a random adjacent enemy instead of acting
        // normally; the other 40% of turns it behaves as if unaffected,
        // so confusion reads as "unreliable," not "guaranteed friendly
        // fire" — guaranteed redirection on every turn would make it
        // strictly better than stun against grouped enemies, since it'd
        // also deal damage. Doesn't compete with the stun early-return
        // above; an enemy that's both stunned and confused just skips
        // its turn like any other stunned enemy.
        if (hasStatus(enemy, 'confuse') && rng() < 0.6) {
            const adjacentAllies = gameState.enemies.filter(other =>
                other !== enemy && other.hp > 0 && getDistance(enemy.x, enemy.y, other.x, other.y) <= 1);
            if (adjacentAllies.length > 0) {
                const victim = adjacentAllies[Math.floor(rng() * adjacentAllies.length)];
                const dmg = Math.max(1, enemy.atk - victim.def);
                damageEnemy(victim, dmg, 'hit');
                addFloatingText(enemy.x, enemy.y, 'CONFUSED!', '#c49eff');
                addMessage(`The confused ${enemy.name} lashes out at the ${victim.name} for ${dmg} damage!`);
                if (victim.hp <= 0) defeatEnemy(victim);
                return;
            }
        }

        // Light Domain's advertised "Holy aura damages adjacent undead
        // each turn" trait. Skeletons are the only undead enemy type in
        // the roster — applies every turn regardless of what the enemy
        // does this turn, since it's meant to read as a passive aura
        // around the player, not a reaction to anything specific.
        if (gameState.player.subclass === 'lightDomain' && enemy.type === 'skeleton'
            && enemy.hp > 0 && getDistance(enemy.x, enemy.y, gameState.player.x, gameState.player.y) <= 1) {
            const auraDmg = 3 + Math.floor(gameState.player.level / 2);
            damageEnemy(enemy, auraDmg, 'fire');
            addMessage(`Your holy aura sears the skeleton for ${auraDmg} damage.`);
            if (enemy.hp <= 0) { defeatEnemy(enemy); return; }
        }

        const target = getAITarget(enemy);
        const distance = getDistance(enemy.x, enemy.y, target.x, target.y);
        const inRange   = distance <= enemy.range;
        const canSee    = target.isDecoy || hasLineOfSight(enemy, gameState.player);

        if (target.isDecoy && inRange && canSee) {
            attackDecoy(enemy);
            return;
        }

        // ── Archer: telegraphed ranged shot ──
        if (enemy.type === 'archer') {
            if (enemy.intent === 'charging') {
                // Fire the shot
                enemy.intent = null;
                if (inRange && canSee) {
                    addFloatingText(enemy.x, enemy.y, '→ SHOT', '#78bfff');
                    enemyAttack(enemy);
                }
                return;
            }
            if (inRange && canSee) {
                // Wind up for next turn
                enemy.intent = 'charging';
                addFloatingText(enemy.x, enemy.y, 'draws bow…', '#78bfff');
                addMessage(`The archer draws its bow — it telegraphs a shot!`);
                return;
            }
            enemy.intent = null;
        }

        // ── Ratman: cowardly ranged skirmisher — retreats when adjacent ──
        // Fires from distance; if the player closes in it runs away rather
        // than fighting. Punishes players who don't close the gap quickly.
        if (enemy.type === 'ratman') {
            if (distance <= 1) {
                // Player adjacent — flee away
                const dx = enemy.x - gameState.player.x;
                const dy = enemy.y - gameState.player.y;
                const nx = enemy.x + Math.sign(dx);
                const ny = enemy.y + Math.sign(dy);
                if (isWalkable(nx, ny) && !findEnemyAt(nx, ny, 0)) {
                    enemy.x = nx; enemy.y = ny;
                }
                addFloatingText(enemy.x, enemy.y, '!', '#a08060');
                return;
            }
            if (inRange && canSee) {
                if (enemy.intent === 'nocking') {
                    enemy.intent = null;
                    enemyAttack(enemy);
                    addFloatingText(enemy.x, enemy.y, '→ SHOT', '#a08060');
                    return;
                }
                enemy.intent = 'nocking';
                addFloatingText(enemy.x, enemy.y, 'nocking…', '#a08060');
                return;
            }
            enemy.intent = null;
        }

        // ── Orc: slow heavy-hitter with telegraphed charge ──
        // Skips a turn winding up, then delivers an amplified strike. The
        // telegraph window is the player's only window to move or heal.
        if (enemy.type === 'orc') {
            if (enemy._orcCharging) {
                enemy._orcCharging = false;
                if (inRange && canSee) {
                    const chargeDmg = Math.max(1, Math.floor(enemy.atk * 2.0) - gameState.player.def);
                    gameState.player.hp -= chargeDmg;
                    addFloatingText(gameState.player.x, gameState.player.y, `-${chargeDmg}`, '#e14b4b');
                    onPlayerTakeDamage(enemy);
                    addFloatingText(enemy.x, enemy.y, '⚡ CHARGE', '#a0ff40');
                    addMessage(`The orc's charge connects for ${chargeDmg} damage!`);
                    addCombatShake(24);
                    if (gameState.player.hp <= 0) { showGameOver(); return; }
                }
                return;
            }
            if (inRange && canSee) {
                enemy._orcCharging = true;
                addFloatingText(enemy.x, enemy.y, 'CHARGING…', '#5a8030');
                addMessage('The orc winds up a devastating charge — move or brace!');
                return;
            }
            enemy._orcCharging = false;
        }

        // ── Lizardman: regenerates HP each turn it stays alive ──
        // Attrition fights go its way. Every turn without a kill heals it.
        if (enemy.type === 'lizardman') {
            const regen = Math.max(1, Math.floor(enemy.maxHp * 0.06));
            if (enemy.hp < enemy.maxHp) {
                enemy.hp = Math.min(enemy.maxHp, enemy.hp + regen);
                addFloatingText(enemy.x, enemy.y, `+${regen}`, '#80c050');
            }
            if (inRange && canSee) { enemyAttack(enemy); return; }
        }

        // ── Dark Knight: parry counter — handled in melee block above,
        //    but we need to carry parry state across turns even out of range.
        if (enemy.type === 'darkknight') {
            // Parry wears off automatically after 1 turn
            if (enemy._dkParrying && !inRange) enemy._dkParrying = false;
            if (inRange && canSee) {
                // handled in melee block — falls through below
            }
        }

        // ── Brute: telegraphed heavy strike ──
        if (enemy.type === 'brute') {
            if (enemy.intent === 'winding_up') {
                enemy.intent = null;
                if (inRange && canSee) {
                    addFloatingText(enemy.x, enemy.y, '⚡ SLAM', '#d08aff');
                    const baseDmg = Math.max(1, Math.floor(enemy.atk * 1.8) - gameState.player.def);
                    gameState.player.hp -= baseDmg;
                    addFloatingText(gameState.player.x, gameState.player.y, `-${baseDmg}`, '#e14b4b');
                    onPlayerTakeDamage(enemy);
                    addMessage(`The brute's slam connects for ${baseDmg} damage!`);
                    addCombatShake(18);
                    if (gameState.player.hp <= 0) { showGameOver(); return; }
                }
                return;
            }
            if (inRange && canSee) {
                enemy.intent = 'winding_up';
                addFloatingText(enemy.x, enemy.y, 'winds up…', '#d08aff');
                addMessage(`The brute telegraphs a heavy slam — brace yourself!`);
                return;
            }
            enemy.intent = null;
        }

        // ── Cultist: buffs a nearby ally's ATK instead of attacking ──
        // Fragile support caster. If any other enemy is within sight, it
        // enrages that ally (raising its damage) rather than striking the
        // player. Kill it first or the whole pack hits harder.
        if (enemy.type === 'cultist') {
            const ally = gameState.enemies.find(e =>
                e !== enemy && e.hp > 0 && e.type !== 'cultist' &&
                !hasStatus(e, 'rage') &&
                getDistance(e.x, e.y, enemy.x, enemy.y) <= 4
            );
            if (ally) {
                applyStatus(ally, 'rage', 3);
                addFloatingText(enemy.x, enemy.y, '✦ HEX', '#b06fff');
                addFloatingText(ally.x, ally.y, 'ENRAGED', '#ff4500');
                addMessage(`The cultist chants — the ${ally.name} swells with dark fury!`);
                return;
            }
            // No ally to buff — falls through to a weak melee/ranged poke below
            if (inRange && canSee) { enemyAttack(enemy); return; }
            // else: move toward player via the generic fallback
        }

        // ── Thief: steals gold on hit, then flees ──
        // On a successful hit it lifts gold and immediately tries to escape.
        // If it reaches the floor edge it vanishes with whatever it stole.
        if (enemy.type === 'thief') {
            if (inRange && canSee && !enemy.hasFled) {
                enemyAttack(enemy);
                if (!gameState.gameOver) {
                    const loot = Math.min(gameState.player.gold, 8 + gameState.floor * 2);
                    if (loot > 0) {
                        gameState.player.gold -= loot;
                        enemy.stolenGold = (enemy.stolenGold || 0) + loot;
                        addFloatingText(enemy.x, enemy.y, `+${loot}g`, '#e0c060');
                        addFloatingText(gameState.player.x, gameState.player.y, `-${loot}g`, '#e14b4b');
                        addMessage(`The thief snatches ${loot} gold and bolts!`);
                    }
                    enemy.hasFled = true; // switch to flee mode after first steal
                }
                return;
            }
            // Flee mode — move AWAY from the player, and escape if at the edge
            if (enemy.hasFled) {
                const step = _chooseFleeStep(enemy);
                if (step) {
                    enemy.x = step.x; enemy.y = step.y;
                    checkTrapsOnMove(step.x, step.y);
                    // Reached the dungeon edge → escapes with the gold
                    if (enemy.x <= 1 || enemy.y <= 1 || enemy.x >= MAP_WIDTH - 2 || enemy.y >= MAP_HEIGHT - 2) {
                        if (enemy.stolenGold > 0) {
                            addFloatingText(enemy.x, enemy.y, 'ESCAPED!', '#e14b4b');
                            addMessage(`The thief escapes with ${enemy.stolenGold} of your gold!`);
                        }
                        gameState.enemies = gameState.enemies.filter(e => e !== enemy);
                    }
                } else if (inRange && canSee) {
                    // Cornered — fights back
                    enemyAttack(enemy);
                }
                return;
            }
        }

        // ── Necromancer: raises a skeleton instead of attacking ──
        // A regular summoner (distinct from the boss variant). Every few turns
        // it raises a weak skeleton near itself rather than striking; left
        // alive, it buries the player in adds. Caps its brood so it can't
        // flood the floor. Kill it first.
        if (enemy.type === 'necromancer') {
            enemy._summonCd = (enemy._summonCd || 0) - 1;
            const broodCount = gameState.enemies.filter(e => e._raisedBy === enemy && e.hp > 0).length;
            // Summons when aware of the player (within chase range) rather than
            // needing strict line of sight — a necromancer senses the intruder
            // and raises defenders even from across the room.
            const aware = distance <= 8;
            if (enemy._summonCd <= 0 && broodCount < 3 && aware) {
                const spot = findRandomOpenTile(2);
                if (spot && !findEnemyAt(spot.x, spot.y, 0)) {
                    const raised = new Enemy(spot.x, spot.y, 'skeleton');
                    raised.hp = Math.floor(raised.maxHp * 0.6);
                    raised.maxHp = raised.hp;
                    raised._raisedBy = enemy;
                    gameState.enemies.push(raised);
                    enemy._summonCd = 4; // turns until it can raise again
                    addFloatingText(enemy.x, enemy.y, 'RISE!', '#8c5cc0');
                    addMessage('The necromancer claws a skeleton up from the floor!');
                    return;
                }
            }
            // No summon this turn — pokes with a weak ranged hex if in range
            if (inRange && canSee) { enemyAttack(enemy); return; }
            // else falls through to movement below
        }

        // ── Standard melee attack (non-boss) ──
        if (inRange && canSee && enemy.type !== 'boss') {
            // Slime: inflicts poison on hit
            if (enemy.type === 'slime') {
                enemyAttack(enemy);
                if (!gameState.gameOver && rng() < 0.45) {
                    applyStatus(gameState.player, 'poison', 3);
                    addMessage("The slime's touch poisons you! (3 turns)");
                }
                return;
            }
            // Spider: stacks poison reliably on every bite — a venom threat
            // that punishes a slow kill.
            if (enemy.type === 'spider') {
                enemyAttack(enemy);
                if (!gameState.gameOver) {
                    applyStatus(gameState.player, 'poison', 3);
                    addMessage("The spider sinks its fangs in — venom courses through you!");
                }
                return;
            }
            // Bat: erratic flurry — a quick double-peck when it does connect.
            if (enemy.type === 'bat') {
                enemyAttack(enemy);
                if (!gameState.gameOver && rng() < 0.5) {
                    enemyAttack(enemy); // second quick bite
                }
                return;
            }
            // Skeleton: has a chance to weaken (reduce player def)
            if (enemy.type === 'skeleton') {
                enemyAttack(enemy);
                if (!gameState.gameOver && rng() < 0.3) {
                    applyStatus(gameState.player, 'weaken', 2);
                    addMessage("The skeleton's blow weakens your guard! (2 turns)");
                }
                return;
            }
            // Warden: reliably weakens on hit (not a chance) — a relentless
            // tank you can't stun your way out of.
            if (enemy.type === 'warden') {
                enemyAttack(enemy);
                if (!gameState.gameOver) {
                    applyStatus(gameState.player, 'weaken', 2);
                    addMessage("The warden's crushing blow saps your strength! (2 turns)");
                }
                return;
            }

            // ── Elite / deep-floor AI behaviors ──────────────────────────────

            // Imp: 50% chance to attack twice when enraged. Burns on every hit.
            if (enemy.type === 'imp') {
                enemyAttack(enemy);
                if (!gameState.gameOver) {
                    applyStatus(gameState.player, 'burn', 2);
                    addMessage("The imp's claws leave a burning wound! (2 turns)");
                }
                // Chance to attack again (enraged double-strike)
                if (!gameState.gameOver && rng() < 0.5) {
                    enemy._impEnraged = true;
                    enemyAttack(enemy);
                    if (!gameState.gameOver) addMessage("The imp strikes again in a frenzy!");
                } else {
                    enemy._impEnraged = false;
                }
                return;
            }

            // Ghoul: heals for 50% of damage dealt — the longer the fight
            // the stronger it gets relative to the player.
            if (enemy.type === 'ghoul') {
                const dmgBefore = gameState.player.hp;
                enemyAttack(enemy);
                if (!gameState.gameOver) {
                    const dmgDealt = Math.max(0, dmgBefore - gameState.player.hp);
                    const healed = Math.ceil(dmgDealt * 0.5);
                    if (healed > 0) {
                        enemy.hp = Math.min(enemy.maxHp, enemy.hp + healed);
                        addFloatingText(enemy.x, enemy.y, `+${healed}`, '#7aaa80');
                        addMessage(`The ghoul feasts on your wounds, healing ${healed} HP!`);
                    }
                }
                return;
            }

            // Dark Knight: parry stance — if in parry, counter the player.
            // Otherwise attack and randomly enter parry stance.
            if (enemy.type === 'darkknight') {
                if (enemy._dkParrying) {
                    // Parry wears off — just advance without attacking this turn
                    enemy._dkParrying = false;
                    addFloatingText(enemy.x, enemy.y, 'GUARD', '#5060a0');
                } else {
                    enemyAttack(enemy);
                    if (!gameState.gameOver && rng() < 0.4) {
                        enemy._dkParrying = true;
                        addFloatingText(enemy.x, enemy.y, '⚔ PARRY', '#8090ff');
                        addMessage('The dark knight raises its blade in a parry stance — striking it now will hurt you!');
                    }
                }
                return;
            }

            // Demon: high-damage attack, sets player on fire
            if (enemy.type === 'demon') {
                enemyAttack(enemy);
                if (!gameState.gameOver) {
                    applyStatus(gameState.player, 'burn', 3);
                    addMessage("The demon's hellclaw scorches you to the bone! (3 turns burn)");
                }
                return;
            }

            // Mimic: standard bite in combat once revealed
            if (enemy.type === 'mimic') {
                enemyAttack(enemy);
                return;
            }

            // Default generic melee
            enemyAttack(enemy);
            return;
        }

        // ── Boss: milestone encounters use unique mechanics ──
        if (enemy.type === 'boss' && enemy.milestoneBoss) {
            handleMilestoneBossTurn(enemy, target);
            return;
        }

        // ── Boss: variant-specific AI (runs every turn, not just in range) ──
        if (enemy.type === 'boss') {
            enemy.bossTurnCounter++;

            // Sentinel: phase-switch every 3 turns
            if (enemy.bossVariant === 'sentinel') {
                if (enemy.bossTurnCounter % 3 === 0) {
                    if (enemy.bossPhase === 'armored') {
                        enemy.bossPhase = 'vulnerable';
                        enemy.color = '#ff9f58';
                        enemy.range = 3;
                        addFloatingText(enemy.x, enemy.y, 'VULNERABLE!', '#ff9f58');
                        addMessage('The Iron Sentinel opens its visor — strike now!');
                    } else {
                        enemy.bossPhase = 'armored';
                        enemy.color = '#a8c8e8';
                        enemy.range = 1;
                        addFloatingText(enemy.x, enemy.y, 'ARMORED', '#a8c8e8');
                        addMessage('The Iron Sentinel slams its visor shut.');
                    }
                }
            }

            // Necromancer boss: raise a skeleton every 3 turns.
            // Capped at 6 alive skeletons (2× the regular necromancer's 3-skeleton limit)
            // to prevent late-game performance degradation from uncapped spawning.
            if (enemy.bossVariant === 'necromancer' && enemy.bossTurnCounter % 3 === 0) {
                const bossSkeletons = gameState.enemies.filter(
                    e => e._raisedBy === enemy && e.hp > 0
                ).length;
                if (bossSkeletons < 6) {
                    const spot = findRandomOpenTile(2);
                    if (spot) {
                        const raised = new Enemy(spot.x, spot.y, 'skeleton');
                        raised.hp = Math.floor(raised.maxHp * 0.5);
                        raised._raisedBy = enemy;
                        gameState.enemies.push(raised);
                        addFloatingText(enemy.x, enemy.y, 'RISE!', '#b06fff');
                        addMessage('The Necromancer raises a skeleton from the floor!');
                    }
                }
            }

            // Wraith: teleport to random open tile each turn
            if (enemy.bossVariant === 'wraith') {
                const warpSpot = findRandomOpenTile(1);
                if (warpSpot && !findEnemyAt(warpSpot.x, warpSpot.y, 0)) {
                    addBurst(enemy.x, enemy.y, '#7fffd4');
                    enemy.x = warpSpot.x;
                    enemy.y = warpSpot.y;
                    addBurst(enemy.x, enemy.y, '#7fffd4');
                }
            }

            if (inRange && canSee) {
                enemyAttack(enemy);
                // Wraith poisons on hit
                if (!gameState.gameOver && enemy.bossVariant === 'wraith') {
                    applyStatus(gameState.player, 'poison', 2);
                    addMessage('The Void Wraith phases through you — poisoned!');
                }
                // Generic boss stun chance (non-variant bosses only)
                if (!gameState.gameOver && !enemy.bossVariant && rng() < 0.25) {
                    applyStatus(gameState.player, 'stun', 1);
                    addMessage('The boss staggers you! (stunned 1 turn)');
                }
                return;
            }
            if (distance <= 7) {
                const step = chooseEnemyStep(enemy, target);
                if (step && !findEnemyAt(step.x, step.y, 0)) {
                    const ox = enemy.x, oy = enemy.y;
                    enemy.x = step.x;
                    enemy.y = step.y;
                    checkTrapsOnMove(step.x, step.y);
                }
            }
            return;
        }

        // Move toward player (non-boss, out of range)
        // Shadow's advertised "enemies lose sight of you beyond 2
        // tiles" trait — reduces the normal chase-perception range
        // (7 tiles for everyone else) down to 2 specifically when the
        // player is playing Shadow. Enemies that are already in attack
        // range are handled above this point regardless, so this only
        // affects whether an enemy bothers closing distance from afar.
        const chaseRange = gameState.player.subclass === 'shadow' ? 2 : 7;
        if (distance <= chaseRange) {
            // Bat: erratic flight — half the time it lurches to a random
            // adjacent open tile instead of pathing toward the player, so it's
            // hard to predict and hard to corner.
            if (enemy.type === 'bat' && rng() < 0.5) {
                const opts = [
                    { x: enemy.x + 1, y: enemy.y }, { x: enemy.x - 1, y: enemy.y },
                    { x: enemy.x, y: enemy.y + 1 }, { x: enemy.x, y: enemy.y - 1 },
                ].filter(s => isWalkable(s.x, s.y) && !isPlayerAt(s.x, s.y) && !findEnemyAt(s.x, s.y, 0));
                if (opts.length) {
                    const s = opts[Math.floor(rng() * opts.length)];
                    enemy.x = s.x; enemy.y = s.y;
                    checkTrapsOnMove(s.x, s.y);
                }
                return;
            }
            const step = chooseEnemyStep(enemy, target);
            if (step && !findEnemyAt(step.x, step.y, 0)) {
                enemy.x = step.x;
                enemy.y = step.y;
                checkTrapsOnMove(step.x, step.y);
                // Spider: fast — takes a second step toward the player when it
                // has the room, closing distance roughly twice as fast.
                if (enemy.type === 'spider') {
                    const step2 = chooseEnemyStep(enemy, target);
                    const adjacentNow = getDistance(enemy.x, enemy.y, gameState.player.x, gameState.player.y) <= 1;
                    if (step2 && !adjacentNow && !findEnemyAt(step2.x, step2.y, 0) && !isPlayerAt(step2.x, step2.y)) {
                        enemy.x = step2.x;
                        enemy.y = step2.y;
                        checkTrapsOnMove(step2.x, step2.y);
                    }
                }
            }
        }
    });

    tickAllies();
    refreshEnemyIntents();
}


function hasLineOfSight(enemy, player) {
    // Melee enemies attack when adjacent and never need LOS
    if (enemy.range <= 1) return true;
    // Always visible when touching — avoids degenerate one-step Bresenham
    if (getDistance(enemy.x, enemy.y, player.x, player.y) <= 1) return true;

    // Bresenham line walk: step from enemy toward player and block on any
    // wall tile in between. Previously this just checked for same row/column
    // (regardless of walls), so an archer on the far side of a wall could
    // fire through it as long as it shared a row or column with the player.
    let x = enemy.x, y = enemy.y;
    const tx = player.x, ty = player.y;
    const dx = Math.abs(tx - x), dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx - dy;

    while (x !== tx || y !== ty) {
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx)  { err += dx; y += sy; }
        if (x === tx && y === ty) break; // reached player tile — don't wall-check the target itself
        if (!isWalkable(x, y)) return false;
    }
    return true;
}


function chooseEnemyStep(enemy, target = null) {
    const tgt = target || getAITarget(enemy);
    const options = [
        { x: enemy.x + 1, y: enemy.y },
        { x: enemy.x - 1, y: enemy.y },
        { x: enemy.x, y: enemy.y + 1 },
        { x: enemy.x, y: enemy.y - 1 }
    ];

    return options
        .filter(step => isWalkable(step.x, step.y) && !isPlayerAt(step.x, step.y))
        .sort((a, b) => getDistance(a.x, a.y, tgt.x, tgt.y) -
            getDistance(b.x, b.y, tgt.x, tgt.y))[0];
}



function damageEnemy(enemy, damage, label) {
    // Sentinel armored phase halves all incoming damage
    if (enemy.bossVariant === 'sentinel' && enemy.bossPhase === 'armored') {
        damage = Math.max(1, Math.floor(damage / 2));
        addFloatingText(enemy.x, enemy.y, 'ARMORED', '#a8c8e8', { style: 'warn' });
    }
    enemy.hp -= damage;
    enemy.hitFlash = 1.0;
    sfxEnemyHit();
    // ── Run-stat tracking ───────────────────────────────────────────────────
    if (gameState.runStats) {
        gameState.runStats.damageDelt = (gameState.runStats.damageDelt || 0) + damage;
    }

    const isCrit = label === 'CRIT';
    const isFire = label === 'fire';
    const isBackstab = label === 'backstab';

    if (isCrit) {
        addDamageNumber(enemy.x, enemy.y, damage, { crit: true });
        addFloatingText(enemy.x, enemy.y, 'CRIT!', '#ffd65a', { style: 'crit-banner', offsetY: -18 });
        addCombatShake(26);
        triggerHitStop(7);
        triggerScreenFlash('crit');
        showEventCard('CRIT!', `${capitalize(enemy.name)} takes ${damage}`, 'crit');
        addMessage(`Critical hit! ${damage} damage to the ${enemy.name}!`);
        if (gameState.runStats) gameState.runStats.critsLanded = (gameState.runStats.critsLanded || 0) + 1;
    } else if (isFire) {
        addDamageNumber(enemy.x, enemy.y, damage, { color: '#ff9f58', icon: STATUS_META.burn.icon });
        addCombatShake(10);
        triggerHitStop(3);
    } else if (isBackstab) {
        addDamageNumber(enemy.x, enemy.y, damage, { color: '#c49eff', suffix: '!' });
        addFloatingText(enemy.x, enemy.y, 'BACKSTAB!', '#c49eff', { style: 'crit-banner', offsetY: -14 });
        addCombatShake(14);
        triggerHitStop(5);
    } else if (label === 'thorns') {
        addDamageNumber(enemy.x, enemy.y, damage, { color: '#9c6dff' });
        addCombatShake(6);
    } else {
        addDamageNumber(enemy.x, enemy.y, damage);
        addCombatShake(8);
        triggerHitStop(2);
    }

    if (enemy.milestoneBoss && enemy.name === 'The Fallen God' && enemy.hp > 0) {
        updateFallenGodPhase(enemy);
    }

    // Splitter: split at 50% HP (non-milestone bosses only)
    if (enemy.bossVariant === 'splitter' && !enemy.milestoneBoss && !enemy.splitDone && enemy.hp <= enemy.maxHp / 2 && enemy.hp > 0) {
        enemy.splitDone = true;
        triggerSplit(enemy);
    }
}


function triggerSplit(boss) {
    addMessage('The Splitter tears itself apart — two spawn erupt from the wound!');
    addBurst(boss.x, boss.y, '#ff6b35');
    addCombatShake(16);
    const offsets = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
    offsets.forEach(({ dx, dy }) => {
        const sx = boss.x + dx;
        const sy = boss.y + dy;
        if (isWalkable(sx, sy) && !findEnemyAt(sx, sy, 0)) {
            const spawn = new Enemy(sx, sy, 'spawn');
            spawn.hp += gameState.floor * 2;
            spawn.maxHp = spawn.hp;
            gameState.enemies.push(spawn);
        }
    });
}


function defeatEnemy(enemy) {
    // Arena bout: the fight ends on kill, no XP or loot (the bout rewards
    // are awarded by resolveArenaBout instead).
    if (gameState.inArenaBout) {
        // Gauntlet mode handles its own multi-wave flow. If it claims the
        // kill (spawns the next wave or finishes), we're done here.
        if (typeof handleGauntletKill === 'function' && handleGauntletKill(enemy)) {
            return;
        }
        spawnDeathAnim(enemy);
        gameState.enemies = gameState.enemies.filter(e => e !== enemy);
        resolveArenaBout(true);
        return;
    }

    recordFallenEnemy(enemy);

    // Necromancer: on death, raise one fallen enemy OR summon a skeleton
    if (enemy.bossVariant === 'necromancer' && !enemy.milestoneBoss) {
        spawnDeathAnim(enemy);
        addMessage('The Necromancer screams — the fallen stir once more!');
        addBurst(enemy.x, enemy.y, '#b06fff');
        trackEnemyKill(enemy);
        gameState.enemies = gameState.enemies.filter(candidate => candidate !== enemy);
        gameState.player.gainXp(enemy.xp);
        onEnemyKilledByPlayer();
        refreshEnemyIntents();
        const skeleton = new Enemy(enemy.x, enemy.y, 'skeleton');
        skeleton.hp = Math.floor(skeleton.maxHp * 0.6);
        gameState.enemies.push(skeleton);
        // Use findOpenTileNear rather than a hardcoded x+1 offset — the
        // naked offset could land outside the map or inside a wall if the
        // Necromancer dies at the eastern edge.
        const lootSpot = findOpenTileNear(enemy.x, enemy.y, 1, 3) || { x: enemy.x, y: enemy.y };
        gameState.items.push(createLoot(lootSpot.x, lootSpot.y));
        return;
    }

    spawnDeathAnim(enemy);
    trackEnemyKill(enemy);
    gameState.enemies = gameState.enemies.filter(candidate => candidate !== enemy);
    gameState.player.gainXp(enemy.xp);
    onEnemyKilledByPlayer();
    refreshEnemyIntents();
    const flavor = DEATH_FLAVOR[enemy.type] || 'falls.';
    addMessage(`${capitalize(enemy.name)} ${flavor}`);
    if (rng() < (enemy.type === 'boss' ? 1 : 0.38)) {
        gameState.items.push(createLoot(enemy.x, enemy.y));
    }

    if (enemy.type === 'boss') {
        gameMeta.bossesSlain++;
        saveMetaProgress();
        // Award Flagon Coins for every boss kill. earnFlagonCoins is
        // defined in treasury.js (loaded after combat.js) — guard avoids
        // a ReferenceError if treasury.js is absent in a stripped build.
        if (typeof earnFlagonCoins === 'function') earnFlagonCoins(3, 'boss slain');
        if (!gameState.tavernUpgrades.skeletonKingSkull) {
            gameState.tavernUpgrades.skeletonKingSkull = true;
            saveTavernUpgrades();
            addMessage('A boss skull now hangs above the Broken Flagon mantle!');
        }
        checkAchievements();
        if (gameState.floor === MAX_DUNGEON_FLOOR && enemy.name === 'The Fallen God') {
            showVictory();
        }
    }

    // Quest tracking: kill_count
    const q = gameState.activeQuest;
    if (q && !q.completed && !q.failed && q.type === 'kill_count' && q.targetType === enemy.type) {
        q.currentAmount++;
        if (q.currentAmount >= q.targetAmount) {
            completeQuest();
        }
    }
}


function applyLifesteal(damageDealt) {
    const player = gameState.player;
    if (player.lifesteal > 0 && player.hp < player.maxHp) {
        const healed = Math.min(player.maxHp - player.hp, Math.max(1, Math.ceil(damageDealt * player.lifesteal / 100)));
        if (healed > 0) {
            player.hp += healed;
            addFloatingText(player.x, player.y, `+${healed}`, '#58c26d');
        }
    }
}
