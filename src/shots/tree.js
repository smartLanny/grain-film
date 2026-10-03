// Shots and cards owned by the TREE group: growth, recognition and the flight home
// (S17, S18, S19, S20). Ids, times and worlds are fixed by docs/story.md.
//
// All choreography lives here as pure functions of film time t; the worlds only draw.
import { SHOT, MASTER_CAMERA_18X9, SEED_SPOT, year } from '../lib/story.js';
import { TREE_ENVELOPE, TREE_UNIT, masterAngles } from '../lib/tree.js';
import { storyCard } from './_card.js';

const shot = (id, world, rest = {}) => ({ id, start: SHOT[id][0], end: SHOT[id][1], world, ...rest });
const master = MASTER_CAMERA_18X9;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => clamp01((t - a) / (b - a));

// ---- S17: nine years ------------------------------------------------------------------------------
// The year turns once every PERIOD seconds: it spins up over 162.2-162.8, runs steadily, and eases to
// rest over 175-177. Exactly nine turns, so the shot begins and ends in the same late summer (season
// 0.64) with the sun in the same place: low in the west behind the seedling (the dawn-lit backplate
// S16 racks focus to), and nine years later behind the crown.
const TURNS = 9, REST_SEASON = 0.64, SPIN = [162.2, 162.8], SETTLE = [175, 177];
const PERIOD = ((SPIN[1] - SPIN[0]) * 0.5 + (SETTLE[0] - SPIN[1]) + (SETTLE[1] - SETTLE[0]) * 0.5) / TURNS; // 1.5 s
function treeSeason(t) {
  if (t >= SETTLE[1]) return REST_SEASON;
  let sec; // seconds-at-full-speed still to run
  const tail = SETTLE[1] - SETTLE[0];
  if (t >= SETTLE[0]) { const x = (t - SETTLE[0]) / tail; sec = tail * (0.5 - x + x ** 3 - 0.5 * x ** 4); }
  else {
    sec = tail * 0.5 + (SETTLE[0] - Math.max(t, SPIN[1]));
    if (t < SPIN[1]) { const x = seg(t, SPIN[0], SPIN[1]); sec += (SPIN[1] - SPIN[0]) * (0.5 - x ** 3 + 0.5 * x ** 4); }
  }
  return REST_SEASON - sec / PERIOD;
}
// the story clock eases in and out (year(t)); the tree gets going a little sooner than the years do
const growth = (t) => Math.pow(clamp01((year(t) - 9900) / 100), 0.62);

// Light. The shot opens and closes with the sun at rest low in the west (behind the seedling, then
// behind the crown, just under the place of the old summit). Between, through the nine years, it
// stands to the south (camera left): higher in summer, lower in winter, swinging a little with each
// year, so the tree's shadow rocks across the meadow like the hand of a sundial and the picture is
// never lit from the front one moment and from behind the next. Everything eases; nothing steps.
const SUN_REST = masterAngles(TREE_ENVELOPE.sxTop, 0.705);   // [elevation, azimuth]
const side = (t) => smooth(seg(t, 162.2, 165.0)) * (1 - smooth(seg(t, 173.4, 177)));   // 0 at rest, 1 in the time-lapse
const yearAngle = (t) => 2 * Math.PI * treeSeason(t);
const sunAzimuth = (t) => lerp(SUN_REST[1], -96 + 24 * Math.sin(yearAngle(t)), side(t));
const sunElevation = (t) => {
  if (t >= 180) return SUN_REST[0] - 0.5 * seg(t, 180, 202);                   // S18, S19: it sinks a hair
  return lerp(SUN_REST[0], 28 - 7 * Math.cos(yearAngle(t)), side(t));
};
// Snow. On the mountain the snowline breathes with the year. On the valley floor the landscape lays
// snow as the snowline passes from about +0.6 down to -0.8 (measured), so it is led through exactly
// that band at an even pace: a fifth of a year in, a fifth out (nine frames each at 1.5 s per year)
// instead of dropping through it in one frame.
const wrapped = (t) => { const s = treeSeason(t), f = s - Math.floor(s); return f < 0.5 ? f + 1 : f; };   // 0.5 .. 1.5, winter in the middle
const floorRamp = (t) => { const w = wrapped(t); return seg(w, 0.84, 1.05) * (1 - seg(w, 1.08, 1.30)); };
const floorSnow = (t) => smooth(floorRamp(t));
const snowline = (t) => {
  const w = wrapped(t);
  const slopes = 13.2 - 7.9 * (0.5 + 0.5 * Math.cos(2 * Math.PI * w));          // the mountain's own winter
  const near = smooth(seg(w, 0.66, 0.84)) * (1 - smooth(seg(w, 1.30, 1.48)));  // snow creeping down to the foot
  return lerp(lerp(slopes, 0.7, near), -0.9, floorRamp(t));
};
// Exposure: daylight in the time-lapse, held down as the snow brightens the frame; into the sun at
// either end (S16's high-key dawn at the head, the dusk of S18 at the tail).
const exposure17 = (t) => lerp(t < 170 ? -1.15 : -1.6, -0.2 - 0.75 * floorSnow(t), side(t));

