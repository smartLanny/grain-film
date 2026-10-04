// PAPER (W6): the blank sheet. S23, S24 (SCRIPT.md 3 W6, section 4, 8.1 image 5). Owner: Group A.
//
// The world paints almost nothing: a black wash that is let down with water from where the
// butterfly slept (lib/ink.js inkDilute, the same gesture CITY opens the film with), and one brush
// stroke, the hero blade of S07 / S21, upright and bare, springing to rest with story.bladeSpring.
// Everything else is the INK pass: the sheet itself (xuan paper under a raking light that drifts),
// the five tones the thinning black passes through, the wet edges, and the cards (L2, E), which are
// soaked into the sheet by the look pass. The last sheen is post.sheen (shots/paper.js).
//
//   params  wash 1..0 (black -> clear) · washCentre [x, y] frame · spring { t0, d0, restBy } |
//           null (at rest) · lampOff 0..1 (the paper dims to black)
//
// S22 -> S23: the black is INK (SCRIPT.md 7.4 rule 3: the shadow of S22, ink, the shut wing and the
// unlit scales are one value, #0D0C0E): the sheet is lit from the first frame and covered by a wash
// of density 1, which the INK pass returns as exactly 焦. No lighting ramp, no vignette while black.
// The stroke lives in stroke space (s along the blade, y across it): its dry brush travels with the
// blade as it swings, and the swing is the closed form the blade was released with in S07.

import * as THREE from 'three';
import { PAPER_GLSL, DILUTE_GLSL } from '../lib/ink.js';
import { HERO_BLADE, REST_POINT, PALETTE, rgb, bladeSpring, bladeScreen } from '../lib/story.js';

const N = 40;                                    // polyline segments of the stroke
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;

const FRAG = PAPER_GLSL + DILUTE_GLSL + /* glsl */ `
uniform vec2 uPts[${N + 1}];       // the blade, root -> tip, in frame widths (x, y up)
uniform vec2 uCentre;              // where the water starts, frame widths
uniform float uWash, uHalf, uAspect;
varying vec2 vUv;

// half width of the stroke along it (in units of uHalf): the brush lands, presses, and is drawn off to a point
float strokeWidth(float s) { return pow(max(1.0 - s, 0.0), 0.72) * (0.70 + 0.30 * sin(3.14159 * clamp(s / 0.66, 0.0, 1.0))); }

void main() {
  vec2 p = vec2(vUv.x, vUv.y / uAspect);
  // the stroke: nearest point on the polyline -> (s, signed distance)
  float best = 1e9, sBest = 0.0, side = 1.0;
  for (int i = 0; i < ${N}; i++) {
    vec2 a = uPts[i], b = uPts[i + 1], ab = b - a, ap = p - a;
    float h = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    vec2 d = ap - ab * h;
    float dd = dot(d, d);
    if (dd < best) { best = dd; sBest = (float(i) + h) / float(${N}); side = sign(ab.x * ap.y - ab.y * ap.x); }
  }
  float dist = sqrt(best);
  float hw = uHalf * strokeWidth(sBest);
  float stroke = 0.0;
  if (dist < hw * 1.05 + 0.0006 && sBest < 0.9995) {
    float y = side * dist / max(hw, 1e-5);
    float cover = dryBrush(vec2(sBest, y), 0.72, 3.7);
    // loaded at the root, running out toward the tip; each hair carries its own share
    float hair = dbNoise(vec2(y * 9.0 + 2.0, sBest * 2.0));
    float dens = mix(0.99, 0.60, smoothstep(0.30, 0.97, sBest)) - 0.16 * (hair - 0.5) * smoothstep(0.2, 0.8, sBest);
    stroke = cover * dens * (1.0 - smoothstep(hw * 0.92, hw * 1.05 + 0.0004, dist));
  }
  float wash = inkDilute(p, uCentre, uWash);
  float d = 1.0 - (1.0 - stroke) * (1.0 - wash);
  gl_FragColor = vec4(inkPaint(d), 1.0);
}`;

export async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, ctx.aspect, 0.1, 100);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const uniforms = {
    uPts: { value: Array.from({ length: N + 1 }, () => new THREE.Vector2()) },
    uCentre: { value: new THREE.Vector2(REST_POINT[0], REST_POINT[1] / ctx.aspect) },
    uWash: { value: 1 }, uAspect: { value: ctx.aspect },
    // the blade is 0.55 cm wide and 34 cm long; as a brush stroke it is drawn a little bolder
    uHalf: { value: 1.45 * (HERO_BLADE.width / HERO_BLADE.length) * (HERO_BLADE.lengthFrac / ctx.aspect) },
    tPaper: { value: null },
  };
  const mat = new THREE.ShaderMaterial({ name: 'paper-sheet', uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const PAPER_LIT = rgb(PALETTE.paperLit);
  const state = { t: 0, lit: 0, lampOff: 0 };

  return {
    scene, camera,
    post: () => {
      const k = 1 - state.lampOff;
      return {
        bloom: 0, halation: 0, vignette: 0.30 * state.lit, vignetteSoftness: 0.6, chromaticAberration: 0, grain: 0.012,
        ink: {
          amount: 1, chroma: 0, mist: 0, line: 0, wet: 0.3, dry: 0.3,
          // the raking light: strong on this sheet, and drifting slowly round as the lamp is carried
          rake: 0.5, rakeAngle: 150 + 14 * Math.sin((state.t - 216) * 0.11),
          paper: PAPER_LIT.map((c) => c * k),
        },
      };
    },
    update(t, localT, shot, p = {}) {
      const wash = p.wash ?? 0, sp = p.spring || null;
      const c = p.washCentre || REST_POINT;
      uniforms.uCentre.value.set(c[0], c[1] / ctx.aspect);
      uniforms.uWash.value = wash;
      const defl = sp ? bladeSpring(t, sp.t0, sp.d0, sp.restBy ?? Infinity) : 0;
      for (let i = 0; i <= N; i++) {
        const [x, y] = bladeScreen(i / N, defl);
        uniforms.uPts.value[i].set(x, y / ctx.aspect);
      }
      state.t = t;
      // the vignette (the lamp's falloff on the sheet) arrives with the white paper, not over the black
      state.lit = smooth(0.95, 0.45, wash);
      state.lampOff = p.lampOff ?? 0;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
