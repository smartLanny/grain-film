// MEADOW (W2 + W5 + W6) — the valley at year 9,900..10,000 with the tree, the Witness and the seeds.
// Shots S17 (growth), S18 (recognition), S20 (the flight home).
//
// The landscape itself belongs to the VALLEY group (createLandscape in ./valley.js). Until that
// export exists (or if it throws) a plain stand-in is used: sky, flat meadow, and the skyline of
// valley-story.js as a hazy cut-out. Everything of ours is positioned from valley-story.js either way.
//
// params (see src/shots/tree.js; all keyframable):
//   land: { year, sunElevation, sunAzimuth, season, cloudCover, ... }  passed to the landscape
//   treeGrowth 0..1 · treeSeason (0 winter, .5 summer; may run past 1) · wind 0..1 · shafts 0..1
//   shadow 0..1 · line: [gust, done, hold, gone] film seconds (the golden ridge line of S18)
//   witness 0..1 · witnessX (m, right of the trunk) · tufts 0..1 (seeds showing on the tips)
//   release: [t0, t1] (tufts leaving the tips) · flight 0..1 (seeds around the camera, S20)
//   snow 0..1 · night 0..1 (cools the grains' light)

import * as THREE from 'three';
import { SKY } from '../lib/glsl/sky.js';
import { createSky, sunDirection } from '../lib/sky.js';
import { createParticles } from '../lib/particles.js';
import { GRAIN_FRAG } from '../lib/grains.js';
import { FX_LAYER } from '../post.js';
import { createTree, TREE_UNIT, TREE_ENVELOPE, TREE_SHADOW_GLSL, treeScreen, treeLocalAt, snowAmount } from '../lib/tree.js';
import { createRng } from '../lib/random.js';
import { SEED_SPOT, SUMMIT, RIDGE_HALF_WIDTH, PROFILE_GLSL, MASTER_HORIZON_Y, PALETTE, masterSkyline, valleyState, year as storyYear } from '../lib/valley-story.js';

const AMBER = new THREE.Color(PALETTE.amber);
const glv = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

