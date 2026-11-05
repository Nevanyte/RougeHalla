//! One scripted client: connects (ws or wss), says Hello with a callsign and its ticket, reads Welcome and snapshots,
//! sends human-cadence input frames and pings, and measures what it sees. Roles add the scenario behaviours: dropping the socket
//! and resuming with the session token, not reading (a slow consumer), and joining then leaving a lobby (churn).
//! The client reimplements nothing of the game: it sends inputs and reads snapshots and results.

use crate::script::{view_of, Brain, Floors, Rng, View};
use crate::shared::Shared;
use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg, SnapshotTracker, WireEvent, PROTOCOL_VERSION};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpSocket, TcpStream};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub const WELCOME_TIMEOUT: Duration = Duration::from_secs(15);
pub const SEND_TIMEOUT: Duration = Duration::from_secs(5);
/// Clients ping at least every second (the server drops a silent connection after 10 s).
pub const PING_EVERY: Duration = Duration::from_secs(1);
/// Ping cadence while stalled (25/s: inside the server's 60 frames/s allowance).
pub const STALL_PING_EVERY: Duration = Duration::from_millis(40);
/// How long a slow consumer reads again after its stall before the outcome is judged.
pub const SLOW_RECOVERY_READ: Duration = Duration::from_secs(10);
/// A slow consumer's receive buffer (the OS rounds it up): small, so the server's writes back up quickly.
pub const SLOW_RCVBUF: u32 = 2048;

