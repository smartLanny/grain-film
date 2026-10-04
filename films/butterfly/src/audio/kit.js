// The orchestra and the foley kit of 《梦蝶》 / THE DREAM OF THE BUTTERFLY, built on the Web Audio API.
//
// A Stem is one OfflineAudioContext with a dry bus and the sends of the film's two rooms:
// "room" (concrete: 0.9 s, dark, the ink world) and "air" (open air: 3.2 s, clear, its highs dying
// first, the colour world). The score renders many stems in parallel and mixes them (see score.js).
// Instruments and effects are plain functions (S, dest, options) that schedule nodes at absolute
// film times. The voices that are computed in JS (voices.js: QIN, XIAO, WINGS, foley) are played
// here through buffer sources, so that panning, sends and filters are the same for everything.
// All randomness is seeded.

import { createRng } from '../lib/random.js';
import { hz, smoothCurve } from './synth.js';
import * as V from './voices.js';

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
 * channels are the dry bus and the two reverb sends (room, air), each stereo; the reverbs
 * themselves are applied once per reel after the chunks are summed (score.js).
 *
 * With `probe` set, no audio graph exists: the cue sheet is run once just to learn, per window, when
 * its last event ends. Every instrument starts with `if (!S.claim(start, end)) return;`.
 *
 * Parts: every event belongs to the music or to the sound effects (`S.part`, set by the score for
 * each of its cue functions; `S.as(part, fn)` files the events scheduled inside fn under another
 * part). With `part` set, the stem renders only that part's events: the two stems of the mix.
 */
export class Stem {
  constructor({ assets, sr = 48000, origin = 0, win = [-Infinity, Infinity], seconds = 1, limit = Infinity, probe = null, only = null, part = null }) {
    this.only = only;   // debugging: restrict to these instrument kinds
    this.partOnly = part; this.part = null;
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
    this.main = { dry: bus(0), room: bus(1), air: bus(2) };
  }
  /** Does this event (film times) belong to this chunk? In probe mode: record it and say no. */
  claim(start, end, kind) {
    if (start >= this.limit || (this.only && !this.only.includes(kind)) || (this.partOnly && this.part !== this.partOnly)) return false;
    end = Math.min(end, this.limit);
    if (this.probe) {
      const k = Math.max(0, Math.floor((start - this.probe.t0) / this.probe.W + 1e-9));
      this.probe.ends[k] = Math.max(this.probe.ends[k] || 0, end);
      return false;
    }
    return start >= this.win[0] - 1e-9 && start < this.win[1] - 1e-9;
  }
  /** Schedule the events made inside `fn` under another part ('music' | 'sfx'). */
  as(part, fn) { const was = this.part; this.part = part; try { fn(); } finally { this.part = was; } }
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
  /** AudioBuffer of a voice computed in JS: made once (by `make`) and shared by every stem under `key`. */
  voiceBuf(key, make) {
    let b = this._bufs.get(key);
    if (!b) {
      const chs = this.assets.make(key, make);
      b = this.raw.createBuffer(chs.length, chs[0].length, this.sr);
      chs.forEach((c, i) => b.copyToChannel(c, i));
      this._bufs.set(key, b);
    }
    return b;
  }
  /** A parallel set of buses (dry / room / air) that pass through three identical inserts. */
  group(makeInsert) {
    if (this.probe) return {};
    const mk = (target) => { const n = makeInsert(this.ctx); n.connect(target); return n; };
    return { dry: mk(this.main.dry), room: mk(this.main.room), air: mk(this.main.air) };
  }
  /**
   * Output strip: gain -> pan -> dry + reverb sends. Returns the node to connect sources to.
   * dry / room / air: a level, or breakpoints [[t, level], ...] (eased): a send that moves, so a
   * sound can pass from the concrete room into the open air (or back) across a crossing.
   */
  out({ gain = 1, pan = 0, dry = 1, room = 0, air = 0, group = null } = {}) {
    if (this.probe) return null;
    const ctx = this.ctx, g = ctx.createGain(), G = group || this.main;
    g.gain.value = gain;
    let node = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); node = p; }
    const send = (target, amount) => {
      if (!amount) return;
      if (amount === 1) { node.connect(target); return; }
      const s = ctx.createGain();
      if (Array.isArray(amount)) curve(s.gain, amount); else s.gain.value = amount;
      node.connect(s).connect(target);
    };
    send(G.dry, dry); send(G.room, room); send(G.air, air);
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

