// Shots owned by Group B, BUTTERFLY and MACRO (SCRIPT.md 8.4): S03, S04b, S05, S06, S07, S12, S13,
// S21, S22. Worlds: scale (W3), grass (W4). Ids, times and transitions are fixed by SCRIPT.md
// section 4. The choreography lives in the worlds as closed-form functions of film time; the params
// here are the shot list's "Key parameters" that the worlds read (everything else they take from
// lib/story.js: SYNC, breath, SEVEN, sway, HERO_BLADE, bladeSpring, S07_SPRING, LAMP_SUN ...).
//
// Portals: S07 shows S01 at 10.0 (the ink city in the dew drop); S13 shows S14 at 129.0 and pushes in
// until fill = 1 (X6, the invisible cut: the world blends its post into S14's own, so S13 does NOT
// use lookPost: its ink block comes from worlds/grass.js). `impression: true` swaps a portal for the
// drop's built-in stand-in (lib/drop.js) while the other world is not there.
// Card C0 ("Produced by Fable 5.5") is diegetic: made of scales in the SCALE world, not a card.
// S22 ends in black: the shadow has covered the frame by SYNC.black (214.0); from there to the cut
// the frame is ink black #0D0C0E (a fade held at 1; S23 opens on the same value).
import { shot, lookPost, abs, sheen, MERGED_INK } from './_shot.js';
import { SYNC, SHOT } from '../lib/story.js';

const BLACK_FOR = SHOT.S22[1] - SYNC.black;            // 2.0 s of black after the shadow
const RAMP = 0.5;                                      // the shadow's last half second closes to ink black
const INK_BLACK = [13.74 / 255, 12.83 / 255, 15.11 / 255];      // #0D0C0E: the one black of the film (S23 holds it from 216.0)

export const shots = [
  shot('S03', 'scale', {
    params: { hold: 1, wingTilt: 3 },
    post: lookPost('S03'),
  }),
  shot('S04b', 'grass', {
    transitionIn: sheen(3),                       // X3: lamp = sun, desk edge = stem, hump = pupa
    params: { pupaSplit: abs([[SYNC.split, 0], [44.6, 1]], 'outCubic'), firstOpen: [51, 52] },
    post: lookPost('S04b'),
  }),
  shot('S05', 'grass', {
    params: {},
    post: lookPost('S05'),
    shutter: 0.8,
  }),
  shot('S06', 'grass', {
    params: { land: 63.5, proboscis: abs([[66, 0], [68, 1]], 'inOutSine'), sunElevation: 14 },
    post: lookPost('S06'),
  }),
  shot('S07', 'grass', {
    params: { rack: 74.5, portal: { shot: 'S01', t: 10.0 }, impression: false },
    post: lookPost('S07'),
  }),
  shot('S12', 'grass', {
    params: { inkCloud: { keys: [[0, 0], [1, 0.7]] } },
    post: lookPost('S12'),
  }),
  shot('S13', 'grass', {
    params: { portal: { shot: 'S14', t: SYNC.railJoint }, impression: false },
    post: {},
  }),
  // S21 / S22: the merged look of the ending (S19 to S22 share MERGED_INK): the 7.3 table's ink over a continuous
  // colour wash, the drawing as ink line on the blade, the butterfly's edge and the grass tops. The frame is
  // locked, so the wash may run a little wetter than in the free shots before it
  shot('S21', 'grass', {
    params: { alight: 193.5, wear: 1 },
    post: lookPost('S21', { ink: { ...MERGED_INK, wet: 0.6 } }),
  }),
  shot('S22', 'grass', {
    params: { alight: 193.5, wear: 1, shadow: true },
    post: lookPost('S22', { ink: { ...MERGED_INK, wet: 0.6 } }),
    transitionOut: { type: 'fadeTo', color: INK_BLACK, duration: BLACK_FOR + RAMP, ease: (x) => { const k = Math.min(1, x * (BLACK_FOR + RAMP) / RAMP); return k * k * (3 - 2 * k); } },
  }),
];

export const cards = [];
