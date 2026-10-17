# NexusMeet — Realtime Collaboration Platform

> Upgraded from the lightweight "Multiplayer in 10 Lines" engine into a full-featured realtime collaboration platform with voice & video calling, infinite whiteboard, live chat, floating reactions, custom SVG avatars, host controls, and Supabase authentication.

---

## ⚡ Features

- **P2P WebRTC Video & Audio Calling**:
  - Up to 6-peer WebRTC mesh with automatic STUN/TURN ICE negotiation (`GET /api/ice`).
  - Microphone mute/unmute, Camera toggle, and Screen Sharing (`getDisplayMedia`).
  - Web Audio API real-time analyser for active speaker highlight ring.
- **Infinite Canvas & Whiteboard Drawing**:
  - Pan (Space + drag, middle mouse, trackpad) and Zoom (10% to 500%).
  - Drawing tools: Pen, Highlighter, Shapes (Rectangle, Circle, Line, Arrow), Eraser, Clear board.
  - Ephemeral live stroke stream (`draw_live`) throttled to 33ms for smooth co-drawing.
  - State persistence under `obj:<id>`.
  - One-click "Export Board PNG" capturing both notes and canvas drawings.
- **Live Chat & Floating Reactions**:
  - Collapsible glass drawer with unread counter, auto-scroll, and message deletion.
  - Instagram Live-style floating emoji reaction bar with realistic drift physics and number shortcuts (1–6).
- **Custom Layered SVG Avatars**:
  - Under 2KB SVG generator with customizable skin, hair, eyes, mouth, glasses, and accessories.
  - 5 quick expressions: *happy*, *surprised*, *laughing*, *thinking*, *neutral*.
- **Roles, Passwords & Host Controls**:
  - Automatic `owner` assignment for room creator; `editor` and `viewer` roles.
  - Host action tools: Lock Room, Viewer-Only toggle, Password protection with bcrypt and rate limiting (5 attempts / 10 mins), Kick, and Ban (`4403`).
- **Supabase Authentication & JWT**:
  - Server-side JWT token verification via Supabase Admin SDK.
  - Guest mode with fallback when auth is unconfigured or optional.
  - Beautiful dark glass authentication page (`/auth.html`) with password strength indicator.
- **The Core "10 Lines" API**:
  - Raw minimal demo preserved in `/10-lines.html`.
  - Zero external dependencies in browser (`public/multiplayer.js`).
  - Optimistic updates, offline queue with snapshot reconciliation, exponential backoff reconnect.
- **100% Green Integration Test Suite**:
  - 47 passing tests across server, client, auth, roles, whiteboard, chat/reactions, and WebRTC video.

---

## 🚀 Quick start

```bash
npm install
npm start            # Runs at http://localhost:3000
npm test             # Runs all 47 node:test integration suites
npm run lint         # ESLint verification
```

Open `http://localhost:3000` in your browser.

---

## 💻 10-Line Quick Start

```html
<button id="btn">Clicked 0 times</button>
<script src="/multiplayer.js"></script>
<script>
  const room = Multiplayer.join({ name: prompt('Your name?') });
  room.enableCursors();
  room.onStateChange((state) => {
    btn.textContent = `Clicked ${state.clicks || 0} times`;
  });
  btn.onclick = () => room.setState('clicks', (room.getState('clicks') || 0) + 1);
</script>
```

---

## 🔒 Security & Architecture

- **Strict Content Security Policy (CSP)**: `default-src 'self'`. All scripts and vendor bundles are strictly self-hosted.
- **Server Authorization**: Roles, rate limits, and permissions are verified on the server. Viewers cannot mutate state.
- **In-Memory + Database Hybrid**: High-frequency ephemeral traffic stays in-memory (WebSocket), while schemas and tables are ready in `supabase/schema.sql`.

---

## 📜 Test Suite (47/47 passing)

```
✔ Tokenless join succeeds when ALLOW_GUESTS !== "false"
✔ Tokenless join rejected with 4401 auth_required
✔ Invalid token rejected with 4401 auth_expired
✔ Valid mock token receives welcome with role "owner"
✔ Chat message sent and received by other clients
✔ Chat body rate-limiting works
✔ Chat typing indicator relayed to peers
✔ Floating reactions broadcast with allowlisted emojis
✔ Avatar update reflects in presence
✔ Expression update broadcasts and reflects in presence
✔ setState syncs between two clients and fires onStateChange
✔ getState returns immutable copies
✔ presence tracks joins, renames and leaves
✔ rapid writes from two clients converge to the same state
✔ writes made while disconnected are queued and flushed on reconnect
✔ room creator gets owner role, second user gets editor
✔ viewer role cannot mutate state
✔ host action kick disconnects user with code 4403
✔ locked room rejects new joins
✔ password-protected room rejects wrong password
✔ rate-limiting of failed password attempts
✔ GET /api/ice returns STUN/TURN configuration
✔ rtc_join announces peer and sends peers list
✔ rtc_offer, rtc_answer, and rtc_ice relay between peers
✔ media_state and rtc_leave broadcast to other peers
✔ ephemeral draw_live broadcast to other clients
✔ obj:<id> saves and syncs to late joiners
✔ viewers cannot send obj:<id> or draw_live
```