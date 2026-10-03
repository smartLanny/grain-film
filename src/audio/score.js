// THE SCORE of 《一粒》 / GRAIN — music and sound, every sample synthesized (no recordings).
//
//   export async function renderScore(ctx, duration)
//     ctx       an OfflineAudioContext (48 kHz, stereo, length = duration). The finished mix is
//               scheduled on it as one buffer; the caller calls ctx.startRendering().
//     duration  film length in seconds (240)
//
// How it is built
//   1. The cue sheet (docs/story.md section 6) is written out below, cue by cue, in film seconds. Times
//      are hard-coded from the script; the tempo grid is 60 BPM, so every cue sits on a whole or
//      half second.
//   2. The film is three reels, separated by its hard edits: A 00:00-00:30.5, B 00:31-03:46,
//      C 03:47-03:58.5. Total silence 00:30.5-00:31.0 (the crack lands on the first sample of
//      00:31.0), the cut to silence at 03:46.0 and the silence from 03:58.5 are therefore exact, and
//      no reverb tail leaks across an edit.
//   3. A reel's cue sheet is rendered in 12-second chunks, each a nested OfflineAudioContext holding
//      only the events that begin in it (thousands of idle nodes are what makes Web Audio slow), all
//      in parallel. Each chunk outputs a dry bus and two reverb sends; the chunks are summed and the
//      two convolution reverbs ("ice hall", 5 s, prologue and return; "valley", 2.2 s, elsewhere)
//      run once per reel, as FFT convolutions in JS (dsp.js) so that every render is bit-identical.
//   4. Master: 12 Hz high-pass, gain to -16 LUFS integrated (BS.1770 meter in dsp.js), zero-latency
//      look-ahead limiter with a -1.6 dBFS ceiling measured on the 2x-oversampled signal.
// Deterministic: seeded noise, no clocks. Instruments and effects live in kit.js, sample-exact
// one-shots and textures in dsp.js / assets.js.

import { createRng } from '../lib/random.js';
import { hz } from './synth.js';
import { createAssets } from './assets.js';
import { Stem, strings, horn, glass, kalimba, piano, drum, heart, sub, bed, shot, bloop, tick, creak, pew, bird, sheet, thud } from './kit.js';
import { biquad, filt, loudness, limit, peakDb, dbToGain, fftPlan, irSpectra, convolveInto } from './dsp.js';

const TARGET_LUFS = -16;
const CEILING_DB = -1.6;

// --------------------------------------------------------------------------------------- helpers
/** Everything in M2 / S05 passes through this: the swell is cut dead at 00:44.0, its reverb rings on. */
function cutAt44(S) {
  return S.group((ctx) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, 43.994); g.gain.linearRampToValueAtTime(0, 44.0);
    return g;
  });
}
/** "Going under" (S14) and coming up for air (S15): a low-pass that closes at 02:02 and opens at 02:33. */
function underground(S) {
  return S.group((ctx) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 0.6; f.frequency.value = 20000;
    f.frequency.setValueAtTime(20000, 122.0); f.frequency.exponentialRampToValueAtTime(240, 123.0);
    f.frequency.setValueAtTime(240, 153.0); f.frequency.exponentialRampToValueAtTime(20000, 153.4);
    return f;
  });
}
/** The deep ice ambience of S01-S03, reused under S21 (the bookend). env: [[t, level], ...]. */
function iceAmbience(S, env, seed) {
  const amb = S.out({ dry: 1, hall: 0.35 });
  bed(S, amb, { src: 'brown', gain: env, k: 0.1, filters: [{ type: 'lowpass', f: 180 }, { type: 'highpass', f: 70 }, { type: 'highpass', f: 55 }], gust: { hz: 0.12, depth: 0.6 }, seed: seed + 'low' });
  bed(S, amb, { src: 'pink', gain: env, k: 0.03, filters: [{ type: 'bandpass', f: { wander: { seed: seed + 'tone', min: 260, max: 620, hz: 0.07 } }, q: 2.5 }], gust: { hz: 0.1, depth: 0.7 }, seed: seed + 'tone' });
  bed(S, amb, { src: 'white', gain: env, k: 0.0045, filters: [{ type: 'highpass', f: 6500 }], gust: { hz: 0.2, depth: 0.5 }, seed: seed + 'air' });
  bed(S, S.out({ dry: 0.7, hall: 0.7 }), { src: 'ticks', gain: env, k: 0.036, seed: seed + 'ticks' });
}
/** A glacier groan: the FM creak plus a few tight snaps inside it. */
function iceCreak(S, t, pan, { dur = 2.4, f = [95, 58], stutter = [21, 8], band = [240, 620], gain = 0.1, far = false } = {}) {
  const d = far ? S.out({ pan, dry: 0.35, valley: 0.9 }) : S.out({ pan, dry: 0.5, hall: 0.9 });
  creak(S, d, { start: t, dur, f, ratio: 1.47, index: 4, stutter, band, q: 3, gain });
  const r = createRng('creak' + t);
  for (let k = 0; k < 3; k++) tick(S, d, { start: t + 0.2 + r() * dur * 0.7, f: 2200 + r() * 2600, tau: 0.002, gain: gain * 0.22 * (far ? 0.4 : 1), noise: 0.8 });
}

/** CENTURY DRUM bus: dry, plus a big valley reverb that is fed only above 110 Hz (a 45 Hz boom in a
 *  2 s reverb is mud and eats the headroom of the climaxes; the size comes from the thump and skin). */
function drumBus(S) {
  if (S.probe) return null;
  const input = S.ctx.createGain(), hp = S.ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 110; hp.Q.value = 0.6;
  input.connect(S.out({ dry: 1 }));
  input.connect(hp).connect(S.out({ dry: 0, valley: 0.45 }));
  return input;
}

const THEME = ['A4', 'D5', 'E5'];           // + F5 in minor, F#5 from germination
const up = (note, oct) => hz(note) * Math.pow(2, oct);

// ================================================================================= PROLOGUE 0-30.5
// M1 Void + S01-S03. Ice hall. Everything here stops dead at 00:30.5.
function stemPrologue(S) {
  // SUB fades in from 00:01
  sub(S, S.out({ hall: 0.1 }), { env: [[1, 0], [7, 0.55], [14, 0.85], [24, 1], [30.6, 1]], gain: 0.03, presence: 1 });

  // sparse GLASS, D minor pentatonic, one note every 2-4 s from 00:04
  const bells = S.out({ dry: 0.75, hall: 0.75 });
  for (const [t, n, pan, a] of [[4.0, 'A6', -0.3, 1], [7.0, 'D7', 0.35, 0.85], [9.5, 'G6', -0.1, 0.9], [11.5, 'C7', 0.5, 0.7], [17.6, 'A6', -0.45, 0.8],
    [19.5, 'F6', 0.25, 0.8], [22.0, 'D6', 0, 1], [24.0, 'G6', 0.45, 0.7], [26.5, 'A6', -0.5, 0.85], [29.0, 'D7', 0.3, 0.7]]) {
    glass(S, bells, { note: n, start: t, gain: 0.05 * a, decay: 5, index: 1.2, pan });
  }

  // ★1 the credit: STRINGS cluster D4 E4 A4, 00:12.0 -> 00:17.5, apex exactly at 00:15.0
  strings(S, S.out({ dry: 0.8, hall: 0.6 }), { notes: ['D4', 'E4', 'A4'], env: [[12, 0], [13.4, 0.2], [14.5, 0.7], [15.0, 1], [15.7, 0.58], [17.5, 0]], gain: 0.07, cut: [380, 2800], seed: 'cluster' });
  // ... and a run of tiny GLASS pings that travels left to right with the reading light (13.0 -> 15.5),
  // reaching the right speaker, with its top note, at 00:15.0
  const RUN = ['D6', 'F6', 'G6', 'F6', 'G6', 'A6', 'C7', 'A6', 'C7', 'D7', 'F7', 'D7', 'F7', 'G7', 'A7', 'G7', 'A7'];
  const run = S.out({ dry: 0.9, hall: 0.35 });
  RUN.forEach((n, k) => glass(S, run, { note: n, start: 13 + k * 0.125, gain: k === 16 ? 0.036 : 0.011 + 0.009 * (k / 16), decay: 1.3, index: 0.9, pan: -0.9 + 1.8 * (k / 16) }));
  [['G7', 15.125, 0.014], ['F7', 15.25, 0.011], ['D7', 15.375, 0.008], ['A6', 15.5, 0.006]].forEach(([n, t, g]) => glass(S, run, { note: n, start: t, gain: g, decay: 1.3, index: 0.9, pan: 0.9 }));

  // S01-S03 deep ice ambience, creaks at 00:05, 00:10, 00:21, 00:27, the sheet at 00:20.5
  iceAmbience(S, [[0.3, 0], [6, 1], [30.6, 1]], 'ice');
  iceCreak(S, 5.0, -0.5, { dur: 2.2 });
  iceCreak(S, 10.0, 0.45, { dur: 3.0, f: [80, 52], band: [200, 520] });
  iceCreak(S, 21.0, -0.25, { dur: 2.0, f: [110, 70], band: [280, 700] });
  iceCreak(S, 27.0, 0.6, { dur: 2.6, f: [88, 50] });
  const far = S.out({ dry: 0.3, hall: 1 });
  pew(S, far, { start: 10.9, gain: 0.035 });
  pew(S, far, { start: 27.7, f: [4300, 380], gain: 0.03 });
  sheet(S, S.out({ dry: 0.6, hall: 0.9 }), { start: 20.5, gain: 0.02 });

  // HEART, barely audible, from the first amber pulse
  const hb = S.out({ dry: 1, hall: 0.2 });
  heart(S, hb, { start: 25.0, gain: 0.1 });
  heart(S, hb, { start: 28.0, gain: 0.11 });
}

