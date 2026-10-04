// Boot: live player (index.html) and the offline API (window.__film) used by tools/*.mjs.
//
// Query params
//   ?t=95          start at 95 s            ?shot=<id>   loop one shot (dev)
//   ?hud=1         show time / shot / ms    ?mute=1      no audio (wall clock)
//   ?scale=0.5     internal resolution scale (default 1 = 2160x1080; 0.5 = 1080x540, 2 = 4320x2160)
//   ?offline=1     no UI / no playback loop; frames are pulled via window.__film.renderFrame(i)
//   ?samples=8     shutter accumulation for renderFrame (offline motion blur; default 1 = off)
//   ?shutter=0.5   default shutter as a fraction of the frame (0.5 = 180°); shot.shutter overrides

import { WIDTH, HEIGHT, FPS } from './config.js';
import { Engine } from './engine.js';
import { shots, DURATION, LOOK } from './timeline.js';
import { cards } from './cards.js';
import { FilmAudio } from './audio/audio.js';

const q = new URLSearchParams(location.search);
const OFFLINE = q.has('offline');
const scale = parseFloat(q.get('scale') || '1') || 1;
// width % 8 and height % 4 keep the GPU yuv420p packing exact (2160x1080, 1080x540, 4320x2160 ...)
const W = Math.max(8, Math.round((WIDTH * scale) / 8) * 8), H = Math.max(4, Math.round((HEIGHT * scale) / 4) * 4);
// shutter accumulation for frames pulled through the offline API (the live player never uses it)
const shutterQ = parseFloat(q.get('shutter'));
const MOTION = { samples: Math.max(1, parseInt(q.get('samples') || '1', 10) || 1), shutter: Number.isFinite(shutterQ) ? shutterQ : 0.5 };

const canvas = document.getElementById('film');
const engine = new Engine({ canvas, width: W, height: H, shots, cards, look: LOOK, duration: DURATION });
const audio = new FilmAudio({ duration: DURATION });

// ------------------------------------------------------------------------------------------ API
// Frame sink: a WebSocket to the render tool. (Measured on M5 Max/Chrome: fetch() with a
// Uint8Array body ~200 ms per 8 MB, Blob bodies fail after ~50 frames, WebSocket ~20 ms, no failures.)
// Readback is asynchronous (PBO) and pipelined one frame deep: frame i+1 renders while frame i is
// copied back, then frame i is sent. Sync readPixels would add ~13 ms per 1080p frame.
const sink = { ws: null, inflight: 0, waiters: [], format: 'yuv', bytes: 0, pool: [], reads: [], maxInFlight: 2 };
function waitAck() { return new Promise((r) => sink.waiters.push(r)); }
async function sendOldestRead() {
  const r = sink.reads.shift();
  await r.promise;
  while (sink.inflight >= sink.maxInFlight) await waitAck();
  sink.ws.send(r.buf); // WebSocket.send copies, so the buffer can be reused immediately
  sink.inflight++;
  sink.pool.push(r.buf);
}

