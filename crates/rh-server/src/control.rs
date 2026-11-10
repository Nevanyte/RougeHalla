//! The control API's bookkeeping (docs/hosting/CONTROL_API.md): which game session owns which room, the admits the hosting
//! bridge pre-authorised, and the per-player status the bridge polls. Pure data and rules: no I/O, no clock of its own (every
//! method takes `now`), no room handle. The director owns one [`ControlBook`] inside its state lock and feeds it the room's
//! reports; the HTTP layer (`control_http`) only parses requests and calls the director.
//!
//! An admit is an additional precondition, never a credential (CONTROL_API.md section 4): this module never sees a profile
//! token, and a record here can only be consumed by a Hello that already passed the unchanged credential check.
//!
//! Bounds: at most [`RECORDS_PER_ROOM`] player records per room (live and final), at most [`TOMBSTONE_HARD_CAP`] closed rooms.
//! Expiry is evaluated lazily by [`ControlBook::sweep`], which every control call and every admit lookup runs first, so no
//! timer task exists and an unread book cannot grow.

use crate::room::{GoneReason, MatchId, SeatEvent};
use rh_sim::Phase;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::Instant;

pub const API_VERSION: u64 = 1;
/// Request bodies above this are refused with 413.
pub const MAX_BODY: usize = 16 * 1024;
pub const MIN_TTL_MS: u64 = 1_000;
pub const MAX_TTL_MS: u64 = 300_000;
pub const DEFAULT_TTL_MS: u64 = 60_000;
/// Player records (pending, seated and final) one room may hold. Past it `admit` is `409 too_many_admits`.
pub const RECORDS_PER_ROOM: usize = 256;
/// Closed rooms stay listed: always the newest this many, and any younger than `TOMBSTONE_MIN_AGE`, up to the hard cap.
pub const TOMBSTONES_KEEP: usize = 16;
pub const TOMBSTONE_MIN_AGE: Duration = Duration::from_secs(600);
pub const TOMBSTONE_HARD_CAP: usize = 256;

/// A control API error: status, snake_case code, human text (never a secret).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CtlError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
}

impl CtlError {
    pub fn new(status: u16, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(400, "bad_request", message)
    }
    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(409, code, message)
    }
    pub fn no_such_session() -> Self {
        Self::new(404, "no_such_session", "no such game session")
    }
    pub fn body(&self) -> Value {
        json!({"v": API_VERSION, "error": {"code": self.code, "message": self.message}})
    }
}

/// `callsign`: 2..=16 of `A-Za-z0-9_-` (the Hello's profile rule).
pub fn callsign_ok(p: &str) -> bool {
    (2..=16).contains(&p.len())
        && p.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn game_session_id_ok(id: &str) -> bool {
    (1..=1024).contains(&id.len()) && !id.chars().any(char::is_control)
}

pub fn player_session_id_ok(id: &str) -> bool {
    (1..=128).contains(&id.len()) && !id.chars().any(char::is_control)
}

/// Lowercase hex of a room id (the control API's `roomId`).
pub fn room_id_hex(id: MatchId) -> String {
    id.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PStatus {
    Admitted,
    Seated,
    Away,
    Left,
    Expired,
}

impl PStatus {
    fn as_str(self) -> &'static str {
        match self {
            PStatus::Admitted => "admitted",
            PStatus::Seated => "seated",
            PStatus::Away => "away",
            PStatus::Left => "left",
            PStatus::Expired => "expired",
        }
    }
    fn is_final(self) -> bool {
        matches!(self, PStatus::Left | PStatus::Expired)
    }
    /// Holds one of the room's `maxPlayers` seats and the callsign.
    fn holds_seat(self) -> bool {
        matches!(self, PStatus::Admitted | PStatus::Seated | PStatus::Away)
    }
}

#[derive(Clone, Debug)]
struct PlayerRec {
    psid: String,
    callsign: String,
    status: PStatus,
    reason: Option<&'static str>,
    /// `Admitted`: the monotonic deadline (never extended by a retry).
    expires_at: Instant,
    /// `Away`: when the reconnect grace ends.
    grace_until: Option<Instant>,
    /// `Admitted` and being consumed by the admission with this generation: the Hello that took it is acquiring its lease or
    /// waiting for the room's reply. Restored to pending if that admission fails, cleared when the room seats it.
    seating: Option<u64>,
    /// When the admission that holds `seating` consumed the admit (for the admit-to-seat metric).
    consumed_at: Option<Instant>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CPhase {
    Lobby,
    Planning,
    Active,
    Ended,
    Closed,
}

impl CPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            CPhase::Lobby => "lobby",
            CPhase::Planning => "planning",
            CPhase::Active => "active",
            CPhase::Ended => "ended",
            CPhase::Closed => "closed",
        }
    }
    fn of(p: Phase) -> Self {
        match p {
            Phase::Lobby => CPhase::Lobby,
            Phase::Planning => CPhase::Planning,
            Phase::Active => CPhase::Active,
            Phase::Ended => CPhase::Ended,
        }
    }
}

#[derive(Debug)]
struct Session {
    gsid: String,
    room: MatchId,
    max_players: usize,
    fill_bots_to: usize,
    phase: CPhase,
    end_reason: Option<&'static str>,
    rev: u64,
    players: Vec<PlayerRec>,
    /// Acknowledged final records: only the replay marker is kept (psid -> callsign, final status).
    dropped: Vec<(String, String, PStatus)>,
    /// `end graceful`: no more admits, the room plays out.
    ending: bool,
    /// `end abort` was requested: the close is reported as `ended_by_bridge`.
    aborted: bool,
    closed_at: Option<Instant>,
}

