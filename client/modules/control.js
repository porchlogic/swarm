
// WebSocket control channel: presence, director state, time ping, signaling relay.
import { log, nanoid } from "./util.js";

export class ControlChannel {
  constructor({ url, swarmHash, userId, debugEl }) {
    this.url = url;
    this.swarmHash = swarmHash;
    this.userId = userId || nanoid();
    this.debugEl = debugEl;
    this.ws = null;
    this.handlers = new Map(); // type => [fn]
    this.heartbeatInt = null;
    this.timePingInt = null;
    this.connected = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  _emit(type, payload) {
    if (this.handlers.has(type)) {
      for (const fn of this.handlers.get(type)) {
        fn(payload);
      }
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url.replace(/^http/, "ws"));
      this.ws.onopen = () => {
        this.connected = true;
        this._send({ type: "join", swarmHash: this.swarmHash, userId: this.userId });
        // heartbeat
        this.heartbeatInt = setInterval(() => this._send({ type: "heartbeat", ts: Date.now() }), 15000);
        resolve();
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this._emit(msg.type, msg);
        } catch (e) {
          log(this.debugEl, "bad message", e);
        }
      };
      this.ws.onclose = () => {
        this.connected = false;
        if (this.heartbeatInt) clearInterval(this.heartbeatInt);
        if (this.timePingInt) clearInterval(this.timePingInt);
        this._emit("close", {});
      };
      this.ws.onerror = (e) => {
        log(this.debugEl, "ws error", String(e));
      };
    });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  send(type, data) {
    this._send({ type, ...data });
  }

  // Clock pings: call this before playback at ~5Hz, during playback at 1-2Hz.
  startClockPings(hz = 5) {
    if (this.timePingInt) clearInterval(this.timePingInt);
    const period = Math.max(50, Math.floor(1000 / hz));
    this.timePingInt = setInterval(() => {
      const t0 = Date.now();
      this._send({ type: "timePing", t0 });
    }, period);
  }

  stopClockPings() {
    if (this.timePingInt) clearInterval(this.timePingInt);
    this.timePingInt = null;
  }
}
