// CITY set `crossing` (S17, S18): the scramble crossing from straight above. One continuous take.
//
// The crowd is a weave. Every walker belongs to a lane on one lattice (pitch P across, 2 P along,
// staggered), four streams in four directions, all at one speed, phased so that wherever two streams
// cross, each walker passes exactly midway between two of the other stream: thousands of people who
// never touch. That order is the weight of the shot. The hero walks in it, in step, and at 155.0
// stops: the only fault in the fabric, and the streams part around it. Around the avenues the
// corners are packed with people standing under their umbrellas.
//
// Everything is closed-form in film time: a walker's place is a function of the walk clock; the
// parting is a displacement field around the hero; from 160.0 a ripple of stillness leaves the hero
// and by 161.0 nothing in the frame moves; the ring (choreo.js RING_KNOTS) reaches walker i at
// arrive[i]. The umbrellas are FLOCK instances (lib/flock.js, LOOK group), one flock per zone of the
// ring: this file places them every frame (setPositions), tells each flock when its part of the ring
// passes, and draws what is under them: the ground, the
// edge of the sun, the long shadows, and the people, who remain, stop, and look up.
//
// World: metres, y up. The hero stops at the origin. Screen right = +x, screen up = -z.

import * as THREE from 'three';
import { createFlock, FLOCK_TIMING } from '../../lib/flock.js';
import { createFigure } from '../../lib/figure.js';
import { DRYBRUSH_GLSL } from '../../lib/ink.js';
import { PALETTE, rgb, linear, SYNC, SPECK } from '../../lib/story.js';
import { hash2 } from '../../lib/random.js';
import { INK_OUT, BRUSH, RAIN } from './glsl.js';
import { CROSSING, walkClock, heroZ, crossingCamera, ringZones, ringArrival, stillAt, crawlAt, STILL_D } from './choreo.js';
import { createSpeckHalo } from './speck.js';

const { P, Q, V, CAM_H } = CROSSING;
const LX = 65 * Q, LZ = 35 * Q;                 // half-lengths of the lanes (wrap), m
const FIELD_X = 160, FIELD_Z = 84;              // the packed corners reach this far
const KERB = 23.5;                              // half-width of the avenues
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const mod = (a, n) => ((a % n) + n) % n;

// ---- the edge of the sun, shared by the ground, the shadows and the people -----------------------
const SUN_GLSL = /* glsl */ `
uniform float uSunEdge;      // 0..1: the light boundary crosses from lower left to upper right
const vec2 SUN_N = vec2(0.866, -0.5);                 // the way the edge travels (x, z)
const vec2 SHADOW_DIR = vec2(0.80, -0.60);            // the way the shadows fall
float sunLit(vec2 p) {
  float e = mix(-56.0, 56.0, uSunEdge);
  float wob = 3.5 * snoise(p * 0.035 + 3.0) + 1.2 * snoise(p * 0.11 - 7.0);
  return (1.0 - smoothstep(-2.5, 2.5, dot(p, SUN_N) - e + wob)) * step(0.0005, uSunEdge);
}`;

