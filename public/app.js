/* Sticky-note board demo. Uses only the public window.Multiplayer API. */
(function () {
  'use strict';

  var BOARD_W = 2400;
  var BOARD_H = 1600;
  var NOTE_W = 200;
  var NOTE_H = 180;
  var COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'];
  var TEXT_MAX = 500;
  var DRAG_SEND_MS = 40;
  var TEXT_DEBOUNCE_MS = 250;
  var NOTE_ID_RE = /^[a-z0-9]{6,16}$/;
  var MAX_AVATARS = 6;

  var $ = function (id) {
    return document.getElementById(id);
  };
  var board = $('board');
  var boardWrap = $('board-wrap');
  var emptyHint = $('empty-hint');
  var statusEl = $('status');
  var presenceEl = $('presence');
  var nameInput = $('name-input');
  var toastEl = $('toast');
  var emptyAddNote = $('empty-add-note');
  var emptyInvite = $('empty-invite');

  // ---- Multiplayer: this is the whole integration ----
  var room = Multiplayer.join();
  room.enableCursors({ container: board });
  room.onStateChange(function (state) {
    latest = state;
    render();
  });
  room.onPresenceChange(renderPresence);
  room.onStatusChange(renderStatus);
  room.onError(function (err) {
    toast('Sync error: ' + err.message);
  });
  // -----------------------------------------------------

  var latest = room.getState();
  var noteEls = new Map(); // id -> { el, text, author }
  var drag = null; // { id, el, offsetX, offsetY, x, y, z, lastSent, timer }
  var textTimers = new Map();

  // ---------- helpers ----------

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function newId() {
    var bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
    return out;
  }

  function getNote(id) {
    var n = latest['note:' + id];
    return n && typeof n === 'object' ? n : null;
  }

  function getPos(id) {
    var p = latest['pos:' + id];
    if (!p || !isNum(p.x) || !isNum(p.y)) return { x: 40, y: 40, z: 1 };
    return { x: clamp(p.x, 0, BOARD_W - NOTE_W), y: clamp(p.y, 0, BOARD_H - NOTE_H), z: isNum(p.z) ? p.z : 1 };
  }

  function topZ() {
    var max = 0;
    Object.keys(latest).forEach(function (k) {
      if (k.indexOf('pos:') === 0 && latest[k] && isNum(latest[k].z)) max = Math.max(max, latest[k].z);
    });
    return max + 1;
  }

  function placeEl(el, x, y, z) {
    el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    el.style.zIndex = String(clamp(Math.round(z), 1, 100000));
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, 2200);
  }

  // ---------- rendering ----------

  function render() {
    var seen = new Set();
    Object.keys(latest).forEach(function (key) {
      if (key.indexOf('note:') !== 0) return;
      var id = key.slice(5);
      if (!NOTE_ID_RE.test(id) || !getNote(id)) return;
      seen.add(id);
      upsertNote(id);
    });
    noteEls.forEach(function (entry, id) {
      if (!seen.has(id)) {
        if (drag && drag.id === id) drag = null;
        entry.el.remove();
        noteEls.delete(id);
      }
    });
    // Dismiss welcome card smoothly when notes exist
    if (seen.size > 0 && !emptyHint.hidden) {
      emptyHint.classList.add('is-leaving');
      emptyHint.addEventListener('animationend', function handler() {
        emptyHint.hidden = true;
        emptyHint.classList.remove('is-leaving');
        emptyHint.removeEventListener('animationend', handler);
      }, { once: true });
    } else if (seen.size === 0 && emptyHint.hidden) {
      emptyHint.hidden = false;
    }
  }

  function createNoteEl(id) {
    var el = document.createElement('article');
    el.className = 'note';
    el.tabIndex = 0;
    el.dataset.id = id;
    el.setAttribute('aria-roledescription', 'sticky note');

    var bar = document.createElement('div');
    bar.className = 'note-bar';
    bar.dataset.role = 'handle';

    var author = document.createElement('span');
    author.className = 'note-author';

    var colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'note-btn';
    colorBtn.dataset.action = 'color';
    colorBtn.setAttribute('aria-label', 'Change note color');
    colorBtn.title = 'Change color';
    colorBtn.textContent = '◐';

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'note-btn';
    delBtn.dataset.action = 'delete';
    delBtn.setAttribute('aria-label', 'Delete note');
    delBtn.title = 'Delete';
    delBtn.textContent = '✕';

    var text = document.createElement('textarea');
    text.className = 'note-text';
    text.maxLength = TEXT_MAX;
    text.placeholder = 'Write something…';
    text.setAttribute('aria-label', 'Note text');

    bar.appendChild(author);
    bar.appendChild(colorBtn);
    bar.appendChild(delBtn);
    el.appendChild(bar);
    el.appendChild(text);
    board.appendChild(el);
    return { el: el, text: text, author: author };
  }

  function upsertNote(id) {
    var entry = noteEls.get(id);
    if (!entry) {
      entry = createNoteEl(id);
      noteEls.set(id, entry);
    }
    var note = getNote(id);
    var color = COLORS.indexOf(note.color) !== -1 ? note.color : COLORS[0];
    entry.el.dataset.color = color;
    var authorName = typeof note.author === 'string' ? note.author : 'Someone';
    entry.author.textContent = authorName; // textContent keeps user input inert
    entry.el.setAttribute('aria-label', 'Sticky note by ' + authorName);

    // Don't fight the local user: skip text while they type, position while they drag.
    var text = typeof note.text === 'string' ? note.text.slice(0, TEXT_MAX) : '';
    if (document.activeElement !== entry.text && !textTimers.has(id) && entry.text.value !== text) {
      entry.text.value = text;
    }
    if (!(drag && drag.id === id)) {
      var pos = getPos(id);
      placeEl(entry.el, pos.x, pos.y, pos.z);
    }
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts
      .map(function (p) {
        return p.charAt(0);
      })
      .join('')
      .toUpperCase() || '?';
  }

  function renderPresence(users) {
    var me = room.me;
    var list = users.slice().sort(function (a, b) {
      return (b.id === me.id) - (a.id === me.id);
    });
    presenceEl.textContent = '';
    list.slice(0, MAX_AVATARS).forEach(function (u) {
      var li = document.createElement('li');
      li.style.background = u.color;
      var displayName = u.id === me.id ? u.name + ' (you)' : u.name;
      li.title = displayName;
      if (u.id === me.id) li.className = 'is-me';

      var abbr = document.createElement('span');
      abbr.setAttribute('aria-hidden', 'true');
      abbr.className = 'avatar-abbr';
      abbr.textContent = initials(u.name);

      // Custom animated popup tooltip on hover
      var tip = document.createElement('span');
      tip.className = 'avatar-tooltip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = displayName;

      var full = document.createElement('span');
      full.className = 'visually-hidden';
      full.textContent = displayName;

      li.appendChild(abbr);
      li.appendChild(tip);
      li.appendChild(full);
      presenceEl.appendChild(li);
    });
    if (list.length > MAX_AVATARS) {
      var more = document.createElement('li');
      more.className = 'more';
      var moreCount = list.length - MAX_AVATARS;
      var moreSpan = document.createElement('span');
      moreSpan.setAttribute('aria-hidden', 'true');
      moreSpan.className = 'avatar-abbr';
      moreSpan.textContent = '+' + moreCount;

      var moreTip = document.createElement('span');
      moreTip.className = 'avatar-tooltip';
      moreTip.setAttribute('role', 'tooltip');
      moreTip.textContent = '+' + moreCount + ' more in this room';

      more.appendChild(moreSpan);
      more.appendChild(moreTip);
      presenceEl.appendChild(more);
    }
    presenceEl.setAttribute('aria-label', list.length + (list.length === 1 ? ' person' : ' people') + ' in this room');
  }

  var STATUS_TEXT = { connecting: 'Connecting…', connected: 'Live', reconnecting: 'Reconnecting…', disconnected: 'Offline' };

  function renderStatus(info) {
    var label = STATUS_TEXT[info.status] || info.status;
    if (info.status !== 'connected' && info.pending > 0) {
      label += ' · ' + info.pending + ' change' + (info.pending === 1 ? '' : 's') + ' queued';
    }
    statusEl.dataset.status = info.status;
    var textEl = statusEl.querySelector('.status-text');
    if (textEl) {
      if (textEl.textContent !== label) textEl.textContent = label;
    } else {
      if (statusEl.textContent !== label) statusEl.textContent = label;
    }
  }

  // ---------- actions (all go through room.setState) ----------

  function addNote(x, y) {
    var id = newId();
    var patch = {};
    patch['note:' + id] = { text: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], author: room.me.name, createdAt: Date.now() };
    patch['pos:' + id] = { x: clamp(Math.round(x), 0, BOARD_W - NOTE_W), y: clamp(Math.round(y), 0, BOARD_H - NOTE_H), z: topZ() };
    room.setState(patch);
    var entry = noteEls.get(id);
    if (entry) entry.text.focus();
  }

  function deleteNote(id) {
    var patch = {};
    patch['note:' + id] = null;
    patch['pos:' + id] = null;
    room.setState(patch);
  }

  function cycleColor(id) {
    var note = getNote(id);
    if (!note) return;
    var next = COLORS[(COLORS.indexOf(note.color) + 1) % COLORS.length];
    room.setState('note:' + id, Object.assign({}, note, { color: next }));
  }

  function commitText(id) {
    clearTimeout(textTimers.get(id));
    textTimers.delete(id);
    var entry = noteEls.get(id);
    var note = getNote(id);
    if (!entry || !note || note.text === entry.text.value) return;
    room.setState('note:' + id, Object.assign({}, note, { text: entry.text.value.slice(0, TEXT_MAX) }));
  }

  function moveNote(id, dx, dy) {
    var pos = getPos(id);
    room.setState('pos:' + id, {
      x: clamp(pos.x + dx, 0, BOARD_W - NOTE_W),
      y: clamp(pos.y + dy, 0, BOARD_H - NOTE_H),
      z: pos.z,
    });
  }

  function boardPoint(event) {
    var rect = board.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // ---------- dragging ----------

  function sendDragPos(force) {
    if (!drag) return;
    var d = drag;
    var wait = DRAG_SEND_MS - (Date.now() - d.lastSent);
    if (force || wait <= 0) {
      clearTimeout(d.timer);
      d.timer = null;
      d.lastSent = Date.now();
      room.setState('pos:' + d.id, { x: d.x, y: d.y, z: d.z });
    } else if (!d.timer) {
      d.timer = setTimeout(function () {
        d.timer = null;
        if (drag === d) sendDragPos(true);
      }, wait);
    }
  }

  board.addEventListener('pointerdown', function (event) {
    var handle = event.target.closest('[data-role="handle"]');
    if (!handle || event.target.closest('button') || event.button !== 0) return;
    var el = handle.closest('.note');
    var id = el.dataset.id;
    var pos = getPos(id);
    var p = boardPoint(event);
    drag = { id: id, el: el, offsetX: p.x - pos.x, offsetY: p.y - pos.y, x: pos.x, y: pos.y, z: topZ(), lastSent: 0, timer: null };
    handle.setPointerCapture(event.pointerId);
    el.classList.add('is-dragging');
    placeEl(el, pos.x, pos.y, drag.z);
    sendDragPos(true); // bring to front for everyone
    event.preventDefault();
  });

  board.addEventListener('pointermove', function (event) {
    if (!drag) return;
    var p = boardPoint(event);
    drag.x = Math.round(clamp(p.x - drag.offsetX, 0, BOARD_W - NOTE_W));
    drag.y = Math.round(clamp(p.y - drag.offsetY, 0, BOARD_H - NOTE_H));
    placeEl(drag.el, drag.x, drag.y, drag.z);
    sendDragPos(false);
  });

  function endDrag() {
    if (!drag) return;
    sendDragPos(true);
    drag.el.classList.remove('is-dragging');
    drag = null;
  }
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);

  // ---------- board events ----------

  board.addEventListener('dblclick', function (event) {
    if (event.target !== board && event.target !== emptyHint) return;
    var p = boardPoint(event);
    addNote(p.x - NOTE_W / 2, p.y - 20);
  });

  board.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-action]');
    if (!btn) return;
    var id = btn.closest('.note').dataset.id;
    if (btn.dataset.action === 'delete') deleteNote(id);
    else if (btn.dataset.action === 'color') cycleColor(id);
  });

  board.addEventListener('input', function (event) {
    if (!event.target.classList.contains('note-text')) return;
    var id = event.target.closest('.note').dataset.id;
    clearTimeout(textTimers.get(id));
    textTimers.set(
      id,
      setTimeout(function () {
        commitText(id);
      }, TEXT_DEBOUNCE_MS)
    );
  });

  board.addEventListener('focusout', function (event) {
    if (!event.target.classList.contains('note-text')) return;
    commitText(event.target.closest('.note').dataset.id);
    setTimeout(render, 0); // pick up any remote text we skipped while typing
  });

  board.addEventListener('keydown', function (event) {
    var target = event.target;
    if (target.classList.contains('note-text')) {
      if (event.key === 'Escape') target.closest('.note').focus();
      return;
    }
    if (!target.classList.contains('note')) return;
    var id = target.dataset.id;
    var step = event.shiftKey ? 40 : 10;
    var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      moveNote(id, moves[event.key][0], moves[event.key][1]);
      event.preventDefault();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteNote(id);
      board.focus();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      noteEls.get(id).text.focus();
      event.preventDefault();
    }
  });

  // ---------- header ----------

  $('room-id').textContent = room.id;
  nameInput.value = room.me.name;

  function saveName() {
    try {
      nameInput.value = room.setName(nameInput.value);
    } catch (err) {
      nameInput.value = room.me.name;
      toast('Name cannot be empty');
    }
  }
  nameInput.addEventListener('change', saveName);
  nameInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') nameInput.blur();
  });

  $('add-note').addEventListener('click', function () {
    var x = boardWrap.scrollLeft + boardWrap.clientWidth / 2 - NOTE_W / 2 + (Math.random() * 60 - 30);
    var y = boardWrap.scrollTop + boardWrap.clientHeight / 2 - NOTE_H / 2 + (Math.random() * 60 - 30);
    addNote(x, y);
  });

  // Invite Modal & Link Copy
  var inviteModal = $('invite-modal');
  var inviteLinkInput = $('invite-link-input');
  var inviteCopyBtn = $('invite-copy-btn');
  var inviteModalClose = $('invite-modal-close');
  var inviteDoneBtn = $('invite-done-btn');
  var inviteOpenTabBtn = $('invite-open-tab-btn');
  var inviteLanHint = $('invite-lan-hint');
  var modalStatusMsg = $('modal-status-msg');

  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopyText(text);
      });
    }
    return fallbackCopyText(text);
  }

  function fallbackCopyText(text) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '2em';
        ta.style.height = '2em';
        ta.style.padding = '0';
        ta.style.border = 'none';
        ta.style.outline = 'none';
        ta.style.boxShadow = 'none';
        ta.style.background = 'transparent';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var successful = false;
        try {
          successful = document.execCommand('copy');
        } catch (err) {
          successful = false;
        }
        document.body.removeChild(ta);
        if (successful) resolve();
        else reject(new Error('Copy command failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function openInviteModal() {
    var url = room.shareUrl();
    if (inviteLinkInput) inviteLinkInput.value = url;

    // Show LAN / local testing tip if running on localhost
    if (inviteLanHint) {
      var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (isLocal) {
        inviteLanHint.innerHTML = 'Room ID: <code>' + room.id + '</code> &bull; To invite friends on the same Wi-Fi, share with your LAN IP (e.g. <code>172.22.231.64:' + (location.port || '3001') + '/#room=' + room.id + '</code>)';
      } else {
        inviteLanHint.innerHTML = 'Room ID: <code>' + room.id + '</code>';
      }
    }

    // 1. Copy to clipboard automatically with full fallback
    copyTextToClipboard(url).then(
      function () {
        if (modalStatusMsg) modalStatusMsg.textContent = 'Link copied to clipboard ✓';
        toast('Invite link copied ✓');
        if (inviteCopyBtn) {
          inviteCopyBtn.classList.add('is-copied');
          var textEl = inviteCopyBtn.querySelector('.copy-btn-text');
          if (textEl) textEl.textContent = 'Copied!';
          setTimeout(function () {
            inviteCopyBtn.classList.remove('is-copied');
            if (textEl) textEl.textContent = 'Copy';
          }, 2000);
        }
      },
      function () {
        if (modalStatusMsg) modalStatusMsg.textContent = 'Select and copy the URL below';
        toast('Invite link ready');
      }
    );

    // 2. Open short professional window
    if (inviteModal) {
      inviteModal.removeAttribute('hidden');
      inviteModal.hidden = false;
      inviteModal.setAttribute('aria-hidden', 'false');
      inviteModal.classList.add('is-open');
      if (inviteLinkInput) {
        setTimeout(function () {
          inviteLinkInput.focus();
          inviteLinkInput.select();
        }, 50);
      }
    }
  }

  function closeInviteModal() {
    if (!inviteModal) return;
    inviteModal.classList.remove('is-open');
    inviteModal.setAttribute('hidden', '');
    inviteModal.hidden = true;
    inviteModal.setAttribute('aria-hidden', 'true');
  }

  $('copy-link').addEventListener('click', openInviteModal);

  if (inviteModalClose) inviteModalClose.addEventListener('click', closeInviteModal);
  if (inviteDoneBtn) inviteDoneBtn.addEventListener('click', closeInviteModal);

  if (inviteOpenTabBtn) {
    inviteOpenTabBtn.addEventListener('click', function () {
      var url = inviteLinkInput && inviteLinkInput.value ? inviteLinkInput.value : room.shareUrl();
      window.open(url, '_blank');
      closeInviteModal();
      toast('Opened in new tab — watch presence update!');
    });
  }

  if (inviteLinkInput) {
    inviteLinkInput.addEventListener('click', function () {
      inviteLinkInput.select();
    });
  }

  if (inviteModal) {
    inviteModal.addEventListener('click', function (e) {
      if (e.target === inviteModal) closeInviteModal();
    });
  }

  if (inviteCopyBtn) {
    inviteCopyBtn.addEventListener('click', function () {
      var url = inviteLinkInput && inviteLinkInput.value ? inviteLinkInput.value : room.shareUrl();
      copyTextToClipboard(url).then(
        function () {
          inviteCopyBtn.classList.add('is-copied');
          var textEl = inviteCopyBtn.querySelector('.copy-btn-text');
          if (textEl) textEl.textContent = 'Copied!';
          if (modalStatusMsg) modalStatusMsg.textContent = 'Link copied to clipboard ✓';
          toast('Invite link copied ✓');
          setTimeout(function () {
            inviteCopyBtn.classList.remove('is-copied');
            if (textEl) textEl.textContent = 'Copy';
          }, 2000);
        },
        function () {
          if (inviteLinkInput) {
            inviteLinkInput.focus();
            inviteLinkInput.select();
          }
          toast('Please press Ctrl+C to copy');
        }
      );
    });
  }

  // Join Modal & Room Switcher
  var joinModal = $('join-modal');
  var joinCodeInput = $('join-code-input');
  var joinRoomBtn = $('join-room-btn');
  var joinModalClose = $('join-modal-close');
  var joinCancelBtn = $('join-cancel-btn');
  var joinSubmitBtn = $('join-submit-btn');
  var joinForm = $('join-form');

  function openJoinModal() {
    if (!joinModal) return;
    joinModal.removeAttribute('hidden');
    joinModal.hidden = false;
    joinModal.setAttribute('aria-hidden', 'false');
    joinModal.classList.add('is-open');
    if (joinCodeInput) {
      joinCodeInput.value = '';
      setTimeout(function () {
        joinCodeInput.focus();
      }, 50);
    }
  }

  function closeJoinModal() {
    if (!joinModal) return;
    joinModal.classList.remove('is-open');
    joinModal.setAttribute('hidden', '');
    joinModal.hidden = true;
    joinModal.setAttribute('aria-hidden', 'true');
  }

  function handleJoinSubmit() {
    if (!joinCodeInput) return;
    var val = String(joinCodeInput.value || '').trim();
    if (!val) {
      toast('Please enter a room code');
      joinCodeInput.focus();
      return;
    }

    // Auto-extract code if full URL was pasted (e.g. http://localhost:3001/#room=abc or ?room=abc)
    var code = val;
    if (val.indexOf('#') !== -1) {
      var afterHash = val.split('#')[1];
      var p = new URLSearchParams(afterHash);
      code = p.get('room') || afterHash;
    } else if (val.indexOf('?') !== -1) {
      var p = new URLSearchParams(val.split('?')[1]);
      code = p.get('room') || val;
    }

    code = code.replace(/^[#?]/, '').replace(/^room=/, '').trim();

    var ROOM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
    if (!ROOM_ID_RE.test(code)) {
      toast('Invalid room code (use letters, numbers or hyphens)');
      joinCodeInput.focus();
      return;
    }

    if (code === room.id) {
      toast('You are already in room #' + code);
      closeJoinModal();
      return;
    }

    toast('Joining room #' + code + '…');
    closeJoinModal();
    location.hash = 'room=' + code;
    setTimeout(function () {
      if (location.hash !== '#room=' + code) {
        location.hash = 'room=' + code;
      }
      location.reload();
    }, 60);
  }

  if (joinRoomBtn) joinRoomBtn.addEventListener('click', openJoinModal);
  if (joinModalClose) joinModalClose.addEventListener('click', closeJoinModal);
  if (joinCancelBtn) joinCancelBtn.addEventListener('click', closeJoinModal);
  if (joinSubmitBtn) joinSubmitBtn.addEventListener('click', handleJoinSubmit);
  if (joinForm) joinForm.addEventListener('submit', function (e) { e.preventDefault(); handleJoinSubmit(); });

  if (joinModal) {
    joinModal.addEventListener('click', function (e) {
      if (e.target === joinModal) closeJoinModal();
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (inviteModal && !inviteModal.hidden) closeInviteModal();
      if (joinModal && !joinModal.hidden) closeJoinModal();
    }
  });

  $('new-room').addEventListener('click', function () {
    location.hash = '';
    location.reload();
  });

  // Welcome card CTA buttons
  if (emptyAddNote) {
    emptyAddNote.addEventListener('click', function () {
      var x = boardWrap.scrollLeft + boardWrap.clientWidth / 2 - NOTE_W / 2 + (Math.random() * 60 - 30);
      var y = boardWrap.scrollTop + boardWrap.clientHeight / 2 - NOTE_H / 2 + (Math.random() * 60 - 30);
      addNote(x, y);
    });
  }

  if (emptyInvite) {
    emptyInvite.addEventListener('click', function (e) {
      e.preventDefault();
      openInviteModal();
    });
  }

  // Pasting a different room link into this tab switches rooms.
  window.addEventListener('hashchange', function () {
    var params = new URLSearchParams(location.hash.slice(1));
    var newRoom = params.get('room');
    if (!newRoom) {
      var raw = location.hash.replace(/^#/, '');
      if (raw && !raw.includes('=')) newRoom = raw;
    }
    if (newRoom && newRoom !== room.id) location.reload();
  });

  renderStatus({ status: room.status, pending: 0 });
  renderPresence([room.me]);
  render();
})();