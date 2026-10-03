// Pure-JS DSP for the score: seeded noise, biquads, generated reverb impulse responses, granular
// textures (water, rain, fire, leaves ...), the one-shot effects that need sample-exact control
// (ice crack, thunder, rockfall) and the mastering tools (BS.1770 loudness meter, look-ahead limiter).
// Nothing here touches the Web Audio API; everything is deterministic (seeded) Float32Array maths.

import { createRng } from '../lib/random.js';

export const TAU = Math.PI * 2;
export const dbToGain = (d) => Math.pow(10, d / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ------------------------------------------------------------------------------------------ noise
export function white(n, seed) {
  const r = createRng(seed), a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
  return a;
}
export function pink(n, seed) {
  const r = createRng(seed), a = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return a;
}
export function brown(n, seed) {
  const r = createRng(seed), a = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; a[i] = last * 3.5; }
  return a;
}
/** Make a mono array loop seamlessly (equal-power crossfade of the tail into the head). */
export function loopable(a, fade) {
  const n = a.length - fade, out = new Float32Array(n);
  out.set(a.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = a[i] * Math.sin(k * Math.PI / 2) + a[n + i] * Math.cos(k * Math.PI / 2);
  }
  return out;
}

// ---------------------------------------------------------------------------------------- biquads
/** RBJ cookbook coefficients [b0, b1, b2, a1, a2] (normalised). type: lp | hp | bp | hs | ls | pk */
export function biquad(type, f, q, sr, gainDb = 0) {
  const w = TAU * Math.min(f, sr * 0.49) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'pk') { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  else {
    const sq = 2 * Math.sqrt(A) * al, hs = type === 'hs' ? 1 : -1;
    b0 = A * ((A + 1) + hs * (A - 1) * c + sq); b1 = -hs * 2 * A * ((A - 1) + hs * (A + 1) * c);
    b2 = A * ((A + 1) + hs * (A - 1) * c - sq); a0 = (A + 1) - hs * (A - 1) * c + sq;
    a1 = hs * 2 * ((A - 1) - hs * (A + 1) * c); a2 = (A + 1) - hs * (A - 1) * c - sq;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
/** Run a biquad over x into y (may be the same array). */
export function filt(x, co, y = x) {
  const b0 = co[0], b1 = co[1], b2 = co[2], a1 = co[3], a2 = co[4];
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b0 * v + z1;
    z1 = b1 * v - a1 * o + z2; z2 = b2 * v - a2 * o;
    y[i] = o;
  }
  return y;
}
const panGains = (pan) => { const a = (clamp01((pan + 1) / 2)) * Math.PI / 2; return [Math.cos(a), Math.sin(a)]; };

// ------------------------------------------------------------------------- reverb impulse responses
/**
 * True-stereo (4 channel: L>L, L>R, R>L, R>R) impulse response: band-wise decaying noise (each band
 * has its own RT60, so the tail darkens or stays glassy as asked), a short build-up, discrete early
 * reflections and optional distinct echoes ("valley"). The tail is energy-normalised so that a
 * sustained source comes back at about its own level (times the send gain).
 */
export function makeIR(sr, { seconds, predelay = 0.02, bands, buildup = 0.02, early = { count: 10, span: 0.08, gain: 0.2 }, echoes = [], cross = 0.7, crossDelay = 0.007, seed = 'ir' }) {
  const n = Math.ceil((seconds + predelay + crossDelay + 0.05) * sr);
  const tmp = new Float32Array(n);
  const chans = [];
  for (let c = 0; c < 4; c++) {
    const isCross = c === 1 || c === 2;
    const noise = white(n, `${seed}:n${c}`);
    const tail = new Float32Array(n);
    bands.forEach(([fc, rt, g], bi) => {
      const type = bi === 0 ? 'lp' : bi === bands.length - 1 ? 'hp' : 'bp';
      filt(noise, biquad(type, fc, type === 'bp' ? 1.3 : 0.7, sr), tmp);
      const k = -6.9078 / (rt * sr);
      for (let i = 0; i < n; i++) tail[i] += tmp[i] * g * Math.exp(k * i);
    });
    let e = 0;
    const bu = buildup * sr;
    for (let i = 0; i < n; i++) { tail[i] *= 1 - Math.exp(-i / bu); e += tail[i] * tail[i]; }
    const norm = 1 / Math.sqrt(e * (1 + cross * cross)) * (isCross ? cross : 1);
    const pre = Math.round((predelay + (isCross ? crossDelay : 0)) * sr);
    const out = new Float32Array(n);
    for (let i = 0; i + pre < n; i++) out[i + pre] = tail[i] * norm;
    const r = createRng(`${seed}:e${c}`);
    for (let k = 0; k < early.count; k++) {
      const t = 0.003 + Math.pow(r(), 1.4) * early.span;
      const a = early.gain * (1 - 0.8 * t / early.span) * (r() < 0.5 ? -1 : 1) * (0.45 + 0.55 * r()) * (isCross ? cross : 1);
      const at = Math.round((predelay * 0.4 + t) * sr);
      out[at] += a; out[at + 1] += a * 0.5;
    }
    for (const ec of echoes) {
      // a blurred slap: a short low-passed noise blob, slightly different per channel
      const t = ec.t * (1 + (r() - 0.5) * 0.06) + (isCross ? 0.011 : 0) + (c >= 2 ? (ec.skew || 0) : 0);
      const len = Math.round((ec.blur || 0.012) * sr), at = Math.round(t * sr);
      let lp = 0;
      const a = 1 - Math.exp(-TAU * (ec.lp || 2500) / sr);
      // unit-energy blob, so ec.gain is the level of the echo relative to the source
      const k = ec.gain * (isCross ? cross : 1) / Math.sqrt(len * 0.5 * (a / (2 - a)) / 3);
      for (let i = 0; i < len && at + i < n; i++) {
        lp += ((r() * 2 - 1) - lp) * a;
        out[at + i] += lp * k * Math.sin(Math.PI * i / len);
      }
    }
    chans.push(out);
  }
  return chans;
}

// -------------------------------------------------------------------------------------- grain kit
function addChirp(L, R, at, sr, { f0, f1, glide, tau, amp, pan, attack = 0.0006 }, wrap) {
  const len = Math.ceil((tau * 6 + attack) * sr), [gl, gr] = panGains(pan), N = L.length;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / glide);
    ph += TAU * f / sr;
    const v = Math.sin(ph) * amp * (1 - Math.exp(-t / attack)) * Math.exp(-t / tau);
    let j = at + i;
    if (j >= N) { if (!wrap) break; j %= N; }
    L[j] += v * gl; R[j] += v * gr;
  }
}
function addNoiseGrain(L, R, at, sr, rng, { hp = 200, lp = 8000, tau, amp, pan, attack = 0.0002 }, wrap) {
  const len = Math.ceil((tau * 6 + attack) * sr), [gl, gr] = panGains(pan), N = L.length;
  const aL = 1 - Math.exp(-TAU * lp / sr), aH = 1 - Math.exp(-TAU * hp / sr);
  let sl = 0, sh = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr, x = rng() * 2 - 1;
    sl += (x - sl) * aL; sh += (sl - sh) * aH;
    const v = (sl - sh) * amp * (attack > 0 ? 1 - Math.exp(-t / attack) : 1) * Math.exp(-t / tau);
    let j = at + i;
    if (j >= N) { if (!wrap) break; j %= N; }
    L[j] += v * gl; R[j] += v * gr;
  }
}
function normalize(chs, mode, target) {
  let peak = 0, sum = 0, n = 0;
  for (const a of chs) for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > peak) peak = v; sum += v * v; n++; }
  const k = mode === 'peak' ? target / (peak || 1) : target / (Math.sqrt(sum / n) || 1);
  for (const a of chs) for (let i = 0; i < a.length; i++) a[i] *= k;
  return chs;
}
const logRand = (r, lo, hi) => lo * Math.pow(hi / lo, r());