const GROUND_VERT = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const GROUND_FRAG = BRUSH + DRYBRUSH_GLSL + INK_OUT + SUN_GLSL + /* glsl */ `
uniform float uPxM;          // metres per pixel
uniform float uRing;         // m: radius of the ring of wings (inside it the INK pass lets all colour through)
uniform vec3 uHero;          // xy: the speck's place, z: its pool's radius (m): the pool of full colour must not gild the road
uniform float uTime, uDrip;  // the last drops: rings on the wet road
uniform vec3 uGold, uGoldBright;
varying vec3 vW;
// one zebra band: people walk along axis; the bars lie across it. Returns the reserve (0..1).
float zebra(vec2 p, vec2 c, vec2 axis, float halfLen, float halfWid, float seed) {
  vec2 d = p - c;
  float a = dot(d, axis), b = dot(d, vec2(-axis.y, axis.x));
  if (abs(a) > halfLen || abs(b) > halfWid * 1.05) return 0.0;
  float k = floor(a / 1.0);
  float fa = a - k - 0.5;                                    // -0.5..0.5 within the pitch
  // each bar is one stroke of a dry brush, drawn across the band
  vec2 st = vec2((b / halfWid) * 0.5 + 0.5, fa / 0.27);
  if (mod(k + seed, 2.0) > 0.5) st.x = 1.0 - st.x;           // the hand goes back and forth
  float load = 0.62 + 0.3 * hash12(vec2(k, seed * 7.0 + 1.0));
  return dryBrush(st, load, k * 1.37 + seed * 11.0) * step(abs(fa), 0.3);
}
float dash(vec2 p, float along, float across, float halfW, float period, float duty, float seed) {
  float k = floor(along / period);
  vec2 st = vec2(fract(along / period) / duty, across / halfW);
  if (st.x > 1.0) return 0.0;
  return dryBrush(st, 0.55 + 0.3 * hash12(vec2(k, seed)), k + seed * 3.0);
}
void main() {
  vec2 p = vW.xz;
  float px = uPxM;
  // ---- wet asphalt: a mid wash with slow blots, lighter where the sky lies in it ----
  float blot = fbm(p * 0.045 + 2.0, 4), fine = vnoise(p * 0.9) * 0.5 + 0.5;
  float d = 0.34 + 0.12 * blot + 0.03 * (fine - 0.5);
  d -= 0.13 * smoothstep(0.1, 0.6, fbm(p * 0.02 - 5.0, 3));                 // sky standing in the wet
  d += 0.05 * dryBrush(p * 0.02, vec2(0.8, -0.6), 0.5) - 0.025;             // the sweep of the brush that laid the road
  // ---- the corners: paved, paler, a kerb line ----
  vec2 ap = abs(p);
  float corner = length(max(vec2(${KERB.toFixed(1)}) + 4.0 - ap, 0.0)) - 4.0;   // < 0 inside a corner block (rounded)
  float plaza = cov(corner, px * 1.5);
  float joints = max(lineCov(abs(fract(p.x / 3.2 + 0.5) - 0.5) * 3.2, 0.03, px), lineCov(abs(fract(p.y / 3.2 + 0.5) - 0.5) * 3.2, 0.03, px));
  float dPlaza = 0.14 + 0.04 * blot + 0.1 * joints;
  d = mix(d, dPlaza, plaza);
  d = mix(d, 0.62, lineCov(abs(corner), 0.14, px) * 0.8);                     // the kerb
  // ---- the marks: reserved paper, dry-brushed ----
  float mark = 0.0;
  mark = max(mark, zebra(p, vec2(0.0, -19.5), vec2(1.0, 0.0), 22.0, 2.6, 1.0));
  mark = max(mark, zebra(p, vec2(0.0, 19.5), vec2(1.0, 0.0), 22.0, 2.6, 2.0));
  mark = max(mark, zebra(p, vec2(-19.5, 0.0), vec2(0.0, 1.0), 22.0, 2.6, 3.0));
  mark = max(mark, zebra(p, vec2(19.5, 0.0), vec2(0.0, 1.0), 22.0, 2.6, 4.0));
  float boxIn = step(ap.x, 16.5) * step(ap.y, 16.5);
  mark = max(mark, zebra(p, vec2(0.0), vec2(0.7071, 0.7071), 23.0, 2.4, 5.0) * boxIn);
  mark = max(mark, zebra(p, vec2(0.0), vec2(-0.7071, 0.7071), 23.0, 2.4, 6.0) * boxIn);
  // stop lines and lane dashes out along the four arms
  float armX = step(26.0, ap.x) * step(ap.y, ${KERB.toFixed(1)}), armZ = step(26.0, ap.y) * step(ap.x, ${KERB.toFixed(1)});
  mark = max(mark, armX * dash(p, ap.x - 26.0, mod(p.y + 3.5, 7.0) - 3.5, 0.11, 9.0, 0.45, 2.0) * step(1.0, abs(p.y)));
  mark = max(mark, armZ * dash(p, ap.y - 26.0, mod(p.x + 3.5, 7.0) - 3.5, 0.11, 9.0, 0.45, 5.0) * step(1.0, abs(p.x)));
  mark = max(mark, armX * lineCov(abs(abs(p.y) - 0.25), 0.07, px) * 0.8);
  mark = max(mark, armZ * lineCov(abs(abs(p.x) - 0.25), 0.07, px) * 0.8);
  mark = max(mark, lineCov(abs(ap.x - 24.2), 0.22, px) * step(ap.y, 22.0) * 0.85 * (0.5 + 0.5 * step(0.35, fine)));
  mark = max(mark, lineCov(abs(ap.y - 24.2), 0.22, px) * step(ap.x, 22.0) * 0.85 * (0.5 + 0.5 * step(0.35, fine)));
  mark *= 1.0 - plaza;
  d = mix(d, 0.0, mark * 0.96);
  // ---- the last drops: each lands as a ring that widens and is gone ----
  if (uDrip > 0.0) {
    for (int g = 0; g < 2; g++) {
      float cs = g == 0 ? 2.3 : 3.7;
      vec2 cq = p / cs + float(g) * 17.3;
      vec2 ci = floor(cq);
      vec4 hh = hash42(ci + float(g) * 31.0);
      if (hh.w > uDrip) continue;
      float T = mix(1.3, 3.1, hh.z);
      float tau = fract(uTime / T + hh.w * 7.0) * T;
      if (tau > 0.9) continue;
      vec2 c = (ci + 0.25 + 0.5 * hh.xy - float(g) * 17.3) * cs;
      float rr = 0.05 + 0.5 * tau;
      float ring = lineCov(abs(length(p - c) - rr), 0.012 + 0.02 * tau, px) * (1.0 - tau / 0.9) * (1.0 - tau / 0.9);
      d = mix(d, min(d + 0.3, 0.95), ring * 0.8) - 0.12 * ring * step(length(p - c), rr);
    }
  }
  // ---- the sun: behind its edge the wet road is gold ----
  float lit = sunLit(p);
  vec3 hue = vec3(1.0);
  if (lit > 0.0) {
    // glare: the low sun lies on the water along its own direction
    vec2 q = vec2(dot(p, SHADOW_DIR), dot(p, vec2(-SHADOW_DIR.y, SHADOW_DIR.x)));
    q.x += 0.9 * uTime;                                      // the light on the water is never still
    float glare = smoothstep(0.45, 0.9, 0.5 + 0.5 * (0.7 * snoise(q * vec2(0.012, 0.05)) + 0.3 * snoise(q * vec2(0.04, 0.16) + 4.0)));
    float dl = mix(d * 0.42, 0.03, glare * 0.7 * (1.0 - plaza));
    dl = mix(dl, 0.0, mark * 0.9);
    d = mix(d, dl, lit);
    // the speck's small pool keeps every colour whole: the gold is thinned under it by as much
    float inRing = 1.0 - smoothstep(0.55 * uHero.z, 1.15 * uHero.z, length(p - uHero.xy));
    hue = mix(hue, mix(uGold, uGoldBright, glare), lit * (1.0 - 0.55 * mark) * mix(1.0, 0.5, inRing));
    // the edge itself: a pale rim where the light arrives on the wet
    d *= 1.0 - 0.25 * lit * (1.0 - lit) * 4.0;
  }
  gl_FragColor = vec4(inkOutCol(clamp(d, 0.0, 1.0), hue), 1.0);
}`;

