//! Regional-NPC checkpoint admission for the real Card producer's Hemorrhage bleed.
//!
//! The motivating trajectory is the independently reviewed native probe: a normal Holy seat earns the no-ability
//! physical bleed on a surviving regional NPC through validated, budgeted Attack/Release input, and the checkpoint
//! reader refused it. These tests use that same ordinary producer path; only the checkpoint reader acceptance changed.
//! No status row is installed as proof, `on_hit` is never called directly, and no source expectation is rewritten.
use crate::cards::CardId;
use crate::content::DamageShares;
use crate::input::{validate, RawCommand};
use crate::mob_runtime::{ActorOrigin, MobKind};
use crate::status_runtime::{Payload, StatusInstance, StatusRuntime};
use crate::{
    CheckpointError, FactionId, FactionMode, Phase, PlayerId, Secrets, Sim, SimConfig, Status,
};
use serde_json::{json, Value};

fn seed1_arena() -> crate::Arena {
    let export: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json"))
            .expect("admitted seed1 map fixture");
    export
        .validate()
        .expect("certified seed1 layers validate")
        .into_arena()
        .expect("seed1 arena")
}

/// The same PvE profile with the hitbox mode chosen before the Sim is constructed (never flipped afterwards).
fn pve_config_with(hitboxes: crate::archetype::HitboxMode) -> SimConfig {
    SimConfig {
        hitboxes,
        abilities: crate::abilities::Mode::Off,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        hazards: crate::terrain::Mode::Off,
        regen: false,
        pvp_rules: false,
        quests: false,
        training: false,
        dummies: false,
        // The certified seed1 export carries constructor loot spots; the MVP storage path is the admitted one.
        initial_loot: true,
        consumables: false,
        mob_mode: crate::mob_runtime::MobMode::Pve,
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        ..Default::default()
    }
}

/// The normal constructor + real joins + ordinary raid-start step for the admitted five-faction seed1 profile.
fn pve_world(factions: &[FactionId]) -> (Sim, Vec<PlayerId>) {
    pve_world_with(factions, crate::archetype::HitboxMode::LegacyCircle)
}

fn pve_world_with(
    factions: &[FactionId],
    hitboxes: crate::archetype::HitboxMode,
) -> (Sim, Vec<PlayerId>) {
    let mut sim = Sim::try_new(
        pve_config_with(hitboxes),
        seed1_arena(),
        Secrets::from_seed(5),
    )
    .expect("normal PvE constructor admits the five-faction seed1 profile");
    let mut ids = Vec::new();
    for (i, faction) in factions.iter().enumerate() {
        ids.push(
            sim.add_player(&format!("bleed-test-{i}"), Some(*faction), false)
                .expect("admitted PvE seat joins the lobby"),
        );
    }
    sim.step();
    assert_eq!(sim.phase(), Phase::Active, "raid starts on step 1");
    assert_eq!(sim.tick(), 1);
    (sim, ids)
}

