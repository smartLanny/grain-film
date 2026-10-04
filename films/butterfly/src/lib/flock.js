// FLOCK (SCRIPT.md 3.0): up to 48,000 umbrellas that become butterflies, closed-form in t.
// Owner: Group A. One instanced draw; every position, shape and colour is a pure function of film
// time on the GPU (no integration, no state from the previous frame; frames render in any order).
//
//   import { createFlock } from '../lib/flock.js';
//   const f = createFlock({ count: 40000, seed: 'crossing', positions, velocities });
//   scene.add(f.mesh);
//   scene.add(f.shadow);       // optional
//   f.set({ morphWave: { centre: [0, 0], t0: 162.0, speed: 30 }, rise: 9, goal: [0, 300, -400], flow: 0.6, scale: 10, shadow: { ground: 0 } });
//   f.update(t);               // after set(): update runs the per-instance pass before your scene is drawn
//
// createFlock({ count, seed, positions?, radius?, velocities?, openAt?, foldAt? })
//     -> { mesh, shadow, count, set(state), setPositions(arr), update(t), dispose() }
//   mesh        THREE.Mesh (instanced, one draw call, premultiplied blending, writes depth) in METRES,
//               y up. The host may set mesh.scale (FIELD uses 0.01): metres are derived from the model
//               matrix. Instance i stands at its ground position with the canopy rim at 1.9 m.
//   shadow      optional second THREE.Mesh (one more instanced draw): each butterfly's own shadow on a ground
//               plane. Add it to your scene under the flock; it is invisible until set({ shadow }).
//   positions   Float32Array [x0, z0, x1, z1, ...] (m). Default: seeded uniformly in a disc of `radius` (150).
//   velocities  Float32Array [vx0, vz0, ...] m/s on the walk clock (default 0).
//   openAt      Float32Array, film seconds: before it the umbrella is a closed line (held tilted toward
//               its velocity); at openAt it fans into the disc in 5 frames. Default: always open.
//   foldAt      Float32Array, film seconds: disc -> line (5 frames) -> gone (3 frames). Default: never.
//               An umbrella that folds before the ring reaches it never morphs.
//   set(state)  any subset; persists:
//     morphWave  { centre: [x, z], t0, speed: 30, jitter: 0.03 } | null   the ring: instance i begins its
//                0.8 s morph at t0 + |ground - centre| / speed (+ a seeded 0..jitter s); it leaves the
//                ground FLOCK_TIMING.lift s later
//     rise       climb speed after the morph, m/s (9): a widening spiral
//     goal       [x, y, z] (m) where the river flows to: each instance has its own place in a cloud around
//                it (spread: [horizontal, vertical] half-extents, m; [14, 7]), brakes as it arrives and
//                mills about there. Put the goal behind the lens and the flock passes through it.
//     flow       0..1 how much of the path turns from the spiral into the river toward goal
//     scale      legibility scale of the butterfly (10 = wingspan 0.7 m); the umbrella is always 1.1 m.
//                15.7 is the umbrella's own span.
//     walk       the crowd's walk clock (s): ground = positions + velocities * walk; an instance stops
//                when its morph starts.  walkRate (1): d(walk)/dt while the wave runs (so it stops exactly)
//     lean       radians: umbrellas bowed into the rain, toward their velocity
//     river      { from, to, width, height: [lo, hi], speed, meander: 1, bend: [0, 0], taper } | null   all
//                instances airborne as a river along from -> to, wrapping, faded at both ends, densest in
//                the core. `width` spreads across the line, `height` above it (for a vertical line: along
//                z, so use e.g. [-8, 8]). `bend` [across, up] (m at `to`) curves the line away with the
//                square of the distance; `taper` (m; default 0.35 x the length; 0 = off) thins the river
//                with distance from the lens, so that seen end-on it does not ball up at its vanishing
//                point. Keep `speed` within a few m/s of a camera that flies inside it.
//     shadow     { ground: y, dir: [x, z]?, strength: 0.5, soft: 1, color: [r,g,b]? } | null   the shadow mesh:
//                each butterfly's planform thrown onto the plane y = ground along the light (dir = ground
//                metres per metre of height; default: from `sun`), softer, smaller in its core and fainter
//                as its owner climbs. It begins when the lobes part (the umbrella's shadow is the host's).
//     clear      metres (1.5): nothing is nearer the lens than this. Flying instances go one by one, each at
//                its own distance between clear and 2 x clear (the flock thins toward the lens; it does
//                not stand there as half-faded ghosts), and so does any whose span would pass about 40%
//                of the frame's height. 0 = off (both): wings may fill the frame.
//     smear      seconds (1/240 = one of 8 sub-frames at shutter 1). In that time an instance moves along
//                its path and its wings sweep about the hinge. Where either carries it more than a pixel
//                and a half, the pair is drawn as the shell of what it sweeps and each pixel integrates
//                the wing over the sub-frame, so the samples of a frame join into one smear (no stepped
//                copies of the outline); smaller motion is a stretch along the path. Automatic; the
//                path's own velocity is used (a camera flying with the flock only shortens the steps).
//     sun        [x, y, z] direction TO the light (world), sunColor [r, g, b], ambient [r, g, b]
//     sheen      0..1 (1) the whisper of sky on the wet canopy;  minPx (2) minimum on-screen size
//   setPositions(float32)   re-upload ground positions (must be a pure function of t on the host's side)
//   update(t)   sets the clock.
//
// morph (0.8 s per instance): a real umbrella (a dome of 8 gores on bowed ribs, scalloped rim, ferrule,
// shaft and handle; an ink octagon 1.1 m wide from above, a shallow dome on a line from the side) -> the
// dome flattens, the shaft withdraws and a V notch cuts in from both ends of one diameter -> two lobes
// hinged on that diameter -> colour floods out from the hinge along the veins while each lobe reshapes
// into a fore/hind wing pair -> first wingbeat about the hinge (up, then down) -> lift. One mesh and one
// outline function all the way: nothing is cross-faded.
// Colour: the upper side is the wing blue (lib/thinfilm.js) over melanin, and it FLASHES: brilliant while
// the wing faces the eye, ink when it turns edge-on or shuts, two thirds of every beat blue and one third
// dark, so a mass of them shimmers. Black margin, pale fringe and submarginal spots, veins and body when
// large; a simpler, deeper-waisted glyph when a few pixels across. From below, in flight, the membrane
// is lit through: blue, brightest toward the sun (never the grey underside, which shows only on wings
// that are shut). Render with `shutter: 1`.
//
// How it is built: SIM, a 256 x N float target with one texel per instance (four outputs: origin and
// morph, forward and wing angle, up and fade, velocity), is rendered in update(t) from the instance data and the
// state: the ring, the walk, the path (spiral, river, curl-noise displacement advected with the flow)
// and the attitude from the path's own finite differences. DRAW, the instanced mesh, reads its texel
// and only shapes 59 vertices. Sprites under minPx are drawn at minPx with alpha = true / drawn area;
// no hashed alpha, no alpha test on small things.

import * as THREE from 'three';
import { createRng } from './random.js';
import { THINFILM } from './thinfilm.js';
import { NOISE } from './glsl/noise.js';
import { PALETTE, linear } from './story.js';

// ---- the one geometry ---------------------------------------------------------------------------
// 59 vertices, 88 triangles per instance: a dome of eight gores (16 columns: a rib, a mid-gore line
// where the cloth sags, a rib ...; three rings along the bowed ribs) that is the canopy, real geometry
// with its own scalloped rim, and then, flattened and hinged on one diameter, the hull of the two
// wing pairs; and one ribbon (real edges too) that is the shaft and then the body. The V notch, the lobes and the wing
// outline are analytic in the fragment shader, in the planform of this hull, so they are exact at any
// size; the open umbrella's outline is the mesh itself.
const R = 0.55, H = 0.2;    // canopy radius (rib tip) and dome height (m)
const SAG = 0.91;           // radius of the rim at mid-gore, in rib lengths (a straight edge would be 0.924)
const RINGS = [0.36, 0.7, 1];
const LUT_N = 256;

