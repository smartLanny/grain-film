// Title cards (drawn to a 2D canvas, uploaded as a texture and composited INSIDE the post chain, so
// they are captured offline and receive film grain), plus sampleTextPoints() for diegetic text made
// of particles / stars / light.
//
// Card schema (data lives in src/cards.js):
// {
//   id: 'card-id', start: 12.0, end: 18.0,               // film seconds (visible span incl. fades)
//   zh: '中文', en: 'English',                            // shorthand -> two lines, Chinese above English
//   lines: [ { text, lang: 'zh'|'zh-sans'|'en'|'en-sans', size: 56 (px @1080p), tracking: 0.3 (em),
//              weight: 400, italic: false, color: '#efe9df', opacity: 1, font: 'custom stack',
//              gap: 22 (px below this line), case: 'upper' } ],  // explicit lines win over zh/en
//   position: 'center' | 'upper' | 'lower' | 'upperLeft' | 'upperRight' | 'lowerLeft' | 'lowerRight'
//             | [x, y]  (0..1 within the picture area, y down),
//   frame: 'picture' (default, inside the letterbox matte) | 'full' (whole frame for [x, y]); with no
//          matte (this film: 2:1, letterbox 0) the two are the same: fractions of the full 2160x1080 frame,
//   align: 'center' | 'left' | 'right',
//   fadeIn: 1.4, fadeOut: 1.6,     // seconds
//   blurIn: 10, blurOut: 6,        // px @1080p at the start of the fade-in / end of the fade-out
//   rise: 8,                       // px @1080p of upward drift across the whole card
//   stagger: 0.35,                 // s between successive lines on the way in (reversed on the way out)
//   easeIn: 'outCubic', easeOut: 'inOutSine',
//   shadow: 0.3,                   // soft dark halo behind the glyphs for legibility (0..1 -> black at 55% x shadow)
//   shadowBlur: 12,                // px @1080p (default 0.6 x the line size)
//   opacity: 1,
//   riseIn: 6,                     // px @1080p: the card starts this far low and rises to rest across its fade-in
//   layer: 'picture' | 'paper',    // 'picture' (default): over the mixed picture, before grain.
//                                  // 'paper': SOAKED into each shot before its INK pass (src/post.js):
//                                  // the glyphs grow outward from their stroke centres through the
//                                  // paper's fibre over fadeIn (darkest first), and leave by lightening
//                                  // evenly over fadeOut. Colour, blur, shadow, rise and stagger do not
//                                  // apply on paper: it is ink (#0D0C0E) or, with mode 'resist', bare paper
//   mode: 'ink' | 'resist',        // paper cards: 'resist' = the wash draws back from the strokes (T1) and
//                                  // floods back over them across fadeOut
//   anchor: [x, y],                // paper cards: the shot's ink.paperScroll at which the card sits at
//                                  // `position`; it then scrolls with the paper. May be (t) => [x, y]
// }

import * as THREE from 'three';
import { ease, saturate } from './lib/easing.js';
import { createRng } from './lib/random.js';
import { REF_HEIGHT } from './config.js';

export const FONT_STACKS = {
  zh: '"Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "SimSun", serif',
  'zh-sans': '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  en: '"Cormorant Garamond", "Cormorant", "EB Garamond", "Hoefler Text", "Baskerville", "Garamond", "Times New Roman", Georgia, serif',
  'en-sans': '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif',
};

const LINE_DEFAULTS = {
  zh: { size: 54, tracking: 0.32, weight: 400, lineHeight: 1.2 },
  'zh-sans': { size: 48, tracking: 0.28, weight: 300, lineHeight: 1.2 },
  en: { size: 25, tracking: 0.36, weight: 400, lineHeight: 1.25, case: 'upper' },
  'en-sans': { size: 20, tracking: 0.4, weight: 400, lineHeight: 1.25, case: 'upper' },
};

const CARD_DEFAULTS = {
  position: 'center', frame: 'picture', align: 'center',
  fadeIn: 1.4, fadeOut: 1.6, blurIn: 10, blurOut: 6, rise: 8, stagger: 0.35,
  easeIn: 'outCubic', easeOut: 'inOutSine', shadow: 0.3, opacity: 1,
};

const POSITIONS = {
  center: [0.5, 0.5], upper: [0.5, 0.2], lower: [0.5, 0.8],
  upperLeft: [0.1, 0.18], upperRight: [0.9, 0.18], lowerLeft: [0.1, 0.82], lowerRight: [0.9, 0.82],
};

