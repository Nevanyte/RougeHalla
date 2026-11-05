//! Real-source temporal counterexample, checkpoint continuation and observation-only schedules.
use rh_sim::{
    observe, validate, Arena, Event, FactionId, FactionMode, FxProjector, Placement, PlayerId,
    RawCommand, Secrets, SeenEvent, Sim, SimConfig, TileMap, Vec2,
};
#[path = "support/plague_proofs.rs"]
mod proof_schema;
fn scene(hp: f64) -> Sim {
    let ps = [
        (FactionId::Holy, 1040., None),
        (FactionId::Holy, 2000., Some(hp)),
        (FactionId::Plague, 2056., None),
    ]
    .into_iter()
    .enumerate()
    .map(|(i, (faction, x, hp))| Placement {
        profile: format!("p{i}"),
        faction,
        bot: false,
        at: Vec2::new(x, 768.),
        hp,
        weapon0: None,
        weapon1: None,
    })
    .collect::<Vec<_>>();
    Sim::reset_active(
        SimConfig {
            faction_mode: FactionMode::EngagementHolyPlague,
            ..Default::default()
        },
        Arena {
            map: TileMap::from_rows(
                &vec![".".repeat(118); 52]
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
            )
            .unwrap(),
            spawns: vec![Vec2::new(320., 320.); 3],
        },
        Secrets::from_seed(12),
        &ps,
    )
}
fn drive(s: &mut Sim, t: u32, attack: u32) {
    let raw = if t == 2 {
        Some((
            PlayerId(1),
            RawCommand::Move {
                x: 1125.,
                y: 768.,
                seq: None,
            },
        ))
    } else if t == attack {
        Some((
            PlayerId(3),
            RawCommand::Attack {
                a: std::f64::consts::PI,
                t: None,
            },
        ))
    } else if t == attack + 1 {
        Some((
            PlayerId(3),
            RawCommand::Release {
                a: std::f64::consts::PI,
                t: None,
            },
        ))
    } else {
        None
    };
    if let Some((id, r)) = raw {
        s.submit(id, validate(r).unwrap()).unwrap();
    }
}
#[test]
fn actual_source_hidden_history_has_equal_public_projection() {
    let source: serde_json::Value =
        serde_json::from_str(include_str!("../../../parity/plague/hidden-history.json")).unwrap();
    proof_schema::hidden(&source).unwrap();
    let mut a = scene(1004.048988764045);
    let mut b = scene(1000.);
    let mut fa = FxProjector::attach(&a, PlayerId(1));
    let mut fb = FxProjector::attach(&b, PlayerId(1));
    let mut chunks = [0., 0.];
    for t in 2..=11 {
        drive(&mut a, t, 3);
        drive(&mut b, t, 6);
        let ea = a.step();
        let eb = b.step();
        fa.feed(a.fx_report()).unwrap();
        fb.feed(b.fx_report()).unwrap();
        for (i, (s, e, k)) in [(&a, &ea, "a"), (&b, &eb, "b")].into_iter().enumerate() {
            let row = &source[k]["rows"][(t - 2) as usize];
            assert_eq!(s.players()[0].body.x, row["x"].as_f64().unwrap());
            assert_eq!(s.players()[1].vitals.hp, row["hp"].as_f64().unwrap());
            assert_eq!(
                s.players()[1].signature.bits,
                row["sig"].as_u64().unwrap() as u8
            );
            let o = observe(s, PlayerId(1), e);
            assert_eq!(o.visible.iter().any(|p| p.id == PlayerId(2)), t >= 9);
            assert!(!o.visible.iter().any(|p| p.id == PlayerId(3)));
            assert!(
                !o.events
                    .iter()
                    .any(|e| matches!(e, SeenEvent::SignatureHit { .. })),
                "stateless previews cannot reconstruct historical chunks"
            );
            for e in e {
                if let Event::SignatureHit { amount, .. } = e {
                    chunks[i] += amount;
                }
            }
        }
        assert_eq!(fa.events(), fb.events(), "tick {t}");
        if t >= 9 {
            assert_eq!(a.players()[1].vitals.hp, b.players()[1].vitals.hp);
        }
    }
    assert_eq!(chunks, [12.146966292134834, 8.097977528089888]);
    assert!(
        matches!(fa.events(),[SeenEvent::SignatureHit{by:None,weapon:None,amount,..}] if *amount==4.048988764044944)
    );
}
#[test]
fn private_window_restores_exactly_but_public_history_does_not() {
    let mut a = scene(1000.);
    for t in 2..=7 {
        drive(&mut a, t, 3);
        a.step();
    }
    assert!(!a.faction_runtime().dot.is_empty());
    let checkpoint = serde_json::to_value(&a).unwrap();
    let mut b = Sim::restore(checkpoint.clone()).unwrap();
    assert_eq!(a.state_hash(), b.state_hash());
    let mut f = FxProjector::attach(&b, PlayerId(1));
    for _ in 0..40 {
        let e = a.step();
        let z = b.step();
        assert_eq!(e, z);
        assert_eq!(a.state_hash(), b.state_hash());
        f.feed(b.fx_report()).unwrap();
        let _ = observe(&b, PlayerId(1), &z);
    }
    for (pointer, value) in [
        ("/world/factions/dot_since", serde_json::json!(-1)),
        ("/world/factions/dot/0/amount", serde_json::json!(-1)),
        ("/world/factions/dot/0/by", serde_json::json!(999)),
        (
            "/world/players/0/core/signature/bits",
            serde_json::json!(16),
        ),
        (
            "/world/players/0/core/signature/dot_paused_until",
            serde_json::json!(1e12),
        ),
        ("/statics/config/faction_mode", serde_json::json!("Off")),
    ] {
        let mut cp = checkpoint.clone();
        *cp.pointer_mut(pointer).unwrap() = value;
        assert!(Sim::restore(cp).is_err(), "accepted {pointer}");
    }
}

#[test]
fn dead_viewer_receives_earned_chunk_but_fresh_session_has_no_past_entitlement() {
    let mut sim = scene(1.);
    let mut earned = FxProjector::attach(&sim, PlayerId(2));
    let mut fresh = None;
    for t in 2..=11 {
        drive(&mut sim, t, 3);
        sim.step();
        earned.feed(sim.fx_report()).unwrap();
        if t == 4 {
            assert!(!sim.players()[1].standing());
            fresh = Some(FxProjector::attach(&sim, PlayerId(2)));
        } else if let Some(p) = &mut fresh {
            p.feed(sim.fx_report()).unwrap();
        }
    }
    assert!(earned.events().iter().any(|e| matches!(
        e,
        SeenEvent::SignatureHit {
            victim: PlayerId(2),
            ..
        }
    )));
    assert!(!fresh
        .unwrap()
        .events()
        .iter()
        .any(|e| matches!(e, SeenEvent::SignatureHit { .. })));
}
