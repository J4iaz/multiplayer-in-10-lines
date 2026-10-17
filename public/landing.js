/* Landing Page interactive scripts — Vanilla JS */
(function () {
  'use strict';

  // If a room parameter/hash is present, remember it
  var rawHash = (window.location.hash || '').replace(/^#/, '');
  var search = window.location.search || '';
  var hp = new URLSearchParams(rawHash);
  var sp = new URLSearchParams(search);
  var intendedRoom = hp.get('room') || sp.get('room');
  if (!intendedRoom && rawHash && /^[a-zA-Z0-9-]{1,64}$/.test(rawHash) && rawHash.indexOf('=') === -1) {
    intendedRoom = rawHash;
  }
  if (intendedRoom) {
    sessionStorage.setItem('intended_room', intendedRoom);
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

  try {
    localStorage.removeItem('sticky_my_rooms');
  } catch (e) {}
  function saveRoom() {}

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
    var curSession = getStoredSession();
    if (!curSession || !curSession.user || !curSession.access_token) {
      openAuthModal('Sign In to Create Room', 'You must sign in or create an account to start a new collaborative room.');
      return;
    }
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

  // --- Google Meet Style Hero Join Input ---
  var heroJoinInput = document.getElementById('hero-join-input');
  var heroJoinBtn = document.getElementById('hero-join-btn');
  var heroJoinForm = document.getElementById('hero-join-form');

  function handleHeroJoin() {
    if (!heroJoinInput) return;
    var raw = String(heroJoinInput.value || '').trim();
    if (!raw) {
      heroJoinInput.focus();
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
      heroJoinInput.focus();
      return;
    }
    saveRoom(code);
    window.location.href = '/app.html#room=' + encodeURIComponent(code);
  }

  if (heroJoinInput && heroJoinBtn) {
    heroJoinInput.addEventListener('input', function () {
      var val = heroJoinInput.value.trim();
      if (val.length > 0) {
        heroJoinBtn.disabled = false;
        heroJoinBtn.style.opacity = '1';
        heroJoinBtn.style.pointerEvents = 'auto';
        heroJoinBtn.classList.add('btn-primary-glass');
      } else {
        heroJoinBtn.disabled = true;
        heroJoinBtn.style.opacity = '0.6';
        heroJoinBtn.style.pointerEvents = 'none';
        heroJoinBtn.classList.remove('btn-primary-glass');
      }
    });
    heroJoinBtn.addEventListener('click', handleHeroJoin);
  }
  if (heroJoinForm) {
    heroJoinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      handleHeroJoin();
    });
  }

  // --- Auth Modal ---
  var authModal = document.getElementById('auth-modal');
  var authModalClose = document.getElementById('auth-modal-close');
  var authGoFullBtn = document.getElementById('authGoFullBtn');
  var landingGuestBtn = document.getElementById('landing-guest-btn');
  var landingGuestForm = document.getElementById('landing-guest-form');
  var landingGuestName = document.getElementById('landing-guest-name');

  function openAuthModal(title, desc) {
    if (authModal) {
      authModal.removeAttribute('hidden');
      authModal.hidden = false;
      authModal.classList.add('is-open');
      var titleEl = document.getElementById('auth-modal-title');
      var descEl = authModal.querySelector('.modal-desc');
      if (title && titleEl) titleEl.textContent = title;
      if (desc && descEl) descEl.textContent = desc;
      if (landingGuestName) {
        setTimeout(function () { landingGuestName.focus(); }, 80);
      }
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

  function handleGuestEntry() {
    if (!landingGuestName) return;
    var name = String(landingGuestName.value || '').trim();
    if (!name) {
      landingGuestName.focus();
      return;
    }
    var targetRoom = sessionStorage.getItem('intended_room');
    if (!targetRoom) {
      alert('Sign in is required to create a new room. Guests can only join existing rooms with an invite link or room code.');
      window.location.href = '/auth.html';
      return;
    }
    localStorage.setItem('nexusmeet_guest_name', name);
    saveRoom(targetRoom);
    closeAuthModal();
    window.location.href = '/app.html#room=' + encodeURIComponent(targetRoom);
  }

  if (landingGuestBtn) landingGuestBtn.addEventListener('click', handleGuestEntry);
  if (landingGuestForm) landingGuestForm.addEventListener('submit', function (e) {
    e.preventDefault();
    handleGuestEntry();
  });

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

  try {
    localStorage.removeItem('sticky_my_rooms');
  } catch (e) {}

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
  initShowcaseDemo();
})();
