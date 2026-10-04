// W3 SCALE — the wing in extreme macro; the credit made of scales (S03, card C0). Owner: Group B.
//
// 1 unit = one scale pitch (45 µm). The frame is 480 units wide (a 21.6 mm field on the left
// forewing). ~170,000 instanced scales in staggered rows (pitch 1.0 across, 0.88 between rows), each
// a cupped shingle 1.15 x 2.3 rotating about its root. A scale's brightness is the thin-film
// response to its angle under the raking lamp and NOTHING ELSE: there is no opacity, no emissive
// term and no overlay anywhere in this file. Flat, a scale is black; lifted into the lobe it is
// blue. The credit is the set of scales (centres inside the rasterised glyphs) that stay lifted
// after the gust has passed; it is unmade when those scales let go.
//
// Everything is closed-form in film time t:
//   gust   28.0 -> ~30.7: a front crossing left to right at FRONT_SPEED; each scale lifts and falls in
//          0.5 s, flashing at the top of its lift; letter scales settle at `hold` (23°).
//   hold   the wing breathes (story.breath): the plane tilts ±3° about the lobe, so the letters run
//          violet-blue (exhaled) -> blue -> cyan (the top of the inhale, 32.0: brightest).
//   shed   35.5 -> 35.9: left to right each letter scale lets go and stays in the air while the wing
//          drops away beneath it (a wave travelling with the release); the freed scales are driven
//          at the lens, tumbling, lit by the same lobe on their upper side only, growing into oval
//          bokeh by their own thin-lens circle of confusion.
//   40.0   thirty-six of them hang at story.dustDiscs() (x, y, r = half-height of a 1 : 1.5 oval),
//          brightness by `phase`: story.dustFlash(). INTERIOR's S04a starts there (X2).
//
// params (shots/macro.js): hold (0..1 of the 23° the letter scales rest at), wingTilt (degrees, ±, on BREATH).
// The gust (28.0) and the shed (35.5 = story.SYNC.shed) are constants here: GUST_T0, SHED_T0.

import * as THREE from 'three';
import { THINFILM } from '../lib/thinfilm.js';
import { HASH } from '../lib/glsl/noise.js';
import { FX_LAYER } from '../post.js';
import { FONT_STACKS } from '../titles.js';
import { lensToFov } from '../lib/camera.js';
import { createRng } from '../lib/random.js';
import { breath, dustDiscs, dustFlash, PALETTE, linear, SHOT } from '../lib/story.js';

export const CREDIT = 'Produced by Fable 5.5';
const DEG = Math.PI / 180;
const FRAME_W = 480, FRAME_H = 240;
const TEXT_W = 0.58 * FRAME_W;                 // 58% of picture width
const ROW = 0.88, SCALE_W = 1.15, SCALE_L = 2.3;
const BASE_TILT = 5 * DEG;                     // shingles lie tip-up over the next row
const HOLD = 23 * DEG, PEAK = 26.5 * DEG;      // lift of a letter scale at rest; top of the gust's lift
const LOBE_AT = BASE_TILT + HOLD + 1.5 * DEG;  // total scale angle at the heart of the lobe
const CAM_TILT = 8 * DEG, LAMP_ELEV = 14 * DEG;
const DRIFT = 40, CAM_DIST = (FRAME_H / 2) / Math.tan((lensToFov(100, 2) * DEG) / 2);
const GUST_T0 = 28.0, FRONT_X0 = -262, FRONT_SPEED = 196;   // units, units / s (FRONT_SPEED: the mean, for the record)
const FRONT = [342, -33, 129, 150, 300];                     // speed in · knee x (the end of "Produced") · speed across the line · knee x · speed out
const SHED_T0 = 35.5, SHED_DUR = 0.4, END = SHOT.S03[1];
const DOF = { aperture: 22, maxBlur: 22 };     // post DOF for the wing (top and bottom of frame go soft)
const BOKEH = { aperture: 3.2, maxR: 70 };      // the dust's own thin lens: radius px @1080p = clamp(aperture * |z - f| / z) * maxR

