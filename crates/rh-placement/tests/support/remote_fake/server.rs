//! The parent-hosted persistent fake. It follows the rules of `rh_placement::fake` (ids never reused, `AlreadyExists`, stop on
//! a fulfilled placement is `Invalid`, terminate idempotent, `GameSessionData` kept on every receipt, `describe` is `NotFound`
//! until a start is accepted) but keeps its own state so it can be inspected without side effects and controlled.
//!
//! Every request runs in a detached task: the effect never depends on the connection staying open. Controls are rules
//! evaluated when a request ARRIVES (under one lock, so after a [`Barrier`] at [`Stage::Arrived`] fires, the hold is already
//! registered and visible in [`RemoteFake::held`]). Several matching rules compose (for example `hold_effect` then
//! `drop_receipt`); an injected error takes precedence over every other rule.

use super::wire::{Op, WireErr, WireReq, WireResp};
use rh_placement::backend::{BackendError, PlacementState, PlacementStatus};
use rh_placement::fake::RegionBehaviour;
use rh_placement::RegionCapacity;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedReadHalf;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Notify};

/// Which requests a rule applies to: `key` is a PREFIX of the placement id (start/describe/stop), ARN (terminate) or hostname
/// (DNS); `skip` lets that many matches through first; `times` is how many matches the rule then consumes.
#[derive(Clone, Debug)]
pub struct Matcher {
    pub key_prefix: Option<String>,
    pub skip: usize,
    pub times: usize,
}