// Act III grade: golden hour. Warm highlights, deep green-black shadows, soft contrast, glowing air.
const DAY = {
  exposure: -0.15, temperature: 0.04, tintGM: 0, contrast: 1.06, saturation: 1.08, gamma: [1, 1, 1],
  splitShadows: [0.30, 0.52, 0.40], splitHighlights: [1.0, 0.74, 0.42], splitAmount: 0.1,
  lift: [0.012, 0.012, 0.016], bloom: 0.06, bloomScatter: 0.68, halation: 0.14, vignette: 0.32,
};
const GOLD = {
  exposure: -2.05, temperature: 0.22, tintGM: 0.04, contrast: 1.1, saturation: 1.12, gamma: [1.1, 1.1, 1.08],
  splitShadows: [0.30, 0.52, 0.40], splitHighlights: [1.0, 0.74, 0.42], splitAmount: 0.28,
  lift: [0.008, 0.012, 0.01], bloom: 0.085, bloomScatter: 0.74, halation: 0.2, vignette: 0.38,
};
// S17 opens in S16's warm low light, runs through the time-lapse's daylight, and settles into the
// dusk of S18 as the years come to rest
const dusk = (t) => Math.max(smooth(seg(t, 174.2, 177.3)), 0.7 * (1 - smooth(seg(t, 162.2, 164))));
const mixv = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], k)) : lerp(a, b, k));
const settling = Object.fromEntries(Object.keys(GOLD).map((key) => [key, (l, t) => {
  const day = key === 'exposure' ? exposure17(t) : DAY[key];
  return mixv(day, GOLD[key], dusk(t));
}]));

const LINE = [181.5, 184.0, 187.0, 189.0]; // gust, complete (music sync, frame-exact), hold until, gone by

// Clouds: streaming and smeared in the time-lapse, slowing to real time by 177.5. The landscape wants
// the distance travelled, so the speed is integrated here (pure: a fixed-step sum from the shot's start).
const cloudSpeed = (t) => lerp(1.2, lerp(70, 1.2, smooth(seg(t, 173.5, 177.5))), smooth(seg(t, SPIN[0], SPIN[1] + 0.6)));
const cloudPhase = (t) => {
  let p = 0;
  for (let x = 162; x < t; x += 0.025) { const h = Math.min(0.025, t - x); p += cloudSpeed(x + h / 2) * h; }
  return p;
};
const landDay = {
  sunElevation: (l, t) => sunElevation(t),
  sunAzimuth: (l, t) => sunAzimuth(t),
  season: (l, t) => { const s = treeSeason(t); return s - Math.floor(s); },
  snowline: (l, t) => (t < 180 ? snowline(t) : 13.2),
  cloudCover: (l, t) => lerp(0.42, 0.22, smooth(seg(t, 172, 178))),
  cloudPhase: (l, t) => cloudPhase(t),
  cloudStreak: (l, t) => 0.9 * clamp01((cloudSpeed(t) - 1.2) / 30),
  fog: (l, t) => lerp(0.35, 0.22, smooth(seg(t, 174.2, 177.3))) + 0.3 * (1 - smooth(seg(t, 162.2, 164))),
  night: 0, starVisibility: 0,
};