#[derive(Clone, Debug)]
pub struct Player {
    pub idx: usize,
    pub name: String,
    pub ticket: Vec<u8>,
    pub role: Role,
    pub seed: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Role {
    Normal {
        reconnector: bool,
        slow: bool,
    },
    /// Joins a lobby, lingers `dwell`, Leaves, repeats.
    Churn,
    /// One admission attempt, no play (shutdown probe).
    Probe,
}

/// How one play session ended.
#[derive(Clone, Debug, PartialEq)]
pub enum End {
    /// The player's own result arrived (it left), or the churn dwell ended and it Left.
    Done,
    /// This client stopped because the run ended.
    Stopped,
    /// Refused at admission with this reject code name.
    Refused(String),
    /// Refused with ServerDraining: the server is shutting down.
    Draining,
    /// The server closed the session after Welcome (reject code name) or the socket died ("closed").
    Closed(String),
    /// Slow-consumer outcome label.
    Slow(String),
    /// Could not connect or protocol error.
    Failed(String),
}

pub struct Conn {
    ws: Ws,
    tracker: SnapshotTracker,
    session: [u8; 16],
    welcome_at: Instant,
    first_snapshot: bool,
    last_snapshot: Option<(Instant, u32)>,
    view: View,
    floors: Arc<Floors>,
    bytes_in: u64,
    bytes_out: u64,
    opened: Instant,
    sh: Arc<Shared>,
}

impl Drop for Conn {
    fn drop(&mut self) {
        self.sh.c.connected_now.fetch_sub(1, Relaxed);
    }
}

fn code_name(c: RejectCode) -> String {
    format!("{c:?}")
}

pub async fn connect_ws(sh: &Shared, recv_buffer: Option<u32>) -> Result<Ws, String> {
    let addr: std::net::SocketAddr = sh
        .target
        .host_port
        .parse()
        .map_err(|_| "bad target address".to_string())?;
    let sock = if addr.is_ipv4() {
        TcpSocket::new_v4()
    } else {
        TcpSocket::new_v6()
    }
    .map_err(|e| format!("socket: {e}"))?;
    let _ = sock.set_nodelay(true);
    if let Some(b) = recv_buffer {
        let _ = sock.set_recv_buffer_size(b);
    }
    let stream = tokio::time::timeout(WELCOME_TIMEOUT, sock.connect(addr))
        .await
        .map_err(|_| "tcp connect timeout".to_string())?
        .map_err(|e| format!("tcp connect: {:?}", e.kind()))?;
    let (ws, _) = tokio::time::timeout(
        WELCOME_TIMEOUT,
        tokio_tungstenite::client_async_tls_with_config(
            sh.target.ws_url.as_str(),
            stream,
            None,
            sh.target.connector.clone(),
        ),
    )
    .await
    .map_err(|_| "ws handshake timeout".to_string())?
    .map_err(|e| format!("ws handshake: {}", short_err(&e.to_string())))?;
    Ok(ws)
}

fn short_err(s: &str) -> String {
    s.chars().take(60).collect()
}

async fn send(ws: &mut Ws, msg: &ClientMsg) -> Result<usize, ()> {
    let frame = msg.encode();
    let n = frame.len();
    match tokio::time::timeout(SEND_TIMEOUT, ws.send(Message::Binary(frame.into()))).await {
        Ok(Ok(())) => Ok(n),
        _ => Err(()),
    }
}

/// Connect, Hello (fresh, or a resume with `resume`), read Welcome. Records connect and admission latencies and refusals.
pub async fn open(
    sh: &Arc<Shared>,
    p: &Player,
    resume: Option<[u8; 16]>,
    recv_buffer: Option<u32>,
) -> Result<Conn, End> {
    sh.bump(|c| &c.connect_attempts);
    let t0 = Instant::now();
    let mut ws = match connect_ws(sh, recv_buffer).await {
        Ok(w) => w,
        Err(e) => {
            sh.bump(|c| &c.connect_errors);
            sh.count_map(|l| &mut l.errors, &format!("connect: {e}"));
            return Err(End::Failed(e));
        }
    };
    let connected = Instant::now();
    sh.push(|l| l.connect_ms.push((connected - t0).as_secs_f64() * 1000.0));
    let hello = ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: sh.content_hash,
        build: "rh-load".into(),
        profile: p.name.clone(),
        ticket: p.ticket.clone(),
        faction: None,
        resume,
    };
    let Ok(sent) = send(&mut ws, &hello).await else {
        sh.count_map(|l| &mut l.errors, "hello send failed");
        return Err(End::Failed("hello send".into()));
    };
    let hello_at = Instant::now();
    let mut tracker = SnapshotTracker::new();
    let deadline = hello_at + WELCOME_TIMEOUT;
    let (session, floors) = loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, ws.next()).await {
            Ok(Some(Ok(Message::Binary(b)))) => match tracker.decode(&b) {
                Ok(ServerMsg::Welcome { session, map, .. }) => {
                    let floors =
                        sh.floors_for(map.layer_hash, || Floors::from_map(map.w, &map.tiles));
                    sh.c.bytes_in.fetch_add(b.len() as u64, Relaxed);
                    break (session, floors);
                }
                Ok(ServerMsg::Reject { code, .. }) => {
                    let name = code_name(code);
                    sh.bump(|c| &c.rejected_total);
                    sh.count_map(|l| &mut l.refusals, &name);
                    if sh.triggered() {
                        sh.count_map(|l| &mut l.post_refusals, &name);
                    }
                    return Err(if code == RejectCode::ServerDraining {
                        End::Draining
                    } else {
                        End::Refused(name)
                    });
                }
                Ok(_) => continue,
                Err(_) => {
                    sh.bump(|c| &c.decode_errors);
                    return Err(End::Failed("decode".into()));
                }
            },
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(_))) | Ok(None) => {
                sh.count_map(|l| &mut l.errors, "closed before welcome");
                return Err(End::Closed("closed before welcome".into()));
            }
            Err(_) => {
                sh.count_map(|l| &mut l.errors, "welcome timeout");
                return Err(End::Failed("welcome timeout".into()));
            }
        }
    };
    let now = Instant::now();
    let ms = (now - hello_at).as_secs_f64() * 1000.0;
    if resume.is_some() {
        sh.bump(|c| &c.welcomes_resume);
        if sh.triggered() {
            sh.bump(|c| &c.post_resume_welcomes);
        }
        sh.push(|l| l.resume_hello_to_welcome_ms.push(ms));
    } else {
        sh.bump(|c| &c.welcomes_fresh);
        if sh.triggered() {
            sh.bump(|c| &c.post_fresh_welcomes);
        }
        sh.push(|l| l.hello_to_welcome_ms.push(ms));
    }
    sh.c.bytes_out.fetch_add(sent as u64, Relaxed);
    sh.c.connected_now.fetch_add(1, Relaxed);
    Ok(Conn {
        ws,
        tracker,
        session,
        welcome_at: now,
        first_snapshot: false,
        last_snapshot: None,
        view: View::default(),
        floors,
        bytes_in: 0,
        bytes_out: sent as u64,
        opened: t0,
        sh: sh.clone(),
    })
}

enum Drive {
    Reconnect,
    Over(End),
}

struct Mind {
    brain: Brain,
    rng: Rng,
    seq: u32,
    started: Instant,
}

impl Conn {
    async fn send(&mut self, m: &ClientMsg) -> bool {
        match send(&mut self.ws, m).await {
            Ok(n) => {
                self.bytes_out += n as u64;
                self.sh.c.bytes_out.fetch_add(n as u64, Relaxed);
                true
            }
            Err(()) => false,
        }
    }

