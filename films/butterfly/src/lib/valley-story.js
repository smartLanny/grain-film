// VALLEY STORY — GRAIN's (《一粒》, the first film) story constants, renamed from lib/story.js and kept
// ONLY because the reused GRAIN libraries need them: worlds/valley.js (createLandscape: ridge
// profile P0, valley state table, master frame), worlds/meadow.js, worlds/bed.js, lib/tree.js and
// lib/seed.js. The new film's constants are in lib/story.js; do not use this file for new work.
//
// Caution: year(t), seedPulse(t) and SHOT below are GRAIN's clock. A new-film world that uses
// createLandscape must pass `year` (e.g. 10000) explicitly, otherwise the landscape would follow
// GRAIN's story clock at the new film's times.
//
// (Original header:) Single source of truth for everything that must agree across worlds: shot
// times, the story clock, the ridge profile P0, the valley's erosion table, the master frame, the
// seed's pulse and the reserved palette. Pure functions only.

// ---- Shot times (film seconds) ---------------------------------------------------------------
export const SHOT = {
  S01: [0, 7], S02: [7, 19], S03: [19, 31], S04: [31, 38], S05: [38, 44],
  S06: [44, 58], S07: [58, 65], S08: [65, 74], S09: [74, 82],
  S10: [82, 96], S11: [96, 102], S12: [102, 110], S13: [110, 122], S14: [122, 140],
  S15: [140, 154], S16: [154, 162], S17: [162, 180], S18: [180, 194],
  S19: [194, 202], S20: [202, 212], S21: [212, 226], S22: [226, 240],
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, x) => a + (b - a) * x;
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => clamp01((t - a) / (b - a));

// ---- Story clock: film time -> year (0..10,000) -----------------------------------------------
export function year(t) {
  if (t < 65) return 0;
  if (t < 74) return lerp(0, 300, seg(t, 65, 74));
  if (t < 82) return 300;
  if (t < 96) return lerp(300, 3000, seg(t, 82, 96));
  if (t < 102) return 3000;
  if (t < 110) return 3500;
  if (t < 122) return lerp(3500, 6000, seg(t, 110, 122));
  if (t < 140) return lerp(6000, 9900, seg(t, 123, 134));
  if (t < 162) return 9900;
  return lerp(9900, 10000, smooth(seg(t, 163, 177)));
}

// ---- Valley state driven by year (SCRIPT.md, W2 table) ----------------------------------------
// peak: summit height (units, 1 unit = 100 m) · sharp: ridge sharpness · glacier: extent 0..1 ·
// fill: valley fill · braid: 1 = many thin braids, 0 = one slow meander · veg: vegetation cover
const VALLEY_KEYS = [
  { year: 0,     peak: 30,   sharp: 1.0,  glacier: 1.0,  fill: 0.0,  braid: 1.0, veg: 0.0, river: 0 },
  { year: 300,   peak: 29.5, sharp: 0.97, glacier: 0.8,  fill: 0.03, braid: 1.0, veg: 0.0, river: 1 },
  { year: 3000,  peak: 24,   sharp: 0.7,  glacier: 0.15, fill: 0.3,  braid: 0.3, veg: 0.25, river: 1 },
  { year: 6000,  peak: 19,   sharp: 0.45, glacier: 0.0,  fill: 0.6,  braid: 0.1, veg: 0.5, river: 1 },
  { year: 9900,  peak: 14.5, sharp: 0.25, glacier: 0.0,  fill: 0.95, braid: 0.0, veg: 0.85, river: 1 },
  { year: 10000, peak: 14,   sharp: 0.25, glacier: 0.0,  fill: 1.0,  braid: 0.0, veg: 0.9, river: 1 },
];
export function valleyState(y) {
  const K = VALLEY_KEYS;
  if (y <= K[0].year) return { ...K[0] };
  for (let i = 1; i < K.length; i++) {
    if (y <= K[i].year) {
      const a = K[i - 1], b = K[i], x = (y - a.year) / (b.year - a.year), out = { year: y };
      for (const k of Object.keys(a)) if (k !== 'year') out[k] = lerp(a[k], b[k], x);
      return out;
    }
  }
  return { ...K[K.length - 1] };
}
// Glacier snout z position (world units). Year 0: -1.4 (covers the seed's spot at z = -1.5).
export const glacierSnoutZ = (extent) => lerp(-160, -1.4, Math.pow(clamp01(extent), 0.14));

// ---- World layout (W2, 1 unit = 100 m) ---------------------------------------------------------
export const SUMMIT = [2.5, 30, -160];     // year-0 summit
export const SEED_SPOT = [0, 0, -1.5];     // where the seed lands and the tree stands
export const RIDGE_HALF_WIDTH = 45;        // world x half-extent of the profile (u = ±1)

