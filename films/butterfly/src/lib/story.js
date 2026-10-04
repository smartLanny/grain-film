// STORY — shared constants for 《梦蝶》 / THE DREAM OF THE BUTTERFLY (SCRIPT.md sections 3.0, 4, 7, 8.4).
// Single source of truth for every number two groups must agree on: shot times, BREATH, the reserved
// palette, the ink/chroma table, the joins (lamp = sun, the hump, the 34% line, the seven hangers,
// the hero blade, the speck). Pure data and pure functions of film time only. Import from here; never
// copy these numbers into world or shot files.
//
// FORMAT: the film is delivered 18:9 — a 2160x1080 (2:1) frame that is ALL picture, no black bars.
// Wherever SCRIPT.md says "(% across, % up) of the 2.39:1 picture area", read: of the full 2:1
// frame. (SCRIPT.md's card positions in 1920x1080-frame pixels are converted in shots/_card.js.)
//
// UNITS (everywhere in this file unless a field says otherwise)
//   time       film seconds (t), 0..240
//   screen     fractions of the FULL FRAME: [x, y], x 0..1 left -> right, y 0..1 BOTTOM -> TOP
//              (the shot list's "(% across, % up)"). Same space as ink pools and SHEEN geometry.
//   radius     fraction of the frame WIDTH (so circles stay round), like ink pools
//   angles     degrees
//   GRASS      1 unit = 1 cm; INTERIOR / CITY 1 unit = 1 m; FIELD 1 unit = 100 m (GRAIN's W2)
//
// OWNERSHIP: Group A owns this file. Values marked PLACEHOLDER are first guesses with the right
// units; the named groups refine them (keep the names and units; tell the other side).
//
// (GRAIN's old story constants live on in lib/valley-story.js for the reused landscape libraries.)

import { createRng } from './random.js';

// ---- Shot times (film seconds, SCRIPT.md section 4) -------------------------------------------
// The timeline has 25 entries: S04 is split into S04a (INTERIOR, the S02 frame and the speck) and
// S04b (GRASS), joined by a 3 s SHEEN at 41.0. SHOT.S04 is the scene as a whole (NOT a timeline
// entry; for the score and for reference). Iterate SHOT_ORDER, not Object.keys(SHOT).
export const SHOT = {
  S01: [0, 14], S02: [14, 26], S03: [26, 40],
  S04: [40, 52], S04a: [40, 41], S04b: [41, 52],
  S05: [52, 63], S06: [63, 73], S07: [73, 82],
  S08: [82, 90], S09: [90, 98], S10: [98, 106], S11: [106, 114],
  S12: [114, 121], S13: [121, 129], S14: [129, 138], S15: [138, 144],
  S16: [144, 152], S17: [152, 162], S18: [162, 170], S19: [170, 178], S20: [178, 192],
  S21: [192, 202], S22: [202, 216], S23: [216, 230], S24: [230, 240],
};
export const SHOT_ORDER = ['S01', 'S02', 'S03', 'S04a', 'S04b', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11',
  'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20', 'S21', 'S22', 'S23', 'S24'];
export const DURATION = 240;
/** Shot-local progress 0..1 of film time t in shot `id` (unclamped). */
export const localT = (id, t) => (t - SHOT[id][0]) / (SHOT[id][1] - SHOT[id][0]);

/** Frame-accurate sync points (SCRIPT.md section 6, "Sync points"), film seconds. */
export const SYNC = {
  wingsOpen: 24.0,      // ★1 the wings fully open on the sleeper's inhale; first xiao note peaks
  shed: 35.5,           // ★2 the letter scales let go
  impact: 82.0,         // ★3 the drop strikes; the alarm; the head snaps up
  railJoint: 129.0,     // ★4 the drop fills the frame; invisible cut; the second jolt
  firstWing: 162.0,     // ★5 the first umbrella splits into wings
  black: 214.0,         // ★6 the shadow has covered the frame; silence
  bell: 220.5,          // ★7 white paper; the blade at rest; the E6 bell
  landing: 20.0, split: 44.0, gold: 142.0, umbrellas: [148, 149, 150, 151], fold: 158.5, sheenEnd: 233.0,
};

