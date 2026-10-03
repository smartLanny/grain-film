// Engine: renderer setup, world registry (lazy create + warm-up), shot scheduler, transitions,
// post chain and title layer. The picture is a pure function of film time t:
//
//   engine.renderAt(t)   – renders the frame for time t to the canvas (synchronous; worlds must be
//                          ready – call `await engine.prepare(t)` first when seeking)
//
// Transition semantics (see docs/architecture.md):
//   transitionIn  { type: 'cut' }                                 default
//                 { type: 'dissolve', duration, ease }            the incoming shot's first `duration`
//                     seconds cross-dissolve with the previous shot, which keeps rendering past its
//                     end (its localT goes > 1)
//                 { type: 'fadeFromBlack' | 'fadeFromWhite' | 'fadeFrom', duration, color }
//                 { type: 'dipToBlack' | 'dipToWhite' | 'dip', duration, color } – out over the last
//                     d/2 of the previous shot, in over the first d/2 of this one
//   transitionOut { type: 'fadeToBlack' | 'fadeToWhite' | 'fadeTo', duration, color }
//
// Shutter accumulation (offline motion blur): renderAt(t, target, { samples: N, shutter: 0.5 })
// renders each visible shot N times at t + shutter * k / (N * FPS), k = 0..N-1, and averages them
// in linear HDR (after scene + DOF, before bloom + grade). The plan (layers, dissolve mix, fade),
// the post settings for bloom/grade, the title cards, grain, letterbox and dither all use the
// nominal t, so only world time advances; sub-frame times are clamped to the shot's visible end
// and never reach the next shot. shot.shutter (0..1, keyframable) overrides the default; 0 = none.

import * as THREE from 'three';
import { FPS, FILM_SEED } from './config.js';
import { PostChain, DEFAULT_POST } from './post.js';
import { TitleLayer } from './titles.js';
import { evalParams, evalValue, ease, mixValue } from './lib/easing.js';
import { applyCameraRig } from './lib/camera.js';
import { createRng, hashString } from './lib/random.js';
import { WORLDS } from './worlds/registry.js';

const FADE_COLORS = { Black: [0, 0, 0], White: [1, 1, 1] };
function fadeColorOf(tr) {
  if (tr.color) return tr.color;
  const m = /(Black|White)$/.exec(tr.type);
  return m ? FADE_COLORS[m[1]] : [0, 0, 0];
}

/** Validate + annotate shots (sorted copies with duration, index, visibleEnd). */
export function normalizeShots(shots) {
  const out = shots.map((s) => ({ ...s })).sort((a, b) => a.start - b.start);
  const problems = [];
  out.forEach((s, i) => {
    if (!s.id) problems.push(`shot #${i} has no id`);
    if (!(s.end > s.start)) problems.push(`shot ${s.id}: end must be > start`);
    if (!WORLDS[s.world]) problems.push(`shot ${s.id}: unknown world "${s.world}" (add it to src/worlds/registry.js)`);
    s.index = i;
    s.duration = s.end - s.start;
    const next = out[i + 1];
    if (next && next.start < s.end - 1e-6) problems.push(`shots ${s.id} / ${next.id} overlap`);
    if (next && next.start > s.end + 1e-6) problems.push(`gap (black) between ${s.id} and ${next.id}`);
  });
  out.forEach((s, i) => {
    const next = out[i + 1];
    const tail = next && next.transitionIn && next.transitionIn.type === 'dissolve' ? next.transitionIn.duration : 0;
    s.visibleEnd = s.end + tail;
  });
  const ids = new Set();
  for (const s of out) { if (ids.has(s.id)) problems.push(`duplicate shot id ${s.id}`); ids.add(s.id); }
  return { shots: out, problems };
}

