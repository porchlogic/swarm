
// playback.js — DelayNode for live speaker-delay; no playbackRate nudging.
import { clamp, log } from "./util.js";

export class Playback {
  constructor({ debugEl }) {
    this.debugEl = debugEl;
    this.ctx = null;
    this.delay = null;
    this.cache = new Map();
    this.current = null; // { buffer, src, startedAtGlobal, fileId }
    this.speakerDelayMs = 0;
    this.baseOffsetMsFn = () => 0;
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

  setOffsetProvider(fn) { this.baseOffsetMsFn = fn; }
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

  async decodeToBuffer(blobUrl) {
    await this.ensureCtx();
    const t0 = performance.now();
    const ab = await (await fetch(blobUrl)).arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);
    // Optional: log decode time
    // log(this.debugEl, `decode ${((performance.now()-t0)|0)}ms`);
    return buf;
  }

  async ensureDecoded(fileId, blobUrl) {
    if (this.cache.has(fileId)) return this.cache.get(fileId);
    const buf = await this.decodeToBuffer(blobUrl);
    this.cache.set(fileId, buf);
    return buf;
  }

  async loadFromBlobUrl(blobUrl) {
    await this.ensureCtx();
    const resp = await fetch(blobUrl);
    const ab = await resp.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);
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
    // Route through delay node so the slider is audible during playback
    src.connect(this.delay);

    const nowGlobalMs = this.getGlobalNowMs();
    const offsetMs = this.baseOffsetMsFn();
    const localStartMs = globalStartTimeMs + offsetMs; // speaker delay handled by DelayNode
    const delaySec = Math.max(0, (localStartMs - nowGlobalMs) / 1000);
    const when = this.ctx.currentTime + delaySec;

    log(this.debugEl, `Scheduling start in ${Math.max(0, delaySec*1000).toFixed(0)}ms (offset=${offsetMs.toFixed(0)}ms)`);
    src.start(when);

    this.current = { buffer, src, fileId, startedAtGlobal: globalStartTimeMs, scheduledAtLocal: when };
    return when;
  }

  // No-op: we don't adjust playbackRate anymore
  applyGentleCorrection(_errMs) {}
}
