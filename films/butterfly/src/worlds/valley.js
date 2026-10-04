// VALLEY (W2) — the master landscape: a glacial horn and its valley across ten thousand years.
//
// Two exports:
//   create(ctx)                     the world for S06, S08, S10, S11 (camera + landscape + title)
//   createLandscape(ctx, opts)      the reusable landscape (everything but the camera)
//
// ---------------------------------------------------------------------------------------------
// createLandscape(ctx, opts) -> { group, update(t, state), groundHeight(x, z, year), lighting(), dispose() }
//
//   group       THREE.Group: terrain (horn, flanking valley walls, outwash plain, glacier, river,
//               vegetation), sky (sun, moon,
//               stars, two cloud layers), haze, spindrift and rockfall dust. Add it to your scene.
//               The sky draws after opaque objects at the far plane, so a foreign tree occludes it.
//   update(t, state)   pure function of its arguments. state fields (all optional):
//       year           0..10000      story year (default: story.year(t))
//       shapeYear      year used for the mountain's shape only (default = year); S10 steps it at
//                                    each rockfall so the horn is visibly lower after every slab
//       sunElevation   degrees       (default 30). Below about 9 deg (20 deg when the sun is in the
//                                    west) the sky and light turn into the film's dawn / golden-hour
//                                    palette, and below 3.6 deg an alpenglow line climbs the mountain
//       sunAzimuth     degrees       0 = -Z (west, toward the mountain: dusk), 90 = +X, 180 = behind
//                                    the master camera (east: dawn). Default 215
//       season         0 winter .. 0.5 summer .. 1 winter (default 0.5); winter lowers the snowline
//                                    (from about year 6,000 on, deep winter snows the whole valley
//                                    floor), autumn turns the grass gold
//       snowline       height (units of 100 m) above which snow lies; overrides the year/season default.
//                                    Taken below about 1 it snows the valley floor in, patch by patch
//                                    (full cover at -1.6); the floor never switches in a single frame
//       cloudCover     0..1 (default 0.25); clouds cast moving shadows on the land
//       cloudSpeed     wind speed in units/s (default 1.5; time-lapse: 60..90). Keep it constant
//                      within a shot, or drive
//       cloudPhase     the distance travelled explicitly (default t * cloudSpeed)
//       cloudStreak    0..1 long-shutter smear of the clouds along the wind (default 0)
//       fog            0..1 haze (default 0.3)
//       spindrift      0..1 snow blowing off the ridge (default 0);  wind  scales its speed (default 1)
//       night          0..1 moonlit night (default 0): moon key light, silver river, colours drained.
//                      Pair it with a sun below the horizon
//       moonElevation  degrees (default 30), moonAzimuth degrees (default -18: ahead, a little left)
//       starVisibility 0..1 (default: follows night)
//       rockfall       array of events: a film time (s), or { t, u, f, life, scale } (u = profile
//                      coordinate, f = how far down the face); dust and pouring grains.
//                      rockfallLife (s, default 3.2), rockfallScale (default 1) and rockfallGrains
//                      (0..1 opacity of the pouring grains, default 1) apply to all
//       riverTip       distance up-valley (units) of the river's head while it is being born
//                      (S08); omit for a full river
//       exposure       EV offset on top of the landscape's own exposure for the light level
//       title          1 = light the title in the spindrift (only with opts.title; S06)
//       shafts         0..1 strength of the sun shafts that fan out when the sun is low (default 1)
//       riverGold      0..1 (default 0): 1 = the river keeps the colour of the sky it mirrors instead of
//                      being drained to silver (《梦蝶》 FIELD: the gold river)
//       riverCalm      0..1 (default 0): takes that share of the sun's dazzle off the water
//   groundHeight(x, z, year)   JS mirror of the surface height (bed, river bed and glacier ice)
//   lighting()   { sunDir, sunColor, ambient, fogColor, fogSunColor, moonDir, moonColor, keyDir,
//                  keyColor, gain } for the current state (linear THREE.Color / Vector3), already
//                  scaled by the landscape's exposure, so foreign objects lit with them match.
//                  At night sunDir/sunColor describe the moon (the key light).
//   opts: { detail: 1 (grid density 0.3..1; use ~0.4 for a soft backplate), particles: true (spindrift and
//           rockfall dust), tele: false (extra grid for the 400 mm shot), title: false (title grains),
//           stones: true (false = no stone / tussock lattice on the valley floor: FIELD draws its own grass) }
//   Cost at 1080p on the reference machine: 4.6 to 7.3 ms per frame including sky and post.
//   Not mirrored in groundHeight: nothing (stones in the foreground are drawn, not modelled).
//
// How the terrain is built: everything is laid out in the MASTER CAMERA's own perspective. For a
// ground point at depth D = -z and lateral tangent k = x / D, the height is D * E(k, D), where E is
// the tangent of the elevation angle at which the master camera sees that point. The mountain is
// E_env(k) * F(k, D) with F <= 1 reaching 1 exactly on the crest, so the skyline seen from the master
// position is exactly story.ridgeHeight(u, year) at every year (plus <= 0.03 of fractal jitter),
// whatever the faces, flutes and spurs do in front of it. Valley floor, glacier and river are
// designed the same way, so every part of the valley is visible in the master frame.

import * as THREE from 'three';
import { NOISE } from '../lib/glsl/noise.js';
import { SKY, FOG } from '../lib/glsl/sky.js';
import { createSkyUniforms, applySkyUniforms, skyLighting, sunDirection, SKY_DEFAULTS, sunTransmittanceJS } from '../lib/sky.js';
import { createParticles } from '../lib/particles.js';
import { GRAIN_FRAG } from '../lib/grains.js';
import { snoise2, fbm2, ridged2 } from '../lib/noise.js';
import { sampleTextPoints } from '../titles.js';
import { FX_LAYER } from '../post.js';
import { createLine } from '../lib/line.js';
import { createRng } from '../lib/random.js';
import { valleyState, p0, dome, PROFILE_GLSL, SUMMIT, RIDGE_HALF_WIDTH, MASTER_CAMERA, year as storyYear } from '../lib/valley-story.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fract = (x) => x - Math.floor(x);
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const addGlow = (c, v, k) => { c.r += v.x * v.w * k; c.g += v.y * v.w * k; c.b += v.z * v.w * k; return c; };

// ---------------------------------------------------------------------------------------------
// Shared layout constants (GLSL and JS mirror)
const LC = 2;                                // softening of the fan coordinate near the camera
const LK160 = Math.hypot(160, LC);           // makes the fan coordinate exact at D = 160
const RIV = { N: 1024, ROWS: 8, A: 7.06, B: 5.6, V0: 0.33 };
const CLOUD_H = [42, 85];                    // cloud layer heights (units)

/** Glacier snout depth (units up-valley) for an extent 0..1: 1.4 at year 0, 30 at 0.8, cirque at 0.15. */
const snoutDepth = (extent) => 1.4 + 148.6 * (1 - Math.pow(clamp01(extent), 0.89));

// ---------------------------------------------------------------------------------------------
// LAND: the height field. GLSL, and an exact JS mirror below (keep in sync).
// Outwash bars: 1 on the crest of a gravel bar, 0 in the channel between (shared by the height
// field and the fragment shader, so tone follows relief).
const BARS_GLSL = /* glsl */ `
#ifndef VALLEY_BARS
#define VALLEY_BARS
float landBars(vec2 p) {
  vec2 bq = vec2(p.x * 1.5 + 0.9 * snoise(vec2(p.x * 0.33, -p.y * 0.10)), -p.y * 0.36);
  float b = 1.0 - abs(snoise(bq));
  return b * b;
}
#endif
`;
const barsJS = (x, z) => { const b = 1 - Math.abs(snoise2(x * 1.5 + 0.9 * snoise2(x * 0.33, -z * 0.1), -z * 0.36)); return b * b; };
const LAND_GLSL = PROFILE_GLSL + /* glsl */ `
#ifndef VALLEY_LAND
#define VALLEY_LAND
uniform vec4 uLandA;   // peak, sharp, fill, crest jitter
uniform vec4 uLandB;   // snout depth, ice thinning (0 = no ice), unused, river carve depth
uniform sampler2D tRiver;

float lsmax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
float lsmin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }

// valley axis (year independent): where the trough and the river run
float landAxis(float D) {
  float d = max(D, 0.0);
  return 0.30 + 2.6 * sin(d * 0.034 + 0.4) * smoothstep(4.0, 45.0, d);
}

// ---- river channels: tRiver holds x(D), half width, dx/dD and wetness for RIV_ROWS channels ----
float riverCoord(float D) { float x = D / ${f(RIV.A)}; return (${f(RIV.V0)} + log(x + sqrt(x * x + 1.0)) / ${f(RIV.B)}) * ${f(RIV.N)} - 0.5; }
// x: signed distance to the nearest channel edge (negative inside), y: wetness of that channel
vec2 riverSD(vec2 p, float D) {
  float fx = riverCoord(D);
  if (fx < 0.0 || fx > ${f(RIV.N - 1.001)}) return vec2(1e3, 0.0);
  float i0 = floor(fx), fr = fx - i0;
  float sd = 1e3, wet = 0.0;
  for (int j = 0; j < ${RIV.ROWS}; j++) {
    vec4 a = texelFetch(tRiver, ivec2(int(i0), j), 0), b = texelFetch(tRiver, ivec2(int(i0) + 1, j), 0);
    vec4 r = mix(a, b, fr);
    if (r.w < 0.004) continue;
    float d = abs(p.x - r.x) / sqrt(1.0 + r.z * r.z) - r.y * min(r.w * 3.0, 1.0);
    if (d < sd) { sd = d; wet = r.w; }
  }
  return vec2(sd, wet);
}

${BARS_GLSL}
// Surface height at world xz. oct = noise octaves (0 = cheap version for shadow marching).
// info: x = F (0 floor .. 1 crest), y = ice thickness, z = carve noise (1 = rib, 0 = gully), w = u
float landEval(vec2 p, int oct, out vec4 info) {
  float D = -p.y, Dp = max(D, 0.0);
  float kd = sqrt(Dp * Dp + ${f(LC * LC)});
  float X = p.x * ${f(LK160)} / kd;
  float u = (X - 2.5) / 45.0 + 0.04;
  float peak = uLandA.x, sharp = uLandA.y, fill = uLandA.z;
  float crag = pow(sharp, 0.6);

  // --- the massif: crest depth, face run (aretes and spurs), face profile ---
  float du = u - 0.04;
  float dc = 160.0 - 22.0 * pow(min(abs(du), 1.3), 1.5) + 3.5 * sin(du * 6.0);
  float uw = u + 0.050 * snoise(vec2(D * 0.07, u * 3.0));
  if (oct > 0) uw += 0.016 * snoise(vec2(D * 0.23, u * 9.0));
  float ra = 1.0 - abs(snoise(vec2(uw * 4.3, 1.7)));
  float rib = ra * ra;
  if (oct > 0) {
    float rb = 1.0 - abs(snoise(vec2(uw * 10.0, 5.3)));
    rib = 0.68 * rib + 0.32 * rb * rb;
  } else rib *= 0.8;
  float sa = (u + 0.42) / 0.17, sb = (u - 0.38) / 0.15;
  float spur = exp(-sa * sa) + 0.85 * exp(-sb * sb);
  float ribK = mix(0.5, rib, mix(0.4, 1.0, crag));
  float Wf = (30.0 + 24.0 * spur) * (0.55 + 0.85 * ribK) * mix(1.3, 1.0, sharp);
  Wf *= 1.0 - 0.3 * sharp * smoothstep(0.02, 0.12, du) * (1.0 - smoothstep(0.25, 0.45, du));   // the steep right face
  float t = clamp(D < dc ? (dc - D) / Wf : (D - dc) / 36.0, 0.0, 1.0);
  float F = mix(pow(1.0 - t * t, 1.6), pow(1.0 - t, 1.75), crag);
  F = clamp(F + (0.9 / 37.699112) * sin(37.699112 * F + 2.5 * (1.0 - F) * snoise(vec2(u * 2.5, 1.0))) * crag * smoothstep(0.0, 0.15, F), 0.0, 1.0);   // rock bands

  // --- envelope: the skyline of valley-story.js, plus crest jitter that only exists near the crest ---
  float R = ridgeProfile(u, peak, sharp);
  float jw = smoothstep(0.25, 0.6, F);
  if (oct > 0 && R > 0.0 && jw > 0.0) {
    float j = fbm(vec2(u * 6.0, 2.7), oct > 5 ? 7 : 4);
    float fineJ = 0.0, fa = 0.0065 * sqrt(sharp);
    float ff = 48.0;
    for (int i = 0; i < 5; i++) {
      if (i >= (oct > 5 ? 5 : 2)) break;
      fineJ += fa * (1.0 - 2.0 * abs(snoise(vec2(u * ff, 5.1 + float(i)))));
      ff *= 2.0; fa *= 0.55;
    }
    R = max(R + peak * (uLandA.w * j * jw + fineJ * smoothstep(0.945, 0.995, F)) * smoothstep(0.0, 0.2, 1.0 - abs(u)) * smoothstep(0.0, 0.05, abs(du)), 0.0);
  }
  float Eenv = R / 160.0;

  // --- valley floor / apron with a trough along the valley axis, and foothills at its sides ---
  float apron = domeProfile(clamp(u, -1.0, 1.0));
  float ramp = pow(min(Dp / 112.0, 1.35), 1.35);
  float Efl = (0.070 + 0.008 * fill) * apron * ramp;
  float ax = landAxis(D);
  float tr = (p.x - ax) / (2.5 + 0.07 * Dp);
  Efl *= 1.0 - 0.35 * exp(-tr * tr) * (1.0 - 0.6 * fill);
  if (oct > 0) {
    Efl *= 1.0 + 0.10 * fbm(p * 0.11 + 31.0, 3);
    if (D > 38.0 && D < 128.0) {
      float fh = fbm(p * 0.05 + 17.0, 3);
      Efl += 0.034 * smoothstep(-0.25, 0.55, fh) * smoothstep(3.0, 13.0, abs(p.x - ax)) * smoothstep(38.0, 66.0, D) * (1.0 - smoothstep(98.0, 128.0, D)) * mix(0.55, 1.0, sharp);
    }
  }
  Efl = min(Efl, 0.9 * Eenv);
  float hm = Dp * (Efl + (Eenv - Efl) * F);

  // --- carve couloirs, gullies and crags out of the faces (never above the envelope) ---
  vec2 q = vec2(X * 0.085, D * 0.05);
  if (oct > 0) q += 0.35 * vec2(snoise(q * 0.6 + 3.1), snoise(q * 0.6 + 7.7));
  float n = ridged(q, oct > 0 ? oct : 2);
  float Hf = Dp * (Eenv - Efl) * F;
  hm -= 0.44 * Hf * pow(1.0 - F, 0.55) * mix(0.35, 1.0, crag) * (1.0 - n);
  if (oct > 0 && F > 0.04) hm -= 0.5 * crag * smoothstep(0.04, 0.2, F) * (1.0 - pow(F, 10.0)) * (1.0 - ridged(q * 3.3 + 4.0, 4));   // buttresses and towers
  // an old mountain is cut by soft gullies instead
  float gul = (1.0 - n) * (1.0 - n);
  hm -= 0.8 * (1.0 - sharp) * smoothstep(45.0, 100.0, D) * (1.0 - F * F) * smoothstep(0.0, 0.25, apron) * gul * min(Dp * Eenv * 0.2, 1.0);

  // --- lateral moraines of the ice-age glacier frame the valley floor ---
  if (oct > 0 && D > 5.0 && D < 150.0) {
    float xm = mix(0.1, ax, smoothstep(2.0, 12.0, D));
    float dm = (abs(p.x - xm) - (2.0 + 0.11 * Dp)) / (0.5 + 0.02 * Dp);
    float mo = 0.012 * Dp * smoothstep(6.0, 25.0, D) * (1.0 - smoothstep(105.0, 135.0, D)) * (1.0 - 0.8 * fill) * exp(-dm * dm) * (0.7 + 0.5 * snoise(vec2(D * 0.13, 6.6 + sign(p.x - xm))));
    hm = min(hm + mo, max(hm, Dp * 0.85 * Eenv));                    // never above the skyline
  }

  // --- flanking ridges: spurs that come down from both valley walls and recede toward the horn in
  //     layers. They rise only OUTSIDE the central outline (master frame sx 0.19 .. 0.85), so the
  //     skyline of valley-story.js is untouched where the tree's crown will stand ---
  float sk = p.x / kd, ak = abs(sk);
  float kIn = sk < 0.0 ? 0.268 : 0.303;
  float hw = 0.0;
  if (ak > kIn && D > 7.0) {
    float worn = mix(0.42, 1.0, sharp);
    if (D < 250.0) {
      // a continuous valley side, and four spurs standing out from it at increasing depth
      float dkc = ak - kIn;
      float Ec = 0.15 * (1.0 - exp(-1.1 * pow(dkc, 1.25) / 0.15)) * smoothstep(7.0, 30.0, D) * (1.0 - smoothstep(150.0, 240.0, D));
      float wav = oct > 0 ? 0.85 + 0.3 * fbm(p * 0.035 + 41.0, 3) : 1.0;
      hw = Dp * Ec * worn * wav;
      for (int j = 0; j < 4; j++) {
        float fj = float(j);
        float Dj = j == 0 ? 28.0 : (j == 1 ? 50.0 : (j == 2 ? 84.0 : 132.0));
        if (D < Dj * 0.42 || D > Dj * 1.95) continue;
        float k0 = kIn + (j == 0 ? 0.085 : (j == 1 ? 0.052 : (j == 2 ? 0.024 : 0.0)));
        float G = j == 0 ? 10.0 : (j == 1 ? 5.5 : (j == 2 ? 3.6 : 2.2));
        float Emax = j == 0 ? 0.38 : (j == 1 ? 0.34 : (j == 2 ? 0.28 : 0.21));
        float dk = ak - k0;
        if (dk <= 0.0) continue;
        float Ej = Emax * (1.0 - exp(-G * pow(dk, 1.25) / Emax));
        float Djk = Dj;
        if (oct > 0) {
          Ej *= 0.90 + 0.2 * snoise(vec2(sk * (3.0 + 1.5 * fj) + 0.3 * snoise(p * 0.06 + fj * 3.0), 2.0 + fj * 5.0 + D * 0.03));
          Djk *= 1.0 + 0.2 * snoise(vec2(sk * 2.5 + fj * 7.0, 3.0));
        }
        float tt = (D - Djk) / Djk;
        float g = tt < 0.0 ? pow(max(1.0 + tt / 0.5, 0.0), 1.6) : pow(max(1.0 - tt / 0.8, 0.0), 1.3);
        hw = max(hw, Dp * Ej * g * worn * (0.92 + 0.08 * snoise(vec2(p.x * 0.13, D * 0.11))) * wav);
      }
    }
    if (D > 195.0) {
      float Efar = 0.0125 * (0.6 + 0.6 * fbm(vec2(sk * 5.0, 23.0), 4)) * smoothstep(kIn, kIn + 0.03, ak);
      hw = max(hw, Dp * Efar * smoothstep(200.0, 285.0, D) * mix(0.6, 1.0, sharp));
    }
  }
  float bed = hw > 0.0 ? lsmax(hm, hw, clamp(0.6 * hw, 1e-3, 0.5)) : hm;

  // --- outwash plain: gravel bars and channels with gentle relief. The line of sight from the
  //     master camera to the seed's spot stays level (and all of it stays below eye height) ---
  if (oct > 0 && Dp < 60.0) {
    float cd = length(vec2(p.x, p.y + 1.5 * clamp(-p.y / 1.5, 0.0, 1.0)));
    float pad = smoothstep(0.12, 1.0, cd);
    float relief = 0.0075 * fbm(p * 0.55 + 5.0, 3) - 0.0065 * (landBars(p) - 0.33) + 0.002 * fbm(p * 3.1, 2);
    bed += relief * pad * (1.0 - smoothstep(20.0, 60.0, Dp)) * (1.0 - 0.4 * fill);
  }
  // --- river bed ---
  if (oct > 0 && uLandB.w > 0.0 && D < 30.0) {
    vec2 rv = riverSD(p, D);
    bed -= uLandB.w * min(rv.y * 3.0, 1.0) * (1.0 - smoothstep(-0.012, 0.02, rv.x));
  }

  // --- glacier: an ice surface designed in the same perspective, capped near the snout and
  //     broken into seracs by crevasses toward its front ---
  float ice = 0.0;
  if (uLandB.y > 0.0) {
    float xi = mix(0.1, ax, smoothstep(2.0, 12.0, D));
    float b = D - uLandB.x;
    if (b > 0.0) {
      float Wx = min(2.2 * sqrt(b * (1.0 + 0.012 * b)), 2.0 + 0.11 * Dp);
      Wx *= 1.0 + 0.16 * snoise(vec2(D * 0.11, 4.1 + sign(p.x - xi)));
      float lat = 1.0 - pow((p.x - xi) / Wx, 2.0);
      if (lat > 0.0) {
        float Ei = 0.026 + 0.012 * (1.0 - exp(-b / 22.0)) + 0.040 * pow(Dp / 112.0, 1.2);
        float rough = 1.0;
        if (oct > 0) {
          float front = exp(-b / 1.6);
          float cv = 1.0 - abs(snoise(vec2(p.x * 2.6 + 0.8 * snoise(vec2(p.x * 0.9, D * 1.3)), D * 5.0)));
          float crev = smoothstep(0.72, 0.96, cv);
          rough = 1.0 + 0.05 * snoise(vec2(p.x * 1.9, D * 0.8)) * exp(-b / 30.0) + 0.02 * snoise(vec2(p.x * 0.5, D * 0.21))
                + front * (0.24 * snoise(vec2(p.x * 3.1, D * 2.3)) + 0.12 * snoise(vec2(p.x * 11.0, D * 5.0)))
                - crev * (0.5 * front + 0.10 * exp(-b / 14.0));
          rough = max(rough, 0.5);
        }
        float surf = Dp * Ei * uLandB.y * pow(lat, mix(0.3, 1.0, smoothstep(35.0, 110.0, D))) * rough;
        float cap = 0.05 * (1.0 - exp(-b / 0.04)) + 0.22 * sqrt(b);
        // ... and never above the skyline as the master camera sees it (true fan coordinate)
        float EenvS = ridgeProfile((p.x * 160.0 / max(D, 0.3) - 2.5) / 45.0 + 0.04, peak, sharp) / 160.0;
        ice = max(lsmin(min(surf, max(Dp * 0.9 * EenvS, bed)) - bed, cap, 0.05), 0.0);
      }
    }
  }
  info = vec4(F, ice, n, u);
  return bed + ice;
}
#endif
`;

