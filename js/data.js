const GAME_VERSION = '1.13.0';

const DUNGEON_NAME = 'The Dungeon of Ash';

const MAX_DUNGEON_FLOOR = 100;

// ── Game state machine ───────────────────────────────────────────────────────
// Canonical enum for the current screen/mode. New code reads getGameMode()
// instead of branching on floor===0, inCourtyard, inArenaBout, gameOver etc.
// Legacy booleans remain while other files migrate; deriveLegacyMode() bridges
// them. Assign gameState.mode in each transition function (descendFloor,
// returnToTavern, etc.) as those files are updated — the derive fallback keeps
// the enum correct even before explicit assignment.
const GAME_STATE = Object.freeze({
    TITLE:   'title',    // title screen / no active session
    TAVERN:  'tavern',   // tavern hub, floor 0, not in a bout
    PREPARE: 'prepare',  // character prep / loadout screen
    DUNGEON: 'dungeon',  // active dungeon run, floor > 0
    PIT:     'pit',      // Pit bout in progress (or Pit screen)
    DEATH:   'death',    // game-over screen
    RESULTS: 'results',  // post-run results screen
});

// Maximum number of allied minions the Necromancer subclass can maintain
// simultaneously. Referenced in both getSubclassMeterHtml (display) and
// useSubclassAbility (logic) — changing it here propagates to both.
const NECROMANCER_MINION_CAP = 2;


// ── Seed versioning ──────────────────────────────────────────────────────────
// When dungeon generation logic changes in a way that alters room layouts or
// spawn tables, bump SEED_VERSION. Old seed codes remain valid but will
// produce different dungeons — the version lets you distinguish them in
// reports and lets players know a seed was generated on a specific ruleset.
// Save files store the version at creation so loaded runs are always labelled.
const SEED_VERSION = 1;

// ── Seeded RNG ──────────────────────────────────────────────────────────────
// Mulberry32: small, fast, and — critically — fully deterministic given the
// same 32-bit seed. Every gameplay-determining Math.random() call in the
// codebase has been migrated to call rng() instead, so two runs started
// from the same seed code play out identically: same dungeon layouts, same
// loot rolls, same enemy AI decisions, same shop stock, same dice outcomes.
//
// Deliberately NOT migrated: a few purely cosmetic randoms that don't
// affect what actually happens in the run (the dice-table flicker
// animation during a roll, and ambient NPC/tavern flavor-line selection).
// Routing those through the seeded stream would burn RNG state on visual
// flourishes that have zero gameplay consequence, for no replay benefit.
let _rngState = null;

function _mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The actual replacement for Math.random() throughout gameplay code.
// Falls back to Math.random() only if seedRun() was never called (e.g.
// some future code path forgets to seed) so a missing seed degrades to
// "works, just not deterministic" rather than crashing outright.
function rng() {
    return _rngState ? _rngState() : Math.random();
}

// Call once per run, before any gameplay randomness happens (currently:
// inside initGame(), before generateDungeon()'s first call). Stores the
// seed on gameState so it can be displayed, copied, and persisted through
// save/load.
function seedRun(seed) {
    const s = (seed >>> 0) || 1;
    gameState.runSeed = s;
    gameState.seedVersion = SEED_VERSION; // stored in save file so old runs are correctly labelled
    _rngState = _mulberry32(s);
}

const SEED_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O or 1/I/L — avoids transcription mistakes
const SEED_CODE_LENGTH = 7;

function seedToCode(seed) {
    let n = (seed >>> 0) || 1;
    let out = '';
    for (let i = 0; i < SEED_CODE_LENGTH; i++) {
        out = SEED_ALPHABET[n % SEED_ALPHABET.length] + out;
        n = Math.floor(n / SEED_ALPHABET.length);
    }
    return out;
}

// Returns the decoded seed, or null if the code contains characters
// outside SEED_ALPHABET (case-insensitive on input).
function codeToSeed(code) {
    if (!code) return null;
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return null;
    let n = 0;
    for (const ch of cleaned) {
        const idx = SEED_ALPHABET.indexOf(ch);
        if (idx === -1) return null;
        n = n * SEED_ALPHABET.length + idx;
    }
    return n >>> 0;
}

// Generates a fresh random seed for a new, unseeded run. Uses the page's
// actual Math.random() (deliberately, not rng() — there's no seed yet to
// draw from) seasoned with the current time so two runs started in the
// same millisecond still get different seeds.
function generateRandomSeed() {
    return (Math.floor(Math.random() * 4294967296) ^ Date.now()) >>> 0;
}


// ── Daily Challenge ────────────────────────────────────────────────────────────
// Everyone in the world plays the same dungeon each day. The seed is derived
// deterministically from the UTC date, so two players on the same calendar day
// (UTC) get an identical run to compare. Personal best-per-day is stored in
// gameMeta.dailyRecords keyed by the date string.

// Returns today's date key as 'YYYY-MM-DD' in UTC, so the daily rolls over at
// the same instant worldwide rather than at each player's local midnight.
function getDailyKey(date = new Date()) {
    return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Deterministic 32-bit seed from the date key. Uses a simple string hash so the
// same date always yields the same seed, but consecutive days look unrelated.
function getDailySeed(dateKey = getDailyKey()) {
    let h = 2166136261 >>> 0; // FNV-1a basis
    for (let i = 0; i < dateKey.length; i++) {
        h ^= dateKey.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    // Avoid 0 (reads as "no seed"); guarantee a stable non-zero value.
    return (h || 1) >>> 0;
}

// The player's record for a given day, or null if they haven't played it.
// Record shape: { floor, won, className, subclass, ts }
function getDailyRecord(dateKey = getDailyKey()) {
    if (!gameMeta.dailyRecords) return null;
    return gameMeta.dailyRecords[dateKey] || null;
}

// Records a daily result, keeping only the player's best (deepest floor, or a
// win) for that day. Returns true if this run set a new personal daily best.
function recordDailyResult(dateKey, floor, won, className, subclass) {
    if (!gameMeta.dailyRecords) gameMeta.dailyRecords = {};
    const prev = gameMeta.dailyRecords[dateKey];
    const isBetter = !prev || won || floor > (prev.floor || 0);
    if (isBetter) {
        gameMeta.dailyRecords[dateKey] = { floor, won: !!won, className, subclass, ts: Date.now() };
    }
    // Earn 2 Renown for participating in a daily, once per day
    if (!prev && typeof earnRenown === 'function') earnRenown(2, 'daily challenge');
    // Prune old records so the object can't grow unbounded over months of play.
    const keys = Object.keys(gameMeta.dailyRecords).sort();
    while (keys.length > 60) {
        delete gameMeta.dailyRecords[keys.shift()];
    }
    saveMetaProgress();
    return isBetter;
}

// How many distinct days the player has completed at least one daily run on —
// drives a simple "streak/dedication" readout and a future achievement hook.
function getDailyPlayCount() {
    return gameMeta.dailyRecords ? Object.keys(gameMeta.dailyRecords).length : 0;
}


// ── Hero Statue tier ────────────────────────────────────────────────────────────
// The Trophy Hall's centerpiece statue upgrades its material as the player
// proves themselves, across BOTH the dungeon and the arena — so either path
// (or both) advances it. Returns a tier descriptor used by the renderer.
const HERO_STATUE_TIERS = [
    { id: 'stone',  name: 'Stone',  base: '#6e6a63', light: '#8d887e', dark: '#4c4944', sheen: 0.05 },
    { id: 'bronze', name: 'Bronze', base: '#9c6b3f', light: '#c89055', dark: '#6e4827', sheen: 0.12 },
    { id: 'silver', name: 'Silver', base: '#b9bcc4', light: '#e6e9f0', dark: '#83868f', sheen: 0.20 },
    { id: 'gold',   name: 'Gold',   base: '#d9a93f', light: '#ffe48a', dark: '#9c7320', sheen: 0.30 },
];

function getHeroStatueTier() {
    const best = gameState.bestFloor || 0;
    const bosses = gameMeta.bossesSlain || 0;
    // Arena tier index (0 Unknown .. 5 Legend), if the arena system is loaded.
    let arenaIdx = 0;
    if (typeof getArenaTier === 'function' && typeof ARENA_FAME_TIERS !== 'undefined') {
        arenaIdx = ARENA_FAME_TIERS.findIndex(t => t.title === getArenaTier().title);
        if (arenaIdx < 0) arenaIdx = 0;
    }
    // Gold: true endgame mastery on either track.
    if (best >= 75 || arenaIdx >= 5) return HERO_STATUE_TIERS[3];
    // Silver: deep delving or arena Gladiator+.
    if (best >= 50 || arenaIdx >= 3) return HERO_STATUE_TIERS[2];
    // Bronze: real progress — a milestone boss down or past Floor 25.
    if (best >= 25 || bosses >= 1 || arenaIdx >= 1) return HERO_STATUE_TIERS[1];
    // Stone: just starting out.
    return HERO_STATUE_TIERS[0];
}


// ── Bestiary / Codex ───────────────────────────────────────────────────────────
// A collection page that fills in as the player encounters and defeats each
// enemy type. gameMeta.bestiary maps enemy type -> { seen, kills }. Lore lives
// in BESTIARY_LORE; anything in ENEMY_TYPES without lore still shows with a
// generic blurb, so new enemy types appear automatically.

const BESTIARY_LORE = {
    goblin:   { title: 'Goblin', lore: 'Scavengers of the upper floors. Individually weak, dangerous in numbers, and always hungry for whatever you\'re carrying.' },
    slime:    { title: 'Slime', lore: 'A creeping mass of corrosive ooze. Its touch leaves a lingering poison. Fire renders it down to nothing.' },
    skeleton: { title: 'Skeleton', lore: 'The dungeon\'s restless dead, animated by the ash-curse. Their rattling blows sap a warrior\'s guard. Lightning shatters their brittle frames.' },
    archer:   { title: 'Archer', lore: 'A ranged hunter that draws its bow from across the room. Close the distance fast, or break line of sight behind a wall.' },
    brute:    { title: 'Brute', lore: 'A slab of muscle that telegraphs a devastating slam. Read the wind-up and step clear, or pay for it in blood.' },
    cultist:  { title: 'Cultist', lore: 'A robed zealot that channels dark fury into its allies rather than fighting itself. Cut the chanting short — kill it first, and the pack loses its edge.' },
    thief:    { title: 'Thief', lore: 'A nimble cutpurse that strikes once, snatches your gold, and bolts for the exit. Catch it before it escapes the floor, or the coin is gone for good.' },
    warden:   { title: 'Warden', lore: 'An armored sentinel that shrugs off stuns and crushes the strength from those it strikes. You will not lock it down — you must out-position it.' },
    bat:      { title: 'Bat', lore: 'A leather-winged horror that lurches through the dark on no fixed path. Hard to predict, harder to corner. Pin it against a wall and end it quickly.' },
    spider:   { title: 'Spider', lore: 'A skittering venom-bag that closes distance in a blink and sinks its fangs deep. Each bite layers more poison — kill it fast, before the venom does the work for it.' },
    necromancer: { title: 'Necromancer', lore: 'A grave-robbing sorcerer who would rather raise the dead than face you himself. Leave him standing and you will fight an endless tide of bone. Silence him first.' },
    imp:        { title: 'Imp',         lore: 'A frenzied little fiend that attacks twice when it gets going. Low HP — but in numbers they overwhelm before you can react. Each bite leaves a burn.' },
    ratman:     { title: 'Ratman',      lore: 'A cowardly skirmisher that fires from a distance and scrambles away the moment you close in. Patient hunters catch it in a corner.' },
    ghoul:      { title: 'Ghoul',       lore: 'It heals from every hit it lands. Trade wounds with a ghoul and you will always lose. Burst it down before it undoes every point of damage you deal.' },
    lizardman:  { title: 'Lizardman',   lore: 'Tough, disciplined, and annoyingly resilient — it heals a little each turn it survives. Drawn-out fights favour it entirely. Hit hard and finish fast.' },
    orc:        { title: 'Orc',         lore: 'A brute with enormous HP and a devastating charge it telegraphs a turn in advance. Predictable. Terrifying. Step clear of the charge line or pay for it.' },
    darkknight: { title: 'Dark Knight', lore: 'An armored counter-fighter. When it raises its guard, striking it is exactly what it wants — the blow is reversed back at you. Wait for the opening.' },
    demon:      { title: 'Demon',       lore: 'A creature of pure destruction that shrugs off fire and closes distance with violent intent. The deep floors forge these things. Lightning hurts them.' },
    mimic:      { title: 'Mimic',       lore: 'It looked exactly like a chest. You were so sure. In hindsight, the teeth were a clue.' },
    boss:     { title: 'Floor Boss', lore: 'A guardian grown strong on the ash. Each is a wall between you and the deeper dark.' },
    spawn:    { title: 'Spawn', lore: 'A lesser horror split from something larger. Cut them down before they overwhelm you.' },
};

// Types deliberately hidden from the Bestiary grid (internal/spawn helpers).
const BESTIARY_HIDDEN = new Set(['spawn']);

function _ensureBestiary() {
    if (!gameMeta.bestiary) gameMeta.bestiary = {};
    return gameMeta.bestiary;
}

function recordBestiarySeen(type) {
    if (!type || BESTIARY_HIDDEN.has(type)) return;
    const b = _ensureBestiary();
    if (!b[type]) b[type] = { seen: true, kills: 0 };
    else b[type].seen = true;
    // Light-touch persistence: seen-marks are saved with the next meta write
    // (kills already trigger one). Avoid a save per reveal to limit churn.
}

function recordBestiaryKill(type) {
    if (!type || BESTIARY_HIDDEN.has(type)) return;
    const b = _ensureBestiary();
    if (!b[type]) b[type] = { seen: true, kills: 0 };
    b[type].seen = true;
    b[type].kills = (b[type].kills || 0) + 1;
    saveMetaProgress();
}

function getBestiaryEntry(type) {
    const b = gameMeta.bestiary || {};
    return b[type] || { seen: false, kills: 0 };
}

// Ordered list of bestiary types for display — follows ENEMY_TYPES order,
// minus hidden helpers, so new types slot in where they're defined.
function getBestiaryTypes() {
    return Object.keys(ENEMY_TYPES).filter(t => !BESTIARY_HIDDEN.has(t));
}

function getBestiaryProgress() {
    const types = getBestiaryTypes();
    const discovered = types.filter(t => getBestiaryEntry(t).seen).length;
    return { discovered, total: types.length };
}


// ── Goals surface ──────────────────────────────────────────────────────────────
// Turns the game's rich-but-implicit meta-progression into explicit, visible
// targets the player can chase. Computes the next 2-3 most relevant objectives
// from current state — the next milestone boss, an arena fame threshold, a
// bestiary completion nudge, etc. Pure read of existing state; no new tracking.
function getNextGoals() {
    const goals = [];
    const best = gameState.bestFloor || 0;

    // 1. Next milestone boss / depth target
    const milestoneFloors = Object.keys(MILESTONE_BOSSES).map(Number).sort((a, b) => a - b);
    const nextMilestone = milestoneFloors.find(f => best < f);
    if (nextMilestone) {
        const boss = MILESTONE_BOSSES[nextMilestone];
        goals.push({
            icon: '\u2620',
            label: `Reach Floor ${nextMilestone} — face ${boss.name}`,
            color: '#ff9f58',
        });
    } else if (best < MAX_DUNGEON_FLOOR) {
        goals.push({ icon: '\u25BC', label: `Descend past Floor ${best} — deeper than ever`, color: '#ff9f58' });
    }

    // 2. Arena fame next tier (only once the Pit is relevant to the player)
    if (typeof isArenaUnlocked === 'function' && isArenaUnlocked() && typeof getNextArenaTier === 'function') {
        const next = getNextArenaTier();
        if (next) {
            const fame = getArenaFame();
            goals.push({
                icon: '\u2694',
                label: `Earn ${next.fame - fame} Arena fame — reach ${next.title}`,
                color: '#c98bff',
            });
        }
    }

    // 3. Next renown milestone
    const nextRenown = getNextRenownMilestone();
    if (nextRenown) {
        const renown = gameMeta.tavernRenown || 0;
        goals.push({
            icon: '\u2605',
            label: `${nextRenown.renown - renown} more Renown — unlock ${nextRenown.label}`,
            color: '#d4a96a',
        });
    }

    // 4. Bestiary completion nudge
    const bp = getBestiaryProgress();
    if (bp.discovered < bp.total) {
        goals.push({
            icon: '\u2763',
            label: `Discover ${bp.total - bp.discovered} more creature${bp.total - bp.discovered === 1 ? '' : 's'} for the Bestiary`,
            color: '#d4a96a',
        });
    }

    // 5. Today's daily, if not yet played
    if (!getDailyRecord()) {
        goals.push({ icon: '\u2600', label: "Take on today's Daily Challenge", color: '#a082ff' });
    }

    // Return the top 3 most relevant
    return goals.slice(0, 3);
}


const RARITY_COLORS = {
    common: '#f0f0f0',
    uncommon: '#6fce82',
    rare: '#62b9ff',
    epic: '#c98bff',
    legendary: '#ff9f3d',
    mythic: '#ff4444'
};


const LEGENDARY_NAMES = {
    weapon: ['Dragonfang Axe', 'Soulreaver Blade', 'Stormcaller Wand', 'Nightwhisper Dagger',
             'Doomforge Maul', 'Whisperwind Bow', 'Embercleaver', 'Frostbite Saber',
             'Thunderlord Spear', 'Gravewarden Scythe', 'Bloodmoon Glaive', 'Cinderfang Khopesh',
             'Stargazer Halberd', 'Venomstrike Rapier', 'Tempest Warhammer', 'Duskfall Crescent',
             'Ironwail Flail', 'Sunderbrand Greataxe'],
    armor: ['Dragonscale Plate', 'Voidweave Cloak', 'Titanforge Mail', 'Shadowguard Vest',
            'Aegis of the Eternal', 'Wraithsilk Shroud', 'Bulwark of Ages', 'Stormhide Jerkin',
            'Emberforged Cuirass', 'Glacial Bulwark', 'Sentinel\u2019s Carapace', 'Mistwalker Garb',
            'Obsidian Aegis', 'Runebound Hauberk'],
    helmet: ['Crown of the Ashen King', 'Dragonsight Helm', 'Visage of the Void', 'Warlord\u2019s Greathelm',
             'Hood of Whispers', 'Sentinel\u2019s Barbute', 'Mask of the Fallen', 'Circlet of Embers'],
    shield: ['Bulwark of Dawn', 'Aegis of the Tide', 'Wall of the World', 'Dragonscale Targe',
             'Ward of the Eternal', 'Bastion of Ash', 'Mirrorface Pavise', 'Ironwill Rampart'],
    boots: ['Striders of the Storm', 'Boots of the Wraithwalker', 'Treads of the Titan', 'Emberstep Greaves',
            'Windrunner Sabatons', 'Pathfinder\u2019s Warboots', 'Shadowstep Footguards', 'Stoneheel Stompers'],
    accessory: ['Ring of the Ash King', 'Amulet of Eternal Flame', 'Sigil of the Depths',
                'Band of the Forgotten', 'Pendant of the Void', 'Circlet of the Pyre',
                'Locket of Lost Souls', 'Torc of the Wyrm', 'Seal of the Ninth Floor',
                'Charm of the Hollow King']
};


const MYTHIC_NAMES = {
    weapon: ['Godslayer', 'World-Ender', 'Ashbringer', 'Oblivion\u2019s Edge', 'The Last Light',
             'Endbringer', 'Fate\u2019s Ruin', 'The Unmaking'],
    armor: ['Mantle of the Fallen God', 'Aegis of Ash', 'Shroud of the Endless', 'Carapace of Eternity',
            'Vestments of the Void', 'Shell of the Sleeping God'],
    helmet: ['Crown of the Fallen God', 'Halo of Oblivion', 'Visage of Eternity', 'Diadem of Ash'],
    shield: ['Aegis of the End', 'The Last Wall', 'Bulwark of Eternity', 'Worldshield'],
    boots: ['Striders of the Endless', 'Treads of Oblivion', 'Footfall of the God'],
    accessory: ['Heart of the Dungeon', 'Crown of Cinders', 'Eye of the Abyss',
                'Soulcage Amulet', 'The Final Hour']
};


const MILESTONE_BOSSES = {
    10:  { name: 'Goblin King',    variant: 'splitter',    color: '#58c26d', glyph: 'K', hpMult: 1.2, atkMult: 1.1,
           announce: 'The Goblin King rises from the ash — floor 10 trembles!' },
    25:  { name: 'Bone Dragon',    variant: 'wraith',      color: '#e8e8f0', glyph: 'D', hpMult: 1.5, atkMult: 1.3,
           announce: 'Bones rattle as the Bone Dragon unfurls its wings!' },
    50:  { name: 'Lich Lord',      variant: 'necromancer', color: '#b06fff', glyph: 'L', hpMult: 1.8, atkMult: 1.4,
           announce: 'The Lich Lord awakens — the dead answer its call!' },
    75:  { name: 'Demon Prince',   variant: 'sentinel',    color: '#ff4444', glyph: 'P', hpMult: 2.0, atkMult: 1.6,
           announce: 'Hellfire spills forth — the Demon Prince has arrived!' },
    100: { name: 'The Fallen God', variant: 'splitter',    color: '#ffd65a', glyph: 'G', hpMult: 2.5, atkMult: 2.0,
           announce: 'Reality cracks — The Fallen God descends from the ash!' }
};


// Maximum number of dungeon floors held in the exploration cache at once.
// At roughly 20KB per floor this caps persistent storage at ~400KB,
// well within the typical 5MB localStorage limit.
const MAX_CACHED_FLOORS = 20;

const TILE_SIZE = 40;

const MAP_WIDTH = 25;

const MAP_HEIGHT = 18;

const EXIT_X = MAP_WIDTH - 3;

const EXIT_Y = MAP_HEIGHT - 3;

const SPAWN_X = 2;

const SPAWN_Y = 2;


// Tile codes: 0 floor, 1 wall, 2 descend stairs, 3 trap,
// 4 ascend stairs (floor 2+, goes up one floor),
// 5 tavern exit (floor 1 only, requires confirmation — see returnToTavern)
// 6 courtyard door (floor 0 only — see toggleCourtyard in tavern.js)
const TILE_ASCEND = 4;

const TILE_TAVERN_EXIT = 5;

const TILE_COURTYARD_DOOR = 6;
// 7 = town road gate (courtyard left wall — leads to the Town map)
const TILE_TOWN_ROAD = 7;
// 8 = zone exit — edge tile that transitions to an adjacent world-map zone.
// Direction is inferred from tile position on the border (top/bottom/left/right wall).
// Used by all new world zones; courtyard and town still use their own tile types
// for backward compatibility.
const TILE_ZONE_EXIT = 8;

// ── 5×5 World Map ─────────────────────────────────────────────────────────────
// Each cell is a named zone type. The player can walk between adjacent passable
// zones via TILE_ZONE_EXIT tiles on their shared edge.
//
//      col:  0           1           2           3           4
const WORLD_MAP = [
  ['mountain', 'mountain', 'mountain', 'mountain', 'mountain'],  // row 0
  ['mountain', 'forest',   'mountain', 'forest',   'mountain'],  // row 1
  ['forest',   'town',     'tavern',   'road',     'mountain'],  // row 2
  ['forest',   'road',     'arena',     'road',     'forest'],    // row 3
  ['forest',   'forest',   'forest',   'forest',   'forest'],    // row 4
];
// 'tavern' (2,2) = courtyard hub (existing).  'town' (2,1) = town (existing).
// All others are new zones generated on first visit and cached in worldGrids.

// Returns true if the player can enter this zone type.
function zonePassable(type) {
    return type !== 'mountain';
}

// Human-readable zone name for messages.
const ZONE_NAMES = {
    tavern:   'the courtyard',
    town:     'town',
    road:     'the open road',
    forest:   'the forest',
    mountain: 'the mountains',
    arena:    'The Pit',
};


// ── Overland zone content ───────────────────────────────────────────────────
// The world map's forests and roads aren't just connective tissue — each one
// can hold a handful of features the player bumps into: foraging nodes, a
// travelling merchant, ambush triggers, and one-shot mini-events. Content is
// rolled once when a zone is first generated and then cached with the zone, so
// a forest you've picked clean stays picked clean.
//
// Feature kinds:
//   forage  — a gatherable node (herbs/berries/mushroom). One-time reward.
//   merchant— a travelling trader; opens a small buy panel.
//   ambush  — an invisible trigger that spawns enemies when stepped near.
//   event   — a one-shot mini-event tile (shrine, camp, lost traveller…).

// Foraging tables, keyed loosely by flavour. reward() runs against the player.
const FORAGE_NODES = [
    { name: 'Wild Herbs',     glyph: '\u2698', color: '#6fbf73',
      desc: 'A cluster of medicinal herbs.',
      reward(p) { const h = 15 + p.level * 2; p.hp = Math.min(p.maxHp, p.hp + h);
                  addFloatingText(p.x, p.y, `+${h}`, '#6fbf73');
                  return `You gather wild herbs and chew them down (+${h} HP).`; } },
    { name: 'Ash Berries',    glyph: '\u2740', color: '#c0567a',
      desc: 'Tart berries that grow in the ashfall.',
      reward(p) { addItemToInventory({ type: 'potion', name: 'Health Potion', qty: 1 });
                  return 'You pick a handful of ash berries and stash a Health Potion\u2019s worth.'; } },
    { name: 'Glowcap Mushroom', glyph: '\u2618', color: '#8a7fff',
      desc: 'A faintly glowing fungus prized by alchemists.',
      reward(p) { const m = Math.min(p.maxMana, (p.mana||0) + 6); p.mana = m;
                  addFloatingText(p.x, p.y, '+6 MP', '#8a7fff');
                  return 'You harvest a glowcap mushroom — arcane vigour returns (+6 mana).'; } },
    { name: 'Coin Pouch',     glyph: '\u26C3', color: '#ffd65a',
      desc: 'Someone dropped this long ago.',
      reward(p) { const g = 12 + Math.floor(rng() * 20); p.gold += g;
                  addFloatingText(p.x, p.y, `+${g}g`, '#ffd65a');
                  return `Half-buried in the leaves: a lost coin pouch (+${g} gold).`; } },
];

// Roadside merchant stock — a small, slightly-cheaper-than-tavern selection so
// the road feels worth travelling. Rolled fresh per merchant.
const ROAD_MERCHANT_STOCK = [
    { type: 'potion',        name: 'Health Potion',   desc: 'Restore HP (35 + level\u00d75)', icon: '+', cost: 12 },
    { type: 'antidote',      name: 'Antidote',        desc: 'Cure poison and burn',          icon: 'A', cost: 15 },
    { type: 'smokeBomb',     name: 'Smoke Bomb',      desc: 'Stun all enemies 1 turn',       icon: 'S', cost: 20 },
    { type: 'rageDraught',   name: 'Rage Draught',    desc: '+50% ATK for 3 turns',          icon: 'R', cost: 24 },
    { type: 'identifyScroll',name: 'Identify Scroll', desc: 'Reveal cursed items',           icon: '?', cost: 20 },
];

// One-shot mini-events. resolve() returns a short message; some give choices
// via a simple risk/reward roll resolved inline (kept simple — no modal).
const ZONE_EVENTS = [
    { id: 'shrine', name: 'Wayside Shrine', glyph: '\u26E9', color: '#ffe39a',
      desc: 'A weathered shrine to a forgotten god.',
      resolve(p) {
          // Small permanent boon, rarely. Mostly a heal + flavour.
          if (rng() < 0.25) { p.maxHp += 5; p.hp += 5;
              return 'You kneel at the shrine. Something old acknowledges you (+5 Max HP).'; }
          p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.25));
          return 'You rest at the shrine. A quiet calm restores you (+25% HP).'; } },
    { id: 'camp', name: 'Abandoned Camp', glyph: '\u26FA', color: '#c89b6a',
      desc: 'A cold campfire and a scatter of supplies.',
      resolve(p) {
          const g = 20 + Math.floor(rng() * 30); p.gold += g;
          if (rng() < 0.4) addItemToInventory({ type: 'potion', name: 'Health Potion', qty: 1 });
          return `You scavenge the abandoned camp (+${g} gold, maybe a potion).`; } },
    { id: 'traveller', name: 'Lost Traveller', glyph: '\u263A', color: '#8fd0ff',
      desc: 'A frightened traveller, grateful for company.',
      resolve(p) {
          const g = 15 + Math.floor(rng() * 25); p.gold += g;
          return `You guide a lost traveller to the road. They press ${g} gold into your hand.`; } },
    { id: 'cache', name: 'Hidden Cache', glyph: '\u25C8', color: '#b48aff',
      desc: 'A loose stone hides something beneath.',
      resolve(p) {
          // Chance at a relic-ish treat, else gear or gold.
          if (typeof createAccessory === 'function' && rng() < 0.5) {
              const item = createAccessory(p.x, p.y); item.x = undefined; item.y = undefined;
              addItemToInventory(item); if (typeof autoEquipIfBetter==='function') autoEquipIfBetter(item);
              return `Beneath the stone: ${item.name}. You pocket it.`; }
          const g = 30 + Math.floor(rng() * 40); p.gold += g;
          return `Beneath the stone: a stash of ${g} gold.`; } },
];