export class Engine {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {number} o.width   frame width (px)
   * @param {number} o.height  frame height (px)
   * @param {object[]} o.shots timeline shots
   * @param {object[]} o.cards title cards
   * @param {object} [o.look]  film-wide post overrides (merged over DEFAULT_POST, under world/shot)
   * @param {number} [o.duration]
   */
  constructor({ canvas, width, height, shots, cards = [], look = {}, duration }) {
    this.width = width;
    this.height = height;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.debug.checkShaderErrors = true;
    this.renderer = renderer;
    this.gl = renderer.getContext();

    const { shots: norm, problems } = normalizeShots(shots);
    for (const p of problems) console.warn('[timeline]', p);
    this.shots = norm;
    this.byId = new Map(norm.map((s) => [s.id, s]));
    this.duration = duration ?? (norm.length ? norm[norm.length - 1].end : 0);
    this.look = look;
    this.post = new PostChain(renderer, { width, height });
    this.titles = new TitleLayer(width, height, cards);
    this.worlds = new Map(); // name -> { promise, instance, ready, error }
    this.stats = { frame: 0, t: 0, ms: 0 };
  }

  /** Compile post shaders. Call once before the first frame. */
  async init() {
    this.post.warmup();
    this.renderer.setRenderTarget(null);
    this.post.renderFinal(null, { slots: 0, mix: 0, fade: 1, fadeColor: [0, 0, 0], titles: null, grain: 0, grainSize: 1, letterbox: 0, frame: 0 });
    return this;
  }

  // ------------------------------------------------------------------------------- worlds
  _worldContext(name) {
    const seed = (hashString(name) ^ FILM_SEED) >>> 0;
    return {
      THREE, name, seed, rng: createRng(seed),
      renderer: this.renderer, width: this.width, height: this.height,
      aspect: this.width / this.height, fps: FPS,
      shots: this.shots.filter((s) => s.world === name),
      engine: this,
    };
  }

  /** Load, create and warm a world (idempotent). */
  ensureWorld(name) {
    let rec = this.worlds.get(name);
    if (rec) return rec.promise;
    rec = { name, ready: false, instance: null, error: null };
    this.worlds.set(name, rec);
    rec.promise = (async () => {
      const loader = WORLDS[name];
      if (!loader) throw new Error(`Unknown world "${name}"`);
      const t0 = performance.now();
      const mod = await loader();
      const create = mod.create || (mod.default && mod.default.create);
      if (!create) throw new Error(`World "${name}" does not export create(ctx)`);
      const inst = await create(this._worldContext(name));
      if (!inst || !inst.scene || !inst.camera || typeof inst.update !== 'function') {
        throw new Error(`World "${name}": create() must return { scene, camera, update, dispose }`);
      }
      if (inst.camera.isPerspectiveCamera) {
        inst.camera.aspect = this.width / this.height;
        inst.camera.updateProjectionMatrix();
      }
      await this._warm(name, inst);
      rec.instance = inst;
      rec.ready = true;
      rec.ms = performance.now() - t0;
      console.info(`[engine] world "${name}" ready in ${rec.ms.toFixed(0)} ms`);
      return inst;
    })().catch((err) => {
      rec.error = err;
      console.error(`[engine] world "${name}" failed:`, err);
      throw err;
    });
    return rec.promise;
  }

  async _warm(name, inst) {
    const shot = this.shots.find((s) => s.world === name);
    if (shot) this._updateWorld(inst, shot, 0, shot.start);
    if (this.renderer.compileAsync) await this.renderer.compileAsync(inst.scene, inst.camera);
    // one real draw uploads geometry/textures and finishes program linking
    const rt = this.post.sceneRT;
    this.renderer.setRenderTarget(rt);
    if (inst.render) inst.render(this.renderer, rt, inst.camera);
    else this.renderer.render(inst.scene, inst.camera);
    if (inst.warmup) await inst.warmup(this.renderer);
    this.renderer.setRenderTarget(null);
  }

  /** Worlds needed to draw anything in [t, t + ahead]. */
  worldsNeeded(t, ahead = 0) {
    const names = new Set();
    for (const s of this.shots) if (s.start <= t + ahead && s.visibleEnd > t) names.add(s.world);
    return [...names];
  }

  /** Ensure every world visible in [t, t + ahead] is ready. */
  prepare(t, ahead = 0) {
    return Promise.all(this.worldsNeeded(t, ahead).map((n) => this.ensureWorld(n)));
  }

