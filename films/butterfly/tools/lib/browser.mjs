// Shared Chrome launcher for render.mjs / still.mjs.
// Launches the system Chrome via puppeteer-core with the GPU enabled, verifies that WebGL is
// hardware accelerated (not SwiftShader), and falls back to a headful window if needed.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  ...(process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(p => p + '/Google/Chrome/Application/chrome.exe') : []),
].filter(Boolean);

export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('Google Chrome not found. Set CHROME_PATH.');
}

const GPU_ARGS = [
  ...(process.env.ANGLE_BACKEND ? ['--use-angle=' + process.env.ANGLE_BACKEND] : process.platform === 'darwin' ? ['--use-angle=metal'] : []),
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--enable-zero-copy',
  '--disable-gpu-driver-bug-workarounds',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--mute-audio',
];

async function probeGL(browser) {
  const page = await browser.newPage();
  try {
    const info = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return { ok: false, renderer: 'no webgl2' };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      return { ok: true, renderer, vendor, float: !!gl.getExtension('EXT_color_buffer_float') };
    });
    info.software = !info.ok || /swiftshader|llvmpipe|software|basic render/i.test(info.renderer || '');
    return info;
  } finally {
    await page.close();
  }
}

/**
 * Launch Chrome with a hardware WebGL2 context.
 * @param {{headful?: boolean, verbose?: boolean, width?: number, height?: number}} opts
 * @returns {Promise<{browser: import('puppeteer-core').Browser, gl: object, mode: string}>}
 */
export async function launchBrowser({ headful = false, verbose = true, width = 1280, height = 800 } = {}) {
  const executablePath = findChrome();
  const tryModes = headful ? ['headful'] : ['headless', 'headful'];
  let lastInfo = null;
  for (const mode of tryModes) {
    const browser = await puppeteer.launch({
      executablePath,
      headless: mode === 'headless' ? true : false,
      args: [...GPU_ARGS, `--window-size=${width},${height}`],
      defaultViewport: { width, height, deviceScaleFactor: 1 },
      protocolTimeout: 0,
    });
    const gl = await probeGL(browser);
    lastInfo = gl;
    if (!gl.software) {
      if (verbose) console.log(`[chrome] ${mode} | ${gl.renderer}`);
      return { browser, gl, mode };
    }
    if (verbose) console.warn(`[chrome] ${mode} gave software GL (${gl.renderer}); trying next mode...`);
    await browser.close();
  }
  throw new Error('Could not get a hardware WebGL2 context: ' + JSON.stringify(lastInfo));
}

/**
 * Open the film page in offline mode and wait until the engine is ready.
 * Forwards page console output prefixed with [page].
 */
export async function openFilmPage(browser, baseUrl, { scale = 1, query = '', verbose = true } = {}) {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const type = msg.type();
    if (!verbose && type !== 'error' && type !== 'warn') return;
    console.log(`[page:${type}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.error('[page:exception]', err.message));
  const url = `${baseUrl}index.html?offline=1&scale=${scale}${query ? '&' + query : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__film && window.__film.ready, { timeout: 60000 });
  await page.evaluate(() => window.__film.ready);
  return page;
}
