// JS side of the sky: uniforms, a fullscreen sky background mesh, and a CPU port of the
// atmosphere so worlds can light built-in materials / fog with colours that match the sky.
//
//   import { createSky, sunDirection } from '../lib/sky.js';
//   const sky = createSky({ turbidity: 2, stars: 0.0 });
//   scene.add(sky.mesh);                                   // background (draws first, no depth)
//   myMaterial.uniforms = { ...sky.uniforms, ...mine };    // share uniforms with any shader using SKY
//   // per frame (in update):
//   sky.set({ sunElevation: 6, sunAzimuth: 20, time: t });
//   const { sunColor, ambient, fogColor, fogSunColor } = sky.lighting(); // linear THREE.Color
//
// Directions: y is up. sunDirection(elev, az): az = 0 looks down -Z (the default camera forward),
// az = 90 is +X. Elevation in degrees above the horizon (negative = below).

import * as THREE from 'three';
import { SKY } from './glsl/sky.js';

export function sunDirection(elevationDeg, azimuthDeg = 0, target = new THREE.Vector3()) {
  const e = THREE.MathUtils.degToRad(elevationDeg);
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  return target.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)).normalize();
}

export const SKY_DEFAULTS = {
  sunElevation: 10,     // degrees
  sunAzimuth: 0,        // degrees
  sunIntensity: 20,
  turbidity: 1.5,       // mie scale: 1 clear .. 10 smog
  ozone: 1,
  altitude: 200,        // observer altitude in metres
  multiScatter: 0.35,
  metersPerUnit: 1,     // aerial perspective scale
  rayleigh: 1,
  mieG: 0.76,
  sunSize: 0.55,        // angular radius (deg); the real sun is 0.27
  stars: 1,             // star intensity
  starDensity: 1,
  twinkle: 0.6,
  milkyWay: 0.0,
  time: 0,
};

/** Create the shared sky uniform objects (pass them into any ShaderMaterial using SKY). */
export function createSkyUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
    uSunIntensity: { value: 20 },
    uAtmo: { value: new THREE.Vector4(1.5, 1, 200, 0.35) },
    uAtmo2: { value: new THREE.Vector4(1, 1, 0.76, 0.55) },
    uSkyTime: { value: 0 },
    uStars: { value: new THREE.Vector4(1, 1, 0.6, 0) },
    uPixelAngle: { value: 0.0006 },
  };
}

/** Write sky options into uniforms. `o.sunDir` (Vector3/array) overrides elevation/azimuth. */
export function applySkyUniforms(u, o) {
  if (o.sunDir) {
    const d = o.sunDir;
    if (Array.isArray(d)) u.uSunDir.value.set(d[0], d[1], d[2]).normalize();
    else u.uSunDir.value.copy(d).normalize();
  } else {
    sunDirection(o.sunElevation, o.sunAzimuth, u.uSunDir.value);
  }
  u.uSunIntensity.value = o.sunIntensity;
  u.uAtmo.value.set(o.turbidity, o.ozone, o.altitude, o.multiScatter);
  u.uAtmo2.value.set(o.metersPerUnit, o.rayleigh, o.mieG, o.sunSize);
  u.uSkyTime.value = o.time;
  u.uStars.value.set(o.stars, o.starDensity, o.twinkle, o.milkyWay);
}

// ---------------------------------------------------------------------------------------------
// CPU port of atmosphereEx() (keep in sync with glsl/sky.js)
const RE = 6360e3, RA = 6460e3, HR = 8000, HM = 1200, LN2 = Math.LN2;
const BR = [5.802e-6, 13.558e-6, 33.1e-6], BM = 3.996e-6, BO = [0.65e-6, 1.881e-6, 0.085e-6];

