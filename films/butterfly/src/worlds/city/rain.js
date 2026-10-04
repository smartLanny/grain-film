// Rain as ink strokes over a whole frame (SCRIPT.md W1): one full-screen pass of tapered strokes, 8
// degrees off vertical, three depths, closed-form in time. Drawn last, over everything, no depth.
import * as THREE from 'three';
import { BRUSH, RAIN, INK_OUT } from './glsl.js';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = BRUSH + RAIN + INK_OUT + /* glsl */ `
uniform float uRain, uTime, uPx, uAspect, uLean, uTone, uNearOnly;
varying vec2 vUv;
void main() {
  if (uRain <= 0.0) discard;
  vec2 s = vec2((vUv.x - 0.5) * uAspect, vUv.y);
  float r = rainStrokes(s, uTime, 1.0, uRain * 0.45, uLean, 3.0, uPx);
  if (uNearOnly < 0.5) r += 0.6 * rainStrokes(s, uTime, 0.5, uRain * 0.75, uLean, 1.0, uPx) + 0.8 * rainStrokes(s, uTime, 0.75, uRain * 0.6, uLean, 2.0, uPx);
  r = clamp(r, 0.0, 1.0) * 0.72;
  if (r < 0.004) discard;
  gl_FragColor = vec4(inkOut(uTone), r);
}`;

/** createRain(ctx) -> { mesh, set({ rain 0..1, time, lean (+1: drifting toward +x as it falls), tone, nearOnly }), dispose() } */
export function createRain(ctx) {
  const uniforms = { uRain: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 / ctx.height }, uAspect: { value: ctx.aspect }, uLean: { value: 1 }, uTone: { value: 0.5 }, uNearOnly: { value: 0 } };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({ name: 'city-rain', uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 50;
  return {
    mesh,
    set({ rain, time, lean, tone, nearOnly } = {}) {
      if (rain !== undefined) { uniforms.uRain.value = rain; mesh.visible = rain > 0; }
      if (time !== undefined) uniforms.uTime.value = time;
      if (lean !== undefined) uniforms.uLean.value = lean;
      if (tone !== undefined) uniforms.uTone.value = tone;
      if (nearOnly !== undefined) uniforms.uNearOnly.value = nearOnly ? 1 : 0;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
