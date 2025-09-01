
// Minimal control + clock server (no audio storage).
// - WebSocket for swarm control + presence + signaling + time-ping.
// - Optional static hosting of the SPA from ../client (OK for MVP).
//
// Security: Run this behind HTTPS (TLS) in production so `wss://` works in browsers.
//
// Usage:
//   cd server && npm install && npm run start
//   Visit http://localhost:8080 (or serve client separately).
//
import express from "express";
import http from "http";
import cors from "cors";
import morgan from "morgan";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Serve the client SPA (optional; you can also host it elsewhere as a static site)
const clientDir = path.resolve(__dirname, "../client");
app.use(express.static(clientDir));

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

// In-memory swarm state (ephemeral)
/**
 * swarms: {
 *   [swarmHash]: {
 *     clients: Set<WebSocket>,
 *     users: Map<WebSocket, { userId, swarmHash, lastSeen: number }>
 *   }
 * }
 */
const swarms = new Map();

function nowMs() {
    return Date.now();
}

function safeSend(ws, obj) {
    try {
        ws.send(JSON.stringify(obj));
    } catch (e) {
        // ignore
    }
}

function broadcastToSwarm(swarmHash, payload, exceptWs = null) {
    const s = swarms.get(swarmHash);
    if (!s) return;
    for (const ws of s.clients) {
        if (ws !== exceptWs && ws.readyState === ws.OPEN) {
            safeSend(ws, payload);
        }
    }
}

function getPeerList(swarmHash) {
    const s = swarms.get(swarmHash);
    if (!s) return [];
    const list = [];
    for (const [ws, meta] of s.users.entries()) {
        if (ws.readyState === ws.OPEN) {
            list.push({ userId: meta.userId, lastSeen: meta.lastSeen });
        }
    }
    // sort by userId for deterministic ordering
    list.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    return list;
}

function ensureSwarm(swarmHash) {
    if (!swarms.has(swarmHash)) {
        swarms.set(swarmHash, { clients: new Set(), users: new Map() });
    }
    return swarms.get(swarmHash);
}

wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.meta = { userId: null, swarmHash: null };

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("message", (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) {
            return;
        }

        // Universal time-ping/clock service (no auth needed)
        if (msg.type === "timePing") {
            // Echo back with server time; include the client t0 echo for RTT calc
            safeSend(ws, { type: "timePong", t0: msg.t0, tS: nowMs() });
            return;
        }

        // Join swarm (namespace)
        if (msg.type === "join" && msg.swarmHash && msg.userId) {
            const swarm = ensureSwarm(msg.swarmHash);
            swarm.clients.add(ws);
            swarm.users.set(ws, { userId: msg.userId, swarmHash: msg.swarmHash, lastSeen: nowMs() });
            ws.meta.userId = msg.userId;
            ws.meta.swarmHash = msg.swarmHash;

            // Ack + peer list
            safeSend(ws, { type: "joined", swarmHash: msg.swarmHash, userId: msg.userId, peers: getPeerList(msg.swarmHash) });

            // Broadcast new presence
            broadcastToSwarm(msg.swarmHash, { type: "presence", userId: msg.userId, action: "join" }, ws);
            // Send updated peer list to everyone
            const peers = getPeerList(msg.swarmHash);
            broadcastToSwarm(msg.swarmHash, { type: "peers", peers });
            return;
        }

        // Heartbeat presence
        if (msg.type === "heartbeat") {
            const s = swarms.get(ws.meta.swarmHash);
            if (s && s.users.has(ws)) {
                const meta = s.users.get(ws);
                meta.lastSeen = nowMs();
            }
            // optionally bounce back
            return;
        }

        // Relay control/signaling messages within swarm namespace only
        const swarmHash = ws.meta?.swarmHash;
        if (!swarmHash) return;

        // Sanitize: Never accept/relay file content (we don't anyway).
        // Allowed types: director, control, file:announce, rtc:signal, play/stop/select etc.
        const allowed = new Set([
            "rtc:signal",
            "director:assert",
            "director:take",
            "director:resign",
            "control:state",
            "file:announce",
            "file:revoke",
            "play",
            "stop",
            "selectFile",
            "status",
            "custom"
        ]);
        if (allowed.has(msg.type)) {
            // Attach server relay timestamp for debugging
            msg.relayTs = nowMs();
            broadcastToSwarm(swarmHash, msg, ws);
        }
    });

    ws.on("close", () => {
        const swarmHash = ws.meta?.swarmHash;
        const userId = ws.meta?.userId;
        if (swarmHash && swarms.has(swarmHash)) {
            const s = swarms.get(swarmHash);
            s.clients.delete(ws);
            s.users.delete(ws);

            // Notify others
            broadcastToSwarm(swarmHash, { type: "presence", userId, action: "leave" });

            // Update peer list
            const peers = getPeerList(swarmHash);
            broadcastToSwarm(swarmHash, { type: "peers", peers });

            if (s.clients.size === 0) {
                swarms.delete(swarmHash); // Ephemeral
            }
        }
    });
});

// Liveness ping for ws
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.on("close", function close() {
    clearInterval(interval);
});

server.listen(PORT, () => {
    console.log(`Control+Clock server running on http://localhost:${PORT}`);
    console.log(`Serving client from: ${clientDir}`);
});
