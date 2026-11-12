//! P-WIRE17-HUD-1 oracle (observation side): every seat observes only its own GAINED summary, equal to
//! `build_summary` of that seat; every camp row carries its farm reward (public content) and the camp ward as a
//! verdict for the viewer, never an owner id.
//!
//! Legacy: `packages/client/src/ui/buildModel.ts` `buildGains` (the strip), `packages/client/src/ui/planning.ts:160-193`
//! (reward badge: the regular mob's `mobStatReward`), `packages/client/src/render/CampWards.ts:39-54` (a ward is drawn
//! only while `now < wardExpiresAt`; "YOUR WARD" when `wardOwner === localId`, else "WARD").
use super::*;
use crate::build_summary::{build_summary, BuildSummary};
use crate::cards::CardId;
use crate::map::TileMap;
use crate::mob_catalog::MobTypeId as M;
use crate::modifiers::farm::RewardStat;
use crate::stat_fold::{EffectStat, FlatStat};
use crate::{Arena, FactionId, Placement, Secrets, SimConfig, Vec2};

/// The HUD stat a farm reward stat maps to (legacy `rewardIconFor`, planning.ts:161-174).
fn hud(stat: RewardStat) -> HudStat {
    match stat {
        RewardStat::Flat(FlatStat::Ad) => HudStat::Offense,
        RewardStat::Flat(FlatStat::Ap) => HudStat::SoulOffense,
        RewardStat::Stat(EffectStat::Damage) => HudStat::Damage,
        RewardStat::Stat(EffectStat::AttackSpeed) => HudStat::AttackSpeed,
        RewardStat::Stat(EffectStat::Lifesteal) => HudStat::LifeSteal,
        RewardStat::Stat(EffectStat::MaxHp) => HudStat::Health,
        RewardStat::Flat(FlatStat::Armor) => HudStat::Defense,
        RewardStat::Flat(FlatStat::Shield) => HudStat::SoulDefense,
        RewardStat::Stat(EffectStat::MoveSpeed) => HudStat::MoveSpeed,
        other => panic!("no farm reward uses {other:?}"),
    }
}

/// The summary view the observation must carry for `s`: gains in HudStat order, owned rows in catalog order.
fn view_of(s: &BuildSummary) -> SummaryView {
    SummaryView {
        gains: [
            s.offense,
            s.soul_offense,
            s.damage,
            s.attack_speed,
            s.life_steal,
            s.health,
            s.defense,
            s.soul_defense,
            s.move_speed,
        ],
        mob_rows: s
            .mob_rows
            .iter()
            .flatten()
            .map(|r| SummaryMobRow {
                mob: r.mob,
                stacks: r.stacks,
                stat: hud(r.stat),
                total: r.total,
            })
            .collect(),
    }
}

