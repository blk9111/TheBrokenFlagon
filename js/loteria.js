// ═══════════════════════════════════════════════════════════════════════════
// THE BROKEN FLAGON — Lotería (traditional Mexican board game)
//
// A faithful Lotería: a caller (el gritón) draws cards one at a time from the
// 54-card deck; the player marks matching images on their tabla(s) by clicking
// before the next card is called. Win by completing the round's announced
// pattern and the payout is paid in Flagon Coins.
//
// DESIGN (locked with the player):
//   • Currency: Flagon Coins (buy tabla, win coins).
//   • Pace: player-chosen — faster calling = bigger payout multiplier.
//   • Marking: MANUAL. Click the card on your tabla before it scrolls past.
//     Miss the click window and that mark is lost (skill + tension).
//   • Pattern: a RANDOM pattern is announced each round.
//   • Round end: caller runs until a win, or the 54-card deck is exhausted.
//   • Multiple tabla: the player may buy 1–4 tabla for one round (more cost,
//     more coverage, bigger total stake).
//
// This file is the ENGINE — pure logic, no DOM. It is unit-tested headless
// before any UI is built on top, the same discipline used for the lottery.
// The UI layer lives in loteria-ui.js and only calls into these functions.
// ═══════════════════════════════════════════════════════════════════════════

