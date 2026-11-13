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

/// The indicator flag byte of a fighter's facts (ADR0026): `rh_protocol::ACTOR_FLAG_*`.
pub fn indicator_flags(f: &rh_sim::observe::IndicatorFacts) -> u8 {
    (if f.wish_ready {
        rh_protocol::ACTOR_FLAG_WISH_READY
    } else {
        0
    }) | (if f.engaged {
        rh_protocol::ACTOR_FLAG_ENGAGED
    } else {
        0
    }) | (if f.teleport_immune {
        rh_protocol::ACTOR_FLAG_TELEPORT_IMMUNE
    } else {
        0
    }) | (if f.roam_ready {
        rh_protocol::ACTOR_FLAG_ROAM_READY
    } else {
        0
    })
}

/// The packed build-mark byte (ADR0026): the first key in the low nibble, the second in the high one, each the
/// `KillStatKey` index + 1 (0 none).
pub fn build_marks(f: &rh_sim::observe::IndicatorFacts) -> u8 {
    let code = |k: Option<rh_sim::kill_augments::KillStatKey>| k.map_or(0, |k| k.index() as u8 + 1);
    code(f.build_marks[0]) | code(f.build_marks[1]) << 4
}

pub fn wire_self(m: &rh_sim::observe::SelfView) -> WireSelf {
    WireSelf {
        flags: indicator_flags(&m.facts),
        build_marks: build_marks(&m.facts),
        mark_tier: m.mark_tier,
        brand: m.brand,
        mark_tax: m.mark_tax,
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
        flags: indicator_flags(&a.facts),
        offhand: a.facts.offhand.map_or(0, |w| w.code() + 1),
        build_marks: build_marks(&a.facts),
        mark_tier: a.mark_tier,
        brand: a.brand,
        mark_tax: a.mark_tax,
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
        SeenEvent::MobArmed { .. } => Wire::Omitted,
        // ADR0026: the legacy camp-clear ring cue (public: the sim declares the event to everyone).
        SeenEvent::CampCleared { camp } => match u16::try_from(camp) {
            Ok(camp) => Wire::Event(WireEvent::CampCleared { camp }),
            Err(_) => Wire::Refused("camp"),
        },
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
        // ADR0026: the cancel ends the windup telegraph; signature/ability chunks and heals carry the legacy damage-number
        // kinds. Each reaches exactly the observers the sim's own visibility admitted.
        SeenEvent::AttackCancelled { id } => Wire::Fx(WireFx::Cancel { id: id.0 }),
        SeenEvent::SignatureHit {
            victim,
            by,
            sig,
            amount,
            ..
        } => Wire::Fx(WireFx::SigHit {
            victim: victim.0,
            by: by.map_or(WIRE_NO_SOURCE, |b| b.0),
            kind: match sig {
                rh_sim::factions::SignatureKind::Burn => rh_protocol::HIT_KIND_BURN,
                rh_sim::factions::SignatureKind::Disease => rh_protocol::HIT_KIND_DISEASE,
                rh_sim::factions::SignatureKind::Backlash => rh_protocol::HIT_KIND_BACKLASH,
                rh_sim::factions::SignatureKind::Mark => rh_protocol::HIT_KIND_MARK,
            },
            amount: amount as f32,
        }),
        SeenEvent::AbilityHit {
            victim,
            by,
            ability,
            amount,
        } => Wire::Fx(WireFx::SigHit {
            victim: victim.0,
            by: by.map_or(WIRE_NO_SOURCE, |b| b.0),
            kind: rh_protocol::HIT_KIND_ABILITY + ability_code(ability),
            amount: amount as f32,
        }),
        SeenEvent::Heal { id, amount } => Wire::Fx(WireFx::Heal {
            id: id.0,
            amount: amount as f32,
        }),
        // Scalar effects and fields have snapshot transport; the status telegraph remains omitted until its own
        // compatible message is defined.
        SeenEvent::StatusApplied { .. } => Wire::Omitted,
        SeenEvent::Windup { by, weapon, a, ms } => Wire::Fx(WireFx::Windup {
            by: by.0,
            weapon: weapon.code(),
            a: a as f32,
            // Whole milliseconds; a NaN or negative wait is 0, a longer one saturates.
            ms: ms.clamp(0.0, f64::from(u16::MAX)).round() as u16,
        }),
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
            critical,
        } => Wire::Fx(WireFx::Hit {
            victim: victim.0,
            by: by.map_or(WIRE_NO_SOURCE, |b| b.0),
            amount: amount as f32,
            passive,
            critical,
        }),
    }
}

