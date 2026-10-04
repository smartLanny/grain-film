// Named, lazily generated sound assets (plain Float32Array channels, shared by every stem):
// seeded noise loops, the impulse responses of the film's two rooms, granular textures, one-shots,
// and (through `make`) every voice that voices.js computes for the score.

import * as D from './dsp.js';
import * as V from './voices.js';

function noiseLoop(make, sr, seed, rms) {
  const n = Math.round(11.3 * sr), fade = Math.round(0.3 * sr);
  const chs = [0, 1].map((c) => D.loopable(make(n + fade, `${seed}:${c}`), fade));
  let s = 0, cnt = 0;
  for (const a of chs) for (let i = 0; i < a.length; i++) { s += a[i] * a[i]; cnt++; }
  const k = rms / Math.sqrt(s / cnt);
  for (const a of chs) for (let i = 0; i < a.length; i++) a[i] *= k;
  return chs;
}
/** Sum two stereo textures of equal length. */
const mix = (a, b, kb = 1) => a.map((ch, c) => { const o = Float32Array.from(ch); for (let i = 0; i < o.length; i++) o[i] += b[c][i] * kb; return o; });

const RECIPES = {
  white: (sr) => noiseLoop(D.white, sr, 'white', 0.25),
  pink: (sr) => noiseLoop(D.pink, sr, 'pink', 0.25),
  brown: (sr) => noiseLoop(D.brown, sr, 'brown', 0.25),

  // "Concrete": the ink world. 0.9 s, dark: a small hard room whose highs are gone in a quarter of a
  // second, with a dense cluster of early reflections (the walls are close, and soft-edged).
  'ir:room': (sr) => D.calibrateIR(D.makeIR(sr, {
    seconds: 1.15, predelay: 0.006, buildup: 0.008, seed: 'concrete',
    bands: [[190, 0.95, 0.9], [420, 0.9, 1.0], [1000, 0.75, 0.85], [2400, 0.48, 0.45], [5200, 0.28, 0.16], [9000, 0.16, 0.05]],
    early: { count: 18, span: 0.045, gain: 0.2 }, earlyLp: 5000, cross: 0.5, crossDelay: 0.004,
  }), sr),
  // "Open air": the colour world. 3.2 s, wide and clear, but the air takes the highs first: above
  // 4 kHz the tail dies in half the time of the mids, so it darkens as it decays. Almost no early
  // reflections (nothing is near), and two soft, far answers.
  'ir:air': (sr) => D.calibrateIR(D.makeIR(sr, {
    seconds: 3.7, predelay: 0.034, buildup: 0.06, seed: 'openair',
    bands: [[190, 2.2, 0.55], [420, 2.9, 0.85], [1000, 3.2, 1.0], [2400, 2.8, 0.9], [5200, 1.6, 0.62], [9000, 1.3, 0.45]],
    early: { count: 5, span: 0.09, gain: 0.06 }, earlyLp: 4500, cross: 0.8,
    echoes: [{ t: 0.19, gain: 0.07, blur: 0.02, lp: 3600, skew: 0.04 }, { t: 0.41, gain: 0.05, blur: 0.03, lp: 2600, skew: -0.05 }],
  }), sr),

  // rain, at the human scale, on three surfaces (none of it needs much above 6-7 kHz)
  rain: (sr) => D.grains(sr, { seconds: 8, rate: 340, fc: [1500, 6500], bw: 2.0, tau: [0.0008, 0.0035], ampPow: 2.5, seed: 'rain', norm: 0.1 }),                    // open street
  rainGlass: (sr) => D.grains(sr, { seconds: 9, rate: 42, fc: [2000, 6000], bw: 1.5, tau: [0.0006, 0.0022], ampPow: 3, seed: 'rainglass', norm: 0.5, normMode: 'peak' }),   // taps on a window pane
  rainUmbrella: (sr) => mix(                                                                                                                                 // drumming on taut cloth
    D.grains(sr, { seconds: 9, rate: 420, fc: [900, 4800], bw: 1.8, tau: [0.0012, 0.004], ampPow: 2.5, seed: 'umbhi', norm: 0.1 }),
    D.grains(sr, { seconds: 9, rate: 70, fc: [320, 900], bw: 1.5, tau: [0.006, 0.013], ampPow: 2, seed: 'umblo', norm: 0.1 }), 0.8),
  drips: (sr) => D.bubbles(sr, { seconds: 9, rate: 2.2, fLo: 900, fHi: 3200, tau: [0.006, 0.02], seed: 'drips', norm: 0.5 }),
  stream: (sr) => D.bubbles(sr, { seconds: 9, rate: 260, fLo: 380, fHi: 6500, tau: [0.003, 0.014], seed: 'stream', norm: 0.1, skew: 0.8 }),
  // leaves and grass: a dense rustle of tiny broadband taps
  leaves: (sr) => D.grains(sr, { seconds: 9, rate: 900, fc: [1400, 5200], bw: 1.5, tau: [0.0012, 0.006], ampPow: 3, seed: 'leaves', norm: 0.1 }),
  // thousands of feet on wet asphalt: soft low taps and scuffs
  feet: (sr) => mix(
    D.grains(sr, { seconds: 9, rate: 110, fc: [220, 700], bw: 1.7, tau: [0.008, 0.02], ampPow: 2, seed: 'feetlo', norm: 0.1 }),
    D.grains(sr, { seconds: 9, rate: 60, fc: [1400, 4200], bw: 1.8, tau: [0.006, 0.02], ampPow: 2.5, seed: 'feethi', norm: 0.1 }), 0.35),
  // wet paper: the fizz of water entering fibre
  fizz: (sr) => D.grains(sr, { seconds: 8, rate: 520, fc: [2400, 7000], bw: 1.5, tau: [0.0003, 0.0012], ampPow: 3, seed: 'fizz', norm: 0.1 }),
  // scale dust in lamplight: a fine, continuous sparkle
  glitter: (sr) => D.pings(sr, { seconds: 9, rate: 38, f: [2800, 7000], tau: [0.003, 0.012], seed: 'glitter', norm: 0.5 }),

  // one-shots
  husk: (sr) => {
    // 纸壳只留下稀疏的干噪声裂纹，不复用冰裂的下行扫频。
    const a = D.white(Math.round(0.18 * sr), 'husk-paper');
    D.filt(a, D.biquad('hp', 700, 0.6, sr));
    D.filt(a, D.biquad('lp', 4200, 0.6, sr));
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      let env = 0;
      for (const [start, gain, tau] of [[0, 1, 0.014], [0.038, 0.26, 0.012], [0.071, 0.1, 0.008]]) {
        const dt = t - start;
        if (dt >= 0) env += gain * (1 - Math.exp(-dt / 0.0009)) * Math.exp(-dt / tau);
      }
      a[i] *= env;
    }
    return D.normalize([a], 'peak', 0.65);
  },
  thunder: (sr) => D.thunder(sr, { seconds: 10, seed: 'thunder' }),
  scatter: (sr) => V.scatter(sr, { seconds: 4.5, count: 9500, seed: 'scales' }),
  splash: (sr) => V.splash(sr, { seed: 'dew' }),
  grassStep0: (sr) => V.grassStep(sr, { seed: 'g0' }),
  grassStep1: (sr) => V.grassStep(sr, { seed: 'g1' }),
  grassStep2: (sr) => V.grassStep(sr, { seed: 'g2' }),
  grassStep3: (sr) => V.grassStep(sr, { seed: 'g3' }),
};

export function createAssets(sr) {
  const cache = new Map();
  return {
    get(name) {
      if (!cache.has(name)) {
        const make = RECIPES[name];
        if (!make) throw new Error(`unknown audio asset "${name}"`);
        cache.set(name, make(sr));
      }
      return cache.get(name);
    },
    /** A voice computed for the score: generated once, by whichever stem asks first. */
    make(key, fn) {
      if (!cache.has(key)) cache.set(key, fn());
      return cache.get(key);
    },
  };
}
