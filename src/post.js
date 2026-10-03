// Post-processing chain.
//
// Per shot (run once per visible shot; twice during a dissolve):
//   scene  -> HDR RGBA16F target, MSAA x4, depth texture, scissored to the letterbox picture area
//          -> [depth of field: CoC + golden-angle gather at half res + full-res combine]
//          -> bloom: 13-tap Karis downsample mip chain (6 levels) + tent upsample with "scatter"
//          -> grade: lateral chromatic aberration, bloom mix, halation, exposure, white balance,
//             tint, ACES (fitted) tone map, sRGB encode, lift/gamma/gain, contrast, saturation,
//             split toning, vignette  -> display-referred RGBA16F "graded" target
// Per frame (once):
//   final  -> mix graded A/B (dissolve), fade to colour, title cards (premultiplied, inside the chain),
//             film grain (seeded by frame index), 2.39:1 letterbox, triangular dither -> canvas
//
// Shutter accumulation (offline --samples N, see Engine.renderAt): the scene + DOF stage
// (renderScene) runs once per sub-frame and each result is summed into an RGBA32F accumulator
// (accumulate); the average is resolved to RGBA16F and bloom + grade (gradeShot) run once on it.
// With one sample, renderShot = renderScene + gradeShot, exactly as before.
//
// All pixel-sized parameters are in 1080p pixels and scale with the output resolution.

import * as THREE from 'three';
import { HASH, COMMON } from './lib/glsl/noise.js';
import { REF_HEIGHT } from './config.js';

/**
 * Objects on this layer (`mesh.layers.set(FX_LAYER)`) are excluded from depth of field and drawn
 * sharp on top of the DOF result, still depth-tested against the scene. Use it for additive
 * particles / glows that do not write depth (otherwise DOF would blur them with the background).
 * Without DOF they render normally in the main pass.
 */
export const FX_LAYER = 1;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc; varying vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, 1.0); }`;

// Shutter accumulation: sum = (first ? 0 : sum) + sub-frame, written as sum * uScale (1, or 1/N on
// the last sub-frame, which resolves the average into an RGBA16F target). texelFetch: exact texels,
// no filtering of the float32 accumulator needed.
const ACCUM_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tAcc; uniform float uFirst; uniform float uScale;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(tSrc, p, 0).rgb;
  if (uFirst < 0.5) c += texelFetch(tAcc, p, 0).rgb;
  gl_FragColor = vec4(c * uScale, 1.0);
}`;

/** Defaults for every shot. Override per world (world.post) and per shot (shot.post). */
export const DEFAULT_POST = {
  exposure: 0,                 // EV
  temperature: 0,              // -1 cool .. +1 warm (white balance)
  tintGM: 0,                   // -1 green .. +1 magenta
  tint: [1, 1, 1],             // linear RGB multiplier (pre tone map)
  lift: [0.012, 0.012, 0.016], // display-space shadows offset
  gamma: [1, 1, 1],            // display-space midtones (>1 brighter)
  gain: [1, 1, 1],             // display-space highlights
  contrast: 1.04,
  saturation: 0.96,
  splitShadows: [0.45, 0.55, 0.62], // split-toning hue for shadows (a colour; only its chroma matters)
  splitHighlights: [0.62, 0.55, 0.45],
  splitAmount: 0.0,            // 0..1
  bloom: 0.045,                // mix amount of the bloom mip chain (0 disables the passes)
  bloomScatter: 0.68,          // 0..1 larger = wider, softer bloom
  halation: 0.12,              // reddish glow around bright highlights
  vignette: 0.32,              // 0..1
  vignetteSoftness: 0.5,       // 0..1
  chromaticAberration: 0.6,    // px at the picture corners
  grain: 0.035,                // amplitude in display space
  grainSize: 1.3,              // px
  letterbox: 2.39,             // picture aspect; 0 or false = full 16:9 frame
  dof: null,                   // { focus: world units, aperture: 0..2, maxBlur: px (default 18) }
};

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsMaterial(name, fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    name, uniforms, vertexShader: FS_VERT, fragmentShader,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, ...extra,
  });
}

