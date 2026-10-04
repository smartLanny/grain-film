// Stateless GPU particles: instanced camera-facing quads whose position/size/colour are computed in
// the vertex shader as a pure function of (instance id, per-instance seed, uTime). No simulation
// state, so any frame can be rendered in any order.
//
//   import { createParticles } from '../lib/particles.js';
//   const dust = createParticles({
//     count: 20000, seed: 'dust',
//     uniforms: { uWind: { value: new THREE.Vector3(1, 0, 0) } },
//     glsl: `uniform vec3 uWind;`,                 // extra declarations / helper functions
//     // Inputs: float id; vec4 seed (4 uniform randoms in [0,1)); float t (= uTime);
//     //         plus any extra instance attributes you declared (e.g. vec3 aTarget).
//     // Outputs (pre-initialised): vec3 pos (world, before modelMatrix); float size (world units,
//     //         or pixels when sizeUnits:'pixels'); vec4 color (linear rgb, a = opacity).
//     position: `
//       pos = (seed.xyz - 0.5) * 40.0 + uWind * t * (0.5 + seed.w);
//       pos = mod(pos + 20.0, 40.0) - 20.0;        // wrap in a 40-unit box
//       size = 0.04; color = vec4(1.0, 0.9, 0.7, 0.6);`,
//     blending: 'additive',
//   });
//   scene.add(dust.mesh);
//   // in update(t): dust.setTime(t);
//
// Options
//   count, seed, position (GLSL body), glsl (declarations), uniforms, attributes:
//     { aTarget: { itemSize: 3, array: Float32Array } }   // per-instance; available by name in GLSL
//   fragment: GLSL body computing `col` (vec4, premultiplied for additive) from `vec2 uv` (-1..1),
//             `vec4 vColor`, `float vFade`; default = soft round sprite.
//   blending: 'additive' | 'normal' (premultiplied), depthTest (true), depthWrite (false),
//   sizeUnits: 'world' | 'pixels', minPixelSize (1.5): particles smaller than this are drawn at this
//   size with alpha scaled down by area – removes sub-pixel shimmer/aliasing.

import * as THREE from 'three';
import { NOISE } from './glsl/noise.js';
import { createRng } from './random.js';

const DEFAULT_FRAGMENT = /* glsl */ `
  float r2 = dot(uv, uv);
  float a = exp(-r2 * 4.0) * (1.0 - smoothstep(0.8, 1.0, r2));
  col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);
`;

export function createParticles(opts) {
  const {
    count = 1000,
    seed = 1,
    position = 'pos = (seed.xyz - 0.5) * 10.0;',
    glsl = '',
    uniforms = {},
    attributes = {},
    fragment = DEFAULT_FRAGMENT,
    blending = 'additive',
    depthTest = true,
    depthWrite = false,
    sizeUnits = 'world',
    minPixelSize = 1.5,
    renderOrder = 0,
    name = 'particles',
  } = opts;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const rng = createRng(seed);
  const seeds = new Float32Array(count * 4);
  const ids = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ids[i] = i;
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = rng();
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
  let extraDecl = '';
  for (const [key, def] of Object.entries(attributes)) {
    geo.setAttribute(key, new THREE.InstancedBufferAttribute(def.array, def.itemSize));
    const type = ['float', 'float', 'vec2', 'vec3', 'vec4'][def.itemSize];
    extraDecl += `attribute ${type} ${key};\n`;
  }
  geo.instanceCount = count;

  const u = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uMinPixelSize: { value: minPixelSize },
    ...uniforms,
  };

  const vertexShader = /* glsl */ `
${NOISE}
attribute vec4 aSeed;
attribute float aId;
${extraDecl}
uniform float uTime;
uniform vec2 uResolution;
uniform float uMinPixelSize;
varying vec2 vUv;
varying vec4 vColor;
varying float vFade;
${glsl}
void main() {
  float id = aId;
  vec4 seed = aSeed;
  float t = uTime;
  vec3 pos = vec3(0.0);
  float size = 0.05;
  vec4 color = vec4(1.0);
  {
${position}
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float pxPerUnit = projectionMatrix[1][1] * 0.5 * uResolution.y / max(-mv.z, 1e-4);
  float px = ${sizeUnits === 'pixels' ? 'size' : 'size * pxPerUnit'};
  float fade = 1.0;
  if (px < uMinPixelSize) { fade = (px * px) / (uMinPixelSize * uMinPixelSize); px = uMinPixelSize; }
  float half_ = 0.5 * px / pxPerUnit;
  mv.xy += position.xy * half_;
  gl_Position = projectionMatrix * mv;
  if (mv.z > -1e-3 || color.a * fade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull
  vUv = position.xy;
  vColor = color;
  vFade = fade;
}`;

  const fragmentShader = /* glsl */ `
${NOISE}
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying float vFade;
${glsl.replace(/\battribute\b[^;]*;/g, '')}
void main() {
  vec2 uv = vUv;
  vec4 col = vec4(0.0);
  {
${fragment}
  }
  col *= vFade;
  if (col.a <= 0.0 && dot(col.rgb, col.rgb) <= 0.0) discard;
  gl_FragColor = col;
}`;

  const material = new THREE.ShaderMaterial({
    name,
    uniforms: u,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest,
    depthWrite,
    premultipliedAlpha: true,
    blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  if (blending === 'additive') {
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.name = name;
  mesh.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    u.uResolution.value.set(rt ? rt.width : renderer.domElement.width, rt ? rt.height : renderer.domElement.height);
  };

  return {
    mesh,
    material,
    geometry: geo,
    uniforms: u,
    count,
    setTime(t) { u.uTime.value = t; },
    /** Draw only the first n instances (e.g. fade a crowd in by count). */
    setCount(n) { geo.instanceCount = Math.max(0, Math.min(count, n | 0)); },
    dispose() { geo.dispose(); material.dispose(); },
  };
}
