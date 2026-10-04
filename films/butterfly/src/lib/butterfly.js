// THE BUTTERFLY (SCRIPT.md 3.0). Owner: Group B (MACRO).
// A fictional large blue, wingspan 7 cm: four wings as curved membranes with venation, scales,
// fringe and translucency; a modest dark body with fine hair, clubbed antennae, six legs, a
// coiled proboscis. Structural colour from lib/thinfilm.js (wingSheen): closed, the wings are ink;
// open, they are blue, and the blue runs cyan -> blue -> violet -> black with the angle.
//
//   import { createButterfly } from '../lib/butterfly.js';
//   const b = createButterfly({ lod: 'hero', seed: 'hero' });
//   scene.add(b.group);  b.group.scale.setScalar(0.01);           // the group is in CENTIMETRES
//   b.set({ open: story.breath(t), lightDir: [0.3, 0.8, -0.5], lightColor: [3, 2.6, 2.1] });
//   b.update(t);
//
// createButterfly({ lod: 'hero' | 'mid', seed }) -> { group, set(state), update(t), dispose() }
//   group     THREE.Group in CENTIMETRES (wingspan 7). Origin at the thorax; body along +Z (head at
//             +Z); wings along ±X; dorsal (upper) side +Y. The feet touch the plane y = FEET_Y
//             (-0.42 cm): put that plane on the glass / leaf / blade. Scale it for metres (0.01).
//   set(state)  any subset; values persist until changed:
//     open       0..1   0 = wings closed over the back (undersides out: ink grey), 1 = flat (blue up)
//     flap       null | number  wingbeat phase in cycles (e.g. t * 4 for 4 Hz on screen); when a
//                number, a ±46° stroke is added around the `open` pose, the wing tips lagging the
//                roots. null = resting
//     crumple    1..0   emergence: 1 = crumpled and small, 0 = fully expanded
//     wear       0..1   tattered fringe and rubbed scales (S21, S22)
//     notch      0 | 1  the bite out of the RIGHT hindwing (from 02:02.0, S13, on)
//     barePatch  0 | 1  the dull scale-less patch on the LEFT forewing (from S04 on)
//     proboscis  0..1   coiled -> uncoiled (S06; hero only)
//     proboscisTarget  null | [x, y, z]  optional, LOCAL space (cm, the group's own frame): where the
//                tip goes when fully uncoiled. The extended proboscis is then one smooth curve from
//                under the head to that point, leaving forward and down and bending (the "knee")
//                about a third of the way along; `proboscis` still uncoils it, base first. null (the
//                default) = the free S-curve of the original rig
//     feet       null | six [x, y, z (, nx, ny, nz)]  optional, LOCAL space: where the feet stand
//                (right front, right mid, right hind, left front, left mid, left hind) and the
//                surface normal there (default local +Y). Each leg is then solved to its foot:
//                femur, tibia and tarsus, the knee raised. null (the default) = the standing rig
//                whose feet touch the plane y = FEET_Y
//     antennaLift  radians, optional (default 0): both antennae raised from their root (a feeding butterfly
//                holds them up in a V while its head is down)
//     lightDir   [x, y, z] WORLD-space direction TO the key light
//     lightColor [r, g, b] linear radiance of the key light (sun ~[4, 3.4, 2.6], lamp ~[3, 2.4, 1.6])
//     ambient    [r, g, b] linear radiance of the fill (sky / room). Default: 0.12 x lightColor's
//                luminance, neutral. The wings answer it with thinFilm(N.V): a soft blue from most
//                angles, violet toward grazing. Set [0, 0, 0] for a wing lit by the key alone.
//     sheenFill  0..  how much of that soft fill-blue the wings return (default 1; 0 = the blue lives in
//                the key's lobe only, and outside it the open wing is ink black: S06's dark angle)
//     fill       0..  optional (default 0 = off): the meadow's own light on the structural colour, sky from
//                above and grass bounce from below (scaled by `ambient`), floored at a deep indigo-violet, so a
//                sunlit open wing never goes to flat black at the dark angle (S06's close-up)
//     lobe       optional (default 1): widens the key light's angular lobe (1.5 = rolls off more gradually)
//     dof        accepted and ignored: every part is ordinary geometry in the main pass, so the
//                shot's own depth of field (post.dof) blurs it correctly
//   update(t)   time-driven detail (antennae tremor); a pure function of t
//   dispose()
// LODs: 'hero' (S02, S04-S07, S13, S21, S22), 'mid' (S12's roost of seven: coarser mesh, 512 px
// maps, no hair cards, no proboscis). The far LOD is FLOCK's: use WING_SHAPE (below) for its
// outline and lib/thinfilm.js `thinFilm(1.0, 1.0)` for its blue; closed, PALETTE.underside.
//
// Colours (story.PALETTE): upper side wingSheen over melanin #0D0C0E, a 3 mm ink-black margin with
// three small pale marks at the forewing apex, fringe #F4F1EA; underside #8E867A drawn as brushwork
// (wash, a postdiscal brush line, veins as ink lines) with a row of seven ink dots ringed #EDE6D6
// (three on the forewing, four on the hindwing); body #2A2622.
//
// THE DARK ANGLE (for S02's match on black and S06): the blue lives in a lobe around the mirror
// direction of the key light, 11° wide along the scales and 34° across them. With the key behind
// the camera an open wing is blue; turn the wing (or close it) and it passes violet into black.

import * as THREE from 'three';
import { THINFILM } from './thinfilm.js';
import { NOISE } from './glsl/noise.js';
import { PALETTE, linear } from './story.js';
import { createRng } from './random.js';

export const FEET_Y = -0.42;

// ---- wing outlines (right side: x outward, z forward; cm) -------------------------------------------
const FORE_CTRL = [[0.16, 0.42], [0.85, 1.22], [1.85, 1.9], [2.75, 2.22], [3.28, 2.2], [3.5, 1.82], [3.44, 1.05], [3.2, 0.3], [2.86, -0.22], [1.8, -0.2], [0.8, -0.06], [0.16, 0.14]];
const HIND_CTRL = [[0.16, 0.0], [1.15, 0.28], [2.25, 0.1], [2.82, -0.42], [3.0, -1.15], [2.74, -1.95], [2.15, -2.55], [1.42, -2.82], [0.78, -2.68], [0.36, -1.9], [0.2, -0.95], [0.16, -0.32]];
const WINGS = {
  fore: {
    ctrl: FORE_CTRL, origin: [0.2, 0.28], phi: [58, -31], wedge: [96, -62], map: [-0.2, -0.9, 4.2], scallop: 0.014, yOff: 0.016,
    ends: [0.07, 0.14, 0.21, 0.30, 0.41, 0.53, 0.65, 0.78, 0.93],
    veins: [
      [[0.012, 0.02], [0.012, 1], 1.5], [[0.05, 0.02], [0.065, 0.74], 0.9],
      [[0.10, 0.02], [0.13, 0.5], 1.2], [[0.52, 0.02], [0.5, 0.46], 1.2], [[0.13, 0.5], [0.31, 0.485], 0.7], [[0.31, 0.485], [0.5, 0.46], 0.7],
      [[0.11, 0.3], [0.07, 1], 0.8], [[0.125, 0.42], [0.14, 1], 0.8], [[0.13, 0.5], [0.21, 1], 0.9], [[0.2, 0.495], [0.30, 1], 0.9],
      [[0.31, 0.485], [0.41, 1], 0.9], [[0.42, 0.47], [0.53, 1], 0.9], [[0.5, 0.46], [0.65, 1], 0.9], [[0.5, 0.3], [0.78, 1], 0.9], [[0.86, 0.04], [0.93, 1], 1.0],
    ],
    dots: [[0.175, 0.8, 0.085], [0.255, 0.8, 0.115], [0.355, 0.79, 0.095]],
    marks: [[0.105, 0.925, 0.04], [0.175, 0.93, 0.05], [0.255, 0.93, 0.04]],
  },
  hind: {
    ctrl: HIND_CTRL, origin: [0.2, -0.2], phi: [27, -91], wedge: [62, -128], map: [-0.2, -3.3, 4.2], scallop: 0.045, yOff: 0.0,
    ends: [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92],
    veins: [
      [[0.05, 0.02], [0.08, 1], 1.0], [[0.12, 0.02], [0.2, 0.42], 1.2], [[0.6, 0.02], [0.55, 0.4], 1.2], [[0.2, 0.42], [0.38, 0.41], 0.7], [[0.38, 0.41], [0.55, 0.4], 0.7],
      [[0.18, 0.35], [0.2, 1], 0.9], [[0.25, 0.42], [0.32, 1], 0.9], [[0.38, 0.41], [0.44, 1], 0.9], [[0.5, 0.4], [0.56, 1], 0.9],
      [[0.55, 0.4], [0.68, 1], 0.9], [[0.57, 0.25], [0.8, 1], 0.9], [[0.85, 0.03], [0.92, 1], 1.0],
    ],
    dots: [[0.26, 0.78, 0.105], [0.38, 0.78, 0.14], [0.5, 0.78, 0.125], [0.62, 0.78, 0.095]],
    marks: [],
  },
};
// the notch (right hindwing) and the bare patch (left forewing), in each wing's planar cm
const NOTCH = { c: [2.42, -2.42], r: 0.5 };
const BARE = { c: [2.2, 1.25], r: [0.36, 0.2], rot: 0.5 };

