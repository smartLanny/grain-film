// The orchestra and the foley kit of 《一粒》 / GRAIN, built on the Web Audio API.
//
// A Stem is one OfflineAudioContext with a dry bus and two convolution reverbs ("ice hall" and
// "valley"); the score renders several stems in parallel and mixes them (see score.js).
// Instruments and effects are plain functions (S, dest, options) that schedule nodes at absolute
// film times. All randomness is seeded.

import { createRng } from './random.js';
import { hz, smoothCurve } from './synth.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ------------------------------------------------------------------------------------ automation
/** Linear breakpoints [[t, v], ...] on an AudioParam (value before the first point = first value). */
export function ramp(param, pts, k = 1) {
  param.value = pts[0][1] * k;
  param.setValueAtTime(pts[0][1] * k, Math.max(0, pts[0][0]));
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1] * k, Math.max(0, pts[i][0]));
}
/** Cosine-eased breakpoints as one value curve; `map` converts the 0..1 level to the param's unit. */
export function curve(param, pts, map = (v) => v) {
  const t0 = Math.max(0, pts[0][0]), t1 = pts[pts.length - 1][0];
  const n = Math.max(3, Math.ceil((t1 - t0) * 120) + 1), arr = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    while (j < pts.length - 2 && t > pts[j + 1][0]) j++;
    const ta = pts[j][0], va = pts[j][1], tb = pts[j + 1][0], vb = pts[j + 1][1];
    let x = tb > ta ? clamp((t - ta) / (tb - ta), 0, 1) : 1;
    x = x * x * (3 - 2 * x);
    arr[i] = map(va + (vb - va) * x);
  }
  param.value = arr[0];
  param.setValueCurveAtTime(arr, t0, t1 - t0);
}
/** number | breakpoints | { wander: { seed, min, max, hz }, t0, t1 } */
function setParam(param, v, t0, t1) {
  if (typeof v === 'number') param.value = v;
  else if (Array.isArray(v)) ramp(param, v);
  else if (v && v.wander) {
    const n = Math.max(8, Math.ceil((t1 - t0) * 10));
    const arr = smoothCurve(v.wander.seed, n, { min: v.wander.min, max: v.wander.max, rate: Math.max(0.5, (t1 - t0) * v.wander.hz) });
    param.value = arr[0];
    param.setValueCurveAtTime(arr, t0, t1 - t0);
  }
}

// ------------------------------------------------------------------------------- time-shifted graph
// A chunk context starts at film time `origin`. Nodes created through ShiftCtx take film times in
// every scheduling call and translate them, so instruments never need to know where a chunk starts.
// Events that began before the origin (bus automation) are resumed at the right value.
function shiftParam(p, o) {
  const P = AudioParam.prototype;
  let lt = -Infinity, lv = p.value;   // last scheduled event: film time, value
  p.setValueAtTime = (v, t) => { P.setValueAtTime.call(p, v, Math.max(0, t - o)); lt = t; lv = v; return p; };
  const rampTo = (kind) => (v, t) => {
    if (t <= o) P.setValueAtTime.call(p, v, 0);
    else {
      if (lt < o && lt > -Infinity) {
        const x = (o - lt) / (t - lt);
        P.setValueAtTime.call(p, kind === 'exp' ? lv * Math.pow(v / lv, x) : lv + (v - lv) * x, 0);
      }
      (kind === 'exp' ? P.exponentialRampToValueAtTime : P.linearRampToValueAtTime).call(p, v, t - o);
    }
    lt = t; lv = v; return p;
  };
  p.linearRampToValueAtTime = rampTo('lin');
  p.exponentialRampToValueAtTime = rampTo('exp');
  p.setTargetAtTime = (v, t, tc) => {
    if (t < o) { P.setValueAtTime.call(p, v + (lv - v) * Math.exp(-(o - t) / tc), 0); P.setTargetAtTime.call(p, v, 0, tc); }
    else P.setTargetAtTime.call(p, v, t - o, tc);
    lt = t; lv = v; return p;
  };
  p.setValueCurveAtTime = (arr, t, d) => {
    const n = arr.length;
    if (t >= o) P.setValueCurveAtTime.call(p, arr, t - o, d);
    else if (t + d <= o) P.setValueAtTime.call(p, arr[n - 1], 0);
    else {
      const i0 = Math.floor(((o - t) / d) * (n - 1)), rest = arr.subarray(i0);
      if (rest.length < 2) P.setValueAtTime.call(p, arr[n - 1], 0);
      else P.setValueCurveAtTime.call(p, rest, 0, d * (1 - i0 / (n - 1)));
    }
    lt = t + d; lv = arr[n - 1]; return p;
  };
}
function shiftSource(node, o) {
  const proto = Object.getPrototypeOf(node);
  node.start = (when = 0, offset, dur) => {
    const t = Math.max(0, when - o);
    if (dur !== undefined) proto.start.call(node, t, offset, dur);
    else if (offset !== undefined) proto.start.call(node, t, offset);
    else proto.start.call(node, t);
  };
  node.stop = (when = 0) => proto.stop.call(node, Math.max(0, when - o));
}
// Bit-reproducibility. When several outputs feed one input, the browser sums them in the order of
// an internal hash set, which changes from run to run, and float addition is not associative: the
// render would differ in its last bit. So every junction is built here as a chain of two-input
// adders (a + b is commutative, hence exact): the Nth source of a node goes through its own unity
// gain, which also carries the sum of all later sources.
const JUNCTIONS = new WeakMap();   // destination node -> the adder that takes the next source
function orderedConnect(node, raw) {
  const connect = AudioNode.prototype.connect;
  node.connect = (dest, output, input) => {
    if (!(dest instanceof AudioNode)) { connect.call(node, dest); return dest; }                 // an AudioParam
    if (output !== undefined) { connect.call(node, dest, output, input ?? 0); return dest; }     // explicit channels (merger)
    const tail = JUNCTIONS.get(dest);
    if (!tail) { connect.call(node, dest); JUNCTIONS.set(dest, dest); return dest; }
    const adder = raw.createGain();
    connect.call(adder, tail); connect.call(node, adder);
    JUNCTIONS.set(dest, adder);
    return dest;
  };
  return node;
}
class ShiftCtx {
  constructor(raw, origin) { this.raw = raw; this.o = origin; this.sampleRate = raw.sampleRate; }
  _p(node, names) { for (const n of names) shiftParam(node[n], this.o); return orderedConnect(node, this.raw); }
  createGain() { return this._p(this.raw.createGain(), ['gain']); }
  createOscillator() { const n = this._p(this.raw.createOscillator(), ['frequency', 'detune']); shiftSource(n, this.o); return n; }
  createBiquadFilter() { return this._p(this.raw.createBiquadFilter(), ['frequency', 'Q', 'gain', 'detune']); }
  createStereoPanner() { return this._p(this.raw.createStereoPanner(), ['pan']); }
  createBufferSource() { const n = this._p(this.raw.createBufferSource(), ['playbackRate', 'detune']); shiftSource(n, this.o); return n; }
  createWaveShaper() { return orderedConnect(this.raw.createWaveShaper(), this.raw); }
  createBuffer(...a) { return this.raw.createBuffer(...a); }
}