/** A panner whose position follows breakpoints [[t, pan], ...] (null while probing). */
export function panTo(S, dest, pts) {
  if (S.probe) return null;
  const p = S.ctx.createStereoPanner();
  ramp(p.pan, pts);
  p.connect(dest);
  return p;
}
/** A gain that follows breakpoints [[t, level], ...] in front of `dest` (null while probing). */
export function fader(S, dest, pts) {
  if (S.probe) return null;
  const g = S.ctx.createGain();
  ramp(g.gain, pts);
  g.connect(dest);
  return g;
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
  // the body of the instruments: wood resonances, a low bridge hill near 2.5 kHz, and no fizz above it
  // (bare saws are a synthesizer; a section of strings has this envelope over them)
  const body = [['peaking', 460, 1.1, 2], ['peaking', 1150, 1.2, 2.5], ['peaking', 2500, 1.3, 1.5], ['highshelf', 4500, 0.7, -8.5]].map(([type, f, q, g]) => {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b;
  });
  const trim = ctx.createGain(); trim.gain.value = 0.9;   // the resonances are boosts: keep the section's loudness where it was
  body[0].connect(body[1]).connect(body[2]).connect(body[3]).connect(trim).connect(dest);
  dest = body[0];
  notes.forEach((note, ni) => {
    const f = hz(note), kt = Math.pow(f / 220, track);
    const lowNarrow = clamp((f - 60) / 200, 0.25, 1);   // basses stay near the centre, violins spread wide
    const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter();
    lp1.type = 'lowpass'; lp1.Q.value = 0.7; lp2.type = 'lowpass'; lp2.Q.value = 0.5;
    curve(lp1.frequency, env, (v) => Math.min(12000, cut[0] * Math.pow(cut[1] / cut[0], v) * kt));
    curve(lp2.frequency, env, (v) => Math.min(16000, 2.4 * cut[0] * Math.pow(cut[1] / cut[0], v) * kt));
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
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
    const g = ctx.createGain();
    curve(g.gain, env, (v) => Math.pow(v, 1.4) * bow * gain * 0.16 * Math.sqrt(notes.length));
    n.connect(bp).connect(hp).connect(g).connect(dest);
  }
}

/** GLASS. FM bell (1 : 3.5, index decaying), two beating carriers, strike partials, a soft hum.
 *  The strike's sidebands are kept under a low-pass that follows the pitch (4.5 x f), so a bell rings
 *  without a hiss on top of it. wob: { rate, depth (cents), slow } makes the pitch quiver (a drop of
 *  water trembling). */
export function glass(S, dest, { note, freq, start, gain = 0.1, decay = 5, index = 1.4, ratio = 3.5, pan = 0, soft = 0, wob = null, lp: lpf = 9500 }) {
  const f = freq ?? hz(note);
  const tau = decay / 6.9, stop = Math.min(S.limit, start + decay * 1.3 + 0.3), at = 0.003 + soft * 0.03;
  if (!S.claim(start, stop, 'glass')) return;
  const ctx = S.ctx;
  if (f * ratio > 17000) ratio = 1;   // keep the modulator well under Nyquist for the highest pings
  const idx = 0.72 * index * Math.min(1, Math.pow(1100 / f, 0.9));
  const amp = ctx.createGain(); amp.gain.value = 0;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + at);
  amp.gain.setTargetAtTime(gain * 0.5, start + at, 0.09);
  amp.gain.setTargetAtTime(0, start + 0.3, tau);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(lpf, Math.max(3600, 4.5 * f)); lp.Q.value = 0.5;
  const pn = ctx.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1);
  amp.connect(lp).connect(pn).connect(dest);
  let wd = null;
  if (wob) {
    const l = ctx.createOscillator();
    l.frequency.setValueAtTime(wob.rate, start); l.frequency.exponentialRampToValueAtTime(wob.rate * (wob.slow ?? 0.6), start + decay * 0.6);
    wd = ctx.createGain(); wd.gain.setValueAtTime(wob.depth, start); wd.gain.setTargetAtTime(wob.depth * 0.2, start + 0.1, decay / 4);
    l.connect(wd); l.start(start); l.stop(stop);
  }
  const mod = ctx.createOscillator(); mod.frequency.value = f * ratio;
  const dg = ctx.createGain();
  dg.gain.setValueAtTime(idx * f * ratio, start);
  dg.gain.setTargetAtTime(idx * 0.1 * f * ratio, start, Math.max(0.04, decay / 18));
  mod.connect(dg); mod.start(start); mod.stop(stop);
  for (const d of [-1, 1]) {
    const car = ctx.createOscillator(); car.frequency.value = f * (1 + d * 0.0006);
    dg.connect(car.frequency);
    if (wd) wd.connect(car.detune);
    const g = ctx.createGain(); g.gain.value = 0.5;
    car.connect(g).connect(amp); car.start(start); car.stop(stop);
  }
  const partial = (mult, level, t) => {
    if (f * mult > 15000) return;
    const o = ctx.createOscillator(); o.frequency.value = f * mult;
    const g = ctx.createGain(); g.gain.setValueAtTime(level, start); g.gain.setTargetAtTime(0, start, t);
    o.connect(g).connect(amp); o.start(start); o.stop(Math.min(stop, start + t * 8));
  };
  partial(2.76, 0.08, tau * 0.25); partial(5.41, 0.02, tau * 0.1);
  // hum an octave below, blooming late: warmth
  const hum = ctx.createOscillator(); hum.frequency.value = f * 0.5;
  const hg = ctx.createGain(); hg.gain.value = 0;
  hg.gain.setValueAtTime(0, start); hg.gain.linearRampToValueAtTime(0.16, start + 0.08); hg.gain.setTargetAtTime(0.08, start + 0.08, tau);
  hum.connect(hg).connect(amp); hum.start(start); hum.stop(stop);
}