// Tile marker for a world-zone feature. Distinct from dungeon tiles — these
// live in a parallel feature list, not in the grid itself, so the grid stays a
// pure walkability map.
const TILE_ZONE_FEATURE = 9;


const canvas = document.getElementById('game-canvas');

const ctx = canvas.getContext('2d');


const gameState = {
    player: null,
    floor: 0,
    // Current screen/mode — set explicitly by transition functions as they
    // are migrated. getGameMode() derives this from legacy booleans as a
    // fallback so the enum is correct even before explicit assignment.
    mode: null,
    dungeon: [],
    revealed: [],
    rooms: [],
    enemies: [],
    items: [],
    messages: [],
    effects: [],
    gameOver: false,
    awaitingLevelChoice: false,
    pendingLevelChoices: 0,
    frameStarted: false,
    screenShake: 0,
    screenShakeAngle: 0,
    hitStopFrames: 0,
    innkeeper: { x: 12, y: 5, name: 'Innkeeper' },
    merchant: { x: 20, y: 4, name: 'Merchant' },
    blacksmith: { x: 20, y: 13, name: 'Blacksmith' },
    trainer: { x: 12, y: 4, name: 'Trainer' },
    bank: { x: 4, y: 4, name: 'Bank' },
    questBoard: { x: 4, y: 13, name: 'Quest Board' },
    dungeonEntrance: { x: EXIT_X, y: EXIT_Y, name: 'Dungeon Entrance' },
    gambler: { x: 5, y: 14, name: 'Dice Table' },
    brewmaster: { x: 18, y: 14, name: 'Brewmaster' },
    bard: { x: 4, y: 6, name: 'Bard' },
    stashChest: { x: 7, y: 2, name: 'Shared Stash' },
    magicDealer: { x: 12, y: 13, name: 'Magic Dealer' },
    cellar: { x: 11, y: 14, name: 'Cellar' },
    arenaGate: { x: 12, y: 16, name: 'The Pit' },
    // Town NPCs — only active when gameState.inTown === true
    townStorekeeper: { x: 5, y: 4, name: 'General Store' },
    townTemple:      { x: 19, y: 4, name: 'Temple' },
    townAlchemist:   { x: 5, y: 13, name: 'Alchemist' },
    townHall:        { x: 19, y: 13, name: 'Town Hall' },
    townStoreOpen:   false,
    townTempleOpen:  false,
    townAlchemistOpen: false,
    townHallOpen:    false,
    shopOpen: false,
    charSheetOpen: false,
    gamblingOpen: false,
    brewmasterOpen: false,
    bardOpen: false,
    stashOpen: false,
    magicDealerOpen: false,
    blacksmithOpen: false,
    trainerOpen: false,
    bankOpen: false,
    innOpen: false,
    tavernConfirmOpen: false,
    ringChoiceOpen: false,
    pendingRingItem: null,
    helpOpen: false,
    settingsOpen: false,
    bestiaryOpen: false,
    // Daily Challenge run flags — set when a run is launched from the daily
    // entry point, so the death screen can frame it as a daily result and
    // record it against today's date.
    isDailyRun: false,
    dailyKey: null,
    // Active dungeon event for this run — set at run-start, persists through
    // the whole descent, modifies spawn weights and loot. null = normal run.
    dungeonEvent: null,
    lastHelpTab: 'controls',
    trainerBought: { hp: false, atk: false },
    magicStock: [],
    activeBrew: null,
    activeSong: null,
    activeQuest: null,
    generatedBounties: [],
    // Cellar Find — rolled once per run (see descendFloor/initGame),
    // not guaranteed; see CELLAR_FIND_CHANCE in data.js and openCellar()
    // in tavern.js. cellarHasFind is the roll result, cellarClaimed
    // tracks whether the player has already taken it this run (the
    // find is consumed immediately on pickup, not a permanent fixture).
    cellarHasFind: false,
    cellarClaimed: false,
    cellarFindOpen: false,
    spellbookOpen: false,
    // Run-level Ironman — chosen once at character creation, locked for
    // the whole run. Locks out the Bank and Shared Stash (see their
    // open functions in tavern.js) in exchange for +8% gold find and
    // +5% rarity odds (see recalculateStats in combat.js and
    // rollRarity in dungeon.js). Distinct from arenaIronman below, the
    // Arena's own separate per-bout toggle.
    ironmanMode: false,
    // Arena's own Ironman toggle — chosen fresh each time the Arena is
    // entered (see openArena in tavern.js), not locked at character
    // creation like ironmanMode above. OFF by default: losing a bout
    // just ends it with no real cost. ON: a loss costs the run, same
    // as a real dungeon death.
    arenaIronman: false,
    bestFloor: 0,
    // Second physical space reachable from the tavern's courtyard door
    // (see generateCourtyard() in dungeon.js, toggleCourtyard() in
    // tavern.js) without ever changing gameState.floor. courtyard holds
    // the outdoor grid; tavernDungeon caches the tavern's own grid
    // while the player is outside, so walking back in restores it
    // instantly rather than regenerating it (matching how dungeon
    // floors already aren't regenerated on revisit).
    courtyard: [],
    tavernDungeon: null,
    inCourtyard: false,
    // Town map — the settlement outside the courtyard. Accessed via the
    // road gate on the courtyard's left wall. Same swap-grid pattern as
    // the courtyard: town[] is cached after first generation and swapped
    // into gameState.dungeon on entry without touching gameState.floor.
    town: [],
    inTown: false,
    // ── World map position ─────────────────────────────────────────────────
    // worldPos tracks which 5×5 WORLD_MAP cell the player is currently in.
    // worldGrids caches generated zone grids by "row,col" key so each zone
    // is only generated once per run. These are separate from the tavern
    // interior / courtyard / town grids which have their own named caches.
    worldPos:   { row: 2, col: 2 }, // start in tavern courtyard
    worldGrids: {},                 // key: "row,col" → 2D tile array
    worldZoneFeatures: {},          // key: "row,col" → array of feature objects (forage/merchant/ambush/event)
    zoneFeatures: [],               // live feature list for the zone the player is currently in
    inZoneCombat: false,            // true while an overland ambush is being fought
    roadMerchantOpen: false,        // travelling-merchant panel open
    inArena:    false,              // player is in the arena zone (not necessarily in a bout)
    // ── Town Portal return system ──────────────────────────────────────────
    // When the player leaves the dungeon via a Town Portal spell or a
    // Hearthstone Coin, the floor they left is banked here so they can return
    // to the exact same floor (restored from floorCache) rather than starting
    // over at floor 1. null = no active portal anchor.
    dungeonReturnFloor: null,
    decorations: [],
    decorGrid: null,
    frameTick: 0,
    // Tracks which hub NPCs the player was already adjacent to last
    // frame, so ambient flavor lines fire once on approach rather than
    // spamming the Chronicle every frame the player stands nearby.
    npcProximity: {},
    interactables: [],
    traps: [],
    allies: [],
    decoy: null,
    arenaOpen: false,
    profileOpen: false,
    trophyOpen: false,
    stableOpen: false,
    // Set to true while a Pit bout is in progress. Drives combat-mode
    // checks in entities.js (enemy turns, attack routing) and intercepts
    // showGameOver() for non-ironman losses in ui.js.
    inArenaBout: false,
    arenaBoutData: null,   // { bet, ironman, bout, savedDungeon, ... }
    capturedCreatures: [], // enemies netted in the dungeon, waiting to fight
    hoverEnemy: null,
    hoverTile: null,
    fallenEnemies: [],
    runStats: null,
    runAchievementsUnlocked: [],
    // Session-only floor cache — stores each floor's full state when the
    // player leaves so re-entry restores explored tiles, survivors, and
    // remaining items rather than regenerating the floor blank.
    // Cleared on new run; persisted to localStorage (capped at
    // MAX_CACHED_FLOORS to bound storage size).
    floorCache: {},
    floorCacheOrder: [], // insertion-order list for LRU eviction
};

