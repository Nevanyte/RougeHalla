//! Credentials and durable results, behind small enums so the server builds with no database. `Memory` is the local-play
//! and test store: results are idempotent by (match, profile); by default its leases are never held against anyone, and
//! [`MemoryStore::strict`] models the durable lease rules (one live lease per profile, fenced release, a result write that
//! is refused without the live lease and releases it in the same step) so the director's ownership can be tested without
//! a database. `Postgres` (feature `postgres`) is rh-persist, the real transactional store.

use crate::room::MatchId;
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
    },
}

impl Persistence {
    pub fn memory() -> Self {
        Persistence::Memory(Box::default())
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
            Persistence::Postgres { store, owner } => {
                let lease = store
                    .acquire_lease(
                        profile,
                        uuid::Uuid::from_bytes(m),
                        owner,
                        std::time::Duration::from_secs(3600),
                    )
                    .await
                    .map_err(|e| format!("lease refused: {e}"))?;
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
            Persistence::Postgres { store, .. } => store
                .release_lease(profile, fence)
                .await
                .map_err(|e| e.to_string()),
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
    ) -> Result<Recorded, RecordError> {
        match self {
            Persistence::Memory(s) => {
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
            Persistence::Postgres { store, .. } => {
                let res = crate::persist::pg::to_persist(r);
                match store
                    .record_result(uuid::Uuid::from_bytes(m), profile, fence, &res)
                    .await
                    .map_err(|e| RecordError::Transient(e.to_string()))?
                {
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

    /// Faction and weapon per-win counters need the player's faction and weapon at the end, which RunResult does not carry
    /// yet (docs/backlog P-PERSIST-2).
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
        }
    }
}