// ── The 54 traditional cards ────────────────────────────────────────────────
// id = canonical number (1–54), name = traditional Spanish name, glyph = a
// unicode stand-in so the game is fully playable before custom art is added
// (drop art into sprites/loteria/<id>.png later and the UI swaps it in, exactly
// like the enemy-sprite contract elsewhere in the game). Verses are the
// traditional/known riddles the caller can announce for flavor; kept short.
const LOTERIA_DECK = [
    { id: 1,  name: 'El Gallo',       glyph: '🐓', verse: 'El que le cantó a San Pedro.' },
    { id: 2,  name: 'El Diablito',    glyph: '😈', verse: 'Pórtate bien cuatito, si no te lleva el coloradito.' },
    { id: 3,  name: 'La Dama',        glyph: '👩', verse: 'La dama puliendo el paso.' },
    { id: 4,  name: 'El Catrín',      glyph: '🎩', verse: 'Don Ferruco en la alameda.' },
    { id: 5,  name: 'El Paraguas',    glyph: '☂️', verse: 'Para el sol y para el agua.' },
    { id: 6,  name: 'La Sirena',      glyph: '🧜', verse: 'Con los cantos de sirena, no te vayas a marear.' },
    { id: 7,  name: 'La Escalera',    glyph: '🪜', verse: 'Súbeme paso a pasito.' },
    { id: 8,  name: 'La Botella',     glyph: '🍾', verse: 'La herramienta del borracho.' },
    { id: 9,  name: 'El Barril',      glyph: '🛢️', verse: 'Tanto bebió el albañil, que quedó como barril.' },
    { id: 10, name: 'El Árbol',       glyph: '🌳', verse: 'El que a buen árbol se arrima.' },
    { id: 11, name: 'El Melón',       glyph: '🍈', verse: 'Me lo das o me lo quitas.' },
    { id: 12, name: 'El Valiente',    glyph: '🔪', verse: 'Por qué le corres cobarde.' },
    { id: 13, name: 'El Gorrito',     glyph: '👒', verse: 'Ponle su gorrito al nene.' },
    { id: 14, name: 'La Muerte',      glyph: '💀', verse: 'La muerte tilica y flaca.' },
    { id: 15, name: 'La Pera',        glyph: '🍐', verse: 'El que espera, desespera.' },
    { id: 16, name: 'La Bandera',     glyph: '🇲🇽', verse: 'Verde, blanco y colorado.' },
    { id: 17, name: 'El Bandolón',    glyph: '🪕', verse: 'Tocando su bandolón.' },
    { id: 18, name: 'El Violoncello', glyph: '🎻', verse: 'Creciendo se fue hasta el cielo.' },
    { id: 19, name: 'La Garza',       glyph: '🦢', verse: 'Al otro lado del río.' },
    { id: 20, name: 'El Pájaro',      glyph: '🐦', verse: 'Tú me traes a puros brincos.' },
    { id: 21, name: 'La Mano',        glyph: '✋', verse: 'La mano de un criminal.' },
    { id: 22, name: 'La Bota',        glyph: '👢', verse: 'Una bota igual que la otra.' },
    { id: 23, name: 'La Luna',        glyph: '🌙', verse: 'El farol de los enamorados.' },
    { id: 24, name: 'El Cotorro',     glyph: '🦜', verse: 'Cotorro cotorro saca la pata.' },
    { id: 25, name: 'El Borracho',    glyph: '🍺', verse: 'Ah qué borracho tan necio.' },
    { id: 26, name: 'El Negrito',     glyph: '🧑🏿', verse: 'El que se comió el azúcar.' },
    { id: 27, name: 'El Corazón',     glyph: '❤️', verse: 'No me extrañes corazón.' },
    { id: 28, name: 'La Sandía',      glyph: '🍉', verse: 'La barriga que Juan tenía.' },
    { id: 29, name: 'El Tambor',      glyph: '🥁', verse: 'No te arrugues cuero viejo.' },
    { id: 30, name: 'El Camarón',     glyph: '🦐', verse: 'Camarón que se duerme, se lo lleva la corriente.' },
    { id: 31, name: 'Las Jaras',      glyph: '🏹', verse: 'Las jaras del indio Adán.' },
    { id: 32, name: 'El Músico',      glyph: '🎺', verse: 'El músico trompas de hule.' },
    { id: 33, name: 'La Araña',       glyph: '🕷️', verse: 'Atarántamela a palos.' },
    { id: 34, name: 'El Soldado',     glyph: '💂', verse: 'Uno, dos y tres, el soldado p\'al cuartel.' },
    { id: 35, name: 'La Estrella',    glyph: '⭐', verse: 'La guía de los marineros.' },
    { id: 36, name: 'El Cazo',        glyph: '🥘', verse: 'El caso que te hago es poco.' },
    { id: 37, name: 'El Mundo',       glyph: '🌎', verse: 'Este mundo es una bola.' },
    { id: 38, name: 'El Apache',      glyph: '🧑‍🦰', verse: 'Ah, Chihuahua, cuánto apache.' },
    { id: 39, name: 'El Nopal',       glyph: '🌵', verse: 'Al nopal lo van a ver, nomás cuando tiene tunas.' },
    { id: 40, name: 'El Alacrán',     glyph: '🦂', verse: 'El que con la cola pica.' },
    { id: 41, name: 'La Rosa',        glyph: '🌹', verse: 'Rosita, Rosaura.' },
    { id: 42, name: 'La Calavera',    glyph: '☠️', verse: 'Al pasar por el panteón.' },
    { id: 43, name: 'La Campana',     glyph: '🔔', verse: 'Tú con la campana y yo con tu hermana.' },
    { id: 44, name: 'El Cantarito',   glyph: '🏺', verse: 'Tanto va el cántaro al agua, que se quiebra.' },
    { id: 45, name: 'El Venado',      glyph: '🦌', verse: 'Saltando va buscando.' },
    { id: 46, name: 'El Sol',         glyph: '☀️', verse: 'La cobija de los pobres.' },
    { id: 47, name: 'La Corona',      glyph: '👑', verse: 'El sombrero de los reyes.' },
    { id: 48, name: 'La Chalupa',     glyph: '🛶', verse: 'Rema que rema Lupita.' },
    { id: 49, name: 'El Pino',        glyph: '🌲', verse: 'Fresco y oloroso, en todo tiempo hermoso.' },
    { id: 50, name: 'El Pescado',     glyph: '🐟', verse: 'El que por la boca muere.' },
    { id: 51, name: 'La Palma',       glyph: '🌴', verse: 'Palmero, sube a la palma.' },
    { id: 52, name: 'La Maceta',      glyph: '🪴', verse: 'El que nace pa\' maceta, no sale del corredor.' },
    { id: 53, name: 'El Arpa',        glyph: '🎼', verse: 'Arpa vieja de mi suegra.' },
    { id: 54, name: 'La Rana',        glyph: '🐸', verse: 'Al ver a la verde rana.' },
];

// ── Tunables (locked with the player) ───────────────────────────────────────
const LOTERIA_TABLA_COST = 40;     // Flagon Coins per tabla for a round
const LOTERIA_MAX_TABLA  = 4;      // buy up to 4 tabla at once
const LOTERIA_TABLA_SIZE = 16;     // 4×4 board
const LOTERIA_GRID = 4;

