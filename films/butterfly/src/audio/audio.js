// Film audio: renders the whole score once with an OfflineAudioContext (48 kHz stereo) into a single
// AudioBuffer, then plays it with an AudioBufferSourceNode. The picture clock is derived from the
// audio clock (getOutputTimestamp), so picture follows what is actually heard.

import { SAMPLE_RATE } from '../config.js';
import { renderScore } from './score.js';
import { encodeWav, arrayBufferToBase64 } from './wav.js';

export class FilmAudio {
  constructor({ duration, sampleRate = SAMPLE_RATE }) {
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.buffer = null;
    this.ctx = null;
    this.source = null;
    this.playing = false;
    this.anchor = { ctxTime: 0, filmTime: 0 };
    this.pausedAt = 0;
    this.loop = null;
    this._rendering = null;
  }

  /** Render the score (once). onProgress(fraction 0..1). */
  render(onProgress) {
    if (this._rendering) return this._rendering;
    this._rendering = (async () => {
      const t0 = performance.now();
      const length = Math.max(1, Math.ceil(this.duration * this.sampleRate));
      const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: this.sampleRate });
      onProgress && onProgress(0);
      await renderScore(ctx, this.duration);
      // progress via suspend/resume checkpoints
      const n = Math.max(1, Math.min(50, Math.floor(this.duration)));
      for (let i = 1; i < n; i++) {
        const at = (this.duration * i) / n;
        ctx.suspend(at).then(() => { onProgress && onProgress(i / n); ctx.resume(); }).catch(() => {});
      }
      this.buffer = await ctx.startRendering();
      onProgress && onProgress(1);
      this.renderMs = performance.now() - t0;
      console.info(`[audio] score rendered: ${this.duration.toFixed(2)} s in ${this.renderMs.toFixed(0)} ms`);
      return this.buffer;
    })();
    return this._rendering;
  }

  /** Must be called from a user gesture the first time (browser autoplay policy). */
  async unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate, latencyHint: 'playback' });
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  _now() {
    const ctx = this.ctx;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  /** Start playback at film time `from`. Optional loop: [a, b] (seconds). */
  play(from = 0, loop = null) {
    this.stopSource();
    this.loop = loop;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    if (loop) { src.loop = true; src.loopStart = loop[0]; src.loopEnd = loop[1]; }
    src.connect(this.out);
    const when = this.ctx.currentTime + 0.06;
    src.start(when, Math.max(0, Math.min(from, this.buffer.duration - 1e-3)));
    this.source = src;
    this.anchor = { ctxTime: when, filmTime: from };
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.time();
    this.stopSource();
    this.playing = false;
  }

  stopSource() {
    if (this.source) { try { this.source.stop(); } catch (e) { /* already stopped */ } this.source.disconnect(); this.source = null; }
  }

  /** Current film time according to the audio output clock. */
  time() {
    if (!this.playing) return this.pausedAt;
    let ft = this.anchor.filmTime + Math.max(0, this._now() - this.anchor.ctxTime);
    if (this.loop) {
      const [a, b] = this.loop;
      if (ft >= b) ft = a + ((ft - a) % (b - a));
    }
    return ft;
  }

  /** WAV of the rendered score. format: 'arraybuffer' | 'base64'. Optional [start, end] seconds. */
  async exportWav({ bitDepth = 24, format = 'arraybuffer', start = 0, end } = {}) {
    const buf = this.buffer || (await this.render());
    const ab = encodeWav(buf, { bitDepth, start, end });
    return format === 'base64' ? arrayBufferToBase64(ab) : ab;
  }
}
