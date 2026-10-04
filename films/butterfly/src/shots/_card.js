// Title-card helpers (SCRIPT.md section 5). Owner: Group A.
// Reused from GRAIN: the two-line card style, and the two-beat technique of GRAIN's C4 (a sentence
// that stays put while its second clause joins on the same line: separate cards for each clause, the
// second placed at the measured advance of the first, so the line is laid out once).
//
// FORMAT: 18:9, 2160x1080, the whole frame is picture (no bars). SCRIPT.md gives card positions as
// pixels in a 1920x1080 frame whose 2.39 picture spans y = 138..942. They are converted ONCE here,
// into fractions of the full frame (x across, y from the TOP), in CARD_LAYOUT:
//   x_frac = x / 1920        y_frac = (y - 138) / 804
// Type sizes stay in px at 1080p (REF_HEIGHT), as the script gives them: same height, same size.
//
// Two ways to put text on screen (see ENGINE.md "Title cards"):
//   overPicture  normal cards: composited over the mixed picture, before grain (L1). #F2EDE4 at 92%,
//                soft shadow (blur 12 px, black 55%).
//   onPaper      card.layer = 'paper': SOAKED into the shot before its INK pass (titles.js soak mode +
//                the card pass in post.js): the glyphs grow outward from their stroke centres through
//                the paper's fibre over fadeIn, darkest first, and leave by lightening evenly over
//                fadeOut; the INK pass then gives them tooth, granulation and a wet edge (L2, E).
//                mode 'resist' = the wash draws back from the strokes and leaves bare paper (T1).
import { PALETTE } from '../lib/story.js';
import { FONT_STACKS } from '../titles.js';
import { WIDTH, HEIGHT, REF_HEIGHT } from '../config.js';

/** The frame in reference pixels (1080p height): 2160 x 1080. */
const FW = (WIDTH * REF_HEIGHT) / HEIGHT, FH = REF_HEIGHT;
/** SCRIPT.md pixel coordinates (1920x1080 frame, picture y 138..942) -> full-frame fractions. */
export const scriptX = (px) => px / 1920;
export const scriptY = (px) => (px - 138) / 804;

/**
 * SCRIPT.md section 5 layout, converted (fractions of the full frame; y from the top).
 * Baselines are alphabetic baselines; `right` is the right edge of a right-aligned block.
 */
export const CARD_LAYOUT = {
  T1: { right: 0.93, top: 0.12, zhSize: 104, zhGap: 18, enSize: 20, enTracking: 0.42, enBelow: 30 },   // CITY draws it (resist)
  L1: { cx: scriptX(960), zhBaseline: scriptY(800), enBaseline: scriptY(842) },                        // 0.5, 0.8234, 0.8756
  L2: { cx: scriptX(1229), zhBaseline: scriptY(520), enBaseline: scriptY(562) },                       // 0.6401, 0.4751, 0.5274
  E: { right: 0.93, titleTop: 0.14, lastBaseline: scriptY(880) },                                      // ..., 0.9229
};

// The alphabetic baseline sits this far (in em) below the middle of the line box, where titles.js
// centres each line (textBaseline 'middle'). Approximate for Songti SC / Hoefler Text; refine by eye.
const BASELINE_EM = { zh: 0.38, 'zh-sans': 0.38, en: 0.228, 'en-sans': 0.30 };   // measured in the render (Songti SC, Hoefler Text)
const LINE_HEIGHT = { zh: 1.2, 'zh-sans': 1.2, en: 1.25, 'en-sans': 1.25 };

/** Advance width (1080p px) of `text` set as a card line (canvas measure; an estimate outside a page). */
export function advance(text, { lang = 'en', size = 22, tracking = 0, weight = 400 } = {}) {
  if (typeof document === 'undefined') return text.length * size * (/^zh/.test(lang) ? 1 + tracking : 0.5 + tracking);
  const ctx = (advance.ctx ||= document.createElement('canvas').getContext('2d'));
  ctx.font = `${weight} ${size}px ${FONT_STACKS[lang] || FONT_STACKS.en}`;
  ctx.letterSpacing = `${(tracking * size).toFixed(3)}px`;
  return ctx.measureText(text).width;
}
/** Width of a set line as titles.js lays it out (the trailing letter-space removed). */
export const lineWidth = (text, l) => advance(text, l) - (l.tracking || 0) * l.size;

/**
 * T1, the title inscription (SCRIPT.md section 5), as reserved paper by resist: for CITY's S01.
 *   export const cards = [...inscriptionT1({ anchor: [sx, sy] })];
 * The night wash draws back from the strokes 5.5 -> 7.0 (outward from the stroke centres, through
 * the fibre noise) and floods back over them 11.0 -> 12.5. `anchor` = the shot's ink.paperScroll at
 * which the block stands at its script position (right-aligned at 93%, top of 梦 at 12%): the
 * inscription then scrolls with the paper. Omit it for a locked frame. The world draws nothing for
 * the title; whatever wash lies behind the strokes is what the resist removes.
 */