// ---- shadows: where the sun is, every umbrella throws a person: legs, a body, a head, and beyond the
//      head the disc it carries. When the disc leaves, the person's shadow stays, long, on the gold ----
const SHADOW_VERT = /* glsl */ `
attribute vec2 aPos;         // ground position of the person (m)
attribute vec3 aWhen;        // x: when the umbrella leaves (film s), y: seed, z: the weight of its shadow
uniform float uTime, uLen, uElev, uFigN;
varying vec2 vL; varying vec2 vP; varying float vUmb; varying float vSeed; varying float vFig; varying float vWt;
const vec2 SHADOW_DIR = vec2(0.80, -0.60);
void main() {
  // local: x along the shadow 0..1 (-> uLen * 1.42 m: the canopy lies beyond the head), y across -1..1 (-> 0.75 m)
  vec2 l = vec2(position.x * uLen * 1.42, position.y * 0.75);
  vec2 w = aPos + SHADOW_DIR * l.x + vec2(-SHADOW_DIR.y, SHADOW_DIR.x) * l.y;
  vL = l; vP = w; vSeed = aWhen.y; vWt = aWhen.z;
  vFig = float(gl_InstanceID) < uFigN ? 1.0 : 0.0;            // the nearest are drawn as figures: theirs is a figure's shadow
  vUmb = 1.0 - smoothstep(-0.25, 0.1, uTime - aWhen.x);
  gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 0.03, w.y, 1.0);
}`;
const SHADOW_FRAG = BRUSH + SUN_GLSL + /* glsl */ `
uniform float uLen, uStrength, uTime;
varying vec2 vL; varying vec2 vP; varying float vUmb; varying float vSeed; varying float vFig; varying float vWt;
void main() {
  float lit = sunLit(vP);
  if (lit <= 0.001) discard;
  float u = vL.x / uLen;                                     // 0 at the feet .. 1 at the crown of the head
  float y = vL.y + 0.012 * sin(uTime * 1.3 + vSeed * 40.0) * u;   // the body is never quite still
  float pen = 0.02 + 0.035 * u;                              // the edge softens with distance from the feet
  // legs: two strokes from the feet to the hips
  float legs = (1.0 - smoothstep(0.05, 0.05 + pen, abs(abs(y) - mix(0.055, 0.085, clamp(u / 0.5, 0.0, 1.0))))) * step(0.0, u) * (1.0 - smoothstep(0.5, 0.54, u));
  // the body: hips to shoulders, the arms hanging beside it (one holds the shaft)
  float tw = mix(0.15, 0.235, smoothstep(0.46, 0.8, u));
  float torso = (1.0 - smoothstep(tw - 0.01, tw + pen, abs(y))) * smoothstep(0.44, 0.5, u) * (1.0 - smoothstep(0.815, 0.85, u));
  // the head
  float head = 1.0 - smoothstep(0.8, 1.0 + 2.0 * pen, length(vec2((u - 0.925) / 0.068, y / 0.115)));
  float person = max(max(legs, torso), head) * (1.0 - vFig);
  // the shaft and the canopy: a disc keeps its size in a shadow, a dome is drawn out a little
  float shaft = (1.0 - smoothstep(0.012, 0.012 + pen, abs(y - 0.1))) * step(0.7, u) * step(u, 1.19);
  float canopy = 1.0 - smoothstep(0.82, 1.0 + pen, length(vec2((vL.x - uLen * 1.19) / 0.84, vL.y / 0.56)));
  float s = max(person, max(shaft * 0.7, canopy) * vUmb);
  s *= mix(1.0, 0.82, smoothstep(0.5, 1.3, u));               // the far end is a little thinner
  gl_FragColor = vec4(vec3(1.0 - uStrength * vWt * s * lit), 1.0);
}`;

// ---- the people, from above: a coat's shoulders, the arms, a head of hair; and when the face tips up,
//      a face. They breathe; a hem moves. ---------------------------------------------------------
const PEOPLE_VERT = /* glsl */ `
attribute vec2 aPos;
attribute vec4 aWho;         // heading (rad), tUp (film s), seed, hero flag
uniform float uTime, uMinPx, uPxPerM, uFigN;
varying vec2 vQ; varying float vUp; varying float vSeed; varying float vHero; varying vec2 vP;
void main() {
  if (float(gl_InstanceID) < uFigN) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // drawn as a figure instead
  float a = aWho.x; vec2 f = vec2(sin(a), cos(a));           // heading in (x, z)
  float grow = max(1.0, uMinPx / (0.21 * uPxPerM));          // keep the head a dot the eye can find
  vec2 l = position.xy * 0.9 * grow;                         // local: x across the shoulders, y forward
  vec2 w = aPos + l.x * vec2(f.y, -f.x) + l.y * f;
  vQ = position.xy * 0.9; vSeed = aWho.z; vHero = aWho.w; vP = aPos;
  vUp = smoothstep(0.0, 0.5, uTime - aWho.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 1.55, w.y, 1.0);
}`;
const PEOPLE_FRAG = BRUSH + INK_OUT + SUN_GLSL + /* glsl */ `
uniform vec3 uSkin;
uniform float uTime;
varying vec2 vQ; varying float vUp; varying float vSeed; varying float vHero; varying vec2 vP;
void main() {
  float px = fwidth(vQ.x) * 1.2;
  float breath = 1.0 + 0.03 * sin(uTime * 1.6 + vSeed * 30.0);
  float ang = atan(vQ.y, vQ.x);
  // the coat: shoulders, and a hem that the air moves
  float hem = 0.014 * sin(ang * 3.0 + uTime * 2.1 + vSeed * 50.0) + 0.008 * sin(ang * 7.0 - uTime * 3.3 + vSeed * 20.0);
  float sh = cov(length(vQ / (vec2(0.245, 0.125) * breath)) - 1.0 - hem / 0.2, px / 0.16);
  // the arms: forearms carried a little forward
  float arms = cov(length((vec2(abs(vQ.x), vQ.y) - vec2(0.2, 0.085)) / vec2(0.055, 0.1)) - 1.0, px / 0.07);
  vec2 hp = vQ - vec2(0.0, 0.02 - 0.05 * vUp);                           // the head goes back as it tips
  float head = cov(length(hp) - 0.108, px);
  // the face, tipped up: an oval of bare paper, the hair left as a crescent behind it
  float face = cov(length((hp - vec2(0.0, 0.022)) / vec2(0.082, 0.09)) - 1.0, px / 0.085) * vUp;
  float a = max(max(sh, arms), head);
  if (a < 0.004) discard;
  float lit = sunLit(vP);
  float d = mix(mix(0.8, 0.9, vSeed), 0.97, head);                        // coat, then hair
  d = mix(d, 0.02, face);
  vec3 hue = mix(vec3(1.0), uSkin, face * lit);
  gl_FragColor = vec4(inkOutCol(d, hue), a);
}`;