// ---- BREATH (SCRIPT.md 3.0) --------------------------------------------------------------------
// Period 4.0 s (one bar at 60 BPM): inhale 1.6 s ease-out, exhale 2.4 s ease-in-out. 0 = fully
// exhaled (shoulders down, wings shut), 1 = the top of the inhale (wings open). The peaks are fixed
// by the shot list:
//   S01-S05  peaks at 4k        (16, 20, 24 in S02; 32 in S03; 44 = the pupa splits in S04)
//   S06-S07  peaks at 4k + 1    (65, 69, 73: the wings open on the flower)
//   S08-S20  peaks at 4k        (the sleeper again; S08's "one long exhale" is the INTERIOR pose's job)
//   S21-S22  four slowing breaths, then none: peaks 195.0 (100%), 199.5 (60%), 204.5 (30%),
//            210.0 (10%, a tremor); cycle lengths 4.0, 4.5, 5.0, 5.5 s with the same 40/60 split, so a
//            0.3 s rest separates them (the wings are shut and it is ink), and nothing after 213.3.
export const BREATH = { period: 4.0, inhale: 1.6, exhale: 2.4 };
const BREATH_SPANS = [
  { to: 63, phase: 0 },
  { to: 82, phase: 1 },
  { to: 192, phase: 0 },
  { to: Infinity, peaks: [[195.0, 1.0, 4.0], [199.5, 0.6, 4.5], [204.5, 0.3, 5.0], [210.0, 0.1, 5.5]] }, // [time, amplitude, cycle]
];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const outSine = (x) => Math.sin((clamp01(x) * Math.PI) / 2);
const inOutSine = (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

/**
 * Full BREATH state at film time t.
 * @returns {{ value: number, unit: number, amp: number, peak: number, phase: 'inhale'|'exhale'|'rest' }}
 *   value = unit * amp (what to drive with), unit = the 0..1 curve, peak = the governing peak time.
 */
export function breathInfo(t) {
  const span = BREATH_SPANS.find((s) => t < s.to);
  if (span.peaks) {
    for (const [p, amp, cycle] of span.peaks) {
      const inh = 0.4 * cycle, exh = 0.6 * cycle;
      if (t < p - inh) return { value: 0, unit: 0, amp: 0, peak: p, phase: 'rest' };
      if (t < p) { const u = outSine((t - (p - inh)) / inh); return { value: u * amp, unit: u, amp, peak: p, phase: 'inhale' }; }
      if (t < p + exh) { const u = 1 - inOutSine((t - p) / exh); return { value: u * amp, unit: u, amp, peak: p, phase: 'exhale' }; }
    }
    const last = span.peaks[span.peaks.length - 1][0];
    return { value: 0, unit: 0, amp: 0, peak: last, phase: 'rest' };
  }
  const { period, inhale, exhale } = BREATH;
  const k = Math.floor((t - span.phase + inhale) / period);
  const peak = span.phase + k * period, d = t - peak;              // d in [-inhale, exhale)
  if (d < 0) { const u = outSine((d + inhale) / inhale); return { value: u, unit: u, amp: 1, peak, phase: 'inhale' }; }
  const u = 1 - inOutSine(d / exhale);
  return { value: u, unit: u, amp: 1, peak, phase: 'exhale' };
}
/** BREATH at film time t, 0..1 (amplitude included: S21/S22's breaths shrink). */
export const breath = (t) => breathInfo(t).value;

// ---- Palette (SCRIPT.md 3.0, W1-W6, 7.4) -------------------------------------------------------
// Display-referred sRGB hex. RESERVED: the wing blue and its shifts appear ONLY on wings, scales,
// scale dust, the speck and the last sheen over ink (S24). No sky, flower or light may use them.
export const PALETTE = {
  // reserved structural colour (THINFILM: normal incidence, off-normal, grazing)
  wingBlue: '#1F5BFF', wingCyan: '#19C8F0', wingViolet: '#6A3CFF',
  // the butterfly
  melanin: '#0D0C0E', fringe: '#F4F1EA', underside: '#8E867A', undersideRing: '#EDE6D6', body: '#2A2622',
  // ink: the five tones (墨分五色) and the paper
  jiao: '#0D0C0E', nong: '#1E1D21', zhong: '#3A393D', dan: '#77757A', qing: '#B9B5B0',
  paper: '#EFE8DA', paperShadow: '#D9D0BE', paperLit: '#F7F2E6', paperNight: '#8D887E',
  // colour entering the ink world (from S15)
  sunGold: '#FFB84D', asphaltGold: '#F2A65A', skySlot: '#F6C177', towerWash: '#5C6B8A', windowLight: '#FFD9A0',
  // SCALE (S03)
  scaleRoot: '#2A211C', lampKey: '#FFE2B0', dustVoid: '#050507',
  // GRASS, dawn
  dawnSkyLow: '#F7C99A', dawnSkyHigh: '#9CC7E8', sun: '#FFE2B0', grassLit: '#A9D65C', grassShadow: '#2F4A1E',
  dew: '#F2FBFF', buttercup: '#FFD23F', clover: '#E78AC3', daisy: '#FFF7E8', cornflower: '#7A6BE0', pupa: '#7FC8A0',
  // GRASS, rain
  rainSky: '#A7B4BE', inkCloud: '#1E1D21', wetLeaf: '#3E6B3A',
  // dusk (GRASS, FIELD)
  duskSky: '#2A2F55', duskHorizon: '#E0785A', duskGrass: '#3F5A2A', bokeh: '#FFD9A0',
  // FIELD, golden hour
  fieldSkyTop: '#1B2440', fieldSkyMid: '#C4553A', fieldHorizon: '#FFB25E', fieldGrassLit: '#E9B44C',
  fieldGrassShadow: '#2E3B1F', river: '#FFD08A', cityInk: '#3A393D', cityMist: '#D9D0BE', cityLights: '#FFD9A0',
  // text over picture (L1)
  cardText: '#F2EDE4',
};
/** The five ink tones, darkest first: density d (0 = bare paper, 1 = solid) and display colour. */
export const INK_TONES = [
  { key: 'jiao', zh: '焦', d: 0.95, hex: PALETTE.jiao },
  { key: 'nong', zh: '浓', d: 0.78, hex: PALETTE.nong },
  { key: 'zhong', zh: '重', d: 0.55, hex: PALETTE.zhong },
  { key: 'dan', zh: '淡', d: 0.30, hex: PALETTE.dan },
  { key: 'qing', zh: '清', d: 0.12, hex: PALETTE.qing },
];
/** '#RRGGBB' -> [r, g, b] display 0..1. */
export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
/** '#RRGGBB' -> [r, g, b] linear (for HDR scene colours). */
export const linear = (hex) => rgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));

