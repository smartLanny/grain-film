// Placeholder world: ridged-noise mountains under the physical sky, aerial perspective + valley
// fog, sun-lit dust motes, and a particle text reveal (demonstrates sampleTextPoints). It exists to
// prove the pipeline end to end and to serve as a reference implementation for new worlds.
//
// params (all optional, keyframable in the timeline):
//   sunElevation (deg), sunAzimuth (deg), turbidity, stars, milkyWay, fogDensity, dust (0..1), textReveal (0..1),
//   text (string, read once at create time from the first shot that sets it)

import * as THREE from 'three';
import { NOISE } from '../lib/glsl/noise.js';
import { SKY, FOG } from '../lib/glsl/sky.js';
import { createSky } from '../lib/sky.js';
import { createParticles } from '../lib/particles.js';
import { ridged2, fbm2 } from '../lib/noise.js';
import { sampleTextPoints, fitPointsToCount } from '../titles.js';
import { FX_LAYER } from '../post.js';
import { addDepthPrepass } from '../lib/prepass.js';

// ---- terrain height: GLSL and an exact JS mirror (keep in sync) ----
const TERRAIN_GLSL = /* glsl */ `
float terrainHeight(vec2 p, int oct) {
  vec2 q = p * 0.00055;
  float m = ridged(q, oct);
  float base = fbm(q * 0.5 + vec2(3.1, 1.7), 3);
  float mountains = pow(m, 1.6) * 1100.0 + base * 300.0 + 40.0;
  float vx = p.x + 160.0 * sin(p.y * 0.0017);
  float valley = smoothstep(120.0, 1100.0, abs(vx));
  return mix(base * 30.0 - 10.0, mountains, valley);
}`;
export function terrainHeightJS(x, z, oct = 7) {
  const qx = x * 0.00055, qy = z * 0.00055;
  const m = ridged2(qx, qy, oct);
  const base = fbm2(qx * 0.5 + 3.1, qy * 0.5 + 1.7, 3);
  const mountains = Math.pow(m, 1.6) * 1100 + base * 300 + 40;
  const vx = x + 160 * Math.sin(z * 0.0017);
  const k = Math.min(Math.max((Math.abs(vx) - 120) / (1100 - 120), 0), 1);
  const valley = k * k * (3 - 2 * k);
  const floor = base * 30 - 10;
  return floor + (mountains - floor) * valley;
}

