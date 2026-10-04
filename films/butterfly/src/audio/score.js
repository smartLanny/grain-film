// THE SCORE of 《梦蝶》 / THE DREAM OF THE BUTTERFLY: music and sound, every sample synthesized.
//
//   export async function renderScore(ctx, duration)
//     ctx       an OfflineAudioContext (48 kHz, stereo, length = duration). The finished mix is
//               scheduled on it as one buffer; the caller calls ctx.startRendering().
//     duration  film length in seconds (240)
//
// The idea (SCRIPT.md section 6)
//   One scale, two tonics. Everything is made of D E F# A B. From B it is the human world (yu mode,
//   QIN and FELT, the "concrete" room); from D it is the butterfly's (gong mode, XIAO, GLASS and
//   WINGS, the "open air" room). One theme, two directions: the butterfly's rises A4 B4 D5 F#5, the
//   human's is the same notes backwards and lower, F#4 D4 B3 A3. E is withheld until the bell at
//   03:40.5; all five notes sound together once, at 03:53.0.
//
// How it is built
//   1. The cue sheet is written out below, cue by cue, in film seconds (60 BPM: every musical cue
//      sits on a whole or half second; the wings play triplets against it). Shot times are those of
//      SCRIPT.md section 4.
//   2. The film is four reels, separated by its hard edits and its silences:
//        A 00:00.0-01:20.9   night, scales, emergence, flight, the drop      (then 1.1 s of silence)
//        B 01:22.0-02:09.0   the alarm, the day of weight, the rain          (cut by the rail joint)
//        C 02:09.0-03:34.0   the train, the crossing, 物化, migration, dusk   (then digital silence)
//        D 03:37.5-03:58.5   the paper, the bell, the five notes
//      so the splash and the alarm (01:22.0), the rail joint (02:09.0) and the black (03:34.0) are
//      sample-exact and no reverb tail crosses an edit.
//   3. A reel's cue sheet is rendered in 12-second chunks, each a nested OfflineAudioContext holding
//      only the events that begin in it, all in parallel. Each chunk outputs a dry bus and the sends
//      of the two rooms; the chunks are summed in a fixed order and the two convolution reverbs run
//      once per reel, as FFT convolutions in JS (dsp.js), so that every render is bit-identical.
//   4. Mix: the reels are laid end to end under the dubbing mixer's fader (RIDE: the level of each
//      scene, moved at cuts), which draws the arc of the whole: a quiet film with a few full passages
//      (the first flight, the question, the held rise of the crossing) that stop under -20 LUFS
//      short-term, one crest at 02:46-02:52, and the long fall of the migration into dusk.
//   4b. The crossings between the worlds are passages, not switches: a common tone (THREAD, a voice
//      neither world owns) carried across each, pivot notes handed from one timbre to the other,
//      sends that move between the two rooms over 1.5-2 s, the outgoing ambience ringing past the
//      cut and the incoming one heard a moment before it, and from the first gold (02:22.0) the
//      butterfly's bells and air seeping into the human music. The two wakings (01:22.0, 02:09.0)
//      stay abrupt; only the dream's last note lingers under them.
//   5. Master: 18 Hz high-pass and a gentle high shelf (per reel, so that nothing rings into a
//      silence), gain so that the crest (the loudest three seconds) sits at -8 LUFS short-term, a
//      dynamic dip at 2.5-4 kHz that acts only where that band runs hot in the loudest passages,
//      a soft clipper for the first milliseconds of the drum, a zero-latency look-ahead
//      limiter under a -1.7 dBTP ceiling; then the measurements the script and the review ask for
//      (integrated loudness between -16 and -18 LUFS, the short-term cap before 02:42, the quietest
//      second of Act IV, the crest, a loudness range of at most 17 LU, the 150 Hz rule, true peak)
//      are taken from the finished mix, published in renderScore.stats, and a failed one is reported.
// Deterministic: seeded noise, no clocks. Instruments live in kit.js (Web Audio) and voices.js (JS).

import { createRng } from '../lib/random.js';
import { hz } from './synth.js';
import { createAssets } from './assets.js';
import * as V from './voices.js';
import { Stem, strings, glass, felt, drum, tones, beep, bed, shot, voice, qin, qinHarmonic, xiao, wing, bloop, tick, creak, bird, thud, thread, panTo, fader } from './kit.js';
import { biquad, filt, kHops, loudness, shortTerm, loudnessRange, energyAbove, bandBalance, sweepLowpass, presenceDip, softClip, limit, peakDb, truePeakDb, dbToGain, fftPlan, irSpectra, convolveInto } from './dsp.js';

const CREST_LUFS = -8;   // the film's loudest short-term moment (02:46-02:52); the integrated loudness follows from it (-16 to -18)
const CEILING_DB = -1.7;   // true peak (the limiter looks at the inter-sample points too)
const CLIP_KNEE = 0.66, CLIP_TOP = 1.0;   // soft clipper: linear below the knee, saturating toward the top
// The master's tilt: a gentle high shelf (about -2 dB from 6 kHz up: the air stays, the fizz goes),
// and a dynamic dip at 2.5-4 kHz that only acts in the loud passages (the ear's most sensitive band).
const SHELF = { f: 6000, q: 0.6, db: -2 };
const PRESENCE = { f: 3200, q: 1.1, threshold: -19.5, ratio: 2.5, maxDb: 3, attack: 0.012, release: 0.2 };
/** The master's settings, shared with tools/mix-suno.mjs so that version B is mastered like this score. */
export const MASTER = { crestLufs: CREST_LUFS, ceilingDb: CEILING_DB, clipKnee: CLIP_KNEE, clipTop: CLIP_TOP, shelf: SHELF, presence: PRESENCE };

// --------------------------------------------------------------------------------------- helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// The climax as a crest, not a shelf: the level of each two-second step of M8, and of M9 after it.
const M8_LEVEL = [1.78, 1.88, 1.84, 1.46, 1.46, 1.76, 1.64, 1.46], M9_LEVEL = 0.92;
/** The four notes of the theme. RISE is the butterfly's form, FALL the human's. */
const RISE = ['A4', 'B4', 'D5', 'F#5'], FALL = ['F#4', 'D4', 'B3', 'A3'];
const up = (note, oct = 1) => note.replace(/-?\d+$/, (d) => String(+d + oct));

/** BREATH: one inhale (1.6 s, the band rising) and one exhale (2.4 s, the band falling) around each peak. */
function breathing(S, dest, peaks, k, { cut = null } = {}) {
  const g = [], f = [];
  for (const T of peaks) {
    g.push([T - 1.6, 0], [T - 0.45, 1], [T - 0.04, 0.2], [T + 0.3, 0.75], [T + 2.3, 0]);
    f.push([T - 1.6, 470], [T - 0.1, 880], [T + 0.15, 760], [T + 2.39, 410]);
  }
  if (cut !== null) { while (g[g.length - 1][0] >= cut) g.pop(); g.push([cut, 0]); }
  bed(S, dest, { src: 'pink', gain: g, k, filters: [{ type: 'bandpass', f, q: 1.6 }], seed: 'breath' });
}
/** A FELT chord, rolled from the bottom. */
function chord(S, dest, notes, start, { gain = 0.1, roll = 0.035, decay = 3, soft = 0.65 } = {}) {
  notes.forEach((n, k) => felt(S, dest, { note: n, start: start + k * roll, gain: gain * (k === 0 && notes.length > 3 ? 0.42 : 1), decay, soft, cut: 1300, pan: -0.3 + 0.6 * (k / Math.max(1, notes.length - 1)) }));
}
/** One wingbeat of the hero butterfly: a down-stroke and a lighter up-stroke a sixth of a second later. */
function beat(S, dest, t, { size = 0.5, gain = 0.1, k = 0 } = {}) {
  wing(S, dest, { start: t, size, gain, v: k % 4, rate: 0.94 + 0.03 * (k % 5) });
  wing(S, dest, { start: t + 1 / 6, size, up: true, gain: gain * 0.5, v: (k + 2) % 4, rate: 0.97 + 0.03 * (k % 3) });
}
/**
 * SHEEN, the band of light, as sound: a breath of air, like silk drawn across paper. A slow swell of
 * soft, band-limited noise (no resonance, no sweep, nothing above about 5 kHz) with the fibre of the
 * paper in it, moving left to right with the band from t0 to t1, and gone soon after.
 */
function sheen(S, dest, t0, t1, { k = 0.05, from = -0.75, to = 0.75 } = {}) {
  const d = t1 - t0, env = [[t0, 0], [t0 + 0.45 * d, 0.7], [t0 + 0.75 * d, 1], [t1, 0.45], [t1 + 0.4 * d, 0]];
  const p = panTo(S, dest, [[t0, from], [t1, to]]);
  bed(S, p, { src: 'pink', gain: env, k, filters: [{ type: 'highpass', f: 300, q: 0.5 }, { type: 'lowpass', f: 2400, q: 0.5 }, { type: 'lowpass', f: 4800, q: 0.5 }], gust: { hz: 1.1, depth: 0.3 }, mono: true, seed: 'sheen' + t0 });
  bed(S, p, { src: 'leaves', gain: env, k: k * 0.45, filters: [{ type: 'highpass', f: 900 }, { type: 'lowpass', f: 4200, q: 0.5 }], mono: true, seed: 'fibre' + t0 });
}
/** The crowd's feet on one beat. */
const feet = (S, dest, t, surface, v, gain) => voice(S, dest, `steps:${surface}:${v}`, 0.6, () => V.steps(S.sr, { surface, count: surface === 'wet' ? 14 : 9, spread: surface === 'wet' ? 0.08 : 0.06, seed: surface + v }), t, { gain, kind: 'steps' });
/** A rail joint (two wheel-sets). */
const joint = (S, dest, t, hard, gain, o = {}) => voice(S, dest, `clack:${hard}`, 0.7, () => V.clack(S.sr, { hard, seed: 'clack' + hard }), t, { gain, kind: 'clack', ...o });
/** A slow raindrop at the butterfly's scale. */
const bigDrop = (S, dest, t, v, gain, o = {}) => voice(S, dest, `drop:${v}`, 1.4, () => V.slowDrop(S.sr, { seed: 'drop' + v, f: 360 + 45 * (v % 4), size: 0.4 + 0.15 * (v % 3), softImpact: t >= 120 && t <= 128.5 }), t, { gain, kind: 'drop', ...o });

const BIRD_A = [{ dt: 0, f: [3300, 4700], dur: 0.09 }, { dt: 0.14, f: [3400, 4900], dur: 0.09 }, { dt: 0.28, f: [3500, 5100], dur: 0.1 },
  { dt: 0.46, f: [5200, 4300], dur: 0.05, a: 0.8 }, { dt: 0.53, f: [5200, 4300], dur: 0.05, a: 0.8 }, { dt: 0.6, f: [5200, 4300], dur: 0.05, a: 0.8 }, { dt: 0.67, f: [5300, 4200], dur: 0.05, a: 0.7 }, { dt: 0.74, f: [5300, 4000], dur: 0.07, a: 0.6 }];
const BIRD_B = [{ dt: 0, f: [4300, 3100, 3300], dur: 0.16 }, { dt: 0.26, f: [4100, 2900, 3100], dur: 0.17 }, { dt: 0.56, f: [2800, 3600], dur: 0.07 }, { dt: 0.66, f: [2800, 3700], dur: 0.07 }, { dt: 0.76, f: [2900, 3900], dur: 0.09 }];
const BIRD_C = [{ dt: 0, f: [2100, 2500, 2300], dur: 0.22 }, { dt: 0.3, f: [2600, 2200], dur: 0.18 }, { dt: 0.58, f: [1900, 2700, 2500], dur: 0.26 }, { dt: 0.95, f: [3000, 2400], dur: 0.12, a: 0.7 }];
const GULL = [{ dt: 0, f: [1250, 1800, 1500], dur: 0.42 }, { dt: 0.55, f: [1350, 1900, 1250], dur: 0.55, a: 0.8 }];

