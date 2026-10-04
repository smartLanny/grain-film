// DROP (SCRIPT.md 3.0): a water drop as a lens showing another shot. Owner: Group B (MACRO).
//
//   import { createDrop } from '../lib/drop.js';
//   const d = createDrop({ radius: 0.3 });                              // world units
//   scene.add(d.mesh);
//   // in update(t, ...), FIRST (before setting your own state; see engine.portal):
//   d.set({ portal: ctx.engine.portal('S01', 10.0, { scale: 0.5 }), fill: 0, lightDir: [0.4, 0.8, 0.3] });
//
// createDrop({ radius, segments }) -> { mesh, set(state), dispose() }
//   mesh    THREE.Mesh: a sphere of `radius` world units centred on its origin (scale it to squash
//           or stretch it: a hanging drop is ~1.12 tall)
//   set(state)  any subset; persists:
//     portal    THREE.Texture from engine.portal(): a 'graded' portal (display-referred sRGB values)
//               is decoded to linear here; an 'hdr' portal (stage: 'hdr') is shown as it is. x `gain`
//     fill      0..1  0 = a small lens: the portal upside down with respect to the WORLD's up (so a
//               camera that rolls 180° sees it come upright: S13's corkscrew), barrel-distorted,
//               inside a dark refracting rim; 1 = identity: the portal mapped straight onto the
//               screen, with no rim, highlight or tint, so a push that fills the frame with the drop
//               ends exactly on the portal image (X6, the S13 -> S14 cut)
//     wobble    0..1  surface quiver (two low harmonics, driven by `time`)
//     time      seconds for the quiver (pass film time)
//     lightDir  [x, y, z] WORLD direction TO the key light: the window highlight, and the light the
//               drop gathers on its far side (the caustic glow inside its lower rim)
//     lightColor [r, g, b] linear radiance of that light (default [3, 3, 3])
//     gain      linear multiplier on the portal radiance (default 1)
//     zoom      how much of the portal the lens shows (default 1 = nearly all of it; 1.6 = its middle)
//     portalDepth  null | THREE.Texture: a 'graded' portal of the same frame (its alpha is linear view depth).
//               At fill = 1 the drop then writes that depth into the depth buffer (the caller's camera.far
//               must exceed it), so that an INK pass after it bleeds, mists and draws its line as the
//               portal's own shot does (X6: with it the hand-off is exact; without it the edges differ)
//     envTop / envBottom  [r, g, b] linear: what the rim reflects (sky above, ground below)
//     impression  0 | 1 | 2  when there is NO portal: 0 = a plain refraction of envTop/envBottom,
//               1 = a small ink city (towers in mist, one lit window), 2 = a meadow at golden hour.
//               Stand-ins only (SCRIPT.md 8.3); a portal always wins
//   dispose()

import * as THREE from 'three';
import { HASH } from './glsl/noise.js';

const VERT = /* glsl */ `
uniform float uWobble, uTime;
varying vec3 vNv; varying vec3 vW; varying vec3 vNw;
void main() {
  vec3 p = position, n = normal;
  if (uWobble > 0.0) {
    float q = uWobble * (0.05 * sin(uTime * 23.0) * (n.y * n.y - 0.33) + 0.03 * sin(uTime * 37.0 + 1.0) * n.x * n.y);
    p += n * q * length(position);
  }
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vNw = normalize(mat3(modelMatrix) * n);
  vNv = normalize(mat3(viewMatrix) * vNw);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = HASH + /* glsl */ `
