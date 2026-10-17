/* ──────────────────────────────────────────────
   public/auth.js — vanilla JS auth flow
   Strict CSP compliant (no inline scripts)
────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── State ──
  var config = { hasAuth: false, hasAI: false, allowGuests: true };
  var supabase = null;
  var currentView = 'login';
  var verifyMode = 'signup'; // 'signup' | 'forgot'
  var pendingEmail = '';

  // ── DOM refs ──
  var tabs = document.getElementById('authTabs');
  var devNotice = document.getElementById('devNotice');
  var loginGuestBtn = document.getElementById('loginGuestBtn');

  // ── Toast ──
  function toast(msg, type, duration) {
    type = type || 'error';
    duration = duration || 5000;
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    var timer = setTimeout(function () { dismiss(el); }, duration);
    el.addEventListener('click', function () { clearTimeout(timer); dismiss(el); });
  }

  function dismiss(el) {
    el.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(function () { el.remove(); }, 300);
  }

  // ── View transitions ──
  function showView(id, hideTabBar) {
    document.querySelectorAll('.auth-view').forEach(function (v) {
      v.classList.remove('active', 'visible');
    });
    var target = document.getElementById('view-' + id);
    if (!target) return;
    if (tabs) {
      tabs.style.display = (hideTabBar || id === 'forgot' || id === 'verify' || id === 'newpass') ? 'none' : '';
    }
    currentView = id;
    target.classList.add('active');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        target.classList.add('visible');
      });
    });
  }

  // ── Tab switching ──
  if (tabs) {
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn');
      if (!btn) return;
      tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      showView(btn.dataset.tab);
    });
  }

  // ── Password toggle ──
  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.dataset.target);
      if (!input) return;
      var isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.setAttribute('aria-label', isText ? 'Show password' : 'Hide password');
    });
  });

  // ── Password strength ──
  function getStrength(pw) {
    if (!pw || pw.length < 4) return 0;
    var score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(4, Math.floor(score * 4 / 5) + (pw.length >= 6 ? 1 : 0));
  }

  function updateStrength(pw, prefix) {
    prefix = prefix || '';
    var levels = ['', 'weak', 'fair', 'good', 'strong'];
    var labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    var score = getStrength(pw);
    for (var i = 0; i < 4; i++) {
      var seg = document.getElementById((prefix || '') + 'seg' + i);
      if (seg) {
        seg.className = 'strength-seg';
        if (i < score) seg.classList.add(levels[score]);
      }
    }
    var label = document.getElementById((prefix || '') + 'strengthLabel');
    if (label) label.textContent = pw ? labels[score] : '';
  }

  var signupPw = document.getElementById('signup-password');
  if (signupPw) {
    signupPw.addEventListener('input', function () {
      updateStrength(this.value, '');
    });
  }

  var newpassPw = document.getElementById('newpass-password');
  if (newpassPw) {
    newpassPw.addEventListener('input', function () {
      updateStrength(this.value, 'n');
    });
  }

  // ── OTP wiring ──
  var otpInputs = Array.from(document.querySelectorAll('.otp-input'));
  otpInputs.forEach(function (inp, idx) {
    inp.addEventListener('input', function () {
      var val = inp.value.replace(/\D/g, '');
      inp.value = val ? val[0] : '';
      if (val && idx < otpInputs.length - 1) otpInputs[idx + 1].focus();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !inp.value && idx > 0) {
        otpInputs[idx - 1].focus();
      }
    });
    inp.addEventListener('paste', function (e) {
      e.preventDefault();
      var data = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      data.slice(0, 6).split('').forEach(function (ch, i) {
        if (otpInputs[i]) otpInputs[i].value = ch;
      });
      var next = Math.min(data.length, 5);
      if (otpInputs[next]) otpInputs[next].focus();
    });
  });

  function getOTP() {
    return otpInputs.map(function (i) { return i.value; }).join('');
  }

  function clearOTP() {
    otpInputs.forEach(function (i) { i.value = ''; });
    if (otpInputs[0]) otpInputs[0].focus();
  }

  // ── Spinner helper ──
  function setLoading(btn, loading, text) {
    if (!btn) return;
    if (loading) {
      btn._origText = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span> ' + (text || 'Loading…');
      btn.disabled = true;
    } else {
      btn.innerHTML = btn._origText || text || 'Submit';
      btn.disabled = false;
    }
  }

  // ── Redirect after auth ──
  function redirectAfterAuth() {
    var room = sessionStorage.getItem('intended_room') || '';
    sessionStorage.removeItem('intended_room');
    var dest = '/app.html';
    if (room) dest = '/app.html#room=' + encodeURIComponent(room);
    window.location.href = dest;
  }

  // ── Guest mode ──
  if (loginGuestBtn) {
    loginGuestBtn.addEventListener('click', function () {
      if (!localStorage.getItem('nexusmeet_guest_name')) {
        localStorage.setItem('nexusmeet_guest_name', 'Guest_' + Math.floor(1000 + Math.random() * 9000));
      }
      redirectAfterAuth();
    });
  }

  // ── Forgot password flow ──
  var forgotLink = document.getElementById('forgotLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      if (email) document.getElementById('forgot-email').value = email;
      showView('forgot');
    });
  }

  var forgotBack = document.getElementById('forgotBack');
  if (forgotBack) {
    forgotBack.addEventListener('click', function () {
      showView('login');
    });
  }

  var verifyBack = document.getElementById('verifyBack');
  if (verifyBack) {
    verifyBack.addEventListener('click', function () {
      showView(verifyMode === 'forgot' ? 'forgot' : 'signup');
    });
  }

  // ── Resend ──
  var resendBtn = document.getElementById('resendBtn');
  if (resendBtn) {
    resendBtn.addEventListener('click', function () {
      if (!supabase || !pendingEmail) return;
      supabase.auth.resend({ type: 'signup', email: pendingEmail })
        .then(function () { toast('Code resent!', 'info'); })
        .catch(function (err) { toast(err.message || 'Resend failed', 'error'); });
    });
  }

  // ── Initialize Supabase (client-side) ──
  function initSupabase() {
    if (!config.hasAuth) return;
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
      var url = window._SUPABASE_URL || '';
      var anonKey = window._SUPABASE_ANON_KEY || '';
      if (url && anonKey) {
        supabase = window.supabase.createClient(url, anonKey);
      }
    }
    if (!supabase) {
      console.info('[auth] Supabase client not initialized — add window._SUPABASE_URL and window._SUPABASE_ANON_KEY');
    }
  }

  // ── Login ──
  var loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      var btn = this;

      if (!email || !password) { toast('Please enter email and password.', 'error'); return; }
      if (!supabase) { toast('Supabase not configured — auth is disabled in dev mode.', 'error'); return; }

      setLoading(btn, true, 'Signing in…');
      supabase.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          setLoading(btn, false);
          if (res.error) { toast(res.error.message, 'error'); return; }
          if (res.data && res.data.session) {
            localStorage.setItem('supabase_session', JSON.stringify(res.data.session));
          }
          toast('Signed in!', 'success', 2000);
          setTimeout(redirectAfterAuth, 600);
        })
        .catch(function (err) {
          setLoading(btn, false);
          toast(err.message || 'Login failed', 'error');
        });
    });
  }

  // ── Signup ──
  var signupBtn = document.getElementById('signupBtn');
  if (signupBtn) {
    signupBtn.addEventListener('click', function () {
      var name = document.getElementById('signup-name').value.trim();
      var email = document.getElementById('signup-email').value.trim();
      var password = document.getElementById('signup-password').value;
      var btn = this;

      if (!name || !email || !password) { toast('Please fill in all fields.', 'error'); return; }
      if (getStrength(password) < 2) { toast('Password is too weak.', 'error'); return; }
      if (!supabase) { toast('Supabase not configured — auth is disabled in dev mode.', 'error'); return; }

      setLoading(btn, true, 'Creating account…');
      supabase.auth.signUp({
        email: email,
        password: password,
        options: { data: { display_name: name, full_name: name } }
      }).then(function (res) {
        setLoading(btn, false);
        if (res.error) { toast(res.error.message, 'error'); return; }
        pendingEmail = email;
        verifyMode = 'signup';
        document.getElementById('verifySubtitle').textContent =
          'We sent a 6-digit code to ' + email + '. Enter it below.';
        showView('verify');
        toast('Account created! Check your email.', 'success', 4000);
      }).catch(function (err) {
        setLoading(btn, false);
        toast(err.message || 'Signup failed', 'error');
      });
    });
  }

  // ── Forgot submit ──
  var forgotBtn = document.getElementById('forgotBtn');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', function () {
      var email = document.getElementById('forgot-email').value.trim();
      var btn = this;

      if (!email) { toast('Enter your email address.', 'error'); return; }
      if (!supabase) { toast('Supabase not configured.', 'error'); return; }

      setLoading(btn, true, 'Sending…');
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/auth.html#newpass'
      }).then(function (res) {
        setLoading(btn, false);
        if (res.error) { toast(res.error.message, 'error'); return; }
        pendingEmail = email;
        verifyMode = 'forgot';
        document.getElementById('verifySubtitle').textContent =
          'We sent a reset link to ' + email + '. Check your inbox.';
        showView('verify');
        toast('Reset link sent!', 'success', 4000);
      }).catch(function (err) {
        setLoading(btn, false);
        toast(err.message || 'Failed to send reset link', 'error');
      });
    });
  }

  // ── Verify OTP ──
  var verifyBtn = document.getElementById('verifyBtn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', function () {
      var code = getOTP();
      var btn = this;

      if (code.length !== 6) { toast('Enter the full 6-digit code.', 'error'); return; }
      if (!supabase) { toast('Supabase not configured.', 'error'); return; }

      setLoading(btn, true, 'Verifying…');
      var type = verifyMode === 'forgot' ? 'recovery' : 'signup';
      supabase.auth.verifyOtp({ email: pendingEmail, token: code, type: type })
        .then(function (res) {
          setLoading(btn, false);
          if (res.error) { toast(res.error.message, 'error'); clearOTP(); return; }
          if (verifyMode === 'forgot') {
            showView('newpass');
          } else {
            toast('Email verified! Redirecting…', 'success', 2000);
            setTimeout(redirectAfterAuth, 800);
          }
        })
        .catch(function (err) {
          setLoading(btn, false);
          toast(err.message || 'Verification failed', 'error');
          clearOTP();
        });
    });
  }

  // ── New password submit ──
  var newpassBtn = document.getElementById('newpassBtn');
  if (newpassBtn) {
    newpassBtn.addEventListener('click', function () {
      var pw = document.getElementById('newpass-password').value;
      var confirm = document.getElementById('newpass-confirm').value;
      var btn = this;

      if (!pw || !confirm) { toast('Please fill in both fields.', 'error'); return; }
      if (pw !== confirm) { toast('Passwords do not match.', 'error'); return; }
      if (getStrength(pw) < 2) { toast('Password is too weak.', 'error'); return; }
      if (!supabase) { toast('Supabase not configured.', 'error'); return; }

      setLoading(btn, true, 'Updating…');
      supabase.auth.updateUser({ password: pw })
        .then(function (res) {
          setLoading(btn, false);
          if (res.error) { toast(res.error.message, 'error'); return; }
          toast('Password updated! Redirecting…', 'success', 2000);
          setTimeout(redirectAfterAuth, 1000);
        })
        .catch(function (err) {
          setLoading(btn, false);
          toast(err.message || 'Update failed', 'error');
        });
    });
  }

  // ── Google OAuth ──
  function signInWithGoogle() {
    if (!supabase) { toast('Supabase not configured.', 'error'); return; }
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth.html' }
    }).then(function (res) {
      if (res && res.error) {
        toast('Google login requires Google Cloud setup in Supabase. Please use Email/Password or Guest mode!', 'error', 6000);
      }
    }).catch(function (err) {
      toast('Google login requires Google Cloud setup in Supabase. Please use Email/Password or Guest mode!', 'error', 6000);
    });
  }

  var googleLoginBtn = document.getElementById('loginGoogleBtn');
  if (googleLoginBtn) googleLoginBtn.addEventListener('click', signInWithGoogle);
  var googleSignupBtn = document.getElementById('signupGoogleBtn');
  if (googleSignupBtn) googleSignupBtn.addEventListener('click', signInWithGoogle);

  // ── Load config ──
  fetch('/api/config')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      config = data;

      if (!config.hasAuth) {
        if (devNotice) devNotice.style.display = '';
        // If in dev mode, enable buttons so users can test or allow guest continue
        if (loginGuestBtn) loginGuestBtn.style.display = '';
      } else {
        if (data.supabaseUrl && data.supabaseAnonKey) {
          window._SUPABASE_URL = data.supabaseUrl;
          window._SUPABASE_ANON_KEY = data.supabaseAnonKey;
        }
        initSupabase();
        if (supabase) {
          supabase.auth.onAuthStateChange(function (event, session) {
            if (session) {
              localStorage.setItem('supabase_session', JSON.stringify(session));
              if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
                toast('Signed in successfully!', 'success', 2000);
                setTimeout(redirectAfterAuth, 500);
              }
            }
          });
          supabase.auth.getSession().then(function (res) {
            if (res.data && res.data.session) {
              localStorage.setItem('supabase_session', JSON.stringify(res.data.session));
              redirectAfterAuth();
            }
          });
          if (window.location.hash.indexOf('newpass') !== -1 ||
              window.location.hash.indexOf('type=recovery') !== -1) {
            showView('newpass');
          }
        }
      }

      if (config.allowGuests && loginGuestBtn) {
        loginGuestBtn.style.display = '';
      }
    })
    .catch(function () {
      if (loginGuestBtn) loginGuestBtn.style.display = '';
    });

  // ── Initial view from hash ──
  var hash = window.location.hash.replace('#', '');
  if (hash === 'signup') {
    showView('signup');
    if (tabs) {
      tabs.querySelectorAll('.tab-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tab === 'signup');
      });
    }
  } else if (hash === 'forgot') {
    showView('forgot');
  } else {
    showView('login');
  }

  // Preserve intended room
  var params = new URLSearchParams(window.location.search);
  if (params.get('room')) {
    sessionStorage.setItem('intended_room', params.get('room'));
  }
})();