// ============================================================================================
// REEL A  00:00.0 - 01:20.9   M1 Night, M2 Scales, M3 Emergence and flight, M4 The drop
// ============================================================================================
function musicA(S) {
  // ---- M1 Night (B yu): heavy, still, a held breath; tired, a little lonely, warm underneath. The
  // human theme on the QIN, one note per bar, plucked softly and straight (no slides, no wobble, a
  // short ring), held in a small warm frame: a soft STRINGS sixth beneath it from the first second,
  // FELT dyads rocking on the third beat of each bar, and the phrase coming to rest on D major (A3
  // over D3 F#3) on the sleeper's inhale. Bm, G, Bm, D: everything in the concrete room, short.
  const q = S.out({ pan: -0.12, dry: 0.9, room: 0.35 });
  [['F#4', 4.0, 0.74], ['D4', 8.0, 0.7], ['B3', 12.0, 0.7], ['A3', 16.0, 0.76]].forEach(([n, t, g], k) =>
    qin(S, q, { note: n, start: t, gain: g, t60: k === 3 ? 5 : 4.2, bright: 0.85, soft: 0.75, wobble: 0 }));
  // the frame: a sixth (D3 B3), then a third (D3 F#3) to which A3 is added as the phrase comes home;
  // it is carried across the match on black (00:26.0, the common tone A) and into the open air
  const pad = S.out({ dry: 0.85, room: [[24.9, 0.3], [26.8, 0]], air: [[24.9, 0.05], [26.8, 0.5]] });
  const PAD = { gain: 0.05, cut: [220, 760], voices: 5, detune: 7, vib: 2.5, bow: 0.12, width: 0.5 };
  strings(S, pad, { ...PAD, notes: ['D3'], env: [[0.5, 0], [2.5, 0.55], [8, 0.7], [16, 0.75], [24, 0.8], [26.2, 0.7], [29.5, 0]], seed: 'm1d' });
  strings(S, pad, { ...PAD, notes: ['B3'], env: [[0.5, 0], [2.5, 0.5], [8, 0.6], [11.0, 0.6], [12.4, 0]], seed: 'm1b' });
  strings(S, pad, { ...PAD, notes: ['F#3'], env: [[11.0, 0], [12.4, 0.6], [24, 0.7], [26.2, 0.6], [29.5, 0]], seed: 'm1f' });
  strings(S, pad, { ...PAD, notes: ['A3'], env: [[15.6, 0], [17.2, 0.55], [24, 0.65], [26.2, 0.6], [29.5, 0]], seed: 'm1a' });
  // the first sound, a soft B minor in the dark (00:01.0), then the rocking dyads
  const fm = S.out({ pan: 0.05, dry: 0.9, room: 0.3 });
  chord(S, fm, ['B2', 'F#3', 'D4'], 1.0, { gain: 0.06, roll: 0.14, decay: 4.5, soft: 0.8 });
  [[6.0, ['B3', 'D4'], 0.045], [8.0, ['G2'], 0.05], [10.0, ['G3', 'B3'], 0.045], [12.0, ['D3', 'F#3'], 0.045], [14.0, ['F#3', 'B3'], 0.04], [16.0, ['D3', 'F#3'], 0.05], [18.0, ['A3', 'D4'], 0.035]]
    .forEach(([t, n, g]) => chord(S, fm, n, t, { gain: g, roll: 0.06, decay: 4, soft: 0.8 }));

  // ★1 XIAO, for the first time: one note, A4, an octave above the qin's last. It swells with the
  // opening wings to its peak at 00:24.0, then (M2) thins to air over the scales. It is first heard in
  // the sleeper's room, and passes into the open air as the closing wing fills the frame (X1, 00:26.0).
  xiao(S, S.out({ pan: 0.1, dry: 0.75, room: [[24.9, 0.36], [26.8, 0]], air: [[24.9, 0], [26.8, 0.6]] }), { start: 22.4, seconds: 9.6, gain: 0.31, seed: 'first', notes: [{
    t: 22.4, note: 'A4', dur: 9.0, vibAt: 1.75, breath: 1.7, rel: 0.5,
    env: [[0, 0], [0.5, 0.2], [1.2, 0.6], [1.57, 1], [1.9, 0.8], [2.4, 0.7], [3.2, 0.58], [5.5, 0.45], [9, 0.3]],
    tone: [[0, 1], [3.6, 1], [5.4, 0.5], [7.6, 0.12], [9, 0]],
  }] });

  // ... and as the wings open on the inhale, a small warmth, like a light turned on in the room: the
  // butterfly's rising figure, A B D, in its own timbre (round glass, quiet), the D on the inhale.
  // (X1, 00:26.0: the common tone A is carried across the match on black by the strings above.)
  const light = S.out({ pan: 0.15, dry: 0.85, room: 0.3 });   // (still the concrete room: the prologue's tails are short)
  [[23.2, 'A5', 0.026], [23.6, 'B5', 0.024], [24.0, 'D6', 0.03]].forEach(([t, n, g]) => glass(S, light, { note: n, start: t, gain: g, decay: 1.8, index: 0.25, soft: 0.35 }));

  // ---- M2 Scales. The gust, 00:28.0-00:30.5: tiny GLASS ticks run left to right with the ruffle ...
  const r = createRng('gust'), HI = ['A6', 'B6', 'D7', 'F#7', 'A7', 'B7', 'D8'];
  const run = S.out({ dry: 0.85, air: 0.5 });
  for (let k = 0; k < 30; k++) {
    const x = k / 29, t = 28.0 + 2.5 * x + (r() - 0.5) * 0.03;
    glass(S, run, { note: HI[Math.min(6, Math.floor(r() * 3 + x * 4))], start: t, gain: 0.024 + 0.018 * r(), decay: 0.7, index: 0.6, pan: -0.9 + 1.8 * x });
  }
  // ... and the four words left standing are the butterfly's four notes, two octaves up
  [[29.2, 'A6', -0.35], [29.6, 'B6', -0.1], [30.1, 'D7', 0.15], [30.5, 'F#7', 0.4]].forEach(([t, n, pan]) => glass(S, run, { note: n, start: t, gain: 0.06, decay: 2.2, index: 0.8, pan }));
  // ... over a rising shimmer: a cluster of the scale above 3 kHz, which then holds with the letters,
  // breathes with the wing (peak 00:32.0) and is gone when they let go
  tones(S, S.out({ dry: 0.7, air: 0.7 }), {
    gain: 0.017, env: [[28.0, 0], [30.5, 0.7], [32.0, 1], [34.0, 0.9], [35.46, 1], [35.5, 0]],
    partials: [{ f: hz('A7'), beat: 1.3, pan: -0.6, trem: { rate: 3.1, depth: 0.5 } }, { f: hz('B7'), beat: 2.1, pan: 0.5, a: 0.75, trem: { rate: 4.3, depth: 0.6 } },
      { f: hz('D8'), beat: 1.7, pan: -0.2, a: 0.5, trem: { rate: 5.2, depth: 0.6 } }, { f: hz('F#8'), beat: 2.9, pan: 0.7, a: 0.2, trem: { rate: 6.7, depth: 0.7 } }, { f: hz('A8'), beat: 3.7, pan: -0.8, a: 0.07, trem: { rate: 7.9, depth: 0.7 } }],
  });
  // 00:32.0 a soft STRINGS dyad, A4 B4: the first two notes of the butterfly's theme, at once
  strings(S, S.out({ dry: 0.7, air: 0.7 }), { notes: ['A4', 'B4'], env: [[30.2, 0], [31.2, 0.45], [32.0, 1], [33.2, 0.6], [35.2, 0.25], [35.5, 0]], gain: 0.072, cut: [500, 2600], voices: 5, seed: 'dyad' });

  // ---- M3 Emergence (D gong). SHEEN, 00:41.0-00:44.0: a surface tilted into the light, the room
  // dissolving into morning. The band itself is a breath of air (effects); inside it, a warm bloom:
  // the ink room's last note, A, plucked on the qin as the speck settles (00:41.0), handed to the
  // butterfly's glass, rising through the shared scale as the band crosses (B, then D), each note
  // short and consonant with the tail before it, opening into the open air and into the xiao's A4
  // on the split. Discrete notes, no glide.
  qin(S, S.out({ pan: -0.35, dry: 0.85, room: 0.3, air: 0.15 }), { note: 'A4', start: 41.0, gain: 0.34, t60: 1.6, seconds: 2.5, bright: 0.8, soft: 0.8, wobble: 0 });
  [[42.0, 'B5', 0.05, 0.0, [0.25, 0.3]], [43.0, 'D6', 0.06, 0.35, [0.1, 0.55]]].forEach(([t, n, g, pan, [room, air]]) =>
    glass(S, S.out({ pan, dry: 0.8, room, air }), { note: n, start: t, gain: g, decay: 1.7, index: 0.3, soft: 0.3 }));
  // X2-X3, 00:40.0-00:44.0, the common tone: A, held from the scales into the desk's room, where the
  // qin takes it (00:41.0) and the SHEEN's bloom carries it to the xiao's A4 on the split, the first
  // note of the butterfly's theme. (Its envelope rises as the fader drops at 00:40.0.)
  thread(S, S.out({ pan: 0.05, dry: 0.8, room: [[39.4, 0], [40.8, 0.45]], air: [[39.4, 0.5], [40.8, 0.08]] }),
    { note: 'A4', gain: 0.024, env: [[38.0, 0], [39.6, 0.5], [40.4, 1], [41.0, 0.8], [41.8, 0]] });   // (it hands its A to the qin at 00:41.0)
  // XIAO states the butterfly's theme: A4 at the split, B4, D5, and F#5 at the first opening
  const x = S.out({ pan: 0.12, dry: 0.8, air: 0.55 });
  xiao(S, x, { gain: 0.36, seed: 'theme', seconds: 9.2, notes: [
    { t: 44.0, note: 'A4', dur: 1.8, vel: 0.62, breath: 1.4 }, { t: 46.0, note: 'B4', dur: 1.8, vel: 0.66 }, { t: 48.0, note: 'D5', dur: 2.8, vel: 0.68 }, { t: 51.0, note: 'F#5', dur: 1.5, vel: 0.62 },
  ] });
  // a warm bed fades in beneath it: STRINGS on D and A
  strings(S, S.out({ dry: 0.7, air: 0.6 }), { notes: ['D3', 'A3', 'D4'], env: [[45.0, 0], [48, 0.3], [52, 0.6], [57, 0.78], [59.5, 0.72], [62, 0.85], [65.0, 1], [67.5, 0.95], [70, 0.6], [73, 0.35], [75.5, 0]], gain: 0.075, cut: [300, 1900], seed: 'm3low' });
  strings(S, S.out({ dry: 0.6, air: 0.8 }), { notes: ['A5', 'D6'], env: [[59.5, 0], [61, 0.6], [63.5, 0.75], [65.0, 1], [67.5, 0.9], [70, 0.45], [74.5, 0]], gain: 0.042, cut: [1400, 6500], bow: 1.5, voices: 5, seed: 'm3air' });
  // 00:52.0 flight, in 12/8 over the beat. GLASS arpeggios on D F# A B: dew
  const dew = S.out({ dry: 0.8, air: 0.6 }), ra = createRng('dew');
  const PAT = [['D5', 'A5', 'F#5', 'B5', 'A5', 'F#5', 'D6', 'A5', 'F#5', 'B5', 'A5', 'D5'], ['D5', 'F#5', 'A5', 'D6', 'B5', 'A5', 'F#6', 'D6', 'A5', 'B5', 'A5', 'F#5']];
  for (let k = 0; k < 63; k++) {
    const t = 52 + k / 3, bar = Math.floor(k / 12), lv = t < 60 ? 0.6 : t < 64 ? 0.9 : t < 68 ? 1.15 : Math.max(0, 1 - (t - 68) / 5);
    if (k % 3 !== 0 && ra() < (t < 56 ? 0.45 : 0.22)) continue;
    glass(S, dew, { note: PAT[bar % 2][k % 12], start: t, gain: 0.032 * lv * (k % 3 === 0 ? 1.3 : 0.75 + 0.4 * ra()), decay: 1.8, index: 0.8, pan: (k % 2 ? 0.55 : -0.55) + (ra() - 0.5) * 0.4 });
    if (t >= 60 && ra() < 0.3) glass(S, dew, { note: up(PAT[(bar + 1) % 2][(k + 5) % 12]), start: t + 1 / 6, gain: 0.016 * lv, decay: 1.2, index: 0.6, pan: ra() * 1.6 - 0.8 });
  }
  // XIAO flies above: the theme quickened, then (out above the grass, 01:00) an octave higher,
  // reaching its top note, F#6, as the wings open on the flower at 01:05.0
  xiao(S, x, { gain: 0.225, seed: 'flight', seconds: 23, notes: [
    { t: 52 + 2 / 3, note: 'B4', dur: 1 / 3, vel: 0.64 }, { t: 53, note: 'D5', dur: 2 / 3, slur: true, vel: 0.68 }, { t: 53 + 2 / 3, note: 'F#5', dur: 1 / 3, slur: true, vel: 0.7 },
    { t: 54, note: 'A5', dur: 4 / 3, slur: true, vel: 0.76 }, { t: 55 + 1 / 3, note: 'F#5', dur: 1 / 3, slur: true, vel: 0.76 }, { t: 55 + 2 / 3, note: 'A5', dur: 1 / 3, slur: true, vel: 0.8 },
    { t: 56, note: 'B5', dur: 5 / 3, slur: true, vel: 0.92, flutter: 0.7 }, { t: 57 + 2 / 3, note: 'A5', dur: 0.28, slur: true, vel: 0.78 },
    { t: 58, note: 'F#5', dur: 0.95, vel: 0.78 }, { t: 59, note: 'D5', dur: 2 / 3, slur: true, vel: 0.76 }, { t: 59 + 2 / 3, note: 'F#5', dur: 0.28, slur: true, vel: 0.8 },
    { t: 60, note: 'A5', dur: 2 / 3, vel: 0.9 }, { t: 60 + 2 / 3, note: 'B5', dur: 1 / 3, slur: true, vel: 0.92 }, { t: 61, note: 'D6', dur: 2, slur: true, vel: 0.96 }, { t: 63, note: 'B5', dur: 0.85, slur: true, vel: 0.74 },
    { t: 64, note: 'A5', dur: 1 / 3, vel: 0.8 }, { t: 64 + 1 / 3, note: 'B5', dur: 1 / 3, slur: true, vel: 0.86 }, { t: 64 + 2 / 3, note: 'D6', dur: 1 / 3, slur: true, vel: 0.92 },
    { t: 65, note: 'F#6', dur: 2, slur: true, vel: 1 }, { t: 67, note: 'D6', dur: 1, slur: true, vel: 0.9 }, { t: 68, note: 'B5', dur: 0.9, slur: true, vel: 0.78 },
    { t: 69, note: 'A5', dur: 1.85, vel: 0.8 }, { t: 71, note: 'F#5', dur: 0.95, vel: 0.72 }, { t: 72, note: 'A5', dur: 2.7, vel: 0.7, breath: 1.6, tone: [[0, 1], [1.2, 0.8], [2.7, 0.2]], rel: 0.6 },
  ] });

  // ---- M4 The drop. Everything falls away to one GLASS note, F#6, trembling, once a second and slowing;
  // the fifth note never comes: in its place, at 01:20.5 ...
  const drop = S.out({ pan: 0.15, dry: 0.8, air: 0.7 });
  [[75.0, 1.25], [76.0, 0.95], [77.0, 0.8], [78.5, 0.66]].forEach(([t, a]) => glass(S, drop, { note: 'F#6', start: t, gain: 0.2 * a, decay: 3.2, index: 0.9, soft: 0.2, wob: { rate: 9, depth: 22, slow: 0.45 } }));
  // ... the blade's spring: a short upward QIN slide, the human instrument heard in the meadow for the first time
  qin(S, S.out({ pan: -0.1, dry: 0.9, air: 0.35 }), { note: 'D4', from: 'B3', start: 80.5, gain: 0.6, glide: 0.13, glideAt: 0.02, seconds: 0.5, t60: 0.7, bright: 1.5, soft: 0.2, wobble: 0 });
}

