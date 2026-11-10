//! Fair perception for a human-like seat: the percept the hand reads, built ONLY from the per-player
//! reconstructed Frame14 (C-OBS) and the match's public static map. No World, no hidden field, no secret: a bot sees exactly what a
//! human client is sent (docs/BOTS.md 3, narrowed here to what the human-likeness core reads).
//!
//! This is not yet the full legacy perception.ts (camera window at a render time, minimap dot ring, fx decoding,
//! memory-decayed views): the corpus in parity/policy/bot-core.json pins the hand and the humanizer against the source;
//! the full fair-view constructor remains part of P-BOTS-1.
use crate::bots::clicks::BotMap;
use crate::bots::types::{
    BotWeapon, ContainerView, FighterView, HudView, MobView, Percept, PerceptExtras,
    RewardChestView, SelfView, Stimulus, StimulusKind, WishView,
};
use crate::delivery::frame::{status as decoded_status, weapon as decoded_weapon};
use crate::delivery::Frame14;
use rh_protocol::{WireActor, WireFx, WireOwnerLock};
use rh_sim::observe::ActorView;
use rh_sim::{FactionId, Status};

/// Single adaptation point for typed actor kinds. Companion/dummy/neutral
/// actors never enter this slice's player-threat or regional-farm candidates.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ActorClass {
    Player,
    Regional,
    NonCombat,
}
fn actor_class(actor: &WireActor) -> ActorClass {
    if actor.faction == 15 {
        return ActorClass::NonCombat;
    }
    match actor.kind {
        0 => ActorClass::Player,
        1 => ActorClass::Regional,
        _ => ActorClass::NonCombat,
    }
}
/// Copies only decoded public player facts. No raw-world access; a data frame alone is not delivery.
pub(super) fn memory_players(
    obs: &Frame14,
) -> Result<Vec<super::memory_prefix::PlayerSight>, super::memory_prefix::Error> {
    obs.actors
        .iter()
        .filter(|a| actor_class(a) == ActorClass::Player)
        .filter(|a| {
            obs.owner.as_ref().is_some_and(|me| {
                a.id != me.id
                    && a.effects & super::wish::EFFECT_HIDDEN == 0
                    && super::view::in_view(
                        f64::from(me.x),
                        f64::from(me.y),
                        f64::from(a.x),
                        f64::from(a.y),
                        0.,
                    )
            })
        })
        .map(|a| {
            Ok(super::memory_prefix::PlayerSight {
                id: super::delivered::PlayerRef::new(a.id)
                    .map_err(|_| super::memory_prefix::Error::InvalidScene)?,
                at: rh_sim::Vec2::new(f64::from(a.x), f64::from(a.y)),
                faction: FactionId::ALL
                    .get(a.faction as usize)
                    .copied()
                    .ok_or(super::memory_prefix::Error::InvalidScene)?,
                in_hand: decoded_weapon(a.weapon).filter(|w| *w != rh_sim::WeaponId::Fists),
                hp_share: f64::from(a.hp_pct) / 100.,
                bounty: u32::from(a.bounty),
                status: decoded_status(a.status),
                hidden: a.effects & super::wish::EFFECT_HIDDEN != 0,
            })
        })
        .collect()
}

fn status_str(s: Status) -> &'static str {
    match s {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}

/// The rendered key of an actor for this brain (an id string, never a hidden serial).
pub fn player_key(id: rh_sim::PlayerId) -> String {
    format!("p{}", id.0)
}
pub fn npc_key(id: rh_sim::PlayerId) -> String {
    format!("n{}", id.0)
}

#[derive(Default)]
pub struct Perception {
    prev: Vec<(rh_sim::PlayerId, f64, f64)>,
    prev_time: f64,
    /// Rendered keys the previous observation showed. A Vec, not a HashSet: rh-policy bans hash iteration order (ADR 0007).
    known: Vec<String>,
}

/// What one observation yields: the hand's percept and the stimuli a human would notice in it.
pub struct Frame {
    pub percept: Percept,
    /// Rendered key -> the public actor id it stands for (players and NPCs of THIS observation only).
    pub ids: Vec<(String, rh_sim::PlayerId)>,
    /// Compatibility diagnostic retained for existing callers; live HumanBot consumes Memory's
    /// reentry-aware source stimuli instead of this preceding-frame-only list.
    pub stimuli: Vec<Stimulus>,
    /// The time of the last hit on the owner in this observation, if one landed (the wish module's "being hit").
    pub hit_at: Option<f64>,
    /// Player-originated hits on the owner in this observation: the rendered attacker key and the time (the wish module keeps
    /// the per-fighter memory the legacy brain had, so a melee fighter on the bot can count as chasing).
    pub fighter_hits: Vec<(String, f64)>,
    /// The loot/choice executor's public facts of THIS observation: each prop row and reward chest under its stable
    /// public key, with the handle this frame actually delivered for it (never a row index), and the arena clocks.
    pub loot: LootFacts,
}

