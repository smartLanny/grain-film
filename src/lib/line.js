// LINE — the film's one branching curve: a meandering main stem with side branches that grows
// from nothing (growth 0) to its full extent (growth 1). The same generator draws the crack in the
// ice, the course of the river, the roots, and the branch skeleton of the tree (docs/story.md 3.0):
// "a line of light crossing darkness".
//
// Everything is a pure function of the options (seeded hashing only), and every shape parameter
// is continuous: changing `phase`, `meander` or `to` by a little moves the curve by a little, so a
// LINE can be re-generated every frame to animate it (the river's meanders migrate by advancing
// `phase` with the story year).
//
//   import { createLine } from '../lib/line.js';
//   const line = createLine({
//     seed: 'river', from: [0, 128], to: [0.5, -14],     // 2D end points of the stem (any units)
//     meander: 0.05, wavelength: 0.2, phase: year / 900,  // lateral swing (fractions of stem length)
//     branches: 5, branchAngle: 16, branchLength: 0.3,    // side branches
//   });
//   line.stem                      // Curve: the main stem
//   line.branches                  // Curve[]: every side branch (all levels, flattened)
//   line.curves                    // [stem, ...branches]
//   line.reveal(curve, growth)     // 0..1: how much of that curve is drawn at `growth`
//   line.tip(growth)               // [x, y] of the stem's growing tip
//   line.segments(growth)          // Float32Array [x0,y0,x1,y1,w0,w1, ...] of everything visible
//
// Curve:
//   curve.points   Float32Array [x0,y0, x1,y1, ...]   curve.n       number of points
//   curve.length   arc length                         curve.level   0 = stem, 1 = branch, 2 = twig …
//   curve.parent   parent Curve or null               curve.rootS   where it leaves its parent (0..1)
//   curve.start / curve.end   growth interval over which the curve draws itself
//   curve.at(s)        [x, y] at arc fraction s (0..1)
//   curve.tangent(s)   unit tangent [tx, ty]
//   curve.width(s)     relative width: 1 at the root of the stem, tapering to `taper` at tips
//
// To use a LINE in 3D, map its 2D points onto your own plane or surface (the river maps
// (x, y) -> (lateral offset, distance up-valley); a tree can map y -> up and bend x into depth).
//
// Options (all optional except seed/from/to in practice):
//   seed          string | int     everything random derives from it
//   from, to      [x, y]           stem end points (default [0,0] -> [0,1])
//   segments      int              points per curve (default 96; branches scale down, min 12)
//   meander       number           lateral amplitude of the big swings, as a fraction of the
//                                  curve's own chord length (default 0.08)
//   wavelength    number           length of one swing as a fraction of the chord (default 0.3)
//   octaves       int              number of superposed swings (default 3); each is ~1.7x finer
//   roughness     number           amplitude ratio between successive swings (default 0.5)
//   jitter        number           fine angular noise: 0 = smooth river, 0.02 = cracked ice (default 0)
//   phase         number           shifts every swing along the curve, in cycles of the largest
//                                  swing; animate it to make the meanders migrate (default 0)
//   pin           [a, b]           fraction of the curve over which the swing fades in at the
//                                  start / out at the end, so the ends stay put (default [0.08, 0.08])
//   branches      int              first-level branches on the stem (default 5)
//   levels        int              branch generations (default 1; 2 gives twigs on branches …)
//   branchDecay   number           how many fewer branches each generation has (default 0.6)
//   branchLength  number           branch chord as a fraction of its parent's chord (default 0.35)
//   branchAngle   degrees          angle between a branch and its parent's direction (default 35)
//   angleJitter   degrees          random +- on that angle (default 10)
//   branchSide    'alternate' | 'random' | 'left' | 'right'   (default 'alternate')
//   branchFrom    [a, b]           part of the parent along which branches may root (default [0.12, 0.88])
//   taper         number           relative width at the tip of a curve (default 0.25)
//   stemShare     number           fraction of the growth range the stem needs to draw itself
//                                  (default 0.6); a branch starts when the tip passes its root
//   branchSpeed   number           branch drawing speed relative to the stem (default 1)

import { hashInt, seedOf } from './random.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const rnd = (seed, i) => hashInt((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0) / 4294967296;

/** Smooth 1D value noise in [-1, 1] (seeded). */
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = rnd(seed, i & 0xffff), b = rnd(seed, (i + 1) & 0xffff);
  return (a + (b - a) * u) * 2 - 1;
}

