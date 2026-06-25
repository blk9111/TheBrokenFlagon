// ── Player Profile Panel ───────────────────────────────────────────────────────
// A read-only "who am I" shelf that consolidates the player's meta-identity:
// reputation (Pit fame/title, Tavern renown, Flagon coins), career totals
// (best floor, runs, deaths, kills, gold), and Arena rivalry records.
//
// Holds NO persistent state of its own — every value is read live from
// gameState / gameMeta at render time. Mirrors the treasury.js panel pattern.

function openProfile() {
    if (typeof gameState !== 'undefined' && gameState) gameState.profileOpen = true;
    const panel = document.getElementById('profile-panel');
    if (panel) panel.style.display = 'flex';
    renderProfile();
    if (typeof updateUI === 'function') updateUI();
}

function closeProfile() {
    if (typeof gameState !== 'undefined' && gameState) gameState.profileOpen = false;
    const panel = document.getElementById('profile-panel');
    if (panel) panel.style.display = 'none';
    if (typeof updateUI === 'function') updateUI();
}

// One stat cell: big value, small label beneath.
function _profStat(label, value, accent) {
    const color = accent ? ` style="color:${accent}"` : '';
    return `<div class="profile-stat">
        <span class="profile-stat-val"${color}>${value}</span>
        <span class="profile-stat-lbl">${label}</span>
    </div>`;
}

function renderProfile() {
    const p = (typeof gameState !== 'undefined' && gameState && gameState.player) ? gameState.player : null;

    // ── Identity header ───────────────────────────────────────────────────
    const nameEl = document.getElementById('profile-name');
    const subEl  = document.getElementById('profile-subtitle');
    if (nameEl) {
        const cls = p ? (typeof capitalize === 'function' ? capitalize(p.className || '') : (p.className || '')) : '';
        const display = (p && p.name) ? p.name : (cls || 'Champion');
        nameEl.textContent = display;
    }
    if (subEl) {
        if (p) {
            const cls = typeof capitalize === 'function' ? capitalize(p.className || '') : (p.className || '');
            const sub = p.subclass ? ` · ${p.subclass}` : '';
            subEl.textContent = `Level ${p.level || 1} ${cls}${sub}`;
        } else {
            subEl.textContent = 'No active run — totals reflect your full history.';
        }
    }

    // ── Reputation ────────────────────────────────────────────────────────
    const repEl = document.getElementById('profile-reputation');
    if (repEl) {
        const fame  = typeof getPitFame === 'function' ? getPitFame() : (gameMeta.pitFame || 0);
        const tier  = typeof getPitTier === 'function' ? getPitTier() : { title: 'Unknown', color: '#c98bff' };
        const renown = gameMeta.tavernRenown || 0;
        const coins  = gameMeta.flagonCoins || 0;
        const tLevel = typeof getTreasuryLevel === 'function' ? getTreasuryLevel() : 1;
        repEl.innerHTML =
            _profStat('Pit Fame', fame, '#c98bff') +
            _profStat('Pit Title', tier.title, tier.color) +
            _profStat('Tavern Renown', renown, '#ffd65a') +
            _profStat('Flagon Coins', coins + ' · Lv ' + tLevel, '#ffd65a');
    }

    // ── Career ────────────────────────────────────────────────────────────
    const careerEl = document.getElementById('profile-career');
    if (careerEl) {
        const bestFloor = (typeof gameState !== 'undefined' && gameState && gameState.bestFloor) || 0;
        const runs   = gameMeta.runs || 0;
        const deaths = gameMeta.deaths || 0;
        const bosses = gameMeta.bossesSlain || 0;
        const kills  = (gameMeta.stats && gameMeta.stats.totalKills) || 0;
        const gold   = gameMeta.totalGold || 0;
        const pitWins = gameMeta.pitWins || 0;
        const pitBouts = gameMeta.pitBouts || 0;
        careerEl.innerHTML =
            _profStat('Best Floor', bestFloor, '#62b9ff') +
            _profStat('Runs', runs) +
            _profStat('Deaths', deaths, '#ff6b6b') +
            _profStat('Bosses Slain', bosses, '#ff9f3d') +
            _profStat('Total Kills', kills) +
            _profStat('Pit Record', `${pitWins}-${Math.max(0, pitBouts - pitWins)}`, '#ffd65a') +
            _profStat('Gold Earned', gold + 'g', '#ffd65a');
    }

    // ── Rivalries ─────────────────────────────────────────────────────────
    const rivalsEl = document.getElementById('profile-rivals');
    if (rivalsEl) {
        const rivals = (gameMeta.rivals && typeof gameMeta.rivals === 'object') ? gameMeta.rivals : {};
        const champs = (typeof PIT_CHAMPIONS !== 'undefined') ? PIT_CHAMPIONS : [];
        // Build display rows for every champion that's been fought at least once,
        // sorted by total games (most-contested rivalry first).
        const rows = Object.keys(rivals)
            .map(id => {
                const r = rivals[id];
                const champ = champs.find(c => c.id === id);
                const name = champ ? champ.name : id;
                const total = (r.wins || 0) + (r.losses || 0);
                const flavor = (typeof rivalFlavor === 'function') ? rivalFlavor(id) : '';
                return { id, name, r, total, flavor };
            })
            .filter(x => x.total > 0)
            .sort((a, b) => b.total - a.total);

        if (!rows.length) {
            rivalsEl.innerHTML = '<p class="profile-empty">No rivalries yet. Challenge a champion in the Pit to begin your record.</p>';
        } else {
            rivalsEl.innerHTML = rows.map(x => {
                const win = x.r.wins || 0, loss = x.r.losses || 0;
                const winning = win > loss;
                const recordColor = winning ? '#6fce82' : (loss > win ? '#ff6b6b' : '#ffd65a');
                const flavorHtml = x.flavor
                    ? `<span class="profile-rival-flavor">${x.flavor}</span>` : '';
                return `<div class="profile-rival-row">
                    <span class="profile-rival-name">${x.name}</span>
                    ${flavorHtml}
                    <span class="profile-rival-record" style="color:${recordColor}">${win}–${loss}</span>
                </div>`;
            }).join('');
        }
    }
}
