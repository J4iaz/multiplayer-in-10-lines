'use strict';

const LIMITS = Object.freeze({
  roomIdMax: 64,
  nameMax: 50,
  keyMax: 128,
  valueBytesMax: 10 * 1024,
  keysPerRoomMax: 5000,
  keysPerPatchMax: 100,
  clientsPerRoomMax: 50,
  messageBytesMax: 256 * 1024,
  messagesPerSecondMax: 120,
  chatBodyMax: 2000,
  avatarBytesMax: 2048,
});

const ROOM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const KEY_RE = /^[A-Za-z0-9_:.\-]{1,128}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

module.exports = { LIMITS, ROOM_ID_RE, CLIENT_ID_RE, KEY_RE, FORBIDDEN_KEYS };
