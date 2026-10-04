// The voices of 《梦蝶》 that are computed sample by sample in JS (Float32Array in, Float32Array out):
//
//   QIN     a Karplus-Strong string with a guqin's slides and its slow wobble, on a three-peak body
//   XIAO    a breath flute: one continuous voice per phrase (tone, pitched breath, air, flutter)
//   WINGS   one flap, the flock as a cloud of thousands, and the shed scales as a spray of grains
//   and the foley that needs sample-exact shape: rail joints, umbrellas, footsteps, slow drops ...
//
// Nothing here touches the Web Audio API. Everything is seeded and deterministic. Each function
// returns [mono] or [left, right]; kit.js plays the result through a buffer source.

import { createRng } from '../lib/random.js';
import { TAU, biquad, filt, addChirp, addNoiseGrain, normalize, logRand } from './dsp.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
/** Value at time t of linear breakpoints [[t, v], ...]. */
export function at(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0] || 1); }
  return pts[pts.length - 1][1];
}
function fadeEnds(chs, sr, tail = 0.03) {
  for (const a of chs) { const n = Math.min(a.length, Math.round(tail * sr)); for (let i = 0; i < n; i++) a[a.length - 1 - i] *= i / n; }
  return chs;
}

// ============================================================================================ QIN
/**
 * One plucked note. A noise burst (low-passed: the flesh of the finger; comb-filtered: plucked at
 * 1/7 of the string) circulates in a delay line with a one-pole low-pass in the loop, so the upper
 * partials die in half a second while the fundamental sings for `t60` seconds. Two polarisations,
 * a hair apart in tuning and decay, give the two-stage decay of a real string. The delay length
 * glides: `from` -> `f` just after the attack (the slide into the note), optionally `f` -> `to`
 * later, and a 4.5 Hz wobble on the held note. Body: three resonances (180, 320, 540 Hz) and the
 * knock of the pluck. `damp` (seconds) stops the string with the finger.
 */
