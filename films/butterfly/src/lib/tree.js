// TREE (W5) — the tree that grows where the seed waited.
//
//   const tree = createTree({ seed, leafCount: 40000 });
//   tree.group.position.set(...SEED_SPOT); tree.group.scale.setScalar(TREE_UNIT);   // W2: 1 unit = 100 m
//   scene.add(tree.group);
//   tree.update(t, { growth, season, wind, windDir, leafDensity, seedRelease, release: [t0, t1],
//                    sunDir, sunColor, ambient, ground, fogColor, fogAmount, shafts, focus, bokeh });
//
// Everything is built in METRES in the tree's own frame (base of the trunk at the origin, +Y up,
// the master camera 150 m away on +Z). The crown is grown INSIDE the year-0 skyline of the mountain
// as seen from the locked master camera: attraction points for the branch skeleton are sampled in
// master-camera screen space under masterSkyline(sx, 0), leaves that would poke above it are pulled
// down onto it, a rim of leaves is laid along it, and a per-fragment clip against the same curve
// guarantees that nothing ever crosses it. From the master frame the crown's outline IS P0.
//
// Pure function of time: the skeleton is built once from a seeded RNG; growth, seasons, wind and
// seed release are evaluated in the vertex shaders from uniforms.

import * as THREE from 'three';
import { NOISE } from './glsl/noise.js';
import { createRng } from './random.js';
import { createLine } from './line.js';
import { createParticles } from './particles.js';
import { GRAIN_FRAG } from './grains.js';
import { FX_LAYER } from '../post.js';
import { masterSkyline, masterProject, MASTER_CAMERA, SEED_SPOT } from './valley-story.js';

// ---- master-frame geometry in tree-local metres -------------------------------------------------
export const TREE_UNIT = 0.01; // W2 world units per metre
const CAM = MASTER_CAMERA.position;
const PITCH = (MASTER_CAMERA.rotation[0] * Math.PI) / 180;
const SP = Math.sin(PITCH), CP = Math.cos(PITCH);
// recover the projection constants from valley-story.js rather than copying them
const _probe = masterProject([CAM[0] + 0.1, CAM[1] + SP + 0.1 * CP, CAM[2] - CP + 0.1 * SP]);
const TAN_H = 0.05 / (_probe[0] - 0.5), TAN_V = 0.05 / (_probe[1] - 0.5);

const toWorld = (p) => [SEED_SPOT[0] + p[0] * TREE_UNIT, SEED_SPOT[1] + p[1] * TREE_UNIT, SEED_SPOT[2] + p[2] * TREE_UNIT];
/** Tree-local metres -> master-frame picture coordinates [sx, sy] (0..1, y up). */
export const treeScreen = (p) => masterProject(toWorld(p));
/** Master-frame picture coordinates + local z (metres, + toward the camera) -> tree-local metres. */
export function treeLocalAt(sx, sy, z = 0) {
  const X = (sx - 0.5) * 2 * TAN_H, Y = (sy - 0.5) * 2 * TAN_V;
  const zw = SEED_SPOT[2] + z * TREE_UNIT - CAM[2];
  const depth = zw / (Y * SP - CP);
  const wx = CAM[0] + depth * X, wy = CAM[1] + depth * (Y * CP + SP);
  return [(wx - SEED_SPOT[0]) / TREE_UNIT, (wy - SEED_SPOT[1]) / TREE_UNIT, z];
}

/** Master-frame picture coordinates -> [elevation, azimuth] (degrees) of that sight line (az 0 = -Z, 90 = +X). */
export function masterAngles(sx, sy) {
  const X = (sx - 0.5) * 2 * TAN_H, Y = (sy - 0.5) * 2 * TAN_V;
  const d = [X, Y * CP + SP, Y * SP - CP], l = Math.hypot(d[0], d[1], d[2]);
  return [(Math.asin(d[1] / l) * 180) / Math.PI, (Math.atan2(d[0], -d[2]) * 180) / Math.PI];
}

const ENV_N = 2048;
function buildEnvelope() {
  const E = new Float32Array(ENV_N);
  for (let i = 0; i < ENV_N; i++) E[i] = masterSkyline(i / (ENV_N - 1), 0);
  let B = 0;
  for (let i = 0; i <= 4000; i++) B = Math.max(B, masterSkyline(i / 4000, 10000));
  let sxL = 1, sxR = 0, top = 0, sxTop = 0.5;
  for (let i = 0; i <= 40000; i++) {
    const sx = i / 40000, v = masterSkyline(sx, 0);
    if (v > B) { sxL = Math.min(sxL, sx); sxR = Math.max(sxR, sx); }
    if (v > top) { top = v; sxTop = sx; }
  }
  const picM = 2 * TAN_V * (-SEED_SPOT[2] + CAM[2]) / TREE_UNIT * CP; // picture height in metres at the tree
  return { E, B, sxL, sxR, top, sxTop, picM, at: (sx) => masterSkyline(sx, 0) };
}
/** The crown's envelope in the master frame: outline E(sx), base level B, extent, apex. */
export const TREE_ENVELOPE = buildEnvelope();

// Half-depth (metres, along z) of the crown volume at a point of the envelope.
const CROWN_DEPTH = 12.5;
function crownHalfDepth(sx, sy) {
  const env = TREE_ENVELOPE, top = env.at(sx);
  if (top <= env.B) return 0;
  const f = Math.min(1, Math.max(0, (sy - env.B) / (top - env.B)));
  const w = Math.sqrt((top - env.B) / (env.top - env.B));
  return CROWN_DEPTH * w * Math.sqrt(Math.max(0, 1 - Math.pow(f, 2.2))) * (0.6 + 0.4 * Math.min(1, f / 0.25));
}

// ---- colours (linear) ---------------------------------------------------------------------------
const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