function ambienceA(S) {
  // ---- S01: the night city from far off. A room tone (band noise 180-600 Hz) from 00:01, with the
  // steady band of air-conditioning in it; it is the only thing that runs under the whole reel's ink.
  const far = S.out({ dry: 1, room: 0.3 });
  bed(S, far, { src: 'pink', gain: [[1.0, 0], [5, 0.7], [13.9, 1], [14.0, 0]], k: 0.045, filters: [{ type: 'bandpass', f: { wander: { seed: 'ac', min: 330, max: 350, hz: 0.05 } }, q: 0.8 }], gust: { hz: 0.08, depth: 0.15 }, seed: 'city' });   // steady: no moving resonance
  bed(S, far, { src: 'pink', gain: [[1.0, 0], [6, 1], [13.9, 1], [14.0, 0]], k: 0.018, filters: [{ type: 'bandpass', f: 760, q: 0.8 }, { type: 'lowpass', f: 1800 }], gust: { hz: 0.15, depth: 0.5 }, pan: { wander: { seed: 'cityp', min: -0.5, max: 0.5, hz: 0.05 } }, seed: 'city2' });
  // wet-paper hiss as the wash dilutes, 00:02-00:06
  const paper = S.out({ dry: 1, room: 0.15 });
  bed(S, paper, { src: 'fizz', gain: [[2.0, 0], [2.8, 1], [4.5, 0.7], [6.2, 0]], k: 0.05, filters: [{ type: 'highpass', f: 1500 }, { type: 'lowpass', f: 6500, q: 0.5 }], seed: 'wash1' });
  bed(S, paper, { src: 'white', gain: [[2.0, 0], [3.0, 1], [6.0, 0]], k: 0.004, filters: [{ type: 'bandpass', f: [[2, 2200], [6, 4200]], q: 0.7 }, { type: 'lowpass', f: 6000, q: 0.5 }], am: { hz: 25, depth: 0.5 }, seed: 'wash1b' });
  // the distant train, 00:07-00:13: a slow swell crossing right to left, with soft joints on the beat
  const train = panTo(S, S.out({ dry: 0.6, air: 0.5 }), [[7, 0.6], [13, -0.5]]);
  bed(S, train, { src: 'pink', gain: [[7.0, 0], [9.5, 1], [11, 0.9], [13.2, 0]], k: 0.05, filters: [{ type: 'bandpass', f: 420, q: 0.9 }, { type: 'lowpass', f: 900 }], gust: { hz: 0.5, depth: 0.3 }, mono: true, seed: 'fartrain' });
  [8, 9, 10, 11, 12].forEach((t, k) => joint(S, train, t, 0.2, 0.05 * [0.5, 0.9, 1, 0.8, 0.4][k], { lowpass: 900 }));

  // ---- S02: inside, close and dry. The room's own tone, the lamp's faint hum, BREATH. The lamp is a room
  // tone, not a note: two soft bands of noise near 240 and 480 Hz (its mains buzz), with no pitch to sit
  // under the music as a drone.
  const room = S.out({ dry: 1, room: 0.2 });
  bed(S, room, { src: 'pink', gain: [[14.0, 0], [14.04, 1], [26.0, 1], [26.5, 0]], k: 0.02, filters: [{ type: 'bandpass', f: 300, q: 0.8 }, { type: 'lowpass', f: 1200 }], seed: 'desk' });
  const lamp = (gain, seed) => { bed(S, room, { src: 'pink', gain, k: 0.022, filters: [{ type: 'bandpass', f: 240, q: 1.6 }], seed }); bed(S, room, { src: 'pink', gain, k: 0.01, filters: [{ type: 'bandpass', f: 480, q: 1.6 }], seed: seed + 'h' }); };
  lamp([[14.0, 0], [14.04, 1], [26.0, 1], [26.5, 0]], 'lamp');
  breathing(S, S.out({ pan: 0.08, dry: 1, room: 0.25 }), [16, 20, 24], 0.08, { cut: 26.0 });

  // ---- S03: the wing in macro. No room: a faint high air in which the scales can be heard. It comes in
  // under the push into the wing (X1), and its low air lingers into the lamplight of S04 (X2).
  bed(S, S.out({ dry: 1, air: 0.3 }), { src: 'white', gain: [[25.3, 0], [26.3, 1], [38, 0.8], [40.0, 0]], k: 0.0027, filters: [{ type: 'bandpass', f: 3800, q: 0.6 }, { type: 'lowpass', f: 6500, q: 0.5 }], gust: { hz: 0.3, depth: 0.5 }, seed: 'macro' });
  bed(S, S.out({ dry: 1 }), { src: 'pink', gain: [[25.4, 0], [26.2, 1], [39.6, 1], [40.5, 0]], k: 0.006, filters: [{ type: 'bandpass', f: 420, q: 0.7 }], seed: 'macro2' });

  // ---- S04: the desk again, the lamp, the breath (its next peak, 00:44.0, is the pupa's split).
  // During the SHEEN the lamp's hum simply fades under the band as the lamp becomes the sun, and the
  // room opens into morning air.
  bed(S, room, { src: 'pink', gain: [[39.4, 0], [40.04, 1], [41.5, 1], [44.0, 0]], k: 0.033, filters: [{ type: 'bandpass', f: 300, q: 0.8 }, { type: 'lowpass', f: 1200 }], seed: 'desk2' });
  lamp([[39.5, 0], [40.04, 1.3], [41.2, 1.3], [43.6, 0]], 'lamp2');
  breathing(S, S.out({ pan: 0.08, dry: 1, room: 0.25 }), [40, 44], 0.13, { cut: 44.0 });

  // ---- morning air, 00:41 on: wide, bright, moving
  const open = S.out({ dry: 1, air: 0.3 });
  const morning = [[41.0, 0], [44.0, 0.7], [52, 0.8], [60, 0.9], [61, 1.15], [72.9, 1], [79, 0.8], [80.9, 0.8]];
  bed(S, open, { src: 'pink', gain: morning, k: 0.08, filters: [{ type: 'bandpass', f: { wander: { seed: 'morn', min: 480, max: 1100, hz: 0.15 } }, q: 0.8 }], gust: { hz: 0.2, depth: 0.5 }, pan: { wander: { seed: 'mornp', min: -0.4, max: 0.4, hz: 0.1 } }, seed: 'morn' });
  bed(S, open, { src: 'white', gain: morning, k: 0.009, filters: [{ type: 'bandpass', f: 3600, q: 0.5 }, { type: 'lowpass', f: 7000, q: 0.5 }], gust: { hz: 0.25, depth: 0.5 }, seed: 'mornair' });
  bed(S, open, { src: 'leaves', gain: morning, k: 0.1, filters: [{ type: 'highpass', f: 1200 }, { type: 'lowpass', f: 6500, q: 0.5 }], gust: { hz: 0.3, depth: 0.8 }, seed: 'grass' });
  // S06: an insect hum, far off (it hums A)
  tones(S, S.out({ pan: 0.5, dry: 0.5, air: 0.6 }), { gain: 0.006, env: [[62.5, 0], [64, 1], [66, 0.4], [68.5, 1], [71, 0.3], [73, 0]], glide: [[62.5, 1], [66, 1.02], [69, 0.985], [73, 1.01]],
    partials: [{ f: 220, trem: { rate: 27, depth: 0.7 } }, { f: 440, a: 0.6, trem: { rate: 27, depth: 0.8 } }, { f: 660, a: 0.35, trem: { rate: 54, depth: 0.8 } }, { f: 880, a: 0.2, trem: { rate: 27, depth: 0.9 } }], kind: 'hum' });
}

function effectsA(S) {
  // ---- S02: the butterfly. Tiny flaps on an erratic path from the left; a soft tick on the glass at 00:20.0
  const fly = panTo(S, S.out({ dry: 0.9, room: 0.25 }), [[17.0, -0.95], [20.0, -0.22]]);
  [17.0, 17.33, 17.5, 17.83, 18.17, 18.33, 18.67, 19.0, 19.17, 19.5, 19.67, 19.83].forEach((t, k) => wing(S, fly, { start: t, size: 0.2, up: k % 3 === 1, gain: 0.05 + 0.06 * (k / 11), v: k % 4, rate: 1.05 + 0.04 * (k % 3) }));
  const pane = S.out({ pan: -0.22, dry: 1, room: 0.3 });
  tick(S, pane, { start: 20.0, f: 3100, tau: 0.004, gain: 0.09, noise: 0.5, hp: 2000 });
  wing(S, pane, { start: 20.17, size: 0.2, up: true, gain: 0.05, v: 1 });   // the wings shut

  // ---- S03 ★2 00:35.5: the wing beats, loud and close, and 9,500 letter scales scatter
  wing(S, S.out({ dry: 1, air: 0.35 }), { start: 35.5, size: 1, gain: 0.5, v: 9 });
  shot(S, S.out({ dry: 0.9, air: 0.5 }), 'scatter', 35.5, { gain: 0.26 });
  // the ruffle itself: a breath of noise crossing left to right, and the scales ticking as they lift
  bed(S, S.out({ dry: 1, air: 0.3 }), { src: 'white', gain: [[28.0, 0], [28.5, 1], [30.2, 0.8], [30.8, 0]], k: 0.017, filters: [{ type: 'bandpass', f: [[28, 2100], [30.5, 3600]], q: 1.1 }, { type: 'lowpass', f: 6500, q: 0.5 }], pan: [[28.0, -0.85], [30.5, 0.85]], am: { hz: 45, depth: 0.5 }, seed: 'ruffle' });
  bed(S, S.out({ dry: 1, air: 0.3 }), { src: 'fizz', gain: [[28.0, 0], [28.4, 1], [30.3, 0.9], [30.9, 0]], k: 0.12, filters: [{ type: 'lowpass', f: 7000, q: 0.5 }], pan: [[28.0, -0.85], [30.5, 0.85]], seed: 'ruffle2' });

  // the dust hangs in the lamplight (the match on bokeh into S04): a fine glitter, out of which the SHEEN rises
  bed(S, S.out({ dry: 0.8, air: 0.5 }), { src: 'glitter', gain: [[37.2, 0], [38.4, 1], [39.6, 1], [40.4, 1.55], [41.5, 1.55], [43.2, 0.6], [44.6, 0]], k: 0.52, filters: [{ type: 'lowpass', f: 5500, q: 0.5 }], seed: 'dust' });   // (it rides through the fader's drop at the cut)
  // ---- S04. 00:41.0 one grain settles on the shoulder: the speck (a soft glint, an octave above the
  // qin's A that begins the SHEEN's bloom). 00:41.0-00:44.0 the SHEEN itself: a breath of air, left to right.
  glass(S, S.out({ pan: 0.05, dry: 0.9, room: 0.3 }), { note: 'A5', start: 41.0, gain: 0.05, decay: 1.6, index: 0.35, soft: 0.15 });
  sheen(S, S.out({ dry: 0.8, room: [[41.0, 0.25], [43.2, 0]], air: [[41.0, 0.1], [43.2, 0.5]] }), 41.0, 44.0, { k: 0.1 });
  // 00:44.0 the pupa: a dry papery split, small creaks; 00:48-00:51 wet, soft unfolding
  const pupa = S.out({ pan: 0.05, dry: 1, air: 0.25 });
  shot(S, pupa, 'husk', 44.0, { gain: 0.24, lowpass: 6000 });
  const rc = createRng('fibres');
  for (let t = 44.6; t < 48.0; t += 0.45 + rc() * 0.8) {
    // 保留旧事件的四次随机取样，使后续湿翼展开的时间与随机序列不变。
    const draws = [rc(), rc(), rc(), rc()], dur = 0.09 + draws[1] * 0.16;
    voice(S, pupa, 'pupa-fibre:' + t, dur, () => {
      // 宽带微摩擦，没有明确音高、扫频或机械断续调制。
      const a = new Float32Array(Math.round(dur * S.sr)), rng = createRng('pupa-fibre:' + t);
      for (let i = 0; i < a.length; i++) a[i] = rng() * 2 - 1;
      filt(a, biquad('hp', 500, 0.6, S.sr));
      filt(a, biquad('lp', 3600, 0.6, S.sr));
      for (let i = 0; i < a.length; i++) a[i] *= Math.sin(Math.PI * i / (a.length - 1)) ** 2;
      return [a];
    }, t, { gain: 0.05, kind: 'creak' });
  }
  for (let t = 48.1; t < 51.0; t += 0.3 + rc() * 0.45) {
    bed(S, pupa, { src: 'pink', gain: [[t, 0], [t + 0.12, 1], [t + 0.34, 0]], k: 0.042, filters: [{ type: 'bandpass', f: [[t, 700], [t + 0.3, 1500 + 900 * rc()]], q: 1.4 }], pan: (rc() - 0.5) * 0.5, seed: 'unfold' + t.toFixed(2) });
    if (rc() < 0.6) bloop(S, pupa, { start: t + 0.05, f: 700 + rc() * 600, rise: 1.5, dur: 0.05, gain: 0.015 });
  }
  // the first bird, 00:44.5; others answer through the morning
  const perchA = S.out({ pan: -0.5, dry: 0.5, air: 0.8 }), perchB = S.out({ pan: 0.6, dry: 0.4, air: 0.8 });
  bird(S, perchA, { start: 44.5, syl: BIRD_A, gain: 0.04 });
  bird(S, perchB, { start: 47.3, syl: BIRD_B, gain: 0.03 });
  bird(S, perchA, { start: 49.6, syl: BIRD_A.slice(0, 5), gain: 0.028 });
  bird(S, perchB, { start: 61.4, syl: BIRD_B.slice(2), gain: 0.022 });
  bird(S, perchA, { start: 67.2, syl: BIRD_C, gain: 0.022 });
  bird(S, perchB, { start: 70.4, syl: BIRD_A.slice(0, 3), gain: 0.022 });
  bird(S, perchA, { start: 76.3, syl: BIRD_B.slice(0, 2), gain: 0.02 });
  // 00:51.0 the first slow opening; 00:52.0 the first wingbeat, and then WINGS in triplets, close to the microphone
  wing(S, S.out({ pan: 0.05, dry: 1, air: 0.3 }), { start: 51.0, size: 0.6, up: true, gain: 0.05, v: 2, rate: 0.8 });
  for (let k = 0; k < 34; k++) {
    const t = 52 + k / 3, away = t < 60 ? 1 : 1 - 0.5 * (t - 60) / 3.3;
    beat(S, S.out({ pan: 0.35 * Math.sin(k * 0.7), dry: 1, air: 0.25 + 0.4 * (1 - away) }), t, { size: 0.7, gain: 0.12 * away * (k % 3 === 0 ? 1.15 : 0.9), k });
  }
  // S05: grass blades passing, left and right
  const rg = createRng('blades');
  for (let t = 52.4, k = 0; t < 59.8; t += 0.5 + rg() * 0.7, k++) {
    const side = k % 2 ? 1 : -1;
    bed(S, S.out({ dry: 1, air: 0.2 }), { src: 'pink', gain: [[t, 0], [t + 0.13, 1], [t + 0.42, 0]], k: 0.07 * (0.6 + 0.6 * rg()), filters: [{ type: 'bandpass', f: [[t, 900], [t + 0.15, 2400 + 800 * rg()], [t + 0.42, 1100]], q: 1.3 }], pan: [[t, side * 0.15], [t + 0.42, side * 0.95]], seed: 'blade' + k });
  }
  // S06: it lands (01:03.5); the wings open and close on the breath; 01:06 the click of the proboscis
  const flower = S.out({ pan: 0.1, dry: 1, air: 0.3 });
  wing(S, flower, { start: 63.5, size: 0.5, up: true, gain: 0.06, v: 1 });
  [[65.0, 0.05], [67.0, 0.028], [69.0, 0.045], [71.0, 0.024], [73.0, 0.04]].forEach(([t, g], k) => wing(S, flower, { start: t, size: 0.6, up: k % 2 === 1, gain: g, v: k % 4, rate: 0.72 }));
  tick(S, flower, { start: 66.0, f: 5200, tau: 0.0012, gain: 0.03, noise: 0.4, hp: 3000 });
  // S07: 01:20.5 take-off, two quick beats flying off to the right (the blade's twang is the QIN's)
  wing(S, S.out({ pan: 0.2, dry: 1, air: 0.35 }), { start: 80.5, size: 0.6, gain: 0.13, v: 0 });
  wing(S, S.out({ pan: 0.5, dry: 0.8, air: 0.5 }), { start: 80.5 + 1 / 6, size: 0.4, up: true, gain: 0.08, v: 2 });
  wing(S, S.out({ pan: 0.75, dry: 0.6, air: 0.6 }), { start: 80.5 + 1 / 3, size: 0.3, gain: 0.05, v: 1 });
}

