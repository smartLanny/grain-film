// W5 FIELD: the wide meadow, the migration, the merged look. Owner: Group A.
//   S20 (178..192)            the flight west along the gold river, over the flowering meadow, into the low sun
//   createFieldBackplate(ctx) the same scene as GRASS's soft background (ENGINE.md, "FIELD backplate")
//   engine.portal('S20', 180) the frame that hangs in S14's raindrop (nothing here depends on the past)
//
// 1 unit = 100 m (GRAIN's W2). -Z is west (the sun, the mountain), +X is north (the city).
// Everything is a pure function of the state passed to apply(): film time, sun, cloud, lights, lens.
// The scene is built ONCE per renderer (SHARED) and used by the world and by every backplate; each
// user sets all state and renders immediately, so they cannot disturb each other.
//
// What is in it
//   GRAIN's landscape at year 10,000 (createLandscape, with its stone lattice off and a gold river),
//   the tree (loose crown: it is only a tree here) and its long shadow;
//   our own meadow: grass in three rings of world-anchored tiles that travel with the camera (blended
//   ribbons, never hashed alpha), 220,000 flowers in drifts of buttercup, clover and daisy;
//   the footpath and the walker (FIGURE `walk`, with the speck); the CITY on the northern horizon as
//   three planes of ink towers standing in mist; FLOCK as the river of butterflies; our butterfly.
//   X11: the flowers that survive defocus and the city's windows are instances of ONE mesh ("discs"),
//   sized by the same circle of confusion and brought to the same colour.

import * as THREE from 'three';
import { createLandscape } from './valley.js';
import { createTree, TREE_UNIT, TREE_SHADOW_GLSL } from '../lib/tree.js';
import { SEED_SPOT } from '../lib/valley-story.js';
import { createFlock } from '../lib/flock.js';
import { createFigure } from '../lib/figure.js';
import { createButterfly } from '../lib/butterfly.js';
import { NOISE } from '../lib/glsl/noise.js';
import { FX_LAYER } from '../post.js';
import { lensToFov } from '../lib/camera.js';
import { evalValue } from '../lib/easing.js';
import { createRng } from '../lib/random.js';
import { SHOT, PALETTE, linear } from '../lib/story.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const D2R = Math.PI / 180;
const M = 0.01;                                   // one metre in world units
const g3 = (v) => `vec3(${v.map((x) => x.toFixed(5)).join(', ')})`;

/** Smooth interpolation through keys [[t, v], ...] (monotone cubic; held beyond the ends). */
function keyed(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1], h = t1 - t0, s = (t - t0) / h;
  const slope = (j) => {
    if (j <= 0 || j >= n - 1) return 0;
    const a = (keys[j][1] - keys[j - 1][1]) / (keys[j][0] - keys[j - 1][0]), b = (keys[j + 1][1] - keys[j][1]) / (keys[j + 1][0] - keys[j][0]);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const m0 = slope(i), m1 = slope(i + 1), s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1;
}

// ======================================================================================================
// The grade, and its inverse. FIELD paints in the script's palette (SCRIPT.md W5): a colour named there is put
// into the scene as the HDR radiance that the post chain's grade (exposure, tint, ACES, contrast, saturation)
// returns to exactly that colour. So the sky runs #FFB25E -> #C4553A -> #1B2440, lit grass is #E9B44C, a
// buttercup is #FFD23F and the city is ink, whatever the exposure; nothing has to be tinted in the grade.
export const FIELD_GRADE = { exposure: -0.8, tint: [1, 1, 1], contrast: 1.08, saturation: 1.1 };
const A_IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const A_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const m3 = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
/** post.js's grade (without bloom and vignette): linear HDR -> display sRGB 0..1. */
function gradeOf(hdr, g) {
  const k = Math.pow(2, g.exposure ?? 0) / 0.6, tint = g.tint || [1, 1, 1];
  let c = m3(A_IN, hdr.map((x, i) => x * k * tint[i])).map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  c = m3(A_OUT, c).map((x) => { x = clamp01(x); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; });
  const lift = [0.012, 0.012, 0.016];
  c = c.map((x, i) => (x + lift[i] * (1 - x) - 0.5) * (g.contrast ?? 1.04) + 0.5);
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((x) => clamp01(l + (x - l) * (g.saturation ?? 0.96)));
}
const PAINT = new Map();
/** '#RRGGBB' -> the linear HDR [r, g, b] that the grade g shows as that colour (cached). */
function paintHDR(hex, g = FIELD_GRADE) {
  const key = hex + '|' + (g.exposure ?? 0) + '|' + (g.tint || [1, 1, 1]).join(',') + '|' + (g.contrast ?? 1.04) + '|' + (g.saturation ?? 0.96);
  let h = PAINT.get(key);
  if (h) return h;
  const target = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  h = target.map((x) => Math.pow(x, 2.2) * 0.6);
  for (let k = 0; k < 300; k++) { const c = gradeOf(h, g); h = h.map((x, i) => Math.max(1e-5, x * Math.pow((target[i] + 0.02) / (c[i] + 0.02), 0.6))); }
  if (PAINT.size > 400) PAINT.clear();
  PAINT.set(key, h);
  return h;
}

// ======================================================================================================
// The flight (S20): a pure function of film time. D = -z is the distance up the valley (units).
// The camera follows the river's north bank at 12 m/s, some 28 m to the right of the water's middle,
// so the river is a ribbon of gold on its left and the meadow is the ground of the shot.
const T0 = SHOT.S20[0];
export const FLIGHT = { speed: 12 * M, d0: -0.98, lens: 28 };
const CAM_X = [[-1.05, 1.012], [-0.5, 0.965], [0.0, 0.910], [0.4, 0.845], [0.78, 0.720]];       // x by D
const FOOT_X = [[-2.6, 1.42], [-1.5, 1.20], [-1.0, 1.120], [-0.5, 1.075], [0.0, 1.020], [0.4, 0.955], [0.8, 0.825], [1.3, 0.72], [2.0, 0.70], [3.0, 0.78], [4.6, 1.0]];
const ALT = [[178, 3.0], [180, 3.5], [186, 12.0], [189.4, 8.4], [192, 2.0]];                      // metres above the meadow
const PITCH = [[177.3, 12.0], [178, 10.0], [179.5, 2.0], [180.6, 0.2], [183, -1.2], [186, -4.2], [189.6, -6.4], [190.5, -7.6], [191.1, -15], [192, -39]];   // degrees, + up
const YAW = [[178, -10.5], [181, -9.0], [185, -6.0], [188.5, 1.0], [190.5, 5.0], [192, 7.0]];     // degrees right (north) of west
const ROLL = [[178, 0], [190.4, 0], [191.4, -3.2], [192, -4.2]];
/** The camera of S20 at film time t: x, z (units), alt (units above the meadow), yaw / pitch / roll (degrees). */
export function flight(t) {
  const e = clamp01((t - 190.6) / 1.4);                                        // it settles as it comes down: 12 m/s -> 2.4 m/s
  const D = FLIGHT.d0 + FLIGHT.speed * (t - T0 - 1.4 * 0.4 * e * e);
  return { x: keyed(CAM_X, D), z: -D, D, alt: keyed(ALT, t) * M, yaw: keyed(YAW, t), pitch: keyed(PITCH, t), roll: keyed(ROLL, t) };
}
/** The walker on the footpath: 1.4 m/s west, overtaken by the camera 03:01..03:07. */
const walkerD = (t) => 0.33 + 1.4 * M * (t - 181);
const STEP = 0.58;                                // seconds per step (S22's footsteps)

/**
 * Our butterfly in the camera's own frame (metres: right, up, ahead), u seconds from the moment it is in focus by
 * the lens. It rises past the lens from below left, holds half a second, and peels away down to the right.
 */
const HERO = { scale: 1.9, lead: 1.4 };            // x life size (to read by the lens); seconds it is seen before u = 0
function heroLocal(u) {
  const v = Math.max(0, u - 0.5);
  return {
    ahead: lerp(0.74, 0.9, sstep(-1.4, -0.1, u)) + 2.0 * v ** 1.6,
    right: lerp(-0.52, 0.11, sstep(-1.5, 0.0, u)) + 0.36 * v ** 1.5 + 0.012 * Math.sin(u * 3.1),
    up: lerp(-0.42, -0.02, sstep(-1.5, -0.05, u)) - 0.50 * v ** 1.7 + 0.01 * Math.sin(u * 4.3 + 1.0),
    turn: sstep(0.45, 1.25, u),
  };
}
/** The ink pool that travels with it (frame fractions, y up; r in frame widths): there the pass lays no contour. */
function heroPool(t, t0, aspect) {
  const u = t - t0;
  if (u < -HERO.lead || u > 1.9) return [];
  const h = heroLocal(u), tanH = 24.89 / (2 * FLIGHT.lens), tanV = tanH / aspect;
  const r = (1.5 * 0.035 * HERO.scale) / h.ahead / (2 * tanH);
  return [{ x: 0.5 + (0.5 * h.right) / (h.ahead * tanH), y: 0.5 + (0.5 * h.up) / (h.ahead * tanV), r, soft: r * 0.6, amount: 0.1, chroma: 1, rim: 0 }];
}

/** The lens of S20 from the shot's `focus` 0..1 (the pull to 1 m): the post chain's dof block, or null. */
export function lensOf(k) {
  k = clamp01(k);
  if (k <= 0.001) return null;
  return { focus: Math.exp(lerp(Math.log(2.2), Math.log(0.9 * M), Math.pow(k, 0.85))), aperture: Math.pow(k, 1.15), maxBlur: 30 };
}

// ======================================================================================================
// Shared GLSL: the ground map, the travelling tiles, the lens
const FIELD_GLSL = /* glsl */ `
uniform sampler2D tGround;      // r: height (units), g: distance to the water's edge (units, < 0 in the river), b: distance to the footpath
uniform vec4 uGroundMap;        // x0, z0, 1 / width, 1 / depth
uniform vec2 uCamXZ, uFwdXZ;
uniform float uTimeF;
uniform vec3 uSunDirF, uSunColF, uAmbF, uFillColF, uHazeF;
uniform vec3 uGrassShade, uGrassLit, uGrassGold;   // the palette's grass: in shade (cool), lit (gold-green), with the sun through it (gold)
uniform vec4 uLevel;            // x: the sun on the meadow 0..1, y: the sky's light 0..1, z: how far the flowers' own colour has gone out (the plate at dusk), w: extra haze with distance (the plate at dusk: the ground goes to ink)
uniform vec4 uWindF;            // xz: direction, z: strength, w: unused
uniform vec4 uShadeF;           // long shadows: x: length scale, y: lit share threshold, z: depth of the shade, w: unused
uniform vec2 uResF;
uniform vec4 uLens;             // aperture, focus distance (units), largest blur radius (px at 1080 lines), near fade (units)
const float M = 0.01;
vec4 groundAt(vec2 xz) {
  vec2 uv = (xz - uGroundMap.xy) * uGroundMap.zw;
  vec4 g = texture(tGround, uv);
  vec2 e = min(uv, 1.0 - uv);
  g.a = smoothstep(0.0, 0.03, min(e.x, e.y));
  return g;
}
// A world-anchored tile of side L that travels with the camera: instance seed -> its place now.
vec2 tileXZ(vec2 seed, float L, out float fade) {
  vec2 c = uCamXZ + uFwdXZ * (0.36 * L);
  vec2 d = mod(seed * L - c + 0.5 * L, L) - 0.5 * L;
  vec2 e = abs(d) / (0.5 * L);
  fade = 1.0 - smoothstep(0.72, 0.97, max(e.x, e.y));
  return c + d;
}
// circle of confusion (signed px radius) at view depth z
float cocPx(float z) { return clamp(uLens.x * (1.0 - uLens.y / max(z, 1e-4)), -1.0, 1.0) * uLens.z * uResF.y / 1080.0; }
// drifts: where the flowers are (0..1), and which kind leads there
float driftAt(vec2 xz) { vec2 e = xz - vec2(0.77, -0.70); return 0.55 * snoise(xz * 1.9 + 3.0) + 0.45 * snoise(xz * 6.7 + 11.0) + 0.7 * exp(-dot(e, e) / 0.05); }
// long shadows: everything that stands on the meadow throws one toward us (the sun is low and ahead);
// with them drift the shadows of the clouds. 1 = in the sun
float sunlitAt(vec2 xz, float t) {
  vec2 sd = normalize(uSunDirF.xz + 1e-5);
  vec2 q = vec2(dot(xz, vec2(-sd.y, sd.x)), dot(xz, sd));
  q.x += 0.02 * snoise(xz * 2.3 + 8.0);
  float streak = 0.45 * snoise(vec2(q.x * 19.0, q.y * 1.3 * uShadeF.x)) + 0.4 * snoise(vec2(q.x * 6.5 + 5.0, q.y * 0.5 * uShadeF.x + 3.0)) + 0.25 * snoise(xz * 3.3 + 21.0);
  float cloud = snoise(xz * 1.1 + uWindF.xy * t * 0.012 + 40.0);
  return mix(1.0 - uShadeF.z, 1.0, smoothstep(-0.16, 0.16, streak - uShadeF.y) * smoothstep(-0.4, 0.2, cloud));
}
// the gusts that cross the meadow (units of lean)
float gustAt(vec2 xz, float t) {
  float ph = dot(xz, uWindF.xy);
  return 0.6 * sin(t * 1.25 - ph * 46.0 + 2.0 * snoise(xz * 7.0)) + 0.4 * sin(t * 2.6 - ph * 118.0 + 5.0 * snoise(xz * 3.0 + 9.0));
}
`;

