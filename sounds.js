/**
 * Sonidos sintéticos (Web Audio API) — sin archivos externos.
 * Desbloquea audio en la primera interacción del usuario (política del navegador).
 */

let ctx = null;
let unlocked = false;
let masterGain = null;
let muted = false;

function getCtx() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.35;
        masterGain.connect(ctx.destination);
    }
    return ctx;
}

export function unlockAudio() {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') {
        c.resume().catch(() => {});
    }
    unlocked = true;
}

export function setMuted(value) {
    muted = !!value;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.35;
}

function tone(freq, duration, type = 'sine', { gain = 0.2, attack = 0.01, decay = 0.08, slideTo = null } = {}) {
    const c = getCtx();
    if (!c || muted || !unlocked) return;

    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) {
        osc.frequency.linearRampToValueAtTime(slideTo, t0 + duration);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(duration, attack + decay));
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
}

function noiseBurst(duration = 0.08, { gain = 0.12, filterFreq = 1200 } = {}) {
    const c = getCtx();
    if (!c || muted || !unlocked) return;

    const len = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, len, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    const t0 = c.currentTime;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
}

/** @param {keyof typeof SOUNDS | string} name */
export function playSound(name) {
    const fn = SOUNDS[name];
    if (fn) fn();
}

const SOUNDS = {
    click() {
        tone(880, 0.05, 'square', { gain: 0.06, attack: 0.005, decay: 0.04 });
    },
    select() {
        tone(660, 0.06, 'triangle', { gain: 0.08, attack: 0.005, decay: 0.05 });
    },
    reorder() {
        tone(420, 0.05, 'sine', { gain: 0.07, attack: 0.005, decay: 0.04, slideTo: 520 });
    },
    draw() {
        noiseBurst(0.1, { gain: 0.1, filterFreq: 1800 });
        tone(320, 0.12, 'triangle', { gain: 0.1, attack: 0.01, decay: 0.1, slideTo: 480 });
    },
    drawDiscard() {
        tone(520, 0.1, 'sine', { gain: 0.12, attack: 0.01, decay: 0.08 });
        setTimeout(() => tone(700, 0.12, 'triangle', { gain: 0.1, attack: 0.01, decay: 0.1 }), 70);
    },
    discard() {
        tone(240, 0.1, 'square', { gain: 0.08, attack: 0.005, decay: 0.08, slideTo: 140 });
        noiseBurst(0.06, { gain: 0.08, filterFreq: 600 });
    },
    meld() {
        tone(392, 0.12, 'sine', { gain: 0.12, attack: 0.01, decay: 0.1 });
        setTimeout(() => tone(523, 0.12, 'sine', { gain: 0.11, attack: 0.01, decay: 0.1 }), 80);
        setTimeout(() => tone(659, 0.18, 'triangle', { gain: 0.12, attack: 0.01, decay: 0.15 }), 160);
    },
    turn() {
        tone(740, 0.08, 'sine', { gain: 0.1, attack: 0.01, decay: 0.06 });
        setTimeout(() => tone(988, 0.14, 'triangle', { gain: 0.12, attack: 0.01, decay: 0.12 }), 90);
    },
    recycle() {
        tone(300, 0.15, 'sawtooth', { gain: 0.06, attack: 0.02, decay: 0.12, slideTo: 180 });
    },
    start() {
        tone(440, 0.1, 'sine', { gain: 0.1, attack: 0.01, decay: 0.08 });
        setTimeout(() => tone(554, 0.1, 'sine', { gain: 0.1, attack: 0.01, decay: 0.08 }), 100);
        setTimeout(() => tone(659, 0.2, 'triangle', { gain: 0.12, attack: 0.01, decay: 0.15 }), 200);
    },
    win() {
        [523, 659, 784, 1047].forEach((f, i) => {
            setTimeout(() => tone(f, 0.22, i === 3 ? 'triangle' : 'sine', { gain: 0.14, attack: 0.01, decay: 0.18 }), i * 120);
        });
    },
    lose() {
        tone(392, 0.2, 'triangle', { gain: 0.12, attack: 0.02, decay: 0.15, slideTo: 300 });
        setTimeout(() => tone(294, 0.35, 'sine', { gain: 0.1, attack: 0.02, decay: 0.3, slideTo: 200 }), 180);
    },
    error() {
        tone(180, 0.12, 'square', { gain: 0.1, attack: 0.005, decay: 0.1 });
        setTimeout(() => tone(140, 0.15, 'square', { gain: 0.08, attack: 0.005, decay: 0.12 }), 80);
    },
    stop() {
        tone(880, 0.08, 'square', { gain: 0.1, attack: 0.005, decay: 0.06 });
        setTimeout(() => tone(660, 0.08, 'square', { gain: 0.1, attack: 0.005, decay: 0.06 }), 90);
        setTimeout(() => tone(440, 0.2, 'triangle', { gain: 0.12, attack: 0.01, decay: 0.18 }), 180);
    }
};

/** Activa desbloqueo en la primera interacción global. */
export function bindAudioUnlock() {
    const once = () => {
        unlockAudio();
        document.removeEventListener('pointerdown', once);
        document.removeEventListener('keydown', once);
    };
    document.addEventListener('pointerdown', once);
    document.addEventListener('keydown', once);
}