// ============================================================================================
// REEL B  01:22.0 - 02:09.0   M5 Weight, M6 Rain (to the rail joint)
// ============================================================================================
function musicB(S) {
  // ---- ★3 01:22.0 the alarm: four hard FM beeps on B5, the dew's glass made ugly
  const alarm = S.out({ pan: 0.3, dry: 1, room: 0.45 });
  S.as('sfx', () => [82.0, 82.5, 83.0, 83.5].forEach((t) => beep(S, alarm, { note: 'B5', start: t, dur: 0.16, gain: 0.13 })));   // (diegetic: the effects stem)
  // ... and under it, quietly, the dream lingers: the last note of the meadow, the drop's F#6, still
  // ringing in the open air for two seconds (the waking itself stays abrupt)
  thread(S, S.out({ pan: 0.15, dry: 0.55, air: 0.7 }), { note: 'F#6', gain: 0.02, env: [[82.0, 0], [82.06, 1], [82.6, 0.75], [83.3, 0.42], [84.3, 0]] });

  // ---- M5 Weight (B yu): Bm, G, Bm, F#m, 8 s each. FELT chords; QIN, the human theme, falling,
  // one note at the head of each scene. Close and dry. The chord under each theme note leaves that
  // note to the qin, which is plucked harder here than at night: the line is in front.
  const f = S.out({ pan: 0.1, dry: 0.9, room: 0.25 }), q = S.out({ pan: -0.15, dry: 1, room: 0.3 });
  chord(S, f, ['B2', 'F#3', 'B3', 'D4'], 84.0, { gain: 0.1 });
  chord(S, f, ['B3', 'D4'], 86.0, { gain: 0.07 });
  chord(S, f, ['B2', 'F#3', 'D4'], 88.0, { gain: 0.13 });
  chord(S, f, ['G2', 'D3', 'G3', 'B3'], 90.0, { gain: 0.06 });
  chord(S, f, ['G3', 'B3', 'D4', 'G4'], 94.0, { gain: 0.12 });
  chord(S, f, ['D3', 'G3', 'B3'], 96.0, { gain: 0.1 });
  chord(S, f, ['B2', 'F#3', 'D4', 'F#4'], 98.0, { gain: 0.08 });
  chord(S, f, ['B3', 'D4', 'F#4', 'B4'], 102.0, { gain: 0.125 });
  chord(S, f, ['F#2', 'C#3', 'F#3', 'C#4'], 106.0, { gain: 0.08 });
  chord(S, f, ['F#3', 'A3', 'C#4', 'F#4'], 110.0, { gain: 0.15 });
  [[92, ['G3', 'B3'], 0.09], [100, ['D4', 'F#4'], 0.088], [104, ['B3', 'D4'], 0.075], [108, ['A3', 'C#4'], 0.08], [112, ['F#3', 'A3'], 0.13]].forEach(([t, n, g]) => chord(S, f, n, t, { gain: g, roll: 0.05, soft: 0.75 }));
  qin(S, q, { note: 'F#4', from: 'G4', start: 86.0, gain: 0.72, glide: 0.3, t60: 6.5, bright: 1, soft: 0.6, attack: 0.008, wobble: 6 });       // the exhale
  qin(S, q, { note: 'D4', from: 'C#4', start: 90.0, gain: 0.56, glide: 0.2, t60: 6, bright: 1, soft: 0.6, attack: 0.008, wobble: 6 });      // the elevator starts down
  qin(S, q, { note: 'B3', from: 'C#4', start: 98.0, gain: 0.6, glide: 0.26, t60: 6.5, bright: 1, soft: 0.6, attack: 0.008, wobble: 6 });       // the footbridge
  qin(S, q, { note: 'A3', from: 'B3', start: 106.0, gain: 0.6, glide: 0.4, t60: 7, wobble: 8, bright: 1, soft: 0.6, attack: 0.008 });   // the train

  // X5, 01:54.0, the common tone: A, the human theme's last note (the qin's A3 at the train, inside the
  // F#m chord), held from the train's room into the open air under the leaf and handed to the xiao's A4
  // (its envelope dips as the fader rises at the cut, so it holds its level)
  thread(S, S.out({ pan: 0.1, dry: 0.8, room: [[113.0, 0.45], [115.0, 0]], air: [[113.0, 0.08], [115.0, 0.6]] }),
    { note: 'A4', gain: 0.034, env: [[112.0, 0], [113.7, 1], [114.3, 0.75], [115.2, 0.65], [117.0, 0]] });
  // ---- M6 Rain (which tonic? the bass alternates B and D every 4 s)
  const lo = S.out({ pan: 0.05, dry: 0.9, room: 0.2, air: 0.3 });
  [[114, 'B3'], [118, 'D4'], [122, 'B3'], [126, 'D4']].forEach(([t, n]) => felt(S, lo, { note: n, start: t, gain: 0.15, decay: 4, soft: 0.8 }));
  // XIAO fragments of its theme, each broken off (two of them by the drops)
  const x = S.out({ pan: 0.15, dry: 0.8, air: 0.5 });
  xiao(S, x, { gain: 0.3, seed: 'frag1', seconds: 2.6, notes: [{ t: 115, note: 'A4', dur: 2 / 3, vel: 0.6, breath: 1.5 }, { t: 115 + 2 / 3, note: 'B4', dur: 1 / 3, slur: true, vel: 0.62 }, { t: 116, note: 'D5', dur: 0.9, slur: true, vel: 0.6, tone: [[0, 1], [0.9, 0.3]], rel: 0.4 }] });
  xiao(S, x, { gain: 0.3, seed: 'frag2', seconds: 1.4, notes: [{ t: 117 + 1 / 3, note: 'A4', dur: 1 / 3, vel: 0.6, breath: 1.5 }, { t: 117 + 2 / 3, note: 'B4', dur: 1 / 3, slur: true, vel: 0.64 }, { t: 118, note: 'D5', dur: 0.48, slur: true, vel: 0.7, rel: 0.03 }] });
  xiao(S, x, { gain: 0.3, seed: 'frag3', seconds: 0.9, notes: [{ t: 119 + 1 / 3, note: 'B4', dur: 0.64, vel: 0.56, breath: 1.6, rel: 0.03 }] });
  xiao(S, x, { gain: 0.3, seed: 'frag4', seconds: 2.4, notes: [{ t: 123, note: 'D5', dur: 1.5, vel: 0.5, breath: 2.2, tone: [[0, 0.9], [1.5, 0.2]], rel: 0.5 }] });
  // QIN single notes, placed like drops
  const qd = S.out({ pan: -0.25, dry: 0.95, room: 0.25, air: 0.3 });
  qin(S, qd, { note: 'F#4', from: 'G4', start: 116.5, gain: 0.42, glide: 0.12, seconds: 3, t60: 2.5, wobble: 0 });
  qin(S, qd, { note: 'B3', start: 119.0, gain: 0.42, seconds: 3, t60: 2.5, wobble: 0 });
  qin(S, qd, { note: 'D4', from: 'C#4', start: 121.5, gain: 0.42, glide: 0.1, seconds: 3, t60: 2.5, wobble: 0 });
  qin(S, qd, { note: 'A3', start: 124.0, gain: 0.42, seconds: 3, t60: 2.5, wobble: 0 });
  // low STRINGS on B3 and D4 from 02:01, leaning on each in turn
  strings(S, S.out({ dry: 0.7, air: 0.6 }), { notes: ['B3'], env: [[121, 0], [123, 0.8], [125.5, 0.5], [128.2, 0.7], [129.1, 0.9]], gain: 0.08, cut: [300, 1500], seed: 'm6b' });
  strings(S, S.out({ dry: 0.7, air: 0.6 }), { notes: ['D4'], env: [[121.5, 0], [124, 0.4], [127, 0.9], [129.1, 1]], gain: 0.08, cut: [300, 1700], seed: 'm6d' });
  // 02:04.5-02:09.0 the corkscrew: a reversed swell of STRINGS and noise, rising, cut off by the rail joint (★4)
  const sw = S.out({ dry: 0.75, air: 0.7 });
  strings(S, sw, { notes: ['D4', 'F#4', 'A4', 'B4'], env: [[124.5, 0], [126.5, 0.12], [127.8, 0.34], [128.5, 0.62], [128.85, 0.86], [129.0, 1], [129.1, 1]], gain: 0.15, cut: [350, 4200], trem: { rate: 11, depth: 0.5 }, seed: 'cork' });
  strings(S, sw, { notes: ['D5', 'F#5', 'B5'], env: [[126, 0], [127.8, 0.25], [128.6, 0.6], [129.0, 1], [129.1, 1]], gain: 0.1, cut: [700, 6000], trem: { rate: 13, depth: 0.7 }, seed: 'cork2' });
  bed(S, sw, { src: 'white', gain: [[125.5, 0.01], [127, 0.06], [128, 0.2], [128.5, 0.42], [128.8, 0.68], [129.0, 1], [129.1, 1]], k: 0.11, filters: [{ type: 'highpass', f: 1500 }, { type: 'peaking', f: 2900, q: 3, gain: 4 }, { type: 'peaking', f: 4400, q: 3, gain: 3 }, { type: 'lowpass', f: 6500, q: 0.5 }], am: { hz: 50, depth: 0.25 }, seed: 'cork3' });
}

function ambienceB(S) {
  // ---- S08: the same room in a grey dawn. The lamp hums until its click at 01:28.0; then rain on the glass.
  const room = S.out({ dry: 1, room: 0.25 });
  bed(S, room, { src: 'pink', gain: [[82.0, 1], [89.96, 1], [90.0, 0]], k: 0.12, filters: [{ type: 'bandpass', f: 300, q: 0.8 }, { type: 'lowpass', f: 1400 }], seed: 'dawn' });
  tones(S, room, { gain: 0.018, env: [[82.0, 1], [87.99, 1], [88.0, 0]], partials: [{ f: hz('B3'), beat: 0.4 }, { f: hz('B4'), beat: 0.7, a: 0.45 }, { f: hz('F#5'), a: 0.1 }], kind: 'hum' });
  const pane = S.out({ dry: 1, room: 0.2 });
  bed(S, pane, { src: 'rainGlass', gain: [[88.0, 0], [88.4, 0.7], [89.96, 1], [90.0, 0]], k: 0.46, seed: 's08' });
  bed(S, pane, { src: 'rain', gain: [[88.0, 0], [88.5, 0.8], [89.96, 1], [90.0, 0]], k: 0.75, filters: [{ type: 'lowpass', f: 1500 }, { type: 'highpass', f: 250 }], seed: 's08w' });

  // ---- S09: the elevator. Its hum falls a fifth across the shot (D4 down to G3, the root under the QIN);
  // rain outside, heard through the wall.
  tones(S, S.out({ dry: 1, room: 0.4 }), { gain: 0.065, env: [[90.0, 0], [90.5, 1], [96.6, 1], [97.3, 0.5], [98.0, 0]], glide: [[90.0, 1], [97.0, 2 / 3], [98, 2 / 3]],
    partials: [{ f: hz('D4'), trem: { rate: 24, depth: 0.25 } }, { f: hz('D5'), a: 0.4, trem: { rate: 24, depth: 0.4 } }, { f: hz('D4') * 3, a: 0.18, trem: { rate: 48, depth: 0.5 } }, { f: hz('D4') * 4.02, a: 0.08 }], kind: 'hum' });
  bed(S, S.out({ dry: 1, room: 0.3 }), { src: 'pink', gain: [[90.0, 0], [90.3, 1], [97.96, 1], [98.0, 0]], k: 0.065, filters: [{ type: 'bandpass', f: [[90, 520], [97, 350]], q: 1.2 }], am: { hz: 16, depth: 0.2 }, seed: 'shaft' });
  bed(S, S.out({ dry: 1, room: 0.15 }), { src: 'rain', gain: [[90.0, 0.5], [96.5, 0.6], [97.96, 1.6], [98.0, 0]], k: 0.2, filters: [{ type: 'lowpass', f: [[90, 1300], [96.5, 1600], [98, 5500]] }, { type: 'highpass', f: 250 }], seed: 's09' });

  // ---- S10: the footbridge. Rain on sixty umbrellas, a dense patter; traffic hissing below.
  const street = S.out({ dry: 1, room: 0.2 });
  bed(S, street, { src: 'rainUmbrella', gain: [[98.0, 0], [98.05, 1], [105.96, 1], [106.0, 0]], k: 0.29, filters: [{ type: 'highpass', f: 280 }, { type: 'lowpass', f: 5500, q: 0.5 }], seed: 's10' });
  bed(S, street, { src: 'rain', gain: [[98.0, 0], [98.05, 1], [105.96, 1], [106.0, 0]], k: 0.034, filters: [{ type: 'highpass', f: 900 }, { type: 'lowpass', f: 6000, q: 0.5 }], seed: 's10b' });
  bed(S, street, { src: 'pink', gain: [[98.0, 0], [98.05, 1], [105.96, 1], [106.0, 0]], k: 0.05, filters: [{ type: 'bandpass', f: { wander: { seed: 'traffic', min: 600, max: 1500, hz: 0.35 } }, q: 0.9 }, { type: 'lowpass', f: 3200 }], gust: { hz: 0.45, depth: 0.75 }, pan: { wander: { seed: 'trafficp', min: -0.8, max: 0.8, hz: 0.3 } }, seed: 'traffic' });

  // ---- S11: inside the train. A low-mid rumble with a 180 Hz component; it thins as the head drops.
  const car = S.out({ dry: 1, room: 0.35 });
  const ride = [[106.0, 0], [106.05, 1], [109, 1], [113, 0.8], [114.0, 0.75], [114.35, 0]];
  bed(S, car, { src: 'brown', gain: ride, k: 0.2, filters: [{ type: 'lowpass', f: [[106, 520], [109, 520], [113, 330]] }, { type: 'highpass', f: 125 }, { type: 'peaking', f: 180, q: 3, gain: 6 }], gust: { hz: 0.4, depth: 0.3 }, seed: 'rumble' });
  bed(S, car, { src: 'pink', gain: ride, k: 0.095, filters: [{ type: 'bandpass', f: { wander: { seed: 'carair', min: 600, max: 1100, hz: 0.3 } }, q: 0.8 }, { type: 'lowpass', f: [[106, 3000], [109, 3000], [113, 1300]] }], gust: { hz: 0.5, depth: 0.4 }, seed: 'carair' });
  tones(S, S.out({ dry: 1, room: 0.5 }), { gain: 0.0035, env: [[106.0, 0], [106.05, 1], [109, 1], [113, 0.5], [114.0, 0.45], [114.35, 0]], glide: [[106, 1], [109, 1.03], [112, 0.98], [114.35, 1]],
    partials: [{ f: 1180, beat: 3, trem: { rate: 0.7, depth: 0.5 } }, { f: 2360, a: 0.3, trem: { rate: 1.1, depth: 0.6 } }, { f: 590, a: 0.5, beat: 2 }], kind: 'hum' });
  breathing(S, S.out({ pan: 0.25, dry: 1, room: 0.2 }), [112], 0.03, { cut: 114.0 });

  // ---- S12: the cut takes the rumble away (it rings a third of a second). Wind in the leaves, heard a
  // moment early under the train (through its room, then in the open air); the light falls.
  const open = S.out({ dry: 1, room: [[113.3, 0.25], [115.0, 0]], air: [[113.3, 0.05], [115.0, 0.3]] });
  const mead = [[113.3, 0], [114.06, 1.5], [116.5, 1.1], [121, 1.1], [124.5, 1], [128.5, 0.5], [129.1, 0.4]];
  bed(S, open, { src: 'leaves', gain: mead, k: 0.15, filters: [{ type: 'highpass', f: 1200 }, { type: 'lowpass', f: [[114, 5500], [124.5, 4000], [129, 1500]], q: 0.5 }], gust: { hz: 0.4, depth: 0.7 }, seed: 'dock' });
  bed(S, open, { src: 'pink', gain: mead, k: 0.11, filters: [{ type: 'bandpass', f: { wander: { seed: 'storm', min: 380, max: 900, hz: 0.25 } }, q: 0.8 }], gust: { hz: 0.3, depth: 0.6 }, pan: { wander: { seed: 'stormp', min: -0.5, max: 0.5, hz: 0.15 } }, seed: 'storm' });
  // ---- S13: the gathering drop hums with the train's rumble, which grows through the corkscrew
  bed(S, S.out({ pan: 0.1, dry: 1, air: 0.2 }), { src: 'brown', gain: [[122.5, 0], [124.5, 0.2], [127, 0.5], [128.6, 0.9], [129.1, 1]], k: 0.16, filters: [{ type: 'bandpass', f: 180, q: 5 }, { type: 'peaking', f: 360, q: 6, gain: 12 }, { type: 'highpass', f: 150 }], am: { hz: 12, depth: 0.3 }, seed: 'inthedrop' });
}