const DEFAULTS = {
  seed: 'line', from: [0, 0], to: [0, 1], segments: 96,
  meander: 0.08, wavelength: 0.3, octaves: 3, roughness: 0.5, jitter: 0, phase: 0, pin: [0.08, 0.08],
  branches: 5, levels: 1, branchDecay: 0.6, branchLength: 0.35, branchAngle: 35, angleJitter: 10,
  branchSide: 'alternate', branchFrom: [0.12, 0.88], taper: 0.25, stemShare: 0.6, branchSpeed: 1,
};

class Curve {
  constructor(points, level, parent, rootS, w0, w1) {
    this.points = points;
    this.n = points.length / 2;
    this.level = level;
    this.parent = parent;
    this.rootS = rootS;
    this.w0 = w0; this.w1 = w1;
    this.start = 0; this.end = 1;
    const cum = new Float32Array(this.n);
    for (let i = 1; i < this.n; i++) {
      cum[i] = cum[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
    }
    this.cum = cum;
    this.length = cum[this.n - 1];
  }
  _locate(s) {
    const target = clamp01(s) * this.length, cum = this.cum;
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo];
    return [lo, seg > 0 ? (target - cum[lo]) / seg : 0];
  }
  /** Position at arc fraction s (0..1). */
  at(s, out = [0, 0]) {
    const [i, f] = this._locate(s), p = this.points;
    out[0] = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * f;
    out[1] = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * f;
    return out;
  }
  /** Unit tangent at arc fraction s. */
  tangent(s, out = [0, 0]) {
    const [i] = this._locate(s), p = this.points;
    const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 2);
    const dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1], l = Math.hypot(dx, dy) || 1;
    out[0] = dx / l; out[1] = dy / l;
    return out;
  }
  /** Relative width at arc fraction s (tapers from root to tip). */
  width(s) { return this.w0 + (this.w1 - this.w0) * clamp01(s); }
}

/** Build one meandering curve from a to b. */
function buildCurve(a, b, o, seed, level, parent, rootS, w0, ampScale) {
  const n = Math.max(12, Math.round(o.segments * (level === 0 ? 1 : Math.pow(0.6, level))));
  const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy) || 1e-9;
  const tx = dx / chord, ty = dy / chord, nx = -ty, ny = tx;
  const pts = new Float32Array(n * 2);
  // seeded swing parameters: frequency ratios near 1, 1.7, 2.9 …, random phases and drift speeds
  const oct = [];
  let norm = 0;
  for (let k = 0; k < o.octaves; k++) {
    const amp = Math.pow(o.roughness, k);
    oct.push({
      f: Math.pow(1.7, k) * (0.85 + 0.3 * rnd(seed, 10 + k)) / Math.max(o.wavelength, 1e-3),
      ph: rnd(seed, 20 + k),
      drift: (k % 2 ? -1 : 1) * (0.7 + 0.6 * rnd(seed, 30 + k)) * Math.pow(1.3, k),
      amp,
    });
    norm += amp;
  }
  const pinA = Math.max(o.pin[0], 1e-4), pinB = Math.max(o.pin[1], 1e-4);
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    let off = 0;
    for (const q of oct) off += q.amp * Math.sin(TAU * (q.f * s + q.ph + o.phase * q.drift));
    off = (off / norm) * o.meander * ampScale;
    if (o.jitter > 0) off += o.jitter * (noise1(s * n * 0.5, seed ^ 0x51ed) + 0.5 * noise1(s * n * 1.3, seed ^ 0x7a3f));
    off *= chord * smooth(s / pinA) * smooth((1 - s) / pinB);
    pts[i * 2] = a[0] + dx * s + nx * off;
    pts[i * 2 + 1] = a[1] + dy * s + ny * off;
  }
  const w1 = w0 * (level === 0 ? o.taper : Math.min(1, o.taper * 1.2));
  return new Curve(pts, level, parent, rootS, w0, w1);
}

/**
 * Create a LINE. See the header for options and the returned interface.
 * @param {Partial<typeof DEFAULTS>} opts
 */
