// W1 ICE — inside the glacier (S01-S05), the W6 "freeze" end state (S21) and the dim drifting
// grains behind the end credits (S22).
//
// Scale: about 1 unit = 1 cm. The seed sits at the origin. Everything is a pure function of the
// shot params and the clock; grain positions are static attributes (bubbles frozen in ice).
// The camera choreography (icePose) lives in src/shots/ice.js; the credit C0 is built from the
// exact pose at T_ALIGN = 15.0 s, so it aligns by construction.
//
// How it is drawn: the body of the ice is one background shader (palette ramp + cloudiness +
// caustic curtains); the grains are stateless particles on FX_LAYER that do their own thin-lens
// bokeh (point -> anamorphic disc) and, while the camera moves, are drawn SHUTTER_TAPS times across
// a 180° shutter; the husk of the seed takes the post chain's depth of field (matched to the grains).
// The crack is the shared LINE generator (lib/line.js).
//
// params (all optional, keyframable; defaults in DEFAULTS below):
//   reveal 0..1          brightness of the grains (S01 fade-up)
//   lightLevel 0..1      navy -> cyan lift of the whole ice
//   causticAmount 0..1   animated caustics from above (volume curtains + flicker on the grains)
//   fractureFlash 0..1   gain of the fracture planes' glints
//   (creditAlign is not used: the credit's grains are never gated; see TEXT_POS)
//   creditSweep 0..1     position of the reading light (first letter -> last)
//   crackGrowth 0..1     stem in the first 0.2, five side branches after
//   bladeIntensity 0..1  sunlight entering along the crack
//   bead 0..1            the meltwater bead's slide down the crack
//   seedGlow, silkSpread, seedIce, seedDrift (0..1 of the hero seed's approach offset, S21)
//   (the seed is unlit, i.e. not there to be seen, while lightLevel <= 0.05 in the ice: S01, S02)
//   focusDistance (world units), aperture (0..n; 1 = the prologue's wide-open look)
//   whiteOut 0..1        burn to white (S05)
//   freeze 0..1          1 = ice (W1). 0 = night wind (W6): the same grains as stars / snow / tufts
//   windAge >= 0         wind-seconds left until everything stops; at 0 every grain is exactly home
//   clock                seconds driving caustics / drift (defaults to film time; S21 offsets it so
//                        that its last frame is the same instant as the end of S03)
//   credits 0|1, creditsFade 0..1   S22: black, a few dozen grains at 6%

import * as THREE from 'three';
import { NOISE } from '../lib/glsl/noise.js';
import { createParticles } from '../lib/particles.js';
import { GRAIN_FRAG } from '../lib/grains.js';
import { createSeed } from '../lib/seed.js';
import { createRng } from '../lib/random.js';
import { lensToFov } from '../lib/camera.js';
import { PALETTE } from '../lib/story.js';
import { createLine } from '../lib/line.js';
import { sampleTextPoints, fitPointsToCount } from '../titles.js';
import { FX_LAYER } from '../post.js';
import { icePose, iceCameraPosition, basisOf, ICE_LENS, T_ALIGN, END_POS, END_TARGET, CRACK_FROM, CRACK_TO, SUN_DIR } from '../shots/ice.js';

const CREDIT_TEXT = 'Produced by Fable 5.5';
const CREDIT_WIDTH = 0.58;          // fraction of the picture width at the alignment
const N_BUBBLES = 60000;
const N_NEAR = 2600;                // extra bubbles strung along the camera's path (foreground bokeh)
const N_TEXT = 9000;
const BOKEH_K = 62;                 // px of blur radius (1080p) per unit of |1/z - 1/focus| at aperture 1
const DOF_MAX = 22;                 // post-chain max blur (px) for the solid objects
const SEED_SCALE = 0.82;
const SHUTTER_TAPS = 4;             // sub-frame samples of the grains across a 180° shutter
const SEED_DRIFT_FROM = [-4, 2.5, -34];
const BEAD_FROM = 0.6;              // stem fraction where the meltwater bead wells up (just clear of the seed)

const DEFAULTS = {
  reveal: 1, lightLevel: 0.05, causticAmount: 0, fractureFlash: 0, creditAlign: 0, creditSweep: 0,
  crackGrowth: 0, bladeIntensity: 0, bead: 0, seedGlow: 0, silkSpread: 1, seedIce: 1, seedDrift: 0,
  focusDistance: 26, aperture: 1, whiteOut: 0, freeze: 1, windAge: 0, credits: 0, creditsFade: 1,
};

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const lin = (hex) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };

// ------------------------------------------------------------------------------------------ GLSL
const CAUSTIC = /* glsl */ `
#ifndef ICE_CAUSTIC
#define ICE_CAUSTIC
float iceCaustic(vec2 p, float t) {
  p = mod(p * 6.2831853, 6.2831853) - 250.0;
  vec2 i = p; float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.6);
}
#endif
`;

// Declarations shared by the grain systems (pasted into vertex AND fragment shaders).
const GRAIN_GLSL = CAUSTIC + /* glsl */ `
uniform float uClock, uReveal, uLight, uCaustic, uAlign, uBandX, uBandW, uBandAmp, uBlade, uWhite;
uniform float uFreeze, uWindAge, uFocus, uApK, uSeedGlowNow, uGain;
uniform mat4 uShutter;
uniform vec3 uP15, uR15, uF15, uCend, uSeedPos, uAmber, uSun, uCrackA, uCrackB;
varying float vBlend;
varying float vRole;
varying float vMorph;
// In-focus point -> out-of-focus disc. Returns (quad size in world units, intensity gain, blend).
vec3 bokeh(float sz, float z, float pxu, float resK, float pointScale, float vary) {
  float dpx = sz * pxu;
  float d0 = max(dpx, resK);
  float sub = min(1.0, dpx / resK); sub *= sub;
  float blur = uApK * abs(1.0 / z - 1.0 / uFocus) * resK * (0.78 + 0.44 * vary);   // no two highlights quite alike
  float b = smoothstep(0.6, 2.2, blur / (0.5 * d0 + 0.6 * resK));
  b = max(b, smoothstep(4.0, 9.0, d0 / resK) * uFreeze);    // a bubble big enough to see is a bubble, not a point
  float pq = d0 * 3.4 * pointScale;
  float dq = 2.3 * (blur + 0.5 * d0);
  float dim = pow(clamp(2.0 * d0 * d0 / (dq * dq), 0.0, 1.0), 0.8) * 2.4;
  dim /= 1.0 + pow(d0 / (4.0 * resK), 1.5);                 // large bubbles: faint body, the light is in the rim
  return vec3(mix(pq, dq, b) / pxu, sub * mix(1.0, dim, b), b);
}
// light that every grain in the ice shares: lift, caustic flicker, reading band, sun blade, seed
vec3 iceLight(vec3 p, vec4 seed, float bandGain, out float amber) {
  float ca = uCaustic > 0.0 ? iceCaustic(p.xz * 0.11 + p.y * 0.031, uClock * 0.42) : 0.0;
  float tw = 0.86 + 0.14 * sin(uClock * (0.7 + seed.w * 1.7) + seed.x * 50.0);
  float f = (0.5 + 1.3 * uLight) * (1.0 + uCaustic * 2.4 * ca) * tw;
  vec3 rel = p - uP15;
  float xa = dot(rel, uR15) / max(dot(rel, uF15), 0.5);
  float xq = (xa - uBandX) / uBandW;
  f *= 1.0 + bandGain * exp(-xq * xq) * uBandAmp;
  vec3 c = vec3(0.72, 0.89, 1.0) * f;
  // warm sunlight along the crack
  vec3 ab = uCrackB - uCrackA;
  float h = clamp(dot(p - uCrackA, ab) / dot(ab, ab), 0.0, 1.0);
  float dl = length(p - (uCrackA + ab * h));
  c += vec3(1.0, 0.66, 0.3) * uBlade * 2.2 * exp(-dl * dl * 1.6) * (1.0 - 0.6 * h);
  float ds = length(p - uSeedPos);
  amber = uSeedGlowNow * 2.4 / (1.0 + ds * ds * 0.9);
  return c;
}
`;

const SKIN = (name) => `{ ${GRAIN_FRAG[name]} }`;
const BUBBLE_FRAG = /* glsl */ `
  vec4 cP, cD, cR;
  ${SKIN('point')} cP = col;
  ${SKIN('bokeh')} cD = col;
  cR = cP;
  if (vMorph > 0.001) {
    if (vRole < 1.5) ${SKIN('star')}
    else if (vRole < 2.5) ${SKIN('snow')}
    else ${SKIN('tuft')}
    cR = mix(cP, col, vMorph);
  }
  col = mix(cR, cD, vBlend);
`;

