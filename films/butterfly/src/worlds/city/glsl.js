// CITY — shared GLSL for the five sets (SCRIPT.md W1). Owner: Group C (CITY).
//
// The human world is painted, not lit. Every set draws an INK DENSITY (0 = bare paper, 1 = solid
// black) and, from S15 on, a hue for the wash under it. INK_OUT turns that into the linear HDR value
// that the engine's grade maps back to exactly the display luminance the INK pass (lib/ink.js) reads
// as that density (the palette's own curve: the five tones at .12 .30 .55 .78 .95). So the tones
// chosen here are the tones on the paper.
// (world.post switches off everything in the grade that would bend it: lift, contrast, vignette,
// bloom, chromatic aberration; see city.js PLAIN.)
//
//   INK_OUT      gradeInv, inkValue, inkOut(d), inkOutCol(d, hue)
//   BRUSH        sdBox, sdSeg, cov, lineCov, dryBrush, bump: small tools for drawing with a brush
//   TOWERS       towerRow(): THE generator. One row of towers on a baseline, cut from hashes: slabs,
//                setbacks, needles, twin towers, towers under construction with cranes; roof
//                bulkheads, water tanks, antennae; a window grid whose cells are lit by hash.
//                Expects `float cityEnvelope(int layer, float x)` declared before it (the art
//                direction of each skyline: ranges, valleys, the places left empty).
//   RAIN         rainStrokes(): rain as ink strokes, 8 degrees off vertical, tapered, three depths.

import { NOISE } from '../../lib/glsl/noise.js';
import { gradeDefault } from '../../lib/ink.js';
import { PALETTE, INK_TONES, linear } from '../../lib/story.js';

// Inverses of the ACES fit matrices used by post.js (Stephen Hill's), so colour washes survive the grade.
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
// row-major 3x3 of post.js's column-major mat3 IN / OUT
const ACES_IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const glslMat = (rowMajor) => { const m = rowMajor; return `mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map((v) => v.toFixed(6)).join(', ')})`; };

// The INK pass reads a pixel's luminance relative to "bare paper as graded" and maps it to a density
// on the palette's own curve (lib/ink.js: KS knots through gradeDefault). The inverse, for painting:
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const SRC_LUMA = lumaOf(gradeDefault(linear(PALETTE.paper)));
const TONES_UP = [...INK_TONES].reverse();                                  // 清 .12 ... 焦 .95
const KD = [0, ...TONES_UP.map((t) => t.d), 1];
const KS = [1, ...TONES_UP.map((t) => lumaOf(gradeDefault(linear(t.hex))) / SRC_LUMA), 0];
const fx = (x) => x.toFixed(5);

export const INK_OUT = /* glsl */ `
#ifndef CITY_INK_OUT
#define CITY_INK_OUT
const mat3 ACES_IN_INV = ${glslMat(inv3(ACES_IN))};
const mat3 ACES_OUT_INV = ${glslMat(inv3(ACES_OUT))};
const float SRC_LUMA = ${fx(SRC_LUMA)};        // the graded luminance the INK pass reads as bare paper
float srgbToLin(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
// inverse of the RRT/ODT fit: y = (c (c + a) - e) / (c (b c + d) + f)
float rrtInv(float y) {
  y = clamp(y, 0.0, 0.94);
  float A = 0.983729 * y - 1.0, B = 0.432951 * y - 0.0245786, C = 0.238081 * y + 0.000090537;
  return (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
}
/** Display grey L (0..1) -> the linear HDR grey the (flat) grade maps to it. */
float gradeInv(float L) { return 0.6 * rrtInv(srgbToLin(clamp(L, 0.0, 0.975))); }
/** Display colour -> linear HDR colour (through the inverse ACES fit, gamut-clamped). */
vec3 gradeInvCol(vec3 c) {
  c = clamp(c, 0.0, 0.975);
  vec3 y = ACES_OUT_INV * vec3(srgbToLin(c.r), srgbToLin(c.g), srgbToLin(c.b));
  y = max(y, 0.0);
  vec3 r = vec3(rrtInv(y.r), rrtInv(y.g), rrtInv(y.b));
  return max(0.6 * (ACES_IN_INV * r), 0.0);
}
/** Value (display luminance relative to bare paper) the INK pass reads as density d: its curve, inverted. */
float inkValue(float d) {
  d = clamp(d, 0.0, 1.0);
  float v = 1.0;
${KD.slice(0, -1).map((d0, i) => `  v = mix(v, ${fx(KS[i + 1])}, clamp((d - ${fx(d0)}) / ${fx(KD[i + 1] - d0)}, 0.0, 1.0));`).join('\n')}
  return v;
}
/** Ink of density d (0 = bare paper, the five tones at .12 .30 .55 .78 .95, 1 = solid), neutral. */
vec3 inkOut(float d) { return vec3(gradeInv(SRC_LUMA * inkValue(d))); }
/**
 * Ink of density d over a wash of display colour hue (any brightness; only its chroma is used).
 * The pass takes a saturated pixel's value from its brightest channel (a pure hue carries no ink)
 * and a grey's from its luminance: the same rule here, so the tone comes out as asked.
 */
vec3 inkOutCol(float d, vec3 hue) {
  float mx = max(hue.r, max(hue.g, hue.b));
  vec3 h = hue / max(mx, 1e-3);
  float sat = smoothstep(0.06, 0.24, 1.0 - min(h.r, min(h.g, h.b)));
  float v = SRC_LUMA * inkValue(d);
  vec3 c = h * v / mix(max(dot(h, vec3(0.2126, 0.7152, 0.0722)), 1e-3), 1.0, sat);
  return gradeInvCol(min(c, vec3(0.975)));
}
/** View depth z (world units) -> gl_FragDepth for a perspective camera (near, far). */
float depthFor(float z, float near, float far) { return clamp(far * (z - near) / (z * (far - near)), 0.0, 0.99999); }
#endif
`;

