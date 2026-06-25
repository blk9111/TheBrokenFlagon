
function getMilestoneFloors() {
    return Object.keys(MILESTONE_BOSSES).map(Number).sort((a, b) => a - b);
}


function getNextMilestoneInfo(floor) {
    if (floor <= 0) return null;
    const milestones = getMilestoneFloors();
    const next = milestones.find(f => f >= floor);
    if (!next) return null;
    const boss = MILESTONE_BOSSES[next];
    const distance = next - floor;
    return { floor: next, name: boss.name, distance, isHere: distance === 0 };
}


function buildAsciiProgress(pct, width = 18) {
    const filled = Math.round((pct / 100) * width);
    return '\u2588'.repeat(Math.max(0, filled)) + '\u2591'.repeat(Math.max(0, width - filled));
}


function renderDungeonProgress() {
    const panel = document.getElementById('dungeon-progress-panel');
    const floorProg = document.getElementById('floor-progress');
    const dungeonTitle = document.getElementById('dungeon-name');
    const fill = document.getElementById('floor-progress-fill');
    const ascii = document.getElementById('floor-progress-ascii');
    const pctEl = document.getElementById('floor-progress-pct');
    const bossEl = document.getElementById('boss-anticipation');
    if (!panel) return;

    if (dungeonTitle) dungeonTitle.textContent = DUNGEON_NAME;

    if (gameState.floor === 0) {
        panel.classList.add('hub-mode');
        if (floorProg) {
            floorProg.textContent = gameState.inArenaBout
                ? 'The Pit — Bout in Progress'
                : (gameState.inCourtyard ? 'The Broken Flagon — Courtyard' : 'The Broken Flagon — Tavern Hub');
        }
        if (bossEl) bossEl.innerHTML = '';
        return;
    }

    panel.classList.remove('hub-mode');
    const pct = Math.max(0, Math.min(100, Math.round((gameState.floor / MAX_DUNGEON_FLOOR) * 100)));
    if (floorProg) floorProg.textContent = `Floor ${gameState.floor} / ${MAX_DUNGEON_FLOOR}`;
    if (fill) fill.style.width = `${pct}%`;
    if (ascii) ascii.textContent = buildAsciiProgress(pct);
    if (pctEl) pctEl.textContent = `${pct}%`;

    if (bossEl) {
        const next = getNextMilestoneInfo(gameState.floor);
        if (!next) {
            // Final boss already passed or at floor 100
            bossEl.innerHTML = `<div class="boss-inline"><span class="boss-name">The Fallen God</span> awaits below.</div>`;
        } else {
            const boss = MILESTONE_BOSSES[next.floor];
            const icon = { 10:'👑', 25:'🦴', 50:'💀', 75:'😈', 100:'⚡' }[next.floor] || '👑';
            const color = boss?.color || '#ff6b6b';

            // ── Rich boss card for ≤ 3 floors away or HERE ──
            if (next.distance <= 3) {
                const distText = next.isHere
                    ? 'NOW ON THIS FLOOR'
                    : next.distance === 1
                        ? '1 floor below'
                        : `${next.distance} floors below`;

                // Boss reward hints — milestone bosses always drop something notable.
                // Rewards are flavour (actual drop is random) but set player expectations.
                const rewardMap = {
                    10:  [{ label:'⚔ Epic Weapon', cls:'epic' }, { label:'◈ 300–500g', cls:'gold' }],
                    25:  [{ label:'⚔ Epic Weapon', cls:'epic' }, { label:'◈ 600g', cls:'gold' }, { label:'◆ Relic', cls:'relic' }],
                    50:  [{ label:'⚔ Legendary', cls:'epic' }, { label:'◈ 800g', cls:'gold' }, { label:'◆ Relic ×2', cls:'relic' }],
                    75:  [{ label:'⚔ Legendary', cls:'epic' }, { label:'◈ 1200g', cls:'gold' }, { label:'◆ Relic ×2', cls:'relic' }],
                    100: [{ label:'⚔ Mythic', cls:'epic' }, { label:'◈ Max Gold', cls:'gold' }, { label:'◆ Relic ×3', cls:'relic' }],
                };
                const rewards = rewardMap[next.floor] || [{ label:'◈ Gold', cls:'gold' }];
                const rewardChips = rewards.map(r => `<span class="boss-reward-chip ${r.cls}">${r.label}</span>`).join('');

                bossEl.innerHTML = `
                <div class="boss-card">
                    <div class="boss-card-header">
                        <span class="boss-card-icon">${icon}</span>
                        <span class="boss-card-name" style="color:${color}">${escHtml(next.name)}</span>
                        <span class="boss-card-floor">F${next.floor}</span>
                    </div>
                    <div class="boss-card-distance${next.isHere ? ' here' : ''}">${distText}</div>
                    <div class="boss-card-rewards">${rewardChips}</div>
                </div>`;
            } else {
                // Far away — keep it compact, show the icon and distance
                const floorsLabel = `${next.distance} floors away`;
                bossEl.innerHTML = `<div class="boss-inline">${icon} <span class="boss-name">${escHtml(next.name)}</span> <span class="boss-distance">— ${floorsLabel}</span></div>`;
            }
        }
    }
}


function ensureMetaStats() {
    if (!gameMeta.stats) gameMeta.stats = { totalKills: 0, slimeKills: 0, goblinKills: 0, goldDeposited: 0, milestoneBosses: {}, legendariesFound: 0 };
    if (gameMeta.stats.diceWins === undefined) gameMeta.stats.diceWins = 0;
    if (gameMeta.stats.itemsIdentified === undefined) gameMeta.stats.itemsIdentified = 0;
    if (!gameMeta.achievements) gameMeta.achievements = {};
}


function isAchievementUnlocked(id) {
    ensureMetaStats();
    return !!gameMeta.achievements[id];
}


function unlockAchievement(id) {
    ensureMetaStats();
    if (gameMeta.achievements[id]) return false;
    const def = ACHIEVEMENT_DEFS.find(a => a.id === id);
    if (!def) return false;
    gameMeta.achievements[id] = { unlockedAt: Date.now() };
    if (!gameState.runAchievementsUnlocked.includes(id)) gameState.runAchievementsUnlocked.push(id);
    showEventCard('ACHIEVEMENT', def.name, 'milestone');
    addMessage(`\u{1F3C6} Achievement unlocked: ${def.name} — ${def.desc}`);
    showAchievementToast(def.name, def.desc);
    saveMetaProgress();
    // Flagon Coins: +5 per new achievement unlock. Guard for stripped builds.
    if (typeof earnFlagonCoins === 'function') earnFlagonCoins(5, 'achievement');
    renderAchievements();
    return true;
}