impl Matcher {
    pub fn any() -> Self {
        Self {
            key_prefix: None,
            skip: 0,
            times: 1,
        }
    }
    pub fn key(prefix: &str) -> Self {
        Self {
            key_prefix: Some(prefix.to_string()),
            skip: 0,
            times: 1,
        }
    }
    pub fn skip(mut self, n: usize) -> Self {
        self.skip = n;
        self
    }
    pub fn times(mut self, n: usize) -> Self {
        self.times = n;
        self
    }
    fn matches(&self, key: &Option<String>) -> bool {
        match (&self.key_prefix, key) {
            (None, _) => true,
            (Some(p), Some(k)) => k.starts_with(p.as_str()),
            (Some(_), None) => false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    Unavailable,
    Invalid,
    NotFound,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    /// The request reached the server (before any hold, error or effect).
    Arrived,
    /// The effect was applied (or refused) and the reply decision is about to be made.
    Applied,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplyState {
    /// Applied; the reply has not been decided yet.
    Pending,
    /// Applied; the reply waits for `release_held`.
    Held,
    Delivered,
    /// Never sent (`drop_receipt`) or the client connection was seen closed.
    Dropped,
}

/// One external mutation, in the order effects were APPLIED (`n` is the index). `seq` is the arrival order of the request, so
/// a late application has `late == true` and a `seq` smaller than its neighbours'.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Mutation {
    pub n: usize,
    pub seq: u64,
    pub op: Op,
    /// Placement id, ARN or hostname of the request.
    pub key: String,
    pub placement_id: Option<String>,
    pub arn: Option<String>,
    pub hostname: Option<String>,
    /// The `GameSessionData` ownership binding (start: sent; stop/terminate: stored on the targeted placement).
    pub binding: Option<String>,
    pub locations: Vec<String>,
    pub late: bool,
    pub reply: ReplyState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CallRecord {
    pub seq: u64,
    pub op: Op,
    pub key: Option<String>,
    /// `ok`, `error:<kind>`, `injected:<kind>`, `held`, `arrived`.
    pub outcome: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HeldKind {
    Effect,
    Reply,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HeldInfo {
    pub id: u64,
    pub seq: u64,
    pub op: Op,
    pub key: Option<String>,
    pub kind: HeldKind,
    /// The requesting connection was seen closed while held.
    pub client_gone: bool,
}

/// Resolves with the arrival `seq` of the request that tripped it.
pub struct Barrier {
    rx: oneshot::Receiver<u64>,
}

impl Barrier {
    pub async fn wait(self) -> u64 {
        self.rx
            .await
            .expect("remote fake dropped before the barrier fired")
    }
}

enum RuleAction {
    DropReceipt,
    HoldEffect,
    HoldReply,
    Fail(BackendError),
}

struct Rule {
    op: Op,
    m: Matcher,
    action: RuleAction,
}

struct BarrierRule {
    op: Op,
    m: Matcher,
    stage: Stage,
    tx: Option<oneshot::Sender<u64>>,
}

struct HeldEntry {
    info: HeldInfo,
    tx: Option<oneshot::Sender<()>>,
}

struct Rec {
    state: PlacementState,
    behaviour: Option<RegionBehaviour>,
    polls: u32,
}

struct Inner {
    behaviours: BTreeMap<String, RegionBehaviour>,
    placements: BTreeMap<String, Rec>,
    capacity: BTreeMap<String, RegionCapacity>,
    queue_timeout_polls: Option<u32>,
    fulfil_on_stop: bool,
    terminated: Vec<String>,
    dns: BTreeMap<String, String>,
    resolve_delay: u32,
    resolves: BTreeMap<String, u32>,
    seq: u64,
    calls: Vec<CallRecord>,
    trace: Vec<Mutation>,
    rules: Vec<Rule>,
    barriers: Vec<BarrierRule>,
    held: BTreeMap<u64, HeldEntry>,
    next_held: u64,
    gone: BTreeSet<u64>,
}

struct Shared {
    inner: Mutex<Inner>,
    gone_notify: Notify,
}

#[derive(Default)]
struct Plan {
    seq: u64,
    drop_receipt: bool,
    hold_effect: Option<(u64, oneshot::Receiver<()>)>,
    hold_reply: Option<(u64, oneshot::Receiver<()>)>,
    fail: Option<BackendError>,
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

impl Inner {
    fn consume(m: &mut Matcher, key: &Option<String>) -> bool {
        if m.times == 0 || !m.matches(key) {
            return false;
        }
        if m.skip > 0 {
            m.skip -= 1;
            return false;
        }
        m.times -= 1;
        true
    }

    fn new_held(
        &mut self,
        seq: u64,
        op: Op,
        key: &Option<String>,
        kind: HeldKind,
    ) -> (u64, oneshot::Receiver<()>) {
        let id = self.next_held;
        self.next_held += 1;
        let (tx, rx) = oneshot::channel();
        self.held.insert(
            id,
            HeldEntry {
                info: HeldInfo {
                    id,
                    seq,
                    op,
                    key: key.clone(),
                    kind,
                    client_gone: false,
                },
                tx: Some(tx),
            },
        );
        (id, rx)
    }

    fn fire_barriers(&mut self, seq: u64, op: Op, key: &Option<String>, stage: Stage) {
        for b in &mut self.barriers {
            if b.tx.is_some() && b.stage == stage && b.op == op && Self::consume(&mut b.m, key) {
                if let Some(tx) = b.tx.take() {
                    let _ = tx.send(seq);
                }
            }
        }
        self.barriers.retain(|b| b.tx.is_some());
    }

    fn arrive(&mut self, req: &WireReq) -> Plan {
        let op = req.op();
        let key = req.key();
        self.seq += 1;
        let seq = self.seq;
        self.calls.push(CallRecord {
            seq,
            op,
            key: key.clone(),
            outcome: "arrived".into(),
        });
        self.fire_barriers(seq, op, &key, Stage::Arrived);
        let mut plan = Plan {
            seq,
            ..Plan::default()
        };
        // An injected error wins over every other rule.
        for r in &mut self.rules {
            if r.op == op
                && matches!(r.action, RuleAction::Fail(_))
                && Self::consume(&mut r.m, &key)
            {
                if let RuleAction::Fail(e) = &r.action {
                    plan.fail = Some(e.clone());
                }
                break;
            }
        }
        if plan.fail.is_none() {
            let mut actions = Vec::new();
            for r in &mut self.rules {
                if r.op == op
                    && !matches!(r.action, RuleAction::Fail(_))
                    && Self::consume(&mut r.m, &key)
                {
                    actions.push(match r.action {
                        RuleAction::DropReceipt => 0,
                        RuleAction::HoldEffect => 1,
                        _ => 2,
                    });
                }
            }
            for a in actions {
                match a {
                    0 => plan.drop_receipt = true,
                    1 if plan.hold_effect.is_none() => {
                        plan.hold_effect = Some(self.new_held(seq, op, &key, HeldKind::Effect));
                    }
                    2 if plan.hold_reply.is_none() => {
                        plan.hold_reply = Some(self.new_held(seq, op, &key, HeldKind::Reply));
                    }
                    _ => {}
                }
            }
        }
        self.rules.retain(|r| r.m.times > 0);
        plan
    }

    fn finish_call(&mut self, seq: u64, outcome: String) {
        if let Some(c) = self.calls.iter_mut().find(|c| c.seq == seq) {
            c.outcome = outcome;
        }
    }

    fn binding_of_arn(&self, arn: &str) -> (Option<String>, Option<String>) {
        for (id, r) in &self.placements {
            if r.state.game_session_arn.as_deref() == Some(arn) {
                return (Some(id.clone()), r.state.game_session_data.clone());
            }
        }
        (None, None)
    }

    #[allow(clippy::too_many_lines)]
    fn apply(
        &mut self,
        req: &WireReq,
        seq: u64,
        late: bool,
    ) -> (Result<WireResp, BackendError>, Option<usize>) {
        let op = req.op();
        let mut m = Mutation {
            n: self.trace.len(),
            seq,
            op,
            key: req.key().unwrap_or_default(),
            placement_id: None,
            arn: None,
            hostname: None,
            binding: None,
            locations: Vec::new(),
            late,
            reply: ReplyState::Pending,
        };
        let res: Result<WireResp, BackendError> = match req {
            WireReq::Start { .. } => {
                let sp = req.to_start().expect("start");
                m.placement_id = Some(sp.placement_id.clone());
                m.binding = Some(sp.game_session_data.clone());
                m.locations = sp.location_order.clone();
                if let Err(e) = sp.validate() {
                    Err(BackendError::Invalid(e))
                } else if self.placements.contains_key(&sp.placement_id) {
                    Err(BackendError::AlreadyExists)
                } else {
                    let pick = sp.location_order.iter().find(|l| {
                        !matches!(
                            self.behaviours.get(*l),
                            None | Some(RegionBehaviour::NoHost)
                        )
                    });
                    let (region, behaviour) = match pick {
                        Some(l) => (Some(l.clone()), self.behaviours.get(l).cloned()),
                        None => (None, None),
                    };
                    let state = PlacementState {
                        game_session_data: Some(sp.game_session_data.clone()),
                        placement_id: sp.placement_id.clone(),
                        status: PlacementStatus::Pending,
                        game_session_arn: None,
                        region,
                        ip_address: None,
                        port: None,
                        placed_player_sessions: sp
                            .players
                            .iter()
                            .map(|p| (p.clone(), format!("psess-{}-{p}", sp.placement_id)))
                            .collect(),
                    };
                    let pending = visible(&state);
                    self.placements.insert(
                        sp.placement_id.clone(),
                        Rec {
                            state,
                            behaviour,
                            polls: 0,
                        },
                    );
                    Ok(WireResp::Placement {
                        state: (&pending).into(),
                    })
                }
            }
            WireReq::Describe { placement_id } => {
                let qt = self.queue_timeout_polls;
                match self.placements.get_mut(placement_id) {
                    None => Err(BackendError::NotFound),
                    Some(rec) => {
                        rec.polls += 1;
                        materialise(rec, qt);
                        Ok(WireResp::Placement {
                            state: (&visible(&rec.state)).into(),
                        })
                    }
                }
            }
            WireReq::Stop { placement_id } => {
                m.placement_id = Some(placement_id.clone());
                let race = self.fulfil_on_stop;
                match self.placements.get_mut(placement_id) {
                    None => Err(BackendError::NotFound),
                    Some(rec) => {
                        m.binding = rec.state.game_session_data.clone();
                        if race {
                            if let Some(RegionBehaviour::Fulfil { ip, port, .. }) =
                                rec.behaviour.clone()
                            {
                                let region = rec.state.region.clone().unwrap();
                                rec.state.status = PlacementStatus::Fulfilled;
                                rec.state.game_session_arn = Some(arn(&region, placement_id));
                                rec.state.ip_address = Some(ip);
                                rec.state.port = Some(port);
                            }
                        }
                        if rec.state.status == PlacementStatus::Fulfilled {
                            Err(BackendError::Invalid(
                                "a game session has already been created for this placement".into(),
                            ))
                        } else {
                            if rec.state.status == PlacementStatus::Pending {
                                rec.state.status = PlacementStatus::Cancelled;
                            }
                            Ok(WireResp::Placement {
                                state: (&visible(&rec.state)).into(),
                            })
                        }
                    }
                }
            }
            WireReq::Terminate { arn } => {
                let (pid, binding) = self.binding_of_arn(arn);
                m.arn = Some(arn.clone());
                m.placement_id = pid;
                m.binding = binding;
                self.terminated.push(arn.clone());
                Ok(WireResp::Unit)
            }
            WireReq::Capacity => Ok(WireResp::Capacity {
                regions: self
                    .capacity
                    .iter()
                    .map(|(k, v)| (k.clone(), v.available_sessions))
                    .collect(),
            }),
            WireReq::DnsUpsert { name, ip, ttl_s } => {
                m.hostname = Some(name.clone());
                if *ttl_s < 30 {
                    Err(BackendError::Invalid("ttl below provider minimum".into()))
                } else {
                    self.dns.insert(name.clone(), ip.clone());
                    Ok(WireResp::Unit)
                }
            }
            WireReq::DnsDelete { name } => {
                m.hostname = Some(name.clone());
                self.dns.remove(name);
                Ok(WireResp::Unit)
            }
            WireReq::DnsResolve { name } => {
                let n = self.resolves.entry(name.clone()).or_insert(0);
                *n += 1;
                if *n <= self.resolve_delay {
                    Ok(WireResp::Addrs { addrs: Vec::new() })
                } else {
                    Ok(WireResp::Addrs {
                        addrs: self.dns.get(name).cloned().into_iter().collect(),
                    })
                }
            }
        };
        let outcome = match &res {
            Ok(_) => "ok".to_string(),
            Err(e) => format!("error:{}", err_name(e)),
        };
        self.finish_call(seq, outcome);
        let idx = if op.is_mutation() && res.is_ok() {
            let i = self.trace.len();
            self.trace.push(m);
            Some(i)
        } else {
            None
        };
        let key = req.key();
        self.fire_barriers(seq, op, &key, Stage::Applied);
        (res, idx)
    }
}

fn err_name(e: &BackendError) -> &'static str {
    match e {
        BackendError::NotFound => "NotFound",
        BackendError::AlreadyExists => "AlreadyExists",
        BackendError::Invalid(_) => "Invalid",
        BackendError::Unavailable(_) => "Unavailable",
    }
}

fn to_backend_error(k: ErrorKind) -> BackendError {
    match k {
        ErrorKind::Unavailable => BackendError::Unavailable("injected unavailable".into()),
        ErrorKind::Invalid => BackendError::Invalid("injected invalid".into()),
        ErrorKind::NotFound => BackendError::NotFound,
    }
}

impl Shared {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    fn set_reply(&self, idx: Option<usize>, st: ReplyState) {
        if let Some(i) = idx {
            self.lock().trace[i].reply = st;
        }
    }
    fn mark_gone(&self, id: u64) {
        let mut g = self.lock();
        g.gone.insert(id);
        if let Some(h) = g.held.get_mut(&id) {
            h.info.client_gone = true;
        }
        drop(g);
        self.gone_notify.notify_waiters();
    }
}

/// Reads until the peer closes (the request line was already consumed).
async fn peer_closed(reader: &mut BufReader<OwnedReadHalf>) {
    let mut buf = [0u8; 256];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
    }
}

/// Waits for a release while watching for the client's connection to close. Returns whether it was seen closed.
async fn hold(
    shared: &Shared,
    reader: &mut BufReader<OwnedReadHalf>,
    id: u64,
    mut rx: oneshot::Receiver<()>,
) -> bool {
    let mut gone = false;
    loop {
        tokio::select! {
            _ = &mut rx => return gone,
            () = peer_closed(reader), if !gone => {
                gone = true;
                shared.mark_gone(id);
            }
        }
    }
}

async fn handle_conn(shared: Arc<Shared>, stream: TcpStream) {
    let (r, mut w) = stream.into_split();
    let mut reader = BufReader::new(r);
    let mut line = String::new();
    {
        let mut limited = (&mut reader).take(1 << 20);
        match limited.read_line(&mut line).await {
            Ok(n) if n > 0 && line.ends_with('\n') => {}
            _ => return, // partial or empty request from a dead client: nothing happened
        }
    }
    let req: WireReq = match serde_json::from_str(line.trim_end()) {
        Ok(r) => r,
        Err(_) => {
            let resp = WireResp::Err {
                err: WireErr::Invalid("malformed request".into()),
            };
            let _ = w
                .write_all(format!("{}\n", serde_json::to_string(&resp).unwrap()).as_bytes())
                .await;
            return;
        }
    };
    let plan = shared.lock().arrive(&req);
    let seq = plan.seq;
    let mut gone = false;
    let mut late = false;
    if let Some((id, rx)) = plan.hold_effect {
        gone |= hold(&shared, &mut reader, id, rx).await;
        shared.lock().held.remove(&id);
        late = true;
    }
    let (res, idx) = if let Some(e) = plan.fail {
        let mut g = shared.lock();
        g.finish_call(seq, format!("injected:{}", err_name(&e)));
        g.fire_barriers(seq, req.op(), &req.key(), Stage::Applied);
        (Err(e), None)
    } else {
        shared.lock().apply(&req, seq, late)
    };
    if plan.drop_receipt {
        shared.set_reply(idx, ReplyState::Dropped);
        // Keep the connection open, silent, until the client gives up.
        peer_closed(&mut reader).await;
        return;
    }
    if let Some((id, rx)) = plan.hold_reply {
        shared.set_reply(idx, ReplyState::Held);
        gone |= hold(&shared, &mut reader, id, rx).await;
        shared.lock().held.remove(&id);
    }
    let resp = match res {
        Ok(r) => r,
        Err(e) => WireResp::Err {
            err: WireErr::from(&e),
        },
    };
    let mut out = serde_json::to_string(&resp).unwrap();
    out.push('\n');
    let delivered = !gone && w.write_all(out.as_bytes()).await.is_ok() && w.flush().await.is_ok();
    shared.set_reply(
        idx,
        if delivered {
            ReplyState::Delivered
        } else {
            ReplyState::Dropped
        },
    );
}

/// The persistent fake. Dropping it stops accepting; in-flight request tasks end with the test runtime.
pub struct RemoteFake {
    addr: SocketAddr,
    shared: Arc<Shared>,
    accept: tokio::task::JoinHandle<()>,
}

impl Drop for RemoteFake {
    fn drop(&mut self) {
        self.accept.abort();
    }
}

impl RemoteFake {
    /// Binds 127.0.0.1:0 and starts serving. `behaviours` as for `FakeGameLift::new`.
    pub async fn spawn(behaviours: &[(&str, RegionBehaviour)]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind remote fake");
        let addr = listener.local_addr().expect("local addr");
        let shared = Arc::new(Shared {
            inner: Mutex::new(Inner {
                behaviours: behaviours
                    .iter()
                    .map(|(r, b)| (r.to_string(), b.clone()))
                    .collect(),
                placements: BTreeMap::new(),
                capacity: BTreeMap::new(),
                queue_timeout_polls: None,
                fulfil_on_stop: false,
                terminated: Vec::new(),
                dns: BTreeMap::new(),
                resolve_delay: 0,
                resolves: BTreeMap::new(),
                seq: 0,
                calls: Vec::new(),
                trace: Vec::new(),
                rules: Vec::new(),
                barriers: Vec::new(),
                held: BTreeMap::new(),
                next_held: 1,
                gone: BTreeSet::new(),
            }),
            gone_notify: Notify::new(),
        });
        let s2 = shared.clone();
        let accept = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        tokio::spawn(handle_conn(s2.clone(), stream));
                    }
                    Err(_) => tokio::task::yield_now().await,
                }
            }
        });
        Self {
            addr,
            shared,
            accept,
        }
    }

    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    // ---- configuration (same knobs as FakeGameLift / FakeDns) ----
    pub fn set_behaviour(&self, region: &str, b: RegionBehaviour) {
        self.shared.lock().behaviours.insert(region.to_string(), b);
    }
    pub fn set_capacity(&self, pairs: &[(&str, Option<u32>)]) {
        self.shared.lock().capacity = pairs
            .iter()
            .map(|(r, c)| {
                (
                    r.to_string(),
                    RegionCapacity {
                        available_sessions: *c,
                    },
                )
            })
            .collect();
    }
    pub fn set_queue_timeout_polls(&self, n: Option<u32>) {
        self.shared.lock().queue_timeout_polls = n;
    }
    pub fn set_fulfil_on_stop(&self, on: bool) {
        self.shared.lock().fulfil_on_stop = on;
    }
    pub fn set_dns_resolve_delay(&self, calls: u32) {
        self.shared.lock().resolve_delay = calls;
    }

    // ---- deterministic controls ----
    fn rule(&self, op: Op, m: Matcher, action: RuleAction) {
        self.shared.lock().rules.push(Rule { op, m, action });
    }
    /// Apply the effect, then never answer (the client sees a hung call; the effect stands).
    pub fn drop_receipt(&self, op: Op, m: Matcher) {
        self.rule(op, m, RuleAction::DropReceipt);
    }
    /// Accept the request but do NOT apply it until `release_held`/`release_all`. The late application is traced (`late`).
    pub fn hold_effect(&self, op: Op, m: Matcher) {
        self.rule(op, m, RuleAction::HoldEffect);
    }
    /// "Start accepted later": an ambiguous start that `describe` answers `NotFound` for until released. A `hold_effect(Start)`.
    pub fn start_accepted_later(&self, m: Matcher) {
        self.hold_effect(Op::Start, m);
    }
    /// Apply now, deliver the reply only when released.
    pub fn hold_reply_after_apply(&self, op: Op, m: Matcher) {
        self.rule(op, m, RuleAction::HoldReply);
    }
    /// Answer with an error and apply nothing.
    pub fn inject_error(&self, op: Op, m: Matcher, kind: ErrorKind) {
        self.rule(op, m, RuleAction::Fail(to_backend_error(kind)));
    }
    /// Fires once for the first matching request at `stage` (arrival order `seq` is the value).
    pub fn notify_on(&self, op: Op, m: Matcher, stage: Stage) -> Barrier {
        let (tx, rx) = oneshot::channel();
        self.shared.lock().barriers.push(BarrierRule {
            op,
            m,
            stage,
            tx: Some(tx),
        });
        Barrier { rx }
    }
    pub fn clear_rules(&self) {
        self.shared.lock().rules.clear();
    }
    /// Releases one held effect/reply. False when it is not held (unknown or already released).
    pub fn release_held(&self, id: u64) -> bool {
        let tx = self
            .shared
            .lock()
            .held
            .get_mut(&id)
            .and_then(|h| h.tx.take());
        tx.is_some_and(|tx| tx.send(()).is_ok())
    }
    pub fn release_all(&self) -> usize {
        let ids: Vec<u64> = self.shared.lock().held.keys().copied().collect();
        ids.into_iter().filter(|id| self.release_held(*id)).count()
    }
    pub fn held(&self) -> Vec<HeldInfo> {
        self.shared
            .lock()
            .held
            .values()
            .filter(|h| h.tx.is_some())
            .map(|h| h.info.clone())
            .collect()
    }
    /// Resolves once the connection of held request `id` has been seen closed (client killed or timed out).
    pub async fn wait_client_gone(&self, id: u64) {
        loop {
            let notified = self.shared.gone_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.shared.lock().gone.contains(&id) {
                return;
            }
            notified.await;
        }
    }

    // ---- read accessors ----
    pub fn trace(&self) -> Vec<Mutation> {
        self.shared.lock().trace.clone()
    }
    pub fn trace_of(&self, op: Op) -> Vec<Mutation> {
        self.trace().into_iter().filter(|m| m.op == op).collect()
    }
    /// Every request that arrived, in arrival order, with its outcome.
    pub fn calls(&self) -> Vec<CallRecord> {
        self.shared.lock().calls.clone()
    }
    /// The raw stored states (no `describe` side effects).
    pub fn placements(&self) -> BTreeMap<String, PlacementState> {
        self.shared
            .lock()
            .placements
            .iter()
            .map(|(k, v)| (k.clone(), v.state.clone()))
            .collect()
    }
    pub fn dns(&self) -> BTreeMap<String, String> {
        self.shared.lock().dns.clone()
    }
    pub fn terminated(&self) -> Vec<String> {
        self.shared.lock().terminated.clone()
    }
    pub fn trace_json(&self) -> String {
        serde_json::to_string_pretty(&self.trace()).unwrap_or_default()
    }
}
