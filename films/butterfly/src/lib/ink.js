// INK — the ink-wash pass (SCRIPT.md 7.1): turns the graded frame into ink on xuan paper.
// Owner: Group A (LOOK). The interface below is the contract with src/post.js and the worlds.
//
// WHERE IT RUNS (src/post.js): per shot, after bloom + grade, before the dissolve / SHEEN mix, the
// 'picture' title cards, grain and letterbox. Title cards with `layer: 'paper'` are soaked into the
// sheet BEFORE this pass (lookSource), so they take the paper's fibre and wet edge. Portals
// (engine.portal) run it too: a portal is the shot as graded and inked, without cards/grain.
//
// THE MODEL. The pass does not filter the picture; it repaints it. Every source pixel is read as a
// transparent layer over paper (its colour relative to the bare sheet) and split into
//   ink    a density d, measured on the palette's own curve: 0 = bare paper, the five tones at
//          清 .12  淡 .30  重 .55  浓 .78  焦 .95 (so a pixel painted in a palette tone IS that tone,
//          and anything at or above paper is bare paper), and
//   wash   the hue that is left when the value is taken out (chroma decides how much of it stays).
// The ink is then handled the way ink is: pulled to the five tones through soft, fibre-perturbed
// steps with a faint tide line at each (layered washes, not a posterised gradient); a darker wet
// rim on the dense side of every edge and a pale bloom on the paper side (both from the difference
// between the sharp density and a 6 px blur of it); thin dark things kept as brush line; distance
// diluted to bare paper; edges wobbled and feathered along the fibre field, wetter with depth;
// granulation in the tooth, more in thin washes, none in 焦; long fibres that drink a little more;
// thin ink broken against the tooth (dry); an ink contour on depth edges of near things. Finally
// the sheet is put back together: paper (colour, cloud mottle, relief under a raking light) x wash
// x ink. With amount -> 0 every step vanishes and the pass is the identity.
//
// THE PARAMETER BLOCK — post.ink (DEFAULT_POST.ink = null = off). Every field is keyframable like any
// post param (pools element by element); worlds may return it from world.post. Merged KEY BY KEY:
// LOOK < world.post < shot.post. During a dissolve the two shots' blocks are interpolated (mixInk)
// and both layers use the result; during a SHEEN each layer keeps its own (the band is the change).
//   amount       0..1  how much of the image is ink (0 = untouched: an EXACT passthrough)
//   chroma       0..1  how much of the frame's colour survives as a wash under the ink
//   mist         0..1  distant depth dilutes to bare paper (needs the scene depth buffer)
//   mistRange    [near, far] view depth in world units over which mist, bleed and line ramp;
//                default [0.05, 0.6] x camera.far
//   paperScroll  [x, y] paper offset in frame widths (y up). Follow your scroll so the image does
//                not swim under its own texture (SCRIPT.md 7.1, stability rules)
//   scrollDepth  view depth (world units) of the plane the paper is anchored to in a parallax
//                scroll (the plane that moves exactly with paperScroll; usually your nearest).
//                Planes at other depths slide over the sheet; with scrollDepth set, the hand's
//                wobble on each of them is carried at its own speed, so no edge swims. Default
//                null: everything is taken to move with the paper (locked frames, flat scrolls)
//   paper        [r, g, b] display colour of bare paper (default PALETTE.paper #EFE8DA)
//   wet          0..2  (1) bleed, bloom and edge wobble. Free cameras: ~0.4 (edges must not crawl)
//   line         0..1  (1) the drawing: an ink contour on depth edges of near things, and over colour
//                the dark side of crisp edges and thin dark things as brush line. Full strength from
//                amount 0.3 up; never on anything out of focus (the shot's dof) or smeared.
//   lineWidth    0.5..3 (1) breadth of that line (1 = 0.7 to 2 px with the hand's pressure). The merged
//                look of S19 to S22 uses about 1.8 (shots/_shot.js MERGED_INK)
//   dry          0..1  (0.3) how readily thin ink breaks against the tooth of the paper
//   rake         0..1  (0.3) raking light on the paper's relief; rakeAngle (degrees, 144 = from the
//                upper left) is where it comes from
//   pools        up to 4 (MAX_POOLS) screen-space regions with their own knobs:
//                { x, y, r, soft, amount, chroma, rim }
//                x, y   centre in frame coordinates (0..1 across, 0..1 UP)
//                r      radius in frame widths; soft = edge width in frame widths (default 0.35 r)
//                amount, chroma  the knobs inside (default: the block's own values)
//                rim    0..1 strength of the wet rim at the edge (default 1)
//                Later pools win where they overlap. The edge is wobbled by the paper's fibres.
//
// INTERFACE (used by post.js)
//   INK_DEFAULTS, MAX_POOLS, PAPER_TILE
//   normalizeInk(ink) -> canonical block (all fields filled, <= 4 pools) or null
//   inkActive(n)      -> true when the pass changes any pixel
//   mixInk(a, b, k)   -> interpolated canonical block (either may be null)
//   inkUniforms()     -> uniforms to spread into the look-pass material
//   setInkUniforms(u, n, { renderer, near, far }) -> write them (creates the paper texture once)
//   getPaperTexture(renderer) -> the static paper texture (also for worlds/paper.js)
//   INK_GLSL          -> chunk; expects, declared BEFORE it:
//                          vec4 lookSource(vec2 uv)  graded display RGB (cards soaked in);
//                                                    .a = linear view depth, 65000.0 = nothing drawn
//                          vec4 lookCard(vec2 uv)    r ink of soaked cards, g resist, (b, a free)
//                          uniform vec2 uRes; uniform float uPicFrac; uniform float uRefScale;
//                        and defines vec3 inkApply(vec2 uv, vec3 base) (returns `base` exactly where
//                        the effective amount is 0), vec2 paperCoord(vec2 uv), float inkFar(float).
//                        tInkBlur (in inkUniforms) must hold the blurred frame: rgb = display colour,
//                        a = mist factor (post.js makes it: two half-res passes).
//   PAPER_GLSL        -> paper + tone functions without the pass (for worlds: paperSample,
//                        paperMottle, inkDensity, inkDensityOf, inkValueOf, inkQuantise, inkTone)
//   DRYBRUSH_GLSL     -> float dryBrush(vec2 st, float load, float seed): dry-brush coverage in
//                        stroke space for tagged strokes (rain, zebra bands, streaks, the blade)
//   Paper lives in paper space (frame widths, scrolled) and is static: nothing is re-seeded per frame.