// ---- LOOK: ink and chroma per shot (SCRIPT.md 7.3) ---------------------------------------------
// ink = post.ink.amount, chroma = post.ink.chroma. A two-element array [a, b] means a -> b across the
// shot (linear in shot-local time; re-time it in the shot file if the script ties it to an event,
// e.g. S15's chroma rises with the gold slit at 142.0). `pool` documents what the pool carries;
// positions and radii are the owning world's (it returns them from world.post().ink.pools).
export const LOOK = {
  S01: { ink: 1, chroma: 0 },
  S02: { ink: 1, chroma: 0, pool: { amount: 1, chroma: 1, what: 'the butterfly: blue soaks into glass, desk edge and shoulder; r 0 -> 0.09 -> 0.03' } },
  S03: { ink: 0, chroma: 1 },            // the scale field is its own black
  S04a: { ink: 1, chroma: 0 },
  S04b: { ink: 0, chroma: 1 },           // the SHEEN band carries ink 1 -> 0 and chroma 0 -> 1 across the frame
  S05: { ink: 0, chroma: 1 },
  S06: { ink: 0, chroma: 1 },
  S07: { ink: 0, chroma: 1, pool: { amount: 1, chroma: 0, what: 'the dew drop holding the ink city' } },
  S08: { ink: 1, chroma: 0, pool: { amount: 1, chroma: 1, what: 'the speck, r 0.012' } },
  S09: { ink: 1, chroma: 0, pool: { amount: 1, chroma: 1, what: 'the speck' } },
  S10: { ink: 1, chroma: 0, pool: { amount: 1, chroma: 1, what: 'the speck under one rim' } },
  S11: { ink: 1, chroma: 0, pool: { amount: 1, chroma: 1, what: 'the speck' } },
  S12: { ink: [0.2, 0.35], chroma: [1, 0.8] },
  S13: { ink: 0.35, chroma: 0.8 },
  S14: { ink: 1, chroma: 0.15, pool: { amount: 1, chroma: 1, what: 'the drop on the glass holding the colour meadow' } },
  S15: { ink: 0.9, chroma: [0, 0.3] },
  S16: { ink: 0.8, chroma: 0.45 },
  S17: { ink: 0.75, chroma: [0.5, 0.6] },
  S18: { ink: [0.7, 0.55], chroma: [0.6, 0.9] },
  S19: { ink: 0.55, chroma: 0.9 },
  S20: { ink: [0.5, 0.45], chroma: 1 },
  S21: { ink: 0.5, chroma: 0.9, pool: { amount: 1, chroma: 0, what: 'the butterfly while its wings are shut' } },
  S22: { ink: 0.5, chroma: 0.9, pool: { amount: 1, chroma: 0, what: "the walker's shadow (wet edge); also the shut butterfly" } },
  S23: { ink: 1, chroma: 0 },            // "paper": the PAPER world is the sheet; Group A tunes
  S24: { ink: 1, chroma: 0 },
};
/** Film grain in shots with ink above 0.7 (SCRIPT.md 7.1: the paper has its own tooth). */
export const INK_GRAIN = 0.015;
/** The LOOK of shot `id` as a keyframable post.ink block: { amount, chroma }. */
export function lookInk(id) {
  const L = LOOK[id];
  if (!L) throw new Error(`LOOK: no shot ${id}`);
  const k = (v) => (Array.isArray(v) ? { keys: [[0, v[0]], [1, v[1]]], ease: 'inOutSine' } : v);
  return { amount: k(L.ink), chroma: k(L.chroma) };
}
/** Largest ink amount of a shot (for the grain rule). */
export const lookInkMax = (id) => { const v = LOOK[id].ink; return Array.isArray(v) ? Math.max(...v) : v; };