// ── Mode accessor ─────────────────────────────────────────────────────────────
// Always call getGameMode() — never read gameState.mode directly — so the
// derive bridge stays correct during the multi-phase migration.
// New code must NOT read inArena, inArenaBout, or compare floor===0 for
// routing: use getGameMode() only. Violations caught by grep in review.
function deriveLegacyMode(s) {
    if (!s)                          return GAME_STATE.TITLE;
    if (s.inArenaBout || s.inArena)  return GAME_STATE.PIT;
    if (s.gameOver)                  return GAME_STATE.DEATH;
    if (s.floor === 0)               return GAME_STATE.TAVERN;
    return GAME_STATE.DUNGEON;
}

function getGameMode(s) {
    const state = s || gameState;
    return state.mode ?? deriveLegacyMode(state);
}


const DEATH_FLAVOR = {
    slime: 'explodes into goo.',
    goblin: 'crumples in a heap.',
    skeleton: 'clatters into a pile of bones.',
    archer: 'falls with a thud.',
    brute: 'collapses like a felled tree.',
    cultist: 'falls silent mid-chant.',
    thief: 'drops its stolen purse.',
    warden: 'topples in a clatter of armor.',
    bat: 'drops from the air in a heap.',
    spider: 'curls up and goes still.',
    necromancer: 'crumbles, its spell unfinished.',
    imp: 'vanishes in a puff of smoke.',
    ratman: 'squeals and collapses.',
    ghoul: 'shudders, its stolen life fleeing it.',
    lizardman: 'falls heavily, scales fading.',
    orc: 'crashes down like a felled oak.',
    darkknight: 'shatters apart in dark armour.',
    demon: 'erupts in cinders and is gone.',
    mimic: 'snaps shut one last time and goes still.',
    boss: 'is slain!',
    spawn: 'dissolves into ichor.'
};


const DECOR_TYPES = [
    { id: 'torch',   weight: 0.03 },
    { id: 'bones',   weight: 0.04 },
    { id: 'crack',   weight: 0.06 },
    { id: 'puddle',  weight: 0.04 },
    { id: 'statue',  weight: 0.02 },
    { id: 'moss',    weight: 0.07 },  // organic patches — most common, breaks monotony
    { id: 'rubble',  weight: 0.05 },  // broken stone chunks
    { id: 'pillar',  weight: 0.025 }, // broken pillar stumps — rarer, more dramatic
];


const WORLD_OBJECTS = {
    chest_common:  { label: 'Common Chest',   glyph: '\u25A1', color: '#c8a060', xp: 0 },
    chest_rare:    { label: 'Rare Chest',     glyph: '\u25C6', color: '#62b9ff', xp: 0 },
    chest_cursed:  { label: 'Cursed Chest',   glyph: '\u2620', color: '#9966cc', xp: 0 },
    discovery_camp:    { label: 'Abandoned Camp',    glyph: '\u26FA', color: '#d4b97a', xp: 12 },
    discovery_shrine:  { label: 'Forgotten Shrine',  glyph: '\u2726', color: '#ffd65a', xp: 18 },
    discovery_library: { label: 'Ancient Library',   glyph: '\u2261', color: '#55c7ff', xp: 24 },
    event_merchant:    { label: 'Wandering Merchant', glyph: '$', color: '#ffd65a', xp: 0 },
    event_shrine:      { label: 'Ancient Shrine',     glyph: '\u2726', color: '#b06fff', xp: 0 },
    event_altar:       { label: 'Cursed Altar',       glyph: '\u2620', color: '#9966cc', xp: 0 },
    event_adventurer:  { label: 'Lost Adventurer',    glyph: '?', color: '#78bfff', xp: 0 },
    event_vault:       { label: 'Treasure Vault',     glyph: '\u25C6', color: '#62b9ff', xp: 0 },
    event_offering:    { label: 'Cursed Offering',    glyph: '\u2665', color: '#c0392b', xp: 0 },
    event_horde:       { label: 'Wandering Horde',    glyph: '\u2620', color: '#e67e22', xp: 0 },
    event_den:         { label: 'Gambling Den',        glyph: '\u2680', color: '#ffd65a', xp: 0 },
    event_shadlib:     { label: 'Shadowed Library',   glyph: '\u2261', color: '#55c7ff', xp: 0 }
};


const GEAR_SLOTS = ['helmet', 'chest', 'weapon', 'shield', 'ring1', 'ring2', 'amulet', 'boots'];

const DEF_GEAR_SLOTS = ['chest', 'helmet', 'shield', 'boots'];

// Includes a generic 'ring' key alongside ring1/ring2 — dropped/unequipped
// jewelry items stay generic (slot: 'ring') until the moment they're
// equipped, so lookups like SLOT_GLYPHS[item.slot] need that key to resolve
// even though the actual equipment object only ever has ring1/ring2.
// Glyphs must be visually unambiguous in the page's monospace font —
// the previous shield='O' and ring='o' rendered nearly identical to the
// digit 0 in Courier New (no slash/dot on its zero), making every empty
// Ring/Shield slot read as a stray "0" rather than an icon.
const SLOT_GLYPHS = { weapon: '/', chest: ']', helmet: '^', shield: '\u26E8', boots: 'v', ring: '\u25CB', ring1: '\u25CB', ring2: '\u25CB', amulet: '\u2726' };

const SLOT_LABELS = { helmet: 'Helmet', chest: 'Chest', weapon: 'Weapon', shield: 'Shield', ring: 'Ring', ring1: 'Ring', ring2: 'Ring', amulet: 'Amulet', boots: 'Boots' };

const JEWELRY_SLOTS = ['ring', 'ring1', 'ring2', 'amulet'];


const ACHIEVEMENT_DEFS = [
    { id: 'first_blood', name: 'First Blood', desc: 'Slay your first enemy' },
    { id: 'slime_squasher', name: 'Slime Squasher', desc: 'Kill 10 Slimes' },
    { id: 'goblin_slayer', name: 'Goblin Slayer', desc: 'Defeat the Goblin King' },
    { id: 'bone_breaker', name: 'Bone Breaker', desc: 'Defeat the Bone Dragon' },
    { id: 'lich_bane', name: 'Lich Bane', desc: 'Defeat the Lich Lord' },
    { id: 'demon_slayer', name: 'Demon Slayer', desc: 'Defeat the Demon Prince' },
    { id: 'godslayer', name: 'Godslayer', desc: 'Defeat The Fallen God' },
    { id: 'the_delver', name: 'The Delver', desc: 'Reach Floor 25' },
    { id: 'deep_delver', name: 'Deep Delver', desc: 'Reach Floor 50' },
    { id: 'ash_walker', name: 'Ash Walker', desc: 'Reach Floor 75' },
    { id: 'millionaire', name: 'Millionaire', desc: 'Deposit 1000 Gold' },
    { id: 'tavern_patron', name: 'Tavern Patron', desc: 'Upgrade the Broken Flagon' },
    { id: 'boss_hunter', name: 'Boss Hunter', desc: 'Slay 5 bosses' },
    { id: 'legend_seeker', name: 'Legend Seeker', desc: 'Find a Legendary item' },
    { id: 'hard_lesson', name: 'A Hard Lesson', desc: 'Die 25 times' },
    { id: 'flawless_victory', name: 'Flawless Victory', desc: 'Defeat a boss without taking damage from it' },
    { id: 'fortune_favors', name: 'Fortune Favors the Bold', desc: 'Earn 1000 total gold across all runs' },
    { id: 'centurion', name: 'Centurion', desc: 'Slay 100 enemies' },
    { id: 'high_roller', name: 'High Roller', desc: 'Win 10 dice games at the tavern' },
    { id: 'archivist', name: 'Archivist', desc: 'Identify 20 unidentified items' }
];



const SUBCLASS_ABILITIES = {
    berserker:      { name: 'Frenzied Strike', cost: '20% HP', mana: 0 },
    knight:         { name: 'Shield Wall', cost: '—', mana: 0 },
    gladiator:      { name: 'Riposte', cost: '—', mana: 0 },
    assassin:       { name: 'Shadow Strike', cost: '—', mana: 0 },
    trickster:      { name: 'Set Trap', cost: '1 charge', mana: 0 },
    shadow:         { name: 'Shadow Step', cost: '—', mana: 4 },
    elementalist:   { name: 'Prism Bolt', cost: '3 mana', mana: 3 },
    illusionist:    { name: 'Phantom Twin', cost: '4 mana', mana: 4 },
    necromancer:    { name: 'Raise Dead', cost: '5 mana', mana: 5 },
    warDomain:      { name: 'Smite', cost: '3 mana', mana: 3 },
    lightDomain:    { name: 'Searing Light', cost: '4 mana', mana: 4 },
    twilightDomain: { name: 'Moonbeam', cost: '3 mana', mana: 3 }
};


// Shared stash persists across deaths — initialized at script load, not reset on death
const STASH_MAX = 3;

let gameSharedStash = [];


// Tavern upgrades persist permanently across all runs
const gameState_tavernUpgrades = {
    skeletonKingSkull: false,
    velvetChairs: false,
    royalRug: false,
    chandelier: false,
    goldDonated: 0,
    bankGold: 0,
    defeatedMilestones: [],
    // Purchasable upgrades (Innkeeper)
    trainerDiscount: false,
    stockedPantry: false,
    ironSconces: false,
    tavernCat: false,
    polishedBar: false,
    // Legendary guest one-time reward flags — each becomes true once the
    // player collects the reward, so repeat visits give flavor only.
    guestChroniclerVisited: false,
    guestSurvivorVisited: false,
    guestWitnessVisited: false,
    guestKnightVisited: false,
    guestLegendVisited: false,
};

gameState.tavernUpgrades = gameState_tavernUpgrades;


// Innkeeper's purchasable upgrade menu — a mix of mechanical (real
// gameplay effect) and cosmetic (visual only, drawn in
// drawTavernDetails()) one-time permanent purchases. Data-driven so
// adding a new upgrade later doesn't require touching the panel
// rendering or purchase-flow code, only this list.
const INNKEEPER_UPGRADES = [
    {
        id: 'trainerDiscount',
        name: 'Haggling Rights',
        kind: 'mechanical',
        cost: 250,
        desc: 'Permanently reduces Trainer prices by 20%.',
        flavor: '"Tell the Trainer the Flagon sent you," the innkeeper winks.'
    },
    {
        id: 'stockedPantry',
        name: 'Stocked Pantry',
        kind: 'mechanical',
        cost: 200,
        desc: 'Start every run with 1 extra Health Potion.',
        flavor: '"Can\'t send you down hungry," he says, tucking a potion into your pack.'
    },
    {
        id: 'ironSconces',
        name: 'Iron Sconces',
        kind: 'cosmetic',
        cost: 120,
        desc: 'Upgrades the tavern\'s torch fixtures.',
        flavor: 'The old wall-torches are replaced with proper ironwork.'
    },
    {
        id: 'tavernCat',
        name: 'Adopt the Tavern Cat',
        kind: 'cosmetic',
        cost: 100,
        desc: 'A cat takes up residence in the tavern.',
        flavor: '"She showed up one night and never left," the innkeeper shrugs.'
    },
    {
        id: 'polishedBar',
        name: 'Polish the Bar',
        kind: 'cosmetic',
        cost: 150,
        desc: 'A proper shine for the old bar counter.',
        flavor: 'Years of spilled ale finally give way to a mirror shine.'
    }
];


// Lifetime meta-progression — persists across every run, shown on the tavern screen
let gameMeta = {
    totalGold: 0,
    runs: 0,
    deaths: 0,
    bossesSlain: 0,
    achievements: {},
    // Pit persistence — fame and bout counts survive across runs
    pitFame: 0,
    pitBouts: 0,
    pitWins: 0,
    // Hybrid meta-progression (Phase 3+)
    // flagonCoins: permanent power currency, never lost on death.
    // treasurySpent: { upgradeId: true } — which Treasury nodes are bought.
    // treasuryLevel is NOT stored; derived via getTreasuryLevel() in save.js.
    flagonCoins: 0,
    treasurySpent: {},
    // Tavern Renown — earned from play across all systems, gates the ambient
    // and structural upgrades that make the tavern visually richer and add
    // services over time. See RENOWN_MILESTONES and earnRenown().
    tavernRenown: 0,
    // First-time contextual hints already shown (id -> true).
    hintsSeen: {},
    // The Fallen — a rolling roster of the last 8 dead characters, shown on
    // the title screen as a persistent graveyard. Gives the world weight and
    // rewards players who push deep. Shape: { name, className, level, floor,
    // killedBy, ts }. Capped at 8 so it never grows unbounded.
    fallen: [],
    dailyRecords: {},
    casinoJackpot: 50,
    casinoJackpotLastClaimed: null,
    casinoWheelSpins: 0,
    casinoWheelBigWins: 0,
    stats: {
        totalKills: 0,
        slimeKills: 0,
        goblinKills: 0,
        goldDeposited: 0,
        milestoneBosses: {},
        legendariesFound: 0
    }
};


const CLASSES = {
    warrior: { hp: 120, maxHp: 120, atk: 12, def: 8, mana: 0, maxMana: 0, ability: 'Shield Block' },
    rogue: { hp: 80, maxHp: 80, atk: 10, def: 4, mana: 0, maxMana: 0, ability: 'Backstab' },
    mage: { hp: 60, maxHp: 60, atk: 6, def: 2, mana: 30, maxMana: 30, ability: 'Fireball' },
    cleric: { hp: 100, maxHp: 100, atk: 8, def: 6, mana: 25, maxMana: 25, ability: 'Heal' }
};


const TILE_COLORS = {
    floor: '#252525',
    wall: '#4a4a4a',
    exit: '#7a4fc2',
    ascend: '#ffd65a',
    trap: '#553232',
    tavernFloor: '#3b2a1e',
    tavernWall: '#5a341f',
    bar: '#8b5a2b'
};


const ENEMY_TYPES = {
    goblin:   { name: 'goblin',       hp: 18,  atk: 5,  def: 2, xp: 10, color: '#d32f2f', range: 1, glyph: 'G' },
    slime:    { name: 'slime',        hp: 26,  atk: 4,  def: 1, xp: 9,  color: '#58c26d', range: 1, glyph: 'S', elementWeakness: 'fire' },
    skeleton: { name: 'skeleton',     hp: 22,  atk: 7,  def: 3, xp: 12, color: '#d8d4ca', range: 1, glyph: 'K', elementWeakness: 'lightning' },
    archer:   { name: 'archer',       hp: 16,  atk: 6,  def: 1, xp: 13, color: '#78bfff', range: 4, glyph: 'A' },
    brute:    { name: 'brute',        hp: 36,  atk: 10, def: 4, xp: 18, color: '#d08aff', range: 1, glyph: 'B' },
    // ── Mid-game types (floor 8+) — each introduces one new tactical wrinkle ──
    // Cultist: a fragile support caster that buffs the ATK of nearby allies
    // instead of attacking. Teaches "kill the support first."
    cultist:  { name: 'cultist',      hp: 20,  atk: 4,  def: 1, xp: 16, color: '#b06fff', range: 3, glyph: 'C' },
    // Thief: steals gold on hit, then flees instead of fighting. If it escapes
    // off the floor, the gold is gone. Teaches "catch it fast or lose loot."
    thief:    { name: 'thief',        hp: 24,  atk: 5,  def: 2, xp: 20, color: '#e0c060', range: 1, glyph: 'T' },
    // Warden: a stun-immune tank that reliably weakens you on hit. Can't be
    // crowd-controlled — teaches "some enemies you out-position, not lock down."
    warden:   { name: 'warden',       hp: 52,  atk: 9,  def: 6, xp: 26, color: '#8fb0c8', range: 1, glyph: 'W' },
    // ── Second wave of mid-game types — each carries its own art + mechanic ──
    // Bat: erratic flyer (floor 5+). Low HP, moves unpredictably rather than
    // straight at you, attacks in quick flurries. Teaches "corner it, don't chase."
    bat:      { name: 'bat',          hp: 12,  atk: 4,  def: 0, xp: 11, color: '#9a7bb0', range: 1, glyph: 'V' },
    // Spider: fast venomous skirmisher (floor 6+). Low HP/DEF but closes the
    // gap quickly and stacks poison on hit. Teaches "kill it before it stacks."
    spider:   { name: 'spider',       hp: 20,  atk: 5,  def: 1, xp: 15, color: '#7a6a55', range: 1, glyph: 'X' },
    // Necromancer: a regular summoner (floor 14+, distinct from the boss
    // variant). Raises a weak skeleton periodically instead of attacking.
    // Teaches "kill the summoner or drown in adds."
    necromancer: { name: 'necromancer', hp: 28, atk: 6, def: 2, xp: 28, color: '#8c5cc0', range: 3, glyph: 'N' },
    // ── Elite / deep-floor types (floor 20–50+) — inhabit the back half ──────
    // Imp: small fast fiend (floor 20+). Low HP but takes two actions when
    // enraged, leaving a burn on hit. Teaches "kill it before it doubles up."
    imp:       { name: 'imp',          hp: 18,  atk: 6,  def: 1, xp: 22, color: '#ff6030', range: 1, glyph: 'i' },
    // Ratman: cowardly ranged skirmisher (floor 22+). Fires from distance and
    // retreats when the player closes in. Teaches "close the gap fast."
    ratman:    { name: 'ratman',       hp: 22,  atk: 7,  def: 1, xp: 24, color: '#a08060', range: 4, glyph: 'R' },
    // Ghoul: lifesteal predator (floor 25+). Heals equal to half the damage
    // it deals — outpaces healing if the fight drags. Teaches "burst it down."
    ghoul:     { name: 'ghoul',        hp: 40,  atk: 8,  def: 2, xp: 30, color: '#7aaa80', range: 1, glyph: 'U' },
    // Lizardman: regenerating warrior (floor 30+). Recovers HP each turn it
    // survives. Punishes attrition. Teaches "focus damage, end it quickly."
    lizardman: { name: 'lizardman',    hp: 48,  atk: 9,  def: 4, xp: 34, color: '#80c050', range: 1, glyph: 'Z' },
    // Orc: slow bruiser (floor 35+). Massive HP and ATK, but skips every
    // other turn charging. Predictable — but devastating when it lands.
    orc:       { name: 'orc',          hp: 70,  atk: 12, def: 5, xp: 40, color: '#5a8030', range: 1, glyph: 'O' },
    // Dark Knight: counter-fighter (floor 40+). Telegraphs a parry stance;
    // striking it during parry deals counter damage to the player.
    darkknight:{ name: 'dark knight',  hp: 65,  atk: 12, def: 6, xp: 48, color: '#5060a0', range: 1, glyph: 'D' },
    // Demon: deep-floor elite (floor 50+). Fire-immune, devastating close up.
    // Pure power check for players who push into the final third.
    demon:     { name: 'demon',        hp: 80,  atk: 14, def: 6, xp: 60, color: '#cc3020', range: 1, glyph: 'M', elementWeakness: 'lightning' },
    // Mimic: a chest tile that ambushes when opened (special — spawns as loot,
    // not as an enemy). Handled entirely in dungeon.js / items.js.
    mimic:     { name: 'mimic',        hp: 45,  atk: 11, def: 3, xp: 35, color: '#c8a060', range: 1, glyph: '?' },
    boss:     { name: 'floor boss',   hp: 82,  atk: 13, def: 5, xp: 45, color: '#ff9f58', range: 1, glyph: '!' },
    spawn:    { name: 'spawn',        hp: 18,  atk: 6,  def: 2, xp: 8,  color: '#ff7f3a', range: 1, glyph: 's' },
};