// ------------------------------------------------------------------------------------------ stem
/**
 * One chunk of a reel: an OfflineAudioContext that starts at film time `origin` and holds only the
 * events that BEGIN inside its window (they ring on for as long as they need). Its six output
 * channels are the dry bus and the two reverb sends (ice hall, valley), each stereo; the reverbs
 * themselves are applied once per reel after the chunks are summed (score.js).
 *
 * With `probe` set, no audio graph exists: the cue sheet is run once just to learn, per window, when
 * its last event ends. Every instrument starts with `if (!S.claim(start, end)) return;`.
 */
export class Stem {
  constructor({ assets, sr = 48000, origin = 0, win = [-Infinity, Infinity], seconds = 1, limit = Infinity, probe = null, only = null }) {
    this.only = only;   // debugging: restrict to these instrument kinds
    this.assets = assets; this.sr = sr; this.origin = origin; this.win = win; this.limit = limit; this.probe = probe;
    this._bufs = new Map();
    if (probe) { this.ctx = null; this.main = {}; return; }
    const raw = this.raw = new OfflineAudioContext({ numberOfChannels: 6, length: Math.max(128, Math.ceil(seconds * sr)), sampleRate: sr });
    raw.destination.channelCount = 6; raw.destination.channelCountMode = 'explicit'; raw.destination.channelInterpretation = 'discrete';
    const merger = raw.createChannelMerger(6);
    merger.connect(raw.destination);
    const ctx = this.ctx = new ShiftCtx(raw, origin);
    const bus = (k) => {
      const g = ctx.createGain(); g.channelCount = 2; g.channelCountMode = 'explicit';
      const sp = raw.createChannelSplitter(2);
      g.connect(sp); sp.connect(merger, 0, 2 * k); sp.connect(merger, 1, 2 * k + 1);
      return g;
    };
    this.main = { dry: bus(0), hall: bus(1), valley: bus(2) };
  }
  /** Does this event (film times) belong to this chunk? In probe mode: record it and say no. */
  claim(start, end, kind) {
    if (start >= this.limit || (this.only && !this.only.includes(kind))) return false;
    end = Math.min(end, this.limit);
    if (this.probe) {
      const k = Math.max(0, Math.floor((start - this.probe.t0) / this.probe.W + 1e-9));
      this.probe.ends[k] = Math.max(this.probe.ends[k] || 0, end);
      return false;
    }
    return start >= this.win[0] - 1e-9 && start < this.win[1] - 1e-9;
  }
  /** AudioBuffer of a named asset (noise, texture, one-shot). */
  buf(name) {
    let b = this._bufs.get(name);
    if (!b) {
      const chs = this.assets.get(name);
      b = this.raw.createBuffer(chs.length, chs[0].length, this.sr);
      chs.forEach((c, i) => b.copyToChannel(c, i));
      this._bufs.set(name, b);
    }
    return b;
  }
  /** A parallel set of buses (dry / hall / valley) that pass through three identical inserts. */
  group(makeInsert) {
    if (this.probe) return {};
    const mk = (target) => { const n = makeInsert(this.ctx); n.connect(target); return n; };
    return { dry: mk(this.main.dry), hall: mk(this.main.hall), valley: mk(this.main.valley) };
  }
  /** Output strip: gain -> pan -> dry + reverb sends. Returns the node to connect sources to. */
  out({ gain = 1, pan = 0, dry = 1, hall = 0, valley = 0, group = null } = {}) {
    if (this.probe) return null;
    const ctx = this.ctx, g = ctx.createGain(), G = group || this.main;
    g.gain.value = gain;
    let node = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); node = p; }
    const send = (target, amount) => {
      if (!amount) return;
      if (amount === 1) { node.connect(target); return; }
      const s = ctx.createGain(); s.gain.value = amount; node.connect(s).connect(target);
    };
    send(G.dry, dry); send(G.hall, hall); send(G.valley, valley);
    return g;
  }
  /** Looping noise source (white | pink | brown, or any asset), started at a seeded offset. */
  noise(color, start, stop, seed = color) {
    const s = this.ctx.createBufferSource(), b = this.buf(color);
    s.buffer = b; s.loop = true;
    s.start(start, createRng('n:' + seed + start)() * b.duration);
    s.stop(stop);
    return s;
  }
  render() { return this.raw.startRendering(); }
}