/**
 * Outline of the right wing pair, flat, in half-wingspan units: +z forward, x outward. A forewing and a
 * hindwing with a clear waist between them, so that the pair reads as a butterfly and not as a lobe.
 */
const WING_OUTLINE = [
  [0.00, 0.16], [0.08, 0.27], [0.30, 0.46], [0.58, 0.62], [0.84, 0.68], [0.98, 0.62], [1.00, 0.48],
  [0.94, 0.30], [0.86, 0.15], [0.76, 0.04], [0.60, -0.04], [0.50, -0.10], [0.60, -0.18], [0.72, -0.30],
  [0.76, -0.46], [0.70, -0.62], [0.57, -0.73], [0.41, -0.77], [0.26, -0.72], [0.14, -0.58], [0.06, -0.42], [0.00, -0.30],
];
function catmull(pts, x) {
  const n = pts.length - 1;
  const f = Math.min(Math.max(x, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1), t = f - i;
  const p = (k) => pts[Math.min(Math.max(k, 0), n)];
  const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
  return [0, 1].map((a) => 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t * t * t));
}
/** The wing outline as a polar radius over the angle from the head (0) to the tail (PI). */
const WING_POLAR = (() => {
  const pts = [];
  for (let i = 0; i <= 1200; i++) { const [x, z] = catmull(WING_OUTLINE, i / 1200); pts.push([Math.atan2(Math.max(x, 0), z), Math.hypot(x, z)]); }
  for (let i = 1; i < pts.length; i++) pts[i][0] = Math.max(pts[i][0], pts[i - 1][0]);      // the angle never runs back
  const out = new Float32Array(LUT_N);
  let j = 0;
  for (let i = 0; i < LUT_N; i++) {
    const a = (i / (LUT_N - 1)) * Math.PI;
    while (j < pts.length - 2 && pts[j + 1][0] < a) j++;
    const [a0, r0] = pts[j], [a1, r1] = pts[j + 1];
    out[i] = r0 + (r1 - r0) * (a1 > a0 ? Math.min(Math.max((a - a0) / (a1 - a0), 0), 1) : 0);
  }
  return out;
})();
/**
 * The same pair as a glyph for when it is a few pixels across: the waist and the gaps at head and tail
 * are cut deeper, so that four wings survive the filtering.
 */
const WING_GLYPH = WING_POLAR.map((r, i) => {
  const a = (i / (LUT_N - 1)) * Math.PI, g = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
  return r * (1 - 0.5 * g(a, 1.75, 0.3)) * (1 - 0.45 * g(a, 0, 0.5)) * (1 - 0.4 * g(a, Math.PI, 0.42));
});
/** Hull radii of the wing state at 0, 22.5 ... 180 degrees: the 16-gon that contains the wing outline. */
const HULL_W = (() => {
  const N = 8, step = Math.PI / N;
  const Hw = Array.from({ length: N + 1 }, (_, c) => WING_POLAR[Math.round((c / N) * (LUT_N - 1))] * 1.05 + 0.03);
  const need = () => {
    for (let i = 0; i < LUT_N; i++) {
      const a = (i / (LUT_N - 1)) * Math.PI, rho = WING_POLAR[i] * 1.04 + 0.025;
      const c = Math.min(N - 1, Math.floor(a / step));
      const a0 = c * step, a1 = a0 + step;
      const p0 = [Math.sin(a0) * Hw[c], Math.cos(a0) * Hw[c]], p1 = [Math.sin(a1) * Hw[c + 1], Math.cos(a1) * Hw[c + 1]];
      const e = [p1[0] - p0[0], p1[1] - p0[1]], d = [Math.sin(a), Math.cos(a)];
      const chord = (p0[0] * e[1] - p0[1] * e[0]) / (d[0] * e[1] - d[1] * e[0]);
      if (!(chord >= rho)) return c;
    }
    return -1;
  };
  for (let n = 0, c = need(); c >= 0 && n < 400; n++, c = need()) { Hw[c] = Math.min(Hw[c] * 1.02, 3); Hw[c + 1] = Math.min(Hw[c + 1] * 1.02, 3); }
  return Hw;
})();

