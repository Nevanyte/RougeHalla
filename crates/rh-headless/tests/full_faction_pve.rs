//! Native Full-capability coupling through the real external-agent input and checkpoint seams.
//! These are native lifecycle controls; the five source Wish cases remain separately byte-exact.
use rh_headless::Env;
use rh_sim::{
    FactionId, FactionMode, Placement, PlayerId, PublicCommand, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};
fn scene(mode: FactionMode) -> Sim {
    let map =
        serde_json::from_str(include_str!("../../rh-sim/tests/fixtures/mob-pve-map.json")).unwrap();
    let arena = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let seats = (0..8)
        .map(|i| Placement {
            profile: format!("full-{i}"),
            faction: [
                FactionId::Sentenced,
                FactionId::Frost,
                FactionId::Holy,
                FactionId::Fire,
                FactionId::Plague,
            ][i % 5],
            bot: false,
            at: Vec2::new(112. + 32. * (i % 4) as f64, 200. + 32. * (i / 4) as f64),
            hp: None,
            weapon0: Some(WeaponId::Bow),
            weapon1: None,
        })
        .collect::<Vec<_>>();
    Sim::reset_active(
        SimConfig {
            mob_mode: rh_sim::mob_runtime::MobMode::Pve,
            faction_mode: mode,
            abilities: rh_sim::abilities::Mode::Full,
            quests: false,
            consumables: false,
            regen: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(12),
        &seats,
    )
}
#[test]
fn full_and_fire_roam_pve_use_real_env_input_restore_clone_and_continuation() {
    for mode in [
        FactionMode::EngagementHolyPlagueFireFrostSentenced,
        FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
    ] {
        let original = scene(mode);
        assert_eq!(original.players().len(), 8);
        assert!(!original.mobs().is_empty());
        let (mut env, _) = Env::from_external_checkpoint(original.clone(), 300).unwrap();
        let mut direct = original;
        let mut direct_observers = (1..=8)
            .map(|id| rh_sim::ItemObserver::new(PlayerId(id)))
            .collect::<Vec<_>>();
        let mut restored = None::<Env>;
        let mut saw_mark = false;
        let mut saw_frost = false;
        for n in 0..100 {
            let observations = env.observations();
            let mut commands = vec![vec![]; 8];
            if n % 10 == 0 {
                for (i, obs) in observations.iter().enumerate() {
                    if let Some(target) = obs.visible.iter().find(|a| a.kind == 1) {
                        commands[i].push(PublicCommand::Target { actor: target.id });
                        let me = obs.me.as_ref().unwrap();
                        commands[i].push(PublicCommand::Attack {
                            a: (target.y - me.y).atan2(target.x - me.x),
                            t: None,
                        });
                    }
                }
            }
            // Delivery uses each actual ItemObserver: no privileged target handle or state enters a decision.
            for (i, rows) in commands.iter().enumerate() {
                let id = PlayerId(i as u32 + 1);
                let observer = &mut direct_observers[i];
                let mut observation = Default::default();
                observer
                    .observe_into(&direct, &[], &mut observation, None)
                    .unwrap();
                for command in rows {
                    let command = observer.resolve(&direct, *command).unwrap();
                    direct.submit(id, command).unwrap();
                }
            }
            let events = direct.step();
            let out = env.try_step(&commands).unwrap();
            assert_eq!(events, out.events);
            assert_eq!(direct.state_hash(), env.sim.state_hash());
            saw_mark |= direct.players().iter().any(|p| p.signature.mark.tier > 0);
            saw_frost |= direct.players().iter().any(|p| p.signature.chill < 1.)
                || direct.mobs().iter().any(|m| m.core.signature.chill < 1.);
            if let Some(r) = restored.as_mut() {
                let output = r.try_step(&commands).unwrap();
                assert_eq!(output.events, out.events);
                assert_eq!(r.sim.state_hash(), direct.state_hash());
            }
            if n == 20 {
                let checkpoint =
                    rh_sim::Sim::restore(serde_json::to_value(&direct).unwrap()).unwrap();
                let mut clone = direct.clone();
                let mut roundtrip = checkpoint.clone();
                assert_eq!(clone.step(), roundtrip.step());
                assert_eq!(clone.state_hash(), roundtrip.state_hash());
                restored = Some(Env::from_external_checkpoint(checkpoint, 300).unwrap().0);
            }
        }
        assert!(saw_mark, "real source-capable Mark must run: {mode:?}");
        assert!(saw_frost, "real Frost must run: {mode:?}");
        assert!(restored.is_some());
    }
}