function chapman(X, h, coschi) {
  const c = Math.sqrt(X + h);
  if (coschi >= 0) return (c / (c * coschi + 1)) * Math.pow(2, -h);
  const x0 = Math.sqrt(1 - coschi * coschi) * (X + h);
  const c0 = Math.sqrt(x0);
  return 2 * c0 * Math.pow(2, Math.min(X - x0, 60)) - (c / (1 - c * coschi)) * Math.pow(2, -h);
}
function sphere(o, d, r) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  const disc = b * b - c;
  if (disc < 0) return [-1, -1];
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}
const smooth = (a, b, x) => { const k = Math.min(Math.max((x - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); };

/**
 * CPU atmosphere. rd, sunDir: [x,y,z] normalized. Returns { L: [r,g,b], T: [r,g,b] } (linear).
 */
export function atmosphereJS(rd, sunDir, opts = {}, steps = 16, maxDist = 1e9) {
  const o = { ...SKY_DEFAULTS, ...opts };
  const mie = o.turbidity, ray = o.rayleigh, g = o.mieG, oz = o.ozone;
  const ext = (dR, dM) => [0, 1, 2].map((i) => BR[i] * ray * dR + BM * 1.11 * mie * dM + BO[i] * oz * 1.9 * dR);
  const orig = [0, RE + Math.max(o.altitude, 1), 0];
  const top = sphere(orig, rd, RA), gnd = sphere(orig, rd, RE);
  let tMax = top[1];
  if (gnd[0] > 0) tMax = Math.min(tMax, gnd[0]);
  tMax = Math.min(tMax, maxDist);
  const mu = rd[0] * sunDir[0] + rd[1] * sunDir[1] + rd[2] * sunDir[2];
  const sumR = [0, 0, 0], sumM = [0, 0, 0];
  let odR = 0, odM = 0, tPrev = 0;
  for (let i = 0; i < steps; i++) {
    const f = (i + 1) / steps;
    const tCur = tMax * f * f, ds = tCur - tPrev, tMid = 0.5 * (tPrev + tCur);
    tPrev = tCur;
    const p = [orig[0] + rd[0] * tMid, orig[1] + rd[1] * tMid, orig[2] + rd[2] * tMid];
    const r = Math.hypot(p[0], p[1], p[2]);
    const h = r - RE;
    const segR = Math.exp(-h / HR) * ds, segM = Math.exp(-h / HM) * ds;
    const vR = odR + 0.5 * segR, vM = odM + 0.5 * segM;
    odR += segR; odM += segM;
    const muS = (p[0] * sunDir[0] + p[1] * sunDir[1] + p[2] * sunDir[2]) / r;
    const b = r * muS;
    const shadow = b < 0 ? smooth(RE - 2000, RE + 6000, Math.sqrt(Math.max(r * r - b * b, 0))) : 1;
    if (shadow <= 0) continue;
    const hh = Math.max(h, 0);
    const lR = HR * chapman(RE / (HR * LN2), hh / (HR * LN2), muS);
    const lM = HM * chapman(RE / (HM * LN2), hh / (HM * LN2), muS);
    const e = ext(vR + lR, vM + lM);
    for (let c = 0; c < 3; c++) {
      const T = Math.exp(-e[c]) * shadow;
      sumR[c] += T * segR; sumM[c] += T * segM;
    }
  }
  const eV = ext(odR, odM);
  const T = eV.map((x) => Math.exp(-x));
  const pR = 0.05968310365946075 * (1 + mu * mu);
  const g2 = g * g;
  const pM = 0.1193662073189215 * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * mu, 1e-4), 1.5));
  // twilight floor (mirror of the GLSL)
  const sEl = sunDir[1];
  const ss = smooth(-0.33, -0.02, sEl);
  const tw = o.multiScatter * ss * Math.exp(Math.min(sEl, 0) * 14) * (1 - smooth(0, 0.14, sEl));
  let twl = [0, 0, 0];
  if (tw > 0 && maxDist > 1e8) {
    const horizon = Math.pow(1 - Math.min(Math.max(rd[1], 0), 1), 3);
    const hl = Math.hypot(sunDir[0], sunDir[2]) || 1, vl = Math.hypot(rd[0], rd[2]) || 1;
    const toward = 0.5 + 0.5 * ((sunDir[0] * rd[0] + sunDir[2] * rd[2]) / (hl * vl));
    const blue = [0.16, 0.26, 0.55], glow = [1.0, 0.42, 0.16];
    twl = [0, 1, 2].map((c) => 0.0035 * tw * (blue[c] * (0.6 + 0.8 * horizon) + glow[c] * 1.5 * Math.pow(toward, 4) * horizon));
  }
  const L = [0, 1, 2].map((c) => {
    const bR = BR[c] * ray, bM = BM * mie;
    const single = sumR[c] * bR * pR + sumM[c] * bM * pM;
    const multi = (sumR[c] * bR + sumM[c] * bM * 0.5) * 0.0795774715 * o.multiScatter;
    return o.sunIntensity * (single + multi + twl[c]);
  });
  return { L, T };
}

/** Transmittance of direct sunlight reaching the observer (multiply by sunIntensity for radiance). */
export function sunTransmittanceJS(sunDir, opts = {}) {
  const o = { ...SKY_DEFAULTS, ...opts };
  const r = RE + Math.max(o.altitude, 1);
  const mu = sunDir[1];
  const lR = HR * chapman(RE / (HR * LN2), o.altitude / (HR * LN2), mu);
  const lM = HM * chapman(RE / (HM * LN2), o.altitude / (HM * LN2), mu);
  const shadow = mu < 0 ? smooth(RE - 2000, RE + 6000, r * Math.sqrt(1 - mu * mu)) : 1;
  return [0, 1, 2].map((c) => Math.exp(-(BR[c] * o.rayleigh * lR + BM * 1.11 * o.turbidity * lM + BO[c] * o.ozone * 1.9 * lR)) * shadow);
}

const toArr = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);

