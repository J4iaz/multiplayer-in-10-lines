'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { connect, waitForMessage } = require('./helpers');

test('Feature C: WebRTC Video Calling & ICE Config', async (t) => {
  const instance = createServer({ roomTtlMs: 0 });
  const port = await instance.listen(0);
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const httpUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    instance.close();
  });

  await t.test('GET /api/ice returns STUN/TURN configuration', async () => {
    const res = await fetch(`${httpUrl}/api/ice`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.iceServers));
    assert.ok(data.iceServers.length > 0);
    assert.ok(data.iceServers[0].urls.some((u) => u.includes('stun:')));
  });

  await t.test('rtc_join announces peer and sends peers list', async () => {
    const room = 'video-test-room-1';
    const ws1 = await connect(wsUrl);
    const ws2 = await connect(wsUrl);

    // Join room
    ws1.send(JSON.stringify({ type: 'join', room, name: 'User 1' }));
    await waitForMessage(ws1, (m) => m.type === 'welcome');

    ws2.send(JSON.stringify({ type: 'join', room, name: 'User 2' }));
    const welcome2 = await waitForMessage(ws2, (m) => m.type === 'welcome');

    // ws1 joins video call
    ws1.send(JSON.stringify({ type: 'rtc_join', mediaState: { audio: true, video: true, screen: false } }));
    const peers1 = await waitForMessage(ws1, (m) => m.type === 'rtc_peers');
    assert.deepEqual(peers1.peers, []);

    // ws2 joins video call -> ws1 receives peer joined, ws2 receives existing peer ws1
    const pJoinedPromise = waitForMessage(ws1, (m) => m.type === 'rtc_peer_joined');
    ws2.send(JSON.stringify({ type: 'rtc_join', mediaState: { audio: false, video: true, screen: false } }));

    const pJoined = await pJoinedPromise;
    assert.equal(pJoined.peer.name, 'User 2');
    assert.equal(pJoined.peer.id, welcome2.clientId);

    const peers2 = await waitForMessage(ws2, (m) => m.type === 'rtc_peers');
    assert.equal(peers2.peers.length, 1);
    assert.equal(peers2.peers[0].name, 'User 1');

    ws1.close();
    ws2.close();
  });

  await t.test('rtc_offer, rtc_answer, and rtc_ice relay between peers', async () => {
    const room = 'video-test-room-2';
    const ws1 = await connect(wsUrl);
    const ws2 = await connect(wsUrl);

    ws1.send(JSON.stringify({ type: 'join', room, name: 'Alice' }));
    const w1 = await waitForMessage(ws1, (m) => m.type === 'welcome');

    ws2.send(JSON.stringify({ type: 'join', room, name: 'Bob' }));
    const w2 = await waitForMessage(ws2, (m) => m.type === 'welcome');

    // Offer from Alice to Bob
    const offerPromise = waitForMessage(ws2, (m) => m.type === 'rtc_offer');
    ws1.send(JSON.stringify({
      type: 'rtc_offer',
      targetId: w2.clientId,
      offer: { type: 'offer', sdp: 'dummy-sdp-offer' },
    }));

    const offerMsg = await offerPromise;
    assert.equal(offerMsg.fromId, w1.clientId);
    assert.equal(offerMsg.offer.sdp, 'dummy-sdp-offer');

    // Answer from Bob to Alice
    const answerPromise = waitForMessage(ws1, (m) => m.type === 'rtc_answer');
    ws2.send(JSON.stringify({
      type: 'rtc_answer',
      targetId: w1.clientId,
      answer: { type: 'answer', sdp: 'dummy-sdp-answer' },
    }));

    const answerMsg = await answerPromise;
    assert.equal(answerMsg.fromId, w2.clientId);
    assert.equal(answerMsg.answer.sdp, 'dummy-sdp-answer');

    // ICE Candidate relay
    const icePromise = waitForMessage(ws2, (m) => m.type === 'rtc_ice');
    ws1.send(JSON.stringify({
      type: 'rtc_ice',
      targetId: w2.clientId,
      candidate: { candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 50000 typ host' },
    }));

    const iceMsg = await icePromise;
    assert.equal(iceMsg.fromId, w1.clientId);
    assert.ok(iceMsg.candidate.candidate.includes('127.0.0.1'));

    ws1.close();
    ws2.close();
  });

  await t.test('media_state and rtc_leave broadcast to other peers', async () => {
    const room = 'video-test-room-3';
    const ws1 = await connect(wsUrl);
    const ws2 = await connect(wsUrl);

    ws1.send(JSON.stringify({ type: 'join', room, name: 'Charlie' }));
    const w1 = await waitForMessage(ws1, (m) => m.type === 'welcome');

    ws2.send(JSON.stringify({ type: 'join', room, name: 'Dave' }));
    await waitForMessage(ws2, (m) => m.type === 'welcome');

    ws1.send(JSON.stringify({ type: 'rtc_join' }));
    await waitForMessage(ws1, (m) => m.type === 'rtc_peers');

    // Mute microphone
    const mediaPromise = waitForMessage(ws2, (m) => m.type === 'media_state');
    ws1.send(JSON.stringify({ type: 'media_state', audio: false, video: true, screen: false }));
    const mediaMsg = await mediaPromise;
    assert.equal(mediaMsg.peerId, w1.clientId);
    assert.equal(mediaMsg.mediaState.audio, false);
    assert.equal(mediaMsg.mediaState.video, true);

    // Leave video call
    const leavePromise = waitForMessage(ws2, (m) => m.type === 'rtc_peer_left');
    ws1.send(JSON.stringify({ type: 'rtc_leave' }));
    const leaveMsg = await leavePromise;
    assert.equal(leaveMsg.peerId, w1.clientId);

    ws1.close();
    ws2.close();
  });
});
