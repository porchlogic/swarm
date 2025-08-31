// playback.js — global-time scheduling with stateless, bidirectional live correction
import { clamp, log } from "./util.js";

export class Playback {
  constructor({ debugEl }) {
    this.debugEl = debugEl;
    this.ctx = null;
    this.delay = null;

    this.current = null;          // { buffer, src, fileId, startedAtGlobal, scheduledAtLocal, startOffsetSec }
    this._cache = null;

    this._signedDelayMs = 0;      // user-facing delay: can be negative (lead) or positive (lag)
    this.speakerDelayMs = 0;      // non-negative portion actually applied to DelayNode
    this.scheduleAdjustMs = 0;    // non-positive portion used only for *future* scheduling

    this.getGlobalNowMs = () => Date.now();
  }

  setGlobalNowProvider(fn) { this.getGlobalNowMs = fn; }

  async ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.delay = this.ctx.createDelay(3.0);              // a bit of headroom
      this.delay.delayTime.value = 0;
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
      try { this.current.src.stop(0); } catch { }
    }
    this.current = null;
  }

  /**
   * Unified control:
   *  - ms >= 0 : apply to DelayNode (audible lag)
   *  - ms < 0  : lead; DelayNode stays at 0 and we *advance the source offset*
   *
   * Critically, we don't apply deltas. We recompute the *absolute desired state*
   * from global time and jump there. Returning the slider to a previous value
   * returns you to the same alignment.
   */
  setSpeakerDelaySigned(ms) {
    ms = clamp(ms | 0, -2500, 2500);
    this._signedDelayMs = ms;

    // Keep for future starts
    this.scheduleAdjustMs = Math.min(0, ms);

    if (!this.ctx || !this.delay) return;

    // Set the non-negative portion on the DelayNode (smoothly)
    const desiredDelaySec = Math.max(0, ms) / 1000;
    const t = this.ctx.currentTime;
    this.delay.delayTime.cancelScheduledValues(t);
    this.delay.delayTime.setTargetAtTime(desiredDelaySec, t, 0.020);
    this.speakerDelayMs = Math.max(0, ms);

    // If playing, snap/re-cue source to the position implied by global time + lead
    if (this.current?.src) {
      this._applyAbsoluteAlignment();
    }
  }

  /**
   * Compute the desired source offset from first principles and re-cue if needed.
   * desiredOffsetSec = (elapsedGlobalMs + leadMs) / 1000
   * where leadMs = max(0, -signedDelayMs), delayNode = max(0, signedDelayMs).
   */
  _applyAbsoluteAlignment() {
    const c = this.current;
    if (!c || !this.ctx) return;

    const gNow = this.getGlobalNowMs();
    const elapsedGlobalMs = Math.max(0, gNow - (c.startedAtGlobal || 0));
    const leadMs = Math.max(0, -this._signedDelayMs); // only when slider < 0
    const desiredOffsetSec = Math.min(
      Math.max(0, (elapsedGlobalMs + leadMs) / 1000),
      c.buffer.duration - 0.005
    );

    const now = this.ctx.currentTime;
    const currentLocalPosSec = Math.max(0, (now - c.scheduledAtLocal) + (c.startOffsetSec || 0));
    const diffSec = desiredOffsetSec - currentLocalPosSec;

    // Re-cue if we're off by > ~12ms
    if (Math.abs(diffSec) > 0.012) {
      try { c.src.stop(0); } catch { }

      const src = this.ctx.createBufferSource();
      src.buffer = c.buffer;
      src.connect(this.delay);

      // Start just ahead of now to avoid DOMException; no artificial wait
      const when = this.ctx.currentTime + 0.010;
      src.start(when, desiredOffsetSec);

      this.current = {
        buffer: c.buffer,
        src,
        fileId: c.fileId,
        startedAtGlobal: c.startedAtGlobal,
        scheduledAtLocal: when,
        startOffsetSec: desiredOffsetSec
      };

      log(this.debugEl,
        `Re-aligned to ${Math.round(desiredOffsetSec * 1000)}ms ` +
        `(Δ=${Math.round(diffSec * 1000)}ms, delayNode=${this.speakerDelayMs | 0}ms).`);
    }
  }

  start({ buffer, fileId, globalStartTimeMs }) {
    if (!this.ctx || !this.delay) throw new Error("audio context not ready");
    this.stop();

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.delay);

    // For initial scheduling:
    // - Use negative side to start earlier relative to global timeline
    // - Positive side lives on the DelayNode
    const nowGlobalMs = this.getGlobalNowMs();
    const adj = this.scheduleAdjustMs || 0;   // <= 0
    const delaySec = Math.max(0, (globalStartTimeMs + adj - nowGlobalMs) / 1000);
    const when = this.ctx.currentTime + delaySec;

    // Set DelayNode for the non-negative portion
    const desiredDelaySec = Math.max(0, this._signedDelayMs) / 1000;
    const t = this.ctx.currentTime;
    this.delay.delayTime.cancelScheduledValues(t);
    this.delay.delayTime.setTargetAtTime(desiredDelaySec, t, 0.020);
    this.speakerDelayMs = Math.max(0, this._signedDelayMs);

    log(this.debugEl,
      `Scheduling start in ${Math.max(0, delaySec * 1000) | 0}ms ` +
      `(adj: ${adj | 0}ms, delayNode: ${this.speakerDelayMs | 0}ms)`);

    // Start at buffer offset 0; after start we can always re-align absolutely if user moves the slider
    src.start(when /* offset=0 */);

    this.current = {
      buffer,
      src,
      fileId,
      startedAtGlobal: globalStartTimeMs,
      scheduledAtLocal: when,
      startOffsetSec: 0
    };
    return when;
  }

  // Back-compat no-ops that delegate to unified setter
  setSpeakerDelay(ms) { this.setSpeakerDelaySigned(ms); }
  setScheduleAdjust(ms) { this.setSpeakerDelaySigned(ms); }

  applyGentleCorrection(_) { }
}
