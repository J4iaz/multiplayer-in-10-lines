'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { connect, waitForMessage, expectNoMessage, byType } = require('./helpers');

let instance;
let wsUrl;
let roomCounter = 0;
const freshRoom = () => `chat-room-${++roomCounter}`;

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
  await waitForMessage(ws, byType('snapshot'));
  return { ws, welcome };
}

test('Chat message sent and received by other clients', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Alice' });
  const b = await join(room, { name: 'Bob' });

  a.ws.send(JSON.stringify({ type: 'chat_send', body: 'Hello everyone! 🎉' }));

  const msgA = await waitForMessage(a.ws, byType('chat'));
  const msgB = await waitForMessage(b.ws, byType('chat'));

  assert.equal(msgA.body, 'Hello everyone! 🎉');
  assert.equal(msgA.name, 'Alice');
  assert.equal(msgA.color, a.welcome.color);
  assert.ok(msgA.id);
  assert.ok(msgA.ts);

  assert.equal(msgB.body, 'Hello everyone! 🎉');
  assert.equal(msgB.name, 'Alice');
  assert.equal(msgB.id, msgA.id);

  // Late joiner receives in-memory history
  const c = await join(room, { name: 'Charlie' });
  const history = await waitForMessage(c.ws, byType('chat_history'));
  assert.ok(Array.isArray(history.messages));
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].body, 'Hello everyone! 🎉');

  a.ws.close();
  b.ws.close();
  c.ws.close();
});

test('Chat body rate-limiting works', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Speedy' });

  // Send 5 messages (rate limit allows 5 msgs per 5s)
  for (let i = 1; i <= 5; i++) {
    a.ws.send(JSON.stringify({ type: 'chat_send', body: `Message ${i}` }));
    const msg = await waitForMessage(a.ws, byType('chat'));
    assert.equal(msg.body, `Message ${i}`);
  }

  // 6th message should trigger rate_limited error
  a.ws.send(JSON.stringify({ type: 'chat_send', body: 'Message 6 (should fail)' }));
  const err = await waitForMessage(a.ws, byType('error'));
  assert.equal(err.code, 'rate_limited');
  assert.match(err.message, /chat rate limit/i);

  a.ws.close();
});

test('Chat typing indicator relayed to other clients but not sender', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Typer' });
  const b = await join(room, { name: 'Watcher' });

  a.ws.send(JSON.stringify({ type: 'chat_typing', on: true }));
  const typing = await waitForMessage(b.ws, byType('chat_typing'));
  assert.equal(typing.name, 'Typer');
  assert.equal(typing.on, true);

  await expectNoMessage(a.ws, byType('chat_typing'), 100);

  a.ws.close();
  b.ws.close();
});

test('Floating reactions broadcast with allowlisted emojis', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Reactor' });
  const b = await join(room, { name: 'Observer' });

  // Allowlisted emoji reaction
  a.ws.send(JSON.stringify({ type: 'reaction', emoji: '🔥' }));
  const [rxA, rxB] = await Promise.all([
    waitForMessage(a.ws, byType('reaction')),
    waitForMessage(b.ws, byType('reaction')),
  ]);

  assert.equal(rxA.emoji, '🔥');
  assert.equal(rxA.name, 'Reactor');
  assert.equal(rxB.emoji, '🔥');

  // Disallowed emoji returns error
  a.ws.send(JSON.stringify({ type: 'reaction', emoji: '🍕' }));
  const err = await waitForMessage(a.ws, byType('error'));
  assert.equal(err.code, 'invalid_reaction');

  a.ws.close();
  b.ws.close();
});

test('Avatar update reflects in presence', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Artist' });
  const b = await join(room, { name: 'Viewer' });

  const avatarSvg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ffd1a4"/></svg>';
  a.ws.send(JSON.stringify({ type: 'set_avatar', avatar: avatarSvg }));

  const presenceB = await waitForMessage(b.ws, (m) => m.type === 'presence' && m.users.some((u) => u.id === a.welcome.clientId && u.avatar === avatarSvg));
  const userA = presenceB.users.find((u) => u.id === a.welcome.clientId);
  assert.equal(userA.avatar, avatarSvg);

  // Oversized avatar (>2KB) is rejected
  const hugeAvatar = '<svg>' + 'x'.repeat(2500) + '</svg>';
  a.ws.send(JSON.stringify({ type: 'set_avatar', avatar: hugeAvatar }));
  const err = await waitForMessage(a.ws, byType('error'));
  assert.equal(err.code, 'invalid_avatar');

  // Clearing avatar (null) removes it from presence
  a.ws.send(JSON.stringify({ type: 'set_avatar', avatar: null }));
  const presenceCleared = await waitForMessage(b.ws, (m) => m.type === 'presence' && m.users.some((u) => u.id === a.welcome.clientId && !u.avatar));
  const userACleared = presenceCleared.users.find((u) => u.id === a.welcome.clientId);
  assert.equal(userACleared.avatar, undefined);

  a.ws.close();
  b.ws.close();
});

test('Expression update broadcasts and reflects in presence', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Smiler' });
  const b = await join(room, { name: 'Friend' });

  a.ws.send(JSON.stringify({ type: 'set_expression', expression: 'happy' }));

  const exprB = await waitForMessage(b.ws, byType('expression'));
  assert.equal(exprB.expression, 'happy');
  assert.equal(exprB.id, a.welcome.clientId);

  const presenceB = await waitForMessage(b.ws, (m) => m.type === 'presence' && m.users.some((u) => u.id === a.welcome.clientId && u.expression === 'happy'));
  const userA = presenceB.users.find((u) => u.id === a.welcome.clientId);
  assert.equal(userA.expression, 'happy');

  a.ws.close();
  b.ws.close();
});
