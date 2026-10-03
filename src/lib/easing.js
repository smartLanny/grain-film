// Easing, interpolation and keyframed-parameter evaluation.
//
// Keyframed values (usable anywhere in timeline params / post / camera specs):
//   { keys: [[0, 2.0], [0.6, 4.0], [1, 3.0]], ease: 'inOutSine' }        // time = shot localT (0..1)
//   { keys: [[0, [1,0.9,0.8]], [3.5, [1,1,1]]], time: 'seconds' }        // seconds since shot start
//   { keys: [[95, 0], [97, 1]], time: 'absolute' }                       // film time in seconds
//   (localT, t, shot) => value                                          // escape hatch, must be pure
// Values may be numbers or arrays (interpolated component-wise). Strings/booleans step.

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const saturate = (x) => clamp(x, 0, 1);
export const lerp = (a, b, k) => a + (b - a) * k;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
export const remap = (x, a0, a1, b0, b1, clamped = true) => {
  const k = invLerp(a0, a1, x);
  return lerp(b0, b1, clamped ? saturate(k) : k);
};
export const smoothstep = (e0, e1, x) => {
  const k = saturate((x - e0) / (e1 - e0));
  return k * k * (3 - 2 * k);
};
export const smootherstep = (e0, e1, x) => {
  const k = saturate((x - e0) / (e1 - e0));
  return k * k * k * (k * (k * 6 - 15) + 10);
};
/** Progress 0..1 of x within [a, b], clamped. */
export const segment = (x, a, b) => saturate((x - a) / (b - a));
/** 0 -> 1 -> 0 bump over [a, b] with soft edges of width `soft` (fraction of the span). */
export const window01 = (x, a, b, soft = 0.25) => {
  const w = (b - a) * soft;
  return smoothstep(a, a + w, x) * (1 - smoothstep(b - w, b, x));
};
/** Mix two numbers or arrays. */
export function mixValue(a, b, k) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => mixValue(v, b[i] ?? v, k));
  return k < 0.5 ? a : b;
}

const PI = Math.PI;
export const Ease = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inQuart: (x) => x * x * x * x,
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inOutQuart: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
  inSine: (x) => 1 - Math.cos((x * PI) / 2),
  outSine: (x) => Math.sin((x * PI) / 2),
  inOutSine: (x) => -(Math.cos(PI * x) - 1) / 2,
  inExpo: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outExpo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: (x) => x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  inCirc: (x) => 1 - Math.sqrt(1 - x * x),
  outCirc: (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
  smooth: (x) => x * x * (3 - 2 * x),
  smoother: (x) => x * x * x * (x * (x * 6 - 15) + 10),
  /** Long, gentle "camera operator" ease: slow start, very slow settle. */
  cine: (x) => {
    const a = x * x * (3 - 2 * x);
    return a * a * (3 - 2 * a) * 0.35 + a * 0.65;
  },
  outBack: (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
};

/** Apply a named easing (or function) to x in [0,1] (x is clamped). */
export function ease(name, x) {
  x = saturate(x);
  if (!name) return x;
  if (typeof name === 'function') return name(x);
  const f = Ease[name];
  if (!f) throw new Error(`Unknown easing "${name}"`);
  return f(x);
}

/** Evaluate sorted keyframes [[time, value], ...] at time x. */
export function evalKeys(keys, x, easing = 'linear') {
  if (!keys.length) return undefined;
  if (x <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0, e0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (x >= t0 && x <= t1) {
      const k = ease(e0 || easing, (x - t0) / (t1 - t0)); // per-key ease override: [t, v, 'outCubic']
      return mixValue(v0, v1, k);
    }
  }
  return last[1];
}

const isKeyed = (v) => v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.keys);

/**
 * Resolve a possibly keyframed / functional value.
 * @param {*} v
 * @param {number} localT   shot progress 0..1 (may exceed 1 while a shot dissolves out)
 * @param {number} t        film time (s)
 * @param {object} [shot]   shot (for 'seconds' keys: needs shot.start)
 */
export function evalValue(v, localT, t, shot) {
  if (typeof v === 'function') return v(localT, t, shot);
  if (isKeyed(v)) {
    const mode = v.time || 'local';
    const x = mode === 'local' ? localT : mode === 'seconds' ? t - (shot ? shot.start : 0) : t;
    return evalKeys(v.keys, x, v.ease || 'linear');
  }
  return v;
}

/** Shallow-resolve every property of an object (one level deep, plus nested plain objects). */
export function evalParams(obj, localT, t, shot) {
  if (!obj) return {};
  const out = {};
  for (const k in obj) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !isKeyed(v) && typeof v !== 'function') {
      out[k] = evalParams(v, localT, t, shot);
    } else {
      out[k] = evalValue(v, localT, t, shot);
    }
  }
  return out;
}