// ---- S19: up through the crown (metres from the base of the trunk -> W2 units) -----------------------
const m2w = (p) => [SEED_SPOT[0] + p[0] * TREE_UNIT, SEED_SPOT[1] + p[1] * TREE_UNIT, SEED_SPOT[2] + p[2] * TREE_UNIT];
// A slow rise of six and a half metres: it starts in the opening the resting sun shines through, so
// the sun is the subject from the first frame, and ends just clear of the top of the crown.
const S19_PATH = [[2.3, 24.3, 6.0], [2.38, 25.9, 5.4], [2.47, 27.7, 4.55], [2.55, 29.4, 3.6], [2.6, 30.7, 2.8]];
const S19_LOOK = [[2.55, 27.4, -7], [2.65, 29.2, -7.6], [2.78, 31.2, -8.3], [2.9, 33.0, -9], [3.0, 34.4, -9.6]];

// ---- S20: the flight home --------------------------------------------------------------------------
// Begins in the pose S19 ended on (above the crown, looking up and west), later the same evening;
// then away up the valley with the seeds, climbing, and at last tilting up until only sky is left.
const S19_END = m2w(S19_PATH[S19_PATH.length - 1]);
const flightPos = (l, t) => {
  const s = Math.max(0, t - SHOT.S20[0]);
  return [S19_END[0] - 0.05 * smooth(s / 10), S19_END[1] + 5.7 * smooth(s / 10.5) + 0.1 * Math.max(0, s - 10.5), S19_END[2] - 0.275 * s * s];
};
const flightRot = { time: 'seconds', ease: 'inOutSine', keys: [[0, [16.6, -1.85, 0]], [3.6, [-8, 1, 0]], [6.6, [-5.5, 0.3, 0]], [7.9, [-1, 0, 0]], [8.9, [16, 0, 0]], [10.0, [29, 0, 0]], [11.8, [38, 0, 0]]] };

