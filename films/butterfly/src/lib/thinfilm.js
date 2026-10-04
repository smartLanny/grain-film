// THINFILM — structural colour as a function of angle (SCRIPT.md 3.0). Owner: Group B (MACRO).
//
//   import { THINFILM } from '../lib/thinfilm.js';
//   fragmentShader: THINFILM + `... vec3 refl = thinFilm(dot(N, V), 1.0); ...`
//
// GLSL (all return LINEAR reflectance, scene-referred: multiply by the light)
//   vec3  thinFilm(float cosTheta, float thickness)
//           cosTheta   cosine of the angle between the surface normal and the view (1 = normal, 0 = grazing)
//           thickness  multiplier on the reference film (1 = the wing; > 1 runs cyan, < 1 runs violet)
//           The film-wide ramp. cos 1.00 -> THE wing blue #1F5BFF (blue channel = 1.0)
//                               cos 0.93 -> cyan #19C8F0 (22 deg off normal; cyan from ~13 to ~33 deg)
//                               cos 0.72 -> blue again, cos 0.50 -> violet #6A3CFF (x 0.7)
//                               cos < 0.30 -> black (the dark angle: outside the lobe)
//   vec3  thinFilmRamp(float path)   hue of a relative optical path: 1.048 cyan, 1 blue, 0.912 violet,
//                                    <= 0.83 black (the reflection has left the visible for the UV)
//   float thinFilmPath(float cosTheta)   relative optical path of the tilted multilayer at that angle
//   vec3  wingSheen(vec3 N, vec3 T, vec3 V, vec3 L, float thickness, float spread)
//           The scale-covered WING under one light: N surface normal, T the scale's long axis (ridge
//           direction, on a wing: from the wing base toward the margin), V to the eye, L to the light.
//           An anisotropic lobe in half-vector space (narrow along the ridges, wide across them, as
//           Morpho ridges diffract): cyan at the lobe's heart, blue across most of it, violet at its
//           rim, black outside. `spread` scales the lobe (1 = hero wing; 1.6 = a far, simple wing).
//           Use this for wings and scales; use thinFilm() for windows, the SHEEN band and ink.
//
// HOW THE SCRIPT'S "blue -> cyan -> violet -> black" IS OBTAINED (decision, for all groups)
// A single film can only blue-shift as it tilts (blue -> violet), so a plain film never shows cyan
// off-normal (the scaffold's finding). A real Morpho scale is not a plain film: it is a chitin/air
// multilayer (effective index ~1.25, so its colour moves fast with angle) whose lamellae are
// TILTED ~22 deg from the scale's surface. Seen along the surface normal the light already crosses
// the layers 22 deg off their own normal: blue. Tilt the view 22 deg and it crosses them head-on,
// the longest path: cyan. Tilt further and the path shortens: blue again, violet, and then the
// reflection leaves the visible for the ultraviolet: black. That is the ramp implemented here:
//     path(theta) = sqrt(1 - sin^2(theta - 22deg) / n^2) / sqrt(1 - sin^2(22deg) / n^2),  n = 1.25
//     colour      = ramp(thickness * path), anchored on the three reserved colours of story.PALETTE
// The anchors are exact palette colours (an artistic ramp on physical abscissae) rather than a
// spectral sum, so every group gets the same three blues. `thickness` is the film's own thickness
// (scale to scale it varies ~1%: that is the glitter): thicker = longer path = toward cyan.
//
// For FLOCK / far wings: thinFilm(1.0, 1.0) is THE wing blue; flicker `cosTheta` between 0.55 and 1
// with the wingbeat for the violet/cyan play; closed wings are ink (PALETTE.underside), not film.

import { PALETTE, linear } from './story.js';

export const THINFILM_CONST = {
  n: 1.25,               // effective index of the chitin/air multilayer
  tilt: 22,              // degrees: lamellae tilt from the scale surface
  cyan: 1.048, cyanFrom: 1.018, blue: 1.0, violet: 0.912, dark: 0.83,   // relative optical paths of the anchors
};
const C = THINFILM_CONST;
const TAU_R = (C.tilt * Math.PI) / 180;
const P0 = Math.sqrt(1 - Math.sin(TAU_R) ** 2 / (C.n * C.n));
const BLUE = linear(PALETTE.wingBlue), CYAN = linear(PALETTE.wingCyan), VIOLET = linear(PALETTE.wingViolet);
// normalise so that THE blue has a blue channel of exactly 1 (its hue is the palette's)
const norm = (c) => c.map((v) => v / BLUE[2]);
const A_BLUE = norm(BLUE), A_CYAN = norm(CYAN), A_VIOLET = norm(VIOLET);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const mix3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