export function qinNote(sr, { f, from = f, glide = 0.16, glideAt = 0.03, to = null, toAt = 0, toDur = 0.2, seconds = 5, t60 = 4.5, bright = 1, soft = 0.5, attack = 0, wobble = 12, wobbleAt = 0.8, damp = null, seed = 'qin' }) {
  const N = Math.round(seconds * sr), out = new Float32Array(N), rng = createRng(`${seed}:${f}:${from}`);
  // pitch track
  const pitch = new Float32Array(N), speed = new Float32Array(N);
  const l0 = Math.log(from), l1 = Math.log(f), l2 = to ? Math.log(to) : l1, wd = (wobble / 1200) * Math.LN2;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    let l = l0 + (l1 - l0) * smooth((t - glideAt) / glide);
    if (to) l += (l2 - l1) * smooth((t - toAt) / toDur);
    if (wobble && t > wobbleAt) l += wd * Math.sin(TAU * 4.5 * (t - wobbleAt)) * smooth((t - wobbleAt) / 0.7) * Math.exp(-(t - wobbleAt) / 2.4);
    pitch[i] = Math.exp(l);
    if (i) speed[i] = Math.abs(l - Math.log(pitch[i - 1])) * sr;   // octaves-ish per second
  }
  // excitation: one period of soft noise, with the comb of the plucking point
  const P0 = sr / from, E = Math.ceil(P0), raw = new Float32Array(E), ex = new Float32Array(E);
  const ac = 1 - Math.exp(-TAU * Math.min(4800, 700 + 3800 * (1 - soft) * bright) / sr);   // silk under the finger, never a pick
  let lp = 0, mean = 0;
  for (let pass = 0; pass < 2; pass++) { const r2 = createRng(`${seed}:ex:${f}`); for (let i = 0; i < E; i++) { lp += ((r2() * 2 - 1) - lp) * ac; raw[i] = lp; } }
  const d7 = Math.round(P0 / 7);
  for (let i = 0; i < E; i++) { ex[i] = raw[i] - raw[(i - d7 + E) % E]; mean += ex[i]; }
  mean /= E;
  for (let i = 0; i < E; i++) ex[i] = (ex[i] - mean) * Math.min(1, i / 6, (E - 1 - i) / 6);
  // the string, twice
  const fMin = Math.min(from, f, to || f) * 0.96, M = Math.ceil(sr / fMin) + 8, buf = new Float32Array(M);
  for (const [cents, tm, lvl, shift] of [[0, 1, 1, 0], [2.2, 0.5, 0.55, Math.round(E * 0.37)]]) {
    buf.fill(0);
    const det = Math.pow(2, cents / 1200);
    let w = 0, s1 = 0, a = 0, g = 0, tau = 0;
    for (let i = 0; i < N; i++) {
      const fc = pitch[i] * det;
      if ((i & 63) === 0) {
        const T0 = damp !== null && i / sr > damp ? 0.16 : t60 * tm, Th = Math.min(T0, 0.48 * bright * tm);   // T60 at 0 Hz and at 3 kHz
        g = Math.pow(10, -3 / (fc * T0));
        const r = Math.pow(10, (-3 / fc) * (1 / Th - 1 / T0)), c = Math.cos(TAU * 3000 / sr), A = 1 - r * r, B = 1 - r * r * c;
        a = A > 1e-9 ? (B - Math.sqrt(Math.max(0, B * B - A * A))) / A : 0;
        const w0 = TAU * fc / sr;
        tau = Math.atan2(a * Math.sin(w0), 1 - a * Math.cos(w0)) / w0;   // phase delay of the loop filter
      }
      let pos = w - (sr / fc - tau);
      if (pos < 0) pos += M;
      const i0 = pos | 0, fr = pos - i0, x = buf[i0] * (1 - fr) + buf[i0 + 1 === M ? 0 : i0 + 1] * fr;
      s1 = (1 - a) * x + a * s1;
      const v = (i < E ? ex[(i + shift) % E] : 0) + g * s1;
      buf[w] = v; if (++w === M) w = 0;
      out[i] += v * lvl;
    }
  }
  // the knock of the pluck, and the whisper of the finger travelling along the string
  const src = Float32Array.from(out);
  let pk = 0;
  for (let i = 0; i < N; i++) if (Math.abs(out[i]) > pk) pk = Math.abs(out[i]);
  const aT = 1 - Math.exp(-TAU * 650 / sr), aS = 1 - Math.exp(-TAU * 2600 / sr), aS2 = 1 - Math.exp(-TAU * 900 / sr);
  let th = 0, sl = 0, sh = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sr, n = rng() * 2 - 1;
    if (t < 0.05) { th += (n - th) * aT; src[i] += th * pk * 1.6 * (1 - soft * 0.6) * (1 - Math.exp(-t / 0.0004)) * Math.exp(-t / 0.007); }
    sl += (n - sl) * aS; sh += (sl - sh) * aS2;
    const fr = Math.min(1, speed[i] * 0.9) * Math.exp(-t / 1.2);
    if (fr > 1e-4) out[i] += (sl - sh) * pk * 0.05 * fr;
  }
  // body
  const tmp = new Float32Array(N);
  for (const [fb, q, c] of [[180, 5, 1.0], [320, 4.5, 0.8], [540, 4, 0.6]]) {
    filt(src, biquad('bp', fb, q, sr), tmp);
    for (let i = 0; i < N; i++) out[i] += tmp[i] * c;
  }
  // level: set by the peak before the tone filter below, so that darkening a note does not make it louder
  let peak = 0;
  for (let i = 0; i < N; i++) if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
  // a gentle low-pass that follows the pitch (about the tenth harmonic, 3-4.8 kHz): wood and silk, no wire
  filt(out, biquad('lp', clamp(10 * Math.max(f, from), 3000, 4800), 0.6, sr)); filt(out, biquad('hp', 80, 0.7, sr));
  const k = 1.3 / (peak || 1);   // (the raw burst of the pluck sets this peak: 1.3 keeps the body where it was)
  for (let i = 0; i < N; i++) out[i] *= k;
  if (attack > 0) {
    // 仅指定音符展开拨弦攻击，其他琴音保持原样。
    for (let i = 0; i < Math.min(N, Math.ceil(attack * sr)); i++) out[i] *= smooth(i / (attack * sr));
  }
  return fadeEnds([out], sr, 0.05);
}

/** A harmonic (泛音): the finger only touches the string. Pure partials, a soft pluck, a slow beat. */
export function qinHarmonic(sr, { f, seconds = 6.5, decay = 6, seed = 'fan' }) {
  const N = Math.round(seconds * sr), out = new Float32Array(N), rng = createRng(`${seed}:${f}`);
  for (const [m, a, d] of [[1, 1, decay], [1.0007, 0.5, decay * 0.8], [2, 0.26, decay * 0.6], [3, 0.08, decay * 0.4], [4.02, 0.02, decay * 0.25]]) {
    const w = TAU * f * m / sr, k = -6.9078 / (d * sr), p0 = rng() * TAU;
    for (let i = 0; i < N; i++) out[i] += Math.sin(w * i + p0) * a * Math.exp(k * i) * (1 - Math.exp(-i / (0.004 * sr)));
  }
  // the pluck: a breath of noise around the pitch
  const co = biquad('bp', f, 3, sr), L = Math.round(0.08 * sr), n = new Float32Array(L);
  for (let i = 0; i < L; i++) n[i] = (rng() * 2 - 1) * Math.exp(-i / (0.009 * sr));
  filt(n, co);
  for (let i = 0; i < L; i++) out[i] += n[i] * 2.2;
  return fadeEnds(normalize([out], 'peak', 0.9), sr, 0.1);
}