/// Choose a live regional NPC by retained typed provenance and a legal adjacent placement (walkable, melee ray clear,
/// within fists reach). The returned angle is the Attack aim towards that NPC.
fn place_attacker(sim: &mut Sim, player: PlayerId) -> (PlayerId, crate::Vec2, f64) {
    let map = sim.collision_map();
    let offsets = [
        (44., 0.),
        (-44., 0.),
        (0., 44.),
        (0., -44.),
        (32., 32.),
        (-32., 32.),
        (32., -32.),
        (-32., -32.),
    ];
    let fists_reach = match crate::content::weapon(crate::WeaponId::Fists).shape {
        crate::content::Shape::Arc { reach, .. } => reach,
        _ => unreachable!("fists are an arc weapon"),
    };
    for m in sim.w.mobs.iter() {
        if m.kind != MobKind::Regional
            || m.status != Status::Alive
            || m.zombie.is_some()
            || m.owner.is_some()
            || !matches!(sim.w.actor_origin(m.core.id), Some(ActorOrigin::Mob { .. }))
        {
            continue;
        }
        let target = m.core.pos();
        for (dx, dy) in offsets {
            let at = crate::Vec2::new(target.x + dx, target.y + dy);
            if !crate::geometry::circle_clear(
                map,
                at,
                crate::constants::PLAYER_RADIUS,
                crate::constants::MASK_MOVE,
            ) {
                continue;
            }
            if crate::geometry::ray_blocked(
                map,
                at.x,
                at.y,
                target.x,
                target.y,
                crate::constants::MASK_MELEE,
            ) {
                continue;
            }
            if crate::math::hypot(dx, dy) > fists_reach {
                continue;
            }
            let facing = crate::math::atan2(target.y - at.y, target.x - at.x);
            {
                let p = sim.w.players.get_mut(player).expect("attacker seat");
                p.core.body.x = at.x;
                p.core.body.y = at.y;
                p.core.body.facing = facing;
                p.core.motion.path.clear();
                p.core.motion.slip = None;
                p.core.body.history.reset(crate::state::Sample {
                    t: sim.w.server_time,
                    x: at.x,
                    y: at.y,
                });
            }
            return (m.core.id, at, facing);
        }
    }
    panic!("no legal adjacent regional NPC placement");
}

fn grant_hemorrhage(sim: &mut Sim, player: PlayerId) {
    assert!(
        crate::cards::grant(&sim.k, &mut sim.w, player, CardId::Hemorrhage),
        "real Hemorrhage grant"
    );
}

fn submit(sim: &mut Sim, player: PlayerId, raw: RawCommand) {
    let cmd = validate(raw).expect("ordinary command validates");
    sim.submit(player, cmd).expect("ordinary budgeted submit");
}

fn checkpoint(sim: &Sim) -> Value {
    serde_json::to_value(sim).expect("checkpoint writer")
}

fn restore(cp: &Value) -> Result<Sim, CheckpointError> {
    Sim::restore(cp)
}

fn refusal(cp: &Value) -> String {
    match restore(cp) {
        Err(CheckpointError::Malformed(why)) => why,
        Err(e) => panic!("expected Malformed, got {e}"),
        Ok(_) => panic!("the checkpoint was accepted"),
    }
}

fn hemorrhage_row_ms() -> f64 {
    CardId::Hemorrhage
        .definition()
        .rows
        .iter()
        .find_map(|row| match row {
            crate::cards::CardRow::OnHit(o)
                if o.status == crate::status_runtime::StatusKind::Dot =>
            {
                Some(o.ms)
            }
            _ => None,
        })
        .expect("the Hemorrhage card declares a Dot on-hit row")
}

fn bleed_on(sim: &Sim, npc: PlayerId) -> Option<StatusInstance> {
    sim.w.mobs.get(npc).and_then(|m| {
        m.core
            .statuses
            .instances
            .iter()
            .find(|st| {
                st.kind == crate::status_runtime::StatusKind::Dot
                    && st.ability.is_none()
                    && st
                        .tag
                        .as_ref()
                        .is_some_and(|t| t.as_str().starts_with("bleed:"))
            })
            .cloned()
    })
}

fn weapon_hit_rows(sim: &Sim, player: PlayerId) -> usize {
    sim.s
        .landed
        .iter()
        .filter(|h| h.by == Some(player) && h.weapon == Some(crate::WeaponId::Fists) && !h.dot)
        .count()
}

fn expected_bleed_payload() -> Payload {
    Payload {
        shares: Some(DamageShares {
            phys: 1.,
            magic: 0.,
            true_: 0.,
        }),
        ..Payload::default()
    }
}

/// Re-derive the checkpoint status row's location and the producer facts the predicate must compare against.
struct Earned {
    cp: Value,
    mob_index: usize,
    status_index: usize,
    npc: PlayerId,
    player: PlayerId,
    tag_tick: u32,
    started_at: f64,
}