// ── Achievement Toast ──────────────────────────────────────────────────────
// Slides in from the top-right when an achievement unlocks mid-run.
// Auto-dismisses after 4s. Multiple toasts stack.
function showAchievementToast(name, desc) {
    let container = document.getElementById('achievement-toasts');
    if (!container) {
        container = document.createElement('div');
        container.id = 'achievement-toasts';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'ach-toast';
    toast.innerHTML = `
        <span class="ach-toast-icon">\u2726</span>
        <span class="ach-toast-body">
            <span class="ach-toast-label">Achievement Unlocked</span>
            <span class="ach-toast-name">${escHtml(name)}</span>
            <span class="ach-toast-desc">${escHtml(desc || '')}</span>
        </span>
    `;
    container.appendChild(toast);
    // Trigger entrance
    requestAnimationFrame(() => toast.classList.add('ach-toast-visible'));
    // Auto-dismiss
    setTimeout(() => {
        toast.classList.add('ach-toast-exit');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}


function checkAchievements(context = {}) {
    ensureMetaStats();
    const s = gameMeta.stats;
    const checks = [
        ['first_blood', s.totalKills >= 1],
        ['slime_squasher', s.slimeKills >= 10],
        ['goblin_slayer', !!s.milestoneBosses['Goblin King']],
        ['bone_breaker', !!s.milestoneBosses['Bone Dragon']],
        ['lich_bane', !!s.milestoneBosses['Lich Lord']],
        ['demon_slayer', !!s.milestoneBosses['Demon Prince']],
        ['godslayer', !!s.milestoneBosses['The Fallen God']],
        ['the_delver', (context.bestFloor || gameState.bestFloor || 0) >= 25],
        ['deep_delver', (context.bestFloor || gameState.bestFloor || 0) >= 50],
        ['ash_walker', (context.bestFloor || gameState.bestFloor || 0) >= 75],
        ['millionaire', s.goldDeposited >= 1000],
        ['tavern_patron', gameState.tavernUpgrades.velvetChairs || gameState.tavernUpgrades.royalRug],
        ['boss_hunter', gameMeta.bossesSlain >= 5],
        ['legend_seeker', s.legendariesFound >= 1],
        ['hard_lesson', gameMeta.deaths >= 25],
        ['fortune_favors', gameMeta.totalGold >= 1000],
        ['centurion', s.totalKills >= 100],
        ['high_roller', s.diceWins >= 10],
        ['archivist', s.itemsIdentified >= 20]
    ];
    checks.forEach(([id, ok]) => { if (ok) unlockAchievement(id); });
}


function renderAchievements() {
    const list = document.getElementById('achievements-list');
    const countEl = document.getElementById('achievements-count');
    if (!list) return;
    ensureMetaStats();
    const unlocked = ACHIEVEMENT_DEFS.filter(a => isAchievementUnlocked(a.id)).length;
    if (countEl) countEl.textContent = `${unlocked} / ${ACHIEVEMENT_DEFS.length}`;
    list.innerHTML = ACHIEVEMENT_DEFS.map(a => {
        const on = isAchievementUnlocked(a.id);
        return `<div class="achievement-chip${on ? ' unlocked' : ''}" title="${escHtml(a.desc)}">
            <strong>${on ? '\u2726 ' : ''}${escHtml(a.name)}</strong>
            <small>${escHtml(a.desc)}</small>
        </div>`;
    }).join('');
}


function trackEnemyKill(enemy) {
    ensureMetaStats();
    gameMeta.stats.totalKills++;
    if (enemy.type === 'slime') gameMeta.stats.slimeKills++;
    if (enemy.type === 'goblin') gameMeta.stats.goblinKills++;
    if (enemy.type === 'skeleton') tryNecroticSkullHeal();
    if (enemy.type === 'bat' || enemy.type === 'spider' || enemy.type === 'ratman') tryBeastKillHeal();
    // Bestiary: count kills per enemy type. recordBestiaryKill also marks the
    // type as "seen", so the Codex fills in as the player fights through the
    // dungeon. Keyed by type so new enemy types populate it automatically.
    recordBestiaryKill(enemy.type);
    if (!gameState.runStats) gameState.runStats = createRunStats();
    gameState.runStats.enemiesSlain++;
    if (enemy.type === 'boss') {
        gameState.runStats.bossesDefeated++;
        if (enemy.tookNoDamage) unlockAchievement('flawless_victory');
        if (enemy.milestoneBoss && enemy.name) {
            gameMeta.stats.milestoneBosses[enemy.name] = true;
            const mf = enemy.milestoneFloor || Number(Object.entries(MILESTONE_BOSSES).find(([, b]) => b.name === enemy.name)?.[0]);
            if (mf && !gameState.tavernUpgrades.defeatedMilestones.includes(mf)) {
                gameState.tavernUpgrades.defeatedMilestones.push(mf);
                saveTavernUpgrades();
                // Announce the legendary guest who arrives in response
                const guest = MILESTONE_GUESTS.find(g => g.floor === mf);
                if (guest) {
                    setTimeout(() => {
                        addMessage(`Word spreads through the ash: ${guest.name} has arrived at The Broken Flagon.`);
                    }, 1800); // slight delay so it doesn't compete with the kill fanfare
                }
            }
            rechargeRelicsOnMilestone();
            if (typeof earnRenown === 'function') earnRenown(8, 'milestone boss defeated');
        }
    }
    checkAchievements();
}


function trackGoldPickup(amount) {
    if (!gameState.runStats) gameState.runStats = createRunStats();
    gameState.runStats.goldEarned += amount;
    // Also accumulate into the lifetime total so the title screen stat
    // reflects gold earned during the current run, not just past runs.
    gameMeta.totalGold = (gameMeta.totalGold || 0) + amount;
}


function trackRareFind(item) {
    if (!item || item.type !== 'equipment') return;
    ensureMetaStats();
    if (!gameState.runStats) gameState.runStats = createRunStats();
    if (item.rarity === 'legendary') {
        gameState.runStats.legendaryFound++;
        gameMeta.stats.legendariesFound++;
    }
    if (item.rarity === 'mythic') gameState.runStats.mythicFound++;
    checkAchievements();
}


// Fires a random ambient line for the given NPC key, but only on the
// rising edge of proximity (player just became adjacent this frame,
// wasn't last frame) — prevents the Chronicle from filling with the
// same line repeated every frame the player simply stands next to an
// NPC, e.g. while browsing a shop menu.
function triggerNpcProximityLine(npcKey, isAdjacentNow) {
    const wasAdjacent = !!gameState.npcProximity[npcKey];
    gameState.npcProximity[npcKey] = isAdjacentNow;
    if (!isAdjacentNow || wasAdjacent) return;
    const pool = NPC_AMBIENT_LINES[npcKey];
    if (!pool || !pool.length) return;

    // Filter by milestone tier AND optional condition function.
    // cond(gameState, gameMeta) lets lines react to class, floor, and renown
    // without a dedicated cutscene system.
    const milestoneCount = (gameState.tavernUpgrades?.defeatedMilestones || []).length;
    const available = pool.filter(entry => {
        if (typeof entry === 'string') return true;
        if ((entry.tier ?? 0) > milestoneCount) return false;
        if (typeof entry.cond === 'function') {
            try { return entry.cond(gameState, gameMeta); } catch { return false; }
        }
        return true;
    });
    if (!available.length) return;

    // Weight conditional lines 3× so they surface more often when eligible —
    // a player playing a Warrior who walks up to the blacksmith should
    // frequently get the Warrior-specific line, not be drowned out by generics.
    const weighted = [];
    available.forEach(entry => {
        const isContextual = typeof entry !== 'string' && typeof entry.cond === 'function';
        const w = isContextual ? 3 : 1;
        for (let i = 0; i < w; i++) weighted.push(entry);
    });
    const entry = weighted[Math.floor(Math.random() * weighted.length)];
    addMessage(typeof entry === 'string' ? entry : entry.line);
}


// Fires a contextual teaching hint the first time the player encounters a
// given mechanic, then never again (persisted in gameMeta.hintsSeen across
// runs). Safe to call on every occurrence of the triggering event — the
// seen-check makes all calls after the first a cheap no-op. Returns true if
// a hint was actually shown, false if it had already fired.
function showFirstTimeHint(id) {
    ensureMetaStats();
    if (!gameMeta.hintsSeen) gameMeta.hintsSeen = {};
    if (gameMeta.hintsSeen[id]) return false;
    const text = FIRST_TIME_HINTS[id];
    if (!text) return false;
    gameMeta.hintsSeen[id] = true;
    saveMetaProgress();
    addMessage(text);
    return true;
}


function renderBestFloor() {
    const el = document.getElementById('best-floor');
    if (el) el.textContent = gameState.bestFloor > 0 ? `Best: ${gameState.bestFloor}` : '';
}


function showLevelChoices() {
    const panel   = document.getElementById('levelup-panel');
    const options = document.getElementById('levelup-options');
    const levelEl = document.getElementById('levelup-level-num');
    if (!panel || !options) return;

    const p = gameState.player;
    if (levelEl) levelEl.textContent = p.level;
    showEventCard('LEVEL UP!', `Level ${p.level}`, 'milestone');

    // Canvas-world impact — burst, shake, flash at the player's position
    if (p) {
        addFloatingText(p.x, p.y, 'LEVEL UP!', '#ffd65a', { style: 'crit-banner', offsetY: -22 });
        addBurst(p.x, p.y, '#ffd65a');
        [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => addBurst(p.x + dx, p.y + dy, '#ffd65a'));
        addCombatShake(18);
        triggerHitStop(10);
        triggerScreenFlash('crit');
    }

    // ── Choice definitions with live before/after stat snapshots ──────────
    // `before` and `after` are thunks evaluated at display time so they always
    // reflect the current player state, even after a chain of level-ups.
    const allChoices = [
        {
            icon: '\u2694', label: '+3 Attack', desc: 'Strike harder in every exchange',
            statLabel: 'ATK', before: () => p.atk, after: () => p.atk + 3,
            apply: () => { p.baseAtk += 3; recalculateStats(); },
        },
        {
            icon: '\u2764', label: '+15 Max HP', desc: 'Fortify your body against punishment',
            statLabel: 'MAX HP', before: () => p.maxHp, after: () => p.maxHp + 15,
            apply: () => { p.maxHp += 15; p.hp = p.maxHp; },
        },
        {
            icon: '\u26E1', label: '+2 Defense', desc: 'Turn aside a greater share of incoming blows',
            statLabel: 'DEF', before: () => p.def, after: () => p.def + 2,
            apply: () => { p.baseDef += 2; recalculateStats(); },
        },
        {
            icon: '\u26A1', label: '+5% Crit Chance', desc: 'Find the gap in every guard',
            statLabel: 'CRIT', before: () => `${p.critChance}%`, after: () => `${p.critChance + 5}%`,
            apply: () => { p.levelCritBonus += 5; recalculateStats(); },
        },
        {
            icon: '\u2726', label: '+3% Lifesteal', desc: 'Drain vitality from every wound you deal',
            statLabel: 'LEECH', before: () => `${p.lifesteal || 0}%`, after: () => `${(p.lifesteal || 0) + 3}%`,
            apply: () => { p.levelLifestealBonus += 3; recalculateStats(); },
        },
    ];
    if (p.maxMana > 0) {
        allChoices.push({
            icon: '\u2728', label: '+6 Max Mana', desc: 'Expand your arcane reservoir',
            statLabel: 'MANA', before: () => p.maxMana, after: () => p.maxMana + 6,
            apply: () => { p.maxMana += 6; p.mana = p.maxMana; },
        });
    }

    const choices = shuffle(allChoices).slice(0, 3);

    options.innerHTML = '';
    choices.forEach((choice, i) => {
        const beforeVal = choice.before();
        const afterVal  = choice.after();

        const btn = document.createElement('button');
        btn.className = 'levelup-choice-btn';
        btn.style.animationDelay = `${0.12 + i * 0.1}s`;
        btn.innerHTML = `
            <span class="lu-choice-icon">${choice.icon}</span>
            <span class="lu-choice-body">
                <span class="lu-choice-label">${choice.label}</span>
                <span class="lu-choice-desc">${choice.desc}</span>
            </span>
            <span class="lu-choice-stat">
                <span class="lu-stat-before">${beforeVal}</span>
                <span class="lu-stat-arrow" aria-hidden="true">&#8594;</span>
                <span class="lu-stat-after">${afterVal}</span>
                <span class="lu-stat-key">${choice.statLabel}</span>
            </span>
        `;

        btn.addEventListener('click', () => {
            // Flash the selected card, then apply and move on
            btn.classList.add('lu-choice-selected');
            options.querySelectorAll('.levelup-choice-btn').forEach(b => {
                if (b !== btn) b.classList.add('lu-choice-faded');
            });
            setTimeout(() => {
                choice.apply();
                addFloatingText(p.x, p.y, choice.label, '#ffd65a', { style: 'crit-banner' });
                addMessage(`Training complete: ${choice.label}.`);
                if (gameState.pendingLevelChoices > 0) {
                    gameState.pendingLevelChoices--;
                    showLevelChoices();
                } else {
                    gameState.awaitingLevelChoice = false;
                    panel.style.display = 'none';
                }
                updateUI();
            }, 340);
        });
        options.appendChild(btn);
    });

    panel.style.display = 'flex';

    // Gold spark particles in the banner
    const sparksEl = document.getElementById('levelup-sparks');
    if (sparksEl) {
        sparksEl.innerHTML = '';
        for (let i = 0; i < 22; i++) {
            const sp = document.createElement('div');
            sp.className = 'lu-spark';
            const x = 10 + Math.random() * 80;
            const y = 10 + Math.random() * 80;
            const tx = (Math.random() - 0.5) * 80;
            const ty = -(30 + Math.random() * 55);
            sp.style.cssText = `left:${x}%;top:${y}%;--tx:${tx}px;--ty:${ty}px;--dur:${(1.0+Math.random()*1.2).toFixed(2)}s;--delay:${(Math.random()*0.5).toFixed(2)}s;width:${(2+Math.random()*3).toFixed(1)}px;height:${(2+Math.random()*3).toFixed(1)}px;`;
            sparksEl.appendChild(sp);
        }
    }

    updateUI();
}


function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}


function renderRunEndScreen({ title, epitaph, isVictory = false, isNewBest = false, dailyResult = null }) {

    // ── Skull / crown icon ────────────────────────────────────────────────
    const skullEl = document.getElementById('go-skull');
    if (skullEl) {
        skullEl.textContent = isVictory ? '★' : '☠';
        skullEl.className = isVictory ? 'go-icon-victory' : 'go-icon-death';
    }

    // ── Title ─────────────────────────────────────────────────────────────
    const goTitle = document.getElementById('game-over-title');
    if (goTitle) goTitle.textContent = title;

    // ── Record line ────────────────────────────────────────────────────────
    const bestEl = document.getElementById('game-over-best');
    if (bestEl) {
        if (isVictory) {
            bestEl.textContent = '\u2726 The Dungeon of Ash is yours!';
            bestEl.classList.remove('game-over-new-best');
        } else if (isNewBest) {
            bestEl.textContent = '\u2726 New Record!';
            bestEl.classList.add('game-over-new-best');
        } else {
            bestEl.textContent = gameState.bestFloor > 0 ? `Best run: Floor ${gameState.bestFloor}` : '';
            bestEl.classList.remove('game-over-new-best');
        }
    }

    // ── Panel accent class for victory vs death ───────────────────────────
    const goEl = document.getElementById('game-over');
    if (goEl) {
        goEl.classList.toggle('go-victory', isVictory);
        goEl.classList.toggle('go-new-best', isNewBest && !isVictory);
        goEl.classList.toggle('game-over-new-best-glow', isNewBest || isVictory);
    }

    // ── Cause of death banner ─────────────────────────────────────────────
    const rs = gameState.runStats || createRunStats();
    const p  = gameState.player;
    const floorReached = isVictory ? MAX_DUNGEON_FLOOR : gameState.floor;
    const causeEl = document.getElementById('go-cause');
    if (causeEl) {
        if (!isVictory && rs.killedBy) {
            causeEl.innerHTML = `<span class="go-cause-label">Slain by</span>
                                 <span class="go-cause-name">${escHtml(rs.killedBy)}</span>`;
            causeEl.style.display = 'flex';
        } else if (isVictory) {
            causeEl.innerHTML = `<span class="go-cause-name go-cause-victory">The Fallen God has been defeated.</span>`;
            causeEl.style.display = 'flex';
        } else {
            causeEl.style.display = 'none';
        }
    }

    // ── Portrait ──────────────────────────────────────────────────────────
    const portraitImg   = document.getElementById('go-portrait-img');
    const portraitClass = document.getElementById('go-portrait-class');
    if (portraitImg && p) {
        const gender = p.gender || (typeof ccState !== 'undefined' && ccState.gender) || 'm';
        portraitImg.src = `${p.className}-${gender}.png`;
        portraitImg.alt = capitalize(p.className || '');
        if (portraitClass) {
            const scDef = p.subclass
                ? (SUBCLASSES[p.className] || []).find(s => s.id === p.subclass)
                : null;
            portraitClass.textContent = scDef ? scDef.name : capitalize(p.className || '');
        }
    }

    // ── Stats grid — expanded ─────────────────────────────────────────────
    const summaryEl = document.getElementById('game-over-summary');
    if (summaryEl) {
        const dmgDelt  = typeof rs.damageDelt  === 'number' ? rs.damageDelt.toLocaleString()  : '—';
        const dmgTaken = typeof rs.damageTaken === 'number' ? rs.damageTaken.toLocaleString() : '—';
        const turnsStr = typeof rs.turnsPlayed === 'number' ? rs.turnsPlayed.toLocaleString() : '—';
        const critsStr = typeof rs.critsLanded === 'number' ? rs.critsLanded.toLocaleString() : '—';
        const potStr   = typeof rs.potionsUsed === 'number' ? rs.potionsUsed.toLocaleString() : '0';

        // Derived stats
        const effRatio = (rs.damageTaken > 0 && rs.damageDelt > 0)
            ? (rs.damageDelt / rs.damageTaken).toFixed(1) + '×' : '—';
        const goldPerFloor = (floorReached > 0 && rs.goldEarned > 0)
            ? Math.round(rs.goldEarned / floorReached) : 0;

        // Best weapon equipped at death
        const bestWeapon = p?.equipment?.weapon?.name || '—';

        // Relic count
        const relicCount = (p?.relics?.length || 0);
        const relicStr   = relicCount > 0 ? `${relicCount}` : '0';

        // Rare finds line
        const rareFinds = [];
        if (rs.legendaryFound > 0) rareFinds.push(`${rs.legendaryFound} legendary`);
        if (rs.mythicFound   > 0) rareFinds.push(`${rs.mythicFound} mythic`);
        const rareStr = rareFinds.length ? rareFinds.join(', ') : '—';

        summaryEl.innerHTML = `
            <div class="go-stat go-stat-floor">
                <span class="go-stat-icon">&#9660;</span>
                <span class="go-stat-val">${floorReached}</span>
                <small>Floor Reached</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#9876;</span>
                <span class="go-stat-val">${rs.enemiesSlain}</span>
                <small>Enemies Slain</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#9775;</span>
                <span class="go-stat-val">${rs.goldEarned}</span>
                <small>Gold Earned</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#9733;</span>
                <span class="go-stat-val">${p?.level || 1}</span>
                <small>Level Reached</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#9889;</span>
                <span class="go-stat-val">${dmgDelt}</span>
                <small>Damage Dealt</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#128737;</span>
                <span class="go-stat-val">${dmgTaken}</span>
                <small>Damage Taken</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#9651;</span>
                <span class="go-stat-val">${rs.bossesDefeated}</span>
                <small>Bosses Killed</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#128336;</span>
                <span class="go-stat-val">${turnsStr}</span>
                <small>Turns Played</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#128165;</span>
                <span class="go-stat-val">${critsStr}</span>
                <small>Crits Landed</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#129514;</span>
                <span class="go-stat-val">${potStr}</span>
                <small>Potions Used</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#9876;</span>
                <span class="go-stat-val">${effRatio}</span>
                <small>Dmg Efficiency</small>
            </div>
            <div class="go-stat">
                <span class="go-stat-icon">&#9775;</span>
                <span class="go-stat-val">${goldPerFloor}g</span>
                <small>Gold / Floor</small>
            </div>
        `;

        // ── Secondary info row: weapon / relics / rare finds ────────────
        const secondaryEl = document.getElementById('game-over-secondary');
        if (secondaryEl) {
            const rows = [];
            if (bestWeapon !== '—') rows.push(`<span class="go-secondary-item">&#9876; <b>${escHtml(bestWeapon)}</b></span>`);
            if (relicCount > 0) rows.push(`<span class="go-secondary-item">&#9670; <b>${relicStr}</b> relic${relicCount !== 1 ? 's' : ''} attuned</span>`);
            if (rareStr !== '—') rows.push(`<span class="go-secondary-item">&#10022; ${escHtml(rareStr)} found</span>`);
            if (rows.length) {
                secondaryEl.style.display = 'flex';
                secondaryEl.innerHTML = rows.join('');
            } else {
                secondaryEl.style.display = 'none';
            }
        }
    }

    // ── Achievements ──────────────────────────────────────────────────────
    const achEl = document.getElementById('game-over-achievements');
    if (achEl) {
        const unlocked = gameState.runAchievementsUnlocked || [];
        if (unlocked.length) {
            achEl.style.display = 'flex';
            achEl.innerHTML = `<span class="go-ach-label">Achievements</span>
                ${unlocked.map(id => {
                    const def = ACHIEVEMENT_DEFS.find(a => a.id === id);
                    return def ? `<span class="go-ach-chip">\u2726 ${escHtml(def.name)}</span>` : '';
                }).join('')}`;
        } else {
            achEl.style.display = 'none';
        }
    }

    // ── Epitaph ───────────────────────────────────────────────────────────
    const epitaphEl = document.getElementById('game-over-epitaph');
    if (epitaphEl) epitaphEl.textContent = epitaph;

    // ── Seed ─────────────────────────────────────────────────────────────
    const seedEl = document.getElementById('game-over-seed');
    if (seedEl) {
        if (gameState.runSeed) {
            seedEl.style.display = 'block';
            seedEl.innerHTML = `Seed: <span id="gameover-seed-code">${seedToCode(gameState.runSeed)}</span>
                <button class="cs-seed-copy-btn" onclick="copySeedCode()">Copy</button>`;
        } else {
            seedEl.style.display = 'none';
        }
    }

    // ── Hook line ─────────────────────────────────────────────────────────
    const hookEl = document.getElementById('game-over-hook');
    if (hookEl) {
        let hook = '';
        if (dailyResult) {
            if (dailyResult.won) hook = '\u2728 You conquered today\u2019s Daily Challenge!';
            else if (dailyResult.isDailyBest) hook = `\u2728 New personal best for today\u2019s Daily: Floor ${dailyResult.floor}!`;
            else {
                const rec = getDailyRecord(gameState.dailyKey);
                hook = rec ? `Today\u2019s Daily best: Floor ${rec.floor}. Tomorrow brings a new dungeon.`
                           : `You took on today\u2019s Daily Challenge.`;
            }
        } else if (!isVictory && !isNewBest && gameState.bestFloor > 0) {
            const gap = gameState.bestFloor - gameState.floor;
            if (gap > 0 && gap <= 3) hook = `So close \u2014 just ${gap} floor${gap === 1 ? '' : 's'} from your record. One more?`;
            else if (gap > 3) hook = `Your record stands at Floor ${gameState.bestFloor}. Can you go deeper?`;
        } else if (isNewBest) {
            hook = 'You went deeper than ever before. How much further can you push?';
        }
        hookEl.style.display = hook ? 'block' : 'none';
        hookEl.textContent = hook;
    }

    // ── Button label ──────────────────────────────────────────────────────
    const againBtn = document.getElementById('game-over-again-btn');
    if (againBtn) {
        againBtn.textContent = dailyResult ? 'Return to Tavern' : (isVictory ? '\u2726 Descend Again' : 'Descend Again');
    }

    // ── Show the panel + trigger reveal ───────────────────────────────────
    if (goEl) {
        goEl.style.display = 'flex';
        // Force reflow so animations re-trigger on repeated deaths
        void goEl.offsetWidth;
        goEl.classList.add('go-revealed');
    }

    // ── Background particles ───────────────────────────────────────────────
    _startGoParticles(isVictory);
}


// ── Game Over particle canvas ──────────────────────────────────────────────
// Death: slow-falling ash with occasional red embers.
// Victory: golden upward-rising motes + confetti shards.
let _goParticleFrame = null;
let _goParticles = [];
let _goParticleGen = 0;

function _startGoParticles(isVictory) {
    const myGen = ++_goParticleGen;
    if (_goParticleFrame) { cancelAnimationFrame(_goParticleFrame); _goParticleFrame = null; }
    _goParticles = [];

    const canvas = document.getElementById('go-canvas');
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    function tick() {
        if (_goParticleGen !== myGen) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Spawn
        if (_goParticles.length < 130 && Math.random() < 0.65) {
            if (isVictory) {
                _goParticles.push(_makeVictoryParticle(W, H));
                if (Math.random() < 0.3) _goParticles.push(_makeVictoryParticle(W, H));
            } else {
                _goParticles.push(_makeDeathParticle(W, H));
                if (Math.random() < 0.18) _goParticles.push(_makeDeathParticle(W, H));
            }
        }

        // Update + draw
        const t = Date.now() / 1000;
        _goParticles = _goParticles.filter(p => {
            p.life -= p.decay;
            if (p.life <= 0) return false;
            p.x  += p.vx + Math.sin(t * p.wFreq + p.phase) * p.wAmp;
            p.y  += p.vy;
            p.rot = (p.rot || 0) + (p.rotV || 0);

            const a = p.life < 0.2 ? p.life / 0.2 : 1;
            ctx.globalAlpha = a * p.baseAlpha;
            ctx.fillStyle = p.color;

            if (p.rect) {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
                ctx.restore();
            } else {
                if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 8; }
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(0.2, p.r * (0.4 + p.life * 0.6)), 0, Math.PI * 2);
                ctx.fill();
                if (p.glow) ctx.shadowBlur = 0;
            }
            return true;
        });
        ctx.globalAlpha = 1;
        _goParticleFrame = requestAnimationFrame(tick);
    }
    _goParticleFrame = requestAnimationFrame(tick);
}

