//! Scripted fakes of GameLift and DNS. They enforce the documented request rules the real service enforces (placement id
//! shape and uniqueness, location list limits, `Stop` after fulfilment is an error), so the service tests prove the service
//! respects those rules rather than that a fake accepts anything.

use crate::backend::*;
use crate::model::RegionCapacity;
use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Clone, Debug)]
pub enum RegionBehaviour {
    /// Placements in this region fulfil after `after_polls` describe calls.
    Fulfil {
        after_polls: u32,
        ip: String,
        port: u16,
    },
    /// No host is ever available (the placement stays PENDING).
    NoHost,
    /// The placement reaches FAILED on its first describe.
    Fail,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Call {
    Start {
        placement_id: String,
        locations: Vec<String>,
        fallback: &'static str,
    },
    Describe(String),
    Stop(String),
    Terminate(String),
    Capacity,
}

struct Rec {
    state: PlacementState,
    behaviour: Option<RegionBehaviour>,
    polls: u32,
}

struct State {
    behaviours: BTreeMap<String, RegionBehaviour>,
    placements: BTreeMap<String, Rec>,
    capacity: Result<BTreeMap<String, RegionCapacity>, BackendError>,
    /// Errors returned by the next `start_placement` calls, front first.
    start_errors: Vec<BackendError>,
    /// `Some(n)`: a still-PENDING placement turns TIMED_OUT at its n-th describe (the queue's own timeout).
    queue_timeout_polls: Option<u32>,
    /// A stop that races a fulfilment: the placement is fulfilled and the stop is refused.
    fulfil_on_stop: bool,
    describe_errors: u32,
    calls: Vec<Call>,
}

pub struct FakeGameLift {
    s: Mutex<State>,
}

impl FakeGameLift {
    pub fn new(behaviours: &[(&str, RegionBehaviour)]) -> Self {
        Self {
            s: Mutex::new(State {
                behaviours: behaviours
                    .iter()
                    .map(|(r, b)| (r.to_string(), b.clone()))
                    .collect(),
                placements: BTreeMap::new(),
                capacity: Ok(BTreeMap::new()),
                start_errors: Vec::new(),
                queue_timeout_polls: None,
                fulfil_on_stop: false,
                describe_errors: 0,
                calls: Vec::new(),
            }),
        }
    }
    pub fn with_capacity(self, pairs: &[(&str, Option<u32>)]) -> Self {
        self.s.lock().unwrap().capacity = Ok(pairs
            .iter()
            .map(|(r, c)| {
                (
                    r.to_string(),
                    RegionCapacity {
                        available_sessions: *c,
                    },
                )
            })
            .collect());
        self
    }
    pub fn with_capacity_error(self) -> Self {
        self.s.lock().unwrap().capacity = Err(BackendError::Unavailable("cloudwatch down".into()));
        self
    }
    pub fn with_start_errors(self, errs: Vec<BackendError>) -> Self {
        self.s.lock().unwrap().start_errors = errs;
        self
    }
    pub fn with_queue_timeout_polls(self, n: u32) -> Self {
        self.s.lock().unwrap().queue_timeout_polls = Some(n);
        self
    }
    pub fn with_fulfil_on_stop(self) -> Self {
        self.s.lock().unwrap().fulfil_on_stop = true;
        self
    }
    /// The next `n` describe calls fail with `Unavailable`.
    pub fn with_describe_errors(self, n: u32) -> Self {
        self.s.lock().unwrap().describe_errors = n;
        self
    }
    pub fn calls(&self) -> Vec<Call> {
        self.s.lock().unwrap().calls.clone()
    }
    pub fn starts(&self) -> Vec<(String, Vec<String>)> {
        self.calls()
            .into_iter()
            .filter_map(|c| match c {
                Call::Start {
                    placement_id,
                    locations,
                    ..
                } => Some((placement_id, locations)),
                _ => None,
            })
            .collect()
    }
    pub fn terminated(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .filter_map(|c| {
                if let Call::Terminate(a) = c {
                    Some(a)
                } else {
                    None
                }
            })
            .collect()
    }
}

fn arn(region: &str, placement_id: &str) -> String {
    format!("arn:aws:gamelift:{region}::gamesession/fleet-x/{region}/{placement_id}")
}

fn materialise(rec: &mut Rec, queue_timeout: Option<u32>) {
    if rec.state.status != PlacementStatus::Pending {
        return;
    }
    match rec.behaviour.clone() {
        Some(RegionBehaviour::Fulfil {
            after_polls,
            ip,
            port,
        }) if rec.polls >= after_polls => {
            let region = rec.state.region.clone().unwrap();
            rec.state.status = PlacementStatus::Fulfilled;
            rec.state.game_session_arn = Some(arn(&region, &rec.state.placement_id));
            rec.state.ip_address = Some(ip);
            rec.state.port = Some(port);
        }
        Some(RegionBehaviour::Fail) => rec.state.status = PlacementStatus::Failed,
        _ => {
            if queue_timeout.is_some_and(|n| rec.polls >= n) {
                rec.state.status = PlacementStatus::TimedOut;
            }
        }
    }
}

impl GameLiftBackend for FakeGameLift {
    async fn start_placement(&self, req: &StartPlacement) -> Result<PlacementState, BackendError> {
        let mut s = self.s.lock().unwrap();
        s.calls.push(Call::Start {
            placement_id: req.placement_id.clone(),
            locations: req.location_order.clone(),
            fallback: req.fallback.api_name(),
        });
        if let Err(e) = req.validate() {
            return Err(BackendError::Invalid(e));
        }
        if !s.start_errors.is_empty() {
            return Err(s.start_errors.remove(0));
        }
        if s.placements.contains_key(&req.placement_id) {
            return Err(BackendError::AlreadyExists);
        }
        // First listed location that has any scripted behaviour other than NoHost wins; with fallback NONE nothing else is tried.
        let pick = req
            .location_order
            .iter()
            .find(|l| !matches!(s.behaviours.get(*l), None | Some(RegionBehaviour::NoHost)));
        let (region, behaviour) = match pick {
            Some(l) => (Some(l.clone()), s.behaviours.get(l).cloned()),
            None => (None, None),
        };
        let state = PlacementState {
            game_session_data: Some(req.game_session_data.clone()),
            placement_id: req.placement_id.clone(),
            status: PlacementStatus::Pending,
            game_session_arn: None,
            region,
            ip_address: None,
            port: None,
            placed_player_sessions: req
                .players
                .iter()
                .map(|p| (p.clone(), format!("psess-{}-{p}", req.placement_id)))
                .collect(),
        };
        let mut pending = state.clone();
        pending.placed_player_sessions.clear();
        s.placements.insert(
            req.placement_id.clone(),
            Rec {
                state,
                behaviour,
                polls: 0,
            },
        );
        Ok(pending)
    }

