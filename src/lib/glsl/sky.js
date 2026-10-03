// Physically plausible sky: single-scattering Rayleigh + Mie + ozone through a spherical
// atmosphere, with an analytic Chapman-function light path (no inner loop), Earth-shadow,
// a cheap multiple-scattering term, a limb-darkened sun disk, a twinkling star field, and an
// optional milky-way band. Everything is a pure function of (direction, uniforms, t).
//
// Uniforms (declared by this chunk, created/updated by src/lib/sky.js -> createSkyUniforms()):
//   uSunDir        vec3   normalized direction TO the sun (world space, y up)
//   uSunIntensity  float  ~20 for daylight
//   uAtmo          vec4   x: mie/turbidity scale (1 = clear, 4 = hazy, 10 = smog)
//                         y: ozone amount (1 = earth)   z: observer altitude (m)
//                         w: multiple-scattering boost (0.0 .. 1.0, default 0.35)
//   uAtmo2         vec4   x: metres per world unit (aerial perspective scale)
//                         y: rayleigh scale (1 = earth; >1 deeper blue / more haze)
//                         z: mie anisotropy g (0.76)   w: sun disk angular radius (degrees)
//   uSkyTime       float  film time (stars twinkle)
//   uStars         vec4   x: intensity  y: density  z: twinkle  w: milky way amount
//   uPixelAngle    float  radians per pixel (star anti-aliasing); set by the sky helper
//
// Functions
//   vec3 atmosphere(vec3 rd, float maxDistMeters, out vec3 transmittance)  – uses the uniforms
//   vec3 atmosphereEx(vec3 rd, float maxDist, vec3 sunDir, float sunI, out vec3 T) – explicit light
//   vec3 skyRadiance(vec3 rd)            – full sky: atmosphere + sun disk + stars (background)
//   vec3 sunDisk(vec3 rd, vec3 T)        – limb-darkened sun, multiply-in view transmittance
//   vec3 starField(vec3 rd, float t)     – star field radiance (multiply by T and darkness)
//   float starVisibility()               – 0 by day, 1 at night (from uSunDir.y)
//   vec3 sunTransmittance(vec3 dir)      – colour of direct sunlight at the observer
//   vec3 aerialPerspective(vec3 col, vec3 rd, float distWorld) – haze a surface at distance
//   vec3 skyFogColor(vec3 rd)            – cheap 8-step sky colour for fog in-scatter

import { NOISE } from './noise.js';