// =========================================================================================== XIAO
/**
 * One phrase for one player. notes: [{ t, f, dur, vel = 0.8, slur, flutter, vib = 1, vibAt = 0.4,
 * breath = 1, tone = 1 | [[t, v], ...], env: [[t, level], ...] }] with t in seconds from the start of the phrase.
 *   slur     the note is joined to the one before (no tonguing: the pitch glides in 50 ms)
 *   flutter  0..1, an 11 Hz flutter-tongue (the wing)
 *   tone     how much pitched tone there is over the breath (0 = only air); breakpoints are in note time
 *   env      replaces the note's pressure envelope (note time); the note's `dur` still sets its end
 * The tone is a sine with weak 2nd-4th partials that brighten with breath pressure; the breath is
 * noise through a resonator tuned to the note (and its octave) plus high air; the attack has a
 * scoop of pitch and a chiff; vibrato (5 Hz) enters 0.4 s into each note; nothing is ever static.
 */
export function xiaoPhrase(sr, { notes, seconds, seed = 'xiao' }) {
  const N = Math.round(seconds * sr), out = new Float32Array(N), rng = createRng(seed);
  const press = new Float32Array(N), lpitch = new Float32Array(N), tone = new Float32Array(N), flut = new Float32Array(N), vib = new Float32Array(N), chiff = new Float32Array(N), air = new Float32Array(N);
  const ns = notes.map((n) => ({ vel: 0.8, vib: 1, vibAt: 0.4, breath: 1, tone: 1, flutter: 0, rel: 0.22, att: 0.08, ...n })).sort((a, b) => a.t - b.t);
  ns.forEach((n, k) => {
    const next = ns[k + 1], prev = ns[k - 1], slurIn = !!n.slur && !!prev, slurOut = !!(next && next.slur);
    let dur = n.dur, rel = n.rel;
    if (next && !slurOut) { if (n.t + dur + 0.04 > next.t) dur = Math.max(0.05, next.t - n.t - 0.07); rel = Math.max(0.03, Math.min(rel, next.t - n.t - dur)); }
    if (slurOut) dur = Math.max(dur, next.t - n.t);
    const lf = Math.log2(n.f), lprev = slurIn ? Math.log2(prev.f) : lf, pv = slurIn ? prev.vel * 0.84 : 0;
    const i0 = Math.round(n.t * sr), iEnd = Math.min(N, Math.round((n.t + dur + (slurOut ? 0.06 : rel)) * sr)), iHold = next ? Math.min(N, Math.round(next.t * sr)) : N;
    for (let i = i0; i < Math.max(iEnd, iHold); i++) {
      if (i >= N) break;
      const tt = (i - i0) / sr;
      if (i < iHold) {
        let l = lf;
        if (slurIn) l = lprev + (lf - lprev) * smooth(tt / 0.05);
        else l -= (38 / 1200) * (1 - smooth(tt / 0.075));
        if (tt > dur && !slurOut) l -= (14 / 1200) * smooth((tt - dur) / rel);
        lpitch[i] = l;
        vib[i] = n.vib * smooth((tt - n.vibAt) / 0.5);
        flut[i] = n.flutter * smooth(tt / 0.1);
        tone[i] = typeof n.tone === 'number' ? n.tone : at(n.tone, tt);
        air[i] = n.breath;
      }
      if (i < iEnd) {
        let e;
        if (n.env) e = at(n.env, tt) * (tt > dur ? 1 - smooth((tt - dur) / rel) : 1);
        else {
          const own = (0.84 + 0.16 * Math.sin(Math.PI * clamp(tt / dur, 0, 1))) * n.vel;
          e = slurIn ? pv + (own - pv) * smooth(tt / 0.06) : own * smooth(tt / n.att);
          if (tt > dur) e *= 1 - smooth((tt - dur) / (slurOut ? 0.06 : rel));
        }
        if (e > press[i]) press[i] = e;
        if (!slurIn && tt < 0.3) chiff[i] += Math.exp(-tt / 0.035);
      }
    }
  });
  // slow drifts (seeded, smooth): vibrato rate, pitch, level
  const drift = (hz) => { const n = Math.ceil(seconds * hz) + 3, v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = rng() * 2 - 1; return (t) => { const x = t * hz, i = x | 0, f = x - i, s = f * f * (3 - 2 * f); return v[i] + (v[i + 1] - v[i]) * s; }; };
  const dRate = drift(0.7), dPitch = drift(2.3), dAmp = drift(5.1);
  const Q = 7, q = 1 / Q, aL = 1 - Math.exp(-TAU * 5000 / sr), aH = 1 - Math.exp(-TAU * 2600 / sr);   // the air: a soft band, 2.6-5 kHz
  let ph = 0, vph = rng() * TAU, fph = 0, lo1 = 0, bd1 = 0, lo2 = 0, bd2 = 0, al = 0, ah = 0;
  let dr = 0, dp = 0, da = 0;
  for (let i = 0; i < N; i++) {
    const p = press[i];
    if ((i & 31) === 0) { const t = i / sr; dr = dRate(t); dp = dPitch(t); da = dAmp(t); }
    vph += TAU * (5 + 0.35 * dr) / sr; fph += TAU * 11 / sr;
    const w = rng() * 2 - 1;
    if (p < 1e-6) { lo1 *= 0.999; bd1 *= 0.999; lo2 *= 0.999; bd2 *= 0.999; continue; }
    const vs = Math.sin(vph), f = Math.pow(2, lpitch[i] + (vib[i] * 9 * vs + 3.5 * dp) / 1200);
    ph += TAU * f / sr;
    if (ph > TAU) ph -= TAU;
    const fl = flut[i] > 0 ? 1 - flut[i] * 0.5 * (1 - Math.cos(fph)) : 1;
    const am = (1 + 0.1 * vib[i] * vs) * (1 + 0.04 * da) * fl;
    const b = Math.pow(p, 1.5) * clamp(700 / f, 0.2, 1.25);
    const s = Math.sin(ph) + 0.24 * b * Math.sin(2 * ph + 0.6) + 0.11 * b * Math.sin(3 * ph + 1.9) + 0.04 * b * Math.sin(4 * ph + 0.4);
    // breath: a resonator on the note and one on its octave, and the air above
    const k1 = 2 * Math.sin(Math.PI * Math.min(f, 5000) / sr), k2 = 2 * Math.sin(Math.PI * Math.min(2 * f, 7000) / sr);
    lo1 += k1 * bd1; bd1 += k1 * (w - lo1 - q * bd1);
    lo2 += k2 * bd2; bd2 += k2 * (w - lo2 - q * bd2);
    al += (w - al) * aL; ah += (al - ah) * aH;
    const nrm = 1 / Math.sqrt(Math.PI * f * Q / (3 * sr));
    const nz = (bd1 * 0.13 + bd2 * 0.03) * nrm * Math.pow(p, 0.6) + (al - ah) * (0.03 + 0.13 * chiff[i]) * Math.sqrt(p);
    out[i] = 0.5 * (p * am * tone[i] * s + air[i] * nz * (0.5 + 0.5 * fl));
  }
  filt(out, biquad('hp', 150, 0.7, sr));
  return [out];
}