    async fn describe_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        let mut s = self.s.lock().unwrap();
        s.calls.push(Call::Describe(id.to_string()));
        if s.describe_errors > 0 {
            s.describe_errors -= 1;
            return Err(BackendError::Unavailable("throttled".into()));
        }
        let qt = s.queue_timeout_polls;
        let rec = s.placements.get_mut(id).ok_or(BackendError::NotFound)?;
        rec.polls += 1;
        materialise(rec, qt);
        Ok(visible(&rec.state))
    }

    async fn stop_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        let mut s = self.s.lock().unwrap();
        s.calls.push(Call::Stop(id.to_string()));
        let race = s.fulfil_on_stop;
        let rec = s.placements.get_mut(id).ok_or(BackendError::NotFound)?;
        if race {
            if let Some(RegionBehaviour::Fulfil { ip, port, .. }) = rec.behaviour.clone() {
                let region = rec.state.region.clone().unwrap();
                rec.state.status = PlacementStatus::Fulfilled;
                rec.state.game_session_arn = Some(arn(&region, id));
                rec.state.ip_address = Some(ip);
                rec.state.port = Some(port);
            }
        }
        if rec.state.status == PlacementStatus::Fulfilled {
            return Err(BackendError::Invalid(
                "a game session has already been created for this placement".into(),
            ));
        }
        if rec.state.status == PlacementStatus::Pending {
            rec.state.status = PlacementStatus::Cancelled;
        }
        Ok(visible(&rec.state))
    }

    async fn terminate_game_session(&self, arn: &str) -> Result<(), BackendError> {
        self.s
            .lock()
            .unwrap()
            .calls
            .push(Call::Terminate(arn.to_string()));
        Ok(())
    }

    async fn capacity(&self) -> Result<BTreeMap<String, RegionCapacity>, BackendError> {
        let mut s = self.s.lock().unwrap();
        s.calls.push(Call::Capacity);
        s.capacity.clone()
    }
}