// ---- shared GLSL --------------------------------------------------------------------------------
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
/** Uniform declarations + helpers shared by every tree shader and by ground shadow receivers. */
export const TREE_GLSL = /* glsl */ `
#ifndef TREE_GLSL
#define TREE_GLSL
uniform sampler2D uEnvTex;      // E(sx): the year-0 skyline in master-frame picture coordinates
uniform vec4 uGrow;             // x: horizontal scale, y: vertical scale, z: reveal (0..1), w: thickness
uniform vec4 uSeasonV;          // x: season 0..1 (0 winter, .5 summer), y: leaf amount, z: snow, w: leaf density
uniform vec4 uWindV;            // xyz: wind direction, w: strength 0..1
uniform float uTreeTime;
uniform vec3 uSunDir;
uniform float uLoose;           // 1: the daytime crown, lobed and open; 0: filled out to the old skyline exactly
const vec3 TREE_SEED_SPOT = vec3(${f(SEED_SPOT[0])}, ${f(SEED_SPOT[1])}, ${f(SEED_SPOT[2])});
const vec3 TREE_CAM = vec3(${f(CAM[0])}, ${f(CAM[1])}, ${f(CAM[2])});
const float TREE_M = ${f(TREE_UNIT)};
const float TREE_B = ${TREE_ENVELOPE.B.toFixed(7)};
const float TREE_TOP = ${TREE_ENVELOPE.top.toFixed(7)};
const float TREE_PIC_M = ${TREE_ENVELOPE.picM.toFixed(4)};
// tree-local metres -> master-frame picture coordinates
vec2 treeScreen(vec3 pl) {
  vec3 w = TREE_SEED_SPOT + pl * TREE_M - TREE_CAM;
  float depth = w.y * ${SP.toFixed(8)} - w.z * ${CP.toFixed(8)};
  float up = w.y * ${CP.toFixed(8)} + w.z * ${SP.toFixed(8)};
  return vec2(0.5 + w.x / depth / ${(2 * TAN_H).toFixed(8)}, 0.5 + up / depth / ${(2 * TAN_V).toFixed(8)});
}
float treeEnv(float sx) {
  float x = clamp(sx, 0.0, 1.0) * ${f(ENV_N - 1)};
  int i = int(floor(x));
  float a = texelFetch(uEnvTex, ivec2(i, 0), 0).r, b = texelFetch(uEnvTex, ivec2(min(i + 1, ${ENV_N - 1}), 0), 0).r;
  return mix(a, b, x - float(i));
}
// metres below the envelope as seen from the master camera (negative: outside the old mountain)
float treeClip(vec3 pl) { vec2 s = treeScreen(pl); return (treeEnv(s.x) - s.y) * TREE_PIC_M; }
// The loose crown. By day the tree does not fill the old mountain: lobes are bitten out of its top,
// its underside is scalloped, and the summit is rounded off, differently at every depth, so it reads
// as foliage. 1 = this point of the full-grown crown carries leaves, 0 = it does not (uLoose = 0: all 1).
float treeKeep(vec3 c, float rnd) {
  if (uLoose <= 0.0) return 1.0;
  vec2 sc = treeScreen(c);
  float h = max(treeEnv(sc.x) - TREE_B, 1e-4);
  float f = (sc.y - TREE_B) / h + (rnd - 0.5) * 0.12;
  float env = clamp(h / (TREE_TOP - TREE_B), 0.0, 1.0);
  float n = 0.5 + 0.25 * sin(sc.x * 131.0 + c.z * 0.33 + 0.7) + 0.17 * sin(sc.x * 71.0 - c.z * 0.21 + 2.9) + 0.08 * sin(sc.x * 233.0 + c.z * 0.5 + 5.1);
  float n2 = 0.5 + 0.3 * sin(sc.x * 97.0 + c.z * 0.4 + 1.9) + 0.2 * sin(sc.x * 211.0 - c.z * 0.3 + 0.4);
  float cutTop = 1.0 - uLoose * (0.05 + 0.22 * n + 0.12 * smoothstep(0.65, 1.0, env));
  float cutBot = uLoose * (0.3 * n2 - 0.06) * smoothstep(0.1, 0.5, env);
  return (1.0 - smoothstep(cutTop - 0.1, cutTop + 0.02, f)) * smoothstep(cutBot - 0.05, cutBot + 0.08, f);
}
// growth: the full-grown form scaled about the base of the trunk (slender when young)
vec3 treeGrow(vec3 pl) { return pl * uGrow.xyx; }
// wind: whole-crown lean + branch-scale turbulence, a smooth field so leaves stay on their twigs
vec3 treeSway(vec3 pl, float t) {
  float w = uWindV.w;
  float h = clamp(pl.y / 30.0, 0.0, 1.0);
  float reach = smoothstep(6.0, 26.0, length(pl.xz) * 0.8 + max(pl.y - 11.0, 0.0));
  float gust = 0.55 + 0.45 * sin(t * 0.83 + pl.x * 0.05 - pl.z * 0.04) * sin(t * 0.31 + 1.3);
  vec3 d = uWindV.xyz * (w * gust * h * h * 0.42);
  d += w * reach * 0.22 * vec3(
    sin(t * 1.7 + pl.x * 0.45 + pl.y * 0.30),
    0.5 * sin(t * 2.3 + pl.z * 0.50 + pl.x * 0.21),
    cos(t * 1.3 + pl.x * 0.33 + pl.z * 0.41));
  d += w * reach * 0.05 * vec3(sin(t * 4.1 + pl.y * 1.9 + pl.z * 1.3), sin(t * 5.3 + pl.x * 2.1), cos(t * 3.7 + pl.x * 1.7 + pl.y * 1.1));
  return d;
}
// distance (m) from a point of the full-grown crown to the crown's surface along dir (0 outside)
float treeThickness(vec3 pl, vec3 dir) {
  vec3 R = vec3(20.5, 9.5, 13.5);
  vec3 o = (pl - vec3(-2.6, 21.0, 0.0)) / R, d = dir / R;
  float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
  float disc = b * b - a * c;
  if (disc <= 0.0) return 0.0;
  float s = sqrt(disc);
  float t1 = (-b + s) / a, t0 = (-b - s) / a;
  return max(t1, 0.0) - max(t0, 0.0);
}
#endif
`;

/** Analytic shadow of the tree for ground receivers: float treeShadow(vec3 worldPos) -> 0..1 light. */
export const TREE_SHADOW_GLSL = TREE_GLSL + /* glsl */ `
#ifndef TREE_SHADOW_GLSL
#define TREE_SHADOW_GLSL
float treeShN(vec3 p) {
  vec3 i = floor(p), q = fract(p); q = q * q * (3.0 - 2.0 * q);
  float n = dot(i, vec3(1.0, 57.0, 113.0));
  vec4 a = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
  vec4 b = fract(sin(vec4(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
  vec4 m = mix(a, b, q.z);
  vec2 r = mix(m.xz, m.yw, q.x);
  return mix(r.x, r.y, q.y);
}
float treeShadow(vec3 wp) {
  vec3 L = uSunDir;
  if (L.y < 0.012 || uGrow.y < 0.003) return 1.0;
  vec3 pl = (wp - TREE_SEED_SPOT) / TREE_M;
  float light = 1.0;
  // trunk: closest approach of the sun ray to the trunk axis
  float lh2 = dot(L.xz, L.xz);
  float s = -dot(pl.xz, L.xz) / max(lh2, 1e-5);
  if (s > 0.0) {
    float y = pl.y + L.y * s;
    float d = length(pl.xz + L.xz * s);
    float H = 14.0 * uGrow.y;
    float r = (0.62 + 0.5 * exp(-max(y, 0.0) / (1.2 * max(uGrow.y, 0.05)))) * uGrow.w;
    float soft = 0.05 + s * 0.006;
    float inH = smoothstep(H + 2.0, H - 1.0, y) * step(-0.5, y);
    light *= 1.0 - 0.92 * inH * (1.0 - smoothstep(r - soft, r + soft, d)) * min(1.0, r / (soft * 1.5));
  }
  // crown: march the sun ray through the crown volume (full-grown space, master-frame envelope)
  float yb = 12.5 * uGrow.y, yt = 31.0 * uGrow.y;
  float s0 = max((yb - pl.y) / L.y, 0.0), s1 = max((yt - pl.y) / L.y, 0.0);
  float dens = 0.0;
  if (s1 > s0) {
    float ds = (s1 - s0) / 10.0;
    for (int i = 0; i < 10; i++) {
      vec3 q = (pl + L * (s0 + (float(i) + 0.5) * ds)) / uGrow.xyx;
      vec2 sc = treeScreen(q);
      float top = treeEnv(sc.x);
      float fy = (sc.y - (TREE_B - 0.02)) / max(top - (TREE_B - 0.02), 1e-4);
      if (fy > 0.0 && fy < 1.0 && top > TREE_B) {
        float wd = sqrt((top - TREE_B) / (TREE_TOP - TREE_B));
        float hd = ${f(CROWN_DEPTH)} * wd * sqrt(max(0.0, 1.0 - pow(fy, 2.2))) * (0.6 + 0.4 * min(1.0, fy / 0.25));
        float inside = smoothstep(hd, hd * 0.6, abs(q.z)) * smoothstep(0.0, 0.12, fy) * smoothstep(1.0, 0.85, fy);
        float clump = smoothstep(0.25, 0.75, treeShN(q * 0.33) * 0.7 + treeShN(q * 0.9 + 7.0) * 0.3);
        dens += inside * (0.25 + 0.95 * clump) * ds * uGrow.x;
      }
    }
  }
  float leaves = mix(0.06, 1.0, uSeasonV.y) * uSeasonV.w + 0.5 * uSeasonV.z;
  float crown = exp(-dens * 0.42 * leaves);
  // sun flecks: the gaps between the puffs, carried along the rays
  vec3 qc = (pl + L * max((21.0 * uGrow.y - pl.y) / L.y, 0.0)) / uGrow.xyx;
  float fleck = smoothstep(0.6, 0.82, treeShN(qc * 0.42 + 3.0) * 0.65 + treeShN(qc * 1.1) * 0.35);
  crown = max(crown, 0.55 * fleck * (1.0 - smoothstep(4.0, 30.0, dens)));
  light *= crown;
  return light;
}
#endif
`;