uniform sampler2D tPortal; uniform sampler2D tPortalDepth;
uniform float uHasPortal, uFill, uGain, uAspect, uLinear, uZoom, uImpression, uPortalDepth;
uniform vec2 uRes; uniform vec3 uLightDir, uLightColor, uEnvTop, uEnvBottom;
uniform mat4 projectionMatrix;
varying vec3 vNv; varying vec3 vW; varying vec3 vNw;
vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
// stand-ins when no portal is given (uv: 0..1, y up)
vec3 impression(vec2 uv) {
  if (uImpression < 0.5) return mix(uEnvBottom, uEnvTop, smoothstep(0.35, 0.65, uv.y));
  if (uImpression < 1.5) {
    // an ink city: paper, three planes of towers in mist, one window left bare
    vec3 paper = vec3(0.47, 0.44, 0.38);
    float d = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i), sc = 9.0 + 7.0 * fi, x = uv.x * sc + fi * 3.7;
      float h = 0.2 + 0.16 * fi + 0.36 * hash11(floor(x) + fi * 17.0) * (0.5 + 0.5 * hash11(floor(x * 0.33) + 5.0));
      float tower = step(uv.y, h) * step(0.08, fract(x));
      d = max(d, tower * (0.3 + 0.28 * fi) * smoothstep(0.02, 0.25 + 0.1 * fi, uv.y + 0.08));
    }
    vec3 c = paper * exp(-d * vec3(3.0, 3.1, 3.2));
    c = mix(c, paper * 1.9, smoothstep(0.012, 0.004, length((uv - vec2(0.56, 0.36)) * vec2(1.0, 0.6))));
    return c * 0.55;
  }
  vec3 sky = mix(vec3(1.0, 0.55, 0.22), vec3(0.2, 0.3, 0.55), smoothstep(0.5, 1.0, uv.y));
  vec3 land = mix(vec3(0.12, 0.2, 0.04), vec3(0.75, 0.5, 0.12), smoothstep(0.1, 0.5, uv.y) * (0.6 + 0.4 * hash12(floor(uv * 60.0))));
  return mix(land, sky, smoothstep(0.49, 0.52, uv.y)) + vec3(1.0, 0.6, 0.25) * 2.0 * exp(-dot(uv - vec2(0.3, 0.54), uv - vec2(0.3, 0.54)) * 90.0);
}
void main() {
  vec3 N = normalize(vNv);
  vec2 screen = gl_FragCoord.xy / uRes;
  // the lens: the view-space normal picks the point of the image. It is upside down with respect to
  // the world's up as the camera sees it, and the ball compresses the scene toward the rim (barrel).
  vec2 upv = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
  upv = length(upv) > 1e-4 ? normalize(upv) : vec2(0.0, 1.0);
  vec2 q = vec2(dot(N.xy, vec2(upv.y, -upv.x)), dot(N.xy, upv));       // normal in world-up-aligned screen axes
  float r = length(q);
  vec2 img = -q * (1.0 + 0.55 * r * r) / 1.55;                           // inverted, barrel
  vec2 lens = 0.5 + vec2(img.x / max(uAspect, 1.0), img.y) * (0.49 / uZoom);   // the central square of the (2 : 1) portal
  vec2 uv = mix(lens, screen, uFill);
  vec3 col;
  gl_FragDepth = gl_FragCoord.z;
  if (uHasPortal > 0.5) {
    vec4 c = texture(tPortal, uv);
    col = (uLinear > 0.5 ? c.rgb : srgbToLinear(clamp(c.rgb, 0.0, 1.0))) * uGain;
    // at the hand-off the frame also takes the portal's DEPTH (the alpha of its 'graded' frame = linear view
    // depth), so that the caller's INK pass (mist, bleed, line) reads what the portal's own shot would
    if (uPortalDepth > 0.5 && uFill >= 1.0) {
      float z = max(texture(tPortalDepth, uv).a, 1e-4);
      gl_FragDepth = clamp((-projectionMatrix[2][2] + projectionMatrix[3][2] / z) * 0.5 + 0.5, 0.0, 1.0);
    }
  } else col = impression(clamp(uv, 0.0, 1.0)) * uGain;
  float k = 1.0 - uFill;
  if (k > 0.0) {
    vec3 V = normalize(cameraPosition - vW), Nw = normalize(vNw), L = normalize(uLightDir);
    float nv = max(dot(Nw, V), 0.0);
    // the rim: total internal reflection darkens it, then the surface mirrors sky above and ground below
    float rim = smoothstep(0.72, 0.99, r);
    vec3 R = reflect(-V, Nw);
    vec3 env = mix(uEnvBottom, uEnvTop, smoothstep(-0.25, 0.35, R.y));
    float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
    vec3 lit = col * (1.0 - 0.7 * rim * rim);
    lit = mix(lit, env, clamp(fres * 1.4, 0.0, 1.0));
    // the light gathered on the side away from the lamp, just inside the rim
    vec3 Lv = normalize(mat3(viewMatrix) * L);
    vec2 cp = N.xy + Lv.xy * 0.62;
    lit += uLightColor * 0.22 * exp(-dot(cp, cp) * 7.0) * smoothstep(1.0, 0.75, r);
    // the window highlight: a small soft square of the lamp, and its faint twin from the far surface
    vec3 H = normalize(V + L);
    vec3 hl = normalize(mat3(viewMatrix) * (Nw - H));
    float win = smoothstep(0.085, 0.045, max(abs(hl.x), abs(hl.y) * 1.4)) * step(0.0, dot(Nw, H));
    lit += uLightColor * (6.0 * win + 0.25 * pow(max(dot(Nw, H), 0.0), 60.0));
    vec2 tw = N.xy - Lv.xy * 0.5;
    lit += uLightColor * 0.5 * exp(-dot(tw, tw) * 160.0);
    col = mix(col, lit, k);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createDrop({ radius = 1, segments = 64 } = {}) {
  const geo = new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.75));
  const uniforms = {
    tPortal: { value: null }, tPortalDepth: { value: null }, uHasPortal: { value: 0 }, uFill: { value: 0 }, uGain: { value: 1 }, uLinear: { value: 0 }, uZoom: { value: 1 }, uImpression: { value: 0 }, uPortalDepth: { value: 0 },
    uAspect: { value: 2 }, uRes: { value: new THREE.Vector2(2160, 1080) }, uWobble: { value: 0 }, uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightColor: { value: new THREE.Vector3(3, 3, 3) },
    uEnvTop: { value: new THREE.Vector3(0.6, 0.7, 0.9) }, uEnvBottom: { value: new THREE.Vector3(0.08, 0.12, 0.04) },
  };
  const mat = new THREE.ShaderMaterial({ name: 'drop', uniforms, vertexShader: VERT, fragmentShader: FRAG });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'drop';
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    if (rt) uniforms.uRes.value.set(rt.width, rt.height); else uniforms.uRes.value.copy(renderer.getDrawingBufferSize(size));
  };
  return {
    mesh, uniforms,
    set(s = {}) {
      if ('portal' in s) {
        uniforms.tPortal.value = s.portal || null;
        uniforms.uHasPortal.value = s.portal ? 1 : 0;
        uniforms.uLinear.value = s.portal && s.portal.userData && s.portal.userData.stage === 'hdr' ? 1 : 0;
        const img = s.portal && s.portal.image;
        if (img && img.width && img.height) uniforms.uAspect.value = img.width / img.height;
      }
      if (s.fill !== undefined) uniforms.uFill.value = Math.min(1, Math.max(0, s.fill));
      if (s.gain !== undefined) uniforms.uGain.value = s.gain;
      if (s.zoom !== undefined) uniforms.uZoom.value = s.zoom;
      if (s.portalDepth !== undefined) { uniforms.tPortalDepth.value = s.portalDepth || null; uniforms.uPortalDepth.value = s.portalDepth ? 1 : 0; }
      if (s.wobble !== undefined) uniforms.uWobble.value = s.wobble;
      if (s.time !== undefined) uniforms.uTime.value = s.time;
      if (s.impression !== undefined) uniforms.uImpression.value = s.impression;
      if (s.lightDir) uniforms.uLightDir.value.fromArray(s.lightDir).normalize();
      if (s.lightColor) uniforms.uLightColor.value.fromArray(s.lightColor);
      if (s.envTop) uniforms.uEnvTop.value.fromArray(s.envTop);
      if (s.envBottom) uniforms.uEnvBottom.value.fromArray(s.envBottom);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