function effectsB(S) {
  // ---- ★3 01:22.0 the drop strikes the leaf, on the same sample as the alarm's first beep
  shot(S, S.out({ pan: -0.1, dry: 1, room: 0.3 }), 'splash', 82.0, { gain: 0.45 });
  // S08: the head snaps up (a sharp breath in), a chair creaks, cloth; one long exhale 01:24-01:27; the lamp's click
  const desk = S.out({ pan: 0.08, dry: 1, room: 0.3 });
  bed(S, desk, { src: 'pink', gain: [[82.05, 0], [82.3, 1], [82.6, 0]], k: 0.06, filters: [{ type: 'bandpass', f: [[82.05, 600], [82.5, 1200]], q: 1.5 }], seed: 'gasp' });
  creak(S, desk, { start: 84.2, dur: 0.5, f: [170, 120], ratio: 1.33, index: 3, stutter: [38, 20], band: [500, 1100], q: 3, gain: 0.05 });
  bed(S, desk, { src: 'leaves', gain: [[84.5, 0], [84.8, 1], [85.3, 0.4], [85.9, 0]], k: 0.05, filters: [{ type: 'bandpass', f: 1500, q: 0.7 }, { type: 'lowpass', f: 3500 }], seed: 'cloth' });
  bed(S, desk, { src: 'pink', gain: [[84.0, 0], [84.5, 1], [85.6, 0.7], [87.0, 0]], k: 0.25, filters: [{ type: 'bandpass', f: [[84, 820], [87, 400]], q: 1.5 }], seed: 'exhale' });
  tick(S, S.out({ pan: 0.3, dry: 1, room: 0.4 }), { start: 88.0, f: 1900, tau: 0.004, gain: 0.09, noise: 0.7, hp: 900 });
  // S09: floor ticks, one per floor (44 floors in 7 s)
  const shaft = S.out({ pan: -0.05, dry: 1, room: 0.5 });
  for (let k = 0; k < 44; k++) tick(S, shaft, { start: 90 + k * (7 / 44), f: 1250 - k * 6, tau: 0.003, gain: 0.032 + (k % 4 === 0 ? 0.014 : 0), noise: 0.4, hp: 800 });
  thud(S, shaft, { start: 97.0, f: [210, 160], glide: 0.2, env: [[97.0, 0], [97.01, 1], [97.3, 0]], gain: 0.05 });   // it arrives
  // S10: footsteps in near-unison on every beat (the walking pulse of M5)
  const walk = S.out({ dry: 1, room: 0.3 });
  for (let t = 98; t < 106; t++) feet(S, walk, t, 'wet', t % 4, t % 2 ? 0.2 : 0.27);
  // S11: the wheels take over the pulse, in two: a pair of joints on every beat; handles creak
  const rails = S.out({ dry: 1, room: 0.4 });
  for (let t = 106; t < 114; t++) joint(S, rails, t, 0.5, (t % 2 ? 0.14 : 0.2) * (t < 110 ? 1 : 0.8));
  const rh = createRng('handles');
  for (let t = 106.7; t < 113.3; t += 0.9 + rh() * 1.4) creak(S, S.out({ pan: rh() * 1.2 - 0.6, dry: 1, room: 0.4 }), { start: t, dur: 0.25 + rh() * 0.2, f: [240 + rh() * 80, 200], ratio: 1.41, index: 3, stutter: [45, 25], band: [900, 1900], q: 4, gain: 0.025 });
  creak(S, S.out({ pan: -0.3, dry: 1, room: 0.4 }), { start: 113.5, dur: 0.45, f: [200, 150], ratio: 1.41, index: 4, stutter: [40, 18], band: [700, 1500], q: 3, gain: 0.06 });   // all seven lean left

  // S12: the first thunder, far off; then the first drops, in slow motion: a deep bloop and a leaf slap
  shot(S, S.out({ pan: 0.4, dry: 0.5, air: 0.7 }), 'thunder', 115.5, { gain: 0.25, lowpass: 700, highpass: 140 });
  const rain = (pan, air = 0.5) => S.out({ pan, dry: 0.9, air });
  bigDrop(S, rain(0.3), 118.5, 0, 0.16);
  bigDrop(S, rain(-0.35), 120.0, 1, 0.18);
  bed(S, rain(-0.35, 0.3), { src: 'pink', gain: [[120.02, 0], [120.1, 1], [120.4, 0]], k: 0.03, filters: [{ type: 'bandpass', f: [[120, 2600], [120.4, 700]], q: 1.4 }], pan: [[120, -0.35], [120.4, -0.7]], seed: 'whip' });   // the blade whips down
  // S13: slow rain all round, each impact distinct; 02:02.0 one clips the wing: a small tearing tick
  [[121.5, -0.7, 2, 0.08], [122.5, 0.6, 3, 0.1], [123.5, -0.2, 4, 0.07], [124.0, 0.8, 5, 0.09], [125.0, -0.5, 6, 0.11], [125.5, 0.25, 7, 0.07], [126.5, -0.85, 8, 0.09], [127.0, 0.5, 9, 0.08], [127.5, -0.1, 10, 0.07], [128.0, 0.75, 11, 0.07], [128.5, -0.55, 12, 0.06]]
    .forEach(([t, pan, v, g]) => bigDrop(S, rain(pan), t, v, g * 1.4, t > 126 ? { lowpass: 2500 } : {}));
  const wingOut = S.out({ pan: 0.12, dry: 1, air: 0.3 });
  bigDrop(S, wingOut, 122.0, 13, 0.13, { highpass: 300 });
  tick(S, wingOut, { start: 122.0, f: 4200, tau: 0.002, gain: 0.07, noise: 1.2, hp: 2500 });
  creak(S, wingOut, { start: 122.0, dur: 0.09, f: [900, 600], ratio: 1.9, index: 5, stutter: [140, 90], band: [2500, 4500], q: 3, gain: 0.05 });
  wing(S, wingOut, { start: 122.2, size: 0.4, up: true, gain: 0.06, v: 3 });   // the wings clamp shut
}

// ============================================================================================
// REEL C  02:09.0 - 03:34.0   M6 (the train), M7 Gathering, M8 物化, M9 Migration, M10 Dusk
// ============================================================================================
function musicC(S) {
  // ---- ★4 the second waking is abrupt, but the dream lingers under it: F#5, the top of the swell
  // that the joint cut off (and the note both themes share), rings on for two seconds and passes
  // from the open air into the car's concrete room
  thread(S, S.out({ pan: 0.12, dry: 0.6, room: [[129.4, 0], [131.2, 0.45]], air: [[129.4, 0.65], [131.2, 0.1]] }), { note: 'F#5', gain: 0.027, env: [[129.0, 0], [129.06, 1], [129.8, 0.7], [130.8, 0.38], [131.9, 0]] });
  // ---- M6, after the joint: the train pulse alone under a held D4 and B4: both tonics, neither.
  // At the first gold (02:22.0) it opens from the car's room into the air.
  strings(S, S.out({ dry: 0.8, room: [[141.2, 0.4], [143.2, 0.2]], air: [[141.2, 0], [143.2, 0.35]] }), { notes: ['D4', 'B4'], env: [[129.4, 0], [131.5, 0.8], [137, 0.7], [140, 0.55], [142.0, 0.7], [144.5, 0]], gain: 0.09, cut: [320, 1800], voices: 5, seed: 'held' });
  const lo = S.out({ pan: 0.05, dry: 0.8, room: 0.4, air: 0.2 });
  [[130, 'B3'], [134, 'D4'], [138, 'B3']].forEach(([t, n]) => felt(S, lo, { note: n, start: t, gain: 0.14, decay: 4, soft: 0.8 }));
  // ---- 02:22.0 the gold: D, F#, A and B together, softly: the chord that is both Bm7 and D6
  const gold = S.out({ dry: 0.75, air: 0.7 });
  chord(S, gold, ['D4', 'F#4', 'A4', 'B4'], 142.0, { gain: 0.088, roll: 0.07, decay: 4.5, soft: 0.6 });
  strings(S, gold, { notes: ['D4', 'F#4', 'A4', 'B4'], env: [[141.6, 0], [142.4, 0.8], [143.5, 1], [146, 0.6], [148.5, 0]], gain: 0.05, cut: [400, 2600], seed: 'gold' });
  glass(S, gold, { note: 'F#6', start: 142.0, gain: 0.03, decay: 4, index: 0.7, pan: 0.3, soft: 0.3 });

  // ---- M7 Gathering (B and D together). QIN ostinato A3 B3 D4, a three-beat figure over steps in two,
  // growing; the last D4 falls on the beat before the fold. From the first gold the butterfly's world
  // seeps into the human music, so that 02:42.0 is an arrival and not a switch: the qin moves slowly
  // out of the concrete room into the open air, and GLASS begins to double it, here and there, then
  // more often, two octaves up (to the right, the side the butterfly's line will take in M8).
  const q = S.out({ pan: -0.2, dry: 0.85, room: [[144, 0.45], [160, 0.22]], air: [[144, 0.2], [160, 0.55]] });
  const seep = S.out({ pan: 0.3, dry: 0.7, air: 0.8 });
  [[147, 'A5', 0.011], [150, 'A5', 0.014], [152, 'D6', 0.013], [153, 'A5', 0.017], [154, 'B5', 0.014], [155, 'D6', 0.02]]
    .forEach(([t, n, g], k) => glass(S, seep, { note: n, start: t, gain: g, decay: 3, index: 0.7, pan: 0.15 * (k % 2 ? 1 : -1), soft: 0.25 }));
  const OST = ['A3', 'B3', 'D4'];
  for (let t = 144; t <= 158; t++) {
    const k = t - 144, lv = 0.72 + 0.28 * (k / 14);
    qin(S, q, { note: OST[k % 3], start: t, gain: 0.52 * lv, seconds: 2.6, t60: 2.2, wobble: 0, bright: 0.9 + 0.4 * lv, soft: 0.5 - 0.2 * lv });
    if (t >= 152 && k % 3 === 0) felt(S, S.out({ pan: 0.15, dry: 0.85, room: 0.3, air: 0.3 }), { note: 'A2', start: t, gain: 0.13 * lv, decay: 3, soft: 0.6 });
  }
  // STRINGS grow underneath: the drone of B and D, then the rest of the chord, opening as the rain stops
  const st = S.out({ dry: 0.75, room: [[146, 0.25], [158, 0.1]], air: [[146, 0.45], [158, 0.62]] });
  strings(S, st, { notes: ['B3', 'D4'], env: [[144, 0], [146, 0.5], [152, 0.68], [156, 0.78], [158.3, 0.84], [158.5, 0.78], [158.9, 0]], gain: 0.11, cut: [300, 2000], seed: 'm7a' });
  strings(S, st, { notes: ['F#4', 'A4'], env: [[146, 0], [150, 0.45], [156, 0.7], [158.3, 0.8], [158.5, 0.74], [158.9, 0]], gain: 0.1, cut: [400, 2600], seed: 'm7b' });
  strings(S, st, { notes: ['B4', 'D5', 'F#5'], env: [[152, 0], [156, 0.45], [158.3, 0.66], [158.5, 0.6], [158.9, 0]], gain: 0.068, cut: [600, 3600], seed: 'm7c' });
  strings(S, st, { notes: ['B2'], env: [[150, 0], [154, 0.55], [158.3, 0.7], [158.5, 0.62], [158.9, 0]], gain: 0.08, cut: [220, 900], seed: 'm7d' });
  // WINGS in three against the steps in two, very soft at first
  for (let k = 0; k < 37; k++) {
    const t = 146 + k / 3, lv = 0.25 + 0.75 * (k / 36);
    wing(S, S.out({ pan: 0.5 * Math.sin(k * 1.9), dry: 0.7, air: 0.6 }), { start: t, size: 0.35, up: k % 3 !== 0, gain: 0.05 * lv * (k % 3 === 0 ? 1.2 : 0.8), v: k % 4, rate: 1 + 0.05 * (k % 3) });
  }
  // the umbrellas open: soft DRUM taps at 02:28.0, 29.0, 30.0 and (the hero's) 31.0
  const taps = S.out({ dry: 1, room: 0.35 });
  S.as('sfx', () => [[148, 0.12], [149, 0.125], [150, 0.13], [151, 0.17]].forEach(([t, g]) => drum(S, taps, { start: t, gain: g, tap: 0.8 })));   // (they are the umbrellas' thumps: effects stem)
  // 02:36.0 the rain stops and the mix opens: light on the wet road
  [[156.0, 'A5', -0.4], [157.0, 'D6', 0.4], [158.0, 'F#6', 0]].forEach(([t, n, pan]) => glass(S, S.out({ dry: 0.7, air: 0.8 }), { note: n, start: t, gain: 0.045, decay: 3.5, index: 0.8, pan, soft: 0.2 }));
  // 02:38.5 the fold: everything drops to one high STRINGS harmonic, F#6. 02:41-02:42 that note alone.
  // It is held into the arrival, F# under the qin's F#4: the one note both themes share.
  strings(S, S.out({ dry: 0.7, air: 0.6 }), { notes: ['F#6'], env: [[156.5, 0], [158.5, 0.55], [159.5, 0.5], [161, 0.34], [162.0, 0.3], [162.6, 0.22], [163.8, 0]], gain: 0.01, cut: [2200, 5200], voices: 3, detune: 5, vib: 3, bow: 0.3, seed: 'harm' });

  // ---- M8 物化 (D6 = Bm7, full). ★5 02:42.0: DRUM, and both themes at once in contrary motion, a note
  // every 2 s. XIAO, GLASS and high STRINGS rise, to the right; QIN, FELT and low STRINGS fall, to the
  // left. The two lines are the harmony: (F#, A) (D, B) (B, D) (A, F#), a palindrome; each note lingers
  // under the next, and nothing else is held but a drone on D and A, so both lines can be followed.
  // The crest is the ring reaching the lens (02:46-02:52); then (S19) the rising line goes on up an
  // octave, the falling line sinks, and the whole opens out and eases.
  const drums = S.out({ dry: 1, air: 0.4 });
  [[162, 0.42, 1], [164, 0.3, 0], [166, 0.32, 0], [168, 0.34, 0], [170, 0.32, 1], [172, 0.3, 0], [174, 0.23, 0], [176, 0.18, 0]].forEach(([t, g, deep]) => drum(S, drums, { start: t, gain: g, deep }));
  const xo = S.out({ pan: 0.3, dry: 0.8, air: 0.6 }), qo = S.out({ pan: -0.3, dry: 1, room: 0.2, air: 0.25 }), fo = S.out({ pan: -0.2, dry: 0.85, air: 0.3 });
  const hi = S.out({ pan: 0.25, dry: 0.75, air: 0.6 }), low = S.out({ pan: -0.25, dry: 0.85, air: 0.4 }), bells = S.out({ dry: 0.75, air: 0.8 });
  xiao(S, xo, { gain: 0.5, seed: 'm8', seconds: 16.6, notes: [
    { t: 162, note: 'A4', dur: 1.9, vel: 0.86 }, { t: 164, note: 'B4', dur: 1.9, vel: 0.92 }, { t: 166, note: 'D5', dur: 1.9, vel: 0.98 }, { t: 168, note: 'F#5', dur: 1.9, vel: 1, flutter: 0.4 },
    { t: 170, note: 'A5', dur: 1.9, vel: 1 }, { t: 172, note: 'B5', dur: 1.9, vel: 0.92 }, { t: 174, note: 'D6', dur: 1.9, vel: 0.82 }, { t: 176, note: 'F#6', dur: 2.2, vel: 0.7, flutter: 0.3, rel: 0.5 },
  ] });
  for (let k = 0; k < 8; k++) {
    const t = 162 + 2 * k, second = k >= 4, rise = second ? up(RISE[k - 4]) : RISE[k], fall = FALL[k % 4], lv = M8_LEVEL[k];
    const env = [[t - 0.04, 0], [t + 0.22, 1], [t + 1.8, 0.85], [t + 2.3, 0.42], [t + 4.2, 0]];
    strings(S, hi, { notes: [rise], env, gain: 0.1 * lv, cut: [900, 5200], width: 0.6, seed: 'm8hi' });
    strings(S, hi, { notes: [up(rise)], env, gain: 0.06 * lv, cut: [800, 3800], width: 0.6, seed: 'm8hi8' });   // its octave, under it
    strings(S, low, { notes: [up(fall, -1)], env, gain: 0.095 * lv, cut: [300, 2200], width: 0.6, seed: 'm8lo' });   // an octave under the qin: the pitch itself is the qin's
    if (second) strings(S, low, { notes: [up(fall, -2)], env, gain: 0.05 * lv, cut: [200, 900], voices: 5, seed: 'm8sub2' });
    qin(S, qo, { note: fall, from: ['G4', 'C#4', 'C#4', 'B3'][k % 4], start: t, gain: 0.82 * lv, glide: 0.09, seconds: 4.5, t60: 5, bright: 1.7, soft: 0.15, wobble: 8 });
    qin(S, qo, { note: up(fall, -1), start: t, gain: 0.42 * lv, seconds: 4.5, t60: 4.5, bright: 1.4, soft: 0.25, wobble: 0 });
    felt(S, fo, { note: fall, start: t, gain: 0.16 * lv, decay: 3, soft: 0.35, cut: 2400 });
    felt(S, fo, { note: up(fall, -1), start: t, gain: (second ? 0.1 : 0.16) * lv, decay: 3.5, soft: 0.35, cut: 2400 });
    glass(S, bells, { note: up(rise), start: t, gain: 0.07 * lv, decay: 4.5, index: 1.2, pan: 0.3 });
    glass(S, bells, { note: up(rise, second ? 1 : 2), start: t, gain: 0.02 * lv, decay: 3, index: 0.8, pan: -0.2 });
  }
  // the drone under the two lines: D and A
  strings(S, S.out({ dry: 0.8, air: 0.5 }), { notes: ['D3', 'A3'], env: [[161.97, 0], [162.12, 0.8], [168, 1], [172, 1], [176, 0.7], [178, 0.4], [178.8, 0]], gain: 0.075, cut: [360, 3000], seed: 'm8ch' });
  strings(S, S.out({ dry: 0.9, air: 0.2 }), { notes: ['D2'], env: [[161.97, 0], [162.2, 0.8], [170, 1], [176, 0.6], [179, 0]], gain: 0.03, cut: [160, 700], seed: 'm8sub' });
  // S19: the windows flash floor by floor, 02:51-02:55: a rising run of GLASS
  const SC = ['D5', 'F#5', 'A5', 'B5', 'D6', 'F#6', 'A6', 'B6', 'D7', 'F#7', 'A7', 'B7'];
  for (let k = 0; k < 24; k++) glass(S, bells, { note: SC[Math.min(11, Math.floor(k / 2) + (k % 2 ? 2 : 0))], start: 171 + k / 6, gain: 0.03 + 0.012 * (k / 23), decay: 1.6, index: 0.9, pan: -0.8 + 1.6 * (k / 23) });

  // X10, 02:58.0, the pivot: the rising line ended on F#6 (02:56.0); the falling line will begin on
  // F#5 (03:00.0). A thread of F# is carried across the cut into the field and handed to it.
  thread(S, S.out({ pan: 0.2, dry: 0.7, air: 0.7 }), { note: 'F#5', gain: 0.035, env: [[176.5, 0], [178.0, 0.8], [179.4, 1], [180.2, 0.7], [182.0, 0]] });
  // ---- M9 Migration (D, then B). Out of the canyon into open air: the weight is gone at the cut. The
  // instruments exchange themes: QIN, forward and nearly alone, plays the rising form; XIAO, far off,
  // the falling form above it. No drum after the first bar. Everything recedes toward the dusk, so
  // that wings and wind are what is left; STRINGS thin to a held A.
  const q9 = S.out({ pan: -0.2, dry: 1, room: 0.15, air: 0.3 });
  [['A3', 'G3', 179, 1.0], ['B3', 'A3', 181, 0.9], ['D4', 'B3', 183, 0.78], ['F#4', 'F4', 185, 0.62]].forEach(([n, from, t, g], k) => {
    qin(S, q9, { note: n, from, start: t, gain: g * M9_LEVEL, glide: 0.18, seconds: 6, t60: 6, bright: 1.1, soft: 0.55, attack: 0.01, wobble: 6 });
    if (k < 3) qin(S, q9, { note: up(n, -1), start: t, gain: 0.4 * g * M9_LEVEL, seconds: 4.5, t60: 4, bright: 1.2, wobble: 0 });
  });
  xiao(S, S.out({ pan: 0.22, dry: 0.65, air: 0.85 }), { gain: 0.26 * M9_LEVEL, seed: 'm9', seconds: 9.8, notes: [
    { t: 180, note: 'F#5', dur: 1.9, vel: 0.86 }, { t: 182, note: 'D5', dur: 1.9, vel: 0.7 }, { t: 184, note: 'B4', dur: 1.9, vel: 0.56 }, { t: 186, note: 'A4', dur: 3.4, vel: 0.46, breath: 1.6, rel: 0.8 },
  ] });
  const s9 = S.out({ dry: 0.75, air: 0.6 });
  strings(S, s9, { notes: ['D3'], env: [[177.8, 0], [178.3, 1], [181, 0.7], [184, 0.4], [187, 0]], gain: 0.09 * M9_LEVEL, cut: [300, 1800], seed: 'm9a' });
  strings(S, s9, { notes: ['B2', 'F#3'], env: [[185.6, 0], [187, 0.6], [189.5, 0.35], [191.9, 0]], gain: 0.07 * M9_LEVEL, cut: [260, 1500], seed: 'm9b' });
  strings(S, s9, { notes: ['A4', 'A5'], env: [[177.8, 0], [178.4, 1], [181, 0.75], [185, 0.55], [189, 0.45], [192, 0.36], [195, 0]], gain: 0.085 * M9_LEVEL, cut: [700, 4600], bow: 1.3, seed: 'm9c' });
  drum(S, drums, { start: 178, gain: 0.3 * M9_LEVEL, deep: 0 });
  [[178.0, 'D6', 0.2, 0.07], [182.0, 'A5', -0.3, 0.03], [186.0, 'B5', 0.3, 0.02], [189.0, 'F#6', -0.2, 0.012]].forEach(([t, n, pan, g]) => glass(S, bells, { note: n, start: t, gain: g * M9_LEVEL, decay: 4.5, index: 0.9, pan, soft: 0.2 }));

  // ---- M10 Dusk (B, bare). XIAO: one breathy A4 with each wing-breath (03:15.0, 03:19.5, 03:24.5),
  // each smaller; at 03:30.0 only breath, no pitch. QIN harmonics on F#5 and B5 between them.
  const xd = S.out({ pan: 0.12, dry: 0.75, air: 0.7 });
  [[195.0, 0.62, 0.8], [199.5, 0.5, 0.7], [204.5, 0.38, 0.55], [210.0, 0.4, 0]].forEach(([t, v, tn], k) => xiao(S, xd, { gain: 0.42, seed: 'dusk' + k, start: t - 1.3, seconds: 3.6, notes: [{
    t: t - 1.3, note: 'A4', dur: 2.9, breath: 2.4 + 0.5 * k, vibAt: 1.5, vib: 0.7, tone: tn, rel: 0.5,
    env: [[0, 0], [0.5, v * 0.3], [1.3, v], [2.0, v * 0.55], [2.9, v * 0.25]],
  }] }));
  const hq = S.out({ pan: -0.2, dry: 0.8, air: 0.7 });
  qinHarmonic(S, hq, { note: 'F#5', start: 197.0, gain: 0.12 });
  qinHarmonic(S, hq, { note: 'B5', start: 201.5, gain: 0.1 });
  qinHarmonic(S, hq, { note: 'F#5', start: 207.0, gain: 0.08 });
}