/** JS mirror of landEval(). S: { peak, sharp, fill, jitter, snout, iceThin, carve, river } */
function landJS(x, z, S, oct = 5) {
  const D = -z, Dp = Math.max(D, 0);
  const kd = Math.sqrt(Dp * Dp + LC * LC);
  const X = (x * LK160) / kd;
  const u = (X - 2.5) / 45 + 0.04;
  const { peak, sharp, fill } = S;
  const crag = Math.pow(sharp, 0.6);
  const du = u - 0.04;
  const dc = 160 - 22 * Math.pow(Math.min(Math.abs(du), 1.3), 1.5) + 3.5 * Math.sin(du * 6);
  let uw = u + 0.05 * snoise2(D * 0.07, u * 3);
  if (oct > 0) uw += 0.016 * snoise2(D * 0.23, u * 9);
  const ra = 1 - Math.abs(snoise2(uw * 4.3, 1.7));
  let rib = ra * ra;
  if (oct > 0) {
    const rb = 1 - Math.abs(snoise2(uw * 10, 5.3));
    rib = 0.68 * rib + 0.32 * rb * rb;
  } else rib *= 0.8;
  const sa = (u + 0.42) / 0.17, sb = (u - 0.38) / 0.15;
  const spur = Math.exp(-sa * sa) + 0.85 * Math.exp(-sb * sb);
  const ribK = lerp(0.5, rib, lerp(0.4, 1, crag));
  let Wf = (30 + 24 * spur) * (0.55 + 0.85 * ribK) * lerp(1.3, 1, sharp);
  Wf *= 1 - 0.3 * sharp * sstep(0.02, 0.12, du) * (1 - sstep(0.25, 0.45, du));
  const t = clamp01(D < dc ? (dc - D) / Wf : (D - dc) / 36);
  let F = lerp(Math.pow(1 - t * t, 1.6), Math.pow(1 - t, 1.75), crag);
  F = clamp01(F + (0.9 / 37.699112) * Math.sin(37.699112 * F + 2.5 * (1 - F) * snoise2(u * 2.5, 1)) * crag * sstep(0, 0.15, F));
  let R = peak * lerp(dome(u), p0(u), sharp);
  const jw = sstep(0.25, 0.6, F);
  if (oct > 0 && R > 0 && jw > 0) {
    const j = fbm2(u * 6, 2.7, oct > 5 ? 7 : 4);
    let fineJ = 0, fa = 0.0065 * Math.sqrt(sharp), ff = 48;
    for (let i = 0; i < (oct > 5 ? 5 : 2); i++) { fineJ += fa * (1 - 2 * Math.abs(snoise2(u * ff, 5.1 + i))); ff *= 2; fa *= 0.55; }
    R = Math.max(R + peak * (S.jitter * j * jw + fineJ * sstep(0.945, 0.995, F)) * sstep(0, 0.2, 1 - Math.abs(u)) * sstep(0, 0.05, Math.abs(du)), 0);
  }
  const Eenv = R / 160;
  const apron = dome(Math.min(1, Math.max(-1, u)));
  const ramp = Math.pow(Math.min(Dp / 112, 1.35), 1.35);
  let Efl = (0.070 + 0.008 * fill) * apron * ramp;
  const ax = axisJS(D);
  const tr = (x - ax) / (2.5 + 0.07 * Dp);
  Efl *= 1 - 0.35 * Math.exp(-tr * tr) * (1 - 0.6 * fill);
  if (oct > 0) {
    Efl *= 1 + 0.1 * fbm2(x * 0.11 + 31, z * 0.11 + 31, 3);
    if (D > 38 && D < 128) {
      const fh = fbm2(x * 0.05 + 17, z * 0.05 + 17, 3);
      Efl += 0.034 * sstep(-0.25, 0.55, fh) * sstep(3, 13, Math.abs(x - ax)) * sstep(38, 66, D) * (1 - sstep(98, 128, D)) * lerp(0.55, 1, sharp);
    }
  }
  Efl = Math.min(Efl, 0.9 * Eenv);
  let hm = Dp * (Efl + (Eenv - Efl) * F);
  let qx = X * 0.085, qy = D * 0.05;
  if (oct > 0) {
    const wx = snoise2(qx * 0.6 + 3.1, qy * 0.6 + 3.1), wy = snoise2(qx * 0.6 + 7.7, qy * 0.6 + 7.7);
    qx += 0.35 * wx; qy += 0.35 * wy;
  }
  const n = ridged2(qx, qy, oct > 0 ? oct : 2);
  const Hf = Dp * (Eenv - Efl) * F;
  hm -= 0.44 * Hf * Math.pow(1 - F, 0.55) * lerp(0.35, 1, crag) * (1 - n);
  if (oct > 0 && F > 0.04) hm -= 0.5 * crag * sstep(0.04, 0.2, F) * (1 - Math.pow(F, 10)) * (1 - ridged2(qx * 3.3 + 4, qy * 3.3 + 4, 4));
  const gul = (1 - n) * (1 - n);
  hm -= 0.8 * (1 - sharp) * sstep(45, 100, D) * (1 - F * F) * sstep(0, 0.25, apron) * gul * Math.min(Dp * Eenv * 0.2, 1);
  if (oct > 0 && D > 5 && D < 150) {
    const xm = lerp(0.1, ax, sstep(2, 12, D));
    const dm = (Math.abs(x - xm) - (2 + 0.11 * Dp)) / (0.5 + 0.02 * Dp);
    const mo = 0.012 * Dp * sstep(6, 25, D) * (1 - sstep(105, 135, D)) * (1 - 0.8 * fill) * Math.exp(-dm * dm) * (0.7 + 0.5 * snoise2(D * 0.13, 6.6 + Math.sign(x - xm)));
    hm = Math.min(hm + mo, Math.max(hm, Dp * 0.85 * Eenv));
  }
  const sk = x / kd, ak = Math.abs(sk);
  const kIn = sk < 0 ? 0.268 : 0.303;
  let hw = 0;
  if (ak > kIn && D > 7) {
    const worn = lerp(0.42, 1, sharp);
    if (D < 250) {
      const dkc = ak - kIn;
      const Ec = 0.15 * (1 - Math.exp((-1.1 * Math.pow(dkc, 1.25)) / 0.15)) * sstep(7, 30, D) * (1 - sstep(150, 240, D));
      const wav = oct > 0 ? 0.85 + 0.3 * fbm2(x * 0.035 + 41, z * 0.035 + 41, 3) : 1;
      hw = Dp * Ec * worn * wav;
      const DJ = [28, 50, 84, 132], K0 = [0.085, 0.052, 0.024, 0], GG = [10, 5.5, 3.6, 2.2], EM = [0.38, 0.34, 0.28, 0.21];
      for (let j = 0; j < 4; j++) {
        if (D < DJ[j] * 0.42 || D > DJ[j] * 1.95) continue;
        const dk = ak - (kIn + K0[j]);
        if (dk <= 0) continue;
        let Ej = EM[j] * (1 - Math.exp((-GG[j] * Math.pow(dk, 1.25)) / EM[j]));
        let Djk = DJ[j];
        if (oct > 0) {
          Ej *= 0.9 + 0.2 * snoise2(sk * (3 + 1.5 * j) + 0.3 * snoise2(x * 0.06 + j * 3, z * 0.06 + j * 3), 2 + j * 5 + D * 0.03);
          Djk *= 1 + 0.2 * snoise2(sk * 2.5 + j * 7, 3);
        }
        const tt = (D - Djk) / Djk;
        const g = tt < 0 ? Math.pow(Math.max(1 + tt / 0.5, 0), 1.6) : Math.pow(Math.max(1 - tt / 0.8, 0), 1.3);
        hw = Math.max(hw, Dp * Ej * g * worn * (0.92 + 0.08 * snoise2(x * 0.13, D * 0.11)) * wav);
      }
    }
    if (D > 195) {
      const Efar = 0.0125 * (0.6 + 0.6 * fbm2(sk * 5, 23, 4)) * sstep(kIn, kIn + 0.03, ak);
      hw = Math.max(hw, Dp * Efar * sstep(200, 285, D) * lerp(0.6, 1, sharp));
    }
  }
  const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  let bed = hw > 0 ? smax(hm, hw, Math.min(0.5, Math.max(0.6 * hw, 1e-3))) : hm;
  if (oct > 0 && Dp < 60) {
    const cd = Math.hypot(x, z + 1.5 * clamp01(-z / 1.5));
    const pad = sstep(0.12, 1, cd);
    const relief = 0.0075 * fbm2(x * 0.55 + 5, z * 0.55 + 5, 3) - 0.0065 * (barsJS(x, z) - 0.33) + 0.002 * fbm2(x * 3.1, z * 3.1, 2);
    bed += relief * pad * (1 - sstep(20, 60, Dp)) * (1 - 0.4 * fill);
  }
  if (oct > 0 && S.carve > 0 && D < 30 && S.river) {
    const [sd, wet] = riverSDJS(S.river, x, D);
    bed -= S.carve * Math.min(wet * 3, 1) * (1 - sstep(-0.012, 0.02, sd));
  }
  let ice = 0;
  if (S.iceThin > 0) {
    const xi = lerp(0.1, ax, sstep(2, 12, D));
    const b = D - S.snout;
    if (b > 0) {
      let Wx = Math.min(2.2 * Math.sqrt(b * (1 + 0.012 * b)), 2 + 0.11 * Dp);
      Wx *= 1 + 0.16 * snoise2(D * 0.11, 4.1 + Math.sign(x - xi));
      const lat = 1 - Math.pow((x - xi) / Wx, 2);
      if (lat > 0) {
        const Ei = 0.026 + 0.012 * (1 - Math.exp(-b / 22)) + 0.04 * Math.pow(Dp / 112, 1.2);
        let rough = 1;
        if (oct > 0) {
          const front = Math.exp(-b / 1.6);
          const cv = 1 - Math.abs(snoise2(x * 2.6 + 0.8 * snoise2(x * 0.9, D * 1.3), D * 5));
          const crev = sstep(0.72, 0.96, cv);
          rough = 1 + 0.05 * snoise2(x * 1.9, D * 0.8) * Math.exp(-b / 30) + 0.02 * snoise2(x * 0.5, D * 0.21)
            + front * (0.24 * snoise2(x * 3.1, D * 2.3) + 0.12 * snoise2(x * 11, D * 5))
            - crev * (0.5 * front + 0.1 * Math.exp(-b / 14));
          rough = Math.max(rough, 0.5);
        }
        const surf = Dp * Ei * S.iceThin * Math.pow(lat, lerp(0.3, 1, sstep(35, 110, D))) * rough;
        const cap = 0.05 * (1 - Math.exp(-b / 0.04)) + 0.22 * Math.sqrt(b);
        const uS = ((x * 160) / Math.max(D, 0.3) - 2.5) / 45 + 0.04;
        const EenvS = (peak * lerp(dome(uS), p0(uS), sharp)) / 160;
        ice = Math.max(smin(Math.min(surf, Math.max(Dp * 0.9 * EenvS, bed)) - bed, cap, 0.05), 0);
      }
    }
  }
  return { h: bed + ice, bed, ice, F, u };
}
const axisJS = (D) => { const d = Math.max(D, 0); return 0.30 + 2.6 * Math.sin(d * 0.034 + 0.4) * sstep(4, 45, d); };

// ---------------------------------------------------------------------------------------------
// River: LINE curves sampled into x(D) rows (stem, four weaving braids, three side threads)
const rivD = (i) => RIV.A * Math.sinh(((i + 0.5) / RIV.N - RIV.V0) * RIV.B);
const RIV_D = Float32Array.from({ length: RIV.N }, (_, i) => rivD(i));
const rivCoordJS = (D) => { const x = D / RIV.A; return (RIV.V0 + Math.log(x + Math.sqrt(x * x + 1)) / RIV.B) * RIV.N - 0.5; };
const RIV_FROM = 132, RIV_TO = -22, RIV_LEN = RIV_FROM - RIV_TO;

/**
 * Fill `data` (RIV.N * RIV.ROWS * 4 floats: x, half width, dx/dD, wetness) for a story year.
 * tip: depth of the river's head (wet from the source down to the tip); null = whole course.
 */