/** Normalise a card: fill defaults, expand zh/en shorthand into lines. */
export function normalizeCard(card) {
  const c = { ...CARD_DEFAULTS, ...card };
  let lines = card.lines;
  if (!lines) {
    lines = [];
    if (card.zh) lines.push({ text: card.zh, lang: 'zh' });
    if (card.en) lines.push({ text: card.en, lang: 'en', gapAbove: 0 });
  }
  c.lines = lines.map((l, i) => {
    const lang = l.lang || 'en';
    const d = LINE_DEFAULTS[lang] || LINE_DEFAULTS.en;
    const line = { color: '#efe9df', opacity: 1, italic: false, ...d, ...l, lang };
    if (line.gap === undefined) line.gap = i < lines.length - 1 ? Math.round(line.size * 0.55) : 0;
    return line;
  });
  if (c.align === 'center' && Array.isArray(c.position) === false && /Left$/.test(c.position)) c.align = 'left';
  if (c.align === 'center' && Array.isArray(c.position) === false && /Right$/.test(c.position)) c.align = 'right';
  return c;
}

function fontString(line, scale) {
  const stack = line.font || FONT_STACKS[line.lang] || FONT_STACKS.en;
  return `${line.italic ? 'italic ' : ''}${line.weight} ${(line.size * scale).toFixed(2)}px ${stack}`;
}
function lineText(line) {
  return line.case === 'upper' ? line.text.toUpperCase() : line.case === 'lower' ? line.text.toLowerCase() : line.text;
}

/** Per-line animation state of a card at time t: [{alpha, blur, dy}] (pure function). */
export function cardState(card, t) {
  const n = card.lines.length;
  const dur = card.end - card.start;
  const out = [];
  for (let i = 0; i < n; i++) {
    const inStart = card.start + i * card.stagger;
    const outEnd = card.end - (n - 1 - i) * card.stagger * 0.6;
    const kIn = ease(card.easeIn, (t - inStart) / Math.max(card.fadeIn, 1e-3));
    const kOut = ease(card.easeOut, (outEnd - t) / Math.max(card.fadeOut, 1e-3));
    const alpha = Math.min(kIn, kOut) * card.opacity;
    const blur = (t - inStart < card.fadeIn ? (1 - kIn) * card.blurIn : 0) + (outEnd - t < card.fadeOut ? (1 - kOut) * card.blurOut : 0);
    const dy = -card.rise * ((t - card.start) / dur - 0.5) + (card.riseIn || 0) * (1 - kIn);
    out.push({ alpha: saturate(alpha), blur, dy });
  }
  return out;
}

export class TitleLayer {
  /**
   * @param {number} width  frame width in px
   * @param {number} height frame height in px
   * @param {object[]} cards
   * @param {{soak?: boolean}} [o] soak: this layer holds the cards on paper. Its canvas is not a
   *        picture but data for the look pass's soak (src/post.js CARD_FRAG): alpha = glyph coverage
   *        (always whole), rgb = (soak clock: 0 -> 0.5 across fadeIn, -> 1 while the wet edge dries;
   *        keep: 1 -> 0 across fadeOut; mode: 0 ink, 1 resist).
   */
  constructor(width, height, cards, { soak = false } = {}) {
    this.soak = soak;
    /** After update(): { anchor: [x, y] | null } of the active paper cards (see card.anchor). */
    this.info = { anchor: null };
    this.width = width;
    this.height = height;
    this.scale = height / REF_HEIGHT;
    this.cards = (cards || []).map(normalizeCard).sort((a, b) => a.start - b.start);
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.premultiplyAlpha = true;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this._sig = '';
    this._empty = true;
  }

  /** Cards overlapping time t. */
  activeAt(t) {
    return this.cards.filter((c) => t >= c.start && t < c.end);
  }

  /**
   * Redraw if needed for time t. Returns the texture when anything is visible, else null.
   * @param {number} t film time
   * @param {number} picFrac picture height / frame height (1 with no letterbox matte), positions are relative to it
   */
  update(t, picFrac = 1) {
    const active = this.activeAt(t);
    if (!active.length) {
      this.info = { anchor: null };
      if (!this._empty) {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.texture.needsUpdate = true;
        this._empty = true;
        this._sig = '';
      }
      return null;
    }
    if (this.soak) return this._updateSoak(active, t, picFrac);
    const states = active.map((c) => cardState(c, t));
    const sig = active.map((c, i) => c.id + ':' + states[i].map((s) => `${s.alpha.toFixed(3)},${s.blur.toFixed(2)},${s.dy.toFixed(2)}`).join('/')).join('|') + '@' + picFrac.toFixed(4);
    if (sig !== this._sig) {
      this._draw(active, states, picFrac);
      this._sig = sig;
      this._empty = false;
      this.texture.needsUpdate = true;
    }
    return states.some((s) => s.some((l) => l.alpha > 0.001)) ? this.texture : null;
  }

