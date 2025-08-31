
// app.js — use a single base offset everywhere; gate play until locked; re-announce files on join
import { sha256Hex, nanoid, log } from "./modules/util.js";
import { OffsetEstimator } from "./modules/timing.js"; // from earlier version or patch5 if applied
import { ControlChannel } from "./modules/control.js";
import { SwarmFiles } from "./modules/swarm.js";
import { Playback } from "./modules/playback.js";
import { Director } from "./modules/director.js";
import { byId, setText, setHidden, setDisabled, fileRow, plusRow } from "./modules/ui.js";

const connStatus = byId("connStatus");
const swarmPeers = byId("swarmPeers");
const directorStatus = byId("directorStatus");
const clockStatus = byId("clockStatus");
const debugEl = byId("debugLog");

let joinBtn;
let leaveBtn;
let swarmNameEl;
let swarmSecretEl;
let fileInput;
let fileListEl;
let primaryPlayBtn;
let primaryPlayIcon;
let toggleControlsBtn;
let currentFileLabel;
let delaySlider;
let delayVal;
let delayIncBtn;
let delayDecBtn;
let controlsOverlay;
let controlsSheet;
let toggleOriginalParent;
let toggleOriginalNextSibling;

let control = null;
let director = null;
let swarm = null;
let playback = null;
let offset = null;

let state = {
  swarmHash: null,
  userId: nanoid(),
  currentFileId: null,
  playing: false,
  globalStartTimeMs: null
};

const LS_KEYS = {
  baseOffset: (swarmHash) => `swarm_base_offset_${swarmHash}`,
  baseOffsetTs: (swarmHash) => `swarm_base_offset_ts_${swarmHash}`,
  speakerDelay: (swarmHash) => `swarm_speaker_delay_${swarmHash}`
};

function loadPersisted(swarmHash) {
  const off = parseFloat(localStorage.getItem(LS_KEYS.baseOffset(swarmHash)));
  const ts  = parseInt(localStorage.getItem(LS_KEYS.baseOffsetTs(swarmHash)), 10);
  const spk = parseInt(localStorage.getItem(LS_KEYS.speakerDelay(swarmHash)), 10);
  return {
    baseOffsetMs: Number.isFinite(off) ? off : null,
    baseOffsetTs: Number.isFinite(ts) ? ts : 0,
    speakerDelayMs: Number.isFinite(spk) ? spk : 0
  };
}
function saveBaseOffset(swarmHash, ms) {
  localStorage.setItem(LS_KEYS.baseOffset(swarmHash), String(ms|0));
  localStorage.setItem(LS_KEYS.baseOffsetTs(swarmHash), String(Date.now()));
}
function saveSpeakerDelay(swarmHash, ms) {
  localStorage.setItem(LS_KEYS.speakerDelay(swarmHash), String(ms|0));
}

// Global time = Date.now() + baseOffset
function getGlobalNow() {
  return Date.now() + (offset?.baseOffsetMs || 0);
}

function renderFiles() {
  fileListEl.innerHTML = "";
  const files = swarm ? swarm.getAll() : [];
  for (const f of files) {
    fileListEl.appendChild(fileRow({
      file: f,
      selected: state.currentFileId === f.fileId,
      onSelectToggle: (fileId) => {
        state.currentFileId = fileId;
        currentFileLabel.textContent = `Selected: ${f.name}`;
        if (director?.isDirector) control.send("selectFile", { fileId });
        updatePlaybackButtons();
        if (f.ready) playback.ensureDecoded(fileId, f.blobUrl).catch(()=>{});
        renderFiles();
      }
    }));
  }
  // "+" add file row at the end
  fileListEl.appendChild(plusRow({
    onAdd: () => fileInput?.click?.()
  }));
}

function updatePlaybackButtons() {
  const hasFile = !!(state.currentFileId && swarm?.getMeta(state.currentFileId)?.ready);
  const canControl = !!director?.isDirector && !!offset?.baseLocked;
  const playing = !!state.playing;

  // Enable main button only if director and a file is ready
  const enable = canControl && hasFile;
  setDisabled("primaryPlayBtn", !enable);

  // Icon: ▶ when not playing, ■ when playing
  const iconEl = byId("primaryPlayIcon");
  if (iconEl) iconEl.textContent = playing ? "■" : "▶";
}

function updateTopBar() {
  setText("directorStatus", `director: ${director?.isDirector ? "you" : (director?.currentDirectorId || "?")}`);
  setText("swarmPeers", `peers: ${director?.peers?.length || 0}`);
  const off = offset?.baseOffsetMs ?? 0;
  setText("clockStatus", `offset(base): ${off|0}ms`);
}

