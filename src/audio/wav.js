// PCM WAV encoder (16-bit with deterministic TPDF dither, or 24-bit).

import { createRng } from '../lib/random.js';

/**
 * @param {AudioBuffer} buffer
 * @param {{bitDepth?: 16|24, start?: number, end?: number}} [o]  optional time range (seconds)
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
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  const rng = createRng('wav-dither');
  let o = 44;
  if (bitDepth === 16) {
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

export function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
