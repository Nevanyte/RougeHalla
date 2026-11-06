//! Observer-owned presentation projection. Private actor IDs never become NPC labels here.
use crate::item_view::GRACE;
use crate::{Observation, PlayerId, SeenEvent};

/// Apply one observer's mapping to every actor-bearing public field, exactly once.
pub(crate) fn project(out: &mut Observation, map: impl Fn(PlayerId) -> Option<PlayerId>) {
    if let Some(me) = &mut out.me {
        me.attack_target = me.attack_target.and_then(&map);
        me.mark_by = me.mark_by.and_then(&map);
    }
    out.visible.retain_mut(|actor| {
        let Some(id) = map(actor.id) else {
            return false;
        };
        actor.id = id;
        actor.mark_by = actor.mark_by.and_then(&map);
        true
    });
    out.visible.sort_unstable_by_key(|a| a.id);
    for field in &mut out.fields {
        field.owner = field.owner.and_then(&map);
        field.subject = field.subject.and_then(&map);
    }
    out.fields.sort_by(crate::status_runtime::FieldView::cmp);
    for projectile in &mut out.projectiles {
        projectile.owner = projectile.owner.and_then(&map);
    }
    crate::projectile_view::sort(&mut out.projectiles);
    for chest in &mut out.reward_chests {
        for option in &mut chest.options {
            option.taken_by = option.taken_by.and_then(&map);
        }
    }
    out.events.retain_mut(|event| event_refs(event, &map));
}

fn event_refs(event: &mut SeenEvent, map: &impl Fn(PlayerId) -> Option<PlayerId>) -> bool {
    let (required, optional) = match event {
        SeenEvent::AbilityHit { victim, by, .. }
        | SeenEvent::SignatureHit { victim, by, .. }
        | SeenEvent::Hit { victim, by, .. } => (Some(victim), Some(by)),
        SeenEvent::StatusApplied { id, by, .. }
        | SeenEvent::Block { id, by, .. }
        | SeenEvent::Death { id, by } => (Some(id), Some(by)),
        SeenEvent::CastEnded { id, .. }
        | SeenEvent::Heal { id, .. }
        | SeenEvent::AttackCancelled { id }
        | SeenEvent::Stagger { id }
        | SeenEvent::Bounty { id, .. } => (Some(id), None),
        SeenEvent::Swing { by, .. } => (Some(by), None),
        SeenEvent::Ended { winner, .. } => (None, Some(winner)),
        SeenEvent::Teleported
        | SeenEvent::Plan(..)
        | SeenEvent::MobArmed { .. }
        | SeenEvent::CampCleared { .. }
        | SeenEvent::PotionNotice { .. }
        | SeenEvent::ChestRefused { .. }
        | SeenEvent::PickupRefused { .. } => (None, None),
    };
    if let Some(id) = required {
        let Some(presented) = map(*id) else {
            return false;
        };
        *id = presented;
    }
    if let Some(id) = optional {
        *id = id.and_then(map);
    }
    true
}