function _makeDeathParticle(W, H) {
    const ember = Math.random() < 0.12;
    return {
        x: Math.random() * W, y: -8,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.35 + Math.random() * 0.9,
        r: ember ? 1.2 + Math.random() * 2 : 1.5 + Math.random() * 4,
        life: 1, decay: 0.0015 + Math.random() * 0.003,
        color: ember ? `hsl(${10 + Math.random() * 20},90%,55%)` : `hsl(0,0%,${18 + Math.random() * 22}%)`,
        baseAlpha: ember ? 0.7 : 0.25 + Math.random() * 0.25,
        glow: ember,
        wFreq: 0.4 + Math.random() * 0.6, wAmp: 0.3 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
    };
}

function _makeVictoryParticle(W, H) {
    const shard = Math.random() < 0.35;
    return {
        x: Math.random() * W, y: H + 8,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -(0.8 + Math.random() * 2.2),
        r: shard ? 3 + Math.random() * 5 : 1 + Math.random() * 3,
        life: 1, decay: 0.003 + Math.random() * 0.006,
        color: shard
            ? `hsl(${40 + Math.random() * 20},90%,${55 + Math.random() * 20}%)`
            : `hsl(${42 + Math.random() * 15},85%,${65 + Math.random() * 20}%)`,
        baseAlpha: 0.7 + Math.random() * 0.3,
        glow: !shard, rect: shard,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.08,
        wFreq: 0.5 + Math.random() * 0.8, wAmp: 0.5 + Math.random() * 1.0,
        phase: Math.random() * Math.PI * 2,
    };
}


function showVictory() {
    gameState.gameOver = true;
    clearActiveRun();
    gameMeta.runs++;
    saveMetaProgress();
    checkAchievements({ bestFloor: MAX_DUNGEON_FLOOR });
    if (typeof earnRenown === 'function') earnRenown(MAX_DUNGEON_FLOOR + 25, 'completing the dungeon');
    sfxLevelUp();
    showEventCard('VICTORY!', 'The Fallen God is defeated!', 'milestone');
    addMessage(`You have conquered ${DUNGEON_NAME} and broken the ash-curse!`);
    let dailyResult = null;
    if (gameState.isDailyRun && gameState.dailyKey) {
        const p = gameState.player;
        const isDailyBest = recordDailyResult(gameState.dailyKey, MAX_DUNGEON_FLOOR, true, p?.className, p?.subclass);
        dailyResult = { isDailyBest, floor: MAX_DUNGEON_FLOOR, won: true };
    }
    renderRunEndScreen({
        title: 'VICTORY!',
        epitaph: 'The ash settles. Legends will speak your name.',
        isVictory: true,
        dailyResult,
    });
    saveRunToHistory(true);
    updateUI();
}


function showGameOver() {
    // Arena non-ironman loss: player survives the bout but doesn't die.
    // Ironman arena bouts fall through to the real death path below.
    if (gameState.inArenaBout && !gameState.arenaIronman) {
        // Gauntlet losses keep banked rewards via the gauntlet resolver.
        if (gameState.arenaBoutData && gameState.arenaBoutData.isGauntlet) {
            _resolveGauntlet(false);
        } else {
            resolveArenaBout(false);
        }
        return;
    }

    // Guard against double-firing: enemyTurn() iterates enemies with
    // .forEach, and `return` inside that callback only skips to the next
    // enemy rather than stopping the loop. If a second enemy later in the
    // array also deals lethal damage on the same turn, it would otherwise
    // call showGameOver() again and double-increment gameMeta.runs/deaths,
    // double-save meta progress, and re-render the run-end screen.
    if (gameState.gameOver) return;
    if (tryBerserkerDeathSave()) return;
    if (tryRelicLethalSave()) return;
    gameState.gameOver = true;
    gameState.activeBrew = null;
    gameState.activeSong = null;
    _stopBardLoop();
    clearActiveRun();
    gameMeta.runs++;
    gameMeta.deaths++;
    gameMeta.totalGold += (gameState.player ? gameState.player.gold : 0);
    saveMetaProgress();
    if (gameState.activeQuest && !gameState.activeQuest.completed) {
        gameState.activeQuest.failed = true;
    }
    sfxDeath();
    // Show the post-death onboarding hint once, so new players understand what
    // carries forward (bank gold, fame, renown, stash) vs what they lost.
    if (gameMeta.deaths <= 3) showFirstTimeHint('postDeath');
    const priorBest = gameState.bestFloor || 0;
    saveBestFloor(gameState.floor);
    const isNewBest = gameState.floor > priorBest;
    checkAchievements({ bestFloor: gameState.bestFloor });
    // Earn Renown for floors descended this run
    if (gameState.floor > 0 && typeof earnRenown === 'function') {
        earnRenown(gameState.floor, 'floors descended');
    }
    // Record to The Fallen — builds the persistent graveyard on the title screen
    if (typeof recordFallen === 'function' && gameState.player) {
        const lastEnemy = gameState.enemies && gameState.enemies.find(e => e.hp <= 0);
        const killedBy = lastEnemy
            ? `${lastEnemy.name || lastEnemy.type} on Floor ${gameState.floor}`
            : gameState.floor > 0 ? `the depths of Floor ${gameState.floor}` : 'the darkness';
        if (gameState.runStats) gameState.runStats.killedBy = killedBy;
        recordFallen(gameState.player, gameState.floor, killedBy);
    }

    // Record the daily result if this was a Daily Challenge run, so the death
    // screen can show whether it beat the player's best for today.
    let dailyResult = null;
    if (gameState.isDailyRun && gameState.dailyKey) {
        const p = gameState.player;
        const isDailyBest = recordDailyResult(gameState.dailyKey, gameState.floor, false, p?.className, p?.subclass);
        dailyResult = { isDailyBest, floor: gameState.floor };
    }

    renderRunEndScreen({
        title: 'RUN ENDED',
        epitaph: pickEpitaph(gameState.floor),
        isNewBest,
        dailyResult,
    });
    saveRunToHistory(false);
    updateUI();
}


function pickEpitaph(floor) {
    if (floor <= 0) return GAME_OVER_EPITAPHS[0];
    return GAME_OVER_EPITAPHS[floor % GAME_OVER_EPITAPHS.length];
}


// ── Run History ──────────────────────────────────────────────────────────────
// Persists the last 5 completed runs in gameMeta.runHistory so the tavern
// screen can show a "Past Runs" ledger. Each entry records the minimum data
// needed for a useful at-a-glance comparison across runs.

const RUN_HISTORY_MAX = 5;
const RUN_HISTORY_KEY = 'brokenflagon_runhistory';

function saveRunToHistory(isVictory) {
    const p = gameState.player;
    if (!p) return;
    const rs = gameState.runStats || {};
    const scDef = p.subclass
        ? (SUBCLASSES[p.className] || []).find(s => s.id === p.subclass)
        : null;
    const entry = {
        ts:        Date.now(),
        className: p.className,
        subclass:  scDef ? scDef.name : '',
        level:     p.level,
        floor:     isVictory ? (typeof MAX_DUNGEON_FLOOR !== 'undefined' ? MAX_DUNGEON_FLOOR : 100) : gameState.floor,
        victory:   isVictory,
        killedBy:  isVictory ? null : (rs.killedBy || 'unknown'),
        slain:     rs.enemiesSlain || 0,
        gold:      rs.goldEarned || 0,
    };
    let history = loadRunHistory();
    history.unshift(entry);
    if (history.length > RUN_HISTORY_MAX) history = history.slice(0, RUN_HISTORY_MAX);
    try { localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(history)); } catch (_) {}
}

