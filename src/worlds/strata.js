// W4 STRATA — the cross-section clock (S14, S15). 1 unit = 1 cm, side-on view of a clean vertical
// cut through the ground. y = 0 is the surface the seed was lying on (top of band 3).
//
// Everything is a closed-form function of film time t:
//   122.0-123.0  ground-line wipe out of the macro bed: the soil surface rises through frame and this
//                world is revealed beneath it (bed.js createWipe; both shots render, see macro.js)
//   123.0-133.0  bands 4..14 settle, one per second, each as a fall of grains filling left to right
//   134.0-140.0  near darkness, one pulse every 3 s
//   140.0        the glow steadies and swells; 142 husk splits; 142-146 root; 144.5-152.5 the shoot
//                crosses 11 bands, one every 0.8 s, each band flashing; 153.0 it breaks the surface
//
// Shot params (all optional): none are required; `exposureBoost` etc. live in the shot's post.

import * as THREE from 'three';
import { NOISE } from '../lib/glsl/noise.js';
import { createParticles } from '../lib/particles.js';
import { GRAIN_FRAG } from '../lib/grains.js';
import { createLine } from '../lib/line.js';
import { seedPulse, year as storyYear, valleyState, PALETTE } from '../lib/story.js';
import { createBackplate, createWipe, makeSeed, PLATE_LOOKS, mixLook, C, S13_END } from './bed.js';

const PIC = (1920 / 2.39) / 1080;            // picture height / frame height
const CAM_DIST = 1000;                       // long lens far away: effectively orthographic
const SEED_Y = 0.2;                          // seed centre: half sunk into the top of band 3
const SHOOT_Y0 = 0.3;

// ---- the 14 bands, bottom to top ---------------------------------------------------------------
const BAND_HEX = ['#3B3A3C', '#B08A4F', '#D2BE94', '#1E1B1A', '#7E8791', '#B08A4F', '#8F4A2B', '#D2BE94', '#7E8791', '#B08A4F', '#8F4A2B', '#D2BE94', '#4A3423', '#2E2218'];
// x: grains per cm, y: pebbliness, z: grain-to-grain contrast, w: lamination
const GRAVEL = [5.0, 1.0, 0.35, 0.1], SILT = [12.0, 0.2, 0.22, 0.7], SAND = [5.5, 0.4, 0.4, 0.55], ASH = [15.0, 0.12, 0.7, 0.3];
const CLAY = [22.0, 0.0, 0.12, 1.0], RUST = [7.0, 0.5, 0.42, 0.45], LOAM = [9.0, 0.33, 0.5, 0.25], TOPSOIL = [10.0, 0.25, 0.55, 0.2];
// how far each band stands proud of (+) or is eaten back from (-) the cut face
const BAND_REL = [0.5, 0.0, -0.5, -0.3, 0.7, 0.0, 0.3, -0.5, 0.7, 0.0, 0.3, -0.5, -0.15, -0.3];
const BAND_TEX = [GRAVEL, SILT, SAND, ASH, CLAY, SILT, RUST, SAND, CLAY, SILT, RUST, SAND, LOAM, TOPSOIL];
const THICK = [1.5, 2.6, 3.2, 2.2, 3.6, 2.4, 3.4, 2.0, 3.8, 3.3, 2.8]; // bands 4..14, sum 30.8 cm
const SETTLE_T0 = 123, SETTLE_DUR = 0.85;
const CROSS_T0 = 144.5, CROSS_DT = 0.8, SURFACE_T = 153;

// JS mirror of the GLSL band geometry (used for the shoot's schedule and the camera)
const wv = (j, x) => 0.5 * Math.sin(x * 0.11 + j * 1.7) + 0.35 * Math.sin(x * 0.043 + j * 4.1) + 0.15 * Math.sin(x * 0.31 + j * 2.3);
const bandThick = (i) => THICK[i];                 // at x = 0 (see thickK in the GLSL)
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;
const bandFill = (i, x, t, dust) => {
  const xn = clamp01((x + 62) / 112);
  const f = sstep(xn * 0.8, xn * 0.8 + 0.2, (t - (SETTLE_T0 + i)) / SETTLE_DUR);
  return i === 0 ? Math.max(f, 0.14 * dust) : f;
};
const groundAt = (x, t, dust) => { let y = 0; for (let i = 0; i < 11; i++) y += bandThick(i) * bandFill(i, x, t, dust); return y; };
// boundaries at the shoot's column (x = 0): BOUND[i] = bottom of band 4+i, BOUND[11] = final ground
const BOUND = [0];
for (let i = 0; i < 11; i++) BOUND.push(BOUND[i] + bandThick(i));
const GROUND_FINAL = BOUND[11];

/** Height of the shoot's tip (cm) at film time t. Enters band 4+i at 144.5 + 0.8 i; surface at 153. */
function tipRaw(t) {
  if (t <= CROSS_T0) return SHOOT_Y0;
  if (t >= SURFACE_T) return GROUND_FINAL + 5.2 * (1 - Math.exp(-(t - SURFACE_T) * 1.5));
  const k = (t - CROSS_T0) / CROSS_DT, i = Math.min(10, Math.floor(k)), f = k - i;
  const a = i === 0 ? SHOOT_Y0 : BOUND[i];
  const b = i === 10 ? GROUND_FINAL : BOUND[i + 1];
  const span = i === 10 ? (SURFACE_T - (CROSS_T0 + 10 * CROSS_DT)) / CROSS_DT : 1;
  return lerp(a, b, Math.min(1, f / span));
}
const tipY = (t) => (tipRaw(t - 0.1) + 2 * tipRaw(t) + tipRaw(t + 0.1)) / 4;

