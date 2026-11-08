//! Native cache-boundary controls; the five strict source cases prove real Fire/Plague NPC engagement.
use super::*;
use crate::{arenas, Placement, Secrets, Sim, SimConfig};
fn sim() -> Sim {
    Sim::reset_active(
        SimConfig {
            training: true,
            dummies: true,
            quests: false,
            consumables: false,
            regen: false,
            ..Default::default()
        },
        arenas::practice_arena(),
        Secrets::from_seed(1),
        &[
            Placement {
                profile: "fire".into(),
                faction: FactionId::Fire,
                bot: false,
                at: crate::Vec2::new(400., 320.),
                hp: None,
                weapon0: Some(WeaponId::Sword),
                weapon1: None,
            },
            Placement {
                profile: "holy".into(),
                faction: FactionId::Holy,
                bot: false,
                at: crate::Vec2::new(456., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    )
}
fn after(s: &mut Sim) {
    let mut events = vec![];
    after_damage(&mut Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev: &mut events,
        pf: &mut s.pf,
    });
}
#[test]
fn a_neutral_dummy_never_owns_a_dot_source_cache() {
    let mut s = sim();
    let dummy =
        s.w.mobs
            .iter()
            .find(|m| m.kind == crate::mob_runtime::MobKind::Dummy)
            .unwrap()
            .core
            .id;
    let d = s.w.mobs.get_mut(dummy).unwrap();
    assert!(d.mob_type.is_none());
    // Explicit diagnostic engagement input to this cache leaf, not a claimed source outcome.
    d.core.signature.engaged = true;
    d.core.signature.target = Some(PlayerId(1));
    after(&mut s);
    assert_eq!(s.w.mobs.get(dummy).unwrap().core.signature.engaged_on, None);
}
#[test]
fn a_player_festering_transition_is_applied_once_after_real_grants() {
    let mut s = sim();
    for card in [
        crate::cards::CardId::Ap1,
        crate::cards::CardId::FesteringArcana,
    ] {
        assert!(crate::cards::grant(&s.k, &mut s.w, PlayerId(1), card));
    }
    assert!(s.w.players[0].modifiers.mirrors().ap_bonus > 0.);
    // The old cached target and ended engagement are explicit inputs to the native transition diagnostic.
    s.w.players[0].signature.engaged_on = Some(PlayerId(2));
    s.w.players[0].signature.engaged = false;
    after(&mut s);
    assert_eq!(s.w.players[0].signature.engaged_on, None);
    let before = s.w.players[1].statuses.instances.clone();
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].source.id, Some(PlayerId(1)));
    after(&mut s);
    assert_eq!(
        s.w.players[1].statuses.instances, before,
        "no second apply/refresh from the same ended cache"
    );
}