// ---- grass: instanced ribbons in travelling tiles -----------------------------------------------------
const GRASS_RINGS = [
  { L: 0.30, count: 120000, width: 0.019 * M, segs: 3, tall: 1.0 },
  { L: 1.20, count: 110000, width: 0.062 * M, segs: 2, tall: 1.05 },
  { L: 4.80, count: 80000, width: 0.27 * M, segs: 2, tall: 1.12 },
];
const GRASS_VERT = NOISE + TREE_SHADOW_GLSL + FIELD_GLSL + /* glsl */ `
attribute vec4 aSeed;
uniform vec4 uRing;             // tile size, blade width (units), height scale, ring index
varying vec3 vCol; varying vec2 vUv; varying float vA;
void main() {
  float fade;
  vec2 xz = tileXZ(aSeed.xy, uRing.x, fade);
  vec4 g = groundAt(xz);
  fade *= g.a * smoothstep(0.002, 0.014, g.g) * smoothstep(0.0035, 0.008, g.b);
  vec3 root = vec3(xz.x, g.r, xz.y);
  float dCam = distance(root, cameraPosition);
  fade *= smoothstep(uLens.w, uLens.w * 2.2, dCam);
  if (fade <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float y = position.y;
  float tuft = snoise(xz * 4.1 + 17.0);
  float reed = 1.0 - smoothstep(0.012, 0.05, g.g);                       // taller and darker at the water
  float tall = (0.26 + 0.42 * aSeed.z * aSeed.z + 0.14 * aSeed.w) * M * uRing.z * (0.8 + 0.3 * tuft) * (1.0 + 0.9 * reed) * mix(0.4, 1.0, smoothstep(0.008, 0.02, g.b));
  // lean: its own, plus the wind
  float a = aSeed.w * 6.2832;
  float gust = gustAt(xz, uTimeF);
  vec2 lean = vec2(cos(a), sin(a)) * 0.26 + uWindF.xy * uWindF.z * (0.30 + 0.34 * gust);
  vec3 p = root + vec3(lean.x, 0.0, lean.y) * tall * y * y;
  p.y += tall * y * (1.0 - 0.22 * y * dot(lean, lean));
  // the ribbon turns its face to the camera; never thinner than a pixel (alpha takes up the difference)
  vec3 toCam = normalize(cameraPosition - p);
  vec3 axis = normalize(vec3(lean.x * 2.0 * y, 1.0, lean.y * 2.0 * y));
  vec3 side = normalize(cross(axis, toCam));
  float head = step(0.62, aSeed.z) * smoothstep(0.62, 0.9, y) * (1.0 - smoothstep(0.93, 1.0, y));    // seed heads
  float w = uRing.y * (1.0 - 0.92 * y * y) * (0.75 + 0.5 * aSeed.w) * (1.0 + 1.6 * head);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float pxPerU = projectionMatrix[1][1] * 0.5 * uResF.y / max(-mv.z, 1e-4);
  float px = w * pxPerU, minPx = 1.25;
  vA = fade * min(1.0, px / minPx);
  w = max(px, minPx) / pxPerU;
  p += side * position.x * w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vUv = vec2(position.x * 2.0, y);
  // light: the sky from above, the low sun through the blade
  float shade = 1.0;
  vec2 dT = (root.xz - TREE_SEED_SPOT.xz) / TREE_M, Lh = normalize(uSunDir.xz + 1e-5);
  if (uSunDir.y > 0.012 && -dot(dT, Lh) > -16.0 && abs(dT.x * Lh.y - dT.y * Lh.x) < 24.0) shade = treeShadow(root);
  float toSun = max(dot(-toCam, uSunDirF), 0.0);
  float through = pow(toSun, 5.0);
  float cloud = sunlitAt(xz, uTimeF);
  // painted in the palette: the shade side cool (#2E3B1F), the lit side gold-green, gold (#E9B44C) where the low sun
  // comes through the blade toward us; seed heads paler
  vec3 shadeCol = uGrassShade * (0.5 + 0.75 * y) * (0.82 + 0.36 * tuft) * mix(1.0, 0.6, reed) * uLevel.y;
  float sway = 0.5 + 0.5 * gust;                                         // blades bowed by a gust show their sheen
  float sunK = uLevel.x * shade * cloud * (0.16 + 0.2 * sway * y + (0.62 * through + 0.42 * toSun) * (0.2 + 0.8 * y));
  vec3 litCol = mix(uGrassLit, uGrassGold, clamp(through * through * 1.1 + 0.5 * head, 0.0, 1.0)) * (0.85 + 0.3 * tuft);
  vCol = shadeCol + litCol * sunK + uGrassGold * (uLevel.x * shade * cloud * through * head * 0.5);
  float haze = 1.0 - exp(-dCam * (0.045 + uLevel.w));
  vCol = mix(vCol, uHazeF, haze * (uLevel.w > 0.0 ? 0.9 : 0.5));
}`;
const GRASS_FRAG = /* glsl */ `
varying vec3 vCol; varying vec2 vUv; varying float vA;
void main() {
  float a = vA * (1.0 - smoothstep(0.55, 1.0, abs(vUv.x)));
  gl_FragColor = vec4(vCol * (0.9 + 0.2 * (1.0 - abs(vUv.x))), a);
}`;