/// The characters of `name` the roster keeps (ADR0026): control characters dropped, cut to at most
/// [`rh_protocol::state::MAX_ROSTER_NAME`] bytes on a character boundary. Seat names are already server-owned (Hello
/// callsigns, generated bot names), so this only guards the wire bound.
fn roster_chars(name: &str) -> impl Iterator<Item = char> + '_ {
    let mut used = 0;
    name.chars()
        .filter(|c| !c.is_control())
        .take_while(move |c| {
            used += c.len_utf8();
            used <= rh_protocol::state::MAX_ROSTER_NAME
        })
}

/// A display name as the roster carries it: [`roster_chars`], or "?" when nothing is left.
pub fn roster_name(name: &str) -> String {
    let out: String = roster_chars(name).collect();
    if out.is_empty() {
        "?".to_string()
    } else {
        out
    }
}

/// Whether `wire` is what [`roster_name`] makes of `raw`, without allocating (a name that needed cleaning is compared
/// every tick per connection).
fn roster_name_matches(wire: &str, raw: &str) -> bool {
    if wire == raw {
        return true;
    }
    let mut cleaned = roster_chars(raw).peekable();
    if cleaned.peek().is_none() {
        return wire == "?";
    }
    cleaned.eq(wire.chars())
}

/// The rows a roster carries: the observation's (ascending by id) cut to the lowest
/// [`rh_protocol::state::MAX_ROSTER`] ids, so an oversized match can never make the whole State frame refuse.
fn roster_rows(seen: &[rh_sim::observe::RosterRow]) -> &[rh_sim::observe::RosterRow] {
    debug_assert!(
        seen.len() <= rh_protocol::state::MAX_ROSTER,
        "a match seats at most {} players on the roster",
        rh_protocol::state::MAX_ROSTER
    );
    &seen[..seen.len().min(rh_protocol::state::MAX_ROSTER)]
}

/// Whether the committed wire roster still equals the observation's (no allocation).
pub fn roster_equal(
    wire: &[rh_protocol::WireRosterRow],
    seen: &[rh_sim::observe::RosterRow],
) -> bool {
    let seen = roster_rows(seen);
    wire.len() == seen.len()
        && wire
            .iter()
            .zip(seen)
            .all(|(w, s)| w.id == s.id.0 && w.bot == s.bot && roster_name_matches(&w.name, &s.name))
}

