//! Owned reconstructed human data. Construction validates data, never attests delivery.
use crate::bots::delivered::{Epoch, Fact, PlayerRef};
use rh_protocol::{
    ServerMsg, StateItem, WireActor, WireArena, WireBuild, WireCamp, WireEvent, WireField, WireFx,
    WireInventory, WireOwnerCombat, WirePlan, WireProjectile, WireProps, WireQuestView,
    WireRewardChest, WireSelf, WireTradeView,
};
use rh_sim::{FactionId, Status, WeaponId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SampleId(pub u64);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameContext14 {
    pub protocol: u16,
    /// Session-local ordinal, not a globally unique identity. NPC reference equality also
    /// retains private opaque affinity; this numeric value alone must never establish continuity.
    pub epoch: Epoch,
    pub sample: SampleId,
    pub viewer: PlayerRef,
}
#[derive(Clone, Debug, PartialEq)]
pub enum DeliveryError {
    Protocol,
    Incomplete,
    NotSnapshot,
    NotState,
    Clock,
    Owner,
    Namespace,
    Actor,
    Encode(rh_protocol::EncodeError),
    Decode(rh_protocol::DecodeError),
    SampleExhausted,
}
impl From<rh_protocol::EncodeError> for DeliveryError {
    fn from(v: rh_protocol::EncodeError) -> Self {
        Self::Encode(v)
    }
}
impl From<rh_protocol::DecodeError> for DeliveryError {
    fn from(v: rh_protocol::DecodeError) -> Self {
        Self::Decode(v)
    }
}
/// Received optional values distinguish unavailable from available empty. A key not yet received
/// is a third state: no complete Frame14 may be handed off until every known key has arrived.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CollectionView {
    seen: [bool; rh_protocol::state::MAX_STATE_KEYS],
    pub(crate) inventory: Option<WireInventory>,
    pub(crate) props: WireProps,
    pub(crate) fields: Vec<WireField>,
    pub(crate) reward_chests: Vec<WireRewardChest>,
    pub(crate) build: Option<WireBuild>,
    pub(crate) camps: Vec<WireCamp>,
    pub(crate) projectiles: Vec<WireProjectile>,
    pub(crate) plan: Option<WirePlan>,
    pub(crate) arena: Option<WireArena>,
    pub(crate) quests: Option<WireQuestView>,
    pub(crate) trade: Option<WireTradeView>,
    pub(crate) roster: Vec<rh_protocol::WireRosterRow>,
    /// State key 13: the owner's own build summary (None when unseated).
    pub(crate) summary: Option<rh_protocol::state::WireBuildSummary>,
    pub(crate) tick: u32,
}
impl CollectionView {
    pub fn inventory(&self) -> Option<&WireInventory> {
        self.inventory.as_ref()
    }
    pub fn props(&self) -> &WireProps {
        &self.props
    }
    pub fn fields(&self) -> &[WireField] {
        &self.fields
    }
    pub fn reward_chests(&self) -> &[WireRewardChest] {
        &self.reward_chests
    }
    pub fn build(&self) -> Option<&WireBuild> {
        self.build.as_ref()
    }
    pub fn camps(&self) -> &[WireCamp] {
        &self.camps
    }
    pub fn projectiles(&self) -> &[WireProjectile] {
        &self.projectiles
    }
    pub fn plan(&self) -> Option<&WirePlan> {
        self.plan.as_ref()
    }
    pub fn arena(&self) -> Option<&WireArena> {
        self.arena.as_ref()
    }
    pub fn quests(&self) -> Option<&WireQuestView> {
        self.quests.as_ref()
    }
    /// Unavailable is `None`; an available view may have empty saved rows.
    pub fn trade(&self) -> Option<&WireTradeView> {
        self.trade.as_ref()
    }
    /// The seated players (State key 12, ADR0026).
    pub fn roster(&self) -> &[rh_protocol::WireRosterRow] {
        &self.roster
    }
    /// The owner's GAINED strip (State key 13), quantized as delivered.
    pub fn summary(&self) -> Option<&rh_protocol::state::WireBuildSummary> {
        self.summary.as_ref()
    }
    pub fn tick(&self) -> u32 {
        self.tick
    }
    pub fn complete(&self) -> bool {
        self.seen.iter().all(|v| *v)
    }
    /// Atomic same-view replacement, including retained props/quests. Domain/budget checks apply
    /// to this actual update, not to an invented oversized re-encoding of all retained collections.
    pub fn apply(&mut self, message: &ServerMsg) -> Result<(), DeliveryError> {
        let ServerMsg::State { tick, items } = message else {
            return Err(DeliveryError::NotState);
        };
        message.try_encode()?;
        let mut next = self.clone();
        for item in items {
            next.seen[(item.key() - 1) as usize] = true;
            match item {
                StateItem::Inventory(v) => next.inventory = *v,
                StateItem::Props(v) => next.props = v.clone(),
                StateItem::Fields(v) => next.fields = v.clone(),
                StateItem::RewardChests(v) => next.reward_chests = v.clone(),
                StateItem::Build(v) => next.build = *v,
                StateItem::Camps(v) => next.camps = v.clone(),
                StateItem::Projectiles(v) => next.projectiles = v.clone(),
                StateItem::Plan(v) => next.plan = v.clone(),
                StateItem::Arena(v) => next.arena = *v,
                StateItem::Quests(v) => next.quests = v.clone(),
                StateItem::Trade(v) => next.trade = v.clone(),
                StateItem::Roster(v) => next.roster = v.clone(),
                StateItem::BuildSummary(v) => next.summary = v.clone(),
            }
        }
        rh_protocol::validate_quest_props(&next.props, next.quests.as_ref())?;
        next.tick = *tick;
        *self = next;
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct EventBatch {
    pub tick: u32,
    pub events: Vec<WireEvent>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct FxBatch {
    pub tick: u32,
    pub fx: Vec<WireFx>,
}
/// NPC references are scoped to an accepted scene, not canonical identities or continuity claims.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NpcRef14 {
    affinity: SessionId,
    context: FrameContext14,
    wire_id: u32,
}
impl NpcRef14 {
    pub fn wire_id(&self) -> u32 {
        self.wire_id
    }
    pub fn context(&self) -> FrameContext14 {
        self.context
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActorKind14 {
    Player,
    Regional,
    Zombie,
    Dummy,
    QuestGiver,
}
#[derive(Clone, Copy, Debug)]
pub struct Actor14<'a> {
    wire: &'a WireActor,
    affinity: &'a SessionId,
    context: FrameContext14,
}
impl Actor14<'_> {
    pub fn wire(&self) -> &WireActor {
        self.wire
    }
    pub fn kind(&self) -> ActorKind14 {
        match self.wire.kind {
            0 => ActorKind14::Player,
            1 => ActorKind14::Regional,
            2 => ActorKind14::Zombie,
            3 => ActorKind14::Dummy,
            4 => ActorKind14::QuestGiver,
            _ => unreachable!("checked actor kind"),
        }
    }
    pub fn player(&self) -> Option<PlayerRef> {
        (self.wire.kind == 0).then(|| PlayerRef::new(self.wire.id).expect("checked player ref"))
    }
    pub fn npc(&self) -> Option<NpcRef14> {
        (self.wire.kind != 0).then(|| NpcRef14 {
            affinity: self.affinity.clone(),
            context: self.context,
            wire_id: self.wire.id,
        })
    }
    pub fn faction(&self) -> Option<FactionId> {
        FactionId::ALL.get(self.wire.faction as usize).copied()
    }
    pub fn weapon(&self) -> Option<WeaponId> {
        weapon(self.wire.weapon)
    }
    pub fn immunity_until(&self) -> Fact<f64> {
        Fact::Unavailable
    }
    pub fn targetable(&self) -> bool {
        self.wire.effects & 128 == 0
    }
}
pub(crate) fn weapon(code: u8) -> Option<WeaponId> {
    match code {
        0 => Some(WeaponId::Sword),
        1 => Some(WeaponId::Bow),
        2 => Some(WeaponId::Wand),
        3 => Some(WeaponId::Shield),
        4 => Some(WeaponId::Axe),
        5 => Some(WeaponId::Fists),
        _ => None,
    }
}
pub(crate) fn status(code: u8) -> Status {
    match code {
        0 => Status::Lobby,
        1 => Status::Alive,
        2 => Status::Dead,
        3 => Status::Mia,
        _ => unreachable!("checked status"),
    }
}
#[derive(Clone, Debug)]
pub struct Frame14 {
    // Numeric Epoch is session-local, not globally unique. References retain this opaque
    // affinity as well; frame data equality below deliberately excludes it.
    pub(super) affinity: SessionId,
    context: FrameContext14,
    pub(crate) tick: u32,
    pub(crate) source_time: f64,
    pub(crate) phase: u8,
    pub(crate) training: bool,
    pub(crate) ack_input: u32,
    pub(crate) owner: Option<WireSelf>,
    pub(crate) owner_combat: Option<WireOwnerCombat>,
    pub(crate) actors: Vec<WireActor>,
    pub(crate) collections: CollectionView,
    pub(crate) events: Vec<EventBatch>,
    pub(crate) fx: Vec<FxBatch>,
}
impl PartialEq for Frame14 {
    fn eq(&self, other: &Self) -> bool {
        (
            self.context,
            self.tick,
            self.source_time,
            self.phase,
            self.training,
            self.ack_input,
            &self.owner,
            &self.owner_combat,
            &self.actors,
            &self.collections,
            &self.events,
            &self.fx,
        ) == (
            other.context,
            other.tick,
            other.source_time,
            other.phase,
            other.training,
            other.ack_input,
            &other.owner,
            &other.owner_combat,
            &other.actors,
            &other.collections,
            &other.events,
            &other.fx,
        )
    }
}
impl Frame14 {
    /// Internal acceptance preflight only; opaque affinity never becomes a public fact.
    pub(crate) fn same_local_session(&self, session: &SessionId) -> bool {
        &self.affinity == session
    }

    pub fn from_reconstructed(
        context: FrameContext14,
        snapshot: ServerMsg,
        collections: CollectionView,
        events: Vec<EventBatch>,
        fx: Vec<FxBatch>,
    ) -> Result<Self, DeliveryError> {
        if context.protocol != rh_protocol::PROTOCOL_VERSION {
            return Err(DeliveryError::Protocol);
        }
        if !collections.complete() {
            return Err(DeliveryError::Incomplete);
        }
        // This is data validation only. Successful callers still cannot construct AcceptedFrame14.
        snapshot.try_encode()?;
        let ServerMsg::Snapshot {
            tick,
            server_time,
            phase,
            ack_input,
            me,
            owner_combat,
            actors,
            training,
        } = snapshot
        else {
            return Err(DeliveryError::NotSnapshot);
        };
        if !server_time.is_finite() || server_time < 0. {
            return Err(DeliveryError::Clock);
        }
        if me.as_ref().is_some_and(|v| v.id != context.viewer.get()) {
            return Err(DeliveryError::Owner);
        }
        if me.as_ref().is_some_and(|v| {
            ![v.x, v.y, v.facing, v.hp, v.max_hp, v.barrier]
                .iter()
                .all(|v| v.is_finite())
        }) {
            return Err(DeliveryError::Owner);
        }
        for actor in &actors {
            if actor.id == context.viewer.get() {
                return Err(DeliveryError::Owner);
            }
            if (actor.kind == 0 && PlayerRef::new(actor.id).is_err())
                || (actor.kind != 0 && (actor.id < (1 << 31) || actor.id == u32::MAX))
            {
                return Err(DeliveryError::Namespace);
            }
            let q = rh_protocol::QActor::checked(actor).map_err(|_| DeliveryError::Actor)?;
            let decoded = q.to_wire();
            if decoded.x.to_bits() != actor.x.to_bits()
                || decoded.y.to_bits() != actor.y.to_bits()
                || decoded.facing.to_bits() != actor.facing.to_bits()
            {
                return Err(DeliveryError::Actor);
            }
        }
        for b in &events {
            ServerMsg::Events {
                tick: b.tick,
                events: b.events.clone(),
            }
            .try_encode()?;
        }
        for b in &fx {
            ServerMsg::Fx {
                tick: b.tick,
                fx: b.fx.clone(),
            }
            .try_encode()?;
        }
        Ok(Self {
            affinity: SessionId::new(),
            context,
            tick,
            source_time: server_time,
            phase,
            training,
            ack_input,
            owner: me,
            owner_combat,
            actors,
            collections,
            events,
            fx,
        })
    }
    pub fn context(&self) -> FrameContext14 {
        self.context
    }
    pub fn tick(&self) -> u32 {
        self.tick
    }
    pub fn source_time(&self) -> f64 {
        self.source_time
    }
    pub fn phase(&self) -> u8 {
        self.phase
    }
    pub fn training(&self) -> bool {
        self.training
    }
    pub fn ack_input(&self) -> u32 {
        self.ack_input
    }
    pub fn owner(&self) -> Fact<Option<&WireSelf>> {
        Fact::Delivered(self.owner.as_ref())
    }
    pub fn owner_immunity_until(&self) -> Fact<f64> {
        Fact::Unavailable
    }
    pub fn inventory(&self) -> Fact<Option<&WireInventory>> {
        Fact::Delivered(self.collections.inventory.as_ref())
    }
    /// Exact delivered owner replacement, without deriving offers or merchant readiness.
    pub fn trade(&self) -> Fact<Option<&WireTradeView>> {
        Fact::Delivered(self.collections.trade.as_ref())
    }
    /// The owner's own build summary (State key 13), quantized; never another seat's.
    pub fn build_summary(&self) -> Fact<Option<&rh_protocol::state::WireBuildSummary>> {
        Fact::Delivered(self.collections.summary.as_ref())
    }
    pub fn owner_combat(&self) -> Fact<&WireOwnerCombat> {
        self.owner_combat
            .as_ref()
            .map_or(Fact::Unavailable, Fact::Delivered)
    }
    pub fn actors(&self) -> impl ExactSizeIterator<Item = Actor14<'_>> {
        self.actors.iter().map(|wire| Actor14 {
            wire,
            affinity: &self.affinity,
            context: self.context,
        })
    }
    pub fn collections(&self) -> &CollectionView {
        &self.collections
    }
    pub fn events(&self) -> &[EventBatch] {
        &self.events
    }
    pub fn fx(&self) -> &[FxBatch] {
        &self.fx
    }
}
/// Opaque local channel identity. Equality reveals only whether two receipts belong to the
/// same local session; no process-global counter/address is a policy fact or a wire field.
#[derive(Clone)]
pub(crate) struct SessionId(std::sync::Arc<()>);
impl SessionId {
    pub(crate) fn new() -> Self {
        Self(std::sync::Arc::new(()))
    }
}
impl PartialEq for SessionId {
    fn eq(&self, other: &Self) -> bool {
        std::sync::Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for SessionId {}
impl std::fmt::Debug for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SessionId")
    }
}
/// Receipt of THIS local handoff, never proof of socket/browser delivery. Only seat acceptance may
/// construct it. A Frame14 constructor is deliberately insufficient.
/// ```compile_fail
/// use rh_policy::delivery::{AcceptedFrame14,Frame14};
/// fn forge(frame:Frame14)->AcceptedFrame14 {
///     AcceptedFrame14 {frame:std::sync::Arc::new(frame)}
/// }
/// ```
#[derive(Clone, Debug)]
pub struct AcceptedFrame14 {
    pub(crate) session: SessionId,
    pub(crate) frame: std::sync::Arc<Frame14>,
}
impl AcceptedFrame14 {
    pub fn same_session(&self, other: &Self) -> bool {
        self.session == other.session
    }
    pub fn frame(&self) -> &Frame14 {
        &self.frame
    }
}
