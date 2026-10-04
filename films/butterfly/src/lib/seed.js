// GRAIN reference; still imported by worlds/bed.js (createSeed), so it stays until bed.js no longer needs it.
//
// THE SEED — the film's protagonist, shared by every world that shows it in close-up.
//
//   import { createSeed } from '../lib/seed.js';
//   const seed = createSeed();              // opts below, all optional
//   scene.add(seed.group);                  // scale / rotate / place the group as you like
//   seed.set({ glow: 0.8, silkSpread: 1, ice: 1 });
//   // in world.update(t, …):
//   seed.update(t);                         // applies the pulse (story.seedPulse) and the clock
//
// INTERFACE (stable)
//   createSeed(opts = {}) -> { group, set(params), update(t), dispose(), parts: { husk, kernel, silk, halo } }
//
//   group   THREE.Group with the seed at its origin. 1 unit = one seed length (about 1.2 cm).
//           The long axis is +X: pointed tip at x = -0.5, blunt end (where the silk is rooted) at
//           x = +0.5. The dorsal crest (a miniature of the ridge profile P0) is on +Y, so seen from
//           +Z or -Z (side view, Y up) the seed's back rhymes with the mountain skyline.
//           The amber core sits at about x = +0.1.
//
//   set(params)  any subset of:
//     glow        0..1   brightness of the amber core. Multiplied internally by story.seedPulse(t)
//                        (with a small floor so that the ember never quite goes out between beats).
//     silkSpread  0..1   0 = silk closed into a brush along +X, 1 = frozen-open starburst
//     silkWet     0..1   slumped, clumped into strands, drooping (world -Y), with a wet sheen
//     silkFlow    [x,y,z] WORLD-space direction the silk streams toward; vector length = strength
//                        (0 = none, 1 = strong current, tips fully aligned)
//     split       0..1   husk splitting for germination: a seam of light opens from the tip, then
//                        the two halves part (seam in the local XZ plane, halves move along ±Y) and
//                        show the pale, glowing kernel inside
//     ice         0..1   frost crystals and a clear ice glaze on husk and silk
//   optional extras (not needed for a good default look):
//     lightDir    [x,y,z] WORLD-space direction TO the key light        (default up-left-front)
//     lightColor  [r,g,b] linear HDR key light colour                    (default [1.6,1.55,1.45])
//     ambient     [r,g,b] linear ambient / rim colour                    (default [0.2,0.25,0.32])
//     pulseFloor  0..1   fraction of `glow` that remains between pulses  (default 0.1)
//     halo        0..n   strength of the soft amber halo sprite around the core (default 1)
//     haloOffset  number where the halo sprite sits along the view axis, in seed lengths: negative =
//                        behind the seed (default -0.32: a glow around the silhouette, depth-tested
//                        against the scene), positive = in front (e.g. 0.55: a veil over the husk too)
//     silkOpacity 0..1   overall opacity of the silk                     (default 1)
//     dof         null | { focus, aperture, maxBlur }  — pass the SAME object you give the engine
//                        as post.dof and the silk / halo defocus themselves to match (they live on
//                        FX_LAYER, which the post chain draws sharp after depth of field).
//
//   update(t)   film time in seconds. Sets the pulse and animates silk in a flow. Pure in t.
//
//   opts: { silkCount = 48, silkSegments = 22, fx = true (put silk + halo on FX_LAYER), seed = 7 }
//
// The husk writes depth and takes the post chain's depth of field; the silk and the halo do not
// write depth (they are hair-fine / additive), which is why they are FX_LAYER objects.
// HDR: at glow = 1 on a pulse peak the core emits about 5 (linear), so it blooms.

import * as THREE from 'three';
import { NOISE } from './glsl/noise.js';
import { createRng } from './random.js';
import { seedPulse, p0, PALETTE } from './valley-story.js';
import { FX_LAYER } from '../post.js';

const RIBS = 22;        // longitudinal ridges around the husk
const Z_FLAT = 0.84;    // the seed is slightly flattened (z radius / y radius)
const CORE_X = 0.1;     // centre of the amber core on the long axis