export const SKY = NOISE + /* glsl */ `
#ifndef FILM_SKY
#define FILM_SKY
#ifndef SKY_STEPS
#define SKY_STEPS 16
#endif
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform vec4 uAtmo;
uniform vec4 uAtmo2;
uniform float uSkyTime;
uniform vec4 uStars;
uniform float uPixelAngle;

const float ATM_RE = 6360e3;
const float ATM_RA = 6460e3;
const float ATM_HR = 8000.0;
const float ATM_HM = 1200.0;
const float ATM_LN2 = 0.6931471805599453;
const vec3 ATM_BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float ATM_BETA_M = 3.996e-6;
const vec3 ATM_BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);

// Schüler's Chapman approximation, heights in units of the 50%-height. Returns the relative
// optical depth (vertical column = ~1) times the density at the start point.
float atmChapman(float X, float h, float coschi) {
  float c = sqrt(X + h);
  if (coschi >= 0.0) return c / (c * coschi + 1.0) * exp2(-h);
  float x0 = sqrt(1.0 - coschi * coschi) * (X + h);
  float c0 = sqrt(x0);
  return 2.0 * c0 * exp2(min(X - x0, 60.0)) - c / (1.0 - c * coschi) * exp2(-h);
}
// ray (origin o relative to planet centre) vs sphere radius r: returns (tNear, tFar), tFar<0 = miss
vec2 atmSphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0, -1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}
float atmPhaseR(float mu) { return 0.05968310365946075 * (1.0 + mu * mu); }
float atmPhaseM(float mu, float g) {
  float g2 = g * g;
  return 0.1193662073189215 * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
// optical depth (in metres of sea-level density) from a point at radius r towards dir (cos = mu)
void atmLightDepth(float r, float mu, out float dR, out float dM) {
  float h = max(r - ATM_RE, 0.0);
  dR = ATM_HR * atmChapman(ATM_RE / (ATM_HR * ATM_LN2), h / (ATM_HR * ATM_LN2), mu);
  dM = ATM_HM * atmChapman(ATM_RE / (ATM_HM * ATM_LN2), h / (ATM_HM * ATM_LN2), mu);
}
vec3 atmExtinction(float dR, float dM) {
  float mie = uAtmo.x, ozone = uAtmo.y, ray = uAtmo2.y;
  return ATM_BETA_R * ray * dR + ATM_BETA_M * 1.11 * mie * dM + ATM_BETA_O * ozone * 1.9 * dR;
}

vec3 atmosphereEx(vec3 rd, float maxDist, vec3 sunDir, float sunI, out vec3 transmittance) {
  float mie = uAtmo.x, ray = uAtmo2.y, g = uAtmo2.z;
  vec3 o = vec3(0.0, ATM_RE + max(uAtmo.z, 1.0), 0.0);
  vec2 top = atmSphere(o, rd, ATM_RA);
  vec2 gnd = atmSphere(o, rd, ATM_RE);
  float tMax = top.y;
  if (gnd.x > 0.0) tMax = min(tMax, gnd.x);
  tMax = min(tMax, maxDist);
  float mu = dot(rd, sunDir);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float tPrev = 0.0;
  for (int i = 0; i < SKY_STEPS; i++) {
    float f = (float(i) + 1.0) / float(SKY_STEPS);
    float tCur = tMax * f * f;                        // quadratic: dense near the observer
    float ds = tCur - tPrev;
    float tMid = 0.5 * (tPrev + tCur);
    tPrev = tCur;
    vec3 p = o + rd * tMid;
    float r = length(p);
    float h = r - ATM_RE;
    float rhoR = exp(-h / ATM_HR), rhoM = exp(-h / ATM_HM);
    float segR = rhoR * ds, segM = rhoM * ds;
    // optical depth along the view ray up to the sample midpoint
    float vR = odR + 0.5 * segR, vM = odM + 0.5 * segM;
    odR += segR; odM += segM;
    vec3 up = p / r;
    float muS = dot(up, sunDir);
    // Earth shadow: does the ray towards the sun graze the planet?
    float b = r * muS;
    float shadow = 1.0;
    if (b < 0.0) shadow = smoothstep(ATM_RE - 2000.0, ATM_RE + 6000.0, sqrt(max(r * r - b * b, 0.0)));
    if (shadow <= 0.0) continue;
    float lR, lM;
    atmLightDepth(r, muS, lR, lM);
    vec3 T = exp(-atmExtinction(vR + lR, vM + lM)) * shadow;
    sumR += T * segR;
    sumM += T * segM;
  }
  transmittance = exp(-atmExtinction(odR, odM));
  vec3 bR = ATM_BETA_R * ray, bM = vec3(ATM_BETA_M * mie);
  vec3 single = sumR * bR * atmPhaseR(mu) + sumM * bM * atmPhaseM(mu, g);
  vec3 multi = (sumR * bR + sumM * bM * 0.5) * (0.0795774715 * uAtmo.w); // isotropic boost
  // twilight floor (stands in for higher-order scattering): keeps blue hour blue after sunset,
  // with a warm band on the horizon under the sun. Fades in around sunset, decays with depression.
  float sEl = sunDir.y;
  float tw = uAtmo.w * smoothstep(-0.33, -0.02, sEl) * exp(min(sEl, 0.0) * 14.0) * (1.0 - smoothstep(0.0, 0.14, sEl));
  vec3 twilight = vec3(0.0);
  if (tw > 0.0 && maxDist > 1e8) {
    float horizon = pow(1.0 - saturate(rd.y), 3.0);
    vec2 hs = normalize(sunDir.xz + vec2(1e-5)), hv = normalize(rd.xz + vec2(1e-5));
    float toward = 0.5 + 0.5 * dot(hs, hv);
    twilight = 0.0035 * tw * (vec3(0.16, 0.26, 0.55) * (0.6 + 0.8 * horizon) + vec3(1.0, 0.42, 0.16) * 1.5 * pow(toward, 4.0) * horizon);
  }
  return sunI * (single + multi + twilight);
}

vec3 atmosphere(vec3 rd, float maxDist, out vec3 transmittance) {
  return atmosphereEx(rd, maxDist, uSunDir, uSunIntensity, transmittance);
}

vec3 sunTransmittance(vec3 dir) {
  float r = ATM_RE + max(uAtmo.z, 1.0);
  float lR, lM;
  atmLightDepth(r, dir.y, lR, lM);
  float shadow = dir.y < 0.0 ? smoothstep(ATM_RE - 2000.0, ATM_RE + 6000.0, r * sqrt(1.0 - dir.y * dir.y)) : 1.0;
  return exp(-atmExtinction(lR, lM)) * shadow;
}

vec3 sunDisk(vec3 rd, vec3 T) {
  float radius = radians(max(uAtmo2.w, 0.05));
  float cosR = cos(radius);
  float d = dot(rd, uSunDir);
  float px = max(uPixelAngle, 1e-5);
  // anti-aliased edge (1 px), limb darkening
  float ang = acos(clamp(d, -1.0, 1.0));
  float edge = 1.0 - smoothstep(radius - px, radius + px, ang);
  float x = saturate(ang / radius);
  float limb = 1.0 - 0.55 * (1.0 - sqrt(max(1.0 - x * x, 0.0)));
  return T * edge * limb * uSunIntensity * 120.0;
}

float starVisibility() {
  // first stars around -3 deg (end of civil twilight ~ -6), full by ~ -12 deg
  return smoothstep(-0.05, -0.2, uSunDir.y);
}

// cube-face hashed star grid; each cell holds at most one star kept away from the cell border
vec3 starLayer(vec3 rd, float cells, float density, float seed, float t, float bright) {
  vec3 a = abs(rd);
  vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = rd.yz / a.x; face = rd.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = rd.xz / a.y; face = rd.y > 0.0 ? 2.0 : 3.0; }
  else { uv = rd.xy / a.z; face = rd.z > 0.0 ? 4.0 : 5.0; }
  vec2 g = (uv * 0.5 + 0.5) * cells;
  vec2 cell = floor(g);
  vec2 f = g - cell;
  vec4 h = hash42(cell + vec2(face * 1013.0 + seed, seed * 7.0));
  if (h.w > density) return vec3(0.0);
  vec2 pos = 0.25 + 0.5 * h.xy;
  // cell size in radians ~ 2/cells/(1+|uv|^2)
  float cellAngle = 2.0 / cells / (1.0 + dot(uv, uv));
  float dAng = length(f - pos) * cellAngle;
  float sigma = max(uPixelAngle, 1e-5) * 0.55;
  // power-law magnitudes: a handful of bright stars, many faint ones
  float m = h.z;
  float mag = bright * (0.015 + 0.25 * m * m * m + 4.0 * pow(m, 24.0));
  float core = exp(-0.5 * dAng * dAng / (sigma * sigma));
  // colour temperature: mostly white, some blue, some warm
  float ct = hash12(cell + 3.1 + face);
  vec3 tint = ct < 0.3 ? vec3(0.78, 0.88, 1.25) : (ct > 0.82 ? vec3(1.25, 0.92, 0.68) : vec3(1.0, 0.98, 0.95));
  // scintillation: strongest near the horizon
  float tw = uStars.z * (0.3 + 0.7 * (1.0 - saturate(rd.y * 2.0)));
  float ph = h.x * 61.0 + h.y * 17.0;
  float flick = 1.0 + tw * (0.5 * sin(t * (5.0 + 9.0 * h.y) + ph) + 0.3 * sin(t * (13.0 + 11.0 * h.x) + ph * 1.7));
  return tint * mag * core * max(flick, 0.0);
}

vec3 starField(vec3 rd, float t) {
  float dens = uStars.y;
  // clumpy large-scale density so the field is not a uniform "snow"
  float clump = smoothstep(-0.35, 0.6, fbm(rd * 2.2 + 11.0, 3));
  vec3 n = normalize(vec3(0.35, 0.25, 0.9));
  float d = dot(rd, n);
  float band = exp(-d * d / 0.025) * uStars.w;
  float k = dens * (0.45 + 0.8 * clump + 1.2 * band);
  vec3 s = starLayer(rd, 460.0, 0.05 * k, 0.0, t, 0.6)
         + starLayer(rd, 210.0, 0.06 * k, 31.0, t, 1.0)
         + starLayer(rd, 80.0, 0.06 * dens, 77.0, t, 2.2);
  // milky way: diffuse glow along a tilted great circle with dark dust lanes
  if (band > 0.001) {
    float neb = fbm(rd * 7.0, 5) * 0.5 + 0.5;
    float lanes = smoothstep(0.45, 0.72, fbm(rd * 13.0 + 4.0, 4) * 0.5 + 0.5) * exp(-d * d / 0.01);
    float core = exp(-d * d / 0.006);
    vec3 glow = mix(vec3(0.6, 0.66, 0.85), vec3(1.0, 0.88, 0.72), core);
    s += glow * band * (0.006 + 0.03 * neb * neb * neb + 0.02 * core) * (1.0 - 0.85 * lanes);
    s += starLayer(rd, 900.0, 0.3 * band, 113.0, t, 0.35);
  }
  return s * uStars.x;
}

vec3 skyRadiance(vec3 rd) {
  vec3 T;
  vec3 L = atmosphere(rd, 1e9, T);
  L += sunDisk(rd, T);
  float sv = starVisibility() * uStars.x;
  if (sv > 0.0 && rd.y > -0.05) L += starField(rd, uSkyTime) * T * starVisibility();
  // faint airglow so the night sky is never pure black
  L += vec3(0.0004, 0.0006, 0.0012) * (1.0 + 2.0 * pow(1.0 - saturate(rd.y), 4.0));
  return L;
}

// Physically based aerial perspective for a surface at distWorld (world units; uAtmo2.x m/unit).
vec3 aerialPerspective(vec3 col, vec3 rd, float distWorld) {
  vec3 T;
  vec3 dir = normalize(vec3(rd.x, max(rd.y, -0.02), rd.z));
  vec3 L = atmosphere(dir, distWorld * uAtmo2.x, T);
  return col * T + L;
}

// Cheap sky colour for fog in-scatter (8 steps). Looks at the horizon-clamped direction.
vec3 skyFogColor(vec3 rd) {
  vec3 T;
  vec3 dir = normalize(vec3(rd.x, max(rd.y, 0.015), rd.z));
  return atmosphere(dir, 1e9, T);
}
#endif
`;

