// W4 GRASS — the meadow at a butterfly's eye level (S04b, S05, S06, S07, S12, S13, S21, S22). Owner: Group B.
//
// 1 unit = 1 cm. Macro, back-lit, very shallow depth of field. Time here runs at 0.4x (SLOW): wind,
// drops and wingbeats are slowed; BREATH and the blade's spring are in film time (story.js).
// Every frame is a pure function of film time t: update(t, ...) calls stage[shot.id](t, p), which
// sets the camera, the lights, every prop and the post block from t alone.
//
// Stages (groups shown one at a time):
//   emerge  S04b  the S02 frame in colour: lamp = sun at LAMP_SUN, desk edge = stem at DESK_EDGE_Y,
//                 hump = the pupa with story.sleeperOutline, ink against the sun as the sleeper was against the lamp
//                 (exposed for the sun until the wings fill); a seam of light at 44.0; the butterfly comes out of
//                 the head end and straight down over the stem, hangs, fills with light, opens
//   flight  S05   a corridor through the blades (towers) at 18 cm/s, a clear way for the lens (blades that come
//                 near thin away), dew lamps, fluff; out over the tops at 60.0, into a pale sky
//   flower  S06   the layered wildflower (buildButtercup: five flared petals and five shorter cupped petals); the
//                 butterfly stands on its petals (feet solved to the petal surface) and drinks at a petal's nectary
//                 (its proboscis reaches a target); an orbit that takes the wing through its lobe: cyan, blue, violet, black
//   blade   S07, S21, S22   the hero blade (story.HERO_BLADE: one curve, one spring) with the butterfly on it;
//                 S07 the dew drop at its tip holds S01 (portal); at 80.0 the frame eases back to a medium frame on the
//                 blade's upper half (drawn broader and turned to the lens, against a darker meadow): the butterfly leaves
//                 at 80.5, the blade whips up and trembles (story.bladeSpring), the drop is flung, falls, and strikes
//                 the leaf on the last two frames (contact f2458, crown f2459);
//                 S21/S22 the locked scroll frame, the slowing wing-breaths, the walker's shadow (lib/figure.js's
//                 walk cycle, cast; ink on paper inside it), ink black at 214.0
//   roost   S12, S13  seven shut butterflies under a dock leaf (story.SEVEN, story.sway), ink cloud, slow rain;
//                 the notch at 122.0; the corkscrew into the hanging drop that holds S14 (portal, exact hand-off)
//
// Background: S05, S06, S07 and S21/S22 stand in FIELD itself (worlds/field.js createFieldBackplate: its meadow,
// valley, sun and city behind our grass; at dusk its own light discs, plate.discs, which go out from the right; if
// the plate cannot be created the procedural meadow and discs below are used). S04b (the sun must sit exactly on
// the lamp) and S12/S13 (the ink cloud) use the procedural sky/meadow below, which is also what the drops refract
// and what lights the leaves. Out-of-focus grass at dusk writes no depth (FIELD's recipe A), so nothing cuts a disc.
//
// Deviations from SCRIPT.md, on purpose: (1) S04b's lock eases into a slow sink and step back from 46.0 (the
// script's "2 mm float" grown to ~1.7 cm) so that the hanging wings fit the S02 frame's scale; (2) S06 orbits at
// 21-25 cm, not 14, so that a whole wing is in frame; (3) the hero blade is 22 cm (story.HERO_BLADE.length);
// (4) S13's seven hang as in S12 but ours turns side-on to the lens (the notch is on its right hindwing);
// (5) the walker is seen as what a lens 30 cm above the ground would see: a pair of huge out-of-focus legs passing
// behind the blade, their shadow failing the light on what is near (WALK_FN), rather than an INK pool; (6) the seven of S12/S13 hang a few
// millimetres lower than the leaf's rail, so that no foot comes up through the leaf.

import * as THREE from 'three';
import { NOISE } from '../lib/glsl/noise.js';
import { FX_LAYER } from '../post.js';
import { lensToFov } from '../lib/camera.js';
import { createRng } from '../lib/random.js';
import { createButterfly, FEET_Y, FEET_REST } from '../lib/butterfly.js';
import { createDrop } from '../lib/drop.js';
import {
  breath, sway, sleeperOutline, bladePoint, bladeSpring, bladeBow, HERO_BLADE, LAMP_SUN, DESK_EDGE_Y,
  SEVEN, S07_SPRING, SHOT, SYNC, PALETTE, LOOK, linear, SLEEPER_OUTLINE, DESK_FRAME,
} from '../lib/story.js';