const SAT = new Map();
/** Soft saturation curve (tanh), shared. */
function satCurve(drive) {
  if (!SAT.has(drive)) {
    const n = 2049, c = new Float32Array(n), k = Math.tanh(drive);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1)) / k;
    SAT.set(drive, c);
  }
  return SAT.get(drive);
}
export function saturator(ctx, drive = 1.5) {
  const w = ctx.createWaveShaper();
  w.curve = satCurve(drive);   // no oversampling: it would delay the drum by a fraction of a millisecond
  return w;
}

// =========================================================================================== music

/**
 * STRINGS. Seven detuned saws per note spread across the stereo field, two low-passes that open
 * with the envelope, delayed vibrato, a breath of bow noise. `env` is [[t, level 0..1], ...].
 * trem: { rate, depth } gives a bowed tremolo (each note at its own rate so the section shimmers).
 */
export function strings(S, dest, { notes, env, gain = 0.1, cut = [300, 2400], voices = 7, detune = 12, vib = 6, width = 0.85, pan = 0, bow = 0.5, trem = null, seed = 'str', track = 0.35 }) {
  const t0 = Math.max(0, env[0][0]), t1 = env[env.length - 1][0];
  if (!S.claim(t0, t1 + 0.15, 'strings')) return;
  const ctx = S.ctx, rng = createRng(seed + notes.join('') + env[0][0]);
  const SPREAD = [-1, -0.62, -0.27, 0, 0.3, 0.66, 1], POS = [-0.9, 0.7, -0.45, 0.05, 0.5, -0.75, 0.95];
  notes.forEach((note, ni) => {
    const f = hz(note), kt = Math.pow(f / 220, track);
    const lowNarrow = clamp((f - 60) / 200, 0.25, 1);   // basses stay near the centre, violins spread wide
    const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter();
    lp1.type = 'lowpass'; lp1.Q.value = 0.7; lp2.type = 'lowpass'; lp2.Q.value = 0.5;
    curve(lp1.frequency, env, (v) => Math.min(15000, cut[0] * Math.pow(cut[1] / cut[0], v) * kt));
    curve(lp2.frequency, env, (v) => Math.min(18000, 2.4 * cut[0] * Math.pow(cut[1] / cut[0], v) * kt));
    const amp = ctx.createGain();
    curve(amp.gain, env, (v) => (v * gain) / Math.sqrt(voices));
    lp1.connect(lp2).connect(amp);
    let last = amp;
    if (trem) {
      const tg = ctx.createGain(); tg.gain.value = 1 - trem.depth / 2;
      const lfo = ctx.createOscillator(); lfo.type = 'triangle';
      lfo.frequency.value = trem.rate * (0.88 + 0.26 * rng());
      const ld = ctx.createGain(); ld.gain.value = trem.depth / 2;
      lfo.connect(ld).connect(tg.gain);
      lfo.start(t0); lfo.stop(t1 + 0.1);
      amp.connect(tg); last = tg;
    }
    last.connect(dest);
    const lfos = [0, 1].map(() => {
      const l = ctx.createOscillator(); l.frequency.value = 4.6 + rng() * 1.1;
      const d = ctx.createGain(); d.gain.value = 0;
      d.gain.setValueAtTime(0, t0 + 0.3);
      d.gain.linearRampToValueAtTime(vib * (0.7 + 0.6 * rng()), t0 + 2);
      l.connect(d); l.start(t0); l.stop(t1 + 0.1);
      return d;
    });
    for (let v = 0; v < voices; v++) {
      const idx = voices === 7 ? v : Math.round((v * 6) / Math.max(1, voices - 1));
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.detune.value = SPREAD[idx] * detune + (rng() - 0.5) * 2.5;
      lfos[v % 2].connect(o.detune);
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan + POS[(idx + ni * 3) % 7] * width * lowNarrow, -1, 1);
      o.connect(p).connect(lp1);
      o.start(Math.max(0, t0 - rng() * 0.3)); o.stop(t1 + 0.1);
    }
  });
  if (bow > 0) {
    const n = S.noise('pink', t0, t1 + 0.1, seed + 'bow');
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const g = ctx.createGain();
    curve(g.gain, env, (v) => Math.pow(v, 1.4) * bow * gain * 0.22 * Math.sqrt(notes.length));
    n.connect(bp).connect(hp).connect(g).connect(dest);
  }
}

/**
 * HORN. Triangle plus low-passed saw, soft attack, delayed vibrato. One player for the solo theme;
 * with more, each has its own tuning, level and vibrato so the unison breathes instead of beating.
 */