// ======================================================================= STRINGS AND HORN 31-226
function stemStrings(S) {
  const cut = cutAt44(S);
  const hall = S.out({ dry: 0.75, hall: 0.65, group: cut });
  const val = S.out({ dry: 0.8, valley: 0.5 });
  const hornOut = S.out({ pan: -0.1, dry: 0.75, valley: 0.6 });

  // ---- M2 Crack 31-44: Dsus4 rising, tremolo, p -> ff peaking into the white at 43, cut at 44.0
  strings(S, hall, { notes: ['D5', 'G5', 'A5'], env: [[31.4, 0], [33, 0.14], [36, 0.3], [40, 0.6], [43, 1], [44.1, 1]], gain: 0.069, cut: [700, 4400], trem: { rate: 12, depth: 0.75 }, seed: 'm2a' });
  strings(S, hall, { notes: ['D4', 'G4', 'A4'], env: [[34.5, 0], [38, 0.3], [41, 0.65], [43, 1], [44.1, 1]], gain: 0.081, cut: [400, 3400], seed: 'm2b' });
  strings(S, hall, { notes: ['D6', 'G6'], env: [[38, 0], [41, 0.45], [43, 1], [44.1, 1]], gain: 0.062, cut: [1500, 6500], trem: { rate: 13.5, depth: 0.8 }, seed: 'm2c' });
  strings(S, hall, { notes: ['A6'], env: [[41, 0], [43, 1], [44.1, 1]], gain: 0.044, cut: [2000, 7000], trem: { rate: 14.5, depth: 0.8 }, seed: 'm2e' });
  strings(S, hall, { notes: ['D2', 'D3', 'A3'], env: [[36, 0], [40, 0.45], [43, 1], [44.1, 1]], gain: 0.1, cut: [220, 1900], seed: 'm2d' });

  // ---- M3 Mountain 44-58: D minor add 9 out of the white; HORN states the theme
  strings(S, val, { notes: ['D2', 'A2', 'F3', 'E4'], env: [[44.0, 0], [46.5, 0.7], [50, 1], [54.5, 0.9], [57.5, 0.05], [58, 0]], gain: 0.074, cut: [260, 2000], seed: 'm3' });
  [['A4', 48, 2.05], ['D5', 50, 2.05], ['E5', 52, 2.05], ['F5', 54, 2.5]].forEach(([n, t, d]) => horn(S, hornOut, { note: n, start: t, dur: d, gain: 0.085, release: n === 'F5' ? 1.6 : 0.5 }));

  // ---- M4 River 58-82: a low pedal under the drops, bass D2 F2 C2 G2, light strings above
  const bass = (n, env) => strings(S, val, { notes: [n], env, gain: 0.1, cut: [200, 950], seed: 'm4b' });
  bass('D2', [[61.5, 0], [65, 0.6], [67.5, 0.85], [68.6, 0]]);
  bass('F2', [[67.6, 0], [68.4, 0.85], [71.5, 0.9], [72.6, 0]]);
  bass('C2', [[71.6, 0], [72.4, 0.9], [74, 0.7], [75.6, 0.5], [76.6, 0]]);
  bass('G2', [[75.6, 0], [76.5, 0.5], [78.5, 0.3], [80.5, 0]]);
  const airy = (notes, env) => strings(S, val, { notes, env, gain: 0.038, cut: [1400, 5200], bow: 1.2, seed: 'm4t' });
  airy(['A5', 'D6'], [[64.5, 0], [66, 0.7], [67.6, 1], [68.6, 0]]);
  airy(['A5', 'C6'], [[67.6, 0], [68.5, 1], [71.6, 1], [72.6, 0]]);
  airy(['G5', 'D6'], [[71.6, 0], [72.5, 1], [74, 0.7], [76.5, 0]]);
  const mid = (notes, env) => strings(S, val, { notes, env, gain: 0.04, cut: [400, 2200], seed: 'm4m' });
  mid(['A3', 'D4', 'F4'], [[64.6, 0], [66, 0.8], [67.6, 1], [68.6, 0]]);
  mid(['A3', 'C4', 'F4'], [[67.6, 0], [68.5, 1], [71.6, 1], [72.6, 0]]);
  mid(['G3', 'C4', 'E4'], [[71.6, 0], [72.5, 1], [74, 0.6], [76.4, 0]]);

  // ---- M5 Erosion 82-110: Bb major 7 then G minor over a D pedal; the theme in the low strings
  strings(S, val, { notes: ['D2', 'Bb2', 'F3', 'A3', 'D4'], env: [[82, 0], [84.5, 0.85], [96, 1], [98.8, 0]], gain: 0.055, cut: [240, 1500], seed: 'm5a' });
  strings(S, val, { notes: ['D2', 'G2', 'Bb2', 'D3', 'G3'], env: [[97.6, 0], [99.5, 0.9], [106, 0.7], [110.5, 0]], gain: 0.055, cut: [240, 1250], seed: 'm5b' });
  const low = (n, env) => {
    strings(S, val, { notes: [n], env, gain: 0.13, cut: [300, 1800], seed: 'm5t' });
    strings(S, val, { notes: [n.replace(/\d/, (d) => String(+d + 1))], env, gain: 0.055, cut: [400, 2200], seed: 'm5o' });
  };
  [['A2', 84], ['D3', 88], ['E3', 92]].forEach(([n, t]) => low(n, [[t - 0.15, 0], [t + 1.1, 1], [t + 3.7, 0.85], [t + 5.2, 0]]));
  low('F3', [[95.85, 0], [97.1, 1], [100, 0.9], [102.5, 0.55], [104.5, 0]]);
  low('D3', [[103.5, 0], [105.2, 0.7], [108, 0.5], [110.5, 0]]);

  // ---- M6 Waiting / M7 Strata 110-134: one held D3, decaying to nothing
  strings(S, val, { notes: ['D3'], env: [[109.5, 0], [111.5, 0.6], [120, 0.5], [122, 0.42], [128, 0.24], [134, 0]], gain: 0.09, cut: [240, 1050], seed: 'm6' });

  // ---- M8 Germination 140-154: warm D major fades in under the bell; full D add 9 at 153.0
  strings(S, val, { notes: ['D3', 'A3', 'D4', 'F#4'], env: [[140.0, 0], [143, 0.12], [148, 0.34], [153.0, 0.62], [153.4, 1], [154.8, 0.45], [158.2, 0.3], [159.5, 0]], gain: 0.092, cut: [300, 3200], seed: 'm8' });
  strings(S, val, { notes: ['D2', 'A2', 'E4', 'A4', 'D5'], env: [[153.0, 0], [153.4, 1], [154.8, 0.55], [158, 0.25], [159.5, 0]], gain: 0.098, cut: [500, 3600], seed: 'm8b' });
  // ---- M9 Seedling 154-162: D major, then G over D
  strings(S, val, { notes: ['D3', 'G3', 'B3', 'D4', 'G4'], env: [[157.8, 0], [159.3, 0.55], [161, 0.5], [162.7, 0]], gain: 0.058, cut: [300, 2400], seed: 'm9' });

  // ---- M10 Growth 162-180: D, B minor, G, A, then A sus 4 -> A. mp -> ff
  const M10 = [
    [162, 166, ['D3', 'A3', 'D4', 'F#4', 'A4'], 0.5, 'F#5', 'D3'],
    [166, 170, ['B2', 'F#3', 'B3', 'D4', 'F#4'], 0.56, 'F#5', 'B2'],
    [170, 174, ['G2', 'D3', 'G3', 'B3', 'D4', 'G4'], 0.6, 'G5', 'G2'],
    [174, 178, ['A2', 'E3', 'A3', 'C#4', 'E4', 'A4'], 0.63, 'A5', 'A2'],
    [178, 179, ['A2', 'E3', 'A3', 'D4', 'E4', 'A4'], 0.66, 'D6', null],
    [179, 180, ['A2', 'E3', 'A3', 'C#4', 'E4', 'A4'], 0.68, 'C#6', null],
  ];
  for (const [a, b, notes, lv, top, root] of M10) {
    const at = Math.min(0.7, (b - a) * 0.35);
    strings(S, val, { notes, env: [[a - 0.2, 0], [a + at, lv], [b - 0.25, lv * 1.06], [b + 0.45, 0]], gain: 0.07, cut: [350, 1500 + 2700 * lv], seed: 'm10' });
    strings(S, val, { notes: [top], env: [[a - 0.15, 0], [a + at, lv], [b - 0.2, lv * 1.08], [b + 0.4, 0]], gain: 0.054, cut: [900, 2500 + 3500 * lv], voices: 5, seed: 'm10t' });
    // HORN doubles the bass line
    if (root) horn(S, hornOut, { note: root, start: a, dur: (root === 'A2' ? 6 : 4) - 0.15, gain: 0.045 + 0.022 * lv, bright: 1.1 + 0.3 * lv });
  }

  // ---- M11 Recognition 180-194: the theme in full, with the major ending. ★4 at 184.0
  const big = (notes, env, g = 0.092) => strings(S, val, { notes, env, gain: g, cut: [420, 4400], seed: 'm11' });
  big(['D2', 'A2', 'D3', 'A3', 'D4', 'F#4', 'A4'], [[179.85, 0], [180.2, 1], [181.7, 0.9], [182.35, 0]], 0.068);
  big(['G2', 'D3', 'G3', 'B3', 'D4'], [[181.75, 0], [182.2, 1], [183.0, 1], [183.4, 0]], 0.058);
  // the dominant: its basses let go at 183.5, the rest thins, so the drum at 184.0 falls into a cleared low end
  big(['A2', 'E3'], [[182.75, 0], [183.15, 1], [183.35, 0.9], [183.62, 0]], 0.058);
  big(['A3', 'C#4', 'E4'], [[182.75, 0], [183.2, 1], [183.5, 0.9], [183.9, 0.5], [184.2, 0]], 0.058);
  big(['D2', 'A2', 'D3', 'F#3', 'A3', 'D4', 'F#4'], [[183.92, 0], [184.12, 1], [185, 0.76], [186, 0.62], [189, 0.4], [192, 0.18], [194.5, 0.1], [196, 0]], 0.088);
  const oct = (n, env) => strings(S, val, { notes: [n, n.replace(/\d/, (d) => String(+d + 1))], env, gain: 0.092, cut: [900, 6000], seed: 'm11t' });
  oct('A4', [[180.95, 0], [181.16, 0.85], [181.95, 0.8], [182.3, 0]]);
  oct('D5', [[181.95, 0], [182.16, 0.85], [182.95, 0.8], [183.3, 0]]);
  oct('E5', [[182.95, 0], [183.16, 0.85], [183.6, 0.75], [183.95, 0.55], [184.2, 0]]);
  oct('F#5', [[183.95, 0], [184.13, 1], [185.2, 0.74], [186.5, 0.6], [190, 0.34], [193, 0]]);
  const hornFF = (n, t, d, g = 0.14) => horn(S, hornOut, { note: n, start: t, dur: d, gain: g, bright: 1.6, players: 2, attack: 0.12, release: d > 2 ? 2.4 : 0.4 });
  hornFF('A4', 181, 0.98, 0.085); hornFF('D5', 182, 0.98, 0.085); hornFF('E5', 183, 0.9, 0.085); hornFF('F#5', 184, 3.6, 0.15);
  horn(S, hornOut, { note: 'D3', start: 180, dur: 1.9, gain: 0.09, bright: 1.4 });
  horn(S, hornOut, { note: 'G2', start: 182, dur: 0.95, gain: 0.09, bright: 1.4, attack: 0.15 });
  horn(S, hornOut, { note: 'A2', start: 183, dur: 0.42, gain: 0.1, bright: 1.4, attack: 0.15, release: 0.25 });
  horn(S, hornOut, { note: 'D3', start: 184, dur: 4.5, gain: 0.12, bright: 1.4, attack: 0.12, release: 3 });

  // ---- M12 Wind 194-212: G major 9 over D, airy and high; then D open fifth, thinning out
  const air = S.out({ dry: 0.7, valley: 0.6 });
  strings(S, air, { notes: ['D3', 'G3'], env: [[193.5, 0], [196, 0.9], [201, 1], [204.5, 0.4], [206, 0]], gain: 0.045, cut: [300, 1500], seed: 'm12g' });
  strings(S, air, { notes: ['B4', 'D5', 'F#5', 'A5'], env: [[193.5, 0], [196, 0.9], [201, 1], [204.5, 0.5], [206, 0]], gain: 0.041, cut: [900, 5000], bow: 1.4, seed: 'm12a' });
  strings(S, S.out({ dry: 0.6, valley: 0.4, hall: 0.4 }), { notes: ['D3', 'A3', 'D5', 'A5'], env: [[203.5, 0], [206, 0.8], [209, 0.5], [212, 0.2], [214.5, 0]], gain: 0.042, cut: [600, 3600], bow: 1.2, seed: 'm12b' });
}

