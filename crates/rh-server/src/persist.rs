//! Credentials and durable results, behind small enums so the server builds with no database. `Memory` is the local-play
//! and test store: results are idempotent by (match, profile); by default its leases are never held against anyone, and
//! [`MemoryStore::strict`] models the durable lease rules (one live lease per profile, fenced release, a result write that
//! is refused without the live lease and releases it in the same step) so the director's ownership can be tested without
//! a database. `Postgres` (feature `postgres`) is rh-persist, the real transactional store.

use crate::room::{MatchId, Roster};
use rh_sim::RunResult;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::Instant;

/// Process ownership follows the authenticated row, even across callsign changes.
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub(crate) enum ProfileKey {
    Local(String),
    Durable(i64),
}
impl From<&str> for ProfileKey {
    fn from(name: &str) -> Self {
        Self::Local(name.to_ascii_lowercase())
    }
}
impl From<String> for ProfileKey {
    fn from(name: String) -> Self {
        Self::from(name.as_str())
    }
}
impl ProfileKey {
    pub fn from_report(profile: &str, id: Option<i64>) -> Self {
        id.map_or_else(|| Self::from(profile), Self::Durable)
    }
    pub fn id(&self) -> Option<i64> {
        match self {
            Self::Durable(id) => Some(*id),
            Self::Local(_) => None,
        }
    }
    fn memory_name(&self) -> Result<&str, String> {
        match self {
            Self::Local(name) => Ok(name),
            Self::Durable(_) => Err("durable identity used with memory lease".into()),
        }
    }
}

pub enum Auth {
    /// Local development: any well-formed callsign; the ticket is not checked.
    Dev,
    /// callsign (lower-cased) -> token.
    Static(HashMap<String, String>),
    #[cfg(feature = "postgres")]
    Postgres(std::sync::Arc<rh_persist::Store>),
}

impl Auth {
    /// Whether `ticket` (the Hello's opaque admission credential) admits `profile`. Without a hosting layer the ticket is the
    /// callsign's secret as UTF-8 bytes; what P-HOST-1 puts in it (a player-session id, a signed join token) is checked here, at
    /// the same place in the admission order, and never reaches the room.
    pub async fn verify(&self, profile: &str, ticket: &[u8]) -> bool {
        match self {
            Auth::Dev => true,
            Auth::Static(m) => m
                .get(&profile.to_ascii_lowercase())
                .is_some_and(|t| t.as_bytes() == ticket),
            #[cfg(feature = "postgres")]
            Auth::Postgres(store) => match std::str::from_utf8(ticket) {
                Ok(token) => store.verify_token(profile, token).await.unwrap_or(false),
                Err(_) => false,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Recorded {
    Applied,
    AlreadyApplied,
}

/// Why a result write did not land.
#[derive(Debug, Clone, PartialEq)]
pub enum RecordError {
    /// The store refused it for good (no live lease for this match, or a newer fence): a retry can never succeed, and
    /// the lease is no longer this write's to release.
    Refused(String),
    /// The store rejected the data itself (invalid input, a constraint or data-exception violation, a decode error):
    /// retrying the identical write can never succeed. Handled like [`RecordError::Refused`] (dead-lettered, never
    /// retried); kept separate so logs and metrics can tell a refusal by the rules from a poisoned record.
    Permanent(String),
    /// I/O or connection trouble: worth a retry, however long it lasts.
    Transient(String),
}

impl std::fmt::Display for RecordError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecordError::Refused(e) => write!(f, "refused ({e})"),
            RecordError::Permanent(e) => write!(f, "permanent store error ({e})"),
            RecordError::Transient(e) => f.write_str(e),
        }
    }
}

/// Splits a store error into permanent (the record itself is bad) and transient (try again); see
/// [`rh_persist::Error::is_permanent`].
#[cfg(feature = "postgres")]
pub fn classify_store_error(e: &rh_persist::Error) -> RecordError {
    if e.is_permanent() {
        RecordError::Permanent(e.to_string())
    } else {
        RecordError::Transient(e.to_string())
    }
}

/// One profile's lease in a strict [`MemoryStore`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemLease {
    pub match_id: MatchId,
    pub fence: i64,
    pub released: bool,
    pub expires_at: Instant,
}