  /** Cards on paper: draw the soak data (see the constructor). */
  _updateSoak(active, t, picFrac) {
    const q = (x) => Math.round(saturate(x) * 255);
    const states = active.map((c) => {
      const clock = q((t - c.start) / Math.max(2 * c.fadeIn, 1e-3)), keep = q(ease(c.easeOut, (c.end - t) / Math.max(c.fadeOut, 1e-3)));
      const fill = `rgb(${clock},${keep},${c.mode === 'resist' ? 255 : 0})`;
      return c.lines.map(() => ({ alpha: clock > 0 && keep > 0 ? 1 : 0, blur: 0, dy: 0, fill }));
    });
    const sig = active.map((c, i) => c.id + ':' + states[i][0].fill + states[i][0].alpha).join('|') + '@' + picFrac.toFixed(4);
    if (sig !== this._sig) {
      this._draw(active, states, picFrac);
      this._sig = sig;
      this._empty = false;
      this.texture.needsUpdate = true;
    }
    const anchored = active.find((c) => c.anchor);
    this.info = { anchor: anchored ? (typeof anchored.anchor === 'function' ? anchored.anchor(t) : anchored.anchor) : null };
    return states.some((s) => s[0].alpha > 0) ? this.texture : null;
  }

  _draw(cards, states, picFrac) {
    const ctx = this.ctx, W = this.width, H = this.height, S = this.scale;
    ctx.clearRect(0, 0, W, H);
    const picH = H * picFrac, picTop = (H - picH) / 2;
    cards.forEach((card, ci) => {
      // layout
      const metrics = card.lines.map((l) => {
        ctx.font = fontString(l, S);
        ctx.letterSpacing = `${(l.tracking * l.size * S).toFixed(2)}px`;
        const text = lineText(l);
        const m = ctx.measureText(text);
        const spacing = l.tracking * l.size * S;
        return { text, width: m.width - spacing, spacing, lh: l.size * S * l.lineHeight };
      });
      const blockH = metrics.reduce((s, m, i) => s + m.lh + (i < metrics.length - 1 ? card.lines[i].gap * S : 0), 0);
      let [px, py] = Array.isArray(card.position) ? card.position : POSITIONS[card.position] || POSITIONS.center;
      let x, yTop;
      if (card.frame === 'full') { x = px * W; yTop = py * H - blockH / 2; }
      else { x = px * W; yTop = picTop + py * picH - blockH / 2; }

      let y = yTop;
      card.lines.forEach((l, li) => {
        const st = states[ci][li];
        const m = metrics[li];
        if (st.alpha > 0.001) {
          ctx.save();
          ctx.font = fontString(l, S);
          ctx.letterSpacing = `${m.spacing.toFixed(2)}px`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          let lx = x;
          if (card.align === 'center') lx = x - m.width / 2;
          else if (card.align === 'right') lx = x - m.width;
          const ly = y + m.lh / 2 + st.dy * S;
          ctx.globalAlpha = st.alpha * l.opacity;
          ctx.filter = st.blur * S > 0.05 ? `blur(${(st.blur * S).toFixed(2)}px)` : 'none';
          if (card.shadow > 0 && !st.fill) {
            ctx.shadowColor = `rgba(0,0,0,${(0.55 * card.shadow).toFixed(3)})`;
            ctx.shadowBlur = (card.shadowBlur ?? l.size * 0.6) * S;
          }
          ctx.fillStyle = st.fill || l.color;
          if (st.fill) ctx.globalAlpha = 1;
          ctx.fillText(m.text, lx, ly);
          ctx.restore();
        }
        y += m.lh + (li < card.lines.length - 1 ? l.gap * S : 0);
      });
    });
  }

  dispose() { this.texture.dispose(); }
}