export const BRUSH = NOISE + /* glsl */ `
#ifndef CITY_BRUSH
#define CITY_BRUSH
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0); return length(pa - ba * h); }
/** Antialiased coverage of a signed distance (negative = inside); px = the width of the edge. */
float cov(float sd, float px) { return clamp(0.5 - sd / px, 0.0, 1.0); }
/** A line of half-width hw at distance dist: thinner than a pixel it fades instead of aliasing. */
float lineCov(float dist, float hw, float px) {
  float w = max(hw, 0.5 * px);
  return clamp(0.5 + (w - dist) / px, 0.0, 1.0) * min(1.0, hw / (0.5 * px));
}
float bump(float x, float c, float w) { float u = (x - c) / w; return exp(-u * u); }
float band(float x, float a, float b, float s) { return smoothstep(a - s, a + s, x) * (1.0 - smoothstep(b - s, b + s, x)); }
/**
 * Dry brush (flying white): how much of a stroke takes on the paper. p in paper space, dir = the
 * stroke's direction, load 1 = a full wet brush (solid) .. 0 = nearly dry (mostly tooth showing).
 * Streaks run along the stroke; nothing here moves with time.
 */
float dryBrush(vec2 p, vec2 dir, float load) {
  vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
  float n = 0.6 * vnoise(q * vec2(9.0, 260.0)) + 0.4 * vnoise(q * vec2(31.0, 610.0) + 7.3);   // -1..1
  n = 0.5 + 0.5 * n;
  float th = 1.0 - clamp(load, 0.0, 1.0);
  return smoothstep(th - 0.22, th + 0.22, n + 0.25 * (load - 0.5));
}
/** A soft blotchy unevenness of a wash, 0..1, paper-anchored. */
float washBlot(vec2 p) { return 0.5 + 0.5 * (0.65 * vnoise(p * 5.0) + 0.35 * vnoise(p * 13.0 + 3.7)); }
#endif
`;

