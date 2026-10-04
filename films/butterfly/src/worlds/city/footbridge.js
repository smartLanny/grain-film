// CITY set `footbridge` (S10): sixty black umbrellas cross a footbridge in the same direction, bowed
// into the rain, almost in step; traffic below as dry-brush streaks; one blue speck under one rim.
// A lateral scroll at walking pace, the hero held at 42% across; planar, the paper moving with the
// bridge.
//
// Three layers: a painted backdrop (sky, two planes of towers in the rain, the road and its traffic,
// the bridge: piers, haunched beam, deck, lamps, the far railing), the walkers (lib/figure.js,
// INTERIOR group: sixty silhouettes with their own umbrellas, one draw call each), and a painted
// overlay (the near railing, the nearest rain).
//
// World: metres, x right, y up; the road is y = 0, the deck y = DECK. The walkers go toward -x; the
// hero is at x = -SPEED (t - 98). Everything is closed-form in t.

import * as THREE from 'three';
import { createFigure } from '../../lib/figure.js';
import { DRYBRUSH_GLSL } from '../../lib/ink.js';
import { hash1 } from '../../lib/random.js';
import { INK_OUT, BRUSH, TOWERS, RAIN, inkLinear } from './glsl.js';
import { createRain } from './rain.js';
import { createSpeckHalo } from './speck.js';

const DECK = 4.9, FRAME_W = 24, FRAME_H = 12, Y0 = -0.3, CAM_Z = 400;
const SPEED = 1.36;                 // m/s: two steps a second, 0.68 m each
const HERO_AT = 0.42;               // of the frame width
const SPAN = 26;                    // pier spacing

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = BRUSH + DRYBRUSH_GLSL + /* glsl */ `
uniform float uCamX, uTime, uRain, uPx, uNear, uFar, uAspect;
varying vec2 vUv;
const float DECK = ${DECK.toFixed(2)}, FW = ${FRAME_W.toFixed(1)}, FH = ${FRAME_H.toFixed(1)}, Y0 = ${Y0.toFixed(2)}, SPAN = ${SPAN.toFixed(1)};
float cityEnvelope(int layer, float x) {
  float n = 0.5 + 0.5 * snoise(vec2(x * 0.7 + float(layer) * 5.1, 2.0 + float(layer)));
  return layer == 0 ? 0.35 + 0.75 * n : 0.3 + 0.8 * n * n;
}
` + TOWERS + RAIN + INK_OUT;

