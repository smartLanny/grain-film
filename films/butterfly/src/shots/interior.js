// Shots owned by the INTERIOR group (SCRIPT.md 8.4, Group C split in two): S02, S04a, S08, S11,
// S14, S16. World: interior (W2) and lib/figure.js. Ids, times and transitions are fixed by
// SCRIPT.md section 4. The choreography of each shot lives in worlds/interior.js as closed-form
// functions of film time (the breath, the jolt at 82.0, the nod 109-113, the second waking at 129.0,
// the umbrellas at 148/149/150/151): `set` chooses the stage, the rest is documentation of the beats.
// post = the LOOK of SCRIPT.md 7.3; pools, depth of field and bloom come from the world (world.post).
//
// Joins with the other groups (story.js): LAMP_SUN, DESK_EDGE_Y, SLEEPER_OUTLINE / SLEEPER_HUMP and
// BUTTERFLY_ON_GLASS (X1, X3 with MACRO), DUST / dustDiscs (X2), SEVEN + sway (X5), SPECK, breath,
// S16_UMBRELLA (X8 with CITY). X6: S14's first frame (129.0) is shown by MACRO through
// engine.portal('S14', 129.0): it is a pure function of t. Cards: none.
import { shot, lookPost } from './_shot.js';
import { SYNC } from '../lib/story.js';

export const shots = [
  shot('S02', 'interior', {
    params: { set: 'desk', butterfly: { enter: 17.0, land: SYNC.landing, open: [22.4, SYNC.wingsOpen], push: [25.0, 26.0] } },
    post: lookPost('S02'),
  }),
  shot('S04a', 'interior', {
    // the room is painted in neutral ink, so chroma 1 colours only the scale dust (X2: the same blue
    // discs as S03's last frame) and the speck; the frame is otherwise S02's
    params: { set: 'desk', speckAt: 41.0 },
    post: lookPost('S04a', { ink: { chroma: 1 } }),
  }),
  shot('S08', 'interior', {
    // "Cut on the impact, 2 frames of white, into the alarm": white for frames 82.000 and 82.033
    transitionIn: { type: 'fadeFromWhite', duration: 0.065, ease: () => 0 },
    // the jolt is played from 82.067, the first frame after the white; a clear raindrop sits on the
    // glass where the butterfly sat, over the pale wall
    params: { set: 'desk', jolt: SYNC.impact, lampOff: 88.0, dropRuns: 85.0 },
    post: lookPost('S08'),
  }),
  shot('S11', 'interior', {
    params: { set: 'train', nod: [109, 113], leanAt: 113.5 },
    post: lookPost('S11'),
  }),
  shot('S14', 'interior', {
    // the colour meadow in the drop on the glass: a frame of S20 (FIELD) at 03:00.0
    params: { set: 'train', jolt: SYNC.railJoint, headTurn: [131.0, 132.5], daylight: [132.0, 132.6], rack: [133.0, 134.0], dropRelease: 136.0, portal: { shot: 'S20', t: 180.0 } },
    post: lookPost('S14'),
  }),
  shot('S16', 'interior', {
    // the first time gold enters an interior: let the wash carry it (the table's 0.45 leaves it cream)
    params: { set: 'stairs', umbrellaPops: SYNC.umbrellas },
    post: lookPost('S16', { ink: { chroma: 0.85 } }),
  }),
];

export const cards = [];
