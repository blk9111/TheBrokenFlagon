
// ── Procedural Audio ──────────────────────────────────────────────────────────

let audioCtx = null;
let _masterGain = null;


function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        _masterGain = audioCtx.createGain();
        _masterGain.gain.value = (typeof effectiveVolume === 'function') ? effectiveVolume() : 0.7;
        _masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}


function _out(ac) {
    return _masterGain || ac.destination;
}


function applyAudioSettings() {
    if (!_masterGain || !audioCtx) return;
    const target = (typeof effectiveVolume === 'function') ? effectiveVolume() : 0.7;
    const now = audioCtx.currentTime;
    _masterGain.gain.cancelScheduledValues(now);
    _masterGain.gain.setValueAtTime(_masterGain.gain.value, now);
    _masterGain.gain.linearRampToValueAtTime(target, now + 0.05);
    // Update ambient volume too
    _updateAmbientVolume();
}


function _osc(ac, freq, type, t0, t1, peak, freqEnd) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(_out(ac));
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t1);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.start(t0);
    osc.stop(t1 + 0.04);
}


// ── Noise buffer helper ──────────────────────────────────────────────────────
function _noiseBuffer(ac, duration, type = 'white') {
    const sr = ac.sampleRate;
    const len = Math.ceil(sr * duration);
    const buf = ac.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        if (type === 'pink') {
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
            b6 = white * 0.115926;
        } else if (type === 'brown') {
            data[i] = (b0 = (b0 + (0.02 * white)) / 1.02) * 3.5;
        } else {
            data[i] = white;
        }
    }
    return buf;
}


// ══════════════════════════════════════════════════════════════════════════════
// COMBAT SFX — variations per hit type
// ══════════════════════════════════════════════════════════════════════════════

function sfxFootstep() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    const pitch = 80 + Math.random() * 30;
    _osc(ac, pitch, 'sine', t, t + 0.06, 0.08, 50);
}


function sfxAttack() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Metallic slash — slight pitch variation each time
    const base = 280 + Math.random() * 60;
    _osc(ac, base, 'square', t, t + 0.10, 0.14, 80);
    // Impact thud
    _osc(ac, 60 + Math.random() * 20, 'sine', t + 0.02, t + 0.08, 0.10, 30);
}


function sfxCriticalHit() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Sharp high-freq crack
    _osc(ac, 800, 'sawtooth', t, t + 0.06, 0.20, 200);
    // Resonant impact
    _osc(ac, 180, 'triangle', t + 0.02, t + 0.18, 0.16, 60);
    // Sparkle trail
    [1200, 1500, 1800].forEach((f, i) => {
        _osc(ac, f, 'sine', t + 0.05 + i * 0.04, t + 0.12 + i * 0.04, 0.06);
    });
}


function sfxEnemyHit() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    const pitch = 500 + Math.random() * 120;
    _osc(ac, pitch, 'triangle', t, t + 0.07, 0.12, 190);
}


function sfxBlock() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Dull metallic clang
    _osc(ac, 420, 'square', t, t + 0.05, 0.10, 320);
    _osc(ac, 180, 'sine', t, t + 0.08, 0.08);
}


function sfxMiss() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Woosh — descending noise
    _osc(ac, 600, 'sine', t, t + 0.12, 0.06, 200);
}


function sfxChestOpen() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Creak
    _osc(ac, 100, 'sawtooth', t, t + 0.15, 0.08, 160);
    // Sparkle reveal
    [880, 1100, 1320].forEach((f, i) => {
        _osc(ac, f, 'sine', t + 0.12 + i * 0.08, t + 0.22 + i * 0.08, 0.10);
    });
}


function sfxDescend() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Deep rumble + stone scrape
    _osc(ac, 65, 'sawtooth', t, t + 0.6, 0.08, 35);
    _osc(ac, 120, 'square', t + 0.1, t + 0.4, 0.05, 80);
    // Descending tone
    _osc(ac, 300, 'sine', t, t + 0.45, 0.06, 100);
}


function sfxAchievement() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Triumphant ascending chime
    [523, 659, 784, 1047].forEach((f, i) => {
        _osc(ac, f, 'sine', t + i * 0.10, t + i * 0.10 + 0.28, 0.14);
    });
    // Warm pad underneath
    _osc(ac, 262, 'triangle', t, t + 0.8, 0.07);
}


function sfxHeal() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Warm ascending shimmer
    [392, 494, 587, 784].forEach((f, i) => {
        _osc(ac, f, 'sine', t + i * 0.06, t + i * 0.06 + 0.10, 0.10);
    });
}


function sfxItemPickup() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    _osc(ac, 660, 'sine', t, t + 0.09, 0.13);
    _osc(ac, 880, 'sine', t + 0.09, t + 0.19, 0.13);
}


function sfxPotion() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Bubble + gulp
    [0, 0.055, 0.11, 0.165].forEach((dt, i) => {
        _osc(ac, 320 + i * 55, 'sine', t + dt, t + dt + 0.07, 0.09);
    });
}


function sfxLevelUp() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Ascending fanfare
    [523, 659, 784].forEach((freq, i) => {
        _osc(ac, freq, 'sine', t + i * 0.14, t + i * 0.14 + 0.22, 0.16);
    });
    // Final triumphant chord
    [1047, 1319].forEach((freq) => {
        _osc(ac, freq, 'sine', t + 0.42, t + 0.85, 0.10);
    });
    // Low resonance
    _osc(ac, 131, 'triangle', t + 0.42, t + 0.90, 0.06);
}


