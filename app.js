// app.js — role-sticky director; body-wide glow; takeover button; dual selection highlights
import { sha256Hex, nanoid, log } from "./modules/util.js";
import { OffsetEstimator } from "./modules/timing.js";
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
let currentFileLabel;
let delaySlider;
let delayVal;
let delayIncBtn;
let delayDecBtn;
let controlsOverlay;
let controlsSheet;
let takeoverBtn;

let control = null;
let director = null;
let swarm = null;
let playback = null;
let offset = null;

let state = {
  swarmHash: null,
  userId: nanoid(),
  directorFileId: null,
  localChoiceId: null,
  playing: false,
  globalStartTimeMs: null
};

const LS_KEYS = {
  speakerDelay: (swarmHash) => `swarm_speaker_delay_${swarmHash}`,
};

function loadSpeakerDelay(swarmHash) {
  const spk = parseInt(localStorage.getItem(LS_KEYS.speakerDelay(swarmHash)), 10);
  return Number.isFinite(spk) ? spk : 0;
}
function saveSpeakerDelay(swarmHash, ms) {
  localStorage.setItem(LS_KEYS.speakerDelay(swarmHash), String(ms | 0));
}

function loadPersisted(swarmHash) {
  const off = parseFloat(localStorage.getItem(LS_KEYS.baseOffset(swarmHash)));
  const ts = parseInt(localStorage.getItem(LS_KEYS.baseOffsetTs(swarmHash)), 10);
  const spk = parseInt(localStorage.getItem(LS_KEYS.speakerDelay(swarmHash)), 10);
  return {
    baseOffsetMs: Number.isFinite(off) ? off : null,
    baseOffsetTs: Number.isFinite(ts) ? ts : 0,
    speakerDelayMs: Number.isFinite(spk) ? spk : 0
  };
}
function saveBaseOffset(swarmHash, ms) {
  localStorage.setItem(LS_KEYS.baseOffset(swarmHash), String(ms | 0));
  localStorage.setItem(LS_KEYS.baseOffsetTs(swarmHash), String(Date.now()));
}
// function saveSpeakerDelay(swarmHash, ms) {
//   localStorage.setItem(LS_KEYS.speakerDelay(swarmHash), String(ms | 0));
// }

// Global time = Date.now() + baseOffset
function getGlobalNow() {
  return Date.now() + (offset?.baseOffsetMs || 0);
}

function renderFiles() {
  fileListEl.innerHTML = "";
  const files = swarm ? swarm.getAll() : [];
  const isDirector = !!director?.isDirector;
  const dirId = state.directorFileId;
  const localId = state.localChoiceId;

  for (const f of files) {
    fileListEl.appendChild(fileRow({
      file: f,
      selectedDirector: f.fileId === dirId,
      selectedLocal: !isDirector && f.fileId === localId && localId !== dirId,
      onSelectToggle: (fileId) => {
        if (director?.isDirector) {
          state.directorFileId = fileId;
          state.localChoiceId = fileId;
          const meta = swarm.getMeta(fileId);
          currentFileLabel.textContent = meta ? `Selected: ${meta.name}` : `Selected: ${fileId}`;
          control.send("selectFile", { fileId });

          if (meta?.ready) playback.ensureDecoded(fileId, meta.blobUrl).catch(() => { });
          updatePlaybackButtons();
          renderFiles();
          return;
        }

        state.localChoiceId = fileId;
        const meta = swarm.getMeta(fileId);
        if (meta?.ready) playback.ensureDecoded(fileId, meta.blobUrl).catch(() => { });
        updatePlaybackButtons();
        renderFiles();
      }
    }));
  }

  fileListEl.appendChild(plusRow({ onAdd: () => fileInput?.click?.() }));
}

function updatePlaybackButtons() {
  const dirFile = state.directorFileId;
  const hasFile = !!(dirFile && swarm?.getMeta(dirFile)?.ready);
  const canControl = !!director?.isDirector && !!offset?.baseLocked;
  const playing = !!state.playing;

  setDisabled("primaryPlayBtn", !(canControl && hasFile));

  const iconEl = byId("primaryPlayIcon");
  if (iconEl) iconEl.textContent = playing ? "■" : "▶";
}

function updateRoleGlowAndTakeover() {
  const body = document.body;
  body.classList.remove("role-director", "role-peer");
  if (director?.isDirector) body.classList.add("role-director");
  else body.classList.add("role-peer");

  const vacancy = !director?.currentDirectorId;
  setHidden("takeoverBtn", !(vacancy && !director?.isDirector));
}

function updateTopBar() {
  setText("directorStatus", `director: ${director?.isDirector ? "you" : (director?.currentDirectorId || "—")}`);
  setText("swarmPeers", `peers: ${director?.peers?.length || 0}`);
  const off = offset?.baseOffsetMs ?? 0;
  setText("clockStatus", `offset(base): ${off | 0}ms`);
  updateRoleGlowAndTakeover();
}