// ---- rain from above: short ink strokes over everything ------------------------------------------
const RAIN_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const RAIN_FRAG = BRUSH + RAIN + INK_OUT + /* glsl */ `
uniform float uRain, uTime, uPx, uAspect;
varying vec2 vUv;
void main() {
  if (uRain <= 0.0) discard;
  vec2 s = vec2((vUv.x - 0.5) * uAspect, vUv.y);
  float r = 0.6 * rainStrokes(s, uTime, 0.5, uRain * 0.75, 1.0, 1.0, uPx) + 0.8 * rainStrokes(s, uTime, 0.75, uRain * 0.6, 1.0, 2.0, uPx) + rainStrokes(s, uTime, 1.0, uRain * 0.45, 1.0, 3.0, uPx);
  r = clamp(r * 1.25, 0.0, 1.0) * 0.8;
  if (r < 0.004) discard;
  gl_FragColor = vec4(inkOut(0.62), r);
}`;

const SPECK_VERT = /* glsl */ `uniform float uSize; void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`;
const SPECK_FRAG = /* glsl */ `uniform vec3 uColor; void main() { vec2 c = gl_PointCoord - 0.5; float a = 1.0 - smoothstep(0.3, 0.5, length(c)); if (a < 0.01) discard; gl_FragColor = vec4(uColor, a); }`;

// ---- the crowd -----------------------------------------------------------------------------------
function buildCrowd() {
  // lanes. x-lanes run along z (N->S is +z, the hero's way); z-lanes run along x (W->E is +x).
  const lanes = [];
  for (let l = -13; l <= 13; l++) {
    const a = Math.abs(l);
    if (a <= 3) lanes.push({ axis: 0, c: l * P, sign: 1, idx: l });
    else if (a >= 6) lanes.push({ axis: 0, c: l * P, sign: -1, idx: l });
  }
  for (let m = -14; m <= 13; m++) {
    if (m >= -4 && m <= 3) lanes.push({ axis: 1, c: m * P + 0.5 * P, sign: 1, idx: m });
    else if (m >= 6 || m <= -7) lanes.push({ axis: 1, c: m * P + 0.5 * P, sign: -1, idx: m });
  }
  // phases that make every crossing a zip (see the header): X0 = 0, Z0 = P / 2
  const cOf = (axis, sign) => (axis === 0 ? (sign > 0 ? 0 : 0.5) : (sign > 0 ? -0.25 : 0.25));
  const W = [];                                  // walkers: { kind, lane, base, ... }
  W.push({ kind: 'hero' });
  for (const L of lanes) {
    const half = L.axis === 0 ? LZ : LX, n = Math.round((2 * half) / Q);
    const stag = L.axis === 0 ? mod(L.idx, 2) / 2 : mod(L.idx + 1, 2) / 2;
    const fill = 0.66 + 0.26 * hash2(L.idx + 40, L.axis * 7 + 3, 11);
    for (let j = 0; j < n; j++) {
      const isHeroSlot = L.axis === 0 && L.idx === 0 && j === 0;
      if (isHeroSlot) continue;                                               // the hero walks in this place
      if (hash2(j, L.idx * 31 + L.axis * 977, 5) > fill) continue;            // a place left empty
      W.push({
        kind: 'stream', axis: L.axis, c: L.c, sign: L.sign, base: (j + stag + cOf(L.axis, L.sign)) * Q, half,
        jx: (hash2(j, L.idx + L.axis * 100, 21) - 0.5) * 0.34, jz: (hash2(j, L.idx + L.axis * 100, 22) - 0.5) * 0.5,
        side: hash2(j, L.idx + L.axis * 100, 23) < 0.5 ? -1 : 1, seed: hash2(j, L.idx + L.axis * 100, 24),
      });
    }
  }
  // the corners: people standing, packed, in knots and gaps (a crowd, not a lattice), thinner at the kerb
  const pitch = 1.3, row = pitch * 0.866;
  const vn = (x, z, sd) => {                       // value noise 0..1 on a grid of 1
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const h = (a, b) => hash2(a, b, sd);
    return (h(ix, iz) * (1 - ux) + h(ix + 1, iz) * ux) * (1 - uz) + (h(ix, iz + 1) * (1 - ux) + h(ix + 1, iz + 1) * ux) * uz;
  };
  for (let iz = 0; iz * row < FIELD_Z - KERB - 1.2; iz++) {
    for (let ix = 0; ix * pitch < FIELD_X - KERB - 1.2; ix++) {
      const x0 = KERB + 1.2 + ix * pitch + (iz % 2 ? pitch * 0.5 : 0), z0 = KERB + 1.2 + iz * row;
      for (let q = 0; q < 4; q++) {
        const sx = q & 1 ? -1 : 1, sz = q & 2 ? -1 : 1;
        const h = hash2(ix * 4 + q, iz, 31);
        const edge = Math.min(x0 - KERB, z0 - KERB);
        const knot = 0.5 * vn(x0 / 5.5 + q * 9, z0 / 5.5, 41) + 0.5 * vn(x0 / 13 + q * 5, z0 / 13, 42);      // where they stand closer
        if (h > 0.5 + 0.75 * knot - 0.25 * Math.exp(-edge / 1.5)) continue;
        // pushed off the lattice by up to most of a pitch, and drawn toward the knots
        const jx = (hash2(ix * 4 + q, iz, 32) - 0.5) * 1.05 + 0.8 * (vn(x0 / 3.1 + q * 3, z0 / 3.1, 43) - 0.5);
        const jz = (hash2(ix * 4 + q, iz, 33) - 0.5) * 1.05 + 0.8 * (vn(x0 / 3.1 + q * 3, z0 / 3.1, 44) - 0.5);
        const x = sx * Math.max(KERB + 0.8, x0 + jx), z = sz * Math.max(KERB + 0.8, z0 + jz);
        // most face the crossing they are waiting for
        const face = Math.atan2(-x * (0.4 + hash2(ix * 4 + q, iz, 34)), -z * (0.4 + hash2(ix * 4 + q, iz, 35)));
        W.push({ kind: 'crowd', x, z, face, seed: hash2(ix * 4 + q, iz, 36) });
      }
    }
  }
  return W;
}