// ---- discs: every flower and every lit window, one set of instances ------------------------------------
const FLOWER_RINGS = [
  { L: 0.40, count: 70000, size: 0.054 * M },     // blooms by the lens (a little larger than life)
  { L: 1.60, count: 80000, size: 0.105 * M },     // blooms of the near mid-ground (larger still: each stands for a few)
  { L: 6.40, count: 70000, size: 2.6 * M },       // drifts, seen from far off as masses of colour
];
const DISC_VERT = NOISE + TREE_SHADOW_GLSL + FIELD_GLSL + /* glsl */ `
attribute vec4 aA;              // flower: xy tile seed, z rnd, w rnd | window: xyz world position, w rnd
attribute vec4 aB;              // x: tile size (0 = a window), y: size (units), z: highlight rank 0..1, w: rnd (flower) / lighting order (window)
uniform float uMode;            // 0: the flowers as they are (main pass)   1: the discs (FX layer): highlights and windows
uniform vec4 uDisc;             // city lights 0..1, lights out 0..1, flowers 0..1, window gain
uniform vec3 uSel;              // share of each flower ring that survives defocus as a disc
uniform vec4 uBokeh;            // rgb: the colour both come to, a: radiance
uniform vec3 uBokehLo;          // the plate at dusk: the dimmest disc (the same hue; uBokeh.rgb is then the brightest)
uniform vec3 uFlowerCol[3];     // buttercup, clover, daisy (the palette's colours, as the grade returns them)
uniform vec4 uPick;             // the plate at dusk: x: discs per 10^4 px^2 (at 1080 lines), y: 1 = pick them evenly over the picture, z: share of the windows
varying vec4 vCol; varying vec2 vUv; varying float vSoft; varying vec4 vBloom;   // kind 0..2, seed, radius (px at 1080 lines), 1 = a far mass
void main() {
  bool win = aB.x <= 0.0;
  vBloom = vec4(0.0, aA.w * 61.0 + aB.z * 17.0, 0.0, 0.0);
  if (win && uMode < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 wp, col; float show = 1.0, sel, rnd = aA.w, ring = 0.0, kid_ = 0.0;
  vec2 rest = vec2(1.0, 0.01);     // the flower at rest: its distance, and the eye's height above it
  if (win) {
    wp = aA.xyz;
    show = smoothstep(aB.w, aB.w + 0.012, uDisc.x * 1.012);
    col = uBokeh.rgb * uDisc.w * (0.55 + 0.9 * rnd);
    sel = step(1.0 - mix(0.06, uPick.z, uPick.y), aB.z);
  } else {
    vec2 xz = tileXZ(aA.xy, aB.x, show);
    vec4 g = groundAt(xz);
    ring = aB.x < 0.5 ? 0.0 : (aB.x < 2.0 ? 1.0 : 2.0);
    // drifts: where the flowers are, and broad patches of one kind (a few strays of the others among them)
    float d = driftAt(xz);
    show *= g.a * smoothstep(0.004, 0.02, g.g) * smoothstep(0.004, 0.009, g.b) * uDisc.z;
    show *= smoothstep(-0.02, 0.10, d - mix(0.30, -0.30, aA.z));
    if (show <= 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float kind = 1.2 * snoise(xz * 1.7 + 23.0) + 0.5 * snoise(xz * 4.6 + 5.0) + 0.36 * (aB.w - 0.5);
    float kid = kind > 0.2 ? 0.0 : (kind < -0.26 ? 1.0 : 2.0);
    vBloom.x = kid; kid_ = kid;
    vec3 alb = kid < 0.5 ? uFlowerCol[0] : (kid < 1.5 ? uFlowerCol[1] : uFlowerCol[2]);
    float stem = (0.30 + 0.22 * aA.z + (kid < 0.5 ? 0.06 : 0.0)) * M * (1.0 + 0.2 * ring);
    float gust = gustAt(xz, uTimeF);
    wp = vec3(xz.x, g.r + stem, xz.y);
    rest = vec2(distance(wp, cameraPosition), max(cameraPosition.y - wp.y, 0.002));
    wp += vec3(uWindF.x, 0.0, uWindF.y) * uWindF.z * (0.30 + 0.34 * gust) * stem * 0.8;
    wp.xz += (0.26 * stem) * vec2(cos(rnd * 6.2832), sin(rnd * 6.2832));
    float shade = 1.0;
    vec2 dT = (wp.xz - TREE_SEED_SPOT.xz) / TREE_M, Lh = normalize(uSunDir.xz + 1e-5);
    if (uSunDir.y > 0.012 && -dot(dT, Lh) > -16.0 && abs(dT.x * Lh.y - dT.y * Lh.x) < 24.0) shade = treeShadow(wp);
    vec3 toCam = normalize(cameraPosition - wp);
    float toSun = max(dot(-toCam, uSunDirF), 0.0);
    shade *= sunlitAt(xz, uTimeF);
    // its own colour, in the sun or in the sky's cooler light (never the sun's orange laid over it)
    float sunK = uLevel.x * shade;
    float level = uLevel.y * 0.56 + sunK * (0.44 + 0.2 * toSun * toSun);
    col = alb * level * mix(vec3(0.93, 0.97, 1.04), vec3(1.0), clamp(sunK * 1.6, 0.0, 1.0)) * (0.86 + 0.28 * rnd) * (kid > 1.5 ? 0.8 : 1.0);
    float dCam = distance(wp, cameraPosition);
    show *= smoothstep(uLens.w, uLens.w * 2.2, dCam) * smoothstep(aB.x * 0.05, aB.x * 0.15, dCam + 0.05 * (1.0 - ring));
    col = mix(col, uHazeF, (1.0 - exp(-dCam * 0.045)) * 0.12) * (1.0 - uLevel.z);
    sel = ring < 0.5 ? uSel.x : (ring < 1.5 ? uSel.y : uSel.z);
  }
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float z = -mv.z;
  if (z < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = uResF.y / 1080.0;
  float pxPerU = projectionMatrix[1][1] * 0.5 * uResF.y / z;
  if (!win) {
    float share = mix(0.28, sel, smoothstep(0.03, 0.14, z));                              // the near flowers keep more of their highlights
    if (uPick.y > 0.0) {
      // the plate (a long lens, low over the meadow): as many discs per piece of picture near as far. One pixel
      // covers z^3 / (h f^2) of ground (f: pixels per radian, h: the eye above the flower)
      float f = pxPerU * z, zr = rest.x;                                                  // (at rest: a disc must not blink as its flower sways)
      float rho = (ring < 0.5 ? ${(FLOWER_RINGS[0].count / FLOWER_RINGS[0].L ** 2).toFixed(1)} : (ring < 1.5 ? ${(FLOWER_RINGS[1].count / FLOWER_RINGS[1].L ** 2).toFixed(1)} : ${(FLOWER_RINGS[2].count / FLOWER_RINGS[2].L ** 2).toFixed(1)}));
      float rings = max((1.0 - smoothstep(0.25, 0.34, zr)) + smoothstep(0.08, 0.24, zr) * (1.0 - smoothstep(1.1, 1.36, zr)) + smoothstep(0.32, 0.96, zr), 0.2);   // how many rings are present this far out
      float want = uPick.x * 1e-4 / (k * k) * (0.8 + 1.5 * smoothstep(0.15, 1.6, zr)) / rings;   // thicker toward the horizon
      share = mix(share, clamp(want * rest.y * f * f / (rho * zr * zr * zr), 0.0, 1.0), uPick.y);
    }
    sel = step(1.0 - share, aB.z);
  }
  float r = 0.5 * aB.y * pxPerU;                         // radius in focus (px)
  float c = abs(cocPx(z));
  float soft = smoothstep(1.5 * k, 6.0 * k, c);
  float a = show, R;
  vec3 rad = col;
  vec4 cp;
  if (uMode < 0.5) {
    // the flower as it is, facing the lens: a bloom near us, a dot further off (never under a pixel and a half
    // across: alpha takes up the difference); the far ring is masses of them, wider than tall, on the grass tops
    float minR = 0.85 * k, flat_ = ring > 1.5 ? 0.3 : 1.0;
    float rv = r * flat_;
    R = max(r, minR);
    float Rv = max(rv, minR);
    a *= min(1.0, r / minR) * min(1.0, rv / minR) * (ring > 1.5 ? (kid_ > 1.5 ? 0.3 : 0.52) : 1.0);
    if (a <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    mv.xy += position.xy * vec2(R, Rv) / pxPerU;
    cp = projectionMatrix * mv;
    vBloom.z = R / k;
    vBloom.w = ring > 1.5 ? 1.0 : 0.0;
    soft = 0.0;
  } else {
    // X11: flower or window, the same disc: sized by the circle of confusion, the same colour
    float minR = (win ? 0.9 : 0.85) * k;
    float r0 = max(win ? r : min(r, 3.0 * k), minR);
    R = max(r0, c);
    float energy = min(1.0, (r * r) / (minR * minR));
    vec3 own = col * (win ? 1.0 : energy);
    float lum = fract(rnd * 7.31 + aB.z * 3.7);
    vec3 disc = uPick.y > 0.0 ? mix(uBokehLo, uBokeh.rgb, lum * lum) : uBokeh.rgb * uBokeh.a * (0.42 + 0.9 * lum);
    rad = mix(own, disc, soft);
    a *= win ? mix(1.0, sel, soft) : sel * soft;
    // S22: the discs go out, from the right edge leftward, one by one
    vec4 c0 = projectionMatrix * mv;
    float sx = 0.5 + 0.5 * c0.x / c0.w;
    float out_ = (1.0 - sx) * 0.82 + 0.18 * fract(rnd * 13.7);
    a *= 1.0 - smoothstep(out_, out_ + 0.035, uDisc.y * 1.04);
    if (a <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // the disc belongs to the lens, not to the place: only what hides its centre hides it
    vec4 near = projectionMatrix * vec4(mv.xy, mv.z + z * (win ? 0.5 : 0.6), 1.0);
    mv.xy += position.xy * vec2(mix(1.0, 1.0 / 1.5, soft), 1.0) * R / pxPerU;
    cp = projectionMatrix * mv;
    cp.z = near.z / near.w * cp.w;
  }
  gl_Position = cp;
  vUv = position.xy;
  vCol = vec4(rad, a);
  vSoft = soft;
}`;
const DISC_FRAG = /* glsl */ `
uniform float uMode;
uniform vec3 uFlowerCol[3];
uniform vec4 uPick;
varying vec4 vCol; varying vec2 vUv; varying float vSoft; varying vec4 vBloom;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  float r = length(vUv), a;
  vec3 col = vCol.rgb;
  if (uMode > 0.5) {
    float dot_ = 1.0 - smoothstep(0.45, 1.0, r);                         // in focus: a soft dot
    float e = mix(0.16, max(0.16, 1.5 * fwidth(r)), uPick.y);            // (the plate: never less than a pixel and a half of edge)
    float disc = 1.0 - smoothstep(1.0 - e, 1.0, r);                      // out of focus: a flat disc with a breath of rim
    disc *= 0.74 + 0.26 * smoothstep(0.62, 0.92, r);
    a = vCol.a * mix(dot_, disc, vSoft);
  } else if (vBloom.w > 0.5) {
    // far off: a mass of flowers, ragged, melting into its neighbours
    vec2 q = vUv * vec2(2.2, 1.0) + vBloom.y;
    float rag = 0.55 + 0.45 * (h21(floor(q * 1.7)) * 0.5 + 0.5 * sin(q.x * 5.0 + vBloom.y) * sin(q.y * 4.0 + 1.3));
    a = vCol.a * exp(-r * r * 2.6) * rag;
  } else {
    // near enough to be a bloom: five round petals (buttercup), a tufted globe (clover), a ring of rays about
    // a yellow eye (daisy); further off, a soft dot of the same colour
    float big = smoothstep(2.6, 6.0, vBloom.z);
    float ang = atan(vUv.y, vUv.x) + vBloom.y, kind = vBloom.x, edge;
    if (kind < 0.5) edge = 0.76 + 0.2 * abs(cos(ang * 2.5));
    else if (kind < 1.5) edge = 0.84 + 0.08 * cos(ang * 7.0);
    else edge = 0.62 + 0.36 * pow(abs(cos(ang * 5.5)), 0.7);
    float shape = 1.0 - smoothstep(edge - 0.16, edge, r);
    a = vCol.a * mix(1.0 - smoothstep(0.45, 1.0, r), shape, big);
    float lum = dot(vCol.rgb, vec3(0.3, 0.6, 0.1)) / max(dot(uFlowerCol[2], vec3(0.3, 0.6, 0.1)), 1e-4);
    if (kind > 1.5) col = mix(col, uFlowerCol[0] * lum * 1.1, big * (1.0 - smoothstep(0.2, 0.34, r)));          // the daisy's eye
    else if (kind < 0.5) col *= 1.0 + big * (0.22 * smoothstep(0.25, 0.7, r) - 0.18 * (1.0 - smoothstep(0.0, 0.22, r)));   // the cup's throat, the petals' gloss
    else col *= mix(1.0, 0.72 + 0.4 * (0.5 + 0.5 * vUv.y) + 0.12 * sin(ang * 14.0), big);             // florets, shaded beneath
    col *= 1.0 - 0.3 * big * smoothstep(0.55, 1.0, r / edge);                                           // each bloom edged, so a carpet of them still reads as blooms
  }
  if (a <= 0.002) discard;
  gl_FragColor = uMode < 0.5 ? vec4(col * a, a) : vec4(col * a, 0.0);
}`;

