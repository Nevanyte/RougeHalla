//! Native quest observation. Public wire transport remains gated until its codecs are implemented.
//! Preparation never grants authority; callers commit only after all related output has been accepted for delivery.
use std::collections::{BTreeMap, BTreeSet};
use std::num::NonZeroU32;

use crate::quests::{catalog, live::Status};
use crate::{validate, Command, PlayerId, RawCommand, Sim, Vec2};

/// A quest-only presentation identity, never an actor reference or a target handle.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub struct RosterId(NonZeroU32);
impl RosterId {
    pub fn get(self) -> u32 {
        self.0.get()
    }
}
/// A seat-scoped quest-row identity. A preview carries this but cannot authorize acceptance.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub struct QuestHandle(NonZeroU32);
impl QuestHandle {
    pub fn get(self) -> u32 {
        self.0.get()
    }
    pub fn new(value: u32) -> Option<Self> {
        NonZeroU32::new(value).map(Self)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RowState {
    Preview,
    Open,
    Done,
    Expired,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RosterEntry {
    pub id: RosterId,
    pub label: String,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Participant {
    pub id: RosterId,
    pub accepted: bool,
    pub progress: u32,
    pub visited: u8,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct QuestRow {
    pub handle: QuestHandle,
    pub def: String,
    pub giver: Vec2,
    pub state: RowState,
    pub expires_at: f64,
    pub participants: Vec<Participant>,
    pub carrier: Option<RosterId>,
    pub done_by: Option<String>,
    /// The current authoritative action checks permit acceptance at this sample.
    pub can_accept: bool,
    pub owner_accepted: bool,
    /// The server-owned objective is complete; the giver is the return destination.
    pub owner_ready: bool,
}
/// A navigation fact only: it is not a pickup handle or a promise of current reach or visibility.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Objective {
    pub quest: QuestHandle,
    pub at: Vec2,
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct QuestView {
    pub unknown_count: u32,
    pub display_unknown_count: u32,
    pub roster: Vec<RosterEntry>,
    pub rows: Vec<QuestRow>,
    pub objectives: Vec<Objective>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Error {
    EarlierTick,
    IdExhausted,
    InvalidLabel,
    InvalidState,
}

#[derive(Clone, Default)]
struct Committed {
    tick: Option<u32>,
    next_roster: u64,
    next_quest: u64,
    roster: BTreeMap<PlayerId, RosterId>,
    quests: BTreeMap<u32, QuestHandle>,
    actionable: BTreeSet<u32>,
}
/// One per viewer and match. Only a successfully committed view can authorize an accept request.
pub struct QuestObserver {
    viewer: PlayerId,
    state: Committed,
}
impl QuestObserver {
    pub fn new(viewer: PlayerId) -> Self {
        Self {
            viewer,
            state: Committed {
                next_roster: 1,
                next_quest: 1,
                ..Committed::default()
            },
        }
    }
    /// Revoke all bindings and require a full collection replacement; counters are retained and IDs never reused.
    /// No identity continuity across reconnect is promised.
    pub fn reconnect(&mut self) {
        let (next_roster, next_quest) = (self.state.next_roster, self.state.next_quest);
        self.state = Committed {
            next_roster,
            next_quest,
            ..Committed::default()
        };
    }
    pub fn prepare<'a>(&'a mut self, sim: &Sim) -> Result<Prepared<'a>, Error> {
        let (next, view) = self.stage(sim)?;
        Ok(Prepared {
            observer: self,
            next,
            view,
        })
    }
    pub(crate) fn stage(&self, sim: &Sim) -> Result<(QuestStage, QuestView), Error> {
        if self.state.tick.is_some_and(|tick| tick > sim.tick()) {
            return Err(Error::EarlierTick);
        }
        let mut next = self.state.clone();
        next.tick = Some(sim.tick());
        let mut view = QuestView::default();
        let Some(me) = sim.player(self.viewer).filter(|p| !p.seat.bot) else {
            next.quests.clear();
            next.actionable.clear();
            return Ok((QuestStage(next), view));
        };
        let Some(quests) = &sim.w.quests else {
            next.quests.clear();
            next.actionable.clear();
            return Ok((QuestStage(next), view));
        };
        view.unknown_count = quests
            .offers
            .iter()
            .filter(|o| !o.published)
            .count()
            .try_into()
            .map_err(|_| Error::InvalidState)?;
        view.display_unknown_count = view.unknown_count.saturating_sub(
            quests
                .offers
                .iter()
                .filter(|o| {
                    !o.published
                        && o.status == Status::Open
                        && o.finder == Some(me.id)
                        && o.publish_at > 0.
                })
                .count() as u32,
        );
        // Sort only entitled facts. Unpublished rows and raw entity allocation order cannot advance public IDs.
        let mut offers: Vec<_> = quests
            .offers
            .iter()
            .filter(|o| {
                o.published
                    || (o.status == Status::Open && o.finder == Some(me.id) && o.publish_at > 0.)
            })
            .collect();
        offers.sort_by(|a, b| {
            catalog::DEFINITION[a.def as usize]
                .id
                .cmp(catalog::DEFINITION[b.def as usize].id)
                .then_with(|| a.at.x.total_cmp(&b.at.x))
                .then_with(|| a.at.y.total_cmp(&b.at.y))
        });
        let mut people: Vec<PlayerId> = Vec::new();
        for o in &offers {
            if o.published {
                people.extend(o.accepted.iter().copied());
                people.extend(o.progress.iter().map(|(id, _)| *id));
                people.extend(o.visits.iter().map(|(id, _)| *id));
                people.extend(o.carrier);
            }
        }
        people.sort_by(|a, b| {
            sim.player_name(*a)
                .cmp(&sim.player_name(*b))
                .then_with(|| a.cmp(b))
        });
        people.dedup();
        for id in people {
            let label = checked_label(sim.player_name(id).ok_or(Error::InvalidState)?)?;
            let rid = match next.roster.get(&id) {
                Some(r) => *r,
                None => {
                    let r = RosterId(take_id(&mut next.next_roster)?);
                    next.roster.insert(id, r);
                    r
                }
            };
            view.roster.push(RosterEntry { id: rid, label });
        }
        view.roster.sort_by_key(|r| r.id);
        next.actionable.clear();
        for o in offers {
            if o.published && o.status == Status::Open {
                next.actionable.insert(o.id);
            }
            let h = match next.quests.get(&o.id) {
                Some(h) => *h,
                None => {
                    let h = QuestHandle(take_id(&mut next.next_quest)?);
                    next.quests.insert(o.id, h);
                    h
                }
            };
            let state = if !o.published {
                RowState::Preview
            } else {
                match o.status {
                    Status::Open => RowState::Open,
                    Status::Done => RowState::Done,
                    Status::Expired => RowState::Expired,
                }
            };
            let mut participants = Vec::new();
            if o.published {
                let mut participant_ids: Vec<PlayerId> = o
                    .accepted
                    .iter()
                    .copied()
                    .chain(o.progress.iter().map(|(id, _)| *id))
                    .chain(o.visits.iter().map(|(id, _)| *id))
                    .collect();
                participant_ids.sort_unstable();
                participant_ids.dedup();
                for id in &participant_ids {
                    let rid = *next.roster.get(id).ok_or(Error::InvalidState)?;
                    participants.push(Participant {
                        id: rid,
                        accepted: o.accepted.contains(id),
                        progress: o
                            .progress
                            .iter()
                            .find(|(p, _)| p == id)
                            .map_or(0, |(_, n)| *n),
                        visited: o
                            .visits
                            .iter()
                            .find(|(p, _)| p == id)
                            .map_or(0, |(_, v)| *v),
                    });
                }
                participants.sort_by_key(|p| p.id);
            }
            let def = &catalog::DEFINITION[o.def as usize];
            let owner_accepted = o.published && o.accepted.contains(&me.id);
            let can_accept = o.published
                && crate::quests::live::accept_eligibility(&sim.k, &sim.w, me.id, Some(o.id))
                    .is_ok();
            let live = o.status == Status::Open
                && (o.expires_at == 0. || sim.server_time() < o.expires_at);
            let progress = o
                .progress
                .iter()
                .find(|(p, _)| *p == me.id)
                .map_or(0, |(_, n)| *n);
            let owner_ready = owner_accepted
                && live
                && match def.kind {
                    catalog::Kind::Fetch => o.carrier == Some(me.id),
                    _ => progress >= def.count,
                };
            let ground_entitled = owner_accepted
                && live
                && match def.kind {
                    catalog::Kind::Collect => progress < def.count,
                    catalog::Kind::Fetch => o.carrier.is_none(),
                    catalog::Kind::Kill => false,
                };
            if ground_entitled {
                for cid in &o.containers {
                    let c = sim
                        .w
                        .containers
                        .iter()
                        .find(|c| c.id == *cid)
                        .ok_or(Error::InvalidState)?;
                    if c.kind != crate::ContainerKind::Quest
                        || c.items.first().map(|i| i.def)
                            != Some(crate::initial_world::ItemDef::Quest(o.id))
                    {
                        return Err(Error::InvalidState);
                    }
                    view.objectives.push(Objective { quest: h, at: c.at });
                }
            }
            let carrier = if o.published {
                o.carrier
                    .map(|id| next.roster.get(&id).copied().ok_or(Error::InvalidState))
                    .transpose()?
            } else {
                None
            };
            let done_by = if o.published {
                o.done_by
                    .map(|id| checked_label(sim.player_name(id).ok_or(Error::InvalidState)?))
                    .transpose()?
            } else {
                None
            };
            view.rows.push(QuestRow {
                handle: h,
                def: catalog::DEFINITION[o.def as usize].id.to_owned(),
                giver: o.at,
                state,
                expires_at: o.expires_at,
                participants,
                carrier,
                done_by,
                can_accept,
                owner_accepted,
                owner_ready,
            });
        }
        // A retired or no-longer-entitled quest must no longer resolve through a previously issued handle.
        next.quests
            .retain(|_, h| view.rows.iter().any(|row| row.handle == *h));
        Ok((QuestStage(next), view))
    }
    pub(crate) fn commit_stage(&mut self, stage: QuestStage) {
        self.state = stage.0;
    }
    /// Resolve a previously committed published row. Missing, stale, preview and foreign handles become normal misses.
    pub fn resolve_accept(&self, sim: &Sim, handle: QuestHandle) -> Command {
        let id = self
            .state
            .quests
            .iter()
            .find_map(|(id, h)| (*h == handle).then_some(*id));
        let id = id.filter(|id| {
            self.state.actionable.contains(id)
                && sim.player(self.viewer).is_some_and(|p| !p.seat.bot)
                && sim.w.quests.as_ref().is_some_and(|q| {
                    q.offers
                        .iter()
                        .any(|o| o.id == *id && o.published && o.status == Status::Open)
                })
        });
        validate(RawCommand::QuestAccept { quest_id: id }).expect("nonzero quest id or normal miss")
    }
}
fn take_id(next: &mut u64) -> Result<NonZeroU32, Error> {
    let n = u32::try_from(*next).map_err(|_| Error::IdExhausted)?;
    let id = NonZeroU32::new(n).ok_or(Error::IdExhausted)?;
    *next += 1;
    Ok(id)
}
fn checked_label(label: &str) -> Result<String, Error> {
    // Existing item publication bounds labels by UTF-8 byte length (u8); this does not impose profile callsign rules
    // on other valid sim seats or claim to sanitize source labels.
    if label.len() > u8::MAX as usize {
        return Err(Error::InvalidLabel);
    }
    Ok(label.to_owned())
}
#[must_use = "commit only after all corresponding publication succeeds; dropping discards staged authority"]
pub(crate) struct QuestStage(Committed);
impl QuestStage {
    pub(crate) fn published_handle(&self, id: u32) -> Option<QuestHandle> {
        self.0
            .actionable
            .contains(&id)
            .then(|| self.0.quests.get(&id).copied())
            .flatten()
    }
}
pub struct Prepared<'a> {
    observer: &'a mut QuestObserver,
    next: QuestStage,
    pub view: QuestView,
}
impl Prepared<'_> {
    pub fn commit(self) {
        self.observer.commit_stage(self.next);
    }
}

#[cfg(test)]
mod tests;
