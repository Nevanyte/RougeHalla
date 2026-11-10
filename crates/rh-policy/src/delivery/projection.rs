//! Shared, pure conversion of already entitled presentation facts into the human protocol.
//! No Sim/world access, observer state, delivery attestation or input authority lives here.
use rh_protocol::quant::POS_MAX;
use rh_protocol::{
    QActor, ServerMsg, WireActor, WireEvent, WireFx, WireOwnerCombat, WireOwnerLock, WirePoint,
    WireResult, WireSelf, WireWishCast, WireWishOwner,
};
use rh_sim::observe::{ActorView, Observation, SeenEvent};
use rh_sim::sim::{Outcome, Phase, Status};
use rh_sim::RunResult;

pub fn status(s: Status) -> u8 {
    match s {
        Status::Lobby => 0,
        Status::Alive => 1,
        Status::Dead => 2,
        Status::Mia => 3,
    }
}

/// Phase codes are wire format: 0 lobby, 1 active, 2 ended, 3 planning.
pub fn checked_phase(p: Phase) -> Result<u8, rh_protocol::EncodeError> {
    match p {
        Phase::Lobby => Ok(0),
        Phase::Active => Ok(1),
        Phase::Ended => Ok(2),
        Phase::Planning => Ok(3),
    }
}

/// Compatibility wrapper for supported-profile callers; never invents a wire phase.
pub fn phase(p: Phase) -> u8 {
    checked_phase(p).expect("protocol 9 carries every native phase")
}

pub fn observation_supported(obs: &Observation) -> Result<(), rh_protocol::EncodeError> {
    checked_phase(obs.phase)?;
    for actor in &obs.visible {
        actor_supported(actor).map_err(rh_protocol::EncodeError::BadValue)?;
    }
    let owner_combat = obs.owner_combat.map(wire_owner_combat);
    if let Some(reason) =
        rh_protocol::owner_combat_fault(owner_combat.as_ref(), obs.me.is_some(), |id| {
            obs.visible.iter().any(|actor| actor.id.0 == id)
        })
    {
        return Err(rh_protocol::EncodeError::BadValue(reason));
    }
    Ok(())
}

pub fn sat16(v: u32) -> u16 {
    v.min(u16::MAX as u32) as u16
}

pub fn wire_self(m: &rh_sim::observe::SelfView) -> WireSelf {
    WireSelf {
        archetype: m.archetype.0,
        sig: m.sig,
        effects: m.effects,
        displace_seq: m.displace_seq,
        id: m.id.0,
        faction: m.faction.code(),
        x: m.x as f32,
        y: m.y as f32,
        facing: m.facing as f32,
        hp: m.hp as f32,
        max_hp: m.max_hp as f32,
        status: status(m.status),
        weapon: m.weapon.code(),
        ready_in_ms: m.ready_in_ms.min(u16::MAX as f64) as u16,
        kills: sat16(m.kills),
        bounty: sat16(m.bounty),
        gv: sat16(m.gv),
        move_seq: m.move_seq,
        hunt_target: m.hunt_target.map(|id| id.0),
        hunt_stacks: sat16(m.hunt_stacks),
        wish: m.wish.map(wire_wish_owner),
        barrier: m.barrier as f32,
        barrier_ring_step: m.barrier_ring_step,
    }
}

/// Health as a whole percent, 0 to 100: `(f * 100).round()` clamped (half away from zero, NaN is 0) without the libm
/// `round` call; a test holds it equal to that expression.
#[inline]
pub fn hp_pct(f: f64) -> u8 {
    rh_protocol::quant::round_half_away(f * 100.0).clamp(0, 100) as u8
}

pub fn actor_supported(a: &ActorView) -> Result<(u8, u8, u8), &'static str> {
    use rh_sim::observe::ActorKind;
    let kind = match a.kind {
        ActorKind::Player => 0,
        ActorKind::Regional => 1,
        ActorKind::Zombie => 2,
        ActorKind::Dummy => 3,
        ActorKind::QuestGiver => {
            return if a.faction == rh_sim::fighter::FighterAffiliation::Neutral
                && a.weapon.is_none()
                && a.mob_type.is_none()
            {
                Ok((4, 15, 15))
            } else {
                Err("giver actor")
            };
        }
    };
    let faction = a.faction.faction_id().ok_or("neutral actor unsupported")?;
    let weapon = a.weapon.ok_or("unarmed actor unsupported")?;
    Ok((kind, faction.code(), weapon.code()))
}

