//! Real native kill/offer tests plus explicitly fabricated comparison and numeric-redaction diagnostics.
use super::*;
use crate::{FactionId, Placement, RawCommand, Secrets, SimConfig, WeaponId};

fn born_trophy() -> Sim {
    let rows = (0..24)
        .map(|y| {
            (0..80)
                .map(|x| {
                    if x == 0 || x == 79 || y == 0 || y == 23 || (x == 20 && y < 19) {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>();
    let arena = crate::Arena {
        map: crate::map::TileMap::from_rows(&rows).unwrap(),
        spawns: vec![Vec2::new(300., 320.); 4],
    };
    let placements = [(300., 320.), (340., 320.), (300., 380.), (2100., 320.)]
        .into_iter()
        .enumerate()
        .map(|(i, (x, y))| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(x, y),
            hp: (i == 1).then_some(1.),
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        })
        .collect::<Vec<_>>();
    let mut sim = Sim::reset_active(
        SimConfig {
            pvp_rules: false,
            consumables: false,
            quests: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(7),
        &placements,
    );
    // Real card grant creates investment; no Trophy/option/gain/credit outcome is installed.
    assert!(crate::cards::grant(
        &sim.k,
        &mut sim.w,
        PlayerId(2),
        crate::cards::CardId::Ad1
    ));
    sim.submit(
        PlayerId(1),
        crate::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    for _ in 0..30 {
        sim.step();
        if !sim.w.reward_chests.is_empty() {
            break;
        }
    }
    assert_eq!(sim.phase(), crate::Phase::Active);
    assert_eq!(sim.player(PlayerId(2)).unwrap().status, crate::Status::Dead);
    assert_eq!(sim.w.reward_chests.len(), 1, "actual kill born Trophy");
    let chest = &sim.w.reward_chests[0];
    assert_eq!(chest.owner, Some(PlayerId(1)));
    assert!(chest
        .options
        .iter()
        .flatten()
        .all(|o| matches!(o, OptionId::Kill(a) if a.gain.is_finite() && a.gain > 0.)));
    sim
}

#[test]
fn real_kill_owner_only_before_options_visibility_and_handle_staging() {
    let mut sim = born_trophy();
    let mut owner = RewardChestObserver::new(PlayerId(1));
    let mut rows = Vec::new();
    let mut build = None;
    owner
        .prepare_into(&sim, &mut rows, &mut build)
        .unwrap()
        .commit();
    assert_eq!(rows.len(), 1);
    let owner_handle = rows[0].handle;
    assert_eq!(owner.ids, vec![sim.w.reward_chests[0].id]);
    for viewer in [PlayerId(3), PlayerId(4)] {
        let mut stranger = RewardChestObserver::new(viewer);
        let stage = stranger
            .stage_into_where(&sim, &mut rows, &mut build, |_| {
                panic!("private options reached adapter")
            })
            .unwrap();
        assert!(rows.is_empty() && stranger.scratch.is_empty());
        stranger.commit_stage(stage);
        assert!(stranger.ids.is_empty());
        assert_eq!(stranger.next, 1);
        assert_eq!(
            stranger.resolve(&sim, owner_handle, 0).unwrap(),
            crate::validate(RawCommand::Choose {
                chest_id: None,
                pick: 0
            })
            .unwrap()
        );
    }
    // Deliberately malformed private coordinates: diagnostic, not a reachable gameplay outcome.
    // Owner filtering must precede numeric checks and visibility sampling of this row.
    sim.w.reward_chests[0].at.x = f64::NAN;
    let mut stranger = RewardChestObserver::new(PlayerId(3));
    stranger
        .prepare_into(&sim, &mut rows, &mut build)
        .unwrap()
        .commit();
    assert!(rows.is_empty() && stranger.ids.is_empty());
}

#[test]
fn real_offer_drop_does_not_issue_handle_then_commit_allows_normal_choose() {
    let mut sim = born_trophy();
    sim.step();
    sim.step(); // independent of the separately repaired birth-availability boundary
    let mut observer = RewardChestObserver::new(PlayerId(1));
    let mut rows = Vec::new();
    let mut build = None;
    let pending = observer.prepare_into(&sim, &mut rows, &mut build).unwrap();
    let handle = rows[0].handle;
    drop(pending); // models rejected reliable enqueue: no commit
    assert!(observer.ids.is_empty());
    assert_eq!(observer.next, 1);
    assert_eq!(
        observer.resolve(&sim, handle, 0).unwrap(),
        crate::validate(RawCommand::Choose {
            chest_id: None,
            pick: 0
        })
        .unwrap()
    );
    observer
        .prepare_into(&sim, &mut rows, &mut build)
        .unwrap()
        .commit();
    assert_eq!(rows[0].handle, handle);
    let cmd = observer.resolve(&sim, handle, 0).unwrap();
    sim.submit(PlayerId(1), cmd).unwrap();
    sim.step();
    assert_eq!(sim.w.reward_chests[0].taken[0], Some(PlayerId(1)));
    assert!(sim.w.reward_chests[0].pickers.contains(&PlayerId(1)));
}

#[test]
fn source_born_trophy_visibility_geometry_diagnostic() {
    let mut sim = born_trophy();
    // Diagnostic reposition and empty sight trail isolate LOS/radius from the source's 30-second
    // memory. Ordinary walking away need not hide a 30-second Trophy before it expires.
    // Neither Trophy position/options nor any gameplay outcome is installed here.
    for x in [900., 2200.] {
        sim.w.players[0].body.x = x;
        sim.w.players[0].vision = Default::default();
        assert!(!crate::vision::point_visible(
            sim.collision_view(),
            sim.player(PlayerId(1)).unwrap(),
            sim.w.reward_chests[0].at,
            sim.tick(),
            crate::vision::WardSight::of_sim(&sim)
        ));
        let mut observer = RewardChestObserver::new(PlayerId(1));
        let mut rows = Vec::new();
        let mut build = None;
        observer
            .prepare_into(&sim, &mut rows, &mut build)
            .unwrap()
            .commit();
        assert!(rows.is_empty() && observer.ids.is_empty());
    }
}

#[test]
fn comparison_diagnostic_gain_only_change_renews_offer_and_binding() {
    let mut sim = born_trophy();
    let mut observer = RewardChestObserver::new(PlayerId(1));
    let mut rows = Vec::new();
    let mut build = None;
    observer
        .prepare_into(&sim, &mut rows, &mut build)
        .unwrap()
        .commit();
    let first = rows[0].clone();
    // Fabricated gain-only mutation solely diagnoses public equality, not a claimed native producer.
    let Some(OptionId::Kill(ref mut a)) = sim.w.reward_chests[0].options[0] else {
        panic!("Kill")
    };
    a.gain += 1.;
    let stage = observer.stage_into(&sim, &mut rows, &mut build).unwrap();
    assert!(stage.changed);
    assert_ne!(rows[0].options, first.options);
    assert_ne!(rows[0].handle, first.handle);
    observer.commit_stage(stage);
    assert_eq!(observer.ids, vec![sim.w.reward_chests[0].id]);
    assert_eq!(
        observer.resolve(&sim, rows[0].handle, 0).unwrap(),
        crate::validate(RawCommand::Choose {
            chest_id: Some(sim.w.reward_chests[0].id),
            pick: 0
        })
        .unwrap()
    );
}

#[test]
fn comparison_diagnostic_variant_ranges_and_gains_are_distinct() {
    let sim = born_trophy();
    let mut observer = RewardChestObserver::new(PlayerId(1));
    let mut rows = Vec::new();
    let mut build = None;
    observer
        .prepare_into(&sim, &mut rows, &mut build)
        .unwrap()
        .commit();
    let row = &rows[0];
    // All rows below are synthetic comparator diagnostics, never fixture/source evidence.
    let with = |id| {
        let mut r = row.clone();
        r.options = vec![RewardOptionView {
            id,
            taken: false,
            taken_by: None,
        }];
        r
    };
    for (a, b) in [
        (
            OptionId::Card(crate::cards::CardId::ALL[3]),
            OptionId::Boost(BoostId::Ad),
        ),
        (
            OptionId::Card(crate::cards::CardId::ALL[12]),
            OptionId::Kill(crate::kill_augments::KillAugment {
                key: crate::kill_augments::KillStatKey::Ad,
                gain: 1.,
            }),
        ),
    ] {
        assert!(public_cmp(&with(a), &with(b)).is_lt());
        assert!(public_cmp(&with(b), &with(a)).is_gt());
    }
    let kill = |gain| {
        OptionId::Kill(crate::kill_augments::KillAugment {
            key: crate::kill_augments::KillStatKey::Ad,
            gain,
        })
    };
    assert!(public_cmp(&with(kill(1.)), &with(kill(2.))).is_lt());
    assert!(public_cmp(&with(kill(1.)), &with(kill(1.))).is_eq());
    assert_eq!(crate::OBSERVATION_VERSION, 29);
}