/**
 * FELT. A soft piano heard through felt: eight slightly inharmonic partials, two strings on the
 * lower ones, the upper partials dying first, everything low-passed at 1.2 kHz, a 3 s decay.
 */
export function felt(S, dest, { note, start, gain = 0.2, decay = 3, pan = 0, soft = 0.6, width = 0.3, cut = 1200 }) {
  const f = hz(note), stop = Math.min(S.limit, start + decay * 2.2 + 0.2);
  if (!S.claim(start, stop, 'felt')) return;
  const ctx = S.ctx, rng = createRng('felt' + note + start), B = 0.00045 * (f < 180 ? 1.8 : 1);
  const bus = ctx.createGain(); bus.gain.value = gain;
  const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = cut; lpf.Q.value = 0.5;
  const pn = ctx.createStereoPanner(); pn.pan.value = pan;
  bus.connect(lpf).connect(pn).connect(dest);
  for (let n = 1; n <= 8; n++) {
    const fn = f * n * Math.sqrt(1 + B * n * n);
    if (fn > 9000) break;
    const a = Math.pow(n, -1.15) * Math.exp(-soft * (n - 1) * 0.5);
    const tauN = (decay / 3.2) / (1 + 0.38 * (n - 1));
    const stringsN = n <= 3 ? [-0.9, 1.0] : [0];
    for (const cents of stringsN) {
      const o = ctx.createOscillator(); o.frequency.value = fn; o.detune.value = cents + (rng() - 0.5) * 0.4;
      const g = ctx.createGain(), lv = a / stringsN.length;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(lv, start + 0.003 + soft * 0.008);
      g.gain.setTargetAtTime(lv * 0.5, start + 0.004 + soft * 0.008, tauN * 0.16);
      g.gain.setTargetAtTime(0, start + tauN * 0.55, tauN);
      const p = ctx.createStereoPanner(); p.pan.value = clamp((rng() - 0.5) * 2 * width, -1, 1);
      o.connect(g).connect(p).connect(bus);
      o.start(start); o.stop(Math.min(stop, start + tauN * 9 + 0.3));
    }
  }
  // the hammer: felt on string, a soft low knock
  const nz = S.noise('pink', start, start + 0.1, 'felth' + start);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 * Math.pow(f / 440, 0.4) * (1.2 - soft);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0, start); ng.gain.linearRampToValueAtTime(1.3 * (1 - soft * 0.5), start + 0.002); ng.gain.setTargetAtTime(0, start + 0.002, 0.012);
  nz.connect(lp).connect(hp).connect(ng).connect(bus);
}

