//! Native payout boundary controls. The strict abilities corpus supplies the real kill/source notice proof.
use super::*;
use crate::{FactionId, Placement, Secrets, Sim, SimConfig};

fn sim() -> Sim {
    let data =
        serde_json::from_str(include_str!("../../../tests/fixtures/mob-pve-map.json")).unwrap();
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_parts();
    let arena = crate::Arena {
        map: crate::TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns: vec![Vec2::new(400., 400.)],
    };
    Sim::reset_active(
        SimConfig {
            mob_mode: crate::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(1),
        &[Placement {
            profile: "human".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    )
}
fn award() -> Award {
    Award {
        mob: PlayerId(2),
        serial: 1,
        killer: Some(PlayerId(1)),
        camp: 0,
        weapon: WeaponId::Fists,
        at: Vec2::new(450., 400.),
        elite: false,
        mob_type: crate::mob_catalog::MobTypeId::EmberImp,
        zone: FactionId::Fire,
        mult: 1.,
        contributors: vec![PlayerId(1)],
    }
}
fn notices(events: &[Event]) -> Vec<&str> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Toast { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}
#[test]
fn credited_normal_payout_reports_only_the_actual_cumulative_grant_after_gv() {
    let mut s = sim();
    let ty = award().mob_type;
    s.w.players[0].farm.set(ty, 6);
    let mut events = vec![];
    pay(&s.k, &mut s.w, &mut events, award());
    assert_eq!(s.w.players[0].farm.count(ty), 9);
    assert_eq!(
        notices(&events),
        ["Ember Imp: +3 kill stacks · +9% damage total"]
    );
    assert!(matches!(events[0], Event::Gv { .. }));
    assert!(matches!(events[1], Event::Toast { .. }));
}
#[test]
fn capped_or_nonapplicable_payout_never_claims_a_stat_grant() {
    for kind in [
        "capped",
        "elite",
        "training",
        "resolved",
        "dead",
        "no-killer",
    ] {
        let mut s = sim();
        let mut a = award();
        match kind {
            "capped" => s.w.players[0]
                .farm
                .set(a.mob_type, crate::modifiers::farm::DEFINITION.max_count - 2),
            "elite" => a.elite = true,
            "training" => s.k.config.training = true,
            "resolved" => s.w.players[0].resolved = true,
            "dead" => s.w.players[0].status = Status::Dead,
            "no-killer" => a.killer = None,
            _ => unreachable!(),
        }
        let old = s.w.players[0].farm.count(a.mob_type);
        let mut events = vec![];
        pay(&s.k, &mut s.w, &mut events, a);
        assert!(notices(&events).is_empty(), "{kind}");
        assert_eq!(s.w.players[0].farm.count(award().mob_type), old, "{kind}");
    }
}