// ---- The frame (= the picture: 18:9, no matte) -------------------------------------------------
export const FRAME = { aspect: 2, width: 2160, height: 1080 };
/** Kept for code that says "picture": in this film the picture IS the full frame. */
export const PICTURE = FRAME;

// ---- The S02 / S04 / S08 desk frame and its match into GRASS (X1, X3) ---------------------------
/** The desk lamp's shade (S02, S04a, S08) = the rising sun (S04b): screen position. */
export const LAMP_SUN = [0.62, 0.58];
/** The desk edge (INTERIOR) = the grass stem the pupa hangs from (S04b): frame y of the line. */
export const DESK_EDGE_Y = 0.34;
/** The hump of the sleeper's shoulders = the top of the pupa. */
export const SLEEPER_HUMP = [0.52, 0.56];
/** Where the butterfly sits on the glass in S02 (and where the raindrop is in S08): against the wall just in
 *  front of and above the sleeper's head and folded arms, clear of the silhouette (2026-10-04; was [0.38, 0.40],
 *  which lay over the head once the arms were folded under it), its open-wing pool reaching the arm and head. */
export const BUTTERFLY_ON_GLASS = [0.32, 0.585];
/** S02's colour pool around the butterfly: radius at full opening and after it closes. */
export const BUTTERFLY_POOL_R = { open: 0.09, closed: 0.03 };

/**
 * FINAL (INTERIOR group, 2026-10-03; sampled from lib/figure.js's `asleepAtDesk` silhouette at breath 0:
 * INTERIOR draws that figure, GRASS draws the pupa from these points). The sleeper's silhouette in the
 * S02/S04/S08 framing: a closed outline in screen coordinates, facing left: the hand and forearm lying
 * along the desk (the low slab at left, y ~0.40, from x 0.2465), the round head resting on it (top 0.5525
 * at x 0.395), a deep notch at the back of the neck (0.493 at x 0.449), the hump of the shoulders at
 * SLEEPER_HUMP, and the back sloping down to the desk edge line, which closes it. Points run left to
 * right, 31 of them, evenly spaced in x. (Re-sampled 2026-10-04 when the pose was redrawn for its
 * outline: head, arm on the desk and neck notch each readable in silhouette; hump and back unchanged.)
 */
