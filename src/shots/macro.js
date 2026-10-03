// Shots and cards owned by the MACRO group: the seed's bed and the strata
// (S07, S09, S12, S13, S14, S15, S16). Ids and times are fixed by docs/story.md.
//
// The two worlds drive their own cameras, lights and depth of field as pure functions of film time
// (see src/worlds/bed.js and src/worlds/strata.js), so the shots here only carry the grade.
import { SHOT, PALETTE } from '../lib/story.js';
import { storyCard } from './_card.js';
import { FONT_STACKS } from '../titles.js';
import { WIPE } from '../worlds/bed.js';

const shot = (id, world, rest = {}) => ({ id, start: SHOT[id][0], end: SHOT[id][1], world, ...rest });
const abs = (keys, ease = 'inOutSine') => ({ keys, time: 'absolute', ease });

export const shots = [
  shot('S07', 'bed'),
  shot('S09', 'bed'),
  shot('S12', 'bed'),
  shot('S13', 'bed'),
  // S14: Act II drains of colour; ends nearly black with a single amber point
  shot('S14', 'strata', {
    post: {
      exposure: abs([[122, 0.35], [129, 0.2], [134, 0.6], [140, 0.6]]),
      saturation: abs([[122, 0.6], [124, 0.72], [134, 0.8]]),
      contrast: abs([[122, 1.0], [123, 1.0], [124.5, 1.08]]), grain: abs([[122, 0.04], [131, 0.045], [134, 0.06]]), vignette: 0.55,
      gain: (localT, t) => (t < WIPE.t1 ? WIPE.gain : [1, 1, 1]),
    },
    // The ground-line wipe: both shots render for one second at a constant 50% mix, each with its
    // display gain doubled and blacked out on its own side of the rising soil edge (see bed.js WIPE).
    transitionIn: { type: 'dissolve', duration: WIPE.t1 - WIPE.t0, ease: () => 0.5 },
  }),
  // S15: colour returns as an event, band by band; the burst of light at the surface carries the cut
  shot('S15', 'strata', {
    post: {
      exposure: abs([[140, 0.6], [142.5, 0.1], [152.6, 0.0], [153.1, 0.5], [154, 1.9]]),
      saturation: abs([[140, 0.8], [145, 0.95], [153, 1.1]]),
      contrast: 1.06, grain: abs([[140, 0.06], [144, 0.035], [154, 0.03]]), vignette: abs([[140, 0.55], [152, 0.45], [154, 0.2]]),
      bloom: abs([[140, 0.07], [152.6, 0.07], [154, 0.3]]), bloomScatter: 0.75,
    },
  }),
  shot('S16', 'bed'),
];

// C4 is two beats (docs/story.md section 5): the first sentence at 113.0; after two seconds of nothing
// the second joins it on the same lines at 115.0; everything fades together 118.8-120.0.
// Three cards with the same start, end and drift, so the lines stay registered:
//   C4a  both first sentences;  C4b  the Chinese second sentence (set off by full-width spaces);
//   C4c  the English second sentence, placed where the first one ends (measured with the card font).
const late = (x) => { const k = Math.min(1, Math.max(0, (x * 3.2 - 2) / 1.2)); return 1 - Math.pow(1 - k, 3); };
function enAdvance(text, size, tracking) {
  if (typeof document === 'undefined') return text.length * size * 0.52;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `400 ${size}px ${FONT_STACKS.en}`;
  ctx.letterSpacing = `${(tracking * size).toFixed(2)}px`;
  return ctx.measureText(text).width;
}
const EN1 = 'A seed does not travel.';
const C4_X = 0.083, C4_Y = 0.83, PIC_H = 1920 / 2.0;
// vertical centre of the English line inside the two-line story card: line heights 44 * 1.2 and
// 22 * 1.25, and the default gap under the Chinese line (round(0.55 * size) px, see titles.js)
const ZH_H = 44 * 1.2, ZH_GAP = Math.round(44 * 0.55), EN_H = 22 * 1.25;
const EN_DY = (ZH_H + ZH_GAP + EN_H / 2) - (ZH_H + ZH_GAP + EN_H) / 2;

export const cards = [
  storyCard('C4a', 113, 120, '种子不走。', EN1),
  storyCard('C4b', 113, 120, '　　　　　它等。', ' ', { fadeIn: 3.2, easeIn: late }),
  {
    id: 'C4c', start: 113, end: 120,
    lines: [{ text: 'It waits.', lang: 'en', size: 22, tracking: 0.08, case: 'none', color: PALETTE.cardText, opacity: 0.92 }],
    position: [C4_X + enAdvance(EN1 + ' ', 22, 0.08) / 1920, C4_Y + EN_DY / PIC_H], align: 'left', frame: 'picture',
    fadeIn: 3.2, fadeOut: 1.2, rise: 6, blurIn: 0, blurOut: 0, stagger: 0, shadow: 0.55, easeIn: late,
  },
];