function catmull(ctrl, per = 28) {
  const n = ctrl.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i + n - 1) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((a) => 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  return out;
}

/** Polar description of a wing about its origin: R(u) with the margin's scallops between vein ends. */
function wingPolar(def) {
  if (def._polar) return def._polar;
  const poly = catmull(def.ctrl), [ox, oz] = def.origin;
  const rad = (d) => (d * Math.PI) / 180, phi0 = rad(def.wedge[0]), phi1 = rad(def.wedge[1]);
  // veins, dots and vein ends are designed in u over def.phi; the mesh fans over the wider def.wedge
  if (!def._mapped) {
    const m = (u) => (def.phi[0] + (def.phi[1] - def.phi[0]) * u - def.wedge[0]) / (def.wedge[1] - def.wedge[0]);
    def.ends = def.ends.map(m);
    def.veins = def.veins.map(([a, b, w]) => [[m(a[0]), a[1]], [m(b[0]), b[1]], w]);
    def.dots = def.dots.map(([u, v, r]) => [m(u), v, r]);
    def.marks = def.marks.map(([u, v, r]) => [m(u), v, r]);
    def.um = m;
    def._mapped = true;
  }
  const rawR = (phi) => {
    const dx = Math.cos(phi), dz = Math.sin(phi);
    let best = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - ox) * ez - (a[1] - oz) * ex) / den, s = ((a[0] - ox) * dz - (a[1] - oz) * dx) / den;
      if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
    }
    return Math.max(best, 0.06);
  };
  const scallop = (u) => {
    const e = def.ends;
    for (let i = 0; i < e.length - 1; i++) if (u >= e[i] && u <= e[i + 1]) { const k = (u - e[i]) / (e[i + 1] - e[i]); return Math.sin(Math.PI * k) ** 1.4; }
    return 0;
  };
  const N = 512, table = new Float32Array(N + 1);
  let rmax = 0;
  for (let i = 0; i <= N; i++) { const u = i / N; table[i] = rawR(phi0 + (phi1 - phi0) * u) * (1 - def.scallop * scallop(u)); rmax = Math.max(rmax, table[i]); }
  const R = (u) => { const x = Math.min(1, Math.max(0, u)) * N, i = Math.min(N - 1, Math.floor(x)); return table[i] + (table[i + 1] - table[i]) * (x - i); };
  const point = (u, v) => { const phi = phi0 + (phi1 - phi0) * u, r = R(u) * v; return [ox + Math.cos(phi) * r, oz + Math.sin(phi) * r]; };
  def._polar = { R, point, phi0, phi1, rmax, poly };
  return def._polar;
}

/** Wing outlines for far LODs (FLOCK): closed polygons [[x, z], ...] in cm, right side, flat pose. */
export const WING_SHAPE = {
  get fore() { const p = wingPolar(WINGS.fore); return Array.from({ length: 33 }, (_, i) => p.point(i / 32, 1)).concat([WINGS.fore.origin]); },
  get hind() { const p = wingPolar(WINGS.hind); return Array.from({ length: 33 }, (_, i) => p.point(i / 32, 1)).concat([WINGS.hind.origin]); },
  span: 7.0,
};

function wingGeometry(def, nu, nv) {
  const pol = wingPolar(def);
  const pos = [], uv = [], rr = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const v = (j / nv) ** 0.85;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, [x, z] = pol.point(u, v);
      pos.push(x, 0, z); uv.push(u, v); rr.push(pol.R(u));
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(rr, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6);
  return g;
}

