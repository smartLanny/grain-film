// W2 INTERIOR: three planar stages for the human being of the film (SCRIPT.md 3, W2). Owner: INTERIOR.
//   desk    S02, S04a, S08   seen from outside through a window: a hump of ink against a lamp
//   train   S11, S14         a subway car from outside, side-on: seven strap-hangers in the window band
//   stairs  S16              looking up a deep exit shaft from the stairs: a rectangle of gold light
// Each set is a stack of flat painted layers and ink figures (lib/figure.js) at a few depths in front
// of one square-on camera (the human world is a scroll: locked, planar). The paintings are authored
// in ink densities (lib/ink.js inkPaint: 0 = bare paper, .12 .30 .55 .78 .95 the five tones), so the
// INK pass reads them as the washes they are. Everything is a pure function of film time.
//
// Frame coordinates everywhere: (x, y) = fractions of the full frame, y up (story.js units).

import * as THREE from 'three';
import { createFigure } from '../lib/figure.js';
import { createButterfly, FEET_Y } from '../lib/butterfly.js';
import { createDrop } from '../lib/drop.js';
import { createFlock } from '../lib/flock.js';
import { PAPER_GLSL, DRYBRUSH_GLSL } from '../lib/ink.js';
import { NOISE } from '../lib/glsl/noise.js';
import { thinFilmRampJS } from '../lib/thinfilm.js';
import { FX_LAYER } from '../post.js';
import * as S from '../lib/story.js';

// ---------------------------------------------------------------------------------------- frames
const D = 10;                                           // camera to the figures' plane (world units)
const frameOf = (H) => ({ H, W: 2 * H, fov: (2 * Math.atan(H / 2 / D) * 180) / Math.PI });
const DESK = frameOf(S.DESK_FRAME.height);
const RING_H = 1.9, SILL_H = 1.036;                     // metres above the car floor (S11: the frame is 3.6 m tall)
const TRAIN = frameOf((RING_H - SILL_H) / S.SEVEN.length);
const TRAIN14 = { H: 2.9, ring: [0.613, 0.72] };        // S14: closer; where the hero's ring sits in frame
// S16: low on the stairs, fifteen steps below the landing. s = scale of a thing relative to the nearest
// climber's (who is a third of the frame tall); the hero's umbrella at the top is S16_UMBRELLA.
const ST = (() => {
  const going = 0.3, rise = 0.17, nTop = 15, z1 = 10.7, hcam = 1.0, sTop = z1 / (z1 + going * nTop);
  const s1 = (S.S16_UMBRELLA.diameter * 2) / (1.1 * sTop);          // frame heights per metre at s = 1
  const B = s1 * ((rise / going) * z1 + hcam), yTop = S.S16_UMBRELLA.hero[1] - 1.42 * s1 * sTop, A = yTop + B * sTop;
  return { going, rise, nTop, z1, hcam, sTop, s1, A, B, yTop, yc0: A - s1 * z1 * (rise / going), hTop: rise * nTop, halfW: 3.9, exitH: 3.0 };
})();
const STAIRS = frameOf(1 / ST.s1);                      // 1 unit = 1 m at scale s = 1
/** Frame position and scale of a point on the flight: step n (continuous), X m from the axis, h m above the tread. */
const stairXY = (n, X, h = 0) => { const sc = ST.z1 / (ST.z1 + ST.going * n); return [0.5 + (X * ST.s1 * sc) / 2, ST.A - ST.B * sc + h * ST.s1 * sc, sc]; };
/** The same on the landing beyond the top step, z metres from the lens. */
const landXY = (z, X, h = 0) => { const sc = ST.z1 / z; return [0.5 + (X * ST.s1 * sc) / 2, ST.yc0 + ST.s1 * sc * (ST.hTop - ST.hcam + h), sc]; };
const GLASS = S.DESK_FRAME.glass;                       // desk: depth ratio of the window glass
/** Frame coordinates at depth ratio k (1 = the figures' plane) -> world. */
const at = (F, fx, fy, k = 1, out = new THREE.Vector3()) => out.set((fx - 0.5) * F.W * k, (fy - 0.5) * F.H * k, -D * k);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const TAU = Math.PI * 2;

// the INK pass's paint curve in JS (for figure colours and rims)
const TONE_D = [0, 0.12, 0.30, 0.55, 0.78, 0.95, 1];
const TONE_C = [[1, 1, 1], S.linear(S.PALETTE.qing), S.linear(S.PALETTE.dan), S.linear(S.PALETTE.zhong), S.linear(S.PALETTE.nong), S.linear(S.PALETTE.jiao), [0, 0, 0]];
function inkPaintJS(d) {
  d = clamp01(d);
  for (let i = 0; i < 6; i++) if (d <= TONE_D[i + 1]) { const k = (d - TONE_D[i]) / (TONE_D[i + 1] - TONE_D[i]); return TONE_C[i].map((c, j) => lerp(c, TONE_C[i + 1][j], k)); }
  return [0, 0, 0];
}
const BLUE = S.linear(S.PALETTE.wingBlue), CYAN = S.linear(S.PALETTE.wingCyan), VIOLET = S.linear(S.PALETTE.wingViolet);
const GOLD = S.linear(S.PALETTE.sunGold);