const DEG = Math.PI / 180;
const SLOW = 0.4;                                   // the butterfly's world: a 2.5x slow motion
const V3 = THREE.Vector3;
const sat = (x) => Math.min(1, Math.max(0, x));
const sm = (a, b, x) => { const k = sat((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const mix = (a, b, k) => a + (b - a) * k;
const lin3 = (hex, m = 1) => new V3(...linear(hex)).multiplyScalar(m);
const g3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

// ======================================================================================================
// Environment: one light state shared by everything; a procedural sky + far meadow in any direction
const ENV_UNIFORMS = () => ({
  uSunDir: { value: new V3(0, 0.2, -1).normalize() }, uSunCol: { value: new V3(4, 3.4, 2.4) },
  uAmbTop: { value: new V3(0.4, 0.5, 0.7) }, uAmbBot: { value: new V3(0.1, 0.16, 0.04) },
  uSkyLow: { value: new V3(1, 0.7, 0.4) }, uSkyHigh: { value: new V3(0.3, 0.5, 0.8) },
  uGroundA: { value: new V3(0.03, 0.07, 0.01) }, uGroundB: { value: new V3(0.2, 0.4, 0.06) }, uHaze: { value: new V3(0.8, 0.7, 0.5) },
  uEnvP: { value: new THREE.Vector4(0, 0, 0.012, 0) },     // ink cloud 0..1 · slow time · sun radius (rad) · wet 0..1
  uEnvQ: { value: new THREE.Vector4(40, 0.5, 30, 1) },     // sun disc radiance x · flowers in the far meadow · eye height (cm) · aureole
  uFog: { value: new THREE.Vector3(0.003, 30, 0.55) },     // haze per cm between the lens and a leaf · where it starts (cm) · sky: sine of the height where the zenith colour is reached
  uCanopy: { value: new THREE.Vector2(16, 24) },           // height (cm) around which the grass passes from shade to sun · softness
});
const ENV_GLSL = NOISE + /* glsl */ `
uniform vec3 uSunDir, uSunCol, uAmbTop, uAmbBot, uSkyLow, uSkyHigh, uGroundA, uGroundB, uHaze;
uniform vec4 uEnvP, uEnvQ; uniform vec3 uFog; uniform vec2 uCanopy;
vec3 envSky(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(uSkyLow, uSkyHigh, pow(smoothstep(0.0, uFog.z, y), 0.65));
  float sd = max(dot(d, uSunDir), 0.0);
  return c + uSunCol * uEnvQ.w * (0.1 * pow(sd, 5.0) + 0.28 * pow(sd, 40.0) + 0.5 * pow(sd, 400.0) + 1.2 * pow(sd, 3000.0));
}
vec3 envGround(vec3 d) {
  float tt = uEnvQ.z / max(-d.y, 2e-3);                     // cm along the ray to the meadow floor
  vec2 p = d.xz * tt;
  float n = fbm(p * 0.006, 3) * 0.5 + 0.5;
  vec3 c = mix(uGroundA, uGroundB, smoothstep(0.2, 0.8, n));
  // drifts of flowers as soft colour (they arrive as discs through the bokeh particles)
  float fl = smoothstep(0.55, 0.9, fbm(p * 0.011 + 7.0, 3) * 0.5 + 0.5) * uEnvQ.y;
  c = mix(c, c + vec3(0.55, 0.42, 0.06), fl * 0.6);
  float sd = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  c += uSunCol * 0.03 * pow(sd, 6.0) * uGroundB;            // toward the sun the grass tops are lit through
  float sdh = max(dot(d, uSunDir), 0.0);
  return mix(c, uHaze * (0.85 + 1.5 * pow(sdh, 6.0)), 1.0 - exp(-tt * 0.0009));
}
vec3 envColor(vec3 d) { return mix(envGround(d), envSky(d), smoothstep(-0.02, 0.012, d.y)); }
`;
const BG_VERT = /* glsl */ `varying vec3 vD; void main() { vD = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`;
const INKCLOUD = lin3(PALETTE.inkCloud);
const BG_FRAG = ENV_GLSL + /* glsl */ `
varying vec3 vD;
uniform vec4 uCloud;      // right (x, z) of the frame in world, forward (x, z): the cloud unfurls from frame right
uniform float uCloudW;    // tan of half the horizontal field of view
uniform float uHill;      // 0..1 the low hills on the horizon
void main() {
  vec3 d = normalize(vD);
  vec3 col = envColor(d);
  // low hills on the horizon, in haze
  float az = atan(d.x, -d.z);
  float hill = 0.002 + 0.005 * (fbm(vec2(az * 2.6, 3.0), 3) * 0.5 + 0.5) + 0.003 * (fbm(vec2(az * 9.0, 9.0), 2) * 0.5 + 0.5);
  col = mix(col, mix(uGroundA * 1.5 + uHaze * 0.55, uHaze, 0.5), smoothstep(hill + 0.004, hill - 0.004, d.y) * smoothstep(-0.012, 0.0, d.y) * 0.7 * uHill);
  // the sun
  float sa = length(cross(d, uSunDir)), r = uEnvP.z;
  col += uSunCol * uEnvQ.x * smoothstep(r * 1.2, r * 0.85, sa) * step(0.0, dot(d, uSunDir));
  // ink let into water: a black wash unfurling from the right of frame
  if (uEnvP.x > 0.001 && d.y > -0.02) {
    vec2 fw = normalize(uCloud.zw), rt = normalize(uCloud.xy);
    float along = dot(d.xz, fw);
    vec2 q = vec2(dot(d.xz, rt), d.y) / max(along, 0.05) / uCloudW;      // frame-relative: x -1..1 across the frame
    float tm = uEnvP.y;
    vec2 w = q * vec2(1.25, 2.3);
    vec2 wr = vec2(fbm(w * 1.1 + vec2(tm * 0.35, tm * 0.2), 3), fbm(w * 1.1 + vec2(5.2, -tm * 0.3), 3));
    float n = fbm(w * 0.9 + wr * 0.75 + vec2(-tm * 0.5, 0.0), 4);
    float reach = q.x * 0.5 + 0.5;                                       // 0 = frame left, 1 = frame right
    float dens = smoothstep(0.0, 0.7, uEnvP.x * 2.3 - (1.0 - reach) * 1.25 + 0.55 * n + 0.3 * q.y);
    float rimw = dens * (1.0 - dens) * 4.0;
    vec3 ink = ${g3(INKCLOUD)} * (1.4 + 0.9 * n) * (uAmbTop.g * 0.9 + 0.25);
    col = mix(col, ink, dens * 0.9);
    col *= 1.0 - 0.28 * rimw * (0.5 + 0.5 * wr.x);                     // pigment gathers at the wet edge
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ======================================================================================================
// Leaves: grass blades (instanced ribbons), and meshes that share their shading (hero blade, stem, dock leaf, petals)
const LEAF_COMMON = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec2 vAux;   // vAux: tint 0..1, occlusion`;
const BLADE_FN = /* glsl */ `
uniform vec4 uWind;   // strength · slow time · direction (rad) · near fade (cm): blades this close to the lens thin away to nothing
// centre line of a blade: constant curvature in its bending plane. s 0..1 root -> tip
void bladeCurve(vec3 root, vec4 blade, vec4 rnd, float s, out vec3 p, out vec3 tn, out vec3 nr, out vec3 bn, out float hw) {
  float H = blade.x, az = blade.w;
  vec2 dir = vec2(cos(az), sin(az));
  float gust = sin(uWind.y * 1.3 + root.x * 0.045 - root.z * 0.03 + rnd.x * 6.28) * 0.6 + sin(uWind.y * 2.9 + root.x * 0.11 + rnd.x * 17.0) * 0.4;
  float wk = uWind.x * (0.35 + 0.65 * gust) / (0.6 + rnd.w) * cos(uWind.z - az);
  float k = blade.z + wk;
  k = abs(k) < 1e-3 ? 1e-3 : k;
  float a = k * s;
  float hx = H * (1.0 - cos(a)) / k, vy = H * sin(a) / k;
  p = root + vec3(dir.x * hx, vy, dir.y * hx);
  tn = vec3(dir.x * sin(a), cos(a), dir.y * sin(a));
  nr = vec3(dir.x * cos(a), -sin(a), dir.y * cos(a));
  bn = cross(tn, nr);
  float tw = rnd.y * s * 1.6 + uWind.x * 0.5 * gust * s * sin(uWind.z - az);
  float c = cos(tw), sn = sin(tw);
  vec3 n2 = nr * c + bn * sn; bn = bn * c - nr * sn; nr = n2;
  hw = 0.5 * blade.y * min(1.0, 1.9 * pow(1.0 - s, 0.72)) * (0.72 + 0.28 * smoothstep(0.0, 0.18, s));
  // one in seven is a stalk with a seed head
  if (rnd.w > 0.86) hw = 0.5 * blade.y * (0.16 + 1.05 * exp(-pow((s - 0.87) / 0.085, 2.0)) * (0.75 + 0.25 * sin(s * 150.0)));
}`;
const BLADE_VERT = LEAF_COMMON + BLADE_FN + /* glsl */ `
attribute vec3 aRoot; attribute vec4 aBlade; attribute vec4 aRnd;
uniform vec4 uStrike;   // struck blade: root x, root z, time of the strike, now (film s on the rain clock)
void main() {
  float s = position.y;
  vec4 blade = aBlade;
  // a blade struck by a raindrop whips down and springs back
  if (uStrike.z > 0.0 && abs(aRoot.x - uStrike.x) < 0.01 && abs(aRoot.z - uStrike.y) < 0.01) {
    float tau = uStrike.w - uStrike.z;
    if (tau > 0.0) blade.z += 1.5 * exp(-tau * 1.6) * cos(tau * 7.0) * smoothstep(0.0, 0.05, tau);
  }
  vec3 p, tn, nr, bn; float hw;
  bladeCurve(aRoot, blade, aRnd, s, p, tn, nr, bn, hw);
  // a flying lens: a blade that comes close thins away instead of being cut by the near plane
  if (uWind.w > 0.0) hw *= smoothstep(0.6 * uWind.w, uWind.w, length(aRoot.xz - cameraPosition.xz));
  float x = position.x;
  vec3 P = p + bn * x * hw - nr * (1.0 - abs(x)) * hw * 0.38;       // folded along the midrib
  vW = P; vN = normalize(nr + bn * x * 0.55); vUv = vec2(x, s);
  vAux = vec2(aRnd.z, mix(0.3, 1.0, smoothstep(0.0, 0.45, s)));
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const MESH_VERT = LEAF_COMMON + /* glsl */ `
attribute vec2 aAux;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vAux = aAux;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LEAF_FRAG = ENV_GLSL + LEAF_COMMON + /* glsl */ `
uniform vec3 uAlbA, uAlbB, uTrans;
uniform vec4 uLeaf;    // gloss · midrib · parallel veins (count across) · kind: 0 blade, 1 broad leaf, 2 petal, 3 stem
uniform float uDim, uPatch;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = uSunDir;
  if (dot(N, V) < 0.0) N = -N;
  float nl = dot(N, L), lit = max(nl, 0.0), through = max(-nl, 0.0);
  float ax = abs(vUv.x), sy = vUv.y;
  // ---- what it is made of
  vec3 alb = mix(uAlbA, uAlbB, vAux.x);
  if (uPatch > 0.5) {
    // a blade: bluer and darker at the base, yellower toward the tip; some are drying to straw
    alb = mix(alb * vec3(0.5, 0.74, 0.92), alb * vec3(1.18, 1.05, 0.78), smoothstep(0.0, 0.9, sy));
    alb = mix(alb, vec3(0.36, 0.28, 0.1), smoothstep(0.84, 0.95, vAux.x) * smoothstep(0.25, 1.0, sy) * 0.75);
  }
  float mid = 1.0 - smoothstep(0.03, 0.16, ax);
  float veins = 0.0;
  if (uLeaf.z > 0.5) {
    float vf = vUv.x * uLeaf.z, vw = fwidth(vf);
    veins = (0.5 + 0.5 * cos(6.2831853 * vf)) * (1.0 - smoothstep(0.3, 0.7, vw));
  }
  if (uLeaf.w > 0.5 && uLeaf.w < 1.5) {
    // broad leaf: pinnate veins leaving the midrib, a net between them
    float side = sign(vUv.x), yy = vUv.y * 14.0 - ax * 3.2;
    float pv = 1.0 - smoothstep(0.0, 0.09 + 0.1 * ax, abs(fract(yy + 0.25 * side) - 0.5) * 2.0 * (0.25 + ax));
    veins = max(veins, pv * 0.8);
    veins = max(veins, 0.25 * smoothstep(0.55, 0.8, snoise(vec2(vUv.x * 9.0, vUv.y * 40.0))));
  }
  if (uLeaf.w < 2.5) alb = mix(alb, alb * 1.22 + vec3(0.02, 0.03, 0.0), uLeaf.y * mid) * (1.0 - 0.14 * veins);
  alb *= 0.86 + 0.2 * snoise(vec2(vUv.x * 4.0 + vAux.x * 40.0, sy * 12.0)) + 0.06 * snoise(vec2(vUv.x * 13.0, sy * 60.0 + vAux.x * 9.0));
  // ---- what light reaches it. Grass stands in its own shade: the sun comes down in streaks between the
  // blades (a pattern fixed in the plane across the sun's direction, drawn out along it), most of it near the tips
  float sunVis = 1.0;
  if (uPatch > 0.5) {
    vec3 s1 = normalize(cross(L, vec3(0.0, 1.0, 0.0)) + 1e-4), s2 = cross(L, s1);
    vec2 sp = vec2(dot(vW, s1), dot(vW, s2));
    float dap = 0.6 * snoise(vec2(sp.x * 0.5, sp.y * 0.06)) + 0.45 * snoise(vec2(sp.x * 0.16, sp.y * 0.025) + 9.0) + 0.2 * snoise(vec2(sp.x * 1.7, sp.y * 0.2) + 3.0);
    sunVis = smoothstep(-0.3, 0.3, dap + (vW.y - uCanopy.x) / uCanopy.y) * (0.25 + 0.75 * vAux.y);
  }
  float ao = uPatch > 0.5 ? 0.3 + 0.7 * vAux.y : vAux.y;
  vec3 amb = uAmbTop * (0.3 + 0.7 * max(N.y, 0.0)) + uAmbBot * (0.6 - 0.4 * N.y);
  vec3 col = alb * (amb * ao + uSunCol * lit * 0.85 * sunVis);
  // ---- light through it: the film's back light. The midrib and the veins are thicker and stay darker
  vec3 tcol = uTrans * (0.72 + 0.5 * vAux.x);
  float thick = 1.0 - 0.5 * mid * uLeaf.y - 0.22 * veins;
  col += tcol * uSunCol * pow(through, 0.5) * thick * sunVis * 0.5;
  // looking toward the sun, every thin edge lights up
  float vs = max(dot(V, -L), 0.0), edge = pow(1.0 - abs(dot(N, V)), 2.0);
  col += tcol * uSunCol * pow(vs, 5.0) * edge * 0.55 * sunVis;
  // ---- wax: a long highlight where the sun glances off, the sky at grazing; rain makes everything glossy
  vec3 H = normalize(L + V);
  float wet = uEnvP.w;
  col += uSunCol * (uLeaf.x + 0.5 * wet) * pow(max(dot(N, H), 0.0), mix(34.0, 90.0, wet)) * step(0.0, nl) * sunVis * 0.8;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += envSky(reflect(-V, N)) * fres * (0.16 + 0.5 * wet);
  col *= mix(1.0, 0.72, wet) * uDim;
  // ---- the air between the lens and the leaf; toward the sun the air itself is lit
  float dist = length(cameraPosition - vW);
  float fogk = 1.0 - exp(-max(dist - uFog.y, 0.0) * uFog.x);
  col = mix(col, uHaze * (0.8 + 1.7 * pow(max(dot(-V, L), 0.0), 5.0)), fogk);
  gl_FragColor = vec4(col, 1.0);
}`;

// ======================================================================================================
// The hero wildflower (S06): one merged mesh, every part tagged by aKind:
//   0 petal · 1 sepal · 2 filament · 3 anther · 4 carpel head · 5 achene · 6 receptacle · 7 stem
// uv: petals and sepals (across -1..1, along 0..1), tubes (around, along). aAux: (tint, baked occlusion).
const FLOWER_VERT = /* glsl */ `
attribute vec2 aAux; attribute float aKind;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec2 vAux; varying float vKind;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vAux = aAux; vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FLOWER_FRAG = ENV_GLSL + /* glsl */ `
uniform vec4 uOcc[10];     // what stands over the flower (the butterfly's body, its feet): centre, radius (<= 0: none)
uniform vec4 uFlower;      // lacquer · light through · albedo · (free)
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec2 vAux; varying float vKind;
float flHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 Ng = normalize(vN), V = normalize(cameraPosition - vW), L = uSunDir;
  float side = dot(Ng, V) >= 0.0 ? 1.0 : -1.0;            // 1: we see the face the normal leaves (a petal's upper face)
  vec3 N = Ng * side;
  float occ = 1.0;
  for (int i = 0; i < 10; i++) { vec4 q = uOcc[i]; if (q.w > 0.0) { vec3 d = vW - q.xyz; occ *= 1.0 - 0.6 * exp(-dot(d, d) / (q.w * q.w)); } }
  float ao = vAux.y * occ;
  vec3 amb = uAmbTop * (0.35 + 0.65 * max(N.y, 0.0)) + uAmbBot * (0.6 - 0.4 * N.y);
  float nlg = dot(Ng, L), lit = max(nlg * side, 0.0), thr = max(-nlg * side, 0.0);
  float wrap = clamp(dot(N, L) * 0.6 + 0.4, 0.0, 1.0);
  float back = pow(max(dot(V, -L), 0.0), 3.0), rim = pow(1.0 - abs(dot(Ng, V)), 2.5);
  vec3 H = normalize(L + V);
  float a = vUv.x, b = vUv.y, k = vKind;
  vec3 col;
  if (k < 0.5) {
    // ---- petal. Faint radial veins fanning from the claw; the margin is thin
    float vc = a * (5.0 + 1.8 * b) + 0.07 * sin(b * 17.0 + a * 4.0 + vAux.x * 6.0);
    float vein = pow(0.5 + 0.5 * cos(6.2831853 * vc), 14.0) * (1.0 - smoothstep(0.2, 0.55, fwidth(vc))) * smoothstep(0.04, 0.25, b) * (1.0 - smoothstep(0.82, 1.0, b));
    float thin = max(smoothstep(0.8, 1.0, abs(a)), smoothstep(0.9, 1.0, b));
    // Deep coral folds open into peach, with a narrow cream edge that catches the backlight.
    vec3 upper = mix(vec3(0.82, 0.105, 0.17), vec3(1.0, 0.40, 0.43), smoothstep(0.06, 0.68, b));
    upper = mix(upper, vec3(1.0, 0.75, 0.64), 0.25 * smoothstep(0.86, 1.0, b) + 0.05 * thin);
    upper *= mix(vec3(1.0, 0.90, 0.97), vec3(1.0, 1.08, 1.02), vAux.x);
    vec3 under = mix(vec3(0.85, 0.26, 0.30), vec3(1.0, 0.61, 0.57), smoothstep(0.12, 0.94, b));
    vec3 alb = (side > 0.0 ? upper : under) * uFlower.z * (1.0 - 0.025 * vein);
    vec3 ambP = mix(amb, vec3(dot(amb, vec3(0.3, 0.6, 0.1))) * vec3(1.0, 0.75, 0.70) * 1.45, side > 0.0 ? 0.24 : 0.14);
    occ = side > 0.0 ? occ : mix(1.0, occ, 0.15);                 // (the butterfly shades the inside of the cup, not its outside)
    ao = vAux.y * occ;
    col = alb * (ambP * mix(0.64, 1.0, ao) + uSunCol * (lit * 0.85 + wrap * 0.10) * mix(1.0, occ, 0.6));
    col += alb * vec3(1.0, 0.50, 0.24) * uSunCol * 0.07 * (1.0 - smoothstep(0.2, 0.9, b)) * ao * step(0.0, side);
    float th = smoothstep(0.0, 0.3, b) * (1.0 - 0.10 * vein) * (0.78 + 0.38 * thin);
    vec3 glow = mix(vec3(1.0, 0.32, 0.30), vec3(1.0, 0.70, 0.56), smoothstep(0.3, 0.95, b));
    col += glow * (uSunCol * pow(thr, 0.55) * mix(1.0, occ, 0.6) + uAmbTop * 0.1 * ao) * uFlower.y * th;
    if (side > 0.0) {
      // A broad satin reflection leaves the thin, curled rim legible without a plastic highlight.
      float gm = smoothstep(0.1, 0.42, b);
      vec3 Nb = normalize(N + 0.012 * vec3(sin(b * 29.0 + a * 7.0), 0.4 * sin(a * 11.0 - b * 5.0), cos(a * 13.0 + b * 17.0)));
      float nh = max(dot(Nb, H), 0.0);
      col += uSunCol * (0.07 * pow(nh, 60.0) + 0.045 * pow(nh, 18.0)) * gm * step(0.0, nlg) * uFlower.x * occ;
      float nv = max(dot(Nb, V), 0.0), fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
      col += envSky(reflect(-V, Nb)) * fres * 0.16 * gm * uFlower.x * mix(1.0, ao, 0.7);
    }
  } else if (k < 1.5) {
    // ---- sepal: green, hairy, the sun through it
    vec3 alb = mix(vec3(0.07, 0.15, 0.025), vec3(0.2, 0.3, 0.05), b) * (side > 0.0 ? 1.0 : 0.85);
    col = alb * (amb * ao + uSunCol * lit * 0.8) + vec3(0.3, 0.5, 0.06) * uSunCol * pow(thr, 0.6) * 0.2 * ao;
    col += vec3(0.5, 0.55, 0.35) * (uAmbTop * 0.25 + uSunCol * 0.5 * back) * rim * ao;              // the hairs catch it
  } else if (k < 2.5) {
    // ---- filament: fine, pale, lit through
    vec3 alb = vec3(0.5, 0.46, 0.13) * mix(0.8, 1.0, b);
    col = alb * (amb * ao * 1.2 + uSunCol * wrap * 0.6 * occ) + vec3(0.9, 0.7, 0.2) * uSunCol * (0.12 + 0.6 * back) * (0.4 + 0.6 * rim) * occ;
  } else if (k < 3.5) {
    // ---- anther: deeper yellow, a dust of pollen that sparkles
    vec3 alb = vec3(1.0, 0.56, 0.02) * 0.3;
    col = alb * (amb * ao * 1.2 + uSunCol * wrap * 0.85 * occ) + vec3(1.0, 0.5, 0.03) * uSunCol * (0.08 + 0.45 * back) * rim * occ;
    float g = flHash(floor(vW * 420.0));
    col += uSunCol * 0.6 * step(0.93, g) * pow(max(dot(N, H), 0.0), 12.0) * occ;
  } else if (k < 4.5) {
    // ---- the head of carpels, under its achenes
    vec3 alb = vec3(0.36, 0.25, 0.055);
    col = alb * (amb * ao + uSunCol * lit * 0.7 * occ);
  } else if (k < 5.5) {
    // ---- achene: warm gold seed heads, small enough to leave the drinking well open
    vec3 alb = mix(vec3(0.56, 0.34, 0.065), vec3(0.35, 0.19, 0.040), smoothstep(0.8, 1.0, b));
    col = alb * (amb * ao + uSunCol * wrap * 0.8 * occ);
    col += uSunCol * (0.2 * pow(max(dot(N, H), 0.0), 50.0)) * occ + envSky(reflect(-V, N)) * 0.035 * ao;
    col += vec3(0.3, 0.55, 0.08) * uSunCol * 0.15 * back * rim * occ;
  } else {
    // ---- receptacle and stem: green, a little translucent, fine hairs at the rim
    vec3 alb = k < 6.5 ? vec3(0.1, 0.2, 0.035) : vec3(0.09, 0.17, 0.03);
    col = alb * (amb * ao + uSunCol * wrap * 0.75) + vec3(0.25, 0.45, 0.06) * uSunCol * 0.25 * back * ao;
    col += vec3(0.45, 0.5, 0.3) * (uAmbTop * 0.18 + uSunCol * 0.35 * back) * rim * ao;
  }
  // the air between the lens and the flower
  float dist = length(cameraPosition - vW), fogk = 1.0 - exp(-max(dist - uFog.y, 0.0) * uFog.x);
  col = mix(col, uHaze * (0.8 + 1.7 * pow(max(dot(-V, L), 0.0), 5.0)), fogk);
  gl_FragColor = vec4(col, 1.0);
}`;

function leafMaterial(E, { instanced = false, albA, albB, trans, gloss = 0.25, midrib = 0.5, veins = 9, kind = 0, extra = {} }) {
  const uniforms = {
    ...E, uAlbA: { value: albA }, uAlbB: { value: albB }, uTrans: { value: trans }, uLeaf: { value: new THREE.Vector4(gloss, midrib, veins, kind) }, uDim: { value: 1 }, uPatch: { value: instanced ? 1 : 0 },
    uWind: extra.uWind || { value: new THREE.Vector4(0, 0, 0, 0) }, uStrike: extra.uStrike || { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  return new THREE.ShaderMaterial({ name: instanced ? 'grass-blades' : 'grass-leaf', uniforms, vertexShader: instanced ? BLADE_VERT : MESH_VERT, fragmentShader: LEAF_FRAG, side: THREE.DoubleSide });
}
const RIBBON = (() => {        // one blade: 3 across x 14 along
  const NS = 14, pos = [], idx = [];
  for (let j = 0; j <= NS; j++) for (const x of [-1, 0, 1]) pos.push(x, (j / NS) ** 0.9, 0);
  for (let j = 0; j < NS; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i, b = a + 1, c = a + 3, d = c + 1; idx.push(a, b, c, b, d, c); }
  return { pos, idx };
})();
/** blades: [{ x, y, z, h, w, bend, az, ph, tw, tint, stiff }] */
function createBlades(list, mat) {
  withStalks(list);
  const n = list.length, root = new Float32Array(n * 3), blade = new Float32Array(n * 4), rnd = new Float32Array(n * 4);
  list.forEach((b, i) => { root.set([b.x, b.y || 0, b.z], i * 3); blade.set([b.h, b.w, b.bend, b.az], i * 4); rnd.set([b.ph, b.tw, b.tint, b.stiff], i * 4); });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(RIBBON.pos, 3));
  geo.setIndex(RIBBON.idx);
  geo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(root, 3));
  geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(blade, 4));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.instanceCount = n;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
const randomBlade = (rng, x, z, o = {}) => ({
  x, z, y: 0, h: o.h ?? rng.range(16, 58), w: o.w ?? rng.range(0.38, 0.85), bend: o.bend ?? rng.range(0.25, 1.25) * (rng() < 0.15 ? 1.6 : 1),
  az: o.az ?? rng.range(0, Math.PI * 2), ph: rng(), tw: rng.range(-0.5, 0.5), tint: rng() * 0.82, stiff: o.stalk === false ? rng() * 0.85 : rng(),
});
// stalks (stiff > 0.86) carry seed heads and are straw-coloured
const withStalks = (list) => { for (const b of list) if (b.stiff > 0.86) { b.tint = 0.9 + 0.1 * b.ph; b.bend *= 0.45; b.h *= 1.12; } return list; };
// a parametric surface as a mesh with (uv: across -1..1, along 0..1) and aux (tint, occlusion)
function surfaceGeometry(nu, nv, fn) {
  const pos = [], uv = [], aux = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = (i / nu) * 2 - 1, b = j / nv, r = fn(a, b);
    pos.push(r.p[0], r.p[1], r.p[2]); uv.push(r.uv ? r.uv[0] : a, r.uv ? r.uv[1] : b); aux.push(r.tint ?? 0.5, r.ao ?? 1);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAux', new THREE.Float32BufferAttribute(aux, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ======================================================================================================
// An invented two-tier wildflower, built in cm about the original receptacle and nectar anchors.
// Five broad petals flare out under five shorter, staggered cups. The first five claws keep their
// original surface; the drinking target stays fixed and the feet solve against both visible tiers.
const BC = { r0: 0.3, y0: 0.035, L: 1.55, W: 1.72, cup: 0.18, over: 0.045, stamens: 39, achenes: 28, headR: 0.21, headH: 0.12 };
// S06's staging on it (degrees, cm): the flower's tilt toward the azimuth `tiltAz`; where the butterfly's head points
// (`headAz`), its pitch head-down, how far behind the flower's centre its thorax stands, how much higher than its
// mean foothold; its feet (right side, local x, z; mirrored), and the petal it drinks from (null = the nearest)
const FLOWER = { phase: 42, tilt: 14, tiltAz: 56, headAz: 24, pitch: 15, back: 0.6, lift: 0, feet: [[0.55, 0.85], [0.72, 0.2], [0.56, -0.2]], petal: 2 };
// S06's lens and light: orbit start (deg) and the sun's azimuth from it, elevation and distance across the shot,
// where it aims (0 = the flower's centre, 1 = the head) · the wings' opening at the top of a breath · the petals'
// lacquer, light through them, albedo · aperture
// S07's medium frame (blade-plane cm): its centre and height, the height it closes to over the leaf and how far above the
// impact it then centres; where the drop lands (x, z in the blade's plane), how far under the bowed tip; how much of the
// tip's upward speed the drop keeps; the blade drawn this much broader; the meadow's dimming, the plate's exposure, aperture
const S7 = { centre: [11.6, 14.4], centre2: [9.8, 16.4], frameH: 8.6, endH: 6.4, endUp: 2.3, hit: [9.6, -1.8], drop: 2.4, fling: 0.25, width: 1.35, roll: 68, bgDim: 0.24, hazeDim: 0.28, plateExp: -1.0, aperture: 3.8 };
const CAM6 = { az0: 34, sunAz: 186, el: [26, 42], dist: [24, 25], side: 0.5, aim: 0.35, aimY: 0, open: 0.85, lacquer: 0.55, glow: 0.29, albedo: 0.22, aperture: 2.2, sheen: [0.55, 0.0], sheenDip: 71.6, fill: 0.75, lobe: 1.45 };
function buildButtercup(seed, opt = {}) {
  const rng = createRng(seed), V = THREE.Vector3;
  const P = { pos: [], nor: [], uv: [], aux: [], kind: [], idx: [] };
  const vert = (p, n, uv, aux, kind) => { P.pos.push(p.x, p.y, p.z); P.nor.push(n.x, n.y, n.z); P.uv.push(uv[0], uv[1]); P.aux.push(aux[0], aux[1]); P.kind.push(kind); return P.pos.length / 3 - 1; };
  const grid = (nu, nv, base) => { for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; P.idx.push(a, b, c, b, d, c); } };
  // ---- the petals
  const phi0 = rng.range(0, Math.PI * 2) + (opt.phase || 0) * DEG;
  const petals = Array.from({ length: 5 }, (_, i) => ({
    i, phi: phi0 + (i / 5) * Math.PI * 2 + rng.range(-4, 4) * DEG, beta: ([31, 39, 28, 36, 32][i] + rng.range(-1, 1)) * DEG, twist: rng.range(-0.20, 0.20),
    L: BC.L * rng.range(0.92, 1.08), W: BC.W * rng.range(0.94, 1.07), s1: rng.range(0, 6.3), s2: rng.range(0, 6.3),
    inner: false, r0: BC.r0, y0: BC.y0,
  }));
  for (let i = 0; i < 5; i++) petals.push({
    i: i + 5, phi: phi0 + ((i + 0.48) / 5) * Math.PI * 2 + rng.range(-3, 3) * DEG,
    beta: ([36, 41, 33, 39, 35][i] + rng.range(-2, 2)) * DEG, twist: rng.range(-0.16, 0.16),
    L: rng.range(0.83, 1.03), W: rng.range(1.08, 1.26), s1: rng.range(0, 6.3), s2: rng.range(0, 6.3),
    inner: true, r0: 0.44, y0: 0.075,
  });
  for (const pe of petals) {
    // The rising midline opens back out at the tip; each side curls independently around it.
    const NB = 64, mid = [[pe.r0, pe.y0, 0]];
    const theta = (b) => pe.beta + (pe.inner ? -8 + 28 * b - 30 * sm(0.72, 1.0, b) : -11 + 22 * b - 32 * sm(0.64, 1.0, b)) * DEG;
    for (let j = 1; j <= NB; j++) { const b = (j - 0.5) / NB, th = theta(b), ds = pe.L / NB, m = mid[j - 1]; mid.push([m[0] + Math.cos(th) * ds, m[1] + Math.sin(th) * ds, theta(j / NB)]); }
    mid[0][2] = theta(0);
    const rh = new V(Math.cos(pe.phi), 0, Math.sin(pe.phi)), th_ = new V(-Math.sin(pe.phi), 0, Math.cos(pe.phi)), up = new V(0, 1, 0);
    // obovate: a narrow claw, widest at two thirds, a rounded tip; the margin very slightly irregular, each side its own
    const half = (b, sgn) => {
      const f = b < 0.66 ? 0.2 + 0.8 * Math.sin((Math.PI / 2) * (b / 0.66)) ** 1.15 : Math.sqrt(Math.max(0, 1 - ((b - 0.66) / 0.34) ** 2));
      const irr = 1 + (0.045 * Math.sin(b * 8 + pe.s1 + sgn * 1.3) + 0.012 * Math.sin(b * 19 + pe.s2 + sgn * 0.7)) * sm(0.25, 0.9, b);
      return 0.5 * pe.W * f * irr;
    };
    pe.point = (a, b) => {
      const x = b * NB, j = Math.min(NB - 1, Math.floor(x)), u = x - j, m0 = mid[j], m1 = mid[j + 1];
      const flare = pe.inner ? 0 : sm(0.12, 1.0, b);
      const rho = m0[0] + (m1[0] - m0[0]) * u + (0.30 + 0.07 * Math.sin(pe.s1)) * flare;
      const hgt = m0[1] + (m1[1] - m0[1]) * u - 0.17 * flare, th = m0[2] + (m1[2] - m0[2]) * u;
      const N0 = rh.clone().multiplyScalar(-Math.sin(th)).addScaledVector(up, Math.cos(th));
      const tw = pe.twist * b, lat = th_.clone().multiplyScalar(Math.cos(tw)).addScaledVector(N0, Math.sin(tw)), n = N0.clone().multiplyScalar(Math.cos(tw)).addScaledVector(th_, -Math.sin(tw));
      const hw = half(b, Math.sign(a) || 1) * (pe.inner ? 1 : 1 + 0.17 * sm(0.12, 0.65, b)), xx = a * hw;
      // Use physical lateral distance: normalized across-petal waves form creases as width goes to zero.
      const across2 = xx * xx / (pe.W * 0.5);
      const rim = 0.025 * across2 * Math.sin(Math.PI * b) * Math.sin(b * 5 + pe.s1 + xx * 2);
      const fold = 0.005 * Math.sin(xx * 10 + b * 4 + pe.s2) * sm(0.18, 0.55, b) * (1 - sm(0.72, 0.96, b));
      const curl = (pe.inner ? 0.020 : 0.015) * Math.sin(xx * 3 + pe.s1) * sm(0.5, 0.84, b) * (1 - sm(0.86, 1.0, b));
      const lift = (pe.inner ? 0.20 : 0.12) * across2 * sm(0.0, 0.35, b) + BC.over * xx * sm(0.08, 0.45, b) + rim + fold + curl;
      return rh.clone().multiplyScalar(rho).addScaledVector(up, hgt).addScaledVector(lat, xx).addScaledVector(n, lift);
    };
    pe.normal = (a, b) => {
      if (b > 0.999) a = 0;
      a = Math.min(0.998, Math.max(-0.998, a)); b = Math.min(0.998, b);             // (the tip and the margin are degenerate)
      const e = 1e-3, pa = pe.point(a + e, b).sub(pe.point(a - e, b)), pb = pe.point(a, Math.min(1, b + e)).sub(pe.point(a, Math.max(0, b - e)));
      const n = new V().crossVectors(pa, pb).normalize();
      const th = theta(b), N0 = rh.clone().multiplyScalar(-Math.sin(th)).addScaledVector(up, Math.cos(th));
      return n.dot(N0) < 0 ? n.negate() : n;
    };
    // the nectary: on the upper face at the claw, just outside the stamens
    pe.nectar = pe.point(0, 0.05).addScaledVector(pe.normal(0, 0.05), 0.012);
    pe.nectarN = pe.normal(0, 0.05);
  }
  // ---- baked occlusion on the petals: the claw in the shade of the stamens, and wherever a neighbour's margin lies over
  const NU = 24, NV = 48;
  const samp = petals.map((pe) => { const pts = []; for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { const a = (i / NU) * 2 - 1, b = j / NV; pts.push({ a, b, p: pe.point(a, b), n: pe.normal(a, b) }); } return pts; });
  petals.forEach((pe, pi) => {
    const base = P.pos.length / 3;
    for (const s of samp[pi]) {
      let ao = 0.5 + 0.5 * sm(0.0, 0.32, s.b);
      for (let qi = 0; qi < petals.length; qi++) {
        if (qi === pi) continue;
        let best = 1e9, above = 0;
        for (const q of samp[qi]) { const d = q.p.distanceTo(s.p); if (d < best) { best = d; above = q.p.clone().sub(s.p).dot(s.n); } }
        if (above > 0.004 && best < 0.12) ao *= 1 - 0.22 * (1 - best / 0.12);
      }
      vert(s.p, s.n, [s.a, s.b], [0.30 + 0.40 * pe.i / (petals.length - 1), ao], 0);
    }
    grid(NU, NV, base);
  });
  // ---- tubes (filaments, achene beaks, the receptacle): rings carried along the curve
  const tubeAt = (pts, radii, sides, kind, aoAt = () => 1) => {
    const base = P.pos.length / 3, n = pts.length, nrm = new V(), bn = new V(), t = new V();
    for (let i = 0; i < n; i++) {
      t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      if (i === 0) nrm.crossVectors(t, Math.abs(t.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize(); else nrm.addScaledVector(t, -nrm.dot(t)).normalize();
      bn.crossVectors(t, nrm);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2, nn = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bn, Math.sin(a));
        vert(pts[i].clone().addScaledVector(nn, radii[i]), nn, [s / sides, i / (n - 1)], [0.5, aoAt(i / (n - 1))], kind);
      }
    }
    grid(sides, n - 1, base);
  };
  // an ellipsoid along `axis` from `at`: length, radius; slightly flattened along `flat`
  const ovoid = (at, axis, len, r, kind, ao = 1, flat = null, fk = 1) => {
    const base = P.pos.length / 3, ax = axis.clone().normalize(), u = new V().crossVectors(ax, Math.abs(ax.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize(), w = new V().crossVectors(ax, u);
    const NR = 8, NS = 9;
    for (let j = 0; j <= NR; j++) {
      const v = j / NR, z = (1 - Math.cos(Math.PI * v)) / 2, rr = Math.sin(Math.PI * v) * r;
      for (let s = 0; s <= NS; s++) {
        const a = (s / NS) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const off = u.clone().multiplyScalar(c * rr).addScaledVector(w, sn * rr * fk);
        const p = at.clone().addScaledVector(ax, z * len).add(off);
        const n = u.clone().multiplyScalar(c / r).addScaledVector(w, sn / (r * fk)).addScaledVector(ax, -Math.cos(Math.PI * v) * 2 / len).normalize();
        vert(p, n, [s / NS, v], [0.5, ao], kind);
      }
    }
    grid(NS, NR, base);
  };
  // ---- the head of carpels: a low dome, about 15% of the flower across, studded with achenes (phyllotaxis)
  const domeY = (rho) => BC.headH * Math.pow(Math.max(0, 1 - (rho / BC.headR) ** 2), 0.7);
  {
    const base = P.pos.length / 3, NR = 10, NS = 24;
    for (let j = 0; j <= NR; j++) for (let s = 0; s <= NS; s++) {
      const rho = BC.headR * (1 - j / NR), a = (s / NS) * Math.PI * 2, y = 0.01 + domeY(rho);
      const dy = (domeY(Math.min(BC.headR, rho + 1e-3)) - domeY(Math.max(0, rho - 1e-3))) / 2e-3;
      const n = new V(-dy * Math.cos(a), 1, -dy * Math.sin(a)).normalize();
      vert(new V(rho * Math.cos(a), y, rho * Math.sin(a)), n, [s / NS, j / NR], [0.5, 0.75 + 0.25 * (j / NR)], 4);
    }
    grid(NS, NR, base);
  }
  for (let k = 0; k < BC.achenes; k++) {
    const rho = BC.headR * 0.92 * Math.sqrt((k + 0.5) / BC.achenes), a = k * 2.39996 + 0.3;
    const y = 0.01 + domeY(rho), dy = (domeY(Math.min(BC.headR, rho + 1e-3)) - domeY(Math.max(0, rho - 1e-3))) / 2e-3;
    const n = new V(-dy * Math.cos(a), 1, -dy * Math.sin(a)).normalize(), at = new V(rho * Math.cos(a), y, rho * Math.sin(a)).addScaledVector(n, -0.012);
    const radial = new V(Math.cos(a), 0, Math.sin(a));
    const ax = n.clone().addScaledVector(radial, 0.25).normalize();
    const al = 0.052 + 0.01 * rng();
    ovoid(at, ax, al, 0.023, 5, 0.7 + 0.3 * (1 - rho / BC.headR), radial, 0.75);
    // the beak: a little hooked style
    const tip = at.clone().addScaledVector(ax, al);
    tubeAt([tip.clone().addScaledVector(ax, -0.008), tip.clone().addScaledVector(ax, 0.008), tip.clone().addScaledVector(ax, 0.015).addScaledVector(radial, 0.009)], [0.006, 0.004, 0.0015], 4, 5);
  }
  // ---- the stamens: a dense ring, fine pale filaments splaying out, each tipped with a small oblong anther
  const stamens = [];
  for (let k = 0; k < BC.stamens; k++) {
    const whorl = k % 3, a = (k / BC.stamens) * Math.PI * 2 + rng.range(-0.075, 0.075);
    const r0 = BC.headR + 0.018 + 0.022 * whorl + 0.01 * rng(), y0 = 0.02 + 0.012 * rng();
    const tilt = (24 + 13 * whorl + rng.range(-8, 8)) * DEG, len = rng.range(0.27, 0.43), side = rng.range(-0.10, 0.10);
    const radial = new V(Math.cos(a), 0, Math.sin(a)), tang = new V(-Math.sin(a), 0, Math.cos(a));
    const pts = [];
    let p = new V(r0 * Math.cos(a), y0, r0 * Math.sin(a));
    const NSEG = 6;
    for (let i = 0; i <= NSEG; i++) {
      pts.push(p.clone());
      const s = (i + 0.5) / NSEG, ang = tilt * (0.5 + 0.9 * s);
      p = p.clone().addScaledVector(new V(0, Math.cos(ang), 0).addScaledVector(radial, Math.sin(ang)).addScaledVector(tang, side * s).normalize(), len / NSEG);
    }
    tubeAt(pts, pts.map((_, i) => 0.0085 - 0.003 * (i / NSEG)), 5, 2, (s) => 0.55 + 0.45 * s);
    const tipDir = pts[NSEG].clone().sub(pts[NSEG - 1]).normalize();
    ovoid(pts[NSEG].clone().addScaledVector(tipDir, -0.012), tipDir, rng.range(0.07, 0.085), 0.02, 3, 1, radial, 0.8);
    stamens.push(pts[NSEG]);
  }
  // ---- the receptacle under the petals, and the five sepals between them
  {
    const pts = [], radii = [];
    for (let i = 0; i <= 6; i++) { const s = i / 6; pts.push(new V(0, 0.04 - 0.3 * s, 0)); radii.push(0.1 + 0.2 * Math.pow(1 - s, 1.6)); }
    tubeAt(pts, radii, 18, 6, (s) => 0.6 + 0.4 * s);
  }
  for (const pe of petals.slice(0, 5)) {
    const phi = pe.phi + Math.PI / 5 + rng.range(-0.08, 0.08), rh = new V(Math.cos(phi), 0, Math.sin(phi)), lat = new V(-Math.sin(phi), 0, Math.cos(phi)), up = new V(0, 1, 0);
    const len = rng.range(0.6, 0.72), wid = rng.range(0.28, 0.34);
    const base = P.pos.length / 3, NU2 = 8, NV2 = 12;
    const sp = (a, b) => {
      const th = (2 - 10 * b + 22 * b * b) * DEG;          // spreading, the tip turning up a little
      const hw = 0.5 * wid * Math.sin(Math.PI * Math.pow(b, 0.6)) ** 0.85 * (1 - 0.3 * b);
      return rh.clone().multiplyScalar(0.2 + len * b * Math.cos(th)).addScaledVector(up, -0.09 + len * b * Math.sin(th) + 0.06 * a * a * hw / 0.15).addScaledVector(lat, a * hw);
    };
    for (let j = 0; j <= NV2; j++) for (let i = 0; i <= NU2; i++) {
      const a = (i / NU2) * 2 - 1, b = j / NV2, e = 1e-3, an = Math.min(0.95, Math.max(-0.95, a)), bn = Math.min(0.95, Math.max(0.04, b));
      const n = new V().crossVectors(sp(an + e, bn).sub(sp(an - e, bn)), sp(an, bn + e).sub(sp(an, bn - e))).normalize();
      if (n.y < 0) n.negate();
      vert(sp(a, b), n, [a, b], [0.5, 0.6 + 0.4 * sm(0, 0.4, b)], 1);
    }
    grid(NU2, NV2, base);
  }
  // ---- the stem: a quadratic curve [from, control, to], slender, a little thicker under the flower
  if (opt.stem) {
    const [p0, p1, p2] = opt.stem, pts = [], radii = [];
    for (let i = 0; i <= 40; i++) {
      const s = (i / 40) ** 1.6, u = 1 - s;
      pts.push(p0.clone().multiplyScalar(u * u).addScaledVector(p1, 2 * u * s).addScaledVector(p2, s * s));
      radii.push(0.075 + 0.03 * Math.exp(-s * 40));
    }
    tubeAt(pts, radii, 10, 7, (s) => 0.7 + 0.3 * (1 - s));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(P.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2));
  g.setAttribute('aAux', new THREE.Float32BufferAttribute(P.aux, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(P.kind, 1));
  g.setIndex(P.idx);
  g.computeBoundingSphere();
  return { geometry: g, petals, stamens, samp, nu: NU, nv: NV };
}

// ======================================================================================================
// Water: dew and rain as little lenses of the environment (instanced spheres)
const LENS_FRAG = ENV_GLSL + /* glsl */ `
varying vec3 vNw; varying vec3 vW; varying float vFade;
void main() {
  vec3 N = normalize(vNw), V = normalize(cameraPosition - vW), I = -V;
  // through a ball of water: refract in, cross it, refract out. The world comes out upside down.
  vec3 t1 = refract(I, N, 0.752);
  vec3 P2 = N - 2.0 * dot(t1, N) * t1;
  vec3 t2 = refract(t1, -P2, 1.33);
  if (dot(t2, t2) < 0.5) t2 = reflect(t1, -P2);
  vec3 col = envColor(normalize(t2)) * 0.92;
  col += uSunCol * 45.0 * smoothstep(0.9975, 0.9996, dot(normalize(t2), uSunDir)) * step(0.5, uEnvQ.x);   // the sun, small and upside down, in every drop
  float nv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  col = mix(col, envColor(reflect(I, N)), fres);
  col *= 1.0 - 0.55 * smoothstep(0.35, 0.0, nv);
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * (5.0 * pow(max(dot(N, H), 0.0), 500.0) + 0.3 * pow(max(dot(N, H), 0.0), 40.0));
  // the light it gathers on its far side
  col += uSunCol * 0.35 * pow(max(dot(N, -uSunDir), 0.0), 6.0) * (0.3 + 0.7 * nv);
  gl_FragColor = vec4(col * vFade, 1.0);
}`;
const DEW_VERT = BLADE_FN + /* glsl */ `
attribute vec3 aRoot; attribute vec4 aBlade; attribute vec4 aRnd; attribute vec4 aDew;   // s · side · radius · phase
varying vec3 vNw; varying vec3 vW; varying float vFade;
void main() {
  vec3 p, tn, nr, bn; float hw;
  bladeCurve(aRoot, aBlade, aRnd, aDew.x, p, tn, nr, bn, hw);
  float nearK = uWind.w > 0.0 ? smoothstep(0.6 * uWind.w, uWind.w, length(aRoot.xz - cameraPosition.xz)) : 1.0;
  vec3 c = p + bn * aDew.y * hw * 0.85 + nr * aDew.z * 0.7;
  vec3 P = c + position * aDew.z * nearK;
  vNw = normalize(position); vW = P; vFade = 1.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const RAIN_VERT = /* glsl */ `
attribute vec4 aDrop;    // x, z, radius, speed (cm per film second)
attribute vec4 aWhen;    // t0 (rain clock), period (0 = once), top y, bottom y
uniform vec4 uRain;      // rain clock, 1 = the steady rain falls too (S13), how much of the steady rain is left (its drops thin away), -
varying vec3 vNw; varying vec3 vW; varying float vFade;
void main() {
  float tau = uRain.x - aWhen.x;
  if (aWhen.y > 0.0) tau = mod(tau, aWhen.y);
  float y = aWhen.z - aDrop.w * tau;
  vFade = 1.0;
  if (tau < 0.0 || y < aWhen.w || (aWhen.y > 0.0 && uRain.y < 0.5)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // a falling drop is a little flattened, and quivers
  vec3 q = position * aDrop.z * vec3(1.0 + 0.04 * sin(tau * 9.0 + aDrop.x), 0.92 - 0.04 * sin(tau * 9.0 + aDrop.x), 1.0) * (aWhen.y > 0.0 ? uRain.z : 1.0);
  vec3 P = vec3(aDrop.x, y, aDrop.y) + q;
  vNw = normalize(position); vW = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

const SPLASH_VERT = /* glsl */ `
attribute vec4 aDir;      // direction (x, y, z) and speed (cm per film second)
uniform vec4 uSplash;     // where the drop struck (xyz, world) and how long ago (film s; < 0 = not yet)
varying vec3 vNw; varying vec3 vW; varying float vFade;
void main() {
  float tau = uSplash.w;
  vFade = 1.0;
  if (tau < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // the crown: a ring of beads thrown up and outward from the rim of the flattening drop
  vec3 c = uSplash.xyz + aDir.xyz * (0.28 + aDir.w * tau) + vec3(0.0, -18.0 * tau * tau, 0.0);
  vec3 P = c + position * (0.055 + 0.05 * fract(aDir.w * 7.7));
  vNw = normalize(position); vW = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

// ======================================================================================================
// Discs: dew glints, pollen, flowers and lights far behind, drawn after depth of field with their own bokeh
const DISC_VERT = /* glsl */ `
attribute vec3 aPos; attribute vec4 aCol; attribute vec4 aMisc;    // aCol.a: diameter (cm) · aMisc: phase, twinkle, drift, out-order
uniform vec4 uDof;    // focus, aperture, max blur px @1080, viewport height px
uniform vec4 uBk;     // slow time, gain, lights out 0..1 (from the right), aspect
uniform vec3 uSunDir; uniform float uFwd;   // motes and glints are brightest seen toward the sun
varying vec2 vUv; varying vec4 vCol; varying float vSoft;
void main() {
  vec3 pos = aPos + aMisc.z * vec3(sin(uBk.x * 0.7 + aMisc.x * 31.0), 0.6 * sin(uBk.x * 0.5 + aMisc.x * 17.0) + 0.25 * uBk.x, cos(uBk.x * 0.6 + aMisc.x * 23.0));
  vec4 mv = viewMatrix * modelMatrix * vec4(pos, 1.0);
  float z = max(-mv.z, 0.05);
  float coc = clamp(uDof.y * abs(z - uDof.x) / z, 0.0, 1.0) * uDof.z * (uDof.w / 1080.0);
  float ppu = projectionMatrix[1][1] * 0.5 * uDof.w / z;
  float base = max(0.5 * abs(aCol.a) * ppu, 0.6), R = base + coc;
  float dim = aCol.a < 0.0 ? 1.0 : pow(base * base / (R * R), 0.5);
  float tw = 1.0 + aMisc.y * 0.6 * sin(uBk.x * (2.0 + 5.0 * fract(aMisc.x * 7.3)) + aMisc.x * 50.0);
  vec4 clip = projectionMatrix * mv;
  // the walker passes between us and the lights: they go out from the right of frame, one by one
  float sx = clip.x / clip.w * 0.5 + 0.5;
  float gone = uBk.z > 0.0 ? smoothstep(0.0, 0.04, uBk.z * 1.25 - (1.0 - sx) - 0.2 * aMisc.w) : 0.0;
  float fwd = 1.0 + uFwd * pow(max(dot(normalize((modelMatrix * vec4(pos, 1.0)).xyz - cameraPosition), uSunDir), 0.0), 10.0);
  vCol = vec4(aCol.rgb * uBk.y * dim * tw * fwd * (1.0 - gone), 1.0);
  vSoft = coc / R;
  vec2 px = position.xy * vec2(R / mix(1.0, 1.5, smoothstep(0.2, 0.7, vSoft)), R);
  clip.xy += px * 2.0 / vec2(uDof.w * uBk.w, uDof.w) * clip.w;
  vUv = position.xy;
  if (mv.z > -0.05 || dot(vCol.rgb, vec3(1.0)) < 0.002) clip = vec4(2.0, 2.0, 2.0, 1.0);
  gl_Position = clip;
}`;
const DISC_FRAG = /* glsl */ `
varying vec2 vUv; varying vec4 vCol; varying float vSoft;
void main() {
  // in focus: a soft point. Out of focus: the lens's oval, creamy: nearly flat, a breath of rim, a soft edge
  float r = length(vUv);
  float disc = 1.0 - smoothstep(0.62, 1.0, r);
  float rim = smoothstep(0.5, 0.8, r) * disc;
  float aB = disc * (0.8 + 0.3 * rim);
  float aP = exp(-r * r * 4.5) * (1.0 - smoothstep(0.75, 1.0, r));
  float a = mix(aP, aB, smoothstep(0.2, 0.6, vSoft));
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}`;
/** items: [{ p: [x, y, z], c: [r, g, b], s: diameter cm, ph, tw, drift, order }] */
function createDiscs(items, shared) {
  const n = items.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 4), misc = new Float32Array(n * 4);
  items.forEach((d, i) => { pos.set(d.p, i * 3); col.set([d.c[0], d.c[1], d.c[2], d.s], i * 4); misc.set([d.ph ?? 0, d.tw ?? 0, d.drift ?? 0, d.order ?? 0], i * 4); });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 4));
  geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
  geo.instanceCount = n;
  const uniforms = { uDof: shared.uDof, uBk: { value: new THREE.Vector4(0, 1, 0, 2) }, uSunDir: shared.uSunDir, uFwd: { value: 3 } };
  const mat = new THREE.ShaderMaterial({
    name: 'grass-discs', uniforms, vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.layers.set(FX_LAYER);
  return { mesh, uniforms };
}

// ======================================================================================================
// The pupa: the sleeper's outline (story.sleeperOutline), seen against the sun as the sleeper was seen against the
// lamp: a dark case with light in its rim. It splits along its back (a seam of light that widens); emptied, the shell
// is a lantern. The outline is passed through a Catmull-Rom spline (PUPA_SUB points a span), so the case is smooth.
const PUPA_SUB = 3, PUPA_N = (SLEEPER_OUTLINE.length - 1) * PUPA_SUB + 1;
const pupaOutline = (pts) => {
  const out = [], n = pts.length, at = (i) => pts[Math.min(n - 1, Math.max(0, i))];
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < PUPA_SUB; k++) {
    const u = k / PUPA_SUB, p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u * u + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * u * u * u)));
  }
  out.push(pts[n - 1]);
  return out;
};
const PUPA_FRAG = ENV_GLSL + /* glsl */ `
uniform vec2 uPts[${PUPA_N}];
uniform vec2 uSeam[3];  // the split: from the hump down the head end
uniform vec4 uPupa;     // split 0..1 · emptied 0..1 · stem y · how far the seam gapes
varying vec3 vW;
float sdPoly(vec2 p) {
  float d = dot(p - uPts[0], p - uPts[0]), s = 1.0;
  for (int i = 0, j = ${PUPA_N - 1}; i < ${PUPA_N}; j = i, i++) {
    vec2 e = uPts[j] - uPts[i], w = p - uPts[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= uPts[i].y, p.y < uPts[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
void main() {
  vec2 p = vW.xy;
  float d = sdPoly(p) - 0.03;
  float aa = fwidth(d);
  float cover = 1.0 - smoothstep(-aa, aa, d);
  if (cover < 0.02) discard;
  float depth = max(-d, 0.0), emptied = uPupa.y;
  float along = clamp((p.x - uPts[0].x) / (uPts[${PUPA_N - 1}].x - uPts[0].x), 0.0, 1.0);
  // the seam: clean, a little uneven in width, opening from the hump toward the head
  float crack = min(sdSeg(p, uSeam[0], uSeam[1]), sdSeg(p, uSeam[1], uSeam[2]));
  float run = clamp((p.x - uSeam[0].x) / (uSeam[2].x - uSeam[0].x), 0.0, 1.0);
  float gap = uPupa.w * (0.55 + 0.45 * sin(run * 3.1416)) * (1.0 + 0.25 * snoise(vec2(run * 5.0, 3.0))) * smoothstep(0.0, 0.5, uPupa.x * 1.6 - run);
  float open = 1.0 - smoothstep(gap - aa, gap + aa, crack);
  if (uPupa.x <= 0.0) open = 0.0;
  // against the light the case is ink; the sun comes through its edge where the shell is thin, most on the side
  // that faces the sun, and all through it once it is empty
  vec2 toSun = normalize(uSunDir.xy + vec2(0.3, 0.45));
  float e = 0.02;
  vec2 g = normalize(vec2(sdPoly(p + vec2(e, 0.0)) - sdPoly(p - vec2(e, 0.0)), sdPoly(p + vec2(0.0, e)) - sdPoly(p - vec2(0.0, e))) + 1e-5);
  float facing = 0.25 + 0.75 * smoothstep(-0.5, 0.9, dot(g, toSun));
  float low = smoothstep(0.0, 0.5, (p.y - uPupa.z) / 0.9);                         // nothing glows where it lies on the stem
  float rimT = exp(-depth * 26.0) + 0.2 * exp(-depth * 6.0);
  vec3 jade = ${g3(lin3(PALETTE.pupa))};
  vec3 col = jade * 0.012 * (uAmbTop * 1.2 + uAmbBot);
  col += mix(jade * vec3(0.9, 1.3, 0.7), vec3(1.0, 0.8, 0.45), 0.35) * uSunCol * 0.85 * rimT * facing * low * (1.0 - emptied);
  // the folded wings inside show for a moment as the darker heart of the case (nothing to draw: it is ink already)
  // emptied: a husk, amber, with its segments and the seam's lips
  float seg = smoothstep(0.36, 0.5, abs(fract(along * 15.0 + 0.3) - 0.5)) * (1.0 - smoothstep(0.42, 0.55, along));
  vec3 husk = vec3(0.95, 0.66, 0.3) * uSunCol * (0.035 + 0.12 * exp(-depth * 5.0) + 0.05 * facing) * (1.0 - 0.3 * seg) * (0.45 + 0.55 * low);
  col = mix(col, husk, emptied);
  float lip = (1.0 - smoothstep(gap, gap + 0.035, crack)) * step(1e-4, uPupa.x) * smoothstep(0.0, 0.4, uPupa.x * 1.6 - run);
  col += vec3(1.0, 0.85, 0.55) * uSunCol * 0.2 * lip;                               // the shell's edge catches the sun
  float alpha = cover * (1.0 - open);
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(col, alpha);
}`;