// ==================================================== GLASS, KALIMBA, PIANO, DRUM, SUB, HEART 31-226
function stemKeys(S) {
  const cut = cutAt44(S);
  const val = S.out({ dry: 0.85, valley: 0.45 });
  const drums = drumBus(S);

  // ---- M2: SUB grows after the crack; the seed answers the light
  sub(S, S.out({ group: cut, hall: 0.1 }), { env: [[31.2, 0], [32.5, 0.35], [38, 0.7], [43, 1.3], [44.1, 1.3]], gain: 0.085, presence: 0.35 });
  const hb1 = S.out({ dry: 1, hall: 0.25, group: cut });
  heart(S, hb1, { start: 34.0, gain: 0.17 });
  heart(S, hb1, { start: 37.0, gain: 0.2 });
  heart(S, hb1, { start: 40.0, gain: 0.2 });

  // ---- M4 River: the drops (first at 00:59.0), quickening into a running KALIMBA arpeggio at 01:05
  const dropOut = S.out({ dry: 0.9, valley: 0.4 });
  const DROPS = [[59.0, 'A5'], [60.5, 'A5'], [61.5, 'A5'], [62.0, 'A5'], [62.5, 'A5'], [63.0, 'A5'], [63.5, 'G5'], [64.0, 'A5'], [64.25, 'C6'], [64.5, 'A5'], [64.75, 'D6']];
  DROPS.forEach(([t, n], i) => {
    const pan = i === 0 ? -0.15 : i % 2 ? 0.4 : -0.4;
    kalimba(S, dropOut, { note: n, start: t, gain: 0.12, pan, decay: 0.5 });
    glass(S, dropOut, { note: n, start: t, gain: 0.04, decay: 2.4, index: 0.8, pan });
  });
  const ARP = {
    D: ['D4', 'A4', 'D5', 'F5', 'A5', 'F5', 'D5', 'A4'], F: ['F4', 'C5', 'F5', 'A5', 'C6', 'A5', 'F5', 'C5'], C: ['C4', 'G4', 'C5', 'D5', 'G5', 'D5', 'C5', 'G4'],
  };
  const arpOut = S.out({ dry: 0.9, valley: 0.4 });
  for (let i = 0; i < 36; i++) {
    const t = 65 + i * 0.25, pat = ARP[t < 68 ? 'D' : t < 72 ? 'F' : 'C'];
    const g = (0.06 + 0.04 * Math.min(1, i / 24)) * (i % 4 === 0 ? 1.25 : 1);
    kalimba(S, arpOut, { note: pat[i % 8], start: t, gain: g, pan: i % 2 ? 0.45 : -0.45 });
    // an interlocking voice an octave up, between the beats: speed
    if (i >= 4) kalimba(S, arpOut, { freq: up(pat[(i + 3) % 8], 1), start: t + 0.125, gain: g * 0.42, pan: i % 2 ? -0.75 : 0.75, decay: 0.3 });
  }
  [['D3', 65], ['F3', 68], ['C3', 72]].forEach(([n, t]) => piano(S, val, { note: n, start: t, gain: 0.13, soft: 0.6, decay: 3.5 }));
  // 01:14 the arpeggio thins to single notes and stops at 01:19
  [[74.0, 'D5'], [74.5, 'A4'], [75.0, 'C5'], [75.5, 'G4'], [76.0, 'D5'], [76.75, 'A4'], [77.5, 'G4'], [78.25, 'D4']].forEach(([t, n], i) =>
    kalimba(S, arpOut, { note: n, start: t, gain: 0.1 - i * 0.008, pan: i % 2 ? 0.4 : -0.4, decay: 0.5 }));
  // PIANO alone: the first two notes of the theme, unanswered
  piano(S, val, { note: 'A4', start: 79.0, gain: 0.21, soft: 0.35, pan: 0.05 });
  piano(S, val, { note: 'D5', start: 81.0, gain: 0.2, soft: 0.35, pan: 0.05 });
  const hb2 = S.out({ dry: 1, valley: 0.12 });
  heart(S, hb2, { start: 76.0, gain: 0.1 });
  heart(S, hb2, { start: 79.0, gain: 0.14 });
  heart(S, hb2, { start: 82.0, gain: 0.13 });

  // ---- M5 Erosion: CENTURY DRUM on every bar line; 01:36.0 is the loudest (the slab)
  const s5 = sub(S, S.out({}), { env: [[82, 0], [84, 0.8], [96, 1], [108, 0.7], [110.5, 0]], gain: 0.035 });
  for (const [t, g, deep] of [[84, 0.23, 0], [88, 0.23, 0], [92, 0.25, 0], [96, 0.29, 1], [100, 0.22, 0], [104, 0.22, 0], [108, 0.2, 0]]) {
    drum(S, drums, { start: t, gain: g, deep });
    s5.duckAt(t);
  }

  // ---- M6 Waiting: PIANO alone, the theme in minor, one note after each of the first four trials
  [['A4', 112, 0.17], ['D5', 114, 0.17], ['E5', 116, 0.158], ['F5', 118, 0.15]].forEach(([n, t, g]) => piano(S, val, { note: n, start: t, gain: g, soft: 0.4, pan: 0.05 }));
  heart(S, hb2, { start: 121.0, gain: 0.09 });

  // ---- M7 Strata: one soft low note per settling band, descending, 02:03 ... 02:13
  const deepOut = S.out({ dry: 0.9, valley: 0.35 });
  ['D4', 'C4', 'Bb3', 'A3', 'G3', 'F3', 'E3', 'D3', 'C3', 'Bb2', 'A2'].forEach((n, k) => {
    piano(S, deepOut, { note: n, start: 123 + k, gain: 0.072 - k * 0.002, soft: 0.75, decay: 2.6, pan: -0.25 + k * 0.05 });
    kalimba(S, deepOut, { note: n, start: 123 + k, gain: 0.02, bright: 0.5, decay: 0.5, pan: -0.25 + k * 0.05 });
  });
  // from 02:14 only SUB and HEART
  sub(S, S.out({}), { env: [[131, 0], [134, 0.75], [140, 0.8], [150, 0.95], [153, 0.9], [156, 0.3], [158, 0]], gain: 0.026, presence: 0.6 });
  const hb4 = S.out({});
  [[134, 0.085], [137, 0.085], [140, 0.1], [143, 0.1], [146, 0.085], [149, 0.06]].forEach(([t, g]) => heart(S, hb4, { start: t, gain: g }));

  // ---- M8 Germination. ★3 02:20.0: the F sharp bell, the first major third in the film
  const bell = S.out({ dry: 0.9, valley: 0.75 });
  glass(S, bell, { note: 'F#5', start: 140.0, gain: 0.135, decay: 7.5, index: 1.0, soft: 0.25 });
  glass(S, bell, { note: 'F#6', start: 140.0, gain: 0.028, decay: 4.5, index: 0.7, pan: 0.2, soft: 0.25 });
  // one ascending note per band crossed, every 0.8 s from 02:24.5: the mirror of M7
  ['A2', 'B2', 'D3', 'E3', 'F#3', 'A3', 'B3', 'D4', 'E4', 'F#4', 'A4'].forEach((n, k) => {
    const t = 144.5 + 0.8 * k;
    piano(S, deepOut, { note: n, start: t, gain: 0.11 + k * 0.012, soft: 0.65 - k * 0.035, decay: 3, pan: 0.25 - k * 0.05 });
    kalimba(S, deepOut, { note: n, start: t, gain: 0.03 + k * 0.006, bright: 0.6 + k * 0.04, decay: 0.5, pan: 0.25 - k * 0.05 });
  });
  // 02:33.0 full D major add 9
  piano(S, val, { note: 'D2', start: 153.0, gain: 0.2, soft: 0.3, decay: 5 });
  glass(S, bell, { note: 'A5', start: 153.0, gain: 0.1, decay: 5, index: 1.2, pan: -0.15 });
  glass(S, bell, { note: 'E6', start: 153.0, gain: 0.04, decay: 4, index: 0.9, pan: 0.3 });

  // ---- M9 Seedling: two GLASS notes
  glass(S, bell, { note: 'F#6', start: 155.0, gain: 0.055, decay: 4.5, index: 1, pan: 0.3 });
  glass(S, bell, { note: 'A6', start: 159.0, gain: 0.05, decay: 4.5, index: 1, pan: -0.3 });

  // ---- M10 Growth: the KALIMBA arpeggio returns (the river is in the tree now); drums gather
  const ARP2 = {
    D: ['D4', 'F#4', 'A4', 'D5', 'F#5', 'D5', 'A4', 'F#4'], Bm: ['B3', 'F#4', 'B4', 'D5', 'F#5', 'D5', 'B4', 'F#4'], G: ['G3', 'D4', 'G4', 'B4', 'D5', 'B4', 'G4', 'D4'],
    A: ['A3', 'E4', 'A4', 'C#5', 'E5', 'C#5', 'A4', 'E4'], As: ['A3', 'E4', 'A4', 'D5', 'E5', 'D5', 'A4', 'E4'],
  };
  for (let i = 0; i < 68; i++) {
    const t = 163 + i * 0.25, pat = ARP2[t < 166 ? 'D' : t < 170 ? 'Bm' : t < 174 ? 'G' : t < 178 ? 'A' : t < 179 ? 'As' : 'A'];
    const g = (0.05 + 0.035 * (i / 67)) * (i % 4 === 0 ? 1.25 : 1);
    kalimba(S, arpOut, { note: pat[i % 8], start: t, gain: g, pan: i % 2 ? 0.45 : -0.45 });
    if (t >= 170) kalimba(S, arpOut, { freq: up(pat[(i + 3) % 8], 1), start: t + 0.125, gain: g * 0.42, pan: i % 2 ? -0.75 : 0.75, decay: 0.3 });
  }
  const s11 = sub(S, S.out({}), { env: [[179.6, 0], [180.2, 0.8], [183.2, 0.8], [183.6, 0.1], [183.98, 0.1], [184.12, 1.2], [188, 0.8], [192, 0.4], [196, 0.1], [198, 0]], gain: 0.03 });
  for (const [t, g, deep] of [[166, 0.13, 0], [168, 0.13, 0], [170, 0.13, 0], [172, 0.13, 0], [174, 0.1, 0], [175, 0.105, 0], [176, 0.11, 0], [177, 0.115, 0], [178, 0.12, 0], [179, 0.13, 0],
    [180, 0.25, 0.5], [184, 0.43, 1]]) {
    drum(S, drums, { start: t, gain: g, deep });
    if (t >= 180) s11.duckAt(t);
  }
  // ---- M11 ★4 03:04.0: F sharp 5, deep drum (above), GLASS bell
  glass(S, bell, { note: 'F#5', start: 184.0, gain: 0.2, decay: 7, index: 1.5 });
  glass(S, bell, { note: 'F#6', start: 184.0, gain: 0.07, decay: 5, index: 1, pan: 0.2 });
  glass(S, bell, { note: 'D6', start: 184.0, gain: 0.04, decay: 5, index: 1, pan: -0.25 });

  // ---- M12 Wind: GLASS at random from D major pentatonic, the warm twin of M1's sparse bells
  const r = createRng('m12glass');
  const PENTA = ['D6', 'E6', 'F#6', 'A6', 'B6', 'D7', 'E7', 'F#7'];
  const bellV = S.out({ dry: 0.75, valley: 0.7 }), bellH = S.out({ dry: 0.75, hall: 0.75 });
  for (let t = 195.2; t < 211; t += 1.6 + r() * 1.7) {
    glass(S, t < 204 ? bellV : bellH, { note: PENTA[r.int(0, PENTA.length - 1)], start: Math.round(t * 2) / 2, gain: 0.06 * (0.75 + 0.5 * r()) * (t > 207 ? 0.75 : 1), decay: 5, index: 1.1, pan: r() * 1.4 - 0.7 });
  }

  // ---- M13 Return: M1's SUB; PIANO states the theme one last time and withholds the fourth note
  sub(S, S.out({ hall: 0.1 }), { env: [[212, 0], [217, 0.6], [222, 1], [226.1, 1]], gain: 0.026, presence: 1 });
  const last = S.out({ dry: 0.8, hall: 0.7 });
  THEME.forEach((n, k) => piano(S, last, { note: n, start: 217 + 2 * k, gain: 0.065 - k * 0.003, soft: 0.5, decay: 3.5 }));
  const hb3 = S.out({ dry: 1, hall: 0.2 });
  heart(S, hb3, { start: 223.0, gain: 0.11 });
  // the last beat is placed so that both thumps are heard before the cut to black at 03:46.0
  heart(S, hb3, { start: 225.76, gain: 0.135 });
}

