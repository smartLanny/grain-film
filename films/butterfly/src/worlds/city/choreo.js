// CITY choreography that both the world and the shot list need: pure numbers, pure functions of
// film time; imports only lib/story.js (so src/shots/city.js can use it without loading the world).
import { S16_UMBRELLA, S17_CROSSING } from '../../lib/story.js';

/** S15's station on the scroll: the open reach of the river, further along the same handscroll. */
export const STATION_B = -2.6;

/**
 * S01's scroll: the camera's x on the paper (frame heights) at film time t. The handscroll is read
 * right to left; it moves fastest under the black and comes to rest at 13.0 on x = 0, the tower
 * with the bright window.
 */
export function scrollS01(t) {
  const D = 0.62, T = 13.0;
  const u = Math.min(1, Math.max(0, t / T));
  return D * Math.pow(1 - u, 2.6);
}
/** ink.paperScroll (frame widths) of S01 at film time t, for a 2:1 frame. */
export const paperScrollS01 = (t, aspect = 2) => [scrollS01(t) / aspect, 0];

// ---- the crossing (S17, S18) -----------------------------------------------------------------------
/**
 * The crossing's numbers. World: metres, the hero stops at the origin; screen right = +x, up = -z.
 *   P, Q      lane pitch and the spacing of walkers along a lane (the weave's lattice), m
 *   V         walking speed, m per second of the walk clock
 *   CAM_H     the camera's height: straight down from 120 m; the framing is a zoom
 *   STOP      the hero comes to rest at 155.0, having slowed from 154.2
 *   FOLD      the umbrella folds (story.SYNC.fold);  FACE_UP: the face tips up
 *   NEIGHBOUR where the umbrella that will be the first pair of wings stands at 162.0: 1.6 m to the
 *             hero's right
 *   UMBRELLA_OFFSET  the hero's canopy relative to the hero (held to the right: the left shoulder,
 *             and the speck on it, show at the rim)
 *   MATCH     X8: the hero's umbrella at 152.0 on screen (= story.S16_UMBRELLA.hero), in a frame
 *             120 m wide, so 1.1 m is story.S16_UMBRELLA.diameter of the frame width
 */
export const CROSSING = {
  P: 1.4, Q: 2.8, V: 1.3, CAM_H: S17_CROSSING.camHeight,
  STOP: S17_CROSSING.stop, FACE_UP: S17_CROSSING.faceUp,
  NEIGHBOUR: S17_CROSSING.firstWing,
  UMBRELLA_OFFSET: [-0.36, 0.08],
  MATCH: S16_UMBRELLA.hero,
  WIDTH: S17_CROSSING.width,
  RING_SPEED: S17_CROSSING.ringSpeed,
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const inOutSine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
const outCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);

/**
 * The crowd's walk clock (s): time runs at 1.25x at 152.0, easing to 1.0x by 160.0 (SCRIPT.md S17).
 * The integral of that rate, in closed form.
 */
export function walkClock(t) {
  const u = t - 152;
  if (u <= 0) return 1.25 * u;
  if (u >= 8) return 9 + (u - 8);
  return 1.25 * u - (0.25 / 16) * u * u;
}
/** The hero's z (m) at film time t: in step with the weave until 154.2, at rest on 0 from 155.0. */
export function heroZ(t) {
  if (t >= CROSSING.STOP) return 0;
  if (t <= 154.2) return -0.614 + CROSSING.V * (walkClock(t) - walkClock(154.2));
  const u = (t - 154.2) / 0.8;
  return -0.614 * (1 - u) * (1 - u);
}
// monotone cubic interpolation (Fritsch-Carlson) through keys [[t, v], ...]: eased, never overshooting,
// flat wherever two neighbouring keys are equal
function pchip(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(keys[i + 1][0] - keys[i][0]); d.push((keys[i + 1][1] - keys[i][1]) / h[i]); }
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] > 0) { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const u = (t - keys[i][0]) / h[i], u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * keys[i][1] + (u3 - 2 * u2 + u) * h[i] * m[i] + (-2 * u3 + 3 * u2) * keys[i + 1][1] + (u3 - u2) * h[i] * m[i + 1];
}
/**
 * The frame's width on the ground (m) through S17 and S18, eased in the logarithm (a zoom is felt in
 * ratios). 152.0: on the hero's umbrella at S16's size, held 13 frames (the match). 154.4: the reveal.
 * 158.2: close on the hero, for the fold, the face and the first wings; a 2% creep keeps the held
 * frame alive: it holds through the first wings and the first faces tipped up. Then S18's pull-back:
 * 60 m at 163.9, 120 at 164.8, 220 at 166.5, 300 by 168.0.
 */