// ======================================================================================================
// The walker (S22). Seen from a few centimetres off the blade, 30 cm above the ground, a person walking home through the
// meadow is a pair of legs: two huge, soft, dark columns passing in the background from right to left, one planted while
// the other swings past it, a knee at the top of frame and a foot coming down into the grass, far out of focus, in ink.
// They are drawn at a depth behind the blade's plane (what is nearer stands in front of them) and block the dusk glow
// and the lights behind. Their shadow falls the other way, along the ground toward the lens: the last light on the grass
// tops, the blade and the butterfly goes out from right to left (a soft edge led by the legs, which dim it as each one
// passes), and what is in shadow is ink. Then the body closes over the whole frame from the same side, to black.
// Screen space p: x in frame widths 0..1, y in frame widths 0..0.5, from the bottom left.
const LEG_SEGS = 12;
const WALK_FN = /* glsl */ `
#define NLEG ${LEG_SEGS}
uniform vec4 uLeg[NLEG];     // capsules a.xy, b.xy (frame widths)
uniform vec2 uLegR[NLEG];    // radius at a, at b
uniform int uLegN;
uniform vec4 uWalk;          // the legs' defocus (frame widths), the body's edge x, closing 0..1, the grass line y
uniform vec4 uFall;          // the shadow's edge on the ground x, its softness, (free), how dark the shadow leaves things
uniform vec4 uCols;          // the two shanks' x at mid frame and their half widths, for the columns of shadow they cast
uniform vec2 uRes;
float wkSmin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec2 wkP() { vec2 uv = gl_FragCoord.xy / uRes; return vec2(uv.x, uv.y * uRes.y / uRes.x); }
// 0..1: the legs, far out of focus; their feet go down into the blurred meadow, whose tops stand in front of them
float legsCover(vec2 p) {
  float d = 1e3;
  for (int k = 0; k < NLEG; k++) {
    if (k >= uLegN) break;
    vec4 sg = uLeg[k]; vec2 r = uLegR[k];
    vec2 pa = p - sg.xy, ba = sg.zw - sg.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    d = wkSmin(d, length(pa - ba * h) - mix(r.x, r.y, h), 0.02);
  }
  float c = 1.0 - smoothstep(-uWalk.x, uWalk.x, d);
  float g = uWalk.w + 0.014 * snoise(vec2(p.x * 9.0, 3.0)) + 0.006 * snoise(vec2(p.x * 31.0, 7.0));
  return c * smoothstep(g - 0.03, g + 0.035, p.y);
}
// 0..1: the body closing over everything from the right, one soft leaning edge
float bodyCover(vec2 p) {
  float e = uWalk.y - 0.12 * (p.y - 0.25) + 0.025 * snoise(vec2(p.y * 4.0, 1.7));
  float soft = 0.18 + 0.08 * uWalk.z;
  return max(smoothstep(e - soft, e + soft, p.x), smoothstep(0.9, 1.0, uWalk.z));
}
`;
// the light failing on what is near (the blade, the butterfly, the grass at its foot): drawn behind the blade's plane
// with the depth test reversed, so it lands on those and never on the sky
const FALL_FRAG = NOISE + WALK_FN + /* glsl */ `
uniform vec3 uInk;           // what is in shadow becomes (linear, as it should read: ink black)
void main() {
  vec2 p = wkP();
  float e = uFall.x - 0.05 * (p.y - 0.2) + 0.012 * snoise(vec2(p.y * 6.0, 4.0));
  float fall = smoothstep(e - uFall.y, e + uFall.y, p.x);
  // each leg, as it comes between the last light and the blade, throws a column of shadow ahead of the body's
  float cols = 0.0;
  for (int i = 0; i < 2; i++) { float x = i == 0 ? uCols.x : uCols.y, w = i == 0 ? uCols.z : uCols.w; cols = max(cols, 1.0 - smoothstep(w - 0.03, w + 0.05, abs(p.x - x))); }
  float k = max(max(fall, 0.75 * cols), bodyCover(p)) * uFall.w;
  gl_FragColor = vec4(uInk, k);
}`;
// the legs and the closing body, in ink, over everything behind the blade's plane
const WALKER_FRAG = NOISE + WALK_FN + /* glsl */ `
uniform vec3 uLegInk, uBodyInk;   // the legs (浓, blurred), the body at its darkest (ink black)
void main() {
  vec2 p = wkP();
  float legs = legsCover(p), body = bodyCover(p);
  vec3 c = mix(uLegInk * (1.0 + 0.25 * (1.0 - legs)), uBodyInk, body);
  float a = max(legs * 0.94, body);
  gl_FragColor = vec4(c, a);
}`;

