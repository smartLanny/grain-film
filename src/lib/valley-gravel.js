// Instanced weathered gravel for the valley foreground. The instance centres are fixed in world
// space; only their base height and eligibility follow the evolving land shader.

import * as THREE from 'three';
import { NOISE } from './glsl/noise.js';
import { FOG } from './glsl/sky.js';
import { createRng } from './random.js';

const COUNT = 3600;

function rockGeometry() {
  // One subdivision rounds the silhouette; smooth normals retain broad weathered surfaces.
  const base = new THREE.IcosahedronGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', base.getAttribute('position').clone());
  geo.setAttribute('normal', base.getAttribute('normal').clone());
  if (base.getIndex()) geo.setIndex(base.getIndex().clone());
  base.dispose();
  return geo;
}

/**
 * Create real, depth-writing weathered gravel that follows the shared valley height field.
 *
 * `landGLSL` must contain landEval(vec2,int,out vec4) and riverSD(vec2,float).
 * `lightGLSL` is the valley light uniform block (including uSnow and fog uniforms).
 */
export function createValleyGravel({ U, landGLSL = '', lightGLSL = '', seed = 1, terrainGeometry, terrainColumns }) {
  const geo = rockGeometry();
  const rng = createRng(seed);
  const centres = new Float32Array(COUNT * 3);
  const scales = new Float32Array(COUNT * 4); // xyz radii, w stable shape seed
  const triangleAB = new Float32Array(COUNT * 4);
  const triangleC = new Float32Array(COUNT * 2);
  const barycentric = new Float32Array(COUNT * 3);
  const terrainPositions = terrainGeometry.getAttribute('position');
  const rows = terrainPositions.count / terrainColumns;
  const ks = Array.from({ length: terrainColumns }, (_, i) => terrainPositions.getX(i));
  const ds = Array.from({ length: rows }, (_, i) => terrainPositions.getY(i * terrainColumns));
  const interval = (values, value) => {
    let lo = 0, hi = values.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (values[mid] <= value) lo = mid; else hi = mid; }
    return lo;
  };
  const bary = (a, b, c, x, z) => {
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    const wa = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (z - c[1])) / den;
    const wb = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (z - c[1])) / den;
    return [wa, wb, 1 - wa - wb];
  };
  const rotations = new Float32Array(COUNT * 3);
  const tints = new Float32Array(COUNT * 3);

  for (let i = 0; i < COUNT; i++) {
    let x = 0, z = 0;
    // A power-law depth distribution gives the crane's near field enough stones while retaining
    // a broad, sparse tail toward the mountain. The small exclusion protects the seed/tree landing
    // point; a separate tiny camera-centre guard avoids a rock intersecting the lens.
    do {
      const depth01 = Math.pow(rng(), 1.85);
      z = 3 - 58 * depth01;
      const halfWidth = Math.min(16, 1.55 + (3 - z) * 0.275);
      x = (rng() * 2 - 1) * halfWidth;
    } while (x * x / (0.20 * 0.20) + (z + 1.5) * (z + 1.5) / (0.30 * 0.30) < 1 || x * x + z * z < 0.15 * 0.15);

    // Match the rendered triangle, not the continuous height function between its vertices.
    const row = interval(ds, -z), d0 = ds[row], d1 = ds[row + 1];
    const kd0 = Math.hypot(Math.max(d0, 0), 2), kd1 = Math.hypot(Math.max(d1, 0), 2);
    const rowT = (-z - d0) / (d1 - d0);
    const column = interval(ks, x / (kd0 + (kd1 - kd0) * rowT));
    let a = [ks[column] * kd0, -d0], b = [ks[column + 1] * kd0, -d0];
    let c = [ks[column] * kd1, -d1];
    let weights = bary(a, b, c, x, z);
    if (weights[0] < 0) {
      a = b; b = [ks[column + 1] * kd1, -d1];
      weights = bary(a, b, c, x, z);
    }
    triangleAB.set([...a, ...b], i * 4); triangleC.set(c, i * 2); barycentric.set(weights, i * 3);
    centres[i * 3] = x;
    centres[i * 3 + 1] = 0;
    centres[i * 3 + 2] = z;

    const sizeRoll = rng();
    let radius;
    if (sizeRoll < 0.012) radius = 0.015 + 0.009 * rng(); // a few readable hero stones
    else if (sizeRoll < 0.18) radius = 0.007 + 0.007 * rng();
    else radius = 0.003 + 0.005 * Math.pow(rng(), 0.8);
    // Keep the dense near field finely grained so hero stones do not merge into boulders.
    radius *= 0.78 + 0.22 * Math.min(1, (3 - z) / 13);

    scales[i * 4] = radius * (0.82 + 0.18 * rng());
    scales[i * 4 + 1] = radius * (0.40 + 0.36 * rng());
    scales[i * 4 + 2] = radius * (0.80 + 0.20 * rng());
    scales[i * 4 + 3] = rng();

    rotations[i * 3] = (rng() - 0.5) * 0.42;
    rotations[i * 3 + 1] = rng() * Math.PI * 2;
    rotations[i * 3 + 2] = (rng() - 0.5) * 0.42;

    const value = 0.36 + 0.18 * rng();
    const warm = rng();
    tints[i * 3] = value * (0.72 + 0.18 * warm);
    tints[i * 3 + 1] = value * (0.69 + 0.14 * warm);
    tints[i * 3 + 2] = value * (0.64 + 0.12 * warm);
  }

  geo.setAttribute('aTriangleAB', new THREE.InstancedBufferAttribute(triangleAB, 4));
  geo.setAttribute('aTriangleC', new THREE.InstancedBufferAttribute(triangleC, 2));
  geo.setAttribute('aBarycentric', new THREE.InstancedBufferAttribute(barycentric, 3));
  geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centres, 3));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 4));
  geo.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotations, 3));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
  geo.instanceCount = COUNT;

  const sharedVertex = `${NOISE}\n${landGLSL}\n${lightGLSL}`;
  const vertexShader = `${sharedVertex}
attribute vec3 aCenter;
attribute vec4 aTriangleAB;
attribute vec2 aTriangleC;
attribute vec3 aBarycentric;
attribute vec4 aScale;
attribute vec3 aRotation;
attribute vec3 aTint;
varying vec3 vWorld;
varying vec3 vTint;
varying float vSeed;
varying vec3 vRockNormal;
varying vec3 vLocal;
varying float vHeight;

vec3 rockRotate(vec3 p, vec3 r) {
  float cx = cos(r.x), sx = sin(r.x), cy = cos(r.y), sy = sin(r.y), cz = cos(r.z), sz = sin(r.z);
  p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  return vec3(cz * p.x - sz * p.y, sz * p.x + cz * p.y, p.z);
}

void main() {
  vec4 infoA, infoB, infoC;
  float hA = landEval(aTriangleAB.xy, 5, infoA);
  float hB = landEval(aTriangleAB.zw, 5, infoB);
  float hC = landEval(aTriangleC, 5, infoC);
  float ground = dot(vec3(hA, hB, hC), aBarycentric);
  vec4 info = infoA * aBarycentric.x + infoB * aBarycentric.y + infoC * aBarycentric.z;
  vec2 river = riverSD(aCenter.xz, -aCenter.z);
  float ice = smoothstep(0.008, 0.035, info.y);
  float edgeJitter = 0.035 * snoise(aCenter.xz * 0.31 + aScale.w * 13.0);
  float mountain = smoothstep(0.14 + edgeJitter, 0.38 + edgeJitter, info.x);
  float channel = 1.0 - smoothstep(0.0, max(aScale.x * 1.5, 0.003), river.x);
  float water = channel * smoothstep(0.015, 0.07, river.y);
  float meadow = smoothstep(0.20, 0.96, uSnow.z);
  float rangeFade = (1.0 - smoothstep(12.5, 15.8, abs(aCenter.x)))
    * (1.0 - smoothstep(1.9, 3.0, aCenter.z))
    * smoothstep(-54.5, -48.0, aCenter.z);
  // Shrinking into the terrain keeps the mesh opaque/depth-writing while vegetation takes over.
  float vegFade = 1.0 - smoothstep(0.28 + 0.40 * aScale.w, 0.90 + 0.08 * aScale.w, meadow);
  float eligible = (1.0 - ice) * (1.0 - mountain) * (1.0 - water) * vegFade * rangeFade;

  vec3 q = position;
  float rough = 0.10 + 0.14 * snoise(q * 3.2 + vec3(aScale.w * 17.0, aScale.w * 9.0, aScale.w * 23.0));
  q *= 1.0 + rough;
  q.y *= 0.86 + 0.20 * snoise(q.yzx * 2.1 + aScale.w * 11.0);
  q *= aScale.xyz;
  q = rockRotate(q, aRotation);
  q.y += aScale.y * 0.18;

  vec3 wp = vec3(aCenter.x, ground, aCenter.z) + q * eligible;
  vWorld = wp;
  vHeight = q.y / aScale.y;
  vRockNormal = rockRotate(normalize(normal / aScale.xyz), aRotation);
  vLocal = position;
  vTint = aTint;
  vSeed = aScale.w;
  if (eligible < 0.025) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  else gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

  const fragmentShader = `${NOISE}\n${FOG}\n${lightGLSL}
