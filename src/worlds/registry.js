// World registry: ONE LINE PER WORLD. Name -> lazy loader.
// Worlds are imported, created and warmed (shaders compiled, buffers uploaded) before their first
// shot. To add a world: create src/worlds/<name>.js exporting create(ctx), then add a line here.
// (esbuild inlines these dynamic imports into out/film.html.)

export const WORLDS = {
  ice: () => import('./ice.js'),         // W1 ICE + W6 return (S01-S05, S21, S22)
  valley: () => import('./valley.js'),   // W2 VALLEY landscape (S06, S08, S10, S11); also exports createLandscape()
  meadow: () => import('./meadow.js'),   // W2 landscape + W5 tree + seeds (S17, S18, S20)
  canopy: () => import('./canopy.js'),   // W5 inside the crown (S19)
  bed: () => import('./bed.js'),         // W3 BED (S07, S09, S12, S13, S16)
  strata: () => import('./strata.js'),   // W4 STRATA (S14, S15)
};
