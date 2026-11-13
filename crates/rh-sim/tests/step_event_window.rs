//! P-SIM-REPLAY-LONG-1: a step reads only the events it produced itself, never what its caller left in the output buffer.
//!
//! `Sim::step_into(out)` appends to `out` and documents that it does not clear it. The live room and the headless runner
//! clear their buffer before each step; `run_replay` does not. A step whose systems read the whole of `out` therefore
//! behaves differently under a replay than it did live: `mob_ai::think` scans every `Block` event in the buffer and wakes
//! an idle holder, so a stale `Block` from an earlier step wakes a shield mob that has since gone back to idle, and a
//! recorded match fails verification (`Diverged`).
//!
//! The scenario is a practice room (training world, practice arena, started from its lobby): one Holy player takes the
//! sword off the practice rack, drops a Glacial Warden camp (one elite shield mob, facing the player), walks up below it,
//! swings until its shield blocks once (a `Block` event), then runs to the far corner. The warden chases, leaves its
//! leash, gives up, walks home and goes idle; from the next step on a stale `Block` still in an uncleared buffer wakes it
//! again. Every input is computed from positions with exact arithmetic (no transcendental), so the run is the same on
//! every target.
use rh_sim::initial_world::ItemDef;
use rh_sim::mob_catalog::MobTypeId;
use rh_sim::mob_runtime::{Mob, MobKind};
use rh_sim::replay::{apply_input, run_replay, Recorder, Replay, ReplayInput, ReplayStart};
use rh_sim::{
    validate, Command, Container, Event, FactionId, PlayerId, RawCommand, Secrets, Sim, SimConfig,
    Vec2, WeaponId,
};

fn config() -> SimConfig {
    SimConfig {
        training: true,
        quests: false,
        consumables: false,
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        ..Default::default()
    }
}

fn me() -> PlayerId {
    PlayerId(1)
}

/// The one join, as a recorded input.
fn join() -> ReplayInput {
    ReplayInput::Join {
        profile: "replay-window".into(),
        faction: Some(FactionId::Holy),
        bot: false,
        policy: None,
    }
}

/// The practice room in its lobby, before its first step.
fn lobby() -> Sim {
    Sim::new(
        config(),
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(5),
    )
}

/// The practice room with the player joined.
fn start() -> Sim {
    let mut sim = lobby();
    apply_input(&mut sim, &join());
    sim
}

/// Steps in the scenario: enough for the block, the chase, the give-up and the walk home.
fn steps() -> usize {
    300
}

fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid scenario command")
}

/// The practice console's camp drop (`TrainRaw` command 3) of one Glacial Warden: an elite, so a camp of one shield mob.
fn drop_warden() -> Command {
    let code = MobTypeId::ALL
        .iter()
        .position(|t| *t == MobTypeId::GlacialWarden)
        .expect("Glacial Warden is a catalog type") as u32;
    cmd(RawCommand::Train(rh_sim::input::TrainRaw {
        command: 3,
        id: code,
        count: 0,
        options: [0; 3],
        option_count: 0,
    }))
}

fn warden(sim: &Sim) -> Option<&Mob> {
    sim.mobs().iter().find(|m| m.kind == MobKind::Practice)
}

fn sword_rack(sim: &Sim) -> Option<&Container> {
    sim.containers().iter().find(|c| {
        !c.opened
            && c.items
                .iter()
                .any(|i| i.def == ItemDef::Weapon(WeaponId::Sword))
    })
}

fn far(a: Vec2, b: Vec2, r: f64) -> bool {
    let (dx, dy) = (a.x - b.x, a.y - b.y);
    dx * dx + dy * dy > r * r
}

/// The scripted player: its inputs for a step depend only on the sim it reads and on what it has seen.
#[derive(Default)]
struct Script {
    dropped: bool,
    blocked: bool,
}

