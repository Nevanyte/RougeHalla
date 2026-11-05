use super::*;
#[test]
fn eligible_owner_selection_precedes_tie_and_private_state_stays_private() {
    let mut s = crate::Sim::reset_active(
        crate::SimConfig {
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(12),
        &(0..4)
            .map(|i| crate::Placement {
                profile: format!("p{i}"),
                faction: if i < 2 {
                    FactionId::Sentenced
                } else {
                    FactionId::Holy
                },
                bot: false,
                at: crate::Vec2::new(if i == 0 { 2000. } else { 400. + i as f64 * 30. }, 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    );
    for i in 0..2 {
        s.w.players[i]
            .signature
            .set_target(PlayerId(3), s.w.server_time);
        s.w.players[i].signature.mark = crate::fighter::Mark {
            tier: 4,
            hits: 9,
            progress: 9.,
            ..Default::default()
        };
    }
    after_damage(&mut s.w);
    let direct = crate::observe::observe(&s, PlayerId(3), &[]);
    let me = direct.me.as_ref().unwrap();
    assert_eq!(
        (me.mark_tier, me.brand, me.mark_tax, me.mark_by),
        (4, 100, 0, Some(PlayerId(2)))
    );
    assert!(me.sig & SIG_EXEC_BLOCKED != 0);
    assert!(!direct.visible.iter().any(|p| p.id == PlayerId(1)));
    let mut cached = crate::Observation::default();
    let mut cache = crate::SightCache::default();
    crate::observe::observe_into_cached(&s, PlayerId(3), &[], &mut cached, &mut cache);
    assert_eq!(cached, direct);
    let other = crate::observe::observe(&s, PlayerId(4), &[]);
    let victim = other.visible.iter().find(|p| p.id == PlayerId(3)).unwrap();
    assert_eq!(victim.mark_by, Some(PlayerId(2)));
    s.w.players[0].signature.mark.hits = 100;
    s.w.players[0].signature.mark.progress = 123.;
    s.w.players[0].signature.mark.swaps = 100;
    s.w.players[0].signature.mark.denied = true;
    s.w.players[0].signature.mark.amp_until = 1000.;
    s.w.players[0].credit.sentence = 5;
    assert_eq!(crate::observe::observe(&s, PlayerId(3), &[]), direct);
    s.w.players[1].signature.mark.tier = 3;
    let hidden_stronger = crate::observe::observe(&s, PlayerId(3), &[]);
    assert_eq!(hidden_stronger.me.unwrap().mark_by, None);
    assert!(crate::observe::public_snapshot(&s)
        .players
        .iter()
        .all(|p| p.mark_by.is_none()));
    s.w.players[2].status = crate::Status::Dead;
    after_damage(&mut s.w);
    let dead = crate::observe::observe(&s, PlayerId(3), &[]).me.unwrap();
    assert_eq!((dead.mark_tier, dead.brand, dead.mark_by), (0, 0, None));
}

#[test]
fn same_tick_departure_derives_only_public_mark_bit_on_every_observation_path() {
    let mut s = crate::Sim::reset_active(
        crate::SimConfig {
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(12),
        &(0..4)
            .map(|i| crate::Placement {
                profile: format!("departure{i}"),
                faction: if i < 2 {
                    FactionId::Sentenced
                } else {
                    FactionId::Holy
                },
                bot: false,
                at: crate::Vec2::new(400. + i as f64 * 30., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    );
    for i in 0..2 {
        s.w.players[i]
            .signature
            .set_target(PlayerId(3), s.w.server_time);
        s.w.players[i].signature.mark = crate::fighter::Mark {
            tier: 4,
            hits: 9,
            progress: 9.,
            ..Default::default()
        };
    }
    s.w.players[1].signature.mark = crate::fighter::Mark {
        tier: 3,
        hits: 6,
        progress: 6.,
        ..Default::default()
    };
    after_damage(&mut s.w);
    s.w.players[2].signature.bits |= SIG_BURNING;
    let private_bits = s.w.players[2].signature.bits;
    let mut self_cache = crate::SightCache::default();
    let mut actor_cache = crate::SightCache::default();
    let mut cached = crate::Observation::default();
    crate::observe::observe_into_cached(&s, PlayerId(3), &[], &mut cached, &mut self_cache);
    assert_eq!(cached.me.as_ref().unwrap().sig, private_bits);
    s.remove_player(PlayerId(1));
    let remaining = crate::observe::observe(&s, PlayerId(3), &[]).me.unwrap();
    assert_eq!(
        (remaining.mark_tier, remaining.mark_by, remaining.sig),
        (3, Some(PlayerId(2)), SIG_BURNING)
    );
    s.remove_player(PlayerId(2));
    let tick = s.tick();
    let hash = s.state_hash();
    let direct = crate::observe::observe(&s, PlayerId(3), &[]);
    let me = direct.me.as_ref().unwrap();
    assert_eq!(
        (me.mark_tier, me.brand, me.mark_by, me.sig),
        (0, 0, None, SIG_BURNING)
    );
    crate::observe::observe_into_cached(&s, PlayerId(3), &[], &mut cached, &mut self_cache);
    assert_eq!(cached, direct);
    let actor_direct = crate::observe::observe(&s, PlayerId(4), &[]);
    crate::observe::observe_into_cached(&s, PlayerId(4), &[], &mut cached, &mut actor_cache);
    assert_eq!(cached, actor_direct);
    let actor = actor_direct
        .visible
        .iter()
        .find(|p| p.id == PlayerId(3))
        .unwrap();
    assert_eq!(
        (actor.mark_tier, actor.brand, actor.mark_by, actor.sig),
        (0, 0, None, SIG_BURNING)
    );
    assert_eq!(
        s.player(PlayerId(3)).unwrap().signature.bits,
        private_bits,
        "stored source diagnostics retain their prior sync timing"
    );
    assert_eq!(s.tick(), tick);
    assert_eq!(s.state_hash(), hash, "projection never edits private World");
}