/** Bubble / drip texture: many short rising sine chirps (the actual mechanism of running water). */
export function bubbles(sr, { seconds, rate, fLo, fHi, tau = [0.004, 0.02], rise = [1.1, 1.5], seed, norm = 0.1, skew = 1 }) {
  const N = Math.round(seconds * sr), L = new Float32Array(N), R = new Float32Array(N), r = createRng(seed);
  const count = Math.round(seconds * rate);
  for (let k = 0; k < count; k++) {
    const f = fLo * Math.pow(fHi / fLo, Math.pow(r(), skew));
    const t = tau[0] + (tau[1] - tau[0]) * r() * Math.sqrt(fLo / f) * 2;
    addChirp(L, R, Math.floor(r() * N), sr, {
      f0: f, f1: f * (rise[0] + (rise[1] - rise[0]) * r()), glide: t * 0.8, tau: Math.max(0.002, t),
      amp: Math.pow(r(), 2.2) + 0.03, pan: r() * 2 - 1,
    }, true);
  }
  return normalize([L, R], 'rms', norm);
}
/** Dense noise-grain texture (rain, leaves, fire crackle, frost ...). */
export function grains(sr, { seconds, rate, fc = [2000, 8000], bw = 2.5, tau = [0.001, 0.005], ampPow = 2, seed, norm = 0.1, normMode = 'rms' }) {
  const N = Math.round(seconds * sr), L = new Float32Array(N), R = new Float32Array(N), r = createRng(seed);
  const count = Math.round(seconds * rate);
  for (let k = 0; k < count; k++) {
    const f = logRand(r, fc[0], fc[1]);
    addNoiseGrain(L, R, Math.floor(r() * N), sr, r, {
      hp: f / bw, lp: f * bw, tau: tau[0] + (tau[1] - tau[0]) * r(), amp: Math.pow(r(), ampPow) + 0.02, pan: r() * 2 - 1,
    }, true);
  }
  return normalize([L, R], normMode, norm);
}
/** Sparse pitched pings (crystalline ticks of ice bubbles; brittle taps). */
export function pings(sr, { seconds, rate, f = [5000, 11000], tau = [0.004, 0.02], seed, norm = 0.5 }) {
  const N = Math.round(seconds * sr), L = new Float32Array(N), R = new Float32Array(N), r = createRng(seed);
  const count = Math.round(seconds * rate);
  for (let k = 0; k < count; k++) {
    const fq = logRand(r, f[0], f[1]);
    addChirp(L, R, Math.floor(r() * N), sr, { f0: fq, f1: fq * 0.995, glide: 0.01, tau: tau[0] + (tau[1] - tau[0]) * r(), amp: 0.25 + 0.75 * Math.pow(r(), 2), pan: r() * 2 - 1, attack: 0.0002 }, true);
  }
  return normalize([L, R], 'peak', norm);
}