export const SLEEPER_OUTLINE = [
  [0.2465, 0.3400], [0.2600, 0.3885], [0.2735, 0.4035], [0.2870, 0.4035], [0.3005, 0.4065], [0.3140, 0.4045],
  [0.3275, 0.4065], [0.3410, 0.4095], [0.3545, 0.4125], [0.3680, 0.5275], [0.3815, 0.5460], [0.3950, 0.5525],
  [0.4085, 0.5495], [0.4220, 0.5370], [0.4355, 0.5075], [0.4490, 0.4930], [0.4625, 0.5075], [0.4760, 0.5285],
  [0.4895, 0.5425], [0.5030, 0.5525], [0.5165, 0.5595], [0.5300, 0.5590], [0.5435, 0.5510], [0.5570, 0.5350],
  [0.5705, 0.5090], [0.5840, 0.4760], [0.5975, 0.4450], [0.6110, 0.4140], [0.6245, 0.3860], [0.6380, 0.3640],
  [0.6515, 0.3400],
];
/**
 * FINAL (INTERIOR). The desk frame in metres: the frame is `height` m tall at the sleeper's plane
 * (so 2 x that wide); the desk top, 0.74 m above the floor, is the DESK_EDGE_Y line; the sleeper's
 * feet (lib/figure.js origin, facing left) stand at frame x `feetX`. `lampR` is the lamp globe's
 * radius in frame widths (= a good radius for S04b's sun disc); the glass is at `glass` x the
 * camera-to-sleeper distance (the butterfly on it is that much larger than the room behind).
 */
export const DESK_FRAME = { height: 1.166, deskTop: 0.74, feetX: 0.4772, lampR: 0.028, glass: 0.5 };
/** BREATH lift of the shoulders: 1.2% of the frame height at the hump, fading to 0 at the desk. */
export const SLEEPER_BREATH_RISE = 0.012;
/** The outline at a breath value b (0..1): points near the hump rise, the desk line stays put.
 *  (y in frame heights, x in frame widths: the 7% hump width is horizontal.) */
export function sleeperOutline(b = 0) {
  return SLEEPER_OUTLINE.map(([x, y]) => {
    const w = Math.exp(-(((x - SLEEPER_HUMP[0]) / 0.07) ** 2)) * clamp01((y - DESK_EDGE_Y) / (SLEEPER_HUMP[1] - DESK_EDGE_Y));
    return [x, y + SLEEPER_BREATH_RISE * b * w];
  });
}

/**
 * FINAL (INTERIOR). THE SPECK: one grain of wing dust on the sleeper's left shoulder from 41.0 to the
 * end of S20. 2 to 3 px across at every shot scale, always the left shoulder, always wing blue;
 * in the ink shots it carries a colour pool of radius `poolR`. `desk` = where it rests in the
 * S04a/S08 frame while the sleeper lies still (on the crest of the hump, breath 0); lib/figure.js
 * draws it with `speck: 1` (and joints().speck gives the shoulder for other shots' pools).
 */
export const SPECK = { desk: [0.518, 0.557], sizePx: [2, 3], poolR: 0.012, colour: PALETTE.wingBlue, from: 41.0 };

// ---- X2: the dust at 40.0 (SCALE's last frame = INTERIOR's first S04a frame) -------------------
export const DUST = { seed: 'scale-dust-40', count: 36 };
/**
 * One seeded set of oval bokeh discs shared by SCALE (S03's end) and INTERIOR (S04a's start):
 * [{ x, y, r, phase }] in screen coordinates, r as a fraction of frame width (oval 1 : 1.5 tall),
 * phase 0..1 for the flash as it turns. Deterministic: always the same list.
 */
