import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { FILM_ROOT } from './serve.mjs';
import { FPS, WIDTH, HEIGHT, SAMPLE_RATE } from '../src/config.js';
import { LOOK, DURATION, shots } from '../src/timeline.js';
import { SHOT } from '../src/lib/story.js';
import { WORLDS } from '../src/worlds/registry.js';

const files = [];
for (const dir of ['src', 'tools']) {
  for (const entry of fs.readdirSync(path.join(FILM_ROOT, dir), { recursive: true })) {
    if (/\.(mjs|js)$/.test(entry)) files.push(path.join(FILM_ROOT, dir, entry));
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
assert.equal(FPS, 30);
assert.equal(DURATION, 240);
assert.equal(WIDTH, 1920);
assert.equal(HEIGHT, 1080);
assert.equal(SAMPLE_RATE, 48000);
assert.equal(LOOK.letterbox, 2);
assert.equal(Object.keys(SHOT).length, 22);
let end = 0;
for (const shot of shots) {
  assert.equal(shot.start, end, `gap or overlap before ${shot.id}`);
  assert(shot.end > shot.start, `invalid shot ${shot.id}`);
  assert(shot.world in WORLDS, `missing world ${shot.world}`);
  end = shot.end;
}
assert.equal(end, DURATION);
console.log(`PASS: ${files.length} source/tool syntax checks; continuous 240s timeline and registered worlds.`);
