'use strict';

/**
 * server/rooms.js — In-memory room management helpers.
 * Rooms are stored as: { id, state: Map, clients: Map, version, cleanupTimer }
 */

const { LIMITS, ROOM_ID_RE, CLIENT_ID_RE, KEY_RE, FORBIDDEN_KEYS } = require('./limits');

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0b8a8a', '#d6336c', '#7a5c00', '#2f9e44', '#1971c2'];

function sanitizeName(value) {
  const name = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, LIMITS.nameMax);
  return name || 'Guest';
}

function colorFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Returns { patch } with validated entries, or { error } describing the first problem. */
function validatePatch(patch, roomState) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: 'patch must be an object' };
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) return { error: 'patch is empty' };
  if (keys.length > LIMITS.keysPerPatchMax) return { error: `too many keys in one patch (max ${LIMITS.keysPerPatchMax})` };

  let newKeys = 0;
  for (const key of keys) {
    if (!KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) return { error: `invalid key "${String(key).slice(0, 40)}"` };
    const value = patch[key];
    if (value === null) continue; // deletion
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > LIMITS.valueBytesMax) return { error: `value for "${key}" exceeds ${LIMITS.valueBytesMax} bytes` };
    if (!roomState.has(key)) newKeys++;
  }
  if (roomState.size + newKeys > LIMITS.keysPerRoomMax) return { error: `room key limit reached (max ${LIMITS.keysPerRoomMax})` };
  return { patch };
}

function createRoom(id) {
  return {
    id,
    state: new Map(),
    clients: new Map(),
    version: 0,
    cleanupTimer: null,
    ownerId: null,
    passwordHash: null,
    locked: false,
    viewerOnly: false,
    bannedUsers: new Set(),
    failedAttempts: new Map(),
    chatHistory: [],
    videoPeers: new Map(),
  };
}

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

function isPasswordRateLimited(room, ip) {
  if (!room || !room.failedAttempts || !ip) return false;
  const record = room.failedAttempts.get(ip);
  if (!record) return false;
  if (Date.now() > record.resetAt) {
    room.failedAttempts.delete(ip);
    return false;
  }
  return record.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(room, ip) {
  if (!room || !room.failedAttempts || !ip) return null;
  const now = Date.now();
  let record = room.failedAttempts.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    room.failedAttempts.set(ip, record);
  }
  record.count++;
  return record;
}

function clearFailedAttempts(room, ip) {
  if (room && room.failedAttempts && ip) {
    room.failedAttempts.delete(ip);
  }
}

module.exports = {
  sanitizeName,
  colorFor,
  validatePatch,
  createRoom,
  isPasswordRateLimited,
  recordFailedAttempt,
  clearFailedAttempts,
  COLORS,
  ROOM_ID_RE,
  CLIENT_ID_RE,
  LIMITS,
  FORBIDDEN_KEYS,
  KEY_RE,
};