  /** Create + warm every world in the timeline (live playback does this up front: no hitches). */
  async prepareAll(onProgress) {
    const names = [...new Set(this.shots.map((s) => s.world))];
    let done = 0;
    for (const n of names) {
      await this.ensureWorld(n);
      onProgress && onProgress(++done / names.length, n);
    }
  }

  // ------------------------------------------------------------------------------- schedule
  /** Index of the shot containing t (start <= t < end), or -1. */
  shotIndexAt(t) {
    const s = this.shots;
    let lo = 0, hi = s.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found >= 0 && t < s[found].end) return found;
    if (found === s.length - 1 && found >= 0 && Math.abs(t - s[found].end) < 1e-9) return found;
    return -1;
  }

  shotAt(t) { const i = this.shotIndexAt(t); return i >= 0 ? this.shots[i] : null; }

  /** What to draw at time t: layers (1 or 2 shots), dissolve mix and fade. Pure. */
  plan(t) {
    const i = this.shotIndexAt(t);
    if (i < 0) return { layers: [], mix: 0, fade: 1, fadeColor: [0, 0, 0], index: -1 };
    const cur = this.shots[i], prev = this.shots[i - 1], next = this.shots[i + 1];
    const layers = [{ shot: cur, localT: (t - cur.start) / cur.duration }];
    let mix = 0, fade = 0, fadeColor = [0, 0, 0];
    const since = t - cur.start, until = cur.end - t;
    const setFade = (k, tr) => { if (k > fade) { fade = k; fadeColor = fadeColorOf(tr); } };

    const tin = cur.transitionIn;
    if (tin && tin.duration > 0) {
      const d = tin.duration;
      if (tin.type === 'dissolve') {
        if (prev && since < d && Math.abs(prev.end - cur.start) < 1e-6) {
          mix = ease(tin.ease || 'inOutSine', since / d);
          layers.unshift({ shot: prev, localT: (t - prev.start) / prev.duration });
        }
      } else if (/^fadeFrom/.test(tin.type)) {
        if (since < d) setFade(1 - ease(tin.ease || 'inOutSine', since / d), tin);
      } else if (/^dip/.test(tin.type)) {
        if (since < d / 2) setFade(1 - ease(tin.ease || 'inOutSine', since / (d / 2)), tin);
      }
    }
    const nin = next && next.transitionIn;
    if (nin && /^dip/.test(nin.type) && nin.duration > 0 && until < nin.duration / 2) {
      setFade(ease(nin.ease || 'inOutSine', 1 - until / (nin.duration / 2)), nin);
    }
    const tout = cur.transitionOut;
    if (tout && tout.duration > 0 && /^fadeTo/.test(tout.type) && until < tout.duration) {
      setFade(ease(tout.ease || 'inOutSine', 1 - until / tout.duration), tout);
    }
    return { layers, mix, fade, fadeColor, index: i };
  }

  // ------------------------------------------------------------------------------- render
  _updateWorld(inst, shot, localT, t) {
    const params = evalParams(shot.params, localT, t, shot);
    applyCameraRig(inst.camera, shot.camera, localT, t, shot);
    inst.update(t, localT, shot, params);
    return params;
  }

  /** Resolve post settings: DEFAULT_POST <- film look <- world.post <- shot.post (keyframes evaluated). */
  resolvePost(inst, shot, localT, t) {
    const wp = typeof inst.post === 'function' ? inst.post(t, localT, shot) : inst.post;
    return {
      ...DEFAULT_POST,
      ...evalParams(this.look, localT, t, shot),
      ...(wp ? evalParams(wp, localT, t, shot) : {}),
      ...evalParams(shot.post, localT, t, shot),
    };
  }

  /** Is everything needed for time t loaded? */
  isReady(t) {
    return this.worldsNeeded(t).every((n) => this.worlds.get(n)?.ready);
  }

  /**
   * Sub-frame times for one shot at nominal time t, or null for a single sample.
   * t_k = t + shutter * k / (samples * FPS), clamped to the shot's visible end (never past a cut).
   */
  shutterTimes(shot, t, localT, samples = 1, shutter = 0.5) {
    const n = Math.floor(samples);
    if (!(n > 1)) return null;
    let s = shot.shutter !== undefined ? evalValue(shot.shutter, localT, t, shot) : shutter;
    s = Math.min(1, Math.max(0, Number(s) || 0));
    if (!(s > 0)) return null;
    const times = [];
    for (let k = 0; k < n; k++) times.push(k === 0 ? t : Math.min(t + (s * k) / (n * FPS), shot.visibleEnd));
    return times;
  }

  /** Render one shot as the average of sub-frames at `times` (times[0] = nominal t, already updated). */
  _renderShotAccumulated(slot, inst, shot, p, times) {
    const n = times.length;
    let avg = null;
    for (let k = 0; k < n; k++) {
      let pk = p;
      if (k > 0) {
        const tk = times[k], lk = (tk - shot.start) / shot.duration;
        this._updateWorld(inst, shot, lk, tk);
        // DOF (focus pulls) follows the sub-frame; the scissor stays on the nominal letterbox
        pk = { ...this.resolvePost(inst, shot, lk, tk), letterbox: p.letterbox };
      }
      avg = this.post.accumulate(this.post.renderScene(inst, pk), k, n);
    }
    this.post.gradeShot(slot, avg, p); // bloom + grade once, at the nominal time
  }

  /**
   * Render the frame for film time t to the canvas (or to `target`). Synchronous.
   * Missing (not yet loaded) worlds render black and start loading.
   * opts.samples > 1 turns on shutter accumulation (offline motion blur); opts.shutter is the
   * default shutter (fraction of the frame interval, 0.5 = 180°) for shots without shot.shutter.
   */
  renderAt(t, target = null, opts = {}) {
    const t0 = performance.now();
    const plan = this.plan(t);
    const frame = Math.floor(t * FPS + 1e-6);
    const posts = [];
    plan.layers.forEach((layer, slot) => {
      const rec = this.worlds.get(layer.shot.world);
      if (!rec || !rec.ready) {
        if (!rec) this.ensureWorld(layer.shot.world).catch(() => {});
        this.renderer.setRenderTarget(this.post.graded[slot]);
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.clear(true, false, false);
        posts.push(DEFAULT_POST);
        return;
      }
      const inst = rec.instance;
      this._updateWorld(inst, layer.shot, layer.localT, t);
      const p = this.resolvePost(inst, layer.shot, layer.localT, t);
      const times = this.shutterTimes(layer.shot, t, layer.localT, opts.samples, opts.shutter);
      if (times) this._renderShotAccumulated(slot, inst, layer.shot, p, times);
      else this.post.renderShot(slot, inst, p);
      posts.push(p);
    });
    const g = (k) => {
      const val = (p) => (k === 'letterbox' ? p[k] || 0 : p[k]);
      if (posts.length === 2) return mixValue(val(posts[0]), val(posts[1]), plan.mix);
      return posts.length ? val(posts[0]) : val({ ...DEFAULT_POST, ...this.look });
    };
    const letterbox = g('letterbox');
    const titles = this.titles.update(t, this.post.pictureFrac(letterbox));
    this.post.renderFinal(target, {
      slots: plan.layers.length, mix: plan.mix, fade: plan.fade, fadeColor: plan.fadeColor,
      titles, grain: g('grain'), grainSize: g('grainSize'), letterbox, frame,
    });
    this.stats = { t, frame, ms: performance.now() - t0, shot: plan.layers.map((l) => l.shot.id).join(' > '), plan };
    return plan;
  }

  /**
   * GPU timing: render time t `n` times, forcing completion each time (1px readback), and return
   * the average wall-clock ms per frame. Use to check a world against the real-time budget.
   */
  benchmark(t, n = 30) {
    const px = new Uint8Array(4);
    const gl = this.gl;
    this.renderAt(t);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.renderAt(t);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / n;
  }

  /** Renderer / GPU description. */
  info() {
    const gl = this.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      width: this.width, height: this.height, fps: FPS, duration: this.duration,
      shots: this.shots.length, worlds: [...this.worlds.keys()],
    };
  }

  dispose() {
    for (const rec of this.worlds.values()) rec.instance && rec.instance.dispose && rec.instance.dispose();
    this.post.dispose();
    this.titles.dispose();
    this.renderer.dispose();
  }
}
