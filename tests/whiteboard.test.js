'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { connect, waitForMessage, byType } = require('./helpers');

let instance;
let wsUrl;
let roomCounter = 0;
const freshRoom = () => `whiteboard-room-${++roomCounter}`;

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

test('ephemeral draw_live broadcast to other clients (not sender)', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Alice' });
  const b = await join(room, { name: 'Bob' });

  const liveData = {
    type: 'draw_live',
    id: 'stroke-live-101',
    tool: 'pencil',
    color: '#96d7ff',
    width: 4,
    points: [100, 200, 110, 210, 120, 220],
  };

  a.ws.send(JSON.stringify(liveData));

  // Bob receives draw_live with from clientId and properties
  const received = await waitForMessage(b.ws, byType('draw_live'));
  assert.equal(received.id, 'stroke-live-101');
  assert.equal(received.tool, 'pencil');
  assert.equal(received.color, '#96d7ff');
  assert.equal(received.width, 4);
  assert.deepEqual(received.points, [100, 200, 110, 210, 120, 220]);
  assert.equal(received.from, a.welcome.clientId);

  // Ensure Alice does not receive its own draw_live echoed back
  let echoed = false;
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 80));
  const messagePromise = waitForMessage(a.ws, byType('draw_live')).then(() => {
    echoed = true;
  });
  await Promise.race([timeoutPromise, messagePromise]);
  assert.equal(echoed, false);

  a.ws.close();
  b.ws.close();
});

test('obj:<id> saves and syncs to late joiners in snapshot', async () => {
  const room = freshRoom();
  const a = await join(room, { name: 'Alice' });
  const b = await join(room, { name: 'Bob' });

  const strokeData = {
    type: 'stroke',
    tool: 'pencil',
    color: '#ff0055',
    width: 6,
    points: [50, 50, 80, 80, 120, 100],
    author: 'Alice',
  };

  // Alice commits the stroke object
  a.ws.send(JSON.stringify({
    type: 'set_state',
    patch: {
      'obj:stroke-perm-1': strokeData,
    },
  }));

  // Both Alice and Bob receive state_update
  const updateA = await waitForMessage(a.ws, byType('state_update'));
  assert.deepEqual(updateA.patch['obj:stroke-perm-1'], strokeData);

  const updateB = await waitForMessage(b.ws, byType('state_update'));
  assert.deepEqual(updateB.patch['obj:stroke-perm-1'], strokeData);

  // Late joiner Charlie connects and gets the object in snapshot
  const c = await join(room, { name: 'Charlie' });
  assert.ok(c.snapshot.state['obj:stroke-perm-1']);
  assert.deepEqual(c.snapshot.state['obj:stroke-perm-1'], strokeData);

  a.ws.close();
  b.ws.close();
  c.ws.close();
});

test('viewers cannot send obj:<id> (read_only rejection)', async () => {
  const room = freshRoom();
  const host = await join(room, { name: 'Host' });
  const viewer = await join(room, { name: 'ViewerUser' });

  // Demote second user to viewer
  host.ws.send(JSON.stringify({
    type: 'host_action',
    action: 'set_role',
    targetId: viewer.welcome.clientId,
    role: 'viewer',
  }));
  await waitForMessage(viewer.ws, byType('role_change'));

  // Viewer attempts to send obj:<id> stroke
  viewer.ws.send(JSON.stringify({
    type: 'set_state',
    patch: {
      'obj:forbidden-stroke': {
        type: 'stroke',
        points: [0, 0, 10, 10],
      },
    },
  }));

  const err = await waitForMessage(viewer.ws, byType('error'));
  assert.equal(err.code, 'read_only');
  assert.match(err.message, /read-only|viewers cannot/i);

  // Late joiner should not see the forbidden object
  const late = await join(room, { name: 'Late' });
  assert.equal(late.snapshot.state['obj:forbidden-stroke'], undefined);

  host.ws.close();
  viewer.ws.close();
  late.ws.close();
});

test('viewers cannot send draw_live (read_only rejection)', async () => {
  const room = freshRoom();
  const host = await join(room, { name: 'Host' });
  const viewer = await join(room, { name: 'ViewerUser' });

  // Demote
  host.ws.send(JSON.stringify({
    type: 'host_action',
    action: 'set_role',
    targetId: viewer.welcome.clientId,
    role: 'viewer',
  }));
  await waitForMessage(viewer.ws, byType('role_change'));

  // Viewer attempts draw_live
  viewer.ws.send(JSON.stringify({
    type: 'draw_live',
    id: 'stroke-viewer',
    tool: 'pencil',
    color: '#fff',
    width: 2,
    points: [1, 2, 3, 4],
  }));

  const err = await waitForMessage(viewer.ws, byType('error'));
  assert.equal(err.code, 'read_only');

  host.ws.close();
  viewer.ws.close();
});