function loadRunHistory() {
    try {
        const raw = localStorage.getItem(RUN_HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

function renderRunHistory() {
    const panel = document.getElementById('run-history-panel');
    if (!panel) return;
    const history = loadRunHistory();
    if (!history.length) {
        panel.innerHTML = '<p class="rh-empty">No completed runs yet. Descend and make history.</p>';
        return;
    }
    const classIcons = { warrior: '\u2694', rogue: '\u25BA', mage: '\u2726', cleric: '\u271A' };
    panel.innerHTML = history.map((r, i) => {
        const ago = _timeAgo(r.ts);
        const outcome = r.victory
            ? '<span class="rh-victory">\u2605 Victory</span>'
            : `<span class="rh-death">Slain by ${escHtml(r.killedBy || '?')}</span>`;
        const icon = classIcons[r.className] || '\u25C6';
        return `
            <div class="rh-entry${r.victory ? ' rh-entry-victory' : ''}" style="animation-delay:${i * 0.06}s">
                <div class="rh-entry-icon">${icon}</div>
                <div class="rh-entry-body">
                    <div class="rh-entry-header">
                        <span class="rh-class">${escHtml(r.subclass || capitalize(r.className || ''))}</span>
                        <span class="rh-ago">${ago}</span>
                    </div>
                    <div class="rh-entry-outcome">${outcome}</div>
                    <div class="rh-entry-stats">
                        <span>Floor <strong>${r.floor}</strong></span>
                        <span>Lv <strong>${r.level}</strong></span>
                        <span>${r.slain} slain</span>
                        <span>${r.gold}g</span>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function _timeAgo(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
}

function toggleRunHistory() {
    const panel = document.getElementById('run-history-panel');
    if (!panel) return;
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    if (!visible) renderRunHistory();
}


// ── Save Slot System ──────────────────────────────────────────────────────────
// Multiple named save slots stored in localStorage. Each slot holds the full
// run state + metadata. Players can save, load, and delete slots from the
// settings or tavern screen.

const SAVE_SLOT_KEY = 'brokenflagon_saveslots';
const MAX_SAVE_SLOTS = 3;

function getSaveSlots() {
    try {
        const raw = localStorage.getItem(SAVE_SLOT_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

function _writeSaveSlots(slots) {
    try { localStorage.setItem(SAVE_SLOT_KEY, JSON.stringify(slots)); } catch (_) {}
}

function saveToSlot(slotIndex) {
    if (!gameState.player) return;
    const p = gameState.player;
    const scDef = p.subclass
        ? (SUBCLASSES[p.className] || []).find(s => s.id === p.subclass)
        : null;
    const slots = getSaveSlots();
    const classIcons = { warrior: '\u2694', rogue: '\u25BA', mage: '\u2726', cleric: '\u271A' };

    // Capture the full active run save data
    let runData = null;
    try {
        const raw = localStorage.getItem('dungeon_crawler_active_run');
        if (raw) runData = raw;
    } catch (_) {}

    slots[slotIndex] = {
        ts:        Date.now(),
        name:      p.name || scDef?.name || capitalize(p.className),
        className: p.className,
        subclass:  scDef ? scDef.name : '',
        icon:      classIcons[p.className] || '\u25C6',
        level:     p.level,
        floor:     gameState.floor,
        hp:        p.hp,
        maxHp:     p.maxHp,
        runData:   runData,
    };

    _writeSaveSlots(slots);
    renderSaveSlots();
    if (typeof showAchievementToast === 'function') {
        showAchievementToast('Game Saved', `Slot ${slotIndex + 1}: ${slots[slotIndex].name}`);
    }
}

function loadFromSlot(slotIndex) {
    const slots = getSaveSlots();
    const slot = slots[slotIndex];
    if (!slot || !slot.runData) return;
    try {
        localStorage.setItem('dungeon_crawler_active_run', slot.runData);
        location.reload();
    } catch (_) {}
}

function deleteSlot(slotIndex) {
    if (!confirm(`Delete save slot ${slotIndex + 1}?`)) return;
    const slots = getSaveSlots();
    slots[slotIndex] = null;
    _writeSaveSlots(slots);
    renderSaveSlots();
}

function renderSaveSlots() {
    const panel = document.getElementById('save-slots-panel');
    if (!panel) return;
    const slots = getSaveSlots();
    const hasActiveRun = !!gameState.player;

    panel.innerHTML = Array.from({ length: MAX_SAVE_SLOTS }, (_, i) => {
        const slot = slots[i];
        if (!slot) {
            return `<div class="ss-slot ss-empty">
                <div class="ss-slot-label">Slot ${i + 1}</div>
                <div class="ss-slot-status">Empty</div>
                ${hasActiveRun ? `<button class="ss-btn ss-save-btn" onclick="saveToSlot(${i})">Save Here</button>` : ''}
            </div>`;
        }

        const ago = typeof _timeAgo === 'function' ? _timeAgo(slot.ts) : '';
        return `<div class="ss-slot ss-occupied">
            <div class="ss-slot-icon">${slot.icon}</div>
            <div class="ss-slot-info">
                <div class="ss-slot-name">${escHtml(slot.name)}</div>
                <div class="ss-slot-meta">${escHtml(slot.subclass || capitalize(slot.className))} · Lv ${slot.level} · Floor ${slot.floor}</div>
                <div class="ss-slot-time">${ago}</div>
            </div>
            <div class="ss-slot-actions">
                <button class="ss-btn ss-load-btn" onclick="loadFromSlot(${i})">Load</button>
                ${hasActiveRun ? `<button class="ss-btn ss-save-btn" onclick="saveToSlot(${i})">Overwrite</button>` : ''}
                <button class="ss-btn ss-del-btn" onclick="deleteSlot(${i})">&#10005;</button>
            </div>
        </div>`;
    }).join('');
}

function toggleSaveSlots() {
    const panel = document.getElementById('save-slots-panel');
    if (!panel) return;
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    if (!visible) renderSaveSlots();
}


function addMessageAndUpdate(message) {
    addMessage(message);
    updateUI();
}


function addMessage(message) {
    gameState.messages.push(message);
    gameState.messages = gameState.messages.slice(-60);
    renderMessages();
}


function showEventCard(title, detail, type = 'combat') {
    const container = document.getElementById('event-cards');
    if (!container) return;
    const card = document.createElement('div');
    card.className = `event-card event-${type}`;
    card.innerHTML = `<div class="event-card-title">${escHtml(title)}</div><div class="event-card-detail">${escHtml(detail)}</div>`;
    container.appendChild(card);
    requestAnimationFrame(() => card.classList.add('event-card-visible'));
    setTimeout(() => {
        card.classList.add('event-card-fade');
        setTimeout(() => card.remove(), 450);
    }, 2000);
}


// ── Cinematic Boss Reveal ──────────────────────────────────────────────────
// Full-screen overlay for milestone bosses — boss glyph + name spelled out
// letter-by-letter. Auto-dismisses after the animation, or click to skip.
// ── Floor Transition Animation ─────────────────────────────────────────────
// Brief dark overlay showing the floor number counting up. Called by
// descendFloor in dungeon.js. Auto-dismisses after the animation.
function showFloorTransition(floor) {
    const old = document.getElementById('floor-transition');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'floor-transition';
    overlay.innerHTML = `
        <div class="ft-content">
            <div class="ft-label">Descending</div>
            <div class="ft-floor" id="ft-floor-num">${floor}</div>
            <div class="ft-sublabel">Floor ${floor} of ${typeof MAX_DUNGEON_FLOOR !== 'undefined' ? MAX_DUNGEON_FLOOR : 100}</div>
        </div>
    `;
    document.body.appendChild(overlay);

    void overlay.offsetWidth;
    overlay.classList.add('ft-visible');

    // Count up animation for milestone impact
    if (floor > 1) {
        const numEl = document.getElementById('ft-floor-num');
        if (numEl) {
            let count = Math.max(1, floor - 3);
            const interval = setInterval(() => {
                count++;
                numEl.textContent = count;
                if (count >= floor) clearInterval(interval);
            }, 80);
        }
    }

    // Auto-dismiss
    setTimeout(() => {
        overlay.classList.add('ft-exit');
        setTimeout(() => overlay.remove(), 450);
    }, 1200);
}


// ── Region Banner (World Map B2) ──────────────────────────────────────────────
// A larger, more dramatic overlay than the per-floor transition, shown only when
// the player crosses into a new named region. Sits a touch longer so the region
// name and flavor land. Non-blocking and self-dismissing.
function showRegionBanner(region) {
    if (!region) return;
    const old = document.getElementById('region-banner');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'region-banner';
    overlay.style.setProperty('--region-color', region.color || '#ffd65a');
    overlay.innerHTML = `
        <div class="rb-content">
            <div class="rb-eyebrow">Now Entering</div>
            <div class="rb-name">${escHtml(region.name)}</div>
            <div class="rb-flavor">${escHtml(region.flavor || '')}</div>
        </div>
    `;
    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add('rb-visible');

    setTimeout(() => {
        overlay.classList.add('rb-exit');
        setTimeout(() => overlay.remove(), 600);
    }, 2600);
}


function showBossReveal(name, color, glyph, announce) {
    // Remove any previous reveal
    const old = document.getElementById('boss-reveal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'boss-reveal';
    overlay.style.setProperty('--boss-color', color);
    overlay.innerHTML = `
        <div class="br-glyph">${escHtml(glyph)}</div>
        <div class="br-name" id="br-name-text"></div>
        <div class="br-announce">${escHtml(announce || '')}</div>
    `;
    document.body.appendChild(overlay);

    // Force reflow then trigger entrance
    void overlay.offsetWidth;
    overlay.classList.add('br-visible');

    // Spell out the name letter by letter
    const nameEl = document.getElementById('br-name-text');
    if (nameEl) {
        const letters = name.split('');
        letters.forEach((ch, i) => {
            setTimeout(() => {
                const span = document.createElement('span');
                span.className = 'br-letter';
                span.textContent = ch;
                span.style.animationDelay = '0s';
                nameEl.appendChild(span);
            }, 280 + i * 75);
        });
    }

    // Auto-dismiss after 2.8s + name length
    const totalTime = 2800 + name.length * 75;
    const dismiss = () => {
        overlay.classList.add('br-fade');
        setTimeout(() => overlay.remove(), 500);
    };
    const timer = setTimeout(dismiss, totalTime);

    // Click to skip
    overlay.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss();
    });
}


function spawnLootBeam(x, y, color = '#ff9f3d') {
    gameState.effects.push({
        kind: 'loot-beam',
        px: x * TILE_SIZE + TILE_SIZE / 2,
        py: y * TILE_SIZE + TILE_SIZE / 2,
        color,
        life: 90,
        maxLife: 90
    });
}


function announceRareDrop(item, x, y) {
    const rarity = item.rarity || 'common';
    trackRareFind(item);
    if (rarity === 'legendary' || rarity === 'mythic') {
        sfxLegendary();
        spawnLootBeam(x, y, getRarityColor(rarity));
        const label = rarity === 'mythic' ? 'MYTHIC FOUND!' : 'LEGENDARY FOUND!';
        const displayName = item.cursed && !item.identified ? '?? Item' : item.name;
        showEventCard(label, displayName, rarity);
        addMessage(`${label} ${displayName}`);
        addCombatShake(14);
    }
}


let logUnread = 0;

let logUnreadHasDamage = false;


// The log is now always visible (no dropdown to open/close), but we
// still track whether the person has scrolled away from the bottom so
// new-message badges only appear when something might be missed.
function isLogScrolledToBottom() {
    const log = document.getElementById('message-log');
    if (!log) return true;
    return log.scrollHeight - log.scrollTop - log.clientHeight < 24;
}


function clearLogUnread() {
    logUnread = 0;
    logUnreadHasDamage = false;
    const badge = document.getElementById('log-unread-badge');
    if (badge) {
        badge.style.display = 'none';
        badge.textContent = '';
        badge.classList.remove('log-badge-danger');
    }
}


// Classifies a log line into a category for color-coding, purely by
// pattern-matching the rendered text — no call-site changes required
// across the ~150 addMessage() calls throughout the file. Checked in
// priority order: crit > telegraph > poison/burn > generic in/out.
function classifyMessage(message) {
    const m = message.toLowerCase();
    if (/critical!/.test(m)) return 'crit';
    // Enemy death — "X falls." or "defeated the X"
    if (/\bfalls\.\s*$|\bdefeated the\b|\bhas been slain\b/.test(m)) return 'kill';
    if (/telegraphs|draws its bow|winds up|brace yourself/.test(m)) return 'telegraph';
    // Fire/burn damage — orange tint
    if (/the burn sears you|scorches you|fire.*damage|burning \d+ turns?\)|burns for/.test(m)) return 'fire';
    // Poison — green tint
    if (/poison courses through you|poisoned!|poisons you|poison.*damage/.test(m)) return 'poison';
    // Frost/ice
    if (/frozen|frost|chills you|freezes/.test(m)) return 'frost';
    if (/achievement|level up|begin|begins "/.test(m)) return 'milestone';
    if (/hits you for|bites for|slam connects|reflect.*damage back at you|stunned and cannot move/.test(m) && !/reflect .* damage back at the/.test(m)) return 'damage-in';
    if (/you hit the|backstab lands|scorches the|reflect \d+ damage back at the/.test(m)) return 'damage-out';
    if (/cursed|fail|not enough|no .* left|no .* in inventory|already at full/.test(m)) return 'warn';
    if (/found \d+ gold|picked up|buy |bought|donate|added\.|swaps in|^sold /.test(m)) return 'loot';
    if (/heal for|heal[s]? you|restored \d+ hp|absorbs some of the blow|antidote|cleared!|drink a health potion/.test(m)) return 'heal';
    if (/bounty|quest/i.test(message)) return 'quest';
    return 'default';
}


function renderMessages() {
    const log = document.getElementById('message-log');
    const wasAtBottom = isLogScrolledToBottom();
    log.innerHTML = '';
    const total = gameState.messages.length;
    gameState.messages.forEach((message, i) => {
        const entry = document.createElement('div');
        // Mark the newest entry so CSS can animate it in
        entry.className = `log-entry log-${classifyMessage(message)}${i === total - 1 ? ' log-entry-new' : ''}`;
        entry.textContent = message;
        log.appendChild(entry);
    });
    if (wasAtBottom) {
        log.scrollTop = log.scrollHeight;
        clearLogUnread();
    } else {
        logUnread++;
        const lastCategory = classifyMessage(gameState.messages[gameState.messages.length - 1] || '');
        if (lastCategory === 'damage-in') logUnreadHasDamage = true;
        const badge = document.getElementById('log-unread-badge');
        if (badge) {
            badge.textContent = logUnread > 9 ? '9+' : logUnread;
            badge.style.display = 'inline-block';
            badge.classList.toggle('log-badge-danger', logUnreadHasDamage);
        }
    }
}


function updateUI() {
    if (!gameState.player) return;

    const player = gameState.player;
    const scDef = player.subclass
        ? (SUBCLASSES[player.className] || []).find(s => s.id === player.subclass)
        : null;
    const heroLabel = [player.name, scDef ? scDef.name : capitalize(player.className)].filter(Boolean).join(' — ');
    document.getElementById('player-class').textContent = heroLabel;
    document.getElementById('player-level').textContent = player.level;
    document.getElementById('player-xp').textContent = `${player.xp}/${getXpToLevel()}`;
    document.getElementById('player-hp').textContent = player.hp;
    document.getElementById('player-max-hp').textContent = player.maxHp;
    document.getElementById('player-mana').textContent = player.mana;
    document.getElementById('player-max-mana').textContent = player.maxMana;
    document.getElementById('player-atk').textContent = player.atk;
    document.getElementById('player-def').textContent = player.def;
    document.getElementById('floor-level').textContent = gameState.floor === 0 ? 'Tavern' : `${gameState.floor}/${MAX_DUNGEON_FLOOR}`;

    const xpPct = Math.max(0, Math.min(100, Math.round((player.xp / getXpToLevel()) * 100)));
    const topLvl = document.getElementById('top-player-level');
    const topXpFill = document.getElementById('top-xp-fill');
    const topXpPct = document.getElementById('top-xp-pct');
    if (topLvl) topLvl.textContent = player.level;
    if (topXpFill) topXpFill.style.width = `${xpPct}%`;
    if (topXpPct) topXpPct.textContent = `${xpPct}%`;
    renderDungeonProgress();

    const manaRow = document.getElementById('mana-row');
    manaRow.style.display = player.maxMana > 0 ? 'flex' : 'none';
    document.getElementById('hp-fill').style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
    document.getElementById('mana-fill').style.width = player.maxMana > 0 ? `${Math.max(0, (player.mana / player.maxMana) * 100)}%` : '0%';
    const xpFill = document.getElementById('xp-fill');
    if (xpFill) xpFill.style.width = `${Math.max(0, Math.min(100, (player.xp / getXpToLevel()) * 100))}%`;

    // Critical HP — pulse the vitals panel red at ≤30%, urgent at ≤15%
    const vitalsPanel = document.getElementById('vitals-panel');
    if (vitalsPanel) {
        const hpPct = player.maxHp > 0 ? player.hp / player.maxHp : 1;
        vitalsPanel.classList.toggle('hp-critical', hpPct <= 0.30 && hpPct > 0);
        vitalsPanel.classList.toggle('hp-danger',   hpPct <= 0.15 && hpPct > 0);
    }


    document.getElementById('ability-text').innerHTML = getAbilityHint();
    renderInventory();
    renderEquipment();
    renderRelicsPanel();
    renderRunSnapshot();
    renderMinimap();
    // Refresh the world map panel when the Map tab is open and we're overland
    if (typeof renderWorldMapPanel === 'function') {
        const mapTab = document.getElementById('right-tab-map');
        if (mapTab && mapTab.style.display !== 'none') renderWorldMapPanel();
    }
    renderStatusBar();
    const scMeter = document.getElementById('subclass-meter');
    if (scMeter) scMeter.innerHTML = getSubclassMeterHtml();
    renderEnemyIntents();
    renderSideStashSummary();
    renderSideQuestSummary();
    const tavernBtn = document.getElementById('tavern-return-btn');
    if (tavernBtn) tavernBtn.disabled = gameState.floor === 0;
    if (!gameState.gameOver && gameState.floor > 0) saveActiveRun();

    // Ambient sound — switches between tavern and dungeon atmosphere
    if (typeof startAmbient === 'function') {
        if (gameState.gameOver) { if (typeof stopAmbient === 'function') stopAmbient(); }
        else if (gameState.floor === 0) startAmbient('tavern');
        else startAmbient('dungeon');
    }
    // BGM: crossfade between tavern, dungeon, and boss tracks based on current state
    if (typeof bgmUpdate === 'function') {
        const nearBoss = (typeof getNextMilestoneInfo === 'function')
            ? getNextMilestoneInfo(gameState.floor)?.isHere
            : false;
        bgmUpdate(gameState.floor, !!nearBoss);
    }
}


// ── Right-column tab switching (Inventory / Stash / Quests / Map) ─────
function showRightTab(tab) {
    ['inventory', 'relics', 'stash', 'quests', 'map'].forEach(t => {
        const pane = document.getElementById(`right-tab-${t}`);
        const btn = document.getElementById(`right-tab-btn-${t}`);
        if (pane) pane.style.display = t === tab ? 'flex' : 'none';
        if (btn) btn.classList.toggle('right-tab-active', t === tab);
    });
}


// Read-only summary of the shared stash, shown in the right column's
// Stash tab. Uses the same rarity-bordered slot tiles as the main
// inventory grid; visit the chest in the tavern to actually move items.
function renderSideStashSummary() {
    const el = document.getElementById('side-stash-summary');
    if (!el) return;
    if (!gameSharedStash.length) {
        el.innerHTML = '<div class="item-empty">The stash chest is empty.</div>';
        return;
    }
    el.innerHTML = '';
    gameSharedStash.forEach(item => {
        const slot = document.createElement('div');
        const isConsumable = CONSUMABLE_TYPES.includes(item.type);
        const displayName = item.cursed && !item.identified ? '?? Item' : item.name;
        const qty = isConsumable ? `x${item.qty}` : (item.cursed && !item.identified ? '+??' : `+${item.bonus}${item.unit || ''}`);
        const icon = isConsumable ? '+' : getGearIcon(item.slot);
        slot.className = `item-slot rarity-${item.rarity || 'common'}`;
        slot.title = displayName;
        slot.innerHTML = `
            <span class="item-slot-name">${displayName} ${qty}</span>
            <span class="item-slot-icon">${icon}</span>
            <span class="item-slot-qty">${qty}</span>
        `;
        el.appendChild(slot);
    });
}


// Read-only summary of the active Notice Board bounty, shown in the
// right column's Quests tab.
function renderSideQuestSummary() {
    const el = document.getElementById('side-quest-summary');
    if (!el) return;
    const q = gameState.activeQuest;
    if (!q) {
        el.innerHTML = '<div class="item-empty">No active bounty. Visit the Notice Board in the tavern.</div>';
        return;
    }
    let statusHtml;
    if (q.failed) {
        statusHtml = '<span class="status-badge" style="--sc:#e14b4b">&#x274C; Failed</span>';
    } else if (q.completed) {
        statusHtml = '<span class="status-badge" style="--sc:#58c26d">&#x2713; Complete</span>';
    } else if (q.type === 'kill_count') {
        statusHtml = `<span class="status-badge" style="--sc:#c49eff">${q.currentAmount}/${q.targetAmount}</span>`;
    } else {
        statusHtml = '<span class="status-badge" style="--sc:#c49eff">In progress</span>';
    }
    el.innerHTML = `<div class="gear-row"><span>${q.label}</span>${statusHtml}</div>`;
}




function renderStatusBar() {
    const bar = document.getElementById('status-bar');
    if (!bar || !gameState.player) return;
    const statuses = gameState.player.statuses;
    const brewBadge = gameState.activeBrew
        ? `<span class="status-badge brew-badge">${gameState.activeBrew.icon} ${gameState.activeBrew.name} (${gameState.activeBrew.duration}fl)</span>`
        : '';
    let questBadge = '';
    if (gameState.activeQuest) {
        const q = gameState.activeQuest;
        if (q.failed) {
            questBadge = `<span class="status-badge quest-badge quest-failed">&#x274C; ${q.label} — Failed</span>`;
        } else if (q.completed) {
            questBadge = `<span class="status-badge quest-badge quest-done">&#x2713; ${q.label} — Done!</span>`;
        } else if (q.type === 'kill_count') {
            questBadge = `<span class="status-badge quest-badge">&#x1F4DC; ${q.label}: ${q.currentAmount}/${q.targetAmount}</span>`;
        } else {
            questBadge = `<span class="status-badge quest-badge">&#x1F4DC; ${q.label}</span>`;
        }
    }
    const songBadge = gameState.activeSong
        ? `<span class="status-badge song-badge">&#9834; ${escHtml(gameState.activeSong.title)}</span>`
        : '';
    const overhealBadge = gameState.player.overheal > 0
        ? `<span class="status-badge" style="--sc:#fff3b0">&#x2728; Overheal +${gameState.player.overheal} (${gameState.player.overhealTurns})</span>`
        : '';
    if (!statuses.length && !brewBadge && !questBadge && !songBadge && !overhealBadge) { bar.innerHTML = ''; return; }
    bar.innerHTML = statuses.map(s => {
        const meta = STATUS_META[s.type] || {};
        return `<span class="status-badge" style="--sc:${meta.color || '#fff'}">${meta.icon || '?'} ${meta.label || s.type} (${s.turns})</span>`;
    }).join('') + overhealBadge + brewBadge + songBadge + questBadge;
}


function getAbilityHint() {
    if (gameState.awaitingLevelChoice) return 'Choose a level-up bonus to continue';
    if (gameState.shopOpen) return 'ESC: Close shop';
    if (gameState.charSheetOpen) return 'C or ESC: Close sheet';
    if (gameState.helpOpen) return 'H or ESC: Close help';
    if (gameState.gamblingOpen) return 'ESC: Leave dice table';
    if (gameState.brewmasterOpen) return 'ESC: Leave the Brewmaster';
    if (gameState.questBoardOpen) return 'ESC: Close Notice Board';
    if (gameState.bardOpen) return "ESC: Close Bard's Corner";
    if (gameState.stashOpen) return 'ESC: Close Shared Stash';
    if (gameState.magicDealerOpen) return 'ESC: Close Magic Dealer';
    // Contextual navigation prompt — when standing next to a tavern point of
    // interest, tell the player exactly what Space will do here.
    if (gameState.floor === 0 && gameState.player && typeof getAdjacentInteractable === 'function') {
        const adj = getAdjacentInteractable();
        if (adj) {
            return `<strong style="color:${safeColor(adj.color)}">[Space]</strong> ${escHtml(adj.verb)} ${escHtml(adj.label)}`;
        }
    }
    if (gameState.floor === 0 && gameState.player && isAdjacentToBartender()
        && !gameState.tavernUpgrades.velvetChairs) {
        return `G: Donate 50g to bartender (${Math.max(0, 200 - gameState.tavernUpgrades.goldDonated)}g needed for velvet chairs)`;
    }
    const ability = gameState.player.ability;
    return `Ability: <strong>${escHtml(ability)}</strong> &middot; Gold: ${gameState.player.gold}g`;
}


// Renders the right-column inventory as a tight square slot grid.
// Each slot gets a `rarity-<tier>` class straight from the item's own
// metadata (item.rarity), so new tiers (e.g. legendary) just work as
// soon as anything in the data layer starts producing them — no
// changes needed here.
// Renders both halves of the Relics tab — attuned (equipped, max 5) and
// pouch (benched/unequipped). Clicking a pouch relic attunes it; clicking
// an attuned relic benches it. Mirrors the clickable item-slot pattern
// used by the main inventory grid.
function renderRelicsPanel() {
    const p = gameState.player;
    if (!p) return;
    const equippedEl = document.getElementById('relics-equipped');
    const pouchEl = document.getElementById('relics-pouch');
    const countEl = document.getElementById('relics-equipped-count');
    if (!equippedEl || !pouchEl) return;

    if (countEl) countEl.textContent = p.relics.length;

    function buildSlot(relic, { onClick, extraHint }) {
        const def = RELIC_DEFS[relic.id];
        const slot = document.createElement('div');
        const rarity = def ? def.rarity : 'common';
        slot.className = `item-slot rarity-${rarity}`;
        const chargeNote = (def && def.kind === 'trigger' && !relic.charged) ? ' (spent)' : '';
        slot.title = `${def ? def.name : 'Unknown Relic'}${chargeNote}${extraHint ? ' — ' + extraHint : ''}`;
        slot.innerHTML = `
            <span class="item-slot-name">${def ? def.name : 'Unknown'}${chargeNote}</span>
            <span class="item-slot-icon">${def ? def.glyph : '?'}</span>
        `;
        if (def && def.kind === 'trigger' && !relic.charged) slot.classList.add('relic-spent');
        slot.classList.add('equip-row');
        slot.addEventListener('click', onClick);
        return slot;
    }

    equippedEl.innerHTML = '';
    if (!p.relics.length) {
        equippedEl.innerHTML = '<div class="item-empty">No relics attuned yet.</div>';
    } else {
        p.relics.forEach((relic, i) => {
            equippedEl.appendChild(buildSlot(relic, {
                extraHint: 'click to bench',
                onClick: () => unequipRelic(i)
            }));
        });
    }

    pouchEl.innerHTML = '';
    if (!p.relicPouch.length) {
        pouchEl.innerHTML = '<div class="item-empty">Pouch is empty.</div>';
    } else {
        p.relicPouch.forEach((relic, i) => {
            pouchEl.appendChild(buildSlot(relic, {
                extraHint: 'click to attune',
                onClick: () => equipRelic(relic.id, i)
            }));
        });
    }
}



// Compact glance-strip shown beneath the inventory grid on the Items tab,
// so that tab isn't mostly empty space below a 3-4 slot grid. Surfaces
// state the player would otherwise have to click into other tabs to see
// (relics attuned, active quest progress, active brew/song) rather than
// duplicating full tab content.
function renderRunSnapshot() {
    const el = document.getElementById('run-snapshot');
    if (!el) return;
    const p = gameState.player;
    if (!p) { el.innerHTML = ''; return; }

    const rows = [];

    // Active dungeon event — full strategic card so the player always knows
    // what they're dealing with and can make decisions accordingly.
    const activeEv = typeof getDungeonEvent === 'function' ? getDungeonEvent() : null;
    if (activeEv && activeEv.name) {
        // Build modifier tags from the event data
        const mods = [];
        if (activeEv.spawnBoost) {
            const boostNames = {
                goblin:'Goblins', skeleton:'Skeletons', necromancer:'Necromancers',
                spider:'Spiders', bat:'Bats', cultist:'Cultists', warden:'Wardens',
                brute:'Brutes', orc:'Orcs', demon:'Demons'
            };
            Object.entries(activeEv.spawnBoost).forEach(([type, mult]) => {
                const label = boostNames[type] || type;
                mods.push(`<span class="event-mod-tag event-mod-danger">+${(mult-1)*100|0}% ${label}</span>`);
            });
        }
        if (activeEv.lootBias && activeEv.lootBias !== 'none') {
            const biasLabel = {gold:'Extra Gold',scroll:'Scrolls',potion:'Potions',relic:'Relic Chance',rare:'Rare Items',all:'All Loot ↑'}[activeEv.lootBias] || activeEv.lootBias;
            mods.push(`<span class="event-mod-tag event-mod-reward">◈ ${biasLabel}</span>`);
        }
        if (activeEv.globalModifier?.enemyHpMult) {
            mods.push(`<span class="event-mod-tag event-mod-danger">⚠ Enemies Tougher</span>`);
        }
        if (activeEv.globalModifier?.lootMult) {
            mods.push(`<span class="event-mod-tag event-mod-reward">✦ +30% Loot</span>`);
        }
        const modsHtml = mods.length
            ? `<div class="event-mod-row">${mods.join('')}</div>` : '';
        const descHtml = activeEv.desc
            ? `<div class="event-desc">${escHtml(activeEv.desc)}</div>` : '';
        rows.push(`
        <div class="event-card" style="--ec:${safeColor(activeEv.color)}">
            <div class="event-card-header">
                <span class="event-card-icon">${escHtml(activeEv.icon||'')}</span>
                <span class="event-card-title">${escHtml(activeEv.name)}</span>
            </div>
            ${descHtml}
            ${modsHtml}
        </div>`);
    }

    rows.push(`<div class="gear-row"><span>Relics Attuned</span><span class="status-badge" style="--sc:#c98bff">${p.relics.length}/${RELIC_MAX_SLOTS}</span></div>`);

    const q = gameState.activeQuest;
    if (q) {
        let badge;
        if (q.failed) badge = '<span class="status-badge" style="--sc:#e14b4b">Failed</span>';
        else if (q.completed) badge = '<span class="status-badge" style="--sc:#58c26d">Complete</span>';
        else if (q.type === 'kill_count') badge = `<span class="status-badge" style="--sc:#c49eff">${q.currentAmount}/${q.targetAmount}</span>`;
        else badge = '<span class="status-badge" style="--sc:#c49eff">In progress</span>';
        rows.push(`<div class="gear-row"><span>${escHtml(q.label)}</span>${badge}</div>`);
    } else {
        rows.push(`<div class="gear-row"><span>Bounty</span><span class="status-badge" style="--sc:#888">None active</span></div>`);
    }

    if (gameState.activeBrew) {
        rows.push(`<div class="gear-row"><span>${escHtml(gameState.activeBrew.name)}</span><span class="status-badge" style="--sc:#ffd65a">${gameState.activeBrew.duration}fl left</span></div>`);
    }

    if (gameState.activeSong) {
        rows.push(`<div class="gear-row"><span>${escHtml(gameState.activeSong.title)}</span><span class="status-badge" style="--sc:#55c7ff">Playing</span></div>`);
    }

    rows.push(`<div class="gear-row"><span>Best Floor</span><span class="status-badge" style="--sc:#ffd65a">${gameState.bestFloor || 0}</span></div>`);

    // Arena fame — only once the Pit is unlocked, so it doesn't show as a
    // mysterious empty stat for players who haven't reached it yet. Surfacing
    // rank here (not just inside the arena panel) is what makes reputation
    // feel like a persistent part of the character rather than a menu number.
    if (typeof isArenaUnlocked === 'function' && isArenaUnlocked()) {
        const tier = getPitTier();
        const fame = getPitFame();
        rows.push(`<div class="gear-row"><span>Pit Rank</span><span class="status-badge" style="--sc:${tier.color}">${escHtml(tier.title)} · ${fame}</span></div>`);
    }

    // Tavern Renown — always shown so the player can see it growing.
    const renown = gameMeta.tavernRenown || 0;
    const nextM = typeof getNextRenownMilestone === 'function' ? getNextRenownMilestone() : null;
    const renownLabel = nextM ? `${renown} / ${nextM.renown}` : `${renown} ✦`;
    rows.push(`<div class="gear-row"><span>Tavern Renown</span><span class="status-badge" style="--sc:#d4a96a">${renownLabel}</span></div>`);

    // Next Goals — explicit targets to chase, drawn from current progression.
    // Turns the rich-but-implicit meta-progression into something the player
    // can see themselves working toward (a proven return driver).
    if (typeof getNextGoals === 'function') {
        const goals = getNextGoals();
        if (goals.length) {
            rows.push('<div class="snapshot-goals-label">Next Goals</div>');
            goals.forEach(g => {
                rows.push(`<div class="snapshot-goal"><span class="snapshot-goal-icon" style="color:${safeColor(g.color)}">${g.icon}</span><span class="snapshot-goal-text">${escHtml(g.label)}</span></div>`);
            });
        }
    }

    el.innerHTML = rows.join('');
}


function renderInventory() {
    const inventory = document.getElementById('inventory');
    inventory.innerHTML = '';
    if (gameState.player.inventory.length === 0) {
        inventory.innerHTML = '<div class="item-empty">No items yet.</div>';
        return;
    }

    const CONSUMABLE_ICONS = { potion: '+', antidote: '!', smokeBomb: '*', rageDraught: '^', identifyScroll: '?' };

    gameState.player.inventory.slice(0, 8).forEach(item => {
        const slot = document.createElement('div');
        const isConsumable = CONSUMABLE_TYPES.includes(item.type);
        let displayName, qty, icon;

        if (isConsumable) {
            displayName = item.name;
            qty = `x${item.qty}`;
            icon = CONSUMABLE_ICONS[item.type] || '?';
        } else {
            const hidden = item.cursed && !item.identified;
            displayName = hidden ? '?? Item' : item.name;
            qty = hidden ? '+??' : `+${item.bonus}${item.unit || ''}`;
            icon = getGearIcon(item.slot);
        }

        slot.className = `item-slot rarity-${item.rarity || 'common'}`;
        slot.innerHTML = `
            <span class="item-slot-name">${displayName} ${qty}</span>
            <span class="item-slot-icon">${icon}</span>
            <span class="item-slot-qty">${qty}</span>
        `;
        if (item.type === 'equipment') {
            slot.classList.add('equip-row');
            const hintName = (item.cursed && !item.identified) ? '?? Item' : (item.desc ? `${item.desc} \u2014 click to equip` : 'Click to equip');
            slot.title = hintName;
            slot.addEventListener('click', () => equipFromInventory(item));
        }
        inventory.appendChild(slot);
    });
}


function renderEquipment() {
    const equipment = document.getElementById('equipment');
    const eq = migrateEquipment(gameState.player.equipment);
    gameState.player.equipment = eq;

    // Three rows, each centered independently — sidesteps the column-count
    // mismatch between a 1-item row (helmet) and a 4-item row (jewelry)
    // that previously left helmet pinned off-center with dead space beside it.
    const rows = [
        ['ring1', 'helmet', 'ring2'],
        ['shield', 'chest', 'weapon'],
        ['amulet', 'boots']
    ];

    function renderSlot(key) {
        const item = eq[key];
        const label = SLOT_LABELS[key];
        const icon = SLOT_GLYPHS[key];
        const rarity = item?.rarity || 'common';
        const hidden = item?.cursed && !item?.identified;
        const title = item
            ? (hidden ? '?? Item' : `${item.name} ${getGearStatLabel(item)}`)
            : label;
        const inner = item
            ? `<span class="doll-glyph rarity-${rarity}">${item.glyph || icon}</span><small class="doll-name rarity-${rarity}">${hidden ? '??' : item.name.split(' ').slice(-1)[0]}</small>`
            : `<span class="doll-empty">${icon}</span><small class="doll-name">${label}</small>`;
        return `<div class="doll-slot rarity-${item ? rarity : 'common'}" title="${escHtml(title)}">${inner}</div>`;
    }

    equipment.innerHTML = `<div class="paper-doll">${rows.map(row =>
        `<div class="doll-row">${row.map(renderSlot).join('')}</div>`
    ).join('')}</div>`;
}


function getMinimapCellStyle(x, y) {
    if (!gameState.revealed[y]?.[x]) return { bg: '#080808', title: 'Unexplored', cls: '' };
    const tile = gameState.dungeon[y][x];
    if (isPlayerAt(x, y)) return { bg: '#4fc3f7', title: 'You', cls: 'minimap-player' };

    const enemy = findEnemyAt(x, y, 0);
    if (enemy) {
        const isBoss = enemy.type === 'boss';
        return {
            bg: isBoss ? '#ff6b35' : '#c62828',
            title: `${enemy.name} (${enemy.hp}/${enemy.maxHp})`,
            cls: isBoss ? 'minimap-boss' : 'minimap-enemy'
        };
    }

    const interactable = findInteractableAt(x, y);
    if (interactable) {
        const meta = WORLD_OBJECTS[interactable.kind];
        if (interactable.kind.startsWith('event_')) return { bg: '#62b9ff', title: meta?.label || 'Rare Event', cls: 'minimap-event' };
        if (interactable.kind.startsWith('chest_')) return { bg: meta?.color || '#c8a060', title: meta?.label || 'Chest', cls: 'minimap-chest' };
        if (interactable.kind.startsWith('discovery_')) return { bg: meta?.color || '#55c7ff', title: meta?.label || 'Discovery', cls: 'minimap-discovery' };
    }

    if (findItemAt(x, y)) return { bg: '#ffd65a', title: 'Item', cls: 'minimap-item' };
    if (tile === 3) return { bg: '#553232', title: 'Trap', cls: 'minimap-trap' };
    if (tile === 2) return { bg: '#9c6dff', title: 'Descend Stairs', cls: 'minimap-descend' };
    if (tile === TILE_ASCEND) return { bg: '#ffd65a', title: 'Ascend Stairs', cls: 'minimap-ascend' };
    if (tile === TILE_TAVERN_EXIT) return { bg: '#ffd65a', title: 'Tavern Exit', cls: 'minimap-ascend' };
    if (tile === 1) return { bg: '#555', title: 'Wall', cls: 'minimap-wall' };

    if (gameState.floor === 0) {
        const npcs = [
            gameState.innkeeper, gameState.merchant, gameState.blacksmith,
            gameState.trainer, gameState.bank, gameState.questBoard,
            gameState.dungeonEntrance, gameState.gambler, gameState.brewmaster,
            gameState.bard, gameState.magicDealer
        ];
        const npc = npcs.find(n => n && n.x === x && n.y === y);
        if (npc) return { bg: '#c8a060', title: npc.name, cls: 'minimap-npc' };
    }

    return { bg: '#1c1c1c', title: 'Floor', cls: 'minimap-floor' };
}


function getExploredPercent() {
    if (gameState.floor === 0) return 100;
    let total = 0;
    let seen = 0;
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (gameState.dungeon[y][x] === 1) continue;
            total++;
            if (gameState.revealed[y][x]) seen++;
        }
    }
    return total ? Math.round((seen / total) * 100) : 0;
}


function renderMinimap() {
    const minimap = document.getElementById('minimap');
    const floorEl = document.getElementById('minimap-floor');
    const exploredEl = document.getElementById('minimap-explored');
    if (!minimap) return;

    if (floorEl) {
        floorEl.textContent = gameState.floor === 0
            ? 'Tavern Hub'
            : `Floor ${gameState.floor} / ${MAX_DUNGEON_FLOOR}`;
    }
    if (exploredEl) {
        exploredEl.textContent = gameState.floor === 0
            ? 'Safe zone'
            : `${getExploredPercent()}% explored`;
    }

    minimap.innerHTML = '';
    minimap.style.display = 'grid';
    minimap.style.gridTemplateColumns = `repeat(${MAP_WIDTH}, 1fr)`;
    minimap.style.gridTemplateRows = `repeat(${MAP_HEIGHT}, 1fr)`;

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const cell = document.createElement('div');
            const { bg, title, cls } = getMinimapCellStyle(x, y);
            cell.className = `minimap-cell${cls ? ` ${cls}` : ''}`;
            cell.style.background = bg;
            cell.title = title;
            minimap.appendChild(cell);
        }
    }
}