const BOSS_VARIANTS = {
    splitter:    { name: 'The Splitter',      color: '#ff6b35', glyph: '✦', announce: 'The Splitter lurches from the shadows — kill it before it divides!' },
    necromancer: { name: 'The Necromancer',   color: '#b06fff', glyph: 'N', announce: 'The Necromancer stirs the dead — do not let it raise its fallen kin!' },
    sentinel:    { name: 'The Iron Sentinel', color: '#a8c8e8', glyph: 'S', announce: 'The Iron Sentinel stands guard — watch for its phase shifts!' },
    wraith:      { name: 'The Void Wraith',   color: '#7fffd4', glyph: 'W', announce: 'The Void Wraith flickers between worlds — it cannot be stopped!' },
};


const RARITIES = [
    { name: 'common', bonus: 1, chance: 0.52 },
    { name: 'uncommon', bonus: 2, chance: 0.28 },
    { name: 'rare', bonus: 3, chance: 0.13 },
    { name: 'epic', bonus: 5, chance: 0.055 },
    { name: 'legendary', bonus: 8, chance: 0.012 },
    { name: 'mythic', bonus: 12, chance: 0.003 }
];


const ACCESSORY_EFFECTS = {
    lifesteal: { label: 'Vampiric', desc: 'Heal a % of damage you deal', unit: '%', scale: 2, names: ['Ring', 'Fang'] },
    critChance: { label: 'Precision', desc: '+ Critical hit chance', unit: '%', scale: 3, names: ['Lens', 'Charm'] },
    goldFind: { label: 'Fortune', desc: '+ Gold found from drops', unit: '%', scale: 8, names: ['Coin', 'Talisman'] },
    thorns: { label: 'Thorned', desc: 'Reflect % of damage taken back at attackers', unit: '%', scale: 4, names: ['Briar', 'Pendant'] },
    manaRegen: { label: 'Arcane', desc: '+ Mana regen each turn', unit: '', scale: 1, names: ['Amulet', 'Sigil'] },
    critChance2: { label: 'Deadeye', desc: '+ Critical hit chance', unit: '%', scale: 4, names: ['Monocle', 'Mark'] },
    lifesteal2: { label: 'Sanguine', desc: 'Heal a % of damage you deal', unit: '%', scale: 3, names: ['Chalice', 'Tooth'] },
    goldFind2: { label: 'Avarice', desc: '+ Gold found from drops', unit: '%', scale: 12, names: ['Hoard', 'Crown'] },
    thorns2: { label: 'Bramble', desc: 'Reflect % of damage taken back at attackers', unit: '%', scale: 6, names: ['Spire', 'Husk'] },
    manaRegen2: { label: 'Mystic', desc: '+ Mana regen each turn', unit: '', scale: 2, names: ['Orb', 'Rune'] },
    // Tier-3 variants — rarer, stronger rolls of the same derived stats, for
    // deeper-floor / higher-rarity drops. They map to the exact same derived
    // stat in recalculateStats (effectId startsWith check), so no new wiring.
    critChance3: { label: 'Assassin\u2019s', desc: '+ Critical hit chance', unit: '%', scale: 5, names: ['Eye', 'Fang'] },
    lifesteal3: { label: 'Exsanguine', desc: 'Heal a % of damage you deal', unit: '%', scale: 4, names: ['Heart', 'Maw'] },
    goldFind3: { label: 'Midas', desc: '+ Gold found from drops', unit: '%', scale: 16, names: ['Touch', 'Signet'] },
    thorns3: { label: 'Ironbark', desc: 'Reflect % of damage taken back at attackers', unit: '%', scale: 8, names: ['Carapace', 'Bulwark'] },
    manaRegen3: { label: 'Eldritch', desc: '+ Mana regen each turn', unit: '', scale: 3, names: ['Heart', 'Codex'] },
    // Flat combat-stat jewelry — boosts raw ATK or DEF (folded into the same
    // stat as gear, see recalculateStats). 'unit' is blank since these are flat
    // point values, not percentages.
    atkFlat:  { label: 'Warding', desc: '+ Attack', unit: '', scale: 1, names: ['Band', 'Signet'] },
    atkFlat2: { label: 'Brutal', desc: '+ Attack', unit: '', scale: 2, names: ['Fist', 'Seal'] },
    defFlat:  { label: 'Stalwart', desc: '+ Defense', unit: '', scale: 1, names: ['Loop', 'Guard'] },
    defFlat2: { label: 'Adamant', desc: '+ Defense', unit: '', scale: 2, names: ['Bastion', 'Wall'] }
};


// ── Relics ──────────────────────────────────────────────────────────────────
// A 5-slot system separate from equipment — found as dungeon drops or bought
// guaranteed (at a premium) from the Magic Dealer. Two effect shapes:
//   'stat'    — a flat modifier folded into recalculateStats(), same pattern
//               as jewelry effects.
//   'trigger' — an event-hook effect with no continuous stat presence; the
//               relic object itself carries trigger-specific state (e.g.
//               Phoenix Feather's `charged` flag) so swapping it out and back
//               in preserves progress instead of resetting it.
const RELIC_MAX_SLOTS = 5;


const RELIC_DEFS = {
    lucky_coin: {
        name: 'Lucky Coin',
        desc: '+20% gold from all sources',
        glyph: '\u25C9',
        color: '#ffd65a',
        rarity: 'rare',
        cost: 140,
        kind: 'stat',
        stat: 'goldFind',
        value: 20
    },
    blood_idol: {
        name: 'Blood Idol',
        desc: '+5 Attack, -20 Max HP',
        glyph: '\u2620',
        color: '#e14b4a',
        rarity: 'epic',
        cost: 180,
        kind: 'stat',
        stat: 'atkHpTradeoff',
        atk: 5,
        maxHp: -20
    },
    phoenix_feather: {
        name: 'Phoenix Feather',
        desc: 'Revive once at 1 HP when you would die. Recharges after defeating a milestone boss.',
        glyph: '\u2748',
        color: '#ff9f3d',
        rarity: 'legendary',
        cost: 320,
        kind: 'trigger',
        trigger: 'onLethalDamage'
    },
    necrotic_skull: {
        name: 'Necrotic Skull',
        desc: 'Killing a Skeleton restores 15% of your max HP',
        glyph: '\u2620',
        color: '#9966cc',
        rarity: 'epic',
        cost: 180,
        kind: 'trigger',
        trigger: 'onSkeletonKill',
        healPct: 15
    },
    merchants_scale: {
        name: "Merchant's Scale",
        desc: '+35% gold from all sources',
        glyph: '\u2696',
        color: '#ffd65a',
        rarity: 'epic',
        cost: 200,
        kind: 'stat',
        stat: 'goldFind',
        value: 35
    },
    vampiric_chalice: {
        name: 'Vampiric Chalice',
        desc: 'Heal 12% of all damage you deal',
        glyph: '\u2641',
        color: '#c0392b',
        rarity: 'epic',
        cost: 210,
        kind: 'stat',
        stat: 'lifesteal',
        value: 12
    },
    thornmail_heart: {
        name: 'Thornmail Heart',
        desc: 'Reflect 25% of damage taken back at attackers',
        glyph: '\u2756',
        color: '#7a9e3a',
        rarity: 'rare',
        cost: 160,
        kind: 'stat',
        stat: 'thorns',
        value: 25
    },
    assassins_eye: {
        name: "Assassin's Eye",
        desc: '+20% critical hit chance',
        glyph: '\u25C9',
        color: '#e74c3c',
        rarity: 'epic',
        cost: 220,
        kind: 'stat',
        stat: 'critChance',
        value: 20
    },
    mana_wellspring: {
        name: 'Mana Wellspring',
        desc: '+3 mana regenerated each turn',
        glyph: '\u2727',
        color: '#5dade2',
        rarity: 'rare',
        cost: 150,
        kind: 'stat',
        stat: 'manaRegenBonus',
        value: 3
    },
    titans_girdle: {
        name: "Titan's Girdle",
        desc: '+8 Attack, +40 Max HP',
        glyph: '\u26A1',
        color: '#e67e22',
        rarity: 'legendary',
        cost: 340,
        kind: 'stat',
        stat: 'atkHpBonus',
        atk: 8,
        maxHp: 40
    },
    glass_chrysalis: {
        name: 'Glass Chrysalis',
        desc: '+12 Attack, but -40 Max HP. For the reckless.',
        glyph: '\u25C7',
        color: '#9b59b6',
        rarity: 'epic',
        cost: 200,
        kind: 'stat',
        stat: 'atkHpTradeoff',
        atk: 12,
        maxHp: -40
    },
    hunters_totem: {
        name: "Hunter's Totem",
        desc: 'Killing a beast (Bat, Spider, Ratman) restores 10% max HP',
        glyph: '\u2042',
        color: '#27ae60',
        rarity: 'rare',
        cost: 170,
        kind: 'trigger',
        trigger: 'onBeastKill',
        healPct: 10
    },
    warlords_banner: {
        name: "Warlord's Banner",
        desc: 'Gain +1 Attack permanently each time you descend a floor',
        glyph: '\u2691',
        color: '#c0392b',
        rarity: 'legendary',
        cost: 360,
        kind: 'trigger',
        trigger: 'onDescend',
        atkPerFloor: 1
    },
    // ── New stat relics (use only the derived stats recalculateStats already
    //    supports: goldFind / lifesteal / thorns / critChance / manaRegenBonus —
    //    so they need no new wiring) ──────────────────────────────────────────
    gamblers_dice: {
        name: "Gambler's Dice",
        desc: '+8% Critical hit chance',
        glyph: '\u2680',
        color: '#e8c050',
        rarity: 'rare',
        cost: 160,
        kind: 'stat',
        stat: 'critChance',
        value: 8
    },
    serpent_fang: {
        name: 'Serpent Fang',
        desc: 'Heal 18% of all damage you deal',
        glyph: '\u2625',
        color: '#27ae60',
        rarity: 'legendary',
        cost: 300,
        kind: 'stat',
        stat: 'lifesteal',
        value: 18
    },
    spiked_aegis: {
        name: 'Spiked Aegis',
        desc: 'Reflect 25% of damage taken back at attackers',
        glyph: '\u26E8',
        color: '#7f8c8d',
        rarity: 'epic',
        cost: 210,
        kind: 'stat',
        stat: 'thorns',
        value: 25
    },
    archmages_focus: {
        name: "Archmage's Focus",
        desc: '+3 Mana regen each turn',
        glyph: '\u2727',
        color: '#7b5fff',
        rarity: 'epic',
        cost: 200,
        kind: 'stat',
        stat: 'manaRegenBonus',
        value: 3
    },
    dragons_hoard: {
        name: "Dragon's Hoard",
        desc: '+50% gold from all sources',
        glyph: '\u25C9',
        color: '#ffd65a',
        rarity: 'legendary',
        cost: 340,
        kind: 'stat',
        stat: 'goldFind',
        value: 50
    },
    duelists_edge: {
        name: "Duelist's Edge",
        desc: '+12% Critical hit chance',
        glyph: '\u2694',
        color: '#62b9ff',
        rarity: 'epic',
        cost: 220,
        kind: 'stat',
        stat: 'critChance',
        value: 12
    }
};


const CONSUMABLE_TYPES = ['potion', 'antidote', 'smokeBomb', 'rageDraught', 'identifyScroll', 'captureCage'];


// First-time contextual hints — fire once ever (tracked in gameMeta.hintsSeen),
// the first time a player meets a mechanic that is not self-explanatory. A
// single short Chronicle line, not a modal. Teaches the one thing a new player
// cannot infer from the event itself, then gets out of the way. Firing logic
// lives in showFirstTimeHint() in ui.js.
const FIRST_TIME_HINTS = {
    tavernTour: '\u{1F4A1} Tavern guide: \u2605 Innkeeper (rest/upgrades) \u2605 Merchant (buy gear) \u2605 Blacksmith (upgrade items) \u2605 Trainer (permanent stats) \u2605 Bank (save gold between deaths). The glowing circles show you where they are.',
    trap: '\u{1F4A1} Tip: Traps stay hidden until sprung, then reveal permanently. Some classes can sense or ignore them — watch the floor on repeat visits.',
    relic: '\u{1F4A1} Tip: Relics are powerful passive items with their own 5 slots, separate from gear. Open the Relics tab to attune them.',
    cursed: '\u{1F4A1} Tip: Unidentified items may be cursed — cursed gear cannot be removed mid-fight. Use an Identify Scroll, or visit the Magic Dealer to reveal or purify it.',
    arena: '\u{1F4A1} Tip: The Pit is open in the tavern courtyard. Weaken an enemy below 30% HP, capture it with a Capture Net (key 6), then fight it in the Arena for gold and fame.',
    lowHp: '\u{1F4A1} Tip: HP does not regenerate on its own. Press 1 to drink a Health Potion — buy more from the Merchant before you descend.',
    postDeath: '\u{1F4A1} After death: your gold is gone, but Bank gold, Arena fame, Tavern Renown, and the Shared Stash all carry forward. Deposit gold in the Bank before descending.',
};


// Innkeeper greeting lines keyed by the player's current Arena fame tier
// (see ARENA_FAME_TIERS in arena.js). The innkeeper is the social hub of the
// tavern, so he's the natural voice for reputation — his tone shifts from
// dismissive to reverent as the player climbs the Pit's ranks. Shown in his
// panel's subtitle slot (see renderInnkeeper). Falls back to the default
// subtitle when the arena isn't unlocked yet.
const INNKEEPER_FAME_LINES = {
    Unknown:    '"Another fighter for the Pit? They all say that." He barely looks up.',
    Challenger: '"Heard you stepped into the Pit. Didn\'t embarrass yourself, they say."',
    Contender:  '"The regulars are starting to learn your name. That\'s rare."',
    Gladiator:  '"They cheer when you walk in now. I had to add a second cask for the crowds you bring."',
    Champion:   '"Champion of the Pit drinks in MY tavern," he says, beaming. "Business has never been better."',
    Warlord:    '"The bookmakers argue over you before every bout. Nobody can agree on the odds anymore."',
    Legend:     'The innkeeper goes quiet as you approach, then bows his head. "A living legend, under my roof. The next round is on the house. Every round is."',
    Undying:    'The innkeeper simply stares. Then, slowly: "I\'ve been running this tavern thirty years. I never thought I\'d see someone like you."',
};

// ── Tavern Reputation: how the room reacts when you walk in ────────────────────
// Keyed by Pit title. The line is shown on tavern entry, scaling the crowd's
// reaction to your fame. Below 'Challenger' the room ignores you.
const TAVERN_ENTRY_REACTIONS = {
    Unknown:    null, // nobody notices — no message
    Challenger: 'A couple of patrons glance up as you enter, then return to their drinks.',
    Contender:  'Heads turn as you step inside. Someone murmurs your name to the person beside them.',
    Gladiator:  'A ripple of recognition moves through the room. A few mugs are raised in your direction.',
    Champion:   'The tavern erupts as you enter — cheers, stamping boots, a spilled tankard or two.',
    Warlord:    'The room rises as one. Bettors press toward you, shouting odds for your next bout.',
    Legend:     'Silence falls, then thunder. Every soul in the Flagon is on their feet, roaring your name.',
    Undying:    'The crowd does not cheer. They stare in something like awe, as if unsure you are real.',
};

// ── Random Patrons ────────────────────────────────────────────────────────────
// Ambient overheard dialogue, shown occasionally on tavern entry. Pure
// atmosphere — each is a named patron archetype muttering a line. {floor}
// templates to the player's best floor for a touch of personalization.
const TAVERN_PATRONS = [
    { who: 'A drunk miner', line: '"Floor 12? That\'s where my brother went down. Never came back up."' },
    { who: 'A retired knight', line: '"I fought in the Pit once. Once was enough. Look at my hands — they still shake."' },
    { who: 'A treasure hunter', line: '"They say the deeper floors hide relics worth a kingdom. They also say nobody\'s seen them and lived."' },
    { who: 'A hooded scholar', line: '"The ash-curse isn\'t random, you know. Something down there is making more of them."' },
    { who: 'A nervous merchant', line: '"You\'re going back down? After what happened on Floor {floor}? Braver than me."' },
    { who: 'An old bard', line: '"I\'ve a song half-written about a fighter like you. Don\'t die before the second verse, eh?"' },
    { who: 'A one-eyed gambler', line: '"I had good coin on you last bout. Don\'t make me regret the next one."' },
    { who: 'A tavern regular', line: '"Best floor of {floor}, they say. The Pit Master\'s started watching your runs."' },
    { who: 'A weary healer', line: '"Bring me back alive and I\'ll patch you for free. That\'s the deal. Stay alive."' },
    { who: 'A wide-eyed squire', line: '"Is it true? Did you really make it to Floor {floor}? They\'ll never believe me back home."' },
];

// ── Earned Titles ─────────────────────────────────────────────────────────────
// Honorifics earned through play, displayed in the Trophy Hall. These COMPLEMENT
// the Pit fame titles (Challenger…Undying) rather than replace them — the Pit
// title is your live rank; these are permanent badges of deeds done. Each has a
// predicate evaluated against gameState/gameMeta at render time.
const EARNED_TITLES = [
    { id: 'firstBlood',   name: 'First Blood',        desc: 'Slay your first enemy.',
      test: () => ((gameMeta.stats && gameMeta.stats.totalKills) || 0) >= 1 },
    { id: 'delver',       name: 'The Delver',         desc: 'Reach Floor 10.',
      test: () => (gameState.bestFloor || 0) >= 10 },
    { id: 'deepDweller',  name: 'Deep Dweller',       desc: 'Reach Floor 25.',
      test: () => (gameState.bestFloor || 0) >= 25 },
    { id: 'abyssWalker',  name: 'Abyss Walker',       desc: 'Reach Floor 50.',
      test: () => (gameState.bestFloor || 0) >= 50 },
    { id: 'conqueror',    name: 'Conqueror of Ash',   desc: 'Reach Floor 100 — face The Fallen God.',
      test: () => (gameState.bestFloor || 0) >= 100 },
    { id: 'bossbane',     name: 'Bossbane',           desc: 'Slay 10 bosses.',
      test: () => (gameMeta.bossesSlain || 0) >= 10 },
    { id: 'pitFighter',   name: 'Pit Fighter',        desc: 'Win 10 Pit bouts.',
      test: () => (gameMeta.pitWins || 0) >= 10 },
    { id: 'crowdFavorite',name: 'Crowd Favorite',     desc: 'Win 50 Pit bouts.',
      test: () => (gameMeta.pitWins || 0) >= 50 },
    { id: 'nemesisSlayer',name: 'Nemesis Slayer',     desc: 'Hold a winning record against every champion you have fought (min. 1 fight each).',
      test: () => {
          const r = gameMeta.rivals || {};
          const ids = Object.keys(r);
          if (!ids.length) return false;
          return ids.every(id => (r[id].wins || 0) > (r[id].losses || 0));
      } },
    { id: 'goldBaron',    name: 'Gold Baron',         desc: 'Earn 50,000 gold across all runs.',
      test: () => (gameMeta.totalGold || 0) >= 50000 },
    { id: 'survivor',     name: 'The Survivor',       desc: 'Complete 25 runs.',
      test: () => (gameMeta.runs || 0) >= 25 },
];

