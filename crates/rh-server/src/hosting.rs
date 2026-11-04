//! Hosting lifecycle (docs/adr/0004-hosting.md). The game server never links a cloud SDK: a hosting bridge (for GameLift, a
//! small sidecar using the official Server SDK) drives this process through the local control API, and this module is the
//! one place that maps those calls onto the server:
//!
//!   Starting --ready--> Ready --(sessions run)--> Draining --(last room closes)--> Terminated
//!
//! * readiness/health: `GET /control/health` (200 while Ready and healthy, 503 otherwise) and the state name in `/info`;
//! * allocation: rooms are created on admission today; creating one ahead of a GameLift placement (a session-start
//!   endpoint for the bridge) is backlog packet P-HOST-1;
//! * draining (scale-in, deployment, SIGTERM, GameLift onProcessTerminate): `POST /control/drain` stops admissions; active
//!   matches play to their end; `Terminated` is reached when the last room closes, and the binary exits.

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
