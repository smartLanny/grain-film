// The speck's pool (SCRIPT.md 3.0: "in the ink shots it carries a colour pool"): the grain of wing dust
// on the hero's left shoulder is 2 to 3 px and cannot be found in a crowd, so the blue it carries soaks
// a little way into whatever is round it, as the butterfly's blue soaked into the glass in S02. A soft
// screen-size stain of wing blue, drawn over the picture at the speck's place; the INK pass's pool at
// the same place (createSpeckHalo().pool) lets its colour through whole.
import * as THREE from 'three';
import { PALETTE, linear, SPECK } from '../../lib/story.js';

const VERT = /* glsl */ `uniform float uSize; void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`;
const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAmount;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = uAmount * exp(-r * r * 3.2) * (1.0 - smoothstep(0.8, 1.0, r));
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** createSpeckHalo(ctx) -> { mesh, set(worldPos: Vector3, camera, { r, amount }) -> ink pool, dispose() } */
export function createSpeckHalo(ctx) {
  const uniforms = { uSize: { value: 8 }, uAmount: { value: 0.5 }, uColor: { value: new THREE.Vector3(...linear(PALETTE.wingBlue)).multiplyScalar(1.3) } };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const mesh = new THREE.Points(geo, new THREE.ShaderMaterial({ name: 'speck-halo', uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false }));
  mesh.frustumCulled = false; mesh.renderOrder = 40;
  const v = new THREE.Vector3();
  return {
    mesh,
    /** Place the halo; returns the ink pool that goes with it. r = radius in frame widths (SPECK.poolR). */
    set(worldPos, camera, { r = SPECK.poolR, amount = 0.5 } = {}) {
      geo.attributes.position.setXYZ(0, worldPos.x, worldPos.y, worldPos.z);
      geo.attributes.position.needsUpdate = true;
      uniforms.uSize.value = 2 * r * 1.25 * ctx.width;
      uniforms.uAmount.value = amount;
      v.copy(worldPos).project(camera);
      return { x: v.x * 0.5 + 0.5, y: v.y * 0.5 + 0.5, r, soft: r * 0.5, amount: 1, chroma: 1, rim: 0.6 };
    },
    dispose() { geo.dispose(); mesh.material.dispose(); },
  };
}