import * as THREE from 'three';
import { HASH } from './glsl/noise.js';
import { PALETTE, INK_TONES, rgb, linear } from './story.js';

export const MAX_POOLS = 4;
/** Frame widths covered by one tile of the paper texture (2048 texels: ~1 texel per pixel at 4320 wide). */
export const PAPER_TILE = 0.5;
const PAPER_SIZE = 2048;
const PAPER = rgb(PALETTE.paper);

export const INK_DEFAULTS = Object.freeze({
  amount: 0, chroma: 1, mist: 0, mistRange: null, paperScroll: [0, 0], paper: PAPER, pools: [],
  wet: 1, line: 1, lineWidth: 1, dry: 0.3, rake: 0.3, rakeAngle: 144, scrollDepth: null,
});

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec = (v, d) => (Array.isArray(v) && v.length >= d.length ? v.map(Number) : d);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
let warnedPools = false;

/** Fill defaults, clamp, cap the pools. Returns null for a missing block. */
export function normalizeInk(ink) {
  if (!ink || typeof ink !== 'object') return null;
  const amount = clamp(num(ink.amount, 0), 0, 1);
  const chroma = Math.max(0, num(ink.chroma, 1));
  const pools = Array.isArray(ink.pools) ? ink.pools.filter((p) => p && typeof p === 'object') : [];
  if (pools.length > MAX_POOLS && !warnedPools) { warnedPools = true; console.warn(`[ink] ${pools.length} pools given; only the first ${MAX_POOLS} are used`); }
  return {
    amount, chroma,
    mist: clamp(num(ink.mist, 0), 0, 1),
    mistRange: Array.isArray(ink.mistRange) ? [Number(ink.mistRange[0]), Number(ink.mistRange[1])] : null,
    paperScroll: vec(ink.paperScroll, [0, 0]),
    paper: vec(ink.paper, PAPER),
    wet: clamp(num(ink.wet, INK_DEFAULTS.wet), 0, 2),
    line: clamp(num(ink.line, INK_DEFAULTS.line), 0, 1),
    lineWidth: clamp(num(ink.lineWidth, INK_DEFAULTS.lineWidth), 0.5, 3),
    dry: clamp(num(ink.dry, INK_DEFAULTS.dry), 0, 1),
    rake: clamp(num(ink.rake, INK_DEFAULTS.rake), 0, 2),
    rakeAngle: num(ink.rakeAngle, INK_DEFAULTS.rakeAngle),
    scrollDepth: num(ink.scrollDepth, 0) > 0 ? ink.scrollDepth : null,
    pools: pools.slice(0, MAX_POOLS).map((p) => {
      const r = Math.max(0, num(p.r, 0.1));
      return {
        x: num(p.x, 0.5), y: num(p.y, 0.5), r, soft: Math.max(1e-4, num(p.soft, r * 0.35)),
        amount: clamp(num(p.amount, amount), 0, 1), chroma: Math.max(0, num(p.chroma, chroma)),
        rim: Math.max(0, num(p.rim, 1)),
      };
    }),
  };
}

/** Does the pass change any pixel? (amount 0 everywhere = skipped = exact passthrough) */
export function inkActive(n) {
  return !!n && (n.amount > 0 || n.pools.some((p) => p.amount > 0 && p.r > 0));
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerpv = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
/** Interpolate two canonical blocks (dissolves). A missing side is "no ink" with the other's paper. */
export function mixInk(a, b, k) {
  if (!a && !b) return null;
  if (k <= 0) return a; if (k >= 1) return b;
  const none = (o) => ({ ...INK_DEFAULTS, chroma: o.chroma, paperScroll: o.paperScroll, paper: o.paper, mistRange: o.mistRange, wet: o.wet, line: o.line, lineWidth: o.lineWidth, dry: o.dry, rake: o.rake, rakeAngle: o.rakeAngle, scrollDepth: o.scrollDepth, pools: [] });
  const A = a || none(b), B = b || none(a);
  const ghost = (p, side) => ({ ...p, r: 0, soft: 1e-4, amount: side.amount, chroma: side.chroma, rim: 0 });
  const pools = [];
  for (let i = 0; i < Math.max(A.pools.length, B.pools.length); i++) {
    const pa = A.pools[i] || ghost(B.pools[i], A), pb = B.pools[i] || ghost(A.pools[i], B);
    pools.push({ x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k), r: lerp(pa.r, pb.r, k), soft: Math.max(1e-4, lerp(pa.soft, pb.soft, k)),
      amount: lerp(pa.amount, pb.amount, k), chroma: lerp(pa.chroma, pb.chroma, k), rim: lerp(pa.rim, pb.rim, k) });
  }
  return {
    amount: lerp(A.amount, B.amount, k), chroma: lerp(A.chroma, B.chroma, k), mist: lerp(A.mist, B.mist, k),
    mistRange: A.mistRange && B.mistRange ? lerpv(A.mistRange, B.mistRange, k) : (A.mistRange || B.mistRange),
    paperScroll: lerpv(A.paperScroll, B.paperScroll, k), paper: lerpv(A.paper, B.paper, k),
    wet: lerp(A.wet, B.wet, k), line: lerp(A.line, B.line, k), lineWidth: lerp(A.lineWidth ?? 1, B.lineWidth ?? 1, k), dry: lerp(A.dry, B.dry, k), rake: lerp(A.rake, B.rake, k), rakeAngle: lerp(A.rakeAngle, B.rakeAngle, k),
    scrollDepth: A.scrollDepth && B.scrollDepth ? lerp(A.scrollDepth, B.scrollDepth, k) : (k < 0.5 ? A.scrollDepth : B.scrollDepth), pools,
  };
}

