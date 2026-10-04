// Shots owned by the CITY group (SCRIPT.md 8.4): S01, S09, S10, S15, S17, S18, S19. World: city (W1,
// src/worlds/city.js and city/*). Ids, times and transitions are fixed by SCRIPT.md section 4. post =
// the LOOK of SCRIPT.md 7.3 (the world adds paperScroll, pools and its own flat grade).
//
// Much of the choreography is closed-form in the world, not keyed here, because it is one motion:
//   S01  the scroll (worlds/city/choreo.js scrollS01: at rest on the bright window at 13.0)
//   S09  the cell's descent (44 floors in 7 s at a steady 22 m/s; the street arrives at 97.0)
//   S10  the walk (two steps a second, the hero held at 42% across)
//   S17/S18  the weave, the stop at 155.0, the parting, the ring, the camera (choreo.js CROSSING,
//        from story.S17_CROSSING and story.S16_UMBRELLA, the X8 match with INTERIOR's S16)
// Joins: X8 (above); X9 umbrellas are FLOCK instances (lib/flock.js), placed every frame by the world.
// Cards: T1, the title inscription, by resist, with the LOOK group's helper (SCRIPT.md section 5).
import { shot, lookPost as look, abs, MERGED_INK } from './_shot.js';
import { inscriptionT1 } from './_card.js';
import { paperScrollS01 } from '../worlds/city/choreo.js';
import { SYNC } from '../lib/story.js';

// CITY paints ink densities and hands them to the INK pass through an exactly inverted grade
// (worlds/city/glsl.js INK_OUT), so nothing may bend the tones on the way: no bloom, no halation.
const lookPost = (id, post = {}) => look(id, { bloom: 0, halation: 0, ...post });

export const shots = [
  shot('S01', 'city', {
    // black for 2 s; the black diluted from the centre 2 -> 6; the train on the bridge 7 -> 13
    params: { set: 'scroll', night: 1, mist: 0.6, litWindows: 0.12, wash: abs([[2, 1], [6, 0]]), train: [7, 13] },
    post: lookPost('S01'),
  }),
  shot('S09', 'city', {
    params: { set: 'facade', rain: 0.7 },
    post: lookPost('S09'),
  }),
  shot('S10', 'city', {
    params: { set: 'footbridge', rain: 1 },
    post: lookPost('S10'),
  }),
  shot('S15', 'city', {
    params: { set: 'scroll', night: 0, mist: 0.5, rain: { keys: [[0, 0.6], [1, 0.2]] }, goldSlit: SYNC.gold, zoom: 0.9, centreY: 0.47 },
    // the gold arrives with the slit at 142.0, not before (LOOK's table gives 0 -> 0.3 across the shot)
    post: lookPost('S15', { ink: { chroma: abs([[SYNC.gold - 0.05, 0], [SYNC.gold + 0.45, 0.3]]) } }),
  }),
  shot('S17', 'city', {
    // the stop (155.0), the fold, the face and the camera are in worlds/city/choreo.js (CROSSING)
    // the rain ceases 156 -> 157.5, but for a few last strokes that fall until the wings open;
    // sunEdge 0..1: the edge of the sun crosses from lower left; beyond 1 it runs on out of the picture
    params: { set: 'crossing', rain: abs([[156.0, 1], [157.5, 0.1], [161.2, 0.045], [162.0, 0.02]]), sunEdge: abs([[156.0, 0], [160.0, 1], [162.0, 2.2]]), shadowLength: 6 },
    post: lookPost('S17'),
  }),
  shot('S18', 'city', {
    // the ring (worlds/city/choreo.js RING_KNOTS): the first wings at SYNC.firstWing beside the hero, held
    // close; then the ring gathers speed and the frame pulls back; 30 m/s from 60 m out
    params: { set: 'crossing', rain: abs([[162.0, 0.02], [163.0, 0]]), sunEdge: abs([[162.0, 2.2], [165.0, 6]]), shadowLength: 6 },
    // one take with S17: the ink starts where S17 leaves it (0.75) and thins to the table's 0.55; the
    // colour comes with the first wings (0.6 -> 0.9 while the frame is still close), over the whole sheet
    // the last second opens up a third of a stop and S19 comes in as much under: the cut at 170.0 is on the
    // motion of the wings, not on a step of light
    post: lookPost('S18', { exposure: abs([[168.6, 0], [170.0, 0.14]]), ink: { amount: abs([[162.0, 0.75], [166.0, 0.55]], 'inOutSine'), chroma: abs([[162.0, 0.6], [163.4, 0.9]], 'inOutSine') } }),
    shutter: 1,
  }),
  shot('S19', 'city', {
    params: { set: 'canyon', windowSheen: abs([[171, 0], [175, 1]]) },
    // the merged look of the ending (S19 to S22 share MERGED_INK): ink line over a continuous colour wash
    post: lookPost('S19', { exposure: abs([[170.0, -0.3], [171.4, 0]], 'outCubic'), ink: { ...MERGED_INK } }),
    shutter: 1,
  }),
];

// T1: the title inscription by resist (LOOK's helper). It lies on the paper: right-aligned at 93%, 12%
// from the top at 9.0 s (the middle of its full display), drifting with the scroll before and after.
// The wash floods back over it from 11.0 to 12.5 (SCRIPT.md section 5): the resist's threshold meets the
// thin strokes at 0.88 of its fade and the stroke cores at 0.15, so the fade itself runs 10.75 -> 12.8.
export const cards = [...inscriptionT1({ anchor: paperScrollS01(9.0), end: 12.8, flood: 2.05 })];
