'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { connect, waitForMessage, expectNoMessage, waitForClose, byType } = require('./helpers');

let instance;
let httpUrl;
let wsUrl;
let roomCounter = 0;
const freshRoom = () => `test-room-${++roomCounter}`;

before(async () => {
  instance = createServer({ roomTtlMs: 60000 });
  const port = await instance.listen(0);
  httpUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

after(() => instance.close());

async function join(room, extra = {}) {
  const ws = await connect(wsUrl);
  ws.send(JSON.stringify({ type: 'join', room, ...extra }));
  const welcome = await waitForMessage(ws, byType('welcome'));
  const snapshot = await waitForMessage(ws, byType('snapshot'));
  return { ws, welcome, snapshot };
}

const presenceWith = (n) => (m) => m.type === 'presence' && m.users.length === n;

test('GET /health returns ok', async () => {
  const res = await fetch(`${httpUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('serves the library and the demo page', async () => {
  const lib = await fetch(`${httpUrl}/multiplayer.js`);
  assert.equal(lib.status, 200);
  assert.match(lib.headers.get('content-type'), /javascript/);
  const page = await fetch(`${httpUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sticky Board/);
});

test('join returns welcome, empty snapshot and presence', async () => {
  const { ws, welcome, snapshot } = await join(freshRoom(), { name: 'Ada', clientId: 'client-aaaaaaaa' });
  assert.equal(welcome.clientId, 'client-aaaaaaaa');
  assert.equal(welcome.name, 'Ada');
  assert.match(welcome.color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(snapshot.state, {});
  const presence = await waitForMessage(ws, presenceWith(1));
  assert.deepEqual(presence.users[0], {
    id: 'client-aaaaaaaa',
    userId: 'guest-client-aaaaaaaa',
    name: 'Ada',
    color: welcome.color,
    role: 'editor',
  });
  ws.close();
});

test('set_state is broadcast to every client, including the sender', async () => {
  const room = freshRoom();
  const a = await join(room);
  const b = await join(room);
  a.ws.send(JSON.stringify({ type: 'set_state', patch: { count: 1, title: 'hi' } }));
  const [ua, ub] = await Promise.all([waitForMessage(a.ws, byType('state_update')), waitForMessage(b.ws, byType('state_update'))]);
  for (const u of [ua, ub]) {
    assert.deepEqual(u.patch, { count: 1, title: 'hi' });
    assert.equal(u.from, a.welcome.clientId);
    assert.equal(u.version, 1);
  }
  a.ws.close();
  b.ws.close();
});

test('late joiner receives current state in snapshot; null deletes keys', async () => {
  const room = freshRoom();
  const a = await join(room);
  a.ws.send(JSON.stringify({ type: 'set_state', patch: { keep: { x: 1 }, drop: true } }));
  await waitForMessage(a.ws, byType('state_update'));
  a.ws.send(JSON.stringify({ type: 'set_state', patch: { drop: null } }));
  await waitForMessage(a.ws, byType('state_update'));
  const late = await join(room);
  assert.deepEqual(late.snapshot.state, { keep: { x: 1 } });
  assert.equal(late.snapshot.version, 2);
  a.ws.close();
  late.ws.close();
});

test('disconnect removes the user from presence', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'A' });
  const b = await join(room, { name: 'B' });
  await waitForMessage(a.ws, presenceWith(2));
  b.ws.close();
  const presence = await waitForMessage(a.ws, presenceWith(1));
  assert.equal(presence.users[0].name, 'A');
  a.ws.close();
});

test('rejoining with the same clientId replaces the stale socket', async () => {
  const room = freshRoom();
  const clientId = 'same-client-123';
  const first = await join(room, { clientId });
  const closed = waitForClose(first.ws);
  const second = await join(room, { clientId });
  assert.equal((await closed).code, 4409);
  const presence = await waitForMessage(second.ws, byType('presence'));
  assert.equal(presence.users.length, 1);
  assert.equal(presence.users[0].id, clientId);
  second.ws.close();
});

test('reconnecting client gets a fresh snapshot and its queued writes reach others', async () => {
  const room = freshRoom();
  const clientId = 'offline-client-1';
  const a = await join(room, { clientId });
  const b = await join(room);
  a.ws.close();
  await waitForMessage(b.ws, presenceWith(1));

  // B keeps editing while A is offline
  b.ws.send(JSON.stringify({ type: 'set_state', patch: { fromB: 'while you were away' } }));
  await waitForMessage(b.ws, byType('state_update'));

  // A comes back: snapshot includes B's change, then A flushes its offline queue
  const back = await join(room, { clientId });
  assert.deepEqual(back.snapshot.state, { fromB: 'while you were away' });
  back.ws.send(JSON.stringify({ type: 'set_state', patch: { fromA: 'queued offline' } }));
  const update = await waitForMessage(b.ws, (m) => m.type === 'state_update' && 'fromA' in m.patch);
  assert.equal(update.from, clientId);
  back.ws.close();
  b.ws.close();
});

test('room state survives after everyone leaves (within TTL)', async () => {
  const room = freshRoom();
  const a = await join(room);
  a.ws.send(JSON.stringify({ type: 'set_state', patch: { persisted: 42 } }));
  await waitForMessage(a.ws, byType('state_update'));
  a.ws.close();
  await waitForClose(a.ws);
  await new Promise((r) => setTimeout(r, 50));
  const again = await join(room);
  assert.deepEqual(again.snapshot.state, { persisted: 42 });
  again.ws.close();
});

test('cursor_move is relayed to others but not echoed to the sender', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Mover' });
  const b = await join(room);
  a.ws.send(JSON.stringify({ type: 'cursor_move', x: 10.123, y: 20 }));
  const cursor = await waitForMessage(b.ws, byType('cursor'));
  assert.deepEqual(cursor, { type: 'cursor', id: a.welcome.clientId, name: 'Mover', color: a.welcome.color, x: 10.1, y: 20 });
  await expectNoMessage(a.ws, byType('cursor'));

  a.ws.send(JSON.stringify({ type: 'cursor_move', x: 'evil', y: 1 }));
  await expectNoMessage(b.ws, byType('cursor'));
  a.ws.close();
  b.ws.close();
});

