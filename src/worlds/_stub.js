// Black stub world: stands in for a world that has not been built yet, so the timeline is always
// complete and renderable. Each world file starts as a re-export of this and is then replaced.
import * as THREE from 'three';

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, ctx.aspect, 0.1, 100);
  return { scene, camera, update() {}, dispose() {} };
}