function widthKeys() {
  const W = CROSSING.WIDTH, L = Math.log;
  return [[152.0, L(W.open)], [152.45, L(W.open)], [154.4, L(W.reveal)], [155.6, L(W.reveal * 0.945)], [158.2, L(W.close)], [163.0, L(W.close * 0.98)],
    [163.9, L(60)], [164.8, L(120)], [166.5, L(220)], [168.0, L(W.wide)], [171.0, L(W.wide)]];
}

/**
 * THE RING (S18). When the wave reaches radius r (m from the hero): piecewise linear through
 * [radius, film time]. The first umbrella (1.6 m to the hero's right) opens alone at SYNC.firstWing;
 * the six or eight around it follow at 162.4; the ring then gathers speed while the frame is still
 * close enough to see what it is made of, and from 60 m out it travels at story's ringSpeed (30 m/s).
 */
export const RING_KNOTS = [[S17_CROSSING.firstWing[0], 162.0], [2.5, 162.4], [9, 163.0], [34, 164.5], [60, 165.5]];
/** The ring as zones of constant speed, for the flock's law start = t0 + r / speed: [{ r0, r1, speed, t0 }]. */
export function ringZones() {
  const K = RING_KNOTS, z = [];
  for (let i = 0; i < K.length; i++) {
    const last = i === K.length - 1;
    const speed = last ? S17_CROSSING.ringSpeed : (K[i + 1][0] - K[i][0]) / (K[i + 1][1] - K[i][1]);
    z.push({ r0: i === 0 ? 0 : K[i][0], r1: last ? Infinity : K[i + 1][0], speed, t0: K[i][1] - K[i][0] / speed });
  }
  return z;
}
/** Film time at which the ring reaches radius r (m). */
export function ringArrival(r) {
  const z = ringZones().find((q) => r < q.r1);
  return z.t0 + r / z.speed;
}
/** Radius of the ring (m) at film time t. */
export function ringRadius(t) {
  let r = 0;
  for (const z of ringZones()) { const q = (t - z.t0) * z.speed; if (q >= z.r0) r = Math.min(q, z.r1); }
  return r;
}
/**
 * The held breath (S17): the face tips up at 160.0 and the walkers nearest the hero come to rest, a
 * ripple that leaves the hero at 80 m/s; a walker at radius r begins to slow at stillAt(r) and has
 * reached crawlAt(r) of its pace STILL_D seconds later: nothing within 5 m moves; from there the
 * streams slow to a crawl (a fifth of their pace by 13 m) until their own umbrella leaves. So only the
 * centre is still, and the frame is breathing when the first umbrella opens.
 */
export const STILL_D = 0.6;
export const stillAt = (r) => 160.0 + r / 80;
export const crawlAt = (r) => { const u = clamp01((r - 5) / 8); return 0.2 * u * u * (3 - 2 * u); };

/**
 * The camera of S17 and S18: straight down from CAM_H, no rotation. Returns the point on the ground
 * under the lens (x, z), the width of ground the frame holds, and three's vertical fov (degrees).
 * It opens with the hero's canopy at S16's place (MATCH), follows the hero, and by 154.5 has the hero
 * at the centre of the frame, where they stay; while the frame is held close it drifts by a hundredth
 * of its width.
 */
export function crossingCamera(t, aspect = 2) {
  const width = Math.exp(pchip(widthKeys(), t));
  const k = inOutSine((t - 152.45) / 2.0);                          // 0: the canopy at MATCH .. 1: the hero at the centre
  const hz = heroZ(t);
  const tx = CROSSING.UMBRELLA_OFFSET[0] * (1 - k), tz = hz + CROSSING.UMBRELLA_OFFSET[1] * (1 - k);
  const lift = 1 - (2.06 * (1 - k)) / CROSSING.CAM_H;               // the canopy stands 2 m nearer the lens than the road
  const sx = (CROSSING.MATCH[0] - 0.5) * (1 - k), sy = (CROSSING.MATCH[1] - 0.5) * (1 - k);
  let x = tx - sx * width * lift, z = tz + sy * (width / aspect) * lift;
  const d = clamp01((t - 158.0) / 1.5) * (1 - clamp01((t - 162.8) / 1.2));
  const dk = d * d * (3 - 2 * d);
  x += 0.012 * width * dk * Math.sin(0.45 * (t - 158.0));
  z += 0.008 * width * dk * (1 - Math.cos(0.37 * (t - 158.0)));
  const fovH = 2 * Math.atan(width / 2 / CROSSING.CAM_H);
  const fov = (2 * Math.atan(Math.tan(fovH / 2) / aspect) * 180) / Math.PI;
  return { x, z, width, fov };
}
