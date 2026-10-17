'use strict';

/**
 * server/persist.js — Supabase PostgreSQL persistence for NexusMeet.
 * Handles:
 * - Room snapshots (state backup & load)
 * - Chat history
 * - Room events
 * - Room metadata & membership
 */

const serverAuth = require('./auth');

async function saveSnapshot(roomId, stateMap, version = 0) {
  const supabase = serverAuth.getClient();
  if (!supabase || !roomId) return false;

  try {
    const stateObj = {};
    if (stateMap instanceof Map) {
      for (const [k, v] of stateMap.entries()) {
        stateObj[k] = v;
      }
    } else if (stateMap && typeof stateMap === 'object') {
      Object.assign(stateObj, stateMap);
    }

    const { error } = await supabase.from('room_snapshots').upsert({
      room_id: roomId,
      version: version || 0,
      state: stateObj,
      created_at: new Date().toISOString(),
    }, { onConflict: 'room_id' });

    if (error) {
      console.warn('[persist] saveSnapshot error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[persist] saveSnapshot exception:', err.message);
    return false;
  }
}

async function loadSnapshot(roomId) {
  const supabase = serverAuth.getClient();
  if (!supabase || !roomId) return null;

  try {
    const { data, error } = await supabase
      .from('room_snapshots')
      .select('version, state')
      .eq('room_id', roomId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      version: data.version || 0,
      state: data.state || {},
    };
  } catch (err) {
    console.warn('[persist] loadSnapshot exception:', err.message);
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toUuid(id) {
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

async function saveChatMessage(roomId, userId, displayName, body) {
  const supabase = serverAuth.getClient();
  if (!supabase || !roomId || !body) return false;

  try {
    const { error } = await supabase.from('chat_messages').insert({
      room_id: roomId,
      user_id: toUuid(userId),
      display_name: displayName || 'Guest',
      body: String(body).slice(0, 2000),
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.warn('[persist] saveChatMessage error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[persist] saveChatMessage exception:', err.message);
    return false;
  }
}

async function loadChatMessages(roomId, limit = 50) {
  const supabase = serverAuth.getClient();
  if (!supabase || !roomId) return [];

  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, user_id, display_name, body, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error || !data) return [];
    return data;
  } catch (err) {
    console.warn('[persist] loadChatMessages exception:', err.message);
    return [];
  }
}

async function saveRoomEvent(roomId, version, userId, type, payload = {}) {
  const supabase = serverAuth.getClient();
  if (!supabase || !roomId) return false;

  try {
    const { error } = await supabase.from('room_events').insert({
      room_id: roomId,
      version: version || 0,
      user_id: toUuid(userId),
      type: type || 'state_update',
      payload: payload || {},
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.warn('[persist] saveRoomEvent error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[persist] saveRoomEvent exception:', err.message);
    return false;
  }
}

async function upsertRoom(roomId, ownerId = null, name = null) {
  const supabase = serverAuth.getClient();
  if (!supabase || !roomId) return false;

  try {
    const { error } = await supabase.from('rooms').upsert({
      id: roomId,
      owner_id: toUuid(ownerId),
      name: name || ('Room #' + roomId),
      last_active_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (error) {
      console.warn('[persist] upsertRoom error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[persist] upsertRoom exception:', err.message);
    return false;
  }
}

module.exports = {
  saveSnapshot,
  loadSnapshot,
  saveChatMessage,
  loadChatMessages,
  saveRoomEvent,
  upsertRoom,
};
