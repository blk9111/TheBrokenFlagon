// ── Hall of Legends (Trophy Hall) ──────────────────────────────────────────────
// A full-screen showcase of the player's permanent accomplishments: career
// records, current Pit rank, and the honorific titles they've earned. Read-only
// — every value is computed live from gameState / gameMeta. Pairs with the
// Profile panel (which links here) and the title system in data.js.

function openTrophyHall() {
    if (typeof gameState !== 'undefined' && gameState) gameState.trophyOpen = true;
    const panel = document.getElementById('trophy-panel');
    if (panel) panel.style.display = 'flex';
    renderTrophyHall();
    if (typeof updateUI === 'function') updateUI();
}

function closeTrophyHall() {
    if (typeof gameState !== 'undefined' && gameState) gameState.trophyOpen = false;
    const panel = document.getElementById('trophy-panel');
    if (panel) panel.style.display = 'none';
    if (typeof updateUI === 'function') updateUI();
}

function _trophyRecord(label, value, accent) {
    const color = accent ? ` style="color:${accent}"` : '';
    return `<div class="trophy-record">
        <span class="trophy-record-val"${color}>${value}</span>
        <span class="trophy-record-lbl">${label}</span>
    </div>`;
}

function renderTrophyHall() {
    // ── Records ───────────────────────────────────────────────────────────
    const recEl = document.getElementById('trophy-records');
    if (recEl) {
        const bestFloor = (typeof gameState !== 'undefined' && gameState && gameState.bestFloor) || 0;
        const bosses = gameMeta.bossesSlain || 0;
        const kills  = (gameMeta.stats && gameMeta.stats.totalKills) || 0;
        const gold   = gameMeta.totalGold || 0;
        const runs   = gameMeta.runs || 0;
        const pitWins = gameMeta.pitWins || 0;
        const relics = (gameMeta.stats && gameMeta.stats.relicsFound) || 0;
        const bestiaryCount = gameMeta.bestiary ? Object.keys(gameMeta.bestiary).length : 0;
        recEl.innerHTML =
            _trophyRecord('Best Floor', bestFloor, '#62b9ff') +
            _trophyRecord('Bosses Slain', bosses, '#ff9f3d') +
            _trophyRecord('Total Kills', kills) +
            _trophyRecord('Pit Victories', pitWins, '#ffd65a') +
            _trophyRecord('Gold Earned', gold + 'g', '#ffd65a') +
            _trophyRecord('Runs', runs) +
            _trophyRecord('Creatures Logged', bestiaryCount, '#c98bff');
    }

    // ── Current Pit Rank ──────────────────────────────────────────────────
    const rankEl = document.getElementById('trophy-pit-rank');
    if (rankEl) {
        if (typeof getPitTier === 'function') {
            const tier = getPitTier();
            const fame = typeof getPitFame === 'function' ? getPitFame() : 0;
            const next = typeof getNextPitTier === 'function' ? getNextPitTier() : null;
            const nextNote = next ? `${next.fame - fame} fame to ${next.title}` : 'Maximum rank achieved';
            rankEl.innerHTML = `<div class="trophy-rank-badge" style="border-color:${tier.color}">
                <span class="trophy-rank-title" style="color:${tier.color}">${tier.title}</span>
                <span class="trophy-rank-fame">${fame} Pit Fame · ${nextNote}</span>
            </div>`;
        } else {
            rankEl.innerHTML = '<p class="trophy-empty">The Pit awaits your first bout.</p>';
        }
    }

    // ── Titles ────────────────────────────────────────────────────────────
    const titlesEl = document.getElementById('trophy-titles');
    const countEl  = document.getElementById('trophy-title-count');
    if (titlesEl) {
        const { earned, locked } = (typeof getEarnedTitles === 'function')
            ? getEarnedTitles() : { earned: [], locked: [] };
        if (countEl) countEl.textContent = `(${earned.length}/${earned.length + locked.length})`;

        const earnedHtml = earned.map(t => `
            <div class="trophy-title trophy-title-earned">
                <span class="trophy-title-icon">&#10022;</span>
                <div class="trophy-title-body">
                    <span class="trophy-title-name">${t.name}</span>
                    <span class="trophy-title-desc">${t.desc}</span>
                </div>
                <span class="trophy-title-check">&#10003;</span>
            </div>`).join('');

        const lockedHtml = locked.map(t => `
            <div class="trophy-title trophy-title-locked">
                <span class="trophy-title-icon">&#128274;</span>
                <div class="trophy-title-body">
                    <span class="trophy-title-name">${t.name}</span>
                    <span class="trophy-title-desc">${t.desc}</span>
                </div>
            </div>`).join('');

        titlesEl.innerHTML = earnedHtml + lockedHtml ||
            '<p class="trophy-empty">No titles yet. Descend, fight, and earn your legend.</p>';
    }
}