const HORN_DET = [0, -5, 7, -9], HORN_LVL = [1, 0.7, 0.6, 0.5];
const HORN_PAN = [[0], [0.3, -0.45], [0, -0.6, 0.6], [-0.2, 0.25, -0.65, 0.65]];   // the quieter players sit further out
export function horn(S, dest, { note, start, dur, gain = 0.2, bright = 1, players = 1, pan = 0, attack = 0.28, release = 0.5, vib = 5, seed = 'horn' }) {
  const end = start + dur, stop = end + release * 2.5 + 0.1;
  if (!S.claim(start, stop, 'horn')) return;
  const ctx = S.ctx, f = hz(note), rng = createRng(seed + note + start), kt = Math.pow(f / 440, 0.5) * bright;
  const amp = ctx.createGain(); amp.gain.value = 0;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain * 0.7, start + attack * 0.35);
  amp.gain.linearRampToValueAtTime(gain, start + attack);
  amp.gain.setTargetAtTime(gain * 0.84, start + attack, 0.6);
  amp.gain.setTargetAtTime(0, end, release / 3);
  const form = ctx.createBiquadFilter(); form.type = 'peaking'; form.frequency.value = 470; form.Q.value = 1; form.gain.value = 3.5;
  form.connect(amp).connect(dest);
  let norm = 0;
  for (let p = 0; p < players; p++) norm += HORN_LVL[p] * HORN_LVL[p];
  for (let p = 0; p < players; p++) {
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.5 + rng() * 0.9;
    const ld = ctx.createGain(); ld.gain.value = 0;
    ld.gain.setValueAtTime(0, start + 0.35); ld.gain.linearRampToValueAtTime(vib * (0.7 + 0.6 * rng()), start + 1.1);
    lfo.connect(ld); lfo.start(start); lfo.stop(stop);
    const det = HORN_DET[p] + (p ? (rng() - 0.5) * 3 : 0);
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f; saw.detune.value = det;
    const tri = ctx.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f; tri.detune.value = det;
    ld.connect(saw.detune); ld.connect(tri.detune);
    for (const o of [saw, tri]) {   // the lips find the note: a small scoop into the pitch
      o.detune.setValueAtTime(det - 14, Math.max(0, start - 0.02)); o.detune.linearRampToValueAtTime(det, start + 0.09);
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1;
    lp.frequency.setValueAtTime(400 * kt, start);
    lp.frequency.linearRampToValueAtTime(1050 * kt, start + attack);
    lp.frequency.setTargetAtTime(880 * kt, start + attack, 0.7);
    lp.frequency.setTargetAtTime(380 * kt, end, release / 3);
    const tg = ctx.createGain(); tg.gain.value = 0.8;
    const pn = ctx.createStereoPanner(); pn.pan.value = clamp(pan + HORN_PAN[players - 1][p], -1, 1);
    const sc = ctx.createGain(); sc.gain.value = (0.62 * HORN_LVL[p]) / Math.sqrt(norm);
    saw.connect(lp).connect(sc); tri.connect(tg).connect(sc);
    sc.connect(pn).connect(form);
    const st = Math.max(0, start - rng() * 0.02);
    saw.start(st); tri.start(st); saw.stop(stop); tri.stop(stop);
  }
  // a little breath on the attack
  const n = S.noise('pink', start, start + attack + 0.5, 'hornbreath' + start);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 * Math.sqrt(kt); bp.Q.value = 1.2;
  const ng = ctx.createGain(); ng.gain.value = 0;
  ng.gain.setValueAtTime(0, start); ng.gain.linearRampToValueAtTime(gain * 0.12, start + attack * 0.5);
  ng.gain.setTargetAtTime(gain * 0.015, start + attack * 0.5, 0.12);
  n.connect(bp).connect(ng).connect(dest);
}

/** GLASS. FM bell (1 : 3.5, index decaying), two beating carriers, strike partials, a soft hum. */
export function glass(S, dest, { note, freq, start, gain = 0.1, decay = 5, index = 1.4, ratio = 3.5, pan = 0, soft = 0 }) {
  const f = freq ?? hz(note);
  const tau = decay / 6.9, stop = Math.min(S.limit, start + decay * 1.3 + 0.3), at = 0.002 + soft * 0.03;
  if (!S.claim(start, stop, 'glass')) return;
  const ctx = S.ctx;
  if (f * ratio > 17000) ratio = 1;   // keep the modulator well under Nyquist for the highest pings
  const idx = index * Math.min(1, Math.pow(1100 / f, 0.9));
  const amp = ctx.createGain(); amp.gain.value = 0;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + at);
  amp.gain.setTargetAtTime(gain * 0.5, start + at, 0.09);
  amp.gain.setTargetAtTime(0, start + 0.3, tau);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9500; lp.Q.value = 0.5;
  const pn = ctx.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1);
  amp.connect(lp).connect(pn).connect(dest);
  const mod = ctx.createOscillator(); mod.frequency.value = f * ratio;
  const dg = ctx.createGain();
  dg.gain.setValueAtTime(idx * f * ratio, start);
  dg.gain.setTargetAtTime(idx * 0.1 * f * ratio, start, Math.max(0.05, decay / 14));
  mod.connect(dg); mod.start(start); mod.stop(stop);
  for (const d of [-1, 1]) {
    const car = ctx.createOscillator(); car.frequency.value = f * (1 + d * 0.0006);
    dg.connect(car.frequency);
    const g = ctx.createGain(); g.gain.value = 0.5;
    car.connect(g).connect(amp); car.start(start); car.stop(stop);
  }
  const partial = (mult, level, t) => {
    if (f * mult > 15000) return;
    const o = ctx.createOscillator(); o.frequency.value = f * mult;
    const g = ctx.createGain(); g.gain.setValueAtTime(level, start); g.gain.setTargetAtTime(0, start, t);
    o.connect(g).connect(amp); o.start(start); o.stop(Math.min(stop, start + t * 8));
  };
  partial(2.76, 0.1, tau * 0.25); partial(5.41, 0.04, tau * 0.1);
  // hum an octave below, blooming late: warmth
  const hum = ctx.createOscillator(); hum.frequency.value = f * 0.5;
  const hg = ctx.createGain(); hg.gain.value = 0;
  hg.gain.setValueAtTime(0, start); hg.gain.linearRampToValueAtTime(0.16, start + 0.08); hg.gain.setTargetAtTime(0.08, start + 0.08, tau);
  hum.connect(hg).connect(amp); hum.start(start); hum.stop(stop);
}

