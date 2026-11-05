//! Hosting lifecycle (docs/adr/0004-hosting.md). The game server never links a cloud SDK: a hosting bridge (for GameLift, a
//! small sidecar using the official Server SDK) drives this process through the local control API, and this module is the
//! one place that maps those calls onto the server:
//!
//!   Starting --ready--> Ready --(sessions run)--> Draining --(last room closes)--> Terminated
//!
//! * readiness/health: `GET /control/health` (200 while Ready and healthy, 503 otherwise) and the state name in `/info`;
//! * allocation: by default rooms are created on admission (the fullest open lobby, else a new one). With `--require-admit`
//!   (hosted mode) rooms exist only through `POST /control/session` (one per game session; GameLift allows one game session
//!   per server process, so the hosted image runs `--max-rooms 1`), and a Hello is admitted only with an admit posted to
//!   `POST /control/admit`, checked as an additional step after the profile credential check and before the fenced lease
//!   (docs/hosting/CONTROL_API.md section 4; `director.rs` `admit_once`). The admit never authenticates anyone;
//! * the control API (`/control/{health,session,admit,leave,rooms,end,drain}`): bookkeeping and HTTP in `control.rs`, the room
//!   and admission hooks in `director.rs`/`room.rs`. It is served only by the loopback control listener (`main.rs` asserts the
//!   address; the public router has no `/control` route). The bridge polls `GET /control/rooms` (player status `admitted`,
//!   `seated`, `away` for the reconnect grace, `left`, `expired`; room phase and `rev`);
//! * draining (scale-in, deployment, SIGTERM, GameLift onProcessTerminate): `POST /control/drain` stops admissions and new
//!   sessions; active matches play to their end (a draining room nobody ever joined closes at once); `Terminated` is reached when
//!   the last room closes, and the binary exits. `POST /control/end` does the same per room (`graceful`) or closes it now
//!   without inventing a result (`abort`).

use std::sync::atomic::{AtomicU8, Ordering};
use tokio::sync::Notify;

const STARTING: u8 = 0;
const READY: u8 = 1;
const DRAINING: u8 = 2;
const TERMINATED: u8 = 3;

pub struct Lifecycle {
    state: AtomicU8,
    pub terminated: Notify,
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self {
            state: AtomicU8::new(STARTING),
            terminated: Notify::new(),
        }
    }
}

impl Lifecycle {
    pub fn ready(&self) {
        let _ = self
            .state
            .compare_exchange(STARTING, READY, Ordering::SeqCst, Ordering::SeqCst);
    }
    pub fn start_draining(&self) {
        let s = self.state.load(Ordering::SeqCst);
        if s == STARTING || s == READY {
            self.state.store(DRAINING, Ordering::SeqCst);
        }
    }
    pub fn draining(&self) -> bool {
        self.state.load(Ordering::SeqCst) >= DRAINING
    }
    /// Called when the last room closed: a draining server is done.
    pub fn rooms_empty(&self) {
        if self
            .state
            .compare_exchange(DRAINING, TERMINATED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            self.terminated.notify_waiters();
            self.terminated.notify_one();
        }
    }
    pub fn is_terminated(&self) -> bool {
        self.state.load(Ordering::SeqCst) == TERMINATED
    }
    pub fn healthy(&self) -> bool {
        self.state.load(Ordering::SeqCst) == READY
    }
    pub fn state_name(&self) -> &'static str {
        match self.state.load(Ordering::SeqCst) {
            STARTING => "starting",
            READY => "ready",
            DRAINING => "draining",
            _ => "terminated",
        }
    }
}