// ----------------------------------------------------------------------------- one-shot: the crack
/**
 * The ice crack (scale 1) and its small echo, the husk splitting (scale ~0.12): a sharp broadband
 * transient on the very first sample, a fast descending "dispersion" chirp (the sound a frozen lake
 * makes), side-branch snaps, and a splintering tail of high clicks that runs left to right.
 */
export function crack(sr, { scale = 1, seed = 'crack' } = {}) {
  const big = scale >= 0.5;
  const seconds = big ? 3.4 : 1.1;
  const N = Math.round(seconds * sr), L = new Float32Array(N), R = new Float32Array(N), r = createRng(seed);
  // 1. the snap: noise burst, instant attack
  addNoiseGrain(L, R, 0, sr, r, { hp: big ? 500 : 900, lp: big ? 16000 : 6000, tau: big ? 0.007 : 0.003, amp: 1.5, pan: 0, attack: 0 }, false);
  addNoiseGrain(L, R, 0, sr, r, { hp: 90, lp: big ? 2200 : 1500, tau: big ? 0.03 : 0.01, amp: big ? 1.1 : 0.6, pan: 0.1, attack: 0 }, false);
  if (big) {
    // body: a short low knock under the snap
    addChirp(L, R, 0, sr, { f0: 210, f1: 62, glide: 0.03, tau: 0.07, amp: 0.9, pan: 0, attack: 0.0003 }, false);
  }
  // 2. dispersion chirps, descending fast
  const chirps = big ? [[0, 9500, 420, 0.05, 0.16, 0.55, -0.25], [0.012, 7200, 300, 0.07, 0.22, 0.4, 0.3], [0.05, 5200, 240, 0.1, 0.3, 0.22, 0]]
    : [[0, 5200, 500, 0.03, 0.07, 0.5, 0], [0.01, 3800, 380, 0.04, 0.1, 0.3, 0.2]];
  for (const [t, f0, f1, glide, tau, amp, pan] of chirps) addChirp(L, R, Math.round(t * sr), sr, { f0, f1, glide, tau, amp, pan, attack: 0.0002 }, false);
  // 3. side branches: smaller snaps, each with its own little chirp
  const branches = big ? 5 : 2;
  for (let k = 0; k < branches; k++) {
    const t = big ? 0.16 + (k / branches) * 1.7 + r() * 0.2 : 0.07 + k * 0.11 + r() * 0.05;
    const pan = big ? -0.6 + 1.3 * (k / (branches - 1)) + (r() - 0.5) * 0.3 : (r() - 0.5);
    const a = (big ? 0.42 : 0.3) * (0.6 + 0.4 * r()) * Math.exp(-t / 1.6);
    addNoiseGrain(L, R, Math.round(t * sr), sr, r, { hp: 1200, lp: big ? 12000 : 5000, tau: 0.004, amp: a * 1.6, pan, attack: 0 }, false);
    const f0 = logRand(r, 3500, 7500) * (big ? 1 : 0.6);
    addChirp(L, R, Math.round(t * sr), sr, { f0, f1: f0 * 0.12, glide: 0.035, tau: 0.09, amp: a * 0.6, pan, attack: 0.0002 }, false);
  }
  // 4. splinters: high clicks, density and level dying away, travelling left to right
  const span = big ? 2.7 : 0.7, clicks = big ? 190 : 26, td = big ? 0.75 : 0.25;
  for (let k = 0; k < clicks; k++) {
    const t = 0.012 - td * Math.log(1 - r() * (1 - Math.exp(-span / td)));
    const f = logRand(r, big ? 2600 : 1800, big ? 12000 : 6500);
    const pan = Math.max(-1, Math.min(1, -0.85 + 1.75 * Math.pow(t / span, 0.75) + (r() - 0.5) * 0.35));
    const a = (0.1 + 0.5 * Math.pow(r(), 2.5)) * Math.exp(-t / (td * 1.3));
    if (r() < 0.55) addChirp(L, R, Math.round(t * sr), sr, { f0: f, f1: f * 0.9, glide: 0.004, tau: 0.0008 + 2.2 / f, amp: a, pan, attack: 0.0001 }, false);
    else addNoiseGrain(L, R, Math.round(t * sr), sr, r, { hp: f * 0.6, lp: f * 1.5, tau: 0.0006 + 1.5 / f, amp: a * 2.2, pan, attack: 0 }, false);
  }
  return normalize([L, R], 'peak', 0.95);
}