// ========================================================================= AMBIENCE BEDS 31-226
function stemAmbience(S) {
  const cut = cutAt44(S), under = underground(S);
  const A = (o) => S.out({ group: under, ...o });
  const leaves = (dest, gain, k, o = {}) => bed(S, dest, { src: 'leaves', gain, k, filters: [{ type: 'highpass', f: 1200 }, { type: 'lowpass', f: 9500, q: 0.5 }], ...o });

  // ---- S04: high sizzling shimmer as the light enters (32-36), growing with M2 into the white
  const white = S.out({ group: cut, dry: 0.8, hall: 0.5 });
  bed(S, white, { src: 'white', gain: [[32, 0], [33.5, 0.35], [36, 0.8], [39, 0.9], [43, 2.2], [44.1, 2.4]], k: 0.02, filters: [{ type: 'highpass', f: [[32, 7000], [44, 4500]] }], am: { hz: 28, depth: 0.55 }, seed: 'shimmer' });
  // ---- S05: rising wind-like noise, the first hint of open air
  bed(S, white, { src: 'pink', gain: [[38, 0], [40.5, 0.25], [43, 0.9], [44.1, 1]], k: 0.25, filters: [{ type: 'bandpass', f: [[38, 280], [44, 1500]], q: 0.7 }], gust: { hz: 0.4, depth: 0.3 }, seed: 'rise' });
  // reversed-cymbal swell 41 -> 44, cut at 44.0
  bed(S, white, {
    src: 'white', gain: [[41, 0.018], [42, 0.069], [42.75, 0.19], [43.25, 0.37], [43.6, 0.59], [43.85, 0.82], [44.0, 1], [44.1, 1]], k: 0.2,
    filters: [{ type: 'highpass', f: 2500 }, { type: 'peaking', f: 3300, q: 4, gain: 6 }, { type: 'peaking', f: 5300, q: 4, gain: 8 }, { type: 'peaking', f: 8100, q: 5, gain: 7 }],
    am: { hz: 60, depth: 0.25 }, seed: 'cymbal',
  });

  // ---- S06 00:44: abrupt openness. High-altitude wind, hiss of spindrift, enormous quiet
  const wide = A({ dry: 1, valley: 0.25 });
  const s06 = [[44.0, 0], [44.3, 1], [57.96, 1], [58.0, 0]];
  bed(S, wide, { src: 'pink', gain: s06, k: 0.2, filters: [{ type: 'bandpass', f: { wander: { seed: 'alt', min: 320, max: 900, hz: 0.15 } }, q: 0.9 }], gust: { hz: 0.18, depth: 0.65 }, pan: { wander: { seed: 'altp', min: -0.4, max: 0.4, hz: 0.08 } }, seed: 'alt' });
  bed(S, wide, { src: 'pink', gain: s06, k: 0.07, rate: 0.8, filters: [{ type: 'bandpass', f: { wander: { seed: 'alt2', min: 700, max: 1700, hz: 0.2 } }, q: 1.6 }], gust: { hz: 0.25, depth: 0.8 }, pan: { wander: { seed: 'altp2', min: -0.6, max: 0.6, hz: 0.1 } }, seed: 'alt2' });
  bed(S, wide, { src: 'white', gain: s06, k: 0.04, filters: [{ type: 'bandpass', f: 6500, q: 0.8 }], am: { hz: 35, depth: 0.6 }, gust: { hz: 0.3, depth: 0.7 }, pan: [[44, -0.2], [58, 0.5]], seed: 'spindrift' });

  // ---- S07 00:58: close and dry. A faint room tone; the trickle grows from 01:02
  const close = A({ dry: 1, valley: 0.08 });
  bed(S, close, { src: 'pink', gain: [[58.0, 0], [58.05, 1], [64.96, 1], [65.0, 0]], k: 0.006, filters: [{ type: 'lowpass', f: 1400 }], seed: 'room' });
  bed(S, close, { src: 'trickle', gain: [[61.8, 0], [63.5, 0.5], [64.95, 1], [65.0, 0]], k: 0.25, pan: 0.3, seed: 's07' });

  // ---- S09 01:14: small trickle and, far off, the river
  bed(S, close, { src: 'trickle', gain: [[74.0, 0], [74.05, 0.6], [78, 0.35], [79, 0.12], [81.95, 0.1], [82.0, 0]], k: 0.42, pan: -0.2, seed: 's09' });
  const farRiver = (gain, k, pan = -0.3) => bed(S, A({ dry: 0.8, valley: 0.4, pan }), { src: 'stream', gain, k, mono: true, rate: 0.85, filters: [{ type: 'lowpass', f: 1000 }], seed: 'far' + gain[0][0] });
  farRiver([[74.0, 0], [74.05, 1], [81.95, 1], [82.0, 0]], 0.12);
  bed(S, close, { src: 'pink', gain: [[74.0, 0], [74.05, 1], [81.95, 1], [82.0, 0]], k: 0.008, filters: [{ type: 'lowpass', f: 2500 }], seed: 'room2' });

  // ---- S10 01:22: time-lapse wind, whooshing with each cloud band
  const lapse = (gain, k, seed) => {
    bed(S, wide, { src: 'pink', gain, k, filters: [{ type: 'bandpass', f: { wander: { seed: seed + 'f', min: 300, max: 1400, hz: 0.45 } }, q: 1.2 }], gust: { hz: 0.55, depth: 0.88 }, pan: { wander: { seed: seed + 'p', min: -0.7, max: 0.7, hz: 0.5 } }, seed });
    bed(S, wide, { src: 'white', gain, k: k * 0.16, filters: [{ type: 'bandpass', f: { wander: { seed: seed + 'f2', min: 1800, max: 4200, hz: 0.5 } }, q: 1.5 }, { type: 'lowpass', f: 7000, q: 0.5 }], gust: { hz: 0.6, depth: 0.9 }, pan: { wander: { seed: seed + 'p2', min: -0.7, max: 0.7, hz: 0.6 } }, seed: seed + 'hi' });
  };
  lapse([[82.0, 0], [82.3, 1], [95.96, 1], [96.0, 0]], 0.33, 'lapse1');

  // ---- S11 01:36: after the slab, streams of grains pour down the scree (moving down-left)
  bed(S, wide, { src: 'pink', gain: [[96.0, 0], [96.05, 1], [101.96, 1], [102.0, 0]], k: 0.02, filters: [{ type: 'bandpass', f: 500, q: 0.6 }], gust: { hz: 0.2, depth: 0.5 }, seed: 'air11' });
  bed(S, wide, { src: 'white', gain: [[96.8, 0], [98.5, 0.5], [101.6, 0.75], [101.97, 0.75], [102.0, 0]], k: 0.03, filters: [{ type: 'bandpass', f: 5200, q: 0.9 }], am: { hz: 45, depth: 0.6 }, pan: [[96.8, 0.3], [102, -0.4]], seed: 'sand' });

  // ---- S12 01:42: cut to underwater. Muffled roar, bubbling, sand hiss, rain above as a filtered layer
  const s12 = [[102.0, 0], [102.04, 1], [106, 0.8], [109.95, 0.55], [110.0, 0]];
  const wet = A({ dry: 1, valley: 0.12 });
  bed(S, wet, { src: 'brown', gain: s12, k: 0.33, filters: [{ type: 'lowpass', f: 330 }], gust: { hz: 0.3, depth: 0.4 }, seed: 'flood' });
  bed(S, wet, { src: 'bubLow', gain: s12, k: 0.3, seed: 'floodb' });
  bed(S, wet, { src: 'white', gain: s12, k: 0.012, filters: [{ type: 'bandpass', f: 4800, q: 0.8 }, { type: 'lowpass', f: 6000 }], am: { hz: 40, depth: 0.7 }, seed: 'floods' });
  bed(S, wet, { src: 'rain', gain: s12, k: 0.25, filters: [{ type: 'lowpass', f: 1300 }], seed: 'floodr' });

  // ---- S13 01:50: six trials, 2 s each
  bed(S, close, { src: 'trickle', gain: [[110.0, 0], [110.05, 0.8], [111.6, 0.2], [112.1, 0]], k: 0.32, seed: 't1' });                      // 1 the flood drains
  bed(S, close, { src: 'pink', gain: [[110.0, 0], [110.05, 1], [122, 1], [122.5, 0]], k: 0.007, filters: [{ type: 'lowpass', f: 2500 }], seed: 'room3' });
  bed(S, close, { src: 'frost', gain: [[111.9, 0], [112.3, 0.6], [113.8, 1], [114.1, 0]], k: 0.3, seed: 't2' });                          // 2 frost crackle
  bed(S, close, { src: 'white', gain: [[111.9, 0], [112.5, 1], [113.8, 1], [114.1, 0]], k: 0.003, filters: [{ type: 'highpass', f: 8000 }], seed: 't2air' });
  bed(S, close, { src: 'rain', gain: [[113.9, 0], [114.3, 1], [115.7, 0.9], [116.1, 0]], k: 0.14, seed: 't3' });                            // 3 thaw and rain
  bed(S, wide, { src: 'pink', gain: [[115.9, 0], [116.4, 1], [117.7, 1], [118.1, 0]], k: 0.16, filters: [{ type: 'bandpass', f: { wander: { seed: 'dry', min: 900, max: 1700, hz: 0.8 } }, q: 2.5 }], gust: { hz: 0.8, depth: 0.6 }, seed: 't4' }); // 4 dry wind
  const fire = [[117.9, 0], [118.5, 1], [119.5, 1], [120.15, 0]], sweep = [[118, -0.7], [120, 0.7]];                                      // 5 fire, left to right
  bed(S, wide, { src: 'brown', gain: fire, k: 0.22, filters: [{ type: 'bandpass', f: 260, q: 0.5 }], am: { hz: 9, depth: 0.5 }, pan: sweep, seed: 't5roar' });
  bed(S, wide, { src: 'crackle', gain: fire, k: 0.24, pan: sweep, seed: 't5' });
  bed(S, wide, { src: 'white', gain: fire, k: 0.014, filters: [{ type: 'bandpass', f: 2500, q: 0.5 }], am: { hz: 30, depth: 0.6 }, pan: sweep, seed: 't5hiss' });
  bed(S, wide, { src: 'brown', gain: [[119.9, 0], [120.6, 1], [122.5, 1], [126, 0.5], [134, 0]], k: 0.07, filters: [{ type: 'lowpass', f: 300 }], gust: { hz: 0.3, depth: 0.5 }, seed: 't6' }); // 6 ash, low wind
  bed(S, close, { src: 'frost', gain: [[120.0, 0], [120.6, 1], [122, 0.8], [123, 0]], k: 0.012, rate: 0.5, filters: [{ type: 'lowpass', f: 2500 }], seed: 't6ash' });

  // ---- S14 02:02: under the ground. A low earth tone (and, from 02:14, nothing else but SUB and HEART)
  bed(S, S.out({ dry: 1 }), { src: 'brown', gain: [[121.8, 0], [123.5, 1], [140, 1], [146, 0.6], [153, 0.2], [154, 0]], k: 0.045, filters: [{ type: 'lowpass', f: 110 }, { type: 'highpass', f: 40 }], gust: { hz: 0.1, depth: 0.4 }, seed: 'earth' });

  // ---- S15/S16: morning waits above the soil; at 02:33.0 the low-pass opens in one breath
  const dawn = [[149, 0], [152.5, 0.7], [153.0, 0.75], [153.4, 1], [161.96, 1], [162.0, 0]];
  bed(S, wide, { src: 'pink', gain: dawn, k: 0.05, filters: [{ type: 'bandpass', f: { wander: { seed: 'dawn', min: 500, max: 1100, hz: 0.15 } }, q: 0.8 }], gust: { hz: 0.2, depth: 0.5 }, seed: 'dawn' });
  bed(S, wide, { src: 'white', gain: dawn, k: 0.007, filters: [{ type: 'highpass', f: 5000 }], gust: { hz: 0.25, depth: 0.5 }, seed: 'dawnair' });
  leaves(wide, dawn, 0.06, { gust: { hz: 0.3, depth: 0.8 }, seed: 'dawngrass' });
  farRiver(dawn, 0.12, 0.3);

  // ---- S17 02:42: time-lapse wind again, now with leaf rustle rising and falling with each season
  lapse([[162.0, 0], [162.3, 1], [176, 0.8], [178, 0.4], [180, 0.3], [181, 0]], 0.2, 'lapse2');
  const seasons = [[162.5, 0]];
  for (let c = 0; c < 9; c++) {
    const b = 163 + 1.55 * c, g = 0.2 + 0.8 * (c / 8);
    seasons.push([b + 0.05, 0.06 * g], [b + 0.5, g], [b + 0.9, 0.8 * g], [b + 1.2, 0.07 * g]);   // green, gold, bare, snow
  }
  seasons.push([177.0, 0.25], [180, 0.45]);
  leaves(wide, seasons, 0.36, { seed: 'seasons' });
  farRiver([[162.0, 0], [162.05, 1], [194, 1], [194.05, 0]], 0.09, 0.35);

  // ---- S18 03:00: real time. Wind in a great crown of leaves; 03:01.5 a gust
  const crown = [[180, 0.45], [181.5, 0.5], [182.7, 1.15], [184.3, 0.8], [187, 0.5], [193.96, 0.55], [194.0, 0]];
  leaves(wide, crown, 0.3, { gust: { hz: 0.25, depth: 0.45 }, seed: 'crown' });
  bed(S, wide, { src: 'pink', gain: crown, k: 0.05, filters: [{ type: 'bandpass', f: { wander: { seed: 'crownw', min: 380, max: 800, hz: 0.2 } }, q: 0.8 }], gust: { hz: 0.25, depth: 0.5 }, seed: 'crownw' });

  // ---- S19 03:14: inside the leaves. Close rustle all around, soft pops and whispers, wind rising
  const inside = A({ dry: 1, valley: 0.1 });
  const s19 = [[194.0, 0], [194.05, 1], [198, 1.1], [201.96, 1.3], [202.0, 0]];
  leaves(inside, s19, 0.17, { gust: { hz: 0.5, depth: 0.4 }, seed: 'in1' });
  leaves(inside, s19, 0.14, { rate: 0.8, gust: { hz: 0.4, depth: 0.5 }, seed: 'in2' });
  bed(S, inside, { src: 'pops', gain: [[194.0, 0], [194.05, 0.25], [198, 0.7], [201.96, 1], [202.0, 0]], k: 0.07, seed: 'pops' });
  bed(S, inside, { src: 'white', gain: s19, k: 0.005, filters: [{ type: 'bandpass', f: 3000, q: 0.8 }], am: { hz: 6, depth: 0.9 }, seed: 'whisper' });
  bed(S, wide, { src: 'pink', gain: [[194.0, 0], [194.05, 0.35], [201.96, 1], [202.0, 0]], k: 0.09, filters: [{ type: 'bandpass', f: 600, q: 0.7 }], gust: { hz: 0.35, depth: 0.4 }, seed: 'in3' });

  // ---- S20 03:22: wind of flight; the air grows colder and thinner; snow hush from 03:28.
  // ---- S21: the wind dies to nothing between 03:36 and 03:42
  const thin = [{ type: 'bandpass', f: { wander: { seed: 'fly', min: 380, max: 850, hz: 0.25 } }, q: 0.8 }, { type: 'lowpass', f: [[202, 9000], [212, 2000]] }];
  bed(S, wide, { src: 'pink', gain: [[202.0, 0], [202.08, 1], [208, 0.9], [212, 0.8], [216, 0.65], [222, 0]], k: 0.25, filters: thin, gust: { hz: 0.3, depth: 0.5 }, pan: { wander: { seed: 'flyp', min: -0.4, max: 0.4, hz: 0.15 } }, seed: 'fly' });
  leaves(wide, [[202.0, 0.5], [205, 0]], 0.3, { filters: [{ type: 'highpass', f: 1500 }, { type: 'lowpass', f: [[202, 8000], [205, 1500]] }], seed: 'behind' });
  farRiver([[202.0, 0.7], [208, 0.3], [211, 0]], 0.1, 0);
  bed(S, wide, { src: 'pink', gain: [[208, 0], [212, 1], [216, 1], [221, 0]], k: 0.05, filters: [{ type: 'bandpass', f: 1800, q: 0.4 }, { type: 'lowpass', f: 3500 }], am: { hz: 10, depth: 0.3 }, seed: 'snow' });
  // the ice ambience of S01 fades in underneath as the points stop
  iceAmbience(S, [[216, 0], [222, 0.75], [226.1, 0.75]], 'ice2');
}