/** KALIMBA. Short FM pluck (1 : 7) with a tine tick. The voice of water. */
export function kalimba(S, dest, { note, freq, start, gain = 0.1, pan = 0, decay = 0.4, bright = 1 }) {
  const f = freq ?? hz(note), stop = start + decay * 3 + 0.05;
  if (!S.claim(start, stop, 'kalimba')) return;
  const ctx = S.ctx;
  const amp = ctx.createGain(); amp.gain.value = 0;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.0015);
  amp.gain.setTargetAtTime(gain * 0.4, start + 0.0015, 0.03);
  amp.gain.setTargetAtTime(0, start + 0.06, decay / 3.2);
  const pn = ctx.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1);
  amp.connect(pn).connect(dest);
  const car = ctx.createOscillator(); car.frequency.value = f;
  const mod = ctx.createOscillator(); mod.frequency.value = Math.min(f * 7, 20000);
  const dg = ctx.createGain();
  const idx = f * 7 > 16000 ? 0 : 1.0 * bright * Math.min(1, Math.pow(700 / f, 0.8));
  dg.gain.setValueAtTime(idx * f * 7, start); dg.gain.setTargetAtTime(0, start, 0.022);
  mod.connect(dg).connect(car.frequency);
  car.connect(amp);
  const oct = ctx.createOscillator(); oct.frequency.value = f * 2.005;
  const og = ctx.createGain(); og.gain.setValueAtTime(0.22, start); og.gain.setTargetAtTime(0, start, 0.05);
  oct.connect(og).connect(amp);
  for (const o of [car, mod, oct]) { o.start(start); o.stop(stop); }
  const n = S.noise('white', start, start + 0.03, 'kal' + start);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(gain * 0.5 * bright, start); ng.gain.setTargetAtTime(0, start, 0.003);
  n.connect(hp).connect(ng).connect(pn);
}

/** PIANO. Eight slightly inharmonic partials, two strings on the lower ones, upper partials die first. */
export function piano(S, dest, { note, start, gain = 0.2, decay = 3, pan = 0, soft = 0.3, width = 0.3 }) {
  const f = hz(note), stop = Math.min(S.limit, start + decay * 2.2 + 0.2);
  if (!S.claim(start, stop, 'piano')) return;
  const ctx = S.ctx, rng = createRng('pno' + note + start), B = 0.00045 * (f < 180 ? 1.8 : 1);
  const bus = ctx.createGain(); bus.gain.value = gain;
  const pn = ctx.createStereoPanner(); pn.pan.value = pan;
  bus.connect(pn).connect(dest);
  for (let n = 1; n <= 8; n++) {
    const fn = f * n * Math.sqrt(1 + B * n * n);
    if (fn > 11000) break;
    const a = Math.pow(n, -1.15) * Math.exp(-soft * (n - 1) * 0.5);
    const tauN = (decay / 3.2) / (1 + 0.38 * (n - 1));
    const stringsN = n <= 3 ? [-0.8, 0.9] : [0];
    for (const cents of stringsN) {
      const o = ctx.createOscillator(); o.frequency.value = fn; o.detune.value = cents + (rng() - 0.5) * 0.4;
      const g = ctx.createGain(), lv = a / stringsN.length;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(lv, start + 0.0015 + soft * 0.004);
      g.gain.setTargetAtTime(lv * 0.42, start + 0.002 + soft * 0.004, tauN * 0.16);
      g.gain.setTargetAtTime(0, start + tauN * 0.55, tauN);
      const p = ctx.createStereoPanner(); p.pan.value = clamp((rng() - 0.5) * 2 * width, -1, 1);
      o.connect(g).connect(p).connect(bus);
      o.start(start); o.stop(Math.min(stop, start + tauN * 9 + 0.3));
    }
  }
  // hammer: a soft low thump
  const nz = S.noise('pink', start, start + 0.08, 'pnoh' + start);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400 * Math.pow(f / 440, 0.4) * (1.2 - soft);
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0, start); ng.gain.linearRampToValueAtTime(1.6 * (1 - soft * 0.5), start + 0.001); ng.gain.setTargetAtTime(0, start + 0.001, 0.009);
  nz.connect(lp).connect(ng).connect(bus);
}

/** CENTURY DRUM. Sine swept 90 -> 45 Hz in 0.25 s, a low-passed noise thump, a skin slap, saturated. */
export function drum(S, dest, { start, gain = 0.5, deep = 0 }) {
  const stop = start + 4 + deep * 2;
  if (!S.claim(start, stop, 'drum')) return;
  const ctx = S.ctx;
  const f0 = 90 - 10 * deep, f1 = 45 - 5 * deep, tau = 0.36 + 0.14 * deep;
  const sat = saturator(ctx, 1.2);
  const out = ctx.createGain(); out.gain.value = gain;
  sat.connect(out).connect(dest);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f0, start); o.frequency.exponentialRampToValueAtTime(f1, start + 0.25);
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.42, start + 0.004); g.gain.setTargetAtTime(0, start + 0.03, tau);
  o.connect(g).connect(sat); o.start(start); o.stop(stop);
  const o2 = ctx.createOscillator();
  o2.frequency.setValueAtTime(f0 * 2, start); o2.frequency.exponentialRampToValueAtTime(f1 * 2, start + 0.2);
  const g2 = ctx.createGain(); g2.gain.value = 0;
  g2.gain.setValueAtTime(0, start); g2.gain.linearRampToValueAtTime(0.52, start + 0.003); g2.gain.setTargetAtTime(0, start + 0.01, 0.16);
  o2.connect(g2).connect(sat); o2.start(start); o2.stop(start + 1.2);
  const n = S.noise('brown', start, start + 1.5, 'drum' + start);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(300, start); lp.frequency.exponentialRampToValueAtTime(85, start + 0.35);
  const ng = ctx.createGain(); ng.gain.value = 0;
  ng.gain.setValueAtTime(0, start); ng.gain.linearRampToValueAtTime(1.5, start + 0.003); ng.gain.setTargetAtTime(0, start + 0.004, 0.11 + 0.05 * deep);
  n.connect(lp).connect(ng).connect(sat);
  const n2 = S.noise('pink', start, start + 0.3, 'drumskin' + start);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
  const sg = ctx.createGain(); sg.gain.value = 0;
  sg.gain.setValueAtTime(0, start); sg.gain.linearRampToValueAtTime(2.4, start + 0.001); sg.gain.setTargetAtTime(0, start + 0.001, 0.035);
  n2.connect(bp).connect(sg).connect(sat);
}

