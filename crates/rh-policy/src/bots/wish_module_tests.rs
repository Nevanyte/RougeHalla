//! The Wish module in the policy seat: staged observations (no World handle) drive the ported HumanBot and the module itself,
//! and the emitted commands are the one validated PublicCommand shape. These tests cover the hook (a cast through the humanizer
//! and the intent channels), the tier filter, the blocked/casting/ready gates, the retry window and the fair hit memory.
use crate::bots::bot::HumanBot;
use crate::bots::paths::{PathBudget, RoomPathService};
use crate::bots::perception::Perception;
use crate::bots::types::{PersonaId, TierId, WishView};
use crate::bots::wish::{WishModule, WISH_RULES};
use crate::{MatchStart, Policy};
use rh_sim::abilities::OwnerView;
use rh_sim::observe::{ActorView, SeenEvent, SelfView};
use rh_sim::status_runtime::AbilityId;
use rh_sim::{Arena, FactionId, Observation, Phase, PlayerId, PublicCommand, Status, WeaponId};
use std::sync::Arc;

const ME: PlayerId = PlayerId(7);
const ENEMY: PlayerId = PlayerId(8);

fn arena() -> Arena {
    let mut tiles = vec![rh_sim::map::TILE_WALL; 24 * 24];
    for y in 1..23 {
        for x in 1..23 {
            tiles[(y * 24 + x) as usize] = rh_sim::map::TILE_FLOOR;
        }
    }
    Arena {
        map: rh_sim::TileMap::new(24, 24, tiles).expect("hand-built map"),
        spawns: vec![rh_sim::Vec2::new(400., 400.)],
    }
}

fn start() -> MatchStart {
    MatchStart {
        me: ME,
        seed: 11,
        arena: Arc::new(arena()),
        content_hash: rh_sim::content::content_hash(),
        observation_version: rh_sim::OBSERVATION_VERSION,
        tick_ms: rh_sim::constants::TICK_MS,
    }
}

fn wish(ability: AbilityId, ready_at: f64) -> Option<OwnerView> {
    let max_charges = rh_sim::abilities::definition(ability).charges;
    Some(OwnerView {
        ability,
        ready_at,
        full_at: None,
        max_charges,
        recharge_ms: rh_sim::abilities::cooldown(ability, false, None),
        charges: max_charges,
        next_charge_at: None,
        cast: None,
    })
}

fn observation(
    now: f64,
    wish: Option<OwnerView>,
    effects: u16,
    hp: f64,
    recent_hit: bool,
    enemy: Option<(f64, f64)>,
) -> Observation {
    let mut o = Observation {
        version: rh_sim::OBSERVATION_VERSION,
        tick: 1,
        server_time: now,
        phase: Phase::Active,
        ..Observation::default()
    };
    // Declared component input: empty known inventory, clear lock and source absolute clocks.
    // These are fixture inputs, not facts inferred from a missing native/public field.
    o.inventory = Some(rh_sim::Inventory {
        active_slot: 0,
        potion_small: 0,
        potion_large: 0,
        potions_healing: 0,
        slots: [None, None],
    });
    o.owner_combat = Some(rh_sim::OwnerCombatView {
        lock: rh_sim::OwnerLockView::Clear,
        draw_started_at: 0,
        ready_at: 0,
        as_milli: 1000.,
        windup_milli: 1000.,
        speed_milli: 1000.,
    });
    o.me = Some(SelfView {
        archetype: Default::default(),
        wish,
        effects,
        displace_seq: 0,
        mark_tier: 0,
        brand: 0,
        mark_by: None,
        mark_tax: 0,
        sig: 0,
        attack_target: None,
        hunt_target: None,
        hunt_stacks: 0,
        corpse_stacks: 0,
        plague_zombie: None,
        id: ME,
        faction: FactionId::Plague,
        x: 400.,
        y: 400.,
        facing: 0.,
        hp,
        max_hp: 1000.,
        barrier: 0.,
        barrier_ring_step: 0,
        status: Status::Alive,
        weapon: WeaponId::Fists,
        ready_in_ms: 0.,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
    });
    if let Some((x, y)) = enemy {
        o.visible.push(ActorView {
            archetype: Default::default(),
            kind: rh_sim::observe::ActorKind::Player,
            owner: None,
            mob_type: None,
            effects: 0,
            displace_seq: 0,
            mark_tier: 0,
            brand: 0,
            mark_by: None,
            mark_tax: 0,
            sig: 0,
            id: ENEMY,
            faction: FactionId::Fire.into(),
            x,
            y,
            facing: 0.,
            hp_frac: 1.,
            barrier_frac: 0.,
            barrier_ring_step: 0,
            status: Status::Alive,
            weapon: Some(WeaponId::Sword),
            bounty: 0,
        });
        if recent_hit {
            o.events.push(SeenEvent::Hit {
                victim: ME,
                by: Some(ENEMY),
                amount: 40.,
                passive: false,
            });
        }
    } else if recent_hit {
        o.events.push(SeenEvent::Hit {
            victim: ME,
            by: None,
            amount: 40.,
            passive: false,
        });
    }
    o
}

