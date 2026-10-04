#!/usr/bin/env node
// Offline render to MP4 (H.264 or HEVC, yuv420p + AAC 320k), frame-exact and deterministic.
//
//   node tools/render.mjs                                   # whole film -> out/film.mp4
//   node tools/render.mjs --start 40 --end 45               # 5 s preview -> out/preview_40-45.mp4
//   node tools/render.mjs --start 40 --end 45 --scale 0.5   # half-res preview (fast)
//   node tools/render.mjs --samples 8                       # final 2160x1080 (2:1, no bars): motion blur, 8 sub-frames/frame
//   node tools/render.mjs --scale 2 --samples 8 --encoder hevc_videotoolbox   # 4320x2160 -> out/film_2160p_hevc.mp4
//   options: --out <file> --scale <k> --no-audio --samples N (shutter accumulation, default 1 = off)
//            --shutter 0.5 (default; shot.shutter wins)
//            --encoder x264 (default) | hevc_videotoolbox | h264_videotoolbox (Apple hardware)
//            x264: --crf 16 --preset medium|slow|veryfast · VideoToolbox: --quality 70 (1-100) | --bitrate 70M
//            --capture yuv|rgba|jpeg  --per-frame  --headful  --verbose
//
// How it works: serves this folder on 127.0.0.1, launches system Chrome (GPU, headless if WebGL is
// hardware accelerated there, else headful), and for each frame i calls
// window.__film.captureFrame(i), which renders t = i / 30 into an RGBA8 target, packs it to
// BT.709 yuv420p on the GPU, reads it back asynchronously (PBO, pipelined one frame) and sends the
// bytes over a WebSocket to this process; they are piped straight into ffmpeg's stdin (no colour
// conversion in ffmpeg). Up to 2 frames are un-acknowledged so rendering overlaps transfer + x264. The score is rendered once in the page (OfflineAudioContext),
// sent as a 24-bit WAV, cached in out/.cache keyed by the audio sources, trimmed to the range and
// muxed in the same ffmpeg pass.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { startServer, FILM_ROOT } from './serve.mjs';
import { launchBrowser, openFilmPage } from './lib/browser.mjs';


const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const argv = process.argv.slice(2);
const opt = { start: 0, end: null, out: null, scale: 1, crf: 16, preset: 'medium', audio: true, capture: 'yuv', headful: false, verbose: false, perFrame: false, samples: 1, shutter: null, encoder: 'x264', quality: 70, bitrate: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '--start') opt.start = parseFloat(next());
  else if (a === '--end') opt.end = parseFloat(next());
  else if (a === '--out') opt.out = next();
  else if (a === '--scale') opt.scale = parseFloat(next());
  else if (a === '--crf') opt.crf = parseFloat(next());
  else if (a === '--preset') opt.preset = next();
  else if (a === '--no-audio') opt.audio = false;
  else if (a === '--samples') opt.samples = Math.max(1, parseInt(next(), 10) || 1);
  else if (a === '--shutter') opt.shutter = parseFloat(next());
  else if (a === '--encoder') opt.encoder = next();
  else if (a === '--quality') opt.quality = parseFloat(next());
  else if (a === '--bitrate') opt.bitrate = next();
  else if (a === '--capture') opt.capture = next();
  else if (a === '--headful') opt.headful = true;
  else if (a === '--per-frame') opt.perFrame = true;
  else if (a === '--verbose' || a === '-v') opt.verbose = true;
  else if (a === '--help' || a === '-h') {
    console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 15).join('\n'));
    process.exit(0);
  } else { console.error('unknown argument ' + a); process.exit(2); }
}

const ENCODERS = { x264: 'libx264', hevc_videotoolbox: 'hevc_videotoolbox', h264_videotoolbox: 'h264_videotoolbox' };
if (!ENCODERS[opt.encoder]) { console.error(`unknown --encoder ${opt.encoder} (${Object.keys(ENCODERS).join(' | ')})`); process.exit(2); }
const VT = opt.encoder !== 'x264';