export function inscriptionT1({ anchor = null, start = 5.5, end = 12.5, soak = 1.5, flood = 1.5 } = {}) {
  const L = CARD_LAYOUT.T1, lhZh = LINE_HEIGHT.zh, lhEn = LINE_HEIGHT.en;
  // script gaps are between glyph boxes; card gaps are between line boxes
  const gapZh = L.zhGap - (lhZh - 1) * L.zhSize;
  const gapEn = L.enBelow - ((lhZh - 1) * L.zhSize) / 2 - ((lhEn - 1) * L.enSize) / 2;
  const lines = [
    { text: '梦', lang: 'zh', size: L.zhSize, tracking: 0, gap: gapZh },
    { text: '蝶', lang: 'zh', size: L.zhSize, tracking: 0, gap: gapEn },
    { text: 'THE DREAM OF THE BUTTERFLY', lang: 'en', size: L.enSize, tracking: L.enTracking, case: 'upper' },
  ];
  return [{
    id: 'T1', start, end, layer: 'paper', mode: 'resist', anchor, frame: 'full', align: 'right',
    position: [L.right, yFromTop(lines, L.top)], lines,
    fadeIn: soak, fadeOut: flood, easeOut: 'linear', rise: 0, blurIn: 0, blurOut: 0, stagger: 0, shadow: 0,
  }];
}

export const OVER_PICTURE = { line: { color: PALETTE.cardText, opacity: 0.92, case: 'none' }, card: { shadow: 1, shadowBlur: 12 } };
export const ON_PAPER = { line: { color: PALETTE.jiao, opacity: 1, case: 'none' }, card: { shadow: 0, layer: 'paper' } };

const lh = (l) => l.size * (l.lineHeight ?? LINE_HEIGHT[l.lang] ?? 1.25);
const gapOf = (l, i, n) => (i < n - 1 ? (l.gap ?? Math.round(l.size * 0.55)) : 0);
const blockH = (lines) => lines.reduce((s, l, i) => s + lh(l) + gapOf(l, i, lines.length), 0);
/** Card position y (frame fraction, block centre) for a block whose FIRST glyph top is at `top`. */
export const yFromTop = (lines, top) => (top * FH - (lh(lines[0]) - lines[0].size) / 2 + blockH(lines) / 2) / FH;
/** Card position y for a block whose LAST line's baseline is at `baseline` (frame fraction). */
export function yFromLastBaseline(lines, baseline) {
  const last = lines[lines.length - 1];
  const bottom = baseline * FH - (BASELINE_EM[last.lang] ?? 0.3) * last.size + lh(last) / 2;
  return (bottom - blockH(lines) / 2) / FH;
}

/**
 * A one-line card whose alphabetic baseline sits at `baseline` (frame fraction from the top).
 * line: { text, lang, size, tracking, ... }; o: { x (frame fraction), align, style, ...card fields }
 */
export function lineCard(id, start, end, line, { x = 0.5, baseline, align = 'center', style = OVER_PICTURE, ...card } = {}) {
  const l = { ...style.line, ...line };
  const y = baseline - ((BASELINE_EM[l.lang] ?? 0.3) * l.size) / FH;
  return {
    id, start, end, lines: [l], position: [x, y], frame: 'full', align,
    fadeIn: 1.2, fadeOut: 1.2, rise: 0, blurIn: 0, blurOut: 0, stagger: 0, ...style.card, ...card,
  };
}

/**
 * A sentence in two beats on fixed lines (L1): `zh` and `en` are [first clause, second clause];
 * each language's full line is centred on `cx` and laid out once; the second clause appears at
 * `t2` exactly where it belongs. Returns four cards: <id>a-zh, <id>a-en, <id>b-zh, <id>b-en.
 */
export function twoBeat(id, { zh, en, t1, t2, end, cx = 0.5, zhLine, enLine, zhBaseline, enBaseline, style = OVER_PICTURE, first = {}, second = {} }) {
  const cards = [];
  for (const [lang, parts, l, base] of [['zh', zh, zhLine, zhBaseline], ['en', en, enLine, enBaseline]]) {
    const full = parts.join('');
    const x0 = cx * FW - lineWidth(full, l) / 2;
    const x1 = x0 + advance(parts[0], l);
    // the first clause arrives with a 6 px rise (SCRIPT.md section 5) and then never moves
    cards.push(lineCard(`${id}a-${lang}`, t1, end, { ...l, text: parts[0] }, { x: x0 / FW, baseline: base, align: 'left', style, riseIn: 6, ...first }));
    cards.push(lineCard(`${id}b-${lang}`, t2, end, { ...l, text: parts[1] }, { x: x1 / FW, baseline: base, align: 'left', style, ...second }));
  }
  return cards;
}