// ---- painted wing maps (canvas 2D, built once per size and shared by every butterfly) ----------------
// map 1: R veins   G underside ink density   B underside pale (rings, band)
// map 2: R upper-side blue mask (0 in the black margin and at the hairy base)   G pale marks   B vein relief (blurred)
const mapCache = new Map();
function wingMaps(kind, size) {
  const key = kind + size;
  if (mapCache.has(key)) return mapCache.get(key);
  const def = WINGS[kind], pol = wingPolar(def), [x0, z0, D] = def.map, S = size / D;
  const X = (x) => (x - x0) * S, Y = (z) => size - (z - z0) * S;
  const rng = createRng('wing-map-' + kind);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, size, size); return [c, g]; };
  const outline = (g, from = 0, to = 1, close = true) => {
    g.beginPath();
    const n = 200;
    for (let i = 0; i <= n; i++) { const u = from + (to - from) * (i / n), [x, z] = pol.point(u, 1); if (i === 0) g.moveTo(X(x), Y(z)); else g.lineTo(X(x), Y(z)); }
    if (close) { g.lineTo(X(def.origin[0]), Y(def.origin[1])); g.closePath(); }
  };
  const uvLine = (g, pts, steps = 40) => {
    g.beginPath();
    let first = true;
    for (let s = 0; s < pts.length - 1; s++) for (let i = 0; i <= steps; i++) {
      const k = i / steps, u = pts[s][0] + (pts[s + 1][0] - pts[s][0]) * k, v = pts[s][1] + (pts[s + 1][1] - pts[s][1]) * k, [x, z] = pol.point(u, v);
      if (first) { g.moveTo(X(x), Y(z)); first = false; } else g.lineTo(X(x), Y(z));
    }
  };
  // each channel is painted in grey on its own canvas, then packed
  const chan = (paint) => { const [c, g] = mk(); g.lineCap = 'round'; g.lineJoin = 'round'; paint(g); return g.getImageData(0, 0, size, size).data; };
  const grey = (v, a = 1) => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;

  const veins = (blurPx, widthMul) => chan((g) => {
    g.filter = `blur(${blurPx}px)`;
    g.strokeStyle = '#fff';
    for (const [a, b, w] of def.veins) {
      // tapered: a thick basal pass, a thin full pass
      g.lineWidth = Math.max(1, 0.016 * w * widthMul * S); uvLine(g, [a, b]); g.stroke();
      const mid = [a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * 0.5];
      g.lineWidth = Math.max(1, 0.027 * w * widthMul * S); uvLine(g, [a, mid]); g.stroke();
    }
    g.filter = 'none';
  });
  const veinsR = veins(Math.max(0.6, size / 1700), 1), reliefB = veins(size / 64, 4.0);

  const dotsAt = def.dots.map(([u, v, r]) => ({ p: pol.point(u, v), r }));
  const underInk = chan((g) => {
    g.save(); outline(g); g.clip();
    g.fillStyle = grey(0.27); g.fillRect(0, 0, size, size);
    // wet mottling: pooled wash
    for (let i = 0; i < 46; i++) {
      const [x, z] = pol.point(def.um(rng()), 0.15 + 0.85 * rng()), r = (0.18 + 0.5 * rng()) * S, dark = rng() < 0.5;
      const gr = g.createRadialGradient(X(x), Y(z), 0, X(x), Y(z), r);
      gr.addColorStop(0, dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(X(x) - r, Y(z) - r, 2 * r, 2 * r);
    }
    // darker toward the base
    { const [bx, bz] = def.origin, gr = g.createRadialGradient(X(bx), Y(bz), 0, X(bx), Y(bz), 1.5 * S); gr.addColorStop(0, 'rgba(255,255,255,0.34)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, size, size); }
    // the postdiscal brush line and its wash, a thin submarginal line
    const wav = (v0, amp, f) => Array.from({ length: 25 }, (_, i) => { const u = 0.02 + 0.96 * (i / 24); return [def.um(u), v0 + amp * Math.sin(u * f) + amp * 0.6 * Math.sin(u * f * 2.3 + 1.0)]; });
    g.filter = `blur(${size / 260}px)`; g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 0.26 * S; uvLine(g, wav(0.56, 0.012, 9), 6); g.stroke();
    g.filter = `blur(${size / 900}px)`; g.strokeStyle = 'rgba(255,255,255,0.62)'; g.lineWidth = 0.05 * S; uvLine(g, wav(0.61, 0.014, 11), 6); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.022 * S; uvLine(g, wav(0.915, 0.006, 26), 6); g.stroke();
    // the seven ink dots
    g.filter = `blur(${size / 1300}px)`;
    for (const d of dotsAt) { g.fillStyle = grey(0.97); g.beginPath(); g.ellipse(X(d.p[0]), Y(d.p[1]), d.r * S, d.r * 0.9 * S, 0.3, 0, 7); g.fill(); }
    g.filter = 'none';
    g.restore();
  });
  const underPale = chan((g) => {
    g.save(); outline(g); g.clip();
    g.filter = `blur(${size / 700}px)`;
    const wav = (v0, amp, f) => Array.from({ length: 25 }, (_, i) => { const u = 0.02 + 0.96 * (i / 24); return [def.um(u), v0 + amp * Math.sin(u * f)]; });
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.1 * S; uvLine(g, wav(0.665, 0.014, 11), 6); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 0.035 * S; uvLine(g, wav(0.955, 0.004, 26), 6); g.stroke();
    for (const d of dotsAt) { g.strokeStyle = '#fff'; g.lineWidth = 0.042 * S; g.beginPath(); g.ellipse(X(d.p[0]), Y(d.p[1]), (d.r + 0.04) * S, (d.r * 0.9 + 0.04) * S, 0.3, 0, 7); g.stroke(); }
    g.filter = 'none';
    g.restore();
  });
  const blue = chan((g) => {
    g.save(); outline(g); g.clip();
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
    g.filter = `blur(${size / 110}px)`;
    g.strokeStyle = '#000';
    g.lineWidth = 0.34 * S; outline(g, 0, 1, false); g.stroke();                       // costa, inner margin
    g.lineWidth = 0.7 * S; outline(g, def.um(kind === 'fore' ? 0.07 : 0.1), def.um(kind === 'fore' ? 0.9 : 0.86), false); g.stroke();   // the 3 mm outer margin
    const [bx, bz] = def.origin, gr = g.createRadialGradient(X(bx), Y(bz), 0, X(bx), Y(bz), 0.62 * S);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    g.filter = 'none';
    g.restore();
  });
  const marks = chan((g) => {
    g.filter = `blur(${size / 1400}px)`; g.fillStyle = '#fff';
    for (const [u, v, r] of def.marks) { const [x, z] = pol.point(u, v); g.beginPath(); g.ellipse(X(x), Y(z), r * S, r * 0.8 * S, 0.5, 0, 7); g.fill(); }
    g.filter = 'none';
  });
  const pack = (r, gch, b) => {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) { data[i * 4] = r[i * 4]; data[i * 4 + 1] = gch[i * 4]; data[i * 4 + 2] = b[i * 4]; data[i * 4 + 3] = 255; }
    // canvas rows run top -> bottom; flip so that v = 0 is z0
    const flipped = new Uint8Array(size * size * 4), row = size * 4;
    for (let y = 0; y < size; y++) flipped.set(data.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
    const t = new THREE.DataTexture(flipped, size, size, THREE.RGBAFormat);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  };
  const maps = { m1: pack(veinsR, underInk, underPale), m2: pack(blue, marks, reliefB) };
  mapCache.set(key, maps);
  return maps;
}

// ---- wing shaders ------------------------------------------------------------------------------------
const WING_VERT = NOISE + /* glsl */ `
attribute vec2 aUV; attribute float aR;
uniform float uSide;
uniform vec4 uPose;    // dihedral (rad) · flap phase (cycles, < -9 = resting) · stroke (rad) · sweep (rad)
uniform vec4 uShape;   // crumple · camber · y offset · rmax
uniform vec2 uBase;    // polar origin (planar cm)
varying vec2 vP; varying vec2 vUV; varying float vR; varying vec3 vN; varying vec3 vT; varying vec3 vW; varying vec3 vF;
const vec2 HINGE = vec2(0.14, 0.1);
vec3 wingPoint(vec2 p) {
  vec2 d = p - uBase; float r = length(d), rn = r / uShape.w, cr = uShape.x;
  // emergence: small, pleated like a fan, limp
  float n1 = snoise(p * 2.3 + 11.0), n2 = snoise(p * 4.1 - 5.0);
  vec2 q = uBase + d * (1.0 - 0.6 * cr) + cr * 0.05 * rn * vec2(n1, n2);
  float y = uShape.z + cr * rn * (0.05 * sin(r * 9.0 + 2.0 * n1) + 0.035 * n2);
  // camber: a shallow arch from base to margin, a little washout along the trailing part
  y += uShape.y * (0.78 * rn * (1.0 - 0.75 * rn) + 0.05 * sin(d.y * 2.2 + d.x));
  // sweep about the vertical axis at the base
  float cs = cos(uPose.w), sn = sin(uPose.w);
  vec2 e = q - uBase; q = uBase + vec2(e.x * cs + e.y * sn, -e.x * sn + e.y * cs);
  // dihedral; in flight the stroke bends the wing: the tip lags the root
  float ang = uPose.x;
  if (uPose.y > -9.0) ang += uPose.z * sin(6.2831853 * (uPose.y - 0.11 * rn * rn)) - 0.12 * uPose.z * rn * cos(6.2831853 * uPose.y);
  float x = q.x - HINGE.x, ca = cos(ang), sa = sin(ang);
  return vec3((HINGE.x + x * ca - y * sa) * uSide, HINGE.y + x * sa + y * ca, q.y);
}
void main() {
  vec2 p = position.xz;
  vec3 P = wingPoint(p);
  float e = 0.012;
  vec3 dx = wingPoint(p + vec2(e, 0.0)) - P, dz = wingPoint(p + vec2(0.0, e)) - P;
  vec3 n = normalize(cross(dz, dx)) * uSide;
  vec2 dir = normalize(p - uBase + 1e-5);
  vec3 tl = normalize(dx * dir.x + dz * dir.y);
  vP = p; vUV = aUV; vR = aR;
  vN = normalize(mat3(modelMatrix) * n);
  vT = normalize(mat3(modelMatrix) * tl);
  // the wing's own plane (no pleats, no camber): which side is toward the eye is decided by this
  vF = normalize(mat3(modelMatrix) * vec3(-sin(uPose.x) * uSide, cos(uPose.x), 0.0));
  vec4 w = modelMatrix * vec4(P, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const g3 = (hex) => `vec3(${linear(hex).map((v) => v.toFixed(5)).join(', ')})`;
const WING_FRAG = NOISE + THINFILM + /* glsl */ `
uniform sampler2D tMap1, tMap2;
uniform vec3 uMap;            // x0, z0, 1 / size (cm)
uniform vec3 uLightDir, uLightColor, uAmbient;
uniform float uSide, uFore, uWear, uNotch, uBare, uCrumple, uThick, uScale, uAngSpan, uSheenFill;
uniform vec2 uMeadow;         // fill (0 = off: the rig as it always was) · lobe width x
uniform vec2 uBase;
uniform vec4 uNotchC;         // centre (planar cm), radius
varying vec2 vP; varying vec2 vUV; varying float vR; varying vec3 vN; varying vec3 vT; varying vec3 vW; varying vec3 vF;
const vec3 MELANIN = ${g3(PALETTE.melanin)};
const vec3 UNDER = ${g3(PALETTE.underside)};
const vec3 RING = ${g3(PALETTE.undersideRing)};
const vec3 FRINGE = ${g3(PALETTE.fringe)};
const vec3 INK = ${g3(PALETTE.jiao)};
void main() {
  vec2 muv = (vP - uMap.xy) * uMap.z;
  vec3 m1 = texture(tMap1, muv).rgb, m2 = texture(tMap2, muv).rgb;
  float edge = (1.0 - vUV.y) * vR;                       // cm inside the fringe tips
  float along = vUV.x * uAngSpan * vR;                   // cm along the margin

  // ---- the silhouette: fringe hairs, wear, the notch (alpha to coverage) ----
  float alpha = 1.0;
  float fl = 0.034;                                      // fringe length
  float ha = along / 0.0075, hcell = floor(ha), hw = fwidth(ha);
  float hlen = fl * (0.45 + 0.55 * hash11(hcell * 1.37 + uFore * 91.0));
  float hair = smoothstep(0.5, 0.5 - max(hw, 0.2), abs(fract(ha) - 0.5) * 1.25) * step(fl - hlen, edge);
  hair = mix(hair, 0.55 * smoothstep(0.0, fl, edge + 0.4 * fl), smoothstep(0.5, 1.2, hw));
  float inFringe = 1.0 - smoothstep(fl, fl * 1.25, edge);
  alpha = mix(1.0, hair, inFringe);
  if (uWear > 0.0) {
    float bite = uWear * (0.05 + 0.2 * pow(max(0.0, snoise(vec2(along * 5.0, uFore * 7.0 + uSide * 3.0)) * 0.5 + 0.5), 3.0) + 0.06 * snoise(vec2(along * 31.0, 3.0)));
    alpha *= smoothstep(bite - 0.012, bite + 0.012, edge);
  }
  if (uNotch > 0.5) {
    vec2 q = vP - uNotchC.xy;
    float rr = uNotchC.z * (1.0 + 0.16 * snoise(vec2(atan(q.y, q.x) * 2.3, 1.7)) + 0.05 * snoise(vec2(atan(q.y, q.x) * 9.0, 4.0)));
    alpha *= smoothstep(rr - 0.012, rr + 0.012, length(q));
  }
  if (alpha < 0.02) discard;

  vec3 V = normalize(cameraPosition - vW), Ng = normalize(vN), L = normalize(uLightDir);
  // (while the wings are still crumpled only their undersides show: pressed together, pale, wet)
  bool dorsal = uCrumple < 0.2 && dot(mix(Ng, normalize(vF), clamp(uCrumple * 4.0, 0.0, 1.0)), V) > 0.0;
  vec3 N = dot(Ng, V) > 0.0 ? Ng : -Ng;
  vec3 T = normalize(vT - N * dot(N, vT)), B = cross(N, T);

  // ---- relief: pleats between the veins, a slow undulation of the membrane ----
  float hx = texture(tMap2, muv + vec2(uMap.z * 0.04, 0.0)).b - m2.b, hz = texture(tMap2, muv + vec2(0.0, uMap.z * 0.04)).b - m2.b;
  vec2 und = vec2(snoise(vP * 1.1 + 3.0), snoise(vP * 1.1 - 9.0)) * 0.022;
  vec2 dirP = normalize(vP - uBase + 1e-4);
  // (planar x, z) tilts expressed in the radial frame
  vec2 tilt = und + vec2(hx, hz) * 0.5 * (dorsal ? 1.0 : -1.0);

  // ---- the scales: staggered rows of shingles, each with its own tilt and thickness ----
  float r = vUV.y * vR;
  float row = r / uScale, rowI = floor(row);
  float cols = max(1.0, floor(rowI * uScale * uAngSpan / (uScale * 1.12)));
  float scol = vUV.x * cols + 0.5 * mod(rowI, 2.0), colI = floor(scol);
  vec2 sc = vec2(fract(scol) - 0.5, fract(row));
  float fw = max(fwidth(row), fwidth(vUV.x) * cols);
  float sharp = 1.0 - smoothstep(0.3, 0.75, fw);          // scales resolved on screen?
  vec3 hs = hash32(vec2(colI + uFore * 53.0, rowI + uSide * 17.0));
  float sTiltT = ((hs.x - 0.5) * 0.2 + (0.5 - sc.y) * 0.1) * sharp;      // along the scale (radial)
  float sTiltB = ((hs.y - 0.5) * 0.12 + sc.x * 0.34) * sharp;            // across: cupped
  float gap = mix(1.0, smoothstep(0.5, 0.36, abs(sc.x)) * (0.55 + 0.45 * smoothstep(0.0, 0.3, sc.y)), sharp * 0.85);
  float thick = uThick * (0.994 + 0.016 * vUV.y + (hs.z - 0.5) * 0.022 * sharp + 0.008 * snoise(vP * 3.0));
  vec3 Nm = normalize(N + T * (sTiltT + dot(tilt, dirP)) + B * (sTiltB + dot(tilt, vec2(-dirP.y, dirP.x))));

  // rubbed and missing scales
  float rub = 0.0;
  if (uWear > 0.0) rub = uWear * (smoothstep(0.62, 0.95, snoise(vP * 2.6 + 31.0) * 0.5 + 0.5 + 0.2 * snoise(vP * 11.0)) * 0.6 + 0.45 * smoothstep(0.75, 1.0, vUV.y) * (0.5 + 0.5 * snoise(vP * 7.0)));
  float bare = 0.0;
  if (uBare > 0.5) {
    vec2 q = vP - vec2(${BARE.c[0].toFixed(3)}, ${BARE.c[1].toFixed(3)});
    q = vec2(q.x * ${Math.cos(BARE.rot).toFixed(4)} + q.y * ${Math.sin(BARE.rot).toFixed(4)}, -q.x * ${Math.sin(BARE.rot).toFixed(4)} + q.y * ${Math.cos(BARE.rot).toFixed(4)}) / vec2(${BARE.r[0].toFixed(3)}, ${BARE.r[1].toFixed(3)});
    float d = length(q) + 0.22 * snoise(vP * 6.0) + 0.1 * snoise(vP * 19.0);
    bare = (1.0 - smoothstep(0.82, 1.0, d)) * mix(1.0, step(0.35, hs.z + 0.6 * smoothstep(0.6, 1.0, d)), sharp);
  }

  float nl = dot(N, L);
  float through = max(-nl, 0.0);                         // the key light behind the membrane
  float lit = max(nl, 0.0);
  float veins = m1.r;
  vec3 col;
  if (dorsal) {
    float blueMask = m2.r * (1.0 - 0.96 * smoothstep(0.05, 0.6, veins)) * (1.0 - 0.72 * bare) * (1.0 - rub);
    // structural colour answers the light's strength, not its warmth (the blue stays the reserved blue under lamp and sun)
    vec3 filmLight = mix(uLightColor, vec3(dot(uLightColor, vec3(0.2126, 0.7152, 0.0722))), 0.8);
    vec3 sheen = wingSheen(Nm, T, V, L, thick, mix(1.25, 1.0, sharp) * uMeadow.y) * filmLight * 0.36;
    // the fill (sky, room): light from everywhere, so the lobe is always met somewhere: blue from
    // most angles, violet and then dark only toward grazing
    float nv = max(dot(Nm, V), 0.0);
    sheen += thinFilmRamp(thick * (1.018 - 0.105 * pow(1.0 - nv, 2.0))) * uAmbient * 2.3 * uSheenFill * smoothstep(0.0, 0.4, nv) * (0.55 + 0.45 * nv);
    if (uMeadow.x > 0.0) {
      // a sunlit wing in a meadow (set({ fill })): the sky above and the bounce off the grass below reach the scales
      // from every side, so whatever the angle some of the film's colour comes back. It follows the angle (blue-cyan
      // seen square, violet toward grazing) but never leaves the visible: the darkest it goes is a deep indigo-violet
      // in which the veins, the rows of scales and their glints still show
      vec3 sky = uAmbient * (0.7 + 0.3 * max(Nm.y, 0.0)) + vec3(0.32, 0.42, 0.1) * dot(uAmbient, vec3(0.2126, 0.7152, 0.0722)) * (0.5 - 0.5 * Nm.y);
      float pf = max(thick * (1.03 - 0.14 * pow(1.0 - nv, 1.5)), 0.915);
      sheen += thinFilmRamp(pf) * sky * uMeadow.x * 0.62 * (0.4 + 0.6 * nv);
      vec3 jf = normalize(Nm + T * (hs.x - 0.5) * 0.55 + B * (hs.y - 0.5) * 0.9);
      sheen += (TF_CYAN * 0.5 + 0.5) * sky * uMeadow.x * 2.2 * pow(max(dot(jf, normalize(vec3(0.0, 1.0, 0.0) + V)), 0.0), 260.0) * sharp;
    }
    // a surface of scales: each returns a little more or less, and here and there one catches the light whole
    vec3 jn = normalize(Nm + T * (hs.x - 0.5) * 0.55 + B * (hs.y - 0.5) * 0.9);
    float spark = pow(max(dot(jn, normalize(L + V)), 0.0), 500.0) * sharp * step(0.0, nl);
    col = (sheen * (1.0 + (hs.z - 0.5) * 0.5 * sharp) + (TF_CYAN * 0.6 + 0.4) * filmLight * spark * 5.0) * blueMask * gap;
    // melanin: black with a breath of brown where the light rakes it
    col += MELANIN * (uAmbient * 1.2 + uLightColor * (0.25 + 0.75 * lit)) * (0.6 + 0.4 * gap);
    col += vec3(0.05, 0.034, 0.022) * uLightColor * pow(lit, 0.6) * (1.0 - m2.r) * 0.35;
    // the bare patch: membrane, dull and faintly glossy
    col += bare * (vec3(0.02, 0.016, 0.012) * (uAmbient * 2.0 + uLightColor * lit) * (1.0 - 0.7 * veins) + uLightColor * 0.02 * pow(max(dot(Nm, normalize(L + V)), 0.0), 24.0));
    // pale marks at the apex
    col += m2.g * FRINGE * 0.75 * (uAmbient + uLightColor * (0.2 + 0.8 * lit));
    // sun through the wing: amber-brown where the blue is, darker veins and dots
    vec3 tr = mix(vec3(0.34, 0.2, 0.09), vec3(0.5, 0.42, 0.3), bare) * (1.0 - 0.75 * veins) * (1.0 - 0.6 * m1.g) * (0.35 + 0.65 * m2.r);
    col += tr * uLightColor * pow(through, 0.7) * 0.13;
  } else {
    // underside: ink-grey wash, brush line, seven ink dots ringed pale
    float brush = 0.5 + 0.5 * snoise(vec2(vUV.x * 240.0, r * 3.0));
    float wash = clamp(m1.g * (0.9 + 0.25 * brush) + 0.1 * snoise(vP * 2.1) + 0.5 * veins, 0.0, 1.0);
    vec3 alb = mix(UNDER, INK, smoothstep(0.1, 0.92, wash));
    alb = mix(alb, RING, clamp(m1.b * 1.1, 0.0, 1.0) * (1.0 - smoothstep(0.5, 0.9, m1.g)));
    alb *= mix(1.0, 0.8 + 0.2 * gap, 0.7) * (1.0 - 0.3 * rub);
    float wrap = clamp(nl * 0.7 + 0.3, 0.0, 1.0);
    col = alb * (uAmbient * 0.7 + uLightColor * wrap * 0.2);
    // silk sheen of the scales
    col += alb * uLightColor * 0.12 * pow(max(dot(Nm, normalize(L + V)), 0.0), 14.0) * step(0.0, nl);
    // back light: the wing glows, the pattern stays dark
    vec3 tr = mix(vec3(0.62, 0.5, 0.36), vec3(0.2, 0.13, 0.08), smoothstep(0.15, 0.9, wash)) * (1.0 - 0.6 * veins);
    col += tr * uLightColor * pow(through, 0.7) * 0.2;
  }
  // the fringe: pale hairs, dark where the veins run out
  float chk = smoothstep(0.3, 0.6, m2.b);   // dark where a vein runs out to the margin
  vec3 fr = mix(FRINGE * 0.8, MELANIN * 3.0, chk) * (uAmbient * 1.2 + uLightColor * (0.2 + 0.45 * abs(nl) + 0.5 * through));
  col = mix(col, fr, inFringe);
  // emergence: wet silk. No pattern yet: pale folds with the light coming through them, the veins as shadows
  if (uCrumple > 0.0) {
    float k = smoothstep(0.0, 0.5, uCrumple);
    vec3 silk = vec3(0.42, 0.34, 0.24) * (uAmbient * 0.7 + uLightColor * (0.1 * abs(nl) + 0.42 * pow(through, 0.5))) * (1.0 - 0.6 * veins) * (0.75 + 0.25 * gap);
    col = mix(col, silk, k * (1.0 - inFringe));
  }
  gl_FragColor = vec4(col, alpha);
}`;

// ---- body ---------------------------------------------------------------------------------------------
const BODY_VERT = /* glsl */ `
attribute float aKind;      // 0 body, 1 eye, 2 limb
varying vec3 vN; varying vec3 vW; varying float vKind; varying vec3 vL;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vL = position; vKind = aKind;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BODY_FRAG = NOISE + /* glsl */ `
uniform vec3 uLightDir, uLightColor, uAmbient;
varying vec3 vN; varying vec3 vW; varying float vKind; varying vec3 vL;
const vec3 BODY = ${g3(PALETTE.body)};
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uLightDir);
  float nl = dot(N, L), nv = max(dot(N, V), 0.0);
  float wrap = clamp(nl * 0.6 + 0.4, 0.0, 1.0);
  vec3 alb = BODY * (0.8 + 0.3 * snoise(vL * 9.0));
  // abdomen: faint segments
  alb *= 1.0 - 0.25 * smoothstep(0.3, 0.5, abs(fract(vL.z * 4.2) - 0.5)) * step(vL.z, -0.3) * step(vKind, 0.5);
  vec3 col = alb * (uAmbient * 1.3 + uLightColor * wrap * 0.8);
  // velvet: the pile catches light at the rim, more when the key is behind
  float rim = pow(1.0 - nv, 2.5);
  float back = pow(max(dot(V, -L), 0.0), 2.0);
  col += (BODY * 2.2 + vec3(0.02)) * rim * (uAmbient * 1.5 + uLightColor * (0.25 * wrap + 1.4 * back));
  if (vKind > 2.5) {                                       // the proboscis reaching a flower: a warm brown, polished
    vec3 H = normalize(L + V);
    col = vec3(0.085, 0.056, 0.032) * (uAmbient * 1.4 + uLightColor * wrap * 0.9) + uLightColor * 0.3 * pow(max(dot(N, H), 0.0), 40.0)
        + vec3(0.14, 0.09, 0.05) * rim * (uAmbient + uLightColor * back);
  }
  if (vKind > 0.5 && vKind < 1.5) {                       // eye: dark, glossy
    vec3 H = normalize(L + V);
    col = vec3(0.012, 0.01, 0.01) * (uAmbient + uLightColor * wrap) + uLightColor * 0.6 * pow(max(dot(N, H), 0.0), 60.0) + uAmbient * 0.25 * rim;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
const HAIR_VERT = /* glsl */ `
attribute vec3 aRoot; attribute vec3 aDir; attribute vec2 aHair;   // along 0..1, side -1..1 ; aHair: length, shade
attribute vec2 aSt;
varying float vS; varying float vShade; varying vec3 vW; varying vec3 vNn;
void main() {
  vec3 root = (modelViewMatrix * vec4(aRoot, 1.0)).xyz;
  vec3 dir = normalize(mat3(modelViewMatrix) * aDir);
  // the hair droops a little toward its tip
  vec3 tip = root + (dir + vec3(0.0, -0.18, 0.0) * aSt.x) * aHair.x * aSt.x * length(mat3(modelMatrix)[0]);
  vec3 side = normalize(cross(dir, vec3(0.0, 0.0, 1.0)) + 1e-4);
  float w = 0.0052 * (1.0 - 0.85 * aSt.x) * length(mat3(modelMatrix)[0]);
  vec4 mv = vec4(tip + side * aSt.y * w, 1.0);
  vS = aSt.x; vShade = aHair.y;
  vW = (inverse(viewMatrix) * mv).xyz;
  vNn = normalize(mat3(modelMatrix) * aDir);
  gl_Position = projectionMatrix * mv;
}`;
const HAIR_FRAG = /* glsl */ `
uniform vec3 uLightDir, uLightColor, uAmbient;
varying float vS; varying float vShade; varying vec3 vW; varying vec3 vNn;
const vec3 BODY = ${g3(PALETTE.body)};
void main() {
  vec3 V = normalize(cameraPosition - vW), L = normalize(uLightDir);
  float wrap = clamp(dot(vNn, L) * 0.5 + 0.5, 0.0, 1.0);
  float back = pow(max(dot(V, -L), 0.0), 3.0);
  vec3 alb = mix(BODY * 1.3, vec3(0.16, 0.13, 0.1), vS * vShade);
  vec3 col = alb * (uAmbient * 1.4 + uLightColor * (0.5 * wrap + 2.6 * back * vS));
  gl_FragColor = vec4(col, 0.9 * (1.0 - vS * vS * 0.7));
}`;

// a tube along a polyline with per-point radii (cm)
function tube(points, radii, sides, kind, out) {
  const base = out.pos.length / 3, P = points.map((p) => new THREE.Vector3(...p));
  const up = new THREE.Vector3(0.13, 1, 0.07).normalize();
  for (let i = 0; i < P.length; i++) {
    const t = new THREE.Vector3().subVectors(P[Math.min(P.length - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
    const a = new THREE.Vector3().crossVectors(t, up).normalize(), b = new THREE.Vector3().crossVectors(t, a).normalize();
    for (let s = 0; s < sides; s++) {
      const th = (s / sides) * Math.PI * 2, n = new THREE.Vector3().addScaledVector(a, Math.cos(th)).addScaledVector(b, Math.sin(th));
      out.pos.push(P[i].x + n.x * radii[i], P[i].y + n.y * radii[i], P[i].z + n.z * radii[i]);
      out.nor.push(n.x, n.y, n.z); out.kind.push(kind);
    }
  }
  for (let i = 0; i < P.length - 1; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    out.idx.push(a, b, c, b, d, c);
  }
}
// the same tube with its rings carried along the curve (parallel transport), so a curve that turns
// through the vertical (a coil, a leg's knee) does not twist; same vertex and index layout as tube()
function tubePT(points, radii, sides, kind, out) {
  const base = out.pos.length / 3, P = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p)));
  const n = P.length, nrm = new THREE.Vector3(), bn = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    t.subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
    if (i === 0) nrm.crossVectors(t, Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    else { nrm.addScaledVector(t, -nrm.dot(t)); if (nrm.lengthSq() < 1e-10) nrm.crossVectors(t, new THREE.Vector3(1, 0, 0)); nrm.normalize(); }
    bn.crossVectors(t, nrm).normalize();
    for (let s = 0; s < sides; s++) {
      const th = (s / sides) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const nx = nrm.x * c + bn.x * sn, ny = nrm.y * c + bn.y * sn, nz = nrm.z * c + bn.z * sn;
      out.pos.push(P[i].x + nx * radii[i], P[i].y + ny * radii[i], P[i].z + nz * radii[i]);
      out.nor.push(nx, ny, nz); out.kind.push(kind);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    out.idx.push(a, b, c, b, d, c);
  }
}
// an ellipsoid-of-revolution chain along z: rings [z, y, rx, ry]
function lathe(rings, sides, kind, out) {
  const base = out.pos.length / 3;
  for (let i = 0; i < rings.length; i++) {
    const [z, y, rx, ry] = rings[i];
    const zp = rings[Math.max(0, i - 1)], zn = rings[Math.min(rings.length - 1, i + 1)];
    const slope = (zn[2] - zp[2]) / Math.max(1e-4, zn[0] - zp[0]);
    for (let s = 0; s < sides; s++) {
      const th = (s / sides) * Math.PI * 2, cx = Math.cos(th), cy = Math.sin(th);
      out.pos.push(cx * rx, y + cy * ry, z);
      const n = new THREE.Vector3(cx / Math.max(rx, 1e-3), cy / Math.max(ry, 1e-3), -slope / Math.max(rx, 1e-3) * 0.6).normalize();
      out.nor.push(n.x, n.y, n.z); out.kind.push(kind);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    out.idx.push(a, b, c, b, d, c);
  }
}
function sphere(c, r, kind, out, seg = 10) {
  const rings = [];
  for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + (i / seg) * Math.PI; rings.push([c[2] + Math.sin(a) * r, c[1], Math.max(1e-3, Math.cos(a) * r), Math.max(1e-3, Math.cos(a) * r)]); }
  const base = out.pos.length / 3;
  lathe(rings, 12, kind, out);
  for (let i = base; i < out.pos.length / 3; i++) {
    out.pos[i * 3] += c[0];
    const n = new THREE.Vector3(out.pos[i * 3] - c[0], out.pos[i * 3 + 1] - c[1], out.pos[i * 3 + 2] - c[2]).normalize();
    out.nor[i * 3] = n.x; out.nor[i * 3 + 1] = n.y; out.nor[i * 3 + 2] = n.z;
  }
}
const toGeo = (out) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(out.kind, 1));
  g.setIndex(out.idx);
  return g;
};
// body profile: [z, y, rx, ry] from the tail to the head
const BODY_RINGS = (() => {
  const r = [];
  // abdomen: -1.5 .. -0.3, tapering to a rounded tip, drooping slightly
  for (let i = 0; i <= 12; i++) {
    const k = i / 12, z = -1.5 + 1.2 * k, tip = Math.sqrt(Math.min(1, k * 3.2)) , body = 0.075 + 0.105 * Math.sin(Math.min(1, k * 1.15) * Math.PI * 0.5);
    r.push([z, -0.03 - 0.08 * (1 - k) ** 2, Math.max(0.012, body * tip * (1 - 0.1 * k)), Math.max(0.012, body * tip * 0.95)]);
  }
  // waist, thorax: -0.3 .. 0.68
  for (let i = 1; i <= 10; i++) { const k = i / 10, z = -0.3 + 0.98 * k, e = Math.sin(k * Math.PI) ** 0.6; r.push([z, 0.0 + 0.03 * e, 0.15 + 0.11 * e, 0.14 + 0.13 * e]); }
  // neck, head: 0.68 .. 1.02
  for (let i = 1; i <= 7; i++) { const k = i / 7, z = 0.68 + 0.36 * k, e = Math.sin(k * Math.PI) ** 0.55; r.push([z, 0.0, 0.1 + 0.085 * e * (1 - 0.2 * k), 0.1 + 0.075 * e]); }
  r[r.length - 1][2] = r[r.length - 1][3] = 0.02;
  return r;
})();
const LEGS = [
  // [attach, knee, ankle, foot] right side; mirrored
  [[0.1, -0.16, 0.5], [0.42, -0.02, 0.86], [0.62, -0.3, 1.02], [0.7, FEET_Y, 1.12]],
  [[0.12, -0.18, 0.25], [0.62, 0.0, 0.3], [0.9, -0.3, 0.3], [1.0, FEET_Y, 0.32]],
  [[0.1, -0.18, 0.0], [0.5, -0.04, -0.42], [0.72, -0.3, -0.72], [0.78, FEET_Y, -0.88]],
];

/** The standing rig's six feet, local cm, in the order set({ feet }) takes them (right front, mid, hind; left ...). */
export const FEET_REST = [1, -1].flatMap((s) => LEGS.map((l) => [l[3][0] * s, l[3][1], l[3][2]]));
// posed legs (set({ feet })): femur, tibia, tarsus per leg, the lengths a little longer than the standing rig's
// so that a foot set closer in bends the leg at visible joints
const LEG_LEN = [[0.46, 0.42, 0.3], [0.52, 0.48, 0.33], [0.56, 0.52, 0.36]];   // front, mid, hind
const LEG_PTS = 7, LEG_SIDES = 6;
const LEG_RAD = [0.022, 0.021, 0.02, 0.016, 0.0125, 0.0095, 0.0075];
/** The six legs reaching for `feet` (local [x, y, z(, nx, ny, nz)]): polylines of LEG_PTS points. */
function posedLegs(feet) {
  const V = THREE.Vector3, legs = [];
  [1, -1].forEach((s, si) => LEGS.forEach((leg, li) => {
    const f = feet[si * 3 + li], A = new V(leg[0][0] * s, leg[0][1], leg[0][2]);
    const F = new V(f[0], f[1], f[2]), Nf = f.length >= 6 ? new V(f[3], f[4], f[5]).normalize() : new V(0, 1, 0);
    const [Lf, Lt, Ls] = LEG_LEN[li];
    // the tarsus lies out along the surface, away from the body, and comes down onto it at ~28 degrees
    const out = F.clone().sub(A); out.addScaledVector(Nf, -out.dot(Nf));
    if (out.lengthSq() < 1e-8) out.set(s, 0, 0);
    out.normalize();
    const ca = Math.cos(28 * DEG), sa = Math.sin(28 * DEG);
    let K, Ak = F.clone().addScaledVector(out, -Ls * ca).addScaledVector(Nf, Ls * sa);
    // two-bone IK: attach -> knee -> ankle; the knee rises up and out (and forward for the front pair, back for the hind)
    const d0 = Ak.clone().sub(A), dl = Math.min(Math.max(d0.length(), Math.abs(Lf - Lt) + 1e-3), Lf + Lt - 1e-3);
    const dir = d0.normalize();
    Ak = A.clone().addScaledVector(dir, dl);
    const pole = new V(s * 0.75, 1.0, [0.35, 0.0, -0.4][li]).normalize();
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const along = (dl * dl + Lf * Lf - Lt * Lt) / (2 * dl), h = Math.sqrt(Math.max(0, Lf * Lf - along * along));
    K = A.clone().addScaledVector(dir, along).addScaledVector(pole, h);
    // the tarsus sags a little between its ankle and its claws
    const T1 = Ak.clone().lerp(F, 0.5).addScaledVector(Nf, -0.012);
    legs.push([A, A.clone().lerp(K, 0.5), K, K.clone().lerp(Ak, 0.5), Ak, T1, F]);
  }));
  return legs;
}
function legsGeometry(feet) {
  const out = { pos: [], nor: [], kind: [], idx: [] };
  for (const pts of posedLegs(feet)) tubePT(pts, LEG_RAD, LEG_SIDES, 2, out);
  return out;
}

function bodyGeometry(lod, withLegs = true) {
  const out = { pos: [], nor: [], kind: [], idx: [] };
  lathe(BODY_RINGS, lod === 'hero' ? 16 : 10, 0, out);
  for (const s of [1, -1]) {
    sphere([s * 0.125, 0.035, 0.9], 0.105, 1, out, lod === 'hero' ? 10 : 6);
    if (withLegs) for (const leg of LEGS) tube(leg.map(([x, y, z]) => [x * s, y, z]), [0.022, 0.017, 0.012, 0.008], 5, 2, out);
    // labial palps: two short upturned tubes in front of the face
    tube([[s * 0.05, -0.06, 0.98], [s * 0.06, -0.02, 1.1], [s * 0.055, 0.06, 1.15]], [0.03, 0.028, 0.012], 5, 0, out);
  }
  return toGeo(out);
}
function antennaGeometry(side) {
  const out = { pos: [], nor: [], kind: [], idx: [] }, pts = [], rad = [], n = 16;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    pts.push([side * (0.07 + 0.52 * k + 0.2 * k * k), 0.1 + 0.62 * k - 0.16 * k * k, 0.95 + 1.25 * k - 0.1 * k * k]);
    rad.push(0.011 + 0.03 * Math.exp(-(((k - 0.93) / 0.07) ** 2)) - 0.004 * k);
  }
  tube(pts, rad, 5, 2, out);
  return toGeo(out);
}
function hairGeometry(seed, count) {
  const rng = createRng(seed + '-hair');
  const root = [], dir = [], hair = [], st = [], idx = [];
  const ringAt = (z) => { for (let i = 0; i < BODY_RINGS.length - 1; i++) { const a = BODY_RINGS[i], b = BODY_RINGS[i + 1]; if (z >= a[0] && z <= b[0]) { const k = (z - a[0]) / (b[0] - a[0]); return a.map((v, j) => v + (b[j] - v) * k); } } return BODY_RINGS[0]; };
  for (let i = 0; i < count; i++) {
    // mostly thorax, some on the head and the fore part of the abdomen
    const pick = rng();
    const z = pick < 0.68 ? rng.range(-0.3, 0.68) : pick < 0.82 ? rng.range(0.7, 1.0) : rng.range(-1.1, -0.3);
    const [, y, rx, ry] = ringAt(z), th = rng.range(-0.35, Math.PI + 0.35) + (rng() < 0.22 ? Math.PI : 0);
    const n = new THREE.Vector3(Math.cos(th), Math.sin(th), 0), p = [Math.cos(th) * rx, y + Math.sin(th) * ry, z];
    const d = new THREE.Vector3(n.x, n.y, -0.75 + 0.3 * rng()).normalize();
    const len = (pick < 0.68 ? rng.range(0.1, 0.3) : rng.range(0.05, 0.14)) * (0.7 + 0.5 * Math.max(0, n.y));
    const base = root.length / 3;
    for (const [s, w] of [[0, -1], [0, 1], [0.55, -1], [0.55, 1], [1, 0]]) { root.push(...p); dir.push(d.x, d.y, d.z); hair.push(len, rng()); st.push(s, w); }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(root, 3));
  g.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aHair', new THREE.Float32BufferAttribute(hair, 2));
  g.setAttribute('aSt', new THREE.Float32BufferAttribute(st, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return g;
}
// the proboscis: a planar spiral (in the y-z plane under the head) whose curvature relaxes from the base outward
const PROB = { len: 1.55, rings: 34, sides: 5, at: [0, -0.1, 1.0] };
function proboscisPoints(k) {
  const pts = [], rad = [], n = PROB.rings, ds = PROB.len / n;
  let y = PROB.at[1], z = PROB.at[2], th = -1.0;          // heading: forward and down
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push([0, y, z]); rad.push(0.018 - 0.011 * s);
    const coil = -1 / (0.17 - 0.115 * s);                  // tight spiral, tighter toward the tip
    const open = 0.55 * Math.sin(s * 3.0) - 0.35;          // extended: a shallow S reaching down
    const e = Math.min(1, Math.max(0, (k * 1.5 - s * 0.5) / 1.0)), e2 = e * e * (3 - 2 * e);
    th += (coil + (open - coil) * e2) * ds;
    y += Math.sin(th) * ds; z += Math.cos(th) * ds;
  }
  return { pts, rad };
}
/**
 * The proboscis reaching a target (local cm): the same rings, uncoiling base first with k, but the open shape is
 * one curve in the plane of its first heading and the target: out from under the head forward and down, a bend
 * (the knee) a third of the way along, then down onto the target, which the tip touches at k = 1. The coil is
 * the original watch spring scaled to the length the reach needs.
 */
function proboscisToTarget(k, target) {
  const V = THREE.Vector3, n = PROB.rings;
  const A = new V(...PROB.at), D = new V(target[0], target[1], target[2]).sub(A), dl = Math.max(D.length(), 1e-3);
  // first heading: 22 degrees below the body's forward, turned a little toward the target
  const u0 = new V(0, -Math.sin(22 * DEG), Math.cos(22 * DEG)).lerp(D.clone().divideScalar(dl), 0.15).normalize();
  const pn = new V().crossVectors(u0, D);
  if (pn.lengthSq() < 1e-10) pn.set(1, 0, 0);
  pn.normalize();
  const e1 = u0, e2 = new V().crossVectors(pn, e1).normalize();
  // knee at a third: |D - a u0| = 2a  ->  3a^2 + 2a (D.u0) - D.D = 0
  const du = D.dot(u0), a = (-du + Math.sqrt(du * du + 3 * dl * dl)) / 3, Lp = 3 * a;
  const w = D.clone().addScaledVector(u0, -a).normalize(), bend = Math.atan2(w.dot(e2), w.dot(e1));
  const sgn = new V(0, -1, -0.6).dot(e2) >= 0 ? 1 : -1;            // the spring curls down and back under the head
  const R0 = Lp / PROB.len, SK = 0.075, G = SK * Math.sqrt(Math.PI), ds = Lp / n;
  const curve = (kk) => {
    const xy = [], ee = [];
    let th = 0, x = 0, y = 0;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      xy.push([x, y]);
      const e = Math.min(1, Math.max(0, kk * 1.5 - s * 0.5)), es = e * e * (3 - 2 * e);
      ee.push(es);
      const coil = sgn / ((0.17 - 0.115 * s) * R0);
      const knee = (0.8 * bend * Math.exp(-(((s - 1 / 3) / SK) ** 2))) / (Lp * G) + ((0.2 * bend) / (Lp * (2 / 3))) * Math.min(1, Math.max(0, (s - 0.28) / 0.12));
      th += (coil + (knee - coil) * es) * ds;
      x += Math.cos(th) * ds; y += Math.sin(th) * ds;
    }
    return { xy, ee };
  };
  // the open curve misses the target by a hair (the knee is spread): carry the miss out along its far part
  const open = curve(1).xy, end = open[n], cx = D.dot(e1) - end[0], cy = D.dot(e2) - end[1];
  const { xy, ee } = curve(k);
  const pts = [], rad = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, wc = s * s * ee[i];
    const x = xy[i][0] + cx * wc, y = xy[i][1] + cy * wc;
    pts.push([A.x + e1.x * x + e2.x * y, A.y + e1.y * x + e2.y * y, A.z + e1.z * x + e2.z * y]);
    rad.push(0.021 - 0.012 * s);
  }
  return { pts, rad };
}

const DEG = Math.PI / 180;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function createButterfly({ lod = 'hero', seed = 'butterfly' } = {}) {
  const hero = lod !== 'mid';
  const group = new THREE.Group();
  group.name = `butterfly-${lod}`;
  const light = {
    uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() }, uLightColor: { value: new THREE.Vector3(1, 1, 1) }, uAmbient: { value: new THREE.Vector3(0.12, 0.12, 0.12) },
  };
  const shared = { uWear: { value: 0 }, uCrumple: { value: 0 }, uThick: { value: 1 }, uScale: { value: 0.012 }, uSheenFill: { value: 1 }, uMeadow: { value: new THREE.Vector2(0, 1) } };
  const size = hero ? 2048 : 512;
  const disposables = [];
  const wings = [];
  for (const kind of ['fore', 'hind']) {
    const def = WINGS[kind], pol = wingPolar(def), maps = wingMaps(kind, size);
    const geo = wingGeometry(def, hero ? 150 : 40, hero ? 30 : 10);
    disposables.push(geo);
    for (const side of [1, -1]) {
      const uniforms = {
        ...light, ...shared,
        tMap1: { value: maps.m1 }, tMap2: { value: maps.m2 }, uMap: { value: new THREE.Vector3(def.map[0], def.map[1], 1 / def.map[2]) },
        uSide: { value: side }, uFore: { value: kind === 'fore' ? 1 : 0 }, uNotch: { value: 0 }, uBare: { value: 0 },
        uNotchC: { value: new THREE.Vector4(NOTCH.c[0], NOTCH.c[1], NOTCH.r, 0) }, uAngSpan: { value: Math.abs(pol.phi1 - pol.phi0) },
        uPose: { value: new THREE.Vector4(0, -10, 0, 0) }, uShape: { value: new THREE.Vector4(0, 1, def.yOff, pol.rmax) }, uBase: { value: new THREE.Vector2(...def.origin) },
      };
      const mat = new THREE.ShaderMaterial({ name: `butterfly-wing-${kind}`, uniforms, vertexShader: WING_VERT, fragmentShader: WING_FRAG, side: THREE.DoubleSide, alphaToCoverage: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      group.add(mesh);
      disposables.push(mat);
      wings.push({ kind, side, uniforms, mesh });
    }
  }
  const bodyMat = new THREE.ShaderMaterial({ name: 'butterfly-body', uniforms: light, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, side: THREE.DoubleSide });
  const bodyGeo = bodyGeometry(lod), bodyBareGeo = bodyGeometry(lod, false);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);
  disposables.push(bodyMat, bodyGeo, bodyBareGeo);
  // posed legs (set({ feet })): their own mesh, rebuilt on the CPU when the feet move; the body then drops its standing legs
  const legs = (() => {
    const out = legsGeometry(Array.from({ length: 6 }, (_, i) => { const s = i < 3 ? 1 : -1, l = LEGS[i % 3][3]; return [l[0] * s, l[1], l[2]]; }));
    const g = toGeo(out), mesh = new THREE.Mesh(g, bodyMat);
    mesh.frustumCulled = false; mesh.visible = false;
    group.add(mesh); disposables.push(g);
    return { geo: g, mesh, key: '' };
  })();
  const antennae = [1, -1].map((s) => {
    const g = antennaGeometry(s), pivot = new THREE.Group(), m = new THREE.Mesh(g, bodyMat);
    // pivot at the antenna's root so the tremor swings it from the head
    pivot.position.set(s * 0.07, 0.1, 0.95); m.position.set(-s * 0.07, -0.1, -0.95);
    pivot.add(m); group.add(pivot); disposables.push(g);
    return pivot;
  });
  let prob = null;
  if (hero) {
    const hairGeo = hairGeometry(seed, 1500);
    const hairMat = new THREE.ShaderMaterial({ name: 'butterfly-hair', uniforms: light, vertexShader: HAIR_VERT, fragmentShader: HAIR_FRAG, side: THREE.DoubleSide, alphaToCoverage: true });
    const hairMesh = new THREE.Mesh(hairGeo, hairMat);
    hairMesh.frustumCulled = false;
    group.add(hairMesh);
    disposables.push(hairGeo, hairMat);
    // proboscis (rebuilt on the CPU when `proboscis` changes: 175 vertices)
    const out = { pos: [], nor: [], kind: [], idx: [] }, { pts, rad } = proboscisPoints(0);
    tube(pts, rad, PROB.sides, 2, out);
    const g = toGeo(out);
    prob = { geo: g, mesh: new THREE.Mesh(g, bodyMat), key: '' };
    prob.mesh.frustumCulled = false;
    group.add(prob.mesh);
    disposables.push(g);
  }

  const state = { open: 1, flap: null, crumple: 0, wear: 0, notch: 0, barePatch: 0, proboscis: 0, proboscisTarget: null, feet: null, antennaLift: 0, fill: 0, lobe: 1, lightDir: [0.3, 0.8, 0.5], lightColor: [1, 1, 1], ambient: null, sheenFill: 1, dof: null };
  const sat = (x) => Math.min(1, Math.max(0, x));
  function apply() {
    const open = sat(state.open), cr = sat(state.crumple), flying = typeof state.flap === 'number';
    const dihedral = (1 - open) * 91.5 * DEG;
    for (const w of wings) {
      const fore = w.kind === 'fore';
      // closing, the forewing slides back between the hindwings
      const sweep = (fore ? -15 + 19 * open : 5 - 5 * open) * DEG * (1 - cr);
      w.uniforms.uPose.value.set(dihedral - (fore ? 0 : 0.5 * DEG), flying ? state.flap - (fore ? 0 : 0.035) : -10, flying ? 46 * DEG : 0, sweep);
      w.uniforms.uShape.value.x = cr;
      w.uniforms.uShape.value.y = (0.14 + 0.86 * open) * (flying ? 0.6 : 1);     // shut, the wings lie flat against each other
      w.uniforms.uNotch.value = state.notch > 0.5 && w.side > 0 && !fore ? 1 : 0;
      w.uniforms.uBare.value = state.barePatch > 0.5 && w.side < 0 && fore ? 1 : 0;
    }
    shared.uWear.value = sat(state.wear);
    shared.uCrumple.value = cr;
    shared.uSheenFill.value = Math.max(0, state.sheenFill ?? 1);
    shared.uMeadow.value.set(Math.max(0, state.fill ?? 0), Math.max(0.1, state.lobe ?? 1));
    light.uLightDir.value.fromArray(state.lightDir).normalize();
    light.uLightColor.value.fromArray(state.lightColor);
    if (state.ambient) light.uAmbient.value.fromArray(state.ambient);
    else light.uAmbient.value.setScalar(0.12 * lum(state.lightColor));
    const tgt = Array.isArray(state.proboscisTarget) && state.proboscisTarget.length >= 3 ? state.proboscisTarget : null;
    const pkey = tgt ? `${state.proboscis}|${tgt[0]},${tgt[1]},${tgt[2]}` : `${state.proboscis}`;
    if (prob && prob.key !== pkey) {
      prob.key = pkey;
      const out = { pos: [], nor: [], kind: [], idx: [] };
      if (tgt) { const { pts, rad } = proboscisToTarget(sat(state.proboscis), tgt); tubePT(pts, rad, PROB.sides, 3, out); }
      else { const { pts, rad } = proboscisPoints(sat(state.proboscis)); tube(pts, rad, PROB.sides, 2, out); }
      prob.geo.attributes.position.copyArray(out.pos); prob.geo.attributes.position.needsUpdate = true;
      prob.geo.attributes.normal.copyArray(out.nor); prob.geo.attributes.normal.needsUpdate = true;
      prob.geo.attributes.aKind.copyArray(out.kind); prob.geo.attributes.aKind.needsUpdate = true;
    }
    // posed legs, or the standing rig
    const feet = Array.isArray(state.feet) && state.feet.length === 6 ? state.feet : null;
    body.geometry = feet ? bodyBareGeo : bodyGeo;
    legs.mesh.visible = !!feet;
    if (feet) {
      const key = feet.map((f) => f.join(',')).join(';');
      if (key !== legs.key) {
        legs.key = key;
        const out = legsGeometry(feet);
        legs.geo.attributes.position.copyArray(out.pos); legs.geo.attributes.position.needsUpdate = true;
        legs.geo.attributes.normal.copyArray(out.nor); legs.geo.attributes.normal.needsUpdate = true;
      }
    }
  }
  function update(t) {
    antennae.forEach((p, i) => {
      p.rotation.set(-(state.antennaLift || 0) + 0.035 * Math.sin(t * 2.3 + i * 1.7) + 0.02 * Math.sin(t * 5.1 + i), 0.04 * Math.sin(t * 1.7 + i * 2.6), 0.025 * Math.sin(t * 3.1 + i * 0.9));
    });
  }
  apply(); update(0);
  return {
    group, lod, seed,
    set(s = {}) { Object.assign(state, s); apply(); },
    update,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