function ambienceC(S) {
  // ---- S14: the train, from inside the tunnel. At 02:12.0 the roar opens out into rain and air.
  const car = S.out({ dry: 1, room: 0.4 });
  const ride = [[129.0, 0.85], [130, 0.7], [132.0, 0.7], [132.6, 0.45], [137.96, 0.42], [138.0, 0]];
  bed(S, car, { src: 'brown', gain: ride, k: 0.11, filters: [{ type: 'lowpass', f: [[129, 520], [132, 520], [132.6, 380]] }, { type: 'highpass', f: 95 }, { type: 'peaking', f: 180, q: 3, gain: 6 }], gust: { hz: 0.4, depth: 0.3 }, seed: 'rumble2' });
  bed(S, car, { src: 'pink', gain: [[129.0, 0.85], [130, 0.7], [131.9, 0.7], [132.05, 1.2], [132.6, 0.3], [137.96, 0.3], [138.0, 0]], k: 0.035, filters: [{ type: 'bandpass', f: [[129, 800], [131.9, 900], [132.1, 1600], [132.6, 700]], q: 0.8 }], gust: { hz: 0.5, depth: 0.4 }, seed: 'tunnel' });
  tones(S, S.out({ dry: 1, room: 0.5 }), { gain: 0.0035, env: [[129.0, 1], [132, 1], [132.6, 0.5], [137.96, 0.5], [138.0, 0]], glide: [[129, 1.02], [132, 1], [136, 0.94], [138, 0.92]],
    partials: [{ f: 1180, beat: 3, trem: { rate: 0.7, depth: 0.5 } }, { f: 2360, a: 0.3, trem: { rate: 1.1, depth: 0.6 } }, { f: 590, a: 0.5, beat: 2 }], kind: 'hum' });
  const day = S.out({ dry: 1, room: 0.15, air: 0.2 });
  bed(S, day, { src: 'rainGlass', gain: [[132.0, 0], [132.6, 1], [137.96, 1], [138.0, 0]], k: 0.1, pan: 0.2, seed: 's14' });
  bed(S, day, { src: 'rain', gain: [[132.0, 0], [132.6, 1], [137.96, 1], [138.0, 0]], k: 0.14, filters: [{ type: 'lowpass', f: 2600 }, { type: 'highpass', f: 300 }], seed: 's14w' });
  bed(S, day, { src: 'pink', gain: [[132.0, 0], [132.5, 1], [137.96, 1], [138.0, 0]], k: 0.03, filters: [{ type: 'bandpass', f: 900, q: 0.6 }], gust: { hz: 0.3, depth: 0.4 }, seed: 's14air' });

  // ---- S15: wide and distant. The train on the bridge; the rain thins.
  const wide = S.out({ dry: 1, air: 0.35 });
  bed(S, wide, { src: 'rain', gain: [[138.0, 0], [138.05, 1], [141, 0.6], [143.96, 0.35], [144.0, 0]], k: 0.145, filters: [{ type: 'highpass', f: 500 }, { type: 'lowpass', f: 5500 }], seed: 's15' });
  bed(S, wide, { src: 'pink', gain: [[138.0, 0], [138.05, 1], [143.96, 1], [144.0, 0]], k: 0.05, filters: [{ type: 'bandpass', f: { wander: { seed: 'river', min: 400, max: 800, hz: 0.15 } }, q: 0.8 }], gust: { hz: 0.2, depth: 0.5 }, seed: 'riverair' });
  const train = panTo(S, S.out({ dry: 0.6, air: 0.5 }), [[138, -0.6], [144, 0.5]]);
  bed(S, train, { src: 'pink', gain: [[138.0, 0], [138.05, 0.8], [141, 1], [143.96, 0.7], [144.0, 0]], k: 0.035, filters: [{ type: 'bandpass', f: 420, q: 0.9 }, { type: 'lowpass', f: 900 }], gust: { hz: 0.5, depth: 0.3 }, mono: true, seed: 'bridge' });

  // ---- S16: the stairs. A concrete well: drips, the wet street above. At the match cut (02:32.0) the
  // well rings on for a moment into the crossing.
  const well = S.out({ dry: 1, room: 0.5 });
  bed(S, well, { src: 'pink', gain: [[144.0, 0], [144.05, 1], [152.0, 1], [152.7, 0]], k: 0.025, filters: [{ type: 'bandpass', f: 380, q: 0.8 }, { type: 'lowpass', f: 1500 }], seed: 'well' });
  bed(S, well, { src: 'rain', gain: [[144.0, 0], [144.05, 0.6], [151.5, 1], [152.0, 0.7], [152.5, 0]], k: 0.1, filters: [{ type: 'lowpass', f: [[144, 1500], [152, 4000]] }, { type: 'highpass', f: 400 }], seed: 's16' });
  bed(S, well, { src: 'drips', gain: [[144.0, 0], [144.05, 1], [152.0, 1], [152.8, 0]], k: 0.008, seed: 's16d' });

  // ---- S17: the crossing. Thousands of steps as a wash; rain on nine thousand umbrellas, heard first
  // as the hero's umbrella opens at the top of the stairs (02:31.0), under the last of the well.
  // 02:36.0-02:37.5 the rain stops and its noise falls away. By 02:41 nothing moves that does not have to.
  const cross = S.out({ dry: 1, room: 0.15, air: 0.2 });
  const rainOff = [[151.2, 0], [152.05, 1], [156.0, 1], [156.8, 0.3], [157.5, 0]];
  bed(S, cross, { src: 'rainUmbrella', gain: rainOff, k: 0.145, filters: [{ type: 'highpass', f: 280 }, { type: 'lowpass', f: 5800, q: 0.5 }], seed: 's17' });
  bed(S, cross, { src: 'rain', gain: rainOff, k: 0.034, filters: [{ type: 'highpass', f: 900 }, { type: 'lowpass', f: 6000, q: 0.5 }], seed: 's17b' });
  bed(S, cross, { src: 'feet', gain: [[151.5, 0], [152.05, 1], [156, 1], [158.5, 0.7], [160, 0.25], [160.9, 0.03], [161.0, 0]], k: 0.2, filters: [{ type: 'lowpass', f: 3800 }], seed: 's17f' });
  bed(S, cross, { src: 'drips', gain: [[156.5, 0], [157.5, 1], [160, 0.4], [160.9, 0]], k: 0.006, seed: 's17d' });
  bed(S, S.out({ dry: 1, air: 0.4 }), { src: 'pink', gain: [[156.0, 0], [157.5, 1], [160, 0.5], [161.0, 0.1], [162, 0.1]], k: 0.008, filters: [{ type: 'bandpass', f: 1100, q: 0.5 }], gust: { hz: 0.2, depth: 0.4 }, seed: 'afterrain' });

  // ---- S18: no voices; a great soft exhalation (band noise 300-1,200 Hz) rises with the wave
  bed(S, S.out({ dry: 1, air: 0.5 }), { src: 'pink', gain: [[162.0, 0], [164, 0.3], [167, 0.7], [169.6, 1], [170.4, 0.6], [174, 0.4], [178, 0.15], [180, 0]], k: 0.3, filters: [{ type: 'bandpass', f: [[162, 380], [170, 900], [178, 600]], q: 0.6 }, { type: 'lowpass', f: 2400 }], gust: { hz: 0.3, depth: 0.25 }, seed: 'exhalation' });

  // ---- S20: flight. Air over the microphone, the river far below; evening comes, and crickets from 03:06.
  const sky = S.out({ dry: 1, air: 0.3 });
  bed(S, sky, { src: 'pink', gain: [[177.4, 0], [178.3, 1], [184, 0.9], [189, 0.6], [191.96, 0.4], [193.5, 0]], k: 0.3, filters: [{ type: 'bandpass', f: { wander: { seed: 'fly', min: 380, max: 850, hz: 0.25 } }, q: 0.8 }], gust: { hz: 0.35, depth: 0.5 }, pan: { wander: { seed: 'flyp', min: -0.4, max: 0.4, hz: 0.15 } }, seed: 'fly' });
  bed(S, sky, { src: 'stream', gain: [[178.0, 0], [179, 1], [186, 0.8], [191.96, 0.3], [192.6, 0]], k: 0.09, mono: true, rate: 0.85, filters: [{ type: 'lowpass', f: 1200 }], pan: -0.3, seed: 'river' });
  // ---- S21, S22: dusk. A little wind in the grass; crickets, each in its place. Those near the path
  // (on the right) stop as the steps pass.
  const dusk = S.out({ dry: 1, air: 0.3 });
  bed(S, dusk, { src: 'leaves', gain: [[191.3, 0], [192.5, 1], [206, 0.9], [214, 0.7]], k: 0.088, filters: [{ type: 'highpass', f: 1200 }, { type: 'lowpass', f: 5500, q: 0.5 }], gust: { hz: 0.25, depth: 0.8 }, seed: 'duskgrass' });
  bed(S, dusk, { src: 'pink', gain: [[191.4, 0], [192.5, 1], [214, 1]], k: 0.03, filters: [{ type: 'bandpass', f: 520, q: 0.7 }], gust: { hz: 0.15, depth: 0.5 }, seed: 'duskair' });
  // (they sing the film's notes: D, B and A, far above the staff)
  const CR = [[0.75, hz('D8'), 3, 2.3, 0.9, 207.3], [0.35, hz('B7'), 4, 1.9, 1, 209.0], [0.0, hz('D8') * 1.012, 2, 2.9, 0.7, 210.6], [-0.45, hz('B7') * 0.991, 3, 2.1, 0.9, 212.2], [-0.85, hz('A7'), 4, 1.6, 0.6, 214.0]];
  CR.forEach(([pan, f, syl, rate, lv, stop], k) => {
    const name = `cricket:${k}`;
    S.assets.make(name, () => V.cricket(S.sr, { seconds: 8 + k * 0.7, f, syl, rate, seed: 'cricket' + k }));
    bed(S, S.out({ pan, dry: 0.7, air: 0.45 }), { src: name, gain: [[186 + k * 0.9, 0], [190.5, 0.6], [192.3, 1], [stop - 0.15, 1], [stop, 0]], k: 0.14 * lv, seed: 'cr' + k });
  });
}