export function createCrossing(ctx) {
  const tauH = walkClock(154.2) + 0.614 / V;      // the lattice clock's zero: the hero's place is 0.614 m short at 154.2

  let W = buildCrowd();
  // -- closed-form position of walker w at film time t (before the ring freezes it) --
  const out = [0, 0];
  // the walk clock of one walker: it runs with the crowd's until Ts, eases in STILL_D seconds to its
  // crawl (0 near the hero), keeps that until Te (its umbrella has left), and comes to rest in 0.6 s
  const clockOf = (w, t) => {
    if (!(t > w.Ts)) return walkClock(t);
    const cr = w.crawl || 0, u = Math.min(1, (t - w.Ts) / STILL_D);
    let c = walkClock(w.Ts) + STILL_D * (u + (cr - 1) * (u * u * u - 0.5 * u * u * u * u));
    const t1 = w.Ts + STILL_D;
    if (cr > 0 && t > t1) {
      const te = Math.max(w.Te ?? Infinity, t1);
      c += cr * (Math.min(t, te) - t1);
      if (t > te) { const v = Math.min(1, (t - te) / 0.6); c += cr * 0.6 * (v - v * v * v + 0.5 * v * v * v * v); }
    }
    return c;
  };
  // the clearing the hero stands in at the cut from S16 (so that the one umbrella can be read as the
  // same umbrella); it closes as the weave takes them in
  const CLEAR0 = Math.max(2.8, 0.27 * CROSSING.WIDTH.open);
  const heroPos = (t) => { out[0] = 0; out[1] = heroZ(t); return out; };
  function walk(w, t) {
    if (w.kind === 'hero') return heroPos(t);
    if (w.kind === 'crowd') {
      // standing: the small shifts of people waiting
      out[0] = w.x + 0.05 * Math.sin(t * (0.5 + w.seed) + w.seed * 40);
      out[1] = w.z + 0.05 * Math.sin(t * (0.4 + 0.7 * w.seed) + w.seed * 71);
      return out;
    }
    const clock = clockOf(w, t) - tauH;
    let along = mod(w.base + w.sign * V * clock + w.half, 2 * w.half) - w.half + w.jz;
    let across = w.c + w.jx;
    // the eye of asphalt round the hero: a clearing at the cut from S16, which closes as the weave takes
    // them in; and, once they have stopped, the parting: the streams open round the place and close behind it
    const s0 = 1 - smooth((t - 152.5) / 1.7), s1 = smooth((t - 154.5) / 1.0);
    if (s0 > 0 || s1 > 0) {
      const rStop = 3.0 - 1.6 * smooth((t - 158.6) / 1.6);                    // an eye to be seen from 110 m; after the fold, a person's room
      const r0 = Math.hypot(CLEAR0 * s0, rStop * s1), len = Math.max(3.4, 1.25 * r0);
      const hz = heroZ(t), hx = 0;
      const dA = along - (w.axis === 0 ? hz : hx), dC = across - (w.axis === 0 ? hx : hz);
      const g = Math.exp(-((dA / len) ** 2));
      if (g > 1e-4) {
        const sgn = Math.abs(dC) < 0.05 ? w.side : Math.sign(dC);
        across = (w.axis === 0 ? hx : hz) + sgn * Math.sqrt(dC * dC + r0 * r0 * g);
      }
    }
    if (w.axis === 0) { out[0] = across; out[1] = along; } else { out[0] = along; out[1] = across; }
    // standing is not stillness: a weight shifts, an umbrella is steadied
    const st = smooth((t - w.Ts) / (STILL_D + 0.4));
    if (st > 0) {
      out[0] += 0.022 * st * Math.sin(t * (0.9 + 0.8 * w.seed) + w.seed * 60);
      out[1] += 0.022 * st * Math.sin(t * (0.7 + 0.9 * w.seed) + w.seed * 27);
    }
    if (w.neighbour) {                                                         // the one who comes to stand beside the hero
      const k = smooth((t - 159.3) / 1.5);
      out[0] += (CROSSING.NEIGHBOUR[0] - out[0]) * k; out[1] += (CROSSING.NEIGHBOUR[1] - out[1]) * k;
    }
    return out;
  }
  // -- the stillness: each walker's Ts (the ripple that leaves the hero at 160.0) --
  for (const w of W) {
    w.Ts = Infinity;
    if (w.kind === 'hero') continue;
    if (w.kind === 'crowd') { w.Ts = 1e9; continue; }
    let ts = 160.3, r = 0;
    for (let k = 0; k < 3; k++) { const p = walk(w, ts); r = Math.hypot(p[0], p[1]); ts = stillAt(r); }
    w.Ts = ts; w.crawl = crawlAt(r);
  }
  // -- who stands beside the hero, and who is left out so that one umbrella is the first --
  let best = null, bestD = 1e9;
  for (const w of W) {
    if (w.kind !== 'stream' || w.axis !== 0) continue;
    const p = walk(w, 162), dd = Math.hypot(p[0] - CROSSING.NEIGHBOUR[0], p[1] - CROSSING.NEIGHBOUR[1]);
    if (p[0] > 0.8 && dd < bestD) { bestD = dd; best = w; }
  }
  best.neighbour = true; best.crawl = 0;
  W = W.filter((w) => { if (w.kind !== 'stream' || w.neighbour) return true; const p = walk(w, 162); return Math.hypot(p[0], p[1]) > 2.9; });
  // order: hero, neighbour, then by how near they stand to the hero when the ring begins (the nearest
  // are drawn as figures, lib/figure.js; the rest as marks)
  for (const w of W) { const p = walk(w, 162); w.r162 = w.kind === 'hero' ? -2 : w.neighbour ? -1 : Math.hypot(p[0], p[1]); }
  W.sort((a, b) => a.r162 - b.r162);
  const N = W.length;

  // -- the ring (choreo.js RING_KNOTS): everyone stands where the stillness left them; the wave reaches
  //    walker i at arrive[i]. The flock's law is linear in radius, so each zone of the ring is one flock.
  const ZONES = ringZones();
  const arrive = new Float32Array(N), zoneOf = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const w = W[i];
    // those still at a crawl are met where the ring finds them (a fixed point: they move 0.26 m/s, it 30)
    let a = 164, r = 0;
    for (let k = 0; k < 4; k++) {
      const p = walk(w, a);
      r = w.kind === 'hero' ? 0 : w.neighbour ? Math.hypot(CROSSING.NEIGHBOUR[0], CROSSING.NEIGHBOUR[1]) : Math.hypot(p[0], p[1]);
      a = ringArrival(r);
    }
    zoneOf[i] = Math.max(0, ZONES.findIndex((z) => r < z.r1));
    arrive[i] = w.kind === 'hero' ? 1e9 : a;
  }
  const LEAVE = FLOCK_TIMING?.lift ?? 0.672;      // when the wings leave the hand, after the morph begins
  for (let i = 0; i < N; i++) W[i].Te = arrive[i] + LEAVE + 0.15;     // the umbrella has gone: they stop

  // -- buffers --
  const pos = new Float32Array(N * 2), vel = new Float32Array(N * 2);
  const who = new Float32Array(N * 4), when = new Float32Array(N * 3), foldAt = new Float32Array(N).fill(1e9);
  for (let i = 0; i < N; i++) {
    const w = W[i];
    let heading;
    if (w.kind === 'crowd') heading = w.face;
    else if (w.kind === 'hero') heading = 0;
    else heading = w.axis === 0 ? (w.sign > 0 ? 0 : Math.PI) : (w.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    who[i * 4] = heading;
    who[i * 4 + 1] = w.kind === 'hero' ? CROSSING.FACE_UP : arrive[i] + LEAVE + 0.45;     // the umbrella has left the hand: they look up
    who[i * 4 + 2] = w.kind === 'hero' ? 0.5 : w.seed;
    who[i * 4 + 3] = w.kind === 'hero' ? 1 : 0;
    when[i * 3] = w.kind === 'hero' ? SYNC.fold + 0.1 : arrive[i] + LEAVE * 0.6;
    when[i * 3 + 1] = w.kind === 'hero' ? 0.5 : w.seed;
    // shadows multiply where they overlap: on the packed corners they lie three or four deep, so each is
    // laid thinner there, and the crowd's shade comes out as one wash of the same weight as a walker's
    when[i * 3 + 2] = w.kind === 'crowd' ? 0.36 : 1;
    // the flock leans each canopy toward its velocity: give it the heading, at walking speed
    const sp = w.kind === 'crowd' ? 0.6 : V;
    vel[i * 2] = Math.sin(heading) * sp; vel[i * 2 + 1] = Math.cos(heading) * sp;
  }
  foldAt[0] = SYNC.fold;

  // one flock per zone of the ring: its members, and their canopies' places
  const zones = ZONES.map((z, k) => {
    const idx = [];
    for (let i = 0; i < N; i++) if (zoneOf[i] === k) idx.push(i);
    return { ...z, idx, umb: new Float32Array(idx.length * 2) };
  }).filter((z) => z.idx.length > 0);
  function fill(t) {
    for (let i = 0; i < N; i++) {
      const p = walk(W[i], t);
      pos[i * 2] = p[0]; pos[i * 2 + 1] = p[1];
    }
    for (const z of zones) {
      for (let j = 0; j < z.idx.length; j++) { const i = z.idx[j]; z.umb[j * 2] = pos[i * 2]; z.umb[j * 2 + 1] = pos[i * 2 + 1]; }
    }
    // the hero carries the umbrella a little to the right, so the left shoulder shows at its rim
    zones[0].umb[0] = pos[0] + CROSSING.UMBRELLA_OFFSET[0]; zones[0].umb[1] = pos[1] + CROSSING.UMBRELLA_OFFSET[1];
  }
  fill(152);

  const group = new THREE.Group();
  group.name = 'city-crossing';

  // ground
  const groundU = {
    uSunEdge: { value: 0 }, uPxM: { value: 0.05 }, uRing: { value: 0 }, uHero: { value: new THREE.Vector3() }, uTime: { value: 0 }, uDrip: { value: 0 },
    uGold: { value: new THREE.Vector3(...rgb(PALETTE.asphaltGold)) }, uGoldBright: { value: new THREE.Vector3(...rgb(PALETTE.sunGold)) },
  };
  const groundGeo = new THREE.PlaneGeometry(1200, 1200);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.ShaderMaterial({ name: 'crossing-ground', uniforms: groundU, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.frustumCulled = false; ground.renderOrder = 0;
  group.add(ground);

  // shared instance attributes
  const posAttr = new THREE.InstancedBufferAttribute(pos, 2); posAttr.setUsage(THREE.DynamicDrawUsage);
  const whoAttr = new THREE.InstancedBufferAttribute(who, 4), whenAttr = new THREE.InstancedBufferAttribute(when, 3);

  // shadows
  const figN = { value: 0 };
  const shadowU = { uTime: { value: 0 }, uLen: { value: 6 }, uElev: { value: 0.3 }, uStrength: { value: 0.62 }, uSunEdge: groundU.uSunEdge, uFigN: figN };
  const sGeo = new THREE.InstancedBufferGeometry();
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  sGeo.setIndex([0, 1, 2, 0, 2, 3]);
  sGeo.setAttribute('aPos', posAttr); sGeo.setAttribute('aWhen', whenAttr);
  sGeo.instanceCount = N;
  const sMat = new THREE.ShaderMaterial({
    name: 'crossing-shadows', uniforms: shadowU, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, side: THREE.DoubleSide,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const shadows = new THREE.Mesh(sGeo, sMat);
  shadows.frustumCulled = false; shadows.renderOrder = 1;
  group.add(shadows);

  // people
  const peopleU = { uFigN: figN, uTime: { value: 0 }, uMinPx: { value: 1.7 }, uPxPerM: { value: 18 }, uSunEdge: groundU.uSunEdge, uSkin: { value: new THREE.Vector3(1.0, 0.9, 0.74) } };
  const pGeo = new THREE.InstancedBufferGeometry();
  pGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  pGeo.setIndex([0, 1, 2, 0, 2, 3]);
  pGeo.setAttribute('aPos', posAttr); pGeo.setAttribute('aWho', whoAttr);
  pGeo.instanceCount = N;
  const pMat = new THREE.ShaderMaterial({ name: 'crossing-people', uniforms: peopleU, vertexShader: PEOPLE_VERT, fragmentShader: PEOPLE_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const people = new THREE.Mesh(pGeo, pMat);
  people.frustumCulled = false; people.renderOrder = 2;
  group.add(people);

  // the hero and the people nearest them are drawn as people (lib/figure.js, INTERIOR group): the same
  // silhouette the film has shown at the desk and on the train, seen from straight above, each with the
  // long shadow of a person. Under an umbrella nothing of them shows but that shadow.
  const FIG_N = 34;
  const figs = [];
  for (let i = 0; i < FIG_N; i++) {
    const seed = i === 0 ? 'hero' : `crossing-${i}`;
    const body = createFigure({ seed }), shade = createFigure({ seed });
    body.mesh.renderOrder = 2.5; shade.mesh.renderOrder = 1.2;
    group.add(shade.mesh); group.add(body.mesh);
    figs.push({ body, shade });
  }
  figN.value = FIG_N;

  // umbrellas -> butterflies (LOOK's flock)
  for (const z of zones) {
    const n = z.idx.length, v = new Float32Array(n * 2), f = new Float32Array(n);
    z.idx.forEach((i, j) => { v[j * 2] = vel[i * 2]; v[j * 2 + 1] = vel[i * 2 + 1]; f[j] = foldAt[i]; });
    z.flock = createFlock({ count: n, seed: `crossing-${z.r0}`, positions: z.umb, velocities: v, foldAt: f });
    z.flock.mesh.renderOrder = 3;
    group.add(z.flock.mesh);
    // each butterfly's own shadow on the road (LOOK's second mesh): it takes over from the canopy's shadow
    // (ours, above) when the lobes part, and shrinks and softens as its owner climbs
    if (z.flock.shadow) { z.flock.shadow.renderOrder = 1.5; group.add(z.flock.shadow); }
  }

  // the speck: 2 to 3 px of wing blue on the hero's left shoulder
  const speckU = { uSize: { value: 2.6 }, uColor: { value: new THREE.Vector3(...linear(PALETTE.wingBlue)).multiplyScalar(1.5) } };
  const speckGeo = new THREE.BufferGeometry();
  speckGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const speck = new THREE.Points(speckGeo, new THREE.ShaderMaterial({ name: 'crossing-speck', uniforms: speckU, vertexShader: SPECK_VERT, fragmentShader: SPECK_FRAG, transparent: true, depthTest: false, depthWrite: false }));
  speck.frustumCulled = false; speck.renderOrder = 41;
  group.add(speck);
  // and the pool of blue it carries: how the eye finds one person among thousands
  const halo = createSpeckHalo(ctx);
  group.add(halo.mesh);

  // rain
  const rainU = { uRain: { value: 1 }, uTime: { value: 0 }, uPx: { value: 1 / ctx.height }, uAspect: { value: ctx.aspect } };
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const rain = new THREE.Mesh(rGeo, new THREE.ShaderMaterial({ name: 'crossing-rain', uniforms: rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthTest: false, depthWrite: false }));
  rain.frustumCulled = false; rain.renderOrder = 8;
  group.add(rain);

  const toSun = [-0.8 * Math.cos(0.36), Math.sin(0.36), 0.6 * Math.cos(0.36)];     // low, from the lower left
  const v3 = new THREE.Vector3();

  console.info(`[city] crossing: ${N} umbrellas`);
  return {
    group, count: N,
    update(t, localT, shot, p, camera) {
      const cam = crossingCamera(t, ctx.aspect);
      camera.fov = cam.fov; camera.near = 0.4; camera.far = 500;
      camera.updateProjectionMatrix();
      camera.position.set(cam.x, CAM_H, cam.z);
      camera.up.set(0, 0, -1);
      camera.lookAt(cam.x, 0, cam.z);
      camera.updateMatrixWorld(true);
      const pxPerM = ctx.width / cam.width;

      fill(t);
      posAttr.needsUpdate = true;
      for (const z of zones) z.flock.setPositions(z.umb);

      const rainAmt = p.rain ?? (t < 156 ? 1 : 0);
      const sun = p.sunEdge ?? (t < 156 ? 0 : 1);
      const lit = smooth(Math.min(sun, 1) * 1.4);                                   // how far the day has turned
      // 168 -> 170 the wings reach the lens: the first of them pass close, large and soft
      const storm = smooth((t - 167.6) / 1.6);
      const state = {
        walk: 0, walkRate: 0, lean: 0.34 * rainAmt,
        scale: p.wingScale ?? 16,            // 15.7 = the canopy's own span. Checked at 1:1 against the flock's default 10: at 16 the canopy opens INTO wings its own size; at 10 it shrinks into them
        clear: p.clear ?? 1.3 - 0.8 * storm, minPx: 2,
        sun: toSun,
        // enough light that the flock's blue is at its brilliant end (it caps itself before the blue pales)
        sunColor: [0.25 + 1.55 * lit, 0.25 + 1.15 * lit, 0.27 + 0.6 * lit],
        ambient: [0.36 + 0.2 * lit, 0.38 + 0.2 * lit, 0.42 + 0.22 * lit],
        sheen: 1,
        shadow: { ground: 0.02 },
      };
      for (const z of zones) {
        // who flies where: the first to open (within 34 m) climb straight at the lens and reach it from 168;
        // the next ring (to 60 m) leaves later and climbs faster, so it arrives on their heels and the storm
        // builds to the cut at 170; beyond 60 m they rise at the script's 9 m/s and drift, so the ring itself
        // stays a broad band of wings close over the road
        const flight = z.r1 <= 34 ? { rise: p.rise ?? 23, flow: 0.9, goal: [0, CAM_H + 9, 0], spread: [5.5, 3] }
          : z.r1 <= 60 ? { rise: 30, flow: 0.9, goal: [0, CAM_H + 9, 0], spread: [7, 3] }
            : { rise: 9, flow: 0.25, goal: [0, CAM_H + 90, 0], spread: [14, 7] };
        z.flock.set({ ...state, ...flight, morphWave: { centre: [0, 0], t0: z.t0, speed: z.speed, jitter: z.r0 === 0 ? 0 : 0.04 } });
        z.flock.update(t);
      }

      // the figures: walking, coming to rest, the face tipping up; and their shadows where the sun has come
      const edge = -56 + 112 * sun, shLen = (p.shadowLength ?? 6) * (1 + 0.022 * Math.max(0, t - 157));
      for (let i = 0; i < FIG_N; i++) {
        const w = W[i], f = figs[i];
        const x = pos[i * 2], z = pos[i * 2 + 1], a = who[i * 4];
        const turn = (Math.atan2(-Math.cos(a), Math.sin(a)) * 180) / Math.PI;
        // how much of a walk is left in them (1 walking .. 0 standing), and where in the stride they are
        const dt = 0.05;
        const rate = w.kind === 'hero' ? (heroZ(t + dt) - heroZ(t)) / (dt * V * 1.25) : (clockOf(w, t + dt) - clockOf(w, t)) / (dt * 1.25);
        const m = Math.min(1, Math.max(0, rate));
        const phase = (w.kind === 'hero' ? heroZ(t) / 1.4 : (V * clockOf(w, t)) / 1.4) + (w.seed || 0.3) * 3;
        const up = smooth((t - who[i * 4 + 1]) / 0.6);
        const st = { phase, turn, slump: 0.4 * (1 - up), breath: 0.5 + 0.5 * Math.sin(t * 1.6 + i) };
        f.body.mesh.position.set(x, 0, z);
        f.body.set({ ...st, pose: { walk: m, topDown: 1 - m }, face: up, speck: 0, umbrella: i === 0 && t > SYNC.fold + 0.27 ? 0.02 : 0 });
        const litHere = (1 - smooth((x * 0.866 - z * 0.5 - edge + 2.5) / 5)) * (sun > 0.0005 ? 1 : 0);
        f.shade.mesh.position.set(x, 0, z);
        f.shade.mesh.visible = litHere > 0.01;
        f.shade.set({ ...st, pose: { shadow: 0.5 + 0.5 * m + 0.02, upright: 0.5 * (1 - m) }, shadowLength: shLen / 1.7, shadowDir: 36.87, opacity: 0.62 * litHere, soft: 0.02, speck: 0, umbrella: 0, face: 0 });
      }

      groundU.uSunEdge.value = sun;
      groundU.uPxM.value = 1 / pxPerM;
      groundU.uRing.value = 0;
      groundU.uTime.value = t;
      // the last drops: they begin as the rain thins, and are fewer by the time the wings open
      groundU.uDrip.value = 0.55 * smooth((t - 156.6) / 1.2) * (1 - 0.6 * smooth((t - 160.5) / 3)) * (1 - smooth((t - 164) / 2));
      // the sun goes on sinking: the shadows creep longer through the held breath and after
      shadowU.uTime.value = t; shadowU.uLen.value = (p.shadowLength ?? 6) * (1 + 0.022 * Math.max(0, t - 157));
      peopleU.uTime.value = t; peopleU.uPxPerM.value = pxPerM;
      rainU.uRain.value = rainAmt; rainU.uTime.value = t;
      rain.visible = rainAmt > 0;

      // the speck rides the left shoulder (the hero faces +z, so the left is +x)
      speck.geometry.attributes.position.setXYZ(0, pos[0] + 0.2, 1.62, pos[1] + 0.0);
      speck.geometry.attributes.position.needsUpdate = true;
      speckU.uSize.value = 3.2 * (ctx.height / 1080);
      // its pool is a fixed part of the frame, so from far off it is a stain a metre and a half across and
      // close to it is only the shoulder; it thins once the frame is close enough to see the person
      const poolR = Math.min(SPECK.poolR, 0.2 / cam.width);         // never wider than the shoulder it rides
      const pool = halo.set(v3.set(pos[0] + 0.2, 1.62, pos[1]), camera, { r: poolR, amount: 0.62 - 0.46 * smooth((t - 156.2) / 2) });
      groundU.uHero.value.set(pos[0] + 0.2, pos[1], poolR * cam.width);

      // near the end the wings reach the lens: let the focus stay on the ground so they blur
      const dofK = smooth((t - 164.0) / 2.0);
      return {
        // focus stays on the ground: wings within a few metres of the lens go soft, the layers below stay drawn
        dof: dofK > 0 ? { focus: CAM_H, aperture: (p.aperture ?? 0.02) * dofK, maxBlur: 14 } : null,   // gentle: near wings stay wings (LOOK's test)
        ink: {
          paperScroll: [0, 0], mist: 0, mistRange: [300, 500], wet: 0.55 - 0.15 * smooth((t - 161.5) / 1.5), line: 0.25,
          // no pool follows the ring: the ring is made of umbrellas and wings, not of a mask. Only the
          // speck keeps its own small pool of blue
          pools: [{ ...pool, amount: 0.3, rim: 0.3 }],
        },
      };
    },
    dispose() {
      groundGeo.dispose(); groundMat.dispose(); sGeo.dispose(); sMat.dispose(); pGeo.dispose(); pMat.dispose();
      for (const z of zones) z.flock.dispose(); for (const f of figs) { f.body.dispose(); f.shade.dispose(); } halo.dispose(); speckGeo.dispose(); speck.material.dispose(); rGeo.dispose(); rain.material.dispose();
    },
  };
}
