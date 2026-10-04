// Shots and cards owned by Group A (SCRIPT.md 8.4): S23, S24 in PAPER (W6), and the cards L1, L2, E
// (SCRIPT.md section 5: text exact, character by character). L1 fades over picture (first clause with
// a 6 px rise, _card.js twoBeat). L2 and E are on paper: they soak in (titles.js soak mode + the card
// pass in post.js) and the INK pass gives them the sheet's tooth. S24's sheen is post.sheen below.
//
// L1 is "over picture" (crosses S13 -> S14 unchanged). L2 and E are "on paper" (layer 'paper':
// laid into the shot before its INK pass). S22 -> S23: black is #000 on both sides 214.0-217.5;
// the dilution centre is story.REST_POINT; the blade is story.HERO_BLADE at rest (S23_SPRING).
import { shot, lookPost, abs } from './_shot.js';
import { SYNC, REST_POINT, S23_SPRING } from '../lib/story.js';
import { twoBeat, lineCard, OVER_PICTURE, ON_PAPER, CARD_LAYOUT as LAY, yFromTop, yFromLastBaseline } from './_card.js';
import { FONT_STACKS } from '../titles.js';

export const shots = [
  shot('S23', 'paper', {
    params: { wash: abs([[217.5, 1], [220.5, 0]]), washCentre: REST_POINT, spring: S23_SPRING },
    post: lookPost('S23'),
  }),
  shot('S24', 'paper', {
    params: { wash: 0, lampOff: abs([[238.5, 0], [240.0, 1]], 'inOutSine') },
    // the last sheen: a band crosses the sheet 233.0-234.5; over ink the black flashes wing blue and
    // is black again. The band is wider than the crossing SHEEN's 12% so that each stroke holds its
    // colour for about a third of a second (SCRIPT.md section 5, card E)
    // (over the blade at 233.3, the credits, the title last at 234.3)
    post: lookPost('S24', { sheen: { x: abs([[SYNC.sheenEnd - 0.01, 0], [SYNC.sheenEnd, 0.10], [233.3, 0.43], [234.3, 0.745], [234.5, 0.99], [234.51, 1]]), mode: 'ink', width: 0.26, gain: 1.25 } }),
  }),
];

// ---- cards (SCRIPT.md section 5) -------------------------------------------------------------
// Positions: CARD_LAYOUT (SCRIPT.md's 1920x1080 pixel positions converted to fractions of the full
// 2:1 frame). Sizes: px at 1080p, as the script gives them.
const ZH = (size, tracking) => ({ lang: 'zh', size, tracking });
const EN = (size, tracking, extra = {}) => ({ lang: 'en', size, tracking, ...extra });
const MIXED_STACK = `${FONT_STACKS.en.replace(/,\s*(Georgia,\s*)?serif\s*$/, '')}, ${FONT_STACKS.zh}`;   // glyph by glyph: Latin from en, CJK from zh
const E_TITLE = [
  { ...ON_PAPER.line, ...ZH(80, 0), text: '梦', gap: 14 },
  { ...ON_PAPER.line, ...ZH(80, 0), text: '蝶', gap: 23 },
  { ...ON_PAPER.line, ...EN(18, 0.42), text: 'THE DREAM OF THE BUTTERFLY', case: 'upper' },
];
const E_CREDITS = [
  ['出品　Fable 5.5', 'Produced by Fable 5.5'],
  ['语出《庄子·齐物论》', 'After Zhuangzi, "On the Equality of Things"'],
  ['全片的画面与声音，皆由代码生成。', 'Every frame and every sound was generated in code.'],
].flatMap(([zh, en], i, all) => [
  // Latin runs inside a Chinese line (Fable 5.5) are set in the English face, so its figures match the line below
  { ...ON_PAPER.line, ...ZH(28, 0.1), text: zh, gap: 6, font: MIXED_STACK },
  { ...ON_PAPER.line, ...EN(17, 0.04), text: en, gap: i < all.length - 1 ? 44 : 0 },
]);

export const cards = [
  // L1, the question: two beats on fixed lines over picture, 123.0 and 130.0; all out 135.3-136.5
  ...twoBeat('L1', {
    zh: ['不知周之梦为胡蝶与，', '胡蝶之梦为周与？'],
    en: ['There is no knowing whether Zhou dreamed he was a butterfly,', ' or a butterfly is dreaming it is Zhou.'],
    t1: 123.0, t2: 130.0, end: 136.5, cx: LAY.L1.cx,
    zhLine: ZH(44, 0.14), enLine: EN(22, 0.06), zhBaseline: LAY.L1.zhBaseline, enBaseline: LAY.L1.enBaseline, style: OVER_PICTURE,
  }),
  // L2, the great awakening: on the paper, centred at 64% across; in 222.5-224.0, out 228.5-229.5
  lineCard('L2-zh', 222.5, 229.5, { ...ZH(44, 0.14), text: '且有大觉，而后知此其大梦也。' }, { x: LAY.L2.cx, baseline: LAY.L2.zhBaseline, style: ON_PAPER, fadeIn: 1.5, fadeOut: 1.0, easeOut: 'linear' }),
  lineCard('L2-en', 222.5, 229.5, { ...EN(22, 0.06), text: 'And there is a great awakening; only then do we know that this was the great dream.' }, { x: LAY.L2.cx, baseline: LAY.L2.enBaseline, style: ON_PAPER, fadeIn: 1.5, fadeOut: 1.0, easeOut: 'linear' }),
  // E, the end block: in 230.0-231.5, out with the paper 238.5-240.0
  {
    id: 'E-title', start: 230.0, end: 240.0, layer: 'paper', frame: 'full', align: 'right',
    position: [LAY.E.right, yFromTop(E_TITLE, LAY.E.titleTop)], lines: E_TITLE,
    fadeIn: 1.5, fadeOut: 0.001, rise: 0, blurIn: 0, blurOut: 0, stagger: 0, shadow: 0,   // it goes out with the paper (lampOff)
  },
  {
    id: 'E-credits', start: 230.0, end: 240.0, layer: 'paper', frame: 'full', align: 'right',
    position: [LAY.E.right, yFromLastBaseline(E_CREDITS, LAY.E.lastBaseline)], lines: E_CREDITS,
    fadeIn: 1.5, fadeOut: 0.001, rise: 0, blurIn: 0, blurOut: 0, stagger: 0, shadow: 0,   // it goes out with the paper (lampOff)
  },
];
