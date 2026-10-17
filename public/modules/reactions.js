/*!
 * Floating Emoji Reactions Module for NexusMeet
 * Features:
 * - Floating emoji reaction bar (Instagram Live style)
 * - Emojis float up from bottom-right with CSS drift and fade out
 * - Max 40 concurrent pooled DOM elements
 * - 1-6 number key shortcuts (disabled when typing in inputs)
 * - Allowlisted reactions: ❤️, 🔥, 👏, 😂, 🎉, 🚀, 😮, 💯, 👍, 💡, 🥳, ✨
 */
(function (global) {
  'use strict';

  var ALLOWED_REACTIONS = ['❤️', '🔥', '👏', '😂', '🎉', '🚀', '😮', '💯', '👍', '💡', '🥳', '✨'];
  var SHORTCUT_KEYS = {
    '1': '❤️',
    '2': '🔥',
    '3': '👏',
    '4': '😂',
    '5': '🎉',
    '6': '🚀',
  };
  var MAX_ACTIVE_ELEMENTS = 40;

  function initReactions(room, options) {
    var opts = options || {};
    var barEl = document.getElementById(opts.barId || 'reactions-bar');
    var containerEl = document.getElementById(opts.containerId || 'reactions-float-container');

    if (!containerEl) {
      containerEl = document.createElement('div');
      containerEl.id = opts.containerId || 'reactions-float-container';
      containerEl.className = 'reactions-float-container';
      containerEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(containerEl);
    }

    var activePool = []; // elements currently floating

    function spawnReaction(emoji, senderName) {
      if (!emoji || !containerEl) return;

      // Limit concurrent elements to 40 max
      if (activePool.length >= MAX_ACTIVE_ELEMENTS) {
        var oldest = activePool.shift();
        if (oldest && oldest.parentNode) {
          oldest.parentNode.removeChild(oldest);
        }
      }

      var el = document.createElement('div');
      el.className = 'floating-reaction';

      // Randomize drift, speed, and slight rotation for realistic Instagram Live physics
      var xStart = (Math.random() * 40 - 20).toFixed(1) + 'px';
      var xMid = (Math.random() * 70 - 35).toFixed(1) + 'px';
      var xEnd = (Math.random() * 90 - 45).toFixed(1) + 'px';
      var duration = (1.9 + Math.random() * 0.7).toFixed(2) + 's';
      var scale = (1.0 + Math.random() * 0.35).toFixed(2);
      var rot = (Math.random() * 30 - 15).toFixed(1) + 'deg';

      el.style.setProperty('--x-start', xStart);
      el.style.setProperty('--x-mid', xMid);
      el.style.setProperty('--x-end', xEnd);
      el.style.setProperty('--scale', scale);
      el.style.setProperty('--rot', rot);
      el.style.animationDuration = duration;

      var emojiSpan = document.createElement('span');
      emojiSpan.className = 'reaction-emoji';
      emojiSpan.textContent = emoji;
      el.appendChild(emojiSpan);

      if (senderName) {
        var nameSpan = document.createElement('span');
        nameSpan.className = 'reaction-name';
        nameSpan.textContent = senderName;
        el.appendChild(nameSpan);
      }

      containerEl.appendChild(el);
      activePool.push(el);

      el.addEventListener('animationend', function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        var idx = activePool.indexOf(el);
        if (idx !== -1) activePool.splice(idx, 1);
      });
    }

    function sendReaction(emoji) {
      if (!emoji) return;
      if (room && room.sendReaction) {
        room.sendReaction(emoji);
      }
    }

    // Build or wire the Reaction Bar
    function setupBar() {
      if (!barEl) return;
      barEl.innerHTML = '';

      var pill = document.createElement('div');
      pill.className = 'reactions-bar-pill';

      // Render the primary 6 emojis with shortcut hints
      var primaryEmojis = ALLOWED_REACTIONS.slice(0, 6);
      primaryEmojis.forEach(function (emoji, idx) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reaction-btn';
        btn.setAttribute('aria-label', 'React ' + emoji + ' (Shortcut ' + (idx + 1) + ')');
        btn.title = 'React ' + emoji + ' (Press ' + (idx + 1) + ')';

        var emojiEl = document.createElement('span');
        emojiEl.className = 'reaction-btn-emoji';
        emojiEl.textContent = emoji;

        var keyBadge = document.createElement('span');
        keyBadge.className = 'reaction-btn-shortcut';
        keyBadge.textContent = String(idx + 1);

        btn.appendChild(emojiEl);
        btn.appendChild(keyBadge);

        btn.addEventListener('click', function () {
          sendReaction(emoji);
        });

        pill.appendChild(btn);
      });

      // Expand button for extra emojis
      var moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'reaction-btn reaction-btn-more';
      moreBtn.setAttribute('aria-label', 'More reactions');
      moreBtn.title = 'More reactions';
      moreBtn.textContent = '+';

      var extraPopup = document.createElement('div');
      extraPopup.className = 'reactions-extra-popup';
      extraPopup.style.display = 'none';

      var extraEmojis = ALLOWED_REACTIONS.slice(6);
      extraEmojis.forEach(function (emoji) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reaction-extra-item';
        btn.textContent = emoji;
        btn.addEventListener('click', function () {
          sendReaction(emoji);
          extraPopup.style.display = 'none';
        });
        extraPopup.appendChild(btn);
      });

      moreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        extraPopup.style.display = extraPopup.style.display === 'none' ? 'flex' : 'none';
      });

      document.addEventListener('click', function (e) {
        if (!extraPopup.contains(e.target) && e.target !== moreBtn) {
          extraPopup.style.display = 'none';
        }
      });

      pill.appendChild(moreBtn);
      pill.appendChild(extraPopup);
      barEl.appendChild(pill);
    }

    setupBar();

    // Keyboard shortcuts (1-6)
    function onKeyDown(e) {
      // Ignore if typing inside any form field, textarea, contenteditable, etc.
      var target = e.target;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      var emoji = SHORTCUT_KEYS[e.key];
      if (emoji) {
        e.preventDefault();
        sendReaction(emoji);
      }
    }

    window.addEventListener('keydown', onKeyDown);

    // Wire up room event listener
    if (room && room.onReaction) {
      room.onReaction(function (data) {
        if (data && data.emoji) {
          spawnReaction(data.emoji, data.name);
        }
      });
    }

    return {
      spawn: spawnReaction,
      send: sendReaction,
      destroy: function () {
        window.removeEventListener('keydown', onKeyDown);
      },
    };
  }

  global.ReactionsModule = { init: initReactions, ALLOWED_REACTIONS: ALLOWED_REACTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
