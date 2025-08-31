// Director election + control propagation (explicit & sticky)
import { log } from "./util.js";

export class Director {
  constructor({ control, debugEl }) {
    this.control = control;
    this.debugEl = debugEl;

    this.isDirector = false;
    this.currentDirectorId = null;
    this.peers = []; // [{userId}...]
    this._joinedAt = Date.now(); // tie-breaker if you ever need it
  }

  /** Set the known director explicitly (from network messages). */
  setDirector(userId) {
    this.currentDirectorId = userId || null;
    const wasDirector = this.isDirector;
    this.isDirector = !!userId && userId === this.control.userId;
    if (this.isDirector !== wasDirector) {
      log(this.debugEl, this.isDirector ? "Became director" : "Not director");
    }
  }

  /** Update peer list; if the known director is gone, clear it. */
  updatePeers(peers) {
    this.peers = peers;
    if (this.currentDirectorId) {
      const stillThere = peers.some(p => p.userId === this.currentDirectorId);
      if (!stillThere) this.setDirector(null); // vacancy
    }
  }

  /** Called by the FIRST creator in an empty swarm to assert leadership. */
  assertInitialIfAlone() {
    const onlyMe = this.peers.length === 0 || (this.peers.length === 1 && this.peers[0].userId === this.control.userId);
    if (!this.currentDirectorId && onlyMe) {
      this.setDirector(this.control.userId);
      this.control.send("director:assert", { userId: this.control.userId, isDirector: true });
    }
  }

  /** User clicked "take over as director" when vacancy exists. */
  take() {
    this.setDirector(this.control.userId); // optimistic local set
    this.control.send("director:take", { userId: this.control.userId });
    // Also broadcast assert to converge quickly
    this.control.send("director:assert", { userId: this.control.userId, isDirector: true });
  }

  resign() {
    if (!this.isDirector) return;
    this.setDirector(null);
    this.control.send("director:resign", { userId: this.control.userId });
  }
}
