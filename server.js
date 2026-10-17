'use strict';

/**
 * Multiplayer-in-10-lines server.
 * - Serves the static demo + library from /public
 * - GET /health for uptime checks
 * - GET /api/config for client feature flags
 * - WebSocket endpoint at /ws with in-memory rooms (shared state + presence + cursors)
 */

require('dotenv').config();

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const { LIMITS, ROOM_ID_RE, CLIENT_ID_RE, KEY_RE, FORBIDDEN_KEYS } = require('./server/limits');
const serverAuth = require('./server/auth');
const { sanitizeName, colorFor, validatePatch, COLORS } = require('./server/rooms');

function createServer(options = {}) {
  const roomTtlMs = options.roomTtlMs != null ? options.roomTtlMs : 60 * 60 * 1000;
  const heartbeatMs = options.heartbeatMs || 30000;

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    next();
  });

  /** @type {Map<string, {id:string, state:Map<string, any>, clients:Map<string, WebSocket>, version:number, cleanupTimer:any}>} */
  const rooms = new Map();

  app.get('/health', (req, res) => {
    let clients = 0;
    for (const room of rooms.values()) clients += room.clients.size;
    res.json({ status: 'ok', rooms: rooms.size, clients, uptime: Math.round(process.uptime()) });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      hasAuth: !!process.env.SUPABASE_URL,
      hasAI: !!process.env.ANTHROPIC_API_KEY,
      allowGuests: process.env.ALLOW_GUESTS !== 'false',
    });
  });

  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.messageBytesMax });

  function getRoom(id) {
    let room = rooms.get(id);
    if (!room) {
      room = { id, state: new Map(), clients: new Map(), version: 0, cleanupTimer: null };
      rooms.set(id, room);
    }
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    return room;
  }

  function send(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcast(room, msg, exceptWs) {
    const data = JSON.stringify(msg);
    for (const client of room.clients.values()) {
      if (client !== exceptWs && client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  function presenceOf(room) {
    return [...room.clients.values()].map((c) => ({ id: c.meta.clientId, name: c.meta.name, color: c.meta.color }));
  }

  function broadcastPresence(room) {
    broadcast(room, { type: 'presence', users: presenceOf(room) });
  }

  function stateObject(room) {
    const obj = Object.create(null);
    for (const [k, v] of room.state) obj[k] = v;
    return obj;
  }

  function leaveRoom(ws) {
    const { roomId, clientId } = ws.meta;
    if (!roomId) return;
    ws.meta.roomId = null;
    const room = rooms.get(roomId);
    if (!room || room.clients.get(clientId) !== ws) return;
    room.clients.delete(clientId);
    if (room.clients.size === 0) {
      if (roomTtlMs <= 0) rooms.delete(roomId);
      else {
        room.cleanupTimer = setTimeout(() => {
          if (room.clients.size === 0) rooms.delete(roomId);
        }, roomTtlMs);
        if (room.cleanupTimer.unref) room.cleanupTimer.unref();
      }
    } else {
      broadcastPresence(room);
    }
  }

  function handleJoin(ws, msg) {
    const roomId = typeof msg.room === 'string' ? msg.room : '';
    if (!ROOM_ID_RE.test(roomId)) {
      send(ws, { type: 'error', code: 'invalid_room', message: 'Room id must be 1-64 letters, digits or hyphens.' });
      ws.close(4400, 'invalid room');
      return;
    }
    const clientId = typeof msg.clientId === 'string' && CLIENT_ID_RE.test(msg.clientId) ? msg.clientId : crypto.randomUUID();

    leaveRoom(ws);
    const room = getRoom(roomId);

    // Same client reconnecting (e.g. network blip) replaces its stale socket.
    const existing = room.clients.get(clientId);
    if (existing && existing !== ws) {
      existing.meta.roomId = null;
      room.clients.delete(clientId);
      existing.close(4409, 'replaced by newer connection');
    }

    if (room.clients.size >= LIMITS.clientsPerRoomMax) {
      send(ws, { type: 'error', code: 'room_full', message: `Room is full (max ${LIMITS.clientsPerRoomMax}).` });
      if (room.clients.size === 0) rooms.delete(roomId);
      ws.close(4429, 'room full');
      return;
    }

    ws.meta.roomId = roomId;
    ws.meta.clientId = clientId;
    ws.meta.name = sanitizeName(msg.name);
    ws.meta.color = colorFor(clientId);
    room.clients.set(clientId, ws);

    send(ws, {
      type: 'welcome',
      clientId,
      name: ws.meta.name,
      color: ws.meta.color,
      room: roomId,
      limits: { valueBytesMax: LIMITS.valueBytesMax, keyMax: LIMITS.keyMax, nameMax: LIMITS.nameMax },
    });
    send(ws, { type: 'snapshot', state: stateObject(room), version: room.version });
    broadcastPresence(room);
  }

  function currentRoom(ws) {
    const room = ws.meta.roomId ? rooms.get(ws.meta.roomId) : null;
    if (!room) send(ws, { type: 'error', code: 'not_joined', message: 'Send a join message first.' });
    return room;
  }

  function handleSetState(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const result = validatePatch(msg.patch, room.state);
    if (result.error) {
      const keys = msg.patch && typeof msg.patch === 'object' ? Object.keys(msg.patch).slice(0, LIMITS.keysPerPatchMax) : [];
      send(ws, { type: 'error', code: 'invalid_patch', message: result.error, keys });
      return;
    }
    const applied = Object.create(null);
    for (const key of Object.keys(result.patch)) {
      const value = result.patch[key];
      if (value === null) room.state.delete(key);
      else room.state.set(key, value);
      applied[key] = value;
    }
    room.version++;
    broadcast(room, { type: 'state_update', patch: applied, from: ws.meta.clientId, version: room.version });
  }

  function handleCursor(ws, msg) {
    const room = ws.meta.roomId ? rooms.get(ws.meta.roomId) : null;
    if (!room) return; // cursors are fire-and-forget
    let x = null;
    let y = null;
    if (msg.x !== null || msg.y !== null) {
      x = Number(msg.x);
      y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return;
      x = Math.round(x * 10) / 10;
      y = Math.round(y * 10) / 10;
    }
    broadcast(room, { type: 'cursor', id: ws.meta.clientId, name: ws.meta.name, color: ws.meta.color, x, y }, ws);
  }

  function handleSetName(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    ws.meta.name = sanitizeName(msg.name);
    broadcastPresence(room);
  }

  function handleSync(ws) {
    const room = currentRoom(ws);
    if (!room) return;
    send(ws, { type: 'snapshot', state: stateObject(room), version: room.version });
  }

  function rateLimited(ws) {
    const now = Date.now();
    const rl = ws.meta.rate;
    if (now - rl.windowStart >= 1000) {
      rl.windowStart = now;
      rl.count = 0;
    }
    rl.count++;
    return rl.count > LIMITS.messagesPerSecondMax;
  }

  wss.on('connection', (ws) => {
    ws.meta = { roomId: null, clientId: null, name: 'Guest', color: COLORS[0], alive: true, rate: { windowStart: Date.now(), count: 0 } };
    ws.on('pong', () => {
      ws.meta.alive = true;
    });

    ws.on('message', (raw, isBinary) => {
      ws.meta.alive = true;
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        send(ws, { type: 'error', code: 'bad_json', message: 'Messages must be JSON.' });
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        send(ws, { type: 'error', code: 'bad_message', message: 'Message needs a string "type".' });
        return;
      }
      if (rateLimited(ws)) {
        if (msg.type === 'set_state') {
          const keys = msg.patch && typeof msg.patch === 'object' ? Object.keys(msg.patch).slice(0, LIMITS.keysPerPatchMax) : [];
          send(ws, { type: 'error', code: 'rate_limited', message: 'Too many messages, slow down.', keys });
        }
        return;
      }
      switch (msg.type) {
        case 'join': return handleJoin(ws, msg);
        case 'set_state': return handleSetState(ws, msg);
        case 'cursor_move': return handleCursor(ws, msg);
        case 'set_name': return handleSetName(ws, msg);
        case 'sync': return handleSync(ws);
        case 'ping': return send(ws, { type: 'pong', t: msg.t });
        default:
          send(ws, { type: 'error', code: 'unknown_type', message: `Unknown message type "${msg.type.slice(0, 40)}".` });
      }
    });

    ws.on('close', () => leaveRoom(ws));
    ws.on('error', () => leaveRoom(ws));
  });

  // Drop sockets that stopped answering (half-open TCP, sleeping laptops, etc.)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.meta.alive) {
        ws.terminate();
        continue;
      }
      ws.meta.alive = false;
      ws.ping();
    }
  }, heartbeatMs);
  if (heartbeat.unref) heartbeat.unref();

  return {
    app,
    server,
    wss,
    rooms,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const room of rooms.values()) if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => {
        wss.close(() => {
          if (server.closeAllConnections) server.closeAllConnections();
          server.close(() => resolve());
        });
      });
    },
  };
}

if (require.main === module) {
  serverAuth.init();
  const port = Number(process.env.PORT) || 3000;
  const ttlMinutes = Number(process.env.ROOM_TTL_MINUTES);
  const instance = createServer({ roomTtlMs: Number.isFinite(ttlMinutes) ? ttlMinutes * 60 * 1000 : undefined });
  instance.listen(port).then((p) => {
    console.log(`Multiplayer server listening on http://localhost:${p}`);
  });
  const shutdown = () => instance.close().then(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createServer, LIMITS };