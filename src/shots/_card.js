// Shared layout for the four story cards (C2-C5): lower left, Chinese above English, so that they
// read as a ritual. Positions are fractions of the 2.39:1 picture area (docs/story.md section 5).
import { PALETTE } from '../lib/story.js';

export const storyCard = (id, start, end, zh, en, extra = {}) => ({
  id, start, end,
  lines: [
    { text: zh, lang: 'zh', size: 44, tracking: 0.14, color: PALETTE.cardText, opacity: 0.92 },
    { text: en, lang: 'en', size: 22, tracking: 0.08, case: 'none', color: PALETTE.cardText, opacity: 0.92, gap: 16 },
  ],
  position: [0.083, 0.83], align: 'left', frame: 'picture',
  fadeIn: 1.2, fadeOut: 1.2, rise: 6, blurIn: 0, blurOut: 0, stagger: 0, shadow: 0.55,
  ...extra,
});