// S08 独立水声：近处轻细，随机位抬升拉远而变宽、收暗，总体逐渐更轻。
function stemMelt(S) {
  const river = S.out({ dry: 1, valley: 0.055 });
  const filters = [{ type: 'highpass', f: 130, q: 0.7 }, { type: 'lowpass', f: [[65, 7200], [69, 5200], [74, 3400]], q: 0.55 }];
  bed(S, river, { src: 's08Shallow', gain: [[65, 0], [65.4, 1], [68, 0.78], [71, 0.58], [73.75, 0.43], [74, 0]], k: 0.24, mono: true, filters, seed: 's08-near' });
  bed(S, river, { src: 's08Shallow', gain: [[65, 0], [65.4, 0.12], [68, 0.38], [71, 0.48], [73.75, 0.38], [74, 0]], k: 0.13, filters, seed: 's08-wide' });
}

// ========================================================================== SPOT EFFECTS 31-226
function stemSpots(S) {
  const cut = cutAt44(S);
  const dryAt = (pan, valley = 0.08) => S.out({ pan, dry: 1, valley });

  // ★2 00:31.0 THE CRACK: first sample of the buffer on the first sample of 00:31.0
  shot(S, S.out({ dry: 1, hall: 0.6 }), 'crack', 31.0, { gain: 0.54 });
  // sparkles in the shimmer as light enters
  const sp = S.out({ dry: 0.7, hall: 0.8, group: cut }), r1 = createRng('sparkle');
  for (let t = 32.2; t < 43.5; t += 0.25 + r1() * (t < 36 ? 0.5 : 0.9)) glass(S, sp, { freq: 2600 * Math.pow(2, r1() * 1.6), start: t, gain: 0.012 + 0.012 * r1(), decay: 1, index: 0.6, pan: r1() * 1.8 - 0.9 });
  // 00:35.0 one small water bead
  bloop(S, S.out({ pan: 0.15, dry: 0.8, hall: 0.7, group: cut }), { start: 35.0, f: 1150, rise: 2.0, dur: 0.07, gain: 0.08 });

  // S06: distant glacier groan at 00:51
  iceCreak(S, 51.0, -0.3, { dur: 3.2, f: [70, 44], band: [170, 400], stutter: [16, 6], gain: 0.13, far: true });

  // S07: each drop lands as a short pitched tick (first at 00:59.0); wetter as the film of water forms
  [59.0, 60.5, 61.5, 62.0, 62.5, 63.0, 63.5, 64.0, 64.25, 64.5, 64.75].forEach((t, i) => {
    const d = dryAt(i === 0 ? -0.15 : i % 2 ? 0.4 : -0.4);
    tick(S, d, { start: t, f: 2500 + (i % 3) * 300, tau: 0.003, gain: 0.07, noise: 0.7 });
    if (i >= 3) bloop(S, d, { start: t + 0.004, f: 1300 + (i % 4) * 150, rise: 1.8, dur: 0.05, gain: 0.03 });
  });
  // S09: melt drips; 01:19.0 a tiny dry tick as the seed touches the pebble
  [[74.6, 1250], [75.3, 980], [76.2, 1400], [76.9, 1100], [77.8, 1500], [78.5, 1200]].forEach(([t, f], i) => bloop(S, dryAt(i % 2 ? -0.3 : 0.1, 0.15), { start: t, f, gain: 0.045 }));
  tick(S, dryAt(0.2, 0.05), { start: 79.0, f: 3400, tau: 0.0025, gain: 0.1, noise: 0.8 });
  tick(S, dryAt(0.2, 0.05), { start: 79.0, f: 950, tau: 0.006, gain: 0.06, noise: 0 });

  // S10: rockfall rumbles with the drum at 01:24, 01:28, 01:32
  const rocks = S.out({ pan: 0.25, dry: 0.8, valley: 0.6 });
  shot(S, rocks, 'rock1', 84.0, { gain: 0.24, lowpass: 3000 });
  shot(S, rocks, 'rock2', 88.0, { gain: 0.24, lowpass: 3000 });
  shot(S, rocks, 'rock3', 92.0, { gain: 0.26, lowpass: 3000 });
  // S11 01:36.0: a deep crack of stone, then the long avalanche roar tailing into pouring sand
  shot(S, S.out({ pan: 0.2, dry: 1, valley: 0.5 }), 'slab', 96.0, { gain: 0.25 });
  // S12: lightning at 01:44.0, rolling thunder from 01:44.5
  tick(S, S.out({ dry: 0.6, valley: 0.6 }), { start: 104.0, f: 5200, tau: 0.012, gain: 0.02, noise: 1.5, hp: 3000 });
  shot(S, S.out({ dry: 0.9, valley: 0.55 }), 'thunder', 104.5, { gain: 0.45, lowpass: 2600 });

  // S13 details: frost tinks, rain drips, brittle cracks of drying mud
  const frostOut = S.out({ dry: 0.8, valley: 0.3 });
  [[112.6, 7200, -0.3], [113.2, 8800, 0.4], [113.65, 6400, 0.1]].forEach(([t, f, pan]) => glass(S, frostOut, { freq: f, start: t, gain: 0.012, decay: 0.8, index: 0.4, pan }));
  [[114.45, 1100], [115.1, 1450], [115.62, 950]].forEach(([t, f], i) => bloop(S, dryAt(i - 1 ? 0.3 : -0.3, 0.15), { start: t, f, gain: 0.05 }));
  [[116.5, 1500, -0.2], [117.0, 2100, 0.3], [117.35, 1300, 0], [117.75, 1800, 0.45]].forEach(([t, f, pan]) => tick(S, dryAt(pan, 0.1), { start: t, f, tau: 0.006, gain: 0.07, noise: 1, hp: 800 }));

  // S14 02:02.0: going under, a soft whoomp as the soil closes over; then a hiss of grains per band
  thud(S, S.out({}), { start: 122.0, f: [78, 36], glide: 1.0, env: [[122.0, 0], [122.22, 1], [123.3, 0]], gain: 0.07 });
  bed(S, S.out({}), { src: 'brown', gain: [[122.0, 0], [122.3, 1], [123.6, 0]], k: 0.17, filters: [{ type: 'lowpass', f: 220 }], seed: 'whoomp' });
  for (let k = 0; k < 11; k++) {
    const t = 123 + k;   // bands settle one per second, filling from left to right
    bed(S, S.out({ dry: 1, valley: 0.2 }), { src: 'white', gain: [[t, 0], [t + 0.12, 1], [t + 0.9, 0]], k: 0.09, filters: [{ type: 'lowpass', f: 1300 }, { type: 'lowpass', f: 2200 }, { type: 'highpass', f: 250 }], am: { hz: 50, depth: 0.5 }, pan: [[t, -0.6], [t + 0.8, 0.6]], seed: 'band' + k });
  }

  // S15 02:22.0: the husk splits, a small soft echo of the ice crack; fibrous creaks; a ping per band
  shot(S, S.out({ pan: 0.1, dry: 1, valley: 0.3 }), 'husk', 142.0, { gain: 0.24, lowpass: 5500 });
  const r2 = createRng('fibres'), fib = S.out({ dry: 1, valley: 0.15 });
  for (let t = 142.5; t < 152.4; t += 0.5 + r2() * 0.9) {
    const f = 520 + r2() * 500;
    creak(S, fib, { start: t, dur: 0.1 + r2() * 0.2, f: [f, f * (0.75 + r2() * 0.5)], ratio: 1.7, index: 3, stutter: [60 + r2() * 30, 35], band: [1700, 3000], q: 4, gain: 0.03 });
  }
  const pingOut = S.out({ dry: 0.8, valley: 0.7 });
  ['A2', 'B2', 'D3', 'E3', 'F#3', 'A3', 'B3', 'D4', 'E4', 'F#4', 'A4'].forEach((n, k) => {
    const f = hz(n) * (k < 5 ? 16 : k < 9 ? 8 : 4);
    glass(S, pingOut, { freq: f, start: 144.5 + 0.8 * k, gain: 0.022 + 0.002 * k, decay: 1.6, index: 0.7, pan: -0.6 + k * 0.12 });
  });

  // S16: a dew drip, and at 02:36.5 the first birdsong of the film; a second voice answers at 02:38.5
  bloop(S, dryAt(-0.2, 0.3), { start: 155.3, f: 1350, gain: 0.05 });
  const BIRD_A = [{ dt: 0, f: [3300, 4700], dur: 0.09 }, { dt: 0.14, f: [3400, 4900], dur: 0.09 }, { dt: 0.28, f: [3500, 5100], dur: 0.1 },
    { dt: 0.46, f: [5200, 4300], dur: 0.05, a: 0.8 }, { dt: 0.53, f: [5200, 4300], dur: 0.05, a: 0.8 }, { dt: 0.6, f: [5200, 4300], dur: 0.05, a: 0.8 }, { dt: 0.67, f: [5300, 4200], dur: 0.05, a: 0.7 }, { dt: 0.74, f: [5300, 4000], dur: 0.07, a: 0.6 }];
  const BIRD_B = [{ dt: 0, f: [4300, 3100, 3300], dur: 0.16 }, { dt: 0.26, f: [4100, 2900, 3100], dur: 0.17 }, { dt: 0.56, f: [2800, 3600], dur: 0.07 }, { dt: 0.66, f: [2800, 3700], dur: 0.07 }, { dt: 0.76, f: [2900, 3900], dur: 0.09 }];
  const BIRD_C = [{ dt: 0, f: [2100, 2500, 2300], dur: 0.22 }, { dt: 0.3, f: [2600, 2200], dur: 0.18 }, { dt: 0.58, f: [1900, 2700, 2500], dur: 0.26 }, { dt: 0.95, f: [3000, 2400], dur: 0.12, a: 0.7 }];
  const perchA = S.out({ pan: -0.45, dry: 0.7, valley: 0.6 }), perchB = S.out({ pan: 0.5, dry: 0.55, valley: 0.7 });
  bird(S, perchA, { start: 156.5, syl: BIRD_A, gain: 0.08 });
  bird(S, perchB, { start: 158.5, syl: BIRD_B, gain: 0.07 });
  bird(S, perchA, { start: 160.3, syl: BIRD_A.slice(0, 5), gain: 0.06 });
  bird(S, perchB, { start: 161.1, syl: BIRD_B.slice(2), gain: 0.055 });

  // S17: soft wooden creaks of growth
  [[165.2, 210, -0.1], [168.9, 180, 0.1], [172.4, 160, -0.05], [175.6, 140, 0.05]].forEach(([t, f, pan]) =>
    creak(S, S.out({ pan, dry: 0.8, valley: 0.4 }), { start: t, dur: 0.75, f: [f, f * 0.72], ratio: 1.33, index: 3, stutter: [34, 62], band: [650, 1500], q: 3, gain: 0.06 }));

  // S18: the golden line: a faint rising shimmer from 03:01.5, ending on the drum at 03:04.0
  const gold = S.out({ dry: 0.7, valley: 0.7 });
  bed(S, gold, { src: 'white', gain: [[181.5, 0], [183.6, 0.8], [183.98, 1], [184.03, 0]], k: 0.012, filters: [{ type: 'bandpass', f: [[181.5, 2500], [184, 9000]], q: 2 }], am: { hz: 30, depth: 0.5 }, pan: [[181.5, -0.7], [184, 0.7]], seed: 'gold' });
  ['D6', 'E6', 'F#6', 'A6', 'B6', 'D7', 'E7', 'F#7', 'A7', 'B7', 'D8'].forEach((n, k) => glass(S, gold, { note: n, start: 181.6 + k * 0.22, gain: 0.012 + 0.0016 * k, decay: 1.2, index: 0.6, pan: -0.8 + k * 0.16 }));
  // evening birds
  const eve = S.out({ pan: 0.55, dry: 0.5, valley: 0.8 }), eve2 = S.out({ pan: -0.6, dry: 0.45, valley: 0.8 });
  bird(S, eve, { start: 186.6, syl: BIRD_C, gain: 0.04 });
  bird(S, eve2, { start: 188.9, syl: BIRD_B.slice(0, 2), gain: 0.03 });
  bird(S, eve, { start: 190.6, syl: BIRD_C.slice(0, 3), gain: 0.035 });
  bird(S, eve2, { start: 192.4, syl: BIRD_C.slice(1), gain: 0.028 });

  // S21: one ice creak at 03:42.0 as everything stops
  iceCreak(S, 222.0, 0.35, { dur: 2.4, gain: 0.08 });
  pew(S, S.out({ dry: 0.3, hall: 1 }), { start: 222.8, gain: 0.03 });
}