// lamp azimuth such that a scale at LOBE_AT returns the lamp to the lens (H in the plane across the ridges)
const LAMP = (() => {
  const want = Math.tan(LOBE_AT) * (Math.sin(LAMP_ELEV) + Math.cos(CAM_TILT)) - Math.sin(CAM_TILT);
  const az = Math.asin(Math.min(0.95, want / Math.cos(LAMP_ELEV)));
  return new THREE.Vector3(Math.cos(LAMP_ELEV) * Math.cos(az), Math.cos(LAMP_ELEV) * Math.sin(az), Math.sin(LAMP_ELEV));
})();

/** Brightness 0..1 of dust disc `phase` at film time t: story.dustFlash (the GLSL below mirrors it). */
export const heroFlash = dustFlash;

function rasteriseCredit() {
  const F = 220, pad = 40;
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  const font = `400 ${F}px ${FONT_STACKS.en}`;
  g.font = font; g.letterSpacing = `${0.1 * F}px`;
  const m = g.measureText(CREDIT), width = m.width - 0.1 * F;
  const cap = g.measureText('P').actualBoundingBoxAscent;
  c.width = Math.ceil(width + 2 * pad); c.height = Math.ceil(F * 1.7);
  g.font = font; g.letterSpacing = `${0.1 * F}px`; g.textBaseline = 'alphabetic';
  const base = Math.round(F * 1.15), unit = TEXT_W / width;     // world units per px
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'round';
  g.lineWidth = 0.85 / unit;                                     // regular weight, emboldened by 0.4 of a scale each side: hairlines at least a scale wide
  g.fillText(CREDIT, pad, base); g.strokeText(CREDIT, pad, base);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const inside = (x, y) => {                                     // world units, text centred on (0, 0.6)
    const px = Math.round((x + TEXT_W / 2) / unit + pad), py = Math.round(base - cap / 2 - (y - 0.6) / unit);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return false;
    return data[(py * c.width + px) * 4 + 3] > 110;
  };
  return { inside, cap: cap * unit };
}

