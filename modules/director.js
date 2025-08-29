
// Director election + control propagation
import { log } from "./util.js";

export class Director {
  constructor({ control, debugEl }) {
    this.control = control;
    this.debugEl = debugEl;
    this.isDirector = false;
    this.currentDirectorId = null;
    this.peers = []; // [{userId}...]
  }

  updatePeers(peers) {
    this.peers = peers;
    const leader = peers.length ? peers[0].userId : this.control.userId;
    this.currentDirectorId = leader;
    const shouldLead = (leader === this.control.userId);
    if (shouldLead !== this.isDirector) {
      this.isDirector = shouldLead;
      log(this.debugEl, this.isDirector ? "Became director" : "Not director");
      this.control.send("director:assert", { userId: this.control.userId, isDirector: this.isDirector });
    }
  }

  take() {
    // Deterministic scheme is lowest ID; a manual take broadcasts intent
    this.currentDirectorId = this.control.userId;
    this.isDirector = true;
    this.control.send("director:take", { userId: this.control.userId });
  }

  resign() {
    this.isDirector = false;
    this.control.send("director:resign", { userId: this.control.userId });
  }
}