export const shots = [
  shot('S17', 'meadow', {
    camera: master,
    params: {
      land: landDay,
      grass: 1,
      treeGrowth: (l, t) => growth(t),
      treeSeason: (l, t) => treeSeason(t),
      // by day the crown is loose and lobed; it fills out to the old skyline only as the light goes gold
      treeLoose: (l, t) => 1 - smooth(seg(t, 173.4, 177)),
      wind: (l, t) => 0.3 * smooth(seg(t, 176, 179.5)),
      shafts: (l, t) => 0.85 * smooth(seg(t, 175.2, 178)),
      tufts: (l, t) => smooth(seg(t, 177.5, 180)),
      witness: (l, t) => smooth(seg(t, 177.6, 178.3)),
      witnessX: (l, t) => lerp(8.2, 2.6, 1 - Math.pow(1 - seg(t, 177.6, 180.9), 1.6)),
      witnessWalk: (l, t) => 1 - smooth(seg(t, 180.2, 181)),
      lantern: (l, t) => smooth(seg(t, 177.6, 179)),
    },
    post: settling,
    shutter: 1,   // time-lapse: every frame integrates its whole interval (with --samples)
  }),
  shot('S18', 'meadow', {
    camera: master,
    params: {
      land: landDay,
      grass: 1, treeGrowth: 1, treeSeason: REST_SEASON,
      wind: { time: 'absolute', ease: 'inOutSine', keys: [[180, 0.3], [181.4, 0.32], [182.1, 0.8], [184, 0.55], [189, 0.5], [194, 0.6]] },
      shafts: 0.85, tufts: 1, release: [187.2, 214],
      line: LINE, lineGain: 6.5,
      witness: 1, lantern: 1,
      witnessX: (l, t) => lerp(8.2, 2.6, 1 - Math.pow(1 - seg(t, 177.6, 180.9), 1.6)),
      witnessWalk: (l, t) => 1 - smooth(seg(t, 180.2, 181)),
    },
    post: GOLD,
  }),
  shot('S19', 'canopy', {
    camera: {
      path: S19_PATH.map(m2w), target: S19_LOOK.map(m2w),
      ease: 'inOutSine', lens: 28, near: 0.0006, far: 2000,
    },
    params: {
      land: landDay,
      wind: { keys: [[0, 0.3], [1, 0.45]] },
      release: [SHOT.S19[0] - 5, SHOT.S19[1] + 6], tuftGain: 1.5, clear: 4.4,
      focus: { keys: [[0, 9], [0.7, 12], [1, 15]] },
    },
    post: { ...GOLD, exposure: -1.9, dof: { focus: { keys: [[0, 0.09], [0.7, 0.12], [1, 0.15]] }, aperture: { keys: [[0, 0.8], [0.62, 0.8], [0.8, 0.12]] }, maxBlur: 14 } },
    shutter: 0.9,
  }),
  shot('S20', 'meadow', {
    camera: { position: flightPos, rotation: flightRot, lens: { time: 'seconds', ease: 'inOutSine', keys: [[0, 28], [3, 24]] }, near: 0.004, far: 2500 },
    params: {
      land: {
        year: 10000,
        sunElevation: { time: 'seconds', keys: [[0, -2.2], [4, -8], [7, -16], [10, -22]] },
        // lifted for the moonlit valley, then taken right down as the land leaves the frame, so the sky
        // that is left is the prologue's blue-black and not a navy night
        exposure: { time: 'seconds', ease: 'inOutSine', keys: [[3, 0], [6.6, 1.1], [7.3, 1.1], [8.8, -3.2]] },
        sunAzimuth: SUN_REST[1] + 14,
        season: 0.7, cloudCover: { time: 'seconds', keys: [[0, 0.18], [5, 0.12], [8.5, 0]] }, cloudPhase: (l, t) => cloudPhase(t), fog: 0.4,
        night: { time: 'seconds', keys: [[0, 0.12], [5, 0.9], [7, 1]] },
        starVisibility: { time: 'seconds', ease: 'inOutSine', keys: [[2.6, 0], [9, 1]] },
        moonElevation: 38, moonAzimuth: -62,
      },
      treeGrowth: 1, treeSeason: REST_SEASON, wind: 0.7, shafts: 0, tufts: 1, release: [187.2, 214],
      witness: 1, lantern: 1, witnessX: 2.6, witnessWalk: 0,
      flight: { time: 'seconds', keys: [[0, 0.75], [4, 1], [8, 1], [10.5, 0.62]] },
      snow: { time: 'seconds', ease: 'inOutSine', keys: [[6, 0], [10, 0.7]] },
      night: { time: 'seconds', keys: [[0, 0.12], [5, 0.9], [7, 1]] },
      flightFocus: 0.3, flightBokeh: 7,
    },
    post: {
      exposure: { time: 'seconds', keys: [[0, -0.6], [10, 0]] }, bloom: 0.07,
      // the coda cools to moonlit blue; the last second settles on the prologue's blue-black (#050A18)
      temperature: { time: 'seconds', keys: [[0, 0.12], [6, -0.2]] },
      saturation: { time: 'seconds', keys: [[0, 1.04], [4, 1.0], [7, 0.86]] },
      tint: { time: 'seconds', keys: [[3, [1, 1, 1]], [7, [0.8, 0.9, 1.14]]] },
      lift: { time: 'seconds', keys: [[0, [0.012, 0.012, 0.016]], [7.2, [0.012, 0.012, 0.016]], [8.8, [0.036, 0.05, 0.086]]] },
    },
  }),
];

export const cards = [
  storyCard('C5', 185.5, 192, '它等的，是一座山。', 'It was waiting for a mountain.'),
];