// ---- leaves ---------------------------------------------------------------------------------------
const LEAF_VERT = NOISE + TREE_GLSL + /* glsl */ `
attribute vec3 aPos;    // leaf base (full-grown, local metres)
attribute vec3 aU;      // length axis
attribute vec3 aN;      // leaf normal
attribute vec3 aOff;    // base - centre of its puff of foliage
attribute vec4 aRand;   // phase, size, colour, season jitter
attribute vec3 aLife;   // x: tau (path position 0..1; < 0 = the seedling's two leaves), y: growth at which it is shed, z: puff radius
uniform float uLeafSize, uClear;
uniform vec3 uSunColor;
varying vec2 vUv;
varying vec3 vAlbedo, vTrans, vN, vWorld;
varying vec4 vInfo;     // x: sun visibility, y: sky visibility, z: clip (m), w: snow
void main() {
  float s = fract(uSeasonV.x + (aRand.w - 0.5) * 0.08);
  // the calendar: every change takes a fifth of a year or more, so that a 1.5 s year breathes
  float bud = smoothstep(0.20, 0.40, s);
  float fall = 1.0 - smoothstep(0.74, 0.93, s + (aRand.x - 0.5) * 0.05);
  float leaf = bud * fall;
  float snow = smoothstep(aRand.z * 0.75, aRand.z * 0.75 + 0.35, uSeasonV.z) * step(aRand.x, 0.7);
  bool isSnow = leaf < 0.02 && snow > 0.0;
  float scale = isSnow ? snow * 0.8 : leaf;
  // colours through the year
  vec3 fresh = ${lin('#86A848')}, summer = ${lin('#4F7A2A')}, deep = ${lin('#3C6424')};
  vec3 gold = mix(${lin('#E9B44C')}, ${lin('#D98324')}, aRand.z), rust = ${lin('#8A4A1C')};
  vec3 alb = mix(fresh, mix(summer, deep, aRand.z), smoothstep(0.28, 0.5, s));
  float turn = smoothstep(0.56, 0.74, s + (aRand.z - 0.5) * 0.14);
  alb = mix(alb, gold, turn);
  alb = mix(alb, rust, smoothstep(0.78, 0.9, s) * aRand.x);
  vec3 tr = mix(${lin('#A9C94F')}, ${lin('#FFC548')}, turn) * mix(1.25, 1.0, smoothstep(0.28, 0.5, s));
  float puff = fract(aLife.y);              // one random per puff of foliage
  alb *= (0.75 + 0.5 * aRand.y) * (0.72 + 0.56 * puff);

  vec3 c = aPos, U = aU, N = aN;
  float size = uLeafSize * (0.7 + 0.6 * aRand.y);
  float present = 1.0;
  vec3 cw;
  if (aLife.x < 0.0) {
    // the seedling: two leaves that are there before there is a tree
    present = 1.0 - smoothstep(0.03, 0.1, uGrow.y);
    scale = present; isSnow = false; snow = 0.0;
    alb = ${lin('#7FB84A')}; tr = ${lin('#BFE08A')};
    cw = c; size = 0.55;
  } else {
    if (isSnow) { c -= aOff * 0.85; N = normalize(vec3(N.x * 0.3, 1.0, N.z * 0.3)); U = normalize(cross(N, vec3(aU.z, 0.0, -aU.x) + 1e-3)); alb = ${lin('#E8F0FA')}; tr = vec3(0.0); size *= 1.5; }
    float born = smoothstep(aLife.x - 0.03, aLife.x + 0.05, uGrow.z);
    float shed = 1.0 - smoothstep(aLife.y - 0.05, aLife.y, uGrow.x);
    present = born * shed * step(aRand.x * 0.999, uSeasonV.w);
    if (uLoose > 0.0) {
      // by day: lobes, a scalloped underside, a few missing puffs and hollows of sky
      present *= treeKeep(c, aRand.y);
      present *= 1.0 - uLoose * step(puff, 0.14);
      present *= 1.0 - uLoose * smoothstep(0.3, 0.55, snoise(c * 0.17 + 11.0));
    }
    scale *= present;
    cw = treeGrow(c) + treeSway(c, uTreeTime) * uGrow.y;
    // flutter
    float fl = uWindV.w * sin(uTreeTime * (2.2 + 2.6 * aRand.x) + aRand.x * 40.0) * (isSnow ? 0.0 : 0.55);
    vec3 U2 = normalize(U + N * fl), N2 = normalize(N - U * fl);
    U = U2; N = N2;
  }
  vec3 V = cross(N, U);
  if (uClear > 0.0) {
    // keep the lens clear: leaves shrink away within uClear metres of the camera
    float dCam = length((modelMatrix * vec4(cw, 1.0)).xyz - cameraPosition) / length(modelMatrix[0].xyz);
    scale *= smoothstep(uClear * 0.45, uClear, dCam);
  }
  vec3 pl = cw + (position.x * V * 0.66 + position.y * U) * size * scale;
  vUv = vec2(position.x, position.y);
  vN = N;
  vec4 wp = modelMatrix * vec4(pl, 1.0);
  vWorld = wp.xyz;
  // light reaching this leaf: how much of its own puff, and of the crown, lies between it and the sun
  float amount = uSeasonV.y * uSeasonV.w;
  float R = aLife.z;
  float bL = dot(aOff, uSunDir), cL = dot(aOff, aOff) - R * R;
  float exitSun = -bL + sqrt(max(bL * bL - cL, 0.0));
  float exitUp = -aOff.y + sqrt(max(aOff.y * aOff.y - cL, 0.0));
  float thick = treeThickness(c, uSunDir);
  float sunVis = exp(-(exitSun * 0.5 + thick * 0.085) * amount * mix(0.5, 1.0, uGrow.x));
  float skyVis = mix(0.22, 1.0, exp(-(exitUp * 0.28 + treeThickness(c, vec3(0.0, 1.0, 0.0)) * 0.1) * amount));
  skyVis *= mix(1.0, mix(0.55, 1.0, smoothstep(0.25, 1.0, length(aOff) / max(R, 0.1))), amount);   // the hearts of the puffs are dark
  if (aLife.x < 0.0) { sunVis = 1.0; skyVis = 1.0; }
  vAlbedo = alb; vTrans = tr;
  vInfo = vec4(max(sunVis, 0.0), skyVis, aLife.x < 0.0 ? 1.0 : treeClip(pl) + (aRand.y - 0.5) * 0.08, isSnow ? 1.0 : 0.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (scale < 0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const LEAF_FRAG = /* glsl */ `