/** Teardrop radius at u (0 = pointed tip, 1 = blunt silk end). Maximum 0.158 at u = 0.69. */
function profile(u) {
  u = Math.min(1, Math.max(0, u));
  return 0.158 * (Math.pow(u, 1.1) * Math.pow(1 - u, 0.5)) / 0.3695;
}
/** Dorsal crest height at u: the ridge profile P0 in miniature (summit near u = 0.57). */
function crest(u) {
  return 0.05 * p0((u - 0.555) * 2.7);
}

function buildHusk(segU = 160, segT = 112, inset = 0) {
  const pos = new Float32Array((segU + 1) * (segT + 1) * 3);
  const uv = new Float32Array((segU + 1) * (segT + 1) * 2);
  let k = 0, q = 0;
  for (let i = 0; i <= segU; i++) {
    // denser rings toward both ends
    const a = i / segU;
    const u = 0.5 - 0.5 * Math.cos(Math.PI * a);
    const ends = Math.min(1, u / 0.14) * Math.min(1, (1 - u) / 0.1);
    for (let j = 0; j <= segT; j++) {
      const th = (j / segT) * Math.PI * 2; // 0 at +Y
      const c = Math.cos(th), s = Math.sin(th);
      let r = profile(u) * (1 - inset);
      r += 0.0026 * Math.cos(th * RIBS) * ends * (1 - inset * 4);
      const dorsal = Math.pow(Math.max(c, 0), 2.6) * crest(u) * (1 - inset * 2);
      pos[k++] = u - 0.5;
      pos[k++] = (r + dorsal) * c;
      pos[k++] = r * s * Z_FLAT;
      uv[q++] = u;
      uv[q++] = j / segT;
    }
  }
  const idx = [];
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segT; j++) {
      const a = i * (segT + 1) + j, b = a + segT + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // weld the normals across the theta seam (first and last column are the same points)
  const n = geo.attributes.normal;
  for (let i = 0; i <= segU; i++) {
    const a = i * (segT + 1), b = a + segT;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return geo;
}

const HUSK_VERT = /* glsl */ `
uniform float uSplit;
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vWorld;
varying float vOpen;
void main() {
  vec3 p = position;
  float u = p.x + 0.5;
  // germination: the two halves (±Y) part from the tip toward a hinge near the blunt end
  float open = smoothstep(0.25, 1.0, uSplit);
  float lever = pow(clamp((0.86 - u) / 0.86, 0.0, 1.0), 1.5);
  float side = p.y >= 0.0 ? 1.0 : -1.0;
  p.y += side * open * lever * 0.2;
  p.x += open * lever * 0.03;
  vOpen = open * lever;
  vObj = position;
  vObjN = normal;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const HUSK_FRAG = NOISE + /* glsl */ `
uniform mat4 modelMatrix;
uniform vec3 uHusk, uHuskLight, uAmber, uLightDir, uLightColor, uAmbient, uInner;
uniform float uGlowNow, uSplit, uIce, uWet, uKernel;
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vWorld;
varying float vOpen;
const float RIBS = ${RIBS.toFixed(1)};
void main() {
  float u = vObj.x + 0.5;
  // the triangles that span the seam are torn open when the halves part
  if (uKernel < 0.5 && vOpen > 0.002 && abs(vObj.y) < 0.0075) discard;
  float theta = atan(vObj.z / ${Z_FLAT.toFixed(2)}, vObj.y);
  float ends = smoothstep(0.0, 0.16, u) * smoothstep(1.0, 0.88, u);
  vec3 Ng = normalize(vObjN);
  vec3 V = normalize(cameraPosition - vWorld);
  mat3 M = mat3(modelMatrix);
  vec3 NgW = normalize(M * Ng);
  bool back = dot(NgW, V) < 0.0;

  // ---- relief: longitudinal ribs + fine grain -------------------------------------------------
  float ribPhase = theta * RIBS + 0.55 * snoise(vec2(theta * 2.0, u * 2.6)) * ends;
  float rib = cos(ribPhase);                               // +1 on a crest, -1 in a groove
  float crestK = pow(clamp(rib * 0.5 + 0.5, 0.0, 1.0), 0.7);
  vec3 Tt = normalize(cross(vec3(1.0, 0.0, 0.0), Ng) + vec3(0.0, 1e-4, 0.0));
  float streak = snoise(vec2(theta * 9.0, u * 3.0)) * 0.6 + snoise(vec2(theta * 31.0, u * 7.0)) * 0.4;
  float pit = snoise(vObj * vec3(46.0, 70.0, 70.0));
  vec3 No = normalize(Ng + Tt * (sin(ribPhase) * 0.55 + 0.22 * sin(ribPhase * 2.0)) * ends
                         + 0.10 * vec3(snoise(vObj * 55.0), snoise(vObj * 55.0 + 9.1), snoise(vObj * 55.0 + 17.3)) * (0.4 + 0.6 * ends));
  vec3 N = normalize(M * No);
  if (back) { N = -N; NgW = -NgW; }

  // ---- albedo ---------------------------------------------------------------------------------
  vec3 albedo = mix(uHusk * 0.55, uHuskLight, clamp(crestK * 0.55 + 0.2 * streak, 0.0, 1.0));
  albedo *= 0.82 + 0.18 * pit;
  albedo = mix(albedo, uHusk * 0.5, smoothstep(0.86, 1.0, u) * 0.6);     // darker collar under the silk
  albedo = mix(albedo, uHuskLight * 1.25, smoothstep(0.12, 0.0, u) * 0.5); // paler beak
  if (back || uKernel > 0.5) albedo = uInner;

  // ---- frost and glaze ------------------------------------------------------------------------
  float frostN = snoise(vObj * vec3(22.0, 34.0, 34.0)) * 0.55 + snoise(vObj * 90.0) * 0.45;
  // a dusting of rime: scattered crystals, a little more on the crests and toward the silhouette
  float frost = smoothstep(0.66, 0.92, frostN * 0.5 + 0.5 + crestK * 0.1) * uIce * 0.75;
  frost *= (uKernel > 0.5 ? 0.0 : 1.0);
  float coat = max(uIce * 0.55, uWet);

  // ---- light ----------------------------------------------------------------------------------
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  float ndl = dot(N, L);
  float diff = max(ndl * 0.75 + 0.25, 0.0);                // wrapped
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - max(dot(NgW, V), 0.0), 3.0);
  float specRough = pow(max(dot(N, H), 0.0), 26.0) * (0.25 + 0.5 * crestK);
  float specCoat = pow(max(dot(NgW, H), 0.0), 70.0) * coat * 0.35 + pow(max(dot(NgW, H), 0.0), 18.0) * coat * 0.06;
  vec3 frostCol = vec3(0.72, 0.86, 0.95);
  vec3 base = mix(albedo, frostCol * 0.4, frost * 0.6);
  vec3 col = base * (uLightColor * diff + uAmbient * (0.55 + 0.45 * N.y));
  col += uLightColor * min(specRough * 0.08 + specCoat * 0.4 + frost * pow(max(dot(N, H), 0.0), 60.0) * 0.14, 0.09);
  col += uAmbient * fres * (0.22 + 0.55 * coat + 0.5 * frost);
  // frost sparkle: a few crystals facing the light
  float sp = hash13(floor(vObj * 420.0));
  col += uLightColor * frost * step(0.975, sp) * pow(max(dot(normalize(N + (hash33(floor(vObj * 420.0)) - 0.5) * 0.9), H), 0.0), 40.0) * 2.0;

  // ---- the amber core, seen through the husk --------------------------------------------------
  float along = exp(-pow((vObj.x - ${CORE_X.toFixed(2)}) / 0.19, 2.0));
  float facing = pow(max(dot(NgW, V), 0.0), 1.2);
  float groove = 1.0 - crestK;
  float veins = 0.72 + 0.28 * snoise(vObj * vec3(5.0, 16.0, 16.0) + 3.0);
  float T = along * (0.07 + 0.93 * pow(groove, 1.4)) * (0.2 + 0.8 * facing) * veins;
  T *= 1.0 - 0.5 * frost;
  if (back) T = along * 0.7;
  vec3 hot = mix(uAmber, vec3(1.0, 0.86, 0.6), 0.55);
  vec3 emis = uAmber * T * 3.6 + hot * pow(max(T, 0.0), 2.4) * 3.2;
  if (uKernel > 0.5) emis = uAmber * (0.6 + 2.0 * along) * (0.5 + 0.5 * ndv) + hot * along * 0.5;
  col += emis * uGlowNow;

  // ---- the seam of light that opens before the husk parts --------------------------------------
  float seam = 1.0 - smoothstep(0.0, 0.012 + 0.03 * vOpen, abs(vObj.y));
  float run = smoothstep(u - 0.08, u + 0.02, uSplit * 1.9 * 0.86);   // travels from the tip to the hinge
  float seamGlow = seam * run * step(u, 0.86) * smoothstep(0.0, 0.08, uSplit) * (uKernel > 0.5 ? 0.0 : 1.0);
  col += hot * seamGlow * (1.2 + 4.0 * uGlowNow);

  gl_FragColor = vec4(col, 1.0);
}`;

const SILK_VERT = /* glsl */ `
attribute float aS;        // 0 root .. 1 tip
attribute float aSide;     // -1 | +1 across the ribbon
attribute vec3 aDir;       // starburst direction (local, unit)
attribute vec4 aRand;
uniform float uSpread, uWet, uIce, uTime, uWidth, uOpacity;
uniform vec3 uFlow;
uniform vec2 uRes;
uniform vec3 uDof;         // focus, aperture, maxBlur (aperture 0 = off)
varying float vSide;
varying float vS;
varying float vAlpha;
varying vec4 vRand;
varying vec3 vTan;
varying vec3 vWorld;

