#!/usr/bin/env node
// Bundle the film (Three.js included) into ONE self-contained file: out/film.html.
// No network requests: no CDN, no font files (system font stacks only), worlds inlined.
//
//   node tools/build-html.mjs            # minified
//   node tools/build-html.mjs --no-minify

import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { FILM_ROOT } from './serve.mjs';

const minify = !process.argv.includes('--no-minify');
const t0 = Date.now();
const result = await esbuild.build({
  entryPoints: [path.join(FILM_ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',          // dynamic import()s of worlds are inlined (no code splitting)
  splitting: false,
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox115'],
  minify,
  legalComments: 'inline',
  write: false,
  metafile: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});
let js = result.outputFiles[0].text;
if (/\bimport\s*\(\s*["'`]/.test(js) || /from\s*["'](?:https?:|\.\/)/.test(js)) {
  console.warn('[build] warning: bundle still contains an import() / external import');
}
// keep the inline script from terminating early
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let html = fs.readFileSync(path.join(FILM_ROOT, 'index.html'), 'utf8');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<script type="module" src="[^"]*"><\/script>/, () => `<script type="module">\n${js}\n</script>`);
if (/src="\.\/|href="\.\/|https?:\/\//.test(html.replace(/<script type="module">[\s\S]*<\/script>/, ''))) {
  console.warn('[build] warning: html references external resources');
}
const licenseTexts = [
  fs.readFileSync(path.join(FILM_ROOT, 'LICENSE'), 'utf8'),
  fs.readFileSync(path.join(FILM_ROOT, 'node_modules/three/LICENSE'), 'utf8'),
];
const licensesDir = path.join(FILM_ROOT, 'licenses');
if (fs.existsSync(licensesDir)) {
  for (const file of fs.readdirSync(licensesDir).sort()) {
    if (file.endsWith('.txt')) licenseTexts.push(fs.readFileSync(path.join(licensesDir, file), 'utf8'));
  }
}
const notices = path.join(FILM_ROOT, 'THIRD_PARTY_NOTICES.md');
if (fs.existsSync(notices)) licenseTexts.push(fs.readFileSync(notices, 'utf8'));
html = html.replace('</body>', () => '<script type="text/plain" id="third-party-licenses">\n' + [...new Set(licenseTexts.map(text => text.trim()))].join('\n\n').replace(/<\/script/gi, '<\\/script') + '\n</script>\n</body>');
const outDir = path.join(FILM_ROOT, 'out');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'film.html');
fs.writeFileSync(out, html);
const inputs = Object.keys(result.metafile.inputs).length;
console.log(`[build] ${path.relative(process.cwd(), out)}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB  (${inputs} modules, ${minify ? 'minified' : 'readable'}) in ${Date.now() - t0} ms`);