// ---------------------------------------------------------------------------------------------
/**
 * Rasterise text and return 2D sample points – for building text out of particles, stars, light.
 *
 *   const { points, count, width, height } = sampleTextPoints('光', { lang: 'zh', step: 3 });
 *   // points: Float32Array [x0,y0, x1,y1, ...] centred on the origin, y up, in "em" units of the
 *   // first line's size (so the first line is ~1 unit tall). Multiply by your world scale.
 *
 * @param {string|object[]} text  a string ('\n' for new lines) or line objects like card lines
 * @param {object} o
 *   lang ('en'), font (stack), size (raster px per em, 160), weight, italic, tracking (em),
 *   step (grid spacing in raster px, 3), threshold (alpha 0..1, 0.5), jitter (0..1 of step, 0.5),
 *   seed, maxPoints (0 = all; deterministic subsample), lineGap (em, 0.35), align ('center')
 * @returns {{points: Float32Array, weights: Float32Array, count: number, width: number, height: number}}
 */
export function sampleTextPoints(text, o = {}) {
  const size = o.size ?? 160;
  const step = Math.max(1, o.step ?? 3);
  const threshold = (o.threshold ?? 0.5) * 255;
  const jitter = o.jitter ?? 0.5;
  const rng = createRng(o.seed ?? 'text-points');
  const lines = (Array.isArray(text) ? text : String(text).split('\n').map((s) => ({ text: s })))
    .map((l) => ({ lang: o.lang || 'en', weight: o.weight ?? 400, italic: !!o.italic, tracking: o.tracking ?? 0, font: o.font, ...l, size: l.size ?? size }));
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const measure = lines.map((l) => {
    ctx.font = fontString(l, 1);
    ctx.letterSpacing = `${l.tracking * l.size}px`;
    const m = ctx.measureText(l.text);
    return { w: Math.ceil(m.width - l.tracking * l.size), h: Math.ceil(l.size * 1.25) };
  });
  const gap = (o.lineGap ?? 0.35) * size;
  const pad = Math.ceil(size * 0.25);
  const W = Math.max(...measure.map((m) => m.w)) + pad * 2;
  const H = measure.reduce((s, m) => s + m.h, 0) + gap * (lines.length - 1) + pad * 2;
  c.width = W; c.height = Math.ceil(H);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  let y = pad;
  lines.forEach((l, i) => {
    ctx.font = fontString(l, 1);
    ctx.letterSpacing = `${l.tracking * l.size}px`;
    const m = measure[i];
    const x = o.align === 'left' ? pad : o.align === 'right' ? W - pad - m.w : (W - m.w) / 2;
    ctx.fillText(l.text, x, y + m.h / 2);
    y += m.h + gap;
  });
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const pts = [], wts = [];
  for (let py = 0; py < c.height; py += step) {
    for (let px = 0; px < c.width; px += step) {
      const a = data[(py * c.width + px) * 4 + 3];
      if (a >= threshold) {
        const jx = (rng() - 0.5) * jitter * step, jy = (rng() - 0.5) * jitter * step;
        pts.push((px + jx - c.width / 2) / size, -(py + jy - c.height / 2) / size);
        wts.push(a / 255);
      }
    }
  }
  let count = wts.length;
  let points = new Float32Array(pts), weights = new Float32Array(wts);
  if (o.maxPoints && count > o.maxPoints) {
    const idx = rng.shuffle([...Array(count).keys()]).slice(0, o.maxPoints).sort((a, b) => a - b);
    points = new Float32Array(idx.length * 2);
    weights = new Float32Array(idx.length);
    idx.forEach((k, i) => { points[i * 2] = pts[k * 2]; points[i * 2 + 1] = pts[k * 2 + 1]; weights[i] = wts[k]; });
    count = idx.length;
  }
  return { points, weights, count, width: c.width / size, height: c.height / size };
}

/**
 * Resample 2D text points to exactly `count` vec3 positions (for an instanced particle attribute).
 * Extra particles reuse points (with a tiny deterministic offset); fewer particles subsample.
 * @returns {Float32Array} length count*3
 */
export function fitPointsToCount(sample, count, { scale = 1, z = 0, offset = [0, 0, 0], seed = 'fit', spread = 0.004 } = {}) {
  const rng = createRng(seed);
  const out = new Float32Array(count * 3);
  const n = sample.count;
  if (!n) return out;
  const order = rng.shuffle([...Array(n).keys()]);
  for (let i = 0; i < count; i++) {
    const k = order[i % n];
    const extra = i >= n ? spread : 0;
    out[i * 3] = (sample.points[k * 2] + (rng() - 0.5) * extra) * scale + offset[0];
    out[i * 3 + 1] = (sample.points[k * 2 + 1] + (rng() - 0.5) * extra) * scale + offset[1];
    out[i * 3 + 2] = z + offset[2];
  }
  return out;
}