function effectsC(S) {
  // ---- ★4 02:09.0 the rail joint: a hard metallic jolt on the first sample (steel ringing on B5, the
  // alarm's note: the second waking is the twin of the first), and the lurch of the car
  voice(S, S.out({ dry: 1, room: 0.45 }), 'jolt', 1.0, () => V.jolt(S.sr, { f: hz('B5'), seed: 'railjoint' }), 129.0, { gain: 1.25, kind: 'clack' });
  thud(S, S.out({ dry: 1, room: 0.3 }), { start: 129.0, f: [190, 150], glide: 0.25, env: [[129.0, 0], [129.008, 1], [129.25, 0.3], [129.6, 0]], gain: 0.06 });
  bed(S, S.out({ dry: 1, room: 0.3 }), { src: 'brown', gain: [[129.0, 0], [129.01, 1], [129.5, 0.3], [130, 0]], k: 0.2, filters: [{ type: 'bandpass', f: 230, q: 1 }], seed: 'lurch' });
  creak(S, S.out({ pan: -0.3, dry: 1, room: 0.4 }), { start: 129.15, dur: 0.4, f: [230, 170], ratio: 1.41, index: 4, stutter: [50, 22], band: [800, 1700], q: 3, gain: 0.02 });
  // then the train pulse alone: a pair of joints on every beat, in two
  const rails = S.out({ dry: 1, room: 0.4 });
  for (let t = 130; t < 138; t++) joint(S, rails, t, 0.5, (t % 2 ? 0.1 : 0.14) * (t < 132 ? 1 : 1.05));
  // 02:16.0 the drop lets go and runs down the glass: a tiny descending slide
  tones(S, S.out({ pan: 0.2, dry: 1, room: 0.3 }), { gain: 0.02, env: [[136.0, 0], [136.03, 1], [136.3, 0.5], [136.5, 0]], glide: [[136.0, 1], [136.5, 0.5]], partials: [{ f: hz('F#7') }, { f: hz('F#7') * 1.5, a: 0.3 }] });
  // S15: the far train's joints; a gull-like cry at 02:20
  const far = panTo(S, S.out({ dry: 0.6, air: 0.5 }), [[138, -0.6], [144, 0.5]]);
  for (let t = 138; t < 144; t++) joint(S, far, t, 0.2, 0.05, { lowpass: 900 });
  bird(S, S.out({ pan: -0.4, dry: 0.4, air: 0.9 }), { start: 140.0, syl: GULL, gain: 0.045 });

  // S16: steps on the stairs, on the beat, many; each umbrella a soft thump and a whisper of cloth
  const stair = S.out({ dry: 1, room: 0.5 });
  for (let t = 144; t < 152; t++) feet(S, stair, t, 'stair', t % 4, t % 2 ? 0.2 : 0.26);
  [[148, -0.4, 0.15], [149, 0.35, 0.16], [150, -0.15, 0.17], [151, 0, 0.25]].forEach(([t, pan, g], k) => voice(S, S.out({ pan, dry: 1, room: 0.4 }), `umb:${k}`, 0.55, () => V.umbrella(S.sr, { seed: 'umb' + k, size: k === 3 ? 0.8 : 0.5 }), t - 0.09, { gain: g, kind: 'umbrella' }));
  // S17: the steps keep the pulse, in two, under the wash; the hero stops at 02:35.0
  const cross = S.out({ dry: 1, room: 0.2, air: 0.15 });
  for (let t = 152; t < 159; t++) feet(S, cross, t, 'wet', t % 4, (t % 2 ? 0.14 : 0.19) * (t < 156 ? 1 : 0.7));
  // 02:38.5 the fold: a click and a rustle
  const hero = S.out({ pan: 0.05, dry: 1, room: 0.2, air: 0.2 });
  tick(S, hero, { start: 158.5, f: 2300, tau: 0.004, gain: 0.08, noise: 0.8, hp: 1200 });
  bed(S, hero, { src: 'leaves', gain: [[158.5, 0], [158.58, 1], [158.85, 0.3], [159.1, 0]], k: 0.08, filters: [{ type: 'bandpass', f: [[158.5, 2400], [159.1, 900]], q: 0.8 }], seed: 'fold' });

  // ---- S18 ★5 02:42.0: the umbrella on the hero's right opens into wings: one flap. Then its
  // neighbours, a ring spreading: the ring becomes a roar. 400 to 3,000 flaps a second, and at
  // 02:48-02:50 the cloud passes over the listener.
  wing(S, S.out({ pan: 0.25, dry: 1, air: 0.4 }), { start: 162.0, size: 1, gain: 0.3, v: 7 });
  const rr = createRng('ring');
  for (let k = 1; k < 26; k++) {
    const t = 162 + 1.6 * Math.sqrt(k / 26) + (rr() - 0.5) * 0.03;
    wing(S, S.out({ pan: clamp(0.25 + (rr() - 0.5) * 2 * Math.min(1, k / 10), -1, 1), dry: 0.9, air: 0.5 }), { start: t, size: 0.7, up: rr() < 0.4, gain: 0.12 * (0.6 + 0.4 * rr()), v: k % 6, rate: 0.9 + 0.2 * rr() });
  }
  const cloud = S.out({ dry: 1, air: 0.45 });
  // (the three clouds cross-fade at the cuts, 02:50.0 and 02:58.0: each fades as the next one rises)
  voice(S, fader(S, cloud, [[170.0, 1], [171.2, 0.3]]), 'cloud:crossing', 9.2, () => V.flockCloud(S.sr, { seconds: 9.2, seed: 'crossing', rate: [[0, 0], [0.4, 60], [1.2, 400], [5, 1800], [8, 3000], [9.2, 3000]], level: [[0, 0.75], [2, 0.8], [6, 0.86], [7.4, 0.9], [9.2, 0.9]], near: [[0, 0.1], [5, 0.15], [6.4, 0.7], [7.4, 1], [9.2, 1]] }), 162.0, { gain: 0.56, kind: 'cloud' });
  for (let k = 0; k < 30; k++) {   // the nearest wings, at the lens
    const t = 167.6 + 2.6 * rr();
    wing(S, S.out({ pan: rr() * 2 - 1, dry: 1, air: 0.3 }), { start: t, size: 1, up: rr() < 0.3, gain: 0.09 * (0.5 + 0.5 * rr()), v: 4 + (k % 6), rate: 0.8 + 0.3 * rr() });
  }
  // S19: the cloud pours up between four tower faces: a slap-back echo
  voice(S, fader(S, cloud, [[170.0, 0.3], [170.7, 1], [177.6, 1], [178.6, 0.4]]), 'cloud:canyon', 8.6, () => V.flockCloud(S.sr, { seconds: 8.6, seed: 'canyon', rate: [[0, 3000], [4, 2400], [8.6, 1600]], level: [[0, 1], [2, 0.9], [5, 0.72], [8.6, 0.45]], near: [[0, 0.7], [1.5, 0.3], [8.6, 0.15]], echo: [[0.11, 0.55], [0.23, 0.32], [0.36, 0.15]] }), 170.0, { gain: 0.5, kind: 'cloud' });
  // 02:58.0, the cut on the rising stream carries a half-second SHEEN: the same breath of air as 00:41.0
  sheen(S, S.out({ dry: 0.8, air: 0.5 }), 177.75, 178.25, { k: 0.07 });
  // S20: the cloud ahead, receding
  voice(S, fader(S, S.out({ dry: 0.8, air: 0.6 }), [[177.4, 0], [178.4, 1]]), 'cloud:field', 14.6, () => V.flockCloud(S.sr, { seconds: 14.6, seed: 'field', rate: [[0, 1600], [5.6, 900], [12.6, 250], [14.6, 100]], level: [[0, 0.8], [1.6, 1], [7.6, 0.6], [11.6, 0.25], [14.6, 0]], near: [[0, 0.15], [14.6, 0]] }), 177.4, { gain: 0.26, kind: 'cloud', lowpass: 5500 });
  // evening birds
  const eve = S.out({ pan: 0.55, dry: 0.4, air: 0.9 }), eve2 = S.out({ pan: -0.6, dry: 0.4, air: 0.9 });
  bird(S, eve, { start: 181.6, syl: BIRD_C, gain: 0.035 });
  bird(S, eve2, { start: 184.3, syl: BIRD_B.slice(0, 2), gain: 0.028 });
  bird(S, eve, { start: 187.4, syl: BIRD_C.slice(0, 3), gain: 0.028 });
  bird(S, eve2, { start: 190.2, syl: BIRD_C.slice(1), gain: 0.022 });
  // stragglers of the flock pass close as the music recedes
  for (let k = 0; k < 16; k++) {
    const t = 180.4 + k * 0.58 + (rr() - 0.5) * 0.2, side = k % 2 ? 1 : -1;
    wing(S, S.out({ pan: side * (0.3 + 0.6 * rr()), dry: 0.9, air: 0.4 }), { start: t, size: 0.5, up: rr() < 0.4, gain: 0.05 + 0.04 * rr(), v: k % 6, rate: 0.9 + 0.2 * rr() });
  }
  // 03:10.0 our butterfly peels away, by the lens
  [190.0, 190.33, 190.67, 191.0, 191.33].forEach((t, k) => wing(S, S.out({ pan: 0.3 - 0.15 * k, dry: 1, air: 0.3 }), { start: t, size: 0.6, up: k % 2 === 1, gain: 0.12 - 0.015 * k, v: k % 4 }));

  // ---- S21. 03:13.5 it alights: no sound but the blade's small creak as it bows, and bounces twice
  const blade = S.out({ pan: 0.08, dry: 1, air: 0.3 });
  wing(S, blade, { start: 193.0, size: 0.5, gain: 0.07, v: 2 });
  wing(S, blade, { start: 193.33, size: 0.4, up: true, gain: 0.05, v: 3 });
  creak(S, blade, { start: 193.5, dur: 0.5, f: [620, 420], ratio: 1.7, index: 3, stutter: [70, 30], band: [1500, 2600], q: 4, gain: 0.04 });
  creak(S, blade, { start: 194.15, dur: 0.25, f: [520, 440], ratio: 1.7, index: 3, stutter: [60, 35], band: [1500, 2400], q: 4, gain: 0.022 });
  // the wing-breaths: the softest flap as they open
  [[195.0, 0.04], [199.5, 0.03], [204.5, 0.022]].forEach(([t, g], k) => wing(S, blade, { start: t - 0.6, size: 0.5, up: true, gain: g, v: k, rate: 0.7 }));

  // ---- S22. From 03:26.0 footsteps in grass, from the right: 0.58 s a step, the only rhythm in the film
  // that is not on the grid. Cloth; a bag strap. They come level at 03:31.5 and pass.
  for (let k = 0; k * 0.58 + 206 < 213.9; k++) {
    const t = 206 + k * 0.58, x = (t - 206) / 8, pan = 0.95 - 1.5 * Math.pow(x, 1.3), lv = 0.1 + 0.9 * Math.min(1, Math.pow((t - 206) / 5.5, 1.6));
    const o = S.out({ pan, dry: 1, air: 0.35 - 0.15 * lv });
    shot(S, o, `grassStep${k % 4}`, t, { gain: 0.55 * lv, rate: k % 2 ? 0.94 : 1, kind: 'steps' });
    bed(S, o, { src: 'white', gain: [[t + 0.2, 0], [t + 0.33, 1], [t + 0.5, 0]], k: 0.016 * lv, filters: [{ type: 'bandpass', f: 1700, q: 0.8 }, { type: 'lowpass', f: 3500 }], seed: 'cloth' + k });   // cloth
    if (k % 2 === 0) tick(S, o, { start: t + 0.11, f: 1700, tau: 0.004, gain: 0.02 * lv, noise: 0.5, hp: 900 });   // the strap
  }
}

// ============================================================================================
// REEL D  03:37.5 - 03:58.5   M11 Awakening
// ============================================================================================
function musicD(S) {
  // ---- ★7 03:40.5 GLASS: E6, alone, in the open air. The first E in the film.
  const bell = S.out({ dry: 0.8, air: 0.9 });
  glass(S, bell, { note: 'E6', start: 220.5, gain: 0.27, decay: 15, index: 1.1, soft: 0.1 });
  glass(S, bell, { note: 'E7', start: 220.5, gain: 0.038, decay: 6, index: 0.6, pan: 0.2, soft: 0.1 });
  // ---- 03:50.0 QIN and XIAO in unison for the first time, two notes: A4, B4
  const q = S.out({ pan: -0.1, dry: 0.85, room: 0.3, air: 0.4 }), x = S.out({ pan: 0.1, dry: 0.75, air: 0.7 });
  qin(S, q, { note: 'A4', start: 230.0, gain: 0.48, seconds: 4, t60: 3.5, wobble: 10 });
  qin(S, q, { note: 'B4', from: 'A4', start: 231.5, gain: 0.48, glide: 0.14, seconds: 5, t60: 4, wobble: 12 });
  xiao(S, x, { gain: 0.28, seed: 'unison', seconds: 4.2, notes: [{ t: 230.0, note: 'A4', dur: 1.35, vel: 0.6, breath: 1.5 }, { t: 231.5, note: 'B4', dur: 1.7, vel: 0.62, breath: 1.5, rel: 0.6 }] });
  // ---- 03:53.0 with the sheen, one soft chord of all five notes: D4 A4 B4 E5 F#5. FELT and STRINGS.
  const all = S.out({ dry: 0.75, air: 0.75 });
  chord(S, all, ['D4', 'A4', 'B4', 'E5', 'F#5'], 233.0, { gain: 0.062, roll: 0.09, decay: 5, soft: 0.55 });
  strings(S, all, { notes: ['D4', 'A4', 'B4', 'E5', 'F#5'], env: [[232.9, 0], [233.5, 0.7], [234.3, 1], [236, 0.6], [238.4, 0]], gain: 0.026, cut: [450, 3000], seed: 'five' });
}

