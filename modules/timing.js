
// NTP-style offset estimator with smoothing and drift detection.
import { clamp } from "./util.js";

export class OffsetEstimator {
  constructor({ maxSamples = 40, ignoreDriftLtMs = 12, correctIfGtMs = 30 } = {}) {
    this.samples = [];  // {offsetMs, rttMs, ts}
    this.maxSamples = maxSamples;
    this.ignoreDriftLtMs = ignoreDriftLtMs;
    this.correctIfGtMs = correctIfGtMs;
    this.baseLocked = false;
    this.baseOffsetMs = 0;
    this._lastEstimate = 0;
  }

  // On timePong: t0 (client send), tS (server), t1 (client recv)
  addSample(t0, tS, t1) {
    const rtt = t1 - t0;
    const offset = tS - (t0 + rtt/2);
    this.samples.push({ offsetMs: offset, rttMs: rtt, ts: performance.now() });
    if (this.samples.length > this.maxSamples) this.samples.shift();
    this._lastEstimate = this.robustEstimate();
    if (!this.baseLocked) this.baseOffsetMs = this._lastEstimate;
  }

  robustEstimate() {
    // Weighted median-ish: prefer low RTT
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a,b)=>a.rttMs - b.rttMs).slice(0, Math.max(5, Math.floor(this.samples.length*0.6)));
    const offsets = sorted.map(s=>s.offsetMs).sort((a,b)=>a-b);
    const mid = Math.floor(offsets.length/2);
    const est = offsets[mid];
    return est;
  }

  lockBase() { this.baseLocked = true; this.baseOffsetMs = this._lastEstimate; }
  unlockBase() { this.baseLocked = false; }

  currentOffsetMs() { return this.baseLocked ? this.baseOffsetMs : this._lastEstimate; }

  // Returns a recommended gentle correction in ms/s, or 0 if none.
  correctionRateMsPerSec() {
    const err = this._lastEstimate - this.baseOffsetMs;
    const absErr = Math.abs(err);
    if (absErr < this.ignoreDriftLtMs) return 0;
    if (absErr < this.correctIfGtMs) return 0;
    // Slew toward estimate, capped 1-2ms/s
    const sign = Math.sign(err);
    return clamp( (absErr/10) * sign, -2.0, 2.0 ); // simple P controller
  }

  applySlew(dtSec) {
    const rate = this.correctionRateMsPerSec();
    if (rate !== 0) {
      this.baseOffsetMs += rate * dtSec;
    }
    return rate;
  }
}
