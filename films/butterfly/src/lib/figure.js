// FIGURE (SCRIPT.md 3.0): human beings as back-lit ink silhouettes only. Owner: INTERIOR group.
//
// A figure is a 3D skeleton of tapered capsules (torso, shoulders, pelvis, neck, head, 4 arm and 6 leg
// segments, plus clothes: a coat hem, a bag, hair, an umbrella) solved in plain JS from blendable
// poses, then drawn as ONE camera-facing quad whose fragment shader fills the smooth union of the
// projected capsules with flat ink. So the silhouette is exact from any camera (side-on, from behind,
// straight down), the shoulders and coat melt into one shape like a brush mark, and one figure costs
// one small draw call. `shadow` draws the same silhouette as seen from the sun, laid on the ground.
//
//   import { createFigure } from '../lib/figure.js';
//   const f = createFigure({ seed: 'hero' });
//   scene.add(f.mesh);  f.mesh.position.set(x, y, z);          // feet at the origin, METRES
//   f.set({ pose: { walk: 1 }, phase: t * 0.9, turn: 180, speck: 1 });
//
// createFigure({ seed, ...traits }) -> { mesh, set(state), dispose(), joints(), traits }
//   mesh    THREE.Mesh in METRES: 1.7 m standing (x traits.height), feet at the origin, up +Y, facing
//           +X (screen right for a camera on +Z looking down -Z). Position / rotate (about Y) / scale
//           (uniformly) it as you like; it re-projects itself for whatever camera renders it.
//           A negative scale.y turns it over about its feet (a reflection in a floor).
//   traits  optional overrides of what the seed chooses: { height 0.9..1.08, build 0.85..1.2,
//           coat 0..0.5 (hem length, m), hair 0 short | 1 bob | 2 cap | 3 ponytail | 4 short (the hero),
//           bag 0 none | 1 shoulder bag | 2 backpack | 3 tote, collar 0..1 (turned up) }. Seeds 'hero' / 'sleeper' are the
//           film's protagonist (short hair, mid coat, shoulder bag). Everyone has the same plain human
//           head (a round skull, the profile of forehead, nose, lips and chin, a narrower neck).
//   set(state)  any subset; persists:
//     pose     { name: weight } over asleepAtDesk, seated (propped on the forearms at a desk), sit
//              (dozing on a bench), upright, strapHang, strapNod, climb, walk, topDown, shadow. Weights are normalised and
//              may be negative (overshoot). walk / climb are gait cycles: drive them with `phase`
//              (walk: the body bobs and grounds itself; move the mesh at about 1.35 m per cycle.
//              climb: stairs of 0.30 x 0.17 m (STAIR), feet planted: the stance foot stands at the
//              mesh origin; step the mesh one going forward and one rise up each half cycle, i.e.
//              to step floor(2 * phase)).
//              topDown = standing, meant to be seen from straight above (a head on a shoulder
//              ellipse; any pose works from above). shadow = the walk pose cast on the ground (below).
//     phase    walk / climb cycle position in CYCLES (one cycle = two steps); e.g. t * 0.9
//     breath   0..1 (story.breath(t)): the shoulders and upper back rise
//     lean     degrees of sway; positive = toward +X (before `turn`). Standing poses lean about the
//              feet (the top moves); strap poses swing about the gripping hand like a pendulum (the
//              LOWER end moves toward +X), unless `planted`: then they too lean from their (planted)
//              feet and the arm is solved so that the hand stays on its grip
//     planted  true: strap poses stand on their feet (see lean); twist: degrees of yaw of the
//              shoulders against the hips (turning the upper body while the feet stay put)
//     turn     degrees about +Y (0 = facing +X, 90 = facing -Z i.e. away from a camera on +Z,
//              180 = facing -X i.e. screen left)
//     speck    0..1 the blue grain on the LEFT shoulder (story.SPECK): 2-3 px at every shot scale
//     nod      degrees added to the head's forward pitch (the head sinking, S11); headTurn: degrees
//              of head yaw (positive = to the figure's left); slump 0..1 (rounded back, bowed head)
//     umbrella 0..1 (0 = none, 0.02 = furled line, 1 = open, 1.1 m wide); umbrellaTilt degrees from
//              overhead toward the facing direction (0 = overhead, 90 = pointed ahead)
//     face     0..1 a paler head: the face tipped up, as seen from above (S17)
//     color    [r, g, b] linear ink colour (default #0D0C0E); opacity 0..1; soft: edge feather in m
//     rim      { dir: [x, y] toward the light in the picture plane, width (m, 0.03), amount 0..1,
//              color [r, g, b] linear, above: height (m) below which the light does not reach }: back light catching the edge that faces it; null = none
//     lines    { amount 0..1, width (m, 0.005), color [r, g, b] linear, dir [x, y] (the shaded side,
//              default down-left), head, arms, ear (booleans) }:
//              the contours a painter leaves inside the mass (the head lying on the arm, the near
//              arm against the body, the ear), in a paler ink; null = one flat mass
//     phone    true: a phone in the left hand (use with armL, e.g. [30, 4, 24, 118])
//     reachL / reachR  [x, y, z, weight]: send that hand to a point (local metres before `turn`)
//     grip     [x, y, z] the point the right hand holds in the strap poses, local metres before
//              `turn` (default [-0.13, 1.88, 0.1] x height: above and behind the head); armL: [swing, abduct, twist, elbow]
//              degrees, overriding the pose's left arm (e.g. [25, 4, 20, 115]: reading a phone)
//     shadowLength  shadow length per metre of height (default 4, i.e. sun 14 deg up);
//     shadowDir     degrees about +Y of the direction the shadow falls (0 = toward +X, ahead of the
//                   walker; 180 = behind). With pose.shadow > 0.5 the mesh is a quad lying on y = 0
//                   (+2 mm) from the feet outward, drawn with alpha blending (opacity, soft) and no
//                   depth write: head-and-shoulders at the far end, legs scissoring at the feet.
//   joints()   -> the solved skeleton in local metres ({ headC, shL, shR, grip, ... } as Vector3),
//                 for placing things on the figure (a strap, an umbrella match)
//   speckWorld(camera) -> world position of the speck as that camera sees it (for its ink pool)
//   dispose()
// Flat ink (#0D0C0E), no faces; no hands except at the desk (a plain tapered hand, S08). Pure
// function of its state: no clocks, no randomness after construction. Depth: the whole figure is
// written at the plane through its middle (the quad needs an MSAA target for its soft edge: alpha
// to coverage; elsewhere the edge is hard).
// A test sheet of the walk cycle and its shadows: worlds/interior.js, params.set = 'figures'.

import * as THREE from 'three';
import { PALETTE, linear } from './story.js';
import { createRng } from './random.js';

export const FIGURE_POSES = ['asleepAtDesk', 'seated', 'sit', 'upright', 'strapHang', 'strapNod', 'climb', 'walk', 'topDown', 'shadow'];

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
/** Body measures (m) of the 1.70 m reference figure. */
const B = {
  ankle: 0.07, shin: 0.41, thigh: 0.43, hipHalf: 0.085, hipDrop: 0.045,
  lumbar: 0.10, thorax: 0.19, neckBase: 0.2, shoulderUp: 0.148, shoulderHalf: 0.15,
  neck: 0.062, head: 0.09, headR: 0.112,
  upperArm: 0.30, foreArm: 0.272, hand: 0.08, foot: 0.15, heel: 0.06,
};

// ------------------------------------------------------------------------------------ poses
// Angles in degrees. pel/lum/ch/nk/hd: [pitch (+ forward), roll (+ to the figure's right), yaw (+ left)].
// arm: [swing (+ forward), abduct (+ away from the body), twist (+ forearm folds inward), elbow].
// leg: [swing (+ forward), abduct, knee, foot pitch (+ toe down)]. hip: pelvis centre (m).
// ground 1 = stand the lower foot on y = 0. grip 1 = the RIGHT hand holds the point gripP (IK).
const BASE = {
  hip: [0, 0.955, 0], pel: [0, 0, 0], lum: [0, 0, 0], ch: [0, 0, 0], nk: [0, 0, 0], hd: [0, 0, 0],
  armL: [0, 3, 0, 8], armR: [0, 3, 0, 8], legL: [0, 2, 0, 0], legR: [0, 2, 0, 0],
  ground: 1, grip: 0, gripP: [-0.13, 1.88, 0.1], rise: 0.012,
  deskL: [0, 0, 0, 0], deskR: [0, 0, 0, 0],      // hand targets [x, y, z, weight] (arms laid on a desk)
  elbowL: [0, 0, 0, 0], elbowR: [0, 0, 0, 0],    // planted elbows [x, y, z, weight]: with deskL/R, the forearm lies still on the table
  poleL: [0, -0.7, -1], poleR: [0, -0.7, 1],     // which way those elbows point
  footL: [0, 0, 0, 0], footR: [0, 0, 0, 0],      // ankle targets [x, y, z, weight] (feet planted on stairs)
  desk: 0,                                       // 1 = seated at the desk (S02/S04a/S08): slimmer seated legs and
                                                 // elbows, a drawn hand, elbows kept on the table (see the capsules)
  protract: 0,                                   // m: the shoulder blades slid forward, the arms hung from ahead of the shoulders
  footFlat: 0,                                   // 1 = feet targets are on a flat floor (not stairs): soles level
  headRest: 0,                                   // 1 = the head lies on something (the folded arms): it stays put while the back breathes
  neck: 0,                                       // m: the neck's length when the pose sets it (0 = the body's own)
};
const pose = (o) => ({ ...BASE, ...o });