async function playFromMessage(m) {
  if (!offset?.baseLocked) {
    log(debugEl, "Play arrived but baseOffset not locked yet; waiting...");
    const t0 = Date.now();
    while (!offset.baseLocked && Date.now() - t0 < 1000) await new Promise(r => setTimeout(r, 50));
  }

  state.directorFileId = m.fileId;

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
  renderFiles();
}

function stopFromMessage() {
  playback.stop();
  state.playing = false;
  updatePlaybackButtons();
  renderFiles();
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

  offset = new OffsetEstimator();

  // Re-anchor epoch base for monotonic mapping each join
  // epochAtPerf0 = Date.now();

  playback = new Playback({ debugEl });
  playback.setGlobalNowProvider(() => getGlobalNow());

  const initialDelay = loadSpeakerDelay(state.swarmHash);

  if (initialDelay >= 0) {
    playback.setSpeakerDelay(initialDelay);
    playback.setScheduleAdjust(0);
  } else {
    playback.setSpeakerDelay(0);
    playback.setScheduleAdjust(initialDelay);
  }
  if (delaySlider) delaySlider.value = String(initialDelay);
  if (delayVal) delayVal.textContent = `${initialDelay | 0} ms`;

  const DEFAULT_WS = "wss://ws.porchlogic.com";
  const urlParamWS = new URLSearchParams(location.search).get("ws");
  const storedWS = localStorage.getItem("ws_override");
  const ctrlUrl = urlParamWS || storedWS || DEFAULT_WS;

  control = new ControlChannel({ url: ctrlUrl, swarmHash: state.swarmHash, userId: state.userId, debugEl });
  await control.connect();
  connStatus.textContent = "connected";

  // Show/Hide sections based on joined state
  setHidden("statusContainer", false);
  setHidden("screenFiles", false);
  setHidden("joinSection", true);
  setHidden("leaveBtn", false);
  setHidden("errorBanner", true);
  setHidden("playSection", false);          // ← show play footer after join
  setHidden("controlsSheet", false);        // ← show controls panel (closed) after join
  setHidden("controlsOverlay", true);       // keep overlay hidden until panel opens

  setDisabled("leaveBtn", false);
  setDisabled("joinBtn", true);
  setText("swarmTitle", name);

  control.startClockPings(5);
  director = new Director({ control, debugEl });

  // Presence & peers
  control.on("joined", (m) => { director.updatePeers(m.peers || []); director.assertInitialIfAlone(); updateTopBar(); });
  control.on("peers", (m) => { director.updatePeers(m.peers || []); updateTopBar(); });

  // Director control messages
  control.on("director:assert", (m) => { director.setDirector(m.userId || null); updateTopBar(); });
  control.on("director:take", (m) => { director.setDirector(m.userId || null); updateTopBar(); });
  control.on("director:resign", (_) => { director.setDirector(null); updateTopBar(); });

  // Re-announce local files when a peer joins
  control.on("presence", (m) => {
    if (m.action === "join") {
      const locals = swarm.getLocalMetas?.() || [];
      for (const lf of locals) {
        control.send("file:announce", { fileId: lf.fileId, name: lf.name, size: lf.size, infoHash: lf.infoHash, magnet: lf.magnet });
      }
    }
  });

  // Clock pongs
  control.on("timePong", (m) => {
    const t1 = Date.now();
    offset.addSample(m.t0, m.tS, t1);

    // Lock once we have enough good samples; no cached reuse
    if (!offset.baseLocked) {
      offset.lockBase();
      log(debugEl, `Locked baseOffset: ${offset.baseOffsetMs | 0}ms`);
      updatePlaybackButtons();
    }

    updateTopBar();
  });


  // Files
  swarm = new SwarmFiles({ debugEl });

  control.on("file:announce", async (m) => {
    if (swarm.hasFile(m.fileId)) return;
    await swarm.ensureRemote(m, () => { });
    renderFiles();
    updatePlaybackButtons();
  });

  control.on("selectFile", (m) => {
    state.directorFileId = m.fileId;
    const meta = swarm.getMeta(m.fileId);
    currentFileLabel.textContent = meta ? `Selected: ${meta.name}` : `Selected: ${m.fileId}`;
    updatePlaybackButtons();
    if (meta?.ready) playback.ensureDecoded(m.fileId, meta.blobUrl).catch(() => { });
    renderFiles();
  });

  control.on("play", async (m) => { await playFromMessage(m); });
  control.on("stop", () => { stopFromMessage(); });

  control.on("close", () => {
    connStatus.textContent = "disconnected";
    setDisabled("leaveBtn", true);
    setDisabled("joinBtn", false);
  });

  try { await playback.ensureCtx(); } catch { }

  // // Lock base offset quickly & deterministically
  // if (persisted.baseOffsetMs !== null) {
  //   offset.baseLocked = true;
  //   offset.baseOffsetMs = persisted.baseOffsetMs;
  //   log(debugEl, `Using persisted baseOffset: ${offset.baseOffsetMs | 0}ms`);
  // } else {
  //   setTimeout(() => {
  //     if (!offset.baseLocked) {
  //       offset.lockBase();
  //       saveBaseOffset(state.swarmHash, offset.baseOffsetMs);
  //       log(debugEl, `Locked baseOffset: ${offset.baseOffsetMs | 0}ms`);
  //     }
  //     updatePlaybackButtons();
  //   }, 1200);
  // }

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
  currentFileLabel = byId("currentFileLabel");
  delaySlider = byId("delaySlider");
  delayVal = byId("delayVal");
  delayIncBtn = byId("delayIncBtn");
  delayDecBtn = byId("delayDecBtn");
  controlsOverlay = byId("controlsOverlay");
  controlsSheet = byId("controlsSheet");
  takeoverBtn = byId("takeoverBtn");

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
    if (!director?.isDirector || !state.directorFileId || !offset?.baseLocked) return;
    if (state.playing) {
      control.send("stop", {});
      stopFromMessage();
      return;
    }
    const meta = swarm.getMeta(state.directorFileId);
    const isCached = playback._cache?.has?.(state.directorFileId);
    const startInMs = isCached ? 2400 : 3600;

    await playback.ensureDecoded(state.directorFileId, meta.blobUrl);

    const globalStartTimeMs = getGlobalNow() + startInMs;
    const m = { fileId: state.directorFileId, globalStartTimeMs };
    control.send("play", m);
    await playFromMessage(m);
  };

  // ---- Controls drawer wiring: click the sheet's top header to open/close ----
  function setHeaderExpanded(isOpen) {
    const header = document.getElementById("controlsHeader");
    if (header) {
      header.setAttribute("aria-expanded", isOpen ? "true" : "false");
      header.setAttribute("aria-label", isOpen ? "Close controls" : "Open controls");
    }
    if (controlsSheet) controlsSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  }

  function openControlsSheet() {
    if (controlsOverlay) controlsOverlay.classList.add("open");
    if (controlsSheet) {
      controlsSheet.classList.add("open");
      controlsSheet.setAttribute("aria-hidden", "false");
      try { wireDelayControls(controlsSheet); } catch { }
    }
    setHeaderExpanded(true);
  }

  function closeControlsSheet() {
    if (controlsOverlay) controlsOverlay.classList.remove("open");
    if (controlsSheet) {
      controlsSheet.classList.remove("open");
      controlsSheet.setAttribute("aria-hidden", "true");
      try { wireDelayControls(document); } catch { }
    }
    setHeaderExpanded(false);
  }

  function toggleSheet() {
    const isOpen = controlsSheet && controlsSheet.classList.contains("open");
    if (isOpen) closeControlsSheet(); else openControlsSheet();
  }

  const controlsHeader = document.getElementById("controlsHeader");
  if (controlsHeader) {
    controlsHeader.addEventListener("click", toggleSheet);
    controlsHeader.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSheet(); }
    });
  }

  if (controlsSheet) {
    controlsSheet.addEventListener("click", (e) => {
      const interactive = e.target.closest("input,button,select,textarea,details,summary,.nudgeBtn,.delaySlider");
      if (interactive) return;
      const bounds = controlsSheet.getBoundingClientRect();
      const topZone = e.clientY - bounds.top;
      if (topZone >= 0 && topZone <= 56) toggleSheet();
    });
  }

  if (controlsOverlay) controlsOverlay.onclick = () => closeControlsSheet();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeControlsSheet(); });

  // Initialize ARIA state for a closed (and initially hidden) sheet
  setHeaderExpanded(false);

  // Delay control helpers
  const applyDelayValue = (v) => {
    v = Math.max(-2500, Math.min(2500, v | 0));
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

  // Wire initial visible controls (safe before join)
  try {
    if (delayIncBtn) delayIncBtn.onclick = () => applyDelayValue((parseInt(delaySlider.value, 10) || 0) + 5);
    if (delayDecBtn) delayDecBtn.onclick = () => applyDelayValue((parseInt(delaySlider.value, 10) || 0) - 5);
    if (delaySlider) delaySlider.oninput = (e) => applyDelayValue(parseInt(e.target.value, 10) || 0);
  } catch (_) { }

  // Takeover button
  if (takeoverBtn) {
    takeoverBtn.onclick = () => {
      if (director && !director.isDirector) {
        director.take();
        updateTopBar();
      }
    };
  }
});