/** Video encoder arguments. x264 is unchanged; VideoToolbox runs on the Apple media engine. */
function videoCodecArgs() {
  if (!VT) return ['-c:v', 'libx264', '-preset', opt.preset, '-crf', String(opt.crf), '-tune', 'film', '-pix_fmt', 'yuv420p'];
  // constant quality (-q:v, Apple silicon) by default, or an average bitrate with a 1.5x peak cap
  const rate = opt.bitrate
    ? ['-b:v', opt.bitrate, '-maxrate', `${parseFloat(opt.bitrate) * 1.5}${String(opt.bitrate).replace(/^[\d.]+/, '')}`, '-bufsize', opt.bitrate]
    : ['-q:v', String(opt.quality)];
  const args = ['-c:v', ENCODERS[opt.encoder], ...rate, '-allow_sw', '0', '-realtime', '0', '-prio_speed', '0', '-g', '60', '-pix_fmt', 'yuv420p'];
  // hvc1 tag (not hev1): QuickTime, Safari and iOS only play HEVC in MP4 tagged hvc1
  return opt.encoder === 'hevc_videotoolbox' ? [...args, '-profile:v', 'main', '-tag:v', 'hvc1'] : [...args, '-profile:v', 'high'];
}
const ENC_TAG = { x264: '', hevc_videotoolbox: 'hevc', h264_videotoolbox: 'h264vt' }[opt.encoder];

// ------------------------------------------------------------------ determinism lint (warn only)
function lintDeterminism() {
  const dirs = ['src/worlds', 'src/lib'].map((d) => path.join(FILM_ROOT, d));
  const files = ['src/audio/score.js', 'src/audio/synth.js', 'src/timeline.js', 'src/cards.js'].map((f) => path.join(FILM_ROOT, f));
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []) : [];
  const bad = /\bMath\.random\s*\(|\bDate\.now\s*\(|\bperformance\.now\s*\(|new\s+Date\s*\(/;
  for (const f of [...dirs.flatMap(walk), ...files]) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, n) => {
      if (bad.test(line) && !/^\s*\/\//.test(line)) console.warn(`[determinism] ${path.relative(FILM_ROOT, f)}:${n + 1}: ${line.trim()}`);
    });
  }
}

function hashAudioSources() {
  const h = crypto.createHash('sha1');
  const files = ['src/config.js', 'src/timeline.js'];
  const audioDir = path.join(FILM_ROOT, 'src/audio');
  for (const f of fs.readdirSync(audioDir).sort()) files.push(path.join('src/audio', f));
  for (const f of files) h.update(f).update(fs.readFileSync(path.join(FILM_ROOT, f)));
  return h.digest('hex').slice(0, 12);
}

function hasEncoder(name) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return r.stdout && r.stdout.includes(' ' + name + ' ');
}

