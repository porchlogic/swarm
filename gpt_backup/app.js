// app
/*
A web app that enables peers on separate devices,
to share audio files,
and play them back in sync with each other

Key shifts:
- WebAudio is the scheduling clock
- Global time = offset + skew vs local monotonic time
- Director sends future-dated transport states via WS control channel
- Files fetched via HTTP/cache first; optional P2P later
- Deterministic director election + heartbeats for late joiners
*/


//{ __BOOT

async function main() {
    // 1) wire UI; gate audio init on user gesture (autoplay policy)
    // 2) init audio engine (creates AudioContext)
    // 3) init timing sampler (bind audioContext <-> performance.now())
    // 4) connect control channel (WebSocket)
    // 5) start NTP-style offset+skew sampling loop (via WS pings)
    // 6) join swarm, compute director status deterministically
    // 7) start control heartbeats if director; otherwise listen/apply
    // 8) init media backend (HTTP cache / OPFS; P2P optional later)
}
document.addEventListener('DOMContentLoaded', main);

//}

//{ __CONFIG

var CFG = {
    CTRL_WS_URL: 'wss://example.com/ctrl',
    NTP_SAMPLE_HZ: 2,
    HEARTBEAT_HZ: 3,
    PLAY_LOOKAHEAD_S: 0.2,
    MIN_FUTURE_START_S: 1.5,
    MAX_UPLOADS: 3,
    ALLOW_MIME: ['audio/wav', 'audio/mp3', 'audio/ogg'],
    swarm_KEY_DERIVE_ROUNDS: 100_000
};

//}

//{ __TIMING

// WebAudio-driven timing with offset + skew mapping to a shared "global" time

var audio_ctx = null;

var offset_s = 0; // server_global - mono_t
var skew = 0;     // fractional drift (e.g., 30 ppm => 0.00003)

var audio0_s = 0; // sampled anchors for mapping
var mono0_s = 0;

function init_audio_context() {
    // create/resume AudioContext on a user gesture
    // set audio_ctx
}

function sample_clocks() {
    // periodically sample (audio_ctx.currentTime, performance.now()/1000)
    // update audio0_s and mono0_s
}

function mono_to_global(mono_s) { /* returns mono_s*(1+skew)+offset_s */ }
function global_to_mono(glob_s) { /* inverse of above */ }

function audio_to_global(audio_s) {
    // map audio_t -> mono_t via (audio_s - audio0_s) + mono0_s, then mono_to_global
}
function global_to_audio(glob_s) {
    // inverse mapping: global -> mono -> audio (using anchors)
}

function start_ntp_probe_loop() {
    // push/pull quartets (t0,t1,t2,t3) via control WS
    // robustly update offset_s and skew over time (low-jitter samples)
}

//}

//{ __USER

var user_id = '';
function generate_user_id() {
    // create unique session id (e.g., ULID)
}

var speaker_delay_s = 0; // UI-calibrated output delay in seconds
function set_speaker_delay(ms) {
    // set speaker_delay_s based on UI or click-loopback calibration
}

//}

//{ __SWARM

var swarm_key = '';
var swarm_key_hash = '';   // derived rendezvous id (not the raw key)
var epoch = 0;            // increments on director change
var director = false;

function set_swarm_key(raw) {
    // derive a stable, high-entropy hash from the user-entered key (PBKDF2/Argon2)
    // set swarm_key and swarm_key_hash
}

function elect_director(members) {
    // deterministic tie-break (e.g., lowest hash(user_id + swarm_key_hash))
    // sets director boolean
}

function on_membership_changed(new_members) {
    // recompute director
    // if director changed: bump epoch
}

//}

//{ __CONTROL  (WebSocket control plane; transport & timing live here)

var ctrl_ws = null;
var seq = 0; // monotonically increasing message counter

function connect_to_control_server() {
    // connect to CFG.CTRL_WS_URL
    // subscribe to swarm topic derived from swarm_key_hash
    // handle join/leave and membership updates
}

function start_heartbeats_if_director() {
    // director sends heartbeats at ~HEARTBEAT_HZ with the full state vector
}

