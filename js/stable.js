// ── Monster Stable (Option 1 — run-scoped) ─────────────────────────────────────
// A management view for the creatures you've captured THIS run. Captures live in
// gameState.capturedCreatures (lost on death) — the Stable doesn't change that;
// it's a nicer home for displaying, selling, and releasing them, alongside the
// existing "fight in the Pit" path (which stays in the Arena panel).
//
// Deliberately NOT persistent: making captures survive death is a separate,
// balance-sensitive feature (see STABLE_AND_WORLDMAP_SCOPING.md, Option 2).

function openStable() {
    if (typeof gameState !== 'undefined' && gameState) gameState.stableOpen = true;
    const panel = document.getElementById('stable-panel');
    if (panel) panel.style.display = 'flex';
    renderStable();
    if (typeof updateUI === 'function') updateUI();
}

function closeStable() {
    if (typeof gameState !== 'undefined' && gameState) gameState.stableOpen = false;
    const panel = document.getElementById('stable-panel');
    if (panel) panel.style.display = 'none';
    if (typeof updateUI === 'function') updateUI();
}

function renderStable() {
    const listEl = document.getElementById('stable-list');
    const countEl = document.getElementById('stable-count');
    if (!listEl) return;

    const creatures = (typeof gameState !== 'undefined' && gameState && gameState.capturedCreatures) || [];
    const max = (typeof MAX_CAPTURED !== 'undefined') ? MAX_CAPTURED : 5;
    if (countEl) countEl.textContent = `${creatures.length}/${max}`;

    if (!creatures.length) {
        listEl.innerHTML = `<p class="stable-empty">Your stable is empty. Weaken an enemy below 30% HP in the dungeon, then use a Capture Net (key 6) to cage it.</p>`;
        return;
    }

    const safeColor = (typeof window !== 'undefined' && typeof window.safeColor === 'function')
        ? window.safeColor : (c => c || '#c98bff');
    const esc = (typeof escHtml === 'function') ? escHtml : (s => String(s));

    listEl.innerHTML = creatures.map((c, i) => {
        const sellVal = (typeof captureSellValue === 'function') ? captureSellValue(c) : (c.goldBase || 20);
        const hpPct = c.maxHp ? Math.round((c.hp / c.maxHp) * 100) : 100;
        return `<div class="stable-card">
            <div class="stable-card-head">
                <span class="stable-glyph" style="color:${safeColor(c.color)}">${esc(c.glyph || '?')}</span>
                <div class="stable-card-names">
                    <span class="stable-name">${esc(c.name || 'Creature')}</span>
                    <span class="stable-origin">Caught on Floor ${c.floorCaptured || '?'}</span>
                </div>
            </div>
            <div class="stable-stats">
                <span class="stable-stat"><b>${c.hp || 0}</b><small>HP</small></span>
                <span class="stable-stat"><b>${c.atk || 0}</b><small>ATK</small></span>
                <span class="stable-stat"><b>${c.def || 0}</b><small>DEF</small></span>
                <span class="stable-stat"><b>${hpPct}%</b><small>COND</small></span>
            </div>
            <div class="stable-actions">
                <button class="stable-btn stable-btn-fight" onclick="_stableFight(${i})" title="Send to the Pit as an opponent (opens the Arena)">&#9876; Fight in Pit</button>
                <button class="stable-btn stable-btn-sell" onclick="sellCapture(${i})" title="Sell to a Pit broker">&#128176; Sell ${sellVal}g</button>
                <button class="stable-btn stable-btn-release" onclick="releaseCapture(${i})" title="Release for 8g">Release</button>
            </div>
        </div>`;
    }).join('');
}

// "Fight in Pit" from the stable just routes the player to the Arena panel,
// where the existing capture-bout flow lives — no duplicate fight logic.
function _stableFight(idx) {
    closeStable();
    if (typeof openArena === 'function') {
        openArena();
        // Pre-select the capture bout if the arena selection helper exists.
        if (typeof selectArenaBout === 'function') {
            setTimeout(() => { try { selectArenaBout(idx, 'capture'); } catch (_) {} }, 60);
        }
    } else {
        if (typeof addMessage === 'function') addMessage('The Pit is not available right now.');
    }
}