const TERRAIN_VERT = NOISE + TERRAIN_GLSL + /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y = terrainHeight(wp.xz, 7);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const TERRAIN_FRAG = '#define SKY_STEPS 8\n' + SKY + FOG + TERRAIN_GLSL + /* glsl */ `
uniform vec3 uSunColor, uAmbient, uFogColor, uFogSunColor;
uniform float uFogDensity;
varying vec3 vWorld;

float shadowMarch(vec3 p, vec3 L) {
  float res = 1.0, t = 8.0;
  for (int i = 0; i < 14; i++) {
    vec3 q = p + L * t;
    float h = q.y - terrainHeight(q.xz, 3);
    res = min(res, 8.0 * h / t);
    t += clamp(h * 0.8, 12.0, 260.0);
    if (res < 0.0 || q.y > 1000.0) break;
  }
  return smoothstep(0.0, 1.0, res);
}
void main() {
  vec3 p = vWorld;
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  vec3 rd = -toCam / dist;
  int oct = dist < 1200.0 ? 8 : (dist < 4000.0 ? 6 : 5);
  float e = max(0.6, dist * 0.0018);
  float h0 = terrainHeight(p.xz, oct);
  float hx = terrainHeight(p.xz + vec2(e, 0.0), oct) - h0;
  float hz = terrainHeight(p.xz + vec2(0.0, e), oct) - h0;
  vec3 n = normalize(vec3(-hx, e, -hz));
  vec3 L = uSunDir;
  // materials: grass in the valley / gentle slopes, rock on steep faces, snow on high flats
  float slope = 1.0 - n.y;
  float detail = fbm(p.xz * 0.02, 4) * 0.5 + 0.5;
  vec3 rock = mix(vec3(0.20, 0.17, 0.15), vec3(0.34, 0.30, 0.26), detail);
  vec3 grass = mix(vec3(0.06, 0.075, 0.035), vec3(0.13, 0.12, 0.06), detail);
  vec3 albedo = mix(grass, rock, smoothstep(0.18, 0.42, slope + (detail - 0.5) * 0.15));
  float snow = smoothstep(560.0, 700.0, p.y + detail * 80.0) * smoothstep(0.6, 0.3, slope);
  albedo = mix(albedo, vec3(0.82, 0.84, 0.88), snow);
  float ndl = max(dot(n, L), 0.0);
  float sh = ndl > 0.0 ? shadowMarch(p + n * 2.0, L) : 0.0;
  vec3 col = albedo * (uSunColor * ndl * sh + uAmbient * (0.55 + 0.45 * n.y));
  // warm bounce from the sunlit valley
  col += albedo * uSunColor * 0.06 * saturate(-n.y * 0.5 + 0.5) * saturate(L.y * 4.0);
  // physically based aerial perspective, then valley fog
  col = aerialPerspective(col, rd, dist);
  float fog = heightFog(cameraPosition, rd, dist, uFogDensity, 0.015, 0.0);
  col = mix(col, fogInscatter(rd, L, uFogColor, uFogSunColor, 12.0), fog);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Non-uniform grid: dense near the centre, expanding to the horizon. */
function makeTerrainGeometry(segments = 1024, radius = 38000, center = [0, 900]) {
  const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const f = (u) => Math.sign(u) * radius * (0.06 * Math.abs(u) + 0.94 * Math.pow(Math.abs(u), 6));
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, f(pos.getX(i)) + center[0]);
    pos.setZ(i, f(pos.getZ(i)) + center[1]);
  }
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = radius * 2;
  return geo;
}

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, ctx.aspect, 1, 60000);
  scene.add(camera);

  const sky = createSky({ turbidity: 1.6, metersPerUnit: 2.5, sunSize: 0.5, stars: 0 });
  scene.add(sky.mesh);

  const terrainMat = new THREE.ShaderMaterial({
    name: 'placeholder-terrain',
    uniforms: {
      ...sky.uniforms,
      uSunColor: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogSunColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.002 },
    },
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
  });
  const terrain = new THREE.Mesh(makeTerrainGeometry(), terrainMat);
  terrain.frustumCulled = false;
  terrain.name = 'terrain';
  scene.add(terrain);
  addDepthPrepass(terrain); // expensive fragment shader: shade each pixel once

  // dust motes in a box that travels with the camera (wrapped), lit by forward scattering
  const dust = createParticles({
    count: 9000,
    seed: ctx.seed ^ 0xd057,
    uniforms: { uSunDir: sky.uniforms.uSunDir, uSunColor: terrainMat.uniforms.uSunColor, uDust: { value: 1 } },
    glsl: /* glsl */ `uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uDust;`,
    position: /* glsl */ `
      vec3 box = vec3(140.0, 60.0, 140.0);
      vec3 drift = vec3(1.6, 0.25, -0.8) * t + 4.0 * vec3(sin(t * 0.21 + seed.x * 40.0), sin(t * 0.17 + seed.y * 30.0), cos(t * 0.19 + seed.z * 50.0));
      vec3 local = seed.xyz * box + drift;
      vec3 c = cameraPosition;
      pos = c + mod(local - c + box * 0.5, box) - box * 0.5;
      vec3 v = normalize(pos - cameraPosition);
      float fwd = pow(max(dot(v, uSunDir), 0.0), 5.0);
      float dCam = length(pos - cameraPosition);
      size = mix(0.05, 0.16, seed.w);
      float edge = smoothstep(70.0, 45.0, dCam) * smoothstep(1.5, 6.0, dCam);
      color = vec4(uSunColor * (0.15 + 3.5 * fwd), uDust * edge * (0.25 + 0.75 * seed.w));`,
  });
  scene.add(dust.mesh);

  // particle text reveal, attached to the camera (a neutral test string unless a shot sets `text`)
  const textParam = ctx.shots.map((s) => s.params && s.params.text).find(Boolean) || 'TEST · 测试';
  const sample = sampleTextPoints(textParam, { lang: 'en', size: 140, step: 2, weight: 500, tracking: 0.12, seed: ctx.seed });
  const COUNT = 14000;
  const targets = fitPointsToCount(sample, COUNT, { scale: 0.42, seed: ctx.seed });
  const textFx = createParticles({
    count: COUNT,
    seed: ctx.seed ^ 0x7e47,
    attributes: { aTarget: { itemSize: 3, array: targets } },
    uniforms: { uReveal: { value: 0 } },
    glsl: /* glsl */ `uniform float uReveal;`,
    position: /* glsl */ `
      float delay = seed.w * 0.45;
      float k = smoothstep(delay, delay + 0.55, uReveal);
      vec3 scatter = (seed.xyz - 0.5) * vec3(9.0, 5.0, 8.0) + vec3(0.0, 0.0, -1.0);
      vec3 swirl = 0.3 * vec3(sin(t * 0.7 + seed.x * 20.0), cos(t * 0.6 + seed.y * 20.0), 0.0);
      pos = mix(scatter, aTarget, k * k * (3.0 - 2.0 * k)) + swirl * (1.0 - k) + 0.008 * vec3(sin(t * 3.0 + seed.z * 30.0), cos(t * 2.0 + seed.x * 30.0), 0.0);
      size = mix(0.026, 0.009, k);
      float twinkle = 0.75 + 0.25 * sin(t * (2.0 + seed.y * 5.0) + seed.z * 40.0);
      color = vec4(vec3(1.0, 0.84, 0.64) * (1.2 + 2.0 * k) * twinkle, smoothstep(0.0, 0.25, uReveal) * (0.35 + 0.65 * k));`,
  });
  textFx.mesh.position.set(0, -0.6, -16);
  textFx.mesh.layers.set(FX_LAYER); // stays sharp under DOF
  camera.add(textFx.mesh);

  const sunScratch = new THREE.Vector3();
  return {
    scene,
    camera,
    post: { bloom: 0.05, halation: 0.16 },
    update(t, localT, shot, p) {
      sky.set({
        sunElevation: p.sunElevation ?? 4,
        sunAzimuth: p.sunAzimuth ?? 0,
        turbidity: p.turbidity ?? 1.6,
        stars: p.stars ?? 0,
        milkyWay: p.milkyWay ?? 0,
        time: t,
      });
      const L = sky.lighting();
      terrainMat.uniforms.uSunColor.value.copy(L.sunColor);
      terrainMat.uniforms.uAmbient.value.copy(L.ambient);
      terrainMat.uniforms.uFogColor.value.copy(L.fogColor);
      terrainMat.uniforms.uFogSunColor.value.copy(L.fogSunColor);
      terrainMat.uniforms.uFogDensity.value = p.fogDensity ?? 0.00035;
      // keep the camera above ground (CPU mirror of the shader terrain)
      const ground = terrainHeightJS(camera.position.x, camera.position.z) + 12;
      if (camera.position.y < ground) { camera.position.y = ground; camera.updateMatrixWorld(); }
      dust.setTime(t);
      dust.uniforms.uDust.value = p.dust ?? 1;
      textFx.setTime(t);
      textFx.uniforms.uReveal.value = p.textReveal ?? 0;
      textFx.mesh.visible = (p.textReveal ?? 0) > 0;
      sunScratch.copy(L.sunDir);
    },
    dispose() {
      terrain.geometry.dispose();
      terrainMat.dispose();
      sky.dispose();
      dust.dispose();
      textFx.dispose();
    },
  };
}