// ---- P0, the ridge profile: year-0 skyline AND the envelope of the tree's crown ---------------
// Normalised control points (u across, v up). Steep right face, longer left ridge, one shoulder.
export const P0_POINTS = [
  [-1.0, 0.0], [-0.72, 0.22], [-0.5, 0.52], [-0.38, 0.6], [-0.28, 0.55], [-0.1, 0.86],
  [0.04, 1.0], [0.16, 0.82], [0.34, 0.5], [0.62, 0.24], [1.0, 0.0],
];
const P0_TAN = P0_POINTS.map((p, i, a) => {
  const p0 = a[Math.max(0, i - 1)], p1 = a[Math.min(a.length - 1, i + 1)];
  return (p1[1] - p0[1]) / (p1[0] - p0[0]);
});
/** P0(u): smooth year-0 silhouette, u in [-1, 1] -> v in [0, 1] (cubic Hermite through the points). */
export function p0(u) {
  if (u <= -1 || u >= 1) return 0;
  const P = P0_POINTS;
  let i = 0;
  while (i < P.length - 2 && u > P[i + 1][0]) i++;
  const x0 = P[i][0], x1 = P[i + 1][0], h = x1 - x0, s = (u - x0) / h;
  const s2 = s * s, s3 = s2 * s;
  const v = (2 * s3 - 3 * s2 + 1) * P[i][1] + (s3 - 2 * s2 + s) * h * P0_TAN[i]
    + (-2 * s3 + 3 * s2) * P[i + 1][1] + (s3 - s2) * h * P0_TAN[i + 1];
  return Math.max(0, v);
}
/** The worn-down shape the mountain tends toward: a low rounded dome with the same footprint. */
export function dome(u) {
  const r = Math.max(0, 1 - u * u), d = (u - 0.04) / 0.5;
  return r * r * (0.55 + 0.45 * Math.exp(-d * d));
}
/** Skyline height (world units) at profile coordinate u for a given year. */
export function ridgeHeight(u, y) {
  const s = valleyState(y);
  return s.peak * lerp(dome(u), p0(u), s.sharp);
}
/** GLSL mirror: float p0Profile(float u), float domeProfile(float u), float ridgeProfile(u, peak, sharp). */
export const PROFILE_GLSL = /* glsl */ `
#ifndef STORY_PROFILE
#define STORY_PROFILE
const vec2 P0_PTS[11] = vec2[11](${P0_POINTS.map((p) => `vec2(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`).join(', ')});
const float P0_TAN[11] = float[11](${P0_TAN.map((v) => v.toFixed(6)).join(', ')});
float p0Profile(float u) {
  if (u <= -1.0 || u >= 1.0) return 0.0;
  int i = 0;
  for (int k = 0; k < 9; k++) { if (u > P0_PTS[k + 1].x) i = k + 1; }
  float x0 = P0_PTS[i].x, h = P0_PTS[i + 1].x - x0, s = (u - x0) / h, s2 = s * s, s3 = s2 * s;
  float v = (2.0 * s3 - 3.0 * s2 + 1.0) * P0_PTS[i].y + (s3 - 2.0 * s2 + s) * h * P0_TAN[i]
          + (-2.0 * s3 + 3.0 * s2) * P0_PTS[i + 1].y + (s3 - s2) * h * P0_TAN[i + 1];
  return max(0.0, v);
}
float domeProfile(float u) {
  float r = max(0.0, 1.0 - u * u), d = (u - 0.04) / 0.5;
  return r * r * (0.55 + 0.45 * exp(-d * d));
}
float ridgeProfile(float u, float peak, float sharp) { return peak * mix(domeProfile(u), p0Profile(u), sharp); }
#endif
`;

// ---- The master frame (S06, S10, S17, S18 must overlay to the pixel) --------------------------
// 20° vertical FOV on the 2.39:1 picture area = 26.68° three.js vertical fov on the full 16:9 frame.
export const MASTER_CAMERA = { position: [0, 0.02, 0], rotation: [5, 0, 0], fov: 26.68, near: 0.005, far: 2000 };
const PITCH = (5 * Math.PI) / 180, TAN_V = Math.tan((10 * Math.PI) / 180), TAN_H = TAN_V * 2.39;
/** Project a W2 world point through the master camera -> [x, y] in the picture area (0..1, y up). */
export function masterProject([x, y, z]) {
  const dy = y - MASTER_CAMERA.position[1];
  const depth = dy * Math.sin(PITCH) - z * Math.cos(PITCH);
  const up = dy * Math.cos(PITCH) + z * Math.sin(PITCH);
  return [0.5 + x / depth / (2 * TAN_H), 0.5 + up / depth / (2 * TAN_V)];
}
/** Skyline of the mountain in master-frame picture coordinates for a given year: sx (0..1) -> sy. */
export function masterSkyline(sx, y) {
  const depth = 160, worldX = (sx - 0.5) * 2 * TAN_H * depth; // good to ~1% near the summit
  const u = (worldX - SUMMIT[0]) / RIDGE_HALF_WIDTH + 0.04;
  return masterProject([worldX, ridgeHeight(u, y), SUMMIT[2]])[1];
}
export const MASTER_HORIZON_Y = masterProject([0, 0, -1e6])[1]; // ≈ 0.25

// ---- The seed's pulse: period 3.0 s, rise 0.4 s, decay 1.6 s; peaks fixed by the script -------
// Peaks: 25 + 3k in the prologue and Act I; 134, 137, 140 … through the burial and Act III;
// 220, 223, 226 at the end. Returns 0..1; multiply by the shot's seedGlow.
export function seedPulse(t) {
  const phase = t < 120 ? 25 : t < 200 ? 134 : 220;
  const d = ((((t - phase + 0.4) % 3) + 3) % 3) - 0.4; // -0.4 .. 2.6 around the peak
  if (d < 0) return smooth(1 + d / 0.4);
  return Math.exp(-d * d / (2 * 0.55 * 0.55)) * (1 - smooth(d / 1.6) * 0.15);
}

// ---- Reserved palette --------------------------------------------------------------------------
export const PALETTE = {
  amber: '#FFB347',      // RESERVED: the seed's core and light the film equates with it
  fire: '#FF6A1F',       // the amber's rival; never use amber for fire
  husk: '#2A1B12', silk: '#DCEFFA',
  iceVoid: '#02040A', iceDeep: '#06162B', iceMid: '#0E3A5C', iceGlow: '#6FD3E8', bubble: '#DCEFFA', sunBlade: '#FFE2B0',
  nightSky: '#050A18', moonRidge: '#2A3550', riverSilver: '#C9D6E8',
  cardText: '#F2EDE4',
};