// Returns { earned: [...], locked: [...] } evaluating every title's predicate.
function getEarnedTitles() {
    const earned = [], locked = [];
    for (const t of EARNED_TITLES) {
        let ok = false;
        try { ok = !!t.test(); } catch (_) { ok = false; }
        (ok ? earned : locked).push(t);
    }
    return { earned, locked };
}


// ── Dungeon Regions (World Map B2 — regional theming) ──────────────────────────
// The dungeon's 100 floors are divided into four named depth bands. Each region
// has its own identity: a name, a color/flavor for the transition banner, a
// WEIGHTED enemy pool (drawn entirely from the existing ENEMY_TYPES roster — no
// new enemies), and a loot-rarity nudge. This makes the descent feel like a
// journey through distinct places without adding a navigation layer or new
// content. Floors still gate enemies by the original chooseEnemyType ladder;
// regions reweight WHICH of the floor-eligible types show up so each band has a
// recognizable character.
//
// weights: relative spawn weights. A type only appears if it's also unlocked by
// the floor (see chooseEnemyType), so listing a deep type in an early region is
// harmless — it simply won't spawn until its floor.
const DUNGEON_REGIONS = [
    {
        id: 'crypt', name: 'The Ashen Crypt', floors: [1, 25],
        color: '#9b8c6a',
        flavor: 'Crumbling tombs choked with ash. The dead do not rest here.',
        weights: { goblin: 3, slime: 3, skeleton: 4, archer: 2, brute: 2, bat: 2, spider: 2, cultist: 1, thief: 1 },
        lootBonus: 0.00,
    },
    {
        id: 'mines', name: 'The Forgotten Mines', floors: [26, 50],
        color: '#c98b4a',
        flavor: 'Collapsed shafts and veins of cursed ore. Something still digs.',
        weights: { brute: 3, imp: 3, ratman: 3, ghoul: 3, lizardman: 2, orc: 3, necromancer: 1, warden: 2 },
        lootBonus: 0.04,
    },
    {
        id: 'cathedral', name: 'The Sunken Cathedral', floors: [51, 75],
        color: '#5fa8c9',
        flavor: 'Drowned naves and broken altars. Faith curdled into something else.',
        weights: { ghoul: 3, necromancer: 3, darkknight: 3, cultist: 3, warden: 3, demon: 2, lizardman: 2 },
        lootBonus: 0.08,
    },
    {
        id: 'peaks', name: 'The Frost Peaks', floors: [76, 100],
        color: '#a9c7e0',
        flavor: 'A frozen summit above the ash. The air itself wants you dead.',
        weights: { demon: 4, darkknight: 3, orc: 3, warden: 3, ghoul: 2, necromancer: 2 },
        lootBonus: 0.12,
    },
];

// The region a given floor belongs to (falls back to the first/last band for
// floors outside the defined ranges, so this never returns null).
function getRegionForFloor(floor) {
    for (const r of DUNGEON_REGIONS) {
        if (floor >= r.floors[0] && floor <= r.floors[1]) return r;
    }
    return floor < DUNGEON_REGIONS[0].floors[0]
        ? DUNGEON_REGIONS[0]
        : DUNGEON_REGIONS[DUNGEON_REGIONS.length - 1];
}







// Legendary guest NPCs — each appears in the tavern permanently after the
// corresponding milestone boss is defeated. Position, reward, and one-time
// tracking key are all here so render.js and tavern.js can stay data-driven.
// reward types: 'gold' | 'item' | 'relic'
const MILESTONE_GUESTS = [
    {
        floor: 10, name: 'The Chronicler', x: 3, y: 10, color: '#d4b97a', glyph: '\u2A73',
        visitedKey: 'guestChroniclerVisited',
        greeting: '"I collect tales," the Chronicler says, pressing coins into your hand. "Yours is worth keeping."',
        revisit: '"More chapters to write, I see," the Chronicler murmurs, turning a page.',
        reward: { type: 'gold', amount: 60 },
    },
    {
        floor: 25, name: 'The Survivor', x: 3, y: 9, color: '#78bfff', glyph: '\u2605',
        visitedKey: 'guestSurvivorVisited',
        greeting: '"Dragon-slayer," she says quietly. "I tried once. Didn\'t walk away. Here — these helped me get close." She presses two scrolls into your hand.',
        revisit: '"You actually walked out of there. Still can\'t quite believe it."',
        reward: { type: 'item', itemType: 'identifyScroll', qty: 2 },
    },
    {
        floor: 50, name: 'The Pale Witness', x: 2, y: 10, color: '#b06fff', glyph: '\u2020',
        visitedKey: 'guestWitnessVisited',
        greeting: '"The Lich Lord\'s sanctum smells of centuries," he murmurs. "I was there once. I don\'t remember leaving. Drink deep — you\'ve earned it." Three potions appear on the table.',
        revisit: '"Still breathing. Still remarkable."',
        reward: { type: 'item', itemType: 'potion', qty: 3 },
    },
    {
        floor: 75, name: 'The Ash Knight', x: 3, y: 11, color: '#ff9f58', glyph: '\u2694',
        visitedKey: 'guestKnightVisited',
        greeting: '"The Demon Prince claimed dominion over ash," she says, setting a relic on the table. "He was wrong. You proved it. Take this — it belonged to his last victim."',
        revisit: '"Even the Demon Prince\'s ash settles eventually. As do we all."',
        reward: { type: 'relic' },
    },
    {
        floor: 100, name: 'The Legend', x: 4, y: 9, color: '#ffd65a', glyph: '\u2726',
        visitedKey: 'guestLegendVisited',
        greeting: '"The Fallen God is dead," the stranger says simply, placing a heavy purse on the table. "I didn\'t think that was possible. Neither did anyone else here. Neither did you, if you\'re honest."',
        revisit: '"Legend" is just a word. You know what you actually did down there.',
        reward: { type: 'gold', amount: 500 },
    },
];


// Ambient flavor lines for hub NPCs — fire once on rising-edge proximity
// (see triggerNpcProximityLine in ui.js). Each entry has a `tier` matching
// the number of milestone bosses defeated — tier 0 lines are always available,
// tier 1 unlocks after the Goblin King, tier 2 after the Bone Dragon, etc.
// This means the same NPCs feel like they're reacting to your progress without
// any new dialog boxes or cutscenes.
const NPC_AMBIENT_LINES = {
    innkeeper: [
        // Tier 0 — before any milestones
        { tier: 0, line: '"Back already?" the innkeeper mutters, not looking up.' },
        { tier: 0, line: 'The innkeeper wipes down a mug that was already clean.' },
        { tier: 0, line: '"Rooms are quiet tonight," he says. "Too quiet."' },
        { tier: 0, line: 'The innkeeper eyes your gear. "Spend it before the ash does."' },
        { tier: 0, line: '"Many come through here," he says. "Few come back twice."' },
        // Tier 1 — after Goblin King (floor 10)
        { tier: 1, line: '"Heard you took down the Goblin King," the innkeeper says. "Bought the next round for the whole bar."' },
        { tier: 1, line: 'The innkeeper glances at the trophy wall. "First skull up there. Took long enough."' },
        { tier: 1, line: '"Word travels," the innkeeper says. "The Goblin King\'s mob won\'t forget this. Neither will I."' },
        // Tier 2 — after Bone Dragon (floor 25)
        { tier: 2, line: '"Dragon-slayer," the innkeeper says, testing the word. "Thought I\'d never say that to a living customer."' },
        { tier: 2, line: 'The innkeeper pours without being asked. "On the house. Dragon fire doesn\'t wash out easy."' },
        { tier: 2, line: '"The Survivor won\'t stop talking about you," he mutters. "Buy her a drink and maybe she\'ll stop."' },
        // Tier 3 — after Lich Lord (floor 50)
        { tier: 3, line: '"Half the bar won\'t sleep anymore," the innkeeper says. "Something about a Lich. Can\'t imagine why."' },
        { tier: 3, line: 'The innkeeper lowers his voice. "The Pale Witness — that one arrived last night. Doesn\'t eat. Doesn\'t sleep. Just watches."' },
        { tier: 3, line: '"Fifty floors," he says. "I keep the tally. Fifty floors and you\'re still drinking at my bar."' },
        // Tier 4 — after Demon Prince (floor 75)
        { tier: 4, line: '"They\'re calling you the Demon-bane," the innkeeper says. "I told them you prefer ale."' },
        { tier: 4, line: 'The innkeeper studies the char marks on the wall. "Walked in smelling of hellfire. Par for the course these days."' },
        { tier: 4, line: '"The Ash Knight hasn\'t moved from that corner in two days," he mutters. "Waiting for you, I think."' },
        // Tier 5 — after Fallen God (floor 100)
        { tier: 5, line: '"The Fallen God is dead," the innkeeper says quietly. "I didn\'t think I\'d live to hear that sentence."' },
        { tier: 5, line: 'The innkeeper sets down the mug he was cleaning. "What do you even do after something like that?"' },
        { tier: 5, line: '"The stranger in the corner," the innkeeper says. "Calls himself The Legend. Won\'t leave. Says he\'s waiting to buy you a drink."' },
    ],
    merchant: [
        { tier: 0, line: '"Browsing, or buying?" the merchant asks, already counting your coin.' },
        { tier: 0, line: 'The merchant rearranges her wares without taking her eyes off you.' },
        { tier: 0, line: '"Everything has a price," she says. "Yours, too, eventually."' },
        { tier: 0, line: 'The merchant taps a trinket. "That one\'s seen things. Cheap, though."' },
        { tier: 0, line: '"Don\'t dawdle," she says. "The dungeon doesn\'t wait for shoppers."' },
        { tier: 1, line: '"Goblin King\'s treasury is unguarded now," the merchant observes. "Shame I can\'t reach it myself."' },
        { tier: 2, line: '"Dragon scales sell well," she says. "If you\'d brought any back, we could\'ve had a conversation."' },
        { tier: 3, line: '"Lich artifacts," the merchant says thoughtfully. "Hard to move. Everyone\'s afraid of them. I\'m not."' },
        { tier: 4, line: '"Hellfire-scorched goods are surprisingly popular," she admits. "Don\'t ask who\'s buying."' },
        { tier: 5, line: '"You know," the merchant says, "I\'ve been thinking about relocating. Somewhere the god isn\'t dead. Just kidding." She doesn\'t look like she\'s kidding.' },
    ],
    blacksmith: [
        { tier: 0, line: 'The blacksmith barely glances up from the forge.' },
        { tier: 0, line: '"Steel doesn\'t lie," he grunts. "Unlike most adventurers."' },
        { tier: 0, line: 'Sparks scatter as the blacksmith tests an edge against his thumb.' },
        { tier: 0, line: '"Bring me something worth fixing," he says, "and I\'ll fix it."' },
        { tier: 0, line: 'The blacksmith nods at your weapon. "Could be sharper. Most things could."' },
        { tier: 1, line: '"Goblin steel is garbage," the blacksmith says. "The King\'s crown, though — that had some weight to it."' },
        { tier: 2, line: '"Dragon bone makes good handles," the blacksmith mutters. "Hypothetically. I\'m not asking."' },
        { tier: 3, line: 'The blacksmith is quiet for a while. "Lich-touched metal doesn\'t hold an edge right. Just so you know."' },
        { tier: 4, line: '"Hellfire," he says, looking at the char mark on the wall. "I can work with that heat. Not saying I want to."' },
        { tier: 5, line: 'The blacksmith sets down his hammer. Just for a moment. Picks it back up. Says nothing. That\'s enough.' },
        // ── Class-aware ─────────────────────────────────────────────────────
        { tier: 0, cond: (gs) => gs.player?.className === 'Warrior',
          line: '"A Warrior," the blacksmith says approvingly. "You actually understand what I do here."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Rogue',
          line: '"Light armor," the blacksmith mutters, eyeing your kit. "Fast, sure. One good hit and — well. Not my problem."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Mage',
          line: 'The blacksmith glances at your robes. "No armor." He looks back at the forge. "Brave. Or stupid. Hard to tell."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Cleric',
          line: '"Divine steel," the blacksmith says. "Blessed by your order, I suppose. Still needs an edge."' },
        // ── Renown-aware ────────────────────────────────────────────────────
        { tier: 0, cond: (gs, gm) => (gm.tavernRenown || 0) >= 100,
          line: '"Word\'s getting around," the blacksmith says without looking up. "About you. Don\'t let it make you slow."' },
        { tier: 0, cond: (gs, gm) => (gm.tavernRenown || 0) >= 250,
          line: 'The blacksmith pauses his hammering. "I sharpened a blade for a legend once. Didn\'t end well for them. No offense."' },
        // ── Floor-aware ─────────────────────────────────────────────────────
        { tier: 0, cond: (gs) => (gs.bestFloor || 0) >= 20,
          line: '"Twenty floors," the blacksmith says. "Your gear\'s seen real use. Come back when something breaks."' },
    ],
    warden: [
        { tier: 0, line: '"I count who comes back," the Warden says. "I stopped counting who doesn\'t."' },
        { tier: 0, line: 'The Warden nods at the stairs. "The deeper you go, the quieter it gets. That\'s not a good sign."' },
        { tier: 0, line: '"You look tired," the Warden says. "The dungeon does that. Rest while you can."' },
        { tier: 0, line: '"They tell me to guard the entrance," the Warden mutters. "I think the entrance guards itself."' },
        { tier: 0, line: '"Nobody goes down there without a reason," the Warden says. "Most don\'t come back with a good one."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Warrior',
          line: '"A Warrior," the Warden says. "Good. The dungeon respects strength. Occasionally."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Rogue',
          line: '"A Rogue," the Warden says flatly. "I\'ll pretend I didn\'t notice the lockpick."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Mage',
          line: 'The Warden eyes your staff. "Last mage who went down there came back as a ghost. Different ghost, though."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Cleric',
          line: '"A Cleric," the Warden says. "The dungeon has had clergy before. They left quickly. Or not at all."' },
        { tier: 1, line: '"The Goblin King\'s dead," the Warden says. "The dungeon got quieter. Or angrier. Hard to say."' },
        { tier: 2, line: 'The Warden glances toward the deep stairs. "Bone Dragon\'s gone. Something else will fill that gap."' },
        { tier: 3, line: '"The Lich," the Warden says. "I\'ve guarded this post for twenty years. Never thought someone would manage that."' },
        { tier: 4, line: 'The Warden is quiet for a long moment. "Demon Prince. My predecessor died on that floor."' },
        { tier: 5, line: '"The Fallen God," the Warden says. Very slowly. "I\'m going to need a new job description."' },
        { tier: 0, cond: (gs) => (gs.bestFloor || 0) >= 30,
          line: '"Thirty floors," the Warden says. "Most guards have never even seen floor five. Walk tall."' },
        { tier: 0, cond: (gs) => (gs.bestFloor || 0) >= 60,
          line: 'The Warden straightens when you approach. "Sixty floors. I don\'t say this often: you\'ve earned the right to walk past me without explaining yourself."' },
    ],
    bard: [
        { tier: 0, line: '"Every adventurer\'s a new verse," the bard says, strumming absently.' },
        { tier: 0, line: '"I write what I see," the bard says. "Right now I see someone who\'s been somewhere interesting."' },
        { tier: 0, line: 'The bard taps the lute thoughtfully. "The dungeon has its own rhythm. You just have to survive long enough to hear it."' },
        { tier: 0, line: '"Songs are just memory that hums," the bard says. "What would you like remembered?"' },
        { tier: 0, line: 'The bard watches the dungeon stairs. "The best stories start with someone saying: I probably shouldn\'t do this."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Warrior',
          line: '"The Warrior\'s tale," the bard muses. "Straightforward. Heroic. The crowd always loves it." He pauses. "Simple."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Rogue',
          line: '"Rogues make the best protagonists," the bard says. "Morally complicated. Excellent dramatic irony."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Mage',
          line: '"Magic," the bard says with undisguised envy. "Every song I\'ve written about mages ends badly. I keep writing them anyway."' },
        { tier: 0, cond: (gs) => gs.player?.className === 'Cleric',
          line: '"A Cleric," the bard says. "Do you think the gods are listening right now?" He glances upward. "Asking for a song."' },
        { tier: 1, line: '"I\'m writing \'The Ballad of the Goblin King\'s Last Stand\'," the bard says. "You\'re in it. You come off well."' },
        { tier: 2, line: 'The bard\'s eyes light up. "A dragon! I\'ve been waiting my whole career for a dragon. Tell me everything."' },
        { tier: 3, line: '"The Lich," the bard breathes. "I\'ve tried to write that encounter three times. Each draft killed the ink."' },
        { tier: 4, line: 'The bard is quiet for a moment. "I had a whole demon ballad ready. Now I have to rewrite the ending."' },
        { tier: 5, line: '"The Fallen God," the bard says softly. "That\'s the end of the story. Except here you are. Still walking. That\'s the rarest verse of all."' },
        { tier: 0, cond: (gs, gm) => (gm.tavernRenown || 0) >= 75,
          line: '"People ask me to play your song," the bard says. "I\'ve had to invent one. Hope you don\'t mind."' },
        { tier: 0, cond: (gs, gm) => (gm.tavernRenown || 0) >= 200,
          line: '"Most legends die before becoming one," the bard says. "You seem to have skipped that part."' },
        { tier: 0, cond: (gs) => (gs.bestFloor || 0) >= 40,
          line: '"Forty floors," the bard says. "I\'m on chapter seven of your story. The pacing is extraordinary."' },
    ],
};


