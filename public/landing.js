/* Landing Page interactive scripts — Vanilla JS */
(function () {
  'use strict';

  // If a room parameter/hash is present, automatically route to app board
  var rawHash = (window.location.hash || '').replace(/^#/, '');
  var search = window.location.search || '';
  var hp = new URLSearchParams(rawHash);
  var sp = new URLSearchParams(search);
  var intendedRoom = hp.get('room') || sp.get('room');
  if (!intendedRoom && rawHash && /^[a-zA-Z0-9-]{1,64}$/.test(rawHash) && rawHash.indexOf('=') === -1) {
    intendedRoom = rawHash;
  }
  if (intendedRoom) {
    window.location.replace('/app.html#room=' + encodeURIComponent(intendedRoom));
    return;
  }

  var ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

  function randomRoomId(length) {
    var bytes = new Uint8Array(length || 8);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    return out;
  }

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

  function saveRoom(id, name) {
    if (!id) return;
    try {
      var list = JSON.parse(localStorage.getItem('sticky_my_rooms') || '[]');
      var idx = list.findIndex(function (r) { return r.id === id; });
      var item = {
        id: id,
        name: name || ('Room #' + id),
        lastVisited: Date.now()
      };
      if (idx !== -1) list.splice(idx, 1);
      list.unshift(item);
      localStorage.setItem('sticky_my_rooms', JSON.stringify(list.slice(0, 24)));
    } catch (e) {}
  }

  function getRooms() {
    try {
      return JSON.parse(localStorage.getItem('sticky_my_rooms') || '[]');
    } catch (e) {
      return [];
    }
  }

  function timeAgo(ms) {
    var diff = Date.now() - ms;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  // --- Auth UI initialization ---
  var session = getStoredSession();
  var authNavBtn = document.getElementById('authNavBtn');
  var userProfileNav = document.getElementById('userProfileNav');
  var userAvatarNav = document.getElementById('userAvatarNav');
  var userNameNav = document.getElementById('userNameNav');
  var userSignOutNav = document.getElementById('userSignOutNav');
  var heroAuthBtn = document.getElementById('heroAuthBtn');

  function renderAuthUI() {
    if (session && session.user) {
      var u = session.user;
      var name = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.display_name)) || u.email || 'Member';
      var initials = name.slice(0, 2).toUpperCase();

      if (authNavBtn) authNavBtn.style.display = 'none';
      if (userProfileNav) {
        userProfileNav.style.display = 'flex';
        if (userNameNav) userNameNav.textContent = name;
        if (userAvatarNav) userAvatarNav.textContent = initials;
      }
      if (heroAuthBtn) {
        heroAuthBtn.textContent = 'Go to Board';
        heroAuthBtn.onclick = function () {
          var roomId = randomRoomId(8);
          saveRoom(roomId);
          window.location.href = '/app.html#room=' + roomId;
        };
      }
    } else {
      if (authNavBtn) authNavBtn.style.display = '';
      if (userProfileNav) userProfileNav.style.display = 'none';
      if (heroAuthBtn) {
        heroAuthBtn.textContent = 'Sign In';
        heroAuthBtn.onclick = function () {
          openAuthModal();
        };
      }
    }
  }

  if (userSignOutNav) {
    userSignOutNav.addEventListener('click', function () {
      try {
        localStorage.removeItem('supabase_session');
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var k = localStorage.key(i);
          if (k && (k.startsWith('sb-') || k.includes('auth-token'))) {
            localStorage.removeItem(k);
          }
        }
      } catch (e) {}
      window.location.reload();
    });
  }

  // --- Create Room Handlers ---
  function createAndOpenRoom() {
    var id = randomRoomId(8);
    saveRoom(id);
    window.location.href = '/app.html#room=' + id;
  }

  var createRoomBtns = document.querySelectorAll('.action-create-room');
  createRoomBtns.forEach(function (btn) {
    btn.addEventListener('click', createAndOpenRoom);
  });

  // --- Join Modal ---
  var joinModal = document.getElementById('join-modal');
  var joinModalClose = document.getElementById('join-modal-close');
  var joinCancelBtn = document.getElementById('join-cancel-btn');
  var joinSubmitBtn = document.getElementById('join-submit-btn');
  var joinCodeInput = document.getElementById('join-code-input');
  var joinForm = document.getElementById('join-form');

  function openJoinModal() {
    if (!joinModal) return;
    joinModal.removeAttribute('hidden');
    joinModal.hidden = false;
    joinModal.setAttribute('aria-hidden', 'false');
    joinModal.classList.add('is-open');
    if (joinCodeInput) {
      joinCodeInput.value = '';
      setTimeout(function () { joinCodeInput.focus(); }, 60);
    }
  }

  function closeJoinModal() {
    if (!joinModal) return;
    joinModal.classList.remove('is-open');
    joinModal.setAttribute('hidden', '');
    joinModal.hidden = true;
    joinModal.setAttribute('aria-hidden', 'true');
  }

  function handleJoinRoom() {
    if (!joinCodeInput) return;
    var raw = String(joinCodeInput.value || '').trim();
    if (!raw) {
      joinCodeInput.focus();
      return;
    }
    var code = raw;
    if (raw.indexOf('#') !== -1) {
      var after = raw.split('#')[1];
      var p = new URLSearchParams(after);
      code = p.get('room') || after;
    } else if (raw.indexOf('?') !== -1) {
      var sp = new URLSearchParams(raw.split('?')[1]);
      code = sp.get('room') || raw;
    }
    code = code.replace(/^[#?]/, '').replace(/^room=/, '').trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(code)) {
      alert('Room code must contain only letters, numbers, or hyphens.');
      joinCodeInput.focus();
      return;
    }
    saveRoom(code);
    closeJoinModal();
    window.location.href = '/app.html#room=' + encodeURIComponent(code);
  }

  var openJoinBtns = document.querySelectorAll('.action-open-join');
  openJoinBtns.forEach(function (btn) {
    btn.addEventListener('click', openJoinModal);
  });

  if (joinModalClose) joinModalClose.addEventListener('click', closeJoinModal);
  if (joinCancelBtn) joinCancelBtn.addEventListener('click', closeJoinModal);
  if (joinSubmitBtn) joinSubmitBtn.addEventListener('click', handleJoinRoom);
  if (joinForm) joinForm.addEventListener('submit', function (e) { e.preventDefault(); handleJoinRoom(); });
  if (joinModal) {
    joinModal.addEventListener('click', function (e) {
      if (e.target === joinModal) closeJoinModal();
    });
  }

  // --- Auth Modal ---
  var authModal = document.getElementById('auth-modal');
  var authModalClose = document.getElementById('auth-modal-close');
  var authGoFullBtn = document.getElementById('authGoFullBtn');

  function openAuthModal() {
    if (authModal) {
      authModal.removeAttribute('hidden');
      authModal.hidden = false;
      authModal.classList.add('is-open');
    } else {
      window.location.href = '/auth.html';
    }
  }

  function closeAuthModal() {
    if (!authModal) return;
    authModal.classList.remove('is-open');
    authModal.setAttribute('hidden', '');
    authModal.hidden = true;
  }

  if (authNavBtn) authNavBtn.addEventListener('click', openAuthModal);
  if (authModalClose) authModalClose.addEventListener('click', closeAuthModal);
  if (authGoFullBtn) authGoFullBtn.addEventListener('click', function () {
    window.location.href = '/auth.html';
  });
  if (authModal) {
    authModal.addEventListener('click', function (e) {
      if (e.target === authModal) closeAuthModal();
    });
  }

  // Escape key closes modals
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeJoinModal();
      closeAuthModal();
    }
  });

  // --- Render "My Rooms" Dashboard ---
  function renderMyRooms() {
    var container = document.getElementById('myRoomsContainer');
    if (!container) return;
    var rooms = getRooms();

    if (rooms.length === 0) {
      container.innerHTML = [
        '<div class="rooms-empty-state">',
        '  <svg class="rooms-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
        '    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
        '  </svg>',
        '  <p style="font-size:15px; font-weight:600; color:#fff; margin-bottom:6px;">No rooms visited yet</p>',
        '  <p style="font-size:13px; color:var(--text-muted); margin-bottom:18px;">Create your first room or join one with a team code.</p>',
        '  <button class="btn-hero-primary action-create-room" type="button" style="padding:10px 22px; font-size:13.5px; margin:0 auto;">+ Create New Room</button>',
        '</div>'
      ].join('\n');
      var newBtn = container.querySelector('.action-create-room');
      if (newBtn) newBtn.addEventListener('click', createAndOpenRoom);
      return;
    }

    var html = '<div class="rooms-grid">';
    rooms.forEach(function (r) {
      var timeStr = r.lastVisited ? timeAgo(r.lastVisited) : 'Recent';
      html += [
        '<div class="room-item-card" data-room-id="' + r.id + '">',
        '  <div class="room-item-header">',
        '    <span class="room-item-title">' + (r.name || 'Room #' + r.id) + '</span>',
        '    <span class="room-item-code">#' + r.id + '</span>',
        '  </div>',
        '  <div class="room-item-time">Active: ' + timeStr + '</div>',
        '  <div class="room-item-actions">',
        '    <a class="btn-open-room" href="/app.html#room=' + encodeURIComponent(r.id) + '">Open Board →</a>',
        '    <button class="btn-room-icon btn-copy-room" title="Copy room link" type="button" data-room="' + r.id + '">',
        '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
        '    </button>',
        '    <button class="btn-room-icon btn-remove-room" title="Remove from list" type="button" data-room="' + r.id + '">',
        '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
        '    </button>',
        '  </div>',
        '</div>'
      ].join('\n');
    });
    html += '</div>';
    container.innerHTML = html;

    // Attach room card action listeners
    container.querySelectorAll('.btn-copy-room').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var roomId = btn.dataset.room;
        var url = window.location.origin + '/app.html#room=' + roomId;
        navigator.clipboard.writeText(url).then(function () {
          btn.style.color = '#4ade80';
          setTimeout(function () { btn.style.color = ''; }, 1500);
        });
      });
    });

    container.querySelectorAll('.btn-remove-room').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var roomId = btn.dataset.room;
        var list = getRooms().filter(function (r) { return r.id !== roomId; });
        localStorage.setItem('sticky_my_rooms', JSON.stringify(list));
        renderMyRooms();
      });
    });
  }

  // --- Interactive 10-Line Live Snippet Showcase ---
  function initShowcaseDemo() {
    var countEl = document.getElementById('demoCount');
    var btnEl = document.getElementById('demoBtn');
    var statusEl = document.getElementById('demoStatus');
    var statusTextEl = document.getElementById('demoStatusText');
    var copyBtn = document.getElementById('copySnippetBtn');
    var testTabBtn = document.getElementById('demoTestTabBtn');

    if (!btnEl || !window.Multiplayer) return;

    var demoRoom = window.Multiplayer.join({
      room: 'landing-showcase-v1',
      updateHash: false
    });

    demoRoom.onStatusChange(function (s) {
      if (statusTextEl) {
        statusTextEl.textContent = s.status === 'connected' ? 'Connected (Live)' : s.status;
      }
      if (statusEl) {
        statusEl.style.color = s.status === 'connected' ? '#4ade80' : '#f59e0b';
      }
    });

    demoRoom.onStateChange(function (state) {
      var count = state && typeof state.clicks === 'number' ? state.clicks : 0;
      if (countEl) countEl.textContent = String(count);
      btnEl.textContent = 'Clicked ' + count + ' ' + (count === 1 ? 'time' : 'times');
    });

    btnEl.addEventListener('click', function () {
      var cur = Number(demoRoom.getState('clicks') || 0);
      demoRoom.setState('clicks', cur + 1);
    });

    if (testTabBtn) {
      testTabBtn.addEventListener('click', function () {
        window.open('/10-lines.html', '_blank');
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var snippet = [
          "// 1 script tag + 10 lines of JavaScript:",
          "const room = Multiplayer.join({ room: 'demo' });",
          "room.onStatusChange(s => setStatus(s.status));",
          "room.onStateChange(state => {",
          "  document.getElementById('btn').textContent = `Clicked ${state.clicks || 0} times`;",
          "});",
          "document.getElementById('btn').onclick = () => {",
          "  room.setState('clicks', (room.getState('clicks') || 0) + 1);",
          "};",
          "room.enableCursors();"
        ].join('\n');
        navigator.clipboard.writeText(snippet).then(function () {
          copyBtn.innerHTML = '<span>✓ Copied!</span>';
          setTimeout(function () {
            copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy Code</span>';
          }, 2000);
        });
      });
    }
  }

  // Run on page ready
  renderAuthUI();
  renderMyRooms();
  initShowcaseDemo();
})();