#[derive(Default)]
pub struct MemoryStore {
    pub fences: Mutex<HashMap<String, i64>>,
    pub results: Mutex<Vec<(MatchId, String, RunResult)>>,
    pub(crate) applied: Mutex<HashSet<(MatchId, String)>>,
    /// `Some` in strict mode: the lease table, with rh-persist's rules (`acquire_lease`, `release_lease`,
    /// `record_result`) including expiry. tests/lease_conformance.rs runs one case table against this and rh-persist.
    pub leases: Option<Mutex<HashMap<String, MemLease>>>,
    /// Strict mode (tests): how long a lease release and a result write take, on the tokio clock (a database round trip).
    pub release_delay: std::time::Duration,
    pub record_delay: std::time::Duration,
    pub renew_delay: Duration,
}

impl MemoryStore {
    /// A store whose leases follow the durable rules (see [`MemoryStore::leases`]).
    pub fn strict() -> Self {
        Self {
            leases: Some(Mutex::new(HashMap::new())),
            ..Self::default()
        }
    }

    fn acquire(
        &self,
        profile: &str,
        m: MatchId,
        ttl: Duration,
        reuse_match: bool,
    ) -> Result<HeldLease, String> {
        let key = profile.to_ascii_lowercase();
        let Some(leases) = &self.leases else {
            let mut f = self.fences.lock().expect("fences");
            let e = f.entry(key).or_insert(0);
            *e += 1;
            return Ok(HeldLease::memory(*e));
        };
        let mut l = leases.lock().expect("leases");
        match l.get(&key).copied() {
            // The same match's live lease is kept (idempotent); another match's live lease is held against us.
            Some(old) if reuse_match && !old.released && old.match_id == m => {
                l.get_mut(&key).expect("present lease").expires_at = Instant::now() + ttl;
                Ok(HeldLease::memory(old.fence))
            }
            Some(old) if !old.released && old.expires_at >= Instant::now() => {
                Err("lease refused: held by another match".into())
            }
            old => {
                let fence = old.map_or(1, |o| o.fence + 1);
                let lease = MemLease {
                    match_id: m,
                    fence,
                    released: false,
                    expires_at: Instant::now() + ttl,
                };
                l.insert(key, lease);
                Ok(HeldLease::memory(fence))
            }
        }
    }

    /// The profile's lease (strict mode only).
    pub fn lease(&self, profile: &str) -> Option<MemLease> {
        let l = self.leases.as_ref()?.lock().expect("leases");
        l.get(&profile.to_ascii_lowercase()).copied()
    }
}

/// The identity captured at acquisition. Renewals never resolve a mutable callsign.
#[derive(Clone, Copy, Debug)]
pub(crate) struct HeldLease {
    pub fence: i64,
    #[cfg(feature = "postgres")]
    profile_id: Option<i64>,
}
impl HeldLease {
    fn memory(fence: i64) -> Self {
        Self {
            fence,
            #[cfg(feature = "postgres")]
            profile_id: None,
        }
    }
}

pub enum Persistence {
    Memory(Box<MemoryStore>),
    #[cfg(feature = "postgres")]
    Postgres {
        store: std::sync::Arc<rh_persist::Store>,
        owner: String,
        held: Mutex<CompatibilityReceipts>,
    },
}

/// Live matches only remember whether a callsign has ever changed hands. Exact
/// legacy receipts are created only by explicit calls to the name/fence API.
#[cfg(feature = "postgres")]
#[derive(Default)]
pub struct CompatibilityReceipts {
    names: HashMap<String, Option<i64>>,
    captures: HashSet<(String, i64)>,
}
#[cfg(feature = "postgres")]
impl CompatibilityReceipts {
    fn note(&mut self, name: &str, fence: i64, id: i64, compatibility: bool) {
        let name = name.to_ascii_lowercase();
        self.names
            .entry(name.clone())
            .and_modify(|known| {
                if *known != Some(id) {
                    *known = None
                }
            })
            .or_insert(Some(id));
        if compatibility {
            self.captures.insert((name, fence));
        }
    }
    fn identity(&self, name: &str) -> Result<Option<i64>, String> {
        match self.names.get(&name.to_ascii_lowercase()) {
            Some(None) => Err("ambiguous callsign/fence; use the admitted profile ID".into()),
            Some(Some(id)) => Ok(Some(*id)),
            None => Ok(None),
        }
    }
    fn captured(&self, name: &str, fence: i64) -> Result<Option<i64>, String> {
        let id = self.identity(name)?;
        Ok(id.filter(|_| self.captures.contains(&(name.to_ascii_lowercase(), fence))))
    }
}