// Pace options: faster = less time to react = higher payout multiplier.
const LOTERIA_PACES = [
    { id: 'relaxed', label: 'Relaxed', secPerCall: 3.5, payoutMult: 0.9 },
    { id: 'classic', label: 'Classic', secPerCall: 2.5, payoutMult: 1.1 },
    { id: 'fast',    label: 'Fast',    secPerCall: 1.6, payoutMult: 1.4 },
];

// Winning patterns. Each maps a tabla (4×4, indices 0–15) to the set of cells
// required. A round announces ONE at random. `cells` is computed from the grid.
const LOTERIA_PATTERNS = (() => {
    const N = LOTERIA_GRID;
    const idx = (r, c) => r * N + c;
    const rows = [], cols = [];
    for (let r = 0; r < N; r++) rows.push({ id: `row${r}`, label: `Row ${r + 1}`, cells: Array.from({length:N}, (_,c)=>idx(r,c)) });
    for (let c = 0; c < N; c++) cols.push({ id: `col${c}`, label: `Column ${c + 1}`, cells: Array.from({length:N}, (_,r)=>idx(r,c)) });
    const diagA = { id: 'diagA', label: 'Diagonal ↘', cells: Array.from({length:N}, (_,i)=>idx(i,i)) };
    const diagB = { id: 'diagB', label: 'Diagonal ↙', cells: Array.from({length:N}, (_,i)=>idx(i,N-1-i)) };
    const corners = { id: 'corners', label: 'Four Corners', cells: [idx(0,0), idx(0,N-1), idx(N-1,0), idx(N-1,N-1)] };
    const center  = { id: 'center',  label: 'Center Four', cells: [idx(1,1), idx(1,2), idx(2,1), idx(2,2)] };
    const full    = { id: 'full',    label: 'Tabla Llena (full board)', cells: Array.from({length:N*N}, (_,i)=>i) };
    return [...rows, ...cols, diagA, diagB, corners, center, full];
})();

