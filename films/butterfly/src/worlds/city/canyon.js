// CITY set `canyon` (S19): street level, straight up. Four towers stand on the four corners of a
// crossing; between them the sky is a cross of gold, and the river of butterflies pours up through
// its centre. As it passes, the window rows flash structural colour floor by floor: windows are
// scales (THINFILM, the same function as the wing). The first free camera in the human world: a
// slow roll and a rise.
//
// World: metres, y up, the camera on the axis x = z = 0. Towers are stacks of boxes (setbacks), drawn
// with one shader in world space: the wall is a cool wash, the mullions are ink line, each pane a
// tile that can flash.

import * as THREE from 'three';
import { createFlock } from '../../lib/flock.js';
import { THINFILM } from '../../lib/thinfilm.js';
import { PALETTE, rgb } from '../../lib/story.js';
import { INK_OUT, BRUSH } from './glsl.js';

// [x0, x1, z0, z1, y0, y1] per tier; four towers, one per quadrant
const TOWERS = [
  { seed: 1, bay: 2.6, floor: 3.5, pier: 4, tiers: [[15, 90, -90, -14, 0, 118], [21, 90, -90, -21, 118, 168], [30, 80, -80, -31, 168, 204]] },      // north-east: stepped
  { seed: 2, bay: 3.4, floor: 3.9, pier: 3, tiers: [[-90, -17, -90, -16, 0, 226], [-80, -25, -80, -24, 226, 250]] },                                  // north-west: the tallest, a slab
  { seed: 3, bay: 2.9, floor: 3.3, pier: 6, tiers: [[-90, -14, 15, 90, 0, 96], [-90, -22, 23, 90, 96, 142]] },                                        // south-west: low, set back
  { seed: 4, bay: 2.3, floor: 3.7, pier: 5, tiers: [[18, 90, 13, 90, 0, 150], [25, 90, 19, 90, 150, 186]] },                                          // south-east
];
const MAX_H = 250;

