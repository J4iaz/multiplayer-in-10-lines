'use strict';

/**
 * Runs the real public/multiplayer.js in Node against the real server,
 * using the `ws` package as the WebSocket implementation and a tiny location/history shim.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server');
const { waitUntil } = require('./helpers');

let instance;
let port;
let roomCounter = 0;
const freshRoom = () => `client-room-${++roomCounter}`;

function setUrl(href) {
  const url = new URL(href);
  globalThis.location = {
    href: url.href,
    hash: url.hash,
    pathname: url.pathname,
    search: url.search,
  };
}

before(async () => {
  instance = createServer({ roomTtlMs: 60000 });
  port = await instance.listen(0);
  setUrl(`http://127.0.0.1:${port}/`);
  globalThis.history = {
    state: null,
    replaceState(_state, _title, url) {
      setUrl(new URL(url, globalThis.location.href).href);
    },
  };
  require('../public/multiplayer.js');
});

after(() => instance.close());

const opts = (extra) => ({ WebSocket, reconnectBaseMs: 30, reconnectMaxMs: 200, ...extra });
const live = (room) => waitUntil(() => room.status === 'connected', 3000, 'connected');

function serverSocketFor(clientId) {
  for (const ws of instance.wss.clients) if (ws.meta.clientId === clientId) return ws;
  return null;
}

test('exposes a frozen global with join()', () => {
  assert.equal(typeof globalThis.Multiplayer.join, 'function');
  assert.ok(Object.isFrozen(globalThis.Multiplayer));
});

test('room id comes from the URL hash, or is generated and written to it', async () => {
  setUrl(`http://127.0.0.1:${port}/#room=from-hash`);
  const a = Multiplayer.join(opts());
  assert.equal(a.id, 'from-hash');
  a.disconnect();

  setUrl(`http://127.0.0.1:${port}/`);
  const b = Multiplayer.join(opts());
  assert.match(b.id, /^[a-z2-9]{8}$/);
  assert.equal(globalThis.location.hash, `#room=${b.id}`);
  assert.equal(b.shareUrl(), `http://127.0.0.1:${port}/#room=${b.id}`);
  b.disconnect();
});

test('setState syncs between two clients and fires onStateChange', async () => {
  const id = freshRoom();
  const a = Multiplayer.join(opts({ room: id, name: 'A' }));
  const b = Multiplayer.join(opts({ room: id, name: 'B' }));
  await Promise.all([live(a), live(b)]);

  const seen = [];
  b.onStateChange((state, meta) => seen.push({ state, meta }));
  a.setState('todo', { text: 'ship it', done: false });
  assert.deepEqual(a.getState('todo'), { text: 'ship it', done: false }, 'optimistic local write');

  await waitUntil(() => b.getState('todo'), 2000, 'b receives todo');
  assert.deepEqual(b.getState(), { todo: { text: 'ship it', done: false } });
  assert.equal(seen.at(-1).meta.source, 'remote');
  assert.deepEqual(seen.at(-1).meta.keys, ['todo']);

  b.setState({ todo: null });
  await waitUntil(() => a.getState('todo') === undefined, 2000, 'delete propagates');
  a.disconnect();
  b.disconnect();
});

test('getState returns copies that cannot mutate shared state', async () => {
  const a = Multiplayer.join(opts({ room: freshRoom() }));
  await live(a);
  a.setState('obj', { n: 1 });
  const copy = a.getState('obj');
  copy.n = 999;
  a.getState().obj.n = 999;
  assert.deepEqual(a.getState('obj'), { n: 1 });
  a.disconnect();
});

test('presence tracks joins, renames and leaves', async () => {
  const id = freshRoom();
  const a = Multiplayer.join(opts({ room: id, name: 'Alice' }));
  await live(a);
  const b = Multiplayer.join(opts({ room: id, name: 'Bob' }));
  await waitUntil(() => a.getPresence().length === 2, 2000, 'two present');
  assert.deepEqual(a.getPresence().map((u) => u.name).sort(), ['Alice', 'Bob']);

  await live(b);
  b.setName('Bobby');
  await waitUntil(() => a.getPresence().some((u) => u.name === 'Bobby'), 2000, 'rename');

  b.disconnect();
  await waitUntil(() => a.getPresence().length === 1, 2000, 'bob left');
  a.disconnect();
});

test('rapid writes from two clients converge to the same state', async () => {
  const id = freshRoom();
  const a = Multiplayer.join(opts({ room: id }));
  const b = Multiplayer.join(opts({ room: id }));
  await Promise.all([live(a), live(b)]);
  for (let i = 1; i <= 30; i++) {
    a.setState('shared', i);
    b.setState('shared', i * 100);
    a.setState('a-only', i);
  }
  await waitUntil(
    () => JSON.stringify(a.getState()) === JSON.stringify(b.getState()) && a.getState('a-only') === 30 && b.getState('a-only') === 30,
    3000,
    'convergence'
  );
  assert.ok([30, 3000].includes(a.getState('shared')));
  a.disconnect();
  b.disconnect();
});

test('writes made while disconnected are queued and flushed on reconnect', async () => {
  const id = freshRoom();
  // Longer backoff so the offline window is deterministic (first retry after 200-400ms).
  const a = Multiplayer.join(opts({ room: id, name: 'Flaky', reconnectBaseMs: 400 }));
  const b = Multiplayer.join(opts({ room: id, name: 'Stable' }));
  await Promise.all([live(a), live(b)]);

  const statuses = [];
  a.onStatusChange((s) => statuses.push(s.status));

  // Simulate a network drop: kill A's socket from the server side.
  serverSocketFor(a.me.id).terminate();
  await waitUntil(() => a.status !== 'connected', 2000, 'a notices drop');

  a.setState('offline-note', 'written while offline');
  a.setState('offline-note', 'edited again while offline'); // dedup: last write wins
  assert.equal(a.getPendingCount(), 1);
  assert.equal(a.getState('offline-note'), 'edited again while offline');

  b.setState('from-b', 'b kept working');

  await live(a);
  await waitUntil(() => b.getState('offline-note') === 'edited again while offline', 3000, 'queue flushed to b');
  await waitUntil(() => a.getState('from-b') === 'b kept working', 3000, 'a got b changes via snapshot');
  assert.equal(a.getPendingCount(), 0);
  assert.ok(statuses.includes('reconnecting'));
  a.disconnect();
  b.disconnect();
});

test('validates input before sending', async () => {
  const a = Multiplayer.join(opts({ room: freshRoom() }));
  try {
    assert.throws(() => a.setState('bad key!', 1), TypeError);
    assert.throws(() => a.setState('__proto__', 1), TypeError);
    assert.throws(() => a.setState(JSON.parse('{"__proto__":{"polluted":true}}')), TypeError);
    assert.equal({}.polluted, undefined);
    assert.throws(() => a.setState('big', 'x'.repeat(11 * 1024)), RangeError);
    const circular = {};
    circular.self = circular;
    assert.throws(() => a.setState('loop', circular), TypeError);
    assert.throws(() => Multiplayer.join(opts({ room: 'no spaces allowed' })), TypeError);
  } finally {
    a.disconnect();
  }
  assert.throws(() => a.setState('x', 1), /disconnected/);
});