impl Session {
    fn bump(&mut self) {
        self.rev += 1;
    }
    fn records(&self) -> usize {
        self.players.len() + self.dropped.len()
    }
}

/// What a create request needs to decide before a room is spawned.
#[derive(Debug, PartialEq, Eq)]
pub enum CreateCheck {
    /// Same id, same properties, room open: answer `created:false` with these.
    Existing {
        room: MatchId,
        phase: CPhase,
        max_players: usize,
    },
    /// No such session yet: the caller may spawn a room and call [`ControlBook::insert`].
    New,
}

#[derive(Debug)]
pub struct AdmitOut {
    pub state: &'static str,
    pub expires_in_ms: u64,
    pub game_session_id: String,
    pub player_session_id: String,
    pub callsign: String,
}

/// A pending admit a Hello consumed (see [`ControlBook::take_admit`]).
#[derive(Clone, Debug)]
pub struct Taken {
    pub room: MatchId,
    pub gsid: String,
    pub psid: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LeaveMode {
    Ack,
    Kick,
}

#[derive(Debug)]
pub struct LeaveOut {
    pub state: &'static str,
    /// Kick of a seated or away player: the room must be told (the profile, then the room to tell).
    pub kick: Option<(MatchId, String)>,
}

#[derive(Debug)]
pub struct EndOut {
    pub phase: CPhase,
    pub room: MatchId,
    /// `graceful`: send the room `Drain`; `abort`: send it `Abort`. `None` when it is already closed.
    pub tell_room: Option<EndMode>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndMode {
    Graceful,
    Abort,
}

#[derive(Debug)]
pub struct ControlBook {
    sessions: Vec<Session>,
    pub admit_ttl: Duration,
    grace: Duration,
}

impl Default for ControlBook {
    fn default() -> Self {
        Self::new(
            Duration::from_millis(DEFAULT_TTL_MS),
            crate::room::RECONNECT_GRACE,
        )
    }
}

impl ControlBook {
    pub fn new(admit_ttl: Duration, grace: Duration) -> Self {
        Self {
            sessions: Vec::new(),
            admit_ttl,
            grace,
        }
    }

    /// Expires admits whose deadline passed (never one a Hello is mid-way through consuming) and trims old tombstones.
    pub fn sweep(&mut self, now: Instant) {
        for s in self
            .sessions
            .iter_mut()
            .filter(|s| s.phase != CPhase::Closed)
        {
            let mut changed = false;
            for p in s.players.iter_mut() {
                if p.status == PStatus::Admitted && p.seating.is_none() && now >= p.expires_at {
                    p.status = PStatus::Expired;
                    changed = true;
                }
            }
            if changed {
                s.bump();
            }
        }
        // Tombstones: keep the newest TOMBSTONES_KEEP, plus any younger than TOMBSTONE_MIN_AGE up to the hard cap.
        let closed: Vec<usize> = self
            .sessions
            .iter()
            .enumerate()
            .filter(|(_, s)| s.phase == CPhase::Closed)
            .map(|(i, _)| i)
            .collect();
        if closed.len() > TOMBSTONES_KEEP {
            let excess = closed.len() - TOMBSTONES_KEEP;
            let mut drop_idx: Vec<usize> = Vec::new();
            for (n, &i) in closed.iter().enumerate() {
                let old = self.sessions[i]
                    .closed_at
                    .is_none_or(|t| now.saturating_duration_since(t) >= TOMBSTONE_MIN_AGE);
                let over_cap = closed.len() - drop_idx.len() > TOMBSTONE_HARD_CAP;
                if n < excess && (old || over_cap) {
                    drop_idx.push(i);
                }
            }
            for i in drop_idx.into_iter().rev() {
                self.sessions.remove(i);
            }
        }
    }

    fn find_mut(&mut self, gsid: &str) -> Option<&mut Session> {
        self.sessions.iter_mut().find(|s| s.gsid == gsid)
    }
    fn find_room_mut(&mut self, room: MatchId) -> Option<&mut Session> {
        self.sessions.iter_mut().find(|s| s.room == room)
    }

    /// Decides a create request (everything but the lifecycle state and the room cap, which the director checks).
    pub fn check_create(
        &self,
        gsid: &str,
        max_players: usize,
        fill_bots_to: usize,
    ) -> Result<CreateCheck, CtlError> {
        match self.sessions.iter().find(|s| s.gsid == gsid) {
            None => Ok(CreateCheck::New),
            Some(s) if s.phase == CPhase::Closed => Err(CtlError::conflict(
                "session_ended",
                "that game session already ended; ids are never reused",
            )),
            Some(s) if s.max_players == max_players && s.fill_bots_to == fill_bots_to => {
                Ok(CreateCheck::Existing {
                    room: s.room,
                    phase: s.phase,
                    max_players: s.max_players,
                })
            }
            Some(_) => Err(CtlError::conflict(
                "session_conflict",
                "that game session exists with different properties",
            )),
        }
    }

    pub fn insert(&mut self, gsid: &str, room: MatchId, max_players: usize, fill_bots_to: usize) {
        self.sessions.push(Session {
            gsid: gsid.to_string(),
            room,
            max_players,
            fill_bots_to,
            phase: CPhase::Lobby,
            end_reason: None,
            rev: 1,
            players: Vec::new(),
            dropped: Vec::new(),
            ending: false,
            aborted: false,
            closed_at: None,
        });
    }

