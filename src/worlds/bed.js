// W3 BED — the seed's spot in extreme close-up (S07, S09, S12, S13, S16). 1 unit = 1 cm.
// Also exports createBackplate(): the soft-focus master frame of the valley (drawn from
// story.masterSkyline) that sits behind every macro shot and in the sky strip of W4 STRATA.
//
// Each shot is a pure function of film time (no params needed in the shot list):
//   s07  58-65    under the glacier's lip: drops land at 59.0, 60.5, 61.5, 62.0, 62.5, 63.0, then
//                 every 0.5 s, then every 0.25 s; wet spots join; a thread of water runs out right
//   s09  74-82    the stranded lump melts and sets the seed down at 79.0; rack focus 81-82 to the
//                 backplate (identity anchor = the master frame of S10)
//   s12  102-110  split-level flood, waterline at 55%; lightning at 104.0
//   s13  110-122  six trials, 2.0 s each, locked frame: drain, frost, rain, drought, fire, ash
//   s16  154-162  the seedling; rack focus 159.5-161.5; its base sits at masterProject(SEED_SPOT)
// The world owns its cameras, lights, shadow map and post (depth of field, exposure), and exports
// S13_END so that the strata world can pick the picture up at 122.0.
// Layers: additive / hair-fine things live on FX_LAYER and size their own bokeh from the same dof
// numbers the post chain uses; ice is on FX_LAYER too so that the silk frozen inside it stays visible.

import * as THREE from 'three';
import { NOISE } from '../lib/glsl/noise.js';
import { PROFILE_GLSL, MASTER_HORIZON_Y, valleyState, year as storyYear, seedPulse, PALETTE } from '../lib/story.js';
import { createSeed } from '../lib/seed.js';
import { createParticles } from '../lib/particles.js';
import { GRAIN_FRAG } from '../lib/grains.js';
import { createRng } from '../lib/random.js';
import { snoise2, snoise3 } from '../lib/noise.js';
import { lensToFov } from '../lib/camera.js';
import { FX_LAYER } from '../post.js';

const DEG = Math.PI / 180;
const TAN_V = Math.tan(10 * DEG), TAN_H = TAN_V * 2.39;

/** Linear-light colour from an sRGB hex, times a multiplier, as a Vector3. */
export const C = (hex, m = 1) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r * m, c.g * m, c.b * m); };

/** The shared seed (lib/seed.js). Guard: a fragment shader that uses modelMatrix must declare it. */
export function makeSeed(opts) {
  const seed = createSeed(opts);
  seed.group.traverse((o) => {
    const m = o.material;
    if (m && m.isShaderMaterial && /\bmodelMatrix\b/.test(m.fragmentShader) && !/uniform\s+mat4\s+modelMatrix/.test(m.fragmentShader)) {
      m.fragmentShader = 'uniform mat4 modelMatrix;\n' + m.fragmentShader;
      m.needsUpdate = true;
    }
  });
  return seed;
}

// ================================================================================== BACKPLATE
// A screen-space painting of the master frame: sky, the mountain (skyline = story.ridgeProfile for
// the current year, so it lowers and rounds exactly as the valley world's does), a far valley floor.
// `blur` 1 = the creamy out-of-focus shape behind a macro shot, 0 = sharp (rack-focus match cuts).
// `anchor` / `scale` place the master frame inside the picture: anchor = where the master frame's
// (summit x = 0.52, horizon y) lands, in picture coordinates (0..1, y up). Identity: [0.52, HOR], 1.
const PLATE_FRAG = NOISE + PROFILE_GLSL + /* glsl */ `
uniform vec2 uRes; uniform float uPicFrac;
uniform vec3 uXf;
uniform float uBlur, uPeak, uSharp, uTime, uIce;
uniform vec3 uSkyTop, uSkyHor, uGlowCol, uGlowPos;
uniform vec3 uRock, uRockLit, uSnow, uSnowLit, uHazeCol, uFloorNear, uFloorFar, uCloudCol;
uniform float uSkyPow, uSnowLine, uHaze, uLightX, uCloud, uCloudSpeed, uStars, uFlash, uDim, uVeg, uSun, uWalls, uLandMix, uLandGain;
uniform sampler2D uLand;
uniform vec3 uVegCol;
const float HOR = ${MASTER_HORIZON_Y.toFixed(6)};
const float TANH_ = ${TAN_H.toFixed(6)};
const float TANV_ = ${TAN_V.toFixed(6)};
const float SINP = ${Math.sin(5 * DEG).toFixed(6)};
const float COSP = ${Math.cos(5 * DEG).toFixed(6)};

float ridgeU(float sx) { return ((sx - 0.5) * 2.0 * TANH_ * 160.0 - 2.5) / 45.0 + 0.04; }
float ridgeH(float sx, float detail) {
  float wx = (sx - 0.5) * 2.0 * TANH_ * 160.0;
  float u = (wx - 2.5) / 45.0 + 0.04;
  float h = ridgeProfile(u, uPeak, uSharp);
  if (detail > 0.01) {
    float env = smoothstep(1.0, 0.7, abs(u));
    h += detail * env * uPeak * (0.010 + 0.022 * uSharp) * fbm(vec2(u * 9.0, 3.7), 4);
  }
  // low flanking hills so that the horizon is never a ruled line
  float f = 0.9 + 0.9 * snoise(vec2(wx * 0.011, 7.3)) + 0.35 * detail * snoise(vec2(wx * 0.05, 1.2));
  return max(h, max(f, 0.0));
}
float projY(float h) { float dy = h - 0.02; return 0.5 + (dy * COSP - 160.0 * SINP) / (dy * SINP + 160.0 * COSP) / (2.0 * TANV_); }

void main() {
  vec2 pic = vec2(gl_FragCoord.x / uRes.x, (gl_FragCoord.y / uRes.y - 0.5) / uPicFrac + 0.5);
  vec2 m = vec2(0.52, HOR) + (pic - uXf.xy) / uXf.z;
  float detail = 1.0 - smoothstep(0.0, 0.45, uBlur);
  float w = max(uBlur * 0.075, 0.0012) / uXf.z;

  // ---- sky ----
  float hgt = clamp((m.y - HOR) / (1.0 - HOR), 0.0, 1.0);
  vec3 sky = mix(uSkyHor, uSkyTop, pow(hgt, uSkyPow));
  vec2 gd = (m - uGlowPos.xy) * vec2(2.39, 1.0);
  sky += uGlowCol * exp(-dot(gd, gd) / (uGlowPos.z * uGlowPos.z));
  float sunDisc = 0.0;
  if (uSun > 0.0) { float sr = 0.024 + 0.10 * uBlur; sunDisc = uSun * smoothstep(sr, sr * 0.55, length(gd)) / (1.0 + 30.0 * uBlur * uBlur); }
  if (uCloud > 0.0) {
    vec2 cp = vec2(m.x * 2.39 * 1.3 + uTime * uCloudSpeed, m.y * 3.2 + uTime * uCloudSpeed * 0.13);
    float cl = fbm(cp, 4) * 0.5 + 0.5;
    cl = smoothstep(0.62 - 0.5 * uCloud, 0.9 - 0.35 * uCloud, cl + 0.25 * (1.0 - hgt));
    sky = mix(sky, uCloudCol * (0.7 + 0.5 * fbm(cp * 2.1 + 4.0, 3)), cl * (0.35 + 0.65 * uCloud));
  }
  if (uStars > 0.0) {
    vec2 sp = vec2(pic.x * 2.39, pic.y) * 90.0;
    vec2 ci = floor(sp), cf = fract(sp);
    vec4 hs = hash42(ci);
    float d = length(cf - 0.2 - 0.6 * hs.xy);
    float tw = 0.75 + 0.25 * sin(uTime * (1.5 + 4.0 * hs.w) + hs.z * 40.0);
    sky += vec3(0.8, 0.88, 1.0) * uStars * step(0.9, hs.z) * pow(hs.w, 4.0) * tw * 2.2 * exp(-d * d * (40.0 + 300.0 * detail));
  }
  sky += uFlash * vec3(0.75, 0.82, 1.0) * (0.35 + 1.6 * exp(-dot(gd, gd) * 3.0));
  sky += vec3(1.0, 0.82, 0.55) * 14.0 * sunDisc;

  // ---- the mountain: blurred coverage from the skyline ----
  float acc = 0.0, wsum = 0.0;
  for (int i = -2; i <= 2; i++) {
    float o = float(i) * 0.5;
    float wt = 1.0 - 0.35 * abs(o);
    float sy = projY(ridgeH(m.x + o * w * 1.1 / 2.39, detail));
    acc += wt * smoothstep(-w, w, sy - m.y);
    wsum += wt;
  }
  float inside = acc / wsum;

  float topH = ridgeH(m.x, 0.0);
  float hw = max(m.y - HOR, 0.0) / 0.53 * 30.0;              // approx. world height at this pixel
  float u = ridgeU(m.x);
  float nz = detail * fbm(vec2(m.x * 26.0, m.y * 34.0), 4);
  float gully = detail * 0.8 * fbm(vec2(m.x * 19.0 + 3.0, m.y * 23.0), 4);
  float lit = uLightX == 0.0 ? 0.62 : smoothstep(-0.3, 0.35, (u - 0.04) * uLightX * 1.4 + 0.5 * gully + 0.08);
  float snow = smoothstep(-2.2, 2.2, hw + 3.0 * nz + 2.0 * gully - uSnowLine);
  // bare rock on the steep upper faces of the horn
  snow *= 1.0 - 0.85 * detail * uSharp * smoothstep(0.38, 0.66, hw / max(topH, 0.5)) * smoothstep(-0.2, 0.15, nz + 0.4 * gully);
  // glacier: ice filling the valley below the horn
  float ice = uIce * smoothstep(0.75, 0.25, abs(u + 0.02) / max(uIce, 0.05)) * smoothstep(uPeak * (0.25 + 0.5 * uIce), 0.0, hw);
  snow = max(snow, ice);
  vec3 rock = mix(uRock, uRockLit, lit) * (1.0 + 0.5 * nz);
  vec3 sn = mix(uSnow, uSnowLit, lit) * (1.0 + 0.15 * nz);
  vec3 mcol = mix(rock, sn, snow);
  // vegetation tint creeping up the foot
  mcol = mix(mcol, uVegCol * (0.6 + 0.6 * lit), uVeg * smoothstep(uPeak * 0.5, 0.0, hw) * (1.0 - snow));
  // aerial perspective
  float rel = clamp(hw / max(topH, 0.5), 0.0, 1.0);
  mcol = mix(mcol, uHazeCol, clamp(uHaze * (1.15 - 0.6 * rel), 0.0, 1.0));

  vec3 col = mix(sky, mcol, inside);
  // the valley walls at the edges of the master frame (identity-anchored plates only)
  if (uWalls > 0.0) {
    float hl = 0.0125 * uPeak * pow(clamp((0.11 - m.x) / 0.11, 0.0, 1.0), 0.8);
    float hr = 0.008 * uPeak * pow(clamp((m.x - 0.95) / 0.05, 0.0, 1.0), 0.85);
    float hwall = max(hl, hr) * (1.0 + 0.07 * detail * fbm(vec2(m.x * 40.0, 2.0), 3));
    float wk = uWalls * smoothstep(-w, w, HOR + hwall - m.y) * smoothstep(0.0, 0.006, hwall);
    vec3 wc = mix(mix(uRock * 0.8, uRockLit * 0.75, 0.4 + 0.4 * nz), uHazeCol, clamp(uHaze * 1.1, 0.0, 0.75));
    col = mix(col, wc, wk);
  }

  // ---- far valley floor below the horizon ----
  float fl = smoothstep(w, -w, m.y - HOR + 0.004);
  float fk = clamp((HOR - m.y) / HOR, 0.0, 1.0);
  vec3 floorC = mix(uFloorFar, uFloorNear, pow(fk, 0.6)) * (1.0 + 0.25 * detail * fbm(vec2(m.x * 9.0, m.y * 70.0), 3));
  col = mix(col, floorC, fl);

  col *= uDim;
  // the real master frame (rendered by the next shot's world), pixel for pixel
  if (uLandMix > 0.0) col = mix(col, texelFetch(uLand, ivec2(gl_FragCoord.xy), 0).rgb * uLandGain, uLandMix);
  gl_FragColor = vec4(col, 1.0);
}`;

const PLATE_VERT = /* glsl */ `
uniform float uDepth;
void main() {
  vec4 c = projectionMatrix * vec4(0.0, 0.0, -uDepth, 1.0);
  gl_Position = vec4(position.xy, c.z / c.w, 1.0);
}`;

/** Named sky/mountain looks (linear HDR). Any field can be overridden or lerped by the caller. */
export const PLATE_LOOKS = {
  // year 0-300, clear cold morning: blue sky, the horn white with rock faces, grey gravel floor
  morning: {
    skyTop: C('#4a7db0', 1.35), skyHor: C('#c6d6e2', 1.9), skyPow: 0.6, glowCol: C('#ffe9c8', 0.25), glowPos: [0.1, 0.5, 0.5],
    rock: C('#3A3F4A', 0.9), rockLit: C('#8d8a86', 1.3), snow: C('#6d8fba', 1.1), snowLit: C('#f4f6ff', 2.3), snowLine: 7,
    hazeCol: C('#a9c4dc', 1.7), haze: 0.28, lightX: -1, floorNear: C('#6f6a62', 0.9), floorFar: C('#a9b3ba', 1.4),
    cloudCol: C('#E9EEF2', 2.0), cloud: 0.1, cloudSpeed: 0.01, stars: 0, vegCol: C('#6E7B3C', 0.8),
  },
  // year 3,500 storm: slate sky, everything grey
  storm: {
    skyTop: C('#39424d', 0.55), skyHor: C('#77828e', 1.0), skyPow: 0.6, glowCol: C('#8a96a3', 0.12), glowPos: [0.4, 0.7, 0.6],
    rock: C('#15181c', 0.3), rockLit: C('#262b31', 0.35), snow: C('#3c444d', 0.4), snowLit: C('#56616c', 0.5), snowLine: 19,
    hazeCol: C('#3a424b', 0.5), haze: 0.45, lightX: 0, floorNear: C('#3c3a36', 0.5), floorFar: C('#5a6068', 0.7),
    cloudCol: C('#4A5560', 0.75), cloud: 0.95, cloudSpeed: 0.09, stars: 0, vegCol: C('#4a5230', 0.5),
  },
  // clear noon after the flood
  noon: {
    skyTop: C('#4d7fae', 1.5), skyHor: C('#b7cbd8', 1.9), skyPow: 0.75, glowCol: C('#ffffff', 0.25), glowPos: [0.6, 1.1, 0.7],
    rock: C('#544d45', 0.9), rockLit: C('#8C8172', 1.3), snow: C('#8fa4bd', 1.2), snowLit: C('#eef2f8', 2.1), snowLine: 19,
    hazeCol: C('#a8bccb', 1.6), haze: 0.4, lightX: -1, floorNear: C('#857a66', 0.9), floorFar: C('#a8aba6', 1.3),
    cloudCol: C('#E9EEF2', 1.9), cloud: 0.3, cloudSpeed: 0.05, stars: 0, vegCol: C('#6E7B3C', 0.8),
  },
  // frost: cold blue dawn
  frost: {
    skyTop: C('#28446e', 0.8), skyHor: C('#9db6d6', 1.3), skyPow: 0.8, glowCol: C('#cfe0ff', 0.2), glowPos: [0.75, 0.4, 0.5],
    rock: C('#38404e', 0.6), rockLit: C('#6f7c92', 0.8), snow: C('#6f8cb8', 0.9), snowLit: C('#dfe9fb', 1.5), snowLine: 12,
    hazeCol: C('#8aa3c6', 1.1), haze: 0.5, lightX: 1, floorNear: C('#56627a', 0.7), floorFar: C('#93a5c0', 1.0),
    cloudCol: C('#b9c8de', 1.2), cloud: 0.15, cloudSpeed: 0.03, stars: 0, vegCol: C('#5b6a52', 0.6),
  },
  // rain: flat overcast
  rain: {
    skyTop: C('#59636e', 0.9), skyHor: C('#8e99a3', 1.15), skyPow: 0.6, glowCol: C('#ffffff', 0.05), glowPos: [0.5, 0.8, 0.6],
    rock: C('#3b3d40', 0.55), rockLit: C('#5d6166', 0.7), snow: C('#77818c', 0.8), snowLit: C('#9aa5b0', 0.95), snowLine: 20,
    hazeCol: C('#7d8892', 1.0), haze: 0.65, lightX: 0, floorNear: C('#4a4841', 0.6), floorFar: C('#727a80', 0.9),
    cloudCol: C('#6d7781', 1.0), cloud: 0.9, cloudSpeed: 0.12, stars: 0, vegCol: C('#4f5a35', 0.6),
  },
  // drought: bleached hard light
  drought: {
    skyTop: C('#8fa7b8', 1.9), skyHor: C('#e2e0d2', 2.6), skyPow: 0.8, glowCol: C('#fff6e0', 1.2), glowPos: [0.35, 1.0, 0.6],
    rock: C('#6B6257', 1.0), rockLit: C('#b3a791', 1.7), snow: C('#a9a493', 1.3), snowLit: C('#d9d2bd', 2.0), snowLine: 40,
    hazeCol: C('#d6d2c2', 2.1), haze: 0.5, lightX: -1, floorNear: C('#a39274', 1.3), floorFar: C('#cfc7b2', 1.9),
    cloudCol: C('#ffffff', 2.2), cloud: 0.0, cloudSpeed: 0.02, stars: 0, vegCol: C('#8a8455', 0.9),
  },
  // fire: smoke-brown sky lit from below
  fire: {
    skyTop: C('#1d1512', 0.5), skyHor: C('#7a3516', 1.2), skyPow: 0.55, glowCol: C(PALETTE.fire, 1.6), glowPos: [0.3, 0.2, 0.55],
    rock: C('#1a1512', 0.3), rockLit: C('#5a2f1a', 0.6), snow: C('#2a211c', 0.35), snowLit: C('#6b3a22', 0.6), snowLine: 40,
    hazeCol: C('#5a2c16', 0.9), haze: 0.6, lightX: -1, floorNear: C('#1c1410', 0.4), floorFar: C('#5c2a12', 0.9),
    cloudCol: C('#2a1c16', 0.5), cloud: 0.8, cloudSpeed: 0.2, stars: 0, vegCol: C('#2a2416', 0.3),
  },
  // dusk after the fire: ash-grey, failing light
  dusk: {
    skyTop: C('#1c2330', 0.42), skyHor: C('#6f6a70', 0.62), skyPow: 0.6, glowCol: C('#9a8478', 0.16), glowPos: [0.3, 0.27, 0.5],
    rock: C('#15171c', 0.28), rockLit: C('#2e3036', 0.34), snow: C('#262a32', 0.3), snowLit: C('#3d4048', 0.36), snowLine: 40,
    hazeCol: C('#4a4a52', 0.5), haze: 0.5, lightX: -1, floorNear: C('#1b1a1a', 0.28), floorFar: C('#3a3a40', 0.42),
    cloudCol: C('#3a3c44', 0.5), cloud: 0.35, cloudSpeed: 0.02, stars: 0, vegCol: C('#22261c', 0.25),
  },
  // night over the buried seed
  night: {
    skyTop: C('#04060d', 0.3), skyHor: C('#0b1222', 0.4), skyPow: 0.7, glowCol: C('#1b2a4a', 0.05), glowPos: [0.7, 0.6, 0.5],
    rock: C('#020306', 0.2), rockLit: C('#060a14', 0.25), snow: C('#05070d', 0.2), snowLit: C('#0a1020', 0.3), snowLine: 40,
    hazeCol: C('#070B16', 0.35), haze: 0.5, lightX: 1, floorNear: C('#020204', 0.2), floorFar: C('#060912', 0.3),
    cloudCol: C('#0a0f1c', 0.3), cloud: 0.2, cloudSpeed: 0.01, stars: 0.8, vegCol: C('#04060a', 0.2),
  },
  // dawn of year 9,900: a low sun over the worn-down mountain, warm haze, green valley
  // (tuned against the first frame of S17, which the rack focus of S16 cuts into)
  dawn: {
    skyTop: C('#5a3a36', 0.75), skyHor: C('#f09050', 1.5), skyPow: 0.7, glowCol: C('#ffb060', 2.0), glowPos: [0.515, 0.70, 0.2],
    rock: C('#7a5240', 0.75), rockLit: C('#96664a', 0.85), snow: C('#7a5644', 0.75), snowLit: C('#96664a', 0.85), snowLine: 40,
    hazeCol: C('#d88450', 1.15), haze: 0.6, lightX: 0, floorNear: C('#1e2a0c', 0.45), floorFar: C('#4a4a1c', 0.6),
    cloudCol: C('#c98a70', 1.05), cloud: 0.34, cloudSpeed: 0.008, stars: 0, vegCol: C('#3a3a16', 0.6), sun: 1,
  },
};
for (const k in PLATE_LOOKS) if (PLATE_LOOKS[k].sun === undefined) PLATE_LOOKS[k].sun = 0;

