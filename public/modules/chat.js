/*!
 * Live Chat Module for NexusMeet
 * Features:
 * - Collapsible glass side-drawer
 * - Unread message counter badge
 * - Safe textContent rendering (no raw HTML injection)
 * - Auto-scroll with smart scroll position preservation
 * - Delete own messages
 * - Typing indicator with debouncing
 * - Mobile-friendly responsive drawer
 */
(function (global) {
  'use strict';

  function formatTime(ts) {
    var d = new Date(ts || Date.now());
    var hours = d.getHours();
    var minutes = d.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    var mins = minutes < 10 ? '0' + minutes : minutes;
    return hours + ':' + mins + ' ' + ampm;
  }

  function initChat(room, options) {
    var opts = options || {};
    var drawerEl = document.getElementById(opts.drawerId || 'chat-drawer');
    var toggleBtn = document.getElementById(opts.toggleBtnId || 'chat-toggle-btn');
    var unreadBadge = document.getElementById(opts.unreadBadgeId || 'chat-unread-badge');
    var messagesList = document.getElementById(opts.messagesListId || 'chat-messages');
    var inputEl = document.getElementById(opts.inputId || 'chat-input');
    var sendBtn = document.getElementById(opts.sendBtnId || 'chat-send-btn');
    var closeBtn = document.getElementById(opts.closeBtnId || 'chat-close-btn');
    var typingEl = document.getElementById(opts.typingIndicatorId || 'chat-typing-indicator');

    if (!drawerEl || !messagesList || !inputEl) {
      console.warn('Live Chat: required DOM elements not found.');
      return null;
    }

    var isOpen = false;
    var unreadCount = 0;
    var typingUsers = new Map(); // id -> timer
    var typingTimeout = null;
    var isTyping = false;
    var closeTimeout = null;

    function openDrawer() {
      if (closeTimeout) {
        clearTimeout(closeTimeout);
        closeTimeout = null;
      }
      isOpen = true;
      drawerEl.removeAttribute('hidden');
      drawerEl.hidden = false;
      void drawerEl.offsetWidth;
      drawerEl.classList.add('open');
      unreadCount = 0;
      updateBadge();
      if (inputEl) inputEl.focus();
      scrollToBottom();
    }

    function closeDrawer() {
      isOpen = false;
      drawerEl.classList.remove('open');
      if (closeTimeout) clearTimeout(closeTimeout);
      closeTimeout = setTimeout(function () {
        if (!isOpen) {
          drawerEl.setAttribute('hidden', '');
          drawerEl.hidden = true;
        }
      }, 250);
      if (isTyping) {
        isTyping = false;
        if (room && room.sendTyping) room.sendTyping(false);
      }
    }

    function toggleDrawer() {
      if (isOpen) closeDrawer();
      else openDrawer();
    }

    function updateBadge() {
      if (!unreadBadge) return;
      if (unreadCount > 0) {
        unreadBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        unreadBadge.style.display = 'inline-flex';
      } else {
        unreadBadge.style.display = 'none';
        unreadBadge.textContent = '0';
      }
    }

    function isScrolledToBottom() {
      if (!messagesList) return true;
      var threshold = 80;
      return messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight <= threshold;
    }

    function scrollToBottom() {
      if (!messagesList) return;
      messagesList.scrollTop = messagesList.scrollHeight;
    }

    function renderMessage(msg) {
      var isMine = (room && room.me && (msg.clientId === room.me.id || (room.me.user && msg.userId === room.me.user.id)));

      var item = document.createElement('div');
      item.className = 'chat-msg' + (isMine ? ' chat-msg-mine' : '');
      item.id = 'chat-msg-' + msg.id;

      // Avatar element
      var avatarWrap = document.createElement('div');
      avatarWrap.className = 'chat-msg-avatar';
      if (msg.avatar && msg.avatar.indexOf('<svg') !== -1) {
        avatarWrap.innerHTML = msg.avatar;
        var svgEl = avatarWrap.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('width', '24');
          svgEl.setAttribute('height', '24');
          svgEl.style.display = 'block';
        }
      } else {
        avatarWrap.textContent = (msg.name || 'G').charAt(0).toUpperCase();
        if (msg.color) avatarWrap.style.borderColor = msg.color;
      }

      // Bubble wrap
      var contentWrap = document.createElement('div');
      contentWrap.className = 'chat-msg-content';

      // Header: Name + Time + Delete button
      var headerWrap = document.createElement('div');
      headerWrap.className = 'chat-msg-header';

      var nameEl = document.createElement('span');
      nameEl.className = 'chat-msg-name';
      nameEl.textContent = msg.name || 'Anonymous';
      if (msg.color) nameEl.style.color = msg.color;

      var timeEl = document.createElement('span');
      timeEl.className = 'chat-msg-time';
      timeEl.textContent = formatTime(msg.ts);

      headerWrap.appendChild(nameEl);
      headerWrap.appendChild(timeEl);

      if (isMine) {
        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'chat-msg-delete-btn';
        deleteBtn.type = 'button';
        deleteBtn.title = 'Delete message';
        deleteBtn.setAttribute('aria-label', 'Delete message');
        deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        deleteBtn.addEventListener('click', function () {
          if (confirm('Delete this message?')) {
            if (room && room.deleteChat) room.deleteChat(msg.id);
            item.remove();
          }
        });
        headerWrap.appendChild(deleteBtn);
      }

      // Body (safe textContent - NO innerHTML)
      var bodyEl = document.createElement('div');
      bodyEl.className = 'chat-msg-body';
      bodyEl.textContent = msg.body;

      contentWrap.appendChild(headerWrap);
      contentWrap.appendChild(bodyEl);

      item.appendChild(avatarWrap);
      item.appendChild(contentWrap);

      return item;
    }

    var messageMap = new Map();
    var storageKey = 'nexus_chat_' + (room ? (room.id || 'default') : 'default');

    function saveChatToStorage() {
      try {
        var msgs = Array.from(messageMap.values()).slice(-100);
        sessionStorage.setItem(storageKey, JSON.stringify(msgs));
      } catch (e) {}
    }

    function loadChatFromStorage() {
      try {
        var raw = sessionStorage.getItem(storageKey);
        if (raw) {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            loadHistory(arr);
          }
        }
      } catch (e) {}
    }

    function rebuildMessagesList() {
      if (!messagesList) return;
      messagesList.innerHTML = '';
      var sorted = Array.from(messageMap.values()).sort(function (a, b) {
        return (a.ts || 0) - (b.ts || 0);
      });
      sorted.forEach(function (m) {
        var item = renderMessage(m);
        messagesList.appendChild(item);
      });
      saveChatToStorage();
      scrollToBottom();
    }

    function appendMessage(msg) {
      if (!messagesList || !msg) return;
      if (msg.id && messageMap.has(msg.id)) return; // Prevent duplicate
      if (msg.id) messageMap.set(msg.id, msg);
      saveChatToStorage();

      var wasAtBottom = isScrolledToBottom();
      var isMine = (room && room.me && (msg.clientId === room.me.id || (room.me.user && msg.userId === room.me.user.id)));

      var item = renderMessage(msg);
      messagesList.appendChild(item);

      if (isMine || wasAtBottom) {
        scrollToBottom();
      }

      if (!isOpen && !isMine) {
        unreadCount++;
        updateBadge();
      }
    }

    function loadHistory(messages) {
      if (!messagesList || !Array.isArray(messages) || messages.length === 0) return;
      var added = false;
      messages.forEach(function (m) {
        if (m && m.id && !messageMap.has(m.id)) {
          messageMap.set(m.id, m);
          added = true;
        }
      });
      if (added || messagesList.children.length === 0) {
        rebuildMessagesList();
      }
    }

    function removeMessage(id) {
      if (!id) return;
      messageMap.delete(id);
      saveChatToStorage();
      var el = document.getElementById('chat-msg-' + id);
      if (el) {
        el.style.opacity = '0';
        el.style.transform = 'scale(0.9)';
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 200);
      }
    }

    function updateTypingDisplay() {
      if (!typingEl) return;
      var names = Array.from(typingUsers.values());
      if (names.length === 0) {
        typingEl.textContent = '';
        typingEl.style.display = 'none';
      } else {
        typingEl.style.display = 'flex';
        var text = names.length === 1 ? names[0] + ' is typing...' : (names.length === 2 ? names.join(' and ') + ' are typing...' : names[0] + ' and ' + (names.length - 1) + ' others are typing...');
        typingEl.textContent = text;
      }
    }

    function handleTypingEvent(data) {
      if (!data || !data.id) return;
      if (typingUsers.has(data.id)) {
        clearTimeout(typingUsers.get(data.id).timer);
        typingUsers.delete(data.id);
      }
      if (data.on) {
        var timer = setTimeout(function () {
          typingUsers.delete(data.id);
          updateTypingDisplay();
        }, 3500);
        typingUsers.set(data.id, { name: data.name || 'Someone', timer: timer });
      }
      updateTypingDisplay();
    }

    function sendMessage() {
      if (!inputEl) return;
      var text = inputEl.value.trim();
      if (!text) return;
      if (text.length > 2000) {
        alert('Message is too long (max 2000 characters).');
        return;
      }
      if (room && room.sendChat) {
        room.sendChat(text);
      }
      inputEl.value = '';
      if (isTyping) {
        isTyping = false;
        if (room && room.sendTyping) room.sendTyping(false);
      }
      if (typingTimeout) clearTimeout(typingTimeout);
      inputEl.focus();
    }

    // Input event listeners
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    inputEl.addEventListener('input', function () {
      if (!isTyping) {
        isTyping = true;
        if (room && room.sendTyping) room.sendTyping(true);
      }
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(function () {
        isTyping = false;
        if (room && room.sendTyping) room.sendTyping(false);
      }, 2500);
    });

    if (sendBtn) {
      sendBtn.addEventListener('click', sendMessage);
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleDrawer);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closeDrawer);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) {
        closeDrawer();
      }
    });

    // Load cached messages from previous session if any
    loadChatFromStorage();

    // Wire up room event listeners
    if (room) {
      if (room.onChat) room.onChat(appendMessage);
      if (room.onChatHistory) room.onChatHistory(loadHistory);
      if (room.getChatHistory) {
        var existing = room.getChatHistory();
        if (existing && existing.length > 0) loadHistory(existing);
      }
      if (room.onChatTyping) room.onChatTyping(handleTypingEvent);
      if (room.onChatDelete) room.onChatDelete(function (data) {
        if (data && data.id) removeMessage(data.id);
      });
    }

    return {
      open: openDrawer,
      close: closeDrawer,
      toggle: toggleDrawer,
      appendMessage: appendMessage,
      loadHistory: loadHistory,
    };
  }

  global.ChatModule = { init: initChat };
})(typeof window !== 'undefined' ? window : globalThis);