// ========================================================================================== WINGS
/**
 * One wingbeat: a papery band (1.5-4 kHz, 2 ms attack, a fast fluttering decay) over the soft push
 * of air beneath it. size 0 = a moth across the room, 1 = at the microphone. up = the lighter
 * up-stroke. The first sample of the buffer is the first sample of the sound.
 */
export function flap(sr, { size = 0.5, up = false, seed = 'flap' }) {
  const N = Math.round((0.16 + 0.12 * size) * sr), out = new Float32Array(N), rng = createRng(`${seed}:${size}:${up}`);
  const paper = new Float32Array(N), push = new Float32Array(N), body = new Float32Array(N);
  const tauP = (0.011 + 0.007 * size) * (up ? 0.7 : 1), tauA = 0.022 + 0.02 * size, rip = 110 + 60 * rng(), ph = rng() * TAU;
  for (let i = 0; i < N; i++) {
    const t = i / sr, n = rng() * 2 - 1;
    paper[i] = n * (1 - Math.exp(-t / 0.0007)) * Math.exp(-t / tauP) * (1 + 0.4 * Math.sin(TAU * rip * t + ph));
    push[i] = n * (1 - Math.exp(-t / 0.003)) * Math.exp(-t / tauA);
    body[i] = n * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / (tauA * 1.4));
  }
  const fc = (up ? 2900 : 2300) * (0.9 + 0.2 * rng());
  filt(paper, biquad('bp', fc, 0.9, sr)); filt(paper, biquad('hp', 1200, 0.7, sr)); filt(paper, biquad('lp', 6000, 0.6, sr));
  filt(push, biquad('bp', 620, 0.8, sr)); filt(push, biquad('hp', 240, 0.7, sr));
  filt(body, biquad('bp', 260, 1.1, sr)); filt(body, biquad('hp', 150, 0.7, sr));
  for (let i = 0; i < N; i++) out[i] = paper[i] + push[i] * (0.25 + 1.5 * size) * (up ? 0.6 : 1) + body[i] * 2.2 * size * size * (up ? 0.4 : 1);
  return fadeEnds(normalize([out], 'peak', 0.9), sr, 0.01);
}