// ----------------------------------------------------------------------------- one-shot: thunder
/** Rolling thunder: an opening clap, then overlapping low-passed noise bursts that darken and recede. */
export function thunder(sr, { seconds = 10, seed = 'thunder' } = {}) {
  const N = Math.round(seconds * sr), out = [];
  for (let c = 0; c < 2; c++) {
    const r = createRng(`${seed}:${c}`);
    const rs = createRng(`${seed}:shape`); // shared macro-shape, per-channel detail
    const env = new Float32Array(N);
    const bursts = [[0, 1, 0.5], [0.22, 0.6, 0.6]];
    for (let k = 0; k < 11; k++) bursts.push([0.5 + rs() * 4.2, (0.25 + 0.6 * rs()) * Math.exp(-k * 0.11), 0.5 + rs() * 1.1]);
    for (const [t0, a, d] of bursts) {
      const at = Math.round((t0 + (r() - 0.5) * 0.03) * sr), rise = 0.012 * sr * (t0 === 0 ? 0.4 : 3);
      for (let i = 0; at + i < N && i < d * 6 * sr; i++) env[at + i] += a * Math.min(1, i / rise) * Math.exp(-i / (d * sr));
    }
    const n = brown(N, `${seed}:b${c}`), w = white(N, `${seed}:w${c}`), y = new Float32Array(N);
    let s1 = 0, s2 = 0, s3 = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      // cutoff falls from ~1.6 kHz (the clap) to ~110 Hz (the distant roll)
      const fc = 110 + 1500 * Math.exp(-t / 0.5) + 250 * Math.exp(-t / 2.5);
      const a = 1 - Math.exp(-TAU * fc / sr);
      const x = (n[i] * 1.2 + w[i] * 0.5 * Math.exp(-t / 0.15)) * env[i];
      s1 += (x - s1) * a; s2 += (s1 - s2) * a; s3 += (s2 - s3) * a;
      y[i] = s3 * Math.min(1, (seconds - t) / 1.5);
    }
    out.push(y);
  }
  return normalize(out, 'peak', 0.9);
}

