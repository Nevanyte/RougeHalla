//! P-PERCEPTION-WITNESS-1 native controls: current native/wire behavior and privacy, unchanged by the source
//! witnesses captured in tools/percept-witness-fixtures/ (legacy TypeScript output is the oracle there; this file
//! records what the current Rust observation/wire actually carries, and where it is absent or deliberately narrower).
//!
//! Evidence only: no production change. The pre-existing C-OBS controls (crates/rh-sim/tests/observe.rs) and the human
//! publish controls (crates/rh-server/tests/publish.rs) remain the existing privacy suite and are run unchanged; these
//! tests add only the P-PERCEPTION-WITNESS-1 facts: Windup emission -> observation/human-wire absence, the delivered
//! Swing/Hit controls, paired-world privacy on fresh plain publication, one-world fresh prepared-frame actor-id
//! absence (without committing the offer), and run-summary absence in Observation17.

use rh_protocol::{ServerMsg, WireFx};
use rh_server::wire::Publisher;
use rh_sim::arenas::practice_arena;
use rh_sim::events::Visibility;
use rh_sim::observe::{observe, observe_events_into, SeenEvent};
use rh_sim::{
    validate, Command, Event, FactionId, ItemObserver, Placement, PlayerId, RawCommand, Secrets,
    Sim, SimConfig, Vec2,
};

fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}

fn place(profile: &str, faction: FactionId, x: f64, y: f64) -> Placement {
    Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at: Vec2::new(x, y),
        hp: None,
        weapon0: None,
        weapon1: None,
    }
}

fn arena_with(map: rh_sim::TileMap, spawn: Vec2) -> rh_sim::Arena {
    rh_sim::Arena {
        map,
        spawns: vec![spawn],
    }
}

/// Three fighters in plain view of each other in open ground: attacker 1, target 2, observer 3.
fn brawl() -> Sim {
    let ps = [
        place("attacker", FactionId::Fire, 400.0, 400.0),
        place("target", FactionId::Holy, 450.0, 400.0),
        place("observer", FactionId::Frost, 400.0, 440.0),
    ];
    Sim::reset_active(
        SimConfig::default(),
        arena_with(practice_arena().map, ps[0].at),
        Secrets::from_seed(11),
        &ps,
    )
}

/// The observe.rs hidden scene: the practice arena pillar at tile column 6 hides player 2 (east) from the viewer
/// (west); player 3 stands in plain view to the south.
fn hidden_scene(hidden_x: f64, salt: u32) -> Sim {
    let ps = [
        place("viewer", FactionId::Holy, 100.0, 176.0),
        place("hidden", FactionId::Fire, hidden_x, 176.0),
        place("plain", FactionId::Frost, 100.0, 600.0),
    ];
    Sim::reset_active(
        SimConfig {
            faction_mode: rh_sim::FactionMode::Off,
            ..Default::default()
        },
        arena_with(practice_arena().map, ps[0].at),
        Secrets {
            order_salt: salt,
            spawn_seed: 1,
            reward_salt: [0x12345678, 0x9abcdef0, 0x31415926, 0x27182818],
        },
        &ps,
    )
}

struct Decoded {
    important: Option<ServerMsg>,
    fx: Option<ServerMsg>,
    snapshot: Vec<u8>,
}

fn decode_frames(frames: rh_server::wire::ViewFrames) -> Decoded {
    let important = frames
        .important
        .as_ref()
        .map(|b| ServerMsg::decode(b).expect("the reliable frame decodes"));
    let fx = frames
        .fx
        .as_ref()
        .map(|b| ServerMsg::decode(b).expect("the fx frame decodes"));
    let mut snapshot = Vec::new();
    frames
        .snapshot
        .as_ref()
        .expect("the observation encodes")
        .encode_full_into(&mut snapshot);
    Decoded {
        important,
        fx,
        snapshot,
    }
}

/// Project one wake for a plain viewer through a fresh Publisher.
fn published(sim: &Sim, viewer: PlayerId, events: &[Event]) -> Decoded {
    let mut publisher = Publisher::default();
    let mut earlier = Vec::new();
    decode_frames(publisher.frames(sim, viewer, 0, events, &mut earlier, events))
}