/// What a container holds as the bot can tell (legacy ContainerSeen.weapon: a WeaponId, `null`, or `undefined`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Contents {
    Weapon(BotWeapon),
    Empty,
    Unknown,
}

/// One delivered prop row as the legacy seeContainers draws it, keyed by its public cue and bound to this frame's handle.
#[derive(Clone, Debug, PartialEq)]
pub struct PropRef {
    /// The rendered container key (the percept's ContainerView id): position and kind, stable across handle renewals.
    pub key: String,
    /// The handle this frame delivered for the row (handles renew on any cue change; resolve at emit time only).
    pub handle: rh_protocol::PickupHandle,
    pub kind: &'static str,
    pub at: rh_sim::Vec2,
    pub closed: bool,
    pub contents: Contents,
    /// The server's focus row (what F takes).
    pub interactable: bool,
}

/// One delivered reward chest under its stable public key, bound to this frame's handle.
#[derive(Clone, Debug, PartialEq)]
pub struct ChestRef {
    pub key: String,
    pub handle: rh_protocol::RewardChestHandle,
    pub at: rh_sim::Vec2,
    pub expires_at: f64,
    /// Legacy lifeMs: CHEST_SECONDS for a camp chest, KILL_AUG_SECONDS for the owner's Trophy.
    pub life_ms: f64,
    /// The source option ids, only while the panel would be open (legacy `options`, else null).
    pub options: Option<Vec<String>>,
    /// Who took each option while readable: "" free, the owner's key for its own pick, "?" for anyone else.
    pub taken_by: Vec<String>,
    pub picked: bool,
}

/// The public facts the loot/choice executor reads from one observation.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LootFacts {
    pub props: Vec<PropRef>,
    pub chests: Vec<ChestRef>,
    /// The owner's own cards row (legacy `self.build`, id -> count), when delivered.
    pub build: Option<Vec<(String, f64)>>,
    pub raid_started_at: f64,
    pub patience_ends_at: Option<f64>,
    pub in_coliseum: bool,
}

/// Legacy CHEST_RANGE less CHEST_PANEL_SLACK: the panel (and so the cards) is open within this of the owner.
pub const CHEST_PANEL_RANGE: f64 = 96. - 8.;

/// The source option id of a wire reward option (cards.ts ids, `boost:*`, `kill:<key>:<gain>`).
pub fn reward_option_id(id: &rh_protocol::WireRewardId) -> String {
    match *id {
        rh_protocol::WireRewardId::Card(i) => rh_sim::cards::CardId::ALL
            .get(usize::from(i))
            .map_or_else(String::new, |c| c.as_str().to_owned()),
        rh_protocol::WireRewardId::Boost(i) => rh_sim::reward_chests::BoostId::ALL
            .get(usize::from(i))
            .map_or_else(String::new, |b| b.as_str().to_owned()),
        rh_protocol::WireRewardId::Kill { key, gain } => {
            rh_sim::kill_augments::encode(rh_sim::kill_augments::KillAugment {
                key: rh_sim::kill_augments::KillStatKey::ALL[key as usize],
                gain,
            })
        }
    }
}

/// The attention box (TierParams.attention.central), used to mark a stimulus central or peripheral.
fn central(at: rh_sim::Vec2, self_at: rh_sim::Vec2, central: f64) -> bool {
    (at.x - self_at.x).abs() <= crate::bots::types::BOT_VIEW_HALF_W * central
        && (at.y - self_at.y).abs() <= crate::bots::types::BOT_VIEW_HALF_H * central
}