const LOOK_KEYS = Object.keys(PLATE_LOOKS.morning);
/** Blend two looks (objects of Vector3 / numbers / arrays) into `out`. */
export function mixLook(a, b, k, out = {}) {
  for (const key of LOOK_KEYS) {
    const x = a[key], y = b[key];
    if (typeof x === 'number') out[key] = x + (y - x) * k;
    else if (Array.isArray(x)) out[key] = x.map((v, i) => v + (y[i] - v) * k);
    else out[key] = (out[key] && out[key].isVector3 ? out[key] : new THREE.Vector3()).copy(x).lerp(y, k);
  }
  return out;
}

export function createBackplate() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const u = {
    uRes: { value: new THREE.Vector2(1920, 1080) }, uPicFrac: { value: 1920 / 2.39 / 1080 },
    uXf: { value: new THREE.Vector3(0.52, MASTER_HORIZON_Y, 1) }, uDepth: { value: 600 },
    uBlur: { value: 1 }, uPeak: { value: 30 }, uSharp: { value: 1 }, uTime: { value: 0 }, uIce: { value: 1 },
    uGlowPos: { value: new THREE.Vector3(0.3, 0.5, 0.5) }, uFlash: { value: 0 }, uDim: { value: 1 }, uVeg: { value: 0 }, uWalls: { value: 0 },
    uLand: { value: null }, uLandMix: { value: 0 }, uLandGain: { value: 1 },
  };
  for (const key of LOOK_KEYS) {
    if (key === 'glowPos') continue;
    const v = PLATE_LOOKS.morning[key];
    u['u' + key[0].toUpperCase() + key.slice(1)] = { value: typeof v === 'number' ? v : v.clone() };
  }
  const mat = new THREE.ShaderMaterial({ name: 'backplate', uniforms: u, vertexShader: PLATE_VERT, fragmentShader: PLATE_FRAG, depthTest: true, depthWrite: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.name = 'backplate';
  mesh.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    const w = rt ? rt.width : renderer.domElement.width, h = rt ? rt.height : renderer.domElement.height;
    u.uRes.value.set(w, h);
    u.uPicFrac.value = Math.min(1, w / 2.39 / h);
  };
  return {
    mesh, uniforms: u,
    /** s: { year, blur, anchor: [x, y], scale, depth, time, flash, dim, look: {...PLATE_LOOKS fields} } */
    set(s) {
      if (s.year !== undefined) {
        const v = valleyState(s.year);
        u.uPeak.value = v.peak; u.uSharp.value = v.sharp; u.uIce.value = v.glacier; u.uVeg.value = v.veg;
      }
      if (s.blur !== undefined) u.uBlur.value = s.blur;
      if (s.anchor) { u.uXf.value.x = s.anchor[0]; u.uXf.value.y = s.anchor[1]; }
      if (s.scale !== undefined) u.uXf.value.z = s.scale;
      if (s.depth !== undefined) u.uDepth.value = s.depth;
      if (s.time !== undefined) u.uTime.value = s.time;
      if (s.flash !== undefined) u.uFlash.value = s.flash;
      if (s.dim !== undefined) u.uDim.value = s.dim;
      if (s.walls !== undefined) u.uWalls.value = s.walls;
      if (s.land !== undefined) u.uLand.value = s.land;
      if (s.landMix !== undefined) u.uLandMix.value = s.landMix;
      if (s.landGain !== undefined) u.uLandGain.value = s.landGain;
      if (s.look) {
        for (const key of LOOK_KEYS) {
          const v = s.look[key];
          if (v === undefined) continue;
          const uu = u['u' + key[0].toUpperCase() + key.slice(1)];
          if (typeof v === 'number') uu.value = v;
          else if (Array.isArray(v)) uu.value.set(v[0], v[1], v[2]);
          else uu.value.copy(v);
        }
      }
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ================================================================================== GROUND-LINE WIPE
// 122.0-123.0: the camera sinks and the soil surface rises through frame, bottom to top. The engine
// can only mix two shots uniformly, so the wipe is built from that: during the second both shots
// render at a constant 50% mix with their display gain doubled (macro.js / s13's post), and each
// blacks itself out on its own side of the edge with this overlay. The bed ('above') survives above
// the edge, the strata ('below') beneath it; the strata side also draws the lip itself: dark soil
// against the lens, soft and out of focus, its rim catching the last of the dusk.
export const WIPE = { t0: 122, t1: 123, gain: [2 - 0.012, 2 - 0.012, 2 - 0.016] };
export const wipeEdge = (t) => { const u = Math.min(1, Math.max(0, (t - WIPE.t0) / (WIPE.t1 - WIPE.t0))); return -0.16 + 1.34 * (0.6 * u + 0.4 * u * u * (3 - 2 * u)); };
const WIPE_FRAG = NOISE + /* glsl */ `
uniform vec2 uRes; uniform float uPicFrac, uEdge, uSide;
uniform vec3 uLipCol;
void main() {
  vec2 pic = vec2(gl_FragCoord.x / uRes.x, (gl_FragCoord.y / uRes.y - 0.5) / uPicFrac + 0.5);
  float x = pic.x * 2.39;
  float e = uEdge + 0.024 * sin(x * 2.1 + 1.0) + 0.013 * sin(x * 5.3 + 4.0) + 0.006 * sin(x * 13.0 + 2.0);
  float d = pic.y - e;                                   // > 0 above the soil surface
  if (uSide > 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - smoothstep(0.015, 0.11, d));
  } else {
    float a = smoothstep(-0.085, -0.03, d);
    float lip = a * (1.0 - smoothstep(0.02, 0.11, d));
    float tex = 0.6 + 0.4 * snoise(vec2(x * 4.5, (pic.y - uEdge) * 11.0)) + 0.12 * snoise(vec2(x * 11.0, (pic.y - uEdge) * 26.0));
    vec3 c = uLipCol * lip * max(tex, 0.0) * (0.35 + 1.5 * smoothstep(-0.03, 0.07, d));
    gl_FragColor = vec4(c, a);
  }
}`;
export function createWipe(side) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const u = { uRes: { value: new THREE.Vector2(1920, 1080) }, uPicFrac: { value: (1920 / 2.39) / 1080 }, uEdge: { value: -1 }, uSide: { value: side === 'above' ? 1 : 0 }, uLipCol: { value: C('#5a544e', 0.3) } };
  const mat = new THREE.ShaderMaterial({
    name: 'wipe-' + side, uniforms: u, vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: WIPE_FRAG,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    const w = rt ? rt.width : renderer.domElement.width, h = rt ? rt.height : renderer.domElement.height;
    u.uRes.value.set(w, h); u.uPicFrac.value = Math.min(1, w / 2.39 / h);
  };
  return {
    mesh, uniforms: u,
    /** Show the overlay for film time t (hidden outside the wipe). */
    set(t) { mesh.visible = t >= WIPE.t0 && t < WIPE.t1; u.uEdge.value = wipeEdge(t); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ================================================================================== WORLD
const PIC = (1920 / 2.39) / 1080;                      // picture height / frame height
const SHADOW_LAYER = 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- places (cm) ---------------------------------------------------------------------------------
const HERO = { x: 0, z: 0, r: 3.1, top: 2.3 };         // S09: the pebble the seed is set down on
const WEDGE = { x: -18.1, y: 1.45, z: 0.5 };           // S12 / S13: the seed between two stones (y is set below)
const DRIP_X = [-9.5, -3.6, 1.4, 6.3, 11.8];           // S07: where the lip drips
const DROPS = [[59.0, 1], [60.5, 3], [61.5, 1], [62.0, 2], [62.5, 0], [63.0, 3], [63.5, 1], [64.0, 4], [64.25, 2], [64.5, 0], [64.75, 3]];
const FALL = 0.6;                                      // a drop lets go 0.6 s before it lands
const LIP_SEED = [4.9, 8.9, 4.1];                     // S07: the seed frozen inside the lip
const PLATE_DEPTH = 420;

// S13's locked camera (also defines what the strata world must match at 122.0)
const S13_CAM = { lens: 38, seedPic: [0.6, 0.36] };

/** Aim `camera` (at pos, lens mm) so that world `point` lands at picture coordinates (sx, sy). */
function aim(camera, pos, lens, point, sx, sy) {
  const fov = lensToFov(lens, camera.aspect);
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const tv = Math.tan(fov * DEG / 2), th = tv * camera.aspect;
  let a = (sx - 0.5) * 2 * th, b = (sy - 0.5) * 2 * PIC * tv, c = 1;
  const l = Math.hypot(a, b, c); a /= l; b /= l; c /= l;
  let dx = point[0] - pos[0], dy = point[1] - pos[1], dz = point[2] - pos[2];
  const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
  const pitch = Math.asin(clamp01((dy / Math.hypot(b, c)) * 0.5 + 0.5) * 2 - 1) - Math.atan2(b, c);
  const zp = b * Math.sin(pitch) - c * Math.cos(pitch);
  const yaw = Math.atan2(dx, dz) - Math.atan2(a, zp);
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
  return { pitch, yaw, dist: dl, horizon: 0.5 - Math.tan(pitch) / tv / (2 * PIC) };
}

// ---- ground height: GLSL + exact JS mirror ----------------------------------------------------------
const GROUND_GLSL = /* glsl */ `
uniform float uGroundY, uMound;
float groundH(vec2 p) {
  return uGroundY + 0.22 * snoise(p * 0.11) + 0.07 * snoise(p * 0.47 + 5.0) + uMound * 2.6 * exp(-dot(p, p) / 400.0);
}`;
const groundHJS = (x, z, gy = 0, mound = 0) => gy + 0.22 * snoise2(x * 0.11, z * 0.11) + 0.07 * snoise2(x * 0.47 + 5, z * 0.47 + 5) + mound * 2.6 * Math.exp(-(x * x + z * z) / 400);

WEDGE.y = groundHJS(WEDGE.x, WEDGE.z) + 1.42;
S13_CAM.pos = [WEDGE.x - 1.3, WEDGE.y + 2.45, WEDGE.z + 20];

/** The last frame of S13 as the strata world must reproduce it at 122.0 (the ground-line transition). */
export const S13_END = (() => {
  const cam = new THREE.PerspectiveCamera(10, 16 / 9, 1, 100);
  const A = aim(cam, S13_CAM.pos, S13_CAM.lens, [WEDGE.x, WEDGE.y, WEDGE.z], S13_CAM.seedPic[0], S13_CAM.seedPic[1]);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const axis = fwd.dot(new THREE.Vector3(WEDGE.x - S13_CAM.pos[0], WEDGE.y - S13_CAM.pos[1], WEDGE.z - S13_CAM.pos[2]));
  return {
    seedPic: S13_CAM.seedPic, frameH: 2 * axis * Math.tan(cam.fov * DEG / 2) * PIC, focus: axis, horizon: A.horizon,
    plateScale: 0.36, plateX: 0.43, plateBlur: 0.9, silkSpread: 0.3, seedTilt: 0.25, backCol: new THREE.Vector3(0.012, 0.012, 0.014),
  };
})();

// ---- shared light + surface-state GLSL ---------------------------------------------------------------
const LIGHT_GLSL = /* glsl */ `
uniform vec3 uKeyDir, uKeyCol, uSkyCol, uBounceCol, uEnvTop, uEnvHor, uAmber, uSeedPos, uFireCol, uFogCol, uSunGate;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform float uShadowOn, uGlow, uTime, uUnder, uFogDen, uSmoke;
uniform vec4 uFire;

float shadowAt(vec3 P, float ndl) {
  if (uShadowOn < 0.01) return 1.0;
  vec4 sc = uShadowMat * vec4(P, 1.0);
  vec3 s = sc.xyz * 0.5 + 0.5;
  if (s.x < 0.01 || s.x > 0.99 || s.y < 0.01 || s.y > 0.99 || s.z > 1.0) return 1.0;
  float bias = 0.0006 + 0.0035 * (1.0 - ndl);
  float ang = hash12(gl_FragCoord.xy) * 6.2832;
  float lit = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = ang + float(i) * 2.39996, r = sqrt((float(i) + 0.5) / 8.0) * 2.4 / 2048.0;
    lit += step(s.z - bias, texture(uShadowMap, s.xy + vec2(cos(a), sin(a)) * r).r);
  }
  return mix(1.0, lit / 8.0, uShadowOn);
}
float sunGate(vec3 P) { return smoothstep(-uSunGate.z, uSunGate.z, P.y + uSunGate.y * P.x - uSunGate.x); }
vec3 envColor(vec3 R) {
  vec3 low = mix(uBounceCol, uEnvHor, 0.3);
  return mix(low, mix(uEnvHor, uEnvTop, smoothstep(0.0, 0.7, R.y)), smoothstep(-0.45, 0.1, R.y));
}
float caustics(vec2 p) {
  vec2 w1 = worley(p * 0.42 + vec2(uTime * 0.28, uTime * 0.07));
  vec2 w2 = worley(p * 0.71 + vec2(-uTime * 0.19, uTime * 0.23) + 4.7);
  return smoothstep(0.22, 0.0, w1.y - w1.x) * 0.7 + smoothstep(0.18, 0.0, w2.y - w2.x) * 0.5;
}
vec3 lightSurface(vec3 P, vec3 N, vec3 albedo, float rough, float f0, float ao) {
  vec3 V = normalize(cameraPosition - P);
  vec3 L = uKeyDir;
  float ndl = max(dot(N, L), 0.0);
  vec3 key = uKeyCol * shadowAt(P + N * 0.06, ndl) * sunGate(P);
  if (uUnder > 0.0) key *= mix(1.0, 0.5 + 2.4 * caustics(P.xz), uUnder);
  if (uSmoke > 0.0) key *= 1.0 - uSmoke * smoothstep(-0.25, 0.45, fbm(P.xz * 0.045 + vec2(-uTime * 0.7, uTime * 0.1), 3));
  vec3 hemi = mix(uBounceCol, uSkyCol, N.y * 0.5 + 0.5);
  vec3 col = albedo * (key * ndl + hemi * ao);
  vec3 H = normalize(L + V);
  float a = max(rough * rough, 0.006), ndh = max(dot(N, H), 0.0);
  float dd = ndh * ndh * (a * a - 1.0) + 1.0;
  float D = min(a * a / (3.14159 * dd * dd), 300.0);
  float ndv = max(dot(N, V), 0.0);
  float fres = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
  col += key * ndl * D * fres * 0.25;
  col += envColor(reflect(-V, N)) * fres * (1.0 - rough) * (1.0 - rough) * ao * (0.55 + 16.0 * max(f0 - 0.03, 0.0));
  vec3 ts = uSeedPos - P; float ds = length(ts);
  col += albedo * uAmber * uGlow * (0.3 + 0.7 * max(dot(N, ts / ds), 0.0)) * 2.2 / (1.0 + ds * ds * 0.7);
  if (uFire.w > 0.0) {
    vec3 tf = uFire.xyz - P; float df = length(tf); vec3 Lf = tf / df;
    float nf = max(dot(N, Lf), 0.0), att = uFire.w / (1.0 + df * df * 0.0012);
    col += albedo * uFireCol * att * (0.12 + nf);
    vec3 Hf = normalize(Lf + V); float nh = max(dot(N, Hf), 0.0), d2 = nh * nh * (a * a - 1.0) + 1.0;
    col += uFireCol * att * nf * min(a * a / (3.14159 * d2 * d2), 120.0) * fres * 0.25;
  }
  if (uUnder > 0.0) col = mix(col, uFogCol, uUnder * (1.0 - exp(-length(cameraPosition - P) * uFogDen)));
  return col;
}`;

const STATE_GLSL = /* glsl */ `
uniform float uWet, uWaterY, uFrost, uAsh, uMoss, uSiltDust;
uniform vec4 uWetSpot[6];
uniform vec3 uSiltCol;
const vec3 FROST_COL = vec3(0.80, 0.89, 1.0);
const vec3 ASH_COL = vec3(0.090, 0.080, 0.074);
const vec3 MOSS_COL = vec3(0.045, 0.10, 0.014);
// returns the frost amount (for sparkle); modifies albedo / roughness / f0 / normal
float applyState(vec3 P, inout vec3 N, inout vec3 albedo, inout float rough, inout float f0, float up) {
  float n1 = snoise(P.xz * 0.9 + P.y * 0.6), n2 = snoise(P * 3.1 + 7.0);
  // silt left on the stones by the flood
  float dust = uSiltDust * smoothstep(-0.5, 0.3, up + 0.12 * n2);
  albedo = mix(albedo, uSiltCol * (0.9 + 0.15 * n2), dust);
  // moss
  if (uMoss > 0.0) {
    float mo = uMoss * smoothstep(-0.35, 0.35, up + 0.55 * n1 + 0.2 * n2);
    float fuzz = snoise(P * 14.0) * 0.5 + snoise(P * 31.0) * 0.5;
    albedo = mix(albedo, MOSS_COL * (0.75 + 0.6 * fuzz + 0.5 * max(n2, 0.0)), mo);
    N = normalize(N + mo * 0.55 * vec3(snoise(P * 17.0 + 3.0), 0.0, snoise(P * 17.0 + 11.0)));
    rough = mix(rough, 0.95, mo); f0 = mix(f0, 0.02, mo);
  }
  // wetness: global, drop splats, and capillary line above standing water
  float wet = uWet * smoothstep(-0.4, 0.4, n1 * 0.5 + uWet * 1.6 - 0.6);
  for (int i = 0; i < 6; i++) {
    float d = length(P.xz - uWetSpot[i].xy) + 0.3 * snoise(P.xz * 1.3 + float(i) * 5.0) * min(uWetSpot[i].z, 1.5);
    wet = max(wet, uWetSpot[i].w * smoothstep(uWetSpot[i].z, uWetSpot[i].z * 0.72, d));
  }
  wet = max(wet, smoothstep(uWaterY + 0.45, uWaterY + 0.08, P.y));
  albedo *= mix(1.0, 0.42, wet);
  rough = mix(rough, 0.2, wet); f0 = mix(f0, 0.07, wet);
  // frost creeping by thresholded noise
  float fr = 0.0;
  if (uFrost > 0.0) {
    float fn = snoise(P * 1.6) * 0.5 + snoise(P * 5.3) * 0.3 + snoise(P * 17.0) * 0.2;
    fr = smoothstep(1.55 - 1.25 * uFrost, 1.95 - 1.25 * uFrost, fn * 0.5 + 0.5 + 0.3 * up);
    albedo = mix(albedo, FROST_COL * (0.62 + 0.2 * snoise(P * 40.0)), fr * 0.92);
    rough = mix(rough, 0.5, fr); f0 = mix(f0, 0.04, fr);
  }
  // ash
  if (uAsh > 0.0) {
    float ash = clamp(uAsh * smoothstep(-0.2, 0.5, up + 0.3 * n1 + uAsh * 0.9 - 0.75), 0.0, 1.0);
    albedo = mix(albedo, ASH_COL * (0.8 + 0.5 * n2 + 0.6 * step(0.72, snoise(P * 23.0))), ash);
    rough = mix(rough, 0.97, ash); f0 = mix(f0, 0.02, ash);
  }
  return fr;
}
vec3 frostSparkle(vec3 P, vec3 N, float fr) {
  if (fr <= 0.0) return vec3(0.0);
  vec3 cell = floor(P * 55.0);
  vec3 rn = hash33(cell) - 0.5;
  vec3 V = normalize(cameraPosition - P);
  vec3 H = normalize(uKeyDir + V);
  float sp = pow(max(dot(normalize(N + rn * 1.3), H), 0.0), 90.0) * step(0.86, hash13(cell + 3.0));
  return (uKeyCol * 5.0 + uSkyCol * 2.0) * sp * fr;
}`;

// ---- pebbles ---------------------------------------------------------------------------------------
const PEBBLE_VERT = /* glsl */ `
attribute vec3 aTint; attribute vec4 aRnd;
varying vec3 vW, vN, vObj, vTint; varying vec4 vRnd;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vW = wp.xyz; vN = mat3(m) * normal; vObj = mat3(m) * position + aRnd.x * 37.0;
  vTint = aTint; vRnd = aRnd;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const PEBBLE_FRAG = NOISE + GROUND_GLSL + LIGHT_GLSL + STATE_GLSL + /* glsl */ `
varying vec3 vW, vN, vObj, vTint; varying vec4 vRnd;
void main() {
  vec3 Ng = normalize(vN);
  vec3 q = vObj;
  float n1 = snoise(q * 1.1), n2 = snoise(q * 4.3 + 3.0), n3 = snoise(q * 13.0 + 9.0), n4 = snoise(q * 37.0);
  vec3 albedo = vTint * (0.9 + 0.13 * n1 + 0.09 * n2 + 0.06 * n3);
  albedo *= 1.0 - 0.4 * smoothstep(0.35, 0.75, n4) * vRnd.y;
  albedo += 0.10 * smoothstep(0.45, 0.8, -n4) * vRnd.z;
  float vein = smoothstep(0.05, 0.0, abs(snoise(q * 0.55 + vRnd.x * 20.0) - 0.12)) * step(0.7, vRnd.w);
  albedo = mix(albedo, vec3(0.62, 0.61, 0.58), vein * 0.75);
  vec3 N = normalize(Ng + 0.07 * vec3(n3, n4 * 0.5, snoise(q * 13.0 + 31.0)));
  float rough = 0.74 + 0.1 * n2, f0 = 0.03;
  float gh = groundH(vW.xz);
  float ao = 0.3 + 0.7 * smoothstep(-0.1, 1.4, vW.y - gh);
  albedo *= 0.75 + 0.25 * smoothstep(0.0, 0.35, vW.y - gh);          // damp, dirty waterline at the base
  float fr = applyState(vW, N, albedo, rough, f0, Ng.y);
  vec3 col = lightSurface(vW, N, albedo, rough, f0, ao) + frostSparkle(vW, N, fr);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- ground ----------------------------------------------------------------------------------------
const GROUND_VERT = NOISE + GROUND_GLSL + /* glsl */ `
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y = groundH(wp.xz);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GROUND_FRAG = NOISE + GROUND_GLSL + LIGHT_GLSL + STATE_GLSL + /* glsl */ `
uniform vec3 uGritCol, uLoamCol;
uniform float uSiltK, uLoamK, uCrack, uDry, uRipple;
varying vec3 vW;
vec4 grainCell(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  float best = 9.0; vec2 bo = vec2(0.0), bid = vec2(0.0);
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 r = g + hash22(i + g) - f;
    float d = dot(r, r);
    if (d < best) { best = d; bo = r; bid = i + g; }
  }
  return vec4(sqrt(best), hash12(bid + 17.3), bo);
}
float crackEdge(vec2 p) { vec2 w = worley(p * 0.42 + 0.35 * vec2(snoise(p * 0.3), snoise(p * 0.3 + 9.0))); return w.y - w.x; }
void main() {
  vec2 p = vW.xz;
  float e = 0.06;
  float h0 = groundH(p);
  vec3 N = normalize(vec3(-(groundH(p + vec2(e, 0.0)) - h0) / e, 1.0, -(groundH(p + vec2(0.0, e)) - h0) / e));
  float dist = length(cameraPosition - vW);
  float lod = smoothstep(260.0, 40.0, dist);
  // --- grit: sand grains and tiny stones between the pebbles ---
  vec4 g1 = grainCell(p * 2.6), g2 = grainCell(p * 9.0 + 7.0);
  float r1 = mix(0.3, 0.62, fract(g1.y * 13.7));
  float in1 = smoothstep(r1, r1 - 0.12, g1.x);
  vec3 grit = uGritCol * mix(0.55 * (0.8 + 0.4 * g2.y), mix(0.7, 1.35, fract(g1.y * 5.3)), in1 * lod);
  grit = mix(grit, vec3(0.55, 0.54, 0.5), step(0.93, g2.y) * 0.5 * lod);
  vec3 Ngrit = normalize(N + lod * (in1 * vec3(-g1.z, 0.0, -g1.w) * 1.1 + vec3(-g2.z, 0.0, -g2.w) * 0.5));
  // --- silt: fine, with current ripples ---
  float rip = sin(p.x * 2.1 + 1.6 * snoise(p * 0.21) + 0.6 * snoise(p * 0.9)) * uRipple;
  vec3 silt = uSiltCol * (0.88 + 0.10 * fbm(p * 0.6, 3) + 0.05 * snoise(p * 9.0) * lod + 0.04 * rip);
  vec3 Nsilt = normalize(N + vec3(0.16 * rip * cos(p.x * 2.1), 0.0, 0.0) + lod * 0.05 * vec3(g2.z, 0.0, g2.w));
  // --- loam: dark crumbs, with moss ---
  float clod = fbm(p * 0.9, 4);
  vec3 loam = uLoamCol * (0.7 + 0.7 * g2.y * lod + 0.5 * clod);
  vec3 Nloam = normalize(N + lod * (vec3(-g2.z, 0.0, -g2.w) * 0.9 + 0.5 * vec3(snoise(p * 3.1), 0.0, snoise(p * 3.1 + 5.0))));
  vec3 albedo = mix(mix(grit, silt, uSiltK), loam, uLoamK);
  vec3 Nn = normalize(mix(mix(Ngrit, Nsilt, uSiltK), Nloam, uLoamK));
  float rough = mix(mix(0.8, 0.62, uSiltK), 0.9, uLoamK), f0 = 0.03;
  float ao = 1.0;
  // --- drying: paler, then cracked into tiles ---
  albedo *= 1.0 + 0.3 * uDry * uSiltK;
  rough = mix(rough, 0.9, uDry);
  if (uCrack > 0.0) {
    float ed = crackEdge(p);
    float grow = smoothstep(0.0, 0.25, uCrack * 1.25 - 0.25 * (snoise(p * 0.13) * 0.5 + 0.5));
    float wdt = 0.015 + 0.065 * uCrack;
    float crack = smoothstep(wdt, wdt * 0.45, ed) * grow;
    float ex = crackEdge(p + vec2(0.04, 0.0)), ez = crackEdge(p + vec2(0.0, 0.04));
    float lip = smoothstep(wdt * 5.0, wdt, ed) * grow;
    Nn = normalize(Nn + vec3(-(ex - ed), 0.0, -(ez - ed)) / 0.04 * (-1.6 * lip * uCrack));
    albedo *= mix(1.0, 0.16, crack);
    albedo *= 1.0 + 0.16 * (hash12(floor(worley(p * 0.42).xx * 50.0)) - 0.5) * grow;
    ao *= 1.0 - 0.8 * crack;
  }
  float fr = applyState(vW, Nn, albedo, rough, f0, 1.0 - 0.8 * uLoamK);
  vec3 col = lightSurface(vW, Nn, albedo, rough, f0, ao) + frostSparkle(vW, Nn, fr);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- water film / thread ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */ `
uniform float uWaterY, uOwnY;
varying vec3 vW;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); wp.y = mix(uWaterY, wp.y, uOwnY); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const WATER_FRAG = NOISE + GROUND_GLSL + LIGHT_GLSL + /* glsl */ `
uniform float uWaterY, uFilm, uThread, uRain, uFlow, uWaveAmp, uSparkle, uOwnY;
uniform vec4 uWetSpot[6];
varying vec3 vW;
float threadZ(float x) { return 7.4 + 1.5 * sin(x * 0.33 + 1.0) + 0.6 * sin(x * 0.81 + 0.3); }
void main() {
  vec2 p = vW.xz;
  float mask = uFilm;
  if (uOwnY > 0.5) {
    // S07: the thread of meltwater, a ribbon laid along the ground that runs out of frame right
    float w = 2.0 + 0.6 * snoise(vec2(p.x * 0.4, 2.0));
    float head = smoothstep(uThread, uThread - 2.5, p.x);
    mask = smoothstep(w, w * 0.6, abs(p.y - threadZ(p.x))) * head * smoothstep(-11.5, -7.0, p.x);
  } else {
    if (uThread > -90.0) {
      // S07: little pools under the drips
      float m = 0.0;
      for (int i = 0; i < 5; i++) {
        float d = length(p - uWetSpot[i].xy) + 0.3 * snoise(p * 1.2 + float(i) * 3.0);
        m = max(m, uWetSpot[i].w * smoothstep(uWetSpot[i].z * 0.8, uWetSpot[i].z * 0.5, d));
      }
      mask = m;
    }
    mask *= smoothstep(-0.02, 0.05, uWaterY - groundH(p));   // only where the water stands above the ground
  }
  if (mask < 0.01) discard;
  // ripple normal: flowing noise + rain rings
  vec2 fp = p * vec2(0.8, 0.45) - vec2(uTime * uFlow, 0.0);
  float ee = 0.05;
  float a0 = snoise(fp) + 0.5 * snoise(fp * 2.3 + 3.0), ax = snoise(fp + vec2(ee, 0.0)) + 0.5 * snoise((fp + vec2(ee, 0.0)) * 2.3 + 3.0), az = snoise(fp + vec2(0.0, ee)) + 0.5 * snoise((fp + vec2(0.0, ee)) * 2.3 + 3.0);
  float wfade = 1.0 / (1.0 + length(cameraPosition - vW) * 0.02);
  vec3 N = normalize(vec3(-(ax - a0) / ee * uWaveAmp * wfade, 1.0, -(az - a0) / ee * uWaveAmp * wfade));
  if (uRain > 0.0) {
    vec2 cp = p / 2.6; vec2 ci = floor(cp);
    for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
      vec2 c = ci + vec2(float(xx), float(yy));
      vec4 h = hash42(c);
      float age = fract(uTime * (0.9 + 0.5 * h.z) + h.w);
      vec2 dv = (c + 0.15 + 0.7 * h.xy) * 2.6 - p; float d = length(dv);
      float ring = sin((d - age * 2.6) * 14.0) * exp(-pow((d - age * 2.6) * 2.4, 2.0)) * (1.0 - age) * uRain;
      N.xz += dv / max(d, 0.01) * ring * 0.55;
    }
    N = normalize(N);
  }
  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 H = normalize(uKeyDir + V);
  float ndh = max(dot(N, H), 0.0);
  float glint = pow(ndh, 1400.0) * 90.0 + pow(ndh, 90.0) * 1.2;
  // running water catches the low sun: sparkles travelling with the flow
  float spk = pow(max(snoise(vec2(p.x * 6.0 - uTime * 2.4 * uFlow, p.y * 9.0)), 0.0), 6.0) + 0.6 * pow(max(snoise(vec2(p.x * 13.0 - uTime * 3.6 * uFlow, p.y * 17.0 + 5.0)), 0.0), 5.0);
  glint += spk * 70.0 * uSparkle;
  vec3 key = uKeyCol * sunGate(vW) * shadowAt(vW, 1.0);
  vec3 col = envColor(reflect(-V, N)) * fres + key * glint;
  // even in shade a running thread shimmers with the light of the ice above it
  col += uEnvTop * spk * 2.5 * uSparkle;
  col += envColor(reflect(-V, N)) * 0.35 * uOwnY;
  float a = mask * (0.22 + 0.7 * fres + 0.3 * uOwnY);
  gl_FragColor = vec4(col * mask, a);
}`;

// ---- ice (the lip of S07, the lump of S09) ---------------------------------------------------------
const ICE_VERT = /* glsl */ `
varying vec3 vW, vN, vObj;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz; vObj = position;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ICE_FRAG = NOISE + LIGHT_GLSL + /* glsl */ `
uniform vec3 uIceCol, uIceDeep, uIceGlow, uWindow;
uniform float uWindowR, uIceAlpha, uObjScale, uTrans;
varying vec3 vW, vN, vObj;
void main() {
  vec3 Ng = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (dot(Ng, V) < 0.0) Ng = -Ng;
  vec3 q = vObj * uObjScale;
  // melt scallops: smooth shallow cups
  vec3 nz = vec3(snoise(q * 0.3), snoise(q * 0.3 + 11.0), snoise(q * 0.3 + 23.0));
  vec3 nz2 = vec3(snoise(q * 1.4), snoise(q * 1.4 + 5.0), snoise(q * 1.4 + 17.0));
  vec3 N = normalize(Ng + 0.17 * nz + 0.045 * nz2);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  float gate = sunGate(vW);
  float wrap = max(dot(N, uKeyDir) * 0.65 + 0.35, 0.0);
  float cloudy = 0.5 + 0.5 * snoise(q * 0.12 + 3.0);
  float bubbles = smoothstep(0.62, 0.8, snoise(q * 2.6 + 2.0));
  float thin = smoothstep(-26.0, 6.0, vW.z);
  vec3 body = mix(uIceDeep, uIceCol, 0.30 + 0.45 * cloudy);
  vec3 hemi = mix(uBounceCol, uSkyCol, N.y * 0.5 + 0.5);
  vec3 col = body * (uKeyCol * wrap * gate * 0.32 + hemi * 1.2);
  col += uIceGlow * uTrans * thin * (0.4 + 0.6 * cloudy) * (0.45 + 0.55 * ndv);      // light carried through the ice
  col += (uKeyCol * gate * 0.25 + uSkyCol * 0.6) * bubbles * 0.25;
  vec3 H = normalize(uKeyDir + V);
  float ndh = max(dot(N, H), 0.0);
  col += uKeyCol * gate * (pow(ndh, 300.0) * 9.0 + pow(ndh, 30.0) * 0.12);
  vec3 R = reflect(-V, N);
  col += envColor(R) * fres * 0.55 * smoothstep(-0.55, 0.1, R.y);
  float dw = length(vW - uWindow);
  float win = exp(-dw * dw / (uWindowR * uWindowR));
  col += uAmber * uGlow * 0.5 * exp(-dw * dw / (uWindowR * uWindowR * 3.0));
  float alpha = mix(uIceAlpha, 1.0, fres);
  alpha *= 1.0 - 0.94 * win * (1.0 - 0.6 * fres);
  col *= 1.0 - 0.6 * win;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

// ---- seedling (S16): stem + two cotyledons, back-lit ------------------------------------------------
const LEAF_VERT = /* glsl */ `
varying vec3 vW, vN; varying vec2 vUv;
uniform float uSway, uTime;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  #ifdef USE_INSTANCING
    wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    float ph = instanceMatrix[3][0] * 0.4 + instanceMatrix[3][2] * 0.3;
    wp.x += uSway * uv.x * uv.x * (0.16 * sin(uTime * 1.3 + ph) + 0.06 * sin(uTime * 3.1 + ph * 2.0));
  #else
    vN = normalize(mat3(modelMatrix) * normal);
  #endif
  vW = wp.xyz; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const LEAF_FRAG = NOISE + LIGHT_GLSL + /* glsl */ `
uniform vec3 uLeafCol, uTransCol;
uniform float uVeins, uThick;
varying vec3 vW, vN; varying vec2 vUv;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  float mid = smoothstep(0.07, 0.0, abs(vUv.y - 0.5)) * uVeins;
  float lat = smoothstep(0.7, 1.0, sin((vUv.x * 7.0 - abs(vUv.y - 0.5) * 9.0) * 3.14159)) * 0.3 * uVeins;
  vec3 albedo = uLeafCol * (0.86 + 0.14 * snoise(vec3(vUv * vec2(9.0, 5.0), vW.x))) * (1.0 - 0.3 * mid - 0.14 * lat);
  vec3 col = lightSurface(vW, N, albedo, 0.42, 0.045, 1.0);
  float back = max(dot(-N, uKeyDir), 0.0);
  float sh = shadowAt(vW + uKeyDir * uThick, 1.0);
  col += uTransCol * uKeyCol * (0.25 + 0.75 * back) * sh * (1.0 - 0.5 * mid - 0.25 * lat) * 0.45 * step(0.0, dot(-N, uKeyDir) + 0.3);
  col += uKeyCol * pow(1.0 - abs(dot(N, V)), 3.0) * 0.05 * max(dot(-V, uKeyDir), 0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- S12 split-level overlay: the water surface across the lens ---------------------------------------
const SPLIT_FRAG = NOISE + /* glsl */ `
uniform vec2 uRes; uniform float uPicFrac, uTime, uLine, uFlash;
uniform vec3 uFogCol, uShaftCol, uSkyRefl, uWaterDark;
void main() {
  vec2 pic = vec2(gl_FragCoord.x / uRes.x, (gl_FragCoord.y / uRes.y - 0.5) / uPicFrac + 0.5);
  float x = pic.x * 2.39;
  float wl = uLine + 0.011 * sin(x * 2.3 + uTime * 1.6) + 0.006 * sin(x * 5.7 - uTime * 2.7) + 0.003 * sin(x * 12.0 + uTime * 4.3);
  float d = pic.y - wl;
  vec3 col = vec3(0.0); float a = 0.0;
  if (d > 0.0) {
    // the flood seen from just above its surface, receding to its own horizon
    float hz = 0.085 + 0.006 * sin(x * 1.3 + uTime * 0.7);
    float k = clamp(d / hz, 0.0, 1.0);
    float depth = 1.0 / (1.06 - k);
    vec2 wp = vec2((pic.x - 0.5) * depth * 7.0 + uTime * 0.5, depth * 2.4 + uTime * 0.25);
    float wav = fbm(wp * vec2(1.0, 2.2), 4);
    float crest = smoothstep(0.15, 0.6, wav);
    vec3 wc = mix(uWaterDark, uSkyRefl, 0.28 + 0.5 * crest + 0.25 * k);
    // rain: rings and little crowns sparkle on the surface
    vec2 cell = floor(wp * vec2(3.0, 5.0)); vec4 h = hash42(cell);
    float age = fract(uTime * (1.3 + h.z) + h.w);
    wc += uSkyRefl * 1.6 * step(0.55, h.x) * exp(-age * 7.0) * smoothstep(0.5, 0.1, length(fract(wp * vec2(3.0, 5.0)) - 0.5));
    wc *= 1.0 + 2.5 * uFlash;
    col = wc; a = smoothstep(hz + 0.012, hz - 0.012, d);
    col *= a;
  } else {
    float dep = -d;
    float under = exp(-dep * 7.5);
    float sx = x + dep * 0.75;
    float sh = 0.55 + 0.6 * snoise(vec2(sx * 2.1, uTime * 0.22)) + 0.3 * snoise(vec2(sx * 6.3 + 4.0, uTime * 0.37));
    float shafts = pow(clamp(sh, 0.0, 1.0), 2.4) * exp(-dep * 3.2) * (1.0 + 4.0 * uFlash);
    // total internal reflection just under the surface: a silvery, wavering mirror
    float mir = smoothstep(0.09, 0.0, dep) * (0.5 + 0.5 * snoise(vec2(x * 7.0 + uTime * 1.2, dep * 60.0)));
    a = 0.16 + 0.42 * under;
    col = uFogCol * (1.5 + 2.2 * under) * a + uShaftCol * shafts * 0.55 + uSkyRefl * mir * 0.22;
  }
  // meniscus on the lens
  float men = exp(-pow(d / 0.0065, 2.0));
  col = col * (1.0 - men * 0.9) + uSkyRefl * 0.5 * exp(-pow((d - 0.011) / 0.004, 2.0));
  a = max(a, men * 0.92);
  gl_FragColor = vec4(col, a);
}`;

const DEPTH_VERT = /* glsl */ `
void main() {
  #ifdef USE_INSTANCING
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #endif
}`;

// ---- particles that defocus themselves (they live on FX_LAYER, drawn sharp after depth of field) ----
const BOKEH_GLSL = /* glsl */ `uniform vec3 uDof; uniform float uBk; varying float vSoft;`;
// in: pos, base size `size`; out: size grown by the circle of confusion, vSoft, energy factor `dim`
const BOKEH_SIZE = /* glsl */ `
      float dim = 1.0;
      {
        vec4 mv_ = modelViewMatrix * vec4(pos, 1.0);
        float z_ = max(-mv_.z, 1e-3);
        float cpx = abs(clamp(uDof.y * (z_ - uDof.x) / z_, -1.0, 1.0)) * uDof.z * (uResolution.y / 1080.0);
        float ppu = projectionMatrix[1][1] * 0.5 * uResolution.y / z_;
        float grow = 2.0 * cpx / ppu * uBk;
        vSoft = grow / (size + grow);
        dim = pow(size / (size + grow), 1.25);
        size += grow;
      }`;
const BOKEH_FRAG = /* glsl */ `
    vec2 q = vec2(uv.x * mix(1.0, 1.5, smoothstep(0.2, 0.7, vSoft)), uv.y); float r = length(q);
    float disc = 1.0 - smoothstep(0.86, 1.0, r);
    float rim = smoothstep(0.62, 0.9, r) * disc;
    float aB = disc * (0.5 + 0.5 * rim);
    float r2 = dot(uv, uv);
    float aP = exp(-r2 * 5.0) * (1.0 - smoothstep(0.75, 1.0, r2));
    float a = mix(aP, aB, smoothstep(0.25, 0.6, vSoft));
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`;

// ---- geometry builders -----------------------------------------------------------------------------
function buildPebbleGeo(detail, off, hy, sz) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const f = (x, y, z, o) => {
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    const r = 1 + 0.06 * snoise3(x * 0.5 + off, y * 0.5, z * 0.5) + 0.012 * snoise3(x * 1.6, y * 1.6 + off, z * 1.6);
    let Y = y * r * hy;
    if (Y < -0.5 * hy) Y = -0.5 * hy + (Y + 0.5 * hy) * 0.3;
    o[0] = x * r; o[1] = Y; o[2] = z * r * sz;
    return o;
  };
  const p = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0];
  let top = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let t1x, t1y, t1z;
    if (Math.abs(y) > 0.95) { t1x = 1; t1y = 0; t1z = 0; } else { const l = Math.hypot(z, x); t1x = z / l; t1y = 0; t1z = -x / l; }
    const t2x = y * t1z - z * t1y, t2y = z * t1x - x * t1z, t2z = x * t1y - y * t1x;
    const e = 0.02;
    f(x, y, z, p); f(x + e * t1x, y + e * t1y, z + e * t1z, a); f(x + e * t2x, y + e * t2y, z + e * t2z, b);
    const ux = a[0] - p[0], uy = a[1] - p[1], uz = a[2] - p[2], vx = b[0] - p[0], vy = b[1] - p[1], vz = b[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nx * p[0] + ny * p[1] + nz * p[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    pos.setXYZ(i, p[0], p[1], p[2]); nor.setXYZ(i, nx, ny, nz);
    top = Math.max(top, p[1]);
  }
  g.userData.top = top;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  return g;
}

function buildLip() {
  const prof = [[-14, 46], [1.0, 24], [5.4, 11.5], [5.3, 8.2], [3.0, 6.9], [-7, 5.4], [-30, 0.0]].map(([z, y]) => new THREE.Vector3(0, y, z));
  const curve = new THREE.CatmullRomCurve3(prof, false, 'centripetal');
  const NU = 260, NV = 110, pos = new Float32Array((NU + 1) * (NV + 1) * 3), idx = [];
  const pt = new THREE.Vector3();
  // find the arc parameter of the lip's lowest front point
  let tipV = 0.5, tipY = 1e9;
  for (let j = 0; j <= 400; j++) { curve.getPointAt(j / 400, pt); if (pt.z > 2.5 && pt.y < tipY) { tipY = pt.y; tipV = j / 400; } }
  let k = 0;
  for (let j = 0; j <= NV; j++) {
    const v = Math.pow(j / NV, 1.0);
    curve.getPointAt(v, pt);
    const wtip = Math.exp(-Math.pow((v - tipV) / 0.13, 2));
    for (let i = 0; i <= NU; i++) {
      const x = lerp(-75, 75, i / NU);
      let y = pt.y + wtip * (1.2 * snoise2(x * 0.085, 3.1) + 0.45 * snoise2(x * 0.31, 7.7));
      let z = pt.z + 1.1 * snoise2(x * 0.06, v * 4.0 + 1.3) + 0.4 * snoise3(x * 0.23, v * 14.0, 2.2);
      for (const dx of DRIP_X) y -= 1.0 * Math.exp(-Math.pow((x - dx) / 0.75, 2)) * Math.exp(-Math.pow((v - tipV) / 0.035, 2));
      pos[k++] = x; pos[k++] = y; pos[k++] = z;
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + NU + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // where each drip hangs: the lowest vertex of the front of the lip near that x
  const drips = DRIP_X.map((dx) => {
    let best = [dx, 1e9, 4.5];
    for (let q = 0; q < pos.length; q += 3) if (Math.abs(pos[q] - dx) < 0.5 && pos[q + 2] > 2.0 && pos[q + 1] < best[1]) best = [pos[q], pos[q + 1], pos[q + 2]];
    return best;
  });
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
  return { geo, drips };
}

function buildLump() {
  const g = buildPebbleGeo(16, 41.7, 0.78, 0.9);
  return g;
}

function buildLeaf() {
  const NU = 14, NV = 8, L = 1.9;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const w = 0.43 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.75) + 0.03 * (1 - u);
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * 2 - 1;
      pos.push(u * L, 0.22 * v * v * w + 0.10 * Math.sin(Math.PI * u) - 0.16 * u * u, v * w);
      uv.push(u, j / NV);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
function buildBlade() {
  const N = 7, pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, w = 0.11 * (1 - u * u) + 0.01;
    pos.push(-w, u, 0.22 * u * u, w, u, 0.22 * u * u); uv.push(u, 0, u, 1);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---- the six trials of S13 (2.0 s each from 110.0) ------------------------------------------------
const TRIALS = [
  { look: 'noon', keyDir: V3(-0.45, 0.75, 0.1), key: C('#fff3e0', 3.4), sky: C('#9fc0e6', 0.7), bounce: C('#8a7a5c', 0.25), envTop: C('#5f8fc4', 0.9), envHor: C('#c9d9e6', 1.1), shadow: 1, exposure: -0.55, sat: 0.8, glow: 0.8, day: 0.35 },
  { look: 'frost', keyDir: V3(0.62, 0.36, 0.3), key: C('#cfe2ff', 3.0), sky: C('#6f93c8', 1.0), bounce: C('#5a6a86', 0.4), envTop: C('#2f507e', 0.9), envHor: C('#a9c0e0', 1.3), shadow: 0.9, exposure: -0.25, sat: 0.72, glow: 0.7, day: 0.45 },
  { look: 'rain', keyDir: V3(0.1, 0.95, 0.2), key: C('#aab4be', 0.7), sky: C('#8792a0', 1.35), bounce: C('#4a4a46', 0.4), envTop: C('#6d7781', 1.0), envHor: C('#98a2ac', 1.2), shadow: 0.35, exposure: 0.1, sat: 0.6, glow: 0.62, day: 0.75 },
  { look: 'drought', keyDir: V3(-0.66, 0.52, 0.1), key: C('#fff0d0', 4.6), sky: C('#bcd0e0', 0.5), bounce: C('#b09a70', 0.35), envTop: C('#8fa7b8', 1.0), envHor: C('#e2e0d2', 1.3), shadow: 1, exposure: -0.75, sat: 0.72, glow: 0.52, day: 0.32 },
  { look: 'fire', keyDir: V3(-0.5, 0.5, 0.3), key: C('#ff9a5a', 0.35), sky: C('#3a2018', 0.55), bounce: C('#2a1408', 0.5), envTop: C('#1d1512', 0.5), envHor: C('#7a3516', 1.2), shadow: 0.5, exposure: 0.0, sat: 1.12, glow: 0.42, day: 0.85 },
  { look: 'dusk', keyDir: V3(-0.55, 0.4, 0.25), key: C('#9aa0bc', 1.5), sky: C('#5a6480', 1.0), bounce: C('#1a1a1c', 0.3), envTop: C('#1c2330', 0.5), envHor: C('#6f6a70', 0.7), shadow: 0.7, exposure: 1.1, sat: 0.6, glow: 0.3, day: 1.0 },
];

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(10, ctx.aspect, 2, 3000);
  scene.add(camera);
  const rng = createRng(ctx.seed ^ 0xbed5);

  const plate = createBackplate();
  plate.set({ depth: PLATE_DEPTH });
  scene.add(plate.mesh);

  // ---- shared uniforms ----
  const U = {
    uKeyDir: { value: V3(0, 1, 0) }, uKeyCol: { value: V3(1, 1, 1) }, uSkyCol: { value: V3(0.3, 0.3, 0.3) }, uBounceCol: { value: V3(0.1, 0.1, 0.1) },
    uEnvTop: { value: V3(1, 1, 1) }, uEnvHor: { value: V3(1, 1, 1) }, uAmber: { value: C(PALETTE.amber) }, uSeedPos: { value: V3(0, 0, 0) },
    uFireCol: { value: C(PALETTE.fire, 9) }, uFogCol: { value: C('#6B5633', 0.8) }, uSunGate: { value: V3(-1000, 0, 1) },
    uShadowMap: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 1 }, uGlow: { value: 0 }, uTime: { value: 0 },
    uUnder: { value: 0 }, uFogDen: { value: 0.03 }, uSmoke: { value: 0 }, uFire: { value: new THREE.Vector4(0, 0, 0, 0) },
    uWet: { value: 0 }, uWaterY: { value: -100 }, uFrost: { value: 0 }, uAsh: { value: 0 }, uMoss: { value: 0 }, uSiltDust: { value: 0 },
    uWetSpot: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, 0, 0)) }, uSiltCol: { value: C('#B49B6E', 0.85) },
    uGroundY: { value: 0 }, uMound: { value: 0 },
  };

  // ---- pebbles ----
  const SHAPES = [[11.3, 0.5, 0.86], [23.9, 0.62, 0.78], [37.1, 0.44, 0.95], [5.7, 0.7, 0.9], [51.2, 0.56, 0.7]];
  const geoHi = SHAPES.map(([o, hy, sz]) => buildPebbleGeo(18, o, hy, sz));
  const geoLo = SHAPES.map(([o, hy, sz]) => buildPebbleGeo(5, o, hy, sz));
  const TINTS = ['#7D776C', '#8a8478', '#6f6a63', '#9a958b', '#5d5a57', '#8b7e6c', '#6b7078', '#a39c8f', '#4e4b49', '#857f7a'].map((h) => new THREE.Color(h));
  const peb = [];
  const addPeb = (x, z, r, opt = {}) => {
    const variant = opt.variant ?? rng.int(0, 4);
    const top = geoHi[variant].userData.top;
    const y = opt.top !== undefined ? opt.top - r * top : groundHJS(x, z) + r * top * rng.range(0.25, 0.55);
    const tc = TINTS[opt.tint ?? rng.int(0, TINTS.length - 1)], tb = opt.tint !== undefined ? 1 : rng.range(0.75, 1.2);
    peb.push({ x, y, z, r, variant, rotY: rng.range(0, Math.PI * 2), tiltX: opt.flat ? 0 : rng.gauss(0, 0.12), tiltZ: opt.flat ? 0 : rng.gauss(0, 0.12),
      tint: [tc.r * tb, tc.g * tb, tc.b * tb], rnd: [rng(), rng(), rng(), rng()], hi: !!opt.hi, solo: opt.top !== undefined || !!opt.flat, top: y + r * top });
    return peb[peb.length - 1];
  };
  const hero = addPeb(HERO.x, HERO.z, HERO.r, { variant: 0, top: HERO.top, flat: true, hi: true, tint: 3 });
  addPeb(WEDGE.x - 2.4, WEDGE.z - 1.0, 1.8, { variant: 0, top: 2.35, hi: true, flat: true, tint: 1 });
  addPeb(WEDGE.x + 2.5, WEDGE.z - 1.2, 2.0, { variant: 2, top: 2.2, hi: true, flat: true, tint: 6 });
  const dripPeb = DRIP_X.map((dx, i) => addPeb(dx + [0.2, -0.1, 0.15, -0.2, 0.1][i], 4.7 + [0.2, -0.3, 0.1, 0.3, -0.2][i], [1.7, 2.1, 1.8, 2.0, 1.6][i], { variant: [2, 0, 4, 0, 2][i], flat: true, hi: true }));
  for (let tries = 0; tries < 9000 && peb.length < 1750; tries++) {
    const x = rng.range(-75, 75), z = rng.range(-190, 75);
    let r = 0.33 * Math.exp(rng() * 1.75);
    if (rng() < 0.035) r = rng.range(2.2, 3.6);
    if (z < -60) { if (rng() < 0.55) continue; r *= 1.5; }
    // keep the lines of sight of the low cameras clear
    if (z > 9 && Math.abs(x + 2) < 13) r = Math.min(r, 0.75);
    if (z < -6 && Math.abs(x + 1) < 22) r = Math.min(r, 1.25);
    if (z > 4 && Math.abs(x - WEDGE.x) < 9) r = Math.min(r, 0.7);
    if (z < -3 && Math.abs(x - WEDGE.x) < 14) r = Math.min(r, 1.4);
    if (Math.hypot(x - WEDGE.x, z - WEDGE.z) < 2.2) continue;
    let ok = true;
    for (let i = 0; i < peb.length && ok; i++) { const q = peb[i]; if (Math.hypot(x - q.x, z - q.z) < (q.solo ? 1.08 : 0.82) * (r + q.r)) ok = false; }
    if (!ok) continue;
    const near = Math.hypot(x, z) < 15 || Math.hypot(x - WEDGE.x, z) < 12 || (Math.abs(z - 4.7) < 7 && Math.abs(x) < 17);
    addPeb(x, z, r, { hi: near && r > 0.5 });
  }
  const pebbleMat = new THREE.ShaderMaterial({ name: 'bed-pebble', uniforms: U, vertexShader: PEBBLE_VERT, fragmentShader: PEBBLE_FRAG });
  const pebbles = new THREE.Group();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const pebGeos = [];
  for (let v = 0; v < SHAPES.length; v++) for (const hi of [true, false]) {
    const list = peb.filter((q) => q.variant === v && q.hi === hi);
    if (!list.length) continue;
    const base = hi ? geoHi[v] : geoLo[v];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal);
    const tint = new Float32Array(list.length * 3), rnd = new Float32Array(list.length * 4);
    const mesh = new THREE.InstancedMesh(g, pebbleMat, list.length);
    list.forEach((q, i) => {
      _e.set(q.tiltX, q.rotY, q.tiltZ, 'YXZ'); _q.setFromEuler(_e); _s.setScalar(q.r); _p.set(q.x, q.y, q.z);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      tint.set(q.tint, i * 3); rnd.set(q.rnd, i * 4);
    });
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.layers.enable(SHADOW_LAYER);
    pebbles.add(mesh); pebGeos.push(g);
  }
  scene.add(pebbles);

  // ---- ground ----
  const groundU = { ...U, uGritCol: { value: C('#77726a', 0.8) }, uLoamCol: { value: C('#2E2218', 0.9) }, uSiltK: { value: 0 }, uLoamK: { value: 0 }, uCrack: { value: 0 }, uDry: { value: 0 }, uRipple: { value: 0 } };
  const groundGeo = new THREE.PlaneGeometry(300, 620, 300, 310);
  groundGeo.rotateX(-Math.PI / 2); groundGeo.translate(0, 0, -200);
  const groundMat = new THREE.ShaderMaterial({ name: 'bed-ground', uniforms: groundU, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.frustumCulled = false;
  scene.add(ground);

  // ---- water film ----
  const waterU = { ...U, uFilm: { value: 0 }, uThread: { value: -100 }, uRain: { value: 0 }, uFlow: { value: 0.5 }, uWaveAmp: { value: 0.05 }, uSparkle: { value: 0 }, uOwnY: { value: 0 } };
  const waterGeo = new THREE.PlaneGeometry(260, 420, 1, 1);
  waterGeo.rotateX(-Math.PI / 2); waterGeo.translate(0, 0, -140);
  const waterMat = new THREE.ShaderMaterial({
    name: 'bed-water', uniforms: waterU, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.frustumCulled = false; water.renderOrder = 2;
  scene.add(water);
  // S07's thread: a ribbon that follows the ground along threadZ(x) (same curve as in WATER_FRAG)
  const threadZ = (x) => 7.4 + 1.5 * Math.sin(x * 0.33 + 1.0) + 0.6 * Math.sin(x * 0.81 + 0.3);
  const threadGeo = (() => {
    const N = 240, x0 = -12, x1 = 40, raw = [], pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const x = lerp(x0, x1, i / N), z = threadZ(x);
      let y = -1e9;
      for (const dz of [-2, -1, 0, 1, 2]) y = Math.max(y, groundHJS(x, z + dz));
      raw.push(y + 0.05);
    }
    for (let i = 0; i <= N; i++) {
      let a = 0, n = 0;
      for (let k = -8; k <= 8; k++) { const j = Math.min(N, Math.max(0, i + k)); a += raw[j]; n++; }
      const x = lerp(x0, x1, i / N), z = threadZ(x), y = Math.max(a / n, raw[i]);
      pos.push(x, y, z - 3.2, x, y, z + 3.2);
      if (i < N) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  })();
  const threadU = { ...waterU, uOwnY: { value: 1 } };
  const threadMat = new THREE.ShaderMaterial({
    name: 'bed-thread', uniforms: threadU, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const thread = new THREE.Mesh(threadGeo, threadMat);
  thread.frustumCulled = false; thread.renderOrder = 3;
  scene.add(thread);

  // ---- ice: the lip (S07) and the stranded lump (S09); FX layer, so the silk inside stays visible ----
  const iceBlend = { side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
  const lipB = buildLip();
  const lipU = { ...U, uIceCol: { value: C('#BFE6F2', 1.0) }, uIceDeep: { value: C('#0E3A5C', 0.5) }, uWindow: { value: V3(...LIP_SEED) }, uWindowR: { value: 2.0 }, uIceAlpha: { value: 1 }, uObjScale: { value: 1 }, uIceGlow: { value: C('#6FD3E8', 0.55) }, uTrans: { value: 1 } };
  const lipMat = new THREE.ShaderMaterial({ name: 'bed-lip', uniforms: lipU, vertexShader: ICE_VERT, fragmentShader: ICE_FRAG, ...iceBlend });
  const lip = new THREE.Mesh(lipB.geo, lipMat);
  lip.frustumCulled = false; lip.renderOrder = 1; lip.layers.set(FX_LAYER);
  scene.add(lip);
  const lumpGeo = buildLump();
  const lumpU = { ...U, uIceCol: { value: C('#cfeaf5', 1.0) }, uIceDeep: { value: C('#3d7a9a', 0.5) }, uWindow: { value: V3(0, 0, 0) }, uWindowR: { value: 1.3 }, uIceAlpha: { value: 0.82 }, uObjScale: { value: 4 }, uIceGlow: { value: C('#bfe6f2', 0.9) }, uTrans: { value: 1 } };
  const lumpMat = new THREE.ShaderMaterial({ name: 'bed-lump', uniforms: lumpU, vertexShader: ICE_VERT, fragmentShader: ICE_FRAG, ...iceBlend });
  const lump = new THREE.Mesh(lumpGeo, lumpMat);
  lump.frustumCulled = false; lump.renderOrder = 1; lump.layers.set(FX_LAYER);
  scene.add(lump);
  // an invisible stand-in that casts the lump's shadow
  const lumpShadow = new THREE.Mesh(lumpGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  lumpShadow.layers.set(SHADOW_LAYER); lumpShadow.frustumCulled = false;
  scene.add(lumpShadow);

  // ---- the seed ----
  const seed = makeSeed();
  seed.group.scale.setScalar(1.2);
  seed.parts.husk.layers.enable(SHADOW_LAYER);
  scene.add(seed.group);

  // ---- seedling + grass (S16) ----
  const leafU = { ...U, uLeafCol: { value: C('#7FB84A', 0.4) }, uTransCol: { value: C('#9ed44a', 1.25) }, uVeins: { value: 1 }, uSway: { value: 0 }, uThick: { value: 0.08 } };
  const leafMat = new THREE.ShaderMaterial({ name: 'bed-leaf', uniforms: leafU, vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, side: THREE.DoubleSide });
  const stemU = { ...U, uLeafCol: { value: C('#BFE08A', 0.5) }, uTransCol: { value: C('#d4ee9a', 0.8) }, uVeins: { value: 0 }, uSway: { value: 0 }, uThick: { value: 0.35 } };
  const stemMat = new THREE.ShaderMaterial({ name: 'bed-stem', uniforms: stemU, vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, side: THREE.DoubleSide });
  const sprout = new THREE.Group();
  const stemCurve = new THREE.CatmullRomCurve3([V3(0, -0.4, 0), V3(0.02, 0.3, 0.01), V3(-0.02, 0.66, -0.01), V3(0.02, 1.0, 0)]);
  const stemGeo = new THREE.TubeGeometry(stemCurve, 28, 0.095, 12, false);
  const stem = new THREE.Mesh(stemGeo, stemMat);
  const leafGeo = buildLeaf();
  const crown = new THREE.Group();
  const leafA = new THREE.Mesh(leafGeo, leafMat), leafB = new THREE.Mesh(leafGeo, leafMat);
  const pivA = new THREE.Group(), pivB = new THREE.Group();
  pivA.add(leafA); pivB.add(leafB); pivB.rotation.y = Math.PI;
  crown.add(pivA, pivB);
  const budMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 1.15, 0.38) });
  const bud = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), budMat);
  bud.frustumCulled = false; crown.add(bud);
  sprout.add(stem, crown);
  for (const o of [stem, leafA, leafB]) { o.layers.enable(SHADOW_LAYER); o.frustumCulled = false; }
  scene.add(sprout);
  const bladeGeo = buildBlade();
  const grassU = { ...U, uLeafCol: { value: C('#5C8A2E', 0.5) }, uTransCol: { value: C('#A9C94F', 0.6) }, uVeins: { value: 0.4 }, uSway: { value: 1 }, uThick: { value: 0.1 } };
  const grassMat = new THREE.ShaderMaterial({ name: 'bed-grass', uniforms: grassU, vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, side: THREE.DoubleSide });
  const GRASS = 520;
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, GRASS);
  {
    const gr = rng.fork('grass');
    for (let i = 0; i < GRASS; i++) {
      let x, z;
      for (;;) {
        x = gr.range(-60, 60); z = gr.range(-150, 70);
        const d = Math.hypot(x, z);
        if (d < 5.5) continue;                                  // the seedling stands alone
        if (z > 5 && Math.abs(x) < 7 + (z - 5) * 0.12) continue;   // keep the lens's view of it clear
        if (gr() < Math.exp(-d / 40) * 0.7 + 0.2) break;
      }
      const h = gr.range(1.6, 5.5) * (0.6 + 0.4 * gr());
      _e.set(gr.gauss(0, 0.2), gr.range(0, 6.283), gr.gauss(0, 0.2), 'YXZ'); _q.setFromEuler(_e);
      _s.set(gr.range(0.8, 1.5), h, gr.range(0.8, 1.6)); _p.set(x, groundHJS(x, z, 0, 1) - 0.1, z);
      grass.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
  }
  grass.frustumCulled = false; grass.layers.enable(SHADOW_LAYER);
  scene.add(grass);
  // moss: a fuzz of tiny blades over the crest of the mound, in the focal plane
  const MOSS = 1400;
  const moss = new THREE.InstancedMesh(bladeGeo, grassMat, MOSS);
  {
    const gr = rng.fork('moss');
    for (let i = 0; i < MOSS; i++) {
      const x = gr.gauss(0, 9), z = gr.gauss(0.3, 2.6);
      const h = (Math.hypot(x, z) < 0.5 ? 0.25 : 1) * gr.range(0.25, 0.95) * (0.5 + 0.5 * gr());
      _e.set(gr.gauss(0, 0.35), gr.range(0, 6.283), gr.gauss(0, 0.35), 'YXZ'); _q.setFromEuler(_e);
      _s.set(gr.range(0.35, 0.7), h, gr.range(0.5, 1.2)); _p.set(x, groundHJS(x, z, 0, 1) - 0.04, z);
      moss.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
  }
  moss.frustumCulled = false;
  scene.add(moss);

  // ---- S12 overlay ----
  const splitU = {
    uRes: { value: new THREE.Vector2(1920, 1080) }, uPicFrac: { value: PIC }, uTime: U.uTime, uLine: { value: 0.55 }, uFlash: { value: 0 },
    uFogCol: U.uFogCol, uShaftCol: { value: C('#e8c98a', 1.3) }, uSkyRefl: { value: C('#8a96a3', 0.9) }, uWaterDark: { value: C('#3a3424', 0.35) },
  };
  const splitMat = new THREE.ShaderMaterial({
    name: 'bed-split', uniforms: splitU, vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: SPLIT_FRAG,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const splitGeo = new THREE.BufferGeometry();
  splitGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const split = new THREE.Mesh(splitGeo, splitMat);
  split.frustumCulled = false; split.renderOrder = 3; split.layers.set(FX_LAYER);
  split.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    const w = rt ? rt.width : renderer.domElement.width, h = rt ? rt.height : renderer.domElement.height;
    splitU.uRes.value.set(w, h); splitU.uPicFrac.value = Math.min(1, w / 2.39 / h);
  };
  scene.add(split);

  // ---- particles ----
  const uDof = { value: V3(50, 0, 18) };
  const fx = (p) => { p.mesh.layers.set(FX_LAYER); scene.add(p.mesh); return p; };

  // S07: the drops (hang, fall 0.6 s, burst into a small crown)
  const NSPL = 12, dropAttr = new Float32Array(DROPS.length * (1 + NSPL) * 4), dropKind = new Float32Array(DROPS.length * (1 + NSPL));
  DROPS.forEach(([tl, j], d) => {
    const lipP = lipB.drips[j], landY = dripPeb[j].top - 0.05;
    for (let s = 0; s <= NSPL; s++) { const q = d * (1 + NSPL) + s; dropAttr.set([lipP[0], lipP[1], tl, landY], q * 4); dropKind[q] = s === 0 ? 0 : 1; }
  });
  const drops = fx(createParticles({
    count: DROPS.length * (1 + NSPL), seed: ctx.seed ^ 0xd709, name: 'bed-drops', blending: 'normal', fragment: GRAIN_FRAG.drop, minPixelSize: 1.2, renderOrder: 9,
    attributes: { aDrop: { itemSize: 4, array: dropAttr }, aKind: { itemSize: 1, array: dropKind } },
    uniforms: { uLipZ: { value: lipB.drips[0][2] }, uDropCol: { value: V3(1, 1, 1) }, uSun: { value: 0 } },
    glsl: /* glsl */ `uniform float uLipZ, uSun; uniform vec3 uDropCol;`,
    position: /* glsl */ `
      float tl = aDrop.z;
      float s = (t - (tl - ${FALL.toFixed(2)})) / ${FALL.toFixed(2)};
      color = vec4(0.0);
      if (aKind < 0.5) {
        if (s > -2.6 && s < 1.0) {
          float hang = smoothstep(-2.6, -0.1, s);
          float fall = max(s, 0.0);
          float y = mix(aDrop.y - 0.12 - 0.22 * hang, aDrop.w + 0.12, fall * fall);
          pos = vec3(aDrop.x, y, uLipZ + 0.05);
          size = 0.42 * mix(0.3, 1.0, hang);
          color = vec4(uDropCol, 1.0);
        }
      } else {
        float e = (t - tl) / 0.42;
        if (e > 0.0 && e < 1.0) {
          float ang = seed.x * 6.2832, sp = mix(2.5, 6.5, seed.y);
          vec3 v = vec3(cos(ang) * sp, mix(5.0, 11.0, seed.z), sin(ang) * sp * 0.6);
          float tt = e * 0.42;
          pos = vec3(aDrop.x, aDrop.w + 0.05, uLipZ + 0.05) + v * tt + vec3(0.0, -34.0 * tt * tt, 0.0);
          size = mix(0.06, 0.16, seed.w) * (1.0 - 0.5 * e);
          color = vec4(uDropCol * 1.3, 1.0 - e * e);
        }
      }`,
  }));
  // landing flash: a soft ring of light where each drop hits
  const flashAttr = new Float32Array(DROPS.length * 4);
  DROPS.forEach(([tl, j], d) => flashAttr.set([dripPeb[j].x, dripPeb[j].top, tl, dripPeb[j].z], d * 4));
  const flashes = fx(createParticles({
    count: DROPS.length, seed: 3, name: 'bed-flash', blending: 'additive', renderOrder: 9,
    attributes: { aHit: { itemSize: 4, array: flashAttr } },
    uniforms: { uDropCol: drops.uniforms.uDropCol },
    glsl: /* glsl */ `uniform vec3 uDropCol; varying float vAge;`,
    position: /* glsl */ `
      float e = (t - aHit.z) / 0.35;
      color = vec4(0.0); vAge = e;
      if (e > 0.0 && e < 1.0) { pos = vec3(aHit.x, aHit.y + 0.05, aHit.w); size = 0.5 + 2.2 * e; color = vec4(uDropCol, (1.0 - e) * 0.7); }`,
    fragment: /* glsl */ `
      vec2 q = vec2(uv.x, uv.y * 2.6); float r = length(q);
      float ring = exp(-pow((r - 0.75) / 0.12, 2.0)) + 0.4 * exp(-r * r * 9.0) * (1.0 - vAge);
      col = vec4(vColor.rgb * vColor.a * ring, 0.0);`,
  }));

  // S09: river glints in the far background, bokeh that shrinks to points when focus racks to the mountain
  const glints = fx(createParticles({
    count: 110, seed: ctx.seed ^ 0x9117, name: 'bed-glints', blending: 'additive', fragment: BOKEH_FRAG, renderOrder: 7,
    uniforms: { uDof, uBk: { value: 0.5 }, uGlint: { value: 1 } }, glsl: BOKEH_GLSL + /* glsl */ `uniform float uGlint;`,
    position: /* glsl */ `
      float lane = floor(seed.y * 3.0);
      float sp = mix(9.0, 22.0, seed.z);
      float x = mod(seed.x * 190.0 + t * sp, 190.0) - 60.0;
      pos = vec3(x, 3.0 + lane * 0.9 + 0.8 * sin(seed.w * 30.0), -300.0 - lane * 22.0);
      size = 0.5;
      ${BOKEH_SIZE}
      float tw = pow(0.5 + 0.5 * sin(t * (5.0 + 9.0 * seed.w) + seed.x * 60.0), 3.0);
      float band = smoothstep(-25.0, 15.0, x) * smoothstep(130.0, 70.0, x) * step(0.45, seed.w);
      color = vec4(vec3(1.0, 0.97, 0.9) * 7.0 * tw * dim, uGlint * band);`,
  }));

  // S12: sand tumbling left to right through the flood, settling
  const sand = fx(createParticles({
    count: 2200, seed: ctx.seed ^ 0x5a2d, name: 'bed-sand', blending: 'additive', fragment: BOKEH_FRAG, renderOrder: 8, minPixelSize: 1.3,
    uniforms: { uDof, uBk: { value: 0.3 }, uFlowPhi: { value: 0 }, uSurf: { value: 3.9 }, uBedY: { value: 0.3 }, uCamX: { value: 0 }, uFlash: { value: 0 }, uSandCol: { value: C('#d9b56a', 1.0) } },
    glsl: BOKEH_GLSL + /* glsl */ `uniform float uFlowPhi, uSurf, uBedY, uCamX, uFlash; uniform vec3 uSandCol;`,
    position: /* glsl */ `
      // each grain rides the current, tumbling, and sinks toward the bed over its own span of the shot
      float ts = mix(98.0, 116.0, seed.w);                     // settle time
      float sink = smoothstep(ts - 5.0, ts, t);
      float sp = mix(0.55, 1.45, seed.z) * (1.0 - 0.9 * sink);
      float z = mix(-70.0, 15.5, pow(seed.y, 0.8));
      float x = uCamX + mod(seed.x * 110.0 + uFlowPhi * 30.0 * sp, 110.0) - 55.0;
      float h = fract(seed.x * 7.31 + seed.w * 3.17);
      float hgt = mix(0.15, uSurf - uBedY - 0.1, h * h) * (1.0 - sink);
      float tum = sin(t * (2.0 + 3.0 * seed.z) + seed.x * 40.0) * 0.28 + 0.14 * sin(t * 7.3 + seed.w * 50.0);
      pos = vec3(x, min(uBedY + 0.04 + hgt + tum * (1.0 - sink) * (0.4 + h), uSurf - 0.06), z);
      size = mix(0.035, 0.11, pow(fract(seed.w * 13.0), 2.0));
      ${BOKEH_SIZE}
      float lit = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 5.0 * sp + seed.y * 30.0), 2.0);
      float fog = exp(-length(pos - cameraPosition) * 0.028);
      color = vec4(uSandCol * (0.9 + 2.0 * uFlash) * lit * fog * mix(0.55, 1.5, fract(seed.z * 9.0)) * dim * 7.0, 1.0 - 0.9 * smoothstep(ts, ts + 1.2, t));`,
  }));

  // rain (S12 above the waterline, S13 trial 3): slanted streaks
  const rain = fx(createParticles({
    count: 700, seed: ctx.seed ^ 0x4a12, name: 'bed-rain', blending: 'additive', fragment: GRAIN_FRAG.rain, renderOrder: 8, minPixelSize: 1.0,
    uniforms: { uRainBox: { value: new THREE.Vector4(0, 0, 14, 0) }, uRainAmt: { value: 0 }, uRainCol: { value: V3(1, 1, 1) } },
    glsl: /* glsl */ `uniform vec4 uRainBox; uniform float uRainAmt; uniform vec3 uRainCol;`,
    position: /* glsl */ `
      // uRainBox: centre x, floor y, height, centre z
      float sp = mix(55.0, 85.0, seed.w);
      float ph = fract(seed.y + t * sp / uRainBox.z);
      float y = uRainBox.y + uRainBox.z * (1.0 - ph);
      pos = vec3(uRainBox.x + (seed.x - 0.5) * 70.0 - 0.18 * (uRainBox.z * (1.0 - ph)), y, uRainBox.w + mix(-70.0, 18.0, seed.z));
      size = mix(1.2, 2.4, seed.w);
      float near_ = smoothstep(3.0, 12.0, length(pos - cameraPosition));
      color = vec4(uRainCol, uRainAmt * step(seed.x * 0.999, uRainAmt) * mix(0.25, 0.8, fract(seed.z * 7.0)) * near_);`,
  }));
  // rain splashes on the ground: tiny crowns
  const splash = fx(createParticles({
    count: 420, seed: ctx.seed ^ 0x51a5, name: 'bed-splash', blending: 'additive', fragment: GRAIN_FRAG.point, renderOrder: 8,
    uniforms: { uRainBox: rain.uniforms.uRainBox, uRainAmt: rain.uniforms.uRainAmt, uRainCol: rain.uniforms.uRainCol },
    glsl: /* glsl */ `uniform vec4 uRainBox; uniform float uRainAmt; uniform vec3 uRainCol;`,
    position: /* glsl */ `
      float grp = floor(id / 6.0);
      vec4 h = hash41(grp + 3.0);
      float per = 0.45 + 0.4 * h.z;
      float cyc = floor(t / per + h.w), e = fract(t / per + h.w);
      vec2 c = hash21(grp * 7.0 + cyc * 13.0);
      vec3 o = vec3(uRainBox.x + (c.x - 0.5) * 34.0, uRainBox.y + 0.03, uRainBox.w + mix(-30.0, 14.0, c.y));
      float ang = seed.x * 6.2832, tt = e * per;
      vec3 v = vec3(cos(ang) * 2.2, mix(4.0, 8.5, seed.y), sin(ang) * 2.2);
      pos = o + v * tt + vec3(0.0, -30.0 * tt * tt, 0.0);
      size = 0.07;
      color = vec4(uRainCol * 3.0, uRainAmt * step(pos.y, o.y + 3.0) * step(o.y - 0.02, pos.y) * (1.0 - e));`,
  }));

  // S13 fire: embers streaking left to right
  const embers = fx(createParticles({
    count: 420, seed: ctx.seed ^ 0xe3be, name: 'bed-embers', blending: 'additive', fragment: BOKEH_FRAG, renderOrder: 8, minPixelSize: 1.3,
    uniforms: { uDof, uBk: { value: 0.3 }, uFireAmt: { value: 0 }, uFireX: { value: 0 }, uEmberCol: { value: C(PALETTE.fire, 1) }, uOrg: { value: V3(WEDGE.x, 1.5, 0) } },
    glsl: BOKEH_GLSL + /* glsl */ `uniform float uFireAmt, uFireX; uniform vec3 uEmberCol, uOrg;`,
    position: /* glsl */ `
      float life = mix(0.7, 1.6, seed.w);
      float e = fract(t / life + seed.x), cyc = floor(t / life + seed.x);
      vec3 h = hash31(id * 3.1 + cyc * 17.0);
      vec3 o = uOrg + vec3(uFireX + (h.x - 0.7) * 34.0, 0.2 + 3.0 * h.y * h.y, mix(-45.0, 20.0, h.z));
      vec3 v = vec3(mix(18.0, 40.0, seed.y), mix(2.0, 9.0, seed.z), 0.0);
      pos = o + v * (e * life) + vec3(sin(e * 9.0 + seed.x * 20.0) * 0.8, 3.0 * e * e, cos(e * 7.0 + seed.y * 20.0) * 0.6);
      size = mix(0.05, 0.13, seed.z);
      ${BOKEH_SIZE}
      float fl = 0.6 + 0.4 * sin(t * 30.0 + seed.x * 50.0);
      color = vec4(uEmberCol * 30.0 * fl * dim, uFireAmt * sin(3.14159 * e));`,
  }));
  // S13 ash: grey snow
  const ash = fx(createParticles({
    count: 900, seed: ctx.seed ^ 0xa5a5, name: 'bed-ash', blending: 'normal', fragment: BOKEH_FRAG, renderOrder: 8, minPixelSize: 1.3,
    uniforms: { uDof, uBk: { value: 0.35 }, uAshAmt: { value: 0 }, uAshCol: { value: V3(0.3, 0.3, 0.3) }, uOrg: { value: V3(WEDGE.x, 1.5, 0) } },
    glsl: BOKEH_GLSL + /* glsl */ `uniform float uAshAmt; uniform vec3 uAshCol, uOrg;`,
    position: /* glsl */ `
      float sp = mix(2.6, 5.5, seed.w);
      float H = 16.0;
      float ph = fract(seed.y + t * sp / H);
      vec3 o = uOrg + vec3((seed.x - 0.5) * 60.0, 0.0, mix(-60.0, 22.0, seed.z));
      pos = o + vec3(1.6 * sin(t * (0.8 + seed.w) + seed.x * 30.0) + 2.0 * ph, H * (1.0 - ph) - 0.3, 0.9 * cos(t * 0.7 + seed.z * 30.0));
      size = mix(0.05, 0.16, fract(seed.w * 11.0));
      ${BOKEH_SIZE}
      color = vec4(uAshCol * mix(0.6, 1.5, fract(seed.x * 23.0)), uAshAmt * step(seed.x * 0.999, uAshAmt) * mix(0.9, 0.5, vSoft) * smoothstep(0.0, 0.06, ph) * smoothstep(1.0, 0.97, ph));`,
  }));

  // S16: dew on the moss and motes in the air, back-lit bokeh
  const dew = fx(createParticles({
    count: 420, seed: ctx.seed ^ 0xde3, name: 'bed-dew', blending: 'additive', fragment: BOKEH_FRAG, renderOrder: 7, minPixelSize: 1.2,
    uniforms: { uDof, uBk: { value: 0.7 }, uDewAmt: { value: 0 }, uDewCol: { value: C('#FFE3A3', 1) }, uMoundK: U.uMound },
    glsl: BOKEH_GLSL + /* glsl */ `uniform float uDewAmt, uMoundK; uniform vec3 uDewCol;`,
    position: /* glsl */ `
      bool mote = id < 110.0;
      vec2 xz = vec2((seed.x - 0.5) * 80.0, mix(-190.0, 62.0, pow(seed.z, 1.3)));
      float gy = 0.22 * snoise(xz * 0.11) + 0.07 * snoise(xz * 0.47 + 5.0) + uMoundK * 2.6 * exp(-dot(xz, xz) / 400.0);
      float tw;
      if (mote) {
        pos = vec3(xz.x + 2.0 * sin(t * 0.21 + seed.w * 20.0), gy + 1.0 + 9.0 * seed.y + 0.8 * sin(t * 0.33 + seed.x * 20.0), xz.y);
        size = 0.035; tw = 0.4 + 0.6 * sin(t * (0.6 + seed.w) + seed.y * 30.0);
      } else {
        pos = vec3(xz.x, gy + 0.08 + 0.5 * seed.y * seed.y, xz.y);
        size = 0.05; tw = pow(0.5 + 0.5 * sin(t * (1.2 + 2.5 * seed.w) + seed.x * 60.0), 2.0);
      }
      ${BOKEH_SIZE}
      color = vec4(uDewCol * (mote ? 5.0 : 16.0) * tw * dim, uDewAmt);`,
  }));

  const allFx = [drops, flashes, glints, sand, rain, splash, embers, ash, dew];

  // ground-line wipe (S13's tail, 122-123): this world survives only above the rising soil surface
  const wipe = createWipe('above');
  wipe.mesh.layers.set(FX_LAYER); wipe.mesh.visible = false;
  const wipeGroup = new THREE.Group();          // a Group's renderOrder outranks every other key: drawn last
  wipeGroup.renderOrder = 100; wipeGroup.layers.set(FX_LAYER); wipeGroup.add(wipe.mesh);   // (a Group only counts on a layer the camera sees)
  scene.add(wipeGroup);

  // ---- shadow map ----
  const SHADOW_SIZE = 2048;
  const shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthBuffer: true, depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE, THREE.UnsignedIntType), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const shadowCam = new THREE.OrthographicCamera(-30, 30, 30, -30, 10, 130);
  shadowCam.layers.set(SHADOW_LAYER);
  const depthMat = new THREE.ShaderMaterial({ name: 'bed-depth', vertexShader: DEPTH_VERT, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', side: THREE.DoubleSide });
  U.uShadowMap.value = shadowRT.depthTexture;
  const shadowTarget = new THREE.Vector3();
  function renderShadow(target, half) {
    const r = ctx.renderer;
    shadowCam.left = -half; shadowCam.right = half; shadowCam.top = half; shadowCam.bottom = -half;
    shadowCam.updateProjectionMatrix();
    shadowCam.position.copy(target).addScaledVector(U.uKeyDir.value, 70);
    shadowCam.up.set(0, 1, 0.001);
    shadowCam.lookAt(target);
    shadowCam.updateMatrixWorld();
    U.uShadowMat.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
    const prev = r.getRenderTarget();
    const bg = scene.background;
    scene.overrideMaterial = depthMat;
    r.setRenderTarget(shadowRT);
    r.clear(true, true, false);
    r.render(scene, shadowCam);
    scene.overrideMaterial = null;
    scene.background = bg;
    r.setRenderTarget(prev);
  }

  // ---- rack focus to the master frame (end of S09 -> S10, end of S16 -> S17) -------------------------
  // The sharp end of each rack focus is the real thing: the next shot's world, updated with the state
  // of its own first frame (read from its shot definition through the engine) and rendered through
  // its own camera into `landRT`, which the backplate then shows pixel for pixel; this shot's grade
  // blends to that shot's first-frame grade. The foreground cannot be left to the post chain's depth of
  // field at that point (a fully defocused layer over a sharp one comes out stair-stepped), so once
  // it is uniformly soft it is rendered to its own target with alpha, blurred as one disc, and laid
  // over the plate as a veil.
  const NEXT = { S09: 'S10', S16: 'S17' };
  const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, stencilBuffer: false };
  const landRT = new THREE.WebGLRenderTarget(ctx.width, ctx.height, { ...hdr, depthBuffer: true, samples: 4, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const hw = Math.max(2, ctx.width >> 1), hh = Math.max(2, ctx.height >> 1), qw = Math.max(2, ctx.width >> 2), qh = Math.max(2, ctx.height >> 2);
  const fgRT = new THREE.WebGLRenderTarget(hw, hh, { ...hdr, depthBuffer: true });
  const blurA = new THREE.WebGLRenderTarget(qw, qh, { ...hdr, depthBuffer: false }), blurB = new THREE.WebGLRenderTarget(qw, qh, { ...hdr, depthBuffer: false });
  const fsGeo = new THREE.BufferGeometry();
  fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const FS_VERT = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const discMat = new THREE.ShaderMaterial({
    name: 'bed-veil-blur', depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uR: { value: 8 } },
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uR; varying vec2 vUv;
      void main() {
        vec4 acc = min(texture(tSrc, vUv), vec4(60.0));
        float ang = 0.0;
        for (int i = 1; i <= 96; i++) {
          ang += 2.39996323;
          acc += min(texture(tSrc, vUv + vec2(cos(ang), sin(ang)) * sqrt(float(i) / 96.0) * uR * uTexel), vec4(60.0));
        }
        gl_FragColor = acc / 97.0;
      }`,
  });
  const fsQuad = new THREE.Mesh(fsGeo, discMat);
  fsQuad.frustumCulled = false;
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const veilU = { tSrc: { value: blurB.texture }, uGain: { value: 1 } };
  const veilMat = new THREE.ShaderMaterial({
    name: 'bed-veil', uniforms: veilU, vertexShader: FS_VERT, transparent: true, depthTest: false, depthWrite: false,
    fragmentShader: 'uniform sampler2D tSrc; uniform float uGain; varying vec2 vUv; void main() { vec4 c = texture(tSrc, vUv); gl_FragColor = vec4(c.rgb * uGain, min(c.a, 1.0)); }',
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const veil = new THREE.Mesh(fsGeo, veilMat);
  veil.frustumCulled = false; veil.layers.set(FX_LAYER); veil.visible = false;

  // everything that is not the plate is the foreground
  const fg = new THREE.Group();
  for (const o of [...scene.children]) if (o !== camera && o !== plate.mesh) fg.add(o);
  scene.add(fg);
  const veilGroup = new THREE.Group();
  veilGroup.renderOrder = 90; veilGroup.layers.set(FX_LAYER); veilGroup.add(veil);
  scene.add(veilGroup);

  // the next shot's world (the engine owns it; it is a pure function of its arguments, so borrowing it is safe)
  try { await Promise.all([...new Set(Object.values(NEXT).map((id) => ctx.engine.byId.get(id)?.world).filter(Boolean))].map((w) => ctx.engine.ensureWorld(w))); }
  catch (err) { console.warn('[bed] the next shots\' worlds are unavailable; the painted backplate stays:', err && err.message); }
  const GRADE_KEYS = ['temperature', 'tintGM', 'tint', 'lift', 'gamma', 'gain', 'contrast', 'saturation', 'splitShadows', 'splitHighlights', 'splitAmount', 'bloom', 'bloomScatter', 'halation', 'vignette', 'vignetteSoftness', 'chromaticAberration', 'grain', 'grainSize'];
  const mixv = (a, b, k) => (Array.isArray(b) ? b.map((v, i) => lerp(Array.isArray(a) ? a[i] : a, v, k)) : Array.isArray(a) ? a.map((v) => lerp(v, b, k)) : lerp(a, b, k));
  /** Render the first frame of the shot that follows `id` into landRT; returns its resolved post, or null. */
  function renderNext(shot, t) {
    const eng = ctx.engine, next = eng.byId.get(NEXT[shot.id]);
    const rec = next && eng.worlds.get(next.world);
    if (!rec || !rec.ready) return null;
    const inst = rec.instance, r = ctx.renderer;
    // under shutter accumulation that first frame is itself an average of sub-frames: follow its phase
    let ph = (t * ctx.fps + 1e-6) % 1; if (ph < 1e-5) ph = 0;
    const sh = (x) => { const v = typeof x === 'function' ? x(0, 0) : x; return Number.isFinite(v) && v > 0 ? v : 0.5; };
    ph = Math.min(0.999, ph * sh(next.shutter) / sh(shot.shutter));
    const tt = Math.min(next.start + ph / ctx.fps, next.end - 1e-4), lt = (tt - next.start) / next.duration;
    eng._updateWorld(inst, next, lt, tt);
    const cam = inst.camera, mask = cam.layers.mask, prev = r.getRenderTarget();
    cam.layers.enable(FX_LAYER);
    r.setRenderTarget(landRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    if (inst.render) inst.render(r, landRT, cam); else r.render(inst.scene, cam);
    cam.layers.mask = mask;
    r.setRenderTarget(prev);
    return eng.resolvePost(inst, next, lt, tt);
  }
  /** Render the foreground with alpha, blur it as one disc of `radius` px (at 1080p), show it as the veil. */
  function renderVeil(radius, gain) {
    const r = ctx.renderer, prev = r.getRenderTarget(), mask = camera.layers.mask;
    fg.visible = true; plate.mesh.visible = false; veil.visible = false;
    camera.layers.enable(FX_LAYER);
    r.setRenderTarget(fgRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, camera);
    camera.layers.mask = mask;
    const q = (radius * (ctx.height / 1080)) / 4;            // radius in quarter-resolution texels
    discMat.uniforms.uTexel.value.set(1 / qw, 1 / qh);
    fsQuad.material = discMat;
    discMat.uniforms.tSrc.value = fgRT.texture; discMat.uniforms.uR.value = q * 0.5;
    r.setRenderTarget(blurA); r.render(fsQuad, fsCam);
    discMat.uniforms.tSrc.value = blurA.texture; discMat.uniforms.uR.value = q * 0.87;
    r.setRenderTarget(blurB); r.render(fsQuad, fsCam);
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(prev);
    fg.visible = false; plate.mesh.visible = true; veil.visible = true;
    veilU.uGain.value = gain;
  }
  let rackInfo = null;                            // set by s09 / s16: { rack, f0, fSat, A0, veilEnd, blur0 }

  // ---- per-shot state ----
  let post = {};
  let seedKey = 1;                                // how strongly the key light models the husk (per shot)
  const look = {}, lookB = {};
  const setLight = (L) => {
    U.uKeyDir.value.copy(L.keyDir).normalize(); U.uKeyCol.value.copy(L.key); U.uSkyCol.value.copy(L.sky); U.uBounceCol.value.copy(L.bounce);
    U.uEnvTop.value.copy(L.envTop); U.uEnvHor.value.copy(L.envHor);
  };
  const seedLight = (k = 1, a = 0.5) => {
    const g = U.uKeyCol.value, s = U.uSkyCol.value, d = U.uKeyDir.value;
    seed.set({ lightDir: [d.x, d.y, d.z], lightColor: [g.x * k * 0.4, g.y * k * 0.4, g.z * k * 0.4], ambient: [s.x * a, s.y * a, s.z * a] });
  };
  const tmpL = { keyDir: V3(0, 1, 0), key: V3(0, 0, 0), sky: V3(0, 0, 0), bounce: V3(0, 0, 0), envTop: V3(0, 0, 0), envHor: V3(0, 0, 0) };

  function reset(t) {
    U.uTime.value = t; seedKey = 1; rackInfo = null;
    fg.visible = true; veil.visible = false;
    U.uSunGate.value.set(-1000, 0, 1); U.uShadowOn.value = 1; U.uUnder.value = 0; U.uSmoke.value = 0; U.uFire.value.set(0, 0, 0, 0);
    U.uWet.value = 0; U.uWaterY.value = -100; U.uFrost.value = 0; U.uAsh.value = 0; U.uMoss.value = 0; U.uSiltDust.value = 0;
    for (const w of U.uWetSpot.value) w.set(0, 0, 0, 0);
    U.uGroundY.value = 0; U.uMound.value = 0;
    groundU.uSiltK.value = 0; groundU.uLoamK.value = 0; groundU.uCrack.value = 0; groundU.uDry.value = 0; groundU.uRipple.value = 0;
    waterU.uFilm.value = 0; waterU.uThread.value = -100; waterU.uRain.value = 0; waterU.uFlow.value = 0.5; waterU.uWaveAmp.value = 0.05; waterU.uSparkle.value = 0;
    water.visible = false; thread.visible = false; lip.visible = false; lump.visible = false; lumpShadow.visible = false; sprout.visible = false; grass.visible = false; moss.visible = false; split.visible = false;
    pebbles.visible = true; plate.mesh.visible = true; wipe.mesh.visible = false;
    for (const p of allFx) { p.mesh.visible = false; p.setTime(t); }
    seed.group.visible = true;
    seed.parts.silk.layers.set(FX_LAYER); seed.parts.halo.layers.set(FX_LAYER);
    seed.set({ glow: 0.8, silkSpread: 1, silkWet: 0, silkFlow: [0, 0, 0], split: 0, ice: 0, pulseFloor: 0.1, halo: 1, silkOpacity: 1 });
    plate.set({ anchor: [0.52, MASTER_HORIZON_Y], scale: 1, blur: 1, flash: 0, dim: 1, walls: 0, landMix: 0, landGain: 1, time: t, depth: PLATE_DEPTH });
  }

  // ------------------------------------------------------------------------------------------- S07
  function s07(t) {
    setLight({ keyDir: V3(0.28, 0.3, 1.0), key: C('#FFCFA0', 5.0), sky: C('#6E8FB8', 0.95), bounce: C('#2c3644', 0.3), envTop: C('#6FB3D8', 1.2), envHor: C('#F2B98A', 1.3) });
    // dawn walks down the ice: the line of sunlight descends (lower on the right) and reaches the
    // gravel on the right by 64.0, where the thread of water runs out of frame and catches it
    const line = lerp(9.3, 2.0, Math.pow(sstep(58, 65, t), 1.2));
    U.uSunGate.value.set(line, 0.45, 0.8);
    plate.mesh.visible = false;
    lip.visible = true;
    // drops -> wet spots; the spots join into a film; a thread runs out of frame right
    const amt = DRIP_X.map(() => 0);
    for (const [tl, j] of DROPS) amt[j] += sstep(tl, tl + 0.45, t);
    const film = sstep(62.2, 65, t);
    DRIP_X.forEach((dx, j) => U.uWetSpot.value[j].set(dripPeb[j].x, dripPeb[j].z, 1.1 * Math.sqrt(amt[j]) + 2.6 * film, Math.min(1, amt[j] * 2)));
    U.uWaterY.value = lerp(-0.4, 0.36, sstep(61.5, 64.2, t));
    water.visible = t > 61.5;
    thread.visible = t > 62.4;
    waterU.uThread.value = lerp(-10, 44, sstep(62.5, 64.0, t));   // the head of the thread; out of frame right by 64.0
    waterU.uFlow.value = 3.0; waterU.uWaveAmp.value = 0.09; waterU.uSparkle.value = 1;
    drops.mesh.visible = flashes.mesh.visible = true;
    const sun = sstep(line + 1.5, line - 1.5, 5.6);
    drops.uniforms.uDropCol.value.set(0.5 + 3.0 * sun, 0.7 + 2.5 * sun, 1.0 + 1.8 * sun);
    // the seed, frozen in the lip
    seed.group.position.set(...LIP_SEED);
    seed.group.rotation.set(0.25, 0.5, 0.55);
    seed.set({ glow: 0.4, ice: 0.3, silkSpread: 1, silkOpacity: 0.8, halo: 0.9 });      // inside lit ice: an amber glint in a dark fleck
    U.uSeedPos.value.set(...LIP_SEED); U.uGlow.value = 0.4 * (0.1 + 0.9 * seedPulse(t));
    lipU.uWindow.value.set(LIP_SEED[0], LIP_SEED[1], LIP_SEED[2] + 1.2);
    aim(camera, [0.4, 14.5, 121.5], 85, [0.3, 4.6, 4.7], 0.5, 0.5);
    post = { dof: { focus: 117.2, aperture: 5.5, maxBlur: 30 }, exposure: lerp(0.45, 0.15, sstep(58, 64, t)), contrast: 1.1, saturation: 1.0, temperature: -0.06, bloom: 0.07, vignette: 0.45, grain: 0.03 };
    shadowTarget.set(1, 1, 6);
    return 34;
  }

  // ------------------------------------------------------------------------------------------- S09
  function s09(t) {
    setLight({ keyDir: V3(-0.62, 0.5, 0.2), key: C('#FFF0DA', 4.2), sky: C('#8fb4dc', 0.7), bounce: C('#6b665e', 0.3), envTop: C('#4f86c0', 1.2), envHor: C('#d5e3ee', 1.5) });
    const rack = sstep(81.0, 81.9, t);
    plate.set({ year: 300, look: PLATE_LOOKS.morning, blur: 0.8, dim: 0.62, walls: 1 });
    rackInfo = { rack, f0: 59.7, fSat: 310, A0: 5, veilEnd: 96, blur0: 0.8 };
    // the lump melts 74 -> 78.75 and sets the seed down at 79.0
    const b = 1 - sstep(73.0, 78.75, t);
    const restY = hero.top + 0.15;
    let h = 0.22 + 1.5 * Math.pow(b, 0.8);
    if (t >= 78.75) { const k = clamp01((t - 78.75) / 0.25); h = 0.22 * (1 - k * k); }
    const e = Math.max(0, t - 79);
    const bounce = t >= 79 ? 0.03 * Math.exp(-e * 14) * Math.abs(Math.sin(e * 30)) : 0;
    seed.group.position.set(0.15, restY + h + bounce, 0.35);
    seed.group.rotation.set(0, 0.12 * b, -0.07 + 0.3 * b + (t >= 79 ? 0.1 * Math.exp(-e * 8) * Math.cos(e * 36) : 0));
    const sx = 3.6 * Math.pow(b, 0.45), sy = 3.3 * Math.pow(b, 0.8);
    lump.visible = lumpShadow.visible = b > 0.004;
    lump.scale.set(sx, sy, sx * 0.9); lump.position.set(0.3, hero.top - 0.8 + sy * 0.42, 0.2);
    lump.rotation.set(0, 0.7, 0);
    lumpShadow.scale.copy(lump.scale); lumpShadow.position.copy(lump.position); lumpShadow.rotation.copy(lump.rotation);
    lumpU.uIceAlpha.value = lerp(0.35, 0.62, b);
    lumpU.uWindow.value.copy(seed.group.position); lumpU.uWindow.value.z += 2;
    U.uWetSpot.value[0].set(0.2, 0.2, 1.5 + 8 * Math.sqrt(1 - b * 0.85), 1);
    U.uWet.value = 0.2;
    glints.mesh.visible = rack < 0.4; glints.uniforms.uGlint.value = 1 - sstep(0, 0.38, rack);
    const glow = 0.8 * 0.3;                         // script 0.8, scaled for full daylight: a dark husk with an ember
    seedKey = 0.4;
    seed.set({ glow, ice: sstep(0.35, 0.9, b), silkSpread: lerp(0.38, 1, sstep(0.15, 0.7, b)), silkWet: 0.92 * (1 - sstep(0.1, 0.55, b)), halo: 1 });
    U.uSeedPos.value.copy(seed.group.position); U.uGlow.value = glow * (0.1 + 0.9 * seedPulse(t)) * (1 - 0.7 * b);
    const cx = lerp(-2.4, -0.95, sstep(74, 82, t) * 0.5 + 0.5 * clamp01((t - 74) / 8));
    camera.fov = lensToFov(100, camera.aspect); camera.updateProjectionMatrix();
    camera.position.set(cx, 1.9, 60);
    camera.rotation.set(1.49 * DEG, 0, 0, 'YXZ');
    camera.updateMatrixWorld();
    post = { dof: { focus: 59.7, aperture: 5, maxBlur: 46 }, exposure: -0.25, contrast: 1.1, saturation: 0.98, temperature: -0.03, bloom: 0.06, vignette: 0.38, grain: 0.03 };
    shadowTarget.set(0, 1, 0);
    return 22;
  }

  // ------------------------------------------------------------------------------------------- S12
  const flow12 = (t) => lerp(1, 0.4, clamp01((t - 102) / 8));
  const flowPhi = (t) => { const u = Math.min(Math.max(t - 102, 0), 8); return Math.min(t - 102, 0) + u - 0.0375 * u * u + Math.max(0, t - 110) * 0.4; };
  const bolt = (t, t0, k) => (t >= t0 ? Math.exp(-(t - t0) * k) : 0);
  function s12(t) {
    const W = WEDGE.y + 2.35;
    const fl = bolt(t, 104, 9) + 0.7 * bolt(t, 104.17, 12) + 0.35 * bolt(t, 104.42, 7);
    setLight({ keyDir: V3(-0.3, 0.9, 0.3), key: C('#e2c080', 1.5 * (1 + 3 * fl)), sky: C('#7a6540', 0.32), bounce: C('#3a2e1a', 0.2), envTop: C('#6B5633', 0.5), envHor: C('#6B5633', 0.4) });
    plate.set({ year: 3500, look: PLATE_LOOKS.storm, blur: 0.5, anchor: [0.33, 0.625], scale: 0.5, flash: fl });
    U.uUnder.value = 1; U.uFogDen.value = 0.027; U.uFogCol.value.copy(C('#6B5633', 0.42 * (1 + 1.5 * fl)));
    const sd = sstep(101.5, 110.5, t);
    U.uGroundY.value = lerp(0.25, 1.2, sd);
    groundU.uSiltK.value = 1; groundU.uRipple.value = 1; U.uSiltDust.value = 0.1 + 0.2 * sd; U.uWet.value = 0.8;
    split.visible = true; splitU.uFlash.value = fl; splitU.uLine.value = 0.55;
    sand.mesh.visible = true;
    sand.uniforms.uFlowPhi.value = flowPhi(t); sand.uniforms.uSurf.value = W; sand.uniforms.uBedY.value = U.uGroundY.value; sand.uniforms.uCamX.value = WEDGE.x; sand.uniforms.uFlash.value = fl;
    rain.mesh.visible = true;
    rain.uniforms.uRainBox.value.set(WEDGE.x, W, 16, 0); rain.uniforms.uRainAmt.value = 1; rain.uniforms.uRainCol.value.set(0.3 + 2 * fl, 0.33 + 2 * fl, 0.38 + 2 * fl);
    const f = flow12(t);
    seed.group.position.set(WEDGE.x, WEDGE.y, WEDGE.z);
    seed.group.rotation.set(0.1, 0.25, S13_END.seedTilt + 0.03 * Math.sin(t * 2.3) * f);
    const glow = 0.8 * 0.8;                         // script 0.8; the murk is dim, so nearly all of it shows
    seed.set({ glow, silkSpread: 0.75, silkWet: 0.15, silkFlow: [0.95 * (0.55 + 0.45 * f), 0.1, 0.12], halo: 1.3 });
    U.uSeedPos.value.copy(seed.group.position); U.uGlow.value = glow * (0.1 + 0.9 * seedPulse(t));
    camera.fov = lensToFov(28, camera.aspect); camera.updateProjectionMatrix();
    camera.position.set(WEDGE.x - 1.3, W, WEDGE.z + 16.5);
    const vf = 2 * Math.atan(Math.tan(camera.fov * DEG / 2) * PIC);
    camera.rotation.set(-0.05 * vf, 0, 0, 'YXZ');
    camera.updateMatrixWorld();
    post = { dof: { focus: 16.4, aperture: 2.0, maxBlur: 22 }, exposure: 0.1 + 0.5 * fl, contrast: 1.12, saturation: 0.85, bloom: 0.08, vignette: 0.48, grain: 0.04 };
    shadowTarget.set(WEDGE.x, 1, 0);
    return 22;
  }

  // ------------------------------------------------------------------------------------------- S13
  const S13_SEED = [WEDGE.x, WEDGE.y, WEDGE.z];
  function s13(t) {
    const tt = Math.min(t, 122);
    // the fade into each trial begins 0.32 s before its start and ends 0.32 s after
    const ci = Math.min(5, Math.floor((tt - 110 + 0.32) / 2));
    const prev = TRIALS[Math.max(0, ci - 1)], cur = TRIALS[ci];
    const bt = 110 + 2 * ci;
    const kk = ci === 0 ? 1 : sstep(bt - 0.32, bt + 0.32, tt);
    for (const key of ['key', 'sky', 'bounce', 'envTop', 'envHor', 'keyDir']) tmpL[key].copy(prev[key]).lerp(cur[key], kk);
    setLight(tmpL);
    const mixn = (name) => lerp(prev[name], cur[name], kk);
    U.uShadowOn.value = mixn('shadow');
    mixLook(PLATE_LOOKS[prev.look], PLATE_LOOKS[cur.look], kk, look);

    // envelopes
    const drain = sstep(110.0, 111.7, tt);
    const frost = 0.82 * sstep(112.0, 113.9, tt) * (1 - sstep(114.0, 114.7, tt));
    const rainK = sstep(113.9, 114.4, tt) * (1 - sstep(115.7, 116.2, tt));
    const dry = sstep(116.0, 116.9, tt);
    const crack = sstep(116.25, 117.9, tt);
    const fireEnv = sstep(117.9, 118.5, tt) * (1 - sstep(119.5, 120.3, tt));
    const fireX = lerp(-48, 40, sstep(118.0, 120.0, tt));
    const flick = 0.75 + 0.25 * Math.sin(tt * 31) * Math.sin(tt * 17.3 + 1) + 0.12 * Math.sin(tt * 53);
    const char = sstep(118.6, 119.8, tt);
    const ashK = sstep(119.7, 121.9, tt);
    const duskFade = sstep(120.4, 122.0, tt);

    const siltY = lerp(1.20, 1.27, sstep(110, 118, tt)) + 0.15 * ashK;
    U.uGroundY.value = siltY;
    groundU.uSiltK.value = 1; groundU.uRipple.value = 1 - 0.7 * sstep(114, 116, tt);
    U.uSiltDust.value = 0.55;
    U.uWet.value = Math.max(lerp(1, 0.75, drain) * (1 - sstep(112.2, 113.2, tt)), rainK, 0.45 * frost) * (1 - dry);
    groundU.uDry.value = dry * (1 - 0.6 * char);
    groundU.uCrack.value = crack;
    U.uFrost.value = frost;
    U.uAsh.value = Math.max(0.5 * char, ashK);
    // standing water: the flood draining (110-111.7), then puddles in the rain
    const wy = tt < 113 ? lerp(siltY + 1.0, siltY - 0.4, drain) : siltY - 0.4 + 0.45 * rainK;
    U.uWaterY.value = wy;
    water.visible = tt < 112 || rainK > 0.01;
    waterU.uFilm.value = tt < 113 ? 1 : rainK;
    waterU.uRain.value = rainK; waterU.uFlow.value = tt < 113 ? 1.6 : 0.15; waterU.uWaveAmp.value = tt < 113 ? 0.05 : 0.025;
    rain.mesh.visible = splash.mesh.visible = rainK > 0.01;
    rain.uniforms.uRainBox.value.set(WEDGE.x, siltY, 14, 0); rain.uniforms.uRainAmt.value = rainK; rain.uniforms.uRainCol.value.set(0.4, 0.44, 0.5);
    U.uFire.value.set(WEDGE.x + fireX, 7.5, -22, fireEnv * flick);
    U.uSmoke.value = 0.75 * fireEnv;
    embers.mesh.visible = fireEnv > 0.01; embers.uniforms.uFireAmt.value = fireEnv; embers.uniforms.uFireX.value = fireX;
    ash.mesh.visible = ashK > 0.001; ash.uniforms.uAshAmt.value = sstep(119.7, 120.6, tt);
    ash.uniforms.uAshCol.value.setScalar(lerp(0.16, 0.07, duskFade));
    look.glowPos = [0.52 + fireX / 90, 0.2, 0.55];
    plate.set({ year: storyYear(tt), look, blur: S13_END.plateBlur, anchor: [S13_END.plateX, S13_END.horizon], scale: S13_END.plateScale, dim: 0.6 * (1 - 0.3 * duskFade) });
    // dusk: the light fails
    U.uKeyCol.value.multiplyScalar(1 - 0.5 * duskFade); U.uSkyCol.value.multiplyScalar(1 - 0.25 * duskFade);

    const glow = mixn('glow') * mixn('day');       // the script's seedGlow, scaled down in daylight
    seed.group.position.set(...S13_SEED);
    seed.group.rotation.set(0.1, 0.25, S13_END.seedTilt);
    seed.set({ glow, ice: Math.min(1, frost * 1.15), silkSpread: lerp(0.45, S13_END.silkSpread, sstep(118, 121, tt)), silkWet: lerp(0.85, 1, ashK), silkOpacity: 1 - 0.1 * ashK, halo: 1 });
    U.uSeedPos.value.copy(seed.group.position); U.uGlow.value = glow * (0.1 + 0.9 * seedPulse(tt));
    aim(camera, S13_CAM.pos, S13_CAM.lens, S13_SEED, S13_CAM.seedPic[0], S13_CAM.seedPic[1]);
    // the wipe: the camera sinks toward the ground while the soil surface rises through frame
    const wiping = t >= WIPE.t0;
    if (wiping) {
      const u = clamp01((t - WIPE.t0) / (WIPE.t1 - WIPE.t0));
      camera.position.y -= 1.7 * u * u;
      camera.updateMatrixWorld();
      wipe.set(t);
    }
    post = {
      dof: { focus: S13_END.focus, aperture: 1.9, maxBlur: 30 }, exposure: mixn('exposure') - 0.6 * sstep(121.0, 122.0, tt), contrast: lerp(1.12 + 0.06 * dry, 1.0, sstep(120.6, 122.0, tt)), saturation: mixn('sat'),
      bloom: 0.06 + 0.05 * fireEnv, halation: 0.12 + 0.2 * fireEnv, vignette: 0.45, grain: 0.04,
      gain: wiping ? WIPE.gain : [1, 1, 1],
    };
    seedLight(1, 0.5);
    if (fireEnv > 0.01) seed.set({ lightColor: [U.uKeyCol.value.x * 0.4 + 2.2 * fireEnv * flick, U.uKeyCol.value.y * 0.4 + 0.75 * fireEnv * flick, U.uKeyCol.value.z * 0.4 + 0.2 * fireEnv * flick], lightDir: [fireX / 40, 0.5, -0.6] });
    shadowTarget.set(WEDGE.x, 1.4, 0);
    return 20;
  }

  // ------------------------------------------------------------------------------------------- S16
  const MOUND_TOP = groundHJS(0, 0, 0, 1);
  function s16(t) {
    setLight({ keyDir: V3(0.03, 0.24, -0.97), key: C('#FFB870', 6.0), sky: C('#8f8aa0', 0.4), bounce: C('#3a3016', 0.25), envTop: C('#6a5560', 0.6), envHor: C('#ffb070', 1.6) });
    const rack = sstep(159.5, 161.5, t);
    plate.set({ year: 9900, look: PLATE_LOOKS.dawn, blur: 0.85, dim: 0.8, walls: 1 });
    rackInfo = { rack, f0: 76.7, fSat: 290, A0: 5.5, veilEnd: 110, blur0: 0.85 };
    U.uMound.value = 1; groundU.uLoamK.value = 1; U.uMoss.value = 1; U.uWet.value = 0.3;
    grass.visible = true; moss.visible = true; sprout.visible = true; seed.group.visible = false;
    dew.mesh.visible = true; dew.uniforms.uDewAmt.value = 1;
    const sp = sstep(154, 156.3, t);
    const hgt = lerp(2.3, 3.5, sp);
    const sway = 0.03 * Math.sin(t * 1.3) + 0.012 * Math.sin(t * 3.4);
    sprout.position.set(0, MOUND_TOP, 0);
    sprout.rotation.set(0, 0.45, sway);
    stem.scale.set(1, hgt, 1);
    crown.position.set(0.02, hgt, 0);
    crown.rotation.set(0.3, 0, 0);
    const open = sstep(154.1, 156.4, t), ang = lerp(1.42, 0.62, open) + 0.03 * Math.sin(t * 1.7);
    pivA.rotation.z = ang; pivB.rotation.z = ang + 0.05 * Math.sin(t * 1.1 + 1) + 0.06;
    leafA.rotation.x = 0.5 * open; leafB.rotation.x = 0.4 * open;
    const ls = lerp(0.72, 1, open);
    leafA.scale.setScalar(ls); leafB.scale.setScalar(ls * 0.95);
    U.uGlow.value = 0;
    camera.fov = lensToFov(100, camera.aspect); camera.updateProjectionMatrix();
    const rise = sstep(153.5, 161.2, t) * 0.5 + 0.5 * clamp01((t - 154) / 7.2);
    camera.position.set(0, MOUND_TOP + 0.29 - 2.0 * (1 - rise), 76.7);
    camera.rotation.set(1.49 * DEG, 0, 0, 'YXZ');
    camera.updateMatrixWorld();
    // the burst of light the shoot broke into carries across the cut from S15 and settles
    const burst = Math.exp(-Math.max(0, t - 154) / 0.28);
    post = { dof: { focus: 76.7, aperture: 5.5, maxBlur: 46 }, exposure: -0.1 + 1.25 * burst, contrast: 1.1, saturation: 1.15, temperature: 0.1, bloom: 0.09 + 0.22 * burst, bloomScatter: 0.68 + 0.08 * burst, halation: 0.2, vignette: 0.4 - 0.2 * burst, grain: 0.03 };
    shadowTarget.set(0, MOUND_TOP, 0);
    return 22;
  }

  const SHOTS = { S07: s07, S09: s09, S12: s12, S13: s13, S16: s16 };

  return {
    scene, camera,
    post: () => post,
    update(t, localT, shot) {
      reset(t);
      const half = (SHOTS[shot.id] || s09)(t);
      if (shot.id !== 'S13') seedLight(seedKey, 0.5);
      // ---- rack focus: first the foreground goes soft, then the master frame comes sharp ----
      let veilR = 0, veilGain = 1;
      const R = rackInfo;
      if (R && R.rack > 0) {
        const RP = 0.4, k1 = sstep(0, RP, R.rack), k2 = clamp01((R.rack - RP) / (1 - RP)), s2 = k2 * k2 * (3 - 2 * k2);
        const mine = post, theirs = renderNext(shot, t);
        const c = 1 - s2;                                   // what is left of the plate's blur
        const dof = R.rack < RP ? { focus: lerp(R.f0, R.fSat, k1), aperture: R.A0, maxBlur: 46 }
          : { focus: PLATE_DEPTH * (1 - c), aperture: c > 0.003 ? 1 : 0, maxBlur: 46 };
        post = { ...mine, dof };
        if (theirs) {
          const g = sstep(0, 1, R.rack);
          for (const key of GRADE_KEYS) if (theirs[key] !== undefined) post[key] = mixv(mine[key] ?? theirs[key], theirs[key], g);
          post.exposure = lerp(mine.exposure, theirs.exposure, s2);
          plate.set({ land: landRT.texture, landMix: k1, landGain: Math.pow(2, theirs.exposure - post.exposure) });
        } else plate.set({ blur: R.blur0 * c });
        if (R.rack >= RP) { veilR = lerp(46, R.veilEnd, s2); veilGain = Math.pow(2, mine.exposure - post.exposure); }
      }
      const fxDof = veilR > 0 ? { focus: 10, aperture: 0, maxBlur: 46 } : post.dof;   // inside the veil, grains stay points
      uDof.value.set(fxDof.focus, fxDof.aperture, fxDof.maxBlur);
      seed.set({ dof: veilR > 0 ? null : post.dof });
      seed.update(t);
      renderShadow(shadowTarget, half);
      if (veilR > 0) renderVeil(veilR, veilGain);
    },
    dispose() {
      plate.dispose(); pebbleMat.dispose(); groundGeo.dispose(); groundMat.dispose(); waterGeo.dispose(); waterMat.dispose(); threadGeo.dispose(); threadMat.dispose();
      for (const g of [...geoHi, ...geoLo, ...pebGeos, lipB.geo, lumpGeo, stemGeo, leafGeo, bladeGeo, splitGeo]) g.dispose();
      for (const m of [lipMat, lumpMat, leafMat, stemMat, grassMat, splitMat, depthMat]) m.dispose();
      for (const p of allFx) p.dispose();
      shadowRT.dispose(); seed.dispose(); landRT.dispose(); fgRT.dispose(); blurA.dispose(); blurB.dispose(); fsGeo.dispose(); discMat.dispose(); veilMat.dispose();
    },
  };
}