impl Persistence {
    pub fn memory() -> Self {
        Persistence::Memory(Box::default())
    }

    /// The durable store (rh-persist); `owner` names this host in its leases.
    #[cfg(feature = "postgres")]
    pub fn postgres(store: std::sync::Arc<rh_persist::Store>, owner: String) -> Self {
        Persistence::Postgres {
            store,
            owner,
            held: Mutex::default(),
        }
    }

    /// Takes the profile's session lease for this match; returns its fence.
    pub async fn acquire(&self, profile: &str, m: MatchId) -> Result<i64, String> {
        self.acquire_for(profile, m, crate::director::LeasePolicy::default().ttl)
            .await
            .map(|held| held.fence)
    }

    pub(crate) async fn acquire_for(
        &self,
        profile: &str,
        m: MatchId,
        ttl: Duration,
    ) -> Result<HeldLease, String> {
        match self {
            Self::Memory(s) => s.acquire(profile, m, ttl, true),
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, owner, held } => {
                let lease = store
                    .acquire_lease(profile, uuid::Uuid::from_bytes(m), owner, ttl)
                    .await
                    .map_err(|e| format!("lease refused: {e}"))?;
                held.lock()
                    .expect("held")
                    .note(profile, lease.fence, lease.profile_id, true);
                Ok(HeldLease {
                    fence: lease.fence,
                    profile_id: Some(lease.profile_id),
                })
            }
        }
    }

    /// Resolve identity once before any wait for a leaving seat. On production auth
    /// the very query verifying the credential supplies the durable profile id.
    pub(crate) async fn authenticate(
        &self,
        auth: &Auth,
        profile: &str,
        ticket: &[u8],
    ) -> Option<ProfileKey> {
        #[cfg(feature = "postgres")]
        if let Auth::Postgres(db) = auth {
            let id = db
                .verify_token_id(profile, std::str::from_utf8(ticket).ok()?)
                .await
                .ok()??;
            return Some(match self {
                Self::Memory(_) => ProfileKey::from(profile),
                Self::Postgres { .. } => ProfileKey::Durable(id),
            });
        }
        if !auth.verify(profile, ticket).await {
            return None;
        }
        #[cfg(feature = "postgres")]
        if let Self::Postgres { store, .. } = self {
            return store
                .profile_id(profile)
                .await
                .ok()?
                .map(ProfileKey::Durable);
        }
        Some(ProfileKey::from(profile))
    }

    /// Commit ownership only after the row was acquired within the admission budget.
    /// If the caller abandons the handoff while COMMIT is in flight, the commit task
    /// gives back its own fresh fence by id. It cannot release a later admission.
    pub(crate) async fn acquire_live(
        &self,
        key: &ProfileKey,
        m: MatchId,
        profile: &str,
        policy: crate::director::LeasePolicy,
    ) -> Result<HeldLease, String> {
        #[cfg(feature = "postgres")]
        if let (Self::Postgres { store, owner, held }, ProfileKey::Durable(id)) = (self, key) {
            let mid = uuid::Uuid::from_bytes(m);
            let (tx, fence, writing_xid) = store
                .prepare_live_lease(*id, mid, owner, policy.ttl, policy.db_timeout)
                .await
                .map_err(|e| format!("lease refused: {e}"))?;
            let id = *id;
            let store = store.clone();
            let (send, receive) = tokio::sync::oneshot::channel();
            let (accept, accepted) = tokio::sync::oneshot::channel();
            tokio::spawn(async move {
                let result = tx.commit().await.map_err(|e| e.to_string());
                let _ = send.send(result);
                if accepted.await.is_err() {
                    let _ = store
                        .release_unclaimed_acquire(id, mid, fence, &writing_xid)
                        .await;
                }
            });
            receive.await.map_err(|_| "lease commit interrupted")??;
            held.lock().expect("held").note(profile, fence, id, false);
            let _ = accept.send(());
            return Ok(HeldLease {
                fence,
                profile_id: Some(id),
            });
        }
        let _ = profile;
        match self {
            Self::Memory(store) => store.acquire(key.memory_name()?, m, policy.ttl, false),
            #[cfg(feature = "postgres")]
            Self::Postgres { .. } => Err("missing durable identity".into()),
        }
    }

    pub(crate) async fn release_live(
        &self,
        key: &ProfileKey,
        m: MatchId,
        fence: i64,
    ) -> Result<bool, String> {
        #[cfg(feature = "postgres")]
        if let (Self::Postgres { store, .. }, ProfileKey::Durable(id)) = (self, key) {
            return store
                .release_match_lease_by_id(*id, uuid::Uuid::from_bytes(m), fence)
                .await
                .map_err(|e| e.to_string());
        }
        self.release_for_match(key.memory_name()?, m, fence).await
    }

    /// A false answer means the fenced row is released or belongs to a different admission.
    pub(crate) async fn renew(
        &self,
        key: &ProfileKey,
        m: MatchId,
        lease: HeldLease,
        ttl: Duration,
    ) -> Result<bool, String> {
        match self {
            Persistence::Memory(s) => {
                let Some(leases) = &s.leases else {
                    return Ok(true);
                };
                if !s.renew_delay.is_zero() {
                    tokio::time::sleep(s.renew_delay).await;
                }
                let mut leases = leases.lock().expect("leases");
                let Some(row) = leases.get_mut(key.memory_name()?).filter(|row| {
                    row.match_id == m
                        && row.fence == lease.fence
                        && !row.released
                        && row.expires_at > Instant::now()
                }) else {
                    return Ok(false);
                };
                row.expires_at = Instant::now() + ttl;
                Ok(true)
            }
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, .. } => {
                let id = lease
                    .profile_id
                    .ok_or("missing acquired profile identity")?;
                store
                    .try_renew_live_lease(id, uuid::Uuid::from_bytes(m), lease.fence, ttl)
                    .await
                    .map_err(|e| e.to_string())
            }
        }
    }

    /// Gives back a session lease that will not carry a result (a lobby leave, a closed room).
    pub async fn release(&self, profile: &str, fence: i64) -> Result<bool, String> {
        self.release_owned(profile, None, fence).await
    }

    pub async fn release_for_match(
        &self,
        profile: &str,
        m: MatchId,
        fence: i64,
    ) -> Result<bool, String> {
        self.release_owned(profile, Some(m), fence).await
    }

    async fn release_owned(
        &self,
        profile: &str,
        m: Option<MatchId>,
        fence: i64,
    ) -> Result<bool, String> {
        match self {
            Persistence::Memory(s) => {
                let Some(leases) = &s.leases else {
                    return Ok(true);
                };
                if !s.release_delay.is_zero() {
                    tokio::time::sleep(s.release_delay).await;
                }
                let mut l = leases.lock().expect("leases");
                match l.get_mut(&profile.to_ascii_lowercase()) {
                    Some(x)
                        if x.fence == fence
                            && !x.released
                            && m.is_none_or(|id| id == x.match_id) =>
                    {
                        x.released = true;
                        Ok(true)
                    }
                    _ => Ok(false),
                }
            }
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, held, .. } => {
                let Some(id) = held.lock().expect("held").captured(profile, fence)? else {
                    return Ok(false);
                };
                let released = match m {
                    Some(m) => {
                        store
                            .release_match_lease_by_id(id, uuid::Uuid::from_bytes(m), fence)
                            .await
                    }
                    None => store.release_lease_by_id(id, fence).await,
                }
                .map_err(|e| e.to_string())?;
                Ok(released)
            }
        }
    }

    /// Whether results land in PostgreSQL (the only store a spool record can be replayed into).
    pub fn is_durable(&self) -> bool {
        match self {
            Persistence::Memory(_) => false,
            #[cfg(feature = "postgres")]
            Persistence::Postgres { .. } => true,
        }
    }

    /// The match metadata this process would record for a result now (owner, this build, this content). The spool
    /// captures it when the result is produced so that a replay by another build still writes the original values.
    #[cfg(feature = "postgres")]
    pub(crate) fn spool_meta(&self, roster: Roster) -> Option<crate::spool::SpoolMeta> {
        match self {
            Persistence::Postgres { owner, .. } => Some(crate::spool::SpoolMeta::from_persist(
                &pg::match_meta(owner, roster),
            )),
            Persistence::Memory(_) => None,
        }
    }

    /// Replays a spooled record through the same fenced `record_result_by_id` transaction as a live result, with the
    /// ORIGINAL profile id, fence, result document and match metadata. It never acquires, renews or releases a lease:
    /// a newer owner's fence makes it `Refused("StaleFence")`, a released or foreign lease `Refused("NoLease")`, and a
    /// duplicate `AlreadyApplied` (the store answers that before it looks at the lease).
    #[cfg(feature = "postgres")]
    pub async fn record_spooled(
        &self,
        rec: &crate::spool::SpoolRecord,
    ) -> Result<Recorded, RecordError> {
        let Persistence::Postgres { store, .. } = self else {
            return Err(RecordError::Refused("no durable store".into()));
        };
        let mid = rec
            .match_uuid()
            .map_err(|e| RecordError::Refused(format!("bad match id: {e}")))?;
        let outcome = store
            .record_result_by_id_at(
                mid,
                rec.profile_id,
                rec.fence,
                &rec.result,
                &rec.meta.to_persist(),
                Some(rec.spooled_at_ms),
            )
            .await
            .map_err(|e| classify_store_error(&e))?;
        match outcome {
            rh_persist::RecordOutcome::Applied { .. } => Ok(Recorded::Applied),
            rh_persist::RecordOutcome::AlreadyApplied => Ok(Recorded::AlreadyApplied),
            other
            @ (rh_persist::RecordOutcome::NoLease | rh_persist::RecordOutcome::StaleFence) => {
                Err(RecordError::Refused(format!("{other:?}")))
            }
        }
    }

    /// Compatibility wrapper for callers with a callsign. Refuses an observed reassignment:
    /// the tuple (name, match, fence) can name two different profiles. Live directors use
    /// the authenticated ID and never enter this lookup.
    /// Banks one result under its lease fence, idempotent by (match, profile). A refusal that can never succeed
    /// (`NoLease`, `StaleFence`) is [`RecordError::Refused`]; only a [`RecordError::Transient`] one is worth a retry.
    pub async fn record(
        &self,
        m: MatchId,
        profile: &str,
        fence: i64,
        r: &RunResult,
        roster: Roster,
    ) -> Result<Recorded, RecordError> {
        self.record_with_id(m, profile, fence, r, roster, None)
            .await
    }

    /// For trusted result reporters that captured a PostgreSQL identity at admission.
    pub async fn record_by_id(
        &self,
        m: MatchId,
        id: i64,
        fence: i64,
        result: &RunResult,
        roster: Roster,
    ) -> Result<Recorded, RecordError> {
        self.record_with_id(m, &result.profile, fence, result, roster, Some(id))
            .await
    }

    pub(crate) async fn record_with_id(
        &self,
        m: MatchId,
        profile: &str,
        fence: i64,
        r: &RunResult,
        roster: Roster,
        durable_id: Option<i64>,
    ) -> Result<Recorded, RecordError> {
        #[cfg(not(feature = "postgres"))]
        let _ = durable_id;
        match self {
            Persistence::Memory(s) => {
                // The in-memory store keeps no match rows, so it has no use for the roster (the Postgres arm does).
                let _ = &roster;
                if s.leases.is_some() && !s.record_delay.is_zero() {
                    tokio::time::sleep(s.record_delay).await;
                }
                let key = (m, profile.to_ascii_lowercase());
                let mut applied = s.applied.lock().expect("applied");
                if applied.contains(&key) {
                    return Ok(Recorded::AlreadyApplied);
                }
                if let Some(leases) = &s.leases {
                    // rh-persist's checks in its order; the write releases the lease in the same step.
                    let mut l = leases.lock().expect("leases");
                    let Some(lease) = l.get_mut(&key.1) else {
                        return Err(RecordError::Refused("NoLease".into()));
                    };
                    if lease.fence != fence {
                        return Err(RecordError::Refused("StaleFence".into()));
                    }
                    if lease.released || lease.match_id != m {
                        return Err(RecordError::Refused("NoLease".into()));
                    }
                    lease.released = true;
                }
                applied.insert(key);
                drop(applied);
                s.results
                    .lock()
                    .expect("results")
                    .push((m, profile.to_string(), r.clone()));
                Ok(Recorded::Applied)
            }
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, owner, held } => {
                let res = crate::persist::pg::to_persist(r);
                let meta = crate::persist::pg::match_meta(owner, roster);
                let mid = uuid::Uuid::from_bytes(m);
                let id = match durable_id {
                    Some(id) => id,
                    None => match {
                        let held = held.lock().expect("held");
                        held.captured(profile, fence)
                    }
                    .map_err(RecordError::Refused)?
                    {
                        Some(id) => id,
                        None => {
                            // Retain diagnostic/idempotent replies for old callers with a wrong fence,
                            // but never write or resolve a mutable callsign without a receipt.
                            let known = held
                                .lock()
                                .expect("held")
                                .identity(profile)
                                .map_err(RecordError::Refused)?;
                            let Some(id) = known else {
                                return Err(RecordError::Refused("NoLease".into()));
                            };
                            let (applied, stale) = store
                                .result_fence_status(id, mid, fence)
                                .await
                                .map_err(|e| RecordError::Transient(e.to_string()))?;
                            return if applied {
                                Ok(Recorded::AlreadyApplied)
                            } else {
                                Err(RecordError::Refused(
                                    if stale { "StaleFence" } else { "NoLease" }.into(),
                                ))
                            };
                        }
                    },
                };
                let outcome = store
                    .record_result_by_id(mid, id, fence, &res, &meta)
                    .await
                    .map_err(|e| classify_store_error(&e))?;
                match outcome {
                    rh_persist::RecordOutcome::Applied { .. } => Ok(Recorded::Applied),
                    rh_persist::RecordOutcome::AlreadyApplied => Ok(Recorded::AlreadyApplied),
                    other @ (rh_persist::RecordOutcome::NoLease
                    | rh_persist::RecordOutcome::StaleFence) => {
                        Err(RecordError::Refused(format!("{other:?}")))
                    }
                }
            }
        }
    }
}

