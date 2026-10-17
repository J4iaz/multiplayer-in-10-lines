'use strict';

const WebSocket = require('ws');

/** Open a raw ws connection that buffers every JSON message in `ws.inbox`. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.inbox = [];
    ws.on('message', (data) => ws.inbox.push(JSON.parse(data.toString('utf8'))));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Resolve with (and consume) the first buffered or future message matching `pred`. */
function waitForMessage(ws, pred, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const i = ws.inbox.findIndex(pred);
      if (i === -1) return false;
      const [msg] = ws.inbox.splice(i, 1);
      cleanup();
      resolve(msg);
      return true;
    };
    const onMessage = () => check();
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for message'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      ws.off('message', onMessage);
    }
    if (!check()) ws.on('message', onMessage);
  });
}

/** Assert that no message matching `pred` arrives within `ms`. */
async function expectNoMessage(ws, pred, ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
  if (ws.inbox.some(pred)) throw new Error('Received an unexpected message');
}

function waitForClose(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({ code: null });
    const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeoutMs);
    ws.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
}

/** Poll until `fn()` is truthy. */
async function waitUntil(fn, timeoutMs = 3000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const byType = (type) => (m) => m.type === type;

module.exports = { connect, waitForMessage, expectNoMessage, waitForClose, waitUntil, byType };