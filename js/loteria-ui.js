// ═══════════════════════════════════════════════════════════════════════════
// THE BROKEN FLAGON — Lotería window UI
//
// Presentation layer for the Lotería engine (loteria.js). Holds one active
// round, drives the caller loop on the player's chosen pace, renders the
// clickable tabla(s), enforces the manual-marking window, and resolves wins.
// All game rules live in the engine; this file only renders and times.
// ═══════════════════════════════════════════════════════════════════════════

let _loteriaRound = null;        // the active round (from startLoteriaRound)
let _loteriaSetup = { tablaCount: 1, paceId: 'classic' };
let _loteriaCallTimer = null;    // setTimeout handle for the next call
let _loteriaPaceRAF = null;      // requestAnimationFrame for the pace bar
let _loteriaCallStartMs = 0;     // when the current card was called (for the bar)

// ── Open / close ─────────────────────────────────────────────────────────────
function openLoteria() {
    if (gameState.floor !== 0 || !gameState.player) return;
    // Don't open over another panel.
    if (gameState.shopOpen || gameState.charSheetOpen || gameState.gamblingOpen ||
        gameState.brewmasterOpen || gameState.questBoardOpen || gameState.bardOpen ||
        gameState.stashOpen || gameState.magicDealerOpen || gameState.cellarFindOpen) return;

    gameState.loteriaOpen = true;
    _loteriaRound = null;
    _showLoteriaSetup();
    const panel = document.getElementById('loteria-panel');
    if (panel) panel.style.display = 'flex';
    if (typeof updateUI === 'function') updateUI();
}

