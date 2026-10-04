// CITY set `facade` (S09): one tower face unrolled as a hanging scroll. A lit elevator cell with one
// standing figure holds at mid-frame while forty-four floors of windows stream upward past it; the
// neighbouring towers slip by in parallax; rain; the street arrives at 97.0, with umbrellas.
//
// A painted backdrop (sky, two planes of neighbours, the face itself: 44 floors by 18 bays, the glass
// shaft, the roof with its machine room and tank, the lobby, the wet pavement), the figure in the
// cell and the walkers on the street (lib/figure.js), rain over all. The paper moves with the face.
//
// World: metres, x right (the face spans -27..27), y up from the pavement. Closed-form in t.

import * as THREE from 'three';
import { createFigure } from '../../lib/figure.js';
import { hash1 } from '../../lib/random.js';
import { INK_OUT, BRUSH, TOWERS, inkLinear } from './glsl.js';
import { createRain } from './rain.js';
import { createSpeckHalo } from './speck.js';

const BAY = 3.0, FLOOR = 3.5, BAYS = 18, FLOORS = 44;
const FRAME_W = 84, FRAME_H = 42, CAM_Z = 400;
const SHAFT_X = -4.5;                    // centre of the shaft's bay (bay 7 of 18)
const CELL_AT = 0.47;                    // the cell's place across the frame
const CAM_END = 16.6;                    // camera height when the street has arrived (the pavement at 10% up)
const TOP = FLOORS * FLOOR;              // 154 m

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = BRUSH + /* glsl */ `
uniform float uCamX, uCamY, uCellY, uTime, uPx, uNear, uFar;
varying vec2 vUv;
const float BAY = ${BAY.toFixed(1)}, FLOOR = ${FLOOR.toFixed(1)}, TOP = ${TOP.toFixed(1)}, HW = ${(BAYS * BAY / 2).toFixed(1)};
const float FW = ${FRAME_W.toFixed(1)}, FH = ${FRAME_H.toFixed(1)}, SHAFT_X = ${SHAFT_X.toFixed(2)}, CAM_END = ${CAM_END.toFixed(2)};
float cityEnvelope(int layer, float x) {
  float n = 0.5 + 0.5 * snoise(vec2(x * 0.8 + float(layer) * 4.3, 6.0 + float(layer)));
  // keep the neighbours off the face's own column a little, so they read at its sides
  return (0.45 + 0.6 * n) * (layer == 0 ? 1.0 : 0.8);
}
` + TOWERS + INK_OUT + /* glsl */ `
void main() {
  vec2 w = vec2(uCamX + (vUv.x - 0.5) * FW, uCamY + (vUv.y - 0.5) * FH);     // world, metres
  float px = uPx;
  vec2 P = w / FH;                                                          // paper space: the sheet moves with the face
  float d, z = 3000.0;
  // ---- the sky of a rainy morning: bare paper, a faint lid high up ----
  float cl = fbm(vec2(w.x / FH * 0.7, (w.y * 0.25 + uCamY * 0.1) / FH * 1.2) + 5.0, 4);
  d = 0.025 + 0.07 * smoothstep(0.1, 0.8, cl) * smoothstep(40.0, 150.0, w.y);
  // ---- the neighbours: two planes, slipping by more slowly than the face ----
  for (int i = 0; i < 2; i++) {
    float k = i == 0 ? 0.42 : 0.68;
    float yl = w.y - (1.0 - k) * (uCamY - CAM_END);                          // lines up with the street at the end
    vec2 q = vec2(w.x / 100.0 + float(i) * 2.3 + 5.0, yl / 100.0);
    vec4 tw = towerRow(q, 91.0 + float(i) * 6.0, i, i == 0 ? 0.34 : 0.27, 0.45, i == 0 ? 1.75 : 1.3, 0.9, 0.3, 0.06, 0.8, 0.07, i == 0 ? 0.03 : 0.034, px / 100.0 * (i == 0 ? 3.0 : 2.0));
    float fd = smoothstep(0.02, 0.5, yl / 100.0 + 0.1 * fbm(vec2(q.x * 1.4, yl / 100.0 * 1.5) + float(i) * 2.0, 3));
    float tone = (i == 0 ? 0.11 : 0.2) * mix(0.3, 1.0, fd) * (0.9 + 0.2 * washBlot(q * 1.2));
    d = mix(d, tone, tw.x * fd);
    d = mix(d, tone + 0.045, tw.x * tw.z * fd * 0.6);
    d = mix(d, 0.0, tw.x * tw.y * fd * 0.5);
    if (tw.x * fd > 0.05) z = i == 0 ? 1500.0 : 1000.0;
  }
  // ---- the face ----
  float inX = cov(abs(w.x) - HW, px);
  float face = inX * cov(w.y - TOP, px) * step(0.0, w.y);
  if (face > 0.0) {
    float col = floor((w.x + HW) / BAY), row = floor(w.y / FLOOR);
    vec2 f = vec2(fract((w.x + HW) / BAY), fract(w.y / FLOOR));
    vec2 c = (f - 0.5) * vec2(BAY, FLOOR);                                    // metres from the cell's centre
    vec4 h = hash42(vec2(col, row + 3.0));
    vec4 h2 = hash42(vec2(col * 1.7 + 9.0, row * 1.3 + 5.0));
    // the wall: a wash, uneven, heavier where the rain has run under each sill
    float wall = 0.30 + 0.07 * washBlot(P * 2.2) + 0.05 * fbm(vec2(w.x * 0.05, w.y * 0.012), 3);
    float dd = wall;
    bool shaft = abs(w.x - SHAFT_X) < BAY * 0.5;
    bool lobby = w.y < FLOOR * 2.0;
    if (!shaft && !lobby) {
      // the window: its glass a tone darker, a blind half drawn in some, a lamp in a few
      float wsd = sdBox(c - vec2(0.0, 0.15), vec2(1.02, 0.98)) - 0.04;
      float win = cov(wsd, px);
      float glass = 0.52 + 0.14 * h.y;
      float blind = step(h.z, 0.4) * cov(-(c.y - 0.15) + mix(-0.5, 0.6, h.w), px);        // the upper part, paler
      float lit = step(h.x, 0.075);
      float inner = mix(glass, 0.26, blind * 0.8);
      inner = mix(inner, 0.02, lit);
      // someone standing at a lit window, now and then
      float soul = lit * step(h2.x, 0.3) * cov(length((c - vec2((h2.y - 0.5) * 0.9, -0.5)) * vec2(1.0, 0.55)) - 0.24, px);
      inner = mix(inner, 0.9, soul);
      dd = mix(dd, inner, win);
      dd = mix(dd, 0.8, cov(abs(wsd) - 0.035, px) * 0.75);                               // the frame: one line
      dd = mix(dd, 0.78, lineCov(abs(c.x), 0.022, px) * win * (1.0 - lit) * 0.7);        // the mullion
      // the sill, and the stain under it
      dd = mix(dd, 0.72, cov(sdBox(c - vec2(0.0, -0.93), vec2(1.12, 0.05)), px));
      float stain = (1.0 - smoothstep(0.0, 0.75, -0.98 - c.y)) * step(c.y, -0.98) * smoothstep(0.55, 0.9, vnoise(vec2(w.x * 2.3, row)));
      dd += 0.1 * stain;
      // an air conditioner under some windows, and its drip
      if (h2.z < 0.3) {
        vec2 ac = c - vec2(mix(-0.75, 0.75, step(0.5, h2.w)), -1.32);
        dd = mix(dd, 0.82, cov(sdBox(ac, vec2(0.36, 0.24)) - 0.02, px));
        dd = mix(dd, 0.5, lineCov(abs(ac.y), 0.02, px) * step(abs(ac.x), 0.3));
      }
    }
    // floor lines (the slab edges), drawn across every bay
    dd = mix(dd, 0.62, lineCov(min(f.y, 1.0 - f.y) * FLOOR, 0.045, px) * 0.55);
    if (lobby) {
      // the lobby: two floors of dark glass, a canopy, light at the doors
      float glassL = 0.74 + 0.08 * h.y;
      dd = mix(wall + 0.1, glassL, cov(sdBox(vec2(c.x, w.y - 3.3), vec2(1.3, 2.7)), px));
      float doors = cov(sdBox(vec2(w.x - 2.5, w.y - 1.5), vec2(3.4, 1.5)), px);
      dd = mix(dd, 0.05, doors * 0.9);
      dd = mix(dd, 0.8, doors * lineCov(abs(fract(w.x / 1.7) - 0.5) * 1.7, 0.03, px));
      dd = mix(dd, 0.93, cov(sdBox(vec2(w.x - 2.5, w.y - 3.65), vec2(6.5, 0.16)), px));  // canopy
    }
    if (shaft) {
      // the glass shaft: paler, two guide rails, a tie at every floor; the cables above the cell
      float sx = w.x - SHAFT_X;
      dd = 0.13 + 0.04 * washBlot(P * 3.0);
      dd = mix(dd, 0.8, lineCov(abs(abs(sx) - 1.36), 0.04, px));
      dd = mix(dd, 0.4, lineCov(min(f.y, 1.0 - f.y) * FLOOR, 0.03, px));
      float above = step(uCellY + FLOOR, w.y);
      dd = mix(dd, 0.7, lineCov(abs(abs(sx) - 0.28), 0.018, px) * above);
      // the cell: a lit room, reserved paper, with a floor and a roof
      vec2 cc = vec2(sx, w.y - (uCellY + FLOOR * 0.5));
      float cell = cov(sdBox(cc, vec2(1.2, FLOOR * 0.5 - 0.22)), px);
      dd = mix(dd, 0.0, cell);
      dd = mix(dd, 0.95, cov(sdBox(cc - vec2(0.0, FLOOR * 0.5 - 0.11), vec2(1.33, 0.13)), px));
      dd = mix(dd, 0.95, cov(sdBox(cc + vec2(0.0, FLOOR * 0.5 - 0.11), vec2(1.33, 0.13)), px));
      dd = mix(dd, 0.85, lineCov(abs(abs(cc.x) - 1.24), 0.035, px) * step(abs(cc.y), FLOOR * 0.5));
      // its light falls a little way up and down the shaft
      dd *= 1.0 - 0.5 * exp(-abs(cc.y) / 3.0) * (1.0 - cell) * step(abs(sx), 1.3);
    }
    // the corners of the face: a line each side, loaded
    dd = mix(dd, 0.85, lineCov(HW - abs(w.x), 0.09, px));
    d = mix(d, dd, face);
    z = mix(z, 440.0, face);
  }
  // ---- the roof: a parapet, the machine room over the shaft, a tank on legs, a mast ----
  vec2 r = vec2(w.x, w.y - TOP);
  float roof = cov(sdBox(r - vec2(0.0, 0.5), vec2(HW + 0.3, 0.5)), px);
  roof = max(roof, cov(sdBox(r - vec2(SHAFT_X, 3.6), vec2(4.4, 2.8)), px));
  roof = max(roof, cov(sdBox(r - vec2(13.0, 5.4), vec2(2.4, 1.9)) - 0.3, px));
  roof = max(roof, lineCov(abs(abs(r.x - 13.0) - 1.9), 0.12, px) * step(1.0, r.y) * step(r.y, 3.6));
  roof = max(roof, cov(sdBox(r - vec2(13.0, 7.75), vec2(1.9, 0.25)), px));
  roof = max(roof, lineCov(sdSeg(r, vec2(-17.0, 1.0), vec2(-17.0, 17.0)), 0.13 * (1.0 - 0.6 * clamp((r.y - 1.0) / 16.0, 0.0, 1.0)), px));
  roof = max(roof, lineCov(sdSeg(r, vec2(-18.2, 11.0), vec2(-15.8, 11.0)), 0.06, px));
  roof = max(roof, lineCov(sdSeg(r, vec2(-21.0, 1.0), vec2(-21.0, 5.5)), 0.07, px));
  d = mix(d, 0.88, roof);
  z = mix(z, 440.0, roof);
  // ---- the street: wet pavement, the kerb, what the lobby's light does to the puddles ----
  float ground = cov(w.y, px);
  float gd = 0.2 + 0.1 * fbm(vec2(w.x * 0.08, w.y * 0.5), 3);
  gd = mix(gd, 0.62, cov(abs(w.y + 0.07) - 0.07, px));                                   // the building's foot
  gd = mix(gd, 0.5, lineCov(abs(w.y + 2.6), 0.06, px));                                  // the kerb
  float refl = smoothstep(0.45, 0.8, vnoise(vec2(w.x * 0.5, w.y * 9.0))) * exp(min(w.y, 0.0) / 1.6);
  gd = mix(gd, 0.5, refl * 0.55 * step(HW, abs(w.x) + 0.0) );
  gd = mix(gd, 0.02, refl * 0.8 * (1.0 - smoothstep(3.0, 6.5, abs(w.x - 2.5))));        // the doors' light, in the wet
  d = mix(d, gd, ground);
  z = mix(z, 430.0, ground);
  gl_FragColor = vec4(inkOut(clamp(d, 0.0, 1.0)), 1.0);
  gl_FragDepth = depthFor(z, uNear, uFar);
}`;