export const TOWERS = /* glsl */ `
#ifndef CITY_TOWERS
#define CITY_TOWERS
/**
 * One row of towers standing on y = 0 (the generator of every set).
 *   p       layer coordinates: x along the row, y up (any unit; all sizes scale with cellW / ww)
 *   seed    which row;  layer: passed to cityEnvelope(layer, x) for the art-directed skyline
 *   cellW   lot width (one tower per lot, some lots empty);  hLo..hHi heights
 *   fill    0..1 how many lots are built;  tall 0..1 bias toward stepped towers with needles (peaks)
 *   podium  height of the low continuous street wall the towers rise from (0 = none)
 *   detail  0..1 roof furniture (bulkheads, tanks, antennae, cranes)
 *   lit     0..1 fraction of windows lit;  ww window pitch (x), row pitch = 1.18 ww
 *   px      edge width (a pixel, or more for soft far planes)
 * Returns (silhouette coverage, lit-window reserve, unlit-window mark, height fraction 0 base..1 roof).
 */
vec4 towerRow(vec2 p, float seed, int layer, float cellW, float hLo, float hHi, float fill, float tall, float podium, float detail, float lit, float ww, float px) {
  float ci = floor(p.x / cellW);
  vec4 h = hash42(vec2(ci, seed * 13.7 + 1.0));
  vec4 g = hash42(vec2(ci * 1.37 + 71.3, seed * 5.3 + 2.0));
  float env = cityEnvelope(layer, (ci + 0.5) * cellW);
  float H = mix(hLo, hHi, h.x * h.x) * env;
  // the street wall: low blocks of uneven height that fill the lots between the towers
  float pod = 0.0, podH = 0.0;
  if (podium > 0.0) {
    float pc = floor(p.x / (cellW * 0.37));
    podH = podium * mix(0.55, 1.25, hash12(vec2(pc, seed + 3.3))) * min(env * 1.6, 1.0);
    pod = cov(p.y - podH, px) * step(0.02, env);
  }
  if (h.w > fill || H < 0.15 * hLo) return vec4(pod, 0.0, 0.0, clamp(p.y / max(podH, 1e-4), 0.0, 1.0));
  float m = cellW;
  float style = floor(g.x * 5.999);
  if (g.x < tall) style = g.x < tall * 0.62 ? 2.0 : 1.0;
  float bw = m * mix(0.27, 0.45, h.y);                                   // half width of the body
  if (style == 2.0) bw = m * mix(0.22, 0.32, h.y);
  float u = p.x - (ci + 0.5) * cellW - (h.z - 0.5) * (m - 2.0 * bw) * (style == 4.0 ? 0.2 : 0.7);
  float y = p.y;
  float sd, roof = H;                                                    // roof = where the furniture stands
  if (style < 1.0) {                                                     // a slab
    sd = sdBox(vec2(u, y - H * 0.5), vec2(bw, H * 0.5));
  } else if (style < 2.0) {                                              // one setback
    float f1 = mix(0.5, 0.82, g.y), o = (g.z - 0.5) * bw * 0.6;
    sd = min(sdBox(vec2(u, y - H * f1 * 0.5), vec2(bw, H * f1 * 0.5)), sdBox(vec2(u - o, y - H * 0.5), vec2(bw * 0.6, H * 0.5)));
  } else if (style < 3.0) {                                              // three tiers and a needle
    float f1 = mix(0.45, 0.6, g.y), f2 = mix(0.72, 0.86, g.z);
    sd = min(sdBox(vec2(u, y - H * f1 * 0.5), vec2(bw, H * f1 * 0.5)), sdBox(vec2(u, y - H * f2 * 0.5), vec2(bw * 0.68, H * f2 * 0.5)));
    sd = min(sd, sdBox(vec2(u, y - H * 0.5), vec2(bw * 0.36, H * 0.5)));
  } else if (style < 4.0) {                                              // a slim tower with a slanted crown
    float slope = (g.y - 0.5) * 1.2;
    float topY = H - m * 0.12 + slope * u;
    sd = max(sdBox(vec2(u, y - H * 0.5), vec2(bw * 0.8, H * 0.5)), y - topY);
    roof = H - m * 0.12 - abs(slope) * bw * 0.8;
  } else if (style < 5.0) {                                              // under construction
    float Hb = H * 0.84;
    sd = sdBox(vec2(u, y - Hb * 0.5), vec2(bw, Hb * 0.5));
    roof = Hb;
  } else {                                                               // twins and a skybridge
    float gap = bw * mix(0.16, 0.3, g.y), tw = (bw - gap) * 0.5, H2 = H * mix(0.78, 0.96, g.z);
    sd = min(sdBox(vec2(u + gap + tw, y - H * 0.5), vec2(tw, H * 0.5)), sdBox(vec2(u - gap - tw, y - H2 * 0.5), vec2(tw, H2 * 0.5)));
    sd = min(sd, sdBox(vec2(u, y - H2 * mix(0.5, 0.8, g.w)), vec2(gap + 0.2 * tw, m * 0.02)));
    roof = H2;
  }
  float body = cov(sd, px);
  float c = max(body, pod);
  // ---- roof furniture ----
  if (detail > 0.0) {
    vec4 f = hash42(vec2(ci * 3.1 + 9.0, seed + 40.0));
    float yr = y - roof;
    if (style == 4.0) {
      // the open frame of the top floors, and a tower crane
      float fy = yr / (ww * 1.18), fx = (u + bw) / (bw * 0.5);
      float frame = max(lineCov(abs(fract(fy + 0.5) - 0.5) * ww * 1.18, ww * 0.07, px), lineCov(abs(fract(fx + 0.5) - 0.5) * bw * 0.5, ww * 0.08, px));
      c = max(c, frame * cov(sdBox(vec2(u, yr - (H - roof) * 0.5), vec2(bw, (H - roof) * 0.5)), px));
      float dir = f.x < 0.5 ? -1.0 : 1.0, xm = -dir * m * 0.12, mh = m * mix(0.32, 0.5, f.y), jy = H + mh;
      float crane = lineCov(sdSeg(vec2(u, y), vec2(xm, roof), vec2(xm, jy + m * 0.07)), m * 0.008, px);                 // mast
      crane = max(crane, lineCov(sdSeg(vec2(u, y), vec2(xm - dir * m * 0.16, jy), vec2(xm + dir * m * 0.44, jy)), m * 0.006, px));  // jib
      crane = max(crane, lineCov(sdSeg(vec2(u, y), vec2(xm, jy + m * 0.07), vec2(xm + dir * m * 0.40, jy)), m * 0.0025, px));       // ties
      crane = max(crane, lineCov(sdSeg(vec2(u, y), vec2(xm, jy + m * 0.07), vec2(xm - dir * m * 0.15, jy)), m * 0.0025, px));
      crane = max(crane, cov(sdBox(vec2(u - (xm - dir * m * 0.13), y - jy + m * 0.012), vec2(m * 0.03, m * 0.016)), px));           // counterweight
      float hx = xm + dir * m * mix(0.2, 0.38, f.z);
      crane = max(crane, lineCov(sdSeg(vec2(u, y), vec2(hx, jy), vec2(hx, jy - m * mix(0.12, 0.3, f.w))), m * 0.002, px));          // hook line
      c = max(c, crane * detail);
    } else {
      float fur = 0.0;
      // stair / lift bulkhead
      if (f.x < 0.75) fur = max(fur, cov(sdBox(vec2(u - (f.y - 0.5) * bw * 0.9, yr - m * 0.03), vec2(bw * mix(0.18, 0.4, f.z), m * 0.03)), px));
      // a water tank on legs
      if (f.w < 0.55 && style != 3.0) {
        float tx = (f.z - 0.5) * bw * 1.3, tr = m * mix(0.035, 0.05, f.y);
        fur = max(fur, cov(sdBox(vec2(u - tx, yr - tr * 2.3), vec2(tr, tr * 1.1)) - tr * 0.15, px));
        fur = max(fur, lineCov(abs(abs(u - tx) - tr * 0.7), tr * 0.12, px) * step(0.0, yr) * step(yr, tr * 1.6));
        fur = max(fur, cov(sdBox(vec2(u - tx, yr - tr * 3.75), vec2(tr * 0.75, tr * 0.2)), px));        // its conical cap
      }
      // antennae
      float ah = m * mix(0.25, 0.9, f.y * f.y) * (style == 2.0 ? 1.6 : 1.0);
      if (f.y > 0.35 || style == 2.0) {
        float ax = style == 2.0 ? 0.0 : (f.x - 0.5) * bw * 1.2;
        float topr = style == 2.0 ? H : roof;
        fur = max(fur, lineCov(sdSeg(vec2(u, y), vec2(ax, topr), vec2(ax, topr + ah)), m * 0.004 * (1.0 - 0.6 * clamp((y - topr) / ah, 0.0, 1.0)), px));
        fur = max(fur, lineCov(sdSeg(vec2(u, y), vec2(ax - m * 0.03, topr + ah * 0.55), vec2(ax + m * 0.03, topr + ah * 0.55)), m * 0.002, px));
        if (f.z > 0.6) fur = max(fur, lineCov(sdSeg(vec2(u, y), vec2(ax + m * 0.07, topr), vec2(ax + m * 0.07, topr + ah * 0.45)), m * 0.003, px));
      }
      c = max(c, fur * detail);
    }
  }
  // ---- windows: cells lit by hash; a floor now and then working late ----
  float litM = 0.0, markM = 0.0;
  float wh = ww * 1.18;
  float show = smoothstep(2.2 * px, 4.5 * px, ww);                        // too small to draw: leave the wash alone
  if (show > 0.0 && body > 0.0) {
    float col = floor((u + bw) / ww), row = floor((H - y) / wh);
    vec2 fc = vec2(fract((u + bw) / ww), fract((H - y) / wh));
    vec3 wj = hash32(vec2(col + ci * 17.0, row + seed * 31.0));
    float towerLit = lit * mix(0.2, 2.4, g.w * g.w);
    float late = step(hash12(vec2(row * 1.7 + 3.0, ci + seed * 7.0)), 0.06) * step(0.45, g.w);
    float isLit = step(wj.x, clamp(towerLit + late * 0.75, 0.0, 0.92));
    vec2 wc = (fc - 0.5 + (wj.yz - 0.5) * 0.16) * vec2(ww, wh);
    float wsd = sdBox(wc, vec2(ww, wh) * mix(vec2(0.2, 0.19), vec2(0.26, 0.24), wj.z)) - ww * 0.07;
    float win = cov(wsd, px) * cov(sd + ww * 0.45, px) * show;
    litM = win * isLit;
    markM = win * (1.0 - isLit) * step(wj.y, 0.82);
  }
  return vec4(c, litM, markM, clamp(y / max(H, 1e-4), 0.0, 1.0));
}
#endif
`;