/**
 * The flock: a granular cloud of wingbeats. rate(t) flaps per second, level(t) loudness, near(t)
 * 0..1 how close the cloud is (close wings are lower, longer, wider). All three are breakpoints.
 * `echo` adds the slap-back of walls: [[delay s, gain], ...] (each echo is darker and swapped L/R).
 */
export function flockCloud(sr, { seconds, rate, level, near = [[0, 0]], seed = 'flock', echo = null }) {
  const N = Math.round(seconds * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  const slot = 0.01;
  let carry = 0;
  for (let t = 0; t < seconds; t += slot) {
    carry += at(rate, t) * slot;
    const lv = at(level, t), nr = at(near, t);
    while (carry >= 1) {
      carry -= 1;
      if (lv <= 0) continue;
      const i0 = Math.floor((t + rng() * slot) * sr), pan = rng() * 2 - 1, close = rng() < nr * 0.5;
      const f = logRand(rng, 1350, 3600) * (close ? 0.6 : 1), amp = lv * (0.25 + 0.75 * Math.pow(rng(), 2));
      addNoiseGrain(L, R, i0, sr, rng, { hp: f / 1.5, lp: f * 1.4, tau: (0.004 + 0.006 * rng()) * (close ? 2 : 1), amp, pan, attack: 0.002 }, false);
      if (close) addNoiseGrain(L, R, i0, sr, rng, { hp: 280, lp: 1100, tau: 0.02 + 0.02 * rng(), amp: amp * 1.3, pan, attack: 0.003 }, false);
    }
  }
  if (echo) {
    const l0 = Float32Array.from(L), r0 = Float32Array.from(R);
    for (const [d, g] of echo) {
      const k = Math.round(d * sr), a = 1 - Math.exp(-TAU * 2600 / sr);
      let sl = 0, sr2 = 0;
      for (let i = 0; i + k < N; i++) { sl += (r0[i] - sl) * a; sr2 += (l0[i] - sr2) * a; L[i + k] += sl * g; R[i + k] += sr2 * g; }
    }
  }
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.2);
}

/**
 * The letter scales let go: `count` tiny bright grains that leave the centre, fly out to both
 * speakers and thin to nothing. Some are noise (dust), some ring for an instant (a scale turning
 * through its bright angle).
 */
export function scatter(sr, { seconds = 4.5, count = 9500, seed = 'scatter' }) {
  const N = Math.round(seconds * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  const td = seconds / 3.9;
  for (let k = 0; k < count; k++) {
    const t = 0.004 - td * Math.log(1 - rng() * (1 - Math.exp(-(seconds - 0.3) / td)));
    const spread = 1 - Math.exp(-t / 0.5), pan = clamp((rng() < 0.5 ? -1 : 1) * spread * (0.35 + 0.75 * rng()) + (rng() - 0.5) * 0.3, -1, 1);
    const a = (0.08 + Math.pow(rng(), 3)) * Math.exp(-t / (td * 2.6)), f = logRand(rng, 2500, 8000);
    const i0 = Math.floor(t * sr);
    if (rng() < 0.3) addChirp(L, R, i0, sr, { f0: f, f1: f * 0.97, glide: 0.004, tau: 0.0012 + 3 / f, amp: a * 0.7, pan, attack: 0.0001 }, false);
    else addNoiseGrain(L, R, i0, sr, rng, { hp: f * 0.7, lp: f * 1.4, tau: 0.0005 + 2 / f, amp: a * 2, pan, attack: 0.0002 }, false);
  }
  for (const ch of [L, R]) filt(ch, biquad('lp', 8000, 0.6, sr));
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.1);
}