impl Script {
    fn inputs(&mut self, sim: &Sim) -> Vec<Command> {
        let Some(p) = sim.players().iter().find(|p| p.core.id == me()) else {
            return Vec::new();
        };
        let me = p.core.pos();
        if p.core.active_weapon() != WeaponId::Sword {
            // Take the sword off the practice rack.
            let Some(rack) = sword_rack(sim) else {
                return Vec::new();
            };
            return if far(rack.at, me, 16.) {
                vec![cmd(RawCommand::Move {
                    x: rack.at.x,
                    y: rack.at.y,
                    seq: None,
                })]
            } else {
                vec![cmd(RawCommand::Pickup {
                    container_id: rack.id,
                })]
            };
        }
        if !self.dropped {
            self.dropped = true;
            return vec![drop_warden()];
        }
        let Some(w) = warden(sim) else {
            return Vec::new();
        };
        let at = w.core.pos();
        if self.blocked {
            // Run to the far corner, out of the warden's leash.
            vec![cmd(RawCommand::Move {
                x: 43.5 * 32.,
                y: 27.5 * 32.,
                seq: None,
            })]
        } else if far(at, me, 44.) {
            // Walk to just below the warden (same column: the swing below is straight up).
            vec![cmd(RawCommand::Move {
                x: at.x,
                y: at.y + 40.,
                seq: None,
            })]
        } else {
            let up = -std::f64::consts::FRAC_PI_2;
            vec![
                cmd(RawCommand::Stop { seq: None }),
                cmd(RawCommand::Aim { a: up }),
                cmd(RawCommand::Attack { a: up, t: None }),
            ]
        }
    }

    fn saw(&mut self, events: &[Event]) {
        self.blocked |= events.iter().any(|e| matches!(e, Event::Block { .. }));
    }
}

/// What the scenario must actually exercise, so that a green run is not a vacuous one.
#[derive(Default)]
struct Witness {
    first_block: Option<usize>,
    left_home: bool,
    home_again: Option<usize>,
}

impl Witness {
    fn note(&mut self, sim: &Sim, step: usize, events: &[Event]) {
        let holder = warden(sim).map(|w| w.core.id);
        if self.first_block.is_none()
            && events
                .iter()
                .any(|e| matches!(e, Event::Block { id, .. } if Some(*id) == holder))
        {
            self.first_block = Some(step);
        }
        if let Some(w) = warden(sim) {
            if far(w.core.pos(), w.home, 96.) {
                self.left_home = true;
            } else if self.left_home && self.home_again.is_none() && !far(w.core.pos(), w.home, 4.)
            {
                self.home_again = Some(step);
            }
        }
    }

    fn check(&self) {
        let block = self
            .first_block
            .expect("the scenario's sword swing is blocked by the warden's shield");
        assert!(self.left_home, "the warden chased the player off its spot");
        let home = self
            .home_again
            .expect("the warden gave up and walked home within the scenario");
        assert!(
            block < home,
            "the block (step {block}) precedes the warden's return (step {home})"
        );
    }
}

/// Folds every step's state hash (as the ability hash tape does).
fn fold(acc: u64, hash: u64) -> u64 {
    (acc ^ hash).wrapping_mul(0x0000_0100_0000_01b3)
}

fn fold_seed() -> u64 {
    0xcbf2_9ce4_8422_2325
}

/// The fold of this scenario's state hashes for a caller that clears its buffer before every step (the live room, the
/// headless runner), measured on the integration base this packet branched from. A fix must not move it.
fn pinned_fold() -> u64 {
    0xfb59_e066_ff3c_feaa
}