/// A fixed block per committed scene hides intermediate NPC counts when snapshots are skipped.
pub(crate) const NPC_REFERENCE_BLOCK: u64 = 512;
pub(crate) const NPC_REFERENCE_BASE: u64 = 1 << 31;
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Cue {
    kind: u8,
    mob_type: &'static str,
    faction: u8,
    x: u16,
    y: u16,
    facing: u16,
    hp: u8,
    status: u8,
    weapon: u8,
    bounty: u32,
    effects: u16,
    displacement: u8,
    mark: u8,
    brand: u8,
    tax: u8,
    sig: u8,
}
impl Cue {
    fn of(a: &crate::observe::ActorView) -> Result<Self, crate::OfferError> {
        // Match the wire's public position/angle precision; no private float residue orders labels.
        let facing = ((f64::from(a.facing as f32) / (std::f64::consts::TAU / 65536.)).round()
            as i64
            & 0xffff) as u16;
        Ok(Self {
            kind: a.kind,
            mob_type: a.mob_type.map_or("", |v| v.as_str()),
            faction: a.faction as u8,
            x: crate::item_view::position(a.x)?,
            y: crate::item_view::position(a.y)?,
            facing,
            hp: (a.hp_frac * 100.).round() as u8,
            status: a.status as u8,
            weapon: a.weapon.code(),
            bounty: a.bounty,
            effects: a.effects,
            displacement: a.displace_seq,
            mark: a.mark_tier,
            brand: a.brand,
            tax: a.mark_tax,
            sig: a.sig,
        })
    }
}
#[derive(Clone, Default)]
struct Batch {
    bindings: Vec<(PlayerId, PlayerId)>,
    cues: Vec<Cue>,
}
impl Batch {
    fn presented(&self, actor: PlayerId) -> Option<PlayerId> {
        self.bindings
            .iter()
            .find_map(|&(a, r)| (a == actor).then_some(r))
    }
    fn actor(&self, reference: PlayerId) -> Option<PlayerId> {
        self.bindings
            .iter()
            .find_map(|&(a, r)| (r == reference).then_some(a))
    }
}
pub(crate) struct ActorStage {
    tick: u32,
    renew: bool,
    batch: Batch,
}
pub(crate) struct ActorRefs {
    next: u64,
    sampled: Option<u32>,
    current: Batch,
    retired: Vec<(u32, Batch)>,
}
impl Default for ActorRefs {
    fn default() -> Self {
        Self {
            next: NPC_REFERENCE_BASE,
            sampled: None,
            current: Batch::default(),
            retired: Vec::new(),
        }
    }
}
impl ActorRefs {
    pub(crate) fn reconnect(&mut self) {
        let next = self.next;
        *self = Self::default();
        self.next = next;
    }
    pub(crate) fn stage(
        &self,
        sim: &crate::Sim,
        out: &Observation,
    ) -> Result<ActorStage, crate::OfferError> {
        if sim.w.actor_history.iter().any(|a| {
            matches!(a.origin, crate::mob_runtime::ActorOrigin::Player { .. })
                && u64::from(a.id.0) >= NPC_REFERENCE_BASE
        }) {
            return Err(crate::OfferError::ActorReferenceCollision);
        }
        let mut rows = out
            .visible
            .iter()
            .filter(|a| a.kind != 0)
            .map(|a| Ok((Cue::of(a)?, a.id)))
            .collect::<Result<Vec<_>, crate::OfferError>>()?;
        if rows.len() > NPC_REFERENCE_BLOCK as usize {
            return Err(crate::OfferError::TooManyActors);
        }
        rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let cues: Vec<_> = rows.iter().map(|(c, _)| c.clone()).collect();
        let renew = self.sampled != Some(sim.tick()) || cues != self.current.cues;
        // u32::MAX is the wire's redacted-source sentinel, so it cannot label an NPC.
        if renew && self.next + NPC_REFERENCE_BLOCK > u64::from(u32::MAX) {
            return Err(crate::OfferError::ActorReferencesExhausted);
        }
        // Same-tick retransmission reuses the committed exact bindings. A private identity
        // difference alone never issues a block or rebinds an earlier click.
        let batch = if renew {
            Batch {
                bindings: rows
                    .into_iter()
                    .enumerate()
                    .map(|(i, (_, id))| (id, PlayerId((self.next + i as u64) as u32)))
                    .collect(),
                cues,
            }
        } else {
            self.current.clone()
        };
        Ok(ActorStage {
            tick: sim.tick(),
            renew,
            batch,
        })
    }
    pub(crate) fn map(
        &self,
        sim: &crate::Sim,
        stage: &ActorStage,
        id: PlayerId,
    ) -> Option<PlayerId> {
        if sim.w.roster.name(id).is_some() {
            return Some(id);
        }
        stage
            .batch
            .presented(id)
            .or_else(|| self.current.presented(id))
            .or_else(|| {
                self.retired
                    .iter()
                    .rev()
                    .filter(|(t, _)| stage.tick.saturating_sub(*t) < GRACE)
                    .find_map(|(_, b)| b.presented(id))
            })
    }
    pub(crate) fn resolve(&self, tick: u32, reference: PlayerId) -> Option<PlayerId> {
        self.current.actor(reference).or_else(|| {
            self.retired
                .iter()
                .rev()
                .filter(|(t, _)| tick.saturating_sub(*t) < GRACE)
                .find_map(|(_, b)| b.actor(reference))
        })
    }
    pub(crate) fn commit(&mut self, stage: ActorStage) {
        self.retired
            .retain(|(t, _)| stage.tick.saturating_sub(*t) < GRACE);
        if stage.renew {
            if !self.current.bindings.is_empty() {
                self.retired
                    .push((stage.tick, std::mem::take(&mut self.current)));
            }
            self.current = stage.batch;
            self.next += NPC_REFERENCE_BLOCK;
        }
        self.sampled = Some(stage.tick);
    }
}

#[cfg(test)]
mod tests;