const QUEST_POOL = [
    {
        id: 'slay_skeletons',
        type: 'kill_count',
        targetType: 'skeleton',
        getAmount: lvl => 3 + lvl,
        getReward: n => n * 10,
        makeLabel: (n) => `Slay ${n} Skeleton${n > 1 ? 's' : ''}`,
        makeDesc:  (n, g) => `Hunt down ${n} skeleton${n > 1 ? 's' : ''} in the dungeon. Reward: ${g}g.`
    },
    {
        id: 'slay_slimes',
        type: 'kill_count',
        targetType: 'slime',
        getAmount: lvl => 3 + lvl,
        getReward: n => n * 9,
        makeLabel: (n) => `Clear ${n} Slime${n > 1 ? 's' : ''}`,
        makeDesc:  (n, g) => `Eliminate ${n} slime${n > 1 ? 's' : ''} before they spread. Reward: ${g}g.`
    },
    {
        id: 'slay_brutes',
        type: 'kill_count',
        targetType: 'brute',
        getAmount: lvl => 2 + Math.floor(lvl / 2),
        getReward: n => n * 18,
        makeLabel: (n) => `Fell ${n} Brute${n > 1 ? 's' : ''}`,
        makeDesc:  (n, g) => `Bring down ${n} brute${n > 1 ? 's' : ''} — they do not fall easy. Reward: ${g}g.`
    },
    {
        id: 'slay_archers',
        type: 'kill_count',
        targetType: 'archer',
        getAmount: lvl => 2 + lvl,
        getReward: n => n * 12,
        makeLabel: (n) => `Ground ${n} Archer${n > 1 ? 's' : ''}`,
        makeDesc:  (n, g) => `Silence ${n} archer${n > 1 ? 's' : ''} before they loose another bolt. Reward: ${g}g.`
    },
    {
        id: 'reach_floor',
        type: 'challenge_reach',
        targetType: 'floor',
        getAmount: lvl => Math.max(2, lvl + 1),
        getReward: n => n * 30,
        makeLabel: (n) => `Reach Floor ${n}`,
        makeDesc:  (n, g) => `Descend to floor ${n} and live to report it. Reward: ${g}g.`
    },
    {
        id: 'no_potion_run',
        type: 'no_potion_run',
        targetType: 'floor',
        getAmount: lvl => Math.max(2, lvl),
        getReward: n => n * 50,
        makeLabel: (n) => `Iron Belly: Floor ${n}`,
        makeDesc:  (n, g) => `Reach floor ${n} without drinking a single Health Potion. Reward: ${g}g.`
    },
    {
        id: 'slay_boss',
        type: 'kill_count',
        targetType: 'boss',
        getAmount: () => 1,
        getReward: () => 120,
        makeLabel: () => 'Slay a Boss',
        makeDesc:  (n, g) => `Face and defeat the floor boss. Reward: ${g}g.`
    }
];


// Frequencies: C4=261.63 D4=293.66 E4=329.63 F4=349.23 G4=392 A4=440 B4=493.88 C5=523.25
//              A3=220   B3=246.94 G3=196   E3=164.81 D3=146.83 F3=174.61
const SONG_TRACKS = [
    {
        id: 'descent',
        title: 'Echoes of the Deep',
        cost: 20,
        mood: 'Ominous · Minor · Slow',
        desc: '"Old Gregor played this the night before he never came back. Makes the hairs stand up."',
        lore: 'The bard leans close and whispers: "A traveller spoke of an iron colossus below — armored in shifting phases."',
        effect: { type: 'scout', stat: null, value: 0 },
        notes: [220, 196, 174.61, 196, 220, 164.81, 174.61, 0, 220, 246.94, 261.63, 0, 220, 0, 0, 0],
        tempo: 420,
        wave: 'sawtooth',
        vol: 0.065
    },
    {
        id: 'battle',
        title: 'Rally at the Gate',
        cost: 25,
        mood: 'Heroic · Major · Upbeat',
        desc: '"Gets the blood up. The barkeep swears his sales double whenever Finnick plays this."',
        lore: 'You feel battle-ready, your hands steadier on the hilt. (+5% critical hit chance for this run)',
        effect: { type: 'stat_boost', stat: 'critChance', value: 5 },
        notes: [261.63, 329.63, 392, 329.63, 261.63, 392, 523.25, 392, 329.63, 261.63, 246.94, 261.63, 0, 0, 0, 0],
        tempo: 195,
        wave: 'square',
        vol: 0.055
    },
    {
        id: 'requiem',
        title: 'Lament of the Broken',
        cost: 30,
        mood: 'Mournful · Minor · Slow',
        desc: '"Written for those who go down and do not come back. Beautiful. And sad."',
        lore: 'The melody mends something in you. You feel heartier on each new floor. (+5 HP on descent)',
        effect: { type: 'stat_boost', stat: 'descentHeal', value: 5 },
        notes: [329.63, 293.66, 261.63, 246.94, 261.63, 293.66, 329.63, 0, 293.66, 261.63, 246.94, 196, 0, 0, 0, 0],
        tempo: 470,
        wave: 'sine',
        vol: 0.065
    },
    {
        id: 'gold',
        title: 'Coin & Cobblestone',
        cost: 15,
        mood: 'Jolly · Major · Fast',
        desc: '"The merchant hums this when counting profits. Says it makes the coin feel lighter."',
        lore: 'Your eyes sharpen for glinting metal in the dark. (+10% gold find for this run)',
        effect: { type: 'stat_boost', stat: 'goldFind', value: 10 },
        notes: [392, 440, 392, 349.23, 392, 0, 329.63, 349.23, 329.63, 293.66, 329.63, 0, 261.63, 293.66, 329.63, 392],
        tempo: 145,
        wave: 'triangle',
        vol: 0.055
    }
];


// Chance the Cellar actually has something this run — checked once,
// either at initGame() (fresh run) or loadActiveRun() (resumed run
// missing this field from an older save), not guaranteed every time
// per the design intent of a genuine rare find rather than a
// guaranteed daily-shop-style restock.
const CELLAR_FIND_CHANCE = 0.6;

// Each option is consumed immediately on pickup — no duration, no
// remove() — distinct from BREW_MENU's multi-floor buffs above.
// Adrenaline Rush is the one exception with an expiry: it's tracked
// via player.cellarRushFloor (set to the floor it was granted on) and
// cleared in resetPerFloorSubclassState() the moment the floor
// actually changes, rather than a floors-remaining counter, since
// "lasts until you leave this floor" doesn't fit a countdown as
// naturally as the brews above do.
const CELLAR_FIND_CHOICES = [
    {
        id: 'restoration',
        icon: '✦',
        label: 'Full Restoration',
        desc: 'Fully heal and cleanse every negative effect.',
        apply(p) {
            p.hp = p.maxHp;
            if (p.maxMana > 0) p.mana = p.maxMana;
            p.statuses = p.statuses.filter(s => s.type === 'rage'); // keep beneficial statuses, strip the rest
        }
    },
    {
        id: 'insight',
        icon: '◆',
        label: 'Sudden Insight',
        desc: 'Instantly gain enough experience to level up.',
        apply(p) { p.gainXp(getXpToLevel()); }
    },
    {
        id: 'treasure',
        icon: '⛁',
        label: 'Buried Treasure',
        desc: 'A gold windfall, larger the deeper you\u2019ve gone.',
        apply(p) {
            const amount = 60 + gameState.floor * 8;
            p.gold += amount;
            addFloatingText(p.x, p.y, `+${amount}g`, '#ffd65a');
        }
    },
    {
        id: 'adrenaline',
        icon: '⚡',
        label: 'Adrenaline Rush',
        desc: 'Greatly boosted ATK and DEF until you leave this floor.',
        apply(p) {
            p.cellarRushFloor = gameState.floor;
            p.baseAtk += 8;
            p.baseDef += 5;
            recalculateStats();
        }
    },
];


const BREW_MENU = [
    {
        id: 'darkStout',
        name: "Flagon's Dark Stout",
        icon: '🍺',
        cost: 30,
        desc: '+15 Max HP, but −2 ATK and −1 DEF while the brew lasts.',
        duration: 3,
        apply(p) { p.maxHp += 15; p.hp = Math.min(p.hp + 15, p.maxHp); p.baseAtk -= 2; p.baseDef -= 1; },
        remove(p) { p.maxHp -= 15; p.hp = Math.min(p.hp, p.maxHp); p.baseAtk += 2; p.baseDef += 1; }
    },
    {
        id: 'ghostPepperStew',
        name: 'Ghost Pepper Stew',
        icon: '🌶',
        cost: 40,
        desc: 'Enemies that hit you take 4 reflected damage (thorns) for 4 floors.',
        duration: 4,
        apply(p) { p._brewThorns = 4; },
        remove(p) { p._brewThorns = 0; }
    },
    {
        id: 'starlightMead',
        name: 'Starlight Mead',
        icon: '✦',
        cost: 35,
        desc: '+2 mana regenerated each turn for 5 floors.',
        duration: 5,
        apply(p) { p._brewManaRegen = 2; },
        remove(p) { p._brewManaRegen = 0; }
    }
];


const CLASS_META = {
    warrior: { name: 'Warrior',  desc: 'High HP & Defense\nShield Block ability' },
    rogue:   { name: 'Rogue',    desc: 'High Crit & Speed\nBackstab ability' },
    mage:    { name: 'Mage',     desc: 'Ranged Magic\nFireball spell' },
    cleric:  { name: 'Cleric',   desc: 'Balanced Stats\nHeal spell' }
};


// Painted badge artwork shown in the class cards and their expanded
// content.
// Class-select emblem crests (ornate weapon-sigils, one per class, tinted in
// the class color). Distinct from the in-game character sprites below — these
// only back the <img> tags on the champion-select screen.
const CLASS_ICON_IMG = { warrior: 'warrior-icon.png', rogue: 'rogue-icon.png', mage: 'mage-icon.png', cleric: 'cleric-icon.png' };


// In-game canvas sprites for the player token (separate from
// CLASS_ICON_IMG above, which only backs the plain <img> tags on the
// class-select screen). Larger source art, drawn via ctx.drawImage() in
// drawPlayer() instead of canvas shapes.
const CLASS_SPRITE_SRC = {
    warrior: 'sprites/warrior.png',
    rogue: 'sprites/rogue.png',
    mage: 'sprites/mage.png',
    cleric: 'sprites/cleric.png',
};

// Preloaded once at module init, fire-and-forget. Each entry starts as
// just an Image() with .complete === false; drawPlayer() checks
// .complete (and that it didn't error) every frame before drawing it,
// falling back to the original flat-circle rendering otherwise — so a
// slow connection or a missing/corrupt file never blocks gameplay or
// shows a broken-image icon, it just quietly keeps the old look until
// (unless) the sprite becomes available.
const CLASS_SPRITES = {};
for (const [cls, src] of Object.entries(CLASS_SPRITE_SRC)) {
    const img = new Image();
    img.src = src;
    img._loadFailed = false;
    img.onerror = () => { img._loadFailed = true; };
    CLASS_SPRITES[cls] = img;
}

function getClassSprite(className) {
    const img = CLASS_SPRITES[className];
    if (!img || img._loadFailed || !img.complete || img.naturalWidth === 0) return null;
    return img;
}


// Tavern NPC sprites — same preload/fallback contract as the player
// class sprites above. Keyed by the same names used for gameState's NPC
// objects (innkeeper, blacksmith, trainer, bank, merchant) so callers in
// render.js can look one up directly from the NPC they're already
// drawing, without a separate name-mapping table.
const NPC_SPRITE_SRC = {
    innkeeper:   'sprites/innkeeper.png',
    blacksmith:  'sprites/blacksmith.png',
    trainer:     'sprites/trainer.png',
    bank:        'sprites/bank.png',
    merchant:    'sprites/merchant.png',
    // Back-room NPCs — sprites slot in automatically once the files exist
    gambler:     'sprites/gambler.png',
    brewmaster:  'sprites/brewmaster.png',
    bard:        'sprites/bard.png',
    magicdealer: 'sprites/magicdealer.png',
};

const NPC_SPRITES = {};
for (const [key, src] of Object.entries(NPC_SPRITE_SRC)) {
    const img = new Image();
    img.src = src;
    img._loadFailed = false;
    img.onerror = () => { img._loadFailed = true; };
    NPC_SPRITES[key] = img;
}

function getNpcSprite(npcKey) {
    const img = NPC_SPRITES[npcKey];
    if (!img || img._loadFailed || !img.complete || img.naturalWidth === 0) return null;
    return img;
}


// Records a fallen hero to the persistent graveyard shown on the title screen.
// killedBy is a short string describing the cause ("Goblin on Floor 3", etc.).
function recordFallen(player, floor, killedBy) {
    if (!player || !player.name) return;
    if (!gameMeta.fallen) gameMeta.fallen = [];
    gameMeta.fallen.unshift({
        name: player.name,
        className: player.className || 'warrior',
        subclass: player.subclass || '',
        level: player.level || 1,
        floor: floor || 0,
        killedBy: killedBy || 'the dungeon',
        ts: Date.now(),
    });
    // Keep only the 8 most recent — the graveyard is a memorial, not a
    // spreadsheet. The most dramatic recent deaths are the most resonant.
    gameMeta.fallen = gameMeta.fallen.slice(0, 8);
    saveMetaProgress();
}
// Renown is earned from everything the player does — floors reached, bosses
// killed, arena wins, dailies played. It gates a track of 15 unlocks that
// progressively make the Broken Flagon feel more alive: ambient ones (new
// patrons, dialogue, visual details) at low cost, structural ones (extra
// merchant slots, harder bounties, new brews, higher bank cap, the champion
// title) at the gates that represent real investment.

// ── Dungeon Events ─────────────────────────────────────────────────────────────
// A random modifier drawn at run-start that colours the whole descent. Events
// skew the spawn pool (weighted pushes, not exclusions) and add a loot bias.
// They make successive runs feel different without requiring new content.
const DUNGEON_EVENTS = [
    { id: 'none',                 name: null,                  weight: 8,  color: null,      icon: null, desc: null, spawnBoost: {}, lootBias: null },
    { id: 'goblin_migration',     name: 'Goblin Migration',    weight: 3,  color: '#d32f2f', icon: 'G',
      desc: 'The tunnels swarm with goblins driven up from below. More of them, hungrier — but they carry extra coin.',
      spawnBoost: { goblin: 3 }, lootBias: 'gold' },
    { id: 'necromancer_activity', name: 'Necromancer Activity',weight: 2,  color: '#8c5cc0', icon: 'N',
      desc: 'A necromancer\'s ritual has stirred the dead. Undead are more common, and their remains carry strange power.',
      spawnBoost: { skeleton: 3, necromancer: 2 }, lootBias: 'scroll' },
    { id: 'spider_infestation',   name: 'Spider Infestation',  weight: 2,  color: '#7a6a55', icon: 'X',
      desc: 'The walls are webbed. Spiders have claimed the upper floors. Their venom stacks fast in numbers.',
      spawnBoost: { spider: 4, bat: 2 }, lootBias: 'potion' },
    { id: 'cultist_uprising',     name: 'Cultist Uprising',    weight: 2,  color: '#b06fff', icon: 'C',
      desc: 'A dark cult has mobilised. Cultists rally their allies to dangerous effect. Silence the chanters first.',
      spawnBoost: { cultist: 4, warden: 2 }, lootBias: 'relic' },
    { id: 'ash_storm',            name: 'Ash Storm',           weight: 2,  color: '#aaa397', icon: '\u2726',
      desc: 'A storm of ash fills the dungeon. All enemies hit harder. But the storm scatters rare treasure across the floors.',
      spawnBoost: { brute: 2, warden: 2 }, lootBias: 'rare', globalModifier: { enemyHpMult: 1.15 } },
    { id: 'blessed_week',         name: 'Blessed Week',        weight: 2,  color: '#ffd65a', icon: '\u2605',
      desc: 'An ancient blessing lingers in the stone. Enemies are normal — but treasure is more plentiful.',
      spawnBoost: {}, lootBias: 'all', globalModifier: { lootMult: 1.3 } },
];

function pickDungeonEvent() {
    const totalWeight = DUNGEON_EVENTS.reduce((s, e) => s + e.weight, 0);
    // Must use the seeded rng(), not Math.random(): the chosen event applies
    // real gameplay modifiers (enemyHpMult, lootMult, spawn/loot bias), so the
    // same seed code must reproduce the same event for the "share a seed" /
    // daily-challenge promise to hold.
    let roll = rng() * totalWeight;
    for (const ev of DUNGEON_EVENTS) {
        roll -= ev.weight;
        if (roll <= 0) return ev.id === 'none' ? null : ev;
    }
    return null;
}

function getDungeonEvent() {
    if (!gameState.dungeonEvent) return null;
    return DUNGEON_EVENTS.find(e => e.id === gameState.dungeonEvent) || null;
}


const RENOWN_MILESTONES = [
    { renown: 10,  type: 'ambient',    id: 'namedGreeting',   label: 'Known Face',           desc: 'The innkeeper remembers your name.' },
    { renown: 25,  type: 'ambient',    id: 'patronWarrior',   label: 'A Regular Appears',    desc: 'An old warrior takes a seat by the fire every night.' },
    { renown: 40,  type: 'ambient',    id: 'bardDeedsLines',  label: 'Your Legend Spreads',  desc: 'The bard starts singing songs about your deeds.' },
    { renown: 50,  type: 'structural', id: 'merchantSlot',    label: 'Trusted Customer',     desc: 'The merchant stocks one extra item for you.' },
    { renown: 75,  type: 'ambient',    id: 'patronScholar',   label: 'A Scholar Arrives',    desc: 'A nervous scholar appears, mapping the ash.' },
    { renown: 100, type: 'structural', id: 'harderBounties',  label: 'Real Work',            desc: 'The notice board posts harder jobs with bigger rewards.' },
    { renown: 125, type: 'ambient',    id: 'portraitFrame',   label: 'Portrait on the Wall', desc: 'A small painted frame appears near the Trophy Hall.' },
    { renown: 150, type: 'ambient',    id: 'brewmasterDial',  label: 'Brewer\'s Secret',     desc: 'The brewmaster reveals a new brew in his rotation.' },
    { renown: 200, type: 'structural', id: 'brewExtraSlot',   label: 'Favourite Customer',   desc: 'The brewmaster offers one additional brew slot.' },
    { renown: 250, type: 'ambient',    id: 'patronFighter',   label: 'A Fighter Watches',    desc: 'A retired Pit fighter takes a table — and gives you tips.' },
    { renown: 300, type: 'ambient',    id: 'bardNamedSongs',  label: 'Songs in Your Name',   desc: 'The bard\'s songs now name you and your real deeds.' },
    { renown: 350, type: 'structural', id: 'bankCapUp',       label: 'Vault Expansion',      desc: 'The bank can hold 200 more gold between your runs.' },
    { renown: 400, type: 'ambient',    id: 'goldenBanners',   label: 'Golden Banners',       desc: 'Golden banners are hung on the tavern walls in your honor.' },
    { renown: 450, type: 'ambient',    id: 'guestsConverse',  label: 'A Living Tavern',      desc: 'The legendary guests begin talking to each other.' },
    { renown: 500, type: 'structural', id: 'champion',        label: 'Champion of the Flagon', desc: 'The innkeeper pours you a free drink at the start of every run (+5 HP).' },
];