test('invalid room id is rejected and the socket closed', async () => {
  const ws = await connect(wsUrl);
  const closed = waitForClose(ws);
  ws.send(JSON.stringify({ type: 'join', room: '../../etc/passwd' }));
  const err = await waitForMessage(ws, byType('error'));
  assert.equal(err.code, 'invalid_room');
  assert.equal((await closed).code, 4400);
});

test('oversized values and forbidden keys are rejected without changing state', async () => {
  const room = freshRoom();
  const a = await join(room);

  a.ws.send(JSON.stringify({ type: 'set_state', patch: { big: 'x'.repeat(11 * 1024) } }));
  const e1 = await waitForMessage(a.ws, byType('error'));
  assert.equal(e1.code, 'invalid_patch');
  assert.deepEqual(e1.keys, ['big']);

  a.ws.send('{"type":"set_state","patch":{"__proto__":{"polluted":true}}}');
  const e2 = await waitForMessage(a.ws, byType('error'));
  assert.equal(e2.code, 'invalid_patch');
  assert.equal({}.polluted, undefined);

  a.ws.send(JSON.stringify({ type: 'set_state', patch: { 'bad key!': 1 } }));
  assert.equal((await waitForMessage(a.ws, byType('error'))).code, 'invalid_patch');

  const check = await join(room);
  assert.deepEqual(check.snapshot.state, {});
  a.ws.close();
  check.ws.close();
});

test('protocol errors: not joined, bad json, unknown type; ping gets pong', async () => {
  const ws = await connect(wsUrl);
  ws.send(JSON.stringify({ type: 'set_state', patch: { a: 1 } }));
  assert.equal((await waitForMessage(ws, byType('error'))).code, 'not_joined');
  ws.send('not json');
  assert.equal((await waitForMessage(ws, byType('error'))).code, 'bad_json');
  ws.send(JSON.stringify({ type: 'teleport' }));
  assert.equal((await waitForMessage(ws, byType('error'))).code, 'unknown_type');
  ws.send(JSON.stringify({ type: 'ping', t: 123 }));
  assert.equal((await waitForMessage(ws, byType('pong'))).t, 123);
  ws.close();
});

test('set_name sanitizes the name and broadcasts presence', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Old' });
  await waitForMessage(a.ws, presenceWith(1));
  a.ws.send(JSON.stringify({ type: 'set_name', name: '  New\u0000Name' + 'x'.repeat(100) }));
  const presence = await waitForMessage(a.ws, byType('presence'));
  assert.equal(presence.users[0].name.length, 50);
  assert.ok(presence.users[0].name.startsWith('NewName'));
  a.ws.close();
});