// ── Seedable RNG (reuses the game's _mulberry32 if present) ──────────────────
function _loteriaRng(seed) {
    if (typeof _mulberry32 === 'function') return _mulberry32(seed >>> 0);
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function _loteriaShuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── Tabla generation ─────────────────────────────────────────────────────────
// A tabla is 16 DISTINCT cards from the deck. Returns an array of 16 card ids.
function generateTabla(rnd) {
    const ids = LOTERIA_DECK.map(c => c.id);
    return _loteriaShuffle(ids, rnd).slice(0, LOTERIA_TABLA_SIZE);
}

// ── Round state ──────────────────────────────────────────────────────────────
// A round is a self-contained object (no global mutation) so it's easy to test
// and the UI just holds one. Created by startLoteriaRound().
function startLoteriaRound(opts) {
    opts = opts || {};
    const tablaCount = Math.max(1, Math.min(LOTERIA_MAX_TABLA, opts.tablaCount || 1));
    const pace = LOTERIA_PACES.find(p => p.id === opts.paceId) || LOTERIA_PACES[1];
    const seed = (opts.seed != null) ? opts.seed : (Date.now() ^ Math.floor(Math.random() * 0x7fffffff));
    const rnd = _loteriaRng(seed);

    // Build tabla(s).
    const tablas = [];
    for (let i = 0; i < tablaCount; i++) {
        tablas.push({ cards: generateTabla(rnd), marked: new Array(LOTERIA_TABLA_SIZE).fill(false) });
    }

    // Shuffle the call order (the caller's deck).
    const callOrder = _loteriaShuffle(LOTERIA_DECK.map(c => c.id), rnd);

    // Announce a random winning pattern for this round.
    const pattern = LOTERIA_PATTERNS[Math.floor(rnd() * LOTERIA_PATTERNS.length)];

    const stake = tablaCount * LOTERIA_TABLA_COST;
    return {
        seed, pace, pattern, tablas,
        callOrder,
        callIndex: -1,            // index into callOrder of the current card (-1 = not started)
        called: [],               // ids called so far, in order
        currentCardId: null,      // the card on the table right now
        markableUntil: null,      // (UI uses pace to enforce the click window)
        stake,
        tablaCount,
        status: 'ready',          // ready → playing → won | lost
        winningTabla: null,       // index of the tabla that won
        payout: 0,
    };
}

// Advance the caller to the next card. Returns the new current card object, or
// null if the deck is exhausted (round lost if no win by then).
function loteriaCallNext(round) {
    if (round.status !== 'playing' && round.status !== 'ready') return null;
    round.status = 'playing';
    round.callIndex++;
    if (round.callIndex >= round.callOrder.length) {
        // Deck exhausted with no win.
        round.currentCardId = null;
        round.status = 'lost';
        return null;
    }
    const id = round.callOrder[round.callIndex];
    round.currentCardId = id;
    round.called.push(id);
    return getLoteriaCard(id);
}

// Attempt to mark a cell on a tabla. The rule: you may only mark the cell if it
// matches the card CURRENTLY being called (manual, skill-based). Marking a cell
// that doesn't match the current card does nothing (no penalty, just a miss).
// Returns true if a mark was placed.
function loteriaMark(round, tablaIdx, cellIdx) {
    if (round.status !== 'playing') return false;
    const tabla = round.tablas[tablaIdx];
    if (!tabla) return false;
    if (tabla.marked[cellIdx]) return false;                  // already marked
    if (tabla.cards[cellIdx] !== round.currentCardId) return false; // not the called card
    tabla.marked[cellIdx] = true;
    return true;
}

// Check whether any tabla has completed the round's pattern. If so, marks the
// round won, records which tabla and the payout. Returns true on a win.
// Payout = stake × pattern difficulty × pace multiplier (see _loteriaPatternMult).
function loteriaCheckWin(round) {
    if (round.status !== 'playing') return false;
    for (let t = 0; t < round.tablas.length; t++) {
        const tabla = round.tablas[t];
        const complete = round.pattern.cells.every(ci => tabla.marked[ci]);
        if (complete) {
            round.status = 'won';
            round.winningTabla = t;
            round.payout = computeLoteriaPayout(round);
            return true;
        }
    }
    return false;
}

// Difficulty multiplier by pattern — harder patterns pay more.
function _loteriaPatternMult(patternId) {
    // Tunables (playtest and adjust). Kept low so the minigame feeds the economy
    // rather than printing coins: most wins are modest, only a full board (the
    // hardest) pays a real bonus. Compare against earn rates (boss=3, ach=5) and
    // treasury costs (tier-4 upgrade=35). Combined with pace mult, an easy row
    // mostly nets a small loss; a full board at fast pace tops out ~123 coins.
    if (patternId === 'full') return 2.2;        // tabla llena — hardest, best payout
    if (patternId === 'center' || patternId === 'corners') return 0.8;
    if (patternId.startsWith('diag')) return 1.0;
    return 0.6;                                  // a row or column — easiest
}

// Payout in Flagon Coins for a won round.
function computeLoteriaPayout(round) {
    const base = round.stake;                    // what they paid in
    const patMult = _loteriaPatternMult(round.pattern.id);
    const paceMult = round.pace.payoutMult;
    // Net winnings are generous but bounded; the stake is returned within this.
    return Math.round(base * patMult * paceMult);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getLoteriaCard(id) { return LOTERIA_DECK.find(c => c.id === id) || null; }

// How many marks short of the announced pattern is the player's best tabla?
// (UI uses this to show "1 to go!" tension.) Returns { tablaIdx, remaining }.
function loteriaBestProgress(round) {
    let best = { tablaIdx: 0, remaining: round.pattern.cells.length };
    round.tablas.forEach((tabla, t) => {
        const remaining = round.pattern.cells.filter(ci => !tabla.marked[ci]).length;
        if (remaining < best.remaining) best = { tablaIdx: t, remaining };
    });
    return best;
}

// A cell is "missable" if the called card matches it but it isn't marked yet —
// i.e. the player still needs to click it before the next call. UI uses this to
// know when a mark opportunity was missed (for the skill/tension rule).
function loteriaPendingMarks(round) {
    const out = [];
    if (round.currentCardId == null) return out;
    round.tablas.forEach((tabla, t) => {
        tabla.cards.forEach((cardId, c) => {
            if (cardId === round.currentCardId && !tabla.marked[c]) out.push({ tablaIdx: t, cellIdx: c });
        });
    });
    return out;
}
