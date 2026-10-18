/*!
 * whiteboard.js — Infinite Canvas & Whiteboard Drawing Engine
 * Zero dependencies. Seamlessly integrates with Multiplayer room state.
 */
(function (global) {
  'use strict';

  var COLOR_PRESETS = [
    '#ffffff', // White
    '#96d7ff', // Accent Ice Blue
    '#60a5fa', // Blue
    '#3b82f6', // Indigo
    '#a855f7', // Purple
    '#ec4899', // Pink
    '#f43f5e', // Rose
    '#ef4444', // Red
    '#f97316', // Orange
    '#eab308', // Amber / Yellow
    '#84cc16', // Lime
    '#10b981', // Emerald / Green
    '#06b6d4', // Cyan
    '#94a3b8', // Slate
    '#475569', // Dark Slate
    '#0f172a', // Deep Dark
  ];

  var MIN_ZOOM = 0.10; // 10%
  var MAX_ZOOM = 5.00; // 500%
  var LIVE_THROTTLE_MS = 33; // ~30 fps live drawing stream

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function randomId(prefix) {
    var p = prefix || 'obj';
    var bytes = new Uint8Array(6);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = '';
    for (var j = 0; j < bytes.length; j++) {
      var h = bytes[j].toString(16);
      hex += h.length < 2 ? '0' + h : h;
    }
    return p + '_' + Date.now().toString(36) + '_' + hex;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    var l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    var t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  function Whiteboard(options) {
    var opts = options || {};
    this.room = opts.room || null;
    this.boardWrap = opts.boardWrap || document.getElementById('board-wrap');
    this.board = opts.board || document.getElementById('board');
    this.onAddNote = opts.onAddNote || null;
    this.onBoardCleared = opts.onBoardCleared || null;
    this.onClose = opts.onClose || null;
    this.onToast = opts.onToast || function () {};

    // Camera State
    this.camera = {
      x: 0,
      y: 0,
      zoom: 1.0,
    };

    // Tools & Styling State
    this.tool = 'select'; // 'select' | 'hand' | 'pencil' | 'highlighter' | 'rect' | 'circle' | 'arrow' | 'line' | 'eraser' | 'note'
    this.shapeType = 'rect'; // sub-tool when in shape mode
    this.color = '#96d7ff';
    this.width = 4;
    this.spacePressed = false;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Drawing State
    this.isDrawing = false;
    this.currentStroke = null;
    this.lastLiveSend = 0;
    this.liveTimer = null;

    // Ephemeral remote drawing strokes: id -> strokeData
    this.remoteLiveStrokes = new Map();
    this.remoteTimeouts = new Map();

    // Local Undo / Redo Stacks
    this.undoStack = [];
    this.redoStack = [];

    // DOM & Canvas Setup
    this.initCanvas();
    this.initUI();
    this.bindEvents();
    this.bindRoomEvents();
    this.updateCamera();
  }

  Whiteboard.prototype.initCanvas = function () {
    var canvas = document.createElement('canvas');
    canvas.id = 'whiteboard-canvas';
    canvas.className = 'whiteboard-canvas';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none'; // Controlled via tool state
    canvas.style.zIndex = '3';

    // Insert canvas inside boardWrap, before board notes container
    if (this.boardWrap.firstChild) {
      this.boardWrap.insertBefore(canvas, this.boardWrap.firstChild);
    } else {
      this.boardWrap.appendChild(canvas);
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resizeCanvas();
  };

  Whiteboard.prototype.resizeCanvas = function () {
    var dpr = global.devicePixelRatio || 1;
    var w = this.boardWrap.clientWidth || global.innerWidth;
    var h = this.boardWrap.clientHeight || global.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.render();
  };

  Whiteboard.prototype.initUI = function () {
    // Left Toolbar Floating Glass Card
    var toolbar = document.createElement('aside');
    toolbar.id = 'whiteboard-toolbar';
    toolbar.className = 'wb-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Whiteboard Drawing Tools');

    toolbar.innerHTML = [
      '<div class="wb-tools-group">',
      '  <button class="wb-tool-btn is-active" data-tool="select" title="Select (V)" aria-label="Select tool">',
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7 18 3-7 7-3L3 3z"/></svg>',
      '    <span class="wb-shortcut-key">V</span>',
      '  </button>',
      '  <button class="wb-tool-btn" data-tool="hand" title="Hand / Pan (H or Space+drag)" aria-label="Hand tool">',
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>',
      '    <span class="wb-shortcut-key">H</span>',
      '  </button>',
      '  <button class="wb-tool-btn" data-tool="pencil" title="Pencil / Pen (P)" aria-label="Pencil tool">',
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
      '    <span class="wb-shortcut-key">P</span>',
      '  </button>',
      '  <button class="wb-tool-btn" data-tool="highlighter" title="Highlighter (L)" aria-label="Highlighter tool">',
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h3l6-6"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
      '    <span class="wb-shortcut-key">L</span>',
      '  </button>',
      '  <div class="wb-shape-tool-wrap">',
      '    <button class="wb-tool-btn" data-tool="shape" title="Shapes (Rectangle, Circle, Arrow, Line)" aria-label="Shapes tool">',
      '      <svg id="wb-shape-active-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
      '      <span class="wb-arrow-indicator">▾</span>',
      '    </button>',
      '    <div id="wb-shape-menu" class="wb-flyout-menu" hidden>',
      '      <button class="wb-flyout-item is-selected" data-shape="rect" title="Rectangle (R)">',
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
      '        <span>Rectangle (R)</span>',
      '      </button>',
      '      <button class="wb-flyout-item" data-shape="circle" title="Circle / Ellipse (O)">',
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/></svg>',
      '        <span>Circle (O)</span>',
      '      </button>',
      '      <button class="wb-flyout-item" data-shape="arrow" title="Arrow (A)">',
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
      '        <span>Arrow (A)</span>',
      '      </button>',
      '      <button class="wb-flyout-item" data-shape="line" title="Line (I)">',
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="4" y1="20" x2="20" y2="4"/></svg>',
      '        <span>Line (I)</span>',
      '      </button>',
      '    </div>',
      '  </div>',
      '  <button class="wb-tool-btn" data-tool="eraser" title="Eraser (E)" aria-label="Eraser tool">',
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
      '    <span class="wb-shortcut-key">E</span>',
      '  </button>',
      '  <button class="wb-tool-btn" data-tool="note" title="Sticky Note (N)" aria-label="Sticky Note tool">',
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/><path d="M15 3v6h6"/></svg>',
      '    <span class="wb-shortcut-key">N</span>',
      '  </button>',
      '</div>',
      '<div class="wb-tools-divider"></div>',
      '<div class="wb-tools-group">',
      '  <button id="wb-undo-btn" class="wb-tool-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>',
      '    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
      '  </button>',
      '  <button id="wb-redo-btn" class="wb-tool-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled>',
      '    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
      '  </button>',
      '  <button id="wb-clear-btn" class="wb-tool-btn wb-btn-danger" title="Clear Board Drawings" aria-label="Clear Board Drawings">',
      '    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
      '  </button>',
      '  <button id="wb-close-btn" class="wb-tool-btn" title="Close Drawing Tools (Esc)" aria-label="Close Drawing Tools">',
      '    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      '  </button>',
      '</div>',
    ].join('\n');

    document.body.appendChild(toolbar);
    this.toolbar = toolbar;

    // Properties Floating Glass Panel (Color & Width)
    var propsPanel = document.createElement('div');
    propsPanel.id = 'whiteboard-props-panel';
    propsPanel.className = 'wb-props-panel';
    propsPanel.setAttribute('aria-label', 'Stroke styling options');

    var colorSwatchesHtml = COLOR_PRESETS.map(function (c) {
      return '<button class="wb-color-swatch' + (c === '#96d7ff' ? ' is-active' : '') + '" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
    }).join('');

    propsPanel.innerHTML = [
      '<div class="wb-props-section">',
      '  <span class="wb-props-label">Color</span>',
      '  <div class="wb-swatches-grid">',
      colorSwatchesHtml,
      '  </div>',
      '  <div class="wb-custom-color-row">',
      '    <label class="wb-color-input-wrap" title="Custom color picker">',
      '      <input type="color" id="wb-color-picker" value="#96d7ff" class="wb-native-color-picker" />',
      '      <span class="wb-color-preview-disc" style="background:#96d7ff;"></span>',
      '    </label>',
      '    <input type="text" id="wb-hex-input" class="wb-hex-input" value="#96D7FF" maxlength="7" spellcheck="false" />',
      '  </div>',
      '</div>',
      '<div class="wb-props-divider"></div>',
      '<div class="wb-props-section">',
      '  <div class="wb-width-header">',
      '    <span class="wb-props-label">Stroke Width</span>',
      '    <span id="wb-width-badge" class="wb-width-badge">4px</span>',
      '  </div>',
      '  <div class="wb-width-slider-wrap">',
      '    <input type="range" id="wb-width-slider" min="2" max="24" step="1" value="4" class="wb-slider" />',
      '  </div>',
      '</div>',
    ].join('\n');

    document.body.appendChild(propsPanel);
    this.propsPanel = propsPanel;

    // Bottom-Right Floating Glass Viewport Navigation & Export Bar
    var navBar = document.createElement('div');
    navBar.id = 'whiteboard-nav-bar';
    navBar.className = 'wb-nav-bar';
    navBar.setAttribute('aria-label', 'Zoom and Export Controls');

    navBar.innerHTML = [
      '<button id="wb-zoom-out" class="wb-nav-btn" title="Zoom Out (Ctrl + Minus)" aria-label="Zoom Out">',
      '  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      '</button>',
      '<button id="wb-zoom-badge" class="wb-zoom-badge" title="Click to Reset Zoom to 100%">',
      '  <span id="wb-zoom-text">100%</span>',
      '</button>',
      '<button id="wb-zoom-in" class="wb-nav-btn" title="Zoom In (Ctrl + Plus)" aria-label="Zoom In">',
      '  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      '</button>',
      '<div class="wb-nav-divider"></div>',
      '<button id="wb-export-png-btn" class="wb-nav-export-btn" title="Export entire board with drawings and notes as PNG image">',
      '  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      '  <span>Export Board PNG</span>',
      '</button>',
    ].join('\n');

    document.body.appendChild(navBar);
    navBar.style.zIndex = '9998';
    navBar.style.display = 'none';
    this.navBar = navBar;
  };

  Whiteboard.prototype.bindEvents = function () {
    var self = this;

    // Window resize
    global.addEventListener('resize', function () {
      self.resizeCanvas();
    });

    // Toolbar tool selection
    this.toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tool]');
      if (!btn) return;
      var toolName = btn.dataset.tool;
      if (toolName === 'shape') {
        var menu = document.getElementById('wb-shape-menu');
        menu.hidden = !menu.hidden;
        self.setTool('shape');
      } else {
        document.getElementById('wb-shape-menu').hidden = true;
        self.setTool(toolName);
      }
    });

    // Shape submenu selection
    var shapeMenu = document.getElementById('wb-shape-menu');
    shapeMenu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-shape]');
      if (!item) return;
      var shape = item.dataset.shape;
      self.shapeType = shape;
      shapeMenu.querySelectorAll('.wb-flyout-item').forEach(function (el) {
        el.classList.toggle('is-selected', el.dataset.shape === shape);
      });
      // Update active icon on toolbar shape button
      var iconWrap = document.getElementById('wb-shape-active-icon');
      if (iconWrap) {
        if (shape === 'rect') iconWrap.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/>';
        else if (shape === 'circle') iconWrap.innerHTML = '<circle cx="12" cy="12" r="9"/>';
        else if (shape === 'arrow') iconWrap.innerHTML = '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>';
        else if (shape === 'line') iconWrap.innerHTML = '<line x1="4" y1="20" x2="20" y2="4"/>';
      }
      shapeMenu.hidden = true;
      self.setTool('shape');
    });

    // Color Swatches
    this.propsPanel.addEventListener('click', function (e) {
      var swatch = e.target.closest('[data-color]');
      if (!swatch) return;
      self.setColor(swatch.dataset.color);
    });

    // Native Color Picker & Hex Input
    var nativePicker = document.getElementById('wb-color-picker');
    var hexInput = document.getElementById('wb-hex-input');
    nativePicker.addEventListener('input', function (e) {
      self.setColor(e.target.value);
    });
    hexInput.addEventListener('change', function (e) {
      var val = e.target.value.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(val)) {
        if (val.charAt(0) !== '#') val = '#' + val;
        self.setColor(val);
      } else {
        hexInput.value = self.color.toUpperCase();
      }
    });

    // Stroke width slider
    var widthSlider = document.getElementById('wb-width-slider');
    var widthBadge = document.getElementById('wb-width-badge');
    widthSlider.addEventListener('input', function (e) {
      var w = Number(e.target.value);
      self.width = w;
      widthBadge.textContent = w + 'px';
    });

    // Undo / Redo buttons
    document.getElementById('wb-undo-btn').addEventListener('click', function () {
      self.undo();
    });
    document.getElementById('wb-redo-btn').addEventListener('click', function () {
      self.redo();
    });

    // Clear Board button
    document.getElementById('wb-clear-btn').addEventListener('click', function () {
      self.confirmClearBoard();
    });

    // Close Drawing Tools button
    var wbCloseBtn = document.getElementById('wb-close-btn');
    if (wbCloseBtn) {
      wbCloseBtn.addEventListener('click', function () {
        self.hideUI();
        self.setTool('select');
        if (typeof self.onClose === 'function') {
          self.onClose();
        }
        if (typeof self.onBoardCleared === 'function') {
          self.onBoardCleared();
        }
        self.onToast('Drawing tools closed · Note creation palette active');
      });
    }

    // Zoom buttons
    document.getElementById('wb-zoom-in').addEventListener('click', function () {
      self.zoomStep(1.25);
    });
    document.getElementById('wb-zoom-out').addEventListener('click', function () {
      self.zoomStep(1 / 1.25);
    });
    document.getElementById('wb-zoom-badge').addEventListener('click', function () {
      self.resetZoom();
    });

    // Export PNG button
    document.getElementById('wb-export-png-btn').addEventListener('click', function () {
      self.exportBoardPNG();
    });

    // Keyboard Shortcuts
    global.addEventListener('keydown', function (e) {
      var activeEl = document.activeElement;
      var inInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

      if (e.code === 'Space' && !inInput && !self.spacePressed) {
        self.spacePressed = true;
        self.updateCursor();
        e.preventDefault();
        return;
      }

      if (inInput) return;

      if (e.key === 'Escape') {
        if (self.toolbar && self.toolbar.classList.contains('is-visible')) {
          self.hideUI();
          self.setTool('select');
          if (typeof self.onClose === 'function') self.onClose();
          if (typeof self.onBoardCleared === 'function') self.onBoardCleared();
          self.onToast('Drawing tools closed · Note creation palette active');
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Del') {
        if (self.toolbar && self.toolbar.classList.contains('is-visible')) {
          self.confirmClearBoard();
          e.preventDefault();
          return;
        }
      }

      var isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) self.redo();
        else self.undo();
        return;
      }
      if (isCtrl && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        self.redo();
        return;
      }
      if (isCtrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        self.zoomStep(1.25);
        return;
      }
      if (isCtrl && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        self.zoomStep(1 / 1.25);
        return;
      }
      if (isCtrl && e.key === '0') {
        e.preventDefault();
        self.resetZoom();
        return;
      }

      var key = e.key.toUpperCase();
      if (key === 'V') self.setTool('select');
      else if (key === 'H') self.setTool('hand');
      else if (key === 'P') self.setTool('pencil');
      else if (key === 'L' && !e.shiftKey) self.setTool('highlighter');
      else if (key === 'E') self.setTool('eraser');
      else if (key === 'N') self.setTool('note');
      else if (key === 'R') { self.shapeType = 'rect'; self.setTool('shape'); }
      else if (key === 'O') { self.shapeType = 'circle'; self.setTool('shape'); }
      else if (key === 'A') { self.shapeType = 'arrow'; self.setTool('shape'); }
      else if (key === 'I' || (key === 'L' && e.shiftKey)) { self.shapeType = 'line'; self.setTool('shape'); }
    });

    global.addEventListener('keyup', function (e) {
      if (e.code === 'Space') {
        self.spacePressed = false;
        self.updateCursor();
      }
    });

    // Infinite Canvas Pan & Zoom Mouse / Pointer events
    this.bindCanvasInteractions();
  };

  Whiteboard.prototype.bindCanvasInteractions = function () {
    var self = this;
    var wrap = this.boardWrap;

    // Trackpad 2-finger pan & Ctrl+wheel zoom
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom centered around mouse pointer
        var factor = Math.exp(-e.deltaY * 0.0035);
        self.zoomAt(e.clientX, e.clientY, factor);
      } else {
        // Trackpad 2-finger pan or regular scroll wheel pan
        self.camera.x -= e.deltaX;
        self.camera.y -= e.deltaY;
        self.updateCamera();
      }
    }, { passive: false });

    // Pointerdown on boardWrap
    wrap.addEventListener('pointerdown', function (e) {
      var isMiddle = e.button === 1;
      var isPan = isMiddle || self.spacePressed || self.tool === 'hand';

      // If clicking inside a sticky note while in select tool, let note handle it
      var noteEl = e.target.closest('.note');
      if (noteEl && self.tool === 'select' && !isMiddle && !self.spacePressed) {
        return;
      }

      if (isPan) {
        self.isPanning = true;
        self.panStart = { x: e.clientX - self.camera.x, y: e.clientY - self.camera.y };
        wrap.setPointerCapture(e.pointerId);
        self.updateCursor();
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return; // Only primary button for drawing tools

      var world = self.screenToWorld(e.clientX, e.clientY);

      // Note placement tool
      if (self.tool === 'note') {
        if (typeof self.onAddNote === 'function') {
          self.onAddNote(world.x - 100, world.y - 20);
        }
        self.setTool('select');
        e.preventDefault();
        return;
      }

      // Eraser tool
      if (self.tool === 'eraser') {
        self.isDrawing = true;
        wrap.setPointerCapture(e.pointerId);
        self.eraseAt(world.x, world.y);
        e.preventDefault();
        return;
      }

      // Drawing Tools (Pencil, Highlighter, Shape)
      if (self.tool === 'pencil' || self.tool === 'highlighter' || self.tool === 'shape') {
        self.isDrawing = true;
        wrap.setPointerCapture(e.pointerId);

        var toolType = self.tool === 'shape' ? self.shapeType : self.tool;
        var strokeId = randomId('s');

        self.currentStroke = {
          id: strokeId,
          tool: toolType,
          color: self.color,
          width: self.width,
          points: [world.x, world.y],
          author: self.room && self.room.me ? self.room.me.name : 'User',
          authorId: self.room && self.room.me ? self.room.me.id : null,
          createdAt: Date.now(),
        };

        // Broadcast initial ephemeral live stroke
        self.sendLiveStroke(false);
        self.render();
        e.preventDefault();
      }
    });

    // Pointermove on boardWrap
    wrap.addEventListener('pointermove', function (e) {
      if (self.isPanning) {
        self.camera.x = e.clientX - self.panStart.x;
        self.camera.y = e.clientY - self.panStart.y;
        self.updateCamera();
        return;
      }

      if (!self.isDrawing) return;

      var world = self.screenToWorld(e.clientX, e.clientY);

      if (self.tool === 'eraser') {
        self.eraseAt(world.x, world.y);
        return;
      }

      if (self.currentStroke) {
        var pts = self.currentStroke.points;
        if (self.tool === 'shape') {
          // Shapes have [x1, y1, x2, y2]
          pts[2] = world.x;
          pts[3] = world.y;
        } else {
          // Freehand paths append points
          pts.push(world.x, world.y);
        }

        self.sendLiveStroke(false);
        self.render();
      }
    });

    // Pointerup on boardWrap
    function endPointer(e) {
      if (self.isPanning) {
        self.isPanning = false;
        self.updateCursor();
        return;
      }

      if (!self.isDrawing) return;
      self.isDrawing = false;

      if (self.currentStroke) {
        var stroke = self.currentStroke;
        self.currentStroke = null;

        // Broadcast final ephemeral stream done
        self.sendLiveStroke(true, stroke.id);

        // Commit stroke/shape to room state as obj:<id>
        if (self.room && stroke.points && stroke.points.length >= 2) {
          self.room.setState('obj:' + stroke.id, stroke);
          self.pushUndo({
            type: 'create',
            id: 'obj:' + stroke.id,
            data: stroke,
          });
        }
        self.render();
      }
    }

    wrap.addEventListener('pointerup', endPointer);
    wrap.addEventListener('pointercancel', endPointer);
  };

  Whiteboard.prototype.bindRoomEvents = function () {
    var self = this;
    if (!this.room) return;

    // Listen for live ephemeral strokes from other users
    this.room.onDrawLive(function (msg) {
      if (!msg || !msg.id) return;
      if (msg.done) {
        var existing = self.remoteLiveStrokes.get(msg.id);
        if (existing) {
          if (msg.points) existing.points = msg.points;
          existing.done = true;
        } else {
          self.remoteLiveStrokes.set(msg.id, msg);
        }
        if (self.remoteTimeouts.has(msg.id)) {
          clearTimeout(self.remoteTimeouts.get(msg.id));
        }
        var doneTimer = setTimeout(function () {
          self.remoteLiveStrokes.delete(msg.id);
          self.remoteTimeouts.delete(msg.id);
          self.render();
        }, 3000);
        self.remoteTimeouts.set(msg.id, doneTimer);
      } else {
        self.remoteLiveStrokes.set(msg.id, msg);
        if (self.remoteTimeouts.has(msg.id)) {
          clearTimeout(self.remoteTimeouts.get(msg.id));
        }
        var timer = setTimeout(function () {
          self.remoteLiveStrokes.delete(msg.id);
          self.remoteTimeouts.delete(msg.id);
          self.render();
        }, 12000);
        self.remoteTimeouts.set(msg.id, timer);
      }
      self.render();
    });

    // Listen for authoritative state changes
    this.room.onStateChange(function (state, info) {
      if (info && info.keys) {
        var hasObj = false;
        for (var i = 0; i < info.keys.length; i++) {
          var k = info.keys[i];
          if (k.indexOf('obj:') === 0) {
            hasObj = true;
            var strokeId = k.slice(4);
            self.remoteLiveStrokes.delete(strokeId);
            if (self.remoteTimeouts.has(strokeId)) {
              clearTimeout(self.remoteTimeouts.get(strokeId));
              self.remoteTimeouts.delete(strokeId);
            }
          }
        }
        if (hasObj) self.render();
      } else {
        self.render();
      }
    });
  };

  Whiteboard.prototype.sendLiveStroke = function (done, strokeId) {
    if (!this.room) return;
    var self = this;
    var now = Date.now();
    var wait = LIVE_THROTTLE_MS - (now - this.lastLiveSend);

    if (done) {
      if (this.liveTimer) clearTimeout(this.liveTimer);
      this.liveTimer = null;
      this.room.sendDrawLive({ id: strokeId, done: true });
      return;
    }

    if (!this.currentStroke) return;

    if (wait <= 0) {
      if (this.liveTimer) clearTimeout(this.liveTimer);
      this.liveTimer = null;
      this.lastLiveSend = now;
      this.room.sendDrawLive({
        id: this.currentStroke.id,
        tool: this.currentStroke.tool,
        color: this.currentStroke.color,
        width: this.currentStroke.width,
        points: this.currentStroke.points,
      });
    } else if (!this.liveTimer) {
      this.liveTimer = setTimeout(function () {
        self.liveTimer = null;
        if (self.currentStroke) {
          self.lastLiveSend = Date.now();
          self.room.sendDrawLive({
            id: self.currentStroke.id,
            tool: self.currentStroke.tool,
            color: self.currentStroke.color,
            width: self.currentStroke.width,
            points: self.currentStroke.points,
          });
        }
      }, wait);
    }
  };

  Whiteboard.prototype.showUI = function () {
    if (this.toolbar) this.toolbar.classList.add('is-visible');
    var isDrawingTool = this.tool === 'pencil' || this.tool === 'highlighter' || this.tool === 'shape';
    if (this.propsPanel) this.propsPanel.classList.toggle('is-visible', isDrawingTool);
    if (this.navBar) this.navBar.style.display = 'flex';
  };

  Whiteboard.prototype.hideUI = function () {
    if (this.toolbar) this.toolbar.classList.remove('is-visible');
    if (this.propsPanel) this.propsPanel.classList.remove('is-visible');
    var shapeMenu = document.getElementById('wb-shape-menu');
    if (shapeMenu) shapeMenu.hidden = true;
    if (this.navBar) this.navBar.style.display = 'none';
  };

  Whiteboard.prototype.setTool = function (toolName) {
    this.tool = toolName;
    if (this.toolbar) {
      this.toolbar.querySelectorAll('.wb-tool-btn').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.dataset.tool === toolName);
      });
    }

    // Reveal properties panel only if toolbar is visible AND for drawing tools
    var isToolbarVisible = this.toolbar && this.toolbar.classList.contains('is-visible');
    var isDrawingTool = toolName === 'pencil' || toolName === 'highlighter' || toolName === 'shape';
    if (this.propsPanel) {
      this.propsPanel.classList.toggle('is-visible', isToolbarVisible && isDrawingTool);
    }

    this.updateCursor();
  };

  Whiteboard.prototype.setColor = function (hex) {
    this.color = hex;
    this.propsPanel.querySelectorAll('.wb-color-swatch').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.color.toLowerCase() === hex.toLowerCase());
    });
    var nativePicker = document.getElementById('wb-color-picker');
    var hexInput = document.getElementById('wb-hex-input');
    var previewDisc = this.propsPanel.querySelector('.wb-color-preview-disc');
    if (nativePicker) nativePicker.value = hex;
    if (hexInput) hexInput.value = hex.toUpperCase();
    if (previewDisc) previewDisc.style.background = hex;
  };

  Whiteboard.prototype.updateCursor = function () {
    var wrap = this.boardWrap;
    if (this.spacePressed || this.tool === 'hand') {
      wrap.style.cursor = this.isPanning ? 'grabbing' : 'grab';
      this.canvas.style.pointerEvents = 'auto';
    } else if (this.tool === 'select') {
      wrap.style.cursor = 'default';
      this.canvas.style.pointerEvents = 'none';
    } else if (this.tool === 'pencil' || this.tool === 'highlighter' || this.tool === 'shape') {
      wrap.style.cursor = 'crosshair';
      this.canvas.style.pointerEvents = 'auto';
    } else if (this.tool === 'eraser') {
      wrap.style.cursor = 'crosshair';
      this.canvas.style.pointerEvents = 'auto';
    } else if (this.tool === 'note') {
      wrap.style.cursor = 'cell';
      this.canvas.style.pointerEvents = 'auto';
    }
  };

  Whiteboard.prototype.updateCamera = function () {
    var z = this.camera.zoom;
    var x = this.camera.x;
    var y = this.camera.y;

    // Transform the board notes layer
    this.board.style.transformOrigin = '0 0';
    this.board.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + z + ')';
    this.board.style.setProperty('--camera-zoom', z);
    this.board.style.setProperty('--inv-zoom', 1 / z);

    // Update infinite dot grid background
    this.boardWrap.style.backgroundPosition = x + 'px ' + y + 'px';
    this.boardWrap.style.backgroundSize = (32 * z) + 'px ' + (32 * z) + 'px';

    // Update zoom percentage badge
    var zoomText = document.getElementById('wb-zoom-text');
    if (zoomText) {
      zoomText.textContent = Math.round(z * 100) + '%';
    }

    this.render();
  };

  Whiteboard.prototype.zoomAt = function (clientX, clientY, factor) {
    var wrapRect = this.boardWrap.getBoundingClientRect();
    var sx = clientX - wrapRect.left;
    var sy = clientY - wrapRect.top;
    var prevZoom = this.camera.zoom;
    var newZoom = clamp(prevZoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(newZoom - prevZoom) < 0.001) return;

    // Anchor zoom point stationary under mouse
    this.camera.x = sx - ((sx - this.camera.x) / prevZoom) * newZoom;
    this.camera.y = sy - ((sy - this.camera.y) / prevZoom) * newZoom;
    this.camera.zoom = newZoom;
    this.updateCamera();
  };

  Whiteboard.prototype.zoomStep = function (factor) {
    var wrapRect = this.boardWrap.getBoundingClientRect();
    var cx = wrapRect.left + wrapRect.width / 2;
    var cy = wrapRect.top + wrapRect.height / 2;
    this.zoomAt(cx, cy, factor);
  };

  Whiteboard.prototype.resetZoom = function () {
    var wrapRect = this.boardWrap.getBoundingClientRect();
    var cx = wrapRect.left + wrapRect.width / 2;
    var cy = wrapRect.top + wrapRect.height / 2;
    var factor = 1.0 / this.camera.zoom;
    this.zoomAt(cx, cy, factor);
  };

  Whiteboard.prototype.screenToWorld = function (clientX, clientY) {
    var wrapRect = this.boardWrap.getBoundingClientRect();
    var sx = clientX - wrapRect.left;
    var sy = clientY - wrapRect.top;
    return {
      x: (sx - this.camera.x) / this.camera.zoom,
      y: (sy - this.camera.y) / this.camera.zoom,
    };
  };

  Whiteboard.prototype.worldToScreen = function (wx, wy) {
    var wrapRect = this.boardWrap.getBoundingClientRect();
    return {
      x: wrapRect.left + this.camera.x + wx * this.camera.zoom,
      y: wrapRect.top + this.camera.y + wy * this.camera.zoom,
    };
  };

  // Erase drawing objects that intersect world coordinate
  Whiteboard.prototype.eraseAt = function (wx, wy) {
    if (!this.room) return;
    var state = this.room.getState();
    var radius = 14 / this.camera.zoom;
    var toDelete = null;

    var keys = Object.keys(state);
    for (var i = keys.length - 1; i >= 0; i--) {
      var k = keys[i];
      if (k.indexOf('obj:') !== 0) continue;
      var obj = state[k];
      if (!obj || !obj.points || obj.points.length < 2) continue;

      var hit = false;
      var pts = obj.points;

      if (obj.tool === 'rect') {
        var rx1 = pts[0], ry1 = pts[1], rx2 = pts[2] || rx1, ry2 = pts[3] || ry1;
        var minX = Math.min(rx1, rx2) - radius, maxX = Math.max(rx1, rx2) + radius;
        var minY = Math.min(ry1, ry2) - radius, maxY = Math.max(ry1, ry2) + radius;
        if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) hit = true;
      } else if (obj.tool === 'circle') {
        var cx1 = pts[0], cy1 = pts[1], cx2 = pts[2] || cx1, cy2 = pts[3] || cy1;
        var cx = (cx1 + cx2) / 2, cy = (cy1 + cy2) / 2;
        var rx = Math.abs(cx2 - cx1) / 2 + radius, ry = Math.abs(cy2 - cy1) / 2 + radius;
        if (rx > 0 && ry > 0 && Math.hypot((wx - cx) / rx, (wy - cy) / ry) <= 1.2) hit = true;
      } else {
        // Freehand path or line or arrow
        for (var j = 0; j < pts.length - 2; j += 2) {
          if (distToSegment(wx, wy, pts[j], pts[j + 1], pts[j + 2], pts[j + 3]) <= radius + (obj.width || 4) / 2) {
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        toDelete = { id: k, data: obj };
        break;
      }
    }

    if (toDelete) {
      this.room.setState(toDelete.id, null);
      this.pushUndo({
        type: 'delete',
        id: toDelete.id,
        data: toDelete.data,
      });
      this.render();
    }
  };

  Whiteboard.prototype.confirmClearBoard = function () {
    if (!this.room) return;
    var state = this.room.getState();
    var keysToClear = [];
    Object.keys(state).forEach(function (k) {
      if (k.indexOf('obj:') === 0 && state[k]) {  // ONLY drawings, not note: or pos:
        keysToClear.push(k);
      }
    });

    var items = [];
    var patch = {};
    keysToClear.forEach(function (k) {
      items.push({ id: k, data: state[k] });
      patch[k] = null;
    });

    if (keysToClear.length > 0) {
      this.room.setState(patch);
      this.pushUndo({
        type: 'clear',
        items: items,
      });
    }

    // Completely wipe all colors and active/live strokes from screen
    this.currentStroke = null;
    this.remoteLiveStrokes.clear();
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.render();

    // Hide whiteboard drawing tools and return to select mode
    this.hideUI();
    this.setTool('select');

    if (typeof this.onBoardCleared === 'function') {
      this.onBoardCleared();
    }

    this.onToast(keysToClear.length > 0
      ? 'Whiteboard cleared (' + keysToClear.length + ' drawings removed) · Note creation palette active'
      : 'Whiteboard cleared · Note creation palette active');
  };

  // Undo / Redo management
  Whiteboard.prototype.pushUndo = function (action) {
    this.undoStack.push(action);
    this.redoStack.length = 0;
    this.updateUndoRedoUI();
  };

  Whiteboard.prototype.undo = function () {
    if (this.undoStack.length === 0 || !this.room) return;
    var action = this.undoStack.pop();
    if (action.type === 'create') {
      this.room.setState(action.id, null);
      this.redoStack.push(action);
    } else if (action.type === 'delete') {
      this.room.setState(action.id, action.data);
      this.redoStack.push(action);
    } else if (action.type === 'clear') {
      var patch = {};
      action.items.forEach(function (item) {
        patch[item.id] = item.data;
      });
      this.room.setState(patch);
      this.redoStack.push(action);
    }
    this.updateUndoRedoUI();
    this.render();
  };

  Whiteboard.prototype.redo = function () {
    if (this.redoStack.length === 0 || !this.room) return;
    var action = this.redoStack.pop();
    if (action.type === 'create') {
      this.room.setState(action.id, action.data);
      this.undoStack.push(action);
    } else if (action.type === 'delete') {
      this.room.setState(action.id, null);
      this.undoStack.push(action);
    } else if (action.type === 'clear') {
      var patch = {};
      action.items.forEach(function (item) {
        patch[item.id] = null;
      });
      this.room.setState(patch);
      this.undoStack.push(action);
    }
    this.updateUndoRedoUI();
    this.render();
  };

  Whiteboard.prototype.updateUndoRedoUI = function () {
    var undoBtn = document.getElementById('wb-undo-btn');
    var redoBtn = document.getElementById('wb-redo-btn');
    if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  };

  // Canvas Stroke Rendering
  Whiteboard.prototype.render = function () {
    if (!this.ctx) return;
    var ctx = this.ctx;
    var dpr = this.dpr || 1;
    var w = this.canvas.width;
    var h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    // 1. Authoritative objects committed to room state
    if (this.room) {
      var state = this.room.getState();
      var keys = Object.keys(state);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.indexOf('obj:') === 0 && state[k]) {
          this.drawObject(ctx, state[k]);
        }
      }
    }

    // 2. Ephemeral remote live streams from other users
    var self = this;
    this.remoteLiveStrokes.forEach(function (stroke) {
      self.drawObject(ctx, stroke);
    });

    // 3. Current user active drawing stroke
    if (this.currentStroke) {
      this.drawObject(ctx, this.currentStroke);
    }

    ctx.restore();
  };

  Whiteboard.prototype.drawObject = function (ctx, obj) {
    if (!obj || !obj.points || obj.points.length < 2) return;
    var pts = obj.points;
    var tool = obj.tool || 'pencil';
    var color = obj.color || '#96d7ff';
    var width = obj.width || 4;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;

    if (tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = width * 2.8;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (var i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i], pts[i + 1]);
      }
      ctx.stroke();
    } else if (tool === 'pencil') {
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      if (pts.length === 2) {
        ctx.lineTo(pts[0] + 0.5, pts[1] + 0.5);
      } else if (pts.length === 4) {
        ctx.lineTo(pts[2], pts[3]);
      } else {
        // Quadratic curve smoothing
        for (var p = 2; p < pts.length - 2; p += 2) {
          var xc = (pts[p] + pts[p + 2]) / 2;
          var yc = (pts[p + 1] + pts[p + 3]) / 2;
          ctx.quadraticCurveTo(pts[p], pts[p + 1], xc, yc);
        }
        ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
      }
      ctx.stroke();
    } else if (tool === 'rect') {
      var x1 = pts[0], y1 = pts[1];
      var x2 = pts[2] != null ? pts[2] : x1;
      var y2 = pts[3] != null ? pts[3] : y1;
      var rx = Math.min(x1, x2);
      var ry = Math.min(y1, y2);
      var rw = Math.abs(x2 - x1);
      var rh = Math.abs(y2 - y1);
      ctx.strokeRect(rx, ry, rw, rh);
    } else if (tool === 'circle') {
      var cx1 = pts[0], cy1 = pts[1];
      var cx2 = pts[2] != null ? pts[2] : cx1;
      var cy2 = pts[3] != null ? pts[3] : cy1;
      var cx = (cx1 + cx2) / 2;
      var cy = (cy1 + cy2) / 2;
      var radiusX = Math.abs(cx2 - cx1) / 2;
      var radiusY = Math.abs(cy2 - cy1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.1, radiusX), Math.max(0.1, radiusY), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === 'line') {
      var lx1 = pts[0], ly1 = pts[1];
      var lx2 = pts[2] != null ? pts[2] : lx1;
      var ly2 = pts[3] != null ? pts[3] : ly1;
      ctx.beginPath();
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();
    } else if (tool === 'arrow') {
      var ax1 = pts[0], ay1 = pts[1];
      var ax2 = pts[2] != null ? pts[2] : ax1;
      var ay2 = pts[3] != null ? pts[3] : ay1;
      ctx.beginPath();
      ctx.moveTo(ax1, ay1);
      ctx.lineTo(ax2, ay2);
      ctx.stroke();

      // Arrow Head
      var angle = Math.atan2(ay2 - ay1, ax2 - ax1);
      var headLen = Math.max(12, width * 3.2);
      ctx.beginPath();
      ctx.moveTo(ax2, ay2);
      ctx.lineTo(ax2 - headLen * Math.cos(angle - Math.PI / 6), ay2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(ax2, ay2);
      ctx.lineTo(ax2 - headLen * Math.cos(angle + Math.PI / 6), ay2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    ctx.restore();
  };

  // Export to PNG capturing both canvas drawings and sticky notes
  Whiteboard.prototype.exportBoardPNG = function () {
    if (!this.room) return;
    var state = this.room.getState();
    var PADDING = 60;
    var NOTE_W = 200;
    var NOTE_H = 180;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var hasContent = false;

    // Scan drawing objects
    Object.keys(state).forEach(function (k) {
      if (k.indexOf('obj:') === 0 && state[k] && state[k].points) {
        var pts = state[k].points;
        for (var i = 0; i < pts.length; i += 2) {
          var px = pts[i], py = pts[i + 1];
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          hasContent = true;
        }
      }
    });

    // Scan sticky notes
    Object.keys(state).forEach(function (k) {
      if (k.indexOf('pos:') === 0 && state[k]) {
        var pos = state[k];
        if (typeof pos.x === 'number' && typeof pos.y === 'number') {
          if (pos.x < minX) minX = pos.x;
          if (pos.x + NOTE_W > maxX) maxX = pos.x + NOTE_W;
          if (pos.y < minY) minY = pos.y;
          if (pos.y + NOTE_H > maxY) maxY = pos.y + NOTE_H;
          hasContent = true;
        }
      }
    });

    if (!hasContent) {
      minX = 0; minY = 0; maxX = 1200; maxY = 800;
    }

    minX -= PADDING;
    minY -= PADDING;
    maxX += PADDING;
    maxY += PADDING;

    var outW = Math.round(maxX - minX);
    var outH = Math.round(maxY - minY);

    var offscreen = document.createElement('canvas');
    offscreen.width = outW;
    offscreen.height = outH;
    var octx = offscreen.getContext('2d');

    // 1. Dark Board Surface Background (#05071a)
    octx.fillStyle = '#05071a';
    octx.fillRect(0, 0, outW, outH);

    // 2. Subtle Infinite Dot Grid
    octx.fillStyle = 'rgba(150, 215, 255, 0.08)';
    var step = 32;
    var startX = Math.floor(minX / step) * step;
    var startY = Math.floor(minY / step) * step;
    for (var gx = startX; gx < maxX; gx += step) {
      for (var gy = startY; gy < maxY; gy += step) {
        octx.beginPath();
        octx.arc(gx - minX, gy - minY, 1.2, 0, Math.PI * 2);
        octx.fill();
      }
    }

    // 3. Render Canvas Drawing Strokes & Shapes
    octx.save();
    octx.translate(-minX, -minY);

    var self = this;
    Object.keys(state).forEach(function (k) {
      if (k.indexOf('obj:') === 0 && state[k]) {
        self.drawObject(octx, state[k]);
      }
    });

    octx.restore();

    // 4. Render Sticky Notes on top
    var noteColors = {
      yellow: { bg: '#fef08a', text: '#713f12', border: '#eab308' },
      pink: { bg: '#fbcfe8', text: '#831843', border: '#f43f5e' },
      blue: { bg: '#bae6fd', text: '#0c4a6e', border: '#38bdf8' },
      green: { bg: '#bbf7d0', text: '#14532d', border: '#4ade80' },
      purple: { bg: '#e9d5ff', text: '#581c87', border: '#c084fc' },
    };

    Object.keys(state).forEach(function (k) {
      if (k.indexOf('note:') === 0 && state[k]) {
        var noteId = k.slice(5);
        var note = state[k];
        var pos = state['pos:' + noteId] || { x: 40, y: 40 };

        var nx = pos.x - minX;
        var ny = pos.y - minY;
        var scheme = noteColors[note.color] || noteColors.yellow;

        octx.save();
        // Drop shadow
        octx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        octx.shadowBlur = 18;
        octx.shadowOffsetY = 8;

        // Note Card Rounded Rect
        octx.fillStyle = scheme.bg;
        octx.strokeStyle = scheme.border;
        octx.lineWidth = 1.5;
        if (octx.roundRect) {
          octx.beginPath();
          octx.roundRect(nx, ny, NOTE_W, NOTE_H, 12);
          octx.fill();
          octx.stroke();
        } else {
          octx.fillRect(nx, ny, NOTE_W, NOTE_H);
          octx.strokeRect(nx, ny, NOTE_W, NOTE_H);
        }

        octx.shadowColor = 'transparent';

        // Note Author Header
        octx.fillStyle = scheme.text;
        octx.font = '600 11px system-ui, -apple-system, sans-serif';
        var authorText = (note.author || 'Guest').slice(0, 20);
        octx.fillText(authorText, nx + 12, ny + 22);

        // Note Text (Word Wrapped)
        octx.font = '400 13px system-ui, -apple-system, sans-serif';
        var words = (note.text || '').split(/\s+/);
        var line = '';
        var lineY = ny + 46;
        var maxLineWidth = NOTE_W - 24;

        for (var n = 0; n < words.length; n++) {
          var testLine = line + (line ? ' ' : '') + words[n];
          var metrics = octx.measureText(testLine);
          if (metrics.width > maxLineWidth && line) {
            octx.fillText(line, nx + 12, lineY);
            line = words[n];
            lineY += 18;
            if (lineY > ny + NOTE_H - 12) break;
          } else {
            line = testLine;
          }
        }
        if (line && lineY <= ny + NOTE_H - 12) {
          octx.fillText(line, nx + 12, lineY);
        }

        octx.restore();
      }
    });

    // 5. Watermark badge bottom-right
    octx.save();
    octx.fillStyle = 'rgba(150, 215, 255, 0.45)';
    octx.font = '600 11px system-ui, sans-serif';
    var brandText = 'Multiplayer Whiteboard · Room #' + (this.room ? this.room.id : '');
    octx.fillText(brandText, outW - octx.measureText(brandText).width - 16, outH - 16);
    octx.restore();

    // Trigger PNG Download
    try {
      offscreen.toBlob(function (blob) {
        if (!blob) return;
        var a = document.createElement('a');
        var fileName = 'sticky-board-' + (self.room ? self.room.id : 'room') + '-' + Date.now() + '.png';
        a.download = fileName;
        var blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1500);
        self.onToast('Exported board as ' + fileName);
      }, 'image/png');
    } catch (e) {
      self.onToast('Export failed: ' + e.message);
    }
  };

  global.Whiteboard = {
    init: function (options) {
      return new Whiteboard(options);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