// ---- shared GLSL: lift of a scale, the wing's pose, the lobe ------------------------------------------
const SHARED = HASH + THINFILM + /* glsl */ `
uniform float uTime, uTilt, uTiltShed, uHold;
uniform vec3 uLamp, uLampColor, uFilmLight;
const float ROW = ${ROW}; const float SCALE_W = ${SCALE_W}; const float SCALE_L = ${SCALE_L};
const float BASE_TILT = ${BASE_TILT.toFixed(5)}; const float HOLD = ${HOLD.toFixed(5)}; const float PEAK = ${PEAK.toFixed(5)};
const float GUST_T0 = ${GUST_T0.toFixed(2)}; const float FRONT_X0 = ${FRONT_X0.toFixed(1)}; const float FRONT_SPEED = ${FRONT_SPEED.toFixed(1)};
// when the front reaches x (seconds after GUST_T0). It comes in fast, slows as it crosses the line so that the words
// stand one after another (Produced 29.2 · by 29.6 · Fable 30.1 · 5.5 30.5; a scale takes half a second to rise into
// the lamp), and runs out fast: FRONT (x, speed) knees, eased
float frontRamp(float y) { return 0.5 * (y + sqrt(y * y + 144.0)); }
float frontTime(float x) {
  float t = (x - FRONT_X0) / ${FRONT[0].toFixed(1)};
  t += frontRamp(x - ${FRONT[1].toFixed(1)}) * (1.0 / ${FRONT[2].toFixed(1)} - 1.0 / ${FRONT[0].toFixed(1)});
  t += frontRamp(x - ${FRONT[3].toFixed(1)}) * (1.0 / ${FRONT[4].toFixed(1)} - 1.0 / ${FRONT[2].toFixed(1)});
  return t;
}
const float SHED_T0 = ${SHED_T0.toFixed(2)}; const float SHED_DUR = ${SHED_DUR.toFixed(2)}; const float TEXT_HALF = ${(TEXT_W / 2).toFixed(2)};
// three veins as low ridges crossing the field: height and its x-slope at a root
vec2 veinRelief(vec2 p) {
  vec2 hs = vec2(0.0);
  vec3 vx = vec3(-158.0, 26.0, 196.0), vs = vec3(0.13, -0.045, -0.2);
  for (int i = 0; i < 3; i++) {
    float d = p.x - (vx[i] + vs[i] * p.y + 2.0 * sin(p.y * 0.013 + float(i) * 2.0));
    float e = 2.2 * exp(-d * d / 26.0);
    hs += vec2(e, -e * d / 13.0);
  }
  return hs;
}
// lift (radians) of the scale at root p at time tt; letter scales settle at HOLD
float liftAt(vec2 p, float tt, float letter, float rnd) {
  float tau = tt - GUST_T0 - frontTime(p.x) - 0.06 * rnd - 0.13 * sin(p.y * 0.011 + 0.7) - 0.035 * sin(p.y * 0.047 + p.x * 0.019);
  if (tau <= 0.0) return 0.0;
  float s = sin(3.14159265 * clamp(tau / 0.5, 0.0, 1.0));
  float up = PEAK * s * s;
  if (letter < 0.5) return up;
  float hold = HOLD * uHold;
  if (tau < 0.25) return up;
  float k = tau - 0.25;
  return hold + (PEAK - hold) * exp(-k * 9.0) * cos(k * 21.0);
}
// when the wing lets go of / drops away under the column at x
float shedTime(float x) { return SHED_T0 + SHED_DUR * clamp((x + TEXT_HALF) / (2.0 * TEXT_HALF), -0.25, 1.25); }
float wingDrop(float x, float tt) { float k = max(0.0, tt - shedTime(x) - 0.05); return -2600.0 * k * k * k / (0.15 + k); }
// the blue of a scale: N its normal, T its long axis. Narrow along the ridges (violet 6° off, black by
// 8.5°), wide across them, as the ridges diffract. Returns reflectance; x the lamp.
vec3 scaleLobe(vec3 N, vec3 T, vec3 V, float thick, float widen) {
  float nl = dot(N, uLamp), nv = dot(N, V);
  if (nl <= 0.0 || nv <= 0.0) return vec3(0.0);
  vec3 H = normalize(uLamp + V);
  vec3 Tn = normalize(T - N * dot(N, T)), B = cross(N, Tn);
  float hn = max(dot(H, N), 1e-3);
  float x = abs(dot(H, Tn)) / hn / (0.105 * widen);
  float across = dot(H, B) / hn / (1.25 * widen);
  float p = thick * (1.052 - 0.142 * pow(x, 1.5));
  return thinFilmRamp(p) * (1.0 - smoothstep(0.9, 1.42, x)) * exp(-across * across) * smoothstep(0.0, 0.1, nl);
}
mat2 r2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

const FIELD_VERT = SHARED + /* glsl */ `
attribute vec2 aRoot; attribute vec4 aRnd; attribute float aRel;
varying vec3 vN; varying vec3 vT; varying vec3 vW; varying vec2 vAB; varying float vThick; varying float vKey;
void main() {
  float a = position.x, b = position.y;                       // across -0.5..0.5, along 0..1 (root -> tip)
  bool letter = aRel > 0.0;
  if (letter && uTime >= aRel) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // it has left: the dust draws it now
  // the shingle: a narrow stalk, a rounded tip, cupped across, the tip curling up a little
  float hw = 0.5 * SCALE_W * min(1.0, sqrt(b / 0.1 + 0.02)) * sqrt(max(0.0, 1.0 - pow(max(0.0, (b - 0.7) / 0.3), 2.0)) + 0.001);
  vec3 q = vec3(a * 2.0 * hw, -b * SCALE_L, 0.11 * (1.0 - 4.0 * a * a) * min(1.0, b * 4.0) + 0.05 * b * b);
  vec3 n = normalize(vec3(0.88 * a * min(1.0, b * 4.0) / max(hw, 0.2) * 0.575, 0.1 * b / SCALE_L, 1.0));
  // its own small irregularity: yaw, roll, and a little along-tilt
  vec2 relief = veinRelief(aRoot);
  float yaw = (aRnd.x - 0.5) * 0.2, roll = (aRnd.y - 0.5) * 0.12 + atan(relief.y);
  float lift = BASE_TILT + liftAt(aRoot, uTime, letter ? 1.0 : 0.0, aRnd.w) + (aRnd.z - 0.5) * ${(3 * DEG).toFixed(4)};
  q.xz = r2(-roll) * q.xz; n.xz = r2(-roll) * n.xz;
  // lift about the root line: the tip (at -y) rises toward +z
  float cl = cos(lift), sl = sin(lift);
  q = vec3(q.x, q.y * cl + q.z * sl, -q.y * sl + q.z * cl);
  vec3 nn = vec3(n.x, n.y * cl + n.z * sl, -n.y * sl + n.z * cl);
  vec3 tt = vec3(0.0, -cl, sl);
  q.xy = r2(yaw) * q.xy; nn.xy = r2(yaw) * nn.xy; tt.xy = r2(yaw) * tt.xy;
  vec3 p = vec3(aRoot, relief.x) + q;
  // the wing's pose: the breath tilts the plane about the frame's horizontal axis; at the shed it drops away
  float ct = cos(uTilt), st = sin(uTilt);
  float drop = wingDrop(aRoot.x, uTime);
  vec3 P = vec3(p.x, p.y * ct + p.z * st, -p.y * st + p.z * ct + drop);
  vN = vec3(nn.x, nn.y * ct + nn.z * st, -nn.y * st + nn.z * ct);
  vT = vec3(tt.x, tt.y * ct + tt.z * st, -tt.y * st + tt.z * ct);
  vAB = vec2(a, b); vThick = 1.0 + (aRnd.w - 0.5) * 0.02;
  vKey = exp(drop / 160.0);                                    // out of the lamp's raking light as it falls away
  vW = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const g3 = (hex) => `vec3(${linear(hex).map((v) => v.toFixed(5)).join(', ')})`;
const FIELD_FRAG = SHARED + /* glsl */ `
varying vec3 vN; varying vec3 vT; varying vec3 vW; varying vec2 vAB; varying float vThick; varying float vKey;
const vec3 MELANIN = ${g3(PALETTE.melanin)}; const vec3 ROOT = ${g3(PALETTE.scaleRoot)};
void main() {
  vec3 N = normalize(vN), T = normalize(vT), V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  // nine longitudinal ridges, when they can be resolved
  float rf = vAB.x * 9.0, rw = fwidth(rf);
  N = normalize(N + cross(T, N) * 0.35 * sin(6.2831853 * rf) * (1.0 - smoothstep(0.25, 0.6, rw)));
  vec3 H = normalize(uLamp + V);
  float nl = max(dot(N, uLamp), 0.0);
  vec3 col = scaleLobe(N, T, V, vThick, 1.0) * uFilmLight;
  // melanin under the raking lamp: nearly nothing, a warm gloss where the cup turns to the light
  vec3 alb = mix(ROOT, MELANIN, smoothstep(0.0, 0.32, vAB.y));
  col += alb * uLampColor * (0.32 * nl + 0.02);
  // rows of overlapping tiles under the raking lamp: a warm crescent where each cup turns to it, a thin
  // light along the edge that faces it, the free tip catching a little
  col += uLampColor * (0.006 * pow(max(dot(N, H), 0.0), 6.0) + 0.13 * pow(max(dot(N, H), 0.0), 40.0));
  float edgeLit = smoothstep(0.32, 0.5, vAB.x * sign(uLamp.x)) * smoothstep(0.15, 0.5, vAB.y);
  col += uLampColor * (0.02 * edgeLit + 0.014 * smoothstep(0.88, 1.0, vAB.y));
  col *= (0.3 + 0.7 * smoothstep(0.0, 0.42, vAB.y)) * vKey;      // the row above shades the root
  gl_FragColor = vec4(col, 1.0);
}`;

const DUST_VERT = SHARED + /* glsl */ `
attribute vec2 aRoot; attribute vec4 aRnd; attribute float aRel; attribute vec3 aVel; attribute vec3 aAxis; attribute vec4 aHero;
uniform vec4 uBokeh;      // focus distance, aperture, max radius (px @1080p), viewport height (px)
uniform float uEnd;
varying vec2 vUv; varying vec3 vCol; varying float vSoft;
vec3 rotAxis(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
void main() {
  float tau = uTime - aRel;
  if (tau < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // where and how the scale stood when it let go (identical to the field's vertex shader at aRel)
  vec2 relief = veinRelief(aRoot);
  float lift = BASE_TILT + liftAt(aRoot, aRel, 1.0, aRnd.w) + (aRnd.z - 0.5) * ${(3 * DEG).toFixed(4)};
  float yaw = (aRnd.x - 0.5) * 0.2;
  float cl = cos(lift), sl = sin(lift), ct = cos(uTiltShed), st = sin(uTiltShed);
  vec3 T0 = vec3(0.0, -cl, sl), N0 = vec3(0.0, sl, cl);
  T0.xy = r2(yaw) * T0.xy; N0.xy = r2(yaw) * N0.xy;
  vec3 c0 = vec3(aRoot, relief.x) + T0 * (0.5 * SCALE_L);
  c0 = vec3(c0.x, c0.y * ct + c0.z * st, -c0.y * st + c0.z * ct);
  T0 = vec3(T0.x, T0.y * ct + T0.z * st, -T0.y * st + T0.z * ct);
  N0 = vec3(N0.x, N0.y * ct + N0.z * st, -N0.y * st + N0.z * ct);
  // flight: it hangs an instant, then the air of the beat drives it at the lens, tumbling
  float g = tau * tau / (tau + 0.32);
  vec3 c = c0 + aVel * g + vec3(sin(tau * 2.1 + aRnd.x * 6.3), cos(tau * 1.7 + aRnd.y * 6.3), 0.0) * 14.0 * (1.0 - exp(-tau));
  // a burst of tumbling, then a slow turn; one grain in five keeps turning in the light, the rest end with their backs to the lamp
  float spin = (3.0 + 7.0 * aRnd.z) * 0.6 * (1.0 - exp(-tau / 0.6)) * smoothstep(0.03, 0.3, tau) + (0.6 + 0.9 * aRnd.x) * tau;
  float widen = 1.0 + 1.3 * smoothstep(0.02, 0.3, tau) - 0.7 * smoothstep(0.8, 2.0, tau);
  float keeps = step(aRnd.y, 0.26);
  float gain = 1.0;
  if (aHero.w >= 0.0) {
    // the thirty-six that stay: eased onto their places for 40.0, turning slowly in the light
    float s = clamp(tau / (uEnd - aRel), 0.0, 1.08);
    c = mix(c0, aHero.xyz, 1.0 - pow(max(0.0, 1.0 - s), 2.6)) + (aHero.xyz - c0) * 0.02 * max(0.0, s - 1.0);
    float want = 0.32 + 0.68 * (0.5 + 0.5 * cos(6.2831853 * (aHero.w + 0.22 * (uTime - uEnd))));
    spin = mix(spin, 0.0, smoothstep(0.3, 0.8, s));
    widen = 2.6;
    gain = mix(1.0, want * 1.5, smoothstep(0.35, 0.85, s));
  }
  vec3 T = rotAxis(T0, aAxis, spin), N = rotAxis(N0, aAxis, spin);
  if (aHero.w < 0.0 && keeps < 0.5) N = normalize(mix(N, -uLamp, smoothstep(0.55 + 0.6 * aRnd.x, 1.3 + 0.9 * aRnd.x, tau)));
  if (aHero.w >= 0.0) {
    // it comes to rest near the lamp's mirror direction, a little off it along its ridges: each grain its own blue
    float s = clamp(tau / (uEnd - aRel), 0.0, 1.0);
    vec3 Vc = normalize(cameraPosition - c), Hm = normalize(uLamp + Vc);
    vec3 Tm = normalize(cross(cross(Hm, vec3(0.3, -1.0, 0.2)), Hm));
    float k = smoothstep(0.3, 0.8, s);
    N = normalize(mix(N, normalize(Hm + Tm * 0.27 * fract(aHero.w * 7.31)), k)); T = normalize(mix(T, Tm, k));
  }
  vec3 B = cross(N, T);
  vec3 V = normalize(cameraPosition - c);
  // upper side only: the underside of a scale is plain melanin
  vec3 col = scaleLobe(N, T, V, 1.0 + (aRnd.w - 0.5) * 0.02, widen) * uFilmLight * gain;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float z = max(-mv.z, 1.0);
  float coc = clamp(uBokeh.y * abs(z - uBokeh.x) / z, 0.0, 1.0) * uBokeh.z * (uBokeh.w / 1080.0);   // px radius
  float ppu = projectionMatrix[1][1] * 0.5 * uBokeh.w / z;                                         // px per unit
  // the in-focus scale's light spread over its disc (eased, so that the big discs still read)
  float cref = coc * 1080.0 / uBokeh.w;
  vCol = col / (1.0 + cref / 24.0);
  if (z < 4.0 || dot(vCol, vec3(1.0)) < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vSoft = smoothstep(0.7, 3.5, coc);
  vec3 corner = (viewMatrix * vec4(T * position.y * 0.5 * SCALE_L + B * position.x * 0.5 * SCALE_W, 0.0)).xyz;
  vec4 clip = projectionMatrix * vec4(mv.xyz + corner, 1.0);
  vec2 px = vec2(position.x / 1.5, position.y) * (coc + 0.75);
  clip.xy += px * 2.0 / vec2(uBokeh.w * ${(FRAME_W / FRAME_H).toFixed(1)}, uBokeh.w) * clip.w;
  vUv = position.xy;
  gl_Position = clip;
}`;
const DUST_FRAG = /* glsl */ `
varying vec2 vUv; varying vec3 vCol; varying float vSoft;
void main() {
  // in focus: the shingle; out of focus: a flat oval with a breath of rim (the anamorphic disc)
  float r = length(vUv);
  float disc = 1.0 - smoothstep(0.5, 1.0, r);
  float rim = smoothstep(0.42, 0.72, r) * disc;
  float aB = disc * (0.78 + 0.34 * rim);
  float aS = (1.0 - smoothstep(0.7, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.75, 1.0, abs(vUv.y)));
  float a = mix(aS, aB, vSoft);
  if (a <= 0.001) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(lensToFov(100, ctx.aspect), ctx.aspect, 20, 6000);
  const rng = createRng('scale-field');
  const text = rasteriseCredit();

  // ---- the field -----------------------------------------------------------------------------------
  const X0 = -(FRAME_W / 2 + DRIFT / 2 + 26), X1 = -X0, Y0 = -(FRAME_H / 2 + 22), Y1 = -Y0 + 4;
  const roots = [], rnd = [], rel = [], letters = [];
  let row = 0;
  for (let y = Y1; y >= Y0; y -= ROW, row++) {
    for (let x = X0 + (row % 2) * 0.5; x <= X1; x += 1) {
      const jx = x + (rng() - 0.5) * 0.16, jy = y + (rng() - 0.5) * 0.12;
      const r = [rng(), rng(), rng(), rng()];
      const isLetter = text.inside(jx, jy - 0.45 * SCALE_L);
      let tRel = 0;
      if (isLetter) {
        r[2] = 0.5 + (r[2] - 0.5) * 0.5;                    // letter scales sit a little truer (±0.75°)
        tRel = SHED_T0 + SHED_DUR * Math.min(1, Math.max(0, (jx + TEXT_W / 2) / TEXT_W)) + (r[3] - 0.5) * 0.05;
        letters.push({ x: jx, y: jy, r, tRel });
      }
      roots.push(jx, jy); rnd.push(...r); rel.push(tRel);
    }
  }
  const count = rel.length;
  // one shingle: 4 x 5 quads, (across, along)
  const NA = 4, NB = 5, sp = [], si = [];
  for (let j = 0; j <= NB; j++) for (let i = 0; i <= NA; i++) sp.push(i / NA - 0.5, (j / NB) ** 0.8, 0);
  for (let j = 0; j < NB; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1; si.push(a, c, b, b, c, d); }
  const fieldGeo = new THREE.InstancedBufferGeometry();
  fieldGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  fieldGeo.setIndex(si);
  fieldGeo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(roots), 2));
  fieldGeo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(new Float32Array(rnd), 4));
  fieldGeo.setAttribute('aRel', new THREE.InstancedBufferAttribute(new Float32Array(rel), 1));
  fieldGeo.instanceCount = count;
  const lampColor = new THREE.Vector3(...linear(PALETTE.lampKey)).multiplyScalar(3.4);
  const uniforms = {
    uTime: { value: 0 }, uTilt: { value: 0 }, uTiltShed: { value: 0 }, uHold: { value: 1 },
    uLamp: { value: LAMP.clone() }, uLampColor: { value: lampColor }, uFilmLight: { value: new THREE.Vector3(0.84, 0.84, 0.84) },
  };
  const fieldMat = new THREE.ShaderMaterial({ name: 'scale-field', uniforms, vertexShader: FIELD_VERT, fragmentShader: FIELD_FRAG, side: THREE.DoubleSide });
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.frustumCulled = false;
  scene.add(field);

  // ---- the dust: every letter scale, once it has let go ----------------------------------------------
  // camera at the end of the shot, to place the thirty-six discs of X2
  const camAt = (t) => { const k = (t - SHOT.S03[0]) / (END - SHOT.S03[0]), cx = -DRIFT / 2 + DRIFT * k; return { cx, pos: new THREE.Vector3(cx, Math.sin(CAM_TILT) * CAM_DIST, Math.cos(CAM_TILT) * CAM_DIST) }; };
  const placeCam = (t) => { const { cx, pos } = camAt(t); camera.position.copy(pos); camera.up.set(0, 1, 0); camera.lookAt(cx, 0, 0); camera.updateMatrixWorld(); };
  placeCam(END);
  camera.updateProjectionMatrix();
  const discs = dustDiscs();
  const order = rng.shuffle(letters.map((_, i) => i));
  const heroOf = new Map();
  // spread the heroes along the line of text, each sent to the nearest free disc
  const free = discs.map((d, i) => i);
  for (let k = 0; k < discs.length && k < letters.length; k++) {
    const li = order[Math.floor((k + 0.5) * letters.length / discs.length)], L = letters[li];
    const sx = 0.5 + L.x / FRAME_W;
    free.sort((a, b) => Math.abs(discs[a].x - sx) - Math.abs(discs[b].x - sx));
    heroOf.set(li, free.splice(Math.floor(rng() * Math.min(4, free.length)), 1)[0]);
  }
  const N = letters.length;
  const dRoot = new Float32Array(N * 2), dRnd = new Float32Array(N * 4), dRel = new Float32Array(N), dVel = new Float32Array(N * 3), dAxis = new Float32Array(N * 3), dHero = new Float32Array(N * 4);
  const v = new THREE.Vector3();
  letters.forEach((L, i) => {
    dRoot.set([L.x, L.y], i * 2); dRnd.set(L.r, i * 4); dRel[i] = L.tRel;
    // toward the lens, fanning out; fast enough that all but the heroes have passed it before 40.0
    const sp = 620 + 620 * rng(), a = rng() * Math.PI * 2, fan = 0.05 + 0.2 * rng();
    v.set(Math.cos(a) * fan, Math.sin(a) * fan + Math.sin(CAM_TILT), Math.cos(CAM_TILT)).normalize().multiplyScalar(sp);
    dVel.set([v.x, v.y, v.z], i * 3);
    const ax = rng.onSphere(); dAxis.set(ax, i * 3);
    const h = heroOf.get(i);
    if (h === undefined) dHero.set([0, 0, 0, -1], i * 4);
    else {
      const d = discs[h];
      // depth from the disc's radius through the dust's thin lens (in front of the plane of focus)
      const rpx = d.r * 2160, q = Math.min(0.92, rpx / (BOKEH.aperture * BOKEH.maxR)), z = CAM_DIST / (1 + q);
      v.set(d.x * 2 - 1, d.y * 2 - 1, 0.5).unproject(camera).sub(camera.position).normalize();
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
      v.multiplyScalar(z / v.dot(fwd)).add(camera.position);
      dHero.set([v.x, v.y, v.z, d.phase], i * 4);
    }
  });
  const dustGeo = new THREE.InstancedBufferGeometry();
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  dustGeo.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, arr, n] of [['aRoot', dRoot, 2], ['aRnd', dRnd, 4], ['aRel', dRel, 1], ['aVel', dVel, 3], ['aAxis', dAxis, 3], ['aHero', dHero, 4]]) dustGeo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, n));
  dustGeo.instanceCount = N;
  const dustU = { ...uniforms, uBokeh: { value: new THREE.Vector4(CAM_DIST, BOKEH.aperture, BOKEH.maxR, 1080) }, uEnd: { value: END } };
  const dustMat = new THREE.ShaderMaterial({
    name: 'scale-dust', uniforms: dustU, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, side: THREE.DoubleSide,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  const dust = new THREE.Mesh(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.layers.set(FX_LAYER);
  dust.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); dustU.uBokeh.value.w = rt ? rt.height : renderer.domElement.height; };
  scene.add(dust);

  const tiltAt = (t, amp) => amp * DEG * (2 * breath(t) - 1);
  const LIFT0 = [0.0852, 0.0822, 0.0884], LIFT1 = [0.041, 0.052, 0.079], lampColor0 = lampColor.clone();
  const lampUp = (t) => { const x = Math.min(1, Math.max(0, (t - 26.0) / 1.0)); return x * x * (3 - 2 * x); };
  let hold = 1, amp = 3;
  return {
    scene, camera,
    info: { scales: count, letterScales: N, capHeight: text.cap },
    // Black is one value (ENGINE.md): the shot opens on S02's last frame, ink black #0D0C0E and nothing else; over the
    // first second the lamp finds the scales. The lift holds the unlit field (and, later, the void) at that black:
    // LIFT0 is ink black on an unlit frame, LIFT1 the same mean under the lamp's warm spill.
    post: (t) => {
      // (once the field has been shed there is nothing for the lamp to spill on: the void is ink black again)
      const shed = Math.min(1, Math.max(0, (t - SHED_T0 - 0.1) / (SHED_DUR + 0.9))), k = lampUp(t), kl = k * (1 - shed * shed * (3 - 2 * shed));
      return {
        dof: { focus: CAM_DIST, aperture: DOF.aperture, maxBlur: DOF.maxBlur },
        exposure: 0.0, bloom: 0.085, bloomScatter: 0.72, halation: 0.1, vignette: 0.62 * k, vignetteSoftness: 0.55,
        contrast: 1.08, saturation: 1.22, lift: LIFT0.map((v, i) => v + (LIFT1[i] - v) * kl), grain: 0.03,
      };
    },
    update(t, localT, shot, p = {}) {
      hold = p.hold ?? 1; amp = p.wingTilt ?? 3;
      placeCam(t);
      uniforms.uTime.value = t;
      uniforms.uLampColor.value.copy(lampColor0).multiplyScalar(lampUp(t));
      uniforms.uHold.value = hold;
      uniforms.uTilt.value = tiltAt(Math.min(t, SHED_T0 + SHED_DUR), amp);
      uniforms.uTiltShed.value = tiltAt(SHED_T0 + SHED_DUR / 2, amp);
      field.visible = t < SHED_T0 + SHED_DUR + 1.6;
    },
    dispose() { fieldGeo.dispose(); fieldMat.dispose(); dustGeo.dispose(); dustMat.dispose(); },
  };
}
