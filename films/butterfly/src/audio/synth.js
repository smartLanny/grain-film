// Small synthesis toolkit for WebAudio (works on OfflineAudioContext). Everything is scheduled at
// absolute times in seconds and all randomness is seeded, so the score is deterministic.
//
//   hz('D3'), midiToHz(50), noteToMidi('F#4')
//   noiseBuffer(ctx, {seconds, color:'white'|'pink'|'brown', seed, channels})
//   adsr(param, t0, dur, {a, d, s, r, peak, floor})                 -> release end time
//   smoothCurve(seed, n, {min, max, rate})                           -> Float32Array for setValueCurveAtTime
//   impulseResponse(ctx, {seconds, decay, predelay, damping, seed})  -> stereo AudioBuffer
//   createReverb(ctx, {wet, dry, ...irOpts})                         -> {input, output, wet, dry}
//   createFDN(ctx, {size, feedback, damping, wet, dry})              -> {input, output} feedback-delay reverb
//   pad(ctx, dest, {notes, start, dur, voices, detune, type, cutoff, cutoffEnd, attack, release, gain, pan})
//   bell(ctx, dest, {freq|note, start, dur, ratio, index, decay, gain, pan})      2-op FM bell
//   wind(ctx, dest, {start, dur, seed, gain, cutoff, q, gust, gustRate})          filtered-noise wind
//   water(ctx, dest, {start, dur, seed, gain, drips, cutoff})                      noise bed + drips
//   masterBus(ctx, {gain})                                           -> {input} glue comp + limiter -> destination
//   panner(ctx, pan)                                                 -> StereoPannerNode

import { createRng } from '../lib/random.js';

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!m) throw new Error(`Bad note name "${name}"`);
  return 12 * (parseInt(m[3], 10) + 1) + PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const hz = (n) => (typeof n === 'number' ? n : midiToHz(noteToMidi(n)));

export function panner(ctx, pan = 0) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

/** Seeded noise buffer. */
export function noiseBuffer(ctx, { seconds = 4, color = 'white', seed = 'noise', channels = 2 } = {}) {
  const len = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(channels, len, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const rng = createRng(`${seed}:${c}`);
    const d = buf.getChannelData(c);
    if (color === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = rng() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (color === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
    }
    // short crossfade so the buffer loops without a click
    const fade = Math.min(len >> 2, Math.floor(ctx.sampleRate * 0.05));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
    }
  }
  return buf;
}

/** Looping noise source started at `start` for `dur` seconds. */
export function noiseSource(ctx, { start = 0, dur = 1, color = 'pink', seed = 'noise', seconds = 8 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, { seconds: Math.min(seconds, Math.max(dur, 1)), color, seed });
  src.loop = true;
  src.start(start, createRng(seed + ':off')() * src.buffer.duration);
  src.stop(start + dur + 0.05);
  return src;
}

/**
 * ADSR on an AudioParam (linear attack, exponential-ish decay and release via setTargetAtTime).
 * @returns {number} time at which the release has (practically) finished
 */
export function adsr(param, t0, dur, { a = 0.01, d = 0.2, s = 0.7, r = 0.5, peak = 1, floor = 0 } = {}) {
  param.setValueAtTime(floor, t0);
  param.linearRampToValueAtTime(peak, t0 + Math.max(a, 0.001));
  param.setTargetAtTime(s * peak, t0 + a, Math.max(d, 0.001) / 3);
  const tRel = t0 + Math.max(dur, a);
  param.setTargetAtTime(floor, tRel, Math.max(r, 0.001) / 5);
  return tRel + r;
}