fn bot(tier: TierId) -> HumanBot {
    let mut bot = HumanBot::new(tier, PersonaId::Hunter);
    bot.reset(&start());
    bot
}

/// Drives a seat over observes at 20 Hz for three seconds, collecting the commands the humanizer releases, and returns whether
/// a Wish cast was emitted.
fn drives_to_cast(mut seat: HumanBot, obs_at: impl Fn(f64) -> Observation) -> Vec<PublicCommand> {
    let mut out = Vec::new();
    for tick in 0..60 {
        out.extend(seat.component_commands(&obs_at(1_000. + f64::from(tick) * 50.)));
    }
    out
}

#[test]
fn a_troubled_bot_casts_its_self_wish_through_the_policy_seat() {
    // Plague's Swarm is a self escape: low hp while being hit is trouble, so the cast is the Swarm at the bot's own feet. The
    // humanizer supplies the reaction time, so the seat is driven for three seconds of observations.
    let commands = drives_to_cast(bot(TierId::Normal), |now| {
        observation(now, wish(AbilityId::Swarm, 0.), 0, 300., true, None)
    });
    assert!(
        commands.iter().any(|c| matches!(
            c,
            PublicCommand::Cast {
                slot: rh_sim::abilities::Slot::Wish,
                id: None,
                ..
            }
        )),
        "the seat casts its Wish: {commands:?}"
    );
}

#[test]
fn the_same_staged_observation_decides_the_same_commands() {
    let obs = observation(1_000., wish(AbilityId::Swarm, 0.), 0, 300., true, None);
    let mut a = bot(TierId::Normal);
    let mut b = bot(TierId::Normal);
    assert_eq!(
        a.component_commands(&obs),
        b.component_commands(&obs),
        "two seats, one observation"
    );
}

#[test]
fn a_normal_bot_engages_with_its_unit_wish_and_easy_never_does() {
    // Freeze's tags are control/peel/engage: a player foe in range is cast on. Easy keeps only escape/sustain, so it never
    // spends such a Wish to engage.
    let normal_commands = drives_to_cast(bot(TierId::Normal), |now| {
        observation(
            now,
            wish(AbilityId::Freeze, 0.),
            0,
            900.,
            false,
            Some((480., 400.)),
        )
    });
    assert!(
        normal_commands.iter().any(|c| matches!(
            c,
            PublicCommand::Cast {
                slot: rh_sim::abilities::Slot::Wish,
                id: Some(ENEMY),
                ..
            }
        )),
        "the normal seat casts at the foe: {normal_commands:?}"
    );
    let easy_commands = drives_to_cast(bot(TierId::Easy), |now| {
        observation(
            now,
            wish(AbilityId::Freeze, 0.),
            0,
            900.,
            false,
            Some((480., 400.)),
        )
    });
    assert!(
        !easy_commands
            .iter()
            .any(|c| matches!(c, PublicCommand::Cast { .. })),
        "the easy seat never spends an engage Wish: {easy_commands:?}"
    );
}

#[test]
fn blocked_casting_late_and_absent_wishes_stay_uncast() {
    for obs in [
        // Caster stunned (a blockedBy bit), already casting, still on cooldown, and no abilities at all.
        observation(1_000., wish(AbilityId::Swarm, 0.), 1, 300., true, None),
        observation(1_000., wish(AbilityId::Swarm, 0.), 4096, 300., true, None),
        observation(1_000., wish(AbilityId::Swarm, 5_000.), 0, 300., true, None),
        observation(1_000., None, 0, 300., true, None),
    ] {
        let mut bot = bot(TierId::Normal);
        let commands = bot.component_commands(&obs);
        assert!(
            !commands
                .iter()
                .any(|c| matches!(c, PublicCommand::Cast { .. })),
            "an unusable Wish is not cast: {commands:?}"
        );
    }
}