// ----------------------------------------------------------------------------------- GLSL
const g3 = (c) => `vec3(${c.map((v) => v.toFixed(4)).join(', ')})`;
const f = (x) => x.toFixed(4);
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const TONES = [...INK_TONES].reverse();                       // 清 .12 ... 焦 .95 (lightest first)
const PAPER_LUMA = lumaOf(PAPER);
// the tone curve's knots: density -> value relative to paper (1 = bare paper)
const KD = [0, ...TONES.map((t) => t.d)];                     // 0, .12, .30, .55, .78, .95
const KV = [1, ...TONES.map((t) => lumaOf(rgb(t.hex)) / PAPER_LUMA)];
const KC = [PAPER, ...TONES.map((t) => rgb(t.hex))];          // display colours at the knots
// What the pass READS is the graded frame, and the grade (ACES toe and shoulder, contrast, lift)
// moves the palette: linear(PALETTE.zhong) painted in a scene arrives a tone darker. So the reading
// curve is calibrated through the default grade (DEFAULT_POST in src/post.js: exposure 0, neutral
// balance, lift [0.012, 0.012, 0.016], contrast 1.04, saturation 0.96): a surface painted
// linear(PALETTE.<tone>) under the default grade is read as exactly that tone, linear(PALETTE.paper)
// or brighter as bare paper. Exposure and grade changes slide a surface along the curve; each tone's
// plateau holds it for about a third of a stop either way.
export function gradeDefault(lin) {
  const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
  const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  let c = mul(IN, lin.map((v) => v / 0.6));
  c = c.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  c = mul(OUT, c).map((x) => Math.min(1, Math.max(0, x)));
  c = c.map((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  const lift = [0.012, 0.012, 0.016];
  c = c.map((x, i) => x + lift[i] * (1 - x)).map((x) => (x - 0.5) * 1.04 + 0.5);
  const l = lumaOf(c);
  return c.map((x) => Math.max(0, l + (x - l) * 0.96));
}
const SRC_PAPER_LUMA = lumaOf(gradeDefault(linear(PALETTE.paper)));
const KS = [1, ...TONES.map((t) => lumaOf(gradeDefault(linear(t.hex))) / SRC_PAPER_LUMA)];   // source value at the knots

/** Paper and tone functions (no uniforms except the paper texture). */
export const PAPER_GLSL = /* glsl */ `
#ifndef FILM_PAPER
#define FILM_PAPER
uniform sampler2D tPaper;          // static sheet: r tooth, g long fibres, b pulp cloud, a bleed potential (all 0..1)
const float PAPER_TILE = ${f(PAPER_TILE)};
const vec3 INK_PAPER = ${g3(PAPER)};
const float INK_PAPER_LUMA = ${f(PAPER_LUMA)};
const float INK_SRC_LUMA = ${f(SRC_PAPER_LUMA)};             // graded luminance of a surface painted linear(paper)
/** The paper at paper-space p (frame widths). */
vec4 paperSample(vec2 p) { return texture(tPaper, p / PAPER_TILE); }
/** Low-frequency cloud mottling of the sheet, 0..1. */
float paperMottle(vec2 p) { return texture(tPaper, p / (PAPER_TILE * 5.3) + 0.37).b; }
/** Ink density of a graded value v = luminance / INK_SRC_LUMA (1 = bare paper, 0 = black): the
 *  palette as the default grade delivers it (see gradeDefault in lib/ink.js). */
float inkDensityOf(float v) {
  float d = 0.0;
${KS.slice(0, -1).map((v0, i) => `  d = mix(d, ${f(KD[i + 1])}, clamp((${f(v0)} - v) / ${f(v0 - KS[i + 1])}, 0.0, 1.0));`).join('\n')}
  return mix(d, 1.0, clamp((${f(KS[KS.length - 1])} - v) / ${f(KS[KS.length - 1])}, 0.0, 1.0));
}
/** Value (relative to paper, on the sheet) of ink of density d: the palette's own luminances. */
float inkValueOf(float d) {
  float v = 1.0;
${KD.slice(0, -1).map((d0, i) => `  v = mix(v, ${f(KV[i + 1])}, clamp((d - ${f(d0)}) / ${f(KD[i + 1] - d0)}, 0.0, 1.0));`).join('\n')}
  return v;
}
/** Ink density of a display colour (by luminance): 0 = paper or brighter, the five tones at their plateaus. */
float inkDensity(vec3 c) { return inkDensityOf(clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)) / INK_SRC_LUMA, 0.0, 1.0)); }
/** Pull a density to the five plateaus (smooth steps 0.06 wide at the midpoints). */
float inkQuantise(float d) {
  return 0.12 * smoothstep(0.03, 0.09, d) + 0.18 * smoothstep(0.18, 0.24, d) + 0.25 * smoothstep(0.395, 0.455, d)
       + 0.23 * smoothstep(0.635, 0.695, d) + 0.17 * smoothstep(0.835, 0.895, d);
}
/** Ink of density d as a transmittance over paper (exactly the palette's five tones at the plateaus). */
vec3 inkToneRel(float d) {
  vec3 c = INK_PAPER;
${KD.slice(0, -1).map((d0, i) => `  c = mix(c, ${g3(KC[i + 1])}, clamp((d - ${f(d0)}) / ${f(KD[i + 1] - d0)}, 0.0, 1.0));`).join('\n')}
  return c / INK_PAPER;
}
/** Display colour of ink of density d on paper of colour \`paper\`. */
vec3 inkTone(float d, vec3 paper) { return inkToneRel(d) * paper; }
/** What to PAINT (linear HDR, default grade) so that the INK pass reads density d: white at 0, the
 *  palette's linear tones at their plateaus, black at 1. For worlds that think in ink (washes, strokes). */
vec3 inkPaint(float d) {
  vec3 c = vec3(1.0);
${KD.slice(0, -1).map((d0, i) => `  c = mix(c, ${g3(linear(i + 1 < KD.length ? TONES[i].hex : '#000000'))}, clamp((d - ${f(d0)}) / ${f(KD[i + 1] - d0)}, 0.0, 1.0));`).join('\n')}
  return mix(c, vec3(0.0), clamp((d - 0.95) / 0.05, 0.0, 1.0));
}
#endif
`;

/**
 * Dry brush (飞白) in stroke space. st.x 0..1 along the stroke (0 = where the brush lands, loaded;
 * 1 = where it runs out), st.y -1..1 across it. load 0..1: 1 = a wet, solid stroke; 0.3 = mostly
 * streaks. Returns coverage 0..1. Bristles are streaks along the stroke: each has its own load and
 * runs dry at its own point, the heel of the brush holds more than its edges, and the stroke ends
 * in split hairs. Pure function of (st, seed): a moving stroke does not flicker.
 */
export const DRYBRUSH_GLSL = /* glsl */ `
#ifndef FILM_DRYBRUSH
#define FILM_DRYBRUSH
float dbHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float dbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dbHash(i), dbHash(i + vec2(1.0, 0.0)), u.x), mix(dbHash(i + vec2(0.0, 1.0)), dbHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float dryBrush(vec2 st, float load, float seed) {
  float x = clamp(st.x, 0.0, 1.0), y = st.y;
  // bristles: fine streaks across the stroke, coherent along it
  float b1 = dbNoise(vec2(y * 7.0 + seed * 3.1, x * 1.5 + seed));
  float b2 = dbNoise(vec2(y * 19.0 - seed * 1.7, x * 3.0 + seed * 2.3));
  float b3 = dbNoise(vec2(y * 47.0 + seed * 5.3, x * 7.0));
  float bristle = 0.5 * b1 + 0.32 * b2 + 0.18 * b3;                       // 0..1, this hair's share of the ink
  // the ink runs out along the stroke, sooner at the edges of the brush, later in its heel
  float body = 1.0 - 0.55 * y * y;
  float ink = load * 1.35 * body + (bristle - 0.5) * 1.1 - x * x * (1.55 - load) * (0.7 + 0.9 * (1.0 - bristle));
  // skips where the paper's tooth lifts the hairs
  ink -= 0.5 * (1.0 - load) * dbNoise(vec2(x * 23.0 + seed, y * 5.0)) * smoothstep(0.15, 0.9, x);
  float cover = smoothstep(0.36, 0.52, ink);
  // the stroke's own outline: a soft landing, ragged sides
  float side = 1.0 - smoothstep(0.78 + 0.2 * (b2 - 0.5), 1.0, abs(y));
  float land = smoothstep(0.0, 0.03, x + 0.02 * (b1 - 0.5));
  return cover * side * land;
}
#endif
`;

/**
 * The film's opening and closing gesture: black let down with water (S01, S23). inkDilute(p, c, wash)
 * is the density (0..1) of the black wash at paper-space p (frame widths, y up) while water spreads
 * from c: wash 1 = the sheet is black, 0 = clear. The front is irregular (it follows the paper, a
 * little faster along the fibres), sharp while small and wide and soft as it grows; behind it the
 * ink thins through every tone. Paint `inkPaint(1 - (1 - yours) * (1 - inkDilute(...)))`, or mix your
 * colour toward black by it. Needs DRYBRUSH_GLSL's dbNoise (included).
 */
export const DILUTE_GLSL = DRYBRUSH_GLSL + /* glsl */ `
#ifndef FILM_DILUTE
#define FILM_DILUTE
float inkDilute(vec2 p, vec2 c, float wash) {
  float k = clamp(1.0 - wash, 0.0, 1.0);
  if (k <= 0.0) return 1.0;
  vec2 q = (p - c) * vec2(1.0, 1.22);
  float n1 = dbNoise(p * 2.3 + 7.1), n2 = dbNoise(p * 7.0 + 3.3), n3 = dbNoise(p * 23.0 + 1.7), n4 = dbNoise(p * 71.0);
  // water pushes the ink outward in fingers: noise stretched along the radius
  vec2 dir = q / max(length(q), 1e-4);
  float fin = dbNoise(dir * 1.6 + vec2(11.0, length(q) * 2.2)) + 0.5 * dbNoise(dir * 4.6 + vec2(3.0, length(q) * 5.0));
  float rho = length(q) * (1.0 + 0.5 * (n1 - 0.5) + 0.2 * (n2 - 0.5) + 0.12 * (fin - 0.75)) + 0.035 * (n3 - 0.5) + 0.012 * (n4 - 0.5);
  // the water creeps along the fibres: every edge is finely ragged, more along the sheet than across it
  rho += 0.0032 * (dbNoise(p * vec2(170.0, 620.0)) - 0.5) + 0.0016 * (dbNoise(p * vec2(520.0, 1400.0) + 5.0) - 0.5);
  float R = 1.21 * k;                            // steady: the centre opens early, the last corner clears at wash 0.1
  float w = mix(0.07, 0.45, k);
  float d = smoothstep(R - w, R, rho);
  d = pow(d * d * (3.0 - 2.0 * d), 1.7);        // a broad pale reach behind a narrow dark front
  // the thinning ink is cloudy, not a contour map: each tone breaks up on its own
  float cl = 4.0 * d * (1.0 - d);
  d = clamp(d + cl * (0.30 * (n2 - 0.5) + 0.22 * (n3 - 0.5) + 0.12 * (dbNoise(p * 37.0 + 9.0) - 0.5)), 0.0, 1.0);
  // let down in washes, not as one gradient: the five tones, each with its own edge
  // (soft steps: each wash ends in a wet edge a few fibres wide, not a contour line)
  float dq = 0.12 * smoothstep(0.03, 0.09, d) + 0.18 * smoothstep(0.175, 0.245, d) + 0.25 * smoothstep(0.385, 0.465, d)
           + 0.23 * smoothstep(0.62, 0.71, d) + 0.22 * smoothstep(0.82, 0.91, d);
  return mix(d, dq, 0.6) * (1.0 - smoothstep(0.88, 1.0, k));     // nothing is left at wash 0
}
#endif
`;

export const INK_GLSL = PAPER_GLSL + /* glsl */ `
#ifndef FILM_INK
#define FILM_INK
uniform sampler2D tInkBlur;          // rgb the frame blurred ~6 px (display), a blurred mist factor
uniform float uInkAmount, uInkChroma, uInkMist, uInkWet, uInkLine, uInkLineWidth, uInkDry, uInkRake, uInkScrollDepth;
uniform vec2 uInkMistRange;
uniform vec2 uPaperScroll, uInkRakeDir;
uniform vec3 uInkDof;                // the shot's depth of field: focus (view depth), aperture, max blur (1080p px); aperture 0 = none
uniform vec3 uPaperColor;
uniform vec4 uPoolA[${MAX_POOLS}];   // x, y (frame, y up), r, soft (frame widths)
uniform vec4 uPoolB[${MAX_POOLS}];   // amount, chroma, rim, -
uniform int uPools;

float inkPicH() { return uPicFrac * uRes.y / uRes.x; }      // picture height in picture widths
vec2 inkPic(vec2 uv) { return vec2(uv.x, (uv.y - 0.5) / uPicFrac + 0.5); }
/** Paper space of a frame uv: frame widths, x across, y up, scrolled with the shot. */
vec2 paperCoord(vec2 uv) { vec2 q = inkPic(uv); return vec2(q.x, q.y * inkPicH()) + uPaperScroll; }
/** 0 near .. 1 far: where mist, bleed and line ramp. */
float inkFar(float depth) { return smoothstep(uInkMistRange.x, uInkMistRange.y, depth); }
float inkMax3(vec3 c) { return max(c.r, max(c.g, c.b)); }

vec3 inkApply(vec2 uv, vec3 base) {
  vec2 pc = paperCoord(uv);
  vec4 pap = paperSample(pc);                                   // tooth, fibres, cloud, bleed potential
  vec4 pap2 = paperSample(pc * 0.31 + vec2(0.317, 0.673));      // the same sheet read coarser: wobble, pressure
  float mott = paperMottle(pc);
  // 8. pools: the knobs at this pixel, and the wet rims where they change
  float a = uInkAmount, ch = uInkChroma, rimD = 0.0, rimC = 0.0;
  vec2 pic = inkPic(uv);
  float ph = inkPicH();
  for (int i = 0; i < ${MAX_POOLS}; i++) {
    if (i >= uPools) break;
    vec4 A = uPoolA[i], B = uPoolB[i];
    float dist = length(vec2(pic.x - A.x, (pic.y - A.y) * ph)) + ((pap.a - 0.5) * 1.5 + (pap2.b - 0.5) * 1.1 + (mott - 0.5) * 0.8) * A.w;
    float w = 1.0 - smoothstep(A.z - A.w, A.z, dist);
    float edge = 4.0 * w * (1.0 - w) * B.z;
    rimD = max(rimD, edge * abs(B.x - a));
    rimC = max(rimC, edge * abs(B.y - ch));
    a = mix(a, B.x, w);
    ch = mix(ch, B.y, w);
  }
  if (a <= 0.0) return base;                                    // exact passthrough
  float chE = clamp(ch, 0.0, 1.0);
  float onPaper = smoothstep(0.0, 0.5, a);                      // the sheet arrives first; the ink follows amount

  vec2 px = uRefScale / uRes;                                   // one 1080p pixel in uv
  vec4 sz = lookSource(uv);
  float wet = uInkWet * a;
  // 4. the hand: a slow wobble of every edge, and a feathering along the fibres (bleed), more on far
  //    planes: distance is wetter. In a parallax scroll each depth carries its own piece of this
  //    field (scrollDepth), so an edge keeps its wobble as its plane slides over the sheet; and a
  //    far wash never paints over a nearer thing, so a silhouette belongs to the thing in front
  vec2 pd = uInkScrollDepth > 0.0 ? pc - uPaperScroll * (1.0 - clamp(uInkScrollDepth / max(sz.a, 1e-3), 0.0, 4.0)) : pc;
  vec4 papD = paperSample(pd), pap2D = paperSample(pd * 0.31 + vec2(0.317, 0.673));
  float farZ = inkFar(sz.a);
  vec2 dispC = vec2(pap2D.b - 0.5, pap2D.a - 0.5) * vec2(9.0, mix(8.0, 11.0, farZ)) * wet;
  vec2 cuv = uv + dispC * px;
  vec4 s0 = lookSource(cuv);
  if (s0.a < sz.a * 0.93) { s0 = sz; cuv = uv; }
  float far0 = inkFar(s0.a);
  vec2 suv = cuv + vec2((papD.a - 0.5) * mix(2.4, 9.0, far0), 0.0) * wet * px;
  vec4 ss = lookSource(suv);
  if (ss.a < s0.a * 0.93) { ss = s0; suv = cuv; }
  vec4 sb = texture(tInkBlur, suv);
  float far = inkFar(ss.a);

  // read the source as a layer over paper: value -> ink, hue -> wash. Only saturated colour is a
  // wash (its value is its brightest channel, so a pure hue carries no ink at all); greys, and the
  // paper's own warm white, are ink alone, so the same grey is the same tone in and out of a pool
  //    With chroma below 1 a colour does not go grey, it goes pale: from about half chroma up its
  //    ink is still measured on its brightest channel (the wing blue never turns to slate), and
  //    chroma thins the wash toward paper. Only toward chroma 0 does colour become ink by luminance.
  float ms = inkMax3(ss.rgb), mb = inkMax3(sb.rgb);
  vec3 hs = ss.rgb / max(ms, 1e-3), hb = sb.rgb / max(mb, 1e-3);
  float colS = smoothstep(0.06, 0.24, 1.0 - min(hs.r, min(hs.g, hs.b))) * smoothstep(0.02, 0.10, ms);   // is this pixel a colour?
  float colB = smoothstep(0.06, 0.24, 1.0 - min(hb.r, min(hb.g, hb.b))) * smoothstep(0.02, 0.10, mb);
  float chK = smoothstep(0.0, 0.5, chE);
  float chS = colS * chK, chB = colB * chK;                     // how far its ink is read from value, not luminance
  float Ls = dot(ss.rgb, vec3(0.2126, 0.7152, 0.0722)), Lb = dot(sb.rgb, vec3(0.2126, 0.7152, 0.0722));
  // 2. mist is bare paper
  float mistS = 1.0 - uInkMist * far * onPaper;
  float ds = inkDensityOf(min(mix(Ls, ms, chS) / INK_SRC_LUMA, 1.0)) * mistS;
  float db = inkDensityOf(min(mix(Lb, mb, chB) / INK_SRC_LUMA, 1.0)) * mistS;

  // 1. tones: five layered washes; each step's edge follows the sheet, and leaves a faint tide line
  //    A gradient that is soft in the source (a glow, a mist, a shape out of focus: the density
  //    slopes gently from pixel to pixel) is a graded wash, laid wet: its steps widen until they
  //    run together and leave no tide line. Flat areas and crisp edges keep theirs.
  float e = ds - db;
  float slope = length(vec2(dFdx(ds), dFdy(ds))) * uRefScale;
  float graded = smoothstep(0.0008, 0.004, slope) * (1.0 - smoothstep(0.03, 0.08, slope));
  float qw = mix(0.03, 0.09, graded);
  float dq = ds + ((mott - 0.5) * 0.06 + (pap2.b - 0.5) * 0.05) * smoothstep(0.02, 0.12, ds) * (1.0 - 0.7 * graded);
  float t1 = smoothstep(0.06 - qw, 0.06 + qw, dq), t2 = smoothstep(0.21 - qw, 0.21 + qw, dq), t3 = smoothstep(0.425 - qw, 0.425 + qw, dq);
  float t4 = smoothstep(0.665 - qw, 0.665 + qw, dq), t5 = smoothstep(0.865 - qw, 0.865 + qw, dq);
  float q = 0.12 * t1 + 0.18 * t2 + 0.25 * t3 + 0.23 * t4 + 0.17 * t5;
  float tide = (t1 * (1.0 - t1) + t2 * (1.0 - t2) + t3 * (1.0 - t3) + t4 * (1.0 - t4)) * (1.0 - graded);
  // a colour wash is continuous: the five tones and their tide lines are for ink (greys, and the
  // darkest masses of a coloured picture), never steps in a sky or a field of colour
  float inkOnly = 1.0 - chS * (1.0 - smoothstep(0.55, 0.8, ds));
  float d = mix(ds, q + 0.10 * tide, a * inkOnly);

  // 3. wet edge and bloom, from sharp minus blurred density: on the dense side pigment gathers at
  //    the boundary (near, wet on dry); far away the same edge softens instead (wet in wet); on the
  //    paper side water carries a pale veil of ink out along the fibres
  float rim = max(e, 0.0), veil = max(-e, 0.0);
  float farW = clamp(far * (0.35 + 0.65 * uInkWet), 0.0, 1.0);
  d += a * rim * mix(0.8, -0.45, farW) * (1.0 - 0.85 * chS);    // on colour the rim is pigment, not ink (see the wash)
  d += wet * veil * mix(0.22, 0.6, farW) * smoothstep(0.2, 0.8, pap.a + 0.6 * (pap2.b - 0.5)) * (1.0 - 0.7 * chS);

  // the ink contour: near things are drawn with a line (depth edges; planes have none). The line is
  // the first thing ink brings and the last it gives up: it stands at full strength from amount 0.3
  // up (so a colour picture at low or middle ink still has its drawing), and it is drawn ONLY where
  // the picture itself is crisp. The depth buffer stays sharp under depth of field and shutter
  // smear; a contour traced from it over a soft picture is a wireframe, not a brush line. So:
  //   out of focus   the shot's own circle of confusion at this depth (uInkDof): no line beyond ~2 px
  //   smeared        the picture's gradient at 1-2 px against its gradient at 4.5 px: equal across a
  //                  crisp edge, a third across a soft one
  float lineAmt = smoothstep(0.08, 0.3, a);
  float cocPx = abs(clamp(uInkDof.y * (s0.a - uInkDof.x) / max(s0.a, 1e-4), -1.0, 1.0)) * uInkDof.z;
  float inFocus = 1.0 - smoothstep(1.0, 2.5, cocPx);
  float lineK = 0.0, dLs = inkDensityOf(min(Ls / INK_SRC_LUMA, 1.0)) * mistS;
  if (uInkLine > 0.0 && inFocus > 0.0) {
    float press = smoothstep(0.3, 0.7, 0.6 * pap2.b + 0.4 * mott + 0.25 * (pap2.r - 0.5));   // the pressure of the hand
    vec2 o = px * mix(0.7, 2.1, press) * uInkLineWidth;
    float q0 = 1.0 / max(s0.a, 1e-3);
    vec4 nl = lookSource(cuv - vec2(o.x, 0.0)), nr = lookSource(cuv + vec2(o.x, 0.0));
    vec4 nd = lookSource(cuv - vec2(0.0, o.y)), nu = lookSource(cuv + vec2(0.0, o.y));
    float qs = 1.0 / max(nl.a, 1e-3) + 1.0 / max(nr.a, 1e-3) + 1.0 / max(nd.a, 1e-3) + 1.0 / max(nu.a, 1e-3);
    float lap = (qs - 4.0 * q0) / q0;                           // < 0: this pixel stands in front of its surround
    float ln = smoothstep(0.1, 0.6, -lap) * (1.0 - far0) * uInkLine * lineAmt * inFocus * (1.0 - graded);
    ln *= mix(0.3, 1.0, press);
    // light is reserved paper: a lamp, a lit window, a bright disc is never outlined
    ln *= smoothstep(0.04, 0.22, 1.0 - min(dot(s0.rgb, vec3(0.2126, 0.7152, 0.0722)) / INK_SRC_LUMA, 1.0));
    if (ln > 0.01) {
      vec2 w = px * 4.5 * uInkLineWidth;
      vec4 fl = lookSource(cuv - vec2(w.x, 0.0)), fr = lookSource(cuv + vec2(w.x, 0.0));
      vec4 fd = lookSource(cuv - vec2(0.0, w.y)), fu = lookSource(cuv + vec2(0.0, w.y));
      // not a mark that is only a few pixels across (a far wing, a flower, a rain stroke): it IS the
      // brush mark; a contour would swallow it and its colour. A contour needs a shape to enclose.
      float lim = q0 * 0.93;                                    // a tap is on this thing if it is about as near
      float held = step(lim, 1.0 / max(fl.a, 1e-3)) + step(lim, 1.0 / max(fr.a, 1e-3)) + step(lim, 1.0 / max(fd.a, 1e-3)) + step(lim, 1.0 / max(fu.a, 1e-3));
      ln *= step(0.5, held);
      // not where the picture is smeared, and not where it shows no edge at all: under shutter
      // accumulation the depth is one sub-frame's, and its silhouette lies inside the smear, where
      // the picture is even. A contour needs a crisp edge in the picture to stand on.
      float g1 = max(length(nr.rgb - nl.rgb), length(nu.rgb - nd.rgb)), g3 = max(length(fr.rgb - fl.rgb), length(fu.rgb - fd.rgb));
      ln *= smoothstep(0.42, 0.75, g1 / max(g3, 1e-3)) * smoothstep(0.02, 0.06, g3);
    }
    // drawn in the ink of the thing it outlines: a pale far shape gets a pale line (淡墨勾), a dark
    // near one a black line; always a tone or two darker than the wash it encloses
    float lineD = mix(0.30, 0.86, smoothstep(0.06, 0.62, max(d, dLs))) + 0.12 * press;
    lineK = clamp(ln, 0.0, 1.0);
    d = mix(d, max(d, lineD), lineK);
  }

  // over a colour wash the drawing is ink too: the dark side of every crisp luminance edge and every
  // thin dark thing (a branch, a path's edge, grass tops against light) is a brush line laid over
  // the colour, as dark as the thing it draws. (On greys the wet rim above already is that line.)
  if (uInkLine > 0.0 && chS > 0.0 && inFocus > 0.0) {
    float dLb = inkDensityOf(min(Lb / INK_SRC_LUMA, 1.0)) * mistS;
    float slope1 = (length(dFdx(ss.rgb)) + length(dFdy(ss.rgb))) * uRefScale;
    float sharp = smoothstep(0.12, 0.4, slope1 / max(2.0 * length(ss.rgb - sb.rgb), 0.03));
    float drawn = smoothstep(0.05, 0.2, dLs - dLb) * uInkLine * lineAmt * chS * inFocus * sharp * (1.0 - 0.6 * far);
    drawn = clamp(drawn * (0.55 + 0.9 * (pap2.b - 0.3)), 0.0, 1.0);   // the hand: it presses and lifts
    float drawnD = drawn * mix(0.42, 0.9, smoothstep(0.25, 0.75, dLs));
    lineK = max(lineK, drawn * step(d, drawnD));
    d = max(d, drawnD);
  }

  // 6. granulation: pigment settles in the tooth of thin washes; 焦 stays whole
  float thinInk = 1.0 - smoothstep(0.5, 0.9, d);
  d *= 1.0 + a * (1.0 - 0.8 * chS) * ((0.6 * pap.r + 0.4 * pap2.r - 0.5) * mix(0.03, 0.11, thinInk) + ((mott - 0.5) * 0.12 + (pap2.a - 0.5) * 0.10) * thinInk * clamp(uInkWet, 0.0, 1.0));
  d += a * 0.014 * pap.g * smoothstep(0.03, 0.2, d) * thinInk;  // long fibres drink a little more
  // 5. (untagged) dry brush: thin ink breaks where the tooth lifts the hairs
  float thin = smoothstep(0.06, 0.35, rim) * (1.0 - smoothstep(0.55, 0.9, db));
  d *= 1.0 - a * uInkDry * thin * (1.0 - smoothstep(0.32, 0.6, pap.r + 0.35 * (pap2.r - 0.5)));
  d += 0.25 * rimD;                                             // a pool's wet rim
  // cards on paper, at their true place (type is not wobbled): resist (T1) draws the wash back from
  // the strokes and gathers it at their edge; ink (L2, E) is 焦 with the sheet's tooth in it, paler
  // at the soak's front
  vec4 card = lookCard(uv);
  d = d * (1.0 - 0.985 * card.g) + 0.5 * d * card.g * (1.0 - card.g);
  d = max(d, card.r * (0.90 + 0.09 * pap.r - 0.12 * card.b * (1.0 - card.r)));
  d = clamp(d, 0.0, 1.0);

  // 7. colour under line: the hue left once the value is taken out, flattened (the blur) and laid a
  //    little loosely, so it runs over its own line as hand colouring does
  vec3 ws = mix(vec3(1.0), hs, colS * chE), wb = mix(vec3(1.0), hb, colB * chE);
  vec3 hue = mix(ws, min(ws, mix(ws, wb, 0.75)), a);
  // pigment pools and granulates too: deeper where the wash was laid wet, and at its own edges
  //    (the slow unevenness of a laid wash belongs to a sheet that holds still: with a free camera,
  //    wet < 1, it would hang in front of the picture like a stain, so it follows wet)
  float still = clamp(uInkWet, 0.0, 1.0);
  float pool = a * ((pap.r - 0.5) * 0.10 + ((mott - 0.5) * 0.3 + (pap2.a - 0.5) * 0.24) * still * still + 0.5 * rimC + 1.2 * rim);
  hue = pow(max(hue, vec3(1e-3)), vec3(clamp(1.0 + pool, 0.5, 1.8)));
  hue = mix(hue, vec3(1.0), uInkMist * far * onPaper * 0.6);
  hue = mix(hue, vec3(1.0), card.g);
  float tint = max(chS, chB * a);                               // how far this pixel is wash rather than ink
  vec3 trans = mix(inkToneRel(d), inkValueOf(d) * hue, clamp(tint, 0.0, 1.0));
  trans = mix(trans, inkToneRel(d) * mix(vec3(1.0), hue, 0.25), lineK * 0.85);   // the line is ink, laid over the wash

  // the sheet: colour, cloud, long fibres, relief under a raking light
  float relief = pap.r - paperSample(pc + uInkRakeDir * 0.00068).r;
  float sheet = 1.0 + onPaper * (0.05 * (mott - 0.5) + 0.03 * (pap2.b - 0.5) - 0.014 * pap.g + uInkRake * 0.16 * relief);
  vec3 paper = mix(INK_PAPER, uPaperColor, onPaper) * sheet;
  vec3 inked = clamp(paper * trans, 0.0, 1.0);
  return mix(base, inked, onPaper);
}
#endif
`;

// ----------------------------------------------------------------------------------- JS side
export function inkUniforms() {
  return {
    tPaper: { value: null }, tInkBlur: { value: null },
    uInkAmount: { value: 0 }, uInkChroma: { value: 1 }, uInkMist: { value: 0 },
    uInkWet: { value: 1 }, uInkLine: { value: 1 }, uInkLineWidth: { value: 1 }, uInkDry: { value: 0.3 }, uInkRake: { value: 0.3 }, uInkScrollDepth: { value: 0 },
    uInkMistRange: { value: new THREE.Vector2(1, 2) },
    uPaperScroll: { value: new THREE.Vector2() }, uInkRakeDir: { value: new THREE.Vector2(-0.81, 0.59) },
    uInkDof: { value: new THREE.Vector3(10, 0, 18) },
    uPaperColor: { value: new THREE.Vector3(...PAPER) },
    uPoolA: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Vector4()) },
    uPoolB: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Vector4()) },
    uPools: { value: 0 },
  };
}

