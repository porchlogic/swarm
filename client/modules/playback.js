
// playback.js — schedule purely against global time; delay node for speaker delay
import { clamp, log } from "./util.js";

export class Playback {
  constructor({ debugEl }) {
    this.debugEl = debugEl;
    this.ctx = null;
    this.delay = null;
    this.current = null;
    this.speakerDelayMs = 0;
    this.getGlobalNowMs = () => Date.now();
  }

  setSpeakerDelay(ms) {
    this.speakerDelayMs = clamp(ms|0, 0, 500);
    if (this.delay && this.ctx) {
      const t = this.ctx.currentTime;
      this.delay.delayTime.cancelScheduledValues(t);
      this.delay.delayTime.setTargetAtTime(this.speakerDelayMs / 1000, t, 0.020);
    }
  }

  setGlobalNowProvider(fn) { this.getGlobalNowMs = fn; }

  async ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.delay = this.ctx.createDelay(1.0);
      this.delay.delayTime.value = (this.speakerDelayMs || 0) / 1000;
      this.delay.connect(this.ctx.destination);
      await this.ctx.resume();
    }
  }

  async ensureDecoded(fileId, blobUrl) {
    await this.ensureCtx();
    if (!this._cache) this._cache = new Map();
    if (this._cache.has(fileId)) return this._cache.get(fileId);
    const ab = await (await fetch(blobUrl)).arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);
    this._cache.set(fileId, buf);
    return buf;
  }

  stop() {
    if (this.current?.src) {
      try { this.current.src.stop(0); } catch {}
    }
    this.current = null;
  }

  start({ buffer, fileId, globalStartTimeMs }) {
    if (!this.ctx || !this.delay) throw new Error("audio context not ready");
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.delay);

    const nowGlobalMs = this.getGlobalNowMs();
    const delaySec = Math.max(0, (globalStartTimeMs - nowGlobalMs) / 1000);
    const when = this.ctx.currentTime + delaySec;

    log(this.debugEl, `Scheduling start in ${Math.max(0, delaySec*1000)|0}ms`);
    src.start(when);

    this.current = { buffer, src, fileId, startedAtGlobal: globalStartTimeMs, scheduledAtLocal: when };
    return when;
  }

  applyGentleCorrection(_) {}
}