#[cfg(feature = "postgres")]
pub mod pg {
    //! Mapping from the simulation's RunResult to rh-persist's MatchResult (the legacy RunResult shape).
    use rh_sim::sim::Outcome;

    /// The `matches` row of a match: the host that played it, the build and rules it ran under, and who was in it. Region and
    /// placement id stay unset until the hosting adapter reports them (P-HOST-1).
    pub fn match_meta(owner: &str, roster: super::Roster) -> rh_persist::MatchMeta {
        rh_persist::MatchMeta {
            owner: owner.to_owned(),
            region: None,
            placement_id: None,
            build: rh_sim::replay::BUILD_ID.to_owned(),
            content_hash: rh_sim::content::content_hash(),
            humans: roster.humans,
            bots: roster.bots,
        }
    }

    /// Every field of the private simulation result is retained, including the explicit faction
    /// choice and carried item captured after the legacy body-drop order.
    pub fn to_persist(r: &rh_sim::RunResult) -> rh_persist::MatchResult {
        let g = &r.gv;
        rh_persist::MatchResult {
            outcome: Some(match r.outcome {
                Outcome::Won => rh_persist::Outcome::Won,
                Outcome::Draw => rh_persist::Outcome::Draw,
                Outcome::Died => rh_persist::Outcome::Died,
                Outcome::Mia => rh_persist::Outcome::Mia,
            }),
            kills: r.kills as i64,
            gv: rh_persist::GvBreakdown {
                kills: g.kills as i64,
                mobs: g.mobs as i64,
                bounty: g.bounty as i64,
                quest: g.quest as i64,
                win: g.win as i64,
                total: g.total as i64,
            },
            faction: r.faction.map(|f| f.as_str().to_owned()),
            weapon: r.weapon.map(|w| w.as_str().to_owned()),
            win_qualified: r.outcome == Outcome::Won && !r.win_bonus_withheld,
            duration_sec: i64::from(r.duration_sec),
            killed_by: r.killed_by.clone(),
            killed_by_bot: r.killed_by_bot,
            place: i64::from(r.place),
            players: i64::from(r.players),
            win_bonus_withheld: r.win_bonus_withheld,
            // Durable spellings (append only): stored in match records.
            win_bonus_why: r.win_bonus_why.map(|w| {
                match w {
                    rh_sim::results::WinBonusWhy::Starters => "starters",
                    rh_sim::results::WinBonusWhy::Opponents => "opponents",
                }
                .to_owned()
            }),
        }
    }
}