// ---------------------------------------------------------------------------------------- paint
const PAINT_VERT = /* glsl */ `
uniform vec4 uRect;                    // frame coordinates covered by this quad: x0, y0, x1, y1
varying vec2 vF;
void main() { vF = mix(uRect.xy, uRect.zw, uv); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PAINT_HEAD = NOISE + PAPER_GLSL + DRYBRUSH_GLSL + /* glsl */ `
varying vec2 vF;
uniform float uTime;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float sdRound(vec2 p, vec2 c, vec2 b, float r) { vec2 q = abs(p - c) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float aa(float d) { return clamp(0.5 - d / max(fwidth(d), 1e-6), 0.0, 1.0); }      // coverage of d < 0
`;
/** A painted layer: a quad covering frame rect [x0, y0, x1, y1] of frame F at depth ratio k. */
function paintLayer(F, { name, frag, uniforms = {}, rect = [-0.6, -0.6, 1.6, 1.6], k = 1, transparent = false, depthWrite = true, blending = THREE.NormalBlending, order = 0 }) {
  const geo = new THREE.PlaneGeometry((rect[2] - rect[0]) * F.W * k, (rect[3] - rect[1]) * F.H * k);
  const mat = new THREE.ShaderMaterial({
    name, vertexShader: PAINT_VERT, fragmentShader: PAINT_HEAD + frag, transparent, depthWrite, blending,
    uniforms: { tPaper: { value: null }, uRect: { value: new THREE.Vector4(...rect) }, uTime: { value: 0 }, ...uniforms },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(((rect[0] + rect[2]) / 2 - 0.5) * F.W * k, ((rect[1] + rect[3]) / 2 - 0.5) * F.H * k, -D * k);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

const f4 = (x) => Number(x).toFixed(4);
const DESK_CONST = /* glsl */ `
const vec2 LAMP = vec2(${f4(S.LAMP_SUN[0])}, ${f4(S.LAMP_SUN[1])});
const float LAMP_R = ${f4(S.DESK_FRAME.lampR * 2)};      // frame heights
const float DESK_Y = ${f4(S.DESK_EDGE_Y)};
`;
// ---- desk: the room (wall, lamp, the table and what stands on it, the chair). uFront = 1 draws only
// the table top, in front of the sleeper (the forearms lie on it; the body passes behind it).
const DESK_FRAG = DESK_CONST + /* glsl */ `
uniform float uDawn, uLamp, uFront, uFlat;
const float TOP = 0.0135;                       // thickness of the table top
float box(vec2 f, float x0, float x1, float y0, float y1) { return max(max(x0 - f.x, f.x - x1), max(y0 - f.y, f.y - y1)); }
// a ream stack standing on the desk between x0 and x1 (frame widths), up to height top: coverage, density
vec2 stack(vec2 f, float x0, float x1, float top, float seed, float lit) {
  float y = f.y - DESK_Y;
  if (y < 0.0 || y > top - DESK_Y + 0.01) return vec2(0.0);
  float row = floor(y / 0.0105), fr = fract(y / 0.0105);
  float h1 = hash12(vec2(row, seed)), h2 = hash12(vec2(row + 31.0, seed));
  float a = x0 + (h1 - 0.5) * 0.007, b = x1 + (h2 - 0.5) * 0.009;
  float topRow = floor((top - DESK_Y) / 0.0105);
  if (row > topRow) return vec2(0.0);
  float cov = aa(max(a - f.x, f.x - b));
  float lines = 0.09 * smoothstep(0.35, 0.5, abs(fract(y / 0.0021) - 0.5)) + 0.5 * smoothstep(0.86, 0.97, fr);
  float d = mix(0.34, 0.07, lit) + lines + 0.1 * (h1 - 0.5);
  return vec2(cov, clamp(d, 0.0, 0.9));
}
// the night city behind us, returned by the glass: towers as paler ghosts, a few lit windows
float towers(vec2 f) {
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), w = 0.03 + 0.017 * fi, u = f.x / w + 7.3 * fi;
    float col = floor(u), fx = fract(u), h = hash12(vec2(col, fi * 3.0 + 1.0));
    float top = 0.07 + 0.27 * h * h + 0.05 * fi;
    float on = step(0.42, hash12(vec2(col, fi + 9.0)));
    float body = on * (1.0 - smoothstep(top - 0.004, top, f.y)) * smoothstep(0.0, 0.05, min(fx, 1.0 - fx));
    vec2 g = vec2(fx * 4.0, f.y / (w * 0.9));
    float win = step(0.86, hash12(floor(g) + vec2(col * 3.1, fi * 11.0))) * step(abs(fract(g.x) - 0.5), 0.26) * step(abs(fract(g.y) - 0.5), 0.3);
    a = max(a, body * (0.55 + 0.2 * fi + 0.75 * win));
  }
  return a;
}
void main() {
  vec2 f = vF, q = vec2(f.x * 2.0, f.y), lq = vec2(LAMP.x * 2.0, LAMP.y);
  float rl = length(q - lq);
  float n1 = fbm(q * 1.1 + vec2(3.1, 7.7), 4), n2 = fbm(q * 4.3 + vec2(-5.2, 1.4), 3);
  float lampNight = uLamp * (1.0 - uDawn);
  // ---- the table top: one dark stroke across the frame, its upper edge catching the lamp
  float slab = aa(box(f, 0.052, 0.893, DESK_Y - TOP, DESK_Y));
  float lip = 1.0 - smoothstep(0.0028, 0.006, DESK_Y - f.y + 0.001 * n2);
  float lit = mix(mix(0.6, 0.14, lampNight * exp(-abs(q.x - lq.x) / 0.42)), 0.22, uDawn);
  vec3 slabCol = inkPaint(mix(mix(0.93, 0.86, uDawn), lit, lip));
  if (uFront > 0.5) { if (slab < 0.004) discard; gl_FragColor = vec4(slabCol, slab); return; }
  // ---- the wall: at night a wash that deepens away from the lamp (no edge to the glow); at dawn a
  // flat pale sheet with the window's light lying across it
  float k = clamp((rl - LAMP_R * 1.15 + 0.1 * n1 * smoothstep(0.1, 0.45, rl)) / 1.08, 0.0, 1.0);
  float dN = mix(0.5 + 0.04 * n1, 0.012 + 0.6 * pow(k, 0.62), uLamp) + 0.015 * n2;
  float bar = smoothstep(0.0, 0.05, f.x - 0.07 - 0.22 * (f.y - 0.34)) * (1.0 - smoothstep(0.0, 0.07, f.x - 0.34 - 0.22 * (f.y - 0.34)));
  float dD = 0.14 + 0.025 * n1 - 0.13 * bar * (1.0 - uFlat) - 0.07 * uLamp * exp(-rl * rl / 0.03);
  // under the table: the wall in the table's shadow, deepest right under the top
  float under = aa(box(f, 0.052, 0.893, -1.0, DESK_Y - TOP));
  float sh = under * (0.55 + 0.45 * exp(-(DESK_Y - TOP - f.y) / 0.11));
  dN = mix(dN, 0.6 + 0.03 * n1, sh * 0.9);
  dD = mix(dD, 0.33 + 0.03 * n1, sh * 0.75 * (0.5 + 0.5 * uFlat) + 0.2 * under);
  // the glass gives back the towers behind us, where the room is dark enough to show them
  float tw = towers(f) * (1.0 - smoothstep(0.26, 0.33, f.y)) * (1.0 - uDawn);
  float twL = towers(vec2(f.x * 0.8 + 0.31, (f.y - 0.52) * 0.9)) * smoothstep(0.52, 0.6, f.y) * (1.0 - smoothstep(0.16, 0.3, f.x)) * (1.0 - uDawn);
  dN -= 0.035 * tw + 0.03 * twL;
  float d = mix(dN, dD, uDawn);
  vec3 col = inkPaint(clamp(d, 0.0, 1.0));
  // ---- the desk's drawers at left, a leg at right
  float ped = aa(box(f, 0.066, 0.212, -1.0, DESK_Y - TOP));
  float pd = mix(0.8, 0.62, uDawn) + 0.03 * n2;
  pd = mix(pd, pd - 0.22, aa(abs(f.y - 0.218) - 0.0018) + aa(abs(f.y - 0.105) - 0.0018));
  pd = mix(pd, 0.2, aa(box(f, 0.128, 0.15, 0.264, 0.27)) + aa(box(f, 0.128, 0.15, 0.158, 0.164)));
  col = mix(col, inkPaint(pd), ped);
  col = mix(col, inkPaint(mix(0.85, 0.7, uDawn)), aa(box(f, 0.868, 0.878, -1.0, DESK_Y - TOP)));
  // ---- the chair: a back, a seat under the sleeper's thighs, the mechanism and the post going down
  // behind the sill (the body covers most of the back and the seat)
  float chair = min(min(sdSeg(q, vec2(1.364, 0.12), vec2(1.37, 0.285)) - 0.0065, sdSeg(q, vec2(1.372, 0.285), vec2(1.398, 0.462)) - 0.02),
                min(sdRound(q, vec2(1.226, 0.11), vec2(0.18, 0.021), 0.014),
                    min(sdRound(q, vec2(1.24, 0.083), vec2(0.045, 0.008), 0.004), box(f, 0.6145, 0.6255, -1.0, 0.083))));
  col = mix(col, inkPaint(0.94), aa(chair));
  // ---- on the desk: paper, an open laptop, a mug
  float litL = lampNight * 0.55 + uDawn * 0.8, litR = lampNight * 0.9 + uDawn * 0.6;
  vec2 s1 = stack(f, 0.086, 0.166, 0.468, 1.0, litL), s2 = stack(f, 0.784, 0.854, 0.404, 2.0, litR);
  col = mix(col, inkPaint(s1.y), s1.x); col = mix(col, inkPaint(s2.y), s2.x);
  float laptop = min(sdRound(q, vec2(0.525, DESK_Y + 0.0045), vec2(0.078, 0.0045), 0.003), sdSeg(q, vec2(0.452, DESK_Y + 0.006), vec2(0.405, 0.452)) - 0.0034);
  col = mix(col, inkPaint(0.93), aa(laptop));
  float mug = min(sdRound(q, vec2(1.522, DESK_Y + 0.023), vec2(0.0165, 0.023), 0.005), abs(length(q - vec2(1.541, DESK_Y + 0.025)) - 0.011) - 0.0032);
  col = mix(col, inkPaint(0.9), aa(mug));
  // ---- the lamp: a gooseneck arcing over from its base, the globe hanging at LAMP
  vec2 p0 = vec2(1.43, DESK_Y), p1 = vec2(1.5, 0.76), p2 = vec2(lq.x + 0.002, lq.y + LAMP_R);
  float da = 1e3; vec2 prev = p0;
  for (int i = 1; i <= 12; i++) { float u = float(i) / 12.0; vec2 pt = mix(mix(p0, p1, u), mix(p1, p2, u), u); da = min(da, sdSeg(q, prev, pt)); prev = pt; }
  float arm = aa(da - 0.0042);
  float base = aa(length((q - vec2(1.43, DESK_Y)) / vec2(0.05, 0.016)) - 1.0);
  col = mix(col, inkPaint(0.9), max(arm, base));
  // night: the globe has no edge, it is the heart of the glow. Dawn: a ring of ink with a little light in it
  float soft = 1.0 - smoothstep(LAMP_R * 0.5, LAMP_R * 1.3, rl);
  col = mix(col, vec3(7.0), soft * lampNight);
  float globe = aa(rl - LAMP_R);
  vec3 dayGlobe = mix(inkPaint(0.3 + 0.03 * n2), vec3(2.2), uLamp);
  col = mix(col, dayGlobe, globe * uDawn);
  col = mix(col, inkPaint(mix(0.6, 0.4, uLamp)), aa(abs(rl - LAMP_R) - 0.0022) * uDawn);
  float cap = aa(sdRound(q, vec2(lq.x, lq.y + LAMP_R + 0.004), vec2(0.016, 0.007), 0.004));
  col = mix(col, inkPaint(0.9), cap);
  col = mix(col, slabCol, slab);
  gl_FragColor = vec4(col, 1.0);
}`;
// ---- desk: the window we look through (frame bars on the glass plane) and what the glass returns
const WINDOW_FRAG = /* glsl */ `
uniform float uDawn;
void main() {
  vec2 q = vec2(vF.x * 2.0, vF.y);
  float n = fbm(q * 3.0 + 11.0, 3);
  float bars = max(aa(vF.x - 0.014 - 0.002 * n), aa(abs(vF.x - 0.912) - 0.0055));
  float sill = aa(vF.y - 0.046 - 0.002 * n);
  if (max(bars, sill) < 0.004) discard;
  // the sill: stone, wet-dark at night, with a pale nosing
  float ds = mix(0.62, 0.4, uDawn) + 0.05 * n;
  ds = mix(ds, mix(0.3, 0.14, uDawn), aa(abs(vF.y - 0.04) - 0.0035));
  float d = mix(mix(0.93, 0.74, uDawn) + 0.04 * n, ds, sill * (1.0 - bars));
  gl_FragColor = vec4(inkPaint(d), max(bars, sill));
}`;
// the glass itself: towers behind us, returned at a few percent (no depth)
const REFLECT_FRAG = /* glsl */ `
uniform float uDawn, uAmount;
void main() {
  vec2 f = vF;
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), w = 0.035 + 0.02 * fi;
    float col = floor(f.x / w + 7.0 * fi), h = hash12(vec2(col, fi * 3.0 + 1.0));
    float top = 0.45 + 0.5 * h * h + 0.1 * fi;
    float tower = step(0.55, hash12(vec2(col, fi + 9.0))) * (1.0 - smoothstep(top - 0.01, top, f.y)) * smoothstep(0.0, 0.004, min(fract(f.x / w + 7.0 * fi), 1.0 - fract(f.x / w + 7.0 * fi)) * w);
    a = max(a, tower * (0.5 + 0.25 * fi));
  }
  a *= smoothstep(0.42, 0.6, f.y) * (1.0 - smoothstep(0.2, 0.33, f.x)) * uAmount;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(inkPaint(0.6), vec3(1.0), uDawn), a);
}`;
// the pool of blue the open wings throw on the glass, the desk edge and the shoulder (additive)
const GLOW_FRAG = /* glsl */ `
uniform vec3 uGlow;      // centre (frame), radius (frame widths)
uniform vec3 uGlowCol;
void main() {
  vec2 d = vec2((vF.x - uGlow.x) * 2.0, vF.y - uGlow.y) / (2.0 * max(uGlow.z, 1e-4));
  float g = exp(-dot(d, d) * 2.2);
  gl_FragColor = vec4(uGlowCol * g, 1.0);
}`;
// running rain on glass: beads with tails, drawn as thin ink
const GLASSRAIN_FRAG = /* glsl */ `
uniform float uRain, uSlant;
void main() {
  if (uRain <= 0.0) discard;
  vec2 q = vec2(vF.x * 2.0, vF.y);
  q.x -= uSlant * q.y;                                    // the wind lays the runs over
  float a = 0.0, dd = 0.0;
  for (int l = 0; l < 2; l++) {
    float fl = float(l), w = mix(0.042, 0.027, fl);
    float colm = floor(q.x / w + fl * 13.0), cx = (fract(q.x / w + fl * 13.0) - 0.5) * w;
    float h = hash12(vec2(colm, fl + 1.0));
    if (h > uRain * 0.75) continue;
    float sp = 0.22 + 0.5 * hash12(vec2(colm, fl + 5.0));
    float ph = fract(uTime * sp * 0.6 + h * 9.0);
    float y = 1.15 - ph * 1.4;                            // the bead's height
    cx += 0.004 * sin(q.y * 37.0 + h * 40.0);             // runs wander
    float tail = smoothstep(0.0, 0.01, q.y - y) * (1.0 - smoothstep(0.05, 0.42, q.y - y));
    float line = (1.0 - smoothstep(0.0009, 0.0022, abs(cx))) * tail * 0.5;
    float bead = 1.0 - smoothstep(0.0045, 0.0062, length(vec2(cx, (q.y - y) * 0.8)));
    float ring = bead * smoothstep(0.002, 0.005, length(vec2(cx, (q.y - y) * 0.8) + vec2(0.001, -0.0012)));
    a = max(a, max(line, bead)); dd = max(dd, max(line * 0.35, 0.18 + 0.55 * ring));
  }
  // still beads
  vec2 g = q / 0.031, id = floor(g);
  vec2 o = hash22(id) - 0.5;
  float hb = hash12(id + 17.0);
  float r = length((fract(g) - 0.5 - o * 0.6) * 0.031) / (0.0016 + 0.0034 * hb * hb);
  float still = step(hb, uRain * 0.6) * (1.0 - smoothstep(0.75, 1.0, r));
  a = max(a, still); dd = max(dd, still * (0.2 + 0.5 * smoothstep(0.45, 0.9, r)));
  if (a * uRain < 0.12) discard;
  gl_FragColor = vec4(inkPaint(dd), min(1.0, a * uRain * 1.4));
}`;

// ---- train: what is seen through the window band (the car's far side, the tunnel or the day)
const TRAIN_CONST = /* glsl */ `
const float SILL = ${f4(S.SEVEN.railY - S.SEVEN.length)};
const float WTOP = ${f4(S.SEVEN.railY + 0.055)};
const float RAIL = ${f4(S.SEVEN.railY + 0.03)};
const float RINGY = ${f4(S.SEVEN.railY)};
`;
const N_RINGS = 23;
const TRAIN_BACK_FRAG = TRAIN_CONST + /* glsl */ `
uniform float uTunnel, uShake;
uniform vec3 uRing[${N_RINGS}];           // anchor x (frame), angle (rad), held
float lights(vec2 f, float t) {
  float cov = 0.0;
  for (int r = 0; r < 5; r++) {
    float fr = float(r);
    float yc = mix(0.665, 0.86, (fr + 0.5) / 5.0) + 0.012 * sin(fr * 3.7);
    float hw = 0.0055 + 0.005 * hash11(fr + 2.0);
    float speed = 1.5 + 0.9 * hash11(fr * 7.3 + 1.0), period = 0.36 + 0.4 * hash11(fr * 1.9 + 5.0);
    float u = (f.x - t * speed) / period + 13.0 * fr;
    float cell = floor(u), a = fract(u);
    float len = 0.3 + 0.55 * hash12(vec2(cell, fr));
    float on = step(hash12(vec2(cell + 3.0, fr * 2.0 + 1.0)), 0.72);
    float sx = (len - a) / len;
    cov = max(cov, on * step(0.0, sx) * step(sx, 1.0) * dryBrush(vec2(sx, (f.y - yc) / hw), 0.72, cell * 1.31 + fr * 17.0));
  }
  return cov;
}
const float FLOOR = ${f4(S.SEVEN.railY - RING_H / TRAIN.H)};
// the far side of the car at frame point f (above the floor line): windows, wall, bench, cove
float wallD(vec2 f) {
  vec2 q = vec2(f.x * 2.0, f.y);
  float n = fbm(q * 2.0 + 3.0, 3);
  float cell = (f.x - 0.13) / 0.2, cx = (fract(cell) - 0.5) * 0.2;        // far windows, their pillars between the pairs
  float sw = sdRound(vec2(cx * 2.0, f.y), vec2(0.0, 0.757), vec2(0.165, 0.117), 0.02);
  float win = aa(sw);
  float d = 0.07 + 0.03 * n;                                             // the lit wall: all but bare
  d = mix(d, 0.42, aa(abs(sw) - 0.004));
  // through the far windows: the tunnel wall rushing by, or the day
  float tun = 0.36 + 0.07 * fbm(vec2((f.x - uTime * 1.3) * 3.0, f.y * 40.0), 3);
  tun = mix(tun, 0.62, (1.0 - smoothstep(0.0015, 0.003, abs(f.y - 0.728 - 0.006 * sin(f.x * 9.0 - uTime * 11.0)))) * 0.8);
  tun = mix(tun, 0.0, lights(f, uTime));
  // day: bare sky, a far shore as pale peaks, the bridge's hangers passing, its rail low in the window
  float shore = 0.66 + 0.035 * fbm(vec2((f.x - uTime * 0.03) * 6.0, 1.0), 4) + 0.02 * step(0.6, hash11(floor((f.x - uTime * 0.03) * 55.0))) * hash11(floor((f.x - uTime * 0.03) * 55.0) + 9.0);
  float day = mix(0.02, 0.14, 1.0 - smoothstep(shore - 0.004, shore + 0.004, f.y));
  day = mix(day, 0.1, (1.0 - smoothstep(0.645, 0.655, f.y)) * 0.8);
  float tx = (f.x - uTime * 1.25) / 0.31;
  day = mix(day, 0.4, (1.0 - smoothstep(0.012, 0.02, abs(fract(tx) - 0.5))) * 0.85);
  day = mix(day, 0.5, 1.0 - smoothstep(0.003, 0.006, abs(f.y - 0.652)));
  d = mix(d, mix(day, tun, uTunnel), win);
  // the cove over the windows: cards in a row, then the ceiling
  float card = step(abs(fract(f.x / 0.066 + 0.3) - 0.5), 0.41) * step(abs(f.y - 0.944), 0.016);
  d = mix(d, 0.2 + 0.12 * hash11(floor(f.x / 0.066 + 0.3)), card * step(0.925, f.y));
  d = mix(d, 0.34 + 0.04 * n, smoothstep(0.985, 0.992, f.y));
  // under the sill: the wall, the long bench, the dark beneath it; a stanchion at each pillar
  float below = 1.0 - smoothstep(0.618, 0.622, f.y);
  float wall = 0.46 + 0.04 * n;
  wall = mix(wall, 0.58 + 0.03 * n, 1.0 - smoothstep(0.566, 0.57, f.y));         // the seat back
  wall = mix(wall, 0.68, 1.0 - smoothstep(0.455, 0.459, f.y));                   // the cushion's edge
  wall = mix(wall, 0.8, 1.0 - smoothstep(0.418, 0.422, f.y));                    // under the bench
  d = mix(d, wall, below);
  d = mix(d, 0.3, (1.0 - smoothstep(0.0015, 0.003, abs(f.y - 0.6195))) * 0.9);   // the sill's nosing
  float pole = 1.0 - smoothstep(0.0016, 0.0032, abs(abs(cx) - 0.1));
  d = mix(d, 0.9, pole * step(f.y, 0.92) * step(FLOOR, f.y));
  return d;
}
void main() {
  vec2 f = vF; f.y -= uShake;
  vec2 q = vec2(f.x * 2.0, f.y);
  vec3 col;
  if (f.y >= FLOOR) {
    col = inkPaint(clamp(wallD(f), 0.0, 1.0));
    col = mix(col, vec3(3.2), aa(abs(f.y - 0.97) - 0.006));                 // the tube light
  } else {
    // the floor: what stands above it turned over and drawn short, smeared sideways, under a dark gloss
    float dep = FLOOR - f.y;
    float sm = fbm(vec2(f.x * 26.0, f.y * 5.0) + 1.7, 3) * 0.014 * (0.3 + 4.0 * dep);
    float r = wallD(vec2(f.x + sm, FLOOR + dep / 0.56));
    float gl = fbm(vec2(f.x * 3.0, f.y * 22.0) + 9.0, 3);
    float d = mix(0.66, r, 0.62) + 0.05 + 0.05 * gl;
    d = mix(d, 0.9, 1.0 - smoothstep(0.0, 0.006, dep));                      // where wall meets floor
    d = mix(d, d + 0.1, (1.0 - smoothstep(0.0012, 0.0026, abs(dep - 0.11))) + (1.0 - smoothstep(0.0016, 0.0034, abs(dep - 0.235))));   // floor seams
    col = inkPaint(clamp(d, 0.0, 1.0));
  }
  // rail, straps and rings (free rings swing; held ones hang toward the hand)
  if (f.y > RINGY - 0.05) {
    float dr = abs(f.y - RAIL) - 0.0028, ds = 1e3, dg = 1e3;
    for (int i = 0; i < ${N_RINGS}; i++) {
      vec3 R = uRing[i];
      vec2 anc = vec2(R.x * 2.0, RAIL);
      vec2 c = anc + (RAIL - RINGY - 0.012) * vec2(sin(R.y), -cos(R.y));
      vec2 rc = c + 0.012 * vec2(sin(R.y), -cos(R.y));
      ds = min(ds, sdSeg(q, anc, c) - 0.0016);
      dg = min(dg, abs(length(q - rc) - 0.0125) - 0.0026);
    }
    col = mix(col, inkPaint(0.93), max(aa(dr), max(aa(ds), aa(dg))));
  }
  gl_FragColor = vec4(col, 1.0);
}`;
// ---- train: the car's own body, in front of the figures, with the window band cut out of it
const TRAIN_BODY_FRAG = TRAIN_CONST + /* glsl */ `
uniform float uTunnel, uShake;
void main() {
  vec2 f = vF; f.y -= uShake;
  vec2 q = vec2(f.x * 2.0, f.y);
  float cell = (f.x - 0.13) / 0.2, cx = (fract(cell) - 0.5) * 0.2;
  float sw = sdRound(vec2(cx * 2.0, f.y), vec2(0.0, (SILL + WTOP) * 0.5), vec2(0.2 - 0.0085, (WTOP - SILL) * 0.5), 0.022);
  float open = aa(sw);
  if (open > 0.996) discard;
  float n = fbm(q * 2.3 + 17.0, 4), n2 = fbm(vec2(q.x * 0.7, q.y * 9.0) + 5.0, 3);
  // the car: wet grey steel, paler by day; a pale belt line under the windows; the dark of the bogies;
  // under them the windows' light thrown on the track bed, broken by the sleepers rushing through it
  float body = mix(0.44 + 0.015 * n + 0.012 * n2, 0.6 + 0.03 * n + 0.03 * n2, uTunnel);
  body = mix(body, mix(0.72, 0.14, uTunnel), aa(abs(f.y - 0.535) - 0.0045));              // the belt line
  body = mix(body, 0.82, aa(abs(f.y - 0.585) - 0.0018));
  float gl = dryBrush(vec2(fract((f.x - uTime * 1.9) * 1.1) * 1.4, (f.y - 0.44) / 0.012), 0.55, floor((f.x - uTime * 1.9) * 1.1)) * step(hash11(floor((f.x - uTime * 1.9) * 1.1) + 2.0), 0.6);
  body = mix(body, 0.36, gl * 0.55 * uTunnel * step(f.y, 0.5) * step(0.33, f.y));
  // below the skirt there is no machinery to draw: the car runs out into mist, and a few dry strokes
  // of speed are all that is left of the track
  float sp = fract((f.x - uTime * 2.3) * 0.8);
  float streak = dryBrush(vec2(sp * 1.3, (f.y - 0.2) / 0.01), 0.5, floor((f.x - uTime * 2.3) * 0.8)) * step(hash11(floor((f.x - uTime * 2.3) * 0.8) + 4.0), 0.55);
  streak = max(streak, dryBrush(vec2(fract((f.x - uTime * 1.6) * 0.6 + 0.4) * 1.3, (f.y - 0.105) / 0.014), 0.45, floor((f.x - uTime * 1.6) * 0.6 + 0.4) + 9.0) * step(hash11(floor((f.x - uTime * 1.6) * 0.6 + 0.4) + 7.0), 0.5));
  float mist = 1.0 - smoothstep(0.2, 0.34, f.y + 0.035 * n + 0.02 * n2);
  float under = mix(body, 0.04, mist);
  under = mix(under, mix(0.36, 0.26, uTunnel), streak * mist);
  float d = f.y < 0.36 ? under : body;
  float roof = 1.043;
  float above = mix(0.02, 0.93 - 0.14 * dryBrush(vec2(fract((f.x - uTime * 1.7) * 0.9), (f.y - 1.07) / 0.012), 0.6, floor((f.x - uTime * 1.7) * 0.9)), uTunnel);
  d = mix(d, mix(0.42, 0.7, uTunnel), aa(abs(f.y - 0.965) - 0.004));                      // the gutter
  d = mix(d, above, aa(roof - f.y));
  d = mix(d, 0.95, aa(abs(sw) - 0.0045) * (1.0 - open));                                  // the window's rubber
  gl_FragColor = vec4(inkPaint(clamp(d, 0.0, 1.0)), 1.0 - open);
}`;

// ---- stairs: the last fifteen steps of an exit, the open air above them
const STAIRS_FRAG = /* glsl */ `
uniform float uMask;
const float S1 = ${f4(ST.s1)}, Z1 = ${f4(ST.z1)}, SA = ${f4(ST.A)}, SB = ${f4(ST.B)}, YC0 = ${f4(ST.yc0)}, NTOP = ${f4(ST.nTop)}, STOP = ${f4(ST.sTop)};
const float YTOP = ${f4(ST.yTop)}, HALFW = ${f4(ST.halfW)}, EXTOP = ${f4(ST.yc0 + ST.s1 * ST.sTop * (ST.hTop + ST.exitH - ST.hcam))}, EYE = ${f4(ST.hcam / ST.rise)};
const vec3 GOLD = vec3(${GOLD.map(f4).join(', ')});
void main() {
  vec2 f = vF;
  float ax = abs(f.x - 0.5), exHalf = HALFW * S1 * STOP * 0.5;
  if (ax < exHalf && f.y > YTOP && f.y < EXTOP) discard;                 // the open air (drawn behind)
  float n1 = fbm(vec2(f.x * 5.0, f.y * 2.6) + 2.0, 4), n2 = fbm(vec2(f.x * 2.0, f.y * 30.0) + 7.0, 3);
  float s = (SA - f.y) / SB, hw = HALFW * S1 * s * 0.5;
  float d, glow;
  // how far from the light, in the picture: the gold falls off down the flight and out along the walls
  float toExit = length(vec2(max(ax - exHalf, 0.0) * 2.0, max(YTOP - f.y, 0.0) + max(f.y - EXTOP, 0.0)));
  if (f.y <= YTOP && ax <= hw) {
    // the steps. Above the eye only risers show, each with its lit nosing; below it the treads too
    float n = (Z1 / s - Z1) / 0.3, st = floor(n), fr = fract(n), w = max(fwidth(n), 1e-4);
    float fall = clamp((NTOP - n) / (NTOP + 5.0), 0.0, 1.0);
    float tread = clamp(0.55 * (1.0 - st / EYE), 0.0, 0.55);
    float isTread = 1.0 - smoothstep(tread - w, tread + w, fr);
    float nose = smoothstep(0.86 - w, 0.86 + w, fr) + (1.0 - smoothstep(0.02, 0.02 + 2.0 * w, fr)) * 0.0;
    float u = (f.x - 0.5) / hw;
    float glade = exp(-u * u / 0.11) * (1.0 - 0.45 * fall) * (0.85 + 0.3 * n2);
    float riser = mix(0.46, 0.9, pow(fall, 0.55)) + 0.05 * n1 - 0.22 * glade * (1.0 - fall);
    float treadD = mix(0.1, 0.52, pow(fall, 0.8)) - 0.25 * glade + 0.06 * n2;
    float noseD = mix(0.0, 0.34, fall) - 0.2 * glade;
    d = mix(riser, treadD, isTread);
    d = mix(d, noseD, nose);
    glow = mix(mix(0.55, 0.12, pow(fall, 0.6)), 1.0, max(nose, isTread) * (1.0 - 0.55 * fall)) * (0.6 + 0.6 * glade);
  } else {
    // walls and the head of the stair well: a dark wash, warmed where the light grazes it
    float fall = clamp(toExit / 0.62, 0.0, 1.0);
    d = mix(0.5, 0.95, pow(fall, 0.5)) + 0.05 * n1;
    glow = (1.0 - pow(fall, 0.45)) * 0.85;
    // the handrail climbs the wall beside the steps: a line of light
    float sr = ax * 2.0 / ((HALFW - 0.1) * S1);
    float yr = SA - SB * sr + 0.92 * S1 * sr;
    float rail = (1.0 - smoothstep(0.0025, 0.0055, abs(f.y - yr))) * step(STOP, sr) * step(sr, 1.5);
    float rf = clamp((sr - STOP) / (1.3 - STOP), 0.0, 1.0);
    d = mix(d, mix(0.06, 0.6, rf), rail);
    glow = max(glow, rail * (1.0 - 0.6 * rf));
    // tiles: a few courses following the stairs
    float course = fract((f.y - (SA - SB * (ax * 2.0 / (HALFW * S1)))) / 0.085);
    d += 0.05 * (1.0 - smoothstep(0.0, 0.03, min(course, 1.0 - course))) * (1.0 - fall) * step(hw, ax) * step(f.y, YTOP + 0.3);
    // the jambs and lintel of the exit catch the most
    float frame = 1.0 - smoothstep(0.0, 0.012, toExit);
    d = mix(d, 0.36, frame * 0.8);
  }
  vec3 col = inkPaint(clamp(d, 0.0, 1.0)) * mix(vec3(1.0), GOLD * 1.7, clamp(glow, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;
// the open air: gold under the cloud, rain across it, the city beyond as pale strokes, drips off the lintel
const EXIT_FRAG = /* glsl */ `
const vec3 GOLD = vec3(${GOLD.map(f4).join(', ')});
const float YTOP = ${f4(ST.yTop)}, EXTOP = ${f4(ST.yc0 + ST.s1 * ST.sTop * (ST.hTop + ST.exitH - ST.hcam))};
void main() {
  vec2 f = vF, q = vec2(f.x * 2.0, f.y);
  float up = (f.y - YTOP) / (EXTOP - YTOP);
  vec3 col = GOLD * (2.3 - 0.9 * up + 0.25 * fbm(q * 5.0 + uTime * 0.04, 3));
  // far towers in the wet light: two pale planes
  for (int i = 0; i < 2; i++) {
    float fi = float(i), w = 0.022 + 0.014 * fi, c = floor(f.x / w + 3.7 * fi), h = hash12(vec2(c, fi + 2.0));
    float top = YTOP + 0.05 + (0.1 + 0.17 * h * h) * (1.0 - 0.3 * fi);
    float tw = step(0.35, hash12(vec2(c, fi + 5.0))) * (1.0 - smoothstep(top - 0.004, top, f.y));
    col = mix(col, col * mix(0.62, 0.78, fi), tw * 0.8);
  }
  float a = 0.0;
  for (int l = 0; l < 2; l++) {                                  // rain: slanted strokes, falling
    float fl = float(l), w = 0.006 + 0.003 * fl;
    float u = (q.x + 0.14 * q.y) / w, c = floor(u);
    float sp = 0.5 + 0.4 * hash11(c + fl * 31.0);
    float y = fract(f.y * (2.4 - 0.7 * fl) + uTime * sp * (2.6 - fl) + hash11(c * 1.7 + fl) * 7.0);
    a = max(a, step(hash11(c + 5.0 + fl), 0.34) * (1.0 - smoothstep(0.16, 0.3, y)) * (1.0 - smoothstep(0.12, 0.3, abs(fract(u) - 0.5))) * (0.5 - 0.15 * fl));
  }
  for (int i = 0; i < 7; i++) {                                   // drips off the lintel
    float fi = float(i), x = 0.345 + 0.05 * fi + 0.012 * hash11(fi + 3.0);
    float ph = fract(uTime * (0.55 + 0.25 * hash11(fi)) + hash11(fi + 9.0));
    float y = EXTOP - (EXTOP - YTOP) * ph * ph;
    a = max(a, (1.0 - smoothstep(0.0022, 0.0038, length(vec2((f.x - x) * 2.0, (f.y - y) * 0.45)))) * 0.75);
  }
  gl_FragColor = vec4(mix(col, col * 0.18, a), 1.0);
}`;

// ---- shared instanced things: rain strokes in the air, dust discs
const RAIN_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uAmount, uSlant;
uniform vec2 uArea;                    // world width, height of the sheet
varying vec2 vUv; varying float vA;
void main() {
  float sp = 0.9 + 0.5 * aSeed.z;
  float ph = fract(aSeed.y + uTime * sp * 1.15);
  float len = uArea.y * (0.05 + 0.05 * aSeed.w), wid = uArea.y * (0.0011 + 0.0009 * aSeed.w);
  vec2 c = vec2((aSeed.x - 0.5) * uArea.x * 1.3, (0.62 - ph * 1.24) * uArea.y);
  c.x += uSlant * c.y;
  vec2 dir = normalize(vec2(uSlant, 1.0));
  vec2 p = c + dir * (position.y * len) + vec2(dir.y, -dir.x) * (position.x * wid);
  vUv = uv; vA = step(aSeed.w * 0.999, uAmount);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}`;
const RAIN_FRAG = PAPER_GLSL + /* glsl */ `
uniform float uDensity;
varying vec2 vUv; varying float vA;
void main() {
  float a = vA * (1.0 - smoothstep(0.2, 0.5, abs(vUv.x - 0.5))) * smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  if (a < 0.02) discard;
  gl_FragColor = vec4(inkPaint(uDensity), a * 0.85);
}`;
function makeRain(count, seed) {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position')); geo.setAttribute('uv', quad.getAttribute('uv'));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = hashf(i, seed);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const uniforms = { tPaper: { value: null }, uTime: { value: 0 }, uAmount: { value: 0 }, uSlant: { value: 0.14 }, uArea: { value: new THREE.Vector2(1, 1) }, uDensity: { value: 0.5 } };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: 'rain', uniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false }));
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
function hashf(i, seed) { let x = (i * 0x9e3779b1 + seed * 0x85ebca6b) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

const DUST_VERT = /* glsl */ `
attribute vec4 aDisc;                  // centre x, y (frame), r = half-height of the 1 : 1.5 oval (frame widths), phase
attribute vec4 aKind;                  // 0 = dust, 1 = the grain that becomes the speck, 2 = over the sleeper; rgb = hue
uniform float uTime, uFade;
uniform vec4 uGrain;                   // the grain: x, y, radius, brightness
uniform vec2 uFrame;                   // world size of the frame at this depth
varying vec2 vUv; varying float vB; varying vec3 vCol; varying float vGlint;
void main() {
  vec2 c = aDisc.xy; float r = aDisc.z; float b;
  vGlint = 0.0;
  if (aKind.x > 0.5 && aKind.x < 1.5) { c = uGrain.xy; r = uGrain.z; b = uGrain.w; vGlint = uGrain.w * step(1.2, uGrain.w); }
  else {
    float tt = uTime - 40.0;
    c += vec2(0.0025 * sin(tt * 0.7 + aDisc.w * 40.0), -0.0035 * tt) * smoothstep(0.0, 0.6, tt);
    float fl = 0.32 + 0.68 * (0.5 + 0.5 * cos(6.2831853 * (aDisc.w + 0.22 * tt)));        // story.dustFlash
    float own = 0.55 + 0.45 * fract(aDisc.w * 13.7);                                      // some are brighter than others
    b = (aKind.x > 1.5 ? uFade * (1.0 - smoothstep(40.0, 40.6, uTime)) : uFade) * fl * own;
    // a few catch the lamp exactly as they turn: a sharp glint at the heart of the disc
    vGlint = step(0.72, fract(aDisc.w * 5.31)) * pow(max(0.0, cos(6.2831853 * (aDisc.w + 0.22 * tt))), 24.0) * uFade;
  }
  vUv = uv * 2.0 - 1.0; vB = b; vCol = aKind.yzw;
  vec2 p = (c - 0.5) * uFrame + position.xy * 2.0 * r * uFrame.x * vec2(1.0 / 1.5, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}`;
// Out-of-focus wing scales in lamplight. Two passes over the same ovals: a TINT (multiplied: the wall
// behind takes the thin-film hue at its own value, so the INK pass finds no edge to outline, only a
// wash of colour) and a GLOW (added: a breath of light, and on a few a sharp glint as they turn).
const DUST_TINT_FRAG = /* glsl */ `
varying vec2 vUv; varying float vB; varying vec3 vCol;
void main() {
  float r = length(vUv);
  float a = (1.0 - smoothstep(0.5, 1.0, r)) * (0.8 + 0.2 * smoothstep(0.3, 0.85, r)) * min(vB, 1.0);
  if (a < 0.004) discard;
  vec3 hue = vCol / max(dot(vCol, vec3(0.2126, 0.7152, 0.0722)), 0.04);
  gl_FragColor = vec4(mix(vec3(1.0), clamp(hue, 0.25, 5.0) * 1.12, a * 0.82), 1.0);
}`;
const DUST_GLOW_FRAG = /* glsl */ `
varying vec2 vUv; varying float vB; varying vec3 vCol; varying float vGlint;
void main() {
  float r = length(vUv);
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vB;
  float g = vGlint * (1.0 - smoothstep(0.0, 0.09, r));
  if (a + g < 0.004) discard;
  gl_FragColor = vec4(vCol * (0.26 * a) + (vCol * 2.0 + vec3(0.6)) * (5.0 * g), 1.0);
}`;

// ---------------------------------------------------------------------------------------- world
export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DESK.fov, ctx.aspect, 0.3, 60);
  const sets = { desk: new THREE.Group(), train: new THREE.Group(), stairs: new THREE.Group() };
  for (const g of Object.values(sets)) { g.visible = false; scene.add(g); }
  const timed = [];                                       // materials with uTime
  const add = (group, mesh) => { group.add(mesh); if (mesh.material?.uniforms?.uTime) timed.push(mesh.material.uniforms); return mesh; };
  const post = { ink: { pools: [], mist: 0 }, dof: null };

  // ================================================================== desk
  const deskU = { uDawn: { value: 0 }, uLamp: { value: 1 }, uFlat: { value: 0 } };
  add(sets.desk, paintLayer(DESK, { name: 'desk-room', frag: DESK_FRAG, uniforms: { ...deskU, uFront: { value: 0 } }, k: 1.03, rect: [-1.2, -1.2, 2.2, 2.2] }));
  add(sets.desk, paintLayer(DESK, { name: 'desk-front', frag: DESK_FRAG, uniforms: { ...deskU, uFront: { value: 1 } }, k: 0.99, rect: [0, S.DESK_EDGE_Y - 0.03, 1, S.DESK_EDGE_Y + 0.004], transparent: true, order: 2 }));
  const sleeper = createFigure({ seed: 'sleeper' });
  sleeper.mesh.position.copy(at(DESK, S.DESK_FRAME.feetX, S.DESK_EDGE_Y)).y -= S.DESK_FRAME.deskTop;
  sets.desk.add(sleeper.mesh);
  const windowU = { uDawn: deskU.uDawn };
  add(sets.desk, paintLayer(DESK, { name: 'desk-window', frag: WINDOW_FRAG, uniforms: windowU, k: GLASS, rect: [-0.8, -0.8, 1.8, 1.8], transparent: true, order: 3 }));
  const glowU = { uGlow: { value: new THREE.Vector3(0.38, 0.4, 0) }, uGlowCol: { value: new THREE.Vector3() } };
  const glow = add(sets.desk, paintLayer(DESK, { name: 'desk-glow', frag: GLOW_FRAG, uniforms: glowU, k: GLASS * 0.998, rect: [0, 0, 1, 1], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, order: 5 }));
  const deskGlassRain = add(sets.desk, paintLayer(DESK, { name: 'desk-glassrain', frag: GLASSRAIN_FRAG, uniforms: { uRain: { value: 0 }, uSlant: { value: 0.0 } }, k: GLASS * 0.997, rect: [0, 0, 1, 1], transparent: true, depthWrite: true, order: 6 }));   // on the pane: it racks with the glass
  const butterfly = createButterfly({ lod: 'hero', seed: 'hero' });
  butterfly.group.scale.setScalar(0.01);
  sets.desk.add(butterfly.group);
  // S08: the raindrop where the butterfly sat (it holds the night room, upside down)
  const deskDrop = createDrop({ radius: 1 });
  sets.desk.add(deskDrop.mesh);
  const deskRain = makeRain(260, 11);
  deskRain.mesh.position.z = -D * GLASS * 0.8;
  deskRain.uniforms.uArea.value.set(DESK.W * GLASS * 0.8, DESK.H * GLASS * 0.8);
  deskRain.mesh.renderOrder = 7;
  sets.desk.add(deskRain.mesh);
  // S04a: the scale dust (X2: story.dustDiscs) and the one grain that settles on the shoulder
  const discs = S.dustDiscs();
  const dustGeo = new THREE.InstancedBufferGeometry();
  { const quad = new THREE.PlaneGeometry(1, 1); dustGeo.index = quad.index; dustGeo.setAttribute('position', quad.getAttribute('position')); dustGeo.setAttribute('uv', quad.getAttribute('uv')); }
  // the disc nearest the left shoulder is THE grain: it draws into focus and comes to rest there at 41.0.
  // Discs that lie over the sleeper's body go out first (aKind.x = 2), so the speck is the only blue on him
  const inOutline = (x, y) => { let c = false; const P = S.SLEEPER_OUTLINE; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; };
  let grainI = 0, best = 1e9;
  discs.forEach((dsc, i) => { const dd = Math.hypot((dsc.x - S.SPECK.desk[0]) * 2, dsc.y - S.SPECK.desk[1]); if (dd < best) { best = dd; grainI = i; } });
  const grain0 = discs[grainI];
  const nd = discs.length, aDisc = new Float32Array(nd * 4), aKind = new Float32Array(nd * 4);
  const hueOf = (ph) => thinFilmRampJS(1.05 - 0.14 * Math.pow((ph * 7.31) % 1, 1.5));     // SCALE's hue for the same disc
  discs.forEach((dsc, i) => { aDisc.set([dsc.x, dsc.y, dsc.r, dsc.phase], i * 4); aKind.set([i === grainI ? 1 : inOutline(dsc.x, dsc.y) ? 2 : 0, ...hueOf(dsc.phase)], i * 4); });
  dustGeo.setAttribute('aDisc', new THREE.InstancedBufferAttribute(aDisc, 4));
  dustGeo.setAttribute('aKind', new THREE.InstancedBufferAttribute(aKind, 4));
  dustGeo.instanceCount = nd;
  const dustU = { uTime: { value: 0 }, uFade: { value: 0 }, uGrain: { value: new THREE.Vector4() }, uFrame: { value: new THREE.Vector2(DESK.W * 0.42, DESK.H * 0.42) } };
  const dust = new THREE.Group();
  for (const [frag, blend, order] of [[DUST_TINT_FRAG, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor }, 8], [DUST_GLOW_FRAG, { blending: THREE.AdditiveBlending }, 9]]) {
    const m = new THREE.Mesh(dustGeo, new THREE.ShaderMaterial({ name: 'dust', uniforms: dustU, vertexShader: DUST_VERT, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false, ...blend }));
    m.position.z = -D * 0.42; m.frustumCulled = false; m.renderOrder = order;
    dust.add(m);
  }
  sets.desk.add(dust);
  // the last frames of S02: the dark of the wing closes over the lens
  const blackout = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  blackout.renderOrder = 50; blackout.frustumCulled = false;
  sets.desk.add(blackout);

  // the butterfly on the glass: head up and a little to the left, rolled so that the shut wings show
  // their ink side and the open ones their blue
  const perchM = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0))
    .premultiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(33)))
    .premultiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(16)));
  const perchQ = new THREE.Quaternion().setFromRotationMatrix(perchM);
  const dorsal = new THREE.Vector3(0, 1, 0).applyQuaternion(perchQ);
  const keyDir = dorsal.clone().multiplyScalar(2 * dorsal.z).sub(new THREE.Vector3(0, 0, 1)).normalize();   // mirror of the view in the open wing
  const perchP = at(DESK, S.BUTTERFLY_ON_GLASS[0], S.BUTTERFLY_ON_GLASS[1], GLASS).addScaledVector(dorsal, -FEET_Y * 0.01);
  const flightP = (t, out) => {
    const u = clamp01((t - 17) / 3), e = 1 - Math.pow(1 - u, 2.2), ey = sstep(0, 1, u), w = Math.pow(1 - u, 1.3), tau = t - 17;
    const x = lerp(-0.07, S.BUTTERFLY_ON_GLASS[0], e) + w * (0.05 * Math.sin(TAU * 0.83 * tau + 0.4) + 0.022 * Math.sin(TAU * 2.3 * tau));
    const y = lerp(0.95, S.BUTTERFLY_ON_GLASS[1], ey) + w * (0.1 * Math.sin(TAU * 1.21 * tau + 1.1) + 0.035 * Math.sin(TAU * 3.1 * tau + 2));
    return at(DESK, x, y, lerp(GLASS * 0.86, GLASS, e), out).lerp(perchP, sstep(0.9, 1, u));
  };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const toFrame = (v, F) => { _c.copy(v).project(camera); return [0.5 + 0.5 * _c.x, 0.5 + 0.5 * _c.y]; };

  function updateDesk(t, shot, p) {
    const id = shot.id;
    sets.desk.visible = true; sets.train.visible = false; sets.stairs.visible = false;

    const dawn = id === 'S08' ? 1 : 0;
    const lamp = id === 'S08' ? 1 - sstep(88.0, 88.07, t) : 1;
    deskU.uDawn.value = dawn; deskU.uLamp.value = lamp; deskU.uFlat.value = sstep(88.0, 89.4, t);

    // ---- camera: locked; the last second of S02 dives at the wing
    camera.fov = DESK.fov; camera.near = 0.3; camera.far = 60;
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    post.dof = null; post.ink.pools = []; post.ink.wet = null; post.bloom = id === 'S08' ? 0.05 : 0.1;
    blackout.visible = false;

    // ---- the sleeper
    const b = S.breath(t);
    // one flat, matte mass of ink: no edge light, no lines inside (the INK pass gives it its wet edge)
    const st = { turn: 180, breath: b, speck: 0, nod: 0, slump: 0, pose: { asleepAtDesk: 1 }, headTurn: 0, rim: null, lines: null };
    if (id === 'S04a') st.speck = t >= S.SPECK.from ? 1 : 0;
    if (id === 'S02') {
      // asleep is not frozen: early on, alone in the frame, the head nestles once into the arm (the hump,
      // which the breath and the cuts share, does not move with it)
      const k = sstep(15.0, 15.4, t) * (1 - sstep(15.55, 16.5, t));
      st.nod = -4 * k + 1.2 * sstep(15.55, 16.5, t) * (1 - sstep(16.5, 18.5, t));
    }
    let rub = 0;
    if (id === 'S08') {
      // The first waking. The start happens ON SCREEN, in the frames after the white: head up and back
      // (four frames, too far, settling over ten), the shoulders jumping, the hands snatched in; a
      // flinch at each beep; a hand comes up to the face; then up onto the forearms on an inhale and
      // the one long exhale; after the lamp, breath, and the head turning to the rain.
      const T0 = 82.067;
      const snap = t < T0 ? 0 : 1.24 * sstep(T0, T0 + 0.134, t) - 0.24 * sstep(T0 + 0.134, T0 + 0.47, t);
      let flinch = 0;
      for (const tb of [82.5, 83.0, 83.5]) { const dt = t - tb; if (dt >= 0) flinch += Math.exp(-dt * 8) * Math.sin(dt * 30) * (tb > 83.4 ? 0.6 : 1); }
      const bleary = sstep(82.35, 83.3, t), rise = sstep(84.35, 85.5, t), sag = sstep(85.5, 87.4, t), after = sstep(87.4, 88.2, t);
      rub = sstep(83.2, 83.75, t) * (1 - sstep(84.45, 85.0, t));
      const seated = snap * 0.8 + 0.2 * rise + 0.03 * flinch;
      st.pose = { asleepAtDesk: 1 - seated, seated };
      const look = sstep(88.5, 89.5, t) * (1 - 0.5 * sstep(89.5, 90.0, t));
      st.nod = -34 * snap * (1 - 0.75 * bleary) * (1 - 0.8 * rise) - 5 * flinch + 17 * bleary * (1 - rise) + 7 * rub * (1 - rise) - 9 * rise * (1 - sag) + 14 * sag - 7 * look;
      st.headTurn = 26 * look;
      const quick = 0.5 + 0.5 * Math.sin((t - 82.3) * TAU / 1.25), slow = 0.5 - 0.5 * Math.cos((t - 87.4) * TAU / 3.4);
      st.breath = t < 84.35 ? clamp01(0.95 * snap * (1 - 0.6 * bleary) + 0.22 * quick * bleary + 0.22 * Math.abs(flinch))
        : lerp(lerp(0.3, 1, rise) * (1 - sag), 0.32 * slow, after);
      st.slump = 0.14 * bleary * (1 - rise) + 0.55 * sag;
      st.speck = 1;
      // the arms come with the start: the forearms slide back across the desk from under the head to lie in
      // front of the body (the pose's planted elbows), the hands forward and one over the other; they stay
      // there, and the near one rises from its elbow to the face for the rub
      st.reachL = null; st.reachR = null;
    }
    sleeper.set(st);
    if (rub > 0.001) {
      // the near hand to the face: the heel of the hand rubbing an eye, the elbow staying on the desk
      const J = sleeper.joints(), hx = -J.headC.x, hz = -J.headC.z;          // (turn 180: back to the figure's own axes)
      const w = 0.012 * Math.sin((t - 83.7) * TAU * 2.1) * sstep(83.7, 83.9, t) * (1 - sstep(84.3, 84.5, t));
      sleeper.set({ reachL: [hx + 0.09, J.headC.y - 0.04 + w, hz - 0.03, rub] });
    } else sleeper.set({ reachL: null, reachR: null });

    // ---- the butterfly (S02 only)
    const fly = id === 'S02' && t >= 17.0;
    butterfly.group.visible = fly;
    glow.visible = false;
    if (fly) {
      const landed = t >= S.SYNC.landing;
      let open, flap = null, amb = 0.05, key = 3.0;
      if (!landed) {
        flightP(t, butterfly.group.position);
        flightP(t + 0.02, _a).sub(flightP(t - 0.02, _b)).normalize();
        // head along the path and a little up; the back turned to us, so the blue flickers as it beats
        const head = _a.add(_b.set(0, 0.45, 0)).normalize();
        const back = _b.set(0.25, 0.35, 1).addScaledVector(head, -_b.dot(head)).normalize();
        _m.makeBasis(_c.crossVectors(back, head), back, head);
        _q.setFromRotationMatrix(_m).slerp(perchQ, sstep(19.6, 20.0, t));
        butterfly.group.quaternion.copy(_q);
        open = 0.62; flap = t * 5.3; amb = 0.22; key = 2.2;
      } else {
        butterfly.group.position.copy(perchP);
        butterfly.group.quaternion.copy(perchQ);
        // it shuts as it settles (ink); 22.4-24.0 it opens on the sleeper's inhale; then shuts on the exhale
        open = t < 22.4 ? 0.62 * (1 - sstep(20.0, 20.75, t)) : S.breath(t);
      }
      // the dark: in the last third of a second the light leaves the wing
      const dark = 1 - sstep(25.4, 25.82, t);
      butterfly.set({ open, flap, lightDir: keyDir.toArray(), lightColor: [key * dark, key * 0.93 * dark, key * 0.84 * dark], ambient: [amb * dark, amb * dark, amb * 1.1 * dark] });
      butterfly.update(t);

      // the push: straight at the wing that is turning dark (camera stays square-on)
      const push = clamp01((t - 25.0) / 0.97);
      if (push > 0) {
        // aim between the shutting wings, 1.5 cm above the back: the near wing covers that point
        const tip = _a.set(0, 1.5, 0.5).multiplyScalar(0.01).applyQuaternion(perchQ).add(perchP);
        const r = Math.pow(0.008, Math.pow(push, 1.15));         // remaining fraction of the distance
        camera.position.copy(tip).multiplyScalar(1 - r);
        camera.position.z = tip.z * (1 - r) + 0.004;
        camera.near = 0.01; camera.far = 40;
        blackout.visible = t > 25.8;
        blackout.material.opacity = sstep(25.82, 25.93, t);
        blackout.position.copy(camera.position); blackout.position.z -= 0.012; blackout.scale.setScalar(0.2);
      }
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);

      // the pool of blue: it follows the butterfly; widest (9% of the width) with the wings at 24.0
      const [px, py] = toFrame(butterfly.group.position);
      const mag = (D * GLASS) / Math.max(0.02, -(_c.copy(butterfly.group.position).applyMatrix4(camera.matrixWorldInverse).z));
      const closed = S.BUTTERFLY_POOL_R.closed, wide = S.BUTTERFLY_POOL_R.open;
      let r = !landed ? 0.026 : t < 22.4 ? lerp(0.026, 0.0, sstep(20.0, 20.8, t)) : t < 24 ? wide * S.breath(t) : closed + (wide - closed) * S.breath(t);
      r *= mag;
      if (r > 0.0005) post.ink.pools.push({ x: px, y: py, r, soft: r * (0.45 + 0.5 * sstep(25.0, 25.25, t)), amount: 1, chroma: 1, rim: 1 - sstep(24.9, 25.15, t) });
      const lightUp = landed ? open * open : 0.25;
      glow.visible = lightUp > 0.002;
      glowU.uGlow.value.set(S.BUTTERFLY_ON_GLASS[0] + (landed ? 0 : px - S.BUTTERFLY_ON_GLASS[0]), landed ? S.BUTTERFLY_ON_GLASS[1] : py, landed ? wide * 0.8 : 0.03);
      glowU.uGlowCol.value.set(...BLUE).multiplyScalar(0.3 * lightUp * dark * (1 - sstep(24.9, 25.2, t)));
      // the push: a free camera, so the wash edges must not crawl under it (LOOK: wet 0.3)
      post.ink.wet = lerp(1, 0.3, sstep(24.6, 25.0, t));
      // the butterfly brings depth of field with it: rack to the glass 20.0-21.5
      const ap = 1.05 * sstep(20.0, 21.5, t);
      if (ap > 0.001) post.dof = { focus: lerp(D, D * GLASS, sstep(20.0, 21.5, t)) * (push > 0 ? Math.max(0.03, (perchP.z - camera.position.z) / perchP.z) : 1), aperture: ap, maxBlur: 16 };
    } else { camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); }

    // ---- S04a: scale dust in the lamplight; one grain comes to rest on the left shoulder at 41.0
    dust.visible = id === 'S04a';
    if (dust.visible) {
      dustU.uTime.value = t;
      dustU.uFade.value = 1 - 0.8 * sstep(40.3, 43.6, t);
      const u = clamp01((t - 40.0) / 1.0), e = u * u * (3 - 2 * u);
      const gx = lerp(grain0.x, S.SPECK.desk[0], e) + 0.01 * Math.sin(u * 7.5) * (1 - u) * u, gy = lerp(grain0.y, S.SPECK.desk[1] + 0.0015, e);
      dustU.uGrain.value.set(gx, gy, lerp(grain0.r, 0.0008, Math.pow(u, 0.6)), t < S.SPECK.from ? lerp(S.dustFlash(grain0.phase, t), 1.7, sstep(0.0, 0.5, u)) : 0);
    }
    if (st.speck > 0 || (id === 'S04a' && t > 40.4)) {
      const [sx, sy] = st.speck > 0 ? toFrame(sleeper.speckWorld(camera, _a)) : [dustU.uGrain.value.x, dustU.uGrain.value.y];
      post.ink.pools.push({ x: sx, y: sy, r: S.SPECK.poolR * (st.speck > 0 ? 1 : sstep(40.4, 41, t)), soft: S.SPECK.poolR * 0.5, amount: 1, chroma: 1, rim: 0.6 });
    }

    // ---- S08: the drop on the glass where the butterfly sat; it runs at 85; rain from 88
    deskDrop.mesh.visible = id === 'S08';
    deskRain.mesh.visible = false; deskGlassRain.visible = false;
    if (id === 'S08') {
      const run = Math.max(0, t - 85.0);
      const fall = Math.min(0.05 * run * run + 0.012 * run, 0.75), dx = 0.006 * Math.sin(fall * 38) * sstep(0, 0.05, fall);
      const fx = S.BUTTERFLY_ON_GLASS[0] + dx, fy = S.BUTTERFLY_ON_GLASS[1] - fall;
      const rad = 0.019 * DESK.H * GLASS;
      at(DESK, fx, fy, GLASS, deskDrop.mesh.position);
      deskDrop.mesh.scale.set(rad, rad * (1.12 + 0.25 * sstep(0, 0.1, fall)), rad * 0.55);
      // a clear bead on the pane: the pale room turned over in it, a thin rim, one small light
      deskDrop.set({ portal: null, impression: 0, envTop: [0.42, 0.42, 0.42], envBottom: [1.05, 1.05, 1.05], fill: 0, lightDir: [-0.5, 0.6, 0.6], lightColor: [2.2, 2.2, 2.2], wobble: 0 });
      const rain = sstep(88.0, 89.6, t);
      deskRain.mesh.visible = rain > 0; deskRain.uniforms.uAmount.value = rain * 0.8; deskRain.uniforms.uTime.value = t; deskRain.uniforms.uDensity.value = 0.42;
      deskGlassRain.visible = rain > 0; deskGlassRain.material.uniforms.uRain.value = rain * 0.7;
    }
  }

  // ================================================================== train
  const trainU = { uTunnel: { value: 1 }, uShake: { value: 0 } };
  const ringU = { value: Array.from({ length: N_RINGS }, () => new THREE.Vector3()) };
  add(sets.train, paintLayer(TRAIN, { name: 'train-back', frag: TRAIN_BACK_FRAG, uniforms: { ...trainU, uRing: ringU }, k: 1.05, rect: [-0.4, -0.3, 1.4, 1.3] }));
  // S14 only: the car's own body round the window we look through (S11 is inside the car)
  const trainBody = add(sets.train, paintLayer(TRAIN, { name: 'train-body', frag: TRAIN_BODY_FRAG, uniforms: trainU, k: 0.965, rect: [-0.4, -0.4, 1.4, 1.5], transparent: true, order: 3 }));
  // the seven: who they are (the hero is index 4, third from the right), how they stand
  const SEVEN_DEF = [
    { height: 1.0, build: 1.08, coat: 0.3, hair: 0, bag: 2, collar: 0, turn: 160, slump: 0.2, nod: 0 },
    { height: 0.95, build: 0.9, coat: 0.2, hair: 1, bag: 0, collar: 0, turn: 152, slump: 0.1, nod: 8, armL: [30, 4, 24, 118] },    // reading a phone
    { height: 1.06, build: 1.0, coat: 0.42, hair: 0, bag: 1, collar: 1, turn: 171, slump: 0.3, nod: -4 },                          // collar up
    { height: 0.97, build: 0.92, coat: 0.12, hair: 2, bag: 3, collar: 0, turn: 156, slump: 0.1, nod: 4 },
    { hero: true, turn: 166, slump: 0.1, nod: -6 },
    { height: 1.035, build: 1.12, coat: 0.3, hair: 0, bag: 2, collar: 0.6, turn: 150, slump: 0.2, nod: 6, armL: [26, 4, 20, 112] },
    { height: 0.975, build: 0.9, coat: 0.2, hair: 3, bag: 0, collar: 0, turn: 160, slump: 0.15, nod: 0 },
  ];
  const seven = SEVEN_DEF.map((d, i) => {
    const f = d.hero ? createFigure({ seed: 'hero' }) : createFigure({ seed: `strap-${i}`, height: d.height, build: d.build, coat: d.coat, hair: d.hair, bag: d.bag, collar: d.collar });
    sets.train.add(f.mesh);
    return f;
  });
  // their reflections in the floor: the same figures turned over and drawn short (S11)
  const FLOOR_Y = S.SEVEN.railY - RING_H / TRAIN.H;       // frame y of the floor under their feet
  const sevenWet = SEVEN_DEF.map((d, i) => {
    const f = d.hero ? createFigure({ seed: 'hero' }) : createFigure({ seed: `strap-${i}`, height: d.height, build: d.build, coat: d.coat, hair: d.hair, bag: d.bag, collar: d.collar });
    f.mesh.scale.set(1, -0.56, 1);
    sets.train.add(f.mesh);
    return f;
  });
  // on the far bench, behind the seven: people asleep sitting up (paler: a plane further back)
  const BENCH = [[0.155, 'b0', 6, 12], [0.255, 'b1', -9, 20], [0.452, 'b2', 14, 8], [0.555, 'b3', -5, 16], [0.745, 'b4', -12, 22], [0.862, 'b5', 8, 6]];
  const bench = BENCH.map(([x, seed, roll, nod], i) => {
    const f = createFigure({ seed: `bench-${seed}`, bag: 0 });
    at(TRAIN, x, FLOOR_Y + 0.004, 1.03, f.mesh.position);
    sets.train.add(f.mesh);
    return { f, roll, nod, i };
  });
  const trainGlassRain = add(sets.train, paintLayer(TRAIN, { name: 'train-glassrain', frag: GLASSRAIN_FRAG, uniforms: { uRain: { value: 0 }, uSlant: { value: 0.55 } }, k: 0.3, rect: [-0.3, -0.3, 1.3, 1.3], transparent: true, depthWrite: true, order: 6 }));   // on the pane: it racks with the glass
  const trainDrop = createDrop({ radius: 1 });
  sets.train.add(trainDrop.mesh);
  const trainRain = makeRain(110, 23);
  trainRain.mesh.position.z = -D * 0.6; trainRain.mesh.renderOrder = 7;
  trainRain.mesh.layers.set(FX_LAYER);                    // rain in the air stays a crisp stroke through the rack focus
  trainRain.uniforms.uArea.value.set(TRAIN.W * 0.6 * 1.2, TRAIN.H * 0.6 * 1.2); trainRain.uniforms.uSlant.value = 0.6;
  sets.train.add(trainRain.mesh);

  /** The hero's falling asleep on their feet, 109-113: sinking, a start, sinking deeper. 0..1 */
  const nodOff = (t) => {
    const a = 0.58 * sstep(109.0, 110.7, t), jerk = 0.36 * sstep(110.78, 110.98, t) * (1 - sstep(111.3, 112.9, t));
    return clamp01(a - jerk + 0.42 * sstep(111.2, 113.0, t));
  };
  function updateTrain(t, shot, p) {
    const s14 = shot.id === 'S14';
    let portal = null;
    if (s14) portal = ctx.engine.portal('S20', p.portal?.t ?? 180.0, { scale: 0.5 });
    sets.desk.visible = false; sets.train.visible = true; sets.stairs.visible = false;

    const tunnel = s14 ? 1 - sstep(132.0, 132.6, t) : 1;
    trainU.uTunnel.value = tunnel;
    // the rail joint at 129.0: the whole car kicks
    const jt = t - S.SYNC.railJoint;
    const kick = s14 && jt >= 0 ? Math.exp(-jt * 7) * Math.sin(jt * 46) : 0;
    trainU.uShake.value = 0.0045 * kick;

    // camera: S11 the whole band; S14 closer, trucked so the hero's ring sits at TRAIN14.ring
    const heroRing = at(TRAIN, S.SEVEN.x[S.SEVEN.hero], S.SEVEN.railY);
    if (s14) {
      const H = TRAIN14.H;
      camera.fov = (2 * Math.atan(H / 2 / D) * 180) / Math.PI;
      camera.position.set(heroRing.x - (TRAIN14.ring[0] - 0.5) * 2 * H, heroRing.y - (TRAIN14.ring[1] - 0.5) * H, 0);
    } else { camera.fov = TRAIN.fov; camera.position.set(0, 0, 0); }
    camera.near = 0.3; camera.far = 60; camera.rotation.set(0, 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    post.dof = null; post.ink.pools = []; post.ink.wet = null; post.bloom = 0.05;
    trainBody.visible = s14;

    // rings: one at every hanging point (held) and free ones between and beyond
    for (let k = 0; k < N_RINGS; k++) {
      const i = (k - 6) * 0.5, held = Number.isInteger(i) && i >= 0 && i <= 6;
      ringU.value[k].set(0.2 + 0.1 * i, held ? 0 : THREE.MathUtils.degToRad(2.3 * S.sway(t - 0.12, i) + 9 * kick), held ? 1 : 0);
    }
    // the seven: standing, their feet planted on the floor for the whole shot. Each sways a little from the
    // ankles (the shared travelling wave at a third: about 1 degree, 2-3 cm at the shoulder; at 113.5 all lean
    // 3 degrees together as the train brakes, and recover), the head lagging; the hand holds its
    // ring, which swings a little on its own strap, and the arm is solved between the shoulder and the ring
    seven.forEach((f, i) => {
      const d = SEVEN_DEF[i];
      const sw = S.sway(t, i), wave = 3.0 * Math.sin((TAU * (t - 0.25 * i)) / 2.0), brake = sw - wave;   // (story.sway = wave + brake)
      const lag = S.sway(t - 0.28, i) - S.sway(t, i);                      // the head follows the body late
      // nobody is frozen: each breathes at their own pace
      const br = 0.5 - 0.5 * Math.cos((t + 1.7 * i) * TAU / (3.3 + 0.35 * ((i * 3) % 4)));
      const st = { turn: d.turn, lean: 0.35 * wave + 0.5 * brake, planted: true, twist: 0, slump: d.slump, breath: br, nod: d.nod + 0.9 * lag + 1.5 * Math.sin((t + i) * TAU / 4.7), headTurn: 0, speck: 0, armL: d.armL || null, phone: !!d.armL, grip: [-0.13, RING_H, 0.1], pose: { strapHang: 1 },
        lines: null, rim: null };
      if (d.hero) {
        let n;
        if (!s14) n = nodOff(t);
        else n = 1 - (1.16 * sstep(129.0, 129.13, t) - 0.16 * sstep(129.13, 129.5, t));      // 129.0: the second waking
        st.pose = { strapHang: 1 - n, strapNod: n };
        st.nod = (s14 ? -8 * sstep(129.0, 129.13, t) * (1 - sstep(129.4, 130.6, t)) - 5 * sstep(131, 132.5, t) : 0) + 0.9 * lag;
        st.slump = d.slump + 0.3 * n;
        st.headTurn = s14 ? 48 * sstep(131.0, 132.3, t) : 0;                 // to the window: toward us,
        st.twist = s14 ? 30 * sstep(131.3, 132.6, t) : 0;                    // and the shoulders after the head (the feet stay)
        st.speck = 1;
      } else if (s14) st.nod += 5 * kick;
      // the feet: planted under the ring as it hangs at rest (the grip's rest offset turned like the body)
      const tr = THREE.MathUtils.degToRad(d.turn), ct = Math.cos(tr), stt = Math.sin(tr);
      const rest = at(TRAIN, S.SEVEN.x[i], S.SEVEN.railY + trainU.uShake.value, 1, _a);
      f.mesh.position.set(rest.x - (-0.13 * ct + 0.1 * stt), rest.y - RING_H, -D + 0.02 * (i % 3) - (d.hero ? -0.05 : 0));
      // the held ring swings a little on its strap (a small lag behind the body; the rail joint at 129 kicks it)
      const ra = THREE.MathUtils.degToRad(0.7 * S.sway(t - 0.12, i) + (s14 ? 5 * kick : 0));
      const gx = S.SEVEN.x[i] + 0.5 * 0.03 * Math.sin(ra), gy = S.SEVEN.railY + 0.03 - 0.03 * Math.cos(ra) + trainU.uShake.value;
      const g = at(TRAIN, gx, gy, 1, _b), dx = g.x - f.mesh.position.x, dy = g.y - f.mesh.position.y;
      st.grip = [(dx - 0.1 * stt) / ct, dy, 0.1];                           // (the figure's own axes, before its turn)
      f.set(st);
      ringU.value[6 + 2 * i].set(S.SEVEN.x[i], ra, 1);
      // the reflection: the same body, turned over about the floor line
      const wet = sevenWet[i];
      wet.mesh.visible = !s14;
      if (!s14) {
        wet.set({ ...st, speck: 0, lines: null, rim: null, opacity: 0.42, soft: 0.025, color: inkPaintJS(0.9) });
        const floorY = (FLOOR_Y - 0.5) * TRAIN.H;
        wet.mesh.position.set(f.mesh.position.x, floorY - (f.mesh.position.y - floorY) * 0.56, f.mesh.position.z + 0.01);
      }
    });
    // the sleepers on the bench: breath, and heads that loll with the car
    for (const b of bench) {
      const br = 0.5 - 0.5 * Math.cos((t + 1.3 * b.i) * TAU / (3.6 + 0.3 * (b.i % 3)));
      const sw = S.sway(t - 0.2, b.i + 0.5);
      // (dozing with the head down but still above the shoulders, so each reads as a head on a neck, not a mound)
      b.f.set({ pose: { sit: 1 }, turn: -90 + 6 * (b.i % 2 ? 1 : -1), breath: br, nod: -20 + 0.5 * b.nod + 1.2 * sw + (s14 ? 6 * kick : 0), slump: 0.15,
        color: inkPaintJS(0.8), lines: null });
      b.f.mesh.position.y = (FLOOR_Y + 0.004 + trainU.uShake.value - 0.5) * TRAIN.H * 1.03;
    }
    const hero = seven[S.SEVEN.hero];
    const [sx, sy] = toFrame(hero.speckWorld(camera, _a));
    post.ink.pools.push({ x: sx, y: sy, r: S.SPECK.poolR, soft: S.SPECK.poolR * 0.5, amount: 1, chroma: 1, rim: 0.6 });

    // S14: the glass in front; rain across it once the tunnel is behind; the drop that holds the meadow
    trainDrop.mesh.visible = false; trainGlassRain.visible = false; trainRain.mesh.visible = false;
    if (s14) {
      const rain = sstep(132.1, 133.2, t);
      const kG = 0.3;
      trainGlassRain.visible = rain > 0; trainGlassRain.material.uniforms.uRain.value = rain;
      trainGlassRain.position.set(camera.position.x, camera.position.y, -D * kG);      // the pane rides with the lens
      trainGlassRain.scale.setScalar(TRAIN14.H / TRAIN.H);
      trainRain.mesh.visible = rain > 0; trainRain.uniforms.uAmount.value = rain * 0.8; trainRain.uniforms.uTime.value = t; trainRain.uniforms.uDensity.value = 0.3;
      trainRain.mesh.position.set(camera.position.x, camera.position.y, -D * 0.6);
      // the drop: lands 132.25, sits at (55%, 50%), lets go at 136.0 and runs down the pane with the wind
      const land = sstep(132.25, 132.42, t);
      if (land > 0) {
        const run = Math.max(0, t - 136.0), fall = 0.16 * run * run + 0.02 * run;
        const fx = 0.55 + 0.42 * fall + 0.004 * Math.sin(fall * 30), fy = 0.5 - fall;
        const H = TRAIN14.H, rad = 0.046 * H * kG * (0.6 + 0.4 * land);
        trainDrop.mesh.visible = true;
        trainDrop.mesh.position.set(camera.position.x + (fx - 0.5) * 2 * H * kG, camera.position.y + (fy - 0.5) * H * kG, -D * kG);
        trainDrop.mesh.scale.set(rad, rad * (1.1 + 0.3 * sstep(0, 0.08, fall)), rad * 0.6);
        trainDrop.set({ portal, fill: 0, lightDir: [-0.3, 0.8, 0.5], wobble: 0 });
        post.ink.pools.push({ x: fx, y: fy, r: 0.046 * 0.5 * 1.15, soft: 0.004, amount: 1, chroma: 1, rim: 0.5 });
      }
      // shallow focus has arrived in the ink world: on the hero, then a rack to the drop, 133-134
      post.dof = { focus: lerp(D, D * kG, sstep(133.0, 134.0, t)), aperture: 0.9, maxBlur: 14 };
    }
  }

  // ================================================================== stairs
  const exHalf = (ST.halfW * ST.s1 * ST.sTop) / 2, exTop = ST.yc0 + ST.s1 * ST.sTop * (ST.hTop + ST.exitH - ST.hcam);
  add(sets.stairs, paintLayer(STAIRS, { name: 'stairs', frag: STAIRS_FRAG, uniforms: { uMask: { value: 0 } }, k: 1.03, rect: [-0.1, -0.1, 1.1, 1.1] }));
  add(sets.stairs, paintLayer(STAIRS, { name: 'stairs-exit', frag: EXIT_FRAG, k: 1.06, rect: [0.5 - exHalf - 0.03, ST.yTop - 0.05, 0.5 + exHalf + 0.03, exTop + 0.03] }));
  // the head of the flight again, in front of those who have walked on across the landing (they
  // sink behind its edge) and behind those still on the steps
  const stairsMask = add(sets.stairs, paintLayer(STAIRS, { name: 'stairs-mask', frag: STAIRS_FRAG, uniforms: { uMask: { value: 1 } }, k: 1, rect: [0.12, ST.yTop - 0.09, 0.88, exTop + 0.06] }));
  stairsMask.position.z = -D + 0.035;
  // The climbers: [lane X (m), step at 144.0, seed, umbrella index]. Two steps a second, in step.
  // The four with umbrellas reach the landing 0.45 s before their beat: 148, 149, 150 and the hero 151.
  const openers = S.S16_UMBRELLA.opens, RATE = 2;
  const n0For = (open) => ST.nTop - RATE * (open - 0.5 - 144);
  const CLIMBERS = [
    [-2.3, n0For(openers[0]), 'u0', 0], [2.2, n0For(openers[1]), 'u1', 1], [-1.15, n0For(openers[2]), 'u2', 2], [0.0, n0For(openers[3]), 'hero', 3],
    [3.0, -1.4, 'c0', -1], [-3.1, -2.7, 'c1', -1], [1.3, -4.1, 'c2', -1], [-1.1, -5.8, 'c3', -1], [2.9, -7.2, 'c4', -1],
  ];
  const climbers = CLIMBERS.map(([X, n0, seed, opener], i) => {
    const f = createFigure({ seed: seed === 'hero' ? 'hero' : `stairs-${seed}` });
    sets.stairs.add(f.mesh);
    let umb = null;
    if (opener >= 0) {
      // its umbrella is one FLOCK instance at morph 0 (X8: what CITY's crossing is made of), turned to face the lens
      umb = createFlock({ count: 1, seed: `s16-umbrella-${opener}`, positions: new Float32Array(2), velocities: new Float32Array([0, 1e-3]), openAt: new Float32Array([openers[opener]]) });
      umb.mesh.rotation.x = Math.PI / 2;
      umb.set({ morphWave: null, clear: 0, lean: 0, sheen: 0, minPx: 0, sunColor: [0, 0, 0], ambient: [0, 0, 0] });
      sets.stairs.add(umb.mesh);
    }
    return { f, X, n0, i, opener, umb, slump: 0.25 + 0.35 * hashf(i, 3) };
  });

  function updateStairs(t, shot, p) {
    sets.desk.visible = false; sets.train.visible = false; sets.stairs.visible = true;
    camera.fov = STAIRS.fov; camera.near = 0.3; camera.far = 60;
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    post.dof = null; post.ink.pools = []; post.ink.wet = null; post.bloom = 0.13;
    // matte ink silhouettes against the gold: no edge light, no lines inside
    const zTop = ST.z1 + ST.going * ST.nTop;
    for (const c of climbers) {
      const { f } = c;
      const n = c.n0 + RATE * (t - 144), tArr = 144 + (ST.nTop - c.n0) / RATE;
      let fx, fy, sc, pose, phase, turn = 90, behind = false, breath = 0, raise = 0;
      if (t < tArr || c.opener < 0) {
        // on the flight, in their own lane (X is constant). The climb cycle moves the body up and on over the
        // stance foot and the host steps the mesh one tread per half cycle; seen through this lens the body's
        // own progress must also carry its depth (its size and place in the picture), so the mesh is placed at
        // the body's continuous progress k + e along the flight and lowered by the rise the pose already adds:
        // nothing jumps when a step completes
        const k = Math.floor(n), e = sstep(0.1, 0.95, n - k);
        [fx, fy, sc] = stairXY(k + e, c.X, -ST.rise * e);
        pose = { climb: 1 }; phase = n / 2;
      } else {
        // the last step up onto the landing, a breath, the umbrella; then (not the hero) on across it, turning
        // smoothly from the climb into a walk toward where they are going
        const open = openers[c.opener], up = sstep(tArr, tArr + 0.42, t);
        const away = c.opener === 3 ? 0 : Math.max(0, t - open - 0.55), dir = c.opener === 1 ? 1 : -1;
        const go = c.opener === 3 ? 0 : sstep(open + 0.45, open + 0.95, t);
        const z = zTop + 1.25 * away, X = c.X + dir * 0.7 * away;
        [fx, fy, sc] = landXY(z, X);
        pose = { climb: (1 - up) * (1 - go), upright: up * (1 - go), walk: go };
        phase = go > 0 ? away * 0.95 : ST.nTop / 2;
        turn = 90 - dir * 29.25 * go;                                    // facing the way they walk (0.7 m/s across, 1.25 m/s on)
        behind = away > 0.25; breath = 0.5 - 0.5 * Math.cos((t - tArr) * TAU / 2.6);
        // the umbrella: a line at the shoulder, then (5 frames) a disc before the body, carried off over the shoulder
        const [ux, uy] = c.opener === 3 ? S.S16_UMBRELLA.hero : landXY(z, X, 1.42);
        at(STAIRS, ux, uy, 1, _b);
        raise = sstep(tArr, tArr + 0.36, t);
      }
      f.set({ pose, phase, turn, slump: c.slump, breath, speck: c.opener === 3 ? 1 : 0,
        rim: null, lines: null });
      at(STAIRS, fx, fy, 1, f.mesh.position);
      f.mesh.position.z = behind ? -D + 0.02 : -D + 0.06 + 0.05 * sc;
      f.mesh.scale.setScalar(sc);
      f.mesh.visible = fy > -0.5;
      if (c.umb) {
        // carried furled in the hand while climbing (FLOCK draws the closed umbrella as a line hanging from
        // it); on the landing it is brought up before the body, and there it opens: a disc in 5 frames
        const h = f.joints().handR;
        const hx = f.mesh.position.x + sc * h.x, hy = f.mesh.position.y + sc * h.y;
        c.umb.mesh.visible = f.mesh.visible;
        c.umb.mesh.scale.setScalar(sc);
        c.umb.mesh.position.set(lerp(hx, _b.x, raise), lerp(hy, _b.y, raise), -D + (behind ? 0.015 : 0.03 + 0.05 * sc) - 1.9 * sc);
        c.umb.update(t);
      }
    }
    const hero = climbers[3];
    const [sx, sy] = toFrame(hero.f.speckWorld(camera, _a));
    post.ink.pools.push({ x: sx, y: sy, r: S.SPECK.poolR, soft: S.SPECK.poolR * 0.5, amount: 1, chroma: 1, rim: 0.5 });
  }

  // ================================================================== figures (a test sheet, not in the film)
  // params.set = 'figures': the walk cycle with its cast shadow, seen from above at an angle, on paper
  let sheet = null;
  function updateFigures(t) {
    if (!sheet) {
      sheet = new THREE.Group(); scene.add(sheet);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.78, 0.74) }));
      ground.rotation.x = -Math.PI / 2; sheet.add(ground);
      sheet.userData.figs = [];
      for (let i = 0; i < 8; i++) {
        const f = createFigure({ seed: i === 0 ? 'hero' : `sheet-${i}` }), sh = createFigure({ seed: i === 0 ? 'hero' : `sheet-${i}` });
        f.mesh.position.set(-5.6 + i * 1.6, 0, 0); sh.mesh.position.copy(f.mesh.position);
        sheet.add(f.mesh, sh.mesh); sheet.userData.figs.push([f, sh]);
      }
    }
    for (const g of Object.values(sets)) g.visible = false;
    sheet.visible = true;
    camera.fov = 30; camera.near = 0.3; camera.far = 100; camera.position.set(0, 7, 12); camera.lookAt(0, 0.6, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    post.dof = null; post.ink.pools = []; post.ink.wet = null; post.bloom = 0.03;
    sheet.userData.figs.forEach(([f, sh], i) => {
      const st = { pose: i === 6 ? { topDown: 1 } : i === 7 ? { climb: 1 } : { walk: 1 }, phase: t * 0.9 + i * 0.125, turn: i === 5 ? 90 : 0, umbrella: i === 3 ? 1 : 0, umbrellaTilt: 20, speck: i === 0 ? 1 : 0, slump: 0.3 };
      f.set(st);
      sh.set({ ...st, pose: { shadow: 1 }, shadowLength: 3, shadowDir: -40, opacity: 0.6, soft: 0.02, speck: 0 });
    });
  }

  // ================================================================== the world
  return {
    scene, camera,
    post: () => ({ vignette: 0, chromaticAberration: 0, halation: 0, bloom: post.bloom, dof: post.dof, ink: post.ink.wet == null ? { pools: post.ink.pools, mist: 0 } : { pools: post.ink.pools, mist: 0, wet: post.ink.wet } }),
    update(t, localT, shot, p) {
      const set = p.set || 'desk';
      if (sheet) sheet.visible = false;
      if (set === 'figures') updateFigures(t);
      else if (set === 'desk') updateDesk(t, shot, p);       // (takes its portal first: it re-enters this world)
      else if (set === 'train') updateTrain(t, shot, p);
      else updateStairs(t, shot, p);
      for (const u of timed) u.uTime.value = t;
    },
    dispose() {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
      sleeper.dispose(); butterfly.dispose(); deskDrop.dispose(); trainDrop.dispose();
      for (const f of seven) f.dispose(); for (const c of climbers) { c.f.dispose(); c.umb?.dispose(); }
    },
  };
}
