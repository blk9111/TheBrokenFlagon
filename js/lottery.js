// ═══════════════════════════════════════════════════════════════════════════
// THE BROKEN FLAGON — Weekly Lottery
//
// A real-time weekly draw. Players buy tickets with Flagon Coins during the
// current week; the draw resolves automatically once the week rolls over, so
// the wait is genuine — buy now, find out next week.
//
// ── FORWARD-COMPATIBILITY (read before changing) ──────────────────────────
// This game is single-player today but is planned to move to a server (ASUS
// GX10) with real logins and a SHARED player pool. To make that migration a
// swap rather than a rewrite, every decision that will become server-authoritative
// is isolated behind a single function. When you move to the server, you replace
// the *body* of these and nothing else:
//
//   • _lotteryNow()          → server time instead of the client clock
//   • getLotteryWeekKey()    → server's notion of the current week
//   • resolveLotteryDraw()   → server runs the real shared-pool draw
//
// Until then these run locally with an odds-vs-house model (your tickets buy a
// slice of one weekly draw against the house). The shapes returned are already
// what a server response would look like, so UI code won't change either.
// ═══════════════════════════════════════════════════════════════════════════

// ── Tunables ───────────────────────────────────────────────────────────────
// Pricey, high-stakes, no cap (per the design): few tickets, rare big wins.
const LOTTERY_TICKET_COST = 25;   // Flagon Coins per ticket (a meaningful buy-in)
const LOTTERY_MAX_TICKETS = 0;    // 0 = no cap (whales can buy big)

// Prize tiers. `chancePerTicket` is the marginal probability each ticket adds
// to landing this tier on the weekly draw (pooled — see resolveLotteryDraw).
// Kept low so the grand prize is a real "did I actually win?!" moment.
// Prize tiers. Coin amounts kept in scale with the economy (ticket=25, boss=3,
// achievement=5, treasury upgrades 5–35) so a win is a real event, not a coin
// faucet. The weekly cadence (one win per draw, not farmable) lets the grand
// prize feel special at 200 without breaking progression; the title carries the
// prestige. Tunables — playtest and adjust.
const LOTTERY_TIERS = [
    { id: 'grand', label: 'Grand Prize', coins: 200, title: 'Fortune\u2019s Chosen',
      chancePerTicket: 0.012, blurb: 'A fortune in coin and a title spoken with envy.' },
    { id: 'major', label: 'Major Prize', coins: 80, title: null,
      chancePerTicket: 0.05,  blurb: 'A heavy purse of Flagon Coins.' },
    { id: 'minor', label: 'Minor Prize', coins: 30,  title: null,
      chancePerTicket: 0.16,  blurb: 'A modest consolation — better than empty hands.' },
];

// ── Swap-point 1: the clock ─────────────────────────────────────────────────
// On the server this returns authoritative server time. Locally it's the client
// clock (which is why the anti-cheat below exists).
function _lotteryNow() {
    return new Date();
}