function buildGeometry() {
  // position = (column 0..15 | ribbon side -1/+1, ring 0..1 along the rib | station 0..4, kind 0 canopy / 1 ribbon)
  const pos = [0, 0, 0], index = [], nr = RINGS.length;
  for (let c = 0; c < 16; c++) for (const r of RINGS) pos.push(c, r, 0);
  for (let c = 0; c < 16; c++) {
    const a = 1 + c * nr, b = 1 + ((c + 1) % 16) * nr;       // counter-clockwise seen from above: the upper side faces up
    index.push(0, a, b);
    for (let k = 0; k < nr - 1; k++) index.push(a + k, a + k + 1, b + k + 1, a + k, b + k + 1, b + k);
  }
  // the ribbon: five stations along the shaft (handle, shaft, ferrule) / the body (tail ... head)
  const base = pos.length / 3;
  for (let k = 0; k < 5; k++) pos.push(-1, k, 1, 1, k, 1);
  for (let k = 0; k < 4; k++) { const a = base + k * 2; index.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  return { pos: new Float32Array(pos), index };
}

/** Seconds from an instance's morph start to the end of the morph, and to the moment it leaves. */
export const FLOCK_TIMING = { morph: 0.8, lift: 0.672 };

// ---- shaders --------------------------------------------------------------------------------------
// SIM runs once per instance (one texel per instance in a small float target, four
// outputs each): the timeline, the flight path and the attitude, i.e. everything that is expensive.
// DRAW is the one instanced draw: it reads its instance's texels and only shapes the mesh. SHADOW is
// the optional second draw of the same hull, thrown onto the ground.
const CONSTS = /* glsl */ `
#ifndef TAU
#define TAU 6.283185307179586
#endif
const float PI_ = 3.14159265;
const float R = ${R.toFixed(3)}, H = ${H.toFixed(3)};
const float LRIB = ${Math.hypot(R, H).toFixed(5)}, GAM_OPEN = ${Math.atan2(R, H).toFixed(5)};
const float MORPH = 0.8, LIFT = 0.84, PIVOT = 0.85;
`;

const SIM_VERT = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const SIM_FRAG = NOISE + CONSTS + /* glsl */ `
uniform sampler2D tGround, tTimes, tRand, tRand2;
uniform float uTime, uWalk, uWalkRate, uLean, uWave, uT0, uSpeed, uJitter, uRise, uFlow, uScale;
uniform float uRiver, uRivWidth, uRivSpeed, uRivMeander;
uniform vec2 uCentre, uRivH, uRivBend, uSpread;
uniform vec3 uGoal, uRivFrom, uRivTo;
layout(location = 0) out highp vec4 o0; layout(location = 1) out highp vec4 o1; layout(location = 2) out highp vec4 o2; layout(location = 3) out highp vec4 o3;
vec4 aGround;              // xy: ground position (m); zw: velocity (m/s on the walk clock)
vec2 aTimes;               // openAt, foldAt (film s)
vec4 aRand, aRand2;

vec3 gBase; float gLift;   // this instance: where it stands (hinge centre) and when it leaves

// the small erratic path of one butterfly around its place in the flow (m)
vec3 flutter(float tt) {
  float a = 0.045 * uScale;
  return a * vec3(sin(tt * (0.9 + 1.0 * aRand.y) + aRand.z * 40.0) + 0.35 * sin(tt * (2.1 + 0.7 * aRand.x) + aRand.w * 40.0),
    0.8 * sin(tt * (1.2 + 1.1 * aRand.w) + aRand.x * 40.0),
    sin(tt * (0.7 + 1.2 * aRand2.x) + aRand.y * 40.0) + 0.35 * sin(tt * (2.3 + 0.6 * aRand.z) + aRand2.y * 40.0));
}
float riverU(float tt, float L) { return fract(aRand.x + uRivSpeed * (0.94 + 0.12 * aRand2.x) * tt / L); }
vec3 riverAt(float tt) {
  vec3 ax = uRivTo - uRivFrom; float L = max(length(ax), 1.0); ax /= L;
  vec3 ref = abs(ax.y) > 0.92 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 lat = normalize(cross(ax, ref)); vec3 up2 = cross(lat, ax);
  float s = riverU(tt, L) * L;
  float W = uRivWidth;
  float gx = (aRand.y + aRand.z + aRand.w - 1.5) * 0.8;            // densest in the core
  float gy = (aRand2.y + aRand2.z) * 0.5;
  // the course: long, shallow bends (never more than ~10 degrees off the line, so that a camera
  // flying straight along it does not see the flock rush sideways), slowly drifting
  float m1 = uRivMeander * (0.5 * sin(s * TAU / (18.0 * W) + 1.3 + 0.03 * tt) + 0.15 * sin(s * TAU / (6.3 * W) + 4.1 - 0.05 * tt));
  float m2 = uRivMeander * sin(s * TAU / (11.0 * W) + 2.2 + 0.04 * tt);
  float braid = 1.0 + 0.3 * uRivMeander * sin(s * TAU / (14.0 * W) + 0.7);
  float hf = clamp(0.1 + 0.8 * gy + 0.12 * m2, 0.0, 1.0);
  float xs = s / L;                                                // the line may curve away with distance (not at its start)
  vec3 p = uRivFrom + ax * s + lat * (W * (gx * braid + m1) + uRivBend.x * xs * xs) + up2 * (mix(uRivH.x, uRivH.y, hf) + uRivBend.y * xs * xs);
  // turbulence: a divergence-free displacement that travels downstream almost with the flock, so
  // strands and clumps persist and nobody darts sideways
  float adv = uRivSpeed * 0.85 * tt;
  p += curlNoise(p / (2.2 * W) - ax * (adv / (2.2 * W))) * (0.22 * W) + curlNoise(p / (0.7 * W) - ax * (adv / (0.7 * W)) + 7.3) * (0.06 * W);
  return p + flutter(tt);
}
vec3 waveAt(float tt) {
  float air = tt - gLift;
  if (air <= 0.0) return gBase;
  float prog = air - 0.35 * (1.0 - exp(-air / 0.35));              // eased lift-off
  float Tj = 2.5 + 3.0 * aRand.y;
  float q = clamp(prog / Tj, 0.0, 1.0);
  float J = Tj * q * q * q * (1.0 - 0.5 * q) + max(prog - Tj, 0.0);   // integral of smoothstep
  // its own place in the cloud around the goal (densest in the middle)
  vec3 off = vec3(aRand.z + aRand.w - 1.0, aRand2.x + aRand2.z - 1.0, aRand.x + aRand2.y - 1.0);
  vec3 toG = uGoal + off * uSpread.xyx - gBase;
  float D = max(length(toG), 1e-3); vec3 dir = toG / D;
  // toward it at the climb speed, braking over the last stretch: it arrives and stays, it does not fly through
  float d = uRise * uFlow * J, d0 = min(1.2 * uRise + 2.0, 0.5 * D), dg = D - d0;
  float de = d < dg ? d : D - d0 * exp(-(d - dg) / d0);
  float arr = smoothstep(dg, dg + 2.0 * d0, d);
  vec3 p = gBase + vec3(0.0, uRise * (prog - uFlow * J) * (de / max(d, 1e-3)), 0.0) + dir * de;
  float hand = aRand2.y < 0.5 ? -1.0 : 1.0;
  float rs = (1.5 + 4.0 * aRand2.z) * (1.0 - exp(-air / 2.2)) * (1.0 - 0.5 * uFlow * q);
  float ang = aRand2.w * TAU + hand * 3.9 * log(1.0 + air / 1.5);
  p += vec3(cos(ang), 0.0, sin(ang)) * rs;
  // arrived, it mills about its place
  p += arr * 2.5 * vec3(sin(tt * (0.45 + 0.3 * aRand.x) + aRand2.w * 30.0), 0.5 * sin(tt * (0.5 + 0.3 * aRand.z) + aRand.y * 30.0), cos(tt * (0.4 + 0.3 * aRand.w) + aRand2.x * 30.0));
  // a divergence-free displacement that travels with each one (sampled at a fifth of its own way), so
  // strands form and nobody darts sideways, in flight or at rest
  float k = smoothstep(0.0, 4.0, air);
  vec3 fp = 0.2 * p + 0.8 * gBase;
  p += (curlNoise(fp / 55.0) * 6.0 + curlNoise(fp / 17.0 + 3.1) * 1.5) * k;
  return p + flutter(tt) * smoothstep(0.0, 1.0, air);
}
vec3 flightAt(float tt) { return uRiver > 0.5 ? riverAt(tt) : waveAt(tt); }
// the wing's angle about the hinge: 5 to 7 Hz, random phase, glides; during the morph, the first beat
float wingAt(float tt, float start, float river) {
  float u = mix(clamp((tt - start) / MORPH, 0.0, 1.0), 1.0, river);
  float hz = 5.0 + 2.0 * aRand.z;
  float tf = mix(tt - (start + MORPH), tt + aRand.w * 7.0, river);
  float glide = smoothstep(0.5, 0.85, 0.5 + 0.5 * sin(TAU * (0.21 + 0.17 * aRand2.x) * tf + aRand.x * TAU)) * mix(smoothstep(1.5, 3.0, tf), 1.0, river);
  float beat = -cos(TAU * fract(hz * tf));
  float phi = mix(0.3 + 0.8 * beat, 0.36 + 0.1 * beat, glide);
  if (u < 1.0) {                                                    // the first beat: up, then down, then lift
    float s = clamp((u - 0.6) / 0.4, 0.0, 1.0);
    phi = s < 0.5 ? 1.25 * smoothstep(0.0, 0.5, s) : mix(1.25, -0.5, 0.5 - 0.5 * cos(PI_ * (s - 0.5) * 2.0));
  }
  return phi;
}
vec3 rodrigues(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  aGround = texelFetch(tGround, tc, 0); aTimes = texelFetch(tTimes, tc, 0).xy;
  aRand = texelFetch(tRand, tc, 0); aRand2 = texelFetch(tRand2, tc, 0);
  // ---- when: the ring -----------------------------------------------------------------------
  vec2 vel = aGround.zw;
  vec2 g = aGround.xy + vel * uWalk;
  float start = 1e9;
  if (uWave > 0.5) {
    float s0 = uT0 + length(g - uCentre) / uSpeed;
    vec2 g1 = g - vel * uWalkRate * max(uTime - s0, 0.0);
    float s1 = uT0 + length(g1 - uCentre) / uSpeed + aRand.x * uJitter;
    if (aTimes.y > s1) {                                            // not folded away before the ring arrives
      g -= vel * uWalkRate * max(uTime - s1, 0.0);                  // it stopped when the ring arrived
      start = s1;
    }
  }
  float river = step(0.5, uRiver);
  float u = mix(clamp((uTime - start) / MORPH, 0.0, 1.0), 1.0, river);
  gBase = vec3(g.x, 1.9 + H, g.y);
  gLift = start + MORPH * LIFT;
  float air = mix(uTime - gLift, 10.0, river);

  // ---- umbrella: open, fold, lean ------------------------------------------------------------
  float tOpen = clamp((uTime - aTimes.x) * 6.0, 0.0, 1.0);
  float tFold = start < 1e8 ? -1.0 : (uTime - aTimes.y) * 6.0;
  float fo = clamp(tFold, 0.0, 1.0);
  float open = (1.0 - pow(1.0 - tOpen, 3.0)) * (1.0 - fo * fo * (3.0 - 2.0 * fo));
  float gone = clamp((tFold - 1.0) / 0.6, 0.0, 1.0);
  float umbScale = 1.0 - gone * gone * (3.0 - 2.0 * gone);
  float kFlat = smoothstep(0.0, 0.33, u);
  float yaw0 = aRand2.w * TAU;
  vec2 lv = length(vel) > 1e-4 ? normalize(vel) : vec2(sin(yaw0), cos(yaw0));
  float bob = 0.012 * sin(TAU * 1.8 * uWalk + aRand.z * 1.2) * step(1e-4, length(vel)) * (1.0 - kFlat);
  float tilt = (uLean * (0.8 + 0.4 * aRand.w) + (1.0 - open) * 0.85) * (1.0 - kFlat);

  // ---- where: path and attitude ---------------------------------------------------------------
  const float DT = 0.04;
  vec3 c0 = flightAt(uTime), cA = flightAt(uTime - DT), cB = flightAt(uTime + DT);
  vec3 vd = (cB - cA) / (2.0 * DT), acc = (cB - 2.0 * c0 + cA) / (DT * DT);
  float lh = length(vd.xz);
  float kAir = mix(smoothstep(0.0, 1.0, air), 1.0, river);
  // a butterfly flies nose-up and flits: its heading wanders about its path, so that from behind or
  // below the wings are seen as wings and not as a line
  float yawF = (lh > 1e-3 ? atan(vd.x, vd.z) : yaw0) + 0.45 * sin(uTime * (0.7 + 0.6 * aRand.x) + aRand.y * 40.0) + 0.5 * (aRand2.x - 0.5);
  float yaw = yaw0 + kAir * (mod(yawF - yaw0 + PI_, TAU) - PI_);
  float pitch = kAir * (0.36 + 0.3 * clamp(atan(vd.y, max(lh, 1e-3)), -0.6, 0.9) + 0.12 * sin(uTime * (0.9 + 0.5 * aRand.w) + aRand.z * 40.0));
  vec3 F = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
  vec3 Rv = normalize(cross(vec3(0.0, 1.0, 0.0), F));
  vec3 Uv = cross(F, Rv);
  float roll = kAir * (clamp(-dot(acc, Rv) * 0.05, -0.7, 0.7) + 0.2 * sin(uTime * (0.9 + aRand.x) + aRand.y * 30.0));
  Rv = Rv * cos(roll) + Uv * sin(roll); Uv = cross(F, Rv);
  vec3 origin = c0 + vec3(0.0, bob, 0.0);
  if (tilt > 1e-4) {
    vec3 k = vec3(lv.y, 0.0, -lv.x);
    Uv = rodrigues(Uv, k, tilt); F = rodrigues(F, k, tilt);
    origin += rodrigues(vec3(0.0, PIVOT, 0.0), k, tilt) - vec3(0.0, PIVOT, 0.0);
  }

  // ---- wingbeat, and how fast the wing is sweeping (for the draw's smear) ----------------------
  float phi = wingAt(uTime, start, river);
  float dphi = (wingAt(uTime + 0.002, start, river) - wingAt(uTime - 0.002, start, river)) / 0.004;
  float fade = 1.0;
  if (river > 0.5) {
    float uu = riverU(uTime, max(length(uRivTo - uRivFrom), 1.0));
    fade = smoothstep(0.0, 0.08, uu) * (1.0 - smoothstep(0.92, 1.0, uu));
  }
  o0 = vec4(origin, u);
  o1 = vec4(F, u > 0.0 ? phi : open);
  o2 = vec4(Uv, river > 0.5 ? fade : umbScale);
  o3 = vec4(vd * kAir, dphi);
}`;

const VERT = CONSTS + /* glsl */ `
attribute vec4 aRand;
uniform sampler2D tSim0, tSim1, tSim2, tSim3;
uniform float uScale, uRiver, uClear, uPxScale, uFrac, uMinPx, uSimW, uTaper, uSmear;
uniform vec3 uCamL, uCamFwdL, uSunL;
varying vec2 vP;        // canopy: planform in rib lengths / half-spans (fan: only which wing)
varying vec3 vQ, vD;    // fan: this point of the swept shell, and the path's step in one sub-frame; instance frame, half-spans
varying vec4 vI;        // morph, flap angle, alpha, kind
varying vec4 vJ;        // film thickness; ribbon: real / drawn width, wings: sweep in one sub-frame (rad); far; ribbon: body, wings: fan
varying vec3 vSunL, vViewL;
const float SH_Y[5] = float[5](0.0, 0.125, 0.14, 0.95, 1.0), SH_W[5] = float[5](1.0, 1.0, 0.55, 0.55, 0.1);   // handle, shaft, ferrule
const float BD_Y[5] = float[5](0.0, 0.3, 0.58, 0.82, 1.0), BD_W[5] = float[5](0.06, 0.62, 1.0, 0.85, 0.3);    // tail ... thorax, head
const float HULL_W[16] = float[16](${Array.from({ length: 16 }, (_, c) => HULL_W[Math.min(c, 16 - c)].toFixed(4)).join(', ')});
const float HULL_FAN = ${(Math.max(...HULL_W) * 1.02).toFixed(4)};       // a convex hull for the swept shell
void main() {
  ivec2 tc = ivec2(gl_InstanceID % int(uSimW), gl_InstanceID / int(uSimW));
  vec4 s0 = texelFetch(tSim0, tc, 0), s1 = texelFetch(tSim1, tc, 0), s2 = texelFetch(tSim2, tc, 0), s3 = texelFetch(tSim3, tc, 0);
  vec3 origin = s0.xyz, F = s1.xyz, Uv = s2.xyz, Rv = cross(Uv, F);
  float u = s0.w;
  float phi = u > 0.0 ? s1.w : 0.0, open = u > 0.0 ? 1.0 : s1.w;
  float umbScale = uRiver > 0.5 ? 1.0 : s2.w, fade = uRiver > 0.5 ? s2.w : 1.0;
  float kind = position.z;
  float kFlat = smoothstep(0.0, 0.33, u), kW = smoothstep(0.4, 0.82, u);
  float S = mix(R, 0.035 * uScale, smoothstep(0.2, 0.95, u));      // rib length -> half-span (m)

  float dC = length(origin - uCamL);
  float depth = dot(origin - uCamL, uCamFwdL);
  float pxPerM = uPxScale / max(depth, 0.05);
  float grow = depth > 0.0 ? max(1.0, uMinPx / max(2.0 * S * pxPerM, 1e-4)) : 1.0;   // never smaller than uMinPx on screen
  // keep the lens clear: nothing is nearer than the clear distance, and nothing is larger than about 40% of the
  // frame's height (a wing that large is a stain, not a butterfly). Each instance has its own distance
  // and size at which it goes, and goes quickly, so the flock thins toward the lens instead of standing
  // there as a layer of half-faded ghosts; always a fade across the shutter's sub-frames, never a pop.
  float near = 1.0;
  if (uClear > 0.0) {
    float c0 = uClear * (1.0 + 0.65 * aRand.x);
    float f0 = 0.3 + 0.1 * aRand.x;
    float flying = smoothstep(c0, c0 + 0.35 * uClear, dC) * (1.0 - smoothstep(f0, f0 + 0.08, S * uFrac / max(depth, 0.05)));
    near = mix(smoothstep(uClear, 2.0 * uClear, dC), flying, smoothstep(0.8, 1.0, u));   // umbrellas and the morph: as they were
  }
  if (uRiver > 0.5 && uTaper > 0.0) near /= 1.0 + (dC * dC) / (uTaper * uTaper);   // a river thins into the distance: end-on, it does not ball up
  vec3 pivot = vec3(0.0, -PIVOT, 0.0);

  // SMEAR. In one sub-frame of the shutter (uSmear seconds) the instance travels dP along its path and
  // its wings sweep dph about the hinge. When either moves it more than a pixel and a half on screen,
  // the pair is drawn as the shell of what it sweeps (two wedges on the hinge, stretched along the
  // path) and the fragment shader integrates the wing over that sub-frame, so that the samples of a
  // frame join into one continuous smear: no stepped copies of the outline. Smaller motion: the
  // instance is only stretched along its path and thinned by the same ratio.
  vec3 dP = s3.xyz * uSmear;
  float lS = length(dP), dph = s3.w * uSmear, ext = S * grow;
  float fan = (u >= 1.0 && depth > 0.0 && max(abs(dph) * ext, lS) * pxPerM > 1.5) ? 1.0 : 0.0;

  vec3 P; float wr = 1.0, kB = 0.0;
  if (kind < 0.5) {
    // instance frame: x across the hinge, y up, z along the hinge; origin = the hinge centre
    float ang = position.x * 0.3926991, rib = position.y;
    vec2 dir = vec2(sin(ang), cos(ang));
    vec3 q;
    if (fan > 0.5) {
      // centre -> lower plate's rim -> upper plate's rim -> back to the hinge
      float ph = phi + (rib < 0.5 ? -1.0 : 1.0) * (0.5 * abs(dph) + 2.0 / max(ext * pxPerM, 1.0));
      float rad = (rib < 0.01 || rib > 0.9) ? 0.0 : HULL_FAN * S;
      q = vec3(dir.x * rad, 0.0, dir.y * rad);
      q.y += abs(q.x) * sin(ph); q.x *= cos(ph);
      q *= grow;
      vP = dir;
    } else {
      float discR = mix(1.0, ${SAG.toFixed(3)}, mod(position.x, 2.0));        // rib tip, or the sagging cloth between two
      float hr = mix(discR, HULL_W[int(position.x + 0.5)], kW) * rib;
      float gam = mix(0.06, GAM_OPEN, open), len = rib * LRIB, bulge = 0.2 * open * rib * (1.0 - rib);
      float rr = (len * sin(gam) + bulge * cos(gam)) * discR, yy = -len * cos(gam) + bulge * sin(gam);
      q = mix(vec3(dir.x * rr, yy, dir.y * rr), vec3(dir.x * hr * S, 0.0, dir.y * hr * S), kFlat);
      q.y += abs(q.x) * sin(phi); q.x *= cos(phi);                  // the hinge
      q = mix(pivot, q, umbScale) * grow;
      vP = dir * hr;
    }
    P = origin + Rv * q.x + Uv * q.y + F * q.z;
    vQ = q / ext;
  } else {
    // the shaft (ferrule above, handle below) withdraws into the hinge, then grows along it as the body
    kB = step(0.33, u);
    float gB = smoothstep(0.33, 0.6, u);
    vec3 q0 = mix(vec3(0.0, -0.95 * (1.0 - kFlat), 0.0), vec3(0.0, 0.0, -0.37 * S * gB), kB);
    vec3 q1 = mix(vec3(0.0, 0.055 * (1.0 - kFlat), 0.0), vec3(0.0, 0.0, 0.25 * S * gB), kB);
    q0 = mix(pivot, q0, umbScale) * grow; q1 = mix(pivot, q1, umbScale) * grow;
    vec3 A0 = origin + Uv * q0.y + F * q0.z, A1 = origin + Uv * q1.y + F * q1.z;
    vec3 ax = A1 - A0, mid = 0.5 * (A0 + A1);
    vec3 sd = cross(ax, mid - uCamL);
    sd = dot(sd, sd) > 1e-12 ? normalize(sd) : Rv;
    int st = int(position.y + 0.5);
    float along = mix(SH_Y[st], BD_Y[st], kB);
    float hwReal = mix(0.02 * SH_W[st], 0.075 * S * BD_W[st], kB) * umbScale * grow;
    float hw = max(hwReal, 0.8 / pxPerM);                           // never thinner than a brush line
    wr = hwReal / hw;
    P = mix(A0, A1, along) + sd * (hw * position.x);
    P += normalize(uCamL - P) * (0.075 * S * kB);                  // the body sits proud of the wing plane
    vP = vec2(position.x, along);
    vQ = vec3(0.0);
  }
  vec3 toEye = uCamL - P;
  vViewL = vec3(dot(toEye, Rv), dot(toEye, Uv), dot(toEye, F));
  if (lS * pxPerM > 0.5) {
    P += dP * (0.55 * clamp(dot(P - origin, dP) / (lS * ext), -1.0, 1.0));
    if (fan < 0.5 || kind > 0.5) near *= 1.0 / (1.0 + 0.5 * lS / ext);
  }
  vD = vec3(dot(dP, Rv), dot(dP, Uv), dot(dP, F)) / ext;
  vI = vec4(u, phi, fade * near / (grow * grow), kind);
  float far = 1.0 - smoothstep(10.0, 36.0, 2.0 * S * pxPerM * grow);   // 1 when the pair is a few pixels across
  vJ = vec4(0.992 + 0.03 * aRand.y, kind < 0.5 ? dph : wr, far, kind < 0.5 ? fan : kB);
  vSunL = vec3(dot(uSunL, Rv), dot(uSunL, Uv), dot(uSunL, F));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
}`;

// The outline of the instance in its own planform, as a polar radius: the open canopy is its own mesh
// (no cut); from the lobes on, the radius closes in from outside the hull onto the wing pair.
const OUTLINE = /* glsl */ `
uniform sampler2D tOutline;
float outlineRho(vec2 p, float al, float u, float far, out float ga) {
  const float PI_ = 3.14159265, Q_ = 0.7853982;
  float kN = smoothstep(0.0, 0.42, u), kW = smoothstep(0.4, 0.82, u);
  ga = mod(al, Q_) - 0.5 * Q_;
  vec2 lut = texture2D(tOutline, vec2((al / PI_ * ${(LUT_N - 1).toFixed(1)} + 0.5) / ${LUT_N.toFixed(1)}, 0.5)).rg;
  float rw = mix(lut.r, lut.g, far);
  float th = abs(ga);
  float rd = (${SAG.toFixed(3)} * 0.3826834) / (${SAG.toFixed(3)} * sin(th) + sin(0.3926991 - th));   // the rim of the mesh, exactly
  float rho = mix(rd * 1.02 + 3.0 * (1.0 - smoothstep(0.0, 0.1, kW)), rw, kW);
  // the V notch: cut in from both ends of the hinge and opening as it goes, until two lobes hang
  // on the hinge like a bow; it closes again onto the wings' own roots
  float front = step(0.0, p.y);
  float an = mix(PI_ - al, al, front);
  float zA = mix(1.15, mix(0.30, 0.16, front), kN);
  float hn = mix(mix(0.2, 0.72, kN), 0.3, kW);
  if (an < hn) rho = min(rho, zA * sin(hn) / sin(hn - an));
  return rho;
}`;

const FRAG = THINFILM + OUTLINE + /* glsl */ `
uniform vec3 uInk, uUnder, uFringe, uBody, uSunColor, uAmbient;
uniform float uSheen;
varying vec2 vP; varying vec3 vQ, vD; varying vec4 vI; varying vec4 vJ;
varying vec3 vSunL, vViewL;
const float PI_ = 3.14159265, Q_ = 0.7853982;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// The wing at the planform point (r, al), rn = r / its outline, with the normal N turned to the eye:
// upper side = the wing blue, flashing; from below, the membrane lit through (grey only when shut).
vec3 wingShade(float r, float al, float rn, vec3 N, bool upper, vec3 V, vec3 L, float u, float phi, float far, float thick, float wet, float soft) {
  float ndv = abs(dot(N, V)), ndl = dot(N, L);
  float va = al * 12.0 / PI_ + 0.35 * r;
  float vein = abs(fract(va) - 0.5) * 2.0;                           // 0 on a vein, 1 between two
  float waist = abs(al - 1.75) * r;                                  // where the forewing lies over the hindwing
  // soft = how far the smear carries the wing between two of its samples (planform units): the drawing
  // inside the wing is softened by as much, so that its lines do not repeat as rings
  float fine = (1.0 - far) * (1.0 - smoothstep(0.015, 0.06, soft));
  float margin = smoothstep(mix(0.82, 0.93, far) - soft, mix(0.91, 1.0, far) + soft, rn);
  float fringe = smoothstep(0.962, 0.982, rn) * fine;
  // veins, the seam of the two wings, a darker root: the lead of the stained glass (gone when small)
  float root = 0.72 + 0.28 * smoothstep(0.08, 0.5, rn), sharp = 1.0 - smoothstep(0.015, 0.06, soft);
  float lead = mix(root * mix(1.0, (0.55 + 0.45 * smoothstep(0.05, 0.22, vein)) * (0.5 + 0.5 * smoothstep(0.0, 0.05, waist)), sharp), 1.0, far);
  float spot = (1.0 - smoothstep(0.012, 0.022, length(vec2((fract(va) - 0.5) * r * 0.26, (rn - 0.895) * r)))) * fine * step(0.6, r);
  float lightA = lum(uAmbient), lightS = lum(uSunColor);
  float lit = clamp(0.75 * (lightA + lightS), 0.62, 0.95);            // brilliant, but never so bright that the blue pales
  float fly = smoothstep(0.8, 1.0, u);
  // light from behind passes the membrane and comes out blue; most of all looking toward the sun
  float back = clamp(-ndl * 1.5 + 0.2, 0.0, 1.0);
  float toSun = pow(clamp(-dot(V, L), 0.0, 1.0), 2.0);
  vec3 through = thinFilmRamp(thick * 0.99) * min(lightS, 1.4) * back * (0.4 + 0.6 * toSun);
  vec3 wing;
  if (upper) {
    // structural blue: brilliant when the wing faces the eye, violet as it turns, then ink
    float face = smoothstep(0.56, 0.92, ndv);
    vec3 film = thinFilmRamp(thick * (0.962 + 0.043 * face) + 0.012 * wet) * face * lit * (1.0 + 0.15 * wet);
    wing = uInk + (film + 0.7 * through) * (lead * (1.0 - margin) + 0.8 * spot);
    wing = mix(wing, uFringe * (lightA + 0.6 * lightS * (max(ndl, 0.0) + back)) * 0.8, fringe);
  } else {
    // from below: shut, the ink-grey underside with its row of dots; in flight the membrane itself, lit through
    float face = smoothstep(0.12, 0.7, ndv);
    vec3 glow = thinFilmRamp(thick * 0.99) * min(0.4 * lightA + lightS * (0.1 + 0.9 * back * (0.4 + 0.6 * toSun)), 1.3) * (0.3 + 0.7 * face);
    float dots = smoothstep(0.03, 0.05, length(vec2((fract(va) - 0.5) * r * 0.26, rn - 0.7)));
    vec3 grey = uUnder * (lightA + 0.35 * lightS * max(ndl, 0.0)) * (0.8 + 0.2 * smoothstep(0.05, 0.2, vein)) * (0.35 + 0.65 * dots) * (1.0 - 0.4 * margin);
    float shut = max(1.0 - fly, smoothstep(1.0, 1.25, phi));
    wing = mix(uInk * 1.5 + glow * (lead * (1.0 - 0.85 * margin) + 0.6 * spot), grey, shut);
    wing = mix(wing, uFringe * (0.5 * lightA + lightS * (0.1 + 0.9 * back)) * 0.7, fringe * (1.0 - shut));
  }
  return wing;
}

void main() {
  float u = vI.x, phi = vI.y;
  vec3 V = normalize(vViewL), L = normalize(vSunL);
  vec3 col; float cov;
  if (vI.w > 0.5) {
    // ribbon: the shaft with its handle and ferrule, or the body; under a pixel wide it thins by alpha
    cov = vJ.y;
    col = mix(uInk, uBody * (uAmbient + uSunColor * 0.3), vJ.w * smoothstep(0.4, 0.8, u));
  } else if (vJ.w > 0.5) {
    // SMEAR: this pixel's ray through the shell of what the wing pair sweeps in one sub-frame. The
    // wing is found on the ray at four moments of that sub-frame (where the instance is, where its
    // wing stands) and averaged, each with an edge as soft as the step between them.
    if (gl_FrontFacing) discard;                                     // the shell's near face only (it is wound inward)
    float side = vP.x >= 0.0 ? 1.0 : -1.0;
    vec2 ps[4]; float ah[4]; vec3 ns[4];
    for (int j = 0; j < 4; j++) {
      float sj = (float(j) + 0.5) * 0.25 - 0.5;
      float th = phi + vJ.y * sj;
      vec3 n = vec3(-side * sin(th), cos(th), 0.0);
      vec3 q = vQ - vD * sj;
      float dn = dot(V, n);
      vec3 hit = q - V * (dot(q, n) / (abs(dn) > 1e-4 ? dn : 1e-4));
      ah[j] = dot(hit, vec3(side * cos(th), sin(th), 0.0));
      ps[j] = vec2(side * ah[j], hit.z);
      ns[j] = n;
    }
    float sp = 0.5 * (length(ps[1] - ps[0]) + length(ps[3] - ps[2]));   // how far one step carries the wing under this pixel
    vec3 acc = vec3(0.0); float sum = 0.0;
    for (int j = 0; j < 4; j++) {
      vec2 p = ps[j]; float r = length(p), al = atan(abs(p.x), p.y), ga;
      float rho = outlineRho(p, al, 1.0, vJ.z, ga);
      float d = r - rho;
      float dn = dot(V, ns[j]);
      float c = (1.0 - smoothstep(-0.5, 0.5, d / max(fwidth(d) + sp, 1e-6))) * smoothstep(0.0, 0.02, ah[j]) * smoothstep(0.0, 0.1, abs(dn));
      float th = phi + vJ.y * ((float(j) + 0.5) * 0.25 - 0.5);
      acc += c * wingShade(r, al, r / max(rho, 1e-4), dn > 0.0 ? ns[j] : -ns[j], dn > 0.0, V, L, 1.0, th, vJ.z, vJ.x, 0.0, sp);
      sum += c;
    }
    cov = 0.25 * sum;
    col = acc / max(sum, 1e-4);
  } else {
    vec2 p = vP; float r = length(p);
    float al = atan(abs(p.x), p.y);                                  // 0 at the head end of the hinge, PI at the tail
    float kFlat = smoothstep(0.0, 0.33, u);
    float ga;
    float rho = outlineRho(p, al, u, vJ.z, ga);
    float d = r - rho;
    cov = clamp(0.5 - d / max(fwidth(d), 1e-6), 0.0, 1.0);
    float rn = r / max(rho, 1e-4);

    // normals in the instance frame: the dome, faceted gore by gore, and the wing plate
    float side = p.x >= 0.0 ? 1.0 : -1.0;
    float gc = (floor(al / Q_) + 0.5) * Q_;
    float slope = 0.1 + 0.6 * r;
    vec3 nD = normalize(vec3(side * sin(gc) * slope, 1.0, cos(gc) * slope));
    vec3 nW = vec3(-side * sin(phi), cos(phi), 0.0);
    vec3 N = normalize(mix(nD, nW, kFlat));
    bool upper = gl_FrontFacing;
    if (!upper) N = -N;
    float ndv = abs(dot(N, V));
    float ndh = max(dot(N, normalize(L + V)), 0.0);

    // the umbrella: ink, a whisper of sky on the wet cloth, the faintest ribs
    float rib = (1.0 - smoothstep(0.004, 0.014, r * abs(sin(ga - sign(ga) * 0.5 * Q_)))) * smoothstep(0.03, 0.12, r);
    vec3 umb = uInk + uSheen * (upper ? 1.0 : 0.15) * uAmbient * (0.035 * pow(ndh, 10.0) + 0.008 * pow(1.0 - ndv, 3.0) + 0.006 * rib);

    // the wing: the front is the wing pair itself, growing from the hinge: a small blue butterfly
    // inside the black lobes, which close in on it as it reaches full size
    float vein = abs(fract(al * 12.0 / PI_ + 0.35 * r) - 0.5) * 2.0;
    float rwing = texture2D(tOutline, vec2((al / PI_ * ${(LUT_N - 1).toFixed(1)} + 0.5) / ${LUT_N.toFixed(1)}, 0.5)).r;
    float reach = (u - 0.3) / 0.5 * 1.2;
    float dist = r / max(rwing, 0.05) + 0.06 * vein;
    float k = 1.0 - smoothstep(reach - 0.07, reach, dist);
    float wet = k * smoothstep(reach - 0.3, reach - 0.05, dist) * (1.0 - smoothstep(0.82, 1.0, u));   // the wet front
    vec3 wing = wingShade(r, al, rn, N, upper, V, L, u, phi, vJ.z, vJ.x, wet, 0.0);
    col = mix(umb, wing, k);
    cov *= mix(1.0, smoothstep(0.0, 0.1, ndv), smoothstep(0.55, 0.7, u));   // a wing seen edge-on is a hairline: let it go
  }
  float a = vI.z * cov;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}`;

// SHADOW (optional second mesh): the same hull, thrown along the light onto the ground plane, so each
// butterfly's shadow is its own planform with its wings where they are; it softens, shrinks and thins
// as its owner climbs.
const SHADOW_VERT = CONSTS + /* glsl */ `
uniform sampler2D tSim0, tSim1, tSim2;
uniform float uScale, uRiver, uPxScale, uMinPx, uSimW, uGround, uShSoft;
uniform vec2 uShDir;
uniform vec3 uCamL, uCamFwdL;
varying vec2 vP; varying vec4 vI;      // planform; morph, blur (planform units), alpha, far
const float HULL_W[16] = float[16](${Array.from({ length: 16 }, (_, c) => HULL_W[Math.min(c, 16 - c)].toFixed(4)).join(', ')});
void main() {
  ivec2 tc = ivec2(gl_InstanceID % int(uSimW), gl_InstanceID / int(uSimW));
  vec4 s0 = texelFetch(tSim0, tc, 0), s1 = texelFetch(tSim1, tc, 0), s2 = texelFetch(tSim2, tc, 0);
  vec3 origin = s0.xyz, F = s1.xyz, Uv = s2.xyz, Rv = cross(Uv, F);
  float u = s0.w, phi = u > 0.0 ? s1.w : 0.0;
  float fade = uRiver > 0.5 ? s2.w : 1.0;
  float kW = smoothstep(0.4, 0.82, u);
  float S = mix(R, 0.035 * uScale, smoothstep(0.2, 0.95, u));
  float h = max(origin.y - uGround, 0.0);
  float blur = (0.012 + 0.03 * uShSoft * h) / S;                    // the penumbra, in planform units
  float ang = position.x * 0.3926991, rib = position.y;
  vec2 dir = vec2(sin(ang), cos(ang));
  float hr = mix(mix(1.0, ${SAG.toFixed(3)}, mod(position.x, 2.0)), HULL_W[int(position.x + 0.5)], kW) * rib * (1.0 + 1.3 * blur);
  vec3 q = vec3(dir.x * hr * S, 0.0, dir.y * hr * S);
  q.y += abs(q.x) * sin(phi); q.x *= cos(phi);
  vec3 P = origin + Rv * q.x + Uv * q.y + F * q.z;
  vec3 G = vec3(P.x + uShDir.x * (P.y - uGround), uGround, P.z + uShDir.y * (P.y - uGround));
  vec3 Gc = vec3(origin.x + uShDir.x * h, uGround, origin.z + uShDir.y * h);
  float depth = dot(Gc - uCamL, uCamFwdL);
  float pxPerM = uPxScale / max(depth, 0.05);
  float grow = depth > 0.0 ? max(1.0, uMinPx / max(2.0 * S * pxPerM, 1e-4)) : 1.0;
  G = Gc + (G - Gc) * grow;
  float far = 1.0 - smoothstep(10.0, 36.0, 2.0 * S * pxPerM * grow);
  // it is the umbrella's shadow (the host's) until the lobes part; thinner the higher its owner
  float alpha = smoothstep(0.3, 0.55, u) * fade / (grow * grow) / (1.0 + 2.5 * blur * blur);
  vP = dir * hr;
  vI = vec4(u, blur, alpha, far);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(G, 1.0);
}`;
const SHADOW_FRAG = OUTLINE + /* glsl */ `
uniform vec3 uShColor; uniform float uShStrength;
varying vec2 vP; varying vec4 vI;
void main() {
  float r = length(vP), al = atan(abs(vP.x), vP.y), ga;
  float rho = outlineRho(vP, al, vI.x, vI.w, ga);
  float d = r - min(rho, 1.6) + 0.5 * vI.y;                         // the core shrinks as the edge softens
  float cov = 1.0 - smoothstep(-0.5, 0.5, d / max(fwidth(d) + vI.y, 1e-6));
  float a = cov * vI.z * uShStrength;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uShColor * a, a);
}`;

// ---- the object -----------------------------------------------------------------------------------
export function createFlock({ count = 1000, seed = 'flock', positions = null, radius = 150, velocities = null, openAt = null, foldAt = null } = {}) {
  const rng = createRng(seed);
  const G = buildGeometry();
  const ground = new Float32Array(count * 4), times = new Float32Array(count * 2), rand = new Float32Array(count * 4), rand2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [dx, dz] = rng.inDisk();                           // always drawn, so the seed sequence is stable
    ground[i * 4] = positions ? positions[i * 2] : dx * radius;
    ground[i * 4 + 1] = positions ? positions[i * 2 + 1] : dz * radius;
    ground[i * 4 + 2] = velocities ? velocities[i * 2] : 0;
    ground[i * 4 + 3] = velocities ? velocities[i * 2 + 1] : 0;
    times[i * 2] = openAt ? openAt[i] : -1e9;
    times[i * 2 + 1] = foldAt ? foldAt[i] : 1e9;
    for (let k = 0; k < 4; k++) { rand[i * 4 + k] = rng(); rand2[i * 4 + k] = rng(); }
  }

  // SIM: one texel per instance -> three RGBA32F outputs (origin + morph, forward + flap, up + fade).
  // The per-instance data lives in float textures of the same layout.
  const simW = 256, simH = Math.max(1, Math.ceil(count / simW));
  const dataTex = (src, n) => {
    const d = new Float32Array(simW * simH * 4);
    for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) d[i * 4 + k] = src[i * n + k];
    const t = new THREE.DataTexture(d, simW, simH, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  const tGround = dataTex(ground, 4), tTimes = dataTex(times, 2), tRand = dataTex(rand, 4), tRand2 = dataTex(rand2, 4);
  const simRT = new THREE.WebGLRenderTarget(simW, simH, {
    count: 4, type: THREE.FloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  const simGeo = new THREE.BufferGeometry();
  simGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const sim = {
    tGround: { value: tGround }, tTimes: { value: tTimes }, tRand: { value: tRand }, tRand2: { value: tRand2 },
    uTime: { value: 0 }, uWalk: { value: 0 }, uWalkRate: { value: 1 }, uLean: { value: 0 },
    uWave: { value: 0 }, uT0: { value: 0 }, uSpeed: { value: 30 }, uJitter: { value: 0.03 }, uCentre: { value: new THREE.Vector2() },
    uRise: { value: 9 }, uGoal: { value: new THREE.Vector3(0, 300, -400) }, uFlow: { value: 0 }, uScale: { value: 10 }, uSpread: { value: new THREE.Vector2(14, 7) },
    uRiver: { value: 0 }, uRivFrom: { value: new THREE.Vector3() }, uRivTo: { value: new THREE.Vector3(0, 0, -100) }, uRivWidth: { value: 30 }, uRivH: { value: new THREE.Vector2(6, 40) }, uRivSpeed: { value: 12 }, uRivMeander: { value: 1 }, uRivBend: { value: new THREE.Vector2() },
  };
  const simMat = new THREE.ShaderMaterial({
    name: 'flock-sim', uniforms: sim, vertexShader: SIM_VERT, fragmentShader: SIM_FRAG, glslVersion: THREE.GLSL3,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const simQuad = new THREE.Mesh(simGeo, simMat);
  simQuad.frustumCulled = false;
  const simScene = new THREE.Scene();
  simScene.add(simQuad);
  const simCam = new THREE.Camera();

  // DRAW: the one instanced mesh
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(G.index);
  geo.setAttribute('position', new THREE.BufferAttribute(G.pos, 3));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));
  geo.instanceCount = count;
  const lut = new Uint16Array(LUT_N * 4);
  for (let i = 0; i < LUT_N; i++) { lut[i * 4] = THREE.DataUtils.toHalfFloat(WING_POLAR[i]); lut[i * 4 + 1] = THREE.DataUtils.toHalfFloat(WING_GLYPH[i]); }
  const outline = new THREE.DataTexture(lut, LUT_N, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  outline.minFilter = outline.magFilter = THREE.LinearFilter;
  outline.needsUpdate = true;
  const v3 = (hex) => new THREE.Vector3(...linear(hex));
  const uniforms = {
    tOutline: { value: outline },
    tSim0: { value: simRT.textures[0] }, tSim1: { value: simRT.textures[1] }, tSim2: { value: simRT.textures[2] }, tSim3: { value: simRT.textures[3] }, uSimW: { value: simW },
    uScale: sim.uScale, uRiver: sim.uRiver,
    uClear: { value: 1.5 }, uMinPx: { value: 2 }, uPxScale: { value: 1000 }, uFrac: { value: 1 }, uTaper: { value: 0 }, uSmear: { value: 1 / 240 },
    uCamL: { value: new THREE.Vector3() }, uCamFwdL: { value: new THREE.Vector3(0, 0, -1) }, uSunL: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Vector3(1.6, 1.3, 0.95) }, uAmbient: { value: new THREE.Vector3(0.35, 0.38, 0.42) }, uSheen: { value: 1 },
    uInk: { value: v3(PALETTE.jiao) }, uUnder: { value: v3(PALETTE.underside) }, uFringe: { value: v3(PALETTE.fringe) }, uBody: { value: v3(PALETTE.body) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'flock', uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, forceSinglePass: true,
    transparent: true, depthWrite: true, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'flock';

  // SHADOW: off until set({ shadow }) (the host adds f.shadow to its scene, under the flock)
  const shGeo = new THREE.InstancedBufferGeometry();
  shGeo.setIndex(G.index);
  shGeo.setAttribute('position', geo.getAttribute('position'));
  shGeo.setDrawRange(0, 16 * 15);                                   // the canopy / wings only
  shGeo.instanceCount = count;
  const shU = {
    tOutline: uniforms.tOutline, tSim0: uniforms.tSim0, tSim1: uniforms.tSim1, tSim2: uniforms.tSim2, uSimW: uniforms.uSimW,
    uScale: sim.uScale, uRiver: sim.uRiver, uMinPx: uniforms.uMinPx, uPxScale: uniforms.uPxScale, uCamL: uniforms.uCamL, uCamFwdL: uniforms.uCamFwdL,
    uGround: { value: 0 }, uShDir: { value: new THREE.Vector2() }, uShSoft: { value: 1 }, uShStrength: { value: 0.5 }, uShColor: { value: v3(PALETTE.jiao) },
  };
  const shMat = new THREE.ShaderMaterial({
    name: 'flock-shadow', uniforms: shU, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, side: THREE.DoubleSide, forceSinglePass: true,
    transparent: true, depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const shadow = new THREE.Mesh(shGeo, shMat);
  shadow.frustumCulled = false;
  shadow.name = 'flock-shadow';
  shadow.visible = false;
  let shadowDir = null;

  // SIM runs in update(t), before the host's scene pass begins (a render-target switch in the
  // middle of a pass is expensive on tile-based GPUs). The renderer is only known once the mesh has
  // been drawn, so the first frame (and a set() after update()) falls back to a nested render in
  // onBeforeRender, as three's Reflector does. Then the camera-dependent uniforms, in the mesh's own
  // metres (the host may scale the mesh).
  let dirty = true, known = null;
  const runSim = (renderer) => {
    const rt = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(simRT);
    renderer.render(simScene, simCam);
    renderer.setRenderTarget(rt, face, mip);
    dirty = false;
  };
  const sun = new THREE.Vector3(0.4, 0.75, 0.5).normalize();
  const inv = new THREE.Matrix4(), rot = new THREE.Matrix3(), tmp = new THREE.Vector3(), size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    known = renderer;
    if (dirty) runSim(renderer);
    inv.copy(mesh.matrixWorld).invert();
    uniforms.uCamL.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
    rot.setFromMatrix4(inv);
    camera.getWorldDirection(tmp);
    uniforms.uCamFwdL.value.copy(tmp).applyMatrix3(rot).normalize();
    uniforms.uSunL.value.copy(sun).applyMatrix3(rot).normalize();
    const rt = renderer.getRenderTarget();
    const h = rt ? rt.height : renderer.getDrawingBufferSize(size).y;
    uniforms.uPxScale.value = 0.5 * h * camera.projectionMatrix.elements[5];
    uniforms.uFrac.value = camera.projectionMatrix.elements[5];
    if (!shadowDir) shU.uShDir.value.set(-sun.x, -sun.z).divideScalar(Math.max(sun.y, 0.05));
  };
  shadow.onBeforeRender = mesh.onBeforeRender;

  return {
    mesh,
    shadow,
    count,
    set(s = {}) {
      dirty = true;
      if ('morphWave' in s) {
        const w = s.morphWave;
        sim.uWave.value = w ? 1 : 0;
        if (w) {
          sim.uCentre.value.fromArray(w.centre || [0, 0]);
          sim.uT0.value = w.t0 ?? 0;
          sim.uSpeed.value = Math.max(w.speed ?? 30, 1e-3);
          sim.uJitter.value = w.jitter ?? 0.03;
        }
      }
      if ('river' in s) {
        const r = s.river;
        sim.uRiver.value = r ? 1 : 0;
        if (r) {
          sim.uRivFrom.value.fromArray(r.from);
          sim.uRivTo.value.fromArray(r.to);
          sim.uRivWidth.value = r.width ?? 30;
          sim.uRivH.value.fromArray(r.height || [6, 40]);
          sim.uRivSpeed.value = r.speed ?? 12;
          sim.uRivMeander.value = r.meander ?? 1;
          sim.uRivBend.value.fromArray(r.bend || [0, 0]);
          uniforms.uTaper.value = r.taper ?? 0.35 * sim.uRivFrom.value.distanceTo(sim.uRivTo.value);
        }
      }
      if ('shadow' in s) {
        const sh = s.shadow;
        shadow.visible = !!sh;
        if (sh) {
          shadowDir = sh.dir || null;
          if (sh.dir) shU.uShDir.value.fromArray(sh.dir);
          shU.uGround.value = sh.ground ?? 0;
          shU.uShStrength.value = sh.strength ?? 0.5;
          shU.uShSoft.value = sh.soft ?? 1;
          if (sh.color) shU.uShColor.value.fromArray(sh.color);
        }
      }
      if (s.rise !== undefined) sim.uRise.value = s.rise;
      if (s.goal) sim.uGoal.value.fromArray(s.goal);
      if (s.flow !== undefined) sim.uFlow.value = s.flow;
      if (s.spread !== undefined) sim.uSpread.value.fromArray(Array.isArray(s.spread) ? s.spread : [s.spread, 0.5 * s.spread]);
      if (s.scale !== undefined) sim.uScale.value = s.scale;
      if (s.walk !== undefined) sim.uWalk.value = s.walk;
      if (s.walkRate !== undefined) sim.uWalkRate.value = s.walkRate;
      if (s.lean !== undefined) sim.uLean.value = s.lean;
      if (s.clear !== undefined) uniforms.uClear.value = s.clear;
      if (s.sheen !== undefined) uniforms.uSheen.value = s.sheen;
      if (s.minPx !== undefined) uniforms.uMinPx.value = s.minPx;
      if (s.smear !== undefined) uniforms.uSmear.value = s.smear;
      if (s.sun) sun.fromArray(s.sun).normalize();
      if (s.sunColor) uniforms.uSunColor.value.fromArray(s.sunColor);
      if (s.ambient) uniforms.uAmbient.value.fromArray(s.ambient);
    },
    setPositions(arr) {
      const n = Math.min(count, Math.floor(arr.length / 2)), d = tGround.image.data;
      for (let i = 0; i < n; i++) { d[i * 4] = arr[i * 2]; d[i * 4 + 1] = arr[i * 2 + 1]; }
      tGround.needsUpdate = true;
      dirty = true;
    },
    update(t) { sim.uTime.value = t; dirty = true; if (known && mesh.visible) runSim(known); },
    dispose() { geo.dispose(); mat.dispose(); shGeo.dispose(); shMat.dispose(); outline.dispose(); simGeo.dispose(); simMat.dispose(); simRT.dispose(); for (const t of [tGround, tTimes, tRand, tRand2]) t.dispose(); },
  };
}