// True if a given milestone is currently unlocked.
function isRenownUnlocked(id) {
    const m = RENOWN_MILESTONES.find(m => m.id === id);
    return !!m && (gameMeta.tavernRenown || 0) >= m.renown;
}

// The highest milestone currently reached.
function getHighestRenownMilestone() {
    const r = gameMeta.tavernRenown || 0;
    const passed = RENOWN_MILESTONES.filter(m => r >= m.renown);
    return passed.length ? passed[passed.length - 1] : null;
}

// The next milestone the player hasn't yet reached.
function getNextRenownMilestone() {
    const r = gameMeta.tavernRenown || 0;
    return RENOWN_MILESTONES.find(m => r < m.renown) || null;
}

// Award renown and notify the player if a milestone was just crossed.
// reason is a short string for the message ("floors descended", etc.).
function earnRenown(amount, reason) {
    if (amount <= 0) return;
    const before = gameMeta.tavernRenown || 0;
    gameMeta.tavernRenown = before + amount;
    // Check for newly crossed milestones and announce them
    const crossed = RENOWN_MILESTONES.filter(m => before < m.renown && gameMeta.tavernRenown >= m.renown);
    crossed.forEach(m => {
        addMessage(`✦ Tavern Renown: ${m.label} unlocked — ${m.desc}`);
    });
    saveMetaProgress();
}

// Fortune Wheel segments — the player's wager is multiplied by the landed value.
// Weights favour house edge while still offering real upside for big spins.
// Fortune Wheel segments — BUST (0×) means the full wager is lost, so real
// risk exists on every spin. Weights tuned so bust hits ~24% of spins, the
// rest of the distribution still has genuine upside (including a rare 10×).
const WHEEL_SEGMENTS = [
    { label: 'BUST', mult: 0,    color: '#6b0c0c', weight: 4 }, // lose all
    { label: 'BUST', mult: 0,    color: '#8b1a1a', weight: 3 }, // lose all
    { label: '½×',  mult: 0.5,  color: '#c0392b', weight: 3 }, // lose half
    { label: '1×',  mult: 1.0,  color: '#5a5a5a', weight: 3 }, // break even
    { label: '2×',  mult: 2.0,  color: '#27ae60', weight: 4 }, // double
    { label: '3×',  mult: 3.0,  color: '#2980b9', weight: 2 }, // triple
    { label: '5×',  mult: 5.0,  color: '#8e44ad', weight: 2 }, // big win
    { label: '10×', mult: 10.0, color: '#f39c12', weight: 1 }, // jackpot
];

// The jackpot grows 25g per day it goes unclaimed, minimum 50g, maximum 500g.
function getCasinoJackpot() {
    return Math.min(500, Math.max(50, gameMeta.casinoJackpot || 50));
}

// True if the player hasn't claimed today's jackpot yet.
function canClaimJackpot() {
    const today = getDailyKey();
    return gameMeta.casinoJackpotLastClaimed !== today;
}

// Called each time the casino lobby opens — bumps the jackpot if a new day
// has passed since it was last claimed or bumped.
function tickCasinoJackpot() {
    const today = getDailyKey();
    if (!gameMeta.casinoJackpotLastBumped) gameMeta.casinoJackpotLastBumped = today;
    if (gameMeta.casinoJackpotLastBumped !== today) {
        gameMeta.casinoJackpot = Math.min(500, (gameMeta.casinoJackpot || 50) + 25);
        gameMeta.casinoJackpotLastBumped = today;
        saveMetaProgress();
    }
}

// Claims the jackpot — awards gold, resets pot to 50g.
function claimJackpot(player) {
    const prize = getCasinoJackpot();
    player.gold += prize;
    gameMeta.casinoJackpotLastClaimed = getDailyKey();
    gameMeta.casinoJackpot = 50;
    gameMeta.casinoJackpotLastBumped = getDailyKey();
    saveMetaProgress();
    return prize;
}

// Seeded spin result for the Fortune Wheel — uses the game's RNG (which is
// seeded, so the outcome is locked in when the player commits their wager,
// not after they see the animation). Returns the segment index.
function spinWheel() {
    const totalWeight = WHEEL_SEGMENTS.reduce((s, seg) => s + seg.weight, 0);
    let pick = rng() * totalWeight;
    for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
        pick -= WHEEL_SEGMENTS[i].weight;
        if (pick <= 0) return i;
    }
    return WHEEL_SEGMENTS.length - 1;
}
// One source of truth for navigation aids: the gameState key for each tavern
// point of interest, the action verb, a short label, and a marker color. Drives
// both the glowing floor markers under NPCs and the "[Space] <verb> <label>"
// prompt that appears when the player stands next to one. Order is the on-screen
// reading order; arenaGate is handled separately (courtyard-gated).
// Tavern interior social NPCs — checked for adjacency/floor-markers
// when gameState.inCourtyard is false.
const TAVERN_INTERACTABLES = [
    { key: 'innkeeper',  verb: 'Rest at',    label: 'Innkeeper',    color: '#ffd65a' },
    { key: 'gambler',    verb: 'Play at',    label: 'Dice Table',   color: '#ff9f58' },
    { key: 'brewmaster', verb: 'Visit',      label: 'Brewmaster',   color: '#c98bff' },
    { key: 'bard',       verb: 'Hear the',   label: 'Bard',         color: '#62b9ff' },
    { key: 'stashChest', verb: 'Open the',   label: 'Shared Stash', color: '#d4b97a' },
    { key: 'cellar',     verb: 'Search the', label: 'Cellar',       color: '#8a6f4e' },
];

// Market commerce NPCs — checked for adjacency/floor-markers when
// gameState.inCourtyard is true. Positions are courtyard-grid coordinates.
const MARKET_INTERACTABLES = [
    { key: 'merchant',    verb: 'Trade with', label: 'Merchant',     color: '#5ad1c2' },
    { key: 'blacksmith',  verb: 'Visit',      label: 'Blacksmith',   color: '#c45c00' },
    { key: 'trainer',     verb: 'Train with', label: 'Trainer',      color: '#58c26d' },
    { key: 'bank',        verb: 'Use the',    label: 'Bank',         color: '#ffd65a' },
    { key: 'questBoard',  verb: 'Read the',   label: 'Quest Board',  color: '#d4b97a' },
    { key: 'magicDealer', verb: 'Visit',      label: 'Magic Dealer', color: '#9c6dff' },
];

// Returns the interactable the player is currently adjacent to (Chebyshev ≤ 1),
// or null. Courtyard handles only the arena gate (see interactInTavern).
function getAdjacentInteractable() {
    const p = gameState.player;
    if (!p || gameState.floor !== 0) return null;
    if (gameState.inCourtyard) {
        // Check Pit gate first (highest priority)
        const g = gameState.arenaGate;
        if (g && Math.max(Math.abs(p.x - g.x), Math.abs(p.y - g.y)) <= 1) {
            return { npc: g, verb: 'Enter', label: 'The Pit', color: '#ff9f58' };
        }
        // Check Market vendor NPCs
        for (const def of MARKET_INTERACTABLES) {
            const npc = gameState[def.key];
            if (npc && Math.max(Math.abs(p.x - npc.x), Math.abs(p.y - npc.y)) <= 1) {
                return { npc, verb: def.verb, label: def.label, color: def.color };
            }
        }
        return null;
    }
    for (const def of TAVERN_INTERACTABLES) {
        const npc = gameState[def.key];
        if (npc && Math.max(Math.abs(p.x - npc.x), Math.abs(p.y - npc.y)) <= 1) {
            return { npc, verb: def.verb, label: def.label, color: def.color };
        }
    }
    // Dungeon entrance (descend)
    const ex = gameState.dungeonEntrance;
    if (ex && Math.max(Math.abs(p.x - ex.x), Math.abs(p.y - ex.y)) <= 1) {
        return { npc: ex, verb: 'Descend into', label: 'the Dungeon', color: '#ff9f3d' };
    }
    return null;
}


// Enemy sprites — same preload/fallback contract as the player and NPC
// sprites above. Keyed by enemy `type` (see ENEMY_TYPES) so drawEnemy can
// look one up directly from the enemy it's already drawing. Any type without
// a file here (or whose file fails to load) simply keeps the original
// colored-square + glyph rendering, so the game looks correct whether or not
// the art has been added yet — drop a PNG into sprites/ and it appears with
// no code change. Bosses intentionally have no sprite here yet; their
// existing aura/ring treatment stays until dedicated boss art exists.
const ENEMY_SPRITE_SRC = {
    goblin:   'sprites/goblin.png',
    slime:    'sprites/slime.png',
    skeleton: 'sprites/skeleton.png',
    archer:   'sprites/archer.png',
    brute:    'sprites/brute.png',
    cultist:  'sprites/cultist.png',
    thief:    'sprites/thief.png',
    warden:   'sprites/warden.png',
    bat:      'sprites/bat.png',
    spider:   'sprites/spider.png',
    necromancer: 'sprites/necromancer.png',
    imp:      'sprites/imp.png',
    ratman:   'sprites/ratman.png',
    ghoul:    'sprites/ghoul.png',
    lizardman:'sprites/lizardman.png',
    orc:      'sprites/orc.png',
    darkknight:'sprites/darkknight.png',
    demon:    'sprites/demon.png',
    mimic:    'sprites/mimic.png',
    // Milestone boss sprites — keyed by name, not type
    'The Fallen God': 'sprites/fallengod.png',
};

const ENEMY_SPRITES = {};
for (const [key, src] of Object.entries(ENEMY_SPRITE_SRC)) {
    const img = new Image();
    img.src = src;
    img._loadFailed = false;
    img.onerror = () => { img._loadFailed = true; };
    ENEMY_SPRITES[key] = img;
}

function getEnemySprite(type) {
    const img = ENEMY_SPRITES[type];
    if (!img || img._loadFailed || !img.complete || img.naturalWidth === 0) return null;
    return img;
}


// Per-class accent color — drives icon medallions, active states, and the
// preview pane once a class is selected, so each path reads as distinct
// at a glance instead of everything rendering in the same tavern gold.
const CLASS_COLOR = {
    warrior: '#e0654a',
    rogue:   '#9b7bd6',
    mage:    '#55c7ff',
    cleric:  '#ffd65a'
};


// Flavor-only starting loadout shown on the preview card — illustrative,
// does not change actual starting inventory/equipment.
const STARTING_GEAR = {
    warrior: ['Rusted Sword', 'Wooden Shield', 'Health Potion'],
    rogue:   ['Twin Daggers', 'Smoke Bomb', 'Lockpick Kit'],
    mage:    ['Apprentice Staff', 'Tattered Spellbook', 'Mana Draught'],
    cleric:  ['Blessed Mace', "Healer's Vestments", 'Health Potion']
};


// Rotating flavor lines for the tavern header
const TAVERN_FLAVOR_LINES = [
    'The smell of ale and smoke fills the room.',
    'A grizzled veteran points toward the dungeon entrance.',
    'Many descend. Few return.',
    'Somewhere below, something ancient stirs.',
    'The bartender doesn\u2019t ask why you\u2019re here. He never does.'
];


const SUBCLASSES = {
    warrior: [
        {
            id: 'berserker', name: 'Berserker', tagline: 'Fury without restraint',
            traits: [
                'Attack power grows as HP drops',
                'Bonus damage stacks per consecutive kill',
                'Ignore death once per floor at 1 HP'
            ],
            abilities: ['Bloodlust', 'Frenzied Strike', 'Death Defied'],
            stats: { hp: 110, maxHp: 110, atk: 15, def: 4, mana: 0, maxMana: 0 },
            special: 'Rage 0 / 100'
        },
        {
            id: 'knight', name: 'Knight', tagline: 'Discipline forged into iron',
            traits: [
                'Passive block charge restores on movement',
                'Reduced damage from adjacent enemies',
                'Bonus DEF scales with each floor descended'
            ],
            abilities: ['Shield Wall', 'Smite', 'Iron Resolve'],
            stats: { hp: 140, maxHp: 140, atk: 9, def: 12, mana: 0, maxMana: 0 },
            special: 'Block (passive shield charge)'
        },
        {
            id: 'gladiator', name: 'Gladiator', tagline: 'The crowd demands blood',
            traits: [
                'Enters The Pit from level 1 — no Floor 20 required',
                'Counter-attack stacks build when struck',
                'Bonus damage against stunned enemies',
                'Gold find bonus scales with floor depth'
            ],
            abilities: ['Riposte', 'Crowd Pleaser', 'Arena Master'],
            stats: { hp: 100, maxHp: 100, atk: 13, def: 6, mana: 0, maxMana: 0 },
            special: 'Combo 0 (counter stacks)'
        }
    ],
    rogue: [
        {
            id: 'assassin', name: 'Assassin', tagline: 'One strike is all it takes',
            traits: [
                '40% base critical hit chance',
                'Backstab deals triple damage from stealth',
                'Vanish after a killing blow for one turn'
            ],
            abilities: ['Shadow Strike', 'Vanish', 'Marked for Death'],
            stats: { hp: 70, maxHp: 70, atk: 16, def: 3, mana: 0, maxMana: 0 },
            special: '40% Crit Chance'
        },
        {
            id: 'trickster', name: 'Trickster', tagline: 'Outwit before you outfight',
            traits: [
                'Starts with 2 trap charges to set on the floor',
                'Enemies who step on traps are stunned for 2 turns',
                'First hit each floor has a 25% dodge chance'
            ],
            abilities: ['Set Trap', 'Smoke Screen', 'Bamboozle'],
            stats: { hp: 75, maxHp: 75, atk: 11, def: 4, mana: 0, maxMana: 0 },
            special: 'Trap Charges: 2'
        },
        {
            id: 'shadow', name: 'Shadow', tagline: 'Darkness is the sharpest blade',
            traits: [
                'Mana powers unique shadow abilities',
                'Enemies lose sight of you beyond 2 tiles',
                'Shadow step teleports through walls to safety'
            ],
            abilities: ['Shadow Step', 'Eclipse', 'Wraithform'],
            stats: { hp: 80, maxHp: 80, atk: 13, def: 3, mana: 20, maxMana: 20 },
            special: 'Mana 20 / 20'
        }
    ],
    mage: [
        {
            id: 'elementalist', name: 'Elementalist', tagline: 'Command the primal forces',
            traits: [
                'Largest mana pool of any mage path',
                'Cycle between fire, ice, and lightning elements',
                'Exploit elemental weaknesses for bonus damage'
            ],
            abilities: ['Prism Bolt', 'Elemental Surge', 'Cataclysm'],
            stats: { hp: 55, maxHp: 55, atk: 7, def: 2, mana: 40, maxMana: 40 },
            special: 'Mana 40 / 40'
        },
        {
            id: 'illusionist', name: 'Illusionist', tagline: 'Nothing is as it seems',
            traits: [
                'Summon a phantom decoy to draw enemy attacks',
                'Confusion spell makes enemies attack each other',
                'Mirror image splits incoming damage three ways'
            ],
            abilities: ['Phantom Twin', 'Bewilderment', 'Hall of Mirrors'],
            stats: { hp: 60, maxHp: 60, atk: 5, def: 3, mana: 35, maxMana: 35 },
            special: 'Mana 35 / 35'
        },
        {
            id: 'necromancer', name: 'Necromancer', tagline: 'Death is merely a resource',
            traits: [
                'Raise fallen enemies as temporary minions',
                'Drain life from your own minions to heal',
                'Summon bone shields from nearby corpses'
            ],
            abilities: ['Raise Dead', 'Life Drain', 'Bone Wall'],
            stats: { hp: 65, maxHp: 65, atk: 6, def: 2, mana: 30, maxMana: 30 },
            special: 'Mana 30 / 30 · Minions: 0'
        }
    ],
    cleric: [
        {
            id: 'warDomain', name: 'War Domain', tagline: 'Battle-blessed and unyielding',
            traits: [
                'Divine Strike bonus applies on every melee hit',
                'War Cry stuns all adjacent enemies for 1 turn',
                'Blessed rage: ATK bonus grows below half HP'
            ],
            abilities: ['Divine Strike', 'War Cry', 'Holy Charge'],
            stats: { hp: 105, maxHp: 105, atk: 11, def: 7, mana: 20, maxMana: 20 },
            special: 'Mana 20 / 20'
        },
        {
            id: 'lightDomain', name: 'Light Domain', tagline: 'Purity radiates through darkness',
            traits: [
                'Heals restore more HP and can briefly overheal',
                'Critical hits blind enemies for 1 turn',
                'Holy aura damages adjacent undead each turn'
            ],
            abilities: ['Radiance', 'Searing Light', 'Solar Flare'],
            stats: { hp: 95, maxHp: 95, atk: 8, def: 5, mana: 30, maxMana: 30 },
            special: 'Mana 30 / 30'
        },
        {
            id: 'twilightDomain', name: 'Twilight Domain', tagline: 'Guardian of the liminal dark',
            traits: [
                'Balanced healing and defense capabilities',
                'Step of Night: traps cannot trigger against you',
                'Moonbeam hex reduces enemy ATK for 2 turns'
            ],
            abilities: ['Moonbeam', 'Step of Night', 'Veil of Dusk'],
            stats: { hp: 90, maxHp: 90, atk: 9, def: 8, mana: 25, maxMana: 25 },
            special: 'Mana 25 / 25'
        }
    ]
};


// ── Selling ──────────────────────────────────────────────────────────────
// Merchant only buys gear (weapons/armor/trinkets), priced off the same
// rarity tiers the shop already uses for its own stock. Cursed-but-unidentified
// items sell for a flat, cautious price since neither party can appraise them.
const SELL_RARITY_BASE = { common: 6, uncommon: 14, rare: 28, epic: 55, legendary: 120, mythic: 250 };


// ── Status effects ────────────────────────────────────────────────────────────

const STATUS_META = {
    poison:  { color: '#58c26d', icon: '☠', label: 'Poisoned' },
    burn:    { color: '#ff9f58', icon: '🔥', label: 'Burning' },
    stun:    { color: '#ffd65a', icon: '★',  label: 'Stunned' },
    freeze:  { color: '#7fd8ff', icon: '❄',  label: 'Frozen' },
    renew:   { color: '#9fe6b0', icon: '✚',  label: 'Renewing' },
    weaken:  { color: '#d08aff', icon: '↓',  label: 'Weakened' },
    rage:    { color: '#ff4500', icon: '⚡', label: 'Enraged' },
    confuse: { color: '#c49eff', icon: '?',  label: 'Confused' },
    blind:   { color: '#fff7d6', icon: '☉',  label: 'Blinded' }
};


