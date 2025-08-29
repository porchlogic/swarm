// app
/*
A web app that enables peers on separate devices,
to share audio files with each other,
and play them back in sync with each other.

Goals:
- Keep code simple, single static JS file if possible.
- P2P for file sharing (WebTorrent). We do NOT store the files server-side.
- Optional WebSocket backchannel for small control messages (state, presence).
- Ephemeral swarms keyed by a simple "room key" string.
- Mobile-first MVP (phones).
- Use WebAudio for scheduling.

This file defines the overall architecture and top-level logic.
No internal logic is implemented yet—just function stubs and flow.
*/


//{ __CONFIG

const CFG = {
    // p2p
    use_webtorrent: true,
    max_upload_files: 3,

    // control channel (optional)
    use_websocket_control: true,

    // networking (placeholders)
    ws_url: "wss://your-control-server.example/ws",
    stun_turn: [
        // optional ICE servers if you self-host trackers/STUN/TURN later
        // { urls: "stun:stun.l.google.com:19302" }
    ],

    // scheduling
    clock_sync_interval_ms: 5_000, // how often we NTP-ping the server
    control_heartbeat_ms: 5_000,    // how often we announce presence / keepalive
    ui_speaker_delay_min_ms: 0,
    ui_speaker_delay_max_ms: 500,

    // performance / mobile
    mobile_target_sample_rate: 44100
};

//}


//{ __STATE

// note: these are simple primitives on purpose, so you can reason about them easily
let app_ready = false;
let connection_ready = false;

let user_id = "";               // generated per session
let room_key = "";              // plain text input from user
let room_key_hash = "";         // hashed version used for swarm namespace
let director = false;           // true if we’re currently the "director" for this room
let peer_count = 0;             // peers currently connected (best-effort estimate)

let global_clock_local_offset = 0; // ms: offset from server's clock (server - local)
let speaker_delay = 0;             // ms: user-set compensation for device/speaker lag

let global_start_time = 0;      // "director" source of truth (ms, server-clock space)
let local_start_time = 0;       // derived from global + offset - speaker_delay

let playing = false;
let curr_file = "";             // file id or infohash (simple string id by design)

let files = {};                 // { fileId: { name, size, seeds, is_seeding, is_enabled, progress } }

// subsystems
let ws = null;                  // WebSocket instance (control messages)
let wt = null;                  // WebTorrent instance (file transport)
let audio_ctx = null;           // WebAudio context

//}


//{ __LIFECYCLE

function init_app() {
    // 1) Create user id, bind UI, set defaults
    generate_user_id();
    bind_ui();
    load_settings();

    // 2) Prepare audio context (not resuming/starting yet)
    init_audio();

    // 3) Optionally connect to control server, start clock sync
    if (CFG.use_websocket_control) connect_to_server();

    // 4) Optionally set up WebTorrent client (no swarm join until room_key set)
    if (CFG.use_webtorrent) init_p2p_client();

    // 5) App is ready for the user to enter a room key and join
    app_ready = true;
    show_status("ready");
}

function teardown_app() {
    // cleanly leave room, stop intervals, close sockets, stop audio, etc.
    leave_room();
    close_server_connection();
    close_p2p_client();
    stop_clock_sync();
    save_settings();
    show_status("stopped");
}

function handle_visibility_change() {
    // pause/low-power behaviors on mobile if needed
    // keep connections alive if practical
}

//}


//{ __UI

function bind_ui() {
    // connect UI elements to functions:
    // - input for room key -> set_room_key()
    // - join/leave buttons -> join_room()/leave_room()
    // - upload button -> upload_file()
    // - enable file button -> enable_file()
    // - play/stop buttons -> play_file()/stop_file()
    // - speaker delay slider -> set_speaker_delay()
    // - "take director" / "resign director" buttons -> become_director()/resign_director()
    // - current status labels -> show_status()
}

function show_status(what) {
    // simple status text updates to the UI
}

function confirm_mobile_warnings() {
    // gently warn if not on Wi-Fi, battery low, etc.
}

//}


//{ __TIMING  (clock sync + local time derivation)

function start_clock_sync() {
    // start a repeating NTP-style ping (via ws if available)
    // updates global_clock_local_offset periodically
    //todo I think we don't want global_clock_local_offset to change during playback,
        // so maybe only allow this to run when not playing? not sure...
}

function stop_clock_sync() {
    // stop repeating clock sync
}

function get_global_clock_local_offset() {
    // performs one NTP-style round-trip ping using control channel
    // sets global_clock_local_offset
}

function set_speaker_delay(ms) {
    // clamp to CFG.ui_speaker_delay_min_ms..CFG.ui_speaker_delay_max_ms
    // set speaker_delay
    // then re-derive local start time if playing
    if (playing) set_local_start_time();
}

function set_local_start_time() {
    // local time in ms for scheduling
    // derived from global_start_time + global_clock_local_offset - speaker_delay
    // does not start/stop audio; just updates the reference for scheduling
    local_start_time = (global_start_time + global_clock_local_offset) - speaker_delay;
}

//}


//{ __USER

function generate_user_id() {
    // auto-generates a unique user id for the session (non-identifying, ephemeral)
}

//}


//{ __NETWORK_CONTROL  (optional websocket control path)

function connect_to_server() {
    // connects to our private websockets server (control, presence, clock sync)
    // on open: start_clock_sync(), send presence
    // on message: ws_on_message()
    // on close/error: retry with backoff
}