// ── Swap-point 2: the week key ──────────────────────────────────────────────
// ISO-week string like "2026-W26". Two dates in the same Mon–Sun week share a
// key. On the server this becomes the server's current week.
function getLotteryWeekKey(date = _lotteryNow()) {
    // ISO 8601 week number. Copy date so we don't mutate the caller's.
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;           // Mon=0 … Sun=6
    d.setUTCDate(d.getUTCDate() - dayNum + 3);         // nearest Thursday
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(
        ((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Ordering helper so we can tell "is week A strictly after week B" and detect
// absurd clock jumps. Returns a comparable integer (year*100 + week).
function _weekKeyOrdinal(key) {
    const m = /^(\d{4})-W(\d{2})$/.exec(key || '');
    if (!m) return 0;
    return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

// ── State ────────────────────────────────────────────────────────────────────
// gameMeta.lottery = {
//   week:        weekKey tickets were bought for (the CURRENT open week)
//   tickets:     number bought for `week`
//   lastResolved:weekKey of the most recent resolved draw (anti-replay)
//   pending:     null | { week, result } — a resolved draw awaiting the player
//                seeing it (so the reveal happens in the UI, not silently)
//   history:     last N results [{ week, tickets, tier, coins, ts }]
// }
function _ensureLottery() {
    if (!gameMeta.lottery) {
        gameMeta.lottery = { week: null, tickets: 0, lastResolved: null, pending: null, history: [] };
    }
    return gameMeta.lottery;
}

// ── Anti-cheat (basic, per design) ──────────────────────────────────────────
// Because the clock is the client's, a player could roll it forward to farm
// draws. We resolve AT MOST one draw per real rollover and refuse to "catch up"
// across many weeks at once. This stops the trivial exploit (jump to year 3000,
// claim 50,000 draws) without pretending to be tamper-proof — true integrity
// arrives with the server move.
const LOTTERY_MAX_CATCHUP_WEEKS = 1;

// ── Buying tickets ──────────────────────────────────────────────────────────
// Returns { ok, bought, tickets, spent, reason }.
function buyLotteryTickets(count = 1) {
    const lot = _ensureLottery();
    count = Math.max(1, Math.floor(count));

    // Resolve any owed draw before buying into a new week (keeps weeks clean).
    tickLottery();

    const thisWeek = getLotteryWeekKey();
    // If the stored open week isn't this week, the player's tickets (if any)
    // belonged to a past week that tickLottery() has now resolved — start fresh.
    if (lot.week !== thisWeek) { lot.week = thisWeek; lot.tickets = 0; }

    if (LOTTERY_MAX_TICKETS > 0 && lot.tickets + count > LOTTERY_MAX_TICKETS) {
        count = LOTTERY_MAX_TICKETS - lot.tickets;
        if (count <= 0) return { ok: false, reason: 'You\u2019ve hit this week\u2019s ticket cap.' };
    }

    const cost = count * LOTTERY_TICKET_COST;
    if ((gameMeta.flagonCoins || 0) < cost) {
        return { ok: false, reason: `Not enough Flagon Coins (need ${cost}).` };
    }

    gameMeta.flagonCoins -= cost;
    lot.tickets += count;
    if (typeof saveMetaProgress === 'function') saveMetaProgress();
    return { ok: true, bought: count, tickets: lot.tickets, spent: cost };
}

// ── Swap-point 3: the draw ──────────────────────────────────────────────────
// Decide the outcome for a completed week given the ticket count. Pooled odds:
// each ticket adds chancePerTicket to that tier, checked grand→minor (best
// first), so more tickets = a bigger slice of the single draw. Deterministic
// per (week, tickets) via the seeded RNG so a result can't be re-rolled by
// reloading. On the server this becomes the authoritative shared-pool draw.
function resolveLotteryDraw(weekKey, tickets) {
    if (tickets <= 0) return { tier: null, coins: 0, title: null };

    // Seed from the week so the same week+tickets always yields the same result
    // (no save-scumming the draw). _mulberry32/seedRng already exist in data.js.
    let h = 0;
    const seedStr = `lottery:${weekKey}:${tickets}`;
    for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
    const draw = _mulberry32(h)();   // single deterministic roll in [0,1)

    let cumulative = 0;
    for (const tier of LOTTERY_TIERS) {
        // Diminishing-returns pooling: probability approaches but never exceeds
        // a sane ceiling even for whales (1 - (1-p)^tickets caps near 1).
        const p = 1 - Math.pow(1 - tier.chancePerTicket, tickets);
        cumulative += p;
        if (draw < cumulative) {
            return { tier: tier.id, label: tier.label, coins: tier.coins, title: tier.title };
        }
    }
    return { tier: null, coins: 0, title: null }; // most common outcome
}

// ── The weekly tick (resolve owed draws) ────────────────────────────────────
// Call this whenever the lottery UI opens (and on load). If the open week has
// passed, resolve that week's draw into `pending` for the UI to reveal, then
// open the new week. Honors the anti-cheat catch-up limit.
function tickLottery() {
    const lot = _ensureLottery();
    const thisWeek = getLotteryWeekKey();

    // Nothing bought, or already on the current week: just make sure week is set.
    if (!lot.week) { lot.week = thisWeek; return; }
    if (lot.week === thisWeek) return; // still the same open week — no draw yet

    // The open week has ended. Resolve it — but only if we haven't already, and
    // only one rollover at a time (anti-cheat: ignore absurd forward jumps).
    const alreadyResolved = lot.lastResolved && _weekKeyOrdinal(lot.lastResolved) >= _weekKeyOrdinal(lot.week);
    if (!alreadyResolved && lot.tickets > 0) {
        const result = resolveLotteryDraw(lot.week, lot.tickets);
        lot.pending = { week: lot.week, tickets: lot.tickets, result };
        lot.lastResolved = lot.week;
        // History (capped).
        lot.history.unshift({ week: lot.week, tickets: lot.tickets,
            tier: result.tier, coins: result.coins, ts: Date.now() });
        if (lot.history.length > 20) lot.history.length = 20;
    }

    // Open the new week with a clean slate. (We intentionally do NOT advance
    // through every skipped week — at most one draw per visit, per anti-cheat.)
    lot.week = thisWeek;
    lot.tickets = 0;
    if (typeof saveMetaProgress === 'function') saveMetaProgress();
}

// ── Claiming a resolved draw ────────────────────────────────────────────────
// The UI calls this when the player acknowledges their result. Awards coins +
// any title, clears `pending`, returns the result so the UI can celebrate.
function claimLotteryResult() {
    const lot = _ensureLottery();
    if (!lot.pending) return null;
    const { result } = lot.pending;

    if (result.coins > 0 && typeof earnFlagonCoins === 'function') {
        earnFlagonCoins(result.coins, 'lottery win');
    }
    // Titles in this game are DERIVED, not granted — each has a test() in
    // EARNED_TITLES. So a grand win just sets a persistent flag; the matching
    // title entry's test() reads it. (See 'fortunesChosen' in EARNED_TITLES.)
    if (result.title) {
        gameMeta.lotteryGrandWon = true;
    }
    const claimed = { ...lot.pending };
    lot.pending = null;
    if (typeof saveMetaProgress === 'function') saveMetaProgress();
    return claimed;
}

// ── Read helpers for the UI ─────────────────────────────────────────────────
function getLotteryState() {
    const lot = _ensureLottery();
    tickLottery(); // keep it current whenever the UI reads it
    return {
        week: getLotteryWeekKey(),
        tickets: lot.week === getLotteryWeekKey() ? lot.tickets : 0,
        ticketCost: LOTTERY_TICKET_COST,
        maxTickets: LOTTERY_MAX_TICKETS,
        pending: lot.pending,          // a result awaiting reveal, or null
        history: lot.history,
        coins: gameMeta.flagonCoins || 0,
        tiers: LOTTERY_TIERS,
        // The current win odds given tickets bought so far, for an honest display.
        odds: LOTTERY_TIERS.map(t => ({
            id: t.id, label: t.label, coins: t.coins,
            chance: 1 - Math.pow(1 - t.chancePerTicket, lot.week === getLotteryWeekKey() ? lot.tickets : 0),
        })),
    };
}

// When does the current week end (next Monday 00:00 local)? For a countdown.
function getLotteryDrawTime() {
    const now = _lotteryNow();
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7;        // Mon=0
    d.setDate(d.getDate() + (7 - day));       // next Monday
    d.setHours(0, 0, 0, 0);
    return d;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI — the lottery room in the casino.
//
// Kept in this file so all lottery code lives together. These functions are
// the *presentation* layer; they call the engine above and never duplicate its
// logic. They depend only on DOM elements defined in index.html and on
// addMessage()/saveMetaProgress() from the game.
// ═══════════════════════════════════════════════════════════════════════════

let _lotteryCountdownTimer = null;

// Called when the player opens the lottery room (from openCasinoGame).
function openLotteryRoom() {
    // Resolve any owed draw first. If one resolved while they were away, reveal
    // it before showing the room — that's the "came back after a week" moment.
    tickLottery();
    const lot = (gameMeta && gameMeta.lottery) ? gameMeta.lottery : null;
    if (lot && lot.pending) {
        _revealLotteryResult(lot.pending);
    }
    _renderLotteryRoom();
    _startLotteryCountdown();
}

// Stop the countdown when leaving (called defensively; cheap to no-op).
function closeLotteryRoom() {
    if (_lotteryCountdownTimer) { clearInterval(_lotteryCountdownTimer); _lotteryCountdownTimer = null; }
}

function _renderLotteryRoom() {
    const st = getLotteryState();

    const num = document.getElementById('lottery-tickets-num');
    if (num) num.textContent = st.tickets;

    const cost = document.getElementById('lottery-ticket-cost');
    if (cost) cost.textContent = st.ticketCost;

    const coinsNote = document.getElementById('lottery-coins-note');
    if (coinsNote) coinsNote.textContent = `You have ${st.coins.toLocaleString()} Flagon Coins.`;

    // Prize tiers + honest odds, best prize first.
    const list = document.getElementById('lottery-prize-list');
    if (list) {
        list.innerHTML = '';
        st.odds.forEach(o => {
            const tier = st.tiers.find(t => t.id === o.id);
            const row = document.createElement('div');
            row.className = 'lottery-prize-row lottery-prize-' + o.id;
            const chance = st.tickets > 0 ? `${(o.chance * 100).toFixed(1)}%` : '—';
            const titleBit = tier && tier.title ? ` <span class="lottery-prize-title">+ “${tier.title}”</span>` : '';
            row.innerHTML =
                `<span class="lottery-prize-name">${o.label}</span>` +
                `<span class="lottery-prize-reward">${o.coins.toLocaleString()} coins${titleBit}</span>` +
                `<span class="lottery-prize-chance">${chance}</span>`;
            list.appendChild(row);
        });
    }

    // History (only shown once there's something to show).
    const hist = document.getElementById('lottery-history');
    const histList = document.getElementById('lottery-history-list');
    if (hist && histList) {
        if (st.history && st.history.length) {
            hist.style.display = 'block';
            histList.innerHTML = '';
            st.history.slice(0, 8).forEach(h => {
                const row = document.createElement('div');
                row.className = 'lottery-history-row';
                const outcome = h.tier
                    ? `<span class="lottery-history-win">${_lotteryTierLabel(h.tier)} — ${h.coins.toLocaleString()} coins</span>`
                    : `<span class="lottery-history-none">No win</span>`;
                row.innerHTML = `<span class="lottery-history-week">${h.week}</span>` +
                    `<span class="lottery-history-tk">${h.tickets} tkt</span>${outcome}`;
                histList.appendChild(row);
            });
        } else {
            hist.style.display = 'none';
        }
    }

    // If a result is waiting (e.g. they dismissed the reveal), nudge gently.
    const pendNote = document.getElementById('lottery-pending-note');
    if (pendNote) {
        const lot = gameMeta.lottery;
        if (lot && lot.pending) {
            pendNote.style.display = 'block';
            pendNote.textContent = 'Last week’s draw is ready — see your result above.';
        } else {
            pendNote.style.display = 'none';
        }
    }
}

function _lotteryTierLabel(tierId) {
    const t = LOTTERY_TIERS.find(x => x.id === tierId);
    return t ? t.label : 'Prize';
}

// Buy handler wired to the button.
function buyLotteryTicketsUI() {
    const input = document.getElementById('lottery-buy-input');
    let count = parseInt(input && input.value, 10);
    if (!count || count < 1) count = 1;

    const res = buyLotteryTickets(count);
    if (!res.ok) {
        if (typeof addMessage === 'function') addMessage(`[Lottery] ${res.reason}`);
        // Flash the coins note so the player sees why nothing happened.
        const note = document.getElementById('lottery-coins-note');
        if (note) { note.classList.add('lottery-note-warn'); setTimeout(() => note.classList.remove('lottery-note-warn'), 1200); }
        return;
    }
    if (typeof addMessage === 'function') {
        addMessage(`[Lottery] Bought ${res.bought} ticket${res.bought !== 1 ? 's' : ''} for ${res.spent} coins. ${res.tickets} in this week’s draw. Come back after the draw to see how you did.`);
    }
    _renderLotteryRoom();
    if (typeof _syncGamblingGold === 'function') _syncGamblingGold();
}

// Live countdown to the next draw, ticking each second.
function _startLotteryCountdown() {
    if (_lotteryCountdownTimer) clearInterval(_lotteryCountdownTimer);
    const tick = () => {
        const el = document.getElementById('lottery-countdown');
        if (!el) { clearInterval(_lotteryCountdownTimer); _lotteryCountdownTimer = null; return; }
        // Stop if the room is no longer visible (player left).
        const screen = document.getElementById('casino-lottery-screen');
        if (!screen || screen.style.display === 'none') {
            clearInterval(_lotteryCountdownTimer); _lotteryCountdownTimer = null; return;
        }
        const drawAt = getLotteryDrawTime().getTime();
        let ms = drawAt - Date.now();
        if (ms <= 0) {
            el.textContent = 'drawing…';
            // The week just rolled over while they're watching — resolve + reveal.
            tickLottery();
            const lot = gameMeta.lottery;
            if (lot && lot.pending) { _revealLotteryResult(lot.pending); _renderLotteryRoom(); }
            return;
        }
        const d = Math.floor(ms / 86400000); ms -= d * 86400000;
        const h = Math.floor(ms / 3600000);  ms -= h * 3600000;
        const m = Math.floor(ms / 60000);    ms -= m * 60000;
        const s = Math.floor(ms / 1000);
        el.textContent = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
    };
    tick();
    _lotteryCountdownTimer = setInterval(tick, 1000);
}

// ── The reveal — asymmetric by design ───────────────────────────────────────
// A WIN gets a real moment (overlay, gold colour, the title for a grand prize).
// A LOSS gets a quiet, kind notice — we never build suspense just to punish.
function _revealLotteryResult(pending) {
    const result = pending.result || {};
    const won = !!result.tier;

    // Award now (claim clears pending and grants coins/title flag).
    const claimed = claimLotteryResult();

    if (!won) {
        // Quiet path — a gentle line in the log, no dramatic overlay.
        if (typeof addMessage === 'function') {
            addMessage(`[Lottery] Last week’s draw came and went — no luck this time. Your tickets are spent; a new week is open.`);
        }
        return;
    }

    // Win path — the dramatic overlay.
    const overlay = document.getElementById('lottery-reveal-overlay');
    const icon = document.getElementById('lottery-reveal-icon');
    const title = document.getElementById('lottery-reveal-title');
    const text = document.getElementById('lottery-reveal-text');
    const card = document.getElementById('lottery-reveal-card');
    if (!overlay || !text) {
        // DOM not present for some reason — at least log it so the win isn't silent.
        if (typeof addMessage === 'function') addMessage(`[Lottery] You won the ${result.label}! ${result.coins} coins awarded.`);
        return;
    }

    const tier = LOTTERY_TIERS.find(t => t.id === result.tier);
    const isGrand = result.tier === 'grand';
    if (card) card.className = isGrand ? 'lottery-reveal-grand' : 'lottery-reveal-win';
    if (icon) icon.innerHTML = isGrand ? '&#128081;' : '&#127942;'; // crown / trophy
    if (title) title.textContent = isGrand ? 'GRAND PRIZE!' : `${result.label}!`;

    let msg = `Your ${pending.tickets} ticket${pending.tickets !== 1 ? 's' : ''} struck gold. ` +
              `You won <strong>${result.coins.toLocaleString()} Flagon Coins</strong>.`;
    if (tier && tier.title) {
        msg += `<br><br>And a title few will ever hold: <strong>“${tier.title}”</strong>.`;
    }
    text.innerHTML = msg;
    overlay.style.display = 'flex';

    if (typeof addMessage === 'function') {
        addMessage(`[Lottery] ${isGrand ? '🎉 GRAND PRIZE! ' : ''}You won the ${result.label} — ${result.coins} coins!`);
    }
}

function closeLotteryReveal() {
    const overlay = document.getElementById('lottery-reveal-overlay');
    if (overlay) overlay.style.display = 'none';
    _renderLotteryRoom();
    if (typeof _syncGamblingGold === 'function') _syncGamblingGold();
}
