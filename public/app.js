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

  function getStoredSession() {
    try {
      var custom = localStorage.getItem('supabase_session');
      if (custom) {
        var parsed = JSON.parse(custom);
        if (parsed && (parsed.access_token || (parsed.session && parsed.session.access_token))) {
          return parsed.session || parsed;
        }
      }
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith('sb-') || k.includes('auth-token'))) {
          var val = localStorage.getItem(k);
          if (val) {
            var p = JSON.parse(val);
            if (p && (p.access_token || (p.session && p.session.access_token))) {
              return p.session || p;
            }
          }
        }
      }
    } catch (e) {}
    return null;
  }

  var session = getStoredSession();
  var joinOptions = {};
  if (session && session.access_token) {
    joinOptions.token = session.access_token;
    if (session.user) {
      var userDisplayName = (session.user.user_metadata && (session.user.user_metadata.full_name || session.user.user_metadata.display_name)) || (session.user.email ? session.user.email.split('@')[0] : '');
      if (userDisplayName) joinOptions.name = userDisplayName;
    }
  } else {
    var guestName = localStorage.getItem('nexusmeet_guest_name');
    if (!guestName) {
      guestName = 'Guest ' + Math.floor(100 + Math.random() * 900);
      try { localStorage.setItem('nexusmeet_guest_name', guestName); } catch (e) {}
    }
    if (guestName) joinOptions.name = guestName;
  }

  // Pre-fill password from sessionStorage if available
  var curRoomId = '';
  try {
    var rawHash = location.hash.replace(/^#/, '');
    var hashRoom = (location.hash.match(/room=([A-Za-z0-9-]+)/) || [])[1];
    var searchRoom = (location.search.match(/room=([A-Za-z0-9-]+)/) || [])[1];
    curRoomId = hashRoom || searchRoom || (rawHash && rawHash.indexOf('=') === -1 ? rawHash : '');
    if (curRoomId) {
      var savedPwd = sessionStorage.getItem('room_pwd_' + curRoomId);
      if (savedPwd) joinOptions.password = savedPwd;
    }
  } catch (e) {}

  // If no room is specified in URL, this is an attempt to create a new room.
  // Enforce authentication: bina sign in ke new room create na ho!
  if (!curRoomId && (!session || !session.access_token)) {
    window.location.replace('/auth.html');
    return;
  }

  // ---- Multiplayer: this is the whole integration ----
  var room = Multiplayer.join(joinOptions);

  var whiteboardInstance = null;
  var chatInstance = null;
  var reactionsInstance = null;
  var avatarInstance = null;
  var videoInstance = null;
  var showGatePrompt = null;

  function initAllModules() {
    try {
      if (window.Whiteboard && !whiteboardInstance) {
        whiteboardInstance = window.Whiteboard.init({
          room: room,
          boardWrap: boardWrap,
          board: board,
          onAddNote: function (x, y) {
            addNote(x, y);
          },
          onToast: toast,
        });
      }
    } catch (wbErr) {
      console.warn('Whiteboard module init error:', wbErr);
    }

    try {
      if (window.ChatModule && !chatInstance) {
        chatInstance = window.ChatModule.init(room, {
          drawerId: 'chat-drawer',
          toggleBtnId: 'btn-toggle-chat',
          unreadBadgeId: 'chat-unread-badge',
          messagesListId: 'chat-messages',
          inputId: 'chat-input',
          sendBtnId: 'chat-send-btn',
          closeBtnId: 'chat-close-btn',
          typingIndicatorId: 'chat-typing-indicator',
        });
      }
    } catch (chatErr) {
      console.warn('Chat module init error:', chatErr);
    }

    try {
      if (window.ReactionsModule && !reactionsInstance) {
        reactionsInstance = window.ReactionsModule.init(room, {
          barId: 'reactions-bar',
        });
      }
    } catch (reactErr) {
      console.warn('Reactions module init error:', reactErr);
    }

    try {
      if (window.AvatarModule && !avatarInstance) {
        avatarInstance = window.AvatarModule.init(room, {
          modalId: 'avatar-modal',
          openBtnId: 'btn-toggle-avatar',
          closeBtnId: 'avatar-modal-close',
          saveBtnId: 'avatar-save-btn',
          randomBtnId: 'avatar-random-btn',
          previewWrapId: 'avatar-preview-wrap',
          controlsBodyId: 'avatar-controls-body',
        });
      }
    } catch (avErr) {
      console.warn('Avatar module init error:', avErr);
    }

    try {
      if (window.NexusMeetVideo && !videoInstance) {
        videoInstance = window.NexusMeetVideo.initVideo(room, {
          containerId: 'video-dock',
        });
      }
    } catch (vidErr) {
      console.warn('Video module init error:', vidErr);
    }

    var btnCallTop = $('btn-toggle-call-top');
    if (btnCallTop) {
      btnCallTop.onclick = function () {
        if (videoInstance) {
          if (videoInstance.inCall()) videoInstance.endCall();
          else videoInstance.startCall();
        }
      };
    }

    var btnWb = $('btn-toggle-wb');
    if (btnWb) {
      btnWb.onclick = function () {
        if (emptyHint) {
          emptyHint.dataset.dismissed = 'true';
          emptyHint.classList.add('is-leaving');
          setTimeout(function () { emptyHint.hidden = true; }, 200);
        }
        if (whiteboardInstance) {
          var newTool = whiteboardInstance.tool === 'select' ? 'pencil' : 'select';
          whiteboardInstance.setTool(newTool);
          toast(newTool === 'pencil' ? '✏️ Draw Mode Active' : '👆 Select Mode Active');
        }
      };
    }
  }

  function setupRoomListeners() {
    room.enableCursors({ container: board });
    room.onStateChange(function (state) {
      latest = state;
      render();
    });
    room.onPresenceChange(function (users) {
      renderPresence(users);
      renderParticipantsModal();
      render();
    });
    room.onStatusChange(function (info) {
      renderStatus(info);
      if (info.status === 'connected') {
        initAllModules();
        var pwdModal = $('password-modal');
        if (pwdModal) {
          pwdModal.hidden = true;
          pwdModal.setAttribute('hidden', '');
          pwdModal.classList.remove('is-open');
        }
      }
      render();
    });
    room.onError(function (err) {
      if (err.code === 'bad_password') {
        var pwdModal = $('password-modal');
        if (pwdModal) {
          pwdModal.removeAttribute('hidden');
          pwdModal.hidden = false;
          pwdModal.classList.add('is-open');
          var errEl = $('password-error-msg');
          if (errEl) {
            errEl.textContent = err.message || 'Incorrect room password.';
            errEl.style.display = 'block';
          }
          var passInp = $('room-entry-password');
          if (passInp) setTimeout(function () { passInp.focus(); }, 50);
        }
      } else if (err.code === 'kicked') {
        toast('You have been kicked by the host.');
      } else if (err.code === 'banned') {
        toast('You have been banned from this room.');
      } else if (err.code === 'room_locked') {
        toast('This room is locked by the host.');
      } else if (err.code === 'read_only') {
        toast('Viewers cannot edit the board.');
      } else {
        toast('Sync error: ' + err.message);
      }
    });

    if (room.onHostEvent) {
      room.onHostEvent(function (evt) {
        if (evt.action === 'lock_room') {
          var t = $('lock-room-toggle');
          if (t) t.checked = !!evt.value;
          toast(evt.value ? 'Room locked by host' : 'Room unlocked by host');
        } else if (evt.action === 'viewer_only') {
          var v = $('viewer-only-toggle');
          if (v) v.checked = !!evt.value;
          toast(evt.value ? 'Viewer-only mode enabled' : 'Viewer-only mode disabled');
          render();
        } else if (evt.action === 'set_password') {
          var p = $('password-status-hint');
          if (p) p.textContent = evt.hasPassword ? 'Password protection is enabled.' : 'No password currently set.';
        }
      });
    }

    if (room.onRoleChange) {
      room.onRoleChange(function (newRole) {
        toast('Your role is now ' + (newRole === 'viewer' ? 'Viewer' : (newRole === 'owner' ? 'Host' : 'Editor')));
        render();
      });
    }
  }

  setupRoomListeners();
  initAllModules();
  // -----------------------------------------------------

  function saveRoomToHistory(id) {
    if (!id) return;
    try {
      var list = JSON.parse(localStorage.getItem('sticky_my_rooms') || '[]');
      var idx = list.findIndex(function (r) { return r.id === id; });
      var item = { id: id, name: 'Room #' + id, lastVisited: Date.now() };
      if (idx !== -1) list.splice(idx, 1);
      list.unshift(item);
      localStorage.setItem('sticky_my_rooms', JSON.stringify(list.slice(0, 24)));
    } catch (e) {}
  }
  saveRoomToHistory(room.id);

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
      emptyHint.addEventListener('animationend', function handler(e) {
        if (e && e.animationName && e.animationName !== 'card-leave') return;
        emptyHint.hidden = true;
        emptyHint.classList.remove('is-leaving');
        emptyHint.removeEventListener('animationend', handler);
      });
    } else if (seen.size === 0 && !emptyHint.dataset.dismissed) {
      emptyHint.hidden = false;
      emptyHint.classList.remove('is-leaving');
      emptyHint.style.display = 'flex';
    }

    var isViewer = room.role === 'viewer';
    var viewOnlyBadge = $('view-only-badge');
    if (viewOnlyBadge) viewOnlyBadge.style.display = isViewer ? 'inline-flex' : 'none';
    var addNoteBtn = $('add-note');
    if (addNoteBtn) {
      addNoteBtn.disabled = isViewer;
      addNoteBtn.style.opacity = isViewer ? '0.4' : '1';
    }
    var emptyAddNoteBtn = $('empty-add-note');
    if (emptyAddNoteBtn) {
      emptyAddNoteBtn.disabled = isViewer;
      emptyAddNoteBtn.style.opacity = isViewer ? '0.4' : '1';
    }
    var hostMenuBtn = $('host-menu-btn');
    if (hostMenuBtn) hostMenuBtn.style.display = room.role === 'owner' ? 'inline-flex' : 'none';
  }

  function isAuthor(note) {
    if (!note) return false;
    var me = room.me;
    if (!me) return false;
    if (note.authorId) {
      return note.authorId === me.id;
    }
    if (note.author && me.name) {
      return note.author === me.name;
    }
    return false;
  }

  function createNoteEl(id) {
    var el = document.createElement('article');
    el.className = 'note';
    el.tabIndex = 0;
    el.dataset.id = id;
    el.setAttribute('aria-roledescription', 'sticky note');

    var editorPill = document.createElement('div');
    editorPill.className = 'note-editor-pill';
    editorPill.style.display = 'none';

    var bar = document.createElement('div');
    bar.className = 'note-bar';
    bar.dataset.role = 'handle';

    var author = document.createElement('span');
    author.className = 'note-author';

    var lockIcon = document.createElement('span');
    lockIcon.className = 'note-lock-icon';
    lockIcon.setAttribute('aria-hidden', 'true');
    lockIcon.title = 'Read-only: only the author can edit text (you can still move it)';
    lockIcon.textContent = '🔒';

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
    text.spellcheck = false;
    text.setAttribute('spellcheck', 'false');
    text.setAttribute('autocorrect', 'off');
    text.placeholder = 'Write something…';
    text.setAttribute('aria-label', 'Note text');

    el.appendChild(editorPill);
    bar.appendChild(author);
    bar.appendChild(lockIcon);
    bar.appendChild(colorBtn);
    bar.appendChild(delBtn);
    el.appendChild(bar);
    el.appendChild(text);
    board.appendChild(el);
    return { el: el, text: text, author: author, lockIcon: lockIcon, colorBtn: colorBtn, delBtn: delBtn, editorPill: editorPill };
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

    var isViewer = room.role === 'viewer';
    var canEdit = !isViewer && isAuthor(note);
    if (canEdit) {
      entry.text.readOnly = false;
      entry.el.classList.remove('is-readonly');
      if (entry.lockIcon) entry.lockIcon.style.display = 'none';
      if (entry.colorBtn) entry.colorBtn.style.display = '';
      if (entry.delBtn) entry.delBtn.style.display = '';
      entry.text.removeAttribute('title');
    } else {
      entry.text.readOnly = true;
      entry.el.classList.add('is-readonly');
      if (entry.lockIcon) {
        entry.lockIcon.style.display = 'inline-block';
        entry.lockIcon.title = isViewer ? 'View-only mode: editing is disabled' : ('Only ' + authorName + ' can edit this note (you can still move it)');
      }
      if (entry.colorBtn) entry.colorBtn.style.display = 'none';
      if (entry.delBtn) entry.delBtn.style.display = 'none';
      entry.text.title = isViewer ? 'View-only mode: editing is disabled' : ('Only ' + authorName + ' can edit this note (you can still move it)');
    }

    // Active note editor pill indicator
    var editingUser = null;
    var pres = room.getPresence ? room.getPresence() : [];
    for (var i = 0; i < pres.length; i++) {
      if (pres[i].id !== room.me.id && pres[i].editingNoteId === id) {
        editingUser = pres[i];
        break;
      }
    }
    if (editingUser && entry.editorPill) {
      entry.editorPill.style.display = 'inline-flex';
      entry.editorPill.style.background = editingUser.color;
      entry.editorPill.textContent = '';
      var dot = document.createElement('span');
      dot.className = 'editor-dot';
      var txt = document.createTextNode(editingUser.name + ' is editing…');
      entry.editorPill.appendChild(dot);
      entry.editorPill.appendChild(txt);
    } else if (entry.editorPill) {
      entry.editorPill.style.display = 'none';
    }

    // Don't fight the local user: skip text while the author types, position while they drag.
    var text = typeof note.text === 'string' ? note.text.slice(0, TEXT_MAX) : '';
    var isLocalAuthorEditing = canEdit && (document.activeElement === entry.text || textTimers.has(id));
    if (!isLocalAuthorEditing && entry.text.value !== text) {
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

  function renderParticipantsModal() {
    var modal = $('participants-modal');
    if (!modal || modal.hidden) return;
    var list = room.getPresence ? room.getPresence() : [];
    var countEl = $('participants-count');
    if (countEl) countEl.textContent = list.length;
    var container = $('participants-list');
    if (!container) return;
    container.textContent = '';
    var me = room.me;
    var isOwner = room.role === 'owner';

    list.forEach(function (u) {
      var li = document.createElement('li');
      li.className = 'participant-item';

      var left = document.createElement('div');
      left.className = 'participant-left';

      var avatar = document.createElement('div');
      avatar.className = 'participant-avatar';
      avatar.style.background = u.color;
      avatar.textContent = initials(u.name);

      var details = document.createElement('div');
      details.className = 'participant-details';

      var nameRow = document.createElement('div');
      nameRow.style.display = 'flex';
      nameRow.style.alignItems = 'center';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'participant-name';
      nameSpan.textContent = u.name;
      nameRow.appendChild(nameSpan);

      if (u.id === me.id) {
        var youBadge = document.createElement('span');
        youBadge.className = 'participant-you';
        youBadge.textContent = '(you)';
        nameRow.appendChild(youBadge);
      }

      var roleBadge = document.createElement('span');
      var roleClass = u.role === 'owner' ? 'role-badge-owner' : (u.role === 'viewer' ? 'role-badge-viewer' : 'role-badge-editor');
      roleBadge.className = 'role-badge ' + roleClass;
      roleBadge.textContent = u.role === 'owner' ? 'Host' : (u.role === 'viewer' ? 'Viewer' : 'Editor');

      details.appendChild(nameRow);
      details.appendChild(roleBadge);
      left.appendChild(avatar);
      left.appendChild(details);
      li.appendChild(left);

      if (isOwner && u.id !== me.id) {
        var actions = document.createElement('div');
        actions.className = 'participant-actions';

        var roleBtn = document.createElement('button');
        roleBtn.type = 'button';
        roleBtn.className = 'btn-participant-action';
        roleBtn.textContent = u.role === 'viewer' ? 'Make Editor' : 'Make Viewer';
        roleBtn.onclick = function () {
          var targetRole = u.role === 'viewer' ? 'editor' : 'viewer';
          if (room.sendHostAction) room.sendHostAction('set_role', u.id, targetRole);
        };

        var kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'btn-participant-action btn-kick';
        kickBtn.textContent = 'Kick';
        kickBtn.onclick = function () {
          if (room.sendHostAction) room.sendHostAction('kick', u.id);
        };

        var banBtn = document.createElement('button');
        banBtn.type = 'button';
        banBtn.className = 'btn-participant-action btn-ban';
        banBtn.textContent = 'Ban';
        banBtn.onclick = function () {
          if (room.sendHostAction) room.sendHostAction('ban', u.id);
        };

        actions.appendChild(roleBtn);
        actions.appendChild(kickBtn);
        actions.appendChild(banBtn);
        li.appendChild(actions);
      }

      container.appendChild(li);
    });
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
    if (room.role === 'viewer') {
      toast('View-only mode: cannot add notes');
      return;
    }
    var id = newId();
    var patch = {};
    patch['note:' + id] = {
      text: '',
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      author: room.me.name,
      authorId: room.me.id,
      createdAt: Date.now()
    };
    patch['pos:' + id] = { x: clamp(Math.round(x), 0, BOARD_W - NOTE_W), y: clamp(Math.round(y), 0, BOARD_H - NOTE_H), z: topZ() };
    room.setState(patch);
    var entry = noteEls.get(id);
    if (entry) entry.text.focus();
  }

  function deleteNote(id) {
    if (room.role === 'viewer') {
      toast('View-only mode: cannot delete notes');
      return;
    }
    var note = getNote(id);
    if (!note) return;
    if (!isAuthor(note)) {
      toast('Only ' + (note.author || 'the author') + ' can delete this note');
      return;
    }
    var patch = {};
    patch['note:' + id] = null;
    patch['pos:' + id] = null;
    room.setState(patch);
  }

  function cycleColor(id) {
    if (room.role === 'viewer') {
      toast('View-only mode: cannot change note color');
      return;
    }
    var note = getNote(id);
    if (!note) return;
    if (!isAuthor(note)) {
      toast('Only ' + (note.author || 'the author') + ' can change this note color');
      return;
    }
    var next = COLORS[(COLORS.indexOf(note.color) + 1) % COLORS.length];
    room.setState('note:' + id, Object.assign({}, note, { color: next }));
  }

  function commitText(id) {
    clearTimeout(textTimers.get(id));
    textTimers.delete(id);
    if (room.role === 'viewer') return;
    var entry = noteEls.get(id);
    var note = getNote(id);
    if (!entry || !note || !isAuthor(note) || note.text === entry.text.value) return;
    room.setState('note:' + id, Object.assign({}, note, { text: entry.text.value.slice(0, TEXT_MAX) }));
  }

  function moveNote(id, dx, dy) {
    if (room.role === 'viewer') return;
    var pos = getPos(id);
    room.setState('pos:' + id, {
      x: clamp(pos.x + dx, 0, BOARD_W - NOTE_W),
      y: clamp(pos.y + dy, 0, BOARD_H - NOTE_H),
      z: pos.z,
    });
  }

  function boardPoint(event) {
    var rect = board.getBoundingClientRect();
    var scaleX = board.offsetWidth ? (rect.width / board.offsetWidth) : 1;
    var scaleY = board.offsetHeight ? (rect.height / board.offsetHeight) : 1;
    return {
      x: (event.clientX - rect.left) / (scaleX || 1),
      y: (event.clientY - rect.top) / (scaleY || 1),
    };
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
    if (room.role === 'viewer') return;
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
    if (room.role === 'viewer') {
      toast('View-only mode: cannot add notes');
      return;
    }
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

  board.addEventListener('focusin', function (event) {
    if (!event.target.classList.contains('note-text')) return;
    var noteEl = event.target.closest('.note');
    if (!noteEl) return;
    if (room.setNoteFocus) room.setNoteFocus(noteEl.dataset.id);
    var note = getNote(noteEl.dataset.id);
    if (room.role === 'viewer') {
      toast('View-only mode: editing is disabled');
    } else if (note && !isAuthor(note)) {
      toast('Read-only: only ' + (note.author || 'the author') + ' can edit text (you can still drag & move it)');
    }
  });

  board.addEventListener('input', function (event) {
    if (!event.target.classList.contains('note-text')) return;
    var id = event.target.closest('.note').dataset.id;
    var note = getNote(id);
    if (room.role === 'viewer' || !isAuthor(note)) {
      event.preventDefault();
      event.target.value = note ? (note.text || '') : '';
      toast(room.role === 'viewer' ? 'View-only mode: editing is disabled' : ('Only ' + (note && note.author ? note.author : 'the author') + ' can edit this note'));
      return;
    }
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
    if (room.setNoteFocus) room.setNoteFocus(null);
    var id = event.target.closest('.note').dataset.id;
    var note = getNote(id);
    if (isAuthor(note) && room.role !== 'viewer') {
      commitText(id);
    }
    setTimeout(render, 0); // pick up any remote text we skipped while typing
  });

  board.addEventListener('keydown', function (event) {
    var target = event.target;
    if (target.classList.contains('note-text')) {
      if (event.key === 'Escape') target.closest('.note').focus();
      return;
    }
    if (!target.classList.contains('note')) return;
    if (room.role === 'viewer') return;
    var id = target.dataset.id;
    var step = event.shiftKey ? 40 : 10;
    var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      moveNote(id, moves[event.key][0], moves[event.key][1]);
      event.preventDefault();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      var note = getNote(id);
      if (isAuthor(note)) {
        deleteNote(id);
        board.focus();
      } else {
        toast('Only ' + (note && note.author ? note.author : 'the author') + ' can delete this note');
      }
      event.preventDefault();
    } else if (event.key === 'Enter') {
      var note = getNote(id);
      if (isAuthor(note)) {
        var entry = noteEls.get(id);
        if (entry) entry.text.focus();
      } else {
        toast('Read-only: only ' + (note && note.author ? note.author : 'the author') + ' can edit this note');
      }
      event.preventDefault();
    }
  });

  // ---------- header ----------

  $('room-id').textContent = room.id;
  nameInput.value = room.me.name;

  function saveName() {
    try {
      nameInput.value = room.setName(nameInput.value);
      localStorage.setItem('nexusmeet_guest_name', nameInput.value);
    } catch (err) {
      nameInput.value = room.me.name;
      toast('Name cannot be empty');
    }
  }
  nameInput.addEventListener('change', saveName);
  nameInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') nameInput.blur();
  });

  function getViewportCenterWorldPos() {
    if (whiteboardInstance && whiteboardInstance.screenToWorld) {
      var wrapRect = boardWrap.getBoundingClientRect();
      var center = whiteboardInstance.screenToWorld(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2);
      return {
        x: clamp(center.x - NOTE_W / 2 + (Math.random() * 60 - 30), 0, BOARD_W - NOTE_W),
        y: clamp(center.y - NOTE_H / 2 + (Math.random() * 60 - 30), 0, BOARD_H - NOTE_H),
      };
    }
    return {
      x: clamp(boardWrap.scrollLeft + boardWrap.clientWidth / 2 - NOTE_W / 2 + (Math.random() * 60 - 30), 0, BOARD_W - NOTE_W),
      y: clamp(boardWrap.scrollTop + boardWrap.clientHeight / 2 - NOTE_H / 2 + (Math.random() * 60 - 30), 0, BOARD_H - NOTE_H),
    };
  }

  $('add-note').addEventListener('click', function () {
    var p = getViewportCenterWorldPos();
    addNote(p.x, p.y);
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

  var inviteShareWa = $('invite-share-wa');
  if (inviteShareWa) {
    inviteShareWa.addEventListener('click', function () {
      var url = inviteLinkInput && inviteLinkInput.value ? inviteLinkInput.value : room.shareUrl();
      var text = encodeURIComponent('Join me on NexusMeet: ' + url);
      window.open('https://api.whatsapp.com/send?text=' + text, '_blank');
    });
  }

  var inviteShareEmail = $('invite-share-email');
  if (inviteShareEmail) {
    inviteShareEmail.addEventListener('click', function () {
      var url = inviteLinkInput && inviteLinkInput.value ? inviteLinkInput.value : room.shareUrl();
      var subject = encodeURIComponent('Join NexusMeet Collaborative Room');
      var body = encodeURIComponent('Here is the link to collaborate with me in realtime on NexusMeet:\n\n' + url);
      window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
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

  var userProfileChip = $('user-profile-chip');
  var userAvatarBadge = $('user-avatar-badge');
  var userNameDisplay = $('user-name-display');
  var signOutBtn = $('sign-out-btn');
  var signInBtn = $('sign-in-btn');
  var authModal = $('auth-modal');
  var authModalClose = $('auth-modal-close');
  var authGoPageBtn = $('auth-go-page-btn');

  function updateAuthUI() {
    if (session && session.user) {
      var u = session.user;
      var name = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.display_name)) || u.email || 'Member';
      if (userProfileChip) {
        userProfileChip.style.display = 'flex';
        if (userNameDisplay) userNameDisplay.textContent = name;
        if (userAvatarBadge) userAvatarBadge.textContent = name.slice(0, 2).toUpperCase();
      }
      if (signInBtn) signInBtn.style.display = 'none';
      if (nameInput) nameInput.value = name;
    } else {
      if (userProfileChip) userProfileChip.style.display = 'none';
      if (signInBtn) signInBtn.style.display = '';
    }
  }

  if (signOutBtn) {
    signOutBtn.addEventListener('click', function () {
      try {
        localStorage.removeItem('supabase_session');
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var k = localStorage.key(i);
          if (k && (k.startsWith('sb-') || k.includes('auth-token'))) {
            localStorage.removeItem(k);
          }
        }
      } catch (e) {}
      toast('Signed out');
      setTimeout(function () { location.reload(); }, 250);
    });
  }

  function openAuthModal() {
    if (authModal) {
      authModal.removeAttribute('hidden');
      authModal.hidden = false;
      authModal.classList.add('is-open');
    } else {
      var curRoom = room ? room.id : '';
      location.href = '/auth.html#room=' + encodeURIComponent(curRoom);
    }
  }

  function closeAuthModal() {
    if (!authModal) return;
    authModal.classList.remove('is-open');
    authModal.setAttribute('hidden', '');
    authModal.hidden = true;
  }

  if (signInBtn) signInBtn.addEventListener('click', openAuthModal);
  if (authModalClose) authModalClose.addEventListener('click', closeAuthModal);
  if (authGoPageBtn) {
    authGoPageBtn.addEventListener('click', function () {
      var curRoom = room ? room.id : '';
      location.href = '/auth.html#room=' + encodeURIComponent(curRoom);
    });
  }
  if (authModal) {
    authModal.addEventListener('click', function (e) {
      if (e.target === authModal) closeAuthModal();
    });
  }

  // Host Controls Modal Wiring
  var hostModal = $('host-modal');
  var hostMenuBtn = $('host-menu-btn');
  var hostModalClose = $('host-modal-close');
  var hostModalDoneBtn = $('host-modal-done-btn');
  var lockRoomToggle = $('lock-room-toggle');
  var viewerOnlyToggle = $('viewer-only-toggle');
  var roomPasswordInput = $('room-password-input');
  var setPasswordBtn = $('set-password-btn');
  var passwordStatusHint = $('password-status-hint');

  function openHostModal() {
    if (!hostModal) return;
    hostModal.removeAttribute('hidden');
    hostModal.hidden = false;
    hostModal.setAttribute('aria-hidden', 'false');
    hostModal.classList.add('is-open');
  }

  function closeHostModal() {
    if (!hostModal) return;
    hostModal.classList.remove('is-open');
    hostModal.setAttribute('hidden', '');
    hostModal.hidden = true;
    hostModal.setAttribute('aria-hidden', 'true');
  }

  if (hostMenuBtn) hostMenuBtn.addEventListener('click', openHostModal);
  if (hostModalClose) hostModalClose.addEventListener('click', closeHostModal);
  if (hostModalDoneBtn) hostModalDoneBtn.addEventListener('click', closeHostModal);
  if (hostModal) {
    hostModal.addEventListener('click', function (e) {
      if (e.target === hostModal) closeHostModal();
    });
  }

  if (lockRoomToggle) {
    lockRoomToggle.addEventListener('change', function () {
      if (room.sendHostAction) {
        room.sendHostAction('lock_room', lockRoomToggle.checked);
        toast(lockRoomToggle.checked ? 'Room locked' : 'Room unlocked');
      }
    });
  }

  if (viewerOnlyToggle) {
    viewerOnlyToggle.addEventListener('change', function () {
      if (room.sendHostAction) {
        room.sendHostAction('viewer_only', viewerOnlyToggle.checked);
        toast(viewerOnlyToggle.checked ? 'Viewer-only mode enabled' : 'Viewer-only mode disabled');
      }
    });
  }

  if (setPasswordBtn) {
    setPasswordBtn.addEventListener('click', function () {
      if (!roomPasswordInput) return;
      var pwd = roomPasswordInput.value.trim();
      if (room.sendHostAction) {
        room.sendHostAction('set_password', pwd || null);
        toast(pwd ? 'Room password updated' : 'Room password removed');
        if (passwordStatusHint) {
          passwordStatusHint.textContent = pwd ? 'Password protection is enabled.' : 'No password currently set.';
        }
      }
    });
  }

  // Participants Panel Wiring
  var participantsModal = $('participants-modal');
  var participantsModalClose = $('participants-modal-close');
  var participantsModalCloseBtn = $('participants-modal-close-btn');

  function openParticipantsModal() {
    if (!participantsModal) return;
    participantsModal.removeAttribute('hidden');
    participantsModal.hidden = false;
    participantsModal.setAttribute('aria-hidden', 'false');
    participantsModal.classList.add('is-open');
    renderParticipantsModal();
  }

  function closeParticipantsModal() {
    if (!participantsModal) return;
    participantsModal.classList.remove('is-open');
    participantsModal.setAttribute('hidden', '');
    participantsModal.hidden = true;
    participantsModal.setAttribute('aria-hidden', 'true');
  }

  if (presenceEl) {
    presenceEl.addEventListener('click', function () {
      openParticipantsModal();
    });
  }
  if (participantsModalClose) participantsModalClose.addEventListener('click', closeParticipantsModal);
  if (participantsModalCloseBtn) participantsModalCloseBtn.addEventListener('click', closeParticipantsModal);
  if (participantsModal) {
    participantsModal.addEventListener('click', function (e) {
      if (e.target === participantsModal) closeParticipantsModal();
    });
  }

  // Password Entry Modal Wiring
  var passwordModal = $('password-modal');
  var passwordCancelBtn = $('password-cancel-btn');
  var passwordSubmitBtn = $('password-submit-btn');
  var roomEntryPassword = $('room-entry-password');
  var passwordErrorMsg = $('password-error-msg');
  var passwordForm = $('password-form');

  function submitRoomPassword() {
    if (!roomEntryPassword) return;
    var pwd = roomEntryPassword.value.trim();
    if (!pwd) {
      roomEntryPassword.focus();
      return;
    }
    sessionStorage.setItem('room_pwd_' + room.id, pwd);
    joinOptions.password = pwd;
    if (passwordErrorMsg) passwordErrorMsg.style.display = 'none';
    toast('Unlocking room…');
    room.disconnect();
    room = Multiplayer.join(joinOptions);
    setupRoomListeners();
  }

  if (passwordSubmitBtn) passwordSubmitBtn.addEventListener('click', submitRoomPassword);
  if (passwordForm) passwordForm.addEventListener('submit', function (e) { e.preventDefault(); submitRoomPassword(); });
  if (passwordCancelBtn) {
    passwordCancelBtn.addEventListener('click', function () {
      location.href = '/';
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (inviteModal && !inviteModal.hidden) closeInviteModal();
      if (joinModal && !joinModal.hidden) closeJoinModal();
      if (authModal && !authModal.hidden) closeAuthModal();
      if (hostModal && !hostModal.hidden) closeHostModal();
      if (participantsModal && !participantsModal.hidden) closeParticipantsModal();
    }
  });

  var leaveRoomBtn = $('new-room');
  if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener('click', function () {
      if (room && room.disconnect) {
        try { room.disconnect(); } catch (e) {}
      }
      window.location.href = '/';
    });
  }

  // Welcome card CTA buttons
  if (emptyAddNote) {
    emptyAddNote.addEventListener('click', function () {
      var x = boardWrap.scrollLeft + boardWrap.clientWidth / 2 - NOTE_W / 2 + (Math.random() * 60 - 30);
      var y = boardWrap.scrollTop + boardWrap.clientHeight / 2 - NOTE_H / 2 + (Math.random() * 60 - 30);
      addNote(x, y);
    });
  }

  var emptyDrawBtn = $('empty-draw-btn');
  if (emptyDrawBtn) {
    emptyDrawBtn.addEventListener('click', function () {
      if (emptyHint) {
        emptyHint.dataset.dismissed = 'true';
        emptyHint.classList.add('is-leaving');
        setTimeout(function () { emptyHint.hidden = true; }, 200);
      }
      var btnWb = $('btn-toggle-wb');
      if (btnWb) btnWb.click();
    });
  }

  var emptyCallBtn = $('empty-call-btn');
  if (emptyCallBtn) {
    emptyCallBtn.addEventListener('click', function () {
      var btnCall = $('btn-toggle-call-top');
      if (btnCall) btnCall.click();
    });
  }

  if (emptyInvite) {
    emptyInvite.addEventListener('click', function (e) {
      e.preventDefault();
      openInviteModal();
    });
  }

  var heroRoomCode = $('hero-room-code');
  if (heroRoomCode) {
    heroRoomCode.textContent = '#' + (room.id || '...');
  }

  var heroDismissBtn = $('hero-dismiss-btn');
  if (heroDismissBtn && emptyHint) {
    heroDismissBtn.onclick = function () {
      emptyHint.dataset.dismissed = 'true';
      emptyHint.classList.add('is-leaving');
      setTimeout(function () {
        emptyHint.hidden = true;
      }, 200);
    };
  }

  // Pasting a different room link into this tab switches rooms.
  window.addEventListener('hashchange', function () {
    var params = new URLSearchParams(location.hash.slice(1));
    var newRoom = params.get('room');
    if (!newRoom) {
      var raw = location.hash.replace(/^#/, '');
      if (raw && raw.indexOf('=') === -1) newRoom = raw;
    }
    if (newRoom && newRoom !== room.id) location.reload();
  });

  // --- Auth / Sign In Prompt Modal (Triggered on Join, Invite, Call) ---
  var gateModal = $('gate-modal');
  var gateGuestForm = $('gate-guest-form');
  var gateNameInput = $('gate-name-input');
  var gateEnterBtn = $('gate-enter-btn');
  var gateAuthLink = $('gate-auth-link');
  var gateCloseBtn = $('gate-close-btn');
  var currentRoomCode = (location.hash.match(/room=([A-Za-z0-9-]+)/) || [])[1] || room.id;
  var pendingGateAction = null;

  if (gateAuthLink) {
    gateAuthLink.href = '/auth.html#room=' + encodeURIComponent(currentRoomCode);
  }

  function showGatePrompt(action, callback) {
    pendingGateAction = callback || null;
    var titleEl = $('gate-modal-title');
    var descEl = $('gate-modal-desc');

    if (action === 'invite') {
      if (titleEl) titleEl.textContent = 'Sign In to Invite';
      if (descEl) descEl.textContent = 'Sign in or enter a name so collaborators recognize you';
    } else if (action === 'join') {
      if (titleEl) titleEl.textContent = 'Sign In to Join Room';
      if (descEl) descEl.textContent = 'Sign in or enter a name to enter another room';
    } else if (action === 'call') {
      if (titleEl) titleEl.textContent = 'Sign In to Join Call';
      if (descEl) descEl.textContent = 'Sign in or enter a name before starting video call';
    } else {
      if (titleEl) titleEl.textContent = 'Welcome to NexusMeet';
      if (descEl) descEl.textContent = 'Sign in or enter a name to continue';
    }

    if (gateModal) {
      gateModal.style.display = 'flex';
      gateModal.removeAttribute('hidden');
      gateModal.classList.add('is-open');
      if (gateNameInput) setTimeout(function () { gateNameInput.focus(); }, 100);
    }
  }

  function closeGateModal() {
    if (gateModal) {
      gateModal.style.display = 'none';
      gateModal.classList.remove('is-open');
    }
    pendingGateAction = null;
  }

  if (gateCloseBtn) gateCloseBtn.addEventListener('click', closeGateModal);
  if (gateModal) {
    gateModal.addEventListener('click', function (e) {
      if (e.target === gateModal) closeGateModal();
    });
  }

  function handleGateEnter() {
    if (!gateNameInput) return;
    var name = String(gateNameInput.value || '').trim();
    if (!name) {
      gateNameInput.focus();
      return;
    }
    localStorage.setItem('nexusmeet_guest_name', name);
    if (room && room.setName) room.setName(name);
    if (nameInput) nameInput.value = name;
    closeGateModal();
    toast('Joined room as ' + name);
    if (typeof pendingGateAction === 'function') {
      var cb = pendingGateAction;
      pendingGateAction = null;
      cb();
    }
  }

  if (gateEnterBtn) gateEnterBtn.addEventListener('click', handleGateEnter);
  if (gateGuestForm) gateGuestForm.addEventListener('submit', function (e) {
    e.preventDefault();
    handleGateEnter();
  });

  // Wire up Invite buttons (accessible to all guests without login)
  function onInviteTrigger(e) {
    if (e && e.preventDefault) e.preventDefault();
    openInviteModal();
  }

  var copyLinkBtn = $('copy-link');
  if (copyLinkBtn) copyLinkBtn.onclick = onInviteTrigger;
  if (emptyInvite) emptyInvite.onclick = onInviteTrigger;

  // Wire up Join button (accessible to all guests without login)
  if (joinRoomBtn) {
    joinRoomBtn.onclick = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      openJoinModal();
    };
  }

  // Wire up Sign In button in topbar
  if (signInBtn) {
    signInBtn.onclick = function () {
      showGatePrompt('signin');
    };
  }

  updateAuthUI();
  renderStatus({ status: room.status, pending: 0 });
  renderPresence([room.me]);
  render();
})();