const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${s.toFixed(1)}s`);

// ------------------------------------------------------------------------------------------ main
lintDeterminism();
const tStart = Date.now();
let ff = null, ffDone = null, expectFrame = 0, received = 0, bytesIn = 0;
let wavFile = null;
const cacheDir = path.join(FILM_ROOT, 'out/.cache');
fs.mkdirSync(cacheDir, { recursive: true });

if (VT && !hasEncoder(ENCODERS[opt.encoder])) { console.error(`ffmpeg has no ${ENCODERS[opt.encoder]} encoder`); process.exit(2); }
const server = await startServer();
// binary sink: the page sends a WAV (when sinkMode === 'wav') and then frames, in order; every
// message is acknowledged after it has been handed to ffmpeg (back-pressure).
let sinkMode = 'frames', frameBytes = 0;
const wss = new WebSocketServer({ server: server.server, path: '/__sink', maxPayload: 1 << 30 });
wss.on('connection', (ws) => {
  let chain = Promise.resolve();
  ws.on('message', (data) => {
    chain = chain.then(async () => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (sinkMode === 'wav') {
        fs.writeFileSync(wavFile, buf);
      } else {
        if (frameBytes && buf.length !== frameBytes) throw new Error(`frame ${expectFrame}: ${buf.length} bytes, expected ${frameBytes}`);
        expectFrame++; received++; bytesIn += buf.length;
        if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
      }
      ws.send('ack');
    }).catch((err) => { console.error('\n[sink]', err.message); ws.close(); });
  });
});

const { browser, gl, mode } = await launchBrowser({ headful: opt.headful });
let exitCode = 0;
try {
  const query = [opt.samples > 1 ? `samples=${opt.samples}` : '', Number.isFinite(opt.shutter) ? `shutter=${opt.shutter}` : ''].filter(Boolean).join('&');
  const page = await openFilmPage(browser, server.url, { scale: opt.scale, verbose: opt.verbose, query });
  const info = await page.evaluate(() => window.__film.info());
  const FPS = info.fps;
  const end = Math.min(opt.end ?? info.duration, info.duration);
  const f0 = Math.max(0, Math.round(opt.start * FPS));
  const f1 = Math.max(f0 + 1, Math.round(end * FPS));
  const nFrames = f1 - f0;
  const rangeStart = f0 / FPS, rangeDur = nFrames / FPS;
  expectFrame = f0;
  const isFull = f0 === 0 && Math.round(info.duration * FPS) === f1;
  const outFile = path.resolve(process.cwd(), opt.out || path.join(FILM_ROOT, 'out', isFull
    ? (ENC_TAG ? `film_${info.height}p_${ENC_TAG}.mp4` : 'film.mp4')
    : `preview_${opt.start}-${end}${opt.scale !== 1 ? '_x' + opt.scale : ''}${info.samples > 1 ? '_s' + info.samples : ''}${ENC_TAG ? '_' + ENC_TAG : ''}.mp4`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  console.log(`[render] ${info.width}x${info.height} @${FPS}fps  frames ${f0}..${f1 - 1} (${nFrames}, ${fmtTime(rangeDur)})  -> ${path.relative(process.cwd(), outFile)}`);
  console.log(`[render] GPU: ${gl.renderer} (${mode})`);
  if (VT) console.log(`[render] encoder ${ENCODERS[opt.encoder]} (hardware) ${opt.bitrate ? 'bitrate ' + opt.bitrate : 'quality ' + opt.quality}`);
  if (info.samples > 1) console.log(`[render] shutter accumulation: ${info.samples} samples/frame, default shutter ${info.shutter} (shot.shutter overrides)`);

  const wsUrl = server.url.replace('http', 'ws') + '__sink';
  const { bytesPerFrame } = await page.evaluate((u, f) => window.__film.connectSink(u, f), wsUrl, opt.capture === 'rgba' ? 'rgba' : 'yuv');
  frameBytes = opt.capture === 'jpeg' ? 0 : bytesPerFrame;

  // ---- audio (cached by source hash)
  if (opt.audio) {
    const key = hashAudioSources();
    wavFile = path.join(cacheDir, `score-${key}.wav`);
    if (fs.existsSync(wavFile)) {
      console.log(`[audio] cached ${path.relative(FILM_ROOT, wavFile)}`);
    } else {
      const t0 = Date.now();
      sinkMode = 'wav';
      const r = await page.evaluate(() => window.__film.sendWav({ bitDepth: 24 }));
      sinkMode = 'frames';
      console.log(`[audio] score rendered (${(r.renderMs / 1000).toFixed(2)} s) + exported ${(r.bytes / 1e6).toFixed(1)} MB in ${Date.now() - t0} ms`);
    }
  }

  // ---- ffmpeg
  const aEnc = hasEncoder('aac_at') ? 'aac_at' : 'aac';
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (opt.capture === 'jpeg') args.push('-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-');
  else if (opt.capture === 'rgba') args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${info.width}x${info.height}`, '-framerate', String(FPS), '-i', '-');
  else args.push('-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-s', `${info.width}x${info.height}`, '-framerate', String(FPS), '-i', '-');
  if (opt.audio) args.push('-ss', rangeStart.toFixed(6), '-t', rangeDur.toFixed(6), '-i', wavFile);
  // stamp BT.709 on the frames themselves (ffmpeg >= 7 takes colour tags from frames, not flags)
  const tag = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
  if (opt.capture !== 'yuv') {
    args.push('-vf', (opt.capture === 'rgba' ? 'vflip,' : '') + 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,' + tag);
  } else {
    args.push('-vf', tag);
  }
  args.push('-map', '0:v');
  if (opt.audio) args.push('-map', '1:a');
  args.push(...videoCodecArgs(),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(FPS));
  if (opt.audio) args.push('-c:a', aEnc, '-b:a', '320k', '-ar', '48000');
  args.push('-movflags', '+faststart', outFile);
  if (opt.verbose) console.log('[ffmpeg]', args.join(' '));
  ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  ffDone = once(ff, 'exit');

  // ---- frames
  const t0 = Date.now();
  const show = (done, cpu, wait, extra = '') => {
    const el = (Date.now() - t0) / 1000;
    const fps = done / Math.max(el, 1e-3);
    process.stdout.write(`\r[render] ${done}/${nFrames} (${((done / nFrames) * 100).toFixed(0)}%)  ${fps.toFixed(1)} fps  eta ${fmtTime((nFrames - done) / Math.max(fps, 1e-3))}  ${extra}`);
  };
  if (opt.capture === 'jpeg') {
    // JPEG over CDP (kept for comparison/debugging: lossy and slower)
    for (let i = f0; i < f1; i++) {
      const durl = await page.evaluate((k) => window.__film.stillDataURL(k, 'image/jpeg', 0.95), i);
      const buf = Buffer.from(durl.slice(durl.indexOf(',') + 1), 'base64');
      expectFrame++; received++; bytesIn += buf.length;
      if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
      if ((i - f0) % 15 === 14 || i === f1 - 1) show(i - f0 + 1);
    }
  } else if (opt.perFrame) {
    // one CDP round trip per frame (slower; useful when debugging a single frame's failure)
    for (let i = f0; i < f1; i++) {
      await page.evaluate((k) => window.__film.captureFrame(k), i);
      if ((i - f0) % 15 === 14 || i === f1 - 1) show(i - f0 + 1);
    }
    await page.evaluate(() => window.__film.flushSink());
  } else {
    // default: the page loops renderFrame(i) -> async readback -> WebSocket; we poll progress
    let finished = false, failure = null;
    const loop = page.evaluate((a, b) => window.__film.captureRange(a, b), f0, f1)
      .then(() => { finished = true; }, (e) => { failure = e; finished = true; });
    while (!finished) {
      await new Promise((r) => setTimeout(r, 500));
      const p = await page.evaluate(() => window.__film.captureProgress).catch(() => null);
      if (p && p.done) show(p.done, 0, 0, `[cpu ${(p.cpuMs / p.done).toFixed(1)} ms/frame, waiting on gpu/readback/encoder ${(p.waitMs / p.done).toFixed(1)} ms/frame]   `);
    }
    await loop;
    if (failure) throw failure;
    show(nFrames);
  }
  process.stdout.write('\n');
  if (received !== nFrames) throw new Error(`sink received ${received} frames, expected ${nFrames}`);
  const frameSecs = (Date.now() - t0) / 1000;
  ff.stdin.end();
  const [code] = await ffDone;
  if (code !== 0) throw new Error('ffmpeg exited with ' + code);
  const encSecs = (Date.now() - t0) / 1000;
  console.log(`[render] ${nFrames} frames captured in ${fmtTime(frameSecs)} (${(nFrames / frameSecs).toFixed(1)} fps), encode finished at ${fmtTime(encSecs)} (${(nFrames / encSecs).toFixed(1)} fps overall)`);

  // ---- report
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,duration,nb_frames,sample_rate,channels', '-of', 'compact', outFile], { encoding: 'utf8' });
  console.log(probe.stdout.trim().split('\n').map((l) => '[probe] ' + l).join('\n'));
  const size = fs.statSync(outFile).size;
  console.log(`[done] ${outFile} (${(size / 1e6).toFixed(1)} MB) total ${fmtTime((Date.now() - tStart) / 1000)}`);
} catch (err) {
  console.error('\n[render] FAILED:', err && err.stack || err);
  exitCode = 1;
  if (ff && !ff.killed) ff.kill('SIGKILL');
} finally {
  wss.close();
  await browser.close();
  await server.close();
}
process.exit(exitCode);