/// Project one wake through a fresh Publisher and the supplied fresh ItemObserver. The offer is deliberately dropped:
/// this checks decoded snapshot actor-id absence only, not committed bindings, retained carry or paired-world equality.
fn fresh_prepared_projection_without_commit(
    sim: &Sim,
    observer: &mut ItemObserver,
    events: &[Event],
) -> Decoded {
    let mut publisher = Publisher::default();
    let mut earlier = Vec::new();
    let (frames, _offer) = publisher
        .frames_prepared(observer, None, sim, 0, events, &mut earlier, events)
        .expect("supported profile prepares frames; the offer is not committed");
    decode_frames(frames)
}

fn fx_list(msg: &Option<ServerMsg>) -> &[WireFx] {
    match msg {
        Some(ServerMsg::Fx { fx, .. }) => fx,
        _ => &[],
    }
}

fn snapshot_actor_ids(snapshot: &[u8]) -> Vec<u32> {
    match ServerMsg::decode(snapshot).expect("the snapshot frame decodes") {
        ServerMsg::Snapshot { actors, .. } => actors.iter().map(|a| a.id).collect(),
        other => panic!("a Full snapshot frame must decode as Snapshot: {other:?}"),
    }
}

/// The real Rust producer emits Event::Windup when a melee press starts a windup, and current native behavior carries
/// it nowhere: declared visibility ServerOnly, no SeenEvent, and no human protocol-11 fx variant can name it.
#[test]
fn the_real_producer_emits_windup_and_current_native_carries_it_nowhere() {
    let mut sim = brawl();
    sim.submit(PlayerId(1), cmd(RawCommand::Attack { a: 0.0, t: None }))
        .expect("the press is accepted");
    let mut windups = Vec::new();
    for _ in 0..10 {
        let events = sim.step();
        windups.extend(
            events
                .iter()
                .filter(|e| matches!(e, Event::Windup { .. }))
                .cloned(),
        );
        if !windups.is_empty() {
            break;
        }
    }
    assert!(
        !windups.is_empty(),
        "the actual sim weapons system emits a Windup for a fists press"
    );
    for event in &windups {
        assert_eq!(
            event.visibility(),
            Visibility::ServerOnly,
            "a Windup is declared server-only"
        );
    }
    let mut seen = Vec::new();
    observe_events_into(&sim, PlayerId(1), &windups, &mut seen);
    assert!(
        seen.is_empty(),
        "ServerOnly: the observation event filter drops every Windup"
    );
    let decoded = published(&sim, PlayerId(1), &windups);
    assert!(
        decoded.important.is_none(),
        "a windup alone produces no reliable frame"
    );
    assert!(
        decoded.fx.is_none(),
        "windup-only input produces no human FX frame"
    );
}

/// The already-delivered controls: a real melee fight's Swing and Hit reach the observing human's observation and
/// human frames; the windup that produced them appears nowhere.
#[test]
fn delivered_swing_and_hit_reach_the_human_wire_without_the_windup() {
    let mut sim = brawl();
    let observer = PlayerId(3);
    let (mut saw_swing, mut saw_hit) = (false, false);
    let (mut wire_swing, mut wire_hit) = (false, false);
    for _ in 0..80 {
        let _ = sim.submit(PlayerId(1), cmd(RawCommand::Attack { a: 0.0, t: None }));
        let events = sim.step();
        let observed = observe(&sim, observer, &events);
        saw_swing |= observed
            .events
            .iter()
            .any(|e| matches!(e, SeenEvent::Swing { by, .. } if *by == PlayerId(1)));
        saw_hit |= observed
            .events
            .iter()
            .any(|e| matches!(e, SeenEvent::Hit { by, .. } if *by == Some(PlayerId(1))));
        let decoded = published(&sim, observer, &events);
        for effect in fx_list(&decoded.fx) {
            wire_swing |= matches!(effect, WireFx::Swing { by, .. } if *by == PlayerId(1).0);
            wire_hit |= matches!(effect, WireFx::Hit { by, .. } if *by == PlayerId(1).0);
        }
        if saw_swing && saw_hit && wire_swing && wire_hit {
            break;
        }
    }
    assert!(saw_swing, "the observer sees the delivered Swing event");
    assert!(saw_hit, "the observer sees the delivered Hit event");
    assert!(wire_swing, "protocol 11 delivers Swing as an fx");
    assert!(wire_hit, "protocol 11 delivers Hit as an fx");
}

