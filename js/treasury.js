// ── Treasury Module (Phase 5) ──────────────────────────────────────────────────
// Permanent meta-progression spend tree for Flagon Coins.
//
// Architecture (Hybrid model — Migration Foundation §2):
//   gameMeta.flagonCoins  — balance (never lost on death)
//   gameMeta.treasurySpent — { nodeId: true } purchased nodes
//   getTreasuryLevel()    — derived from node count (save.js, never stored)
//
// Invariant: Flagon Coins never touch gameState.player or SAVE_KEY_RUN.
// Renown = world reputation (narrative). Flagon Coins = power upgrades.
//
// Integration hooks (call earnFlagonCoins from):
//   combat.js   → boss kill       (+3 coins)
//   save.js     → milestone floor (+2 coins, first-time only)
//   arena.js    → Pit victory     (+2 coins, call from gainPitFame)
//   main.js     → achievement     (+5 coins, call from checkAchievements)

// ── Upgrade node definitions ──────────────────────────────────────────────────
//
// tier:     which TREASURY_TIERS band unlocks this row
// requires: array of nodeIds that must be purchased first
// effect:   plain-text description of what the node actually does in the engine
//           (the game logic that reads these flags should check isTreasuryUnlocked)

const TREASURY_UPGRADES = [

    // ── Tier 1 — always visible, no prerequisites ──────────────────────────
    {
        id: 'bankExpansion',
        tier: 1, cost: 5,
        icon: '🏦',
        name: 'Vault Expansion',
        desc: 'Raise the bank vault cap by 200g. Stackable — buy up to 3 times.',
        requires: [],
    },
    {
        id: 'pitPatron',
        tier: 1, cost: 5,
        icon: '⚔',
        name: 'Pit Patron',
        desc: 'Pit bout gold rewards increased by 10%.',
        requires: [],
    },
    {
        id: 'ashDelver',
        tier: 1, cost: 5,
        icon: '🕯',
        name: 'Ash Delver',
        desc: 'Start every run with one extra Health Potion in your pack.',
        requires: [],
    },

    // ── Tier 2 — need 3 nodes ──────────────────────────────────────────────
    {
        id: 'renownAmplifier',
        tier: 2, cost: 10,
        icon: '🌟',
        name: 'Renowned Patron',
        desc: 'Earn Tavern Renown 20% faster from all sources.',
        requires: ['bankExpansion', 'pitPatron'],
    },
    {
        id: 'coinSense',
        tier: 2, cost: 10,
        icon: '🪙',
        name: 'Coin Sense',
        desc: '+8% gold find on all dungeon runs.',
        requires: ['bankExpansion', 'ashDelver'],
    },
    {
        id: 'pitStanding',
        tier: 2, cost: 8,
        icon: '🏟',
        name: 'Pit Standing',
        desc: 'The Pit unlocks at Floor 15 instead of 20 (Gladiators already bypass this).',
        requires: ['pitPatron'],
    },

    // ── Tier 3 — need 6 nodes ──────────────────────────────────────────────
    {
        id: 'stashExpansion',
        tier: 3, cost: 20,
        icon: '📦',
        name: 'Expanded Stash',
        desc: 'Add a 4th slot to the Shared Stash.',
        requires: ['coinSense', 'renownAmplifier'],
    },
    {
        id: 'gauntletBloodlines',
        tier: 3, cost: 20,
        icon: '🩸',
        name: 'Gauntlet Bloodlines',
        desc: 'Each Pit Gauntlet tier gains one extra wave and a 10% reward bonus.',
        requires: ['pitStanding', 'renownAmplifier'],
    },
    {
        id: 'ashScholar',
        tier: 3, cost: 20,
        icon: '📜',
        name: 'Ash Scholar',
        desc: '+5% XP from all dungeon enemy kills.',
        requires: ['ashDelver', 'coinSense'],
    },

    // ── Tier 4 — need 10 nodes (T4 is aspiration-tier content) ───────────
    {
        id: 'legendaryCache',
        tier: 4, cost: 35,
        icon: '💎',
        name: 'Legendary Cache',
        desc: '+3% legendary drop rate across all dungeon floors.',
        requires: ['stashExpansion', 'ashScholar'],
    },
    {
        id: 'pitLegacy',
        tier: 4, cost: 35,
        icon: '🏆',
        name: 'Pit Legacy',
        desc: 'Pit fame carries a +15% bonus to betting odds at all tiers.',
        requires: ['gauntletBloodlines', 'stashExpansion'],
    },
];