#[test]
fn a_step_behaves_the_same_whatever_events_its_caller_left_in_the_buffer() {
    let mut cleared = start();
    let mut kept = cleared.clone();
    let mut script = Script::default();
    let mut witness = Witness::default();
    let mut fresh = Vec::new();
    let mut stale = Vec::new();
    for step in 0..steps() {
        for c in script.inputs(&cleared) {
            let a = cleared.submit(me(), c);
            let b = kept.submit(me(), c);
            assert_eq!(a, b, "step {step}: the same input is accepted the same way");
        }
        fresh.clear();
        cleared.step_into(&mut fresh);
        let left = stale.len();
        kept.step_into(&mut stale);
        assert_eq!(
            kept.state_hash(),
            cleared.state_hash(),
            "step {step} (tick {}): the state after a step depends on the {left} stale events its caller left in the \
             output buffer",
            cleared.tick()
        );
        assert_eq!(
            &stale[left..],
            &fresh[..],
            "step {step}: the events a step appends depend on what its caller left in the output buffer"
        );
        script.saw(&fresh);
        witness.note(&cleared, step, &fresh);
    }
    witness.check();
}

#[test]
fn a_stale_block_left_in_the_buffer_does_not_wake_an_idle_shield_mob() {
    let mut cleared = start();
    let mut script = Script::default();
    while warden(&cleared).is_none() {
        assert!(cleared.tick() < 200, "the scenario drops its warden");
        for c in script.inputs(&cleared) {
            let _ = cleared.submit(me(), c);
        }
        cleared.step();
    }
    let id = warden(&cleared)
        .expect("the camp drop placed the warden")
        .core
        .id;
    let mut kept = cleared.clone();
    // What a caller that never clears holds after a step in which the warden blocked the player's sword.
    let mut stale = vec![Event::Block {
        id,
        by: me(),
        weapon: WeaponId::Sword,
        passive: false,
    }];
    let mut fresh = Vec::new();
    for step in 0..20 {
        fresh.clear();
        cleared.step_into(&mut fresh);
        let left = stale.len();
        kept.step_into(&mut stale);
        assert_eq!(
            kept.state_hash(),
            cleared.state_hash(),
            "step {step} after the drop: a Block event the caller left in the buffer woke the idle warden"
        );
        assert_eq!(
            &stale[left..],
            &fresh[..],
            "step {step}: the appended events"
        );
    }
}

fn recorded() -> Replay {
    // A lobby start: an active start of a practice room would record the room's own weapon racks as scenario setup and
    // seed them a second time on replay (a separate finding, see the packet).
    let mut sim = lobby();
    let mut rec = Recorder::new(&sim, config(), ReplayStart::Lobby);
    apply_input(&mut sim, &join());
    rec.record(join());
    let mut script = Script::default();
    let mut witness = Witness::default();
    for step in 0..steps() {
        for c in script.inputs(&sim) {
            let input = ReplayInput::Command {
                player: me(),
                cmd: c,
            };
            apply_input(&mut sim, &input);
            rec.record(input);
        }
        let events = sim.step();
        rec.stepped(&sim);
        script.saw(&events);
        witness.note(&sim, step, &events);
    }
    witness.check();
    rec.replay
}

#[test]
fn a_recording_in_which_a_shield_mob_blocks_then_goes_home_replays_to_its_final_hash() {
    let r = recorded();
    let back: Replay = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
    let (sim, _) = run_replay(&back).expect("the recording verifies at every step");
    assert_eq!(Some(&sim.state_hash()), r.hashes.last(), "the final hash");
}

#[test]
fn a_caller_that_clears_its_buffer_sees_the_pinned_hashes() {
    let mut sim = start();
    let mut script = Script::default();
    let mut witness = Witness::default();
    let mut events = Vec::new();
    let mut acc = fold_seed();
    for step in 0..steps() {
        for c in script.inputs(&sim) {
            let _ = sim.submit(me(), c);
        }
        events.clear();
        sim.step_into(&mut events);
        script.saw(&events);
        witness.note(&sim, step, &events);
        acc = fold(acc, sim.state_hash());
    }
    witness.check();
    assert_eq!(
        format!("{acc:016x}"),
        format!("{:016x}", pinned_fold()),
        "the state hashes a clearing caller sees moved"
    );
}