function close_server_connection() {
    // close ws; stop heartbeats
}

function ws_send(obj) {
    // stringify and send control messages if ws is open
}

function ws_on_message(msg) {
    // parse payload
    // handle: presence updates, director change, state updates, clock replies
    // forward to receive_state() when applicable
}

function send_presence() {
    // periodically announce to room: { user_id, director, enabled_files, current_status }
}

//}


//{ __P2P  (WebTorrent setup + swarm management)

function init_p2p_client() {
    // create a WebTorrent client
    // (do not join swarm yet; wait for room_key_hash)
}

function close_p2p_client() {
    // destroy WebTorrent client and cleanup
}

function set_room_key(input_str) {
    // takes secret key string entered into the UI
    // sanitizes + hashes to room_key_hash
    // stores both room_key and room_key_hash (hash used for torrent swarm/topic)
}

function join_room() {
    // joins the control channel room (if ws)
    // joins the torrent swarm for room_key_hash
    // if no other peers, become director (optimistic)
    // start presence heartbeat
}

function leave_room() {
    // leave torrent swarm, stop seeding/downloading
    // notify peers (control channel) that we're gone
    // clear room-scoped state (playing, curr_file, files, director)
}

function connect_to_peers() {
    // uses WebTorrent to discover peers on the same room_key_hash
    // updates peer_count
    // may open a "metadata/control" topic/file if needed for signaling fallback
}

function broadcast_control_p2p(obj) {
    // best-effort small control messages via p2p (if feasible)
    // if not feasible/reliable, rely on ws_send()
}

//}


//{ __FILES  (upload/enable/list/evict)

function list_files() {
    // show files available in the swarm (from metadata/torrents)
    // update files{}
}

function upload_file() {
    // user picks a file
    // if below CFG.max_upload_files, add to swarm and start seeding
    // record in files{} with is_seeding = true
}

function enable_file(file_id) {
    // enable/downloading a selected file from peers (starts seeding after download)
    // mark files[file_id].is_enabled = true
    // if director wants to play it, they can choose it as curr_file
}

function remove_file(file_id) {
    // stop seeding/downloading this file
    // update files{}
}

//}


//{ __PLAYBACK  (webaudio skeleton)

function init_audio() {
    // create AudioContext (mobile friendly)
    // set desired sample rate if possible (advisory)
    // prep simple mixer nodes (gain, destination)
}

function prepare_file_for_playback(file_id) {
    // fetch/stream/convert the chosen file to a decoded buffer or media element
    // do NOT schedule here—just ensure it's ready
}

function play_file(file_id) {
    // if we are the director:
    // 1) set curr_file
    // 2) set global_start_time = now_in_server_space()
    // 3) set playing = true
    // 4) send_state({ playing, global_start_time, curr_file })

    // local side: set_local_start_time() and schedule based on audio_ctx.currentTime
}

function stop_file() {
    // if we are the director:
    // 1) set playing = false
    // 2) send_state({ playing: false })

    // local side: stop scheduled audio
}

function reschedule_after_tempo_or_offset_change() {
    // when speaker_delay or global_clock_local_offset changes, or drift correction needed
    // re-align schedule without hard-stopping audio if possible
}

function now_in_server_space() {
    // returns an estimate of "server now" in ms: performance.now() + global_clock_local_offset
}

//}


//{ __STATE_SYNC  (director-driven state; everyone else follows)

function send_state(partial) {
    // directors call this to broadcast authoritative transport state to peers
    // payload may include:
    // - playing (bool)
    // - global_start_time (ms, server space)
    // - curr_file (string id)
    // - optional tempo, loop, position, etc. (future)
    // try p2p first if reliable; fallback to ws
}

function receive_state(msg) {
    // apply authoritative state from director
    // if msg.global_start_time present:
    //   global_start_time = msg.global_start_time; set_local_start_time();
    // update playing, curr_file, etc., then reconcile local schedule
}

//}


//{ __DIRECTOR  (simple leadership rules)

function elect_director_if_needed() {
    // if no director is known and we have peers, choose a stable rule:
    // e.g., lowest user_id wins (deterministic), else self if alone
    // then call become_director() or await anointed peer
}

function become_director() {
    // set director = true
    // announce via control channel
    // start sending state heartbeats (to reaffirm leadership)
}

function resign_director() {
    // set director = false
    // announce resignation
    // stop sending state heartbeats
}

function handle_director_change(new_director_id) {
    // update local knowledge of who is director
    // if we were director but changed, stop leadership duties
    // if we are the new director, start leadership duties
}

//}


//{ __ERRORS_AND_LOGS

function log(...args) {
    // console logging wrapper (can toggle verbosity)
}

function warn(...args) {
    // warnings
}

function on_unhandled_error(e) {
    // global error handler (optional)
}

//}


//{ __PERSISTENCE

function save_settings() {
    // store speaker_delay, last room_key (optional), simple prefs in localStorage
}

function load_settings() {
    // load stored settings; set UI accordingly
}

//}


//{ __FALLBACKS_AND_FUTURE

function fallback_to_ws_for_control_if_needed() {
    // if p2p control messages are unreliable, enforce ws for control
}

function maybe_add_turn_servers_later() {
    // if connectivity is poor, consider TURN hosting (still file-opaque)
}

//}


//{ __APP_BOOT

window.addEventListener("load", init_app);
document.addEventListener("visibilitychange", handle_visibility_change);
window.addEventListener("error", on_unhandled_error);

//}