// ----------------------------------------------------------------------------- bloom
const DOWN_FRAG = COMMON + /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris;
varying vec2 vUv;
vec3 S(float x, float y) { return texture(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
float kw(vec3 c) { return 1.0 / (1.0 + luma(c)); }
void main() {
  vec3 a = S(-2., 2.), b = S(0., 2.), c = S(2., 2.);
  vec3 d = S(-2., 0.), e = S(0., 0.), f = S(2., 0.);
  vec3 g = S(-2., -2.), h = S(0., -2.), i = S(2., -2.);
  vec3 j = S(-1., 1.), k = S(1., 1.), l = S(-1., -1.), m = S(1., -1.);
  vec3 col;
  if (uKaris > 0.5) {
    vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
    float w0 = 0.5 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.125 * kw(g4);
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(clamp(col, 0.0, 30000.0), 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScatter;
varying vec2 vUv;
vec3 S(float x, float y) { return texture(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 col = S(0., 0.) * 4.0 + (S(0., 1.) + S(-1., 0.) + S(1., 0.) + S(0., -1.)) * 2.0
           + S(-1., 1.) + S(1., 1.) + S(-1., -1.) + S(1., -1.);
  col *= 1.0 / 16.0;
  // blended as dst = src + dst * (1 - a)  ->  lerp(fine, coarse, scatter)
  gl_FragColor = vec4(col * uScatter, uScatter);
}`;

// ----------------------------------------------------------------------------- depth of field
const DOF_COMMON = /* glsl */ `
uniform float uNear, uFar, uFocus, uAperture;
float viewDepth(float d) { return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
float cocOf(float d) { float z = viewDepth(d); return clamp(uAperture * (z - uFocus) / max(z, 1e-4), -1.0, 1.0); }
`;
const DOF_PREP_FRAG = DOF_COMMON + /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture(tColor, vUv).rgb; // bilinear at a 2x2 block centre = box average
  float d0 = texture(tDepth, vUv + uTexel * vec2(-0.5, -0.5)).r;
  float d1 = texture(tDepth, vUv + uTexel * vec2(0.5, -0.5)).r;
  float d2 = texture(tDepth, vUv + uTexel * vec2(-0.5, 0.5)).r;
  float d3 = texture(tDepth, vUv + uTexel * vec2(0.5, 0.5)).r;
  float d = min(min(d0, d1), min(d2, d3)); // nearest wins: foreground spreads over its edges
  gl_FragColor = vec4(min(c, vec3(200.0)), cocOf(d));
}`;
const DOF_GATHER_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uMaxBlur; uniform float uRadScale;
varying vec2 vUv;
const float GOLDEN_ANGLE = 2.39996323;
void main() {
  vec4 center = texture(tSrc, vUv);
  float centerSize = abs(center.a) * uMaxBlur;
  vec3 color = center.rgb;
  float tot = 1.0;
  float radius = uRadScale;
  float ang = 0.0;
  for (int i = 0; i < 4096; i++) { // radius^2 grows ~1.5 per tap: 512 taps = 27 px, 4096 = 78 px (4K)
    if (radius >= uMaxBlur) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec4 s = texture(tSrc, tc);
    float sampleSize = abs(s.a) * uMaxBlur;
    if (s.a > center.a) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
    color += mix(color / tot, s.rgb, m);
    tot += 1.0;
    radius += uRadScale / radius;
    ang += GOLDEN_ANGLE;
  }
  gl_FragColor = vec4(color / tot, center.a);
}`;
const DOF_COMBINE_FRAG = DOF_COMMON + /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBlur; uniform float uMaxBlurFull;
varying vec2 vUv;
void main() {
  vec3 sharp = texture(tColor, vUv).rgb;
  vec4 blur = texture(tBlur, vUv);
  float coc = abs(cocOf(texture(tDepth, vUv).r)) * uMaxBlurFull;
  float cocB = abs(blur.a) * uMaxBlurFull;
  float k = smoothstep(0.6, 2.5, max(coc, cocB * 0.85));
  gl_FragColor = vec4(mix(sharp, blur.rgb, k), 1.0);
}`;

// ----------------------------------------------------------------------------- grade
const GRADE_FRAG = COMMON + /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform vec2 uRes; uniform vec2 uBloomTexel;
uniform float uBloom, uHalation, uExposure, uCA, uContrast, uSaturation, uSplit, uVignette, uVigSoft, uPicFrac, uRefScale;
uniform vec3 uWB, uTint, uLift, uGamma, uGain, uSplitS, uSplitH;
varying vec2 vUv;

// Stephen Hill ACES fit (BakingLab, MIT); see THIRD_PARTY_NOTICES.md.
vec3 aces(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(OUT * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 bloomTap(vec2 uv) {
  // 9-tap tent on the half-res bloom texture for a smooth full-res upsample
  vec2 o = uBloomTexel;
  vec3 s = texture(tBloom, uv).rgb * 4.0;
  s += (texture(tBloom, uv + vec2(o.x, 0)).rgb + texture(tBloom, uv - vec2(o.x, 0)).rgb +
        texture(tBloom, uv + vec2(0, o.y)).rgb + texture(tBloom, uv - vec2(0, o.y)).rgb) * 2.0;
  s += texture(tBloom, uv + o).rgb + texture(tBloom, uv - o).rgb +
       texture(tBloom, uv + vec2(o.x, -o.y)).rgb + texture(tBloom, uv + vec2(-o.x, o.y)).rgb;
  return s / 16.0;
}
void main() {
  vec2 uv = vUv;
  // lateral chromatic aberration, growing with radius^2 (picture space)
  vec2 dPx = (uv - 0.5) * uRes;
  vec2 cornerPx = 0.5 * vec2(uRes.x, uRes.y * uPicFrac);
  float r = length(dPx / cornerPx) * 0.70710678;
  vec2 off = (length(dPx) > 0.5 ? normalize(dPx) : vec2(0.0)) * r * r * uCA * uRefScale / uRes;
  vec3 hdr;
  if (uCA > 0.0) {
    hdr.r = texture(tScene, uv - off).r;
    hdr.g = texture(tScene, uv).g;
    hdr.b = texture(tScene, uv + off).b;
  } else {
    hdr = texture(tScene, uv).rgb;
  }
  if (uBloom > 0.0) {
    vec3 bl = bloomTap(uv);
    hdr = mix(hdr, bl, uBloom);
    hdr += max(bl - 0.6, 0.0) * vec3(1.0, 0.28, 0.08) * uHalation;
  }
  hdr *= exp2(uExposure) * uWB * uTint / 0.6;
  vec3 c = toSRGB(aces(hdr));
  // lift / gamma / gain (display space)
  c = c * uGain + uLift * (1.0 - c);
  c = pow(max(c, vec3(0.0)), 1.0 / max(uGamma, vec3(0.01)));
  // contrast around mid grey, saturation
  c = (c - 0.5) * uContrast + 0.5;
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  // split toning (only the chroma of the tint colours is used)
  if (uSplit > 0.0) {
    vec3 sh = uSplitS - luma(uSplitS), hi = uSplitH - luma(uSplitH);
    c += uSplit * (sh * (1.0 - smoothstep(0.0, 0.55, l)) + hi * smoothstep(0.45, 1.0, l));
  }
  // vignette (elliptical, picture space)
  if (uVignette > 0.0) {
    vec2 q = (uv - 0.5) * 2.0;
    q.y /= max(uPicFrac, 0.1);
    float rv = length(q * vec2(0.92, 1.0));
    float v = 1.0 - smoothstep(0.3 - 0.25 * uVigSoft, 1.5 + 0.5 * uVigSoft, rv);
    c *= mix(1.0, v, uVignette);
  }
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

// ----------------------------------------------------------------------------- final
const FINAL_FRAG = COMMON + HASH + /* glsl */ `
uniform sampler2D tA; uniform sampler2D tB; uniform sampler2D tTitles;
uniform float uMix, uFade, uTitles, uGrain, uGrainSize, uLetterbox, uDither;
uniform vec3 uFadeColor;
uniform vec2 uRes;
uniform float uFrame;
varying vec2 vUv;

float grainNoise(vec2 p, uint seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  uvec2 c = uvec2(ivec2(i) + 4096);
  float a = hashu12(c ^ uvec2(seed, seed * 3u));
  float b = hashu12((c + uvec2(1u, 0u)) ^ uvec2(seed, seed * 3u));
  float d = hashu12((c + uvec2(0u, 1u)) ^ uvec2(seed, seed * 3u));
  float e = hashu12((c + uvec2(1u, 1u)) ^ uvec2(seed, seed * 3u));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
void main() {
  vec3 c = texture(tA, vUv).rgb;
  if (uMix > 0.0) c = mix(c, texture(tB, vUv).rgb, uMix);
  c = mix(c, uFadeColor, uFade);
  if (uTitles > 0.5) {
    vec4 tt = texture(tTitles, vUv);
    c = c * (1.0 - tt.a) + tt.rgb;
  }
  vec2 px = gl_FragCoord.xy;
  uint fr = uint(uFrame) * 2654435761u + 12345u;
  if (uGrain > 0.0) {
    vec2 p = px / max(uGrainSize, 0.25);
    float n = grainNoise(p, fr) * 0.62 + grainNoise(p * 1.93 + 37.0, fr ^ 0x9e37u) * 0.38;
    n = (n - 0.5) * 2.6;
    vec3 chroma = vec3(grainNoise(p * 0.9 + 11.0, fr ^ 0x51u), grainNoise(p * 0.9 + 23.0, fr ^ 0xa3u), grainNoise(p * 0.9 + 47.0, fr ^ 0xf7u)) - 0.5;
    float l = luma(c);
    float resp = (0.55 + 0.45 * smoothstep(0.0, 0.25, l)) * (1.0 - 0.7 * smoothstep(0.6, 1.0, l));
    c += (n + chroma * 0.5) * uGrain * resp;
  }
  float mask = 1.0;
  if (uLetterbox > 0.0) {
    float picH = min(uRes.x / uLetterbox, uRes.y);
    float bar = (uRes.y - picH) * 0.5;
    mask = smoothstep(bar - 0.5, bar + 0.5, px.y) * smoothstep(bar - 0.5, bar + 0.5, uRes.y - px.y);
  }
  c *= mask;
  if (uDither > 0.0) {
    float d = hashu12(uvec2(px) ^ uvec2(fr, fr >> 7)) + hashu12(uvec2(px) + uvec2(7919u, 104729u) ^ uvec2(fr >> 3, fr)) - 1.0;
    c += d * mask / 255.0;
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// ----------------------------------------------------------------------------- capture (yuv420p)
// Packs the final RGBA8 frame into planar BT.709 limited-range YUV 4:2:0 bytes, laid out exactly as
// ffmpeg's rawvideo yuv420p expects (Y plane, then U, then V; top row first) in an RGBA8 target of
// (W/4) x (H*3/2). Reading it back gives 1.5 bytes/pixel instead of 4 and needs no vflip/swscale.
const PACK_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uSize;
float yOf(vec3 c) { return (16.0 + 219.0 * dot(c, vec3(0.2126, 0.7152, 0.0722))) / 255.0; }
float uOf(vec3 c) { return (128.0 + 224.0 * dot(c, vec3(-0.114572, -0.385428, 0.5))) / 255.0; }
float vOf(vec3 c) { return (128.0 + 224.0 * dot(c, vec3(0.5, -0.454153, -0.045847))) / 255.0; }
void main() {
  float W = uSize.x, H = uSize.y;
  vec2 fc = floor(gl_FragCoord.xy);
  vec4 o;
  if (fc.y < H) {
    int sy = int(H) - 1 - int(fc.y);
    for (int k = 0; k < 4; k++) {
      vec3 c = texelFetch(tSrc, ivec2(int(fc.x) * 4 + k, sy), 0).rgb;
      o[k] = yOf(c);
    }
  } else {
    float r = fc.y - H;
    bool isV = r >= H * 0.25;
    if (isV) r -= H * 0.25;
    for (int k = 0; k < 4; k++) {
      float b = fc.x * 4.0 + float(k);
      float half_ = W * 0.5;
      float crow = 2.0 * r + (b >= half_ ? 1.0 : 0.0);
      float ccol = b >= half_ ? b - half_ : b;
      // bilinear tap at the shared corner of the 2x2 block = box average
      vec2 uv = vec2((2.0 * ccol + 1.0) / W, 1.0 - (2.0 * crow + 1.0) / H);
      vec3 c = texture(tSrc, uv).rgb;
      o[k] = isV ? vOf(c) : uOf(c);
    }
  }
  gl_FragColor = o;
}`;

/** Simple luminance-preserving white balance gains. */
export function whiteBalance(temperature = 0, tintGM = 0) {
  const r = 1 + 0.16 * temperature + 0.04 * tintGM;
  const g = 1 - 0.06 * tintGM;
  const b = 1 - 0.22 * temperature + 0.04 * tintGM;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / l, g / l, b / l];
}

const v3 = (a) => (Array.isArray(a) ? new THREE.Vector3(a[0], a[1], a[2]) : new THREE.Vector3(a, a, a));

export class PostChain {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{width:number, height:number, msaa?:number, bloomLevels?:number}} opts
   */
  constructor(renderer, { width, height, msaa = 4, bloomLevels = 6 }) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.refScale = height / REF_HEIGHT;

    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(width, height, { ...hdr, depthBuffer: true, samples: msaa, depthTexture });
    this.sceneRT.texture.name = 'scene';
    this.dofOutRT = new THREE.WebGLRenderTarget(width, height, hdr);
    const hw = Math.max(1, width >> 1), hh = Math.max(1, height >> 1);
    this.dofA = new THREE.WebGLRenderTarget(hw, hh, hdr);
    this.dofB = new THREE.WebGLRenderTarget(hw, hh, hdr);
    this.graded = [new THREE.WebGLRenderTarget(width, height, hdr), new THREE.WebGLRenderTarget(width, height, hdr)];
    // Bloom width must not depend on resolution. Above 1080p, extra pre-downsample levels keep the
    // levels that are blurred and composited at 1080p-equivalent sizes (4K: 1920 -> 960 ... 30, the
    // grade reads the 960 level), so bloom spreads over the same fraction of the frame as at 1080p.
    this.bloomBase = this.refScale > 1 ? Math.max(0, Math.round(Math.log2(this.refScale))) : 0;
    this.mips = [];
    for (let i = 0, w = width, h = height; i < bloomLevels + this.bloomBase; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.mips.push(new THREE.WebGLRenderTarget(w, h, hdr));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.down = fsMaterial('bloom-down', DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
    this.up = fsMaterial('bloom-up', UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.7 } }, {
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const dofU = () => ({ uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 10 }, uAperture: { value: 1 } });
    this.dofPrep = fsMaterial('dof-prep', DOF_PREP_FRAG, { ...dofU(), tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.dofGather = fsMaterial('dof-gather', DOF_GATHER_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxBlur: { value: 9 }, uRadScale: { value: 0.75 } });
    this.dofCombine = fsMaterial('dof-combine', DOF_COMBINE_FRAG, { ...dofU(), tColor: { value: null }, tDepth: { value: null }, tBlur: { value: null }, uMaxBlurFull: { value: 18 } });
    this.grade = fsMaterial('grade', GRADE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2(width, height) }, uBloomTexel: { value: new THREE.Vector2() },
      uBloom: { value: 0 }, uHalation: { value: 0 }, uExposure: { value: 0 }, uCA: { value: 0 }, uContrast: { value: 1 }, uSaturation: { value: 1 },
      uSplit: { value: 0 }, uVignette: { value: 0 }, uVigSoft: { value: 0.5 }, uPicFrac: { value: 1 }, uRefScale: { value: this.refScale },
      uWB: { value: new THREE.Vector3(1, 1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3() },
      uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSplitS: { value: new THREE.Vector3() }, uSplitH: { value: new THREE.Vector3() },
    });
    this.copy = fsMaterial('copy', COPY_FRAG, { tSrc: { value: null } });
    this.final = fsMaterial('final', FINAL_FRAG, {
      tA: { value: null }, tB: { value: null }, tTitles: { value: null },
      uMix: { value: 0 }, uFade: { value: 0 }, uTitles: { value: 0 }, uGrain: { value: 0 }, uGrainSize: { value: 1 },
      uLetterbox: { value: 0 }, uDither: { value: 1 }, uFadeColor: { value: new THREE.Vector3() },
      uRes: { value: new THREE.Vector2(width, height) }, uFrame: { value: 0 },
    });
    this.emptyScene = new THREE.Scene();
    this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.blackTex.needsUpdate = true;
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.quadCam);
  }

  /** Fraction of the frame height covered by the picture for a given letterbox aspect. */
  pictureFrac(letterbox) {
    if (!letterbox || letterbox <= 0) return 1;
    return Math.min(1, (this.width / letterbox) / this.height);
  }

  /**
   * Render one shot into graded[slot].
   * @param {number} slot 0|1
   * @param {{scene:THREE.Scene, camera:THREE.Camera, render?:Function}} world
   * @param {object} p resolved post settings (DEFAULT_POST shape)
   */
  renderShot(slot, world, p) {
    this.gradeShot(slot, this.renderScene(world, p), p);
  }

  /**
   * Scene + depth of field (+ FX layer): returns the linear HDR texture of the shot (valid until
   * the next renderScene call).
   */
  renderScene(world, p) {
    const r = this.renderer;
    const W = this.width, H = this.height;
    const picFrac = this.pictureFrac(p.letterbox);
    const picH = Math.min(H, Math.ceil(H * picFrac) + 2);
    const y0 = Math.max(0, Math.floor((H - picH) / 2));

    // 1. scene -> HDR (clear everything, then draw only inside the picture area)
    const cam = world.camera;
    const dofOn = !!(p.dof && (p.dof.aperture ?? 1) > 0);
    const savedMask = cam.layers.mask;
    if (dofOn) cam.layers.disable(FX_LAYER); else cam.layers.enable(FX_LAYER);
    const rt = this.sceneRT;
    rt.scissorTest = false;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    rt.scissor.set(0, y0, W, picH);
    rt.scissorTest = picH < H;
    r.setRenderTarget(rt);
    if (world.render) world.render(r, rt, cam);
    else r.render(world.scene, cam);
    if (rt.scissorTest) {
      // The MSAA resolve (blitFramebuffer) honours the scissor, which would leave stale pixels in
      // the bars of the resolved texture (and bloom would spread them into the picture). Resolve
      // again unscissored: an empty render triggers three's resolve of the whole target.
      rt.scissorTest = false;
      r.setRenderTarget(rt);
      r.render(this.emptyScene, cam);
    }

    let src = rt.texture;

    // 2. depth of field
    if (dofOn) {
      const maxBlurFull = (p.dof.maxBlur ?? 18) * this.refScale;
      for (const m of [this.dofPrep, this.dofCombine]) {
        m.uniforms.uNear.value = cam.near;
        m.uniforms.uFar.value = cam.far;
        m.uniforms.uFocus.value = p.dof.focus ?? 10;
        m.uniforms.uAperture.value = p.dof.aperture ?? 1;
      }
      this.dofPrep.uniforms.tColor.value = src;
      this.dofPrep.uniforms.tDepth.value = rt.depthTexture;
      this.dofPrep.uniforms.uTexel.value.set(1 / W, 1 / H);
      this._pass(this.dofPrep, this.dofA);
      this.dofGather.uniforms.tSrc.value = this.dofA.texture;
      this.dofGather.uniforms.uTexel.value.set(1 / this.dofA.width, 1 / this.dofA.height);
      this.dofGather.uniforms.uMaxBlur.value = Math.max(1, maxBlurFull / 2);
      this._pass(this.dofGather, this.dofB);
      this.dofCombine.uniforms.tColor.value = src;
      this.dofCombine.uniforms.tDepth.value = rt.depthTexture;
      this.dofCombine.uniforms.tBlur.value = this.dofB.texture;
      this.dofCombine.uniforms.uMaxBlurFull.value = maxBlurFull;
      this._pass(this.dofCombine, this.dofOutRT);
      src = this.dofOutRT.texture;

      // FX layer: copy the DOF result back into the MSAA scene target (whose depth buffer still
      // holds the scene) and draw FX objects sharp on top, depth-tested.
      if (!world.render) {
        cam.layers.set(FX_LAYER);
        this.copy.uniforms.tSrc.value = this.dofOutRT.texture;
        this._pass(this.copy, rt);
        r.setRenderTarget(rt);
        const bg = world.scene.background;
        world.scene.background = null; // a background would clear the target
        r.render(world.scene, cam);
        world.scene.background = bg;
        src = rt.texture;
      }
    }
    cam.layers.mask = savedMask;
    return src;
  }

  /**
   * Shutter accumulation. Call with each sub-frame's renderScene() result, k = 0 .. n-1. Sums in
   * RGBA32F; the last call writes the average to an RGBA16F target and returns its texture (pass
   * it to gradeShot). Returns null before the last sub-frame.
   */
  accumulate(src, k, n) {
    if (!this.accRT) {
      const float32 = this.renderer.extensions.has('EXT_color_buffer_float');
      if (!float32) console.warn('[post] EXT_color_buffer_float unavailable: shutter accumulation falls back to RGBA16F');
      const o = { type: float32 ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
      this.accRT = [new THREE.WebGLRenderTarget(this.width, this.height, o), new THREE.WebGLRenderTarget(this.width, this.height, o)];
      this.accOutRT = new THREE.WebGLRenderTarget(this.width, this.height, { ...o, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.accum = fsMaterial('accumulate', ACCUM_FRAG, { tSrc: { value: null }, tAcc: { value: null }, uFirst: { value: 1 }, uScale: { value: 1 } });
    }
    const last = k === n - 1;
    const u = this.accum.uniforms;
    u.tSrc.value = src;
    u.tAcc.value = k > 0 ? this.accRT[(k - 1) & 1].texture : src;
    u.uFirst.value = k > 0 ? 0 : 1;
    u.uScale.value = last ? 1 / n : 1;
    this._pass(this.accum, last ? this.accOutRT : this.accRT[k & 1]);
    return last ? this.accOutRT.texture : null;
  }

  /** Bloom + grade of a linear HDR texture (renderScene or accumulate output) into graded[slot]. */
  gradeShot(slot, src, p) {
    const W = this.width, H = this.height;
    const picFrac = this.pictureFrac(p.letterbox);

    // 3. bloom
    const bloomOn = p.bloom > 0 || p.halation > 0;
    if (bloomOn) {
      let prev = src, pw = W, ph = H;
      for (let i = 0; i < this.mips.length; i++) {
        this.down.uniforms.tSrc.value = prev;
        this.down.uniforms.uTexel.value.set(1 / pw, 1 / ph);
        this.down.uniforms.uKaris.value = i === 0 ? 1 : 0;
        this._pass(this.down, this.mips[i]);
        prev = this.mips[i].texture; pw = this.mips[i].width; ph = this.mips[i].height;
      }
      this.up.uniforms.uScatter.value = p.bloomScatter;
      for (let i = this.mips.length - 1; i > this.bloomBase; i--) {
        const s = this.mips[i];
        this.up.uniforms.tSrc.value = s.texture;
        this.up.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
        this._pass(this.up, this.mips[i - 1]);
      }
    }

    // 4. grade -> graded[slot]
    const g = this.grade.uniforms;
    g.tScene.value = src;
    const bl = this.mips[this.bloomBase];
    g.tBloom.value = bloomOn ? bl.texture : this.blackTex;
    g.uBloomTexel.value.set(1 / bl.width, 1 / bl.height);
    g.uBloom.value = p.bloom;
    g.uHalation.value = p.halation;
    g.uExposure.value = p.exposure;
    g.uCA.value = p.chromaticAberration;
    g.uContrast.value = p.contrast;
    g.uSaturation.value = p.saturation;
    g.uSplit.value = p.splitAmount;
    g.uVignette.value = p.vignette;
    g.uVigSoft.value = p.vignetteSoftness;
    g.uPicFrac.value = picFrac;
    g.uWB.value.fromArray(whiteBalance(p.temperature, p.tintGM));
    g.uTint.value.copy(v3(p.tint));
    g.uLift.value.copy(v3(p.lift));
    g.uGamma.value.copy(v3(p.gamma));
    g.uGain.value.copy(v3(p.gain));
    g.uSplitS.value.copy(v3(p.splitShadows));
    g.uSplitH.value.copy(v3(p.splitHighlights));
    this._pass(this.grade, this.graded[slot]);
  }

  /**
   * Composite the final frame to `target` (null = canvas).
   * @param {{mix:number, fade:number, fadeColor:number[], titles:THREE.Texture|null, grain:number,
   *          grainSize:number, letterbox:number, frame:number, slots:number}} f
   */
  renderFinal(target, f) {
    const u = this.final.uniforms;
    u.tA.value = f.slots > 0 ? this.graded[0].texture : this.blackTex;
    u.tB.value = f.slots > 1 ? this.graded[1].texture : this.blackTex;
    u.uMix.value = f.slots > 1 ? f.mix : 0;
    u.uFade.value = f.fade || 0;
    u.uFadeColor.value.fromArray(f.fadeColor || [0, 0, 0]);
    u.tTitles.value = f.titles || this.blackTex;
    u.uTitles.value = f.titles ? 1 : 0;
    u.uGrain.value = f.grain;
    u.uGrainSize.value = f.grainSize * this.refScale;
    u.uLetterbox.value = f.letterbox || 0;
    u.uFrame.value = f.frame;
    this._pass(this.final, target);
  }

  /**
   * Capture helpers (offline): render the final frame into an RGBA8 target, then either read it
   * back as RGBA (bottom-up) or pack it to yuv420p on the GPU and read that (top-down planar).
   */
  captureTarget() {
    if (!this.outRT) {
      const o = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
      this.outRT = new THREE.WebGLRenderTarget(this.width, this.height, o);
      this.packRT = new THREE.WebGLRenderTarget(this.width / 4, (this.height * 3) / 2, { ...o, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.pack = fsMaterial('pack-yuv', PACK_FRAG, { tSrc: { value: null }, uSize: { value: new THREE.Vector2(this.width, this.height) } });
    }
    return this.outRT;
  }

  /** Pack outRT to yuv420p and read it into `buf` (Uint8Array of W*H*1.5). */
  readYUV(buf) {
    this.captureTarget();
    if (this.width % 8 || this.height % 4) throw new Error('yuv capture needs width % 8 == 0 and height % 4 == 0');
    this.pack.uniforms.tSrc.value = this.outRT.texture;
    this._pass(this.pack, this.packRT);
    this.renderer.readRenderTargetPixels(this.packRT, 0, 0, this.packRT.width, this.packRT.height, buf);
    return buf;
  }

  /** Read outRT as RGBA bytes (bottom-up rows) into `buf` (Uint8Array of W*H*4). */
  readRGBA(buf) {
    this.renderer.readRenderTargetPixels(this.captureTarget(), 0, 0, this.width, this.height, buf);
    return buf;
  }

  /**
   * Asynchronous variant (PBO + fence): queues the readback and resolves when the GPU is done, so
   * the next frame can render meanwhile. Sync readback costs ~13 ms per 1080p frame in Chrome;
   * pipelined async hides it completely. format: 'yuv' | 'rgba'.
   */
  readAsync(buf, format = 'yuv') {
    this.captureTarget();
    if (format === 'yuv') {
      this.pack.uniforms.tSrc.value = this.outRT.texture;
      this._pass(this.pack, this.packRT);
      return this.renderer.readRenderTargetPixelsAsync(this.packRT, 0, 0, this.packRT.width, this.packRT.height, buf);
    }
    return this.renderer.readRenderTargetPixelsAsync(this.outRT, 0, 0, this.width, this.height, buf);
  }

  /** Compile all post shaders (call once at startup to avoid a first-frame hitch). */
  warmup() {
    const r = this.renderer;
    const tmp = new THREE.Scene();
    for (const m of [this.down, this.up, this.dofPrep, this.dofGather, this.dofCombine, this.grade, this.final, this.copy]) {
      const q = new THREE.Mesh(this.quad.geometry, m);
      q.frustumCulled = false;
      tmp.add(q);
    }
    r.compile(tmp, this.quadCam);
  }

  dispose() {
    for (const t of [this.sceneRT, this.dofOutRT, this.dofA, this.dofB, ...this.graded, ...this.mips, this.outRT, this.packRT, ...(this.accRT || []), this.accOutRT]) t && t.dispose();
    if (this.pack) this.pack.dispose();
    if (this.accum) this.accum.dispose();
    for (const m of [this.down, this.up, this.dofPrep, this.dofGather, this.dofCombine, this.grade, this.final, this.copy]) m.dispose();
    this.quad.geometry.dispose();
    this.blackTex.dispose();
  }
}