// Tracks whether the crash banner is currently showing, so repeated
// failures (e.g. a bug that throws on every single frame) don't spam
// the DOM with duplicate banners or repeatedly steal focus.
let _renderCrashShown = false;

let _renderCrashLogCount = 0;


function gameLoop() {
    try {
        // Bot fast-display mode: skip the expensive full-canvas draw while the
        // bot is running with rendering suppressed. The loop itself keeps
        // running (input, audio, the bot's own minimap) — only the main game
        // canvas render is skipped, which is the single biggest per-frame cost.
        // We also enforce the canvas's hidden/visible state here, every frame,
        // so nothing (a run restart, a UI rebuild) can flash the big map back on
        // between bot ticks. Idempotent: only writes when the value differs.
        const _gc = (typeof document !== 'undefined') ? document.getElementById('game-canvas') : null;
        if (window._botSkipRender) {
            if (_gc && _gc.style.visibility !== 'hidden') _gc.style.visibility = 'hidden';
        } else {
            if (_gc && _gc.style.visibility === 'hidden') _gc.style.visibility = '';
            draw();
        }
    } catch (err) {
        // Log generously at first so the first occurrence is fully diagnosable,
        // then throttle — a bug that throws on every single frame (60/sec)
        // would otherwise flood the console and make it useless for finding
        // anything else.
        _renderCrashLogCount++;
        if (_renderCrashLogCount <= 3 || _renderCrashLogCount % 300 === 0) {
            console.error(`Rendering error in gameLoop (occurrence #${_renderCrashLogCount}) — frame skipped, loop continues:`, err);
        }
        if (!_renderCrashShown) {
            _renderCrashShown = true;
            showRenderCrashBanner();
        }
    }
    // Ambient soundscape — picks the right scene from gameState each frame.
    // Wrapped separately so an audio hiccup can never break the render loop.
    try { if (typeof updateAmbient === 'function') updateAmbient(); } catch (_) {}
    requestAnimationFrame(gameLoop);
}


