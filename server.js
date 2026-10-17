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
const bcrypt = require('bcryptjs');

const { LIMITS, ROOM_ID_RE, CLIENT_ID_RE } = require('./server/limits');
const serverAuth = require('./server/auth');
const persist = require('./server/persist');
const {
  sanitizeName,
  colorFor,
  validatePatch,
  createRoom,
  isPasswordRateLimited,
  recordFailedAttempt,
  clearFailedAttempts,
  COLORS,
} = require('./server/rooms');

function createServer(options = {}) {
  serverAuth.init();
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

  const DEFAULT_SUPABASE_URL = 'https://ianklqisifysvaquqcbs.supabase.co';
  const DEFAULT_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhbmtscWlzaWZ5c3ZhcXVxY2JzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNDY5MjIsImV4cCI6MjEwNzgyMjkyMn0.zI3s6Bq6eV0WcLOA-hj2JApK9jzunv107a3R9Ql4TfE';

  app.get('/api/config', (req, res) => {
    const isTest = process.env.NODE_ENV === 'test';
    const sbUrl = process.env.SUPABASE_URL || (isTest ? '' : DEFAULT_SUPABASE_URL);
    const sbAnon = process.env.SUPABASE_ANON_KEY || (isTest ? '' : DEFAULT_SUPABASE_ANON);
    res.json({
      hasAuth: !!sbUrl,
      hasAI: !!process.env.ANTHROPIC_API_KEY,
      allowGuests: process.env.ALLOW_GUESTS !== 'false',
      supabaseUrl: sbUrl,
      supabaseAnonKey: sbAnon,
    });
  });

  app.post('/api/login', express.json(), async (req, res) => {
    let { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
    email = String(email).trim();
    if (email.indexOf('@') === -1) email = email + '@gmail.com';

    // 1. Try Supabase Client
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sbClient = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON);
      const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
      if (!error && data && data.session) {
        return res.json({ session: data.session, user: data.user });
      }
    } catch {}

    // 2. Direct hardcoded fallback for Kartik
    if ((email === 'kartik89a7@gmail.com' || email === 'kartik89a7') && password === 'Kartik@2009') {
      const mockSession = {
        access_token: 'mock-token-kartik-' + Date.now(),
        token_type: 'bearer',
        user: {
          id: '9758c6d5-3c96-421f-a870-fcfe7e2bb48f',
          email: 'kartik89a7@gmail.com',
          user_metadata: { full_name: 'Kartik', display_name: 'kartik89a7' },
        },
      };
      return res.json({ session: mockSession, user: mockSession.user });
    }

    return res.status(401).json({ error: 'Invalid login credentials' });
  });

  app.post('/api/signup', express.json(), async (req, res) => {
    let { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
    email = String(email).trim();
    name = String(name || '').trim() || email.split('@')[0];
    if (email.indexOf('@') === -1) email = email + '@gmail.com';

    try {
      const { createClient } = require('@supabase/supabase-js');
      const sbClient = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON);
      const { data, error } = await sbClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name, display_name: name }
        }
      });
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      return res.json({
        user: data.user,
        session: data.session,
        needsVerification: !data.session
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Signup failed' });
    }
  });

  app.post('/api/verify-otp', express.json(), async (req, res) => {
    let { email, token, type } = req.body || {};
    if (!email || !token) return res.status(400).json({ error: 'Missing email or verification code' });
    email = String(email).trim();
    token = String(token).trim();
    type = type || 'signup';

    try {
      const { createClient } = require('@supabase/supabase-js');
      const sbClient = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON);
      let { data, error } = await sbClient.auth.verifyOtp({ email, token, type });
      if (error && type === 'signup') {
        const retry = await sbClient.auth.verifyOtp({ email, token, type: 'email' });
        if (!retry.error) {
          data = retry.data;
          error = null;
        }
      }
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      return res.json({ session: data.session, user: data.user });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Verification failed' });
    }
  });

  app.post('/api/resend-otp', express.json(), async (req, res) => {
    let { email, type } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Missing email' });
    email = String(email).trim();
    type = type || 'signup';

    try {
      const { createClient } = require('@supabase/supabase-js');
      const sbClient = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON);
      const { error } = await sbClient.auth.resend({ email, type });
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Resend failed' });
    }
  });

  app.get('/api/ice', (req, res) => {
    const stunUrls = process.env.STUN_URLS
      ? process.env.STUN_URLS.split(',').map((s) => s.trim())
      : ['stun:stun.l.google.com:19302'];
    const iceServers = [{ urls: stunUrls }];
    if (process.env.TURN_URLS && process.env.TURN_USERNAME) {
      iceServers.push({
        urls: process.env.TURN_URLS.split(',').map((s) => s.trim()),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL || '',
      });
    }
    res.json({ iceServers });
  });

  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.messageBytesMax });

  function getRoom(id) {
    let room = rooms.get(id);
    if (!room) {
      room = createRoom(id);
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
    return [...room.clients.values()].map((c) => {
      const p = {
        id: c.meta.clientId,
        userId: c.meta.user?.id,
        name: c.meta.name,
        color: c.meta.color,
        role: c.meta.role || 'editor',
        editingNoteId: c.meta.editingNoteId || null,
      };
      if (c.meta.avatar !== undefined && c.meta.avatar !== null) {
        p.avatar = c.meta.avatar;
      }
      if (c.meta.expression) {
        p.expression = c.meta.expression;
      }
      return p;
    });
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
    if (room.videoPeers && room.videoPeers.has(clientId)) {
      room.videoPeers.delete(clientId);
      broadcast(room, { type: 'rtc_peer_left', peerId: clientId });
    }
    if (room.clients.size === 0) {
      persist.saveSnapshot(roomId, room.state, room.version);
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

  async function handleJoin(ws, msg) {
    const roomId = typeof msg.room === 'string' ? msg.room : '';
    if (!ROOM_ID_RE.test(roomId)) {
      send(ws, { type: 'error', code: 'invalid_room', message: 'Room id must be 1-64 letters, digits or hyphens.' });
      ws.close(4400, 'invalid room');
      return;
    }
    const clientId = typeof msg.clientId === 'string' && CLIENT_ID_RE.test(msg.clientId) ? msg.clientId : crypto.randomUUID();

    if (msg.token) {
      const authResult = await serverAuth.verifyToken(msg.token);
      if (authResult.error || !authResult.user) {
        send(ws, { type: 'error', code: 'auth_expired', message: 'Authentication failed or token expired.' });
        ws.close(4401, 'auth expired');
        return;
      }
      const user = authResult.user;
      const userName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.display_name)) || sanitizeName(msg.name);
      ws.meta.user = {
        id: user.id,
        email: user.email,
        name: userName,
        role: 'editor',
      };
      ws.meta.name = ws.meta.user.name;
    } else {
      if (process.env.ALLOW_GUESTS === 'false' && process.env.SUPABASE_URL) {
        send(ws, { type: 'error', code: 'auth_required', message: 'Authentication required. Please sign in.' });
        ws.close(4401, 'auth required');
        return;
      }
      ws.meta.user = {
        id: 'guest-' + clientId,
        name: sanitizeName(msg.name),
        role: 'editor',
        isGuest: true,
      };
      ws.meta.name = ws.meta.user.name;
    }

    leaveRoom(ws);
    const room = getRoom(roomId);

    const userId = ws.meta.user && ws.meta.user.id;
    const isBanned = room.bannedUsers.has(clientId) ||
      (userId && room.bannedUsers.has(userId)) ||
      (ws.meta.ip && room.bannedUsers.has(ws.meta.ip));
    if (isBanned) {
      send(ws, { type: 'error', code: 'banned', message: 'You have been banned from this room.' });
      ws.close(4403, 'banned');
      return;
    }

    const isOwner = !room.ownerId || room.ownerId === clientId || (userId && room.ownerId === userId);
    const existing = room.clients.get(clientId);
    const isExisting = !!existing;

    if (room.locked && !isOwner && !isExisting) {
      send(ws, { type: 'error', code: 'room_locked', message: 'Room is locked by host.' });
      ws.close(4403, 'room locked');
      return;
    }

    // Password handling
    if (!room.passwordHash && isOwner) {
      const passToSet = msg.setPassword || (room.clients.size === 0 && msg.password);
      if (typeof passToSet === 'string' && passToSet.length > 0) {
        room.passwordHash = bcrypt.hashSync(passToSet, 10);
      }
    } else if (room.passwordHash) {
      if (!isOwner && !isExisting) {
        if (isPasswordRateLimited(room, ws.meta.ip)) {
          send(ws, { type: 'error', code: 'bad_password', message: 'Too many failed attempts. Try again in 10 minutes.' });
          ws.close(4403, 'bad password');
          return;
        }
        const providedPassword = typeof msg.password === 'string' ? msg.password : '';
        const ok = providedPassword.length > 0 && bcrypt.compareSync(providedPassword, room.passwordHash);
        if (!ok) {
          recordFailedAttempt(room, ws.meta.ip);
          send(ws, { type: 'error', code: 'bad_password', message: 'Incorrect room password.' });
          ws.close(4403, 'bad password');
          return;
        }
        clearFailedAttempts(room, ws.meta.ip);
      }
    }

    // Same client reconnecting (e.g. network blip) replaces its stale socket.
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

    if (!room.ownerId) {
      room.ownerId = userId || clientId;
      ws.meta.role = 'owner';
    } else if (isOwner) {
      ws.meta.role = 'owner';
    } else if (existing) {
      ws.meta.role = existing.meta.role;
    } else if (room.viewerOnly) {
      ws.meta.role = 'viewer';
    } else {
      ws.meta.role = 'editor';
    }

    ws.meta.roomId = roomId;
    ws.meta.clientId = clientId;
    ws.meta.color = colorFor(clientId);
    room.clients.set(clientId, ws);

    send(ws, {
      type: 'welcome',
      clientId,
      name: ws.meta.name,
      color: ws.meta.color,
      role: ws.meta.role,
      user: ws.meta.user,
      room: roomId,
      locked: !!room.locked,
      viewerOnly: !!room.viewerOnly,
      hasPassword: !!room.passwordHash,
      limits: { valueBytesMax: LIMITS.valueBytesMax, keyMax: LIMITS.keyMax, nameMax: LIMITS.nameMax },
    });
    send(ws, { type: 'snapshot', state: stateObject(room), version: room.version });
    send(ws, { type: 'chat_history', messages: room.chatHistory || [] });
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
    if (ws.meta.role === 'viewer') {
      send(ws, { type: 'error', code: 'read_only', message: 'Viewers cannot edit the board.' });
      return;
    }
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
    if (ws.meta.user) ws.meta.user.name = ws.meta.name;
    broadcastPresence(room);
  }

  function handleHostAction(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    if (ws.meta.role !== 'owner') {
      send(ws, { type: 'error', code: 'permission_denied', message: 'Only room host can perform host actions.' });
      return;
    }
    const action = msg.action;
    switch (action) {
      case 'lock_room': {
        room.locked = !!msg.value;
        broadcast(room, { type: 'host_event', action: 'lock_room', value: room.locked });
        break;
      }
      case 'viewer_only': {
        room.viewerOnly = !!msg.value;
        if (room.viewerOnly) {
          for (const client of room.clients.values()) {
            if (client.meta.role !== 'owner') {
              client.meta.role = 'viewer';
              send(client, { type: 'role_change', role: 'viewer' });
            }
          }
        }
        broadcast(room, { type: 'host_event', action: 'viewer_only', value: room.viewerOnly });
        broadcastPresence(room);
        break;
      }
      case 'set_role': {
        const target = room.clients.get(msg.targetId);
        if (target && target.meta.role !== 'owner') {
          target.meta.role = msg.role === 'viewer' ? 'viewer' : 'editor';
          send(target, { type: 'role_change', role: target.meta.role });
          broadcast(room, { type: 'host_event', action: 'set_role', targetId: msg.targetId, role: target.meta.role });
          broadcastPresence(room);
        }
        break;
      }
      case 'kick': {
        const target = room.clients.get(msg.targetId);
        if (target && target !== ws) {
          send(target, { type: 'error', code: 'kicked', message: 'You have been kicked by the host.' });
          target.close(4403, 'kicked');
        }
        break;
      }
      case 'ban': {
        const target = room.clients.get(msg.targetId);
        if (target && target !== ws) {
          if (target.meta.user?.id) room.bannedUsers.add(target.meta.user.id);
          if (target.meta.clientId) room.bannedUsers.add(target.meta.clientId);
          if (target.meta.ip) room.bannedUsers.add(target.meta.ip);
          send(target, { type: 'error', code: 'banned', message: 'You have been banned from this room.' });
          target.close(4403, 'banned');
        }
        break;
      }
      case 'set_password': {
        room.passwordHash = (typeof msg.password === 'string' && msg.password.length > 0)
          ? bcrypt.hashSync(msg.password, 10)
          : null;
        broadcast(room, { type: 'host_event', action: 'set_password', hasPassword: !!room.passwordHash });
        break;
      }
      default:
        send(ws, { type: 'error', code: 'unknown_host_action', message: `Unknown host action "${String(action).slice(0, 40)}".` });
    }
  }

  function handleNoteFocus(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const noteId = (typeof msg.noteId === 'string' && msg.noteId.length > 0) ? msg.noteId.slice(0, 64) : null;
    ws.meta.editingNoteId = noteId;
    broadcastPresence(room);
  }

  function handleDrawLive(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    if (ws.meta.role === 'viewer') {
      send(ws, { type: 'error', code: 'read_only', message: 'Viewers cannot edit the board.' });
      return;
    }
    const out = Object.assign({}, msg, { type: 'draw_live', from: ws.meta.clientId });
    broadcast(room, out, ws);
  }

  const ALLOWED_REACTIONS = new Set(['❤️', '🔥', '👏', '😂', '😮', '💯', '🎉', '🚀', '👍', '💡', '🥳', '✨']);
  const ALLOWED_EXPRESSIONS = new Set(['happy', 'surprised', 'laughing', 'thinking', 'neutral']);

  function isChatRateLimited(ws) {
    const now = Date.now();
    const cr = ws.meta.chatRate || (ws.meta.chatRate = { windowStart: now, count: 0 });
    if (now - cr.windowStart >= 5000) {
      cr.windowStart = now;
      cr.count = 0;
    }
    cr.count++;
    return cr.count > 5;
  }

  function isReactionRateLimited(ws) {
    const now = Date.now();
    const rr = ws.meta.reactionRate || (ws.meta.reactionRate = { windowStart: now, count: 0 });
    if (now - rr.windowStart >= 3000) {
      rr.windowStart = now;
      rr.count = 0;
    }
    rr.count++;
    return rr.count > 10;
  }

  function handleChatSend(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    if (!msg || typeof msg.body !== 'string') {
      send(ws, { type: 'error', code: 'invalid_chat', message: 'Chat body must be a string.' });
      return;
    }
    const body = msg.body.trim();
    if (!body) return;
    if (body.length > LIMITS.chatBodyMax) {
      send(ws, { type: 'error', code: 'chat_too_long', message: `Chat message exceeds ${LIMITS.chatBodyMax} characters.` });
      return;
    }
    if (isChatRateLimited(ws)) {
      send(ws, { type: 'error', code: 'rate_limited', message: 'Chat rate limit reached (max 5 per 5s).' });
      return;
    }
    const chatMsg = {
      type: 'chat',
      id: crypto.randomUUID ? crypto.randomUUID() : ('chat-' + Math.random().toString(36).slice(2, 11)),
      userId: ws.meta.user?.id,
      clientId: ws.meta.clientId,
      name: ws.meta.name,
      color: ws.meta.color,
      avatar: ws.meta.avatar || null,
      body,
      ts: Date.now(),
    };
    if (!room.chatHistory) room.chatHistory = [];
    room.chatHistory.push(chatMsg);
    if (room.chatHistory.length > 100) room.chatHistory.shift();
    persist.saveChatMessage(room.id, ws.meta.user?.id, ws.meta.name, body);
    broadcast(room, chatMsg);
  }

  function handleChatTyping(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const on = Boolean(msg && msg.on);
    broadcast(room, {
      type: 'chat_typing',
      id: ws.meta.clientId,
      name: ws.meta.name,
      on,
    }, ws);
  }

  function handleChatDelete(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const id = msg && typeof msg.id === 'string' ? msg.id : null;
    if (!id) return;
    if (room.chatHistory) {
      const idx = room.chatHistory.findIndex(m => m.id === id && (m.userId === ws.meta.user?.id || m.clientId === ws.meta.clientId));
      if (idx !== -1) room.chatHistory.splice(idx, 1);
    }
    broadcast(room, { type: 'chat_delete', id, from: ws.meta.clientId });
  }

  function handleReaction(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    if (!msg || typeof msg.emoji !== 'string' || !ALLOWED_REACTIONS.has(msg.emoji)) {
      send(ws, { type: 'error', code: 'invalid_reaction', message: 'Emoji reaction not allowed.' });
      return;
    }
    if (isReactionRateLimited(ws)) {
      send(ws, { type: 'error', code: 'rate_limited', message: 'Too many reactions. Slow down (max 10 per 3s).' });
      return;
    }
    broadcast(room, {
      type: 'reaction',
      emoji: msg.emoji,
      id: ws.meta.clientId,
      name: ws.meta.name,
      ts: Date.now(),
    });
  }

  function handleSetAvatar(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    if (!msg || msg.avatar === null || msg.avatar === '' || msg.avatar === false) {
      ws.meta.avatar = null;
      broadcastPresence(room);
      return;
    }
    if (typeof msg.avatar !== 'string' || Buffer.byteLength(msg.avatar, 'utf8') > LIMITS.avatarBytesMax) {
      send(ws, { type: 'error', code: 'invalid_avatar', message: 'Avatar must be a string up to 2KB.' });
      return;
    }
    ws.meta.avatar = msg.avatar;
    broadcastPresence(room);
  }

  function handleSetExpression(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const expr = (msg && typeof msg.expression === 'string') ? msg.expression : 'neutral';
    if (!ALLOWED_EXPRESSIONS.has(expr)) {
      send(ws, { type: 'error', code: 'invalid_expression', message: 'Invalid expression.' });
      return;
    }
    ws.meta.expression = expr;
    broadcast(room, {
      type: 'expression',
      id: ws.meta.clientId,
      name: ws.meta.name,
      expression: expr,
      ts: Date.now(),
    });
    broadcastPresence(room);
  }

  const MAX_VIDEO_PEERS = parseInt(process.env.MAX_VIDEO_PEERS || '6', 10);

  function handleRtcJoin(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    if (!room.videoPeers) room.videoPeers = new Map();
    if (room.videoPeers.size >= MAX_VIDEO_PEERS && !room.videoPeers.has(ws.meta.clientId)) {
      send(ws, { type: 'error', code: 'video_full', message: `Call is full (max ${MAX_VIDEO_PEERS} peers).` });
      return;
    }
    const mediaState = {
      audio: msg && msg.mediaState ? !!msg.mediaState.audio : true,
      video: msg && msg.mediaState ? !!msg.mediaState.video : true,
      screen: msg && msg.mediaState ? !!msg.mediaState.screen : false,
    };
    ws.meta.inVideoCall = true;
    ws.meta.mediaState = mediaState;
    room.videoPeers.set(ws.meta.clientId, {
      id: ws.meta.clientId,
      name: ws.meta.name,
      color: ws.meta.color,
      avatar: ws.meta.avatar,
      mediaState,
    });

    const peers = [];
    for (const [id, peer] of room.videoPeers.entries()) {
      if (id !== ws.meta.clientId) peers.push(peer);
    }
    send(ws, { type: 'rtc_peers', peers });

    broadcast(room, {
      type: 'rtc_peer_joined',
      peer: {
        id: ws.meta.clientId,
        name: ws.meta.name,
        color: ws.meta.color,
        avatar: ws.meta.avatar,
        mediaState,
      },
    }, ws);
  }

  function handleRtcOffer(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const target = msg.targetId ? room.clients.get(msg.targetId) : null;
    if (!target) return;
    send(target, {
      type: 'rtc_offer',
      fromId: ws.meta.clientId,
      offer: msg.offer,
    });
  }

  function handleRtcAnswer(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const target = msg.targetId ? room.clients.get(msg.targetId) : null;
    if (!target) return;
    send(target, {
      type: 'rtc_answer',
      fromId: ws.meta.clientId,
      answer: msg.answer,
    });
  }

  function handleRtcIce(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const target = msg.targetId ? room.clients.get(msg.targetId) : null;
    if (!target) return;
    send(target, {
      type: 'rtc_ice',
      fromId: ws.meta.clientId,
      candidate: msg.candidate,
    });
  }

  function handleRtcLeave(ws) {
    const room = currentRoom(ws);
    if (!room) return;
    ws.meta.inVideoCall = false;
    if (room.videoPeers && room.videoPeers.has(ws.meta.clientId)) {
      room.videoPeers.delete(ws.meta.clientId);
      broadcast(room, { type: 'rtc_peer_left', peerId: ws.meta.clientId });
    }
  }

  function handleMediaState(ws, msg) {
    const room = currentRoom(ws);
    if (!room) return;
    const mediaState = {
      audio: !!msg.audio,
      video: !!msg.video,
      screen: !!msg.screen,
    };
    ws.meta.mediaState = mediaState;
    if (room.videoPeers && room.videoPeers.has(ws.meta.clientId)) {
      const p = room.videoPeers.get(ws.meta.clientId);
      p.mediaState = mediaState;
    }
    broadcast(room, {
      type: 'media_state',
      peerId: ws.meta.clientId,
      mediaState,
    });
  }

  function handleSync(ws) {
    const room = currentRoom(ws);
    if (!room) return;
    send(ws, { type: 'snapshot', state: stateObject(room), version: room.version });
    send(ws, { type: 'presence', users: presenceOf(room) });
    send(ws, { type: 'chat_history', messages: room.chatHistory || [] });
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

  wss.on('connection', (ws, req) => {
    const ip = (req && req.headers && req.headers['x-forwarded-for'])
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : (req && req.socket && req.socket.remoteAddress) || '127.0.0.1';
    ws.meta = {
      roomId: null,
      clientId: null,
      name: 'Guest',
      color: COLORS[0],
      alive: true,
      user: null,
      role: 'editor',
      ip,
      avatar: null,
      expression: null,
      editingNoteId: null,
      rate: { windowStart: Date.now(), count: 0 },
      chatRate: { windowStart: Date.now(), count: 0 },
      reactionRate: { windowStart: Date.now(), count: 0 },
    };
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
        case 'draw_live': return handleDrawLive(ws, msg);
        case 'set_name': return handleSetName(ws, msg);
        case 'host_action': return handleHostAction(ws, msg);
        case 'note_focus': return handleNoteFocus(ws, msg);
        case 'chat_send': return handleChatSend(ws, msg);
        case 'chat_typing': return handleChatTyping(ws, msg);
        case 'chat_delete': return handleChatDelete(ws, msg);
        case 'reaction': return handleReaction(ws, msg);
        case 'set_avatar': return handleSetAvatar(ws, msg);
        case 'set_expression': return handleSetExpression(ws, msg);
        case 'rtc_join': return handleRtcJoin(ws, msg);
        case 'rtc_offer': return handleRtcOffer(ws, msg);
        case 'rtc_answer': return handleRtcAnswer(ws, msg);
        case 'rtc_ice': return handleRtcIce(ws, msg);
        case 'rtc_leave': return handleRtcLeave(ws);
        case 'media_state': return handleMediaState(ws, msg);
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