pub fn wire_actor(a: &ActorView) -> Result<WireActor, &'static str> {
    let (kind, faction, weapon) = actor_supported(a)?;
    Ok(WireActor {
        archetype: a.archetype.0,
        sig: a.sig,
        mob_type_code: a.mob_type.map_or(0, |id| id as u8 + 1),
        effects: a.effects,
        displace_seq: a.displace_seq,
        id: a.id.0,
        faction,
        x: a.x as f32,
        y: a.y as f32,
        facing: a.facing as f32,
        hp_pct: hp_pct(a.hp_frac),
        status: status(a.status),
        weapon,
        bounty: sat16(a.bounty),
        kind,
        barrier_pct: hp_pct(a.barrier_frac),
        barrier_ring_step: a.barrier_ring_step,
    })
}

fn ability_code(ability: rh_sim::status_runtime::AbilityId) -> u8 {
    use rh_sim::status_runtime::AbilityId;
    match ability {
        AbilityId::Freeze => 0,
        AbilityId::Swarm => 1,
        AbilityId::Trial => 2,
        AbilityId::Blaze => 3,
        AbilityId::LastStand => 4,
    }
}

fn wire_wish_owner(value: rh_sim::abilities::OwnerView) -> WireWishOwner {
    WireWishOwner {
        ability: ability_code(value.ability),
        ready_at: value.ready_at,
        full_at: value.full_at,
        max_charges: value.max_charges,
        recharge_ms: value.recharge_ms,
        charges: value.charges,
        next_charge_at: value.next_charge_at,
        cast: value.cast.map(|cast| WireWishCast {
            ability: ability_code(cast.ability),
            started_at: cast.started_at,
            lands_at: cast.lands_at,
        }),
    }
}

/// The native prepared bridge already resolved this reference against its current staged actor
/// scene. Copy its source-normalized clocks and binary64 mirrors without another identity lookup.
pub fn wire_owner_combat(value: rh_sim::OwnerCombatView) -> WireOwnerCombat {
    WireOwnerCombat {
        lock: match value.lock {
            rh_sim::OwnerLockView::Clear => WireOwnerLock::Clear,
            rh_sim::OwnerLockView::Held { target } => WireOwnerLock::Held {
                target: target.map(|id| id.0),
            },
        },
        draw_started_at: value.draw_started_at,
        ready_at: value.ready_at,
        as_milli: value.as_milli,
        windup_milli: value.windup_milli,
        speed_milli: value.speed_milli,
    }
}

pub fn wire_point(point: Option<rh_sim::Vec2>) -> Result<Option<WirePoint>, &'static str> {
    let Some(point) = point else {
        return Ok(None);
    };
    let limit = f64::from(POS_MAX);
    if !point.x.is_finite()
        || !point.y.is_finite()
        || !(0.0..=limit).contains(&point.x)
        || !(0.0..=limit).contains(&point.y)
    {
        return Err("wish position");
    }
    let (x, y) = (point.x as f32, point.y as f32);
    if !rh_protocol::quant::pos_in_range(x) || !rh_protocol::quant::pos_in_range(y) {
        return Err("wish position");
    }
    Ok(Some(WirePoint { x, y }))
}

pub fn checked_snapshot(
    obs: &Observation,
    ack_input: u32,
) -> Result<ServerMsg, rh_protocol::EncodeError> {
    observation_supported(obs)?;
    Ok(ServerMsg::Snapshot {
        training: obs.training,
        tick: obs.tick,
        server_time: obs.server_time,
        phase: checked_phase(obs.phase)?,
        ack_input,
        me: obs.me.as_ref().map(wire_self),
        owner_combat: obs.owner_combat.map(wire_owner_combat),
        actors: obs
            .visible
            .iter()
            .map(wire_actor)
            .collect::<Result<_, _>>()
            .map_err(rh_protocol::EncodeError::BadValue)?,
    })
}

/// An actor checked and quantized for the wire: [`QActor::checked`] of its [`wire_actor`].
#[inline]
pub fn checked_actor(a: &ActorView) -> Result<QActor, &'static str> {
    QActor::checked(&wire_actor(a)?)
}

/// Source absent or redacted by observation: no actor has this sentinel (Hit and Block).
pub const WIRE_NO_SOURCE: u32 = u32::MAX;