const BUBBLE_POS = /* glsl */ `
  float sz = aProp.x, bright = aProp.y, role = aProp.z;
  float night = 1.0 - uFreeze;
  pos = aPos;
  float windFade = 1.0, pointScale = 1.0;
  vec3 tint = vec3(1.0);
  if (night > 0.0 || uWindAge > 0.0) {
    // W6: the same grain is a snowflake or a seed tuft on the wind. Its offset from home is
    // (wind velocity) x (wind-seconds left), so when the wind has run out it is exactly home.
    bool snow = role < 2.5;
    vec3 w = snow ? vec3(0.4, -1.0, -1.5) * (0.65 + 0.7 * seed.x) + vec3(seed.y - 0.5, 0.0, seed.z - 0.5) * 0.6
                  : vec3(0.6, -0.1, -2.5) * (0.75 + 0.5 * seed.x) + vec3(seed.y - 0.5, seed.w - 0.5, seed.z - 0.5) * 0.8;
    vec3 off = -w * uWindAge;
    vec3 hb = vec3(26.0, 14.0, 26.0);
    off = mod(off + hb, 2.0 * hb) - hb;
    vec3 e = abs(off) / hb;
    windFade = (1.0 - smoothstep(0.72, 1.0, e.x)) * (1.0 - smoothstep(0.72, 1.0, e.y)) * (1.0 - smoothstep(0.72, 1.0, e.z));
    float sw = smoothstep(0.0, 3.0, uWindAge) * (snow ? 0.3 : 0.8);
    off += sw * vec3(sin(uWindAge * 0.9 + seed.x * 40.0), sin(uWindAge * 0.7 + seed.y * 40.0), cos(uWindAge * 0.8 + seed.z * 40.0));
    pos = aPos + off;
    pointScale = mix(1.0, snow ? 1.5 : 2.3, night);
    sz = mix(sz, snow ? 0.01 + 0.012 * seed.w : 0.014 + 0.024 * seed.w * seed.w, night);
    float tw = 0.75 + 0.25 * sin(uClock * (1.0 + 2.0 * seed.x) + seed.y * 40.0);
    bright = mix(bright, snow ? 0.22 + 0.4 * seed.y : (0.9 + 2.4 * seed.y * seed.y) * tw, night);
    tint = snow ? vec3(0.8, 0.88, 1.0) : mix(vec3(1.0, 0.957, 0.863), uAmber, 0.45 + 0.4 * seed.z) * vec3(1.0, 0.86, 0.62) * 1.5;
  }
  float amber;
  vec3 c = iceLight(pos, seed, 0.55, amber);
  // 180° shutter: this draw sees the grain as the camera saw it a fraction of a frame ago
  pos = (uShutter * vec4(pos, 1.0)).xyz;
  vec4 mvp_ = modelViewMatrix * vec4(pos, 1.0);
  float z = max(-mvp_.z, 0.05);
  float resK = uResolution.y / 1080.0;
  float pxu = projectionMatrix[1][1] * 0.5 * uResolution.y / z;
  sz = mix(sz, min(sz, 3.0 * resK / pxu), night);          // on the wind a grain is a point of light, however near
  vec3 bk = bokeh(sz, z, pxu, resK, pointScale, aProp.w);
  size = bk.x;
  float I = bright * bk.y;
  vec3 absorb = mix(vec3(1.0), exp(-z * vec3(0.034, 0.009, 0.003)), uFreeze);   // ice takes the red out of far light
  vec3 rgb = (mix(tint, c * absorb, uFreeze) + uAmber * amber) * I;
  float a = uReveal * windFade;
  // big discs too faint to see are skipped (faded out, so that nothing pops as the light changes)
  a *= mix(1.0, smoothstep(0.005, 0.013, max(rgb.r, max(rgb.g, rgb.b)) * a), smoothstep(0.3, 0.7, bk.z));
  color = vec4(rgb * uGain, a);
  vBlend = bk.z;
  vRole = role;
  vMorph = night;
`;

const TEXT_POS = /* glsl */ `
  pos = aPos;
  // Parallax from a translating camera smears every grain along ONE direction (by an amount set by
  // its depth), which would leave the letters' stems visible as a comb of streaks. So each grain
  // also carries a second, independent "depth" for the direction across the smear: a small offset
  // proportional to the camera's distance from the line of sight. On that line (13.6 .. 16.5 s) it
  // is exactly zero, and it only changes when the camera moves, as parallax does.
  {
    vec3 relC = cameraPosition - uP15;
    vec3 u15 = cross(uR15, uF15);
    vec2 c = vec2(dot(relC, uR15), dot(relC, u15));
    float depth = dot(aPos - uP15, uF15);
    pos += (uR15 * (-c.y) + u15 * c.x) * depth * (seed.z - 0.5) * 0.085;
  }
  vec4 mvp_ = modelViewMatrix * vec4(pos, 1.0);
  float z = max(-mvp_.z, 0.05);
  float resK = uResolution.y / 1080.0;
  float pxu = projectionMatrix[1][1] * 0.5 * uResolution.y / z;
  vec3 bk = bokeh(aProp.x, z, pxu, resK, 1.0, 0.5);
  size = bk.x;
  float amber;
  vec3 c = iceLight(pos, seed, 0.0, amber);
  float xq = (aProp.z - uBandX) / uBandW;
  float read = 1.0 + 1.5 * exp(-xq * xq) * uBandAmp;        // up to 2.5x as the light reads the line
  // No envelope: a credit grain is an ordinary bubble at an ordinary brightness all the time. Only the
  // camera's position decides whether the bubbles read as words.
  float I = aProp.y * bk.y * read;
  vec3 absorb = exp(-z * vec3(0.034, 0.009, 0.003));
  color = vec4((c * absorb + uAmber * amber) * I, uReveal * smoothstep(0.25, 1.0, uFreeze));
  vBlend = bk.z;
  vRole = 0.0;
  vMorph = 0.0;
`;