/** Write a canonical block into the uniforms. near/far: the shot camera's (for the mist default);
 *  dof: the shot's post.dof (the contour line is not drawn on anything out of focus). */
export function setInkUniforms(u, n, { renderer, near = 0.1, far = 1000, dof = null } = {}) {
  const dofOn = !!(dof && (dof.aperture ?? 1) > 0);
  if (u.uInkDof) u.uInkDof.value.set(dof?.focus ?? 10, dofOn ? (dof.aperture ?? 1) : 0, dof?.maxBlur ?? 18);
  u.tPaper.value = getPaperTexture(renderer);
  u.uInkAmount.value = n.amount;
  u.uInkChroma.value = n.chroma;
  u.uInkMist.value = n.mist;
  u.uInkWet.value = n.wet ?? 1; u.uInkLine.value = n.line ?? 1; u.uInkDry.value = n.dry ?? 0.3; u.uInkRake.value = n.rake ?? 0.3;
  u.uInkScrollDepth.value = n.scrollDepth || 0;
  if (u.uInkLineWidth) u.uInkLineWidth.value = n.lineWidth ?? 1;
  const ra = ((n.rakeAngle ?? 144) * Math.PI) / 180;
  u.uInkRakeDir.value.set(Math.cos(ra), Math.sin(ra));
  const mr = n.mistRange || [far * 0.05, far * 0.6];
  u.uInkMistRange.value.set(mr[0], Math.max(mr[1], mr[0] + 1e-4));
  u.uPaperScroll.value.set(n.paperScroll[0], n.paperScroll[1]);
  u.uPaperColor.value.set(n.paper[0], n.paper[1], n.paper[2]);
  n.pools.forEach((p, i) => { u.uPoolA.value[i].set(p.x, p.y, p.r, p.soft); u.uPoolB.value[i].set(p.amount, p.chroma, p.rim, 0); });
  u.uPools.value = n.pools.length;
}