const BACK_FRAG = COMMON + /* glsl */ `
// a railing: posts every 1.5 m, a top rail and a lower one. Returns coverage.
float railing(vec2 w, float phase, float lw, float px) {
  float xi = (floor((w.x - phase) / 1.5) + 0.5) * 1.5 + phase;
  float post = lineCov(abs(w.x - xi), lw, px) * step(DECK, w.y) * step(w.y, DECK + 1.12);
  float top = lineCov(abs(w.y - (DECK + 1.12)), lw * 1.4, px);
  float mid = lineCov(abs(w.y - (DECK + 0.55)), lw * 0.8, px);
  return max(post, max(top, mid));
}
void main() {
  vec2 w = vec2(uCamX + (vUv.x - 0.5) * FW, Y0 + vUv.y * FH);          // world, metres
  float px = uPx;
  vec2 P = w / FH;                                                      // the paper lies on the bridge
  float d, z = 3000.0;
  // ---- sky: bare paper under a heavy lid ----
  float cl = fbm(vec2((uCamX * 0.2 + (w.x - uCamX)) / FH * 0.8, vUv.y * 2.0) + 2.0, 4);
  d = 0.02 + 0.2 * smoothstep(0.62, 1.05, vUv.y + 0.18 * cl) + 0.035 * smoothstep(0.2, 0.9, cl);
  // ---- two planes of towers, pale in the rain, their feet lost ----
  for (int i = 0; i < 2; i++) {
    float k = i == 0 ? 0.3 : 0.55;
    vec2 q = vec2((uCamX * k + (w.x - uCamX)) / FH + float(i) * 3.7, (w.y - 1.0) / FH);
    vec4 tw = towerRow(q, 81.0 + float(i) * 7.0, i, i == 0 ? 0.3 : 0.24, 0.5, i == 0 ? 1.5 : 1.05, 0.85, 0.35, 0.0, 0.7, 0.1, i == 0 ? 0.011 : 0.013, px / FH * (i == 0 ? 3.0 : 2.0));
    float fd = smoothstep(0.34, 0.75, vUv.y + 0.07 * fbm(vec2(q.x * 1.2, vUv.y * 2.0) + float(i) * 3.0, 3));
    float tone = (i == 0 ? 0.13 : 0.24) * mix(0.25, 1.0, fd) * (0.9 + 0.2 * washBlot(q * 1.5));
    d = mix(d, tone, tw.x * fd);
    d = mix(d, tone + 0.08, tw.x * tw.z * fd * 0.7);
    d = mix(d, 0.0, tw.x * tw.y * fd * 0.6);
    if (tw.x * fd > 0.05) z = i == 0 ? 1600.0 : 1100.0;
  }
  // ---- the road: wet, pale; traffic as dry-brush streaks with two pale lamps at the head ----
  float road = 1.0 - smoothstep(0.0, 0.5, w.y);
  d = mix(d, 0.2 + 0.08 * vnoise(vec2(w.x * 0.3, 3.0)), road * 0.8);
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float dir = l == 1 ? -1.0 : 1.0;
    float v = dir * (11.0 + 3.5 * fl);
    float sp = 21.0 + 6.0 * fl;                                         // spacing of the lots
    float xl = w.x - v * uTime + fl * 13.0;
    float k = floor(xl / sp);
    vec3 h = hash32(vec2(k, fl + 5.0));
    if (h.x < 0.8) {
      float len = mix(9.0, 17.0, h.y), yc = 0.62 + 0.5 * fl + 0.12 * h.z, hh = mix(0.3, 0.48, h.z);
      float front = (k + 0.5) * sp + (h.z - 0.5) * 8.0;                 // the car's nose, in lot coords
      float along = dir > 0.0 ? (front - xl) / len : (xl - front) / len;   // 0 at the nose .. 1 at the dry tail
      vec2 st = vec2(along, (w.y - yc) / hh);
      float c = dryBrush(st, 0.6, k * 3.1 + fl) * step(0.0, along) * step(along, 1.0);
      float tone = mix(0.72, 0.42, fl / 2.0);
      d = mix(d, tone, c * 0.92);
      // lamps: two reserved dots just ahead of the nose, and their smear on the wet road
      vec2 lp = vec2((dir > 0.0 ? front - xl : xl - front) + 0.25, w.y - (yc - 0.18 * hh));
      float lamp = cov(length(lp * vec2(1.0, 1.6)) - 0.2, px * 1.5);
      d = mix(d, 0.0, lamp);
      d *= 1.0 - 0.35 * exp(-length(lp * vec2(0.35, 1.2)) / 0.5) * step(lp.x, 0.6);
      if (c > 0.3) z = 620.0;
    }
  }
  // mist rising off the road into the bridge
  float mist = (1.0 - smoothstep(1.8, 4.2, w.y + 0.8 * fbm(vec2(w.x * 0.12, 1.0), 3))) * 0.4;
  d = mix(d, 0.04, mist * smoothstep(1.2, 2.8, w.y));
  // ---- the bridge: piers, a haunched beam, the deck (one heavy stroke), lamps, the far railing ----
  float u = fract((w.x - 7.0) / SPAN);
  float xp = (floor((w.x - 7.0) / SPAN) + 0.5) * SPAN + 7.0 - 0.5 * SPAN;   // nearest pier line (at u = 0)
  float hu = abs(2.0 * u - 1.0);                                         // 1 at a pier, 0 at mid-span
  float beamB = DECK - 0.5 - 0.3 - 1.1 * pow(hu, 2.4);
  float beam = cov(max(w.y - (DECK - 0.5), beamB - w.y), px);
  float bt = 0.74 + 0.12 * washBlot(P * 2.0);
  d = mix(d, bt * dryBrush(P, vec2(1.0, 0.0), 0.86) + 0.1, beam);
  float dp = min(fract((w.x - 7.0) / SPAN), 1.0 - fract((w.x - 7.0) / SPAN)) * SPAN;   // distance to the pier line
  float pier = cov(dp - 0.55 - 0.25 * smoothstep(DECK - 2.6, DECK - 1.4, w.y), px) * step(w.y, DECK - 1.0) * step(0.0, w.y);
  float pierTone = mix(0.38, 0.8, smoothstep(0.6, 3.6, w.y)) * (0.92 + 0.16 * washBlot(P * 3.0));
  d = mix(d, pierTone, pier * (0.55 + 0.45 * dryBrush(P, vec2(0.0, 1.0), 0.75)));
  float deck = cov(max(w.y - DECK, (DECK - 0.5) - w.y), px);
  d = mix(d, 0.95, deck);
  if (max(beam, max(pier, deck)) > 0.1) z = 440.0;
  // drips under the deck's edge
  d += 0.12 * smoothstep(0.75, 0.95, vnoise(vec2(w.x * 3.0, 1.0))) * (1.0 - smoothstep(0.0, 0.9, DECK - 0.5 - w.y)) * step(w.y, DECK - 0.5) * (1.0 - beam);
  // lamp standards: a line, an arm, a small head
  float xlmp = (floor((w.x - 20.0) / SPAN) + 0.5) * SPAN + 20.0;
  float lampC = lineCov(sdSeg(w, vec2(xlmp, DECK), vec2(xlmp, DECK + 4.3)), 0.05, px);
  lampC = max(lampC, lineCov(sdSeg(w, vec2(xlmp, DECK + 4.3), vec2(xlmp - 0.9, DECK + 4.55)), 0.035, px));
  lampC = max(lampC, cov(sdBox(w - vec2(xlmp - 1.05, DECK + 4.55), vec2(0.26, 0.06)), px));
  d = mix(d, 0.62, lampC);
  d = mix(d, 0.42, railing(w, 0.0, 0.022, px) * step(DECK, w.y));
  // ---- the far rain ----
  if (uRain > 0.0) {
    vec2 s = vec2((vUv.x - 0.5) * uAspect, vUv.y);
    float r = 0.55 * rainStrokes(s, uTime, 0.45, uRain * 0.8, -1.0, 1.0, px / FH) + 0.75 * rainStrokes(s, uTime, 0.7, uRain * 0.62, -1.0, 2.0, px / FH);
    d = mix(d, max(d, 0.3) + 0.1, clamp(r, 0.0, 1.0) * 0.7);
  }
  gl_FragColor = vec4(inkOut(clamp(d, 0.0, 1.0)), 1.0);
  gl_FragDepth = depthFor(z, uNear, uFar);
}`;