/// Each observed event's explicit wire treatment. Exhaustive over [`SeenEvent`] (no wildcard): a new core event needs a
/// deliberate wire mapping or explicit omission.
pub enum Wire {
    Event(WireEvent),
    Fx(WireFx),
    Omitted,
    Refused(&'static str),
}

pub fn to_wire(e: &SeenEvent) -> Wire {
    match *e {
        // The viewer's own deal travels as the complete-replacement State key 8 (a one-shot event would be lost on a
        // reconnect and would duplicate the key); Teleported is the source's room-wide presentation fx.
        SeenEvent::Plan(..) => Wire::Omitted,
        SeenEvent::Teleported => Wire::Fx(WireFx::Teleport),
        SeenEvent::CastStarted {
            event_time,
            id,
            ability,
            ms,
            target,
            at,
        } => match wire_point(at) {
            Ok(anchor) => Wire::Fx(WireFx::WishStarted {
                event_time,
                caster: id.0,
                ability: ability_code(ability),
                duration: ms,
                target: target.map(|target| target.0),
                anchor,
            }),
            Err(reason) => Wire::Refused(reason),
        },
        SeenEvent::CastLanded {
            event_time,
            id,
            ability,
            target,
            at,
            to,
        } => match (wire_point(at), wire_point(to)) {
            (Ok(anchor), Ok(destination)) => Wire::Fx(WireFx::WishLanded {
                event_time,
                ability: ability_code(ability),
                caster: id.map(|id| id.0),
                target: target.map(|target| target.0),
                anchor,
                destination,
            }),
            (Err(reason), _) | (_, Err(reason)) => Wire::Refused(reason),
        },
        SeenEvent::PotionNotice { notice } => Wire::Event(WireEvent::PotionNotice {
            notice: match notice {
                rh_sim::potions::Notice::Stored => 1,
                rh_sim::potions::Notice::BagFull => 2,
                rh_sim::potions::Notice::Used => 3,
                rh_sim::potions::Notice::Blocked => 4,
                rh_sim::potions::Notice::Busy => 5,
                rh_sim::potions::Notice::Full => 6,
                rh_sim::potions::Notice::Empty => 7,
                rh_sim::potions::Notice::LargeStored => 8,
                rh_sim::potions::Notice::LargeUsed => 9,
                rh_sim::potions::Notice::CampBagFull => 10,
            },
        }),
        SeenEvent::CannonNotice { notice } => Wire::Event(WireEvent::CannonNotice {
            code: match notice {
                rh_sim::events::CannonNotice::Sealed => 1,
                rh_sim::events::CannonNotice::CantEnter => 2,
                rh_sim::events::CannonNotice::Blast => 3,
                rh_sim::events::CannonNotice::Reloading { .. } => 4,
            },
            seconds: match notice {
                rh_sim::events::CannonNotice::Reloading { seconds } => u16::try_from(seconds).ok(),
                _ => None,
            },
        }),
        SeenEvent::MobArmed { .. } | SeenEvent::CampCleared { .. } => Wire::Omitted,
        // Protocol 8 owner-only practice-console notice (the publisher routes it to its owner's connection only).
        SeenEvent::Toast { ref text } => Wire::Event(WireEvent::Toast { text: text.clone() }),
        SeenEvent::WindEmblem => Wire::Event(WireEvent::WindEmblem),
        SeenEvent::ChestRefused {
            reason: reason @ rh_sim::reward_chests::Refusal::Needs(_),
        } => Wire::Event(WireEvent::Toast {
            text: reason.message().into_owned(),
        }),
        SeenEvent::ChestRefused { reason } => Wire::Event(WireEvent::ChestRefused {
            reason: match reason {
                rh_sim::reward_chests::Refusal::Busy => 1,
                rh_sim::reward_chests::Refusal::Gone => 2,
                rh_sim::reward_chests::Refusal::Far => 3,
                rh_sim::reward_chests::Refusal::Blocked => 4,
                rh_sim::reward_chests::Refusal::Picked => 5,
                rh_sim::reward_chests::Refusal::Taken => 6,
                rh_sim::reward_chests::Refusal::Owned => 7,
                rh_sim::reward_chests::Refusal::Maxed => 8,
                rh_sim::reward_chests::Refusal::NotYours => 9,
                rh_sim::reward_chests::Refusal::Needs(_) => {
                    unreachable!("prerequisite notice projected as a toast above")
                }
            },
        }),
        SeenEvent::Death { id, by } => Wire::Event(WireEvent::Death {
            id: id.0,
            by: by.map(|b| b.0),
        }),
        SeenEvent::Bounty { id, bounty } => Wire::Event(WireEvent::Bounty {
            id: id.0,
            bounty: sat16(bounty),
        }),
        SeenEvent::Ended { winner, draw } => Wire::Event(WireEvent::MatchEnded {
            winner: winner.map(|w| w.0),
            draw,
        }),
        SeenEvent::Block { id, by, weapon } => Wire::Fx(WireFx::Block {
            id: id.0,
            by: by.map_or(WIRE_NO_SOURCE, |b| b.0),
            weapon: weapon.code(),
        }),
        SeenEvent::Stagger { id } => Wire::Fx(WireFx::Stagger { id: id.0 }),
        // Protocol 6 carries target commands but has no cancellation telegraph.
        SeenEvent::AttackCancelled { .. } => Wire::Omitted,
        SeenEvent::SignatureHit { .. } | SeenEvent::Heal { .. } => Wire::Omitted,
        // Scalar effects and fields have snapshot transport; these distinct event telegraphs
        // remain omitted until their own compatible messages are defined.
        SeenEvent::AbilityHit { .. } | SeenEvent::StatusApplied { .. } => Wire::Omitted,
        SeenEvent::CastEnded {
            event_time,
            id,
            ability,
            reason,
        } => Wire::Fx(WireFx::WishEnded {
            event_time,
            caster: id.0,
            ability: ability_code(ability),
            reason: match reason {
                rh_sim::status_runtime::CastEndReason::Fizzle => 0,
                rh_sim::status_runtime::CastEndReason::Interrupted => 1,
                rh_sim::status_runtime::CastEndReason::Cancelled => 2,
            },
        }),
        SeenEvent::PickupRefused { reason } => Wire::Event(WireEvent::PickupRefused {
            reason: match reason {
                rh_sim::PickupRefusal::Blocked => 1,
                rh_sim::PickupRefusal::NothingThere => 2,
                rh_sim::PickupRefusal::TooFar => 3,
                rh_sim::PickupRefusal::Unreachable => 4,
                rh_sim::PickupRefusal::NothingToTake => 5,
            },
        }),
        SeenEvent::Swing {
            by,
            weapon,
            x,
            y,
            a,
        } => Wire::Fx(WireFx::Swing {
            by: by.0,
            weapon: weapon.code(),
            x: x as f32,
            y: y as f32,
            a: a as f32,
        }),
        SeenEvent::Hit {
            victim,
            by,
            amount,
            passive,
        } => Wire::Fx(WireFx::Hit {
            victim: victim.0,
            by: by.map_or(WIRE_NO_SOURCE, |b| b.0),
            amount: amount as f32,
            passive,
        }),
    }
}

pub fn result(r: &RunResult) -> WireResult {
    WireResult {
        outcome: match r.outcome {
            Outcome::Won => 0,
            Outcome::Draw => 1,
            Outcome::Died => 2,
            Outcome::Mia => 3,
        },
        place: r.place.min(255) as u8,
        players: r.players.min(255) as u8,
        kills: sat16(r.kills),
        killed_by: r.killed_by.clone(),
        gv_total: r.gv.total,
        gv_win: r.gv.win,
        duration_sec: r.duration_sec,
        win_bonus_withheld: r.win_bonus_withheld,
    }
}

/// The hitbox archetype table as a Welcome carries it (protocol 16, ADR0024), from `rh_sim::archetype::ARCHETYPES`. Every
/// table value is a whole number that fits its wire byte (`rh_sim` asserts it); a test holds the round trip exact.
pub fn wire_archetypes() -> Vec<rh_protocol::WireArchetype> {
    use rh_sim::archetype::{Hull, ARCHETYPES};
    let byte = |v: f64| -> u8 {
        debug_assert!(v.fract() == 0.0 && (0.0..=255.0).contains(&v));
        v as u8
    };
    let signed = |v: f64| -> i8 {
        debug_assert!(v.fract() == 0.0 && (-128.0..=127.0).contains(&v));
        v as i8
    };
    ARCHETYPES
        .iter()
        .map(|a| rh_protocol::WireArchetype {
            id: a.id.0,
            key: a.key.to_string(),
            hull: match a.hull {
                Hull::Circle { r } => rh_protocol::WireHull::Circle { r: byte(r) },
                Hull::Boxes {
                    foot,
                    body,
                    body_offset,
                } => rh_protocol::WireHull::Boxes {
                    fx: byte(foot.x),
                    fy: byte(foot.y),
                    bx: byte(body.x),
                    by: byte(body.y),
                    ox: signed(body_offset.0),
                    oy: signed(body_offset.1),
                },
            },
            chest: byte(a.chest),
        })
        .collect()
}

/// The vision rule's parameters as a Welcome carries them (protocol 16): the sim's constants and, when the map has
/// layers, the exact coliseum rectangle `rh_sim::vision` reveals. All public facts (build constants and public map
/// metadata). The rect of a validated map lies inside it; one that would not fit the wire is a server bug.
pub fn wire_vision(map: &rh_sim::TileMap) -> rh_protocol::WireVision {
    use rh_sim::constants::{MASK_SIGHT, TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS};
    let coliseum = map.layers().map(|l| l.coliseum().rect).and_then(|r| {
        let tiles = |v: i64| u16::try_from(v).expect("a validated coliseum rect fits the wire");
        (r.w > 0 && r.h > 0).then(|| rh_protocol::WireRect {
            x: tiles(i64::from(r.x)),
            y: tiles(i64::from(r.y)),
            w: tiles(i64::from(r.w)),
            h: tiles(i64::from(r.h)),
        })
    });
    rh_protocol::WireVision {
        version: rh_protocol::VISION_RULES_VERSION,
        tile: TILE,
        radius: VISION_RADIUS,
        trail_ms: VISION_TRAIL_MS,
        update_ms: VISION_UPDATE_MS,
        sight_mask: MASK_SIGHT,
        coliseum,
    }
}

#[cfg(test)]
mod vision_block_tests {
    /// The block the server sends is valid, carries the sim's constants, and names exactly the rectangle
    /// `rh_sim::vision` reveals (the seed-1 source map has a coliseum; the practice arena has no layers).
    #[test]
    fn the_wire_vision_block_is_the_sim_rule() {
        use rh_sim::constants::{
            MASK_SIGHT, TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS,
        };
        let practice = super::wire_vision(&rh_sim::arenas::practice_arena().map);
        assert_eq!(practice.fault(), None);
        assert_eq!(practice.coliseum, None);
        assert_eq!(
            (
                practice.version,
                practice.tile,
                practice.radius,
                practice.trail_ms,
                practice.update_ms,
                practice.sight_mask
            ),
            (
                1,
                TILE,
                VISION_RADIUS,
                VISION_TRAIL_MS,
                VISION_UPDATE_MS,
                MASK_SIGHT
            )
        );
        let doc: serde_json::Value =
            serde_json::from_slice(include_bytes!("../../../../parity/arena/source.json")).unwrap();
        let export: rh_sim::mapdata::MapExport =
            serde_json::from_value(doc["map"]["export"].clone()).unwrap();
        let arena = export.validate().unwrap().into_arena().unwrap();
        let v = super::wire_vision(&arena.map);
        let rect = arena.map.layers().unwrap().coliseum().rect;
        let r = v.coliseum.expect("the source map has a coliseum");
        assert_eq!(
            (
                i64::from(r.x),
                i64::from(r.y),
                i64::from(r.w),
                i64::from(r.h)
            ),
            (
                i64::from(rect.x),
                i64::from(rect.y),
                i64::from(rect.w),
                i64::from(rect.h)
            )
        );
        assert!(v.fits(arena.map.w as u16, arena.map.h as u16));
        assert_eq!(v.fault(), None);
    }
}

#[cfg(test)]
mod archetype_table_tests {
    #[test]
    fn the_wire_table_is_the_sim_table_exactly() {
        use rh_sim::archetype::{Hull, ARCHETYPES};
        let wire = super::wire_archetypes();
        assert_eq!(rh_protocol::archetype::table_fault(&wire), None);
        assert_eq!(wire.len(), ARCHETYPES.len());
        for (w, a) in wire.iter().zip(&ARCHETYPES) {
            assert_eq!(
                (w.id, w.key.as_str(), f64::from(w.chest)),
                (a.id.0, a.key, a.chest)
            );
            match (w.hull, a.hull) {
                (rh_protocol::WireHull::Circle { r }, Hull::Circle { r: want }) => {
                    assert_eq!(f64::from(r), want)
                }
                (
                    rh_protocol::WireHull::Boxes {
                        fx,
                        fy,
                        bx,
                        by,
                        ox,
                        oy,
                    },
                    Hull::Boxes {
                        foot,
                        body,
                        body_offset,
                    },
                ) => assert_eq!(
                    [fx, fy, bx, by]
                        .map(f64::from)
                        .to_vec()
                        .into_iter()
                        .chain([f64::from(ox), f64::from(oy)])
                        .collect::<Vec<_>>(),
                    vec![foot.x, foot.y, body.x, body.y, body_offset.0, body_offset.1]
                ),
                _ => panic!("hull kind differs for {}", a.key),
            }
        }
    }
}