/** HEART. Two 55 Hz thumps 160 ms apart, the second 6 dB quieter. */
export function heart(S, dest, { start, gain = 0.15 }) {
  if (!S.claim(start, start + 0.8, 'heart')) return;
  const ctx = S.ctx;
  [[0, 1], [0.16, 0.5]].forEach(([dt, a]) => {
    const t = start + dt;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(64, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.05); o.frequency.exponentialRampToValueAtTime(50, t + 0.3);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * a, t + 0.01); g.gain.setTargetAtTime(0, t + 0.012, 0.06);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.6);
    // second harmonic: lets the pulse read on small speakers
    const h = ctx.createOscillator(); h.frequency.setValueAtTime(128, t); h.frequency.exponentialRampToValueAtTime(108, t + 0.06);
    const hg = ctx.createGain(); hg.gain.value = 0;
    hg.gain.setValueAtTime(0, t); hg.gain.linearRampToValueAtTime(gain * a * 0.4, t + 0.006); hg.gain.setTargetAtTime(0, t + 0.008, 0.03);
    h.connect(hg).connect(dest); h.start(t); h.stop(t + 0.4);
    const h3 = ctx.createOscillator(); h3.frequency.setValueAtTime(190, t); h3.frequency.exponentialRampToValueAtTime(162, t + 0.05);
    const h3g = ctx.createGain(); h3g.gain.value = 0;
    h3g.gain.setValueAtTime(0, t); h3g.gain.linearRampToValueAtTime(gain * a * 0.22, t + 0.005); h3g.gain.setTargetAtTime(0, t + 0.007, 0.02);
    h3.connect(h3g).connect(dest); h3.start(t); h3.stop(t + 0.3);
    const h4 = ctx.createOscillator(); h4.frequency.setValueAtTime(262, t); h4.frequency.exponentialRampToValueAtTime(218, t + 0.04);
    const h4g = ctx.createGain(); h4g.gain.value = 0;
    h4g.gain.setValueAtTime(0, t); h4g.gain.linearRampToValueAtTime(gain * a * 0.11, t + 0.004); h4g.gain.setTargetAtTime(0, t + 0.006, 0.016);
    h4.connect(h4g).connect(dest); h4.start(t); h4.stop(t + 0.25);
    // the soft "thud" of the beat itself, 150-500 Hz: what a small speaker makes of a heart
    const n = S.noise('brown', t, t + 0.2, 'heart' + t);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    const ng = ctx.createGain(); ng.gain.value = 0;
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(gain * a * 2.4, t + 0.006); ng.gain.setTargetAtTime(0, t + 0.008, 0.022);
    n.connect(bp).connect(hp).connect(ng).connect(dest);
  });
}

/**
 * SUB. Sine pairs on D1 and A1 detuned 0.15 Hz for slow beating; returns { duck } to dip under drums.
 * `presence` adds the same open fifth one and two octaves up (D2 A2 D3 A3, each a slowly beating
 * pair, a little saturated): the drone a laptop or a phone can actually reproduce.
 */
