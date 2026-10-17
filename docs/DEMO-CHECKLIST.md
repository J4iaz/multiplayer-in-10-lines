# Demo checklist

Run `npm start` (or use the deployed URL) and open the board.

## Cross-tab
- [ ] Tab 1: open `/`, and the URL gains `#room=xxxxxxxx`. Set a name.
- [ ] **Copy invite link**, then open it in Tab 2 with a different name.
- [ ] Both avatars appear in the header. The status pill says **Live**.
- [ ] Move the mouse in Tab 1: a labelled cursor follows in Tab 2.
- [ ] Double-click to add a note, type, change color, drag, delete. Each change shows up in the other tab within ~100 ms.
- [ ] Close Tab 2: its avatar and cursor disappear from Tab 1.

## Cross-device
- [ ] Open the invite link on a phone (same Wi-Fi via `http://<LAN-IP>:3000/#room=…`, or the deployed URL).
- [ ] Drag a note by its top bar with a finger and watch it move on desktop.

## Reconnect / offline
- [ ] DevTools → Network → **Offline** in Tab 1. The status becomes **Reconnecting…**
- [ ] Add and edit notes in Tab 1: the pill shows **N changes queued**.
- [ ] Meanwhile edit a different note in Tab 2.
- [ ] Go back **Online**: Tab 1 reconnects, gets Tab 2's edits, and Tab 2 receives Tab 1's queued edits.
- [ ] Stop the server (`Ctrl+C`) and restart it. Clients reconnect automatically. In-memory state resets, and clients re-send only edits that were still queued.

## Keyboard / accessibility
- [ ] Tab to a note, use arrow keys to move it (Shift for bigger steps), Enter to edit, Esc to leave the text, Delete to remove.
- [ ] Status changes are announced via `role="status"`.

## Health
- [ ] `GET /health` → `{ "status": "ok", "rooms": n, "clients": n, ... }`