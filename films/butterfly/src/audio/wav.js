// WAV encoder: PCM 16-bit (deterministic TPDF dither) or 24-bit, or 32-bit IEEE float (unclipped:
// for pre-master stems, which may run over full scale and must sum exactly).

import { createRng } from '../lib/random.js';

/**
 * @param {AudioBuffer|{numberOfChannels: number, sampleRate: number, length: number, getChannelData: (c: number) => Float32Array}} buffer
 * @param {{bitDepth?: 16|24|32, start?: number, end?: number}} [o]  optional time range (seconds); 32 = float
 * @returns {ArrayBuffer}
 */
export function encodeWav(buffer, { bitDepth = 24, start = 0, end } = {}) {
  const ch = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.round(start * sr));
  const s1 = Math.min(buffer.length, end === undefined ? buffer.length : Math.round(end * sr));
  const n = Math.max(0, s1 - s0);
  const bps = bitDepth / 8;
  const dataBytes = n * ch * bps;
  const ab = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, bitDepth === 32 ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  const rng = createRng('wav-dither');
  let o = 44;
  if (bitDepth === 32) {
    for (let i = s0; i < s1; i++) for (let c = 0; c < ch; c++) { v.setFloat32(o, chans[c][i], true); o += 4; }
  } else if (bitDepth === 16) {
    for (let i = s0; i < s1; i++) {
      for (let c = 0; c < ch; c++) {
        const d = (rng() - rng()) / 32768; // TPDF, 1 LSB
        let x = Math.max(-1, Math.min(1, chans[c][i] + d));
        v.setInt16(o, Math.round(x < 0 ? x * 32768 : x * 32767), true);
        o += 2;
      }
    }
  } else {
    for (let i = s0; i < s1; i++) {
      for (let c = 0; c < ch; c++) {
        const x = Math.max(-1, Math.min(1, chans[c][i]));
        let q = Math.round(x < 0 ? x * 8388608 : x * 8388607);
        if (q < 0) q += 16777216;
        v.setUint8(o, q & 0xff); v.setUint8(o + 1, (q >> 8) & 0xff); v.setUint8(o + 2, (q >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return ab;
}

/**
 * Decode a WAV (PCM 16 / 24-bit or 32-bit float) into Float32Array channels.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {{sampleRate: number, channels: Float32Array[]}}
 */
export function decodeWav(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null;
  while (o + 8 <= u8.length) {
    const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') fmt = { format: v.getUint16(body, true), ch: v.getUint16(body + 2, true), sr: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt');
      const { ch, bits, format } = fmt, bps = bits / 8, n = Math.floor(Math.min(size, u8.length - body) / (bps * ch));
      const chans = Array.from({ length: ch }, () => new Float32Array(n));
      let p = body;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < ch; c++) {
          let x;
          if (format === 3 && bits === 32) x = v.getFloat32(p, true);
          else if (bits === 16) x = v.getInt16(p, true) / 32768;
          else if (bits === 24) { let q = u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16); if (q & 0x800000) q -= 0x1000000; x = q / 8388608; }
          else throw new Error(`unsupported WAV: format ${format}, ${bits} bits`);
          chans[c][i] = x; p += bps;
        }
      }
      return { sampleRate: fmt.sr, channels: chans };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

export function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