// ============================================================================== CREDITS 227-238.5
// M14: one second of silence, then the withheld note: GLASS F sharp 5 at 03:47.0, over the softest
// STRINGS D and A.
function stemCredits(S) {
  const bell = S.out({ dry: 0.85, hall: 0.8 });
  glass(S, bell, { note: 'F#5', start: 227.0, gain: 0.17, decay: 8, index: 1.2 });
  glass(S, bell, { note: 'F#6', start: 227.0, gain: 0.03, decay: 5, index: 0.8, pan: 0.2 });
  strings(S, S.out({ dry: 0.75, hall: 0.6 }), { notes: ['D3', 'A3'], env: [[227.0, 0], [229.6, 1], [233, 0.7], [238.3, 0]], gain: 0.036, cut: [280, 1200], seed: 'm14' });
}

// ================================================================================= mix and master
// A reel is a stretch of film between two hard edits. It is only heard between `on` and `off`
// (sample-exact), with `fade` seconds of fade-out before `off`; its reverbs never cross an edit.
const REELS = [
  { name: 'A', on: 0, off: 30.5, fade: 0.03, gain: 0.75, stems: { prologue: stemPrologue } },
  { name: 'B', on: 31, off: 226, fade: 0.004, stems: { strings: stemStrings, keys: stemKeys, ambience: stemAmbience, spots: stemSpots, melt: stemMelt } },
  { name: 'C', on: 227, off: 238.5, fade: 3, gain: 0.8, stems: { credits: stemCredits } },
];
const WINDOW = 12;   // seconds of cue sheet per chunk context