export function sub(S, dest, { env, gain = 0.1, presence = 0 }) {
  const t0 = Math.max(0, env[0][0]), t1 = env[env.length - 1][0];
  if (!S.claim(t0, t1 + 0.1, 'sub')) return { duckAt() {} };
  const ctx = S.ctx;
  const amp = ctx.createGain(); curve(amp.gain, env, (v) => v * gain);
  const duck = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.5;
  lp.connect(amp).connect(duck).connect(dest);
  for (const [f, a] of [[36.708, 1], [36.858, 1], [55, 0.55], [55.15, 0.55]]) {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = a * 0.5;
    o.connect(g).connect(lp); o.start(t0); o.stop(t1 + 0.05);
  }
  const tri = ctx.createOscillator(); tri.type = 'triangle'; tri.frequency.value = 73.416;
  const tg = ctx.createGain(); tg.gain.value = 0.16;
  tri.connect(tg).connect(lp); tri.start(t0); tri.stop(t1 + 0.05);
  if (presence > 0) {
    const sat = saturator(ctx, 2.2), pre = ctx.createGain(), post = ctx.createGain();
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 900; lp2.Q.value = 0.5;
    pre.gain.value = 0.5; post.gain.value = presence;
    pre.connect(sat).connect(lp2).connect(post).connect(amp);
    for (const [f, a] of [[73.416, 0.3], [73.6, 0.24], [110, 0.3], [110.23, 0.24], [146.83, 0.42], [147.1, 0.34], [220, 0.3], [220.31, 0.24]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = a;
      o.connect(g).connect(pre); o.start(t0); o.stop(t1 + 0.05);
    }
  }
  return {
    duckAt(t, depth = 0.35) {
      duck.gain.setValueAtTime(1, t - 0.012);
      duck.gain.linearRampToValueAtTime(depth, t + 0.01);
      duck.gain.setTargetAtTime(1, t + 0.18, 0.3);
    },
  };
}

// ========================================================================================== effects

/**
 * A bed: looping noise or texture -> filters -> gain breakpoints -> optional gusts / sizzle / pan.
 * gain: [[t, v], ...] (also defines start and end). filters: [{ type, f, q, gain }], f may be
 * breakpoints or { wander }. gust: { hz, depth }. am: { hz, depth } multiplies by fast random motion.
 */
export function bed(S, dest, { src = 'pink', gain, k = 1, filters = [], rate = 1, pan = null, mono = false, gust = null, am = null, seed = '' }) {
  const t0 = Math.max(0, gain[0][0]), t1 = Math.min(S.limit, gain[gain.length - 1][0]);
  if (!S.claim(t0, t1 + 0.1, 'bed')) return null;
  const ctx = S.ctx, id = `${src}:${seed}:${t0}`;
  const s = S.noise(src, t0, t1 + 0.05, id);
  s.playbackRate.value = rate;
  let node = s;
  if (mono) {
    const m = ctx.createGain(); m.channelCount = 1; m.channelCountMode = 'explicit';
    node.connect(m); node = m;
  }
  // A band-pass has gentle skirts and pink / brown noise is bass-heavy: without help every wind
  // would carry rumble. Band-passed noise beds get a high-pass well below their lowest centre.
  if (filters.length && filters[0].type === 'bandpass' && (src === 'pink' || src === 'brown' || src === 'white')) {
    const f = filters[0].f, lowest = typeof f === 'number' ? f : Array.isArray(f) ? Math.min(...f.map((x) => x[1])) : f.wander.min;
    filters = [...filters, { type: 'highpass', f: lowest * 0.5, q: 0.7 }];
  }
  for (const f of filters) {
    const bq = ctx.createBiquadFilter(); bq.type = f.type; bq.Q.value = f.q ?? 0.7;
    setParam(bq.frequency, f.f, t0, t1);
    if (f.gain !== undefined) bq.gain.value = f.gain;
    node.connect(bq); node = bq;
  }
  const amp = ctx.createGain(); ramp(amp.gain, gain, k);
  node.connect(amp); node = amp;
  if (gust) {
    const g = ctx.createGain(), n = Math.max(8, Math.ceil((t1 - t0) * 12));
    const arr = smoothCurve('gust:' + id, n, { min: 1 - gust.depth, max: 1, rate: Math.max(0.5, (t1 - t0) * gust.hz) });
    g.gain.value = arr[0]; g.gain.setValueCurveAtTime(arr, t0, t1 - t0);
    node.connect(g); node = g;
  }
  if (am) {
    // multiply by (1 + depth * low-passed noise): the sizzle of sand, spindrift, embers
    const g = ctx.createGain(); g.gain.value = 1;
    const m = S.noise('white', t0, t1 + 0.05, 'am:' + id);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = am.hz; lp.Q.value = 0.5;
    const mono1 = ctx.createGain(); mono1.channelCount = 1; mono1.channelCountMode = 'explicit';
    // white (rms 0.25) through a low-pass at am.hz keeps about sqrt(hz / 24000) of its level
    mono1.gain.value = am.depth / (0.25 * Math.sqrt(am.hz / 24000) * 1.25);
    m.connect(lp).connect(mono1).connect(g.gain);
    node.connect(g); node = g;
  }
  if (pan !== null) {
    const p = ctx.createStereoPanner(); setParam(p.pan, pan, t0, t1);
    node.connect(p); node = p;
  }
  node.connect(dest);
  return node;
}

/** Play a one-shot asset at `start` (sample-exact when start * sampleRate is an integer). */
export function shot(S, dest, name, start, { gain = 1, rate = 1, lowpass = null, highpass = null } = {}) {
  if (!S.claim(start, start + S.assets.get(name)[0].length / S.sr / rate + 0.05, 'shot')) return null;
  const ctx = S.ctx, s = ctx.createBufferSource();
  s.buffer = S.buf(name); s.playbackRate.value = rate;
  let node = s;
  if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; f.Q.value = 0.6; node.connect(f); node = f; }
  if (highpass) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = highpass; f.Q.value = 0.6; node.connect(f); node = f; }
  const g = ctx.createGain(); g.gain.value = gain;
  node.connect(g).connect(dest);
  s.start(start);
  return s;
}

/** A water drop: one sine "bloop" with an upward chirp. */
export function bloop(S, dest, { start, f = 900, rise = 2.1, dur = 0.09, gain = 0.1 }) {
  if (!S.claim(start, start + dur * 3 + 0.02, 'bloop')) return;
  const ctx = S.ctx, o = ctx.createOscillator();
  o.frequency.setValueAtTime(f, start); o.frequency.exponentialRampToValueAtTime(f * rise, start + dur * 0.7);
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(gain, start + 0.003); g.gain.setTargetAtTime(0, start + 0.004, dur / 3.5);
  o.connect(g).connect(dest); o.start(start); o.stop(start + dur * 3);
}

/** A dry tick: a tiny resonant click (a drop landing, a seed touching a pebble, mud cracking). */
export function tick(S, dest, { start, f = 2400, tau = 0.004, gain = 0.1, noise = 0.6, hp = 1500 }) {
  if (!S.claim(start, start + tau * 10 + 0.08, 'tick')) return;
  const ctx = S.ctx, o = ctx.createOscillator();
  o.frequency.setValueAtTime(f * 1.3, start); o.frequency.exponentialRampToValueAtTime(f, start + tau * 2);
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(gain, start + 0.0004); g.gain.setTargetAtTime(0, start + 0.0005, tau);
  o.connect(g).connect(dest); o.start(start); o.stop(start + tau * 10 + 0.02);
  if (noise > 0) {
    const n = S.noise('white', start, start + 0.05, 'tick' + start);
    const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(gain * noise * 2, start); ng.gain.setTargetAtTime(0, start, tau * 0.5);
    n.connect(h).connect(ng).connect(dest);
  }
}

/**
 * Creak / groan: an FM pair with gliding pitch, stuttered by a slowing saw (stick-slip), through a
 * sweeping band-pass. Low and long = glacier ice; mid and short = wood; high and tiny = fibres.
 */