/**
 * DRUM. A big skin in the open: a sine swept 110 -> 70 Hz in 0.2 s, a noise thump, the slap of the
 * skin, and a partial at 220 Hz (falling with the head) that a small speaker can carry.
 * tap 0..1 turns it into a soft, short tap of the fingers (the umbrellas opening).
 */
export function drum(S, dest, { start, gain = 0.5, deep = 0, tap = 0 }) {
  const stop = start + (tap ? 1.2 : 3.2 + deep * 1.5);
  if (!S.claim(start, stop, 'drum')) return;
  const ctx = S.ctx, k = 1 - tap;
  const tau = (0.3 + 0.16 * deep) * (1 - 0.7 * tap);
  const sat = saturator(ctx, 1.2);
  const out = ctx.createGain(); out.gain.value = gain;
  sat.connect(out).connect(dest);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(110, start); o.frequency.exponentialRampToValueAtTime(70, start + 0.2);
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.3 * (0.45 + 0.55 * k), start + 0.004); g.gain.setTargetAtTime(0, start + 0.03, tau);
  o.connect(g).connect(sat); o.start(start); o.stop(stop);
  const o2 = ctx.createOscillator();
  o2.frequency.setValueAtTime(220, start); o2.frequency.exponentialRampToValueAtTime(140, start + 0.2);
  const g2 = ctx.createGain(); g2.gain.value = 0;
  g2.gain.setValueAtTime(0, start); g2.gain.linearRampToValueAtTime(0.5, start + 0.003); g2.gain.setTargetAtTime(0, start + 0.01, 0.2 * (1 - 0.6 * tap));
  o2.connect(g2).connect(sat); o2.start(start); o2.stop(start + 1.4);
  const o3 = ctx.createOscillator();
  o3.frequency.setValueAtTime(352, start); o3.frequency.exponentialRampToValueAtTime(262, start + 0.15);
  const g3 = ctx.createGain(); g3.gain.value = 0;
  g3.gain.setValueAtTime(0, start); g3.gain.linearRampToValueAtTime(0.2, start + 0.002); g3.gain.setTargetAtTime(0, start + 0.006, 0.07);
  o3.connect(g3).connect(sat); o3.start(start); o3.stop(start + 0.7);
  const n = S.noise('brown', start, start + 1.5, 'drum' + start);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(340, start); lp.frequency.exponentialRampToValueAtTime(110, start + 0.35);
  const ng = ctx.createGain(); ng.gain.value = 0;
  ng.gain.setValueAtTime(0, start); ng.gain.linearRampToValueAtTime(1.1 * k + 0.5 * tap, start + 0.003); ng.gain.setTargetAtTime(0, start + 0.004, 0.11 + 0.05 * deep);
  n.connect(lp).connect(ng).connect(sat);
  const n2 = S.noise('pink', start, start + 0.3, 'drumskin' + start);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520 + 240 * tap; bp.Q.value = 0.7;
  const sg = ctx.createGain(); sg.gain.value = 0;
  sg.gain.setValueAtTime(0, start); sg.gain.linearRampToValueAtTime(2.4 * (1 - 0.5 * tap), start + 0.001); sg.gain.setTargetAtTime(0, start + 0.001, 0.035 * (1 - 0.4 * tap));
  n2.connect(bp).connect(sg).connect(sat);
}

/**
 * Sustained sine partials under one envelope: hums, shimmers, glassy glissandi.
 * partials: [{ f, a = 1, pan = 0, beat (Hz: adds a quieter twin that far above, for a slow, shallow beat), trem: { rate, depth } }]
 * env: [[t, level], ...]; glide: [[t, ratio], ...] multiplies every frequency (exponential segments).
 */
