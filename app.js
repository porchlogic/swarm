
// app.js — use a single base offset everywhere; gate play until locked; re-announce files on join
import { sha256Hex, nanoid, log } from "./modules/util.js";
import { OffsetEstimator } from "./modules/timing.js"; // from earlier version or patch5 if applied
import { ControlChannel } from "./modules/control.js";
import { SwarmFiles } from "./modules/swarm.js";
import { Playback } from "./modules/playback.js";
import { Director } from "./modules/director.js";
import { byId, setText, setHidden, setDisabled, fileRow } from "./modules/ui.js";

const connStatus = byId("connStatus");
const swarmPeers = byId("swarmPeers");
const directorStatus = byId("directorStatus");
const clockStatus = byId("clockStatus");
const debugEl = byId("debugLog");

const joinBtn = byId("joinBtn");
const leaveBtn = byId("leaveBtn");
const swarmKeyEl = byId("swarmKey");
const seedBtn = byId("seedBtn");
const fileInput = byId("fileInput");
const fileListEl = byId("fileList");
const playBtn = byId("playBtn");
const stopBtn = byId("stopBtn");
const currentFileLabel = byId("currentFileLabel");
const speakerDelay = byId("speakerDelay");
const speakerDelayVal = byId("speakerDelayVal");
const takeDirectorBtn = byId("takeDirectorBtn");
const resignDirectorBtn = byId("resignDirectorBtn");

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
      onSelectToggle: (fileId) => {
        state.currentFileId = fileId;
        currentFileLabel.textContent = `Selected: ${f.name}`;
        if (director?.isDirector) control.send("selectFile", { fileId });
        updatePlaybackButtons();
        if (f.ready) playback.ensureDecoded(fileId, f.blobUrl).catch(()=>{});
      }
    }));
  }
}

function updatePlaybackButtons() {
  const hasFile = !!(state.currentFileId && swarm?.getMeta(state.currentFileId)?.ready);
  const canPlay = director?.isDirector && hasFile && !state.playing && !!offset?.baseLocked;
  setDisabled("playBtn", !canPlay);
  setDisabled("stopBtn", !(director?.isDirector && state.playing));
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
  const key = swarmKeyEl.value.trim();
  if (!key) return;
  state.swarmHash = await sha256Hex(key);
  log(debugEl, `swarmHash: ${state.swarmHash}`);

  offset = new OffsetEstimator(); // robust version if you applied patch5; otherwise existing works
  const persisted = loadPersisted(state.swarmHash);

  playback = new Playback({ debugEl });
  playback.setGlobalNowProvider(() => getGlobalNow());
  playback.setSpeakerDelay(persisted.speakerDelayMs || 0);
  speakerDelay.value = String(persisted.speakerDelayMs || 0);
  speakerDelayVal.textContent = `${speakerDelay.value} ms`;

  // const urlParamWS = new URLSearchParams(location.search).get("ws");
  // const ctrlUrl = urlParamWS || `${location.protocol}//${location.host}`;
  const DEFAULT_WS = "wss://ws.porchlogic.com"; // your droplet's WS endpoint
  const urlParamWS = new URLSearchParams(location.search).get("ws");
  const storedWS = localStorage.getItem("ws_override"); // optional user override
  const ctrlUrl = urlParamWS || storedWS || DEFAULT_WS;

  control = new ControlChannel({ url: ctrlUrl, swarmHash: state.swarmHash, userId: state.userId, debugEl });
  await control.connect();
  connStatus.textContent = "connected";
  setHidden("fileSection", false);
  setHidden("playbackSection", false);
  setDisabled("leaveBtn", false);
  setDisabled("joinBtn", true);

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

// UI
joinBtn.onclick = async () => {
  try { await join(); }
  catch (err) {
    console.error(err);
    debugEl.textContent = `Join error: ${err?.message || err}\n` + debugEl.textContent;
    alert("Join failed. See Debug for details.");
  }
};
leaveBtn.onclick = () => location.reload();

seedBtn.onclick = async () => {
  const files = fileInput.files;
  if (!files || files.length === 0) return;
  await swarm.seedFiles(files, (announce) => control.send("file:announce", announce));
  renderFiles();
  updatePlaybackButtons();
};

playBtn.onclick = async () => {
  if (!director.isDirector || !state.currentFileId || !offset.baseLocked) return;
  const meta = swarm.getMeta(state.currentFileId);
  const isCached = playback._cache?.has?.(state.currentFileId);
  const startInMs = isCached ? 1200 : 2600;

  // Make sure our buffer is ready before we pick a start time
  const buf = await playback.ensureDecoded(state.currentFileId, meta.blobUrl);

  const globalStartTimeMs = getGlobalNow() + startInMs;
  const m = { fileId: state.currentFileId, globalStartTimeMs };
  control.send("play", m);
  await playFromMessage(m);
};

stopBtn.onclick = () => {
  if (!director.isDirector) return;
  control.send("stop", {});
  stopFromMessage();
};

speakerDelay.oninput = () => {
  const v = parseInt(speakerDelay.value, 10) || 0;
  speakerDelayVal.textContent = `${v} ms`;
  if (playback) playback.setSpeakerDelay(v);
  if (state.swarmHash) saveSpeakerDelay(state.swarmHash, v);
};

takeDirectorBtn.onclick = () => director?.take();
resignDirectorBtn.onclick = () => director?.resign();