// ======================================================================================================
function basisQuat(zAxis, yHint, out = new THREE.Quaternion()) {
  const z = zAxis.clone().normalize(), x = new V3().crossVectors(yHint, z).normalize(), y = new V3().crossVectors(z, x);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export async function create(ctx) {
  const aspect = ctx.aspect;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(10, aspect, 0.3, 9000);
  const vfov = (mm) => lensToFov(mm, aspect) * DEG;
  const distFor = (h, mm) => (h / 2) / Math.tan(vfov(mm) / 2);
  const rng = createRng('grass');
  const E = ENV_UNIFORMS();
  const shared = { uDof: { value: new THREE.Vector4(30, 2, 24, 1080) }, uSunDir: E.uSunDir };
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // ---- background -------------------------------------------------------------------------------------
  const bgU = { ...E, uCloud: { value: new THREE.Vector4(1, 0, 0, -1) }, uCloudW: { value: 0.125 }, uHill: { value: 1 } };
  const bg = new THREE.Mesh(track(new THREE.SphereGeometry(4000, 48, 24)), track(new THREE.ShaderMaterial({ name: 'grass-sky', uniforms: bgU, vertexShader: BG_VERT, fragmentShader: BG_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth })));
  bg.frustumCulled = false; bg.renderOrder = -50;
  // a veil of our own sky over FIELD's plate (S05): the plate's morning sky is a deep blue, and blue is the butterfly's
  // alone; above the horizon the palette's pale sky (#9CC7E8 over #F7C99A) is laid over it, the land left as it is
  const veilU = { ...E, uVeil: { value: 0 } };
  const veil = new THREE.Mesh(bg.geometry, track(new THREE.ShaderMaterial({
    name: 'grass-sky-veil', uniforms: veilU, vertexShader: BG_VERT,
    fragmentShader: ENV_GLSL + /* glsl */ `
varying vec3 vD; uniform float uVeil;
void main() { vec3 d = normalize(vD); gl_FragColor = vec4(envSky(d), uVeil * smoothstep(0.015, 0.16, d.y)); }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })));
  veil.frustumCulled = false; veil.renderOrder = -40; veil.visible = false;
  scene.add(veil);
  scene.add(bg);
  // FIELD's backplate (Group A): the real meadow, valley and city behind us, when it can be had
  let plate = null;
  try { const mod = await import('./field.js'); if (mod.createFieldBackplate) { plate = await mod.createFieldBackplate(ctx); plate.mesh.visible = false; scene.add(plate.mesh); if (plate.discs) { plate.discs.visible = false; scene.add(plate.discs); } } } catch (e) { console.warn('[grass] FIELD backplate unavailable, using the procedural meadow:', e && e.message); plate = null; }
  const usePlate = (t, o) => {
    if (!plate || !o) { bg.visible = true; if (plate) { plate.mesh.visible = false; if (plate.discs) plate.discs.visible = false; } return false; }
    try { plate.set(o); plate.update(t, camera); plate.mesh.visible = true; if (plate.discs) plate.discs.visible = !!o.discLayer; bg.visible = false; return true; } catch (e) { console.warn('[grass] FIELD backplate failed:', e && e.message); plate.mesh.visible = false; bg.visible = true; plate = null; return false; }
  };

  // ---- materials ----------------------------------------------------------------------------------------
  const uWind = { value: new THREE.Vector4(0.2, 0, 0.6, 0) }, uStrike = { value: new THREE.Vector4(0, 0, 0, 0) };
  const grassLit = lin3(PALETTE.grassLit), grassShadow = lin3(PALETTE.grassShadow);
  const bladeMat = track(leafMaterial(E, { instanced: true, albA: grassShadow.clone().multiplyScalar(1.3), albB: grassLit.clone().multiplyScalar(0.5), trans: new V3(0.42, 0.7, 0.07), gloss: 0.3, midrib: 0.5, veins: 9, extra: { uWind, uStrike } }));
  const bladeFarMat = track(leafMaterial(E, { instanced: true, albA: grassShadow.clone().multiplyScalar(1.3), albB: grassLit.clone().multiplyScalar(0.5), trans: new V3(0.42, 0.7, 0.07), gloss: 0.3, midrib: 0.5, veins: 9, extra: { uWind, uStrike } }));
  bladeFarMat.depthWrite = false;
  const heroBladeMat = track(leafMaterial(E, { albA: grassShadow.clone().multiplyScalar(1.5), albB: grassLit.clone().multiplyScalar(0.62), trans: new V3(0.5, 0.78, 0.12), gloss: 0.35, midrib: 0.6, veins: 9 }));
  const stemMat = track(leafMaterial(E, { albA: new V3(0.1, 0.17, 0.03), albB: new V3(0.2, 0.32, 0.06), trans: new V3(0.3, 0.5, 0.08), gloss: 0.3, midrib: 0, veins: 0, kind: 3 }));
  const dockMat = track(leafMaterial(E, { albA: lin3(PALETTE.wetLeaf, 0.8), albB: lin3(PALETTE.wetLeaf, 1.3), trans: new V3(0.42, 0.7, 0.14), gloss: 0.35, midrib: 0.9, veins: 0, kind: 1 }));
  const flowerU = { ...E, uOcc: { value: Array.from({ length: 10 }, () => new THREE.Vector4(0, 0, 0, 0)) }, uFlower: { value: new THREE.Vector4(1, 0.2, 0.22, 0) } };
  const flowerMat = track(new THREE.ShaderMaterial({ name: 'grass-buttercup', uniforms: flowerU, vertexShader: FLOWER_VERT, fragmentShader: FLOWER_FRAG, side: THREE.DoubleSide }));
  const lensU = { ...E };
  const sphere = track(new THREE.SphereGeometry(1, 20, 14));

  const makeDew = (blades, count, seed, rmin = 0.08, rmax = 0.26) => {
    const r = createRng(seed), n = count;
    const root = new Float32Array(n * 3), blade = new Float32Array(n * 4), rnd = new Float32Array(n * 4), dew = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const b = blades[Math.floor(r() * blades.length)];
      root.set([b.x, b.y || 0, b.z], i * 3); blade.set([b.h, b.w, b.bend, b.az], i * 4); rnd.set([b.ph, b.tw, b.tint, b.stiff], i * 4);
      dew.set([r.range(0.3, 0.97), r.sign() * r.range(0.6, 1), rmin + (rmax - rmin) * r() ** 2.2, r()], i * 4);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', sphere.attributes.position); geo.setIndex(sphere.index);
    for (const [k, a, s] of [['aRoot', root, 3], ['aBlade', blade, 4], ['aRnd', rnd, 4], ['aDew', dew, 4]]) geo.setAttribute(k, new THREE.InstancedBufferAttribute(a, s));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({ name: 'grass-dew', uniforms: { ...lensU, uWind }, vertexShader: DEW_VERT, fragmentShader: LENS_FRAG });
    const mesh = new THREE.Mesh(track(geo), track(mat));
    mesh.frustumCulled = false;
    return mesh;
  };
  const uRain = { value: new THREE.Vector4(0, 0, 0, 0) };
  const makeRain = (drops) => {
    const n = drops.length, a = new Float32Array(n * 4), w = new Float32Array(n * 4);
    drops.forEach((d, i) => { a.set([d.x, d.z, d.r, d.v], i * 4); w.set([d.t0, d.period || 0, d.top, d.bottom], i * 4); });
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', sphere.attributes.position); geo.setIndex(sphere.index);
    geo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(a, 4)); geo.setAttribute('aWhen', new THREE.InstancedBufferAttribute(w, 4));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({ name: 'grass-rain', uniforms: { ...lensU, uRain }, vertexShader: RAIN_VERT, fragmentShader: LENS_FRAG });
    const mesh = new THREE.Mesh(track(geo), track(mat));
    mesh.frustumCulled = false;
    return mesh;
  };
  const discSets = [];
  const makeDiscs = (items) => { const d = createDiscs(items, shared); track(d.mesh.geometry); track(d.mesh.material); discSets.push(d); return d; };

  // ---- butterflies --------------------------------------------------------------------------------------
  const hero = createButterfly({ lod: 'hero', seed: 'hero' });
  scene.add(hero.group);
  const others = Array.from({ length: 6 }, (_, i) => { const b = createButterfly({ lod: 'mid', seed: 'roost-' + i }); scene.add(b.group); b.group.visible = false; return b; });
  const placeButterfly = (b, pos, head, dorsal, scale = 1) => { b.group.position.copy(pos); basisQuat(head, dorsal, b.group.quaternion); b.group.scale.setScalar(scale); b.group.visible = true; };

  // ======================================================================================================
  // STAGE emerge (S04b)
  const EM = (() => {
    const g = new THREE.Group(); scene.add(g);
    const W = 9, H = W / aspect, D = distFor(H, 100), STEM_Y = 20, CY = STEM_Y + (0.5 - DESK_EDGE_Y) * H;
    const toWorld = ([sx, sy]) => [(sx - 0.5) * W, CY + (sy - 0.5) * H];
    const sunDir = new V3((LAMP_SUN[0] - 0.5) * W, (LAMP_SUN[1] - 0.5) * H, -D).normalize();
    // the stem: the desk edge. Its top lies on the 34% line
    const R = 0.15;
    const stem = new THREE.Mesh(track(surfaceGeometry(16, 40, (a, b) => {
      const x = -14 + 28 * b, th = a * Math.PI, sag = -0.0016 * x * x;
      return { p: [x, STEM_Y - R + sag + Math.cos(th) * R, -0.02 + Math.sin(th) * R], uv: [a, b], tint: 0.5 + 0.4 * Math.cos(th), ao: 1 };
    })), stemMat);
    g.add(stem);
    // the pupa
    const pupaU = { ...E, uPts: { value: Array.from({ length: PUPA_N }, () => new THREE.Vector2()) }, uSeam: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] }, uPupa: { value: new THREE.Vector4(0, 0, STEM_Y, 0) } };
    const pupaMat = track(new THREE.ShaderMaterial({ name: 'grass-pupa', uniforms: pupaU, vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`, fragmentShader: PUPA_FRAG, alphaToCoverage: true, side: THREE.DoubleSide }));
    const pupa = new THREE.Mesh(track(new THREE.PlaneGeometry(4.4, 2.4)), pupaMat);
    pupa.position.set(-0.13, STEM_Y + 0.7, 0);
    g.add(pupa);
    // grass behind: its tops stay under the horizon (the upper frame is sky and the sun, as the room's wall and
    // lamp were); a few tall stalks stand at the sides, clear of the sun; a few blades in front at the frame's edges
    const list = [];
    for (let i = 0; i < 900; i++) { const z = -5 - 170 * rng() ** 1.4, x = rng.range(-1, 1) * (12 + 0.4 * -z); list.push(randomBlade(rng, x, z, { h: rng.range(11, 20.6), bend: rng.range(0.15, 0.9) })); }
    for (let i = 0; i < 16; i++) { const z = rng.range(-46, -9), k = (D - z) / D, sgn = i % 2 ? 1 : -1, x = (sgn > 0 ? rng.range(2.9, 5.2) : rng.range(-5.2, -2.2)) * k; list.push(randomBlade(rng, x, z, { h: rng.range(24, 40), bend: rng.range(0.1, 0.45), w: rng.range(0.5, 0.9) })); }
    for (let i = 0; i < 10; i++) { const sgn = rng.sign(); list.push(randomBlade(rng, sgn * rng.range(3.6, 6), rng.range(4, 20), { h: rng.range(17, 29), bend: rng.range(0.1, 0.6), az: sgn > 0 ? 0 : Math.PI })); }
    g.add(createBlades(list, bladeMat));
    g.add(makeDew(list.slice(0, 500), 200, 'em-dew'));
    // dew and pollen as discs: where the dust of S04a hung, glints in the grass behind
    const items = [];
    for (let i = 0; i < 150; i++) { const z = -4 - 90 * rng() ** 1.3, k = 1 + -z / D; items.push({ p: [rng.range(-5, 5) * k, STEM_Y + rng.range(-3.5, 3) * k * 0.5, z], c: [2.2, 2.0, 1.5].map((v) => v * rng.range(0.25, 1.1)), s: rng.range(0.03, 0.09), ph: rng(), tw: 0.6 }); }
    for (let i = 0; i < 110; i++) items.push({ p: [rng.range(-6, 6), STEM_Y + rng.range(-2.6, 3.2), rng.range(-9, 14)], c: [1.6, 1.25, 0.6].map((v) => v * rng.range(0.2, 0.8)), s: rng.range(0.012, 0.03), ph: rng(), tw: 0.3, drift: 0.35 });
    // the lens's own picture of what is far behind: creamy ovals of sunlit grass tops and dew
    for (let i = 0; i < 120; i++) {
      const z = -50 - 260 * rng() ** 1.2, k = (D - z) / D, warm = rng();
      const c = warm < 0.5 ? [1.0, 0.82, 0.5] : warm < 0.85 ? [0.75, 0.95, 0.45] : [1.0, 0.98, 0.9];
      items.push({ p: [rng.range(-5.4, 5.4) * k, STEM_Y + (0.7 + rng.range(-3.4, 0.6)) * k, z], c: c.map((v) => v * rng.range(0.05, 0.3)), s: -rng.range(0.3, 1.2), ph: rng(), tw: 0.25 });
    }
    // pollen and fluff drifting in the light, near the plane of focus and on either side of it
    for (let i = 0; i < 200; i++) items.push({ p: [rng.range(-7, 7), STEM_Y + rng.range(-3, 3.6), rng.range(-16, 18)], c: [1.0, 0.85, 0.55].map((v) => v * rng.range(0.25, 1.3)), s: rng.range(0.012, 0.036), ph: rng(), tw: 0.35, drift: 0.5 });
    const discs = makeDiscs(items); g.add(discs.mesh);
    return { g, W, H, D, STEM_Y, CY, R, toWorld, sunDir, pupaU, discs };
  })();

  // ======================================================================================================
  // STAGE flower (S06)
  const FL = (() => {
    const g = new THREE.Group(); scene.add(g);
    const F = new V3(0, 32, 0);
    // the flower faces the lens's way a little (the middle of its orbit), as a flower turns to the light
    const flower = new THREE.Group(); flower.position.copy(F);
    const axis = new V3(Math.cos(FLOWER.tiltAz * DEG) * Math.sin(FLOWER.tilt * DEG), Math.cos(FLOWER.tilt * DEG), Math.sin(FLOWER.tiltAz * DEG) * Math.sin(FLOWER.tilt * DEG));
    flower.quaternion.setFromUnitVectors(new V3(0, 1, 0), axis);
    g.add(flower); flower.updateMatrixWorld(true);
    const inv = flower.matrixWorld.clone().invert(), toLocal = (v) => v.clone().applyMatrix4(inv);
    // a slender stem with a slight curve, from under the flower down into the grass
    const stem = [new V3(0, -0.24, 0), toLocal(F.clone().addScaledVector(axis, -9)), toLocal(new V3(F.x + 1.6, -1, F.z - 0.8))];
    const bc = buildButtercup('buttercup', { stem, phase: FLOWER.phase });
    flower.add(new THREE.Mesh(track(bc.geometry), flowerMat));
    // the petals' upper surface in the world, as triangles, for the feet to stand on
    const { nu: NU, nv: NV } = bc, tris = [];
    for (const pts of bc.samp) {
      const w = pts.map((s) => s.p.clone().applyMatrix4(flower.matrixWorld));
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; tris.push([w[a], w[b], w[c]], [w[b], w[d], w[c]]); }
    }
    /** The highest petal surface over (x, z), world: { y, n } or null. */
    const topAt = (x, z) => {
      let best = null;
      for (const [A, B, C] of tris) {
        const v0x = C.x - A.x, v0z = C.z - A.z, v1x = B.x - A.x, v1z = B.z - A.z, v2x = x - A.x, v2z = z - A.z;
        const den = v0x * v1z - v1x * v0z;
        if (Math.abs(den) < 1e-12) continue;
        const u = (v2x * v1z - v1x * v2z) / den, v = (v0x * v2z - v2x * v0z) / den;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        const y = A.y + u * (C.y - A.y) + v * (B.y - A.y);
        if (!best || y > best.y) { const n = new V3().crossVectors(B.clone().sub(A), C.clone().sub(A)).normalize(); if (n.y < 0) n.negate(); best = { y, n }; }
      }
      return best;
    };
    const Fc = flower.localToWorld(new V3(0, 0.05, 0));
    const nectar = bc.petals.map((pe) => ({ p: flower.localToWorld(pe.nectar.clone()), n: pe.nectarN.clone().transformDirection(flower.matrixWorld), lat: new V3(-Math.sin(pe.phi), 0, Math.cos(pe.phi)).transformDirection(flower.matrixWorld), along: new V3(Math.cos(pe.phi), 0.6, Math.sin(pe.phi)).normalize().transformDirection(flower.matrixWorld) }));
    // where it stands: on the far side of the cup, facing in and down over the stamens, its feet on the petals around
    // the ring (each foot found on the petal surface), its body pitched head-down
    const PERCH = (() => {
      const psi = FLOWER.headAz * DEG, pitch = FLOWER.pitch * DEG;
      const head = new V3(Math.cos(psi) * Math.cos(pitch), -Math.sin(pitch), Math.sin(psi) * Math.cos(pitch));
      const dorsal = new V3(0, 1, 0).addScaledVector(head, -head.y).normalize();
      const q = basisQuat(head, dorsal);
      const pos = new V3(Fc.x - Math.cos(psi) * FLOWER.back, Fc.y + 1, Fc.z - Math.sin(psi) * FLOWER.back);
      const m = new THREE.Matrix4();
      let contacts = [];
      for (let it = 0; it < 4; it++) {
        m.compose(pos, q, new V3(1, 1, 1));
        let dy = 0; contacts = [];
        for (const s of [1, -1]) for (const [fx, fz] of FLOWER.feet) {
          const w = new V3(fx * s, FEET_Y, fz).applyMatrix4(m), hit = topAt(w.x, w.z);
          if (!hit) console.warn('[grass] S06: a foot finds no petal under it', fx * s, fz);
          contacts.push({ p: new V3(w.x, hit ? hit.y : w.y, w.z), n: hit ? hit.n : new V3(0, 1, 0) });
          dy += (hit ? hit.y : w.y) - w.y;
        }
        pos.y += dy / 6;
      }
      pos.y += FLOWER.lift;
      m.compose(pos, q, new V3(1, 1, 1));
      const mi = m.clone().invert(), qi = q.clone().invert();
      const feet = contacts.map((c) => { const p = c.p.clone().applyMatrix4(mi), n = c.n.clone().applyQuaternion(qi); return [p.x, p.y, p.z, n.x, n.y, n.z]; });
      // the nectar it drinks: the claw of the petal nearest under and before its head
      const headW = new V3(0, -0.1, 1.0).applyMatrix4(m), aim = headW.clone().addScaledVector(head, 0.35);
      let pick = 0;
      nectar.forEach((nc, i) => { if (nc.p.distanceTo(aim) < nectar[pick].p.distanceTo(aim)) pick = i; });
      if (FLOWER.petal !== null) pick = FLOWER.petal;
      return { pos, q, m, mi, head, dorsal, feet, contacts, headW, nectar: nectar[pick] };
    })();
    // the meadow around: blades below and behind, other flowers as discs
    const list = [];
    for (let i = 0; i < 2600; i++) {
      const r = 5 + 190 * rng() ** 1.6, a = rng() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      // nothing tall between the flower and the lens's arc (the +z side)
      const front = z > -4 && r < 70 ? sat(1.15 - r / 70) : 0;
      list.push(randomBlade(rng, x, z, { h: Math.min(rng.range(14, 38 + 14 * sat(r / 60)) * (1 - 0.72 * front), r < 34 ? 21 : 99) }));
    }
    g.add(createBlades(list, bladeMat));
    g.add(makeDew(list.filter((b) => Math.hypot(b.x, b.z) < 60), 220, 'fl-dew'));
    const items = [], cols = [lin3(PALETTE.buttercup, 2.2), lin3(PALETTE.clover, 1.6), lin3(PALETTE.daisy, 1.8), lin3(PALETTE.cornflower, 1.3)];
    for (let i = 0; i < 260; i++) { const r = 30 + 420 * rng() ** 1.2, a = rng() * Math.PI * 2, c = cols[Math.floor(rng() * rng() * 4)]; items.push({ p: [Math.cos(a) * r, rng.range(18, 44), Math.sin(a) * r], c: [c.x, c.y, c.z].map((v) => v * rng.range(0.35, 1)), s: rng.range(1.2, 3), ph: rng() }); }
    for (let i = 0; i < 70; i++) items.push({ p: [rng.range(-7, 7), F.y + rng.range(-2, 6), rng.range(-7, 7)], c: [2.2, 1.7, 0.7].map((v) => v * rng.range(0.25, 0.9)), s: rng.range(0.012, 0.03), ph: rng(), tw: 0.3, drift: 0.45 });
    for (let i = 0; i < 90; i++) { const r = 12 + 80 * rng(), a = rng() * Math.PI * 2; items.push({ p: [Math.cos(a) * r, rng.range(8, 36), Math.sin(a) * r], c: [2.4, 2.2, 1.8].map((v) => v * rng.range(0.2, 0.9)), s: rng.range(0.04, 0.1), ph: rng(), tw: 0.7 }); }
    // behind the flower, as the lens draws it: soft ovals of warm light and green
    for (let i = 0; i < 300; i++) {
      const r = 45 + 330 * rng() ** 1.1, a = rng() * Math.PI * 2, warm = rng();
      const c = warm < 0.4 ? [1.0, 0.8, 0.42] : warm < 0.8 ? [0.62, 0.95, 0.36] : warm < 0.93 ? [1.0, 1.0, 0.92] : [1.0, 0.62, 0.78];
      items.push({ p: [Math.cos(a) * r, rng.range(2, 46), Math.sin(a) * r], c: c.map((v) => v * rng.range(0.05, 0.26)), s: -rng.range(0.5, 2.2), ph: rng(), tw: 0.2 });
    }
    const discs = makeDiscs(items); g.add(discs.mesh);
    return { g, F, Fc, flower, axis, discs, PERCH, topAt };
  })();

  // ======================================================================================================
  // STAGE blade (S07, S21, S22): the hero blade in the picture plane z = 0, root at the origin
  const BL = (() => {
    const g = new THREE.Group(); scene.add(g);
    const NS = 48, L = HERO_BLADE.length, RHO = 36 * DEG;
    const geo = track(new THREE.BufferGeometry());
    const pos = new Float32Array((NS + 1) * 3 * 3), nor = new Float32Array((NS + 1) * 3 * 3), uv = new Float32Array((NS + 1) * 3 * 2), aux = new Float32Array((NS + 1) * 3 * 2), idx = [];
    for (let j = 0; j <= NS; j++) for (let i = 0; i < 3; i++) { uv.set([i - 1, j / NS], (j * 3 + i) * 2); aux.set([0.55, 0.45 + 0.55 * sm(0, 0.3, j / NS)], (j * 3 + i) * 2); }
    for (let j = 0; j < NS; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i, b = a + 1, c = a + 3, d = c + 1; idx.push(a, b, c, b, d, c); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('aAux', new THREE.BufferAttribute(aux, 2)); geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new V3(0, L / 2, 0), L * 1.2);
    const mesh = new THREE.Mesh(geo, heroBladeMat); mesh.frustumCulled = false; g.add(mesh);
    const BW = 0.62;                                          // cm: GRASS's blade (story's width is PAPER's stroke ratio)
    const width = (s) => BW * Math.min(1, 2.1 * (1 - s) ** 0.8) * (0.8 + 0.2 * sm(0, 0.2, s));
    // the curve of story.bladePoint; frame(s) -> point, tangent, face normal (rolled toward the lens), binormal
    const frame = (s, defl, rho = RHO) => {
      const [x, y] = bladePoint(s, defl), a = (HERO_BLADE.restAngle - defl * (2 * s - s * s)) * DEG;
      const t = new V3(Math.cos(a), Math.sin(a), 0), n0 = new V3(-Math.sin(a), Math.cos(a), 0);
      const n = n0.clone().multiplyScalar(Math.cos(rho)).add(new V3(0, 0, Math.sin(rho)));
      const b = new V3(0, 0, Math.cos(rho)).addScaledVector(n0, -Math.sin(rho));
      return { p: new V3(x, y, 0), t, n, b };
    };
    // wk, rho: S07 draws it a little broader and turns its face further to the lens (about its midrib, where the feet hold),
    // so that it reads as a blade, not a line, in the medium frame
    const set = (defl, wk = 1, rho = RHO) => {
      for (let j = 0; j <= NS; j++) {
        const s = j / NS, f = frame(s, defl, rho), hw = 0.5 * width(s) * wk;
        for (let i = 0; i < 3; i++) {
          const x = i - 1, k = (j * 3 + i) * 3, fold = (1 - Math.abs(x)) * hw * 0.3;
          pos[k] = f.p.x + f.b.x * x * hw - f.n.x * fold; pos[k + 1] = f.p.y + f.b.y * x * hw - f.n.y * fold; pos[k + 2] = f.p.z + f.b.z * x * hw - f.n.z * fold;
          nor[k] = f.n.x + f.b.x * x * 0.4; nor[k + 1] = f.n.y + f.b.y * x * 0.4; nor[k + 2] = f.n.z + f.b.z * x * 0.4;
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
    };
    set(0);
    // the locked scroll frame of S21 / S22 / S23 (story.HERO_BLADE.root, lengthFrac)
    const H = L / HERO_BLADE.lengthFrac, W = H * aspect, D = distFor(H, 100);
    const cam = new V3((0.5 - HERO_BLADE.root[0]) * W, (0.5 - HERO_BLADE.root[1]) * H, D);
    // dusk: low grass at the blade's foot, soft grass far behind and low in frame, and a far field of discs
    // (flowers on the meadow, the city's lights on the horizon: one mesh, one kind of disc)
    const dusk = new THREE.Group(); g.add(dusk);
    const list = [];
    const farList = [];
    // (the grass at the blade's foot stays near the plane of focus: z -7..4 squeezed to -3.2..2.4)
    for (let i = 0; i < 420; i++) { const x = cam.x + rng.range(-1, 1) * 27; list.push(randomBlade(rng, x, rng.range(-7, 4) * 0.55 + 0.4 * 0.55, { h: rng.range(1.2, 5.2) * (0.55 + 0.45 * rng()), bend: rng.range(0.2, 1.1), w: rng.range(0.3, 0.6) })); }
    for (let i = 0; i < 420; i++) { const z = -70 - 520 * rng() ** 1.3, k = (D - z) / D, x = cam.x + rng.range(-1, 1) * 27 * k; farList.push(randomBlade(rng, x, z, { h: rng.range(3.5, 8.2) * k ** 0.85, bend: rng.range(0.2, 1.0), w: rng.range(0.5, 1.0) * k ** 0.5 })); }
    // (nothing stands between the lens and the blade: a blurred near blade over the discs is a cut-out. The draws are kept
    // so that what follows is laid out as before)
    for (let i = 0; i < 9; i++) { const z = rng.range(18, 80), k = (D - z) / D; randomBlade(rng, cam.x + rng.range(17, 23) * k, z, { h: rng.range(10, 21) * k, bend: rng.range(0.1, 0.5) }); }
    dusk.add(createBlades(list, bladeMat));
    // the far grass is nothing but blur: it is laid far to near and writes no depth, so the discs (drawn sharp after
    // depth of field, tested against the sharp depth) are never cut by its outlines
    farList.sort((a, b) => a.z - b.z);
    const farBlades = createBlades(farList, bladeFarMat); farBlades.renderOrder = -10;
    dusk.add(farBlades);
    const items = [], warm = lin3(PALETTE.bokeh, 1.0), fc = [lin3(PALETTE.buttercup, 0.5), lin3(PALETTE.clover, 0.55), lin3(PALETTE.daisy, 0.5)];
    // flowers: below the horizon, receding
    for (let i = 0; i < 26; i++) {
      const z = -900 - 1700 * rng() ** 1.5, k = (D - z) / D, c = fc[Math.floor(rng() * 3)], b = rng.range(0.12, 0.4);
      items.push({ p: [cam.x + rng.range(-0.56, 0.56) * W * k, cam.y - (0.03 + 0.42 * rng() ** 1.3) * H * k, z], c: [c.x * b, c.y * b, c.z * b], s: rng.range(1.6, 3.2) * k ** 0.45, ph: rng(), tw: 0.15, order: rng() });
    }
    // the city's windows: on and just above the horizon, in clusters (towers)
    for (let i = 0; i < 26; i++) {
      const cx = rng.range(-0.56, 0.56), n = 3 + Math.floor(rng() * 7), hgt = rng.range(0.03, 0.2);
      for (let j = 0; j < n; j++) {
        const z = -2600, k = (D - z) / D, b = rng.range(0.35, 1.1);
        items.push({ p: [cam.x + (cx + rng.range(-0.02, 0.02)) * W * k, cam.y + (0.004 + hgt * rng()) * H * k, z], c: [warm.x * b, warm.y * b, warm.z * b], s: rng.range(5, 10), ph: rng(), tw: 0.2, order: rng() });
      }
    }
    const discs = makeDiscs(items); dusk.add(discs.mesh);
    // morning (S07): the same blade among grass, the lower leaf the drop will strike, dew
    const morn = new THREE.Group(); g.add(morn);
    const list2 = [];
    for (let i = 0; i < 1700; i++) { const z = -7 - 200 * rng() ** 1.5, x = 6 + rng.range(-1, 1) * (22 + 0.4 * -z); list2.push(randomBlade(rng, x, z, { h: rng.range(10, 40) })); }
    for (let i = 0; i < 14; i++) { const sgn = rng.sign(); list2.push(randomBlade(rng, 9 + sgn * (rng.range(9, 14) + 7), rng.range(6, 30), { h: rng.range(14, 28), bend: rng.range(0.1, 0.5) })); }
    morn.add(createBlades(list2, bladeMat));
    morn.add(makeDew(list2.slice(0, 500), 200, 'bl-dew'));
    const items2 = [];
    for (let i = 0; i < 120; i++) { const z = -10 - 150 * rng(); items2.push({ p: [8 + rng.range(-1, 1) * (10 + 0.3 * -z), rng.range(4, 30), z], c: [2.3, 2.1, 1.6].map((v) => v * rng.range(0.2, 1)), s: rng.range(0.04, 0.1), ph: rng(), tw: 0.7 }); }
    const cols = [lin3(PALETTE.buttercup, 2.0), lin3(PALETTE.clover, 1.5), lin3(PALETTE.daisy, 1.7)];
    for (let i = 0; i < 80; i++) { const z = -60 - 500 * rng(), c = cols[Math.floor(rng() * 3)]; items2.push({ p: [8 + rng.range(-1, 1) * (20 + 0.3 * -z), rng.range(6, 40), z], c: [c.x, c.y, c.z].map((v) => v * rng.range(0.3, 1)), s: rng.range(1.5, 3), ph: rng() }); }
    for (let i = 0; i < 220; i++) {
      const z = -45 - 320 * rng() ** 1.1, warm = rng();
      const c = warm < 0.4 ? [1.0, 0.8, 0.42] : warm < 0.85 ? [0.62, 0.95, 0.36] : [1.0, 1.0, 0.92];
      items2.push({ p: [8 + rng.range(-1, 1) * (16 + 0.5 * -z), rng.range(2, 44), z], c: c.map((v) => v * rng.range(0.05, 0.26)), s: -rng.range(0.5, 2.2), ph: rng(), tw: 0.2 });
    }
    for (let i = 0; i < 90; i++) items2.push({ p: [8 + rng.range(-12, 12), rng.range(6, 26), rng.range(-14, 22)], c: [1.0, 0.85, 0.55].map((v) => v * rng.range(0.25, 1.2)), s: rng.range(0.012, 0.035), ph: rng(), tw: 0.35, drift: 0.5 });
    const discs2 = makeDiscs(items2); morn.add(discs2.mesh);
    // the leaf below the tip: a broad blade lying nearly flat
    const lower = new THREE.Mesh(track(surfaceGeometry(12, 16, (a, b) => {
      const w = 1.7 * Math.sin(Math.PI * b ** 0.8) ** 0.7;
      return { p: [(b - 0.5) * 7, 0.25 * Math.sin(b * 3) - 0.12 * a * a * w, a * w], uv: [a, b], tint: 0.5, ao: 1 };
    })), dockMat);
    morn.add(lower);
    const drop = createDrop({ radius: 0.3, segments: 72 });
    morn.add(drop.mesh);
    // the crown of the splash (world space: added to the scene root, shown only by S07)
    const uSplash = { value: new THREE.Vector4(0, 0, 0, -1) };
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', sphere.attributes.position); sg.setIndex(sphere.index);
    const sd = new Float32Array(16 * 4), srng = createRng('splash');
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + srng() * 0.3, up = srng.range(0.55, 1.0); sd.set([Math.cos(a) * (1 - 0.35 * up), up, Math.sin(a) * (1 - 0.35 * up), srng.range(16, 30)], i * 4); }
    sg.setAttribute('aDir', new THREE.InstancedBufferAttribute(sd, 4)); sg.instanceCount = 16;
    const splash = new THREE.Mesh(track(sg), track(new THREE.ShaderMaterial({ name: 'grass-splash', uniforms: { ...lensU, uSplash }, vertexShader: SPLASH_VERT, fragmentShader: LENS_FRAG })));
    splash.frustumCulled = false; splash.visible = false;
    scene.add(splash);
    return { g, mesh, set, frame, H, W, D, cam, dusk, morn, discs, discs2, drop, lower, L, splash, uSplash };
  })();

  // ======================================================================================================
  // STAGE roost (S12, S13): the dock leaf across the top, seven hanging beneath it
  const RO = (() => {
    const g = new THREE.Group(); scene.add(g);
    const HANG = 3.8, HIDDEN = 0.9, H = (HANG - HIDDEN) / SEVEN.length, W = H * aspect, D = distFor(H, 100), EDGE_Y = 40, CY = EDGE_Y - (SEVEN.railY - 0.5) * H, EDGE_Z = 2.5, TILT = 20 * DEG;
    const ATTACH_Y = EDGE_Y + EDGE_Z * Math.tan(TILT);
    // the leaf: long axis across the frame, its near edge the lowest (the rail); a sag, a crisped far margin
    const leafY = (x, z) => EDGE_Y + (EDGE_Z - z) * Math.tan(TILT) - 0.004 * x * x + 0.2 * Math.sin(x * 0.31 + 1) * sm(0, 3, EDGE_Z - z);
    const leaf = new THREE.Mesh(track(surfaceGeometry(24, 60, (a, b) => {
      const x = -17 + 34 * b, half = 5.2 * Math.sin(Math.PI * sat(b * 0.94 + 0.03)) ** 0.5;
      const zz = (EDGE_Z - 2 * half) + (a + 1) * half;                      // far edge .. near edge (the near edge stays on the rail line)
      return { p: [x, leafY(x, zz), zz], uv: [a, b], tint: 0.4 + 0.3 * Math.sin(x * 1.3), ao: 1 };
    })), dockMat);
    g.add(leaf);
    const xs = SEVEN.x.map((sx) => (sx - 0.5) * W);
    const yaw = [72, 79, 68, 77, 66, 80, 70].map((d) => d * DEG);
    // grass below: tips reach into the lower frame; one of them is struck
    const list = [];
    // (nothing reaches the leaf: blades near it stay under 38 cm, and none of them is a stalk)
    for (let i = 0; i < 1500; i++) { const z = -8 - 200 * rng() ** 1.5, x = rng.range(-1, 1) * (14 + 0.4 * -z), nearLeaf = z > -14; list.push(randomBlade(rng, x, z, { h: rng.range(16, nearLeaf ? 36 : 44), stalk: nearLeaf ? false : undefined })); }
    const struck = randomBlade(rng, -3.9, 0.6, { h: 37.4, w: 0.7, bend: 0.5, az: 0.3, stalk: false });
    list.push(struck);
    for (const [x, z, h, bend, az] of [[2.6, -1.5, 36.2, 0.6, 2.6], [5.6, 1.0, 35.2, 0.42, 0.2], [-6.4, -2.2, 37.0, 0.5, 3.0], [-0.6, -3, 35.4, 0.7, 1.2], [7.6, -4, 37.6, 0.5, 2.2]]) list.push(randomBlade(rng, x, z, { h: h - 0.6, bend, az, w: 0.62, stalk: false }));
    g.add(createBlades(list, bladeMat));
    // rain, on a clock of film seconds since 114.0. S12's first drops are scripted; S13's fall all round
    const rs = (t) => (t - SHOT.S12[0]);
    const drops = [];
    const V = 5.2;                                                         // cm per film second: a glass boulder coming down
    const TOP = EDGE_Y + 6, BOT = 30, FRAME_TOP = CY + H / 2;
    const scripted = [[118.5, -3.9, 0.6, 0.3], [120.0, 4.6, 1.4, 0.26], [120.45, -7.2, -3, 0.22], [120.7, 0.9, 5, 0.2]];
    for (const [t0, x, z, r] of scripted) { const v = V * (0.9 + 0.5 * r); drops.push({ x, z, r, v, t0: rs(t0) - (TOP - FRAME_TOP) / v, top: TOP, bottom: BOT }); }
    for (let i = 0; i < 90; i++) {
      const x = rng.range(-16, 16), z = rng.range(-26, 22), r = rng.range(0.2, 0.35), v = V * rng.range(0.85, 1.3);
      if (z < EDGE_Z + 0.4 && z > EDGE_Z - 10.4) continue;                // not through the leaf
      const d = { x, z, r, v, t0: rs(121) - rng.range(0, 6), period: (TOP + 8 - BOT) / v + rng.range(0.4, 3), top: TOP + 8, bottom: BOT };
      if (z >= EDGE_Z + 0.4 && Math.abs(x - (xs[SEVEN.hero] + 1.55 + (z - 2.5) * 0.086)) < 8) continue;   // not across the lens's way into the drop (S13)
      drops.push(d);
    }
    // the one that clips the wing at 122.0
    const clip = { x: xs[SEVEN.hero] - 1.35, z: 0.42, r: 0.27, v: V * 1.1, top: TOP, bottom: BOT };
    clip.t0 = rs(122.0) - (TOP - (ATTACH_Y - 3.25)) / clip.v;
    drops.push(clip);
    const rain = makeRain(drops); g.add(rain);
    const drop = createDrop({ radius: 0.34, segments: 96 });
    g.add(drop.mesh);
    const items = [];
    for (let i = 0; i < 14; i++) { const z = -60 - 300 * rng(); items.push({ p: [rng.range(-1, 1) * (12 + 0.35 * -z), rng.range(12, 30), z], c: [1.4, 1.5, 1.6].map((v) => v * rng.range(0.1, 0.3)), s: rng.range(0.05, 0.12), ph: rng(), tw: 0.6 }); }
    const discs = makeDiscs(items); g.add(discs.mesh);
    // when the first scripted drop reaches the struck blade's tip
    const strikeT = 118.5 + (FRAME_TOP - 37.0) / (V * 1.05);
    return { g, H, W, D, CY, EDGE_Y, EDGE_Z, ATTACH_Y, TILT, xs, yaw, struck, rs, drop, discs, leafY, strikeT };
  })();

  // ======================================================================================================
  // STAGE flight (S05)
  const FT = (() => {
    const g = new THREE.Group(); scene.add(g);
    const T0 = SHOT.S05[0], SPEED = 18;                      // cm per film second: light, not fast
    const rise = (tau) => 58 * sm(6.3, 9.4, tau) ** 1.35 + 9 * sm(8.5, 11.5, tau);
    // the butterfly's path (cm); tau = film seconds since 52.0
    const path = (tau, bob = 1) => new V3(
      SPEED * tau,
      24 + 2.6 * Math.sin(0.62 * tau + 0.4) + 1.0 * Math.sin(1.7 * tau + 1) + rise(tau) + bob * 1.1 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 4 * tau)),
      5.5 * Math.sin(0.6 * tau + 0.5) + 1.6 * Math.sin(1.5 * tau + 2));
    const samples = [];
    for (let tau = -1; tau <= 11.5; tau += 0.08) samples.push(path(tau, 0));
    const near = (x, z) => { let m = 1e9; for (const p of samples) m = Math.min(m, Math.hypot(p.x - x, p.z - z)); return m; };
    const list = [];
    let tries = 0;
    while (list.length < 5200 && tries++ < 60000) {
      const x = rng.range(-50, 215), far = rng() < 0.45, z = far ? rng.range(-1, 1) * 150 : rng.range(-1, 1) * 32 + 5.5 * Math.sin(0.6 * (x / SPEED) + 0.5);
      const d = near(x, z);
      if (d < 7.5) continue;                                             // a clear way for the lens
      const tall = sat(1 - d / 26);
      list.push(randomBlade(rng, x, z, { h: rng.range(26, 46) + 14 * tall * rng(), w: rng.range(0.45, 0.95), bend: rng.range(0.12, 0.8) * (d < 12 ? 0.6 : 1) }));
    }
    g.add(createBlades(list, bladeMat));
    g.add(makeDew(list.filter((b) => Math.abs(b.z) < 34), 520, 'ft-dew', 0.1, 0.3));
    // the lamps: big drops hung from blades close along the way
    g.add(makeDew(list.filter((b) => { const d = near(b.x, b.z); return d > 8.5 && d < 16; }), 150, 'ft-lamps', 0.26, 0.5));
    // fluff in the shafts, glints, flowers on the meadow out to the horizon
    const items = [];
    for (let i = 0; i < 70; i++) { const x = rng.range(0, 210); items.push({ p: [x, rng.range(14, 70), rng.range(-22, 22)], c: [2.6, 2.2, 1.6].map((v) => v * rng.range(0.3, 1)), s: rng.range(0.1, 0.22), ph: rng(), tw: 0.3, drift: 2.2 }); }
    for (let i = 0; i < 260; i++) { const x = rng.range(-20, 200); items.push({ p: [x, rng.range(8, 52), rng.range(-40, 40)], c: [2.4, 2.2, 1.8].map((v) => v * rng.range(0.15, 0.8)), s: rng.range(0.05, 0.12), ph: rng(), tw: 0.8 }); }
    const cols = [lin3(PALETTE.buttercup, 1.5), lin3(PALETTE.clover, 1.1), lin3(PALETTE.daisy, 1.4), lin3(PALETTE.cornflower, 0.9)];
    for (let i = 0; i < 2600; i++) { const r = 80 + 5200 * rng() ** 1.8, a = rng.range(-1.25, 1.25), c = cols[Math.floor(rng() * rng() * 4)]; items.push({ p: [160 + Math.cos(a) * r, rng.range(44, 60), Math.sin(a) * r], c: [c.x, c.y, c.z].map((v) => v * rng.range(0.4, 1)), s: rng.range(2, 4.5), ph: rng() }); }
    for (let i = 0; i < 260; i++) {
      const x = rng.range(-10, 240), warm = rng();
      const c = warm < 0.45 ? [1.0, 0.85, 0.5] : warm < 0.85 ? [0.7, 0.95, 0.4] : [1.0, 1.0, 0.95];
      items.push({ p: [x, rng.range(10, 58), rng.sign() * rng.range(45, 190)], c: c.map((v) => v * rng.range(0.04, 0.2)), s: -rng.range(0.5, 2), ph: rng(), tw: 0.2 });
    }
    const discs = makeDiscs(items); g.add(discs.mesh);
    return { g, T0, SPEED, path, discs };
  })();

  // ---- the walker (S22) --------------------------------------------------------------------------------------
  const shadowU = {
    uLeg: { value: Array.from({ length: LEG_SEGS }, () => new THREE.Vector4()) }, uLegR: { value: Array.from({ length: LEG_SEGS }, () => new THREE.Vector2()) }, uLegN: { value: 0 },
    uWalk: { value: new THREE.Vector4(0.03, 2, 0, 0.14) }, uFall: { value: new THREE.Vector4(2, 0.06, 0, 0.92) }, uCols: { value: new THREE.Vector4(-1, -1, 0, 0) },
    uRes: { value: new THREE.Vector2(2160, 1080) }, uZ: { value: 0 },
    uInk: { value: new V3() }, uLegInk: { value: new V3() }, uBodyInk: { value: new V3() },
  };
  const tri = track(new THREE.BufferGeometry());
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const shadowRes = (r) => { const rt = r.getRenderTarget(); if (rt) shadowU.uRes.value.set(rt.width, rt.height); else r.getDrawingBufferSize(shadowU.uRes.value); };
  const atZ = 'uniform float uZ; void main() { gl_Position = vec4(position.xy, uZ, 1.0); }';
  // the light failing on what is near: at a depth behind the blade's plane, passing only where something nearer stands
  const shadowMesh = new THREE.Mesh(tri, track(new THREE.ShaderMaterial({
    name: 'grass-walker-fall', uniforms: shadowU, vertexShader: atZ, fragmentShader: FALL_FRAG,
    depthTest: true, depthFunc: THREE.GreaterEqualDepth, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })));
  shadowMesh.frustumCulled = false; shadowMesh.renderOrder = 1000; shadowMesh.layers.set(FX_LAYER); shadowMesh.visible = false;
  shadowMesh.onBeforeRender = shadowRes;
  scene.add(shadowMesh);
  // the legs and the body: at the same depth, over whatever lies behind it (the meadow, the glow, the lights)
  const washMesh = new THREE.Mesh(tri, track(new THREE.ShaderMaterial({
    name: 'grass-walker', uniforms: shadowU, vertexShader: atZ, fragmentShader: WALKER_FRAG,
    depthTest: true, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })));
  washMesh.frustumCulled = false; washMesh.renderOrder = 990; washMesh.layers.set(FX_LAYER); washMesh.visible = false;
  washMesh.onBeforeRender = shadowRes;
  scene.add(washMesh);
  // The walk, closed form in t. Heel strikes on the score's footsteps (every 0.58 s from 206.0, the legs alternating).
  // x in frame widths; the hips cross at `v` frame widths a second (about 1.4 m/s at the legs' distance), a little nearer
  // as they go (`sigma`: frame widths per metre); the grass line where the feet go in; the shadow's edge on the ground
  // runs just behind the leading leg; the body closes `close`; `black` = from when the sheet is wholly ink
  // (the feet are planted either side of the butterfly, at about 0.81 and 0.23 across: only a swinging leg passes behind it,
  // briefly)
  const WALK = { t0: 210.5, x0: 1.3, v: 1.0, step: 0.58, strike0: 206.0, sigma: [0.78, 0.92], ground: [0.42, 0.37], shank: 0.46, thigh: 0.46,
    fallLag: 0.08, fallSoft: 0.06, close: [211.95, 213.85], black: [213.0, 213.6], defocus: 0.032 };
  const DEFAULT_SEG = new THREE.Vector4(-9, -9, -9, -9);
  function walker(t, expoComp) {
    const grow = sm(210.3, 212.2, t), sig = mix(WALK.sigma[0], WALK.sigma[1], grow), yg = mix(WALK.ground[0], WALK.ground[1], grow) * 0.5;
    const xb = (tt) => WALK.x0 - WALK.v * (tt - WALK.t0), T = 2 * WALK.step, S = WALK.v * T;
    const bob = 0.022 * sig * Math.cos((2 * Math.PI * (t - WALK.strike0)) / WALK.step);      // the rise and fall of a walk
    const hip = [xb(t), yg + (WALK.shank + WALK.thigh + 0.02) * sig + bob];
    let n = 0;
    const segs = shadowU.uLeg.value, rads = shadowU.uLegR.value, cols = [];
    for (let i = 0; i < 2; i++) {
      const c = (t - WALK.strike0) / T - 0.5 * i, k = Math.floor(c), ph = c - k;
      const land = (kk) => xb(WALK.strike0 + (kk + 0.5 * i) * T) - 0.3 * S;               // the heel comes down ahead of the hips
      let fx = land(k), lift = 0, sw = 0, pitch = 0;
      if (ph >= 0.6) { const u = (ph - 0.6) / 0.4, e = u * u * (3 - 2 * u); sw = Math.sin(Math.PI * u); fx = mix(land(k), land(k + 1), e); lift = 0.1 * sw; pitch = 0.35 * Math.sin(Math.PI * u * 1.3); }
      else pitch = -0.15 * sm(0.35, 0.6, ph);                                               // the heel rises before the toe leaves
      const ankle = [fx, yg + (0.075 + lift) * sig];
      // two-bone leg, the knee forward (screen left, the way they walk), more bent in the swing
      const dx = hip[0] - ankle[0], dy = hip[1] - ankle[1], dl = Math.hypot(dx, dy), L1 = WALK.shank * sig, L2 = WALK.thigh * sig;
      const dd = Math.min(dl, (L1 + L2) * 0.995), along = (dd * dd + L1 * L1 - L2 * L2) / (2 * dd), hh = Math.sqrt(Math.max(0, L1 * L1 - along * along)) + 0.04 * sig * sw;
      // (the perpendicular (-uy, ux) of the line from ankle up to hip points to screen left: the knee goes that way, forward)
      const ux = dx / dl, uy = dy / dl, knee = [ankle[0] + ux * along - uy * hh, ankle[1] + uy * along + ux * hh];
      const calf = [mix(ankle[0], knee[0], 0.35), mix(ankle[1], knee[1], 0.35)];
      const ca = Math.cos(pitch), sa = Math.sin(pitch);
      const toe = [ankle[0] - 0.19 * sig * ca, ankle[1] - (0.05 - 0.19 * sa) * sig], heel = [ankle[0] + 0.05 * sig, ankle[1] - 0.045 * sig];
      const thighEnd = [mix(knee[0], hip[0], 0.8), mix(knee[1], hip[1], 0.8)];
      const add = (a, b, ra, rb) => { segs[n].set(a[0], a[1], b[0], b[1]); rads[n].set(ra * sig, rb * sig); n++; };
      add(toe, heel, 0.028, 0.034); add(heel, ankle, 0.034, 0.038); add(ankle, calf, 0.038, 0.058); add(calf, knee, 0.058, 0.05); add(knee, thighEnd, 0.052, 0.075);
      // where the shank stands at mid frame, for the column of shadow it throws on what is near
      const ym = 0.25, kk = (ym - ankle[1]) / Math.max(1e-4, knee[1] - ankle[1]);
      cols.push([mix(ankle[0], knee[0], Math.min(1, Math.max(0, kk))), 0.05 * sig]);
    }
    for (let i = n; i < LEG_SEGS; i++) { segs[i].copy(DEFAULT_SEG); rads[i].set(0, 0); }
    shadowU.uLegN.value = n;
    const lead = Math.min(cols[0][0], cols[1][0]);
    const closeK = sm(WALK.close[0], WALK.close[1], t);
    shadowU.uWalk.value.set(WALK.defocus * (1 + 0.6 * grow), mix(1.12, -0.45, closeK), closeK, yg);
    shadowU.uFall.value.set(xb(t) < 2 ? Math.max(lead + WALK.fallLag, xb(t) - 0.1) : 2, WALK.fallSoft, 0, 0.93);
    shadowU.uCols.value.set(cols[0][0], cols[1][0], cols[0][1], cols[1][1]);
    // ink: what is in shadow reads black (#0D0C0E); the legs 浓 and blurred; the body ink black
    shadowU.uInk.value.copy(lin3(PALETTE.jiao, 1)).multiplyScalar(expoComp * 0.6);
    shadowU.uLegInk.value.copy(lin3(PALETTE.jiao, 1)).multiplyScalar(expoComp * 1.4);
    shadowU.uBodyInk.value.copy(lin3(PALETTE.jiao, 1)).multiplyScalar(expoComp * 0.6);
    shadowMesh.visible = true; washMesh.visible = true;
  }

  // ---- shafts of low sun through the grass, and the veil of light around it (additive, after depth of field)
  const shaftU = { uSun: { value: new THREE.Vector2(0.5, 0.5) }, uK: { value: new THREE.Vector4(0, 2.2, 0, 0) }, uColor: { value: new V3(1, 0.8, 0.5) }, uRes: { value: new THREE.Vector2(2160, 1080) } };
  const shaftMesh = new THREE.Mesh(tri, track(new THREE.ShaderMaterial({
    name: 'grass-shafts', uniforms: shaftU, vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: NOISE + /* glsl */ `
uniform vec2 uSun; uniform vec4 uK; uniform vec3 uColor; uniform vec2 uRes;   // uK: strength, falloff, slow time, veil
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, p = (uv - uSun) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(p), ang = atan(p.y, p.x);
  float n = 0.55 * snoise(vec2(ang * 2.6, uK.z * 0.05)) + 0.32 * snoise(vec2(ang * 7.0 + 4.0, uK.z * 0.08 + 3.0)) + 0.16 * snoise(vec2(ang * 19.0, 2.0 + uK.z * 0.1));
  float rays = smoothstep(-0.2, 0.8, n) * smoothstep(0.03, 0.3, r) * exp(-r * uK.y);
  float veil = uK.w * exp(-r * r * 5.0);
  gl_FragColor = vec4(uColor * uK.x * (rays + veil), 1.0);
}`,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })));
  shaftMesh.frustumCulled = false; shaftMesh.renderOrder = 900; shaftMesh.layers.set(FX_LAYER); shaftMesh.visible = false;
  shaftMesh.onBeforeRender = (r) => { const rt = r.getRenderTarget(); if (rt) shaftU.uRes.value.set(rt.width, rt.height); else r.getDrawingBufferSize(shaftU.uRes.value); };
  scene.add(shaftMesh);
  const sunV = new V3();
  /** Shafts from where the sun stands on screen (it may be off-frame). strength 0 hides them. */
  const shafts = (L, strength, t, falloff = 2.2, veil = 0.35) => {
    shaftMesh.visible = strength > 0;
    if (!shaftMesh.visible) return;
    sunV.copy(camera.position).addScaledVector(L.sunDir, 1000).project(camera);
    const behind = L.sunDir.dot(camera.getWorldDirection(tmp)) < 0.05;
    shaftU.uSun.value.set(sunV.x * 0.5 + 0.5, sunV.y * 0.5 + 0.5);
    shaftU.uK.value.set(behind ? 0 : strength, falloff, t * SLOW, veil);
    shaftU.uColor.value.copy(L.sunCol).multiplyScalar(0.2);
  };

  // ======================================================================================================
  // Light states
  const setLight = (o) => {
    E.uSunDir.value.copy(o.sunDir).normalize(); E.uSunCol.value.copy(o.sunCol);
    E.uAmbTop.value.copy(o.ambTop); E.uAmbBot.value.copy(o.ambBot);
    E.uSkyLow.value.copy(o.skyLow); E.uSkyHigh.value.copy(o.skyHigh);
    E.uGroundA.value.copy(o.groundA); E.uGroundB.value.copy(o.groundB); E.uHaze.value.copy(o.haze);
    E.uEnvP.value.set(o.ink || 0, o.time || 0, o.sunSize ?? 0.012, o.wet || 0);
    E.uEnvQ.value.set(o.sunDisc ?? 40, o.flowers ?? 0.5, o.eye ?? 30, o.aureole ?? 1);
    E.uFog.value.set(o.fog ?? 0.003, o.fogStart ?? 30, o.skyScale ?? 0.55);
    E.uCanopy.value.set(o.canopy ?? 16, o.canopySoft ?? 24);
    bgU.uHill.value = o.hill ?? 1;
  };
  const LIGHT = {
    dawn: () => ({
      sunCol: lin3(PALETTE.sun, 5.2), ambTop: lin3(PALETTE.dawnSkyHigh, 0.75), ambBot: new V3(0.1, 0.13, 0.04),
      skyLow: lin3(PALETTE.dawnSkyLow, 1.05), skyHigh: lin3(PALETTE.dawnSkyHigh, 1.1), groundA: grassShadow.clone().multiplyScalar(0.55), groundB: grassLit.clone().multiplyScalar(0.3), haze: lin3(PALETTE.dawnSkyLow, 0.75).lerp(grassLit, 0.25),
    }),
    morning: () => ({
      sunCol: lin3(PALETTE.sun, 5.6), ambTop: lin3(PALETTE.dawnSkyHigh, 1.05), ambBot: new V3(0.12, 0.17, 0.05),
      skyLow: lin3(PALETTE.dawnSkyLow, 1.7).lerp(lin3(PALETTE.dawnSkyHigh, 1.5), 0.45), skyHigh: lin3(PALETTE.dawnSkyHigh, 1.45), groundA: grassShadow.clone().multiplyScalar(0.6), groundB: grassLit.clone().multiplyScalar(0.36), haze: lin3(PALETTE.dawnSkyLow, 0.6).lerp(lin3(PALETTE.dawnSkyHigh, 0.7), 0.4).lerp(grassLit, 0.2),
    }),
    rain: () => ({
      sunCol: lin3(PALETTE.rainSky, 1.1), ambTop: lin3(PALETTE.rainSky, 0.9), ambBot: new V3(0.05, 0.07, 0.04),
      skyLow: lin3(PALETTE.rainSky, 1.35), skyHigh: lin3(PALETTE.rainSky, 1.1), groundA: lin3(PALETTE.wetLeaf, 0.35), groundB: lin3(PALETTE.wetLeaf, 0.8), haze: lin3(PALETTE.rainSky, 0.95),
    }),
    dusk: () => ({
      sunCol: lin3(PALETTE.duskHorizon, 1.6), ambTop: lin3(PALETTE.duskSky, 1.5), ambBot: new V3(0.03, 0.04, 0.03),
      skyLow: lin3(PALETTE.duskHorizon, 0.75), skyHigh: lin3(PALETTE.duskSky, 0.95), groundA: lin3(PALETTE.duskGrass, 0.12), groundB: lin3(PALETTE.duskGrass, 0.3), haze: lin3(PALETTE.duskSky, 0.5).lerp(lin3(PALETTE.duskHorizon, 0.4), 0.25),
    }),
  };
  const groups = [EM.g, FL.g, BL.g, RO.g, FT.g];
  const show = (g) => { for (const x of groups) x.visible = x === g; for (const b of others) b.group.visible = false; hero.group.visible = false; shadowMesh.visible = false; washMesh.visible = false; shaftMesh.visible = false; BL.splash.visible = false; if (g === RO.g) for (const c of RO.g.children) c.visible = true; };
  const setCam = (pos, target, mm, roll = 0, near = 0.3) => {
    camera.position.copy(pos); camera.up.set(0, 1, 0); camera.lookAt(target);
    if (roll) camera.rotateZ(roll);
    camera.fov = vfov(mm) / DEG; camera.near = near; camera.far = 9000;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  };
  const heroLight = (o, extra = {}) => ({ lightDir: o.sunDir.toArray(), lightColor: o.sunCol.toArray(), ambient: o.ambTop.clone().multiplyScalar(0.8).toArray(), ...extra });
  const BASE_POST = { bloom: 0.07, bloomScatter: 0.7, halation: 0.14, saturation: 1.12, contrast: 1.1, vignette: 0.34, chromaticAberration: 0.6 };
  const tmp = new V3(), tmp2 = new V3(), invM = new THREE.Matrix4();

  // ---- S12 / S13 shared ---------------------------------------------------------------------------------
  function roostLight(t, inkc) {
    const L = LIGHT.rain();
    const dark = sat(inkc);
    L.sunDir = new V3(-0.25, 0.9, 0.35).normalize();
    L.sunCol.multiplyScalar(mix(1.7, 0.9, dark)); L.ambTop.multiplyScalar(mix(1.4, 0.95, dark)); L.skyLow.multiplyScalar(mix(1.5, 1.2, dark)); L.skyHigh.multiplyScalar(mix(1.5, 1.15, dark));
    L.fog = 0.002; L.fogStart = RO.D + 10;
    L.ink = inkc; L.time = t * SLOW * 0.5; L.wet = sm(118, 123, t); L.sunDisc = 0; L.aureole = 0.25; L.flowers = 0.25; L.eye = RO.CY;
    return L;
  }
  // seven under the leaf: positions and one sway from story.js; ours is SEVEN.hero (hero LOD), wings shut
  // how far under the leaf a butterfly must hang for none of its six feet (lib/butterfly.js LEGS) to come up through it
  const FEET = [[0.7, 1.12], [1.0, 0.32], [0.78, -0.88]].flatMap(([x, z]) => [[x, z], [-x, z]]);
  const hangOf = (x0, head, down) => {
    const X = new V3().crossVectors(down, head).normalize(), Y = new V3().crossVectors(head, X);
    let need = 0;
    for (const [fx, fz] of FEET) {
      const fy = RO.leafY(x0, 0) + (X.y * fx + head.y * fz) + (Y.y * FEET_Y - down.y * FEET_Y), px = x0 + X.x * fx + head.x * fz + (Y.x - down.x) * FEET_Y, pz = X.z * fx + head.z * fz + (Y.z - down.z) * FEET_Y;
      need = Math.max(need, fy - RO.leafY(px, pz));
    }
    return need + 0.05;
  };
  // (all seven hang at least as low as the one that needs it most at rest, so the row stays level)
  const hang0 = Math.max(...RO.xs.map((x, i) => hangOf(x, new V3(-Math.cos(RO.yaw[i]), 0, Math.sin(RO.yaw[i])), new V3(0, -1, 0))));
  function roost(t, L, clamp, heroOpen, heroHead = null) {
    const { ATTACH_Y, xs, yaw } = RO;
    let oi = 0;
    for (let i = 0; i < 7; i++) {
      const b = i === SEVEN.hero ? hero : others[oi++];
      const a = sway(t, i) * DEG * (i === SEVEN.hero ? 1 - 0.5 * clamp : 1);
      // they hang plumb under the leaf (which slopes toward the lens: we see its upper face, so they hang low enough
      // that no foot comes up through it);
      // positive sway: the lower end swings to screen right, about the hanging point
      const zAxis = new V3(0, 0, 1);
      const down = new V3(0, -1, 0).applyAxisAngle(zAxis, a);
      const hd = i === SEVEN.hero && heroHead ? heroHead : new V3(-Math.cos(yaw[i]), 0, Math.sin(yaw[i]));   // they face screen left
      const head = hd.clone().applyAxisAngle(zAxis, a).normalize();
      const pos = new V3(xs[i], RO.leafY(xs[i], 0) - Math.max(hang0, hangOf(xs[i], head, down)), 0).addScaledVector(down, -FEET_Y);
      placeButterfly(b, pos, head, down);
      b.set(heroLight(L, { open: i === SEVEN.hero ? heroOpen : 0.004, flap: null, crumple: 0, wear: 0, barePatch: i === SEVEN.hero ? 1 : 0, ambient: L.ambTop.clone().multiplyScalar(0.9).toArray(), sheenFill: i === SEVEN.hero ? 0.6 : 0.0 }));
      b.update(t * SLOW + i);
    }
  }
  // ink pools on the seven (four pools: three pairs and ours)
  function roostPools(k) {
    if (k <= 0.01) return [];
    const { H, CY, ATTACH_Y } = RO, y = 0.5 + (ATTACH_Y - 2.3 - CY) / H;
    const at = (i0, i1, r) => ({ x: (SEVEN.x[i0] + SEVEN.x[i1]) / 2, y, r, soft: 0.035, amount: mix(LOOK.S12.ink[1], 0.9, k), chroma: mix(0.8, 0.25, k), rim: 0.45 * k });
    return [at(0, 1, 0.085), at(2, 3, 0.085), at(5, 6, 0.085), at(4, 4, 0.05)];
  }

  // ---- S21 / S22: the locked scroll frame at dusk --------------------------------------------------------
  function dusk(t, p) {
    show(BL.g); BL.dusk.visible = true; BL.morn.visible = false;
    BL.g.rotation.y = 0; BL.g.updateMatrixWorld(true);
    const { D, cam } = BL;
    setCam(cam, tmp2.set(cam.x, cam.y, 0), 100);
    const T_LAND = p.alight ?? 193.5, sb = 0.85, bow = bladeBow(HERO_BLADE.load);
    // the landing: the blade bows under it and bounces twice
    const tl = t - T_LAND;
    const defl = tl < 0 ? 0.4 * Math.sin(t * 1.1) : bow * (1 - Math.exp(-tl * 2.3) * Math.cos(tl * 7.4)) + 0.25 * Math.sin(t * 0.9) * sm(2, 4, tl);
    BL.set(defl);
    const dim = sm(202, 212, t);                         // the last light goes
    // (S22: as the walker comes between us and the afterglow the light fails a little more, so that nothing brightens
    // again once the legs have gone by)
    const expo = mix(0.2, -0.2, dim) - (p.shadow ? 0.6 * sm(211.2, 212.4, t) : 0);
    const L = LIGHT.dusk();
    L.sunDir = new V3(0.22, 0.09, -0.97).normalize();       // the afterglow: low, behind, a little to the right
    L.sunCol = lin3(PALETTE.duskHorizon, 1.15).multiplyScalar(mix(1, 0.5, dim));
    L.ambTop.multiplyScalar(mix(1, 0.55, dim)); L.skyLow.multiplyScalar(mix(1, 0.58, dim)); L.skyHigh.multiplyScalar(mix(1, 0.6, dim)); L.groundB.multiplyScalar(mix(1, 0.65, dim));
    L.sunDisc = 0; L.aureole = 0.5; L.time = t * SLOW; L.flowers = 0.25; L.eye = cam.y; L.sunSize = 0.01;
    L.fog = 0.0016; L.fogStart = D + 20; L.skyScale = 0.072; L.canopy = 2; L.canopySoft = 8; L.hill = 0;
    L.haze = lin3(PALETTE.duskSky, 0.6).lerp(lin3(PALETTE.duskHorizon, 0.5), 0.3).multiplyScalar(mix(1, 0.5, dim));
    setLight(L);
    heroBladeMat.uniforms.uDim.value = 1.0;
    uWind.value.set(0.09, t * SLOW, 0.4, 0);
    // the butterfly: down from the upper left, onto the blade at REST_POINT; then the wing-breaths, slowing, then none
    const f = BL.frame(sb, defl), perch = f.p.clone().addScaledVector(f.n, -FEET_Y);
    const k = sm(SHOT.S21[0] - 0.4, T_LAND, t), away = (1 - k) ** 1.5;
    const pos = perch.clone().add(new V3(-5.5 * away - 1.5 * Math.sin(away * 5) * away, 17 * away, 1.5 * away));
    pos.y += 0.5 * away * Math.sin(t * 25);
    placeButterfly(hero, pos, f.t.clone().lerp(new V3(0.9, -0.4, 0), away * 0.8).normalize(), f.n.clone().lerp(new V3(0, 1, 0), away * 0.7).normalize());
    const open = t < T_LAND ? 0.6 : Math.max(breath(t), 0.6 * (1 - sm(T_LAND, T_LAND + 0.25, t)));
    hero.set({ lightDir: [0.3, 0.75, 0.2], lightColor: lin3(PALETTE.duskSky, 2.2).multiplyScalar(mix(1, 0.5, dim)).toArray(), open, flap: t < T_LAND ? 4 * (t - 192) + 0.1 : null, crumple: 0, wear: p.wear ?? 1, notch: 1, barePatch: 1, proboscis: 0, ambient: L.ambTop.clone().multiplyScalar(1.15).toArray(), sheenFill: 1.2 });
    hero.update(t * SLOW);
    // the discs behind go out from the right as the walker comes between (209.0 on)
    BL.discs.uniforms.uBk.value.set(t * SLOW, mix(1, 0.75, dim), sm(209.0, 212.2, t), aspect);
    // behind it all, FIELD itself at dusk (S20's meadow, valley and city: the plate and its own light discs, drawn sharp
    // after the depth of field); our own sky and discs stand in only if the plate cannot be had
    BL.discs.mesh.visible = !plate || !!p.noPlate;
    stage._plate = { sunElevation: mix(-2, -5, dim), sunAzimuth: -12, cloudCover: 0.2, cityLights: 1, defocus: 1, heading: 14, lightsOut: sm(209.0, 212.2, t), inkCloud: 0, flowers: 1, eye: 0.9, exposure: 0, discs: 0.45, discLayer: true, grade: { exposure: mix(0.2, -0.2, dim), contrast: 1.04, saturation: 1.1 } };   // (not expo: the plate is to dim with the failing light)
    // the butterfly's ink: while its wings are shut it is an ink butterfly on an ink stroke
    const pools = [];
    const shut = 1 - sat(open * 4);
    const hs = perch.clone().add(new V3(0.1, 1.5, 0)).project(camera), hx = hs.x * 0.5 + 0.5, hy = hs.y * 0.5 + 0.5;
    if (t >= T_LAND && shut > 0.02) pools.push({ x: hx, y: hy, r: 0.04, soft: 0.022, amount: mix(LOOK.S21.ink, 1, shut), chroma: mix(LOOK.S21.chroma, 0.1, shut), rim: 0.5 * shut });
    // the walker (S22): footsteps from 206; the lights at the right go out from 209; the legs come by from 210.6, the
    // light on the grass, the blade and the butterfly failing from the right behind the leading leg (by 211.3 it is an
    // ink butterfly on an ink stroke against the last of the dusk); from 212.35 the body closes over everything, and
    // the sheet goes wholly to ink (a frame-filling pool, the vignette lifted) so that it comes down onto ink black
    // itself, #0D0C0E, never below it, which the fade to black from 213.5 then holds
    // (the pool rides just behind the body's edge as it closes, so that the dark is ink black itself where it lies, never
    // below it, and the dusk still showing beside it is untouched)
    const inkOut = p.shadow ? sm(WALK.black[0], WALK.black[1], t) : 0;
    const closeK = p.shadow ? sm(WALK.close[0], WALK.close[1], t) : 0;
    if (closeK > 0) { const ex = mix(1.12, -0.45, closeK); pools.push({ x: ex + 1.16, y: 0.5, r: 1.0, soft: 0.24, amount: 1, chroma: 0, rim: 0 }); }
    if (p.shadow && t > WALK.t0 - 0.4) {
      walker(t, Math.pow(2, -expo));
      shadowU.uZ.value = tmp.set(cam.x, cam.y, -9).project(camera).z;
    }
    return {
      dof: { focus: D, aperture: 5.5, maxBlur: 34 }, exposure: expo, ...BASE_POST, bloom: 0.11, halation: 0.2, saturation: 1.1, contrast: 1.04, vignette: mix(0.42, 0, Math.max(inkOut, sm(0.35, 0.8, closeK))),
      ink: { pools: pools.slice(0, 4) },
    };
  }

  // ======================================================================================================
  // The shots
  const stage = {
    // ---------------------------------------------------------------------------------------------- S04b
    S04b(t, p) {
      show(EM.g);
      const { D, STEM_Y, CY, R } = EM;
      // from 46 the lock eases into a float: 2 mm of drift, a slow sink and a step back so that the hanging wings fit
      const fl = sm(46, 51, t), drift = sm(45.5, 47, t);
      const cy = CY - 1.75 * fl + 0.1 * drift * Math.sin(t * 0.9), cx = 0.1 * drift * Math.sin(t * 0.7 + 1) + 0.85 * fl, d = D * (1 + 0.2 * fl);
      setCam(tmp.set(cx, cy, d), tmp2.set(cx, cy, 0), 100);
      const L = LIGHT.dawn();
      L.sunDir = EM.sunDir.clone(); L.sunSize = Math.atan(DESK_FRAME.lampR * EM.W / D); L.sunDisc = 34; L.eye = cy; L.time = t * SLOW; L.aureole = 0.6; L.flowers = 0.3;
      L.fog = 0.0065; L.fogStart = D + 6; L.skyScale = 0.11; L.canopy = 15; L.canopySoft = 16;
      setLight(L);
      shafts(L, 0.6, t, 2.2, 0.28);
      uWind.value.set(0.12, t * SLOW, 0.4, 0);
      // the pupa breathes with the sleeper until it splits (the next inhale: 44.0)
      const b = t < 44 ? breath(t) : breath(44) * (1 - sm(44, 45.2, t));
      const outline = sleeperOutline(b).map(EM.toWorld);
      pupaOutline(outline).forEach(([x, y], i) => EM.pupaU.uPts.value[i].set(x, y));
      // the seam: from just behind the hump (18) down the slope of the head end, a little inside the outline
      [[17, 0, -0.07], [21, -0.035, -0.075], [27, -0.05, -0.085]].forEach(([i, dx, dy], k) => EM.pupaU.uSeam.value[k].set(outline[i][0] + dx, outline[i][1] + dy));
      const split = p.pupaSplit ?? sm(44, 44.6, t), out = sm(44.4, 47.3, t);
      EM.pupaU.uPupa.value.set(split, sm(45.8, 47.6, t), STEM_Y, 0.007 + 0.085 * sm(44.3, 45.6, t));
      // the butterfly: out of the head end against the sun and straight over the side of the stem, so that it is
      // never standing: it pours out and hangs. Until the wings fill it is ink against the light
      if (t >= 44.3) {
        // inside the case it lies along it, its back to the lens (so nothing of it stands above the outline); as it
        // comes out of the head end it goes over the near side of the stem and down, turning until it hangs
        const x = mix(-0.4, 2.45, Math.pow(out, 0.9)), c = sm(0.38, 1.0, out), th = mix(90, 150, c) * DEG;
        const axisY = STEM_Y - R - 0.0016 * x * x, rr = 0.45 + R;
        const inside = new V3(x, STEM_Y + mix(0.24, 0.12, sm(0.2, 0.5, out)), -1.7);
        const round = new V3(x, axisY + Math.cos(th) * rr, 0.05 + Math.sin(th) * rr);
        const pos = inside.lerp(round, sm(0.38, 0.9, out));
        pos.y += 0.03 * Math.sin(t * 7) * (1 - c) * out;
        const dorsal = new V3(0, Math.cos(th), Math.sin(th));
        const head = new V3(1, 0.1 * c - 0.3 * Math.sin(Math.PI * sm(0.3, 0.9, out)), 0).normalize();
        placeButterfly(hero, pos, head, dorsal, mix(0.72, 1, sm(45.2, 48.6, t)));
        const fill = sm(47.7, 51.0, t), lit = sm(47.4, 50.2, t);
        const open = (p.firstOpen ? sm(p.firstOpen[0], p.firstOpen[1], t) : sm(51, 52, t)) * 0.58 + 0.04 * fill;
        hero.set(heroLight(L, { open, flap: null, crumple: 1 - fill ** 0.85, wear: 0, notch: 0, barePatch: 1, proboscis: 0, lightColor: L.sunCol.clone().multiplyScalar(mix(0.16, 1, lit)).toArray(), ambient: L.ambTop.clone().multiplyScalar(mix(0.04, 0.9, sm(47.6, 50.5, t))).toArray(), sheenFill: 1 }));
        hero.update(t * SLOW);
      }
      EM.discs.uniforms.uBk.value.set(t * SLOW, 1, 0, aspect);
      // exposed for the sun until the wings have filled
      return { dof: { focus: d, aperture: 2.6, maxBlur: 32 }, exposure: mix(-1.75, -0.95, sm(47.4, 50.4, t)), ...BASE_POST, bloom: 0.12, halation: 0.24, vignette: 0.36 };
    },
    // ---------------------------------------------------------------------------------------------- S05
    S05(t) {
      show(FT.g);
      const tau = t - FT.T0;
      const B = FT.path(tau), Bn = FT.path(tau + 0.05, 0), Bp = FT.path(tau - 0.05, 0);
      const head = Bn.clone().sub(Bp).normalize();
      // the lens: 18 cm behind (where the butterfly was a second ago) and a little below, without the bob; at 60.0 it
      // tilts up over the grass tops
      const lag = 18 / FT.SPEED, C = FT.path(tau - lag, 0);
      const up = sm(7.6, 10.5, tau);
      C.y += -1.4 + (B.y - C.y - 0.6) * up; C.z *= 0.8;
      this._plate = { sunElevation: 16, sunAzimuth: -12, cloudCover: 0.2, cityLights: 0, defocus: mix(1, 0.35, sm(7.8, 10, tau)), lightsOut: 0, heading: -78, inkCloud: 0, flowers: 1, eye: 0.9, exposure: 1.1 };
      const look = FT.path(tau + 0.25, 0.35); look.y = mix(look.y + 2.0, C.y + 0.4, up); look.x += 30 * up; look.z = mix(look.z, look.z - 7, up);
      setCam(C, look, 24, 0.022 * Math.sin(tau * 0.9) * (1 - up), 0.6);
      this._veil = 0.92;
      const L = LIGHT.dawn();
      const el = 11 * DEG, az = 24 * DEG;
      L.sunDir = new V3(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az));
      L.sunCol = lin3(PALETTE.sun, 5.4); L.skyHigh = lin3(PALETTE.dawnSkyHigh, 1.45); L.ambTop = lin3(PALETTE.dawnSkyHigh, 1.0);
      L.sunSize = 0.012; L.sunDisc = 60; L.eye = Math.max(20, C.y); L.time = t * SLOW; L.flowers = 0.8; L.aureole = 1.2;
      L.haze = lin3(PALETTE.dawnSkyHigh, 0.9).lerp(lin3(PALETTE.dawnSkyLow, 0.9), 0.45); L.fog = 0.0045; L.fogStart = 26; L.canopy = 24; L.canopySoft = 30;
      setLight(L);
      shafts(L, 0.6 * (1 - 0.6 * up), t, 1.6, 0.4);
      uWind.value.set(0.2, t * SLOW, 0.5, 9);
      const bank = 0.35 * Math.sin(0.6 * tau + 0.5 + 1.2);
      const dorsal = new V3(0, 1, 0).addScaledVector(new V3().crossVectors(head, new V3(0, 1, 0)), bank).addScaledVector(head, -0.85).normalize();
      head.addScaledVector(new V3(0, 1, 0), 0.62).normalize();          // it flies nose-up, as they do
      placeButterfly(hero, B, head, dorsal);
      hero.set(heroLight(L, { open: 0.62, flap: 4 * tau + 0.25, crumple: 0, wear: 0, notch: 0, barePatch: 1, proboscis: 0, sheenFill: 1 }));
      hero.update(t);
      // two others cross the corridor
      [[2.6, 1, 0.3], [5.9, -1, 0.7]].forEach(([tc, dirz, ph], i) => {
        const o = others[i], k = tau - tc, c = FT.path(tc + 0.9, 0);
        const pos = new V3(c.x + 6 * k + 22, c.y + 6 + 2.5 * Math.sin(k * 3 + ph * 6) + 1.2 * Math.abs(Math.sin(Math.PI * 5 * tau + ph)), c.z + dirz * (-24 * k));
        if (Math.abs(k) < 3.2) {                                     // (they come and go far out at the sides, behind the grass)
          placeButterfly(o, pos, new V3(0.26, 0.08 * Math.cos(k * 3), -dirz).normalize(), new V3(0, 1, 0.2 * dirz));
          o.set(heroLight(L, { open: 0.6, flap: 5 * tau + ph, crumple: 0 }));
        }
      });
      FT.discs.uniforms.uBk.value.set(t * SLOW, 1, 0, aspect);
      const fd = C.distanceTo(B);
      return { dof: { focus: mix(fd, 900, sm(8.2, 10.5, tau)), aperture: mix(1.0, 0.3, sm(8.0, 10.5, tau)), maxBlur: 18 }, exposure: -0.7, ...BASE_POST, bloom: 0.11, halation: 0.2 };
    },
    // ---------------------------------------------------------------------------------------------- S06
    S06(t, p) {
      show(FL.g);
      const lt = (t - SHOT.S06[0]) / 10, Fc = FL.Fc, P = FL.PERCH;
      // the sun low behind the flower and the butterfly; the orbit starts in its front quarter, looking a little into
      // the sun, and swings 40 degrees round toward its side, rising a little: the open wing sits in its lobe at 65
      // (cyan-blue), leaves through violet by 69, and at 73 is black. The flower's cup, the head over it and the
      // tongue down into it stay in view in front of the near forewing all the way round
      const el = (p.sunElevation ?? 14) * DEG, az0 = CAM6.az0, sunAz = (az0 + CAM6.sunAz) * DEG;
      const L = LIGHT.morning();
      L.sunDir = new V3(Math.cos(el) * Math.cos(sunAz), Math.sin(el), Math.cos(el) * Math.sin(sunAz));
      const orb = 0.5 - 0.5 * Math.cos(Math.PI * sat(lt * 1.02));
      const camAz = (az0 + 40 * orb) * DEG, camEl = mix(CAM6.el[0], CAM6.el[1], sm(0.1, 0.9, lt)) * DEG, dist = mix(CAM6.dist[0], CAM6.dist[1], sm(0, 1, lt));
      // (late in the orbit the near wing swings toward the lens: the frame slides a little toward the flower's far side,
      // so that the wing keeps to about a third of the frame and the flower, the head and the tongue stay the subject)
      const aimAt = Fc.clone().lerp(P.headW, CAM6.aim).add(new V3(0, CAM6.aimY, 0))
        .addScaledVector(new V3(Math.sin(camAz), 0, -Math.cos(camAz)), CAM6.side * sm(0.25, 0.85, lt));
      const C = new V3(aimAt.x + dist * Math.cos(camEl) * Math.cos(camAz), aimAt.y + dist * Math.sin(camEl), aimAt.z + dist * Math.cos(camEl) * Math.sin(camAz));
      setCam(C, aimAt, 100);
      L.sunSize = 0.012; L.eye = C.y; L.time = t * SLOW; L.flowers = 1;
      L.fog = 0.0045; L.fogStart = dist + 8; L.canopy = 17; L.canopySoft = 22;
      setLight(L);
      shafts(L, 0.0, t);
      uWind.value.set(0.1, t * SLOW, 0.5, 0);
      // it glides down onto the flower at 63.5 on wings held open, with one slow stroke to settle (no fast beats this
      // close to the lens: under the shutter they are eight outlines, not a smear); the feet reach for the petals and
      // stand; then the wings breathe: open at 65, 69, 73
      const land = p.land ?? 63.5, k = sm(land - 0.7, land, t), settled = sm(land, land + 0.5, t), touch = sm(land - 0.25, land + 0.12, t);
      const level = basisQuat(new V3(P.head.x, 0, P.head.z).normalize(), new V3(0, 1, 0));
      const q = level.clone().slerp(P.q, sm(land - 0.4, land + 0.3, t));
      const side = new V3(-P.head.z, 0, P.head.x).normalize();
      const pos = P.pos.clone().addScaledVector(new V3(P.head.x, 0, P.head.z).normalize(), -3.2 * (1 - k) ** 1.6).addScaledVector(side, -1.5 * (1 - k) ** 1.6).add(new V3(0, 4.2 * (1 - k) ** 1.6, 0));
      const stroke = Math.cos(2 * Math.PI * 1.5 * (t - land));                 // 1.5 Hz: down at the touch
      pos.y += 0.12 * (1 - k) * stroke;
      hero.group.position.copy(pos); hero.group.quaternion.copy(q); hero.group.scale.setScalar(1); hero.group.visible = true;
      hero.group.updateMatrixWorld(true);
      // the feet: from hanging to their holds on the petals; the tongue: its target is the nectary at the base of one
      // petal, just outside the stamens, and while it drinks the tip probes a millimetre or two about it
      const feet = P.feet.map((f, i) => { const r = FEET_REST[i]; return [mix(r[0], f[0], touch), mix(r[1], f[1], touch), mix(r[2], f[2], touch), mix(0, f[3], touch), mix(1, f[4], touch), mix(0, f[5], touch)]; });
      const tp = t - 68.0, probe = sm(67.85, 68.6, t);
      const nw = P.nectar.p.clone()
        .addScaledVector(P.nectar.lat, 0.07 * probe * (Math.sin(2 * Math.PI * 0.43 * tp) + 0.35 * Math.sin(2 * Math.PI * 1.13 * tp + 1.0)))
        .addScaledVector(P.nectar.along, 0.05 * probe * Math.sin(2 * Math.PI * 0.71 * tp + 0.6))
        .addScaledVector(P.nectar.n, 0.03 * probe * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.97 * tp + 2.1)));
      const target = nw.applyMatrix4(P.mi).toArray();
      // BREATH opens them (peaks 65, 69, 73); they linger open, and never quite shut in the sun
      const br = 0.1 + CAM6.open * sm(0.05, 0.8, breath(t));
      hero.set(heroLight(L, {
        open: mix(0.72 - 0.15 * stroke, br, settled), flap: null, crumple: 0, wear: 0, notch: 0, barePatch: 1, feet, proboscisTarget: target, antennaLift: mix(0.2, 0.72, settled),
        proboscis: p.proboscis ?? sm(66, 68, t), ambient: L.ambTop.clone().multiplyScalar(0.8).toArray(),
        // the blue travels with the orbit: cyan in the sun's lobe, blue, violet, a deep indigo at the darkest (about 71)
        // where only the meadow's own light reaches the scales, and back toward blue as the wings open full at 73
        sheenFill: CAM6.sheen[0] - (CAM6.sheen[0] - CAM6.sheen[1]) * Math.exp(-(((t - CAM6.sheenDip) / 1.2) ** 2)) * sm(63.5, 67.5, t), fill: CAM6.fill, lobe: CAM6.lobe,
      }));
      hero.update(t * SLOW);
      // what stands over the flower shades it: the body (thorax, head, abdomen) and, once down, the six feet
      const occ = flowerU.uOcc.value, M = hero.group.matrixWorld;
      [[0, 0, 0, 0.42], [0, -0.05, 0.9, 0.24], [0, -0.05, -0.8, 0.32]].forEach(([x, y, z, r], i) => occ[i].set(...new V3(x, y, z).applyMatrix4(M).toArray(), r * (0.35 + 0.65 * touch)));
      P.contacts.forEach((c, i) => occ[3 + i].set(c.p.x, c.p.y, c.p.z, 0.055 * touch));
      occ[9].set(0, 0, 0, 0);
      flowerU.uFlower.value.set(CAM6.lacquer, CAM6.glow, CAM6.albedo, 0);
      FL.discs.uniforms.uBk.value.set(t * SLOW, 1, 0, aspect);
      this._plate = { sunElevation: 14, sunAzimuth: -12, cloudCover: 0.2, cityLights: 0, defocus: 1, lightsOut: 0, heading: -16, inkCloud: 0, flowers: 1, eye: 0.9, exposure: 0.8 };
      // focus between the head and the nectary: the face, the tongue and the stamens it reaches between
      const fp = P.headW.clone().lerp(P.nectar.p, 0.5);
      return { dof: { focus: C.distanceTo(fp), aperture: CAM6.aperture, maxBlur: 30 }, exposure: -0.62, ...BASE_POST, bloom: 0.1, halation: 0.2 };
    },
    // ---------------------------------------------------------------------------------------------- S07
    S07(t, p) {
      show(BL.g); BL.dusk.visible = false; BL.morn.visible = true;
      heroBladeMat.uniforms.uDim.value = 1.25;
      BL.g.rotation.y = -15 * DEG;                       // the tip a little toward the lens: something to rack focus across
      BL.g.updateMatrixWorld(true);
      invM.copy(BL.g.matrixWorld).invert();
      // PORTAL FIRST: the ink city, hanging in the dew
      let portal = null;
      if (p.portal && !p.impression) portal = ctx.engine.portal(p.portal.shot, p.portal.t, { scale: 0.5 });
      const T_REL = S07_SPRING.t0, sb = 0.8;
      const defl = t < T_REL ? bladeBow(HERO_BLADE.load) + 0.5 * Math.sin(t * 1.3) : bladeSpring(t, T_REL, S07_SPRING.d0);
      BL.set(defl, S7.width, S7.roll * DEG);
      const L = LIGHT.morning();
      const el = 18 * DEG;
      L.sunDir = new V3(-0.55 * Math.cos(el), Math.sin(el), -0.84 * Math.cos(el)).normalize();
      L.time = t * SLOW; L.flowers = 0.9; L.sunSize = 0.012;
      L.fog = 0.0045; L.fogStart = 46; L.canopy = 13; L.canopySoft = 20;
      // the butterfly on the blade. At 80.5 it leaves: we are back far enough by then to see it go, the blade whip up
      // and tremble to rest (story.bladeSpring: the spring S23 ends on), and the drop flung from its tip
      const deflAt = (tt) => (tt < T_REL ? bladeBow(HERO_BLADE.load) + 0.5 * Math.sin(tt * 1.3) : bladeSpring(tt, T_REL, S07_SPRING.d0));
      const toW = (v) => v.clone().applyMatrix4(BL.g.matrixWorld), dirW = (v) => v.clone().transformDirection(BL.g.matrixWorld);
      const f = BL.frame(sb, defl), f0 = BL.frame(sb, bladeBow(HERO_BLADE.load));
      const bpos = toW(f.p.clone().addScaledVector(f.n, -FEET_Y)), bpos0 = toW(f0.p.clone().addScaledVector(f0.n, -FEET_Y));
      const gone = t - T_REL;
      if (gone < 1.5) {
        // a quarter second of gathering (the wings come down once), then up and away to the upper left
        const g1 = Math.max(0, gone);
        const pos = gone > 0 ? bpos0.clone().add(new V3(-5.5 * g1 - 4 * g1 * g1, 7.5 * g1 + 7 * g1 * g1, -2.5 * g1)) : bpos.clone();
        const hd = dirW(f0.t).lerp(new V3(-0.75, 0.62, -0.2), sm(0.0, 0.5, gone)).normalize();
        const up = dirW(f0.n).lerp(new V3(0.3, 0.9, 0.3), sm(0.0, 0.5, gone)).normalize();
        placeButterfly(hero, pos, gone > 0 ? hd : dirW(f.t), gone > 0 ? up : dirW(f.n));
        const fl = gone > -0.25;
        hero.set(heroLight(L, { open: fl ? 0.62 : breath(t) * 0.92, flap: fl ? 4 * (gone + 0.25) + 0.25 : null, crumple: 0, wear: 0, notch: 0, barePatch: 1, proboscis: 0, sheenFill: 0.6 }));
        hero.update(t * SLOW);
      }
      // the drop: carried up by the tip, let go as the blade passes upright, a slow arc, and down onto the leaf of a
      // neighbouring plant a little behind the blade and to its right (so that the whole fall stays in the frame).
      // Contact on f2458 (81.933), the crown on f2459; the cut (and the alarm) at 82.0
      const tipAt = (dd) => { const ft = BL.frame(1, dd); return toW(ft.p.clone().addScaledVector(ft.t, -0.12)).add(new V3(0, -0.33, 0)); };
      const T_FLING = T_REL + 0.2, T_HIT = SYNC.impact - 2 / 30, TF = T_HIT - T_FLING;
      const rel = tipAt(deflAt(T_FLING)), tv = rel.clone().sub(tipAt(deflAt(T_FLING - 0.02))).divideScalar(0.02);
      const tip0 = tipAt(bladeBow(HERO_BLADE.load));
      const leafY = tip0.y - S7.drop, land = toW(new V3(S7.hit[0], 0, S7.hit[1]));
      const v0 = new V3((land.x - rel.x) / TF, tv.y * S7.fling, (land.z - rel.z) / TF);
      const G = 2 * (rel.y + v0.y * TF - (leafY + 0.3)) / (TF * TF);
      const hit = new V3(rel.x + v0.x * TF, leafY, rel.z + v0.z * TF);
      const dropAt = (tt) => {
        if (tt <= T_FLING) return tipAt(deflAt(tt));
        const k = Math.min(tt, T_HIT) - T_FLING;
        return new V3(rel.x + v0.x * k, rel.y + v0.y * k - 0.5 * G * k * k, rel.z + v0.z * k);
      };
      const dpos = dropAt(t);
      BL.lower.position.set(hit.x + 0.5, leafY - 0.22, hit.z + 0.1).applyMatrix4(invM);
      BL.lower.rotation.set(0.55, 0.5, -0.12);
      const sq = sat((t - T_HIT) / 0.07);                               // it flattens on the leaf
      BL.drop.mesh.position.copy(dpos).add(new V3(0, -0.2 * sq, 0)).applyMatrix4(invM);
      BL.drop.mesh.scale.set(1 + 0.9 * sq, (t <= T_FLING ? 1.12 : 1) * (1 - 0.72 * sq), 1 + 0.9 * sq);
      BL.drop.set({ portal, impression: 1, fill: 0, gain: 1.15, zoom: 1.0, wobble: sm(79.2, 80.0, t) * 0.6 + (t > T_FLING ? 0.3 + 1.4 * Math.exp(-(t - T_FLING) * 4) : 0), time: t, lightDir: L.sunDir.toArray(), lightColor: [3.2, 2.9, 2.3], envTop: L.skyHigh.toArray(), envBottom: L.groundB.clone().multiplyScalar(0.6).toArray() });
      BL.splash.visible = t >= T_HIT;
      BL.uSplash.value.set(hit.x, leafY + 0.05, hit.z, t - T_HIT);
      // the lens: locked and planar. 75.0 -> 79.7 the push to the drop (10% -> 55% of picture height). 79.95 -> 80.55 it
      // eases back and left to a medium frame on the blade's upper half: the butterfly on it, the drop at its tip, the
      // leaf below. There it holds while the butterfly goes, the blade whips up (its tip flicks past the top of frame)
      // and trembles to rest; from 81.25 it tilts down a little and closes in on the leaf as the drop comes down
      const k1 = sm(75.0, 79.7, t), k2 = sm(79.95, 80.55, t), k3 = sm(81.25, T_HIT, t);
      const d0 = distFor(0.62 / 0.1, 100), d1 = distFor(0.62 / 0.55, 100), dW = distFor(S7.frameH, 100), dT = distFor(S7.endH, 100);
      const dist = Math.exp(mix(mix(mix(Math.log(d0), Math.log(d1), k1), Math.log(dW), k2), Math.log(dT), k3));
      const wide = bpos0.clone().lerp(tip0, 0.52).add(new V3(0.2, 0.75, 0));
      // the middle of the medium frame, in the blade's plane: low at first (the butterfly on the bowed blade, the drop at
      // its tip), lifting a little with the blade as it whips up
      const up = sm(80.62, 81.05, t);
      const swing = toW(new V3(mix(S7.centre[0], S7.centre2[0], up), mix(S7.centre[1], S7.centre2[1], up), 0));
      const close = new V3(mix(swing.x, hit.x, 0.55), hit.y + S7.endUp, mix(swing.z, hit.z, 0.5));
      const tgt = wide.clone().lerp(dropAt(Math.min(t, T_REL)), sm(0, 1, Math.pow(k1, 0.6))).lerp(swing, k2).lerp(close, k3);
      setCam(tmp.set(tgt.x, tgt.y, tgt.z + dist), tgt, 100, 0, 0.5);
      // in the medium frame the blade carries the light (back-lit, its edges lit) against a meadow that goes darker and softer
      heroBladeMat.uniforms.uDim.value = mix(1.25, 1.6, k2);
      bladeMat.uniforms.uDim.value = mix(1, S7.bgDim, k2);
      L.eye = tgt.y;
      L.fog = 0.0045; L.fogStart = Math.max(46, dist + 14);
      L.haze.multiplyScalar(mix(1, S7.hazeDim, k2)); L.skyLow.multiplyScalar(mix(1, 0.6, k2)); L.skyHigh.multiplyScalar(mix(1, 0.6, k2));
      setLight(L);
      shafts(L, mix(0.35, 0.1, k2), t, 1.4, 0.3);
      uWind.value.set(0.1, t * SLOW, 0.5, 0);
      BL.discs2.uniforms.uBk.value.set(t * SLOW, mix(1, 0.4, k2), 0, aspect);
      this._plate = { sunElevation: 18, sunAzimuth: -12, cloudCover: 0.2, cityLights: 0, defocus: 1, lightsOut: 0, heading: 21, inkCloud: 0, flowers: 1, eye: 0.9, exposure: mix(0.8, S7.plateExp, k2) };
      const rack = sm(p.rack ?? 74.5, (p.rack ?? 74.5) + 0.9, t);
      // focus: the butterfly, racked to the drop; in the medium frame the blade's upper half, then the drop as it falls
      const fBlade = camera.position.distanceTo(swing);
      const focus = mix(mix(camera.position.distanceTo(bpos), camera.position.distanceTo(dpos), rack), mix(fBlade, camera.position.distanceTo(dpos), sm(80.9, 81.5, t)), k2);
      return { dof: { focus, aperture: mix(2.4, S7.aperture, k2), maxBlur: 30 }, exposure: -0.55, ...BASE_POST, bloom: 0.1, halation: 0.2, vignette: mix(0.34, 0.5, k2) };
    },
    // ---------------------------------------------------------------------------------------------- S12
    S12(t, p) {
      show(RO.g);
      const lt = (t - SHOT.S12[0]) / 7;
      const { D, CY } = RO;
      setCam(tmp.set(0, CY, D), tmp2.set(0, CY, 0), 100);
      const inkc = p.inkCloud ?? 0.7 * lt;
      const L = roostLight(t, inkc);
      setLight(L);
      bgU.uCloud.value.set(1, 0, 0, -1); bgU.uCloudW.value = Math.tan(vfov(100) / 2) * aspect;
      uWind.value.set(0.16 + 0.1 * lt, t * SLOW, 0.2, 0);
      roost(t, L, 0, 0.02);
      // the first drops: slow glass; a blade whips under one
      uRain.value.set(RO.rs(t), 0, 0, 0);
      uStrike.value.set(RO.struck.x, RO.struck.z, RO.rs(RO.strikeT), RO.rs(t));
      RO.drop.mesh.visible = false;
      RO.discs.uniforms.uBk.value.set(t * SLOW, 0.8, 0, aspect);
      return { dof: { focus: D, aperture: 4.5, maxBlur: 30 }, exposure: mix(-0.2, -0.6, lt), ...BASE_POST, saturation: mix(1.05, 0.9, lt) };
    },
    // ---------------------------------------------------------------------------------------------- S13
    S13(t, p) {
      show(RO.g);
      const { CY, ATTACH_Y, xs } = RO;
      // PORTAL FIRST: the subway car, 129.0. Exact hand-off: an 'hdr' frame, shown through fill = 1, under S14's own post
      const END = SHOT.S13[1], last = END - 1 / 30, final = t >= last - 1e-6;
      let portal = null;
      if (p.portal && !p.impression) portal = ctx.engine.portal(p.portal.shot, final ? p.portal.t + (t - last) : p.portal.t, final ? { stage: 'hdr', live: true, key: 'x6' } : { stage: 'hdr' });
      const depthTex = final && portal ? ctx.engine.portal(p.portal.shot, p.portal.t) : null;   // its 'graded' twin: alpha = depth
      const L = roostLight(t, 0.7 + 0.2 * sm(121, 126, t));
      setLight(L);
      uWind.value.set(0.3, t * SLOW, 0.2, 0);
      const flinch = sm(122.0, 122.08, t);
      roost(t, L, flinch, 0.2 * (1 - flinch) * (0.6 + 0.4 * Math.sin(t * 2.2)), new V3(0.985, 0, -0.17));
      hero.set({ notch: t >= 122.0 ? 1 : 0 });
      // (the steady rain thins away as the lens goes in: under the leaf, far out of focus, a falling drop is a pale blob
      // that flashes for a frame)
      uRain.value.set(RO.rs(t), 1, 1 - sm(124.4, 125.6, t), 0);
      uStrike.value.set(0, 0, 0, 0);
      bgU.uCloudW.value = Math.tan(vfov(100) / 2) * aspect;
      // the drop that gathers on the leaf's edge before its face, and hangs
      const hx = xs[SEVEN.hero], ex = hx + 1.55;
      const E0 = new V3(ex, RO.leafY(ex, RO.EDGE_Z) - 0.31, RO.EDGE_Z + 0.02);
      const grow = sm(122.4, 124.3, t);
      RO.drop.mesh.visible = grow > 0.01;
      RO.drop.mesh.position.copy(E0).add(new V3(0, 0.3 * (1 - grow), 0));
      RO.drop.mesh.scale.set(0.25 + 0.75 * grow, (0.25 + 0.75 * grow) * (1.0 + 0.14 * grow), 0.25 + 0.75 * grow);
      const k = sm(124.5, last, t);
      const fillK = final ? 1 : Math.pow(k, 2.2);
      RO.drop.set({ portal, impression: 2, fill: fillK, portalDepth: depthTex, gain: 1, zoom: 1.0, wobble: 0.25 * (1 - fillK), time: t, lightDir: [0.2, 0.9, 0.4], lightColor: L.ambTop.clone().multiplyScalar(3).toArray(), envTop: L.skyHigh.toArray(), envBottom: L.groundB.toArray() });
      // the lens: medium close, a little below and to the right: ours in profile (the others hang edge-on, as the
      // strap-hangers stood), the drop on the leaf's edge before its face. From 124.5 the push into the drop, turning over
      const heroC = new V3(hx - 0.2, ATTACH_Y - 2.2, 0);
      const C0 = new V3(hx + 6, CY + 0.9, 54), T0 = heroC.clone().lerp(E0, 0.42).add(new V3(0.2, 0.35, 0));
      const dir = C0.clone().sub(E0).normalize();
      const d0 = C0.distanceTo(E0), d1 = 1.55, dist = d0 * Math.pow(d1 / d0, Math.pow(k, 1.25));
      const C = E0.clone().addScaledVector(dir, dist);
      const tgt = T0.clone().lerp(E0, sm(0, 0.55, k));
      setCam(C, tgt, 100, (p.roll !== undefined && !final ? p.roll : 180 * k) * DEG, 0.12);
      bgU.uCloud.value.set(1, 0, 0, -1);
      RO.discs.uniforms.uBk.value.set(t * SLOW, 0.8 * (1 - sm(124.3, 125.3, t)), 0, aspect);   // (the far glints go out before the push: this far out of focus one is a pale blob that flashes)
      const rack = sm(123.6, 124.6, t);
      const focus = mix(C.distanceTo(heroC), Math.max(0.4, C.distanceTo(E0) - 0.34 * (1 - fillK)), rack);
      // the drop's own ink: a pool that follows it and swallows the frame with it
      const sp = E0.clone().project(camera), rpx = (0.34 / (2 * dist * Math.tan(vfov(100) / 2))) / aspect * 1.08;
      const target = portal && portal.userData && portal.userData.post ? portal.userData.post : null;
      const tin = target && target.ink ? target.ink : { amount: 1, chroma: 0.15 };
      const pools = grow > 0.3 ? [{ x: sp.x * 0.5 + 0.5, y: sp.y * 0.5 + 0.5, r: Math.min(3, rpx * (0.98 + 6 * fillK * fillK)), soft: 0.006 + 0.02 * fillK, amount: tin.amount ?? 1, chroma: tin.chroma ?? 0.15, rim: 1 - fillK }] : [];
      const hp = heroC.clone().project(camera), shutK = flinch * (1 - sm(0.15, 0.5, k));
      const heroPool = [];
      const base = { dof: { focus, aperture: mix(3.4, 0.0, sm(0.9, 0.995, k)), maxBlur: 28 }, exposure: mix(-0.3, -0.7, k), ...BASE_POST, saturation: 0.95, ink: { amount: LOOK.S13.ink, chroma: LOOK.S13.chroma, mist: 0, pools: heroPool.concat(pools) } };
      for (const c of RO.g.children) if (c !== RO.drop.mesh) c.visible = !final;
      if (final && target) {
        // only the drop is drawn now: S14's frame, S14's own post, and S14's depth (written by the drop) with its
        // own depth range for the ink
        hero.group.visible = false; for (const o of others) o.group.visible = false;
        this._onlyDrop = true;
        let ink = null;
        if (target.ink) {
          const rec = ctx.engine.worlds && ctx.engine.worlds.get && ctx.engine.worlds.get(ctx.engine.byId.get(p.portal.shot).world);
          const far14 = rec && rec.instance && rec.instance.camera ? rec.instance.camera.far : null;
          ink = { ...target.ink, mistRange: target.ink.mistRange || (far14 ? [far14 * 0.05, far14 * 0.6] : null) };
        }
        return { ...target, dof: null, ink };
      }
      if (target && k > 0.75) {
        // lean the grade toward S14's as the drop takes the frame
        const m = sm(0.75, 1.0, k);
        for (const key of ['exposure', 'contrast', 'saturation', 'bloom', 'halation', 'vignette', 'temperature']) if (typeof target[key] === 'number' && typeof base[key] === 'number') base[key] = mix(base[key], target[key], m);
      }
      return base;
    },
    // ---------------------------------------------------------------------------------------------- S21, S22
    S21(t, p) { return dusk(t, p); },
    S22(t, p) { return dusk(t, p); },
  };

  let lastPost = {};
  const run = (t, shot, p) => {
    const fn = stage[shot.id] || stage.S06;
    stage._plate = null; stage._onlyDrop = false; stage._veil = 0;
    hero.set({ feet: null, proboscisTarget: null, antennaLift: 0, fill: 0, lobe: 1 });     // (S06 poses and lights them; every other shot has the standing rig)
    bladeMat.uniforms.uDim.value = 1;                                   // (S07 dims the meadow behind its blade)
    lastPost = fn.call(stage, t, p || {}, shot) || {};
    const plated = usePlate(t, p && p.noPlate ? null : stage._plate);
    veil.visible = plated && stage._veil > 0; veilU.uVeil.value = stage._veil;
    if (stage._onlyDrop) bg.visible = false;
    shared.uDof.value.set(lastPost.dof ? lastPost.dof.focus : 1e6, lastPost.dof ? lastPost.dof.aperture : 0, lastPost.dof ? lastPost.dof.maxBlur ?? 18 : 0, shared.uDof.value.w);
  };
  for (const d of discSets) d.mesh.onBeforeRender = (r) => { const rt = r.getRenderTarget(); shared.uDof.value.w = rt ? rt.height : r.domElement.height; };

  return {
    scene, camera,
    post: () => lastPost,
    update(t, localT, shot, params) { run(t, shot, params); },
    dispose() { if (plate) plate.dispose(); for (const d of disposables) d.dispose(); hero.dispose(); for (const o of others) o.dispose(); BL.drop.dispose(); RO.drop.dispose(); },
  };
}
