// Camera paths and the standard camera rig driven by `shot.camera`.
//
// Shot camera spec (all fields optional; any value may be keyframed – see easing.js):
//   {
//     position: [x,y,z],                // static position, or
//     path: [[x,y,z], ...],             // centripetal Catmull-Rom through points (arc-length, so
//                                       // speed is even), travelled over the shot with `ease`
//     target: [x,y,z] | [[x,y,z],...],  // look-at point, or a look-at path (same progress)
//     rotation: [pitchX, yawY, rollZ],  // OR absolute Euler (deg, order YXZ) when there is no target
//     ease: 'inOutSine',                // easing of path progress over localT (default 'linear')
//     range: [0, 1],                    // sub-range of localT mapped onto the path (e.g. [0.1, 0.9])
//     lens: 35,                         // focal length in mm on a Super-35 gate (24.89mm wide) -> horizontal FOV
//     fov: 40,                          // OR three.js vertical FOV (deg) of the full 16:9 frame
//     roll: 0,                          // degrees
//     shake: { amp: 0.02, rot: 0.25, freq: 0.5, seed: 1 },  // deterministic handheld drift
//     near: 0.1, far: 5000,
//   }
// The rig runs BEFORE world.update(), so a world may still override the camera itself.
// Note: the 2.39 picture shows the middle 74% of the 16:9 frame height; horizontal FOV is shared.

import * as THREE from 'three';
import { ease as applyEase, evalValue, clamp } from './easing.js';
import { noise1 } from './noise.js';

/** Centripetal Catmull-Rom path through 3D points with arc-length parametrisation. */
export class CameraPath {
  /** @param {number[][]} points  @param {{alpha?: number, closed?: boolean, samples?: number}} opts */
  constructor(points, { alpha = 0.5, closed = false, samples = 256 } = {}) {
    if (points.length < 2) points = [points[0], points[0]];
    this.points = points.map((p) => new THREE.Vector3(...p));
    this.alpha = alpha;
    this.closed = closed;
    this._buildTable(samples);
  }

  /** Raw (non arc-length) position at u in [0,1]. */
  rawAt(u, out = new THREE.Vector3()) {
    const P = this.points;
    const n = this.closed ? P.length : P.length - 1;
    const x = clamp(u, 0, 1) * n;
    let i = Math.min(Math.floor(x), n - 1);
    const t = x - i;
    const get = (k) => {
      if (this.closed) return P[((k % P.length) + P.length) % P.length];
      if (k < 0) return P[0].clone().multiplyScalar(2).sub(P[1]);
      if (k >= P.length) return P[P.length - 1].clone().multiplyScalar(2).sub(P[P.length - 2]);
      return P[k];
    };
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    return catmullRom(p0, p1, p2, p3, t, this.alpha, out);
  }

  _buildTable(samples) {
    this.lut = new Float64Array(samples + 1);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.rawAt(0, a);
    let len = 0;
    for (let i = 1; i <= samples; i++) {
      this.rawAt(i / samples, b);
      len += a.distanceTo(b);
      this.lut[i] = len;
      a.copy(b);
    }
    this.length = len;
  }

  /** Position at arc-length fraction s in [0,1] (constant speed). */
  at(s, out = new THREE.Vector3()) {
    if (this.length < 1e-9) return out.copy(this.points[0]);
    const target = clamp(s, 0, 1) * this.length;
    const lut = this.lut, n = lut.length - 1;
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lut[mid] < target) lo = mid; else hi = mid;
    }
    const seg = lut[hi] - lut[lo];
    const f = seg > 0 ? (target - lut[lo]) / seg : 0;
    return this.rawAt((lo + f) / n, out);
  }

  /** Unit tangent at arc-length fraction s. */
  tangent(s, out = new THREE.Vector3()) {
    const e = 1e-3;
    const a = this.at(Math.max(0, s - e), new THREE.Vector3());
    const b = this.at(Math.min(1, s + e), new THREE.Vector3());
    return out.subVectors(b, a).normalize();
  }
}