// ── State helpers ─────────────────────────────────────────────────────────────

function isTreasuryUnlocked(nodeId) {
    return !!(gameMeta.treasurySpent && gameMeta.treasurySpent[nodeId]);
}

function canUnlockTreasury(node) {
    if (isTreasuryUnlocked(node.id)) return false;
    if ((gameMeta.flagonCoins || 0) < node.cost) return false;
    return node.requires.every(req => isTreasuryUnlocked(req));
}

// Total nodes purchased (used to show total spend without storing level).
function treasuryNodeCount() {
    return Object.keys(gameMeta.treasurySpent || {}).length;
}


// ── Earning ───────────────────────────────────────────────────────────────────
// Call this from wherever coins are awarded. Saves meta immediately so coins
// survive even if the player dies before returning to the tavern.

function earnFlagonCoins(amount, reason) {
    if (!amount || amount <= 0) return;
    gameMeta.flagonCoins = (gameMeta.flagonCoins || 0) + amount;
    if (typeof saveMetaProgress === 'function') saveMetaProgress();
    const msg = `+${amount} Flagon Coin${amount !== 1 ? 's' : ''}${reason ? ` (${reason})` : ''}`;
    if (typeof addMessage === 'function') addMessage(msg);
    if (typeof addFloatingText === 'function' && gameState.player) {
        addFloatingText(gameState.player.x, gameState.player.y, `+${amount}🪙`, '#ffd65a');
    }
}


// ── Spending ──────────────────────────────────────────────────────────────────

function buyTreasuryNode(nodeId) {
    const node = TREASURY_UPGRADES.find(n => n.id === nodeId);
    if (!node) return;
    if (!canUnlockTreasury(node)) {
        if (typeof addMessage === 'function') {
            if (isTreasuryUnlocked(nodeId)) {
                addMessage('Already unlocked.');
            } else if ((gameMeta.flagonCoins || 0) < node.cost) {
                addMessage(`Need ${node.cost} Flagon Coins (you have ${gameMeta.flagonCoins || 0}).`);
            } else {
                addMessage('Unlock the required nodes first.');
            }
        }
        return;
    }

    gameMeta.flagonCoins = (gameMeta.flagonCoins || 0) - node.cost;
    if (!gameMeta.treasurySpent) gameMeta.treasurySpent = {};
    gameMeta.treasurySpent[nodeId] = true;
    if (typeof saveMetaProgress === 'function') saveMetaProgress();
    if (typeof addMessage === 'function') {
        addMessage(`✓ Treasury: ${node.name} unlocked! (−${node.cost} Flagon Coins)`);
    }
    if (typeof showEventCard === 'function') {
        showEventCard('TREASURY', node.name, 'milestone');
    }
    renderTreasury();
    if (typeof updateUI === 'function') updateUI();
}


// ── Panel ─────────────────────────────────────────────────────────────────────

function openTreasury() {
    if (gameState) gameState.treasuryOpen = true;
    const panel = document.getElementById('treasury-panel');
    if (panel) panel.style.display = 'flex';
    renderTreasury();
    if (typeof updateUI === 'function') updateUI();
}

function closeTreasury() {
    if (gameState) gameState.treasuryOpen = false;
    const panel = document.getElementById('treasury-panel');
    if (panel) panel.style.display = 'none';
    if (typeof updateUI === 'function') updateUI();
}

