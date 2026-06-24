/**
 * leaderboard.js — hooks into run-end events and shows a persistent
 * global leaderboard backed by the API server.
 *
 * Must be loaded AFTER ui.js, save.js, and data.js.
 */

(function () {
    'use strict';

    const API_BASE = 'https://broken-flagon-leaderboard.brian-kaut.workers.dev/api/leaderboard';

    /* ── CSS ─────────────────────────────────────────────────────────────── */
    const style = document.createElement('style');
    style.textContent = `
    /* ── Leaderboard modal ───────────────────────────────────────────── */
    #lb-modal-wrap {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(0,0,0,0.72);
        align-items: center;
        justify-content: center;
    }
    #lb-modal-wrap.lb-visible { display: flex; }

    #lb-modal {
        background: #1a1410;
        border: 1px solid rgba(255,214,90,0.35);
        border-radius: 6px;
        width: min(560px, 94vw);
        max-height: 88vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow:
            0 0 60px rgba(200,140,20,0.18),
            inset 0 1px 0 rgba(255,240,160,0.12);
        animation: lb-pop 0.22s cubic-bezier(.17,.67,.38,1.3) both;
    }
    @keyframes lb-pop {
        from { opacity:0; transform:scale(0.88) translateY(10px); }
        to   { opacity:1; transform:scale(1)    translateY(0);    }
    }

    #lb-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px 10px;
        border-bottom: 1px solid rgba(255,214,90,0.18);
    }
    #lb-title {
        font-size: 1.05rem;
        font-weight: 700;
        letter-spacing: .08em;
        color: #ffd65a;
        text-shadow: 0 0 12px rgba(255,180,40,0.5);
    }
    #lb-close {
        background: none;
        border: 1px solid rgba(255,255,255,0.15);
        color: #aaa;
        padding: 4px 10px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 0.78rem;
    }
    #lb-close:hover { border-color: #ffd65a; color: #ffd65a; }

    #lb-body {
        overflow-y: auto;
        padding: 14px 18px 18px;
        flex: 1;
    }
    #lb-body::-webkit-scrollbar { width: 6px; }
    #lb-body::-webkit-scrollbar-track { background: #111; }
    #lb-body::-webkit-scrollbar-thumb { background: rgba(255,214,90,0.25); border-radius:3px; }

    #lb-status {
        color: #888;
        font-size: 0.82rem;
        text-align: center;
        padding: 20px 0;
    }

    .lb-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82rem;
    }
    .lb-table th {
        color: #ffd65a;
        text-align: left;
        padding: 4px 8px 8px;
        font-size: 0.72rem;
        letter-spacing: .06em;
        text-transform: uppercase;
        border-bottom: 1px solid rgba(255,214,90,0.18);
    }
    .lb-table td {
        padding: 7px 8px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        color: #ccc;
        white-space: nowrap;
    }
    .lb-table tr:hover td { background: rgba(255,255,255,0.03); }
    .lb-table .lb-rank { color: #888; font-size:0.72rem; width:28px; }
    .lb-table .lb-name { color: #fff; font-weight: 600; max-width:110px; overflow:hidden; text-overflow:ellipsis; }
    .lb-table .lb-floor { color: #ffd65a; font-weight:700; text-align:right; }
    .lb-table .lb-victory { color: #4cff88; font-size:0.7rem; font-weight:700; letter-spacing:.04em; }
    .lb-table .lb-class  { color: #b0c0ff; }
    .lb-table .lb-kills  { color: #ff9966; text-align:right; }
    .lb-table .lb-gold   { color: #ffd65a; text-align:right; }
    .lb-table .lb-date   { color: #666; font-size:0.68rem; }

    /* Rank medals */
    .lb-medal-1 { color:#ffd700; text-shadow:0 0 6px rgba(255,200,0,0.7); }
    .lb-medal-2 { color:#c0c0c0; text-shadow:0 0 5px rgba(190,190,190,0.5); }
    .lb-medal-3 { color:#cd7f32; text-shadow:0 0 5px rgba(180,100,40,0.5); }

    /* ── In-game "🏆 Leaderboard" button on run-end screen ───────────── */
    #lb-open-btn {
        margin-top: 10px;
        padding: 7px 18px;
        background: rgba(255,214,90,0.08);
        border: 1px solid rgba(255,214,90,0.4);
        border-radius: 4px;
        color: #ffd65a;
        font-size: 0.82rem;
        cursor: pointer;
        letter-spacing: .05em;
        transition: background 0.15s, box-shadow 0.15s;
    }
    #lb-open-btn:hover {
        background: rgba(255,214,90,0.16);
        box-shadow: 0 0 12px rgba(255,180,40,0.2);
    }

    /* ── Submit status badge (shown briefly on run-end) ─────────────── */
    #lb-submit-badge {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 9998;
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 0.78rem;
        color: #fff;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s;
    }
    #lb-submit-badge.lb-badge-ok   { background: rgba(40,160,70,0.85); }
    #lb-submit-badge.lb-badge-err  { background: rgba(180,40,40,0.85); }
    #lb-submit-badge.lb-badge-show { opacity: 1; }
    `;
    document.head.appendChild(style);

    /* ── DOM: modal ──────────────────────────────────────────────────────── */
    const wrap = document.createElement('div');
    wrap.id = 'lb-modal-wrap';
    wrap.innerHTML = `
        <div id="lb-modal">
            <div id="lb-header">
                <span id="lb-title">🏆 &nbsp;Global Leaderboard</span>
                <button id="lb-close">✕ Close</button>
            </div>
            <div id="lb-body">
                <div id="lb-status">Loading…</div>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);

    /* ── DOM: submit badge ───────────────────────────────────────────────── */
    const badge = document.createElement('div');
    badge.id = 'lb-submit-badge';
    document.body.appendChild(badge);

    /* ── Close modal ─────────────────────────────────────────────────────── */
    function closeModal() {
        wrap.classList.remove('lb-visible');
    }
    document.getElementById('lb-close').addEventListener('click', closeModal);
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    /* ── Show badge ──────────────────────────────────────────────────────── */
    function showBadge(msg, ok) {
        badge.textContent = msg;
        badge.className = `lb-badge-show ${ok ? 'lb-badge-ok' : 'lb-badge-err'}`;
        setTimeout(() => { badge.className = ok ? 'lb-badge-ok' : 'lb-badge-err'; }, 2800);
    }

    /* ── Fetch & render leaderboard ──────────────────────────────────────── */
    async function fetchAndRender() {
        const body = document.getElementById('lb-body');
        body.innerHTML = '<div id="lb-status">Loading…</div>';
        try {
            const res = await fetch(`${API_BASE}?limit=20`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // The worker returns a bare array; tolerate a {entries:[...]} shape too
            // in case the backend contract changes, so a single side can be updated
            // without silently breaking the board.
            const data = await res.json();
            const entries = Array.isArray(data) ? data : (data && data.entries) || [];
            if (!entries || entries.length === 0) {
                body.innerHTML = '<div id="lb-status">No runs recorded yet — be the first!</div>';
                return;
            }
            const medals = ['lb-medal-1', 'lb-medal-2', 'lb-medal-3'];
            const rows = entries.map((e, i) => {
                const rank = i + 1;
                const medalCls = medals[i] || '';
                // Backend stores the timestamp as submittedAt; older/alt copies used createdAt.
                const date = new Date(e.submittedAt || e.createdAt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
                const victoryBadge = e.isVictory
                    ? '<span class="lb-victory">✓ VICTORY</span>'
                    : '';
                const name = escLb(e.playerName || 'Unknown');
                const cls  = escLb(capitalize(e.className || ''));
                const sub  = e.subclass ? `<br><span style="font-size:.68rem;color:#8899bb">${escLb(e.subclass)}</span>` : '';
                return `<tr>
                    <td class="lb-rank ${medalCls}">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}</td>
                    <td class="lb-name">${name}</td>
                    <td class="lb-class">${cls}${sub}</td>
                    <td class="lb-floor">${e.floorReached}${victoryBadge ? '<br>' + victoryBadge : ''}</td>
                    <td class="lb-kills">${e.enemiesSlain}</td>
                    <td class="lb-gold">${e.goldEarned}</td>
                    <td class="lb-date">${date}</td>
                </tr>`;
            }).join('');
            body.innerHTML = `
                <table class="lb-table">
                    <thead><tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Class</th>
                        <th style="text-align:right">Floor</th>
                        <th style="text-align:right">Kills</th>
                        <th style="text-align:right">Gold</th>
                        <th>Date</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
        } catch (err) {
            body.innerHTML = `<div id="lb-status">Could not load leaderboard.</div>`;
            console.warn('[Leaderboard] fetch error:', err);
        }
    }

    /* ── Open modal ──────────────────────────────────────────────────────── */
    function openModal() {
        wrap.classList.add('lb-visible');
        fetchAndRender();
    }

    /* ── Submit a run ────────────────────────────────────────────────────── */
    async function submitRun(isVictory) {
        try {
            const p = (typeof gameState !== 'undefined' && gameState.player) ? gameState.player : null;
            const rs = (typeof gameState !== 'undefined' && gameState.runStats) ? gameState.runStats : null;
            if (!p) return;

            const name = p.name || p.subclass || capitalize(p.className) || 'Adventurer';
            const floor = isVictory
                ? (typeof MAX_DUNGEON_FLOOR !== 'undefined' ? MAX_DUNGEON_FLOOR : 100)
                : (gameState.floor || 0);

            const payload = {
                playerName:   name,
                className:    p.className || 'warrior',
                subclass:     p.subclass  || '',
                floorReached: floor,
                enemiesSlain: rs ? (rs.enemiesSlain || 0) : 0,
                goldEarned:   rs ? (rs.goldEarned   || 0) : (p.gold || 0),
                isVictory:    !!isVictory,
            };

            const res = await fetch(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            showBadge('Run recorded on leaderboard ✓', true);
        } catch (err) {
            showBadge('Could not save to leaderboard', false);
            console.warn('[Leaderboard] submit error:', err);
        }
    }

    /* ── Inject "🏆 Leaderboard" button into the run-end screen ─────────── */
    function injectLeaderboardBtn() {
        const goEl = document.getElementById('game-over');
        if (!goEl || document.getElementById('lb-open-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'lb-open-btn';
        btn.textContent = '🏆 Global Leaderboard';
        btn.addEventListener('click', openModal);
        // insert after the "Play Again" button row if possible
        const againBtn = document.getElementById('game-over-again-btn');
        if (againBtn && againBtn.parentNode) {
            againBtn.parentNode.insertBefore(btn, againBtn.nextSibling);
        } else {
            goEl.appendChild(btn);
        }
    }

    /* ── Patch renderRunEndScreen to auto-submit + show button ──────────── */
    const _waitForRenderRunEnd = setInterval(() => {
        if (typeof renderRunEndScreen === 'function') {
            clearInterval(_waitForRenderRunEnd);
            const _orig = renderRunEndScreen;
            // eslint-disable-next-line no-global-assign
            renderRunEndScreen = function (opts) {
                _orig(opts);
                submitRun(opts && opts.isVictory);
                // Small delay so the DOM is fully rendered before we inject
                setTimeout(injectLeaderboardBtn, 120);
            };
        }
    }, 200);

    /* ── Helpers ─────────────────────────────────────────────────────────── */
    function escLb(str) {
        return String(str)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
    }
    function capitalize(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    }

    /* ── Expose openModal globally so you can call it from the console ───── */
    window.openLeaderboard = openModal;
})();