function catmullRom(p0, p1, p2, p3, t, alpha, out) {
  const tj = (ti, a, b) => ti + Math.max(Math.pow(a.distanceToSquared(b), alpha * 0.5), 1e-6);
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerpP = (a, b, ta, tb, x, o) => o.copy(a).multiplyScalar((tb - x) / (tb - ta)).addScaledVector(b, (x - ta) / (tb - ta));
  const A1 = lerpP(p0, p1, t0, t1, tt, new THREE.Vector3());
  const A2 = lerpP(p1, p2, t1, t2, tt, new THREE.Vector3());
  const A3 = lerpP(p2, p3, t2, t3, tt, new THREE.Vector3());
  const B1 = lerpP(A1, A2, t0, t2, tt, new THREE.Vector3());
  const B2 = lerpP(A2, A3, t1, t3, tt, new THREE.Vector3());
  return lerpP(B1, B2, t1, t2, tt, out);
}

const pathCache = new WeakMap();
/** Cached CameraPath for a points array (timeline arrays are stable objects). */
export function pathFor(points) {
  let p = pathCache.get(points);
  if (!p) { p = new CameraPath(points); pathCache.set(points, p); }
  return p;
}

const isPointList = (v) => Array.isArray(v) && Array.isArray(v[0]);

/** Super-35 horizontal gate (mm). */
export const S35_WIDTH_MM = 24.89;
/** Convert a lens focal length (mm, S35) to a three.js vertical FOV for the given aspect. */
export function lensToFov(mm, aspect) {
  const hfov = 2 * Math.atan(S35_WIDTH_MM / (2 * mm));
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
}

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/**
 * Apply a shot camera spec to a PerspectiveCamera. Pure function of (spec, localT, t).
 * @returns {boolean} true if the spec contained anything the rig used
 */
export function applyCameraRig(camera, spec, localT, t, shot) {
  if (!spec) return false;
  const v = (x) => evalValue(x, localT, t, shot);
  const range = spec.range || [0, 1];
  const u = applyEase(spec.ease || 'linear', (localT - range[0]) / (range[1] - range[0]));
  let used = false;

  if (spec.path) {
    pathFor(spec.path).at(u, _p);
    camera.position.copy(_p);
    used = true;
  } else if (spec.position) {
    const p = v(spec.position);
    camera.position.set(p[0], p[1], p[2]);
    used = true;
  }

  if (spec.shake) {
    const s = spec.shake, f = s.freq ?? 0.5, seed = s.seed ?? 1, amp = s.amp ?? 0.02;
    camera.position.x += amp * noise1(t * f, seed * 3 + 0);
    camera.position.y += amp * noise1(t * f, seed * 3 + 1);
    camera.position.z += amp * noise1(t * f, seed * 3 + 2);
  }

  // Orientation must be set absolutely every frame (roll / rotational shake are relative to it),
  // otherwise state would accumulate across frames and break determinism.
  let oriented = false;
  if (spec.target) {
    if (isPointList(spec.target)) pathFor(spec.target).at(u, _t);
    else { const p = v(spec.target); _t.set(p[0], p[1], p[2]); }
    camera.up.copy(_up);
    camera.lookAt(_t);
    oriented = used = true;
  } else if (spec.rotation) {
    const r = v(spec.rotation); // degrees, Euler YXZ (yaw, pitch, roll order)
    camera.rotation.set(THREE.MathUtils.degToRad(r[0]), THREE.MathUtils.degToRad(r[1]), THREE.MathUtils.degToRad(r[2] || 0), 'YXZ');
    oriented = used = true;
  }

  if (oriented && spec.shake && (spec.shake.rot ?? 0.25) > 0) {
    const s = spec.shake, f = (s.freq ?? 0.5) * 1.3, seed = s.seed ?? 1;
    const r = THREE.MathUtils.degToRad(s.rot ?? 0.25);
    camera.rotateX(r * noise1(t * f, seed * 5 + 11));
    camera.rotateY(r * noise1(t * f, seed * 5 + 12));
  }
  if (oriented && spec.roll !== undefined) {
    camera.rotateZ(THREE.MathUtils.degToRad(v(spec.roll)));
  }

  let projDirty = false;
  if (spec.lens !== undefined) {
    const fov = lensToFov(v(spec.lens), camera.aspect);
    if (fov !== camera.fov) { camera.fov = fov; projDirty = true; }
    used = true;
  } else if (spec.fov !== undefined) {
    const fov = v(spec.fov);
    if (fov !== camera.fov) { camera.fov = fov; projDirty = true; }
    used = true;
  }
  if (spec.near !== undefined && spec.near !== camera.near) { camera.near = spec.near; projDirty = true; }
  if (spec.far !== undefined && spec.far !== camera.far) { camera.far = spec.far; projDirty = true; }
  if (projDirty) camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return used;
}