/// Hidden identity/coordinate privacy on the current human frames: two otherwise-identical worlds where only the
/// hidden player acts differently produce equal observations, equal decoded reliable/fx messages, and equal Full
/// snapshot bytes through fresh plain Publishers. A separate one-world fresh ItemObserver/Publisher projection checks
/// hidden raw-id absence only; it does not exercise committed offers, persistent carry or paired prepared equality.
#[test]
fn a_hidden_player_identity_or_position_never_leaks_into_the_human_frames() {
    let viewer = PlayerId(1);
    let mut a = hidden_scene(300.0, 1);
    let mut b = hidden_scene(330.0, 1);
    for tick in 0..20 {
        for (sim, mv) in [(&mut a, 340.0), (&mut b, 360.0)] {
            let _ = sim.submit(
                PlayerId(2),
                cmd(RawCommand::Move {
                    x: mv,
                    y: 176.0,
                    seq: Some(9),
                }),
            );
            let _ = sim.submit(
                PlayerId(3),
                cmd(RawCommand::Move {
                    x: 160.0,
                    y: 600.0,
                    seq: None,
                }),
            );
        }
        let ea = a.step();
        let eb = b.step();
        let oa = observe(&a, viewer, &ea);
        let ob = observe(&b, viewer, &eb);
        assert_eq!(oa, ob, "tick {tick}: hidden state changes nothing shown");
        assert!(
            oa.visible.iter().all(|v| v.id != PlayerId(2)),
            "tick {tick}: the pillar hides player 2"
        );
        assert!(
            oa.visible.iter().any(|v| v.id == PlayerId(3)),
            "tick {tick}: the plain player is a positive control"
        );
        let da = published(&a, viewer, &ea);
        let db = published(&b, viewer, &eb);
        assert_eq!(
            da.important, db.important,
            "tick {tick}: reliable frames equal"
        );
        assert_eq!(da.fx, db.fx, "tick {tick}: fx frames equal");
        assert_eq!(
            da.snapshot, db.snapshot,
            "tick {tick}: Full snapshot bytes equal"
        );
        let ids = snapshot_actor_ids(&da.snapshot);
        assert!(
            !ids.contains(&PlayerId(2).0),
            "tick {tick}: hidden raw id absent from snapshot actors"
        );
        assert!(
            ids.contains(&PlayerId(3).0),
            "tick {tick}: the plain actor is a positive control"
        );
        let mut observer = ItemObserver::new(viewer);
        let projected = fresh_prepared_projection_without_commit(&a, &mut observer, &ea);
        let projected_ids = snapshot_actor_ids(&projected.snapshot);
        assert!(
            !projected_ids.contains(&PlayerId(2).0),
            "tick {tick}: the fresh uncommitted ItemObserver projection has no hidden raw id"
        );
    }
}

/// Observation17 carries no legacy run-summary aggregates: no alive count, player count, minimum-players threshold
/// or winner display name (the review's absent/narrower rows). started_with is present, carried by ArenaView.
#[test]
fn observation_has_no_legacy_run_summary_aggregates_but_keeps_started_with() {
    let mut sim = brawl();
    sim.step();
    let events: Vec<Event> = Vec::new();
    let observed = observe(&sim, PlayerId(1), &events);
    let json = serde_json::to_value(&observed).expect("Observation is serializable");
    fn has_key(value: &serde_json::Value, key: &str) -> bool {
        match value {
            serde_json::Value::Object(map) => {
                map.contains_key(key) || map.values().any(|v| has_key(v, key))
            }
            serde_json::Value::Array(items) => items.iter().any(|v| has_key(v, key)),
            _ => false,
        }
    }
    for absent in [
        "alive",
        "playerCount",
        "player_count",
        "minPlayers",
        "min_players",
        "winner",
    ] {
        assert!(
            !has_key(&json, absent),
            "Observation17 must not carry the legacy run-summary field {absent}"
        );
    }
    // ArenaView (present only under a lifecycle profile) is where the fixed run denominator lives; assert its
    // public serialized shape directly rather than forcing a full Source-lifecycle sim config into this test.
    let arena = rh_sim::ArenaView {
        lobby_ends_at: 0.0,
        plan_ends_at: 0.0,
        raid_started_at: 1.0,
        patience_ends_at: None,
        in_coliseum: false,
        gates_locked: false,
        sudden_death_at: 0.0,
        started_with: 3,
    };
    let arena_json = serde_json::to_value(arena).expect("ArenaView is serializable");
    assert_eq!(
        arena_json["started_with"],
        serde_json::json!(3),
        "ArenaView carries started_with (the fixed public run denominator)"
    );
}