/// Connection fields and player sessions are only visible once fulfilled (the API says they are not final before).
fn visible(st: &PlacementState) -> PlacementState {
    if st.status == PlacementStatus::Fulfilled {
        st.clone()
    } else {
        PlacementState {
            game_session_arn: None,
            ip_address: None,
            port: None,
            placed_player_sessions: Vec::new(),
            ..st.clone()
        }
    }
}

pub struct FakeDns {
    records: Mutex<BTreeMap<String, String>>,
    upsert_fails: Mutex<u32>,
    /// `resolve_authoritative` answers empty for the first n calls per name (propagation delay).
    resolve_delay: Mutex<u32>,
    resolves: Mutex<BTreeMap<String, u32>>,
    log: Mutex<Vec<String>>,
}

impl FakeDns {
    pub fn new() -> Self {
        Self {
            records: Mutex::new(BTreeMap::new()),
            upsert_fails: Mutex::new(0),
            resolve_delay: Mutex::new(0),
            resolves: Mutex::new(BTreeMap::new()),
            log: Mutex::new(Vec::new()),
        }
    }
    pub fn failing_upserts(self, n: u32) -> Self {
        *self.upsert_fails.lock().unwrap() = n;
        self
    }
    pub fn with_resolve_delay(self, calls: u32) -> Self {
        *self.resolve_delay.lock().unwrap() = calls;
        self
    }
    pub fn records(&self) -> BTreeMap<String, String> {
        self.records.lock().unwrap().clone()
    }
    pub fn log(&self) -> Vec<String> {
        self.log.lock().unwrap().clone()
    }
}

impl Default for FakeDns {
    fn default() -> Self {
        Self::new()
    }
}

impl DnsBackend for FakeDns {
    async fn upsert(&self, name: &str, ip: &str, ttl_s: u32) -> Result<(), BackendError> {
        self.log
            .lock()
            .unwrap()
            .push(format!("upsert {name} {ip} ttl={ttl_s}"));
        let mut f = self.upsert_fails.lock().unwrap();
        if *f > 0 {
            *f -= 1;
            return Err(BackendError::Unavailable("dns api 503".into()));
        }
        if ttl_s < 30 {
            return Err(BackendError::Invalid("ttl below provider minimum".into()));
        }
        self.records
            .lock()
            .unwrap()
            .insert(name.to_string(), ip.to_string());
        Ok(())
    }
    async fn delete(&self, name: &str) -> Result<(), BackendError> {
        self.log.lock().unwrap().push(format!("delete {name}"));
        self.records.lock().unwrap().remove(name);
        Ok(())
    }
    async fn resolve_authoritative(&self, name: &str) -> Result<Vec<String>, BackendError> {
        let delay = *self.resolve_delay.lock().unwrap();
        let mut r = self.resolves.lock().unwrap();
        let n = r.entry(name.to_string()).or_insert(0);
        *n += 1;
        if *n <= delay {
            return Ok(Vec::new());
        }
        Ok(self
            .records
            .lock()
            .unwrap()
            .get(name)
            .cloned()
            .into_iter()
            .collect())
    }
}