// ----------------------------------------------------------------------------- one-shot: rockfall
/**
 * Rockfall: low rumble, a rolling mid roar, clattering debris (resonant knocks) and a gravel hiss
 * that outlasts the rest. `crackOnset` adds the deep crack of stone at the very first sample (S11).
 */
export function rockfall(sr, { seconds = 5, crackOnset = false, seed = 'rock', debris = 45, hiss = 0.5 } = {}) {
  const N = Math.round(seconds * sr), L = new Float32Array(N), R = new Float32Array(N), r = createRng(seed);
  const T = seconds;
  for (let c = 0; c < 2; c++) {
    const out = c === 0 ? L : R;
    const lo = brown(N, `${seed}:lo${c}`), mid = pink(N, `${seed}:mid${c}`), hi = white(N, `${seed}:hi${c}`);
    filt(lo, biquad('lp', 150, 0.7, sr)); filt(lo, biquad('lp', 240, 0.7, sr));
    filt(mid, biquad('bp', 520, 0.6, sr));
    filt(hi, biquad('bp', 4800, 0.7, sr));
    const rr = createRng(`${seed}:roll${c}`);
    let roll = 0, rollT = 0, g = 0, gT = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      if (i % 2400 === 0) { rollT = 0.45 + 0.55 * rr(); }
      if (i % 240 === 0) { gT = Math.pow(rr(), 2); }
      roll += (rollT - roll) * 0.0004; g += (gT - g) * 0.01;
      const att = crackOnset ? Math.min(1, t / 0.02 + 0.3) : Math.min(1, t / 0.25);
      const eLo = att * Math.exp(-t / (T * 0.3));
      const eMid = Math.min(1, t / 0.4) * Math.exp(-t / (T * 0.26)) * roll;
      const eHi = Math.min(1, t / 0.7) * Math.exp(-t / (T * 0.42)) * (0.35 + g * 1.3) * Math.min(1, (T - t) / 0.6);
      out[i] += lo[i] * eLo * 1.0 + mid[i] * eMid * 2.2 + hi[i] * eHi * hiss;
    }
  }
  // debris: resonant knocks, dense at first, thinning out
  const count = Math.round(debris * seconds);
  for (let k = 0; k < count; k++) {
    const t = 0.05 - (T * 0.28) * Math.log(1 - r() * 0.97);
    if (t > T - 0.1) continue;
    const f = logRand(r, 110, 1500), pan = r() * 1.6 - 0.8, a = (0.08 + 0.5 * Math.pow(r(), 3)) * Math.exp(-t / (T * 0.45));
    addChirp(L, R, Math.round(t * sr), sr, { f0: f * 1.25, f1: f, glide: 0.006, tau: 0.004 + 6 / f * (0.5 + r()), amp: a, pan, attack: 0.0003 }, false);
    addNoiseGrain(L, R, Math.round(t * sr), sr, r, { hp: f, lp: f * 5, tau: 0.004, amp: a * 1.5, pan, attack: 0 }, false);
  }
  if (crackOnset) {
    // the deep crack of stone: hard, low-mid, with two after-shocks
    for (const [t, a] of [[0, 1], [0.055, 0.5], [0.13, 0.35]]) {
      const at = Math.round(t * sr);
      addNoiseGrain(L, R, at, sr, r, { hp: 150, lp: 3200, tau: 0.014, amp: 2.4 * a, pan: 0.15, attack: 0 }, false);
      addNoiseGrain(L, R, at, sr, r, { hp: 1500, lp: 9000, tau: 0.004, amp: 1.2 * a, pan: 0.2, attack: 0 }, false);
      addChirp(L, R, at, sr, { f0: 92, f1: 40, glide: 0.09, tau: 0.3, amp: 1.2 * a, pan: 0, attack: 0.0005 }, false);
    }
  }
  return normalize([L, R], 'peak', 0.92);
}