    /// `POST /control/admit` (the draining check is the caller's: it knows the lifecycle).
    pub fn admit(
        &mut self,
        gsid: &str,
        psid: &str,
        callsign: &str,
        ttl: Duration,
        now: Instant,
        draining: bool,
    ) -> Result<AdmitOut, CtlError> {
        self.sweep(now);
        let Some(si) = self.sessions.iter().position(|s| s.gsid == gsid) else {
            return Err(CtlError::no_such_session());
        };
        {
            let s = &self.sessions[si];
            if s.phase == CPhase::Closed {
                return Err(CtlError::conflict(
                    "session_ended",
                    "the game session ended",
                ));
            }
            if draining || s.ending {
                return Err(CtlError::conflict(
                    "draining",
                    "the room is not taking players any more",
                ));
            }
        }
        let out = |state: &'static str, ms: u64, s: &Session, rec_callsign: &str| AdmitOut {
            state,
            expires_in_ms: ms,
            game_session_id: s.gsid.clone(),
            player_session_id: psid.to_string(),
            callsign: rec_callsign.to_string(),
        };
        // The same reservation presented again: an idempotent answer, never a new seat and never a longer expiry.
        let s = &self.sessions[si];
        if let Some(p) = s.players.iter().find(|p| p.psid == psid) {
            if !p.callsign.eq_ignore_ascii_case(callsign) {
                return Err(CtlError::conflict(
                    "admit_conflict",
                    "that player session is bound to another callsign",
                ));
            }
            return Ok(match p.status {
                PStatus::Admitted => out(
                    "admitted",
                    ms(p.expires_at.saturating_duration_since(now)),
                    s,
                    &p.callsign,
                ),
                PStatus::Seated | PStatus::Away => out("consumed", 0, s, &p.callsign),
                PStatus::Left => out("left", 0, s, &p.callsign),
                PStatus::Expired => out("expired", 0, s, &p.callsign),
            });
        }
        if let Some((_, c, st)) = s.dropped.iter().find(|(id, _, _)| id == psid) {
            if !c.eq_ignore_ascii_case(callsign) {
                return Err(CtlError::conflict(
                    "admit_conflict",
                    "that player session is bound to another callsign",
                ));
            }
            return Ok(out(st.as_str(), 0, s, c));
        }
        // The same player session in another room is a conflict (a reservation belongs to one room).
        if self
            .sessions
            .iter()
            .any(|o| o.gsid != gsid && o.players.iter().any(|p| p.psid == psid))
        {
            return Err(CtlError::conflict(
                "admit_conflict",
                "that player session belongs to another game session",
            ));
        }
        // A callsign holds at most one pending or seated admit, in any room.
        if self.sessions.iter().any(|o| {
            o.phase != CPhase::Closed
                && o.players
                    .iter()
                    .any(|p| p.status.holds_seat() && p.callsign.eq_ignore_ascii_case(callsign))
        }) {
            return Err(CtlError::conflict(
                "admit_conflict",
                "that callsign already holds an admit",
            ));
        }
        let s = &self.sessions[si];
        let live = s.players.iter().filter(|p| p.status.holds_seat()).count();
        if live >= s.max_players {
            return Err(CtlError::conflict("room_full", "the room has no free seat"));
        }
        if s.records() >= RECORDS_PER_ROOM {
            return Err(CtlError::conflict(
                "too_many_admits",
                "this room has reached its bound on player records",
            ));
        }
        let s = &mut self.sessions[si];
        s.players.push(PlayerRec {
            psid: psid.to_string(),
            callsign: callsign.to_string(),
            status: PStatus::Admitted,
            reason: None,
            expires_at: now + ttl,
            grace_until: None,
            seating: None,
            consumed_at: None,
        });
        s.bump();
        Ok(AdmitOut {
            state: "admitted",
            expires_in_ms: ms(ttl),
            game_session_id: s.gsid.clone(),
            player_session_id: psid.to_string(),
            callsign: callsign.to_string(),
        })
    }

    /// Whether a Hello for `callsign` has an unconsumed, unexpired admit in a room that still takes players (or one another
    /// Hello is consuming right now). Read-only: the early refusal point, after the credential check.
    pub fn has_admit(&mut self, callsign: &str, now: Instant) -> bool {
        self.sweep(now);
        self.sessions.iter().any(|s| {
            s.phase != CPhase::Closed
                && !s.ending
                && s.players.iter().any(|p| {
                    p.status == PStatus::Admitted && p.callsign.eq_ignore_ascii_case(callsign)
                })
        })
    }

    /// Consumes `callsign`'s pending admit for the admission `gen` (it stays `admitted` to the bridge until the room seats
    /// it, and cannot be taken twice meanwhile). `None`: there is none.
    pub fn take_admit(&mut self, callsign: &str, now: Instant, gen: u64) -> Option<Taken> {
        self.sweep(now);
        for s in self.sessions.iter_mut() {
            if s.phase == CPhase::Closed || s.ending {
                continue;
            }
            if let Some(p) = s.players.iter_mut().find(|p| {
                p.status == PStatus::Admitted
                    && p.seating.is_none()
                    && p.callsign.eq_ignore_ascii_case(callsign)
            }) {
                p.seating = Some(gen);
                p.consumed_at = Some(now);
                return Some(Taken {
                    room: s.room,
                    gsid: s.gsid.clone(),
                    psid: p.psid.clone(),
                });
            }
        }
        None
    }

