import { snoise2 } from './noise.js';

const smooth = (a, b, x) => { const v = Math.max(0, Math.min(1, (x - a) / (b - a))); return v * v * (3 - 2 * v); };

// 裂隙和每块残冰的融化时刻固定在世界坐标，只改变局部高度，不平移冰体。
export function glacierFraction(x, z, axis, phase) {
  const D = -z, q = x - axis, station = (D - 1.4) / 32;
  const delay = 0.12 * Math.sin(q * 1.13 + 0.35) + 0.075 * snoise2(x * 0.47 + 9, z * 0.47 + 9);
  const remnant = smooth(0.1, 0.65, snoise2(x * 0.72 + 23, z * 0.72 + 23));
  const end = station + delay + remnant * 0.18;
  let keep = 1 - smooth(end - 0.18, end + 0.10, phase);
  let gap = 1e3;
  for (let j = 0; j < 4; j++) {
    const off = [-2.7, -0.9, 0.55, 2.5][j] + 0.23 * Math.sin(D * (0.23 + j * 0.041) + j * 1.9);
    const c = axis + smooth(8, 24, D) * off;
    gap = Math.min(gap, Math.abs(x - c) / (0.19 + j * 0.035));
  }
  const opening = smooth(station - 0.26, station + 0.06, phase);
  const split = 1 - smooth(0.55, 1.65, gap);
  const cross = 1 - smooth(0.05, 0.21, Math.abs(Math.sin(D * 0.78 + 0.8 * Math.sin(D * 0.23) + q * 0.22)));
  keep *= 1 - split * opening;
  keep *= 1 - cross * opening * 0.88;
  const meltWeight = smooth(0, 0.10, phase) * (1 - smooth(40, 60, D));
  return 1 + (Math.max(0, keep) - 1) * meltWeight;
}

export function glacierRunnel(x, z, axis, phase) {
  const D = -z;
  let sd = 1e3;
  for (let j = 0; j < 4; j++) {
    const off = [-2.7, -0.9, 0.55, 2.5][j] + 0.23 * Math.sin(D * (0.23 + j * 0.041) + j * 1.9);
    sd = Math.min(sd, Math.abs(x - axis - smooth(8, 24, D) * off) - (0.035 + j * 0.008));
  }
  const wet = smooth(0.015, 0.12, phase) * smooth(2.5, 6, D) * (1 - smooth(phase * 32 + 3, phase * 32 + 10, D));
  return [sd, wet];
}

export const GLACIER_MELT_GLSL = /* glsl */ `
#ifndef GLACIER_MELT_V2
#define GLACIER_MELT_V2
uniform vec2 uMeltV2;
float glacierAxis(float D) {
  float d = max(D, 0.0);
  return 0.30 + 2.6 * sin(d * 0.034 + 0.4) * smoothstep(4.0, 45.0, d);
}
float glacierChannelX(float D, int j) {
  float off = j == 0 ? -2.7 : j == 1 ? -0.9 : j == 2 ? 0.55 : 2.5;
  off += 0.23 * sin(D * (0.23 + float(j) * 0.041) + float(j) * 1.9);
  return glacierAxis(D) + smoothstep(8.0, 24.0, D) * off;
}
float glacierFraction(vec2 p, float phase) {
  float D = -p.y, q = p.x - glacierAxis(D), station = (D - 1.4) / 32.0;
  float delay = 0.12 * sin(q * 1.13 + 0.35) + 0.075 * snoise(p * 0.47 + 9.0);
  float remnant = smoothstep(0.1, 0.65, snoise(p * 0.72 + 23.0));
  float end = station + delay + remnant * 0.18;
  float keep = 1.0 - smoothstep(end - 0.18, end + 0.10, phase);
  float gap = 1e3;
  for (int j = 0; j < 4; j++) gap = min(gap, abs(p.x - glacierChannelX(D, j)) / (0.19 + float(j) * 0.035));
  float opening = smoothstep(station - 0.26, station + 0.06, phase);
  float split = 1.0 - smoothstep(0.55, 1.65, gap);
  float cross = 1.0 - smoothstep(0.05, 0.21, abs(sin(D * 0.78 + 0.8 * sin(D * 0.23) + q * 0.22)));
  keep *= 1.0 - split * opening;
  keep *= 1.0 - cross * opening * 0.88;
  float meltWeight = smoothstep(0.0, 0.10, phase) * (1.0 - smoothstep(40.0, 60.0, D));
  return mix(1.0, max(0.0, keep), meltWeight);
}
// 支流沿同一组裂隙汇向谷轴；仅在消融区启用，避免在整片冰面上画蓝线。
vec4 glacierRunnel(vec2 p) {
  float D = -p.y, sd = 1e3, slope = 0.0, width = 0.06;
  for (int j = 0; j < 4; j++) {
    float c = glacierChannelX(D, j), w = 0.035 + float(j) * 0.008;
    float d = abs(p.x - c) - w;
    if (d < sd) { sd = d; width = w; slope = (glacierChannelX(D + 0.03, j) - glacierChannelX(D - 0.03, j)) / 0.06; }
  }
  float wet = smoothstep(0.015, 0.12, uMeltV2.y) * smoothstep(2.5, 6.0, D)
    * (1.0 - smoothstep(uMeltV2.y * 32.0 + 3.0, uMeltV2.y * 32.0 + 10.0, D));
  return vec4(sd, wet, slope, width);
}
#endif
`;