function send_state() {
    // director only:
    // publishes state vector {
    //   seq, epoch,
    //   t_global_now,
    //   transport: { playing, startAtGlobal, pausedAtGlobal, bpm, beatPhase },
    //   media: { fileId, duration_s, contentHash },
    //   swarm: { directorId, membersCount }
    // }
}

function receive_state(msg) {
    // non-directors:
    // - ignore if epoch/seq stale
    // - update transport and media targets
    // - when startAtGlobal present, schedule via global->audio mapping (future-dated)
}

function handle_ntp_sample(sample) {
    // receive (t0,t1,t2,t3) from server and pass to timing estimator
}

//}

//{ __MEDIA  (abstracted; HTTP/cache today, P2P can be plugged later)

var files = {}; // { fileId: { status:'idle|downloading|ready|seeding', duration_s, contentHash, source:'http|p2p' } }
var curr_file = '';

function media_init() {
    // set up Cache Storage / OPFS
    // register Service Worker (optional)
}

function upload_file(file) {
    // enforce CFG.MAX_UPLOADS and CFG.ALLOW_MIME
    // compute contentHash
    // store locally; optionally upload to server (HTTP) and/or prep for P2P seeding
    // add to files with status
}

function enable_file(fileId) {
    // ensure local presence (HTTP fetch or P2P), then decode-ready signal to audio engine
}

function fetch_array_buffer(fileId) {
    // provides raw bytes from cache/HTTP/P2P based on availability
}

//}

//{ __P2P  (optional, file plane only; control stays on WS)

function p2p_init_optional() {
    // set up WebTorrent or SimplePeer if/when enabled
    // join swarm keyed by contentHash for each enabled file
}

function start_seeding(fileId) {
    // begin seeding the file when ready (if P2P enabled)
}

//}

//{ __AUDIO  (WebAudio engine; decode + schedule against audio clock)

var playing = false;

function audio_decode(fileId) {
    // decode ArrayBuffer to AudioBuffer
    // cache decoded buffer by fileId
}

function schedule_start_at_global(startAtGlobal_s, fileId) {
    // translate to audio time: startAtAudio = global_to_audio(startAtGlobal_s) - speaker_delay_s
    // if sufficiently in future: create BufferSource, source.start(startAtAudio)
    // else: start ASAP and consider micro-nudge path (playbackRate adjustments)
    // set playing = true; set curr_file
}

function stop_playback() {
    // stop current source; set playing = false
}

function apply_micro_nudge(targetGlobal_s) {
    // gently adjust playbackRate to converge without clicks
}

//}

//{ __TRANSPORT  (user commands -> director messages -> peers schedule)

var transport = {
    bpm: 120,
    beatPhase: 0, // 0..1 position within beat or bar, optional
    playing: false,
    startAtGlobal: 0,
    pausedAtGlobal: 0
};

function director_play(fileId) {
    // choose a FUTURE global start: startAtGlobal = nowGlobal + CFG.MIN_FUTURE_START_S
    // set transport, media fields; send_state()
}

function director_stop() {
    // set playing=false; set pausedAtGlobal = nowGlobal; send_state()
}

function director_seek(globalTarget_s) {
    // update startAtGlobal with FUTURE-dated start aligned to target; send_state()
}

function director_set_bpm(newBpm) {
    // update bpm; include next startAtGlobal (future) so peers rephase; send_state()
}

//}

//{ __UI

function bind_ui() {
    // wire buttons/sliders:
    // - connect/join swarm
    // - upload_file(), enable_file()
    // - play/stop/seek, bpm changes (director only)
    // - set_speaker_delay()
    // - diagnostics: offset/skew, jitter, readiness
}

function render_status() {
    // update DOM with: director?, members, file readiness, clock stats, etc.
}

//}

//{ __HELPERS

function now_global_s() {
    // return current global time estimate using mono_to_global(performance.now()/1000)
}

function set_local_start_time_from_global() {
    // retained for conceptual parity with your original:
    // local start time = global_start_time mapped into audio time minus speaker delay
}

//}