// The paper texture: generated once per renderer on the GPU (tileable value noise), RGBA8 with
// mipmaps, REPEAT. One tile = PAPER_TILE frame widths.
//   r tooth            fine felt: isotropic grain + short fibre grain both ways + very faint laid lines
//   g long fibres      sparse, long, nearly horizontal strands with a slow wander (0 = none)
//   b pulp cloud       flocculation of the pulp, two scales (also read 5.3x coarser as the sheet's mottle)
//   a bleed potential  coherent, stretched along x: the field ink wicks along
const PAPER_GEN_FRAG = HASH + /* glsl */ `
varying vec2 vUv;
float pn(vec2 p, vec2 period) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, period)), b = hash12(mod(i + vec2(1.0, 0.0), period));
  float c = hash12(mod(i + vec2(0.0, 1.0), period)), d = hash12(mod(i + vec2(1.0, 1.0), period));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pf(vec2 uv, vec2 freq, int oct, float seed) {
  float s = 0.0, amp = 0.5, n = 0.0;
  vec2 f = freq;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += amp * pn(uv * f + seed * 17.13, f); n += amp;
    f *= 2.0; amp *= 0.5;
  }
  return s / n;
}
// uv turned by an integer lattice matrix (a, b; -b, a): still tiles, so fibres can lie at any of a
// few angles (0, 18, 27, 45, 63, 90 degrees and their mirrors) instead of only along the axes
vec2 turn(vec2 uv, float a, float b) { return vec2(a * uv.x + b * uv.y, -b * uv.x + a * uv.y); }
float fibreField(vec2 uv, float a, float b, vec2 freq, float seed) { return pf(turn(uv, a, b), freq, 2, seed); }
float strands(vec2 uv, float a, float b, vec2 freq, float seed, float lo, float hi) {
  // thin elongated crests of very anisotropic noise, bent by a slow tileable wander
  vec2 w = uv + vec2(0.0, 0.03 * (pf(uv, vec2(3.0), 2, seed + 7.0) - 0.5) + 0.012 * (pf(uv, vec2(11.0), 2, seed + 9.0) - 0.5));
  return smoothstep(lo, hi, pf(turn(w, a, b), freq, 2, seed));
}
void main() {
  vec2 uv = vUv;                                  // one tile = PAPER_TILE frame widths
  float bleed = pf(uv, vec2(10.0, 36.0), 3, 1.0);
  // tooth: a felt of short fibres lying every way, with a little fine grain; no pebbles
  float felt = fibreField(uv, 1.0, 0.0, vec2(26.0, 420.0), 5.0) + fibreField(uv, 0.0, 1.0, vec2(26.0, 420.0), 6.0)
             + fibreField(uv, 1.0, 1.0, vec2(18.0, 300.0), 7.0) + fibreField(uv, 1.0, -1.0, vec2(18.0, 300.0), 8.0)
             + fibreField(uv, 2.0, 1.0, vec2(12.0, 190.0), 9.0) + fibreField(uv, 1.0, -2.0, vec2(12.0, 190.0), 10.0)
             + fibreField(uv, 3.0, -1.0, vec2(8.0, 134.0), 12.0);
  felt /= 7.0;
  float grain = pf(uv, vec2(512.0), 2, 3.0);
  float laid = 0.5 + 0.5 * sin(uv.x * 6.283185307 * 216.0);
  float tooth = smoothstep(0.30, 0.70, 0.5 + 2.2 * (felt - 0.5) + 0.25 * (grain - 0.5) + 0.035 * (laid - 0.5));
  // long fibres: sparse strands, mostly along the sheet, a few across
  float fib = max(strands(uv, 1.0, 0.0, vec2(9.0, 300.0), 11.0, 0.72, 0.82), 0.7 * strands(uv, 3.0, 1.0, vec2(5.0, 150.0), 13.0, 0.74, 0.82));
  fib = max(fib, 0.6 * strands(uv, 1.0, -2.0, vec2(6.0, 170.0), 17.0, 0.76, 0.84));
  fib = max(fib, 0.5 * strands(uv, 0.0, 1.0, vec2(12.0, 340.0), 19.0, 0.77, 0.85));
  float cloud = 0.6 * pf(uv, vec2(4.0), 4, 4.0) + 0.4 * pf(uv, vec2(22.0, 16.0), 3, 8.0);
  gl_FragColor = vec4(tooth, fib, cloud, bleed);
}`;

const paperCache = new WeakMap();
/** The static paper texture for this renderer (created on first call; never changes). */
export function getPaperTexture(renderer) {
  let rt = paperCache.get(renderer);
  if (rt) return rt.texture;
  rt = new THREE.WebGLRenderTarget(PAPER_SIZE, PAPER_SIZE, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
  });
  rt.texture.name = 'ink-paper';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({
    name: 'ink-paper-gen', depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: PAPER_GEN_FRAG,
  });
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(quad, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(prev);
  geo.dispose(); mat.dispose();
  paperCache.set(renderer, rt);
  return rt.texture;
}
/** Free the paper texture of a renderer (engine dispose). */
export function disposePaper(renderer) {
  const rt = paperCache.get(renderer);
  if (rt) { rt.dispose(); paperCache.delete(renderer); }
}