export function dustDiscs(count = DUST.count) {
  const rng = createRng(DUST.seed);
  return Array.from({ length: count }, () => ({ x: rng.range(0.06, 0.94), y: rng.range(0.1, 0.92), r: 0.006 + 0.024 * rng() ** 2, phase: rng() }));
}
/**
 * (B, SCALE.) Brightness 0..1 of the disc with `phase` at film time t: the slow turn of a grain in the
 * lamplight. SCALE's last frame uses it (r = the half-height of a 1 : 1.5 oval, as a fraction of frame
 * width; hue: lib/thinfilm.js thinFilmRampJS(1.05 - 0.14 * fract(phase * 7.31) ** 1.5), cyan .. violet).
 */
export const dustFlash = (phase, t) => 0.32 + 0.68 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (phase + 0.22 * (t - 40))));

// ---- X5: the seven strap-hangers (S11) = the seven roosting butterflies (S12) -------------------
/**
 * FINAL (INTERIOR, 2026-10-03). Same positions, same sway. x of each hanging point (left to right);
 * `railY` = the height of the hanging points: the rings the seven hold (INTERIOR draws its rail 3%
 * higher, with straps) = the underside of the dock leaf; `length` = the hanging length as a
 * fraction of frame height: in S11 the seven stand against the far windows' light from the ring down
 * to the sill at railY - length = 0.62 (below it wall, bench and floor are dark: their legs go on
 * down to the floor at 0.33 but hardly show), so each is a dark shape 0.24 tall and about 0.07 of
 * the frame width wide, bowed head uppermost;
 * `hero` = the hero's index (third from the right). The seven face screen left.
 */
export const SEVEN = { x: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], railY: 0.86, length: 0.24, hero: 4 };
/**
 * The one sway (FINAL): degrees from vertical of hanger i at time t (positive = the lower end swings
 * to screen right), about the hanging point. A travelling wave of period 2 s, left to right, 0.25 s
 * between neighbours, 3°; at 113.5 all seven lean left together (-6°), carried over the match cut,
 * recovered by 115.6.
 */
export function sway(t, i) {
  const wave = 3.0 * Math.sin((2 * Math.PI * (t - 0.25 * i)) / 2.0);
  const lean = -6 * smooth((t - 113.5) / 0.45) * (1 - smooth((t - 114.4) / 1.2));
  return wave + lean;
}

// ---- X8: the hero's umbrella at the top of the stairs (S16) = one disc of the crossing (S17) -----
/**
 * FINAL (INTERIOR; CITY matches it at 152.0; revised in the final pass after REVIEW.md item 6).
 * Where the hero's umbrella stands open, as a full black disc seen along its shaft, from 151.17 to the
 * cut at 152.0, and its diameter in frame widths: 0.075 (15% of the frame height), so that the match
 * can be seen. S17 opens on that one disc (S17_CROSSING.width.open follows from it) and pulls wide.
 */
export const S16_UMBRELLA = { hero: [0.5, 0.72], diameter: 0.075, opens: [148, 149, 150, 151] };

// ---- S17 / S18: the crossing (CITY; worlds/city/choreo.js turns these into the walk and the camera) --
/**
 * FINAL (CITY). The hero on the crossing, in metres about the point where they stop (screen right
 * = +x, screen up = -z), seen straight down from `camHeight`. The frame opens at 152.0 on the hero's
 * umbrella alone, at S16_UMBRELLA's place and size (the X8 match: `width.open` m of ground), pulls out
 * to `width.reveal` m (one umbrella among thousands), and after the hero stops (`stop`) comes in to
 * `width.close` m by 158.2, the hero at its centre, for the fold, the face (`faceUp`) and the first
 * wings; then out to `width.wide` m by 168.0. `firstWing`: where the first umbrella to open stands at
 * SYNC.firstWing. The ring leaves it slowly (the six or eight around it at 162.4;
 * worlds/city/choreo.js RING_KNOTS) and from 60 m out travels at `ringSpeed` m/s. From 160.0 the
 * walkers nearest the hero come to rest; further out they slow to a crawl until their own umbrella
 * leaves.
 */
