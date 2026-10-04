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
// CPU mirror of the GLSL noise in ./glsl/noise.js (same formulas, so a terrain height computed in a
// shader can be reproduced here to keep cameras above ground). GPU float32 vs JS float64 means tiny
// differences (~1e-4) – fine for placement, not for bit-exact comparisons.

const fract = (x) => x - Math.floor(x);
const mod289 = (x) => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x) => mod289(((x * 34) + 1) * x);

/** 2D simplex noise, ~[-1, 1]. Matches GLSL snoise(vec2). */
export function snoise2(x, y) {
  const Cx = 0.211324865405187, Cy = 0.366025403784439, Cz = -0.577350269189626, Cw = 0.024390243902439;
  const s = (x + y) * Cy;
  let ix = Math.floor(x + s), iy = Math.floor(y + s);
  const t = (ix + iy) * Cx;
  const x0x = x - ix + t, x0y = y - iy + t;
  const i1x = x0x > x0y ? 1 : 0, i1y = 1 - i1x;
  const x1x = x0x + Cx - i1x, x1y = x0y + Cx - i1y;
  const x2x = x0x + Cz, x2y = x0y + Cz;
  ix = mod289(ix); iy = mod289(iy);
  const p0 = permute(permute(iy) + ix);
  const p1 = permute(permute(iy + i1y) + ix + i1x);
  const p2 = permute(permute(iy + 1) + ix + 1);
  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0);
  let m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y), 0);
  let m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y), 0);
  m0 *= m0; m0 *= m0; m1 *= m1; m1 *= m1; m2 *= m2; m2 *= m2;
  const g = (p, gx, gy, m) => {
    const xx = 2 * fract(p * Cw) - 1;
    const h = Math.abs(xx) - 0.5;
    const a0 = xx - Math.floor(xx + 0.5);
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    return m * (a0 * gx + h * gy);
  };
  return 130 * (g(p0, x0x, x0y, m0) + g(p1, x1x, x1y, m1) + g(p2, x2x, x2y, m2));
}

/** 3D simplex noise, ~[-1, 1]. Matches GLSL snoise(vec3). */
export function snoise3(x, y, z) {
  const C1 = 1 / 6, C2 = 1 / 3;
  const s = (x + y + z) * C2;
  let i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * C1;
  const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  // g = step(x0.yzx, x0.xyz)
  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  // i1 = min(g.xyz, l.zxy); i2 = max(g.xyz, l.zxy)
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);
  const x1 = x0 - i1x + C1, y1 = y0 - i1y + C1, z1 = z0 - i1z + C1;
  const x2 = x0 - i2x + C2, y2 = y0 - i2y + C2, z2 = z0 - i2z + C2;
  const x3 = x0 - 0.5, y3 = y0 - 0.5, z3 = z0 - 0.5;
  i = mod289(i); j = mod289(j); k = mod289(k);
  const P = (a, b, c) => permute(permute(permute(k + c) + j + b) + i + a);
  const p = [P(0, 0, 0), P(i1x, i1y, i1z), P(i2x, i2y, i2z), P(1, 1, 1)];
  const xs = [x0, x1, x2, x3], ys = [y0, y1, y2, y3], zs = [z0, z1, z2, z3];
  const n_ = 0.142857142857;
  const nsx = n_ * 2 - 0, nsy = n_ * 0.5 - 1, nsz = n_ * 1 - 0; // ns = n_ * D.wyz - D.xzx
  let sum = 0;
  for (let q = 0; q < 4; q++) {
    const jj = p[q] - 49 * Math.floor(p[q] * nsz * nsz);
    const x_ = Math.floor(jj * nsz);
    const y_ = Math.floor(jj - 7 * x_);
    const gxq = x_ * nsx + nsy;
    const gyq = y_ * nsx + nsy;
    const h = 1 - Math.abs(gxq) - Math.abs(gyq);
    const sh = h <= 0 ? -1 : 0;
    const ax = gxq + (Math.floor(gxq) * 2 + 1) * sh;
    const ay = gyq + (Math.floor(gyq) * 2 + 1) * sh;
    const len2 = ax * ax + ay * ay + h * h;
    const norm = 1.79284291400159 - 0.85373472095314 * len2;
    let m = Math.max(0.6 - (xs[q] * xs[q] + ys[q] * ys[q] + zs[q] * zs[q]), 0);
    m *= m;
    sum += m * m * norm * (ax * xs[q] + ay * ys[q] + h * zs[q]);
  }
  return 42 * sum;
}

/** fbm over snoise2, matches GLSL fbm(vec2, octaves). */
export function fbm2(x, y, octaves = 5) {
  let s = 0, a = 0.5;
  for (let i = 0; i < octaves; i++) {
    s += a * snoise2(x, y);
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y;
    x = nx; y = ny; a *= 0.5;
  }
  return s;
}

/** Ridged multifractal, matches GLSL ridged(vec2, octaves). */
export function ridged2(x, y, octaves = 5) {
  let s = 0, a = 0.5, w = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(snoise2(x, y));
    n *= n; n *= w;
    w = Math.min(Math.max(n * 2, 0), 1);
    s += n * a;
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y;
    x = nx; y = ny; a *= 0.5;
  }
  return s;
}

/** Smooth 1D noise in [-1,1] for camera shake, flicker, etc. `seed` selects an independent channel. */
export function noise1(t, seed = 0) {
  return snoise2(t, seed * 17.31 + 3.7);
}