// A rendering bug should never permanently freeze the game on a paying
// player's machine with zero explanation — that previously happened
// because gameLoop() had no error boundary, so one bad frame silently
// broke the requestAnimationFrame chain forever. This keeps the loop
// alive (the game keeps responding to input even if a visual glitch
// shows up) and tells the player something went wrong without dumping
// a raw stack trace on them. Full detail goes to the console for the
// developer to find via bug reports or Steam's crash logs.
function showRenderCrashBanner() {
    if (document.getElementById('render-crash-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'render-crash-banner';
    banner.innerHTML = `
        <span>A display glitch occurred. Your progress is safe — reloading is recommended.</span>
        <button onclick="window.location.reload()">Reload</button>
        <button onclick="document.getElementById('render-crash-banner').remove()">Dismiss</button>
    `;
    document.body.appendChild(banner);
}


function handleAction() {
    if (gameState.floor === 0) {
        // Direct dungeon entry: if adjacent to the entrance, descend immediately.
        // p.move() has too many NPC-bump guards that can intercept the movement,
        // so we bypass it entirely for this specific interaction.
        const p  = gameState.player;
        const ex = gameState.dungeonEntrance;
        if (p && ex && !gameState.inCourtyard && !gameState.inTown
            && Math.max(Math.abs(p.x - ex.x), Math.abs(p.y - ex.y)) <= 1) {
            // Move player onto the entrance tile and trigger descent
            p.x = ex.x;
            p.y = ex.y;
            p.renderX = ex.x * TILE_SIZE;
            p.renderY = ex.y * TILE_SIZE;
            checkInteractions();
            updateUI();
            return;
        }
        interactInTavern();
        return;
    }
    if (tryStairsInteraction()) return;
    if (tryOpenChest()) {
        gameState.player.regenMana();
        enemyTurn();
        refreshEnemyIntents();
        updateUI();
        return;
    }
    gameState.player.attack();
}


function clearArea(centerX, centerY, radius) {
    for (let y = centerY - radius; y <= centerY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            if (x > 0 && x < MAP_WIDTH - 1 && y > 0 && y < MAP_HEIGHT - 1) {
                gameState.dungeon[y][x] = 0;
            }
        }
    }
}


function getXpToLevel() {
    return gameState.player ? gameState.player.level * 25 : 25;
}


function getDistance(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
}


function isPlayerAt(x, y) {
    return gameState.player && gameState.player.x === x && gameState.player.y === y;
}


function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}


function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


// Validates that a value is a safe CSS color before it's interpolated into a
// style="color:..." attribute in an innerHTML string. Every color in the game
// is currently a developer-controlled hex/keyword literal, so this is purely
// defensive hardening: it guarantees that if a color value ever starts coming
// from dynamic or persisted data, a malformed value can't break out of the
// attribute and inject markup. Accepts #rgb/#rrggbb(/aa) hex, rgb()/rgba()/
// hsl()/hsla() functional notation, and plain alphabetic keywords (e.g.
// 'gold', 'red'); anything else falls back to a neutral default.
function safeColor(value, fallback = '#e8e8f0') {
    if (typeof value !== 'string') return fallback;
    const v = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
    if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/.test(v)) return v;
    if (/^[a-zA-Z]+$/.test(v)) return v;
    return fallback;
}