impl Perception {
    /// Reset at match start (independent environments: nothing carries over).
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn build(&mut self, obs: &Frame14, central_share: f64) -> Option<Frame> {
        let me = obs.owner.as_ref()?;
        let now = obs.source_time;
        let self_at = rh_sim::Vec2::new(f64::from(me.x), f64::from(me.y));
        let dt = if self.prev_time > 0. && now > self.prev_time {
            (now - self.prev_time) / 1000.
        } else {
            0.
        };
        let mut ids: Vec<(String, rh_sim::PlayerId)> = Vec::new();
        let mut fighters = Vec::new();
        let mut mobs = Vec::new();
        let mut seen_now: Vec<String> = Vec::new();
        for a in &obs.actors {
            let class = actor_class(a);
            if class == ActorClass::NonCombat
                || a.effects & super::wish::EFFECT_HIDDEN != 0
                || !super::view::in_view(
                    f64::from(me.x),
                    f64::from(me.y),
                    f64::from(a.x),
                    f64::from(a.y),
                    0.,
                )
            {
                continue;
            }
            let rendered = if class == ActorClass::Player {
                player_key(rh_sim::PlayerId(a.id))
            } else {
                npc_key(rh_sim::PlayerId(a.id))
            };
            if a.id == me.id {
                continue;
            }
            if rendered.is_empty() {
                continue;
            }
            let (vx, vy) =
                self.velocity(rh_sim::PlayerId(a.id), f64::from(a.x), f64::from(a.y), dt);
            if class == ActorClass::Player {
                fighters.push(FighterView {
                    id: rendered.clone(),
                    x: f64::from(a.x),
                    y: f64::from(a.y),
                    vx,
                    vy,
                    status: status_str(decoded_status(a.status)).into(),
                    // Untargetable/public effect filtering of the full fair view remains the full perception port.
                    targetable: a.status == 1 && a.effects & 128 == 0,
                });
            } else {
                let kind = a
                    .mob_type_code
                    .checked_sub(1)
                    .and_then(|n| rh_sim::mob_catalog::MobTypeId::ALL.get(n as usize))
                    .and_then(|t| rh_sim::mob_catalog::mob_type_by_id(t.as_str()))
                    .map_or("mob", |t| if t.elite { "elite" } else { "mob" });
                mobs.push(MobView {
                    id: rendered.clone(),
                    x: f64::from(a.x),
                    y: f64::from(a.y),
                    vx,
                    vy,
                    status: status_str(decoded_status(a.status)).into(),
                    kind: kind.into(),
                });
            }
            ids.push((rendered.clone(), rh_sim::PlayerId(a.id)));
            seen_now.push(rendered);
        }
        // Containers as the legacy seeContainers draws them (closed/contents), keyed by the public cue (position and
        // kind) so a goal survives the observer's handle renewals; the handle is only this frame's binding.
        let focus = obs.collections.props.focus.as_ref();
        let weapon_of = |code: u8| decoded_weapon(code).and_then(|w| BotWeapon::parse(w.as_str()));
        let mut containers = Vec::new();
        let mut props = Vec::new();
        for prop in &obs.collections.props.rows {
            let (kind, tag) = match prop.kind {
                rh_protocol::WirePropKind::Ground(w) => ("ground", format!("g{w}")),
                rh_protocol::WirePropKind::Chest { .. } => ("chest", "c".to_owned()),
                rh_protocol::WirePropKind::Body { .. } => ("body", "b".to_owned()),
                rh_protocol::WirePropKind::Cannon { .. } => ("cannon", "n".to_owned()),
                rh_protocol::WirePropKind::Corpse { .. } => ("corpse", "x".to_owned()),
                rh_protocol::WirePropKind::WindEmblem => ("consumable", "w".to_owned()),
                rh_protocol::WirePropKind::QuestItem { .. } => continue,
            };
            let key = format!("c{}_{}_{tag}", prop.x, prop.y);
            let at = rh_sim::Vec2::new(f64::from(prop.x) / 8., f64::from(prop.y) / 8.);
            let interactable = focus.is_some_and(|f| f.handle == prop.handle);
            let (closed, contents) = if interactable {
                // The interaction target: what F takes (a body's first weapon is its focus hint).
                let named = match prop.kind {
                    rh_protocol::WirePropKind::Ground(w) => weapon_of(w),
                    _ => focus.and_then(|f| f.body_hint).and_then(weapon_of),
                };
                (true, named.map_or(Contents::Unknown, Contents::Weapon))
            } else {
                match &prop.kind {
                    rh_protocol::WirePropKind::Ground(w) => match weapon_of(*w) {
                        Some(w) => (true, Contents::Weapon(w)),
                        None => (false, Contents::Empty),
                    },
                    rh_protocol::WirePropKind::Body { .. } => {
                        // A body reads empty only when standing at it lights nothing up.
                        let reach = rh_sim::math::hypot(at.x - self_at.x, at.y - self_at.y)
                            <= rh_sim::constants::INTERACT_RANGE;
                        if reach && focus.is_none() {
                            (false, Contents::Empty)
                        } else {
                            (true, Contents::Unknown)
                        }
                    }
                    rh_protocol::WirePropKind::Chest { open: true } => (false, Contents::Empty),
                    rh_protocol::WirePropKind::Chest { open: false } => (true, Contents::Unknown),
                    _ => (false, Contents::Empty),
                }
            };
            containers.push(ContainerView {
                id: key.clone(),
                kind: kind.into(),
                x: at.x,
                y: at.y,
                interactable,
            });
            props.push(PropRef {
                key,
                handle: prop.handle,
                kind,
                at,
                closed,
                contents,
                interactable,
            });
        }
        let alive_owner = me.status == 1;
        let mut chest_refs = Vec::new();
        let chests = obs
            .collections
            .reward_chests
            .iter()
            .map(|c| {
                let at = rh_sim::Vec2::new(f64::from(c.x) / 8., f64::from(c.y) / 8.);
                let key = format!("r{}_{}_{}", c.x, c.y, c.expires_at.to_bits());
                // The cards show only while the panel is open: the server's own pick admission (reach, sight, not
                // picked, out of the birth hold) and the client panel's range.
                let open = alive_owner
                    && c.can_choose
                    && rh_sim::math::hypot(at.x - self_at.x, at.y - self_at.y) <= CHEST_PANEL_RANGE;
                let options: Option<Vec<String>> =
                    open.then(|| c.options.iter().map(|o| reward_option_id(&o.id)).collect());
                let taken_by = if open {
                    c.options
                        .iter()
                        .map(|o| match o.taken_by {
                            Some(by) if by == me.id => player_key(rh_sim::PlayerId(by)),
                            Some(_) => "?".to_owned(),
                            None if o.taken => "?".to_owned(),
                            None => String::new(),
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                let trophy = c
                    .options
                    .iter()
                    .any(|o| matches!(o.id, rh_protocol::WireRewardId::Kill { .. }));
                chest_refs.push(ChestRef {
                    key: key.clone(),
                    handle: c.handle,
                    at,
                    expires_at: c.expires_at,
                    life_ms: if trophy { 30_000. } else { 15_000. },
                    options: options.clone(),
                    taken_by,
                    picked: c.picked,
                });
                RewardChestView {
                    id: key,
                    x: at.x,
                    y: at.y,
                    expires_at: c.expires_at,
                    options,
                }
            })
            .collect();
        let build = obs.collections.build.as_ref().map(|b| {
            let mut out: Vec<(String, f64)> = Vec::new();
            for (card, n) in rh_sim::cards::CardId::ALL.iter().zip(b.cards.iter()) {
                if *n > 0 {
                    out.push((card.as_str().to_owned(), f64::from(*n)));
                }
            }
            for (boost, n) in rh_sim::reward_chests::BoostId::ALL
                .iter()
                .zip(b.boosts.iter())
            {
                if *n > 0 {
                    out.push((boost.as_str().to_owned(), f64::from(*n)));
                }
            }
            out
        });
        let arena = obs.collections.arena.as_ref();
        let loot = LootFacts {
            props,
            chests: chest_refs,
            build,
            raid_started_at: arena.map_or(0., |a| a.raid_started_at),
            patience_ends_at: arena.and_then(|a| a.patience_ends_at),
            in_coliseum: arena.is_some_and(|a| a.in_coliseum),
        };
        // Missing inventory/group is unavailable, never inferred fists, clear lock or now+remaining.
        let inventory = obs.collections.inventory.as_ref()?;
        let combat = obs.owner_combat.as_ref()?;
        let weapons = inventory.slots.map(|w| {
            w.and_then(decoded_weapon)
                .and_then(|w| BotWeapon::parse(w.as_str()))
        });
        let visible_target = match combat.lock {
            WireOwnerLock::Clear => None,
            WireOwnerLock::Held { target } => target,
        };
        // Preserve an entitled lock even when its row is not an AI threat/farm candidate (for
        // example a dummy), or is outside this narrower camera. That does not authorize targeting it.
        let attack_target = visible_target.and_then(|id| {
            obs.actors.iter().find(|a| a.id == id).map(|a| {
                if a.kind == 0 {
                    player_key(rh_sim::PlayerId(id))
                } else {
                    npc_key(rh_sim::PlayerId(id))
                }
            })
        });
        let owner_lock = match combat.lock {
            WireOwnerLock::Clear => super::types::OwnerLock::Clear,
            WireOwnerLock::Held { .. } => super::types::OwnerLock::Held {
                target: attack_target.clone(),
            },
        };
        let percept = Percept {
            now,
            self_view: SelfView {
                id: "me".into(),
                faction: FactionId::ALL.get(me.faction as usize).copied(),
                x: f64::from(me.x),
                y: f64::from(me.y),
                facing: f64::from(me.facing),
                status: status_str(decoded_status(me.status)).into(),
                hp: f64::from(me.hp),
                max_hp: f64::from(me.max_hp),
                effects: me.effects,
                weapons,
                slot: inventory.active_slot,
                attack_target,
                ready_at: f64::from(combat.ready_at),
                owner_lock: Some(owner_lock),
            },
            hud: HudView {
                phase: match obs.phase {
                    0 => "lobby",
                    3 => "planning",
                    1 => "active",
                    2 => "ended",
                    _ => unreachable!("checked phase"),
                }
                .into(),
                gates_locked: obs
                    .collections
                    .arena
                    .as_ref()
                    .is_some_and(|a| a.gates_locked),
            },
            fighters,
            mobs,
            containers,
            extras: PerceptExtras {
                chests: Some(chests),
                // The Wish slot is the owner's own Observation field: the ability, its ready time and a cast under way. Wishes
                // have one rank.
                wish: me.wish.as_ref().map(|w| WishView {
                    ability: [
                        rh_sim::status_runtime::AbilityId::Freeze,
                        rh_sim::status_runtime::AbilityId::Swarm,
                        rh_sim::status_runtime::AbilityId::Trial,
                        rh_sim::status_runtime::AbilityId::Blaze,
                        rh_sim::status_runtime::AbilityId::LastStand,
                    ][w.ability as usize],
                    ready_at: w.ready_at,
                    full_at: w.full_at,
                    max_charges: w.max_charges,
                    casting: w.cast.is_some(),
                    rank: 1,
                }),
            },
        };
        // A stimulus is what a human would notice in this frame: an enemy appearing in view, self hp loss, a low-hp line.
        // The owner's own hit events: a hit's time makes "being hit" and a visible player's key feeds the per-fighter
        // memory the legacy brain kept (only what this observation shows).
        let mut hit_at = None;
        let mut fighter_hits = Vec::new();
        for event in obs.fx.iter().flat_map(|batch| &batch.fx) {
            if let WireFx::Hit { victim, by, .. } = event {
                if *victim != me.id {
                    continue;
                }
                hit_at = Some(now);
                if *by != u32::MAX
                    && percept
                        .fighters
                        .iter()
                        .any(|f| f.id == player_key(rh_sim::PlayerId(*by)))
                {
                    fighter_hits.push((player_key(rh_sim::PlayerId(*by)), now));
                }
            }
        }
        let mut stimuli = Vec::new();
        for f in &percept.fighters {
            if !self.known.contains(&f.id) {
                stimuli.push(Stimulus {
                    kind: StimulusKind::NewThreat,
                    at: now,
                    subject: Some(f.id.clone()),
                    central: central(rh_sim::Vec2::new(f.x, f.y), self_at, central_share),
                    value: None,
                });
            }
        }
        self.known = seen_now;
        self.prev = obs
            .actors
            .iter()
            .filter(|a| ids.iter().any(|(_, id)| id.0 == a.id))
            .map(|a| (rh_sim::PlayerId(a.id), f64::from(a.x), f64::from(a.y)))
            .collect();
        self.prev_time = now;
        Some(Frame {
            percept,
            ids,
            stimuli,
            hit_at,
            fighter_hits,
            loot,
        })
    }

    fn velocity(&self, id: rh_sim::PlayerId, x: f64, y: f64, dt: f64) -> (f64, f64) {
        if dt <= 0. {
            return (0., 0.);
        }
        self.prev
            .iter()
            .find(|(prev_id, _, _)| *prev_id == id)
            .map_or((0., 0.), |(_, px, py)| ((x - px) / dt, (y - py) / dt))
    }
}

/// The per-observation state a fair-view constructor may keep: only what earlier observations showed.
pub type PerceptionMap = BotMap;
/// Native projection diagnostic type retained for component tests; not a live policy input.
pub type SeenActor = ActorView;
