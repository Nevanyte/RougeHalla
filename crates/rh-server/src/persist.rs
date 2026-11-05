//! Credentials and durable results, behind small enums so the server builds with no database. `Memory` is the local-play
//! and test store: results are idempotent by (match, profile); by default its leases are never held against anyone, and
//! [`MemoryStore::strict`] models the durable lease rules (one live lease per profile, fenced release, a result write that
//! is refused without the live lease and releases it in the same step) so the director's ownership can be tested without
//! a database. `Postgres` (feature `postgres`) is rh-persist, the real transactional store.

use crate::room::{MatchId, Roster};
use rh_sim::RunResult;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

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
    /// I/O or connection trouble: worth a retry.
    Transient(String),
}

impl std::fmt::Display for RecordError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecordError::Refused(e) => write!(f, "refused ({e})"),
            RecordError::Transient(e) => f.write_str(e),
        }
    }
}

/// One profile's lease in a strict [`MemoryStore`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemLease {
    pub match_id: MatchId,
    pub fence: i64,
    pub released: bool,
}

#[derive(Default)]
pub struct MemoryStore {
    pub fences: Mutex<HashMap<String, i64>>,
    pub results: Mutex<Vec<(MatchId, String, RunResult)>>,
    pub(crate) applied: Mutex<HashSet<(MatchId, String)>>,
    /// `Some` in strict mode: the lease table, with rh-persist's rules (`acquire_lease`, `release_lease`,
    /// `record_result`) minus expiry. tests/lease_conformance.rs runs one case table against this and rh-persist.
    pub leases: Option<Mutex<HashMap<String, MemLease>>>,
    /// Strict mode (tests): how long a lease release and a result write take, on the tokio clock (a database round trip).
    pub release_delay: std::time::Duration,
    pub record_delay: std::time::Duration,
}

impl MemoryStore {
    /// A store whose leases follow the durable rules (see [`MemoryStore::leases`]).
    pub fn strict() -> Self {
        Self {
            leases: Some(Mutex::new(HashMap::new())),
            ..Self::default()
        }
    }

    /// The profile's lease (strict mode only).
    pub fn lease(&self, profile: &str) -> Option<MemLease> {
        let l = self.leases.as_ref()?.lock().expect("leases");
        l.get(&profile.to_ascii_lowercase()).copied()
    }
}

pub enum Persistence {
    Memory(Box<MemoryStore>),
    #[cfg(feature = "postgres")]
    Postgres {
        store: std::sync::Arc<rh_persist::Store>,
        owner: String,
        /// The `profile_id` each live lease was admitted under, by `(lower-cased admission callsign, fence)`. Every call after
        /// admission (release, result) goes by this id, so a rename of the profile mid-match cannot lose the result or
        /// strand the lease. A miss (a process that did not admit it) falls back to the callsign. Entries are replaced by
        /// the next admission under the same name, so the map holds at most one per distinct name.
        held: Mutex<HashMap<(String, i64), i64>>,
    },
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
            held: Mutex::new(HashMap::new()),
        }
    }

    /// Takes the profile's session lease for this match; returns its fence.
    pub async fn acquire(&self, profile: &str, m: MatchId) -> Result<i64, String> {
        match self {
            Persistence::Memory(s) => {
                let key = profile.to_ascii_lowercase();
                let Some(leases) = &s.leases else {
                    let mut f = s.fences.lock().expect("fences");
                    let e = f.entry(key).or_insert(0);
                    *e += 1;
                    return Ok(*e);
                };
                let mut l = leases.lock().expect("leases");
                match l.get(&key).copied() {
                    // The same match's live lease is kept (idempotent); another match's live lease is held against us.
                    Some(old) if !old.released && old.match_id == m => Ok(old.fence),
                    Some(old) if !old.released => {
                        Err("lease refused: held by another match".into())
                    }
                    old => {
                        let fence = old.map_or(1, |o| o.fence + 1);
                        let lease = MemLease {
                            match_id: m,
                            fence,
                            released: false,
                        };
                        l.insert(key, lease);
                        Ok(fence)
                    }
                }
            }
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, owner, held } => {
                let lease = store
                    .acquire_lease(
                        profile,
                        uuid::Uuid::from_bytes(m),
                        owner,
                        std::time::Duration::from_secs(3600),
                    )
                    .await
                    .map_err(|e| format!("lease refused: {e}"))?;
                // One entry per admission name: a newer admission replaces the older ones (a duplicate report for a finished
                // lease keeps resolving to the profile it was earned by, never to whoever holds the name now).
                let name = profile.to_ascii_lowercase();
                let mut held = held.lock().expect("held");
                held.retain(|(n, _), _| *n != name);
                held.insert((name, lease.fence), lease.profile_id);
                Ok(lease.fence)
            }
        }
    }

    /// Gives back a session lease that will not carry a result (a lobby leave, a closed room).
    pub async fn release(&self, profile: &str, fence: i64) -> Result<bool, String> {
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
                    Some(x) if x.fence == fence && !x.released => {
                        x.released = true;
                        Ok(true)
                    }
                    _ => Ok(false),
                }
            }
            #[cfg(feature = "postgres")]
            Persistence::Postgres { store, held, .. } => {
                let key = (profile.to_ascii_lowercase(), fence);
                let id = held.lock().expect("held").get(&key).copied();
                let released = match id {
                    Some(id) => store.release_lease_by_id(id, fence).await,
                    None => store.release_lease(profile, fence).await,
                }
                .map_err(|e| e.to_string())?;
                Ok(released)
            }
        }
    }

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
                let key = (profile.to_ascii_lowercase(), fence);
                let id = held.lock().expect("held").get(&key).copied();
                let mid = uuid::Uuid::from_bytes(m);
                let outcome = match id {
                    Some(id) => store.record_result_by_id(mid, id, fence, &res, &meta).await,
                    None => store.record_result(mid, profile, fence, &res, &meta).await,
                }
                .map_err(|e| RecordError::Transient(e.to_string()))?;
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

    /// Every field of the `RunResult` is kept (the record is stored whole). The per-win faction and weapon counters need the
    /// player's faction and weapon at the end, which RunResult does not carry yet (docs/backlog P-PERSIST-2), so those two
    /// stay `None`.
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
            faction: None,
            weapon: None,
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