// ---------------------------------------------------------------------------------------- loudness
/** Integrated loudness (ITU-R BS.1770-4, K-weighting, gated), 48 kHz coefficients. */
export function loudness(L, R, sr) {
  const k1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const k2 = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const nb = Math.max(0, Math.floor((L.length - block) / hop) + 1);
  const z = new Float64Array(nb);
  const hops = Math.floor(L.length / hop);
  const hopE = new Float64Array(hops);
  for (const ch of [L, R]) {
    let a1 = 0, a2 = 0, c1 = 0, c2 = 0, acc = 0, h = 0, cnt = 0;
    for (let i = 0; i < hops * hop; i++) {
      const v = ch[i];
      const o = k1[0] * v + a1; a1 = k1[1] * v - k1[3] * o + a2; a2 = k1[2] * v - k1[4] * o;
      const p = k2[0] * o + c1; c1 = k2[1] * o - k2[3] * p + c2; c2 = k2[2] * o - k2[4] * p;
      acc += p * p;
      if (++cnt === hop) { hopE[h++] += acc; acc = 0; cnt = 0; }
    }
  }
  for (let j = 0; j < nb; j++) z[j] = (hopE[j] + hopE[j + 1] + hopE[j + 2] + hopE[j + 3]) / block;
  const lk = (m) => -0.691 + 10 * Math.log10(Math.max(m, 1e-12));
  let s = 0, c = 0;
  for (let j = 0; j < nb; j++) if (lk(z[j]) > -70) { s += z[j]; c++; }
  if (!c) return -Infinity;
  const rel = lk(s / c) - 10;
  s = 0; c = 0;
  for (let j = 0; j < nb; j++) if (lk(z[j]) > -70 && lk(z[j]) > rel) { s += z[j]; c++; }
  return c ? lk(s / c) : -Infinity;
}

/** Peak of the 2x-oversampled stereo signal (half-sample points by an 8-tap Hann-windowed sinc). */
const HB = [-0.0035, 0.0392, -0.1462, 0.6105, 0.6105, -0.1462, 0.0392, -0.0035];
function peakEnvelope(L, R) {
  const n = L.length, pk = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    let m = a > b ? a : b;
    if (i >= 3 && i < n - 4) {
      let ml = 0, mr = 0;
      for (let k = 0; k < 8; k++) { ml += L[i - 3 + k] * HB[k]; mr += R[i - 3 + k] * HB[k]; }
      ml = Math.abs(ml); mr = Math.abs(mr);
      const h = ml > mr ? ml : mr;
      // the half-sample point lies between i and i + 1: charge it to both neighbours
      if (h > m) m = h;
      if (h > pk[i + 1]) pk[i + 1] = h;
    }
    if (m > pk[i]) pk[i] = m;
  }
  return pk;
}