export function tones(S, dest, { partials, env, gain = 0.05, glide = null, kind = 'tones' }) {
  const t0 = Math.max(0, env[0][0]), t1 = Math.min(S.limit, env[env.length - 1][0]);
  if (!S.claim(t0, t1 + 0.1, kind)) return;
  const ctx = S.ctx, amp = ctx.createGain();
  ramp(amp.gain, env, gain);
  amp.connect(dest);
  for (const p of partials) {
    for (const df of p.beat ? [0, p.beat] : [0]) {
      const o = ctx.createOscillator(), f = p.f + df;
      if (glide) {
        o.frequency.setValueAtTime(f * glide[0][1], Math.max(0, glide[0][0]));
        for (let k = 1; k < glide.length; k++) o.frequency.exponentialRampToValueAtTime(f * glide[k][1], glide[k][0]);
      } else o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = (p.a ?? 1) * (p.beat ? (df ? 0.22 : 0.78) : 1);
      o.connect(g);
      let node = g;
      if (p.trem) {
        const tg = ctx.createGain(); tg.gain.value = 1 - p.trem.depth / 2;
        const l = ctx.createOscillator(); l.frequency.value = p.trem.rate;
        const ld = ctx.createGain(); ld.gain.value = p.trem.depth / 2;
        l.connect(ld).connect(tg.gain); l.start(t0); l.stop(t1 + 0.05);
        node.connect(tg); node = tg;
      }
      if (p.pan) { const pn = ctx.createStereoPanner(); pn.pan.value = clamp(p.pan, -1, 1); node.connect(pn); node = pn; }
      node.connect(amp);
      o.start(t0); o.stop(t1 + 0.05);
    }
  }
}

/**
 * THREAD. The common tone carried across a crossing between the worlds: one sustained note in a
 * voice that belongs to neither (no pluck, no breath, no bow, no strike): a sine with a slow beat and
 * a breath of its octave, eased in and out. The two modes share all five notes, so either world can
 * hand it to the other; breakpoint sends on `dest` move it from one room into the other.
 * env: [[t, level 0..1], ...] (cosine-eased).
 */
export function thread(S, dest, { note, env, gain = 0.02, pan = 0 }) {
  const t0 = Math.max(0, env[0][0]), t1 = Math.min(S.limit, env[env.length - 1][0]);
  if (!S.claim(t0, t1 + 0.05, 'thread')) return;
  const ctx = S.ctx, f = hz(note), amp = ctx.createGain();
  curve(amp.gain, env, (v) => v * gain);
  let node = amp;
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); amp.connect(p); node = p; }
  node.connect(dest);
  for (const [m, a, beat] of [[1, 0.8, 0], [1, 0.2, 0.21], [2, 0.07, 0.33], [3, 0.015, 0]]) {
    const o = ctx.createOscillator(); o.frequency.value = f * m + beat;
    const g = ctx.createGain(); g.gain.value = a;
    o.connect(g).connect(amp); o.start(t0); o.stop(t1 + 0.05);
  }
}

/**
 * The alarm: the glass bell's FM (1 : 3.5) with the index held open, gated hard, through a piezo's
 * small resonance. Hard on and off (it lands on its sample), but with a modest index, a low resonance
 * and a low-pass, so it is unmistakably a beep without piercing.
 */
