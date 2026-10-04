#!/usr/bin/env node
// GPU/CPU cost per frame at given times (forces GPU completion every frame).
//
//   node tools/bench.mjs 4.5 8.5            # ms/frame at 2160x1080 for each time
//   node tools/bench.mjs --shot ph-ridge    # 5 samples across a shot
//   options: --n 40 (frames per sample) --scale 1
//
// Budget: live playback needs < ~12 ms at 1080p for 60 Hz headroom (< 33 ms for a solid 30).
// Dissolves render two shots, so they cost roughly double.

import { startServer } from './serve.mjs';
import { launchBrowser, openFilmPage } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const opt = { n: 40, scale: 1, shot: null };
const times = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--n') opt.n = parseInt(argv[++i], 10);
  else if (argv[i] === '--scale') opt.scale = parseFloat(argv[++i]);
  else if (argv[i] === '--shot') opt.shot = argv[++i];
  else times.push(parseFloat(argv[i]));
}
const server = await startServer();
const { browser } = await launchBrowser();
try {
  const page = await openFilmPage(browser, server.url, { scale: opt.scale, verbose: false });
  let ts = times;
  if (opt.shot) {
    const s = await page.evaluate((id) => window.__film.shots.find((x) => x.id === id), opt.shot);
    if (!s) throw new Error('no shot ' + opt.shot);
    ts = [0.05, 0.25, 0.5, 0.75, 0.95].map((k) => s.start + k * s.duration);
  }
  if (!ts.length) ts = [0];
  for (const t of ts) {
    const ms = await page.evaluate((t, n) => window.__film.benchmark(t, n), t, opt.n);
    const shot = await page.evaluate(() => window.__film.engine.stats.shot);
    console.log(`t=${t.toFixed(2).padStart(7)}  ${ms.toFixed(2).padStart(6)} ms/frame  (${(1000 / ms).toFixed(0)} fps)  ${shot || '(black)'}`);
  }
} finally {
  await browser.close();
  await server.close();
}