    fn on_snapshot(&mut self, tick: u32) {
        let now = Instant::now();
        let sh = &self.sh;
        if !self.first_snapshot {
            self.first_snapshot = true;
            let ms = (now - self.welcome_at).as_secs_f64() * 1000.0;
            sh.push(|l| l.welcome_to_first_snapshot_ms.push(ms));
        }
        sh.c.snapshots.fetch_add(1, Relaxed);
        if let Some((t, last_tick)) = self.last_snapshot {
            if sh.measuring.load(Relaxed) {
                let dt = (now - t).as_secs_f64() * 1000.0;
                sh.snapshot_interval_ms.record(dt);
                if dt > 100.0 {
                    sh.c.late_snapshots_100ms.fetch_add(1, Relaxed);
                }
                if dt > 200.0 {
                    sh.c.late_snapshots_200ms.fetch_add(1, Relaxed);
                }
                if dt > 500.0 {
                    sh.c.late_snapshots_500ms.fetch_add(1, Relaxed);
                }
                if tick > last_tick + 1 {
                    sh.c.ticks_missed
                        .fetch_add(u64::from(tick - last_tick - 1), Relaxed);
                }
            }
        }
        self.last_snapshot = Some((now, tick));
    }

    /// Handles one server message; `Some(end)` when the session is over.
    fn on_message(&mut self, m: ServerMsg) -> Option<End> {
        match m {
            ServerMsg::Snapshot {
                tick,
                phase,
                me,
                actors,
                ..
            } => {
                self.view = view_of(me.as_ref(), &actors, phase);
                self.on_snapshot(tick);
                None
            }
            ServerMsg::Events { events, .. } => {
                if events.iter().any(|e| matches!(e, WireEvent::Result(_))) {
                    self.sh.bump(|c| &c.results);
                    if self.sh.triggered() {
                        self.sh.bump(|c| &c.post_results);
                    }
                    return Some(End::Done);
                }
                None
            }
            ServerMsg::Reject { code, .. } => Some(End::Closed(code_name(code))),
            _ => None,
        }
    }

    async fn read(&mut self) -> Result<Option<ServerMsg>, End> {
        match self.ws.next().await {
            Some(Ok(Message::Binary(b))) => {
                self.bytes_in += b.len() as u64;
                self.sh.c.bytes_in.fetch_add(b.len() as u64, Relaxed);
                self.sh.c.frames_in.fetch_add(1, Relaxed);
                match self.tracker.decode(&b) {
                    Ok(m) => Ok(Some(m)),
                    Err(_) => {
                        self.sh.bump(|c| &c.decode_errors);
                        Err(End::Failed("decode".into()))
                    }
                }
            }
            Some(Ok(_)) => Ok(None),
            Some(Err(_)) | None => Err(End::Closed("closed".into())),
        }
    }

    async fn leave(&mut self) {
        let _ = self.send(&ClientMsg::Leave).await;
        let _ = tokio::time::timeout(Duration::from_millis(500), self.ws.close(None)).await;
    }
}

fn far() -> Instant {
    Instant::now() + Duration::from_secs(86_400 * 30)
}

fn jitter_think(rng: &mut Rng, think_ms: u64) -> Duration {
    let lo = (think_ms as f64 * 0.5) as u64;
    let hi = (think_ms as f64 * 1.5) as u64;
    Duration::from_millis(rng.range_u64(lo, hi.max(lo)))
}

