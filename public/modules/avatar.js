/*!
 * Layered SVG Avatar & Expression Generator for Sticky Board
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
      '<!-- Background Circle -->',
      '<circle cx="50" cy="50" r="48" fill="#0d1333" stroke="rgba(150,215,255,0.4)" stroke-width="2"/>',
    ];

    // Hair Back Layer (for long hair)
    if (hairStyle === 'long') {
      svgParts.push('<path d="M22 45 Q20 85 30 92 Q50 95 70 92 Q80 85 78 45 Z" fill="' + hairColor + '"/>');
    }

    // Body / Shoulders
    svgParts.push('<path d="M25 96 Q50 82 75 96 Z" fill="rgba(150,215,255,0.3)"/>');

    // Head Base + Ears + Neck
    svgParts.push(
      '<rect x="42" y="70" width="16" height="14" rx="4" fill="' + skin + '"/>',
      '<circle cx="21" cy="52" r="6" fill="' + skin + '"/>',
      '<circle cx="79" cy="52" r="6" fill="' + skin + '"/>',
      '<circle cx="50" cy="50" r="30" fill="' + skin + '"/>'
    );

    // Eyes Layer (changes with expression)
    if (expr === 'laughing') {
      svgParts.push(
        '<path d="M34 47 Q40 40 44 47" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>',
        '<path d="M56 47 Q60 40 66 47" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>'
      );
    } else if (expr === 'surprised') {
      svgParts.push(
        '<circle cx="39" cy="45" r="5.5" fill="#fff" stroke="#111" stroke-width="2"/>',
        '<circle cx="39" cy="45" r="2.5" fill="#111"/>',
        '<circle cx="61" cy="45" r="5.5" fill="#fff" stroke="#111" stroke-width="2"/>',
        '<circle cx="61" cy="45" r="2.5" fill="#111"/>'
      );
    } else if (expr === 'thinking') {
      svgParts.push(
        '<path d="M33 39 L45 42" stroke="#111" stroke-width="2.5" stroke-linecap="round"/>',
        '<circle cx="39" cy="46" r="3" fill="#111"/>',
        '<path d="M55 42 Q61 38 67 42" stroke="#111" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
        '<circle cx="61" cy="47" r="2" fill="#111"/>'
      );
    } else {
      // Neutral & Happy standard eyes
      svgParts.push(
        '<circle cx="39" cy="46" r="3.5" fill="#111"/>',
        '<circle cx="40" cy="44.5" r="1.2" fill="#fff"/>',
        '<circle cx="61" cy="46" r="3.5" fill="#111"/>',
        '<circle cx="62" cy="44.5" r="1.2" fill="#fff"/>'
      );
      if (expr === 'happy') {
        svgParts.push(
          '<path d="M34 40 Q39 37 44 40" stroke="#111" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
          '<path d="M56 40 Q61 37 66 40" stroke="#111" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
        );
      }
    }

    // Mouth Layer (changes with expression)
    if (expr === 'laughing') {
      svgParts.push('<path d="M38 60 Q50 78 62 60 Z" fill="#b91c1c" stroke="#111" stroke-width="1.8"/><path d="M42 61 Q50 67 58 61" stroke="#fff" stroke-width="2" fill="none"/>');
    } else if (expr === 'happy') {
      svgParts.push('<path d="M40 60 Q50 70 60 60" stroke="#111" stroke-width="2.8" fill="none" stroke-linecap="round"/>');
    } else if (expr === 'surprised') {
      svgParts.push('<circle cx="50" cy="63" r="5" fill="#111"/>');
    } else if (expr === 'thinking') {
      svgParts.push('<path d="M42 63 Q50 61 58 65" stroke="#111" stroke-width="2.5" fill="none" stroke-linecap="round"/>');
    } else {
      // Neutral smile
      svgParts.push('<path d="M43 62 Q50 66 57 62" stroke="#111" stroke-width="2.2" fill="none" stroke-linecap="round"/>');
    }

    // Glasses Layer
    if (glasses === 'round') {
      svgParts.push(
        '<circle cx="39" cy="46" r="10" fill="none" stroke="#e0e7ff" stroke-width="2.5"/>',
        '<circle cx="61" cy="46" r="10" fill="none" stroke="#e0e7ff" stroke-width="2.5"/>',
        '<line x1="49" y1="46" x2="51" y2="46" stroke="#e0e7ff" stroke-width="2.5"/>'
      );
    } else if (glasses === 'square') {
      svgParts.push(
        '<rect x="29" y="37" width="18" height="17" rx="3" fill="none" stroke="#96d7ff" stroke-width="2.5"/>',
        '<rect x="53" y="37" width="18" height="17" rx="3" fill="none" stroke="#96d7ff" stroke-width="2.5"/>',
        '<line x1="47" y1="45" x2="53" y2="45" stroke="#96d7ff" stroke-width="2.5"/>'
      );
    } else if (glasses === 'sunglasses') {
      svgParts.push(
        '<path d="M28 38 Q50 36 72 38 L69 54 Q50 56 31 54 Z" fill="#111827" stroke="#374151" stroke-width="1.5"/>',
        '<line x1="33" y1="40" x2="43" y2="50" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" stroke-linecap="round"/>'
      );
    }

    // Hair Front Layer
    if (hairStyle === 'short') {
      svgParts.push('<path d="M23 45 Q21 21 50 21 Q79 21 77 45 Q67 30 50 31 Q33 30 23 45 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'curly') {
      svgParts.push('<path d="M21 44 Q19 25 32 23 Q39 17 50 18 Q62 17 68 23 Q81 25 79 44 Q73 34 50 33 Q27 34 21 44 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'bob') {
      svgParts.push('<path d="M21 48 L22 62 Q26 68 30 62 L30 40 Q50 30 70 40 L70 62 Q74 68 78 62 L79 48 Q80 20 50 20 Q20 20 21 48 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'spiky') {
      svgParts.push('<path d="M23 44 L27 28 L35 34 L43 19 L50 30 L58 18 L65 33 L73 27 L77 44 Q65 32 50 32 Q35 32 23 44 Z" fill="' + hairColor + '"/>');
    } else if (hairStyle === 'long') {
      svgParts.push('<path d="M24 45 Q25 21 50 21 Q75 21 76 45 Q67 33 50 33 Q33 33 24 45 Z" fill="' + hairColor + '"/>');
    }

    // Accessories Layer
    if (accessory === 'headphones') {
      svgParts.push(
        '<path d="M17 54 A34 34 0 0 1 83 54" fill="none" stroke="#96d7ff" stroke-width="4.5" stroke-linecap="round"/>',
        '<rect x="13" y="44" width="8" height="18" rx="4" fill="#3b82f6" stroke="#96d7ff" stroke-width="1.5"/>',
        '<rect x="79" y="44" width="8" height="18" rx="4" fill="#3b82f6" stroke="#96d7ff" stroke-width="1.5"/>'
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
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem('sticky_avatar_config', JSON.stringify(cfg));
    } catch (e) {}
  }

  function initAvatar(room, options) {
    var opts = options || {};
    var currentConfig = getStoredConfig();

    var modalEl = document.getElementById(opts.modalId || 'avatar-modal');
    var openBtn = document.getElementById(opts.openBtnId || 'avatar-btn');
    var closeBtn = document.getElementById(opts.closeBtnId || 'avatar-modal-close');
    var saveBtn = document.getElementById(opts.saveBtnId || 'avatar-save-btn');
    var randomBtn = document.getElementById(opts.randomBtnId || 'avatar-random-btn');
    var previewWrap = document.getElementById(opts.previewWrapId || 'avatar-preview-wrap');
    var quickExprWrap = document.getElementById(opts.quickExprWrapId || 'quick-expressions-bar');
    var miniPreview = document.getElementById(opts.miniPreviewId || 'my-avatar-preview');

    function updatePreview() {
      var svg = generateAvatarSvg(currentConfig);
      if (previewWrap) {
        previewWrap.innerHTML = svg;
      }
      if (miniPreview) {
        miniPreview.innerHTML = svg;
      }
      var topbarBadge = document.getElementById('user-avatar-badge');
      if (topbarBadge) {
        topbarBadge.innerHTML = svg;
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
      // Re-broadcast updated avatar with expression if desired
      var svg = generateAvatarSvg(currentConfig);
      if (room && room.setAvatar) {
        room.setAvatar(svg);
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

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveConfig(currentConfig);
        var svg = generateAvatarSvg(currentConfig);
        if (room && room.setAvatar) {
          room.setAvatar(svg);
        }
        updatePreview();
        closeModal();
      });
    }

    // Initialize initial avatar on connect
    var initialSvg = generateAvatarSvg(currentConfig);
    updatePreview();
    setupQuickExpressions();

    if (room) {
      // Sync avatar when room connects
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