    /// The admission `gen` failed before a seat was taken: its admit is pending again with its original deadline (a refused
    /// attempt does not burn the reservation; a successful one is cleared by the room's `Seated` report, so it cannot be
    /// replayed). Generations are unique per admission, so this touches nothing else.
    pub fn restore_gen(&mut self, gen: u64) {
        for s in self.sessions.iter_mut() {
            for p in s.players.iter_mut() {
                if p.status == PStatus::Admitted && p.seating == Some(gen) {
                    p.seating = None;
                    p.consumed_at = None;
                }
            }
        }
    }

    /// The room's report about one seat. Returns how long the admit had been consumed when its seat was first taken
    /// (`Admitted` to `Seated`; `None` for every other event, including a resume).
    pub fn on_seat(&mut self, room: MatchId, profile: &str, event: SeatEvent) -> Option<Duration> {
        let grace = self.grace;
        let s = self.find_room_mut(room)?;
        let Some(p) = s.players.iter_mut().find(|p| {
            p.callsign.eq_ignore_ascii_case(profile)
                && matches!(
                    p.status,
                    PStatus::Admitted | PStatus::Seated | PStatus::Away
                )
        }) else {
            return None; // a seat that never had an admit (a room joined outside the control API)
        };
        let mut took = None;
        let changed = match (p.status, event) {
            (PStatus::Admitted, SeatEvent::Seated) | (PStatus::Away, SeatEvent::Seated) => {
                if p.status == PStatus::Admitted {
                    took = p
                        .consumed_at
                        .map(|t| Instant::now().saturating_duration_since(t));
                }
                p.status = PStatus::Seated;
                p.seating = None;
                p.consumed_at = None;
                p.grace_until = None;
                true
            }
            (PStatus::Seated, SeatEvent::Away { at }) => {
                p.status = PStatus::Away;
                p.grace_until = Some(at + grace);
                true
            }
            (PStatus::Away, SeatEvent::Back) => {
                p.status = PStatus::Seated;
                p.grace_until = None;
                true
            }
            (_, SeatEvent::Gone(why)) => {
                p.status = PStatus::Left;
                p.reason = Some(why.as_str());
                p.seating = None;
                p.grace_until = None;
                true
            }
            _ => false,
        };
        if changed {
            s.bump();
        }
        took
    }

    pub fn on_phase(&mut self, room: MatchId, phase: Phase) {
        if let Some(s) = self.find_room_mut(room) {
            let to = CPhase::of(phase);
            if s.phase != CPhase::Closed && s.phase != to {
                s.phase = to;
                s.bump();
            }
        }
    }

    /// The room closed. Seats still held become `left`, admits nobody used `expired`.
    pub fn on_closed(&mut self, room: MatchId, crashed: bool, draining: bool, now: Instant) {
        let Some(s) = self.find_room_mut(room) else {
            return;
        };
        if s.phase == CPhase::Closed {
            return;
        }
        let reason = if s.aborted {
            "ended_by_bridge"
        } else if crashed {
            "crashed"
        } else if s.phase == CPhase::Ended {
            "completed"
        } else if draining || s.ending {
            "drained"
        } else {
            "abandoned"
        };
        for p in s.players.iter_mut() {
            match p.status {
                PStatus::Seated | PStatus::Away => {
                    p.status = PStatus::Left;
                    p.reason = Some(if crashed { "crashed" } else { "match_over" });
                }
                PStatus::Admitted if p.seating.is_some() => {
                    p.status = PStatus::Left;
                    p.reason = Some(if crashed { "crashed" } else { "match_over" });
                }
                PStatus::Admitted => p.status = PStatus::Expired,
                _ => {}
            }
            p.grace_until = None;
            p.seating = None;
        }
        s.phase = CPhase::Closed;
        s.end_reason = Some(reason);
        s.closed_at = Some(now);
        s.bump();
    }

    /// `POST /control/leave`.
    pub fn leave(
        &mut self,
        gsid: &str,
        psid: &str,
        mode: LeaveMode,
        now: Instant,
    ) -> Result<LeaveOut, CtlError> {
        self.sweep(now);
        let Some(s) = self.find_mut(gsid) else {
            return Err(CtlError::no_such_session());
        };
        let room = s.room;
        let idx = s.players.iter().position(|p| p.psid == psid);
        match mode {
            LeaveMode::Ack => {
                let Some(i) = idx else {
                    return Ok(LeaveOut {
                        state: if s.dropped.iter().any(|(id, _, _)| id == psid) {
                            "dropped"
                        } else {
                            "unknown"
                        },
                        kick: None,
                    });
                };
                if !s.players[i].status.is_final() {
                    return Err(CtlError::conflict(
                        "not_final",
                        "that player session has not left yet",
                    ));
                }
                let p = s.players.remove(i);
                s.dropped.push((p.psid, p.callsign, p.status));
                s.bump();
                Ok(LeaveOut {
                    state: "dropped",
                    kick: None,
                })
            }
            LeaveMode::Kick => {
                let Some(i) = idx else {
                    return Ok(LeaveOut {
                        state: if s.dropped.iter().any(|(id, _, _)| id == psid) {
                            "dropped"
                        } else {
                            "unknown"
                        },
                        kick: None,
                    });
                };
                let p = &mut s.players[i];
                let mut kick = None;
                match p.status {
                    // The player's Hello consumed this admit and is being seated right now. Expiring it here would let the
                    // seat land afterwards with the book saying `expired`: a player seated invisibly. Refuse; the bridge
                    // retries (the next look says `seated`, which a kick handles).
                    PStatus::Admitted if p.seating.is_some() => {
                        return Err(CtlError::conflict(
                            "seating_in_progress",
                            "that player is being seated right now; retry the kick shortly",
                        ));
                    }
                    PStatus::Admitted => {
                        p.status = PStatus::Expired;
                        p.seating = None;
                        s.bump();
                    }
                    PStatus::Seated | PStatus::Away => {
                        p.status = PStatus::Left;
                        p.reason = Some(GoneReason::Kicked.as_str());
                        p.grace_until = None;
                        kick = Some((room, p.callsign.clone()));
                        s.bump();
                    }
                    PStatus::Left | PStatus::Expired => {}
                }
                let state = s.players[i].status.as_str();
                Ok(LeaveOut { state, kick })
            }
        }
    }

