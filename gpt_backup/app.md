# Product one-pager (high-level requirements)

## Objective

Enable people on separate devices (primarily phones) to share audio files peer-to-peer and play them back in tight sync during a live swarm session, with minimal server responsibilities and no server custody of user audio.

## Constraints & principles

* **Privacy:** Server never stores or inspects audio files.
* **Simplicity:** Prefer a static SPA (single page app). Keep infra minimal.
* **Mobile-first:** Must work reliably in modern iOS/Android browsers.
* **Ephemeral:** Swarms dissolve when last peer leaves; files vanish with them.

## Core concepts

* **Swarm:** Users join by entering a swarm key. A hash of it namespaces the P2P swarm + control channel.
* **Director:** One peer in a swarm is authoritative for transport state (play/stop, file selection, global start time). Leadership is deterministic with failover.
* **Global time:** All peers measure offset to the server’s clock (NTP-style).
* **Local time:** Each device computes `local_start_time = global_start_time + offset - speaker_delay`.
* **Speaker delay:** User-adjustable (0–500 ms) to compensate for device/speaker latency.
* **Offset strategy:**

  * Run continuous offset pings.
  * *Lock in* a base offset before playback.
  * While playing, keep measuring but don’t constantly update.
  * Only apply gentle corrections if drift >\~30 ms for several samples.
  * Corrections should **slew** (1–2 ms/s) or use tiny playbackRate nudges, never snap.

## Features (must-haves)

1. **Swarm join**

   * Input swarm key → derive swarm hash → join control channel + P2P swarm.
   * Auto user id per session.
   * Show connectivity and peer count.

2. **P2P file sharing**

   * Each peer may upload up to N files (e.g. 3).
   * Downloading implies reseeding.
   * File list UI: name, size, progress, seeded/enabled flags.
   * Server never sees or stores files.

3. **Playback control**

   * Director chooses a file and issues a `global_start_time`.
   * All peers schedule via WebAudio relative to their local start time.
   * Play/stop and file change states propagate.
   * Speaker delay slider lets user fine-tune by ear.

4. **Clock sync (refined)**

   * Ping cadence: 1–2 Hz during playback, 5 Hz pre-roll.
   * Ignore drift < \~12 ms.
   * Initiate correction if error > \~30 ms across multiple samples.
   * Corrections applied gradually to avoid audible jumps.

5. **Director logic**

   * Deterministic election (e.g. lowest user\_id) if no director.
   * Heartbeats to assert liveness.
   * Automatic failover.
   * Manual “take/resign” allowed.

6. **Resilience**

   * Survive network hiccups, mobile background throttling.
   * Auto resync after network resume.
   * Handle mid-download file cases gracefully.

## Server responsibilities (minimal)

* **Control channel:** WebSocket for presence + small state messages (director, play/stop, etc.).
* **Clock service:** Responds to time pings. No file metadata.

## Non-goals (MVP)

* No accounts, persistence, or directories.
* No multi-track mixing or playlists (single file at a time).
* No file history.

## Quality targets

* Startup → first sync: < 5 s typical.
* Cross-device sync error: target ±40 ms, acceptable up to ±80 ms.
* Swarm size: 10–20 peers initially.

## Security & privacy

* Swarm key hashed → swarm namespace.
* TLS for server channel, WebRTC security for P2P.
* Minimal operational metrics only.

## UX essentials

* Swarm key entry, join/leave.
* File picker & list with enable/disable.
* Play/stop, current file display.
* Speaker-delay slider with optional click test.
* Status messages: syncing, waiting for director, missing file, etc.

## Edge cases

* Director starts file peers don’t yet have → UI shows “fetching” or block until quorum.
* Director drop → auto re-elect.
* Offset jump after network change → reschedule gently.
* Mobile background/resume → re-align.

## Extensibility (future)

* TURN hosting if NAT blocks P2P.
* Playlists, looping, tempo control.
* Click-test calibration for speaker delay.

## Deliverables

* **SPA** with clear modules (timing, control, swarm/files, playback, director, UI).
* **Server:** Minimal WebSocket service with time-ping endpoint.
* **Docs:** Architecture diagram, swarm join/start sequence, control message schema, ops notes.
* **Tests:** Multi-device sync, director failover, mobile resume, network jitter.

## Implementation latitude

Developer may choose best P2P stack (WebTorrent vs custom WebRTC data channels) and control tech as long as:

* Audio never hits the server.
* Time sync is consistent with gentle drift correction.
* UX + feature set above are met.

---

Do you want me to also produce a **visual “swarm lifecycle” diagram** (join → offset lock → play → drift correction → stop/teardown) for the spec, so your dev can instantly see the flow?