// ── Character Sheet ───────────────────────────────────────────────────────────

// ── In-game Help ────────────────────────────────────────────────────────
// A condensed, skimmable quick-reference — not the full manual. Reuses the
// cs-section/cs-row/cs-heading classes already styled for the character
// sheet so this doesn't need its own parallel set of content styles.
function openHelp() {
    if (gameState.shopOpen || gameState.awaitingLevelChoice) return;
    gameState.helpOpen = true;
    showHelpTab(gameState.lastHelpTab || 'controls');
    document.getElementById('help-panel').style.display = 'flex';
    updateUI();
}


function closeHelp() {
    gameState.helpOpen = false;
    document.getElementById('help-panel').style.display = 'none';
    updateUI();
}

// Opens the player's manual in a new tab.
// Works in browser; in Electron the main process intercepts window.open for
// local files and routes them through shell.openExternal.
function openManual() {
    window.open('manual.md', '_blank');
}


function showHelpTab(tab) {
    gameState.lastHelpTab = tab;
    ['controls', 'classes', 'gear', 'relics', 'tavern'].forEach(t => {
        const btn = document.getElementById(`help-tab-btn-${t}`);
        if (btn) btn.classList.toggle('help-tab-active', t === tab);
    });
    const renderers = {
        controls: renderHelpControls,
        classes: renderHelpClasses,
        gear: renderHelpGear,
        relics: renderHelpRelics,
        tavern: renderHelpTavern
    };
    const body = document.getElementById('help-body');
    if (body && renderers[tab]) body.innerHTML = renderers[tab]();
}


function renderHelpControls() {
    const rows = [
        ['WASD / Arrows', 'Move'],
        ['Space', 'Attack, or open a chest you\u2019re standing on'],
        ['E', 'Use your class ability'],
        ['1 \u2013 5', 'Potion / Antidote / Smoke Bomb / Rage Draught / Identify Scroll'],
        ['C', 'Character Sheet'],
        ['H', 'This help screen'],
        ['G', 'Donate gold to the bartender (near them)'],
        ['R', 'Restart'],
        ['Esc', 'Close the current panel']
    ];
    return `<div class="cs-section">
        <div class="cs-heading">Controls</div>
        ${rows.map(([k, v]) => `<div class="cs-row"><span class="cs-label">${k}</span><span class="cs-value">${v}</span></div>`).join('')}
    </div>
    <div class="cs-divider"></div>
    <div class="cs-section">
        <div class="cs-heading">The Basics</div>
        <p class="help-blurb">Choose a class at The Broken Flagon, explore the tavern (Floor 0), then descend through the cellar grate. The dungeon has 100 floors and gets harder as you go. A named boss waits every 5th floor &mdash; five of them are story milestones. Dying ends the run, but gold in the Bank, items in the Stash, and your Achievements all carry forward.</p>
    </div>`;
}


function renderHelpClasses() {
    const blurbs = [
        ['Warrior', 'High HP & DEF', 'Berserker, Knight, Gladiator'],
        ['Rogue', 'High crit & speed', 'Assassin, Trickster, Shadow'],
        ['Mage', 'Ranged magic, mana pool', 'Elementalist, Illusionist, Necromancer'],
        ['Cleric', 'Balanced stats, healing', 'War Domain, Light Domain, Twilight Domain']
    ];
    return `<div class="cs-section">
        <div class="cs-heading">Classes</div>
        ${blurbs.map(([name, desc, subs]) => `<div class="cs-row"><span class="cs-label">${name}</span><span class="cs-value">${desc}<span class="cs-note">${subs}</span></span></div>`).join('')}
    </div>
    <div class="cs-divider"></div>
    <div class="cs-section">
        <div class="cs-heading">Leveling Up</div>
        <p class="help-blurb">XP needed for your next level = 25 \u00d7 your current level. Leveling fully heals you and opens a choice banner automatically &mdash; pick one permanent bonus (more ATK, HP, DEF, Crit, Lifesteal, or Mana) right then.</p>
    </div>`;
}


function renderHelpGear() {
    const rarities = [
        ['Common', '52%'], ['Uncommon', '28%'], ['Rare', '13%'],
        ['Epic', '5.5%'], ['Legendary', '1.2%'], ['Mythic', '0.3%']
    ];
    return `<div class="cs-section">
        <div class="cs-heading">8 Equipment Slots</div>
        <p class="help-blurb">Weapon, Chest, Helmet, Shield, Boots (all stat-boosting) plus two independent Rings and an Amulet (special effects). If both rings are full, equipping a new one asks which to bench.</p>
    </div>
    <div class="cs-divider"></div>
    <div class="cs-section">
        <div class="cs-heading">Rarity Tiers</div>
        ${rarities.map(([name, chance]) => `<div class="cs-row"><span class="cs-label rarity-${name.toLowerCase()}">${name}</span><span class="cs-value">${chance} drop chance</span></div>`).join('')}
    </div>
    <div class="cs-divider"></div>
    <div class="cs-section">
        <div class="cs-heading">Cursed Items</div>
        <p class="help-blurb">About 15% of dungeon gear is cursed and shows as "?? Item" until identified. Cursed gear can\u2019t be unequipped or sold while enemies are on your floor. Legendary and Mythic items are never cursed.</p>
    </div>`;
}


function renderHelpRelics() {
    const relics = Object.values(RELIC_DEFS);
    return `<div class="cs-section">
        <div class="cs-heading">Relics &mdash; 5 Slots</div>
        <p class="help-blurb">Permanent run modifiers, separate from equipment. Found rarely in the dungeon (~2% of loot) or bought guaranteed from the Magic Dealer at a markup. Open the Relics tab to attune from your pouch or bench an equipped one.</p>
    </div>
    <div class="cs-divider"></div>
    <div class="cs-section">
        <div class="cs-heading">Known Relics</div>
        ${relics.map(r => `<div class="cs-row"><span class="cs-label rarity-${r.rarity}">${r.name}</span><span class="cs-value">${r.desc}</span></div>`).join('')}
    </div>`;
}


function renderHelpTavern() {
    const npcs = [
        ['Innkeeper', 'Fully restores HP/Mana, clears statuses \u2014 25g'],
        ['Merchant', 'Buy/sell potions and gear'],
        ['Blacksmith', 'Permanently upgrade your weapon +1 ATK'],
        ['Trainer', 'One-time +10 Max HP or +1 ATK per run'],
        ['Bank', 'Deposit gold \u2014 survives death'],
        ['Magic Dealer', 'Rare artifacts, accessories, and one guaranteed relic'],
        ['Notice Board', 'Accept gold-reward bounties'],
        ['Brewmaster', 'Temporary multi-floor stat trades'],
        ['Bard', 'Buy songs for run-long buffs'],
        ['Shared Stash', '3 slots \u2014 items here survive death'],
        ['Gambler', 'Flagon Dice \u2014 bet gold on Low/High/Triple']
    ];
    return `<div class="cs-section">
        <div class="cs-heading">The Broken Flagon (Floor 0)</div>
        ${npcs.map(([name, desc]) => `<div class="cs-row"><span class="cs-label">${name}</span><span class="cs-value">${desc}</span></div>`).join('')}
    </div>`;
}


function openCharSheet() {
    if (gameState.shopOpen || gameState.awaitingLevelChoice || !gameState.player) return;
    gameState.charSheetOpen = true;
    renderCharSheet();
    document.getElementById('charsheet-panel').style.display = 'flex';
    updateUI();
}


function closeCharSheet() {
    gameState.charSheetOpen = false;
    document.getElementById('charsheet-panel').style.display = 'none';
    updateUI();
}