/**
 * Exponential height fog (analytic integral along the ray, IQ). Pair with skyFogColor() or with
 * colours computed on the CPU (sky.js -> fogColors()).
 *
 *   float a = heightFog(ro, rd, dist, density, falloff, baseHeight);   // 0..1
 *   col = mix(col, fogInscatter(rd, sunDir, fogColor, fogSunColor, 8.0), a);
 */
export const FOG = /* glsl */ `
#ifndef FILM_FOG
#define FILM_FOG
float heightFog(vec3 ro, vec3 rd, float dist, float density, float falloff, float baseHeight) {
  float h = ro.y - baseHeight;
  float a = density * exp(-falloff * h);
  float k = falloff * rd.y;
  float integral = abs(k) > 1e-5 ? a * (1.0 - exp(-k * dist)) / k : a * dist;
  return 1.0 - exp(-max(integral, 0.0));
}
vec3 fogInscatter(vec3 rd, vec3 sunDir, vec3 fogColor, vec3 fogSunColor, float sunPower) {
  float s = max(dot(rd, sunDir), 0.0);
  return mix(fogColor, fogSunColor, pow(s, sunPower));
}
// Distance-based exponential fog (no height term)
float distanceFog(float dist, float density) { return 1.0 - exp(-dist * density); }
#endif
`;