export function createLine(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const seed = seedOf(o.seed);
  const stem = buildCurve(o.from, o.to, o, seed, 0, null, 0, 1, 1);
  const branches = [];

  const grow = (parent, pseed, level, count) => {
    if (level > o.levels || count < 1) return;
    const n = Math.round(count);
    for (let i = 0; i < n; i++) {
      const bs = hashInt((pseed ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0);
      // roots are spread evenly along the parent with a seeded shuffle of their exact position
      const slot = (i + 0.15 + 0.7 * rnd(bs, 1)) / n;
      const rootS = o.branchFrom[0] + (o.branchFrom[1] - o.branchFrom[0]) * slot;
      const root = parent.at(rootS), tan = parent.tangent(rootS);
      let side;
      if (o.branchSide === 'left') side = 1;
      else if (o.branchSide === 'right') side = -1;
      else if (o.branchSide === 'random') side = rnd(bs, 2) < 0.5 ? -1 : 1;
      else side = (i % 2 ? -1 : 1) * (level % 2 ? 1 : -1);
      const ang = ((o.branchAngle + o.angleJitter * (rnd(bs, 3) * 2 - 1)) * Math.PI) / 180 * side;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dir = [tan[0] * ca - tan[1] * sa, tan[0] * sa + tan[1] * ca];
      // branches near the tip of their parent are shorter (so the whole figure tapers)
      const len = parent.length * o.branchLength * (0.7 + 0.5 * rnd(bs, 4)) * (1 - 0.45 * rootS);
      const end = [root[0] + dir[0] * len, root[1] + dir[1] * len];
      const bo = { ...o, pin: [0.02, o.pin[1]] };
      const c = buildCurve(root, end, bo, bs, level, parent, rootS, parent.width(rootS) * 0.7, 1);
      branches.push(c);
      grow(c, bs, level + 1, count * o.branchDecay);
    }
  };
  grow(stem, seed ^ 0x1b873593, 1, o.branches);

  // growth schedule: the stem draws over [0, stemShare]; a branch starts when its parent's tip
  // passes its root and draws at the same speed; everything is rescaled to finish by growth = 1.
  stem.start = 0; stem.end = o.stemShare;
  const rate = stem.length / Math.max(o.stemShare, 1e-6); // length per unit growth
  let last = stem.end;
  for (const c of branches) {
    const p = c.parent;
    c.start = p.start + (p.end - p.start) * c.rootS;
    c.end = c.start + c.length / (rate * o.branchSpeed);
    last = Math.max(last, c.end);
  }
  if (last > 1) {
    // compress only what happens after the stem is complete, so stem timing stays as asked
    const k = (1 - o.stemShare) / (last - o.stemShare);
    const remap = (g) => (g <= o.stemShare ? g : o.stemShare + (g - o.stemShare) * k);
    for (const c of branches) { c.start = remap(c.start); c.end = Math.max(remap(c.end), c.start + 1e-4); }
  }

  const curves = [stem, ...branches];
  const reveal = (curve, growth) => clamp01((growth - curve.start) / Math.max(curve.end - curve.start, 1e-6));

  return {
    stem, branches, curves,
    /** Total length of all curves. */
    length: curves.reduce((s, c) => s + c.length, 0),
    reveal,
    /** Position of the stem's growing tip at `growth`. */
    tip: (growth, out) => stem.at(reveal(stem, growth), out),
    /**
     * Everything visible at `growth` as line segments: [x0, y0, x1, y1, w0, w1] per segment
     * (w = relative width). The last drawn segment of each curve is cut at the growing tip.
     */
    segments(growth = 1) {
      const out = [];
      for (const c of curves) {
        const r = reveal(c, growth);
        if (r <= 0) continue;
        const lim = r * c.length, p = c.points;
        for (let i = 0; i < c.n - 1; i++) {
          if (c.cum[i] >= lim) break;
          let x1 = p[i * 2 + 2], y1 = p[i * 2 + 3], s1 = c.cum[i + 1] / c.length;
          if (c.cum[i + 1] > lim) {
            const f = (lim - c.cum[i]) / (c.cum[i + 1] - c.cum[i]);
            x1 = p[i * 2] + (x1 - p[i * 2]) * f; y1 = p[i * 2 + 1] + (y1 - p[i * 2 + 1]) * f; s1 = r;
          }
          out.push(p[i * 2], p[i * 2 + 1], x1, y1, c.width(c.cum[i] / c.length), c.width(s1));
        }
      }
      return new Float32Array(out);
    },
  };
}