    /// `POST /control/end`.
    pub fn end(&mut self, gsid: &str, mode: EndMode, now: Instant) -> Result<EndOut, CtlError> {
        self.sweep(now);
        let Some(s) = self.find_mut(gsid) else {
            return Err(CtlError::no_such_session());
        };
        if s.phase == CPhase::Closed {
            return Ok(EndOut {
                phase: CPhase::Closed,
                room: s.room,
                tell_room: None,
            });
        }
        match mode {
            EndMode::Graceful => {
                if !s.ending {
                    s.ending = true;
                    s.bump();
                }
            }
            EndMode::Abort => {
                s.aborted = true;
                s.ending = true;
            }
        }
        Ok(EndOut {
            phase: s.phase,
            room: s.room,
            tell_room: Some(mode),
        })
    }

    /// The room of a game session, if the book has one.
    pub fn room_of(&self, gsid: &str) -> Option<MatchId> {
        self.sessions
            .iter()
            .find(|s| s.gsid == gsid)
            .map(|s| s.room)
    }

    pub fn phase_of(&self, gsid: &str) -> Option<CPhase> {
        self.sessions
            .iter()
            .find(|s| s.gsid == gsid)
            .map(|s| s.phase)
    }

    pub fn is_ending(&self, gsid: &str) -> bool {
        self.sessions.iter().any(|s| s.gsid == gsid && s.ending)
    }

    /// The `rooms` array of `GET /control/rooms`.
    pub fn rooms_json(&mut self, now: Instant) -> Value {
        self.sweep(now);
        Value::Array(
            self.sessions
                .iter()
                .map(|s| {
                    let players: Vec<Value> = s
                        .players
                        .iter()
                        .map(|p| {
                            json!({
                                "playerSessionId": p.psid,
                                "callsign": p.callsign,
                                "status": p.status.as_str(),
                                "reason": p.reason,
                                "expiresInMs": (p.status == PStatus::Admitted)
                                    .then(|| ms(p.expires_at.saturating_duration_since(now))),
                                "graceRemainingMs": p.grace_until
                                    .map(|g| ms(g.saturating_duration_since(now))),
                            })
                        })
                        .collect();
                    json!({
                        "gameSessionId": s.gsid,
                        "roomId": room_id_hex(s.room),
                        "phase": s.phase.as_str(),
                        "rev": s.rev,
                        "maxPlayers": s.max_players,
                        "endReason": s.end_reason,
                        "players": players,
                    })
                })
                .collect(),
        )
    }

