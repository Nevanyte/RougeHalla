//! Fair perception for a human-like seat: the percept the hand reads, built ONLY from the per-player
//! Observation (C-OBS) and the match's public static map. No World, no hidden field, no secret: a bot sees exactly what a
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
use rh_sim::observe::{ActorView, SeenEvent};
use rh_sim::{Observation, Phase, Status};

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
    pub stimuli: Vec<Stimulus>,
    /// The time of the last hit on the owner in this observation, if one landed (the wish module's "being hit").
    pub hit_at: Option<f64>,
    /// Player-originated hits on the owner in this observation: the rendered attacker key and the time (the wish module keeps
    /// the per-fighter memory the legacy brain had, so a melee fighter on the bot can count as chasing).
    pub fighter_hits: Vec<(String, f64)>,
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

    pub fn build(&mut self, obs: &Observation, central_share: f64) -> Option<Frame> {
        let me = obs.me.as_ref()?;
        let now = obs.server_time;
        let self_at = rh_sim::Vec2::new(me.x, me.y);
        let dt = if self.prev_time > 0. && now > self.prev_time {
            (now - self.prev_time) / 1000.
        } else {
            0.
        };
        let mut ids: Vec<(String, rh_sim::PlayerId)> = Vec::new();
        let mut fighters = Vec::new();
        let mut mobs = Vec::new();
        let mut seen_now: Vec<String> = Vec::new();
        for a in &obs.visible {
            // Neutral scene actors are visible facts, never bot combat or hunt candidates.
            if a.kind == rh_sim::observe::ActorKind::QuestGiver || a.faction.faction_id().is_none()
            {
                continue;
            }
            let rendered = match a.kind {
                rh_sim::observe::ActorKind::Player => player_key(a.id),
                _ => npc_key(a.id),
            };
            if a.id == me.id {
                continue;
            }
            if rendered.is_empty() {
                continue;
            }
            let (vx, vy) = self.velocity(a.id, a.x, a.y, dt);
            if a.kind == rh_sim::observe::ActorKind::Player {
                fighters.push(FighterView {
                    id: rendered.clone(),
                    x: a.x,
                    y: a.y,
                    vx,
                    vy,
                    status: status_str(a.status).into(),
                    // Untargetable/public effect filtering of the full fair view remains the full perception port.
                    targetable: a.status == Status::Alive,
                });
            } else {
                let kind = a
                    .mob_type
                    .and_then(|t| rh_sim::mob_catalog::mob_type_by_id(t.as_str()))
                    .map_or("mob", |t| if t.elite { "elite" } else { "mob" });
                mobs.push(MobView {
                    id: rendered.clone(),
                    x: a.x,
                    y: a.y,
                    vx,
                    vy,
                    status: status_str(a.status).into(),
                    kind: kind.into(),
                });
            }
            ids.push((rendered.clone(), a.id));
            seen_now.push(rendered);
        }
        let mut containers = Vec::new();
        for (i, prop) in obs.props.iter().enumerate() {
            let (kind, _) = match &prop.cue.kind {
                rh_sim::item_view::PropKind::Ground(w) => ("ground", Some(*w)),
                rh_sim::item_view::PropKind::Chest { .. } => ("chest", None),
                rh_sim::item_view::PropKind::Body { .. } => ("body", None),
                rh_sim::item_view::PropKind::Cannon { .. } => ("cannon", None),
                rh_sim::item_view::PropKind::Corpse { .. } => ("corpse", None),
                rh_sim::item_view::PropKind::WindEmblem => ("consumable", None),
                rh_sim::item_view::PropKind::QuestItem { .. } => continue,
            };
            containers.push(ContainerView {
                id: format!("c{}", i),
                kind: kind.into(),
                x: f64::from(prop.cue.x) / 8.,
                y: f64::from(prop.cue.y) / 8.,
                interactable: prop.cue.focused,
            });
        }
        let chests: Vec<RewardChestView> = obs
            .reward_chests
            .iter()
            .enumerate()
            .map(|(i, c)| RewardChestView {
                id: format!("r{}", i),
                x: c.at.x,
                y: c.at.y,
                expires_at: c.expires_at,
                options: c
                    .can_choose
                    .then(|| c.options.iter().map(|o| format!("{:?}", o.id)).collect()),
            })
            .collect();
        let weapons = obs.inventory.as_ref().map(|inv| {
            [
                inv.slots[0].and_then(|w| BotWeapon::parse(w.as_str())),
                inv.slots[1].and_then(|w| BotWeapon::parse(w.as_str())),
            ]
        });
        let attack_target = me.attack_target.and_then(|id| {
            ids.iter()
                .find(|(_, real)| *real == id)
                .map(|(rendered, _)| rendered.clone())
        });
        let percept = Percept {
            now,
            self_view: SelfView {
                id: "me".into(),
                faction: Some(me.faction),
                x: me.x,
                y: me.y,
                facing: me.facing,
                status: status_str(me.status).into(),
                hp: me.hp,
                max_hp: me.max_hp,
                effects: me.effects,
                weapons: weapons.unwrap_or([None, None]),
                slot: obs.inventory.as_ref().map_or(0, |i| i.active_slot),
                attack_target,
                ready_at: now + me.ready_in_ms.max(0.),
            },
            hud: HudView {
                phase: match obs.phase {
                    Phase::Lobby => "lobby",
                    Phase::Planning => "planning",
                    Phase::Active => "active",
                    Phase::Ended => "ended",
                }
                .into(),
                gates_locked: obs.arena.as_ref().is_some_and(|a| a.gates_locked),
            },
            fighters,
            mobs,
            containers,
            extras: PerceptExtras {
                chests: Some(chests),
                // The Wish slot is the owner's own Observation field: the ability, its ready time and a cast under way. Wishes
                // have one rank.
                wish: me.wish.as_ref().map(|w| WishView {
                    ability: w.ability,
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
        for event in &obs.events {
            if let SeenEvent::Hit { victim, by, .. } = event {
                if *victim != me.id {
                    continue;
                }
                hit_at = Some(now);
                if let Some(by) = by {
                    if obs
                        .visible
                        .iter()
                        .any(|a| a.kind == rh_sim::observe::ActorKind::Player && a.id == *by)
                    {
                        fighter_hits.push((player_key(*by), now));
                    }
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
        self.prev = obs.visible.iter().map(|a| (a.id, a.x, a.y)).collect();
        self.prev_time = now;
        Some(Frame {
            percept,
            ids,
            stimuli,
            hit_at,
            fighter_hits,
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
/// ActorView is re-exported for tests that build an observation-like view directly.
pub type SeenActor = ActorView;