// ========================================================================================== FOLEY
/** A rail joint under one bogie: two wheel-sets, each a low knock, a mid clank and a short ring. */
export function clack(sr, { gap = 0.115, hard = 0.5, seed = 'clack' }) {
  const N = Math.round((gap + 0.45) * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  [[0, 1], [gap, 0.82]].forEach(([t, a], k) => {
    const i0 = Math.round(t * sr), pan = k ? 0.12 : -0.12;
    addNoiseGrain(L, R, i0, sr, rng, { hp: 150, lp: 620, tau: 0.02, amp: 1.5 * a, pan, attack: 0.0003 }, false);
    addNoiseGrain(L, R, i0, sr, rng, { hp: 700, lp: 2200 + 2200 * hard, tau: 0.006 + 0.004 * hard, amp: (0.5 + 1.2 * hard) * a, pan, attack: 0 }, false);
    addChirp(L, R, i0, sr, { f0: 214, f1: 176, glide: 0.03, tau: 0.045, amp: 0.8 * a, pan, attack: 0.0004 }, false);
    addChirp(L, R, i0, sr, { f0: 1180, f1: 1150, glide: 0.02, tau: 0.02 + 0.03 * hard, amp: 0.12 * a * (0.4 + hard), pan, attack: 0.0002 }, false);
    addChirp(L, R, i0, sr, { f0: 2730, f1: 2700, glide: 0.02, tau: 0.012 + 0.02 * hard, amp: 0.06 * a * hard, pan: -pan, attack: 0.0002 }, false);
  });
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.02);
}

/**
 * The rail joint that wakes the sleeper: steel on steel, the twin of the alarm. Two wheel-sets,
 * 115 ms apart: each a hard broadband crack on the first sample, a knock with the weight of the car
 * in it, and the wheel ringing for a fifth of a second on the alarm's own note (B5 and the scale
 * above it: F#6, D7, A7, D8); then the fittings of the car rattle and settle.
 */
export function jolt(sr, { f = 987.77, seed = 'jolt' } = {}) {
  const N = Math.round(0.95 * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  [[0, 1], [0.115, 0.7]].forEach(([t, a], k) => {
    const i0 = Math.round(t * sr), pan = k ? 0.22 : -0.22;
    addNoiseGrain(L, R, i0, sr, rng, { hp: 900, lp: 8000, tau: 0.0035, amp: 2.6 * a, pan, attack: 0 }, false);
    addNoiseGrain(L, R, i0, sr, rng, { hp: 180, lp: 900, tau: 0.02, amp: 1.5 * a, pan, attack: 0 }, false);
    addChirp(L, R, i0, sr, { f0: 232, f1: 172, glide: 0.03, tau: 0.05, amp: 0.9 * a, pan, attack: 0.0003 }, false);
    for (const [m, g, tau] of [[1, 0.5, 0.11], [1.4983, 0.24, 0.075], [2.3784, 0.26, 0.06], [3.5636, 0.12, 0.04], [4.7568, 0.06, 0.03]]) {
      addChirp(L, R, i0, sr, { f0: f * m * 1.004, f1: f * m, glide: 0.01, tau, amp: g * a, pan: m > 2 ? -pan : pan, attack: 0.0002 }, false);
    }
  });
  for (let k = 0; k < 8; k++) {   // the rattle
    const t = 0.17 + 0.4 * Math.pow(rng(), 1.3), fq = logRand(rng, 1500, 4200), a = 0.18 * (1 - t / 0.6) * (0.4 + rng());
    addNoiseGrain(L, R, Math.floor(t * sr), sr, rng, { hp: fq * 0.7, lp: fq * 1.6, tau: 0.003, amp: a * 1.5, pan: rng() * 1.6 - 0.8, attack: 0 }, false);
    addChirp(L, R, Math.floor(t * sr), sr, { f0: fq, f1: fq * 0.98, glide: 0.005, tau: 0.008, amp: a * 0.5, pan: rng() * 1.6 - 0.8, attack: 0.0002 }, false);
  }
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.02);
}

/** An umbrella opening: cloth rushing outward (a rising whisper), then the canopy snapping taut. */
export function umbrella(sr, { seed = 'umb', size = 0.5 }) {
  const N = Math.round(0.5 * sr), out = new Float32Array(N), rng = createRng(seed);
  const snap = 0.09, n = new Float32Array(N);   // the canopy snaps taut 90 ms into the buffer: start it 90 ms early
  // the rush: band noise sweeping upward, swelling into the snap
  let lo = 0, bd = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sr, x = Math.min(1, t / snap), fc = 500 * Math.pow(7, x), k = 2 * Math.sin(Math.PI * fc / sr), w = rng() * 2 - 1;
    lo += k * bd; bd += k * (w - lo - 0.6 * bd);
    n[i] = bd * (t < snap ? Math.pow(x, 2.2) : Math.exp(-(t - snap) / 0.03)) * 0.5;
  }
  for (let i = 0; i < N; i++) out[i] = n[i];
  // the snap: taut cloth is a small drum
  const L = [out], i0 = Math.round(snap * sr), f = 190 + 70 * rng();
  addChirp(out, new Float32Array(N), i0, sr, { f0: f * 1.5, f1: f, glide: 0.012, tau: 0.035 + 0.02 * size, amp: 0.9, pan: -1, attack: 0.0006 }, false);
  addNoiseGrain(out, new Float32Array(N), i0, sr, rng, { hp: 300, lp: 2600, tau: 0.012, amp: 2.4, pan: -1, attack: 0.0003 }, false);
  addNoiseGrain(out, new Float32Array(N), i0 + Math.round(0.03 * sr), sr, rng, { hp: 1500, lp: 4500, tau: 0.03, amp: 0.5, pan: -1, attack: 0.006 }, false);   // the cloth settling
  return fadeEnds(normalize(L, 'peak', 0.9), sr, 0.02);
}