const BG_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = viewMatrix * vec4(cameraPosition + position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const BG_FRAG = NOISE + CAUSTIC + /* glsl */ `
uniform float uClock, uLight, uCaustic, uBandX, uBandW, uBandAmp, uBlade, uWhite, uFreeze, uCredits, uReveal;
uniform vec3 uP15, uR15, uF15, uSunDir, uSun, uVoid, uDeep, uMid, uGlow, uNight;
varying vec3 vDir;
void main() {
  vec3 rd = normalize(vDir);
  vec3 ro = cameraPosition;
  float toSun = dot(rd, uSunDir) * 0.5 + 0.5;
  float g = 0.45 * smoothstep(-0.9, 1.0, rd.y) + 0.55 * toSun * toSun;
  // slow cloudiness of the ice, three depth slices so that it has parallax
  float cl = 0.0;
  cl += 0.50 * fbm((ro + rd * 9.0) * 0.085 + vec3(0.0, uClock * 0.004, 0.0), 3);
  cl += 0.32 * fbm((ro + rd * 22.0) * 0.045 + 7.3, 3);
  cl += 0.18 * fbm((ro + rd * 50.0) * 0.022 - 3.1, 2);
  float cloud = smoothstep(-0.55, 0.75, cl);
  // palette ramp: void -> deep ice -> mid ice -> lit cyan
  float q = uLight * (0.45 + 1.0 * g + 1.6 * uBlade * pow(toSun, 3.0)) * (0.55 + 0.8 * cloud) * (1.0 - 0.35 * uBlade) + 0.05 * cloud * (0.4 + g);
  vec3 col = mix(uVoid, uDeep, smoothstep(0.0, 0.14, q));
  col = mix(col, uMid, smoothstep(0.1, 0.5, q));
  col = mix(col, uGlow, smoothstep(0.42, 1.3, q));
  // caustic curtains: light from above, sampled through the volume
  if (uCaustic > 0.0) {
    float ca = 0.0;
    ca += 0.40 * iceCaustic((ro + rd * 5.0).xz * 0.11 + (ro + rd * 5.0).y * 0.031, uClock * 0.42);
    ca += 0.33 * iceCaustic((ro + rd * 11.0).xz * 0.11 + (ro + rd * 11.0).y * 0.031, uClock * 0.42);
    ca += 0.27 * iceCaustic((ro + rd * 21.0).xz * 0.11 + (ro + rd * 21.0).y * 0.031, uClock * 0.42);
    col += uGlow * ca * uCaustic * (0.07 + 0.3 * uLight) * (0.4 + 0.6 * cloud);
  }
  // the reading light of the credit: a faint vertical sheet in the ice
  float xa = dot(rd, uR15) / max(dot(rd, uF15), 0.2);
  float xq = (xa - uBandX) / (uBandW * 1.5);
  col += uGlow * exp(-xq * xq) * uBandAmp * 0.006 * (0.5 + cloud);
  // sunlight through the crack
  col += vec3(1.0, 0.66, 0.3) * uBlade * 0.5 * pow(toSun, 24.0);
  // W6: the night the seeds fly home through
  vec3 night = uNight * (0.9 + 0.16 * smoothstep(0.9, -0.3, rd.y));
  col = mix(night, col, uFreeze);
  col *= sqrt(clamp(uReveal, 0.0, 1.0));
  col *= (1.0 - uCredits);
  gl_FragColor = vec4(col, 1.0);
}`;

const PLANE_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUvP;
varying vec3 vWorld;
void main() {
  vUvP = aUv;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const PLANE_FRAG = NOISE + CAUSTIC + /* glsl */ `
uniform float uClock, uFlash, uLight, uCaustic, uBlade, uFreeze, uRipple, uShine, uGain;
uniform vec3 uN, uT, uB, uSunDir, uSun;
uniform vec2 uOff, uOrigin;
varying vec2 vUvP;
varying vec3 vWorld;
void main() {
  vec2 uv = vUvP;
  float n1 = snoise(uv * 1.3 + uOff);
  float n2 = snoise(uv * 3.3 - uOff.yx);
  // the fracture ends at a crisp, irregular front
  float inside = 0.67 - (length(uv) + 0.24 * n1 + 0.07 * n2);
  if (inside <= 0.0) discard;
  float edge = smoothstep(0.0, 0.02, inside) * (0.5 + 0.5 * smoothstep(0.0, 0.45, inside));
  // conchoidal ripples (thin arcs) and plumose hackle (fine radial lines) around the fracture origin
  vec2 d = uv - uOrigin; float r = length(d) + 1e-4;
  float phase = r * uRipple + 2.4 * n1 + 0.9 * n2;
  vec2 grad = (d / r) * cos(phase) * 0.05;
  float ang = atan(d.y, d.x);
  float feather = snoise(vec2(ang * 13.0, r * 2.2 + uOff.x));
  grad += vec2(-d.y, d.x) / r * feather * 0.045;
  grad += 0.02 * vec2(n2, snoise(uv * 3.3 + uOff.yx + 5.0));
  float arcs = pow(1.0 - abs(sin(phase * 1.5)), 6.0);
  float hackle = pow(1.0 - abs(snoise(vec2(ang * 34.0 + 2.0 * n1, r * 1.6 + uOff.y))), 9.0) * smoothstep(0.05, 0.4, r);
  float front = exp(-inside * 70.0);                       // the bright line where the crack front stopped
  float detail = 0.42 + 0.95 * arcs + 0.85 * hackle + 1.3 * front;
  vec3 N = normalize(uN + uT * grad.x + uB * grad.y);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uSunDir + V);
  float nh = abs(dot(N, H));
  float s = pow(nh, uShine) * detail + 0.012 * pow(nh, uShine * 0.05);
  float sheen = pow(1.0 - abs(dot(N, V)), 5.0) * 0.05;
  float dist = length(cameraPosition - vWorld);
  float nearK = smoothstep(0.5, 3.5, dist);
  float ca = uCaustic > 0.0 ? iceCaustic(vWorld.xz * 0.11 + vWorld.y * 0.031, uClock * 0.42) : 0.0;
  float I = (s * 1.25 + sheen) * edge * nearK * uGain * uFlash * (0.75 + 0.5 * uLight) * (1.0 + 1.2 * uCaustic * ca);
  vec3 col = mix(vec3(0.02, 0.24, 0.6), vec3(0.5, 0.88, 1.0), clamp(s * s * 0.6, 0.0, 1.0)) * I;
  col += vec3(1.0, 0.66, 0.3) * uBlade * min(s, 1.5) * 0.4 * edge * nearK * uGain;
  gl_FragColor = vec4(col * uFreeze, 0.0);
}`;

const LINE_VERT = /* glsl */ `
attribute vec3 aTan;
attribute float aSide, aG, aW, aU, aStem, aL;
uniform float uWidthPx, uWidthWorld;
uniform vec2 uRes;
varying float vSide, vG, vW, vU, vStem, vL;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  vec4 c = projectionMatrix * mv;
  vec4 c2 = projectionMatrix * (viewMatrix * vec4(position + aTan * 0.05, 1.0));
  vec2 d = (c2.xy / max(c2.w, 1e-4) - c.xy / max(c.w, 1e-4)) * uRes;
  d = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float pxu = projectionMatrix[1][1] * 0.5 * uRes.y / max(-mv.z, 1e-3);
  float w = (uWidthPx * uRes.y / 1080.0 + uWidthWorld * pxu) * mix(0.4, 1.0, aW);
  c.xy += n * aSide * w * 0.5 / uRes * 2.0 * c.w;
  gl_Position = c;
  vSide = aSide; vG = aG; vW = aW; vU = aU; vStem = aStem; vL = aL;
}`;
// A crack in ice is a surface seen edge-on: a hairline that catches the light unevenly along its
// length. Cold and dim when it opens; then sunlight fills it from the upper right (uFront).
const LINE_FRAG = /* glsl */ `
uniform float uGrowth, uIntensity, uSharp, uBeadU, uBeadOn, uFront, uWarmI;
uniform vec3 uColor, uHead, uWarm;
varying float vSide, vG, vW, vU, vStem, vL;
void main() {
  float grown = smoothstep(vG - 0.003, vG + 0.003, uGrowth);
  if (grown <= 0.0) discard;
  float across = exp(-vSide * vSide * uSharp) * (1.0 - smoothstep(0.85, 1.0, abs(vSide)));
  float head = exp(-max(uGrowth - vG, 0.0) * 34.0) * (1.0 - smoothstep(0.96, 1.0, uGrowth));
  float n = 0.5 + 0.5 * sin(vL * 23.0 + 2.2 * sin(vL * 7.3) + 1.3 * sin(vL * 61.0));
  float glint = 0.5 + 0.5 * n * n;
  float fill = 1.0 - smoothstep(uFront - 0.22, uFront + 0.02, vU);
  // the wet trail the bead leaves behind it
  float trail = uBeadOn * smoothstep(uBeadU, uBeadU - 0.03, vU) * exp(-max(uBeadU - vU, 0.0) * 9.0) * vStem;
  vec3 col = uColor * uIntensity * glint * (0.5 + 0.5 * vW)
           + uWarm * uWarmI * fill * (0.45 + 0.55 * glint) * (0.4 + 0.6 * vW) * (1.0 + 1.5 * trail)
           + uHead * head * 3.0;
  gl_FragColor = vec4(col * across * grown, 0.0);
}`;

// Conchoidal side-fractures: small shell-shaped surfaces that spall off the crack as it runs, each
// with its arcs (Wallner lines), fine radial hackle and a bright rim where it stopped.
const SHELL_VERT = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aInfo;       // growth at which the crack tip passes, random, brightness lobe, stem fraction
varying vec2 vUvS;
varying vec4 vInfo;
void main() { vUvS = aUv; vInfo = aInfo; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const SHELL_FRAG = NOISE + /* glsl */ `
uniform float uGrowth, uFront, uBlade, uCold;
varying vec2 vUvS;
varying vec4 vInfo;
void main() {
  vec2 uv = vUvS; float r = length(uv); float ang = atan(uv.y, uv.x);
  float n = snoise(vec2(ang * 0.55 + vInfo.y * 20.0, vInfo.y * 7.0));
  float rim = 0.8 + 0.14 * n;
  float grow = clamp((uGrowth - vInfo.x) / 0.2, 0.0, 1.0);
  grow = 1.0 - (1.0 - grow) * (1.0 - grow);
  float reach = rim * grow;
  if (grow <= 0.0 || r > reach) discard;
  float arcs = pow(1.0 - abs(sin(r * (10.0 + 7.0 * vInfo.y) + 1.5 * n)), 5.0);
  float hackle = pow(1.0 - abs(snoise(vec2(ang * 22.0, r * 1.2 + vInfo.y * 9.0))), 8.0) * smoothstep(0.1, 0.5, r);
  float front = exp(-(reach - r) * 30.0) * (0.07 + 0.93 * (1.0 - grow));      // brightest while it is still running
  float soft = smoothstep(0.0, 0.25, reach - r);
  float body = (0.16 + 0.26 * arcs + 0.3 * hackle) * mix(1.0, 0.3, smoothstep(0.1, 1.0, r / rim)) * (0.35 + 0.65 * soft) + 0.55 * front;
  body *= smoothstep(0.0, 0.05, uv.y);
  float fill = 1.0 - smoothstep(uFront - 0.22, uFront + 0.02, vInfo.w);
  vec3 col = vec3(0.3, 0.78, 1.0) * uCold * body * vInfo.z
           + vec3(1.0, 0.66, 0.3) * uBlade * fill * body * (0.35 + 0.65 * vInfo.z) * 1.5;
  gl_FragColor = vec4(col, 0.0);
}`;

const BLADE_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUvB;
varying vec3 vWorld;
void main() { vUvB = aUv; vWorld = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const BLADE_FRAG = NOISE + /* glsl */ `
uniform float uBlade, uFront, uClock, uWhite;
uniform vec3 uSun;
varying vec2 vUvB;
varying vec3 vWorld;
void main() {
  float u = vUvB.x, v = vUvB.y;
  float fall = v < 0.0 ? exp(v * 60.0) * smoothstep(-0.12, -0.08, v) : (exp(-v * 26.0) + 0.12 * exp(-v * 7.0)) * (1.0 - smoothstep(0.75, 1.0, v));
  float along = exp(-u * 1.9);
  float front = 1.0 - smoothstep(uFront - 0.3, uFront + 0.02, u);
  float warp = snoise(vec2(u * 1.7, 3.0));
  float streak = 0.5 + 0.5 * snoise(vec2(v * 16.0 + 1.6 * warp, u * 0.7 - uClock * 0.02));
  streak = 0.3 + 0.7 * streak * streak * 1.7;
  float fine = 0.75 + 0.25 * snoise(vec2(v * 60.0, u * 2.0 + uClock * 0.05));
  float ends = smoothstep(0.0, 0.04, u) * smoothstep(1.0, 0.86, u);
  float nearK = smoothstep(0.4, 1.6, length(cameraPosition - vWorld));
  float I = uBlade * fall * (0.2 + 1.5 * along) * front * streak * fine * ends * nearK;
  gl_FragColor = vec4(vec3(1.0, 0.64, 0.27) * I * (2.4 + 4.0 * uWhite), 0.0);
}`;

const SUN_VERT = /* glsl */ `
uniform float uRadius;
varying vec2 vUvS;
void main() {
  vec4 mv = viewMatrix * vec4(modelMatrix[3].xyz, 1.0);
  mv.xy += position.xy * uRadius;
  vUvS = position.xy;
  gl_Position = projectionMatrix * mv;
}`;
const SUN_FRAG = /* glsl */ `
uniform float uI;
uniform vec3 uSun;
varying vec2 vUvS;
void main() {
  float r2 = dot(vUvS, vUvS);
  float g = exp(-r2 * 90.0) * 3.0 + exp(-r2 * 22.0) * 0.5 + exp(-r2 * 5.0) * 0.06;
  // anamorphic streak: faint, horizontal, blue (only ever on the sun blade)
  float streak = exp(-vUvS.y * vUvS.y * 900.0) * exp(-vUvS.x * vUvS.x * 2.2) * 0.5;
  float fade = 1.0 - smoothstep(0.7, 1.0, sqrt(r2));
  gl_FragColor = vec4((vec3(1.0, 0.68, 0.33) * g + vec3(0.35, 0.6, 1.0) * streak * 0.5) * uI * fade, 0.0);
}`;

const additive = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };

// ------------------------------------------------------------------------------------------ build
function buildCrack(rng) {
  // The crack is the film's LINE (lib/line.js), the same generator that draws the river, the roots
  // and the tree — here almost straight, as ice breaks: a stem from upper right to lower left with a
  // few small angular kinks and en-echelon steps, and three short wing cracks.
  const A = v3(CRACK_FROM), B = v3(CRACK_TO);
  const dir = B.clone().sub(A), len = dir.length(); dir.normalize();
  const eb = basisOf(END_POS, END_TARGET);
  const up = v3(eb.u);
  const perp = up.clone().addScaledVector(dir, -up.dot(dir)).normalize();
  const line = createLine({
    seed: 'ice-crack', from: [0, 0], to: [len, 0], segments: 320,
    meander: 0.003, wavelength: 0.6, octaves: 2, roughness: 0.5, jitter: 0.0004, pin: [0.02, 0.02],
    branches: 3, levels: 1, branchLength: 0.15, branchAngle: 24, angleJitter: 7,
    branchFrom: [0.3, 0.74], taper: 0.2, stemShare: 0.2, branchSpeed: 0.05,
  });
  // angular kinks: straight runs between a few knots, plus three abrupt en-echelon steps
  const knotS = [0, 0.1, 0.19, 0.27, 0.33, 0.4, 0.47, 0.55, 0.61, 0.69, 0.77, 0.86, 0.94, 1];
  const knotY = knotS.map((q, i) => (i === 0 || i === knotS.length - 1 ? 0 : (rng() - 0.5) * 0.085));
  const steps = [[0.36, 0.028], [0.52, -0.034], [0.66, 0.026]];
  const kink = (q) => {
    let i = 0; while (i < knotS.length - 2 && q > knotS[i + 1]) i++;
    let y = knotY[i] + (knotY[i + 1] - knotY[i]) * Math.min(1, Math.max(0, (q - knotS[i]) / (knotS[i + 1] - knotS[i])));
    for (const [q0, h] of steps) y += h * Math.min(1, Math.max(0, (q - q0) / 0.005));
    return y;
  };
  const to3 = (x, y) => A.clone().addScaledVector(dir, x).addScaledVector(perp, y);
  let run = 0;
  const lines = line.curves.map((c) => {
    const pts = [], frac = [], arc = [];
    const stemCurve = c.level === 0;
    const shift = stemCurve ? 0 : kink(c.rootS);
    for (let i = 0; i < c.n; i++) {
      const x = c.points[i * 2];
      pts.push(to3(x, c.points[i * 2 + 1] + (stemCurve ? kink(x / len) : shift)));
      frac.push(c.cum[i] / c.length);
      arc.push(run + c.cum[i]);
    }
    run += c.length + 3.7;
    return { pts, frac, arc, g0: c.start, g1: c.end, w0: c.width(0), w1: c.width(1), stem: stemCurve, rootS: c.rootS };
  });
  const stem = lines[0].pts;
  const N = stem.length - 1;
  // ribbon geometry
  let nPts = 0; for (const l of lines) nPts += l.pts.length;
  const pos = new Float32Array(nPts * 6), tan = new Float32Array(nPts * 6), side = new Float32Array(nPts * 2);
  const gA = new Float32Array(nPts * 2), wA = new Float32Array(nPts * 2), uA = new Float32Array(nPts * 2);
  const sA = new Float32Array(nPts * 2), lA = new Float32Array(nPts * 2);
  const idx = [];
  let v = 0;
  for (const l of lines) {
    const n = l.pts.length;
    for (let i = 0; i < n; i++) {
      const p = l.pts[i], a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(n - 1, i + 1)];
      const t = b.clone().sub(a).normalize();
      const f = l.frac[i];
      for (let s = 0; s < 2; s++) {
        pos.set([p.x, p.y, p.z], v * 3); tan.set([t.x, t.y, t.z], v * 3);
        side[v] = s ? 1 : -1;
        gA[v] = l.g0 + (l.g1 - l.g0) * f;
        wA[v] = l.w0 + (l.w1 - l.w0) * f;
        uA[v] = l.stem ? f : l.rootS;
        sA[v] = l.stem ? 1 : 0;
        lA[v] = l.arc[i];
        v++;
      }
      if (i < n - 1) { const q = v - 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aTan', new THREE.BufferAttribute(tan, 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setAttribute('aG', new THREE.BufferAttribute(gA, 1));
  geo.setAttribute('aW', new THREE.BufferAttribute(wA, 1));
  geo.setAttribute('aU', new THREE.BufferAttribute(uA, 1));
  geo.setAttribute('aStem', new THREE.BufferAttribute(sA, 1));
  geo.setAttribute('aL', new THREE.BufferAttribute(lA, 1));
  geo.setIndex(idx);
  // the lit fracture sheet behind the crack line: from the line away from the camera and upward
  const W = v3(eb.f).multiplyScalar(0.86).addScaledVector(up, 0.5).normalize();
  const M2 = 64, bp = new Float32Array((M2 + 1) * 6), buv = new Float32Array((M2 + 1) * 4), bidx = [];
  for (let i = 0; i <= M2; i++) {
    const f = i / M2;
    // smoothed stem
    const c = new THREE.Vector3();
    let wsum = 0;
    for (let k = -14; k <= 14; k++) { const j = Math.min(N, Math.max(0, Math.round(f * N) + k * 3)); c.add(stem[j]); wsum++; }
    c.multiplyScalar(1 / wsum);
    const depth = 3.6 - 1.6 * f;
    const far = c.clone().addScaledVector(W, depth), nearP = c.clone().addScaledVector(W, -0.12 * depth);
    bp.set([nearP.x, nearP.y, nearP.z, far.x, far.y, far.z], i * 6);
    buv.set([f, -0.12, f, 1], i * 4);
    if (i < M2) { const q = i * 2; bidx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.BufferAttribute(bp, 3));
  blade.setAttribute('aUv', new THREE.BufferAttribute(buv, 2));
  blade.setIndex(bidx);
  // conchoidal shells along the stem, to either side, each in its own plane through the crack line
  const SH = 8, sp = new Float32Array(SH * 12), suv = new Float32Array(SH * 8), sinfo = new Float32Array(SH * 16), sidx = [];
  const Hend = v3(SUN_DIR).add(v3(eb.f).multiplyScalar(-1)).normalize();
  for (let k = 0; k < SH; k++) {
    const f = 0.29 + 0.5 * ((k + 0.2 + 0.6 * rng()) / SH);
    const i = Math.round(f * N);
    const root = stem[i], T = stem[Math.min(N, i + 6)].clone().sub(stem[Math.max(0, i - 6)]).normalize();
    const side = k % 2 ? 1 : -1, a = 0.15 + rng() * 0.95;     // always leaning away from the camera: never in front of the seed
    const Q = perp.clone().multiplyScalar(side * Math.cos(a)).addScaledVector(W, Math.sin(a)).normalize();
    const R = 0.2 + 0.36 * rng() * rng();
    const nrm = new THREE.Vector3().crossVectors(T, Q).normalize();
    const lobe = 0.3 + 0.7 * Math.pow(Math.abs(nrm.dot(Hend)), 1.5);
    const rnd = rng();
    [[-1, 0], [1, 0], [1, 1.05], [-1, 1.05]].forEach(([x, y], j) => {
      const p = root.clone().addScaledVector(T, x * R).addScaledVector(Q, y * R);
      sp.set([p.x, p.y, p.z], (k * 4 + j) * 3);
      suv.set([x, y], (k * 4 + j) * 2);
      sinfo.set([0.2 * f + 0.004, rnd, lobe, f], (k * 4 + j) * 4);
    });
    sidx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  }
  const shells = new THREE.BufferGeometry();
  shells.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  shells.setAttribute('aUv', new THREE.BufferAttribute(suv, 2));
  shells.setAttribute('aInfo', new THREE.BufferAttribute(sinfo, 4));
  shells.setIndex(sidx);
  return { geo, blade, shells, stem };
}

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(lensToFov(ICE_LENS, ctx.aspect), ctx.aspect, 0.05, 600);
  scene.add(camera);
  const rng = createRng(ctx.seed);

  // ---- the pose from which the credit aligns -------------------------------------------------
  const pose15 = icePose(T_ALIGN);
  const b15 = basisOf(pose15.pos, pose15.target);
  const tanH = 24.89 / (2 * ICE_LENS);               // tan of half the horizontal field of view
  const P15 = v3(pose15.pos), R15 = v3(b15.r), U15 = v3(b15.u), F15 = v3(b15.f);
  const Cend = v3(END_POS);

  // ---- uniforms shared by everything ----------------------------------------------------------
  const U = {
    uClock: { value: 0 }, uReveal: { value: 1 }, uLight: { value: 0.05 }, uCaustic: { value: 0 },
    uAlign: { value: 0 }, uBandX: { value: -1 }, uBandW: { value: 0.03 }, uBandAmp: { value: 0 },
    uBlade: { value: 0 }, uWhite: { value: 0 }, uFreeze: { value: 1 }, uWindAge: { value: 0 },
    uFocus: { value: 26 }, uApK: { value: BOKEH_K }, uSeedGlowNow: { value: 0 }, uFlash: { value: 0 },
    uCredits: { value: 0 },
    uP15: { value: P15 }, uR15: { value: R15 }, uF15: { value: F15 }, uCend: { value: Cend },
    uSeedPos: { value: new THREE.Vector3() },
    uAmber: { value: lin(PALETTE.amber) }, uSun: { value: lin(PALETTE.sunBlade) },
    uCrackA: { value: v3(CRACK_FROM) }, uCrackB: { value: v3(CRACK_TO) },
    uSunDir: { value: v3(SUN_DIR) },
  };
  const grainUniforms = {};
  for (const k of ['uClock', 'uReveal', 'uLight', 'uCaustic', 'uAlign', 'uBandX', 'uBandW', 'uBandAmp', 'uBlade', 'uWhite', 'uFreeze', 'uWindAge', 'uFocus', 'uApK', 'uSeedGlowNow', 'uP15', 'uR15', 'uF15', 'uCend', 'uSeedPos', 'uAmber', 'uSun', 'uCrackA', 'uCrackB']) grainUniforms[k] = U[k];

  // ---- background: the body of the ice (and the night sky of W6) ------------------------------
  const bgMat = new THREE.ShaderMaterial({
    name: 'ice-volume', vertexShader: BG_VERT, fragmentShader: BG_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false,
    uniforms: {
      uClock: U.uClock, uLight: U.uLight, uCaustic: U.uCaustic, uBandX: U.uBandX, uBandW: U.uBandW, uBandAmp: U.uBandAmp,
      uBlade: U.uBlade, uWhite: U.uWhite, uFreeze: U.uFreeze, uCredits: U.uCredits, uReveal: U.uReveal,
      uP15: U.uP15, uR15: U.uR15, uF15: U.uF15, uSunDir: U.uSunDir, uSun: U.uSun,
      uVoid: { value: new THREE.Vector3(0.0016, 0.0035, 0.008) },
      uDeep: { value: new THREE.Vector3(0.007, 0.021, 0.042) },
      uMid: { value: new THREE.Vector3(0.014, 0.062, 0.12) },
      uGlow: { value: new THREE.Vector3(0.03, 0.3, 0.56) },
      uNight: { value: new THREE.Vector3(0.0165, 0.0205, 0.031) },   // #050A18 after the prologue's grade   // matched to the moonlit sky S20 ends on
    },
  });
  const bg = new THREE.Mesh(new THREE.IcosahedronGeometry(100, 3), bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -100;
  scene.add(bg);

  // ---- bubbles ---------------------------------------------------------------------------------
  const NB = N_BUBBLES + N_NEAR;
  const bPos = new Float32Array(NB * 3), bProp = new Float32Array(NB * 4);
  const brng = rng.fork('bubbles');
  const endB = basisOf(END_POS, END_TARGET);
  const tmp = new THREE.Vector3(), rel = new THREE.Vector3();
  // camera path samples: nothing may sit on the lens or in the sight-line to the seed
  const pathPts = [];
  for (let t = 0; t <= 30; t += 0.2) pathPts.push(v3(icePose(t).pos));
  const tooClose = (p) => {
    if (p.length() < 1.15) return true;                                   // inside the silk
    for (let i = 0; i < pathPts.length; i++) if (pathPts[i].distanceToSquared(p) < 0.45 * 0.45) return true;
    rel.copy(p).sub(Cend);                                                // the cone from the final camera to the seed
    const d = rel.dot(v3(endB.f));
    if (d > 0 && d < 3.6) { const lat = Math.sqrt(Math.max(0, rel.lengthSq() - d * d)); if (lat < 0.25 + 0.2 * d) return true; }
    rel.copy(p).sub(P15);                                                 // big discs in front of the credit
    const dz = rel.dot(F15);
    if (dz > 0 && dz < 9 && Math.abs(rel.dot(R15)) < dz * tanH * 0.75 && Math.abs(rel.dot(U15)) < dz * 0.06 + 0.4) return true;
    return false;
  };
  const sizeOf = () => 0.0042 * Math.exp(Math.pow(brng(), 2.8) * 3.0);   // log-distributed diameters, 0.004 .. 0.085
  for (let i = 0; i < NB; i++) {
    let p;
    for (let guard = 0; guard < 50; guard++) {
      if (i < N_BUBBLES) {
        const band = brng() < 0.3;
        tmp.set(brng.range(-40, 22), brng.range(-13, 17), brng.range(-24, 58));
        if (band) {
          // bubble-rich layers: thin wavy sheets, as glacier ice has
          const layer = Math.floor(brng() * 3);
          const y0 = [-4.5, 3.2, 9.5][layer];
          tmp.y = y0 + 0.16 * tmp.x * (layer - 1) * 0.6 + 1.3 * Math.sin(tmp.x * 0.11 + layer * 2.0) * Math.cos(tmp.z * 0.07 + layer) + brng.gauss(0, 0.5);
        }
      } else {
        const c = pathPts[Math.floor(brng() * pathPts.length)];
        const r = 0.7 + 6.3 * Math.pow(brng(), 1.5), d = brng.onSphere();
        tmp.set(c.x + d[0] * r, c.y + d[1] * r * 0.7, c.z + d[2] * r);
      }
      p = tmp;
      if (!tooClose(p)) break;
    }
    bPos.set([p.x, p.y, p.z], i * 3);
    const sz = sizeOf();
    const bright = 0.06 * Math.pow(sz / 0.006, 1.8) * (0.5 + brng());       // 0.02 .. 10: a few HDR highlights among many faint points
    const role = brng() < 0.4 ? 3 : 2;                                     // W6 role: seed tuft or snowflake
    bProp.set([sz, bright, role, brng()], i * 4);
  }
  const bubbles = createParticles({
    count: NB, seed: ctx.seed ^ 0xb0b1, name: 'ice-bubbles',
    attributes: { aPos: { itemSize: 3, array: bPos }, aProp: { itemSize: 4, array: bProp } },
    uniforms: { ...grainUniforms, uShutter: { value: new THREE.Matrix4() }, uGain: { value: 1 }, uWindAge: { value: 0 } },
    glsl: GRAIN_GLSL, position: BUBBLE_POS, fragment: BUBBLE_FRAG, minPixelSize: 0.5,
  });
  bubbles.mesh.layers.set(FX_LAYER);
  scene.add(bubbles.mesh);
  // motion blur for the grains: the same instances drawn SHUTTER_TAPS times, each as seen from the
  // camera's pose (and the wind's state) at an earlier instant within a 180° shutter
  const shutter = [{ mesh: bubbles.mesh, uShutter: bubbles.uniforms.uShutter, uGain: bubbles.uniforms.uGain, uWindAge: bubbles.uniforms.uWindAge }];
  for (let i = 1; i < SHUTTER_TAPS; i++) {
    const u = { ...bubbles.material.uniforms, uShutter: { value: new THREE.Matrix4() }, uGain: { value: 1 }, uWindAge: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      name: 'ice-bubbles-tap', uniforms: u, vertexShader: bubbles.material.vertexShader, fragmentShader: bubbles.material.fragmentShader,
      transparent: true, depthTest: true, depthWrite: false, premultipliedAlpha: true, ...additive,
    });
    const mesh = new THREE.Mesh(bubbles.geometry, mat);
    mesh.frustumCulled = false;
    mesh.onBeforeRender = bubbles.mesh.onBeforeRender;
    mesh.layers.set(FX_LAYER);
    scene.add(mesh);
    shutter.push({ mesh, uShutter: u.uShutter, uGain: u.uGain, uWindAge: u.uWindAge, mat });
  }
  const tapCam = new THREE.PerspectiveCamera();

  // ---- C0: the credit, made of bubbles that only line up from the camera's place at 15.0 s ----
  const sample = sampleTextPoints(CREDIT_TEXT, { lang: 'en', size: 240, step: 3, tracking: 0.12, jitter: 0.9, threshold: 0.6, seed: 'credit' });
  const fitted = fitPointsToCount(sample, N_TEXT, { seed: 'credit-fit', spread: 0.012 });
  const textW = sample.width - 0.5;                                  // em (sampleTextPoints pads 0.25 em each side)
  const k = (CREDIT_WIDTH * 2 * tanH) / textW;                       // em -> tangent units
  const tPos = new Float32Array(N_TEXT * 3), tProp = new Float32Array(N_TEXT * 4);
  const trng = rng.fork('credit');
  for (let i = 0; i < N_TEXT; i++) {
    const tx = fitted[i * 3] * k, ty = fitted[i * 3 + 1] * k;
    // random depth 9..40 units, uniform in 1/depth, so that a sideways step of the camera spreads the
    // grains evenly across the frame (parallax is proportional to 1/depth)
    const depth = 1 / (1 / 40 + (1 / 9 - 1 / 40) * trng());
    tmp.copy(F15).addScaledVector(R15, tx).addScaledVector(U15, ty).multiplyScalar(depth).add(P15);
    tPos.set([tmp.x, tmp.y, tmp.z], i * 3);
    const big = Math.pow(trng(), 2.6);
    const ang = 0.00078 * (0.6 + 1.25 * big);                        // angular diameter: about 1.3 .. 3.9 px at 1080p
    tProp.set([ang * depth, 0.2 + 0.75 * big + 0.22 * trng(), tx, trng()], i * 4);
  }
  const credit = createParticles({
    count: N_TEXT, seed: ctx.seed ^ 0xc0c0, name: 'ice-credit',
    attributes: { aPos: { itemSize: 3, array: tPos }, aProp: { itemSize: 4, array: tProp } },
    uniforms: { ...grainUniforms, uShutter: { value: new THREE.Matrix4() }, uGain: { value: 1 } }, glsl: GRAIN_GLSL, position: TEXT_POS, fragment: BUBBLE_FRAG, minPixelSize: 0.5,
  });
  credit.mesh.layers.set(FX_LAYER);
  scene.add(credit.mesh);
  const BAND_HALF = CREDIT_WIDTH * tanH;                               // text half-width in tangent units

  // ---- fracture planes ---------------------------------------------------------------------------
  const planes = [];
  const prng = rng.fork('planes');
  const sun = v3(SUN_DIR);
  const addPlane = (center, normal, size, opt = {}) => {
    const n = normal.clone().normalize();
    const t = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const b = new THREE.Vector3().crossVectors(n, t);
    const pos = new Float32Array(12), uv = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], i) => {
      const p = center.clone().addScaledVector(t, x * size).addScaledVector(b, y * size);
      pos.set([p.x, p.y, p.z], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mat = new THREE.ShaderMaterial({
      name: 'ice-fracture', vertexShader: PLANE_VERT, fragmentShader: PLANE_FRAG, side: THREE.DoubleSide, depthTest: true, ...additive,
      uniforms: {
        uClock: U.uClock, uFlash: U.uFlash, uLight: U.uLight, uCaustic: U.uCaustic, uBlade: U.uBlade, uFreeze: U.uFreeze,
        uSunDir: U.uSunDir, uSun: U.uSun,
        uN: { value: n }, uT: { value: t }, uB: { value: b },
        uOff: { value: new THREE.Vector2(prng.range(-20, 20), prng.range(-20, 20)) },
        uOrigin: { value: new THREE.Vector2(prng.range(-0.8, 0.8), prng.range(-0.8, 0.8)) },
        uRipple: { value: opt.ripple ?? prng.range(14, 30) }, uShine: { value: opt.shine ?? prng.range(300, 700) }, uGain: { value: opt.gain ?? 1 },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -50;
    scene.add(mesh);
    planes.push(mesh);
  };
  const mirrorNormal = (center, camPos, skew = 0) => {
    // the normal that reflects the sun into a camera at camPos (plus a little skew)
    const V = camPos.clone().sub(center).normalize();
    return V.add(sun).normalize().add(new THREE.Vector3(prng.range(-1, 1), prng.range(-1, 1), prng.range(-1, 1)).multiplyScalar(skew));
  };
  {
    // the hero: flashes across the frame at 20.5 s
    const p = icePose(20.5), bb = basisOf(p.pos, p.target);
    const c = v3(p.pos).addScaledVector(v3(bb.f), 10).addScaledVector(v3(bb.r), 1.5).addScaledVector(v3(bb.u), 0.4);
    addPlane(c, mirrorNormal(c, v3(p.pos)), 16, { shine: 300, gain: 2.0, ripple: 22 });
    // two that answer it a little later, deeper in
    for (const [tt, dist, side] of [[21.3, 13, -4], [22.4, 12, 3.5]]) {
      const q = icePose(tt), qb = basisOf(q.pos, q.target);
      const c2 = v3(q.pos).addScaledVector(v3(qb.f), dist).addScaledVector(v3(qb.r), side).addScaledVector(v3(qb.u), -1);
      addPlane(c2, mirrorNormal(c2, v3(q.pos), 0.05), 12, { gain: 0.8 });
    }
    // behind the seed, for the close-up: soft glints that give the blue its structure
    const eb = basisOf(END_POS, END_TARGET);
    const c3 = new THREE.Vector3().addScaledVector(v3(eb.f), 7).addScaledVector(v3(eb.r), -3.2).addScaledVector(v3(eb.u), 1.4);
    addPlane(c3, mirrorNormal(c3, Cend, 0.035), 9, { shine: 240, gain: 0.32, ripple: 26 });
    const c4 = new THREE.Vector3().addScaledVector(v3(eb.f), 13).addScaledVector(v3(eb.r), 4.5).addScaledVector(v3(eb.u), -2.0);
    addPlane(c4, mirrorNormal(c4, Cend, 0.05), 12, { shine: 300, gain: 0.4 });
    // and a few at random tilts that only show if the light happens to find them
    for (let i = 0; i < 3; i++) {
      const c5 = new THREE.Vector3(prng.range(-14, 4), prng.range(-3, 5), prng.range(2, 26));
      addPlane(c5, new THREE.Vector3(...prng.onSphere()), prng.range(8, 14), { gain: 0.8 });
    }
  }

  // ---- the seed ----------------------------------------------------------------------------------
  const seed = createSeed();
  seed.group.scale.setScalar(SEED_SCALE);
  // side view, blunt (silk) end toward the upper right where the light will come from, dorsal crest up
  seed.group.rotation.set(0.16, -0.2, 0.6, 'ZYX');
  scene.add(seed.group);

  // ---- the crack, the blade of sunlight, the bead --------------------------------------------------
  const crack = buildCrack(rng.fork('crack'));
  const res = new THREE.Vector2(1920, 1080);
  const onRes = (renderer) => { const rt = renderer.getRenderTarget(); if (rt) res.set(rt.width, rt.height); else renderer.getDrawingBufferSize(res); };
  const lineMat = (widthPx, widthWorld, sharp) => new THREE.ShaderMaterial({
    name: 'ice-crack', vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, depthTest: true, side: THREE.DoubleSide, ...additive,
    uniforms: {
      uWidthPx: { value: widthPx }, uWidthWorld: { value: widthWorld }, uSharp: { value: sharp }, uRes: { value: res },
      uGrowth: { value: 0 }, uIntensity: { value: 1 }, uColor: { value: new THREE.Vector3(0.5, 0.86, 1) }, uHead: { value: new THREE.Vector3(0.8, 0.95, 1).multiplyScalar(widthPx < 3 ? 1 : 0.02) },
      uBeadU: { value: 0 }, uBeadOn: { value: 0 }, uFront: { value: 0 }, uWarmI: { value: 0 }, uWarm: { value: new THREE.Vector3(1.0, 0.82, 0.55) },
    },
  });
  const crackCore = new THREE.Mesh(crack.geo, lineMat(1.6, 0.0026, 3.2));
  const crackGlow = new THREE.Mesh(crack.geo, lineMat(6, 0.05, 5.0));
  for (const m of [crackCore, crackGlow]) { m.frustumCulled = false; m.layers.set(FX_LAYER); m.onBeforeRender = onRes; m.renderOrder = 10; scene.add(m); }
  const shellMat = new THREE.ShaderMaterial({
    name: 'ice-crack-shells', vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, depthTest: true, side: THREE.DoubleSide, ...additive,
    uniforms: { uGrowth: { value: 0 }, uFront: { value: 0 }, uBlade: U.uBlade, uCold: { value: 0.2 } },
  });
  const shells = new THREE.Mesh(crack.shells, shellMat);
  shells.frustumCulled = false; shells.layers.set(FX_LAYER); shells.renderOrder = 9;
  scene.add(shells);
  const bladeMat = new THREE.ShaderMaterial({
    name: 'ice-blade', vertexShader: BLADE_VERT, fragmentShader: BLADE_FRAG, depthTest: true, side: THREE.DoubleSide, ...additive,
    uniforms: { uBlade: U.uBlade, uFront: { value: 0 }, uClock: U.uClock, uWhite: U.uWhite, uSun: U.uSun },
  });
  const blade = new THREE.Mesh(crack.blade, bladeMat);
  blade.frustumCulled = false; blade.layers.set(FX_LAYER); blade.renderOrder = 8;
  scene.add(blade);
  const sunMat = new THREE.ShaderMaterial({
    name: 'ice-sun', vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, depthTest: false, ...additive,
    uniforms: { uRadius: { value: 5 }, uI: { value: 0 }, uSun: U.uSun },
  });
  const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sunMat);
  sunGlow.position.copy(v3(CRACK_FROM));
  sunGlow.frustumCulled = false; sunGlow.layers.set(FX_LAYER); sunGlow.renderOrder = 12;
  scene.add(sunGlow);
  const whiteMat = new THREE.ShaderMaterial({
    name: 'ice-white', depthTest: false, ...additive,
    uniforms: { uWhite: U.uWhite },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float uWhite; void main() { float k = smoothstep(0.3, 1.0, uWhite); gl_FragColor = vec4(vec3(1.0, 0.76, 0.44) * (k * k * 1.5 + pow(k, 24.0) * 60.0), 0.0); }',
  });
  const white = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), whiteMat);
  white.frustumCulled = false; white.layers.set(FX_LAYER); white.renderOrder = 100;
  scene.add(white);

  const bead = createParticles({
    count: 1, seed: 5, name: 'ice-bead',
    uniforms: { uBeadPos: { value: new THREE.Vector3() }, uBeadSize: { value: 0 }, uBeadCol: { value: new THREE.Vector3(1, 1, 1) }, uBeadDir: { value: new THREE.Vector2(0, -1) } },
    glsl: /* glsl */ `uniform vec3 uBeadPos; uniform float uBeadSize; uniform vec3 uBeadCol; uniform vec2 uBeadDir;`,
    position: /* glsl */ `pos = uBeadPos; size = uBeadSize; color = vec4(uBeadCol, uBeadSize > 0.0 ? 1.0 : 0.0);`,
    // a drop of water as a lens: dark heart, bright inverted crescent, a hard specular point
    fragment: /* glsl */ `
      vec2 q = uv * 1.3;
      float along = dot(q, uBeadDir);
      q -= uBeadDir * 0.3 * max(-along, 0.0) * abs(along);            // drawn out a little behind it
      float r = length(q);
      float body = 1.0 - smoothstep(0.86, 1.0, r);
      float rim = smoothstep(0.6, 0.97, r) * body;
      // a drop is a lens: the light of the blade above it shows upside down, low in the bead
      float low = smoothstep(0.75, -0.55, dot(normalize(q + 1e-4), normalize(vec2(0.35, 0.94))));
      float lensed = body * low * smoothstep(0.15, 0.85, r);
      vec2 sp = q - vec2(-0.28, 0.36);
      float spec = exp(-dot(sp, sp) * 70.0);
      float a = lensed * 1.5 + rim * 0.35 + spec * 10.0 + body * 0.1;
      col = vec4(vColor.rgb * a, 0.0);`,
  });
  bead.mesh.layers.set(FX_LAYER);
  bead.mesh.renderOrder = 11;
  scene.add(bead.mesh);

  // ---- S22: a few dozen grains at 6% behind the end credits ------------------------------------
  const creditGrains = createParticles({
    count: 44, seed: ctx.seed ^ 0xe22, name: 'ice-credit-grains',
    uniforms: { uFadeC: { value: 0 }, uTc: { value: 0 } },
    glsl: /* glsl */ `uniform float uFadeC; uniform float uTc; varying float vBlend;`,
    position: /* glsl */ `
      vec3 home = vec3((seed.x - 0.5) * 2.4, (seed.y - 0.5) * 0.9, -1.0) * (4.0 + 24.0 * seed.z * seed.z);
      vec3 vel = vec3(0.05 + 0.05 * seed.w, 0.035 * (seed.x - 0.3), 0.0) * (0.3 + seed.z) * 6.0;
      vec3 p = home + vel * (uTc - 6.0) + 0.15 * vec3(sin(uTc * 0.21 + seed.x * 30.0), cos(uTc * 0.17 + seed.y * 30.0), 0.0);
      pos = (inverse(viewMatrix) * vec4(p, 1.0)).xyz;
      float z = -p.z;
      float resK = uResolution.y / 1080.0;
      float pxu = projectionMatrix[1][1] * 0.5 * uResolution.y / z;
      float blur = 40.0 * abs(1.0 / z - 1.0 / 9.0) * resK;
      float d0 = 2.2 * resK * (0.6 + seed.w);
      float b = smoothstep(0.6, 2.2, blur / d0);
      float q = mix(d0 * 3.4, 2.3 * (blur + 0.5 * d0), b);
      size = q / pxu;
      color = vec4(vec3(0.72, 0.89, 1.0) * mix(0.24, 0.075, b) * (0.6 + 0.8 * seed.y), uFadeC);
      vBlend = b;`,
    fragment: /* glsl */ `
      vec4 cP;
      ${SKIN('point')} cP = col;
      ${SKIN('bubble')}
      col = mix(cP, col, vBlend);`,
  });
  creditGrains.mesh.layers.set(FX_LAYER);
  scene.add(creditGrains.mesh);

  // ---- W6: the fixed stars (they fade as the sky turns to ice) and the hero seed seen as a tuft ---
  const skyStars = createParticles({
    count: 80000, seed: ctx.seed ^ 0x57a2, name: 'ice-sky-stars',
    uniforms: { uFreeze: U.uFreeze, uClock: U.uClock },
    glsl: /* glsl */ `uniform float uFreeze; uniform float uClock;`,
    position: /* glsl */ `
      float zc = seed.x * 2.0 - 1.0, ph = seed.y * 6.2831853, rr = sqrt(max(1.0 - zc * zc, 0.0));
      pos = cameraPosition + vec3(rr * cos(ph), zc, rr * sin(ph)) * 90.0;
      float m = pow(seed.z, 5.0);
      size = 90.0 * (0.0016 + 0.0034 * m);
      float tw = 0.8 + 0.2 * sin(uClock * (2.0 + 5.0 * seed.w) + seed.x * 60.0);
      float k = 1.0 - uFreeze;
      color = vec4(vec3(0.86, 0.92, 1.0) * (0.3 + 1.8 * m) * tw, k * k);`,
    fragment: GRAIN_FRAG.point, minPixelSize: 1.2,
  });
  skyStars.mesh.layers.set(FX_LAYER);
  scene.add(skyStars.mesh);
  const heroTuft = createParticles({
    count: 1, seed: 9, name: 'ice-hero-tuft',
    uniforms: { uHeroPos: { value: new THREE.Vector3() }, uHeroCol: { value: new THREE.Vector4(1, 0.7, 0.3, 0) } },
    glsl: /* glsl */ `uniform vec3 uHeroPos; uniform vec4 uHeroCol;`,
    position: /* glsl */ `pos = uHeroPos; float zz = length(uHeroPos - cameraPosition); size = zz * 0.016; color = uHeroCol;`,
    fragment: GRAIN_FRAG.tuft, depthTest: false,
  });
  heroTuft.mesh.layers.set(FX_LAYER);
  scene.add(heroTuft.mesh);

  // ---- per-frame ----------------------------------------------------------------------------------
  const post = { dof: { focus: 26, aperture: 0.1, maxBlur: DOF_MAX } };
  const sunV = v3(SUN_DIR), keyDir = new THREE.Vector3(), topDir = new THREE.Vector3(-0.25, 0.9, 0.35).normalize();
  const stemAt = (f) => {
    const x = Math.min(0.9999, Math.max(0, f)) * (crack.stem.length - 1), i = Math.floor(x);
    return crack.stem[i].clone().lerp(crack.stem[i + 1], x - i);
  };
  const lerp = (a, b, x) => a + (b - a) * x;
  const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

  return {
    scene, camera,
    post: () => post,
    update(t, localT, shot, params) {
      const p = { ...DEFAULTS, ...params };
      const clock = p.clock ?? t;
      const credits = p.credits > 0.5;
      U.uClock.value = clock;
      U.uReveal.value = p.reveal;
      U.uLight.value = p.lightLevel * (1 - 0.85 * sm(0.1, 0.75, p.whiteOut));   // as the sun takes over, the blue falls away
      U.uCaustic.value = p.causticAmount;
      U.uFlash.value = p.fractureFlash;
      U.uAlign.value = p.creditAlign;
      U.uBandX.value = lerp(-1.3, 1.3, p.creditSweep) * BAND_HALF;
      U.uBandW.value = BAND_HALF * 0.3;
      U.uBandAmp.value = sm(0, 0.05, p.creditSweep) * (1 - sm(0.95, 1, p.creditSweep));
      U.uBlade.value = p.bladeIntensity;
      U.uWhite.value = p.whiteOut;
      U.uFreeze.value = p.freeze;
      U.uWindAge.value = p.windAge;
      U.uFocus.value = p.focusDistance;
      U.uApK.value = BOKEH_K * p.aperture;
      U.uCredits.value = credits ? 1 : 0;

      // depth of field for the solid objects, matched to the grains' thin-lens bokeh
      post.dof.focus = p.focusDistance;
      post.dof.maxBlur = DOF_MAX;
      post.dof.aperture = credits ? 0.0001 : (BOKEH_K * p.aperture) / (p.focusDistance * DOF_MAX);

      // the seed
      const drift = p.seedDrift;
      seed.group.position.set(SEED_DRIFT_FROM[0] * drift, SEED_DRIFT_FROM[1] * drift, SEED_DRIFT_FROM[2] * drift);
      // far out on the wind the hero is a tuft like the others: a point of light, no silhouette
      seed.group.scale.setScalar(SEED_SCALE * (1 - 0.8 * sm(0.08, 0.8, drift)));
      const bl = p.bladeIntensity, L = p.lightLevel, fr = p.freeze;
      keyDir.copy(topDir).lerp(sunV, Math.min(1, bl * 1.6)).normalize();
      const found = sm(0.05, 0.2, L) * fr + (1 - fr);     // in the dark of S01/S02 the seed is not there to be seen
      const keyI = ((0.25 + 2.2 * L) * fr + 0.25 * (1 - fr)) * found;
      seed.set({
        glow: p.seedGlow, silkSpread: p.silkSpread, ice: p.seedIce,
        lightDir: [keyDir.x, keyDir.y, keyDir.z],
        lightColor: [0.5 * keyI + 2.6 * bl, 0.8 * keyI + 1.9 * bl, 1.0 * keyI + 1.0 * bl],
        pulseFloor: 0.045,
        ambient: [((0.03 + 0.25 * L) * fr + 0.03) * found, ((0.1 + 0.75 * L) * fr + 0.05) * found, ((0.16 + 0.95 * L) * fr + 0.1) * found],
        silkOpacity: found,
        dof: post.dof,
      });
      seed.update(t);
      seed.group.visible = !credits;
      U.uSeedPos.value.copy(seed.group.position);
      U.uSeedGlowNow.value = seed.parts.halo.material.uniforms.uGlowNow.value;

      // crack, blade, bead
      const g = p.crackGrowth;
      const warm = Math.min(1, bl * 1.6);
      const front = Math.min(1.4, (bl / 0.8) * 1.4);          // how far down the crack the sunlight has poured
      for (const [m, cold, warmI] of [[crackCore, 2.4 + 1.6 * L, 6.5 * bl + 12 * p.whiteOut], [crackGlow, 0.012, 0.16 * bl + 0.4 * p.whiteOut]]) {
        const u = m.material.uniforms;
        u.uGrowth.value = g;
        u.uIntensity.value = cold;
        u.uWarmI.value = warmI;
        u.uFront.value = front;
        m.visible = g > 0 && !credits;
      }
      shellMat.uniforms.uGrowth.value = g;
      shellMat.uniforms.uFront.value = front;
      shellMat.uniforms.uCold.value = 0.16 + 0.3 * L;
      shells.visible = g > 0 && !credits;
      bladeMat.uniforms.uFront.value = front;
      blade.visible = bl > 0 && !credits;
      sunMat.uniforms.uI.value = bl * bl * 3 + Math.pow(p.whiteOut, 5) * 30;
      sunMat.uniforms.uRadius.value = 6;
      sunGlow.visible = bl > 0 && !credits;
      white.visible = p.whiteOut > 0;
      const bd = p.bead;
      const beadOn = bd > 0 && bd < 1 && !credits;
      bead.mesh.visible = beadOn;
      if (beadOn) {
        const f = lerp(BEAD_FROM, 0.93, bd * bd * (0.55 + 0.45 * bd));
        const bp = stemAt(f), bp2 = stemAt(f + 0.01);
        bead.uniforms.uBeadPos.value.copy(bp);
        bead.uniforms.uBeadSize.value = 0.09 * sm(0, 0.05, bd) * (1 - sm(0.93, 1, bd));
        bead.uniforms.uBeadCol.value.set(1.0, 0.92, 0.78).multiplyScalar(1.2 + 2.5 * bl);
        // screen-space direction of travel (for the bead's tail)
        const a = bp.clone().project(camera), b2 = bp2.clone().project(camera);
        bead.uniforms.uBeadDir.value.set(b2.x - a.x, (b2.y - a.y) / camera.aspect).normalize();
        for (const m of [crackCore, crackGlow]) { m.material.uniforms.uBeadU.value = f; m.material.uniforms.uBeadOn.value = sm(0, 0.15, bd) * (1 - sm(0.8, 1, bd)); }
      } else {
        for (const m of [crackCore, crackGlow]) m.material.uniforms.uBeadOn.value = 0;
      }

      skyStars.mesh.visible = !credits && p.freeze < 0.999;
      heroTuft.mesh.visible = !credits && p.freeze < 0.999 && drift > 0.02;
      heroTuft.uniforms.uHeroPos.value.copy(seed.group.position);
      heroTuft.uniforms.uHeroCol.value.set(1.6, 1.0, 0.42, sm(0.02, 0.5, drift) * (1 - fr));
      // shutter taps: where was the camera (and the wind) k/TAPS of half a frame ago?
      const windRate = shot && shot.params && typeof shot.params.windAge === 'function'
        ? shot.params.windAge(0, t - 1 / 120, shot) - p.windAge : 0;       // wind-seconds per 1/120 s (positive going back)
      let moving = windRate > 1e-5 && p.windAge > 0;
      for (let i = 0; i < shutter.length; i++) {
        const dt = (i / SHUTTER_TAPS) * (0.5 / ctx.fps);
        const tap = shutter[i];
        tap.uWindAge.value = p.windAge + windRate * dt * 120;
        if (i === 0) { tap.uShutter.value.identity(); continue; }
        const pose = shot && shot.camera && shot.camera.position === iceCameraPosition ? icePose(t - dt) : null;
        if (pose) {
          tapCam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
          tapCam.up.set(0, 1, 0);
          tapCam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
          tapCam.updateMatrixWorld();
          tap.uShutter.value.copy(camera.matrixWorld).multiply(tapCam.matrixWorldInverse);
          if (i === shutter.length - 1 && (tapCam.position.distanceTo(camera.position) > 2e-4 || Math.abs(tapCam.quaternion.dot(camera.quaternion)) < 0.9999999)) moving = true;
        } else tap.uShutter.value.identity();
      }
      for (let i = 0; i < shutter.length; i++) {
        shutter[i].mesh.visible = !credits && (i === 0 || moving);
        shutter[i].uGain.value = moving ? 1 / shutter.length : 1;
      }
      credit.mesh.visible = !credits && p.freeze > 0.25;
      for (const m of planes) m.visible = !credits && p.fractureFlash * p.freeze > 0.001;
      creditGrains.mesh.visible = credits;
      creditGrains.uniforms.uFadeC.value = p.creditsFade;
      creditGrains.uniforms.uTc.value = t - 226;
    },
    dispose() {
      bg.geometry.dispose(); bgMat.dispose();
      for (let i = 1; i < shutter.length; i++) shutter[i].mat.dispose();
      bubbles.dispose(); credit.dispose(); bead.dispose(); creditGrains.dispose(); skyStars.dispose(); heroTuft.dispose();
      for (const m of planes) { m.geometry.dispose(); m.material.dispose(); }
      crack.geo.dispose(); crack.blade.dispose(); crack.shells.dispose(); shellMat.dispose(); crackCore.material.dispose(); crackGlow.material.dispose();
      bladeMat.dispose(); sunGlow.geometry.dispose(); sunMat.dispose(); white.geometry.dispose(); whiteMat.dispose();
      seed.dispose();
    },
  };
}