function buildRiver(data, yr, tip, source) {
  const vs = valleyState(yr);
  const braid = vs.braid, mature = clamp01(yr / 2600), flow = 0.35 + 0.65 * clamp01(yr / 220);
  const phase = yr / 950;
  const N = RIV.N;
  const amp = lerp(2.9, 1.1, braid) / RIV_LEN, wl = lerp(30, 17, braid) / RIV_LEN;
  const main = createLine({
    seed: 'grain-river', from: [0, RIV_FROM], to: [0, RIV_TO], segments: 512,
    meander: amp, wavelength: wl, octaves: 3, roughness: 0.55, phase, pin: [0.06, 0.1],
    branches: 3, levels: 1, branchAngle: 9, angleJitter: 3, branchLength: 0.09, branchFrom: [0.76, 0.9], branchSide: 'alternate',
  });
  const stemOff = new Float32Array(N);
  const offAt = (curve, D) => { // lateral offset of a stem-like curve (chord along D) at depth D
    const s = clamp01((RIV_FROM - D) / RIV_LEN) * (curve.n - 1), i = Math.min(curve.n - 2, Math.floor(s)), fr = s - i;
    return curve.points[i * 2] + (curve.points[i * 2 + 2] - curve.points[i * 2]) * fr;
  };
  // valley-width envelope: pinned beside the seed's spot, widest mid-valley, narrow at the source
  const env = (D) => sstep(1.2, 13, D) * (1 - 0.65 * sstep(90, 125, D));
  const exit = (D) => 0.1 * (Math.sqrt((D - 1.4) * (D - 1.4) + 0.25) - (D - 1.4)) // drifts right behind the camera
    + (0.05 * Math.sin(D * 2.9 + 1.0) + 0.03 * Math.sin(D * 6.7)) * (1 - sstep(4, 12, D)) * sstep(-0.4, 0.6, Math.abs(D - 1.5));
  const wetAt = (D, tipD) => sstep(0, 1.2, source - D) * (tipD == null ? 1 : sstep(0, 0.35, D - tipD));
  const widthK = (D) => 1 + 0.06 * Math.max(D, 0);
  // channels swell and pinch along their course (fixed in the valley, so it does not flicker with the year)
  const put = (row, i, x, hw, wet) => { const o = (row * N + i) * 4; data[o] = x; data[o + 1] = hw * (0.95 + 0.45 * snoise2(RIV_D[i] * 0.42, row * 3.7 + 1.3) + 0.2 * snoise2(RIV_D[i] * 1.7, row * 5.1)); data[o + 3] = wet; };

  for (let i = 0; i < N; i++) {
    const D = RIV_D[i];
    stemOff[i] = offAt(main.stem, D) * env(D);
    const x = axisJS(D) + exit(D) + stemOff[i];
    put(0, i, x, lerp(0.034, 0.06, mature) * flow * widthK(D) * (1 + 1.3 * braid * (1 - sstep(1.5, 8, D))), wetAt(D, tip));
  }
  // four braids: independent LINE stems on the same course that weave around the main channel
  for (let j = 0; j < 4; j++) {
    const present = sstep(0.08 + 0.17 * j, 0.3 + 0.17 * j, braid);
    const b = present > 0 ? createLine({
      seed: 'grain-braid-' + j, from: [0, RIV_FROM], to: [0, RIV_TO], segments: 512,
      meander: (1.5 + 0.4 * j) / RIV_LEN, wavelength: (8.5 + 3.0 * j) / RIV_LEN, octaves: 3, roughness: 0.6,
      phase: phase * 1.7 + j * 0.37, pin: [0.05, 0.05], branches: 0,
    }).stem : null;
    for (let i = 0; i < N; i++) {
      const D = RIV_D[i];
      if (!b) { put(1 + j, i, 0, 0, 0); continue; }
      const spread = sstep(-18, 3.5, D) * 0.35 + 0.65 * sstep(1.5, 9, D);          // braids fan out away from the seed's spot
      const off = stemOff[i] + offAt(b, D) * (0.25 + 0.75 * env(D)) * spread * present;
      const lag = tip == null ? null : tip + 0.8 + 1.1 * j;                          // braids follow the head
      put(1 + j, i, axisJS(D) + exit(D) + off, 0.026 * flow * widthK(D) * (0.6 + 0.4 * present), wetAt(D, lag) * present * sstep(2.0, 7.0, D));
    }
  }
  // three side threads: true LINE branches that leave the stem near the camera and rejoin it
  for (let j = 0; j < 3; j++) {
    const c = main.branches[j], row = 5 + j, present = sstep(0.25, 0.7, braid);
    for (let i = 0; i < N; i++) put(row, i, 0, 0, 0);
    if (!c || present <= 0) continue;
    const p = c.points, d0 = p[1], d1 = p[c.n * 2 - 1];
    let k = 0;
    for (let i = N - 1; i >= 0; i--) {
      const D = RIV_D[i];
      if (D > d0 || D < d1) continue;
      while (k < c.n - 2 && p[(k + 1) * 2 + 1] > D) k++;
      const y0 = p[k * 2 + 1], y1 = p[k * 2 + 3], fr = y1 === y0 ? 0 : (D - y0) / (y1 - y0);
      const s = (d0 - D) / (d0 - d1);
      const raw = (p[k * 2] + (p[k * 2 + 2] - p[k * 2]) * fr) * env(Math.max(D, 3));
      const off = lerp(raw, stemOff[i], sstep(0.55, 1, s));                              // rejoin
      const lag = tip == null ? null : tip + 0.5;
      put(row, i, axisJS(D) + exit(D) + off, 0.02 * flow * widthK(D), wetAt(D, lag) * present * sstep(0, 0.12, s) * (1 - sstep(0.9, 1, s)) * sstep(2.0, 7.0, D));
    }
  }
  // slopes
  for (let r = 0; r < RIV.ROWS; r++) {
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      data[(r * N + i) * 4 + 2] = (data[(r * N + b) * 4] - data[(r * N + a) * 4]) / (RIV_D[b] - RIV_D[a]);
    }
  }
  return data;
}
function riverSDJS(data, x, D) {
  const fx = rivCoordJS(D);
  if (fx < 0 || fx > RIV.N - 1.001) return [1e3, 0];
  const i0 = Math.floor(fx), fr = fx - i0;
  let sd = 1e3, wet = 0;
  for (let j = 0; j < RIV.ROWS; j++) {
    const a = (j * RIV.N + i0) * 4, b = a + 4;
    const w = lerp(data[a + 3], data[b + 3], fr);
    if (w < 0.004) continue;
    const rx = lerp(data[a], data[b], fr), ry = lerp(data[a + 1], data[b + 1], fr), rz = lerp(data[a + 2], data[b + 2], fr);
    const d = Math.abs(x - rx) / Math.sqrt(1 + rz * rz) - ry * Math.min(w * 3, 1);
    if (d < sd) { sd = d; wet = w; }
  }
  return [sd, wet];
}

// ---------------------------------------------------------------------------------------------
// Clouds: two plane layers of drifting noise, shared by the sky (as clouds) and the land (as shadows)
const CLOUD_GLSL = /* glsl */ `
#ifndef VALLEY_CLOUD
#define VALLEY_CLOUD
uniform vec4 uCloud;    // cover, phase (distance travelled), streak, shadow strength
uniform vec4 uCloud2;   // wind dir x, wind dir z, unused, unused
float cloudDensity(vec2 xz, float layer, int oct) {
  vec2 w = uCloud2.xy;
  vec2 r = vec2(dot(xz, w), dot(xz, vec2(-w.y, w.x)));
  float st = mix(1.0, 0.2, uCloud.z);
  float sc = layer > 0.5 ? 0.0085 : 0.019;
  float sp = layer > 0.5 ? 1.7 : 1.0;
  vec2 q = vec2((r.x - uCloud.y * sp) * st, r.y) * sc + layer * 17.3;
  float d = fbm(q, oct) + 0.3 * snoise(q * 0.45 + vec2(uCloud.y * sc * 0.45, 3.0 + layer));
  float thr = 1.0 - uCloud.x * (layer > 0.5 ? 0.85 : 1.1);
  return smoothstep(thr, thr + 0.42, d * 0.6 + 0.5);
}
float cloudShadow(vec3 p, vec3 Ld) {
  if (uCloud.w <= 0.0 || Ld.y < 0.04) return 1.0;
  vec2 q0 = p.xz + Ld.xz * ((${f(CLOUD_H[0])} - p.y) / Ld.y);
  vec2 q1 = p.xz + Ld.xz * ((${f(CLOUD_H[1])} - p.y) / Ld.y);
  float d = cloudDensity(q0, 0.0, 3) * 0.85 + cloudDensity(q1, 1.0, 3) * 0.35;
  return 1.0 - uCloud.w * min(d, 1.0) * smoothstep(0.04, 0.2, Ld.y);
}
#endif
`;

// ---------------------------------------------------------------------------------------------
// Terrain material. The heavy, smooth work (height, macro normal, self shadow, cloud shadow,
// aerial perspective) is done per vertex on a grid that is about 2 px dense in the master frame;
// the fragment shader only adds detail and materials.
const LIGHT_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uKeyDir, uKeyColor, uFillDir, uFillColor, uAmbient, uBounce;
uniform vec3 uAlpenColor;
uniform vec4 uAlpen;        // x: terminator height (below = in shadow), y: softness, z: tint range
uniform vec4 uFogA;         // density, falloff, base height, gain
uniform vec3 uFogColor, uFogSunColor, uMoonHaze;
uniform vec4 uTwHaze;
uniform vec4 uSnow;         // snowline, firn offset, vegetation, wetness of the fresh bed
uniform vec4 uSnow2;        // ground snow 0..1, fill light on high ground, 0, 0
uniform vec4 uSkyRefl;      // horizon reflection colour (rgb), sparkle
uniform vec3 uSkyReflZ;     // zenith reflection colour
uniform float uPixel;       // radians per pixel
uniform float uStone;       // 1 when the camera stands at the master position (stone impostors on)
uniform float uMoonlit;     // 0..1 night: colours drain toward grey-blue
uniform vec3 uVegTint;      // seasonal tint of grass
uniform vec4 uScar;         // fresh rock where a slab has left the face: xyz centre, w strength
uniform vec4 uShaft;        // sun shafts: strength, river gold (0 = silver river, the default), river calm (0 = full sun dazzle, the default), 0
uniform vec4 uSilver;       // the river's silver by night: rgb, amount
uniform vec3 uRim;          // cool rim light on ridges by night
`;

// Sun shafts: a fan of brighter and darker beams around the solar and the antisolar point
// (crepuscular and anticrepuscular rays), fixed to the sun's direction.
const SHAFT_GLSL = /* glsl */ `
float sunShafts(vec3 rd) {
  if (uShaft.x <= 0.0) return 1.0;
  vec3 sd = uSunDir;
  vec3 a = normalize(cross(sd, vec3(0.0, 1.0, 0.0)));
  vec3 b = cross(a, sd);
  float c = dot(rd, sd);
  vec2 d2 = vec2(dot(rd, a), dot(rd, b));
  d2 /= max(length(d2), 1e-4);
  float beams = snoise(d2 * 2.3 + 3.1) * 0.6 + snoise(d2 * 6.1 + 9.0) * 0.4;
  float nearAxis = exp(-(1.0 - abs(c)) * 4.5);
  return 1.0 + uShaft.x * beams * nearAxis;
}
`;
const TERRAIN_VERT = '#define SKY_STEPS 8\n' + SKY + FOG + LAND_GLSL + CLOUD_GLSL + LIGHT_UNIFORMS_GLSL + SHAFT_GLSL + /* glsl */ `
uniform int uOct;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vInfo;     // F, ice thickness, carve noise, u
varying vec4 vLit;      // key visibility (self shadow * terminator), cloud shadow, fog amount, alpenglow tint
varying vec3 vAerT;
varying vec3 vAerL;

float landShadow(vec3 p, vec3 Ld) {
  float res = 1.0, t = 0.45;
  vec4 inf;
  for (int i = 0; i < 5; i++) {
    vec3 q = p + Ld * t;
    float h = q.y - landEval(q.xz, 0, inf);
    res = min(res, 5.0 * h / t);
    if (res < 0.02 || q.y > uLandA.x + 1.0) break;
    t += clamp(h * 0.8, 0.7 + t * 0.7, 30.0);
  }
  return smoothstep(0.0, 1.0, res);
}

