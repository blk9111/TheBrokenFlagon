/**
 * leaderboard-worker.js — Cloudflare Worker for The Broken Flagon leaderboard.
 *
 * Deploy:
 *   1. `npm install -g wrangler`
 *   2. `wrangler login`
 *   3. Create a KV namespace:  wrangler kv:namespace create "LEADERBOARD"
 *   4. Copy the namespace ID into wrangler.toml  (kv_namespaces binding)
 *   5. `wrangler publish`
 *   6. Update API_BASE in leaderboard.js to your worker URL
 *
 * wrangler.toml (create alongside this file):
 *   name = "broken-flagon-leaderboard"
 *   main = "leaderboard-worker.js"
 *   compatibility_date = "2024-01-01"
 *   [[kv_namespaces]]
 *   binding = "LEADERBOARD"
 *   id = "<paste-your-kv-namespace-id-here>"
 *
 * API:
 *   GET  /api/leaderboard?limit=20     → JSON array of top runs
 *   POST /api/leaderboard              → submit a run, returns {ok,rank}
 *   GET  /api/leaderboard/stats        → aggregate stats (optional)
 */

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });

// ── Validation ────────────────────────────────────────────────────────────────
const VALID_CLASSES   = new Set(['warrior','rogue','mage','cleric']);
const VALID_SUBCLASS  = /^[a-zA-Z]{0,20}$/;
const NAME_RE         = /^[\w\s\-'.]{1,32}$/;

function validate(payload) {
    if (!payload || typeof payload !== 'object') return 'Invalid payload';
    const { playerName, className, subclass, floorReached, enemiesSlain, goldEarned, isVictory } = payload;
    if (!NAME_RE.test(playerName || ''))      return 'Invalid playerName';
    if (!VALID_CLASSES.has(className))        return 'Invalid className';
    if (subclass && !VALID_SUBCLASS.test(subclass)) return 'Invalid subclass';
    if (!Number.isInteger(floorReached) || floorReached < 0 || floorReached > 200) return 'Invalid floorReached';
    if (!Number.isInteger(enemiesSlain) || enemiesSlain < 0 || enemiesSlain > 99999) return 'Invalid enemiesSlain';
    if (!Number.isInteger(goldEarned)   || goldEarned < 0   || goldEarned > 999999)  return 'Invalid goldEarned';
    return null; // valid
}

// ── GET: fetch top N runs ─────────────────────────────────────────────────────
async function handleGet(request, env) {
    const url    = new URL(request.url);
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    // Leaderboard is stored as a sorted list under key "lb:runs"
    // Each run is keyed "lb:run:<timestamp>:<random>" for ordering
    const list = await env.LEADERBOARD.list({ prefix: 'lb:run:', limit });
    const runs = await Promise.all(
        list.keys.map(k => env.LEADERBOARD.get(k.name, 'json'))
    );

    // Sort by floor desc, then enemies slain desc
    const sorted = runs
        .filter(Boolean)
        .sort((a, b) => b.floorReached - a.floorReached || b.enemiesSlain - a.enemiesSlain)
        .slice(0, limit);

    return json(sorted);
}

// ── POST: submit a run ────────────────────────────────────────────────────────
async function handlePost(request, env) {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

    const err = validate(body);
    if (err) return json({ error: err }, 400);

    const run = {
        playerName:   (body.playerName || 'Adventurer').trim().slice(0, 32),
        className:    body.className,
        subclass:     body.subclass || '',
        floorReached: body.floorReached,
        enemiesSlain: body.enemiesSlain || 0,
        goldEarned:   body.goldEarned   || 0,
        isVictory:    !!body.isVictory,
        submittedAt:  new Date().toISOString(),
    };

    // Key format: run:<padded-floor-desc>:<timestamp> — lexicographic = sorted by floor
    const floorPad = String(999 - run.floorReached).padStart(3, '0'); // invert for desc sort
    const key = `lb:run:${floorPad}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
    await env.LEADERBOARD.put(key, JSON.stringify(run), {
        expirationTtl: 60 * 60 * 24 * 365, // keep for 1 year
    });

    // Calculate rank (how many runs have a higher floor)
    const allKeys = await env.LEADERBOARD.list({ prefix: 'lb:run:' });
    const higherFloor = `lb:run:${floorPad}`; // keys with lower floorPad = higher floor
    const rank = allKeys.keys.filter(k => k.name < higherFloor).length + 1;

    return json({ ok: true, rank });
}

// ── GET /api/leaderboard/stats ────────────────────────────────────────────────
async function handleStats(env) {
    const list = await env.LEADERBOARD.list({ prefix: 'lb:run:' });
    const runs = await Promise.all(list.keys.map(k => env.LEADERBOARD.get(k.name, 'json')));
    const valid = runs.filter(Boolean);

    if (!valid.length) return json({ total: 0 });

    const byClass = {};
    let deepest = null, totalVictories = 0;
    for (const r of valid) {
        if (!byClass[r.className]) byClass[r.className] = { runs: 0, totalFloor: 0, victories: 0 };
        byClass[r.className].runs++;
        byClass[r.className].totalFloor += r.floorReached;
        if (r.isVictory) { byClass[r.className].victories++; totalVictories++; }
        if (!deepest || r.floorReached > deepest.floorReached) deepest = r;
    }

    return json({
        total: valid.length,
        victories: totalVictories,
        deepest: deepest ? { name: deepest.playerName, floor: deepest.floorReached, class: deepest.className } : null,
        byClass: Object.fromEntries(
            Object.entries(byClass).map(([cls, s]) => [cls, {
                runs: s.runs,
                avgFloor: +(s.totalFloor / s.runs).toFixed(1),
                winRate: +((s.victories / s.runs) * 100).toFixed(1),
            }])
        ),
    });
}

// ── Router ────────────────────────────────────────────────────────────────────
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '');

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }

        if (path === '/api/leaderboard' || path === '/api/leaderboard/') {
            if (request.method === 'GET')  return handleGet(request, env);
            if (request.method === 'POST') return handlePost(request, env);
        }

        if (path === '/api/leaderboard/stats' && request.method === 'GET') {
            return handleStats(env);
        }

        return json({ error: 'Not found' }, 404);
    },
};