/** Deterministic smooth random curve (sum of seeded sinusoids) mapped to [min, max]. */
export function smoothCurve(seed, n, { min = 0, max = 1, rate = 1, partials = 4 } = {}) {
  const rng = createRng(seed);
  const comps = Array.from({ length: partials }, (_, k) => ({ f: rate * (0.6 + rng() * 1.8) * (k + 1), ph: rng() * Math.PI * 2, a: 1 / (k + 1) }));
  const out = new Float32Array(Math.max(2, n));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const x = i / (out.length - 1);
    let v = 0;
    for (const c of comps) v += c.a * Math.sin(c.f * x * Math.PI * 2 + c.ph);
    out[i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  for (let i = 0; i < out.length; i++) out[i] = min + (max - min) * ((out[i] - lo) / (hi - lo || 1));
  return out;
}

/** Generated stereo impulse response: decorrelated noise, exponential decay, HF damping over time. */
export function impulseResponse(ctx, { seconds = 4, decay = 3, predelay = 0.015, damping = 0.65, seed = 'ir', early = 10 } = {}) {
  const sr = ctx.sampleRate;
  const pre = Math.floor(predelay * sr);
  const len = Math.ceil((seconds + predelay) * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const rng = createRng(`${seed}:${c}`);
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const tt = (i - pre) / sr;
      const env = Math.pow(10, (-3 * tt) / decay);
      const a = Math.min(0.985, 0.08 + damping * 0.9 * Math.min(1, tt / decay));
      lp += (rng() * 2 - 1 - lp) * (1 - a);
      const fadeIn = Math.min(1, tt / 0.004);
      d[i] = lp * env * fadeIn * (1 + a * 2.5); // compensate the lowpass level loss
    }
    // a few discrete early reflections
    for (let k = 0; k < early; k++) {
      const at = pre + Math.floor((0.004 + rng() * 0.07) * sr);
      if (at < len) d[at] += (rng() < 0.5 ? -1 : 1) * (0.5 - k * 0.03);
    }
  }
  return buf;
}

/** Convolution reverb with wet/dry. Use dry: 0 for a send bus. */
export function createReverb(ctx, { wet = 0.35, dry = 1, ...ir } = {}) {
  const input = ctx.createGain(), output = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = impulseResponse(ctx, ir);
  const w = ctx.createGain(), dr = ctx.createGain();
  w.gain.value = wet; dr.gain.value = dry;
  input.connect(conv).connect(w).connect(output);
  input.connect(dr).connect(output);
  return { input, output, convolver: conv, wet: w, dry: dr };
}

/** 4-line feedback delay network (Householder mixing, damped loop), stereo out. */
export function createFDN(ctx, { size = 1, feedback = 0.8, damping = 5000, wet = 0.3, dry = 1 } = {}) {
  const input = ctx.createGain(), output = ctx.createGain();
  const times = [0.0297, 0.0371, 0.0411, 0.0533].map((x) => x * size * 1.6);
  const mixBus = ctx.createGain(); mixBus.gain.value = -0.5; // Householder: x - 0.5 * sum(x)
  const merger = ctx.createChannelMerger(2);
  const lines = times.map((dt, i) => {
    const inG = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = dt;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = damping; lp.Q.value = 0.5;
    const fb = ctx.createGain(); fb.gain.value = feedback;
    input.connect(inG);
    inG.connect(delay).connect(lp).connect(fb);
    fb.connect(inG);       // identity part
    fb.connect(mixBus);    // to the shared sum
    lp.connect(merger, 0, i % 2);
    return { inG };
  });
  for (const l of lines) mixBus.connect(l.inG);
  const w = ctx.createGain(), dr = ctx.createGain();
  w.gain.value = wet; dr.gain.value = dry;
  merger.connect(w).connect(output);
  input.connect(dr).connect(output);
  return { input, output, wet: w, dry: dr };
}

/** Detuned multi-oscillator pad through a (sweeping) lowpass. */
export function pad(ctx, dest, {
  notes = ['D3'], start = 0, dur = 4, voices = 3, detune = 9, type = 'sawtooth',
  cutoff = 900, cutoffEnd, q = 0.6, attack = 2, release = 3, gain = 0.12, pan = 0, spread = 0.6, seed = 'pad',
} = {}) {
  const rng = createRng(seed);
  const end = start + dur;
  notes.forEach((n, ni) => {
    const f = hz(n);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = q;
    filt.frequency.setValueAtTime(cutoff, start);
    if (cutoffEnd !== undefined) filt.frequency.exponentialRampToValueAtTime(Math.max(20, cutoffEnd), end);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const relEnd = adsr(amp.gain, start, dur, { a: attack, d: 0.5, s: 1, r: release, peak: gain / Math.sqrt(notes.length * voices) });
    const p = panner(ctx, pan + (notes.length > 1 ? (ni / (notes.length - 1) - 0.5) * spread : 0));
    for (let v = 0; v < voices; v++) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = voices > 1 ? (v / (voices - 1) - 0.5) * 2 * detune : 0;
      o.connect(filt);
      const jitter = rng() * 0.03; // decorrelate phases
      o.start(start + jitter);
      o.stop(relEnd + 0.1);
    }
    filt.connect(amp).connect(p).connect(dest);
  });
  return end + release;
}

