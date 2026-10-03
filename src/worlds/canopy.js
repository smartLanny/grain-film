// CANOPY (W5) — inside the crown, looking up and west into the low sun (S19).
// The same tree as the meadow's (same seed, same envelope, same place in the valley), with finer and
// more numerous leaves for the close view, under the VALLEY group's sky so that the light, the haze
// and the clouds are those of S18. Coordinates are W2's (1 unit = 100 m); the shot gives the camera
// path in metres from the base of the trunk.
//
// params: land: {...landscape state}, wind, release: [t0, t1] (tufts letting go), shafts, treeSeason,
//         focus (m), bokeh (px of blur per unit of defocus), clear (m around the lens kept free of leaves)

import * as THREE from 'three';
import { createSky, sunDirection } from '../lib/sky.js';
import { createTree, TREE_ENVELOPE, TREE_UNIT } from '../lib/tree.js';
import { SEED_SPOT } from '../lib/story.js';

async function makeLandscape(ctx) {
  try {
    const mod = await import('./valley.js');
    if (typeof mod.createLandscape === 'function') {
      const land = await mod.createLandscape(ctx, { detail: 0.4, particles: false });
      if (land && land.group && typeof land.update === 'function') return land;
    }
  } catch (err) {
    console.warn('[canopy] createLandscape unavailable, using a plain sky:', err && err.message);
  }
  const sky = createSky({ turbidity: 2.2, metersPerUnit: 100, sunSize: 0.5, stars: 0 });
  const group = new THREE.Group();
  group.add(sky.mesh);
  let L = null;
  return {
    group, fallback: true,
    update(t, s) { sky.set({ sunElevation: s.sunElevation ?? 9, sunAzimuth: s.sunAzimuth ?? 0.8, time: t }); L = sky.lighting(); },
    lighting: () => L,
    dispose() { sky.dispose(); },
  };
}

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, ctx.aspect, 0.0006, 2000);
  scene.add(camera);
  const land = await makeLandscape(ctx);
  scene.add(land.group);
  const tree = createTree({ seed: 'grain-tree', leafCount: 80000, tuftCount: 1600, tuftSize: 1.7, leafSize: 0.29, shaftCount: 70, sunWindow: [TREE_ENVELOPE.sxTop, 0.705, 0.02] });
  tree.group.position.set(...SEED_SPOT);
  tree.group.scale.setScalar(TREE_UNIT);
  scene.add(tree.group);
  const sun = new THREE.Vector3();

  return {
    scene, camera, land, tree,
    post: { bloom: 0.08, halation: 0.2 },
    update(t, localT, shot, p) {
      const state = { year: 10000, sunElevation: 8.6, sunAzimuth: 0.8, season: 0.64, cloudCover: 0.22, cloudSpeed: 1, fog: 0.22, night: 0, ...(p.land || {}) };
      land.update(t, state);
      const L = land.lighting();
      const sunDir = L.sunDir ? sun.copy(L.sunDir) : sunDirection(state.sunElevation, state.sunAzimuth, sun);
      tree.update(t, {
        growth: 1, season: p.treeSeason ?? 0.64, wind: p.wind ?? 0.7, windDir: [1, 0, 0.2],
        sunDir, sunColor: L.sunColor, ambient: L.ambient,
        ground: [L.sunColor.r * 0.03 + L.ambient.r * 0.05, L.sunColor.g * 0.035 + L.ambient.g * 0.06, L.sunColor.b * 0.012 + L.ambient.b * 0.03],
        fogColor: L.fogSunColor || L.fogColor, fogAmount: 0.0,
        shafts: p.shafts ?? 1, seedRelease: 1, release: p.release, tuftGain: p.tuftGain ?? 1,
        tuftWind: [0.5, 1.0, -0.4, 0.9],
        focus: (p.focus ?? 8) * TREE_UNIT, bokeh: p.bokeh ?? 26, clear: p.clear ?? 2.4,
      });
    },
    dispose() { land.dispose(); tree.dispose(); },
  };
}
