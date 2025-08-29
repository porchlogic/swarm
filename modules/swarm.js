
// swarm.js — expose getLocalMetas for re-announce
import { log } from "./util.js";

const DEFAULT_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.fastcast.nz"
];

export class SwarmFiles {
  constructor({ debugEl, maxFiles = 3, trackers = DEFAULT_TRACKERS } = {}) {
    this.debugEl = debugEl;
    this.maxFiles = maxFiles;
    this.trackers = trackers;
    this.client = new window.WebTorrent();
    this.local = new Map();
    this.remote = new Map();
  }

  getAll() { return [...this.local.values(), ...this.remote.values()]; }
  getLocalMetas() { return [...this.local.values()]; }

  async seedFiles(fileList, onAnnounce) {
    const files = [...fileList];
    for (const f of files.slice(0, this.maxFiles)) {
      await new Promise((resolve, reject) => {
        this.client.seed(f, { announce: this.trackers }, (torrent) => {
          const fileId = torrent.infoHash;
          const meta = {
            fileId,
            name: f.name,
            size: f.size,
            infoHash: torrent.infoHash,
            magnet: torrent.magnetURI,
            torrent,
            ready: false,
            blobUrl: null
          };
          this.local.set(fileId, meta);
          log(this.debugEl, "Seeding:", f.name, torrent.infoHash);
          if (onAnnounce) onAnnounce({ fileId, name: f.name, size: f.size, infoHash: torrent.infoHash, magnet: torrent.magnetURI });
          this._prepareBlob(meta).then(()=> resolve()).catch(reject);
        });
      });
    }
  }

  async _torrentFileToBlob(torrentFile) {
    return await new Promise((resolve, reject) => {
      if (typeof torrentFile.getBlob === "function") {
        torrentFile.getBlob((err, blob) => err ? reject(err) : resolve(blob));
      } else if (torrentFile.blob) {
        Promise.resolve(torrentFile.blob()).then(resolve, reject);
      } else {
        reject(new Error("WebTorrent file does not support getBlob/blob in this environment."));
      }
    });
  }

  async _prepareBlob(meta) {
    try {
      const t = meta.torrent;
      const f = t.files[0];
      const blob = await this._torrentFileToBlob(f);
      meta.blobUrl = URL.createObjectURL(blob);
      meta.ready = true;
      log(this.debugEl, "Prepared blob for", meta.name);
    } catch (e) {
      log(this.debugEl, "blob prep error", String(e));
    }
  }

  hasFile(fileId) { return this.local.has(fileId) || this.remote.has(fileId); }

  async ensureRemote(m, onProgress) {
    const { fileId, name, size, magnet } = m;
    if (this.local.has(fileId) || this.remote.has(fileId)) return;
    log(this.debugEl, "Adding remote file:", name, fileId);
    await new Promise((resolve, reject) => {
      this.client.add(magnet, { announce: this.trackers }, (torrent) => {
        const meta = { fileId, name, size, infoHash: torrent.infoHash, magnet, torrent, ready: false, blobUrl: null };
        this.remote.set(fileId, meta);
        torrent.on("download", () => { if (onProgress) onProgress({ fileId, progress: torrent.progress }); });
        torrent.on("done", () => { this._prepareBlob(meta).then(resolve).catch(reject); });
      });
    });
  }

  getMeta(fileId) { return this.local.get(fileId) || this.remote.get(fileId) || null; }
}
