//! P-TICK-5: the director paces each room at its sim's configured step, announces it, and the room's snapshots are
//! written at it (ADR 0029). At 50 ms everything stays as it was.

use super::*;
use rh_protocol::{ServerMsg, SnapshotTracker};
use std::sync::atomic::Ordering;

/// [`director_with`]'s configuration at `tick_ms`.
fn director_config_at(tick_ms: u32) -> DirectorConfig {
    let sim = SimConfig {
        walk_hints: None,
        hitboxes: Default::default(),
        mob_spacing: Default::default(),
        regen_in_combat: rh_sim::RegenInCombat::Legacy,
        camp_buffs: rh_sim::CampBuffRule::Legacy,
        frost_wish: rh_sim::FrostWish::Freeze,
        augments: rh_sim::AugmentRule::Legacy,
        elites: rh_sim::EliteRule::Legacy,
        regen: false,
        training: false,
        dummies: false,
        consumables: true,
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        hazards: rh_sim::terrain::Mode::Off,
        lifecycle: rh_sim::ArenaMode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: 30.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
        quests: false,
        tick_ms,
    };
    let map = rh_sim::TileMap::from_rows(&["####", "#..#", "#..#", "####"]).unwrap();
    let arena = Arena {
        map,
        spawns: vec![rh_sim::Vec2::new(48.0, 48.0)],
    };
    DirectorConfig::new(sim, arena)
}

/// Feeds every frame the connection has to `tracker`; returns the Full snapshot frames among them.
fn read_frames(out: &Outbox, tracker: &mut SnapshotTracker) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    assert_eq!(out.drain_into(&mut frames).close, None);
    let mut full = Vec::new();
    for frame in frames {
        match tracker.decode(&frame) {
            Ok(ServerMsg::Snapshot { .. }) => {
                if matches!(ServerMsg::decode(&frame), Ok(ServerMsg::Snapshot { .. })) {
                    full.push(frame);
                }
            }
            Ok(_) => {}
            Err(e) => panic!("the connection's frames read at its Welcome's rate: {e:?}"),
        }
    }
    full
}

/// The snapshot time of `frame` read at `rate`.
fn time_at(frame: &[u8], rate: u8) -> (u32, f64) {
    match ServerMsg::decode_at(frame, rate) {
        Ok(ServerMsg::Snapshot {
            tick, server_time, ..
        }) => (tick, server_time),
        other => panic!("a Full snapshot read at {rate} Hz: {other:?}"),
    }
}

fn clock_ms(ok: &JoinOk) -> f64 {
    f64::from_bits(ok.clock.load(Ordering::Relaxed))
}

/// On a paused tokio clock a room the director opens for a sim at 25 ms steps 40 times per second, its clock advances
/// 1000 ms per second, its Welcome says 40 Hz and its snapshots carry no time override (`decode_at(.., 40)` gives
/// `tick * 25`). The same director at 50 ms keeps 20 steps per second, 20 Hz and `tick * 50`.
#[tokio::test(start_paused = true)]
async fn a_director_room_runs_and_announces_its_configured_step() {
    for (tick_ms, rate, other_rate, other_ms) in [(50u32, 20u8, 40u8, 25.0), (25, 40, 20, 50.0)] {
        let cfg = director_config_at(tick_ms);
        assert!(
            crate::wire::profile_supported(&cfg.sim).is_ok(),
            "a {tick_ms} ms sim is hosted"
        );
        assert_eq!(
            cfg.tick,
            Duration::from_millis(tick_ms as u64),
            "the director paces a {tick_ms} ms sim at its step"
        );
        let d = Director::new(
            cfg,
            Arc::new(Persistence::Memory(Box::default())),
            Arc::new(Auth::Dev),
            Arc::new(Lifecycle::default()),
        );
        let out = Arc::new(Outbox::default());
        let (_room, ok) = d
            .admit(hello("Pacer"), out.clone(), 1)
            .await
            .expect("admitted into a lobby");
        let ServerMsg::Welcome { tick_rate, .. } = ServerMsg::decode(&ok.welcome).unwrap() else {
            panic!("the admission carries a Welcome")
        };
        assert_eq!(tick_rate, rate, "the Welcome of a {tick_ms} ms room");
        let mut tracker = SnapshotTracker::awaiting_welcome();
        tracker.decode(&ok.welcome).unwrap();

        // Half a step off the grid, so no read races a step.
        tokio::time::sleep(Duration::from_millis(1000 + tick_ms as u64 / 2)).await;
        let full = read_frames(&out, &mut tracker);
        let first = full
            .first()
            .expect("the first snapshot after a Welcome is Full");
        let (tick, own) = time_at(first, rate);
        assert_eq!(
            own,
            tick as f64 * tick_ms as f64,
            "read at {rate} Hz a {tick_ms} ms snapshot is tick * {tick_ms}"
        );
        assert_eq!(
            time_at(first, other_rate),
            (tick, tick as f64 * other_ms),
            "no time override: read at {other_rate} Hz it is tick * {other_ms}"
        );
        let tick1 = tracker.held_tick().expect("a snapshot is held");
        let clock1 = clock_ms(&ok);

        tokio::time::sleep(Duration::from_secs(1)).await;
        read_frames(&out, &mut tracker);
        let tick2 = tracker.held_tick().expect("a snapshot is held");
        let clock2 = clock_ms(&ok);
        assert_eq!(
            tick2 - tick1,
            1000 / tick_ms,
            "a {tick_ms} ms room steps {} times per second",
            1000 / tick_ms
        );
        assert_eq!(
            clock2 - clock1,
            1000.0,
            "the room's sim time keeps wall time"
        );
        let Some(ServerMsg::Snapshot { server_time, .. }) = tracker.snapshot() else {
            panic!("a snapshot is held")
        };
        assert_eq!(server_time, tick2 as f64 * tick_ms as f64);
    }
}