#[test]
fn the_module_retries_only_after_the_rule_gap_and_forgets_an_old_hit() {
    let start = start();
    let mut module = WishModule::new();
    module.reset(&start.arena.map);
    let mut paths = RoomPathService::new(&start.arena.map, PathBudget::default());
    let mut perception = Perception::default();
    let mut decide = crate::bots::random::Rng::new(3);
    // Last Stand sustains at low hp while being hit: a hit 1000 ms ago counts, one older than the rule does not.
    let fresh = observation(1_000., wish(AbilityId::LastStand, 0.), 0, 340., true, None);
    let frame = perception
        .build(&crate::delivery::test_support::frame(&fresh), 1.)
        .expect("a frame");
    module.absorb_hits(frame.hit_at, &frame.fighter_hits);
    module.observe(&frame.percept, TierId::Normal, &mut decide);
    let intents = module.intents(
        &frame.percept,
        &frame.stimuli,
        None,
        TierId::Normal,
        &mut decide,
        &mut paths,
    );
    assert_eq!(intents.len(), 1, "the fresh hit sustains");
    // Within the retry gap nothing is asked again.
    let again = observation(1_500., wish(AbilityId::LastStand, 0.), 0, 340., true, None);
    let frame = perception
        .build(&crate::delivery::test_support::frame(&again), 1.)
        .expect("a frame");
    module.absorb_hits(frame.hit_at, &frame.fighter_hits);
    module.observe(&frame.percept, TierId::Normal, &mut decide);
    assert!(
        module
            .intents(
                &frame.percept,
                &frame.stimuli,
                None,
                TierId::Normal,
                &mut decide,
                &mut paths,
            )
            .is_empty(),
        "the retry gap holds"
    );
    // A hit older than recentHitMs is not "being hit" any more, even once the retry gap has passed.
    let old = observation(
        1_000. + WISH_RULES.recent_hit_ms + 2_000.,
        wish(AbilityId::LastStand, 0.),
        0,
        340.,
        false,
        None,
    );
    let frame = perception
        .build(&crate::delivery::test_support::frame(&old), 1.)
        .expect("a frame");
    module.observe(&frame.percept, TierId::Normal, &mut decide);
    assert!(
        module
            .intents(
                &frame.percept,
                &frame.stimuli,
                None,
                TierId::Normal,
                &mut decide,
                &mut paths,
            )
            .is_empty(),
        "an old hit does not sustain"
    );
}

#[test]
fn the_easy_filter_keeps_only_the_defensive_tags() {
    let freeze = crate::bots::wish::wish_by_id(AbilityId::Freeze).expect("a row");
    let blaze = crate::bots::wish::wish_by_id(AbilityId::Blaze).expect("a row");
    assert!(
        crate::bots::wish::played_ai(freeze, TierId::Easy).is_none(),
        "easy never spends an engage/control Wish"
    );
    assert_eq!(
        crate::bots::wish::played_ai(blaze, TierId::Easy),
        Some(&[crate::bots::wish::AiIntent::Escape][..]),
        "easy keeps the defensive tag"
    );
    assert_eq!(
        crate::bots::wish::played_ai(blaze, TierId::Normal),
        Some(blaze.ai),
        "other tiers play every tag"
    );
}

#[test]
fn a_hidden_bot_slips_away_and_locks_nobody() {
    // Hidden (the Swarm bit), with an enemy on screen: the Wish module's slip goal holds, so the seat walks away and offers no
    // lock/attack intent for the front end (legacy strategy scores the module goal above every goal while it holds).
    let commands = drives_to_cast(bot(TierId::Normal), |now| {
        observation(
            now,
            wish(AbilityId::Swarm, 4_000.),
            256,
            900.,
            false,
            Some((600., 400.)),
        )
    });
    assert!(
        commands
            .iter()
            .any(|c| matches!(c, PublicCommand::Move { .. })),
        "the seat slips: {commands:?}"
    );
    assert!(
        !commands.iter().any(|c| matches!(
            c,
            PublicCommand::Target { .. } | PublicCommand::Attack { .. }
        )),
        "a slipping seat locks nobody: {commands:?}"
    );
}

#[test]
fn the_wish_view_is_a_fair_copy_of_the_observation_slot() {
    let mut slot = wish(AbilityId::Trial, 250.).expect("a slot");
    slot.full_at = Some(1_250.);
    // The former raw-observation-only copy test used max=3, outside the actual human
    // protocol domain. Keep that malformed control, then compare the lawful max=2 input.
    let mut malformed = slot;
    malformed.max_charges = 3;
    let invalid = observation(1_000., Some(malformed), 0, 900., false, None);
    assert!(crate::delivery::DeliverySession::new(ME)
        .prepare(&invalid, true, true, &[])
        .is_err());
    slot.max_charges = 2;
    let obs = observation(1_000., Some(slot), 0, 900., false, None);
    let frame = Perception::default()
        .build(&crate::delivery::test_support::frame(&obs), 1.)
        .expect("a frame");
    let view: &WishView = frame.percept.extras.wish.as_ref().expect("the slot");
    assert_eq!(view.ability, AbilityId::Trial);
    assert_eq!(view.ready_at, 250.);
    assert_eq!(view.full_at, Some(1_250.));
    assert_eq!(view.max_charges, 2);
    assert_eq!(view.rank, 1);
    assert!(!view.casting);
    assert_eq!(frame.percept.self_view.effects, 0);
}
