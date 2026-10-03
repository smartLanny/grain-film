import { white, pink, grains, biquad, filt } from './dsp.js';

// 宽频水流由连续噪声与不规则短噪声粒组成，不使用可辨音高的气泡 chirp。
export function shallowWater(sr) {
  const seconds = 13, N = Math.round(seconds * sr);
  const detail = grains(sr, { seconds, rate: 110, fc: [900, 7500], bw: 2.6, tau: [0.001, 0.008], ampPow: 3, seed: 's08-shallow-detail', norm: 0.018 });
  const out = [0, 1].map((c) => {
    const a = pink(N, 's08-flow:' + c), b = white(N, 's08-air:' + c);
    filt(a, biquad('hp', 180, 0.7, sr)); filt(a, biquad('lp', 5500, 0.55, sr));
    filt(b, biquad('hp', 950, 0.7, sr)); filt(b, biquad('lp', 8500, 0.55, sr));
    for (let i = 0; i < N; i++) a[i] = a[i] * 0.5 + b[i] * 0.10 + detail[c][i] * 0.55;
    return a;
  });
  let sum = 0;
  for (const a of out) for (const v of a) sum += v * v;
  const k = 0.065 / Math.sqrt(sum / (N * 2));
  for (const a of out) for (let i = 0; i < N; i++) a[i] *= k;
  return out;
}
