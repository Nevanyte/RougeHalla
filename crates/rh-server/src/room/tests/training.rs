//! Training rooms: configuration, idle close, input-age telemetry and no banked results.

use super::*;

fn training_cfg(tick: Duration) -> RoomConfig {
    let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
    RoomConfig {
        sim: SimConfig {
            walk_hints: None,
            hitboxes: Default::default(),
            mob_spacing: Default::default(),
            regen_in_combat: rh_sim::RegenInCombat::Legacy,
            camp_buffs: rh_sim::CampBuffRule::Legacy,
            frost_wish: rh_sim::FrostWish::Freeze,
            augments: rh_sim::AugmentRule::Legacy,
            elites: rh_sim::EliteRule::Legacy,
            regen: false,
            quests: false,
            consumables: true,
            training: true,
            dummies: true,
            abilities: rh_sim::abilities::Mode::Off,
            wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
            hazards: rh_sim::terrain::Mode::Off,
            lifecycle: rh_sim::ArenaMode::Off,
            mob_mode: rh_sim::mob_runtime::MobMode::Off,
            initial_loot: false,
            min_players: 1,
            lobby_seconds: 0.0,
            fill_seconds: 0.0,
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: rh_sim::FactionMode::Off,
            tick_ms: 50,
        },
        arena: assets.arena,
        welcome_map: assets.welcome_map,
        // Deliberately nonzero: a training room must never fill bots even if a hosting config asks for them.
        fill_bots_to: 4,
        tick,
        // Deliberately true: a training room must never record a replay (no banking/telemetry of a run).
        record: true,
        fixed_secrets: Some(Secrets::from_seed(7)),
        fixed_bot_seed: Some(7),
        reconnect_grace: RECONNECT_GRACE,
        linger: LINGER,
    }
}

fn training_room(start: Instant, reports: mpsc::UnboundedSender<RoomReport>) -> Room {
    Room::new(
        [9; 16],
        training_cfg(Duration::from_millis(50)),
        reports,
        start,
    )
}

#[tokio::test(start_paused = true)]
async fn a_training_room_starts_active_with_one_human_and_a_training_stream() {
    let start = Instant::now();
    let (reports, _rx) = mpsc::unbounded_channel();
    let mut room = training_room(start, reports);
    assert!(
        room.recorder.is_none(),
        "a training room never records a replay"
    );
    assert_eq!(room.fill_to, 0, "no bots fill a practice room");
    let out = Arc::new(Outbox::default());
    let joined = room
        .join(
            "practice".into(),
            Some(FactionId::Holy),
            out.clone(),
            1,
            1,
            None,
        )
        .expect("the one seat");
    assert!(
        matches!(
            room.join(
                "second".into(),
                None,
                Arc::new(Outbox::default()),
                2,
                2,
                None
            ),
            Err(RejectCode::MatchFull)
        ),
        "a training room seats exactly one human"
    );
    assert!(room.wake(start + Duration::from_millis(50)));
    assert_eq!(room.sim().phase(), Phase::Active);
    assert_eq!(
        room.sim().mobs().len(),
        2,
        "the practice setup's plain and shield dummy"
    );
    let frames = decoded(&out);
    assert!(
        frames
            .iter()
            .any(|m| matches!(m, rh_protocol::ServerMsg::Snapshot { training: true, .. })),
        "the live stream carries the training bit: {frames:?}"
    );
    let _ = joined.player;
}

#[tokio::test(start_paused = true)]
async fn a_training_room_closes_on_idle_and_banks_nothing() {
    let start = Instant::now();
    let tick = Duration::from_millis(50);
    let (reports, mut rx) = mpsc::unbounded_channel();
    let mut room = training_room(start, reports);
    room.training_idle = Duration::from_millis(300);
    let out = Arc::new(Outbox::default());
    room.join(
        "practice".into(),
        Some(FactionId::Holy),
        out.clone(),
        1,
        1,
        None,
    )
    .expect("one seat");
    assert!(
        room.wake(start + tick),
        "the lobby closes into the practice run"
    );
    assert!(
        room.wake(start + Duration::from_millis(250)),
        "inside the idle limit"
    );
    assert!(
        !room.wake(start + Duration::from_millis(400)),
        "the training idle limit closes the room"
    );
    let (mut closed, mut saw_result) = (None, false);
    while let Ok(r) = rx.try_recv() {
        match r {
            RoomReport::Closed { replay, .. } => closed = Some(replay),
            RoomReport::Result { .. } => saw_result = true,
            _ => {}
        }
    }
    assert!(!saw_result, "a training room never reports a result");
    let closed = closed.expect("the room reported Closed");
    assert!(
        closed.is_none(),
        "no replay is recorded for a training room"
    );
}