const VERT = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// A tower is drawn and washed, as the face of S09 is: a pale wash laid from the top down with a loaded
// brush (heaviest at the street, running dry toward the roof, stained where the rain has run), and over
// it the ink line: the frame of every pane, broken where the brush skipped; a pier every few bays; the
// corners and the roofline. The top floors are given to the gold. The blue is only ever a passing
// angle: a band a few floors deep that climbs the faces, cyan at its front, violet behind, then ink again.
const FRAG = BRUSH + THINFILM + INK_OUT + /* glsl */ `
uniform float uSheen, uSeed, uTop, uTime, uBay, uFloor, uPier;
uniform vec3 uSunDir, uWash, uGold;
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  if (n.y > 0.5) { gl_FragColor = vec4(inkOut(0.6), 1.0); return; }          // a roof (never seen from below)
  float u = abs(n.x) > 0.5 ? vW.z : vW.x;                                    // along the face
  float h = vW.y;
  // the hand: no line is ruled; bays and floors wander a little
  float uu = u / uBay + uSeed * 13.37 + 0.08 * vnoise(vec2(h * 0.04, u * 0.11 + uSeed * 5.0));
  float hh = h / uFloor + 0.1 * vnoise(vec2(u * 0.05 + uSeed * 9.0, h * 0.13));
  float row = floor(hh), col = floor(uu);
  vec2 f = vec2(fract(uu), fract(hh));
  vec2 fw = vec2(fwidth(uu), fwidth(hh)) * 1.2;                              // a pixel, in cells
  float fwm = max(fw.x, fw.y);
  vec3 hw = hash32(vec2(col + uSeed * 71.0, row));
  // each pane has its own size, a little off its place; one in seven is left out
  vec2 lo = vec2(0.09, 0.2) + 0.06 * hw.xy, hi = vec2(0.91, 0.9) - 0.06 * hw.yz;
  float sdP = max(max(lo.x - f.x, f.x - hi.x), max(lo.y - f.y, f.y - hi.y));  // < 0 inside the pane (cells)
  float has = step(hw.z, 0.86);
  float pane = (1.0 - smoothstep(-fwm, fwm, sdP)) * has;
  float detail = 1.0 - smoothstep(0.1, 0.36, fwm);                            // cells too small to draw: one wash, not a noise of panes
  float hn = clamp(h / uTop, 0.0, 1.0);
  float sunny = smoothstep(-0.1, 0.5, dot(n, uSunDir));
  // the wash: heavy at the street, thin toward the roof; where the brush ran dry the paper shows in
  // long vertical streaks; rain has run down it; the faces that look at the sun are thinner
  float wall = mix(0.6, 0.13, smoothstep(0.0, 0.8, hn)) * mix(1.0, 0.7, sunny * smoothstep(0.1, 0.5, hn));
  float brushed = dryBrush(vec2(u + uSeed * 31.0, h) * 0.004, vec2(0.0, 1.0), mix(1.0, 0.5, smoothstep(0.1, 0.9, hn)));
  wall *= mix(0.55, 1.0, brushed);
  wall *= 0.88 + 0.24 * washBlot(vec2(u, h) * 0.02 + uSeed);
  wall += 0.07 * smoothstep(0.6, 0.95, vnoise(vec2(u * 0.8 + uSeed * 7.0, h * 0.025)));
  // panes: rooms a tone or two darker than the wall, or the sky lying in the glass, lighter
  float cloud = smoothstep(0.1, 0.55, fbm(vec2(u * 0.035 + uSeed * 3.0, h * 0.012), 3) + 0.08 * (hw.x - 0.5) * detail);
  float sky = cloud * mix(0.35, 1.0, sunny) * smoothstep(0.1, 0.6, hn);
  float glass = mix(wall + 0.06 + 0.1 * hw.y * hw.y, wall * 0.45, sky);
  float d = mix(wall, glass, pane * detail);
  d = mix(d, wall * mix(1.0, 0.6, sky), 1.0 - detail);                       // far off, the clouds still lie in the glass, as one wash
  // the ink line. Its weight is the pressure of the hand; where the brush skipped, it breaks
  float press = 0.5 + 0.5 * vnoise(vec2(col * 0.7 + uSeed, h * 0.03));
  float skip = smoothstep(0.2, 0.42, 0.5 + 0.5 * vnoise(vec2(u * 0.55 + uSeed * 3.0, h * 0.7)) + 0.35 * (press - 0.5));
  float lw = 0.028 + 0.02 * press;
  float frame = (1.0 - smoothstep(lw, lw + fwm, abs(sdP))) * has * skip;
  d = mix(d, max(d, 0.95), frame * detail * (0.55 + 0.45 * press));
  d += 0.07 * (1.0 - detail);                                                // far off the lines close up into a tone
  float pier = step(mod(col, uPier), 0.5) * (1.0 - smoothstep(0.06, 0.08 + 2.0 * fw.x, f.x));
  d = mix(d, max(d, 0.95), pier * (0.5 + 0.5 * press) * mix(0.4, 1.0, detail));
  d = mix(d, max(d, 0.92), detail * 0.7 * step(mod(row, 9.0), 0.5) * (1.0 - smoothstep(0.1, 0.18, f.y)) * skip);
  vec2 ew = fwidth(vUv) * 2.4;
  float edge = max(1.0 - smoothstep(0.0, ew.x, min(vUv.x, 1.0 - vUv.x)), 1.0 - smoothstep(0.0, ew.y, 1.0 - vUv.y));
  d = mix(d, max(d, 0.96), edge * (0.6 + 0.4 * press));
  // the top floors are gold: the wash is thinned to almost nothing and takes the light; the line stays
  float top = smoothstep(mix(0.66, 0.42, sunny), 0.94, hn + 0.05 * (hw.z - 0.5));
  float lineKeep = max(max(frame * detail, pier), edge);
  d = mix(d, d * mix(0.34, 1.0, lineKeep), top * mix(0.6, 1.0, sunny));
  vec3 hue = mix(uWash, vec3(1.0), 0.15);                                    // the cool wash under the line
  hue = mix(hue, uGold, clamp(top * 1.25 + 0.4 * sky * sunny, 0.0, 1.0));
  vec3 col3 = inkOutCol(clamp(d, 0.0, 1.0), hue);
  // ---- the windows are scales: a band of angle climbs the faces floor by floor, at one pace for the
  //      eye (its front is an elevation seen from the street). A pane turns through its lobe as the
  //      front passes: cyan, blue, violet; then it lies flat again, and is ink. The line is never lit ----
  if (uSheen > 0.0) {
    float thF = mix(0.80, 1.68, uSheen);
    float thR = atan((row + 0.5) * uFloor, 17.0);
    float x = thF - thR + 0.01 * (hw.y - 0.5);                                 // radians behind the front
    float k = smoothstep(-0.004, 0.004, x) * exp(-max(x, 0.0) / 0.03);
    if (k > 0.004) {
      vec3 hs = hash32(vec2(col * 3.7 + uSeed * 11.0, row * 1.9 + 2.0));       // no two scales lie alike
      float turn = clamp(1.0 - exp(-max(x, 0.0) / 0.03) + (hs.x - 0.5) * 0.4 * detail, 0.0, 1.0);
      vec3 tf = thinFilm(1.0 - 0.52 * turn, 1.055 - 0.06 * smoothstep(0.0, 0.02, x) + 0.05 * (hs.y - 0.5));
      float paneS = mix(0.5, pane * (1.0 - frame), detail) * mix(1.0, step(0.22, hs.z) * (0.5 + 0.5 * hs.z), detail) * (1.0 - edge) * (1.0 - pier);
      col3 = mix(col3, col3 * 0.15 + tf * 2.3, clamp(k * 1.3, 0.0, 1.0) * paneS);
    }
  }
  gl_FragColor = vec4(col3, 1.0);
}`;