void main() {
  float D = position.y;
  float duG = (position.x * ${f(LK160)} - 2.5) / 45.0;
  D += (-22.0 * pow(min(abs(duG), 1.3), 1.5) + 3.5 * sin(duG * 6.0)) * smoothstep(95.0, 135.0, D) * (1.0 - smoothstep(172.0, 195.0, D));
  float kd = sqrt(max(D, 0.0) * max(D, 0.0) + ${f(LC * LC)});
  vec2 xz = vec2(position.x * kd, -D);
  vNormal = vec3(0.0, 1.0, 0.0);
  vInfo = vec4(0.0);
  vLit = vec4(1.0, 1.0, 0.0, 1.0);
  vAerT = vec3(1.0);
  vAerL = vec3(0.0);
  // far outside the frustum sideways: skip everything (its triangles cannot reach the screen)
  vec4 c0 = projectionMatrix * viewMatrix * vec4(xz.x, 0.0, xz.y, 1.0);
  if (c0.w > 1.0 && abs(c0.x) > c0.w * 1.45 + 4.0) { vWorld = vec3(xz.x, 0.0, xz.y); gl_Position = c0; return; }
  vec4 info;
  float h = landEval(xz, uOct, info);
  vec3 wp = vec3(xz.x, h, xz.y);
  vWorld = wp;
  vInfo = info;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  float w = gl_Position.w;
  bool back = cameraPosition.y < 1.0 && D > 167.0 && D < 196.0 && abs(info.w) < 1.0;      // far side of the massif
  if (!back && w > -3.0 && abs(gl_Position.x) < w * 1.3 + 3.0 && abs(gl_Position.y) < w * 1.3 + 3.0) {
    if (uOct > 5) {
      float e = 0.05;
      vec4 tmp;
      float hx = landEval(xz + vec2(e, 0.0), uOct, tmp), hz = landEval(xz + vec2(0.0, e), uOct, tmp);
      vNormal = normalize(vec3(h - hx, e, h - hz));
    } else if (abs(position.x) > 0.44 && D > 7.0 && D < 250.0) {
      // valley walls: the grid is coarse out here, so the facet normal would streak the cliffs
      float e = max(0.12, 0.01 * D);
      vec4 tmp;
      float h0 = landEval(xz, 0, tmp);
      float hx = landEval(xz + vec2(e, 0.0), 0, tmp), hz = landEval(xz + vec2(0.0, e), 0, tmp);
      vNormal = normalize(vec3(h0 - hx, e, h0 - hz));
    }
    // key light: terminator (alpenglow line), then self shadow
    float term = uAlpen.x < -50.0 ? 1.0 : smoothstep(uAlpen.x - uAlpen.y, uAlpen.x + uAlpen.y, wp.y + 0.6 * (info.z - 0.5));
    float vis = term;
    if (vis > 0.0 && uKeyDir.y < 0.92) vis *= landShadow(wp + vec3(0.0, 0.12, 0.0), uKeyDir);
    float tint = uAlpen.x < -50.0 ? 1.0 : smoothstep(0.0, uAlpen.z, wp.y - uAlpen.x);
    // aerial perspective and valley haze
    vec3 toP = wp - cameraPosition;
    float dist = length(toP);
    vec3 rd = toP / max(dist, 1e-4);
    vec3 T;
    vec3 dir = normalize(vec3(rd.x, max(rd.y, -0.02), rd.z));
    vec3 L = atmosphere(dir, dist * uAtmo2.x, T);
    L = L * (1.0 - 0.9 * uTwHaze.a) + uTwHaze.rgb * uTwHaze.a * (1.0 - dot(T, vec3(0.3333)));
    L *= sunShafts(rd);
    L += uMoonHaze * (1.0 - T);
    float fog = heightFog(cameraPosition, rd, dist, uFogA.x, uFogA.y, uFogA.z);
    vLit = vec4(vis, cloudShadow(wp, uKeyDir), fog, tint);
    vAerT = T;
    vAerL = L;
  }
}`;

const TERRAIN_FRAG = NOISE + FOG + BARS_GLSL + CLOUD_GLSL + /* glsl */ `
uniform vec4 uLandA;
uniform vec4 uLandB;
uniform sampler2D tRiver;
uniform float uSkyTime;
uniform int uOct;
` + LIGHT_UNIFORMS_GLSL + /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vInfo;
varying vec4 vLit;
varying vec3 vAerT;
varying vec3 vAerL;

float riverCoord(float D) { float x = D / ${f(RIV.A)}; return (${f(RIV.V0)} + log(x + sqrt(x * x + 1.0)) / ${f(RIV.B)}) * ${f(RIV.N)} - 0.5; }
// x: signed distance to the nearest channel edge, y: wetness, z: slope dx/dD of that channel
vec3 riverSD(vec2 p, float D) {
  float fx = riverCoord(D);
  if (fx < 0.0 || fx > ${f(RIV.N - 1.001)}) return vec3(1e3, 0.0, 0.0);
  float i0 = floor(fx), fr = fx - i0;
  float sd = 1e3, wet = 0.0, sl = 0.0;
  for (int j = 0; j < ${RIV.ROWS}; j++) {
    vec4 a = texelFetch(tRiver, ivec2(int(i0), j), 0), b = texelFetch(tRiver, ivec2(int(i0) + 1, j), 0);
    vec4 r = mix(a, b, fr);
    if (r.w < 0.004) continue;
    float d = abs(p.x - r.x) / sqrt(1.0 + r.z * r.z) - r.y * min(r.w * 3.0, 1.0);
    if (d < sd) { sd = d; wet = r.w; sl = r.z; }
  }
  return vec3(sd, wet, sl);
}

void main() {
  vec3 p = vWorld;
  float D = -p.z;
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  vec3 rd = -toCam / dist;
  vec3 nG = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (nG.y < 0.0) nG = -nG;
  if (uOct > 5) nG = normalize(vNormal);
  float wallK = 0.0;
  if (uOct <= 5) {
    float akF = abs(p.x) / sqrt(max(D, 0.0) * max(D, 0.0) + ${f(LC * LC)});
    wallK = smoothstep(0.268, 0.30, akF) * smoothstep(7.0, 12.0, D);
    nG = normalize(mix(nG, normalize(vNormal), 0.85 * wallK * smoothstep(0.45, 0.52, akF)));   // the outer grid is coarse: smooth normal there
  }
  float F = vInfo.x, iceT = vInfo.y, cn = vInfo.z, u = vInfo.w;
  if (uOct > 5) {                                         // long lens: the carve noise per pixel, not per vertex
    float kdT = sqrt(max(D, 0.0) * max(D, 0.0) + ${f(LC * LC)});
    vec2 qT = vec2(p.x * ${f(LK160)} / kdT * 0.085, D * 0.05);
    qT += 0.35 * vec2(snoise(qT * 0.6 + 3.1), snoise(qT * 0.6 + 7.7));
    cn = ridged(qT, 7);
  }
  float sharp = uLandA.y;
  float veg = uSnow.z, cold = uSnow.w;
  vec2 fw = fwidth(p.xz);
  float fp = max(max(fw.x, fw.y) * 0.7, dist * uPixel);     // pixel footprint (world units), long at grazing angles
  float near = 1.0 - smoothstep(0.004, 0.03, fp);         // boulder-scale detail visible
  float mid = 1.0 - smoothstep(0.03, 0.25, fp);

  // ---- detail noise ----
  vec2 ps = p.xz + p.y * vec2(0.83, 0.57);                 // sheared by height: isotropic on steep faces
  float d1 = fbm(ps * 0.9 + 13.0, 3);
  float d2 = snoise(ps * 7.0 + 4.0) * mid;
  float d3 = near > 0.0 ? snoise(ps * 61.0) * near : 0.0;
  vec2 dn = 0.20 * mid * vec2(snoise(ps * 4.3 + 1.7), snoise(ps * 4.3 + 8.3));
  if (near > 0.0) dn += 0.30 * near * vec2(snoise(ps * 47.0 + 2.0), snoise(ps * 47.0 + 5.0));
  float face = smoothstep(0.03, 0.22, F);
  float slope = 1.0 - nG.y;
  // steep rock is textured in 3D (no stretching down the cliffs)
  float steepK = smoothstep(0.18, 0.4, slope) * max(wallK, face);
  float t3 = 0.0;
  if (steepK > 0.0 && mid > 0.0) {
    t3 = snoise(p * vec3(1.1, 2.4, 1.1) + 5.0) * 0.6 + snoise(p * vec3(3.7, 6.5, 3.7)) * 0.4;
    d1 = mix(d1, t3, steepK);
    dn += 0.35 * steepK * mid * vec2(snoise(p * vec3(5.1, 9.0, 5.1) + 2.0), snoise(p * vec3(5.1, 9.0, 5.1) + 9.0));
  }
  vec3 n = normalize(nG + vec3(dn.x, 0.0, dn.y) * (0.5 + 0.8 * max(face, wallK)));

  // ---- rock, scree ----
  float strata = 0.5 + 0.5 * sin((p.y * 2.3 + d1 * 0.9 + u * 2.0) * 6.2832);
  vec3 rock = mix(vec3(0.07, 0.068, 0.072), vec3(0.21, 0.19, 0.175), clamp(0.45 * strata + 0.4 * d1 + 0.35 + 0.25 * (cn - 0.5), 0.0, 1.0));
  rock = mix(rock * vec3(1.1, 0.98, 0.88), rock * vec3(0.62, 0.68, 0.80), cold);        // cold slate in the ice age, weathers warmer
  float cellR = 0.5, joint = 0.0;
  if (mid > 0.0 && (face > 0.0 || slope > 0.1)) {
    vec3 pj = vec3(ps * 2.6, p.y * 3.4);
    vec2 wj = worley(pj);
    joint = (1.0 - smoothstep(0.02, 0.12, wj.y - wj.x)) * mid;
    cellR = hash13(floor(pj + 0.5 * wj.x));
    rock *= 0.78 + 0.5 * cellR;
    rock = mix(rock, rock * 0.45, joint * 0.8);
  }
  // the scar a slab leaves: fresh dark rock, no snow
  float scar = 0.0;
  if (uScar.w > 0.0) {
    vec3 sX = normalize(vec3(1.0, 0.0, 0.25)), sY = normalize(vec3(-0.12, 0.80, -0.60));
    vec3 dS = p - uScar.xyz;
    vec3 sq = vec3(dot(dS, sX) / 1.25, dot(dS, sY) / 2.0, dot(dS, cross(sX, sY)) / 1.4);
    scar = (1.0 - smoothstep(0.72, 1.02, length(sq) + 0.16 * d2 + 0.14 * (cellR - 0.5))) * uScar.w;
    vec3 fresh = mix(vec3(0.30, 0.245, 0.185), vec3(0.42, 0.36, 0.28), cellR) * (1.0 - 0.6 * joint);
    fresh = mix(fresh, vec3(0.035, 0.03, 0.028), smoothstep(0.25, 0.85, sq.y) * 0.9);      // shadowed under the lip
    rock = mix(rock, fresh, scar);
  }
  vec3 scree = mix(vec3(0.26, 0.245, 0.225), vec3(0.40, 0.375, 0.335), 0.5 + 0.5 * d2 + 0.3 * d1);

  // ---- outwash plain: pale dry bars, darker damp channels (tone follows the relief) ----
  float plain = (1.0 - face) * (1.0 - smoothstep(40.0, 75.0, D)) * (1.0 - smoothstep(0.015, 0.06, slope)) * (1.0 - smoothstep(0.3, 0.9, p.y));
  float bars = plain > 0.0 ? landBars(p.xz) : 0.5;
  vec3 gravel = mix(vec3(0.17, 0.165, 0.16), vec3(0.38, 0.365, 0.34), clamp(0.5 + 0.4 * d2 + 0.4 * d1, 0.0, 1.0)) * (0.85 + 0.3 * d3);
  float chan = smoothstep(0.30, 0.92, bars);                 // the channels between the bars
  gravel *= mix(1.0, mix(1.07, 0.76, chan), plain);

  // ---- stones and tussocks: for a camera standing at the master position they are drawn in a
  //      perspective-aware lattice, so each shows its round front instead of a foreshortened streak ----
  vec3 stoneN = vec3(0.0, 1.0, 0.0);
  float stone = 0.0, stoneTone = 0.0, stoneAO = 0.0, stoneSh = 0.0, flower = 0.0, stoneBig = 0.0;
  float camD = cameraPosition.z - p.z;
  float tuss = smoothstep(0.35, 0.7, veg);
  bool persp = uStone > 0.5;                 // master camera: perspective lattice; any other camera: stones fixed in the world
#ifdef VALLEY_NO_STONES
  if (false) {   // opts.stones === false (FIELD draws its own grass and flowers over a plain floor)
#else
  if (face < 0.5 && dist < (persp ? 9.0 : 4.5) && (!persp || camD > 0.02)) {
#endif
    float eye = max(cameraPosition.y - p.y, 0.004);
    vec2 shd = -uKeyDir.xz / max(uKeyDir.y, 0.16);                         // where cast shadows fall, in stone radii
    shd *= min(1.0, 2.6 / max(length(shd), 1e-3));
    float shx = shd.x;
    float alpha = (p.x - cameraPosition.x) / max(camD, 1e-3);
    float clus = mix(1.2, 0.5, chan);                                       // stones gather on the bars
    for (int k = 0; k < 3; k++) {
      if (!persp && k == 2) continue;
      float S = k == 0 ? 42.0 : (k == 1 ? 125.0 : 370.0);
      float occ = mix(k == 0 ? 0.10 : (k == 1 ? 0.22 : 0.45), k == 0 ? 0.03 : (k == 1 ? 0.22 : 0.7), tuss);
      float pxl = (1.0 / S) / ((persp ? camD : dist) * uPixel);          // cell size in pixels
      float vis = k == 0 ? smoothstep(7.0, 14.0, pxl) : smoothstep(2.5, 6.0, pxl);
      if (vis <= 0.0) continue;
      float gb = persp ? eye * S * log(camD) : p.z * S;
      float rowI = floor(gb);
      for (int j = -1; j <= 1; j++) {
        float row = rowI + float(j);
        // master camera: each row is laid out along the screen horizontal at its own depth (no skew off axis)
        float ga = persp ? S * alpha * exp((row + 0.5) / (eye * S)) : p.x * S;
        float colI = floor(ga);
        for (int i = -1; i <= 1; i++) {
          vec2 c = vec2(colI + float(i), row);
          vec3 hh = hash32(c + 17.0 * float(k) + 3.0);
          if (hh.z > occ) continue;
          float q01 = hh.z / occ;
          float r = (0.19 + 0.44 * q01 * q01) * clus;
          vec2 l = (vec2(ga, gb) - c - 0.25 - 0.5 * hh.xy) / r;
          bool isFlower = tuss > 0.5 && k == 2 && hh.x > 0.86;
          if (persp) {
            float squat = mix(1.25 + 0.8 * hh.y, 0.6 + 0.3 * hh.y, tuss);         // stones lie flat, tussocks stand
            l = vec2(l.x + (hh.x - 0.5) * 0.8 * l.y * (1.0 - tuss), l.y * squat);
          }
          float a1 = hh.x * 6.2832;
          vec2 e1 = vec2(cos(a1), sin(a1));
          vec2 e2 = vec2(e1.x * 0.454 - e1.y * 0.891, e1.x * 0.891 + e1.y * 0.454);
          vec2 e3 = vec2(-e1.x * 0.588 - e1.y * 0.809, e1.x * 0.809 - e1.y * 0.588);
          float poly = max(max(abs(dot(l, e1)), abs(dot(l, e2))), abs(dot(l, e3)));
          float m = mix(dot(l, l), poly * poly * 1.25, 0.55 * (1.0 - tuss));
          if (isFlower) m = dot(l, l) * 7.0;                                      // a small bright seed head
          if (m < 1.0) {
            float a = smoothstep(1.0, 0.72, m) * vis;
            if (a > stone) {
              stone = a; stoneTone = fract(hh.x * 7.0 + hh.y * 3.0);
              stoneN = persp ? vec3(l.x, l.y + 0.2, sqrt(1.0 - m) + 0.45) : vec3(l.x * 0.9, 0.55 + 0.6 * sqrt(1.0 - m), l.y * 0.9);
              flower = isFlower ? 1.0 : 0.0; stoneBig = k == 0 ? 1.0 : 0.0;
            }
          } else if (!isFlower) {
            if (persp) {
              vec2 ls = l + vec2(0.0, 0.55);                                      // contact shadow under it
              stoneAO = max(stoneAO, (1.0 - smoothstep(0.7, 1.7, dot(ls, ls))) * vis);
              vec2 lc = vec2((l.x - 0.6 * shx) / (1.0 + 0.6 * abs(shx)), (l.y + 0.5) / 0.6);   // cast shadow
              stoneSh = max(stoneSh, (1.0 - smoothstep(0.5, 1.05, dot(lc, lc))) * vis);
            } else {
              stoneAO = max(stoneAO, (1.0 - smoothstep(1.0, 1.7, m)) * vis);
              vec2 lc = l - shd * 0.75;                                           // the shadow lies on the ground beside it
              stoneSh = max(stoneSh, (1.0 - smoothstep(0.55, 1.15, dot(lc, lc) / (1.0 + 0.3 * dot(shd, shd)))) * vis);
            }
          }
        }
      }
    }
  }
  // a stone is the same rock as the gravel it lies in: it differs by its light, not by being dark
  if (stone > 0.0) {
    vec3 sc = mix(gravel * 0.72, gravel * 1.22 + 0.02, stoneTone) * (0.86 + 0.28 * snoise(ps * 700.0) * near);
    sc = mix(sc, sc * vec3(0.80, 0.86, 0.74), stoneBig * 0.5);                      // lichen on the big ones
    gravel = mix(gravel, sc, stone * 0.95);
  }
  float steep = smoothstep(0.12, 0.30, slope + 0.08 * d1);
  vec3 alb = mix(gravel, mix(scree, rock, max(steep, scar)), face);
  // the flanking spurs are rock and scree too
  float spurRock = (1.0 - face) * smoothstep(0.10, 0.26, slope + 0.07 * d1) * smoothstep(6.0, 14.0, D);
  alb = mix(alb, mix(scree, rock, smoothstep(0.2, 0.4, slope + 0.1 * (cellR - 0.5) + 0.08 * t3)), spurRock);

  // ---- river (distance field), wet margins ----
  vec3 rv = (uLandB.w > 0.0 && D < 140.0 && abs(p.x) < 9.0 + 0.2 * D) ? riverSD(p.xz, D) : vec3(1e3, 0.0, 0.0);
  float aa = max(fp * 0.75, 0.002);
  float water = rv.y > 0.0 ? (1.0 - smoothstep(-aa, aa, rv.x)) * min(rv.y * 3.0, 1.0) : 0.0;
  float bank = rv.y > 0.0 ? (1.0 - smoothstep(0.0, 0.05 + 0.02 * D, rv.x)) * min(rv.y * 3.0, 1.0) : 0.0;

  float lakeK = 0.0;
  // ---- meltwater lake in the basin the snout leaves behind, and dark wet till around it ----
  if (uLandB.y > 0.0 && uLandB.w > 0.0) {
    float sn = uLandB.x;
    float xi0 = mix(0.1, 0.30 + 2.6 * sin(max(sn, 0.0) * 0.034 + 0.4) * smoothstep(4.0, 45.0, sn), smoothstep(2.0, 12.0, sn));
    float grow = smoothstep(1.6, 9.0, sn);                              // no lake while the ice is still at the seed's spot
    vec2 lq = vec2((p.x - xi0) / (0.5 + 1.5 * grow), (D - (sn - 1.0 * grow)) / (0.2 + 0.95 * grow));
    float ld = length(lq) + 0.22 * snoise(p.xz * 0.9 + 3.0) + 0.08 * d2;
    float lake = (1.0 - smoothstep(1.0 - aa * 3.0, 1.0 + aa * 3.0, ld)) * grow * step(iceT, 0.002);
    if (lake > water) { water = lake; rv.z = 0.0; lakeK = 1.0; }
    bank = max(bank, (1.0 - smoothstep(1.0, 2.6, ld)) * grow);
  }

  // ---- vegetation: moss creeping out from the river, then grass, scrub on the old slopes ----
  float vegAmt = 0.0;
  vec3 grassAlb = vec3(0.0);
  if (veg > 0.0) {
    float reach = veg * (0.8 + 0.12 * D) * (1.0 + 2.0 * veg);
    float nearRiver = 1.0 - smoothstep(reach * 0.3, reach, max(rv.x, 0.0) + (0.6 - 0.9 * d1 - 0.4 * d2) * reach * 0.5);
    float cover = smoothstep(0.0, 0.5, veg * 1.6 - 0.22 + 0.5 * d1 + 0.25 * d2);
    vegAmt = max(nearRiver, cover * smoothstep(0.35, 1.0, veg)) * (1.0 - smoothstep(0.30, 0.55, slope)) * (1.0 - smoothstep(0.45, 0.8, F) * (1.0 - 0.6 * veg));
    vegAmt = clamp(vegAmt, 0.0, 1.0);
    vec3 moss = mix(vec3(0.115, 0.14, 0.05), vec3(0.19, 0.22, 0.075), 0.5 + 0.5 * d2);
    vec3 grass = mix(vec3(0.085, 0.13, 0.035), vec3(0.20, 0.235, 0.07), clamp(0.5 + 0.5 * d2 + 0.35 * d3 + 0.3 * d1, 0.0, 1.0));
    // meadow: drifts of paler and darker grass, sedge in the old channels, dry gold on the bars
    float drift = snoise(vec2(p.x * 0.8 + 2.0 * d1, D * 0.14)) * 0.5 + 0.5;
    grass = mix(grass * vec3(0.66, 0.78, 0.66), grass * vec3(1.42, 1.24, 0.82), drift);
    grass = mix(grass * vec3(1.20, 1.10, 0.84), grass * vec3(0.80, 0.92, 0.80), chan * plain);
    grass *= uVegTint;
    // scrub and heath on the worn slopes: dark in the gullies, thinning to rock toward the top
    float scrub = smoothstep(0.5, 0.85, veg) * smoothstep(0.06, 0.3, F) * smoothstep(0.62, 0.3, cn + 0.25 * d2 + 0.2 * d1) * (1.0 - smoothstep(0.55, 0.85, F));
    grass = mix(grass, vec3(0.035, 0.058, 0.026) * (0.8 + 0.5 * cellR), scrub * 0.85);
    grass = mix(grass, grass * vec3(1.25, 1.02, 0.72), smoothstep(0.35, 0.8, F) * (1.0 - scrub));      // alpine turf, paler
    if (stone > 0.0) {
      vec3 tc = grass * mix(0.70, 1.2, stoneTone) * mix(0.66, 1.3, smoothstep(-0.3, 0.9, stoneN.y)) * (0.85 + 0.3 * snoise(vec2(p.x * 900.0, stoneN.y * 3.0)));
      tc = mix(tc, vec3(0.80, 0.74, 0.50), flower);
      grass = mix(grass, tc, stone * tuss);
    }
    grassAlb = mix(moss, grass, smoothstep(0.3, 0.8, veg + 0.2 * d1));
    alb = mix(alb, grassAlb, vegAmt);
  }
  alb = mix(alb, alb * 0.55, bank * (1.0 - vegAmt) * 0.8);

  float stoneK0 = stone * (1.0 - face);
  // ---- glacier ice: weathered and dusty on top, blue in its walls and crevasses, dirty at the snout ----
  float ice = smoothstep(0.0, 0.03, iceT);
  float spec = 0.0;
  vec3 glow = vec3(0.0);
  if (ice > 0.0) {
    float bs = max(D - uLandB.x, 0.0);                               // distance behind the snout
    float xi = mix(0.1, 0.30 + 2.6 * sin(max(D, 0.0) * 0.034 + 0.4) * smoothstep(4.0, 45.0, D), smoothstep(2.0, 12.0, D));
    float Wx = min(2.2 * sqrt(bs * (1.0 + 0.012 * bs)), 2.0 + 0.11 * max(D, 0.0)) + 1e-3;
    float xiN = clamp((p.x - xi) / Wx, -1.0, 1.0);
    float arc = bs * (1.0 + 0.55 * xiN * xiN) + 0.35 * d1;             // crevasses bow down-glacier
    float cr = 1.0 - abs(snoise(vec2(p.x * 0.5, arc * (1.6 + 2.0 * exp(-bs / 6.0)))));
    cr = smoothstep(0.80, 0.97, cr) * (0.25 + 0.75 * smoothstep(0.15, -0.35, snoise(vec2(p.x * 0.13, D * 0.08)))) * mid;
    float wall = smoothstep(0.10, 0.34, slope);
    float front = exp(-bs / 2.5);
    float flute = clamp(0.5 + 0.6 * snoise(vec2(p.x * 21.0 + 2.0 * d1, p.y * 6.0)) + 0.3 * snoise(vec2(p.x * 67.0, p.y * 11.0)), 0.0, 1.0);
    float mor = smoothstep(0.90, 0.99, 1.0 - abs(snoise(vec2(xiN * 2.1 + 0.25 * d1, 7.7)))) * smoothstep(0.5, 4.0, bs);
    float strat = 0.5 + 0.5 * sin(p.y * 520.0 + 3.0 * d1 + 2.0 * snoise(vec2(p.x * 3.0, 1.0)));
    float crack = smoothstep(0.93, 0.99, 1.0 - abs(snoise(vec2(p.x * 31.0 + 0.6 * snoise(vec2(p.x * 7.0, p.y * 30.0)), p.y * 2.5 + D * 3.0)))) * near;
    vec3 top = mix(vec3(0.46, 0.52, 0.56), vec3(0.80, 0.84, 0.86), clamp(0.5 + 0.45 * d2 + 0.4 * d1, 0.0, 1.0));
    float dirt = smoothstep(0.15, 0.75, 0.55 * d1 + 0.45 * snoise(ps * 2.3 + 7.0) + 1.1 * front - 0.3);       // debris thickens toward the snout
    top = mix(top, vec3(0.15, 0.14, 0.13) * (0.8 + 0.4 * d2), dirt * 0.72);
    vec3 wallCol = mix(vec3(0.13, 0.27, 0.38), vec3(0.60, 0.74, 0.80), flute * (0.5 + 0.5 * strat));
    wallCol = mix(wallCol, vec3(0.12, 0.11, 0.10), smoothstep(0.80, 0.97, 0.5 + 0.5 * sin(p.y * 190.0 + 4.0 * d1)) * 0.65);   // dirt bands
    vec3 iceCol = mix(top, wallCol, wall);
    iceCol = mix(iceCol, vec3(0.10, 0.20, 0.27), crack * wall * 0.45);
    iceCol = mix(iceCol, vec3(0.10, 0.095, 0.09), (1.0 - smoothstep(0.0, 0.014, iceT)) * 0.85);              // debris at the foot
    iceCol = mix(iceCol, vec3(0.08, 0.19, 0.28), cr * (1.0 - wall) * 0.7);
    iceCol = mix(iceCol, vec3(0.22, 0.215, 0.21), mor * 0.4 * (1.0 - wall));
    iceCol = mix(vec3(dot(iceCol, vec3(0.3333))), iceCol, 0.62);                                          // glacier ice is paler than it is blue
    alb = mix(alb, iceCol, ice);
    spec = ice * 0.5;
    glow = vec3(0.035, 0.15, 0.24) * ice * max(wall * (0.4 + 0.6 * flute), cr) * smoothstep(0.004, 0.03, iceT);
  }

  // ---- snow ----
  float sl = uSnow.x;
  float snowH = smoothstep(sl - 0.5, sl + 1.0, p.y + (0.45 + 0.6 * face) * d1 + (0.55 - cn) * 2.0 * face + 0.5 * (cellR - 0.5) * face * mid + ice * (1.0 - uSnow.y) + 0.3 * (chan - 0.3) * plain);
  float snowS = 1.0 - smoothstep(0.20 + 0.10 * cold - 0.04 * wallK, 0.36 + 0.16 * cold + 0.12 * wallK, slope + 0.34 * (cn - 0.5) * face + 0.16 * nG.x * face + 0.07 * d2 + 0.05 * d1 + 0.16 * (cellR - 0.5) * face * mid + (0.22 * t3 + 0.10 * (cellR - 0.5)) * wallK);
  float frost = uStone * smoothstep(0.9995, 1.0, cold) * smoothstep(0.35, 0.9, bars + 0.3 * d1) * (1.0 - smoothstep(4.0, 12.0, D)) * plain;
  water *= (1.0 - ice) * (1.0 - smoothstep(0.10, 0.30, F));
  // ground snow arrives and leaves patch by patch through a noise threshold (hollows first), so
  // the cover changes over many frames and never switches at once
  float snowG = 0.0;
  if (uSnow2.x > 0.0) {
    // threshold: noise mapped through its own distribution, so thresholds are spread evenly over 0..1
    // and the covered area grows in proportion to the factor
    float z = (0.55 * d1 + 0.5 * d2 + 0.4 * d3) / sqrt(0.0242 + 0.0275 * mid * mid + 0.0176 * near * near);
    float thr = clamp(smoothstep(-2.0, 2.0, z) * 0.84 + 0.08 - 0.10 * (chan - 0.3) * plain + 0.25 * smoothstep(0.03, 0.3, slope), 0.05, 0.95);
    snowG = smoothstep(thr - 0.2, thr + 0.2, uSnow2.x * 1.4 - 0.2) * (1.0 - smoothstep(0.45, 0.7, slope));
  }
  float lowFlat = (1.0 - smoothstep(0.25, 1.0, p.y)) * (1.0 - face);          // the floor never follows the snowline directly
  float snow = max(max(snowH * snowS * (1.0 - lowFlat), snowG), frost * (1.0 - stoneK0)) * (1.0 - water) * (1.0 - scar);
  snow = max(snow, uStone * cold * smoothstep(0.55, 0.95, normalize(stoneN).y) * 0.7 * stoneK0 * (1.0 - ice));
  snow = max(snow, wallK * cold * (0.34 + 0.3 * t3) * (1.0 - water));
  vec3 snowCol = vec3(0.86, 0.88, 0.92) * mix(vec3(1.0), vec3(0.80, 0.90, 1.04), clamp(0.7 * chan * plain + 0.35 * (0.5 - d1), 0.0, 1.0));
  alb = mix(alb, snowCol, snow);
  spec = max(spec * (1.0 - snow), snow * 0.25);

  // moonlight (and deep dusk) drains the land to blue-black
  alb = mix(alb, vec3(dot(alb, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.74, 0.86, 1.10), 0.88 * uMoonlit);

  // ---- light ----
  float cover = max(ice, water);
  float stoneK = stoneK0 * (1.0 - cover) * mix(1.0, 0.55, vegAmt);
  if (stoneK > 0.0) n = normalize(mix(n, normalize(stoneN), 0.8 * stoneK));
  // wind-packed snow has its own small relief
  if (snow > 0.0 && mid > 0.0) n = normalize(n + vec3(dn.x, 0.0, dn.y) * 1.4 * snow * (1.0 - face));
  float ndl = max(dot(n, uKeyDir), 0.0);
  float wrap = max((dot(n, uKeyDir) + 0.35) / 1.35, 0.0);
  float lam = mix(ndl, wrap, 0.6 * max(snow, ice));                                    // soft terminator on snow and ice
  vec3 keyCol = mix(uAlpenColor, uKeyColor, vLit.w);
  float vis = vLit.x * vLit.y;
  float ground = (1.0 - stone) * (1.0 - face) * (1.0 - cover);
  float castS = stoneSh * ground, aoS = stoneAO * ground;
  vec3 light = keyCol * lam * vis * (1.0 - 0.85 * castS);
  vec3 amb = uAmbient * (0.55 + 0.45 * n.y) * mix(1.0, mix(0.48 + 0.62 * cn, 0.75 + 0.25 * cn, sharp), face) * (1.0 - 0.5 * aoS);
  amb = mix(amb, amb * vec3(0.66, 0.84, 1.16), snow * (1.0 - ice));                                  // snow keeps the sky's blue in its shadows
  light += amb;
  light += uBounce * (0.5 - 0.5 * n.y);
  light += uFillColor * max(dot(n, uFillDir), 0.0) * (1.0 - 0.4 * aoS) * mix(1.0, uSnow2.y, smoothstep(0.4, 5.0, p.y));
  light += uRim * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * smoothstep(0.06, 0.3, slope) * (0.3 + 0.7 * max(dot(nG, uKeyDir) + 0.3, 0.0));
  vec3 col = alb * light;
  col += glow * (vec3(dot(uAmbient, vec3(0.3333))) * 1.3 + keyCol * vis * 0.25) * (1.0 - 0.55 * lam * vis);
  // glints on snow and ice toward the key light
  vec3 hv = normalize(uKeyDir - rd);
  col += keyCol * vis * spec * pow(max(dot(n, hv), 0.0), 48.0) * 1.2;
  // grass and seed heads glow when the light comes through them
  if (vegAmt > 0.0) {
    float back = max(dot(rd, uKeyDir), 0.0);
    float through = back * back * vis * (1.0 - snow) * vegAmt;
    col += grassAlb * keyCol * through * (0.22 + 0.7 * stoneK0 * tuss * smoothstep(0.3, 0.95, stoneN.y) + 3.0 * flower * stoneK0);
  }

  // ---- water: silver, never blue ----
  if (water > 0.0) {
    float flowT = uSkyTime * 0.9;
    float along = D + rv.z * p.x;
    vec2 wq = vec2(p.x * 7.0, along * 2.2 + flowT);
    vec3 wn = normalize(vec3(0.10 * snoise(wq) + 0.05 * snoise(wq * 3.1), 1.0, 0.07 * snoise(wq + 5.0)));
    vec3 R = reflect(rd, wn);
    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(-rd, wn), 0.0), 5.0);
    // the sky it mirrors: pale toward the horizon, deeper overhead, with the clouds drifting across
    vec3 sky = mix(uSkyRefl.rgb * 1.12, uSkyReflZ * 1.3, 0.55 * pow(clamp(R.y, 0.0, 1.0), 0.6));
    if (uCloud.x > 0.0 && R.y > 0.03) {
      float cden = cloudDensity(p.xz + R.xz * ((${f(CLOUD_H[0])} - p.y) / R.y), 0.0, 3);
      sky = mix(sky, uSkyRefl.rgb * 1.45, 0.8 * cden);
    }
    float l = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    sky = mix(sky, vec3(l) * vec3(0.97, 1.0, 1.04), 0.65 * (1.0 - uShaft.y));           // silver: the sky, drained of its blue (state.riverGold keeps its colour)
    // never duller than the land around it: at dusk and by night the river is the brightest thing on the ground
    float floorL = dot(uAmbient, vec3(0.3333)) * 1.6 + dot(keyCol, vec3(0.3333)) * 0.16;
    sky = max(sky, vec3(floorL) * mix(vec3(0.94, 1.0, 1.08), vec3(1.25, 0.72, 0.26), uShaft.y));      // (riverGold: the floor of its light is gold too)
    float streak = 0.95 + 0.10 * snoise(vec2(p.x * 11.0, along * 0.9 + flowT * 3.0)) * mid;    // long-shutter flow lines
    // glitter: looking toward the light across moving water, the ripples flash
    vec2 gq = vec2(p.x * 300.0, along * 70.0 + flowT * 14.0);
    float fine = 1.0 - smoothstep(0.002, 0.02, fp);
    float sparkle = mix(0.34, 0.16 + pow(max(snoise(gq) * 0.6 + snoise(gq * 2.3 + 9.0) * 0.4, 0.0), 2.0) * 3.0, fine);
    float sheet = 0.62 + 0.38 * snoise(vec2(p.x * 2.2, along * 1.1 + flowT * 3.0));       // broad bands of dazzle
    float toward = pow(max(dot(normalize(rd.xz), normalize(uKeyDir.xz + 1e-4)), 0.0), 3.0) * smoothstep(0.0, 0.3, uKeyDir.y);
    float glit = pow(max(dot(R, uKeyDir), 0.0), 260.0) * 18.0 + pow(max(dot(R, uKeyDir), 0.0), 24.0) * 0.6;
    float mirror = clamp(0.72 + 0.28 * fres, 0.0, 1.0);
    vec3 wcol = mix(alb * light * 0.3, sky * streak, mirror);
    wcol += keyCol * vis * (1.0 - uShaft.z) * (glit * (0.6 + 0.4 * uSkyRefl.w) + toward * (0.42 + sheet * sheet * (0.3 + 1.6 * sparkle)));
    wcol = mix(wcol, uSilver.rgb * (0.78 + 0.22 * streak + 0.9 * sparkle * toward), uSilver.a);
    // soft banks: at the margins the water is shallow and the wet gravel shows through
    float deep = max(smoothstep(0.0, 0.010 + 0.004 * max(D, 0.0) + aa, -rv.x), lakeK);
    col = mix(col, wcol, water * (0.35 + 0.65 * deep));
  }

  // ---- air ----
  col = col * vAerT + vAerL;
  vec3 fogCol = fogInscatter(rd, uKeyDir, uFogColor, uFogSunColor, 8.0);
  col = mix(col, fogCol, vLit.z);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------------------------
// Sky: physical atmosphere + sun + moon + stars + twilight glow + two cloud layers.
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec2 ndc = position.xy;
  vec3 v = vec3((ndc.x + projectionMatrix[2][0]) / projectionMatrix[0][0], (ndc.y + projectionMatrix[2][1]) / projectionMatrix[1][1], -1.0);
  vDir = transpose(mat3(viewMatrix)) * v;
  gl_Position = vec4(ndc, 1.0, 1.0);
}`;
const SKY_FRAG = SKY + CLOUD_GLSL + /* glsl */ `
uniform vec4 uShaft;
uniform float uTwBand;
` + SHAFT_GLSL + /* glsl */ `
varying vec3 vDir;
uniform vec3 uMoonDir;
uniform vec4 uNight;        // x: night amount, y: moon sky intensity, z: star visibility, w: gain
uniform vec4 uGlow;         // twilight horizon glow colour (rgb) and strength (a)
uniform vec3 uCloudSun, uCloudAmb, uCloudDir, uHorizonCol;
uniform vec3 uTwZen, uTwMid, uTwHor;
void main() {
  vec3 rd = normalize(vDir);
  vec3 T;
  vec3 col = atmosphere(rd, 1e9, T);
  float up = max(rd.y, 0.0);
  // twilight: an art-directed gradient (deep zenith, rosy middle, warm band on the horizon)
  if (uGlow.a > 0.0) {
    vec3 art = uTwZen * (1.0 + 1.5 * exp(-up * 6.0)) + uTwMid * exp(-up * 11.0 * uTwBand) + uTwHor * exp(-up * 30.0 * uTwBand);
    float toSun = max(dot(normalize(rd.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0);
    art += uTwHor * 0.6 * pow(toSun, 6.0) * exp(-up * 12.0);
    col = col * (1.0 - 0.96 * uGlow.a) + art * uGlow.a;
  }
  col *= sunShafts(rd);
  col += sunDisk(rd, T);
  if (uNight.x > 0.0) {
    vec3 T2;
    col += atmosphereEx(rd, 1e9, uMoonDir, uNight.y, T2) + vec3(0.0016, 0.0032, 0.009) * uNight.x * (1.0 + 2.0 * exp(-up * 8.0));
    float md = dot(rd, uMoonDir);
    float disc = smoothstep(0.99990, 0.99996, md);
    col += (vec3(0.95, 0.97, 1.0) * disc * 14.0 + vec3(0.55, 0.65, 0.85) * (pow(max(md, 0.0), 900.0) * 1.2 + pow(max(md, 0.0), 40.0) * 0.07)) * uNight.x * T2;
  }
  float cloudA = 0.0;
  if (rd.y > 0.004 && uCloud.x > 0.0) {
    vec3 ccol = vec3(0.0);
    for (int i = 1; i >= 0; i--) {
      float H = i == 0 ? ${f(CLOUD_H[0])} : ${f(CLOUD_H[1])};
      float s = (H - cameraPosition.y) / rd.y;
      vec2 xz = cameraPosition.xz + rd.xz * s;
      float d = cloudDensity(xz, float(i), 5);
      if (d <= 0.0) continue;
      float d2 = cloudDensity(xz + uCloudDir.xz * (i == 0 ? 5.0 : 9.0), float(i), 3);
      float mu = max(dot(rd, uCloudDir), 0.0);
      float shade = exp(-1.9 * d2) * 0.85 + 0.15;
      vec3 c = uCloudSun * shade * (0.55 + 1.5 * pow(mu, 5.0) + 6.0 * pow(mu, 40.0) * (1.0 - d)) + uCloudAmb * (0.6 + 0.4 * (1.0 - d));
      float fade = exp(-s / (i == 0 ? 420.0 : 700.0));
      c = mix(uHorizonCol, c, fade);
      float a = d * (i == 0 ? 0.92 : 0.6) * smoothstep(0.004, 0.03, rd.y);
      ccol = mix(ccol, c, a);
      cloudA = cloudA + a * (1.0 - cloudA);
      if (i == 1) ccol = c;
    }
    col = mix(col, ccol, cloudA);
  }
  if (uNight.z > 0.0 && rd.y > -0.02) col += starField(rd, uSkyTime) * T * uNight.z * (1.0 - cloudA);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------------------------
// Grid: columns are rays from the master camera (uniform in its picture), rows are depths.
function gridAxes(NX, NZ, tele) {
  const ks = new Float32Array(NX), ds = new Float32Array(NZ);
  for (let i = 0; i < NX; i++) {
    const a = (i / (NX - 1)) * 2 - 1, m = Math.abs(a);
    if (tele) ks[i] = tele.k + a * tele.half;
    else ks[i] = Math.sign(a) * (m <= 0.75 ? (0.5 * m) / 0.75 : 0.5 + 0.6667 * (m - 0.75) + 16.5 * (m - 0.75) * (m - 0.75));
  }
  // row density (rows per unit depth), integrated and inverted
  const rho = tele
    ? (D) => (D < 121 ? 0 : D < 170 ? 15 : 1 / (0.05 * (D - 150)))
    : (D) => {
      if (D < 0) return 3 + 40 * Math.exp(D / 2);
      const base = 1 / (0.02 * Math.max(D, 0.16));
      const mtn = 3.6 * sstep(88, 100, D) * (1 - sstep(170, 180, D));
      const far = D > 174 ? 1 / (0.05 * (D - 160)) : 0;
      const snoutRows = 70 * sstep(1.25, 1.4, D) * (1 - sstep(2.0, 3.2, D));
      return Math.max(D < 174 ? base : 0, mtn, far, snoutRows);
    };
  const D0 = tele ? 121 : -14, D1 = 430, M = 8192;
  const cum = new Float64Array(M + 1);
  for (let i = 0; i < M; i++) cum[i + 1] = cum[i] + rho(D0 + ((i + 0.5) / M) * (D1 - D0));
  let j = 0;
  for (let r = 0; r < NZ; r++) {
    const target = (r / (NZ - 1)) * cum[M];
    while (j < M - 1 && cum[j + 1] < target) j++;
    const fr = cum[j + 1] > cum[j] ? (target - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    ds[r] = D0 + ((j + fr) / M) * (D1 - D0);
  }
  let best = 0;
  for (let r = 1; r < NZ; r++) if (Math.abs(ds[r] - 160) < Math.abs(ds[best] - 160)) best = r;
  ds[best] = 160;                                  // this row is carried onto the crest by the vertex shader
  return { ks, ds };
}
function gridPositions(NX, NZ, tele) {
  const { ks, ds } = gridAxes(NX, NZ, tele);
  const pos = new Float32Array(NX * NZ * 3);
  for (let r = 0, o = 0; r < NZ; r++) for (let i = 0; i < NX; i++, o += 3) { pos[o] = ks[i]; pos[o + 1] = ds[r]; }
  return pos;
}
function gridIndex(NX, NZ) {
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  let o = 0;
  for (let r = 0; r < NZ - 1; r++) for (let i = 0; i < NX - 1; i++) {
    const a = r * NX + i, b = a + 1, c = a + NX, d = c + 1;
    idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = b; idx[o++] = d; idx[o++] = c;
  }
  return idx;
}

// ---------------------------------------------------------------------------------------------
// GRAINS: spindrift off the ridge, and the title (grains that cross the letter shapes catch the sun)
const GRAIN_UNIFORMS_GLSL = PROFILE_GLSL + /* glsl */ `
uniform vec4 uLandA;
uniform vec3 uKeyColor, uAlpenColor, uAmbient;
uniform vec4 uAlpen;
uniform vec4 uSpin;        // amount, wind speed, unused, unused
vec3 crestPoint(float u0) {
  float R = ridgeProfile(u0, uLandA.x, uLandA.y);
  float du = u0 - 0.04;
  float dc = 160.0 - 22.0 * pow(min(abs(du), 1.3), 1.5) + 3.5 * sin(du * 6.0);
  return vec3((du * 45.0 + 2.5) * dc / 160.0, R * dc / 160.0, -dc);
}
float sunAt(float y) { return uAlpen.x < -50.0 ? 1.0 : smoothstep(uAlpen.x - 1.5, uAlpen.x + 2.5, y); }
`;
// wind-blown snow: the shared snow fleck, drawn as a short streak along the wind
const STREAK_FRAG = /* glsl */ `
    vec2 q = vec2(uv.x, uv.y * 3.2);
    float r2 = dot(q, q);
    float a = exp(-r2 * 4.5) * (1.0 - smoothstep(0.75, 1.0, dot(uv, uv)));
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`;
function createSpindrift(U, seed) {
  return createParticles({
    name: 'valley-spindrift', count: 100000, seed: seed ^ 0x51d7, minPixelSize: 1.4,
    uniforms: { uLandA: U.uLandA, uKeyColor: U.uKeyColor, uAlpenColor: U.uAlpenColor, uAmbient: U.uAmbient, uAlpen: U.uAlpen, uSpin: U.uSpin },
    glsl: GRAIN_UNIFORMS_GLSL,
    position: /* glsl */ `
      float life = mix(7.0, 13.5, seed.w);
      float ph = fract(t / life + seed.z);
      float age = ph * life;
      // sources: the summit (most), the right ridge, the left shoulder
      float pick = fract(seed.x * 7.31);
      float u0 = pick < 0.62 ? 0.04 + (seed.y - 0.45) * 0.16 : (pick < 0.82 ? 0.10 + seed.y * 0.3 : -0.42 + (seed.y - 0.5) * 0.2);
      vec3 src = crestPoint(u0);
      vec3 wind = vec3(3.3, 0.42, 0.7) * uSpin.y;
      vec3 w3 = vec3(snoise(vec2(seed.x * 31.0, age * 0.31 + seed.y * 9.0)), snoise(vec2(seed.y * 37.0 + 7.0, age * 0.27)), snoise(vec2(seed.z * 29.0 + 3.0, age * 0.29)));
      // gust: slow billows that travel with the wind
      float gust = snoise(vec2((src.x + wind.x * age) * 0.12 - t * 0.4, seed.w * 3.0));
      pos = src + wind * age * (0.55 + 0.9 * seed.w) + w3 * (0.25 + 0.42 * age) * vec3(0.7, 1.0, 0.6) + vec3(0.0, (0.5 + gust) * 0.22 * age, 0.0);
      size = mix(0.10, 0.34, seed.w * seed.w);
      float fade = smoothstep(0.0, 0.05, ph) * pow(1.0 - ph, 1.6);
      float lit = sunAt(pos.y);
      vec3 c = mix(uAmbient * 0.9, mix(uAlpenColor, uKeyColor, smoothstep(0.0, 8.0, pos.y - uAlpen.x)) * 1.5 + uAmbient, lit);
      color = vec4(c, uSpin.x * fade * (0.22 + 0.5 * seed.x) * (0.7 + 0.6 * gust));`,
    fragment: STREAK_FRAG,
    blending: 'additive',
  });
}

// Rockfall: grains that pour down the face (they hug the ground) and a billow of dust.
const FALL_GLSL = LAND_GLSL + /* glsl */ `
uniform vec4 uFallA[4];     // site xyz, event time
uniform vec4 uFallB[4];     // scale, life, grain opacity, dust opacity
uniform vec3 uKeyColor, uKeyDir, uAmbient;
uniform vec4 uAlpen;
`;
function createRockfall(U, seed) {
  const fallA = { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, -1e3)) };
  const fallB = { value: [0, 1, 2, 3].map(() => new THREE.Vector4(1, 3, 0, 0)) };
  const shared = { uLandA: U.uLandA, uLandB: U.uLandB, tRiver: U.tRiver, uFallA: fallA, uFallB: fallB, uKeyColor: U.uKeyColor, uKeyDir: U.uKeyDir, uAmbient: U.uAmbient, uAlpen: U.uAlpen };
  const head = /* glsl */ `
      int slot = int(mod(id, 4.0));
      vec4 ev = uFallA[slot], eb = uFallB[slot];
      float tau = t - ev.w;
      float sc = eb.x, life = eb.y;
      float sunK = uAlpen.x < -50.0 ? 1.0 : smoothstep(uAlpen.x - 1.5, uAlpen.x + 2.0, ev.y);
      vec3 lightC = uKeyColor * sunK * (0.55 + 0.45 * max(uKeyDir.y, 0.0)) + uAmbient;`;
  const grains = createParticles({
    name: 'valley-fall-grains', count: 48000, seed: seed ^ 0xfa11, minPixelSize: 1.3,
    uniforms: shared, glsl: FALL_GLSL,
    position: head + /* glsl */ `
      // released over the first moments, in a handful of chutes that pour down and to the left
      float rel = tau - seed.z * seed.z * life * 0.45;
      float k = rel / (life * (0.45 + 0.55 * seed.w));
      if (tau < 0.0 || rel < 0.0 || k > 1.0) { color = vec4(0.0); pos = ev.xyz; size = 0.0; }
      else {
        float chute = floor(seed.x * 6.0);
        float run0 = (0.5 * rel + 1.9 * rel * rel / life) * (0.6 + 0.7 * seed.y);
        float run = sc * run0;                                                            // distance travelled down the face
        float lane = (chute - 2.5) * 0.42 + (fract(seed.x * 6.0) - 0.5) * 0.16 * (1.0 + 3.0 * k) + 0.25 * sin(run0 * 1.7 + chute * 2.1);
        vec2 dirxz = normalize(vec2(-0.32, 1.0));
        vec2 xz = ev.xz + dirxz * run + vec2(dirxz.y, -dirxz.x) * lane * sc * 0.55;
        vec4 inf;
        float g = landEval(xz, 2, inf);
        float hop = abs(sin(rel * (5.0 + 6.0 * seed.w) + seed.y * 20.0)) * exp(-1.6 * k) * 0.22 * sc;
        float startY = ev.y + (seed.y - 0.5) * 0.5 * sc;
        pos = vec3(xz.x, max(g, mix(startY, g, smoothstep(0.0, 0.25, k))) + 0.03 * sc + hop, xz.y + 0.25);
        size = mix(0.014, 0.045, seed.w * seed.w) * sc;
        vec3 tone = mix(vec3(0.44, 0.40, 0.35), vec3(0.88, 0.80, 0.68), seed.y);
        color = vec4(tone * lightC * 0.5, smoothstep(0.0, 0.05, k) * (1.0 - smoothstep(0.7, 1.0, k)) * 0.95 * eb.z);
      }`,
    fragment: GRAIN_FRAG.sand, blending: 'normal',
  });
  const dust = createParticles({
    name: 'valley-fall-dust', count: 5200, seed: seed ^ 0xd057, minPixelSize: 2,
    uniforms: shared, glsl: FALL_GLSL,
    position: head + /* glsl */ `
      float rel = tau - seed.z * life * 0.45;
      float k = rel / (life * (0.6 + 0.4 * seed.w));
      if (tau < 0.0 || rel < 0.0 || k > 1.0) { color = vec4(0.0); pos = ev.xyz; size = 0.0; }
      else {
        vec2 dirxz = normalize(vec2(-0.32, 1.0));
        // it runs with the debris down the fall line, spreading sideways only a little
        float run = sc * (0.9 * rel + 2.4 * rel * rel / life) * (0.25 + 0.9 * seed.y);
        vec2 xz = ev.xz + dirxz * run + vec2(dirxz.y, -dirxz.x) * (seed.x - 0.5) * sc * (0.5 + 0.9 * sqrt(k));
        vec4 inf;
        float g = landEval(xz, 0, inf);
        float rise = sc * (0.08 + 0.55 * k) * (0.25 + seed.w);
        pos = vec3(xz.x, max(g, mix(ev.y, g, smoothstep(0.0, 0.3, k))) + rise, xz.y + 0.4 + 0.3 * sc * sqrt(k));
        pos += vec3(0.5, 0.12, 0.1) * sc * k * k;                                   // the wind takes the fines
        // billows: each puff also wanders, so the veil boils instead of sliding
        pos += sc * 0.3 * sqrt(k) * vec3(snoise(vec2(seed.x * 40.0, k * 2.2)), snoise(vec2(seed.y * 40.0, k * 2.0 + 3.0)), snoise(vec2(seed.w * 40.0, k * 1.8 + 7.0)));
        size = sc * mix(0.22, 0.95, sqrt(k)) * (0.6 + 0.8 * seed.w);
        vec3 tone = mix(vec3(0.40, 0.37, 0.33), vec3(0.66, 0.61, 0.54), seed.y);
        color = vec4(tone, smoothstep(0.0, 0.06, k) * pow(1.0 - k, 1.7) * 0.34 * eb.w);
      }`,
    // every puff is shaded as a little sphere, so the plume has a lit side and a shadowed side
    fragment: /* glsl */ `
      float r2 = dot(uv, uv);
      vec3 nrm = vec3(uv, sqrt(max(1.0 - r2, 0.0)));
      vec3 Lv = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
      float lam = 0.5 + 0.5 * dot(nrm, Lv);
      float a = exp(-r2 * 2.4) * (1.0 - smoothstep(0.7, 1.0, r2));
      a *= 0.62 + 0.38 * snoise(uv * 2.6 + vColor.rg * 13.0);
      vec3 c = vColor.rgb * (uKeyColor * (0.12 + 1.0 * lam * lam * lam) + uAmbient * 0.8);
      col = vec4(c * vColor.a * a, vColor.a * a);`,
    blending: 'normal',
  });
  return { grains, dust, fallA, fallB };
}

/** Rasterise the title into a mask (R: 一粒, G: GRAIN) laid out exactly like card C1. */
function createTitleMask() {
  const R = 1.5, S1 = 120 * R, S2 = 30 * R;
  const smp = sampleTextPoints([
    { text: '一粒', lang: 'zh', size: S1, tracking: 0.5 },
    { text: 'GRAIN', lang: 'en', size: S2, tracking: 0.6 },
  ], { size: S1, step: 1, jitter: 0, lineGap: 23 / 120, threshold: 0.35, seed: 'grain-title' });
  const texel = 2 / 120;                                   // em per texel (2 px at 1080p)
  const W = Math.ceil(smp.width / texel), H = Math.ceil(smp.height / texel);
  const acc = new Float32Array(W * H * 2);
  for (let i = 0; i < smp.count; i++) {
    const x = smp.points[i * 2], y = smp.points[i * 2 + 1];
    const ix = Math.floor((x + smp.width / 2) / texel), iy = Math.floor((y + smp.height / 2) / texel);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
    acc[(iy * W + ix) * 2 + (y > -0.42 ? 0 : 1)] += 1;
  }
  const per = (texel * S1) * (texel * S1);                 // raster pixels per texel
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = Math.min(255, Math.round((acc[i * 2] / per) * 255));
    data[i * 4 + 1] = Math.min(255, Math.round((acc[i * 2 + 1] / per) * 255));
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, width: smp.width, height: smp.height };
}
const TITLE = { cx: 0.72, cy: 0.26, in: 48.0, enDelay: 0.8, fadeOut: [54.5, 56.0] };
function createTitleGrains(U, seed) {
  const mask = createTitleMask();
  const picH = 1920 / 2.39;
  const p = createParticles({
    name: 'valley-title', count: 90000, seed: seed ^ 0x7171, minPixelSize: 1.5,
    uniforms: {
      uLandA: U.uLandA, uKeyColor: U.uKeyColor, uAlpenColor: U.uAlpenColor, uAmbient: U.uAmbient, uAlpen: U.uAlpen, uSpin: U.uSpin,
      tTitle: { value: mask.tex },
      uTitleA: { value: new THREE.Vector4(TITLE.cx, 1 - TITLE.cy, 1920 / 120, picH / 120) },   // centre (picture uv, y up), em per uv
      uTitleB: { value: new THREE.Vector4(mask.width, mask.height, 1.2 / 120, picH / 1080) },    // mask size (em), y offset (em), picture fraction
      uTitleK: { value: new THREE.Vector4(0, 0, 0, 0) },                                         // zh in, en in, out, blow (em)
    },
    glsl: GRAIN_UNIFORMS_GLSL + /* glsl */ `