/** Render one reel: chunks in parallel (dry + two reverb sends), then the two convolutions. */
async function renderReel(reel, assets, sr, solo, timing, now, only, conv) {
  const builders = Object.entries(reel.stems).filter(([name]) => !solo || solo.includes(name)).map(([, fn]) => fn);
  const n = Math.round((reel.off - reel.on) * sr);
  const bus = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(n));   // dry L R, hall L R, valley L R
  if (!builders.length) return [bus[0], bus[1]];
  // pass 1: learn where each window's last event ends
  const probe = { t0: reel.on, W: WINDOW, ends: [] };
  const P = new Stem({ assets, sr, limit: reel.off, probe, only });
  for (const b of builders) b(P);
  // pass 2: one context per window, all at once (each renders on its own thread)
  const chunks = await Promise.all(probe.ends.map((end, k) => {
    if (!end) return null;
    const a = reel.on + k * WINDOW;
    const S = new Stem({ assets, sr, origin: a, win: [k === 0 ? -Infinity : a, a + WINDOW], seconds: end - a + 0.02, limit: reel.off, only });
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
  // the reverbs: hall and valley sends, convolved in JS (bit-reproducible, unlike a ConvolverNode)
  const L = bus[0], R = bus[1];
  for (const [ir, c] of [['ir:hall', 2], ['ir:valley', 4]]) await convolveInto(conv.plan, conv.spectra(ir), bus[c], bus[c + 1], L, R, conv.tick);
  timing['reverb:' + reel.name] = Math.round(now());
  return [L, R];
}

/**
 * @param {OfflineAudioContext} ctx
 * @param {number} duration seconds
 * @param {{solo?: string[], master?: boolean, now?: () => number}} [opts]
 *        solo: render only these stems (prologue strings keys ambience spots credits);
 *        only: render only these instrument kinds (strings horn glass kalimba piano drum heart sub bed shot ...);
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
  const reels = await Promise.all(REELS.map((reel) => renderReel(reel, assets, sr, opts.solo, timing, now, opts.only, conv)));

  const L = new Float32Array(N), R = new Float32Array(N);
  const hp = biquad('hp', 12, 0.707, sr);
  const stats = { reels: {}, timing };
  REELS.forEach((reel, k) => {
    const [l, r] = reels[k];
    filt(l, hp); filt(r, hp);   // before the edit, so the filter cannot ring into a silence
    stats.reels[reel.name] = +peakDb(l, r).toFixed(2);
    const i0 = Math.round(reel.on * sr), n = Math.min(l.length, N - i0), nf = Math.round(reel.fade * sr), rg = reel.gain ?? 1;
    for (let i = 0; i < n; i++) {
      let g = 1;
      if (i >= n - nf) { const x = (n - i) / nf; g = x * x * (3 - 2 * x); }
      L[i0 + i] = l[i] * g * rg; R[i0 + i] = r[i] * g * rg;
    }
  });
  timing.mixed = Math.round(now());

  if (opts.master !== false) {
    const ceiling = dbToGain(CEILING_DB);
    let gain = opts.masterGain ?? dbToGain(TARGET_LUFS - loudness(L, R, sr)), l, r, lim, lu;
    for (let it = 0; it < 3; it++) {
      l = Float32Array.from(L); r = Float32Array.from(R);
      lim = limit(l, r, sr, { ceiling, gain, lookahead: 0.005, release: 0.15 });
      lu = loudness(l, r, sr);
      if (opts.masterGain !== undefined || Math.abs(TARGET_LUFS - lu) < 0.03) break;
      gain *= dbToGain(TARGET_LUFS - lu);
    }
    L.set(l); R.set(r);
    Object.assign(stats, { lufs: +lu.toFixed(2), gainDb: +(20 * Math.log10(gain)).toFixed(2), masterGain: gain, limiterMaxDb: +lim.maxReduction.toFixed(2), limitedSeconds: +lim.limitedSeconds.toFixed(3), limiterOver1234dB: lim.over, limiterEvents: lim.events, peakDb: +peakDb(L, R).toFixed(2) });
  }
  timing.total = Math.round(now());
  renderScore.stats = stats;

  const out = ctx.createBuffer(2, ctx.length, sr);
  out.copyToChannel(L, 0); out.copyToChannel(R, 1);
  const src = ctx.createBufferSource();
  src.buffer = out; src.connect(ctx.destination); src.start(0);
}
