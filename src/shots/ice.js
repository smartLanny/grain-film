// Shots and cards owned by the ICE group: prologue (S01-S05), the return (S21) and credits (S22).
// Ids, times and worlds are fixed by docs/story.md. This file also owns the camera choreography of the
// ice world (icePose) because the world needs the exact pose at 15.0 s to build the credit.
import { SHOT, PALETTE } from '../lib/story.js';
import { CameraPath } from '../lib/camera.js';

const shot = (id, world, rest = {}) => ({ id, start: SHOT[id][0], end: SHOT[id][1], world, ...rest });

// ---- small vector helpers ---------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
/** Camera basis for a pose: forward, right, up (unit vectors). */
export function basisOf(pos, target) {
  const f = norm(sub(target, pos));
  const r = norm(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}

// ---- the prologue dolly (S01-S03) ---------------------------------------------------------------
// One continuous move in two parts.
//   t < T_JOIN: the approach. The camera comes down onto the credit's line of sight from above and
//     to the left, fast at first and slowing: its offset from the axis is what holds the credit's
//     bubbles apart, and the offset running out is what draws them into words (parallax only).
//   t >= T_JOIN: on the axis it creeps forward at V_READ while the light reads the line (a pure,
//     slow dolly: the words only breathe), then it accelerates, dives off the axis toward the seed
//     (which shears the words apart), and eases out into the close-up.
export const ICE_LENS = 35;                    // mm, Super-35: horizontal FOV 39.1°
export const T_ALIGN = 15.0;
const AIM = [-10, 2, 0];
const P_ALIGN = [-9, 2.5, 34];
const AXIS = norm(sub(AIM, P_ALIGN));
export const END_POS = [0.8, 0.3, 3.4];        // final pose of S03 = pose of S04 = final pose of S21
export const END_TARGET = [-0.2, 0.02, 0];     // puts the seed (at the origin) slightly right of centre
const onAxis = (d) => add(P_ALIGN, mul(AXIS, d));
const ALIGN_BASIS = basisOf(P_ALIGN, AIM);
const T_JOIN = 13.6, V_READ = 0.3, V_CRUISE = 1.2;
const D_JOIN = -V_READ * (T_ALIGN - T_JOIN);   // where on the axis the approach lands
const PATH_POINTS = [
  onAxis(D_JOIN - 0.5), onAxis(D_JOIN), onAxis(0.42), onAxis(0.62),
  [-8.35, 1.7, 31.2],
  [-5.9, 1.2, 22.5],
  [-2.3, 0.8, 12],
  [0.25, 0.43, 6.2],
  END_POS,
];
const path = new CameraPath(PATH_POINTS, { samples: 4096 });
const S_JOIN = 0.5;                            // arc length of onAxis(D_JOIN) (the first span is straight)
const T_ACC = 16.0, T_ACC_END = 18.3, T_DEC = 20.0, T_STOP = 30.0;
const speedShape = (t, v1) => {
  if (t >= T_STOP) return 0;
  const v = V_READ + (v1 - V_READ) * smooth((t - T_ACC) / (T_ACC_END - T_ACC));
  return v * Math.pow(1 - clamp01((t - T_DEC) / (T_STOP - T_DEC)), 2.2);
};
const DT = 1 / 120;
const travel = (v1) => { let d = 0; for (let t = T_JOIN; t < T_STOP - 1e-9; t += DT) d += speedShape(t + DT / 2, v1) * DT; return d; };
const V1 = (() => { // solve for the cruise speed that lands exactly on END_POS (travel is linear in v1)
  const a = travel(0), b = travel(1) - a;
  return (path.length - S_JOIN - a) / b;
})();
const TRAVEL_LUT = (() => { // arc length at every DT from T_JOIN
  const n = Math.round((T_STOP - T_JOIN) / DT), lut = new Float64Array(n + 1);
  lut[0] = S_JOIN;
  for (let i = 0; i < n; i++) lut[i + 1] = lut[i] + speedShape(T_JOIN + (i + 0.5) * DT, V1) * DT;
  lut[n] = path.length;
  return lut;
})();
// The approach, as functions of a = T_JOIN - t (seconds before the camera reaches the axis).
// Forward speed eases from V_CRUISE down to V_READ over the last 2 s; the sideways speed rises to
// about 1.7 units/s at a = 1.8 and is zero (with zero slope) at a = 0.
const approachBack = (a) => { const x = Math.min(1, a / 2), g = a <= 2 ? 2 * (x * x * x - x * x * x * x / 2) : 1 + (a - 2); return V_READ * a + (V_CRUISE - V_READ) * g; };
const sideSpeed = (a) => 0.55 * smooth(a / 3.5) + (a < 3.6 ? 1.25 * Math.sin((Math.PI * a) / 3.6) ** 2 : 0);
const SIDE_LUT = (() => { const n = Math.round(T_JOIN / DT), lut = new Float64Array(n + 2); for (let i = 0; i <= n; i++) lut[i + 1] = lut[i] + sideSpeed((i + 0.5) * DT) * DT; return lut; })();
const sideOffset = (a) => { const x = Math.max(0, a) / DT, i = Math.min(Math.floor(x), SIDE_LUT.length - 2); return SIDE_LUT[i] + (SIDE_LUT[i + 1] - SIDE_LUT[i]) * (x - i); };
const SIDE_DIR = add(mul(ALIGN_BASIS.u, 0.9), mul(ALIGN_BASIS.r, -0.436));   // from above, a little from the left
function dollyPos(t) {
  if (t < T_JOIN) {
    const a = T_JOIN - Math.max(t, 0);
    return add(onAxis(D_JOIN - approachBack(a)), mul(SIDE_DIR, sideOffset(a)));
  }
  if (t >= T_STOP) return END_POS;
  const x = (t - T_JOIN) / DT, i = Math.floor(x), f = x - i;
  const arc = TRAVEL_LUT[i] + (TRAVEL_LUT[Math.min(i + 1, TRAVEL_LUT.length - 1)] - TRAVEL_LUT[i]) * f;
  const p = path.at(arc / path.length);
  return [p.x, p.y, p.z];
}
const dollyTarget = (t) => mix3(AIM, END_TARGET, smoother((t - 16.4) / (25.0 - 16.4)));

// ---- the crack (S04/S05): end points in world space, shared with the world ---------------------
const END_BASIS = basisOf(END_POS, END_TARGET);
const inFrame = (a, b, depth) => add(add(mul(END_BASIS.r, a), mul(END_BASIS.u, b)), mul(END_BASIS.f, depth));
export const CRACK_FROM = inFrame(3.5, 0.98, 1.7);     // upper right, deep: where the sun gets in
export const CRACK_TO = inFrame(-3.1, -0.72, 0.35);    // lower left, nearer
export const SUN_DIR = norm(sub(CRACK_FROM, [0, 0, 0])); // direction TO the light, as seen from the seed

// ---- S21: the return. The camera eases into END_POS by 222.0 (03:42.0) ---------------------------
const RETURN_OFFSET = [2.4, 3.0, 15];
const RETURN_LOOK_FROM = [2.5, 0.6, -16];       // at 212.0 the hero tuft is small, up and to the left of centre
/** How far out the hero seed still is (1 = a distant tuft, 0 = home at the origin). */
export const seedDriftAt = (t) => 1 - smoother((t - 210) / 10.5);
export const returnEase = (t) => { const x = clamp01((t - 210.5) / (222 - 210.5)); return 1 - Math.pow(1 - x, 2.6); };

/** Camera pose of the ice world at film time t: { pos, target }. Pure. */
export function icePose(t) {
  if (t < 31) return { pos: dollyPos(t), target: dollyTarget(t) };
  if (t < 38) {
    // locked close-up; a 0.5° shudder as the ice cracks, then still
    const d = t - 31, k = Math.exp(-d * 7.5) * 0.031;
    const off = add(mul(END_BASIS.u, k * Math.sin(d * 52)), mul(END_BASIS.r, 0.6 * k * Math.sin(d * 37 + 1.1)));
    return { pos: END_POS, target: add(END_TARGET, off) };
  }
  if (t < 60) {
    // tilt up along the crack and push into the light
    const k = smoother((t - 38) / 4.6), push = smooth((t - 38) / 6);
    const look = mix3(END_TARGET, mix3([0, 0, 0], CRACK_FROM, 0.82), k);
    return { pos: mix3(END_POS, mix3(END_POS, CRACK_FROM, 0.36), push * push * 0.6 + push * 0.4), target: look };
  }
  if (t < 226.5) {
    const e = returnEase(t), le = smoother((t - 212) / (219 - 212));
    return { pos: add(END_POS, mul(RETURN_OFFSET, 1 - e)), target: mix3(RETURN_LOOK_FROM, END_TARGET, le) };
  }
  return { pos: END_POS, target: END_TARGET };
}
/** The camera spec's position function (exported so the world can tell that a shot rides icePose). */
export const iceCameraPosition = (lt, t) => icePose(t).pos;
const camera = {
  position: iceCameraPosition,
  target: (lt, t) => icePose(t).target,
  lens: ICE_LENS, near: 0.05, far: 600,
};

// ---- look ---------------------------------------------------------------------------------------
// Prologue grade (docs/story.md section 7): near-monochrome blue-black, crushed but not clipped blacks,
// cool highlights, heavy vignette, the dark carries the grain.
const GRADE = {
  exposure: 0, contrast: 1.1, saturation: 0.9,
  lift: [0.004, 0.006, 0.012], gamma: [0.96, 0.99, 1.04], gain: [0.97, 1.0, 1.03],
  bloom: 0.07, bloomScatter: 0.72, halation: 0.03,
  vignette: 0.62, vignetteSoftness: 0.55, chromaticAberration: 2.2,
  grain: 0.052, grainSize: 1.35,
};
// The frame the film opens toward and closes on: end of S03 == S04 at rest == end of S21.
export const REST = {
  reveal: 1, lightLevel: 0.2, causticAmount: 0.4, fractureFlash: 0.32,
  focusDistance: 3.45, aperture: 1.8, seedGlow: 0.35, silkSpread: 1, seedIce: 1,
};
const K = (keys, extra = {}) => ({ keys, time: 'absolute', ...extra });

export const shots = [
  shot('S01', 'ice', {
    camera,
    params: {
      reveal: K([[2.0, 0], [6.0, 1]], { ease: 'inOutSine' }),
      lightLevel: 0.05, causticAmount: 0, fractureFlash: 0, seedGlow: 0,
      focusDistance: 26, aperture: 0.5, creditAlign: 0, creditSweep: 0,
    },
    post: { ...GRADE },
  }),
  shot('S02', 'ice', {
    camera,
    params: {
      reveal: 1, lightLevel: 0.05, causticAmount: 0, fractureFlash: 0, seedGlow: 0,
      focusDistance: 26, aperture: 0.5,
      // (the credit needs no envelope: its bubbles are ordinary bubbles all the time, and only the
      // camera's path lines them up)
      creditSweep: K([[13.0, 0], [15.5, 1]]),
    },
    post: { ...GRADE },
  }),
  shot('S03', 'ice', {
    camera,
    params: {
      reveal: 1,
      lightLevel: K([[19, 0.05], [20.3, 0.05], [24.5, REST.lightLevel]], { ease: 'inOutSine' }),
      causticAmount: K([[21.6, 0], [24.5, REST.causticAmount]], { ease: 'inOutSine' }),
      fractureFlash: K([[20.1, 0], [20.5, 1, 'outCubic'], [23.0, REST.fractureFlash]], { ease: 'inOutSine' }),
      seedGlow: K([[22.6, 0], [24.4, REST.seedGlow]], { ease: 'inOutSine' }),
      focusDistance: (lt, t) => {
        // far field until the seed is found, then a rack onto it at 24.0 that follows it in
        const d = Math.hypot(...icePose(t).pos) - 0.05;
        const k = smoother((t - 23.2) / 1.6);
        return 26 + (Math.max(d, REST.focusDistance) - 26) * k;
      },
      aperture: K([[21.5, 0.5], [26, REST.aperture]], { ease: 'inOutSine' }), creditAlign: 0, creditSweep: 1,
    },
    post: { ...GRADE },
  }),
  shot('S04', 'ice', {
    camera,
    params: {
      ...REST,
      // the stem is drawn in the first 0.2 of the growth; its head is already inside the frame on the
      // frame at 31.0 and has crossed it by 31.4; the branches follow until 33.0
      crackGrowth: K([[31.0, 0.066], [31.4, 0.2], [32.967, 1]]),
      bladeIntensity: K([[31.9, 0], [36.0, 0.8]], { ease: 'inOutSine' }),
      lightLevel: K([[31.0, REST.lightLevel], [32.0, 0.26], [36.0, 0.7]], { ease: 'inOutSine' }),
      seedGlow: K([[32.0, REST.seedGlow], [36.0, 0.8]], { ease: 'inOutSine' }),
      bead: K([[35.0, 0], [37.6, 1]]),
    },
    post: {
      ...GRADE,
      halation: GRADE.halation,
      bloom: K([[32, GRADE.bloom], [36, 0.1]]),
      saturation: K([[32, GRADE.saturation], [36, 1.12]]),
      chromaticAberration: K([[30.9, GRADE.chromaticAberration], [31.0, 1.0]]),
    },
  }),
  shot('S05', 'ice', {
    camera,
    params: {
      ...REST,
      crackGrowth: 1, bead: 1,
      bladeIntensity: K([[38, 0.8], [41.5, 1]]),
      lightLevel: 0.7,
      seedGlow: 0.8,
      whiteOut: K([[38, 0], [43.0, 1]]),
      focusDistance: K([[38, REST.focusDistance], [41, 5.5]], { ease: 'inOutSine' }),
    },
    post: {
      ...GRADE,
      halation: K([[38, GRADE.halation], [41, 0.1]]), saturation: 1.12,
      // the burn is warm (the sun blade's #FFE2B0) all the way up: the white only closes in the last moments
      exposure: K([[38, 0], [41.6, 0], [42.9, 0.7]], { ease: 'inOutSine' }),
      temperature: K([[38, 0], [41.5, 0.6]]),
      tint: K([[38.5, [1, 1, 1]], [41.2, [1.0, 0.84, 0.6]]]),
      bloom: K([[38, 0.1], [42.8, 0.4]], { ease: 'inQuad' }),
      vignette: K([[38, GRADE.vignette], [42.6, 0]], { ease: 'inOutSine' }),
      grain: K([[40, GRADE.grain], [43, 0.012]]),
      chromaticAberration: K([[38, 1.0], [43, 0]]),
    },
  }),
  shot('S21', 'ice', {
    camera,
    transitionIn: { type: 'dissolve', duration: 1.5 },
    params: {
      ...REST,
      clock: (lt, t) => t - 195,                       // so that 226.0 is the same instant as 31.0
      freeze: K([[216, 0], [222, 1]], { ease: 'inOutSine' }),
      // wind-seconds left before everything stops: runs at real time, then eases to 0 at 222.0
      windAge: (lt, t) => { const a = Math.max(0, 222 - Math.max(t, 216)), b = Math.max(0, 216 - t); return a * a * a / 108 * 1.5 + b; },
      lightLevel: K([[216, 0.05], [222, REST.lightLevel]], { ease: 'inOutSine' }),
      causticAmount: K([[217.5, 0], [222, REST.causticAmount]], { ease: 'inOutSine' }),
      fractureFlash: K([[218, 0], [222, REST.fractureFlash]], { ease: 'inOutSine' }),
      seedGlow: K([[212, 0.5], [218, 0.5], [222, REST.seedGlow]]),
      silkSpread: K([[216, 0.22], [221.5, 1]], { ease: 'outCubic' }),
      seedIce: K([[217, 0], [222, 1]]),
      seedDrift: (lt, t) => seedDriftAt(t),
      aperture: K([[212, 0.3], [217, 0.3], [221.5, REST.aperture]], { ease: 'inOutSine' }),
      focusDistance: (lt, t) => {
        const d = Math.hypot(...icePose(t).pos);
        const k = smoother((t - 217.2) / 3.2);
        return 30 + (Math.max(d, REST.focusDistance) - 30) * k;
      },
    },
    post: { ...GRADE },            // the prologue's grade, from the first frame of the return
  }),
  shot('S22', 'ice', {
    camera: { position: END_POS, target: END_TARGET, lens: ICE_LENS, near: 0.05, far: 600 },
    params: { credits: 1, reveal: 1, creditsFade: K([[226, 0], [227.5, 1], [237.0, 1], [238.5, 0]]) },
    post: { ...GRADE, vignette: 0.3, bloom: 0.03, halation: 0, chromaticAberration: 0.6, lift: [0, 0, 0], grain: K([[237, 0.04], [238.5, 0.0]]) },
  }),
];

// ---- cards: E1 (end title) and E2 (end credits). C0 is diegetic and lives in the world. ----------
const line = (text, lang, size, tracking, extra = {}) => ({ text, lang, size, tracking, color: PALETTE.cardText, opacity: 0.92, ...extra });
export const cards = [
  {
    id: 'E1', start: 227, end: 232,
    lines: [
      line('一粒', 'zh', 96, 0.5, { gap: 26 }),
      line('GRAIN', 'en', 26, 0.6, { case: 'upper' }),
    ],
    position: 'center', align: 'center', fadeIn: 1.0, fadeOut: 1.0, blurIn: 0, blurOut: 0, rise: 0, stagger: 0, shadow: 0,
  },
  {
    id: 'E2', start: 232.5, end: 238.5,
    lines: [
      line('出品　Fable 5.5', 'zh', 34, 0.14, { gap: 12 }),
      line('Produced by Fable 5.5', 'en', 20, 0.08, { case: 'none', gap: 64 }),
      // the leading en space re-centres the ink: the full stop's ink sits at the left of its em box
      line('\u2002全片的光与声，皆由代码写成。', 'zh', 34, 0.14, { gap: 12 }),
      line('Every frame and every sound was written in code.', 'en', 20, 0.08, { case: 'none' }),
    ],
    position: 'center', align: 'center', fadeIn: 1.0, fadeOut: 1.0, blurIn: 0, blurOut: 0, rise: 0, stagger: 0, shadow: 0,
  },
];
