#!/usr/bin/env node
// Render single frames to PNG.
//
//   node tools/still.mjs 12.5 47 130 --out stills/      # times in seconds
//   node tools/still.mjs --frames 375 1410 --out stills/ # frame indices instead
//   node tools/still.mjs 3 --scale 0.5                   # half resolution (960x540)
//   node tools/still.mjs --shot ph-ridge                 # 5 stills spread across a shot
//   node tools/still.mjs 68 --samples 8                  # motion blur: 8 sub-frames (--shutter 0.5)
//
// Files are named <out>/t<seconds>_f<frame>_<shot>.png (+ _s<N> with --samples N > 1).
// Exit code 1 on page errors.

import fs from 'node:fs';
import path from 'node:path';
import { startServer, FILM_ROOT } from './serve.mjs';
import { launchBrowser, openFilmPage } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const opt = { out: 'stills', scale: 1, frames: false, headful: false, shot: null, verbose: false, samples: 1, shutter: null };
const values = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opt.out = argv[++i];
  else if (a === '--scale') opt.scale = parseFloat(argv[++i]);
  else if (a === '--frames') opt.frames = true;
  else if (a === '--headful') opt.headful = true;
  else if (a === '--shot') opt.shot = argv[++i];
  else if (a === '--samples') opt.samples = Math.max(1, parseInt(argv[++i], 10) || 1);
  else if (a === '--shutter') opt.shutter = parseFloat(argv[++i]);
  else if (a === '--verbose' || a === '-v') opt.verbose = true;
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 11).join('\n')); process.exit(0); }
  else values.push(parseFloat(a));
}

const outDir = path.resolve(process.cwd(), opt.out);
fs.mkdirSync(outDir, { recursive: true });

const server = await startServer();
const { browser } = await launchBrowser({ headful: opt.headful });
let errors = 0;
try {
  const query = [opt.samples > 1 ? `samples=${opt.samples}` : '', Number.isFinite(opt.shutter) ? `shutter=${opt.shutter}` : ''].filter(Boolean).join('&');
  const page = await openFilmPage(browser, server.url, { scale: opt.scale, verbose: opt.verbose, query });
  page.on('pageerror', () => errors++);
  const info = await page.evaluate(() => window.__film.info());
  if (info.samples > 1) console.log(`[still] shutter accumulation: ${info.samples} samples, default shutter ${info.shutter} (shot.shutter overrides)`);
  const FPS = info.fps;
  let frames;
  if (opt.shot) {
    const shot = await page.evaluate((id) => window.__film.shots.find((s) => s.id === id), opt.shot);
    if (!shot) throw new Error(`no shot "${opt.shot}"`);
    frames = [0.02, 0.25, 0.5, 0.75, 0.98].map((k) => Math.floor((shot.start + k * shot.duration) * FPS));
  } else {
    frames = values.filter((v) => Number.isFinite(v)).map((v) => (opt.frames ? Math.round(v) : Math.round(v * FPS)));
  }
  if (!frames.length) frames = [0];
  for (const f of frames) {
    const t0 = Date.now();
    const url = await page.evaluate((i) => window.__film.stillDataURL(i), f);
    const shotId = await page.evaluate(() => window.__film.engine.stats.shot || 'black');
    const t = f / FPS;
    const name = `t${t.toFixed(3).padStart(7, '0')}_f${String(f).padStart(5, '0')}_${shotId.replace(/[^\w.-]+/g, '+')}${info.samples > 1 ? '_s' + info.samples : ''}.png`;
    const file = path.join(outDir, name);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${path.relative(FILM_ROOT, file) || file}  (${info.width}x${info.height}, ${Date.now() - t0} ms)`);
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors) { console.error(`${errors} page error(s)`); process.exit(1); }
