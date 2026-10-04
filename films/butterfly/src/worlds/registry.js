// World registry: ONE LINE PER WORLD. Name -> lazy loader.
// Worlds are imported, created and warmed (shaders compiled, buffers uploaded) before their first
// shot. To add a world: create src/worlds/<name>.js exporting create(ctx), then add a line here.
// (esbuild inlines these dynamic imports into dist/film.html.)
//
// 《梦蝶》's six worlds (SCRIPT.md section 3). Each starts as a re-export of _stub.js (black), so the
// whole timeline renders from the first hour. GRAIN's worlds are not registered: valley.js (exports
// createLandscape), meadow.js and bed.js stay as libraries; ice.js, strata.js, canopy.js and
// placeholder.js are reference only.

export const WORLDS = {
  city: () => import('./city.js'),           // W1 CITY      (Group C) S01 S09 S10 S15 S17 S18 S19
  interior: () => import('./interior.js'),   // W2 INTERIOR  (Group C) S02 S04a S08 S11 S14 S16
  scale: () => import('./scale.js'),         // W3 SCALE     (Group B) S03
  grass: () => import('./grass.js'),         // W4 GRASS     (Group B) S04b S05 S06 S07 S12 S13 S21 S22
  field: () => import('./field.js'),         // W5 FIELD     (Group A) S20
  paper: () => import('./paper.js'),         // W6 PAPER     (Group A) S23 S24
};