/**
 * Footsteps of a crowd on one beat: `count` feet within `spread` seconds of each other, across the
 * stereo field. surface: 'wet' (soles on wet stone: a muffled thud and a small splash), 'stair'
 * (harder, a knock and a scuff).
 */
export function steps(sr, { count = 12, spread = 0.07, surface = 'wet', seed = 'steps' }) {
  const N = Math.round((spread + 0.4) * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  for (let k = 0; k < count; k++) {
    const i0 = Math.floor(Math.pow(rng(), 1.4) * spread * sr), pan = (rng() * 2 - 1) * 0.85, a = 0.35 + 0.65 * rng();
    if (surface === 'wet') {
      addNoiseGrain(L, R, i0, sr, rng, { hp: 170, lp: 520 + 300 * rng(), tau: 0.016, amp: 1.6 * a, pan, attack: 0.001 }, false);
      addNoiseGrain(L, R, i0 + Math.round(0.012 * sr), sr, rng, { hp: 1600, lp: 4200, tau: 0.02, amp: 0.2 * a, pan, attack: 0.005 }, false);
    } else {
      addNoiseGrain(L, R, i0, sr, rng, { hp: 260, lp: 1300 + 500 * rng(), tau: 0.009, amp: 1.5 * a, pan, attack: 0.0004 }, false);
      addNoiseGrain(L, R, i0 + Math.round(0.02 * sr), sr, rng, { hp: 1200, lp: 3600, tau: 0.03, amp: 0.25 * a, pan, attack: 0.006 }, false);
    }
    addChirp(L, R, i0, sr, { f0: 230 + 60 * rng(), f1: 170, glide: 0.02, tau: 0.02, amp: 0.3 * a, pan, attack: 0.0006 }, false);
  }
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.02);
}

/** One footstep in grass: the heel pressing stems flat, the roll of the foot, the stems springing back. */
export function grassStep(sr, { seed = 'gstep' }) {
  const N = Math.round(0.42 * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  // heel: a soft thud with body (kept above 150 Hz so that it survives a small speaker)
  addNoiseGrain(L, R, 0, sr, rng, { hp: 160, lp: 480, tau: 0.022, amp: 1.5, pan: 0, attack: 0.002 }, false);
  addChirp(L, R, 0, sr, { f0: 240, f1: 165, glide: 0.03, tau: 0.03, amp: 0.45, pan: 0, attack: 0.001 }, false);
  // stems and blades: many small crackles under the rolling foot, then a few springing back
  for (let k = 0; k < 150; k++) {
    const x = rng(), t = k < 120 ? 0.005 + 0.2 * Math.pow(x, 0.8) : 0.22 + 0.16 * x;
    const env = k < 120 ? Math.sin(Math.PI * Math.min(1, t / 0.2)) : 0.3;
    const f = logRand(rng, 1300, 5500);
    addNoiseGrain(L, R, Math.floor(t * sr), sr, rng, { hp: f / 1.6, lp: f * 1.5, tau: 0.0012 + 0.004 * rng(), amp: (0.06 + 0.4 * Math.pow(rng(), 2.5)) * env, pan: (rng() - 0.5) * 0.5, attack: 0.0004 }, false);
  }
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.02);
}

/**
 * A raindrop at a butterfly's scale and speed: a slow, deep, downward "bloop" (a glass boulder
 * entering the air of the leaf), the slap of the leaf, and the crown of the splash falling apart.
 */