export function beep(S, dest, { note = 'B5', start, dur = 0.15, gain = 0.1, index = 0.85 }) {
  const stop = start + dur + 0.03;
  if (!S.claim(start, stop, 'beep')) return;
  const ctx = S.ctx, f = hz(note);
  const amp = ctx.createGain(); amp.gain.value = 0;
  amp.gain.setValueAtTime(0, start); amp.gain.linearRampToValueAtTime(gain, start + 0.001);
  amp.gain.setValueAtTime(gain, start + dur); amp.gain.linearRampToValueAtTime(0, start + dur + 0.006);
  const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2100; pk.Q.value = 1.6; pk.gain.value = 4;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600; hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.6;
  pk.connect(hp).connect(lp).connect(amp).connect(dest);
  const mod = ctx.createOscillator(); mod.frequency.value = f * 3.5;
  const dg = ctx.createGain(); dg.gain.value = index * f * 3.5;
  mod.connect(dg);
  for (const [m, a] of [[1, 0.75], [2, 0.24], [3, 0.07]]) {
    const car = ctx.createOscillator(); car.frequency.value = f * m;
    if (m === 1) dg.connect(car.frequency);
    const g = ctx.createGain(); g.gain.value = a;
    car.connect(g).connect(pk); car.start(start); car.stop(stop);
  }
  mod.start(start); mod.stop(stop);
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
export function shot(S, dest, name, start, { gain = 1, rate = 1, lowpass = null, highpass = null, kind = 'shot' } = {}) {
  if (!S.claim(start, start + S.assets.get(name)[0].length / S.sr / rate + 0.05, kind)) return null;
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

/**
 * Play a voice computed in JS (voices.js). `make` runs once, when the first stem claims the event;
 * `seconds` is the length of what it returns. Sample-exact when start * sampleRate is an integer.
 */
export function voice(S, dest, key, seconds, make, start, { gain = 1, rate = 1, lowpass = null, highpass = null, kind = 'voice' } = {}) {
  if (!S.claim(start, start + seconds / rate + 0.05, kind)) return null;
  const ctx = S.ctx, s = ctx.createBufferSource();
  s.buffer = S.voiceBuf(key, make); s.playbackRate.value = rate;
  let node = s;
  if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; f.Q.value = 0.6; node.connect(f); node = f; }
  if (highpass) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = highpass; f.Q.value = 0.6; node.connect(f); node = f; }
  const g = ctx.createGain(); g.gain.value = gain;
  node.connect(g).connect(dest);
  s.start(start);
  return s;
}

/** QIN. One plucked note (see voices.qinNote). `from` / `to` are note names: the slides. */
export function qin(S, dest, { note, start, gain = 0.2, from = null, to = null, seconds = 5.5, ...o }) {
  const key = `qin:${note}:${from}:${to}:${start}`;
  return voice(S, dest, key, seconds, () => V.qinNote(S.sr, { f: hz(note), from: hz(from || note), to: to ? hz(to) : null, seconds, seed: 'qin' + start, ...o }), start, { gain, kind: 'qin' });
}
/** QIN harmonic (泛音): pure, bell-like. */
export function qinHarmonic(S, dest, { note, start, gain = 0.1, seconds = 6.5, decay = 6 }) {
  return voice(S, dest, `fan:${note}:${start}`, seconds, () => V.qinHarmonic(S.sr, { f: hz(note), seconds, decay, seed: 'fan' + start }), start, { gain, kind: 'qin' });
}
/**
 * XIAO. One phrase, one breath flute. notes: [{ t (film time), note, dur, vel, slur, flutter, vib,
 * breath, tone, env }]; the phrase is rendered from `start` (default: the first note) for `seconds`.
 */
export function xiao(S, dest, { notes, start = notes[0].t, seconds, gain = 0.2, seed = 'xiao' }) {
  const last = notes[notes.length - 1];
  seconds = seconds ?? last.t + last.dur + 0.5 - start;
  return voice(S, dest, `xiao:${seed}:${start}`, seconds, () => V.xiaoPhrase(S.sr, { notes: notes.map((n) => ({ ...n, t: n.t - start, f: hz(n.note) })), seconds, seed: seed + start }), start, { gain, kind: 'xiao' });
}
/** WINGS. One flap. v picks one of a few seeded variants; rate re-pitches it a little. */
export function wing(S, dest, { start, size = 0.5, up = false, gain = 0.1, v = 0, rate = 1, lowpass = null }) {
  return voice(S, dest, `flap:${size}:${up}:${v}`, 0.3, () => V.flap(S.sr, { size, up, seed: 'flap' + v }), start, { gain, rate, lowpass, kind: 'wings' });
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

/** A low thud: a sine falling in pitch (distant ice calving, the soil closing over). env: [[t, level], ...] */
export function thud(S, dest, { start, f = [58, 31], glide = 0.6, env, gain = 0.25 }) {
  const end = env[env.length - 1][0];
  if (!S.claim(start, end + 0.1, 'thud')) return;
  const ctx = S.ctx, o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(f[0], start); o.frequency.exponentialRampToValueAtTime(f[1], start + glide);
  ramp(g.gain, env, gain);
  o.connect(g).connect(dest); o.start(start); o.stop(end + 0.05);
}
