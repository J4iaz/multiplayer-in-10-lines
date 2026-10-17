'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { connect, waitForMessage, waitForClose, byType } = require('./helpers');

let instance;
let wsUrl;
let roomCounter = 0;
const freshRoom = () => `roles-room-${++roomCounter}`;

before(async () => {
  instance = createServer({ roomTtlMs: 60000 });
  const port = await instance.listen(0);
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

test('room creator gets owner role, second user gets editor', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'HostAlice' });
  assert.equal(a.welcome.role, 'owner');

  const b = await join(room, { name: 'EditorBob' });
  assert.equal(b.welcome.role, 'editor');

  const presenceMsg = await waitForMessage(a.ws, (m) => m.type === 'presence' && m.users.length === 2);
  const users = presenceMsg.users;
  const alice = users.find((u) => u.name === 'HostAlice');
  const bob = users.find((u) => u.name === 'EditorBob');
  assert.ok(alice);
  assert.equal(alice.role, 'owner');
  assert.ok(bob);
  assert.equal(bob.role, 'editor');

  a.ws.close();
  b.ws.close();
});

test('viewer role cannot mutate state (set_state returns read_only error)', async () => {
  const room = freshRoom();
  const host = await join(room, { name: 'Host' });
  const user = await join(room, { name: 'Member' });

  // Host sets user role to viewer
  host.ws.send(JSON.stringify({
    type: 'host_action',
    action: 'set_role',
    targetId: user.welcome.clientId,
    role: 'viewer',
  }));

  const roleChange = await waitForMessage(user.ws, byType('role_change'));
  assert.equal(roleChange.role, 'viewer');

  // Viewer attempts set_state
  user.ws.send(JSON.stringify({
    type: 'set_state',
    patch: { testNote: 'should fail' },
  }));

  const err = await waitForMessage(user.ws, byType('error'));
  assert.equal(err.code, 'read_only');
  assert.match(err.message, /viewers cannot edit/i);

  // Host state should be empty
  const roomState = instance.rooms.get(room).state;
  assert.equal(roomState.has('testNote'), false);

  host.ws.close();
  user.ws.close();
});

test('host action kick disconnects user with code 4403', async () => {
  const room = freshRoom();
  const host = await join(room, { name: 'Host' });
  const badUser = await join(room, { name: 'BadUser' });

  const closedPromise = waitForClose(badUser.ws);

  host.ws.send(JSON.stringify({
    type: 'host_action',
    action: 'kick',
    targetId: badUser.welcome.clientId,
  }));

  const err = await waitForMessage(badUser.ws, byType('error'));
  assert.equal(err.code, 'kicked');
  assert.match(err.message, /kicked by the host/i);

  const closed = await closedPromise;
  assert.equal(closed.code, 4403);

  host.ws.close();
});

test('locked room rejects new joins with room_locked', async () => {
  const room = freshRoom();
  const host = await join(room, { name: 'Host' });

  // Lock the room
  host.ws.send(JSON.stringify({
    type: 'host_action',
    action: 'lock_room',
    value: true,
  }));

  const hostEvent = await waitForMessage(host.ws, byType('host_event'));
  assert.equal(hostEvent.action, 'lock_room');
  assert.equal(hostEvent.value, true);

  // New joiner attempts to enter
  const newClient = await connect(wsUrl);
  const closedPromise = waitForClose(newClient);
  newClient.send(JSON.stringify({ type: 'join', room, name: 'LateJoiner' }));

  const err = await waitForMessage(newClient, byType('error'));
  assert.equal(err.code, 'room_locked');
  assert.match(err.message, /locked by host/i);

  const closed = await closedPromise;
  assert.equal(closed.code, 4403);

  host.ws.close();
});

test('password-protected room rejects wrong password with bad_password and succeeds with correct password', async () => {
  const room = freshRoom();
  const host = await join(room, { name: 'Host', setPassword: 'correct-password-42' });
  assert.equal(host.welcome.hasPassword, true);

  // Wrong password attempt
  const wrongClient = await connect(wsUrl);
  const closedPromise = waitForClose(wrongClient);
  wrongClient.send(JSON.stringify({ type: 'join', room, name: 'Intruder', password: 'wrong-guess' }));

  const err = await waitForMessage(wrongClient, byType('error'));
  assert.equal(err.code, 'bad_password');
  assert.match(err.message, /incorrect room password/i);

  const closed = await closedPromise;
  assert.equal(closed.code, 4403);

  // Correct password attempt
  const validClient = await join(room, { name: 'GoodFriend', password: 'correct-password-42' });
  assert.equal(validClient.welcome.role, 'editor');

  host.ws.close();
  validClient.ws.close();
});

test('rate-limiting of failed password attempts', async () => {
  const room = freshRoom();
  const host = await join(room, { name: 'Host', setPassword: 'ultra-secret-pass' });

  // Perform 5 failed attempts
  for (let i = 1; i <= 5; i++) {
    const ws = await connect(wsUrl);
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: 'join', room, name: `Attacker-${i}`, password: 'bad' }));
    const err = await waitForMessage(ws, byType('error'));
    assert.equal(err.code, 'bad_password');
    assert.match(err.message, /incorrect room password/i);
    await closed;
  }

  // 6th attempt should be rate limited
  const blockedWs = await connect(wsUrl);
  const blockedClosed = waitForClose(blockedWs);
  blockedWs.send(JSON.stringify({ type: 'join', room, name: 'Attacker-6', password: 'bad' }));
  const rateLimitErr = await waitForMessage(blockedWs, byType('error'));
  assert.equal(rateLimitErr.code, 'bad_password');
  assert.match(rateLimitErr.message, /too many failed attempts/i);
  await blockedClosed;

  host.ws.close();
});