// ---- the city on the northern horizon: three planes of ink towers standing in mist -------------------
const CITY = {
  bearing: 15.5,                                 // degrees north of west, from the valley's origin
  planes: [
    { dist: 31, span: [-6.0, 7.5], towers: 30, tall: [0.55, 2.3], tone: 0.0 },
    { dist: 41, span: [-7.0, 8.5], towers: 38, tall: [0.8, 3.2], tone: 0.5 },
    { dist: 54, span: [-7.5, 9.5], towers: 44, tall: [1.0, 4.2], tone: 1.0 },
  ],
  windows: 2600,
};
const CITY_VERT = /* glsl */ `
attribute vec3 aInfo;           // plane 0..1 (near..far), height above the foot (units), shade
varying vec3 vInfo; varying vec3 vW;
void main() { vInfo = aInfo; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const CITY_FRAG = /* glsl */ `
uniform vec3 uInk0, uInk1, uInk2, uMist;
varying vec3 vInfo; varying vec3 vW;
void main() {
  vec3 ink = (vInfo.x < 0.25 ? uInk0 : (vInfo.x < 0.75 ? uInk1 : uInk2)) * (0.97 + 0.06 * vInfo.z);   // three flat planes, paler with distance
  vec3 c = mix(uMist, ink, smoothstep(0.05, mix(0.9, 1.7, vInfo.x), vInfo.y));                         // the feet stand in mist
  gl_FragColor = vec4(c, 1.0);
}`;
const MIST_FRAG = NOISE + /* glsl */ `
uniform vec3 uMist;
varying vec3 vInfo; varying vec3 vW;
void main() {
  float n = 0.5 + 0.5 * snoise(vec2(vW.x * 0.13 + vInfo.x * 9.0, vW.z * 0.13));
  float a = (1.0 - smoothstep(0.1, 1.0, vInfo.y / (0.75 + 0.9 * n))) * vInfo.z;
  gl_FragColor = vec4(uMist * a, a);
}`;

// ---- small pieces ---------------------------------------------------------------------------------------
const DRAPE_VERT = /* glsl */ `
varying vec3 vW; varying vec2 vUv2;
void main() { vW = position; vUv2 = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const SHADOW_FRAG = TREE_SHADOW_GLSL + /* glsl */ `
uniform vec3 uShadowTint; uniform float uShadowAmt;
varying vec3 vW; varying vec2 vUv2;
void main() {
  float sh = (1.0 - treeShadow(vW)) * uShadowAmt * smoothstep(0.0, 0.08, vUv2.x) * smoothstep(1.0, 0.92, vUv2.x) * smoothstep(1.0, 0.8, vUv2.y);
  if (sh < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(1.0), uShadowTint, sh), 1.0);
}`;
const PATH_FRAG = NOISE + /* glsl */ `
uniform vec3 uSunColF, uAmbF, uFillColF;
varying vec3 vW; varying vec2 vUv2;
void main() {
  float edge = abs(vUv2.x * 2.0 - 1.0) + 0.35 * snoise(vW.xz * 160.0) + 0.2 * snoise(vW.xz * 520.0);
  float a = (1.0 - smoothstep(0.45, 1.0, edge)) * 0.9;
  vec3 alb = vec3(0.30, 0.235, 0.15) * (0.82 + 0.3 * snoise(vW.xz * 90.0));
  gl_FragColor = vec4(alb * (uAmbF + uSunColF * 0.12 + uFillColF * 0.2) * a, a);
}`;
const FLOOR_FRAG = /* glsl */ `
uniform vec3 uSunColF, uAmbF, uHazeF;
varying vec3 vW; varying vec2 vUv2;
void main() {
  vec3 col = vec3(0.07, 0.10, 0.03) * (uAmbF + uSunColF * 0.08);
  gl_FragColor = vec4(mix(col, uHazeF, 1.0 - exp(-distance(vW, cameraPosition) * 0.03)), 1.0);
}`;

/** The river's middle, half width and slope at distance D up the valley, from the landscape's own table (year 10,000: one channel). */
function riverReader(land) {
  const data = land._.U.tRiver.value.image.data, N = 1024, A = 7.06, B = 5.6, V0 = 0.33;
  return (D) => {
    const x = D / A, fx = Math.min(N - 1.001, Math.max(0, (V0 + Math.log(x + Math.sqrt(x * x + 1)) / B) * N - 0.5));
    const i = Math.floor(fx), f = fx - i, o = i * 4;
    return [lerp(data[o], data[o + 4], f), lerp(data[o + 1], data[o + 5], f), lerp(data[o + 2], data[o + 6], f)];
  };
}

// ======================================================================================================
// The one scene, built once per renderer
const SHARED = new WeakMap();   // renderer -> { promise, refs }

async function buildShared(ctx) {
  const scene = new THREE.Scene();
  scene.name = 'field';
  const rng = createRng('field');
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // ---- GRAIN's valley, year 10,000 ----
  const land = await createLandscape(ctx, { particles: false, stones: false });
  scene.add(land.group);
  land.update(0, { year: 10000 });
  const ground = (x, z) => land.groundHeight(x, z, 10000) || 0;
  const river = riverReader(land);
  {
    // the river rises at the mountain's foot: its upper course on the far slope (a pale squiggle from here) is left dry.
    // (The landscape rebuilds this table only when its year changes, and FIELD holds it at 10,000.)
    const tex = land._.U.tRiver.value, d = tex.image.data, N = 1024;
    for (let i = 0; i < N; i++) { const D = 7.06 * Math.sinh(((i + 0.5) / N - 0.33) * 5.6); d[i * 4 + 3] *= 1 - sstep(46, 62, D); }
    tex.needsUpdate = true;
  }

  // ---- the tree ----
  const tree = createTree({ seed: 'grain-tree', leafCount: 70000, leafSize: 0.42 });
  tree.group.position.set(...SEED_SPOT);
  tree.group.scale.setScalar(TREE_UNIT);
  scene.add(tree.group);

  // ---- the ground map: height, water and path distances, for everything that stands on the meadow ----
  const GX0 = -3.4, GX1 = 3.4, GZ0 = -6.6, GZ1 = 2.2, GNX = 544, GNZ = 704;
  const gdata = new Uint16Array(GNX * GNZ * 4), half = THREE.DataUtils.toHalfFloat;
  for (let j = 0, o = 0; j < GNZ; j++) {
    const z = GZ0 + ((j + 0.5) / GNZ) * (GZ1 - GZ0), D = -z;
    const [rx, hw, sl] = river(D), px = keyed(FOOT_X, D);
    const rk = 1 / Math.sqrt(1 + sl * sl);
    for (let i = 0; i < GNX; i++, o += 4) {
      const x = GX0 + ((i + 0.5) / GNX) * (GX1 - GX0);
      gdata[o] = half(ground(x, z));
      gdata[o + 1] = half(Math.max(-0.2, Math.min(0.5, Math.abs(x - rx) * rk - hw)));
      gdata[o + 2] = half(Math.min(0.5, Math.abs(x - px)));
      gdata[o + 3] = half(1);
    }
  }
  const groundTex = keep(new THREE.DataTexture(gdata, GNX, GNZ, THREE.RGBAFormat, THREE.HalfFloatType));
  groundTex.minFilter = groundTex.magFilter = THREE.LinearFilter;
  groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
  groundTex.generateMipmaps = false;
  groundTex.needsUpdate = true;

  // ---- uniforms shared by everything of ours ----
  const FU = {
    tGround: { value: groundTex }, uGroundMap: { value: new THREE.Vector4(GX0, GZ0, 1 / (GX1 - GX0), 1 / (GZ1 - GZ0)) },
    uCamXZ: { value: new THREE.Vector2() }, uFwdXZ: { value: new THREE.Vector2(0, -1) }, uTimeF: { value: 0 },
    uSunDirF: { value: new THREE.Vector3(0, 0.1, -1) }, uSunColF: { value: new THREE.Color() }, uAmbF: { value: new THREE.Color() },
    uFillColF: { value: new THREE.Color() }, uHazeF: { value: new THREE.Color() },
    uWindF: { value: new THREE.Vector4(0.42, -0.91, 1, 0) }, uResF: { value: new THREE.Vector2(2160, 1080) },
    uLens: { value: new THREE.Vector4(0, 1, 30, 0.012) }, uShadeF: { value: new THREE.Vector4(1, 0, 0.88, 0) },
    uGrassShade: { value: new THREE.Color() }, uGrassLit: { value: new THREE.Color() }, uGrassGold: { value: new THREE.Color() }, uLevel: { value: new THREE.Vector4(1, 1, 0, 0) },
  };
  const setRes = (renderer) => {
    const rt = renderer.getRenderTarget();
    if (rt) FU.uResF.value.set(rt.width, rt.height); else renderer.getDrawingBufferSize(FU.uResF.value);
  };

  // ---- a floor under the valley, for a plate that looks past the landscape's edge ----
  {
    const geo = keep(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2).translate(0, -0.035, 0));
    const mat = keep(new THREE.ShaderMaterial({ name: 'field-floor', uniforms: FU, vertexShader: DRAPE_VERT, fragmentShader: FLOOR_FRAG }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -12; mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // ---- the tree's long shadow, draped on the meadow (multiply) ----
  const shadowU = { ...tree.uniforms, uShadowTint: { value: new THREE.Color(0.4, 0.45, 0.6) }, uShadowAmt: { value: 1 } };
  const shadowGeo = keep(new THREE.PlaneGeometry(1, 1, 40, 150));
  const shadowMesh = new THREE.Mesh(shadowGeo, keep(new THREE.ShaderMaterial({
    name: 'field-tree-shadow', uniforms: shadowU, vertexShader: DRAPE_VERT, fragmentShader: SHADOW_FRAG,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })));
  shadowMesh.frustumCulled = false; shadowMesh.renderOrder = 1;
  scene.add(shadowMesh);
  const shadowUV = shadowGeo.attributes.uv.array.slice();
  let shadowKey = '';
  /** Lay the shadow strip from the tree along the sun's ground direction (rebuilt only when the sun moves). */
  function layShadow(sunDir) {
    const len = Math.min(4.2, 0.33 / Math.max(Math.tan(Math.asin(clamp01(sunDir.y))), 0.03) + 0.3), half_ = 0.27;
    const hx = -sunDir.x, hz = -sunDir.z, hl = Math.hypot(hx, hz) || 1;
    const key = `${(hx / hl).toFixed(4)}|${(hz / hl).toFixed(4)}|${len.toFixed(3)}`;
    if (key === shadowKey) return;
    shadowKey = key;
    const p = shadowGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = shadowUV[i * 2], v = shadowUV[i * 2 + 1];
      const along = -0.2 + v * len, across = (u - 0.5) * 2 * half_;
      const x = SEED_SPOT[0] + (hx / hl) * along + (hz / hl) * across, z = SEED_SPOT[2] + (hz / hl) * along - (hx / hl) * across;
      p.setXYZ(i, x, ground(x, z) + 0.0006, z);
    }
    p.needsUpdate = true;
  }

  // ---- the footpath ----
  {
    const N = 360, pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
    for (let i = 0; i <= N; i++) {
      const D = -2.4 + (i / N) * 6.6, x = keyed(FOOT_X, D), dx = (keyed(FOOT_X, D + 0.01) - keyed(FOOT_X, D - 0.01)) / 0.02;
      const w = (0.62 + 0.14 * Math.sin(D * 31) + 0.1 * Math.sin(D * 77)) * M, nx = 1 / Math.hypot(1, dx);
      for (let s = 0; s < 2; s++) {
        const px = x + (s ? 1 : -1) * w * nx, pz = -D + (s ? 1 : -1) * w * dx * nx;
        pos.set([px, ground(px, pz) + 0.0005, pz], (i * 2 + s) * 3);
        uv.set([s, i / N], (i * 2 + s) * 2);
      }
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, keep(new THREE.ShaderMaterial({
      name: 'field-footpath', uniforms: FU, vertexShader: DRAPE_VERT, fragmentShader: PATH_FRAG, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })));
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    scene.add(mesh);
  }

  // ---- the sun's glitter path on the river: a ribbon of sparks over the water, where it lies under the sun ----
  const glintU = { ...FU, uGlint: { value: new THREE.Color() } };
  {
    const N = 900, pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
    for (let i = 0; i <= N; i++) {
      const D = -2.4 + 46 * Math.pow(i / N, 1.6), [rx, hw, sl] = river(D), nx = 1 / Math.hypot(1, sl), w = hw * 0.94;
      for (let k = 0; k < 2; k++) {
        const sg = k ? 1 : -1, px = rx + sg * w * nx, pz = -D + sg * w * sl * nx;
        pos.set([px, ground(rx, -D) + 0.0012, pz], (i * 2 + k) * 3);
        uv.set([k, D], (i * 2 + k) * 2);
      }
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, keep(new THREE.ShaderMaterial({
      name: 'field-river-glitter', uniforms: glintU, vertexShader: DRAPE_VERT, side: THREE.DoubleSide,
      fragmentShader: NOISE + /* glsl */ `
        uniform vec3 uGlint, uSunDirF; uniform float uTimeF;
        varying vec3 vW; varying vec2 vUv2;
        void main() {
          vec3 v = normalize(vW - cameraPosition);
          float az = max(dot(normalize(v.xz), normalize(uSunDirF.xz + 1e-5)), 0.0);
          float toward = pow(az, 5.0);                                                                          // dense under the sun, thinning away from it
          float fw = max(fwidth(vW.x), fwidth(vW.z));
          vec2 q = vec2(vW.x * 230.0, vW.z * 64.0 + uTimeF * 4.0);
          float n = snoise(q) * 0.6 + snoise(q * 2.7 + 9.0 + uTimeF * 1.7) * 0.4;
          float spark = pow(max(n - 0.62 * (1.0 - toward), 0.0), 2.0) * 9.0;
          spark = mix(spark, 0.5 * toward, smoothstep(0.002, 0.02, fw));                                        // too far to count the sparks: their sum
          float bank = smoothstep(0.0, 0.3, vUv2.x) * smoothstep(1.0, 0.7, vUv2.x);
          gl_FragColor = vec4(uGlint * (0.25 + 0.75 * toward) * spark * bank, 0.0);
        }`,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })));
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    scene.add(mesh);
  }

  // ---- grass ----
  const grass = GRASS_RINGS.map((ring, k) => {
    const r = rng.fork('grass' + k), seeds = new Float32Array(ring.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = r();
    const rows = ring.segs + 1, pos = [], idx = [];
    for (let j = 0; j < rows; j++) pos.push(-0.5, j / ring.segs, 0, 0.5, j / ring.segs, 0);
    for (let j = 0; j < ring.segs; j++) idx.push(j * 2, j * 2 + 1, j * 2 + 3, j * 2, j * 2 + 3, j * 2 + 2);
    const geo = keep(new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = ring.count;
    const mat = keep(new THREE.ShaderMaterial({
      name: 'field-grass-' + k, uniforms: { ...tree.uniforms, ...FU, uRing: { value: new THREE.Vector4(ring.L, ring.width, ring.tall, k) } },
      vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4 - k;                    // far ring first
    mesh.onBeforeRender = setRes;
    scene.add(mesh);
    return mesh;
  });

  // ---- the city: towers (one mesh), mist (one mesh), windows (instances of the discs) ----
  const cityU = {
    uInk0: { value: new THREE.Color() }, uInk1: { value: new THREE.Color() }, uInk2: { value: new THREE.Color() }, uMist: { value: new THREE.Color() },
  };
  const windows = [];
  {
    const r = rng.fork('city'), pos = [], info = [], idx = [], mpos = [], minfo = [], midx = [];
    const b = CITY.bearing * D2R, ax = [Math.sin(b), -Math.cos(b)], lat = [Math.cos(b), Math.sin(b)];   // away from the origin; along the plane (rightwards)
    const quad = (P, I, X, arr, inf, p0, p1, y0, y1, plane, shade, foot) => {
      const n = arr.length / 3;
      for (const [u, y] of [[p0, y0], [p1, y0], [p1, y1], [p0, y1]]) {
        arr.push(P[0] + lat[0] * u, y, P[1] + lat[1] * u);
        inf.push(plane, y - foot, shade);
      }
      X.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };
    CITY.planes.forEach((pl, k) => {
      const P = [ax[0] * pl.dist, ax[1] * pl.dist];
      const foot = Math.min(ground(P[0], P[1]), ground(P[0] + lat[0] * pl.span[1] * 0.5, P[1] + lat[1] * pl.span[1] * 0.5), 0.3) - 0.05;
      // a range of towers: the skyline of each plane is a few peaks with shoulders
      const peaks = Array.from({ length: 3 + k }, () => [r.range(pl.span[0] * 0.85, pl.span[1] * 0.85), r.range(0.55, 1), r.range(1.0, 2.6)]);
      peaks[0][1] = 1;
      const env = (u) => peaks.reduce((m, [c, h, w]) => Math.max(m, h * Math.exp(-(((u - c) / w) ** 2))), 0.12);
      for (let i = 0; i < pl.towers; i++) {
        const u = lerp(pl.span[0], pl.span[1], (i + r.range(0.1, 0.9)) / pl.towers);
        const w = r.range(0.16, 0.42) * (1 + 0.25 * k), h = lerp(pl.tall[0], pl.tall[1], env(u) * r.range(0.62, 1) ** 1.2);
        const shade = r(), top = foot + h;                                 // (shade: a breath of variation, the planes stay flat)
        quad(P, k, idx, pos, info, u - w / 2, u + w / 2, foot - 0.3, top, k / 2, shade, foot);
        let crown = top;
        if (r.chance(0.6)) { const w2 = w * r.range(0.45, 0.72), h2 = h * r.range(0.08, 0.2), o = (r() - 0.5) * (w - w2); quad(P, k, idx, pos, info, u + o - w2 / 2, u + o + w2 / 2, top, top + h2, k / 2, shade, foot); crown = top + h2; }
        if (r.chance(0.45)) { const o = (r() - 0.5) * w * 0.5; quad(P, k, idx, pos, info, u + o - 0.012, u + o + 0.012, crown, crown + h * r.range(0.1, 0.3), k / 2, shade, foot); }
        if (r.chance(0.3)) { const o = (r() - 0.5) * w * 0.6; quad(P, k, idx, pos, info, u + o - 0.035, u + o + 0.035, crown, crown + 0.05, k / 2, shade, foot); }   // a water tank
        // its windows: a grid on the face, a share of them lit at dusk
        const cols = Math.max(2, Math.round(w / 0.055)), rowsN = Math.max(3, Math.round(h / 0.045));
        const want = Math.round((CITY.windows / (CITY.planes.length * pl.towers)) * (0.4 + 1.2 * r()) * (h / pl.tall[1] + 0.3));
        for (let j = 0; j < want; j++) {
          const cu = u - w / 2 + ((r.int(0, cols - 1) + 0.5) / cols) * w, cy = foot + ((r.int(1, rowsN - 1) + 0.5) / rowsN) * h;
          if (cy - foot < 0.22 * (1 + k * 0.4)) continue;                  // none down in the mist
          // only those the meadow can see over the valley's side (their discs are drawn well in front of their towers,
          // so the hills cannot hide them later)
          const wx = P[0] + lat[0] * cu - ax[0] * 0.25, wz = P[1] + lat[1] * cu - ax[1] * 0.25;
          let seen = true;
          for (let q = 0.12; q < 0.99 && seen; q += 0.04) seen = ground(lerp(0.85, wx, q), lerp(0.1, wz, q)) < lerp(0.08, cy, q) - 0.05;
          if (seen) windows.push([wx, cy, wz]);
        }
      }
      // the mist it stands in: a band in front of the plane, and one behind the nearest
      const Pm = [P[0] - ax[0] * 0.6, P[1] - ax[1] * 0.6], mh = 0.9 + 0.5 * k, cols = [pl.span[0] - 12, pl.span[0] - 3, pl.span[1] + 3, pl.span[1] + 12];
      const m0 = mpos.length / 3;
      cols.forEach((u, c) => { for (const y of [foot - 0.3, foot + mh * 2.4]) { mpos.push(Pm[0] + lat[0] * u, y, Pm[1] + lat[1] * u); minfo.push(k / 2, y - (foot - 0.3), c === 0 || c === 3 ? 0 : 1); } });
      for (let c = 0; c < 3; c++) midx.push(m0 + c * 2, m0 + c * 2 + 2, m0 + c * 2 + 3, m0 + c * 2, m0 + c * 2 + 3, m0 + c * 2 + 1);
    });
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
    geo.setIndex(idx);
    const towers = new THREE.Mesh(geo, keep(new THREE.ShaderMaterial({ name: 'field-city', uniforms: cityU, vertexShader: CITY_VERT, fragmentShader: CITY_FRAG, side: THREE.DoubleSide })));
    towers.frustumCulled = false; towers.renderOrder = -5;
    scene.add(towers);
    const mgeo = keep(new THREE.BufferGeometry());
    mgeo.setAttribute('position', new THREE.Float32BufferAttribute(mpos, 3));
    mgeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(minfo, 3));
    mgeo.setIndex(midx);
    const mist = new THREE.Mesh(mgeo, keep(new THREE.ShaderMaterial({
      name: 'field-city-mist', uniforms: cityU, vertexShader: CITY_VERT, fragmentShader: MIST_FRAG, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    })));
    mist.frustumCulled = false; mist.renderOrder = 0;
    scene.add(mist);
  }

  // ---- the discs: flowers and windows ----
  const discU = {
    ...tree.uniforms, ...FU,
    uMode: { value: 0 }, uDisc: { value: new THREE.Vector4(0, 0, 1, 3) }, uSel: { value: new THREE.Vector3(0.02, 0.008, 0.011) },
    uBokeh: { value: new THREE.Vector4(1, 0.7, 0.35, 0.2) }, uPick: { value: new THREE.Vector4(1.6, 0, 0.06, 0) }, uBokehLo: { value: new THREE.Vector3() }, uFlowerCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  };
  let flowersMesh, discsMesh;
  {
    const nF = FLOWER_RINGS.reduce((s, f) => s + f.count, 0), n = nF + windows.length;
    const A = new Float32Array(n * 4), Bq = new Float32Array(n * 4), r = rng.fork('flowers');
    let o = 0;
    for (const ring of FLOWER_RINGS) for (let i = 0; i < ring.count; i++, o += 4) {
      A[o] = r(); A[o + 1] = r(); A[o + 2] = r(); A[o + 3] = r();
      Bq[o] = ring.L; Bq[o + 1] = ring.size * (0.75 + 0.5 * r()); Bq[o + 2] = r(); Bq[o + 3] = r();
    }
    r.shuffle(windows);
    windows.forEach((w, i) => {
      A[o] = w[0]; A[o + 1] = w[1]; A[o + 2] = w[2]; A[o + 3] = r();
      Bq[o] = 0; Bq[o + 1] = 0.02; Bq[o + 2] = r(); Bq[o + 3] = (i + r()) / windows.length; o += 4;
    });
    const geo = keep(new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(Bq, 4));
    geo.instanceCount = n;
    const mk = (mode, name) => {
      const mat = keep(new THREE.ShaderMaterial({
        name, uniforms: { ...discU, uMode: { value: mode } }, vertexShader: DISC_VERT, fragmentShader: DISC_FRAG,
        transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: mode ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: mode ? THREE.ZeroFactor : THREE.OneFactor, blendDstAlpha: mode ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.name = name; mesh.onBeforeRender = setRes;
      scene.add(mesh);
      return mesh;
    };
    flowersMesh = mk(0, 'field-flowers'); flowersMesh.renderOrder = 5;                               // over the grass, in the main pass
    discsMesh = mk(1, 'field-discs'); discsMesh.renderOrder = 30; discsMesh.layers.set(FX_LAYER);    // sharp over the depth of field
  }

  // ---- the walker and the long shadow it trails ----
  const walker = createFigure({ seed: 'hero' });
  walker.mesh.scale.setScalar(M);
  scene.add(walker.mesh);
  const wsU = { uShadowTint: shadowU.uShadowTint, uShadowAmt: { value: 1 } };
  const walkerShadow = { mesh: new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0)), keep(new THREE.ShaderMaterial({
    name: 'field-walker-shadow', uniforms: wsU, vertexShader: /* glsl */ `varying vec2 vUv2; void main() { vUv2 = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uShadowTint; uniform float uShadowAmt; varying vec2 vUv2;
      void main() {
        float across = abs(vUv2.y * 2.0 - 1.0), w = mix(0.9, 0.5, vUv2.x) * (1.0 + 0.6 * smoothstep(0.86, 0.96, vUv2.x));     // the head, at the far end
        float sh = (1.0 - smoothstep(w * 0.45, w, across)) * smoothstep(0.0, 0.03, vUv2.x) * (1.0 - smoothstep(0.93, 1.0, vUv2.x)) * mix(0.9, 0.5, vUv2.x) * uShadowAmt;
        gl_FragColor = vec4(mix(vec3(1.0), uShadowTint, sh), 1.0);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }))) };
  walkerShadow.mesh.frustumCulled = false;
  walkerShadow.mesh.renderOrder = 6;
  scene.add(walkerShadow.mesh);

  // ---- the migration ----
  const flock = createFlock({ count: 39000, seed: 'migration' });       // the river: from over the lens, above and ahead, into the sun
  const strays = createFlock({ count: 1000, seed: 'stragglers' });      // the few low over the flowers (40,000 in all)
  for (const f of [flock, strays]) { f.mesh.scale.setScalar(M); f.mesh.renderOrder = 8; scene.add(f.mesh); }

  // ---- our butterfly ----
  const hero = createButterfly({ lod: 'hero', seed: 'hero' });
  hero.group.scale.setScalar(M * 0.01 * HERO.scale);    // built in centimetres; a little larger than life, to read by the lens
  scene.add(hero.group);

  const sunV = new THREE.Vector3(), tmpC = new THREE.Color(), fwd = new THREE.Vector3();
  const mAxis = new THREE.Matrix4(), vX = new THREE.Vector3(), vY = new THREE.Vector3(), vZ = new THREE.Vector3();

  /**
   * Set every part of the scene from one state object (nothing is remembered between calls).
   * s: { t, sunElevation, sunAzimuth, cloudCover, exposure, cityLights, lightsOut, flowers, flock, walker,
   *      hero: { t0 } | null, lens: { focus, aperture, maxBlur } | null, plate: bool }
   */
  function apply(s, camera) {
    const t = s.t, plate = !!s.plate;
    land.update(t, {
      year: 10000, season: 0.74, snowline: 40, sunElevation: s.sunElevation, sunAzimuth: s.sunAzimuth,
      cloudCover: s.cloudCover, cloudSpeed: 1.2, fog: s.fog ?? 0.6, exposure: (s.exposure ?? 0) + 1.15 * sstep(3.0, -3.0, s.sunElevation), shafts: s.plate ? sstep(-2.0, 1.0, s.sunElevation) : 1, riverGold: 1, riverCalm: 0.85,
      night: 0, starVisibility: 0,
    });
    const L = land.lighting(), LU = land._.U;
    const gr = { ...FIELD_GRADE, ...(s.grade || {}) }, P = (hex) => paintHDR(hex, gr);
    const el = s.sunElevation, gold = sstep(-2.5, 4.5, el), after = sstep(-12, -2.5, el);
    const west = sstep(0.6, 0.95, 0.5 + 0.5 * Math.cos((s.sunAzimuth ?? 0) * D2R)) * (1 - sstep(9, 20, el));   // our art direction: the sun low in the west
    const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    if (west > 0) {
      // the sky: a warm horizon (#FFB25E), rose (#C4553A) above it, a clean deep blue-violet top (#1B2440); at dusk
      // #E0785A under #2A2F55. The landscape's sky is zen * (1 + 1.5 e^-6u) + mid * e^-11u + hor * e^-30u (u = sin
      // elevation): solve its three colours for the palette at the horizon, at 5 degrees and at the top
      const top = mix3(P(PALETTE.duskSky), P(PALETTE.fieldSkyTop), gold), hor0 = mix3(P(PALETTE.duskHorizon), P(PALETTE.fieldHorizon), gold);
      const rose = mix3(mix3(P(PALETTE.duskSky), P(PALETTE.duskHorizon), 0.3), P(PALETTE.fieldSkyMid), gold);
      const zf = lerp(1.43, 1.19, gold), zen = [], mid = [], hor = [];
      for (let c = 0; c < 3; c++) {
        zen[c] = (top[c] * 0.82) / zf;
        const a = Math.max(rose[c] - 1.889 * zen[c], 0.004), b = Math.max(hor0[c] - 2.42 * zen[c], 0.006);      // 0.383 m + 0.073 h = a;  0.909 m + 0.770 h = b
        hor[c] = Math.max((b - (0.909 / 0.383) * a) / (0.770 - (0.909 / 0.383) * 0.073), 0.004);
        mid[c] = Math.max((a - 0.073 * hor[c]) / 0.383, 0.004);
        hor[c] *= after; mid[c] *= after * after;
      }
      const set = (u, v) => u.value.setRGB(lerp(u.value.r, v[0], west), lerp(u.value.g, v[1], west), lerp(u.value.b, v[2], west));
      set(LU.uTwZen, zen); set(LU.uTwMid, mid); set(LU.uTwHor, hor);
      // the air: far things go to a cool rose-violet (the ridge against the sky), gold only toward the sun
      const far = mix3(P('#4A4468'), P('#7E6E96'), gold), sunward = mix3(hor0, rose, 0.35);
      LU.uTwHaze.value.x = lerp(LU.uTwHaze.value.x, far[0], west); LU.uTwHaze.value.y = lerp(LU.uTwHaze.value.y, far[1], west); LU.uTwHaze.value.z = lerp(LU.uTwHaze.value.z, far[2], west); LU.uTwHaze.value.w = lerp(LU.uTwHaze.value.w, 1, west);
      set(LU.uFogColor, far); set(LU.uFogSunColor, sunward.map((x) => x * after));
      // the river: a ribbon of gold (#FFD08A), a little under the sky's own brightness; the sparks are ours (below)
      const riv = P(PALETTE.river), rk = lerp(0.3, 0.6, gold) * (0.4 + 0.6 * after);
      LU.uSkyRefl.value.x = lerp(LU.uSkyRefl.value.x, riv[0] * rk, west); LU.uSkyRefl.value.y = lerp(LU.uSkyRefl.value.y, riv[1] * rk, west); LU.uSkyRefl.value.z = lerp(LU.uSkyRefl.value.z, riv[2] * rk, west);
      LU.uSkyReflZ.value.set(LU.uSkyRefl.value.x * 0.62, LU.uSkyRefl.value.y * 0.62, LU.uSkyRefl.value.z * 0.68);
    }
    if (west > 0) LU.uVegTint.value.set(lerp(LU.uVegTint.value.x, 0.62, west), lerp(LU.uVegTint.value.y, 0.98, west), lerp(LU.uVegTint.value.z, 0.8, west));   // the floor under our blades: green, not straw
    // the meadow's share of the sun: it sets in the notch south of the mountain, so the grass keeps it to the horizon
    const sunVis = sstep(-0.5, 2.2, s.sunElevation);
    sunV.copy(L.sunDir);
    FU.uTimeF.value = t;
    FU.uSunDirF.value.copy(sunV);
    FU.uSunColF.value.copy(L.sunColor).multiplyScalar(sunVis);
    FU.uAmbF.value.copy(L.ambient);
    FU.uFillColF.value.copy(LU.uFillColor.value);
    FU.uHazeF.value.copy(LU.uFogColor.value).multiplyScalar(0.8);
    // the meadow in the palette: lit grass #E9B44C (leaning green where the sun does not come through it), its
    // shade side #2E3B1F, at dusk #3F5A2A; the flowers their own colours
    const ev = Math.pow(2, s.exposure ?? 0), sky = lerp(1, 0.9 * Math.min(ev, 1.6), 1 - gold) * (0.35 + 0.65 * sstep(-9, -3, el));
    FU.uGrassShade.value.setRGB(...mix3(P(PALETTE.duskGrass), P(PALETTE.fieldGrassShadow), gold));
    FU.uGrassLit.value.setRGB(...P('#A9B84A'));
    FU.uGrassGold.value.setRGB(...P(PALETTE.fieldGrassLit));
    FU.uLevel.value.set(sunVis, sky, 0, 0);
    [PALETTE.buttercup, PALETTE.clover, PALETTE.daisy].forEach((hex, i) => discU.uFlowerCol.value[i].fromArray(P(hex)));
    const bk = P(PALETTE.bokeh);
    discU.uBokeh.value.set(bk[0], bk[1], bk[2], 0.2);
    glintU.uGlint.value.setRGB(...P(PALETTE.river)).multiplyScalar(1.5 * sunVis);
    // the lower the sun, the longer the shadows and the less of the meadow it still reaches
    FU.uShadeF.value.set(clamp01(Math.tan(Math.max(s.sunElevation, 0.8) * D2R) / Math.tan(6 * D2R)), lerp(0.42, -0.2, sstep(0.5, 6, s.sunElevation)), 0.84, 0);
    camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z);
    FU.uCamXZ.value.set(camera.position.x, camera.position.z);
    if (fl > 0.2) FU.uFwdXZ.value.set(fwd.x / fl, fwd.z / fl);
    else { vY.setFromMatrixColumn(camera.matrixWorld, 1); const ul = Math.hypot(vY.x, vY.z) || 1; FU.uFwdXZ.value.set(vY.x / ul, vY.z / ul); }
    const lens = s.lens;
    FU.uLens.value.set(lens ? lens.aperture : 0, lens ? lens.focus : 1, lens ? lens.maxBlur : 30, plate ? 0.03 : 0.011);

    tree.update(t, {
      growth: 1, season: 0.6, wind: 0.35, windDir: [0.42, 0, -0.91], loose: 1,
      sunDir: L.sunDir, sunColor: tmpC.copy(L.sunColor).multiplyScalar(sunVis), ambient: L.ambient,
      ground: [L.sunColor.r * 0.03 * sunVis + L.ambient.r * 0.05, L.sunColor.g * 0.035 * sunVis + L.ambient.g * 0.06, L.sunColor.b * 0.012 * sunVis + L.ambient.b * 0.03],
      fogColor: L.fogSunColor, fogAmount: 0.012, shafts: 0, seedRelease: 0,
    });
    // the tree's shadow: what is left in the shade is the sky's light
    const sinEl = Math.max(L.sunDir.y, 0.02), share = (a, c) => a / (a + c * (sinEl * 0.6 + 0.25) * 1.6 + 1e-5);
    shadowU.uShadowTint.value.setRGB(share(L.ambient.r, L.sunColor.r), share(L.ambient.g, L.sunColor.g), share(L.ambient.b, L.sunColor.b));
    shadowU.uShadowAmt.value = sunVis * clamp01((L.sunDir.y - 0.012) / 0.05);
    shadowMesh.visible = shadowU.uShadowAmt.value > 0.002;
    if (shadowMesh.visible) layShadow(L.sunDir);

    // the city: the one piece of the human world's ink left in this colour frame: cityInk (lighter with distance)
    // standing in cityMist, exactly as the palette writes them
    const day = 0.74 + 0.26 * sstep(-4, 2, el);
    cityU.uInk0.value.setRGB(...P(PALETTE.cityInk)).multiplyScalar(day);
    cityU.uInk2.value.setRGB(...P(PALETTE.dan)).multiplyScalar(day);
    cityU.uInk1.value.copy(cityU.uInk0.value).lerp(cityU.uInk2.value, 0.5);
    cityU.uMist.value.setRGB(...P(PALETTE.cityMist)).multiplyScalar(day);

    // ---- the backplate at dusk (GRASS's coda, S21 / S22): sky #2A2F55 over a band of afterglow #E0785A, the ground
    // #3F5A2A going to ink, the city dark against the band, and the lights: flowers and windows, one set of discs.
    // Only the plate comes here (pd = 0 for the world's own S20, and for any plate with the sun above 1 degree)
    const pd = plate ? sstep(1.0, -2.0, el) : 0, nt = sstep(-2.0, -5.5, el), many = Math.max(0, s.discs ?? 1);
    FU.uWindF.value.z = lerp(1, 0.3, pd);
    discU.uPick.value.set(3.0 * many, pd, Math.min(1, 0.1 * many), 0);
    if (pd > 0) {
      const setL = (u, v) => u.value.setRGB(lerp(u.value.r, v[0], pd), lerp(u.value.g, v[1], pd), lerp(u.value.b, v[2], pd));
      const dimmed = (hex, k) => P(hex).map((x) => x * k);
      // the sky fits the lens: zen * (1 + 1.5 e^-6u) + band * e^-(11 B u), the band two fifths of the height of the sky in frame
      const sinV = Math.max(Math.sin(0.5 * camera.fov * D2R), 0.02);
      const zen = dimmed(PALETTE.duskSky, (1 - 0.3 * nt) / 2.1);
      const band = P(PALETTE.duskHorizon).map((x, c) => Math.max(x - 2.5 * zen[c], 0) * (1 - 0.5 * nt));
      setL(LU.uTwZen, zen); setL(LU.uTwMid, band); setL(LU.uTwHor, [0, 0, 0]);
      LU.uTwBand.value = lerp(LU.uTwBand.value, Math.max(LU.uTwBand.value, 1 / (4.4 * sinV)), pd);
      setL(LU.uHorizonCol, zen.map((x, c) => 2.3 * x + 0.35 * band[c]));
      setL(LU.uCloudSun, band.map((x) => 0.5 * x)); setL(LU.uCloudAmb, zen.map((x) => 1.6 * x));
      // the land: no sun on it, only the sky's blue; the air and the far ground go to ink
      const inkFar = dimmed('#1E2836', 1 - 0.35 * nt);
      LU.uTwHaze.value.x = lerp(LU.uTwHaze.value.x, inkFar[0], pd); LU.uTwHaze.value.y = lerp(LU.uTwHaze.value.y, inkFar[1], pd); LU.uTwHaze.value.z = lerp(LU.uTwHaze.value.z, inkFar[2], pd);
      setL(LU.uFogColor, inkFar); setL(LU.uFogSunColor, dimmed('#33384E', 1 - 0.4 * nt));
      for (const u of [LU.uKeyColor, LU.uFillColor, LU.uBounce, LU.uAlpenColor, LU.uRim]) u.value.multiplyScalar(1 - pd);
      const lands = dimmed('#22302A', 1 - 0.4 * nt);                                      // what a grass slope comes to (its albedo is about 0.09, 0.18, 0.04)
      setL(LU.uAmbient, [lands[0] / 0.09, lands[1] / 0.18, lands[2] / 0.04]);
      FU.uAmbF.value.multiplyScalar(1 - 0.75 * pd); FU.uFillColF.value.multiplyScalar(1 - pd);
      setL(FU.uHazeF, dimmed('#171B28', 1 - 0.3 * nt));
      setL(FU.uGrassShade, P(PALETTE.duskGrass));
      const lvl = 0.85 * (1 - 0.5 * nt);
      FU.uLevel.value.set(FU.uLevel.value.x * (1 - pd), lerp(FU.uLevel.value.y, lvl, pd), 0, 0.7 * pd);
      // the flowers' own colour has all but gone: what is left of it is what the discs are
      ['#5C5A2C', '#4E3F58', '#5E6A5C'].forEach((hex, i) => { const c = P(hex), v = discU.uFlowerCol.value[i]; v.set(lerp(v.x, c[0] / 0.56, pd), lerp(v.y, c[1] / 0.56, pd), lerp(v.z, c[2] / 0.56, pd)); });
      // the discs: #FFD9A0 at their brightest, the same hue dimmer
      const hi = P(PALETTE.bokeh), lo = P('#8A6C48');
      discU.uBokeh.value.set(hi[0], hi[1], hi[2], lerp(0.2, 1, pd)); discU.uBokehLo.value.fromArray(lo);
      // the city: darker than the sky, its feet in the glow
      setL(cityU.uInk0, P(PALETTE.nong)); setL(cityU.uInk2, P('#2B2F4E'));
      cityU.uInk1.value.copy(cityU.uInk0.value).lerp(cityU.uInk2.value, 0.5);
      setL(cityU.uMist, dimmed('#C8705C', 1 - 0.5 * nt));
    }

    // flowers, windows, discs
    discU.uDisc.value.set(s.cityLights ?? 0, s.lightsOut ?? 0, s.flowers ?? 1, 1.25);

    // the walker
    const wOn = !plate && (s.walker ?? 0) > 0.5;
    walker.mesh.visible = wOn;
    walkerShadow.mesh.visible = wOn && sunVis * L.sunDir.y > 0.01;
    if (wOn) {
      const D = walkerD(t), x = keyed(FOOT_X, D), dx = (keyed(FOOT_X, D + 0.01) - keyed(FOOT_X, D - 0.01)) / 0.02;
      const turn = 90 + Math.atan(dx) / D2R;                               // 90 = facing west
      const y = ground(x, -D) + 0.0004;
      walker.mesh.position.set(x, y, -D);
      walker.set({ pose: { walk: 1 }, phase: t / (2 * STEP), turn, speck: 1 });
      if (walkerShadow.mesh.visible) {
        const len = Math.min(34, 1.7 / Math.max(Math.tan(Math.asin(L.sunDir.y)), 0.03)) * M;
        walkerShadow.mesh.position.set(x, y + 0.0004, -D);
        walkerShadow.mesh.rotation.set(0, Math.atan2(L.sunDir.z, -L.sunDir.x), 0);        // +X of the strip: away from the sun
        walkerShadow.mesh.scale.set(len, 1, 0.62 * M);
        wsU.uShadowAmt.value = shadowU.uShadowAmt.value * 0.9;
      }
    }

    // the river of butterflies: a ribbon that passes above us on the right and runs down the sky into the sun;
    // and the stragglers, low over the flowers along our own path
    const fOn = !plate && (s.flock ?? 0) > 0.01;
    flock.mesh.visible = strays.mesh.visible = fOn;
    // dev: s.hide = ['grass', 'flowers', 'discs', 'flock', 'city', 'tree'] switches parts off (cost breakdown)
    const hide = s.hide || [];
    grass.forEach((m) => { m.visible = !hide.includes('grass'); });
    flowersMesh.visible = !hide.includes('flowers'); discsMesh.visible = !hide.includes('discs'); tree.group.visible = !hide.includes('tree');
    if (hide.includes('flock')) flock.mesh.visible = strays.mesh.visible = false;
    if (fOn && !hide.includes('flock')) {
      const light = {
        sun: [sunV.x, Math.max(sunV.y, 0.05), sunV.z],
        sunColor: [L.sunColor.r * (0.25 + 0.75 * sunVis) + LU.uFillColor.value.r, L.sunColor.g * (0.25 + 0.75 * sunVis) + LU.uFillColor.value.g, L.sunColor.b * (0.25 + 0.75 * sunVis) + LU.uFillColor.value.b],
        ambient: [L.ambient.r * 1.5, L.ambient.g * 1.5, L.ambient.b * 1.5],
      };
      const line = (P, bearing, climb, back, len) => {
        const b = bearing * D2R, e = climb * D2R, d = [Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)];
        const from = [P[0] - d[0] * back, P[1] - d[1] * back, P[2] - d[2] * back];
        return { from, to: [from[0] + d[0] * len, from[1] + d[1] * len, from[2] + d[2] * len] };
      };
      // metres. The camera starts at (101, 3, 98) and flies on bearing -9.7. The river's line passes over the lens,
      // a little to the right, almost level, toward the notch where the sun will set: seen from under it, a ribbon
      // that meanders down the sky to the horizon and thins into the distance (FLOCK's `taper`)
      flock.set({ river: { ...line([110, 13, 98], s.sunAzimuth ?? -12, 1.0, 200, 2300), width: 10.5, height: [-6, 4], speed: 14.5 }, scale: 10, clear: 3.0, minPx: 2, ...light });
      strays.set({ river: { ...line([99, 1.0, 98], -9.7, 2.6, 110, 520), width: 10, height: [0.5, 7], speed: 13.2 }, scale: 7, clear: 3.0, minPx: 2, ...light });   // (speeds near the camera's own 12 m/s: near wings must not streak)
      flock.update(t); strays.update(t);
    }

    // our butterfly: comes down past the lens into focus, and peels away toward the grass
    const h = s.hero;
    hero.group.visible = !plate && !!h && t > h.t0 - HERO.lead;
    if (hero.group.visible) {
      const u = t - h.t0;                                                   // 0 = by the lens, in focus
      camera.updateMatrixWorld();
      vX.setFromMatrixColumn(camera.matrixWorld, 0); vY.setFromMatrixColumn(camera.matrixWorld, 1); vZ.setFromMatrixColumn(camera.matrixWorld, 2);
      const { right, up, ahead, turn: k } = heroLocal(u);
      hero.group.position.copy(camera.position).addScaledVector(vX, right * M).addScaledVector(vY, up * M).addScaledVector(vZ, -ahead * M);
      // attitude: it rises past the lens nose-up, its back (the blue, the notch) turned to us; then it rolls to
      // the right and goes down nose-first, and what we see of it is the underside: ink
      const hx = new THREE.Vector3().addScaledVector(vX, lerp(0.18, 0.62, k)).addScaledVector(vY, lerp(0.62, -0.72, k)).addScaledVector(vZ, lerp(-0.76, -0.55, k)).normalize();
      const upv = new THREE.Vector3().addScaledVector(vX, lerp(0.0, 0.55, k)).addScaledVector(vY, lerp(0.62, 0.7, k)).addScaledVector(vZ, lerp(0.78, 0.2, k)).normalize();
      const rightv = new THREE.Vector3().crossVectors(upv, hx).normalize();
      const up2 = new THREE.Vector3().crossVectors(hx, rightv);
      mAxis.makeBasis(rightv, up2, hx);                                     // body along +Z, dorsal +Y
      hero.group.quaternion.setFromRotationMatrix(mAxis);
      // It beats its way in, then holds its wings in a shallow V that opens and closes slowly while the focus
      // finds it, and beats away. Its key is the pale sky over our left shoulder: the blue lives in that light's
      // mirror lobe, so the two wings differ and the colour runs cyan, blue, violet, ink as they move. A warm
      // fill from the afterglow ahead comes through the membrane.
      const beat = u < -0.35 ? 4 * (u + 0.35) : (u > 0.5 ? 4 * (u - 0.5) : null);
      hero.set({
        open: 0.66 + 0.2 * Math.sin(u * 2.2 * 2 * Math.PI * 0.5 + 0.6), flap: beat, wear: 0.85, notch: 1, barePatch: 1, crumple: 0,
        lightDir: [vZ.x * 0.5 - vX.x * 0.42 + vY.x * 0.6, vZ.y * 0.5 - vX.y * 0.42 + vY.y * 0.6 + 0.25, vZ.z * 0.5 - vX.z * 0.42 + vY.z * 0.6],
        lightColor: [2.3, 2.3, 2.5],
        ambient: [0.10 + L.ambient.r * 0.5, 0.09 + L.ambient.g * 0.5, 0.10 + L.ambient.b * 0.5],
        sheenFill: 0.45,
      });
      hero.update(t);
    }
  }

  return {
    scene, land, tree, ground, apply,
    dispose() {
      land.dispose(); tree.dispose(); flock.dispose(); strays.dispose(); walker.dispose(); hero.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

function acquire(ctx) {
  let rec = SHARED.get(ctx.renderer);
  if (!rec) { rec = { promise: buildShared(ctx), refs: 0 }; SHARED.set(ctx.renderer, rec); }
  rec.refs++;
  return rec.promise.then((shared) => ({
    shared,
    release() { if (--rec.refs <= 0) { SHARED.delete(ctx.renderer); shared.dispose(); } },
  }));
}

// ======================================================================================================
// The world (S20)
export async function create(ctx) {
  const { shared, release } = await acquire(ctx);
  const camera = new THREE.PerspectiveCamera(lensToFov(FLIGHT.lens, ctx.aspect), ctx.aspect, 0.003, 2400);
  const focusOf = (shot, localT, t) => (shot && shot.params && shot.params.focus !== undefined ? evalValue(shot.params.focus, localT, t, shot) : 0);
  const d0 = FLIGHT.d0, g0 = shared.ground(keyed(CAM_X, d0), -d0);

  return {
    scene: shared.scene, camera,
    post: (t, localT, shot) => {
      const p = (shot && shot.params) || {}, at = p.at !== undefined;
      const tt = at ? p.at : t;
      return {
        bloom: 0.06, halation: 0.14,
        dof: lensOf(at && typeof p.focusAt === 'number' ? p.focusAt : focusOf(shot, localT, t)),
        ink: { pools: typeof p.hero === 'number' ? heroPool(tt, p.hero, camera.aspect) : [] },
      };
    },
    update(t, localT, shot, p) {
      if (p.at !== undefined) t = p.at;                                     // dev scenes: look at one film time under several grades
      const f = flight(t);
      const gy = lerp(g0, shared.ground(f.x, f.z), sstep(186, 191, t));     // level flight, then down to this meadow's own ground
      camera.position.set(f.x, gy + f.alt, f.z);
      camera.rotation.set(f.pitch * D2R, -f.yaw * D2R, f.roll * D2R, 'YXZ');
      camera.fov = lensToFov(FLIGHT.lens, camera.aspect);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      shared.apply({
        t, sunElevation: p.sunElevation ?? 6, sunAzimuth: p.sunAzimuth ?? -12, cloudCover: p.cloudCover ?? 0.38,
        exposure: p.exposure ?? 0, cityLights: p.cityLights ?? 0, flowers: p.flowerDensity ?? 1,
        flock: p.flock ?? 1, walker: p.walker ?? 1, hero: p.hero === undefined ? null : { t0: p.hero },
        lens: lensOf(p.at !== undefined && typeof p.focusAt === 'number' ? p.focusAt : (p.focus ?? 0)), grade: p.grade, hide: p.hide,
      }, camera);
    },
    dispose() { release(); },
  };
}

// ======================================================================================================
// The backplate for GRASS
const TRI_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const PLATE_FRAG = /* glsl */ `
uniform sampler2D tPlate; uniform vec2 uRes;
void main() { gl_FragColor = vec4(texture(tPlate, gl_FragCoord.xy / uRes).rgb, 1.0); }`;
// soften: a separable gaussian on a quarter-size copy; then sharp and soft are mixed and the sky greyed (ink cloud)
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uStep; varying vec2 vUv;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 0.19648;
  c += (texture(tSrc, vUv + uStep * 1.4118).rgb + texture(tSrc, vUv - uStep * 1.4118).rgb) * 0.29690;
  c += (texture(tSrc, vUv + uStep * 3.2941).rgb + texture(tSrc, vUv - uStep * 3.2941).rgb) * 0.09447;
  c += (texture(tSrc, vUv + uStep * 5.1765).rgb + texture(tSrc, vUv - uStep * 5.1765).rgb) * 0.01038;
  gl_FragColor = vec4(c, 1.0);
}`;
const MIX_FRAG = /* glsl */ `
uniform sampler2D tSharp, tSoft; uniform float uSoft, uInk; varying vec2 vUv;
void main() {
  vec3 c = mix(texture(tSharp, vUv).rgb, texture(tSoft, vUv).rgb, uSoft);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l) * vec3(0.93, 0.98, 1.03), 0.82 * uInk) * mix(1.0, 0.62, uInk);       // rain: the colour drains, the light falls
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * FIELD as a background for another world (ENGINE.md): the real scene, seen from a spot in the meadow
 * at butterfly height, in the caller's camera direction and field of view.
 *   const plate = await createFieldBackplate(ctx);  scene.add(plate.mesh);
 *   plate.set({ sunElevation, sunAzimuth, cloudCover, cityLights, defocus, lightsOut, heading, inkCloud });
 *   plate.update(t, camera);       // renders into plate.texture (linear HDR); restores the renderer
 * set() takes the whole state each time (keys left out return to their defaults). Also accepted: exposure (EV on the land), bokeh (px radius of the discs at 1080 lines when defocus = 1; 34),
 * flowers 0..1, eye (metres above the meadow; 0.9), spot [x, z], and
 *   grade      { exposure, contrast, saturation, tint }: YOUR shot's post values. The plate paints the script's
 *              palette as the radiance that grade returns to those colours (default: S20's grade, exposure -0.8;
 *              under another exposure the plate is that much too light or dark)
 *   discs      how many discs at dusk (1 = about 150 flowers in frame plus the city's windows)
 *   discLayer  true: the discs are left out of plate.mesh / plate.texture and shown by plate.discs (below)
 *
 * The plate is full frame size (the engine's width x height), RGBA16F, linear filtering; the background is softened
 * through a properly filtered quarter-size copy; the discs are drawn at full size with analytic edges (never under
 * 1.5 px of anti-aliasing), flowers and windows from one set (X11); every pixel is covered.
 *
 * AT DUSK (sunElevation at or below -2; down to -5 the last light goes; cityLights 1, defocus 1): sky #2A2F55 over
 * a band of afterglow #E0785A on the horizon, the ground #3F5A2A going to ink, the city dark against the band, and
 * the discs (#FFD9A0, ovals 1 : 1.5); lightsOut 0..1 puts them out one by one from the right edge leftward.
 *
 * COMPOSITING NEAR, OUT-OF-FOCUS THINGS OVER IT WITHOUT CUT-OUTS (the engine's depth of field takes its blur from
 * the depth buffer, and FX-layer sprites are cut by the SHARP depth of whatever is in front: that is the bite):
 *  A. with post.dof on (what tools/dev/scenes/fieldcoda.js does):
 *       plate.set({ discLayer: true });  scene.add(plate.mesh);  scene.add(plate.discs);
 *     plate.mesh (background only, main pass, far plane) is blurred once more by your DOF, which does it no harm;
 *     plate.discs (FX_LAYER, additive, far plane) is drawn sharp after the DOF and is hidden only by what WRITES
 *     DEPTH. So: things in focus (the hero blade, the butterfly, the grass at its foot) write depth and cut the
 *     discs cleanly; every blade that is out of focus gets `depthWrite: false` (keep depthTest). It is still blurred
 *     (it takes the far plane's circle of confusion, which is the maximum, as its own would be), and the discs
 *     shine over its blur instead of being bitten by its silhouette.
 *  B. with post.dof off: scene.add(plate.mesh) alone (discs inside it), and draw the out-of-focus blades yourself as
 *     soft ribbons (width + 2 x blur radius, alpha = coverage) with premultiplied alpha and `depthWrite: false`.
 *  Do not put plate.mesh itself on the FX layer, and keep `ink.mist` at 0 (the plate sits at the far plane).
 */
export async function createFieldBackplate(ctx) {
  const { shared, release } = await acquire(ctx);
  const renderer = ctx.renderer;
  const W = Math.max(8, Math.round(ctx.width)), H = Math.max(4, Math.round(ctx.height));
  const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, stencilBuffer: false };
  const flat = (w, h) => new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: false });
  const target = new THREE.WebGLRenderTarget(W, H, { ...opts, depthBuffer: true, samples: 4 });       // the plate (and its depth, for the discs)
  const sharp = flat(W, H), bg = flat(W, H);                                                           // the scene as it is; the softened background
  const hW = Math.max(4, W >> 1), hH = Math.max(4, H >> 1), qW = Math.max(4, W >> 2), qH = Math.max(4, H >> 2);
  const half = flat(hW, hH), soft = [flat(qW, qH), flat(qW, qH)];
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.003, 2400);

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const fsMat = (name, frag, uniforms) => new THREE.ShaderMaterial({ name, uniforms, vertexShader: TRI_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const copyMat = fsMat('field-plate-copy', /* glsl */ `uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, 1.0); }`, { tSrc: { value: null } });
  const blurMat = fsMat('field-plate-blur', BLUR_FRAG, { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
  const mixMat = fsMat('field-plate-mix', MIX_FRAG, { tSharp: { value: sharp.texture }, tSoft: { value: null }, uSoft: { value: 0 }, uInk: { value: 0 } });
  const fsScene = new THREE.Scene(), fsCam = new THREE.Camera(), fsMesh = new THREE.Mesh(tri, copyMat);
  fsMesh.frustumCulled = false;
  fsScene.add(fsMesh);

  const mkMesh = (name, texture, extra) => {
    const uniforms = { tPlate: { value: texture }, uRes: { value: new THREE.Vector2(W, H) } };
    const m = new THREE.Mesh(tri, new THREE.ShaderMaterial({
      name, uniforms, vertexShader: TRI_VERT, fragmentShader: PLATE_FRAG, depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, ...extra,
    }));
    m.name = name; m.frustumCulled = false; m.renderOrder = -100;
    m.onBeforeRender = (r) => { const rt = r.getRenderTarget(); if (rt) uniforms.uRes.value.set(rt.width, rt.height); else r.getDrawingBufferSize(uniforms.uRes.value); };
    return m;
  };
  const mesh = mkMesh('field-backplate', target.texture);
  // the discs alone, as light (premultiplied, on black): sharp over the caller's depth of field
  const discs = mkMesh('field-backplate-discs', target.texture, {
    transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  discs.layers.set(FX_LAYER);
  discs.visible = false;

  const DEFAULTS = {
    sunElevation: 6, sunAzimuth: -12, cloudCover: 0.38, cityLights: 0, defocus: 0, lightsOut: 0, heading: 0, inkCloud: 0,
    exposure: 0, bokeh: 34, flowers: 1, eye: 0.9, spot: [0.77, -0.66],     // the spot: where S20's camera comes down into the grass
    grade: null, discs: 1, discLayer: false,
  };
  let state = { ...DEFAULTS };
  const qHead = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), clearCol = new THREE.Color();
  const pass = (mat, to) => { fsMesh.material = mat; renderer.setRenderTarget(to); renderer.render(fsScene, fsCam); };
  const copy = (from, to) => { copyMat.uniforms.tSrc.value = from; pass(copyMat, to); };

  return {
    mesh, discs,
    /** What plate.mesh shows: the whole plate, or with discLayer its background alone. */
    get texture() { return mesh.material.uniforms.tPlate.value; },
    /** With discLayer: the discs alone (light on black). */
    discsTexture: target.texture,
    /** The whole state at once: a key left out returns to its default (nothing is remembered from an earlier call). */
    set(s = {}) { state = { ...DEFAULTS }; for (const k in s) if (s[k] !== undefined) state[k] = s[k]; },
    update(t, camera) {
      // the caller's direction and field of view, from our spot in the meadow
      camera.updateMatrixWorld();
      cam.quaternion.setFromRotationMatrix(camera.matrixWorld);
      cam.quaternion.premultiply(qHead.setFromAxisAngle(yAxis, -state.heading * D2R));
      cam.position.set(state.spot[0], shared.ground(state.spot[0], state.spot[1]) + state.eye * M, state.spot[1]);
      cam.fov = camera.isPerspectiveCamera ? camera.fov : 30;
      cam.aspect = camera.isPerspectiveCamera ? camera.aspect : W / H;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      const defocus = clamp01(state.defocus), ink = clamp01(state.inkCloud), layer = !!state.discLayer;
      shared.apply({
        t, plate: true, sunElevation: state.sunElevation, sunAzimuth: state.sunAzimuth,
        cloudCover: Math.max(state.cloudCover, 0.9 * ink), exposure: state.exposure,
        cityLights: state.cityLights, lightsOut: state.lightsOut, flowers: state.flowers,
        lens: defocus > 0.001 ? { aperture: defocus, focus: 0, maxBlur: state.bokeh } : null,
        grade: state.grade || undefined, discs: state.discs,
      }, cam);
      mesh.material.uniforms.tPlate.value = layer ? bg.texture : target.texture;
      discs.visible = layer;

      // render, leaving the renderer as we found it
      const prevRT = renderer.getRenderTarget(), prevFace = renderer.getActiveCubeFace(), prevMip = renderer.getActiveMipmapLevel();
      const prevAuto = renderer.autoClear, prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearCol);
      renderer.setClearColor(0x000000, 1);
      renderer.autoClear = true;
      renderer.setRenderTarget(target);
      if (defocus <= 0.001 && ink <= 0.001 && !layer) {
        cam.layers.set(0); cam.layers.enable(FX_LAYER);
        renderer.render(shared.scene, cam);                                 // sharp: one pass
      } else {
        // 1. the scene without its discs
        cam.layers.set(0);
        renderer.render(shared.scene, cam);
        copy(target.texture, sharp);
        // 2. soften: down to a quarter (each step a 2 x 2 box), a gaussian there in single-texel steps, and back up
        if (defocus > 0.001) {
          copy(sharp.texture, half); copy(half.texture, soft[0]);
          const sigma = (0.62 * defocus * state.bokeh * (H / 1080)) / 4;    // on the quarter-size copy
          const n = Math.min(10, Math.max(1, Math.ceil((sigma / 1.94) ** 2))), st = sigma / (1.94 * Math.sqrt(n));
          for (let i = 0; i < n; i++) {
            blurMat.uniforms.tSrc.value = soft[0].texture; blurMat.uniforms.uStep.value.set(st / qW, 0); pass(blurMat, soft[1]);
            blurMat.uniforms.tSrc.value = soft[1].texture; blurMat.uniforms.uStep.value.set(0, st / qH); pass(blurMat, soft[0]);
          }
        }
        mixMat.uniforms.tSoft.value = defocus > 0.001 ? soft[0].texture : sharp.texture;
        mixMat.uniforms.uSoft.value = sstep(0, 0.22, defocus);
        mixMat.uniforms.uInk.value = ink;
        pass(mixMat, bg);
        // 3. the discs, sharp: over the background in the plate itself (its depth is kept), or alone, as light
        renderer.autoClear = false;
        if (layer) { renderer.setRenderTarget(target); renderer.clear(true, false, false); } else copy(bg.texture, target);
        cam.layers.set(FX_LAYER);
        renderer.setRenderTarget(target);
        renderer.render(shared.scene, cam);
      }
      renderer.setRenderTarget(prevRT, prevFace, prevMip);
      renderer.setClearColor(clearCol, prevAlpha);
      renderer.autoClear = prevAuto;
    },
    dispose() {
      for (const rt of [target, sharp, bg, half, soft[0], soft[1]]) rt.dispose();
      tri.dispose(); mesh.material.dispose(); discs.material.dispose(); copyMat.dispose(); blurMat.dispose(); mixMat.dispose(); release();
    },
  };
}