/**
 * Lighting colours matched to the sky (linear THREE.Color, already scaled to scene units where a
 * white lambert surface under direct sun reads ~1.0):
 *   sunColor     direct sun irradiance colour (use for DirectionalLight / custom shading)
 *   ambient      average sky radiance over the upper hemisphere (hemisphere/ambient light)
 *   fogColor     horizon sky colour looking away from the sun
 *   fogSunColor  horizon sky colour looking toward the sun
 *   zenith       sky colour straight up
 */
export function skyLighting(opts = {}) {
  const o = { ...SKY_DEFAULTS, ...opts };
  const sd = o.sunDir ? toArr(o.sunDir) : toArr(sunDirection(o.sunElevation, o.sunAzimuth));
  const T = sunTransmittanceJS(sd, o);
  const k = o.sunIntensity / 20; // sunlight scale (sunIntensity 20 -> ~1 white irradiance)
  const sunColor = new THREE.Color(T[0] * k * 3.2, T[1] * k * 3.2, T[2] * k * 3.2);
  // hemisphere average: zenith + ring at 30 deg + ring at 8 deg
  const acc = [0, 0, 0];
  let wsum = 0;
  const sample = (d, w) => {
    const { L } = atmosphereJS(d, sd, o, 10);
    for (let c = 0; c < 3; c++) acc[c] += L[c] * w;
    wsum += w;
  };
  sample([0, 1, 0], 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    for (const el of [30, 8]) {
      const e = (el * Math.PI) / 180;
      sample([Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)], el === 30 ? 1 : 0.7);
    }
  }
  const ambient = new THREE.Color(acc[0] / wsum, acc[1] / wsum, acc[2] / wsum).multiplyScalar(Math.PI * 0.5);
  const horiz = (dx, dz) => {
    const len = Math.hypot(dx, dz) || 1;
    const d = [dx / len * 0.9998, 0.02, dz / len * 0.9998];
    return new THREE.Color(...atmosphereJS(d, sd, o, 12).L);
  };
  const fogSunColor = horiz(sd[0], sd[2]);
  const fogColor = horiz(-sd[0], -sd[2]);
  const zenith = new THREE.Color(...atmosphereJS([0, 1, 0], sd, o, 12).L);
  return { sunDir: new THREE.Vector3(...sd), sunColor, ambient, fogColor, fogSunColor, zenith };
}

// ---------------------------------------------------------------------------------------------
// Background mesh: a fullscreen triangle drawn first, evaluating skyRadiance() per pixel.

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec2 ndc = position.xy;
  // view-space ray for this NDC corner (exact for perspective, incl. off-centre frusta)
  vec3 v = vec3((ndc.x + projectionMatrix[2][0]) / projectionMatrix[0][0],
                (ndc.y + projectionMatrix[2][1]) / projectionMatrix[1][1], -1.0);
  vDir = transpose(mat3(viewMatrix)) * v;
  gl_Position = vec4(ndc, 1.0, 1.0);
}`;

const SKY_FRAG = SKY + /* glsl */ `
varying vec3 vDir;
uniform float uSkyExposure;
void main() {
  vec3 rd = normalize(vDir);
  gl_FragColor = vec4(skyRadiance(rd) * uSkyExposure, 1.0);
}`;

/**
 * Create a sky: shared uniforms + background mesh + helpers.
 * @param {Partial<typeof SKY_DEFAULTS> & {exposure?: number}} opts
 */
export function createSky(opts = {}) {
  const state = { ...SKY_DEFAULTS, ...opts };
  const uniforms = createSkyUniforms();
  const material = new THREE.ShaderMaterial({
    name: 'film-sky',
    uniforms: { ...uniforms, uSkyExposure: { value: opts.exposure ?? 1 } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6;
  mesh.name = 'sky';
  // radians per pixel for star / sun anti-aliasing
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const h = renderer.getRenderTarget()?.height || renderer.domElement.height;
    const fovY = camera.isPerspectiveCamera ? THREE.MathUtils.degToRad(camera.getEffectiveFOV()) : 1;
    uniforms.uPixelAngle.value = fovY / Math.max(h, 1);
  };
  applySkyUniforms(uniforms, state);

  return {
    mesh,
    material,
    uniforms,
    state,
    /** Update any subset of SKY_DEFAULTS keys (plus `sunDir`). */
    set(o) {
      Object.assign(state, o);
      if (o.exposure !== undefined) material.uniforms.uSkyExposure.value = o.exposure;
      applySkyUniforms(uniforms, state);
      this._lighting = null;
      return this;
    },
    /** Sky-matched lighting colours (cached until the next set()). */
    lighting() {
      if (!this._lighting) this._lighting = skyLighting({ ...state, sunDir: uniforms.uSunDir.value });
      return this._lighting;
    },
    sunDir: () => uniforms.uSunDir.value,
    dispose() { geo.dispose(); material.dispose(); },
  };
}