function sfxBossEncounter() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Deep ominous drones
    [55, 58].forEach(freq => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(_out(ac));
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.35);
        gain.gain.linearRampToValueAtTime(0.06, t + 1.0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        osc.start(t);
        osc.stop(t + 2.3);
    });
    // Metallic scrape
    _osc(ac, 2200, 'sawtooth', t + 0.3, t + 0.8, 0.03, 600);
    // Sub-bass impact at the end
    _osc(ac, 40, 'sine', t + 1.0, t + 1.8, 0.10, 22);
}


function sfxLegendary() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Ascending arpeggio
    [440, 554, 659, 880, 1108].forEach((freq, i) => {
        _osc(ac, freq, 'sine', t + i * 0.12, t + i * 0.12 + 0.35, 0.18);
    });
    _osc(ac, 220, 'triangle', t, t + 0.8, 0.12, 80);
}


function sfxDeath() {
    const ac = ensureAudio();
    const t = ac.currentTime;
    // Descending discordant tones
    [220, 261, 330].forEach((freq, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(_out(ac));
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t + i * 0.06);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.48, t + i * 0.06 + 0.65);
        gain.gain.setValueAtTime(0.11, t + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.75);
        osc.start(t + i * 0.06);
        osc.stop(t + i * 0.06 + 0.8);
    });
    // Final low thud
    _osc(ac, 50, 'sine', t + 0.25, t + 0.9, 0.09, 25);
}


// ══════════════════════════════════════════════════════════════════════════════
// AMBIENT SOUND SYSTEM
// Persistent background atmosphere that changes based on location.
// tavern: crackling fire + quiet murmur
// dungeon: wind + dripping + distant echoes
// ══════════════════════════════════════════════════════════════════════════════

let _ambientNodes = [];
let _ambientType = null;
let _ambientGain = null;

function _updateAmbientVolume() {
    if (!_ambientGain || !audioCtx) return;
    const master = (typeof effectiveVolume === 'function') ? effectiveVolume() : 0.7;
    _ambientGain.gain.setValueAtTime(master * 0.35, audioCtx.currentTime);
}

function startAmbient(type) {
    if (_ambientType === type) return;
    stopAmbient();
    const ac = ensureAudio();
    _ambientType = type;

    _ambientGain = ac.createGain();
    const master = (typeof effectiveVolume === 'function') ? effectiveVolume() : 0.7;
    _ambientGain.gain.setValueAtTime(0.0001, ac.currentTime);
    _ambientGain.gain.linearRampToValueAtTime(master * 0.35, ac.currentTime + 1.5);
    _ambientGain.connect(_out(ac));

    if (type === 'tavern') {
        // Fire crackle — brown noise through a bandpass
        const noiseSrc = ac.createBufferSource();
        noiseSrc.buffer = _noiseBuffer(ac, 4.0, 'brown');
        noiseSrc.loop = true;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 800;
        bp.Q.value = 1.2;
        const noiseGain = ac.createGain();
        noiseGain.gain.value = 0.5;
        noiseSrc.connect(bp);
        bp.connect(noiseGain);
        noiseGain.connect(_ambientGain);
        noiseSrc.start();
        _ambientNodes.push(noiseSrc);

        // Low warm hum
        const hum = ac.createOscillator();
        hum.type = 'sine';
        hum.frequency.value = 85;
        const humGain = ac.createGain();
        humGain.gain.value = 0.08;
        hum.connect(humGain);
        humGain.connect(_ambientGain);
        hum.start();
        _ambientNodes.push(hum);

    } else if (type === 'dungeon') {
        // Wind — filtered white noise
        const windSrc = ac.createBufferSource();
        windSrc.buffer = _noiseBuffer(ac, 6.0, 'pink');
        windSrc.loop = true;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 400;
        lp.Q.value = 0.8;
        const windGain = ac.createGain();
        windGain.gain.value = 0.4;
        windSrc.connect(lp);
        lp.connect(windGain);
        windGain.connect(_ambientGain);
        windSrc.start();
        _ambientNodes.push(windSrc);

        // Deep sub-drone
        const drone = ac.createOscillator();
        drone.type = 'sine';
        drone.frequency.value = 42;
        const droneGain = ac.createGain();
        droneGain.gain.value = 0.06;
        drone.connect(droneGain);
        droneGain.connect(_ambientGain);
        drone.start();
        _ambientNodes.push(drone);
    }
}

function stopAmbient() {
    _ambientNodes.forEach(n => { try { n.stop(); } catch (_) {} });
    _ambientNodes = [];
    if (_ambientGain) {
        try {
            _ambientGain.gain.setValueAtTime(_ambientGain.gain.value, audioCtx.currentTime);
            _ambientGain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
        } catch (_) {}
    }
    _ambientGain = null;
    _ambientType = null;
}


// ── Bard music loop ───────────────────────────────────────────────────────────

let _bardLoopActive = false;

let _bardLoopTimeout = null;


function _stopBardLoop() {
    _bardLoopActive = false;
    if (_bardLoopTimeout !== null) { clearTimeout(_bardLoopTimeout); _bardLoopTimeout = null; }
}


function _scheduleBardNotes(notes, tempoSec, waveType, vol) {
    if (!_bardLoopActive) return;
    const ac = ensureAudio();
    const t = ac.currentTime + 0.05;
    notes.forEach((freq, i) => {
        if (freq > 0) {
            _osc(ac, freq, waveType, t + i * tempoSec, t + i * tempoSec + tempoSec * 0.8, vol);
        }
    });
    const totalMs = Math.round(notes.length * tempoSec * 1000);
    _bardLoopTimeout = setTimeout(() => _scheduleBardNotes(notes, tempoSec, waveType, vol), totalMs);
}


function _startBardLoop(track) {
    _stopBardLoop();
    _bardLoopActive = true;
    _scheduleBardNotes(track.notes, track.tempo / 1000, track.wave, track.vol);
}