vec3 dirAt(float s, vec3 d0, vec3 curl, vec3 flow, float flowLen, vec3 clump) {
  vec3 d = d0 + curl * s * s;
  // wet: gather into strands and droop
  d = mix(d, clump, uWet * (0.55 + 0.35 * s));
  d += vec3(0.0, -1.0, 0.0) * uWet * (0.25 + 1.5 * s);
  // current: the tips align with the flow first
  float k = flowLen * smoothstep(0.0, 1.0, s * (0.6 + 1.6 * flowLen) + 0.15 * flowLen);
  vec3 wav = vec3(0.0);
  if (flowLen > 0.0) {
    float ph = uTime * (2.2 + aRand.x) - s * 5.0 + aRand.y * 6.283;
    wav = 0.16 * flowLen * s * vec3(sin(ph), cos(ph * 0.83 + 1.3), sin(ph * 1.21 + 0.7));
  }
  d = mix(d, flow + wav, clamp(k, 0.0, 0.96));
  return normalize(d);
}

void main() {
  mat3 M = mat3(modelMatrix);
  float scale = length(M[0]);
  // root: a small ring on the blunt end
  vec3 rootL = vec3(0.468, aDir.y * 0.035, aDir.z * 0.03);
  vec3 root = (modelMatrix * vec4(rootL, 1.0)).xyz;
  vec3 open = aDir;
  vec3 closed = normalize(vec3(1.0, aDir.y * 0.16 + (aRand.x - 0.5) * 0.05, aDir.z * 0.16 + (aRand.y - 0.5) * 0.05));
  float sp = clamp(uSpread + (aRand.z - 0.5) * 0.12 * uSpread * (1.0 - uSpread) * 4.0, 0.0, 1.0);
  vec3 d0 = normalize(M * normalize(mix(closed, open, sp)));
  vec3 curl = M * (normalize(cross(aDir, vec3(aRand.x - 0.5, aRand.y - 0.5, aRand.z - 0.5) + 0.01)) * (0.3 + 0.45 * aRand.w)) / scale;
  float clumpId = floor(aRand.w * 5.0);
  vec3 clump = normalize(M * normalize(vec3(1.0, 0.5 * sin(clumpId * 2.4), 0.5 * cos(clumpId * 2.4))));
  float flowLen = length(uFlow);
  vec3 flow = flowLen > 1e-4 ? uFlow / flowLen : vec3(0.0);
  flowLen = min(flowLen, 1.0);
  float len = (0.9 + 0.6 * aRand.x) * scale * (1.0 - 0.18 * uWet);

  // integrate the direction field along the filament (pure function of the uniforms)
  vec3 p = root;
  vec3 tan_ = d0;
  const int STEPS = 10;
  float ds = aS / float(STEPS);
  for (int i = 0; i < STEPS; i++) {
    tan_ = dirAt(ds * (float(i) + 0.5), d0, curl, flow, flowLen, clump);
    p += tan_ * ds * len;
  }
  tan_ = dirAt(aS, d0, curl, flow, flowLen, clump);

  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec4 clip2 = projectionMatrix * (viewMatrix * vec4(p + tan_ * 0.02 * scale, 1.0));
  vec2 a = clip.xy / max(clip.w, 1e-4), b = clip2.xy / max(clip2.w, 1e-4);
  vec2 dir2 = (b - a) * uRes;
  dir2 = length(dir2) > 1e-5 ? normalize(dir2) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir2.y, dir2.x);

  float pxPerUnit = projectionMatrix[1][1] * 0.5 * uRes.y / max(-mv.z, 1e-4);
  float taper = mix(1.0, 0.45, aS);
  float wpx = uWidth * scale * pxPerUnit * taper * (1.0 + 0.8 * uWet + 0.5 * uIce);
  float z = max(-mv.z, 1e-4);
  float blur = uDof.y > 0.0 ? abs(clamp(uDof.y * (z - uDof.x) / z, -1.0, 1.0)) * uDof.z * (uRes.y / 1080.0) : 0.0;
  float minPx = 1.25 * (uRes.y / 1080.0);
  float cover = 1.0;
  if (wpx < minPx) { cover = wpx / minPx; wpx = minPx; }
  float wide = wpx + 2.0 * blur;
  cover *= wpx / wide;
  clip.xy += nrm * aSide * wide * 0.5 / uRes * 2.0 * clip.w;
  gl_Position = clip;
  vSide = aSide;
  vS = aS;
  vRand = aRand;
  vTan = tan_;
  vWorld = p;
  vAlpha = cover * uOpacity * smoothstep(0.0, 0.03, aS) * (1.0 - smoothstep(0.8, 1.0, aS));
}`;

const SILK_FRAG = NOISE + /* glsl */ `
uniform vec3 uSilk, uAmber, uLightDir, uLightColor, uAmbient, uCoreWorld;
uniform float uGlowNow, uIce, uWet, uScale;
varying float vSide;
varying float vS;
varying float vAlpha;
varying vec4 vRand;
varying vec3 vTan;
varying vec3 vWorld;
void main() {
  float edge = 1.0 - abs(vSide);
  float a = smoothstep(0.0, 0.7, edge) * vAlpha;
  vec3 T = normalize(vTan);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  // Kajiya-Kay hair shading: light slides along the filament
  float tl = dot(T, L), th = dot(T, H);
  float diff = sqrt(max(1.0 - tl * tl, 0.0));
  float spec = pow(sqrt(max(1.0 - th * th, 0.0)), 70.0);
  vec3 col = uSilk * (uLightColor * (0.2 * diff + 0.8 * spec) + uAmbient * 0.5);
  // frost beads strung along the hair
  float bead = pow(max(snoise(vec2(vS * 46.0 + vRand.x * 40.0, vRand.y * 17.0)), 0.0), 5.0);
  col += (uLightColor * 1.2 + uAmbient * 2.0) * bead * uIce * 1.5;
  a *= mix(1.0, 0.75 + 1.2 * bead, uIce);
  // wet: darker, glassy
  col *= mix(1.0, 0.55 + 1.2 * spec, uWet);
  // the core lights the roots of the silk
  float d = length(vWorld - uCoreWorld) / max(uScale, 1e-4);
  col += uAmber * uGlowNow * 1.6 / (1.0 + d * d * 9.0);
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}`;

const HALO_VERT = /* glsl */ `
uniform float uRadius, uHaloZ;
uniform vec3 uDof;
uniform vec2 uRes;
varying vec2 vUv;
varying float vSoft;
void main() {
  float scale = length(mat3(modelMatrix)[0]);
  vec4 mv = modelViewMatrix * vec4(${CORE_X.toFixed(2)}, 0.0, 0.0, 1.0);
  float z = max(-mv.z, 1e-4);
  float pxPerUnit = projectionMatrix[1][1] * 0.5 * uRes.y / z;
  float blur = uDof.y > 0.0 ? abs(clamp(uDof.y * (z - uDof.x) / z, -1.0, 1.0)) * uDof.z * (uRes.y / 1080.0) : 0.0;
  float r = uRadius * scale + blur / pxPerUnit;
  vSoft = (uRadius * scale) / r;
  mv.xy += position.xy * r;
  mv.z += uHaloZ * scale;          // default: just behind the seed and depth-tested, so it is a glow in
                                   // whatever surrounds the seed (ice, water, soil), not a veil over the husk
  vUv = position.xy;
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FRAG = /* glsl */ `
uniform vec3 uAmber;
uniform float uGlowNow, uHalo;
varying vec2 vUv;
varying float vSoft;
void main() {
  float r2 = dot(vUv, vUv);
  float g = exp(-r2 * 26.0) * 0.5 + exp(-r2 * 8.0) * 0.14 + exp(-r2 * 3.0) * 0.03;
  g *= smoothstep(1.0, 0.2, sqrt(r2));
  vec3 col = uAmber * g * uGlowNow * uHalo * 1.7 * vSoft * vSoft;
  gl_FragColor = vec4(col, 0.0);
}`;

export function createSeed(opts = {}) {
  const { silkCount = 48, silkSegments = 22, fx = true, seed = 7 } = opts;
  const rng = createRng(typeof seed === 'number' ? seed * 7919 + 13 : seed);
  const group = new THREE.Group();
  group.name = 'seed';

  const col = (hex) => new THREE.Color(hex);
  const shared = {
    uGlowNow: { value: 0 },
    uSplit: { value: 0 },
    uIce: { value: 0 },
    uWet: { value: 0 },
    uAmber: { value: col(PALETTE.amber) },
    uLightDir: { value: new THREE.Vector3(-0.35, 0.8, 0.5).normalize() },
    uLightColor: { value: new THREE.Vector3(1.6, 1.55, 1.45) },
    uAmbient: { value: new THREE.Vector3(0.2, 0.25, 0.32) },
  };

  // ---- husk + kernel ----------------------------------------------------------------------------
  const huskUniforms = {
    ...shared,
    uHusk: { value: col(PALETTE.husk) },
    uHuskLight: { value: col('#4b3222') },
    uInner: { value: col('#a87a45') },
    uKernel: { value: 0 },
  };
  const huskGeo = buildHusk();
  const huskMat = new THREE.ShaderMaterial({
    name: 'seed-husk', uniforms: huskUniforms, vertexShader: HUSK_VERT, fragmentShader: HUSK_FRAG, side: THREE.DoubleSide,
  });
  const husk = new THREE.Mesh(huskGeo, huskMat);
  husk.name = 'seed-husk';
  husk.frustumCulled = false;
  group.add(husk);

  const kernelGeo = buildHusk(64, 48, 0.14);
  const kernelMat = new THREE.ShaderMaterial({
    name: 'seed-kernel',
    uniforms: { ...huskUniforms, uKernel: { value: 1 }, uSplit: { value: 0 } },
    vertexShader: HUSK_VERT, fragmentShader: HUSK_FRAG,
  });
  const kernel = new THREE.Mesh(kernelGeo, kernelMat);
  kernel.name = 'seed-kernel';
  kernel.scale.set(0.9, 0.8, 0.8);
  kernel.frustumCulled = false;
  kernel.visible = false;
  group.add(kernel);

  // ---- silk: `silkCount` hair-fine ribbons ---------------------------------------------------
  const vertsPer = (silkSegments + 1) * 2;
  const nV = silkCount * vertsPer;
  const aS = new Float32Array(nV), aSide = new Float32Array(nV), aDir = new Float32Array(nV * 3), aRand = new Float32Array(nV * 4);
  const silkIdx = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let f = 0; f < silkCount; f++) {
    // directions spread evenly over a wide cap around +X (12° .. 104° from the axis)
    const c = THREE.MathUtils.lerp(0.978, -0.24, (f + 0.5) / silkCount);
    const sn = Math.sqrt(1 - c * c), psi = f * GOLDEN + rng.range(-0.12, 0.12);
    const d = [c, sn * Math.cos(psi), sn * Math.sin(psi)];
    const r = [rng(), rng(), rng(), rng()];
    for (let i = 0; i <= silkSegments; i++) {
      for (let s = 0; s < 2; s++) {
        const v = f * vertsPer + i * 2 + s;
        aS[v] = Math.pow(i / silkSegments, 1.25);
        aSide[v] = s ? 1 : -1;
        aDir.set(d, v * 3);
        aRand.set(r, v * 4);
      }
      if (i < silkSegments) {
        const a = f * vertsPer + i * 2;
        silkIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const silkGeo = new THREE.BufferGeometry();
  silkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nV * 3), 3));
  silkGeo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  silkGeo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  silkGeo.setAttribute('aDir', new THREE.BufferAttribute(aDir, 3));
  silkGeo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 4));
  silkGeo.setIndex(silkIdx);
  silkGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
  const res = new THREE.Vector2(1920, 1080);
  const dof = new THREE.Vector3(10, 0, 18);
  const silkUniforms = {
    ...shared,
    uSilk: { value: col(PALETTE.silk) },
    uSpread: { value: 1 },
    uFlow: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uWidth: { value: 0.0028 },
    uOpacity: { value: 1 },
    uRes: { value: res },
    uDof: { value: dof },
    uCoreWorld: { value: new THREE.Vector3() },
    uScale: { value: 1 },
  };
  const silkMat = new THREE.ShaderMaterial({
    name: 'seed-silk', uniforms: silkUniforms, vertexShader: SILK_VERT, fragmentShader: SILK_FRAG,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const silk = new THREE.Mesh(silkGeo, silkMat);
  silk.name = 'seed-silk';
  silk.frustumCulled = false;
  silk.renderOrder = 5;
  group.add(silk);

  // ---- halo: the glow the core throws into whatever surrounds the seed -------------------------
  const haloUniforms = { ...shared, uHalo: { value: 1 }, uRadius: { value: 1.7 }, uHaloZ: { value: -0.32 }, uRes: { value: res }, uDof: { value: dof } };
  const haloMat = new THREE.ShaderMaterial({
    name: 'seed-halo', uniforms: haloUniforms, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), haloMat);
  halo.name = 'seed-halo';
  halo.frustumCulled = false;
  halo.renderOrder = 6;
  group.add(halo);

  if (fx) { silk.layers.set(FX_LAYER); halo.layers.set(FX_LAYER); }
  const onRes = (renderer) => {
    const rt = renderer.getRenderTarget();
    if (rt) res.set(rt.width, rt.height); else renderer.getDrawingBufferSize(res);
  };
  silk.onBeforeRender = onRes;
  halo.onBeforeRender = onRes;

  // ---- state ------------------------------------------------------------------------------------
  const state = { glow: 0, silkSpread: 1, silkWet: 0, silkFlow: [0, 0, 0], split: 0, ice: 0, pulseFloor: 0.1, halo: 1, haloOffset: -0.32, silkOpacity: 1 };
  const v3 = (target, a) => { if (a) target.set(a[0], a[1], a[2]); };

  function set(params = {}) {
    for (const k in params) if (params[k] !== undefined) state[k] = params[k];
    silkUniforms.uSpread.value = state.silkSpread;
    shared.uWet.value = state.silkWet;
    v3(silkUniforms.uFlow.value, state.silkFlow);
    shared.uSplit.value = state.split;
    kernelMat.uniforms.uSplit.value = 0;
    kernel.visible = state.split > 0.2;
    shared.uIce.value = state.ice;
    haloUniforms.uHalo.value = state.halo;
    haloUniforms.uHaloZ.value = state.haloOffset;
    silkUniforms.uOpacity.value = state.silkOpacity;
    silk.visible = state.silkOpacity > 0.001;
    if (params.lightDir) shared.uLightDir.value.set(...params.lightDir).normalize();
    if (params.lightColor) v3(shared.uLightColor.value, params.lightColor);
    if (params.ambient) v3(shared.uAmbient.value, params.ambient);
    if ('dof' in params) {
      const d = params.dof;
      if (d && (d.aperture ?? 1) > 0) dof.set(d.focus ?? 10, d.aperture ?? 1, d.maxBlur ?? 18);
      else dof.set(10, 0, 18);
    }
    return api;
  }

  function update(t) {
    const pulse = state.pulseFloor + (1 - state.pulseFloor) * seedPulse(t);
    shared.uGlowNow.value = Math.max(0, state.glow) * pulse;
    silkUniforms.uTime.value = t;
    halo.visible = shared.uGlowNow.value * state.halo > 1e-4;
    group.updateWorldMatrix(true, false);
    silkUniforms.uCoreWorld.value.set(CORE_X, 0, 0).applyMatrix4(group.matrixWorld);
    silkUniforms.uScale.value = group.matrixWorld.getMaxScaleOnAxis();
    return api;
  }

  function dispose() {
    huskGeo.dispose(); kernelGeo.dispose(); silkGeo.dispose(); halo.geometry.dispose();
    huskMat.dispose(); kernelMat.dispose(); silkMat.dispose(); haloMat.dispose();
  }

  const api = { group, set, update, dispose, state, parts: { husk, kernel, silk, halo } };
  set({});
  update(0);
  return api;
}