export function slowDrop(sr, { seed = 'drop', f = 430, size = 0.6, softImpact = false }) {
  const N = Math.round(1.3 * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  addChirp(L, R, 0, sr, { f0: f, f1: f * 0.4, glide: 0.11, tau: 0.09 + 0.05 * size, amp: 1, pan: 0, attack: 0.004 }, false);
  addChirp(L, R, 0, sr, { f0: f * 2.02, f1: f * 0.84, glide: 0.09, tau: 0.05, amp: 0.3, pan: 0, attack: 0.003 }, false);
  const oldBody = softImpact ? [L.slice(), R.slice()] : null;
  // the leaf slap
  addNoiseGrain(L, R, 0, sr, rng, { hp: 260, lp: 1500, tau: 0.03, amp: 1.5 * size, pan: 0.1, attack: 0.0015 }, false);
  addNoiseGrain(L, R, 0, sr, rng, { hp: 1500, lp: 4800, tau: 0.012, amp: 0.5 * size, pan: -0.1, attack: 0.0012 }, false);
  // the crown: slow droplets, falling in pitch because time is slow here
  for (let k = 0; k < 16; k++) {
    const t = 0.1 + 0.9 * Math.pow(rng(), 1.3), fq = logRand(rng, 700, 2600);
    addChirp(L, R, Math.floor(t * sr), sr, { f0: fq, f1: fq * 0.7, glide: 0.03, tau: 0.02 + 0.03 * rng(), amp: 0.12 * (1 - t) * (0.3 + rng()), pan: (rng() * 2 - 1) * 0.8, attack: 0.002 }, false);
  }
  if (softImpact) {
    // 沿用原整滴的增益基准，避免换主体后把叶拍和后扫频一起抬高。
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const gain = 0.9 / (peak || 1), body = [new Float32Array(N), new Float32Array(N)];
    // 短噪声提供湿叶厚度，独立随机源不消耗后扫频的随机序列。
    addNoiseGrain(body[0], body[1], 0, sr, createRng(`${seed}:impact:body`), { hp: 300, lp: 1700, tau: 0.016 + 0.004 * size, amp: 0.75, pan: 0, attack: 0.0025 }, false);
    addNoiseGrain(body[0], body[1], 0, sr, createRng(`${seed}:impact:water`), { hp: 1600, lp: 5500, tau: 0.006, amp: 0.35, pan: 0, attack: 0.0015 }, false);
    for (let i = 0; i < N; i++) {
      L[i] = (L[i] - oldBody[0][i] + body[0][i]) * gain;
      R[i] = (R[i] - oldBody[1][i] + body[1][i]) * gain;
    }
    return fadeEnds([L, R], sr, 0.05);
  }
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.05);
}

/** The dew drop striking a leaf at full speed: a tick, a bright wet slap, a tiny rising bubble. */
export function splash(sr, { seed = 'splash' }) {
  const N = Math.round(0.35 * sr), L = new Float32Array(N), R = new Float32Array(N), rng = createRng(seed);
  addNoiseGrain(L, R, 0, sr, rng, { hp: 900, lp: 7000, tau: 0.004, amp: 2.2, pan: 0, attack: 0 }, false);
  addNoiseGrain(L, R, 0, sr, rng, { hp: 250, lp: 1400, tau: 0.022, amp: 1.4, pan: 0, attack: 0 }, false);
  addChirp(L, R, 0, sr, { f0: 900, f1: 1900, glide: 0.03, tau: 0.03, amp: 0.7, pan: 0.1, attack: 0.0003 }, false);
  for (let k = 0; k < 9; k++) {
    const t = 0.02 + 0.2 * rng(), fq = logRand(rng, 1500, 5200);
    addChirp(L, R, Math.floor(t * sr), sr, { f0: fq, f1: fq * 1.4, glide: 0.008, tau: 0.006 + 0.008 * rng(), amp: 0.2 * (0.3 + rng()), pan: (rng() * 2 - 1) * 0.7, attack: 0.0003 }, false);
  }
  return fadeEnds(normalize([L, R], 'peak', 0.9), sr, 0.02);
}

/**
 * Crickets: one insect, as a loop. Each chirp is `syl` short pulses of a carrier near `f`; chirps
 * come at `rate` per second with a little irregularity; now and then the insect rests.
 */
export function cricket(sr, { seconds = 9, f = 4400, syl = 3, rate = 2.2, seed = 'cricket' }) {
  const N = Math.round(seconds * sr), out = new Float32Array(N), rng = createRng(seed);
  let t = rng() * 0.4;
  while (t < seconds - 0.3) {
    if (rng() < 0.12) { t += 0.5 + rng() * 0.9; continue; }
    const fq = f * (1 + (rng() - 0.5) * 0.012), a = 0.7 + 0.3 * rng();
    for (let s = 0; s < syl; s++) {
      const i0 = Math.round((t + s * 0.036) * sr), len = Math.round(0.021 * sr);
      for (let i = 0; i < len && i0 + i < N; i++) {
        const x = i / len, env = Math.pow(Math.sin(Math.PI * x), 2) * (0.6 + 0.4 * (s + 1) / syl);
        out[i0 + i] += env * a * (Math.sin(TAU * fq * i / sr) + 0.03 * Math.sin(TAU * 2 * fq * i / sr));
      }
    }
    t += (1 / rate) * (0.92 + 0.16 * rng());
  }
  return normalize([out], 'peak', 0.9);
}