/// Drive the real trajectory once and return the post-hit checkpoint plus the row's location/producer facts.
fn earned_post_hit_checkpoint() -> Earned {
    let (mut sim, players) = pve_world(&[FactionId::Holy]);
    let player = players[0];
    let (npc, _at, aim) = place_attacker(&mut sim, player);
    grant_hemorrhage(&mut sim, player);
    submit(&mut sim, player, RawCommand::Attack { a: aim, t: None });
    sim.step();
    assert!(
        weapon_hit_rows(&sim, player) > 0,
        "the ordinary Attack producer must have landed a weapon hit"
    );
    let tick = sim.tick();
    let bleed = bleed_on(&sim, npc).expect("the real on-hit producer earns the bleed");
    assert_eq!(
        bleed.tag.as_ref().map(|t| t.as_str()),
        Some(format!("bleed:{tick}").as_str()),
        "producer tag"
    );
    let mob_index = sim
        .w
        .mobs
        .iter()
        .position(|m| m.core.id == npc)
        .expect("typed regional NPC retained");
    let status_index = sim
        .w
        .mobs
        .get(npc)
        .unwrap()
        .core
        .statuses
        .instances
        .iter()
        .position(|st| {
            st.kind == crate::status_runtime::StatusKind::Dot
                && st.ability.is_none()
                && st
                    .tag
                    .as_ref()
                    .is_some_and(|t| t.as_str().starts_with("bleed:"))
        })
        .expect("bleed row index");
    Earned {
        cp: checkpoint(&sim),
        mob_index,
        status_index,
        npc,
        player,
        tag_tick: tick,
        started_at: bleed.started_at,
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The promoted regression: real trajectory, post-hit restore, and original/Clone/restored continuation.
// ---------------------------------------------------------------------------------------------------------------

#[test]
fn earned_hemorrhage_bleed_on_regional_npc_restores_and_continues() {
    earned_bleed_restores_and_continues(crate::archetype::HitboxMode::LegacyCircle);
}

/// The same real producer trajectory with Archetypes selected in the constructed Sim: the ordinary Attack must land a
/// weapon hit in this mode (asserted inside the shared body before any bleed assertion), then checkpoint, restore and
/// continuation invariants are identical. No status row is installed and no placement is assumed to carry over.
#[test]
fn earned_hemorrhage_bleed_on_regional_npc_restores_and_continues_under_archetypes() {
    earned_bleed_restores_and_continues(crate::archetype::HitboxMode::Archetypes);
}

fn earned_bleed_restores_and_continues(hitboxes: crate::archetype::HitboxMode) {
    let (mut sim, players) = pve_world_with(&[FactionId::Holy], hitboxes);
    assert_eq!(
        sim.config().hitboxes,
        hitboxes,
        "mode selected at construction"
    );
    let player = players[0];
    let (npc, _at, aim) = place_attacker(&mut sim, player);
    grant_hemorrhage(&mut sim, player);
    assert!(matches!(
        sim.w.actor_origin(npc),
        Some(ActorOrigin::Mob { .. })
    ));
    let npc_hp_before = sim.w.mobs.get(npc).unwrap().core.vitals.hp;

    // 1. The ordinary pre-hit checkpoint round-trips before anything is earned.
    let pre = checkpoint(&sim);
    let pre_restored = restore(&pre).expect("pre-hit baseline checkpoint restores");
    assert_eq!(pre_restored.state_hash(), sim.state_hash());
    assert_eq!(checkpoint(&pre_restored), pre);

    // 2. Real validated/budgeted Attack through the ordinary producer earns the bleed; the NPC survives.
    submit(&mut sim, player, RawCommand::Attack { a: aim, t: None });
    let attack_events = sim.step();
    let landed_weapon_hits = weapon_hit_rows(&sim, player);
    assert!(
        landed_weapon_hits > 0,
        "reached producer: weapon-hit landed rows in {attack_events:?}"
    );
    let hit_tick = sim.tick();
    let bleed = bleed_on(&sim, npc).expect("the real regional NPC bleed is present");
    let card_ms = hemorrhage_row_ms();
    let source_label = sim
        .w
        .roster
        .label(player)
        .expect("retained roster label")
        .clone();
    assert_eq!(bleed.kind, crate::status_runtime::StatusKind::Dot);
    assert!(bleed.ability.is_none(), "producer persisted no ability");
    assert_eq!(
        bleed.tag.as_ref().map(|t| t.as_str()),
        Some(format!("bleed:{hit_tick}").as_str()),
        "producer tag tick"
    );
    assert_eq!(
        bleed.until,
        bleed.started_at + card_ms,
        "producer duration is the binary64 addition started_at + ms"
    );
    assert_eq!(
        bleed.started_at, sim.w.server_time,
        "producer stores the application step's server time"
    );
    assert!(
        bleed.value.is_finite() && bleed.value > 0.,
        "producer value"
    );
    assert_eq!(bleed.source.id, Some(player));
    assert!(bleed.source.owner_id.is_none());
    assert_eq!(bleed.source.name, source_label);
    assert_eq!(bleed.data, expected_bleed_payload());
    assert!(bleed.reveal_from.is_none() && bleed.taken.is_none());
    let npc_after = sim.w.mobs.get(npc).unwrap();
    assert_eq!(npc_after.status, Status::Alive);
    assert!(npc_after.core.vitals.hp > 0. && npc_after.core.vitals.hp <= npc_hp_before);

    // 3. The post-hit checkpoint now restores; the restored state is the same authoritative state.
    let post = checkpoint(&sim);
    let mut original = sim;
    let mut cloned = original.clone();
    let mut restored = restore(&post).expect("earned regional NPC bleed checkpoint restores");
    assert_eq!(restored.state_hash(), original.state_hash());
    assert_eq!(checkpoint(&restored), post);
    assert!(restored.check_layout().is_ok());

    // 4. Original, Clone and restored receive the same remaining ordinary input and identical steps.
    for target in [&mut original, &mut cloned, &mut restored] {
        submit(target, player, RawCommand::Release { a: aim, t: None });
    }
    let mut compared_steps = 0usize;
    let mut compared_checkpoints = 0usize;
    for step in 0..60 {
        let events_original = original.step();
        let events_cloned = cloned.step();
        let events_restored = restored.step();
        assert_eq!(events_original, events_cloned, "clone events step {step}");
        assert_eq!(
            events_original, events_restored,
            "restored events step {step}"
        );
        assert_eq!(
            original.state_hash(),
            cloned.state_hash(),
            "clone hash step {step}"
        );
        assert_eq!(
            original.state_hash(),
            restored.state_hash(),
            "restored hash step {step}"
        );
        // Private full-state/checkpoint comparisons at the restore point and periodically afterwards.
        if step % 15 == 0 || step == 59 {
            let cp_original = checkpoint(&original);
            assert_eq!(
                cp_original,
                checkpoint(&cloned),
                "clone checkpoint step {step}"
            );
            assert_eq!(
                cp_original,
                checkpoint(&restored),
                "restored checkpoint step {step}"
            );
            compared_checkpoints += 1;
        }
        compared_steps += 1;
    }
    assert_eq!(compared_steps, 60);
    assert!(compared_checkpoints >= 5);

    // 5. The underlying produced bleed has fully expired through the ordinary status clock on all three, still equal.
    assert!(
        bleed_on(&original, npc).is_none(),
        "the produced bleed expires through the ordinary status clock"
    );
    assert!(bleed_on(&cloned, npc).is_none());
    assert!(bleed_on(&restored, npc).is_none());
    assert_eq!(original.state_hash(), cloned.state_hash());
    assert_eq!(original.state_hash(), restored.state_hash());
    assert_eq!(checkpoint(&original), checkpoint(&restored));
    let final_cp = checkpoint(&original);
    let final_restored = restore(&final_cp).expect("continued ordinary state restores");
    assert_eq!(final_restored.state_hash(), original.state_hash());
    assert!(original.check_layout().is_ok());
}

// ---------------------------------------------------------------------------------------------------------------
// Retained-history acceptance: the producer source may have departed; admission uses history, not presence.
// ---------------------------------------------------------------------------------------------------------------

#[test]
fn earned_bleed_restores_after_source_departure_through_retained_known_history() {
    let (mut sim, players) = pve_world(&[FactionId::Holy, FactionId::Holy]);
    let attacker = players[0];
    let (npc, _at, aim) = place_attacker(&mut sim, attacker);
    grant_hemorrhage(&mut sim, attacker);
    submit(&mut sim, attacker, RawCommand::Attack { a: aim, t: None });
    sim.step();
    assert!(
        bleed_on(&sim, npc).is_some(),
        "earned bleed before departure"
    );
    let bleed = bleed_on(&sim, npc).unwrap();

    // Ordinary lifecycle action: permanent departure of the producer's player.
    sim.remove_player(attacker);
    assert!(sim.w.player(attacker).is_none(), "attacker departed");
    assert!(sim.w.known_actor(attacker), "retained actor history");
    assert_eq!(
        sim.w.roster.label(attacker).map(AsRef::as_ref),
        Some(bleed.source.name.as_ref()),
        "retained roster label"
    );
    let departed = bleed_on(&sim, npc).expect("the earned bleed survives the departure");
    assert_eq!(departed.source.id, Some(attacker));
    println!(
        "DEPARTURE phase={:?} server={} player_present={} known_actor={} bleed_present={}",
        sim.phase(),
        sim.server_time(),
        sim.w.player(attacker).is_some(),
        sim.w.known_actor(attacker),
        bleed_on(&sim, npc).is_some()
    );

    // The reader accepts this checkpoint through retained known-actor history even though the producer's player is
    // no longer present, and the restored state is identical.
    let cp = checkpoint(&sim);
    let mut restored =
        restore(&cp).expect("departed source restores through retained known history");
    assert_eq!(restored.state_hash(), sim.state_hash());
    assert_eq!(checkpoint(&restored), cp);

    // Both continue the same ordinary steps after departure with identical behaviour/state.
    let mut compared = 0usize;
    for step in 0..20 {
        assert_eq!(sim.step(), restored.step(), "departed-source step {step}");
        assert_eq!(sim.state_hash(), restored.state_hash(), "hash {step}");
        if step % 10 == 0 || step == 19 {
            assert_eq!(checkpoint(&sim), checkpoint(&restored), "checkpoint {step}");
        }
        compared += 1;
    }
    assert_eq!(compared, 20);
    assert!(sim.check_layout().is_ok());
    let final_cp = checkpoint(&sim);
    let final_restored = restore(&final_cp).expect("departed-source continuation restores");
    assert_eq!(final_restored.state_hash(), sim.state_hash());
}

// ---------------------------------------------------------------------------------------------------------------
// Accepted restored-clock trajectories: the checkpoint reader's Lifecycle-Off clock domain validates the numeric range
// and the tick maximum, not `server_time == tick * TICK_MS`. The narrow predicate therefore compares only the producer's
// actual persisted facts (canonical tag tick <= world tick, producer-stored start, exact `started_at + ms`) and adds no
// invented clock equality, epsilon or range cap.
// ---------------------------------------------------------------------------------------------------------------

struct ClockedEarned {
    sim: Sim,
    player: PlayerId,
    npc: PlayerId,
    tag_tick: u32,
    started_at: f64,
    until: f64,
    card_ms: f64,
}

/// Label only the clock declaration on a normally constructed world, prove the reader accepts it, then earn the bleed
/// through the real validated/budgeted Attack producer under that accepted clock.
fn earn_bleed_after_declared_clock(declared_server_time: f64) -> ClockedEarned {
    let (mut sim, players) = pve_world(&[FactionId::Holy]);
    let player = players[0];
    sim.w.server_time = declared_server_time;
    // Labelled clock declaration only; the actual reader must accept it before the hit supplies the regression receipt.
    let declared = checkpoint(&sim);
    let mut sim = restore(&declared).expect("declared-clock baseline restores");
    assert_eq!(sim.w.server_time, declared_server_time);
    let (npc, _at, aim) = place_attacker(&mut sim, player);
    grant_hemorrhage(&mut sim, player);
    submit(&mut sim, player, RawCommand::Attack { a: aim, t: None });
    sim.step();
    assert!(
        weapon_hit_rows(&sim, player) > 0,
        "the real hit producer must be reached under the declared clock"
    );
    let tag_tick = sim.tick();
    let bleed = bleed_on(&sim, npc).expect("earned bleed under the declared clock");
    assert_eq!(
        bleed.tag.as_ref().map(|t| t.as_str()),
        Some(format!("bleed:{tag_tick}").as_str())
    );
    assert_eq!(bleed.started_at, sim.w.server_time);
    let card_ms = hemorrhage_row_ms();
    assert_eq!(
        bleed.until,
        bleed.started_at + card_ms,
        "the producer's binary64 until = started_at + ms"
    );
    ClockedEarned {
        sim,
        player,
        npc,
        tag_tick,
        started_at: bleed.started_at,
        until: bleed.until,
        card_ms,
    }
}

fn release_and_restore_declared_clock(earned: ClockedEarned) {
    let ClockedEarned {
        mut sim,
        player,
        npc,
        ..
    } = earned;
    // Remaining ordinary input/steps after the hit.
    submit(&mut sim, player, RawCommand::Release { a: 0., t: None });
    sim.step();
    assert!(
        bleed_on(&sim, npc).is_some(),
        "the earned bleed is retained under the declared clock"
    );
    let cp = checkpoint(&sim);
    let mut restored =
        restore(&cp).expect("earned regional NPC bleed restores under the accepted declared clock");
    let mut original = sim;
    assert_eq!(restored.state_hash(), original.state_hash());
    assert_eq!(checkpoint(&restored), cp);
    for step in 0..10 {
        assert_eq!(
            original.step(),
            restored.step(),
            "declared-clock continuation step {step}"
        );
        assert_eq!(original.state_hash(), restored.state_hash());
    }
    assert_eq!(checkpoint(&original), checkpoint(&restored));
    assert!(original.check_layout().is_ok());
}

/// Focused unit control for the producer's exact forward binary64 operation: `until = started_at + ms` (as
/// `status_runtime::mutation` computes it), not `until - started_at == ms`. This is a private predicate-shape check on a
/// constructed instance; it does not install a status or seed a checkpoint.
#[test]
fn producer_forward_duration_operation_accepts_the_binary64_counterexample() {
    let (sim, players) = pve_world(&[FactionId::Holy]);
    let player = players[0];
    // nextafter(2000, +Infinity): the static counterexample from the independent review.
    let started_at = f64::from_bits(2000.0f64.to_bits() + 1);
    assert_eq!(started_at, 2000.0000000000002);
    let ms = hemorrhage_row_ms();
    let producer_until = started_at + ms;
    assert_eq!(
        producer_until, 4000.,
        "forward producer addition rounds here"
    );
    assert_ne!(
        producer_until - started_at,
        ms,
        "reverse subtraction is not the producer operation"
    );

    let row = StatusInstance {
        kind: crate::status_runtime::StatusKind::Dot,
        source: crate::status_runtime::StatusSource {
            id: Some(player),
            name: sim
                .w
                .roster
                .label(player)
                .expect("retained roster label")
                .clone(),
            owner_id: None,
        },
        ability: None,
        tag: Some(crate::status_runtime::StatusTag::from(
            format!("bleed:{}", sim.w.tick).as_str(),
        )),
        started_at,
        until: producer_until,
        value: 2.5,
        reveal_from: None,
        taken: None,
        data: expected_bleed_payload(),
    };
    assert!(
        super::earned_hemorrhage_bleed(&sim.w, &row),
        "the forward producer operation is admitted"
    );
    // No epsilon/tolerance: the neighboring binary64 value is not the producer's persisted duration.
    let mut neighbor = row.clone();
    neighbor.until = f64::from_bits(producer_until.to_bits() + 1);
    assert!(
        !super::earned_hemorrhage_bleed(&sim.w, &neighbor),
        "the forward duration comparison is exact (no fitted tolerance)"
    );
}

#[test]
fn earned_bleed_restores_under_an_accepted_fractional_clock_without_tick_time_equality() {
    // server_time = 1284.5 while world.tick is 1: an accepted Lifecycle-Off clock that is not tick * TICK_MS.
    let declared = 50.0 + 1234.5;
    let earned = earn_bleed_after_declared_clock(declared);
    assert_eq!(earned.started_at, declared + crate::constants::TICK_MS);
    assert_ne!(
        earned.started_at,
        f64::from(earned.tag_tick) * crate::constants::TICK_MS,
        "the accepted clock declaration is not the tag-tick clock"
    );
    release_and_restore_declared_clock(earned);
}

#[test]
fn earned_bleed_restores_under_an_accepted_large_clock_preserving_producer_duration() {
    // Near the reader's admitted numeric clock bound; the producer addition stays exact (the bound is far below 2^53).
    let declared = u32::MAX as f64 * crate::constants::TICK_MS - 10_000.0;
    let earned = earn_bleed_after_declared_clock(declared);
    assert_eq!(earned.started_at, declared + crate::constants::TICK_MS);
    assert_eq!(earned.until, earned.started_at + earned.card_ms);
    assert!(earned.started_at > 1e11, "a genuinely large accepted clock");
    release_and_restore_declared_clock(earned);
}

// ---------------------------------------------------------------------------------------------------------------
// Malformed producer-shape controls that reach the status-domain predicate; acceptance controls tied to the real
// shape only; generic validator remainder.
// ---------------------------------------------------------------------------------------------------------------

#[test]
fn malformed_earned_bleed_shapes_refuse_at_status_domain_predicate() {
    let earned = earned_post_hit_checkpoint();
    let Earned {
        cp,
        mob_index,
        status_index,
        npc,
        player,
        tag_tick,
        started_at,
    } = earned;
    assert!(
        restore(&cp).is_ok(),
        "the unchanged earned producer shape is accepted"
    );
    let row = format!("/world/mobs/{mob_index}/core/statuses/instances/{status_index}");
    let mutated = |path: &str, value: Value| {
        let mut bad = cp.clone();
        *bad.pointer_mut(path)
            .unwrap_or_else(|| panic!("missing {path}")) = value;
        bad
    };

    // Every control below is rejected by the narrow status-domain predicate (`unsupported mob status domain`).
    // Each mutation keeps the generic status/provenance fields admissible; in this reader the status-domain clause is
    // evaluated before the generic status validator, so the typed refusal is the narrow clause, not a generic error.
    let controls: Vec<(&str, Value)> = vec![
        (
            "generic source-less NPC Dot",
            mutated(
                &format!("{row}/source"),
                json!({"id": null, "name": "", "owner_id": null}),
            ),
        ),
        (
            "noncanonical leading-zero tag",
            mutated(&format!("{row}/tag"), json!(format!("bleed:0{tag_tick}"))),
        ),
        (
            "wrong tag",
            mutated(&format!("{row}/tag"), json!("onHit:dot")),
        ),
        (
            "ability is not producer's None",
            mutated(&format!("{row}/ability"), json!("freeze")),
        ),
        (
            "player-only kind",
            mutated(&format!("{row}/kind"), json!("hidden")),
        ),
        (
            "nondefault payload field",
            mutated(&format!("{row}/data/reveal_until"), json!(500.0)),
        ),
        (
            "non-physical shares",
            mutated(
                &format!("{row}/data/shares"),
                json!({"phys": 0.9, "magic": 0.1, "true_": 0.0}),
            ),
        ),
        (
            "wrong duration",
            mutated(&format!("{row}/until"), json!(started_at + 1999.0)),
        ),
        (
            "future tag tick beyond the world tick",
            mutated(
                &format!("{row}/tag"),
                json!(format!("bleed:{}", tag_tick + 1)),
            ),
        ),
        (
            "zero tag tick",
            mutated(&format!("{row}/tag"), json!("bleed:0")),
        ),
        (
            "owner semantics changed",
            mutated(&format!("{row}/source/owner_id"), json!(player.0)),
        ),
        (
            "forged source name",
            mutated(&format!("{row}/source/name"), json!("forged")),
        ),
        (
            "known non-player source",
            mutated(&format!("{row}/source/id"), json!(npc.0)),
        ),
        (
            "negative producer value",
            mutated(&format!("{row}/value"), json!(-1.0)),
        ),
        (
            "status cast fact on a mob",
            mutated(
                &format!("/world/mobs/{mob_index}/core/statuses/cast"),
                json!({
                    "ability": "blaze",
                    "started_at": 0.0,
                    "lands_at": 500.0,
                    "cancelled_by": {"stun": true, "silence": true, "root": false, "stagger": false},
                    "producer": null,
                }),
            ),
        ),
    ];
    for (label, bad) in &controls {
        assert_eq!(
            refusal(bad),
            "unsupported mob status domain",
            "control must be refused by the status-domain predicate: {label}"
        );
    }

    // The predicate must not require the source to still own Hemorrhage: clearing the build copy is still accepted.
    let mut no_card = cp.clone();
    let player_index = no_card["world"]["players"]
        .as_array()
        .expect("players")
        .iter()
        .position(|p| p["core"]["id"] == json!(player.0))
        .expect("source player present");
    *no_card
        .pointer_mut(&format!(
            "/world/players/{player_index}/build/counts/{}",
            CardId::Hemorrhage.index()
        ))
        .expect("hemorrhage count leaf") = json!(0);
    assert!(
        restore(&no_card).is_ok(),
        "acceptance must not require current card ownership"
    );

    // No new magnitude cap or expected scalar: a finite producer-domain value is not clamped by this repair.
    let no_cap = mutated(&format!("{row}/value"), json!(1e300));
    assert!(
        restore(&no_cap).is_ok(),
        "acceptance adds no magnitude cap beyond the producer/general finite domain"
    );

    // Generic status validation remains authoritative (unchanged), independent of the narrow admission.
    let now = 10_000.;
    let generic = |value: f64, until: f64, reveal_from: Option<f64>| StatusInstance {
        kind: crate::status_runtime::StatusKind::Dot,
        source: crate::status_runtime::StatusSource {
            id: None,
            name: "generic".into(),
            owner_id: None,
        },
        ability: None,
        tag: Some(crate::status_runtime::StatusTag::from("generic:dot")),
        started_at: 5_000.,
        until,
        value,
        reveal_from,
        taken: None,
        data: Payload::default(),
    };
    let table = |row: StatusInstance| StatusRuntime {
        initialized: true,
        instances: vec![row],
        ..Default::default()
    };
    assert_eq!(
        crate::status_runtime::validate(&table(generic(f64::NAN, now, None)), now),
        Err("invalid clock or magnitude"),
        "nonfinite value stays rejected by generic validation"
    );
    assert_eq!(
        crate::status_runtime::validate(&table(generic(1., now + 10_001., None)), now),
        Err("invalid clock or magnitude"),
        "over-max time stays rejected by generic validation"
    );
    assert_eq!(
        crate::status_runtime::validate(&table(generic(1., 6_000., Some(f64::NAN))), now),
        Err("nonfinite payload"),
        "nonfinite payload stays rejected by generic validation"
    );
    let mut nonfinite_shares = generic(1., 6_000., None);
    nonfinite_shares.data = Payload {
        shares: Some(DamageShares {
            phys: f64::INFINITY,
            magic: 0.,
            true_: 0.,
        }),
        ..Payload::default()
    };
    assert_eq!(
        crate::status_runtime::validate(&table(nonfinite_shares), now),
        Err("nonfinite shares"),
        "nonfinite shares stay rejected by generic validation"
    );
}