export const RAIN = /* glsl */ `
#ifndef CITY_RAIN
#define CITY_RAIN
/**
 * Rain as ink strokes (SCRIPT.md W1): tapered strokes 8 degrees off vertical, falling toward -y
 * and drifting toward +x * lean. s = screen/painting coords (frame heights), scale = depth layer
 * (1 near .. 0.4 far), amount 0..1 = how many lots hold a stroke. Returns stroke coverage 0..1.
 * Closed-form in time: a stroke is a lot on a column that slides down at its own speed.
 */
float rainStrokes(vec2 s, float time, float scale, float amount, float lean, float seed, float px) {
  const float A = 0.13963;                                              // 8 degrees
  float ca = cos(A), sa = sin(A) * lean;
  vec2 q = vec2(s.x * ca - s.y * sa, s.x * sa + s.y * ca) / scale;       // q.y runs along the strokes
  float cw = 0.021;                                                      // column pitch
  float col = floor(q.x / cw);
  vec3 h = hash32(vec2(col, seed * 17.0 + 3.0));
  float L = mix(0.34, 0.6, h.x);                                         // lot length along the fall
  float speed = mix(1.5, 2.1, h.y);                                      // frame heights per second at scale 1
  float yy = q.y + time * speed + h.z * 9.0;
  float lot = floor(yy / L);
  vec3 k = hash32(vec2(col * 1.3 + 5.0, lot + seed * 3.0));
  if (k.x > amount) return 0.0;
  float len = L * mix(0.22, 0.42, k.y);
  float a = (yy - lot * L) / len;                                        // 0 at the head (below) .. 1 at the tail
  if (a < 0.0 || a > 1.0) return 0.0;
  float hw = 0.0011 * mix(0.6, 1.25, k.z) * (0.25 + 0.75 * sin(3.14159 * pow(a, 0.6)));   // loaded head, thinning tail
  float dx = abs(q.x - (col + 0.25 + 0.5 * k.z) * cw);
  return lineCov(dx * scale, hw * scale, px) * (0.55 + 0.45 * k.y) * smoothstep(1.0, 0.75, a);
}
#endif
`;

// ---- the same, in JS (for libraries that take a linear ink colour, e.g. lib/figure.js) -----------
const rrtInvJS = (y) => {
  y = Math.min(0.94, Math.max(0, y));
  const A = 0.983729 * y - 1.0, B = 0.432951 * y - 0.0245786, C = 0.238081 * y + 0.000090537;
  return (-B - Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A);
};
const srgbToLinJS = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** Value relative to bare paper that the INK pass reads as density d. */
export function inkValueJS(d) {
  d = Math.min(1, Math.max(0, d));
  for (let i = 0; i < KD.length - 1; i++) if (d <= KD[i + 1]) return KS[i] + (KS[i + 1] - KS[i]) * ((d - KD[i]) / (KD[i + 1] - KD[i]));
  return 0;
}
/** Linear HDR grey [r, g, b] that the flat grade (city.js PLAIN) and the INK pass turn into ink of density d. */
export function inkLinear(d) {
  const v = 0.6 * rrtInvJS(srgbToLinJS(Math.min(0.975, SRC_LUMA * inkValueJS(d))));
  return [v, v, v];
}