function renderTreasury() {
    // ── Header stats ──────────────────────────────────────────────────────
    const coinsEl  = document.getElementById('treasury-coins-val');
    const levelEl  = document.getElementById('treasury-level-badge');
    const spentEl  = document.getElementById('treasury-spent-count');

    const coins = gameMeta.flagonCoins || 0;
    const level = typeof getTreasuryLevel === 'function' ? getTreasuryLevel() : 1;
    const spent = treasuryNodeCount();

    if (coinsEl)  coinsEl.textContent  = coins;
    if (levelEl)  levelEl.textContent  = `Treasury Level ${level}`;
    if (spentEl)  spentEl.textContent  = `${spent} node${spent !== 1 ? 's' : ''} unlocked`;

    // Also update the title-screen coin counter if visible
    const tsCoin = document.getElementById('ts-coins');
    if (tsCoin) tsCoin.textContent = coins;

    // ── Node tree ─────────────────────────────────────────────────────────
    const nodesEl = document.getElementById('treasury-nodes');
    if (!nodesEl) return;

    // Group by tier
    const tiers = {};
    for (const node of TREASURY_UPGRADES) {
        if (!tiers[node.tier]) tiers[node.tier] = [];
        tiers[node.tier].push(node);
    }

    const TIER_LABELS = { 1: 'Foundation', 2: 'Advancement', 3: 'Mastery', 4: 'Legend' };
    const TIER_REQ    = { 1: 0, 2: 3, 3: 6, 4: 10 };

    nodesEl.innerHTML = Object.entries(tiers).map(([tier, nodes]) => {
        const tierNum = parseInt(tier);
        const req = TIER_REQ[tierNum] || 0;
        const tierUnlocked = spent >= req;
        const tierLabel = TIER_LABELS[tierNum] || `Tier ${tier}`;
        const tierLock  = tierUnlocked ? '' : ` <span class="tnode-locked-hint">(${req} nodes required)</span>`;

        const nodeHtml = nodes.map(node => {
            const owned    = isTreasuryUnlocked(node.id);
            const prereqs  = node.requires.every(r => isTreasuryUnlocked(r));
            const afford   = coins >= node.cost;
            const buyable  = canUnlockTreasury(node);

            let stateClass = 'tnode-locked';
            if (owned)       stateClass = 'tnode-owned';
            else if (!tierUnlocked || !prereqs) stateClass = 'tnode-prereq';
            else if (!afford) stateClass = 'tnode-costly';
            else              stateClass = 'tnode-available';

            const prereqNames = node.requires
                .filter(r => !isTreasuryUnlocked(r))
                .map(r => TREASURY_UPGRADES.find(n => n.id === r)?.name || r)
                .join(', ');

            return `
                <div class="treasury-node ${stateClass}"
                     ${buyable ? `onclick="buyTreasuryNode('${node.id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')buyTreasuryNode('${node.id}')"` : ''}>
                    <span class="tnode-icon">${node.icon}</span>
                    <div class="tnode-body">
                        <span class="tnode-name">${node.name}</span>
                        <span class="tnode-desc">${node.desc}</span>
                        ${prereqNames && !owned ? `<span class="tnode-prereq-hint">Requires: ${prereqNames}</span>` : ''}
                    </div>
                    <span class="tnode-cost">
                        ${owned ? '<span class="tnode-check">✓</span>' : `<span class="tnode-price">${node.cost}🪙</span>`}
                    </span>
                </div>`;
        }).join('');

        return `
            <div class="treasury-tier${tierUnlocked ? '' : ' treasury-tier-locked'}">
                <div class="treasury-tier-label">${tierLabel}${tierLock}</div>
                <div class="treasury-tier-nodes">${nodeHtml}</div>
            </div>`;
    }).join('');
}