/** Relative optical path of the tilted multilayer seen at cosTheta from the surface normal. */
export function thinFilmPathJS(cosTheta) {
  const th = Math.acos(clamp01(cosTheta)) - TAU_R;
  return Math.sqrt(1 - Math.sin(th) ** 2 / (C.n * C.n)) / P0;
}
/** Hue of a relative optical path (linear RGB, THE blue = [.., .., 1]). */
export function thinFilmRampJS(p) {
  let c = mix3(A_VIOLET, A_BLUE, smoothstep(C.violet, C.blue, p));
  c = mix3(c, A_CYAN, smoothstep(C.cyanFrom, C.cyan, p));
  const k = smoothstep(C.dark, C.violet + 0.012, p);
  return c.map((v) => v * k);
}
/** CPU mirror of thinFilm(): linear reflectance [r, g, b]. */
export function thinFilmJS(cosTheta, thickness = 1) {
  const c = clamp01(cosTheta);
  const lobe = Math.sqrt(c) * smoothstep(0.2, 0.42, c);
  return thinFilmRampJS(thickness * thinFilmPathJS(c)).map((v) => v * lobe);
}

const f = (x) => { const s = Number(x).toFixed(6); return s.includes('.') ? s : s + '.0'; };
const v3 = (a) => `vec3(${a.map(f).join(', ')})`;
export const THINFILM = /* glsl */ `
#ifndef FILM_THINFILM
#define FILM_THINFILM
const float TF_N2 = ${f(C.n * C.n)};
const float TF_TILT = ${f(TAU_R)};
const float TF_P0 = ${f(P0)};
const vec3 TF_BLUE = ${v3(A_BLUE)};
const vec3 TF_CYAN = ${v3(A_CYAN)};
const vec3 TF_VIOLET = ${v3(A_VIOLET)};
/** Relative optical path of the tilted multilayer seen at cosTheta from the surface normal. */
float thinFilmPath(float cosTheta) {
  float th = acos(clamp(cosTheta, 0.0, 1.0)) - TF_TILT;
  float s = sin(th);
  return sqrt(1.0 - s * s / TF_N2) / TF_P0;
}
/** Hue of a relative optical path: ${f(C.cyan)} cyan, 1 blue, ${f(C.violet)} violet, <= ${f(C.dark)} black. */
vec3 thinFilmRamp(float p) {
  vec3 c = mix(TF_VIOLET, TF_BLUE, smoothstep(${f(C.violet)}, ${f(C.blue)}, p));
  c = mix(c, TF_CYAN, smoothstep(${f(C.cyanFrom)}, ${f(C.cyan)}, p));
  return c * smoothstep(${f(C.dark)}, ${f(C.violet + 0.012)}, p);
}
/** Linear reflectance RGB of the wing film seen at cosTheta from its normal, film thickness x 1. */
vec3 thinFilm(float cosTheta, float thickness) {
  float c = clamp(cosTheta, 0.0, 1.0);
  return thinFilmRamp(thickness * thinFilmPath(c)) * sqrt(c) * smoothstep(0.2, 0.42, c);
}
/**
 * The scale-covered wing under one light (see the header). Returns linear reflectance; multiply
 * by the light's radiance. x = 0 at the heart of the lobe (cyan), ~0.5 blue, ~1.1 violet, > 1.6 black.
 */
vec3 wingSheen(vec3 N, vec3 T, vec3 V, vec3 L, float thickness, float spread) {
  float nl = dot(N, L), nv = dot(N, V);
  if (nl <= 0.0 || nv <= 0.0) return vec3(0.0);
  vec3 H = normalize(L + V);
  vec3 Tn = normalize(T - N * dot(N, T));
  vec3 B = cross(N, Tn);
  float hn = max(dot(H, N), 1e-3);
  // slopes of the half vector along / across the ridges; the lobe is 11 deg along, 34 deg across
  vec2 s = vec2(dot(H, Tn), dot(H, B)) / hn / (vec2(0.20, 0.68) * spread);
  float x = length(s);
  float p = thickness * (1.05 - 0.125 * pow(x, 1.45));          // a slow roll-off: blue, a wide violet, then dark
  float lobe = 1.0 - smoothstep(0.9, 1.75, x);
  return thinFilmRamp(p) * lobe * (0.35 + 0.65 * smoothstep(0.0, 0.25, nl)) * smoothstep(0.0, 0.12, nv);
}
#endif
`;