const api = {
  fps: FPS, duration: DURATION, width: W, height: H, scale, engine, audio, shots: engine.shots,
  ready: null,
  /** Render frame i (t = i / FPS) to the canvas. Resolves when drawn. Uses ?samples / ?shutter. */
  async renderFrame(i, target = null) {
    const t = i / FPS;
    if (!engine.isReady(t)) await engine.prepare(t);
    engine.renderAt(t, target, MOTION);
    engine.prepare(t, 8).catch(() => {}); // prefetch upcoming worlds
    return { t, frame: i, shot: engine.stats.shot, ms: engine.stats.ms };
  },
  /** Connect the binary frame sink. format 'yuv' (yuv420p, 1.5 B/px, top-down) or 'rgba' (bottom-up). */
  async connectSink(wsUrl, format = 'yuv') {
    if (format === 'yuv' && (W % 8 || H % 4)) throw new Error('yuv capture needs width % 8 == 0 and height % 4 == 0');
    sink.format = format;
    sink.bytes = format === 'yuv' ? (W * H * 3) / 2 : W * H * 4;
    sink.ws = new WebSocket(wsUrl);
    sink.ws.binaryType = 'arraybuffer';
    sink.ws.onmessage = () => { sink.inflight--; const w = sink.waiters.shift(); w && w(); };
    await new Promise((res, rej) => { sink.ws.onopen = res; sink.ws.onerror = () => rej(new Error('sink connect failed')); });
    return { bytesPerFrame: sink.bytes };
  },
  /**
   * Render frame i into the capture target, queue its async readback and send the previous frame.
   * Frames reach the sink strictly in call order. Call flushSink() after the last frame.
   */
  async captureFrame(i) {
    const a = performance.now();
    const info = await api.renderFrame(i, engine.post.captureTarget());
    const b = performance.now();
    const buf = sink.pool.pop() || new Uint8Array(sink.bytes);
    sink.reads.push({ i, buf, promise: engine.post.readAsync(buf, sink.format) });
    const c = performance.now();
    while (sink.reads.length > 1) await sendOldestRead();
    const d = performance.now();
    return { ...info, renderMs: b - a, readMs: c - b, sendMs: d - c };
  },
  /** Send any pending frames and wait until every frame has been acknowledged. */
  async flushSink() {
    while (sink.reads.length) await sendOldestRead();
    while (sink.inflight > 0) await waitAck();
  },
  /**
   * Capture frames [f0, f1) in a loop inside the page (about 2x faster than one CDP round trip per
   * frame). Progress is readable meanwhile from window.__film.captureProgress.
   */
  async captureRange(f0, f1) {
    const prog = (api.captureProgress = { done: 0, total: f1 - f0, cpuMs: 0, waitMs: 0, finished: false });
    for (let i = f0; i < f1; i++) {
      const r = await api.captureFrame(i);
      prog.done++; prog.cpuMs += r.renderMs; prog.waitMs += r.sendMs;
    }
    await api.flushSink();
    prog.finished = true;
    return prog;
  },
  captureProgress: null,
  /** Average GPU+CPU ms per frame at time t (forces completion every frame). */
  benchmark: async (t, n = 30) => { await engine.prepare(t); return engine.benchmark(t, n); },
  /** Render frame i and return a PNG data URL (for stills). */
  async stillDataURL(i, type = 'image/png', quality) {
    await api.renderFrame(i);
    return canvas.toDataURL(type, quality);
  },
  /** Render the score and send it as a WAV over the sink WebSocket (binary, no base64 over CDP). */
  async sendWav(opts = {}) {
    await audio.render();
    const ab = await audio.exportWav({ bitDepth: opts.bitDepth || 24, start: opts.start || 0, end: opts.end });
    sink.inflight++;
    sink.ws.send(ab);
    await api.flushSink();
    return { bytes: ab.byteLength, renderMs: audio.renderMs };
  },
  /** WAV of the full score: ArrayBuffer (default) or base64 string ({format:'base64'}). */
  exportWav: (opts) => audio.exportWav(opts),
  info: () => ({ ...engine.info(), scale, samples: MOTION.samples, shutter: MOTION.shutter }),
  seek: (t) => player && player.seek(t),
  play: () => player && player.play(),
  pause: () => player && player.pause(),
};
window.__film = api;

// --------------------------------------------------------------------------------------- player
class WallClock {
  constructor() { this.playing = false; this.pausedAt = 0; }
  play(from, loop) { this.from = from; this.loop = loop; this.t0 = performance.now(); this.playing = true; }
  pause() { this.pausedAt = this.time(); this.playing = false; }
  time() {
    if (!this.playing) return this.pausedAt;
    let ft = this.from + (performance.now() - this.t0) / 1000;
    if (this.loop && ft >= this.loop[1]) ft = this.loop[0] + ((ft - this.loop[0]) % (this.loop[1] - this.loop[0]));
    return ft;
  }
}

let player = null;

