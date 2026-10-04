/*!
 * Simplex noise adapted from https://github.com/ashima/webgl-noise
 * Copyright (C) 2011 by Ashima Arts (Simplex noise)
 * Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */
// GLSL noise library. Every chunk is include-guarded, so concatenating the same chunk twice is safe.
//
//   import { NOISE } from '../lib/glsl/noise.js';
//   fragmentShader: `${NOISE}\n void main(){ float n = fbm(vUv * 4.0, 6); ... }`
//
// Contents
//   COMMON   PI/TAU, saturate(), remap(), luma(), rot2()
//   HASH     hash11 hash12 hash13 hash21 hash22 hash31 hash32 hash33 hash41 (Dave Hoskins, sine-free)
//            pcg(uint), hashu12(uvec2) – integer hashes keyed by absolute frame index
//   NOISE    snoise(vec2|vec3)  simplex, range ~[-1,1]
//            vnoise(vec2|vec3)  value noise [-1,1]
//            fbm(vec2|vec3, octaves), ridged(vec2|vec3, octaves) [0..~1], turbulence(vec3, octaves)
//            curlNoise(vec3) – divergence-free flow field
//            worley(vec2|vec3) -> vec2(F1, F2) cellular distances
//            warp(vec2 p, float amount) – fbm domain warp
//   The JS mirror in src/lib/noise.js reproduces snoise/fbm/ridged on the CPU (camera placement).

export const COMMON = /* glsl */ `
#ifndef FILM_COMMON
#define FILM_COMMON
#ifndef PI
#define PI 3.141592653589793
#endif
#ifndef TAU
#define TAU 6.283185307179586
#endif
#ifndef saturate
#define saturate(a) clamp(a, 0.0, 1.0)
#endif
float remap(float x, float a, float b, float c, float d) { return c + (d - c) * saturate((x - a) / (b - a)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
#endif
`;

// Dave Hoskins hash11–hash42 (Hash without Sine); licenses/ and THIRD_PARTY_NOTICES.md.
export const HASH = /* glsl */ `
#ifndef FILM_HASH
#define FILM_HASH
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash21(float p) { vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash31(float p) { vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
vec4 hash41(float p) { vec4 p4 = fract(vec4(p) * vec4(.1031, .1030, .0973, .1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
vec4 hash42(vec2 p) { vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
// Scalar PCG: Melissa O'Neill, MIT; see THIRD_PARTY_NOTICES.md.
// Use for anything keyed by frame index / large coordinates.
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hashu12(uvec2 p) { return float(pcg(p.x ^ pcg(p.y))) * (1.0 / 4294967296.0); }
#endif
`;

export const NOISE = COMMON + HASH + /* glsl */ `
#ifndef FILM_NOISE
#define FILM_NOISE
// ---- simplex (Ashima Arts / Stefan Gustavson, MIT) ----
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// ---- value noise ----
float vnoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return -1.0 + 2.0 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return -1.0 + 2.0 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
// ---- fractals ----
const mat2 FBM_M2 = mat2(1.6, 1.2, -1.2, 1.6);            // rotate + scale x2
const mat3 FBM_M3 = mat3(0.00, 1.60, 1.20, -1.60, 0.72, -0.96, -1.20, -0.96, 1.28);
float fbm(vec2 p, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 12; i++) { if (i >= octaves) break; s += a * snoise(p); p = FBM_M2 * p; a *= 0.5; }
  return s;
}
float fbm(vec3 p, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 12; i++) { if (i >= octaves) break; s += a * snoise(p); p = FBM_M3 * p; a *= 0.5; }
  return s;
}
// ridged multifractal, roughly [0, 1]
float ridged(vec2 p, int octaves) {
  float s = 0.0, a = 0.5, w = 1.0;
  for (int i = 0; i < 12; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p)); n *= n; n *= w;
    w = saturate(n * 2.0);
    s += n * a; p = FBM_M2 * p; a *= 0.5;
  }
  return s;
}
float ridged(vec3 p, int octaves) {
  float s = 0.0, a = 0.5, w = 1.0;
  for (int i = 0; i < 12; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p)); n *= n; n *= w;
    w = saturate(n * 2.0);
    s += n * a; p = FBM_M3 * p; a *= 0.5;
  }
  return s;
}
float turbulence(vec3 p, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 12; i++) { if (i >= octaves) break; s += a * abs(snoise(p)); p = FBM_M3 * p; a *= 0.5; }
  return s;
}
vec2 warp(vec2 p, float amount) {
  return p + amount * vec2(fbm(p + vec2(1.7, 9.2), 4), fbm(p + vec2(8.3, 2.8), 4));
}

// ---- curl noise (divergence-free) ----
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  vec3 o1 = vec3(31.416, -47.853, 12.679), o2 = vec3(-233.231, -113.141, 51.79);
  float px0 = snoise(p - dy + o2), px1 = snoise(p + dy + o2);   // psi.z
  float py0 = snoise(p - dz + o1), py1 = snoise(p + dz + o1);   // psi.y
  float x = (px1 - px0) - (py1 - py0);
  float qz0 = snoise(p - dz), qz1 = snoise(p + dz);             // psi.x
  float qx0 = snoise(p - dx + o2), qx1 = snoise(p + dx + o2);   // psi.z
  float y = (qz1 - qz0) - (qx1 - qx0);
  float rx0 = snoise(p - dx + o1), rx1 = snoise(p + dx + o1);   // psi.y
  float ry0 = snoise(p - dy), ry1 = snoise(p + dy);             // psi.x
  float z = (rx1 - rx0) - (ry1 - ry0);
  return vec3(x, y, z) / (2.0 * e);
}

// ---- cellular ----
vec2 worley(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float F1 = 8.0, F2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 r = g + hash22(i + g) - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) { F2 = d; }
  }
  return sqrt(vec2(F1, F2));
}
vec2 worley(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float F1 = 8.0, F2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z);
    vec3 r = g + hash33(i + g) - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) { F2 = d; }
  }
  return sqrt(vec2(F1, F2));
}
#endif
`;
