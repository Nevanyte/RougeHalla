//! Ordinary observed axe intake/replay plus explicitly trusted status pre-state in the same Env/Sim schedule.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{
    replay::run_replay,
    status_runtime::{probe::*, *},
    ContainerKind, FactionId, PlayerId, PublicCommand, Sim, SimConfig, Vec2, WeaponId,
};
fn env() -> Env {
    let mut arena = rh_sim::arenas::practice_arena();
    arena.spawns = vec![
        Vec2::new(400., 320.),
        Vec2::new(456., 320.),
        Vec2::new(1300., 600.),
    ];
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: 200,
            record: true,
        },
        (0..3)
            .map(|i| AgentSpec {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                bot: false,
                agent: Agent::External,
            })
            .collect(),
        9,
    );
    env.seed_weapon_container(
        ContainerKind::Ground,
        Vec2::new(400., 320.),
        &[WeaponId::Axe],
    )
    .unwrap();
    env
}
#[test]
fn observed_axe_status_replays_and_restores_with_full_sparse_and_absent_sampling() {
    let (mut full, mut sparse) = (env(), env());
    let first = full.observations();
    let second = sparse.observations();
    assert_eq!(first, second);
    let handle = first[0]
        .props
        .iter()
        .find(|p| p.cue.focused)
        .unwrap()
        .handle;
    let (mut saw, mut expired, mut restored) = (false, false, None::<Sim>);
    for n in 0..140 {
        let cmds = match n {
            0 => vec![vec![PublicCommand::Pickup { handle }]],
            15 => vec![vec![PublicCommand::Attack { a: 0., t: None }]],
            18 => vec![vec![PublicCommand::Release { a: 0., t: None }]],
            _ => vec![],
        };
        let out = full.step(&cmds);
        sparse.advance(&cmds);
        assert_eq!(full.sim.state_hash(), sparse.sim.state_hash());
        if n % 13 == 0 {
            let seen = sparse.observations();
            for (a, b) in out.observations.iter().zip(seen) {
                assert_eq!(a.me, b.me);
                assert_eq!(a.visible, b.visible);
                assert_eq!(a.fields, b.fields);
            }
        }
        let active = has(
            &full.sim.player(PlayerId(2)).unwrap().statuses.instances,
            StatusKind::Shred,
            full.sim.server_time(),
        );
        saw |= active;
        expired |= saw && !active;
        if let Some(copy) = &mut restored {
            assert_eq!(copy.step(), out.events);
            assert_eq!(copy.state_hash(), full.sim.state_hash());
        }
        if n == 20 {
            assert!(
                active,
                "ordinary axe hit must create the actual generic stack"
            );
            restored = Some(Sim::restore(serde_json::to_value(&full.sim).unwrap()).unwrap());
        }
    }
    assert!(saw && expired);
    let hash = full.sim.state_hash();
    let replay = full.into_replay().unwrap();
    assert_eq!(replay, sparse.into_replay().unwrap());
    assert_eq!(run_replay(&replay).unwrap().0.state_hash(), hash);
}
#[test]
fn trusted_all_kind_and_field_checkpoint_runs_identical_headless_phases_and_projection() {
    let original = env();
    let mut h = Harness::new(original.sim);
    let now = h.sim().server_time();
    let source = StatusSource {
        id: Some(PlayerId(1)),
        name: "p0".into(),
        owner_id: None,
    };
    for kind in STATUS_KINDS {
        h.execute(Operation::Apply {
            id: PlayerId(2),
            apply: StatusApply {
                kind,
                source: source.clone(),
                ms: 250.,
                ability: None,
                tag: None,
                value: Some(if kind == StatusKind::Dot { 5. } else { 0.2 }),
                add: None,
                data: None,
            },
            quiet: true,
        })
        .unwrap();
    }
    h.execute(Operation::AddField(Field {
        id: 0,
        kind: FieldKind::Trail,
        ability: AbilityId::Blaze,
        owner: source,
        subject: None,
        x: 440.,
        y: 320.,
        x2: 500.,
        y2: 320.,
        r: 20.,
        vx: 0.,
        vy: 0.,
        started_at: now,
        ends_at: now + 1000.,
        exit_stun_ms: None,
    }))
    .unwrap();
    let checkpoint = serde_json::to_value(h.sim()).unwrap();
    let mut direct = Sim::restore(checkpoint.clone()).unwrap();
    let (mut full, initial) =
        Env::from_external_checkpoint(Sim::restore(checkpoint).unwrap(), 100).unwrap();
    assert_eq!(initial[0].fields.len(), 1);
    assert!(
        initial[0].visible.iter().all(|p| p.id != PlayerId(2)),
        "hidden status is enforced before observation"
    );
    for n in 0..65 {
        let out = full.step(&[]);
        assert_eq!(out.events, direct.step());
        assert_eq!(full.sim.state_hash(), direct.state_hash());
        if [1, 3, 17, 19].contains(&n) {
            let restored = Sim::restore(serde_json::to_value(&full.sim).unwrap()).unwrap();
            let (mut reconnect, views) = Env::from_external_checkpoint(restored, 100).unwrap();
            for (a, b) in out.observations.iter().zip(&views) {
                assert_eq!(a.me, b.me);
                assert_eq!(a.visible, b.visible);
                assert_eq!(a.fields, b.fields);
            }
            let repeated = reconnect.observations();
            for (a, b) in views.iter().zip(repeated) {
                assert_eq!(a.fields, b.fields);
            }
        }
    }
    assert!(full
        .sim
        .players()
        .iter()
        .all(|p| p.statuses.instances.is_empty()));
    assert!(full.observations().iter().all(|v| v.fields.is_empty()));
}