async fn drive(
    sh: &Arc<Shared>,
    p: &Player,
    conn: &mut Conn,
    mind: &mut Mind,
    slow_done: &mut bool,
) -> Drive {
    let (reconnector, slow) = match p.role {
        Role::Normal { reconnector, slow } => (reconnector, slow),
        _ => (false, false),
    };
    let scripted = matches!(p.role, Role::Normal { .. });
    let now = Instant::now();
    let mut next_input = now + jitter_think(&mut mind.rng, sh.sc.think_ms);
    let mut next_ping = now + PING_EVERY;
    let reconnect_at = reconnector.then(|| {
        now + Duration::from_secs_f64(mind.rng.range_f64(0.3, 1.7) * sh.sc.reconnect_every_secs)
    });
    let leave_at = matches!(p.role, Role::Churn).then(|| {
        let (lo, hi) = sh.sc.churn_dwell_secs;
        now + Duration::from_secs_f64(mind.rng.range_f64(lo, hi))
    });
    let slow_at =
        (slow && !*slow_done).then(|| now + Duration::from_millis(mind.rng.range_u64(1500, 3000)));
    loop {
        if sh.stopped() {
            conn.leave().await;
            return Drive::Over(End::Stopped);
        }
        let wake = [
            next_input,
            next_ping,
            reconnect_at.unwrap_or_else(far),
            leave_at.unwrap_or_else(far),
            slow_at.filter(|_| !*slow_done).unwrap_or_else(far),
            Instant::now() + Duration::from_millis(250),
        ]
        .into_iter()
        .min()
        .expect("non-empty");
        tokio::select! {
            r = conn.read() => match r {
                Ok(Some(m)) => {
                    if let Some(end) = conn.on_message(m) {
                        if end == End::Done {
                            // The player's own result is in: a human leaves the finished match.
                            conn.leave().await;
                        }
                        return Drive::Over(end);
                    }
                }
                Ok(None) => {}
                Err(e) => return Drive::Over(e),
            },
            _ = tokio::time::sleep_until(wake) => {}
        }
        let now = Instant::now();
        if now >= next_ping {
            next_ping = now + PING_EVERY;
            let ping = ClientMsg::Ping {
                nonce: mind.seq,
                client_ms: mind.started.elapsed().as_secs_f64() * 1000.0,
            };
            if !conn.send(&ping).await {
                return Drive::Over(End::Closed("send failed".into()));
            }
        }
        if scripted && now >= next_input {
            next_input = now + jitter_think(&mut mind.rng, sh.sc.think_ms);
            let ms = mind.started.elapsed().as_millis() as u64;
            let cmds = mind.brain.act(ms, &conn.view, &conn.floors, &mut mind.rng);
            if !cmds.is_empty() {
                mind.seq = mind.seq.wrapping_add(1);
                if !conn
                    .send(&ClientMsg::Input {
                        seq: mind.seq,
                        commands: cmds,
                    })
                    .await
                {
                    return Drive::Over(End::Closed("send failed".into()));
                }
                sh.bump(|c| &c.inputs_sent);
            }
        }
        if let Some(t) = reconnect_at {
            if now >= t {
                return Drive::Reconnect;
            }
        }
        if let Some(t) = leave_at {
            if now >= t {
                conn.leave().await;
                sh.bump(|c| &c.churn_leaves);
                return Drive::Over(End::Done);
            }
        }
        if let Some(t) = slow_at {
            if !*slow_done && now >= t {
                *slow_done = true;
                return Drive::Over(End::Slow(stall(sh, conn).await));
            }
        }
    }
}

/// Stops reading for `slow_stall_secs` (still pinging, so the server sees a live peer that does not drain), then reads again
/// and reports how the server ended the session: the reject code name, "closed" (socket closed or reset, no Reject frame),
/// or "survived" (still being served ten seconds after the stall).
async fn stall(sh: &Arc<Shared>, conn: &mut Conn) -> String {
    sh.bump(|c| &c.slow_started);
    let until = Instant::now() + Duration::from_secs_f64(sh.sc.slow_stall_secs);
    // Pings keep the peer "live" and each one makes the server queue an important Pong frame; once the socket is blocked those
    // pile up in the connection's outbox (cap 256 frames), which is what ends a client that stopped reading with TooSlow.
    while Instant::now() < until && !sh.stopped() {
        tokio::time::sleep(STALL_PING_EVERY.min(until.saturating_duration_since(Instant::now())))
            .await;
        if !conn
            .send(&ClientMsg::Ping {
                nonce: 0,
                client_ms: 0.0,
            })
            .await
        {
            break;
        }
    }
    let deadline = Instant::now() + SLOW_RECOVERY_READ;
    let mut snapshots_after = 0u32;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, conn.read()).await {
            Err(_) => {
                return if snapshots_after > 0 {
                    "survived".into()
                } else {
                    "stalled".into()
                }
            }
            Ok(Err(End::Closed(_))) => return "closed".into(),
            Ok(Err(_)) => return "decode_error".into(),
            Ok(Ok(Some(ServerMsg::Reject { code, .. }))) => return code_name(code),
            Ok(Ok(Some(ServerMsg::Snapshot { .. }))) => snapshots_after += 1,
            Ok(Ok(_)) => {}
        }
    }
}

fn flush(sh: &Shared, conn: &Conn) {
    let secs = conn.opened.elapsed().as_secs_f64();
    sh.push(|l| l.per_client.push((conn.bytes_in, conn.bytes_out, secs)));
}