export function creak(S, dest, { start, dur = 2, f = [90, 60], ratio = 1.47, index = 4, stutter = [22, 9], band = [300, 700], q = 3, gain = 0.1, depth = 0.8 }) {
  const end = start + dur;
  if (!S.claim(start, end + 0.1, 'creak')) return;
  const ctx = S.ctx;
  const car = ctx.createOscillator(), mod = ctx.createOscillator();
  car.frequency.setValueAtTime(f[0], start); car.frequency.exponentialRampToValueAtTime(f[1], end);
  mod.frequency.setValueAtTime(f[0] * ratio, start); mod.frequency.exponentialRampToValueAtTime(f[1] * ratio, end);
  const dg = ctx.createGain(); dg.gain.setValueAtTime(index * f[0] * ratio, start); dg.gain.linearRampToValueAtTime(index * 0.5 * f[1] * ratio, end);
  mod.connect(dg).connect(car.frequency);
  const st = ctx.createOscillator(); st.type = 'sawtooth';
  st.frequency.setValueAtTime(stutter[0], start); st.frequency.exponentialRampToValueAtTime(stutter[1], end);
  const sd = ctx.createGain(); sd.gain.value = depth / 2;
  const sg = ctx.createGain(); sg.gain.value = 1 - depth / 2;
  st.connect(sd).connect(sg.gain);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
  bp.frequency.setValueAtTime(band[0], start); bp.frequency.exponentialRampToValueAtTime(band[1], start + dur * 0.6); bp.frequency.exponentialRampToValueAtTime(band[0] * 0.8, end);
  const amp = ctx.createGain(); amp.gain.value = 0;
  amp.gain.setValueAtTime(0, start); amp.gain.linearRampToValueAtTime(gain, start + dur * 0.25);
  amp.gain.linearRampToValueAtTime(gain * 0.6, start + dur * 0.7); amp.gain.linearRampToValueAtTime(0, end);
  car.connect(sg).connect(bp).connect(amp).connect(dest);
  for (const o of [car, mod, st]) { o.start(start); o.stop(end + 0.05); }
}

/** The frozen-lake "pew": a fast descending sine chirp. */
export function pew(S, dest, { start, f = [5200, 420], dur = 0.16, gain = 0.05 }) {
  if (!S.claim(start, start + dur * 3 + 0.02, 'pew')) return;
  const ctx = S.ctx, o = ctx.createOscillator();
  o.frequency.setValueAtTime(f[0], start); o.frequency.exponentialRampToValueAtTime(f[1], start + dur);
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(gain, start + 0.002); g.gain.setTargetAtTime(0, start + 0.004, dur / 2.2);
  o.connect(g).connect(dest); o.start(start); o.stop(start + dur * 3);
}

/** Birdsong: a list of syllables { dt, f: [from, to], dur, a }, each a fast sine sweep. */
export function bird(S, dest, { start, syl, gain = 0.05 }) {
  if (!S.claim(start, start + Math.max(...syl.map((x) => x.dt + x.dur)) + 0.05, 'bird')) return;
  const ctx = S.ctx;
  for (const s of syl) {
    const t = start + s.dt, d = s.dur;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    for (const [osc, m] of [[o, 1], [o2, 2]]) {
      osc.frequency.setValueAtTime(s.f[0] * m, t);
      if (s.f.length === 3) { osc.frequency.exponentialRampToValueAtTime(s.f[1] * m, t + d * 0.5); osc.frequency.exponentialRampToValueAtTime(s.f[2] * m, t + d); }
      else osc.frequency.exponentialRampToValueAtTime(s.f[1] * m, t + d);
    }
    const g = ctx.createGain(); g.gain.value = 0;
    const a = gain * (s.a ?? 1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + d * 0.25); g.gain.linearRampToValueAtTime(a * 0.7, t + d * 0.7); g.gain.linearRampToValueAtTime(0, t + d);
    const g2 = ctx.createGain(); g2.gain.value = 0.12;
    o.connect(g); o2.connect(g2).connect(g); g.connect(dest);
    o.start(t); o2.start(t); o.stop(t + d + 0.02); o2.stop(t + d + 0.02);
  }
}

/** A glassy "sheet" resonance: inharmonic sine partials with a slow bloom (the fracture plane flashes). */
export function sheet(S, dest, { start, base = 830, gain = 0.05, dur = 3.5 }) {
  if (S.claim(start, start + dur + 0.6, 'sheet')) {
  const ctx = S.ctx, rng = createRng('sheet' + start);
  [1, 1.47, 2.09, 2.56, 3.39, 4.08, 5.3].forEach((m, i) => {
    const o = ctx.createOscillator(); o.frequency.value = base * m * (1 + (rng() - 0.5) * 0.004);
    const g = ctx.createGain(); g.gain.value = 0;
    const a = gain / (1 + i * 0.45), at = 0.18 + rng() * 0.25;
    g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(a, start + at); g.gain.setTargetAtTime(0, start + at, dur / (5 + i * 1.2));
    const p = ctx.createStereoPanner(); p.pan.value = (rng() - 0.5) * 1.6;
    o.connect(g).connect(p).connect(dest); o.start(start); o.stop(start + dur + 0.5);
  });
  }
  bed(S, dest, { src: 'white', gain: [[start, 0], [start + 0.35, 1], [start + 1.6, 0]], k: gain * 0.5, filters: [{ type: 'bandpass', f: 4200, q: 1.5 }], seed: 'sheet' });
}

/** A low thud: a sine falling in pitch (distant ice calving, the soil closing over). env: [[t, level], ...] */
export function thud(S, dest, { start, f = [58, 31], glide = 0.6, env, gain = 0.25 }) {
  const end = env[env.length - 1][0];
  if (!S.claim(start, end + 0.1, 'thud')) return;
  const ctx = S.ctx, o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(f[0], start); o.frequency.exponentialRampToValueAtTime(f[1], start + glide);
  ramp(g.gain, env, gain);
  o.connect(g).connect(dest); o.start(start); o.stop(end + 0.05);
}