function closeLoteria() {
    _loteriaStopTimers();
    _loteriaRound = null;
    gameState.loteriaOpen = false;
    const panel = document.getElementById('loteria-panel');
    if (panel) panel.style.display = 'none';
    const overlay = document.getElementById('loteria-result-overlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof updateUI === 'function') updateUI();
}

function _loteriaStopTimers() {
    if (_loteriaCallTimer) { clearTimeout(_loteriaCallTimer); _loteriaCallTimer = null; }
    if (_loteriaPaceRAF) { cancelAnimationFrame(_loteriaPaceRAF); _loteriaPaceRAF = null; }
}

// ── Setup screen ─────────────────────────────────────────────────────────────
function _showLoteriaSetup() {
    _loteriaStopTimers();
    const setup = document.getElementById('loteria-setup');
    const play = document.getElementById('loteria-play');
    const overlay = document.getElementById('loteria-result-overlay');
    if (setup) setup.style.display = 'block';
    if (play) play.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    _renderLoteriaCoins();

    // Tabla count picker (1–4)
    const tp = document.getElementById('loteria-tabla-picker');
    if (tp) {
        tp.innerHTML = '';
        for (let n = 1; n <= LOTERIA_MAX_TABLA; n++) {
            const b = document.createElement('button');
            b.className = 'loteria-choice' + (_loteriaSetup.tablaCount === n ? ' loteria-choice-active' : '');
            b.textContent = n;
            b.onclick = () => { _loteriaSetup.tablaCount = n; _showLoteriaSetup(); };
            tp.appendChild(b);
        }
    }

    // Pace picker
    const pp = document.getElementById('loteria-pace-picker');
    if (pp) {
        pp.innerHTML = '';
        LOTERIA_PACES.forEach(pace => {
            const b = document.createElement('button');
            b.className = 'loteria-choice loteria-choice-pace' + (_loteriaSetup.paceId === pace.id ? ' loteria-choice-active' : '');
            b.innerHTML = `<span class="loteria-pace-name">${pace.label}</span><span class="loteria-pace-mult">×${pace.payoutMult} payout</span>`;
            b.onclick = () => { _loteriaSetup.paceId = pace.id; _showLoteriaSetup(); };
            pp.appendChild(b);
        });
    }

    // Stake summary
    const stake = _loteriaSetup.tablaCount * LOTERIA_TABLA_COST;
    const coins = gameMeta.flagonCoins || 0;
    const summary = document.getElementById('loteria-stake-summary');
    if (summary) {
        summary.innerHTML =
            `<span>Buy-in: <strong>${stake}</strong> Flagon Coins</span>` +
            `<span class="loteria-stake-coins">You have ${coins.toLocaleString()}</span>`;
    }
    const startBtn = document.getElementById('loteria-start-btn');
    const note = document.getElementById('loteria-setup-note');
    if (startBtn && note) {
        if (coins < stake) {
            startBtn.disabled = true;
            startBtn.classList.add('loteria-btn-disabled');
            note.textContent = `You need ${stake - coins} more Flagon Coins to buy in.`;
        } else {
            startBtn.disabled = false;
            startBtn.classList.remove('loteria-btn-disabled');
            note.textContent = 'The caller will start once you buy in. Watch closely.';
        }
    }
}

function _renderLoteriaCoins() {
    const el = document.getElementById('loteria-coins-display');
    if (el) el.innerHTML = `<span class="loteria-coin-icon">&#9679;</span> ${(gameMeta.flagonCoins || 0).toLocaleString()} Flagon Coins`;
}

// ── Start a round (buy in) ───────────────────────────────────────────────────
function loteriaStart() {
    const stake = _loteriaSetup.tablaCount * LOTERIA_TABLA_COST;
    if ((gameMeta.flagonCoins || 0) < stake) return;

    // Deduct buy-in.
    gameMeta.flagonCoins -= stake;
    if (typeof saveMetaProgress === 'function') saveMetaProgress();
    _renderLoteriaCoins();

    _loteriaRound = startLoteriaRound({
        tablaCount: _loteriaSetup.tablaCount,
        paceId: _loteriaSetup.paceId,
    });

    // Switch to play screen.
    document.getElementById('loteria-setup').style.display = 'none';
    document.getElementById('loteria-play').style.display = 'block';

    _renderLoteriaGoal();
    _renderLoteriaTablas();

    // Begin the caller after a short beat so the player can read the pattern.
    _loteriaCallTimer = setTimeout(_loteriaAdvance, 1400);
    if (typeof addMessage === 'function') {
        addMessage(`[Lotería] Buy-in ${stake} coins. The caller begins — pattern: ${_loteriaRound.pattern.label}.`);
    }
}

// ── The caller loop ──────────────────────────────────────────────────────────
function _loteriaAdvance() {
    if (!_loteriaRound || _loteriaRound.status === 'won' || _loteriaRound.status === 'lost') return;

    const card = loteriaCallNext(_loteriaRound);
    if (!card) {
        // Deck exhausted with no win.
        _loteriaEndRound(false);
        return;
    }

    _loteriaCallStartMs = Date.now();
    // Set the marking window on the round object so the engine owns the
    // timing contract (testable without the UI timer running).
    const ms = _loteriaRound.pace.secPerCall * 1000;
    _loteriaRound.markableUntil = _loteriaCallStartMs + ms;
    _renderLoteriaCurrentCard(card);
    _renderLoteriaTablas();          // re-render so newly-callable cells show as "live"
    _renderLoteriaGoal();
    _startLoteriaPaceBar();

    // Schedule the next call after the chosen pace interval.
    _loteriaCallTimer = setTimeout(() => {
        // When the window closes, any unmarked match for this card is permanently missed.
        _loteriaAdvance();
    }, ms);
}

function _startLoteriaPaceBar() {
    if (_loteriaPaceRAF) cancelAnimationFrame(_loteriaPaceRAF);
    const bar = document.getElementById('loteria-pace-bar');
    if (!bar) return;
    const total = _loteriaRound.pace.secPerCall * 1000;
    const step = () => {
        if (!_loteriaRound || _loteriaRound.status !== 'playing') return;
        const elapsed = Date.now() - _loteriaCallStartMs;
        const frac = Math.max(0, Math.min(1, 1 - elapsed / total));
        bar.style.width = (frac * 100) + '%';
        // Colour shifts to urgent as time runs out.
        bar.style.background = frac < 0.3 ? 'var(--loteria-urgent)' : 'var(--loteria-accent)';
        if (frac > 0) _loteriaPaceRAF = requestAnimationFrame(step);
    };
    step();
}

// ── Rendering ────────────────────────────────────────────────────────────────
function _renderLoteriaCurrentCard(card) {
    const glyph = document.getElementById('loteria-current-glyph');
    const name = document.getElementById('loteria-current-name');
    const verse = document.getElementById('loteria-current-verse');
    if (glyph) glyph.textContent = card.glyph;
    if (name) name.textContent = card.name;
    if (verse) verse.textContent = card.verse || '';
    // Little pop animation by retriggering the class.
    const cc = document.getElementById('loteria-current-card');
    if (cc) { cc.classList.remove('loteria-card-pop'); void cc.offsetWidth; cc.classList.add('loteria-card-pop'); }
}

function _renderLoteriaGoal() {
    const pat = document.getElementById('loteria-goal-pattern');
    if (pat && _loteriaRound) pat.textContent = _loteriaRound.pattern.label;

    // Mini 4×4 diagram of the required pattern.
    // Use winSets.flat() so Línea highlights all 16 cells (every cell
    // belongs to at least one winning line), corners/center/full show
    // exactly the cells that matter. Deduplication via Set is free.
    const mini = document.getElementById('loteria-goal-mini');
    if (mini && _loteriaRound) {
        mini.innerHTML = '';
        const need = new Set(_loteriaRound.pattern.winSets.flat());
        for (let i = 0; i < LOTERIA_TABLA_SIZE; i++) {
            const dot = document.createElement('div');
            dot.className = 'loteria-mini-cell' + (need.has(i) ? ' loteria-mini-on' : '');
            mini.appendChild(dot);
        }
    }

    // Progress note — "1 to go!"
    const note = document.getElementById('loteria-progress-note');
    if (note && _loteriaRound) {
        const best = loteriaBestProgress(_loteriaRound);
        if (best.remaining === 0) note.textContent = '';
        else if (best.remaining === 1) { note.textContent = '¡Una más! 1 to go!'; note.className = 'loteria-progress-hot'; }
        else { note.textContent = `${best.remaining} to go`; note.className = ''; }
    }

    const cc = document.getElementById('loteria-called-count');
    if (cc && _loteriaRound) cc.textContent = `${_loteriaRound.called.length} / 54 called`;
}

function _renderLoteriaTablas() {
    const wrap = document.getElementById('loteria-tablas');
    if (!wrap || !_loteriaRound) return;
    wrap.innerHTML = '';
    wrap.className = 'loteria-tablas-count-' + _loteriaRound.tablas.length;

    _loteriaRound.tablas.forEach((tabla, t) => {
        const board = document.createElement('div');
        board.className = 'loteria-board';
        tabla.cards.forEach((cardId, c) => {
            const card = getLoteriaCard(cardId);
            const cell = document.createElement('button');
            const isMarked = tabla.marked[c];
            const isLive = (_loteriaRound.currentCardId === cardId) && !isMarked && _loteriaRound.status === 'playing';
            cell.className = 'loteria-cell' +
                (isMarked ? ' loteria-cell-marked' : '') +
                (isLive ? ' loteria-cell-live' : '');
            // Card art at sprites/loteria/<id>.png is OPTIONAL. Default to the
            // glyph+name fallback (so the board always renders correctly with no
            // art files present). Only when an image actually LOADS do we add
            // .loteria-cell-hasart, which hides the glyph and shows the art. This
            // is the robust direction: a missing file simply never triggers
            // onload, so the glyph stays — no dependency on onerror firing.
            const artSrc = `sprites/loteria/${cardId}.png`;
            cell.innerHTML =
                `<span class="loteria-cell-glyph">${card.glyph}</span>` +
                `<span class="loteria-cell-name">${card.name}</span>` +
                `<img class="loteria-cell-art" src="${artSrc}" alt="" draggable="false"` +
                ` onload="this.closest('.loteria-cell').classList.add('loteria-cell-hasart');"` +
                ` onerror="this.remove();">` +
                (isMarked ? '<span class="loteria-bean" aria-hidden="true">&#128997;</span>' : '');
            cell.onclick = () => _loteriaCellClick(t, c);
            board.appendChild(cell);
        });
        wrap.appendChild(board);
    });
}

// ── Marking (the skill mechanic) ─────────────────────────────────────────────
function _loteriaCellClick(tablaIdx, cellIdx) {
    if (!_loteriaRound || _loteriaRound.status !== 'playing') return;
    const placed = loteriaMark(_loteriaRound, tablaIdx, cellIdx);
    if (placed) {
        _renderLoteriaTablas();
        _renderLoteriaGoal();
        // Did that mark win it?
        if (loteriaCheckWin(_loteriaRound)) {
            _loteriaEndRound(true);
        }
    }
    // A wrong/late click is simply ignored (engine returns false) — no penalty
    // beyond the missed opportunity, exactly the manual-skill rule.
}

// ── End of round ─────────────────────────────────────────────────────────────
function _loteriaEndRound(won) {
    _loteriaStopTimers();
    const overlay = document.getElementById('loteria-result-overlay');
    const icon = document.getElementById('loteria-result-icon');
    const title = document.getElementById('loteria-result-title');
    const text = document.getElementById('loteria-result-text');
    const card = document.getElementById('loteria-result-card');
    if (!overlay) return;

    if (won) {
        const payout = _loteriaRound.payout;
        if (payout > 0 && typeof earnFlagonCoins === 'function') earnFlagonCoins(payout, 'Lotería');
        // Track a lifetime stat (lightweight; auto-saved with gameMeta).
        gameMeta.loteriaWins = (gameMeta.loteriaWins || 0) + 1;
        if (typeof saveMetaProgress === 'function') saveMetaProgress();

        if (card) card.className = 'loteria-result-win';
        if (icon) icon.innerHTML = '&#127881;';
        if (title) title.textContent = '¡Lotería!';
        if (text) text.innerHTML =
            `You completed <strong>${_loteriaRound.pattern.label}</strong> and won ` +
            `<strong>${_loteriaRound.payout.toLocaleString()} Flagon Coins</strong>.`;
        if (typeof addMessage === 'function') addMessage(`[Lotería] ¡Lotería! You won ${_loteriaRound.payout} coins.`);
    } else {
        if (card) card.className = 'loteria-result-loss';
        if (icon) icon.innerHTML = '&#128533;';
        if (title) title.textContent = 'The deck ran out';
        if (text) text.innerHTML =
            `No one completed <strong>${_loteriaRound.pattern.label}</strong> this round. ` +
            `Better luck next time — the caller is ready to go again.`;
        if (typeof addMessage === 'function') addMessage(`[Lotería] The deck ran dry — no win this round.`);
    }
    _renderLoteriaCoins();
    overlay.style.display = 'flex';
    if (typeof updateUI === 'function') updateUI();
}

function loteriaResultContinue() {
    const overlay = document.getElementById('loteria-result-overlay');
    if (overlay) overlay.style.display = 'none';
    _loteriaRound = null;
    _showLoteriaSetup();
}