/// One play session of `p`: admission, then play until it ends, resuming after deliberate drops for a reconnector.
pub async fn play(
    sh: &Arc<Shared>,
    p: &Player,
    admitted_once: &mut bool,
    slow_done: &mut bool,
) -> End {
    let slow = matches!(p.role, Role::Normal { slow: true, .. }) && !*slow_done;
    let mut conn = match open(sh, p, None, slow.then_some(SLOW_RCVBUF)).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    if !*admitted_once && matches!(p.role, Role::Normal { .. }) {
        *admitted_once = true;
        sh.bump(|c| &c.players_admitted);
    }
    if matches!(p.role, Role::Churn) {
        sh.bump(|c| &c.churn_joins);
    }
    let mut mind = Mind {
        brain: Brain::new(sh.sc.aggression),
        rng: Rng::new(p.seed ^ sh.sc.seed.rotate_left(17)),
        seq: 0,
        started: Instant::now(),
    };
    loop {
        match drive(sh, p, &mut conn, &mut mind, slow_done).await {
            Drive::Over(end) => {
                flush(sh, &conn);
                if matches!(&end, End::Closed(c) if c == "closed" || c == "send failed")
                    && !sh.stopped()
                {
                    sh.bump(|c| &c.sessions_ended_abnormally);
                    if sh.triggered() {
                        sh.bump(|c| &c.post_abnormal_ends);
                    }
                }
                if let End::Closed(code) = &end {
                    sh.count_map(|l| &mut l.errors, &format!("end: {code}"));
                }
                if let End::Slow(outcome) = &end {
                    sh.count_map(|l| &mut l.slow_outcomes, outcome);
                }
                return end;
            }
            Drive::Reconnect => {
                // Drop the socket without a Leave: the seat is held for the reconnect grace.
                let session = conn.session;
                flush(sh, &conn);
                let (bin, bout) = (conn.bytes_in, conn.bytes_out);
                drop(conn);
                let _ = (bin, bout);
                let (lo, hi) = sh.sc.reconnect_delay_ms;
                tokio::time::sleep(Duration::from_millis(mind.rng.range_u64(lo, hi))).await;
                sh.bump(|c| &c.reconnect_attempts);
                match open(sh, p, Some(session), None).await {
                    Ok(c) => {
                        sh.bump(|c| &c.reconnect_ok);
                        conn = c;
                    }
                    Err(e) => {
                        sh.bump(|c| &c.reconnect_failed);
                        let key = match &e {
                            End::Refused(c) => c.clone(),
                            End::Draining => "ServerDraining".into(),
                            End::Closed(c) | End::Failed(c) => c.clone(),
                            other => format!("{other:?}"),
                        };
                        sh.count_map(|l| &mut l.reconnect_failures, &key);
                        return e;
                    }
                }
            }
        }
    }
}

/// The life of a scripted main player: queue for matches until the run ends.
pub async fn run_player(sh: Arc<Shared>, p: Player, start_at: Instant) {
    tokio::time::sleep_until(start_at).await;
    let mut rng = Rng::new(p.seed.wrapping_mul(31).wrapping_add(7));
    let (mut admitted, mut slow_done) = (false, false);
    while !sh.stopped() {
        match play(&sh, &p, &mut admitted, &mut slow_done).await {
            End::Draining | End::Stopped | End::Slow(_) => return,
            End::Done if !sh.sc.rejoin => return,
            End::Done => tokio::time::sleep(Duration::from_millis(rng.range_u64(500, 2500))).await,
            End::Refused(_) | End::Closed(_) | End::Failed(_) => {
                tokio::time::sleep(Duration::from_millis(rng.range_u64(1000, 3000))).await
            }
        }
    }
}

/// A lobby churner: join, linger, Leave, repeat.
pub async fn run_churn(sh: Arc<Shared>, p: Player, start_at: Instant) {
    tokio::time::sleep_until(start_at).await;
    let mut rng = Rng::new(p.seed.wrapping_mul(131).wrapping_add(3));
    let (mut admitted, mut slow_done) = (false, false);
    while !sh.stopped() {
        match play(&sh, &p, &mut admitted, &mut slow_done).await {
            End::Draining | End::Stopped => return,
            End::Done => tokio::time::sleep(Duration::from_millis(rng.range_u64(200, 1000))).await,
            _ => tokio::time::sleep(Duration::from_millis(rng.range_u64(500, 1500))).await,
        }
    }
}

/// One fresh admission attempt (the shutdown probe): the reject code name, "welcome" if it was admitted, or an error label.
pub async fn probe(sh: &Arc<Shared>, p: &Player) -> String {
    match open(sh, p, None, None).await {
        Ok(mut conn) => {
            conn.leave().await;
            "welcome".into()
        }
        Err(End::Draining) => "ServerDraining".into(),
        Err(End::Refused(c)) | Err(End::Failed(c)) | Err(End::Closed(c)) => c,
        Err(other) => format!("{other:?}"),
    }
}
