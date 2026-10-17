# Multiplayer in 10 Lines

Drop-in realtime **shared state**, **presence** and **live cursors** for any web page. One `<script>` tag, no build step, no framework, no dependencies in the browser.

The demo is a collaborative sticky-note board (`public/app.js`) built only on the public API.

## Quick start

```bash
npm install
npm start            # http://localhost:3000
npm test             # server + client integration tests (node:test)
```

Open `http://localhost:3000`, click **Copy invite link**, and open it in another tab or device.

## Add multiplayer to any page (10 lines)

```html
<button id="btn">Clicked 0 times</button>
<script src="https://YOUR-HOST/multiplayer.js"></script>
<script>
  const room = Multiplayer.join({ name: prompt('Your name?') });
  room.enableCursors();
  room.onStateChange((state) => {
    btn.textContent = `Clicked ${state.clicks || 0} times`;
  });
  btn.onclick = () => room.setState('clicks', (room.getState('clicks') || 0) + 1);
</script>
```

The room id is stored in the URL hash (`#room=abc123`), so sharing the URL shares the room.

## API

### `Multiplayer.join(options?) → room`

| Option | Default | Description |
| --- | --- | --- |
| `room` | from `#room=` or random | Room id: 1–64 letters, digits, hyphens |
| `name` | saved name or `Guest-xxxx` | Display name (max 50 chars, saved in localStorage) |
| `serverUrl` | derived from the script's origin | e.g. `wss://my-host/ws`. Required if the page is opened via `file://` |
| `updateHash` | `true` | Write the room id into `location.hash` |
| `reconnectBaseMs` / `reconnectMaxMs` | `1000` / `30000` | Exponential backoff with jitter |

### Room

| Member | Description |
| --- | --- |
| `room.setState(key, value)` / `room.setState({ a: 1, b: 2 })` | Optimistic write, synced to everyone. `null` deletes a key. Values must be JSON-serializable, ≤ 10 KB each |
| `room.getState()` / `room.getState(key)` | Returns a **copy** (mutating it does nothing) |
| `room.onStateChange(fn)` | `fn(state, { keys, source })`, source is `local`, `remote` or `snapshot` |
| `room.onPresenceChange(fn)` / `room.getPresence()` | `[{ id, name, color }]` |
| `room.onStatusChange(fn)` / `room.status` | `connecting`, `connected`, `reconnecting`, `disconnected` (+ `pending` count) |
| `room.onError(fn)` | Server rejections (invalid patch, room full…) |
| `room.enableCursors({ container? })` | Live cursors over `container` (default `document.body`). Returns `{ disable() }` |
| `room.setName(name)` | Rename yourself for everyone |
| `room.shareUrl()` | Invite URL for this room |
| `room.getPendingCount()` | Writes queued while offline |
| `room.id`, `room.me` | Room id and `{ id, name, color }` |
| `room.disconnect()` | Leave for good |

Every `on*` method returns an unsubscribe function.

## Sync semantics

- **Flat key/value store, last write wins per key.** The server orders writes. Put independent things under separate keys (the demo uses `note:<id>` for text and `pos:<id>` for position, so dragging and typing never clobber each other).
- **Optimistic updates.** Local writes show up instantly. The client ignores stale remote values for keys it still has in flight, so there's no flicker.
- **Offline queue.** Writes while disconnected are queued (deduplicated per key). On reconnect the client gets a fresh snapshot, re-applies the queue on top, and flushes it.
- **Reconnect.** Exponential backoff 1s → 30s with jitter, immediate retry on the browser `online` event, plus a ping watchdog for silently dead connections.

## Server

`server.js` is Express + [`ws`](https://github.com/websockets/ws): static files from `public/`, `GET /health`, and a WebSocket at `/ws`. Rooms live in memory. An empty room keeps its state for `ROOM_TTL_MINUTES` (default 60).

Protocol (JSON): client → `join`, `set_state`, `cursor_move`, `set_name`, `sync`, `ping`; server → `welcome`, `snapshot`, `state_update`, `presence`, `cursor`, `error`, `pong`.

Limits: room id 64 chars, name 50, key 128 (`[A-Za-z0-9_:.-]`), value 10 KB, 1000 keys/room, 50 clients/room, 256 KB/message, 120 messages/s per socket.

## Deploy (Render)

`render.yaml` is included: create a Blueprint on Render and point it at the repo. Render sets `PORT`, and the health check uses `/health`. Any Node host with WebSocket support works the same way (`npm ci && npm start`).

## Limitations

- **No authentication.** Anyone with a room link can read and write that room. Room ids are random and unguessable, but treat them as shared secrets, not access control.
- State is in memory: it's lost on restart, and the server runs as a single instance (no horizontal scaling).
- Last-write-wins per key, not CRDT/OT: two people typing in the *same* note at once will overwrite each other's text.
- Cursor positions are relative to the container, so they line up only when clients render it at the same size (the demo board is fixed at 2400×1600).

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DEMO-CHECKLIST.md](docs/DEMO-CHECKLIST.md)