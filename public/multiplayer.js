/*!
 * multiplayer.js — drop-in realtime shared state, presence and live cursors.
 * No dependencies. Include with <script src="/multiplayer.js"></script> and use window.Multiplayer.
 *
 *   const room = Multiplayer.join({ name: 'Ada' });
 *   room.onStateChange((state) => render(state));
 *   room.setState('count', 1);
 *   room.enableCursors();
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var ROOM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
  var KEY_RE = /^[A-Za-z0-9_:.\-]{1,128}$/;
  // Note: an object literal like { __proto__: true } would set the prototype, not a key.
  function isForbiddenKey(key) {
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
  }
  var VALUE_BYTES_MAX = 10 * 1024;
  var NAME_MAX = 50;
  var FATAL_CLOSE_CODES = { 4400: true, 4401: true, 4409: true, 4429: true };
  var ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 chars, no ambiguous ones
  var NAME_STORAGE_KEY = 'multiplayer:name';

  var scriptSrc = global.document && global.document.currentScript ? global.document.currentScript.src : '';

  // ---------- helpers ----------

  function randomId(length) {
    var bytes = new Uint8Array(length);
    global.crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    return out;
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function byteLength(str) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str).length : str.length * 3;
  }

  function storage() {
    try {
      var s = global.localStorage;
      s.setItem('__mp_probe', '1');
      s.removeItem('__mp_probe');
      return s;
    } catch (e) {
      return null;
    }
  }

  function sanitizeName(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, NAME_MAX);
  }

  function hashParams() {
    var hash = (global.location && global.location.hash) || '';
    return new URLSearchParams(hash.charAt(0) === '#' ? hash.slice(1) : hash);
  }

  function readRoomFromHash() {
    var fromHash = hashParams().get('room');
    if (fromHash) return fromHash;
    if (global.location && global.location.search) {
      try {
        var fromSearch = new URLSearchParams(global.location.search).get('room');
        if (fromSearch) return fromSearch;
      } catch (e) {}
    }
    var rawHash = ((global.location && global.location.hash) || '').replace(/^#/, '');
    if (rawHash && ROOM_ID_RE.test(rawHash) && rawHash.indexOf('=') === -1) {
      return rawHash;
    }
    return null;
  }

  function writeRoomToHash(roomId) {
    if (!global.location || !global.history) return;
    var params = hashParams();
    if (params.get('room') === roomId) return;
    params.set('room', roomId);
    var url = global.location.pathname + global.location.search + '#' + params.toString();
    global.history.replaceState(global.history.state, '', url);
  }

  function defaultServerUrl() {
    var base = scriptSrc || (global.location && global.location.href) || '';
    var url;
    try {
      url = new URL(base);
    } catch (e) {
      url = null;
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      throw new Error('Multiplayer: cannot infer server URL (page opened from file://?). Pass { serverUrl: "wss://your-host/ws" }.');
    }
    return (url.protocol === 'https:' ? 'wss://' : 'ws://') + url.host + '/ws';
  }

  function createEmitter() {
    var listeners = {};
    return {
      on: function (event, fn) {
        if (typeof fn !== 'function') throw new TypeError('Multiplayer: listener must be a function');
        (listeners[event] = listeners[event] || []).push(fn);
        return function off() {
          var list = listeners[event] || [];
          var i = list.indexOf(fn);
          if (i !== -1) list.splice(i, 1);
        };
      },
      emit: function (event, makeArgs) {
        var list = (listeners[event] || []).slice();
        for (var i = 0; i < list.length; i++) {
          try {
            list[i].apply(null, makeArgs());
          } catch (err) {
            if (global.console) global.console.error('Multiplayer listener error:', err);
          }
        }
      },
    };
  }

  /** Turn setState(key, value) or setState({ key: value }) into validated [key, value] entries. */
  function normalizeEntries(keyOrPatch, value) {
    var raw = [];
    if (typeof keyOrPatch === 'string') {
      raw.push([keyOrPatch, value]);
    } else if (keyOrPatch && typeof keyOrPatch === 'object' && !Array.isArray(keyOrPatch)) {
      var keys = Object.keys(keyOrPatch);
      for (var i = 0; i < keys.length; i++) raw.push([keys[i], keyOrPatch[keys[i]]]);
    } else {
      throw new TypeError('Multiplayer: setState expects (key, value) or ({ key: value })');
    }
    if (raw.length === 0) throw new TypeError('Multiplayer: setState called with an empty patch');

    return raw.map(function (entry) {
      var key = entry[0];
      var val = entry[1] === undefined ? null : entry[1];
      if (!KEY_RE.test(key) || isForbiddenKey(key)) {
        throw new TypeError('Multiplayer: invalid key "' + key + '" (use letters, digits, _ : . -, max 128 chars)');
      }
      var json;
      try {
        json = JSON.stringify(val);
      } catch (e) {
        throw new TypeError('Multiplayer: value for "' + key + '" is not JSON-serializable');
      }
      if (json === undefined) throw new TypeError('Multiplayer: value for "' + key + '" is not JSON-serializable');
      if (byteLength(json) > VALUE_BYTES_MAX) {
        throw new RangeError('Multiplayer: value for "' + key + '" exceeds ' + VALUE_BYTES_MAX + ' bytes');
      }
      return [key, JSON.parse(json)];
    });
  }

  // ---------- cursors ----------

  function createCursorLayer(container, sendCursor, opts) {
    var isBody = container === global.document.body || container === global.document.documentElement;
    var throttleMs = opts.throttleMs || 50;

    if (!isBody && global.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    var layer = global.document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.className = 'mp-cursor-layer';
    layer.style.position = 'absolute';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.width = '0';
    layer.style.height = '0';
    layer.style.overflow = 'visible';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = String(opts.zIndex || 2147483000);
    (isBody ? global.document.body : container).appendChild(layer);

    var cursors = {}; // id -> { el, label, arrow, hidden }
    var lastSent = 0;
    var pending = null;
    var timer = null;

    function toLocal(event) {
      if (isBody) return { x: event.pageX, y: event.pageY };
      var rect = container.getBoundingClientRect();
      return {
        x: event.clientX - rect.left - container.clientLeft + container.scrollLeft,
        y: event.clientY - rect.top - container.clientTop + container.scrollTop,
      };
    }

    function flush() {
      timer = null;
      if (!pending) return;
      lastSent = Date.now();
      sendCursor(pending.x, pending.y);
      pending = null;
    }

    function onMove(event) {
      pending = toLocal(event);
      var wait = throttleMs - (Date.now() - lastSent);
      if (wait <= 0) flush();
      else if (!timer) timer = global.setTimeout(flush, wait);
    }

    function onLeave() {
      if (timer) global.clearTimeout(timer);
      timer = null;
      pending = null;
      sendCursor(null, null);
    }

    var target = isBody ? global.document : container;
    target.addEventListener('pointermove', onMove, { passive: true });
    (isBody ? global.document.documentElement : container).addEventListener('pointerleave', onLeave);

    function ensure(id, name, color) {
      var c = cursors[id];
      if (!c) {
        var el = global.document.createElement('div');
        el.className = 'mp-cursor';
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.willChange = 'transform';
        el.style.transition = 'transform 80ms linear';

        var svgNs = 'http://www.w3.org/2000/svg';
        var svg = global.document.createElementNS(svgNs, 'svg');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '22');
        svg.setAttribute('viewBox', '0 0 18 22');
        svg.style.display = 'block';
        var arrow = global.document.createElementNS(svgNs, 'path');
        arrow.setAttribute('d', 'M1 1 L1 18 L5.5 13.5 L8.5 20.5 L11.5 19.2 L8.6 12.4 L15 12.4 Z');
        arrow.setAttribute('stroke', '#fff');
        arrow.setAttribute('stroke-width', '1.5');
        arrow.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(arrow);

        var label = global.document.createElement('span');
        label.className = 'mp-cursor-label';
        label.style.position = 'absolute';
        label.style.left = '14px';
        label.style.top = '16px';
        label.style.padding = '2px 6px';
        label.style.borderRadius = '4px';
        label.style.font = '600 12px/1.3 system-ui, sans-serif';
        label.style.color = '#fff';
        label.style.whiteSpace = 'nowrap';
        label.style.boxShadow = '0 1px 3px rgba(0,0,0,.25)';

        el.appendChild(svg);
        el.appendChild(label);
        layer.appendChild(el);
        c = cursors[id] = { el: el, label: label, arrow: arrow, fresh: true };
      }
      if (name != null) c.label.textContent = name; // textContent: never interpreted as HTML
      if (color) {
        c.arrow.setAttribute('fill', color);
        c.label.style.background = color;
      }
      return c;
    }

    function remove(id) {
      var c = cursors[id];
      if (!c) return;
      if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
      delete cursors[id];
    }

    return {
      update: function (msg) {
        if (msg.x === null || msg.y === null) {
          remove(msg.id);
          return;
        }
        var c = ensure(msg.id, msg.name, msg.color);
        if (c.fresh) {
          // Place instantly on first appearance instead of sliding in from (0,0).
          c.el.style.transition = 'none';
          c.el.style.transform = 'translate(' + msg.x + 'px,' + msg.y + 'px)';
          void c.el.offsetWidth;
          c.el.style.transition = 'transform 80ms linear';
          c.fresh = false;
        } else {
          c.el.style.transform = 'translate(' + msg.x + 'px,' + msg.y + 'px)';
        }
      },
      syncPresence: function (users) {
        var alive = {};
        for (var i = 0; i < users.length; i++) {
          alive[users[i].id] = true;
          if (cursors[users[i].id]) ensure(users[i].id, users[i].name, users[i].color);
        }
        Object.keys(cursors).forEach(function (id) {
          if (!alive[id]) remove(id);
        });
      },
      clear: function () {
        Object.keys(cursors).forEach(remove);
      },
      destroy: function () {
        if (timer) global.clearTimeout(timer);
        target.removeEventListener('pointermove', onMove);
        (isBody ? global.document.documentElement : container).removeEventListener('pointerleave', onLeave);
        this.clear();
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      },
    };
  }

  // ---------- room ----------

  function join(options) {
    var opts = options || {};
    var WS = opts.WebSocket || global.WebSocket;
    if (!WS) throw new Error('Multiplayer: WebSocket is not available in this environment');

    var roomId = opts.room || readRoomFromHash() || randomId(8);
    if (!ROOM_ID_RE.test(roomId)) throw new TypeError('Multiplayer: room id must be 1-64 letters, digits or hyphens');
    if (opts.updateHash !== false) writeRoomToHash(roomId);

    var serverUrl = opts.serverUrl || defaultServerUrl();
    var store = storage();
    var name = sanitizeName(opts.name) || sanitizeName(store && store.getItem(NAME_STORAGE_KEY)) || 'Guest-' + randomId(4);
    if (store) store.setItem(NAME_STORAGE_KEY, name);

    var reconnectBaseMs = opts.reconnectBaseMs || 1000;
    var reconnectMaxMs = opts.reconnectMaxMs || 30000;
    var pingIntervalMs = opts.pingIntervalMs || 25000;
    var token = opts.token || null;

    var me = { id: randomId(16), name: name, color: '#888888', role: 'editor', user: null };
    var state = Object.create(null); // local view (server state + optimistic writes)
    var pending = Object.create(null); // writes not yet sent (offline queue), last-write-wins per key
    var inflight = Object.create(null); // key -> number of our writes awaiting server echo
    var presence = [];
    var status = 'connecting';
    var ws = null;
    var joined = false;
    var closedByUser = false;
    var attempt = 0;
    var reconnectTimer = null;
    var pingTimer = null;
    var lastSeen = 0;
    var cursorLayer = null;
    var emitter = createEmitter();

    function pendingCount() {
      return Object.keys(pending).length;
    }

    function send(msg) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    }

    function isLive() {
      return joined && ws && ws.readyState === 1;
    }

    function setStatus(next) {
      status = next;
      emitter.emit('status', function () {
        return [{ status: status, pending: pendingCount(), attempt: attempt }];
      });
    }

    function emitChange(changedKeys, source) {
      if (changedKeys.length === 0) return;
      emitter.emit('change', function () {
        return [clone(state), { keys: changedKeys.slice(), source: source }];
      });
    }

    function emitPresence() {
      emitter.emit('presence', function () {
        return [clone(presence)];
      });
    }

    /** Write to local state; returns true if the visible value changed. */
    function writeLocal(key, value) {
      var had = Object.prototype.hasOwnProperty.call(state, key);
      if (value === null) {
        if (!had) return false;
        delete state[key];
        return true;
      }
      if (had && JSON.stringify(state[key]) === JSON.stringify(value)) return false;
      state[key] = value;
      return true;
    }

    function sendPatch(patch) {
      var keys = Object.keys(patch);
      for (var i = 0; i < keys.length; i++) inflight[keys[i]] = (inflight[keys[i]] || 0) + 1;
      send({ type: 'set_state', patch: patch });
    }

    function flushPending() {
      var keys = Object.keys(pending);
      if (keys.length === 0) return;
      var patch = {};
      for (var i = 0; i < keys.length; i++) patch[keys[i]] = pending[keys[i]];
      pending = Object.create(null);
      sendPatch(patch);
    }

    function requeueInflight() {
      // We can't know whether unacknowledged writes reached the server, so resend them.
      var keys = Object.keys(inflight);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!Object.prototype.hasOwnProperty.call(pending, key)) {
          pending[key] = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
        }
      }
      inflight = Object.create(null);
    }

    function applySnapshot(serverState) {
      var changed = {};
      Object.keys(state).forEach(function (k) {
        changed[k] = true;
      });
      state = Object.create(null);
      inflight = Object.create(null);
      Object.keys(serverState || {}).forEach(function (k) {
        if (!isForbiddenKey(k)) {
          state[k] = serverState[k];
          changed[k] = true;
        }
      });
      // Re-apply offline writes on top of the authoritative snapshot.
      Object.keys(pending).forEach(function (k) {
        writeLocal(k, pending[k]);
        changed[k] = true;
      });
      joined = true;
      attempt = 0;
      emitChange(Object.keys(changed), 'snapshot');
      flushPending();
      setStatus('connected');
    }

    function applyRemotePatch(msg) {
      var patch = msg.patch || {};
      var fromMe = msg.from === me.id;
      var changed = [];
      Object.keys(patch).forEach(function (key) {
        if (isForbiddenKey(key)) return;
        if (fromMe && inflight[key]) {
          inflight[key]--;
          if (inflight[key] <= 0) delete inflight[key];
          else return; // a newer write of ours is still in flight
        } else if (inflight[key] || Object.prototype.hasOwnProperty.call(pending, key)) {
          return; // our newer write will override this one on the server
        }
        if (writeLocal(key, patch[key])) changed.push(key);
      });
      emitChange(changed, fromMe ? 'local' : 'remote');
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'welcome':
          me.id = msg.clientId;
          me.name = msg.name;
          me.color = msg.color;
          if (msg.role) me.role = msg.role;
          if (msg.user) me.user = msg.user;
          return;
        case 'snapshot':
          return applySnapshot(msg.state);
        case 'state_update':
          return applyRemotePatch(msg);
        case 'presence':
          presence = Array.isArray(msg.users) ? msg.users : [];
          if (cursorLayer) cursorLayer.syncPresence(presence);
          return emitPresence();
        case 'cursor':
          if (cursorLayer && msg.id !== me.id) cursorLayer.update(msg);
          return;
        case 'error': {
          var err = new Error(msg.message || 'Server error');
          err.code = msg.code;
          emitter.emit('error', function () {
            return [err];
          });
          if (msg.code === 'invalid_patch' || msg.code === 'rate_limited') {
            // Our optimistic write was rejected: resync with the server's truth.
            send({ type: 'sync' });
          }
          return;
        }
        default:
          return; // pong and unknown types
      }
    }

    function connect() {
      if (closedByUser) return;
      if (reconnectTimer) global.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

      var socket;
      try {
        socket = new WS(serverUrl);
      } catch (e) {
        scheduleReconnect();
        return;
      }
      ws = socket;

      socket.onopen = function () {
        if (ws !== socket) return;
        lastSeen = Date.now();
        var joinMsg = { type: 'join', room: roomId, clientId: me.id, name: me.name };
        if (token) joinMsg.token = token;
        send(joinMsg);
        startPing();
      };

      socket.onmessage = function (event) {
        if (ws !== socket) return;
        lastSeen = Date.now();
        var msg;
        try {
          msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        } catch (e) {
          return;
        }
        if (msg && typeof msg.type === 'string') handleMessage(msg);
      };

      socket.onerror = function () {
        /* onclose follows and handles reconnection */
      };

      socket.onclose = function (event) {
        handleClose(socket, event && event.code);
      };
    }

    function handleClose(socket, code) {
      if (ws !== socket) return;
      ws = null;
      joined = false;
      stopPing();
      requeueInflight();
      if (cursorLayer) cursorLayer.clear();
      presence = presence.filter(function (u) {
        return u.id === me.id;
      });
      emitPresence();

      if (closedByUser) return setStatus('disconnected');
      if (FATAL_CLOSE_CODES[code]) {
        closedByUser = true;
        return setStatus('disconnected');
      }
      scheduleReconnect();
    }

    function scheduleReconnect() {
      if (closedByUser || reconnectTimer) return;
      attempt++;
      var ceiling = Math.min(reconnectMaxMs, reconnectBaseMs * Math.pow(2, attempt - 1));
      var delay = ceiling / 2 + Math.random() * (ceiling / 2); // "equal jitter"
      setStatus('reconnecting');
      reconnectTimer = global.setTimeout(function () {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function startPing() {
      stopPing();
      pingTimer = global.setInterval(function () {
        if (!ws) return;
        if (Date.now() - lastSeen > pingIntervalMs * 2.5) {
          // Connection is silently dead; force a reconnect without waiting for TCP timeout.
          var dead = ws;
          try {
            dead.close();
          } catch (e) {
            /* ignore */
          }
          handleClose(dead, 1006);
          return;
        }
        send({ type: 'ping', t: Date.now() });
      }, pingIntervalMs);
    }

    function stopPing() {
      if (pingTimer) global.clearInterval(pingTimer);
      pingTimer = null;
    }

    function onOnline() {
      if (!ws && !closedByUser) {
        attempt = Math.max(attempt, 1);
        connect();
      }
    }

    function onOffline() {
      if (ws) {
        var dead = ws;
        try {
          dead.close();
        } catch (e) {
          /* ignore */
        }
        handleClose(dead, 1006);
      }
    }

    if (global.addEventListener) {
      global.addEventListener('online', onOnline);
      global.addEventListener('offline', onOffline);
    }

    var room = {
      /** Room id (also stored in the URL hash as #room=<id>). */
      get id() {
        return roomId;
      },
      /** Your identity: { id, name, color }. */
      get me() {
        return clone(me);
      },
      /** 'connecting' | 'connected' | 'reconnecting' | 'disconnected' */
      get status() {
        return status;
      },

      /** setState('key', value) or setState({ a: 1, b: 2 }). A null/undefined value deletes the key. */
      setState: function (keyOrPatch, value) {
        if (closedByUser) throw new Error('Multiplayer: room is disconnected');
        var entries = normalizeEntries(keyOrPatch, value);
        var changed = [];
        var patch = {};
        for (var i = 0; i < entries.length; i++) {
          var key = entries[i][0];
          var val = entries[i][1];
          if (writeLocal(key, val)) changed.push(key);
          if (isLive()) patch[key] = val;
          else pending[key] = val;
        }
        if (Object.keys(patch).length) sendPatch(patch);
        emitChange(changed, 'local');
        if (!isLive()) setStatus(status);
      },

      /** getState() returns a copy of the whole state; getState('key') returns a copy of one value. */
      getState: function (key) {
        if (key === undefined) return clone(state);
        return Object.prototype.hasOwnProperty.call(state, key) ? clone(state[key]) : undefined;
      },

      /** fn(state, { keys, source }) where source is 'local' | 'remote' | 'snapshot'. Returns unsubscribe. */
      onStateChange: function (fn) {
        return emitter.on('change', fn);
      },
      /** fn([{ id, name, color }]) whenever someone joins, leaves or renames. Returns unsubscribe. */
      onPresenceChange: function (fn) {
        return emitter.on('presence', fn);
      },
      /** fn({ status, pending, attempt }). Returns unsubscribe. */
      onStatusChange: function (fn) {
        return emitter.on('status', fn);
      },
      /** fn(Error) for server-side rejections (invalid patch, room full...). Returns unsubscribe. */
      onError: function (fn) {
        return emitter.on('error', fn);
      },

      getPresence: function () {
        return clone(presence);
      },
      getPendingCount: pendingCount,

      /** URL other people can open to join this room. */
      shareUrl: function () {
        var url = new URL(global.location.href);
        if (url.searchParams && url.searchParams.has('room')) {
          url.searchParams.delete('room');
        }
        var params = new URLSearchParams(url.hash.slice(1));
        params.set('room', roomId);
        url.hash = params.toString();
        return url.toString();
      },

      /** Change your display name for everyone in the room. */
      setName: function (newName) {
        var clean = sanitizeName(newName);
        if (!clean) throw new TypeError('Multiplayer: name cannot be empty');
        me.name = clean;
        if (store) store.setItem(NAME_STORAGE_KEY, clean);
        if (isLive()) send({ type: 'set_name', name: clean });
        return clean;
      },

      /**
       * Show everyone's cursor over `options.container` (default: document.body).
       * Positions are relative to the container, so all clients should render it at the same size.
       * Returns { disable() }.
       */
      enableCursors: function (cursorOptions) {
        var copts = cursorOptions || {};
        if (cursorLayer) return { disable: room.disableCursors };
        var container = copts.container || global.document.body;
        if (!container) throw new Error('Multiplayer: enableCursors() needs document.body; call it after DOMContentLoaded');
        cursorLayer = createCursorLayer(
          container,
          function (x, y) {
            if (isLive()) send({ type: 'cursor_move', x: x, y: y });
          },
          copts
        );
        return { disable: room.disableCursors };
      },
      disableCursors: function () {
        if (cursorLayer) cursorLayer.destroy();
        cursorLayer = null;
      },

      /** Leave the room for good (no reconnection). Unsent offline writes are dropped. */
      disconnect: function () {
        if (closedByUser) return;
        closedByUser = true;
        if (reconnectTimer) global.clearTimeout(reconnectTimer);
        reconnectTimer = null;
        stopPing();
        if (global.removeEventListener) {
          global.removeEventListener('online', onOnline);
          global.removeEventListener('offline', onOffline);
        }
        room.disableCursors();
        var socket = ws;
        ws = null;
        joined = false;
        if (socket) {
          try {
            socket.close(1000, 'bye');
          } catch (e) {
            /* ignore */
          }
        }
        setStatus('disconnected');
      },
    };

    connect();
    return room;
  }

  global.Multiplayer = Object.freeze({ version: VERSION, join: join });
})(typeof window !== 'undefined' ? window : globalThis);