/// The observation's roster as State key 12 rows (the lowest [`rh_protocol::state::MAX_ROSTER`] ids).
pub fn wire_roster(seen: &[rh_sim::observe::RosterRow]) -> Vec<rh_protocol::WireRosterRow> {
    roster_rows(seen)
        .iter()
        .map(|s| rh_protocol::WireRosterRow {
            id: s.id.0,
            bot: s.bot,
            name: roster_name(&s.name),
        })
        .collect()
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

/// The projectile body-contact radius the sim uses for `w`'s flights (`rh_sim::systems::projectiles`: the bow looses arrows
/// that meet a body grown by `ARROW_RADIUS`; every other ranged weapon fires balls grown by `RANGED_SLACK`). The weapon to
/// projectile-kind rule is private to the sim, so it is mirrored here and pinned by the test below.
fn projectile_contact_radius(w: rh_sim::WeaponId) -> f64 {
    use rh_sim::constants::{ARROW_RADIUS, RANGED_SLACK};
    if w == rh_sim::WeaponId::Bow {
        ARROW_RADIUS
    } else {
        RANGED_SLACK
    }
}

/// The weapon table a Welcome carries (protocol 16): one row per `rh_sim::WeaponId::ALL` (wire id `code()`), built from the
/// sim content's hit shapes, so a client draws the true melee sector or projectile reach without a hand copy. All public
/// content constants (no C-OBS concern). A shape that would not fit the wire is a server bug (the test holds it).
pub fn wire_weapons() -> Vec<rh_protocol::WireWeapon> {
    use rh_sim::content::{weapon, Shape};
    rh_sim::WeaponId::ALL
        .into_iter()
        .map(|w| match weapon(w).shape {
            Shape::Arc { reach, half_arc } => rh_protocol::WireWeapon {
                id: w.code(),
                kind: rh_protocol::WEAPON_KIND_ARC,
                reach,
                half_arc,
                speed: 0.0,
                radius: 0.0,
            },
            Shape::Projectile { speed, range } => rh_protocol::WireWeapon {
                id: w.code(),
                kind: rh_protocol::WEAPON_KIND_PROJECTILE,
                reach: range,
                half_arc: 0.0,
                speed,
                radius: projectile_contact_radius(w),
            },
        })
        .collect()
}

/// The HUD content block a Welcome carries (protocol 17, P-WIRE17-HUD-2b): one scaling row per `rh_sim::WeaponId::ALL`
/// (wire id `code()`) from `rh_sim::modifiers::rules::DEFINITION.weapon_scaling`, and every `rh_protocol::HudTerm` code
/// from the sim's Wish definitions (docs/backlog/packets/P-WIRE17-HUD-2b.md, "Field list") and Fire roam constants
/// (P-WIRE17-HUD-2c). All public content constants, the same for every viewer (no C-OBS concern).
///
/// A term whose sim source is missing (a content change that drops the value) is left out rather than sent as a made-up
/// number; `crates/rh-policy/tests/hud_content.rs` requires every code.
pub fn wire_hud() -> rh_protocol::WireHudContent {
    use rh_protocol::HudTerm::*;
    use rh_sim::abilities::{self as ab, Target};
    use rh_sim::status_runtime::{AbilityId, BLAZE_FIELD_POLICY, TRIAL_FIELD_POLICY};
    let scaling = rh_sim::WeaponId::ALL
        .into_iter()
        .map(|w| {
            // Columns: AD, AP, bonus HP, bonus defense, dominant (modifiers/rules.rs).
            let [ad, ap, bonus_hp, bonus_defense, dominant] =
                rh_sim::modifiers::DEFINITION.weapon_scaling[usize::from(w.code())];
            rh_protocol::WireWeaponScaling {
                id: w.code(),
                ad,
                ap,
                bonus_hp,
                bonus_defense,
                dominant: dominant != 0.0,
            }
        })
        .collect();
    let freeze_range = match ab::definition(AbilityId::Freeze).target {
        Target::Unit(range) => Some(range),
        _ => None,
    };
    let burn = BLAZE_FIELD_POLICY.burn;
    // In code order (the wire requires strictly ascending codes).
    let terms = [
        (FreezeStunMs, Some(ab::FREEZE_STUN_MS)),
        (FreezeRange, freeze_range),
        (SwarmHiddenMs, Some(ab::SWARM_MS)),
        (SwarmCloudRadius, Some(ab::SWARM_RADIUS)),
        (TrialZoneMs, Some(ab::TRIAL_MS)),
        (TrialDealtMult, Some(ab::TRIAL_DEALT_MULT)),
        (TrialMoveMult, Some(ab::TRIAL_MOVE_MULT)),
        (TrialTakenMult, Some(ab::TRIAL_TAKEN_MULT)),
        (TrialExitStunMs, TRIAL_FIELD_POLICY.exit_stun_ms),
        (TrialRadius, Some(ab::TRIAL_RADIUS)),
        (TrialConvictedRadius, Some(ab::TRIAL_CONVICTED_RADIUS)),
        (BlazeBurnDps, burn.map(|(dps, _)| dps)),
        (BlazeBurnMs, burn.map(|(_, ms)| ms)),
        (BlazeMinDist, Some(ab::blink::MIN_DIST)),
        (BlazeMaxDist, Some(ab::blink::MAX_DIST)),
        (LastStandMs, Some(ab::LAST_STAND_MS)),
        (LastStandSpeedBonus, Some(ab::LAST_STAND_HASTE)),
        (LastStandHealShare, Some(ab::LAST_STAND_HEAL)),
        (LastStandFloorHp, Some(ab::LAST_STAND_FLOOR)),
        // P-WIRE17-HUD-2c: the Fire roam line's constants (shared/fireRoam.ts:2-7, championCombatModel.ts:115-116).
        (FireRoamRampMs, Some(rh_sim::constants::FIRE_ROAM_RAMP_MS)),
        (
            FireRoamChargeMax,
            Some(rh_sim::constants::FIRE_ROAM_CHARGE_MAX),
        ),
        (
            FireRoamBurstBase,
            Some(rh_sim::constants::FIRE_ROAM_BURST_BASE),
        ),
        (
            FireRoamBurstAdShare,
            Some(rh_sim::constants::FIRE_ROAM_BURST_AD_SHARE),
        ),
    ]
    .into_iter()
    .filter_map(|(code, value)| {
        value.map(|value| rh_protocol::WireHudTerm {
            code: code as u8,
            value,
        })
    })
    .collect();
    rh_protocol::WireHudContent { scaling, terms }
}

#[cfg(test)]
mod weapon_table_tests {
    /// Every weapon has exactly one row, in wire order, carrying the sim content's shape; the table passes the decoder's
    /// checks; arrows (bow) and balls (wand) carry the contact radius their flights use.
    #[test]
    fn the_wire_weapon_table_is_the_sim_content() {
        use rh_sim::content::{weapon, Shape};
        use rh_sim::WeaponId;
        let wire = super::wire_weapons();
        assert_eq!(rh_protocol::weapon::table_fault(&wire), None);
        assert_eq!(wire.len(), WeaponId::ALL.len());
        for (row, w) in wire.iter().zip(WeaponId::ALL) {
            assert_eq!(row.id, w.code());
            assert_eq!(WeaponId::from_code(row.id), Some(w));
            match weapon(w).shape {
                Shape::Arc { reach, half_arc } => assert_eq!(
                    (row.kind, row.reach, row.half_arc, row.speed, row.radius),
                    (rh_protocol::WEAPON_KIND_ARC, reach, half_arc, 0.0, 0.0)
                ),
                Shape::Projectile { speed, range } => assert_eq!(
                    (row.kind, row.reach, row.half_arc, row.speed),
                    (rh_protocol::WEAPON_KIND_PROJECTILE, range, 0.0, speed)
                ),
            }
        }
        let radius = |w: WeaponId| wire[usize::from(w.code())].radius;
        assert_eq!(radius(WeaponId::Bow), rh_sim::constants::ARROW_RADIUS);
        assert_eq!(radius(WeaponId::Wand), rh_sim::constants::RANGED_SLACK);
    }

    /// The golden-vector sample table hand-copies content values: it must stay equal to the server's real table for the six
    /// weapons (plus its reserved no-shape row), so a content change cannot leave `protocol/fixtures` stale.
    #[test]
    fn the_sample_weapon_table_is_the_servers_table() {
        let real = super::wire_weapons();
        let sample = rh_protocol::samples::sample_weapons();
        assert_eq!(real.len(), 6);
        assert_eq!(sample.len(), real.len() + 1);
        assert_eq!(sample[..real.len()], real[..]);
        assert_eq!(sample[real.len()].kind, rh_protocol::WEAPON_KIND_NONE);
    }

    /// `projectile_contact_radius` mirrors a rule private to the sim (`systems::projectiles::spawn` picks the flight kind
    /// from the weapon, `first_body` the slack from the kind). Fire every projectile weapon in a real sim and check the
    /// launched kind against the radius the wire table advertises.
    #[test]
    fn the_contact_radius_agrees_with_the_kind_the_sim_launches() {
        use rh_sim::constants::{ARROW_RADIUS, RANGED_SLACK};
        use rh_sim::content::{weapon, Shape};
        use rh_sim::{Event, ProjectileKind, WeaponId};
        let mut fired = 0;
        for w in WeaponId::ALL {
            if !matches!(weapon(w).shape, Shape::Projectile { .. }) {
                continue;
            }
            let mut sim = rh_sim::Sim::reset_active(
                rh_sim::SimConfig {
                    quests: false,
                    weapon_specials: false,
                    ..Default::default()
                },
                rh_sim::arenas::practice_arena(),
                rh_sim::Secrets::from_seed(24),
                &[rh_sim::Placement {
                    profile: "p1".into(),
                    faction: rh_sim::FactionId::Holy,
                    bot: false,
                    at: rh_sim::Vec2::new(100., 272.),
                    hp: Some(10_000.0),
                    weapon0: Some(w),
                    weapon1: None,
                }],
            );
            let id = rh_sim::PlayerId(1);
            let cmd = |c| rh_sim::validate(c).unwrap();
            sim.submit(id, cmd(rh_sim::RawCommand::Attack { a: 0., t: None }))
                .unwrap();
            let mut kinds = Vec::new();
            for i in 0..40 {
                if i == 20 {
                    sim.submit(id, cmd(rh_sim::RawCommand::Release { a: 0., t: None }))
                        .unwrap();
                }
                for e in sim.step() {
                    if let Event::ProjectileLaunched(l) = e {
                        kinds.push(l.kind);
                    }
                }
            }
            // Holding the attack through the release may loose more than one flight; they all share the weapon's kind.
            assert!(!kinds.is_empty(), "{w:?} launches a flight");
            assert!(kinds.iter().all(|k| *k == kinds[0]), "{w:?}: {kinds:?}");
            let want = match kinds[0] {
                ProjectileKind::Arrow => ARROW_RADIUS,
                ProjectileKind::Ball => RANGED_SLACK,
            };
            assert_eq!(super::projectile_contact_radius(w), want, "{w:?}");
            fired += 1;
        }
        assert_eq!(fired, 2, "the bow and the wand are the projectile weapons");
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

#[cfg(test)]
mod roster_tests {
    use super::*;

    #[test]
    fn roster_names_are_bounded_printable_and_never_empty() {
        assert_eq!(roster_name("Wren"), "Wren");
        assert_eq!(roster_name("a\u{7}b\nc"), "abc");
        assert_eq!(roster_name(""), "?");
        assert_eq!(roster_name("\u{1}"), "?");
        let long = "\u{e9}".repeat(20); // 40 bytes
        let cut = roster_name(&long);
        assert_eq!(
            cut.len(),
            24,
            "cut on a character boundary at the byte bound"
        );
        assert!(rh_protocol::state::roster_name_valid(&cut));
    }

    /// Release builds cut an oversized roster to the lowest ids instead of refusing the whole State frame (debug builds
    /// assert, since no match seats that many players).
    #[test]
    fn an_oversized_roster_is_cut_to_the_lowest_ids_deterministically() {
        let seen: Vec<_> = (1..=40)
            .map(|i| rh_sim::observe::RosterRow {
                id: rh_sim::PlayerId(i),
                name: format!("p{i}"),
                bot: i % 2 == 0,
            })
            .collect();
        let cut = std::panic::catch_unwind(|| wire_roster(&seen));
        if cfg!(debug_assertions) {
            assert!(cut.is_err(), "debug builds assert the seat bound");
            // The cut itself, without the assertion.
            let rows = &seen[..rh_protocol::state::MAX_ROSTER];
            let wire: Vec<_> = rows
                .iter()
                .map(|s| rh_protocol::WireRosterRow {
                    id: s.id.0,
                    bot: s.bot,
                    name: roster_name(&s.name),
                })
                .collect();
            assert_eq!(wire.last().unwrap().id, 32);
            assert!(rh_protocol::ServerMsg::State {
                tick: 1,
                items: vec![rh_protocol::StateItem::Roster(wire)],
            }
            .try_encode()
            .is_ok());
        } else {
            let wire = cut.unwrap();
            assert_eq!(wire.len(), rh_protocol::state::MAX_ROSTER);
            assert_eq!(wire.last().unwrap().id, 32, "the lowest ids are kept");
            assert!(roster_equal(&wire, &seen));
        }
    }

    #[test]
    fn the_wire_roster_matches_the_observation_until_it_changes() {
        let seen = vec![
            rh_sim::observe::RosterRow {
                id: rh_sim::PlayerId(1),
                name: "Wren".into(),
                bot: false,
            },
            rh_sim::observe::RosterRow {
                id: rh_sim::PlayerId(2),
                name: "x".repeat(40),
                bot: true,
            },
        ];
        let wire = wire_roster(&seen);
        assert!(roster_equal(&wire, &seen));
        let mut changed = seen.clone();
        changed[0].bot = true;
        assert!(!roster_equal(&wire, &changed));
        assert!(!roster_equal(&wire, &seen[..1]));
        changed = seen.clone();
        changed[1].name = "y".repeat(40);
        assert!(
            !roster_equal(&wire, &changed),
            "a cleaned name is still compared"
        );
        for raw in ["Wren", "", "\u{1}", "a\u{7}b", &"\u{e9}".repeat(20)] {
            assert!(roster_name_matches(&roster_name(raw), raw), "{raw:?}");
        }
        assert!(rh_protocol::ServerMsg::State {
            tick: 1,
            items: vec![rh_protocol::StateItem::Roster(wire)],
        }
        .try_encode()
        .is_ok());
    }
}
