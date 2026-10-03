import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Execute the production sink/API block with a CPU-only WebSocket and audio/readback mock.
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('const sink =');
const end = source.indexOf('window.__film = api;') + 'window.__film = api;'.length;
assert(start >= 0 && end > start);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const sockets = [];
  class Socket {
    constructor() { this.sent = []; sockets.push(this); }
    send(bytes) { this.sent.push(Array.from(new Uint8Array(bytes.buffer || bytes))); }
    open() { this.onopen?.(); }
    ack() { this.onmessage?.({ data: 'ack' }); }
    close() { this.onclose?.(); }
    error() { this.onerror?.(); }
  }
  const context = vm.createContext({ WebSocket: Socket, FPS: 30, DURATION: 240, W: 16, H: 8, scale: 1, MOTION: {}, canvas: {}, window: {}, player: null, performance,
    engine: { shots: [], stats: {}, info: () => ({}) },
    audio: { render: async () => {}, exportWav: async () => new Uint8Array([1, 2, 3]).buffer, renderMs: 1 },
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.test = {sink, waitAck, sendOldestRead, api};', context);
  return { ...context.test, sockets };
}

for (const event of ['close', 'error']) {
  const f = fixture();
  const connecting = f.api.connectSink('ws://mock');
  const rejected = assert.rejects(connecting, /sink connection/);
  f.sockets[0][event]();
  await rejected;
  await assert.rejects(f.waitAck(), /sink connection/);
}
for (const event of ['close', 'error']) {
  const f = fixture();
  const connecting = f.api.connectSink('ws://mock'); f.sockets[0].open(); await connecting;
  const pending = [f.waitAck(), f.waitAck()].map(promise => assert.rejects(promise, /sink connection/));
  f.sockets[0][event](); await Promise.all(pending);
  assert.equal(f.sink.waiters.length, 0);
  await assert.rejects(f.waitAck(), /sink connection/);
  await assert.rejects(f.api.flushSink(), /sink connection/);
  await assert.rejects(f.api.sendWav(), /sink connection/);
}
for (const event of ['close', 'error']) {
  const f = fixture();
  const connecting = f.api.connectSink('ws://mock'); f.sockets[0].open(); await connecting;
  const rejected = assert.rejects(f.api.sendWav(), /sink connection/);
  await tick(); assert.equal(f.sockets[0].sent.length, 1);
  f.sockets[0][event](); await rejected;
}
{
  const f = fixture();
  const connecting = f.api.connectSink('ws://mock'); const ws = f.sockets[0]; ws.open(); await connecting;
  for (const byte of [1, 2]) { f.sink.reads.push({ buf: new Uint8Array([byte]), promise: Promise.resolve() }); await f.sendOldestRead(); }
  f.sink.reads.push({ buf: new Uint8Array([3]), promise: Promise.resolve() });
  let sent = false;
  const third = f.sendOldestRead().then(() => { sent = true; });
  await tick(); assert.equal(ws.sent.length, 2); assert.equal(sent, false);
  ws.ack(); await third; assert.deepEqual(ws.sent.map(bytes => bytes[0]), [1, 2, 3]);
  const flushed = f.api.flushSink(); ws.ack(); await tick(); ws.ack(); await flushed;
  assert.equal(f.sink.inflight, 0); assert.equal(f.sink.waiters.length, 0);
  const wav = f.api.sendWav(); await tick(); ws.ack(); await wav;
  assert.equal(f.sink.inflight, 0);
}
console.log('PASS: CPU production sink mock: pre-open close/error, all pending/future ACK rejection, WAV failure, normal ACK and two-frame backpressure.');