function ambienceD(S) {
  // wet-paper hiss as the wash clears, 03:37.5-03:40.5: very quiet, above 1 kHz
  const paper = S.out({ dry: 1, air: 0.2 });
  bed(S, paper, { src: 'fizz', gain: [[217.5, 0], [218.3, 1], [219.6, 0.6], [220.5, 0]], k: 0.01, filters: [{ type: 'highpass', f: 1500 }, { type: 'lowpass', f: 6500, q: 0.5 }], pan: 0.06, seed: 'wash2' });
  bed(S, paper, { src: 'white', gain: [[217.5, 0], [218.5, 1], [220.5, 0]], k: 0.0035, filters: [{ type: 'bandpass', f: [[217.5, 2500], [220.5, 5200]], q: 0.7 }], am: { hz: 25, depth: 0.5 }, seed: 'wash2b' });
  // 03:53.0-03:54.5 the SHEEN crosses the sheet: the same breath of air, very quiet, under the five notes
  sheen(S, S.out({ dry: 0.85, air: 0.35 }), 233.0, 234.5, { k: 0.016 });
  // under the last line only air: a band of noise at 2-5 kHz, at the threshold of hearing
  bed(S, S.out({ dry: 1, air: 0.3 }), { src: 'white', gain: [[220.5, 0], [222.5, 1], [234, 1], [238.5, 0]], k: 0.0012, filters: [{ type: 'bandpass', f: 3000, q: 0.6 }, { type: 'lowpass', f: 5000 }], gust: { hz: 0.15, depth: 0.4 }, seed: 'lastair' });
}

// ================================================================================= mix and master
// A reel is a stretch of film between two hard edits. It is only heard between `on` and `off`
// (sample-exact), with `fade` seconds of fade-out before `off`; its reverbs never cross an edit.
const REELS = [
  { name: 'A', on: 0, off: 80.9, fade: 0.3, stems: { music: musicA, ambience: ambienceA, effects: effectsA } },
  { name: 'B', on: 82, off: 129, fade: 0.12, stems: { music: musicB, ambience: ambienceB, effects: effectsB } },
  // M10: from 03:30.0 a low-pass closes over everything as the shadow crosses (8 kHz -> 200 Hz by 03:33.5)
  { name: 'C', on: 129, off: 214, fade: 0.5, stems: { music: musicC, ambience: ambienceC, effects: effectsC },
    post: (chs, sr) => sweepLowpass(chs, sr, 80.5, (t) => (t < 81 ? 20000 * Math.pow(0.4, (t - 80.5) / 0.5) : 8000 * Math.pow(200 / 8000, clamp((t - 81) / 3.5, 0, 1)))) },
  { name: 'D', on: 217.5, off: 238.5, fade: 2.5, stems: { music: musicD, ambience: ambienceD } },
];
const WINDOW = 12;   // seconds of cue sheet per chunk context
// The dubbing mixer's fader: the level of each scene in dB, moved at cuts (and once, slowly, as the
// colour world is born, 00:44-00:52). It draws the arc of the whole: night and scales low, the first
// flight lifted, the ink day lower and drier, the rain and the question closer, the stairs and the
// crossing a held rise that stops under -20 LUFS short-term, and after the crest the long fall into
// dusk; and it keeps the floor up: no sustained passage sits more than about 18 LU under the crest,
// so the quiet two thirds of the film survive a laptop. Film time, linear in dB between points.
const RIDE = [[0, 0.6], [25.7, 0.6], [26.3, 0.6], [39.6, 0.5], [40.4, -3.9], [44, -3.4], [48, -2.6], [52, -2.8], [72.5, -2.8], [73.5, 0], [80.9, 0],
  [82, -0.8], [84.2, -0.8], [84.5, -2.8], [97.9, -2.8], [98.1, -4.1], [105.9, -4.1], [106.1, -4.6], [113.7, -4.6], [114.3, -1.8], [120.5, -1.8], [121.5, -0.4], [125.5, -0.4], [126.5, -3.1], [128.99, -3.1],
  [129, -2.8], [131.3, -2.8], [131.8, 1.0], [137.9, 1.0], [138.1, -1.1], [141.7, -1.1], [141.9, -0.3], [143.9, -0.3], [144.1, -1.5], [150, -1.8], [154, -3.4], [158.4, -5.3], [158.6, -0.5], [161.9, -0.5], [162, 0],
  [191.6, 0], [192.6, -1.0], [214, -1.0], [217.5, -0.3], [240, -0.3]];
function ride(t) {
  if (t <= RIDE[0][0]) return RIDE[0][1];
  for (let i = 1; i < RIDE.length; i++) if (t <= RIDE[i][0]) { const a = RIDE[i - 1], b = RIDE[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
  return RIDE[RIDE.length - 1][1];
}

/** Render one reel: chunks in parallel (dry + two reverb sends), then the two convolutions. */
async function renderReel(reel, assets, sr, solo, timing, now, only, conv, part) {
  // each cue function is filed under a part: the music, or the effects (ambience and effects)
  const builders = Object.entries(reel.stems).filter(([name]) => !solo || solo.includes(name)).map(([name, fn]) => (S) => { S.part = name === 'music' ? 'music' : 'sfx'; fn(S); });
  const n = Math.round((reel.off - reel.on) * sr);
  const bus = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(n));   // dry L R, room L R, air L R
  if (!builders.length) return [bus[0], bus[1]];
  // pass 1: learn where each window's last event ends
  const probe = { t0: reel.on, W: WINDOW, ends: [] };
  const P = new Stem({ assets, sr, limit: reel.off, probe, only, part });
  for (const b of builders) b(P);
  // pass 2: one context per window, all at once (each renders on its own thread)
  const chunks = await Promise.all(Array.from(probe.ends, (end, k) => {
    if (!end) return null;
    const a = reel.on + k * WINDOW;
    const S = new Stem({ assets, sr, origin: a, win: [k === 0 ? -Infinity : a, a + WINDOW], seconds: end - a + 0.02, limit: reel.off, only, part });
    for (const b of builders) b(S);
    return S.render();
  }));
  // sum in window order (never in order of completion: float addition is not associative)
  chunks.forEach((buf, k) => {
    if (!buf) return;
    const at = Math.round(k * WINDOW * sr);
    for (let c = 0; c < 6; c++) {
      const src = buf.getChannelData(c), dst = bus[c], len = Math.min(src.length, n - at);
      for (let i = 0; i < len; i++) dst[at + i] += src[i];
    }
  });
  timing['chunks:' + reel.name] = Math.round(now());
  // the two rooms, convolved in JS (bit-reproducible, unlike a ConvolverNode)
  const L = bus[0], R = bus[1];
  for (const [ir, c] of [['ir:room', 2], ['ir:air', 4]]) await convolveInto(conv.plan, conv.spectra(ir), bus[c], bus[c + 1], L, R, conv.tick);
  if (reel.post) reel.post([L, R], sr);
  timing['reverb:' + reel.name] = Math.round(now());
  return [L, R];
}

/** What the script asks to be measured, taken from the finished mix. */
function measure(L, R, sr) {
  const hops = kHops(L, R, sr), st = shortTerm(hops), r1 = (x) => +x.toFixed(1);
  const stAt = (t) => st[Math.max(0, Math.min(st.length - 1, Math.round(t * 10) - 30))];   // the 3 s window ending at t
  let cap = -Infinity, capT = 0, top = -Infinity, topT = 0;
  for (let j = 0; j < st.length; j++) {
    const end = (j + 30) / 10;
    if (end <= 162.0 && st[j] > cap) { cap = st[j]; capT = end; }
    if (st[j] > top) { top = st[j]; topT = end; }
  }
  // Act IV (02:24-03:12), second by second (K-weighted): which is the quietest?
  const sec = (t) => { let s = 0; for (let h = 0; h < 10; h++) s += hops[Math.round(t * 10) + h]; return -0.691 + 10 * Math.log10(Math.max(s / 10, 1e-12)); };
  let q = Infinity, qT = 0;
  for (let t = 144; t < 192; t++) { const v = sec(t); if (v < q) { q = v; qT = t; } }
  const lr = loudnessRange(st);
  const quiet = {};
  for (const [name, a, b] of [['M1', 1, 26], ['M2', 26, 40], ['S04', 40, 52], ['M4', 73, 80.9], ['S08-09', 84.5, 98], ['S10', 98, 106], ['S11', 106, 114], ['S12', 114, 121], ['S15', 138, 142], ['M10', 192, 214], ['M11', 217.5, 238.5]]) quiet[name] = +energyAbove(L, R, sr, 150, a, b).toFixed(3);
  const sections = {};
  for (const [name, a, b] of [['M1', 0, 26], ['M2', 26, 40], ['M3', 40, 73], ['M4', 73, 82], ['M5', 82, 114], ['M6', 114, 144], ['M7', 144, 162], ['M8', 162, 178], ['M9', 178, 192], ['M10', 192, 214], ['M11', 214, 240]]) {
    let m = -Infinity;
    for (let t = a + 3; t <= b; t += 0.1) m = Math.max(m, stAt(t));
    sections[name] = r1(m);
  }
  return {
    lra: r1(lr.lra), lraLow: r1(lr.lo), lraHigh: r1(lr.hi),
    capBefore162: r1(cap), capAt: capT, capOk: cap <= -20,
    peakShortTerm: r1(top), peakAt: topT, peakOk: topT >= 166 && topT <= 173,
    quietestActIV: qT, quietestActIVdB: r1(q), quietOk: qT === 161,
    above150Hz: quiet, above150Ok: Object.values(quiet).every((v) => v >= 0.7),
    truePeakDb: +truePeakDb(L, R).toFixed(2), sectionMaxST: sections,
    balance: bandBalance(L, R, sr, [[2000, 5000], [6000, 14000]]),   // dB re 200 Hz-1 kHz, whole film
  };
}

/**
 * @param {OfflineAudioContext} ctx
 * @param {number} duration seconds
 * @param {{solo?: string[], only?: string[], part?: 'music'|'sfx', master?: boolean, now?: () => number}} [opts]
 *        solo: render only these cue functions (music ambience effects);
 *        part: render only the music (everything pitched and musical) or only the sound effects (everything
 *              diegetic: ambience and effects, and the alarm and the umbrellas' taps); with master: false the
 *              two parts sum to the pre-master mix;
 *        only: render only these instrument kinds (strings glass felt drum qin xiao wings cloud tones hum beep bed shot
 *              steps clack drop umbrella bloop tick creak bird thud thread);
 *        master: false skips loudness normalisation and the limiter; now: a clock, for timing stats
 */
export async function renderScore(ctx, duration, opts = {}) {
  const sr = ctx.sampleRate, N = Math.min(ctx.length, Math.round(duration * sr));
  const assets = createAssets(sr);
  const clock = opts.now || (() => 0), tStart = clock(), now = () => clock() - tStart, timing = {};
  // one FFT plan and the impulse-response spectra, shared by all reels (built on first use)
  const plan = fftPlan(1 << 20), cache = new Map();
  const conv = {
    plan,
    spectra(name) { if (!cache.has(name)) cache.set(name, irSpectra(plan, assets.get(name))); return cache.get(name); },
    // let the page breathe between blocks (a message task: timers are throttled in background tabs)
    tick: () => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); res(); }; ch.port2.postMessage(0); }),
  };
  const reels = await Promise.all(REELS.map((reel) => renderReel(reel, assets, sr, opts.solo, timing, now, opts.only, conv, opts.part)));

  const L = new Float32Array(N), R = new Float32Array(N);
  const hp = biquad('hp', 18, 0.707, sr), shelf = biquad('hs', SHELF.f, SHELF.q, sr, SHELF.db);
  const stats = { reels: {}, timing };
  REELS.forEach((reel, k) => {
    const [l, r] = reels[k];
    filt(l, hp); filt(r, hp);   // before the edit, so the filter cannot ring into a silence
    if (opts.master !== false) { filt(l, shelf); filt(r, shelf); }   // the master's tilt, likewise
    stats.reels[reel.name] = +peakDb(l, r).toFixed(2);
    const i0 = Math.round(reel.on * sr), n = Math.min(l.length, N - i0), nf = Math.round(reel.fade * sr), rg = reel.gain ?? 1;
    let fad = 1;
    for (let i = 0; i < n; i++) {
      if ((i & 255) === 0) fad = dbToGain(ride((i0 + i) / sr)) * rg;
      let g = fad;
      if (i >= n - nf) { const x = (n - i) / nf; g *= x * x * (3 - 2 * x); }
      L[i0 + i] = l[i] * g; R[i0 + i] = r[i] * g;
    }
  });
  timing.mixed = Math.round(now());

  if (opts.master !== false) {
    const ceiling = dbToGain(CEILING_DB);
    const crest = (a, b) => { let m = -Infinity; for (const v of shortTerm(kHops(a, b, sr))) if (v > m) m = v; return m; };
    let gain = dbToGain(CREST_LUFS - crest(L, R)), l, r, lim, dip;
    for (let it = 0; it < 8; it++) {
      l = Float32Array.from(L); r = Float32Array.from(R);
      dip = presenceDip(l, r, sr, { ...PRESENCE, gain });   // the gain, and the presence dip where 2.5-4 kHz runs hot
      softClip(l, r, CLIP_KNEE, CLIP_TOP);   // the drum's first milliseconds are rounded here, not pumped by the limiter
      lim = limit(l, r, sr, { ceiling, lookahead: 0.005, release: 0.15 });
      const c = crest(l, r);
      if (Math.abs(CREST_LUFS - c) < 0.01) break;
      gain *= dbToGain(CREST_LUFS - c);
    }
    const lu = loudness(l, r, sr);
    L.set(l); R.set(r);
    Object.assign(stats, { lufs: +lu.toFixed(2), gainDb: +(20 * Math.log10(gain)).toFixed(2), limiterMaxDb: +lim.maxReduction.toFixed(2), limitedSeconds: +lim.limitedSeconds.toFixed(3), limiterOver1234dB: lim.over, limiterEvents: lim.events, peakDb: +peakDb(L, R).toFixed(2),
      presenceDipMaxDb: +dip.maxDb.toFixed(2), presenceDipSeconds: +dip.seconds.toFixed(2), presenceDipEvents: dip.events });
  } else stats.lufs = +loudness(L, R, sr).toFixed(2);
  Object.assign(stats, measure(L, R, sr));
  // the measured asserts of SCRIPT.md 8.3 / 8.5: say so, loudly, if the mix has drifted out of them.
  // (The director's call after REVIEW.md item 10: the arc stays, the range is at most 17 LU, the crest
  // is about -8 LUFS and the integrated figure is whatever follows, between -16 and -18.)
  const failed = [['short-term cap before 02:42', stats.capOk], ['peak of the film in 02:46-02:52', stats.peakOk], ['quietest second of Act IV is 02:41', stats.quietOk],
    ['70% of the energy above 150 Hz in the quiet passages', stats.above150Ok], ['true peak <= -1.5 dBTP', stats.truePeakDb <= -1.5],
    ['integrated loudness between -18 and -16 LUFS', stats.lufs <= -16 && stats.lufs >= -18], ['loudness range at most 17 LU', stats.lra <= 17]]
    .filter(([, ok]) => !ok).map(([name]) => name);
  stats.checks = failed.length ? 'FAILED: ' + failed.join('; ') : 'all passed';
  if (failed.length && opts.master !== false && !opts.solo && !opts.only && !opts.part) console.warn('[score] measured checks failed: ' + failed.join('; '));
  timing.total = Math.round(now());
  renderScore.stats = stats;

  const out = ctx.createBuffer(2, ctx.length, sr);
  out.copyToChannel(L, 0); out.copyToChannel(R, 1);
  const src = ctx.createBufferSource();
  src.buffer = out; src.connect(ctx.destination); src.start(0);
}
