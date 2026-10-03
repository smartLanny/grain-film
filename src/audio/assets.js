import { shallowWater } from './s08-water.js';
// Named, lazily generated sound assets (plain Float32Array channels, shared by every stem):
// seeded noise loops, the two reverb impulse responses, granular textures and the one-shots.

import * as D from './dsp.js';

function noiseLoop(make, sr, seed, rms) {
  const n = Math.round(11.3 * sr), fade = Math.round(0.3 * sr);
  const chs = [0, 1].map((c) => D.loopable(make(n + fade, `${seed}:${c}`), fade));
  let s = 0, cnt = 0;
  for (const a of chs) for (let i = 0; i < a.length; i++) { s += a[i] * a[i]; cnt++; }
  const k = rms / Math.sqrt(s / cnt);
  for (const a of chs) for (let i = 0; i < a.length; i++) a[i] *= k;
  return chs;
}

const RECIPES = {
  white: (sr) => noiseLoop(D.white, sr, 'white', 0.25),
  pink: (sr) => noiseLoop(D.pink, sr, 'pink', 0.25),
  brown: (sr) => noiseLoop(D.brown, sr, 'brown', 0.25),

  // "Ice hall": 5 s, bright and glassy, the highs ring almost as long as the mids.
  'ir:hall': (sr) => D.makeIR(sr, {
    seconds: 5.6, predelay: 0.028, buildup: 0.04, seed: 'icehall',
    bands: [[170, 4.0, 0.85], [420, 5.2, 1.0], [1000, 5.0, 1.0], [2400, 4.4, 0.95], [5200, 3.4, 0.85], [9000, 2.3, 0.75]],
    early: { count: 16, span: 0.11, gain: 0.14 }, cross: 0.75,
  }),
  // "Valley": 2.2 s, open air: the highs die quickly, and the far walls answer with soft slaps.
  'ir:valley': (sr) => D.makeIR(sr, {
    seconds: 2.7, predelay: 0.04, buildup: 0.07, seed: 'valley',
    bands: [[170, 2.2, 0.8], [420, 2.4, 1.0], [1000, 2.2, 1.0], [2400, 1.7, 0.75], [5200, 1.1, 0.5], [9000, 0.7, 0.3]],
    early: { count: 5, span: 0.07, gain: 0.07 }, cross: 0.6,
    echoes: [{ t: 0.21, gain: 0.15, blur: 0.014, lp: 2800, skew: 0.035 }, { t: 0.37, gain: 0.1, blur: 0.02, lp: 2000, skew: -0.05 }, { t: 0.58, gain: 0.06, blur: 0.03, lp: 1400, skew: 0.04 }],
  }),

  // water
  s08Shallow: shallowWater,
  trickle: (sr) => D.bubbles(sr, { seconds: 9, rate: 26, fLo: 900, fHi: 5200, tau: [0.004, 0.016], seed: 'trickle', norm: 0.07 }),
  stream: (sr) => D.bubbles(sr, { seconds: 9, rate: 260, fLo: 380, fHi: 6500, tau: [0.003, 0.014], seed: 'stream', norm: 0.1, skew: 0.8 }),
  bubLow: (sr) => D.bubbles(sr, { seconds: 9, rate: 34, fLo: 140, fHi: 950, tau: [0.012, 0.05], rise: [1.15, 1.9], seed: 'bublow', norm: 0.1 }),
  rain: (sr) => D.grains(sr, { seconds: 8, rate: 340, fc: [1800, 9000], bw: 2.2, tau: [0.0008, 0.0035], ampPow: 2.5, seed: 'rain', norm: 0.1 }),
  // fire: sparse sharp pops, a wide spread of sizes
  crackle: (sr) => D.grains(sr, { seconds: 8, rate: 48, fc: [700, 5200], bw: 2.5, tau: [0.0008, 0.009], ampPow: 3.5, seed: 'crackle', norm: 0.07 }),
  // frost: fine high ticks
  frost: (sr) => D.grains(sr, { seconds: 8, rate: 70, fc: [5000, 13000], bw: 1.6, tau: [0.0003, 0.0012], ampPow: 3, seed: 'frost', norm: 0.5, normMode: 'peak' }),
  // leaves: a dense rustle of tiny broadband taps
  leaves: (sr) => D.grains(sr, { seconds: 9, rate: 900, fc: [1700, 6500], bw: 1.6, tau: [0.0012, 0.006], ampPow: 3, seed: 'leaves', norm: 0.1 }),
  // seed tufts letting go: soft pops
  pops: (sr) => D.grains(sr, { seconds: 9, rate: 9, fc: [700, 2600], bw: 2, tau: [0.002, 0.007], ampPow: 1.5, seed: 'pops', norm: 0.5, normMode: 'peak' }),
  // crystalline ticks of bubbles near the lens
  ticks: (sr) => D.pings(sr, { seconds: 10, rate: 1.1, f: [5200, 11500], tau: [0.004, 0.02], seed: 'ticks', norm: 0.5 }),

  // one-shots
  crack: (sr) => D.crack(sr, { scale: 1, seed: 'icecrack' }),
  husk: (sr) => D.crack(sr, { scale: 0.12, seed: 'husk' }),
  thunder: (sr) => D.thunder(sr, { seconds: 10, seed: 'thunder' }),
  rock1: (sr) => D.rockfall(sr, { seconds: 3.6, seed: 'rock1', debris: 30 }),
  rock2: (sr) => D.rockfall(sr, { seconds: 3.8, seed: 'rock2', debris: 34 }),
  rock3: (sr) => D.rockfall(sr, { seconds: 4.2, seed: 'rock3', debris: 38 }),
  slab: (sr) => D.rockfall(sr, { seconds: 7, seed: 'slab', debris: 55, crackOnset: true, hiss: 0.8 }),
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
  };
}