async function playFromMessage(m) {
  if (!offset?.baseLocked) {
    log(debugEl, "Play arrived but baseOffset not locked yet; waiting...");
    // wait briefly for lock (up to 1s)
    const t0 = Date.now();
    while (!offset.baseLocked && Date.now()-t0 < 1000) await new Promise(r=>setTimeout(r,50));
  }
  if (!state.currentFileId) state.currentFileId = m.fileId;
  const meta = swarm.getMeta(m.fileId);
  if (!meta || !meta.ready) {
    currentFileLabel.textContent = "Fetching file...";
    while (true) {
      const mm = swarm.getMeta(m.fileId);
      if (mm?.ready) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  const buf = await playback.ensureDecoded(m.fileId, swarm.getMeta(m.fileId).blobUrl);
  state.globalStartTimeMs = m.globalStartTimeMs;
  await playback.ensureCtx();
  playback.start({ buffer: buf, fileId: m.fileId, globalStartTimeMs: m.globalStartTimeMs });
  state.playing = true;
  updatePlaybackButtons();
}

function stopFromMessage() {
  playback.stop();
  state.playing = false;
  updatePlaybackButtons();
}

// Join flow
async function join() {
  const name = swarmNameEl.value.trim();
  const secret = swarmSecretEl.value.trim();
  if (!name || !secret) {
    alert("Please enter a swarm name and secret key.");
    return;
  }
  const composite = `${name}:${secret}`;
  state.swarmHash = await sha256Hex(composite);
  log(debugEl, `swarmHash: ${state.swarmHash} (from ${name}:****)`);

  offset = new OffsetEstimator(); // robust version if you applied patch5; otherwise existing works
  const persisted = loadPersisted(state.swarmHash);

  playback = new Playback({ debugEl });
  playback.setGlobalNowProvider(() => getGlobalNow());
  const initialDelay = Number.isFinite(persisted.speakerDelayMs) ? persisted.speakerDelayMs : 0;
  if (initialDelay >= 0) {
    playback.setSpeakerDelay(initialDelay);
    playback.setScheduleAdjust(0);
  } else {
    playback.setSpeakerDelay(0);
    playback.setScheduleAdjust(initialDelay);
  }
  if (delaySlider) delaySlider.value = String(initialDelay);
  if (delayVal) delayVal.textContent = `${initialDelay|0} ms`;

  // const urlParamWS = new URLSearchParams(location.search).get("ws");
  // const ctrlUrl = urlParamWS || `${location.protocol}//${location.host}`;
  const DEFAULT_WS = "wss://ws.porchlogic.com"; // your droplet's WS endpoint
  const urlParamWS = new URLSearchParams(location.search).get("ws");
  const storedWS = localStorage.getItem("ws_override"); // optional user override
  const ctrlUrl = urlParamWS || storedWS || DEFAULT_WS;

  control = new ControlChannel({ url: ctrlUrl, swarmHash: state.swarmHash, userId: state.userId, debugEl });
  await control.connect();
  connStatus.textContent = "connected";
  setHidden("statusContainer", false);
  setHidden("screenFiles", false);
  // hide the join UI once we've successfully joined and surface a persistent leave button
  setHidden("joinSection", true);
  setHidden("leaveBtn", false);
  setHidden("errorBanner", true);
  setDisabled("leaveBtn", false);
  setDisabled("joinBtn", true);
  // Update header to show swarm name
  setText("swarmTitle", name);

  control.startClockPings(5);
  director = new Director({ control, debugEl });

  control.on("joined", (m) => { director.updatePeers(m.peers || []); updateTopBar(); });
  control.on("peers",  (m) => { director.updatePeers(m.peers || []); updateTopBar(); });

  // Re-announce local files when a peer joins (so refreshed peers repopulate)
  control.on("presence", (m) => {
    if (m.action === "join") {
      const locals = swarm.getLocalMetas?.() || [];
      for (const lf of locals) {
        control.send("file:announce", { fileId: lf.fileId, name: lf.name, size: lf.size, infoHash: lf.infoHash, magnet: lf.magnet });
      }
    }
  });

  control.on("timePong", (m) => {
    const t1 = Date.now();
    offset.addSample(m.t0, m.tS, t1);
    updateTopBar();
  });

  swarm = new SwarmFiles({ debugEl });

  control.on("file:announce", async (m) => {
    if (swarm.hasFile(m.fileId)) return;
    await swarm.ensureRemote(m, () => {});
    renderFiles();
    updatePlaybackButtons();
  });

  control.on("selectFile", (m) => {
    state.currentFileId = m.fileId;
    const meta = swarm.getMeta(m.fileId);
    currentFileLabel.textContent = meta ? `Selected: ${meta.name}` : `Selected: ${m.fileId}`;
    updatePlaybackButtons();
    if (meta?.ready) playback.ensureDecoded(m.fileId, meta.blobUrl).catch(()=>{});
  });

  control.on("play", async (m) => { await playFromMessage(m); });
  control.on("stop", () => { stopFromMessage(); });

  control.on("close", () => {
    connStatus.textContent = "disconnected";
    setDisabled("leaveBtn", true);
    setDisabled("joinBtn", false);
  });

  try { await playback.ensureCtx(); } catch {}

  // Lock base offset quickly & deterministically:
  //  - If we have a persisted value, reuse it immediately.
  //  - Else, after ~1.2s of preroll, lock whatever estimate we have (even large).
  if (persisted.baseOffsetMs !== null) {
    offset.baseLocked = true;
    offset.baseOffsetMs = persisted.baseOffsetMs;
    log(debugEl, `Using persisted baseOffset: ${offset.baseOffsetMs|0}ms`);
  } else {
    setTimeout(() => {
      if (!offset.baseLocked) {
        offset.lockBase();
        saveBaseOffset(state.swarmHash, offset.baseOffsetMs);
        log(debugEl, `Locked baseOffset: ${offset.baseOffsetMs|0}ms`);
      }
      updatePlaybackButtons();
    }, 1200);
  }

  renderFiles();
  updatePlaybackButtons();
  updateTopBar();
}

// UI — bind elements and wire handlers after DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  joinBtn = byId("joinBtn");
  leaveBtn = byId("leaveBtn");
  swarmNameEl = byId("swarmName");
  swarmSecretEl = byId("swarmSecret");
  fileInput = byId("fileInput");
  fileListEl = byId("fileList");
  primaryPlayBtn = byId("primaryPlayBtn");
  primaryPlayIcon = byId("primaryPlayIcon");
  toggleControlsBtn = byId("toggleControlsBtn");
  currentFileLabel = byId("currentFileLabel");
  delaySlider = byId("delaySlider");
  delayVal = byId("delayVal");
  delayIncBtn = byId("delayIncBtn");
  delayDecBtn = byId("delayDecBtn");
  controlsOverlay = byId("controlsOverlay");
  controlsSheet = byId("controlsSheet");

  // Remember where the toggle lives so we can move it into the sheet while it's open
  toggleOriginalParent = toggleControlsBtn?.parentNode || null;
  toggleOriginalNextSibling = toggleControlsBtn?.nextSibling || null;

  joinBtn.onclick = async () => {
    try { await join(); }
    catch (err) {
      console.error(err);
      debugEl.textContent = `Join error: ${err?.message || err}\n` + debugEl.textContent;
      alert("Join failed. See Debug for details.");
    }
  };
  leaveBtn.onclick = () => location.reload();

  fileInput.onchange = async () => {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    await swarm.seedFiles(files, (announce) => control.send("file:announce", announce));
    fileInput.value = "";
    renderFiles();
    updatePlaybackButtons();
  };

  primaryPlayBtn.onclick = async () => {
    if (!director?.isDirector || !state.currentFileId || !offset?.baseLocked) return;
    if (state.playing) {
      control.send("stop", {});
      stopFromMessage();
      return;
    }
    const meta = swarm.getMeta(state.currentFileId);
    const isCached = playback._cache?.has?.(state.currentFileId);
    const startInMs = isCached ? 1200 : 2600;

    // Ensure buffer is ready before we pick a start time
    await playback.ensureDecoded(state.currentFileId, meta.blobUrl);

    const globalStartTimeMs = getGlobalNow() + startInMs;
    const m = { fileId: state.currentFileId, globalStartTimeMs };
    control.send("play", m);
    await playFromMessage(m);
  };

  // Wire delay controls (slider + inc/dec) found within `root` (Element or Document).
  // Uses a data attribute to avoid attaching duplicate listeners.
  function wireDelayControls(root) {
    try {
      const r = root || document;
      const sDelaySlider = (r.querySelector ? r.querySelector("#delaySlider") : null);
      const sDelayVal = (r.querySelector ? r.querySelector("#delayVal") : null);
      const sInc = (r.querySelector ? r.querySelector("#delayIncBtn") : null);
      const sDec = (r.querySelector ? r.querySelector("#delayDecBtn") : null);

      // Update global refs so other code can read them
      if (sDelaySlider) delaySlider = sDelaySlider;
      if (sDelayVal) delayVal = sDelayVal;
      if (sInc) delayIncBtn = sInc;
      if (sDec) delayDecBtn = sDec;

      // Helper to attach a listener only once
      const attachOnce = (el, ev, fn) => {
        if (!el) return;
        const key = `wired_${ev}`;
        if (el.dataset && el.dataset[key]) return;
        el.addEventListener(ev, fn);
        if (el.dataset) el.dataset[key] = "1";
      };

      attachOnce(sDelaySlider, "input", () => {
        const v = parseInt(sDelaySlider.value, 10) || 0;
        applyDelayValue(v);
      });
      attachOnce(sInc, "click", () => {
        const v = (parseInt((sDelaySlider && sDelaySlider.value) || "0", 10) || 0) + 10;
        applyDelayValue(v);
      });
      attachOnce(sDec, "click", () => {
        const v = (parseInt((sDelaySlider && sDelaySlider.value) || "0", 10) || 0) - 10;
        applyDelayValue(v);
      });
    } catch (e) { /* defensive */ }
  }

  const openControlsSheet = () => {
    if (controlsOverlay) controlsOverlay.classList.add("open");
    if (controlsSheet) {
      controlsSheet.classList.add("open");
      controlsSheet.setAttribute("aria-hidden", "false");
      // Move the floating toggle into the sheet so it appears at the top of the panel (after the handle)
      try {
        if (toggleControlsBtn && toggleOriginalParent && !controlsSheet.contains(toggleControlsBtn)) {
          const container = controlsSheet.querySelector(".controlsContainer");
          // insert after the handle and before the controls container
          if (container) controlsSheet.insertBefore(toggleControlsBtn, container);
          else controlsSheet.insertBefore(toggleControlsBtn, controlsSheet.firstChild);
          toggleControlsBtn.classList.add("in-sheet");
        }
      } catch (e) { /* defensive */ }

      // Wire controls inside the sheet (safe to call repeatedly)
      wireDelayControls(controlsSheet);
    }
  };
  const closeControlsSheet = () => {
    if (controlsOverlay) controlsOverlay.classList.remove("open");
    if (controlsSheet) {
      controlsSheet.classList.remove("open");
      controlsSheet.setAttribute("aria-hidden", "true");
      // Restore the toggle back to its original place in the file list screen
      try {
        if (toggleControlsBtn && toggleOriginalParent && controlsSheet.contains(toggleControlsBtn)) {
          if (toggleOriginalNextSibling) toggleOriginalParent.insertBefore(toggleControlsBtn, toggleOriginalNextSibling);
          else toggleOriginalParent.appendChild(toggleControlsBtn);
          toggleControlsBtn.classList.remove("in-sheet");
        }
      } catch (e) { /* defensive */ }

      // After closing, re-wire controls from the main document area (keeps globals pointing at visible elements)
      wireDelayControls(document);
    }
  };

  if (toggleControlsBtn) {
    toggleControlsBtn.onclick = () => {
      if (controlsSheet && controlsSheet.classList.contains("open")) closeControlsSheet();
      else openControlsSheet();
    };
  }
  if (controlsOverlay) {
    controlsOverlay.onclick = () => closeControlsSheet();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeControlsSheet();
  });

  // Wire delay controls for the currently visible DOM (safe to call multiple times)
  try { wireDelayControls(document); } catch (e) { /* defensive */ }

  const applyDelayValue = (v) => {
    v = Math.max(-2500, Math.min(2500, v|0));
    if (delayVal) delayVal.textContent = `${v} ms`;
    if (playback) {
      if (v >= 0) {
        playback.setSpeakerDelay(v);
        playback.setScheduleAdjust(0);
      } else {
        playback.setSpeakerDelay(0);
        playback.setScheduleAdjust(v);
      }
    }
    if (delaySlider) delaySlider.value = String(v);
    if (state.swarmHash) saveSpeakerDelay(state.swarmHash, v);
  };

  if (delaySlider) {
    delaySlider.oninput = () => {
      const v = parseInt(delaySlider.value, 10) || 0;
      applyDelayValue(v);
    };
  }
  if (delayIncBtn) {
    delayIncBtn.onclick = () => {
      const v = (parseInt(delaySlider.value, 10) || 0) + 10;
      applyDelayValue(v);
    };
  }
  if (delayDecBtn) {
    delayDecBtn.onclick = () => {
      const v = (parseInt(delaySlider.value, 10) || 0) - 10;
      applyDelayValue(v);
    };
  }

  // Director role controls removed from simplified UI
});