export const S17_CROSSING = {
  camHeight: 120, width: { open: 1.1 / S16_UMBRELLA.diameter, reveal: 110, close: 30, wide: 300 },
  stop: 155.0, faceUp: 160.0, firstWing: [1.6, 0.0], ringSpeed: 30,
};

// ---- The hero blade (GRASS S07, S21, S22; PAPER S23, S24) --------------------------------------
/**
 * GRASS's values are FINAL (B, 2026-10-03); PAPER draws the same curve (the S07 bow, the S21 bow and
 * the S23 rest all come from here). Length 22 cm (shortened from 34 so that the butterfly reads in the
 * locked S21 frame; width scaled with it, so width / length is unchanged for PAPER's stroke; GRASS draws
 * its own blade 0.55 cm wide), bows 38° at the tip under 0.5 g. `restAngle` is the unloaded blade's angle from
 * horizontal, leaning right; deflection is measured at the tip, positive = bowed down under load.
 * Screen placement for the locked S21/S22/S23 framing: `root` (just below the frame) and the
 * straight blade's length as a fraction of frame height. In S21 the butterfly sits at REST_POINT.
 */
export const HERO_BLADE = {
  length: 22, width: 0.356, restAngle: 66, bow: 38, load: 0.5,
  root: [0.27, 0.0], lengthFrac: 0.95,       // root at the bottom edge; REST_POINT lies at s = 0.85 when bowed 38°
  spring: { halfPeriod: 0.6, decay: 0.5 },   // s between opposite extremes; amplitude ratio per half period
};
/** Where the butterfly sleeps in S21/S22, and the centre the black is diluted from in S23. */
export const REST_POINT = [0.56, 0.54];
/** Static tip deflection (degrees) under a load in grams. */
export const bladeBow = (grams) => HERO_BLADE.bow * (grams / HERO_BLADE.load);
/**
 * The blade's spring, closed form: tip deflection (degrees) at time t after release at t0 from
 * deflection d0 (a damped cosine with HERO_BLADE.spring). Optional restBy: eased to exactly 0 by then.
 */
export function bladeSpring(t, t0, d0, restBy = Infinity) {
  if (t < t0) return d0;
  const { halfPeriod, decay } = HERO_BLADE.spring, tau = t - t0;
  const v = d0 * Math.exp((Math.log(decay) / halfPeriod) * tau) * Math.cos((Math.PI * tau) / halfPeriod);
  return Number.isFinite(restBy) ? v * (1 - smooth((t - (restBy - 0.7)) / 0.7)) : v;
}
/** S07: the butterfly leaves at 80.5 and the blade springs up from its 0.5 g bow. */
export const S07_SPRING = { t0: 80.5, d0: bladeBow(0.5) };
/** S23: swinging when the wash clears: +14° at 218.6, -7° at 219.2, +3.5° at 219.8, at rest by 220.5. */
export const S23_SPRING = { t0: 218.0, d0: -28, restBy: 220.5 };
/**
 * A point on the blade: s 0..1 from root to tip, tip deflection in degrees. Returns [x, y] in cm in
 * the blade's plane (x right, y up, root at the origin). The bend grows toward the tip (a cantilever
 * under a tip load: the local angle drops by deflection * (2s - s^2)).
 */
export function bladePoint(s, deflection = 0, steps = 24) {
  let x = 0, y = 0;
  const n = Math.max(1, Math.round(steps * s)), ds = (s * HERO_BLADE.length) / n;
  for (let i = 0; i < n; i++) {
    const u = ((i + 0.5) / n) * s;
    const a = ((HERO_BLADE.restAngle - deflection * (2 * u - u * u)) * Math.PI) / 180;
    x += Math.cos(a) * ds; y += Math.sin(a) * ds;
  }
  return [x, y];
}
/** The same point in screen coordinates for the S21/S23 framing. */
export function bladeScreen(s, deflection = 0) {
  const [x, y] = bladePoint(s, deflection);
  const k = HERO_BLADE.lengthFrac / HERO_BLADE.length;               // frame heights per cm
  return [HERO_BLADE.root[0] + (x * k) / FRAME.aspect, HERO_BLADE.root[1] + y * k];
}