/**
 * Zero-latency look-ahead limiter (stereo-linked). The required gain is held and released, then the
 * sliding minimum over the next `lookahead` seconds is box-smoothed over the same length, so the
 * full reduction is reached exactly on the peak and the result never exceeds the ceiling.
 * Returns { maxReduction (dB), limitedSeconds }.
 */
export function limit(L, R, sr, { ceiling = 0.86, lookahead = 0.005, release = 0.12, gain = 1 } = {}) {
  const n = L.length;
  if (gain !== 1) for (let i = 0; i < n; i++) { L[i] *= gain; R[i] *= gain; }
  const pk = peakEnvelope(L, R);
  const W = Math.max(2, Math.round(lookahead * sr));
  const g = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) { g[i] = pk[i] > ceiling ? ceiling / pk[i] : 1; if (g[i] < 1) any = true; }
  if (!any) return { maxReduction: 0, limitedSeconds: 0 };
  const rc = 1 - Math.exp(-1 / (release * sr));
  let cur = 1;
  for (let i = 0; i < n; i++) { cur += (1 - cur) * rc; if (g[i] < cur) cur = g[i]; g[i] = cur; }
  // m[i] = min g[i .. i + W - 1]  (van Herk / Gil-Werman)
  const fwd = new Float32Array(n), bwd = new Float32Array(n);
  for (let i = 0; i < n; i++) fwd[i] = i % W === 0 ? g[i] : Math.min(fwd[i - 1], g[i]);
  for (let i = n - 1; i >= 0; i--) bwd[i] = (i % W === W - 1 || i === n - 1) ? g[i] : Math.min(bwd[i + 1], g[i]);
  let acc = 0, minG = 1, lim = 0;
  const over = [0, 0, 0, 0], events = [];   // seconds with more than 1, 2, 3, 4 dB of reduction; worst moments
  let evT = -1, evG = 1;
  for (let i = 0; i < n; i++) {
    const mi = Math.min(bwd[i], fwd[Math.min(n - 1, i + W - 1)]);
    g[i] = mi;                       // g is no longer needed at index i (fwd/bwd hold what we need)
    acc += mi;
    if (i >= W) acc -= g[i - W];
    const gg = Math.min(1, acc / Math.min(i + 1, W));
    L[i] *= gg; R[i] *= gg;
    if (gg < minG) minG = gg;
    if (gg < 0.995) lim++;
    if (gg < 0.891) { over[0]++; if (gg < 0.794) { over[1]++; if (gg < 0.708) { over[2]++; if (gg < 0.631) over[3]++; } } }
    // log the deepest reduction of each half second in which the limiter worked more than 2 dB
    const sec = Math.floor(i / (sr / 2));
    if (sec !== evT) { if (evG < 0.794) events.push([evT / 2, +(-gainToDb(evG)).toFixed(1)]); evT = sec; evG = 1; }
    if (gg < evG) evG = gg;
  }
  return { maxReduction: -gainToDb(minG), limitedSeconds: lim / sr, over: over.map((x) => +(x / sr).toFixed(2)), events };
}

/** Peak (sample) of a stereo pair, in dBFS. */
export function peakDb(L, R) {
  let p = 0;
  for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p) p = a; if (b > p) p = b; }
  return gainToDb(p);
}

// ------------------------------------------------------------------------------------- convolution
// The reverbs are convolved here rather than in a ConvolverNode: the browser's convolver is not
// bit-reproducible from run to run (its vector code depends on buffer alignment), and the film has
// to render identically every time.