varying vec3 vWorld;
varying vec3 vTint;
varying float vSeed;
varying vec3 vRockNormal;
varying vec3 vLocal;
varying float vHeight;

void main() {
  vec3 faceNormal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 n = normalize(mix(normalize(vRockNormal), faceNormal, 0.15));
  vec3 grainNormal = vec3(snoise(vLocal.yz * 24.0 + vSeed * 29.0), snoise(vLocal.xz * 21.0 + vSeed * 13.0), snoise(vLocal.xy * 27.0 + vSeed * 41.0));
  n = normalize(n + grainNormal * 0.08);
  float facet = snoise(vLocal * 9.0 + vSeed * 29.0) * 0.18;
  float strata = 0.5 + 0.5 * snoise(vLocal * vec3(2.0, 7.0, 3.0) + vSeed * 19.0);
  vec3 albedo = vTint * (0.82 + 0.23 * strata + facet);
  albedo *= 0.94 + 0.10 * snoise(vWorld * 7.0 + vSeed * 13.0);

  float ndl = max(dot(n, uKeyDir), 0.0);
  float wrap = max((dot(n, uKeyDir) + 0.35) / 1.35, 0.0);
  vec3 light = uAmbient * (0.68 + 0.32 * max(n.y, 0.0))
    + uKeyColor * (0.10 + 0.26 * wrap + 0.64 * ndl) + uBounce;
  vec3 col = albedo * light;

  // A narrow, soft contact term anchors the lowest facets without producing a broad dark decal.
  float contact = 1.0 - smoothstep(0.05, 0.65, vHeight);
  col *= 1.0 - 0.16 * contact;

  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 rd = toP / max(dist, 1e-4);
  float fog = 1.0 - exp(-dist * max(uFogA.x, 0.0001) * (0.72 + 0.28 * exp(-0.16 * max(cameraPosition.y, 0.0))));
  fog = clamp(fog, 0.0, 0.92);
  vec3 haze = fogInscatter(rd, uKeyDir, uFogColor, uFogSunColor, 8.0);
  col = mix(col, haze, fog);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

  const material = new THREE.ShaderMaterial({
    name: 'valley-gravel',
    uniforms: U,
    vertexShader,
    fragmentShader,
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'valley-gravel';
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;

  return {
    mesh,
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