// ---- framing ------------------------------------------------------------------------------------
const cine = (x) => { x = clamp01(x); const a = x * x * (3 - 2 * x); return a * a * (3 - 2 * a) * 0.35 + a * 0.65; };
function framing(t) {
  let H, seedFrac, fx;
  if (t < 134) {
    H = 10 + 34 * cine((t - 123.2) / 10.8); seedFrac = 0.12;
    fx = lerp(S13_END.seedPic[0], 0.52, sstep(123.2, 130, t));   // the seed keeps its column through the wipe
  }
  else { const k = sstep(134, 140, t); H = lerp(44, 30, k); seedFrac = lerp(0.12, 0.2, k); fx = 0.52; }
  let bottom = SEED_Y - seedFrac * H;
  if (t > 140) {
    // crane up with the tip (kept at 60% of the frame), smooth take-off
    const want = tipY(t) - 0.6 * H, d = want - bottom, s = 2.5;
    bottom += d > s ? d : d > -s ? ((d + s) * (d + s)) / (4 * s) : 0;
    bottom += 3.0 * sstep(152.6, 154, t);       // ...and on up above the ground line
  }
  return { H, bottom, fx, W: H * 2.39 };
}

// ---- shared GLSL: band geometry ------------------------------------------------------------------
const BANDS_GLSL = /* glsl */ `
uniform float uThick[11];
uniform float uDust;
float wv(float j, float x) { return 0.5 * sin(x * 0.11 + j * 1.7) + 0.35 * sin(x * 0.043 + j * 4.1) + 0.15 * sin(x * 0.31 + j * 2.3); }
float wm(float j, float x) { return sin(x * 0.47 + j * 2.9) * sin(x * 0.17 + j * 1.3) + 0.35 * sin(x * 1.3 + j * 5.1); }
// Thickness of band 4+i relative to its nominal value: gentle swells, pinch-outs toward the sides,
// and exactly 1 at x = 0 (the shoot's column), so the schedule of S15 never moves.
float thickK(int i, float x) {
  float j = float(i) + 4.0;
  float k = 1.0 + 0.30 * (wv(j, x) - wv(j, 0.0)) + 0.09 * (wm(j, x) - wm(j, 0.0));
  if (i == 3) k *= smoothstep(46.0, 22.0, x);
  if (i == 7) k *= smoothstep(-50.0, -26.0, x);
  if (i == 1) k *= 0.3 + 0.7 * smoothstep(-58.0, -30.0, x);
  if (i == 5) k *= 0.4 + 0.6 * smoothstep(52.0, 28.0, x);
  return max(k, 0.0);
}
float bandThick(int i, float x) { return uThick[i] * thickK(i, x); }
float bandFill(int i, float x) {
  float xn = clamp((x + 62.0) / 112.0, 0.0, 1.0);
  float f = smoothstep(xn * 0.8, xn * 0.8 + 0.2, (uTime - (${SETTLE_T0.toFixed(1)} + float(i))) / ${SETTLE_DUR.toFixed(2)});
  return i == 0 ? max(f, 0.14 * uDust) : f;
}
`;

const PLANE_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = (modelMatrix * vec4(position, 1.0)).xy; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