#[tokio::test(start_paused = true)]
async fn a_training_room_idle_clock_counts_accepted_inputs_only() {
    let start = Instant::now();
    let tick = Duration::from_millis(50);
    let (reports, _rx) = mpsc::unbounded_channel();
    let mut room = training_room(start, reports);
    room.training_idle = Duration::from_millis(300);
    let out = Arc::new(Outbox::default());
    let joined = room
        .join(
            "practice".into(),
            Some(FactionId::Holy),
            out.clone(),
            1,
            1,
            None,
        )
        .expect("one seat");
    assert!(room.wake(start + tick));
    room.handle(
        RoomCmd::Input {
            received: std::time::Instant::now(),
            player: joined.player,
            conn: 1,
            seq: 1,
            commands: vec![rh_protocol::WireCommand::Aim { a: 0.0 }],
        },
        start + Duration::from_millis(100),
    );
    assert!(
        room.wake(start + Duration::from_millis(350)),
        "an accepted input resets the idle clock"
    );
    assert!(
        !room.wake(start + Duration::from_millis(500)),
        "the room closes 300 ms after the last accepted input"
    );
}

/// Latency-budget telemetry: the age of an Input at the step that applies it, the rewind clamps by edge, and the step
/// start stamped on the tick batch the writer drains.
#[tokio::test(start_paused = true)]
async fn input_age_clamps_and_the_step_stamp_reach_the_metrics() {
    let start = Instant::now();
    let tick = Duration::from_millis(50);
    let (reports, _rx) = mpsc::unbounded_channel();
    let metrics: &'static Metrics = Box::leak(Box::new(Metrics::new()));
    let mut room = training_room(start, reports).with_metrics(metrics);
    let out = Arc::new(Outbox::default());
    let joined = room
        .join(
            "practice".into(),
            Some(FactionId::Holy),
            out.clone(),
            1,
            1,
            None,
        )
        .expect("one seat");
    assert!(room.wake(start + tick));
    let mut batch = Vec::new();
    let d = out.drain_into(&mut batch);
    assert!(
        d.step_started.is_some(),
        "a tick batch carries its step start"
    );
    assert_eq!(metrics.input_age_us.count(), 0, "no input yet");
    let received = std::time::Instant::now() - Duration::from_millis(30);
    room.handle(
        RoomCmd::Input {
            received,
            player: joined.player,
            conn: 1,
            seq: 1,
            commands: vec![
                rh_protocol::WireCommand::Aim { a: 0.0 },
                rh_protocol::WireCommand::Attack {
                    a: 0.0,
                    t: Some(1.0e9),
                },
            ],
        },
        start + tick,
    );
    assert!(room.wake(start + tick * 2));
    assert_eq!(
        metrics.input_age_us.count(),
        1,
        "one value per seat per step"
    );
    assert!(metrics.input_age_us.max() >= 30_000);
    assert_eq!(metrics.rewind_clamps_future.load(Ordering::Relaxed), 1);
    assert_eq!(metrics.rewind_clamps_old.load(Ordering::Relaxed), 0);
    assert_eq!(metrics.rewind_clamp_excess[3].load(Ordering::Relaxed), 1);
    assert!(room.wake(start + tick * 3));
    assert_eq!(metrics.input_age_us.count(), 1, "an input is aged once");
}

#[tokio::test(start_paused = true)]
async fn a_training_room_leave_never_banks_a_mia_result() {
    let start = Instant::now();
    let tick = Duration::from_millis(50);
    let (reports, mut rx) = mpsc::unbounded_channel();
    let mut room = training_room(start, reports);
    let out = Arc::new(Outbox::default());
    let joined = room
        .join(
            "practice".into(),
            Some(FactionId::Holy),
            out.clone(),
            1,
            1,
            None,
        )
        .expect("one seat");
    assert!(room.wake(start + tick));
    // Leaving during the practice run resolves the sim's MIA result between ticks; the room must drop it entirely.
    room.handle(
        RoomCmd::Leave {
            player: joined.player,
            conn: 1,
        },
        start + tick,
    );
    assert!(!room.wake(start + 3 * tick), "the only human left");
    let mut saw_result = false;
    let mut closed = None;
    while let Ok(r) = rx.try_recv() {
        match r {
            RoomReport::Result { .. } => saw_result = true,
            RoomReport::Closed { replay, .. } => closed = Some(replay),
            _ => {}
        }
    }
    assert!(
        !saw_result,
        "a leaving practice player is not a banked result"
    );
    assert!(closed.is_some());
}
