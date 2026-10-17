'use strict';

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { connect, waitForMessage, waitForClose, byType } = require('./helpers');

let instance;
let wsUrl;
let originalAllowGuests;
let originalSupabaseUrl;
let roomCounter = 0;
const freshRoom = () => `auth-room-${++roomCounter}`;

before(async () => {
  instance = createServer({ roomTtlMs: 60000 });
  const port = await instance.listen(0);
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

after(() => instance.close());

beforeEach(() => {
  originalAllowGuests = process.env.ALLOW_GUESTS;
  originalSupabaseUrl = process.env.SUPABASE_URL;
});

afterEach(() => {
  if (originalAllowGuests !== undefined) process.env.ALLOW_GUESTS = originalAllowGuests;
  else delete process.env.ALLOW_GUESTS;

  if (originalSupabaseUrl !== undefined) process.env.SUPABASE_URL = originalSupabaseUrl;
  else delete process.env.SUPABASE_URL;
});

test('Tokenless join succeeds when ALLOW_GUESTS !== "false"', async () => {
  delete process.env.ALLOW_GUESTS;
  const ws = await connect(wsUrl);
  ws.send(JSON.stringify({ type: 'join', room: freshRoom(), name: 'Ada Guest' }));

  const welcome = await waitForMessage(ws, byType('welcome'));
  assert.equal(welcome.name, 'Ada Guest');
  assert.equal(welcome.role, 'owner');
  assert.ok(welcome.user);
  assert.equal(welcome.user.role, 'editor');
  assert.equal(welcome.user.isGuest, true);
  assert.ok(welcome.user.id.startsWith('guest-'));

  const presence = await waitForMessage(ws, byType('presence'));
  assert.equal(presence.users[0].name, 'Ada Guest');
  assert.equal(presence.users[0].role, 'owner');
  assert.equal(presence.users[0].userId, welcome.user.id);

  ws.close();
});

test('Tokenless join rejected with 4401 auth_required when ALLOW_GUESTS="false" and SUPABASE_URL is set', async () => {
  process.env.ALLOW_GUESTS = 'false';
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';

  const ws = await connect(wsUrl);
  const closedPromise = waitForClose(ws);
  ws.send(JSON.stringify({ type: 'join', room: freshRoom(), name: 'Anonymous' }));

  const err = await waitForMessage(ws, byType('error'));
  assert.equal(err.code, 'auth_required');
  assert.match(err.message, /authentication required/i);

  const closed = await closedPromise;
  assert.equal(closed.code, 4401);
});

test('Invalid token rejected with 4401 auth_expired', async () => {
  const ws = await connect(wsUrl);
  const closedPromise = waitForClose(ws);
  ws.send(JSON.stringify({ type: 'join', room: freshRoom(), name: 'Hacker', token: 'invalid-token-12345' }));

  const err = await waitForMessage(ws, byType('error'));
  assert.equal(err.code, 'auth_expired');
  assert.match(err.message, /failed or token expired/i);

  const closed = await closedPromise;
  assert.equal(closed.code, 4401);
});

test('Valid mock token receives welcome with role "owner" as room creator and user metadata', async () => {
  const ws = await connect(wsUrl);
  ws.send(JSON.stringify({
    type: 'join',
    room: freshRoom(),
    name: 'Fallback Name',
    token: 'mock-valid-token',
  }));

  const welcome = await waitForMessage(ws, byType('welcome'));
  assert.equal(welcome.role, 'owner');
  assert.ok(welcome.user);
  assert.equal(welcome.user.role, 'editor');
  assert.equal(welcome.user.id, 'mock-user-123');
  assert.equal(welcome.user.email, 'mockuser@example.com');
  assert.equal(welcome.user.name, 'Mock User');
  assert.equal(welcome.name, 'Mock User');

  const presence = await waitForMessage(ws, byType('presence'));
  assert.equal(presence.users[0].name, 'Mock User');
  assert.equal(presence.users[0].userId, 'mock-user-123');
  assert.equal(presence.users[0].role, 'owner');

  ws.close();
});