/** Radix-2 complex FFT plan of size N (a power of two): tables only. */
export function fftPlan(N) {
  const bits = Math.log2(N) | 0, rev = new Uint32Array(N), cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } rev[i] = y; }
  for (let k = 0; k < N / 2; k++) { cos[k] = Math.cos((TAU * k) / N); sin[k] = Math.sin((TAU * k) / N); }
  return { N, rev, cos, sin };
}
/** In-place FFT of (re, im). inverse = true gives the unscaled inverse transform. */
export function fft(plan, re, im, inverse = false) {
  const { N, rev, cos, sin } = plan;
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  const sg = inverse ? 1 : -1;
  for (let half = 1, step = N >> 1; half < N; half <<= 1, step >>= 1) {
    const size = half << 1;
    for (let k = 0, t = 0; k < half; k++, t += step) {
      const wr = cos[t], wi = sg * sin[t];
      for (let j = k; j < N; j += size) {
        const m = j + half;
        const xr = re[m] * wr - im[m] * wi, xi = re[m] * wi + im[m] * wr;
        re[m] = re[j] - xr; im[m] = im[j] - xi;
        re[j] += xr; im[j] += xi;
      }
    }
  }
}
/** Half-spectra (k = 0 .. N/2) of the four channels of a true-stereo impulse response. */
export function irSpectra(plan, chs) {
  const { N } = plan, H = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let p = 0; p < 2; p++) {           // two real channels per complex transform
    re.fill(0); im.fill(0);
    re.set(chs[2 * p]); im.set(chs[2 * p + 1]);
    fft(plan, re, im);
    const ar = new Float32Array(N / 2 + 1), ai = new Float32Array(N / 2 + 1), br = new Float32Array(N / 2 + 1), bi = new Float32Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) {
      const kk = (N - k) % N, zr = re[k], zi = im[k], cr = re[kk], ci = -im[kk];   // Z(k), conj(Z(N-k))
      ar[k] = (zr + cr) / 2; ai[k] = (zi + ci) / 2;        // first channel
      br[k] = (zi - ci) / 2; bi[k] = -(zr - cr) / 2;       // second channel = (Z - conj Z') / 2i
    }
    H.push([ar, ai], [br, bi]);
  }
  return { H, len: chs[0].length };     // H = [L>L, L>R, R>L, R>R]
}
/**
 * True-stereo convolution of (l, r) with an impulse response, added into (outL, outR). Works in
 * blocks of N - irLength samples; silent blocks are skipped. `tick` (optional, async) is awaited
 * between blocks so a page stays responsive.
 */
export async function convolveInto(plan, spectra, l, r, outL, outR, tick) {
  const { N } = plan, { H, len } = spectra, n = l.length, B = N - len + 1;
  const [LL, LR, RL, RR] = H;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s0 = 0; s0 < n; s0 += B) {
    const cnt = Math.min(B, n - s0);
    let any = false;
    for (let i = 0; i < cnt; i++) if (l[s0 + i] !== 0 || r[s0 + i] !== 0) { any = true; break; }
    if (!any) continue;
    re.fill(0); im.fill(0);
    for (let i = 0; i < cnt; i++) { re[i] = l[s0 + i]; im[i] = r[s0 + i]; }
    fft(plan, re, im);
    for (let k = 0; k <= N / 2; k++) {
      const kk = (N - k) % N, zr = re[k], zi = im[k], cr = re[kk], ci = -im[kk];
      const xlr = (zr + cr) / 2, xli = (zi + ci) / 2, xrr = (zi - ci) / 2, xri = -(zr - cr) / 2;
      // left and right outputs for this bin
      const ylr = xlr * LL[0][k] - xli * LL[1][k] + xrr * RL[0][k] - xri * RL[1][k];
      const yli = xlr * LL[1][k] + xli * LL[0][k] + xrr * RL[1][k] + xri * RL[0][k];
      const yrr = xlr * LR[0][k] - xli * LR[1][k] + xrr * RR[0][k] - xri * RR[1][k];
      const yri = xlr * LR[1][k] + xli * LR[0][k] + xrr * RR[1][k] + xri * RR[0][k];
      // W = YL + i YR at k, and conj(YL) + i conj(YR) at N - k
      re[k] = ylr - yri; im[k] = yli + yrr;
      if (kk !== k) { re[kk] = ylr + yri; im[kk] = yrr - yli; }
    }
    fft(plan, re, im, true);
    const m = Math.min(N, n - s0), inv = 1 / N;
    for (let i = 0; i < m; i++) { outL[s0 + i] += re[i] * inv; outR[s0 + i] += im[i] * inv; }
    if (tick) await tick();
  }
}