/** Where the cell is: 0 at 90.0 (the top floor) .. 1 at 97.0 (the ground), at a steady 22 m/s between a short start and stop. */
function descent(u) {
  u = Math.min(1, Math.max(0, u));
  const a = 0.07, b = 0.1, v = 1 / (1 - a / 2 - b / 2);
  if (u < a) return (v * u * u) / (2 * a);
  if (u > 1 - b) return 1 - (v * (1 - u) * (1 - u)) / (2 * b);
  return v * (u - a / 2);
}

export function createFacade(ctx) {
  const group = new THREE.Group();
  group.name = 'city-facade';
  const uniforms = { uCamX: { value: 0 }, uCamY: { value: 0 }, uCellY: { value: 0 }, uTime: { value: 0 }, uPx: { value: FRAME_H / ctx.height }, uNear: { value: 10 }, uFar: { value: 4000 } };
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({ name: 'facade', uniforms, vertexShader: VERT, fragmentShader: FRAG, depthFunc: THREE.AlwaysDepth });
  const back = new THREE.Mesh(tri, mat);
  back.frustumCulled = false; back.renderOrder = -10;
  group.add(back);
  const rain = createRain(ctx);
  rain.set({ lean: -1, tone: 0.5 });
  group.add(rain.mesh);

  // the one in the cell: standing, head bowed; the speck on the left shoulder
  const rider = createFigure({ seed: 'hero' });
  rider.mesh.renderOrder = 2;
  group.add(rider.mesh);
  // the street: umbrellas going by, the way the footbridge crowd will go
  const walkers = [];
  for (let i = 0; i < 16; i++) {
    const fig = createFigure({ seed: `street-${i}` });
    fig.set({ color: inkLinear(i % 2 ? 0.97 : 0.9) });
    fig.mesh.renderOrder = 3 + (i % 2);
    group.add(fig.mesh);
    walkers.push({ fig, x0: -30 + i * 4.3 + (hash1(i, 71) - 0.5) * 2.4, z: 2.5 + (i % 2) * 1.2 + hash1(i, 72) * 0.5, foot: hash1(i, 73) < 0.5 ? 0 : 0.5, jit: (hash1(i, 74) - 0.5) * 0.1, slump: 0.45 + 0.3 * hash1(i, 75), tilt: 28 + 14 * hash1(i, 76) });
  }
  const halo = createSpeckHalo(ctx);
  group.add(halo.mesh);
  const v3 = new THREE.Vector3();
  const camX = SHAFT_X + (0.5 - CELL_AT) * FRAME_W;

  return {
    group,
    update(t, localT, shot, p, camera) {
      const tt = t - shot.start;
      const cellY = (1 - descent(tt / 7)) * (TOP - FLOOR);            // the cell's floor, m above the pavement
      const centre = cellY + FLOOR / 2;
      // the frame follows the cell until the street comes up to meet it
      const k = 9;
      const camY = (centre + CAM_END + Math.sqrt((centre - CAM_END) ** 2 + k * k)) / 2 - 2.0;
      camera.fov = (2 * Math.atan(FRAME_H / 2 / CAM_Z) * 180) / Math.PI;
      camera.near = 10; camera.far = 4000;
      camera.updateProjectionMatrix();
      camera.position.set(camX, camY, CAM_Z);
      camera.up.set(0, 1, 0);
      camera.lookAt(camX, camY, 0);
      camera.updateMatrixWorld(true);
      uniforms.uCamX.value = camX; uniforms.uCamY.value = camY; uniforms.uCellY.value = cellY; uniforms.uTime.value = t;
      uniforms.uNear.value = camera.near; uniforms.uFar.value = camera.far; uniforms.uPx.value = FRAME_H / ctx.height;
      rain.set({ rain: p.rain ?? 0.7, time: t });

      rider.mesh.position.set(SHAFT_X + 0.15, cellY + 0.24, 1);
      rider.set({ pose: { upright: 1 }, turn: 180, slump: 0.55, nod: 14, speck: 1, breath: 0 });
      rider.mesh.updateMatrixWorld(true);
      for (const w of walkers) {
        w.fig.mesh.position.set(w.x0 - 1.36 * (tt - 6.2) + 30, -1.1 - 0.5 * (w.z - 2.5), w.z);
        w.fig.set({ pose: { walk: 1 }, phase: tt + w.foot + w.jit, turn: 180, slump: w.slump, lean: 4, umbrella: 1, umbrellaTilt: w.tilt });
        w.fig.mesh.updateMatrixWorld(true);
      }
      const pool = halo.set(rider.speckWorld(camera, v3), camera, { amount: 0.4 });
      return {
        ink: { paperScroll: [0, camY / FRAME_W], mist: 0, mistRange: [460, 1600], wet: 0.7, line: 0.4, pools: [pool] },
      };
    },
    dispose() { tri.dispose(); mat.dispose(); rain.dispose(); halo.dispose(); rider.dispose(); for (const w of walkers) w.fig.dispose(); },
  };
}
