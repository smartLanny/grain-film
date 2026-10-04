// W1 CITY: the human world as an ink landscape (SCRIPT.md 3, W1). Owner: Group C (CITY).
// Shots S01, S09, S10, S15, S17, S18, S19 (src/shots/city.js); S01 is also the image in S07's dew drop.
//
// Five sets from one generator (city/glsl.js TOWERS), one visible at a time, chosen by params.set:
//   scroll      city/scroll.js      the night panorama as a handscroll (S01), the bridge by day (S15)
//   facade      city/facade.js      one tower face unrolled as a hanging scroll; the elevator (S09)
//   footbridge  city/footbridge.js  sixty umbrellas bowed into the rain (S10)
//   crossing    city/crossing.js    the scramble crossing from straight above; the stop, the sun,
//                                   the ring of umbrellas opening into wings (S17, S18)
//   canyon      city/canyon.js      straight up between four tower faces; windows are scales (S19)
//
// Everything is painted as INK DENSITY and handed to the INK pass through an exactly inverted grade
// (city/glsl.js INK_OUT), so PLAIN below switches off every part of the grade that would bend the
// tones. Each set returns the ink block it needs (paperScroll, pools, mist) from its update(); the
// shot list supplies ink.amount / ink.chroma (SCRIPT.md 7.3).
//
// Pure function of t: each set's update(t, localT, shot, params, camera) sets all state from its
// arguments; nothing integrates over frames.

import * as THREE from 'three';
import { createScroll } from './city/scroll.js';
import { createFacade } from './city/facade.js';
import { createFootbridge } from './city/footbridge.js';
import { createCrossing } from './city/crossing.js';
import { createCanyon } from './city/canyon.js';

/** The grade left flat: what the sets paint is what the INK pass reads. */
const PLAIN = {
  exposure: 0, temperature: 0, tintGM: 0, tint: [1, 1, 1], lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
  contrast: 1, saturation: 1, splitAmount: 0, bloom: 0, halation: 0, vignette: 0, chromaticAberration: 0,
};

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, ctx.aspect, 1, 6000);
  const sets = {
    scroll: createScroll(ctx),
    facade: createFacade(ctx),
    footbridge: createFootbridge(ctx),
    crossing: createCrossing(ctx),
    canyon: createCanyon(ctx),
  };
  for (const s of Object.values(sets)) { s.group.visible = false; scene.add(s.group); }
  let post = { ...PLAIN };

  return {
    scene, camera,
    post: () => post,
    update(t, localT, shot, p) {
      const name = sets[p.set] ? p.set : 'scroll';
      for (const [k, s] of Object.entries(sets)) s.group.visible = k === name;
      const own = sets[name].update(t, localT, shot, p, camera) || {};
      post = { ...PLAIN, ...own };
      camera.updateMatrixWorld(true);
    },
    /** Compile every set's programs up front (only the first shot's set is visible at warm-up). */
    async warmup(renderer) {
      const vis = Object.values(sets).map((s) => s.group.visible);
      for (const s of Object.values(sets)) s.group.visible = true;
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera);
      Object.values(sets).forEach((s, i) => { s.group.visible = vis[i]; });
    },
    dispose() { for (const s of Object.values(sets)) s.dispose(); },
  };
}