uniform vec3 uSunDir, uSunColor, uAmbient, uGround, uFogColor;
uniform float uFogAmount;
varying vec2 vUv;
varying vec3 vAlbedo, vTrans, vN, vWorld;
varying vec4 vInfo;
void main() {
  if (vInfo.z < 0.0) discard;
  float x = vUv.x * 2.0, y = vUv.y;
  float d;
  if (vInfo.w > 0.5) { d = 1.0 - length(vec2(x, y * 2.0 - 1.0)); }
  else {
    float w = pow(max(sin(3.14159 * pow(clamp(y, 0.0, 1.0), 0.7)), 0.0), 0.8) * 0.96;
    d = w - abs(x);
  }
  float aa = fwidth(d) + 1e-4;
  float alpha = smoothstep(-aa, aa, d);
  if (alpha < 0.04) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float ndl = dot(N, uSunDir);
  // veins: only when the leaf is large on screen
  float px = 1.0 / max(fwidth(y), 1e-4);
  float close = smoothstep(14.0, 60.0, px) * (1.0 - vInfo.w);
  float rib = smoothstep(0.045, 0.0, abs(x));
  float vy = y - abs(x) * 0.42;
  float veins = smoothstep(0.42, 0.5, abs(fract(vy * 7.0) - 0.5) * 2.0 * (0.4 + 0.6 * abs(x))) * smoothstep(0.0, 0.1, abs(x));
  float vein = max(rib, veins * 0.6) * close;
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 5.0);
  vec3 front = vAlbedo * max(ndl, 0.0);
  vec3 back = vTrans * (max(-ndl, 0.0) * 0.8 + 0.12) * (0.5 + 1.5 * fwd) * (1.0 - 0.45 * vein) * (1.0 - 0.25 * close * smoothstep(0.5, 0.0, d));
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 28.0) * step(0.0, ndl) * 0.16;
  vec3 col = uSunColor * vInfo.x * (front + back + spec);
  col += vAlbedo * (uAmbient * (0.55 + 0.45 * N.y) + uGround * (0.5 - 0.5 * N.y)) * vInfo.y * (1.0 - 0.3 * vein);
  col = mix(col, uFogColor, uFogAmount);
  gl_FragColor = vec4(col, alpha);
}`;

// ---- branches ---------------------------------------------------------------------------------------
const BRANCH_VERT = NOISE + TREE_GLSL + /* glsl */ `
attribute vec3 aOff;    // ring offset (normal * radius)
attribute vec2 aInfo;   // x: tau, y: radius (m)
uniform vec2 uResolution;
varying vec3 vN, vWorld, vLocal;
varying vec4 vInfo;     // x: sun visibility, y: sky visibility, z: clip, w: radius
void main() {
  float k = clamp((uGrow.z - aInfo.x) / 0.07, 0.0, 1.0);
  float rs = uGrow.w * pow(k, 0.7);
  vec3 c = treeGrow(position) + treeSway(position, uTreeTime) * uGrow.y;
  vec4 mvc = viewMatrix * modelMatrix * vec4(c, 1.0);
  // never thinner than ~0.8 px: keeps the fine tracery of twigs readable from 150 m
  float pxPerM = projectionMatrix[1][1] * 0.5 * uResolution.y / max(-mvc.z, 1e-4) * length(modelMatrix[0].xyz);
  float r = aInfo.y * rs;
  float rmin = 0.42 / pxPerM;
  float widen = r > 0.0 ? max(1.0, rmin / r) : 0.0;
  float keep = aInfo.y < 0.06 ? smoothstep(0.05, 0.5, treeKeep(position, 0.5)) : 1.0;   // twigs end where the daytime crown ends
  vec3 pl = c + aOff * rs * widen * step(0.001, k) * keep;
  vN = normalize(aOff);
  vLocal = position + aOff;
  vec4 wp = modelMatrix * vec4(pl, 1.0);
  vWorld = wp.xyz;
  float amount = uSeasonV.y * uSeasonV.w * uGrow.x;
  float sunVis = exp(-treeThickness(position, uSunDir) * amount * 0.2);
  float skyVis = mix(0.3, 1.0, exp(-treeThickness(position, vec3(0.0, 1.0, 0.0)) * amount * 0.16));
  vInfo = vec4(sunVis, skyVis, treeClip(pl) + 0.05, aInfo.y);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BRANCH_FRAG = NOISE + /* glsl */ `
uniform vec3 uSunDir, uSunColor, uAmbient, uGround, uFogColor;
uniform float uFogAmount;
uniform vec4 uSeasonV;
varying vec3 vN, vWorld, vLocal;
varying vec4 vInfo;
void main() {
  if (vInfo.z < 0.0) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  // bark: vertical furrows, coarser on the trunk
  float big = smoothstep(0.03, 0.4, vInfo.w);
  float ang = atan(vLocal.z, vLocal.x);
  float furrow = snoise(vec3(ang * 5.0, vLocal.y * 0.55, length(vLocal.xz) * 0.8)) * 0.6 + snoise(vec3(vLocal.xz * 9.0, vLocal.y * 2.5)) * 0.4;
  vec3 albedo = ${lin('#2B211B')} * (1.0 + 0.9 * furrow * big) * 1.5;
  albedo = mix(albedo, ${lin('#3A4024')}, 0.35 * big * smoothstep(-0.2, 0.6, snoise(vLocal * 0.7)) * smoothstep(8.0, 0.0, vLocal.y));
  float snow = uSeasonV.z * smoothstep(0.15, 0.6, N.y + 0.25 * furrow);
  albedo = mix(albedo, ${lin('#E8F0FA')}, snow);
  float ndl = max(dot(N, uSunDir), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * (0.5 + 0.5 * max(dot(-V, uSunDir), 0.0));
  vec3 col = albedo * uSunColor * ndl * vInfo.x;
  col += uSunColor * rim * 0.085 * vInfo.x * (0.4 + 0.6 * big + snow);
  col += albedo * (uAmbient * (0.55 + 0.45 * N.y) + uGround * (0.5 - 0.5 * N.y)) * vInfo.y * 0.55;
  col = mix(col, uFogColor, uFogAmount);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- light shafts: blades of lit air running from gaps in the crown along the sun's rays ---------
const SHAFT_VERT = TREE_GLSL + /* glsl */ `
attribute vec3 aOrigin;   // gap in the crown (full-grown local metres)
attribute vec4 aShape;    // x: length (m), y: width (m), z: phase, w: brightness
uniform float uShafts;
varying vec2 vUv;
varying float vGain;
void main() {
  vec3 o = treeGrow(aOrigin);
  vec3 axis = -uSunDir;
  vec3 pl = o + axis * (position.y * aShape.x * uGrow.y);
  vec3 wp = (modelMatrix * vec4(pl, 1.0)).xyz;
  vec3 wAxis = normalize(mat3(modelMatrix) * axis);
  vec3 toCam = normalize(cameraPosition - wp);
  vec3 side = cross(wAxis, toCam);
  float sl = length(side);
  side /= max(sl, 1e-4);
  float width = aShape.y * mix(0.6, 1.6, position.y) * length(modelMatrix[0].xyz) * uGrow.y;
  wp += side * position.x * width;
  vUv = vec2(position.x * 2.0, position.y);
  float flick = 0.55 + 0.45 * sin(uTreeTime * (0.5 + aShape.z * 1.3) + aShape.z * 50.0) * sin(uTreeTime * 0.23 + aShape.z * 17.0);
  // end-on blades (looking straight down a ray) contribute nothing
  vGain = uShafts * aShape.w * flick * smoothstep(0.02, 0.2, sl) * uSeasonV.y * smoothstep(0.5, 0.9, uGrow.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (vGain <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uSunColor;
varying vec2 vUv;
varying float vGain;
void main() {
  float across = exp(-vUv.x * vUv.x * 5.0) * (1.0 - smoothstep(0.7, 1.0, abs(vUv.x)));
  float along = smoothstep(0.0, 0.08, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6);
  gl_FragColor = vec4(uSunColor * vec3(1.0, 0.86, 0.6) * across * along * vGain, 0.0);
}`;

// =====================================================================================================
// skeleton: space colonisation inside the envelope
// =====================================================================================================
function growSkeleton(rng, o) {
  const env = TREE_ENVELOPE;
  const nodes = [];
  const add = (x, y, z, parent) => { nodes.push({ x, y, z, parent, kids: [], tips: 0, r: 0, len: 0 }); return nodes.length - 1; };
  // trunk: a LINE (the film's one meandering curve) rising to the main fork
  let prev = add(0, -3.0, 0, -1);
  const steps = Math.ceil(o.forkHeight / o.step);
  const trunkX = createLine({ seed: o.seed + '/trunk-x', from: [0, 0], to: [o.forkHeight, 0], meander: 0.022, wavelength: 0.8, octaves: 2, branches: 0, pin: [0.3, 0.02] }).stem;
  const trunkZ = createLine({ seed: o.seed + '/trunk-z', from: [0, 0], to: [o.forkHeight, 0], meander: 0.016, wavelength: 0.9, octaves: 2, branches: 0, pin: [0.3, 0.02] }).stem;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps, y = k * o.forkHeight;
    prev = add(trunkX.at(k)[1] + 0.03 * y, y, trunkZ.at(k)[1], prev);
  }
  // main limbs: seven boughs (LINEs again) arching from the fork into the parts of the old mountain:
  // left shoulder, saddle, summit, right face, right foot, one toward and one away from the camera
  const fork = nodes[prev];
  const LIMBS = [[0.368, 0.035, -1.5], [0.43, 0.075, 3.5], [0.512, 0.2, 0.5], [0.565, 0.1, -3.5], [0.603, 0.03, 1.5], [0.487, 0.09, 8.5], [0.532, 0.11, -8.0]];
  LIMBS.forEach(([sx, up, z], li) => {
    const T = treeLocalAt(sx, env.B + up, z);
    // lower boughs leave the trunk a little below the fork, so the limbs do not all spring from one point
    let at = prev - Math.round(((li % 3) * 1.1) / o.step);
    const base = nodes[at];
    const dx = T[0] - base.x, dy = T[1] - base.y, dz = T[2] - base.z, span = Math.hypot(dx, dy, dz);
    const n = Math.max(4, Math.round((span * 0.8) / o.step));
    const hl = Math.hypot(dx, dz) || 1, lx = -dz / hl, lz = dx / hl; // horizontal axis across the limb
    const line = createLine({ seed: `${o.seed}/limb-${li}`, from: [0, 0], to: [1, 0], meander: 0.07, wavelength: 0.55, octaves: 2, branches: 0, pin: [0.15, 0.3] }).stem;
    const lift = 0.1 * span * (1 - 0.6 * dy / span);
    for (let i = 1; i <= n; i++) {
      const k = (i / n) * 0.8, lat = line.at(k / 0.8)[1] * span;
      const rise = k * (0.55 + 0.45 * k);       // boughs leave flat and turn upward
      at = add(base.x + dx * k + lx * lat, base.y + dy * rise + lift * k * (1 - k) * 4, base.z + dz * k + lz * lat, at);
    }
  });
  void fork;
  // attraction points: the crown volume under the old skyline, a little inside the outline
  const A = [];
  const margin = 0.5 / env.picM, droop = 0.022;
  let guard = 0;
  while (A.length < o.attractors * 3 && guard++ < 400000) {
    const sx = env.sxL + (env.sxR - env.sxL) * rng();
    const top = env.at(sx) - margin, lo = env.B - droop * (0.35 + 0.65 * rng());
    const sy = lo + (env.top - lo) * rng();
    if (sy > top) continue;
    const hd = crownHalfDepth(sx, Math.max(sy, env.B));
    if (hd < 0.4) continue;
    const z = (rng() * 2 - 1) * hd;
    const p = treeLocalAt(sx, sy, z);
    A.push(p[0], p[1], p[2]);
  }
  // ...and a chain of points just under the outline so that twigs reach all of it
  for (let i = 0; i < o.rimAttractors; i++) {
    const sx = env.sxL + (env.sxR - env.sxL) * ((i + rng()) / o.rimAttractors);
    const top = env.at(sx);
    if (top - env.B < 0.004) continue;
    const p = treeLocalAt(sx, top - (0.5 + 0.5 * rng()) / env.picM, (rng() * 2 - 1) * 1.2);
    A.push(p[0], p[1], p[2]);
  }
  const nA = A.length / 3;
  const alive = new Uint8Array(nA).fill(1), nearest = new Int32Array(nA).fill(-1), nd = new Float32Array(nA).fill(1e9);
  const di2 = o.influence * o.influence, dk2 = o.kill * o.kill;
  let from = 0;
  for (let iter = 0; iter < 400; iter++) {
    const to = nodes.length;
    for (let a = 0; a < nA; a++) {
      if (!alive[a]) continue;
      const ax = A[a * 3], ay = A[a * 3 + 1], az = A[a * 3 + 2];
      for (let n = from; n < to; n++) {
        const q = nodes[n], dx = ax - q.x, dy = ay - q.y, dz = az - q.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < nd[a]) { nd[a] = d2; nearest[a] = n; }
      }
    }
    from = to;
    const acc = new Map();
    for (let a = 0; a < nA; a++) {
      if (!alive[a] || nd[a] > di2 * (iter < 30 ? 4 : 1)) continue;
      const q = nodes[nearest[a]];
      let dx = A[a * 3] - q.x, dy = A[a * 3 + 1] - q.y, dz = A[a * 3 + 2] - q.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      let v = acc.get(nearest[a]);
      if (!v) { v = [0, 0, 0, dx / l, dy / l, dz / l]; acc.set(nearest[a], v); }
      v[0] += dx / l; v[1] += dy / l; v[2] += dz / l;
    }
    let added = 0;
    for (const [n, v] of acc) {
      const q = nodes[n];
      let l = Math.hypot(v[0], v[1], v[2]);
      if (l < 0.25) { v[0] = v[3]; v[1] = v[4]; v[2] = v[5]; l = 1; }
      // keep some of the parent's heading: long sweeping limbs instead of a zig-zag
      let hx = 0, hy = 0, hz = 0;
      if (q.parent >= 0) { const p = nodes[q.parent]; const hl = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) || 1; hx = (q.x - p.x) / hl; hy = (q.y - p.y) / hl; hz = (q.z - p.z) / hl; }
      let dx = v[0] / l + hx * 0.55 + (rng() - 0.5) * 0.22, dy = v[1] / l + hy * 0.55 + (rng() - 0.5) * 0.22, dz = v[2] / l + hz * 0.55 + (rng() - 0.5) * 0.22;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const nx = q.x + (dx / dl) * o.step, ny = q.y + (dy / dl) * o.step, nz = q.z + (dz / dl) * o.step;
      let dup = false;
      for (const k of q.kids) { const c = nodes[k]; if (Math.hypot(c.x - nx, c.y - ny, c.z - nz) < o.step * 0.45) { dup = true; break; } }
      if (dup || q.kids.length >= 3) continue;
      const id = add(nx, ny, nz, n);
      q.kids.push(id);
      added++;
    }
    for (let a = 0; a < nA; a++) {
      if (!alive[a]) continue;
      const ax = A[a * 3], ay = A[a * 3 + 1], az = A[a * 3 + 2];
      for (let n = from; n < nodes.length; n++) {
        const q = nodes[n], dx = ax - q.x, dy = ay - q.y, dz = az - q.z;
        if (dx * dx + dy * dy + dz * dz < dk2) { alive[a] = 0; break; }
      }
    }
    if (!added) break;
  }
  // trunk children links
  for (let i = 1; i < nodes.length; i++) { const p = nodes[nodes[i].parent]; if (!p.kids.includes(i)) p.kids.push(i); }
  // relax: soften the kinks of the colonisation steps
  for (let pass = 0; pass < 3; pass++) {
    for (let i = nodes.length - 1; i > steps + 2; i--) {
      const q = nodes[i];
      if (q.kids.length !== 1) continue;
      const p = nodes[q.parent], c = nodes[q.kids[0]];
      q.x = 0.5 * q.x + 0.25 * (p.x + c.x); q.y = 0.5 * q.y + 0.25 * (p.y + c.y); q.z = 0.5 * q.z + 0.25 * (p.z + c.z);
    }
  }
  // pipe model radii, path lengths
  for (let i = nodes.length - 1; i >= 0; i--) {
    const q = nodes[i];
    if (!q.kids.length) q.tips = 1;
    if (q.parent >= 0) nodes[q.parent].tips += q.tips;
  }
  let maxLen = 0;
  for (let i = 0; i < nodes.length; i++) {
    const q = nodes[i];
    q.r = o.twigRadius * Math.pow(q.tips, 1 / o.pipe);
    if (q.parent >= 0) { const p = nodes[q.parent]; q.len = p.len + Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); }
    maxLen = Math.max(maxLen, q.len);
    q.kids.sort((a, b) => nodes[b].tips - nodes[a].tips);
  }
  const trunkR = nodes[1].r;
  for (let i = 0; i < nodes.length; i++) {
    const q = nodes[i];
    q.tau = q.len / maxLen;
    if (i <= steps + 1) q.r = trunkR * (1 - 0.12 * Math.min(1, Math.max(0, q.y) / o.forkHeight)) * (1 + 1.0 * Math.exp(-Math.max(q.y, -0.3) / 1.2));
  }
  return { nodes, trunkNodes: steps + 2, maxLen };
}

function buildBranchGeometry(sk) {
  const { nodes } = sk;
  const pos = [], off = [], info = [], idx = [];
  const frame = (dx, dy, dz) => {
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    let rx = 0, ry = 1, rz = 0;
    if (Math.abs(dy) > 0.9) { rx = 1; ry = 0; }
    let ax = dy * rz - dz * ry, ay = dz * rx - dx * rz, az = dx * ry - dy * rx;
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    return [ax, ay, az, dy * az - dz * ay, dz * ax - dx * az, dx * ay - dy * ax];
  };
  const dirOf = (i) => {
    const q = nodes[i];
    let dx = 0, dy = 1, dz = 0;
    if (q.parent >= 0) { const p = nodes[q.parent]; dx = q.x - p.x; dy = q.y - p.y; dz = q.z - p.z; }
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    if (q.kids.length) {
      const c = nodes[q.kids[0]]; let ex = c.x - q.x, ey = c.y - q.y, ez = c.z - q.z;
      const el = Math.hypot(ex, ey, ez) || 1;
      dx += ex / el; dy += ey / el; dz += ez / el;
    }
    return [dx, dy, dz];
  };
  const ring = (q, d, r, sides, tau) => {
    const fr = frame(d[0], d[1], d[2]);
    const base = pos.length / 3;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(q.x, q.y, q.z);
      off.push((fr[0] * c + fr[3] * s) * r, (fr[1] * c + fr[4] * s) * r, (fr[2] * c + fr[5] * s) * r);
      info.push(tau, r);
    }
    return base;
  };
  for (let i = 1; i < nodes.length; i++) {
    const q = nodes[i], p = nodes[q.parent];
    const sides = q.r > 0.25 ? 10 : q.r > 0.09 ? 7 : q.r > 0.035 ? 5 : 3;
    const main = p.kids[0] === i;
    const seg = [q.x - p.x, q.y - p.y, q.z - p.z];
    const b = ring(p, main ? dirOf(q.parent) : seg, main ? Math.max(p.r, q.r) : Math.min(q.r * 1.15, p.r), sides, p.tau);
    const t = ring(q, dirOf(i), q.kids.length ? q.r : q.r * 0.35, sides, q.tau);
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      idx.push(b + k, b + k1, t + k1, b + k, t + k1, t + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
  geo.setIndex(idx);
  return geo;
}

function buildLeafGeometry(rng, sk, o) {
  const env = TREE_ENVELOPE, { nodes } = sk;
  const twigs = [], limbs = [];
  for (let i = sk.trunkNodes; i < nodes.length; i++) (nodes[i].tips <= o.twigTips ? twigs : limbs).push(i);
  // puffs: the foliage gathers in rounded masses around well-spaced twig ends
  const puffs = [];
  {
    const order = twigs.slice();
    rng.shuffle(order);
    order.sort((a, b) => nodes[a].tips - nodes[b].tips); // tips first
    const cell = o.puffSpacing, grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (const id of order) {
      const q = nodes[id];
      let ok = true;
      const cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell), cz = Math.floor(q.z / cell);
      for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1 && ok; j++) for (let k = -1; k <= 1 && ok; k++) {
        const list = grid.get(`${cx + i},${cy + j},${cz + k}`);
        if (list) for (const pf of list) if ((pf.x - q.x) ** 2 + (pf.y - q.y) ** 2 + (pf.z - q.z) ** 2 < cell * cell) { ok = false; break; }
      }
      if (!ok) continue;
      const pf = { x: q.x, y: q.y, z: q.z, tau: q.tau, r: o.puffRadius * (0.75 + 0.6 * rng()), tint: rng(), season: rng() };
      puffs.push(pf);
      const kk = key(q.x, q.y, q.z);
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push(pf);
    }
  }
  const n = o.leafCount;
  const aPos = new Float32Array(n * 3), aU = new Float32Array(n * 3), aN = new Float32Array(n * 3), aOff = new Float32Array(n * 3);
  const aRand = new Float32Array(n * 4), aLife = new Float32Array(n * 3);
  const nRim = Math.floor(n * o.rimFraction), nJuv = Math.floor(n * 0.035), nMain = n - nRim - nJuv - 2;
  const leafM = (o.leafSize * 0.95) / env.picM; // keep leaf tips under the outline
  let w = 0;
  const put = (p, c, R, tau, shed, tint, season) => {
    aPos[w * 3] = p[0]; aPos[w * 3 + 1] = p[1]; aPos[w * 3 + 2] = p[2];
    const ox = p[0] - c[0], oy = p[1] - c[1], oz = p[2] - c[2];
    aOff[w * 3] = ox; aOff[w * 3 + 1] = oy; aOff[w * 3 + 2] = oz;
    const ol = Math.hypot(ox, oy, oz) || 1;
    // length axis: outward from the puff, drooping; normal: random about it
    const s = rng.onSphere();
    let ux = (ox / ol) * 0.6 + s[0] * 0.8, uy = (oy / ol) * 0.6 + s[1] * 0.8 - 0.5, uz = (oz / ol) * 0.6 + s[2] * 0.8;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const r = rng.onSphere();
    const nx = uy * r[2] - uz * r[1], ny = uz * r[0] - ux * r[2], nz = ux * r[1] - uy * r[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    aU[w * 3] = ux; aU[w * 3 + 1] = uy; aU[w * 3 + 2] = uz;
    aN[w * 3] = nx / nl; aN[w * 3 + 1] = ny / nl; aN[w * 3 + 2] = nz / nl;
    aRand[w * 4] = rng(); aRand[w * 4 + 1] = rng();
    aRand[w * 4 + 2] = Math.min(0.999, Math.max(0, tint + (rng() - 0.5) * 0.3));
    aRand[w * 4 + 3] = Math.min(0.999, Math.max(0, season + (rng() - 0.5) * 0.3));
    aLife[w * 3] = tau; aLife[w * 3 + 1] = shed; aLife[w * 3 + 2] = R;
    w++;
  };
  const under = (p) => {
    const s = treeScreen(p), top = env.at(s[0]) - leafM;
    if (s[1] > top) return treeLocalAt(s[0], top - rng() * 0.004, p[2]);
    return p;
  };
  // the seedling's two leaves
  for (let k = 0; k < 2; k++) {
    put([k ? 0.04 : -0.04, 0.25, 0], [0, 0.25, 0], 1, -1, 9, 0.5, 0.5);
    aU[(w - 1) * 3] = k ? 0.75 : -0.75; aU[(w - 1) * 3 + 1] = 0.66; aU[(w - 1) * 3 + 2] = 0.05;
    aN[(w - 1) * 3] = k ? -0.3 : 0.3; aN[(w - 1) * 3 + 1] = 0.34; aN[(w - 1) * 3 + 2] = 0.89;
  }
  // foliage: leaves fill their puff, denser toward its skin
  for (let k = 0; k < nMain; k++) {
    const pf = puffs[k % puffs.length];
    const s = rng.onSphere(), rad = pf.r * Math.pow(rng(), 0.42);
    const p = under([pf.x + s[0] * rad, pf.y + s[1] * rad * 0.72 - 0.15 * pf.r, pf.z + s[2] * rad]);
    if (o.sunWindow) {
      // a ragged opening where the resting sun looks through the crown
      const sc = treeScreen(p), wx = (sc[0] - o.sunWindow[0]) * 2.39 / o.sunWindow[2], wy = (sc[1] - o.sunWindow[1]) / o.sunWindow[2];
      const d = Math.hypot(wx, wy * 0.85);
      if (d < 2.2 && rng() < 0.93 * (1 - sm(0.75, 2.2, d))) continue;
    }
    put(p, [pf.x, pf.y, pf.z], pf.r, pf.tau, 9 + pf.tint * 0.999, pf.tint, pf.season);
  }
  // the rim: leaves laid along the old skyline itself
  const cum = [0]; const RS = 600;
  for (let i = 1; i <= RS; i++) {
    const a = env.sxL + (env.sxR - env.sxL) * ((i - 1) / RS), b = env.sxL + (env.sxR - env.sxL) * (i / RS);
    cum.push(cum[i - 1] + Math.hypot((b - a) * 2.39, env.at(b) - env.at(a)));
  }
  for (let k = 0; k < nRim; k++) {
    const target = ((k + rng()) / nRim) * cum[RS];
    let i = 1; while (i < RS && cum[i] < target) i++;
    const sx = env.sxL + (env.sxR - env.sxL) * ((i - 1 + (target - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9)) / RS);
    const top = env.at(sx);
    if (top - env.B < 0.0015) continue;
    const depth = 0.4 + 1.6 * rng() * rng();
    const p = treeLocalAt(sx, top - leafM * depth, (rng() * 2 - 1) * 1.8);
    // its "puff" is the thin skin of the crown: centre a little way inside, along the inward normal
    const e = 0.002, slope = (env.at(sx + e) - env.at(sx - e)) / (2 * e * 2.39);
    const il = Math.hypot(slope, 1), R = 0.9;
    const c = [p[0] + (slope / il) * R * 0.75, p[1] - (1 / il) * R * 0.75, p[2]];
    const tint = 0.5 + 0.5 * Math.sin(sx * 90) * 0.6, season = 0.5 + 0.4 * Math.sin(sx * 61 + 1);
    put(p, c, R, 0.55 + 0.4 * rng(), 9.5, tint, season);
  }
  // juvenile foliage on what will become bare limbs: shed as the tree spreads
  for (let k = 0; k < nJuv && limbs.length; k++) {
    const id = limbs[Math.floor(rng() * limbs.length)], q = nodes[id];
    const s = rng.onSphere(), rad = q.r + 0.25 + 0.9 * rng();
    put(under([q.x + s[0] * rad, q.y + s[1] * rad, q.z + s[2] * rad]), [q.x, q.y, q.z], 1.2, q.tau, 0.1 + 0.3 * rng(), rng(), rng());
  }
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = (name, arr, size) => quad.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
  inst('aPos', aPos, 3); inst('aU', aU, 3); inst('aN', aN, 3); inst('aOff', aOff, 3); inst('aRand', aRand, 4); inst('aLife', aLife, 3);
  quad.instanceCount = w;
  quad.userData.puffs = puffs.length;
  return quad;
}

// season helpers (JS mirror of the leaf shader's calendar)
const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
/** Leaf cover 0..1 for a season value (0 winter, 0.25 spring, 0.5 summer, 0.75 autumn). */
export const leafAmount = (s) => { s -= Math.floor(s); return sm(0.20, 0.40, s) * (1 - sm(0.74, 0.93, s)); };
/** Snow on the crown 0..1 for a season value. */
export const snowAmount = (s) => { s -= Math.floor(s); const w = s < 0.5 ? s + 1 : s; return sm(0.88, 1.05, w) * (1 - sm(1.08, 1.27, w)); };

/**
 * @param {object} [opts] seed, leafCount (40000), tuftCount (2400), shaftCount (56), leafSize (m)
 * @returns {{ group: THREE.Group, update: Function, uniforms: object, tips: Float32Array, dispose: Function }}
 */
export function createTree(opts = {}) {
  const o = {
    seed: 'grain-tree', leafCount: 56000, tuftCount: 2400, shaftCount: 56, leafSize: 0.46,
    puffSpacing: 1.9, puffRadius: 1.45,
    forkHeight: 10.5, step: 0.5, attractors: 9000, rimAttractors: 700, influence: 5.0, kill: 0.72,
    twigRadius: 0.017, pipe: 2.25, twigTips: 5, rimFraction: 0.1, tuftSize: 1,
    sunWindow: null,   // [sx, sy, radius] in the master frame: where the resting sun looks through the crown
    ...opts,
  };
  const rng = createRng(o.seed);
  const env = TREE_ENVELOPE;
  const sk = growSkeleton(rng.fork('skeleton'), o);

  const envTex = new THREE.DataTexture(env.E, ENV_N, 1, THREE.RedFormat, THREE.FloatType);
  envTex.minFilter = envTex.magFilter = THREE.NearestFilter;
  envTex.needsUpdate = true;

  const uniforms = {
    uEnvTex: { value: envTex },
    uGrow: { value: new THREE.Vector4(1, 1, 1, 1) },
    uSeasonV: { value: new THREE.Vector4(0.5, 1, 0, 1) },
    uWindV: { value: new THREE.Vector4(1, 0, 0, 0.3) },
    uTreeTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
    uAmbient: { value: new THREE.Color(0.2, 0.25, 0.35) },
    uGround: { value: new THREE.Color(0.05, 0.06, 0.03) },
    uFogColor: { value: new THREE.Color(0.5, 0.4, 0.3) },
    uFogAmount: { value: 0 },
    uLeafSize: { value: o.leafSize },
    uClear: { value: 0 },
    uShafts: { value: 0 },
    uLoose: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  };
  const group = new THREE.Group();
  group.name = 'tree';
  const setRes = (renderer) => {
    const rt = renderer.getRenderTarget();
    uniforms.uResolution.value.set(rt ? rt.width : renderer.domElement.width, rt ? rt.height : renderer.domElement.height);
  };

  // branches
  const branchMat = new THREE.ShaderMaterial({ name: 'tree-branches', uniforms, vertexShader: BRANCH_VERT, fragmentShader: BRANCH_FRAG });
  const branches = new THREE.Mesh(buildBranchGeometry(sk), branchMat);
  branches.frustumCulled = false;
  branches.onBeforeRender = setRes;
  group.add(branches);

  // leaves
  const leafMat = new THREE.ShaderMaterial({
    name: 'tree-leaves', uniforms, vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG,
    side: THREE.DoubleSide, alphaToCoverage: true,
  });
  const leaves = new THREE.Mesh(buildLeafGeometry(rng.fork('leaves'), sk, o), leafMat);
  leaves.frustumCulled = false;
  group.add(leaves);

  // tips (for seed tufts and for the worlds' own seed systems)
  const tipList = [];
  for (let i = sk.trunkNodes; i < sk.nodes.length; i++) if (!sk.nodes[i].kids.length) tipList.push(i);
  const tips = new Float32Array(tipList.length * 3);
  tipList.forEach((id, k) => { const q = sk.nodes[id]; tips[k * 3] = q.x; tips[k * 3 + 1] = q.y; tips[k * 3 + 2] = q.z; });

  // light shafts
  let shafts = null;
  if (o.shaftCount > 0) {
    const r = rng.fork('shafts');
    const n = o.shaftCount;
    const origin = new Float32Array(n * 3), shape = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      let p = null;
      for (let tries = 0; tries < 200 && !p; tries++) {
        const sx = env.sxL + (env.sxR - env.sxL) * r(), top = env.at(sx);
        const sy = env.B + (top - env.B) * (0.05 + 0.75 * r());
        const hd = crownHalfDepth(sx, sy);
        if (hd > 2) p = treeLocalAt(sx, sy, (r() * 2 - 1) * hd * 0.7);
      }
      p = p || [0, 20, 0];
      origin.set(p, i * 3);
      shape.set([55 + 85 * r(), 0.35 + 1.5 * r() * r(), r(), 0.35 + 0.65 * r()], i * 4);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      name: 'tree-shafts', uniforms, vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    shafts = new THREE.Mesh(geo, mat);
    shafts.frustumCulled = false;
    shafts.renderOrder = 5;
    shafts.layers.set(FX_LAYER);
    group.add(shafts);
  }

  // seed tufts on the branch tips: they appear, hold, then let go on the wind
  let tufts = null, tuftsSoft = null;
  const tuftUniforms = {
    ...uniforms,
    uTuft: { value: new THREE.Vector4(0, 1e9, 1e9, 1) },   // x: present 0..1, y: release start, z: release end (film s), w: gain
    uLens: { value: new THREE.Vector4(0, 0, 1, 0) },        // x: focus distance (world units, 0 = everything sharp), y: bokeh px per unit defocus, z: unit scale
    uTuftWind: { value: new THREE.Vector4(1, 0.3, 0, 3) },  // xyz: mean drift direction, w: speed (m/s)
  };
  if (o.tuftCount > 0) {
    const r = rng.fork('tufts');
    const aTip = new Float32Array(o.tuftCount * 3);
    for (let i = 0; i < o.tuftCount; i++) {
      const k = Math.floor(r() * tipList.length);
      let p = [tips[k * 3] + (r() - 0.5) * 0.5, tips[k * 3 + 1] + (r() - 0.5) * 0.5, tips[k * 3 + 2] + (r() - 0.5) * 0.5];
      // tufts sit under the old skyline too
      const sc = treeScreen(p), top = env.at(sc[0]) - 0.3 / env.picM;
      if (sc[1] > top) p = treeLocalAt(sc[0], top, p[2]);
      aTip.set(p, i * 3);
    }
    const glsl = TREE_GLSL + /* glsl */ `
      uniform vec4 uTuft, uLens, uTuftWind;
      uniform vec3 uSunColor;
      // position (local metres) and opacity of one tuft: on its tip, then away on the wind
      void tuftFlight(vec3 tip, vec4 seed, float t, out vec3 p, out float alpha, out float age) {
        float tRel = mix(uTuft.y, uTuft.z, pow(seed.x, 0.75));
        age = t - tRel;
        float born = smoothstep(seed.y * 0.9, seed.y * 0.9 + 0.1, uTuft.x);
        vec3 p0 = treeGrow(tip) + treeSway(tip, min(t, tRel)) * uGrow.y;
        p = p0; alpha = born;
        if (age > 0.0) {
          float ramp = age - (1.0 - exp(-age * 1.4)) / 1.4;
          vec3 drift = uTuftWind.xyz * uTuftWind.w * (0.6 + 0.8 * seed.z) + vec3(0.0, 0.5 + 0.9 * seed.w, 0.0) * min(1.0, uTuftWind.w / 2.0);
          p = p0 + drift * ramp;
          vec3 q = tip * 0.07 + seed.xyz * 5.0 + vec3(0.0, age * 0.1, 0.0);
          p += vec3(snoise(q), snoise(q + 31.7), snoise(q + 67.1)) * min(age, 4.0) * 0.7;
          alpha *= 1.0 - smoothstep(14.0, 22.0, age);
        }
      }`;
    const body = (soft) => /* glsl */ `
      vec3 p; float alpha, age;
      tuftFlight(aTip, seed, t, p, alpha, age);
      pos = p;
      vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
      float d = length(wp - cameraPosition);
      float coc = uLens.x > 0.0 ? uLens.y * abs(d - uLens.x) / max(d, 1e-3) : 0.0;
      vec3 vdir = (wp - cameraPosition) / max(d, 1e-5);
      float lit = 0.35 + 2.6 * pow(max(dot(vdir, uSunDir), 0.0), 6.0);
      float thick = treeThickness(age > 0.0 ? p / max(uGrow.xyx, vec3(1e-3)) : aTip, uSunDir) * uSeasonV.y;
      lit *= mix(1.0, exp(-thick * 0.12), 0.8);
      float pxPerU = projectionMatrix[1][1] * 0.5 * uResolution.y / max(d, 1e-4);
      float cocU = coc * (uResolution.y / 1080.0) / pxPerU;
      float tuftU = (0.07 + 0.06 * seed.w) * uLens.z * ${f(o.tuftSize)};
      float blur = smoothstep(2.0, 7.0, coc);
      vec3 warm = mix(vec3(1.0, 0.957, 0.863), vec3(1.0, 0.702, 0.278), 0.35 + 0.4 * seed.z);
      ${soft
    ? `size = max(cocU * 2.0, tuftU);
         float area = max(coc * coc, 9.0) / 9.0;
         color = vec4(warm * uSunColor * lit * uTuft.w * 0.5 / pow(area, 0.62), alpha * blur);`
    : `size = tuftU * 3.2;
         color = vec4(warm * uSunColor * lit * uTuft.w * 1.6, alpha * (1.0 - blur));`}`;
    const mk = (soft) => createParticles({
      name: soft ? 'tree-tufts-bokeh' : 'tree-tufts', count: o.tuftCount, seed: 'tree-tufts',
      attributes: { aTip: { itemSize: 3, array: aTip } }, uniforms: tuftUniforms, glsl,
      position: body(soft), fragment: soft ? GRAIN_FRAG.bubble : GRAIN_FRAG.tuft, blending: 'additive', minPixelSize: 1.6,
    });
    tufts = mk(false); tuftsSoft = mk(true);
    for (const p of [tufts, tuftsSoft]) { p.mesh.layers.set(FX_LAYER); p.mesh.renderOrder = 8; group.add(p.mesh); }
  }

  const v3 = new THREE.Vector3();
  const setColor = (u, c) => { if (!c) return; if (c.isColor) u.value.copy(c); else u.value.setRGB(c[0], c[1], c[2]); };
  return {
    group, uniforms, tuftUniforms, tips, skeleton: sk, envelope: env,
    /** JS mirror of the shader's growth warp: full-grown local metres -> where that point is now. */
    grown(p, out = [0, 0, 0]) { const g = uniforms.uGrow.value; out[0] = p[0] * g.x; out[1] = p[1] * g.y; out[2] = p[2] * g.x; return out; },
    update(t, s = {}) {
      const g = Math.min(1, Math.max(0, s.growth ?? 1));
      const season = s.season ?? 0.5;
      const sy = Math.pow(g, 0.75), sxz = Math.pow(g, 1.25);
      const reveal = 1.08; // every branch is present from the start: the sapling is the tree, drawn in
      uniforms.uGrow.value.set(Math.max(sxz, 1e-4), Math.max(sy, 1e-4), reveal, Math.max(0.02, Math.pow(sy, 1.25)));
      uniforms.uSeasonV.value.set(season - Math.floor(season), leafAmount(season), snowAmount(season), s.leafDensity ?? 1);
      const wd = s.windDir || [1, 0, 0.15];
      v3.set(wd[0], wd[1], wd[2]).normalize();
      uniforms.uWindV.value.set(v3.x, v3.y, v3.z, s.wind ?? 0.3);
      uniforms.uTreeTime.value = t;
      if (s.sunDir) { if (s.sunDir.isVector3) uniforms.uSunDir.value.copy(s.sunDir); else uniforms.uSunDir.value.set(s.sunDir[0], s.sunDir[1], s.sunDir[2]); uniforms.uSunDir.value.normalize(); }
      setColor(uniforms.uSunColor, s.sunColor);
      setColor(uniforms.uAmbient, s.ambient);
      setColor(uniforms.uGround, s.ground);
      setColor(uniforms.uFogColor, s.fogColor);
      uniforms.uFogAmount.value = s.fogAmount ?? 0;
      uniforms.uShafts.value = s.shafts ?? 0;
      uniforms.uClear.value = s.clear ?? 0;
      uniforms.uLoose.value = s.loose ?? 0;
      if (shafts) shafts.visible = (s.shafts ?? 0) > 0;
      if (tufts) {
        const rel = s.release || [1e9, 1e9];
        tuftUniforms.uTuft.value.set(s.seedRelease ?? 0, rel[0], rel[1], s.tuftGain ?? 1);
        group.updateWorldMatrix(true, false);
        const unit = group.getWorldScale(v3).x;
        tuftUniforms.uLens.value.set(s.focus ?? 0, s.bokeh ?? 0, unit, 0);
        const tw = s.tuftWind || [wd[0], wd[1], wd[2], 3];
        tuftUniforms.uTuftWind.value.set(tw[0], tw[1], tw[2], tw[3] ?? 3);
        const on = (s.seedRelease ?? 0) > 0;
        tufts.mesh.visible = on; tuftsSoft.mesh.visible = on && (s.focus ?? 0) > 0;
        tufts.setTime(t); tuftsSoft.setTime(t);
      }
    },
    dispose() {
      branches.geometry.dispose(); branchMat.dispose(); leaves.geometry.dispose(); leafMat.dispose(); envTex.dispose();
      if (shafts) { shafts.geometry.dispose(); shafts.material.dispose(); }
      if (tufts) { tufts.dispose(); tuftsSoft.dispose(); }
    },
  };
}