const SKY_FRAG = BRUSH + INK_OUT + /* glsl */ `
uniform vec3 uGold, uSlot, uSunDir;
varying vec3 vW;
void main() {
  vec3 dir = normalize(vW);
  // a gold sky: the paper left nearly bare overhead, the wash deepening toward the low sun; long wet clouds
  vec2 q = dir.xz / max(dir.y, 0.05);
  float cl = fbm(q * vec2(1.1, 3.0) + 4.0, 4);
  float toward = dot(normalize(dir.xz + 1e-4), normalize(uSunDir.xz));
  float d = 0.02 + 0.16 * smoothstep(0.05, 0.6, cl) * smoothstep(0.05, 0.5, length(q)) + 0.13 * smoothstep(0.25, 1.3, length(q));
  vec3 hue = mix(uSlot, uGold, clamp(0.45 + 0.4 * toward * smoothstep(0.0, 0.6, length(q)) + 0.3 * cl, 0.0, 1.0));
  gl_FragColor = vec4(inkOutCol(d, hue), 1.0);
}`;
const SKY_VERT = /* glsl */ `varying vec3 vW; void main() { vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); }`;

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

export function createCanyon(ctx) {
  const group = new THREE.Group();
  group.name = 'city-canyon';
  const sunDir = new THREE.Vector3(-0.8, 0.32, 0.5).normalize();          // low in the west
  const shared = {
    uSheen: { value: 0 }, uTime: { value: 0 }, uSunDir: { value: sunDir },
    uWash: { value: new THREE.Vector3(...rgb(PALETTE.towerWash)) }, uGold: { value: new THREE.Vector3(...rgb(PALETTE.sunGold)) },
  };
  const disposables = [];
  for (const T of TOWERS) {
    const top = Math.max(...T.tiers.map((r) => r[5]));
    const mat = new THREE.ShaderMaterial({
      name: 'canyon-tower', vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...shared, uSeed: { value: T.seed }, uTop: { value: top }, uBay: { value: T.bay }, uFloor: { value: T.floor }, uPier: { value: T.pier } },
    });
    disposables.push(mat);
    for (const [x0, x1, z0, z1, y0, y1] of T.tiers) {
      const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      const m = new THREE.Mesh(geo, mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      group.add(m);
      disposables.push(geo);
    }
  }
  // sky
  const skyGeo = new THREE.SphereGeometry(3000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    name: 'canyon-sky', vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { uGold: shared.uGold, uSlot: { value: new THREE.Vector3(...rgb(PALETTE.skySlot)) }, uSunDir: shared.uSunDir },
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1;
  group.add(sky);
  disposables.push(skyGeo, skyMat);

  // the river of butterflies: LOOK's flock, all airborne, flowing straight up the axis
  // From below a wing in flight is its own membrane with the low sun coming through it: blue against
  // the gold, ink where it turns edge-on (lib/flock.js). One flock, one river.
  const flock = createFlock({ count: 4200, seed: 'canyon' });
  flock.mesh.renderOrder = 3;
  group.add(flock.mesh);

  return {
    group,
    update(t, localT, shot, p, camera) {
      const u = Math.min(1, Math.max(0, localT));
      // street level, straight up; a 6 m rise and a 20 degree roll, both eased
      const e = smooth(u);
      const y = 1.6 + 6 * e;
      const roll = ((p.roll0 ?? -13) + (p.rollBy ?? 20) * e) * Math.PI / 180;
      camera.fov = p.fov ?? 38.1;                                   // an 18 mm lens across the 2:1 frame
      camera.near = 0.3; camera.far = 4000;
      camera.updateProjectionMatrix();
      camera.position.set(0.6 * Math.sin(u * 2.1), y, 0.5 * Math.sin(u * 1.3 + 1.0));
      camera.up.set(Math.sin(roll), 0, -Math.cos(roll));
      camera.lookAt(camera.position.x, y + 100, camera.position.z);
      camera.updateMatrixWorld(true);

      shared.uSheen.value = p.windowSheen ?? 0;
      shared.uTime.value = t;
      // The river pours up the street beside the lens, not through it: seen from below it is a stream
      // that comes in at the edge of the frame and narrows to the zenith, every wing whole and at arm's
      // length or more (a wing that crosses the frame in two frames is a smear; one that is half faded at
      // the lens is a stain). The first second carries S18's storm across the cut: the stream is wide
      // enough to stand in, then gathers itself.
      const open = smooth((t - 170.0) / 1.8);
      const rx = -5.2 - 2.3 * open, rz = 1.2;                        // at the cut it runs close by the lens; then it stands off
      flock.set({
        morphWave: null,
        river: { from: [rx, -30, rz], to: [rx * 0.35, 330, rz * 0.35], width: p.riverWidth ?? 3.6, height: [-4.5, 4.5], speed: p.riverSpeed ?? 6, taper: 0 },
        scale: p.wingScale ?? 10, clear: 1.2 + 1.3 * open, minPx: 2, smear: 1 / 240,
        sun: [sunDir.x, sunDir.y, sunDir.z], sunColor: [1.5, 1.15, 0.7], ambient: [0.3, 0.31, 0.34], sheen: 1,
      });
      flock.update(t);
      return {
        dof: { focus: 60, aperture: 0.02, maxBlur: 14 },             // gentle: the near wings stay wings, in layers
        // ink line over colour wash: the towers carry their own drawn line; the pass adds its contour
        // (line, wet and dry come from the shot: MERGED_INK, shared by S19 to S22). The line is only drawn
        // where the picture is crisp, which the pass judges from this dof.
        ink: { paperScroll: [0, 0], mist: 0.25, mistRange: [120, 330] },
      };
    },
    dispose() { for (const d of disposables) d.dispose(); flock.dispose(); },
  };
}