fn room() -> Arena {
    let (w, h) = (20usize, 12usize);
    let rows: Vec<String> = (0..h)
        .map(|y| {
            (0..w)
                .map(|x| {
                    if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    Arena {
        map: TileMap::from_rows(&rows).expect("room"),
        spawns: vec![Vec2::new(112., 112.), Vec2::new(400., 200.)],
    }
}

fn placement(profile: &str, at: Vec2) -> Placement {
    Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    }
}

#[test]
fn each_seat_observes_only_its_own_build_summary() {
    let ps = [
        placement("a", Vec2::new(112., 112.)),
        placement("b", Vec2::new(400., 200.)),
    ];
    let secrets = Secrets {
        order_salt: 1,
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    let config = SimConfig {
        quests: false,
        pvp_rules: false,
        ..Default::default()
    };
    let mut sim = Sim::reset_active(config, room(), secrets, &ps);
    let (a, b) = (sim.players()[0].id, sim.players()[1].id);
    {
        let (k, w) = (&sim.k, &mut sim.w);
        for card in [CardId::Ad1, CardId::Armor1, CardId::Haste1, CardId::Leech1] {
            assert!(crate::cards::grant(k, w, a, card), "{card:?}");
        }
        for (mob, n) in [(M::EmberImp, 7), (M::Bailiff, 4), (M::Acolyte, 8)] {
            assert_eq!(crate::modifiers::grant_mob_stat(k, w, a, mob, n), n);
        }
    }
    let want_a = view_of(&build_summary(&sim, a).expect("a seated"));
    let want_b = view_of(&build_summary(&sim, b).expect("b seated"));
    assert_ne!(
        want_a, want_b,
        "the two builds differ, so a leak is visible"
    );
    assert_eq!(want_a.mob_rows.len(), 3);
    assert!(want_b.mob_rows.is_empty());

    assert_eq!(
        observe(&sim, a, &[]).summary,
        Some(want_a),
        "seat A observes its own summary"
    );
    assert_eq!(
        observe(&sim, b, &[]).summary,
        Some(want_b),
        "seat B observes its own (empty) summary, never A's"
    );
    assert_eq!(
        observe(&sim, PlayerId(9_999), &[]).summary,
        None,
        "an unseated viewer observes no summary"
    );
}

fn seed1_arena() -> Arena {
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../mapdata/fixtures/seed1.map.json"))
            .expect("the certified seed1 map parses");
    let actual = import
        .validate()
        .expect("the certified seed1 layers validate");
    let spawns = actual
        .layers()
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let (w, h, tiles, layers) = actual.into_parts();
    Arena {
        map: TileMap::new(w, h, tiles)
            .expect("unchanged certified dimensions")
            .with_layers(layers)
            .expect("validated layers attach"),
        spawns,
    }
}

#[test]
fn camp_rows_carry_reward_and_a_per_viewer_ward_verdict() {
    let arena = seed1_arena();
    let ps = [
        placement("a", arena.spawns[0]),
        placement("b", arena.spawns[1]),
    ];
    let mut secrets = Secrets::from_seed(1);
    secrets.reward_salt = [1, 2, 3, 4];
    let mut sim = Sim::reset_active(
        SimConfig {
            mob_mode: crate::mob_runtime::MobMode::Pve,
            // As vision_ward_tests: the certified seed1 map needs the MVP storage mode for its initial loot.
            initial_loot: true,
            consumables: true,
            ..Default::default()
        },
        arena,
        secrets,
        &ps,
    );
    let (a, b) = (sim.players()[0].id, sim.players()[1].id);
    let camps = sim.camp_rosters().to_vec();
    assert!(camps.len() >= 2, "seed1 has camps");
    let now = sim.server_time();
    {
        let rt = sim.w.mob_runtime.as_mut().expect("pve runtime");
        rt.life[0].ward_owner = Some(a);
        rt.life[0].ward_expires_at = now + 60_000.;
        // An expired ward (legacy draws it only while now < wardExpiresAt) is no ward.
        rt.life[1].ward_owner = Some(b);
        rt.life[1].ward_expires_at = now;
    }
    let rewards: Vec<Option<CampReward>> = camps
        .iter()
        .map(|c| {
            crate::modifiers::farm::Farm::reward_of(c.mob_type).map(|r| CampReward {
                stat: hud(r.stat),
                amount: r.value,
            })
        })
        .collect();
    assert!(
        rewards.iter().all(Option::is_some),
        "every camp's normal type has a reward"
    );

    for (viewer, verdict) in [
        (a, WardVerdict::Yours),
        (b, WardVerdict::Other),
        (PlayerId(9_999), WardVerdict::Other),
    ] {
        let obs = observe(&sim, viewer, &[]);
        assert_eq!(obs.camps, camps, "the public camp rows are unchanged");
        assert_eq!(obs.camp_hud.len(), camps.len(), "one HUD row per camp");
        for (i, row) in obs.camp_hud.iter().enumerate() {
            assert_eq!(row.reward, rewards[i], "camp {i} reward");
            let (want, at) = if i == 0 {
                (verdict, now + 60_000.)
            } else {
                (WardVerdict::None, 0.)
            };
            assert_eq!(
                (row.ward, row.ward_expires_at),
                (want, at),
                "camp {i} ward seen by {viewer:?}"
            );
        }
    }
}