uniform sampler2D tTitle;
uniform vec4 uTitleA, uTitleB, uTitleK;
`,
    position: /* glsl */ `
      // a stream through the title's part of the sky (it wraps), on the plane just in front of the ridge
      vec3 c0 = vec3(31.0, 27.4, -151.0), hb = vec3(19.0, 12.5, 5.0);
      float sp = mix(2.3, 3.5, seed.w) * uSpin.y;
      float x = mod(seed.x * 2.0 * hb.x + sp * t, 2.0 * hb.x) - hb.x;
      float gx = x / hb.x;
      vec3 w3 = vec3(0.0, snoise(vec2(seed.y * 41.0, t * 0.22 + x * 0.09)), snoise(vec2(seed.z * 43.0, t * 0.2 + x * 0.07)));
      pos = c0 + vec3(x, (seed.y - 0.5) * 2.0 * hb.y + w3.y * 1.1 + 0.06 * x, (seed.z - 0.5) * 2.0 * hb.z + w3.z);
      vec4 clip = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      vec2 pic = vec2(clip.x / clip.w * 0.5 + 0.5, 0.5 + clip.y / clip.w * 0.5 / uTitleB.w);
      vec2 em = (pic - uTitleA.xy) * uTitleA.zw - vec2(uTitleK.w, uTitleB.z);
      vec2 muv = em / uTitleB.xy + 0.5;
      vec2 mk = (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) ? texture(tTitle, muv).rg : vec2(0.0);
      // the light arrives from the left: Chinese first, English a little later
      float sweep = muv.x * 0.7;
      float lit = max(mk.r * smoothstep(0.0, 0.6, uTitleK.x - sweep), mk.g * smoothstep(0.0, 0.6, uTitleK.y - sweep)) * (1.0 - uTitleK.z);
      float env = (1.0 - smoothstep(0.55, 1.0, abs(gx))) * (1.0 - smoothstep(0.5, 1.0, abs(seed.y - 0.5) * 2.0));
      float sun = sunAt(pos.y);
      vec3 dim = mix(uAmbient * 0.9, uAlpenColor * 1.2 + uAmbient, sun * 0.6);
      vec3 gold = mix(vec3(1.0, 0.66, 0.30) * 2.4, vec3(1.0, 0.93, 0.80) * 4.0, lit * lit * seed.w * seed.w);
      size = mix(0.10, 0.26, seed.w * seed.w) * (1.0 + 0.5 * lit);
      color = vec4(mix(dim, gold, lit), uSpin.x * mix(0.16 * env * (0.4 + 0.6 * seed.z), 1.0, lit));`,
    fragment: STREAK_FRAG,
    blending: 'additive',
  });
  p.maskTex = mask.tex;
  /** Title state for film time t (pure). */
  p.setTitle = (t, on) => {
    const k = p.uniforms.uTitleK.value;
    const a = on ? (t - TITLE.in) / 1.3 : -1;
    k.set(Math.max(0, Math.min(a, 2)), Math.max(0, Math.min(a - TITLE.enDelay / 1.3, 2)), on ? sstep(TITLE.fadeOut[0], TITLE.fadeOut[1], t) : 1, on ? 0.37 * Math.max(0, t - TITLE.fadeOut[0]) : 0);
  };
  return p;
}

// ---------------------------------------------------------------------------------------------
const DEFAULT_STATE = {
  sunElevation: 30, sunAzimuth: 215, season: 0.5, cloudCover: 0.25, cloudSpeed: 1.5, cloudStreak: 0,
  fog: 0.3, spindrift: 0, night: 0, moonElevation: 30, moonAzimuth: -18,
};

/** Default snowline (units) for a year and season. */
function defaultSnowline(yr, season) {
  const keys = [[0, 1.0], [300, 2.6], [3000, 12.5], [6000, 15], [10000, 13.2]];
  let s = keys[keys.length - 1][1];
  for (let i = 1; i < keys.length; i++) if (yr <= keys[i][0]) { s = lerp(keys[i - 1][1], keys[i][1], (yr - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])); break; }
  if (yr <= 0) s = keys[0][1];
  const winter = 0.5 + 0.5 * Math.cos(season * Math.PI * 2);
  return s - winter * Math.min(s * 0.6, 8);
}
/**
 * Snow on the valley floor in deep winter (0..1), once the valley is a meadow. It is a factor of
 * its own, not a snowline: the floor is flat, so a line crossing it would switch every pixel in
 * one frame. This one moves over more than a quarter of the year and the shader dissolves it
 * patch by patch.
 */
function groundSnowOf(yr, season) {
  const sea = season - Math.floor(season), d = Math.min(sea, 1 - sea);     // distance from midwinter
  return (1 - sstep(0.03, 0.30, d)) * sstep(6000, 9500, yr);
}

/** Height (units) of the alpenglow terminator for a sun elevation: above it the land is in sun. */
function terminatorHeight(elev) {
  if (elev >= 3.6) return -100;
  const keys = [[-2.4, 33], [-1.8, 29.5], [-0.6, 21], [0.8, 11], [2.2, 4], [3.2, 0.9], [3.6, -0.4]];
  if (elev <= keys[0][0]) return keys[0][1] + (keys[0][0] - elev) * 8;
  for (let i = 1; i < keys.length; i++) if (elev <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], (elev - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  return -100;
}

export async function createLandscape(ctx, opts = {}) {
  const detail = Math.min(1, Math.max(0.3, opts.detail ?? 1));
  const NX = Math.round(1152 * detail), NZ = Math.round(760 * detail);
  const group = new THREE.Group();
  group.name = 'valley-landscape';

  // ---- shared uniforms ----
  const skyU = createSkyUniforms();
  const riverData = new Float32Array(RIV.N * RIV.ROWS * 4);
  const riverTex = new THREE.DataTexture(riverData, RIV.N, RIV.ROWS, THREE.RGBAFormat, THREE.FloatType);
  riverTex.minFilter = riverTex.magFilter = THREE.NearestFilter;
  riverTex.generateMipmaps = false;
  riverTex.needsUpdate = true;
  const U = {
    ...skyU,
    uLandA: { value: new THREE.Vector4(30, 1, 0, 0.02) },
    uLandB: { value: new THREE.Vector4(1.4, 1, 0, 0.006) },
    tRiver: { value: riverTex },
    uCloud: { value: new THREE.Vector4(0.25, 0, 0, 0.7) },
    uCloud2: { value: new THREE.Vector4(0.33, 0.944, 0, 0) },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyColor: { value: new THREE.Color(1, 1, 1) },
    uFillDir: { value: new THREE.Vector3(0, 1, 0) }, uFillColor: { value: new THREE.Color(0, 0, 0) },
    uAmbient: { value: new THREE.Color(0.2, 0.25, 0.3) }, uBounce: { value: new THREE.Color(0, 0, 0) },
    uAlpenColor: { value: new THREE.Color(1, 0.5, 0.3) }, uAlpen: { value: new THREE.Vector4(-100, 1, 6, 0) },
    uFogA: { value: new THREE.Vector4(0.001, 0.2, 0, 1) }, uFogColor: { value: new THREE.Color() }, uFogSunColor: { value: new THREE.Color() },
    uMoonHaze: { value: new THREE.Color(0, 0, 0) },
    uSnow: { value: new THREE.Vector4(1, 2, 0, 0) }, uSnow2: { value: new THREE.Vector4(0, 1, 0, 0) },
    uSkyRefl: { value: new THREE.Vector4(1, 1, 1, 1) }, uSkyReflZ: { value: new THREE.Vector3(0.3, 0.4, 0.6) },
    uPixel: { value: 0.0006 }, uOct: { value: 5 }, uStone: { value: 1 }, uMoonlit: { value: 0 },
    uVegTint: { value: new THREE.Vector3(1, 1, 1) }, uScar: { value: new THREE.Vector4(0, 0, 0, 0) },
    uShaft: { value: new THREE.Vector4(0, 0, 0, 0) }, uSilver: { value: new THREE.Vector4(0, 0, 0, 0) }, uRim: { value: new THREE.Color(0, 0, 0) },
    uTwBand: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: new THREE.Vector4(0, 0, 0, 1) },
    uGlow: { value: new THREE.Vector4(1, 0.6, 0.3, 0) },
    uCloudSun: { value: new THREE.Color(1, 1, 1) }, uCloudAmb: { value: new THREE.Color(0.3, 0.35, 0.45) },
    uCloudDir: { value: new THREE.Vector3(0, 1, 0) }, uHorizonCol: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uSpin: { value: new THREE.Vector4(0, 1, 0, 0) },
    uTwZen: { value: new THREE.Color() }, uTwMid: { value: new THREE.Color() }, uTwHor: { value: new THREE.Color() }, uTwHaze: { value: new THREE.Vector4() },
  };

  // ---- terrain ----
  const index = new THREE.BufferAttribute(gridIndex(NX, NZ), 1);
  const makeGeo = (tele) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(gridPositions(NX, NZ, tele), 3));
    g.setIndex(index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -150), 1e5);
    return g;
  };
  const geoWide = makeGeo(null);
  const geoTele = opts.tele ? makeGeo({ k: 0.03, half: 0.115 }) : null;
  const terrainMat = new THREE.ShaderMaterial({ name: 'valley-terrain', uniforms: U, vertexShader: TERRAIN_VERT, fragmentShader: (opts.stones === false ? '#define VALLEY_NO_STONES\n' : '') + TERRAIN_FRAG });
  const terrain = new THREE.Mesh(geoWide, terrainMat);
  terrain.name = 'valley-terrain';
  terrain.frustumCulled = false;
  terrain.renderOrder = -10;
  terrain.onBeforeRender = (renderer, scene, camera) => {
    const hpx = renderer.getRenderTarget()?.height || renderer.domElement.height;
    const fovY = camera.isPerspectiveCamera ? THREE.MathUtils.degToRad(camera.getEffectiveFOV()) : 1;
    U.uPixel.value = fovY / Math.max(hpx, 1);
    U.uPixelAngle.value = U.uPixel.value;
    const cp = camera.position;
    U.uStone.value = Math.hypot(cp.x, cp.y - MASTER_CAMERA.position[1], cp.z) < 0.03 ? 1 : 0;
  };
  group.add(terrain);

  // ---- sky ----
  const skyGeo = new THREE.BufferGeometry();
  skyGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const skyMat = new THREE.ShaderMaterial({ name: 'valley-sky', uniforms: U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.name = 'valley-sky';
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = 10;
  group.add(skyMesh);

  // ---- grains ----
  const disposers = [];
  let spindrift = null, titleGrains = null, rockfall = null;
  if (opts.particles !== false) {
    spindrift = createSpindrift(U, ctx.seed ?? 1);
    spindrift.mesh.layers.set(FX_LAYER);
    spindrift.mesh.renderOrder = 20;
    group.add(spindrift.mesh);
    disposers.push(() => spindrift.dispose());
    rockfall = createRockfall(U, ctx.seed ?? 1);
    for (const m of [rockfall.dust.mesh, rockfall.grains.mesh]) { m.layers.set(FX_LAYER); group.add(m); }
    rockfall.dust.mesh.renderOrder = 18; rockfall.grains.mesh.renderOrder = 19;
    disposers.push(() => { rockfall.dust.dispose(); rockfall.grains.dispose(); });
    if (opts.title) {
      titleGrains = createTitleGrains(U, ctx.seed ?? 1);
      titleGrains.mesh.layers.set(FX_LAYER);
      titleGrains.mesh.renderOrder = 21;
      group.add(titleGrains.mesh);
      disposers.push(() => { titleGrains.dispose(); titleGrains.maskTex.dispose(); });
    }
  }

  // ---- state ----
  const light = {
    sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), ambient: new THREE.Color(), fogColor: new THREE.Color(), fogSunColor: new THREE.Color(),
    moonDir: new THREE.Vector3(), moonColor: new THREE.Color(), keyDir: new THREE.Vector3(), keyColor: new THREE.Color(), zenith: new THREE.Color(), gain: 1,
  };
  const skyOpts = { ...SKY_DEFAULTS, turbidity: 1.5, altitude: 300, metersPerUnit: 100, sunSize: 0.42, stars: 1, starDensity: 1, twinkle: 0.5, milkyWay: 0.5 };
  const sunV = new THREE.Vector3(), moonV = new THREE.Vector3();
  const riverCache = { key: '', year: -1, data: null };
  let current = null;

  const shapeOf = (yr) => {
    const vs = valleyState(yr);
    return { peak: vs.peak, sharp: vs.sharp, fill: vs.fill, jitter: 0.016 * Math.pow(vs.sharp, 0.8), vs };
  };

  function update(t, state = {}) {
    const s = { ...DEFAULT_STATE, ...state };
    const yr = s.year ?? storyYear(t);
    const vs = valleyState(yr);
    const sh = shapeOf(s.shapeYear ?? yr);
    const night = clamp01(s.night);
    const snout = snoutDepth(vs.glacier);
    const iceThin = vs.glacier > 0 ? lerp(0.5, 1, vs.glacier) * sstep(0, 0.1, vs.glacier) : 0;

    U.uLandA.value.set(sh.peak, sh.sharp, sh.fill, sh.jitter);
    U.uLandB.value.set(snout, iceThin, 0, vs.river > 0 ? 0.006 : 0);

    // river
    const source = Math.min(snout + 0.3, lerp(118, 88, vs.fill));
    const tip = s.riverTip == null ? null : s.riverTip;
    const rkey = yr.toFixed(3) + '|' + tip + '|' + source.toFixed(3);
    if (rkey !== riverCache.key) {
      if (vs.river > 0) buildRiver(riverData, yr, tip, source); else riverData.fill(0);
      riverCache.key = rkey;
      riverTex.needsUpdate = true;
    }

    // ---- light ----
    const elev = s.sunElevation, az = s.sunAzimuth;
    sunDirection(elev, az, sunV);
    sunDirection(s.moonElevation, s.moonAzimuth, moonV);
    const day = 1 - night;
    // twilight look: below ~9 degrees the sky and the light are art-directed (dawn in the east, dusk in the west)
    const dusk = 0.5 + 0.5 * Math.cos((az * Math.PI) / 180);          // 1 = sun in the west (in front of the master camera)
    const tw = (1 - sstep(lerp(1.5, 7, dusk), lerp(9, 20, dusk), elev)) * day;   // golden hour lasts longer than dawn
    const up01 = sstep(-3.5, 5, elev);
    const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    const twZen = mix3(mix3([0.005, 0.013, 0.045], [0.034, 0.08, 0.22], up01), mix3([0.005, 0.008, 0.026], [0.014, 0.022, 0.060], up01), dusk);
    const twMid = mix3(mix3([0.20, 0.12, 0.13], [0.42, 0.30, 0.30], up01), mix3([0.40, 0.06, 0.03], [1.25, 0.25, 0.09], up01), dusk);
    const twHor = mix3(mix3([1.0, 0.42, 0.14], [2.3, 1.25, 0.56], up01), mix3([1.0, 0.28, 0.05], [2.5, 0.90, 0.17], up01), dusk);
    // after sunset the glow dies quickly: a thin clean band on the horizon, then night
    const ag = lerp(1, sstep(-12, -2.5, elev), dusk);
    for (let c = 0; c < 3; c++) { twMid[c] *= ag * ag; twHor[c] *= ag; }
    U.uTwBand.value = 1 + 1.8 * dusk * (1 - sstep(-7, -1, elev));
    const dark = Math.max(night, dusk * (1 - sstep(-8, -2, elev)));          // moonlit look of the land
    // exposure: the landscape exposes itself for the light level
    const autoEV = elev >= 12 ? 0 : elev >= 0 ? lerp(1.7, 0, Math.pow(elev / 12, 0.7)) : lerp(1.7, 3.6, clamp01(-elev / 4));
    const snowEV = -1.1 * (1 - sstep(300, 3500, yr)) * sstep(0, 10, elev)            // bright snowfields: stop down
      - 1.5 * dusk * dusk * sstep(-1, 3, elev) * (1 - sstep(20, 40, elev));              // looking into a low sun: stop down
    const ev = s.exposure ?? 0, user = Math.pow(2, ev);
    const gain = Math.pow(2, (autoEV + snowEV) * day + ev);
    const o = { ...skyOpts, sunElevation: elev, sunAzimuth: az, sunIntensity: 20 * gain * (1 - night), time: t, turbidity: 1.1 + 1.1 * s.fog };
    applySkyUniforms(skyU, o);
    const L = skyLighting({ ...o, sunDir: sunV });
    U.uGlow.value.set(0, 0, 0, tw);
    U.uTwZen.value.setRGB(...twZen).multiplyScalar(user);
    U.uTwMid.value.setRGB(...twMid).multiplyScalar(user);
    U.uTwHor.value.setRGB(...twHor).multiplyScalar(user);
    const hz = mix3([twHor[0] * 0.55 + twMid[0], twHor[1] * 0.55 + twMid[1], twHor[2] * 0.55 + twMid[2]], [lerp(0.16, 0.40, up01) * ag, lerp(0.11, 0.30, up01) * ag, lerp(0.24, 0.52, up01) * ag], dusk);
    U.uTwHaze.value.set(hz[0] * user, hz[1] * user, hz[2] * user, tw * lerp(1, 0.75, dusk));
    // direct sun: the physical colour by day; near the horizon an art-directed alpenglow that
    // climbs down the mountain (terminator) and pales from rose to peach above the line
    const yT = terminatorHeight(elev);
    const sunUp = sstep(-3.4, -1.6, elev) * day;
    const sunCol = new THREE.Color(1.0, lerp(0.70, 0.60, dusk), lerp(0.52, 0.28, dusk)).multiplyScalar(lerp(1.5, lerp(2.3, 3.0, dusk), up01) * user * sunUp).lerp(L.sunColor, 1 - tw);
    const alpen = new THREE.Color(1.0, 0.36, 0.22).multiplyScalar(lerp(1.1, 1.7, up01) * user * sunUp).lerp(sunCol, sstep(3.5, 9, elev));
    const moonCol = new THREE.Color(0.42, 0.54, 0.84).multiplyScalar(0.62 * night * sstep(-2, 8, s.moonElevation) * user);
    const ambient = L.ambient.clone().multiplyScalar(1 - 0.85 * tw);
    const twAmb = mix3([lerp(0.10, 0.19, up01), lerp(0.15, 0.27, up01), lerp(0.27, 0.44, up01)], [lerp(0.06, 0.13, up01), lerp(0.07, 0.15, up01), lerp(0.12, 0.23, up01)], dusk);
    const agA = 0.3 + 0.7 * ag;
    ambient.r += twAmb[0] * tw * user * agA; ambient.g += twAmb[1] * tw * user * agA; ambient.b += twAmb[2] * tw * user * agA;
    ambient.r += 0.008 * night * user; ambient.g += 0.015 * night * user; ambient.b += 0.036 * night * user;
    const sunLum = sunCol.r + sunCol.g + sunCol.b, moonLum = moonCol.r + moonCol.g + moonCol.b;
    const sunKey = sunLum >= moonLum;
    U.uKeyDir.value.copy(sunKey ? sunV : moonV);
    U.uKeyColor.value.copy(sunKey ? sunCol : moonCol);
    // fill: the glow of the twilight horizon under the sun (unshadowed), or the moon
    if (tw > 0.01) {
      U.uFillDir.value.set(sunV.x, 0.22, sunV.z).normalize();
      U.uFillColor.value.setRGB(twHor[0], twHor[1], twHor[2]).multiplyScalar(lerp(0.34, 0.5, dusk) * tw * user);
    } else {
      U.uFillDir.value.copy(sunKey ? moonV : sunV);
      U.uFillColor.value.copy(sunKey ? moonCol : sunCol).multiplyScalar(sunKey ? 1 : 0.0);
    }
    U.uAlpenColor.value.copy(sunKey ? alpen : moonCol);
    U.uAlpen.value.set(sunKey ? yT : -100, 1.3, 10, 0);
    U.uAmbient.value.copy(ambient);
    U.uBounce.value.copy(sunKey ? sunCol : moonCol).multiplyScalar(0.05 * Math.max(U.uKeyDir.value.y, 0)).add(ambient.clone().multiplyScalar(0.12));
    U.uMoonHaze.value.setRGB(0.010, 0.017, 0.040).multiplyScalar(night * user);
    U.uMoonDir.value.copy(moonV);
    U.uMoonlit.value = dark;
    U.uSilver.value.set(0.79 * 0.62 * user, 0.84 * 0.62 * user, 0.91 * 0.62 * user, 0.92 * dark);
    U.uRim.value.copy(moonCol).multiplyScalar(1.1);
    U.uShaft.value.set((s.shafts ?? 1) * 0.34 * (1 - sstep(9, 26, elev)) * sstep(-7, -2, elev) * day * (0.6 + 0.8 * Math.min(1, s.cloudCover * 2)), clamp01(s.riverGold ?? 0), clamp01(s.riverCalm ?? 0), 0);
    // seasons in the grass: gold in autumn, bleached in winter
    const sea = s.season - Math.floor(s.season);
    const autumn = Math.exp(-Math.pow((sea - 0.8) / 0.11, 2)), bare = Math.pow(0.5 + 0.5 * Math.cos(sea * Math.PI * 2), 3);
    U.uVegTint.value.set(lerp(1 + 0.55 * autumn, 0.95, 0.8 * bare), lerp(1 + 0.08 * autumn, 0.85, 0.8 * bare), lerp(1 - 0.5 * autumn, 0.62, 0.8 * bare));
    const starVis = s.starVisibility ?? night;
    U.uNight.value.set(night, 20 * 0.03 * night * user, starVis * 0.9 * user, gain);
    // fog / haze
    const fogK = s.fog;
    const twFog = new THREE.Color(twHor[0] * 0.5 + twMid[0], twHor[1] * 0.5 + twMid[1], twHor[2] * 0.5 + twMid[2]).multiplyScalar(user);
    U.uFogA.value.set(0.0012 + 0.008 * fogK * fogK, 0.16, 0, gain);
    U.uFogColor.value.copy(L.fogColor).lerp(twFog, tw).lerp(new THREE.Color(0.02, 0.03, 0.06).multiplyScalar(user), night);
    U.uFogSunColor.value.copy(L.fogSunColor).lerp(twFog, tw * 0.7).lerp(new THREE.Color(0.05, 0.07, 0.12).multiplyScalar(user), night);
    // snow, vegetation
    const snowline = s.snowline ?? defaultSnowline(yr, s.season);
    U.uSnow.value.set(snowline, 5, vs.veg, 1 - sstep(0, 2500, yr));
    // snow on the flat valley floor is a factor of its own (see groundSnowOf). A snowline that is
    // driven down to the floor is turned into the same factor over a band 2.8 units deep, so no
    // value of `season` or `snowline` can switch the whole floor in one frame
    U.uSnow2.value.set(Math.max(s.snowline == null ? groundSnowOf(yr, s.season) : 0, 1 - sstep(-1.6, 1.2, snowline)), lerp(0.22, 1, dusk), 0, 0);
    // clouds
    const phase = s.cloudPhase ?? t * s.cloudSpeed;
    U.uCloud.value.set(s.cloudCover, phase, s.cloudStreak, 0.72 * sstep(0.02, 0.3, s.cloudCover));
    const cs = sunTransmittanceJS([sunV.x, Math.max(sunV.y, 0.02), sunV.z], { ...o, altitude: 5000 });
    U.uCloudSun.value.setRGB(cs[0], cs[1], cs[2]).multiplyScalar(2.6 * gain * day * sstep(-6, -1, elev)).lerp(new THREE.Color(1.0, 0.5, 0.36).multiplyScalar(1.5 * user * sstep(-5, -2, elev)), tw).add(moonCol.clone().multiplyScalar(0.8));
    U.uCloudAmb.value.copy(L.zenith).multiplyScalar(1.4).add(ambient.clone().multiplyScalar(0.25));
    U.uCloudDir.value.copy(sunKey ? sunV : moonV);
    U.uHorizonCol.value.copy(L.fogColor).lerp(L.fogSunColor, 0.3).lerp(twFog, tw);
    // river reflections
    const refl = L.fogColor.clone().lerp(L.fogSunColor, 0.5).lerp(twFog, tw);
    refl.r += 0.05 * night * user; refl.g += 0.065 * night * user; refl.b += 0.09 * night * user;
    U.uSkyRefl.value.set(refl.r, refl.g, refl.b, 1);
    const zen = L.zenith.clone().lerp(new THREE.Color(...twZen).multiplyScalar(user * 2.5), tw);
    U.uSkyReflZ.value.set(zen.r + 0.02 * night * user, zen.g + 0.03 * night * user, zen.b + 0.05 * night * user);

    // grains
    U.uSpin.value.set(s.spindrift, s.wind ?? 1, 0, 0);
    if (spindrift) { spindrift.setTime(t); spindrift.mesh.visible = s.spindrift > 0.001; }
    if (titleGrains) { titleGrains.setTime(t); titleGrains.setTitle(t, !!s.title); titleGrains.mesh.visible = !!s.title && s.spindrift > 0.001; }

    // rockfall: up to four live events; each has a site on the upper right face
    if (rockfall) {
      const S = { ...sh, snout, iceThin, carve: 0, river: null };
      const evs = (s.rockfall || []).map((e) => (typeof e === 'number' ? { t: e } : e));
      const life = s.rockfallLife ?? 3.2, scale = s.rockfallScale ?? 1;
      const live = evs.filter((e) => t >= e.t - 0.2 && t <= e.t + (e.life ?? life) + 0.5).slice(-4);
      for (let i = 0; i < 4; i++) {
        const e = live[i];
        if (!e) { rockfall.fallA.value[i].set(0, 0, 0, -1e3); continue; }
        const h1 = fract(Math.sin(e.t * 12.9898) * 43758.5453), h2 = fract(Math.sin(e.t * 78.233) * 12345.678);
        const u = e.u ?? 0.06 + (h1 - 0.35) * 0.2, tt = e.f ?? 0.08 + 0.12 * h2;
        const du = u - 0.04, dc = 160 - 22 * Math.pow(Math.min(Math.abs(du), 1.3), 1.5) + 3.5 * Math.sin(du * 6);
        const D = dc - tt * 30, x = ((du * 45 + 2.5) * Math.hypot(D, LC)) / LK160;
        rockfall.fallA.value[i].set(x, landJS(x, -D, S, 3).h, -D, e.t);
        rockfall.fallB.value[i].set(e.scale ?? scale, e.life ?? life, e.grains ?? s.rockfallGrains ?? 1, e.dust ?? 1);
      }
      rockfall.grains.setTime(t); rockfall.dust.setTime(t);
      rockfall.grains.mesh.visible = rockfall.dust.mesh.visible = live.length > 0;
    }

    // public lighting
    light.sunDir.copy(U.uKeyDir.value);
    light.sunColor.copy(U.uKeyColor.value);
    light.keyDir.copy(U.uKeyDir.value);
    light.keyColor.copy(U.uKeyColor.value);
    light.ambient.copy(ambient);
    light.fogColor.copy(U.uFogColor.value);
    light.fogSunColor.copy(U.uFogSunColor.value);
    light.moonDir.copy(moonV);
    light.moonColor.copy(moonCol);
    light.zenith.copy(L.zenith);
    light.gain = gain;
    current = { t, s, yr, vs, sh, snout, iceThin };
    for (const fn of hooks) fn(t, s, current);
  }

  const hooks = [];
  const landCache = new Map();
  function groundHeight(x, z, yr = 0) {
    const key = Math.round(yr * 10);
    let S = landCache.get(key);
    if (!S) {
      const vs = valleyState(yr), sh = shapeOf(yr);
      const snout = snoutDepth(vs.glacier);
      const river = vs.river > 0 ? buildRiver(new Float32Array(RIV.N * RIV.ROWS * 4), yr, null, Math.min(snout + 0.3, lerp(118, 88, vs.fill))) : null;
      S = { ...sh, snout, iceThin: vs.glacier > 0 ? lerp(0.5, 1, vs.glacier) * sstep(0, 0.1, vs.glacier) : 0, carve: vs.river > 0 ? 0.006 : 0, river };
      if (landCache.size > 24) landCache.clear();
      landCache.set(key, S);
    }
    return landJS(x, z, S, 5).h;
  }

  const api = {
    group, update, groundHeight,
    lighting: () => light,
    /** internal: uniforms, hooks and the terrain mesh, for the valley world's own extras */
    _: {
      U, hooks, terrain, geoWide, geoTele, state: () => current, shapeOf,
      /** surface point on the front face: u = profile coordinate, f = fraction of the face run below the crest */
      siteOf(u, f) {
        const c = current, S = { ...c.sh, snout: c.snout, iceThin: c.iceThin, carve: 0, river: null };
        const du = u - 0.04, dc = 160 - 22 * Math.pow(Math.min(Math.abs(du), 1.3), 1.5) + 3.5 * Math.sin(du * 6);
        const D = dc - f * 30, x = ((du * 45 + 2.5) * Math.hypot(D, LC)) / LK160;
        return [x, landJS(x, -D, S, 3).h, -D];
      },
    },
    dispose() {
      geoWide.dispose(); geoTele && geoTele.dispose(); terrainMat.dispose(); skyGeo.dispose(); skyMat.dispose(); riverTex.dispose();
      for (const d of disposers) d();
    },
  };
  api._.disposers = disposers;
  update(0, {});
  return api;
}

// ---------------------------------------------------------------------------------------------
// The slab of S11: a flake of rock, already cracked into blocks, that shears from the face. It
// slides and tilts as one body, then its blocks let go from the edges inward, tumble and grind
// down to dust. The terrain shows a dark scar where it was (uScar).
function createSlab(U) {
  const base = new THREE.IcosahedronGeometry(1, 1);
  const N = 170;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', base.attributes.position);
  const off = new Float32Array(N * 3), rnd = new Float32Array(N * 4);
  const rng = createRng('grain-slab');
  for (let i = 0; i < N; i++) {
    let x, y;
    do { x = rng() * 2 - 1; y = rng() * 2 - 1; } while (x * x + y * y > 1);
    off[i * 3] = x * 1.2; off[i * 3 + 1] = y * 2.0; off[i * 3 + 2] = (rng() - 0.45) * 0.45 * (1 - 0.6 * (x * x + y * y));
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = rng();
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    name: 'valley-slab',
    uniforms: { ...U, uSlabA: { value: new THREE.Vector4() } },
    vertexShader: '#define SKY_STEPS 8\n' + SKY + LIGHT_UNIFORMS_GLSL + /* glsl */ `
      attribute vec3 aOff;
      attribute vec4 aRnd;
      uniform vec4 uSlabA;   // site xyz, time since release
      varying vec3 vWorld; varying vec3 vSlab; varying vec3 vAerT; varying vec3 vAerL; varying float vSeed;
      vec3 rotAxis(vec3 v, vec3 ax, float a) { return mix(dot(ax, v) * ax, v, cos(a)) + cross(ax, v) * sin(a); }
      void main() {
        float tau = max(uSlabA.w, 0.0);
        vec3 q = position * (1.0 + 0.35 * snoise(position.xy * 1.7 + aRnd.xy * 20.0 + position.z));
        float size = 0.46 * (0.7 + 0.8 * aRnd.z);
        // blocks at the rim and the foot of the flake let go first
        float rim = length(aOff.xy / vec2(1.2, 2.0));
        float tb = 1.05 + 0.85 * (1.0 - rim) + 0.4 * aRnd.w + 0.2 * (aOff.y / 2.0 + 1.0);
        float dt = max(tau - tb, 0.0);
        q = rotAxis(q, normalize(aRnd.xyz - 0.5), dt * (1.5 + 4.0 * aRnd.x));
        float grind = 1.0 - smoothstep(1.0, 3.4, dt);
        vec3 l = aOff + q * size * vec3(1.0, 1.0, 0.75) * grind;
        vSlab = aOff + position * size * 0.6;
        vSeed = aRnd.y;
        // the flake as one body: it slides down the face and tilts outward about its foot
        float tilt = 0.5 * smoothstep(0.0, 2.6, tau) * smoothstep(0.0, 2.6, tau);
        float c = cos(tilt), s = sin(tilt);
        l.y += 2.0;
        l = vec3(l.x, c * l.y - s * l.z, s * l.y + c * l.z);
        l.y -= 2.0;
        float drop = 0.62 * tau * tau;
        // free blocks: thrown outward and sideways, then pulled down the slope
        vec3 fr = vec3((aRnd.x - 0.5) * 1.7, -(0.3 + 1.0 * aRnd.y), 0.45 + 1.2 * aRnd.w) * dt + vec3(0.0, -0.75, 0.2) * dt * dt;
        vec3 X = normalize(vec3(1.0, 0.0, 0.25)), Y = normalize(vec3(-0.12, 0.80, -0.60)), Z = normalize(cross(X, Y));
        vec3 wp = uSlabA.xyz + X * (l.x + fr.x) + Y * (l.y - drop + fr.y) + Z * (l.z + 0.22 + 0.3 * drop + fr.z);
        vWorld = wp;
        vec3 toP = wp - cameraPosition; float dist = length(toP); vec3 rd = toP / dist;
        vec3 T; vec3 L = atmosphere(normalize(vec3(rd.x, max(rd.y, -0.02), rd.z)), dist * uAtmo2.x, T);
        L = L * (1.0 - 0.9 * uTwHaze.a) + uTwHaze.rgb * uTwHaze.a * (1.0 - dot(T, vec3(0.3333)));
        vAerT = T; vAerL = L;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: NOISE + LIGHT_UNIFORMS_GLSL + /* glsl */ `
      varying vec3 vWorld; varying vec3 vSlab; varying vec3 vAerT; varying vec3 vAerL; varying float vSeed;
      void main() {
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (dot(n, cameraPosition - vWorld) < 0.0) n = -n;
        float strata = 0.5 + 0.5 * sin(vSlab.y * 7.0 + vSlab.x * 1.3 + 2.0 * snoise(vSlab.xy * 1.5));
        vec3 rock = mix(vec3(0.07, 0.065, 0.06), vec3(0.22, 0.19, 0.16), 0.55 * strata + 0.45 * vSeed);
        // what was the outside of the face still carries its snow
        float outer = smoothstep(0.02, 0.12, vSlab.z) * smoothstep(0.35, 0.8, n.y + 0.25 * n.z);
        float snow = outer * smoothstep(0.5, 0.75, snoise(vSlab.xy * 0.9 + 4.0) * 0.5 + 0.5 + 0.2 * vSeed) * smoothstep(0.2, 1.2, vSlab.y) * 0.8;
        vec3 alb = mix(rock, vec3(0.86, 0.88, 0.92), snow);
        vec3 light = uKeyColor * max(dot(n, uKeyDir), 0.0) + uAmbient * (0.55 + 0.45 * n.y) + uBounce;
        gl_FragColor = vec4(alb * light * vAerT + vAerL, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  return {
    mesh,
    set(site, tau) { mat.uniforms.uSlabA.value.set(site[0], site[1], site[2], tau); },
    dispose() { geo.dispose(); base.dispose(); mat.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
// The world: S06, S08, S10, S11
export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(MASTER_CAMERA.fov, ctx.aspect, 0.1, 2000);
  scene.add(camera);
  const land = await createLandscape(ctx, { tele: true, title: true });
  scene.add(land.group);
  const slab = createSlab(land._.U);
  slab.mesh.visible = false;
  scene.add(slab.mesh);

  return {
    scene, camera, land,
    post: { bloom: 0.05, halation: 0.1 },
    update(t, localT, shot, p) {
      const { camera: _c, ...state } = p;
      land.update(t, state);
      const tele = !!p.tele && land._.geoTele;
      land._.terrain.geometry = tele ? land._.geoTele : land._.geoWide;
      land._.U.uOct.value = tele ? 7 : 5;
      // the slab (S11): params.slab = { t, u, f }; the terrain keeps a scar where it was
      slab.mesh.visible = false;
      land._.U.uScar.value.set(0, 0, 0, 0);
      if (p.slab) {
        const tau = t - p.slab.t;
        if (tau > -0.5) {
          const site = land._.siteOf(p.slab.u, p.slab.f);
          land._.U.uScar.value.set(site[0], site[1], site[2], 1);
          if (tau < 6.5) { slab.mesh.visible = true; slab.set(site, tau); }
        }
      }
      const near = p.near ?? 0.15, far = 2000;
      if (camera.near !== near || camera.far !== far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    },
    dispose() { land.dispose(); slab.dispose(); },
  };
}