class Player {
  constructor() {
    this.overlay = document.getElementById('overlay');
    this.status = document.getElementById('status');
    this.bar = document.getElementById('bar');
    this.hud = document.getElementById('hud');
    this.hudOn = q.get('hud') === '1';
    this.mute = q.get('mute') === '1';
    const shotId = q.get('shot');
    this.loop = null;
    let start = parseFloat(q.get('t') || '0') || 0;
    if (shotId) {
      const s = engine.byId.get(shotId);
      if (s) { this.loop = [s.start, s.visibleEnd]; start = s.start; this.hudOn = q.get('hud') !== '0'; }
      else console.warn(`?shot=${shotId}: no such shot. Ids: ${engine.shots.map((x) => x.id).join(', ')}`);
    }
    this.startT = Math.max(0, Math.min(start, DURATION));
    this.clock = this.mute ? new WallClock() : audio;
    this.started = false;
    this.frames = [];
  }

  setProgress(label, k) {
    this.status.textContent = label;
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, k))})`;
  }

  async load() {
    let pic = 0, snd = this.mute ? 1 : 0;
    const show = () => this.setProgress(pic < 1 || snd < 1 ? 'preparing' : 'click to begin', (pic + snd) / 2);
    await engine.init();
    const picture = engine.prepareAll((k) => { pic = k; show(); }).then(() => { pic = 1; show(); });
    const sound = this.mute ? Promise.resolve() : audio.render((k) => { snd = k; show(); });
    await Promise.all([picture, sound]);
    show();
    engine.renderAt(this.startT); // poster frame
    this.overlay.classList.add('ready');
    this.overlay.addEventListener('click', () => this.begin(), { once: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  async begin() {
    if (!this.mute) await audio.unlock();
    this.overlay.classList.add('hidden');
    this.started = true;
    this.clock.play(this.startT, this.loop);
    const tick = () => { this.frame(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  frame() {
    let t = this.clock.time();
    if (!this.loop && t >= DURATION) {
      if (this.clock.playing) { this.clock.pause(); this.clock.pausedAt = DURATION; }
      t = DURATION - 1e-4;
    }
    if (engine.isReady(t)) engine.renderAt(t);
    else engine.prepare(t).catch(() => {});
    const now = performance.now();
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0] > 1000) this.frames.shift();
    if (this.hudOn) {
      const st = engine.stats;
      this.hud.style.display = 'block';
      this.hud.textContent = `${t.toFixed(2)}s  f${st.frame}  ${st.shot || '(black)'}  ${st.ms.toFixed(1)}ms cpu  ${this.frames.length}fps${this.clock.playing ? '' : '  [paused]'}`;
    } else this.hud.style.display = 'none';
  }

  play() { if (!this.clock.playing) this.clock.play(this.clock.time(), this.loop); }
  pause() { this.clock.pause(); }

  async seek(t) {
    const was = this.clock.playing;
    const lo = this.loop ? this.loop[0] : 0, hi = this.loop ? this.loop[1] - 1e-3 : DURATION;
    t = Math.max(lo, Math.min(hi, t));
    this.clock.pause();
    this.clock.pausedAt = t;
    await engine.prepare(t);
    if (was) this.clock.play(t, this.loop);
  }

  onKey(e) {
    if (!this.started) return;
    const t = this.clock.time();
    const big = e.shiftKey ? 1 : 5;
    switch (e.key) {
      case ' ': e.preventDefault(); this.clock.playing ? this.pause() : this.play(); break;
      case 'ArrowRight': this.seek(t + big); break;
      case 'ArrowLeft': this.seek(t - big); break;
      case '.': if (!this.clock.playing) this.seek(t + 1 / FPS); break;
      case ',': if (!this.clock.playing) this.seek(t - 1 / FPS); break;
      case 'Home': this.seek(this.loop ? this.loop[0] : 0); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
        break;
      case 'h': case 'H': this.hudOn = !this.hudOn; break;
      default: return;
    }
  }
}

if (OFFLINE) {
  document.body.classList.add('offline');
  api.ready = engine.init().then(() => engine.prepare(0)).then(() => true);
} else {
  player = new Player();
  api.ready = player.load().then(() => true);
  api.player = player;
}