    /// Game sessions held (open and tombstones), for tests of the bound.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Player records currently held (live and final), for tests of the bound.
    pub fn record_count(&self) -> usize {
        self.sessions.iter().map(Session::records).sum()
    }
}

fn ms(d: Duration) -> u64 {
    d.as_millis().min(u128::from(u64::MAX)) as u64
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP layer: the control listener's router. Served only on the loopback control port (main.rs); never merged into the
// public router (tests/control.rs fetches every path through the public listener and expects 404).

use crate::director::Director;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// Options of the control listener.
#[derive(Clone, Default)]
pub struct ControlOptions {
    /// `--control-token-file`: when set, every request needs `Authorization: Bearer <token>` (defence in depth; the loopback
    /// bind is the primary boundary).
    pub token: Option<Arc<str>>,
}

#[derive(Clone)]
struct Ctl {
    director: Arc<Director>,
    /// SHA-256 of the token: compared as fixed-length digests, so the comparison does not depend on where the bytes differ.
    token_digest: Option<[u8; 32]>,
}

pub fn router(director: Arc<Director>, opts: ControlOptions) -> Router {
    let state = Ctl {
        director,
        token_digest: opts.token.map(|t| Sha256::digest(t.as_bytes()).into()),
    };
    Router::new()
        .route("/control/health", get(health))
        .route("/control/drain", post(drain))
        .route("/control/session", post(session))
        .route("/control/admit", post(admit))
        .route("/control/leave", post(leave))
        .route("/control/end", post(end))
        .route("/control/rooms", get(rooms))
        .route("/control/info", get(info))
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        .with_state(state)
}

fn reply(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn fail(e: CtlError) -> Response {
    reply(
        StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        e.body(),
    )
}

fn done(r: Result<Value, CtlError>) -> Response {
    match r {
        Ok(v) => reply(StatusCode::OK, v),
        Err(e) => fail(e),
    }
}

async fn authorize(State(c): State<Ctl>, req: Request, next: Next) -> Response {
    // The loopback bind does not stop a browser on this host from sending requests on a web page's behalf
    // (cross-site POST, DNS rebinding). No control client is a browser, so any request carrying `Origin` is refused,
    // with or without a token.
    if req.headers().contains_key(header::ORIGIN) {
        return fail(CtlError::new(
            403,
            "forbidden",
            "the control API does not accept browser requests",
        ));
    }
    if let Some(want) = c.token_digest {
        let got = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|t| -> [u8; 32] { Sha256::digest(t.as_bytes()).into() });
        let ok = got.is_some_and(|g| {
            // Constant-time over the fixed-length digests.
            g.iter().zip(want.iter()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0
        });
        if !ok {
            return fail(CtlError::new(
                401,
                "unauthorized",
                "a bearer token is required",
            ));
        }
    }
    next.run(req).await
}

/// Reads a request body (at most [`MAX_BODY`]) as a JSON object and checks its `v`. `optional`: an empty body is `{"v":1}`
/// (the drain call predates the envelope).
async fn read_object(body: Body, optional: bool) -> Result<Value, CtlError> {
    let bytes = axum::body::to_bytes(body, MAX_BODY)
        .await
        .map_err(|_| CtlError::new(413, "payload_too_large", "request body above 16 KiB"))?;
    if bytes.is_empty() && optional {
        return Ok(json!({"v": API_VERSION}));
    }
    let v: Value = serde_json::from_slice(&bytes)
        .map_err(|_| CtlError::bad_request("the body must be a JSON object"))?;
    let Some(obj) = v.as_object() else {
        return Err(CtlError::bad_request("the body must be a JSON object"));
    };
    match obj.get("v") {
        None => Err(CtlError::bad_request("missing \"v\"")),
        Some(n) if n.as_u64() == Some(API_VERSION) => Ok(v),
        Some(_) => Err(CtlError::new(
            400,
            "unsupported_version",
            format!("this server speaks control API v{API_VERSION}"),
        )),
    }
}

fn typed<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, CtlError> {
    serde_json::from_value(v).map_err(|e| {
        // By characters: `String::truncate(160)` panics when byte 160 falls inside a multibyte character, and the message
        // can echo attacker-chosen field names.
        let m: String = e.to_string().chars().take(160).collect();
        CtlError::bad_request(m)
    })
}

async fn health(State(c): State<Ctl>) -> Response {
    let d = &c.director;
    let code = if d.lifecycle.healthy() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    reply(
        code,
        json!({
            "v": API_VERSION,
            "state": d.lifecycle.state_name(),
            "rooms": d.room_count(),
            // The build this process runs (`RH_BUILD`), so a rolling deploy can verify which build each group has. Only here,
            // not in `/info`, whose key set is pinned.
            "build": rh_sim::replay::BUILD_ID,
            "metrics": crate::metrics::process().json(),
            "results": d.result_metrics(),
            "control": d.control_info(),
        }),
    )
}

async fn drain(State(c): State<Ctl>, body: Body) -> Response {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Req {
        #[allow(dead_code)]
        v: u64,
    }
    let parsed = match read_object(body, true).await {
        Ok(v) => typed::<Req>(v).map(|_| ()),
        Err(e) => Err(e),
    };
    if let Err(e) = parsed {
        return fail(e);
    }
    c.director.drain().await;
    reply(
        StatusCode::OK,
        json!({"v": API_VERSION, "state": c.director.lifecycle.state_name()}),
    )
}

async fn rooms(State(c): State<Ctl>) -> Response {
    reply(StatusCode::OK, c.director.control_rooms())
}

/// The operator counters that used to be on the public `/info` (rooms, lobbies, players, results, the last closed rooms),
/// with the same keys.
async fn info(State(c): State<Ctl>) -> Response {
    reply(StatusCode::OK, c.director.info())
}

fn check_gsid(id: &str) -> Result<(), CtlError> {
    game_session_id_ok(id).then_some(()).ok_or_else(|| {
        CtlError::bad_request("gameSessionId must be 1..=1024 bytes, no control characters")
    })
}

async fn session(State(c): State<Ctl>, body: Body) -> Response {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Req {
        #[allow(dead_code)]
        v: u64,
        #[serde(rename = "gameSessionId")]
        game_session_id: String,
        #[serde(default)]
        properties: Option<serde_json::Map<String, Value>>,
    }
    let run = async {
        let req: Req = typed(read_object(body, false).await?)?;
        check_gsid(&req.game_session_id)?;
        let (mut max_players, mut fill) = (None, None);
        for (k, v) in req.properties.iter().flatten() {
            let n = |name: &str| {
                v.as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .ok_or_else(|| CtlError::bad_request(format!("{name} must be a whole number")))
            };
            match k.as_str() {
                "maxPlayers" => max_players = Some(n("maxPlayers")?),
                "fillBotsTo" => fill = Some(n("fillBotsTo")?),
                "mapSeed" => {
                    return Err(CtlError::new(
                        400,
                        "unsupported_property",
                        "mapSeed is not supported yet",
                    ))
                }
                _ => return Err(CtlError::bad_request("unknown property")),
            }
        }
        c.director
            .control_create(&req.game_session_id, max_players, fill)
    };
    done(run.await)
}

async fn admit(State(c): State<Ctl>, body: Body) -> Response {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Req {
        #[allow(dead_code)]
        v: u64,
        #[serde(rename = "gameSessionId")]
        game_session_id: String,
        #[serde(rename = "playerSessionId")]
        player_session_id: String,
        callsign: String,
        #[serde(rename = "ttlMs")]
        ttl_ms: Option<u64>,
    }
    let run = async {
        let req: Req = typed(read_object(body, false).await?)?;
        check_gsid(&req.game_session_id)?;
        if !player_session_id_ok(&req.player_session_id) {
            return Err(CtlError::bad_request(
                "playerSessionId must be 1..=128 bytes, no control characters",
            ));
        }
        if !callsign_ok(&req.callsign) {
            return Err(CtlError::bad_request(
                "callsign must be 2-16 of A-Z a-z 0-9 _ -",
            ));
        }
        let ttl = match req.ttl_ms {
            None => None,
            Some(t) if (MIN_TTL_MS..=MAX_TTL_MS).contains(&t) => Some(Duration::from_millis(t)),
            Some(_) => {
                return Err(CtlError::bad_request(format!(
                    "ttlMs must be {MIN_TTL_MS}..={MAX_TTL_MS}"
                )))
            }
        };
        c.director.control_admit(
            &req.game_session_id,
            &req.player_session_id,
            &req.callsign,
            ttl,
        )
    };
    done(run.await)
}

async fn leave(State(c): State<Ctl>, body: Body) -> Response {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Req {
        #[allow(dead_code)]
        v: u64,
        #[serde(rename = "gameSessionId")]
        game_session_id: String,
        #[serde(rename = "playerSessionId")]
        player_session_id: String,
        mode: String,
    }
    let run = async {
        let req: Req = typed(read_object(body, false).await?)?;
        check_gsid(&req.game_session_id)?;
        if !player_session_id_ok(&req.player_session_id) {
            return Err(CtlError::bad_request(
                "playerSessionId must be 1..=128 bytes, no control characters",
            ));
        }
        let mode = match req.mode.as_str() {
            "ack" => LeaveMode::Ack,
            "kick" => LeaveMode::Kick,
            _ => return Err(CtlError::bad_request("mode must be \"ack\" or \"kick\"")),
        };
        c.director
            .control_leave(&req.game_session_id, &req.player_session_id, mode)
            .await
    };
    done(run.await)
}

async fn end(State(c): State<Ctl>, body: Body) -> Response {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Req {
        #[allow(dead_code)]
        v: u64,
        #[serde(rename = "gameSessionId")]
        game_session_id: String,
        mode: String,
    }
    let run = async {
        let req: Req = typed(read_object(body, false).await?)?;
        check_gsid(&req.game_session_id)?;
        let mode = match req.mode.as_str() {
            "graceful" => EndMode::Graceful,
            "abort" => EndMode::Abort,
            _ => {
                return Err(CtlError::bad_request(
                    "mode must be \"graceful\" or \"abort\"",
                ))
            }
        };
        c.director.control_end(&req.game_session_id, mode).await
    };
    done(run.await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book() -> ControlBook {
        ControlBook::new(Duration::from_secs(60), Duration::from_secs(10))
    }

    #[tokio::test(start_paused = true)]
    async fn an_admit_is_idempotent_does_not_extend_and_expires_for_good() {
        let mut b = book();
        b.insert("g", [1; 16], 4, 0);
        let t0 = Instant::now();
        let ttl = Duration::from_secs(5);
        let a = b.admit("g", "p1", "alice", ttl, t0, false).unwrap();
        assert_eq!((a.state, a.expires_in_ms), ("admitted", 5000));
        tokio::time::advance(Duration::from_secs(2)).await;
        let a2 = b
            .admit("g", "p1", "alice", ttl, Instant::now(), false)
            .unwrap();
        assert_eq!((a2.state, a2.expires_in_ms), ("admitted", 3000));
        tokio::time::advance(Duration::from_secs(4)).await;
        let a3 = b
            .admit("g", "p1", "alice", ttl, Instant::now(), false)
            .unwrap();
        assert_eq!(a3.state, "expired");
        // The callsign is free again for a new reservation.
        assert_eq!(
            b.admit("g", "p2", "alice", ttl, Instant::now(), false)
                .unwrap()
                .state,
            "admitted"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_taken_admit_is_restored_with_its_original_deadline_and_never_taken_twice() {
        let mut b = book();
        b.insert("g", [1; 16], 4, 0);
        let t0 = Instant::now();
        b.admit("g", "p1", "alice", Duration::from_secs(10), t0, false)
            .unwrap();
        assert!(b.take_admit("alice", t0, 7).is_some());
        assert!(b.take_admit("alice", t0, 8).is_none(), "one consumer");
        assert!(b.has_admit("alice", t0), "still visible while consuming");
        tokio::time::advance(Duration::from_secs(4)).await;
        b.restore_gen(7);
        let now = Instant::now();
        let t = b.take_admit("alice", now, 9).expect("restored");
        assert_eq!(t.psid, "p1");
        // The original deadline still governs: restore then wait out the ten seconds.
        b.restore_gen(9);
        tokio::time::advance(Duration::from_secs(7)).await;
        assert!(b.take_admit("alice", Instant::now(), 10).is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn player_records_per_room_are_bounded() {
        let mut b = book();
        b.insert("g", [1; 16], 8, 0);
        let mut refused_at = None;
        for n in 0..(RECORDS_PER_ROOM + 10) {
            let r = b.admit(
                "g",
                &format!("p{n}"),
                &format!("c{n}"),
                Duration::from_secs(1),
                Instant::now(),
                false,
            );
            match r {
                Ok(_) => tokio::time::advance(Duration::from_secs(2)).await, // expires: a final record
                Err(e) => {
                    assert_eq!((e.status, e.code), (409, "too_many_admits"));
                    refused_at.get_or_insert(n);
                }
            }
        }
        assert_eq!(refused_at, Some(RECORDS_PER_ROOM));
        assert_eq!(b.record_count(), RECORDS_PER_ROOM);
    }

    #[tokio::test(start_paused = true)]
    async fn closed_rooms_are_kept_newest_sixteen_and_the_young_up_to_a_hard_cap() {
        let mut b = book();
        for n in 0..(TOMBSTONE_HARD_CAP + 40) {
            let id = [
                (n % 250) as u8,
                (n / 250) as u8,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                1,
            ];
            b.insert(&format!("g{n}"), id, 8, 0);
            b.on_closed(id, false, false, Instant::now());
            tokio::time::advance(Duration::from_secs(1)).await;
            b.sweep(Instant::now());
            assert!(
                b.session_count() <= TOMBSTONE_HARD_CAP,
                "{}",
                b.session_count()
            );
        }
        assert_eq!(b.session_count(), TOMBSTONE_HARD_CAP);
        // Past the minimum age only the newest sixteen stay.
        tokio::time::advance(TOMBSTONE_MIN_AGE + Duration::from_secs(1)).await;
        b.sweep(Instant::now());
        assert_eq!(b.session_count(), TOMBSTONES_KEEP);
        assert!(
            b.phase_of(&format!("g{}", TOMBSTONE_HARD_CAP + 39))
                .is_some(),
            "the newest survives"
        );
        assert!(b.phase_of("g0").is_none());
    }

    #[test]
    fn callsign_and_id_rules() {
        assert!(callsign_ok("al_ice-9"));
        assert!(!callsign_ok("a"));
        assert!(!callsign_ok("has space"));
        assert!(!callsign_ok(&"x".repeat(17)));
        assert!(game_session_id_ok(&"g".repeat(1024)));
        assert!(!game_session_id_ok(&"g".repeat(1025)));
        assert!(!game_session_id_ok("a\nb"));
        assert!(!player_session_id_ok(&"p".repeat(129)));
    }

    #[test]
    fn a_long_error_message_with_multibyte_characters_is_truncated_by_chars_not_bytes() {
        #[derive(serde::Deserialize, Debug)]
        #[serde(deny_unknown_fields)]
        struct Req {
            #[allow(dead_code)]
            v: u64,
        }
        // The message echoes the unknown field: 15 bytes of prefix, then 2-byte characters, so byte 160 is mid-character.
        let name = "\u{e9}".repeat(200);
        let v = serde_json::json!({"v": 1, name: 1});
        let e = typed::<Req>(v).unwrap_err();
        assert_eq!(e.status, 400);
        assert!(e.message.chars().count() <= 160);
        assert!(e.message.starts_with("unknown field"));
    }

    #[tokio::test(start_paused = true)]
    async fn a_kick_never_expires_an_admit_whose_hello_is_being_seated() {
        let mut b = book();
        b.insert("g", [1; 16], 4, 0);
        let t0 = Instant::now();
        b.admit("g", "p1", "alice", Duration::from_secs(30), t0, false)
            .unwrap();
        let taken = b.take_admit("alice", t0, 7).expect("consumed by a Hello");
        assert_eq!(taken.psid, "p1");
        let e = b.leave("g", "p1", LeaveMode::Kick, t0).unwrap_err();
        assert_eq!((e.status, e.code), (409, "seating_in_progress"));
        // Nothing changed: still admitted to the bridge, and the seat can still land.
        b.on_seat([1; 16], "alice", SeatEvent::Seated);
        let out = b.leave("g", "p1", LeaveMode::Kick, t0).unwrap();
        assert_eq!(out.state, "left");
        // A failed admission puts the admit back; then a kick expires it as before.
        b.admit("g", "p2", "bob", Duration::from_secs(30), t0, false)
            .unwrap();
        b.take_admit("bob", t0, 8).unwrap();
        b.restore_gen(8);
        assert_eq!(
            b.leave("g", "p2", LeaveMode::Kick, t0).unwrap().state,
            "expired"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn on_seat_reports_admit_to_seat_time_for_the_first_seat_only() {
        let mut b = book();
        b.insert("g", [1; 16], 4, 0);
        let t0 = Instant::now();
        b.admit("g", "p1", "alice", Duration::from_secs(30), t0, false)
            .unwrap();
        tokio::time::advance(Duration::from_secs(5)).await; // time spent before the Hello: not counted
        b.take_admit("alice", Instant::now(), 1).unwrap();
        tokio::time::advance(Duration::from_millis(250)).await;
        assert_eq!(
            b.on_seat([1; 16], "alice", SeatEvent::Seated),
            Some(Duration::from_millis(250))
        );
        // A later resume (Away, then Seated again) is not an admit-to-seat time.
        b.on_seat([1; 16], "alice", SeatEvent::Away { at: Instant::now() });
        assert_eq!(b.on_seat([1; 16], "alice", SeatEvent::Seated), None);
        // An admission that fails and is retried measures from the retry's consumption.
        b.admit(
            "g",
            "p2",
            "bob",
            Duration::from_secs(30),
            Instant::now(),
            false,
        )
        .unwrap();
        b.take_admit("bob", Instant::now(), 2).unwrap();
        tokio::time::advance(Duration::from_secs(3)).await;
        b.restore_gen(2);
        b.take_admit("bob", Instant::now(), 3).unwrap();
        tokio::time::advance(Duration::from_millis(40)).await;
        assert_eq!(
            b.on_seat([1; 16], "bob", SeatEvent::Seated),
            Some(Duration::from_millis(40))
        );
    }
}

#[cfg(test)]
mod arena_phase_tests {
    use super::*;
    #[test]
    fn arena_planning_control_phase_is_named_truthfully() {
        assert_eq!(CPhase::of(Phase::Planning).as_str(), "planning");
    }
}