// ── What's New popup ─────────────────────────────────────────────────────
// Shown once per version, the first time a player loads the game after an
// update — compares GAME_VERSION against the last-seen version stored in
// localStorage (see hasSeenChangelog()/markChangelogSeen() in main.js).
// Entries are short, player-facing summaries; the manual's Version History
// section carries the fuller writeup. Most recent first.
const CHANGELOG = [
    {
        version: '1.13.0',
        highlights: [
            'Arena Rivals: every champion now remembers you. Win or lose, your head-to-head record follows you — "Iron Warden (2-3)" — surfaced on every bout card and called out as you step into the Pit. Build a nemesis, or a list of the ones you dominate.',
            'A new Player Profile — one place to see who you\\u2019ve become: your Pit fame and title, tavern renown, flagon coins, best floor, lifetime kills and gold, and every arena rivalry, sorted by how often you\\u2019ve clashed.',
            'The Hall of Legends. Eleven earned titles — from First Blood to Conqueror of Ash to Nemesis Slayer — each unlocked by your deeds, displayed alongside your records and current Pit rank.',
            'The Pit Master speaks. Champions now get a proper introduction before a bout — a full dramatic crawl the first time you face them (and always for bosses), a quick line on the rematches, so the spectacle never wears thin.',
            'The tavern reacts to your fame. Walk in as an Unknown and nobody looks up; walk in as a Legend and the room comes to its feet. Random patrons mutter overheard tales, some about your own deepest descents.',
            'The dungeon now has regions. Descend through the Ashen Crypt, the Forgotten Mines, the Sunken Cathedral, and the Frost Peaks — each with its own character, enemy mix, and loot, announced as you cross into it.',
            'A new Monster Stable: manage the creatures you\\u2019ve caged this run — send them to fight in the Pit, sell them to a broker, or set them free.',
        ]
    },
    {
        version: '1.12.0',
        highlights: [
            'The overland zones are now alive. Forests hold forage nodes — Wild Herbs, Ash Berries, Glowcap Mushrooms, and Coin Pouches hidden in the undergrowth. Roads host travelling merchants with rotating stock. Both can trigger mini-events: wayside shrines, abandoned camps, hidden caches, and lost travellers.',
            'Ambushes. Step into the wrong corner of a forest and a pack materialises around you — real combat, on the overland map, before you ever reach the dungeon.',
            'The Return-to-Tavern portal system is fully wired. Mages and Clerics can cast Town Portal or Sanctuary Gate (unlocks Lv4, costs 6 mana). Warriors and Rogues buy a Hearthstone Coin from the innkeeper (40g) before diving. Floor 1 exits are still free.',
            'Town services fixed. The Resistance Tonic from the Alchemist actually blocks poison and burn. Greater Potions from the Alchemist are now consumable. The Town Hall death counter reads from the correct stat.',
            'The Pit now properly saves and restores dungeon floor items when you enter and exit arena bouts. Loot on the ground no longer vanishes when you fight a champion.',
            'Arena balances: late seasons now pay season-scaled gold (Silver 1.4×, Gold 1.8×, Champion 2.5×) so the arena stays relevant against dungeon rewards. Repeat kills against the same champion earn diminishing renown after three victories. Captured creatures can now be released for 8g when your cages are full.',
            'All five boss balance fixes: boss ATK scaling reduced from 1.4× to 1.1× per floor, boss HP scaling reduced from 12 to 10 per floor. Orc ATK 14→12, Dark Knight DEF 8→6, Demon ATK 16→14.',
            'Combat edge cases closed: decoy HP no longer shows negative values, arena entry now clears all status effects so poison cannot kill you at full HP on turn 1, and boss variant enemies (wraiths, splitters) can no longer be captured.',
            'Quit to Desktop button added to the Settings panel (O key) and fully wired via Electron IPC — the title screen quit button actually works now.',
            'A sweeping visual & UX overhaul: class-specific character-creation FX, a redesigned gender picker, full-screen death/victory overlays, an animated combat log, achievement toasts, cinematic boss reveals, item rarity shine effects, level-up stat badges, and a run-history panel.',
            'Numerous bot and engine fixes throughout.',
        ]
    },
    {
        version: '1.11.0',
        highlights: [
            'The world has opened up. Step out of the tavern courtyard onto a 5×5 overland map — The City of Bravehold, the open roads, dense forests, and the mountains that wall the realm.',
            'The Pit has moved out of the courtyard and onto the map as its own arena ground, south of the tavern. Still locked until you have survived Floor 20.',
            'Roads connect the realm: travel from the tavern to Bravehold, the Crossroads, the Dungeon Approach, and the East Fork. Zone exits are marked with directional arrows.',
            'New ambient zones — forest and road — each with their own hand-painted terrain, ready to be filled with encounters in a future update.',
            'Touch controls and full key rebinding: play on a tablet, or remap every action in Settings.',
            'A global leaderboard now records your deepest runs (when connected to a leaderboard server).',
            'Richer visuals throughout: bevelled stonework, warmer torchlight, rarity-tiered item glows, and gradient health bars.',
            'Numerous fixes — the Bard no longer interrupts you in the courtyard, new runs always start clean, and saving inside any zone now restores you to the right place.',
        ]
    },
    {
        version: '1.10.0',
        highlights: [
            'The Pit now runs in four Arena Seasons — Bronze, Silver, Gold, and Champion — each with its own opponent roster, identity, and promotion ceremony. 13 champions across all seasons.',
            'New Arena Gauntlet: a multi-wave endurance mode. Bank gold and fame each wave, keep them even if you fall, and heal only partially between rounds. One gauntlet per season.',
            'Seven new elite enemies haunt the deep floors (20+): the Imp, Ratman, Ghoul, Lizardman, Orc, Dark Knight, and Demon — each with its own mechanic and intent telegraph.',
            'Beware the Mimic. Some chests on floor 15+ are not chests at all.',
            'Dungeon Events: each run can now roll a modifier like Goblin Migration, Ash Storm, or Blessed Week that colours the whole descent.',
            'Tavern Renown — a new reputation track with 15 milestones that fill the Flagon with patrons, dialogue, your portrait, golden banners, and real services as you become a legend.',
            'The Broken Flagon Casino: the Fortune Wheel and a Daily Jackpot that grows every day you don\u2019t claim it — a reason to come back daily.',
            'A new illustrated Storybook replaces the old legend text, with chapter art and an ending that pulls you toward the dark.',
            'The Fallen: every hero who dies is now remembered by name on the title screen and in the legend.',
            'Each tavern shop now looks the part — a glowing forge, a vault door, potion shelves, a practice dummy, and a proper bar with kegs.',
            'A full Player\u2019s Manual is now linked from the Help panel.',
        ]
    },
    {
        version: '1.9.0',
        highlights: [
            'The tavern hub is no longer one open room — it now has distinct walled-off areas: a Bank & Vault nook, a Smithy & Training Yard, and a back room.',
            'Five tavern staff (Innkeeper, Blacksmith, Trainer, Banker, Merchant) now have real character art instead of flat colored squares.',
            'You can now click directly on a tavern NPC to interact with them, instead of only walking up and pressing Space.',
            'Discovered a new hidden room: the Cellar. Approach it for a chance at a one-time, run-changing find.',
        ]
    },
    {
        version: '1.8.0',
        highlights: [
            'The character-creation hub now puts your in-progress run front and center, instead of the achievements list.',
            'Every class and enemy now has idle motion and smooth movement between tiles — enemies used to snap instantly with no animation at all.',
            'Every class now visibly lunges on a regular attack, not just Berserker.',
            'Critical hits and boss kills now hit harder visually — a brief impact freeze and a screen flash on top of the existing shake.',
            'The tavern now has a lit fireplace, rising embers, and drifting dust — it had zero lighting effects before this.',
        ]
    },
    {
        version: '1.7.0',
        highlights: [
            'Shareable seed codes — every run now has a 7-character code. Copy yours from the Character Sheet or run-end screen, or type in a friend\u2019s code at character creation to play their exact dungeon.',
        ]
    },
    {
        version: '1.6.0',
        highlights: [
            'Six subclass traits that were only ever described in the manual are now actually implemented: Illusionist\u2019s Confusion and Mirror Image, Necromancer\u2019s bone shield, Berserker\u2019s once-per-floor death save, War Domain\u2019s War Cry, Light Domain\u2019s crit-blind, Knight\u2019s adjacent-damage reduction and floor-scaling DEF, and Gladiator\u2019s stun-damage bonus and floor-scaling gold find.',
            'Rebalanced late-floor bosses — they were gaining attack power twice as fast as players could keep pace with through gear and leveling.',
            'An intro cinematic now plays before character creation on a fresh start (skippable).',
            'Several small bugs fixed: a stray "house wins on 11" dice label, a rare double-death-screen glitch, and Knight/Gladiator passives not refreshing on floor change.',
        ]
    },
];


const GAME_OVER_EPITAPHS = [
    'The tavern keeper adds another name to the wall.',
    'The dungeon claims one more.',
    'They\u2019ll tell stories about this one. Briefly.',
    'Another mug raised at the Broken Flagon, in memory.',
    'The descent ends. The dungeon remains.'
];


// ── Flagon Dice ───────────────────────────────────────────────────────────────

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];


// ── Magic Dealer ──────────────────────────────────────────────────────────────

const MAGIC_RELIC_WEAPONS = ['Runesword', 'Voidblade', 'Soulcleaver', 'Hexblade', 'Wraithspear'];

// ── Spellbook ───────────────────────────────────────────────────────────────
// Mages and Clerics (base class, no subclass) press the ability key to open a
// spell-selection menu instead of auto-casting. Each spell has a mana cost, a
// target type, and an effect resolved in castSpell() (entities.js). Spells
// unlock as the player levels up so the menu grows over the run instead of
// dumping everything at level 1.
//   target: 'enemy'  — needs a visible enemy (nearest in LOS is auto-picked)
//           'self'   — affects the caster, no target needed
//           'aoe'    — hits all visible enemies
const SPELLBOOK = {
    mage: [
        { id: 'fireball',     name: 'Fireball',      icon: '🔥', mana: 3,  unlockLevel: 1,
          target: 'enemy', desc: 'Scorch a foe and set it burning for 3 turns.' },
        { id: 'frostbolt',    name: 'Frost Bolt',    icon: '❄', mana: 3,  unlockLevel: 2,
          target: 'enemy', desc: 'Strike a foe and freeze it solid for a turn.' },
        { id: 'arcane_missile', name: 'Arcane Missile', icon: '✦', mana: 2, unlockLevel: 1,
          target: 'enemy', desc: 'A cheap bolt of raw force. Never misses, no frills.' },
        { id: 'chain_lightning', name: 'Chain Lightning', icon: '⚡', mana: 5, unlockLevel: 5,
          target: 'enemy', desc: 'Lightning leaps between up to 3 nearby enemies.' },
        { id: 'meteor',       name: 'Meteor',        icon: '☄', mana: 8,  unlockLevel: 9,
          target: 'aoe',   desc: 'Call down fire on every visible enemy. Big mana.' },
        { id: 'mana_shield',  name: 'Mana Shield',   icon: '◈', mana: 4,  unlockLevel: 7,
          target: 'self',  desc: 'Convert mana into a temporary damage-absorbing ward.' },
        { id: 'town_portal',  name: 'Town Portal',   icon: '🌀', mana: 6,  unlockLevel: 4,
          target: 'utility', desc: 'Tear open a portal to the tavern. You can return to this exact floor.' },
    ],
    cleric: [
        { id: 'heal',         name: 'Heal',          icon: '✚', mana: 4,  unlockLevel: 1,
          target: 'self',  desc: 'Restore 35% of your max HP.' },
        { id: 'smite',        name: 'Smite',         icon: '🌟', mana: 3,  unlockLevel: 1,
          target: 'enemy', desc: 'Holy light burns a foe for divine damage.' },
        { id: 'renew',        name: 'Renew',         icon: '♻', mana: 3,  unlockLevel: 3,
          target: 'self',  desc: 'Regenerate HP over the next 4 turns.' },
        { id: 'holy_nova',    name: 'Holy Nova',     icon: '✺', mana: 6,  unlockLevel: 6,
          target: 'aoe',   desc: 'A burst of light damages all foes and heals you.' },
        { id: 'sanctuary',    name: 'Sanctuary',     icon: '⛨', mana: 4,  unlockLevel: 8,
          target: 'self',  desc: 'Stun every adjacent enemy and shield yourself.' },
        { id: 'condemn',      name: 'Condemn',       icon: '☨', mana: 5,  unlockLevel: 5,
          target: 'enemy', desc: 'Sear a foe and weaken its attacks for 3 turns.' },
        { id: 'town_portal',  name: 'Sanctuary Gate', icon: '🌀', mana: 6, unlockLevel: 4,
          target: 'utility', desc: 'Open a blessed gate to the tavern. You can return to this exact floor.' },
    ],
};


const MAGIC_RELIC_ARMORS  = ['Shadowmail', 'Cursed Plate', 'Runecloak', 'Hexweave', 'Voidmantle'];


// ── Elemental Weapons ──────────────────────────────────────────────────────────
// Weapons can roll an element that triggers an on-hit effect in addition to
// their normal +ATK. Resolved in applyWeaponElementOnHit() (combat.js). The
// element is chosen at creation time (see createGear) with a per-element drop
// weight; most weapons are non-elemental so an elemental drop feels special.
const WEAPON_ELEMENTS = {
    fire: {
        label: 'Flaming',
        adjective: 'wreathed in flame',
        color: '#ff7a2f',
        glyph: '🔥',
        // Applies a burn (fire DoT) on every hit. Firestorm: a chance for a
        // bigger 3-turn burn that also singes adjacent enemies.
        onHitDesc: 'Hits set the enemy ablaze (burn). Chance to ignite a firestorm.',
        burnTurns: 2,
        firestormChance: 0.18,   // chance the burn becomes a 3-turn firestorm
        firestormSplash: true,   // firestorm also burns adjacent enemies
    },
    frost: {
        label: 'Frostbrand',
        adjective: 'sheathed in killing cold',
        color: '#7fd8ff',
        glyph: '❄',
        // Chance to freeze (skip a turn) on hit; freeze chance is lower than
        // fire's burn since a skipped turn is stronger than a DoT tick.
        onHitDesc: 'Hits chill the enemy — chance to freeze them solid for a turn.',
        freezeChance: 0.30,
        freezeTurns: 1,
    },
    lightning: {
        label: 'Stormcharged',
        adjective: 'crackling with stormlight',
        color: '#ffe14d',
        glyph: '⚡',
        // Chance to chain a bolt of reduced damage to a second nearby enemy,
        // plus a small stun chance on the primary target.
        onHitDesc: 'Hits may arc to a nearby enemy and briefly stun the target.',
        chainChance: 0.35,
        chainDamagePct: 0.5,   // chained bolt deals 50% of the hit's damage
        chainRange: 3,
        stunChance: 0.15,
        stunTurns: 1,
    },
};

// Per-element base drop weight. A weapon rolls elemental only if rng beats the
// non-elemental majority; deeper floors slightly raise the elemental chance.
const WEAPON_ELEMENT_DROP_CHANCE = 0.22; // ~1 in 4-5 weapons is elemental





// ── Save & Load ────────────────────────────────────────────────────────────────

const SAVE_KEY_RUN  = 'dungeon_crawler_active_run';

const SAVE_KEY_META = 'dungeon_crawler_meta';

const SAVE_KEY_CHANGELOG_SEEN = 'dungeon_crawler_changelog_seen';

const SAVE_KEY_BEST_FLOOR = 'dungeon_crawler_best_floor';

const SAVE_KEY_SETTINGS = 'dungeon_crawler_settings';


// Player-facing options, persisted across runs in localStorage. Defaults are
// chosen so a first-time player gets the full intended experience (sound on,
// full juice); the toggles exist for preference and accessibility (volume,
// mute, and motion-sensitivity options for the screen shake / flash effects).
// Default key bindings — every action maps to its primary key.
// Values are the KeyboardEvent.key strings (or .toLowerCase() for letters).
// Arrow keys kept as 'ArrowUp' etc.; letter keys stored lowercase.
const DEFAULT_KEY_BINDINGS = {
    moveUp:     'w',
    moveDown:   's',
    moveLeft:   'a',
    moveRight:  'd',
    action:     ' ',       // Space — interact / attack
    descend:    'Enter',
    ability:    'e',
    potion:     '1',
    antidote:   '2',
    smokebomb:  '3',
    rage:       '4',
    identify:   '5',
    capture:    '6',
    charsheet:  'c',
    help:       'h',
    settings:   'o',
    bestiary:   'b',
    donate:     'g',
    tavern:     't',
    map:        'm',       // toggle world map overlay
};

const DEFAULT_SETTINGS = {
    masterVolume: 0.7,  // 0..1, scales the audio master gain
    muted: false,
    ambientEnabled: true, // looping background soundscape (tavern/dungeon/combat)
    screenShake: true,  // camera shake on big hits
    reduceMotion: false, // suppresses screen flashes + hit-stop for motion sensitivity
    keyBindings: null,  // null = use DEFAULT_KEY_BINDINGS; set to object to override
};

// Returns the active key bindings, merging saved overrides over defaults.
function getKeyBindings() {
    const saved = gameSettings.keyBindings;
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_KEY_BINDINGS };
    return { ...DEFAULT_KEY_BINDINGS, ...saved };
}

let gameSettings = { ...DEFAULT_SETTINGS };

function loadSettings() {
    try {
        const raw = localStorage.getItem(SAVE_KEY_SETTINGS);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                // Merge over defaults so a save written by an older version
                // (missing a newer key) still gets sane values for it.
                gameSettings = { ...DEFAULT_SETTINGS, ...parsed };
                // Clamp volume defensively in case of a hand-edited save
                gameSettings.masterVolume = Math.max(0, Math.min(1, Number(gameSettings.masterVolume) || 0));
            }
        }
    } catch (e) {
        if (!(e instanceof DOMException)) console.warn('loadSettings failed:', e);
    }
    return gameSettings;
}

function saveSettings() {
    try {
        localStorage.setItem(SAVE_KEY_SETTINGS, JSON.stringify(gameSettings));
    } catch (e) {
        if (!(e instanceof DOMException)) console.warn('saveSettings failed:', e);
    }
}

// Effective audio gain — what the master gain node should actually be set to,
// accounting for the mute toggle. Centralised so audio.js and the settings
// panel never disagree about what "muted" means.
function effectiveVolume() {
    return gameSettings.muted ? 0 : gameSettings.masterVolume;
}
