// Deterministic randomness. NEVER use Math.random() for anything that affects picture or sound.
//
//   const rng = createRng('forest-trees');   // string or integer seed
//   rng()            -> float in [0, 1)
//   rng.range(a, b)  -> float in [a, b)
//   rng.int(a, b)    -> integer in [a, b]
//   rng.pick(arr), rng.gauss(mean, sd), rng.sign(), rng.chance(p), rng.onSphere(), rng.fork('label')
//
//   hash1(i, seed) / hash2(x, y, seed) / hash3(x, y, z, seed)  -> stateless floats in [0, 1)

/** FNV-1a 32-bit hash of a string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer avalanche hash (lowbias32). */
export function hashInt(x) {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

const INV32 = 1 / 4294967296;

/** Stateless hash -> [0,1). Works for integers (and floats, which are truncated after scaling). */
export function hash1(i, seed = 0) {
  return hashInt((i | 0) ^ hashInt(seed | 0)) * INV32;
}
export function hash2(x, y, seed = 0) {
  return hashInt((x | 0) ^ hashInt((y | 0) ^ hashInt(seed | 0))) * INV32;
}
export function hash3(x, y, z, seed = 0) {
  return hashInt((x | 0) ^ hashInt((y | 0) ^ hashInt((z | 0) ^ hashInt(seed | 0)))) * INV32;
}

/** Normalise a seed (string or number) to uint32. */
export function seedOf(seed) {
  return typeof seed === 'string' ? hashString(seed) : (seed >>> 0);
}

/** Seeded PRNG (sfc32 core). Returns a callable with helpers attached. */
export function createRng(seed = 1) {
  let s = seedOf(seed);
  let a = hashInt(s ^ 0x9e3779b9), b = hashInt(s ^ 0x243f6a88), c = hashInt(s ^ 0xb7e15162), d = 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11);
    c = c + t | 0;
    return (t >>> 0) * INV32;
  };
  for (let i = 0; i < 12; i++) next(); // warm up
  const rng = () => next();
  rng.range = (lo, hi) => lo + (hi - lo) * next();
  rng.int = (lo, hi) => lo + Math.floor((hi - lo + 1) * next());
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  rng.chance = (p) => next() < p;
  rng.sign = () => (next() < 0.5 ? -1 : 1);
  rng.gauss = (mean = 0, sd = 1) => {
    const u = 1 - next(), v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  rng.onSphere = () => {
    const z = 2 * next() - 1, phi = 2 * Math.PI * next(), r = Math.sqrt(1 - z * z);
    return [r * Math.cos(phi), z, r * Math.sin(phi)];
  };
  rng.inDisk = () => {
    const r = Math.sqrt(next()), phi = 2 * Math.PI * next();
    return [r * Math.cos(phi), r * Math.sin(phi)];
  };
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  /** Independent child stream, stable regardless of how many numbers the parent has drawn. */
  rng.fork = (label) => createRng(hashInt(seedOf(seed) ^ hashString(String(label))));
  return rng;
}