// ---- stand-in landscape -----------------------------------------------------------------------------
function createFallbackLandscape() {
  const group = new THREE.Group();
  const sky = createSky({ turbidity: 2.4, metersPerUnit: 100, sunSize: 0.5, stars: 0 });
  group.add(sky.mesh);
  const u = {
    ...sky.uniforms,
    uSunColor: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color() },
    uPeak: { value: new THREE.Vector2(14, 0.25) },
  };
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      name: 'fallback-ground', uniforms: u,
      vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: '#define SKY_STEPS 8\n' + SKY + /* glsl */ `
        uniform vec3 uSunColor, uAmbient; varying vec3 vW;
        void main() {
          vec3 rd = normalize(vW - cameraPosition); float dist = length(vW - cameraPosition);
          float n = fbm(vW.xz * 3.0, 4) * 0.5 + 0.5;
          vec3 alb = mix(vec3(0.045, 0.06, 0.02), vec3(0.10, 0.11, 0.035), n);
          float river = smoothstep(0.35, 0.2, abs(vW.x - 1.2 - 2.5 * sin(vW.z * 0.09) - vW.z * 0.02));
          vec3 col = alb * (uSunColor * max(uSunDir.y, 0.0) + uAmbient);
          col = mix(col, skyFogColor(reflect(rd, vec3(0.0, 1.0, 0.0))) * 0.8, river);
          gl_FragColor = vec4(aerialPerspective(col, rd, dist), 1.0);
        }`,
    }));
  group.add(ground);
  const strip = new THREE.PlaneGeometry(2, 1, 400, 1);
  const mountain = new THREE.Mesh(strip, new THREE.ShaderMaterial({
    name: 'fallback-mountain', uniforms: u, side: THREE.DoubleSide,
    vertexShader: PROFILE_GLSL + /* glsl */ `
      uniform vec2 uPeak; varying vec3 vW;
      void main() {
        float uu = position.x;
        float h = ridgeProfile(uu, uPeak.x, uPeak.y) * (position.y + 0.5);
        vW = vec3(${SUMMIT[0].toFixed(2)} + (uu - 0.04) * ${RIDGE_HALF_WIDTH.toFixed(1)}, h, ${SUMMIT[2].toFixed(1)});
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: '#define SKY_STEPS 8\n' + SKY + /* glsl */ `
      uniform vec3 uSunColor, uAmbient; varying vec3 vW;
      void main() {
        vec3 rd = normalize(vW - cameraPosition); float dist = length(vW - cameraPosition);
        vec3 col = vec3(0.09, 0.085, 0.08) * (uAmbient + uSunColor * 0.15);
        gl_FragColor = vec4(aerialPerspective(col, rd, dist), 1.0);
      }`,
  }));
  mountain.frustumCulled = false;
  group.add(mountain);
  let L = null;
  return {
    group, fallback: true,
    update(t, s) {
      sky.set({ sunElevation: s.sunElevation ?? 9, sunAzimuth: s.sunAzimuth ?? 0, stars: s.starVisibility ?? 0, time: t });
      L = sky.lighting();
      u.uSunColor.value.copy(L.sunColor); u.uAmbient.value.copy(L.ambient);
      const v = valleyState(s.year ?? 10000);
      u.uPeak.value.set(v.peak, v.sharp);
    },
    groundHeight: () => 0,
    lighting: () => L,
    dispose() { sky.dispose(); ground.geometry.dispose(); ground.material.dispose(); strip.dispose(); mountain.material.dispose(); },
  };
}

const USE_VALLEY = true; // false forces the stand-in landscape (for working on the tree alone)
async function makeLandscape(ctx) {
  if (!USE_VALLEY) return createFallbackLandscape();
  try {
    const mod = await import('./valley.js');
    if (typeof mod.createLandscape === 'function') {
      const land = await mod.createLandscape(ctx, {});
      if (land && land.group && typeof land.update === 'function') return land;
    }
  } catch (err) {
    console.warn('[meadow] createLandscape unavailable, using the stand-in:', err && err.message);
  }
  return createFallbackLandscape();
}

// ---- the tree's shadow on the meadow: a draped multiply decal using the tree's analytic shadow ------
function createShadowDecal(land, treeUniforms) {
  const X0 = -3.2, X1 = 3.2, Z0 = -4.6, Z1 = 0.5, NX = 128, NZ = 110;
  const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, NX, NZ).rotateX(-Math.PI / 2).translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const pos = geo.attributes.position, hA = new Float32Array(pos.count), hB = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    hA[i] = land.groundHeight(pos.getX(i), pos.getZ(i), 9900) || 0;
    hB[i] = land.groundHeight(pos.getX(i), pos.getZ(i), 10000) || 0;
  }
  geo.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(pos.count * 2).map((_, k) => (k % 2 ? hB[k >> 1] : hA[k >> 1])), 2));
  const uniforms = {
    ...treeUniforms,
    uYearMix: { value: 1 }, uShadowTint: { value: new THREE.Color(0.4, 0.45, 0.6) }, uShadowAmt: { value: 1 },
    uWitness: { value: new THREE.Vector4(0, 0, 0, 0) },   // xz: feet (world), z: height (world units), w: on
  };
  const mat = new THREE.ShaderMaterial({
    name: 'tree-shadow-decal', uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aH; uniform float uYearMix; varying vec3 vW;
      void main() { vW = vec3(position.x, mix(aH.x, aH.y, uYearMix) + 0.0006, position.z); gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: TREE_SHADOW_GLSL + /* glsl */ `
      uniform vec3 uShadowTint; uniform float uShadowAmt; uniform vec4 uWitness; varying vec3 vW;
      void main() {
        float light = treeShadow(vW);
        if (uWitness.w > 0.0 && uSunDir.y > 0.02) {
          // the Witness: a thin capsule of shade
          vec2 d = vW.xz - uWitness.xy, l = -uSunDir.xz / uSunDir.y * uWitness.z;
          float k = clamp(dot(d, l) / max(dot(l, l), 1e-9), 0.0, 1.0);
          float dist = length(d - l * k);
          light *= 1.0 - 0.8 * uWitness.w * smoothstep(0.0034 + k * 0.004, 0.0012, dist);
        }
        float sh = (1.0 - light) * uShadowAmt;
        if (sh < 0.003) discard;
        gl_FragColor = vec4(mix(vec3(1.0), uShadowTint, sh), 1.0);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---- meadow grass: blades in the foreground of the master frame, lit from behind ---------------------
function createGrass(land, treeUniforms, seed) {
  const rng = createRng(seed), COUNT = 150000;
  const aRoot = new Float32Array(COUNT * 3), aG = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    // uniform over the picture: depth ~ 1/z, lateral ~ z
    const inv = 1 / 0.2 + (1 / 1.9 - 1 / 0.2) * Math.pow(rng(), 0.72), d = 1 / inv;
    const x = (rng() * 2 - 1) * (0.45 * d + 0.02), z = -d;
    aRoot[i * 3] = x; aRoot[i * 3 + 1] = land.groundHeight(x, z, 10000) || 0; aRoot[i * 3 + 2] = z;
    aG[i * 4] = (0.3 + 0.55 * rng() * rng() + 0.25 * rng()) * TREE_UNIT; aG[i * 4 + 1] = rng(); aG[i * 4 + 2] = rng(); aG[i * 4 + 3] = rng();
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geo.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
  geo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(aRoot, 3));
  geo.setAttribute('aG', new THREE.InstancedBufferAttribute(aG, 4));
  geo.instanceCount = COUNT;
  const uniforms = {
    ...treeUniforms,
    uGrass: { value: new THREE.Vector4(1, 0.3, 0.6, 1) },   // x: amount, y: wind, z: season, w: shadow strength
    uGSun: { value: new THREE.Color() }, uGAmb: { value: new THREE.Color() }, uGFog: { value: new THREE.Color() },
    uRes: { value: new THREE.Vector2(1920, 1080) }, uSnowG: { value: 0 },
  };
  // blended, not alpha-to-coverage: sub-pixel blades through 4 coverage samples made a screen-door stipple
  const mat = new THREE.ShaderMaterial({
    name: 'meadow-grass', uniforms, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: TREE_SHADOW_GLSL + /* glsl */ `
      attribute vec3 aRoot; attribute vec4 aG;
      uniform vec4 uGrass; uniform vec3 uGSun, uGAmb; uniform vec2 uRes; uniform float uSnowG;
      varying vec3 vCol; varying vec2 vUv; varying float vA;
      void main() {
        float y = position.y, s = uGrass.z;
        // snow settles blade by blade (uSnowG eases over a fifth of a year; see tree.js snowAmount)
        float snow = smoothstep(aG.z * 0.6, aG.z * 0.6 + 0.4, uSnowG);
        float h = aG.x * uGrass.x * mix(1.0, 0.5, snow);
        vec3 toCam = normalize(cameraPosition - aRoot);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        float a = aG.y * 6.2832;
        float t = uTreeTime;
        float gust = sin(t * 1.3 + aRoot.x * 40.0 - aRoot.z * 25.0) * 0.6 + sin(t * 2.9 + aRoot.x * 90.0 + aG.z * 6.0) * 0.4;
        vec2 bend = (vec2(cos(a), sin(a)) * 0.22 + vec2(1.0, 0.25) * uGrass.y * (0.25 + 0.3 * gust)) * h * y * y;
        vec3 p = aRoot + vec3(bend.x, h * y * (1.0 - 0.12 * y * dot(bend, bend) / max(h * h, 1e-12)), bend.y);
        // seed heads on a third of the stalks; never thinner than a pixel (alpha takes up the difference)
        float head = step(0.66, aG.w) * smoothstep(0.55, 1.0, y);
        float w = 0.00013 * (1.0 - 0.8 * y) * (1.0 + 3.0 * head * (1.0 - y) * 2.5);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float pxPerU = projectionMatrix[1][1] * 0.5 * uRes.y / max(-mv.z, 1e-4);
        float px = w * pxPerU, minPx = 1.1;
        vA = min(1.0, px / minPx) * smoothstep(0.0, 0.25, h / max(aG.x, 1e-9)) * smoothstep(1.9, 1.1, -aRoot.z);
        w = max(px, minPx) / pxPerU;
        mv.x += position.x * w;
        gl_Position = projectionMatrix * mv;
        vUv = vec2(position.x * 2.0, y);
        // light: sky from above, the low sun through the blade
        float lit = mix(1.0, treeShadow(aRoot), uGrass.w);
        float fwd = pow(max(dot(-toCam, uSunDir), 0.0), 3.0);
        float side = 0.35 + 0.65 * (1.0 - abs(dot(toCam, uSunDir)));
        vec3 green = mix(vec3(0.060, 0.105, 0.018), vec3(0.105, 0.135, 0.022), aG.z);
        vec3 straw = vec3(0.30, 0.20, 0.055);
        float dry = smoothstep(0.5, 0.78, s) * (0.25 + 0.75 * aG.w) + head * 0.8;
        vec3 alb = mix(green, straw, clamp(dry, 0.0, 1.0) * (0.3 + 0.7 * y));
        alb = mix(alb, vec3(0.75, 0.8, 0.9), snow * (0.4 + 0.6 * y));
        float sun = max(uSunDir.y, 0.0) * 0.6 + 0.25 * side + 1.5 * fwd * (0.35 + 0.65 * y);
        vCol = alb * (uGAmb * (0.3 + 0.7 * y) + uGSun * sun * lit * (0.5 + 0.5 * y));
        vCol += uGSun * lit * fwd * head * 0.12;
        if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying vec2 vUv; varying float vA;
      void main() { gl_FragColor = vec4(vCol, vA * (1.0 - smoothstep(0.6, 1.0, abs(vUv.x)))); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); uniforms.uRes.value.set(rt ? rt.width : renderer.domElement.width, rt ? rt.height : renderer.domElement.height); };
  return { mesh, uniforms, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---- the golden ridge line (S18): seeds leave the crown and settle on the year-0 skyline ------------
const LINE_Z = 15.5; // metres in front of the trunk: nearer the camera than any leaf
function createRidgeLine(tree, seed) {
  const rng = createRng(seed), env = TREE_ENVELOPE;
  const COUNT = 4200;
  // the visible ridge: from where it leaves the horizon on the left to where it returns on the right
  let sxA = 0, sxB = 1;
  for (let i = 0; i <= 4000; i++) { const sx = i / 4000; if (masterSkyline(sx, 0) > MASTER_HORIZON_Y + 0.004) { sxA = sx; break; } }
  for (let i = 4000; i >= 0; i--) { const sx = i / 4000; if (masterSkyline(sx, 0) > MASTER_HORIZON_Y + 0.004) { sxB = sx; break; } }
  const RS = 1200, cum = [0];
  for (let i = 1; i <= RS; i++) {
    const a = sxA + (sxB - sxA) * ((i - 1) / RS), b = sxA + (sxB - sxA) * (i / RS);
    cum.push(cum[i - 1] + Math.hypot((b - a) * 2.39, env.at(b) - env.at(a)));
  }
  // crown tips sorted by where they appear in the master frame (a seed leaves from near its place)
  const tips = [];
  for (let i = 0; i < tree.tips.length / 3; i++) {
    const p = [tree.tips[i * 3], tree.tips[i * 3 + 1], tree.tips[i * 3 + 2]];
    if (p[1] > 14) tips.push({ p, sx: treeScreen(p)[0] });
  }
  tips.sort((a, b) => a.sx - b.sx);
  const aSrc = new Float32Array(COUNT * 3), aDst = new Float32Array(COUNT * 3), aOrd = new Float32Array(COUNT * 2);
  for (let i = 0; i < COUNT; i++) {
    const core = i < COUNT * 0.74;
    const target = ((i % 997) / 997 + rng() * 0.01) % 1 * cum[RS];   // even coverage, shuffled order
    let k = 1; while (k < RS && cum[k] < target) k++;
    const f = (k - 1 + (target - cum[k - 1]) / Math.max(cum[k] - cum[k - 1], 1e-9)) / RS;
    const sx = sxA + (sxB - sxA) * f;
    const spread = core ? 0.0007 : 0.0045;           // picture heights: the line is ~1 px wide with a faint dust
    const g = (rng() + rng() + rng() - 1.5) / 1.5;
    const dst = treeLocalAt(sx + (rng() - 0.5) * 0.0008, env.at(sx) + g * spread, LINE_Z + rng() * 2);
    const want = Math.min(Math.max(sx, env.sxL + 0.01), env.sxR - 0.01) + (rng() - 0.5) * 0.05;
    let lo = 0, hi = tips.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tips[mid].sx < want) lo = mid; else hi = mid; }
    const src = tips[Math.min(tips.length - 1, Math.max(0, lo + Math.floor((rng() - 0.5) * 30)))].p;
    aSrc.set(src, i * 3); aDst.set(dst, i * 3);
    aOrd[i * 2] = f; aOrd[i * 2 + 1] = core ? 1 : 0;
  }
  const uniforms = {
    uLine: { value: new THREE.Vector4(1e9, 1e9, 1e9, 1e9) }, uUnit: { value: TREE_UNIT },
    uLineColor: { value: new THREE.Color(1, 0.4, 0.045) }, uLineGain: { value: 1 }, uLineWind: { value: new THREE.Vector3(1, 0.15, 0.2) },
  };
  const p = createParticles({
    name: 'ridge-line', count: COUNT, seed,
    attributes: { aSrc: { itemSize: 3, array: aSrc }, aDst: { itemSize: 3, array: aDst }, aOrd: { itemSize: 2, array: aOrd } },
    uniforms,
    glsl: /* glsl */ `uniform vec4 uLine; uniform float uUnit, uLineGain; uniform vec3 uLineColor, uLineWind;`,
    position: /* glsl */ `
      float gust = uLine.x, done = uLine.y, hold = uLine.z, gone = uLine.w, span = done - gust;
      // arrival sweeps left to right; the last seed lands on the right-hand foot of the ridge at 'done'
      float t1 = gust + span * (0.3 + 0.7 * aOrd.x * (1.0 - 0.05 * seed.x));
      float t0 = max(gust + 0.02 + 0.2 * seed.z * aOrd.x, t1 - (0.95 + 0.55 * seed.y));
      float k = clamp((t - t0) / (t1 - t0), 0.0, 1.0);
      float e = 1.0 - pow(1.0 - k, 2.7);
      float arc = 4.0 * k * (1.0 - k);
      vec3 p = mix(aSrc, aDst, e);
      vec3 q = aSrc * 0.11 + seed.xyz * 9.0 + vec3(0.0, (t - t0) * 0.35, 0.0);
      p += (vec3(0.0, 2.2 + 3.6 * seed.w, 0.0) + uLineWind * 2.4 + vec3(snoise(q), snoise(q + 17.3), snoise(q + 41.9)) * 2.6) * arc * pow(1.0 - k, 0.6);
      // at rest: a breath of movement, well under a pixel
      p += 0.018 * e * vec3(sin(t * 1.3 + seed.x * 40.0), sin(t * 1.7 + seed.y * 40.0), 0.0);
      float alpha = smoothstep(0.0, 0.12, k);
      // dispersal: the wind takes the line apart
      float t2 = hold + seed.z * max(gone - hold - 1.05, 0.0);
      float age = t - t2;
      if (age > 0.0) {
        float ramp = age - (1.0 - exp(-age * 2.0)) / 2.0;
        vec3 r = aDst * 0.05 + seed.yzx * 7.0 + vec3(age * 0.3, 0.0, 0.0);
        p += uLineWind * (5.0 + 5.0 * seed.w) * ramp + vec3(snoise(r), snoise(r + 9.1) + 0.3, snoise(r + 23.7)) * min(age, 2.0) * 1.6;
        alpha *= 1.0 - smoothstep(0.15, 1.0, age);
      }
      pos = p;
      float big = step(0.955, seed.w) * aOrd.y;
      size = (0.15 + 0.08 * seed.y + 0.6 * big) * uUnit * mix(1.0, 0.75, 1.0 - aOrd.y);
      float landed = smoothstep(0.75, 1.0, k);
      float swell = 1.0 + 1.1 * exp(-max(t - done, 0.0) * 2.2) * step(done, t) + 0.5 * exp(-abs(t - t1) * 5.0);
      float tw = 0.78 + 0.22 * sin(t * (2.0 + 4.0 * seed.x) + seed.y * 50.0);
      float lum = mix(0.4, 1.0, landed) * swell * tw * mix(0.35, 1.0, aOrd.y) * (1.0 + 1.6 * big);
      color = vec4(mix(uLineColor, vec3(1.0, 0.86, 0.6), 0.06 + 0.3 * big) * lum * uLineGain, alpha);`,
    fragment: GRAIN_FRAG.tuft, blending: 'additive', minPixelSize: 1.7,
  });
  p.mesh.layers.set(FX_LAYER);
  p.mesh.renderOrder = 9;
  tree.group.add(p.mesh);
  return { ...p, uniforms, range: [sxA, sxB] };
}

// ---- the Witness: a cloaked figure, 1.7 m, with an amber lantern -------------------------------------
function createWitness() {
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 }, uWind: { value: 0.4 }, uSunColor: { value: new THREE.Color(1, 0.7, 0.4) }, uAmbient: { value: new THREE.Color(0.1, 0.1, 0.12) },
    uLamp: { value: 1 }, uWalk: { value: 0 }, uShow: { value: 1 },
  };
  const vert = /* glsl */ `
    varying vec2 vP; uniform vec2 uSizeM;
    void main() {
      // upright card turned toward the camera
      vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float s = length(modelMatrix[0].xyz);
      vec3 toCam = cameraPosition - base; toCam.y = 0.0; toCam = normalize(toCam);
      vec3 right = vec3(toCam.z, 0.0, -toCam.x);
      vP = vec2(position.x * uSizeM.x, position.y * uSizeM.y);
      vec3 wp = base + (right * vP.x + vec3(0.0, vP.y, 0.0)) * s;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const figure = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
    new THREE.ShaderMaterial({
      name: 'witness', uniforms: { ...uniforms, uSizeM: { value: new THREE.Vector2(1.6, 2.1) } }, vertexShader: vert,
      fragmentShader: /* glsl */ `
        uniform float uTime, uWind, uLamp, uWalk, uShow; uniform vec3 uSunColor, uAmbient; varying vec2 vP;
        float sdSeg(vec2 p, vec2 a, vec2 b, float r0, float r1) {
          vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h) - mix(r0, r1, h);
        }
        void main() {
          vec2 p = vP;
          float step_ = sin(uTime * 7.0) * uWalk;
          p.y -= 0.02 * abs(step_);
          // cloak: shoulders to hem, the lee side lifting and rippling in the wind
          float lee = smoothstep(-0.05, 0.3, p.x);
          float hem = 0.07 * uWind * lee * (1.0 - smoothstep(0.2, 1.3, p.y)) * (1.0 + sin(p.y * 9.0 - uTime * 4.2) * 0.6 + 0.4 * sin(p.y * 17.0 - uTime * 6.5));
          float d = sdSeg(p - vec2(hem, 0.0), vec2(0.0, 1.36), vec2(0.02 + 0.03 * step_, 0.06), 0.17, 0.3);
          d = min(d, sdSeg(p, vec2(0.0, 1.55), vec2(0.0, 1.57), 0.115, 0.115));          // hooded head
          d = min(d, sdSeg(p, vec2(0.0, 1.62), vec2(-0.05, 1.71), 0.07, 0.01));          // the hood's point
          d = min(d, sdSeg(p, vec2(0.13, 1.25), vec2(0.36, 0.98), 0.055, 0.04));         // arm holding the lantern out
          float aa = fwidth(d) + 1e-4;
          float a = (1.0 - smoothstep(-aa, aa, d)) * uShow;
          if (a < 0.03) discard;
          // dark wool, a rim of low sun, and the lantern's glow on the near side
          float rim = smoothstep(-0.07, 0.0, d);
          vec2 lp = p - vec2(0.38, 0.84);
          vec3 col = vec3(0.018, 0.015, 0.014) * (uAmbient * 2.0 + uSunColor * 0.25);
          col += uSunColor * 0.16 * rim * rim;
          col += ${glv(AMBER)} * uLamp * 0.5 * exp(-dot(lp, lp) * 6.0);
          gl_FragColor = vec4(col, a);
        }`,
      alphaToCoverage: true, side: THREE.DoubleSide,
    }));
  figure.frustumCulled = false;
  group.add(figure);
  // the lantern: an amber point (HDR, so it blooms), its halo, and a faint anamorphic streak
  const lamp = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      name: 'witness-lantern', uniforms: { ...uniforms, uSizeM: { value: new THREE.Vector2(3.4, 1.5) } },
      vertexShader: vert.replace('vP = vec2(position.x * uSizeM.x, position.y * uSizeM.y);', 'vP = vec2(position.x * uSizeM.x + 0.38, position.y * uSizeM.y + 0.84);'),
      fragmentShader: /* glsl */ `
        uniform float uTime, uLamp, uShow; varying vec2 vP;
        void main() {
          vec2 p = vP - vec2(0.38, 0.84);
          float fl = 0.9 + 0.07 * sin(uTime * 9.0) + 0.05 * sin(uTime * 23.0 + 1.0);
          float r2 = dot(p, p);
          float core = exp(-r2 * 900.0) * 26.0 + exp(-r2 * 60.0) * 1.1 + exp(-r2 * 6.0) * 0.12;
          float streak = exp(-p.y * p.y * 2600.0) * exp(-p.x * p.x * 1.4) * 0.5;
          float edge = (1.0 - smoothstep(1.2, 1.7, abs(p.x))) * (1.0 - smoothstep(0.5, 0.75, abs(p.y)));
          vec3 col = (${glv(AMBER)} * core + vec3(0.35, 0.5, 1.0) * streak) * fl * uLamp * uShow * edge;
          gl_FragColor = vec4(col, 0.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }));
  lamp.frustumCulled = false;
  lamp.renderOrder = 7;
  lamp.layers.set(FX_LAYER);
  group.add(lamp);
  return { group, uniforms, dispose() { figure.geometry.dispose(); figure.material.dispose(); lamp.geometry.dispose(); lamp.material.dispose(); } };
}

// ---- the flight home (S20, W6): seeds, snow and stars around a camera that travels with the wind -----
function createFlightGrains(seed) {
  const group = new THREE.Group();
  const uniforms = {
    uFlight: { value: new THREE.Vector4(0, 0, 0, 0) },   // x: seeds 0..1, y: snow 0..1, z: night 0..1, w: gain
    uLens: { value: new THREE.Vector2(0.25, 9) },        // focus distance (units), bokeh px per unit defocus
    uSunDir: { value: new THREE.Vector3(0, 0.1, -1) }, uGlow: { value: new THREE.Color(1, 0.8, 0.5) },
    uFlightWind: { value: new THREE.Vector3(0, 0, -1) },
  };
  const glsl = /* glsl */ `
    uniform vec4 uFlight; uniform vec2 uLens; uniform vec3 uSunDir, uGlow, uFlightWind;
    // a grain's place in a box that travels with the camera (the camera rides the same wind)
    vec3 flightPos(vec4 seed, float t, vec3 box, vec3 vel, float wander) {
      vec3 q = seed.xyz * 13.0 + vec3(0.0, t * 0.07, t * 0.05);
      vec3 w = vec3(snoise(q), snoise(q + 19.1), snoise(q + 47.3)) * wander;
      vec3 local = seed.xyz * box + vel * t * (0.6 + 0.8 * seed.w) + w;
      return cameraPosition + mod(local + box * 0.5, box) - box * 0.5;
    }`;
  const lens = /* glsl */ `
      float d = length(pos - cameraPosition);
      float coc = uLens.y * abs(d - uLens.x) / max(d, 1e-3);
      float pxPerU = projectionMatrix[1][1] * 0.5 * uResolution.y / max(d, 1e-4);
      float cocU = coc * (uResolution.y / 1080.0) / pxPerU;
      float blur = smoothstep(2.5, 8.0, coc);
      float nearFade = smoothstep(0.004, 0.03, d);`;
  const mk = (name, count, soft, body, frag) => {
    const p = createParticles({ name, count, seed: seed + name.replace('-bokeh', ''), uniforms, glsl, position: body(soft), fragment: frag, blending: 'additive', minPixelSize: 1.5 });
    p.mesh.layers.set(FX_LAYER); p.mesh.renderOrder = 9; group.add(p.mesh);
    return p;
  };
  // seed tufts: warm, amber-cored, turning slowly on the wind
  const seedBody = (soft) => /* glsl */ `
      pos = flightPos(seed, t, vec3(1.3, 0.8, 1.7), vec3(0.004, 0.003, -0.012), 0.05);
      ${lens}
      float tw = 0.75 + 0.25 * sin(t * (1.0 + 2.0 * seed.x) + seed.y * 40.0);
      vec3 v = (pos - cameraPosition) / max(d, 1e-5);
      float lit = mix(0.5 + 2.2 * pow(max(dot(v, uSunDir), 0.0), 4.0), 1.0, uFlight.z);
      vec3 warm = mix(vec3(1.0, 0.957, 0.863), ${glv(AMBER)}, 0.45 + 0.4 * seed.z);
      float show = step(seed.w, uFlight.x) * nearFade;
      ${soft
    ? `size = max(cocU * 2.0, 0.0012);
         float area = max(coc * coc, 9.0) / 9.0;
         color = vec4(warm * uGlow * lit * tw * uFlight.w * 0.55 / pow(area, 0.6), show * blur);`
    : `size = (0.0022 + 0.0016 * seed.y) * 1.6;
         color = vec4(warm * uGlow * lit * tw * uFlight.w * 1.5, show * (1.0 - blur));`}`;
  // snow: cool, small, falling through the seeds
  const snowBody = (soft) => /* glsl */ `
      pos = flightPos(seed, t, vec3(1.1, 0.9, 1.3), vec3(0.006, -0.016, 0.004), 0.035);
      ${lens}
      float show = step(seed.w, uFlight.y) * nearFade;
      vec3 cool = vec3(0.80, 0.88, 1.0) * (0.55 + 0.45 * seed.x);
      ${soft
    ? `size = max(cocU * 2.0, 0.0009);
         float area = max(coc * coc, 9.0) / 9.0;
         color = vec4(cool * uFlight.w * 0.34 / pow(area, 0.62), show * blur);`
    : `size = 0.0011 + 0.0011 * seed.y;
         color = vec4(cool * uFlight.w * 0.6, show * (1.0 - blur));`}`;
  const parts = [
    mk('flight-seeds', 6000, false, seedBody, GRAIN_FRAG.tuft), mk('flight-seeds-bokeh', 6000, true, seedBody, GRAIN_FRAG.bubble),
    mk('flight-snow', 30000, false, snowBody, GRAIN_FRAG.snow), mk('flight-snow-bokeh', 30000, true, snowBody, GRAIN_FRAG.bubble),
  ];
  return {
    group, uniforms,
    setTime(t) { for (const p of parts) p.setTime(t); },
    dispose() { for (const p of parts) p.dispose(); },
  };
}

// =======================================================================================================
export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26.68, ctx.aspect, 0.005, 2000);
  scene.add(camera);

  const land = await makeLandscape(ctx);
  scene.add(land.group);
  console.info(`[meadow] landscape: ${land.fallback ? 'stand-in' : 'valley.createLandscape'}`);

  // where the resting sun of S18 looks through the crown: just under the old summit
  const SUN_REST = { sx: TREE_ENVELOPE.sxTop, sy: 0.705 };
  const tree = createTree({ seed: 'grain-tree', leafCount: 100000, leafSize: 0.35, sunWindow: [SUN_REST.sx, SUN_REST.sy, 0.02] });
  tree.group.position.set(...SEED_SPOT);
  tree.group.scale.setScalar(TREE_UNIT);
  scene.add(tree.group);

  const decal = createShadowDecal(land, tree.uniforms);
  scene.add(decal.mesh);
  const grass = createGrass(land, tree.uniforms, 'meadow-grass');
  scene.add(grass.mesh);
  const line = createRidgeLine(tree, 'ridge-line');
  const witness = createWitness();
  witness.group.scale.setScalar(TREE_UNIT);
  scene.add(witness.group);
  const flight = createFlightGrains('flight');
  scene.add(flight.group);

  const sun = new THREE.Vector3(), tmpC = new THREE.Color();
  const lightOf = (state) => {
    const L = (land.lighting && land.lighting()) || {};
    const sunDir = L.sunDir ? sun.copy(L.sunDir) : sunDirection(state.sunElevation, state.sunAzimuth, sun);
    return {
      sunDir,
      sunColor: L.sunColor || tmpC.setRGB(1, 0.8, 0.6),
      ambient: L.ambient || new THREE.Color(0.2, 0.25, 0.35),
      fogSun: L.fogSunColor || L.fogColor || new THREE.Color(0.5, 0.4, 0.3),
    };
  };

  return {
    scene, camera, land, tree,
    post: { bloom: 0.06, halation: 0.16 },
    /** Master-frame picture coordinates of the resting sun -> [elevation, azimuth] in degrees. */
    sunRest: SUN_REST,
    update(t, localT, shot, p) {
      const yr = (p.land && p.land.year) ?? storyYear(t);
      const state = {
        year: yr, sunElevation: 9, sunAzimuth: 0.8, season: 0.6, cloudCover: 0.2, cloudSpeed: 1, fog: 0.3,
        night: 0, moonElevation: 25, starVisibility: 0, ...(p.land || {}),
      };
      land.update(t, state);
      const L = lightOf(state);
      const night = p.night ?? state.night ?? 0;
      const wind = p.wind ?? 0.3;

      tree.update(t, {
        growth: p.treeGrowth ?? 1, season: p.treeSeason ?? 0.64, wind, windDir: [1, 0, 0.2],
        sunDir: L.sunDir, sunColor: L.sunColor, ambient: L.ambient,
        ground: [L.sunColor.r * 0.03 + L.ambient.r * 0.05, L.sunColor.g * 0.035 + L.ambient.g * 0.06, L.sunColor.b * 0.012 + L.ambient.b * 0.03],
        fogColor: L.fogSun, fogAmount: p.treeHaze ?? 0.006,
        shafts: p.shafts ?? 0, seedRelease: p.tufts ?? 0, release: p.release, tuftGain: p.tuftGain ?? 0.45,
        tuftWind: [1, 0.25, 0.2, 2.6], loose: p.treeLoose ?? 0,
      });

      // shadow on the meadow: what is left in the shade is the sky's light
      const sinEl = Math.max(L.sunDir.y, 0.02);
      const share = (a, s) => a / (a + s * (sinEl * 0.6 + 0.25) * 1.6 + 1e-5);
      decal.uniforms.uShadowTint.value.setRGB(share(L.ambient.r, L.sunColor.r), share(L.ambient.g, L.sunColor.g), share(L.ambient.b, L.sunColor.b));
      decal.uniforms.uShadowAmt.value = (p.shadow ?? 1) * Math.min(1, Math.max(0, (L.sunDir.y - 0.012) / 0.05));
      decal.uniforms.uYearMix.value = Math.min(1, Math.max(0, (yr - 9900) / 100));
      decal.mesh.visible = decal.uniforms.uShadowAmt.value > 0.001;

      // grass (the master frame's foreground only)
      const gOn = p.grass ?? 0;
      grass.mesh.visible = gOn > 0.001;
      grass.uniforms.uGrass.value.set(gOn, wind, state.season - Math.floor(state.season), decal.uniforms.uShadowAmt.value);
      grass.uniforms.uGSun.value.copy(L.sunColor); grass.uniforms.uGAmb.value.copy(L.ambient);
      grass.uniforms.uSnowG.value = snowAmount(state.season);

      // the golden ridge line
      const ln = p.line;
      line.mesh.visible = !!ln && t > ln[0] && t < ln[3] + 0.5;
      if (ln) line.uniforms.uLine.value.set(ln[0], ln[1], ln[2], ln[3]);
      line.uniforms.uLineGain.value = p.lineGain ?? 1.5;
      line.setTime(t);

      // the Witness
      const wOn = p.witness ?? 0;
      witness.group.visible = wOn > 0.001;
      if (wOn > 0.001) {
        const wx = p.witnessX ?? 2.6, wz = 1.8;
        const gx = SEED_SPOT[0] + wx * TREE_UNIT, gz = SEED_SPOT[2] + wz * TREE_UNIT;
        const gy = land.groundHeight(gx, gz, 10000) || 0;   // (a fixed year: the landscape caches per year)
        witness.group.position.set(gx, gy, gz);
        const u = witness.uniforms;
        u.uTime.value = t; u.uWind.value = wind; u.uSunColor.value.copy(L.sunColor); u.uAmbient.value.copy(L.ambient);
        u.uLamp.value = p.lantern ?? 1; u.uWalk.value = p.witnessWalk ?? 0; u.uShow.value = wOn;
        decal.uniforms.uWitness.value.set(gx, gz, 1.75 * TREE_UNIT, wOn);
      } else decal.uniforms.uWitness.value.w = 0;

      // the flight home
      const fl = p.flight ?? 0, sn = p.snow ?? 0;
      flight.group.visible = fl > 0 || sn > 0;
      flight.uniforms.uFlight.value.set(fl, sn, night, p.flightGain ?? 1);
      flight.uniforms.uSunDir.value.copy(L.sunDir);
      // by day the tufts carry the sun's colour; at night their own amber
      flight.uniforms.uGlow.value.setRGB(
        THREE.MathUtils.lerp(Math.min(L.sunColor.r * 1.2 + 0.25, 3), 1.0, night),
        THREE.MathUtils.lerp(Math.min(L.sunColor.g * 1.2 + 0.2, 3), 0.86, night),
        THREE.MathUtils.lerp(Math.min(L.sunColor.b * 1.2 + 0.15, 3), 0.62, night));
      if (p.flightFocus) flight.uniforms.uLens.value.set(p.flightFocus, p.flightBokeh ?? 9);
      flight.setTime(t);
    },
    dispose() { land.dispose(); tree.dispose(); decal.dispose(); grass.dispose(); line.dispose(); witness.dispose(); flight.dispose(); },
  };
}