/** Two-operator FM bell with a slightly inharmonic second partial. */
export function bell(ctx, dest, {
  freq, note, start = 0, dur = 5, ratio = 3.5, index = 2.2, decay = 2.5, gain = 0.15, pan = 0, attack = 0.003,
} = {}) {
  const f = freq ?? hz(note ?? 'A4');
  const out = ctx.createGain(); out.gain.value = 0;
  out.gain.setValueAtTime(0, start);
  out.gain.linearRampToValueAtTime(gain, start + attack);
  out.gain.setTargetAtTime(0, start + attack, decay / 4);
  const p = panner(ctx, pan);
  out.connect(p).connect(dest);
  const partial = (mult, level, idx) => {
    const car = ctx.createOscillator(); car.frequency.value = f * mult;
    const mod = ctx.createOscillator(); mod.frequency.value = f * mult * ratio;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(idx * f * mult * ratio, start);
    depth.gain.setTargetAtTime(0, start, decay / 6); // timbre darkens as it rings
    mod.connect(depth).connect(car.frequency);
    const lvl = ctx.createGain(); lvl.gain.value = level;
    car.connect(lvl).connect(out);
    car.start(start); mod.start(start);
    car.stop(start + dur); mod.stop(start + dur);
  };
  partial(1, 1, index);
  partial(2.76, 0.25, index * 0.5);
  partial(5.4, 0.08, index * 0.3);
  return start + dur;
}

/** Wind: pink noise through a wandering band-pass with gusty amplitude and slow stereo drift. */
export function wind(ctx, dest, {
  start = 0, dur = 10, seed = 'wind', gain = 0.12, cutoff = 600, q = 1.2, gust = 0.6, gustRate = 0.15,
} = {}) {
  const src = noiseSource(ctx, { start, dur, color: 'pink', seed });
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = q;
  const n = Math.max(8, Math.ceil(dur * 8));
  const cycles = Math.max(1, dur * gustRate);
  bp.frequency.setValueCurveAtTime(smoothCurve(seed + ':f', n, { min: cutoff / (1 + gust), max: cutoff * (1 + gust * 1.5), rate: cycles }), start, dur);
  const amp = ctx.createGain();
  const env = smoothCurve(seed + ':a', n, { min: gain * (1 - gust * 0.8), max: gain, rate: cycles * 1.3 });
  const fade = Math.min(1.5, dur / 4);
  for (let i = 0; i < n; i++) {
    const tt = (i / (n - 1)) * dur;
    env[i] *= Math.min(1, tt / fade, (dur - tt) / fade);
  }
  amp.gain.setValueCurveAtTime(env, start, dur);
  const p = ctx.createStereoPanner();
  p.pan.setValueCurveAtTime(smoothCurve(seed + ':p', n, { min: -0.6, max: 0.6, rate: cycles * 0.5 }), start, dur);
  src.connect(bp).connect(amp).connect(p).connect(dest);
  return start + dur;
}

/** Water: low brown-noise bed plus seeded drips (short pitched blips). */
export function water(ctx, dest, { start = 0, dur = 10, seed = 'water', gain = 0.1, drips = 1.5, cutoff = 500 } = {}) {
  const rng = createRng(seed);
  const src = noiseSource(ctx, { start, dur, color: 'brown', seed });
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = cutoff;
  const amp = ctx.createGain();
  const n = Math.max(8, Math.ceil(dur * 4));
  const env = smoothCurve(seed + ':a', n, { min: gain * 0.5, max: gain, rate: dur * 0.2 });
  const fade = Math.min(1.5, dur / 4);
  for (let i = 0; i < n; i++) {
    const tt = (i / (n - 1)) * dur;
    env[i] *= Math.min(1, tt / fade, (dur - tt) / fade);
  }
  amp.gain.setValueCurveAtTime(env, start, dur);
  src.connect(lp).connect(amp).connect(dest);
  const count = Math.floor(dur * drips);
  for (let k = 0; k < count; k++) {
    const t0 = start + rng() * dur;
    const o = ctx.createOscillator();
    const f0 = 700 + rng() * 1300;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.8, t0 + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * (0.15 + rng() * 0.35), t0 + 0.002);
    g.gain.setTargetAtTime(0, t0 + 0.002, 0.012);
    const p = panner(ctx, rng() * 1.6 - 0.8);
    o.connect(g).connect(p).connect(dest);
    o.start(t0); o.stop(t0 + 0.12);
  }
  return start + dur;
}

/** Master bus: gentle glue compressor + fast limiter-like compressor -> destination. */
export function masterBus(ctx, { gain = 0.9 } = {}) {
  const input = ctx.createGain();
  input.gain.value = gain;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 12; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.3;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
  input.connect(glue).connect(lim).connect(ctx.destination);
  return { input, glue, limiter: lim };
}