// Copies the active run's seed code so it's easy to share with friends.
// navigator.clipboard requires a secure context (https:// or localhost) —
// it's unavailable under file://, which is how this game is normally
// distributed and played, so this always has a fallback: select the code
// text and let the browser's native copy shortcut work, with a message
// telling the player to use it. Either path confirms success visibly
// rather than failing silently if the Clipboard API call rejects.
function copySeedCode() {
    if (!gameState.runSeed) return;
    const code = seedToCode(gameState.runSeed);
    const codeEl = document.getElementById('charsheet-seed-code') || document.getElementById('gameover-seed-code');

    const showCopied = () => addMessageAndUpdate(`Seed code ${code} copied to clipboard.`);
    const showSelectFallback = () => {
        if (codeEl) {
            const range = document.createRange();
            range.selectNodeContents(codeEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
        addMessageAndUpdate(`Seed code ${code} selected — press Ctrl+C (or Cmd+C) to copy.`);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(showCopied).catch(showSelectFallback);
    } else {
        showSelectFallback();
    }
}


function renderCharSheet() {
    const p = gameState.player;
    p.equipment = migrateEquipment(p.equipment);
    const body = document.getElementById('charsheet-body');
    const wBonus = p.equipment.weapon ? p.equipment.weapon.bonus : 0;
    let aBonus = 0;
    DEF_GEAR_SLOTS.forEach(slot => { if (p.equipment[slot]) aBonus += p.equipment[slot].bonus; });

    function row(label, value, note) {
        return `<div class="cs-row"><span class="cs-label">${label}</span><span class="cs-value">${value}${note ? `<span class="cs-note">${note}</span>` : ''}</span></div>`;
    }

    function slotDetail(item, fallback) {
        if (!item) return `<span class="cs-value rarity-common">${fallback}</span>`;
        const hidden = item.cursed && !item.identified;
        const name = hidden ? '?? Item' : item.name;
        const stat = hidden ? '+??' : `+${item.bonus}${item.unit || ''}`;
        const tag = (item.cursed && item.identified) ? ' <span class="cursed-tag">CURSED</span>' : '';
        const desc = (!hidden && item.desc) ? ` — ${item.desc}` : '';
        return `<span class="cs-value rarity-${item.rarity}">${name} ${stat}${tag}${desc}</span>`;
    }

    const statusHtml = p.statuses.length
        ? p.statuses.map(s => {
            const meta = STATUS_META[s.type] || {};
            return `<span class="status-badge" style="--sc:${meta.color || '#888'}">${meta.icon || '?'} ${meta.label || s.type} (${s.turns})</span>`;
        }).join(' ')
        : '<span class="cs-muted">None</span>';

    const csCharDef = p.subclass ? (SUBCLASSES[p.className] || []).find(s => s.id === p.subclass) : null;
    const csClassLabel = capitalize(p.className) + (csCharDef ? ` — ${csCharDef.name}` : '');

    // Class portrait — prefers the gendered photo/illustration (warrior-m.png etc.);
    // falls back to the existing SVG silhouette when the image hasn't been added yet.
    const portrait = (typeof getClassPortrait === 'function') ? getClassPortrait(p.className) : null;
    // p.gender requires the updated entities.js; fall back to ccState (last
    // character-creation choice) so the portrait is always correct.
    const gender = p.gender || (typeof ccState !== 'undefined' && ccState.gender) || 'm';
    const portraitImgSrc = `${p.className}-${gender}.png`;
    const accentColor = portrait ? portrait.accent : '#c8922a';
    const portraitTag  = portrait ? portrait.tag   : 'Adventurer';
    const svgFallback  = portrait
        ? `<svg class="cs-portrait-svg" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" style="display:none">${portrait.svg}</svg>`
        : '';
    const portraitHtml = `
        <div class="cs-portrait" style="--cs-accent:${accentColor}">
            <div class="cs-portrait-frame">
                <div class="cs-portrait-glow"></div>
                <img class="cs-portrait-photo"
                     src="${escHtml(portraitImgSrc)}"
                     alt="${escHtml(csClassLabel)}"
                     onerror="this.style.display='none';var s=this.nextElementSibling;if(s)s.style.display='block'"
                     onload="var s=this.nextElementSibling;if(s)s.style.display='none'" />
                ${svgFallback}
            </div>
            <div class="cs-portrait-caption">
                <span class="cs-portrait-name">${escHtml(csClassLabel)}</span>
                <span class="cs-portrait-tag">${escHtml(portraitTag)}</span>
            </div>
        </div>`;

    body.innerHTML = `
        ${portraitHtml}
        <div class="cs-section">
            ${p.name ? row('Name', escHtml(p.name)) : ''}
            ${row('Class', csClassLabel)}
            ${row('Level', p.level)}
            ${row('XP', `${p.xp} / ${getXpToLevel()}`)}
            ${row('Gold', `${p.gold}g`)}
            ${row('Seed Code', `<span id="charsheet-seed-code">${gameState.runSeed ? seedToCode(gameState.runSeed) : '—'}</span> <button class="cs-seed-copy-btn" onclick="copySeedCode()" title="Copy seed code">Copy</button>`)}
        </div>
        <div class="cs-divider"></div>
        <div class="cs-section">
            <div class="cs-heading">Combat Stats</div>
            ${row('HP', `${p.hp} / ${p.maxHp}`)}
            ${row('Attack', p.atk, `(base ${p.baseAtk} + weapon ${wBonus})`)}
            ${row('Defense', p.def, `(base ${p.baseDef} + gear ${aBonus})`)}
            ${row('Crit Chance', `${p.critChance}%`)}
            ${row('Lifesteal', `${p.lifesteal}%`)}
            ${row('Gold Find', `${p.goldFind}%`)}
            ${row('Thorns', `${p.thorns}%`)}
            ${p.maxMana > 0 ? row('Mana', `${p.mana} / ${p.maxMana}`) : ''}
            ${p.maxMana > 0 ? row('Mana Regen', `+${1 + p.manaRegenBonus}/turn`) : ''}
        </div>
        <div class="cs-divider"></div>
        <div class="cs-section">
            <div class="cs-heading">Status Effects</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${statusHtml}</div>
        </div>
        <div class="cs-divider"></div>
        <div class="cs-section">
            <div class="cs-heading">Equipment</div>
            ${GEAR_SLOTS.map(slot => `<div class="cs-gear-row"><span class="cs-label">${SLOT_LABELS[slot]}</span>${slotDetail(p.equipment[slot], 'Empty')}</div>`).join('')}
        </div>
    `;
}


// ── Settings panel ────────────────────────────────────────────────────────────

function openSettings() {
    gameState.settingsOpen = true;
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'flex';
    renderSettings();
    showSettingsTab('audio'); // always open on the first tab
    updateUI();
}

// ── Settings tab switching ──────────────────────────────────────────────────
function showSettingsTab(tab) {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    panel.querySelectorAll('.settings-tab').forEach(btn => {
        btn.classList.toggle('settings-tab-active', btn.dataset.tab === tab);
    });
    panel.querySelectorAll('.settings-pane').forEach(pane => {
        pane.classList.toggle('settings-pane-active', pane.dataset.pane === tab);
    });
    // Re-render keybindings when switching to the Controls tab (in case they
    // changed) and only then — keeps the panel cheap to open.
    if (tab === 'controls' && typeof renderKeyBindings === 'function') {
        renderKeyBindings();
    }
}

// ── Particle density setting ────────────────────────────────────────────────
function onParticleDensityChange(val) {
    const pct = Math.max(0, Math.min(100, parseInt(val) || 0));
    const valEl = document.getElementById('settings-particles-val');
    if (valEl) valEl.textContent = `${pct}%`;
    // Stored as a 0..1 multiplier the render layer reads when spawning particles.
    window._particleDensity = pct / 100;
    try { localStorage.setItem('brokenflagon_particle_density', String(pct)); } catch (_) {}
}

// ── Data management ─────────────────────────────────────────────────────────
function confirmResetProgress() {
    if (!confirm('Reset ALL progress? This erases meta progress, banked gold, the stash, achievements, and renown. This cannot be undone.')) return;
    try {
        ['dungeon_crawler_meta', 'dungeon_crawler_best_floor', 'brokenflagon_runhistory']
            .forEach(k => localStorage.removeItem(k));
        location.reload();
    } catch (_) {}
}

function confirmClearSaveSlots() {
    if (!confirm('Delete all named save slots? This cannot be undone.')) return;
    try {
        localStorage.removeItem('brokenflagon_saveslots');
        if (typeof renderSaveSlots === 'function') renderSaveSlots();
        alert('Save slots cleared.');
    } catch (_) {}
}

// ── Spellbook panel ─────────────────────────────────────────────────────────
function renderSpellbook() {
    const panel = document.getElementById('spellbook-panel');
    const list = document.getElementById('spellbook-list');
    const manaEl = document.getElementById('spellbook-mana');
    if (!panel || !list) return;
    const p = gameState.player;
    if (!p) return;

    panel.style.display = 'flex';
    if (manaEl) manaEl.textContent = `${p.mana}/${p.maxMana} Mana`;

    const book = (typeof SPELLBOOK !== 'undefined' && SPELLBOOK[p.className]) || [];
    list.innerHTML = '';

    book.forEach(spell => {
        const unlocked = p.level >= spell.unlockLevel;
        const affordable = p.mana >= spell.mana;
        const castable = unlocked && affordable;

        const row = document.createElement('button');
        row.className = 'spell-row' + (castable ? '' : ' spell-locked');
        row.disabled = !castable;
        if (castable) row.onclick = () => castSpell(spell.id);

        const lockNote = !unlocked
            ? `<span class="spell-lock">Unlocks at Lv${spell.unlockLevel}</span>`
            : (!affordable ? `<span class="spell-lock">Needs ${spell.mana} mana</span>` : '');

        row.innerHTML = `
            <span class="spell-icon">${spell.icon}</span>
            <span class="spell-info">
                <span class="spell-name">${spell.name} ${lockNote}</span>
                <span class="spell-desc">${spell.desc}</span>
            </span>
            <span class="spell-cost">${spell.mana}<span class="spell-cost-unit">mana</span></span>
        `;
        list.appendChild(row);
    });
}


function closeSettings() {
    gameState.settingsOpen = false;
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'none';
    updateUI();
}

// Syncs the panel's controls to the current gameSettings values. Called on
// open so the panel always reflects the persisted state.
function renderSettings() {
    const vol = document.getElementById('settings-volume');
    const volVal = document.getElementById('settings-volume-val');
    const mute = document.getElementById('settings-mute');
    const ambient = document.getElementById('settings-ambient');
    const shake = document.getElementById('settings-shake');
    const reduce = document.getElementById('settings-reduce-motion');
    const pct = Math.round(gameSettings.masterVolume * 100);
    if (vol) vol.value = pct;
    if (volVal) volVal.textContent = `${pct}%`;
    if (mute) mute.checked = gameSettings.muted;
    if (ambient) ambient.checked = gameSettings.ambientEnabled !== false;
    if (shake) shake.checked = gameSettings.screenShake;
    if (reduce) reduce.checked = gameSettings.reduceMotion;
    // Particle density — load from storage (default 100%)
    const particles = document.getElementById('settings-particles');
    const particlesVal = document.getElementById('settings-particles-val');
    let density = 100;
    try { const saved = localStorage.getItem('brokenflagon_particle_density'); if (saved !== null) density = parseInt(saved); } catch (_) {}
    if (Number.isNaN(density)) density = 100;
    window._particleDensity = density / 100;
    if (particles) particles.value = density;
    if (particlesVal) particlesVal.textContent = `${density}%`;
    if (typeof renderKeyBindings === 'function') renderKeyBindings();
}

function onVolumeChange(value) {
    gameSettings.masterVolume = Math.max(0, Math.min(1, Number(value) / 100));
    const volVal = document.getElementById('settings-volume-val');
    if (volVal) volVal.textContent = `${Math.round(gameSettings.masterVolume * 100)}%`;
    applyAudioSettings();
    saveSettings();
}

function onMuteToggle(checked) {
    gameSettings.muted = !!checked;
    applyAudioSettings();
    saveSettings();
    // A short blip on UN-mute gives immediate feedback that sound is back.
    if (!gameSettings.muted) sfxItemPickup();
}


function onAmbientToggle(checked) {
    gameSettings.ambientEnabled = !!checked;
    if (typeof setAmbientEnabled === 'function') setAmbientEnabled(gameSettings.ambientEnabled);
    saveSettings();
}

function onShakeToggle(checked) {
    gameSettings.screenShake = !!checked;
    saveSettings();
}

function onReduceMotionToggle(checked) {
    gameSettings.reduceMotion = !!checked;
    saveSettings();
}

// ── Keybindings panel ───────────────────────────────────────────────────────

// Human-readable labels for each action, used in the settings UI.
const KB_ACTION_LABELS = {
    moveUp:     'Move Up',
    moveDown:   'Move Down',
    moveLeft:   'Move Left',
    moveRight:  'Move Right',
    action:     'Interact / Attack',
    descend:    'Descend Stairs',
    ability:    'Class Ability',
    potion:     'Health Potion',
    antidote:   'Antidote',
    smokebomb:  'Smoke Bomb',
    rage:       'Rage Draught',
    identify:   'Identify Scroll',
    capture:    'Capture Cage',
    charsheet:  'Character Sheet',
    help:       'Help',
    settings:   'Settings',
    bestiary:   'Bestiary',
    donate:     'Donate Gold',
    tavern:     'Return to Tavern',
};

// Track which action is currently being rebound (waiting for keypress).
let _kbPendingAction = null;
let _kbKeydownHandler = null;

function renderKeyBindings() {
    const grid = document.getElementById('keybindings-grid');
    if (!grid) return;
    const kb = (typeof getKeyBindings === 'function') ? getKeyBindings() : {};
    grid.innerHTML = '';
    Object.entries(KB_ACTION_LABELS).forEach(([action, label]) => {
        const bound = kb[action] || '—';
        const displayKey = bound === ' ' ? 'Space' : bound;
        const row = document.createElement('div');
        row.className = 'kb-row' + (_kbPendingAction === action ? ' kb-row-listening' : '');
        row.innerHTML = `
            <span class="kb-label">${escHtml(label)}</span>
            <button class="kb-key-btn${_kbPendingAction === action ? ' kb-listening' : ''}"
                    data-action="${escHtml(action)}"
                    onclick="onKeyBindingClick('${escHtml(action)}')"
                    title="Click to remap">
                ${_kbPendingAction === action ? '…' : escHtml(displayKey)}
            </button>
        `;
        grid.appendChild(row);
    });
}

function onKeyBindingClick(action) {
    // Cancel any in-progress remap first
    _cancelKbListen();
    _kbPendingAction = action;
    renderKeyBindings();

    // Listen for the next keydown globally; store the new binding
    _kbKeydownHandler = function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
            _cancelKbListen();
            renderKeyBindings();
            return;
        }
        const newKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        // Don't allow binding to keys we always intercept system-wide
        const forbidden = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','Tab','CapsLock'];
        if (forbidden.includes(e.key)) {
            _cancelKbListen();
            renderKeyBindings();
            return;
        }
        // Save the new binding
        if (!gameSettings.keyBindings || typeof gameSettings.keyBindings !== 'object') {
            gameSettings.keyBindings = {};
        }
        gameSettings.keyBindings[action] = newKey;
        saveSettings();
        _cancelKbListen();
        renderKeyBindings();
    };
    document.addEventListener('keydown', _kbKeydownHandler, { capture: true, once: true });
}

function _cancelKbListen() {
    _kbPendingAction = null;
    if (_kbKeydownHandler) {
        document.removeEventListener('keydown', _kbKeydownHandler, { capture: true });
        _kbKeydownHandler = null;
    }
}

function resetKeyBindings() {
    gameSettings.keyBindings = null;
    saveSettings();
    _cancelKbListen();
    renderKeyBindings();
}


// ── Bestiary / Codex panel ─────────────────────────────────────────────────────

function openBestiary() {
    gameState.bestiaryOpen = true;
    const panel = document.getElementById('bestiary-panel');
    if (panel) panel.style.display = 'flex';
    renderBestiary();
    updateUI();
}

function closeBestiary() {
    gameState.bestiaryOpen = false;
    const panel = document.getElementById('bestiary-panel');
    if (panel) panel.style.display = 'none';
    updateUI();
}

function renderBestiary() {
    const grid = document.getElementById('bestiary-grid');
    const countEl = document.getElementById('bestiary-count');
    if (!grid) return;

    const progress = getBestiaryProgress();
    const pct = progress.total > 0 ? Math.round((progress.discovered / progress.total) * 100) : 0;
    if (countEl) countEl.textContent = `${progress.discovered} / ${progress.total}`;

    // Progress bar in the header
    const headerEl = document.getElementById('bestiary-header');
    let progBar = document.getElementById('bestiary-prog-bar');
    if (!progBar && headerEl) {
        progBar = document.createElement('div');
        progBar.id = 'bestiary-prog-bar';
        progBar.className = 'bestiary-prog-bar';
        headerEl.insertAdjacentElement('afterend', progBar);
    }
    if (progBar) {
        progBar.innerHTML = `
            <div class="bpb-track"><div class="bpb-fill" style="width:${pct}%"></div></div>
            <span class="bpb-label">${pct}% discovered</span>`;
    }

    // Find max kills for relative bar scaling
    const allEntries = getBestiaryTypes().map(t => getBestiaryEntry(t));
    const maxKills = Math.max(1, ...allEntries.map(e => e.kills || 0));

    grid.innerHTML = getBestiaryTypes().map((type, idx) => {
        const entry = getBestiaryEntry(type);
        const def = ENEMY_TYPES[type];
        const lore = BESTIARY_LORE[type] || { title: capitalize(type), lore: 'A creature of the dungeon.' };

        if (!entry.seen) {
            return `<div class="bestiary-card bestiary-locked" style="animation-delay:${idx * 0.03}s">
                <div class="bestiary-sprite bestiary-sprite-locked">?</div>
                <div class="bestiary-info">
                    <div class="bestiary-name">???</div>
                    <div class="bestiary-undiscovered">Not yet encountered</div>
                </div>
            </div>`;
        }

        const sprite = (typeof getEnemySprite === 'function') ? getEnemySprite(type) : null;
        const spriteHtml = sprite
            ? `<img src="${sprite.src}" alt="${escHtml(lore.title)}" class="bestiary-sprite-img" />`
            : `<div class="bestiary-sprite" style="color:${safeColor(def.color)}">${escHtml(def.glyph)}</div>`;

        const killPct = Math.round((entry.kills / maxKills) * 100);
        const firstFloor = entry.firstFloor || '?';

        return `<div class="bestiary-card" style="--bc:${safeColor(def.color)}; animation-delay:${idx * 0.03}s">
            <div class="bestiary-portrait">
                ${spriteHtml}
            </div>
            <div class="bestiary-info">
                <div class="bestiary-name" style="color:${safeColor(def.color)}">${escHtml(lore.title)}</div>
                <div class="bestiary-stat-bars">
                    <div class="bsb" title="HP ${def.hp}">
                        <span class="bsb-icon">\u2665</span>
                        <div class="bsb-track"><div class="bsb-fill bsb-hp" style="width:${Math.min(100, def.hp / 2)}%"></div></div>
                        <span class="bsb-val">${def.hp}</span>
                    </div>
                    <div class="bsb" title="ATK ${def.atk}">
                        <span class="bsb-icon">\u2694</span>
                        <div class="bsb-track"><div class="bsb-fill bsb-atk" style="width:${Math.min(100, def.atk * 3)}%"></div></div>
                        <span class="bsb-val">${def.atk}</span>
                    </div>
                    <div class="bsb" title="DEF ${def.def}">
                        <span class="bsb-icon">\u26E1</span>
                        <div class="bsb-track"><div class="bsb-fill bsb-def" style="width:${Math.min(100, def.def * 5)}%"></div></div>
                        <span class="bsb-val">${def.def}</span>
                    </div>
                </div>
                <div class="bestiary-lore">${escHtml(lore.lore)}</div>
                <div class="bestiary-meta">
                    <span class="bestiary-kills">${entry.kills} slain</span>
                    <span class="bestiary-floor">First seen: F${firstFloor}</span>
                </div>
                <div class="bestiary-kill-bar">
                    <div class="bkb-fill" style="width:${killPct}%"></div>
                </div>
            </div>
        </div>`;
    }).join('');
}


function renderMetaProgress() {
    const goldEl  = document.getElementById('meta-gold');
    const depthEl = document.getElementById('meta-depth');
    const runsEl  = document.getElementById('meta-runs');
    const bossEl  = document.getElementById('meta-bosses');
    if (goldEl)  goldEl.textContent  = gameMeta.totalGold.toLocaleString();
    if (depthEl) depthEl.textContent = gameState.bestFloor;
    if (runsEl)  runsEl.textContent  = gameMeta.runs;
    if (bossEl)  bossEl.textContent  = gameMeta.bossesSlain;
}