const PLANE_FRAG = NOISE + /* glsl */ `
uniform float uTime;
${BANDS_GLSL}
uniform vec3 uCol[14];
uniform vec4 uTex[14];
uniform float uRel[14];
uniform float uPxPerCm, uSkyLight, uGlow, uLampR, uTipGlow, uDawn;
uniform vec2 uSeed, uTip;
uniform vec3 uSkyCol, uAmber, uTipCol, uPulseCol, uWarmCol;
varying vec2 vP;

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
float lensM(float x, float v, float xc, float len, float vc, float hv) {
  float a = (x - xc) / len, b = (v - vc) / hv;
  return smoothstep(1.0, 0.72, a * a + b * b + 0.12 * snoise(vec2(x * 0.5, v * 3.0)));
}
const vec3 RAKE = vec3(-0.576, 0.628, 0.523);      // raking light on the cut face, from upper left

void main() {
  float x = vP.x, y = vP.y;
  // contacts are never ruled lines: a small warp, different at every depth
  float jig = 0.075 * snoise(vec2(x * 0.6, y * 0.22)) + 0.03 * snoise(vec2(x * 2.2, y * 0.6 + 3.0));
  float y2 = y - jig;
  // ---- which band? ----
  int band = -1, last = 2;
  float yb = 0.0, yt = 0.0, acc = 0.0;
  for (int i = 0; i < 11; i++) {
    float th = bandThick(i, x) * bandFill(i, x);
    if (band < 0 && y2 > acc && y2 <= acc + th) { band = i + 3; yb = acc; yt = acc + th; }
    if (th > 0.004) { last = i + 3; }
    acc += th;
  }
  float ground = acc;
  if (y2 <= 0.0) {
    float b1 = -2.6 + 0.35 * wv(2.0, x) + 0.12 * wm(2.0, x), b0 = -5.0 + 0.45 * wv(1.0, x) + 0.15 * wm(1.0, x);
    if (y2 > b1) { band = 2; yb = b1; yt = 0.0; } else if (y2 > b0) { band = 1; yb = b0; yt = b1; } else { band = 0; yb = b0 - 3.0; yt = b0; }
  }
  float cover = clamp((ground - y2) * uPxPerCm + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  if (band < 0) { band = last; yb = y2 - 0.2; yt = ground; }

  // ---- material ----
  float th = max(yt - yb, 0.05);
  float v = clamp((y2 - yb) / th, 0.0, 1.0);           // 0 at the base of the band, 1 at its top
  vec3 base = uCol[band];
  vec4 tex = uTex[band];
  float rel = uRel[band];
  vec2 p = vec2(x, y);
  float fb = float(band);
  // lenses of other sediment inside some bands
  float lk = 0.0; int lb = band;
  if (band == 4) { lk = lensM(x, v, -34.0, 14.0, 0.5, 0.24); lb = 1; }
  else if (band == 5) { lk = lensM(x, v, -22.0, 12.0, 0.26, 0.24); lb = 0; }
  else if (band == 7) { lk = max(lensM(x, v, 15.0, 16.0, 0.66, 0.09), lensM(x, v, -38.0, 12.0, 0.3, 0.08)); lb = 4; }
  else if (band == 8) { lk = lensM(x, v, 22.0, 10.0, 0.32, 0.26); lb = 2; }
  else if (band == 9) { lk = lensM(x, v, 30.0, 14.0, 0.5, 0.3); lb = 2; }
  else if (band == 11) { lk = lensM(x, v, -27.0, 11.0, 0.2, 0.2); lb = 0; }
  else if (band == 12) { lk = lensM(x, v, 12.0, 7.0, 0.3, 0.3); lb = 0; }
  if (lk > 0.0) { base = mix(base, uCol[lb] * (lb == 0 ? 1.5 : 1.0), lk); tex = mix(tex, uTex[lb], lk); rel = mix(rel, uRel[lb], lk); }

  // primary grains: flattened, of uneven size, each one a facet with its own tilt
  vec4 gA = grainCell(p * tex.x * vec2(1.0, 1.4) + fb * 13.7);
  float lodA = smoothstep(1.2, 3.0, uPxPerCm / tex.x);
  float rA = mix(0.26, 0.6, fract(gA.y * 13.7));
  float inA = smoothstep(rA, rA - 0.14, gA.x);
  vec2 facA = hash22(vec2(gA.y * 91.7, gA.y * 37.3 + 2.0)) - 0.5;
  vec3 nA = vec3(facA * 1.5 - gA.zw * 0.9, 0.0);
  // matrix between them: finer grains
  float fine = tex.x * 3.7;
  float lodB = smoothstep(1.2, 3.0, uPxPerCm / fine);
  vec4 gB = grainCell(p * fine * vec2(1.0, 1.3) + 31.7);
  vec2 facB = hash22(vec2(gB.y * 57.1, gB.y * 23.9 + 5.0)) - 0.5;
  vec3 nB = vec3(facB * 1.6 - gB.zw * 0.8, 0.0);
  float tintA = mix(1.0 - tex.z, 1.0 + tex.z, fract(gA.y * 5.3));
  float tintB = 0.8 + 0.4 * gB.y;
  vec3 albedo = base * mix(1.0, mix(0.6 * tintB, tintA, inA), lodA) * mix(1.0, mix(1.0, tintB, 1.0 - inA * lodA), lodB * 0.8);
  // minerals: quartz and dark flecks in the coarse bands; charcoal in the ash
  float coarse = smoothstep(14.0, 6.0, tex.x);
  albedo = mix(albedo, vec3(0.80, 0.78, 0.72), step(0.93, gB.y) * 0.5 * lodB * coarse);
  albedo *= mix(1.0, 0.35, step(gB.y, 0.07) * lodB);
  albedo = mix(albedo, vec3(0.78, 0.76, 0.70), step(0.955, gA.y) * inA * 0.5 * lodA * coarse);
  if (band == 3) albedo = mix(albedo, vec3(0.10, 0.095, 0.09), step(0.8, gA.y) * inA * lodA) + vec3(0.16, 0.15, 0.14) * step(0.975, gB.y) * lodB;

  // lamination: thin sheets that follow the contacts, inclined (cross-bedded) in the sands
  float cross = tex.y > 0.2 ? 0.2 : 0.0;
  float lamC = v * th + cross * x + 0.3 * snoise(vec2(x * 0.3 + fb, v * 1.7));
  float l1 = snoise(vec2(x * 0.06 + fb * 3.0, lamC * 2.3));
  float l2 = snoise(vec2(x * 0.17 + fb * 5.0, lamC * 6.5)) * smoothstep(1.0, 2.5, uPxPerCm / 6.5);
  albedo *= 1.0 + tex.w * (0.20 * l1 + 0.12 * l2);
  albedo *= 1.0 - 0.3 * tex.w * smoothstep(0.45, 0.7, l1) * smoothstep(0.2, 0.6, l2 + 0.5);   // dark seams
  // mottling (burrows, stains) and iron staining along the contacts
  float mot = fbm(p * vec2(0.42, 0.7) + fb * 7.1, 4);
  albedo *= 0.88 + 0.22 * mot;
  albedo = mix(albedo, albedo * vec3(1.12, 0.9, 0.72), 0.5 * smoothstep(0.1, 0.5, fbm(p * vec2(0.2, 0.9) + 31.0, 3)));
  albedo *= 1.0 - 0.34 * exp(-(y2 - yb) * 4.5) - 0.14 * exp(-(yt - y2) * 7.0);

  // pebbles: more of them toward the base of a band (graded bedding); some have fallen out (pits)
  vec2 pw = p + 0.06 * vec2(snoise(p * 1.7 + fb), snoise(p * 1.7 + 7.3 + fb));
  vec2 qc = pw * 1.3 * vec2(1.0, 1.45) + fb * 5.1 + 7.7;
  vec4 gC = grainCell(qc);
  float dens = clamp(tex.y * tex.y * mix(2.0, 0.4, v) + 0.015, 0.0, 1.0);
  float onC = step(1.0 - dens, gC.y);
  float hC = fract(gC.y * 31.7), kC = fract(gC.y * 57.3);
  float rC = mix(0.18, 0.5, hC * hC) * (0.62 + 0.38 * tex.y);
  float inC = onC * smoothstep(rC, rC - 0.045, gC.x);
  float pit = step(0.84, kC);
  vec3 stone = mix(mix(vec3(0.15, 0.15, 0.16), vec3(0.25, 0.20, 0.14), fract(gC.y * 7.3)), vec3(0.36, 0.35, 0.32), step(0.8, fract(gC.y * 113.0)) * 0.6);
  stone = mix(stone, base * 0.8, 0.4) * (0.75 + 0.5 * fract(gC.y * 11.1));
  stone *= 0.8 + 0.3 * snoise(p * 6.0 + fb) + 0.14 * snoise(p * 21.0);
  stone = mix(stone, albedo * 0.35, pit);
  // the shadow a stone casts down-right, away from the raking light
  vec4 gS = grainCell(qc + vec2(-0.676, 0.737) * 0.3);
  float rS = mix(0.18, 0.5, pow(fract(gS.y * 31.7), 2.0)) * (0.62 + 0.38 * tex.y);
  float shC = step(1.0 - dens, gS.y) * step(fract(gS.y * 57.3), 0.84) * smoothstep(rS + 0.1, rS - 0.06, gS.x) * (1.0 - inC);
  albedo = mix(albedo, stone, inC);

  // damp at depth: darker, richer
  float depth = max(ground - y, 0.0);
  float damp = smoothstep(1.0, 17.0, depth + 2.0 * mot);
  albedo *= mix(1.0, 0.6, damp);
  albedo = mix(albedo, albedo * albedo * 2.2, 0.25 * damp);

  // ---- relief of the cut face ----
  float e = 0.3;
  float f0 = fbm(p * 0.45 + 3.0, 3);
  vec2 gradF = vec2(fbm((p + vec2(e, 0.0)) * 0.45 + 3.0, 3) - f0, fbm((p + vec2(0.0, e)) * 0.45 + 3.0, 3) - f0) / e;
  float dB = y2 - yb, dT = yt - y2, wE = 0.14;
  float dhdy = (rel - uRel[max(band - 1, 0)]) * exp(-dB * dB / (wE * wE));
  if (band != last) dhdy += (uRel[min(band + 1, 13)] - rel) * exp(-dT * dT / (wE * wE));
  // crumbling: the sands shed grains, the clays break in small conchoidal steps
  float crumb = snoise(p * vec2(1.6, 2.6) + fb * 3.0);
  vec2 gradK = vec2(snoise((p + vec2(0.12, 0.0)) * vec2(1.6, 2.6) + fb * 3.0) - crumb, snoise((p + vec2(0.0, 0.12)) * vec2(1.6, 2.6) + fb * 3.0) - crumb) / 0.12;
  vec3 n = vec3(-gradF * 0.2 - gradK * 0.035 * (0.4 + coarse) - vec2(0.0, dhdy * 0.75), 1.0);
  n += nA * 0.7 * lodA * inA + nB * 0.5 * lodB * (1.0 - inA * lodA);
  n = normalize(n);
  float dome = clamp(1.0 - gC.x / max(rC, 0.01), 0.0, 1.0);
  vec3 nC = normalize(vec3(-gC.zw / max(rC, 0.05) * mix(0.75, -0.6, pit), 0.6 + dome));
  n = normalize(mix(n, nC, inC));
  float gloss = mix(step(0.9, gB.y) * lodB * coarse, 0.2, inC * (1.0 - pit));

  // ---- light ----
  float rake = max(dot(n, RAKE), 0.0);
  float occ = (1.0 - 0.55 * shC) * (1.0 - 0.25 * smoothstep(0.0, 0.5, dhdy));
  float amb = uSkyLight * (0.2 + 0.8 * exp(-depth / 10.0)) * (0.22 + 1.5 * rake * occ) * 2.4;
  vec3 col = albedo * uSkyCol * amb;
  col += uSkyCol * uSkyLight * gloss * pow(rake, 12.0) * 0.5 * exp(-depth / 10.0);
  // dawn pouring in from the surface
  col += albedo * uWarmCol * uDawn * exp(-depth / 6.0) * 1.4;

  // the seed: a lamp in fog
  vec2 dl = uSeed - p; float d = length(dl);
  vec3 L = normalize(vec3(dl / max(d, 1e-3) * 0.9, 0.42));
  float fall = 1.0 / (1.0 + pow(d / uLampR, 3.0));
  float ndl = max(dot(n, L), 0.0);
  col += (albedo + 0.02) * uAmber * uGlow * fall * (0.3 + 1.7 * ndl) * 5.0;
  col += uAmber * uGlow * fall * gloss * pow(ndl, 5.0) * 2.2;
  col += uAmber * uGlow * (0.30 * exp(-d / (uLampR * 0.45)) + 0.035 * exp(-d / (uLampR * 2.2)));

  // the shoot's tip
  vec2 dt = uTip - p; float d2 = length(dt);
  vec3 L2 = normalize(vec3(dt / max(d2, 1e-3) * 0.9, 0.45));
  col += albedo * uTipCol * uTipGlow * (0.25 + 1.5 * max(dot(n, L2), 0.0)) / (1.0 + d2 * d2 / 5.0);
  col += uTipCol * uTipGlow * 0.10 * exp(-d2 / 1.3);

  // each band flashes a line of light as the shoot enters it, then stays awake (warm)
  if (band >= 3) {
    float e = uTime - (${CROSS_T0.toFixed(1)} + ${CROSS_DT.toFixed(1)} * float(band - 3));
    if (e > -0.004) {
      e = max(e, 0.0);
      float dx = abs(x - uTip.x);
      float front = 18.0 + e * 110.0;       // already a line on the frame of its note
      float reach = smoothstep(front, front - 14.0, dx);
      float v = clamp((y - yb) / th, 0.0, 1.0);
      float core = exp(-pow((v - 0.5) * th / 0.07, 2.0));
      float body = pow(sin(3.14159 * v), 0.6);
      float head = exp(-pow((dx - front) / 10.0, 2.0));
      float flash = exp(-e * 5.0);
      col += uPulseCol * reach * (core * (3.0 * flash + 2.2 * head) + body * (0.7 * flash + 0.5 * head) * (0.25 + albedo * 2.0));
      float awake = reach * (1.0 - exp(-e * 2.2)) * (0.35 + 0.65 * exp(-dx / 45.0));
      col += albedo * uWarmCol * awake * 0.95;
    }
  }
  gl_FragColor = vec4(col, cover);
}`;