const fract = (x) => x - Math.floor(x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lrp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const cyc = (u, c, w) => { let d = Math.abs(fract(u - c + 0.5) - 0.5); return Math.exp(-(d * d) / (w * w)); };   // cyclic bump
/** One leg of the gait at its own phase u (0 = heel strike, 0.6 = toe-off): [hip swing, knee, foot pitch]. */
function gaitLeg(u, climb, tired) {
  const amp = 1 - 0.18 * tired;
  const hip = (u < 0.52 ? 27 - 37 * sstep(0, 0.52, u) : -10 + 37 * sstep(0.52, 0.87, u)) * amp + climb * (22 * cyc(u, 0.9, 0.16) + 10 * cyc(u, 0.05, 0.1));
  const knee = 5 + 11 * cyc(u, 0.12, 0.07) + (56 * amp + 30 * climb) * cyc(u, 0.71 + 0.05 * climb, 0.105 + 0.03 * climb) + climb * 34 * cyc(u, 0.02, 0.12);
  const foot = 16 * cyc(u, 0.6, 0.08) - 6 * cyc(u, 0.0, 0.08);
  return [hip, knee, foot];
}
function walkPose(phase, climb = 0, tired = 0.5) {
  const uL = fract(phase), uR = fract(phase + 0.5);
  const L = gaitLeg(uL, climb, tired), R = gaitLeg(uR, climb, tired);
  const s = Math.sin(TAU * phase), c = Math.cos(TAU * phase);      // c > 0: the left foot is forward
  const sway = 1 + 1.6 * climb;
  return pose({
    hip: [0, 0.955, -0.014 * s * sway],
    pel: [4 + 5 * climb, 2.2 * s * sway, 4.5 * c],
    lum: [3 + 3 * climb, -1.4 * s * sway, -3.5 * c],
    ch: [5 + 4 * climb, -1.2 * s * sway, -5.5 * c],
    nk: [8, 0.6 * s * sway, 2.5 * c], hd: [5 + 3 * climb, 0, 2 * c],
    armL: [-(15 - 6 * climb) * c + 3, 5, 0, 16 - 7 * c], armR: [(15 - 6 * climb) * c + 3, 5, 0, 16 + 7 * c],
    legL: [L[0], 2, L[1], L[2]], legR: [R[0], 2, R[1], R[2]],
  });
}

/**
 * Climbing stairs (0.30 m going, 0.17 m rise), feet planted. One cycle = two steps. In each half
 * cycle the stance foot stands on a step at the origin; the other foot leaves the step below and
 * behind, clears the nosing and lands on the step above and ahead while the stance leg pushes the
 * body up. The host moves the mesh one step forward and up each half cycle (base step = floor(2 phase)).
 */
export const STAIR = { going: 0.3, rise: 0.17 };
function climbPose(phase) {
  const n = 2 * phase, k = Math.floor(n), h = n - k, leftStance = (((k % 2) + 2) % 2) === 0, sd = leftStance ? -1 : 1;
  const e = sstep(0.1, 0.95, h), push = Math.sin(Math.PI * Math.min(1, h / 0.8));
  const sw = sstep(0.1, 0.8, h), lift = Math.sin(Math.PI * clamp01((h - 0.04) / 0.8));
  const swing = [-STAIR.going + 2 * STAIR.going * sw, B.ankle - STAIR.rise + 2 * STAIR.rise * sstep(0.04, 0.6, h) + 0.07 * lift];
  const stance = [0, B.ankle];
  const fl = leftStance ? stance : swing, fr = leftStance ? swing : stance;
  // the weight shifts smoothly from foot to foot (sw = -1 over the left foot, +1 over the right): the
  // sway, the rolls and the arm swing are smooth periodic functions of the climb, so nothing jumps
  // when the half cycle wraps and the host steps the mesh
  const sway = -Math.cos(Math.PI * n), arm = Math.cos(Math.PI * n);
  return pose({
    hip: [-0.14 + STAIR.going * e, 0.76 + STAIR.rise * e, 0.03 * sway],
    pel: [12 + 7 * push, -2.5 * sway, 6 * sd * (0.5 - e)], lum: [7 + 3 * push, 1.5 * sway, -3 * sd * (0.5 - e)], ch: [10 + 5 * push, 1 * sway, -6 * sd * (0.5 - e)],
    nk: [4, 0, 0], hd: [-6 - 4 * push, 0, 0],
    armL: [4 + 11 * arm, 3, 0, 18], armR: [4 - 11 * arm, 3, 0, 18],
    footL: [fl[0], fl[1], -B.hipHalf, 1], footR: [fr[0], fr[1], B.hipHalf, 1], ground: 0,
  });
}

// standing in a train: both feet flat on the floor, one a little ahead (the legs are solved to them)
const STRAP_FEET = { footL: [0.07, B.ankle, -0.1, 1], footR: [-0.045, B.ankle, 0.1, 1], footFlat: 1, ground: 0 };
const POSES = {
  // weight on the right leg, the left knee soft, head a little forward: someone waiting
  upright: () => pose({ pel: [1, 2.5, 0], lum: [2, -2, 0], ch: [5, -1.5, 0], nk: [9, 0, 0], hd: [4, 0, 0], armL: [4, 5, 0, 10], armR: [-2, 5, 0, 7], legL: [5, 3, 10, 0], legR: [-2, 3, 2, 0] }),
  topDown: () => pose({ pel: [1, 1.5, 0], lum: [2, -1, 0], ch: [4, -1, 0], nk: [6, 0, 0], hd: [2, 0, 0], armL: [3, 9, 0, 10], armR: [-2, 9, 0, 8], legL: [4, 3, 6, 0], legR: [-2, 3, 2, 0] }),
  walk: (ph) => walkPose(ph, 0),
  shadow: (ph) => walkPose(ph, 0),
  climb: (ph) => climbPose(ph),
  // hanging from a ring by the right hand, which is above and BEHIND the head (so the bowed head stays
  // clear of the arm in profile); the weight hangs forward of the ring, the left arm is slack
  strapHang: () => pose({ hip: [0, 0.95, 0], pel: [2, -1.5, 0], lum: [3, -2, 0], ch: [7, -7, 0], nk: [21, 0, 0], hd: [13, 0, 0], armL: [4, 4, 0, 10], legL: [6, 4, 7, 0], legR: [-5, 4, 2, 0], grip: 1, gripP: [-0.13, 1.88, 0.1], ...STRAP_FEET }),
  // asleep on their feet: the weight sags onto the arm, knees give, the head is on the chest
  strapNod: () => pose({ hip: [0.04, 0.905, 0], pel: [7, -3, 0], lum: [9, -3, 0], ch: [15, -10, 0], nk: [30, 0, 4], hd: [22, 3, 0], armL: [9, 2, 0, 5], legL: [14, 4, 21, 0], legR: [-2, 4, 12, 0], grip: 1, gripP: [-0.13, 1.88, 0.1], rise: 0.008, ...STRAP_FEET }),
  // sitting on a bench, dozing: back against the seat, hands in the lap, the head gone forward
  sit: () => pose({ hip: [-0.02, 0.56, 0], pel: [-7, 0, 0], lum: [5, 0, 0], ch: [9, 0, 0], nk: [22, 5, 0], hd: [18, 6, 0], armL: [24, 7, 34, 62], armR: [22, 7, 30, 60], legL: [97, 7, 88, 0], legR: [95, 7, 86, 0], ground: 0, rise: 0.012 }),
  // slumped over the desk from an office chair: the head lying on the folded forearms, the thighs level
  asleepAtDesk: () => pose({ hip: [-0.4005, 0.587, 0], pel: [51.2, 0, 0], lum: [-13.2, 0, 0], ch: [18, 0, 6], nk: [56.85, 0, 0], hd: [-5.8, -37.75, 88.4], neck: 0.1295, armL: [52, 16, 60, 96], armR: [86, 6, 20, 38], legL: [139, 3, 104, 0], legR: [145, 7, 72, 0], ground: 0, rise: 0.022, desk: 1, protract: 0.03, headRest: 1,
    // read in outline only: the head a round skull lying on its right cheek (face to the camera, crown forward)
    // on the forearms, the neck reaching down to it from the shoulders, so a notch opens between head and
    // shoulders; both forearms planted flat on the desk as a low slab under the head, the hands lying beyond
    // it toward the laptop. (desk = where each forearm points, elbow = where it lies)
    elbowL: [0.17, 0.775, -0.3, 1], deskL: [0.4, 0.775, -0.12, 1], poleL: [0.94, -0.15, -0.31],
    elbowR: [0.185, 0.79, 0.32, 1], deskR: [0.41, 0.79, 0.14, 1], poleR: [0.52, -0.13, 0.85] }),
  // awake at the desk but not upright: propped on the forearms, the head hanging
  // (the seated lower body is the sleeper's: the pelvis rolled back under the same lumbar point, the thighs level on the seat)
  seated: () => pose({ hip: [-0.4187, 0.5889, 0], pel: [48, 0, 0], lum: [-28, 0, 0], ch: [14, 0, 0], nk: [-3, 0, 0], hd: [3, 0, 0], armL: [30, 6, 14, 70], armR: [26, 6, 18, 72], legL: [135.8, 3, 104, 0], legR: [141.8, 7, 72, 0], ground: 0, rise: 0.05, desk: 1, protract: 0.05, neck: 0.062,
    // both forearms on the desk, the elbows at its edge by the body, the hands forward of the chest, one over the other
    elbowL: [0.06, 0.785, -0.2, 1], deskL: [0.3, 0.775, 0.06, 1], elbowR: [0.06, 0.785, 0.2, 1], deskR: [0.3, 0.779, -0.06, 1] }),
};

const TARGETS = new Set(['deskL', 'deskR', 'elbowL', 'elbowR', 'footL', 'footR']);       // [x, y, z, weight]: blended by their weights
function blendPoses(weights, phase) {
  let tot = 0;
  const acc = {};
  for (const name of FIGURE_POSES) {
    const w = weights?.[name];
    if (!w) continue;
    const p = POSES[name](phase);
    tot += w;
    for (const k in p) {
      const v = p[k];
      if (typeof v === 'number') acc[k] = (acc[k] || 0) + v * w;
      else if (TARGETS.has(k)) { const a = acc[k] || (acc[k] = [0, 0, 0, 0]); for (let i = 0; i < 3; i++) a[i] += v[i] * v[3] * w; a[3] += v[3] * w; }
      else { const a = acc[k] || (acc[k] = v.map(() => 0)); for (let i = 0; i < v.length; i++) a[i] += v[i] * w; }
    }
  }
  if (Math.abs(tot) < 1e-6) return POSES.upright();
  for (const k in acc) {
    if (typeof acc[k] === 'number') acc[k] /= tot;
    else if (TARGETS.has(k)) { const a = acc[k], w = a[3]; acc[k] = Math.abs(w) > 1e-6 ? [a[0] / w, a[1] / w, a[2] / w, w / tot] : [0, 0, 0, 0]; }
    else acc[k] = acc[k].map((x) => x / tot);
  }
  return acc;
}

// ------------------------------------------------------------------------------------ skeleton
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const comb = (a, ka, b, kb) => V3(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb);
/** Rotate a frame {f, u, r}: yaw about u (+ left), then pitch about r (+ forward), then roll about f (+ right). */
function rot(fr, pitch, roll, yaw) {
  let { f, u, r } = fr;
  if (yaw) { const c = Math.cos(yaw * D2R), s = Math.sin(yaw * D2R); const f2 = comb(f, c, r, -s); r = comb(r, c, f, s); f = f2; }
  if (pitch) { const c = Math.cos(pitch * D2R), s = Math.sin(pitch * D2R); const u2 = comb(u, c, f, s); f = comb(f, c, u, -s); u = u2; }
  if (roll) { const c = Math.cos(roll * D2R), s = Math.sin(roll * D2R); const u2 = comb(u, c, r, s); r = comb(r, c, u, -s); u = u2; }
  return { f, u, r };
}
const along = (p, d, len) => V3(p.x + d.x * len, p.y + d.y * len, p.z + d.z * len);
function perp(v, d, fallback) {      // the part of v perpendicular to d, normalised
  let n = along(v, d, -v.dot(d));
  if (n.lengthSq() < 0.01) n = along(fallback, d, -fallback.dot(d));
  return n.normalize();
}

const DEFAULT_STATE = {
  pose: { upright: 1 }, phase: 0, breath: 0, lean: 0, turn: 0, speck: 0, nod: 0, headTurn: 0, slump: 0,
  umbrella: 0, umbrellaTilt: 0, face: 0, color: null, opacity: 1, soft: 0, shadowLength: 4, shadowDir: 0, planted: false, twist: 0,
  rim: null, grip: null, armL: null, phone: false, lines: null, reachL: null, reachR: null,
};

function traitsOf(seed, over = {}) {
  const hero = seed === 'hero' || seed === 'sleeper';
  const rng = createRng(`figure:${seed}`);
  const t = {
    height: hero ? 1 : 0.93 + 0.13 * rng(),
    build: hero ? 1 : 0.88 + 0.3 * rng(),
    coat: hero ? 0.22 : rng.pick([0, 0.12, 0.2, 0.3, 0.42]),
    hair: hero ? 4 : rng.pick([0, 0, 1, 1, 2, 3]),
    bag: hero ? 1 : rng.pick([0, 0, 1, 1, 2, 2, 3]),
    collar: hero ? 0 : rng.pick([0, 0, 0, 0.6, 1]),
  };
  return { ...t, ...over };
}

/**
 * Solve the skeleton: local metres, feet at the origin, facing +X before `turn`.
 * Returns { segs: [[a, b, ra, rb, k]], ell: canopy | null, J: joints, sitting }.
 */
export function figureSkeleton(stateIn = {}, traits = traitsOf('figure')) {
  const st = { ...DEFAULT_STATE, ...stateIn };
  const P = blendPoses(st.pose, st.phase);
  if (st.armL) P.armL = st.armL;
  if (st.grip) P.gripP = st.grip.map((v) => v / traits.height);
  const slump = st.slump || 0, br = st.breath || 0;
  const root = { f: V3(1, 0, 0), u: V3(0, 1, 0), r: V3(0, 0, 1) };
  const pel = rot(root, P.pel[0], P.pel[1], P.pel[2]);
  const hipC = V3(P.hip[0], P.hip[1], P.hip[2]);
  const lum = rot(pel, P.lum[0] + 5 * slump, P.lum[1], P.lum[2]);
  const spine = along(hipC, pel.u, B.lumbar);
  const ch = rot(lum, P.ch[0] + 9 * slump - 3.5 * br, P.ch[1], P.ch[2] + (st.twist || 0));
  const chestJ = along(spine, lum.u, B.thorax);
  const neckB = along(along(chestJ, ch.u, B.neckBase), root.u, P.rise * br * 0.6);
  const nk = rot(ch, P.nk[0] + 10 * slump + 2 * br, P.nk[1], P.nk[2]);
  const desk = clamp01(P.desk || 0), pro = P.protract || 0;
  const neckLen = P.neck > 0.001 ? P.neck : lrp(0.088, B.neck, desk);         // a neck that shows, narrower than the head
  let headJ = along(neckB, nk.u, neckLen);
  let hd = rot(nk, P.hd[0] + 8 * slump + (st.nod || 0), P.hd[1], P.hd[2] + (st.headTurn || 0));
  let headC = along(headJ, hd.u, B.head);
  const rest = clamp01(P.headRest || 0);
  if (rest > 0.001 && br) {
    // a head lying on the folded arms does not ride up and down with the breath: it stays where it lies
    // (the nestle still moves it) and the neck takes up the rise of the back
    const ch0 = rot(lum, P.ch[0] + 9 * slump, P.ch[1], P.ch[2]), nk0 = rot(ch0, P.nk[0] + 10 * slump, P.nk[1], P.nk[2]);
    const hJ0 = along(along(chestJ, ch0.u, B.neckBase), nk0.u, neckLen);
    const hd0 = rot(nk0, P.hd[0] + 8 * slump + (st.nod || 0), P.hd[1], P.hd[2] + (st.headTurn || 0));
    headJ = headJ.lerp(hJ0, rest);
    hd = { f: hd.f.clone().lerp(hd0.f, rest).normalize(), u: hd.u.clone().lerp(hd0.u, rest).normalize(), r: hd.r.clone().lerp(hd0.r, rest).normalize() };
    headC = along(headJ, hd.u, B.head);
  }
  const sw = B.shoulderHalf * (0.94 + 0.06 * traits.build);
  const shBase = along(along(chestJ, ch.u, B.shoulderUp), root.u, P.rise * br);   // the breath lifts the shoulders
  const sh = { L: along(shBase, ch.r, -sw), R: along(shBase, ch.r, sw) };
  const J = { hipC, spine, chestJ, neckB, headJ, headC, shL: sh.L, shR: sh.R };
  // at the desk the shoulder blades slide forward round the ribs as the arms go out onto the table:
  // the arms hang from a point a little ahead of the shoulder line (inside the shoulder's own mass)
  const armRoot = { L: along(along(sh.L, root.f, pro), root.u, -0.3 * pro), R: along(along(sh.R, root.f, pro), root.u, -0.3 * pro) };

  const arm = (side, a) => {
    const S = armRoot[side], sg = side === 'R' ? 1 : -1;
    const cs = Math.cos(a[0] * D2R), sn = Math.sin(a[0] * D2R), ca = Math.cos(a[1] * D2R), sa = Math.sin(a[1] * D2R);
    const d = V3().addScaledVector(ch.u, -cs * ca).addScaledVector(ch.f, sn * ca).addScaledVector(ch.r, sg * sa).normalize();
    const elbow = along(S, d, B.upperArm);
    let n = perp(ch.f, d, ch.u);
    if (a[2]) { const x = V3().crossVectors(d, n); n = comb(n, Math.cos(a[2] * D2R), x, -sg * Math.sin(a[2] * D2R)); }
    const fd = comb(d, Math.cos(a[3] * D2R), n, Math.sin(a[3] * D2R)).normalize();
    const wrist = along(elbow, fd, B.foreArm);
    return { elbow, wrist, tip: along(wrist, fd, B.hand) };
  };
  const leg = (side, l) => {
    const sg = side === 'R' ? 1 : -1;
    const H = along(along(hipC, pel.u, -B.hipDrop), pel.r, sg * B.hipHalf);
    const cs = Math.cos(l[0] * D2R), sn = Math.sin(l[0] * D2R), ca = Math.cos(l[1] * D2R), sa = Math.sin(l[1] * D2R);
    const d = V3().addScaledVector(pel.u, -cs * ca).addScaledVector(pel.f, sn * ca).addScaledVector(pel.r, sg * sa).normalize();
    const knee = along(H, d, B.thigh);
    // the knee folds the shin back under the thigh: the thigh's direction turned about the pelvis's
    // right axis (so a thigh held level puts the shin straight down, whatever the pelvis's pitch)
    const sd = d.clone().applyAxisAngle(pel.r, -l[2] * D2R).normalize();
    const ankle = along(knee, sd, B.shin);
    const ff = perp(pel.f, sd, pel.u);
    const td = comb(ff, Math.cos(l[3] * D2R), sd, Math.sin(l[3] * D2R));
    return { H, knee, ankle, heel: along(along(ankle, ff, -B.heel), sd, 0.03), toe: along(along(ankle, td, B.foot), sd, 0.04) };
  };
  const aL = arm('L', P.armL), aR = arm('R', P.armR), lL = leg('L', P.legL), lR = leg('R', P.legR);

  // stand on the ground
  const all = () => [hipC, spine, chestJ, neckB, headJ, headC, sh.L, sh.R, armRoot.L, armRoot.R, ...Object.values(aL), ...Object.values(aR), ...Object.values(lL), ...Object.values(lR)];
  if (P.ground > 0) {
    const dy = (B.ankle - Math.min(lL.ankle.y, lR.ankle.y)) * P.ground;
    for (const p of all()) p.y += dy;
  }
  // the right hand on the strap (two-bone IK), blended by the pose's grip weight. Planted (st.planted): the
  // body sways from its feet, so the hand is solved to where the grip will be after that sway
  const grip = V3(P.gripP[0], P.gripP[1], P.gripP[2]);
  const leanA = (st.lean || 0) * D2R;
  if (st.planted && leanA) { const c = Math.cos(leanA), s = Math.sin(leanA), x = grip.x, y = grip.y; grip.x = x * c - y * s; grip.y = x * s + y * c; }
  const ik = (S, T, pole, a1, a2) => {
    const to = V3().subVectors(T, S);
    const L = Math.min(to.length(), (a1 + a2) * 0.999);
    to.normalize();
    const cosA = Math.min(1, Math.max(-1, (a1 * a1 + L * L - a2 * a2) / (2 * a1 * L)));
    const pp = perp(pole, to, ch.f);
    const elbow = along(along(S, to, a1 * cosA), pp, a1 * Math.sqrt(1 - cosA * cosA));
    const fd = V3().subVectors(along(S, to, L), elbow).normalize();
    const wrist = along(elbow, fd, B.foreArm);
    return { elbow, wrist, tip: along(wrist, fd, B.hand) };
  };
  if (P.grip > 0.001) {
    const k = Math.min(1, P.grip);
    const g = ik(sh.R, grip, V3().addScaledVector(ch.f, 0.5).addScaledVector(ch.u, -0.4).addScaledVector(ch.r, 0.6), B.upperArm, B.foreArm + B.hand * 0.55);
    for (const key of ['elbow', 'wrist', 'tip']) aR[key].lerp(g[key], k);
  }
  for (const [key, a, S0, sg] of [['deskL', aL, armRoot.L, -1], ['deskR', aR, armRoot.R, 1]]) {
    const d = P[key];
    if (!(d[3] > 0.001)) continue;
    const pl = key === 'deskL' ? P.poleL : P.poleR;
    const g = ik(S0, V3(d[0], d[1], d[2]), V3(pl[0], pl[1], pl[2]), B.upperArm, B.foreArm + B.hand * 0.6);
    for (const k of ['elbow', 'wrist', 'tip']) a[k].lerp(g[k], Math.min(1, d[3]));
  }
  // a hand sent somewhere (to the face, to a switch): state.reachL / reachR = [x, y, z, weight]
  for (const [key, a, S0, sg] of [['reachL', aL, armRoot.L, -1], ['reachR', aR, armRoot.R, 1]]) {
    const d = st[key];
    if (!d || !(d[3] > 0.001)) continue;
    const T = V3(d[0], d[1], d[2]);
    const pole = (w) => V3().addScaledVector(root.u, lrp(-1, -0.45, w)).addScaledVector(root.r, 0.5 * sg).addScaledVector(root.f, lrp(0.2, 0.9, w));
    let g = ik(S0, T, pole(0), B.upperArm, B.foreArm + B.hand * 0.6);
    // at the desk (top 0.74 m) an elbow that would drop through the table top goes forward onto it instead
    const fw = desk * clamp01((0.77 - g.elbow.y) / 0.06);
    if (fw > 0) g = ik(S0, T, pole(fw), B.upperArm, B.foreArm + B.hand * 0.6);
    for (const k of ['elbow', 'wrist', 'tip']) a[k].lerp(g[k], Math.min(1, d[3]));
  }
  // forearms planted on the desk (elbowL / elbowR with deskL / deskR): the elbow and the forearm lie still
  // on the table whatever the shoulders do (the breath, a start); the upper arm swings between the shoulder
  // and the fixed elbow, its root sliding a little round the shoulder so that its length holds. A hand sent
  // somewhere (reachL / reachR, by its weight) turns the forearm about the planted elbow.
  for (const [side, a] of [['L', aL], ['R', aR]]) {
    const e = P['elbow' + side], w = clamp01(e[3]);
    if (!(w > 0.001)) continue;
    const E = V3(e[0], e[1], e[2]), hT = P['desk' + side], T = V3(hT[0], hT[1], hT[2]);
    const rr = st['reach' + side];
    if (rr && rr[3] > 0.001) T.lerp(V3(rr[0], rr[1], rr[2]), clamp01(rr[3]));
    const fd = V3().subVectors(T, E).normalize();
    a.elbow.lerp(E, w); a.wrist.lerp(along(E, fd, B.foreArm), w); a.tip.lerp(along(E, fd, B.foreArm + B.hand), w);
    const R0 = armRoot[side];
    R0.lerp(along(E, V3().subVectors(R0, E).normalize(), B.upperArm), w);
  }
  // feet planted on steps (climb): the legs follow their ankles
  for (const [key, l, sg] of [['footL', lL, -1], ['footR', lR, 1]]) {
    const d = P[key];
    if (!(d[3] > 0.001)) continue;
    const T = V3(d[0], d[1], d[2]), to = V3().subVectors(T, l.H);
    const L = Math.min(to.length(), (B.thigh + B.shin) * 0.999);
    to.normalize();
    const cosA = Math.min(1, Math.max(-1, (B.thigh * B.thigh + L * L - B.shin * B.shin) / (2 * B.thigh * L)));
    const pp = perp(V3().addScaledVector(root.f, 1).addScaledVector(root.r, 0.12 * sg), to, root.u);
    const knee = along(along(l.H, to, B.thigh * cosA), pp, B.thigh * Math.sqrt(1 - cosA * cosA));
    const ankle = along(l.H, to, L);
    const sd2 = V3().subVectors(ankle, knee).normalize();
    const lifted = clamp01((ankle.y - B.ankle - Math.min(lL.ankle.y, 1e9) * 0) / 0.2);
    const tilt = (1 - clamp01(P.footFlat || 0)) * 0.35 * clamp01((d[1] - B.ankle + STAIR.rise) / 0.2) * clamp01((STAIR.rise + B.ankle - d[1] + 0.12) / 0.12);
    const tdir = V3().addScaledVector(root.f, 1).addScaledVector(root.u, -tilt).normalize();
    const g = { knee, ankle, heel: along(along(ankle, tdir, -B.heel), root.u, -0.035), toe: along(along(ankle, tdir, B.foot), root.u, -0.03) };
    for (const k of ['knee', 'ankle', 'heel', 'toe']) l[k].lerp(g[k], Math.min(1, d[3]));
  }
  // the umbrella: held in the left hand in front of the chest
  let ell = null, umb = null;
  const open = Math.max(0, st.umbrella || 0);
  if (open > 0.001) {
    const tilt = (st.umbrellaTilt || 0) * D2R;
    const sdir = V3().addScaledVector(root.u, Math.cos(tilt)).addScaledVector(root.f, Math.sin(tilt)).normalize();
    const handle = along(along(along(chestJ, root.f, 0.2), root.u, 0.06), ch.r, -0.1);
    const g = ik(sh.L, handle, V3().addScaledVector(ch.u, -1).addScaledVector(ch.r, -0.4), B.upperArm, B.foreArm + B.hand * 0.5);
    const k = Math.min(1, open * 6);
    for (const key of ['elbow', 'wrist', 'tip']) aL[key].lerp(g[key], k);
    const o = Math.min(1, Math.max(0, (open - 0.03) / 0.97));
    umb = { handle: aL.wrist, sdir, top: along(aL.wrist, sdir, 0.72), centre: along(aL.wrist, sdir, 0.6), open: o, R: 0.05 + 0.5 * o, h: 0.27 };
  }
  J.grip = grip; J.handL = aL.tip; J.handR = aR.tip; J.footL = lL.ankle; J.footR = lR.ankle; J.elbowL = aL.elbow; J.elbowR = aR.elbow;

  // ---- capsules [a, b, ra, rb, k, group]: a clothed body, drawn as few shapes. group 1 = the head,
  // 2 = the left arm, 3 = the right arm (their contours can be drawn inside the mass: `lines`)
  const bu = traits.build, coat = traits.coat;
  const segs = [];
  let grp = 0;
  const S = (a, b, ra, rb = ra, k = 0.03) => segs.push([a, b, ra, rb, k, grp]);
  const chestTop = along(chestJ, ch.u, 0.1);
  const standing = Math.min(1, Math.max(0, (hipC.y - 0.6) / 0.25));
  const cw = standing * 0.022 * Math.min(coat, 0.3) / 0.3;                               // a coat thickens everything (off at the desk)
  S(hipC, spine, lrp(0.113 * bu + cw, 0.1, desk), 0.108 * bu + cw, 0.06);             // belly (slimmer seated at the desk)
  S(spine, chestTop, 0.108 * bu + cw, 0.124 * bu + cw, 0.06);                            // rib cage
  S(lL.H, lR.H, lrp(0.1 * bu + cw, 0.085, desk), lrp(0.1 * bu + cw, 0.085, desk), 0.06); // pelvis
  if (desk > 0.5) {
    // at the desk (seen side-on, the sleeper's measured hump): the shoulder line and one trapezius into the neck
    S(sh.L, sh.R, 0.066 + 0.012 * bu, 0.066 + 0.012 * bu, 0.07);
    S(along(along(chestJ, ch.u, 0.15), ch.f, -0.03), along(neckB, nk.u, 0.012), 0.066, 0.05, 0.05);
    S(neckB, headJ, 0.049, 0.045, 0.03);                                                 // neck
  } else {
    // standing or seated in a crowd: rounded shoulders a little below the line of the joints, and the
    // trapezius sloping down from each side of the neck to them (no square yoke), under a neck that
    // shows: narrower than the head, the head carried forward on it
    S(along(sh.L, ch.u, -0.02), along(sh.R, ch.u, -0.02), 0.056 + 0.01 * bu + 0.4 * cw, 0.056 + 0.01 * bu + 0.4 * cw, 0.06);
    for (const sd of [-1, 1]) S(along(along(neckB, ch.u, -0.012), ch.r, 0.034 * sd), sd < 0 ? sh.L : sh.R, 0.05 + 0.4 * cw, 0.047 + 0.4 * cw, 0.05);
    S(along(neckB, ch.u, -0.02), headJ, 0.044, 0.04, 0.025);                             // neck
  }
  if ((traits.collar || 0) > 0.01 && standing > 0.3) {                                   // a coat collar turned up at the back of the neck
    const c0 = along(along(neckB, ch.u, -0.015), ch.f, -0.022), c1 = along(along(neckB, nk.u, 0.015 + 0.04 * traits.collar), ch.f, -0.03);
    S(c0, c1, 0.06, 0.052, 0.02);
  }
  grp = 1;
  // THE HEAD (everyone): a human head, not a ball or a helmet, about 1/7.4 of the height. In the head's frame
  // (m from headC: f forward, u up, r to the right). No face is drawn: the front contour carries the slope
  // of the forehead, a small nose, the lips and the chin, and the jaw runs back to under the ear, where the
  // narrower neck meets the head under the back half of the skull. The skull is one smooth round form,
  // convex all over the top and back, its short hair a thin even layer in its radius; with the face below
  // the brow it makes an egg a little longer front to back than it is tall. Hair styles only follow it:
  // 0 and 4 (the hero) short, 1 a bob (a little fuller at the back, ending above the collar), 2 a snug cap
  // with a short peak, 3 a ponytail
  const face = along(along(headC, hd.f, 0.04), hd.u, -0.045);
  const hp = (F, U, R = 0) => along(along(along(headC, hd.f, F), hd.u, U), hd.r, R);
  S(hp(-0.012, 0.02), hp(-0.012, 0.02), 0.098, 0.098, 0.03);                             // the skull under short hair
  if (traits.hair === 1) S(hp(-0.014, 0.02), hp(-0.04, -0.05), 0.101, 0.07, 0.03);       // a bob
  if (traits.hair === 2) {                                                               // a cap: snug on the skull, a short peak
    S(hp(-0.014, 0.024), hp(0.014, 0.028), 0.1, 0.096, 0.02);
    S(hp(0.07, 0.04), hp(0.128, 0.034), 0.012, 0.008, 0.012);
  }
  if (traits.hair === 3) S(hp(-0.088, 0.045), along(hp(-0.112, 0.01), root.u, -0.08), 0.03, 0.014, 0.025);   // a ponytail, hanging
  S(hp(0.044, -0.02), hp(0.05, -0.083), 0.05, 0.04, 0.03);                               // the face below the brow
  S(hp(0.055, -0.108), hp(-0.015, -0.074), 0.02, 0.03, 0.025);                           // the jaw back to under the ear
  grp = 0;                                                                               // (no contour lines round the small features)
  S(hp(0.07, -0.014), hp(0.1, -0.039), 0.022, 0.011, 0.016);                             // nose: small, from a broad root
  S(hp(0.084, -0.058), hp(0.08, -0.1), 0.015, 0.019, 0.014);                             // lips, chin
  const sl = 0.008 + 0.6 * cw;
  for (const a of [[armRoot.L, aL, 0, 2], [armRoot.R, aR, Math.min(1, P.grip), 3]]) {
    const thin = 1 - 0.34 * a[2], sl2 = sl * (1 - 0.8 * a[2]);         // a raised arm: the sleeve falls back
    grp = a[3];
    // at the desk a slimmer elbow (it is the corner that shows on the table) and a sleeve tapering to a
    // slim wrist, so the hand reads as a hand, not a mitten
    S(a[0], a[1].elbow, (0.05 + sl2) * thin, lrp((0.043 + sl2) * thin, 0.044, desk), 0.035);
    S(a[1].elbow, a[1].wrist, lrp((0.043 + sl2) * thin, 0.044, desk), lrp((0.036 + sl2) * thin, 0.023, desk), 0.02);
    if (desk > 0.001) {
      // a relaxed hand in one mass: a wedge, thickest at the heel of the palm just past the narrower
      // wrist, tapering to the fingertips, which curl a little; wrist to fingertip 0.18 m (3/4 of the
      // head's height). No fingers, no thumb.
      const fd = V3().subVectors(a[1].tip, a[1].wrist).normalize();
      const curl = perp(V3().copy(root.u).multiplyScalar(-1), fd, ch.u);
      const fc = V3().copy(fd).addScaledVector(curl, 0.22).normalize();
      const heel = along(a[1].wrist, fd, 0.022 * desk), knuck = along(a[1].wrist, fd, lrp(B.hand, 0.1, desk));
      grp = 0;                                                                           // (no contour lines inside the hand)
      S(heel, knuck, lrp(0.033, 0.027, desk), lrp(0.027, 0.021, desk), lrp(0.025, 0.014, desk));
      S(knuck, along(knuck, fc, 0.072 * desk), 0.02, 0.008, 0.016);
    } else S(a[1].wrist, a[1].tip, 0.033, 0.027, 0.025);
  }
  grp = 0;
  if (st.phone) {                                                                        // a phone, read in the left hand
    const up = perp(root.u, V3().subVectors(aL.tip, aL.wrist).normalize(), ch.u);
    S(along(aL.tip, up, -0.02), along(aL.tip, up, 0.11), 0.014, 0.012, 0.0);
  }
  for (const l of [lL, lR]) {
    // seated at the desk the legs are drawn slimmer (a thigh about 0.6 of the head's width), so the lap,
    // the level thigh, the knee and the dropping shin read as a seated body, not one mass
    S(l.H, l.knee, lrp(0.086 * bu, 0.063, desk), lrp(0.064, 0.048, desk), lrp(0.045, 0.03, desk));
    S(l.knee, l.ankle, lrp(0.06, 0.047, desk), lrp(0.046, 0.035, desk), lrp(0.03, 0.012, desk));
    S(l.heel, l.toe, lrp(0.05, 0.042, desk), lrp(0.04, 0.026, desk), lrp(0.03, 0.015, desk));
  }
  if (coat > 0.02 && standing > 0.05) {                                                  // the coat's skirt
    const len = coat * (0.35 + 0.65 * standing);
    const hem = along(along(hipC, pel.u, -len), pel.f, 0.012);
    S(hipC, hem, 0.12 * bu + cw, 0.116 * bu + cw + 0.14 * len, 0.07);
  }
  const bagW = standing;                                                                 // no bag at the desk
  if (traits.bag === 1 && bagW > 0.3) { const c = along(along(along(hipC, pel.f, -0.14), pel.u, -0.07), pel.r, -0.16); S(along(c, pel.u, 0.07), along(c, pel.u, -0.09), 0.075, 0.085, 0.02); S(along(sh.R, ch.u, 0.05), c, 0.012, 0.012, 0.0); }
  if (traits.bag === 2 && bagW > 0.3) { const c = along(along(chestJ, ch.f, -0.175 - cw), ch.u, 0.02); S(along(c, ch.u, 0.13), along(c, ch.u, -0.14), 0.072, 0.092, 0.04); }
  if (traits.bag === 3 && bagW > 0.3) { const c = along(aL.tip, root.u, -0.22); S(along(c, root.f, -0.1), along(c, root.f, 0.1), 0.1, 0.1, 0.01); S(aL.tip, c, 0.009, 0.009, 0.0); }
  if (umb) {
    S(along(umb.handle, umb.sdir, -0.06), umb.top, 0.011, 0.009, 0.0);
    if (umb.open < 0.999) S(along(umb.handle, umb.sdir, 0.25), umb.top, 0.03 * (1 - umb.open) + 0.004, 0.012, 0.0);
    ell = { c: umb.centre, axis: umb.sdir, R: umb.R, h: umb.h };
  }
  // the ear: a small mark on the side of the head (drawn with `lines`)
  const earL = along(along(along(headC, hd.f, -0.012), hd.u, -0.012), hd.r, -0.09), earR = along(earL, hd.r, 0.18);

  // ---- lean (about the grip for strap poses, about the feet otherwise), then turn about +Y
  const pts = new Set(all());
  pts.add(grip); pts.add(face); pts.add(chestTop); pts.add(earL); pts.add(earR);
  for (const s of segs) { pts.add(s[0]); pts.add(s[1]); }
  if (ell) pts.add(ell.c);
  const lean = (st.lean || 0) * D2R;
  if (lean) {
    const g = st.planted ? 0 : Math.min(1, P.grip), px = grip.x * g, py = grip.y * g, a = g > 0.5 ? lean : -lean;
    const c = Math.cos(a), s = Math.sin(a);
    const keep = st.planted ? [lL, lR].map((l) => ({ ankle: l.ankle.clone(), heel: l.heel.clone(), toe: l.toe.clone() })) : null;
    for (const p of pts) { const x = p.x - px, y = p.y - py; p.x = px + x * c - y * s; p.y = py + x * s + y * c; }
    if (ell) { const x = ell.axis.x, y = ell.axis.y; ell.axis.x = x * c - y * s; ell.axis.y = x * s + y * c; }
    if (keep) {
      // planted: the feet do not move; the body above sways and the knees take it up (each leg re-solved
      // from its swayed hip to its ankle on the floor)
      [lL, lR].forEach((l, k) => {
        l.ankle.copy(keep[k].ankle); l.heel.copy(keep[k].heel); l.toe.copy(keep[k].toe);
        const to = V3().subVectors(l.ankle, l.H), L = Math.min(to.length(), (B.thigh + B.shin) * 0.999);
        to.normalize();
        const cosA = Math.min(1, Math.max(-1, (B.thigh * B.thigh + L * L - B.shin * B.shin) / (2 * B.thigh * L)));
        const pp = perp(V3().addScaledVector(root.f, 1).addScaledVector(root.r, 0.12 * (k ? 1 : -1)), to, root.u);
        l.knee.copy(along(along(l.H, to, B.thigh * cosA), pp, B.thigh * Math.sqrt(1 - cosA * cosA)));
      });
    }
  }
  const turn = (st.turn || 0) * D2R, hs = traits.height;
  const ct = Math.cos(turn), sn = Math.sin(turn);
  const spin = (p) => { const x = p.x, z = p.z; p.x = (x * ct + z * sn); p.z = (-x * sn + z * ct); };
  for (const p of pts) { spin(p); p.multiplyScalar(hs); }
  for (const s of segs) { s[2] *= hs; s[3] *= hs; s[4] *= hs; }
  const left = V3().copy(ch.r).multiplyScalar(-1), up = V3().copy(ch.u), fwd = V3().copy(hd.f);
  spin(left); spin(fwd); spin(up);
  if (ell) { spin(ell.axis); ell.R *= hs; ell.h *= hs; }
  const hleft = V3().copy(hd.r).multiplyScalar(-1); spin(hleft);
  J.left = left; J.chestUp = up; J.headFwd = fwd; J.headR = B.headR * hs; J.earL = earL; J.earR = earR; J.headLeft = hleft;
  // the speck sits on top of the left shoulder, a little toward the neck
  J.speck = along(sh.L, left, -0.02 * hs);                    // the left shoulder; the crest above it is found per view
  return { segs, ell, J, pose: P };
}

// ------------------------------------------------------------------------------------ drawing
export const FIGURE_MAX_SEGS = 32;
const VERT = /* glsl */ `
uniform vec3 uC, uRt, uUp;
uniform vec4 uBox;
varying vec2 vP;
void main() {
  vec2 q = mix(uBox.xy, uBox.zw, position.xy);
  vP = q;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uC + uRt * q.x + uUp * q.y, 1.0);
}`;
const FRAG = /* glsl */ `
#define N ${FIGURE_MAX_SEGS}
uniform vec4 uSegA[N];           // a.xy, b.xy (plane metres)
uniform vec4 uSegB[N];           // ra, rb, k, group (1 head, 2 left arm, 3 right arm)
uniform int uCount;
uniform vec4 uEll;               // canopy centre.xy, half width, on
uniform vec4 uEllB;              // axis.xy (unit, in the plane), b toward the axis, b away from it
uniform vec3 uInk, uSpeckCol, uPale, uRimCol;
uniform vec4 uRim;               // direction to the light in the picture plane (unit), width (m), amount
uniform vec4 uLine;              // contours inside the mass: head, left arm, right arm on/off; width (m)
uniform vec4 uLineCol;           // rgb, amount
uniform vec4 uEar;               // xy, radius, amount
uniform vec2 uEarDir;            // the head's forward direction in the plane
uniform vec2 uLineDir;           // the side of a form that gets its contour (away from the light)
uniform float uRimFloor;         // the rim light reaches down to this height in the plane (m)
uniform float uOpacity, uSoft;
uniform vec4 uSpeck;             // xy, radius in pixels, amount
uniform vec4 uHead;              // xy, r, pale amount
varying vec2 vP;
float sdCone(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  p -= a; b -= a;
  float h = dot(b, b), d = ra - rb;
  if (h <= d * d + 1e-8) return length(ra > rb ? p : p - b) - max(ra, rb);
  vec2 q = vec2(dot(p, vec2(b.y, -b.x)), dot(p, b)) / h;
  q.x = abs(q.x);
  vec2 c = vec2(sqrt(h - d * d), d);
  float k = c.x * q.y - c.y * q.x, m = dot(c, q), n = dot(q, q);
  if (k < 0.0) return sqrt(h * n) - ra;
  if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
  return m - ra;
}
float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float figure(vec2 p) {
  float d = 1e3;
  for (int i = 0; i < N; i++) {
    if (i >= uCount) break;
    vec4 A = uSegA[i], Bq = uSegB[i];
    d = smin(d, sdCone(p, A.xy, A.zw, Bq.x, Bq.y), Bq.z);
  }
  if (uEll.w > 0.5) {
    vec2 q = p - uEll.xy;
    vec2 e = vec2(dot(q, vec2(uEllB.y, -uEllB.x)), dot(q, uEllB.xy));
    float b = max(e.y > 0.0 ? uEllB.z : uEllB.w, 0.004);
    d = min(d, (length(e / vec2(uEll.z, b)) - 1.0) * min(uEll.z, b));
  }
  return d;
}
vec3 groups(vec2 p) {
  vec3 g = vec3(1e3);
  for (int i = 0; i < N; i++) {
    if (i >= uCount) break;
    vec4 A = uSegA[i], Bq = uSegB[i];
    if (Bq.w < 0.5) continue;
    float di = sdCone(p, A.xy, A.zw, Bq.x, Bq.y);
    if (Bq.w < 1.5) g.x = smin(g.x, di, Bq.z); else if (Bq.w < 2.5) g.y = smin(g.y, di, Bq.z); else g.z = smin(g.z, di, Bq.z);
  }
  return g;
}
void main() {
  float d = figure(vP);
  float px = max(max(fwidth(vP.x), fwidth(vP.y)), 1e-6);
  float cov = 1.0 - smoothstep(-0.6 * px - uSoft, 0.6 * px + uSoft, d);
  if (cov * uOpacity < 0.004) discard;
  vec3 col = uInk;
  if (uRim.w > 0.0) {
    // light from behind catching the edge that faces it (the lamp on the sleeper's back, the exit on shoulders)
    float e = max(px, 0.002);
    vec2 g = normalize(vec2(figure(vP + vec2(e, 0.0)) - d, figure(vP + vec2(0.0, e)) - d) + 1e-7);
    float rim = smoothstep(-uRim.z, -0.2 * uRim.z, d) * smoothstep(0.15, 0.75, dot(g, uRim.xy)) * smoothstep(uRimFloor - 0.02, uRimFloor + 0.02, vP.y);
    col = mix(col, uRimCol, uRim.w * rim);
  }
  if (uLineCol.a > 0.0) {
    // the contours a painter would leave inside the mass: where the head lies on the arm, the arm on the body
    float lw = max(uLine.w, 1.2 * px);
    float inside = 1.0 - smoothstep(-3.2 * lw, -1.4 * lw, d);
    float e = max(px, 0.002);
    vec3 g0 = groups(vP), gx = groups(vP + vec2(e, 0.0)) - g0, gy = groups(vP + vec2(0.0, e)) - g0;
    // only the side of each form that turns away from the light: the line under the head, along the arm
    vec3 away = vec3(dot(normalize(vec2(gx.x, gy.x) + 1e-7), uLineDir), dot(normalize(vec2(gx.y, gy.y) + 1e-7), uLineDir), dot(normalize(vec2(gx.z, gy.z) + 1e-7), uLineDir));
    vec3 g = abs(g0);
    vec3 l3 = (1.0 - smoothstep(0.5 * lw - px, 0.5 * lw + px, g)) * uLine.xyz * smoothstep(0.05, 0.6, away);
    float line = max(l3.x, max(l3.y, l3.z)) * inside;
    if (uEar.w > 0.0) {
      vec2 q = vP - uEar.xy;
      float ring = 1.0 - smoothstep(0.5 * lw - px, 0.5 * lw + px, abs(length(q) - uEar.z));
      line = max(line, uEar.w * ring * (1.0 - smoothstep(-0.1, 0.35, dot(q, uEarDir) / max(uEar.z, 1e-4))) * inside);
    }
    col = mix(col, uLineCol.rgb, line * uLineCol.a);
  }
  if (uHead.w > 0.0) col = mix(col, uPale, uHead.w * (1.0 - smoothstep(uHead.z * 0.8 - px, uHead.z * 0.8 + px, length(vP - uHead.xy))));
  if (uSpeck.w > 0.0) {
    float r = uSpeck.z * px;
    float s = uSpeck.w * (1.0 - smoothstep(r - 0.5 * px, r + 0.5 * px, length(vP - uSpeck.xy)));
    col = mix(col, uSpeckCol, s);
    cov = max(cov, s);
  }
  gl_FragColor = vec4(col, cov * uOpacity);
}`;

// the same distance field in JS (to stand the speck on the silhouette's edge)
function sdCone2(px, py, ax, ay, bx, by, ra, rb) {
  px -= ax; py -= ay; bx -= ax; by -= ay;
  const h = bx * bx + by * by, d = ra - rb;
  if (h <= d * d + 1e-8) return Math.hypot(ra > rb ? px : px - bx, ra > rb ? py : py - by) - Math.max(ra, rb);
  const qx = Math.abs((px * by - py * bx) / h), qy = (px * bx + py * by) / h;
  const cx = Math.sqrt(h - d * d), k = cx * qy - d * qx;
  if (k < 0) return Math.sqrt(h * (qx * qx + qy * qy)) - ra;
  if (k > cx) return Math.sqrt(h * (qx * qx + qy * qy + 1 - 2 * qy)) - rb;
  return cx * qx + d * qy - ra;
}
function sdFigure2(A, Bv, n, x, y) {
  let d = 1e3;
  for (let i = 0; i < n; i++) {
    const a = A[i], b = Bv[i], di = sdCone2(x, y, a.x, a.y, a.z, a.w, b.x, b.y), k = b.z;
    if (k <= 0) d = Math.min(d, di);
    else { const h = Math.max(k - Math.abs(d - di), 0) / k; d = Math.min(d, di) - h * h * k * 0.25; }
  }
  return d;
}

/** Ink black as scene radiance (a little under #0D0C0E, so the grade's lift lands on it). */
const INK = linear(PALETTE.jiao).map((c) => c * 0.6);
const SPECK = linear(PALETTE.wingBlue).map((c) => c * 3.2);

export function createFigure({ seed = 'figure', ...over } = {}) {
  const traits = traitsOf(seed, over);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0.5, 0.5, 0);
  const uniforms = {
    uC: { value: new THREE.Vector3() }, uRt: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
    uBox: { value: new THREE.Vector4(-1, 0, 1, 2) },
    uSegA: { value: Array.from({ length: FIGURE_MAX_SEGS }, () => new THREE.Vector4()) },
    uSegB: { value: Array.from({ length: FIGURE_MAX_SEGS }, () => new THREE.Vector4()) },
    uCount: { value: 0 },
    uEll: { value: new THREE.Vector4() }, uEllB: { value: new THREE.Vector4(0, 1, 0, 0) },
    uInk: { value: new THREE.Vector3(...INK) }, uSpeckCol: { value: new THREE.Vector3(...SPECK) },
    uPale: { value: new THREE.Vector3(0.55, 0.53, 0.5) },
    uOpacity: { value: 1 }, uSoft: { value: 0 },
    uSpeck: { value: new THREE.Vector4() }, uHead: { value: new THREE.Vector4() },
    uRim: { value: new THREE.Vector4(0, 1, 0.02, 0) }, uRimCol: { value: new THREE.Vector3(1, 1, 1) },
    uLine: { value: new THREE.Vector4(1, 1, 1, 0.005) }, uLineCol: { value: new THREE.Vector4(0.2, 0.2, 0.2, 0) },
    uEar: { value: new THREE.Vector4() }, uEarDir: { value: new THREE.Vector2(1, 0) }, uLineDir: { value: new THREE.Vector2(-0.6, -0.8) }, uRimFloor: { value: -1e3 },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'figure', uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    alphaToCoverage: true, transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `figure-${seed}`;
  mesh.frustumCulled = false;

  const state = { ...DEFAULT_STATE };
  let sk = null, dirty = true, ground = false, rimAbove = -1e3;
  const solve = () => { if (dirty || !sk) { sk = figureSkeleton(state, traits); dirty = false; } return sk; };

  const inv = new THREE.Matrix3(), R = new THREE.Vector3(), U = new THREE.Vector3(), F = new THREE.Vector3(), C = new THREE.Vector3();
  const size = new THREE.Vector2(), tmp = new THREE.Vector3();
  function sync(camera, hpx) {
    const s = solve();
    if (ground) {
      // the silhouette as the sun sees it, laid on the ground: R across, U in the light's image plane
      const az = state.shadowDir * D2R, len = Math.max(0.05, state.shadowLength);
      const A = tmp.set(Math.cos(az), 0, -Math.sin(az));                    // where the shadow falls
      const l = F.set(-A.x * len, 1, -A.z * len).normalize();               // toward the light
      R.set(-A.z, 0, A.x);
      U.crossVectors(l, R).normalize();
      const k = A.dot(U);
      C.set(0, 0.002, 0);
      project(s, R, U, C, true);
      uniforms.uRt.value.copy(R);
      uniforms.uUp.value.copy(A).multiplyScalar(1 / k);
      // x/y scales differ on the ground: flip the box if k < 0 so the quad stays well formed
      if (k < 0) { const b = uniforms.uBox.value; const y0 = b.y; b.y = b.w; b.w = y0; }
      uniforms.uSpeck.value.w = 0; uniforms.uHead.value.w = 0; uniforms.uLineCol.value.w = 0;
    } else {
      // a screen-aligned billboard: the camera's right and up, in the mesh's own space
      inv.setFromMatrix4(mesh.matrixWorld).invert();
      const e = camera.matrixWorld.elements;
      R.set(e[0], e[1], e[2]).applyMatrix3(inv).normalize();
      U.set(e[4], e[5], e[6]).applyMatrix3(inv).normalize();
      if (mesh.matrixWorld.determinant() < 0) U.multiplyScalar(-1);            // a mirrored mesh (scale.y < 0) draws the figure turned over: a reflection
      C.set(0, 0.9 * traits.height, 0);
      project(s, R, U, C);
      uniforms.uRt.value.copy(R);
      uniforms.uUp.value.copy(U);
      uniforms.uRimFloor.value = rimAbove - C.y;                          // (upright billboards: plane y = height - C.y)
      F.crossVectors(R, U);                                                  // toward the camera
      // the speck: on the left shoulder when that shoulder is not behind the body
      const vis = Math.min(1, Math.max(0, (s.J.left.dot(F) + 0.25) / 0.2));
      let sx = tmp.subVectors(s.J.speck, C).dot(R), sy = tmp.dot(U);
      if (state.speck > 0 && Math.abs(F.y) < 0.7) {
        // climb to the silhouette's edge above the shoulder (at most 14 cm): the grain rests on top
        let up = 0;
        for (let i = 0; i < 12 && up < 0.14 * traits.height; i++) {
          const d = sdFigure2(uniforms.uSegA.value, uniforms.uSegB.value, uniforms.uCount.value, sx, sy + up);
          if (d > -0.004) break;
          up += Math.max(-d * 0.9, 0.004);
        }
        // ... and sit just inside the edge (3 px), so the grain is blue on black, not lost in the rim
        const e2 = camera.matrixWorld.elements, me = mesh.matrixWorld.elements;
        const dist = Math.abs((me[12] - e2[12]) * e2[8] + (me[13] - e2[13]) * e2[9] + (me[14] - e2[14]) * e2[10]);
        const sc = Math.cbrt(Math.abs(mesh.matrixWorld.determinant())) || 1;
        const mpp = (camera.isPerspectiveCamera ? 2 * dist * Math.tan((camera.fov * D2R) / 2) : (camera.top - camera.bottom) / camera.zoom) / hpx / sc;
        sy += Math.max(0, Math.min(up, 0.14 * traits.height) - 3.2 * mpp);
      }
      uniforms.uSpeck.value.set(sx, sy, 1.3 * (hpx / 1080), state.speck * vis);
      const ln = state.lines;
      if (ln && (ln.amount ?? 1) > 0) {
        const side = s.J.left.dot(F), hside = s.J.headLeft.dot(F);
        uniforms.uLine.value.set(ln.head === false ? 0 : 1, ln.arms === false ? 0 : side > 0.15 ? 1 : 0, ln.arms === false ? 0 : side < -0.15 ? 1 : 0, ln.width ?? 0.005);
        const lc = ln.color || [0.2, 0.2, 0.2];
        uniforms.uLineCol.value.set(lc[0], lc[1], lc[2], ln.amount ?? 1);
        const ear = hside > 0 ? s.J.earL : s.J.earR;
        const fx = s.J.headFwd.dot(R), fy = s.J.headFwd.dot(U), fl = Math.hypot(fx, fy) || 1;
        uniforms.uEar.value.set(tmp.subVectors(ear, C).dot(R), tmp.dot(U), 0.03 * traits.height, ln.ear === false ? 0 : Math.min(1, Math.max(0, (Math.abs(hside) - 0.45) / 0.2)));
        uniforms.uEarDir.value.set(fx / fl, fy / fl);
        const ld = ln.dir || [-0.6, -0.8], ll = Math.hypot(ld[0], ld[1]) || 1;
        uniforms.uLineDir.value.set(ld[0] / ll, ld[1] / ll);
      } else uniforms.uLineCol.value.w = 0;
      const hr = s.J.headR;
      uniforms.uHead.value.set(tmp.subVectors(s.J.headC, C).dot(R), tmp.dot(U), hr, state.face);
    }
    uniforms.uC.value.copy(C);
  }
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const rt = renderer.getRenderTarget();
    sync(camera, rt ? rt.height : renderer.getDrawingBufferSize(size).y);
  };

  const a2 = new THREE.Vector2(), b2 = new THREE.Vector2();
  function project(s, Rv, Uv, Cv, noCanopy = false) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const n = Math.min(s.segs.length, FIGURE_MAX_SEGS);
    for (let i = 0; i < n; i++) {
      const [a, b, ra, rb, k, group] = s.segs[i];
      a2.set(tmp.subVectors(a, Cv).dot(Rv), tmp.dot(Uv));
      b2.set(tmp.subVectors(b, Cv).dot(Rv), tmp.dot(Uv));
      uniforms.uSegA.value[i].set(a2.x, a2.y, b2.x, b2.y);
      uniforms.uSegB.value[i].set(ra, rb, k, group || 0);
      const r = Math.max(ra, rb);
      x0 = Math.min(x0, a2.x - r, b2.x - r); x1 = Math.max(x1, a2.x + r, b2.x + r);
      y0 = Math.min(y0, a2.y - r, b2.y - r); y1 = Math.max(y1, a2.y + r, b2.y + r);
    }
    uniforms.uCount.value = n;
    if (s.ell && !noCanopy) {
      const e = s.ell;
      const cx = tmp.subVectors(e.c, Cv).dot(Rv), cy = tmp.dot(Uv);
      let ax = e.axis.dot(Rv), ay = e.axis.dot(Uv);
      const sin = Math.min(1, Math.hypot(ax, ay)), cos = Math.sqrt(Math.max(0, 1 - sin * sin));
      if (sin > 1e-3) { ax /= sin; ay /= sin; } else { ax = 0; ay = 1; }
      uniforms.uEll.value.set(cx, cy, e.R, 1);
      uniforms.uEllB.value.set(ax, ay, e.R * cos + e.h * sin * (e.R / 0.55), e.R * cos);
      x0 = Math.min(x0, cx - e.R); x1 = Math.max(x1, cx + e.R); y0 = Math.min(y0, cy - e.R); y1 = Math.max(y1, cy + e.R);
    } else uniforms.uEll.value.w = 0;
    const m = 0.04 + state.soft * 1.5;
    uniforms.uBox.value.set(x0 - m, y0 - m, x1 + m, y1 + m);
  }

  function apply() {
    dirty = true;
    const g = (state.pose?.shadow || 0) > 0.5;
    const blend = g || state.opacity < 0.999 || state.soft > 0;
    if (g !== ground || mat.transparent !== blend) {
      ground = g;
      mat.transparent = blend; mat.alphaToCoverage = !blend; mat.depthWrite = !blend;
      mat.needsUpdate = true;
    }
    uniforms.uInk.value.fromArray(state.color || INK);
    uniforms.uOpacity.value = state.opacity;
    const rm = state.rim;
    if (rm && rm.amount !== 0) { const l = Math.hypot(rm.dir[0], rm.dir[1]) || 1; uniforms.uRim.value.set(rm.dir[0] / l, rm.dir[1] / l, rm.width ?? 0.03, rm.amount ?? 1); uniforms.uRimCol.value.fromArray(rm.color || [1, 1, 1]); rimAbove = rm.above ?? -1e3; }
    else uniforms.uRim.value.w = 0;
    uniforms.uSoft.value = state.soft;
  }
  apply();
  return {
    mesh, seed, traits,
    set(s = {}) { Object.assign(state, s); apply(); },
    joints() { return solve().J; },
    /** World position of the speck (on the silhouette's edge above the left shoulder) for `camera`. */
    speckWorld(camera, out = new THREE.Vector3()) {
      mesh.updateWorldMatrix(true, false);
      const keep = state.speck; state.speck = Math.max(keep, 1e-3);
      sync(camera, 1080);
      state.speck = keep;
      const u = uniforms.uSpeck.value;
      return out.copy(uniforms.uC.value).addScaledVector(uniforms.uRt.value, u.x).addScaledVector(uniforms.uUp.value, u.y).applyMatrix4(mesh.matrixWorld);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