const FRONT_FRAG = COMMON + /* glsl */ `
void main() {
  vec2 w = vec2(uCamX + (vUv.x - 0.5) * FW, Y0 + vUv.y * FH);
  float px = uPx;
  // the near railing: posts, a top rail, a lower rail, the kerb of the deck
  float phase = 0.75;
  float xi = (floor((w.x - phase) / 1.5) + 0.5) * 1.5 + phase;
  float c = lineCov(abs(w.x - xi), 0.034, px) * step(DECK, w.y) * step(w.y, DECK + 1.14);
  c = max(c, lineCov(abs(w.y - (DECK + 1.14)), 0.05, px));
  c = max(c, lineCov(abs(w.y - (DECK + 0.56)), 0.026, px));
  c = max(c, cov(max(w.y - (DECK + 0.13), DECK - 0.02 - w.y), px));
  if (c < 0.01) discard;
  gl_FragColor = vec4(inkOut(0.93), c);
  gl_FragDepth = depthFor(396.0, uNear, uFar);
}`;

export function createFootbridge(ctx) {
  const group = new THREE.Group();
  group.name = 'city-footbridge';
  const uniforms = { uCamX: { value: 0 }, uTime: { value: 0 }, uRain: { value: 1 }, uPx: { value: FRAME_H / ctx.height }, uNear: { value: 10 }, uFar: { value: 4000 }, uAspect: { value: ctx.aspect } };
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const backMat = new THREE.ShaderMaterial({ name: 'footbridge-back', uniforms, vertexShader: VERT, fragmentShader: BACK_FRAG, depthFunc: THREE.AlwaysDepth });
  const back = new THREE.Mesh(tri, backMat);
  back.frustumCulled = false; back.renderOrder = -10;
  group.add(back);
  const frontMat = new THREE.ShaderMaterial({ name: 'footbridge-front', uniforms, vertexShader: VERT, fragmentShader: FRONT_FRAG, transparent: true, depthFunc: THREE.AlwaysDepth });
  const front = new THREE.Mesh(tri, frontMat);
  front.frustumCulled = false; front.renderOrder = 20;
  group.add(front);
  const rain = createRain(ctx);
  rain.set({ lean: -1, tone: 0.55, nearOnly: true });
  group.add(rain.mesh);

  // ---- the sixty: three rows, a crowd with gaps in it, the hero in the near row ----
  const walkers = [];
  const rows = [-1.0, -0.1, 0.85];
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 20; k++) {
      const i = r * 20 + k;
      const hero = r === 2 && k === 8;
      // places along the bridge: bunches and gaps (not a parade), denser around the hero
      let x = -11.2 + k * 1.42 + (hash1(i, 11) - 0.5) * 0.9 + (r === 1 ? 0.6 : 0) + 2.2 * Math.sin(k * 0.9 + r * 2.1) * 0.35 + (k > 8 ? 0.5 : -0.3);
      if (hero) x = 0;
      const fig = createFigure({ seed: hero ? 'hero' : `fb-${i}` });
      const tone = [0.8, 0.9, 0.975][r];
      fig.set({ color: inkLinear(tone) });
      fig.mesh.renderOrder = r;                       // far row first
      group.add(fig.mesh);
      walkers.push({
        fig, hero, x0: x, z: rows[r] + (hash1(i, 12) - 0.5) * 0.35,
        foot: hash1(i, 13) < 0.5 ? 0 : 0.5, jit: (hash1(i, 14) - 0.5) * 0.09,
        slump: 0.45 + 0.35 * hash1(i, 15), tilt: 30 + 16 * hash1(i, 16), lean: 3 + 4 * hash1(i, 17),
        drift: (hash1(i, 18) - 0.5) * 0.05, wob: hash1(i, 19) * 6.28,
      });
    }
  }
  const hero = walkers.find((w) => w.hero);
  // the speck's pool of blue: how the eye finds the one among sixty (REVIEW item 14)
  const halo = createSpeckHalo(ctx);
  group.add(halo.mesh);
  const v3 = new THREE.Vector3();

  return {
    group,
    update(t, localT, shot, p, camera) {
      const tt = t - shot.start;
      const heroX = -SPEED * tt;
      const camX = heroX + (0.5 - HERO_AT) * FRAME_W;
      // a long lens from far off: planar
      camera.fov = (2 * Math.atan(FRAME_H / 2 / CAM_Z) * 180) / Math.PI;
      camera.near = 10; camera.far = 4000;
      camera.updateProjectionMatrix();
      camera.position.set(camX, Y0 + FRAME_H / 2, CAM_Z);
      camera.up.set(0, 1, 0);
      camera.lookAt(camX, Y0 + FRAME_H / 2, 0);
      camera.updateMatrixWorld(true);
      uniforms.uCamX.value = camX; uniforms.uTime.value = t; uniforms.uRain.value = p.rain ?? 1;
      uniforms.uNear.value = camera.near; uniforms.uFar.value = camera.far;
      uniforms.uPx.value = FRAME_H / ctx.height;
      rain.set({ rain: (p.rain ?? 1) * 0.9, time: t });

      for (const w of walkers) {
        // almost in step: one beat for everyone, a hair of each one's own
        const phase = tt * 1.0 + w.foot + w.jit;
        const x = heroX + w.x0 + w.drift * tt + 0.06 * Math.sin(tt * 0.7 + w.wob);
        w.fig.mesh.position.set(x, DECK, w.z);
        w.fig.set({
          pose: { walk: 1 }, phase, turn: 180, slump: w.slump, lean: w.lean,
          umbrella: 1, umbrellaTilt: w.tilt + 3 * Math.sin(6.283 * phase * 2 + w.wob),
          speck: w.hero ? 1 : 0,
        });
        w.fig.mesh.updateMatrixWorld(true);
      }
      const pool = halo.set(hero.fig.speckWorld(camera, v3), camera, { amount: 0.5 });
      return {
        ink: { paperScroll: [camX / FRAME_W, 0], mist: 0, mistRange: [460, 1700], wet: 0.7, line: 0.5, pools: [pool] },
      };
    },
    dispose() { tri.dispose(); backMat.dispose(); frontMat.dispose(); rain.dispose(); halo.dispose(); for (const w of walkers) w.fig.dispose(); },
  };
}
