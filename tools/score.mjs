#!/usr/bin/env node
// Render the score headlessly and write it as a WAV (no picture, no engine: only src/audio/*).
//
//   node tools/score.mjs                          # whole score -> out/score.wav (24-bit, 48 kHz stereo)
//   node tools/score.mjs --start 28 --end 46      # only this time range (the whole score is still rendered)
//   options: --out <file>  --bits 16|24  --solo strings,keys   (stems: prologue strings keys ambience spots credits)
//            --only horn,glass  (instrument kinds: strings horn glass kalimba piano drum heart sub bed shot bloop tick creak pew bird sheet thud)
//            --raw (skip loudness normalisation and limiter)  --duration 240
//
// Uses the same Chrome launcher and WAV encoder as tools/render.mjs. The page is an empty document
// on the dev server's origin; it imports src/audio/score.js directly, so this works even while the
// picture code is broken.

import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { startServer, FILM_ROOT } from './serve.mjs';
import { launchBrowser } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const opt = { start: 0, end: null, out: path.join(FILM_ROOT, 'out/score.wav'), bits: 24, solo: null, only: null, raw: false, duration: 240 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], next = () => argv[++i];
  if (a === '--start') opt.start = parseFloat(next());
  else if (a === '--end') opt.end = parseFloat(next());
  else if (a === '--out') opt.out = path.resolve(process.cwd(), next());
  else if (a === '--bits') opt.bits = parseInt(next(), 10);
  else if (a === '--solo') opt.solo = next().split(',');
  else if (a === '--only') opt.only = next().split(',');
  else if (a === '--raw') opt.raw = true;
  else if (a === '--duration') opt.duration = parseFloat(next());
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n')  .slice(1, 8).join('\n')); process.exit(0); }
  else { console.error('unknown argument ' + a); process.exit(2); }
}

const t0 = Date.now();
const server = await startServer();
let gotWav;
const wavDone = new Promise((res) => { gotWav = res; });
const wss = new WebSocketServer({ server: server.server, path: '/__score', maxPayload: 1 << 30 });
wss.on('connection', (ws) => ws.on('message', (data) => { gotWav(Buffer.isBuffer(data) ? data : Buffer.from(data)); ws.send('ack'); }));

const { browser } = await launchBrowser({ verbose: false });
let code = 0;
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log(`[page:${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => console.error('[page:exception]', e.message));
  await page.goto(server.url + '__score_host', { waitUntil: 'load' }); // a 404 text page: same origin, no engine
  const res = await page.evaluate(async (o, wsUrl) => {
    const a = performance.now();
    const { renderScore } = await import('/src/audio/score.js');
    const { encodeWav } = await import('/src/audio/wav.js');
    const sr = 48000;
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(o.duration * sr), sampleRate: sr });
    await renderScore(ctx, o.duration, { solo: o.solo || undefined, only: o.only || undefined, master: !o.raw, now: () => performance.now() });
    const buf = await ctx.startRendering();
    const renderMs = performance.now() - a;
    const ab = encodeWav(buf, { bitDepth: o.bits, start: o.start, end: o.end === null ? undefined : o.end });
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('sink connect failed')); });
    const ack = new Promise((ok) => { ws.onmessage = ok; });
    ws.send(ab);
    await ack;
    return { renderMs, bytes: ab.byteLength, stats: renderScore.stats };
  }, opt, server.url.replace('http', 'ws') + '__score');
  const wav = await wavDone;
  fs.mkdirSync(path.dirname(opt.out), { recursive: true });
  fs.writeFileSync(opt.out, wav);
  console.log(`[score] rendered in ${(res.renderMs / 1000).toFixed(2)} s  ->  ${path.relative(process.cwd(), opt.out)} (${(wav.length / 1e6).toFixed(1)} MB${opt.start || opt.end !== null ? `, range ${opt.start}..${opt.end ?? opt.duration} s` : ''})`);
  console.log('[score] ' + JSON.stringify(res.stats));
  console.log(`[score] total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (err) {
  console.error('[score] FAILED:', err && err.stack || err);
  code = 1;
} finally {
  wss.close();
  await browser.close();
  await server.close();
}
process.exit(code);