// ---- roots and shoot: the LINE motif -------------------------------------------------------------
function ribbon(lines) {
  // lines: [{ pts: [[x, y]], birth: [..], width: [..] }]
  let n = 0;
  for (const l of lines) n += l.pts.length;
  const pos = new Float32Array(n * 2 * 3), nrm = new Float32Array(n * 2 * 2), side = new Float32Array(n * 2), birth = new Float32Array(n * 2), wid = new Float32Array(n * 2);
  const idx = [];
  let v = 0;
  for (const l of lines) {
    const P = l.pts, m = P.length;
    for (let i = 0; i < m; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(m - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      for (let s = 0; s < 2; s++) {
        pos.set([P[i][0], P[i][1], 0], v * 3); nrm.set([-ty, tx], v * 2);
        side[v] = s ? 1 : -1; birth[v] = l.birth[i]; wid[v] = l.width[i];
        v++;
      }
      if (i < m - 1) { const q = v - 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 2));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
  geo.setAttribute('aWidth', new THREE.BufferAttribute(wid, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
  return geo;
}
const LINE_VERT = /* glsl */ `
attribute vec2 aNormal; attribute float aSide, aBirth, aWidth;
uniform float uGrow, uWiden, uMinW, uAgeScale;
varying float vSide, vBirth, vAge;
void main() {
  float age = (uGrow - aBirth) * uAgeScale;
  float w = max(aWidth * smoothstep(0.0, 0.05, age), uMinW * step(0.0, age)) * uWiden;
  vec3 p = position + vec3(aNormal * aSide * w * 0.5, 0.0);
  vSide = aSide; vBirth = aBirth; vAge = age;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const LINE_FRAG = /* glsl */ `
uniform vec3 uColor, uTipColor; uniform float uBright, uSoft;
varying float vSide, vBirth, vAge;
void main() {
  if (vAge <= 0.0) discard;
  float e = 1.0 - abs(vSide);
  float a = uSoft > 0.5 ? exp(-vSide * vSide * 4.5) * 0.5 : smoothstep(0.0, 0.5, e);
  float tip = exp(-vAge * 14.0);
  vec3 col = mix(uColor, uTipColor, tip) * uBright * (uSoft > 0.5 ? 1.0 : (0.55 + 0.45 * e)) * (1.0 + 2.5 * tip);
  gl_FragColor = vec4(col * a, uSoft > 0.5 ? 0.0 : a);
}`;

// Roots and shoot are drawn by the film's shared LINE generator (lib/line.js).
function lineRibbon(line, w0, minLevelWidth = 0.35) {
  return ribbon(line.curves.map((c) => {
    const pts = [], birth = [], width = [];
    for (let i = 0; i < c.n; i++) {
      const sN = c.length > 0 ? c.cum[i] / c.length : 0;
      pts.push([c.points[i * 2], c.points[i * 2 + 1]]);
      birth.push(c.start + (c.end - c.start) * sN);
      width.push(w0 * Math.max(c.width(sN), minLevelWidth * Math.pow(0.7, c.level)));
    }
    return { pts, birth, width };
  }));
}
const ROOT_LINE = createLine({
  seed: 'grain-root', from: [-0.1, SEED_Y - 0.16], to: [-0.9, -9.4], segments: 120,
  meander: 0.06, wavelength: 0.33, jitter: 0.006, branches: 8, levels: 2, branchDecay: 0.55, branchLength: 0.42,
  branchAngle: 52, angleJitter: 18, branchFrom: [0.06, 0.9], taper: 0.22, stemShare: 0.62,
});
const SHOOT_TOP = GROUND_FINAL + 6;
const SHOOT_LINE = createLine({ seed: 'grain-shoot', from: [0.0, SHOOT_Y0 - 0.15], to: [0.35, SHOOT_TOP], segments: 420, meander: 0.012, wavelength: 0.27, branches: 0, pin: [0.03, 0.03] });
const shootX = (y) => SHOOT_LINE.stem.at((y - (SHOOT_Y0 - 0.15)) / (SHOOT_TOP - (SHOOT_Y0 - 0.15)))[0];
function buildRoots() { return lineRibbon(ROOT_LINE, 0.17); }
function buildShoot() {
  const c = SHOOT_LINE.stem, pts = [], birth = [], width = [];
  for (let i = 0; i < c.n; i++) { pts.push([c.points[i * 2], c.points[i * 2 + 1]]); birth.push(c.points[i * 2 + 1]); width.push(0.2); }
  return ribbon([{ pts, birth, width }]);
}

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(1, ctx.aspect, CAM_DIST - 60, CAM_DIST + 300);
  scene.add(camera);

  const plate = createBackplate();
  plate.set({ depth: CAM_DIST + 200 });
  scene.add(plate.mesh);

  // ---- the cut face ----
  const uTime = { value: 0 }, uThick = { value: THICK.slice() }, uDust = { value: 0 };
  const pu = {
    uTime, uThick, uDust,
    uCol: { value: BAND_HEX.map((h) => C(h)) },
    uTex: { value: BAND_TEX.map((a) => new THREE.Vector4(...a)) }, uRel: { value: BAND_REL.slice() },
    uPxPerCm: { value: 80 }, uSkyLight: { value: 1 }, uGlow: { value: 0 }, uLampR: { value: 2.5 }, uTipGlow: { value: 0 },
    uDawn: { value: 0 },
    uSeed: { value: new THREE.Vector2(0.12, SEED_Y) }, uTip: { value: new THREE.Vector2(0, 0) },
    uSkyCol: { value: new THREE.Vector3(1, 1, 1) }, uAmber: { value: C(PALETTE.amber) }, uTipCol: { value: C('#E9F2C2') },
    uPulseCol: { value: C('#FFE9BC', 1.5) }, uWarmCol: { value: C('#FFC98A') },
  };
  const planeMat = new THREE.ShaderMaterial({ name: 'strata', uniforms: pu, vertexShader: PLANE_VERT, fragmentShader: PLANE_FRAG, transparent: true, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(600, 400), planeMat);
  plane.frustumCulled = false;
  plane.renderOrder = 1;
  scene.add(plane);

  // ---- settling grains: every band arrives as a fall of grains, filling left to right ----
  const PER = 5200;
  const fall = createParticles({
    count: PER * 11, seed: ctx.seed ^ 0xfa11, name: 'strata-fall', blending: 'normal', minPixelSize: 3.0,
    fragment: /* glsl */ `
      vec2 q = vec2(uv.x + 0.42 * uv.y, uv.y);
      float a = exp(-q.x * q.x * 110.0) * smoothstep(1.0, 0.0, abs(uv.y)) * (1.0 - 0.5 * uv.y);
      col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,
    uniforms: { uThick, uDust, uCol: pu.uCol, uFallH: { value: 9 }, uGrain: { value: 0.1 }, uLight: { value: new THREE.Vector3(1, 1, 1) } },
    glsl: BANDS_GLSL + /* glsl */ `uniform vec3 uCol[14]; uniform float uFallH, uGrain; uniform vec3 uLight;`,
    position: /* glsl */ `
      float bi = floor(id / ${PER.toFixed(1)});
      int ib = int(bi);
      float x = mix(-70.0, 56.0, seed.x);
      float xn = clamp((x + 62.0) / 112.0, 0.0, 1.0);
      float tl = ${SETTLE_T0.toFixed(1)} + bi + ${SETTLE_DUR.toFixed(2)} * (xn * 0.8 + 0.2 * seed.y);
      float dur = mix(0.5, 0.85, seed.z);
      float s = (t - (tl - dur)) / dur;
      color = vec4(0.0);
      if (s > 0.0 && t < tl + 0.1) {
        float base = 0.0;
        for (int j = 0; j < 11; j++) { if (j < ib) base += bandThick(j, x); }
        float yl = base + bandThick(ib, x) * seed.w;
        float sc = clamp(s, 0.0, 1.0);
        float H = uFallH * mix(0.55, 1.25, seed.y);
        float k = 1.0 - sc * (0.35 + 0.65 * sc);
        float sway = sin(seed.w * 40.0 + t * (5.0 + 6.0 * seed.z)) * 0.012 * uFallH;
        pos = vec3(x - k * H * 0.42 + sway * k, yl + H * k, 0.9);
        size = uGrain * mix(1.6, 4.2, fract(seed.w * 17.0)) * (0.4 + 0.6 * sc);
        vec3 c = uCol[ib + 3] * mix(0.75, 1.35, fract(seed.z * 31.0));
        float a = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(tl - 0.05, tl + 0.1, t)) * 0.8;
        color = vec4(c * uLight, a);
      }`,
  });
  fall.mesh.renderOrder = 4;
  scene.add(fall.mesh);

  // ---- roots and shoot ----
  const mkLine = (geo, color, tipColor, soft, order, ageScale = 1) => {
    const u = { uAgeScale: { value: ageScale }, uGrow: { value: 0 }, uWiden: { value: soft ? 5 : 1 }, uMinW: { value: 0.02 }, uColor: { value: C(color) }, uTipColor: { value: C(tipColor) }, uBright: { value: 1 }, uSoft: { value: soft ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({
      name: 'strata-line', uniforms: u, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = order; mesh.position.z = 0.1;
    scene.add(mesh);
    return { mesh, u, mat };
  };
  const rootGeo = buildRoots(), shootGeo = buildShoot();
  const rootGlow = mkLine(rootGeo, '#F4E2BE', '#FFF0D0', true, 2);
  const root = mkLine(rootGeo, '#F4E6C8', '#FFF6E2', false, 3);
  const shootGlow = mkLine(shootGeo, '#E9F2C2', '#FFFFFF', true, 2, 0.12);
  const shoot = mkLine(shootGeo, '#E9F2C2', '#FFFFFF', false, 3, 0.12);

  // tip glow sprite
  const tipU = { uColor: { value: C('#F3F8D8') }, uI: { value: 0 } };
  const tipMat = new THREE.ShaderMaterial({
    name: 'strata-tip', uniforms: tipU, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: `varying vec2 vUv; void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying vec2 vUv; void main() { float r2 = dot(vUv, vUv) * 4.0; float g = exp(-r2 * 30.0) * 1.6 + exp(-r2 * 6.0) * 0.25 + exp(-r2 * 1.6) * 0.06; g *= 1.0 - smoothstep(0.7, 1.0, sqrt(r2)); gl_FragColor = vec4(uColor * g * uI, 0.0); }`,
  });
  const tipSprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tipMat);
  tipSprite.renderOrder = 6; tipSprite.frustumCulled = false;
  scene.add(tipSprite);

  // ---- the ground-line wipe: hides this world above the rising soil surface, and draws its lip ----
  const wipe = createWipe('below');
  const wipeGroup = new THREE.Group();          // a Group's renderOrder outranks every other key: drawn last
  wipeGroup.renderOrder = 100; wipeGroup.add(wipe.mesh);
  scene.add(wipeGroup);

  // ---- the seed ----
  const seed = makeSeed({ fx: false });
  seed.group.scale.setScalar(1.2);
  seed.group.position.set(0, SEED_Y, 0.45);
  seed.group.rotation.set(0.1, 0.25, S13_END.seedTilt);
  seed.group.traverse((o) => { o.renderOrder = (o.renderOrder || 0) + 10; });
  scene.add(seed.group);

  const lookA = {}, lookB = {};
  const skyCol = new THREE.Vector3();
  // the sky strip of S14: a pale, drained dusk with its light low behind the mountain, so that the
  // mountain is a clear dark shape for as long as there is any light at all
  const STRIP_DUSK = {
    ...PLATE_LOOKS.dusk,
    skyTop: C('#39425a', 0.75), skyHor: C('#c9b8a8', 1.5), skyPow: 0.55, glowCol: C('#e0c8ac', 0.9), glowPos: [0.52, 0.3, 0.42],
    rock: C('#0e0f13', 0.4), rockLit: C('#181a20', 0.45), snow: C('#101116', 0.4), snowLit: C('#1b1d24', 0.45),
    hazeCol: C('#5a5860', 0.7), haze: 0.38, lightX: 0, floorNear: C('#101012', 0.3), floorFar: C('#2a2a30', 0.4),
    cloudCol: C('#6a6468', 0.8), cloud: 0.22, cloudSpeed: 0.03,
  };
  const SKY_DUSK = C('#b9b4ae', 1.0), SKY_NIGHT = C('#3a4660', 1.0), SKY_DAWN = C('#ffd7a6', 1.0);

  return {
    scene, camera,
    post: { vignette: 0.5, vignetteSoftness: 0.6, bloom: 0.07, halation: 0.2 },
    update(t) {
      const dust = 1 - sstep(123.0, 123.4, t) * 0.0;       // the thin ash of S13 stays as the base of band 4
      uTime.value = t; uDust.value = dust;
      const F = framing(t);
      // camera: long lens, far away
      const cx = -F.fx * F.W + F.W / 2, cy = F.bottom + F.H / 2;
      camera.position.set(cx, cy, CAM_DIST);
      camera.rotation.set(0, 0, 0);
      camera.fov = 2 * Math.atan((F.H / PIC) / 2 / CAM_DIST) / Math.PI * 180;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const pxPerCm = (ctx.height * Math.min(1, ctx.width / 2.39 / ctx.height)) / F.H;
      pu.uPxPerCm.value = pxPerCm;

      // ---- light: dusk -> night -> dawn ----
      const toNight = sstep(128.5, 134.0, t), toDawn = sstep(145.5, 153.2, t);
      const skyLight = t < 140 ? lerp(lerp(0.3, 1.0, sstep(122.6, 124.2, t)), 0.035, toNight) : lerp(0.035, 1.0, toDawn * toDawn);
      pu.uSkyLight.value = skyLight;
      skyCol.copy(SKY_DUSK).lerp(SKY_NIGHT, toNight).lerp(SKY_DAWN, toDawn);
      pu.uSkyCol.value.copy(skyCol);
      pu.uDawn.value = toDawn * toDawn * sstep(150.5, 153.5, t);
      mixLook(STRIP_DUSK, PLATE_LOOKS.night, toNight, lookA);
      mixLook(lookA, PLATE_LOOKS.dawn, toDawn, lookB);
      lookB.stars = 0.9 * sstep(0.7, 1, toNight) * (1 - sstep(0, 0.5, toDawn));

      // ---- plate: the mountain stands on the ground line and lowers as the bands thicken ----
      const g0 = groundAt(0, t, dust);
      const groundFrac = (g0 - F.bottom) / F.H;
      // "The mountain is being poured into the ground": with every band that settles the mountain
      // drops a visible step (its height above the ground line, in picture heights) and rounds off.
      let settled = 0;
      for (let i = 0; i < 11; i++) settled += sstep(SETTLE_T0 + i, SETTLE_T0 + i + SETTLE_DUR, t);
      settled /= 11;
      const mtnH = t < 134 ? lerp(0.42, 0.085, settled) : lerp(0.085, 0.148, sstep(134, 140, t));
      const shapeYear = t < 140 ? 6000 + 3900 * settled : storyYear(t);
      const scale = mtnH / (0.53 * valleyState(shapeYear).peak / 30);
      plate.set({ year: shapeYear, blur: lerp(0.3, 0.5, toDawn), anchor: [F.fx, groundFrac], scale, time: t, look: lookB, dim: 1 });

      // ---- the ground-line wipe (122.0-123.0): this world is revealed below the rising soil surface ----
      wipe.set(t);

      // ---- the seed and its light ----
      let G, floor;
      if (t < 140) { G = lerp(0.3, 0.085, sstep(123, 134, t)); floor = lerp(0.1, 0.3, toNight); }
      else { G = lerp(0.085, 1, sstep(140, 142, t)); floor = lerp(0.3, 1, sstep(140, 140.6, t)); }
      G *= 0.25 + 0.75 * sstep(122.45, 122.95, t);         // the ember shows once the bed's seed has gone under
      const now = G * (floor + (1 - floor) * seedPulse(t));
      const split = sstep(141.4, 143.0, t);
      // in the dark the ember must stay visible: it dims at every step and never goes out
      const dark = t < 140 ? lerp(1, 4.5, toNight) : lerp(4.5, 1, sstep(140, 142, t));
      pu.uGlow.value = now * dark * (1 + 0.6 * split);
      pu.uLampR.value = 1.5 + 4.2 * Math.pow(Math.min(1, now * dark), 0.7);
      const buried = sstep(123.0, 123.9, t);
      seed.set({
        glow: G, pulseFloor: floor, split, silkSpread: lerp(S13_END.silkSpread, 0.1, buried), silkWet: 1, silkOpacity: lerp(0.9, 0.25, buried), halo: 0.8,
        lightDir: [-0.3, 0.8, 0.5], lightColor: [skyCol.x * skyLight * 1.3, skyCol.y * skyLight * 1.3, skyCol.z * skyLight * 1.3],
        ambient: [skyCol.x * skyLight * 0.25, skyCol.y * skyLight * 0.25, skyCol.z * skyLight * 0.25],
      });
      seed.update(t);

      // ---- grains in the air ----
      fall.setTime(t);
      fall.uniforms.uFallH.value = F.H * 0.95;
      fall.uniforms.uGrain.value = F.H * 0.0085;
      const fl = 0.25 + 1.1 * skyLight;
      fall.uniforms.uLight.value.set(skyCol.x * fl, skyCol.y * fl, skyCol.z * fl);
      fall.mesh.visible = t > 122.2 && t < 134.5;

      // ---- root, shoot ----
      const rg = cine((t - 142) / 4.2);
      root.u.uGrow.value = rootGlow.u.uGrow.value = rg;
      const rb = 0.5 + 0.5 * sstep(142, 144, t);
      root.u.uBright.value = 0.9 * rb + 0.5 * skyLight; rootGlow.u.uBright.value = 0.14 * rb;
      root.u.uMinW.value = 1.6 / pxPerCm; rootGlow.u.uMinW.value = 1.6 / pxPerCm;
      root.mesh.visible = rootGlow.mesh.visible = t > 142;
      const ty = tipY(t);
      shoot.u.uGrow.value = shootGlow.u.uGrow.value = ty;
      shoot.u.uBright.value = 0.9 + 0.6 * skyLight; shootGlow.u.uBright.value = 0.16;
      shoot.u.uMinW.value = shootGlow.u.uMinW.value = 1.5 / pxPerCm;
      shoot.mesh.visible = shootGlow.mesh.visible = t > CROSS_T0;
      const tipOn = sstep(CROSS_T0, CROSS_T0 + 0.4, t);
      pu.uTip.value.set(shootX(ty), ty);
      pu.uTipGlow.value = tipOn * 0.9;
      tipSprite.position.set(shootX(ty), ty, 0.3);
      tipSprite.scale.setScalar(F.H * 0.22);
      tipU.uI.value = tipOn * (1.0 - 0.6 * sstep(152.6, 153.6, t));
      tipSprite.visible = tipOn > 0;
    },
    dispose() {
      plate.dispose(); plane.geometry.dispose(); planeMat.dispose(); fall.dispose();
      rootGeo.dispose(); shootGeo.dispose();
      for (const l of [rootGlow, root, shootGlow, shoot]) l.mat.dispose();
      tipSprite.geometry.dispose(); tipMat.dispose(); seed.dispose(); wipe.dispose();
    },
  };
}
