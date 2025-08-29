# Synced Swarm Audio — MVP

This repo contains a minimal implementation of the one‑pager:

- **SPA** (static) in `/client` (vanilla JS + ES modules)
- **Minimal server** in `/server` for:
  - WebSocket **control channel** (presence, director state, file announcements, play/stop, signaling relay)
  - **Clock pings** (NTP‑style response, no file metadata)
  - Optional **static hosting** for the SPA

> The server never stores or inspects user audio. Files move peer‑to‑peer via **WebTorrent** (WebRTC) with public WebSocket trackers.

## Quick start

### Option A — Serve SPA from the same node server

```bash
cd server
npm install
node server.js
# open http://localhost:8080
```

### Option B — Host SPA elsewhere (static hosting / CDN)

1. Upload the contents of `/client` to static hosting (Netlify, GitHub Pages w/ CORS, etc.).
2. Run the node server just for WebSocket + time: `node server/server.js` under TLS/HTTPS.
3. Make sure your client page connects to the correct origin (same host by default).

> **TLS:** Browsers require secure context for `getUserMedia` etc. For `wss://`, terminate TLS at a reverse proxy (nginx, Caddy, Cloudflare) and forward to this server.

## Architecture

```
[ Browser SPA ]
  ├─ timing.js      (offset estimator, gentle drift detection/slew)
  ├─ control.js     (WebSocket control + timePing/pong)
  ├─ swarm.js       (WebTorrent P2P: seed/add, magnet announcements)
  ├─ playback.js    (WebAudio scheduler + playbackRate nudges)
  ├─ director.js    (deterministic election: lowest userId; take/resign)
  └─ ui.js          (minimal mobile-first UI)

[ Node server ]
  ├─ ws namespace by swarmHash (no audio)
  ├─ relays control messages (play/stop/selectFile, file:announce, rtc:signal)
  └─ responds to timePing with server time
```

### Control schema (WS)

- `join { swarmHash, userId }` → `joined { peers:[{userId}] }`
- Presence updates: `presence { userId, action: "join"|"leave" }`, `peers { peers:[...] }`
- Time: `timePing { t0 }` → `timePong { t0, tS }` (server time)
- Director: `director:assert|take|resign { userId }`
- Files: `file:announce { fileId, name, size, infoHash, magnet }`
- Selection: `selectFile { fileId }`
- Playback: `play { fileId, globalStartTimeMs }`, `stop {}`

### Timing strategy

- Pre‑roll: pings at **5 Hz**, robust median of low‑RTT samples.
- Lock base offset on `play` schedule; while playing, keep pinging **~2 Hz**.
- Ignore drift `< ~12 ms`. Initiate correction if `> ~30 ms` across samples.
- Corrections: **slew** the base offset slowly (1–2 ms/s) and apply **playbackRate** nudges (±2%) to avoid snaps.

### Director logic

- Lowest `userId` leads (deterministic). Manual **take/resign** possible.
- Heartbeats keep presence fresh; failover via peer list updates.

### Files (P2P)

- In‑browser **WebTorrent** client; **download implies reseed** automatically.
- We share only **magnet URIs** over control WS.
- Trackers: `wss://tracker.openwebtorrent.com`, `wss://tracker.btorrent.xyz`, `wss://tracker.fastcast.nz`.
  - You can host your own ws tracker later. TURN is out‑of‑scope for MVP.
- Each peer may seed up to **3** files (tweak in `swarm.js`).

> Note: This MVP fetches the full file into memory once to produce a Blob URL then decodes it into an AudioBuffer. For large tracks or very low‑RAM devices, consider MediaSource streaming and incremental decode in a future iteration.

## UX essentials implemented

- Swarm key → SHA‑256 → namespace.
- Peer count, director indicator.
- File picker & list (name/size/readiness), limit 3.
- Play/stop & current selection.
- Speaker delay slider (0–500 ms).
- Status/debug log.

## Quality targets (expected on decent networks)

- Startup to first sync: ~3–8 s (depends on tracker + RTT).
- Cross‑device sync error: **±40 ms typical**, **±80 ms** acceptable (MVP target).

## Ops notes

- **Privacy:** server relays small JSON messages only; no metadata about audio content.
- **Scaling:** a single small node instance can support initial 10–20 peers per swarm; horizontal scaling by sticky sessions or a simple in‑memory sharding by swarmHash.
- **NAT:** some P2P paths may fail without TURN; consider adding TURN in future.
- **Resilience:** browser visibility/online events trigger clock pings; on resume, offset slews back without snaps.

## Tests (manual, MVP)

1. Join same swarm on 2–3 phones + a laptop.
2. Upload the same short audio file on one device, ensure others see its announcement and start fetching.
3. Director selects the file and hits **Play**. Expect tight alignment; adjust speaker delay per device.
4. Kill the director tab; verify lowest userId becomes director; try play/stop again.
5. Toggle airplane mode; rejoin; verify resync and gentle corrections.

---

### Future work

- Custom WebRTC datachannels (no BitTorrent), piece‑wise distribution and on‑demand fetch.
- Own WebSocket tracker + optional **TURN** for tough NATs.
- Playlist/looping/tempo control + click‑test calibration.
- Persist light metrics for ops visibility (no user audio).
