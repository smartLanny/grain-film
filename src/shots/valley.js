// Shots and cards owned by the VALLEY group: the master landscape through ice and erosion
// (S06, S08, S10, S11). Ids and times are fixed by docs/story.md.
// Shot params are passed straight to the landscape as its state (see src/worlds/valley.js).
import { SHOT, MASTER_CAMERA, MASTER_CAMERA_18X9, PALETTE } from '../lib/story.js';
import { storyCard } from './_card.js';

const shot = (id, world, rest = {}) => ({ id, start: SHOT[id][0], end: SHOT[id][1], world, ...rest });
const master = { position: MASTER_CAMERA_18X9.position, rotation: MASTER_CAMERA_18X9.rotation, fov: MASTER_CAMERA_18X9.fov };
const K = (keys, extra = {}) => ({ keys, time: 'absolute', ...extra });
const step = (t, t0) => { const k = Math.min(1, Math.max(0, (t - t0) / 0.9)); return 1 - Math.pow(1 - k, 3); };

// Act I grade: clean and cold with one warm accent (blue shadows, rose-gold light).
const GRADE_WATER = {
  contrast: 1.08, saturation: 1.0, bloom: 0.05, bloomScatter: 0.7, halation: 0.1,
  lift: [0.010, 0.012, 0.020], vignette: 0.36, grain: 0.03, chromaticAberration: 0.8,
};
// Act II grade: the colour drains (bleach-bypass feel, slightly lifted blacks in the time-lapse).
const GRADE_STONE = {
  contrast: 1.1, saturation: 0.72, bloom: 0.045, bloomScatter: 0.66, halation: 0.06,
  lift: [0.022, 0.022, 0.024], vignette: 0.4, grain: 0.04, chromaticAberration: 0.8,
};

export const shots = [
  shot('S06', 'valley', {
    camera: master,
    transitionIn: { type: 'fadeFromWhite', duration: 2 },
    params: {
      year: 0,
      sunElevation: K([[44, -2.0], [58, 4.0]]),
      sunAzimuth: 236,
      cloudCover: 0.1, cloudSpeed: 1.2, fog: 0.22, spindrift: 1,
      starVisibility: K([[44, 0.9], [50, 0.45], [56, 0.0]]),
      title: 1,
    },
    post: { ...GRADE_WATER, exposure: K([[44, 2.2], [46, 0]], { ease: 'outCubic' }) },
  }),
  shot('S08', 'valley', {
    // the crane begins outside the snout (half a unit back from the ice), low over the gravel
    camera: {
      path: [[0.12, 0.07, -0.72], [0.16, 0.2, -0.2], [0.3, 0.95, 1.9], [0.6, 2.5, 6]],
      target: [[0.3, 0.12, -3.0], [0.4, 0.4, -12], [0.8, 2.2, -40], [1.2, 6, -110]],
      ease: 'inOutSine', lens: 24, near: 0.01,
    },
    shutter: 1,   // time-lapse: every frame integrates its whole interval (with --samples)
    params: {
      localMelt: true,
      // the sun rides ahead of us, above the frame: the braids flash and the horn is rim-lit
      sunElevation: K([[65, 22], [74, 27]]), sunAzimuth: K([[65, 324], [74, 340]]),
      cloudCover: 0.5, cloudSpeed: 60, cloudStreak: 0.8, fog: 0.2, spindrift: 0.3,
      riverTip: K([[65, 1.45], [65.5, 1.1], [68.2, -9], [70, -22]]),
      near: 0.01,
    },
    post: { ...GRADE_WATER },
  }),
  shot('S10', 'valley', {
    camera: master,
    shutter: 1,
    params: {
      sunElevation: K([[82, 28], [88, 46], [96, 22]]), sunAzimuth: K([[82, 222], [96, 286]]),
      cloudCover: 0.5, cloudSpeed: 85, cloudStreak: 1, fog: 0.2, spindrift: 0.15,
      season: (lt) => 0.5 + lt * 7,
      rockfall: [84, 88, 92], rockfallLife: 3.4, rockfallScale: 3.2, rockfallGrains: 0.3,
      // the horn wears down in steps: a quarter by slow creep, a quarter with each rockfall
      shapeYear: (lt, t) => 300 + 2700 * (0.25 * lt + 0.25 * (step(t, 84) + step(t, 88) + step(t, 92))),
    },
    post: { ...GRADE_STONE },
  }),
  shot('S11', 'valley', {
    camera: { position: MASTER_CAMERA.position, target: [5.4, 19.2, -158], fov: 5.4, shake: { amp: 0, rot: 0.05, freq: 0.16, seed: 11 } },
    params: {
      year: 3000, sunElevation: 13, sunAzimuth: 282, cloudCover: 0.3, cloudSpeed: 2, fog: 0.05,   // snow as S10 leaves it
      // the flake lets go at 96.0 and trails grit; it bursts about a second and a half later
      slab: { t: 96.0, u: 0.115, f: 0.2 },
      // grit trails the flake as it slides; it bursts about a second and a half later
      rockfall: [{ t: 96.0, u: 0.115, f: 0.30, life: 6.5, scale: 0.9, dust: 0.45 }, { t: 97.3, u: 0.115, f: 0.36, life: 8, scale: 2.4 }, { t: 97.7, u: 0.12, f: 0.40, life: 7.5, scale: 1.9 }],
      tele: 1,
    },
    post: { ...GRADE_STONE, saturation: 0.88, temperature: 0.34, contrast: 1.2, exposure: -0.15, lift: [0.012, 0.012, 0.014] },
  }),
];

const line = (text, lang, size, tracking, extra = {}) => ({ text, lang, size, tracking, color: PALETTE.cardText, ...extra });
export const cards = [
  // C1, the film title: lit spindrift (in the valley world) over this solid card, which rises
  // beneath the grains to guarantee legibility.
  {
    id: 'C1', start: 49.0, end: 56.0,
    lines: [
      line('一粒', 'zh', 120, 0.5, { gap: 26, opacity: 0.85 }),
      line('GRAIN', 'en', 30, 0.6, { case: 'upper', opacity: 0.85 }),
    ],
    position: [0.72, 0.26], align: 'center', frame: 'picture',
    fadeIn: 1.5, fadeOut: 1.5, blurIn: 6, blurOut: 0, rise: 0, stagger: 0, shadow: 0.35, easeIn: 'inOutSine',
  },
  storyCard('C2', 67, 72, '水，走得快。', 'Water travels fast.'),
  storyCard('C3', 87, 93.5, '山，走得慢。', 'A mountain travels slowly.', { fadeIn: 1.8, fadeOut: 1.8 }),
];
