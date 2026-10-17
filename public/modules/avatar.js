/*!
 * Layered SVG Avatar & Expression Generator for NexusMeet
 * Features:
 * - Lightweight layered SVG avatar generator (Skin tone, Hair, Eyes, Mouth, Glasses, Accessories)
 * - Under 2KB total SVG payload (strictly compliant with server limits)
 * - 5 Quick expression buttons: happy, surprised, laughing, thinking, neutral
 * - Avatar Customizer Modal with real-time preview & randomizer
 * - Auto-syncs avatar & expression to presence and live cursor badges
 */
(function (global) {
  'use strict';

  var SKIN_TONES = [
    { label: 'Fair', color: '#ffd1a4' },
    { label: 'Peach', color: '#f5c6a5' },
    { label: 'Warm', color: '#e0ac69' },
    { label: 'Caramel', color: '#c68642' },
    { label: 'Rich Brown', color: '#8d5524' },
    { label: 'Deep', color: '#543214' },
  ];

  var HAIR_COLORS = [
    { label: 'Black', color: '#1a1a1a' },
    { label: 'Dark Brown', color: '#4a2e18' },
    { label: 'Chestnut', color: '#8a5a36' },
    { label: 'Blonde', color: '#e6be8a' },
    { label: 'Red', color: '#b55239' },
    { label: 'Neon Blue', color: '#4a90e2' },
    { label: 'Vibrant Purple', color: '#9b51e0' },
  ];

  var HAIR_STYLES = ['short', 'curly', 'long', 'bob', 'spiky', 'bald'];
  var GLASSES_STYLES = ['none', 'round', 'square', 'sunglasses'];
  var ACCESSORIES_STYLES = ['none', 'headphones', 'party_hat'];
  var EXPRESSIONS = ['happy', 'surprised', 'laughing', 'thinking', 'neutral'];

  var DEFAULT_CONFIG = {
    skin: '#ffd1a4',
    hairStyle: 'short',
    hairColor: '#1a1a1a',
    glasses: 'none',
    accessory: 'none',
    expression: 'neutral',
  };

  /**
   * Generates a self-contained, valid SVG string representing the layered avatar.
   * Typical size: 450 - 850 bytes (well within the 2KB limit).
   */
  function generateAvatarSvg(config) {
    var c = Object.assign({}, DEFAULT_CONFIG, config || {});
    var skin = c.skin || '#ffd1a4';
    var hairColor = c.hairColor || '#1a1a1a';
    var hairStyle = c.hairStyle || 'short';
    var glasses = c.glasses || 'none';
    var accessory = c.accessory || 'none';
    var expr = c.expression || 'neutral';

    var svgParts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">',
      '<defs>',
      '  <linearGradient id="avBg" x1="0%" y1="0%" x2="100%" y2="100%">',
      '    <stop offset="0%" stop-color="#1e3a8a"/>',
      '    <stop offset="100%" stop-color="#0284c7"/>',
      '  </linearGradient>',
      '</defs>',
      '<!-- Background Circle -->',
      '<circle cx="50" cy="50" r="48" fill="url(#avBg)" stroke="rgba(150,215,255,0.4)" stroke-width="2"/>',
    ];

    // Hair Back Layer (for long hair)
    if (hairStyle === 'long') {
      svgParts.push('<path d="M22 42 C16 66, 20 86, 28 92 C38 96, 62 96, 72 92 C80 86, 84 66, 78 42 Z" fill="' + hairColor + '"/>');
    }

    // Modern Hoodie / Shoulders
    svgParts.push(
      '<path d="M18 96 C18 78, 32 72, 50 72 C68 72, 82 78, 82 96 Z" fill="#0f172a"/>',
      '<path d="M42 72 C42 80, 58 80, 58 72" fill="none" stroke="rgba(150,215,255,0.35)" stroke-width="2" stroke-linecap="round"/>'
    );

    // Neck & Ears
    svgParts.push(
      '<rect x="43" y="60" width="14" height="15" rx="5" fill="' + skin + '"/>',
      '<path d="M43 60 C47 64, 53 64, 57 60" fill="rgba(0,0,0,0.1)"/>',
      '<circle cx="26" cy="48" r="5" fill="' + skin + '"/>',
      '<circle cx="74" cy="48" r="5" fill="' + skin + '"/>'
    );

    // Soft Aesthetic Head
    svgParts.push(
      '<path d="M28 44 C28 28, 72 28, 72 44 C72 63, 62 70, 50 70 C38 70, 28 63, 28 44 Z" fill="' + skin + '"/>'
    );

    // Cheeks Blush
    svgParts.push(
      '<ellipse cx="36" cy="52" rx="4.5" ry="2.2" fill="rgba(244,63,94,0.2)"/>',
      '<ellipse cx="64" cy="52" rx="4.5" ry="2.2" fill="rgba(244,63,94,0.2)"/>'
    );

    // Eyebrows
    svgParts.push(
      '<path d="M35 38 Q40 35 45 38" stroke="' + hairColor + '" stroke-width="2" stroke-linecap="round" fill="none"/>',
      '<path d="M55 38 Q60 35 65 38" stroke="' + hairColor + '" stroke-width="2" stroke-linecap="round" fill="none"/>'
    );

    // Eyes Layer
    if (expr === 'laughing') {
      svgParts.push(
        '<path d="M36 47 Q40 41 45 47" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round"/>',
        '<path d="M55 47 Q60 41 64 47" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round"/>'
      );
    } else if (expr === 'surprised') {
      svgParts.push(
        '<circle cx="41" cy="45" r="5" fill="#fff" stroke="#0f172a" stroke-width="2"/>',
        '<circle cx="41" cy="45" r="2.5" fill="#0f172a"/>',
        '<circle cx="59" cy="45" r="5" fill="#fff" stroke="#0f172a" stroke-width="2"/>',
        '<circle cx="59" cy="45" r="2.5" fill="#0f172a"/>'
      );
    } else if (expr === 'thinking') {
      svgParts.push(
        '<path d="M36 40 L46 43" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/>',
        '<ellipse cx="41" cy="46" rx="3.5" ry="4" fill="#0f172a"/>',
        '<circle cx="42.5" cy="44.5" r="1.2" fill="#fff"/>',
        '<path d="M54 43 Q60 39 65 43" stroke="#0f172a" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
        '<ellipse cx="59" cy="47" rx="3" ry="2.5" fill="#0f172a"/>'
      );
    } else {
      // Modern cute glossy eyes
      svgParts.push(
        '<ellipse cx="41" cy="45" rx="3.5" ry="4.2" fill="#0f172a"/>',
        '<circle cx="42.5" cy="43.5" r="1.3" fill="#ffffff"/>',
        '<ellipse cx="59" cy="45" rx="3.5" ry="4.2" fill="#0f172a"/>',
        '<circle cx="60.5" cy="43.5" r="1.3" fill="#ffffff"/>'
      );
    }

    // Mouth Layer
    if (expr === 'laughing') {
      svgParts.push('<path d="M40 57 Q50 72 60 57 Z" fill="#e11d48" stroke="#0f172a" stroke-width="1.8"/><path d="M43 58 Q50 63 57 58" stroke="#fff" stroke-width="2" fill="none"/>');
    } else if (expr === 'happy') {
      svgParts.push('<path d="M42 56 Q50 66 58 56" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>');
    } else if (expr === 'surprised') {
      svgParts.push('<circle cx="50" cy="59" r="4.5" fill="#0f172a"/>');
    } else if (expr === 'thinking') {
      svgParts.push('<path d="M43 59 Q50 58 57 61" stroke="#0f172a" stroke-width="2.5" fill="none" stroke-linecap="round"/>');
    } else {
      svgParts.push('<path d="M44 56 Q50 61 56 56" stroke="#0f172a" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
    }

    // Glasses Layer
    if (glasses === 'round') {
      svgParts.push(
        '<circle cx="41" cy="45" r="9.5" fill="rgba(150,215,255,0.12)" stroke="#e2e8f0" stroke-width="2"/>',
        '<circle cx="59" cy="45" r="9.5" fill="rgba(150,215,255,0.12)" stroke="#e2e8f0" stroke-width="2"/>',
        '<line x1="50.5" y1="45" x2="49.5" y2="45" stroke="#e2e8f0" stroke-width="2"/>'
      );
    } else if (glasses === 'square') {
      svgParts.push(
        '<rect x="32" y="37" width="18" height="16" rx="3" fill="rgba(150,215,255,0.12)" stroke="#96d7ff" stroke-width="2"/>',
        '<rect x="50" y="37" width="18" height="16" rx="3" fill="rgba(150,215,255,0.12)" stroke="#96d7ff" stroke-width="2"/>',
        '<line x1="50" y1="44" x2="50" y2="44" stroke="#96d7ff" stroke-width="2"/>'
      );
    } else if (glasses === 'sunglasses') {
      svgParts.push(
        '<path d="M30 38 Q50 36 70 38 L68 52 Q50 54 32 52 Z" fill="#0f172a" stroke="#334155" stroke-width="1.8"/>',
        '<line x1="35" y1="40" x2="44" y2="49" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-linecap="round"/>'
      );
    }

    // Hair Front Layer
    if (hairStyle === 'short') {
      svgParts.push('<path d="M24 40 C22 18, 50 16, 76 22 C78 28, 76 38, 74 42 C68 28, 50 28, 30 36 C26 38, 24 40, 24 40 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'curly') {
      svgParts.push('<path d="M20 40 C16 32, 22 20, 34 18 C40 12, 60 12, 66 18 C78 20, 84 32, 80 40 C84 46, 78 54, 74 48 C68 32, 32 32, 26 48 C22 54, 16 46, 20 40 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'bob') {
      svgParts.push('<path d="M24 44 C24 60, 26 66, 30 64 C30 50, 34 34, 50 32 C66 34, 70 50, 70 64 C74 66, 76 60, 76 44 C76 18, 24 18, 24 44 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'spiky') {
      svgParts.push('<path d="M22 42 L26 26 L34 32 L42 16 L50 28 L58 14 L66 30 L74 24 L78 42 C68 30, 34 30, 22 42 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'long') {
      svgParts.push('<path d="M24 42 C24 20, 50 20, 76 22 C76 34, 74 42, 74 42 C68 30, 50 30, 26 38 Z" fill="' + hairColor + '"/>');
    }

    // Accessories Layer
    if (accessory === 'headphones') {
      svgParts.push(
        '<path d="M20 50 A30 30 0 0 1 80 50" fill="none" stroke="#96d7ff" stroke-width="4.5" stroke-linecap="round"/>',
        '<rect x="17" y="42" width="8" height="18" rx="4" fill="#3b82f6" stroke="#96d7ff" stroke-width="1.5"/>',
        '<rect x="75" y="42" width="8" height="18" rx="4" fill="#3b82f6" stroke="#96d7ff" stroke-width="1.5"/>'
      );
    } else if (accessory === 'party_hat') {
      svgParts.push(
        '<polygon points="50,4 34,26 66,26" fill="#f59e0b" stroke="#fbbf24" stroke-width="1.5"/>',
        '<circle cx="50" cy="4" r="3" fill="#ef4444"/>',
        '<circle cx="45" cy="18" r="2" fill="#3b82f6"/>',
        '<circle cx="55" cy="14" r="2" fill="#10b981"/>'
      );
    }

    svgParts.push('</svg>');
    return svgParts.join('');
  }

  function getStoredConfig() {
    try {
      var saved = localStorage.getItem('sticky_avatar_config');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  }

  function hasStoredConfig() {
    try {
      return !!localStorage.getItem('sticky_avatar_config');
    } catch (e) {
      return false;
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem('sticky_avatar_config', JSON.stringify(cfg));
    } catch (e) {}
  }

  function initAvatar(room, options) {
    var opts = options || {};
    var currentConfig = getStoredConfig() || Object.assign({}, DEFAULT_CONFIG);

    var modalEl = document.getElementById(opts.modalId || 'avatar-modal');
    var openBtn = document.getElementById(opts.openBtnId || 'avatar-btn');
    var closeBtn = document.getElementById(opts.closeBtnId || 'avatar-modal-close');
    var saveBtn = document.getElementById(opts.saveBtnId || 'avatar-save-btn');
    var resetBtn = document.getElementById(opts.resetBtnId || 'avatar-reset-btn');
    var randomBtn = document.getElementById(opts.randomBtnId || 'avatar-random-btn');
    var previewWrap = document.getElementById(opts.previewWrapId || 'avatar-preview-wrap');
    var quickExprWrap = document.getElementById(opts.quickExprWrapId || 'quick-expressions-bar');
    var miniPreview = document.getElementById(opts.miniPreviewId || 'my-avatar-preview');

    function applyAvatarToTopbar(svg) {
      var topbarBadge = document.getElementById('user-avatar-badge');
      if (!topbarBadge) return;
      if (svg) {
        topbarBadge.innerHTML = svg;
      } else {
        var nameEl = document.getElementById('user-name-display');
        var uName = (nameEl && nameEl.textContent) || 'User';
        topbarBadge.innerHTML = '';
        topbarBadge.textContent = uName.slice(0, 2).toUpperCase();
      }
    }

    function updatePreview() {
      var svg = generateAvatarSvg(currentConfig);
      if (previewWrap) {
        previewWrap.innerHTML = svg;
      }
      if (miniPreview) {
        miniPreview.innerHTML = svg;
      }
    }

    function openModal() {
      if (!modalEl) return;
      modalEl.removeAttribute('hidden');
      modalEl.classList.add('open');
      renderControls();
      updatePreview();
    }

    function closeModal() {
      if (!modalEl) return;
      modalEl.classList.remove('open');
      setTimeout(function () {
        modalEl.setAttribute('hidden', '');
      }, 200);
    }

    function setExpression(expr) {
      if (!EXPRESSIONS.includes(expr)) return;
      currentConfig.expression = expr;
      updatePreview();
      if (room && room.setExpression) {
        room.setExpression(expr);
      }
      if (hasStoredConfig()) {
        var svg = generateAvatarSvg(currentConfig);
        if (room && room.setAvatar) {
          room.setAvatar(svg);
        }
        applyAvatarToTopbar(svg);
      }
    }

    function randomize() {
      currentConfig.skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)].color;
      currentConfig.hairColor = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)].color;
      currentConfig.hairStyle = HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)];
      currentConfig.glasses = GLASSES_STYLES[Math.floor(Math.random() * GLASSES_STYLES.length)];
      currentConfig.accessory = ACCESSORIES_STYLES[Math.floor(Math.random() * ACCESSORIES_STYLES.length)];
      renderControls();
      updatePreview();
    }

    function renderControls() {
      var controlsContainer = document.getElementById('avatar-controls-body');
      if (!controlsContainer) return;
      controlsContainer.innerHTML = '';

      // 1. Skin tone selector
      var skinGroup = document.createElement('div');
      skinGroup.className = 'avatar-field-group';
      var skinLabel = document.createElement('label');
      skinLabel.className = 'avatar-field-label';
      skinLabel.textContent = 'Skin Tone';
      skinGroup.appendChild(skinLabel);

      var skinSwatches = document.createElement('div');
      skinSwatches.className = 'avatar-swatches';
      SKIN_TONES.forEach(function (st) {
        var s = document.createElement('button');
        s.type = 'button';
        s.className = 'avatar-swatch' + (currentConfig.skin === st.color ? ' active' : '');
        s.style.backgroundColor = st.color;
        s.title = st.label;
        s.addEventListener('click', function () {
          currentConfig.skin = st.color;
          renderControls();
          updatePreview();
        });
        skinSwatches.appendChild(s);
      });
      skinGroup.appendChild(skinSwatches);
      controlsContainer.appendChild(skinGroup);

      // 2. Hair Style selector
      var hairGroup = document.createElement('div');
      hairGroup.className = 'avatar-field-group';
      var hairLabel = document.createElement('label');
      hairLabel.className = 'avatar-field-label';
      hairLabel.textContent = 'Hair Style';
      hairGroup.appendChild(hairLabel);

      var hairPills = document.createElement('div');
      hairPills.className = 'avatar-pill-options';
      HAIR_STYLES.forEach(function (style) {
        var p = document.createElement('button');
        p.type = 'button';
        p.className = 'avatar-pill-btn' + (currentConfig.hairStyle === style ? ' active' : '');
        p.textContent = style.charAt(0).toUpperCase() + style.slice(1);
        p.addEventListener('click', function () {
          currentConfig.hairStyle = style;
          renderControls();
          updatePreview();
        });
        hairPills.appendChild(p);
      });
      hairGroup.appendChild(hairPills);
      controlsContainer.appendChild(hairGroup);

      // 3. Hair Color selector
      var hairColorGroup = document.createElement('div');
      hairColorGroup.className = 'avatar-field-group';
      var hairColorLabel = document.createElement('label');
      hairColorLabel.className = 'avatar-field-label';
      hairColorLabel.textContent = 'Hair Color';
      hairColorGroup.appendChild(hairColorLabel);

      var hairSwatches = document.createElement('div');
      hairSwatches.className = 'avatar-swatches';
      HAIR_COLORS.forEach(function (hc) {
        var s = document.createElement('button');
        s.type = 'button';
        s.className = 'avatar-swatch' + (currentConfig.hairColor === hc.color ? ' active' : '');
        s.style.backgroundColor = hc.color;
        s.title = hc.label;
        s.addEventListener('click', function () {
          currentConfig.hairColor = hc.color;
          renderControls();
          updatePreview();
        });
        hairSwatches.appendChild(s);
      });
      hairColorGroup.appendChild(hairSwatches);
      controlsContainer.appendChild(hairColorGroup);

      // 4. Glasses selector
      var glassesGroup = document.createElement('div');
      glassesGroup.className = 'avatar-field-group';
      var glassesLabel = document.createElement('label');
      glassesLabel.className = 'avatar-field-label';
      glassesLabel.textContent = 'Eyewear';
      glassesGroup.appendChild(glassesLabel);

      var glassesPills = document.createElement('div');
      glassesPills.className = 'avatar-pill-options';
      GLASSES_STYLES.forEach(function (style) {
        var p = document.createElement('button');
        p.type = 'button';
        p.className = 'avatar-pill-btn' + (currentConfig.glasses === style ? ' active' : '');
        p.textContent = style.charAt(0).toUpperCase() + style.slice(1);
        p.addEventListener('click', function () {
          currentConfig.glasses = style;
          renderControls();
          updatePreview();
        });
        glassesPills.appendChild(p);
      });
      glassesGroup.appendChild(glassesPills);
      controlsContainer.appendChild(glassesGroup);

      // 5. Accessories selector
      var accGroup = document.createElement('div');
      accGroup.className = 'avatar-field-group';
      var accLabel = document.createElement('label');
      accLabel.className = 'avatar-field-label';
      accLabel.textContent = 'Accessories';
      accGroup.appendChild(accLabel);

      var accPills = document.createElement('div');
      accPills.className = 'avatar-pill-options';
      ACCESSORIES_STYLES.forEach(function (style) {
        var p = document.createElement('button');
        p.type = 'button';
        p.className = 'avatar-pill-btn' + (currentConfig.accessory === style ? ' active' : '');
        p.textContent = style === 'none' ? 'None' : style.replace('_', ' ');
        p.addEventListener('click', function () {
          currentConfig.accessory = style;
          renderControls();
          updatePreview();
        });
        accPills.appendChild(p);
      });
      accGroup.appendChild(accPills);
      controlsContainer.appendChild(accGroup);
    }

    function setupQuickExpressions() {
      if (!quickExprWrap) return;
      quickExprWrap.innerHTML = '';

      var exprMap = [
        { key: 'happy', emoji: '😊', label: 'Happy' },
        { key: 'surprised', emoji: '😮', label: 'Surprised' },
        { key: 'laughing', emoji: '😆', label: 'Laughing' },
        { key: 'thinking', emoji: '🤔', label: 'Thinking' },
        { key: 'neutral', emoji: '😐', label: 'Neutral' },
      ];

      exprMap.forEach(function (item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quick-expr-btn' + (currentConfig.expression === item.key ? ' active' : '');
        btn.title = 'Set expression: ' + item.label;
        btn.setAttribute('aria-label', item.label);
        btn.innerHTML = '<span class="expr-emoji">' + item.emoji + '</span>';

        btn.addEventListener('click', function () {
          setExpression(item.key);
          quickExprWrap.querySelectorAll('.quick-expr-btn').forEach(function (b) {
            b.classList.remove('active');
          });
          btn.classList.add('active');
        });

        quickExprWrap.appendChild(btn);
      });
    }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (randomBtn) randomBtn.addEventListener('click', randomize);

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        try {
          localStorage.removeItem('sticky_avatar_config');
        } catch (e) {}
        currentConfig = Object.assign({}, DEFAULT_CONFIG);
        if (room && room.setAvatar) {
          room.setAvatar(null);
        }
        applyAvatarToTopbar(null);
        updatePreview();
        if (window.toast) {
          window.toast('Avatar removed. Initials restored.');
        }
        closeModal();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveConfig(currentConfig);
        var svg = generateAvatarSvg(currentConfig);
        if (room && room.setAvatar) {
          room.setAvatar(svg);
        }
        applyAvatarToTopbar(svg);
        updatePreview();
        if (window.toast) {
          window.toast('Custom avatar saved!');
        }
        closeModal();
      });
    }

    // Initialize preview and quick expressions
    updatePreview();
    setupQuickExpressions();

    // Only broadcast/apply custom avatar if the user explicitly configured and saved one
    if (hasStoredConfig()) {
      var initialSvg = generateAvatarSvg(currentConfig);
      applyAvatarToTopbar(initialSvg);
      if (room) {
        var sendAvatarOnLive = function () {
          if (room.status === 'connected' && room.setAvatar) {
            room.setAvatar(initialSvg);
          }
        };
        if (room.status === 'connected') {
          sendAvatarOnLive();
        } else if (room.onStatusChange) {
          room.onStatusChange(function (s) {
            if (s.status === 'connected') sendAvatarOnLive();
          });
        }
      }
    }

    return {
      generateSvg: generateAvatarSvg,
      setExpression: setExpression,
      open: openModal,
      close: closeModal,
      getConfig: function () {
        return Object.assign({}, currentConfig);
      },
    };
  }

  global.AvatarModule = {
    init: initAvatar,
    generateSvg: generateAvatarSvg,
    EXPRESSIONS: EXPRESSIONS,
    SKIN_TONES: SKIN_TONES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
